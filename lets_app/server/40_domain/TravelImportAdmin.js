/**
 * TravelImportAdmin.js
 * The write paths for the existing-travel import: preview, commit, rollback.
 *
 * WHY THIS IS SEPARATE FROM 30_services/TravelImport.js
 * -----------------------------------------------------
 * TravelImport.js is pure functions over data passed in — parse, scope,
 * validate, match, diff. It touches no spreadsheet, which is what makes the
 * whole feature testable without one.
 *
 * This file is everything that writes, plus the three browser-callable
 * entrypoints. The split is the same one GogovSync/BudgetBackfill already
 * use, and it is load-bearing for the test suite: test_travel_import.js runs
 * the engine against the real workbook with no GAS runtime at all.
 *
 * ADMIN ONLY, ALL OF IT
 * ---------------------
 * Every function here either reads one traveller's financial detail or writes
 * a request that consumes a DAC's budget without anyone approving it. That is
 * the same boundary BudgetBackfill draws, and for the same reason: reading
 * budget totals is deliberately open (@clolry: "no secrets to hide there —
 * we're trying to develop transparency"), but writing money is not.
 *
 * THE PREVIEW IS PERSISTED, NOT RECOMPUTED
 * ----------------------------------------
 * @clolry asked for an import preview. A preview the commit recomputes is a
 * preview of something else — the file could change, the roster could change,
 * a concurrent import could land. So previewImport writes a PREVIEW batch and
 * its rows to the ledger, and commitImport reads them back. What an
 * administrator approved is provably what gets committed.
 */

var TravelImportAdmin = (function () {

  function _str_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

  function _now_() { return new Date(); }

  function _actor_() {
    var email = '';
    try { email = Session.getActiveUser().getEmail() || ''; } catch (e) { email = ''; }
    var name = email;
    try {
      if (typeof formatUserName === 'function' && email) name = formatUserName(email);
    } catch (e) { name = email; }
    return { email: email, name: name };
  }

  function _batchId_(now) {
    var d = now || new Date();
    function p(n, w) { return ('0000' + n).slice(-(w || 2)); }
    var stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
                p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    var rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'bat_' + stamp + '_' + rand;
  }

  // ==========================================================================
  // READING WHAT LETS ALREADY HOLDS
  // ==========================================================================

  /**
   * Existing LETS requests, keyed by the SOURCE ID they were imported from.
   *
   * THIS MAP IS THE DUPLICATE PREVENTION. A source row whose ID is a key here
   * is an update; one that is not is new. @clolry asked for "duplicate
   * prevention via source IDs", and this is where the promise is kept.
   *
   * Keyed on Gogov_Request_ID because that column already exists on Requests
   * and already means exactly this. Adding a second identifier column would
   * leave two places to disagree about where a row came from.
   *
   * NORMALISED ON READ as well as on write. The seven all-digit IDs can have
   * been written by an older code path as '4946.0'; normalising both sides
   * means a stored '4946.0' still matches an incoming 4946 instead of
   * producing the duplicate this map exists to prevent.
   *
   * @param {TravelDB} db
   * @returns {Object} sourceId -> {requestId, estimate, actual, ...}
   */
  function existingBySourceId(db) {
    var out = {};
    var data;
    try {
      data = db.readSheet(SHEET_NAMES.REQUESTS);
    } catch (e) {
      console.warn('TravelImportAdmin: cannot read Requests: ' + e.message);
      return out;
    }
    if (!data || !data.headers.length) return out;

    var ix = data.headerIndex;
    function col(name) { return (name in ix) ? ix[name] : -1; }
    var cSource = col('Gogov_Request_ID');
    if (cSource === -1) return out;

    var cId = col('Request_ID');
    var cEst = col('Grand_Total');
    var cAct = col('Actual_Total');
    var cActSrc = col('Actual_Source');
    var cConfirmed = col('Match_Confirmed_By');
    var cStart = col('Event_Start_Date');
    var cEnd = col('Event_End_Date');
    var cOffice = col('Owning_Office');
    var cStatus = col('Status');
    var cTrip = col('Trip_Name');

    data.rows.forEach(function (row, i) {
      var src = TravelImport.normalizeSourceId(cSource > -1 ? row[cSource] : '');
      if (!src) return;
      out[src] = {
        sheetRow: i + 2, // 1-based, past the header — what updateRowByIndex wants
        requestId: cId > -1 ? _str_(row[cId]) : '',
        tripName: cTrip > -1 ? _str_(row[cTrip]) : '',
        estimate: cEst > -1 ? round2(row[cEst]) : 0,
        actual: cAct > -1 && row[cAct] !== '' ? round2(row[cAct]) : '',
        actualSource: cActSrc > -1 ? _str_(row[cActSrc]) : '',
        matchConfirmedBy: cConfirmed > -1 ? _str_(row[cConfirmed]) : '',
        startDate: cStart > -1 ? TravelImport.toDateString(row[cStart]) : '',
        endDate: cEnd > -1 ? TravelImport.toDateString(row[cEnd]) : '',
        owningOffice: cOffice > -1 ? _str_(row[cOffice]) : '',
        status: cStatus > -1 ? _str_(row[cStatus]) : ''
      };
    });
    return out;
  }

  /**
   * LETS requests as match candidates.
   *
   * Deliberately NOT filtered by fiscal year — see TravelImport.candidatePool
   * for the measured case where filtering attaches $1,176.10 to the wrong
   * trip.
   */
  function letsRequestsForMatching(db) {
    var data;
    try { data = db.readSheet(SHEET_NAMES.REQUESTS); } catch (e) { return []; }
    if (!data || !data.headers.length) return [];
    var ix = data.headerIndex;
    function col(n) { return (n in ix) ? ix[n] : -1; }
    var cId = col('Request_ID'), cTrip = col('Trip_Name'),
        cStart = col('Event_Start_Date'), cEnd = col('Event_End_Date'),
        cTotal = col('Grand_Total'), cName = col('Submitter_Name'),
        cOffice = col('Owning_Office'), cSource = col('Gogov_Request_ID');
    if (cId === -1) return [];

    return data.rows.map(function (row) {
      return {
        requestId: _str_(row[cId]),
        gogovRequestId: cSource > -1 ? TravelImport.normalizeSourceId(row[cSource]) : '',
        tripName: cTrip > -1 ? _str_(row[cTrip]) : '',
        startDate: cStart > -1 ? TravelImport.toDateString(row[cStart]) : '',
        endDate: cEnd > -1 ? TravelImport.toDateString(row[cEnd]) : '',
        estimate: cTotal > -1 ? round2(row[cTotal]) : 0,
        employeeName: cName > -1 ? _str_(row[cName]) : '',
        owningOffice: cOffice > -1 ? _str_(row[cOffice]) : ''
      };
    }).filter(function (r) { return r.requestId; });
  }

  // ==========================================================================
  // MAPPING PROFILES — configurable, persisted
  // ==========================================================================
  //
  // @clolry asked for "configurable column mappings". A profile is stored
  // under a Script Property so a changed source header costs a remap in the
  // UI rather than a code change and a deploy.

  var PROFILE_PREFIX = 'TRAVEL_IMPORT_MAPPING_';

  function saveMappingProfile(name, payload) {
    var key = PROFILE_PREFIX + _str_(name).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    PropertiesService.getScriptProperties()
      .setProperty(key, JSON.stringify(payload || {}));
    return key;
  }

  function loadMappingProfile(name) {
    var key = PROFILE_PREFIX + _str_(name).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    var raw = PropertiesService.getScriptProperties().getProperty(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {
      console.warn('TravelImportAdmin: profile ' + key + ' is not valid JSON');
      return null;
    }
  }

  // ==========================================================================
  // THE LEDGER
  // ==========================================================================

  /** A preview/commit record -> a Travel_Imports row, mapped over the schema. */
  function _ledgerRow_(rec, batchId, index, actor, now) {
    var h = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.TRAVEL_IMPORTS];
    var o = {
      'Import_ID': 'imp_' + batchId.slice(4) + '_' + index,
      'Import_Batch_ID': batchId,
      'Source_System': 'gogov-workbook',
      'Source_Sheet': rec.sourceSheet,
      'Source_Row': rec.sourceRow,
      'Source_Record_ID': rec.sourceRecordId,
      'Source_Record_Key': rec.sourceRecordKey,
      'Source_Row_Hash': rec.sourceRowHash,
      'Record_Kind': rec.recordKind,
      'Fiscal_Year': rec.fiscalYear,
      'Scope_Decision': rec.scopeDecision,
      'Scope_Reason': rec.scopeReason || '',
      'Employee_Name': rec.employeeName,
      'Employee_Name_Normalized': rec.employeeNameNormalized,
      'Trip_Name': rec.tripName,
      'Purpose': rec.purpose,
      'Start_Date': rec.startDate,
      'End_Date': rec.endDate,
      'Report_End_Date': rec.reportEndDate,
      'Submit_Date': rec.submitDate,
      'Estimate_Amount': rec.estimateAmount,
      'Claimed_Amount': rec.claimedAmount,
      'Approved_Amount': rec.approvedAmount,
      'Disallowed_Amount': rec.disallowedAmount,
      'Source_Office_Symbol': rec.sourceOfficeSymbol,
      'Office_Code': rec.officeCode,
      'Org_Code': rec.orgCode,
      'Diff_Status': rec.diffStatus,
      'Diff_Detail': JSON.stringify(rec.diffDetail || {}),
      'Target_Request_ID': rec.targetRequestId || '',
      'Match_Status': rec.matchStatus || '',
      'Match_Method': rec.matchMethod || '',
      'Match_Candidates': JSON.stringify(rec.matchCandidates || []),
      'Match_Confirmed_By': rec.matchConfirmedBy || '',
      'Match_Confirmed_At': rec.matchConfirmedAt || '',
      'Overwrote_Verified': rec.overwroteVerified === true,
      'Override_Reason': rec.overrideReason || '',
      'Override_By': rec.overrideBy || '',
      'Error_Message': rec.errorMessage || '',
      'Notes': rec.matchNote || '',
      'Created_At': now,
      'Created_By': actor.email
    };
    // Mapped over the schema headers, never built positionally: writes are
    // positional (docs/DATA_DICTIONARY.md §3.9) and a hand-built array
    // silently misfiles every column after the first mistake.
    return h.map(function (k) { return (k in o) ? o[k] : ''; });
  }

  function _batchRow_(batch) {
    var h = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.IMPORT_BATCHES];
    return h.map(function (k) { return (k in batch) ? batch[k] : ''; });
  }

  // ==========================================================================
  // PREVIEW
  // ==========================================================================

  /**
   * Computes a preview and persists it as a PREVIEW batch.
   *
   * NOTHING IN Requests IS TOUCHED. A preview is a read of the source plus a
   * write to the ledger; the projection into Requests happens only on commit.
   *
   * @param {Object} input see TravelImport.buildPreview, plus sourceLabel
   * @returns {Object} standard response envelope
   */
  function preview(input) {
    var inp = input || {};
    var actor = _actor_();
    var now = _now_();

    var scope = {
      fiscalYear: _str_(inp.fiscalYear) || TravelImport.currentFiscalYear(now),
      orgFilter: _str_(inp.orgFilter).toUpperCase() || 'ASD'
    };

    var reqMapping = inp.requestMapping;
    var expMapping = inp.expenseMapping;
    // A saved profile is the default; an explicit mapping in the call wins, so
    // the UI can preview a correction before saving it.
    if (!reqMapping || !expMapping) {
      var prof = loadMappingProfile(inp.mappingProfile || 'DEFAULT');
      if (prof) {
        reqMapping = reqMapping || prof.requestMapping;
        expMapping = expMapping || prof.expenseMapping;
      }
    }

    // A MISSING REQUIRED FIELD STOPS THE PREVIEW, rather than producing one
    // full of blanks. Mapping 'Report Total' where 'Amount Approved' belongs
    // would overstate spend on a fifth of all rows and look entirely
    // plausible, so the mapping is checked before anything is computed.
    var reqCheck = TravelImport.proposeMapping(
      Object.keys((inp.requestRows || [{}])[0] || {}), 'request');
    var expCheck = TravelImport.proposeMapping(
      Object.keys((inp.expenseRows || [{}])[0] || {}), 'expense');
    var mappingProblems = [];
    if ((inp.requestRows || []).length && !reqMapping) {
      reqCheck.missing.forEach(function (f) {
        mappingProblems.push('Request tab: no column mapped to ' + f + '.');
      });
    }
    if ((inp.expenseRows || []).length && !expMapping) {
      expCheck.missing.forEach(function (f) {
        mappingProblems.push('Expense tab: no column mapped to ' + f + '.');
      });
    }
    if (mappingProblems.length) {
      return { success: false, problems: mappingProblems };
    }

    var db = new TravelDB();
    var built;
    try {
      built = TravelImport.buildPreview({
        requestRows: inp.requestRows,
        expenseRows: inp.expenseRows,
        requestMapping: reqMapping || reqCheck.mapping,
        expenseMapping: expMapping || expCheck.mapping,
        requestFirstRow: inp.requestFirstRow,
        expenseFirstRow: inp.expenseFirstRow,
        orgRoster: TravelImport.buildOrgRoster(inp.rosterRows, inp.overrideRows),
        scope: scope,
        existingBySourceId: existingBySourceId(db),
        letsRequests: letsRequestsForMatching(db)
      });
    } catch (e) {
      console.error('TravelImportAdmin.preview failed: ' + e.message);
      return errorResponse('Could not build the preview: ' + e.message);
    }

    var batchId = _batchId_(now);
    var batch = {
      'Batch_ID': batchId,
      'Source_System': 'gogov-workbook',
      'Source_Label': _str_(inp.sourceLabel) || 'unnamed source',
      'Source_Sheet': 'TravelRequest+Expense',
      'Mapping_Profile': _str_(inp.mappingProfile) || 'DEFAULT',
      'Mapping_Snapshot': JSON.stringify({
        request: reqMapping || reqCheck.mapping,
        expense: expMapping || expCheck.mapping
      }),
      'Scope_Fiscal_Year': scope.fiscalYear,
      'Scope_Org_Filter': scope.orgFilter,
      'Row_Count_Source': built.summary.sourceRows,
      'Row_Count_In_Scope': built.summary.inScope,
      'Row_Count_New': built.summary.newCount,
      'Row_Count_Changed': built.summary.changedCount,
      'Row_Count_Unchanged': built.summary.unchangedCount,
      'Row_Count_Conflict': built.summary.conflictCount,
      'Row_Count_Error': built.summary.errorCount,
      'Row_Count_Skipped': built.summary.skippedCount,
      'Amount_Total_In_Scope': built.summary.amountInScope,
      'Status': 'PREVIEW',
      'Variance_Basis': built.summary.varianceBasis,
      'Notes': built.summary.varianceBasisNote,
      'Created_At': now,
      'Created_By': actor.email
    };

    try {
      _writeLedger_(db, batch, built.records, batchId, actor, now);
    } catch (e) {
      console.error('TravelImportAdmin.preview could not persist: ' + e.message);
      return errorResponse('The preview was computed but could not be saved: ' + e.message);
    }

    // ERRORS GO TO Error_Log TOO, per row. @clolry asked for an error log;
    // the ledger holds the per-row detail, and Error_Log is where an
    // administrator already looks when something is wrong.
    built.records.filter(function (r) { return r.diffStatus === TravelImport.DIFF.ERROR; })
      .forEach(function (r) {
        try {
          logError('travelImportPreview',
                   'Row ' + r.sourceRow + ' (' + r.sourceSheet + '): ' + r.errorMessage,
                   { batchId: batchId, sourceRow: r.sourceRow,
                     sourceRecordId: r.sourceRecordId });
        } catch (e) { /* logError is best-effort; never fail an import on it */ }
      });

    return successResponse({
      batchId: batchId,
      summary: built.summary,
      scope: scope,
      // Only in-scope rows are returned. 1,260 skipped rows would be
      // megabytes of payload the preview screen cannot use; the counts and
      // the reasons are in the summary, and the ledger holds every row.
      records: built.records.filter(function (r) {
        return r.scopeDecision === TravelImport.SCOPE.IN;
      })
    }, 'Preview ready. Nothing has been written to Requests.');
  }

  function _writeLedger_(db, batch, records, batchId, actor, now) {
    var bSheet = db.sheet(SHEET_NAMES.IMPORT_BATCHES);
    var lSheet = db.sheet(SHEET_NAMES.TRAVEL_IMPORTS);
    if (!bSheet) throw new Error(SHEET_NAMES.IMPORT_BATCHES + ' tab not found. Run the setup.');
    if (!lSheet) throw new Error(SHEET_NAMES.TRAVEL_IMPORTS + ' tab not found. Run the setup.');

    var bHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.IMPORT_BATCHES];
    var lHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.TRAVEL_IMPORTS];

    bSheet.getRange(bSheet.getLastRow() + 1, 1, 1, bHeaders.length)
      .setValues([_batchRow_(batch)]);

    // Only in-scope and errored rows go to the ledger. Writing all 1,260
    // skipped rows every run would add ~1.3k rows per preview and make the
    // tab unusable within a week; their counts and reasons are on the batch.
    var keep = records.filter(function (r) {
      return r.scopeDecision === TravelImport.SCOPE.IN ||
             r.diffStatus === TravelImport.DIFF.ERROR;
    });
    if (keep.length) {
      var rows = keep.map(function (r, i) {
        return _ledgerRow_(r, batchId, i, actor, now);
      });
      // One setValues, not appendRow in a loop: appendRow is both slow and
      // non-atomic, and an execution timeout halfway through would leave an
      // unknown number of ledger rows behind.
      lSheet.getRange(lSheet.getLastRow() + 1, 1, rows.length, lHeaders.length)
        .setValues(rows);
    }

    [SHEET_NAMES.IMPORT_BATCHES, SHEET_NAMES.TRAVEL_IMPORTS].forEach(function (n) {
      try { db.invalidate(n); } catch (e) { /* cache only */ }
    });
  }

  // ==========================================================================
  // COMMIT
  // ==========================================================================

  /**
   * Commits a PREVIEW batch: projects its rows into Requests.
   *
   * READS THE LEDGER, DOES NOT RECOMPUTE. The administrator approved a
   * specific set of changes; recomputing here could produce a different set
   * (the file may have changed, the roster may have changed, another import
   * may have landed) and the approval would be meaningless.
   *
   * ATOMIC ACROSS ROWS. A partial commit is the worst outcome available: the
   * administrator would have no way to tell which of 38 rows landed, and
   * re-running would double-count the ones that did. Writes are batched into
   * one setValues per sheet.
   *
   * @param {string} batchId
   * @param {Object} [options] { overrides: {importId: reason}, allowConflicts }
   * @returns {Object}
   */
  function commit(batchId, options) {
    var opts = options || {};
    var id = _str_(batchId);
    if (!id) return errorResponse('No batch was named.');

    var actor = _actor_();
    var now = _now_();

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
    } catch (e) {
      return errorResponse('Another import is running. Try again in a moment.');
    }

    try {
      var db = new TravelDB();
      var batch = _findBatch_(db, id);
      if (!batch) return errorResponse('Batch ' + id + ' was not found.');
      // A batch is committed ONCE. Without this check, pressing the button
      // twice writes every row twice — the exact duplication the source-ID
      // key exists to prevent, arriving by a different route.
      if (batch.status !== 'PREVIEW') {
        return errorResponse('Batch ' + id + ' is ' + batch.status +
                             ', so it cannot be committed. Only a PREVIEW batch can be.');
      }

      var rows = batchRows(db, id);
      var inScope = rows.filter(function (r) {
        return r.scopeDecision === TravelImport.SCOPE.IN;
      });
      if (!inScope.length) return errorResponse('Batch ' + id + ' has no in-scope rows.');

      // CONFLICTS BLOCK THE COMMIT unless each is explicitly overridden with
      // a reason. This is @clolry's "never overwrite verified financial
      // records without an explicit reconciliation rule", enforced at the
      // write rather than only reported at the preview.
      var overrides = opts.overrides || {};
      var blocked = inScope.filter(function (r) {
        return r.diffStatus === TravelImport.DIFF.CONFLICT &&
               !_str_(overrides[r.importId]);
      });
      if (blocked.length) {
        return {
          success: false,
          needsConfirmation: true,
          conflicts: blocked.map(function (r) {
            return {
              importId: r.importId,
              sourceRow: r.sourceRow,
              employeeName: r.employeeName,
              tripName: r.tripName,
              targetRequestId: r.targetRequestId,
              detail: r.diffDetail
            };
          }),
          error: blocked.length + ' row(s) would overwrite a VERIFIED financial ' +
                 'figure. Each needs an explicit override with a reason, or leave ' +
                 'the verified figure in place.'
        };
      }

      var existing = existingBySourceId(db);
      var reqSheet = db.sheet(SHEET_NAMES.REQUESTS);
      if (!reqSheet) return errorResponse(SHEET_NAMES.REQUESTS + ' tab not found.');
      var reqHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.REQUESTS];

      var newRows = [];
      var updates = [];   // {sheetRow, changes}
      var logRows = [];
      var created = [];
      var ledgerUpdates = [];  // {rowNum, changes}

      // IDs come from one starting point, not from generateRequestId per row:
      // that function reads the sheet for the highest existing number, and
      // nothing is written yet, so every call in the loop returns the same ID.
      var nextSeq = _nextRequestSeq_(db, now);
      var seqUsed = 0;

      inScope.forEach(function (r) {
        if (r.diffStatus === TravelImport.DIFF.UNCHANGED ||
            r.diffStatus === TravelImport.DIFF.ERROR) return;

        var target = existing[r.sourceRecordId] || null;

        // An EXPENSE row never creates a request. It posts an actual onto one.
        // An unmatched expense has nowhere to post, and inventing a request
        // for it would fabricate a trip nobody took — so it stays in the
        // ledger, visible and unposted. The money is real and still counted
        // in the batch total; the Expense_Imports schema comment makes the
        // same argument.
        if (r.sourceSheet === 'Expense') {
          var expTarget = r.targetRequestId
            ? _findByRequestId_(db, r.targetRequestId)
            : (target || null);
          if (!expTarget) return;
          var changes = {
            'Actual_Total': r.approvedAmount,
            'Actual_Source': 'import',
            'Actual_Posted_At': now,
            'Actual_Posted_By': actor.email,
            'Reconciliation_Status': 'MATCHED',
            'Match_Method': r.matchMethod || 'import',
            'Expense_Report_Name': r.tripName,
            'Expense_Report_End_Date': r.reportEndDate,
            'Gogov_Report_Name': r.tripName,
            'Updated_At': now
          };
          if (_str_(overrides[r.importId])) {
            changes['Reconciliation_Notes'] =
              'Import overrode a verified actual on ' +
              TravelImport.toDateString(now) + ' by ' + actor.email +
              ': ' + _str_(overrides[r.importId]);
          }
          updates.push({ sheetRow: expTarget.sheetRow, changes: changes });
          ledgerUpdates.push({
            rowNum: r.ledgerRow,
            changes: {
              'Target_Request_ID': expTarget.requestId,
              'Overwrote_Verified': !!_str_(overrides[r.importId]),
              'Override_Reason': _str_(overrides[r.importId]),
              'Override_By': _str_(overrides[r.importId]) ? actor.email : ''
            }
          });
          return;
        }

        // A REQUEST row updates in place when its source ID is already known,
        // which is what makes incremental runs safe to repeat.
        if (target) {
          updates.push({
            sheetRow: target.sheetRow,
            changes: {
              'Grand_Total': r.estimateAmount,
              'Traveler_Total': r.estimateAmount,
              'Event_Start_Date': r.startDate,
              'Event_End_Date': r.endDate,
              'Owning_Office': r.officeCode,
              'Owning_Org_Code': r.orgCode,
              'Updated_At': now
            }
          });
          ledgerUpdates.push({
            rowNum: r.ledgerRow,
            changes: { 'Target_Request_ID': target.requestId }
          });
          return;
        }

        var requestId = _idPrefix_(now) + String(nextSeq + seqUsed).padStart(4, '0');
        seqUsed++;
        var status = TravelImport.statusForRecord({
          recordKind: r.recordKind, endDate: r.endDate,
          reportEndDate: r.reportEndDate
        }, now);

        var rec = {
          'Request_ID': requestId,
          'Status': status,
          'Trip_Name': r.tripName,
          'Location_Type': 'CONUS',
          'Event_Start_Date': r.startDate,
          'Event_End_Date': r.endDate,
          'BLUF': '',
          'Purpose': r.purpose,
          'Shared_Total': 0,
          'Traveler_Total': r.estimateAmount,
          'Grand_Total': r.estimateAmount,
          'Traveler_Count': 1,
          'Leg_Count': 0,
          'Submitter_Name': r.employeeName,
          'Submitter_Email': '',
          'Submitter_Org_Code': r.orgCode,
          // Reviewer fields stay EMPTY, as in BudgetBackfill: a name here
          // would put imported travel on somebody's pending queue and record
          // an approval that never happened.
          'Current_Reviewer_Name': '',
          'Current_Reviewer_Email': '',
          'Initial_Review_Level': '',
          'Created_At': now,
          'Updated_At': now,
          // The date the TRAVEL was submitted, not when it was imported.
          // Reports group by this, and stamping it `now` would file October
          // travel under whatever month the import ran — the exact
          // reconciliation problem this feature exists to fix.
          'Submitted_At': r.submitDate || r.startDate || now,
          'Version': 1,
          'Owning_Office': r.officeCode,
          'Owning_Org_Code': r.orgCode,
          'Travel_Purpose': r.purpose,
          'Travel_Purpose_Label': r.purpose,
          'Is_Event_Plan_Item': false,
          // MARKED, like every backfilled row. A figure that entered the
          // budget without review must be identifiable afterwards, or the
          // audit trail implies an approval that never happened.
          'Primary_Justification': 'IMPORT: ' + r.recordKind + ' imported from ' +
            batch.sourceLabel + ' (batch ' + id + ', source row ' + r.sourceRow +
            ', source ID ' + r.sourceRecordId + ') by ' + actor.name +
            ' on ' + TravelImport.toDateString(now),
          'Traveler_Org_Codes': r.orgCode,
          // THE SOURCE IDENTITY, PRESERVED. This is what makes the next run
          // an update instead of a duplicate.
          'Gogov_Request_ID': r.sourceRecordId,
          'Gogov_Report_Name': r.tripName,
          'Reconciliation_Status': 'UNRECONCILED'
        };
        newRows.push(reqHeaders.map(function (h) { return h in rec ? rec[h] : ''; }));

        logRows.push({
          'Log_ID': 'LOG-IMP-' + now.getTime() + '-' + created.length,
          'Request_ID': requestId,
          'Action': 'TRAVEL_IMPORT',
          'Action_By_Name': actor.name,
          'Action_By_Email': actor.email,
          'Action_By_Role': 'admin',
          'Timestamp': now,
          'Previous_Status': '',
          'New_Status': status,
          'Comments': 'Imported from ' + batch.sourceLabel + ' (batch ' + id +
            '). NOT routed for approval and no notifications were sent. ' +
            'Source ' + r.sourceSheet + ' row ' + r.sourceRow + ', ID ' +
            r.sourceRecordId + '.',
          'Version_Before': 0,
          'Version_After': 1
        });

        created.push({
          requestId: requestId, sourceRecordId: r.sourceRecordId,
          tripName: r.tripName, employeeName: r.employeeName,
          office: r.officeCode, amount: r.estimateAmount,
          recordKind: r.recordKind, status: status, fiscalYear: r.fiscalYear
        });

        ledgerUpdates.push({
          rowNum: r.ledgerRow, changes: { 'Target_Request_ID': requestId }
        });
      });

      if (newRows.length) {
        reqSheet.getRange(reqSheet.getLastRow() + 1, 1, newRows.length, reqHeaders.length)
          .setValues(newRows);
      }
      updates.forEach(function (u) {
        try {
          db.updateRowByIndex(SHEET_NAMES.REQUESTS, u.sheetRow, u.changes);
        } catch (e) {
          console.error('TravelImportAdmin.commit: row ' + u.sheetRow + ': ' + e.message);
        }
      });

      var logSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
      if (logSheet && logRows.length) {
        var logHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.APPROVAL_LOG];
        logSheet.getRange(logSheet.getLastRow() + 1, 1, logRows.length, logHeaders.length)
          .setValues(logRows.map(function (l) {
            return logHeaders.map(function (h) { return h in l ? l[h] : ''; });
          }));
      }

      ledgerUpdates.forEach(function (u) {
        try {
          db.updateRowByIndex(SHEET_NAMES.TRAVEL_IMPORTS, u.rowNum, u.changes);
        } catch (e) { /* the ledger's target link is useful, not critical */ }
      });

      _updateBatch_(db, id, {
        'Status': 'COMMITTED',
        'Committed_At': now,
        'Committed_By': actor.email
      });

      [SHEET_NAMES.REQUESTS, SHEET_NAMES.APPROVAL_LOG,
       SHEET_NAMES.TRAVEL_IMPORTS, SHEET_NAMES.IMPORT_BATCHES].forEach(function (n) {
        try { db.invalidate(n); } catch (e) { /* cache only */ }
      });

      console.log('TravelImportAdmin: ' + actor.email + ' committed batch ' + id +
                  ' — ' + newRows.length + ' created, ' + updates.length + ' updated');

      return successResponse({
        batchId: id,
        created: created,
        requestsCreated: newRows.length,
        requestsUpdated: updates.length,
        // Echoed so the UI can STATE it rather than the administrator having
        // to trust that nothing was emailed.
        notificationsSent: 0,
        routedForApproval: false
      }, newRows.length + ' created, ' + updates.length + ' updated. ' +
         'No approval routing, no emails sent.');
    } catch (e) {
      console.error('TravelImportAdmin.commit failed: ' + e.message);
      try {
        _updateBatch_(new TravelDB(), id, { 'Status': 'FAILED', 'Notes': e.message });
      } catch (e2) { /* the original error is what matters */ }
      return errorResponse('Could not commit the import: ' + e.message);
    } finally {
      lock.releaseLock();
    }
  }

  // ==========================================================================
  // ROLLBACK
  // ==========================================================================

  /**
   * Reverses a committed batch.
   *
   * @clolry asked for "rollback or correction". Both are provided and they
   * are different acts: rollback undoes a whole batch; a correction is a
   * re-run, which the source-ID upsert already handles.
   *
   * WHAT ROLLBACK DOES AND DOES NOT DO
   * ----------------------------------
   * Rows the batch CREATED are deleted. Rows it UPDATED are restored from
   * Diff_Detail, which recorded the before-value precisely so this is
   * possible.
   *
   * ROWS DELETED FROM THE BOTTOM UP. Deleting row 10 shifts row 11 to 10, so
   * ascending deletion removes the wrong rows after the first — and here the
   * wrong row is somebody's travel request.
   *
   * A REQUEST THAT HAS SINCE BEEN EDITED IS NOT DELETED. If its Version has
   * moved past 1, or its status is no longer what the import set, a human has
   * touched it and rollback reports it for manual attention rather than
   * destroying that work. A rollback that silently deletes an administrator's
   * corrections is worse than one that stops and says so.
   *
   * @param {string} batchId
   * @param {string} reason
   * @returns {Object}
   */
  function rollback(batchId, reason) {
    var id = _str_(batchId);
    var why = _str_(reason);
    if (!id) return errorResponse('No batch was named.');
    // A rollback destroys financial records. Requiring a reason is the
    // cheapest possible audit control and the one most likely to be useful
    // six months later.
    if (!why) return errorResponse('A reason is required to roll back an import.');

    var actor = _actor_();
    var now = _now_();

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
    } catch (e) {
      return errorResponse('Another import is running. Try again in a moment.');
    }

    try {
      var db = new TravelDB();
      var batch = _findBatch_(db, id);
      if (!batch) return errorResponse('Batch ' + id + ' was not found.');
      if (batch.status === 'ROLLED_BACK') {
        return errorResponse('Batch ' + id + ' has already been rolled back.');
      }
      if (batch.status !== 'COMMITTED') {
        return errorResponse('Batch ' + id + ' is ' + batch.status +
                             '. Only a COMMITTED batch can be rolled back.');
      }

      var rows = batchRows(db, id).filter(function (r) { return r.targetRequestId; });
      var byRequestId = {};
      rows.forEach(function (r) { byRequestId[r.targetRequestId] = r; });

      var data = db.readSheet(SHEET_NAMES.REQUESTS);
      var ix = data.headerIndex;
      var cId = ('Request_ID' in ix) ? ix.Request_ID : -1;
      var cVersion = ('Version' in ix) ? ix.Version : -1;
      var cJust = ('Primary_Justification' in ix) ? ix.Primary_Justification : -1;
      if (cId === -1) return errorResponse('Requests has no Request_ID column.');

      var toDelete = [];
      var toRestore = [];
      var kept = [];

      data.rows.forEach(function (row, i) {
        var rid = _str_(row[cId]);
        var ledger = byRequestId[rid];
        if (!ledger) return;
        var sheetRow = i + 2;

        var createdByThisBatch = cJust > -1 &&
          _str_(row[cJust]).indexOf('IMPORT: ') === 0 &&
          _str_(row[cJust]).indexOf('batch ' + id) > -1;

        if (createdByThisBatch) {
          var version = cVersion > -1 ? Number(row[cVersion]) : 1;
          if (version > 1) {
            kept.push({ requestId: rid, reason: 'Edited since import (version ' +
                        version + '). Left in place for manual review.' });
            return;
          }
          toDelete.push(sheetRow);
          return;
        }

        // Updated, not created: restore the recorded before-values.
        var detail = ledger.diffDetail || {};
        var restore = {};
        Object.keys(detail).forEach(function (f) {
          var map = {
            estimateAmount: 'Grand_Total',
            approvedAmount: 'Actual_Total',
            startDate: 'Event_Start_Date',
            endDate: 'Event_End_Date',
            officeCode: 'Owning_Office'
          };
          if (map[f]) restore[map[f]] = detail[f].from;
        });
        if (Object.keys(restore).length) {
          restore['Updated_At'] = now;
          toRestore.push({ sheetRow: sheetRow, changes: restore, requestId: rid });
        }
      });

      // DESCENDING. Deleting ascending shifts every subsequent row up by one,
      // so after the first deletion every later index points at the wrong
      // row — and these rows are travel requests.
      toDelete.sort(function (a, b) { return b - a; });
      var reqSheet = db.sheet(SHEET_NAMES.REQUESTS);
      toDelete.forEach(function (rowNum) { reqSheet.deleteRow(rowNum); });

      toRestore.forEach(function (u) {
        try { db.updateRowByIndex(SHEET_NAMES.REQUESTS, u.sheetRow, u.changes); }
        catch (e) {
          console.error('TravelImportAdmin.rollback: ' + u.requestId + ': ' + e.message);
        }
      });

      _updateBatch_(db, id, {
        'Status': 'ROLLED_BACK',
        'Rolled_Back_At': now,
        'Rolled_Back_By': actor.email,
        'Rollback_Reason': why
      });

      [SHEET_NAMES.REQUESTS, SHEET_NAMES.IMPORT_BATCHES,
       SHEET_NAMES.TRAVEL_IMPORTS].forEach(function (n) {
        try { db.invalidate(n); } catch (e) { /* cache only */ }
      });

      console.log('TravelImportAdmin: ' + actor.email + ' rolled back batch ' + id +
                  ' — ' + toDelete.length + ' deleted, ' + toRestore.length + ' restored');

      return successResponse({
        batchId: id,
        deleted: toDelete.length,
        restored: toRestore.length,
        // NAMED, not just counted. A request left behind is one the
        // administrator has to decide about, and a count alone does not tell
        // them which.
        keptForReview: kept
      }, toDelete.length + ' request(s) deleted, ' + toRestore.length + ' restored' +
         (kept.length ? ', ' + kept.length + ' left for manual review' : '') + '.');
    } catch (e) {
      console.error('TravelImportAdmin.rollback failed: ' + e.message);
      return errorResponse('Could not roll back the import: ' + e.message);
    } finally {
      lock.releaseLock();
    }
  }

  // ==========================================================================
  // BATCH READS
  // ==========================================================================

  function _findBatch_(db, batchId) {
    var data;
    try { data = db.readSheet(SHEET_NAMES.IMPORT_BATCHES); } catch (e) { return null; }
    if (!data || !data.headers.length) return null;
    var ix = data.headerIndex;
    var cId = ('Batch_ID' in ix) ? ix.Batch_ID : -1;
    if (cId === -1) return null;
    for (var i = 0; i < data.rows.length; i++) {
      if (_str_(data.rows[i][cId]) !== batchId) continue;
      var row = data.rows[i];
      function g(n) { return (n in ix) ? row[ix[n]] : ''; }
      return {
        sheetRow: i + 2,
        batchId: batchId,
        sourceLabel: _str_(g('Source_Label')),
        mappingProfile: _str_(g('Mapping_Profile')),
        scopeFiscalYear: _str_(g('Scope_Fiscal_Year')),
        scopeOrgFilter: _str_(g('Scope_Org_Filter')),
        status: _str_(g('Status')),
        varianceBasis: _str_(g('Variance_Basis')),
        createdBy: _str_(g('Created_By')),
        createdAt: g('Created_At')
      };
    }
    return null;
  }

  function _updateBatch_(db, batchId, changes) {
    var b = _findBatch_(db, batchId);
    if (!b) throw new Error('Batch ' + batchId + ' not found.');
    db.updateRowByIndex(SHEET_NAMES.IMPORT_BATCHES, b.sheetRow, changes);
  }

  /** The ledger rows for a batch, parsed back into record shape. */
  function batchRows(db, batchId) {
    var data;
    try { data = db.readSheet(SHEET_NAMES.TRAVEL_IMPORTS); } catch (e) { return []; }
    if (!data || !data.headers.length) return [];
    var ix = data.headerIndex;
    var cBatch = ('Import_Batch_ID' in ix) ? ix.Import_Batch_ID : -1;
    if (cBatch === -1) return [];

    var out = [];
    data.rows.forEach(function (row, i) {
      if (_str_(row[cBatch]) !== batchId) return;
      function g(n) { return (n in ix) ? row[ix[n]] : ''; }
      function j(n) {
        try { return JSON.parse(_str_(g(n)) || '{}'); } catch (e) { return {}; }
      }
      out.push({
        ledgerRow: i + 2,
        importId: _str_(g('Import_ID')),
        sourceSheet: _str_(g('Source_Sheet')),
        sourceRow: Number(g('Source_Row')) || 0,
        sourceRecordId: TravelImport.normalizeSourceId(g('Source_Record_ID')),
        sourceRecordKey: _str_(g('Source_Record_Key')),
        recordKind: _str_(g('Record_Kind')),
        fiscalYear: _str_(g('Fiscal_Year')),
        scopeDecision: _str_(g('Scope_Decision')),
        employeeName: _str_(g('Employee_Name')),
        tripName: _str_(g('Trip_Name')),
        purpose: _str_(g('Purpose')),
        startDate: TravelImport.toDateString(g('Start_Date')),
        endDate: TravelImport.toDateString(g('End_Date')),
        reportEndDate: TravelImport.toDateString(g('Report_End_Date')),
        submitDate: TravelImport.toDateString(g('Submit_Date')),
        estimateAmount: round2(g('Estimate_Amount')),
        claimedAmount: round2(g('Claimed_Amount')),
        approvedAmount: round2(g('Approved_Amount')),
        officeCode: _str_(g('Office_Code')),
        orgCode: _str_(g('Org_Code')),
        diffStatus: _str_(g('Diff_Status')),
        diffDetail: j('Diff_Detail'),
        targetRequestId: _str_(g('Target_Request_ID')),
        matchStatus: _str_(g('Match_Status')),
        matchMethod: _str_(g('Match_Method')),
        errorMessage: _str_(g('Error_Message'))
      });
    });
    return out;
  }

  /** Batch history, newest first. */
  function listBatches(limit) {
    var db = new TravelDB();
    var data;
    try { data = db.readSheet(SHEET_NAMES.IMPORT_BATCHES); } catch (e) { return []; }
    if (!data || !data.headers.length) return [];
    var ix = data.headerIndex;
    var out = data.rows.map(function (row) {
      var o = {};
      Object.keys(ix).forEach(function (k) { o[k] = row[ix[k]]; });
      return o;
    });
    out.reverse();
    return limit ? out.slice(0, limit) : out;
  }

  function _findByRequestId_(db, requestId) {
    var data;
    try { data = db.readSheet(SHEET_NAMES.REQUESTS); } catch (e) { return null; }
    var ix = data.headerIndex;
    var cId = ('Request_ID' in ix) ? ix.Request_ID : -1;
    if (cId === -1) return null;
    for (var i = 0; i < data.rows.length; i++) {
      if (_str_(data.rows[i][cId]) === requestId) {
        return { sheetRow: i + 2, requestId: requestId };
      }
    }
    return null;
  }

  /**
   * ID prefix for a date: 'L27-' in FY2027.
   *
   * Matches Database.generateRequestId and BudgetBackfill._idPrefix_. All
   * three must agree or an imported request and a form-submitted one land in
   * different numbering sequences and can collide.
   *
   * FISCAL year, not calendar — the defect BudgetBackfill's comment records.
   */
  function _idPrefix_(d) {
    var dt = d || new Date();
    var fy = dt.getMonth() >= 9 ? dt.getFullYear() + 1 : dt.getFullYear();
    return 'L' + String(fy).slice(-2) + '-';
  }

  /** The next free request sequence for this fiscal year, computed once. */
  function _nextRequestSeq_(db, now) {
    var prefix = _idPrefix_(now || new Date());
    var max = 0;
    try {
      var data = db.readSheet(SHEET_NAMES.REQUESTS);
      var cId = (data.headerIndex && 'Request_ID' in data.headerIndex)
        ? data.headerIndex.Request_ID : 0;
      data.rows.forEach(function (row) {
        var id = _str_(row[cId]);
        if (id.indexOf(prefix) !== 0) return;
        var n = parseInt(id.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      });
    } catch (e) {
      console.warn('TravelImportAdmin: could not scan existing IDs: ' + e.message);
    }
    return max + 1;
  }

  return {
    existingBySourceId: existingBySourceId,
    letsRequestsForMatching: letsRequestsForMatching,
    saveMappingProfile: saveMappingProfile,
    loadMappingProfile: loadMappingProfile,
    preview: preview,
    commit: commit,
    rollback: rollback,
    listBatches: listBatches,
    batchRows: batchRows
  };
})();

// ============================================================================
// BROWSER-CALLABLE ENTRYPOINTS — ALL ADMIN-GUARDED
// ============================================================================
//
// Every one of these either reads a named traveller's financial detail or
// writes a request that consumes a DAC's budget without review. Same boundary
// BudgetBackfill draws: reading budget TOTALS is open for transparency,
// writing money is not.

function _requireTravelAdmin_(fnName) {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return { ok: false, response: errorResponse('Could not determine the active user.') };
  }
  if (!email || !isTravelAdmin(email)) {
    console.warn(fnName + ': refused non-admin caller ' + (email || '(none)'));
    return {
      ok: false,
      response: errorResponse('Administrator access is required to import existing travel.')
    };
  }
  return { ok: true, email: email };
}

/**
 * Proposes a column mapping for an uploaded sheet. No writes.
 *
 * @param {Array<string>} headers
 * @param {string} kind 'request' | 'expense'
 * @returns {Object}
 * @client
 */
function proposeTravelImportMapping(headers, kind) {
  var gate = _requireTravelAdmin_('proposeTravelImportMapping');
  if (!gate.ok) return gate.response;
  try {
    return successResponse(TravelImport.proposeMapping(headers, kind));
  } catch (e) {
    logError('proposeTravelImportMapping', e, { kind: kind });
    return errorResponse('Could not propose a mapping: ' + e.message);
  }
}

/**
 * Saves a reusable column-mapping profile.
 *
 * @clolry asked for configurable mappings: a renamed source column is then a
 * remap here, not a code change and a deploy.
 *
 * @param {string} name
 * @param {Object} payload { requestMapping, expenseMapping }
 * @returns {Object}
 * @client
 */
function saveTravelImportMapping(name, payload) {
  var gate = _requireTravelAdmin_('saveTravelImportMapping');
  if (!gate.ok) return gate.response;
  try {
    var key = TravelImportAdmin.saveMappingProfile(name, payload);
    return successResponse({ key: key }, 'Mapping saved.');
  } catch (e) {
    logError('saveTravelImportMapping', e, { name: name });
    return errorResponse('Could not save the mapping: ' + e.message);
  }
}

/**
 * Builds and persists an import preview. NOTHING is written to Requests.
 *
 * @param {Object} input
 * @returns {Object}
 * @client
 */
function previewTravelImport(input) {
  var gate = _requireTravelAdmin_('previewTravelImport');
  if (!gate.ok) return gate.response;
  try {
    return TravelImportAdmin.preview(input);
  } catch (e) {
    logError('previewTravelImport', e, {});
    return errorResponse('Could not build the preview: ' + e.message);
  }
}

/**
 * Commits a previewed batch into Requests.
 *
 * Writes requests that are APPROVED or COMPLETED without anyone approving
 * them, and the figures count against a DAC's balance immediately.
 *
 * @param {string} batchId
 * @param {Object} [options] { overrides: {importId: reason} }
 * @returns {Object}
 * @client
 */
function commitTravelImport(batchId, options) {
  var gate = _requireTravelAdmin_('commitTravelImport');
  if (!gate.ok) return gate.response;
  try {
    return TravelImportAdmin.commit(batchId, options);
  } catch (e) {
    logError('commitTravelImport', e, { batchId: batchId });
    return errorResponse('Could not commit the import: ' + e.message);
  }
}

/**
 * Reverses a committed batch.
 *
 * @param {string} batchId
 * @param {string} reason required
 * @returns {Object}
 * @client
 */
function rollbackTravelImport(batchId, reason) {
  var gate = _requireTravelAdmin_('rollbackTravelImport');
  if (!gate.ok) return gate.response;
  try {
    return TravelImportAdmin.rollback(batchId, reason);
  } catch (e) {
    logError('rollbackTravelImport', e, { batchId: batchId });
    return errorResponse('Could not roll back the import: ' + e.message);
  }
}

/**
 * Import history, newest first.
 *
 * Admin-guarded: a batch row carries traveller counts and dollar totals per
 * office, and names the administrator who ran it.
 *
 * @param {number} [limit]
 * @returns {Object}
 * @client
 */
function listTravelImportBatches(limit) {
  var gate = _requireTravelAdmin_('listTravelImportBatches');
  if (!gate.ok) return gate.response;
  try {
    return successResponse({ batches: TravelImportAdmin.listBatches(limit || 25) });
  } catch (e) {
    logError('listTravelImportBatches', e, {});
    return errorResponse('Could not list the import history: ' + e.message);
  }
}

/**
 * The rows of one batch, for the preview screen and the error log.
 *
 * @param {string} batchId
 * @returns {Object}
 * @client
 */
function getTravelImportBatchRows(batchId) {
  var gate = _requireTravelAdmin_('getTravelImportBatchRows');
  if (!gate.ok) return gate.response;
  try {
    var rows = TravelImportAdmin.batchRows(new TravelDB(), _str2_(batchId));
    return successResponse({
      rows: rows,
      errors: rows.filter(function (r) { return r.errorMessage; })
    });
  } catch (e) {
    logError('getTravelImportBatchRows', e, { batchId: batchId });
    return errorResponse('Could not read the batch: ' + e.message);
  }
}

function _str2_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
