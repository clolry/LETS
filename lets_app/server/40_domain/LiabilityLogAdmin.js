/**
 * LiabilityLogAdmin.js
 * The entry point for @clolry's FY27 travel log.
 *
 * WHAT THIS IS, AND WHY IT IS SEPARATE FROM THE OTHER IMPORTER
 * ------------------------------------------------------------
 * @clolry: "I'm getting an error when I try to import existing travel… gotta
 * use column M as estimate, r as actual cost, s as approved date,
 * officesymbol is column c."
 *
 * The error he got was correct, from the wrong importer. TravelImportAdmin
 * reads a two-tab Go.gov export — one tab of requests carrying an estimate,
 * one of expense reports carrying claimed and approved amounts — and refused
 * his workbook because it has neither tab.
 *
 * HIS FILE IS A DIFFERENT SHAPE: one row per trip, with the estimate in
 * column M and the actual in column R. That is not a mapping difference, it
 * is a different record model, and the two must not be merged. The Go.gov
 * split exists because the fiscal year comes from a different date on each
 * tab — a request from its start date, an expense from its report end date —
 * and one row carrying both cannot express the case TravelImport.js:665
 * records, where Udaya Patnaik's commitment is FY26 and his actual is FY27.
 *
 * 30_services/LiabilityLogSync.js already parses this exact sheet, down to
 * the leading space in ' Authorization Submitted'. It decides fiscal years,
 * resolves blank org codes against the roster, and plans inserts against
 * updates. It had NO CALLER — nothing read the sheet or wrote the result,
 * which is why the import attempt fell through to the other importer. This
 * file is that caller and nothing more; every rule stays in the service.
 *
 * THE FISCAL YEAR COMES FROM COLUMN S
 * -----------------------------------
 * @clolry: "Column S is the date we need to use as the effective date for the
 * fiscal year of the travel."
 *
 * Confirmed against his own sample row before writing any of this. Calhoun
 * submitted his voucher 2026-09-30 and it was approved 2026-10-01:
 *
 *   by travel start date   FY21  (a typo, since corrected in the sheet)
 *   by travel end date     FY26
 *   by voucher submitted   FY26
 *   by voucher APPROVED    FY27   <- the rule
 *
 * Calhoun is one of three rows that separate the submitted rule from the
 * approved rule. Under any other date he is FY26, drops out of the FY27
 * dashboard, and takes $1,563.83 of real spend with him.
 *
 * A ROW WITH NO APPROVED VOUCHER IS IMPORTED AND LABELED, not withheld. Its
 * fiscal year comes from the travel end date and is marked
 * PROVISIONAL_NOT_YET_APPROVED. Because this is re-runnable, such a trip
 * MOVES to its real year the morning after its voucher is approved — a
 * one-shot import would freeze the guess.
 *
 * THE KEY IS WRITTEN BACK INTO THE SOURCE SHEET
 * ---------------------------------------------
 * @clolry approved this. The log's own Document Number column is empty on 29
 * of 30 rows (its single value is the word "Cancelled"), so it cannot
 * identify a row.
 *
 * A content hash was the alternative and is worse: hash surname + start date
 * + cost, and correcting a typo in any of them produces a new key, so the
 * next run sees a new trip, imports it, and the old one stays — a DAC
 * double-charged BY A CORRECTION. A written-back key survives every edit to
 * every other column, which is the entire point.
 *
 * So on first sight of a row this writes LETS_Key into a column of that name,
 * creating the column if absent, and reads it thereafter.
 *
 * PREVIEW THEN COMMIT, ON A TOKEN
 * -------------------------------
 * Same shape as the roster importer, for the same reason: this writes money
 * figures into the budget, and @clolry has twice caught a defect by reading a
 * preview. The token binds a commit to the preview that produced it, so the
 * sheet cannot change between looking and applying.
 */

var LiabilityLogAdmin = (function () {

  function _str_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
  function _round2_(v) { return Math.round((Number(v) || 0) * 100) / 100; }

  /** Property key for the one-shot token. */
  var TOKEN_PROP = 'LIABILITY_LOG_IMPORT_TOKEN';

  /**
   * Reads the log sheet, parses it, and plans what an import would do.
   *
   * @param {Object} [opts] { fiscalYear } — defaults to the configured FY
   * @returns {Object}
   */
  function buildPlan(opts) {
    var o = opts || {};
    var out = {
      ok: false, problems: [], source: null,
      trips: [], plan: null, fiscalYear: '', skipped: 0,
      outOfFiscalYear: [], keyColumn: -1, columnCount: 0
    };

    var source = getLiabilityLogSource();
    if (!source.ok) { out.problems.push(source.error); return out; }
    out.source = { spreadsheetId: source.spreadsheetId, tabName: source.tabName };

    var ss, sheet;
    try {
      ss = SpreadsheetApp.openById(source.spreadsheetId);
    } catch (e) {
      out.problems.push('Could not open the log spreadsheet: ' + e.message +
                        ' — check LIABILITY_LOG_SHEET_ID and that this ' +
                        'account has edit access. EDIT, not view: the key ' +
                        'write-back needs it.');
      return out;
    }

    sheet = ss.getSheetByName(source.tabName);
    if (!sheet) {
      var names = ss.getSheets().map(function (s) { return '"' + s.getName() + '"'; });
      out.problems.push('Tab "' + source.tabName + '" was not found. Tabs ' +
                        'present: ' + names.join(', ') + '. Set the Script ' +
                        'Property LIABILITY_LOG_TAB to one of those, copied ' +
                        'exactly.');
      return out;
    }

    if (sheet.getLastRow() < 2) {
      out.problems.push('Tab "' + source.tabName + '" has no data rows.');
      return out;
    }

    // THE WHOLE USED RANGE, header row first. The log is ~409 rows of which
    // about 30 carry data, so reading it all is cheap and parseSheet
    // discards the spacers.
    var values = sheet.getRange(1, 1, sheet.getLastRow(),
                                sheet.getLastColumn()).getValues();

    // The roster, for the blank-org fallback. @clolry asked why Melissa Mould
    // showed as unattributed; her Organization cell is simply empty, and the
    // roster knows where she sits.
    var positions = [];
    try {
      var bundle = HC.hcGetBundle();
      if (bundle && bundle.success) positions = bundle.data;
    } catch (e) {
      out.problems.push('Could not read HC_Positions, so a row with a blank ' +
                        'Organization cannot be attributed: ' + e.message);
    }

    var parsed = LiabilityLogSync.parseSheet(values, positions);
    out.keyColumn = parsed.keyColumn;
    out.columnCount = parsed.columnCount;
    out.skipped = parsed.skipped;

    if (parsed.headerProblems.length) {
      out.problems = out.problems.concat(parsed.headerProblems);
      return out;
    }

    // WHICH FISCAL YEAR THIS IMPORT IS FOR.
    //
    // Filtered rather than imported-and-ignored, because the budget dashboard
    // does NOT filter by fiscal year — it reads every Requests row and
    // buckets on Status. A FY26 trip imported here would appear in the FY27
    // dashboard as current-year spend, which is the same class of error as
    // the backfill guard in BudgetBackfill.js:163.
    var fy = _str_(o.fiscalYear) ||
             ((typeof LETS_CONFIG !== 'undefined' && LETS_CONFIG.fiscalYear) || '');
    out.fiscalYear = fy;

    var inYear = [];
    parsed.trips.forEach(function (t) {
      if (fy && t.fiscalYear && t.fiscalYear !== fy) {
        out.outOfFiscalYear.push(t);
        return;
      }
      inYear.push(t);
    });
    out.trips = inYear;

    // What is already in LETS from a previous run, keyed on the written-back
    // LETS_Key. Gogov_Request_ID is the source-identity column every importer
    // uses for this, so a key lands there and the next run recognizes it.
    var existing = {};
    try {
      var db = new TravelDB();
      var data = db.readSheet(SHEET_NAMES.REQUESTS);
      if (data && data.headers.length) {
        var ix = data.headerIndex;
        var cKey = ('Gogov_Request_ID' in ix) ? ix['Gogov_Request_ID'] : -1;
        var cReq = ('Request_ID' in ix) ? ix['Request_ID'] : -1;
        if (cKey > -1 && cReq > -1) {
          data.rows.forEach(function (row, i) {
            var k = _str_(row[cKey]);
            if (!k || k.indexOf('LLOG-') !== 0) return;
            existing[k] = {
              requestId: _str_(row[cReq]),
              sheetRow: i + 2,
              estimatedCost: ('Grand_Total' in ix) ? row[ix['Grand_Total']] : '',
              actualCost: ('Actual_Total' in ix) ? row[ix['Actual_Total']] : '',
              status: ('Status' in ix) ? _str_(row[ix['Status']]) : '',
              fiscalYear: '',
              orgCode: ('Owning_Org_Code' in ix) ? _str_(row[ix['Owning_Org_Code']]) : ''
            };
          });
        }
      }
    } catch (e) {
      out.problems.push('Could not read the Requests tab, so this cannot tell ' +
                        'an insert from an update and will not run: ' + e.message);
      return out;
    }

    out.plan = LiabilityLogSync.planChanges(inYear, existing);
    out.ok = true;
    return out;
  }

  /** Renders a plan for a human. Returns an array of lines. */
  function report(p) {
    var L = [];
    L.push('=== previewLiabilityLogImport — NOTHING HAS BEEN WRITTEN ===');
    if (p.source) {
      L.push('source: "' + p.source.tabName + '" tab of ' + p.source.spreadsheetId);
    }
    L.push('');

    if (!p.ok) {
      L.push('CANNOT RUN');
      p.problems.forEach(function (x) { L.push('  ' + x); });
      return L;
    }

    var plan = p.plan;
    L.push('FISCAL YEAR ' + (p.fiscalYear || '(not configured)'));
    L.push('  The year comes from column S, Voucher Approved — @clolry: "the');
    L.push('  date that their expense report is approved". A row with no');
    L.push('  approved voucher is imported with a PROVISIONAL year taken from');
    L.push('  the travel end date, and corrects itself on a later run.');
    L.push('');

    L.push('COUNTS');
    L.push('  data rows found        ' + (p.trips.length + p.outOfFiscalYear.length));
    L.push('  skipped, not a trip    ' + p.skipped);
    L.push('  outside ' + (p.fiscalYear || 'FY') + '              ' + p.outOfFiscalYear.length);
    L.push('  -> in scope            ' + p.trips.length);
    L.push('');

    L.push('WHAT THIS WOULD WRITE TO Requests');
    L.push('  create                 ' + plan.inserts.length);
    L.push('  update                 ' + plan.updates.length);
    L.push('  unchanged              ' + plan.unchanged.length);
    L.push('  BLOCKED                ' + plan.blocked.length +
           (plan.blocked.length ? '   <-- these import nothing' : ''));
    L.push('');

    // THE MONEY, both figures. @clolry: "Please keep the estimates and the
    // actuals - we want to see a history of both."
    var estTotal = 0, actTotal = 0, withActual = 0, provisional = 0;
    p.trips.forEach(function (t) {
      if (t.estimatedCost !== null) estTotal += t.estimatedCost;
      if (t.actualCost !== null) { actTotal += t.actualCost; withActual++; }
      if (t.fiscalYearBasis === 'PROVISIONAL_NOT_YET_APPROVED') provisional++;
    });
    L.push('MONEY');
    L.push('  estimates (column M)   $' + _round2_(estTotal).toFixed(2));
    L.push('  actuals (column R)     $' + _round2_(actTotal).toFixed(2) +
           '   on ' + withActual + ' of ' + p.trips.length + ' trips');
    L.push('  variance               $' + _round2_(actTotal - estTotal).toFixed(2));
    L.push('  Column L is NOT read. @clolry directed column M; the two');
    L.push('  disagree across the sheet and reading the wrong one would');
    L.push('  misstate every commitment.');
    L.push('');

    if (provisional) {
      L.push('  ' + provisional + ' trip(s) have no approved voucher yet, so their');
      L.push('  fiscal year is provisional. Re-run after approval and they');
      L.push('  move to their real year by themselves.');
      L.push('');
    }

    // WHERE THE MONEY LANDS. A per-DAC breakdown, because that is the number
    // somebody checks the import against.
    var byOrg = {};
    p.trips.forEach(function (t) {
      var k = t.officeCode || t.orgCode || '(unattributed)';
      if (!byOrg[k]) byOrg[k] = { trips: 0, est: 0, act: 0 };
      byOrg[k].trips++;
      if (t.estimatedCost !== null) byOrg[k].est += t.estimatedCost;
      if (t.actualCost !== null) byOrg[k].act += t.actualCost;
    });
    L.push('BY OFFICE');
    L.push('  office      trips     estimate       actual');
    Object.keys(byOrg).sort().forEach(function (k) {
      var r = byOrg[k];
      L.push('  ' + k.padEnd(12) + String(r.trips).padStart(5) +
             ('$' + _round2_(r.est).toFixed(2)).padStart(14) +
             ('$' + _round2_(r.act).toFixed(2)).padStart(13));
    });
    L.push('');

    // ORG ATTRIBUTION, and how each row got its org. A row attributed from
    // the roster rather than the sheet is correct and worth seeing, because
    // it means the sheet's Organization cell is blank.
    var fromRoster = p.trips.filter(function (t) {
      return t.orgCodeSource === 'ROSTER';
    });
    if (fromRoster.length) {
      L.push('ORG CODE TAKEN FROM THE HR ROSTER (' + fromRoster.length + ')');
      L.push('  The sheet\'s Organization cell is blank on these rows. The');
      L.push('  roster is the authority on where somebody sits, so this is a');
      L.push('  correct attribution rather than a guess — but the sheet is');
      L.push('  worth fixing.');
      fromRoster.slice(0, 10).forEach(function (t) {
        L.push('    row ' + t.sheetRow + '  ' + t.travelerName + ' -> ' + t.orgCode);
      });
      L.push('');
    }

    if (plan.blocked.length) {
      L.push('BLOCKED — these import nothing and need a fix in the sheet');
      plan.blocked.forEach(function (t) {
        L.push('  row ' + t.sheetRow + '  ' + t.travelerName);
        t.problems.forEach(function (x) { L.push('      ' + x); });
      });
      L.push('');
    }

    var warned = p.trips.filter(function (t) { return t.warnings.length; });
    if (warned.length) {
      L.push('WARNINGS (' + warned.length + ') — these DO import');
      warned.slice(0, 20).forEach(function (t) {
        L.push('  row ' + t.sheetRow + '  ' + t.travelerName);
        t.warnings.forEach(function (x) { L.push('      ' + x); });
      });
      L.push('');
    }

    if (plan.updates.length) {
      L.push('UPDATES — what changed since the last run');
      plan.updates.slice(0, 20).forEach(function (u) {
        L.push('  ' + u.requestId + '  ' + u.trip.travelerName);
        u.changes.forEach(function (c) { L.push('      ' + c); });
      });
      L.push('');
    }

    // THE KEY WRITE-BACK, stated plainly because it modifies @clolry's sheet.
    // p.keyColumn is a 0-BASED index; a human reads 1-based column numbers.
    if (p.keyColumn > -1) {
      L.push('The source sheet already has a LETS_Key column (column ' +
             (p.keyColumn + 1) + ').');
    } else {
      L.push('THIS WILL ADD A "LETS_Key" COLUMN to the source sheet, at');
      L.push('column ' + (p.columnCount + 1) + '. @clolry approved this. The log\'s own');
      L.push('Document Number is empty on 29 of 30 rows, so it cannot');
      L.push('identify a row — and a content hash would double-charge a DAC');
      L.push('whenever somebody corrected a typo.');
    }
    return L;
  }

  /**
   * Applies a plan. Creates and updates Requests rows, writes keys back.
   *
   * @param {Object} p a plan from buildPlan
   * @param {Object} actor { name, email }
   * @returns {Object}
   */
  function apply(p, actor) {
    var db = new TravelDB();
    var now = new Date();
    var reqSheet = db.sheet(SHEET_NAMES.REQUESTS);
    if (!reqSheet) {
      return errorResponse(SHEET_NAMES.REQUESTS + ' tab not found. Run ' +
                           'setupTravelDatabase() first.');
    }
    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.REQUESTS];

    // THE TRAVELER ROW IS NOT OPTIONAL. @clolry: "none of the planned or
    // actual costs are being applied to the service center allocations and
    // spend table."
    //
    // BudgetDashboard.spendByServiceCenter reads Request_Travelers and ONLY
    // that sheet — a request carries one Owning_Office, but a consolidated
    // conference request holds travelers from several DACs, so per-center
    // spend has to come from the traveler rows. Writing a Requests row and no
    // traveler row makes a trip invisible to the per-center table by
    // construction: not a display bug, nothing to read.
    //
    // BudgetBackfill.js:451 already does this. Neither importer did.
    var travSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);
    var travHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.REQUEST_TRAVELERS];
    if (!travSheet) {
      return errorResponse(SHEET_NAMES.REQUEST_TRAVELERS + ' tab not found. ' +
        'Run setupTravelDatabase() first — without it the import would write ' +
        'trips that never appear in the per-service-center table.');
    }

    // The source sheet, for the key write-back.
    var source = getLiabilityLogSource();
    var ss = SpreadsheetApp.openById(source.spreadsheetId);
    var logSheet = ss.getSheetByName(source.tabName);

    // ENSURE THE KEY COLUMN EXISTS, before anything else. If this fails the
    // import must not proceed: rows would be created with no durable
    // identity and the next run would create them all again.
    //
    // p.keyColumn IS A 0-BASED INDEX, from mapColumns' row.indexOf — and
    // getRange wants 1-based. -1 means the column is absent. Conflating the
    // two is how a write lands one column to the left of where it was meant
    // to, which here would overwrite NOTES on every keyed row.
    var keyCol = (p.keyColumn > -1) ? (p.keyColumn + 1) : -1;
    if (keyCol < 1) {
      try {
        keyCol = p.columnCount + 1;
        logSheet.getRange(1, keyCol).setValue(LiabilityLogSync.KEY_HEADER);
        SpreadsheetApp.flush();
      } catch (e) {
        return errorResponse('Could not add a ' + LiabilityLogSync.KEY_HEADER +
          ' column to the log sheet: ' + e.message + '. This account needs ' +
          'EDIT access to it. The import did not run — without a durable key ' +
          'every row would be re-created on the next run.');
      }
    }

    var nextSeq = _nextLogSeq_(db, now);
    var seqUsed = 0;
    var newRows = [];
    var travRows = [];
    var keyWrites = [];     // { row, key }
    var updates = [];       // { sheetRow, changes }
    var created = [];

    /**
     * The one traveler row for a trip.
     *
     * ONE TRAVELER PER TRIP. @clolry: "The trips are one traveler each." So
     * the subtotal is the whole trip estimate and there is no split to make —
     * BudgetBackfill divides evenly across names because its source carries
     * several, and this source does not.
     *
     * THE SUBTOTAL IS THE ESTIMATE, not the actual. spendByServiceCenter
     * scales it by the request's Actual_Total/Grand_Total ratio for completed
     * trips, so putting the actual here would double-apply the
     * reconciliation. The estimate is also what a committed trip should show.
     */
    function travelerRecord(t, requestId, office) {
      var rec = {
        'Request_ID': requestId,
        'Traveler_ID': requestId + '-T1',
        'Employee_Name': t.travelerName,
        'Org_Code': t.orgCode,
        'Subtotal': t.estimatedCost === null ? 0 : t.estimatedCost,
        'Budget_Org_Code': t.orgCode,
        'Budget_Office_Code': office,
        'Duty_Location': [t.fromCity, t.toCity].filter(Boolean).join(' to '),
        'Role_Justification': 'Imported from the FY27 travel log, row ' +
          t.sheetRow + '. One traveler per trip, so the subtotal is the whole ' +
          'trip estimate rather than a split.'
      };
      return travHeaders.map(function (h) { return h in rec ? rec[h] : ''; });
    }

    function tripRecord(t, requestId, key) {
      var estimate = t.estimatedCost === null ? 0 : t.estimatedCost;

      // THE BUDGET OFFICE, RESOLVED HERE RATHER THAN TRUSTED.
      //
      // interpretRow sets officeCode through a `typeof BudgetBackfill !==
      // 'undefined'` guard, so it is '' whenever that module has not loaded.
      // In Apps Script both are globals and it resolves — but a blank
      // Owning_Office means the trip counts against no DAC, and the one thing
      // worse than a wrong attribution is a silent zero.
      //
      // The dashboard does fall back to Owning_Org_Code (BudgetDashboard.js:917),
      // so this is belt and braces rather than the only line of defense. It is
      // here because writing the field is cheaper than relying on every future
      // reader to re-derive it.
      var office = t.officeCode;
      if (!office && typeof BudgetBackfill !== 'undefined' &&
          BudgetBackfill.officeForOrgCode) {
        office = BudgetBackfill.officeForOrgCode(t.orgCode);
      }
      return {
        'Request_ID': requestId,
        'Status': t.status,
        'Trip_Name': LiabilityLogSync.tripNameFor(t),
        'Location_Type': 'CONUS',
        'Event_Start_Date': t.startDate,
        'Event_End_Date': t.endDate,
        'BLUF': '',
        'Purpose': t.purpose,
        'Shared_Total': 0,
        // THE ESTIMATE IS THE COMMITMENT, from column M. The actual goes to
        // Actual_Total, never over the top of this — @clolry: "Please keep
        // the estimates and the actuals - we want to see a history of both."
        // Five rows came in OVER their estimate; overwriting would erase the
        // only evidence of that.
        'Traveler_Total': estimate,
        'Grand_Total': estimate,
        'Traveler_Count': 1,
        'Leg_Count': 0,
        'Submitter_Name': t.travelerName,
        'Submitter_Email': '',
        'Submitter_Org_Code': t.orgCode,
        // Reviewer fields stay EMPTY. A name here would put historical travel
        // on somebody's pending queue and record an approval that never
        // happened in LETS. Same decision as BudgetBackfill and the Go.gov
        // importer.
        'Current_Reviewer_Name': '',
        'Current_Reviewer_Email': '',
        'Initial_Review_Level': '',
        'Created_At': now,
        'Updated_At': now,
        // The date the TRAVEL was authorized, not when it was imported.
        // Reports group on this, and stamping it `now` would file September
        // travel under whatever month the import ran.
        'Submitted_At': t.authSubmitted || t.startDate || now,
        'Version': 1,
        'Owning_Office': office,
        'Owning_Org_Code': t.orgCode,
        'Travel_Purpose': t.travelType,
        'Travel_Purpose_Label': t.travelType,
        'Is_Event_Plan_Item': false,
        // MARKED, like every backfilled row. A figure that entered the budget
        // without review must be identifiable afterward, or the audit trail
        // implies an approval that never happened.
        'Primary_Justification': 'IMPORT: travel log row ' + t.sheetRow +
          ', fiscal year ' + t.fiscalYear + ' on basis ' + t.fiscalYearBasis +
          ', imported by ' + actor.name + ' on ' +
          Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        'Traveler_Org_Codes': t.orgCode,
        // THE DURABLE IDENTITY. Written back into the source sheet too, so
        // the next run updates rather than duplicates.
        'Gogov_Request_ID': key,
        'Gogov_Report_Name': LiabilityLogSync.tripNameFor(t),
        // THE ACTUAL, from column R, where there is one.
        'Actual_Total': t.actualCost === null ? '' : t.actualCost,
        'Actual_Source': t.actualCost === null ? '' : 'liability-log',
        'Actual_Posted_At': t.actualCost === null ? '' : now,
        'Actual_Posted_By': t.actualCost === null ? '' : actor.email,
        'Reconciliation_Status': t.actualCost === null ? 'UNRECONCILED' : 'MATCHED',
        'Match_Method': t.actualCost === null ? '' : 'liability-log',
        'Reconciliation_Notes': t.notes
      };
    }

    p.plan.inserts.forEach(function (t) {
      var requestId = 'REQ-' + _fyTag_(t.fiscalYear) + '-' +
                      String(nextSeq + seqUsed).padStart(4, '0');
      seqUsed++;
      var key = 'LLOG-' + t.sheetRow + '-' + now.getTime() + '-' + seqUsed;
      var rec = tripRecord(t, requestId, key);
      newRows.push(headers.map(function (h) { return h in rec ? rec[h] : ''; }));
      travRows.push(travelerRecord(t, requestId, rec['Owning_Office']));
      keyWrites.push({ row: t.sheetRow, key: key });
      created.push({
        requestId: requestId, row: t.sheetRow, traveler: t.travelerName,
        org: t.orgCode, office: t.officeCode,
        estimate: t.estimatedCost, actual: t.actualCost,
        fiscalYear: t.fiscalYear, basis: t.fiscalYearBasis
      });
    });

    p.plan.updates.forEach(function (u) {
      var t = u.trip;
      var uOffice = t.officeCode;
      if (!uOffice && typeof BudgetBackfill !== 'undefined' &&
          BudgetBackfill.officeForOrgCode) {
        uOffice = BudgetBackfill.officeForOrgCode(t.orgCode);
      }
      var changes = {
        'Grand_Total': t.estimatedCost === null ? 0 : t.estimatedCost,
        'Traveler_Total': t.estimatedCost === null ? 0 : t.estimatedCost,
        'Status': t.status,
        'Owning_Office': uOffice,
        'Owning_Org_Code': t.orgCode,
        'Traveler_Org_Codes': t.orgCode,
        'Updated_At': now
      };
      if (t.actualCost !== null) {
        changes['Actual_Total'] = t.actualCost;
        changes['Actual_Source'] = 'liability-log';
        changes['Actual_Posted_At'] = now;
        changes['Actual_Posted_By'] = actor.email;
        changes['Reconciliation_Status'] = 'MATCHED';
        changes['Match_Method'] = 'liability-log';
      }
      updates.push({ requestId: u.requestId, changes: changes,
                     changeList: u.changes });
    });

    // WRITE THE REQUESTS ROWS FIRST, then the keys.
    //
    // THE ORDER MATTERS AND THIS IS THE SAFE DIRECTION. If the key write-back
    // fails after the rows land, the next run sees no key, treats them as new
    // and DUPLICATES them — visible, and fixable by deleting rows. If the
    // keys were written first and the rows failed, the sheet would claim
    // every trip was imported when none was, and the next run would import
    // nothing. A visible duplicate beats an invisible gap.
    if (newRows.length) {
      reqSheet.getRange(reqSheet.getLastRow() + 1, 1, newRows.length,
                        headers.length).setValues(newRows);
    }
    // THE TRAVELER ROWS, in the same execution. A Requests row without its
    // traveler row is a trip the per-service-center table cannot see, so a
    // failure between the two writes is worse than a failure before either.
    // One setValues, not appendRow in a loop — appendRow is slow and reads
    // getLastRow every call.
    if (travRows.length) {
      travSheet.getRange(travSheet.getLastRow() + 1, 1, travRows.length,
                         travHeaders.length).setValues(travRows);
    }

    var keysWritten = 0;
    var keyFailures = [];
    keyWrites.forEach(function (k) {
      try {
        logSheet.getRange(k.row, keyCol).setValue(k.key);
        keysWritten++;
      } catch (e) {
        keyFailures.push('row ' + k.row + ': ' + e.message);
      }
    });

    updates.forEach(function (u) {
      try {
        var hit = db.findRow(SHEET_NAMES.REQUESTS, 'Request_ID', u.requestId);
        if (hit) db.updateRowByIndex(SHEET_NAMES.REQUESTS, hit.rowNum, u.changes);
      } catch (e) {
        console.error('LiabilityLogAdmin: update ' + u.requestId + ': ' + e.message);
      }
    });

    // BOTH sheets. The per-center table reads Request_Travelers, so leaving
    // its cache stale would show the old figures for up to ten minutes and
    // look exactly like the import having failed.
    [SHEET_NAMES.REQUESTS, SHEET_NAMES.REQUEST_TRAVELERS].forEach(function (n) {
      try { db.invalidate(n); } catch (e) { /* cache only */ }
    });

    return successResponse({
      created: created.length,
      travelerRows: travRows.length,
      updated: updates.length,
      unchanged: p.plan.unchanged.length,
      blocked: p.plan.blocked.length,
      keysWritten: keysWritten,
      keyFailures: keyFailures,
      keyColumn: keyCol,
      fiscalYear: p.fiscalYear,
      rows: created
    }, 'Imported ' + created.length + ' trip(s) and updated ' + updates.length +
       '. ' + keysWritten + ' key(s) written back to the log sheet.' +
       (keyFailures.length
         ? ' ' + keyFailures.length + ' key write(s) FAILED — those rows will ' +
           'be re-imported as duplicates on the next run until fixed.'
         : ''));
  }

  /** REQ-FY27-nnnn, so an imported ID reads like a LETS one. */
  function _fyTag_(fy) {
    var m = String(fy || '').match(/(\d{2})$/);
    return m ? ('FY' + m[1]) : 'FY00';
  }

  /**
   * The next sequence number, read once.
   *
   * NOT generateRequestId PER ROW: that function reads the sheet for the
   * highest existing number, and nothing is written until the end, so every
   * call in a loop returns the same ID. TravelImportAdmin records the same
   * trap.
   */
  function _nextLogSeq_(db, now) {
    var max = 0;
    try {
      var data = db.readSheet(SHEET_NAMES.REQUESTS);
      if (!data || !data.headers.length) return 1;
      var c = data.headerIndex['Request_ID'];
      if (c === undefined) return 1;
      data.rows.forEach(function (row) {
        var m = String(row[c] || '').match(/-(\d{4})$/);
        if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
      });
    } catch (e) { /* an empty sheet starts at 1 */ }
    return max + 1;
  }

  return {
    buildPlan: buildPlan,
    report: report,
    apply: apply,
    TOKEN_PROP: TOKEN_PROP,
    _fyTag_: _fyTag_
  };
})();

/**
 * Dry run: what importing @clolry's FY27 travel log would do.
 *
 * WRITES NOTHING. Prints the plan and returns a token the commit needs.
 *
 * @returns {Object}
 * @editor  Run this from the editor before importing. Admin-only either way.
 */
function previewLiabilityLogImport() {
  var gate = _liabilityLogGuard_();
  if (gate) return gate;

  var p = LiabilityLogAdmin.buildPlan();
  LiabilityLogAdmin.report(p).forEach(function (line) { console.log(line); });

  if (!p.ok) return { success: false, problems: p.problems };

  // A ONE-SHOT TOKEN, bound to what the preview actually saw. Same reasoning
  // as the roster importer: this writes money into the budget, and a commit
  // that is not tied to a preview means somebody can apply a plan they never
  // read.
  var token = 'llog_' + Date.now() + '_' + p.trips.length + '_' +
              p.plan.inserts.length + 'i' + p.plan.updates.length + 'u';
  PropertiesService.getScriptProperties()
    .setProperty(LiabilityLogAdmin.TOKEN_PROP, token);

  console.log('');
  console.log('To apply, call importLiabilityLog with this token:');
  console.log('  ' + token);

  return {
    success: true, token: token,
    inserts: p.plan.inserts.length, updates: p.plan.updates.length,
    unchanged: p.plan.unchanged.length, blocked: p.plan.blocked.length,
    outOfFiscalYear: p.outOfFiscalYear.length, fiscalYear: p.fiscalYear
  };
}

/**
 * Applies the import. WRITES to Requests and to the source sheet.
 *
 * @param {string} token from previewLiabilityLogImport
 * @returns {Object}
 * @server
 */
function importLiabilityLog(token) {
  var gate = _liabilityLogGuard_();
  if (gate) return gate;

  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty(LiabilityLogAdmin.TOKEN_PROP);
  if (!expected || !token || String(token).trim() !== expected) {
    return errorResponse('That token is not the current one. Run ' +
      'previewLiabilityLogImport() and use the token it prints. The token ' +
      'exists so a commit cannot apply a plan nobody read.');
  }
  // CONSUMED IMMEDIATELY, before any write. A token that survives its use
  // invites a second commit that would duplicate every insert.
  props.deleteProperty(LiabilityLogAdmin.TOKEN_PROP);

  var p = LiabilityLogAdmin.buildPlan();
  if (!p.ok) {
    return errorResponse('The log cannot be read now even though the preview ' +
      'succeeded: ' + p.problems.join(' '));
  }

  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) { /* guarded above */ }
  var result = LiabilityLogAdmin.apply(p, { name: email || 'an administrator',
                                            email: email });

  console.log('=== importLiabilityLog ===');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Admin gate. Returns null when authorized, or an error result. */
function _liabilityLogGuard_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return { success: false, error: 'Could not determine the active user.' };
  }
  if (!email) {
    return { success: false, error: 'No active user. This needs a signed-in administrator.' };
  }
  if (typeof isTravelAdmin !== 'function' || !isTravelAdmin(email)) {
    console.warn('LiabilityLogAdmin: refused non-admin caller ' + email);
    return { success: false, error: 'Administrator access is required.' };
  }
  return null;
}
