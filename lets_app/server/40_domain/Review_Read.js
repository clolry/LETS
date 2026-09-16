/**
 * Review_Read.js
 * Read path for the review workflow.
 *
 * Exports:
 * - getRequestForReview() @client — load complete request data for reviewer
 *   (cached envelope, recomputes permissions per-user on cache hit)
 * - formatDateValue() @server — cross-domain date formatter (called from
 *   Admin.js + ReviewerDashboard.js; DO NOT change return shape)
 * - getAvailableActions() @server — pure helper used by both fresh and
 *   cache-hit paths in getRequestForReview
 *
 * Companion files: Review_Action.js, Review_Update.js, Review_DDConfirm.js
 */

/**
 * Load complete request data for review
 * Fetches from all related sheets and returns unified object
 *
 * Cache shape: the CacheService entry stores the FULL successResponse envelope
 * (not just the inner `.data`). On a cache hit, permissions inside
 * `envelope.data.permissions` are recomputed per-user before returning.
 *
 * @param {string} requestId - The request ID (e.g., REQ-2025-0001)
 * @param {TravelDB} [db] - Optional TravelDB instance (creates one if not provided)
 * @returns {Object} successResponse({ request, legs, travelers, attachments, approvalLog, permissions }) or errorResponse(msg)
 * @client
 */
function getRequestForReview(requestId, db) {
  const _timer = 'getRequestForReview(' + requestId + ')';
  console.time(_timer);
  try {
    if (!requestId) {
      throw new Error('Request ID is required');
    }

    // ========== CacheService: return cached envelope for standalone calls ==========
    // NOTE: Only request data is cached (shared across users). Permissions are
    // always computed fresh because they depend on who is viewing the request.
    const cache = CacheService.getScriptCache();
    const cacheKey = 'request_review_v2_' + requestId;
    const isChainedCall = !!db; // db passed = called from submitReviewAction, skip cache read

    if (!isChainedCall) {
      const cached = cache.get(cacheKey);
      if (cached) {
        console.log('getRequestForReview CACHE HIT for ' + requestId);
        // Cache holds the full envelope; re-compute permissions for current user
        const cachedEnvelope = JSON.parse(cached);
        const cachedData = cachedEnvelope.data || {};
        const cachedRequest = cachedData.request || {};
        const currentUser = Session.getActiveUser().getEmail() || '';
        const currentUserLower = currentUser.toLowerCase();
        const reviewerEmailLower = (cachedRequest.currentReviewerEmail || '').toLowerCase();
        const submitterEmailLower = (cachedRequest.submitterEmail || '').toLowerCase();
        const isCurrentReviewer = currentUserLower === reviewerEmailLower && reviewerEmailLower !== '';
        const isSubmitter = currentUserLower === submitterEmailLower;
        cachedData.permissions = {
          isCurrentReviewer: isCurrentReviewer,
          isSubmitter: isSubmitter,
          availableActions: getAvailableActions(cachedRequest.status, isCurrentReviewer, isSubmitter)
        };
        console.timeEnd(_timer);
        return cachedEnvelope;
      }
    }

    db = db || new TravelDB();

    // ========== Load Request (main record) ==========
    const { headers: requestHeaders, rows: requestRows, headerIndex: reqIndex } = db.readSheet(SHEET_NAMES.REQUESTS);
    if (requestHeaders.length === 0) {
      throw new Error('Requests sheet not found');
    }

    let requestRow = null;

    // Normalize the search ID and find the request
    const searchId = String(requestId).trim();
    for (let i = 0; i < requestRows.length; i++) {
      const rowId = String(requestRows[i][0] || '').trim();
      if (rowId === searchId) {
        requestRow = requestRows[i];
        break;
      }
    }

    if (!requestRow) {
      throw new Error(`Request ${requestId} not found`);
    }

    // Map request data
    const request = {
      requestId: requestRow[reqIndex['Request_ID']] || '',
      status: requestRow[reqIndex['Status']] || '',
      tripName: requestRow[reqIndex['Trip_Name']] || '',
      locationType: requestRow[reqIndex['Location_Type']] || '',
      eventStartDate: formatDateValue(requestRow[reqIndex['Event_Start_Date']]),
      eventEndDate: formatDateValue(requestRow[reqIndex['Event_End_Date']]),
      isInternational: requestRow[reqIndex['Is_International']] || false,
      isOCONUS: requestRow[reqIndex['Is_OCONUS']] || false,
      bluf: requestRow[reqIndex['BLUF']] || '',
      purpose: requestRow[reqIndex['Purpose']] || '',
      travelTypes: safeJsonParse(requestRow[reqIndex['Travel_Types']], []),
      missionCriticalTypes: safeJsonParse(requestRow[reqIndex['Mission_Critical_Types']], []),
      sharedCosts: {
        facilities: {
          amount: parseFloat(requestRow[reqIndex['Shared_Facilities']]) || 0,
          description: requestRow[reqIndex['Shared_Facilities_Desc']] || ''
        },
        audioVisual: {
          amount: parseFloat(requestRow[reqIndex['Shared_AV']]) || 0,
          description: requestRow[reqIndex['Shared_AV_Desc']] || ''
        },
        logistics: {
          amount: parseFloat(requestRow[reqIndex['Shared_Logistics']]) || 0,
          description: requestRow[reqIndex['Shared_Logistics_Desc']] || ''
        },
        other: {
          amount: parseFloat(requestRow[reqIndex['Shared_Other']]) || 0,
          description: requestRow[reqIndex['Shared_Other_Desc']] || ''
        }
      },
      sharedTotal: parseFloat(requestRow[reqIndex['Shared_Total']]) || 0,
      travelerTotal: parseFloat(requestRow[reqIndex['Traveler_Total']]) || 0,
      grandTotal: parseFloat(requestRow[reqIndex['Grand_Total']]) || 0,
      travelerCount: parseInt(requestRow[reqIndex['Traveler_Count']]) || 0,
      legCount: parseInt(requestRow[reqIndex['Leg_Count']]) || 0,
      submitterName: requestRow[reqIndex['Submitter_Name']] || '',
      submitterEmail: requestRow[reqIndex['Submitter_Email']] || '',
      submitterBU: requestRow[reqIndex['Submitter_BU']] || '',
      submitterOrgCode: requestRow[reqIndex['Submitter_Org_Code']] || '',
      sectorDirectorName: requestRow[reqIndex['Sector_Director_Name']] || '',
      sectorDirectorEmail: requestRow[reqIndex['Sector_Director_Email']] || '',
      buReviewerName: requestRow[reqIndex['BU_Reviewer_Name']] || '',
      buReviewerEmail: requestRow[reqIndex['BU_Reviewer_Email']] || '',
      currentReviewerName: requestRow[reqIndex['Current_Reviewer_Name']] || '',
      currentReviewerEmail: requestRow[reqIndex['Current_Reviewer_Email']] || '',
      initialReviewLevel: requestRow[reqIndex['Initial_Review_Level']] || '',
      attachmentsFolder: requestRow[reqIndex['Attachments_Folder']] || '',
      salesforceLink: requestRow[reqIndex['Salesforce_Link']] || '',
      createdAt: formatDateValue(requestRow[reqIndex['Created_At']]),
      updatedAt: formatDateValue(requestRow[reqIndex['Updated_At']]),
      submittedAt: formatDateValue(requestRow[reqIndex['Submitted_At']]),
      version: parseInt(requestRow[reqIndex['Version']]) || 1
    };

    // ========== Load Legs ==========
    const { rows: legsRows, headerIndex: legIndex } = db.readSheet(SHEET_NAMES.REQUEST_LEGS);
    const legs = [];

    for (let i = 0; i < legsRows.length; i++) {
      if (legsRows[i][legIndex['Request_ID']] === requestId) {
        legs.push({
          legId: legsRows[i][legIndex['Leg_ID']] || '',
          legNumber: parseInt(legsRows[i][legIndex['Leg_Number']]) || 0,
          siteName: legsRows[i][legIndex['Site_Name']] || '',
          city: legsRows[i][legIndex['City']] || '',
          state: legsRows[i][legIndex['State']] || '',
          country: legsRows[i][legIndex['Country']] || '',
          startDate: formatDateValue(legsRows[i][legIndex['Start_Date']]),
          endDate: formatDateValue(legsRows[i][legIndex['End_Date']]),
          isInternational: legsRows[i][legIndex['Is_International']] || false,
          isOCONUS: legsRows[i][legIndex['Is_OCONUS']] || false,
          perDiemSource: legsRows[i][legIndex['Per_Diem_Source']] || 'GSA',
          lodgingRate: parseFloat(legsRows[i][legIndex['Lodging_Rate']]) || 0,
          mieRate: parseFloat(legsRows[i][legIndex['MIE_Rate']]) || 0,
          locationDisplay: legsRows[i][legIndex['Location_Display']] || ''
        });
      }
    }

    // Sort legs by leg number
    legs.sort((a, b) => a.legNumber - b.legNumber);

    // ========== Load Travelers ==========
    const { rows: travelersRows, headerIndex: travelerIndex } = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
    const travelers = [];

    for (let i = 0; i < travelersRows.length; i++) {
      if (travelersRows[i][travelerIndex['Request_ID']] === requestId) {
        travelers.push({
          travelerId: travelersRows[i][travelerIndex['Traveler_ID']] || '',
          employeeId: travelersRows[i][travelerIndex['Employee_ID']] || '',
          employeeName: travelersRows[i][travelerIndex['Employee_Name']] || '',
          email: travelersRows[i][travelerIndex['Email']] || '',
          orgCode: travelersRows[i][travelerIndex['Org_Code']] || '',
          businessUnit: travelersRows[i][travelerIndex['Business_Unit']] || '',
          lcat: travelersRows[i][travelerIndex['LCAT']] || '',
          ddName: travelersRows[i][travelerIndex['DD_Name']] || '',
          ddEmail: travelersRows[i][travelerIndex['DD_Email']] || '',
          dutyLocation: travelersRows[i][travelerIndex['Duty_Location']] || '',
          dutyLocationCode: travelersRows[i][travelerIndex['Duty_Location_Code']] || '',
          attendingLegs: (travelersRows[i][travelerIndex['Attending_Legs']] || '').split(',').filter(l => l),
          transportMode: travelersRows[i][travelerIndex['Transport_Mode']] || '',
          ticketCost: parseFloat(travelersRows[i][travelerIndex['Ticket_Cost']]) || 0,
          totalMiles: parseFloat(travelersRows[i][travelerIndex['Total_Miles']]) || 0,
          mileageRate: parseFloat(travelersRows[i][travelerIndex['Mileage_Rate']]) || 0,
          needsRentalCar: travelersRows[i][travelerIndex['Needs_Rental_Car']] === true || travelersRows[i][travelerIndex['Needs_Rental_Car']] === 'true',
          rentalCarCost: parseFloat(travelersRows[i][travelerIndex['Rental_Car_Cost']]) || 0,
          transportationTotal: parseFloat(travelersRows[i][travelerIndex['Transportation_Total']]) || 0,
          lodgingTotal: parseFloat(travelersRows[i][travelerIndex['Lodging_Total']]) || 0,
          mieTotal: parseFloat(travelersRows[i][travelerIndex['MIE_Total']]) || 0,
          localTravelTotal: parseFloat(travelersRows[i][travelerIndex['Local_Travel_Total']]) || 0,
          otherPercentage: parseFloat(travelersRows[i][travelerIndex['Other_Percentage']]) || 15,
          otherTotal: parseFloat(travelersRows[i][travelerIndex['Other_Total']]) || 0,
          subtotal: parseFloat(travelersRows[i][travelerIndex['Subtotal']]) || 0,
          isClientPaid: travelersRows[i][travelerIndex['Is_Client_Paid']] || '',
          roleJustification: travelersRows[i][travelerIndex['Role_Justification']] || '',
          isFullTimeTelework: travelersRows[i][travelerIndex['Is_Full_Time_Telework']] || false,
          normalCommuteDistance: parseFloat(travelersRows[i][travelerIndex['Normal_Commute_Distance']]) || 0,
          normalCommuteParking: parseFloat(travelersRows[i][travelerIndex['Normal_Commute_Parking']]) || 0,
          hasSecurityClearance: travelersRows[i][travelerIndex['Has_Security_Clearance']] || false,
          hasValidPassport: travelersRows[i][travelerIndex['Has_Valid_Passport']] || false,
          isSpeaking: travelersRows[i][travelerIndex['Is_Speaking']] || false,
          eventOpenToPress: travelersRows[i][travelerIndex['Event_Open_To_Press']] || false,
          receivingNFS: travelersRows[i][travelerIndex['Receiving_NFS']] || false,
          ddConfirmed: travelersRows[i][travelerIndex['DD_Confirmed']] === true,
          ddConfirmedAt: travelersRows[i][travelerIndex['DD_Confirmed_At']] || null
        });
      }
    }

    // ========== Load Traveler Leg Costs ==========
    const { rows: legCostsRows, headerIndex: lcIndex } = db.readSheet(SHEET_NAMES.TRAVELER_LEG_COSTS);
    const travelerLegCosts = [];

    for (let i = 0; i < legCostsRows.length; i++) {
      if (legCostsRows[i][lcIndex['Request_ID']] === requestId) {
        travelerLegCosts.push({
          travelerId: legCostsRows[i][lcIndex['Traveler_ID']] || '',
          legId: legCostsRows[i][lcIndex['Leg_ID']] || '',
          // Independent lodging dates
          lodgingStartDate: formatDateValue(legCostsRows[i][lcIndex['Lodging_Start_Date']]),
          lodgingEndDate: formatDateValue(legCostsRows[i][lcIndex['Lodging_End_Date']]),
          lodgingUsesItineraryDates: legCostsRows[i][lcIndex['Lodging_Uses_Itinerary_Dates']] !== false,
          // Independent M&IE dates
          mieStartDate: formatDateValue(legCostsRows[i][lcIndex['MIE_Start_Date']]),
          mieEndDate: formatDateValue(legCostsRows[i][lcIndex['MIE_End_Date']]),
          mieUsesItineraryDates: legCostsRows[i][lcIndex['MIE_Uses_Itinerary_Dates']] !== false,
          isLocalTravel: legCostsRows[i][lcIndex['Is_Local_Travel']] || false,
          lodgingRate: parseFloat(legCostsRows[i][lcIndex['Lodging_Rate']]) || 0,
          lodgingNights: parseInt(legCostsRows[i][lcIndex['Lodging_Nights']]) || 0,
          lodgingCalculated: parseFloat(legCostsRows[i][lcIndex['Lodging_Calculated']]) || 0,
          lodgingOverride: legCostsRows[i][lcIndex['Lodging_Override']] || false,
          lodgingOverrideAmount: parseFloat(legCostsRows[i][lcIndex['Lodging_Override_Amount']]) || 0,
          lodgingOverrideReason: legCostsRows[i][lcIndex['Lodging_Override_Reason']] || '',
          lodgingTotal: parseFloat(legCostsRows[i][lcIndex['Lodging_Total']]) || 0,
          mieRate: parseFloat(legCostsRows[i][lcIndex['MIE_Rate']]) || 0,
          mieDays: parseInt(legCostsRows[i][lcIndex['MIE_Days']]) || 0,
          mieCalculated: parseFloat(legCostsRows[i][lcIndex['MIE_Calculated']]) || 0,
          mieOverride: legCostsRows[i][lcIndex['MIE_Override']] || false,
          mieOverrideAmount: parseFloat(legCostsRows[i][lcIndex['MIE_Override_Amount']]) || 0,
          mieOverrideReason: legCostsRows[i][lcIndex['MIE_Override_Reason']] || '',
          mieTotal: parseFloat(legCostsRows[i][lcIndex['MIE_Total']]) || 0,
          localMilesDriven: parseFloat(legCostsRows[i][lcIndex['Local_Miles_Driven']]) || 0,
          wasGovVehicleAvailable: legCostsRows[i][lcIndex['Was_Gov_Vehicle_Available']] || false,
          localParking: parseFloat(legCostsRows[i][lcIndex['Local_Parking']]) || 0,
          localTolls: parseFloat(legCostsRows[i][lcIndex['Local_Tolls']]) || 0,
          localTravelTotal: parseFloat(legCostsRows[i][lcIndex['Local_Travel_Total']]) || 0,
          legSubtotal: parseFloat(legCostsRows[i][lcIndex['Leg_Subtotal']]) || 0
        });
      }
    }

    // Attach leg costs to each traveler
    travelers.forEach(traveler => {
      traveler.legCosts = travelerLegCosts.filter(lc => lc.travelerId === traveler.travelerId);
    });

    // ========== Load Attachments ==========
    const { rows: attachmentsRows, headerIndex: attIndex } = db.readSheet(SHEET_NAMES.ATTACHMENTS);
    const attachments = [];

    for (let i = 0; i < attachmentsRows.length; i++) {
      if (attachmentsRows[i][attIndex['Request_ID']] === requestId) {
        attachments.push({
          attachmentId: attachmentsRows[i][attIndex['Attachment_ID']] || '',
          travelerId: attachmentsRows[i][attIndex['Traveler_ID']] || '',
          fileName: attachmentsRows[i][attIndex['File_Name']] || '',
          fileId: attachmentsRows[i][attIndex['File_ID']] || '',
          fileUrl: attachmentsRows[i][attIndex['File_URL']] || '',
          fileType: attachmentsRows[i][attIndex['File_Type']] || '',
          fileSize: parseInt(attachmentsRows[i][attIndex['File_Size']]) || 0,
          category: attachmentsRows[i][attIndex['Category']] || '',
          uploadedBy: attachmentsRows[i][attIndex['Uploaded_By']] || '',
          uploadedAt: formatDateValue(attachmentsRows[i][attIndex['Uploaded_At']])
        });
      }
    }

    // ========== Load Approval Log (Edit History) ==========
    const { rows: logRows, headerIndex: logIndex } = db.readSheet(SHEET_NAMES.APPROVAL_LOG);
    const approvalLog = [];

    for (let i = 0; i < logRows.length; i++) {
      if (logRows[i][logIndex['Request_ID']] === requestId) {
        approvalLog.push({
          logId: logRows[i][logIndex['Log_ID']] || '',
          action: logRows[i][logIndex['Action']] || '',
          actionByName: logRows[i][logIndex['Action_By_Name']] || '',
          actionByEmail: logRows[i][logIndex['Action_By_Email']] || '',
          actionByRole: logRows[i][logIndex['Action_By_Role']] || '',
          timestamp: formatDateValue(logRows[i][logIndex['Timestamp']]),
          previousStatus: logRows[i][logIndex['Previous_Status']] || '',
          newStatus: logRows[i][logIndex['New_Status']] || '',
          comments: logRows[i][logIndex['Comments']] || '',
          sectionComments: parseSectionComments(logRows[i][logIndex['Section_Comments']]),
          snapshotData: parseSnapshotData(logRows[i][logIndex['Snapshot_Data']]),
          versionBefore: parseInt(logRows[i][logIndex['Version_Before']]) || 0,
          versionAfter: parseInt(logRows[i][logIndex['Version_After']]) || 0
        });
      }
    }

    // Sort approval log by timestamp descending (most recent first)
    approvalLog.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // ========== Determine reviewer permissions ==========
    const currentUser = Session.getActiveUser().getEmail() || '';
    const currentUserLower = currentUser.toLowerCase();
    const reviewerEmailLower = (request.currentReviewerEmail || '').toLowerCase();
    const submitterEmailLower = (request.submitterEmail || '').toLowerCase();

    const isCurrentReviewer = currentUserLower === reviewerEmailLower && reviewerEmailLower !== '';
    const isSubmitter = currentUserLower === submitterEmailLower;

    // Determine what actions are available based on status
    const availableActions = getAvailableActions(request.status, isCurrentReviewer, isSubmitter);

    // Strip snapshotData from approval log to reduce response size
    const cleanApprovalLog = approvalLog.map(entry => ({
      ...entry,
      snapshotData: null
    }));

    const envelope = successResponse({
      request: request,
      legs: legs,
      travelers: travelers,
      attachments: attachments,
      approvalLog: cleanApprovalLog,
      permissions: {
        isCurrentReviewer: isCurrentReviewer,
        isSubmitter: isSubmitter,
        availableActions: availableActions
      }
    });

    // Sanitize envelope: convert Date objects to strings for google.script.run
    try {
      const sanitizedJson = JSON.stringify(envelope, (key, value) => {
        if (value instanceof Date) {
          return isNaN(value.getTime()) ? null : value.toISOString();
        }
        if (value && typeof value === 'object' && typeof value.toISOString === 'function' && !(value instanceof Array)) {
          try { return value.toISOString(); } catch (e) { return String(value); }
        }
        return value;
      });
      console.log('getRequestForReview payload size: ' + (sanitizedJson.length / 1024).toFixed(1) + ' KB');
      // Cache for 120s — shared across all users via script cache
      try { cache.put(cacheKey, sanitizedJson, 120); } catch (ce) { console.warn('Cache write failed:', ce.message); }
      console.timeEnd(_timer);
      return JSON.parse(sanitizedJson);
    } catch (serializeError) {
      console.error('getRequestForReview: Serialization failed:', serializeError.message);
      logError('getRequestForReview', serializeError, { requestId: requestId, phase: 'serialization' });
      console.timeEnd(_timer);
      return errorResponse('Response serialization failed');
    }

  } catch (error) {
    console.error('Error in getRequestForReview:', error.message);
    logError('getRequestForReview', error, { requestId: requestId });
    console.timeEnd(_timer);
    return errorResponse(error.message || 'Failed to load request');
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format a date value to ISO string safely
 * Handles Date objects, date strings, and other values.
 *
 * Cross-domain helper — called from 27+ sites across Admin.js,
 * ReviewerDashboard.js, and Review.js. DO NOT change the return shape
 * (plain string). Consolidating the five date formatters is a separate
 * future ticket (Chunk 11+).
 *
 * @server
 */
function formatDateValue(value) {
  if (!value) return '';
  try {
    // Handle Date objects (including Apps Script Date)
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return ''; // Invalid date
      return value.toISOString();
    }
    // Handle objects with toISOString method (duck typing for Date-like objects)
    if (typeof value === 'object' && typeof value.toISOString === 'function') {
      return value.toISOString();
    }
    // Handle objects with getTime method (another Date check)
    if (typeof value === 'object' && typeof value.getTime === 'function') {
      if (isNaN(value.getTime())) return '';
      return new Date(value.getTime()).toISOString();
    }
    // For any other object, try to convert
    if (typeof value === 'object') {
      return String(value) || '';
    }
    return String(value);
  } catch (e) {
    return String(value || '');
  }
}

/**
 * Parse section comments JSON safely
 * @private @server
 */
function parseSectionComments(value) {
  if (!value) return null;
  try {
    if (typeof value === 'object') return value;
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
}

/**
 * Parse snapshot data JSON safely
 * Limits size to prevent serialization issues
 * @private @server
 */
function parseSnapshotData(value) {
  if (!value) return null;
  try {
    if (typeof value === 'object') {
      const str = JSON.stringify(value);
      if (str.length > 50000) return null; // Skip large snapshots
      return JSON.parse(str);
    }
    if (typeof value === 'string' && value.length > 50000) {
      return null; // Skip large snapshots
    }
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
}

// escapeHtml() removed — canonical version is in TravelEmailService.js

/**
 * Determine available actions based on status and user role.
 * Returns an array of action keys; called inline from getRequestForReview
 * (both fresh + cache-hit paths). Plain array return — not envelope.
 * @server
 */
function getAvailableActions(status, isCurrentReviewer, isSubmitter) {
  const actions = [];

  // Submitter can cancel at non-terminal stages
  if (isSubmitter && ![STATUS_CODES.COMPLETED, STATUS_CODES.CANCELLED, STATUS_CODES.DENIED].includes(status)) {
    actions.push('submitter_cancel');
  }

  // Submitter can edit when in NEEDS_INFO state
  if (isSubmitter && [STATUS_CODES.NEEDS_INFO_SECTOR, STATUS_CODES.NEEDS_INFO_BU, STATUS_CODES.NEEDS_INFO_OSO].includes(status)) {
    actions.push('edit_and_resubmit');
  }

  // Reviewer actions
  if (isCurrentReviewer) {
    if (status === STATUS_CODES.PENDING_SECTOR) {
      actions.push('sector_approve', 'sector_needs_info', 'deny', 'cancel');
    } else if (status === STATUS_CODES.PENDING_BU) {
      actions.push('bu_approve', 'bu_needs_info', 'deny', 'cancel');
    } else if (status === STATUS_CODES.PENDING_OSO) {
      actions.push('oso_approve', 'oso_needs_info', 'deny', 'cancel');
    } else if (status === STATUS_CODES.PENDING_FAS) {
      actions.push('fas_approve', 'fas_deny');
    }
    // Reviewer can cancel at any non-terminal stage (including NEEDS_INFO)
    if (!actions.includes('cancel') && ![STATUS_CODES.COMPLETED, STATUS_CODES.CANCELLED, STATUS_CODES.DENIED].includes(status)) {
      actions.push('cancel');
    }
  }

  return actions;
}
