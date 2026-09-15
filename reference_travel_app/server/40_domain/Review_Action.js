/**
 * Review_Action.js
 * Reviewer action handler: approve / deny / needs-info / cancel / resubmit.
 *
 * Exports:
 * - submitReviewAction() @client — process a reviewer or submitter action,
 *   advance status, write Approval_Log entry, send notifications
 * - getActionConfig() / getReviewerRole() — internal action-config lookup
 * - lookupNextReviewer() / lookupOSOReviewer() — stage-aware reviewer
 *   resolution (re-resolves from Travel_User_Roles, NOT request snapshot)
 * - _hasOverheadFromData() / _hasOverheadFromRows() — overhead detection
 *   (NB: _hasOverheadFromData is called from Submission.js cross-domain)
 * - _lookupNextReviewerFromDb() — TravelDB-cached variant for chained calls
 * - _sendReviewActionNotificationWithData() — email-routing branch table;
 *   receives the LEGACY {success, request, legs, travelers, ...} shape after
 *   submitReviewAction unwraps the getRequestForReview envelope inline
 *   (wrap-don't-rewrite, Chunk 10.D)
 *
 * Companion files: Review_Read.js, Review_Update.js, Review_DDConfirm.js
 */

/**
 * Submit a review action (approve, deny, needs info, cancel)
 *
 * Chained call pattern: this function calls getRequestForReview(requestId, db)
 * to load fresh data after the status write. Since getRequestForReview now
 * returns a successResponse envelope, the result is unwrapped inline into the
 * legacy `{success, request, legs, travelers, ...}` shape — that's what the
 * internal email helpers (_sendReviewActionNotificationWithData,
 * _sendDDConfirmationEmailsFromData) expect. Wrap-don't-rewrite pattern from
 * Chunk 10.D — avoids cascading the envelope change through 16 internal
 * helpers.
 *
 * @param {string} requestId - The request ID
 * @param {string} action - Action type (bu_approve, bu_needs_info, oso_approve, etc.)
 * @param {string} comments - General comments (required for some actions)
 * @param {Object} sectionComments - Section-specific comments (optional)
 * @returns {Object} successResponse({ requestId, action, newStatus, message }) or errorResponse(msg)
 * @client
 */
function submitReviewAction(requestId, action, comments, sectionComments) {
  const _timer = 'submitReviewAction(' + requestId + ', ' + action + ')';
  console.time(_timer);
  try {
    if (!requestId || !action) {
      throw new Error('Request ID and action are required');
    }

    const db = new TravelDB();
    const currentUser = Session.getActiveUser().getEmail();
    const currentUserName = formatUserName(currentUser);
    const now = new Date();

    // Load current request to verify permissions and get current status
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
    const { headers: requestHeaders, rows: requestRows } = db.readSheet(SHEET_NAMES.REQUESTS);

    let requestRowIndex = -1;
    let requestRow = null;
    let currentStatus = '';
    let currentVersion = 1;

    for (let i = 0; i < requestRows.length; i++) {
      if (requestRows[i][0] === requestId) {
        requestRowIndex = i + 2; // +2: 1-indexed + header row
        requestRow = requestRows[i];
        currentStatus = requestRow[requestHeaders.indexOf('Status')];
        currentVersion = parseInt(requestRow[requestHeaders.indexOf('Version')]) || 1;
        break;
      }
    }

    if (requestRowIndex === -1) {
      throw new Error(`Request ${requestId} not found`);
    }

    // Verify caller is authorized to perform this action
    const submitterActions = ['resubmit', 'submitter_cancel'];
    if (!isTravelAdmin(currentUser)) {
      if (submitterActions.includes(action)) {
        const submitterEmail = requestRow[requestHeaders.indexOf('Submitter_Email')] || '';
        if (currentUser.toLowerCase() !== submitterEmail.toLowerCase()) {
          throw new Error('Only the request submitter can perform this action. Your email (' + currentUser + ') does not match the submitter email on this request.');
        }
      } else {
        const assignedReviewer = requestRow[requestHeaders.indexOf('Current_Reviewer_Email')] || '';
        if (currentUser.toLowerCase() !== assignedReviewer.toLowerCase()) {
          throw new Error('Only the assigned reviewer can perform this action');
        }
      }
    }

    // Determine new status and validate action
    const actionConfig = getActionConfig(action, currentStatus);
    if (!actionConfig.valid) {
      throw new Error(actionConfig.error || 'Invalid action for current status');
    }

    // Validate comments requirement - either overall comment OR section comments
    if (actionConfig.requiresComments) {
      const hasOverallComment = comments && comments.trim().length > 0;
      const hasSectionComments = sectionComments &&
        Object.values(sectionComments).some(c => c && c.trim().length > 0);

      if (!hasOverallComment && !hasSectionComments) {
        throw new Error('Comments are required for this action');
      }
    }

    // Determine reviewer role
    const actionByRole = getReviewerRole(action);

    // ========== Handle Client-Paid OSO Approval (Skip FAS) ==========
    // For client-paid requests, OSO approval goes directly to APPROVED_GOGOV
    // Pre-load request data once for the entire chain (notifications, FAS form, DD emails)
    let effectiveNewStatus = actionConfig.newStatus;
    let isClientPaidOsoApproval = false;

    // Load full request data ONCE for overhead check + downstream helpers
    // Invalidate Requests cache first since we're about to write to it
    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    db.invalidate(SHEET_NAMES.REQUEST_TRAVELERS);

    if (action === 'oso_approve') {
      // Use fresh traveler data from db to check overhead
      const travelerRows = db.findRows(SHEET_NAMES.REQUEST_TRAVELERS, 'Request_ID', requestId);
      const { headerIndex: tIdx } = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
      const isClientPaidCol = tIdx['Is_Client_Paid'];
      if (isClientPaidCol === undefined) {
        console.error('CRITICAL: Is_Client_Paid column not found in Request_Travelers. Headers:', Object.keys(tIdx).join(', '));
        logError('submitReviewAction', new Error('Is_Client_Paid column missing from Request_Travelers'), { requestId });
      }
      if (!travelerRows || !travelerRows.length) {
        console.error('CRITICAL: No traveler rows found for request ' + requestId + ' during OSO approval overhead check');
        logError('submitReviewAction', new Error('No traveler rows found for overhead check'), { requestId });
      }
      const isOverhead = _hasOverheadFromRows(travelerRows, isClientPaidCol);
      if (!isOverhead) {
        // Client-paid: skip FAS, go directly to APPROVED_GOGOV
        effectiveNewStatus = STATUS_CODES.APPROVED_GOGOV;
        isClientPaidOsoApproval = true;
        console.log(`Client-paid OSO approval - skipping FAS, going to APPROVED_GOGOV`);
      }
    }

    // ========== Write Approval Log Entry FIRST (if this fails, status is unchanged) ==========
    const approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
    if (!approvalLogSheet) {
      throw new Error('Approval_Log sheet not found');
    }

    const logId = generateLogId();
    const logRow = [
      logId,                                    // Log_ID
      requestId,                                // Request_ID
      actionConfig.actionName,                  // Action
      currentUserName,                          // Action_By_Name
      currentUser,                              // Action_By_Email
      actionByRole,                             // Action_By_Role
      now,                                      // Timestamp
      currentStatus,                            // Previous_Status
      effectiveNewStatus,                       // New_Status (may differ for client-paid OSO approve)
      comments || '',                           // Comments
      sectionComments ? JSON.stringify(sectionComments) : '', // Section_Comments
      '',                                       // Snapshot_Data (only on resubmit)
      currentVersion,                           // Version_Before
      currentVersion + 1                        // Version_After
    ];

    approvalLogSheet.appendRow(logRow);

    // ========== Update Request Status (safe — log entry already exists) ==========
    const statusColIndex = requestHeaders.indexOf('Status') + 1;
    const updatedAtColIndex = requestHeaders.indexOf('Updated_At') + 1;
    const versionColIndex = requestHeaders.indexOf('Version') + 1;
    const currentReviewerNameColIndex = requestHeaders.indexOf('Current_Reviewer_Name') + 1;
    const currentReviewerEmailColIndex = requestHeaders.indexOf('Current_Reviewer_Email') + 1;

    requestsSheet.getRange(requestRowIndex, statusColIndex).setValue(effectiveNewStatus);
    requestsSheet.getRange(requestRowIndex, updatedAtColIndex).setValue(now);
    requestsSheet.getRange(requestRowIndex, versionColIndex).setValue(currentVersion + 1);

    // Update Submitted_At on resubmit (tracks last submission by submitter)
    if (action === 'resubmit') {
      const submittedAtColIndex = requestHeaders.indexOf('Submitted_At') + 1;
      if (submittedAtColIndex > 0) {
        requestsSheet.getRange(requestRowIndex, submittedAtColIndex).setValue(now);
      }
    }

    // For *_needs_info actions, leave Current_Reviewer_Name/Email in place.
    // The semantics are "this stage is assigned to <reviewer>" — even when
    // the request is temporarily back with the submitter for more info,
    // that reviewer is who'll re-review when it comes back. Keeping the
    // value populated lets the dashboards and review pages show "still
    // assigned to BU reviewer X" while the submitter is editing, instead
    // of showing an empty reviewer cell that hides accountability.
    // The resubmit action will overwrite via _lookupNextReviewerFromDb
    // anyway, so we never end up with a stale value once a resubmit
    // re-routes through review.

    // Update current reviewer for next stage (if applicable)
    // Skip for client-paid OSO approval since it goes directly to APPROVED_GOGOV
    let nextReviewer = null;
    if (actionConfig.nextReviewer && !isClientPaidOsoApproval) {
      nextReviewer = _lookupNextReviewerFromDb(effectiveNewStatus, requestId, db);
      if (nextReviewer) {
        requestsSheet.getRange(requestRowIndex, currentReviewerNameColIndex).setValue(nextReviewer.name || '');
        requestsSheet.getRange(requestRowIndex, currentReviewerEmailColIndex).setValue(nextReviewer.email || '');

        // Share attachments with new reviewer
        try {
          const attachments = getRequestAttachments(requestId);
          if (attachments.success && attachments.attachments.length > 0) {
            const fileIds = attachments.attachments.map(a => a.fileId);
            const shareResult = shareAttachmentsWithUsers(fileIds, [nextReviewer.email], 'viewer');
            if (shareResult.success) {
              console.log(`Shared ${fileIds.length} attachments with ${nextReviewer.email}`);
            } else {
              console.warn('Failed to share attachments with next reviewer:', shareResult.error);
            }
          }
        } catch (shareError) {
          console.warn('Error sharing attachments with next reviewer:', shareError);
          // Don't fail the approval for sharing errors
        }
      }
    }

    // ========== Load full request data ONCE for notifications + post-approval helpers ==========
    // Invalidate TravelDB caches after writes so getRequestForReview sees fresh data
    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    // Invalidate CacheService entry — getRequestForReview(id, db) will read fresh and re-cache
    try { CacheService.getScriptCache().remove('request_review_v2_' + requestId); } catch (ce) { /* ignore */ }

    // Unwrap envelope into legacy {success, request, legs, ...} shape so the
    // internal email helpers below (_sendReviewActionNotificationWithData,
    // _sendDDConfirmationEmailsFromData) keep reading their existing field
    // paths unchanged. Wrap-don't-rewrite pattern from Chunk 10.D.
    const requestEnvelope = getRequestForReview(requestId, db);
    const requestData = (requestEnvelope && requestEnvelope.success && requestEnvelope.data)
      ? Object.assign({ success: true }, requestEnvelope.data)
      : { success: false, error: requestEnvelope && requestEnvelope.error };

    // ========== Send Notifications ==========
    _sendReviewActionNotificationWithData(requestData, actionConfig, comments, sectionComments, nextReviewer, currentStatus, isClientPaidOsoApproval);

    console.log(`submitReviewAction: ${action} on ${requestId} by ${currentUser}`);

    // ========== Handle OSO Approval - Client-Paid DD Emails ==========
    let effectiveMessage = actionConfig.successMessage;

    if (action === 'oso_approve') {
      const isOverhead = !isClientPaidOsoApproval;
      console.log(`OSO Approve: Request ${requestId} has overhead travelers: ${isOverhead}`);

      if (!isOverhead) {
        // Client-paid: Already set to APPROVED_GOGOV, send DD confirmation emails
        effectiveMessage = 'Request approved - DD confirmation emails sent';
        try {
          _sendDDConfirmationEmailsFromData(requestData);
          console.log('Sent DD confirmation emails for client-paid request');
        } catch (emailError) {
          console.error('Failed to send DD confirmation emails:', emailError);
          // Don't fail the approval for email errors
        }
      }
    }

    // ========== Handle FAS Approval - Send DD Confirmation Emails ==========
    if (action === 'fas_approve') {
      try {
        _sendDDConfirmationEmailsFromData(requestData);
        console.log('Sent DD confirmation emails after FAS approval');
      } catch (emailError) {
        console.error('Failed to send DD confirmation emails:', emailError);
        // Don't fail the approval for email errors
      }
    }

    console.timeEnd(_timer);
    return successResponse({
      requestId: requestId,
      action: action,
      newStatus: effectiveNewStatus
    }, effectiveMessage);

  } catch (error) {
    console.error('Error in submitReviewAction:', error);
    logError('submitReviewAction', error, { requestId: requestId, action: action });
    console.timeEnd(_timer);
    return errorResponse(error.message || 'Failed to submit review action');
  }
}

/**
 * Get configuration for a review action.
 * Internal lookup table — returns a plain config object, not an envelope.
 * @private @server
 */
function getActionConfig(action, currentStatus) {
  const configs = {
    // ===== Sector Director Actions =====
    'sector_approve': {
      valid: currentStatus === STATUS_CODES.PENDING_SECTOR,
      actionName: ACTION_TYPES.SECTOR_APPROVED,
      newStatus: STATUS_CODES.PENDING_BU,
      requiresComments: false,
      nextReviewer: true,
      successMessage: 'Request approved and forwarded to BU review'
    },
    'sector_needs_info': {
      valid: currentStatus === STATUS_CODES.PENDING_SECTOR,
      actionName: ACTION_TYPES.SECTOR_NEEDS_INFO,
      newStatus: STATUS_CODES.NEEDS_INFO_SECTOR,
      requiresComments: true,
      nextReviewer: false,
      successMessage: 'Request returned to submitter for more information'
    },
    // ===== BU Reviewer Actions =====
    'bu_approve': {
      valid: currentStatus === STATUS_CODES.PENDING_BU,
      actionName: ACTION_TYPES.BU_APPROVED,
      newStatus: STATUS_CODES.PENDING_OSO,
      requiresComments: false,
      nextReviewer: true,
      successMessage: 'Request approved and forwarded to AAS FO review'
    },
    'bu_needs_info': {
      valid: currentStatus === STATUS_CODES.PENDING_BU,
      actionName: ACTION_TYPES.BU_NEEDS_INFO,
      newStatus: STATUS_CODES.NEEDS_INFO_BU,
      requiresComments: true,
      nextReviewer: false,
      successMessage: 'Request returned to submitter for more information'
    },
    'oso_approve': {
      valid: currentStatus === STATUS_CODES.PENDING_OSO,
      actionName: ACTION_TYPES.OSO_APPROVED,
      newStatus: STATUS_CODES.PENDING_FAS,
      requiresComments: false,
      nextReviewer: true,
      successMessage: 'Request approved and forwarded to FAS'
    },
    'oso_needs_info': {
      valid: currentStatus === STATUS_CODES.PENDING_OSO,
      actionName: ACTION_TYPES.OSO_NEEDS_INFO,
      newStatus: STATUS_CODES.NEEDS_INFO_OSO,
      requiresComments: true,
      nextReviewer: false,
      successMessage: 'Request returned to submitter for more information'
    },
    'fas_approve': {
      valid: currentStatus === STATUS_CODES.PENDING_FAS,
      actionName: ACTION_TYPES.FAS_APPROVED,
      newStatus: STATUS_CODES.APPROVED_GOGOV,
      requiresComments: false,
      nextReviewer: false,
      successMessage: 'Request approved - pending Go.gov action'
    },
    'fas_deny': {
      valid: currentStatus === STATUS_CODES.PENDING_FAS,
      actionName: ACTION_TYPES.FAS_DENIED,
      newStatus: STATUS_CODES.DENIED,
      requiresComments: true,
      nextReviewer: false,
      successMessage: 'Request denied by FAS'
    },
    'deny': {
      valid: [STATUS_CODES.PENDING_SECTOR, STATUS_CODES.PENDING_BU, STATUS_CODES.PENDING_OSO].includes(currentStatus),
      actionName: ACTION_TYPES.DENIED,
      newStatus: STATUS_CODES.DENIED,
      requiresComments: true,
      nextReviewer: false,
      successMessage: 'Request denied'
    },
    'cancel': {
      valid: ![STATUS_CODES.COMPLETED, STATUS_CODES.CANCELLED, STATUS_CODES.DENIED].includes(currentStatus),
      actionName: ACTION_TYPES.CANCELLED,
      newStatus: STATUS_CODES.CANCELLED,
      requiresComments: true,
      nextReviewer: false,
      successMessage: 'Request cancelled'
    },
    'submitter_cancel': {
      valid: ![STATUS_CODES.COMPLETED, STATUS_CODES.CANCELLED, STATUS_CODES.DENIED].includes(currentStatus),
      actionName: ACTION_TYPES.SUBMITTER_CANCELLED,
      newStatus: STATUS_CODES.CANCELLED,
      requiresComments: false,
      nextReviewer: false,
      successMessage: 'Request cancelled'
    },
    'resubmit': {
      valid: [STATUS_CODES.NEEDS_INFO_SECTOR, STATUS_CODES.NEEDS_INFO_BU, STATUS_CODES.NEEDS_INFO_OSO].includes(currentStatus),
      actionName: ACTION_TYPES.RESUBMITTED,
      newStatus: currentStatus === STATUS_CODES.NEEDS_INFO_SECTOR ? STATUS_CODES.PENDING_SECTOR :
                 currentStatus === STATUS_CODES.NEEDS_INFO_BU ? STATUS_CODES.PENDING_BU : STATUS_CODES.PENDING_OSO,
      requiresComments: false,
      nextReviewer: true,
      successMessage: 'Request resubmitted for review'
    }
  };

  const config = configs[action];
  if (!config) {
    return { valid: false, error: 'Unknown action type' };
  }
  if (!config.valid) {
    return { valid: false, error: `Cannot perform ${action} when status is ${currentStatus}. This may happen if the request was updated by another user. Please refresh and try again.` };
  }
  return config;
}

/**
 * Determine reviewer role based on action.
 * @private @server
 */
function getReviewerRole(action) {
  if (action.startsWith('sector_')) return 'Sector_Director';
  if (action.startsWith('bu_')) return 'BU_Reviewer';
  if (action.startsWith('oso_')) return 'OSO_Reviewer';
  if (action.startsWith('fas_')) return 'Admin';
  if (action === 'submitter_cancel' || action === 'resubmit') return 'Submitter';
  return 'Reviewer';
}

// generateLogId() removed — canonical version is in TravelDatabaseSetup.js

/**
 * Look up the reviewer who should own a request at `newStatus`.
 *
 * Source of truth: Travel_User_Roles (current routing config), NOT the
 * snapshot fields on the request row. The snapshot fields
 * (Sector_Director_*, BU_Reviewer_*) are historical — they capture who
 * was assigned at submission time and never get rewritten. If admin
 * swaps a primary or deactivates a user between submit and stage
 * advancement, this re-resolve picks up the change.
 *
 * Per-stage resolution:
 *   PENDING_SECTOR → findSectorDirector(Submitter_Org_Code)
 *   PENDING_BU     → lookupBUReviewer(Submitter_Org_Code's 3-char prefix,
 *                                     Submitter_BU as buNameHint)
 *   PENDING_OSO    → lookupOSOReviewer() (active aas_fo_reviewer primary)
 *   PENDING_FAS    → getFASReviewer()    (active fas_fo_reviewer primary)
 *
 * Both lookups internally fall back to the active backup if no active
 * primary exists — same logic as submission-time routing.
 *
 * Returns the bare reviewer object `{name, email}` (or null) — the
 * existing internal contract callers rely on. Not an envelope.
 *
 * @server
 */
function lookupNextReviewer(newStatus, requestId) {
  if (newStatus === STATUS_CODES.PENDING_OSO) {
    return lookupOSOReviewer();
  }
  if (newStatus === STATUS_CODES.PENDING_FAS) {
    var fas = getFASReviewer();
    return fas && fas.email ? { name: fas.name, email: fas.email } : null;
  }
  if (newStatus !== STATUS_CODES.PENDING_BU && newStatus !== STATUS_CODES.PENDING_SECTOR) {
    return null;
  }

  // Need the request's submitter context to re-resolve. Use TravelDB so the
  // Requests cache is shared with other readers (was raw openById before).
  try {
    const db = new TravelDB();
    const { rows, headerIndex } = db.readSheet(SHEET_NAMES.REQUESTS);

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] !== requestId) continue;
      const row = rows[i];
      const orgCode = String(row[headerIndex['Submitter_Org_Code']] || '').trim();
      const buName  = String(row[headerIndex['Submitter_BU']] || '').trim();
      const buCode  = orgCode.substring(0, 3);

      if (newStatus === STATUS_CODES.PENDING_BU) {
        const bu = lookupBUReviewer(buCode, buName);
        return bu ? { name: bu.name, email: bu.email } : null;
      }
      if (newStatus === STATUS_CODES.PENDING_SECTOR) {
        const sd = findSectorDirector(orgCode);
        return sd ? { name: sd.name, email: sd.email } : null;
      }
    }
  } catch (e) {
    console.error('lookupNextReviewer error: ' + e.message);
  }
  return null;
}

/**
 * Look up OSO reviewer — delegates to cached getOSOReviewers() in Submission.js.
 * Returns `{name, email}` or null. Not an envelope.
 * @private @server
 */
function lookupOSOReviewer() {
  try {
    const osoData = getOSOReviewers();
    if (osoData && osoData.primary) {
      return { name: osoData.primary.name, email: osoData.primary.email };
    }
    return null;
  } catch (e) {
    console.log('Error looking up OSO reviewer:', e.message);
    return null;
  }
}

// ============================================================================
// DATA-PASSING HELPERS (avoid redundant spreadsheet reads)
// ============================================================================

/**
 * Check if any traveler in already-loaded data is Overhead (not Client-Paid)
 * Used by submitReviewAction() to avoid opening the spreadsheet again.
 * @param {Array} travelers - Array of traveler objects from getRequestForReview()
 * @returns {boolean} true if any traveler is Overhead
 * @private @server
 */
function _hasOverheadFromData(travelers) {
  if (!travelers || !travelers.length) return false;
  return travelers.some(t => {
    const val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return !val || val === 'overhead';
  });
}

/**
 * Check if any traveler in raw sheet rows is Overhead
 * Used before getRequestForReview is called (early in submitReviewAction)
 * @param {Array[]} rows - Raw sheet rows matching the request
 * @param {number} isClientPaidCol - Column index for Is_Client_Paid
 * @returns {boolean} true if any traveler is Overhead
 * @private @server
 */
function _hasOverheadFromRows(rows, isClientPaidCol) {
  if (!rows || !rows.length || isClientPaidCol === undefined) return false;
  return rows.some(row => {
    const val = String(row[isClientPaidCol] || '').toLowerCase().trim();
    return !val || val === 'overhead';
  });
}

/**
 * Look up next reviewer using TravelDB (avoids separate openById)
 * For PENDING_OSO: uses cached getOSOReviewers() from Submission.js
 * For PENDING_BU/PENDING_SECTOR: reads from already-cached Requests data in db
 * Returns the bare `{name, email}` shape (or null) — not an envelope.
 * @param {string} newStatus - The new status after the action
 * @param {string} requestId - The request ID
 * @param {TravelDB} db - TravelDB instance
 * @returns {Object|null} { name, email } or null
 * @private @server
 */
function _lookupNextReviewerFromDb(newStatus, requestId, db) {
  if (newStatus === STATUS_CODES.PENDING_OSO) {
    // Use cached OSO reviewer lookup from TravelSubmissionService
    const osoData = getOSOReviewers();
    if (osoData && osoData.primary) {
      return { name: osoData.primary.name, email: osoData.primary.email };
    }
    return null;
  }

  if (newStatus === STATUS_CODES.PENDING_FAS) {
    // Phase 7 cutover: FAS reviewer lives in Travel_User_Roles as the
    // active primary fas_fo_reviewer role. getFASReviewer is defined in
    // TravelSubmissionService and shares the unified-roles cache.
    try {
      const fas = getFASReviewer();
      if (fas && fas.email) return { name: fas.name, email: fas.email };
      console.warn('No active fas_fo_reviewer configured in Travel_User_Roles');
    } catch (e) {
      console.error('Error looking up FAS reviewer:', e.message);
    }
    return null;
  }

  if (newStatus === STATUS_CODES.PENDING_BU || newStatus === STATUS_CODES.PENDING_SECTOR) {
    // Re-resolve from current Travel_User_Roles config using the
    // request's stored Submitter_Org_Code + Submitter_BU as the
    // routing input. The snapshot fields (BU_Reviewer_Email,
    // Sector_Director_Email) on the request row are kept for
    // historical/audit purposes but no longer drive routing.
    try {
      const { rows, headerIndex } = db.readSheet(SHEET_NAMES.REQUESTS);
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] !== requestId) continue;
        const orgCode = String(rows[i][headerIndex['Submitter_Org_Code']] || '').trim();
        const buName  = String(rows[i][headerIndex['Submitter_BU']] || '').trim();
        const buCode  = orgCode.substring(0, 3);
        if (newStatus === STATUS_CODES.PENDING_BU) {
          const bu = lookupBUReviewer(buCode, buName);
          return bu ? { name: bu.name, email: bu.email } : null;
        }
        const sd = findSectorDirector(orgCode);
        return sd ? { name: sd.name, email: sd.email } : null;
      }
    } catch (e) {
      console.error('Error looking up next reviewer from db:', e.message);
    }
  }

  return null;
}

/**
 * Send notification emails using already-loaded request data.
 *
 * Receives `requestData` in the LEGACY shape (`{success, request, legs, travelers, ...}`)
 * — submitReviewAction unwraps the getRequestForReview envelope before
 * passing it here. Wrap-don't-rewrite from Chunk 10.D so the email-routing
 * branches below stay readable and unchanged.
 *
 * @param {Object} requestData - Full request data (legacy shape, not envelope)
 * @param {Object} actionConfig - Action configuration
 * @param {string} comments - General comments
 * @param {Object} sectionComments - Section-specific comments
 * @param {Object} nextReviewer - Next reviewer { name, email }
 * @param {string} previousStatus - Status before the action
 * @param {boolean} isClientPaidOsoApproval - Whether this is a client-paid OSO approval (skips FAS)
 * @private @server
 */
function _sendReviewActionNotificationWithData(requestData, actionConfig, comments, sectionComments, nextReviewer, previousStatus, isClientPaidOsoApproval) {
  try {
    if (!requestData || !requestData.success) {
      console.error('Failed to load request for notification');
      return;
    }

    const request = requestData.request;
    const requestId = request.requestId;
    const currentUser = Session.getActiveUser().getEmail();
    const reviewerName = formatUserName(currentUser);

    // Build request object for email functions
    // Note: travelers are at requestData.travelers, not request.travelers
    const emailRequest = {
      submitterEmail: request.submitterEmail,
      submitterName: request.submitterName,
      tripName: request.tripName,
      eventStartDate: request.eventStartDate,
      eventEndDate: request.eventEndDate,
      isInternational: request.isInternational || false,
      travelTypes: request.travelTypes || [],
      travelers: requestData.travelers || [],
      legs: requestData.legs || [],
      requestId: requestId
    };

    const actionName = actionConfig.actionName;

    // Build current reviewer object for confirmation emails
    const currentReviewer = {
      name: reviewerName,
      email: currentUser
    };

    // Route to appropriate email function based on action
    if (actionName === ACTION_TYPES.SECTOR_APPROVED) {
      // Notify submitter of Sector Director approval
      // CC travelers + SD (same stage-aware pattern as needs-info)
      const nextReviewerName = nextReviewer ? nextReviewer.name : 'the BU reviewer';
      var sectorApprCc = _buildStageCcList({
        submitterEmail: request.submitterEmail,
        travelers: emailRequest.travelers,
        sectorDirectorEmail: request.sectorDirectorEmail,
        buReviewerEmail: request.buReviewerEmail,
        currentReviewerEmail: currentUser,
        stage: 'Sector'
      });
      sendApprovalNotification(requestId, emailRequest, 'Sector', '', {
        approverName: reviewerName,
        nextReviewerName: nextReviewerName,
        isFinal: false
      }, sectorApprCc);

      // Notify next reviewer (BU) if available
      if (nextReviewer && nextReviewer.email) {
        sendReviewerNotification(requestId, emailRequest, nextReviewer, 'BU');
      }

      // Confirm to Sector Director that their approval went through
      sendReviewerApprovalConfirmation(requestId, emailRequest, currentReviewer, nextReviewerName, 'Sector');

    } else if (actionName === ACTION_TYPES.BU_APPROVED) {
      // Notify submitter of BU approval
      // CC travelers + SD + BU (same stage-aware pattern as needs-info)
      const nextReviewerName = nextReviewer ? nextReviewer.name : 'the AAS FO reviewer';
      var buApprCc = _buildStageCcList({
        submitterEmail: request.submitterEmail,
        travelers: emailRequest.travelers,
        sectorDirectorEmail: request.sectorDirectorEmail,
        buReviewerEmail: request.buReviewerEmail,
        currentReviewerEmail: currentUser,
        stage: 'BU'
      });
      sendApprovalNotification(requestId, emailRequest, 'BU', '', {
        approverName: reviewerName,
        nextReviewerName: nextReviewerName,
        isFinal: false
      }, buApprCc);

      // Notify next reviewer (OSO) if available
      if (nextReviewer && nextReviewer.email) {
        sendReviewerNotification(requestId, emailRequest, nextReviewer, 'OSO');
      }

      // Confirm to BU reviewer that their approval went through
      sendReviewerApprovalConfirmation(requestId, emailRequest, currentReviewer, nextReviewerName, 'BU');

    } else if (actionName === ACTION_TYPES.OSO_APPROVED) {
      // Use already-determined overhead status from the oso_approve check
      const isOverhead = !isClientPaidOsoApproval;

      if (isOverhead) {
        // Overhead travel: advancing to FAS for final review
        sendAdvancingToFasNotification(requestId, emailRequest, reviewerName);
        // Confirm to FO reviewer that their approval went through
        sendReviewerApprovalConfirmation(requestId, emailRequest, currentReviewer, 'the FAS reviewer', 'OSO');
        // Notify FAS reviewer that a request needs their review
        if (nextReviewer && nextReviewer.email) {
          sendFasReviewerNotification(requestId, emailRequest, nextReviewer);
        }
      } else {
        // Client-paid travel: approved and ready to book (no FAS needed)
        // Look up BU reviewer for contact info in the email
        const buReviewerName = request.buReviewerName || 'your BU reviewer';
        // Build consolidated CC list: travelers + approval chain
        const ccString = _buildFinalApprovalCcList({
          submitterEmail: request.submitterEmail,
          travelers: emailRequest.travelers,
          sectorDirectorEmail: request.sectorDirectorEmail,
          buReviewerEmail: request.buReviewerEmail,
          finalApproverEmail: currentUser
        });
        sendProceedWithBookingNotification(requestId, emailRequest, reviewerName, buReviewerName, ccString);
        // No reviewer confirmation for final approval (client-paid has no next reviewer)
      }

    } else if (actionName === ACTION_TYPES.FAS_APPROVED) {
      // Notify submitter of final FAS approval - ready to book
      // Build consolidated CC list: travelers + approval chain
      const ccString = _buildFinalApprovalCcList({
        submitterEmail: request.submitterEmail,
        travelers: emailRequest.travelers,
        sectorDirectorEmail: request.sectorDirectorEmail,
        buReviewerEmail: request.buReviewerEmail,
        finalApproverEmail: currentUser
      });
      sendFasApprovalNotification(requestId, emailRequest, ccString);
      // No reviewer confirmation for final FAS approval (no next reviewer)

    } else if (actionName === ACTION_TYPES.SECTOR_NEEDS_INFO) {
      // Notify submitter that more info is needed from Sector Director
      // CC travelers + SD only (request hasn't reached BU or FO yet)
      var sectorNiCc = _buildStageCcList({
        submitterEmail: request.submitterEmail,
        travelers: emailRequest.travelers,
        sectorDirectorEmail: request.sectorDirectorEmail,
        buReviewerEmail: request.buReviewerEmail,
        currentReviewerEmail: currentUser,
        stage: 'Sector'
      });
      sendNeedsInfoNotification(requestId, emailRequest, reviewerName, comments, sectionComments, 'Sector', sectorNiCc);

    } else if (actionName === ACTION_TYPES.BU_NEEDS_INFO) {
      // Notify submitter that more info is needed
      // CC travelers + SD + BU (request hasn't reached FO yet)
      var buNiCc = _buildStageCcList({
        submitterEmail: request.submitterEmail,
        travelers: emailRequest.travelers,
        sectorDirectorEmail: request.sectorDirectorEmail,
        buReviewerEmail: request.buReviewerEmail,
        currentReviewerEmail: currentUser,
        stage: 'BU'
      });
      sendNeedsInfoNotification(requestId, emailRequest, reviewerName, comments, sectionComments, 'BU', buNiCc);

    } else if (actionName === ACTION_TYPES.OSO_NEEDS_INFO) {
      // Notify submitter that more info is needed
      // CC travelers + SD + BU + AAS FO (full chain up to this point)
      var osoNiCc = _buildStageCcList({
        submitterEmail: request.submitterEmail,
        travelers: emailRequest.travelers,
        sectorDirectorEmail: request.sectorDirectorEmail,
        buReviewerEmail: request.buReviewerEmail,
        currentReviewerEmail: currentUser,
        stage: 'OSO'
      });
      sendNeedsInfoNotification(requestId, emailRequest, reviewerName, comments, sectionComments, 'AAS FO', osoNiCc);

    } else if (actionName === ACTION_TYPES.DENIED || actionName === ACTION_TYPES.FAS_DENIED) {
      // Notify submitter of denial
      const stage = actionName === ACTION_TYPES.FAS_DENIED ? 'FAS' :
                    previousStatus === STATUS_CODES.PENDING_SECTOR ? 'Sector' :
                    previousStatus === STATUS_CODES.PENDING_OSO ? 'AAS FO' : 'BU';
      sendDenialNotification(requestId, emailRequest, reviewerName, comments, stage);

    } else if (actionName === ACTION_TYPES.CANCELLED) {
      // Notify submitter of cancellation
      const stage = previousStatus === STATUS_CODES.PENDING_SECTOR ? 'Sector' :
                    previousStatus === STATUS_CODES.PENDING_OSO ? 'AAS FO' :
                    previousStatus === STATUS_CODES.PENDING_FAS ? 'FAS' : 'BU';
      sendCancellationNotification(requestId, emailRequest, reviewerName, comments || 'Request cancelled by reviewer', stage);

    } else if (actionName === ACTION_TYPES.RESUBMITTED) {
      // Notify reviewer that submitter has resubmitted with updates
      const stage = previousStatus === STATUS_CODES.NEEDS_INFO_SECTOR ? 'Sector' :
                    previousStatus === STATUS_CODES.NEEDS_INFO_OSO ? 'AAS FO' : 'BU';
      if (nextReviewer && nextReviewer.email) {
        sendResubmissionNotification(requestId, emailRequest, nextReviewer, stage);
      }

    }

    console.log(`Notification sent: ${actionName} on ${requestId}`);

  } catch (error) {
    console.error('Error sending review action notification:', error);
    // Don't throw - notification failure shouldn't block the action
  }
}
