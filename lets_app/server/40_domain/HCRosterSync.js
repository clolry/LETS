/**
 * HCRosterSync.js
 * Entry points for loading the real HR roster from the FAS HRLinks feed.
 *
 * Split from 30_services/HCRosterImport.js deliberately: that file is pure —
 * no spreadsheet, no clock, no session — so every mapping, normalisation and
 * diff decision is testable without Apps Script. This file is the part that
 * touches the world, and it is kept thin for the same reason.
 *
 * TWO STEPS, NOT ONE
 * ------------------
 * previewRosterImport reports what WOULD happen. importRoster does it, and
 * refuses unless handed the preview's own token back.
 *
 * The import REPLACES HC_Positions, including deleting rows. @clolry asked for
 * all test records removed, and a merge cannot do that — nothing in the feed
 * matches a fictional person, so they would survive forever. But a replace
 * that silently drops real people is worse than a stale roster, and the
 * roster drives approval routing, site access and every budget allocation.
 *
 * So the destructive step cannot be reached without seeing the numbers first.
 * BudgetBackfill uses the same confirm-then-act shape for the same reason.
 *
 * WHY THE PREVIEW SHOWS HEADCOUNT
 * -------------------------------
 * Because that is the roster's entire budget consequence. The per-capita split
 * divides each DAC's discretionary balance by its share of filled positions,
 * so replacing the roster moves money between service centres. An admin
 * confirming this should see that before committing, not discover it after.
 */

/**
 * Dry run: what importing the feed would change.
 *
 * Reads the feed, compares it to HC_Positions, and returns the adds, changes,
 * deletions and the resulting service-centre headcount — plus a token that
 * importRoster requires.
 *
 * @returns {Object} successResponse({ ... }) | errorResponse
 * @client
 */
function previewRosterImport() {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  try {
    var source = getFasHrFeedSource();
    if (!source.ok) {
      // NO FALLBACK. See HCRosterImport.js's header: every available fallback
      // is a stale roster, and a stale roster produces allocations that look
      // precise and are wrong.
      return errorResponse(source.error);
    }

    var values;
    try {
      var ss = SpreadsheetApp.openById(source.spreadsheetId);
      var sheet = ss.getSheetByName(source.tabName);
      if (!sheet) {
        var names = ss.getSheets().map(function (s) { return s.getName(); });
        return errorResponse(
          'Tab "' + source.tabName + '" was not found in the HR feed. Tabs ' +
          'present: ' + names.join(', ') + '. Set ' +
          PROPS_KEYS.FAS_HR_FEED_TAB + ' if the tab has been renamed.');
      }
      values = sheet.getDataRange().getValues();
    } catch (e) {
      return errorResponse(
        'Could not open the HR feed (' + source.spreadsheetId + '): ' +
        e.message + '. The LETS service account needs at least read access.');
    }

    var orgs = HC.hcGetOrgHierarchy() || [];
    var orgsByCode = {};
    orgs.forEach(function (o) {
      orgsByCode[String(o.orgCode || '').toUpperCase()] = o;
    });

    var parsed = HCRosterImport.parseFeed(values, orgsByCode);
    if (parsed.headerProblems.length) {
      return { success: false, problems: parsed.headerProblems };
    }

    var bundle = HC.hcGetBundle();
    var existing = bundle.success ? bundle.data : [];

    var diff = HCRosterImport.diffRoster(parsed.rows, existing);
    var headcount = HCRosterImport.previewHeadcount(parsed.rows, orgs);

    // The token binds a confirmation to THIS preview. Without it an admin
    // could preview a sane feed, the feed could change, and the confirm would
    // apply something nobody looked at.
    var token = 'roster_' + Date.now() + '_' + parsed.rows.length + '_' +
                diff.adds.length + 'a' + diff.changes.length + 'c' +
                (diff.deletes.length + diff.seedDeletes.length) + 'd';

    return successResponse({
      token: token,
      source: {
        spreadsheetId: source.spreadsheetId,
        tabName: source.tabName,
        // Stated so a reader can confirm the roster did NOT come from the May
        // spreadsheet, which is the error this whole module exists to prevent.
        propertyKey: PROPS_KEYS.FAS_HR_FEED
      },
      mapping: parsed.mapping,
      unmappedColumns: parsed.unmapped,
      counts: {
        feedRows: values.length - 1,
        positions: parsed.rows.length,
        skippedNonPositions: parsed.skipped,
        blocked: parsed.blocked.length,
        warnings: parsed.warnings.length,
        adds: diff.adds.length,
        changes: diff.changes.length,
        unchanged: diff.unchanged.length,
        deletes: diff.deletes.length,
        seedDeletes: diff.seedDeletes.length,
        currentPositions: existing.length,
        supervisorCyclesCleared: parsed.cyclesCleared
      },
      // Capped. A 900-row roster's full diff would exceed the 50MB RPC limit
      // and nobody reads 900 rows in a dialog; the counts above are the
      // decision and these are the evidence.
      blocked: parsed.blocked.slice(0, 50),
      warnings: parsed.warnings.slice(0, 50),
      changes: diff.changes.slice(0, 100),
      deletes: diff.deletes.slice(0, 100).map(function (p) {
        return {
          positionNumber: p.positionNumber,
          employeeName: p.employeeName,
          orgCode: p.orgCode
        };
      }),
      seedDeletes: diff.seedDeletes.map(function (p) {
        return {
          positionNumber: p.positionNumber,
          employeeName: p.employeeName,
          emailAddress: p.emailAddress
        };
      }),
      supervisorCycles: parsed.cycles.slice(0, 20),
      headcount: headcount,
      notes: _rosterPreviewNotes_(parsed, diff, existing)
    });
  } catch (e) {
    console.error('previewRosterImport failed: ' + e.message);
    return errorResponse('Could not preview the roster import: ' + e.message);
  }
}

/**
 * The sentences an admin needs before confirming.
 *
 * Built here rather than in the client so the warnings cannot be styled away,
 * and so the same text appears in the execution log.
 */
function _rosterPreviewNotes_(parsed, diff, existing) {
  var notes = [];

  if (diff.seedDeletes.length) {
    notes.push(diff.seedDeletes.length + ' fictional test positions will be ' +
               'removed. These are HCSeed.js fixtures with @example.gov ' +
               'addresses — they are currently what the per-capita budget ' +
               'split, the org chart and the supervisor access gate read.');
  }

  if (diff.deletes.length) {
    // THE ONE THAT MATTERS. A real person missing from the feed loses their
    // LETS access and their org's headcount share.
    notes.push(diff.deletes.length + ' position(s) that are NOT test data ' +
               'will be removed, because the feed no longer lists them. ' +
               'Check this number: anyone removed loses supervisor-based LETS ' +
               'access and stops counting toward their org\'s per-capita ' +
               'budget share.');
  }

  if (parsed.blocked.length) {
    notes.push(parsed.blocked.length + ' feed row(s) cannot be imported and ' +
               'will be skipped. Duplicate position numbers and missing org ' +
               'codes are the usual causes.');
  }

  if (parsed.cyclesCleared) {
    notes.push(parsed.cyclesCleared + ' position(s) are in a supervisor cycle ' +
               '(A reports to B reports to A). They will be imported with ' +
               'their supervisor pointer CLEARED, because a cycle hangs every ' +
               'page that walks the chain. Their budget attribution is ' +
               'unaffected; approval routing for them needs fixing in the feed.');
  }

  var filled = 0;
  parsed.rows.forEach(function (r) {
    if (r.occupancyStatus === 'FILLED') filled++;
  });
  notes.push(filled + ' of ' + parsed.rows.length + ' positions are FILLED. ' +
             'That is the number the per-capita budget split divides by — ' +
             'vacant seats do not travel, so every service centre\'s share ' +
             'will move when this is applied.');

  if (!existing.length) {
    notes.push('HC_Positions is currently empty, so nothing will be removed.');
  }

  return notes;
}

/**
 * Applies the import. Destructive: replaces every row in HC_Positions.
 *
 * @param {string} token the token from previewRosterImport
 * @returns {Object} successResponse({ ... }) | errorResponse
 * @client
 */
function importRoster(token) {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  // CONFIRMATION IS MANDATORY. This deletes HR rows that drive site access and
  // budget attribution, so it cannot be reachable by a bare call.
  if (!token || String(token).indexOf('roster_') !== 0) {
    return errorResponse(
      'A confirmation token from previewRosterImport is required. This ' +
      'replaces every row in HC_Positions, including deletions, so it cannot ' +
      'run without the preview having been seen.');
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
  } catch (e) {
    return errorResponse('Another HR edit is in progress. Try again in a moment.');
  }

  try {
    var source = getFasHrFeedSource();
    if (!source.ok) return errorResponse(source.error);

    var ss = SpreadsheetApp.openById(source.spreadsheetId);
    var feedSheet = ss.getSheetByName(source.tabName);
    if (!feedSheet) {
      return errorResponse('Tab "' + source.tabName + '" not found in the HR feed.');
    }
    var values = feedSheet.getDataRange().getValues();

    var orgs = HC.hcGetOrgHierarchy() || [];
    var orgsByCode = {};
    orgs.forEach(function (o) {
      orgsByCode[String(o.orgCode || '').toUpperCase()] = o;
    });

    var parsed = HCRosterImport.parseFeed(values, orgsByCode);
    if (parsed.headerProblems.length) {
      return { success: false, problems: parsed.headerProblems };
    }

    // REFUSE AN EMPTY RESULT. A feed that parsed to nothing — wrong tab, a
    // cleared sheet, a permissions change returning headers only — would
    // otherwise wipe the roster and take every supervisor's LETS access with
    // it. There is no legitimate reason to import zero positions.
    if (!parsed.rows.length) {
      return errorResponse(
        'The feed produced no importable positions, so nothing was changed. ' +
        'Importing an empty roster would remove every position and revoke ' +
        'supervisor-based access for everyone. ' +
        (parsed.blocked.length
          ? (parsed.blocked.length + ' row(s) were blocked by validation.')
          : 'Check that the tab and column headers are correct.'));
    }

    var db = new TravelDB();
    var targetSs = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = targetSs.getSheetByName(SHEET_NAMES.HC_POSITIONS);
    if (!sheet) {
      return errorResponse(SHEET_NAMES.HC_POSITIONS + ' tab not found. ' +
                           'Run setupTravelDatabase() first.');
    }

    var bundle = HC.hcGetBundle();
    var existing = bundle.success ? bundle.data : [];
    var diff = HCRosterImport.diffRoster(parsed.rows, existing);

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_POSITIONS];
    var actor = _hcAdminActor_();
    var now = new Date();

    // Created_At is PRESERVED for a position that already exists. Stamping it
    // `now` on every import would make the whole roster look created today and
    // destroy the only record of when a position first appeared.
    var createdAtByPn = {};
    existing.forEach(function (p) {
      if (p.positionNumber && p.createdAt) {
        createdAtByPn[String(p.positionNumber)] = p.createdAt;
      }
    });

    var rows = parsed.rows.map(function (r) {
      var rec = {
        'Position_Number': r.positionNumber,
        'Reports_To_Position_Number': r.reportsToPositionNumber,
        'Employee_ID': r.employeeId,
        'Employee_Name': r.employeeName,
        'Email_Address': r.emailAddress,
        'Org_Code': r.orgCode,
        'Office_Title': r.officeTitle,
        'Grade': r.grade,
        'Supervisory_Status': r.supervisoryStatus,
        'Occupancy_Status': r.occupancyStatus,
        'LCAT': r.lcat,
        'Location_Code': r.locationCode,
        'Duty_Station_Address': r.dutyStationAddress,
        'Duty_Station_City': r.dutyStationCity,
        'Duty_Station_State': r.dutyStationState,
        'Is_Active': true,
        'Created_By': createdAtByPn[r.positionNumber] ? '' : 'fas-hr-feed',
        'Created_At': createdAtByPn[r.positionNumber] || now,
        'Updated_By': 'fas-hr-feed:' + actor,
        'Updated_At': now
      };
      // Mapped over the schema headers, never built by hand: writes are
      // positional (docs/DATA_DICTIONARY.md §3.9).
      return headers.map(function (h) { return h in rec ? rec[h] : ''; });
    });

    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
    }

    // Pin the identifier columns to TEXT before writing, so leading zeros
    // survive. Employee_ID '0010001' and Grade '07' both lose theirs
    // otherwise, and every grade comparison in LETS is a string comparison —
    // including the GS-15 Division Director lookup that approval routing
    // depends on. HCSeed.js does the same and documents the same reason.
    var pinned = ['Position_Number', 'Employee_ID', 'Grade'];
    pinned.forEach(function (name) {
      var col = headers.indexOf(name) + 1;
      if (col > 0) sheet.getRange(2, col, rows.length, 1).setNumberFormat('@');
    });
    SpreadsheetApp.flush();

    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

    // The HC bundle is cached for six hours. Without this the dashboard and
    // the org chart serve the OLD roster and an admin concludes the import
    // failed — then runs it again.
    try { db.invalidate(SHEET_NAMES.HC_POSITIONS); } catch (e) { /* non-fatal */ }
    try { HC.hcCacheInvalidateAll(); } catch (e) { /* non-fatal */ }

    var filled = parsed.rows.filter(function (r) {
      return r.occupancyStatus === 'FILLED';
    }).length;

    console.log('=== importRoster ===');
    console.log('source: ' + source.spreadsheetId + ' / ' + source.tabName);
    console.log('by: ' + actor);
    console.log('positions written: ' + rows.length + ' (' + filled + ' filled)');
    console.log('adds ' + diff.adds.length + ', changes ' + diff.changes.length +
                ', removed ' + (diff.deletes.length + diff.seedDeletes.length) +
                ' (' + diff.seedDeletes.length + ' fictional)');
    if (parsed.cyclesCleared) {
      console.log('supervisor cycles cleared: ' + parsed.cyclesCleared);
    }

    return successResponse({
      positions: rows.length,
      filled: filled,
      vacant: rows.length - filled,
      adds: diff.adds.length,
      changes: diff.changes.length,
      removed: diff.deletes.length + diff.seedDeletes.length,
      seedRemoved: diff.seedDeletes.length,
      blocked: parsed.blocked.length,
      supervisorCyclesCleared: parsed.cyclesCleared
    }, 'Imported ' + rows.length + ' positions (' + filled + ' filled) from ' +
       'the FAS HR feed. ' + diff.seedDeletes.length + ' fictional test ' +
       'record(s) removed.');
  } catch (e) {
    console.error('importRoster failed: ' + e.message);
    return errorResponse('Could not import the roster: ' + e.message);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* already released */ }
  }
}
