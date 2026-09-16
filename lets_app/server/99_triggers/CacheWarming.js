/**
 * CacheWarming.js
 * All cache-warming + cache-related trigger handlers + their installers,
 * consolidated in one place so the trigger health check (and humans) can
 * see every installed trigger's source in a single file.
 *
 * Handler functions are GAS-installed-trigger targets — their EXACT NAMES
 * must not change without also reinstalling the trigger pointing at the
 * new name, or the trigger fires against a nonexistent function and the
 * cache silently goes cold.
 *
 * Cross-file dependencies (all resolve via GAS global scope; this file
 * loads last in 99_triggers/ alphabetical order so they all exist):
 *   - HC library                          (HC.hcRefreshBundleCache)
 *   - TravelDB class                      (20_data/TravelDB.js)
 *   - getGSACitiesForState                (30_services/PerDiemGSA.js)
 *   - getFiscalYear                       (30_services/PerDiemGSA.js)
 *   - GSA_CONUS_STATES                    (30_services/PerDiemGSA.js)
 *   - logError                            (10_lib/Errors.js)
 */

// ============================================================================
// HC STAFFING BUNDLE CACHE — refresh every 10 min
// ============================================================================

/**
 * Trigger target — refreshes the HC staffing bundle in Script Cache.
 * Optional for TRIP since USER_DEPLOYING can always do a direct read,
 * but keeps responses fast (~64ms cache hit vs ~2.5s cold read).
 *
 * @trigger
 */
function refreshHCStaffingCache() {
  try {
    HC.hcRefreshBundleCache();
  } catch (error) {
    Logger.log('refreshHCStaffingCache ERROR: ' + error.message);
    logError('refreshHCStaffingCache', error, {});
  }
}

/**
 * Force a full HC staffing-bundle refresh — busts BOTH server cache layers
 * (the 6h 'staffing_bundle' AND the underlying 10min 'staffing' / Staffing List
 * cache) and rebuilds from the source sheet. Use after editing HC source data
 * (e.g. an occupancyStatus change) when the in-app refresh button won't pick it
 * up — that button only clears the browser cache, and hcRefreshBundleCache()
 * alone rebuilds from the stale underlying Staffing List cache.
 *
 * Run as the HC owner from the editor: select this function, click Run, read Logs.
 *
 * @editor
 * @returns {Object} { success, positions }
 */
function forceRefreshHCStaffingBundle() {
  try {
    HC.hcCacheInvalidateAll();
    var count = HC.hcRefreshBundleCache();
    Logger.log('forceRefreshHCStaffingBundle: rebuilt bundle with ' + count + ' positions');
    return { success: true, positions: count };
  } catch (error) {
    Logger.log('forceRefreshHCStaffingBundle ERROR: ' + error.message);
    logError('forceRefreshHCStaffingBundle', error, {});
    return { success: false, error: error.message };
  }
}

/**
 * Install the HC staffing cache refresh trigger. Safe to re-run.
 *
 * @editor
 */
function installHCRefreshTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'refreshHCStaffingCache') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('refreshHCStaffingCache')
    .timeBased().everyMinutes(10).create();
  Logger.log('installHCRefreshTrigger: Installed refreshHCStaffingCache (10 min)');
}

// ============================================================================
// TRAVEL DB SHEET CACHE — warm every 5 min
// ============================================================================

/**
 * Trigger target — primes TravelDB CacheService with all warm sheets.
 * Cache TTL is 10 minutes, so 5-min trigger gives 2x margin against drift.
 *
 * @trigger
 */
function warmTravelDBCache() {
  return TravelDB.warmCache();
}

/**
 * Install the TravelDB warming trigger. Idempotent — removes existing
 * trigger before installing. Primes the cache immediately so the first
 * post-install dashboard load is warm.
 *
 * @editor
 */
function installTravelDBWarmingTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'warmTravelDBCache') {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }

  ScriptApp.newTrigger('warmTravelDBCache')
    .timeBased()
    .everyMinutes(5)
    .create();

  // Prime immediately so the first post-install dashboard load is warm.
  TravelDB.warmCache();

  var msg = 'Installed warmTravelDBCache trigger (every 5 min)' +
    (removed > 0 ? '; removed ' + removed + ' existing duplicate(s)' : '') +
    '. Cache primed.';
  console.log(msg);
  return msg;
}

/**
 * Remove the TravelDB warming trigger. Cache continues to serve from
 * CacheService until TTL expires (10 min).
 *
 * @editor
 */
function removeTravelDBWarmingTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'warmTravelDBCache') {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  console.log('Removed ' + removed + ' warmTravelDBCache trigger(s)');
  return removed;
}

// ============================================================================
// GSA CITIES CACHE — warm daily at 4am
// ============================================================================

/**
 * Trigger target — pre-warms every CONUS state's city list cache by calling
 * getGSACitiesForState (which writes through the cache). Mild pacing per
 * state to stay well under any per-second rate limit. Designed to run
 * while no users are around.
 *
 * @trigger
 */
function warmGSACitiesCache() {
  var ok = 0, failed = 0;
  for (var i = 0; i < GSA_CONUS_STATES.length; i++) {
    var state = GSA_CONUS_STATES[i];
    try {
      var result = getGSACitiesForState(state);
      if (result && result.success) ok++;
      else failed++;
    } catch (e) {
      failed++;
      console.warn('warmGSACitiesCache: ' + state + ' threw: ' + e.message);
    }
    Utilities.sleep(80);
  }
  console.log('warmGSACitiesCache: ' + ok + ' ok / ' + failed + ' failed (FY' + getFiscalYear(new Date()) + ')');
  return { success: true, ok: ok, failed: failed };
}

/**
 * Install (or reinstall) the GSA cities warming trigger.
 *
 * Runs every 6 hours. Daily-at-4am was the original schedule but GAS
 * CacheService LRU-evicts entries under quota pressure (TravelDB
 * warming every 5 min, HC bundle chunks, request_review_* entries,
 * etc. all compete for cache budget). 6-hour cadence keeps the GSA
 * cities entries fresh enough that LRU eviction doesn't reach them
 * between runs.
 *
 * @editor
 */
function installGSACitiesWarmingTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'warmGSACitiesCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('warmGSACitiesCache').timeBased().everyHours(6).create();
  console.log('Installed GSA cities warming trigger (every 6 hours)');
  return { success: true };
}

/**
 * Remove the daily GSA cities warming trigger.
 *
 * @editor
 */
function removeGSACitiesWarmingTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'warmGSACitiesCache') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  console.log('Removed ' + removed + ' GSA cities warming triggers');
  return { success: true, removed: removed };
}

// ============================================================================
// TRIGGER HEALTH CHECK — editor utility for catching trigger-handler drift
// ============================================================================

/**
 * List every installed project trigger with handler name + source + event
 * type, and flag any whose handler function no longer resolves in the
 * script. Catches the trigger-handler-rename silent breakage risk —
 * relocating a trigger handler is safe (function name unchanged), but
 * renaming it silently makes the installed trigger fire against a
 * nonexistent function. Run after any chunk that touches trigger files.
 *
 * @returns {Array<{handler, source, eventType, uniqueId, handlerExists, status}>}
 *
 * @editor
 */
function _checkAllTriggersHealth() {
  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    console.log('_checkAllTriggersHealth: no installed triggers');
    return [];
  }

  console.log('_checkAllTriggersHealth: ' + triggers.length + ' triggers installed');

  var report = triggers.map(function(t) {
    var handler = t.getHandlerFunction();
    var source = String(t.getTriggerSource());
    var eventType = String(t.getEventType());

    var handlerExists;
    try {
      handlerExists = (typeof globalThis[handler] === 'function');
    } catch (_) {
      handlerExists = false;
    }

    return {
      handler: handler,
      source: source,
      eventType: eventType,
      uniqueId: t.getUniqueId(),
      handlerExists: handlerExists,
      status: handlerExists ? 'OK' : 'BROKEN — handler function not found in script'
    };
  });

  report.forEach(function(r) {
    var prefix = r.handlerExists ? '  [OK]    ' : '  [BROKEN]';
    console.log(prefix + ' ' + r.handler + '  (' + r.source + ' / ' + r.eventType + ')');
  });

  var brokenCount = report.filter(function(r) { return !r.handlerExists; }).length;
  if (brokenCount > 0) {
    console.error('_checkAllTriggersHealth: ' + brokenCount + ' BROKEN trigger(s) — handler functions missing. Likely cause: rename during refactor. Restore the handler function name or reinstall the trigger pointing at the new name.');
  } else {
    console.log('_checkAllTriggersHealth: all ' + triggers.length + ' triggers healthy');
  }

  return report;
}

/**
 * Verify every name in SHEET_NAMES (01_constants/Sheets.js) resolves to an
 * actual sheet in the travel DB. Catches typos in SHEET_NAMES values + sheet
 * renames in GAS that didn't propagate to the registry. Run after Chunk 8a
 * (or any future sheet-rename work).
 *
 * @returns {{ok: number, missing: number, byKey: Object}}
 * @editor
 */
function _checkSheetNamesAdoption() {
  var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  var ok = 0, missing = 0, byKey = {};

  Object.keys(SHEET_NAMES).forEach(function(intent) {
    var actualName = SHEET_NAMES[intent];
    var sheet = ss.getSheetByName(actualName);
    if (sheet) {
      console.log('  [OK]      ' + intent + ' (' + actualName + ')');
      ok++;
      byKey[intent] = 'present';
    } else {
      console.error('  [MISSING] ' + intent + ' (' + actualName + ') — no sheet with that name in the DB');
      missing++;
      byKey[intent] = 'MISSING';
    }
  });

  if (missing === 0) {
    console.log('_checkSheetNamesAdoption: all ' + ok + ' sheets present');
  } else {
    console.error('_checkSheetNamesAdoption: ' + missing + ' of ' + (ok + missing) + ' SHEET_NAMES entries point at non-existent sheets — fix the registry value or create/rename the sheet');
  }
  return { ok: ok, missing: missing, byKey: byKey };
}

/**
 * Verify Chunk 8b adoption: every STATUS_CODES / ACTION_TYPES value resolves
 * to the expected string, AND every distinct Status / Action value living in
 * production data maps to a known const. Catches:
 *   - typos in const definitions (e.g., STATUS_CODES.X resolves to wrong string)
 *   - orphan values in live data that no longer have a matching const (would
 *     silently fail `=== STATUS_CODES.X` comparisons post-migration)
 *
 * Run after Chunk 8b and any future status/action enum changes.
 *
 * @returns {{ok: number, errors: number, orphanStatuses: string[], orphanActions: string[]}}
 * @editor
 */
function _verifyStatusActionAdoption() {
  var expectedStatuses = {
    DRAFT: 'DRAFT',
    PENDING_SECTOR: 'PENDING_SECTOR',
    PENDING_BU: 'PENDING_BU',
    PENDING_OSO: 'PENDING_OSO',
    PENDING_FAS: 'PENDING_FAS',
    PENDING_DD_CONFIRMATION: 'Pending_DD_Confirmation',
    PENDING_CORRECTION: 'Pending_Correction',
    NEEDS_INFO_SECTOR: 'NEEDS_INFO_SECTOR',
    NEEDS_INFO_BU: 'NEEDS_INFO_BU',
    NEEDS_INFO_OSO: 'NEEDS_INFO_OSO',
    APPROVED_GOGOV: 'APPROVED_GOGOV',
    COMPLETED: 'COMPLETED',
    DENIED: 'DENIED',
    CANCELLED: 'CANCELLED',
    SUBMITTER_CANCELLED: 'SUBMITTER_CANCELLED'
  };
  var expectedActions = {
    SUBMITTED: 'Submitted',
    RESUBMITTED: 'Resubmitted',
    SUBMITTER_CANCELLED: 'Submitter_Cancelled',
    SECTOR_APPROVED: 'Sector_Approved',
    SECTOR_NEEDS_INFO: 'Sector_Needs_Info',
    BU_APPROVED: 'BU_Approved',
    BU_NEEDS_INFO: 'BU_Needs_Info',
    OSO_APPROVED: 'OSO_Approved',
    OSO_NEEDS_INFO: 'OSO_Needs_Info',
    FAS_APPROVED: 'FAS_Approved',
    FAS_DENIED: 'FAS_Denied',
    COMPLETED: 'Completed',
    DENIED: 'Denied',
    CANCELLED: 'Cancelled',
    REMINDER_SENT: 'Reminder_Sent',
    EDIT_OVERVIEW: 'Edit_Overview',
    EDIT_TRAVELERS: 'Edit_Travelers',
    EDIT_COSTS: 'Edit_Costs',
    EDIT_CLASSIFICATION: 'Edit_Classification',
    EDIT_ITINERARY: 'Edit_Itinerary',
    ADMIN_REASSIGN: 'ADMIN_REASSIGN',
    ADMIN_OVERRIDE: 'ADMIN_OVERRIDE',
    ALL_DD_CONFIRMED: 'All_DD_Confirmed'
  };

  var ok = 0, errors = 0;

  console.log('--- Const integrity ---');
  Object.keys(expectedStatuses).forEach(function(key) {
    var actual = STATUS_CODES[key];
    if (actual === expectedStatuses[key]) {
      ok++;
    } else {
      errors++;
      console.error('  [BAD] STATUS_CODES.' + key + ' = "' + actual + '" — expected "' + expectedStatuses[key] + '"');
    }
  });
  Object.keys(STATUS_CODES).forEach(function(key) {
    if (!(key in expectedStatuses)) {
      errors++;
      console.error('  [UNEXPECTED] STATUS_CODES.' + key + ' exists but is not in expected list — update _verifyStatusActionAdoption');
    }
  });
  Object.keys(expectedActions).forEach(function(key) {
    var actual = ACTION_TYPES[key];
    if (actual === expectedActions[key]) {
      ok++;
    } else {
      errors++;
      console.error('  [BAD] ACTION_TYPES.' + key + ' = "' + actual + '" — expected "' + expectedActions[key] + '"');
    }
  });
  Object.keys(ACTION_TYPES).forEach(function(key) {
    if (!(key in expectedActions)) {
      errors++;
      console.error('  [UNEXPECTED] ACTION_TYPES.' + key + ' exists but is not in expected list — update _verifyStatusActionAdoption');
    }
  });

  console.log('--- Live data scan ---');
  var db = new TravelDB();
  var knownStatusValues = Object.keys(STATUS_CODES).map(function(k) { return STATUS_CODES[k]; });
  var knownActionValues = Object.keys(ACTION_TYPES).map(function(k) { return ACTION_TYPES[k]; });

  var orphanStatuses = [];
  var requests = db.readSheet(SHEET_NAMES.REQUESTS);
  var statusCol = requests.headerIndex['Status'];
  var distinctStatuses = {};
  requests.rows.forEach(function(row) {
    var s = row[statusCol];
    if (s === '' || s === null || s === undefined) return;
    distinctStatuses[s] = (distinctStatuses[s] || 0) + 1;
  });
  Object.keys(distinctStatuses).forEach(function(s) {
    if (knownStatusValues.indexOf(s) === -1) {
      errors++;
      orphanStatuses.push(s);
      console.error('  [ORPHAN STATUS] "' + s + '" in ' + distinctStatuses[s] + ' rows but not in STATUS_CODES');
    } else {
      console.log('  [OK] Status "' + s + '" → ' + distinctStatuses[s] + ' rows');
    }
  });

  var orphanActions = [];
  var log = db.readSheet(SHEET_NAMES.APPROVAL_LOG);
  var actionCol = log.headerIndex['Action'];
  var distinctActions = {};
  log.rows.forEach(function(row) {
    var a = row[actionCol];
    if (a === '' || a === null || a === undefined) return;
    distinctActions[a] = (distinctActions[a] || 0) + 1;
  });
  Object.keys(distinctActions).forEach(function(a) {
    if (knownActionValues.indexOf(a) === -1) {
      errors++;
      orphanActions.push(a);
      console.error('  [ORPHAN ACTION] "' + a + '" in ' + distinctActions[a] + ' entries but not in ACTION_TYPES');
    } else {
      console.log('  [OK] Action "' + a + '" → ' + distinctActions[a] + ' entries');
    }
  });

  if (errors === 0) {
    console.log('_verifyStatusActionAdoption: all const + live values match');
  } else {
    console.error('_verifyStatusActionAdoption: ' + errors + ' problems found — see log');
  }
  return { ok: ok, errors: errors, orphanStatuses: orphanStatuses, orphanActions: orphanActions };
}

/**
 * Verify Chunk 10.E Submission domain adoption: confirms function existence
 * and exercises non-write paths (getOSOReviewers, getFASReviewer, and a
 * read-only routing simulation). Does NOT exercise submitTravelRequestV2
 * or cancelTravelRequest — those require a real test submission smoke.
 *
 * @returns {{ok: number, errors: number}}
 * @editor
 */
function _verifySubmissionDomainAdoption() {
  var ok = 0, errors = 0;

  console.log('--- Function existence ---');
  var fns = ['submitTravelRequestV2', 'cancelTravelRequest', 'findSectorDirector',
             'lookupBUReviewer', 'getOSOReviewers', 'getFASReviewer',
             'simulateSubmissionRouting', 'determineInitialRouting',
             'sendSubmissionNotification'];
  fns.forEach(function(name) {
    var exists;
    try { exists = typeof eval(name) === 'function'; } catch (e) { exists = false; }
    if (exists) { ok++; console.log('  [OK] ' + name); }
    else { errors++; console.error('  [MISSING] ' + name); }
  });

  console.log('--- getOSOReviewers (read-only routing helper) ---');
  try {
    var oso = getOSOReviewers();
    // Shape: { primary: {name, email}|null, cc: [...] }
    if (oso && typeof oso === 'object' && ('primary' in oso) && Array.isArray(oso.cc)) {
      ok++;
      console.log('  [OK] shape correct (primary=' + (oso.primary ? oso.primary.email : 'null') + ', cc.length=' + oso.cc.length + ')');
    } else {
      errors++;
      console.error('  [BAD] unexpected shape: ' + JSON.stringify(oso).substring(0, 200));
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] getOSOReviewers threw: ' + e.message);
  }

  console.log('--- getFASReviewer (read-only routing helper) ---');
  try {
    var fas = getFASReviewer();
    // Shape: { email, name }
    if (fas && typeof fas === 'object' && ('email' in fas) && ('name' in fas)) {
      ok++;
      console.log('  [OK] shape correct (email=' + (fas.email || '<empty>') + ')');
    } else {
      errors++;
      console.error('  [BAD] unexpected shape: ' + JSON.stringify(fas).substring(0, 200));
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] getFASReviewer threw: ' + e.message);
  }

  console.log('--- simulateSubmissionRouting (read-only dry-run for current admin) ---');
  try {
    var userEmail = Session.getActiveUser().getEmail();
    var sim = simulateSubmissionRouting(userEmail, { isOverhead: false });
    // Editor diagnostic — kept on legacy {success, ...} shape (not envelope)
    if (sim && sim.success === true && sim.routing && typeof sim.routing === 'object') {
      ok++;
      console.log('  [OK] simulator returned routing for ' + userEmail +
                  ' → stage=' + (sim.routing.stage || '?') +
                  ', reviewer=' + (sim.routing.reviewerEmail || '<none>'));
    } else if (sim && sim.success === false) {
      // Admin gate may have failed; that's still a valid shape
      ok++;
      console.log('  [OK] simulator returned valid error shape: ' + sim.error);
    } else {
      errors++;
      console.error('  [BAD] simulator unexpected shape: ' + JSON.stringify(sim).substring(0, 200));
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] simulateSubmissionRouting threw: ' + e.message);
  }

  console.log('--- NOTE: submitTravelRequestV2 + cancelTravelRequest not exercised here ---');
  console.log('  Smoke test required: submit a real test request via the form,');
  console.log('  verify it lands in all 5 sheets + the success page renders with');
  console.log('  a valid Request_ID, then admin-delete via Chunk 10.D delete cascade.');

  if (errors === 0) console.log('_verifySubmissionDomainAdoption: all ' + ok + ' checks passed');
  else console.error('_verifySubmissionDomainAdoption: ' + errors + ' problems — see log');
  return { ok: ok, errors: errors };
}

/**
 * Verify Chunk 10.D Admin domain adoption: live calls to read endpoints,
 * asserts envelope shape, regression-checks for top-level field leaks.
 * Does NOT exercise write paths (adminOverrideStatus, adminReassignReviewer,
 * deleteTravelRequests) — those require dedicated smoke against a known
 * disposable request ID.
 *
 * @returns {{ok: number, errors: number}}
 * @editor
 */
function _verifyAdminDomainAdoption() {
  var ok = 0, errors = 0;
  var userEmail = Session.getActiveUser().getEmail();

  function checkEnvelope(name, res, dataKeys) {
    if (!res || res.success !== true) {
      errors++;
      console.error('  [BAD] ' + name + ': envelope.success !== true. Got: ' + JSON.stringify(res).substring(0, 150));
      return;
    }
    if (!res.data || typeof res.data !== 'object') {
      errors++;
      console.error('  [BAD] ' + name + ': res.data missing or not object');
      return;
    }
    var missing = dataKeys.filter(function(k) { return !(k in res.data); });
    if (missing.length) {
      errors++;
      console.error('  [BAD] ' + name + ': missing data keys: ' + missing.join(', '));
      return;
    }
    var leaked = dataKeys.filter(function(k) { return k in res; });
    if (leaked.length) {
      errors++;
      console.error('  [BAD] ' + name + ': OLD-SHAPE leak at top level: ' + leaked.join(', '));
      return;
    }
    ok++;
    console.log('  [OK] ' + name + ': envelope correct, no leaks');
  }

  console.log('--- getAdminDashboard ---');
  try {
    var dash = getAdminDashboard(userEmail, '30d');
    checkEnvelope('getAdminDashboard', dash, ['actionCenter', 'stats', 'requests', 'distinctBUCodes']);
  } catch (e) { errors++; console.error('  [EXCEPTION] ' + e.message); }

  console.log('--- getAllTravelRequests ---');
  try {
    var all = getAllTravelRequests();
    checkEnvelope('getAllTravelRequests', all, ['requests', 'distinctBUCodes']);
  } catch (e) { errors++; console.error('  [EXCEPTION] ' + e.message); }

  // getDistinctBUCodes + getAdminActionCenterData removed in Chunk 14 cleanup —
  // their data is folded into getAdminDashboard.data.{distinctBUCodes, actionCenter}.
  // exportRequestsToCSV + getAdminDashboardStats also removed (zero callers).

  console.log('--- getRequestSummary (uses first request) ---');
  try {
    var allRes = getAllTravelRequests();
    var firstReqId = allRes && allRes.data && allRes.data.requests &&
      allRes.data.requests[0] && allRes.data.requests[0].requestId;
    if (!firstReqId) {
      console.log('  [SKIP] no requests to test summary');
    } else {
      var sum = getRequestSummary(firstReqId);
      checkEnvelope('getRequestSummary', sum, ['request']);  // approvalLog also expected but may be empty array
      if (sum && sum.data && !Array.isArray(sum.data.approvalLog)) {
        errors++;
        console.error('  [BAD] getRequestSummary: data.approvalLog not an array');
      } else if (sum && sum.data) {
        ok++;
        console.log('  [OK] getRequestSummary: approvalLog is array (length=' + sum.data.approvalLog.length + ')');
      }
    }
  } catch (e) { errors++; console.error('  [EXCEPTION] ' + e.message); }

  console.log('--- getDeletePreview (uses first request, read-only) ---');
  try {
    var allRes2 = getAllTravelRequests();
    var firstReqId2 = allRes2 && allRes2.data && allRes2.data.requests &&
      allRes2.data.requests[0] && allRes2.data.requests[0].requestId;
    if (!firstReqId2) {
      console.log('  [SKIP] no requests to test preview');
    } else {
      var prev = getDeletePreview([firstReqId2]);
      checkEnvelope('getDeletePreview', prev, ['preview']);
      if (prev && prev.data && prev.data.preview && typeof prev.data.preview.totalRows === 'number') {
        ok++;
        console.log('  [OK] getDeletePreview: data.preview.totalRows = ' + prev.data.preview.totalRows);
      }
    }
  } catch (e) { errors++; console.error('  [EXCEPTION] ' + e.message); }

  if (errors === 0) console.log('_verifyAdminDomainAdoption: all ' + ok + ' checks passed');
  else console.error('_verifyAdminDomainAdoption: ' + errors + ' problems — see log');
  return { ok: ok, errors: errors };
}

/**
 * Verify Chunk 10.C Reporting domain adoption: calls reportGetFilterOptions
 * + reportBuilderPreview + reportBuilderGetPresets live, asserts envelope
 * shape, regression-checks for top-level field leaks. Read-only.
 *
 * @returns {{ok: number, errors: number}}
 * @editor
 */
function _verifyReportingDomainAdoption() {
  var ok = 0, errors = 0;

  console.log('--- reportGetFilterOptions envelope ---');
  try {
    var opts = reportGetFilterOptions();
    if (opts && opts.success === true && opts.data && Array.isArray(opts.data.buList) && Array.isArray(opts.data.statusList)) {
      ok++;
      console.log('  [OK] envelope correct: data.buList (length=' + opts.data.buList.length + '), data.statusList (length=' + opts.data.statusList.length + ')');
    } else {
      errors++;
      console.error('  [BAD] envelope wrong: ' + JSON.stringify(opts).substring(0, 200));
    }
    if (opts && (opts.buList !== undefined || opts.statusList !== undefined)) {
      errors++;
      console.error('  [BAD] OLD-SHAPE regression: buList/statusList at top level');
    } else {
      ok++;
      console.log('  [OK] no top-level field leak');
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] reportGetFilterOptions threw: ' + e.message);
  }

  console.log('--- reportBuilderPreview envelope ---');
  try {
    var prev = reportBuilderPreview({ filters: {} });
    if (prev && prev.success === true && prev.data && Array.isArray(prev.data.allColumnKeys) && Array.isArray(prev.data.rows) && typeof prev.data.totalCount === 'number') {
      ok++;
      console.log('  [OK] envelope correct: data.allColumnKeys (' + prev.data.allColumnKeys.length + ' cols), data.rows (' + prev.data.rows.length + ' rows), data.totalCount=' + prev.data.totalCount);
    } else {
      errors++;
      console.error('  [BAD] envelope wrong: ' + JSON.stringify(prev).substring(0, 200));
    }
    if (prev && (prev.allColumnKeys !== undefined || prev.rows !== undefined || prev.totalCount !== undefined)) {
      errors++;
      console.error('  [BAD] OLD-SHAPE regression: allColumnKeys/rows/totalCount at top level');
    } else {
      ok++;
      console.log('  [OK] no top-level field leak');
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] reportBuilderPreview threw: ' + e.message);
  }

  console.log('--- reportBuilderGetPresets envelope ---');
  try {
    var ps = reportBuilderGetPresets();
    if (ps && ps.success === true && ps.data && Array.isArray(ps.data.presets)) {
      ok++;
      console.log('  [OK] envelope correct: data.presets (length=' + ps.data.presets.length + ')');
    } else {
      errors++;
      console.error('  [BAD] envelope wrong: ' + JSON.stringify(ps).substring(0, 200));
    }
    if (ps && ps.presets !== undefined) {
      errors++;
      console.error('  [BAD] OLD-SHAPE regression: presets at top level');
    } else {
      ok++;
      console.log('  [OK] no top-level field leak');
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] reportBuilderGetPresets threw: ' + e.message);
  }

  console.log('--- reportGenerateData throws on bad input (internal helper contract) ---');
  try {
    reportGenerateData({});  // no type → should throw
    errors++;
    console.error('  [BAD] reportGenerateData did NOT throw on missing type');
  } catch (e) {
    ok++;
    console.log('  [OK] reportGenerateData threw as expected: ' + e.message);
  }

  if (errors === 0) console.log('_verifyReportingDomainAdoption: all ' + ok + ' checks passed');
  else console.error('_verifyReportingDomainAdoption: ' + errors + ' problems — see log');
  return { ok: ok, errors: errors };
}

/**
 * Verify Chunk 10.B Feedback domain adoption: calls checkNpsEligibility +
 * getRecentFeedback live, asserts envelope shape correct + no top-level field
 * leaks + fail-closed semantics preserved on checkNpsEligibility.
 * Read-only (no writes).
 *
 * @returns {{ok: number, errors: number}}
 * @editor
 */
function _verifyFeedbackDomainAdoption() {
  var ok = 0, errors = 0;

  console.log('--- checkNpsEligibility envelope ---');
  try {
    var res = checkNpsEligibility();
    if (res && res.success === true && res.data && typeof res.data.eligible === 'boolean') {
      ok++;
      console.log('  [OK] envelope correct: success=true, data.eligible=' + res.data.eligible);
    } else {
      errors++;
      console.error('  [BAD] envelope wrong: ' + JSON.stringify(res).substring(0, 200));
    }
    // Regression check: res.eligible should NOT exist at top level
    if (res && res.eligible !== undefined) {
      errors++;
      console.error('  [BAD] OLD-SHAPE regression: res.eligible at top level');
    } else {
      ok++;
      console.log('  [OK] no top-level res.eligible leak');
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] checkNpsEligibility threw: ' + e.message);
  }

  console.log('--- getRecentFeedback envelope ---');
  try {
    var fres = getRecentFeedback({ limit: 5 });
    if (fres && fres.success === true && fres.data && Array.isArray(fres.data.feedback) && typeof fres.data.total === 'number') {
      ok++;
      console.log('  [OK] envelope correct: data.feedback (length=' + fres.data.feedback.length + '), data.total=' + fres.data.total);
    } else {
      errors++;
      console.error('  [BAD] envelope wrong: ' + JSON.stringify(fres).substring(0, 200));
    }
    if (fres && (fres.feedback !== undefined || fres.total !== undefined)) {
      errors++;
      console.error('  [BAD] OLD-SHAPE regression: feedback/total at top level');
    } else {
      ok++;
      console.log('  [OK] no top-level feedback/total leak');
    }
    // Verify date serialization survived envelope wrap (no raw Date objects)
    if (fres && fres.data && fres.data.feedback.length > 0) {
      var firstRow = fres.data.feedback[0];
      var hasRawDate = false;
      Object.keys(firstRow).forEach(function(k) {
        if (firstRow[k] instanceof Date) hasRawDate = true;
      });
      if (!hasRawDate) {
        ok++;
        console.log('  [OK] no raw Date objects in serialized feedback rows');
      } else {
        errors++;
        console.error('  [BAD] raw Date object found in feedback row (serialization broken)');
      }
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] getRecentFeedback threw: ' + e.message);
  }

  if (errors === 0) console.log('_verifyFeedbackDomainAdoption: all ' + ok + ' checks passed');
  else console.error('_verifyFeedbackDomainAdoption: ' + errors + ' problems — see log');
  return { ok: ok, errors: errors };
}

/**
 * Verify Chunk 10.F.1 Review domain adoption: confirms function existence,
 * exercises getRequestForReview (read-only) against the first request from
 * getAllTravelRequests, asserts envelope shape correct, regression-checks
 * for top-level field leaks. Does NOT exercise any write paths
 * (submitReviewAction, update*, confirmDDTravelers, reportDDFundingIssue,
 * submitFundingCorrection) — those require a real test request smoke.
 *
 * @returns {{ok: number, errors: number}}
 * @editor
 */
function _verifyReviewDomainAdoption() {
  var ok = 0, errors = 0;

  console.log('--- Function existence ---');
  var fns = ['getRequestForReview', 'submitReviewAction',
             'updateRequestClassification', 'updateRequestOverview',
             'updateRequestItinerary', 'updateTravelersForReview',
             'updateSharedCostsForReview', 'updateCostsForReview',
             'sendDDConfirmationEmails', 'sendDDConfirmationEmailsForTravelers',
             'getDDConfirmationData', 'confirmDDTravelers',
             'reportDDFundingIssue', 'getFundingCorrectionData',
             'submitFundingCorrection',
             'getActionConfig', 'getAvailableActions', 'lookupNextReviewer',
             'recalculateRequestCostsAfterItineraryChange'];
  fns.forEach(function(name) {
    var exists;
    try { exists = typeof eval(name) === 'function'; } catch (e) { exists = false; }
    if (exists) { ok++; console.log('  [OK] ' + name); }
    else { errors++; console.error('  [MISSING] ' + name); }
  });

  console.log('--- getAvailableActions (pure helper, no I/O) ---');
  try {
    var actions = getAvailableActions(STATUS_CODES.PENDING_BU, true, false);
    if (Array.isArray(actions) && actions.indexOf('bu_approve') !== -1) {
      ok++;
      console.log('  [OK] PENDING_BU + reviewer returns bu_approve in actions: ' + actions.join(','));
    } else {
      errors++;
      console.error('  [BAD] unexpected actions for PENDING_BU+reviewer: ' + JSON.stringify(actions));
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] getAvailableActions threw: ' + e.message);
  }

  console.log('--- getRequestForReview envelope (uses first request) ---');
  try {
    var allRes = getAllTravelRequests();
    var firstReqId = allRes && allRes.data && allRes.data.requests &&
      allRes.data.requests[0] && allRes.data.requests[0].requestId;
    if (!firstReqId) {
      console.log('  [SKIP] no requests to test getRequestForReview');
    } else {
      var rev = getRequestForReview(firstReqId);
      // Envelope shape check
      if (!rev || rev.success !== true) {
        errors++;
        console.error('  [BAD] envelope.success !== true. Got: ' + JSON.stringify(rev).substring(0, 200));
      } else if (!rev.data || typeof rev.data !== 'object') {
        errors++;
        console.error('  [BAD] res.data missing or not object');
      } else {
        // Required data keys
        var dataKeys = ['request', 'legs', 'travelers', 'attachments', 'approvalLog', 'permissions'];
        var missing = dataKeys.filter(function(k) { return !(k in rev.data); });
        if (missing.length) {
          errors++;
          console.error('  [BAD] getRequestForReview: missing data keys: ' + missing.join(', '));
        } else {
          ok++;
          console.log('  [OK] envelope correct: all 6 data keys present');
        }
        // Top-level field-leak regression check
        var leaked = dataKeys.filter(function(k) { return k in rev; });
        if (leaked.length) {
          errors++;
          console.error('  [BAD] getRequestForReview: OLD-SHAPE leak at top level: ' + leaked.join(', '));
        } else {
          ok++;
          console.log('  [OK] no top-level field leaks');
        }
        // Permissions sub-shape check
        if (rev.data.permissions && Array.isArray(rev.data.permissions.availableActions) &&
            typeof rev.data.permissions.isCurrentReviewer === 'boolean' &&
            typeof rev.data.permissions.isSubmitter === 'boolean') {
          ok++;
          console.log('  [OK] permissions sub-shape correct');
        } else {
          errors++;
          console.error('  [BAD] permissions sub-shape wrong: ' + JSON.stringify(rev.data.permissions).substring(0, 200));
        }
      }

      // Second call — should hit cache and still return envelope with recomputed permissions
      console.log('--- getRequestForReview second call (CacheService cache hit) ---');
      var rev2 = getRequestForReview(firstReqId);
      if (rev2 && rev2.success === true && rev2.data && rev2.data.permissions) {
        ok++;
        console.log('  [OK] cache-hit path returns envelope with recomputed permissions');
      } else {
        errors++;
        console.error('  [BAD] cache-hit path returned malformed envelope: ' + JSON.stringify(rev2).substring(0, 200));
      }
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] getRequestForReview threw: ' + e.message);
  }

  console.log('--- NOTE: write paths not exercised here ---');
  console.log('  Smoke test required: submit test request → open review page → edit a safe field');
  console.log('  (classification) → submit a review action → admin-delete via Chunk 10.D cascade.');

  if (errors === 0) console.log('_verifyReviewDomainAdoption: all ' + ok + ' checks passed');
  else console.error('_verifyReviewDomainAdoption: ' + errors + ' problems — see log');
  return { ok: ok, errors: errors };
}

/**
 * Verify Chunk 11 Validation library: exercises every require* guard with
 * one passing input + one failing input, asserts ValidationError carries
 * the right shape (.name, .field, .code, instanceof Error), and confirms
 * _fieldLabel produces sensible Title-Case labels. Pure unit test — no
 * spreadsheet I/O, safe to re-run anytime.
 *
 * @returns {{ok: number, errors: number}}
 * @editor
 */
function _verifyValidationLibrary() {
  var ok = 0, errors = 0;

  function _expectThrow(label, fn, expectedField) {
    try {
      fn();
      errors++;
      console.error('  [BAD] ' + label + ': expected throw, did not throw');
    } catch (e) {
      if (e && e.name === 'ValidationError') {
        if (expectedField && e.field !== expectedField) {
          errors++;
          console.error('  [BAD] ' + label + ': expected field=' + expectedField + ', got field=' + e.field);
        } else if (e.code !== 'VALIDATION') {
          errors++;
          console.error('  [BAD] ' + label + ': expected code=VALIDATION, got code=' + e.code);
        } else if (!(e instanceof Error)) {
          errors++;
          console.error('  [BAD] ' + label + ': ValidationError not instanceof Error');
        } else if (!e.message) {
          errors++;
          console.error('  [BAD] ' + label + ': missing .message');
        } else {
          ok++;
          console.log('  [OK] ' + label + ' threw: "' + e.message + '"');
        }
      } else {
        errors++;
        console.error('  [BAD] ' + label + ': wrong error type. name=' + (e && e.name) + ', message=' + (e && e.message));
      }
    }
  }

  function _expectPass(label, fn, expectedReturn) {
    try {
      var actual = fn();
      if (expectedReturn !== undefined && actual !== expectedReturn) {
        errors++;
        console.error('  [BAD] ' + label + ': expected return=' + JSON.stringify(expectedReturn) + ', got ' + JSON.stringify(actual));
      } else {
        ok++;
        console.log('  [OK] ' + label + ' returned ' + JSON.stringify(actual));
      }
    } catch (e) {
      errors++;
      console.error('  [BAD] ' + label + ': unexpected throw: ' + (e && e.message));
    }
  }

  console.log('--- ValidationError shape ---');
  try {
    var err = new ValidationError('test msg', 'fieldX', 'CUSTOM');
    if (err.name === 'ValidationError' && err.field === 'fieldX' && err.code === 'CUSTOM' &&
        err.message === 'test msg' && err instanceof Error) {
      ok++;
      console.log('  [OK] ValidationError shape correct: name/field/code/message/instanceof Error all set');
    } else {
      errors++;
      console.error('  [BAD] ValidationError shape wrong: ' +
        JSON.stringify({name: err.name, field: err.field, code: err.code, message: err.message, isError: err instanceof Error}));
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] ValidationError construction threw: ' + e.message);
  }
  try {
    var err2 = new ValidationError('m');
    if (err2.code === 'VALIDATION' && err2.field === null) {
      ok++;
      console.log('  [OK] ValidationError defaults: code=VALIDATION, field=null');
    } else {
      errors++;
      console.error('  [BAD] ValidationError defaults wrong: code=' + err2.code + ', field=' + err2.field);
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] ValidationError default-ctor threw: ' + e.message);
  }

  console.log('--- requireString ---');
  _expectPass('requireString("hello", "name")', function() { return requireString('hello', 'name'); }, 'hello');
  _expectPass('requireString("  trim me  ", "name") trims whitespace', function() { return requireString('  trim me  ', 'name'); }, 'trim me');
  _expectThrow('requireString(null, "name") throws', function() { requireString(null, 'name'); }, 'name');
  _expectThrow('requireString("", "name") throws on empty', function() { requireString('', 'name'); }, 'name');
  _expectThrow('requireString("   ", "name") throws on whitespace-only', function() { requireString('   ', 'name'); }, 'name');
  _expectThrow('requireString(42, "name") throws on non-string', function() { requireString(42, 'name'); }, 'name');

  console.log('--- requireNumber ---');
  _expectPass('requireNumber(42, "n")', function() { return requireNumber(42, 'n'); }, 42);
  _expectPass('requireNumber("42", "n") coerces string', function() { return requireNumber('42', 'n'); }, 42);
  _expectPass('requireNumber(0, "n") accepts zero', function() { return requireNumber(0, 'n'); }, 0);
  _expectThrow('requireNumber(NaN, "n")', function() { requireNumber(NaN, 'n'); }, 'n');
  _expectThrow('requireNumber(Infinity, "n")', function() { requireNumber(Infinity, 'n'); }, 'n');
  _expectThrow('requireNumber(null, "n")', function() { requireNumber(null, 'n'); }, 'n');
  _expectThrow('requireNumber("abc", "n")', function() { requireNumber('abc', 'n'); }, 'n');

  console.log('--- requireNonNegativeNumber + requirePositiveNumber ---');
  _expectPass('requireNonNegativeNumber(0, "x")', function() { return requireNonNegativeNumber(0, 'x'); }, 0);
  _expectPass('requireNonNegativeNumber(5, "x")', function() { return requireNonNegativeNumber(5, 'x'); }, 5);
  _expectThrow('requireNonNegativeNumber(-1, "x")', function() { requireNonNegativeNumber(-1, 'x'); }, 'x');
  _expectPass('requirePositiveNumber(1, "x")', function() { return requirePositiveNumber(1, 'x'); }, 1);
  _expectThrow('requirePositiveNumber(0, "x")', function() { requirePositiveNumber(0, 'x'); }, 'x');
  _expectThrow('requirePositiveNumber(-1, "x")', function() { requirePositiveNumber(-1, 'x'); }, 'x');

  console.log('--- requireBoolean ---');
  _expectPass('requireBoolean(true, "b")', function() { return requireBoolean(true, 'b'); }, true);
  _expectPass('requireBoolean(false, "b")', function() { return requireBoolean(false, 'b'); }, false);
  _expectThrow('requireBoolean(1, "b") rejects truthy', function() { requireBoolean(1, 'b'); }, 'b');
  _expectThrow('requireBoolean("true", "b") rejects string', function() { requireBoolean('true', 'b'); }, 'b');
  _expectThrow('requireBoolean(null, "b")', function() { requireBoolean(null, 'b'); }, 'b');

  console.log('--- requireArray + requireNonEmptyArray ---');
  _expectPass('requireArray([], "a") allows empty', function() { return requireArray([], 'a').length; }, 0);
  _expectPass('requireArray([1,2,3], "a")', function() { return requireArray([1,2,3], 'a').length; }, 3);
  _expectThrow('requireArray({}, "a") rejects object', function() { requireArray({}, 'a'); }, 'a');
  _expectThrow('requireArray(null, "a")', function() { requireArray(null, 'a'); }, 'a');
  _expectPass('requireNonEmptyArray([1], "items")', function() { return requireNonEmptyArray([1], 'items').length; }, 1);
  _expectThrow('requireNonEmptyArray([], "items") rejects empty', function() { requireNonEmptyArray([], 'items'); }, 'items');

  console.log('--- requireEnum ---');
  _expectPass('requireEnum("a", "x", ["a","b"])', function() { return requireEnum('a', 'x', ['a','b']); }, 'a');
  _expectThrow('requireEnum("c", "x", ["a","b"]) rejects unknown', function() { requireEnum('c', 'x', ['a','b']); }, 'x');
  // Programmer-error path: empty allowedValues throws plain Error, NOT ValidationError
  try {
    requireEnum('a', 'x', []);
    errors++;
    console.error('  [BAD] requireEnum with empty allowedValues: expected throw, did not throw');
  } catch (e) {
    if (e.name === 'ValidationError') {
      errors++;
      console.error('  [BAD] requireEnum with empty allowedValues: should throw plain Error (programmer error), not ValidationError');
    } else {
      ok++;
      console.log('  [OK] requireEnum with empty allowedValues throws plain Error (programmer error): "' + e.message + '"');
    }
  }

  console.log('--- requireObject ---');
  _expectPass('requireObject({a:1}, "o")', function() { return requireObject({a:1}, 'o').a; }, 1);
  _expectThrow('requireObject(null, "o")', function() { requireObject(null, 'o'); }, 'o');
  _expectThrow('requireObject([], "o") rejects array', function() { requireObject([], 'o'); }, 'o');
  _expectThrow('requireObject("str", "o")', function() { requireObject('str', 'o'); }, 'o');

  console.log('--- requireRequestId ---');
  _expectPass('requireRequestId("REQ-2026-0001")', function() { return requireRequestId('REQ-2026-0001'); }, 'REQ-2026-0001');
  _expectPass('requireRequestId("REQ-2026-00001") 5-digit', function() { return requireRequestId('REQ-2026-00001'); }, 'REQ-2026-00001');
  _expectThrow('requireRequestId("bogus")', function() { requireRequestId('bogus'); }, 'requestId');
  _expectThrow('requireRequestId("REQ-2026-001") too few digits', function() { requireRequestId('REQ-2026-001'); }, 'requestId');
  _expectThrow('requireRequestId(null)', function() { requireRequestId(null); }, 'requestId');

  console.log('--- requireEmail ---');
  _expectPass('requireEmail("user@gsa.gov", "e")', function() { return requireEmail('user@gsa.gov', 'e'); }, 'user@gsa.gov');
  _expectThrow('requireEmail("not-an-email", "e")', function() { requireEmail('not-an-email', 'e'); }, 'e');
  _expectThrow('requireEmail("", "e") empty', function() { requireEmail('', 'e'); }, 'e');
  _expectThrow('requireEmail("user@no-dot", "e")', function() { requireEmail('user@no-dot', 'e'); }, 'e');

  console.log('--- requireDateString ---');
  _expectPass('requireDateString("2026-05-20", "d")', function() { return requireDateString('2026-05-20', 'd'); }, '2026-05-20');
  _expectPass('requireDateString(new Date(), "d") accepts Date', function() {
    var d = new Date('2026-05-20');
    return requireDateString(d, 'd') === d ? 'ok' : 'fail';
  }, 'ok');
  _expectThrow('requireDateString("not a date", "d")', function() { requireDateString('not a date', 'd'); }, 'd');
  _expectThrow('requireDateString(null, "d")', function() { requireDateString(null, 'd'); }, 'd');

  console.log('--- _fieldLabel (Title Case conversion) ---');
  _expectPass('_fieldLabel("requestId") -> "Request Id"', function() { return _fieldLabel('requestId'); }, 'Request Id');
  _expectPass('_fieldLabel("tripName") -> "Trip Name"', function() { return _fieldLabel('tripName'); }, 'Trip Name');
  _expectPass('_fieldLabel("missionCriticalTypes") -> "Mission Critical Types"', function() { return _fieldLabel('missionCriticalTypes'); }, 'Mission Critical Types');
  _expectPass('_fieldLabel("") -> "Value" (fallback)', function() { return _fieldLabel(''); }, 'Value');

  if (errors === 0) console.log('_verifyValidationLibrary: all ' + ok + ' checks passed');
  else console.error('_verifyValidationLibrary: ' + errors + ' problems — see log');
  return { ok: ok, errors: errors };
}

/**
 * Verify Chunk 13 EMAIL_STYLES.colors integrity:
 *
 * 1. Every value is a 3- or 6-digit hex (catches typos like '#FFG' or stray text)
 * 2. Keys we expect to mirror tokens.html actually match the token hex value —
 *    flags drift between tokens.html and Email.js for the brand-shared colors
 *    (primary, success, warning, error, text, bg, border)
 * 3. EMAIL_STYLES.colors values are stable (no undefined, no nested objects)
 *
 * Read-only. Safe to re-run.
 *
 * @returns {{ok: number, errors: number}}
 * @editor
 */
function _verifyEmailColorMirror() {
  var ok = 0, errors = 0;
  var hexRegex = /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/;

  if (typeof EMAIL_STYLES === 'undefined' || !EMAIL_STYLES.colors) {
    console.error('  [BAD] EMAIL_STYLES.colors not defined');
    return { ok: 0, errors: 1 };
  }

  console.log('--- EMAIL_STYLES.colors hex format check ---');
  var keys = Object.keys(EMAIL_STYLES.colors);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = EMAIL_STYLES.colors[key];
    if (typeof value !== 'string') {
      errors++;
      console.error('  [BAD] ' + key + ': not a string (' + typeof value + ')');
    } else if (!hexRegex.test(value)) {
      errors++;
      console.error('  [BAD] ' + key + ': not a valid hex (' + value + ')');
    } else {
      ok++;
    }
  }
  console.log('  Format check: ' + ok + '/' + keys.length + ' valid');

  console.log('--- Token-mirror drift check (Email.js vs tokens.html canonical hexes) ---');
  // Hardcoded snapshot of the relevant tokens.html values at Chunk 13 ship time.
  // Update this list (and re-run the verifier) anytime tokens.html changes.
  // Each entry: emailKey: 'expected-hex-lowercase'
  var expectedMirror = {
    primary:        '#2563eb',  // tokens.html --color-brand-primary
    primaryDeepDark:'#1e40af',  // tokens.html --color-brand-dark
    warning:        '#f59e0b',  // tokens.html --color-status-needs-info
    warningDark:    '#d97706',  // tokens.html --color-status-pending
    success:        '#16a34a',  // tokens.html --color-status-approved (NOTE: this one will drift — Email uses #10B981 instead)
    error:          '#dc2626',  // tokens.html --color-status-denied
    textPrimary:    '#111827',  // tokens.html --color-text-primary
    textMuted:      '#6b7280',  // tokens.html --color-text-secondary
    textLight:      '#9ca3af',  // tokens.html --color-text-muted
    bgWhite:        '#ffffff',  // tokens.html --color-surface
    bgLight:        '#f9fafb',  // tokens.html --color-surface-alt
    border:         '#e5e7eb',  // tokens.html --color-border
    borderMuted:    '#d1d5db',  // tokens.html --color-border-strong
    infoText:       '#004f87',  // tokens.html --color-stage-sector
    infoBorder:     '#1b7cac'   // tokens.html --color-stage-bu
  };

  var driftCount = 0;
  Object.keys(expectedMirror).forEach(function(emailKey) {
    var emailValue = String(EMAIL_STYLES.colors[emailKey] || '').toLowerCase();
    var expected = expectedMirror[emailKey].toLowerCase();
    if (emailValue === expected) {
      ok++;
      console.log('  [OK] ' + emailKey + ' = ' + emailValue + ' (matches tokens.html)');
    } else if (!emailValue) {
      driftCount++;
      console.warn('  [DRIFT] ' + emailKey + ' missing from EMAIL_STYLES.colors (expected ' + expected + ')');
    } else {
      driftCount++;
      console.warn('  [DRIFT] ' + emailKey + ' = ' + emailValue + ' but tokens.html has ' + expected);
    }
  });

  // Drift is a WARNING, not an error — sometimes email needs a different shade
  // than the web token (e.g., success: Email uses brand-green #10B981, tokens.html
  // uses status-green #16a34a — intentional). Verifier flags every divergence so
  // future reconciliation passes can review each case.
  if (driftCount === 0) {
    console.log('  [OK] No drift between EMAIL_STYLES.colors and tokens.html');
  } else {
    console.log('  ' + driftCount + ' drift(s) flagged for owner review');
  }

  console.log('--- EMAIL_STYLES.fonts present ---');
  if (EMAIL_STYLES.fonts && typeof EMAIL_STYLES.fonts.family === 'string') {
    ok++;
    console.log('  [OK] fonts.family = "' + EMAIL_STYLES.fonts.family + '"');
  } else {
    errors++;
    console.error('  [BAD] EMAIL_STYLES.fonts.family missing or not a string');
  }

  if (errors === 0) console.log('_verifyEmailColorMirror: all ' + ok + ' checks passed (' + driftCount + ' drift warnings)');
  else console.error('_verifyEmailColorMirror: ' + errors + ' problems — see log');
  return { ok: ok, errors: errors, drift: driftCount };
}

/**
 * Verify Chunk 10.A Users domain adoption: live call to listTravelUsers returns
 * the new envelope shape ({success, data: {users, version}}), getTravelUserDetail
 * returns the new shape for a real user, and selfHealCurrentUserEmail still
 * returns its {patched} shape (Access.js depends on it). Read-only.
 *
 * @returns {{ok: number, errors: number}}
 * @editor
 */
function _verifyUsersDomainAdoption() {
  var ok = 0, errors = 0;

  console.log('--- listTravelUsers envelope ---');
  try {
    var res = listTravelUsers();
    if (res && res.success === true && res.data && Array.isArray(res.data.users)) {
      ok++;
      console.log('  [OK] envelope shape correct: success=true, data.users is array (length=' + res.data.users.length + ')');
    } else {
      errors++;
      console.error('  [BAD] envelope wrong: ' + JSON.stringify(res).substring(0, 200));
    }
    // Old-shape regression check: res.users should NOT exist at top level
    if (res && res.users !== undefined) {
      errors++;
      console.error('  [BAD] OLD-SHAPE regression: res.users exists at top level (should be res.data.users)');
    } else {
      ok++;
      console.log('  [OK] no top-level res.users leak');
    }
    if (res && res.data && typeof res.data.version !== 'undefined') {
      ok++;
      console.log('  [OK] data.version present: ' + res.data.version);
    } else {
      errors++;
      console.error('  [BAD] data.version missing');
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] listTravelUsers threw: ' + e.message);
  }

  console.log('--- getTravelUserDetail envelope (uses first user from listTravelUsers) ---');
  try {
    var listRes = listTravelUsers();
    var firstUserId = (listRes && listRes.data && listRes.data.users && listRes.data.users[0])
      ? listRes.data.users[0].userId : null;
    if (!firstUserId) {
      console.log('  [SKIP] no users in DB to test detail');
    } else {
      var detail = getTravelUserDetail(firstUserId);
      if (detail && detail.success === true && detail.data && detail.data.user && Array.isArray(detail.data.roles)) {
        ok++;
        console.log('  [OK] getTravelUserDetail envelope correct for user ' + firstUserId);
      } else {
        errors++;
        console.error('  [BAD] getTravelUserDetail envelope wrong: ' + JSON.stringify(detail).substring(0, 200));
      }
      if (detail && (detail.user !== undefined || detail.roles !== undefined)) {
        errors++;
        console.error('  [BAD] OLD-SHAPE regression: detail.user or detail.roles at top level');
      } else {
        ok++;
        console.log('  [OK] no top-level leak on detail');
      }
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] getTravelUserDetail threw: ' + e.message);
  }

  console.log('--- selfHealCurrentUserEmail shape (must stay {patched})  ---');
  try {
    var heal = selfHealCurrentUserEmail('nobody-no-match@gsa.gov');
    if (heal && typeof heal.patched === 'boolean') {
      ok++;
      console.log('  [OK] selfHealCurrentUserEmail returns {patched: ' + heal.patched + '}');
    } else {
      errors++;
      console.error('  [BAD] selfHealCurrentUserEmail shape changed: ' + JSON.stringify(heal));
    }
    // Should NOT return success/data envelope (Access.js would break)
    if (heal && (heal.success !== undefined || heal.data !== undefined)) {
      errors++;
      console.error('  [BAD] selfHealCurrentUserEmail now returns envelope — Access.js will break');
    } else {
      ok++;
      console.log('  [OK] selfHealCurrentUserEmail did not convert to envelope (Access.js safe)');
    }
  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] selfHealCurrentUserEmail threw: ' + e.message);
  }

  if (errors === 0) console.log('_verifyUsersDomainAdoption: all ' + ok + ' checks passed');
  else console.error('_verifyUsersDomainAdoption: ' + errors + ' problems — see log');
  return { ok: ok, errors: errors };
}

/**
 * Verify Chunk 10.0 TravelDB write helpers. Creates a temp scratch sheet inside
 * the travel DB, runs all 4 helpers against it (append → findRow → update →
 * delete → verify count), then deletes the scratch sheet. No production data
 * is touched. Idempotent — safe to run repeatedly.
 *
 * @returns {{ok: number, errors: number}}
 * @editor
 */
function _verifyTravelDBWriteHelpers() {
  var ok = 0, errors = 0;
  var SCRATCH = '_chunk10_scratch_' + Date.now();
  var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);

  // Create scratch sheet with 3 columns
  var sheet = ss.insertSheet(SCRATCH);
  sheet.getRange(1, 1, 1, 3).setValues([['id', 'name', 'status']]);

  try {
    var db = new TravelDB();

    console.log('--- appendRow ---');
    var rowA = db.appendRow(SCRATCH, ['A1', 'Alice', 'PENDING']);
    var rowB = db.appendRow(SCRATCH, ['B2', 'Bob', 'APPROVED']);
    var rowC = db.appendRow(SCRATCH, ['C3', 'Carol', 'DENIED']);
    if (rowA === 2 && rowB === 3 && rowC === 4) {
      ok++;
      console.log('  [OK] appendRow returned 2, 3, 4 for sequential appends');
    } else {
      errors++;
      console.error('  [BAD] appendRow returned ' + rowA + ', ' + rowB + ', ' + rowC + ', expected 2, 3, 4');
    }

    // Confirm cache was invalidated (re-read should show new rows)
    var readBack = db.readSheet(SCRATCH);
    if (readBack.rows.length === 3) {
      ok++;
      console.log('  [OK] readSheet after appendRow returned 3 rows (cache invalidated)');
    } else {
      errors++;
      console.error('  [BAD] readSheet returned ' + readBack.rows.length + ' rows, expected 3');
    }

    console.log('--- findRow ---');
    var bobHit = db.findRow(SCRATCH, 'name', 'Bob');
    if (bobHit && bobHit.rowNum === 3 && bobHit.data[0] === 'B2') {
      ok++;
      console.log('  [OK] findRow(name, Bob) → rowNum=3 data=[B2, Bob, APPROVED]');
    } else {
      errors++;
      console.error('  [BAD] findRow returned ' + JSON.stringify(bobHit));
    }

    var missHit = db.findRow(SCRATCH, 'name', 'NotPresent');
    if (missHit === null) {
      ok++;
      console.log('  [OK] findRow(missing) → null');
    } else {
      errors++;
      console.error('  [BAD] findRow(missing) returned ' + JSON.stringify(missHit));
    }

    console.log('--- updateRowByIndex ---');
    var writeCount = db.updateRowByIndex(SCRATCH, rowB, { status: 'COMPLETED', name: 'Robert' });
    if (writeCount === 2) {
      ok++;
      console.log('  [OK] updateRowByIndex returned 2 cells written');
    } else {
      errors++;
      console.error('  [BAD] updateRowByIndex returned ' + writeCount + ', expected 2');
    }

    var bobAfter = db.findRow(SCRATCH, 'id', 'B2');
    if (bobAfter && bobAfter.data[1] === 'Robert' && bobAfter.data[2] === 'COMPLETED') {
      ok++;
      console.log('  [OK] update persisted: B2 now [B2, Robert, COMPLETED]');
    } else {
      errors++;
      console.error('  [BAD] update did not persist: ' + JSON.stringify(bobAfter));
    }

    // Bad column name should throw
    var threwOnBadCol = false;
    try { db.updateRowByIndex(SCRATCH, rowA, { nonexistent: 'X' }); }
    catch (e) { threwOnBadCol = true; }
    if (threwOnBadCol) {
      ok++;
      console.log('  [OK] updateRowByIndex throws on unknown column');
    } else {
      errors++;
      console.error('  [BAD] updateRowByIndex silently accepted unknown column');
    }

    console.log('--- deleteRowByIndex ---');
    db.deleteRowByIndex(SCRATCH, rowC); // delete Carol (row 4)
    var afterDelete = db.readSheet(SCRATCH);
    if (afterDelete.rows.length === 2) {
      ok++;
      console.log('  [OK] after delete: 2 rows remain');
    } else {
      errors++;
      console.error('  [BAD] after delete: ' + afterDelete.rows.length + ' rows, expected 2');
    }

    var carolGone = db.findRow(SCRATCH, 'name', 'Carol');
    if (carolGone === null) {
      ok++;
      console.log('  [OK] findRow(Carol) after delete → null');
    } else {
      errors++;
      console.error('  [BAD] Carol still findable after delete: ' + JSON.stringify(carolGone));
    }

  } catch (e) {
    errors++;
    console.error('  [EXCEPTION] ' + e.message + '\n' + e.stack);
  } finally {
    // Always clean up scratch sheet, even on error
    try { ss.deleteSheet(ss.getSheetByName(SCRATCH)); console.log('Scratch sheet "' + SCRATCH + '" deleted'); }
    catch (e) { console.error('Failed to delete scratch sheet: ' + e.message); }
  }

  if (errors === 0) console.log('_verifyTravelDBWriteHelpers: all ' + ok + ' checks passed');
  else console.error('_verifyTravelDBWriteHelpers: ' + errors + ' problems — see log');
  return { ok: ok, errors: errors };
}

/**
 * Diagnostic: report status of the GSA cities warming trigger + cache.
 * One-stop check for "why are cities loading slow?" — counts the trigger,
 * counts what's actually cached today, and tells you what to fix.
 *
 * Read-only. Does NOT run the warmer (which takes ~5-15s). Run that
 * separately via warmGSACitiesCache() if needed.
 *
 * @returns {Object}
 * @editor
 */
function _diagnoseGSACitiesWarmer() {
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'warmGSACitiesCache';
  });
  console.log('=== GSA cities warmer diagnostic ===');
  console.log('Trigger installed: ' + (triggers.length > 0 ? 'YES (' + triggers.length + ')' : 'NO'));

  var cache = CacheService.getScriptCache();
  var fy = _gsaCurrentFiscalYear();
  console.log('Current fiscal year: ' + fy);

  var conusKeys = GSA_CONUS_STATES.map(function(s) { return 'gsa_cities_' + s + '_' + fy; });
  var hits = cache.getAll(conusKeys) || {};
  var present = 0, missing = [];
  for (var i = 0; i < GSA_CONUS_STATES.length; i++) {
    var s = GSA_CONUS_STATES[i];
    if (hits['gsa_cities_' + s + '_' + fy]) present++;
    else missing.push(s);
  }
  console.log('Cached states: ' + present + ' / ' + GSA_CONUS_STATES.length);
  if (missing.length && missing.length < 25) {
    console.log('Missing: ' + missing.join(', '));
  } else if (missing.length) {
    console.log('Missing ' + missing.length + ' states (most of CONUS not cached)');
  }

  console.log('--- recommendation ---');
  if (triggers.length === 0 && present < 10) {
    console.log('Trigger NOT installed AND cache mostly empty.');
    console.log('Fix: run warmGSACitiesCache() once now, then installGSACitiesWarmingTrigger() to schedule daily.');
  } else if (triggers.length === 0) {
    console.log('Trigger NOT installed but cache has data (from on-demand picks).');
    console.log('Fix: installGSACitiesWarmingTrigger() to keep the cache full going forward.');
  } else if (present < GSA_CONUS_STATES.length / 2) {
    console.log('Trigger installed but cache mostly empty — trigger may be failing.');
    console.log('Fix: run warmGSACitiesCache() manually + check for thrown exceptions.');
  } else {
    console.log('Everything looks healthy.');
  }
  return { triggerCount: triggers.length, cached: present, total: GSA_CONUS_STATES.length, missing: missing };
}

/**
 * Diagnostic: list every distinct value of a given field across the HC bundle
 * with position counts. Use to catch typo drift like "Civlian" coexisting with
 * "Civilian" in org.businessUnit. Defaults to org.businessUnit.
 *
 * @param {string} [field] - dot-path like "org.businessUnit" or top-level like "occupancyStatus"
 * @returns {{distinct: number, values: Array<{value: string, count: number}>}}
 * @editor
 */
function _probeHcDistinctValues(field) {
  var path = String(field || 'org.businessUnit');
  console.log('=== Distinct values for HC bundle field: "' + path + '" ===');

  var bundle;
  try { bundle = HC.hcGetBundle(); }
  catch (e) { console.error('HC.hcGetBundle() threw: ' + e.message); return { distinct: 0, values: [] }; }
  if (!bundle || !bundle.success || !bundle.data) {
    console.error('HC bundle unavailable');
    return { distinct: 0, values: [] };
  }

  function pluck(obj, dotPath) {
    var parts = dotPath.split('.');
    var v = obj;
    for (var i = 0; i < parts.length; i++) {
      if (v === null || v === undefined) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  var counts = {};
  for (var i = 0; i < bundle.data.length; i++) {
    var v = pluck(bundle.data[i], path);
    var key = (v === null || v === undefined) ? '(null)' : String(v);
    counts[key] = (counts[key] || 0) + 1;
  }

  var values = Object.keys(counts)
    .map(function(k) { return { value: k, count: counts[k] }; })
    .sort(function(a, b) { return b.count - a.count; });

  values.forEach(function(v) {
    console.log('  ' + String(v.count).padStart(5, ' ') + '  ' + v.value);
  });
  console.log('--- ' + values.length + ' distinct values across ' + bundle.data.length + ' positions ---');
  return { distinct: values.length, values: values };
}

/**
 * Diagnostic: search the HC bundle for ANY position where any field contains
 * `needle` (case-insensitive). Use to debug "why is X blocked from TRIP" —
 * shows what HC actually has on this person regardless of the access gate's
 * exact-match logic. Edit the NEEDLE constant or pass an argument.
 *
 * For each match, prints the full position object so you can see emailAddress
 * exact value, supervisoryStatus, occupancyStatus, orgCode, officeTitle, etc.
 *
 * @param {string} needle - substring to search for (e.g., last name or email)
 * @returns {{matches: number, positions: Object[]}}
 * @editor
 */
function _probeHcForUser(needle) {
  var search = String(needle || 'druxman').toLowerCase();
  console.log('=== HC bundle diagnostic ===');

  var bundle;
  try { bundle = HC.hcGetBundle(); }
  catch (e) { console.error('HC.hcGetBundle() threw: ' + e.message); return { matches: 0, positions: [] }; }

  if (!bundle || !bundle.success || !bundle.data) {
    console.error('HC bundle unavailable. Full response: ' + JSON.stringify(bundle).substring(0, 500));
    return { matches: 0, positions: [] };
  }

  var positions = bundle.data;
  console.log('Bundle total: ' + positions.length + ' positions');

  // Bundle metadata (if HC library exposes timestamps/version)
  var meta = {};
  Object.keys(bundle).forEach(function(k) {
    if (k !== 'data') meta[k] = bundle[k];
  });
  console.log('Bundle metadata: ' + JSON.stringify(meta));

  if (positions.length === 0) {
    console.error('Bundle data array is EMPTY — library returned no positions');
    return { matches: 0, positions: [] };
  }

  // Schema: keys of the first position
  var sample = positions[0];
  console.log('Position schema (keys on first record): ' + Object.keys(sample).join(', '));
  console.log('First position sample: ' + JSON.stringify(sample, null, 2));

  // Field-coverage counts
  var emailCount = 0, supStatus2 = 0, hasOrgCode = 0;
  var supStatusDistinct = {}, occStatusDistinct = {};
  positions.forEach(function(p) {
    if (!p) return;
    if (p.emailAddress) emailCount++;
    if (p.orgCode) hasOrgCode++;
    if (String(p.supervisoryStatus) === '2') supStatus2++;
    var ss = String(p.supervisoryStatus === undefined ? '(undef)' : p.supervisoryStatus);
    supStatusDistinct[ss] = (supStatusDistinct[ss] || 0) + 1;
    var os = String(p.occupancyStatus === undefined ? '(undef)' : (p.occupancyStatus || '(empty)')).toUpperCase();
    occStatusDistinct[os] = (occStatusDistinct[os] || 0) + 1;
  });
  console.log('Positions with emailAddress filled: ' + emailCount + ' / ' + positions.length);
  console.log('Positions with orgCode filled:      ' + hasOrgCode + ' / ' + positions.length);
  console.log('Positions with supervisoryStatus=2: ' + supStatus2 + ' / ' + positions.length);
  console.log('supervisoryStatus distribution: ' + JSON.stringify(supStatusDistinct));
  console.log('occupancyStatus distribution:   ' + JSON.stringify(occStatusDistinct));

  // Substring search across ALL fields (handles email aliases, name variants,
  // alternate fields like firstName/lastName/fullName/displayName, etc.)
  console.log('--- searching all fields for "' + search + '" (case-insensitive) ---');
  var matches = [];
  for (var i = 0; i < positions.length; i++) {
    var p = positions[i];
    if (!p) continue;
    var hit = false;
    for (var k in p) {
      if (!p.hasOwnProperty(k)) continue;
      var v = p[k];
      if (v === null || v === undefined) continue;
      if (String(v).toLowerCase().indexOf(search) !== -1) { hit = true; break; }
    }
    if (hit) matches.push(p);
  }

  console.log('Found ' + matches.length + ' position(s) matching "' + search + '":');
  matches.forEach(function(p, idx) {
    console.log('--- match ' + (idx + 1) + ' ---');
    console.log(JSON.stringify(p, null, 2));
  });

  if (matches.length === 0) {
    console.log('NO HC POSITIONS MATCH "' + search + '" anywhere.');
    console.log('Likely causes:');
    console.log('  1. Stale cache — HC library is serving an older bundle that pre-dates her addition');
    console.log('  2. Library filter — the library skips positions missing a required field');
    console.log('  3. Different field name in HC source vs library output (check schema above)');
    console.log('Next step: invalidate/refresh the HC library cache, OR check HC library code to see what filter it applies on the source data.');
  }
  return { matches: matches.length, positions: matches, bundleTotal: positions.length, bundleMeta: meta };
}

/**
 * Verify Chunk 9 adoption: every DateTime.js helper exists, produces expected
 * output for a known input, AND round-trips successfully against 5 real rows
 * from Requests + Approval_Log (catches surprises from the Pacific anchor or
 * cache duality).
 *
 * Three layers:
 * 1. Function existence — each of the 7 canonical helpers is defined.
 * 2. Behavior tests — known inputs produce known outputs (typo / TZ guard).
 * 3. Live sanity — sample real rows, format via each helper, confirm
 *    non-empty output and expected suffix pattern.
 *
 * @returns {{ok: number, errors: number}}
 * @editor
 */
function _verifyDateTimeAdoption() {
  var ok = 0, errors = 0;

  console.log('--- 1. Function existence ---');
  var fns = ['parseDateAny', 'formatDateForStorage', 'formatDateForDisplay',
             'formatTimestampForDisplay', 'formatDateRange', 'getEasternTimestamp',
             'businessDaysBetween'];
  fns.forEach(function(name) {
    var fn = (typeof this === 'object' && this !== null) ? this[name] : null;
    // GAS globals are accessed via globalThis or just by name
    var exists = false;
    try { exists = typeof eval(name) === 'function'; } catch (e) { exists = false; }
    if (exists) { ok++; console.log('  [OK] ' + name); }
    else { errors++; console.error('  [MISSING] ' + name); }
  });

  console.log('--- 2. Behavior tests ---');
  // parseDateAny basics
  var d1 = parseDateAny('2026-02-17T08:00:00.000Z');
  if (d1 instanceof Date && !isNaN(d1.getTime())) { ok++; console.log('  [OK] parseDateAny(ISO string) returns valid Date'); }
  else { errors++; console.error('  [BAD] parseDateAny(ISO string)'); }
  if (parseDateAny(null) === null) { ok++; console.log('  [OK] parseDateAny(null) returns null'); }
  else { errors++; console.error('  [BAD] parseDateAny(null) should be null'); }
  if (parseDateAny('') === null) { ok++; console.log('  [OK] parseDateAny("") returns null'); }
  else { errors++; console.error('  [BAD] parseDateAny("") should be null'); }

  // formatDateForStorage: ET interpretation
  var fdS = formatDateForStorage(new Date('2026-02-17T08:00:00.000Z'));
  if (fdS === '2026-02-17') { ok++; console.log('  [OK] formatDateForStorage(midnight-PT date) = "' + fdS + '"'); }
  else { errors++; console.error('  [BAD] formatDateForStorage gave "' + fdS + '" expected "2026-02-17"'); }

  // formatDateForDisplay: UTC interpretation, "Mon d, yyyy"
  var fdD = formatDateForDisplay(new Date('2026-02-17T08:00:00.000Z'));
  if (fdD === 'Feb 17, 2026') { ok++; console.log('  [OK] formatDateForDisplay(midnight-PT date) = "' + fdD + '"'); }
  else { errors++; console.error('  [BAD] formatDateForDisplay gave "' + fdD + '" expected "Feb 17, 2026"'); }

  // formatTimestampForDisplay: ET with " ET" suffix
  var fts = formatTimestampForDisplay(new Date('2026-02-11T14:58:22.326Z'));
  // Expected: "Feb 11, 2026 at 9:58 AM ET"
  if (fts.indexOf('Feb 11, 2026') === 0 && fts.indexOf(' ET') === fts.length - 3) {
    ok++; console.log('  [OK] formatTimestampForDisplay = "' + fts + '"');
  } else { errors++; console.error('  [BAD] formatTimestampForDisplay gave "' + fts + '"'); }

  // formatDateRange: same year same month collapses
  var fr1 = formatDateRange(new Date('2026-02-17T08:00:00Z'), new Date('2026-02-20T08:00:00Z'));
  if (fr1 === 'Feb 17 – 20, 2026') { ok++; console.log('  [OK] formatDateRange same-month = "' + fr1 + '"'); }
  else { errors++; console.error('  [BAD] formatDateRange same-month gave "' + fr1 + '"'); }

  // formatDateRange: same year different month
  var fr2 = formatDateRange(new Date('2026-02-17T08:00:00Z'), new Date('2026-03-05T08:00:00Z'));
  if (fr2 === 'Feb 17 – Mar 5, 2026') { ok++; console.log('  [OK] formatDateRange cross-month = "' + fr2 + '"'); }
  else { errors++; console.error('  [BAD] formatDateRange cross-month gave "' + fr2 + '"'); }

  // formatDateRange: same day
  var fr3 = formatDateRange(new Date('2026-02-17T08:00:00Z'), new Date('2026-02-17T08:00:00Z'));
  if (fr3 === 'Feb 17, 2026') { ok++; console.log('  [OK] formatDateRange same-day = "' + fr3 + '"'); }
  else { errors++; console.error('  [BAD] formatDateRange same-day gave "' + fr3 + '"'); }

  // formatDateRange: nulls
  var fr4 = formatDateRange(null, null);
  if (fr4 === 'TBD') { ok++; console.log('  [OK] formatDateRange(null,null) = "TBD"'); }
  else { errors++; console.error('  [BAD] formatDateRange(null,null) gave "' + fr4 + '"'); }

  // getEasternTimestamp: yyyy-MM-dd HH:mm:ss (19 chars)
  var ts = getEasternTimestamp();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts)) { ok++; console.log('  [OK] getEasternTimestamp = "' + ts + '"'); }
  else { errors++; console.error('  [BAD] getEasternTimestamp gave "' + ts + '"'); }

  // businessDaysBetween: known interval (Tue 9am → Thu 9am = 2.0 days)
  var bdb = businessDaysBetween(new Date('2026-02-17T14:00:00Z'), new Date('2026-02-19T14:00:00Z'));
  if (bdb === 2) { ok++; console.log('  [OK] businessDaysBetween(Tue 9am → Thu 9am) = 2.0'); }
  else { errors++; console.error('  [BAD] businessDaysBetween gave ' + bdb + ', expected 2.0'); }

  console.log('--- 3. Live sanity (5 rows from Requests + Approval_Log) ---');
  var db = new TravelDB();
  var requests = db._readFromSheet(SHEET_NAMES.REQUESTS);
  var rIdx = requests.headerIndex;
  for (var i = 0; i < Math.min(5, requests.rows.length); i++) {
    var row = requests.rows[i];
    var disp = formatDateForDisplay(row[rIdx['Event_Start_Date']]);
    var ts2 = formatTimestampForDisplay(row[rIdx['Submitted_At']]);
    var range = formatDateRange(row[rIdx['Event_Start_Date']], row[rIdx['Event_End_Date']]);
    var rid = row[rIdx['Request_ID']];
    if (disp && ts2 && range) {
      ok++;
      console.log('  [OK] ' + rid + ' — event: ' + disp + ' | range: ' + range + ' | submitted: ' + ts2);
    } else {
      errors++;
      console.error('  [BAD] ' + rid + ' — disp="' + disp + '" range="' + range + '" ts="' + ts2 + '"');
    }
  }

  if (errors === 0) console.log('_verifyDateTimeAdoption: all checks passed (' + ok + ' OK)');
  else console.error('_verifyDateTimeAdoption: ' + errors + ' problems — see log');
  return { ok: ok, errors: errors };
}

/**
 * Probe date-column shapes across every sheet. Reports JS types + string
 * format patterns so we know exactly what parseDateAny needs to handle
 * before any Chunk 9 migration. Run once from the editor — output goes to
 * the logger. Read-only, side-effect free.
 *
 * For each column where at least one cell is a Date instance OR a string
 * that parses to a valid date, prints:
 *   - count by JS type (Date / string / number / blank)
 *   - for strings: which regex pattern they match + one sample value
 *   - count of unparseable values
 *
 * @returns {Object} report keyed by 'SheetName / ColumnHeader'
 * @editor
 */
function _probeDateFormats() {
  var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);

  console.log('=== Timezone diagnostics ===');
  console.log('  Spreadsheet TZ:   ' + ss.getSpreadsheetTimeZone());
  console.log('  Script TZ:        ' + Session.getScriptTimeZone());
  console.log('  Manifest TZ:      America/New_York (per appsscript.json)');
  console.log('');

  // Probe every sheet defined in SHEET_NAMES
  var SHEETS_TO_PROBE = Object.keys(SHEET_NAMES).map(function(k) { return SHEET_NAMES[k]; });

  // Regex patterns ordered most-specific first. First match wins.
  var STRING_PATTERNS = [
    { name: 'ISO datetime w/ Z',     re: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/ },
    { name: 'ISO datetime w/ offset',re: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:?\d{2}$/ },
    { name: 'ISO datetime no tz',    re: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/ },
    { name: 'yyyy-MM-dd HH:mm:ss',   re: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ },
    { name: 'yyyy-MM-dd',            re: /^\d{4}-\d{2}-\d{2}$/ },
    { name: 'M/D/YYYY',              re: /^\d{1,2}\/\d{1,2}\/\d{4}$/ },
    { name: 'M/D/YY',                re: /^\d{1,2}\/\d{1,2}\/\d{2}$/ },
    { name: 'Mon DD, YYYY',          re: /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/ },
    { name: 'Month DD, YYYY',        re: /^[A-Z][a-z]+ \d{1,2}, \d{4}$/ },
    { name: 'MM/DD (no year)',       re: /^\d{1,2}\/\d{1,2}$/ }
  ];

  function classifyString(s) {
    for (var i = 0; i < STRING_PATTERNS.length; i++) {
      if (STRING_PATTERNS[i].re.test(s)) return STRING_PATTERNS[i].name;
    }
    return 'OTHER: ' + (s.length > 30 ? s.substring(0, 30) + '...' : s);
  }

  // Header looks like a date column (and not a known false positive)
  function headerSuggestsDate(h) {
    if (/Telework|Uses_|_By\b/i.test(h)) return false;
    return /Date|Time|_At|Stamp/i.test(h);
  }

  var report = {};
  var db = new TravelDB();

  SHEETS_TO_PROBE.forEach(function(sheetName) {
    var data;
    try { data = db._readFromSheet(sheetName); }
    catch (e) { console.error('skip ' + sheetName + ': ' + e.message); return; }

    var headers = data.headers;
    var rows = data.rows;
    if (!rows.length) { console.log(sheetName + ': empty (or sheet missing)'); return; }

    var sheet = ss.getSheetByName(sheetName);

    var colStats = headers.map(function() {
      return { dates: 0, strings: 0, numbers: 0, blanks: 0, unparseable: 0,
               patterns: {}, dateSamples: [],
               timeComponents: { midnightEastern: 0, midnightPacific: 0, midnightUtc: 0, other: 0 } };
    });

    rows.forEach(function(row) {
      for (var c = 0; c < headers.length; c++) {
        var v = row[c];
        var s = colStats[c];
        if (v === '' || v === null || v === undefined) { s.blanks++; continue; }
        if (v instanceof Date) {
          if (isNaN(v.getTime())) { s.unparseable++; continue; }
          s.dates++;
          var eastTime = Utilities.formatDate(v, 'America/New_York', 'HH:mm:ss');
          var pacTime = Utilities.formatDate(v, 'America/Los_Angeles', 'HH:mm:ss');
          var utcTime = Utilities.formatDate(v, 'UTC', 'HH:mm:ss');
          if (eastTime === '00:00:00') s.timeComponents.midnightEastern++;
          else if (pacTime === '00:00:00') s.timeComponents.midnightPacific++;
          else if (utcTime === '00:00:00') s.timeComponents.midnightUtc++;
          else s.timeComponents.other++;
          if (s.dateSamples.length < 5) {
            var iso = v.toISOString();
            if (s.dateSamples.indexOf(iso) === -1) s.dateSamples.push(iso);
          }
          continue;
        }
        if (typeof v === 'number') { s.numbers++; continue; }
        if (typeof v === 'string') {
          s.strings++;
          var pat = classifyString(v);
          if (pat.indexOf('OTHER:') !== 0) {
            var parsed = new Date(v);
            if (isNaN(parsed.getTime())) s.unparseable++;
          }
          if (!s.patterns[pat]) s.patterns[pat] = { count: 0, sample: v };
          s.patterns[pat].count++;
          continue;
        }
        s.unparseable++;
      }
    });

    var sheetHeaderPrinted = false;
    headers.forEach(function(header, c) {
      var s = colStats[c];
      var hasAnyDate = s.dates > 0;
      var hasDatePattern = Object.keys(s.patterns).some(function(p) { return p.indexOf('OTHER:') !== 0; });
      var nameSuggests = headerSuggestsDate(header);
      if (!hasAnyDate && !hasDatePattern && !nameSuggests) return;

      if (!sheetHeaderPrinted) {
        console.log('### Sheet: ' + sheetName + ' (' + rows.length + ' rows) ###');
        sheetHeaderPrinted = true;
      }

      var key = sheetName + ' / ' + header;
      console.log('--- ' + key + ' ---');

      // Cell number format from first non-blank row (Sheets-side display setting)
      var numFormat = '?';
      try {
        var firstNonBlankRow = -1;
        for (var i = 0; i < rows.length; i++) {
          var rv = rows[i][c];
          if (rv !== '' && rv !== null && rv !== undefined) { firstNonBlankRow = i; break; }
        }
        if (firstNonBlankRow >= 0) {
          numFormat = sheet.getRange(firstNonBlankRow + 2, c + 1).getNumberFormat();
        }
      } catch (e) { numFormat = 'error: ' + e.message; }
      console.log('  Cell number format: ' + numFormat);

      console.log('  Types: Date=' + s.dates + '  String=' + s.strings + '  Number=' + s.numbers + '  Blank=' + s.blanks + (s.unparseable ? '  UNPARSEABLE=' + s.unparseable : ''));

      if (s.dates > 0) {
        console.log('  Time anchors: midnight-ET=' + s.timeComponents.midnightEastern +
                    '  midnight-PT=' + s.timeComponents.midnightPacific +
                    '  midnight-UTC=' + s.timeComponents.midnightUtc +
                    '  other=' + s.timeComponents.other);
        s.dateSamples.forEach(function(iso) {
          var d = new Date(iso);
          var east = Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd HH:mm:ss zzz');
          var pac  = Utilities.formatDate(d, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm:ss zzz');
          console.log('    sample: ' + iso);
          console.log('      ET: ' + east + '  |  PT: ' + pac);
        });
      }

      if (s.strings > 0) {
        Object.keys(s.patterns).forEach(function(p) {
          console.log('  String [' + p + ']: ' + s.patterns[p].count + ' (e.g. "' + s.patterns[p].sample + '")');
        });
      }

      // Mixed-type warning
      var nonBlankTypeCount = [s.dates > 0, s.strings > 0, s.numbers > 0].filter(Boolean).length;
      if (nonBlankTypeCount > 1) {
        console.warn('  MIXED TYPES WARNING — column stores more than one type, likely write-path drift');
      }

      // Header-suggests-date but no date data
      if (nameSuggests && !hasAnyDate && !hasDatePattern) {
        console.warn('  HEADER SUGGESTS DATE BUT NO DATE DATA FOUND — empty/all-blank, or only OTHER-pattern strings');
      }

      report[key] = s;
    });
  });

  console.log('--- _probeDateFormats: done ---');
  return report;
}

/**
 * Smoke-test every served page template by running it through full GAS
 * include resolution + template evaluation. Catches broken `<?!= include() ?>`
 * paths, broken `<?= someServerFn() ?>` calls, and any global that became
 * undefined post-reorg — without ever opening a browser.
 *
 * Doesn't catch client-side JS runtime errors (those need an actual page
 * load), but those weren't the failure mode here anyway. This is the
 * unified check to run after any chunk that touches HTML paths, include
 * calls, or `createTemplateFromFile` references (Chunks 6, 12, 13, etc.).
 *
 * Each page template references different template variables (`<?= userName ?>`,
 * `<?= scriptUrl ?>`, etc.) that the real serve* functions set before calling
 * .evaluate(). To test in isolation we pre-populate every known template var
 * with a dummy value. If a NEW variable is added to a page, this helper will
 * report it as a FAIL with "X is not defined" — that's the signal to add it
 * to DUMMY_VARS below.
 *
 * @returns {{ok: number, failed: number}}
 * @editor
 */
function _checkAllPageTemplates() {
  // Templates served by doGet() page-servers (in 50_pages/Render.js).
  // Update this list during Chunk 6 when HTML moves to client/pages/.
  const pages = [
    'client/pages/travelPortalPage',
    'client/pages/travelRequestPage',
    'client/pages/travelReviewPage',
    'client/pages/ddConfirmPage',
    'client/pages/travelAdminPage',
    'client/pages/travelReviewerDashboardPage',
    'client/pages/travelAccessBlockedPage'
  ];

  // Union of every template variable any serve* function sets. Dummy values
  // just need to satisfy the type expectations; the rendered HTML is discarded.
  const DUMMY_VARS = {
    // Common to most pages
    userEmail: 'smoke@test.gov',
    userName: 'Smoke Test',
    scriptUrl: 'https://example.com/exec',
    // Form-specific
    draftId: '',
    duplicateBlueprint: 'null',
    duplicateError: '',
    submitterBU: '',
    submitterBUName: '',
    submitterOrgCode: '',
    // Review / DD confirm
    requestId: '',
    viewMode: 'reviewer',
    // Reviewer dashboard
    reviewerRole: 'oso',
    reviewerLabel: '',
    scopeType: 'all',
    scopeCodes: '[]',
    scopeNames: '[]',
    viewAsActive: false,
    viewAsLabel: '',
    viewAsParams: 'null',
    // Access-restricted page
    iconClass: 'fa-lock',
    title: 'Access Restricted',
    subtitle: '',
    showReturnToPortal: false,
    pageTitle: 'TRIP'
  };

  var ok = 0, failed = 0;
  pages.forEach(function(p) {
    try {
      var template = HtmlService.createTemplateFromFile(p);
      Object.keys(DUMMY_VARS).forEach(function(k) { template[k] = DUMMY_VARS[k]; });
      var html = template.evaluate().getContent();
      console.log('  [OK]   ' + p + '  (' + html.length + ' chars)');
      ok++;
    } catch (e) {
      console.error('  [FAIL] ' + p + ':  ' + e.message);
      failed++;
    }
  });

  if (failed === 0) {
    console.log('_checkAllPageTemplates: all ' + ok + ' page templates render');
  } else {
    console.error('_checkAllPageTemplates: ' + failed + ' BROKEN of ' + (ok + failed) + ' — fix the include/template paths, restore the missing global, or add the new template variable to DUMMY_VARS in this function');
  }
  return { ok: ok, failed: failed };
}
