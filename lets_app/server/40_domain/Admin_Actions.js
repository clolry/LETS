/**
 * Admin_Actions.js
 * Write-path admin actions: status override + reviewer reassignment.
 *
 * Exports (@client):
 * - adminOverrideStatus(requestId, newStatus, reason)    — force a status
 *   transition that the normal workflow wouldn't allow. Writes to Requests
 *   + Approval_Log atomically (each via db.updateRowByIndex / db.appendRow
 *   which invalidate cache per call). NO LockService — BUGS_FOUND #7
 *   multi-sheet atomicity gap intentionally not bundled with the refactor.
 * - adminReassignReviewer(requestId, newReviewerEmail, reason)  — change
 *   the assigned reviewer mid-flight (e.g., reviewer on PTO). Writes new
 *   reviewer name+email to the Requests row and appends an ADMIN_REASSIGN
 *   log entry.
 *
 * Companion files: Admin_Dashboard.js (reads), Admin_Cleanup.js (deletes).
 */

// ============================================================================
// ADMIN ACTIONS
// ============================================================================

/**
 * Override request status (admin only). Multi-sheet write: Requests +
 * Approval_Log. No LockService — atomicity gap is BUGS_FOUND #7, separate
 * ticket. db.updateRowByIndex + db.appendRow both invalidate the cache
 * atomically per call.
 * @param {string} requestId - The request ID
 * @param {string} newStatus - New status to set
 * @param {string} reason - Required reason for override
 * @returns {Object} successResponse({ message }) or errorResponse(msg)
 * @client
 */
function adminOverrideStatus(requestId, newStatus, reason) {
  try {
    const admin = requireTravelAdmin();

    if (!requestId || !newStatus || !reason) {
      throw new Error('Request ID, new status, and reason are required');
    }

    // The statuses an admin may force a request into. PENDING_SUPERVISOR and
    // NEEDS_INFO_SUPERVISOR are included: without them an admin could move a
    // request to any stage EXCEPT the first, which is the one most likely to
    // need it — a request that routed past a supervisor because the roster was
    // wrong has to be sendable back.
    const validStatuses = [
      STATUS_CODES.PENDING_SUPERVISOR, STATUS_CODES.PENDING_SECTOR,
      STATUS_CODES.PENDING_BU, STATUS_CODES.PENDING_OSO, STATUS_CODES.PENDING_FAS,
      STATUS_CODES.NEEDS_INFO_SUPERVISOR, STATUS_CODES.NEEDS_INFO_SECTOR,
      STATUS_CODES.NEEDS_INFO_BU, STATUS_CODES.NEEDS_INFO_OSO,
      STATUS_CODES.APPROVED_GOGOV, STATUS_CODES.COMPLETED, STATUS_CODES.DENIED, STATUS_CODES.CANCELLED
    ];

    if (!validStatuses.includes(newStatus)) {
      throw new Error('Invalid status: ' + newStatus);
    }

    const db = new TravelDB();

    const hit = db.findRow(SHEET_NAMES.REQUESTS, 'Request_ID', requestId);
    if (!hit) {
      throw new Error('Request not found');
    }
    const requestsData = db.readSheet(SHEET_NAMES.REQUESTS);
    const previousStatus = hit.data[requestsData.headerIndex['Status']];

    const now = new Date();
    db.updateRowByIndex(SHEET_NAMES.REQUESTS, hit.rowNum, {
      Status: newStatus,
      Updated_At: now
    });

    // Log the action
    db.appendRow(SHEET_NAMES.APPROVAL_LOG, [
      Utilities.getUuid(),
      requestId,
      ACTION_TYPES.ADMIN_OVERRIDE,
      admin.name,
      admin.email,
      // THE AUTHORITY ACTUALLY USED, not a hardcoded 'Admin'.
      //
      // A coordinator reassigning a reviewer is a different act from an admin
      // doing it — same effect, different power — and the log is where that
      // distinction has to survive. Hardcoding 'Admin' would have recorded
      // every coordinator action as an admin one.
      admin.isAdmin ? 'Admin' : 'Coordinator',
      now,
      previousStatus,
      newStatus,
      `Admin override: ${reason}`,
      '', // Section comments
      ''  // Snapshot data
    ]);

    console.log(`Admin ${admin.email} overrode status of ${requestId} from ${previousStatus} to ${newStatus}`);

    return successResponse({ message: `Status changed from ${previousStatus} to ${newStatus}` });

  } catch (error) {
    logError('adminOverrideStatus', error, { requestId: requestId, newStatus: newStatus });
    return errorResponse(error.message || 'Failed to override status');
  }
}

/**
 * Reassign request to a different reviewer (admin only). Multi-sheet write
 * (Requests + Approval_Log). No LockService (BUGS_FOUND #7).
 * @param {string} requestId - The request ID
 * @param {string} newReviewerEmail - New reviewer's email
 * @param {string} reason - Required reason for reassignment
 * @returns {Object} successResponse({ message }) or errorResponse(msg)
 * @client
 */
function adminReassignReviewer(requestId, newReviewerEmail, reason) {
  try {
    // COORDINATOR OR ADMIN.
    //
    // @clolry needs a coordinator who can reassign a reviewer when somebody
    // is out. This sat behind requireTravelAdmin, which also grants budget
    // editing, HR roster editing and role granting — so covering an absence
    // meant handing over every admin power as a side effect.
    //
    // Reassignment is workflow, not money or privilege: it moves a request
    // from one reviewer to another and cannot approve anything. See
    // isTravelCoordinator for the full split.
    //
    // The variable keeps its name so the log and email below are unchanged;
    // requireTravelCoordinator returns the same shape, with role set to
    // 'coordinator' or 'admin' so the log records which authority was used.
    const admin = requireTravelCoordinator();

    if (!requestId || !newReviewerEmail || !reason) {
      throw new Error('Request ID, new reviewer email, and reason are required');
    }

    if (!newReviewerEmail.includes('@')) {
      throw new Error('Invalid email format');
    }

    const db = new TravelDB();
    const hit = db.findRow(SHEET_NAMES.REQUESTS, 'Request_ID', requestId);
    if (!hit) {
      throw new Error('Request not found');
    }

    const requestsData = db.readSheet(SHEET_NAMES.REQUESTS);
    const rIdx = requestsData.headerIndex;
    const previousReviewer = hit.data[rIdx['Current_Reviewer_Email']];
    const tripName = String(hit.data[rIdx['Trip_Name']] || '');

    const newReviewerName = formatUserName(newReviewerEmail);
    const now = new Date();

    db.updateRowByIndex(SHEET_NAMES.REQUESTS, hit.rowNum, {
      Current_Reviewer_Name: newReviewerName,
      Current_Reviewer_Email: newReviewerEmail,
      Updated_At: now
    });

    // Log the action — Snapshot_Data carries the new reviewer in a parseable
    // shape so reviewer-performance metrics can use this timestamp as the
    // start of the new assignee's review clock.
    const reassignSnapshot = JSON.stringify({
      newReviewerEmail: newReviewerEmail,
      newReviewerName: newReviewerName,
      previousReviewer: previousReviewer || ''
    });
    db.appendRow(SHEET_NAMES.APPROVAL_LOG, [
      Utilities.getUuid(),
      requestId,
      ACTION_TYPES.ADMIN_REASSIGN,
      admin.name,
      admin.email,
      'Admin',
      now,
      '', // Previous status (unchanged)
      '', // New status (unchanged)
      `Admin reassigned from ${previousReviewer} to ${newReviewerEmail}: ${reason}`,
      '',
      reassignSnapshot
    ]);

    // Notify the new reviewer — wrapped so an email failure can never block
    // the reassignment write. Email failures are logged and swallowed.
    try {
      sendReassignmentNotification({
        requestId: requestId,
        tripName: tripName,
        newReviewer: { name: newReviewerName, email: newReviewerEmail },
        previousReviewerEmail: previousReviewer || '',
        adminName: admin.name || admin.email,
        reason: reason
      });
    } catch (emailErr) {
      console.error('adminReassignReviewer: email send failed (non-blocking):', emailErr);
      logError('adminReassignReviewer.email', emailErr, { requestId: requestId });
    }

    console.log(`${admin.role} ${admin.email} reassigned ${requestId} from ${previousReviewer} to ${newReviewerEmail}`);

    return successResponse({ message: `Reassigned to ${newReviewerName}` });

  } catch (error) {
    return errorResponse(error.message || 'Failed to reassign reviewer');
  }
}
