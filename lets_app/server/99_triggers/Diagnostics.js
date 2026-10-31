/**
 * Diagnostics.js
 * Read-mostly health checks, run from the Apps Script editor.
 *
 * WHY THIS IS A COMMITTED FILE
 * ----------------------------
 * These checks used to be pasted into an ad-hoc `test.gs` scratch file. That
 * file is deleted by every deploy — `clasp push --force` overwrites the project
 * from the repository, and a file that exists only in the editor is not in the
 * repository. It was lost three times during the City Pair work, and each time
 * the symptom was a confusing "Script function not found" rather than anything
 * that pointed at the cause.
 *
 * Committing them means they survive deploys, are versioned alongside the code
 * they check, and are reviewable.
 *
 * HOW TO USE
 * ----------
 * In the Apps Script editor: pick a function from the dropdown at the top,
 * click Run, read the Execution log. Nothing here needs arguments.
 *
 *   diagAll()          everything below, in one pass. Run this after a deploy.
 *   diagEnvironment()  which environment, which database, which properties
 *   diagCityPairs()    row count, last sync, a live lookup, cold/warm timing
 *   diagHcData()       position and org counts, validation problems, a DD walk
 *   diagAccess()       who currently has access, and by which path
 *   diagAirportPrefs() stored preferences and the promotion threshold
 *
 * THE COST OF THIS FILE, STATED PLAINLY
 * -------------------------------------
 * Apps Script makes every top-level function browser-callable, so this adds
 * six functions to the surface docs/GAP_REGISTER.md G-001 describes (412
 * callable, 31 guarded). Everything here is READ-ONLY and none of it returns a
 * value to a caller — output goes to console.log, which only someone with
 * editor access can read. A browser caller gets `undefined`.
 *
 * That is deliberate. Returning structured data would make these functions
 * genuinely useful to an attacker; logging it means the information is
 * available to a developer looking at the editor and nobody else.
 *
 * Even so, diagAccess() enumerates who holds access, which is organisational
 * information. It is guarded with isTravelAdmin() for that reason — not
 * because the log is reachable, but because the function should refuse to
 * compute the answer for a non-admin regardless.
 *
 * DO NOT add anything here that writes. If a diagnostic ever needs to mutate
 * state, it belongs in 91_setup/ with its own guard and its own review.
 */

/**
 * Runs every diagnostic. Start here after a deploy.
 * @editor
 */
function diagAll() {
  console.log('================================================================');
  console.log('LETS DIAGNOSTICS — ' + new Date().toISOString());
  console.log('================================================================');
  diagEnvironment();
  diagCityPairs();
  diagHcData();
  diagAirportPrefs();
  diagTriggers();
  diagAccess();
  console.log('================================================================');
  console.log('END OF DIAGNOSTICS');
  console.log('================================================================');
}

/**
 * Environment, database binding, and Script Property presence.
 *
 * Property VALUES are not printed. GSA_PERDIEM_API_KEY and
 * TRAVEL_LOGO_BASE64 are not secrets in the credential sense, but printing
 * them into a log that gets pasted into chat or a ticket is a habit worth not
 * forming. Presence is what matters for a health check.
 *
 * @editor
 */
function diagEnvironment() {
  console.log('');
  console.log('--- ENVIRONMENT ---');
  try {
    var props = PropertiesService.getScriptProperties();

    // The FAS tracker gate is fail-closed: unset resolves to development.
    // Printing the RAW value alongside the resolved one matters, because an
    // unset property and an explicit 'development' look identical downstream
    // but mean different things operationally.
    var rawEnv = props.getProperty('LETS_ENV');
    console.log('LETS_ENV (raw):      ' + (rawEnv === null ? '[UNSET]' : JSON.stringify(rawEnv)));
    // LETS_ENV is a module-level const computed at file-evaluation time
    // (TripConfig.js:131) via resolveLetsEnvironment, not a function call.
    try {
      console.log('LETS_ENV (resolved): ' + LETS_ENV);
    } catch (e) {
      console.log('LETS_ENV (resolved): [could not resolve: ' + e.message + ']');
    }

    var dbId = props.getProperty('TRAVEL_DB_SPREADSHEET_ID');
    if (!dbId) {
      console.log('TRAVEL_DB_SPREADSHEET_ID: [UNSET] — nothing else will work');
    } else {
      // Print only a prefix. Enough to tell two environments apart in a log
      // without putting a full document ID into chat.
      console.log('TRAVEL_DB_SPREADSHEET_ID: ' + dbId.substring(0, 12) + '... (' + dbId.length + ' chars)');
      try {
        var ss = SpreadsheetApp.openById(dbId);
        console.log('  opens OK:          ' + ss.getName());
        var tabs = ss.getSheets().map(function (sh) { return sh.getName(); });
        console.log('  tabs present:      ' + tabs.length);

        // Schema-declared tabs that do not exist. Two are expected:
        // File_Queue has no creator anywhere in the codebase, and Feedback is
        // created lazily on first write.
        var expected = Object.keys(TRAVEL_SHEET_SCHEMAS);
        var missing = expected.filter(function (t) { return tabs.indexOf(t) === -1; });
        console.log('  schema tabs:       ' + expected.length);
        console.log('  missing:           ' + (missing.length ? missing.join(', ') : 'none'));
        if (missing.length) {
          console.log('  -> run setupTravelDatabase() to create them');
        }
      } catch (e) {
        console.log('  FAILED to open:    ' + e.message);
      }
    }

    console.log('');
    console.log('Script Properties (presence only, values not printed):');
    var keys = [
      'GSA_PERDIEM_API_KEY',
      'other_cost_percentage',
      'MILEAGE_RATE_PRIVATE',
      'MILEAGE_RATE_GOV',
      'SHARED_DRIVE_FOLDER_ID',
      'HC_SUPERVISOR_ACCESS_ENABLED',
      'CITY_PAIR_CSV_URL_TEMPLATE'
    ];
    keys.forEach(function (k) {
      var v = props.getProperty(k);
      var shown;
      if (v === null) {
        shown = '[UNSET]';
      } else if (k === 'other_cost_percentage' ||
                 k === 'MILEAGE_RATE_PRIVATE' ||
                 k === 'MILEAGE_RATE_GOV' ||
                 k === 'HC_SUPERVISOR_ACCESS_ENABLED') {
        // Short config values are printed: they are the ones you actually need
        // to see, and none of them is sensitive.
        shown = JSON.stringify(v);
      } else {
        shown = '[set, ' + String(v).length + ' chars]';
      }
      console.log('  ' + k + ': ' + shown);
    });

    // Two known traps worth surfacing every time rather than remembering.
    console.log('');
    if (props.getProperty('MILEAGE_RATE_PRIVATE') === null) {
      console.log('NOTE: MILEAGE_RATE_PRIVATE is unset. initTravelSystemConfig() writes');
      console.log('      "private_mileage_rate", which Props.js:89 does not read — so it');
      console.log('      appears configured and is silently ignored. Set the UPPER_SNAKE key.');
    }
    if (props.getProperty('other_cost_percentage') === null) {
      console.log('NOTE: other_cost_percentage is unset; the gross-up falls back to 30%.');
    }

  } catch (error) {
    console.log('diagEnvironment FAILED: ' + error.message);
  }
}

/**
 * City Pair data: how much, how fresh, and does a lookup work.
 *
 * Times a COLD lookup and a WARM one separately. A warm number is misleading
 * on its own — per-pair results cache for 24h, so re-running a diagnostic
 * reports the repeat path and hides what a user pays when they pick a city
 * nobody has queried today.
 *
 * @editor
 */
function diagCityPairs() {
  console.log('');
  console.log('--- CITY PAIRS ---');
  try {
    if (!TRAVEL_DB_SPREADSHEET_ID) {
      console.log('TRAVEL_DB_SPREADSHEET_ID unset; skipping.');
      return;
    }
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);

    var sheet = ss.getSheetByName(SHEET_NAMES.CITY_PAIRS);
    if (!sheet) {
      console.log('City_Pairs tab missing. Run setupTravelDatabase() then syncCityPairs().');
      return;
    }
    var rows = Math.max(0, sheet.getLastRow() - 1);
    console.log('rows:            ' + rows);
    console.log('columns:         ' + sheet.getLastColumn() +
                ' (schema expects ' + TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.CITY_PAIRS].length + ')');
    if (rows === 0) {
      console.log('-> empty. Run syncCityPairs().');
      return;
    }

    var log = ss.getSheetByName(SHEET_NAMES.CITY_PAIR_SYNC_LOG);
    if (log && log.getLastRow() > 1) {
      var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.CITY_PAIR_SYNC_LOG];
      var last = log.getRange(log.getLastRow(), 1, 1, headers.length).getValues()[0];
      var c = {};
      headers.forEach(function (h, i) { c[h] = i; });
      console.log('last sync:       ' + last[c['Synced_At']]);
      console.log('  status:        ' + last[c['Status']]);
      console.log('  FY:            ' + last[c['Fiscal_Year']]);
      console.log('  parsed/written/skipped: ' + last[c['Rows_Parsed']] + ' / ' +
                  last[c['Rows_Written']] + ' / ' + last[c['Rows_Skipped']]);
      console.log('  duration:      ' + last[c['Duration_Ms']] + 'ms');
      if (last[c['Error']]) console.log('  error:         ' + last[c['Error']]);
      if (Number(last[c['Rows_Skipped']]) > 100) {
        console.log('  -> high skip count: rows may carry a format the parser rejects');
      }
    } else {
      console.log('last sync:       [no log rows]');
    }

    // A pair nobody is likely to have warmed, so the first timing is cold.
    // DCA|ORD is the pair used throughout development and will usually be
    // cached, which is exactly why it is not the one measured first.
    console.log('');
    var t0 = Date.now();
    var cold = getCityPairFare('BOS', 'SEA');
    var coldMs = Date.now() - t0;
    console.log('BOS-SEA lookup:  ' + coldMs + 'ms (cold or warm, see next line)');

    var t1 = Date.now();
    getCityPairFare('BOS', 'SEA');
    console.log('  same again:    ' + (Date.now() - t1) + 'ms (cached)');
    console.log('  found:         ' + cold.found +
                (cold.found ? ', YCA $' + cold.ycaFare + ' ' + cold.airline +
                              ' ' + cold.awardedService : ''));

    // Direction-insensitivity is the single most important invariant here. GSA
    // stores pairs alphabetically, so a lookup that does not normalize returns
    // "no fare" for half of all routes — silently, and in a way that reads as
    // missing data rather than a bug.
    var fwd = getCityPairFare('DCA', 'ORD');
    var rev = getCityPairFare('ORD', 'DCA');
    console.log('');
    console.log('DCA->ORD:        ' + (fwd.found ? '$' + fwd.ycaFare : 'not found'));
    console.log('ORD->DCA:        ' + (rev.found ? '$' + rev.ycaFare : 'not found'));
    if (fwd.found !== rev.found || fwd.ycaFare !== rev.ycaFare) {
      console.log('  *** MISMATCH — pair-key normalization is broken ***');
    } else {
      console.log('  both directions agree (pair-key normalization OK)');
    }

    // Metro aggregates must sort last. WAS carries more routes than DCA in the
    // real data, so a plain route-count sort makes an unbookable aggregate the
    // default origin for Washington.
    var ap = getAirportsForCity('WASHINGTON', 'DC');
    if (ap.success && ap.airports.length) {
      console.log('');
      console.log('Washington DC airports (first is the default):');
      ap.airports.forEach(function (a) {
        console.log('  ' + a.code + '  routes=' + a.routeCount +
                    (a.isMetroArea ? '  [metro area: ' + a.metroLabel + ']' : ''));
      });
      if (ap.airports[0].isMetroArea) {
        console.log('  *** a metro aggregate is first — it must never be the default ***');
      }
    }

  } catch (error) {
    console.log('diagCityPairs FAILED: ' + error.message);
  }
}

/**
 * HC roster: counts, referential problems, and a live supervisor-chain walk.
 * @editor
 */
function diagHcData() {
  console.log('');
  console.log('--- HC DATA ---');
  try {
    var bundle = HC.hcGetBundle();
    if (!bundle.success) {
      console.log('hcGetBundle FAILED: ' + bundle.error);
      console.log('-> if the tabs are missing, run setupTravelDatabase() then seedHCTestData()');
      return;
    }
    console.log('positions:       ' + bundle.count);
    console.log('last refreshed:  ' + (bundle.lastRefreshed || '[never]'));
    console.log('served from:     ' + (bundle.cached ? 'cache' : 'sheet'));

    var orgs = HC.hcGetOrgHierarchy();
    console.log('orgs:            ' + orgs.length);
    if (orgs.length) {
      console.log('  ' + orgs.map(function (o) {
        return o.orgCode + (o.officeCode ? '->' + o.officeCode : '');
      }).join(', '));
    }

    if (bundle.count === 0) {
      console.log('-> no positions. Run seedHCTestData() for fictional test data.');
      return;
    }

    // Grade normalization is the defect VT-03 predicted: Sheets turns a cell
    // containing 07 into the number 7, and String(7) !== '07', so a GS-07
    // fails every grade comparison in the system. Checking for a one-character
    // numeric grade catches a regression immediately.
    var badGrades = bundle.data.filter(function (p) {
      return /^\d$/.test(String(p.grade));
    });
    console.log('');
    console.log('grade normalization: ' +
      (badGrades.length === 0
        ? 'OK (no single-digit grades)'
        : '*** ' + badGrades.length + ' position(s) with an unpadded grade — ' +
          'these fail every grade comparison: ' +
          badGrades.map(function (p) { return p.positionNumber + '=' + p.grade; }).join(', ')));

    var sups = bundle.data.filter(function (p) {
      return String(p.supervisoryStatus) === '2' &&
             String(p.occupancyStatus).toUpperCase() !== 'VACANT';
    });
    console.log('filled supervisors: ' + sups.length +
      ' (each one can access LETS with no role row — G-008)');

    var validation = validateHCData();
    console.log('');
    console.log('validateHCData: ' + (validation.success ? 'no problems' :
      validation.problems.length + ' problem(s)'));
    (validation.problems || []).forEach(function (p) { console.log('  - ' + p); });

    // Approval routing depends on this walk finding a staffed GS-15, so walk
    // it for a real position rather than trusting that the data looks right.
    var leaf = bundle.data.filter(function (p) {
      return p.reportsToPositionNumber && String(p.grade) !== '15';
    })[0];
    if (leaf) {
      var dd = HC.hcFindDivisionDirector(leaf.positionNumber);
      console.log('');
      console.log('DD walk from ' + leaf.positionNumber + ' (' + leaf.employeeName + '):');
      console.log('  -> ' + (dd.ddName || '[none found]') +
                  (dd.ddEmail ? ' <' + dd.ddEmail + '>' : ''));
      if (!dd.ddName) {
        console.log('  requests from this position would route with an empty Division Director');
      }
    }

  } catch (error) {
    console.log('diagHcData FAILED: ' + error.message);
  }
}

/**
 * Stored airport preferences and whether promotion is working.
 * @editor
 */
function diagAirportPrefs() {
  console.log('');
  console.log('--- AIRPORT PREFERENCES ---');
  try {
    if (!TRAVEL_DB_SPREADSHEET_ID) {
      console.log('TRAVEL_DB_SPREADSHEET_ID unset; skipping.');
      return;
    }
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.TRAVELER_AIRPORT_PREFS);
    if (!sheet) {
      console.log('Traveler_Airport_Prefs tab missing. Run setupTravelDatabase().');
      return;
    }

    console.log('promotion threshold: ' + AIRPORT_PREF_PROMOTION_THRESHOLD + ' uses');

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      console.log('rows: 0 — no preferences recorded yet');
      return;
    }

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.TRAVELER_AIRPORT_PREFS];
    var c = {};
    headers.forEach(function (h, i) { c[h] = i; });
    var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    console.log('rows: ' + rows.length);

    rows.forEach(function (r) {
      var count = Number(r[c['Use_Count']]) || 0;
      console.log('  ' + r[c['User_ID']] + '  ' + r[c['Pref_Type']] +
                  (r[c['City_Name']] ? ' ' + r[c['City_Name']] + ',' + r[c['State']] : '') +
                  '  -> ' + r[c['Airport_Code']] +
                  '  uses=' + count +
                  (count >= AIRPORT_PREF_PROMOTION_THRESHOLD ? '  [PROMOTED]' : '  [learning]'));
    });

    // A fleet of rows all stuck at 1 is the signature of the write-buffering
    // bug: without SpreadsheetApp.flush(), a second write in the same
    // execution reads a stale getLastRow() and overwrites rather than
    // incrementing, so Use_Count can never pass 1 and nothing is ever promoted.
    var stuck = rows.filter(function (r) { return (Number(r[c['Use_Count']]) || 0) === 1; });
    if (rows.length >= 3 && stuck.length === rows.length) {
      console.log('');
      console.log('NOTE: every row is at Use_Count 1. If preferences are being selected');
      console.log('      repeatedly and never promoting, check that');
      console.log('      recordAirportPreference still calls SpreadsheetApp.flush().');
    }

  } catch (error) {
    console.log('diagAirportPrefs FAILED: ' + error.message);
  }
}

/**
 * Installed triggers, and whether their handlers still exist.
 *
 * Renaming a trigger handler is a silent breakage: the installed trigger keeps
 * firing against a function that no longer resolves, and the only evidence is
 * a failure email nobody reads. Relocating a handler between files is safe;
 * renaming it is not.
 *
 * @editor
 */
function diagTriggers() {
  console.log('');
  console.log('--- TRIGGERS ---');
  try {
    var triggers = ScriptApp.getProjectTriggers();
    if (!triggers.length) {
      console.log('No installed triggers.');
      console.log('Expected in a configured environment:');
      console.log('  syncCityPairs           installCityPairSyncTrigger()');
      console.log('  warmCityPairCache       installCityPairWarmingTrigger()');
      console.log('  warmGSACitiesCache      installGSACitiesWarmingTrigger()');
      return;
    }

    console.log(triggers.length + ' installed:');
    triggers.forEach(function (t) {
      var handler = t.getHandlerFunction();
      // A handler that no longer resolves is the failure this check exists for.
      var exists = true;
      try {
        exists = (typeof this[handler] === 'function');
      } catch (e) {
        exists = false;
      }
      console.log('  ' + handler +
                  '  [' + t.getEventType() + ']' +
                  (exists ? '' : '  *** HANDLER NOT FOUND — this trigger fires into nothing ***'));
    });

    var handlers = triggers.map(function (t) { return t.getHandlerFunction(); });
    ['syncCityPairs', 'warmCityPairCache'].forEach(function (want) {
      if (handlers.indexOf(want) === -1) {
        console.log('  NOTE: ' + want + ' is not installed.');
      }
    });

  } catch (error) {
    console.log('diagTriggers FAILED: ' + error.message);
  }
}

/**
 * Who currently holds site access, and by which path.
 *
 * ADMIN-GUARDED. Unlike the other diagnostics this one enumerates people, and
 * the two HC-derived paths are invisible everywhere else — that is the whole
 * point of G-008. The guard is not about log reachability; it is that the
 * function should refuse to compute an access roster for a non-admin.
 *
 * @editor
 */
function diagAccess() {
  console.log('');
  console.log('--- ACCESS (G-008) ---');
  try {
    var me = '';
    try { me = Session.getActiveUser().getEmail() || ''; } catch (e) { /* trigger context */ }

    if (!me) {
      console.log('No active user (trigger context?). Skipping — this check is admin-only.');
      return;
    }
    if (!isTravelAdmin(me)) {
      console.log('Refused: ' + me + ' is not a travel admin.');
      console.log('This diagnostic enumerates who holds access and is admin-only.');
      return;
    }

    var inv = getAccessInventory();
    if (!inv.success) {
      console.log('getAccessInventory FAILED: ' + inv.error);
      return;
    }

    console.log('HC-derived access paths: ' +
      (inv.hcDerivedEnabled ? 'ENABLED' : 'DISABLED via HC_SUPERVISOR_ACCESS_ENABLED'));
    if (inv.roleError) console.log('  role read error: ' + inv.roleError);
    if (inv.hcError) console.log('  HC read error: ' + inv.hcError);

    console.log('');
    console.log('Explicit role rows (' + inv.roleHolders.length + ') — visible and auditable:');
    inv.roleHolders.forEach(function (r) {
      console.log('  ' + r.email + '  [' + r.roles.join(', ') + ']');
    });

    console.log('');
    console.log('HC supervisors (' + inv.hcSupervisors.length +
      ') — access with NO role row and NO audit record:');
    inv.hcSupervisors.forEach(function (s) {
      console.log('  ' + s.email + '  ' + s.positionNumber + '  ' + s.officeTitle);
    });

    console.log('');
    console.log('HC BU leads (' + inv.buLeads.length + ') — same, by office title:');
    inv.buLeads.forEach(function (s) {
      console.log('  ' + s.email + '  ' + s.positionNumber + '  ' + s.officeTitle);
    });

    // Recent decisions, which answer "why could/couldn't this person get in?"
    if (TRAVEL_DB_SPREADSHEET_ID) {
      var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
      var log = ss.getSheetByName(SHEET_NAMES.ACCESS_LOG);
      if (log && log.getLastRow() > 1) {
        var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.ACCESS_LOG];
        var c = {};
        headers.forEach(function (h, i) { c[h] = i; });
        var total = log.getLastRow() - 1;
        var take = Math.min(10, total);
        var recent = log.getRange(log.getLastRow() - take + 1, 1, take, headers.length).getValues();
        console.log('');
        console.log('Access_Log: ' + total + ' rows, last ' + take + ':');
        recent.forEach(function (r) {
          console.log('  ' + r[c['Timestamp']] + '  ' + r[c['Decision']] +
                      '  ' + r[c['Path']] + '  ' + r[c['Email']]);
        });
        // One row per page load, with no retention policy.
        if (total > 5000) {
          console.log('  -> ' + total + ' rows and growing; consider truncating.');
        }
      }
    }

  } catch (error) {
    console.log('diagAccess FAILED: ' + error.message);
  }
}
