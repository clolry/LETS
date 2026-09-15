/**
 * Review_Update.js
 * Submitter and reviewer-mode field edits applied to in-flight requests.
 *
 * Exports (all @client):
 * - updateRequestClassification() — travel types + mission-critical types
 * - updateRequestOverview() — trip name, dates, BLUF, purpose
 * - updateRequestItinerary() — legs add/update/remove + cost recalc
 * - updateTravelersForReview() — justifications + funding type + removals
 * - updateSharedCostsForReview() — shared facilities/AV/logistics/other
 * - updateCostsForReview() — combined shared + transport + leg cost edits
 *
 * Internal helpers (@private @server):
 * - updateTravelerCosts() — bulk setValue on traveler subtotals (called
 *   only from recalculateRequestCostsAfterItineraryChange)
 * - recalculateRequestCostsAfterItineraryChange() — auto-recompute per-
 *   traveler costs after itinerary edits (called from updateRequestItinerary;
 *   keeps legacy {success, travelers, totals, dateShifts} shape so the
 *   wrapper can project into its envelope without an inner unwrap)
 *
 * Write pattern (all edits): per-cell setValue inside loops + a single
 * trailing db.invalidate() per affected sheet + CacheService remove
 * (request_review_v2_${id}) at the end of each function (Chunk 10.F.1
 * decision #4 — avoids N cache re-warms per loop iteration).
 *
 * Companion files: Review_Read.js, Review_Action.js, Review_DDConfirm.js
 */

/**
 * Update travel classification (travel types and mission-critical types).
 *
 * Write pattern: raw setValue calls on the located row + a single
 * db.invalidate(SHEET_NAMES.REQUESTS) at the end (decision #4 from
 * 10.F.1 handoff). Per-cell db.updateRow would add 4 cache re-warms
 * for a 4-field edit.
 *
 * @param {string} requestId - The request ID
 * @param {string[]} travelTypes - Array of selected travel type values
 * @param {string[]} missionCriticalTypes - Array of selected mission-critical type values
 * @returns {Object} successResponse({}) or errorResponse(msg)
 * @client
 */
function updateRequestClassification(requestId, travelTypes, missionCriticalTypes) {
  try {
    if (!requestId) {
      return errorResponse('Request ID is required');
    }

    // Validate arrays
    if (!Array.isArray(travelTypes) || travelTypes.length === 0) {
      return errorResponse('At least one travel type is required');
    }
    if (!Array.isArray(missionCriticalTypes) || missionCriticalTypes.length === 0) {
      return errorResponse('At least one mission-critical type is required');
    }

    const db = new TravelDB();
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
    const { rows: requestsRows, headers, headerIndex: reqIdx } = db.readSheet(SHEET_NAMES.REQUESTS);

    const requestIdCol = reqIdx['Request_ID'];
    const travelTypesCol = reqIdx['Travel_Types'];
    const missionCriticalCol = reqIdx['Mission_Critical_Types'];
    const versionCol = reqIdx['Version'];
    const statusCol = reqIdx['Status'];
    const submitterEmailCol = reqIdx['Submitter_Email'];
    const updatedAtCol = reqIdx['Updated_At'];

    // Find the request row
    let requestRow = -1;
    let currentRequest = null;
    for (let i = 0; i < requestsRows.length; i++) {
      if (requestsRows[i][requestIdCol] === requestId) {
        requestRow = i + 2; // +2: 1-indexed + header row
        currentRequest = requestsRows[i];
        break;
      }
    }

    if (requestRow === -1) {
      return errorResponse('Request not found');
    }

    // Check status allows editing
    const status = currentRequest[statusCol];
    // Submitter can edit at any pending or needs_info stage. Locked once
    // the request reaches a terminal state (APPROVED_GOGOV, COMPLETED,
    // CANCELLED, DENIED).
    const editableStatuses = [
      STATUS_CODES.DRAFT,
      STATUS_CODES.PENDING_SECTOR, STATUS_CODES.PENDING_BU, STATUS_CODES.PENDING_OSO, STATUS_CODES.PENDING_FAS,
      STATUS_CODES.NEEDS_INFO_SECTOR, STATUS_CODES.NEEDS_INFO_BU, STATUS_CODES.NEEDS_INFO_OSO
    ];
    if (!editableStatuses.includes(status)) {
      return errorResponse(`Cannot edit request in status: ${status}`);
    }

    // Check user is the submitter
    const currentUserEmail = Session.getActiveUser().getEmail();
    const submitterEmail = currentRequest[submitterEmailCol];
    if (currentUserEmail.toLowerCase() !== submitterEmail.toLowerCase()) {
      return errorResponse('Only the submitter can edit this request');
    }

    // Get current values for logging
    const oldTravelTypes = currentRequest[travelTypesCol];
    const oldMissionCritical = currentRequest[missionCriticalCol];
    const currentVersion = currentRequest[versionCol] || 1;

    // Update the request
    const newVersion = currentVersion + 1;
    const now = new Date();

    // Convert arrays to JSON strings
    const travelTypesStr = JSON.stringify(travelTypes);
    const missionCriticalStr = JSON.stringify(missionCriticalTypes);

    // Update cells
    requestsSheet.getRange(requestRow, travelTypesCol + 1).setValue(travelTypesStr);
    requestsSheet.getRange(requestRow, missionCriticalCol + 1).setValue(missionCriticalStr);
    requestsSheet.getRange(requestRow, versionCol + 1).setValue(newVersion);
    requestsSheet.getRange(requestRow, updatedAtCol + 1).setValue(now);

    // Log the change in Approval_Log (only store fields that actually changed)
    const approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
    if (approvalLogSheet) {
      const logId = generateLogId();

      // Build delta - only include fields that changed
      // Parse strings to arrays to avoid double-encoding in JSON
      const oldValues = {};
      const newValues = {};

      if (oldTravelTypes !== travelTypesStr) {
        oldValues.travelTypes = JSON.parse(oldTravelTypes || '[]');
        newValues.travelTypes = travelTypes;
      }
      if (oldMissionCritical !== missionCriticalStr) {
        oldValues.missionCriticalTypes = JSON.parse(oldMissionCritical || '[]');
        newValues.missionCriticalTypes = missionCriticalTypes;
      }

      const changeDetails = {
        field: 'classification',
        old: oldValues,
        new: newValues
      };

      approvalLogSheet.appendRow([
        logId,                                      // Log_ID
        requestId,                                  // Request_ID
        ACTION_TYPES.EDIT_CLASSIFICATION,           // Action
        currentUserEmail,                           // Action_By_Name (using email as fallback)
        currentUserEmail,                           // Action_By_Email
        'Submitter',                                // Action_By_Role
        now,                                        // Timestamp
        status,                                     // Previous_Status
        status,                                     // New_Status (unchanged for edits)
        'Classification updated',                   // Comments
        JSON.stringify(changeDetails),              // Section_Comments (storing change details here)
        '',                                         // Snapshot_Data
        currentVersion,                             // Version_Before
        newVersion                                  // Version_After
      ]);
    }

    // Single trailing invalidate per sheet — see decision #4 in handoff.
    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    try { CacheService.getScriptCache().remove('request_review_v2_' + requestId); } catch (ce) { /* ignore */ }

    console.log(`Classification updated for ${requestId} by ${currentUserEmail}`);

    return successResponse({});

  } catch (error) {
    logError('updateRequestClassification', error, { requestId: requestId });
    return errorResponse(error.message || 'Failed to update classification');
  }
}

/**
 * Update request overview fields (Trip Name, Event Dates, BLUF, Purpose)
 * Called from submitter edit mode.
 *
 * Write pattern: raw setValue calls on the located row + a single
 * db.invalidate(SHEET_NAMES.REQUESTS) at the end (decision #4 from
 * 10.F.1 handoff).
 *
 * @param {string} requestId - The request ID
 * @param {string} tripName - Trip/Event name
 * @param {string} locationType - Location type (client-site, conference, etc.)
 * @param {string} eventStartDate - Event start date (YYYY-MM-DD)
 * @param {string} eventEndDate - Event end date (YYYY-MM-DD)
 * @param {string} bluf - Bottom Line Up Front
 * @param {string} purpose - Purpose & Justification
 * @returns {Object} successResponse({}) or errorResponse(msg)
 * @client
 */
function updateRequestOverview(requestId, tripName, locationType, eventStartDate, eventEndDate, bluf, purpose) {
  try {
    if (!requestId) {
      return errorResponse('Request ID is required');
    }

    // Validate required fields
    if (!tripName || !tripName.trim()) {
      return errorResponse('Trip Name is required');
    }
    if (!locationType) {
      return errorResponse('Location Type is required');
    }
    // Validate locationType is one of allowed values
    const validLocationTypes = ['client-site', 'conference', 'contractor-site', 'teb', 'other'];
    if (!validLocationTypes.includes(locationType)) {
      return errorResponse('Invalid Location Type');
    }
    if (!eventStartDate) {
      return errorResponse('Event Start Date is required');
    }
    if (!eventEndDate) {
      return errorResponse('Event End Date is required');
    }
    if (!bluf || !bluf.trim()) {
      return errorResponse('BLUF is required');
    }
    if (!purpose || !purpose.trim()) {
      return errorResponse('Purpose is required');
    }

    // Validate date order
    if (eventStartDate > eventEndDate) {
      return errorResponse('End date must be on or after start date');
    }

    const db = new TravelDB();
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
    const { rows: requestsRows, headerIndex: reqIdx } = db.readSheet(SHEET_NAMES.REQUESTS);

    const requestIdCol = reqIdx['Request_ID'];
    const tripNameCol = reqIdx['Trip_Name'];
    const locationTypeCol = reqIdx['Location_Type'];
    const eventStartCol = reqIdx['Event_Start_Date'];
    const eventEndCol = reqIdx['Event_End_Date'];
    const blufCol = reqIdx['BLUF'];
    const purposeCol = reqIdx['Purpose'];
    const versionCol = reqIdx['Version'];
    const statusCol = reqIdx['Status'];
    const submitterEmailCol = reqIdx['Submitter_Email'];
    const updatedAtCol = reqIdx['Updated_At'];

    // Find the request row
    let requestRow = -1;
    let currentRequest = null;
    for (let i = 0; i < requestsRows.length; i++) {
      if (requestsRows[i][requestIdCol] === requestId) {
        requestRow = i + 2; // +2: 1-indexed + header row
        currentRequest = requestsRows[i];
        break;
      }
    }

    if (requestRow === -1) {
      return errorResponse('Request not found');
    }

    // Check status allows editing
    const status = currentRequest[statusCol];
    const editableStatuses = [
      STATUS_CODES.DRAFT,
      STATUS_CODES.PENDING_SECTOR, STATUS_CODES.PENDING_BU, STATUS_CODES.PENDING_OSO, STATUS_CODES.PENDING_FAS,
      STATUS_CODES.NEEDS_INFO_SECTOR, STATUS_CODES.NEEDS_INFO_BU, STATUS_CODES.NEEDS_INFO_OSO
    ];
    if (!editableStatuses.includes(status)) {
      return errorResponse(`Cannot edit request in status: ${status}`);
    }

    // Check user is the submitter
    const currentUserEmail = Session.getActiveUser().getEmail();
    const submitterEmail = currentRequest[submitterEmailCol];
    if (currentUserEmail.toLowerCase() !== submitterEmail.toLowerCase()) {
      return errorResponse('Only the submitter can edit this request');
    }

    // Get current values for logging (format dates consistently)
    const oldTripName = currentRequest[tripNameCol];
    const oldLocationType = currentRequest[locationTypeCol];
    const oldEventStart = formatDateForStorage(currentRequest[eventStartCol]);
    const oldEventEnd = formatDateForStorage(currentRequest[eventEndCol]);
    const oldBluf = currentRequest[blufCol];
    const oldPurpose = currentRequest[purposeCol];
    const currentVersion = currentRequest[versionCol] || 1;

    // Update the request
    const newVersion = currentVersion + 1;
    const now = new Date();

    // Format dates for storage (yyyy-MM-dd)
    const startDateFormatted = formatDateForStorage(eventStartDate);
    const endDateFormatted = formatDateForStorage(eventEndDate);

    // Update cells
    requestsSheet.getRange(requestRow, tripNameCol + 1).setValue(tripName.trim());
    if (locationTypeCol >= 0) {
      requestsSheet.getRange(requestRow, locationTypeCol + 1).setValue(locationType);
    }
    requestsSheet.getRange(requestRow, eventStartCol + 1).setValue(startDateFormatted);
    requestsSheet.getRange(requestRow, eventEndCol + 1).setValue(endDateFormatted);
    requestsSheet.getRange(requestRow, blufCol + 1).setValue(bluf.trim());
    requestsSheet.getRange(requestRow, purposeCol + 1).setValue(purpose.trim());
    requestsSheet.getRange(requestRow, versionCol + 1).setValue(newVersion);
    requestsSheet.getRange(requestRow, updatedAtCol + 1).setValue(now);

    // Log the change in Approval_Log (only store fields that actually changed)
    const approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
    if (approvalLogSheet) {
      const logId = generateLogId();

      // Build delta - only include fields that changed
      const oldValues = {};
      const newValues = {};

      if (oldTripName !== tripName.trim()) {
        oldValues.tripName = oldTripName;
        newValues.tripName = tripName.trim();
      }
      if (oldLocationType !== locationType) {
        oldValues.locationType = oldLocationType;
        newValues.locationType = locationType;
      }
      if (oldEventStart !== startDateFormatted) {
        oldValues.eventStartDate = oldEventStart;
        newValues.eventStartDate = startDateFormatted;
      }
      if (oldEventEnd !== endDateFormatted) {
        oldValues.eventEndDate = oldEventEnd;
        newValues.eventEndDate = endDateFormatted;
      }
      if (oldBluf !== bluf.trim()) {
        oldValues.bluf = oldBluf;
        newValues.bluf = bluf.trim();
      }
      if (oldPurpose !== purpose.trim()) {
        oldValues.purpose = oldPurpose;
        newValues.purpose = purpose.trim();
      }

      const changeDetails = {
        field: 'overview',
        old: oldValues,
        new: newValues
      };

      approvalLogSheet.appendRow([
        logId,                                      // Log_ID
        requestId,                                  // Request_ID
        ACTION_TYPES.EDIT_OVERVIEW,                 // Action
        currentUserEmail,                           // Action_By_Name (using email as fallback)
        currentUserEmail,                           // Action_By_Email
        'Submitter',                                // Action_By_Role
        now,                                        // Timestamp
        status,                                     // Previous_Status
        status,                                     // New_Status (unchanged for edits)
        'Trip overview updated',                    // Comments
        JSON.stringify(changeDetails),              // Section_Comments (storing change details here)
        '',                                         // Snapshot_Data
        currentVersion,                             // Version_Before
        newVersion                                  // Version_After
      ]);
    }

    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    try { CacheService.getScriptCache().remove('request_review_v2_' + requestId); } catch (ce) { /* ignore */ }

    console.log(`Overview updated for ${requestId} by ${currentUserEmail}`);

    return successResponse({});

  } catch (error) {
    logError('updateRequestOverview', error, { requestId: requestId });
    return errorResponse(error.message || 'Failed to update overview');
  }
}

/**
 * Update itinerary/legs for a travel request (submitter edit)
 * Supports adding new legs, updating existing legs, and removing legs.
 *
 * Write pattern: per-cell setValue inside the legs loop + a single
 * trailing db.invalidate() per sheet at the end (decision #4). Moving
 * each leg to db.updateRow would add N cache re-warms per edit.
 *
 * @param {string} requestId - The request ID
 * @param {Array} updatedLegs - Array of leg objects with updated values
 * @param {Array} removedLegIds - Array of leg IDs to remove
 * @param {Array} [confirmedDateShifts] - Optional confirmed date shifts from client (pre-approved by user)
 * @returns {Object} successResponse({ newLegs, changes, costRecalculation }) or errorResponse(msg)
 * @client
 */
function updateRequestItinerary(requestId, updatedLegs, removedLegIds, confirmedDateShifts) {
  try {
    if (!requestId) {
      return errorResponse('Request ID is required');
    }

    if (!updatedLegs || !Array.isArray(updatedLegs) || updatedLegs.length === 0) {
      return errorResponse('At least one leg is required');
    }

    // Helper to normalize dates to yyyy-MM-dd format for comparison
    const normalizeDateStr = (val) => formatDateForStorage(val);

    const db = new TravelDB();
    const legsSheet = db.sheet(SHEET_NAMES.REQUEST_LEGS);
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);

    if (!legsSheet || !requestsSheet) {
      return errorResponse('Required sheets not found');
    }

    // Get current user
    const currentUserEmail = Session.getActiveUser().getEmail();

    // Get leg data
    const legsData = legsSheet.getDataRange().getValues();
    const legHeaders = legsData[0];

    // Build header index for legs
    const legIndex = {};
    legHeaders.forEach((h, i) => { legIndex[h] = i; });

    const now = new Date();
    const changes = [];
    const newLegs = [];

    // Capture old leg dates BEFORE any modifications (for smart date shifting)
    const oldLegsMap = {};
    for (let i = 1; i < legsData.length; i++) {
      if (legsData[i][legIndex['Request_ID']] === requestId) {
        const legId = legsData[i][legIndex['Leg_ID']];
        oldLegsMap[legId] = {
          legId: legId,
          startDate: normalizeDateStr(legsData[i][legIndex['Start_Date']]),
          endDate: normalizeDateStr(legsData[i][legIndex['End_Date']])
        };
      }
    }

    // Process removals first (if any)
    if (removedLegIds && removedLegIds.length > 0) {
      // Find rows to delete (collect in reverse order to avoid index shifting issues)
      const rowsToDelete = [];
      for (let i = 1; i < legsData.length; i++) {
        const legId = legsData[i][legIndex['Leg_ID']];
        if (removedLegIds.includes(legId)) {
          rowsToDelete.push(i + 1); // 1-based row number
          changes.push({
            action: 'removed',
            legId: legId,
            legNumber: legsData[i][legIndex['Leg_Number']],
            city: legsData[i][legIndex['City']]
          });
        }
      }

      // Delete rows in reverse order to maintain correct indices
      rowsToDelete.sort((a, b) => b - a);
      for (const rowNum of rowsToDelete) {
        legsSheet.deleteRow(rowNum);
      }

      // Refresh legsData after deletions
      if (rowsToDelete.length > 0) {
        // Re-read the data after deletions
        const refreshedData = legsSheet.getDataRange().getValues();
        legsData.length = 0;
        refreshedData.forEach(row => legsData.push(row));
      }
    }

    // Process updates and additions
    for (let legNum = 0; legNum < updatedLegs.length; legNum++) {
      const updatedLeg = updatedLegs[legNum];
      const newLegNumber = legNum + 1;

      if (updatedLeg.isNew) {
        // Add new leg
        const newLegId = `leg_${Date.now()}_${legNum}`;

        // Use shared utilities for location flags and display
        const country = updatedLeg.country || 'United States';
        const locationFlags = getLegLocationFlags({ ...updatedLeg, country });
        const locationDisplay = formatLocationDisplay(updatedLeg);

        // Match column order from Data Model v2 and submitTravelRequestV2
        const newRow = [
          requestId,                                // Request_ID
          newLegId,                                 // Leg_ID
          newLegNumber,                             // Leg_Number
          updatedLeg.siteName || '',                // Site_Name
          updatedLeg.city || '',                    // City
          updatedLeg.state || '',                   // State
          country,                                  // Country
          formatDateForStorage(updatedLeg.startDate), // Start_Date (yyyy-MM-dd)
          formatDateForStorage(updatedLeg.endDate),   // End_Date (yyyy-MM-dd)
          locationFlags.isInternational,            // Is_International
          locationFlags.isOCONUS,                   // Is_OCONUS
          locationFlags.perDiemSource,              // Per_Diem_Source
          '',                                       // Lodging_Rate (will be calculated)
          '',                                       // MIE_Rate (will be calculated)
          locationDisplay                           // Location_Display
        ];

        legsSheet.appendRow(newRow);

        changes.push({
          action: 'added',
          legId: newLegId,
          legNumber: newLegNumber,
          city: updatedLeg.city,
          country: country
        });

        newLegs.push({
          legId: newLegId,
          legNumber: newLegNumber,
          siteName: updatedLeg.siteName || '',
          city: updatedLeg.city,
          state: updatedLeg.state || '',
          country: country,
          startDate: updatedLeg.startDate,
          endDate: updatedLeg.endDate,
          isInternational: locationFlags.isInternational,
          isOCONUS: locationFlags.isOCONUS,
          perDiemSource: locationFlags.perDiemSource,
          locationDisplay: locationDisplay
        });

      } else {
        // Update existing leg
        let legRowIndex = -1;
        for (let i = 1; i < legsData.length; i++) {
          if (legsData[i][legIndex['Leg_ID']] === updatedLeg.legId) {
            legRowIndex = i;
            break;
          }
        }

        if (legRowIndex === -1) {
          console.warn(`Leg not found: ${updatedLeg.legId}`);
          continue;
        }

        // Store old values for logging (convert dates to strings for serialization)
        const oldValues = {
          siteName: legsData[legRowIndex][legIndex['Site_Name']],
          city: legsData[legRowIndex][legIndex['City']],
          state: legsData[legRowIndex][legIndex['State']],
          country: legsData[legRowIndex][legIndex['Country']],
          startDate: normalizeDateStr(legsData[legRowIndex][legIndex['Start_Date']]),
          endDate: normalizeDateStr(legsData[legRowIndex][legIndex['End_Date']]),
          legNumber: legsData[legRowIndex][legIndex['Leg_Number']]
        };

        const rowNum = legRowIndex + 1; // 1-based for sheet

        // Update Leg_Number (in case order changed)
        if (legIndex['Leg_Number'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['Leg_Number'] + 1).setValue(newLegNumber);
        }

        // Site Name
        if (legIndex['Site_Name'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['Site_Name'] + 1).setValue(updatedLeg.siteName || '');
        }

        // City
        if (legIndex['City'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['City'] + 1).setValue(updatedLeg.city);
        }

        // State
        if (legIndex['State'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['State'] + 1).setValue(updatedLeg.state || '');
        }

        // Country
        if (legIndex['Country'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['Country'] + 1).setValue(updatedLeg.country || '');
        }

        // Start Date
        if (legIndex['Start_Date'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['Start_Date'] + 1).setValue(formatDateForStorage(updatedLeg.startDate));
        }

        // End Date
        if (legIndex['End_Date'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['End_Date'] + 1).setValue(formatDateForStorage(updatedLeg.endDate));
        }

        // Recalculate and update location flags using shared utilities
        const country = updatedLeg.country || 'United States';
        const locationFlags = getLegLocationFlags({ ...updatedLeg, country });
        const locationDisplay = formatLocationDisplay(updatedLeg);

        if (legIndex['Is_International'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['Is_International'] + 1).setValue(locationFlags.isInternational);
        }
        if (legIndex['Is_OCONUS'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['Is_OCONUS'] + 1).setValue(locationFlags.isOCONUS);
        }
        if (legIndex['Per_Diem_Source'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['Per_Diem_Source'] + 1).setValue(locationFlags.perDiemSource);
        }

        // Update Location_Display
        if (legIndex['Location_Display'] !== undefined) {
          legsSheet.getRange(rowNum, legIndex['Location_Display'] + 1).setValue(locationDisplay);
        }

        // Build new values with normalized dates for comparison
        const newValues = {
          siteName: updatedLeg.siteName || '',
          city: updatedLeg.city || '',
          state: updatedLeg.state || '',
          country: updatedLeg.country || '',
          startDate: normalizeDateStr(updatedLeg.startDate),
          endDate: normalizeDateStr(updatedLeg.endDate)
        };

        // Compute delta - only include fields that actually changed
        const deltaOld = {};
        const deltaNew = {};
        const fieldsToCompare = ['siteName', 'city', 'state', 'country', 'startDate', 'endDate'];

        fieldsToCompare.forEach(field => {
          const oldVal = (oldValues[field] || '').toString().trim();
          const newVal = (newValues[field] || '').toString().trim();
          if (oldVal !== newVal) {
            deltaOld[field] = oldVal;
            deltaNew[field] = newVal;
          }
        });

        // Only add to changes if something actually changed
        if (Object.keys(deltaNew).length > 0) {
          changes.push({
            action: 'updated',
            legId: updatedLeg.legId,
            legNumber: newLegNumber,
            city: updatedLeg.city,  // For display purposes
            old: deltaOld,
            new: deltaNew
          });
        }
      }
    }

    // Update request version and timestamp
    const requestsData = requestsSheet.getDataRange().getValues();
    const reqHeaders = requestsData[0];
    const reqIndex = {};
    reqHeaders.forEach((h, i) => { reqIndex[h] = i; });

    let requestRow = -1;
    for (let i = 1; i < requestsData.length; i++) {
      if (requestsData[i][reqIndex['Request_ID']] === requestId) {
        requestRow = i + 1;
        break;
      }
    }

    if (requestRow > 0) {
      const currentVersion = requestsData[requestRow - 1][reqIndex['Version']] || 1;
      const newVersion = currentVersion + 1;

      if (reqIndex['Version'] !== undefined) {
        requestsSheet.getRange(requestRow, reqIndex['Version'] + 1).setValue(newVersion);
      }
      if (reqIndex['Updated_At'] !== undefined) {
        requestsSheet.getRange(requestRow, reqIndex['Updated_At'] + 1).setValue(now);
      }

      // Log the change
      const approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
      if (approvalLogSheet) {
        const logId = generateLogId();
        const status = requestsData[requestRow - 1][reqIndex['Status']] || '';

        const addedCount = changes.filter(c => c.action === 'added').length;
        const updatedCount = changes.filter(c => c.action === 'updated').length;
        const removedCount = changes.filter(c => c.action === 'removed').length;

        const parts = [];
        if (addedCount > 0) parts.push(`${addedCount} added`);
        if (updatedCount > 0) parts.push(`${updatedCount} updated`);
        if (removedCount > 0) parts.push(`${removedCount} removed`);

        approvalLogSheet.appendRow([
          logId,
          requestId,
          ACTION_TYPES.EDIT_ITINERARY,
          currentUserEmail,
          currentUserEmail,
          'Submitter',
          now,
          status,
          status,
          `Itinerary modified: ${parts.join(', ')}`,
          JSON.stringify({ changes }),
          '',
          currentVersion,
          newVersion
        ]);
      }
    }

    console.log(`Itinerary updated for ${requestId} by ${currentUserEmail}: ${changes.length} changes`);

    // ========== Auto-recalculate traveler costs based on new itinerary ==========
    // Build complete legs array for recalculation (existing + new)
    const allLegs = [];

    // Re-read legs from sheet to get complete picture
    const updatedLegsData = legsSheet.getDataRange().getValues();
    for (let i = 1; i < updatedLegsData.length; i++) {
      if (updatedLegsData[i][legIndex['Request_ID']] === requestId) {
        allLegs.push({
          legId: updatedLegsData[i][legIndex['Leg_ID']],
          legNumber: updatedLegsData[i][legIndex['Leg_Number']],
          siteName: updatedLegsData[i][legIndex['Site_Name']] || '',
          city: updatedLegsData[i][legIndex['City']] || '',
          state: updatedLegsData[i][legIndex['State']] || '',
          country: updatedLegsData[i][legIndex['Country']] || 'United States',
          startDate: normalizeDateStr(updatedLegsData[i][legIndex['Start_Date']]),
          endDate: normalizeDateStr(updatedLegsData[i][legIndex['End_Date']]),
          isInternational: updatedLegsData[i][legIndex['Is_International']] || false,
          isOCONUS: updatedLegsData[i][legIndex['Is_OCONUS']] || false,
          perDiemSource: updatedLegsData[i][legIndex['Per_Diem_Source']] || 'GSA',
          lodgingRate: parseFloat(updatedLegsData[i][legIndex['Lodging_Rate']]) || 0,
          mieRate: parseFloat(updatedLegsData[i][legIndex['MIE_Rate']]) || 0,
          locationDisplay: updatedLegsData[i][legIndex['Location_Display']] || ''
        });
      }
    }

    // Sort by leg number
    allLegs.sort((a, b) => a.legNumber - b.legNumber);

    // Recalculate costs (pass old legs map for smart date shifting, or confirmed shifts from client).
    // recalculateRequestCostsAfterItineraryChange is an internal helper — keeps its legacy
    // {success, travelers, totals, dateShifts} shape so this wrapper doesn't have to unwrap
    // an inner envelope before re-projecting into the outer one.
    let costResult;
    try {
      costResult = recalculateRequestCostsAfterItineraryChange(requestId, allLegs, oldLegsMap, confirmedDateShifts);
      console.log('Cost recalculation completed, success:', costResult?.success);
    } catch (costError) {
      console.error('Cost recalculation threw error:', costError);
      costResult = { success: false, error: costError.message };
    }

    if (!costResult || !costResult.success) {
      console.warn(`Itinerary updated but cost recalculation failed: ${costResult?.error || 'unknown'}`);
    }

    db.invalidate(SHEET_NAMES.REQUEST_LEGS);
    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    db.invalidate(SHEET_NAMES.REQUEST_TRAVELERS);
    db.invalidate(SHEET_NAMES.TRAVELER_LEG_COSTS);
    try { CacheService.getScriptCache().remove('request_review_v2_' + requestId); } catch (ce) { /* ignore */ }

    return successResponse({
      newLegs: allLegs,
      changes: changes,
      costRecalculation: (costResult && costResult.success) ? {
        travelers: costResult.travelers,
        totals: costResult.totals,
        dateShifts: costResult.dateShifts || []
      } : null
    });

  } catch (error) {
    logError('updateRequestItinerary', error, { requestId: requestId });
    return errorResponse(error.message || 'Failed to update itinerary');
  }
}
/**
 * Update traveler costs after itinerary changes.
 *
 * Internal helper — only called by recalculateRequestCostsAfterItineraryChange
 * (which is itself only called by updateRequestItinerary). NOT exposed as
 * @client. Returns the legacy `{success, ...}` shape so the call site doesn't
 * have to unwrap an envelope. Per-cell setValue inside loops + single
 * trailing invalidate per sheet (decision #4).
 *
 * @param {string} requestId - The request ID
 * @param {Array} travelerCosts - Array of traveler cost objects
 * @param {number} grandTotal - New grand total
 * @returns {Object} { success, error? }
 * @private @server
 */
function updateTravelerCosts(requestId, travelerCosts, grandTotal) {
  try {
    const db = new TravelDB();
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
    const travelersSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);
    const legCostsSheet = db.sheet(SHEET_NAMES.TRAVELER_LEG_COSTS);

    if (!requestsSheet || !travelersSheet) {
      throw new Error('Required sheets not found');
    }

    // Get column indices for travelers sheet
    const travelersData = travelersSheet.getDataRange().getValues();
    const travelerHeaders = travelersData[0];
    const travelerIndex = {};
    travelerHeaders.forEach((h, i) => { travelerIndex[h] = i; });

    // Get column indices for requests sheet
    const requestsData = requestsSheet.getDataRange().getValues();
    const requestHeaders = requestsData[0];
    const requestIndex = {};
    requestHeaders.forEach((h, i) => { requestIndex[h] = i; });

    // Update grand total in requests sheet
    let requestRowIndex = -1;
    for (let i = 1; i < requestsData.length; i++) {
      if (requestsData[i][requestIndex['Request_ID']] === requestId) {
        requestRowIndex = i + 1; // 1-based for sheet
        break;
      }
    }

    if (requestRowIndex > 0) {
      // Calculate Traveler_Total from individual traveler costs
      const travelerTotal = travelerCosts.reduce((sum, tc) => sum + (parseFloat(tc.subtotal) || 0), 0);

      if (requestIndex['Traveler_Total'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Traveler_Total'] + 1).setValue(travelerTotal);
      }
      if (requestIndex['Grand_Total'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Grand_Total'] + 1).setValue(grandTotal);
      }
      if (requestIndex['Updated_At'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Updated_At'] + 1).setValue(new Date());
      }
    }

    // Update each traveler's costs
    for (const tc of travelerCosts) {
      let travelerRowIndex = -1;
      for (let i = 1; i < travelersData.length; i++) {
        if (travelersData[i][travelerIndex['Traveler_ID']] === tc.travelerId) {
          travelerRowIndex = i + 1; // 1-based for sheet
          break;
        }
      }

      if (travelerRowIndex === -1) continue;

      // Update traveler totals
      if (travelerIndex['Lodging_Total'] !== undefined) {
        travelersSheet.getRange(travelerRowIndex, travelerIndex['Lodging_Total'] + 1).setValue(tc.lodgingTotal);
      }
      if (travelerIndex['MIE_Total'] !== undefined) {
        travelersSheet.getRange(travelerRowIndex, travelerIndex['MIE_Total'] + 1).setValue(tc.mieTotal);
      }
      if (travelerIndex['Transportation_Total'] !== undefined) {
        travelersSheet.getRange(travelerRowIndex, travelerIndex['Transportation_Total'] + 1).setValue(tc.transportationTotal);
      }
      if (travelerIndex['Other_Total'] !== undefined) {
        travelersSheet.getRange(travelerRowIndex, travelerIndex['Other_Total'] + 1).setValue(tc.otherTotal);
      }
      if (travelerIndex['Subtotal'] !== undefined) {
        travelersSheet.getRange(travelerRowIndex, travelerIndex['Subtotal'] + 1).setValue(tc.subtotal);
      }

      // Update leg costs if legCosts sheet exists
      if (legCostsSheet && tc.legCosts) {
        const legCostsData = legCostsSheet.getDataRange().getValues();
        const lcHeaders = legCostsData[0];
        const lcIndex = {};
        lcHeaders.forEach((h, i) => { lcIndex[h] = i; });

        for (const [legId, legCost] of Object.entries(tc.legCosts)) {
          // Find the leg cost row
          let lcRowIndex = -1;
          for (let i = 1; i < legCostsData.length; i++) {
            if (legCostsData[i][lcIndex['Traveler_ID']] === tc.travelerId &&
                legCostsData[i][lcIndex['Leg_ID']] === legId) {
              lcRowIndex = i + 1;
              break;
            }
          }

          if (lcRowIndex === -1) continue;

          // Update leg cost fields
          if (lcIndex['Lodging_Rate'] !== undefined && legCost.lodgingRate !== undefined) {
            legCostsSheet.getRange(lcRowIndex, lcIndex['Lodging_Rate'] + 1).setValue(legCost.lodgingRate);
          }
          if (lcIndex['Lodging_Nights'] !== undefined && legCost.lodgingNights !== undefined) {
            legCostsSheet.getRange(lcRowIndex, lcIndex['Lodging_Nights'] + 1).setValue(legCost.lodgingNights);
          }
          if (lcIndex['Lodging_Calculated'] !== undefined && legCost.lodgingCalculated !== undefined) {
            legCostsSheet.getRange(lcRowIndex, lcIndex['Lodging_Calculated'] + 1).setValue(legCost.lodgingCalculated);
          }
          if (lcIndex['Lodging_Total'] !== undefined && legCost.lodgingTotal !== undefined) {
            legCostsSheet.getRange(lcRowIndex, lcIndex['Lodging_Total'] + 1).setValue(legCost.lodgingTotal);
          }
          if (lcIndex['MIE_Rate'] !== undefined && legCost.mieRate !== undefined) {
            legCostsSheet.getRange(lcRowIndex, lcIndex['MIE_Rate'] + 1).setValue(legCost.mieRate);
          }
          if (lcIndex['MIE_Days'] !== undefined && legCost.mieDays !== undefined) {
            legCostsSheet.getRange(lcRowIndex, lcIndex['MIE_Days'] + 1).setValue(legCost.mieDays);
          }
          if (lcIndex['MIE_Calculated'] !== undefined && legCost.mieCalculated !== undefined) {
            legCostsSheet.getRange(lcRowIndex, lcIndex['MIE_Calculated'] + 1).setValue(legCost.mieCalculated);
          }
          if (lcIndex['MIE_Total'] !== undefined && legCost.mieTotal !== undefined) {
            legCostsSheet.getRange(lcRowIndex, lcIndex['MIE_Total'] + 1).setValue(legCost.mieTotal);
          }
          if (lcIndex['Leg_Subtotal'] !== undefined && legCost.legSubtotal !== undefined) {
            legCostsSheet.getRange(lcRowIndex, lcIndex['Leg_Subtotal'] + 1).setValue(legCost.legSubtotal);
          }
        }
      }
    }

    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.REQUEST_TRAVELERS);
    db.invalidate(SHEET_NAMES.TRAVELER_LEG_COSTS);

    console.log(`Updated traveler costs for request ${requestId}, grand total: ${grandTotal}`);
    return { success: true };

  } catch (error) {
    logError('updateTravelerCosts', error, { requestId: requestId });
    return { success: false, error: error.message };
  }
}

/**
 * Automatically recalculate all traveler costs after itinerary changes.
 * Uses TravelCostUtils for unified calculations.
 *
 * Internal helper — only called from updateRequestItinerary. Keeps the
 * legacy `{success, travelers, totals, dateShifts}` shape so the wrapping
 * @client function (updateRequestItinerary) can project fields directly
 * into its envelope's `data.costRecalculation` without an inner unwrap.
 *
 * @param {string} requestId - The request ID
 * @param {Array} newLegs - Updated legs array (with new dates, etc.)
 * @param {Object} oldLegsMap - Map of legId -> old dates for offset calculation
 * @param {Array} [confirmedDateShifts] - Optional pre-confirmed date shifts from client
 * @returns {Object} { success, travelers, totals, dateShifts }
 * @private @server
 */
function recalculateRequestCostsAfterItineraryChange(requestId, newLegs, oldLegsMap, confirmedDateShifts) {
  try {
    const db = new TravelDB();
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
    const travelersSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);
    const legCostsSheet = db.sheet(SHEET_NAMES.TRAVELER_LEG_COSTS);

    if (!requestsSheet || !travelersSheet) {
      throw new Error('Required sheets not found');
    }

    const mileageRates = getMileageRates();

    // ========== Load current travelers ==========
    const travelersData = travelersSheet.getDataRange().getValues();
    const travelerHeaders = travelersData[0];
    const travelerIndex = {};
    travelerHeaders.forEach((h, i) => { travelerIndex[h] = i; });

    // Find all travelers for this request
    const travelers = [];
    const travelerRows = {}; // Map travelerId to row number

    for (let i = 1; i < travelersData.length; i++) {
      if (travelersData[i][travelerIndex['Request_ID']] === requestId) {
        const travelerId = travelersData[i][travelerIndex['Traveler_ID']];
        travelerRows[travelerId] = i + 1; // 1-based for sheet

        travelers.push({
          travelerId: travelerId,
          transportMode: travelersData[i][travelerIndex['Transport_Mode']] || 'air',
          ticketCost: parseFloat(travelersData[i][travelerIndex['Ticket_Cost']]) || 0,
          totalMiles: parseFloat(travelersData[i][travelerIndex['Total_Miles']]) || 0,
          needsRentalCar: travelersData[i][travelerIndex['Needs_Rental_Car']] === true || travelersData[i][travelerIndex['Needs_Rental_Car']] === 'true',
          rentalCarCost: parseFloat(travelersData[i][travelerIndex['Rental_Car_Cost']]) || 0,
          otherPercentage: parseFloat(travelersData[i][travelerIndex['Other_Percentage']]) || 15,
          attendingLegs: (travelersData[i][travelerIndex['Attending_Legs']] || '').split(',').filter(l => l),
          normalCommuteDistance: parseFloat(travelersData[i][travelerIndex['Normal_Commute_Distance']]) || 0,
          normalCommuteParking: parseFloat(travelersData[i][travelerIndex['Normal_Commute_Parking']]) || 0,
          legCosts: {} // Will be populated below
        });
      }
    }

    // ========== Load current leg costs ==========
    const normalizeDateFromSheet = (val) => formatDateForStorage(val);

    if (legCostsSheet && legCostsSheet.getLastRow() > 1) {
      const legCostsData = legCostsSheet.getDataRange().getValues();
      const lcHeaders = legCostsData[0];
      const lcIndex = {};
      lcHeaders.forEach((h, i) => { lcIndex[h] = i; });

      for (let i = 1; i < legCostsData.length; i++) {
        if (legCostsData[i][lcIndex['Request_ID']] === requestId) {
          const travelerId = legCostsData[i][lcIndex['Traveler_ID']];
          const legId = legCostsData[i][lcIndex['Leg_ID']];

          const traveler = travelers.find(t => t.travelerId === travelerId);
          if (traveler) {
            traveler.legCosts[legId] = {
              legId: legId,
              rowIndex: i + 1, // For updating later
              // Independent lodging dates (normalized to strings)
              lodgingStartDate: normalizeDateFromSheet(legCostsData[i][lcIndex['Lodging_Start_Date']]),
              lodgingEndDate: normalizeDateFromSheet(legCostsData[i][lcIndex['Lodging_End_Date']]),
              lodgingUsesItineraryDates: legCostsData[i][lcIndex['Lodging_Uses_Itinerary_Dates']] !== false,
              // Independent M&IE dates (normalized to strings)
              mieStartDate: normalizeDateFromSheet(legCostsData[i][lcIndex['MIE_Start_Date']]),
              mieEndDate: normalizeDateFromSheet(legCostsData[i][lcIndex['MIE_End_Date']]),
              mieUsesItineraryDates: legCostsData[i][lcIndex['MIE_Uses_Itinerary_Dates']] !== false,
              isLocalTravel: legCostsData[i][lcIndex['Is_Local_Travel']] === true,
              lodgingRate: parseFloat(legCostsData[i][lcIndex['Lodging_Rate']]) || 0,
              mieRate: parseFloat(legCostsData[i][lcIndex['MIE_Rate']]) || 0,
              lodgingOverride: legCostsData[i][lcIndex['Lodging_Override']] === true,
              lodgingOverrideAmount: parseFloat(legCostsData[i][lcIndex['Lodging_Override_Amount']]) || 0,
              mieOverride: legCostsData[i][lcIndex['MIE_Override']] === true,
              mieOverrideAmount: parseFloat(legCostsData[i][lcIndex['MIE_Override_Amount']]) || 0,
              localMilesDriven: parseFloat(legCostsData[i][lcIndex['Local_Miles_Driven']]) || 0,
              wasGovVehicleAvailable: legCostsData[i][lcIndex['Was_Gov_Vehicle_Available']] === true,
              localParking: parseFloat(legCostsData[i][lcIndex['Local_Parking']]) || 0,
              localTolls: parseFloat(legCostsData[i][lcIndex['Local_Tolls']]) || 0
            };
          }
        }
      }
    }

    // ========== Recalculate each traveler's costs ==========
    const updatedTravelers = [];
    const dateShifts = [];  // Track custom date shifts for user notification

    // Build map of confirmed shifts for quick lookup: { travelerId: { legId: { lodging, mie } } }
    const confirmedShiftsMap = {};
    if (confirmedDateShifts && confirmedDateShifts.length > 0) {
      for (const travelerShift of confirmedDateShifts) {
        if (!confirmedShiftsMap[travelerShift.travelerId]) {
          confirmedShiftsMap[travelerShift.travelerId] = {};
        }
        for (const shift of travelerShift.shifts || []) {
          confirmedShiftsMap[travelerShift.travelerId][shift.legId] = {
            lodgingStartDate: shift.lodgingShift?.to?.start,
            lodgingEndDate: shift.lodgingShift?.to?.end,
            mieStartDate: shift.mieShift?.to?.start,
            mieEndDate: shift.mieShift?.to?.end
          };
        }
      }
      console.log('Using confirmed date shifts from client:', JSON.stringify(confirmedShiftsMap));
    }

    for (const traveler of travelers) {
      // Get confirmed shifts for this traveler (if any)
      const travelerConfirmedShifts = confirmedShiftsMap[traveler.travelerId] || null;

      // Use shared utility to recalculate costs based on new legs (with smart date shifting or confirmed dates)
      const recalculated = recalculateTravelerForItineraryChange(traveler, newLegs, mileageRates, oldLegsMap, travelerConfirmedShifts);

      updatedTravelers.push({
        travelerId: traveler.travelerId,
        rowIndex: travelerRows[traveler.travelerId],
        ...recalculated
      });

      // Collect date shift info for user notification (only if not using confirmed shifts)
      if (!travelerConfirmedShifts && recalculated.dateShifts && recalculated.dateShifts.length > 0) {
        dateShifts.push({
          travelerId: traveler.travelerId,
          shifts: recalculated.dateShifts
        });
      }
    }

    // ========== Update database with recalculated costs ==========

    // Update traveler totals
    for (const ut of updatedTravelers) {
      const rowNum = ut.rowIndex;
      if (!rowNum) continue;

      if (travelerIndex['Lodging_Total'] !== undefined) {
        travelersSheet.getRange(rowNum, travelerIndex['Lodging_Total'] + 1).setValue(ut.lodgingTotal);
      }
      if (travelerIndex['MIE_Total'] !== undefined) {
        travelersSheet.getRange(rowNum, travelerIndex['MIE_Total'] + 1).setValue(ut.mieTotal);
      }
      if (travelerIndex['Local_Travel_Total'] !== undefined) {
        travelersSheet.getRange(rowNum, travelerIndex['Local_Travel_Total'] + 1).setValue(ut.localTravelTotal);
      }
      if (travelerIndex['Transportation_Total'] !== undefined) {
        travelersSheet.getRange(rowNum, travelerIndex['Transportation_Total'] + 1).setValue(ut.transportationTotal);
      }
      if (travelerIndex['Other_Total'] !== undefined) {
        travelersSheet.getRange(rowNum, travelerIndex['Other_Total'] + 1).setValue(ut.otherTotal);
      }
      if (travelerIndex['Subtotal'] !== undefined) {
        travelersSheet.getRange(rowNum, travelerIndex['Subtotal'] + 1).setValue(ut.subtotal);
      }
    }

    // Update leg costs
    if (legCostsSheet) {
      const legCostsData = legCostsSheet.getDataRange().getValues();
      const lcHeaders = legCostsData[0];
      const lcIndex = {};
      lcHeaders.forEach((h, i) => { lcIndex[h] = i; });

      for (const ut of updatedTravelers) {
        if (!ut.legCosts) continue;

        for (const [legId, legCost] of Object.entries(ut.legCosts)) {
          // Find the original leg cost row
          const originalLegCost = travelers.find(t => t.travelerId === ut.travelerId)?.legCosts[legId];
          const rowNum = originalLegCost?.rowIndex;
          if (!rowNum) continue;

          // Update dates if using itinerary dates (update both lodging and M&IE dates)
          if (lcIndex['Lodging_Start_Date'] !== undefined && legCost.lodgingStartDate) {
            legCostsSheet.getRange(rowNum, lcIndex['Lodging_Start_Date'] + 1).setValue(formatDateForStorage(legCost.lodgingStartDate));
          }
          if (lcIndex['Lodging_End_Date'] !== undefined && legCost.lodgingEndDate) {
            legCostsSheet.getRange(rowNum, lcIndex['Lodging_End_Date'] + 1).setValue(formatDateForStorage(legCost.lodgingEndDate));
          }
          if (lcIndex['MIE_Start_Date'] !== undefined && legCost.mieStartDate) {
            legCostsSheet.getRange(rowNum, lcIndex['MIE_Start_Date'] + 1).setValue(formatDateForStorage(legCost.mieStartDate));
          }
          if (lcIndex['MIE_End_Date'] !== undefined && legCost.mieEndDate) {
            legCostsSheet.getRange(rowNum, lcIndex['MIE_End_Date'] + 1).setValue(formatDateForStorage(legCost.mieEndDate));
          }

          // Update the usesItineraryDates flags (these can change when user clicks "Use Itinerary")
          if (lcIndex['Lodging_Uses_Itinerary_Dates'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['Lodging_Uses_Itinerary_Dates'] + 1).setValue(legCost.lodgingUsesItineraryDates !== false);
          }
          if (lcIndex['MIE_Uses_Itinerary_Dates'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['MIE_Uses_Itinerary_Dates'] + 1).setValue(legCost.mieUsesItineraryDates !== false);
          }

          // Clear overrides since dates/cities changed
          if (lcIndex['Lodging_Override'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['Lodging_Override'] + 1).setValue(false);
          }
          if (lcIndex['Lodging_Override_Amount'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['Lodging_Override_Amount'] + 1).setValue('');
          }
          if (lcIndex['Lodging_Override_Reason'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['Lodging_Override_Reason'] + 1).setValue('');
          }
          if (lcIndex['MIE_Override'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['MIE_Override'] + 1).setValue(false);
          }
          if (lcIndex['MIE_Override_Amount'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['MIE_Override_Amount'] + 1).setValue('');
          }
          if (lcIndex['MIE_Override_Reason'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['MIE_Override_Reason'] + 1).setValue('');
          }

          // Update calculated values
          if (lcIndex['Lodging_Nights'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['Lodging_Nights'] + 1).setValue(legCost.lodgingNights || 0);
          }
          if (lcIndex['Lodging_Calculated'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['Lodging_Calculated'] + 1).setValue(legCost.lodgingCalculated || 0);
          }
          if (lcIndex['Lodging_Total'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['Lodging_Total'] + 1).setValue(legCost.lodgingTotal || 0);
          }
          if (lcIndex['MIE_Days'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['MIE_Days'] + 1).setValue(legCost.mieDays || 0);
          }
          if (lcIndex['MIE_Calculated'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['MIE_Calculated'] + 1).setValue(legCost.mieCalculated || 0);
          }
          if (lcIndex['MIE_Total'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['MIE_Total'] + 1).setValue(legCost.mieTotal || 0);
          }
          if (lcIndex['Leg_Subtotal'] !== undefined) {
            legCostsSheet.getRange(rowNum, lcIndex['Leg_Subtotal'] + 1).setValue(legCost.legSubtotal || 0);
          }
        }
      }
    }

    // ========== Calculate and update request totals ==========
    const travelerTotal = updatedTravelers.reduce((sum, t) => sum + (t.subtotal || 0), 0);

    // Get shared costs from request
    const requestsData = requestsSheet.getDataRange().getValues();
    const reqHeaders = requestsData[0];
    const reqIndex = {};
    reqHeaders.forEach((h, i) => { reqIndex[h] = i; });

    let requestRowIndex = -1;
    let sharedTotal = 0;

    for (let i = 1; i < requestsData.length; i++) {
      if (requestsData[i][reqIndex['Request_ID']] === requestId) {
        requestRowIndex = i + 1;
        sharedTotal = parseFloat(requestsData[i][reqIndex['Shared_Total']]) || 0;
        break;
      }
    }

    const grandTotal = calculateGrandTotal(travelerTotal, sharedTotal);

    if (requestRowIndex > 0) {
      if (reqIndex['Traveler_Total'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, reqIndex['Traveler_Total'] + 1).setValue(travelerTotal);
      }
      if (reqIndex['Grand_Total'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, reqIndex['Grand_Total'] + 1).setValue(grandTotal);
      }
    }

    console.log(`Recalculated costs for ${requestId}: ${updatedTravelers.length} travelers, grand total: ${grandTotal}`);

    // Sanitize legCosts to ensure all dates are strings (Date objects don't serialize)
    const sanitizeLegCosts = (legCosts) => {
      if (!legCosts) return {};
      const sanitized = {};
      for (const [legId, lc] of Object.entries(legCosts)) {
        sanitized[legId] = {
          ...lc,
          // Sanitize independent lodging dates
          lodgingStartDate: lc.lodgingStartDate instanceof Date ? lc.lodgingStartDate.toISOString() : (lc.lodgingStartDate || ''),
          lodgingEndDate: lc.lodgingEndDate instanceof Date ? lc.lodgingEndDate.toISOString() : (lc.lodgingEndDate || ''),
          // Sanitize independent M&IE dates
          mieStartDate: lc.mieStartDate instanceof Date ? lc.mieStartDate.toISOString() : (lc.mieStartDate || ''),
          mieEndDate: lc.mieEndDate instanceof Date ? lc.mieEndDate.toISOString() : (lc.mieEndDate || '')
        };
        // Remove rowIndex - internal only
        delete sanitized[legId].rowIndex;
      }
      return sanitized;
    };

    // Sanitize dateShifts to ensure all dates are strings
    const sanitizeDateStr = (val) => formatDateForStorage(val);

    const sanitizedDateShifts = dateShifts.map(ds => ({
      travelerId: ds.travelerId,
      shifts: ds.shifts.map(shift => ({
        legId: shift.legId,
        location: shift.location || '',
        lodgingShifted: shift.lodgingShifted ? {
          from: { start: sanitizeDateStr(shift.lodgingShifted.from?.start), end: sanitizeDateStr(shift.lodgingShifted.from?.end) },
          to: { start: sanitizeDateStr(shift.lodgingShifted.to?.start), end: sanitizeDateStr(shift.lodgingShifted.to?.end) }
        } : null,
        mieShifted: shift.mieShifted ? {
          from: { start: sanitizeDateStr(shift.mieShifted.from?.start), end: sanitizeDateStr(shift.mieShifted.from?.end) },
          to: { start: sanitizeDateStr(shift.mieShifted.to?.start), end: sanitizeDateStr(shift.mieShifted.to?.end) }
        } : null
      }))
    }));

    return {
      success: true,
      travelers: updatedTravelers.map(t => ({
        travelerId: t.travelerId,
        lodgingTotal: t.lodgingTotal,
        mieTotal: t.mieTotal,
        localTravelTotal: t.localTravelTotal,
        transportationTotal: t.transportationTotal,
        otherTotal: t.otherTotal,
        subtotal: t.subtotal,
        legCosts: sanitizeLegCosts(t.legCosts)
      })),
      totals: {
        travelerTotal,
        sharedTotal,
        grandTotal
      },
      dateShifts: sanitizedDateShifts
    };

  } catch (error) {
    logError('recalculateRequestCostsAfterItineraryChange', error, { requestId: requestId });
    return { success: false, error: error.message };
  }
}

/**
 * Update travelers from the review page (submitter mode).
 * Handles justification updates and traveler removal.
 *
 * Write pattern: per-cell setValue inside the traveler loop + a single
 * trailing db.invalidate() per affected sheet (decision #4).
 *
 * @param {Object} updates - The update payload
 * @param {string} updates.requestId - The request ID
 * @param {Array} updates.travelers - Array of { travelerId, roleJustification }
 * @param {Array} updates.removedTravelerIds - Array of traveler IDs to remove
 * @returns {Object} successResponse({ travelerTotal, grandTotal }) or errorResponse(msg)
 * @client
 */
function updateTravelersForReview(updates) {
  try {
    const { requestId, travelers, removedTravelerIds } = updates;

    if (!requestId) {
      throw new Error('Request ID is required');
    }

    const db = new TravelDB();
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
    const travelersSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);
    const legCostsSheet = db.sheet(SHEET_NAMES.TRAVELER_LEG_COSTS);

    if (!requestsSheet || !travelersSheet) {
      throw new Error('Required sheets not found');
    }

    // Get column indices for travelers sheet
    const travelersData = travelersSheet.getDataRange().getValues();
    const travelerHeaders = travelersData[0];
    const travelerIndex = {};
    travelerHeaders.forEach((h, i) => { travelerIndex[h] = i; });

    // Get column indices for requests sheet
    const requestsData = requestsSheet.getDataRange().getValues();
    const requestHeaders = requestsData[0];
    const requestIndex = {};
    requestHeaders.forEach((h, i) => { requestIndex[h] = i; });

    // ========== Remove travelers ==========
    if (removedTravelerIds && removedTravelerIds.length > 0) {
      // First, remove leg costs for these travelers
      if (legCostsSheet) {
        const legCostsData = legCostsSheet.getDataRange().getValues();
        const lcHeaders = legCostsData[0];
        const lcIndex = {};
        lcHeaders.forEach((h, i) => { lcIndex[h] = i; });

        // Find rows to delete (in reverse order to maintain row indices)
        const rowsToDelete = [];
        for (let i = legCostsData.length - 1; i >= 1; i--) {
          const travelerId = legCostsData[i][lcIndex['Traveler_ID']];
          if (removedTravelerIds.includes(travelerId)) {
            rowsToDelete.push(i + 1); // 1-based for sheet
          }
        }

        // Delete leg cost rows
        for (const rowNum of rowsToDelete) {
          legCostsSheet.deleteRow(rowNum);
        }
      }

      // Now remove traveler rows (in reverse order)
      const travelerRowsToDelete = [];
      for (let i = travelersData.length - 1; i >= 1; i--) {
        const travelerId = travelersData[i][travelerIndex['Traveler_ID']];
        const travelerRequestId = travelersData[i][travelerIndex['Request_ID']];
        if (travelerRequestId === requestId && removedTravelerIds.includes(travelerId)) {
          travelerRowsToDelete.push(i + 1); // 1-based for sheet
        }
      }

      for (const rowNum of travelerRowsToDelete) {
        travelersSheet.deleteRow(rowNum);
      }

      console.log(`Removed ${removedTravelerIds.length} travelers from request ${requestId}`);
    }

    // ========== Update justifications + funding types ==========
    // Re-read travelers data after deletions
    const updatedTravelersData = travelersSheet.getDataRange().getValues();

    // Track changes for logging
    const justificationChanges = [];
    const fundingChanges = [];

    // Normalize a stored Is_Client_Paid value to canonical 'client' or 'overhead'
    function _normalizeFunding(raw) {
      const s = String(raw || '').toLowerCase().trim();
      return s.includes('client') ? 'client' : 'overhead';
    }

    for (const traveler of travelers) {
      // Find the traveler row
      let travelerRowIndex = -1;
      let oldJustification = '';
      let oldFundingRaw = '';
      let travelerName = '';

      for (let i = 1; i < updatedTravelersData.length; i++) {
        if (updatedTravelersData[i][travelerIndex['Traveler_ID']] === traveler.travelerId &&
            updatedTravelersData[i][travelerIndex['Request_ID']] === requestId) {
          travelerRowIndex = i + 1; // 1-based for sheet
          oldJustification = updatedTravelersData[i][travelerIndex['Role_Justification']] || '';
          oldFundingRaw = updatedTravelersData[i][travelerIndex['Is_Client_Paid']] || '';
          travelerName = updatedTravelersData[i][travelerIndex['Employee_Name']] || '';
          break;
        }
      }

      if (travelerRowIndex === -1) continue;

      const newJustification = traveler.roleJustification || '';

      // Only update and track if justification actually changed
      if (oldJustification !== newJustification) {
        if (travelerIndex['Role_Justification'] !== undefined) {
          travelersSheet.getRange(travelerRowIndex, travelerIndex['Role_Justification'] + 1)
            .setValue(newJustification);
        }

        justificationChanges.push({
          travelerId: traveler.travelerId,
          name: travelerName,
          old: oldJustification,
          new: newJustification
        });
      }

      // Funding type — only if client sent a non-empty isClientPaid
      if (traveler.isClientPaid !== undefined && traveler.isClientPaid !== null) {
        const oldFunding = _normalizeFunding(oldFundingRaw);
        const newFunding = _normalizeFunding(traveler.isClientPaid);

        if (oldFunding !== newFunding) {
          // Persist the new value as the canonical lowercase form
          if (travelerIndex['Is_Client_Paid'] !== undefined) {
            travelersSheet.getRange(travelerRowIndex, travelerIndex['Is_Client_Paid'] + 1)
              .setValue(newFunding);
          }

          // Clear any stale DD confirmation state — DD applies only to overhead
          // travelers, so the prior flag is meaningless after a flip either way.
          if (travelerIndex['DD_Confirmed'] !== undefined) {
            travelersSheet.getRange(travelerRowIndex, travelerIndex['DD_Confirmed'] + 1).setValue(false);
          }
          if (travelerIndex['DD_Confirmed_At'] !== undefined) {
            travelersSheet.getRange(travelerRowIndex, travelerIndex['DD_Confirmed_At'] + 1).setValue('');
          }

          fundingChanges.push({
            travelerId: traveler.travelerId,
            name: travelerName,
            old: oldFunding,
            new: newFunding
          });
        }
      }
    }

    // ========== Recalculate totals ==========
    // Re-read all data after updates
    const finalTravelersData = travelersSheet.getDataRange().getValues();
    const finalRequestsData = requestsSheet.getDataRange().getValues();

    // Calculate new traveler total (just the running sum — full shape comes
    // from getRequestForReview below so the client's _calculateCostSummary
    // gets every field it needs).
    let travelerTotal = 0;
    for (let i = 1; i < finalTravelersData.length; i++) {
      if (finalTravelersData[i][travelerIndex['Request_ID']] === requestId) {
        travelerTotal += parseFloat(finalTravelersData[i][travelerIndex['Subtotal']]) || 0;
      }
    }

    // Get shared total from request
    let requestRowIndex = -1;
    let sharedTotal = 0;

    for (let i = 1; i < finalRequestsData.length; i++) {
      if (finalRequestsData[i][requestIndex['Request_ID']] === requestId) {
        requestRowIndex = i + 1;
        sharedTotal = parseFloat(finalRequestsData[i][requestIndex['Shared_Total']]) || 0;
        break;
      }
    }

    const grandTotal = calculateGrandTotal(travelerTotal, sharedTotal);

    // Update request totals
    const now = new Date();
    let currentStatus = '';
    let currentVersion = 1;

    if (requestRowIndex > 0) {
      currentStatus = finalRequestsData[requestRowIndex - 1][requestIndex['Status']] || '';
      currentVersion = parseInt(finalRequestsData[requestRowIndex - 1][requestIndex['Version']]) || 1;

      if (requestIndex['Traveler_Total'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Traveler_Total'] + 1).setValue(travelerTotal);
      }
      if (requestIndex['Grand_Total'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Grand_Total'] + 1).setValue(grandTotal);
      }
      if (requestIndex['Updated_At'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Updated_At'] + 1).setValue(now);
      }
    }

    // ========== Log the change to Approval_Log ==========
    const currentUserEmail = Session.getActiveUser().getEmail();
    const approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);

    if (approvalLogSheet) {
      const logId = generateLogId();

      // Build change summary
      const parts = [];
      if (removedTravelerIds && removedTravelerIds.length > 0) {
        parts.push(`${removedTravelerIds.length} removed`);
      }
      if (justificationChanges.length > 0) {
        parts.push(`${justificationChanges.length} justification${justificationChanges.length > 1 ? 's' : ''} updated`);
      }
      if (fundingChanges.length > 0) {
        parts.push(`${fundingChanges.length} funding type${fundingChanges.length > 1 ? 's' : ''} changed`);
      }

      const changeDetails = {
        removedTravelerIds: removedTravelerIds || [],
        updatedJustifications: justificationChanges,
        updatedFundingTypes: fundingChanges
      };

      // Only log if there are actual changes
      if ((removedTravelerIds && removedTravelerIds.length > 0) || justificationChanges.length > 0 || fundingChanges.length > 0) {
        approvalLogSheet.appendRow([
          logId,
          requestId,
          ACTION_TYPES.EDIT_TRAVELERS,
          currentUserEmail,
          currentUserEmail,
          'Submitter',
          now,
          currentStatus,
          currentStatus,  // Status doesn't change
          `Travelers modified: ${parts.join(', ') || 'justifications updated'}`,
          JSON.stringify(changeDetails),
          '',
          currentVersion,
          currentVersion  // Version doesn't change for edits
        ]);
      }
    }

    // Invalidate cache layers so the NEXT page-load sees fresh data.
    // (We don't re-read here — the client merges totals from this thin
    // response into local state, which already reflects the user's edits.)
    db.invalidate(SHEET_NAMES.REQUEST_TRAVELERS);
    db.invalidate(SHEET_NAMES.TRAVELER_LEG_COSTS);
    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    try { CacheService.getScriptCache().remove('request_review_v2_' + requestId); } catch (ce) { /* ignore */ }

    console.log(`Updated travelers for request ${requestId}: traveler total $${travelerTotal}, grand total $${grandTotal}`);

    return successResponse({
      travelerTotal: travelerTotal,
      grandTotal: grandTotal
    });

  } catch (error) {
    logError('updateTravelersForReview', error, { requestId: updates && updates.requestId });
    return errorResponse(error.message || 'Failed to update travelers');
  }
}

/**
 * Update shared costs from the review page (submitter mode).
 *
 * @param {Object} updates - The update payload
 * @param {string} updates.requestId - The request ID
 * @param {Object} updates.sharedCosts - Object with facilities, audioVisual, logistics, other
 * @returns {Object} successResponse({ sharedTotal, grandTotal }) or errorResponse(msg)
 * @client
 */
function updateSharedCostsForReview(updates) {
  try {
    const { requestId, sharedCosts } = updates;

    if (!requestId) {
      throw new Error('Request ID is required');
    }

    const db = new TravelDB();
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);

    if (!requestsSheet) {
      throw new Error('Requests sheet not found');
    }

    // Get column indices
    const requestsData = requestsSheet.getDataRange().getValues();
    const requestHeaders = requestsData[0];
    const requestIndex = {};
    requestHeaders.forEach((h, i) => { requestIndex[h] = i; });

    // Find the request row and capture old shared costs
    let requestRowIndex = -1;
    let currentStatus = '';
    let currentVersion = 1;
    let travelerTotal = 0;
    let oldSharedCosts = {};

    for (let i = 1; i < requestsData.length; i++) {
      if (requestsData[i][requestIndex['Request_ID']] === requestId) {
        requestRowIndex = i + 1; // 1-based for sheet
        currentStatus = requestsData[i][requestIndex['Status']] || '';
        currentVersion = parseInt(requestsData[i][requestIndex['Version']]) || 1;
        travelerTotal = parseFloat(requestsData[i][requestIndex['Traveler_Total']]) || 0;
        // Capture old shared costs for delta
        const oldSharedCostsStr = requestsData[i][requestIndex['Shared_Costs']] || '{}';
        try {
          oldSharedCosts = JSON.parse(oldSharedCostsStr);
        } catch (e) {
          oldSharedCosts = {};
        }
        break;
      }
    }

    if (requestRowIndex === -1) {
      throw new Error('Request not found');
    }

    // Calculate shared total
    const sharedTotal =
      (parseFloat(sharedCosts.facilities?.amount) || 0) +
      (parseFloat(sharedCosts.audioVisual?.amount) || 0) +
      (parseFloat(sharedCosts.logistics?.amount) || 0) +
      (parseFloat(sharedCosts.other?.amount) || 0);

    const grandTotal = calculateGrandTotal(travelerTotal, sharedTotal);
    const now = new Date();

    // Update shared costs fields
    if (requestIndex['Shared_Costs'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, requestIndex['Shared_Costs'] + 1)
        .setValue(JSON.stringify(sharedCosts));
    }
    if (requestIndex['Shared_Total'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, requestIndex['Shared_Total'] + 1)
        .setValue(sharedTotal);
    }
    if (requestIndex['Grand_Total'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, requestIndex['Grand_Total'] + 1)
        .setValue(grandTotal);
    }
    if (requestIndex['Updated_At'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, requestIndex['Updated_At'] + 1)
        .setValue(now);
    }

    // ========== Log the change to Approval_Log ==========
    const currentUserEmail = Session.getActiveUser().getEmail();
    const approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);

    if (approvalLogSheet) {
      const logId = generateLogId();

      // Build delta - only include categories that changed
      const changedCategories = {};
      const categories = ['facilities', 'audioVisual', 'logistics', 'other'];

      categories.forEach(cat => {
        const oldAmount = parseFloat(oldSharedCosts[cat]?.amount) || 0;
        const newAmount = parseFloat(sharedCosts[cat]?.amount) || 0;
        const oldDesc = oldSharedCosts[cat]?.description || '';
        const newDesc = sharedCosts[cat]?.description || '';

        if (oldAmount !== newAmount || oldDesc !== newDesc) {
          changedCategories[cat] = {
            old: { amount: oldAmount, description: oldDesc },
            new: { amount: newAmount, description: newDesc }
          };
        }
      });

      const changeDetails = {
        changes: changedCategories,
        sharedTotal: sharedTotal
      };

      approvalLogSheet.appendRow([
        logId,
        requestId,
        'Edit_SharedCosts',
        currentUserEmail,
        currentUserEmail,
        'Submitter',
        now,
        currentStatus,
        currentStatus,  // Status doesn't change
        `Shared costs updated: ${sharedTotal > 0 ? '$' + sharedTotal.toFixed(2) : '$0.00'}`,
        JSON.stringify(changeDetails),
        '',
        currentVersion,
        currentVersion  // Version doesn't change for edits
      ]);
    }

    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    try { CacheService.getScriptCache().remove('request_review_v2_' + requestId); } catch (ce) { /* ignore */ }

    console.log(`Updated shared costs for request ${requestId}: shared total $${sharedTotal}, grand total $${grandTotal}`);

    return successResponse({
      sharedTotal: sharedTotal,
      grandTotal: grandTotal
    });

  } catch (error) {
    logError('updateSharedCostsForReview', error, { requestId: updates && updates.requestId });
    return errorResponse(error.message || 'Failed to update shared costs');
  }
}

// ============================================================================
// UPDATE COSTS FOR REVIEW (Combined Shared + Traveler Leg Costs)
// ============================================================================

/**
 * Update all costs for a travel request from review page.
 * Handles shared costs, transport costs, traveler leg cost dates/overrides,
 * and leg removals.
 *
 * Write pattern: per-cell setValue across 4 sheets + a single trailing
 * db.invalidate() per affected sheet at the end (decision #4).
 *
 * @param {Object} updates - The update payload
 * @param {string} updates.requestId - The request ID
 * @param {Object} updates.sharedCosts - Shared costs object
 * @param {Array} updates.travelerTransport - Array of traveler transport cost updates
 * @param {Array} updates.travelerLegCosts - Array of traveler leg cost updates
 * @param {Array} updates.removedLegCosts - Array of {travelerId, legId} to remove
 * @returns {Object} successResponse({ sharedTotal, travelerTotal, grandTotal, travelers }) or errorResponse(msg)
 * @client
 */
function updateCostsForReview(updates) {
  try {
    const { requestId, sharedCosts, travelerTransport, travelerLegCosts, removedLegCosts } = updates;

    if (!requestId) {
      throw new Error('Request ID is required');
    }

    const db = new TravelDB();
    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
    const legCostsSheet = db.sheet(SHEET_NAMES.TRAVELER_LEG_COSTS);
    const legsSheet = db.sheet(SHEET_NAMES.REQUEST_LEGS);

    if (!requestsSheet) {
      throw new Error('Requests sheet not found');
    }

    // Load legs data for location info (needed for per diem lookups)
    const legsMap = {};
    if (legsSheet && legsSheet.getLastRow() > 1) {
      const legsData = legsSheet.getDataRange().getValues();
      const legsHeaders = legsData[0];
      const legsIndex = {};
      legsHeaders.forEach((h, i) => { legsIndex[h] = i; });

      for (let i = 1; i < legsData.length; i++) {
        if (legsData[i][legsIndex['Request_ID']] === requestId) {
          const legId = legsData[i][legsIndex['Leg_ID']];
          legsMap[legId] = {
            legId,
            city: legsData[i][legsIndex['City']] || '',
            state: legsData[i][legsIndex['State']] || '',
            country: legsData[i][legsIndex['Country']] || 'United States',
            isInternational: legsData[i][legsIndex['Is_International']] === true,
            startDate: formatDateForStorage(legsData[i][legsIndex['Start_Date']]),
            endDate: formatDateForStorage(legsData[i][legsIndex['End_Date']])
          };
        }
      }
    }

    // Get requests column indices
    const requestsData = requestsSheet.getDataRange().getValues();
    const requestHeaders = requestsData[0];
    const requestIndex = {};
    requestHeaders.forEach((h, i) => { requestIndex[h] = i; });

    // Find the request row and capture old totals
    let requestRowIndex = -1;
    let currentStatus = '';
    let currentVersion = 1;
    let oldSharedTotal = 0;
    let oldTravelerTotal = 0;
    let oldGrandTotal = 0;
    // Per-category snapshots for the edit-history delta (Approval_Log)
    const oldSharedByCategory = {
      facilities:  { amount: 0, description: '' },
      audioVisual: { amount: 0, description: '' },
      logistics:   { amount: 0, description: '' },
      other:       { amount: 0, description: '' }
    };

    for (let i = 1; i < requestsData.length; i++) {
      if (requestsData[i][requestIndex['Request_ID']] === requestId) {
        requestRowIndex = i + 1; // 1-based for sheet
        currentStatus = requestsData[i][requestIndex['Status']] || '';
        currentVersion = parseInt(requestsData[i][requestIndex['Version']]) || 1;
        // Capture old totals for delta logging
        oldSharedTotal = parseFloat(requestsData[i][requestIndex['Shared_Total']]) || 0;
        oldTravelerTotal = parseFloat(requestsData[i][requestIndex['Traveler_Total']]) || 0;
        oldGrandTotal = parseFloat(requestsData[i][requestIndex['Grand_Total']]) || 0;
        // Per-category snapshots
        if (requestIndex['Shared_Facilities'] !== undefined) {
          oldSharedByCategory.facilities.amount = parseFloat(requestsData[i][requestIndex['Shared_Facilities']]) || 0;
        }
        if (requestIndex['Shared_Facilities_Desc'] !== undefined) {
          oldSharedByCategory.facilities.description = requestsData[i][requestIndex['Shared_Facilities_Desc']] || '';
        }
        if (requestIndex['Shared_AV'] !== undefined) {
          oldSharedByCategory.audioVisual.amount = parseFloat(requestsData[i][requestIndex['Shared_AV']]) || 0;
        }
        if (requestIndex['Shared_AV_Desc'] !== undefined) {
          oldSharedByCategory.audioVisual.description = requestsData[i][requestIndex['Shared_AV_Desc']] || '';
        }
        if (requestIndex['Shared_Logistics'] !== undefined) {
          oldSharedByCategory.logistics.amount = parseFloat(requestsData[i][requestIndex['Shared_Logistics']]) || 0;
        }
        if (requestIndex['Shared_Logistics_Desc'] !== undefined) {
          oldSharedByCategory.logistics.description = requestsData[i][requestIndex['Shared_Logistics_Desc']] || '';
        }
        if (requestIndex['Shared_Other'] !== undefined) {
          oldSharedByCategory.other.amount = parseFloat(requestsData[i][requestIndex['Shared_Other']]) || 0;
        }
        if (requestIndex['Shared_Other_Desc'] !== undefined) {
          oldSharedByCategory.other.description = requestsData[i][requestIndex['Shared_Other_Desc']] || '';
        }
        break;
      }
    }

    if (requestRowIndex === -1) {
      throw new Error('Request not found');
    }

    // Track changes for logging - include old/new totals
    const changeDetails = {
      legCostsRemoved: 0
    };

    // ========== Update Shared Costs ==========
    const sharedTotal =
      (parseFloat(sharedCosts?.facilities?.amount) || 0) +
      (parseFloat(sharedCosts?.audioVisual?.amount) || 0) +
      (parseFloat(sharedCosts?.logistics?.amount) || 0) +
      (parseFloat(sharedCosts?.other?.amount) || 0);

    if (sharedCosts) {
      // Update individual shared cost columns
      if (requestIndex['Shared_Facilities'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Shared_Facilities'] + 1)
          .setValue(parseFloat(sharedCosts.facilities?.amount) || 0);
      }
      if (requestIndex['Shared_Facilities_Desc'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Shared_Facilities_Desc'] + 1)
          .setValue(sharedCosts.facilities?.description || '');
      }
      if (requestIndex['Shared_AV'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Shared_AV'] + 1)
          .setValue(parseFloat(sharedCosts.audioVisual?.amount) || 0);
      }
      if (requestIndex['Shared_AV_Desc'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Shared_AV_Desc'] + 1)
          .setValue(sharedCosts.audioVisual?.description || '');
      }
      if (requestIndex['Shared_Logistics'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Shared_Logistics'] + 1)
          .setValue(parseFloat(sharedCosts.logistics?.amount) || 0);
      }
      if (requestIndex['Shared_Logistics_Desc'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Shared_Logistics_Desc'] + 1)
          .setValue(sharedCosts.logistics?.description || '');
      }
      if (requestIndex['Shared_Other'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Shared_Other'] + 1)
          .setValue(parseFloat(sharedCosts.other?.amount) || 0);
      }
      if (requestIndex['Shared_Other_Desc'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Shared_Other_Desc'] + 1)
          .setValue(sharedCosts.other?.description || '');
      }
      if (requestIndex['Shared_Total'] !== undefined) {
        requestsSheet.getRange(requestRowIndex, requestIndex['Shared_Total'] + 1)
          .setValue(sharedTotal);
      }
    }

    // ========== Update Traveler Transport Costs ==========
    const travSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);
    const transportChanges = []; // Track detailed transport changes

    if (travSheet && travelerTransport && travelerTransport.length > 0) {
      const travData = travSheet.getDataRange().getValues();
      const travHeaders = travData[0];
      const travIdx = {};
      travHeaders.forEach((h, i) => { travIdx[h] = i; });

      for (let i = 1; i < travData.length; i++) {
        if (travData[i][travIdx['Request_ID']] === requestId) {
          const tId = travData[i][travIdx['Traveler_ID']];
          const travelerName = travData[i][travIdx['Employee_Name']] || 'Unknown';
          const transportUpdate = travelerTransport.find(t => t.travelerId === tId);

          if (transportUpdate) {
            const sheetRow = i + 1; // 1-based

            // Capture old values for delta
            const oldTransportMode = travData[i][travIdx['Transport_Mode']] || '';
            const oldTicketCost = parseFloat(travData[i][travIdx['Ticket_Cost']]) || 0;
            const oldTotalMiles = parseFloat(travData[i][travIdx['Total_Miles']]) || 0;
            const oldNeedsRentalCar = travData[i][travIdx['Needs_Rental_Car']] === true || travData[i][travIdx['Needs_Rental_Car']] === 'true';
            const oldRentalCarCost = parseFloat(travData[i][travIdx['Rental_Car_Cost']]) || 0;
            const oldIsFullTimeTelework = travData[i][travIdx['Is_Full_Time_Telework']] === true;
            const oldNormalCommuteDistance = parseFloat(travData[i][travIdx['Normal_Commute_Distance']]) || 0;
            const oldNormalCommuteParking = parseFloat(travData[i][travIdx['Normal_Commute_Parking']]) || 0;

            // Build delta for this traveler
            const travelerDelta = { travelerId: tId, name: travelerName };
            const newTransportMode = transportUpdate.transportMode || '';
            const newTicketCost = parseFloat(transportUpdate.ticketCost) || 0;
            const newTotalMiles = parseFloat(transportUpdate.totalMiles) || 0;
            const newNeedsRentalCar = transportUpdate.needsRentalCar === true;
            const newRentalCarCost = parseFloat(transportUpdate.rentalCarCost) || 0;
            const newIsFullTimeTelework = transportUpdate.isFullTimeTelework === true;
            const newNormalCommuteDistance = parseFloat(transportUpdate.normalCommuteDistance) || 0;
            const newNormalCommuteParking = parseFloat(transportUpdate.normalCommuteParking) || 0;

            if (oldTransportMode !== newTransportMode) {
              travelerDelta.transportMode = { old: oldTransportMode || 'air', new: newTransportMode || 'air' };
            }
            if (oldTicketCost !== newTicketCost) {
              travelerDelta.ticketCost = { old: oldTicketCost, new: newTicketCost };
            }
            if (oldTotalMiles !== newTotalMiles) {
              travelerDelta.totalMiles = { old: oldTotalMiles, new: newTotalMiles };
            }
            if (oldNeedsRentalCar !== newNeedsRentalCar) {
              travelerDelta.needsRentalCar = { old: oldNeedsRentalCar, new: newNeedsRentalCar };
            }
            if (oldRentalCarCost !== newRentalCarCost) {
              travelerDelta.rentalCarCost = { old: oldRentalCarCost, new: newRentalCarCost };
            }
            // Track commute info changes (affects local travel calculations)
            if (oldIsFullTimeTelework !== newIsFullTimeTelework) {
              travelerDelta.isFullTimeTelework = { old: oldIsFullTimeTelework, new: newIsFullTimeTelework };
            }
            if (oldNormalCommuteDistance !== newNormalCommuteDistance) {
              travelerDelta.normalCommuteDistance = { old: oldNormalCommuteDistance, new: newNormalCommuteDistance };
            }
            if (oldNormalCommuteParking !== newNormalCommuteParking) {
              travelerDelta.normalCommuteParking = { old: oldNormalCommuteParking, new: newNormalCommuteParking };
            }

            // Only add if there were actual changes (more than just travelerId and name)
            if (Object.keys(travelerDelta).length > 2) {
              transportChanges.push(travelerDelta);
            }

            // Update Transport_Mode
            if (travIdx['Transport_Mode'] !== undefined && transportUpdate.transportMode) {
              travSheet.getRange(sheetRow, travIdx['Transport_Mode'] + 1)
                .setValue(transportUpdate.transportMode);
            }

            // Clear ticket cost for mileage modes, clear miles for non-mileage modes
            const isMileageMode = transportUpdate.transportMode === 'private' || transportUpdate.transportMode === 'gov';
            if (travIdx['Ticket_Cost'] !== undefined) {
              travSheet.getRange(sheetRow, travIdx['Ticket_Cost'] + 1)
                .setValue(isMileageMode ? 0 : (transportUpdate.ticketCost || 0));
            }
            if (travIdx['Total_Miles'] !== undefined) {
              travSheet.getRange(sheetRow, travIdx['Total_Miles'] + 1)
                .setValue(isMileageMode ? (transportUpdate.totalMiles || 0) : 0);
            }
            // Update mileage rate for POV/GOV modes
            if (travIdx['Mileage_Rate'] !== undefined) {
              const mileageRates = getMileageRates();
              const rate = isMileageMode
                ? (transportUpdate.transportMode === 'gov' ? mileageRates.gov : mileageRates.private)
                : 0;
              travSheet.getRange(sheetRow, travIdx['Mileage_Rate'] + 1).setValue(rate);
            }
            if (travIdx['Needs_Rental_Car'] !== undefined) {
              travSheet.getRange(sheetRow, travIdx['Needs_Rental_Car'] + 1)
                .setValue(transportUpdate.needsRentalCar || false);
            }
            if (travIdx['Rental_Car_Cost'] !== undefined) {
              travSheet.getRange(sheetRow, travIdx['Rental_Car_Cost'] + 1)
                .setValue(transportUpdate.rentalCarCost || 0);
            }
            if (travIdx['Transportation_Total'] !== undefined) {
              travSheet.getRange(sheetRow, travIdx['Transportation_Total'] + 1)
                .setValue(transportUpdate.transportationTotal || 0);
            }

            // Update commute info for local travel calculations
            if (travIdx['Is_Full_Time_Telework'] !== undefined) {
              travSheet.getRange(sheetRow, travIdx['Is_Full_Time_Telework'] + 1)
                .setValue(transportUpdate.isFullTimeTelework || false);
            }
            if (travIdx['Normal_Commute_Distance'] !== undefined) {
              travSheet.getRange(sheetRow, travIdx['Normal_Commute_Distance'] + 1)
                .setValue(transportUpdate.normalCommuteDistance || 0);
            }
            if (travIdx['Normal_Commute_Parking'] !== undefined) {
              travSheet.getRange(sheetRow, travIdx['Normal_Commute_Parking'] + 1)
                .setValue(transportUpdate.normalCommuteParking || 0);
            }
          }
        }
      }
    }

    // ========== Process Traveler Leg Costs ==========
    if (legCostsSheet && legCostsSheet.getLastRow() > 1) {
      const legCostsData = legCostsSheet.getDataRange().getValues();
      const lcHeaders = legCostsData[0];
      const lcIndex = {};
      lcHeaders.forEach((h, i) => { lcIndex[h] = i; });

      // First, handle removals
      if (removedLegCosts && removedLegCosts.length > 0) {
        // Find and delete rows (working backwards to preserve indices)
        const rowsToDelete = [];
        for (let i = 1; i < legCostsData.length; i++) {
          const rowRequestId = legCostsData[i][lcIndex['Request_ID']];
          const rowTravelerId = legCostsData[i][lcIndex['Traveler_ID']];
          const rowLegId = legCostsData[i][lcIndex['Leg_ID']];

          if (rowRequestId === requestId) {
            const isRemoved = removedLegCosts.some(
              r => r.travelerId === rowTravelerId && r.legId === rowLegId
            );
            if (isRemoved) {
              rowsToDelete.push(i + 1); // 1-based for sheet
            }
          }
        }

        // Delete rows in reverse order
        rowsToDelete.sort((a, b) => b - a).forEach(row => {
          legCostsSheet.deleteRow(row);
          changeDetails.legCostsRemoved++;
        });

        // Refresh data after deletions
        if (rowsToDelete.length > 0) {
          // Re-read the sheet data
          const refreshedData = legCostsSheet.getDataRange().getValues();
          legCostsData.length = 0;
          refreshedData.forEach(row => legCostsData.push(row));
        }
      }

      // Now update existing leg costs
      const legCostChanges = []; // Track detailed leg cost changes

      if (travelerLegCosts && travelerLegCosts.length > 0) {
        // Get traveler names for logging
        const travelerNames = {};
        const travSheet2 = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);
        if (travSheet2) {
          const travData2 = travSheet2.getDataRange().getValues();
          const travHeaders2 = travData2[0];
          const nameIdx = travHeaders2.indexOf('Employee_Name');
          const tidIdx = travHeaders2.indexOf('Traveler_ID');
          const ridIdx = travHeaders2.indexOf('Request_ID');
          for (let t = 1; t < travData2.length; t++) {
            if (travData2[t][ridIdx] === requestId) {
              travelerNames[travData2[t][tidIdx]] = travData2[t][nameIdx] || 'Unknown';
            }
          }
        }

        for (let i = 1; i < legCostsData.length; i++) {
          const rowRequestId = legCostsData[i][lcIndex['Request_ID']];
          const rowTravelerId = legCostsData[i][lcIndex['Traveler_ID']];
          const rowLegId = legCostsData[i][lcIndex['Leg_ID']];

          if (rowRequestId === requestId) {
            const update = travelerLegCosts.find(
              u => u.travelerId === rowTravelerId && u.legId === rowLegId
            );

            if (update) {
              const sheetRow = i + 1; // 1-based
              const legCity = legCostsData[i][lcIndex['City']] || 'Unknown';
              const travelerName = travelerNames[rowTravelerId] || 'Unknown';

              // Capture old values for delta - independent lodging and M&IE dates
              const oldLodgingStartDate = formatDateForStorage(legCostsData[i][lcIndex['Lodging_Start_Date']]) || '';
              const oldLodgingEndDate = formatDateForStorage(legCostsData[i][lcIndex['Lodging_End_Date']]) || '';
              const oldMieStartDate = formatDateForStorage(legCostsData[i][lcIndex['MIE_Start_Date']]) || '';
              const oldMieEndDate = formatDateForStorage(legCostsData[i][lcIndex['MIE_End_Date']]) || '';
              const oldLodgingOverride = legCostsData[i][lcIndex['Lodging_Override']] === true;
              const oldLodgingAmount = parseFloat(legCostsData[i][lcIndex['Lodging_Override_Amount']]) || 0;
              const oldLodgingReason = legCostsData[i][lcIndex['Lodging_Override_Reason']] || '';
              const oldMieOverride = legCostsData[i][lcIndex['MIE_Override']] === true;
              const oldMieAmount = parseFloat(legCostsData[i][lcIndex['MIE_Override_Amount']]) || 0;
              const oldMieReason = legCostsData[i][lcIndex['MIE_Override_Reason']] || '';

              // Build delta
              const legDelta = {
                travelerId: rowTravelerId,
                travelerName: travelerName,
                legId: rowLegId,
                legCity: legCity
              };

              // New values with independent lodging and M&IE dates
              const newLodgingStartDate = formatDateForStorage(update.lodgingStartDate) || '';
              const newLodgingEndDate = formatDateForStorage(update.lodgingEndDate) || '';
              const newMieStartDate = formatDateForStorage(update.mieStartDate) || '';
              const newMieEndDate = formatDateForStorage(update.mieEndDate) || '';
              const newLodgingOverride = update.lodgingOverride === true;
              const newLodgingAmount = parseFloat(update.lodgingOverrideAmount) || 0;
              const newLodgingReason = update.lodgingOverrideReason || '';
              const newMieOverride = update.mieOverride === true;
              const newMieAmount = parseFloat(update.mieOverrideAmount) || 0;
              const newMieReason = update.mieOverrideReason || '';

              // Track lodging date changes
              if (oldLodgingStartDate !== newLodgingStartDate) {
                legDelta.lodgingStartDate = { old: oldLodgingStartDate, new: newLodgingStartDate };
              }
              if (oldLodgingEndDate !== newLodgingEndDate) {
                legDelta.lodgingEndDate = { old: oldLodgingEndDate, new: newLodgingEndDate };
              }
              // Track M&IE date changes
              if (oldMieStartDate !== newMieStartDate) {
                legDelta.mieStartDate = { old: oldMieStartDate, new: newMieStartDate };
              }
              if (oldMieEndDate !== newMieEndDate) {
                legDelta.mieEndDate = { old: oldMieEndDate, new: newMieEndDate };
              }
              // Track lodging override changes
              if (oldLodgingOverride !== newLodgingOverride) {
                legDelta.lodgingOverride = { old: oldLodgingOverride, new: newLodgingOverride };
              }
              if (oldLodgingAmount !== newLodgingAmount) {
                legDelta.lodgingAmount = { old: oldLodgingAmount, new: newLodgingAmount };
              }
              if (oldLodgingReason !== newLodgingReason) {
                legDelta.lodgingReason = { old: oldLodgingReason, new: newLodgingReason };
              }
              // Track M&IE override changes
              if (oldMieOverride !== newMieOverride) {
                legDelta.mieOverride = { old: oldMieOverride, new: newMieOverride };
              }
              if (oldMieAmount !== newMieAmount) {
                legDelta.mieAmount = { old: oldMieAmount, new: newMieAmount };
              }
              if (oldMieReason !== newMieReason) {
                legDelta.mieReason = { old: oldMieReason, new: newMieReason };
              }

              // NOTE: legDelta check moved to after local travel section (line ~3090)
              // to capture all changes before deciding to log

              // Update independent lodging dates
              if (lcIndex['Lodging_Start_Date'] !== undefined && update.lodgingStartDate) {
                legCostsSheet.getRange(sheetRow, lcIndex['Lodging_Start_Date'] + 1)
                  .setValue(formatDateForStorage(update.lodgingStartDate));
              }
              if (lcIndex['Lodging_End_Date'] !== undefined && update.lodgingEndDate) {
                legCostsSheet.getRange(sheetRow, lcIndex['Lodging_End_Date'] + 1)
                  .setValue(formatDateForStorage(update.lodgingEndDate));
              }
              if (lcIndex['Lodging_Uses_Itinerary_Dates'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['Lodging_Uses_Itinerary_Dates'] + 1)
                  .setValue(update.lodgingUsesItineraryDates !== false);
              }
              // Update independent M&IE dates
              if (lcIndex['MIE_Start_Date'] !== undefined && update.mieStartDate) {
                legCostsSheet.getRange(sheetRow, lcIndex['MIE_Start_Date'] + 1)
                  .setValue(formatDateForStorage(update.mieStartDate));
              }
              if (lcIndex['MIE_End_Date'] !== undefined && update.mieEndDate) {
                legCostsSheet.getRange(sheetRow, lcIndex['MIE_End_Date'] + 1)
                  .setValue(formatDateForStorage(update.mieEndDate));
              }
              if (lcIndex['MIE_Uses_Itinerary_Dates'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['MIE_Uses_Itinerary_Dates'] + 1)
                  .setValue(update.mieUsesItineraryDates !== false);
              }

              // Check if dates changed (for recalculation)
              const lodgingDatesChanged = oldLodgingStartDate !== newLodgingStartDate || oldLodgingEndDate !== newLodgingEndDate;
              const mieDatesChanged = oldMieStartDate !== newMieStartDate || oldMieEndDate !== newMieEndDate;

              // Get location info for per diem lookups
              const legInfo = legsMap[rowLegId] || {};

              // Initialize calculated values from existing sheet data
              let lodgingNights = legCostsData[i][lcIndex['Lodging_Nights']] || 0;
              let lodgingRate = parseFloat(legCostsData[i][lcIndex['Lodging_Rate']]) || 0;
              let lodgingCalculated = parseFloat(legCostsData[i][lcIndex['Lodging_Calculated']]) || 0;
              let mieDays = legCostsData[i][lcIndex['MIE_Days']] || 0;
              let mieRate = parseFloat(legCostsData[i][lcIndex['MIE_Rate']]) || 0;
              let mieCalculated = parseFloat(legCostsData[i][lcIndex['MIE_Calculated']]) || 0;

              // Recalculate if dates changed and NOT using override
              if ((lodgingDatesChanged || mieDatesChanged) && legInfo.city) {
                // Determine effective dates for lodging and M&IE
                const effectiveLodgingStart = update.lodgingStartDate || legInfo.startDate;
                const effectiveLodgingEnd = update.lodgingEndDate || legInfo.endDate;
                const effectiveMieStart = update.mieStartDate || legInfo.startDate;
                const effectiveMieEnd = update.mieEndDate || legInfo.endDate;

                // Check if lodging and M&IE use same dates (optimization)
                const sameEffectiveDates = effectiveLodgingStart === effectiveMieStart &&
                                           effectiveLodgingEnd === effectiveMieEnd;

                if (sameEffectiveDates) {
                  // Single per diem lookup for both
                  const perDiemResult = getPerDiemForLeg({
                    city: legInfo.city,
                    state: legInfo.state,
                    country: legInfo.country,
                    isInternational: legInfo.isInternational,
                    startDate: effectiveLodgingStart,
                    endDate: effectiveLodgingEnd
                  });

                  if (perDiemResult.success) {
                    lodgingNights = calculateNights(effectiveLodgingStart, effectiveLodgingEnd);
                    lodgingRate = perDiemResult.lodgingRate || 0;
                    lodgingCalculated = perDiemResult.lodgingTotal || (lodgingNights * lodgingRate);
                    mieDays = calculateMieDays(effectiveMieStart, effectiveMieEnd);
                    mieRate = perDiemResult.mieRate || 0;
                    mieCalculated = perDiemResult.mieTotal || (mieDays * mieRate);
                  }
                } else {
                  // Separate per diem lookups for lodging and M&IE
                  if (lodgingDatesChanged) {
                    const lodgingResult = getPerDiemForLeg({
                      city: legInfo.city,
                      state: legInfo.state,
                      country: legInfo.country,
                      isInternational: legInfo.isInternational,
                      startDate: effectiveLodgingStart,
                      endDate: effectiveLodgingEnd
                    });

                    if (lodgingResult.success) {
                      lodgingNights = calculateNights(effectiveLodgingStart, effectiveLodgingEnd);
                      lodgingRate = lodgingResult.lodgingRate || 0;
                      lodgingCalculated = lodgingResult.lodgingTotal || (lodgingNights * lodgingRate);
                    }
                  }

                  if (mieDatesChanged) {
                    const mieResult = getPerDiemForLeg({
                      city: legInfo.city,
                      state: legInfo.state,
                      country: legInfo.country,
                      isInternational: legInfo.isInternational,
                      startDate: effectiveMieStart,
                      endDate: effectiveMieEnd
                    });

                    if (mieResult.success) {
                      mieDays = calculateMieDays(effectiveMieStart, effectiveMieEnd);
                      mieRate = mieResult.mieRate || 0;
                      mieCalculated = mieResult.mieTotal || (mieDays * mieRate);
                    }
                  }
                }

                // Write recalculated values to sheet
                if (lcIndex['Lodging_Nights'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['Lodging_Nights'] + 1).setValue(lodgingNights);
                }
                if (lcIndex['Lodging_Rate'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['Lodging_Rate'] + 1).setValue(lodgingRate);
                }
                if (lcIndex['Lodging_Calculated'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['Lodging_Calculated'] + 1).setValue(lodgingCalculated);
                }
                if (lcIndex['MIE_Days'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['MIE_Days'] + 1).setValue(mieDays);
                }
                if (lcIndex['MIE_Rate'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['MIE_Rate'] + 1).setValue(mieRate);
                }
                if (lcIndex['MIE_Calculated'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['MIE_Calculated'] + 1).setValue(mieCalculated);
                }
              }

              // Update lodging override
              if (lcIndex['Lodging_Override'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['Lodging_Override'] + 1)
                  .setValue(update.lodgingOverride || false);
              }
              if (lcIndex['Lodging_Override_Amount'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['Lodging_Override_Amount'] + 1)
                  .setValue(update.lodgingOverrideAmount || 0);
              }
              if (lcIndex['Lodging_Override_Reason'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['Lodging_Override_Reason'] + 1)
                  .setValue(update.lodgingOverrideReason || '');
              }
              // Update Lodging_Total based on override (use recalculated value if available)
              if (lcIndex['Lodging_Total'] !== undefined) {
                const lodgingTotal = update.lodgingOverride
                  ? (parseFloat(update.lodgingOverrideAmount) || 0)
                  : lodgingCalculated;
                legCostsSheet.getRange(sheetRow, lcIndex['Lodging_Total'] + 1)
                  .setValue(lodgingTotal);
              }

              // Update M&IE override
              if (lcIndex['MIE_Override'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['MIE_Override'] + 1)
                  .setValue(update.mieOverride || false);
              }
              if (lcIndex['MIE_Override_Amount'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['MIE_Override_Amount'] + 1)
                  .setValue(update.mieOverrideAmount || 0);
              }
              if (lcIndex['MIE_Override_Reason'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['MIE_Override_Reason'] + 1)
                  .setValue(update.mieOverrideReason || '');
              }
              // Update MIE_Total based on override (use recalculated value if available)
              const mieTotal = update.mieOverride
                ? (parseFloat(update.mieOverrideAmount) || 0)
                : mieCalculated;
              if (lcIndex['MIE_Total'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['MIE_Total'] + 1)
                  .setValue(mieTotal);
              }

              // ========== Update Local Travel Fields ==========
              let localTravelTotal = parseFloat(legCostsData[i][lcIndex['Local_Travel_Total']]) || 0;

              // Always update the Is_Local_Travel flag (it can change from true to false)
              if (lcIndex['Is_Local_Travel'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['Is_Local_Travel'] + 1)
                  .setValue(update.isLocalTravel || false);
              }

              // Check if this is a local travel leg and has updates
              if (update.isLocalTravel) {
                // Capture old values for delta
                const oldLocalMilesDriven = parseFloat(legCostsData[i][lcIndex['Local_Miles_Driven']]) || 0;
                const oldWasGovVehicleAvailable = legCostsData[i][lcIndex['Was_Gov_Vehicle_Available']] === true;
                const oldLocalParking = parseFloat(legCostsData[i][lcIndex['Local_Parking']]) || 0;
                const oldLocalTolls = parseFloat(legCostsData[i][lcIndex['Local_Tolls']]) || 0;
                const oldLocalTravelTotal = parseFloat(legCostsData[i][lcIndex['Local_Travel_Total']]) || 0;

                // New values
                const newLocalMilesDriven = parseFloat(update.localMilesDriven) || 0;
                const newWasGovVehicleAvailable = update.wasGovVehicleAvailable === true;
                const newLocalParking = parseFloat(update.localParking) || 0;
                const newLocalTolls = parseFloat(update.localTolls) || 0;

                // Track local travel changes
                if (oldLocalMilesDriven !== newLocalMilesDriven) {
                  legDelta.localMilesDriven = { old: oldLocalMilesDriven, new: newLocalMilesDriven };
                }
                if (oldWasGovVehicleAvailable !== newWasGovVehicleAvailable) {
                  legDelta.wasGovVehicleAvailable = { old: oldWasGovVehicleAvailable, new: newWasGovVehicleAvailable };
                }
                if (oldLocalParking !== newLocalParking) {
                  legDelta.localParking = { old: oldLocalParking, new: newLocalParking };
                }
                if (oldLocalTolls !== newLocalTolls) {
                  legDelta.localTolls = { old: oldLocalTolls, new: newLocalTolls };
                }

                // Update local travel fields in sheet
                if (lcIndex['Local_Miles_Driven'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['Local_Miles_Driven'] + 1)
                    .setValue(newLocalMilesDriven);
                }
                if (lcIndex['Was_Gov_Vehicle_Available'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['Was_Gov_Vehicle_Available'] + 1)
                    .setValue(newWasGovVehicleAvailable);
                }
                if (lcIndex['Local_Parking'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['Local_Parking'] + 1)
                    .setValue(newLocalParking);
                }
                if (lcIndex['Local_Tolls'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['Local_Tolls'] + 1)
                    .setValue(newLocalTolls);
                }

                // Recalculate local travel total
                // Get commute distances from Request_Travelers for this traveler
                const mileageRates = getMileageRates();
                const mileageRate = newWasGovVehicleAvailable ? mileageRates.gov : mileageRates.private;

                // Get normal commute info from travelers sheet
                let normalCommuteDistance = 0;
                let normalCommuteParking = 0;
                if (travSheet) {
                  const travData3 = travSheet.getDataRange().getValues();
                  const travHeaders3 = travData3[0];
                  const travIdx3 = {};
                  travHeaders3.forEach((h, idx) => { travIdx3[h] = idx; });
                  for (let t = 1; t < travData3.length; t++) {
                    if (travData3[t][travIdx3['Request_ID']] === requestId &&
                        travData3[t][travIdx3['Traveler_ID']] === rowTravelerId) {
                      normalCommuteDistance = parseFloat(travData3[t][travIdx3['Normal_Commute_Distance']]) || 0;
                      normalCommuteParking = parseFloat(travData3[t][travIdx3['Normal_Commute_Parking']]) || 0;
                      break;
                    }
                  }
                }

                const reimbursableMiles = Math.max(0, newLocalMilesDriven - normalCommuteDistance);
                const mileageAmount = reimbursableMiles * mileageRate;
                const excessParking = Math.max(0, newLocalParking - normalCommuteParking);
                localTravelTotal = mileageAmount + excessParking + newLocalTolls;

                // Update Local_Travel_Total in sheet
                if (lcIndex['Local_Travel_Total'] !== undefined) {
                  legCostsSheet.getRange(sheetRow, lcIndex['Local_Travel_Total'] + 1)
                    .setValue(localTravelTotal);
                }

                // Track local travel total change
                if (Math.abs(oldLocalTravelTotal - localTravelTotal) > 0.01) {
                  legDelta.localTravelTotal = { old: oldLocalTravelTotal, new: localTravelTotal };
                }
              }

              // Only add if there were actual changes (more than just identifiers)
              // This check is placed AFTER local travel tracking so all changes are captured
              if (Object.keys(legDelta).length > 4) {
                legCostChanges.push(legDelta);
              }

              // Update Leg_Subtotal (lodging + M&IE + local travel)
              const lodgingTotal = update.lodgingOverride
                ? (parseFloat(update.lodgingOverrideAmount) || 0)
                : lodgingCalculated;
              const legSubtotal = lodgingTotal + mieTotal + localTravelTotal;
              if (lcIndex['Leg_Subtotal'] !== undefined) {
                legCostsSheet.getRange(sheetRow, lcIndex['Leg_Subtotal'] + 1)
                  .setValue(legSubtotal);
              }
            }
          }
        }
      }

      // Add leg cost changes to changeDetails
      if (legCostChanges.length > 0) {
        changeDetails.legCostChanges = legCostChanges;
      }
    }

    // ========== Recalculate Totals ==========
    // Re-read traveler totals from sheets and recalculate
    const travelersSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);
    let travelerTotal = 0;
    // Per-traveler subtotal map returned to the client so it can merge
    // server-authoritative numbers without us shipping the entire
    // traveler/legCost shape back over google.script.run.
    const travelerSubtotalMap = {};

    if (travelersSheet && travelersSheet.getLastRow() > 1) {
      const travelersData = travelersSheet.getDataRange().getValues();
      const travelerHeaders = travelersData[0];
      const travelerIndex = {};
      travelerHeaders.forEach((h, i) => { travelerIndex[h] = i; });

      // Recalculate from leg costs
      if (legCostsSheet && legCostsSheet.getLastRow() > 1) {
        const finalLegCostsData = legCostsSheet.getDataRange().getValues();
        const finalLcIndex = {};
        finalLegCostsData[0].forEach((h, i) => { finalLcIndex[h] = i; });

        // Sum up traveler subtotals per traveler
        const travelerSubtotals = {};

        for (let i = 1; i < finalLegCostsData.length; i++) {
          if (finalLegCostsData[i][finalLcIndex['Request_ID']] === requestId) {
            const tId = finalLegCostsData[i][finalLcIndex['Traveler_ID']];
            const lodgingTotal = parseFloat(finalLegCostsData[i][finalLcIndex['Lodging_Total']]) || 0;
            const mieTotal = parseFloat(finalLegCostsData[i][finalLcIndex['MIE_Total']]) || 0;
            const localTotal = parseFloat(finalLegCostsData[i][finalLcIndex['Local_Travel_Total']]) || 0;

            if (!travelerSubtotals[tId]) {
              travelerSubtotals[tId] = { lodging: 0, mie: 0, local: 0, transport: 0, other: 0 };
            }
            travelerSubtotals[tId].lodging += lodgingTotal;
            travelerSubtotals[tId].mie += mieTotal;
            travelerSubtotals[tId].local += localTotal;
          }
        }

        // Update traveler subtotals and calculate grand traveler total
        for (let i = 1; i < travelersData.length; i++) {
          if (travelersData[i][travelerIndex['Request_ID']] === requestId) {
            const tId = travelersData[i][travelerIndex['Traveler_ID']];
            const transportTotal = parseFloat(travelersData[i][travelerIndex['Transportation_Total']]) || 0;
            const otherTotal = parseFloat(travelersData[i][travelerIndex['Other_Total']]) || 0;

            const costs = travelerSubtotals[tId] || { lodging: 0, mie: 0, local: 0 };
            const subtotal = costs.lodging + costs.mie + costs.local + transportTotal + otherTotal;

            // Update traveler totals in sheet
            if (travelerIndex['Lodging_Total'] !== undefined) {
              travelersSheet.getRange(i + 1, travelerIndex['Lodging_Total'] + 1).setValue(costs.lodging);
            }
            if (travelerIndex['MIE_Total'] !== undefined) {
              travelersSheet.getRange(i + 1, travelerIndex['MIE_Total'] + 1).setValue(costs.mie);
            }
            if (travelerIndex['Local_Travel_Total'] !== undefined) {
              travelersSheet.getRange(i + 1, travelerIndex['Local_Travel_Total'] + 1).setValue(costs.local);
            }
            if (travelerIndex['Subtotal'] !== undefined) {
              travelersSheet.getRange(i + 1, travelerIndex['Subtotal'] + 1).setValue(subtotal);
            }

            travelerTotal += subtotal;
            travelerSubtotalMap[tId] = {
              lodgingTotal: costs.lodging,
              mieTotal: costs.mie,
              localTravelTotal: costs.local,
              transportationTotal: transportTotal,
              otherTotal: otherTotal,
              subtotal: subtotal
            };
          }
        }
      }
    }

    // Update request totals
    const grandTotal = calculateGrandTotal(travelerTotal, sharedTotal);
    const now = new Date();

    if (requestIndex['Traveler_Total'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, requestIndex['Traveler_Total'] + 1)
        .setValue(travelerTotal);
    }
    if (requestIndex['Grand_Total'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, requestIndex['Grand_Total'] + 1)
        .setValue(grandTotal);
    }
    if (requestIndex['Updated_At'] !== undefined) {
      requestsSheet.getRange(requestRowIndex, requestIndex['Updated_At'] + 1)
        .setValue(now);
    }

    // ========== Log to Approval_Log ==========
    const currentUserEmail = Session.getActiveUser().getEmail();
    const approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);

    if (approvalLogSheet) {
      const logId = generateLogId();

      // Build delta for totals - only include if actually changed
      if (oldSharedTotal !== sharedTotal) {
        changeDetails.sharedTotal = { old: oldSharedTotal, new: sharedTotal };
      }
      if (oldTravelerTotal !== travelerTotal) {
        changeDetails.travelerTotal = { old: oldTravelerTotal, new: travelerTotal };
      }
      if (oldGrandTotal !== grandTotal) {
        changeDetails.grandTotal = { old: oldGrandTotal, new: grandTotal };
      }

      // Per-category shared-cost delta. Only emit categories that actually
      // changed (amount or description), so the log entry stays compact
      // when only one or two boxes were edited.
      if (sharedCosts) {
        const sharedCategoryChanges = {};
        const newSharedByCategory = {
          facilities:  { amount: parseFloat(sharedCosts.facilities?.amount)  || 0, description: sharedCosts.facilities?.description  || '' },
          audioVisual: { amount: parseFloat(sharedCosts.audioVisual?.amount) || 0, description: sharedCosts.audioVisual?.description || '' },
          logistics:   { amount: parseFloat(sharedCosts.logistics?.amount)   || 0, description: sharedCosts.logistics?.description   || '' },
          other:       { amount: parseFloat(sharedCosts.other?.amount)       || 0, description: sharedCosts.other?.description       || '' }
        };
        ['facilities', 'audioVisual', 'logistics', 'other'].forEach(cat => {
          const o = oldSharedByCategory[cat];
          const n = newSharedByCategory[cat];
          if (o.amount !== n.amount || o.description !== n.description) {
            sharedCategoryChanges[cat] = { old: o, new: n };
          }
        });
        if (Object.keys(sharedCategoryChanges).length > 0) {
          changeDetails.sharedCostChanges = sharedCategoryChanges;
        }
      }

      // Include detailed transport changes
      if (transportChanges.length > 0) {
        changeDetails.transportChanges = transportChanges;
      }

      // Build comments for log display
      const comments = [];
      if (changeDetails.sharedCostChanges) {
        const sharedLabels = { facilities: 'Facilities', audioVisual: 'A/V', logistics: 'Logistics', other: 'Other' };
        const cats = Object.keys(changeDetails.sharedCostChanges).map(k => sharedLabels[k] || k);
        comments.push('Shared costs updated (' + cats.join(', ') + ')');
      } else if (changeDetails.sharedTotal) {
        comments.push('Shared costs updated');
      }
      if (transportChanges.length > 0) {
        // Check if any transport changes include commute info
        const hasCommuteChanges = transportChanges.some(tc =>
          tc.isFullTimeTelework || tc.normalCommuteDistance || tc.normalCommuteParking
        );
        if (hasCommuteChanges) {
          comments.push('Commute info updated');
        } else {
          comments.push(`${transportChanges.length} traveler transport(s) updated`);
        }
      }
      if (changeDetails.legCostChanges && changeDetails.legCostChanges.length > 0) {
        // Check if any leg changes are local travel changes
        const localTravelChanges = changeDetails.legCostChanges.filter(lc =>
          lc.localMilesDriven || lc.wasGovVehicleAvailable || lc.localParking || lc.localTolls || lc.localTravelTotal
        );
        const perDiemChanges = changeDetails.legCostChanges.filter(lc =>
          lc.lodgingStartDate || lc.lodgingEndDate || lc.mieStartDate || lc.mieEndDate ||
          lc.lodgingOverride || lc.lodgingAmount || lc.mieOverride || lc.mieAmount
        );

        if (localTravelChanges.length > 0 && perDiemChanges.length > 0) {
          comments.push(`${localTravelChanges.length} local travel leg(s) and ${perDiemChanges.length} per diem leg(s) updated`);
        } else if (localTravelChanges.length > 0) {
          comments.push(`${localTravelChanges.length} local travel leg(s) updated`);
        } else {
          comments.push(`${changeDetails.legCostChanges.length} leg cost(s) updated`);
        }
      }
      if (changeDetails.legCostsRemoved > 0) comments.push(`${changeDetails.legCostsRemoved} leg(s) removed`);

      // Clean up legCostsRemoved if zero (don't store in log)
      if (changeDetails.legCostsRemoved === 0) {
        delete changeDetails.legCostsRemoved;
      }

      approvalLogSheet.appendRow([
        logId,
        requestId,
        ACTION_TYPES.EDIT_COSTS,
        currentUserEmail,
        currentUserEmail,
        'Submitter',
        now,
        currentStatus,
        currentStatus,
        comments.join('; ') || 'Cost details updated',
        JSON.stringify(changeDetails),
        '',
        currentVersion,
        currentVersion
      ]);
    }

    console.log(`Updated costs for request ${requestId}: traveler $${travelerTotal}, shared $${sharedTotal}, grand $${grandTotal}`);

    // Invalidate cache layers so the NEXT page-load sees fresh data.
    // (We don't re-read here — the client merges totals + per-traveler
    // subtotals from this thin response into local state, which already
    // reflects the user's just-saved field values.)
    db.invalidate(SHEET_NAMES.REQUEST_TRAVELERS);
    db.invalidate(SHEET_NAMES.TRAVELER_LEG_COSTS);
    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    try { CacheService.getScriptCache().remove('request_review_v2_' + requestId); } catch (ce) { /* ignore */ }

    return successResponse({
      sharedTotal: sharedTotal,
      travelerTotal: travelerTotal,
      grandTotal: grandTotal,
      travelerSubtotals: travelerSubtotalMap
    });

  } catch (error) {
    logError('updateCostsForReview', error, { requestId: updates && updates.requestId });
    return errorResponse(error.message || 'Failed to update costs');
  }
}
