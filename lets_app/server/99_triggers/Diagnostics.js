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
 *   diagTriggers()     installed triggers, and whether their handlers exist
 *
 *   diagDutyStationAirports()   which HC duty stations resolve to an airport
 *   diagUnresolvedCityNames()   and what GSA calls the ones that do not
 *   diagTripOverviewFields()    whether Trip Overview / budget codes are stored
 *   diagFasTrackerRow()         the exact row LETS would send to the FAS tracker
 *   diagFasTrackerHeader()      diffs that row's columns against the live sheet
 *
 * EDITOR RUNNERS, at the foot of this file. Wrappers for functions that take
 * arguments, which the Run button cannot supply:
 *
 *   runRosterPreview()     preview the HR roster import      writes nothing
 *   runRosterImport()      apply it                          WRITES
 *   runDirectoryPreview()  preview the email lookup          writes nothing
 *   runDirectoryResolve()  apply it, resumable               WRITES
 *   runBudgetDashboard()   print the FY27 budget payload     writes nothing
 *
 * The two that write are the only exception to the rule at the end of this
 * header, and the reason is in the comment above them.
 *
 * The Apps Script editor CANNOT pass arguments — the Run button always calls
 * with none. Everything above therefore takes no parameters. One helper does
 * take a state code and is called by the zero-argument wrapper above rather
 * than directly:
 *
 *   diagCityNamesForState('TX')
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
 * DO NOT add anything here that writes — with ONE narrow exception, the
 * `run…` wrappers at the foot of this file. Two of those do write, and the
 * reasoning is stated there rather than here so it cannot be read as a general
 * licence. If a DIAGNOSTIC ever needs to mutate state, it belongs in 91_setup/
 * with its own guard and its own review.
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
  diagDutyStationAirports();
  diagUnresolvedCityNames();
  diagTripOverviewFields();
  diagFasTrackerHeader();
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

        // Schema-declared tabs that do not exist.
        //
        // Feedback used to be listed here as "created lazily on first write".
        // That was wrong: it had no schema, so setupTravelDatabase skipped it
        // and submitTravelFeedback failed with 'Feedback sheet not found'
        // while the client reported success. It now has a schema and is
        // created like any other tab.
        //
        // File_Queue still has no creator and no reader anywhere in the
        // codebase — it is an inherited constant, not a live tab.
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

    // Where email actually goes. Nothing was gating this: the only
    // suppression was a per-tester opt-in keyed on the SENDER, and
    // Test_Submitters was empty — so sandbox was mailing real people.
    // Branding. Every user-visible app name, org name and stage label resolves
    // through these, so a wrong value here is visible everywhere at once.
    console.log('');
    try {
      var b = getBrandingForClient();
      console.log('Branding (set the matching Script Property to change):');
      console.log('  APP_NAME:            ' + b.appName);
      console.log('  ORG_SHORT_NAME:      ' + b.orgShort);
      console.log('  ORG_LONG_NAME:       ' + b.orgLong);
      console.log('  ORG_FO_LABEL:        ' + b.foLabel);
      console.log('  REVIEW_LABEL_SECTOR: ' + b.sectorLabel);
      console.log('  REVIEW_LABEL_BU:     ' + b.buLabel);
      console.log('  contact mailbox:     ' + b.contactEmail);
      console.log('  email sender name:   ' + b.senderName);
    } catch (e) {
      console.log('Branding: [unavailable: ' + e.message + ']');
    }

    console.log('');
    try {
      var mail = getEmailRoutingStatus();
      console.log('Email routing:');
      console.log('  environment:        ' + mail.environment);
      if (mail.blocked) {
        console.log('  *** BLOCKED: ' + mail.reason);
        console.log('      No email will send. Set TEST_EMAIL_REDIRECT.');
      } else if (mail.willRedirect) {
        console.log('  redirecting all mail to: ' + mail.redirectTo);
        console.log('  real recipients are listed in each message body');
      } else {
        console.log('  *** LIVE — mail goes to real recipients ***');
      }
      console.log('  Test_Submitters suppression for you: ' +
        (mail.testSubmitterSuppression ? 'ON (nothing sends)' : 'off'));
    } catch (e) {
      console.log('Email routing: [unavailable: ' + e.message + ']');
    }

    console.log('');
    try {
      console.log('Cache key versions (bump on a result-shape change):');
      console.log('  cp_airports: ' + CP_AIRPORTS_CACHE_VERSION);
      console.log('  cp_fare:     ' + CP_FARE_CACHE_VERSION);
    } catch (e) {
      console.log('Cache key versions: [unavailable: ' + e.message + ']');
    }

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
  // ADMIN ONLY. Browser-callable like every top-level function (G-001), and
  // it prints position numbers, names and grades. Logs are not the concern —
  // the RETURN path is: a browser caller gets whatever this returns, and
  // Stackdriver output is admin-visible anyway.
  //
  // Guarded rather than sanitised: a diagnostic whose output is filtered is
  // no longer a diagnostic.
  try {
    var _who = Session.getActiveUser().getEmail() || '';
    if (!_who || typeof isTravelAdmin !== 'function' || !isTravelAdmin(_who)) {
      console.warn('diagHcData: refused non-admin caller ' + (_who || '(none)'));
      return { success: false, error: 'Administrator access is required.' };
    }
  } catch (e) {
    return { success: false, error: 'Could not determine the active user.' };
  }

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
 * Does every HC duty-station city resolve to an airport?
 *
 * getAirportsForCity matches ORIGIN_CITY_NAME / DESTINATION_CITY_NAME
 * EXACTLY. GSA and HR do not always agree on a city's name, and when they
 * disagree the traveller gets NO airport options at all — which would block a
 * submission rather than merely inconvenience it.
 *
 * Found in the sandbox: FORT WORTH returns no match, because GSA files that
 * airport under a different city name. Eight of nine seeded duty stations
 * resolved; that one did not, and the only visible symptom was
 * warmCityPairCache reporting 8 origins instead of 9.
 *
 * Run this after any HC roster change, and after each fiscal-year award file.
 *
 * @editor
 */
function diagDutyStationAirports() {
  console.log('');
  console.log('--- DUTY STATION AIRPORT RESOLUTION ---');
  try {
    var bundle = HC.hcGetBundle();
    if (!bundle || !bundle.success) {
      console.log('hcGetBundle failed: ' + (bundle && bundle.error));
      return;
    }

    var seen = {};
    var cities = [];
    bundle.data.forEach(function (p) {
      var loc = p.location || {};
      var city = String(loc.city || '').trim().toUpperCase();
      var state = String(loc.state || '').trim().toUpperCase();
      if (!city) return;
      var key = city + '|' + state;
      if (seen[key]) return;
      seen[key] = true;
      cities.push({ city: city, state: state });
    });

    if (!cities.length) {
      console.log('No duty-station cities in the HC roster.');
      return;
    }

    console.log(cities.length + ' distinct duty-station city/state pair(s):');
    var unresolved = [];
    cities.forEach(function (c) {
      var r = getAirportsForCity(c.city, c.state);
      var real = (r.airports || []).filter(function (a) { return !a.isMetroArea; });
      if (!real.length) {
        unresolved.push(c);
        console.log('  ' + c.city + ', ' + c.state + '  *** NO MATCH ***');
      } else {
        console.log('  ' + c.city + ', ' + c.state + '  -> ' +
          real.map(function (a) { return a.code; }).join(', '));
      }
    });

    if (unresolved.length) {
      console.log('');
      console.log(unresolved.length + ' city/state pair(s) resolve to NO airport.');
      console.log('A traveller based there gets an empty airport picker.');
      console.log('Run diagUnresolvedCityNames() to see what GSA calls them.');
      console.log('');
      console.log('If an alias for one of these was added recently, a STALE CACHE');
      console.log('entry may be masking it: airport listings cache for 24h, so a');
      console.log('city cached empty before the alias existed keeps reporting NO');
      console.log('MATCH. Bump CP_AIRPORTS_CACHE_VERSION in CityPairs.js to');
      console.log('invalidate every entry at once.');
    }

  } catch (error) {
    console.log('diagDutyStationAirports FAILED: ' + error.message);
  }
}

/**
 * Zero-argument companion to diagDutyStationAirports.
 *
 * Finds the duty-station cities that resolve to no airport, then lists every
 * city name GSA uses in each of THOSE states — so the answer to "what does the
 * award file call this place?" arrives without anyone typing an argument.
 *
 * WHY THIS EXISTS RATHER THAN JUST diagCityNamesForState('TX'): the Apps Script
 * editor cannot pass arguments. The Run button always calls with none, so a
 * function that needs a parameter can only be invoked from a hand-written
 * wrapper — which is exactly the scratch-file pattern this whole file exists
 * to remove.
 *
 * @editor
 */
function diagUnresolvedCityNames() {
  console.log('');
  console.log('--- CITY NAMES FOR UNRESOLVED DUTY STATIONS ---');
  try {
    var bundle = HC.hcGetBundle();
    if (!bundle || !bundle.success) {
      console.log('hcGetBundle failed: ' + (bundle && bundle.error));
      return;
    }

    var seen = {};
    var unresolvedStates = {};
    var unresolvedCities = [];

    bundle.data.forEach(function (p) {
      var loc = p.location || {};
      var city = String(loc.city || '').trim().toUpperCase();
      var state = String(loc.state || '').trim().toUpperCase();
      if (!city) return;
      var key = city + '|' + state;
      if (seen[key]) return;
      seen[key] = true;

      var r = getAirportsForCity(city, state);
      var real = (r.airports || []).filter(function (a) { return !a.isMetroArea; });
      if (!real.length) {
        unresolvedCities.push(city + ', ' + state);
        if (state) unresolvedStates[state] = true;
      }
    });

    if (!unresolvedCities.length) {
      console.log('Every duty-station city resolves to at least one airport.');
      return;
    }

    console.log('Unresolved: ' + unresolvedCities.join('; '));
    Object.keys(unresolvedStates).forEach(function (st) {
      diagCityNamesForState(st);
    });

  } catch (error) {
    console.log('diagUnresolvedCityNames FAILED: ' + error.message);
  }
}

/**
 * Every city name GSA uses in one state, with its airport codes.
 *
 * The companion to diagDutyStationAirports: when a duty station does not
 * resolve, this shows what the award file actually calls the place. Scans both
 * the origin and destination columns, because GSA stores each pair
 * alphabetically so a city appears on whichever side sorts first.
 *
 * @param {string} stateCode two-letter state, e.g. 'TX'
 * @editor
 */
function diagCityNamesForState(stateCode) {
  var state = String(stateCode || '').trim().toUpperCase();
  console.log('');
  console.log('--- GSA CITY NAMES IN ' + (state || '[no state given]') + ' ---');
  if (!state) {
    console.log('Pass a two-letter state code, e.g. diagCityNamesForState("TX").');
    return;
  }
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
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      console.log('City_Pairs is empty. Run syncCityPairs().');
      return;
    }

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.CITY_PAIRS];
    var c = {};
    headers.forEach(function (h, i) { c[h] = i; });
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    var found = {};
    function note(city, st, code) {
      if (String(st || '').trim().toUpperCase() !== state) return;
      var name = String(city || '').trim();
      var abbrev = String(code || '').trim().toUpperCase();
      if (!name || !abbrev) return;
      if (!found[name]) found[name] = {};
      found[name][abbrev] = (found[name][abbrev] || 0) + 1;
    }

    for (var i = 0; i < values.length; i++) {
      note(values[i][c['Origin_City_Name']], values[i][c['Origin_State']],
           values[i][c['Origin_Airport_Abbrev']]);
      note(values[i][c['Destination_City_Name']], values[i][c['Destination_State']],
           values[i][c['Destination_Airport_Abbrev']]);
    }

    var names = Object.keys(found).sort();
    if (!names.length) {
      console.log('No rows found for state ' + state + '.');
      return;
    }
    console.log(names.length + ' city name(s):');
    names.forEach(function (n) {
      var codes = Object.keys(found[n]).sort(function (a, b) {
        return found[n][b] - found[n][a];
      });
      console.log('  ' + n + '  ->  ' + codes.map(function (k) {
        return k + ' (' + found[n][k] + ')';
      }).join(', '));
    });

  } catch (error) {
    console.log('diagCityNamesForState FAILED: ' + error.message);
  }
}

/**
 * Prints the FAS tracker row LETS would submit, beside the expected columns.
 *
 * WHY THIS EXISTS
 * ---------------
 * submitToFASTracker appends to a LIVE sheet owned by the FAS front office and
 * shared across every FAS portfolio. A misaligned row is an uncorrectable
 * write to another organisation's system of record.
 *
 * The previous implementation wrote 14 values in an order matching nothing —
 * its comments claimed column D was Portfolio where the real column D is Event
 * Name. FAS_TRACKER_COLUMNS now fixes the order, but that list was
 * hand-transcribed from what @clolry pasted, and I have never seen the live
 * sheet. A transcription error that happens to pass _verifyTrackerHeader is
 * still possible.
 *
 * So: run this, read the pairs, and compare against the real sheet by eye
 * BEFORE anything is wired up to submit. buildFASTrackerRow and
 * validateForFASTracker live inside the FASTrackerSync IIFE and both take
 * arguments, so neither can be run from the editor dropdown — hence this
 * zero-argument wrapper.
 *
 * READ-ONLY. Builds a row in memory and prints it. Nothing is written
 * anywhere, and the sample request below is fictional.
 *
 * @editor
 */
function diagFasTrackerRow() {
  console.log('');
  console.log('--- FAS TRACKER ROW MAPPING ---');
  try {
    if (typeof FASTrackerSync === 'undefined' || !FASTrackerSync.buildFASTrackerRow) {
      console.log('FASTrackerSync is unavailable or does not export buildFASTrackerRow.');
      return;
    }

    console.log('Environment: ' + FASTrackerSync.getEnvironment());
    console.log('Portfolio code LETS sends: ' + FASTrackerSync.FAS_PORTFOLIO_CODE);
    console.log('');
    console.log('NOTE: FCA/FCB/FCC are DIVISIONS within FC. The tracker asks for');
    console.log('      the portfolio, so it always receives the FC code above.');
    console.log('      The division codes drive internal DAC routing instead.');

    // Fictional. Deliberately exercises a two-traveller, two-org request,
    // because that is the case the single-office form could not represent.
    var sample = {
      requestId: 'LETS-DIAG',
      eventName: 'DIAGNOSTIC SAMPLE — not a real request',
      startDate: '2027-03-15',
      endDate: '2027-03-17',
      submitterEmail: (function () {
        try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
      })(),
      salesforceLink: '',
      travelTypes: ['Customer Meeting', 'Site Visits, Inspections, Acceptance, Delivery'],
      missionCriticalTypes: ['Industry/Customer Engagement Supporting Acquisition'],
      primaryJustification: 'Customer, vendor, or stakeholder engagement with defined outcome',
      isInternational: false,
      isOCONUS: false,
      sharedTotal: 500,
      grandTotal: 3224,
      legs: [{ city: 'CHICAGO', state: 'IL', country: 'United States' }],
      travelers: [
        { employeeName: 'Sample Traveler A', orgCode: 'FCA',
          dutyStationCity: 'WASHINGTON', dutyStationState: 'DC',
          transportationTotal: 224, lodgingTotal: 900, mieTotal: 300,
          localTravelTotal: 0, otherTotal: 430 },
        { employeeName: 'Sample Traveler B', orgCode: 'FCB',
          dutyStationCity: 'PHILADELPHIA', dutyStationState: 'PA',
          transportationTotal: 180, lodgingTotal: 600, mieTotal: 200,
          localTravelTotal: 0, otherTotal: 290 }
      ]
    };

    var check = FASTrackerSync.validateForFASTracker(sample);
    console.log('');
    console.log('Validation: ' + (check.valid ? 'complete' :
      'INCOMPLETE — ' + check.missing.join('; ')));

    var row = FASTrackerSync.buildFASTrackerRow(sample);
    var cols = FASTrackerSync.FAS_TRACKER_COLUMNS;
    var readonly = FASTrackerSync.FAS_TRACKER_READONLY_COLUMNS || [];

    console.log('');
    console.log('Row width: ' + row.length + ' (tracker has ' + cols.length + ' columns)');
    if (row.length !== cols.length) {
      console.log('  *** WIDTH MISMATCH — do not submit ***');
    }
    console.log('');
    console.log('Column-by-column. Compare the LEFT side against the live sheet header:');
    for (var i = 0; i < cols.length; i++) {
      var letter = _columnLetter_(i + 1);
      var name = String(cols[i]).replace(/\s+/g, ' ').trim();
      var value = row[i];
      var shown;
      if (readonly.indexOf(cols[i]) !== -1) {
        shown = '[blank — FAS front office owns this column]';
      } else if (value === '' || value === null || value === undefined) {
        shown = '[empty]';
      } else {
        // Multi-line cells are collapsed for readability; the real cell keeps
        // its newlines, which is deliberate (option labels contain commas).
        shown = String(value).replace(/\n/g, ' | ');
        if (shown.length > 90) shown = shown.substring(0, 87) + '...';
      }
      console.log('  ' + letter + '  ' + name);
      console.log('       -> ' + shown);
    }

    console.log('');
    console.log('If any column name above does not match the live sheet, update');
    console.log('FAS_TRACKER_COLUMNS in server/30_services/FASTrackerSync.gs.');
    console.log('submitToFASTracker refuses to write when the header disagrees,');
    console.log('so a mismatch blocks the submission rather than corrupting a row.');

  } catch (error) {
    console.log('diagFasTrackerRow FAILED: ' + error.message);
  }
}

/** 1 -> A, 27 -> AA. For comparing against a spreadsheet by eye. */
function _columnLetter_(n) {
  var s = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Compares the live tracker header against FAS_TRACKER_COLUMNS.
 *
 * FAS_TRACKER_COLUMNS was transcribed from a paste; nobody on this side has
 * opened the sheet. diagFasTrackerRow() prints what LETS would send, but
 * comparing that against a real header BY EYE is unreliable — the live header
 * contains embedded newlines and at least one trailing space, neither of which
 * is visible in a log.
 *
 * This reads row 1 of whichever sheet the environment gate resolves (the TEST
 * copy in development) and diffs it cell by cell.
 *
 * Read-only.
 *
 * @editor
 */
function diagFasTrackerHeader() {
  console.log('');
  console.log('--- FAS TRACKER HEADER COMPARISON ---');
  try {
    if (typeof FASTrackerSync === 'undefined' || !FASTrackerSync.compareTrackerHeader) {
      console.log('FASTrackerSync is unavailable or does not export compareTrackerHeader.');
      return;
    }

    var r = FASTrackerSync.compareTrackerHeader();
    console.log('Environment: ' + r.environment +
      (r.isProduction ? '  *** PRODUCTION — this is the OFFICIAL sheet ***' : '  (test copy)'));

    if (!r.success) {
      console.log('Could not compare: ' + r.message);
      return;
    }

    console.log('Target: ' + r.sheetName);
    console.log('Columns: sheet has ' + r.headerCount + ', LETS expects ' + r.expectedCount);
    console.log('');

    if (!r.differences.length) {
      console.log('EXACT MATCH — every column name is byte-identical.');
    } else {
      var blocking = r.differences.filter(function (d) {
        return d.issue !== 'whitespace only (tolerated)' && d.issue !== 'extra column in the sheet';
      });
      console.log(r.differences.length + ' difference(s), ' + blocking.length + ' blocking:');
      r.differences.forEach(function (d) {
        console.log('');
        console.log('  ' + d.column + '  ' + d.issue);
        // JSON-quoted so newlines and trailing spaces are VISIBLE. Printing
        // them raw is what makes this class of mismatch so hard to spot.
        console.log('    expected: ' + JSON.stringify(d.expected));
        console.log('    actual:   ' + JSON.stringify(d.actual));
      });
    }

    console.log('');
    console.log(r.matches
      ? 'A submission WOULD be allowed — no blocking mismatches.'
      : 'A submission would be REFUSED. Update FAS_TRACKER_COLUMNS in ' +
        'server/30_services/FASTrackerSync.gs to match the sheet.');

  } catch (error) {
    console.log('diagFasTrackerHeader FAILED: ' + error.message);
  }
}

/**
 * Trip Overview and budget-attribution fields on recent requests.
 *
 * Six Trip Overview inputs existed in the form for the entire life of the
 * budget layer and were NEVER STORED — no JS read them and no column held
 * them, so every Owning Office and Purpose of Travel selection was discarded
 * at submission. That is also why BudgetEngine has no callers.
 *
 * This shows whether the new columns are actually being populated. Expect
 * blanks on anything submitted before the columns existed; that is correct,
 * not a bug.
 *
 * @editor
 */
function diagTripOverviewFields() {
  console.log('');
  console.log('--- TRIP OVERVIEW / BUDGET ATTRIBUTION ---');
  try {
    if (!TRAVEL_DB_SPREADSHEET_ID) {
      console.log('TRAVEL_DB_SPREADSHEET_ID unset; skipping.');
      return;
    }
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.REQUESTS);
    if (!sheet) {
      console.log('Requests tab missing. Run setupTravelDatabase().');
      return;
    }

    var schema = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.REQUESTS];
    var width = sheet.getLastColumn();
    console.log('Requests columns: sheet has ' + width + ', schema expects ' + schema.length);
    if (width < schema.length) {
      console.log('  -> run setupTravelDatabase() to widen the header row');
      return;
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      console.log('No requests yet.');
      return;
    }

    var c = {};
    schema.forEach(function (h, i) { c[h] = i; });
    var take = Math.min(5, lastRow - 1);
    var rows = sheet.getRange(lastRow - take + 1, 1, take, schema.length).getValues();

    console.log('Last ' + take + ' request(s):');
    rows.forEach(function (r) {
      console.log('');
      console.log('  ' + r[c['Request_ID']] + '  ' + r[c['Trip_Name']]);
      console.log('    Owning_Office:      ' + (r[c['Owning_Office']] || '[empty]'));
      console.log('    Owning_Org_Code:    ' + (r[c['Owning_Org_Code']] || '[empty]'));
      console.log('    Travel_Purpose:     ' + (r[c['Travel_Purpose']] || '[empty]'));
      console.log('    Set_Aside_Type:     ' + (r[c['Set_Aside_Type']] || '[empty]'));
      console.log('    Primary_Justification: ' + (r[c['Primary_Justification']] || '[empty]'));
      console.log('    Traveler_Org_Codes: ' + (r[c['Traveler_Org_Codes']] || '[empty]'));
    });

    // Per-traveller attribution is the point: a consolidated request can draw
    // on FCA, FCB and FCC at once, and each DAC should see only their share.
    var tSheet = ss.getSheetByName(SHEET_NAMES.REQUEST_TRAVELERS);
    if (tSheet && tSheet.getLastRow() > 1) {
      var tSchema = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.REQUEST_TRAVELERS];
      if (tSheet.getLastColumn() >= tSchema.length) {
        var tc = {};
        tSchema.forEach(function (h, i) { tc[h] = i; });
        var tTake = Math.min(8, tSheet.getLastRow() - 1);
        var tRows = tSheet.getRange(tSheet.getLastRow() - tTake + 1, 1, tTake, tSchema.length).getValues();
        console.log('');
        console.log('Last ' + tTake + ' traveller row(s), budget attribution:');
        tRows.forEach(function (r) {
          console.log('  ' + (r[tc['Employee_Name']] || '?') +
            '  org=' + (r[tc['Budget_Org_Code']] || '[empty]') +
            '  office=' + (r[tc['Budget_Office_Code']] || '[empty]') +
            '  subtotal=' + (r[tc['Subtotal']] || 0));
        });
      } else {
        console.log('');
        console.log('Request_Travelers is narrower than its schema; run setupTravelDatabase().');
      }
    }

  } catch (error) {
    console.log('diagTripOverviewFields FAILED: ' + error.message);
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

// ============================================================================
// EDITOR RUNNERS — argument-free wrappers for functions that take parameters
// ============================================================================
//
// WHY THESE EXIST
// ---------------
// @clolry: "please add the wrapper to the 99_triggers/Diagnostics file so I can
// run the functions."
//
// The Apps Script Run button calls with NO arguments. importRoster(token) and
// releaseSetAside(entry) therefore cannot be run from the dropdown at all —
// they receive undefined and refuse. The workaround is a one-line wrapper, and
// pasting one into the editor is not a workaround: `clasp push --force`
// overwrites the project from the repository, so anything typed in the editor
// is deleted by the next deploy. That is the same loss this file's header
// describes happening three times during the City Pair work.
//
// WHY THEY LOG INSTEAD OF RETURNING
// ---------------------------------
// A value returned to the Run button goes nowhere. @clolry ran
// previewRosterImport twice and saw only the TravelDB reads and "Execution
// completed" — it had done all its work and displayed none of it, which reads
// as success. Every wrapper here prints its result.
//
// THESE ARE THE ONE EXCEPTION TO THIS FILE'S "DO NOT ADD ANYTHING THAT WRITES"
// RULE, AND THE EXCEPTION IS NARROW
// ----------------------------------------------------------------------------
// runRosterImport and runReleaseSetAside DO write. They are here because the
// alternative is worse: a wrapper that only exists in the editor is lost on
// every deploy, and the person who needs it is the one least able to diagnose
// why it vanished.
//
// The guard is that they add NO new authority. Each calls a function that
// already checks isTravelAdmin and takes its own lock, so a wrapper cannot do
// anything its target would refuse. What a wrapper CAN do is make a
// destructive action one click away, so the two that write are named `run…`
// rather than `diag…`, and each re-runs its own preview rather than accepting a
// pasted token.
//
// DO NOT add a wrapper for a function that lacks its own admin guard.

/**
 * Preview the HR roster import, and print the result.
 *
 * Reads the FAS HRLinks feed, compares it to HC_Positions, and reports what
 * would change. WRITES NOTHING.
 *
 * Read three numbers before importing:
 *   outOfScope              should be roughly 3,360 — the other four FAS
 *                           portfolios. If it is near zero, the scope filter
 *                           is not applying and the import would admit
 *                           supervisors from other portfolios to LETS.
 *   remove, NOT test data   should be 0. Anything else means the feed omits
 *                           someone currently in the roster, and importing
 *                           would revoke their access.
 *   occupancyDisagreement   the feed has two status columns; a large count
 *                           means occupancy is being read from the wrong one,
 *                           which moves every service centre's budget share.
 *
 * @editor
 */
function runRosterPreview() {
  var r = previewRosterImport();
  if (!r || r.success !== true) {
    console.log('PREVIEW FAILED:');
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  // THE FULL PAYLOAD IS NO LONGER PRINTED HERE.
  //
  // It was, and @clolry's run hit "Logging output too large. Truncating
  // output." — with the headcount table, the one block the budget depends on,
  // as the thing cut off. It sits last in a payload carrying 1,046 positions'
  // worth of diff, so it is always the casualty.
  //
  // previewRosterImport logs its own decision-first summary above this, which
  // is what a human needs. The detail blocks are printed SELECTIVELY below,
  // smallest-first, so nothing important is lost to truncation.
  var d = r.data;

  console.log('');
  console.log('--- column mapping ---');
  console.log(JSON.stringify(d.mapping, null, 2));

  if ((d.deletes || []).length) {
    console.log('');
    console.log('--- would REMOVE (not test data) ---');
    d.deletes.forEach(function (p2) {
      console.log('  ' + p2.positionNumber + '  ' + p2.employeeName +
                  '  ' + p2.orgCode);
    });
  }

  if ((d.blocked || []).length) {
    console.log('');
    console.log('--- blocked rows ---');
    d.blocked.slice(0, 25).forEach(function (b) {
      console.log('  row ' + b.row.sourceRow + '  ' + b.row.employeeName +
                  ': ' + b.problems.join(' | '));
    });
  }

  if (d.occupancyDisagreement && (d.occupancyDisagreement.samples || []).length) {
    console.log('');
    console.log('--- occupancy cross-check samples ---');
    d.occupancyDisagreement.samples.slice(0, 10).forEach(function (c) {
      console.log('  ' + c.positionNumber + '  ' + c.employeeName +
                  '  primary="' + c.primaryValue + '" -> ' + c.chosen +
                  ',  secondary="' + c.secondaryValue + '" -> ' + c.alternative);
    });
  }

  console.log('');
  console.log('For the per-service-centre headcount table, run ' +
              'showServiceCentreHeadcount() in 40_domain/HCRosterSync.js.');
}

/**
 * Apply the HR roster import. DESTRUCTIVE — replaces every row in
 * HC_Positions, including deletions.
 *
 * TAKES ITS OWN FRESH PREVIEW rather than a pasted token, deliberately. A
 * token copied out of an earlier log describes a state of the feed that may
 * have changed since, and confirming a preview nobody re-read is the thing the
 * token exists to prevent. This way the preview that authorises the import is
 * always the one that just ran, and its summary is printed above the result.
 *
 * STILL REFUSES if the preview reports anything that should stop an import:
 * removals that are not test data, or zero importable positions. Those are
 * conditions a human should look at, not click past.
 *
 * @editor
 */
function runRosterImport() {
  var p = previewRosterImport();
  if (!p || p.success !== true) {
    console.log('PREVIEW FAILED — nothing imported:');
    console.log(JSON.stringify(p, null, 2));
    return;
  }

  var c = p.data.counts;

  // THE ORG HIERARCHY MUST EXIST FIRST, or the import succeeds and every
  // budget figure it feeds is zero.
  //
  // The per-capita split walks each position's stored parent chain to the
  // nearest SERVICE_CENTER row in HC_Orgs. With only the four seed rows
  // loaded — which carry no Org_Level — there is nothing to roll up to.
  // @clolry's first preview showed 817 filled positions and "service centres
  // 0" for exactly this reason.
  //
  // Refused rather than warned, because the symptom surfaces on the budget
  // page two steps from the cause, and hcLoadRealOrgCodes is a ten-second fix.
  var oh = p.data.orgHierarchy || {};
  if (!oh.ready) {
    console.log('REFUSING: HC_Orgs has no service-centre hierarchy (' +
                (oh.rows || 0) + ' row(s), ' + (oh.serviceCentres || 0) +
                ' service centres).');
    console.log('Every per-capita budget allocation would be zero, and the ' +
                'org chart would have nothing to nest positions under.');
    console.log('');
    console.log('FIX: run hcLoadRealOrgCodes() in 40_domain/HCAdmin.js, then ' +
                'run this again.');
    return;
  }

  // A real person the feed no longer lists loses supervisor-based LETS access
  // and stops counting toward their org's per-capita share. That may be
  // correct — people do leave — but it is not something to discover
  // afterwards.
  if (c.deletes > 0) {
    console.log('REFUSING: the import would remove ' + c.deletes +
                ' position(s) that are NOT test data.');
    console.log('These people are in HC_Positions and absent from the feed. ' +
                'Each one removed loses supervisor-based LETS access and ' +
                'stops counting toward their org\'s per-capita budget share.');
    console.log('');
    console.log(JSON.stringify(p.data.deletes, null, 2));
    console.log('');
    console.log('If every removal above is correct, apply it with:');
    console.log('  importRoster(' + JSON.stringify(p.data.token) + ')');
    console.log('called from a scratch function — this wrapper will not do it ' +
                'for you.');
    return;
  }

  if (!c.positions) {
    console.log('REFUSING: the feed produced no importable positions.');
    return;
  }

  console.log('');
  console.log('--- applying ---');
  console.log(JSON.stringify(importRoster(p.data.token), null, 2));
}

/**
 * Empty HC_Positions. DESTRUCTIVE.
 *
 * @clolry: "Remove all data in the existing HC sheet - I added our team for
 * testing purposes."
 *
 * Needed because runRosterImport deliberately REFUSES when the import would
 * remove positions that are not recognisable fixtures. Eight of the 24 current
 * rows are hand-entered team members with real @gsa.gov addresses, so
 * identifySeedRows correctly declines to treat them as test data. The right
 * answer is a deliberate clear, not a weaker refusal.
 *
 * Leaves HC_Orgs alone. That is reference data — 137 org codes with their
 * parents and levels — and the per-capita budget split walks each position's
 * parent chain to the nearest SERVICE_CENTER row in it. Clearing it would make
 * every allocation zero.
 *
 * TWO STEPS. This prints every row it would remove and stops; pass true to the
 * underlying function to apply it. The dry run is the default because the Run
 * button passes no arguments, so a misclick lists and halts.
 *
 * @editor
 */
function runClearHCPositions() {
  var r = clearHCPositions(true);
  console.log('');
  console.log(JSON.stringify({
    success: r.success, removed: r.removed, error: r.error, message: r.message
  }, null, 2));
}

/**
 * Preview the directory email lookup, and print the result.
 *
 * The FAS feed has no email column, and Email_Address is how LETS identifies a
 * signed-in user (Access.js:435). This resolves addresses from the Google
 * domain directory by name. WRITES NOTHING.
 *
 * Needs the People advanced service: editor -> Services -> People API (v1).
 *
 * EXPECT REFUSALS, and read them — they are the useful output. A name matching
 * two people in the directory is refused rather than guessed, because a wrong
 * address grants LETS access to the wrong person. Those are the ones to set by
 * hand.
 *
 * @editor
 */
function runDirectoryPreview() {
  var r = previewDirectoryEmails({});
  if (!r || r.success !== true) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  // SUMMARY ONLY, plus a capped sample.
  //
  // @clolry's run printed "Logging output too large. Truncating output." and
  // the 50 refusal objects — each carrying a full paragraph of reason text —
  // were what filled the budget. The summary is the decision; the refusals
  // are evidence, and ten of them say as much as fifty.
  var d = r.data;
  console.log('=== previewDirectoryEmails — NOTHING WAS WRITTEN ===');
  console.log(JSON.stringify(d.summary, null, 2));

  if ((d.resolved || []).length) {
    console.log('');
    console.log('--- resolved (first 10) ---');
    d.resolved.slice(0, 10).forEach(function (x) {
      console.log('  ' + x.employeeName + '  ->  ' + x.email +
                  '   (' + x.method + ')');
    });
  }

  if ((d.refused || []).length) {
    console.log('');
    console.log('--- refused (first 10) ---');
    d.refused.slice(0, 10).forEach(function (x) {
      console.log('  ' + x.employeeName + '  [' + x.method + ', ' +
                  x.candidateCount + ' candidate(s)]');
    });
    console.log('');
    console.log('To see exactly what the directory returned for one of them, ' +
                'run diagnoseDirectoryMatch() in 40_domain/DirectoryResolve.js.');
  }
}

/**
 * Resolve directory email addresses and WRITE them to HC_Positions.
 *
 * Time-boxed to about four minutes and resumable: run it repeatedly until the
 * output reports complete:true. Roughly 900 positions at one network call each
 * does not fit in a single six-minute execution.
 *
 * Never overwrites an existing address, and never writes a guess.
 *
 * @editor
 */
function runDirectoryResolve() {
  var r = resolveDirectoryEmails({});
  console.log(JSON.stringify(r, null, 2));
  if (r && r.success && r.data && !r.data.complete) {
    console.log('');
    console.log('NOT COMPLETE — run this again to continue from position ' +
                r.data.nextIndex + '. Or install the hourly trigger: ' +
                'installDirectoryLookupTrigger() in ' +
                '40_domain/DirectoryResolve.js.');
  }
}

/**
 * Print the current budget dashboard payload.
 *
 * Useful for checking the FY27 figures without loading the page: the DAC
 * balances, the set-aside breakdown, the per-service-centre allocations and
 * the release funding for the FC senior advisor.
 *
 * @editor
 */
function runBudgetDashboard() {
  console.log(JSON.stringify(getBudgetDashboard(), null, 2));
}
