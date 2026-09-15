/**
 * Review_DDConfirm.js
 * Division Director (DD) Go.gov confirmation workflow + funding correction.
 *
 * Exports (@client):
 * - getDDConfirmationData() — load the DD's pending travelers
 * - confirmDDTravelers() — DD marks confirmed; auto-completes request when
 *   all DDs have confirmed
 * - reportDDFundingIssue() — DD flags a funding mismatch, returns request
 *   to Pending_Correction
 * - getFundingCorrectionData() — Travel Coordinator loads the correction
 *   modal with flagged travelers + DD notes + multi-DD attribution
 * - submitFundingCorrection() — Coordinator applies corrections, only
 *   resets DD_Confirmed for corrected travelers, re-emails only affected
 *   DDs (not all DDs)
 *
 * Server-only entry points:
 * - sendDDConfirmationEmails() — invoked post-FAS-approval and from editor
 *   diagnostics; unwraps the getRequestForReview envelope inline before
 *   handing the legacy shape to _sendDDConfirmationEmailsFromData
 * - sendDDConfirmationEmailsForTravelers() — selective re-confirmation after
 *   a funding correction; only DDs whose travelers' funding changed get
 *   re-emailed
 *
 * Internal helper:
 * - _sendDDConfirmationEmailsFromData() — receives the LEGACY shape;
 *   callers (sendDDConfirmationEmails, submitReviewAction's OSO/FAS
 *   approval branch) unwrap the envelope before calling
 *
 * Companion files: Review_Read.js, Review_Action.js, Review_Update.js
 */

/**
 * Send confirmation emails to Division Directors for Go.gov verification.
 * Groups travelers by DD and sends one email per DD with a link to confirm.
 *
 * Server-only entry point — invoked from editor diagnostics or post-approval
 * triggers, not directly from @client. Unwraps the getRequestForReview
 * envelope into the legacy shape the internal _sendDDConfirmationEmailsFromData
 * helper expects (wrap-don't-rewrite, decision #2).
 *
 * @param {string} requestId - The request ID
 * @server
 */
function sendDDConfirmationEmails(requestId) {
  const envelope = getRequestForReview(requestId);
  const requestData = (envelope && envelope.success && envelope.data)
    ? Object.assign({ success: true }, envelope.data)
    : { success: false, error: envelope && envelope.error };
  return _sendDDConfirmationEmailsFromData(requestData);
}

/**
 * Send DD confirmation emails using already-loaded request data.
 *
 * Receives `requestData` in the LEGACY shape (`{success, request, travelers, ...}`),
 * not the envelope. Callers (sendDDConfirmationEmails, submitReviewAction) unwrap
 * before calling.
 *
 * @param {Object} requestData - Full request data (legacy shape, not envelope)
 * @private @server
 */
function _sendDDConfirmationEmailsFromData(requestData) {
  try {
    if (!requestData || !requestData.success) {
      throw new Error('Failed to load request data');
    }

    const request = requestData.request;
    const travelers = requestData.travelers || [];
    const requestId = request.requestId;

    if (travelers.length === 0) {
      console.log('No travelers to send DD emails for');
      return;
    }

    // Group travelers by DD email
    const ddGroups = {};
    travelers.forEach(traveler => {
      const ddEmail = traveler.ddEmail || traveler.DD_Email;
      const ddName = traveler.ddName || traveler.DD_Name || 'Division Director';

      if (!ddEmail) {
        console.warn(`Traveler ${traveler.employeeName} has no DD email`);
        return;
      }

      if (!ddGroups[ddEmail]) {
        ddGroups[ddEmail] = {
          ddName: ddName,
          ddEmail: ddEmail,
          travelers: []
        };
      }
      ddGroups[ddEmail].travelers.push(traveler);
    });

    // Get script URL for confirmation link
    const confirmUrl = getDDConfirmUrl(requestId);

    // Send email to each DD using unified TravelEmailService
    const ddEmails = Object.keys(ddGroups);
    console.log(`Sending DD confirmation emails to ${ddEmails.length} DDs`);

    ddEmails.forEach(ddEmail => {
      const group = ddGroups[ddEmail];
      try {
        const result = sendDDConfirmationEmail(group, request, confirmUrl);
        if (result.success) {
          console.log(`Sent DD confirmation email to ${ddEmail} for ${group.travelers.length} traveler(s)`);
        } else {
          console.error(`Failed to send email to ${ddEmail}:`, result.error);
        }
      } catch (mailError) {
        console.error(`Failed to send email to ${ddEmail}:`, mailError);
      }
    });

  } catch (error) {
    console.error('Error sending DD confirmation emails:', error);
    throw error;
  }
}

/**
 * Send DD confirmation emails only for specific travelers.
 * Used after funding corrections to notify only affected DDs.
 *
 * Internal helper — not @client; called by reportDDFundingIssue + funding
 * correction flow. Unwraps the getRequestForReview envelope into the legacy
 * shape inline.
 *
 * @param {string} requestId - The request ID
 * @param {string[]} travelerIds - Array of traveler IDs whose DDs should be notified
 * @private @server
 */
function sendDDConfirmationEmailsForTravelers(requestId, travelerIds) {
  try {
    if (!travelerIds || travelerIds.length === 0) {
      console.log('No travelers specified for DD notification');
      return;
    }

    // Load request and travelers (unwrap envelope into legacy shape)
    const envelope = getRequestForReview(requestId);
    if (!envelope || !envelope.success || !envelope.data) {
      throw new Error('Failed to load request data');
    }
    const requestData = Object.assign({ success: true }, envelope.data);

    const request = requestData.request;
    const allTravelers = requestData.travelers || [];

    // Filter to only the specified travelers
    const targetTravelerSet = new Set(travelerIds);
    const targetTravelers = allTravelers.filter(t =>
      targetTravelerSet.has(t.travelerId || t.Traveler_ID)
    );

    if (targetTravelers.length === 0) {
      console.log('No matching travelers found for DD notification');
      return;
    }

    // Group by DD email (only for target travelers)
    const ddGroups = {};
    targetTravelers.forEach(traveler => {
      const ddEmail = traveler.ddEmail || traveler.DD_Email;
      const ddName = traveler.ddName || traveler.DD_Name || 'Division Director';

      if (!ddEmail) {
        console.warn(`Traveler ${traveler.employeeName} has no DD email`);
        return;
      }

      if (!ddGroups[ddEmail]) {
        ddGroups[ddEmail] = {
          ddName: ddName,
          ddEmail: ddEmail,
          travelers: []
        };
      }
      ddGroups[ddEmail].travelers.push(traveler);
    });

    // Get script URL for confirmation link
    const confirmUrl = getDDConfirmUrl(requestId);

    // Send email to each affected DD
    const ddEmails = Object.keys(ddGroups);
    console.log(`Sending DD confirmation emails to ${ddEmails.length} DDs for ${targetTravelers.length} corrected travelers`);

    ddEmails.forEach(ddEmail => {
      const group = ddGroups[ddEmail];
      try {
        // Use unified TravelEmailService for re-confirmation emails
        const result = sendDDReconfirmationEmail(group, request, confirmUrl);
        if (result.success) {
          console.log(`Sent DD re-confirmation email to ${ddEmail} for ${group.travelers.length} corrected traveler(s)`);
        } else {
          console.error(`Failed to send email to ${ddEmail}:`, result.error);
        }
      } catch (mailError) {
        console.error(`Failed to send email to ${ddEmail}:`, mailError);
      }
    });

  } catch (error) {
    console.error('Error sending DD confirmation emails for specific travelers:', error);
    throw error;
  }
}

/**
 * Get travelers pending DD confirmation for the current user.
 * Used by the DD confirmation page.
 *
 * @param {string} requestId - The request ID
 * @returns {Object} successResponse({ request, travelers, allConfirmed }) or errorResponse(msg)
 * @client
 */
function getDDConfirmationData(requestId) {
  try {
    const currentUserEmail = Session.getActiveUser().getEmail().toLowerCase();

    // Load request data via envelope, unwrap inline
    const envelope = getRequestForReview(requestId);
    if (!envelope || !envelope.success || !envelope.data) {
      return errorResponse('Request not found');
    }
    const requestData = envelope.data;
    const request = requestData.request;

    // Check if request is in a status that requires DD confirmation
    const validStatuses = [STATUS_CODES.APPROVED_GOGOV, STATUS_CODES.PENDING_DD_CONFIRMATION];
    if (!validStatuses.includes(request.status)) {
      return errorResponse('Request is not pending DD confirmation');
    }

    // Get all travelers and filter to those assigned to this DD
    const allTravelers = requestData.travelers || [];
    const myTravelers = allTravelers.filter(t => {
      const ddEmail = (t.ddEmail || t.DD_Email || '').toLowerCase();
      return ddEmail === currentUserEmail;
    });

    if (myTravelers.length === 0) {
      return errorResponse('No travelers assigned to you for this request');
    }

    // Check if all travelers (across all DDs) are confirmed
    const allConfirmed = allTravelers.every(t => t.ddConfirmed === true || t.DD_Confirmed === true);

    return successResponse({
      request: {
        requestId: request.requestId,
        tripName: request.tripName,
        eventStartDate: request.eventStartDate,
        eventEndDate: request.eventEndDate,
        submitterName: request.submitterName,
        grandTotal: request.grandTotal
      },
      travelers: myTravelers.map(t => ({
        travelerId: t.travelerId,
        employeeName: t.employeeName || t.name,
        email: t.email,
        isClientPaid: t.isClientPaid,
        subtotal: t.subtotal,
        ddConfirmed: t.ddConfirmed === true || t.DD_Confirmed === true
      })),
      allConfirmed: allConfirmed
    });

  } catch (error) {
    logError('getDDConfirmationData', error, { requestId: requestId });
    return errorResponse(error.message || 'Failed to load DD confirmation data');
  }
}

/**
 * Confirm travelers for DD (mark as confirmed in Go.gov).
 * Called when DD clicks confirm button.
 *
 * @param {string} requestId - The request ID
 * @param {string[]} travelerIds - Array of traveler IDs to confirm (or empty for all)
 * @returns {Object} successResponse({ confirmedCount, allConfirmed }) or errorResponse(msg)
 * @client
 */
function confirmDDTravelers(requestId, travelerIds) {
  try {
    const currentUserEmail = Session.getActiveUser().getEmail().toLowerCase();
    const now = new Date();

    const db = new TravelDB();
    const travelersSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);

    if (!travelersSheet || !requestsSheet) {
      throw new Error('Required sheets not found');
    }

    const travelersData = travelersSheet.getDataRange().getValues();
    const headers = travelersData[0];
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });

    // DD_Confirmed and DD_Confirmed_At are adjacent in the schema, so a
    // single setValues() writes both per row. Two-call fallback below if
    // the schema ever reorders.
    const ddConfirmedCol = idx['DD_Confirmed'];
    const ddConfirmedAtCol = idx['DD_Confirmed_At'];
    const ddConfirmAdjacent = ddConfirmedAtCol === ddConfirmedCol + 1;

    let updatedCount = 0;
    // Tracked in-memory so we don't need a second sheet read after the
    // updates land. Stays true only if every row for this request is
    // confirmed (either originally or via this call).
    let actuallyAllConfirmed = true;
    let foundAnyRow = false;

    for (let i = 1; i < travelersData.length; i++) {
      if (travelersData[i][idx['Request_ID']] !== requestId) continue;
      foundAnyRow = true;

      const travelerId = travelersData[i][idx['Traveler_ID']];
      const ddEmail = (travelersData[i][idx['DD_Email']] || '').toLowerCase();
      const wasConfirmed = travelersData[i][ddConfirmedCol] === true;

      if (ddEmail === currentUserEmail) {
        const targetingThis = !travelerIds || travelerIds.length === 0 || travelerIds.includes(travelerId);
        if (targetingThis && !wasConfirmed) {
          if (ddConfirmAdjacent) {
            travelersSheet.getRange(i + 1, ddConfirmedCol + 1, 1, 2).setValues([[true, now]]);
          } else {
            travelersSheet.getRange(i + 1, ddConfirmedCol + 1).setValue(true);
            travelersSheet.getRange(i + 1, ddConfirmedAtCol + 1).setValue(now);
          }
          updatedCount++;
          continue; // this row is now confirmed → don't flag as missing
        }
        if (!wasConfirmed && !targetingThis) actuallyAllConfirmed = false;
      } else if (!wasConfirmed) {
        actuallyAllConfirmed = false;
      }
    }

    console.log(`DD ${currentUserEmail} confirmed ${updatedCount} travelers for request ${requestId}`);

    // If every traveler row is now confirmed, mark the request COMPLETED.
    // The in-memory tracking above replaces the previous re-read of the
    // travelers sheet — we already know the post-update state.
    if (foundAnyRow && actuallyAllConfirmed) {
      const reqData = requestsSheet.getDataRange().getValues();
      const reqIdx = {};
      reqData[0].forEach((h, i) => { reqIdx[h] = i; });
      const statusCol = reqIdx['Status'];
      const updatedAtCol = reqIdx['Updated_At'];
      const reqAdjacent = updatedAtCol === statusCol + 1;

      for (let i = 1; i < reqData.length; i++) {
        if (reqData[i][reqIdx['Request_ID']] === requestId) {
          if (reqAdjacent) {
            requestsSheet.getRange(i + 1, statusCol + 1, 1, 2).setValues([[STATUS_CODES.COMPLETED, now]]);
          } else {
            requestsSheet.getRange(i + 1, statusCol + 1).setValue(STATUS_CODES.COMPLETED);
            requestsSheet.getRange(i + 1, updatedAtCol + 1).setValue(now);
          }
          console.log(`All DDs confirmed - request ${requestId} marked as COMPLETED`);
          break;
        }
      }

      const approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
      if (approvalLogSheet) {
        approvalLogSheet.appendRow([
          generateLogId(),
          requestId,
          ACTION_TYPES.ALL_DD_CONFIRMED,
          'System', '', 'System',
          now,
          STATUS_CODES.APPROVED_GOGOV, STATUS_CODES.COMPLETED,
          'All Division Directors confirmed Go.gov funding',
          '', '', '', ''
        ]);
      }
    }

    // Invalidate caches so the portal/review page reflects the new state
    // on next read.
    db.invalidate(SHEET_NAMES.REQUEST_TRAVELERS);
    if (foundAnyRow && actuallyAllConfirmed) {
      db.invalidate(SHEET_NAMES.REQUESTS);
      db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    }
    try { CacheService.getScriptCache().remove('request_review_v2_' + requestId); } catch (ce) { /* ignore */ }

    return successResponse({
      confirmedCount: updatedCount,
      allConfirmed: foundAnyRow && actuallyAllConfirmed
    });

  } catch (error) {
    logError('confirmDDTravelers', error, { requestId: requestId });
    return errorResponse(error.message || 'Failed to confirm DD travelers');
  }
}


/**
 * Report a funding mismatch issue from DD confirmation page.
 * Updates request status and sends email notification to the submitter/Travel Coordinator.
 *
 * @param {string} requestId - The request ID
 * @param {string} description - Description of the issue
 * @param {Array} flaggedTravelers - Array of {travelerId, employeeName, currentFunding}
 * @returns {Object} successResponse({}) or errorResponse(msg)
 * @client
 */
function reportDDFundingIssue(requestId, description, flaggedTravelers) {
  try {
    const currentUser = Session.getActiveUser().getEmail();
    const currentUserName = formatUserName(currentUser);
    const now = new Date();

    const db = new TravelDB();
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);

    if (!requestsSheet) {
      throw new Error('Requests sheet not found');
    }

    // Get request data and update status
    const requestsData = requestsSheet.getDataRange().getValues();
    const headers = requestsData[0];
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });

    let request = null;
    let requestRowIndex = -1;
    let previousStatus = '';
    let existingFlaggedJson = '[]';
    let existingNotes = '';
    for (let i = 1; i < requestsData.length; i++) {
      if (requestsData[i][idx['Request_ID']] === requestId) {
        previousStatus = requestsData[i][idx['Status']] || '';
        existingFlaggedJson = requestsData[i][idx['DD_Flagged_Travelers']] || '[]';
        existingNotes = requestsData[i][idx['DD_Issue_Notes']] || '';
        request = {
          requestId: requestId,
          tripName: requestsData[i][idx['Trip_Name']] || 'Travel Request',
          submitterEmail: requestsData[i][idx['Submitter_Email']] || '',
          submitterName: requestsData[i][idx['Submitter_Name']] || '',
          eventStartDate: requestsData[i][idx['Event_Start_Date']] || '',
          eventEndDate: requestsData[i][idx['Event_End_Date']] || ''
        };
        requestRowIndex = i + 1; // 1-based for sheet operations
        break;
      }
    }

    if (!request) {
      throw new Error('Request not found');
    }

    if (!request.submitterEmail) {
      throw new Error('Submitter email not found');
    }

    // Parse existing flagged travelers and merge with new ones (for multi-DD scenarios)
    let existingFlagged = [];
    try {
      existingFlagged = JSON.parse(existingFlaggedJson) || [];
    } catch (e) {
      existingFlagged = [];
    }

    // Add reporter info to each flagged traveler for tracking who flagged whom
    const newFlagged = (flaggedTravelers || []).map(t => ({
      ...t,
      flaggedBy: currentUser,
      flaggedByName: currentUserName,
      flaggedAt: now.toISOString()
    }));

    // Merge: replace existing flags for same travelers, add new ones
    const mergedFlagged = [...existingFlagged];
    newFlagged.forEach(newT => {
      const existingIdx = mergedFlagged.findIndex(e => e.travelerId === newT.travelerId);
      if (existingIdx >= 0) {
        mergedFlagged[existingIdx] = newT; // Update existing flag
      } else {
        mergedFlagged.push(newT); // Add new flag
      }
    });

    // Merge notes: append new notes with DD attribution
    const noteEntry = `[${currentUserName}]: ${description}`;
    const mergedNotes = existingNotes ? `${existingNotes}\n---\n${noteEntry}` : noteEntry;

    // Update request status to Pending_Correction and store flagged data
    if (requestRowIndex > 0) {
      // Update status (column is named 'Status' not 'Request_Status')
      if (idx['Status'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, idx['Status'] + 1).setValue(STATUS_CODES.PENDING_CORRECTION);
      }

      // Store merged flagged travelers as JSON (create column if needed)
      let flaggedCol = idx['DD_Flagged_Travelers'];
      if (flaggedCol === undefined) {
        // Add column at end
        const lastCol = headers.length + 1;
        requestsSheet.getRange(1, lastCol).setValue('DD_Flagged_Travelers');
        flaggedCol = lastCol - 1;
      }
      requestsSheet.getRange(requestRowIndex, flaggedCol + 1).setValue(JSON.stringify(mergedFlagged));

      // Store merged DD issue notes (create column if needed)
      let notesCol = idx['DD_Issue_Notes'];
      if (notesCol === undefined) {
        const lastCol = requestsSheet.getLastColumn() + 1;
        requestsSheet.getRange(1, lastCol).setValue('DD_Issue_Notes');
        notesCol = lastCol - 1;
      }
      requestsSheet.getRange(requestRowIndex, notesCol + 1).setValue(mergedNotes);

      // Store reporting DD info (append for multi-DD)
      let reporterCol = idx['DD_Issue_Reporter'];
      if (reporterCol === undefined) {
        const lastCol = requestsSheet.getLastColumn() + 1;
        requestsSheet.getRange(1, lastCol).setValue('DD_Issue_Reporter');
        reporterCol = lastCol - 1;
      }
      const existingReporter = requestsData[requestRowIndex - 1][reporterCol] || '';
      const newReporter = currentUserName + ' (' + currentUser + ')';
      const mergedReporter = existingReporter && !existingReporter.includes(currentUser)
        ? `${existingReporter}; ${newReporter}`
        : newReporter;
      requestsSheet.getRange(requestRowIndex, reporterCol + 1).setValue(mergedReporter);

      console.log(`Updated request ${requestId} status to Pending_Correction with ${mergedFlagged.length} total flagged travelers`);
    }

    // Send email using unified TravelEmailService
    const reporter = {
      name: currentUserName,
      email: currentUser
    };

    const emailResult = sendDDFundingIssueEmail(request, reporter, flaggedTravelers, description);
    if (!emailResult.success) {
      console.error(`Failed to send funding issue email: ${emailResult.error}`);
    }

    console.log(`DD funding issue reported for ${requestId} by ${currentUser} - ${flaggedTravelers?.length || 0} travelers flagged`);

    // Log the issue report with proper status tracking
    const approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
    if (approvalLogSheet) {
      const logId = generateLogId();
      const flaggedNames = (flaggedTravelers || []).map(t => t.employeeName).join(', ');
      // Store flagged traveler IDs in snapshot for audit trail
      const snapshotData = JSON.stringify({
        flaggedTravelerIds: (flaggedTravelers || []).map(t => t.travelerId),
        flaggedBy: currentUser
      });
      approvalLogSheet.appendRow([
        logId,
        requestId,
        'DD_Issue_Reported',
        currentUserName,
        currentUser,
        'Division_Director',
        now,
        previousStatus,
        STATUS_CODES.PENDING_CORRECTION,
        `Funding issue reported for: ${flaggedNames}. Description: ${description.substring(0, 150)}`,
        '',
        snapshotData,
        '',
        ''
      ]);
    }

    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    try { CacheService.getScriptCache().remove('request_review_v2_' + requestId); } catch (ce) { /* ignore */ }

    return successResponse({});

  } catch (error) {
    logError('reportDDFundingIssue', error, { requestId: requestId });
    return errorResponse(error.message || 'Failed to report DD funding issue');
  }
}

/**
 * Get funding correction data for a Pending_Correction request.
 * Returns flagged travelers and DD notes for the correction modal.
 *
 * @param {string} requestId - The request ID
 * @returns {Object} successResponse({ tripName, flaggedTravelers, ddNotes, ddReporter }) or errorResponse(msg)
 * @client
 */
function getFundingCorrectionData(requestId) {
  try {
    const db = new TravelDB();
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
    const travelersSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);

    if (!requestsSheet) {
      throw new Error('Requests sheet not found');
    }

    // Get request data
    const requestsData = requestsSheet.getDataRange().getValues();
    const headers = requestsData[0];
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });

    let request = null;
    for (let i = 1; i < requestsData.length; i++) {
      if (requestsData[i][idx['Request_ID']] === requestId) {
        request = {
          tripName: requestsData[i][idx['Trip_Name']] || 'Travel Request',
          status: requestsData[i][idx['Status']] || '',
          flaggedTravelersJson: requestsData[i][idx['DD_Flagged_Travelers']] || '[]',
          ddNotes: requestsData[i][idx['DD_Issue_Notes']] || '',
          ddReporter: requestsData[i][idx['DD_Issue_Reporter']] || ''
        };
        break;
      }
    }

    if (!request) {
      throw new Error('Request not found');
    }

    if (request.status !== STATUS_CODES.PENDING_CORRECTION) {
      throw new Error('Request is not pending correction');
    }

    // Parse flagged travelers
    let flaggedTravelers = [];
    try {
      flaggedTravelers = JSON.parse(request.flaggedTravelersJson);
    } catch (e) {
      console.warn('Could not parse flagged travelers JSON:', e);
    }

    // Get full traveler data for each flagged traveler
    if (travelersSheet && flaggedTravelers.length > 0) {
      const travelersData = travelersSheet.getDataRange().getValues();
      const tHeaders = travelersData[0];
      const tIdx = {};
      tHeaders.forEach((h, i) => { tIdx[h] = i; });

      const flaggedIds = flaggedTravelers.map(t => t.travelerId);

      flaggedTravelers = flaggedTravelers.map(flagged => {
        // Find full traveler record
        for (let i = 1; i < travelersData.length; i++) {
          if (travelersData[i][tIdx['Traveler_ID']] === flagged.travelerId) {
            return {
              travelerId: flagged.travelerId,
              employeeName: travelersData[i][tIdx['Employee_Name']] || flagged.employeeName,
              currentFunding: travelersData[i][tIdx['Is_Client_Paid']] || flagged.currentFunding,
              // Preserve flaggedBy info from multi-DD tracking
              flaggedBy: flagged.flaggedBy || '',
              flaggedByName: flagged.flaggedByName || '',
              flaggedAt: flagged.flaggedAt || ''
            };
          }
        }
        return flagged;
      });
    }

    return successResponse({
      tripName: request.tripName,
      flaggedTravelers: flaggedTravelers,
      ddNotes: request.ddNotes,
      ddReporter: request.ddReporter
    });

  } catch (error) {
    logError('getFundingCorrectionData', error, { requestId: requestId });
    return errorResponse(error.message || 'Failed to load funding correction data');
  }
}


/**
 * Submit funding corrections and resubmit for DD confirmation.
 * Only resets DD_Confirmed for corrected travelers and only notifies their DDs.
 *
 * @param {string} requestId - The request ID
 * @param {Array} corrections - Array of { travelerId, newFunding }
 * @returns {Object} successResponse({}) or errorResponse(msg)
 * @client
 */
function submitFundingCorrection(requestId, corrections) {
  try {
    const currentUser = Session.getActiveUser().getEmail();
    const currentUserName = formatUserName(currentUser);
    const now = new Date();

    const db = new TravelDB();
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
    const travelersSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);

    if (!requestsSheet || !travelersSheet) {
      throw new Error('Required sheets not found');
    }

    // Get request data
    const requestsData = requestsSheet.getDataRange().getValues();
    const rHeaders = requestsData[0];
    const rIdx = {};
    rHeaders.forEach((h, i) => { rIdx[h] = i; });

    let requestRowIndex = -1;
    let request = null;
    let previousStatus = '';
    for (let i = 1; i < requestsData.length; i++) {
      if (requestsData[i][rIdx['Request_ID']] === requestId) {
        previousStatus = requestsData[i][rIdx['Status']] || '';
        request = {
          tripName: requestsData[i][rIdx['Trip_Name']] || 'Travel Request',
          ddReporter: requestsData[i][rIdx['DD_Issue_Reporter']] || '',
          eventStartDate: requestsData[i][rIdx['Event_Start_Date']] || '',
          eventEndDate: requestsData[i][rIdx['Event_End_Date']] || ''
        };
        requestRowIndex = i + 1;
        break;
      }
    }

    if (!request || requestRowIndex < 0) {
      throw new Error('Request not found');
    }

    // Update traveler funding - track DD emails for affected travelers
    const travelersData = travelersSheet.getDataRange().getValues();
    const tHeaders = travelersData[0];
    const tIdx = {};
    tHeaders.forEach((h, i) => { tIdx[h] = i; });

    const correctionMap = {};
    corrections.forEach(c => { correctionMap[c.travelerId] = c.newFunding; });

    const correctedNames = [];
    const correctedTravelerIds = [];
    const affectedDDEmails = new Set(); // Track unique DD emails for notification

    for (let i = 1; i < travelersData.length; i++) {
      const travelerId = travelersData[i][tIdx['Traveler_ID']];
      if (correctionMap[travelerId]) {
        const rowIndex = i + 1;
        // Update Is_Client_Paid
        if (tIdx['Is_Client_Paid'] !== undefined) {
          travelersSheet.getRange(rowIndex, tIdx['Is_Client_Paid'] + 1).setValue(correctionMap[travelerId]);
        }
        // Reset DD_Confirmed to false ONLY for corrected travelers
        if (tIdx['DD_Confirmed'] !== undefined) {
          travelersSheet.getRange(rowIndex, tIdx['DD_Confirmed'] + 1).setValue(false);
        }
        // Clear DD_Confirmed_At as well
        if (tIdx['DD_Confirmed_At'] !== undefined) {
          travelersSheet.getRange(rowIndex, tIdx['DD_Confirmed_At'] + 1).setValue('');
        }
        correctedNames.push(travelersData[i][tIdx['Employee_Name']] || travelerId);
        correctedTravelerIds.push(travelerId);

        // Track the DD email for this traveler
        const ddEmail = travelersData[i][tIdx['DD_Email']];
        if (ddEmail) {
          affectedDDEmails.add(ddEmail.toLowerCase());
        }
      }
    }

    // Update request status back to Pending_DD_Confirmation
    if (rIdx['Status'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, rIdx['Status'] + 1).setValue(STATUS_CODES.PENDING_DD_CONFIRMATION);
    }

    // Clear the flagged data (correction complete)
    if (rIdx['DD_Flagged_Travelers'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, rIdx['DD_Flagged_Travelers'] + 1).setValue('');
    }
    if (rIdx['DD_Issue_Notes'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, rIdx['DD_Issue_Notes'] + 1).setValue('');
    }
    if (rIdx['DD_Issue_Reporter'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, rIdx['DD_Issue_Reporter'] + 1).setValue('');
    }

    // Log the correction with proper status tracking
    const approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
    if (approvalLogSheet) {
      const logId = generateLogId();
      const snapshotData = JSON.stringify({
        correctedTravelerIds: correctedTravelerIds,
        corrections: corrections,
        affectedDDEmails: Array.from(affectedDDEmails)
      });
      approvalLogSheet.appendRow([
        logId,
        requestId,
        'Funding_Corrected',
        currentUserName,
        currentUser,
        'Travel_Coordinator',
        now,
        previousStatus,
        STATUS_CODES.PENDING_DD_CONFIRMATION,
        `Funding corrected for: ${correctedNames.join(', ')}. Resubmitted for DD confirmation.`,
        '',
        snapshotData,
        '',
        ''
      ]);
    }

    // Send DD confirmation emails ONLY to affected DDs (not all DDs)
    try {
      sendDDConfirmationEmailsForTravelers(requestId, correctedTravelerIds);
    } catch (emailErr) {
      console.warn('Could not send DD confirmation emails:', emailErr);
    }

    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.REQUEST_TRAVELERS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    try { CacheService.getScriptCache().remove('request_review_v2_' + requestId); } catch (ce) { /* ignore */ }

    console.log(`Funding correction submitted for ${requestId} - ${correctedNames.length} travelers updated, ${affectedDDEmails.size} DDs notified`);

    return successResponse({ correctedCount: correctedNames.length });

  } catch (error) {
    logError('submitFundingCorrection', error, { requestId: requestId });
    return errorResponse(error.message || 'Failed to submit funding correction');
  }
}
