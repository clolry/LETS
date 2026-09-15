/**
 * Admin_Dashboard.js
 * Read path for the admin domain — dashboards, request views, summaries.
 *
 * Exports (all @client unless noted):
 * - getAdminDashboard()         — consolidated dashboard (stats + actionCenter
 *   + requests + distinctBUCodes) in a single envelope; supports period
 *   filtering and custom date ranges.
 * - getAllTravelRequests()      — full request dataset for the Requests tab
 *   (client-side filter/sort/paginate).
 * - getRequestSummary()         — condensed request + approval log for the
 *   admin slide-in panel; wraps _buildRequestSummary().
 *
 * Internal helpers (@private @server):
 * - _buildRequestSummary()      — produces the legacy
 *   {success, request, approvalLog} shape consumed by ReviewerDashboard.js
 *   (kept stable for that caller; getRequestSummary wraps into the envelope).
 * - _seedReviewerMapFromUnifiedRoles() — populates the per-reviewer aggregation
 *   map from Travel_User_Roles before the request-loop scan.
 * - _parseReassignTarget(), _resolveReviewerStart() — reassignment-aware
 *   time computation for reviewer-performance metrics.
 *
 * Editor diagnostic (@editor):
 * - debugReviewerPerf()         — prints raw per-reviewer perf data for one
 *   email; uses _parseReassignTarget + _resolveReviewerStart.
 *
 * Companion files: Admin_Actions.js, Admin_Cleanup.js
 * Routing helpers (_reassignPendingForRoleChange, _orphanPendingForRoleChange,
 * _findHCSectorDirector) were relocated to Users.js in Chunk 14 — they're
 * called only from Users.js role-management code, never from any Admin file.
 */

// ============================================================================
// HELPERS — reviewer-performance reassignment-aware time computation
// ============================================================================

/**
 * Pull the new reviewer's email from an ADMIN_REASSIGN log entry.
 * New entries (post-2026-04) carry { newReviewerEmail, ... } in Snapshot_Data.
 * Older entries only have it embedded in the Comments string — fall back to
 * regex on "from <old> to <new>".
 *
 * @param {Object} logEntry - Log entry shape: { action, timestamp, comments, snapshotData, ... }
 * @returns {string|null} Lowercased email or null if not parseable.
 * @private
 * @server
 */
function _parseReassignTarget(logEntry) {
  if (!logEntry || logEntry.action !== ACTION_TYPES.ADMIN_REASSIGN) return null;

  // Preferred: structured Snapshot_Data
  if (logEntry.snapshotData) {
    try {
      const obj = JSON.parse(logEntry.snapshotData);
      if (obj && obj.newReviewerEmail) {
        return String(obj.newReviewerEmail).toLowerCase();
      }
    } catch (_) { /* fall through to comment parse */ }
  }

  // Legacy fallback: parse "to <email>" out of the auto-generated comment
  const comments = String(logEntry.comments || '');
  const match = comments.match(/\bto\s+([^\s:()]+@[^\s:()]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Resolve the start of a reviewer's review clock for a given approval action.
 *
 * Walk backward from the approval entry to find when the request entered the
 * target stage (the existing rule). Then scan forward from that point to the
 * approval, looking for the latest ADMIN_REASSIGN entry that handed the
 * request to the current reviewer. If found, that timestamp is the real
 * start of THIS reviewer's clock — earlier handoffs to other reviewers
 * don't count against them.
 *
 * Example: Jen has a request at PENDING_BU for 7 days. Admin reassigns to
 * Zach. Zach approves 1 day later. Without this fix Zach gets credited with
 * 8 days; with it he gets credited with 1.
 *
 * @param {Array} logs - Sorted (asc) logs for a single request
 * @param {number} approvalIndex - Index of the approval entry in `logs`
 * @param {string} targetStatus - The PENDING_* status the reviewer was acting on
 * @param {string} actorEmailLower - Lowercased email of the approving reviewer
 * @returns {Date|null} Start timestamp, or null if no stage-entry found
 * @private
 * @server
 */
function _resolveReviewerStart(logs, approvalIndex, targetStatus, actorEmailLower) {
  if (!targetStatus) return null;

  // Step 1: stage entry (existing rule)
  let startTime = null;
  let stageEntryIdx = -1;
  for (let k = approvalIndex - 1; k >= 0; k--) {
    if (logs[k].newStatus === targetStatus) {
      startTime = new Date(logs[k].timestamp);
      stageEntryIdx = k;
      break;
    }
  }

  // Fallback when no stage-entry log is found (data drift, manual
  // status edit that didn't write a clean transition row, etc.):
  // use the immediately prior log entry as a proxy start. Better than
  // dropping the action entirely from the reviewer's avg-time calc.
  if (!startTime && approvalIndex > 0) {
    const prev = logs[approvalIndex - 1];
    if (prev && prev.timestamp) {
      startTime = new Date(prev.timestamp);
      stageEntryIdx = approvalIndex - 1;
    }
  }
  if (!startTime) return null;

  // Step 2: latest ADMIN_REASSIGN to this reviewer between stage entry
  // and the approval — if any, that's a later (better) start time.
  for (let k = approvalIndex - 1; k > stageEntryIdx; k--) {
    const lk = logs[k];
    if (!lk || lk.action !== ACTION_TYPES.ADMIN_REASSIGN) continue;
    const target = _parseReassignTarget(lk);
    if (target && target === actorEmailLower) {
      const reassignTime = new Date(lk.timestamp);
      if (reassignTime > startTime) startTime = reassignTime;
      break;  // walking backward, first match is the latest
    }
  }

  return startTime;
}

/**
 * Diagnostic: per-action breakdown for a single reviewer email.
 * Run from the Apps Script editor:
 *   debugReviewerPerf('michael.baumann@gsa.gov')
 * Returns + console.logs each action this reviewer took with the
 * resolved start time, the raw and business-day deltas, and whether
 * the action contributed to totalDays. Useful for figuring out why a
 * reviewer with reviewedCount > 0 ends up with 0 avg time (no
 * matching stage entry, all over the 90-day cap, etc.).
 * @editor
 */
function debugReviewerPerf(targetEmail) {
  if (!targetEmail) throw new Error('debugReviewerPerf: email required');
  var lowerTarget = String(targetEmail).toLowerCase();
  var db = new TravelDB();
  var logSheet = db.readSheet(SHEET_NAMES.APPROVAL_LOG);
  var logIndex = logSheet.headerIndex;

  // Bucket all logs by request_id (matches the perf builder's structure)
  var byReq = {};
  for (var i = 0; i < logSheet.rows.length; i++) {
    var row = logSheet.rows[i];
    var rid = row[logIndex['Request_ID']];
    if (!rid) continue;
    if (!byReq[rid]) byReq[rid] = [];
    byReq[rid].push({
      action: row[logIndex['Action']],
      timestamp: row[logIndex['Timestamp']],
      prevStatus: row[logIndex['Previous_Status']],
      newStatus: row[logIndex['New_Status']],
      actorEmail: row[logIndex['Action_By_Email']],
      actorName: row[logIndex['Action_By_Name']],
      comments: row[logIndex['Comments']]
    });
  }

  var stageMap = {
    [ACTION_TYPES.SECTOR_APPROVED]: STATUS_CODES.PENDING_SECTOR, [ACTION_TYPES.SECTOR_NEEDS_INFO]: STATUS_CODES.PENDING_SECTOR,
    [ACTION_TYPES.BU_APPROVED]: STATUS_CODES.PENDING_BU, [ACTION_TYPES.BU_NEEDS_INFO]: STATUS_CODES.PENDING_BU,
    [ACTION_TYPES.OSO_APPROVED]: STATUS_CODES.PENDING_OSO, [ACTION_TYPES.OSO_NEEDS_INFO]: STATUS_CODES.PENDING_OSO
  };
  var approvalActions = [ACTION_TYPES.SECTOR_APPROVED, ACTION_TYPES.BU_APPROVED, ACTION_TYPES.OSO_APPROVED,
                         ACTION_TYPES.SECTOR_NEEDS_INFO, ACTION_TYPES.BU_NEEDS_INFO, ACTION_TYPES.OSO_NEEDS_INFO, ACTION_TYPES.DENIED];

  var report = [];
  Object.keys(byReq).forEach(function(rid) {
    var logs = byReq[rid];
    logs.sort(function(a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    for (var j = 0; j < logs.length; j++) {
      var entry = logs[j];
      if (!entry.actorEmail) continue;
      if (entry.actorEmail.toLowerCase() !== lowerTarget) continue;
      if (approvalActions.indexOf(entry.action) === -1) continue;

      var targetStatus = stageMap[entry.action] || (entry.action === ACTION_TYPES.DENIED ? entry.prevStatus : null);
      var entryTime = new Date(entry.timestamp);
      var reviewStart = _resolveReviewerStart(logs, j, targetStatus, lowerTarget);
      var reviewDays = reviewStart ? businessDaysBetween(reviewStart, entryTime) : null;
      var counted = reviewDays !== null && reviewDays > 0 && reviewDays < 90;

      report.push({
        requestId: rid,
        action: entry.action,
        actionAt: entry.timestamp,
        targetStatus: targetStatus,
        reviewStart: reviewStart ? reviewStart.toISOString() : null,
        reviewDaysBusiness: reviewDays === null ? null : Math.round(reviewDays * 100) / 100,
        counted: counted,
        skipReason: counted ? '' :
          (reviewDays === null ? 'no start resolved' :
           reviewDays <= 0 ? 'non-positive delta' :
           reviewDays >= 90 ? 'over 90-day cap' : 'unknown')
      });
    }
  });

  console.log('debugReviewerPerf for ' + lowerTarget + ': ' + report.length + ' actions');
  report.forEach(function(r, i) {
    console.log((i + 1) + '. ' + r.requestId + ' / ' + r.action + ' @ ' + r.actionAt +
                ' | start=' + (r.reviewStart || 'null') +
                ' | days=' + (r.reviewDaysBusiness === null ? 'null' : r.reviewDaysBusiness) +
                ' | ' + (r.counted ? 'COUNTED' : 'SKIPPED: ' + r.skipReason));
  });
  var counted = report.filter(function(r) { return r.counted; });
  var totalDays = counted.reduce(function(s, r) { return s + r.reviewDaysBusiness; }, 0);
  console.log('Summary: ' + report.length + ' actions, ' + counted.length + ' counted, ' +
              'totalDays=' + Math.round(totalDays * 100) / 100 +
              ', avg=' + (counted.length > 0 ? Math.round((totalDays / counted.length) * 100) / 100 : 0));

  return { reviewer: lowerTarget, totalActions: report.length, counted: counted.length, breakdown: report };
}
// ============================================================================
// DASHBOARD — CONSOLIDATED (v2)
// ============================================================================

/**
 * Seed the reviewer-performance map from Travel_User_Roles (single source).
 * Output shape:
 *   reviewerMap[email_lowered] = {
 *     name, email, role: 'BU'|'AAS FO'|'Sector',
 *     scope, totalDays, reviewedCount, pendingCount
 *   }
 * Plus side-channel maps populated for downstream code that needs them:
 *   emailToBUName[email]      = BU name (for BU reviewer's BU)
 *   emailToSectorCode[email]  = 4-char sector code (for sector overrides)
 *
 * Caller still does the HC SD walk separately for HC-derived sector
 * directors not covered by sector_override roles — that logic stays
 * intact since it sources from HC, not legacy sheets.
 *
 * @param {Object} reviewerMap        — gets new entries
 * @param {Object} emailToBUName      — gets new entries
 * @param {Object} emailToSectorCode  — gets new entries
 * @param {Object} sectorToBU         — read-only, sector code -> BU name
 * @private
 * @server
 */
function _seedReviewerMapFromUnifiedRoles(reviewerMap, emailToBUName, emailToSectorCode, sectorToBU) {
  try {
    var data = _getUnifiedRoleData();
    // Build reverse map sectorName -> 4-char code for sector_override
    // resolution. Done once; loadOrgLookups is itself cached.
    var sectorNameToCode = {};
    try {
      var orgLookups = loadOrgLookups();
      var orgToSector = (orgLookups && orgLookups.orgToSector) || {};
      for (var oc in orgToSector) {
        if (!orgToSector.hasOwnProperty(oc)) continue;
        var sName = orgToSector[oc];
        var sCode = String(oc).substring(0, 4).toUpperCase();
        if (sName && sCode && !sectorNameToCode[sName]) {
          sectorNameToCode[sName] = sCode;
        }
      }
    } catch (e) {
      console.warn('_seedReviewerMapFromUnifiedRoles: orgLookups failed: ' + e.message);
    }

    for (var em in data.rolesByEmail) {
      if (!data.rolesByEmail.hasOwnProperty(em)) continue;
      var roles = data.rolesByEmail[em];
      for (var i = 0; i < roles.length; i++) {
        var r = roles[i];
        if (r.roleType === 'bu_reviewer') {
          if (!emailToBUName[em]) emailToBUName[em] = r.scope;
          if (!reviewerMap[em]) {
            reviewerMap[em] = {
              name: r.userName || '', email: em,
              role: 'BU', scope: r.scope,
              totalDays: 0, reviewedCount: 0, pendingCount: 0
            };
          }
        } else if (r.roleType === 'aas_fo_reviewer') {
          if (!reviewerMap[em]) {
            reviewerMap[em] = {
              name: r.userName || '', email: em,
              role: 'AAS FO', scope: 'Front Office',
              totalDays: 0, reviewedCount: 0, pendingCount: 0
            };
          }
        } else if (r.roleType === 'sector_override') {
          // Scope on new schema is sector NAME — resolve to a 4-char code
          // for downstream code (and pretty-print the scope label).
          var sectorName = r.scope;
          var resolvedCode = sectorNameToCode[sectorName] || '';
          if (resolvedCode && !emailToSectorCode[em]) {
            emailToSectorCode[em] = resolvedCode;
          }
          if (!reviewerMap[em]) {
            var buPart = resolvedCode ? sectorToBU[resolvedCode] : '';
            var displayScope = buPart
              ? (buPart + ' · ' + sectorName)
              : sectorName;
            reviewerMap[em] = {
              name: r.userName || '', email: em,
              role: 'Sector', scope: displayScope,
              totalDays: 0, reviewedCount: 0, pendingCount: 0
            };
          }
        }
        // admin and approved_user are not tracked for reviewer perf
      }
    }
  } catch (e) {
    console.error('_seedReviewerMapFromUnifiedRoles error: ' + e.message);
  }
}

/**
 * Get the full admin page payload in a single server call.
 * Returns EVERYTHING the admin page needs: dashboard, requests list.
 * One round-trip. All tab switches after this are pure client-side.
 *
 * @param {string} userEmail - Current admin's email (for "your reviews")
 * @param {string} period - '30d', 'quarter', 'fy', or 'custom' (defaults to '30d')
 * @param {string} [customStart] - ISO date when period === 'custom'
 * @param {string} [customEnd]   - ISO date when period === 'custom'
 * @returns {Object} successResponse({ actionCenter, stats, requests, distinctBUCodes }) or errorResponse(msg)
 * @client
 */
function getAdminDashboard(userEmail, period, customStart, customEnd) {
  console.time('getAdminDashboard');
  try {
    console.time('getAdminDashboard.requireAdmin');
    requireTravelAdmin();
    console.timeEnd('getAdminDashboard.requireAdmin');

    period = period || '30d';
    if (!userEmail) userEmail = Session.getActiveUser().getEmail();

    // Check stats cache (action center is user-specific, can't cache).
    // For custom ranges, fold the start/end into the cache key so different
    // windows don't collide. Non-custom keys stay backwards-compatible.
    console.time('getAdminDashboard.cacheCheck');
    var cache = CacheService.getScriptCache();
    // Cache key version bump — increment when the perf-builder shape
    // changes (e.g., switching reviewer perf from period-filtered to
    // all-time). Forces stale cached responses to be ignored without
    // waiting for the 5-min TTL to expire.
    var statsCacheKey = 'admin_dashboard_stats_v4_' + period;
    if (period === 'custom' && customStart && customEnd) {
      // Day-resolution key — distinct windows get distinct cache buckets,
      // and we don't blow up the cache by caching every minute-of-the-day.
      var startKey = String(customStart).slice(0, 10);
      var endKey = String(customEnd).slice(0, 10);
      statsCacheKey = 'admin_dashboard_stats_v4_custom_' + startKey + '_' + endKey;
    }
    var cachedStats = null;
    var cachedStatsRaw = cache.get(statsCacheKey);
    if (cachedStatsRaw) {
      try { cachedStats = JSON.parse(cachedStatsRaw); } catch (e) {}
    }
    console.timeEnd('getAdminDashboard.cacheCheck');
    console.log('getAdminDashboard: stats cache ' + (cachedStats ? 'HIT' : 'MISS') + ' for key=' + statsCacheKey);

    var db = new TravelDB();
    var sheetData = db.readSheet(SHEET_NAMES.REQUESTS);
    var headers = sheetData.headers;
    var requestRows = sheetData.rows;
    var headerIndex = sheetData.headerIndex;

    if (headers.length === 0) throw new Error('Requests sheet not found');

    // ── Action Center (always computed — user-specific) ──
    var now = new Date();
    var twoDaysAgo = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000));
    var tenDaysFromNow = new Date(now.getTime() + (10 * 24 * 60 * 60 * 1000));
    var startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    var yourReviews = [];
    var stalledCandidates = [];
    var deniedCount = 0, cancelledCount = 0;
    var pipelineCounts = { sector: 0, bu: 0, oso: 0, fas: 0, ddConfirm: 0, approved: 0, completed: 0 };

    var pendingStatuses = [STATUS_CODES.PENDING_SECTOR, STATUS_CODES.PENDING_BU, STATUS_CODES.PENDING_OSO, STATUS_CODES.PENDING_FAS];
    var stalledStatuses = [STATUS_CODES.PENDING_SECTOR, STATUS_CODES.PENDING_BU, STATUS_CODES.PENDING_OSO, STATUS_CODES.PENDING_FAS,
                           STATUS_CODES.NEEDS_INFO_SECTOR, STATUS_CODES.NEEDS_INFO_BU, STATUS_CODES.NEEDS_INFO_OSO];

    // ── Stats (skip computation if cached) ──
    var needsStats = !cachedStats;
    // orgToSector / orgCodeToBU come from the shared loadOrgLookups() util,
    // which canonicalizes via formerOrgCodes — historic submissions stored
    // under reorged codes resolve to today's BU / Sector here too.
    var sharedLookups = loadOrgLookups();
    var orgToSector = sharedLookups.orgToSector;
    var orgCodeToBU = sharedLookups.orgToBU;
    var buToSectorSet = {};
    var sectorToBU = {};  // Sector code → BU name (for "BU · Sector" labels)
    var travelersByRequestId = {}, allBUNames = [];
    var seededSpendByBU = {}, spendBySector = {};
    var periodStart, periodEnd = now;
    var currentReviewerPending = {}, leadTimes = [];
    var stats = null;

    if (needsStats) {
      console.time('getAdminDashboard.statsPrep');
      // Walk org hierarchy once to derive admin-specific UI structures
      // (BU→sectors mapping for spend chart seeding, and the canonical BU list).
      // The orgCode lookups themselves are already canonicalized above.
      try {
        console.time('getAdminDashboard.HC.hcGetOrgHierarchy');
        var orgs = HC.hcGetOrgHierarchy();
        console.timeEnd('getAdminDashboard.HC.hcGetOrgHierarchy');
        var buSeen = {};
        for (var oi = 0; oi < orgs.length; oi++) {
          var o = orgs[oi];
          if (!o || !o.orgCode) continue;
          var sector = normalizeSectorName(o.sector);
          if (o.businessUnit && sector) {
            if (!buToSectorSet[o.businessUnit]) buToSectorSet[o.businessUnit] = {};
            buToSectorSet[o.businessUnit][sector] = true;
            // First-write-wins: a sector should map to exactly one BU
            // in healthy data, but if there's drift we keep the first
            // observation rather than churning the label.
            if (!sectorToBU[sector]) sectorToBU[sector] = o.businessUnit;
          }
          if (o.businessUnit && !buSeen[o.businessUnit]) {
            buSeen[o.businessUnit] = true;
            allBUNames.push(o.businessUnit);
          }
        }
      } catch (e) { console.warn('Failed to load HC org hierarchy:', e.message); }

      // Load travelers for sector spend + funding-type split
      var travData = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
      if (travData.rows.length > 0) {
        var tReqIdx = travData.headerIndex['Request_ID'];
        var tOrgIdx = travData.headerIndex['Org_Code'];
        var tSubIdx = travData.headerIndex['Subtotal'];
        var tClientIdx = travData.headerIndex['Is_Client_Paid'];
        for (var t = 0; t < travData.rows.length; t++) {
          var tRow = travData.rows[t];
          var tReqId = tRow[tReqIdx];
          if (!tReqId) continue;
          // Funding-type flag: stored as boolean-ish or "Client-Paid"/"Overhead".
          // Normalize so the period loop below can split by funding type without
          // re-checking the raw cell shape.
          var clientRaw = tClientIdx !== undefined ? tRow[tClientIdx] : '';
          var clientStr = String(clientRaw || '').trim().toLowerCase();
          var isClientPaid = clientStr === 'true' || clientStr === 'yes' ||
                             clientStr.indexOf('client') === 0;
          if (!travelersByRequestId[tReqId]) travelersByRequestId[tReqId] = [];
          travelersByRequestId[tReqId].push({
            orgCode: String(tRow[tOrgIdx] || ''),
            subtotal: parseFloat(tRow[tSubIdx]) || 0,
            isClientPaid: isClientPaid
          });
        }
      }

      // Period date range — supports 30d / quarter / fy / custom.
      // Custom ranges fall back to 30d if either bound is missing or invalid.
      if (period === 'custom' && customStart && customEnd) {
        var cs = new Date(customStart);
        var ce = new Date(customEnd);
        if (!isNaN(cs.getTime()) && !isNaN(ce.getTime())) {
          periodStart = cs;
          periodEnd = ce;
          periodEnd.setHours(23, 59, 59, 999);
        } else {
          periodStart = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        }
      } else if (period === 'quarter') {
        var month = now.getMonth();
        var qStartMonth = month >= 9 ? 9 : month >= 6 ? 6 : month >= 3 ? 3 : 0;
        periodStart = new Date(now.getFullYear(), qStartMonth, 1);
      } else if (period === 'fy') {
        periodStart = now.getMonth() >= 9
          ? new Date(now.getFullYear(), 9, 1)
          : new Date(now.getFullYear() - 1, 9, 1);
      } else {
        periodStart = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      }
      periodStart.setHours(0, 0, 0, 0);

      // (Phase 8b) Reviewer-perf seeding now reads from Travel_User_Roles
      // via _seedReviewerMapFromUnifiedRoles below — no legacy sheet read here.

      // Seed spendByBU and spendBySector from HC hierarchy BU names
      allBUNames.forEach(function(n) {
        seededSpendByBU[n] = { total: 0, count: 0 };
        spendBySector[n] = { 'FO': { total: 0, count: 0 } };
        var sectors = buToSectorSet[n] || {};
        Object.keys(sectors).forEach(function(s) {
          spendBySector[n][s] = { total: 0, count: 0 };
        });
      });

      stats = {
        pending: { sector: 0, bu: 0, oso: 0, fas: 0 },
        avgReviewTime: { sector: 0, bu: 0, oso: 0, overall: 0 },
        travelTypes: {},
        volume: { thisWeek: 0, thisMonth: 0, lastMonth: 0 },
        approvalRate: 0, totalRequests: 0,
        totals: { approved: 0, denied: 0, cancelled: 0 },
        avgApprovalTime: 0, avgLeadTime: 0,
        approvalTimeByStage: { sector: 0, bu: 0, oso: 0, fas: 0 },
        spendByBU: seededSpendByBU, spendBySector: spendBySector,
        // Funding-type split — populated alongside spendByBU during the
        // per-request traversal below. Each traveler's subtotal is
        // attributed to its own Is_Client_Paid bucket; shared costs go
        // to overhead since they're submitter-level not traveler-level.
        fundingTypeSpend: {
          clientPaid: { total: 0, count: 0 },
          overhead: { total: 0, count: 0 }
        },
        reviewerPerformance: []
      };

      var startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      var startOfMonthStats = new Date(now.getFullYear(), now.getMonth(), 1);
      var startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      var endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      console.timeEnd('getAdminDashboard.statsPrep');
    }

    // ── Single pass over Requests (builds action center + stats + requests list) ──
    console.time('getAdminDashboard.requestsLoop');
    var allRequests = [];
    var buCodeSet = {};

    for (var i = 0; i < requestRows.length; i++) {
      var row = requestRows[i];
      var status = row[headerIndex['Status']] || '';
      var requestId = row[headerIndex['Request_ID']] || '';
      if (!status || !requestId) continue;

      var tripName = row[headerIndex['Trip_Name']] || '';
      var submitterName = row[headerIndex['Submitter_Name']] || '';
      var buCode = row[headerIndex['Submitter_BU']] || '';
      var submitterOrgCode = String(row[headerIndex['Submitter_Org_Code']] || '');
      var grandTotal = parseFloat(row[headerIndex['Grand_Total']]) || 0;
      var sharedTotal = parseFloat(row[headerIndex['Shared_Total']]) || 0;
      var eventStartDate = row[headerIndex['Event_Start_Date']];
      var updatedAt = row[headerIndex['Updated_At']];
      var submittedAt = row[headerIndex['Submitted_At']];
      var currentReviewerEmail = (row[headerIndex['Current_Reviewer_Email']] || '').toLowerCase();
      var currentReviewerName = row[headerIndex['Current_Reviewer_Name']] || '';
      var locationType = row[headerIndex['Location_Type']] || 'other';

      var daysAtStage = updatedAt ? Math.floor((now - new Date(updatedAt)) / TIME_CONSTANTS.MS_PER_DAY) : 0;
      var isUrgent = eventStartDate ? new Date(eventStartDate) <= tenDaysFromNow : false;

      // ── Action Center computations ──
      if (pendingStatuses.indexOf(status) !== -1 && currentReviewerEmail === userEmail.toLowerCase()) {
        yourReviews.push({
          requestId: requestId, tripName: tripName, status: status,
          submitterName: submitterName, buCode: buCode, grandTotal: grandTotal,
          eventStartDate: formatDateValue(eventStartDate),
          updatedAt: formatDateValue(updatedAt),
          daysAtStage: daysAtStage, isUrgent: isUrgent
        });
      }

      if (stalledStatuses.indexOf(status) !== -1 && updatedAt && new Date(updatedAt) <= twoDaysAgo) {
        stalledCandidates.push({
          requestId: requestId, tripName: tripName, status: status,
          submitterName: submitterName, currentReviewerName: currentReviewerName,
          grandTotal: grandTotal, updatedAt: formatDateValue(updatedAt), daysAtStage: daysAtStage
        });
      }

      if (updatedAt && new Date(updatedAt) >= startOfMonth) {
        if (status === STATUS_CODES.DENIED) deniedCount++;
        if (status === STATUS_CODES.CANCELLED) cancelledCount++;
      }

      // ── Build requests list for Requests tab ──
      if (buCode) buCodeSet[buCode] = true;
      allRequests.push({
        requestId: requestId, tripName: tripName, status: status, buCode: buCode,
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
        isInternational: row[headerIndex['Is_International']] === true || String(row[headerIndex['Is_International']]).toLowerCase() === 'true'
      });

      // Pipeline (shared — used by both action center and stats)
      if (status === STATUS_CODES.PENDING_SECTOR) pipelineCounts.sector++;
      else if (status === STATUS_CODES.PENDING_BU) pipelineCounts.bu++;
      else if (status === STATUS_CODES.PENDING_OSO) pipelineCounts.oso++;
      else if (status === STATUS_CODES.PENDING_FAS) pipelineCounts.fas++;
      else if (status === STATUS_CODES.PENDING_DD_CONFIRMATION) pipelineCounts.ddConfirm++;
      else if (status === STATUS_CODES.APPROVED_GOGOV) pipelineCounts.approved++;
      else if (status === STATUS_CODES.COMPLETED) pipelineCounts.completed++;

      // ── Stats computations (only if not cached) ──
      if (needsStats) {
        if (status === STATUS_CODES.PENDING_SECTOR) stats.pending.sector++;
        else if (status === STATUS_CODES.PENDING_BU) stats.pending.bu++;
        else if (status === STATUS_CODES.PENDING_OSO) stats.pending.oso++;
        else if (status === STATUS_CODES.PENDING_FAS) stats.pending.fas++;

        if (status.indexOf('PENDING_') === 0 && currentReviewerEmail) {
          if (!currentReviewerPending[currentReviewerEmail]) currentReviewerPending[currentReviewerEmail] = 0;
          currentReviewerPending[currentReviewerEmail]++;
        }

        if (submittedAt) {
          var submitDate = new Date(submittedAt);
          if (submitDate >= startOfWeek) stats.volume.thisWeek++;
          if (submitDate >= startOfMonthStats) stats.volume.thisMonth++;
          if (submitDate >= startOfLastMonth && submitDate <= endOfLastMonth) stats.volume.lastMonth++;
        }

        var inPeriod = submittedAt && new Date(submittedAt) >= periodStart && new Date(submittedAt) <= periodEnd;
        if (inPeriod) {
          stats.totalRequests++;

          if (status === STATUS_CODES.APPROVED_GOGOV || status === STATUS_CODES.COMPLETED) {
            stats.totals.approved++;
            var travelers = travelersByRequestId[requestId] || [];
            // Track which BUs this request touched so count = unique requests (not travelers)
            var buTouchedByThisRequest = {};
            // Track whether this request contributed to each funding bucket
            // so request-count is +1 per request, not per traveler.
            var requestHasClientPaid = false;
            var requestHasOverhead = false;

            // Attribute each traveler's cost to their own BU + sector
            for (var ti = 0; ti < travelers.length; ti++) {
              var tOrgCode = travelers[ti].orgCode;
              var tSubtotal = travelers[ti].subtotal;
              var tIsClient = travelers[ti].isClientPaid;
              if (tSubtotal === 0) continue;
              var tBU = (tOrgCode && orgCodeToBU[tOrgCode]) || orgCodeToBU[submitterOrgCode] || 'Unknown';
              var tSector = (tOrgCode && orgToSector[tOrgCode]) || 'FO';

              if (!stats.spendByBU[tBU]) stats.spendByBU[tBU] = { total: 0, count: 0 };
              stats.spendByBU[tBU].total += tSubtotal;
              buTouchedByThisRequest[tBU] = true;

              // Sector count still increments per traveler
              if (!stats.spendBySector[tBU]) stats.spendBySector[tBU] = {};
              if (!stats.spendBySector[tBU][tSector]) stats.spendBySector[tBU][tSector] = { total: 0, count: 0 };
              stats.spendBySector[tBU][tSector].total += tSubtotal;
              stats.spendBySector[tBU][tSector].count++;

              // Funding-type split — by traveler so a mixed request lands
              // in both buckets correctly.
              if (tIsClient) {
                stats.fundingTypeSpend.clientPaid.total += tSubtotal;
                requestHasClientPaid = true;
              } else {
                stats.fundingTypeSpend.overhead.total += tSubtotal;
                requestHasOverhead = true;
              }
            }

            // Attribute shared costs to submitter's BU (no sector breakdown)
            if (sharedTotal > 0) {
              var submitterBU = orgCodeToBU[submitterOrgCode] || 'Unknown';
              if (!stats.spendByBU[submitterBU]) stats.spendByBU[submitterBU] = { total: 0, count: 0 };
              stats.spendByBU[submitterBU].total += sharedTotal;
              buTouchedByThisRequest[submitterBU] = true;
              // Shared costs are submitter-level, so they always count as overhead.
              stats.fundingTypeSpend.overhead.total += sharedTotal;
              requestHasOverhead = true;
            }

            // Request-level count: +1 per BU that this request touched (via any traveler or shared cost)
            for (var touchedBU in buTouchedByThisRequest) {
              stats.spendByBU[touchedBU].count++;
            }
            if (requestHasClientPaid) stats.fundingTypeSpend.clientPaid.count++;
            if (requestHasOverhead) stats.fundingTypeSpend.overhead.count++;
          } else if (status === STATUS_CODES.DENIED) {
            stats.totals.denied++;
          } else if (status === STATUS_CODES.CANCELLED) {
            stats.totals.cancelled++;
          }

          if (!stats.travelTypes[locationType]) stats.travelTypes[locationType] = 0;
          stats.travelTypes[locationType]++;

          if (submittedAt && eventStartDate) {
            var leadDays = (new Date(eventStartDate) - new Date(submittedAt)) / TIME_CONSTANTS.MS_PER_DAY;
            if (leadDays > 0) leadTimes.push(leadDays);
          }
        }
      }
    }

    console.timeEnd('getAdminDashboard.requestsLoop');

    // ── Finalize action center ──
    console.time('getAdminDashboard.actionCenterFinalize');
    yourReviews.sort(function(a, b) {
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
      return b.daysAtStage - a.daysAtStage;
    });
    stalledCandidates.sort(function(a, b) { return b.daysAtStage - a.daysAtStage; });

    var actionCenter = {
      yourReviews: yourReviews,
      stalledRequests: stalledCandidates.slice(0, 10),
      deniedCancelledCounts: { denied: deniedCount, cancelled: cancelledCount },
      pipelineCounts: pipelineCounts
    };
    console.timeEnd('getAdminDashboard.actionCenterFinalize');

    // ── Finalize stats (only if computed fresh) ──
    if (needsStats) {
      console.time('getAdminDashboard.statsFinalize');
      var avg = function(arr) { return arr.length > 0 ? arr.reduce(function(a, b) { return a + b; }, 0) / arr.length : 0; };

      var decidedCount = stats.totals.approved + stats.totals.denied;
      stats.approvalRate = decidedCount > 0 ? Math.round((stats.totals.approved / decidedCount) * 100) : 0;
      stats.avgLeadTime = Math.round(avg(leadTimes) * 10) / 10;

      // Approval log analysis (reviewer performance + stage times)
      var logData = db.readSheet(SHEET_NAMES.APPROVAL_LOG);
      if (logData.rows.length > 0) {
        var logIndex = logData.headerIndex;
        var requestLogs = {};
        for (var li = 0; li < logData.rows.length; li++) {
          var lRow = logData.rows[li];
          var lReqId = lRow[logIndex['Request_ID']];
          if (!requestLogs[lReqId]) requestLogs[lReqId] = [];
          requestLogs[lReqId].push({
            action: lRow[logIndex['Action']], timestamp: lRow[logIndex['Timestamp']],
            prevStatus: lRow[logIndex['Previous_Status']], newStatus: lRow[logIndex['New_Status']],
            actorName: lRow[logIndex['Action_By_Name']], actorEmail: lRow[logIndex['Action_By_Email']],
            comments: lRow[logIndex['Comments']],
            snapshotData: lRow[logIndex['Snapshot_Data']]
          });
        }

        var sectorTimes = [], buTimes = [], osoTimes = [], fasTimes = [];
        var totalApprovalTimes = [];
        var reviewerMap = {};

        // Email -> scope label maps so the dashboard can show the actual
        // BU name / sector code on each row instead of the generic role
        // bucket. Built here from the same sheet reads we'd do anyway.
        var emailToBUName = {};
        var emailToSectorCode = {};
        // For SDs only: HC staffing is the source of truth for both their
        // sector code AND their display name. emailToSDName uses the same
        // last,first format the Requests table stores in Current_Reviewer_Name
        // (e.g., "Burns,Spencer S"), so click-to-drill name search matches.
        var emailToSDName = {};

        // Walk HC staffing once to find every SD position (Sector Director,
        // Grade 15, supervisoryStatus 2). For each filled seat, capture
        // email -> sector code + email -> staffing name.
        try {
          var hcBundle = HC.hcGetBundle();
          if (hcBundle && hcBundle.success && hcBundle.data) {
            var positions = hcBundle.data;
            for (var pi = 0; pi < positions.length; pi++) {
              var p = positions[pi];
              if (!p || !p.officeTitle || !p.emailAddress || !p.orgCode) continue;
              if (p.officeTitle.toLowerCase().indexOf('sector director') === -1) continue;
              if (String(p.grade) !== '15') continue;
              if (String(p.supervisoryStatus) !== '2') continue;
              var sdEmail = String(p.emailAddress).toLowerCase();
              var sdSector = String(p.orgCode).toUpperCase().substring(0, 4);
              if (!emailToSectorCode[sdEmail]) emailToSectorCode[sdEmail] = sdSector;
              if (p.employeeName && !emailToSDName[sdEmail]) {
                emailToSDName[sdEmail] = p.employeeName;
              }
            }
          }
        } catch (e) { console.warn('reviewerPerformance: HC SD walk failed: ' + e.message); }

        // Seed BU/AAS-FO/Sector-override reviewers from Travel_User_Roles.
        _seedReviewerMapFromUnifiedRoles(reviewerMap, emailToBUName, emailToSectorCode, sectorToBU);

        // Seed HC-derived SDs (those not in sector_override roles) so
        // every active SD appears, not only those who happened to act in
        // the period. Uses the HC walk above for both name and sector.
        Object.keys(emailToSDName).forEach(function(hcEmail) {
          if (reviewerMap[hcEmail]) return;
          var hcSector = emailToSectorCode[hcEmail] || '';
          var hcBU = hcSector ? sectorToBU[hcSector] : '';
          var hcScope = hcBU ? (hcBU + ' · ' + hcSector) : hcSector;
          reviewerMap[hcEmail] = {
            name: emailToSDName[hcEmail],
            email: hcEmail,
            role: 'Sector',
            scope: hcScope,
            totalDays: 0,
            reviewedCount: 0,
            pendingCount: 0
          };
        });

        // Process approval logs
        var reqIds = Object.keys(requestLogs);
        for (var ri = 0; ri < reqIds.length; ri++) {
          var logs = requestLogs[reqIds[ri]];
          logs.sort(function(a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

          var firstSubmitTime = null, finalApprovalTime = null;

          for (var j = 0; j < logs.length; j++) {
            var entry = logs[j];
            var entryTime = new Date(entry.timestamp);

            if (entry.action === ACTION_TYPES.SUBMITTED && !firstSubmitTime) firstSubmitTime = entryTime;
            if (entry.newStatus === STATUS_CODES.APPROVED_GOGOV || entry.newStatus === STATUS_CODES.COMPLETED) finalApprovalTime = entryTime;

            // Per-stage times — business days only (skip Sat/Sun) so a
            // request entering on Friday afternoon doesn't penalize the
            // reviewer for weekend hours.
            if (j < logs.length - 1) {
              var next = logs[j + 1];
              var nextTime = new Date(next.timestamp);
              var days = businessDaysBetween(entryTime, nextTime);
              var reviewCompleted = nextTime >= periodStart && nextTime <= periodEnd;

              if (days > 0 && days < 90 && reviewCompleted) {
                if (entry.newStatus === STATUS_CODES.PENDING_SECTOR && next.prevStatus === STATUS_CODES.PENDING_SECTOR) sectorTimes.push(days);
                if (entry.newStatus === STATUS_CODES.PENDING_BU && next.prevStatus === STATUS_CODES.PENDING_BU) buTimes.push(days);
                if (entry.newStatus === STATUS_CODES.PENDING_OSO && next.prevStatus === STATUS_CODES.PENDING_OSO) osoTimes.push(days);
                if (entry.newStatus === STATUS_CODES.PENDING_FAS && next.prevStatus === STATUS_CODES.PENDING_FAS) fasTimes.push(days);
              }
            }

            // Reviewer performance — all-time, NOT period-filtered. The
            // perf section answers "how do these reviewers compare?" not
            // "what happened in the last 30 days?" Departed/temp-promo
            // SDs keep their historical contributions; the period
            // toggle still drives the charts above and the KPI strip.
            {
              var approvalActions = [ACTION_TYPES.SECTOR_APPROVED, ACTION_TYPES.BU_APPROVED, ACTION_TYPES.OSO_APPROVED, ACTION_TYPES.SECTOR_NEEDS_INFO, ACTION_TYPES.BU_NEEDS_INFO, ACTION_TYPES.OSO_NEEDS_INFO, ACTION_TYPES.DENIED];
              if (approvalActions.indexOf(entry.action) !== -1 && entry.actorEmail) {
                var emailKey = entry.actorEmail.toLowerCase();
                if (!reviewerMap[emailKey]) {
                  reviewerMap[emailKey] = { name: entry.actorName || '', email: entry.actorEmail, role: '', scope: '', totalDays: 0, reviewedCount: 0, pendingCount: 0 };
                }
                // Derive role + scope. Scope only fills if not already
                // seeded so we don't overwrite a known BU name with a
                // sector code if the same person plays both roles.
                if (entry.action.indexOf('Sector_') === 0) {
                  reviewerMap[emailKey].role = 'Sector';
                  if (!reviewerMap[emailKey].scope) {
                    // Compose "BU · Sector" so the row shows context
                    // ("Air Force · AF1") instead of a bare code.
                    var sCodeLookup = emailToSectorCode[emailKey] || '';
                    var sBU = sCodeLookup ? sectorToBU[sCodeLookup] : '';
                    reviewerMap[emailKey].scope = sBU ? (sBU + ' · ' + sCodeLookup) : sCodeLookup;
                  }
                  // For SDs, prefer the HC staffing name over the
                  // formatUserName-derived actorName so the perf row's
                  // name matches Current_Reviewer_Name in the Requests
                  // table — that's what click-to-drill name search needs.
                  if (emailToSDName[emailKey]) {
                    reviewerMap[emailKey].name = emailToSDName[emailKey];
                  }
                } else if (entry.action.indexOf('BU_') === 0) {
                  reviewerMap[emailKey].role = 'BU';
                  if (!reviewerMap[emailKey].scope) {
                    reviewerMap[emailKey].scope = emailToBUName[emailKey] || '';
                  }
                } else if (entry.action.indexOf('OSO_') === 0) {
                  reviewerMap[emailKey].role = 'AAS FO';
                  if (!reviewerMap[emailKey].scope) reviewerMap[emailKey].scope = 'Front Office';
                } else {
                  reviewerMap[emailKey].role = 'Reviewer';
                }
                reviewerMap[emailKey].reviewedCount++;

                var stageMap = {
                  [ACTION_TYPES.SECTOR_APPROVED]: STATUS_CODES.PENDING_SECTOR, [ACTION_TYPES.SECTOR_NEEDS_INFO]: STATUS_CODES.PENDING_SECTOR,
                  [ACTION_TYPES.BU_APPROVED]: STATUS_CODES.PENDING_BU, [ACTION_TYPES.BU_NEEDS_INFO]: STATUS_CODES.PENDING_BU,
                  [ACTION_TYPES.OSO_APPROVED]: STATUS_CODES.PENDING_OSO, [ACTION_TYPES.OSO_NEEDS_INFO]: STATUS_CODES.PENDING_OSO,
                  [ACTION_TYPES.DENIED]: entry.prevStatus
                };
                var targetStatus = stageMap[entry.action];
                // Reassignment-aware start: if admin handed this off mid-stage,
                // the receiving reviewer's clock starts at the reassignment, not
                // the original stage entry. _resolveReviewerStart returns the
                // later of the two timestamps.
                var reviewStart = _resolveReviewerStart(logs, j, targetStatus, emailKey);
                if (reviewStart) {
                  // Business days only — same rationale as per-stage above.
                  var reviewDays = businessDaysBetween(reviewStart, entryTime);
                  if (reviewDays > 0 && reviewDays < 90) reviewerMap[emailKey].totalDays += reviewDays;
                }
              }
            }
          }

          if (firstSubmitTime && finalApprovalTime && finalApprovalTime >= periodStart && finalApprovalTime <= periodEnd) {
            var totalDays = (finalApprovalTime - firstSubmitTime) / TIME_CONSTANTS.MS_PER_DAY;
            if (totalDays > 0 && totalDays < 365) totalApprovalTimes.push(totalDays);
          }
        }

        // Send raw fractional business days. Client adapts the unit so a
        // 46-minute same-day BU review (0.032d) renders as "46m" instead
        // of rounding to 0 and disappearing. Mirrors the reviewer
        // dashboard's Time per Stage fix.
        stats.avgReviewTime.sector = avg(sectorTimes);
        stats.avgReviewTime.bu = avg(buTimes);
        stats.avgReviewTime.oso = avg(osoTimes);
        stats.avgReviewTime.overall = avg(sectorTimes.concat(buTimes, osoTimes, fasTimes));
        stats.avgApprovalTime = avg(totalApprovalTimes);
        stats.approvalTimeByStage.sector = avg(sectorTimes);
        stats.approvalTimeByStage.bu = avg(buTimes);
        stats.approvalTimeByStage.oso = avg(osoTimes);
        stats.approvalTimeByStage.fas = avg(fasTimes);

        // Build payload + sort: Primary (BU + AAS FO) and Sector are
        // separate groups (the client splits them into two columns),
        // but within each group everyone sorts together by avg-review-
        // time DESC — slowest at the top so attention naturally lands
        // on bottlenecks. BU and AAS FO share the same role-bucket
        // priority so they interleave by avg time within the Primary
        // column instead of stacking BU-first-then-AAS-FO.
        stats.reviewerPerformance = Object.keys(reviewerMap).map(function(key) {
          var r = reviewerMap[key];
          return {
            name: r.name,
            email: r.email,
            role: r.role,
            scope: r.scope || '',
            avgDays: r.reviewedCount > 0 ? Math.round((r.totalDays / r.reviewedCount) * 100) / 100 : 0,
            reviewedCount: r.reviewedCount,
            pendingCount: currentReviewerPending[r.email.toLowerCase()] || 0
          };
        }).filter(function(r) {
          // SD list is HC-derived (and HC-seeded), so it includes every
          // active sector seat — including ones who never reviewed
          // anything. Filter those out so the SD column stays focused on
          // people with actual activity. BU/AAS FO are admin-managed in
          // sheets, so we keep their zero rows visible (admin context).
          if (r.role === 'Sector') {
            return (r.reviewedCount || 0) > 0 || (r.pendingCount || 0) > 0;
          }
          return true;
        }).sort(function(a, b) {
          // Primary group (BU + AAS FO) shares priority 1 so they
          // interleave; Sector is priority 2 so it stays in its own
          // column with its own DESC sort.
          var roleOrder = { 'BU': 1, 'AAS FO': 1, 'Sector': 2, 'Reviewer': 3 };
          var ra = roleOrder[a.role] || 9;
          var rb = roleOrder[b.role] || 9;
          if (ra !== rb) return ra - rb;
          // Zero avg sinks to bottom of its group
          var aZero = !a.avgDays || a.avgDays === 0;
          var bZero = !b.avgDays || b.avgDays === 0;
          if (aZero && !bZero) return 1;
          if (!aZero && bZero) return -1;
          // Slowest first within the group
          if ((b.avgDays || 0) !== (a.avgDays || 0)) return (b.avgDays || 0) - (a.avgDays || 0);
          // Tie-break: pending DESC, then name
          if ((b.pendingCount || 0) !== (a.pendingCount || 0)) return (b.pendingCount || 0) - (a.pendingCount || 0);
          return (a.name || '').localeCompare(b.name || '');
        });
      }

      // Cache the inner stats payload (not the envelope) so cache callers can
      // still pluck stats directly. Outer envelope wrapping happens at return.
      var statsJson = JSON.stringify({ stats: stats });
      try { cache.put(statsCacheKey, statsJson, 300); } catch (ce) {}
      console.timeEnd('getAdminDashboard.statsFinalize');
    }

    console.time('getAdminDashboard.payload');
    var data = JSON.parse(JSON.stringify({
      actionCenter: actionCenter,
      stats: cachedStats ? cachedStats.stats : stats,
      requests: allRequests,
      distinctBUCodes: Object.keys(buCodeSet).sort()
    }, function(key, value) {
      if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
      return value;
    }));
    console.timeEnd('getAdminDashboard.payload');
    console.timeEnd('getAdminDashboard');
    return successResponse(data);

  } catch (error) {
    logError('getAdminDashboard', error, { period: period });
    console.timeEnd('getAdminDashboard');
    return errorResponse(error.message || 'Failed to load dashboard');
  }
}

// ============================================================================
// ALL REQUESTS VIEW
// ============================================================================

/**
 * Get all travel requests — returns the full dataset for client-side filtering.
 * Called once on Requests tab load; client handles filter/sort/paginate locally.
 *
 * @returns {Object} successResponse({ requests, distinctBUCodes }) or errorResponse(msg)
 * @client
 */
function getAllTravelRequests() {
  try {
    requireTravelAdmin();

    var db = new TravelDB();
    var sheetData = db.readSheet(SHEET_NAMES.REQUESTS);

    if (sheetData.headers.length === 0) {
      throw new Error('Requests sheet not found');
    }

    var requests = [];
    var buCodeSet = {};
    var headerIndex = sheetData.headerIndex;

    for (var i = 0; i < sheetData.rows.length; i++) {
      var row = sheetData.rows[i];
      var requestId = row[headerIndex['Request_ID']];
      if (!requestId) continue;

      var buCode = row[headerIndex['Submitter_BU']] || '';
      if (buCode) buCodeSet[buCode] = true;

      requests.push({
        requestId: requestId,
        tripName: row[headerIndex['Trip_Name']] || '',
        status: row[headerIndex['Status']] || '',
        buCode: buCode,
        locationType: row[headerIndex['Location_Type']] || 'other',
        grandTotal: parseFloat(row[headerIndex['Grand_Total']]) || 0,
        travelerCount: parseInt(row[headerIndex['Traveler_Count']]) || 0,
        submitterName: row[headerIndex['Submitter_Name']] || '',
        submitterEmail: row[headerIndex['Submitter_Email']] || '',
        currentReviewerName: row[headerIndex['Current_Reviewer_Name']] || '',
        currentReviewerEmail: row[headerIndex['Current_Reviewer_Email']] || '',
        eventStartDate: formatDateValue(row[headerIndex['Event_Start_Date']]),
        eventEndDate: formatDateValue(row[headerIndex['Event_End_Date']]),
        submittedAt: formatDateValue(row[headerIndex['Submitted_At']]),
        updatedAt: formatDateValue(row[headerIndex['Updated_At']]),
        isInternational: row[headerIndex['Is_International']] === true || String(row[headerIndex['Is_International']]).toLowerCase() === 'true'
      });
    }

    return successResponse(JSON.parse(JSON.stringify({
      requests: requests,
      distinctBUCodes: Object.keys(buCodeSet).sort()
    })));

  } catch (error) {
    logError('getAllTravelRequests', error, {});
    return errorResponse(error.message || 'Failed to load requests');
  }
}
// ============================================================================
// REQUEST SUMMARY (Phase 4)
// ============================================================================

/**
 * Get condensed request data + approval log for the slide-in panel.
 * Wraps _buildRequestSummary (which still returns its legacy shape so
 * ReviewerDashboard.js callers stay stable) into the canonical envelope.
 * @param {string} requestId - The request ID
 * @returns {Object} successResponse({ request, approvalLog, allClientPaid }) or errorResponse(msg)
 * @client
 */
function getRequestSummary(requestId) {
  try {
    requireTravelAdmin();
    var inner = _buildRequestSummary(requestId);
    if (!inner || inner.success === false) {
      throw new Error((inner && inner.error) || 'Failed to load request summary');
    }
    // Strip success/error from inner shape; the remaining fields become data
    var data = {};
    Object.keys(inner).forEach(function(k) {
      if (k !== 'success' && k !== 'error') data[k] = inner[k];
    });
    return successResponse(data);
  } catch (error) {
    logError('getRequestSummary', error, { requestId: requestId });
    return errorResponse(error.message || 'Failed to load request summary');
  }
}

/**
 * Internal: build request summary + approval log without auth gate.
 * Callers must enforce their own access control before calling this.
 * Used by:
 *   - getRequestSummary (admin)
 *   - getReviewerRequestSummary (scoped reviewer)
 *
 * Cross-domain dependency: ReviewerDashboard.js depends on the legacy
 * {success, request, approvalLog, ...} shape; do NOT convert to throw or
 * to successResponse until that file is also modernized.
 *
 * @private
 * @server
 */
function _buildRequestSummary(requestId) {
  try {
    if (!requestId) {
      throw new Error('Request ID is required');
    }

    const db = new TravelDB();
    const { rows: requestRows, headerIndex } = db.readSheet(SHEET_NAMES.REQUESTS);

    if (requestRows.length === 0) {
      throw new Error('Requests sheet not found or empty');
    }

    // Find the request row
    let requestRow = null;
    for (let i = 0; i < requestRows.length; i++) {
      if (requestRows[i][headerIndex['Request_ID']] === requestId) {
        requestRow = requestRows[i];
        break;
      }
    }

    if (!requestRow) {
      throw new Error('Request not found: ' + requestId);
    }

    // Determine funding source from travelers' Is_Client_Paid values
    const { rows: travelerRows, headerIndex: tIdx } = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
    const clientPaidCol = tIdx['Is_Client_Paid'];
    let hasClientPaid = false;
    let hasOverhead = false;
    for (let i = 0; i < travelerRows.length; i++) {
      if (travelerRows[i][tIdx['Request_ID']] === requestId) {
        const val = (travelerRows[i][clientPaidCol] || '').toString().toLowerCase();
        if (val === 'client-paid' || val === 'client') {
          hasClientPaid = true;
        } else {
          hasOverhead = true;
        }
      }
    }
    const fundingSource = hasClientPaid && hasOverhead ? 'Mixed' :
                          hasClientPaid ? 'Client Paid' : 'Overhead';

    // Travel dates come from the request's legs (single source of truth in
    // TripDates.js), falling back to the event dates for legacy/legless records.
    const _travelWindow = _getTripTravelWindow(requestId);
    const request = {
      requestId: requestRow[headerIndex['Request_ID']],
      tripName: requestRow[headerIndex['Trip_Name']] || '',
      status: requestRow[headerIndex['Status']] || '',
      submitterName: requestRow[headerIndex['Submitter_Name']] || '',
      submitterEmail: requestRow[headerIndex['Submitter_Email']] || '',
      buCode: requestRow[headerIndex['Submitter_BU']] || '',
      locationType: requestRow[headerIndex['Location_Type']] || '',
      eventStartDate: formatDateValue(requestRow[headerIndex['Event_Start_Date']]),
      eventEndDate: formatDateValue(requestRow[headerIndex['Event_End_Date']]),
      travelStartDate: formatDateValue(_travelWindow.start || requestRow[headerIndex['Event_Start_Date']]),
      travelEndDate: formatDateValue(_travelWindow.end || requestRow[headerIndex['Event_End_Date']]),
      grandTotal: parseFloat(requestRow[headerIndex['Grand_Total']]) || 0,
      travelerCount: parseInt(requestRow[headerIndex['Traveler_Count']]) || 0,
      fundingSource: fundingSource,
      currentReviewerName: requestRow[headerIndex['Current_Reviewer_Name']] || '',
      currentReviewerEmail: requestRow[headerIndex['Current_Reviewer_Email']] || '',
      updatedAt: formatDateValue(requestRow[headerIndex['Updated_At']])
    };

    // Load approval log entries for this request
    const approvalLog = [];
    const { rows: logRows, headerIndex: logIndex } = db.readSheet(SHEET_NAMES.APPROVAL_LOG);

    for (let i = 0; i < logRows.length; i++) {
      if (logRows[i][logIndex['Request_ID']] === requestId) {
        approvalLog.push({
          action: logRows[i][logIndex['Action']] || '',
          actorName: logRows[i][logIndex['Action_By_Name']] || '',
          actorEmail: logRows[i][logIndex['Action_By_Email']] || '',
          timestamp: formatDateValue(logRows[i][logIndex['Timestamp']]),
          previousStatus: logRows[i][logIndex['Previous_Status']] || '',
          newStatus: logRows[i][logIndex['New_Status']] || '',
          notes: logRows[i][logIndex['Comments']] || ''
        });
      }
    }

    // Sort chronologically
    approvalLog.sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return aTime - bTime;
    });

    // Check if all travelers are client-paid (to determine if FAS stage should be shown)
    let allClientPaid = false;
    try {
      const { rows: travelerRows, headerIndex: tIdx } = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
      const isClientPaidCol = tIdx['Is_Client_Paid'];
      const travReqIdCol = tIdx['Request_ID'];
      if (isClientPaidCol !== undefined && travReqIdCol !== undefined) {
        const requestTravelers = travelerRows.filter(row => row[travReqIdCol] === requestId);
        if (requestTravelers.length > 0) {
          allClientPaid = requestTravelers.every(row => {
            const val = String(row[isClientPaidCol] || '').toLowerCase().trim();
            return val.includes('client');
          });
        }
      }
    } catch (e) {
      console.log('Could not determine client-paid status for timeline: ' + e.message);
    }

    const response = {
      success: true,
      request: request,
      approvalLog: approvalLog,
      allClientPaid: allClientPaid
    };

    return JSON.parse(JSON.stringify(response));

  } catch (error) {
    console.error('Error in getRequestSummary:', error);
    logError('getRequestSummary', error, { requestId: requestId });
    return {
      success: false,
      error: error.message || 'Failed to load request summary'
    };
  }
}
