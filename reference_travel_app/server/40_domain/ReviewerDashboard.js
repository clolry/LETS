/**
 * TravelReviewerDashboardService.js
 *
 * Server endpoints for the reviewer dashboard (?mode=reviewer-dashboard).
 * Mirrors getAdminDashboard's shape but scopes data to the caller's role.
 *
 * Scope is derived from session in getReviewerContext() — the client cannot
 * pass a scope param to widen access. Admin endpoints stay separate.
 *
 * Phase 6a (this file): context, action center, scoped requests list.
 * Phase 6b: metrics (stat cards, charts, spend-by-group).
 *
 * Status statuses use the constants from TravelDatabaseSetup.js.
 */

// ============================================================================
// PUBLIC ENDPOINT
// ============================================================================

/**
 * Single round-trip: context + action center + scoped requests list.
 *
 * @param {string} period - '30d' | 'quarter' | 'fy' | 'custom' (defaults '30d')
 * @param {string} [customStart] - ISO date when period === 'custom'
 * @param {string} [customEnd]   - ISO date when period === 'custom'
 * @param {Object} [viewAs] - Admin-only view-as override forwarded to getReviewerContext
 * @returns {Object} {
 *   success, context, actionCenter, requests, distinctSectorCodes,
 *   distinctBUCodes, distinctDivisionCodes, periodWindow, metrics
 * }
 */
function getReviewerDashboard(period, customStart, customEnd, viewAs) {
  console.time('getReviewerDashboard');
  try {
    var ctx = getReviewerContext(undefined, viewAs);
    if (!ctx.isReviewer) {
      return { success: false, error: 'Not a reviewer' };
    }

    period = period || '30d';
    var win = _resolvePeriodWindow(period, customStart, customEnd);

    var db = new TravelDB();
    var sheetData = db.readSheet(SHEET_NAMES.REQUESTS);
    if (sheetData.headers.length === 0) {
      throw new Error('Requests sheet not found');
    }
    var headerIndex = sheetData.headerIndex;
    var rows = sheetData.rows;

    // Pre-load travelers + org hierarchy so scope check + metrics share data.
    // A request is in scope if ANY traveler's BU/Sector matches user's scope,
    // OR the submitter's BU/Sector matches user's scope (mirrors admin's
    // per-BU attribution exactly). loadOrgLookups (shared util) bakes in
    // formerOrgCodes expansion so historic codes resolve correctly.
    var orgLookups = loadOrgLookups();
    var travelersByRequestId = _loadTravelersByRequest(db);
    var scopeChecker = _buildTravelerAwareScopeChecker(ctx, travelersByRequestId, orgLookups);

    var now = new Date();
    var twoDaysAgo = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000));
    var tenDaysFromNow = new Date(now.getTime() + (10 * 24 * 60 * 60 * 1000));
    var startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    var pendingStatuses = [
      STATUS_CODES.PENDING_SECTOR,
      STATUS_CODES.PENDING_BU,
      STATUS_CODES.PENDING_OSO,
      STATUS_CODES.PENDING_FAS
    ];
    var stalledStatuses = pendingStatuses.concat([
      STATUS_CODES.NEEDS_INFO_SECTOR,
      STATUS_CODES.NEEDS_INFO_BU,
      STATUS_CODES.NEEDS_INFO_OSO
    ]);

    var userEmailLower = (ctx.email || '').toLowerCase();

    var yourReviews = [];
    var stalled = [];
    var deniedCount = 0, cancelledCount = 0;
    var pipelineCounts = { sector: 0, bu: 0, oso: 0, fas: 0, ddConfirm: 0, approved: 0, completed: 0 };

    var requests = [];
    var sectorCodeSet = {}, buCodeSet = {}, divisionCodeSet = {};

    // Pre-compute scope-aware predicates so the per-org filter checks
    // below stay tight in the per-row loop. The traveler-aware scope
    // checker matches a request when EITHER the submitter OR any
    // traveler is in scope; without these filters the dropdown would
    // surface sectors that belong to out-of-scope submitters whose
    // travelers happened to be in scope.
    var scopeType = (ctx && ctx.scope && ctx.scope.type) || 'all';
    var allowedBUNamesUpper = {};
    var allowedSectorCodesUpper = {};
    if (scopeType === 'bu' && ctx.scope.names) {
      ctx.scope.names.forEach(function(n) { allowedBUNamesUpper[String(n).toUpperCase()] = true; });
    }
    if (scopeType === 'sector' && ctx.scope.codes) {
      ctx.scope.codes.forEach(function(c) { allowedSectorCodesUpper[String(c).toUpperCase()] = true; });
    }

    function _orgBelongsToScope(orgCode) {
      if (!orgCode) return false;
      if (scopeType === 'all') return true;
      var canonical = orgLookups.orgToCurrentOrgCode[orgCode] || orgCode;
      if (scopeType === 'bu') {
        var bu = String(orgLookups.orgToBU[canonical] || '').toUpperCase();
        return !!(bu && allowedBUNamesUpper[bu]);
      }
      if (scopeType === 'sector') {
        var sec = String(canonical).substring(0, 4).toUpperCase();
        return !!(sec && allowedSectorCodesUpper[sec]);
      }
      return false;
    }

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var status = row[headerIndex['Status']] || '';
      var requestId = row[headerIndex['Request_ID']] || '';
      if (!status || !requestId) continue;
      if (!scopeChecker(row, headerIndex)) continue;

      var tripName = row[headerIndex['Trip_Name']] || '';
      var submitterName = row[headerIndex['Submitter_Name']] || '';
      var buCode = row[headerIndex['Submitter_BU']] || '';
      var submitterOrgCode = String(row[headerIndex['Submitter_Org_Code']] || '');
      var grandTotal = parseFloat(row[headerIndex['Grand_Total']]) || 0;
      var eventStartDate = row[headerIndex['Event_Start_Date']];
      var updatedAt = row[headerIndex['Updated_At']];
      var submittedAt = row[headerIndex['Submitted_At']];
      var currentReviewerEmail = (row[headerIndex['Current_Reviewer_Email']] || '').toLowerCase();
      var currentReviewerName = row[headerIndex['Current_Reviewer_Name']] || '';
      var locationType = row[headerIndex['Location_Type']] || 'other';

      var daysAtStage = updatedAt ? Math.floor((now - new Date(updatedAt)) / TIME_CONSTANTS.MS_PER_DAY) : 0;
      var isUrgent = eventStartDate ? new Date(eventStartDate) <= tenDaysFromNow : false;

      // Action center: your reviews (PENDING_* assigned to you)
      if (pendingStatuses.indexOf(status) !== -1 && currentReviewerEmail === userEmailLower) {
        yourReviews.push({
          requestId: requestId, tripName: tripName, status: status,
          submitterName: submitterName, buCode: buCode, grandTotal: grandTotal,
          eventStartDate: formatDateValue(eventStartDate),
          updatedAt: formatDateValue(updatedAt),
          daysAtStage: daysAtStage, isUrgent: isUrgent
        });
      }

      // Stalled: in-flight > 2 days at current stage, in your scope
      if (stalledStatuses.indexOf(status) !== -1 && updatedAt && new Date(updatedAt) <= twoDaysAgo) {
        stalled.push({
          requestId: requestId, tripName: tripName, status: status,
          submitterName: submitterName, currentReviewerName: currentReviewerName,
          grandTotal: grandTotal, updatedAt: formatDateValue(updatedAt), daysAtStage: daysAtStage
        });
      }

      // Denied/cancelled this month (in scope)
      if (updatedAt && new Date(updatedAt) >= startOfMonth) {
        if (status === STATUS_CODES.DENIED) deniedCount++;
        if (status === STATUS_CODES.CANCELLED) cancelledCount++;
      }

      // Pipeline counts (in scope)
      if (status === STATUS_CODES.PENDING_SECTOR) pipelineCounts.sector++;
      else if (status === STATUS_CODES.PENDING_BU) pipelineCounts.bu++;
      else if (status === STATUS_CODES.PENDING_OSO) pipelineCounts.oso++;
      else if (status === STATUS_CODES.PENDING_FAS) pipelineCounts.fas++;
      else if (status === STATUS_CODES.PENDING_DD_CONFIRMATION) pipelineCounts.ddConfirm++;
      else if (status === STATUS_CODES.APPROVED_GOGOV) pipelineCounts.approved++;
      else if (status === STATUS_CODES.COMPLETED) pipelineCounts.completed++;

      // Filter aggregations — canonicalize via reorg map so historic former
      // codes get rolled up into the current code's bucket. Each set is
      // scope-aware: only add codes that actually belong to the user's
      // scope, walking submitter + travelers because the request may be
      // in scope via either path. Without this, an out-of-scope
      // submitter's sector would appear in a BU reviewer's "Sectors in
      // your BU" dropdown just because one of its travelers matched.
      var canonicalOrgCode = orgLookups.orgToCurrentOrgCode[submitterOrgCode] || submitterOrgCode;
      var sectorCode = canonicalOrgCode.substring(0, 4);

      function _addOrgIfInScope(orgCode) {
        if (!orgCode) return;
        if (!_orgBelongsToScope(orgCode)) return;
        var canonical = orgLookups.orgToCurrentOrgCode[orgCode] || orgCode;
        var sec = String(canonical).substring(0, 4);
        var bu = orgLookups.orgToBU[canonical];
        if (bu) buCodeSet[bu] = true;
        if (sec) sectorCodeSet[sec] = true;
        if (canonical) divisionCodeSet[canonical] = true;
      }

      _addOrgIfInScope(submitterOrgCode);
      var travelersOfRequest = travelersByRequestId[requestId] || [];
      for (var ti = 0; ti < travelersOfRequest.length; ti++) {
        _addOrgIfInScope(travelersOfRequest[ti].orgCode);
      }

      // Tag how this request matched scope so the client can split it
      // into "Requests you manage" (submitter in scope) vs "Trips
      // involving your staff" (traveler-only match). For the trips
      // section, surface the in-scope traveler names so a BU/sector lead
      // sees which of their people are on someone else's trip.
      var submitterInScope = _orgBelongsToScope(submitterOrgCode);
      var inScopeTravelerNames = [];
      if (!submitterInScope) {
        for (var ts = 0; ts < travelersOfRequest.length; ts++) {
          if (_orgBelongsToScope(travelersOfRequest[ts].orgCode)) {
            var nm = String(travelersOfRequest[ts].name || '').trim();
            if (nm) inScopeTravelerNames.push(nm);
          }
        }
      }

      // Requests list — store canonical org/sector so client-side filtering
      // matches against current codes regardless of when the request was submitted.
      requests.push({
        requestId: requestId, tripName: tripName, status: status, buCode: buCode,
        submitterOrgCode: canonicalOrgCode,
        sectorCode: sectorCode,
        locationType: locationType, grandTotal: grandTotal,
        travelerCount: parseInt(row[headerIndex['Traveler_Count']]) || 0,
        submitterName: submitterName,
        submitterEmail: row[headerIndex['Submitter_Email']] || '',
        currentReviewerName: currentReviewerName,
        currentReviewerEmail: row[headerIndex['Current_Reviewer_Email']] || '',
        eventStartDate: formatDateValue(eventStartDate),
        eventEndDate: formatDateValue(row[headerIndex['Event_End_Date']]),
        submittedAt: formatDateValue(submittedAt),
        updatedAt: formatDateValue(updatedAt),
        isInternational: row[headerIndex['Is_International']] === true ||
          String(row[headerIndex['Is_International']]).toLowerCase() === 'true',
        submitterInScope: submitterInScope,
        inScopeTravelerNames: inScopeTravelerNames
      });
    }

    yourReviews.sort(function(a, b) {
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
      return b.daysAtStage - a.daysAtStage;
    });
    stalled.sort(function(a, b) { return b.daysAtStage - a.daysAtStage; });

    var actionCenter = {
      yourReviews: yourReviews,
      stalled: stalled,
      pipelineCounts: pipelineCounts,
      deniedCancelledCounts: { denied: deniedCount, cancelled: cancelledCount }
    };

    // Metrics — period-filtered stats with role-aware spend grouping.
    // Spend attribution is filtered to traveler/submitter contributions that
    // actually fall within the user's scope (matches admin's per-BU column).
    var metrics = _computeReviewerMetrics(rows, headerIndex, scopeChecker, ctx, win, db, travelersByRequestId, orgLookups);

    var response = {
      success: true,
      context: ctx,
      actionCenter: actionCenter,
      requests: requests,
      distinctSectorCodes: Object.keys(sectorCodeSet).sort(),
      distinctBUCodes: Object.keys(buCodeSet).sort(),
      distinctDivisionCodes: Object.keys(divisionCodeSet).sort(),
      periodWindow: { start: win.start.toISOString(), end: win.end.toISOString(), label: win.label },
      metrics: metrics
    };

    console.timeEnd('getReviewerDashboard');
    return JSON.parse(JSON.stringify(response));

  } catch (error) {
    console.error('getReviewerDashboard error:', error);
    logError('getReviewerDashboard', error, { period: period });
    return { success: false, error: error.message || 'Failed to load dashboard' };
  }
}

/**
 * Get a single request summary for the reviewer's slide-in detail panel.
 * Verifies the request is in the caller's scope before returning.
 *
 * @param {string} requestId
 * @returns {Object} { success, request, approvalLog } or { success: false, error }
 */
function getReviewerRequestSummary(requestId, viewAs) {
  try {
    var ctx = getReviewerContext(undefined, viewAs);
    if (!ctx.isReviewer) {
      return { success: false, error: 'Not a reviewer' };
    }
    if (!requestId) {
      return { success: false, error: 'requestId required' };
    }

    var db = new TravelDB();
    var sheetData = db.readSheet(SHEET_NAMES.REQUESTS);
    var headerIndex = sheetData.headerIndex;
    var orgLookups = loadOrgLookups();
    var travelersByRequestId = _loadTravelersByRequest(db);
    var scopeChecker = _buildTravelerAwareScopeChecker(ctx, travelersByRequestId, orgLookups);

    var match = null;
    for (var i = 0; i < sheetData.rows.length; i++) {
      var row = sheetData.rows[i];
      if (row[headerIndex['Request_ID']] !== requestId) continue;
      if (!scopeChecker(row, headerIndex)) {
        return { success: false, error: 'Request not in your scope' };
      }
      match = row;
      break;
    }
    if (!match) {
      return { success: false, error: 'Request not found' };
    }

    // Reuse internal builder from TravelAdminService.js (no auth gate).
    // Scope was already enforced above.
    return _buildRequestSummary(requestId);

  } catch (error) {
    console.error('getReviewerRequestSummary error:', error);
    logError('getReviewerRequestSummary', error, { requestId: requestId });
    return { success: false, error: error.message || 'Failed to load request' };
  }
}

// ============================================================================
// SCOPE FILTERING
// ============================================================================

/**
 * Build a request-level scope predicate that's TRAVELER-AWARE.
 * A request is in scope if ANY of:
 *   - Submitter's BU/Sector matches user's scope
 *   - Any traveler's BU/Sector matches user's scope
 *
 * This mirrors admin's per-BU attribution: a BU's totals include any
 * spend touched by that BU, regardless of who submitted the request.
 *
 * @private
 * @param {Object} ctx - Reviewer context
 * @param {Object} travelersByRequestId - { requestId: [{ orgCode, subtotal }, ...] }
 * @param {Object} orgLookups - { orgToBU, orgToSector, orgToDivision } maps
 * @returns {Function} (row, headerIndex) → boolean
 */
function _buildTravelerAwareScopeChecker(ctx, travelersByRequestId, orgLookups) {
  if (!ctx || !ctx.scope) return function() { return false; };
  var type = ctx.scope.type;

  if (type === 'all') return function() { return true; };

  if (type === 'bu') {
    var nameSet = {};
    var names = ctx.scope.names || [];
    for (var n = 0; n < names.length; n++) nameSet[String(names[n]).toUpperCase()] = true;

    return function(row, hi) {
      // Submitter BU match (covers shared-cost-only requests)
      var submitterBU = String(row[hi['Submitter_BU']] || '').toUpperCase();
      if (submitterBU && nameSet[submitterBU]) return true;

      // Traveler BU match (covers cross-BU travelers)
      var requestId = row[hi['Request_ID']];
      var travelers = travelersByRequestId[requestId] || [];
      for (var i = 0; i < travelers.length; i++) {
        var bu = String(orgLookups.orgToBU[travelers[i].orgCode] || '').toUpperCase();
        if (bu && nameSet[bu]) return true;
      }
      return false;
    };
  }

  if (type === 'sector') {
    var codeSet = {};
    var codes = ctx.scope.codes || [];
    for (var c = 0; c < codes.length; c++) codeSet[String(codes[c]).toUpperCase()] = true;
    var canonical = orgLookups.orgToCurrentOrgCode || {};

    // Canonicalize any (current OR former) org code to the current code,
    // then take the first 4 chars for sector matching. Survives reorg renames.
    function _sectorPrefix(orgCode) {
      var current = canonical[orgCode] || orgCode;
      return String(current || '').substring(0, 4).toUpperCase();
    }

    return function(row, hi) {
      var submitterOrg = String(row[hi['Submitter_Org_Code']] || '');
      if (submitterOrg && codeSet[_sectorPrefix(submitterOrg)]) return true;

      var requestId = row[hi['Request_ID']];
      var travelers = travelersByRequestId[requestId] || [];
      for (var i = 0; i < travelers.length; i++) {
        var oc = travelers[i].orgCode || '';
        if (oc && codeSet[_sectorPrefix(oc)]) return true;
      }
      return false;
    };
  }

  return function() { return false; };
}

/**
 * Load travelers grouped by Request_ID for spend attribution + scope checks.
 * @private
 */
function _loadTravelersByRequest(db) {
  var byId = {};
  try {
    var t = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
    if (t.rows.length === 0) return byId;
    var idx = t.headerIndex;
    var reqIdx = idx['Request_ID'];
    var orgIdx = idx['Org_Code'];
    var subIdx = idx['Subtotal'];
    var clientIdx = idx['Is_Client_Paid'];
    var nameIdx = idx['Employee_Name'];
    for (var i = 0; i < t.rows.length; i++) {
      var row = t.rows[i];
      var rid = row[reqIdx];
      if (!rid) continue;
      // Funding type field is stored as either a boolean-ish flag or
      // the literal string "Client-Paid" / "Overhead". Treat anything
      // truthy or starting with "client" (case-insensitive) as client-paid.
      var rawClient = clientIdx !== undefined ? row[clientIdx] : '';
      var clientStr = String(rawClient || '').trim().toLowerCase();
      var isClientPaid = clientStr === 'true' || clientStr === 'yes' ||
                          clientStr.indexOf('client') === 0;
      if (!byId[rid]) byId[rid] = [];
      byId[rid].push({
        orgCode: String(row[orgIdx] || ''),
        subtotal: parseFloat(row[subIdx]) || 0,
        isClientPaid: isClientPaid,
        name: nameIdx !== undefined ? String(row[nameIdx] || '') : ''
      });
    }
  } catch (e) {
    console.warn('_loadTravelersByRequest: error: ' + e.message);
  }
  return byId;
}

// ============================================================================
// PERIOD WINDOW
// ============================================================================

/**
 * Resolve a period selector into a concrete date window.
 * Supported: '30d' | 'quarter' | 'fy' | 'custom'
 *
 * @private
 */
function _resolvePeriodWindow(period, customStart, customEnd) {
  var now = new Date();
  var start, end = now, label = '';

  if (period === 'custom' && customStart && customEnd) {
    start = new Date(customStart);
    end = new Date(customEnd);
    label = 'Custom';
  } else if (period === 'quarter') {
    var month = now.getMonth();
    var qStartMonth = month >= 9 ? 9 : month >= 6 ? 6 : month >= 3 ? 3 : 0;
    start = new Date(now.getFullYear(), qStartMonth, 1);
    label = 'FY Quarter';
  } else if (period === 'fy') {
    start = now.getMonth() >= 9
      ? new Date(now.getFullYear(), 9, 1)
      : new Date(now.getFullYear() - 1, 9, 1);
    label = 'Fiscal Year';
  } else {
    start = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    label = '30 Days';
  }
  start.setHours(0, 0, 0, 0);

  return { start: start, end: end, label: label };
}

// ============================================================================
// METRICS — period-filtered stats with role-aware spend grouping
// ============================================================================

/**
 * Compute scoped metrics for the reviewer dashboard.
 *
 * Spend grouping drills one level below the user's scope:
 *   admin/oso → spend by Business Unit
 *   bu        → spend by Sector (within their BU)
 *   sector    → spend by Division (within their sector)
 *
 * @private
 * @returns {Object} metrics shape (see end of function)
 */
function _computeReviewerMetrics(rows, headerIndex, scopeChecker, ctx, win, db, travelersByRequestId, orgLookups) {
  // Use pre-loaded data from getReviewerDashboard (single fetch, single source of truth).
  // Caller MUST pass these — they're built once at the dashboard level.
  var orgToBU = (orgLookups && orgLookups.orgToBU) || {};
  var orgToSector = (orgLookups && orgLookups.orgToSector) || {};
  var orgToDivision = (orgLookups && orgLookups.orgToDivision) || {};
  var orgToCurrentOrgCode = (orgLookups && orgLookups.orgToCurrentOrgCode) || {};
  travelersByRequestId = travelersByRequestId || {};

  // ── Pass over Requests in scope and in period ─────────────────────────────
  var totals = { approved: 0, denied: 0, cancelled: 0 };
  var travelTypes = {};
  var spendByGroup = {};         // role-aware grouping (BU / Sector / Division)
  var spendByTravelType = {};    // universal
  var fundingTypeSpend = { clientPaid: { total: 0, count: 0 }, overhead: { total: 0, count: 0 } };
  var leadTimes = [];
  var totalRequests = 0;
  var pendingInMyStage = 0;

  // Volume trend: count submissions per day across the period (for chart)
  var volumeByDay = {};

  var inScopeRequestIds = {};

  // Determine the "your stage" status to count for the user's queue
  var myStageStatus = null;
  if (ctx.role === 'sector') myStageStatus = STATUS_CODES.PENDING_SECTOR;
  else if (ctx.role === 'bu') myStageStatus = STATUS_CODES.PENDING_BU;
  else if (ctx.role === 'oso') myStageStatus = STATUS_CODES.PENDING_OSO;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var status = row[headerIndex['Status']] || '';
    var requestId = row[headerIndex['Request_ID']] || '';
    if (!status || !requestId) continue;
    if (!scopeChecker(row, headerIndex)) continue;

    inScopeRequestIds[requestId] = true;

    // Pending-in-my-stage is always-current (not period filtered)
    if (myStageStatus && status === myStageStatus) pendingInMyStage++;

    var submittedAt = row[headerIndex['Submitted_At']];
    var eventStartDate = row[headerIndex['Event_Start_Date']];
    var grandTotal = parseFloat(row[headerIndex['Grand_Total']]) || 0;
    var sharedTotal = parseFloat(row[headerIndex['Shared_Total']]) || 0;
    var locationType = row[headerIndex['Location_Type']] || 'other';
    var submitterOrgCode = String(row[headerIndex['Submitter_Org_Code']] || '');

    if (!submittedAt) continue;
    var submitDate = new Date(submittedAt);
    if (submitDate < win.start || submitDate > win.end) continue;

    totalRequests++;

    // Volume trend (per day)
    var dayKey = formatDateForStorage(submitDate);
    volumeByDay[dayKey] = (volumeByDay[dayKey] || 0) + 1;

    // Travel types
    if (!travelTypes[locationType]) travelTypes[locationType] = 0;
    travelTypes[locationType]++;

    // Lead time (only for submitted requests in period)
    if (eventStartDate) {
      var leadDays = (new Date(eventStartDate) - submitDate) / TIME_CONSTANTS.MS_PER_DAY;
      if (leadDays > 0) leadTimes.push(leadDays);
    }

    // Approved / denied / cancelled counts
    if (status === STATUS_CODES.APPROVED_GOGOV || status === STATUS_CODES.COMPLETED) {
      totals.approved++;

      // Spend attribution — only count travelers/shared-costs whose attribution
      // falls inside the user's scope. This mirrors admin's per-BU column:
      // for a BU=Army view, only Army travelers' subtotals + shared costs
      // attributable to Army submitters contribute to Army's totals.
      var travelers = travelersByRequestId[requestId] || [];
      var groupTouched = {};
      var requestContributedTravelType = false;
      var requestHasClientPaid = false;
      var requestHasOverhead = false;

      for (var ti = 0; ti < travelers.length; ti++) {
        var tOrg = travelers[ti].orgCode;
        var tSub = travelers[ti].subtotal;
        var tClient = travelers[ti].isClientPaid;
        if (tSub === 0 || !tOrg) continue;

        // Skip travelers outside the user's scope
        if (!_orgInUserScope(tOrg, ctx, orgToBU, orgToCurrentOrgCode)) continue;

        var groupKey = _resolveGroupKey(ctx.role, tOrg, orgToBU, orgToSector, orgToDivision);
        if (!groupKey) continue;
        if (!spendByGroup[groupKey]) spendByGroup[groupKey] = { total: 0, count: 0 };
        spendByGroup[groupKey].total += tSub;
        groupTouched[groupKey] = true;

        if (!spendByTravelType[locationType]) spendByTravelType[locationType] = { total: 0, count: 0 };
        spendByTravelType[locationType].total += tSub;
        requestContributedTravelType = true;

        // Funding-type split — count this traveler's subtotal against their
        // own funding flag so a single request can contribute to both
        // client-paid and overhead buckets if its travelers differ.
        if (tClient) {
          fundingTypeSpend.clientPaid.total += tSub;
          requestHasClientPaid = true;
        } else {
          fundingTypeSpend.overhead.total += tSub;
          requestHasOverhead = true;
        }
      }

      // Shared costs — only attributed to user's totals when the submitter
      // is themselves in the user's scope (matches admin's submitter-attribution).
      if (sharedTotal > 0 && submitterOrgCode && _orgInUserScope(submitterOrgCode, ctx, orgToBU, orgToCurrentOrgCode)) {
        var subGroupKey = _resolveGroupKey(ctx.role, submitterOrgCode, orgToBU, orgToSector, orgToDivision);
        if (subGroupKey) {
          if (!spendByGroup[subGroupKey]) spendByGroup[subGroupKey] = { total: 0, count: 0 };
          spendByGroup[subGroupKey].total += sharedTotal;
          groupTouched[subGroupKey] = true;
        }
        if (!spendByTravelType[locationType]) spendByTravelType[locationType] = { total: 0, count: 0 };
        spendByTravelType[locationType].total += sharedTotal;
        requestContributedTravelType = true;

        // Shared costs go to overhead — they're submitter-level, not
        // attached to any one client-paid traveler.
        fundingTypeSpend.overhead.total += sharedTotal;
        requestHasOverhead = true;
      }

      // Request-level count: +1 per group this request touched
      for (var g in groupTouched) spendByGroup[g].count++;
      if (requestContributedTravelType) {
        spendByTravelType[locationType].count = (spendByTravelType[locationType].count || 0) + 1;
      }
      if (requestHasClientPaid) fundingTypeSpend.clientPaid.count++;
      if (requestHasOverhead) fundingTypeSpend.overhead.count++;

    } else if (status === STATUS_CODES.DENIED) {
      totals.denied++;
    } else if (status === STATUS_CODES.CANCELLED) {
      totals.cancelled++;
    }
  }

  // ── Approval time by stage (from Approval_Log, scoped to in-period decisions) ──
  var approvalTimeByStage = { sector: 0, bu: 0, oso: 0, fas: 0 };
  var avgApprovalTime = 0;

  try {
    var logData = db.readSheet(SHEET_NAMES.APPROVAL_LOG);
    if (logData.rows.length > 0) {
      var logIdx = logData.headerIndex;
      var requestLogs = {};
      for (var li = 0; li < logData.rows.length; li++) {
        var lRow = logData.rows[li];
        var lReqId = lRow[logIdx['Request_ID']];
        if (!inScopeRequestIds[lReqId]) continue;  // only in-scope
        if (!requestLogs[lReqId]) requestLogs[lReqId] = [];
        requestLogs[lReqId].push({
          action: lRow[logIdx['Action']],
          timestamp: lRow[logIdx['Timestamp']],
          prevStatus: lRow[logIdx['Previous_Status']],
          newStatus: lRow[logIdx['New_Status']]
        });
      }

      var sectorTimes = [], buTimes = [], osoTimes = [], fasTimes = [];
      var totalApprovalTimes = [];

      var reqIds = Object.keys(requestLogs);
      for (var ri = 0; ri < reqIds.length; ri++) {
        var logs = requestLogs[reqIds[ri]];
        logs.sort(function(a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

        var firstSubmit = null, finalApproval = null;
        for (var j = 0; j < logs.length; j++) {
          var entry = logs[j];
          var entryTime = new Date(entry.timestamp);

          if (entry.action === ACTION_TYPES.SUBMITTED && !firstSubmit) firstSubmit = entryTime;
          if (entry.newStatus === STATUS_CODES.APPROVED_GOGOV || entry.newStatus === STATUS_CODES.COMPLETED) finalApproval = entryTime;

          if (j < logs.length - 1) {
            var next = logs[j + 1];
            var nextTime = new Date(next.timestamp);
            // Business days only — skip Sat/Sun. Matches admin dashboard.
            var days = businessDaysBetween(entryTime, nextTime);
            var reviewCompleted = nextTime >= win.start && nextTime <= win.end;
            if (days > 0 && days < 90 && reviewCompleted) {
              if (entry.newStatus === STATUS_CODES.PENDING_SECTOR && next.prevStatus === STATUS_CODES.PENDING_SECTOR) sectorTimes.push(days);
              if (entry.newStatus === STATUS_CODES.PENDING_BU && next.prevStatus === STATUS_CODES.PENDING_BU) buTimes.push(days);
              if (entry.newStatus === STATUS_CODES.PENDING_OSO && next.prevStatus === STATUS_CODES.PENDING_OSO) osoTimes.push(days);
              if (entry.newStatus === STATUS_CODES.PENDING_FAS && next.prevStatus === STATUS_CODES.PENDING_FAS) fasTimes.push(days);
            }
          }
        }

        if (firstSubmit && finalApproval && finalApproval >= win.start && finalApproval <= win.end) {
          var totalDays = (finalApproval - firstSubmit) / TIME_CONSTANTS.MS_PER_DAY;
          if (totalDays > 0 && totalDays < 365) totalApprovalTimes.push(totalDays);
        }
      }

      // Send raw averages (fractional business days). The client formats
      // sub-day values as hours and multi-day values as days, so we
      // can't pre-round here without collapsing real same-day reviews
      // to zero — e.g. a BU stage that took 46 minutes is 0.032 days,
      // and Math.round(0.032 * 10) / 10 = 0, which would render as
      // "no data" even though a review happened.
      var avg = function(arr) { return arr.length > 0 ? arr.reduce(function(a, b) { return a + b; }, 0) / arr.length : 0; };
      approvalTimeByStage.sector = avg(sectorTimes);
      approvalTimeByStage.bu = avg(buTimes);
      approvalTimeByStage.oso = avg(osoTimes);
      approvalTimeByStage.fas = avg(fasTimes);
      avgApprovalTime = avg(totalApprovalTimes);
    }
  } catch (e) {
    console.warn('_computeReviewerMetrics: approval log error: ' + e.message);
  }

  // ── Total spend (sum of all groups) ───────────────────────────────────────
  var totalSpend = 0;
  Object.keys(spendByGroup).forEach(function(k) { totalSpend += spendByGroup[k].total; });

  var avgFn = function(arr) { return arr.length > 0 ? arr.reduce(function(a, b) { return a + b; }, 0) / arr.length : 0; };

  // Approval rate — % of decided requests that were approved (not
  // counting cancelled, since cancellation isn't a quality signal).
  // Mirrors how the admin dashboard computes its rate.
  var decidedCount = totals.approved + totals.denied;
  var approvalRate = decidedCount > 0
    ? Math.round((totals.approved / decidedCount) * 100)
    : 0;

  return {
    totalRequests: totalRequests,
    totalSpend: roundMoney(totalSpend),
    pendingInMyStage: pendingInMyStage,
    totals: totals,
    approvalRate: approvalRate,
    travelTypes: travelTypes,
    spendByGroup: spendByGroup,           // role-aware: BU | Sector | Division
    spendByGroupLabel: _spendGroupLabelFor(ctx.role),
    spendByTravelType: spendByTravelType,
    fundingTypeSpend: {
      clientPaid: { total: roundMoney(fundingTypeSpend.clientPaid.total), count: fundingTypeSpend.clientPaid.count },
      overhead: { total: roundMoney(fundingTypeSpend.overhead.total), count: fundingTypeSpend.overhead.count }
    },
    avgLeadTime: Math.round(avgFn(leadTimes) * 10) / 10,
    avgApprovalTime: avgApprovalTime,
    approvalTimeByStage: approvalTimeByStage,
    volumeByDay: volumeByDay
  };
}

/**
 * Check whether a given orgCode falls inside the user's scope.
 * Used to filter individual traveler/submitter contributions when computing
 * spend totals — admin/oso include everything; bu/sector only count
 * contributions that land in their scope group.
 *
 * @private
 */
function _orgInUserScope(orgCode, ctx, orgToBU, orgToCurrentOrgCode) {
  if (!ctx || !ctx.scope) return false;
  if (ctx.scope.type === 'all') return true;
  if (!orgCode) return false;

  if (ctx.scope.type === 'bu') {
    // orgToBU already includes former org codes mapped to current BU,
    // so reorged historic codes resolve to today's BU here.
    var bu = String(orgToBU[orgCode] || '').toUpperCase();
    if (!bu) return false;
    var names = ctx.scope.names || [];
    for (var i = 0; i < names.length; i++) {
      if (bu === String(names[i]).toUpperCase()) return true;
    }
    return false;
  }

  if (ctx.scope.type === 'sector') {
    // Canonicalize to current org code first so a former code like 'QFAA'
    // is rewritten to its current 'FAB1' before the 4-char prefix match.
    var canonical = (orgToCurrentOrgCode && orgToCurrentOrgCode[orgCode]) || orgCode;
    var prefix = String(canonical).substring(0, 4).toUpperCase();
    var codes = ctx.scope.codes || [];
    for (var c = 0; c < codes.length; c++) {
      if (prefix === String(codes[c]).toUpperCase()) return true;
    }
    return false;
  }

  return false;
}

/**
 * Resolve the group key for spend attribution based on role.
 * @private
 */
function _resolveGroupKey(role, orgCode, orgToBU, orgToSector, orgToDivision) {
  if (!orgCode) return null;
  if (role === 'admin' || role === 'oso') return orgToBU[orgCode] || 'Unknown BU';
  // For sector + division grouping, an orgCode without a deeper bucket sits at
  // the parent's Front Office (FO). Matches admin's spendBySector convention.
  if (role === 'bu') return orgToSector[orgCode] || 'FO';
  if (role === 'sector') return orgToDivision[orgCode] || 'FO';
  return null;
}

/**
 * Label for the spend-by-group widget.
 * @private
 */
function _spendGroupLabelFor(role) {
  if (role === 'admin' || role === 'oso') return 'Spend by BU';
  if (role === 'bu') return 'Spend by Sector';
  if (role === 'sector') return 'Spend by Division';
  return 'Spend';
}


