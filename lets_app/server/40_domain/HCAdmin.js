/**
 * HCAdmin.js
 * Server functions for the HC roster editor.
 *
 * WHY THIS EXISTS
 * ---------------
 * HC_Positions and HC_Orgs are currently hand-edited in the spreadsheet. That
 * is how three specific defects get introduced, all of which fail SILENTLY:
 *
 *   1. Supervisory_Status typed as a number. Access.js:134 compares
 *      String(p.supervisoryStatus) !== '2', and HCData normalizes at the read
 *      boundary — but a sheet edit that makes the column numeric defeats the
 *      zero-padding logic for Grade in the same row.
 *   2. Grade losing its leading zero. A cell holding 07 becomes the number 7,
 *      and String(7) !== '07', so a GS-07 fails every grade comparison in the
 *      system. docs/GAP_CONSOLIDATION_PASS6.md VT-03 predicted exactly this.
 *   3. A supervisor cycle. A reports to B, B reports to A. Without the
 *      visited-set in hcWalkSupervisorChain that is an infinite loop inside a
 *      web request — a hung page rather than an error.
 *
 * Every write here validates against all three before touching the sheet, and
 * refuses the whole write rather than applying a partial one.
 *
 * AUTHORIZATION
 * -------------
 * Every function checks isTravelAdmin() FIRST. Apps Script makes every
 * top-level function browser-callable (docs/GAP_REGISTER.md G-001), so a
 * guard inside the function is the only real protection — the admin page's own
 * gate protects the page, not these entry points.
 *
 * This is the first write surface in the project to be guarded that way. The
 * trigger installers and FAS test functions are not, which is noted as
 * outstanding work rather than fixed here.
 *
 * CACHE INVALIDATION
 * ------------------
 * Every successful write calls HC.hcCacheInvalidateAll(). The bundle caches for
 * CACHE_CONFIG.TTL.LONG — six hours — so without it an edit is invisible for
 * long enough to look like the save failed. @clolry hit that with the airport
 * preference cache and again waiting for new HC rows to appear.
 */

/** Thrown-free guard. Returns null when authorized, or an error result. */
function _hcAdminGuard_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return { success: false, error: 'Could not determine the active user.' };
  }
  if (!email) {
    return { success: false, error: 'No active user. This function requires a signed-in administrator.' };
  }
  if (!isTravelAdmin(email)) {
    // Logged because an unexpected caller here is worth seeing: these
    // functions are browser-reachable and write HR data.
    console.warn('HCAdmin: refused non-admin caller ' + email);
    return { success: false, error: 'Administrator access is required to edit HR data.' };
  }
  return null;
}

/**
 * Everything the roster editor needs in one call.
 *
 * One RPC rather than three: the editor needs positions, orgs and the
 * validation state together, and three round-trips would show the grid before
 * the org dropdowns could populate.
 *
 * @returns {Object} { success, positions[], orgs[], offices[], problems[], error? }
 * @client
 */
function getHCAdminData() {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  try {
    var bundle = HC.hcGetBundle();
    var orgs = HC.hcGetOrgHierarchy();

    // The validator reports the three silent-failure classes plus dangling
    // references. Shown in the editor so a problem introduced by an earlier
    // hand-edit is visible before anyone adds to it.
    var validation = validateHCData();

    return {
      success: true,
      positions: bundle.success ? bundle.data : [],
      orgs: orgs || [],
      // Office/org code pairs, so the editor's org dropdown can show both
      // namespaces (FCA — OMD DAC) exactly as the request form does.
      offices: [
        { officeCode: 'FO', orgCode: 'FC', name: 'Front Office / AC' },
        { officeCode: 'OMD', orgCode: 'FCA', name: 'OMD DAC' },
        { officeCode: 'IDV', orgCode: 'FCB', name: 'IDV DAC' },
        { officeCode: 'CM', orgCode: 'FCC', name: 'CM DAC' }
      ],
      problems: validation.problems || [],
      bundleError: bundle.success ? null : bundle.error
    };
  } catch (error) {
    console.error('getHCAdminData failed: ' + error.message);
    return { success: false, error: error.message, positions: [], orgs: [] };
  }
}

/**
 * Validates one position against everything that fails silently.
 *
 * Returns a LIST of problems rather than the first one, because a form that
 * reports one error at a time makes the user resubmit repeatedly to discover
 * the rest.
 *
 * @param {Object} position the candidate row
 * @param {Array} allPositions the current roster, for reference checks
 * @param {string} [originalPositionNumber] set when editing, so the row can
 *        legitimately keep its own key
 * @param {Array<string>} [allOrgCodes] known HC_Orgs codes. Defaults to the
 *        four top-level ones; passed explicitly by saveHCPosition so the
 *        rule follows the sheet rather than a hardcoded list.
 * @returns {Array<string>} empty when valid
 */
function validateHCPosition(position, allPositions, originalPositionNumber, allOrgCodes) {
  var problems = [];
  var p = position || {};
  var roster = allPositions || [];

  var pn = String(p.positionNumber || '').trim();
  if (!pn) {
    problems.push('Position Number is required. It is the key the supervisor chain joins on.');
  }

  // A duplicate key means the later row wins every lookup and the earlier
  // person becomes invisible.
  var clash = roster.filter(function (r) {
    return r.positionNumber === pn && r.positionNumber !== originalPositionNumber;
  });
  if (pn && clash.length) {
    problems.push('Position Number "' + pn + '" already exists. Each must be unique — ' +
      'a duplicate makes one of the two people invisible to every lookup.');
  }

  // Grade: the VT-03 defect. Stored as text, zero-padded, because every
  // comparison in the system is a string comparison.
  var grade = String(p.grade || '').trim();
  if (grade && /^\d+$/.test(grade) && grade.length === 1) {
    problems.push('Grade "' + grade + '" must be written as "0' + grade + '". ' +
      'Grades are compared as strings, so a single digit fails every grade ' +
      'check in the system — including the GS-15 Division Director lookup.');
  }

  // Supervisory_Status drives site access (Access.js:416) as well as the
  // supervisor chain, so a wrong value here silently grants or denies LETS.
  var sup = String(p.supervisoryStatus || '').trim();
  if (sup && sup !== '2' && sup !== '4' && sup !== '5' && sup !== '6' && sup !== '7' && sup !== '8') {
    problems.push('Supervisory Status "' + sup + '" is not a recognized code. ' +
      'Use 2 for a supervisor, or leave it blank. This value grants LETS ' +
      'access on its own, so an unexpected code is worth checking.');
  }

  var occupancy = String(p.occupancyStatus || '').trim().toUpperCase();
  if (occupancy && ['FILLED', 'VACANT', 'OBLIGATED'].indexOf(occupancy) === -1) {
    problems.push('Occupancy Status must be FILLED, VACANT or OBLIGATED (got "' +
      occupancy + '").');
  }

  // A staffed seat with no email cannot be notified or matched by
  // canAccessTrip, and nothing else reports that.
  if (occupancy !== 'VACANT' && p.employeeName && !p.emailAddress) {
    problems.push('A staffed position needs an Email Address. Without one this ' +
      'person cannot be notified and cannot be matched for site access.');
  }
  if (p.emailAddress && String(p.emailAddress).indexOf('@') === -1) {
    problems.push('Email Address "' + p.emailAddress + '" is not an email address.');
  }

  // Dangling supervisor pointer: approval routing finds no Division Director.
  var reportsTo = String(p.reportsToPositionNumber || '').trim();
  if (reportsTo) {
    if (reportsTo === pn) {
      problems.push('A position cannot report to itself.');
    } else if (!roster.some(function (r) { return r.positionNumber === reportsTo; })) {
      problems.push('Reports To "' + reportsTo + '" does not exist. Approval ' +
        'routing would find no Division Director for this person.');
    } else {
      // Cycle detection. Walk UP from the proposed supervisor; if we arrive
      // back at this position, the edit would create a loop.
      var byPn = {};
      roster.forEach(function (r) { byPn[r.positionNumber] = r; });
      var cursor = reportsTo;
      var seen = {};
      var depth = 0;
      while (cursor && depth < 25) {
        if (cursor === pn) {
          problems.push('This would create a supervisor cycle: ' + pn +
            ' reports to ' + reportsTo + ', which eventually reports back to ' +
            pn + '. A cycle hangs any page that walks the chain.');
          break;
        }
        if (seen[cursor]) break;   // pre-existing cycle elsewhere; not ours
        seen[cursor] = true;
        cursor = byPn[cursor] ? byPn[cursor].reportsToPositionNumber : '';
        depth++;
      }
    }
  }

  // Org codes are HIERARCHICAL and there are hundreds of them: FCA0A sits
  // under FCA under FC. Only the top-level codes carry a budget office key,
  // so a sub-org resolves to its parent by longest prefix rather than needing
  // its own HC_Orgs row.
  //
  // The previous rule required an exact match against the four parents, which
  // rejected every real code — @clolry entered FCA0A-0008 and the validator
  // reported a problem the editor could not fix.
  if (p.orgCode) {
    var code = String(p.orgCode).trim().toUpperCase();
    var known = {};
    (allOrgCodes || ['FC', 'FCA', 'FCB', 'FCC']).forEach(function (k) { known[k] = true; });
    var resolved = null;
    if (known[code]) {
      resolved = code;
    } else {
      Object.keys(known).forEach(function (k) {
        if (code.indexOf(k) !== 0) return;
        if (resolved && k.length <= resolved.length) return;
        resolved = k;
      });
    }
    if (!resolved) {
      // Does NOT list every known code. With @clolry's real list loaded there
      // are 137 of them, and a 137-code error message is unreadable — the
      // four top-level ones are what the user needs to recognize.
      var tops = Object.keys(known).filter(function (k) { return k.length <= 3; }).sort();
      problems.push('Org Code "' + p.orgCode + '" does not start with any known org code. ' +
        'Codes are hierarchical, so a sub-org resolves to its parent — FCA0A ' +
        'attributes to FCA. Yours matches none of ' +
        (tops.length ? tops.join(', ') : Object.keys(known).sort().slice(0, 8).join(', ')) +
        ', so it looks like a typo. ' + Object.keys(known).length +
        ' codes are loaded; run loadRealOrgCodes() if HC_Orgs is not populated.');
    }
  }

  return problems;
}

/**
 * Loads @clolry's 137 real org codes into HC_Orgs, from the admin GUI.
 *
 * WHY A BUTTON AND NOT JUST THE EDITOR FUNCTION
 * ---------------------------------------------
 * loadRealOrgCodes lives in 91_setup/HCSeed.js and is @editor — runnable only
 * from the Apps Script console. @clolry's actual complaint was exactly this:
 * "I don't know how to fix this using the GUI." Leaving the remedy in a place
 * only a developer can reach reproduces the original problem in a new form.
 *
 * Admin-guarded like every other write here. Idempotent — it replaces HC_Orgs
 * rather than appending, so pressing it twice is harmless.
 *
 * @returns {Object} { success, orgs, message, error? }
 * @client
 */
function hcLoadRealOrgCodes() {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  // Serialized against saveHCPosition: that function reads HC_Orgs to decide
  // which codes are valid, so a concurrent replace could have it validate
  // against a half-written table.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (e) {
    return { success: false, error: 'Another edit is in progress. Try again in a moment.' };
  }

  try {
    return loadRealOrgCodes();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates or updates one position.
 *
 * REFUSES the whole write when validation fails. A partial write to HR data is
 * worse than no write: half-applied edits are what produce the dangling
 * references and cycles this editor exists to prevent.
 *
 * @param {Object} position
 * @param {string} [originalPositionNumber] present when editing
 * @returns {Object} { success, problems[], error? }
 * @client
 */
function saveHCPosition(position, originalPositionNumber) {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (e) {
    return {
      success: false,
      error: 'Another edit is in progress. Try again in a moment.'
    };
  }

  try {
    var bundle = HC.hcGetBundle();
    if (!bundle.success) {
      return { success: false, error: 'Could not read the current roster: ' + bundle.error };
    }

    var orgCodes = (HC.hcGetOrgHierarchy() || []).map(function (o) { return o.orgCode; })
      .filter(Boolean);
    var problems = validateHCPosition(position, bundle.data, originalPositionNumber,
      orgCodes.length ? orgCodes : null);
    if (problems.length) {
      return { success: false, problems: problems };
    }

    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.HC_POSITIONS);
    if (!sheet) {
      return { success: false, error: 'HC_Positions tab not found. Run setupTravelDatabase().' };
    }

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_POSITIONS];
    var col = {};
    headers.forEach(function (h, i) { col[h] = i; });

    var lastRow = sheet.getLastRow();
    var existingRowNumber = 0;
    if (lastRow > 1 && originalPositionNumber) {
      var keys = sheet.getRange(2, col['Position_Number'] + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) {
        if (String(keys[i][0]).trim() === String(originalPositionNumber).trim()) {
          existingRowNumber = i + 2;
          break;
        }
      }
    }

    var now = new Date();
    var actor = _hcAdminActor_();

    // Build positionally from the schema, so a column appended later lands
    // correctly without editing this function.
    // docs/DATA_DICTIONARY.md §3.9: reads resolve by name, writes are
    // positional.
    var rec = {
      'Position_Number': String(position.positionNumber || '').trim(),
      'Reports_To_Position_Number': String(position.reportsToPositionNumber || '').trim(),
      'Employee_ID': String(position.employeeId || '').trim(),
      'Employee_Name': String(position.employeeName || '').trim(),
      'Email_Address': String(position.emailAddress || '').trim(),
      'Org_Code': String(position.orgCode || '').trim().toUpperCase(),
      'Office_Title': String(position.officeTitle || '').trim(),
      'Grade': String(position.grade || '').trim(),
      'Supervisory_Status': String(position.supervisoryStatus || '').trim(),
      'Occupancy_Status': String(position.occupancyStatus || 'FILLED').trim().toUpperCase(),
      'LCAT': String(position.lcat || '').trim(),
      'Location_Code': String(position.locationCode || '').trim(),
      'Duty_Station_Address': String(position.dutyStationAddress || '').trim(),
      'Duty_Station_City': String(position.dutyStationCity || '').trim(),
      'Duty_Station_State': String(position.dutyStationState || '').trim().toUpperCase(),
      'Is_Active': position.isActive === false ? false : true,
      'Updated_By': actor,
      'Updated_At': now
    };
    if (!existingRowNumber) {
      rec['Created_By'] = actor;
      rec['Created_At'] = now;
    }

    var targetRow = existingRowNumber || (lastRow + 1);

    // Pin the identifier columns to TEXT before writing. Position_Number,
    // Employee_ID and Grade all carry leading zeros, and Sheets would store
    // '07' as the number 7 — the VT-03 defect this editor exists to prevent.
    ['Position_Number', 'Employee_ID', 'Grade'].forEach(function (name) {
      if (col[name] !== undefined) {
        sheet.getRange(targetRow, col[name] + 1).setNumberFormat('@');
      }
    });
    SpreadsheetApp.flush();

    if (existingRowNumber) {
      // Read the existing row so unmapped columns (Created_By/At) survive.
      var current = sheet.getRange(targetRow, 1, 1, headers.length).getValues()[0];
      headers.forEach(function (h, i) {
        if (rec.hasOwnProperty(h)) current[i] = rec[h];
      });
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([current]);
    } else {
      var row = headers.map(function (h) {
        return rec.hasOwnProperty(h) ? rec[h] : '';
      });
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
    }
    SpreadsheetApp.flush();

    // Without this the edit is invisible for up to six hours.
    HC.hcCacheInvalidateAll();

    console.log('saveHCPosition: ' + (existingRowNumber ? 'updated' : 'created') +
      ' ' + rec['Position_Number'] + ' by ' + actor);

    return {
      success: true,
      created: !existingRowNumber,
      positionNumber: rec['Position_Number']
    };

  } catch (error) {
    console.error('saveHCPosition failed: ' + error.message);
    return { success: false, error: error.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Deactivates a position. Does NOT delete the row.
 *
 * Deleting would break historical requests: Request_Travelers rows carry
 * Budget_Org_Code and the approval log references positions by number, so a
 * removed row turns a past request's attribution into a dangling reference.
 * Is_Active=false removes the person from the bundle while preserving history.
 *
 * REFUSES when other positions still report to this one — orphaning a subtree
 * is how approval routing silently loses a Division Director.
 *
 * @param {string} positionNumber
 * @returns {Object} { success, problems[], error? }
 * @client
 */
function deactivateHCPosition(positionNumber) {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  var pn = String(positionNumber || '').trim();
  if (!pn) return { success: false, error: 'A position number is required.' };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (e) {
    return { success: false, error: 'Another edit is in progress. Try again in a moment.' };
  }

  try {
    var bundle = HC.hcGetBundle();
    if (!bundle.success) {
      return { success: false, error: 'Could not read the current roster: ' + bundle.error };
    }

    var dependents = bundle.data.filter(function (p) {
      return p.reportsToPositionNumber === pn;
    });
    if (dependents.length) {
      return {
        success: false,
        problems: [
          dependents.length + ' position(s) report to ' + pn + ': ' +
          dependents.map(function (d) {
            return d.positionNumber + (d.employeeName ? ' (' + d.employeeName + ')' : '');
          }).join(', ') + '. Reassign them first — deactivating this position ' +
          'would leave them with no supervisor, and approval routing would ' +
          'find no Division Director.'
        ]
      };
    }

    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.HC_POSITIONS);
    if (!sheet) return { success: false, error: 'HC_Positions tab not found.' };

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_POSITIONS];
    var col = {};
    headers.forEach(function (h, i) { col[h] = i; });

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, error: 'HC_Positions is empty.' };

    var keys = sheet.getRange(2, col['Position_Number'] + 1, lastRow - 1, 1).getValues();
    var rowNumber = 0;
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === pn) { rowNumber = i + 2; break; }
    }
    if (!rowNumber) return { success: false, error: 'Position ' + pn + ' not found.' };

    sheet.getRange(rowNumber, col['Is_Active'] + 1).setValue(false);
    sheet.getRange(rowNumber, col['Updated_By'] + 1).setValue(_hcAdminActor_());
    sheet.getRange(rowNumber, col['Updated_At'] + 1).setValue(new Date());
    SpreadsheetApp.flush();

    HC.hcCacheInvalidateAll();
    console.log('deactivateHCPosition: ' + pn + ' by ' + _hcAdminActor_());

    return { success: true, positionNumber: pn };

  } catch (error) {
    console.error('deactivateHCPosition failed: ' + error.message);
    return { success: false, error: error.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Re-reads the roster from the sheet, bypassing the cache.
 *
 * Exists because the bundle caches for six hours. Someone who edits the sheet
 * directly — which remains possible — otherwise waits that long to see it, and
 * @clolry hit exactly that confusion twice.
 *
 * @returns {Object} { success, positions, orgs }
 * @client
 */
function refreshHCAdminData() {
  var denied = _hcAdminGuard_();
  if (denied) return denied;
  try {
    HC.hcCacheInvalidateAll();
    return getHCAdminData();
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function _hcAdminActor_() {
  try {
    return Session.getActiveUser().getEmail() || 'unknown';
  } catch (e) {
    return 'unknown';
  }
}
