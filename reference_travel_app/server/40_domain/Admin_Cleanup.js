/**
 * Admin_Cleanup.js
 * Admin-only bulk delete cascade across the 6 Travel Request sheets.
 *
 * Exports (@client):
 * - getDeletePreview(requestIds)              — read-only preview of what
 *   would be deleted (per-sheet row counts + attachment file IDs); no
 *   writes. Used by the admin confirmation modal.
 * - deleteTravelRequests(requestIds, trashDriveFolder)  — execute the
 *   cascade: deletes rows from Requests, Request_Legs, Request_Travelers,
 *   Traveler_Leg_Costs, Approval_Log, and Attachments. Optionally moves
 *   each attachment's parent Drive folder to a trash folder (extractFolderIdFromUrl_
 *   parses the folder URL stored on the Request row).
 *
 * Internal helper (@private @server):
 * - extractFolderIdFromUrl_(url)              — parses a Drive folder URL
 *   into its file-id; used only by deleteTravelRequests.
 *
 * High-blast-radius path. The chunk-10.D smoke pass verified that the
 * cascade clears all 6 sheets + invalidates the request_review_v2_ cache
 * entry per request.
 *
 * Companion files: Admin_Dashboard.js (reads), Admin_Actions.js (status/reviewer writes).
 */

// ============================================================================
// REQUEST DELETION (Admin only — cascade across all 6 data sheets)
// ============================================================================

/**
 * Preview the impact of deleting one or more travel requests.
 * Counts affected rows per sheet without deleting anything.
 * @param {string[]} requestIds - Array of Request_ID values
 * @returns {Object} successResponse({ preview }) or errorResponse(msg)
 * @client
 */
function getDeletePreview(requestIds) {
  try {
    requireTravelAdmin();

    if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
      return errorResponse('No request IDs provided');
    }

    const db = new TravelDB();
    const idSet = {};
    for (var i = 0; i < requestIds.length; i++) {
      idSet[String(requestIds[i]).trim()] = true;
    }

    // Count matching rows per sheet
    var sheetNames = ['Requests', 'Request_Legs', 'Request_Travelers', 'Traveler_Leg_Costs', 'Attachments', 'Approval_Log'];
    var counts = {};
    var totalRows = 0;
    var attachmentFolders = [];
    var requestSummaries = [];

    for (var s = 0; s < sheetNames.length; s++) {
      var sheetName = sheetNames[s];
      var data = db.readSheet(sheetName);
      var ridIdx = data.headerIndex['Request_ID'];
      if (ridIdx === undefined) {
        counts[sheetName] = 0;
        continue;
      }

      var count = 0;
      for (var r = 0; r < data.rows.length; r++) {
        var rowId = String(data.rows[r][ridIdx]).trim();
        if (idSet[rowId]) {
          count++;

          // Collect summaries from Requests sheet
          if (sheetName === 'Requests') {
            var folderUrl = data.rows[r][data.headerIndex['Attachments_Folder']] || '';
            if (folderUrl) attachmentFolders.push(folderUrl);
            requestSummaries.push({
              requestId: rowId,
              tripName: data.rows[r][data.headerIndex['Trip_Name']] || 'Untitled',
              status: data.rows[r][data.headerIndex['Status']] || '',
              submitterName: data.rows[r][data.headerIndex['Submitter_Name']] || 'Unknown'
            });
          }
        }
      }
      counts[sheetName] = count;
      totalRows += count;
    }

    return successResponse(JSON.parse(JSON.stringify({
      preview: {
        requests: counts['Requests'] || 0,
        requestLegs: counts['Request_Legs'] || 0,
        requestTravelers: counts['Request_Travelers'] || 0,
        travelerLegCosts: counts['Traveler_Leg_Costs'] || 0,
        attachments: counts['Attachments'] || 0,
        approvalLog: counts['Approval_Log'] || 0,
        totalRows: totalRows,
        attachmentFolders: attachmentFolders,
        requestSummaries: requestSummaries
      }
    })));

  } catch (error) {
    logError('getDeletePreview', error, { requestIds: requestIds });
    return errorResponse(error.message || 'Failed to generate delete preview');
  }
}

/**
 * Permanently delete one or more travel requests and all associated data.
 * Cascades across 6 sheets in dependency order (children first, parent last).
 * Optionally trashes the Drive attachment folder.
 *
 * Per-sheet loop uses raw sheet.deleteRow() + ONE db.invalidate() at the
 * sheet's end. Switching to db.deleteRowByIndex per row would add a cache
 * re-warm per delete — a performance regression for bulk operations.
 *
 * NO LockService (BUGS_FOUND #7 territory). Cascading delete across 6 sheets
 * is the highest-risk operation in the codebase; a transient error mid-loop
 * could leave orphan rows. Atomicity fix is a separate ticket.
 *
 * @param {string[]} requestIds - Array of Request_ID values
 * @param {boolean} trashDriveFolder - Whether to trash attachment folders in Drive
 * @returns {Object} successResponse({ message, deletedCounts, folderResults }) or errorResponse(msg)
 * @client
 */
function deleteTravelRequests(requestIds, trashDriveFolder) {
  try {
    var admin = requireTravelAdmin();

    if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
      return errorResponse('No request IDs provided');
    }

    const db = new TravelDB();
    const idSet = {};
    for (var i = 0; i < requestIds.length; i++) {
      idSet[String(requestIds[i]).trim()] = true;
    }

    // Collect attachment folder URLs before deleting Requests rows
    var folderUrls = [];
    if (trashDriveFolder) {
      var reqData = db.readSheet(SHEET_NAMES.REQUESTS);
      var ridIdx = reqData.headerIndex['Request_ID'];
      var folderIdx = reqData.headerIndex['Attachments_Folder'];
      if (ridIdx !== undefined && folderIdx !== undefined) {
        for (var r = 0; r < reqData.rows.length; r++) {
          var rowId = String(reqData.rows[r][ridIdx]).trim();
          if (idSet[rowId]) {
            var url = reqData.rows[r][folderIdx];
            if (url) folderUrls.push(url);
          }
        }
      }
    }

    // Delete in dependency order: children first, parent last
    var deleteOrder = ['Traveler_Leg_Costs', 'Request_Travelers', 'Request_Legs', 'Attachments', 'Approval_Log', 'Requests'];
    var deletedCounts = {};
    var totalDeleted = 0;

    for (var s = 0; s < deleteOrder.length; s++) {
      var sheetName = deleteOrder[s];
      var sheet = db.sheet(sheetName);
      var data = db.readSheet(sheetName);
      var colIdx = data.headerIndex['Request_ID'];

      if (colIdx === undefined || !sheet) {
        deletedCounts[sheetName] = 0;
        continue;
      }

      // Find matching row numbers (1-based, +2 for header offset: row 0 is headers, data starts at row 2)
      var matchingRows = [];
      for (var r = 0; r < data.rows.length; r++) {
        if (idSet[String(data.rows[r][colIdx]).trim()]) {
          matchingRows.push(r + 2); // +2: 1-based indexing + header row
        }
      }

      // Delete rows bottom-up to preserve row numbers
      matchingRows.sort(function(a, b) { return b - a; });
      for (var d = 0; d < matchingRows.length; d++) {
        sheet.deleteRow(matchingRows[d]);
      }

      deletedCounts[sheetName] = matchingRows.length;
      totalDeleted += matchingRows.length;
      db.invalidate(sheetName);
    }

    // Invalidate CacheService keys
    var cache = CacheService.getScriptCache();
    var cacheKeys = [];
    for (var k = 0; k < requestIds.length; k++) {
      cacheKeys.push('request_review_v2_' + requestIds[k]);
    }
    // Clear period-based dashboard stats
    var periods = ['7d', '30d', '90d', '365d', 'all'];
    for (var p = 0; p < periods.length; p++) {
      cacheKeys.push('admin_dashboard_stats_' + periods[p]);
    }
    try { cache.removeAll(cacheKeys); } catch (e) { /* cache clear is best-effort */ }

    // Best-effort Drive folder trash
    var folderResults = [];
    if (trashDriveFolder && folderUrls.length > 0) {
      for (var f = 0; f < folderUrls.length; f++) {
        try {
          var folderId = extractFolderIdFromUrl_(folderUrls[f]);
          if (folderId) {
            DriveApp.getFolderById(folderId).setTrashed(true);
            folderResults.push({ url: folderUrls[f], trashed: true });
          }
        } catch (folderError) {
          console.warn('Could not trash Drive folder:', folderUrls[f], folderError.message);
          folderResults.push({ url: folderUrls[f], trashed: false, error: folderError.message });
        }
      }
    }

    // Log this admin action
    console.log('Admin ' + admin.email + ' deleted ' + requestIds.length + ' request(s): ' + requestIds.join(', ') +
      ' — total rows removed: ' + totalDeleted);

    return successResponse({
      message: 'Deleted ' + requestIds.length + ' request(s) (' + totalDeleted + ' total rows removed)',
      deletedCounts: deletedCounts,
      folderResults: folderResults
    });

  } catch (error) {
    logError('deleteTravelRequests', error, { requestIds: requestIds, trashDriveFolder: trashDriveFolder });
    return errorResponse(error.message || 'Failed to delete requests');
  }
}

/**
 * Extract Google Drive folder ID from a Drive folder URL
 * @param {string} url - Drive folder URL
 * @returns {string|null} Folder ID or null
 * @private
 * @server
 */
function extractFolderIdFromUrl_(url) {
  if (!url) return null;
  // Pattern: https://drive.google.com/drive/folders/FOLDER_ID or /folders/FOLDER_ID?...
  var match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

