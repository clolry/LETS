/**
 * TravelReportService.js
 * Server-side functions for Travel Admin Reports
 *
 * Provides:
 * - Full Data Export (Requests + Travelers + Legs)
 * - Reviewer Performance
 * - Monthly Summary
 * - Denied & Cancelled Log
 * - Stage Timing Analysis
 *
 * All functions use TravelDB class for spreadsheet access.
 * All entry points call requireTravelAdmin() for access control.
 * All responses sanitized with JSON.parse(JSON.stringify()) for Date serialization.
 */

// ============================================================================
// ENTRY POINTS (global functions for google.script.run)
// ============================================================================

/**
 * Get filter options for report UI (BU list, status list)
 * @returns {Object} successResponse({ buList, statusList }) or errorResponse(msg)
 * @client
 */
function reportGetFilterOptions() {
  try {
    requireTravelAdmin();

    const db = new TravelDB();
    const { rows, headerIndex } = db.readSheet(SHEET_NAMES.REQUESTS);

    const buSet = {};
    const statusSet = {};

    for (var i = 0; i < rows.length; i++) {
      var bu = rows[i][headerIndex['Submitter_BU']];
      var status = rows[i][headerIndex['Status']];
      if (bu) buSet[bu] = true;
      if (status) statusSet[status] = true;
    }

    return successResponse({
      buList: Object.keys(buSet).sort(),
      statusList: Object.keys(statusSet).sort(),
      catalog: _reportBuilderClientCatalog()
    });

  } catch (error) {
    return errorResponse(error.message);
  }
}

/**
 * Generate report data for preview or processing. Internal helper called by
 * reportExportToSheets and reportExportToCSV. Throws on error (no envelope) —
 * callers either wrap the result in their own envelope or let the exception
 * propagate to their try/catch.
 *
 * @param {Object} config - { type, filters: { dateFrom, dateTo, status, bu, period } }
 * @returns {{ headers, rows, meta }} Raw report data (no envelope wrapper)
 * @throws on missing/unknown type or admin-gate failure
 * @private
 * @server
 */
function reportGenerateData(config) {
  console.time('reportGenerateData');
  try {
    requireTravelAdmin();

    if (!config || !config.type) {
      throw new Error('Report type is required');
    }

    var db = new TravelDB();
    var result;

    switch (config.type) {
      case 'full_export':
        result = _reportFullExport(db, config);
        break;
      case 'reviewer_performance':
        result = _reportReviewerPerformance(db, config);
        break;
      case 'monthly_summary':
        result = _reportMonthlySummary(db, config);
        break;
      case 'denied_cancelled':
        result = _reportDeniedCancelled(db, config);
        break;
      case 'stage_timing':
        result = _reportStageTiming(db, config);
        break;
      default:
        throw new Error('Unknown report type: ' + config.type);
    }

    console.timeEnd('reportGenerateData');
    return {
      headers: result.headers,
      rows: result.rows,
      meta: result.meta || { totalRows: result.rows.length, generatedAt: new Date().toISOString() }
    };

  } catch (error) {
    console.timeEnd('reportGenerateData');
    throw error;
  }
}

/**
 * Export report data to a new Google Sheets spreadsheet
 * @param {Object} config - Report configuration
 * @returns {Object} successResponse({ spreadsheetUrl, spreadsheetId }) or errorResponse(msg)
 * @client
 */
function reportExportToSheets(config) {
  console.time('reportExportToSheets');
  try {
    requireTravelAdmin();

    // reportGenerateData now throws on failure (post-Chunk 10.C); let it
    // propagate to the catch below.
    var data = reportGenerateData(config);

    var titleMap = {
      'full_export': 'Full Data Export',
      'reviewer_performance': 'Reviewer Performance',
      'monthly_summary': 'Monthly Summary',
      'denied_cancelled': 'Denied & Cancelled Log',
      'stage_timing': 'Stage Timing Analysis'
    };
    var title = (titleMap[config.type] || 'Report') + ' - ' + formatDateForStorage(new Date());

    var result = _reportBuildSheetsExport(data.headers, data.rows, title, data.meta);

    console.timeEnd('reportExportToSheets');
    return successResponse(JSON.parse(JSON.stringify(result)));

  } catch (error) {
    console.timeEnd('reportExportToSheets');
    return errorResponse(error.message);
  }
}

/**
 * Generate CSV string for client-side download
 * @param {Object} config - Report configuration
 * @returns {Object} successResponse({ csvData, filename }) or errorResponse(msg)
 * @client
 */
function reportExportToCSV(config) {
  console.time('reportExportToCSV');
  try {
    requireTravelAdmin();

    // reportGenerateData throws on failure post-Chunk 10.C
    var data = reportGenerateData(config);

    var csvLines = [];

    // Header row
    csvLines.push(data.headers.map(function(h) {
      return '"' + String(h).replace(/"/g, '""') + '"';
    }).join(','));

    // Data rows
    for (var i = 0; i < data.rows.length; i++) {
      csvLines.push(data.rows[i].map(function(cell) {
        var val = cell === null || cell === undefined ? '' : String(cell);
        return '"' + val.replace(/"/g, '""') + '"';
      }).join(','));
    }

    var filenameMap = {
      'full_export': 'full-data-export',
      'reviewer_performance': 'reviewer-performance',
      'monthly_summary': 'monthly-summary',
      'denied_cancelled': 'denied-cancelled-log',
      'stage_timing': 'stage-timing'
    };
    var filename = (filenameMap[config.type] || 'report') + '-' + formatDateForStorage(new Date()) + '.csv';

    console.timeEnd('reportExportToCSV');
    return successResponse({ csvData: csvLines.join('\n'), filename: filename });

  } catch (error) {
    console.timeEnd('reportExportToCSV');
    return errorResponse(error.message);
  }
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Calculate date range from period shortcut
 * @param {string} period - '30d', 'quarter', or 'fy'
 * @returns {{ start: Date, end: Date }}
 * @private
 * @server
 */
function _reportPeriodRange(period) {
  var now = new Date();
  var start, end;
  end = now;

  if (period === 'quarter') {
    var month = now.getMonth();
    var qStartMonth;
    if (month >= 9) qStartMonth = 9;
    else if (month >= 6) qStartMonth = 6;
    else if (month >= 3) qStartMonth = 3;
    else qStartMonth = 0;
    start = new Date(now.getFullYear(), qStartMonth, 1);
  } else if (period === 'fy') {
    if (now.getMonth() >= 9) {
      start = new Date(now.getFullYear(), 9, 1);
    } else {
      start = new Date(now.getFullYear() - 1, 9, 1);
    }
  } else {
    // Default: last 30 days
    start = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  }
  start.setHours(0, 0, 0, 0);

  return { start: start, end: end };
}

/**
 * Parse filter dates from config, falling back to period
 * @param {Object} config - Report config with filters
 * @returns {{ start: Date, end: Date }}
 * @private
 * @server
 */
function _reportGetDateRange(config) {
  var filters = config.filters || {};

  if (filters.dateFrom || filters.dateTo) {
    var start = filters.dateFrom ? new Date(filters.dateFrom) : new Date(2020, 0, 1);
    var end = filters.dateTo ? new Date(filters.dateTo) : new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start: start, end: end };
  }

  return _reportPeriodRange(filters.period || '30d');
}

// _reportFormatDate moved to formatDateForStorage in 10_lib/DateTime.js (Chunk 9).

/**
 * Build a Google Sheets export from headers + rows. Creates a new spreadsheet
 * (separate from TRAVEL_DB) — the setValue calls inside are deliberate, not
 * TravelDB candidates.
 * @private
 * @server
 */
function _reportBuildSheetsExport(headers, rows, title, meta) {
  var ss = SpreadsheetApp.create(title);
  var sheet = ss.getActiveSheet();
  sheet.setName('Report');

  // Write meta info if present
  var dataStartRow = 1;
  if (meta && meta.summary) {
    var summaryKeys = Object.keys(meta.summary);
    for (var m = 0; m < summaryKeys.length; m++) {
      sheet.getRange(m + 1, 1).setValue(summaryKeys[m]);
      sheet.getRange(m + 1, 2).setValue(meta.summary[summaryKeys[m]]);
      sheet.getRange(m + 1, 1).setFontWeight('bold');
    }
    dataStartRow = summaryKeys.length + 2;
  }

  // Write headers
  if (headers.length > 0) {
    sheet.getRange(dataStartRow, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(dataStartRow, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#f1f5f9');
    sheet.setFrozenRows(dataStartRow);
  }

  // Write data
  if (rows.length > 0) {
    sheet.getRange(dataStartRow + 1, 1, rows.length, headers.length).setValues(rows);
  }

  // Auto-resize columns (up to 20 to avoid timeout)
  var colsToResize = Math.min(headers.length, 20);
  for (var c = 1; c <= colsToResize; c++) {
    sheet.autoResizeColumn(c);
  }

  // Apply currency formatting to columns containing 'Total', 'Cost', 'Amount', 'Spend'
  for (var h = 0; h < headers.length; h++) {
    var headerName = headers[h];
    if (/total|cost|amount|spend/i.test(headerName) && rows.length > 0) {
      sheet.getRange(dataStartRow + 1, h + 1, rows.length, 1).setNumberFormat('$#,##0.00');
    }
    if (/rate|%|percentage/i.test(headerName) && rows.length > 0) {
      sheet.getRange(dataStartRow + 1, h + 1, rows.length, 1).setNumberFormat('0.0%');
    }
  }

  // The web app runs as the deploying owner (USER_DEPLOYING), so this sheet is
  // created in the owner's Drive, owned by the owner. Grant the admin who ran
  // the export edit access so they can actually open/edit it (the client
  // auto-opens spreadsheetUrl). Scales to any number of admins — each export
  // shares with whoever ran it. Best-effort: a sharing hiccup must not fail
  // the export the admin already waited for.
  try {
    var requesterEmail = Session.getActiveUser().getEmail();
    if (requesterEmail) {
      DriveApp.getFileById(ss.getId()).addEditor(requesterEmail);
    }
  } catch (shareErr) {
    console.warn('_reportBuildSheetsExport: could not share export with requester: ' + shareErr.message);
  }

  return {
    success: true,
    spreadsheetUrl: ss.getUrl(),
    spreadsheetId: ss.getId()
  };
}

// ============================================================================
// REPORT TYPE: Full Data Export
// ============================================================================

/** @private @server */
function _reportFullExport(db, config) {
  var dateRange = _reportGetDateRange(config);
  var filters = config.filters || {};

  var { rows: requestRows, headerIndex: rIdx } = db.readSheet(SHEET_NAMES.REQUESTS);
  var { rows: travelerRows, headerIndex: tIdx } = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
  var { rows: legRows, headerIndex: lIdx } = db.readSheet(SHEET_NAMES.REQUEST_LEGS);

  // Build traveler lookup: requestId -> comma-separated names
  var travelersByRequest = {};
  for (var t = 0; t < travelerRows.length; t++) {
    var rid = travelerRows[t][tIdx['Request_ID']];
    var name = travelerRows[t][tIdx['Employee_Name']] || '';
    if (!rid) continue;
    if (!travelersByRequest[rid]) travelersByRequest[rid] = [];
    travelersByRequest[rid].push(name);
  }

  // Build legs lookup: requestId -> comma-separated destinations
  var legsByRequest = {};
  for (var l = 0; l < legRows.length; l++) {
    var legRid = legRows[l][lIdx['Request_ID']];
    var dest = legRows[l][lIdx['Location_Display']] || legRows[l][lIdx['City']] || '';
    if (!legRid) continue;
    if (!legsByRequest[legRid]) legsByRequest[legRid] = [];
    legsByRequest[legRid].push(dest);
  }

  var headers = [
    'Request_ID', 'Trip_Name', 'Status', 'Location_Type',
    'Submitter_Name', 'Submitter_Email', 'Submitter_BU', 'Submitter_Org_Code',
    'Event_Start_Date', 'Event_End_Date', 'Is_International',
    'Traveler_Count', 'Leg_Count',
    'Traveler_Total', 'Shared_Total', 'Grand_Total',
    'Current_Reviewer_Name', 'Current_Reviewer_Email',
    'Submitted_At', 'Updated_At',
    'Destinations', 'Traveler_Names'
  ];

  var rows = [];
  for (var i = 0; i < requestRows.length; i++) {
    var row = requestRows[i];
    var requestId = row[rIdx['Request_ID']];
    if (!requestId) continue;

    var status = row[rIdx['Status']] || '';
    var bu = row[rIdx['Submitter_BU']] || '';
    var submittedAt = row[rIdx['Submitted_At']];

    // Date filter (by Submitted_At)
    if (submittedAt) {
      var submitDate = new Date(submittedAt);
      if (submitDate < dateRange.start || submitDate > dateRange.end) continue;
    } else {
      continue; // Skip requests without submitted date
    }

    // Status filter
    if (filters.status && filters.status !== '' && status !== filters.status) continue;

    // BU filter
    if (filters.bu && filters.bu !== '' && bu !== filters.bu) continue;

    rows.push([
      requestId,
      row[rIdx['Trip_Name']] || '',
      status,
      row[rIdx['Location_Type']] || '',
      row[rIdx['Submitter_Name']] || '',
      row[rIdx['Submitter_Email']] || '',
      bu,
      row[rIdx['Submitter_Org_Code']] || '',
      formatDateForStorage(row[rIdx['Event_Start_Date']]),
      formatDateForStorage(row[rIdx['Event_End_Date']]),
      row[rIdx['Is_International']] ? 'Yes' : 'No',
      parseInt(row[rIdx['Traveler_Count']]) || 0,
      (legsByRequest[requestId] || []).length,
      parseFloat(row[rIdx['Traveler_Total']]) || 0,
      parseFloat(row[rIdx['Shared_Total']]) || 0,
      parseFloat(row[rIdx['Grand_Total']]) || 0,
      row[rIdx['Current_Reviewer_Name']] || '',
      row[rIdx['Current_Reviewer_Email']] || '',
      formatDateForStorage(submittedAt),
      formatDateForStorage(row[rIdx['Updated_At']]),
      (legsByRequest[requestId] || []).join('; '),
      (travelersByRequest[requestId] || []).join('; ')
    ]);
  }

  return { headers: headers, rows: rows };
}

// ============================================================================
// REPORT TYPE: Reviewer Performance
// ============================================================================

/** @private @server */
function _reportReviewerPerformance(db, config) {
  var dateRange = _reportGetDateRange(config);

  var { rows: logRows, headerIndex: logIdx } = db.readSheet(SHEET_NAMES.APPROVAL_LOG);
  var { rows: requestRows, headerIndex: rIdx } = db.readSheet(SHEET_NAMES.REQUESTS);

  // Build current pending counts per reviewer
  var pendingByReviewer = {};
  for (var r = 0; r < requestRows.length; r++) {
    var status = requestRows[r][rIdx['Status']] || '';
    var reviewerEmail = (requestRows[r][rIdx['Current_Reviewer_Email']] || '').toLowerCase();
    if (status.startsWith('PENDING_') && reviewerEmail) {
      if (!pendingByReviewer[reviewerEmail]) pendingByReviewer[reviewerEmail] = 0;
      pendingByReviewer[reviewerEmail]++;
    }
  }

  // Group log entries by request
  var requestLogs = {};
  for (var i = 0; i < logRows.length; i++) {
    var requestId = logRows[i][logIdx['Request_ID']];
    if (!requestId) continue;
    if (!requestLogs[requestId]) requestLogs[requestId] = [];
    requestLogs[requestId].push({
      action: logRows[i][logIdx['Action']] || '',
      timestamp: logRows[i][logIdx['Timestamp']],
      prevStatus: logRows[i][logIdx['Previous_Status']] || '',
      newStatus: logRows[i][logIdx['New_Status']] || '',
      actorName: logRows[i][logIdx['Action_By_Name']] || '',
      actorEmail: (logRows[i][logIdx['Action_By_Email']] || '').toLowerCase()
    });
  }

  // Track reviewer metrics
  var reviewerMap = {};
  var approvalActions = [
    ACTION_TYPES.SECTOR_APPROVED, ACTION_TYPES.BU_APPROVED, ACTION_TYPES.OSO_APPROVED,
    ACTION_TYPES.SECTOR_NEEDS_INFO, ACTION_TYPES.BU_NEEDS_INFO, ACTION_TYPES.OSO_NEEDS_INFO,
    ACTION_TYPES.DENIED
  ];
  var needsInfoActions = [ACTION_TYPES.SECTOR_NEEDS_INFO, ACTION_TYPES.BU_NEEDS_INFO, ACTION_TYPES.OSO_NEEDS_INFO];

  var stageMap = {
    [ACTION_TYPES.SECTOR_APPROVED]: STATUS_CODES.PENDING_SECTOR, [ACTION_TYPES.SECTOR_NEEDS_INFO]: STATUS_CODES.PENDING_SECTOR,
    [ACTION_TYPES.BU_APPROVED]: STATUS_CODES.PENDING_BU, [ACTION_TYPES.BU_NEEDS_INFO]: STATUS_CODES.PENDING_BU,
    [ACTION_TYPES.OSO_APPROVED]: STATUS_CODES.PENDING_OSO, [ACTION_TYPES.OSO_NEEDS_INFO]: STATUS_CODES.PENDING_OSO
  };

  Object.keys(requestLogs).forEach(function(reqId) {
    var logs = requestLogs[reqId];
    logs.sort(function(a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

    for (var j = 0; j < logs.length; j++) {
      var entry = logs[j];
      var entryTime = new Date(entry.timestamp);
      if (isNaN(entryTime.getTime())) continue;

      if (entryTime < dateRange.start || entryTime > dateRange.end) continue;
      if (!approvalActions.includes(entry.action) || !entry.actorEmail) continue;

      var emailKey = entry.actorEmail;
      if (!reviewerMap[emailKey]) {
        reviewerMap[emailKey] = {
          name: entry.actorName,
          email: entry.actorEmail,
          role: '',
          totalDays: 0,
          reviewedCount: 0,
          needsInfoCount: 0,
          denialCount: 0,
          longestDays: 0
        };
      }

      var rm = reviewerMap[emailKey];
      rm.reviewedCount++;

      // Derive role
      if (entry.action.startsWith('Sector_')) rm.role = 'Sector';
      else if (entry.action.startsWith('BU_')) rm.role = 'BU';
      else if (entry.action.startsWith('OSO_')) rm.role = 'AAS FO';

      if (needsInfoActions.includes(entry.action)) rm.needsInfoCount++;
      if (entry.action === ACTION_TYPES.DENIED) {
        rm.denialCount++;
        rm.role = rm.role || 'Reviewer';
      }

      // Calculate review duration
      var targetStatus = stageMap[entry.action] || entry.prevStatus;
      if (targetStatus) {
        for (var k = j - 1; k >= 0; k--) {
          if (logs[k].newStatus === targetStatus) {
            var stageEntryTime = new Date(logs[k].timestamp);
            var reviewDays = (entryTime - stageEntryTime) / TIME_CONSTANTS.MS_PER_DAY;
            if (reviewDays > 0 && reviewDays < 90) {
              rm.totalDays += reviewDays;
              if (reviewDays > rm.longestDays) rm.longestDays = reviewDays;
            }
            break;
          }
        }
      }
    }
  });

  var headers = [
    'Reviewer Name', 'Email', 'Role',
    'Reviews Completed', 'Avg Review Days', 'Longest Review Days',
    'Currently Pending', 'Needs-Info Rate %', 'Denial Rate %'
  ];

  var rows = [];
  Object.values(reviewerMap).forEach(function(rm) {
    var avgDays = rm.reviewedCount > 0 ? Math.round((rm.totalDays / rm.reviewedCount) * 10) / 10 : 0;
    var longestDays = Math.round(rm.longestDays * 10) / 10;
    var needsInfoRate = rm.reviewedCount > 0 ? Math.round((rm.needsInfoCount / rm.reviewedCount) * 1000) / 10 : 0;
    var denialRate = rm.reviewedCount > 0 ? Math.round((rm.denialCount / rm.reviewedCount) * 1000) / 10 : 0;

    rows.push([
      rm.name,
      rm.email,
      rm.role || 'Reviewer',
      rm.reviewedCount,
      avgDays,
      longestDays,
      pendingByReviewer[rm.email] || 0,
      needsInfoRate,
      denialRate
    ]);
  });

  // Sort by reviews completed desc
  rows.sort(function(a, b) { return b[3] - a[3]; });

  return { headers: headers, rows: rows };
}

// ============================================================================
// REPORT TYPE: Monthly Summary
// ============================================================================

/** @private @server */
function _reportMonthlySummary(db, config) {
  var dateRange = _reportGetDateRange(config);

  var { rows: requestRows, headerIndex: rIdx } = db.readSheet(SHEET_NAMES.REQUESTS);
  var { rows: logRows, headerIndex: logIdx } = db.readSheet(SHEET_NAMES.APPROVAL_LOG);

  var totalSubmitted = 0;
  var approvedCount = 0;
  var deniedCount = 0;
  var cancelledCount = 0;
  var pendingCount = 0;
  var totalApprovedSpend = 0;
  var leadTimes = [];
  var detailRows = [];

  // Pipeline snapshot (always current)
  var pipeline = { sector: 0, bu: 0, oso: 0, fas: 0 };

  for (var i = 0; i < requestRows.length; i++) {
    var row = requestRows[i];
    var requestId = row[rIdx['Request_ID']];
    if (!requestId) continue;

    var status = row[rIdx['Status']] || '';
    var submittedAt = row[rIdx['Submitted_At']];

    // Pipeline counts (always current)
    if (status === STATUS_CODES.PENDING_SECTOR) pipeline.sector++;
    else if (status === STATUS_CODES.PENDING_BU) pipeline.bu++;
    else if (status === STATUS_CODES.PENDING_OSO) pipeline.oso++;
    else if (status === STATUS_CODES.PENDING_FAS) pipeline.fas++;

    // Period filter by Submitted_At
    if (!submittedAt) continue;
    var submitDate = new Date(submittedAt);
    if (submitDate < dateRange.start || submitDate > dateRange.end) continue;

    totalSubmitted++;

    if (status === STATUS_CODES.APPROVED_GOGOV || status === STATUS_CODES.COMPLETED) {
      approvedCount++;
      totalApprovedSpend += parseFloat(row[rIdx['Grand_Total']]) || 0;
    } else if (status === STATUS_CODES.DENIED) {
      deniedCount++;
    } else if (status === STATUS_CODES.CANCELLED || status === STATUS_CODES.SUBMITTER_CANCELLED) {
      cancelledCount++;
    } else if (status.startsWith('PENDING_') || status.startsWith('NEEDS_INFO_')) {
      pendingCount++;
    }

    // Lead time
    var eventStart = row[rIdx['Event_Start_Date']];
    if (eventStart) {
      var ld = (new Date(eventStart) - submitDate) / TIME_CONSTANTS.MS_PER_DAY;
      if (ld > 0) leadTimes.push(ld);
    }

    detailRows.push([
      requestId,
      row[rIdx['Trip_Name']] || '',
      status,
      row[rIdx['Submitter_BU']] || '',
      parseFloat(row[rIdx['Grand_Total']]) || 0,
      formatDateForStorage(submittedAt),
      formatDateForStorage(eventStart)
    ]);
  }

  // Avg approval time from Approval_Log
  var requestLogs = {};
  for (var j = 0; j < logRows.length; j++) {
    var logReqId = logRows[j][logIdx['Request_ID']];
    if (!logReqId) continue;
    if (!requestLogs[logReqId]) requestLogs[logReqId] = [];
    requestLogs[logReqId].push({
      action: logRows[j][logIdx['Action']] || '',
      timestamp: logRows[j][logIdx['Timestamp']],
      newStatus: logRows[j][logIdx['New_Status']] || ''
    });
  }

  var approvalTimes = [];
  Object.keys(requestLogs).forEach(function(reqId) {
    var logs = requestLogs[reqId];
    logs.sort(function(a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

    var firstSubmit = null;
    var finalApproval = null;
    for (var k = 0; k < logs.length; k++) {
      if (logs[k].action === ACTION_TYPES.SUBMITTED && !firstSubmit) {
        firstSubmit = new Date(logs[k].timestamp);
      }
      if (logs[k].newStatus === STATUS_CODES.APPROVED_GOGOV || logs[k].newStatus === STATUS_CODES.COMPLETED) {
        finalApproval = new Date(logs[k].timestamp);
      }
    }

    if (firstSubmit && finalApproval && finalApproval >= dateRange.start && finalApproval <= dateRange.end) {
      var days = (finalApproval - firstSubmit) / TIME_CONSTANTS.MS_PER_DAY;
      if (days > 0 && days < 365) approvalTimes.push(days);
    }
  });

  var avg = function(arr) { return arr.length > 0 ? arr.reduce(function(a, b) { return a + b; }, 0) / arr.length : 0; };
  var decidedCount = approvedCount + deniedCount;
  var approvalRate = decidedCount > 0 ? Math.round((approvedCount / decidedCount) * 100) : 0;

  var headers = [
    'Request_ID', 'Trip_Name', 'Status', 'BU', 'Grand_Total', 'Submitted_At', 'Event_Start_Date'
  ];

  var meta = {
    totalRows: detailRows.length,
    generatedAt: new Date().toISOString(),
    summary: {
      'Total Submitted': totalSubmitted,
      'Approved': approvedCount,
      'Denied': deniedCount,
      'Cancelled': cancelledCount,
      'Still Pending': pendingCount,
      'Approval Rate': approvalRate + '%',
      'Avg Processing Days': Math.round(avg(approvalTimes) * 10) / 10,
      'Avg Lead Time Days': Math.round(avg(leadTimes) * 10) / 10,
      'Total Approved Spend': '$' + Math.round(totalApprovedSpend).toLocaleString(),
      'Current Pipeline - Sector': pipeline.sector,
      'Current Pipeline - BU': pipeline.bu,
      'Current Pipeline - AAS FO': pipeline.oso,
      'Current Pipeline - FAS': pipeline.fas
    }
  };

  return { headers: headers, rows: detailRows, meta: meta };
}

// ============================================================================
// REPORT TYPE: Denied & Cancelled Log
// ============================================================================

/** @private @server */
function _reportDeniedCancelled(db, config) {
  var dateRange = _reportGetDateRange(config);
  var filters = config.filters || {};

  var { rows: requestRows, headerIndex: rIdx } = db.readSheet(SHEET_NAMES.REQUESTS);
  var { rows: logRows, headerIndex: logIdx } = db.readSheet(SHEET_NAMES.APPROVAL_LOG);

  // Build denial/cancellation info from Approval_Log
  var denialInfo = {};
  for (var j = 0; j < logRows.length; j++) {
    var action = logRows[j][logIdx['Action']] || '';
    var newStatus = logRows[j][logIdx['New_Status']] || '';

    if (newStatus === STATUS_CODES.DENIED || newStatus === STATUS_CODES.CANCELLED || newStatus === STATUS_CODES.SUBMITTER_CANCELLED) {
      var reqId = logRows[j][logIdx['Request_ID']];
      denialInfo[reqId] = {
        actionBy: logRows[j][logIdx['Action_By_Name']] || '',
        stage: logRows[j][logIdx['Previous_Status']] || '',
        comments: logRows[j][logIdx['Comments']] || '',
        timestamp: logRows[j][logIdx['Timestamp']]
      };
    }
  }

  var headers = [
    'Request_ID', 'Trip_Name', 'Submitter_Name', 'Submitter_BU',
    'Grand_Total', 'Final_Status', 'Action_By', 'Stage_When_Actioned',
    'Comments', 'Event_Start_Date', 'Submitted_At', 'Days_In_Pipeline'
  ];

  var rows = [];
  for (var i = 0; i < requestRows.length; i++) {
    var row = requestRows[i];
    var requestId = row[rIdx['Request_ID']];
    if (!requestId) continue;

    var status = row[rIdx['Status']] || '';
    if (status !== STATUS_CODES.DENIED && status !== STATUS_CODES.CANCELLED && status !== STATUS_CODES.SUBMITTER_CANCELLED) continue;

    var submittedAt = row[rIdx['Submitted_At']];
    if (!submittedAt) continue;

    var submitDate = new Date(submittedAt);
    if (submitDate < dateRange.start || submitDate > dateRange.end) continue;

    // BU filter
    var bu = row[rIdx['Submitter_BU']] || '';
    if (filters.bu && filters.bu !== '' && bu !== filters.bu) continue;

    var info = denialInfo[requestId] || {};
    var updatedAt = row[rIdx['Updated_At']];
    var daysInPipeline = 0;
    if (submittedAt && updatedAt) {
      daysInPipeline = Math.round((new Date(updatedAt) - submitDate) / TIME_CONSTANTS.MS_PER_DAY);
    }

    rows.push([
      requestId,
      row[rIdx['Trip_Name']] || '',
      row[rIdx['Submitter_Name']] || '',
      bu,
      parseFloat(row[rIdx['Grand_Total']]) || 0,
      status,
      info.actionBy || '',
      info.stage || '',
      info.comments || '',
      formatDateForStorage(row[rIdx['Event_Start_Date']]),
      formatDateForStorage(submittedAt),
      daysInPipeline
    ]);
  }

  // Sort by submitted date desc
  rows.sort(function(a, b) { return (b[10] || '').localeCompare(a[10] || ''); });

  return { headers: headers, rows: rows };
}

// ============================================================================
// REPORT TYPE: Stage Timing Analysis
// ============================================================================

// ============================================================================
// REPORT BUILDER — Field Catalog
// ============================================================================

/**
 * Maps column keys to their source sheet, column name, label, and category.
 * Child-sheet columns use prefixes: T_ = Travelers, L_ = Legs, A_ = Approval Log
 */
var _RB_FIELD_CATALOG = [
  { category: 'Trip Details', fields: [
    { key: 'Request_ID', sheet: 'Requests', col: 'Request_ID', label: 'Request ID', common: true },
    { key: 'Trip_Name', sheet: 'Requests', col: 'Trip_Name', label: 'Trip Name', common: true },
    { key: 'Status', sheet: 'Requests', col: 'Status', label: 'Status', common: true },
    { key: 'Event_Start_Date', sheet: 'Requests', col: 'Event_Start_Date', label: 'Event Start Date', common: true, isDate: true },
    { key: 'Event_End_Date', sheet: 'Requests', col: 'Event_End_Date', label: 'Event End Date', common: true, isDate: true },
    { key: 'Location_Type', sheet: 'Requests', col: 'Location_Type', label: 'Location Type', common: false },
    { key: 'Is_International', sheet: 'Requests', col: 'Is_International', label: 'International?', common: false }
  ]},
  { category: 'Submitter', fields: [
    { key: 'Submitter_Name', sheet: 'Requests', col: 'Submitter_Name', label: 'Submitter Name', common: true },
    { key: 'Submitter_Email', sheet: 'Requests', col: 'Submitter_Email', label: 'Submitter Email', common: true },
    { key: 'Submitter_BU', sheet: 'Requests', col: 'Submitter_BU', label: 'Submitter BU', common: true },
    { key: 'Submitter_Org_Code', sheet: 'Requests', col: 'Submitter_Org_Code', label: 'Org Code', common: false },
    { key: 'Sector_Director_Name', sheet: 'Requests', col: 'Sector_Director_Name', label: 'Sector Director', common: false },
    { key: 'BU_Reviewer_Name', sheet: 'Requests', col: 'BU_Reviewer_Name', label: 'BU Reviewer', common: false }
  ]},
  { category: 'Costs', fields: [
    { key: 'Grand_Total', sheet: 'Requests', col: 'Grand_Total', label: 'Grand Total', common: true, isCurrency: true },
    { key: 'Traveler_Total', sheet: 'Requests', col: 'Traveler_Total', label: 'Traveler Total', common: true, isCurrency: true },
    { key: 'Shared_Total', sheet: 'Requests', col: 'Shared_Total', label: 'Shared Total', common: true, isCurrency: true },
    { key: 'Shared_Facilities', sheet: 'Requests', col: 'Shared_Facilities', label: 'Shared Facilities', common: false, isCurrency: true },
    { key: 'Shared_AV', sheet: 'Requests', col: 'Shared_AV', label: 'Shared AV', common: false, isCurrency: true },
    { key: 'Shared_Logistics', sheet: 'Requests', col: 'Shared_Logistics', label: 'Shared Logistics', common: false, isCurrency: true },
    { key: 'Shared_Other', sheet: 'Requests', col: 'Shared_Other', label: 'Shared Other Costs', common: false, isCurrency: true }
  ]},
  { category: 'Pipeline', fields: [
    { key: 'Current_Reviewer_Name', sheet: 'Requests', col: 'Current_Reviewer_Name', label: 'Current Reviewer', common: true },
    { key: 'Submitted_At', sheet: 'Requests', col: 'Submitted_At', label: 'Submitted At', common: true, isDate: true },
    { key: 'Current_Reviewer_Email', sheet: 'Requests', col: 'Current_Reviewer_Email', label: 'Reviewer Email', common: false },
    { key: 'Initial_Review_Level', sheet: 'Requests', col: 'Initial_Review_Level', label: 'Initial Review Level', common: false },
    { key: 'Updated_At', sheet: 'Requests', col: 'Updated_At', label: 'Updated At', common: false, isDate: true }
  ]},
  { category: 'Travelers', fields: [
    { key: 'T_Employee_Name', sheet: 'Request_Travelers', col: 'Employee_Name', label: 'Traveler Name', common: true },
    { key: 'T_Subtotal', sheet: 'Request_Travelers', col: 'Subtotal', label: 'Traveler Subtotal', common: true, isCurrency: true },
    { key: 'T_Is_Client_Paid', sheet: 'Request_Travelers', col: 'Is_Client_Paid', label: 'Client-Paid?', common: true },
    { key: 'T_Transportation_Total', sheet: 'Request_Travelers', col: 'Transportation_Total', label: 'Transportation Total', common: true, isCurrency: true },
    { key: 'T_Lodging_Total', sheet: 'Request_Travelers', col: 'Lodging_Total', label: 'Lodging Total', common: true, isCurrency: true },
    { key: 'T_MIE_Total', sheet: 'Request_Travelers', col: 'MIE_Total', label: 'MIE Total', common: true, isCurrency: true },
    { key: 'T_Email', sheet: 'Request_Travelers', col: 'Email', label: 'Traveler Email', common: false },
    { key: 'T_Business_Unit', sheet: 'Request_Travelers', col: 'Business_Unit', label: 'Traveler BU', common: false },
    { key: 'T_Transport_Mode', sheet: 'Request_Travelers', col: 'Transport_Mode', label: 'Transport Mode', common: false },
    { key: 'T_Ticket_Cost', sheet: 'Request_Travelers', col: 'Ticket_Cost', label: 'Ticket Cost', common: false, isCurrency: true },
    { key: 'T_Total_Miles', sheet: 'Request_Travelers', col: 'Total_Miles', label: 'Total Miles (POV)', common: false },
    { key: 'T_Mileage_Rate', sheet: 'Request_Travelers', col: 'Mileage_Rate', label: 'Mileage Rate (POV)', common: false, isCurrency: true },
    { key: 'T_Other_Total', sheet: 'Request_Travelers', col: 'Other_Total', label: '15% Gross-Up Total', common: false, isCurrency: true }
  ]},
  { category: 'Travel Classification', fields: [
    { key: 'T_LCAT', sheet: 'Request_Travelers', col: 'LCAT', label: 'Traveler Role', common: true },
    { key: 'Travel_Types', sheet: 'Requests', col: 'Travel_Types', label: 'Type of Travel', common: true },
    { key: 'Mission_Critical_Types', sheet: 'Requests', col: 'Mission_Critical_Types', label: 'Mission-Critical', common: false },
    { key: 'T_Role_Justification', sheet: 'Request_Travelers', col: 'Role_Justification', label: 'Role Justification', common: false },
    { key: 'T_Has_Security_Clearance', sheet: 'Request_Travelers', col: 'Has_Security_Clearance', label: 'Security Clearance', common: false },
    { key: 'T_Has_Valid_Passport', sheet: 'Request_Travelers', col: 'Has_Valid_Passport', label: 'Valid Passport', common: false },
    { key: 'T_Is_Speaking', sheet: 'Request_Travelers', col: 'Is_Speaking', label: 'Speaking at Event', common: false },
    { key: 'T_Event_Open_To_Press', sheet: 'Request_Travelers', col: 'Event_Open_To_Press', label: 'Event Open to Press', common: false },
    { key: 'T_Receiving_NFS', sheet: 'Request_Travelers', col: 'Receiving_NFS', label: 'Receiving Non-Federal Source', common: false },
    { key: 'T_Is_Full_Time_Telework', sheet: 'Request_Travelers', col: 'Is_Full_Time_Telework', label: 'Full-Time Telework', common: false },
    { key: 'T_Normal_Commute_Distance', sheet: 'Request_Travelers', col: 'Normal_Commute_Distance', label: 'Normal Commute Distance (mi)', common: false },
    { key: 'T_Normal_Commute_Parking', sheet: 'Request_Travelers', col: 'Normal_Commute_Parking', label: 'Normal Commute Parking', common: false }
  ]},
  { category: 'Destinations', fields: [
    { key: 'L_Location_Display', sheet: 'Request_Legs', col: 'Location_Display', label: 'Location', common: true },
    { key: 'L_Start_Date', sheet: 'Request_Legs', col: 'Start_Date', label: 'Leg Start Date', common: true, isDate: true },
    { key: 'L_End_Date', sheet: 'Request_Legs', col: 'End_Date', label: 'Leg End Date', common: true, isDate: true },
    { key: 'L_City', sheet: 'Request_Legs', col: 'City', label: 'City', common: false },
    { key: 'L_State', sheet: 'Request_Legs', col: 'State', label: 'State', common: false },
    { key: 'L_Country', sheet: 'Request_Legs', col: 'Country', label: 'Country', common: false },
    { key: 'L_Site_Name', sheet: 'Request_Legs', col: 'Site_Name', label: 'Site Name', common: false },
    { key: 'L_Lodging_Rate', sheet: 'Request_Legs', col: 'Lodging_Rate', label: 'Lodging Rate', common: false, isCurrency: true },
    { key: 'L_MIE_Rate', sheet: 'Request_Legs', col: 'MIE_Rate', label: 'MIE Rate', common: false, isCurrency: true }
  ]},
  { category: 'Approval Log', fields: [
    { key: 'A_Action', sheet: 'Approval_Log', col: 'Action', label: 'Action', common: true },
    { key: 'A_Action_By_Name', sheet: 'Approval_Log', col: 'Action_By_Name', label: 'Action By', common: true },
    { key: 'A_Timestamp', sheet: 'Approval_Log', col: 'Timestamp', label: 'Action Timestamp', common: true, isDate: true },
    { key: 'A_Comments', sheet: 'Approval_Log', col: 'Comments', label: 'Comments', common: true },
    { key: 'A_Previous_Status', sheet: 'Approval_Log', col: 'Previous_Status', label: 'Previous Status', common: false },
    { key: 'A_New_Status', sheet: 'Approval_Log', col: 'New_Status', label: 'New Status', common: false }
  ]}
];

/** Build flat lookup: key -> field definition. @private @server */
function _reportBuilderFieldMap() {
  var map = {};
  for (var c = 0; c < _RB_FIELD_CATALOG.length; c++) {
    var fields = _RB_FIELD_CATALOG[c].fields;
    for (var f = 0; f < fields.length; f++) {
      map[fields[f].key] = fields[f];
    }
  }
  return map;
}

/** Ordered list of all column keys. @private @server */
function _reportBuilderAllKeys() {
  var keys = [];
  for (var c = 0; c < _RB_FIELD_CATALOG.length; c++) {
    var fields = _RB_FIELD_CATALOG[c].fields;
    for (var f = 0; f < fields.length; f++) {
      keys.push(fields[f].key);
    }
  }
  return keys;
}

/**
 * Client-safe projection of the field catalog for the report-builder picker —
 * category, key, label, and the 'common' flag only (no sheet/col internals).
 * The client builds its column picker from this instead of keeping its own
 * hardcoded copy, so there is one source of truth and no drift.
 *
 * @returns {Array<{category: string, fields: Array<{key, label, common}>}>}
 * @private @server
 */
function _reportBuilderClientCatalog() {
  return _RB_FIELD_CATALOG.map(function(cat) {
    return {
      category: cat.category,
      fields: cat.fields.map(function(f) {
        return { key: f.key, label: f.label, common: !!f.common };
      })
    };
  });
}

// ============================================================================
// REPORT BUILDER — Query Engine
// ============================================================================

/**
 * Core query engine for report builder.
 * Reads all needed sheets, applies filters, joins child data as semicolons.
 * Returns ALL column values for matching requests (client handles column selection).
 *
 * @param {TravelDB} db - Database handle
 * @param {Object} config - { filters: { dateFrom, dateTo, status, bu } }
 * @param {number} [limit] - Max rows to return (null = all)
 * @returns {{ allColumnKeys: string[], rows: any[][], totalCount: number }}
 * @private
 * @server
 */
function _reportBuilderQuery(db, config, limit) {
  var filters = config.filters || {};
  var fieldMap = _reportBuilderFieldMap();
  var allKeys = _reportBuilderAllKeys();

  // Read all sheets
  var reqData = db.readSheet(SHEET_NAMES.REQUESTS);
  var travData = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
  var legData = db.readSheet(SHEET_NAMES.REQUEST_LEGS);
  var logData = db.readSheet(SHEET_NAMES.APPROVAL_LOG);

  // Build child lookups: requestId -> { colKey: [values...] }
  var childSheets = [
    { data: travData, prefix: 'T_', sheetName: 'Request_Travelers' },
    { data: legData, prefix: 'L_', sheetName: 'Request_Legs' },
    { data: logData, prefix: 'A_', sheetName: 'Approval_Log' }
  ];

  var childLookups = {}; // requestId -> { key: [val, val, ...] }

  for (var s = 0; s < childSheets.length; s++) {
    var cs = childSheets[s];
    var ridIdx = cs.data.headerIndex['Request_ID'];
    if (ridIdx === undefined) continue;

    for (var r = 0; r < cs.data.rows.length; r++) {
      var rid = cs.data.rows[r][ridIdx];
      if (!rid) continue;
      if (!childLookups[rid]) childLookups[rid] = {};

      // For each field with this prefix, extract value
      for (var k = 0; k < allKeys.length; k++) {
        var key = allKeys[k];
        var fld = fieldMap[key];
        if (fld.sheet !== cs.sheetName) continue;

        var colIdx = cs.data.headerIndex[fld.col];
        if (colIdx === undefined) continue;

        var val = cs.data.rows[r][colIdx];
        if (fld.isDate) val = formatDateForStorage(val);
        else if (fld.isCurrency) val = parseFloat(val) || 0;
        else val = (val !== null && val !== undefined) ? String(val) : '';

        if (!childLookups[rid][key]) childLookups[rid][key] = [];
        childLookups[rid][key].push(val);
      }
    }
  }

  // Parse date range from filters
  var dateRange = null;
  if (filters.dateFrom || filters.dateTo) {
    dateRange = {
      start: filters.dateFrom ? new Date(filters.dateFrom) : new Date(2020, 0, 1),
      end: filters.dateTo ? new Date(filters.dateTo) : new Date()
    };
    dateRange.start.setHours(0, 0, 0, 0);
    dateRange.end.setHours(23, 59, 59, 999);
  }

  // Iterate requests, apply filters, build rows
  var rIdx = reqData.headerIndex;
  var rows = [];
  var totalCount = 0;

  for (var i = 0; i < reqData.rows.length; i++) {
    var row = reqData.rows[i];
    var requestId = row[rIdx['Request_ID']];
    if (!requestId) continue;

    var submittedAt = row[rIdx['Submitted_At']];
    if (!submittedAt) continue; // Skip unsubmitted

    // Date filter
    if (dateRange) {
      var submitDate = new Date(submittedAt);
      if (submitDate < dateRange.start || submitDate > dateRange.end) continue;
    }

    // Status filter
    if (filters.status && filters.status !== '') {
      var status = row[rIdx['Status']] || '';
      if (status !== filters.status) continue;
    }

    // BU filter
    if (filters.bu && filters.bu !== '') {
      var bu = row[rIdx['Submitter_BU']] || '';
      if (bu !== filters.bu) continue;
    }

    totalCount++;

    // Skip if past limit (but keep counting for totalCount)
    if (limit && rows.length >= limit) continue;

    // Build row with ALL column values
    var outRow = [];
    var childData = childLookups[requestId] || {};

    for (var j = 0; j < allKeys.length; j++) {
      var colKey = allKeys[j];
      var field = fieldMap[colKey];

      if (field.sheet === 'Requests') {
        // Direct request-level value
        var colIndex = rIdx[field.col];
        var cellVal = (colIndex !== undefined) ? row[colIndex] : '';

        if (field.isDate) {
          outRow.push(formatDateForStorage(cellVal));
        } else if (field.isCurrency) {
          outRow.push(parseFloat(cellVal) || 0);
        } else if (field.col === 'Is_International') {
          outRow.push(cellVal ? 'Yes' : 'No');
        } else {
          outRow.push((cellVal !== null && cellVal !== undefined) ? String(cellVal) : '');
        }
      } else {
        // Child-sheet value: join as semicolons
        var childVals = childData[colKey] || [];
        if (field.isCurrency) {
          outRow.push(childVals.join('; '));
        } else {
          outRow.push(childVals.join('; '));
        }
      }
    }

    rows.push(outRow);
  }

  return {
    allColumnKeys: allKeys,
    rows: rows,
    totalCount: totalCount
  };
}

// ============================================================================
// REPORT BUILDER — Entry Points
// ============================================================================

/**
 * Fetch preview data for report builder (max 5 rows, all columns).
 * @param {Object} config - { filters: { dateFrom, dateTo, status, bu } }
 * @returns {Object} successResponse({ allColumnKeys, rows, totalCount }) or errorResponse(msg)
 * @client
 */
function reportBuilderPreview(config) {
  try {
    requireTravelAdmin();
    var db = new TravelDB();
    var result = _reportBuilderQuery(db, config || {}, 5);

    return successResponse(JSON.parse(JSON.stringify({
      allColumnKeys: result.allColumnKeys,
      rows: result.rows,
      totalCount: result.totalCount
    })));
  } catch (error) {
    logError('reportBuilderPreview', error, {});
    return errorResponse(error.message);
  }
}

/**
 * Full dataset export for report builder.
 * Returns only selected columns for ALL matching rows.
 * @param {Object} config - { columns: string[], filters: { dateFrom, dateTo, status, bu } }
 * @returns {Object} successResponse({ spreadsheetUrl, spreadsheetId }) or errorResponse(msg)
 * @client
 */
function reportBuilderExport(config) {
  console.time('reportBuilderExport');
  try {
    requireTravelAdmin();

    if (!config || !config.columns || config.columns.length === 0) {
      throw new Error('At least one column must be selected');
    }

    var db = new TravelDB();
    var result = _reportBuilderQuery(db, config, null);

    var fieldMap = _reportBuilderFieldMap();
    var allKeys = result.allColumnKeys;

    // Build column index mapping: selected key -> index in allKeys
    var colIndices = [];
    var headers = [];
    for (var c = 0; c < config.columns.length; c++) {
      var key = config.columns[c];
      var idx = allKeys.indexOf(key);
      if (idx >= 0) {
        colIndices.push(idx);
        var fld = fieldMap[key];
        headers.push(fld ? fld.label : key);
      }
    }

    // Project rows to selected columns only
    var projectedRows = [];
    for (var r = 0; r < result.rows.length; r++) {
      var outRow = [];
      for (var ci = 0; ci < colIndices.length; ci++) {
        outRow.push(result.rows[r][colIndices[ci]]);
      }
      projectedRows.push(outRow);
    }

    // Build Sheets export
    var title = 'Data Export - ' + formatDateForStorage(new Date());
    var sheetsResult = _reportBuildSheetsExport(headers, projectedRows, title, {
      totalRows: projectedRows.length,
      generatedAt: new Date().toISOString()
    });

    console.timeEnd('reportBuilderExport');
    return successResponse(JSON.parse(JSON.stringify(sheetsResult)));

  } catch (error) {
    logError('reportBuilderExport', error, {});
    console.timeEnd('reportBuilderExport');
    return errorResponse(error.message);
  }
}

/**
 * Save a report builder preset to ScriptProperties.
 * @param {Object} preset - { name, columns[], filters: {} }
 * @returns {Object} successResponse() or errorResponse(msg)
 * @client
 */
function reportBuilderSavePreset(preset) {
  try {
    requireTravelAdmin();

    if (!preset || !preset.name) {
      throw new Error('Preset name is required');
    }

    var presets = _reportBuilderLoadPresets();

    // Remove existing with same name (overwrite)
    presets = presets.filter(function(p) { return p.name !== preset.name; });

    presets.push({
      name: preset.name,
      columns: preset.columns || [],
      filters: preset.filters || {},
      createdBy: Session.getActiveUser().getEmail(),
      createdAt: formatDateForStorage(new Date())
    });

    _reportBuilderSavePresets(presets);

    return successResponse();
  } catch (error) {
    return errorResponse(error.message);
  }
}

/**
 * Get all saved report builder presets.
 * @returns {Object} successResponse({ presets }) or errorResponse(msg)
 * @client
 */
function reportBuilderGetPresets() {
  try {
    requireTravelAdmin();
    var presets = _reportBuilderLoadPresets();
    return successResponse(JSON.parse(JSON.stringify({ presets: presets })));
  } catch (error) {
    return errorResponse(error.message);
  }
}

/**
 * Delete a report builder preset by name.
 * @param {string} name
 * @returns {Object} successResponse() or errorResponse(msg)
 * @client
 */
function reportBuilderDeletePreset(name) {
  try {
    requireTravelAdmin();

    var presets = _reportBuilderLoadPresets();
    presets = presets.filter(function(p) { return p.name !== name; });
    _reportBuilderSavePresets(presets);

    return successResponse();
  } catch (error) {
    return errorResponse(error.message);
  }
}

// ============================================================================
// REPORT BUILDER — Preset Storage Helpers
// ============================================================================

/** @private @server */
function _reportBuilderLoadPresets() {
  try {
    var raw = getReportBuilderPresets();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Error loading presets:', e);
    return [];
  }
}

/** @private @server */
function _reportBuilderSavePresets(presets) {
  setReportBuilderPresets(JSON.stringify(presets));
}

// ============================================================================
// REPORT TYPE: Stage Timing Analysis
// ============================================================================

/** @private @server */
function _reportStageTiming(db, config) {
  var dateRange = _reportGetDateRange(config);
  var filters = config.filters || {};

  var { rows: requestRows, headerIndex: rIdx } = db.readSheet(SHEET_NAMES.REQUESTS);
  var { rows: logRows, headerIndex: logIdx } = db.readSheet(SHEET_NAMES.APPROVAL_LOG);

  // Build request info lookup
  var requestInfo = {};
  for (var r = 0; r < requestRows.length; r++) {
    var rid = requestRows[r][rIdx['Request_ID']];
    if (!rid) continue;
    requestInfo[rid] = {
      tripName: requestRows[r][rIdx['Trip_Name']] || '',
      bu: requestRows[r][rIdx['Submitter_BU']] || '',
      status: requestRows[r][rIdx['Status']] || ''
    };
  }

  // Group log entries by request
  var requestLogs = {};
  for (var i = 0; i < logRows.length; i++) {
    var requestId = logRows[i][logIdx['Request_ID']];
    if (!requestId) continue;
    if (!requestLogs[requestId]) requestLogs[requestId] = [];
    requestLogs[requestId].push({
      timestamp: logRows[i][logIdx['Timestamp']],
      prevStatus: logRows[i][logIdx['Previous_Status']] || '',
      newStatus: logRows[i][logIdx['New_Status']] || '',
      action: logRows[i][logIdx['Action']] || ''
    });
  }

  var headers = [
    'Request_ID', 'Trip_Name', 'Submitter_BU',
    'Sector_Days', 'BU_Days', 'FO_Days', 'FAS_Days',
    'Needs_Info_Count', 'Total_Days', 'Bottleneck_Stage'
  ];

  var rows = [];
  var sectorTotals = [], buTotals = [], foTotals = [], fasTotals = [], totalTotals = [];
  var needsInfoTotals = [];

  Object.keys(requestLogs).forEach(function(reqId) {
    var info = requestInfo[reqId];
    if (!info) return;

    // BU filter
    if (filters.bu && filters.bu !== '' && info.bu !== filters.bu) return;

    var logs = requestLogs[reqId];
    logs.sort(function(a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

    // Only include completed requests (APPROVED_GOGOV or COMPLETED)
    var completionTime = null;
    var firstSubmitTime = null;
    var needsInfoCount = 0;

    for (var j = 0; j < logs.length; j++) {
      if (logs[j].action === ACTION_TYPES.SUBMITTED && !firstSubmitTime) {
        firstSubmitTime = new Date(logs[j].timestamp);
      }
      if (logs[j].newStatus === STATUS_CODES.APPROVED_GOGOV || logs[j].newStatus === STATUS_CODES.COMPLETED) {
        completionTime = new Date(logs[j].timestamp);
      }
      if (logs[j].action && logs[j].action.includes('Needs_Info')) {
        needsInfoCount++;
      }
    }

    if (!completionTime) return;
    if (completionTime < dateRange.start || completionTime > dateRange.end) return;

    // Calculate per-stage dwell times
    var stageTimes = { PENDING_SECTOR: 0, PENDING_BU: 0, PENDING_OSO: 0, PENDING_FAS: 0 };

    for (var k = 0; k < logs.length - 1; k++) {
      var entryTime = new Date(logs[k].timestamp);
      var nextTime = new Date(logs[k + 1].timestamp);
      var days = (nextTime - entryTime) / TIME_CONSTANTS.MS_PER_DAY;

      if (days > 0 && days < 90) {
        var stageStatus = logs[k].newStatus;
        if (stageTimes.hasOwnProperty(stageStatus)) {
          stageTimes[stageStatus] += days;
        }
      }
    }

    var sectorDays = Math.round(stageTimes.PENDING_SECTOR * 10) / 10;
    var buDays = Math.round(stageTimes.PENDING_BU * 10) / 10;
    var foDays = Math.round(stageTimes.PENDING_OSO * 10) / 10;
    var fasDays = Math.round(stageTimes.PENDING_FAS * 10) / 10;
    var totalDays = 0;
    if (firstSubmitTime && completionTime) {
      totalDays = Math.round(((completionTime - firstSubmitTime) / TIME_CONSTANTS.MS_PER_DAY) * 10) / 10;
    }

    // Determine bottleneck
    var maxStage = 'Sector';
    var maxDays = sectorDays;
    if (buDays > maxDays) { maxDays = buDays; maxStage = 'BU'; }
    if (foDays > maxDays) { maxDays = foDays; maxStage = 'AAS FO'; }
    if (fasDays > maxDays) { maxStage = 'FAS'; }

    rows.push([
      reqId,
      info.tripName,
      info.bu,
      sectorDays,
      buDays,
      foDays,
      fasDays,
      needsInfoCount,
      totalDays,
      maxStage
    ]);

    sectorTotals.push(sectorDays);
    buTotals.push(buDays);
    foTotals.push(foDays);
    fasTotals.push(fasDays);
    totalTotals.push(totalDays);
    needsInfoTotals.push(needsInfoCount);
  });

  // Sort by total days desc
  rows.sort(function(a, b) { return b[8] - a[8]; });

  // Add summary/averages row
  var avg = function(arr) { return arr.length > 0 ? Math.round((arr.reduce(function(a, b) { return a + b; }, 0) / arr.length) * 10) / 10 : 0; };

  if (rows.length > 0) {
    rows.push([
      'AVERAGE', '', '',
      avg(sectorTotals),
      avg(buTotals),
      avg(foTotals),
      avg(fasTotals),
      avg(needsInfoTotals),
      avg(totalTotals),
      ''
    ]);
  }

  return { headers: headers, rows: rows };
}
