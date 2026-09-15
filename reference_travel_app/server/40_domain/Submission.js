/**
 * TravelSubmissionService.js
 * Handles submission of travel requests to the database (Data Model v2)
 *
 * Key functions:
 * - submitTravelRequestV2() - Main submission function
 * - resubmitTravelRequest() - Resubmit after Needs_Info
 * - cancelTravelRequest() - Submitter cancellation
 */

// ============================================================================
// SMART ROUTING HELPERS
// ============================================================================

/**
 * Find the Sector Director for a given org code at submission time.
 *
 * Thin adapter over getSectorDirector() (TravelReviewerResolver.js) — that's
 * the single source of truth for SD identification across TRIP. Submission
 * routing only needs { name, email }; the resolver returns more, we strip.
 *
 * Resolution order (inherited from getSectorDirector):
 *   1. Travel_User_Roles sector_override for this sector
 *   2. HC position-first auto-derive: orgCode === sectorCode AND
 *      officeTitle contains "Sector Director" AND Grade 15 AND Sup Status 2
 *   3. Occupancy gate: VACANT or OBLIGATED → null (caller cascades to BU)
 *
 * Migrated 2026-04-30 from the legacy LCAT="SD" rule, which was fragile
 * against HR data drift and didn't honor occupancy or admin overrides.
 *
 * @param {string} submitterOrgCode - Full org code (e.g., 'QFAADA')
 * @returns {Object|null} { name, email } or null if vacant / not found
 * @server
 */
function findSectorDirector(submitterOrgCode) {
  if (!submitterOrgCode || submitterOrgCode.length < 4) {
    console.log('findSectorDirector: Org code too short, skipping SD lookup');
    return null;
  }

  const sectorCode = submitterOrgCode.substring(0, 4);
  const sd = getSectorDirector(sectorCode);
  if (!sd) {
    console.log('findSectorDirector: No SD for sector:', sectorCode);
    return null;
  }

  console.log('findSectorDirector: Resolved SD via ' + sd.source + ':', sd.name, sd.email);
  return { name: sd.name || '', email: sd.email };
}

/**
 * Determine the initial review level and current reviewer based on smart routing
 *
 * Two-phase approach:
 *   Phase 1 — Skip rules (you can't review your own request):
 *     - Submitter is OSO Reviewer → start at FAS (overhead) or APPROVED_GOGOV (client-paid)
 *     - Submitter is BU Reviewer  → start at OSO
 *     - Submitter is Sector Director → start at BU
 *     - Otherwise → start at Sector (or BU if no SD found)
 *
 *   Phase 2 — Vacancy cascade:
 *     If the target stage's reviewer is vacant/missing, skip to the next stage.
 *     Repeats until a stage with a valid reviewer is found (or reaches FAS/APPROVED).
 *
 * @param {string} submitterEmail - Email of the person submitting
 * @param {Object} sectorDirector - { name, email } or null
 * @param {Object} buReviewer - { name, email } or null
 * @param {Array} travelers - Traveler data from formData (for overhead check)
 * @returns {Object} { initialLevel, currentReviewerName, currentReviewerEmail, status }
 * @private
 * @server
 */
function determineInitialRouting(submitterEmail, sectorDirector, buReviewer, travelers) {
  const submitterLower = (submitterEmail || '').toLowerCase();

  // Get OSO reviewer info — use local getOSOReviewers() (cached) instead of cross-service call
  const osoData = getOSOReviewers();
  const osoReviewer = osoData ? osoData.primary : null;

  // Check role matches
  const isSD = sectorDirector?.email && submitterLower === sectorDirector.email.toLowerCase();
  const isBUReviewer = buReviewer?.email && submitterLower === buReviewer.email.toLowerCase();
  const isOSOReviewer = osoReviewer?.email && submitterLower === osoReviewer.email.toLowerCase();

  console.log('Smart routing: submitter=', submitterLower);
  console.log('Smart routing: SD=', sectorDirector?.email, 'isSD=', isSD);
  console.log('Smart routing: BU Reviewer=', buReviewer?.email, 'isBUReviewer=', isBUReviewer);
  console.log('Smart routing: OSO Reviewer=', osoReviewer?.email, 'isOSOReviewer=', isOSOReviewer);

  // Helper: check if a reviewer is valid (has an email — not vacant)
  function _isValid(reviewer) {
    return reviewer && reviewer.email;
  }

  // ========== Phase 1: Determine starting stage from skip rules ==========

  var startStage;

  if (isOSOReviewer) {
    startStage = 'FAS'; // skip SD, BU, OSO
  } else if (isBUReviewer) {
    startStage = 'OSO'; // skip SD, BU
  } else if (isSD) {
    startStage = 'BU';  // skip SD
  } else if (_isValid(sectorDirector)) {
    startStage = 'Sector';
  } else {
    startStage = 'BU';  // no SD found
  }

  console.log('Smart routing: Phase 1 starting stage =', startStage);

  // ========== Phase 2: Vacancy cascade — skip stages with vacant reviewers ==========
  // Walk forward through the approval chain until we find a stage with a valid reviewer

  // Sector → BU → OSO → FAS → APPROVED
  if (startStage === 'Sector') {
    if (_isValid(sectorDirector)) {
      console.log('Smart routing: Routing to Sector Director');
      return {
        initialLevel: 'Sector',
        currentReviewerName: sectorDirector.name,
        currentReviewerEmail: sectorDirector.email,
        status: STATUS_CODES.PENDING_SECTOR
      };
    }
    console.log('Smart routing: Sector Director vacant, cascading to BU');
    startStage = 'BU';
  }

  if (startStage === 'BU') {
    if (_isValid(buReviewer)) {
      console.log('Smart routing: Routing to BU Reviewer');
      return {
        initialLevel: 'BU',
        currentReviewerName: buReviewer.name,
        currentReviewerEmail: buReviewer.email,
        status: STATUS_CODES.PENDING_BU
      };
    }
    console.log('Smart routing: BU Reviewer vacant/not found, cascading to OSO');
    startStage = 'OSO';
  }

  if (startStage === 'OSO') {
    if (_isValid(osoReviewer)) {
      console.log('Smart routing: Routing to OSO Reviewer');
      return {
        initialLevel: 'OSO',
        currentReviewerName: osoReviewer.name,
        currentReviewerEmail: osoReviewer.email,
        status: STATUS_CODES.PENDING_OSO
      };
    }
    console.log('Smart routing: OSO Reviewer vacant/not found, cascading to FAS');
    startStage = 'FAS';
  }

  // FAS (only for overhead) or APPROVED_GOGOV (client-paid / no FAS needed)
  if (startStage === 'FAS') {
    const isOverhead = _hasOverheadFromData(travelers);
    if (isOverhead) {
      const fas = getFASReviewer();
      const fasEmail = fas.email || '';
      const fasName = fas.name || 'FAS Reviewer';
      console.log('Smart routing: Routing to FAS (overhead)');
      return {
        initialLevel: 'FAS',
        currentReviewerName: fasEmail ? fasName : '',
        currentReviewerEmail: fasEmail,
        status: STATUS_CODES.PENDING_FAS
      };
    } else {
      console.log('Smart routing: Client-paid, no FAS needed — approving directly');
      return {
        initialLevel: 'APPROVED',
        currentReviewerName: '',
        currentReviewerEmail: '',
        status: STATUS_CODES.APPROVED_GOGOV
      };
    }
  }

  // Should not reach here, but safe fallback
  console.log('Smart routing: Fallback — no valid reviewer found in chain');
  return {
    initialLevel: 'OSO',
    currentReviewerName: osoReviewer?.name || '',
    currentReviewerEmail: osoReviewer?.email || '',
    status: STATUS_CODES.PENDING_OSO
  };
}

// ============================================================================
// MAIN SUBMISSION FUNCTION
// ============================================================================

/**
 * Submit a new travel request (Data Model v2).
 * Writes to 5 sheets (Requests + Request_Legs + Request_Travelers +
 * Traveler_Leg_Costs + Approval_Log) then sends notifications.
 *
 * Multi-sheet write pattern: per-sheet loop uses raw sheet.appendRow()
 * followed by a single db.invalidate() at the end of the function (NOT
 * inside each loop iteration). Switching the loop bodies to db.appendRow()
 * would add N cache re-warms per sheet per submission (~1-3s overhead
 * per submission on the critical user path). Convention documented in
 * Chunk 10.E commit message.
 *
 * NO LockService — BUGS_FOUND #7 (multi-sheet atomicity gap). Separate
 * ticket post-refactor, intentionally not bundled here.
 *
 * @param {Object} formData - Complete form data from client
 * @returns {Object} successResponse({ requestId, grandTotal, attachmentsFolder, message }) or errorResponse(msg)
 * @client
 */
function submitTravelRequestV2(formData) {
  try {
    // Validate required data
    if (!formData || !formData.travelers || formData.travelers.length === 0) {
      throw new Error('Invalid form data: travelers are required');
    }

    if (!formData.legs || formData.legs.length === 0) {
      throw new Error('Invalid form data: at least one destination/leg is required');
    }

    const db = new TravelDB();

    // Get user info from session
    const userEmail = Session.getActiveUser().getEmail();
    const userName = formData.submitterName || formatUserName(userEmail);

    // Generate Request ID
    const requestId = generateRequestId();
    const now = new Date(); // Native Date for proper timezone handling

    // ========== Look up submitter info server-side ==========
    // This is more reliable than trusting client data
    const submitterInfo = getSubmitterInfo(userEmail);
    console.log('submitTravelRequestV2: Submitter info lookup:', JSON.stringify(submitterInfo));

    // Get submitter's org code and BU - prefer server lookup, fall back to client data, then first traveler
    const submitterOrgCode = submitterInfo.orgCode || formData.submitterOrgCode || formData.travelers[0]?.orgCode || '';
    const submitterBUCode = submitterInfo.buCode || formData.submitterBU || submitterOrgCode.substring(0, 3) || '';

    console.log('submitTravelRequestV2: Submitter org code:', submitterOrgCode);
    console.log('submitTravelRequestV2: Submitter BU code:', submitterBUCode);

    // Look up BU reviewer. Prefer the BU NAME from HC staffing (stable
    // across HC org-code reorgs) over the 3-char prefix lookup.
    const submitterBUName = submitterInfo.buName || '';
    const buReviewer = lookupBUReviewer(submitterBUCode, submitterBUName);
    console.log('submitTravelRequestV2: BU Reviewer found:', buReviewer ? JSON.stringify(buReviewer) : 'null');

    // Look up Sector Director based on submitter's org code (first 4 chars)
    const sectorDirector = findSectorDirector(submitterOrgCode);
    console.log('submitTravelRequestV2: Sector Director found:', sectorDirector ? JSON.stringify(sectorDirector) : 'null');

    // Determine initial routing based on submitter's role
    const routing = determineInitialRouting(userEmail, sectorDirector, buReviewer, formData.travelers);
    console.log('submitTravelRequestV2: Routing determined:', JSON.stringify(routing));

    // ========== Calculate totals ==========

    // Shared costs (using shared utility)
    const shared = calculateSharedTotal(formData.sharedCosts);
    const sharedFacilities = shared.facilities;
    const sharedAV = shared.audioVisual;
    const sharedLogistics = shared.logistics;
    const sharedOther = shared.other;
    const sharedTotal = shared.total;

    // Traveler totals will be calculated as we process travelers
    let travelerTotal = 0;

    // Check international/OCONUS status from legs (using shared utilities)
    const isInternational = formData.legs.some(leg => isInternationalLocation(leg.country));
    const isOCONUS = formData.legs.some(leg => isOCONUSLocation(leg.state, leg.country));

    // ========== Write Request ==========

    const requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
    if (!requestsSheet) {
      throw new Error('Requests sheet not found. Run setupTravelDatabase() first.');
    }

    // Use native Date objects for timestamps - Google Sheets handles timezone properly
    // and toISOString() on read produces proper UTC format for client parsing
    const requestRow = [
      requestId,                                                    // Request_ID
      routing.status,                                               // Status (from smart routing)
      formData.tripName || formData.eventName || '',               // Trip_Name
      formData.locationType || '',                                 // Location_Type
      formatDateForStorage(formData.eventStartDate),               // Event_Start_Date (yyyy-MM-dd)
      formatDateForStorage(formData.eventEndDate),                 // Event_End_Date (yyyy-MM-dd)
      isInternational,                                             // Is_International
      isOCONUS,                                                    // Is_OCONUS
      formData.bluf || '',                                         // BLUF
      formData.purpose || '',                                      // Purpose
      JSON.stringify(formData.travelTypes || []),                  // Travel_Types (JSON array)
      JSON.stringify(formData.missionCriticalTypes || []),         // Mission_Critical_Types (JSON array)
      sharedFacilities,                                            // Shared_Facilities
      formData.sharedCosts?.facilities?.description || '',         // Shared_Facilities_Desc
      sharedAV,                                                    // Shared_AV
      formData.sharedCosts?.audioVisual?.description || '',        // Shared_AV_Desc
      sharedLogistics,                                             // Shared_Logistics
      formData.sharedCosts?.logistics?.description || '',          // Shared_Logistics_Desc
      sharedOther,                                                 // Shared_Other
      formData.sharedCosts?.other?.description || '',              // Shared_Other_Desc
      sharedTotal,                                                 // Shared_Total
      0,                                                           // Traveler_Total (calculated below)
      0,                                                           // Grand_Total (calculated below)
      formData.travelers.length,                                   // Traveler_Count
      formData.legs.length,                                        // Leg_Count
      userName,                                                    // Submitter_Name
      userEmail,                                                   // Submitter_Email
      // Submitter_BU stores the human-readable BU NAME (e.g. 'OSO', 'Army').
      // Prefer the staffing-derived buName from getSubmitterInfo (HC source
      // of truth, stable across org-code reorgs); fall back to the reviewer
      // lookup's resolved name; only fall back to the 3-char code when both
      // are unavailable (Test_Submitters fallback for non-HC users).
      submitterInfo.buName || (buReviewer && buReviewer.buName) || submitterBUCode,
      submitterOrgCode,                                            // Submitter_Org_Code (from server lookup)
      sectorDirector?.name || '',                                  // Sector_Director_Name
      sectorDirector?.email || '',                                 // Sector_Director_Email
      buReviewer?.name || '',                                      // BU_Reviewer_Name
      buReviewer?.email || '',                                     // BU_Reviewer_Email
      routing.currentReviewerName,                                 // Current_Reviewer_Name (from smart routing)
      routing.currentReviewerEmail,                                // Current_Reviewer_Email (from smart routing)
      routing.initialLevel,                                        // Initial_Review_Level
      '',                                                          // Attachments_Folder
      '',                                                          // Salesforce_Link
      now,                                                         // Created_At (native Date)
      now,                                                         // Updated_At (native Date)
      now,                                                         // Submitted_At (native Date)
      1                                                            // Version
    ];

    // Write request row
    requestsSheet.appendRow(requestRow);

    // ========== Write Legs ==========

    const legsSheet = db.sheet(SHEET_NAMES.REQUEST_LEGS);
    if (!legsSheet) {
      throw new Error('Request_Legs sheet not found. Run setupTravelDatabase() first.');
    }

    // Build lookup of leg rates from travelers' legCosts (rates are stored per-traveler)
    const legRates = {};
    formData.travelers.forEach(traveler => {
      if (traveler.legCosts) {
        Object.keys(traveler.legCosts).forEach(legId => {
          if (!legRates[legId]) {
            const legCost = traveler.legCosts[legId];
            legRates[legId] = {
              lodgingRate: legCost.lodgingRate || 0,
              mieRate: legCost.mieRate || 0
            };
          }
        });
      }
    });

    const legRows = formData.legs.map((leg, index) => {
      // Use shared utilities for location flags and display
      const locationFlags = getLegLocationFlags(leg);
      const locationDisplay = formatLocationDisplay(leg);

      // Get rates from legRates lookup (falls back to leg object for backwards compatibility)
      const rates = legRates[leg.id] || {};
      const lodgingRate = rates.lodgingRate || leg.lodgingRate || '';
      const mieRate = rates.mieRate || leg.mieRate || '';

      return [
        requestId,                                          // Request_ID
        leg.id || `leg_${Date.now()}_${index}`,            // Leg_ID
        index + 1,                                          // Leg_Number
        leg.siteName || '',                                 // Site_Name
        leg.city || '',                                     // City
        leg.state || '',                                    // State
        leg.country || 'United States',                     // Country
        formatDateForStorage(leg.startDate),                // Start_Date (yyyy-MM-dd)
        formatDateForStorage(leg.endDate),                  // End_Date (yyyy-MM-dd)
        locationFlags.isInternational,                      // Is_International
        locationFlags.isOCONUS,                             // Is_OCONUS
        locationFlags.perDiemSource,                        // Per_Diem_Source
        lodgingRate,                                        // Lodging_Rate
        mieRate,                                            // MIE_Rate
        locationDisplay                                     // Location_Display
      ];
    });

    // Batch write legs
    if (legRows.length > 0) {
      legsSheet.getRange(legsSheet.getLastRow() + 1, 1, legRows.length, legRows[0].length)
        .setValues(legRows);
    }

    // ========== Write Travelers ==========

    const travelersSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);
    if (!travelersSheet) {
      throw new Error('Request_Travelers sheet not found. Run setupTravelDatabase() first.');
    }

    const mileageRates = getMileageRates();
    const travelerRows = [];

    formData.travelers.forEach((traveler, index) => {
      // Compute totalMiles from the two fields the client actually sends
      const totalMiles = (parseFloat(traveler.milesToDeparture) || 0) + (parseFloat(traveler.milesFromArrival) || 0);

      // Use shared cost utilities for calculations
      const transportation = calculateTransportationTotal({
        transportMode: traveler.transportMode,
        ticketCost: traveler.ticketCost,
        totalMiles: totalMiles,
        needsRentalCar: traveler.needsRentalCar,
        rentalCarCost: traveler.rentalCarCost
      }, mileageRates);

      // Get totals from traveler object (pre-calculated by the form)
      const lodgingTotal = traveler.lodgingTotal || traveler.lodging || 0;
      const mieTotal = traveler.mieTotal || traveler.mie || 0;
      const localTravelTotal = traveler.localTravelTotal || 0;

      // Calculate other costs using shared utility
      const other = calculateOtherCosts(
        transportation.transportationTotal,
        lodgingTotal,
        mieTotal,
        traveler.otherPercentage
      );

      // Traveler subtotal
      const subtotal = transportation.transportationTotal + lodgingTotal + mieTotal + localTravelTotal + other.total;
      travelerTotal += subtotal;

      // Extract values for row
      const transportationTotal = transportation.transportationTotal;
      const mileageRate = transportation.mileageRate;
      const otherPercentage = other.percentage;
      const otherTotal = other.total;

      // Get attending legs as comma-separated IDs
      const attendingLegs = (traveler.attendingLegs || formData.legs.map(l => l.id)).join(',');

      // Check if all legs are local travel (no TDY legs require transport mode)
      const allLegsAreLocalTravel = traveler.legCosts &&
        Object.keys(traveler.legCosts).length > 0 &&
        Object.values(traveler.legCosts).every(lc => lc.isLocalTravel);

      travelerRows.push([
        requestId,                                          // Request_ID
        traveler.id || `traveler_${Date.now()}_${index}`,  // Traveler_ID
        traveler.employeeId || '',                          // Employee_ID
        traveler.employeeName || '',                        // Employee_Name
        traveler.email || '',                               // Email
        traveler.orgCode || '',                             // Org_Code
        traveler.businessUnit || traveler.bu || '',         // Business_Unit
        traveler.lcat || '',                                // LCAT
        traveler.ddName || '',                              // DD_Name
        traveler.ddEmail || '',                             // DD_Email
        traveler.dutyLocation || '',                        // Duty_Location
        traveler.dutyLocationCode || traveler.locationCode || '', // Duty_Location_Code
        attendingLegs,                                      // Attending_Legs
        allLegsAreLocalTravel ? '' : (traveler.transportMode || ''), // Transport_Mode
        traveler.ticketCost || '',                          // Ticket_Cost
        totalMiles || '',                                   // Total_Miles
        mileageRate || '',                                  // Mileage_Rate
        traveler.needsRentalCar || false,                   // Needs_Rental_Car
        traveler.rentalCarCost || '',                       // Rental_Car_Cost
        transportationTotal,                                // Transportation_Total
        lodgingTotal,                                       // Lodging_Total
        mieTotal,                                           // MIE_Total
        localTravelTotal,                                   // Local_Travel_Total
        otherPercentage,                                    // Other_Percentage
        otherTotal,                                         // Other_Total
        subtotal,                                           // Subtotal
        traveler.isClientPaid || 'overhead',                // Is_Client_Paid
        traveler.roleJustification || '',                   // Role_Justification
        traveler.isFullTimeTelework || false,               // Is_Full_Time_Telework
        traveler.normalCommuteDistance || '',               // Normal_Commute_Distance
        traveler.normalCommuteParking || '',                // Normal_Commute_Parking
        traveler.hasSecurityClearance || '',                // Has_Security_Clearance
        traveler.hasValidPassport || '',                    // Has_Valid_Passport
        traveler.isSpeaking || '',                          // Is_Speaking
        traveler.eventOpenToPress || '',                    // Event_Open_To_Press
        traveler.receivingNFS || ''                         // Receiving_NFS
      ]);
    });

    // Batch write travelers
    if (travelerRows.length > 0) {
      travelersSheet.getRange(travelersSheet.getLastRow() + 1, 1, travelerRows.length, travelerRows[0].length)
        .setValues(travelerRows);
    }

    // ========== Write Traveler Leg Costs ==========

    const legCostsSheet = db.sheet(SHEET_NAMES.TRAVELER_LEG_COSTS);
    if (!legCostsSheet) {
      throw new Error('Traveler_Leg_Costs sheet not found. Run setupTravelDatabase() first.');
    }

    const legCostRows = [];

    formData.travelers.forEach((traveler, travelerIndex) => {
      const travelerId = traveler.id || `traveler_${Date.now()}_${travelerIndex}`;

      // Get this traveler's leg costs (could be from traveler.legCosts or form structure)
      const travelerLegCosts = traveler.legCosts || {};

      formData.legs.forEach((leg, legIndex) => {
        const legId = leg.id || `leg_${Date.now()}_${legIndex}`;

        // Get costs for this specific leg (if traveler is attending it)
        const attending = traveler.attendingLegs
          ? traveler.attendingLegs.includes(legId)
          : true; // Default to attending all legs

        if (!attending) return;

        const legCost = travelerLegCosts[legId] || {};

        // Determine if local travel
        const isLocalTravel = legCost.isLocalTravel || false;

        // Build row
        legCostRows.push([
          requestId,                                        // Request_ID
          travelerId,                                       // Traveler_ID
          legId,                                            // Leg_ID
          leg.city || '',                                   // City (denormalized for display)
          // Independent lodging dates
          formatDateForStorage(legCost.lodgingStartDate || leg.startDate), // Lodging_Start_Date
          formatDateForStorage(legCost.lodgingEndDate || leg.endDate),     // Lodging_End_Date
          legCost.lodgingUsesItineraryDates !== false,      // Lodging_Uses_Itinerary_Dates
          // Independent M&IE dates
          formatDateForStorage(legCost.mieStartDate || leg.startDate),     // MIE_Start_Date
          formatDateForStorage(legCost.mieEndDate || leg.endDate),         // MIE_End_Date
          legCost.mieUsesItineraryDates !== false,          // MIE_Uses_Itinerary_Dates
          isLocalTravel,                                    // Is_Local_Travel
          legCost.lodgingRate || leg.lodgingRate || '',     // Lodging_Rate
          legCost.lodgingNights || '',                      // Lodging_Nights
          legCost.lodgingCalculated || '',                  // Lodging_Calculated
          legCost.lodgingOverride || false,                 // Lodging_Override
          legCost.lodgingOverride ? (legCost.lodgingOverrideAmount || 0) : '',  // Lodging_Override_Amount
          legCost.lodgingOverrideReason || '',              // Lodging_Override_Reason
          legCost.lodgingTotal || 0,                        // Lodging_Total
          legCost.mieRate || leg.mieRate || '',             // MIE_Rate
          legCost.mieDays || '',                            // MIE_Days
          legCost.mieCalculated || '',                      // MIE_Calculated
          legCost.mieOverride || false,                     // MIE_Override
          legCost.mieOverride ? (legCost.mieOverrideAmount || 0) : '',  // MIE_Override_Amount
          legCost.mieOverrideReason || '',                  // MIE_Override_Reason
          legCost.mieTotal || 0,                            // MIE_Total
          legCost.localMilesDriven || '',                   // Local_Miles_Driven
          legCost.wasGovVehicleAvailable || '',             // Was_Gov_Vehicle_Available
          legCost.localParking || '',                       // Local_Parking
          legCost.localTolls || '',                         // Local_Tolls
          legCost.localTravelTotal || 0,                    // Local_Travel_Total
          legCost.legSubtotal || 0                          // Leg_Subtotal
        ]);
      });
    });

    // Batch write leg costs
    if (legCostRows.length > 0) {
      legCostsSheet.getRange(legCostsSheet.getLastRow() + 1, 1, legCostRows.length, legCostRows[0].length)
        .setValues(legCostRows);
    }

    // ========== Update Request with calculated totals ==========

    const grandTotal = calculateGrandTotal(travelerTotal, sharedTotal);

    // The request row was the last appendRow on this sheet — getLastRow()
    // is O(1) so we can target it directly without re-reading the whole
    // sheet. Traveler_Total and Grand_Total are adjacent columns in the
    // schema, so a single setValues() writes both at once.
    const travelerTotalCol = TRAVEL_SHEET_SCHEMAS.Requests.indexOf('Traveler_Total') + 1;
    const grandTotalCol = TRAVEL_SHEET_SCHEMAS.Requests.indexOf('Grand_Total') + 1;
    if (travelerTotalCol > 0 && grandTotalCol === travelerTotalCol + 1) {
      requestsSheet.getRange(requestsSheet.getLastRow(), travelerTotalCol, 1, 2)
        .setValues([[travelerTotal, grandTotal]]);
    } else if (travelerTotalCol > 0 && grandTotalCol > 0) {
      // Defensive — schema columns moved, fall back to two writes
      const lastRow = requestsSheet.getLastRow();
      requestsSheet.getRange(lastRow, travelerTotalCol).setValue(travelerTotal);
      requestsSheet.getRange(lastRow, grandTotalCol).setValue(grandTotal);
    }

    // ========== Create Approval Log Entry ==========

    const logSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
    if (logSheet) {
      const logId = generateLogId();
      const logRow = [
        logId,                                              // Log_ID
        requestId,                                          // Request_ID
        ACTION_TYPES.SUBMITTED,                                        // Action
        userName,                                           // Action_By_Name
        userEmail,                                          // Action_By_Email
        'Submitter',                                        // Action_By_Role
        now,                                                // Timestamp
        '',                                                 // Previous_Status (none - new submission)
        routing.status,                                     // New_Status (from smart routing)
        '',                                                 // Comments
        '',                                                 // Section_Comments
        '',                                                 // Snapshot_Data
        '',                                                 // Version_Before
        1                                                   // Version_After
      ];
      logSheet.appendRow(logRow);
    }

    // ========== Handle Attachments ==========

    let attachmentsFolder = '';

    // Build travelers array for folder naming and NFS file handling
    const travelers = (formData.travelers || []).map(t => ({
      id: t.id,
      name: t.employeeName || t.name || t.displayName || 'Unknown',
      employeeName: t.employeeName || t.name || t.displayName || 'Unknown',
      nfsFileId: t.nfsFileId || null
    }));

    // Check what files need to be finalized
    const hasAttachments = formData.attachmentFileIds && formData.attachmentFileIds.length > 0;
    const hasNfsFiles = travelers.some(t => t.nfsFileId);

    console.log('Checking for files to finalize:', {
      attachmentFileIds: formData.attachmentFileIds,
      hasAttachments,
      hasNfsFiles,
      travelerNfsFiles: travelers.filter(t => t.nfsFileId).map(t => ({ id: t.id, name: t.name, nfsFileId: t.nfsFileId }))
    });

    if (hasAttachments || hasNfsFiles) {
      console.log(`Found files to process: ${hasAttachments ? formData.attachmentFileIds.length : 0} supporting docs, ${travelers.filter(t => t.nfsFileId).length} NFS worksheets`);
      try {
        // Build list of reviewer emails for sharing
        const reviewerEmails = [];
        if (buReviewer && buReviewer.email) {
          reviewerEmails.push(buReviewer.email);
          if (buReviewer.backupEmail) {
            reviewerEmails.push(buReviewer.backupEmail);
          }
        }

        const attachmentResult = finalizeRequestAttachments(
          formData.attachmentFileIds || [],
          requestId,
          'supporting_doc',
          {
            travelers: travelers,
            draftId: formData.draftId || null,
            reviewerEmails: reviewerEmails
          }
        );
        console.log('finalizeRequestAttachments result:', JSON.stringify(attachmentResult));
        if (attachmentResult.success) {
          attachmentsFolder = attachmentResult.folderUrl;
          console.log(`Attachments finalized for ${requestId}: ${attachmentResult.attachments.length} files`);
        } else {
          console.warn(`Failed to finalize attachments: ${attachmentResult.error}`);
        }
      } catch (attachError) {
        console.error('Error finalizing attachments:', attachError);
        // Don't fail the submission for attachment errors
      }
    } else {
      console.log('No files to finalize (no attachments or NFS worksheets)');
    }

    // ========== Send Notification Email ==========

    // Pass the current reviewer (from smart routing) and the initial review level
    const currentReviewer = {
      name: routing.currentReviewerName,
      email: routing.currentReviewerEmail
    };
    sendSubmissionNotification(requestId, formData, currentReviewer, routing.initialLevel);

    // Invalidate + re-warm cached sheets that were written to.
    // REQUEST_LEGS + TRAVELER_LEG_COSTS were missing from this list — bug
    // surfaced during 10.D smoke when getDeletePreview warmed the
    // REQUEST_LEGS cache; subsequent submissions wrote legs but the cache
    // kept serving the pre-submission snapshot, so getRequestForReview
    // reported "No destinations specified" on the just-submitted request.
    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);
    db.invalidate(SHEET_NAMES.REQUEST_TRAVELERS);
    db.invalidate(SHEET_NAMES.REQUEST_LEGS);
    db.invalidate(SHEET_NAMES.TRAVELER_LEG_COSTS);

    console.log(`Travel request ${requestId} submitted successfully by ${userEmail}`);

    return successResponse({
      requestId: requestId,
      grandTotal: grandTotal,
      attachmentsFolder: attachmentsFolder,
      message: 'Travel request submitted successfully'
    });

  } catch (error) {
    logError('submitTravelRequestV2', error, { tripName: formData && formData.tripName });
    return errorResponse(error.message || 'Failed to submit travel request');
  }
}

// ============================================================================
// LOOKUP FUNCTIONS
// ============================================================================

/**
 * Look up BU reviewer for a given BU.
 *
 * Scope on bu_reviewer rows is the BU NAME (e.g. "OSO", "Army"), so the
 * lookup needs a name. Two ways to get one:
 *
 *   1. buNameHint (preferred): caller already knows the operational BU
 *      from HC staffing — pass it directly. This is what submission
 *      uses since getSubmitterInfo gets buName straight from the
 *      position record's org.businessUnit field.
 *
 *   2. Fallback resolve via orgToBU 3-char prefix match. Used only when
 *      the caller has just a buCode and no buNameHint. WARNING: this
 *      path can mis-resolve when HC's org hierarchy puts a sub-org
 *      under a different parent BU than the staffing position says.
 *      Example: QF1A is Brian Oakes' sector. Staffing says BU=OSO.
 *      Hierarchy says QF1 → Commissioner's Office. Prefix match
 *      returns COS, which is excluded — submission cascades wrong.
 *
 * @param {string} buCode - Business Unit code (3 chars, e.g. 'QF1')
 * @param {string} [buNameHint] - BU name from the submitter's HC position
 * @returns {Object|null} { name, email, backupName, backupEmail, buName }
 * @server
 */
function lookupBUReviewer(buCode, buNameHint) {
  var buName = String(buNameHint || '').trim();

  if (!buName) {
    if (!buCode) return null;
    try {
      var orgLookups = loadOrgLookups();
      var orgToBU = (orgLookups && orgLookups.orgToBU) || {};
      var bcUpper = String(buCode).toUpperCase();
      for (var oc in orgToBU) {
        if (!orgToBU.hasOwnProperty(oc)) continue;
        if (String(oc).substring(0, 3).toUpperCase() === bcUpper) {
          buName = orgToBU[oc];
          break;
        }
      }
    } catch (resolveErr) {
      console.error('lookupBUReviewer: resolve error: ' + resolveErr.message);
      return null;
    }
    if (!buName) {
      console.log('lookupBUReviewer: No BU name resolved for code', buCode);
      return null;
    }
  }

  try {

    var data = _getUnifiedRoleData();
    var primary = null;
    var backup = null;
    for (var em in data.rolesByEmail) {
      if (!data.rolesByEmail.hasOwnProperty(em)) continue;
      var roles = data.rolesByEmail[em];
      for (var i = 0; i < roles.length; i++) {
        var r = roles[i];
        if (r.roleType !== 'bu_reviewer') continue;
        if (r.scope !== buName) continue;
        if (r.isPrimary && !primary) {
          primary = { name: r.userName || '', email: em };
        } else if (!r.isPrimary && !backup) {
          backup = { name: r.userName || '', email: em };
        }
      }
    }

    if (!primary && !backup) {
      console.log('lookupBUReviewer: No active reviewer for BU', buCode, '(', buName, ')');
      return null;
    }
    // Routing target = primary if active primary exists, else backup.
    // Backup-only is normally rare (smart-default + auto-promote keep
    // a primary present whenever a backup is) but can happen if admin
    // explicitly added a backup-first or during the ms between a
    // primary deactivation and the auto-promote write. Either way, the
    // right thing for routing is to send the request to the active
    // backup, not to skip the BU stage.
    var routingTarget = primary || backup;
    return {
      name: routingTarget.name,
      email: routingTarget.email,
      // backup fields stay populated only when distinct from the routing
      // target — useful for the cc-on-notification path
      backupName: (backup && backup !== routingTarget) ? backup.name : '',
      backupEmail: (backup && backup !== routingTarget) ? backup.email : '',
      buName: buName,
      isFallbackToBackup: !primary
    };
  } catch (e) {
    console.error('lookupBUReviewer error:', e.message);
    return null;
  }
}

/**
 * Load BU reviewers from sheet
 * @returns {Array} Array of reviewer objects
 */
/**
 * Get the AAS FO reviewer set (formerly "OSO reviewers"). Single-source as
 * of Phase 7 cutover: walks Travel_User_Roles for active aas_fo_reviewer
 * roles. Returns the same shape downstream consumers expect:
 *   { primary: { name, email } | null, cc: [{ name, email }, ...] }
 * The active backup is included in cc so existing CC-on-notification
 * logic keeps working without modification.
 *
 * @returns {Object} { primary, cc }
 * @server
 */
function getOSOReviewers() {
  try {
    var data = _getUnifiedRoleData();
    var primary = null;
    var cc = [];
    for (var em in data.rolesByEmail) {
      if (!data.rolesByEmail.hasOwnProperty(em)) continue;
      var roles = data.rolesByEmail[em];
      for (var i = 0; i < roles.length; i++) {
        var r = roles[i];
        if (r.roleType !== 'aas_fo_reviewer') continue;
        var reviewer = { name: r.userName || '', email: em };
        if (r.isPrimary && !primary) primary = reviewer;
        else cc.push(reviewer);
      }
    }
    // If no active primary exists but a backup does, promote the first
    // cc entry (active backup) into the primary slot so routing has
    // a target. Auto-promote logic should keep this state rare, but
    // admin can still configure backup-only.
    if (!primary && cc.length > 0) {
      primary = cc.shift();
    }
    return { primary: primary, cc: cc };
  } catch (e) {
    console.error('getOSOReviewers error:', e.message);
    return { primary: null, cc: [] };
  }
}

/**
 * Get the FAS FO reviewer email + name. Single-source as of Phase 7:
 * reads from Travel_User_Roles for the active primary fas_fo_reviewer
 * role. Returns { email, name } or { email: '', name: '' } if none.
 *
 * @returns {Object} { email, name }
 * @server
 */
function getFASReviewer() {
  try {
    var data = _getUnifiedRoleData();
    var primary = null;
    var backup = null;
    for (var em in data.rolesByEmail) {
      if (!data.rolesByEmail.hasOwnProperty(em)) continue;
      var roles = data.rolesByEmail[em];
      for (var i = 0; i < roles.length; i++) {
        var r = roles[i];
        if (r.roleType !== 'fas_fo_reviewer') continue;
        var reviewer = { email: em, name: r.userName || 'FAS Reviewer' };
        if (r.isPrimary && !primary) primary = reviewer;
        else if (!r.isPrimary && !backup) backup = reviewer;
      }
    }
    // Backup fallback when no active primary exists.
    return primary || backup || { email: '', name: '' };
  } catch (e) {
    console.error('getFASReviewer error:', e.message);
  }
  return { email: '', name: '' };
}

// ============================================================================
// ROUTING SIMULATION — admin diagnostic, no writes
// ============================================================================

/**
 * Trace what would happen if `submitterEmail` submitted a request right now.
 * Pure read — runs the same submitter-info lookup, reviewer resolution, and
 * smart-routing logic the real submission path uses, then returns a structured
 * trace instead of writing anything.
 *
 * Useful for go-live verification:
 *   - "Does Patricia in Army route through Army's BU reviewer?"
 *   - "Does an OSO submitter skip BU correctly?"
 *   - "What happens if Sector 5 has no SD on file?"
 *
 * @param {string} submitterEmail
 * @param {Object} [opts] - { isOverhead: bool } — affects FAS routing
 * @returns {Object} {
 *   submitter:   { email, name, orgCode, buCode, buName, sectorCode, source },
 *   reviewers:   { sectorDirector, buReviewer, aasFoPrimary, fasReviewer },
 *   skipRules:   { isOSOReviewer, isBUReviewer, isSD },
 *   routing:     { stage, status, reviewerEmail, reviewerName },
 *   gaps:        string[]   — vacancies / missing config detected
 *   warnings:    string[]   — soft caveats (fallback to backup, etc.)
 * }
 * @editor
 */
function simulateSubmissionRouting(submitterEmail, opts) {
  try {
    requireTravelAdmin();
  } catch (e) {
    return { success: false, error: e.message || 'Admin access required' };
  }
  if (!submitterEmail) {
    return { success: false, error: 'submitterEmail required' };
  }
  opts = opts || {};
  var isOverhead = opts.isOverhead === true;

  var trace = {
    success: true,
    submitter: {},
    reviewers: {},
    skipRules: {},
    routing: {},
    gaps: [],
    warnings: []
  };

  // Submitter info
  var info = getSubmitterInfo(submitterEmail);
  trace.submitter = {
    email: submitterEmail,
    name: info.name || '',
    orgCode: info.orgCode || '',
    buCode: info.buCode || '',
    buName: info.buName || '',
    sectorCode: (info.orgCode || '').substring(0, 4) || '',
    source: info.source || (info.success ? 'unknown' : 'not-found')
  };
  if (!info.orgCode) {
    trace.gaps.push('Submitter has no org code resolved (not in HC bundle, not in Test_Submitters). Routing will land at AAS FO via cascade.');
  }
  if (!info.buCode) {
    trace.gaps.push('Submitter has no BU code resolved.');
  }

  // Reviewer lookups (same as real submission path) — pass buName so
  // routing matches HC staffing's operational BU, not the 3-char prefix.
  var sectorDirector = findSectorDirector(trace.submitter.orgCode);
  var buReviewer = lookupBUReviewer(trace.submitter.buCode, trace.submitter.buName);
  var osoData = getOSOReviewers();
  var aasFoPrimary = osoData ? osoData.primary : null;
  var fasReviewer = getFASReviewer();

  trace.reviewers = {
    sectorDirector: sectorDirector || null,
    buReviewer: buReviewer || null,
    aasFoPrimary: aasFoPrimary || null,
    fasReviewer: (fasReviewer && fasReviewer.email) ? fasReviewer : null
  };

  // Surface backup-fallback warnings so admin can spot misconfigured pairs
  if (buReviewer && buReviewer.isFallbackToBackup) {
    trace.warnings.push('BU "' + (buReviewer.buName || trace.submitter.buCode) +
      '" has no active primary — routing falls back to the backup.');
  }
  // Only flag missing SD when the submitter actually HAS a sector — i.e.
  // a 4-char sector code from a full orgCode. BU-office submitters
  // (orgCode is just the 3-char BU prefix) legitimately don't sit in any
  // sector and should cascade past the Sector stage to BU.
  if (!sectorDirector && trace.submitter.orgCode && trace.submitter.orgCode.length >= 4) {
    trace.gaps.push('No sector director resolved for sector "' + trace.submitter.sectorCode + '".');
  }
  if (!buReviewer && trace.submitter.buName) {
    // Commissioner's Office and Innovation are intentionally excluded
    // from BU routing (AAS FO covers COS submissions; Innovation is
    // Not In Use). Treat those as informational, not gap warnings.
    var EXCLUDED_BU_INFO = { "Commissioner's Office": true, "Innovation": true };
    if (EXCLUDED_BU_INFO[trace.submitter.buName]) {
      trace.warnings.push('BU "' + trace.submitter.buName + '" is excluded from BU routing by design — request will cascade to AAS FO.');
    } else {
      trace.gaps.push('No BU reviewer configured for "' + trace.submitter.buName + '" — cascade will skip BU stage.');
    }
  }
  if (!aasFoPrimary) {
    trace.gaps.push('No AAS FO Primary configured — overhead requests would orphan at FAS or stall.');
  }
  if (isOverhead && !trace.reviewers.fasReviewer) {
    trace.gaps.push('No FAS FO reviewer configured — overhead requests cannot complete review.');
  }

  // Skip rules
  var sl = String(submitterEmail).toLowerCase();
  trace.skipRules = {
    isOSOReviewer: !!(aasFoPrimary && aasFoPrimary.email && sl === aasFoPrimary.email.toLowerCase()),
    isBUReviewer:  !!(buReviewer && buReviewer.email && sl === buReviewer.email.toLowerCase()),
    isSD:          !!(sectorDirector && sectorDirector.email && sl === sectorDirector.email.toLowerCase())
  };

  // Run the real routing decision (pure function, no writes). Travelers
  // shape needs to match what _hasOverheadFromData reads —
  // t.isClientPaid takes 'Overhead' or 'Client' (not funding_source).
  var travelers = isOverhead
    ? [{ isClientPaid: 'Overhead' }]
    : [{ isClientPaid: 'Client' }];
  var routing = determineInitialRouting(submitterEmail, sectorDirector, buReviewer, travelers);
  trace.routing = {
    stage: routing.initialLevel,
    status: routing.status,
    reviewerEmail: routing.currentReviewerEmail || '',
    reviewerName: routing.currentReviewerName || '',
    overheadAssumed: isOverhead
  };

  return trace;
}

/**
 * Editor helper: clear every cache that could be holding stale role
 * data after a manual sheet edit. Run this from the editor whenever
 * you've edited Travel_User_Roles directly and want the next routing
 * simulation to reflect your change immediately (instead of waiting
 * for the 5-minute TTL to expire).
 *
 * Clears:
 *   - _invalidateUnifiedRoleCache (the unified_roles_v1 CacheService key)
 *   - _invalidateUserCaches       (user-roster caches feeding the admin
 *                                  page)
 *   - all script-cache keys matching travel_* prefixes that downstream
 *     reviewer-perf / dashboard code uses
 *
 * No-op outside admin context — safe to leave wired.
 * @editor
 */
function _bustRoutingCachesForTesting() {
  try { requireTravelAdmin(); }
  catch (e) { return { success: false, error: e.message || 'Admin access required' }; }

  var cleared = [];
  try { _invalidateUnifiedRoleCache(); cleared.push('unified_roles_v1'); }
  catch (e) { console.warn('unified roles invalidate: ' + e.message); }

  try {
    if (typeof _invalidateUserCaches === 'function') {
      _invalidateUserCaches();
      cleared.push('user roster caches');
    }
  } catch (e) { console.warn('user caches invalidate: ' + e.message); }

  // Belt-and-suspenders: clear any travel-related script-cache entry
  // that might be serving stale data.
  try {
    var cache = CacheService.getScriptCache();
    var keys = ['travel_admins', 'bu_reviewers', 'oso_reviewers',
                'aas_org_scope_v1', 'unified_roles_v1'];
    cache.removeAll(keys);
    cleared.push('explicit script-cache keys: ' + keys.join(', '));
  } catch (e) { console.warn('script cache: ' + e.message); }

  console.log('=== Routing caches cleared ===');
  cleared.forEach(function(c) { console.log('  ✓ ' + c); });
  console.log('Next routing simulation will read fresh data from sheets.');
  return { success: true, cleared: cleared };
}

/**
 * Editor convenience wrapper: edit TEST_EMAIL + TEST_OVERHEAD, save,
 * click Run, check Logs.
 * @editor
 */
function _testRouting() {
  var TEST_EMAIL = 'someone@gsa.gov';   // edit me
  var TEST_OVERHEAD = true;             // edit me — true=overhead, false=client-paid
  var result = simulateSubmissionRouting(TEST_EMAIL, { isOverhead: TEST_OVERHEAD });
  if (!result.success) {
    console.error('simulateSubmissionRouting failed: ' + result.error);
    return result;
  }
  // Reuse the shared report renderer for consistent formatting.
  var row = {
    label: TEST_EMAIL,
    email: TEST_EMAIL,
    isOverhead: TEST_OVERHEAD,
    submitter: result.submitter,
    skipRules: result.skipRules,
    routing: result.routing,
    warnings: result.warnings || [],
    gaps: result.gaps || []
  };
  _printRoutingReport('ROUTING SIMULATION — SINGLE EMAIL', [row]);
  return result;
}

/**
 * Walk HC staffing for one representative submitter per BU and simulate
 * routing for both overhead and client-paid scenarios. Surfaces every
 * routing path TRIP needs to handle in one pass.
 *
 * Output shape:
 *   {
 *     success, totalSimulations, gapCount, perBU: [
 *       { buName, sample: { email, name, orgCode },
 *         overhead: { stage, reviewerEmail, gaps, warnings },
 *         clientPaid: { stage, reviewerEmail, gaps, warnings } },
 *       ...
 *     ]
 *   }
 *
 * Run from the Apps Script editor; logs a flat summary table for quick scan.
 * @editor
 */
function simulateAllRoutingPaths() {
  try {
    requireTravelAdmin();
  } catch (e) {
    return { success: false, error: e.message || 'Admin access required' };
  }

  // EXCLUDED_BUS mirrors the routing dashboard — Commissioner's Office +
  // Innovation are not TRIP-routable.
  var EXCLUDED_BUS = { "Commissioner's Office": true, "Innovation": true };

  // Pick one staffed-and-emailed position per BU as the sample submitter.
  var perBUSample = {};
  try {
    var bundle = HC.hcGetBundle();
    if (!bundle || !bundle.success || !bundle.data) {
      return { success: false, error: 'HC bundle unavailable' };
    }
    for (var i = 0; i < bundle.data.length; i++) {
      var p = bundle.data[i];
      if (!p || !p.org || !p.emailAddress) continue;
      var bu = p.org.businessUnit || '';
      if (!bu || EXCLUDED_BUS[bu]) continue;
      if (perBUSample[bu]) continue;
      var occ = String(p.occupancyStatus || '').toUpperCase();
      if (occ === 'VACANT' || occ === 'OBLIGATED') continue;
      perBUSample[bu] = {
        email: p.emailAddress,
        name: p.employeeName || '',
        orgCode: p.orgCode || '',
        sectorName: (p.org && p.org.sector) || ''
      };
    }
  } catch (he) {
    return { success: false, error: 'HC walk failed: ' + he.message };
  }

  var perBU = [];
  var totalGaps = 0;
  var BU_ORDER = ['OSO', 'Army', 'AF/Navy/SF', 'Civilian', 'Defense'];
  function _orderIdx(name) {
    var i = BU_ORDER.indexOf(name);
    return i === -1 ? BU_ORDER.length + 1 : i;
  }
  var buNames = Object.keys(perBUSample).sort(function(a, b) {
    var ai = _orderIdx(a), bi = _orderIdx(b);
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });

  for (var b = 0; b < buNames.length; b++) {
    var sample = perBUSample[buNames[b]];
    var oh = simulateSubmissionRouting(sample.email, { isOverhead: true });
    var cp = simulateSubmissionRouting(sample.email, { isOverhead: false });
    totalGaps += (oh.gaps || []).length + (cp.gaps || []).length;
    perBU.push({
      buName: buNames[b],
      sample: sample,
      overhead: {
        stage: oh.routing && oh.routing.stage,
        status: oh.routing && oh.routing.status,
        reviewerEmail: oh.routing && oh.routing.reviewerEmail,
        reviewerName: oh.routing && oh.routing.reviewerName,
        gaps: oh.gaps || [],
        warnings: oh.warnings || []
      },
      clientPaid: {
        stage: cp.routing && cp.routing.stage,
        status: cp.routing && cp.routing.status,
        reviewerEmail: cp.routing && cp.routing.reviewerEmail,
        reviewerName: cp.routing && cp.routing.reviewerName,
        gaps: cp.gaps || [],
        warnings: cp.warnings || []
      }
    });
  }

  return {
    success: true,
    totalSimulations: perBU.length * 2,
    gapCount: totalGaps,
    perBU: perBU
  };
}

/**
 * Run simulateSubmissionRouting across a hand-picked list of submissions.
 * Use this when you want targeted coverage — e.g. one regular employee
 * per BU, plus the BU primaries, plus an AAS FO Primary, plus a Sector
 * Director — to verify every routing flavor TRIP must handle.
 *
 * @param {Array<{email: string, isOverhead?: boolean, label?: string}>} submissions
 * @returns {Object} { success, totalSimulations, gapCount, results: [...] }
 * @editor
 */
function simulateRoutingForList(submissions) {
  try {
    requireTravelAdmin();
  } catch (e) {
    return { success: false, error: e.message || 'Admin access required' };
  }
  if (!Array.isArray(submissions) || submissions.length === 0) {
    return { success: false, error: 'submissions array required' };
  }

  var results = [];
  var totalGaps = 0;
  for (var i = 0; i < submissions.length; i++) {
    var s = submissions[i] || {};
    if (!s.email) {
      results.push({ label: s.label || ('row ' + (i + 1)), error: 'no email' });
      continue;
    }
    var trace = simulateSubmissionRouting(s.email, { isOverhead: !!s.isOverhead });
    if (trace.gaps) totalGaps += trace.gaps.length;
    results.push({
      label: s.label || s.email,
      email: s.email,
      isOverhead: !!s.isOverhead,
      submitter: trace.submitter,
      skipRules: trace.skipRules,
      routing: trace.routing,
      gaps: trace.gaps || [],
      warnings: trace.warnings || []
    });
  }

  return {
    success: true,
    totalSimulations: results.length,
    gapCount: totalGaps,
    results: results
  };
}

/**
 * Editor convenience wrapper for simulateRoutingForList. Edit the
 * TEST_LIST below with the emails you want to spot-check — cover
 * each BU, both overhead and client-paid, plus the routing-pair
 * principals (BU primaries, AAS FO, SDs) so the skip rules get
 * exercised. Save, click Run, scan the execution log.
 * @editor
 */
function _testRoutingList() {
  // Edit me. Each entry: { email, isOverhead, label? }
  //   - email      → who's submitting
  //   - isOverhead → true=overhead routing, false=client-paid (ends earlier)
  //   - label      → optional friendly name shown in the log
  //
  // Categories below are edge cases worth exercising. Swap the
  // placeholders for real GSA emails from your address book.
  var TEST_LIST = [
    // 1. Regular employee deep in a sector (6-char orgCode). Should
    //    route to Sector Director FIRST (not BU). This is the path
    //    the auto-walker doesn't reach because it picks BU-office
    //    samples.
    { email: 'employee.in.qfaa@gsa.gov',   isOverhead: true,  label: '[1] Deep-sector employee' },

    // 2. The AAS FO Primary (Jennifer Crouse) submitting.
    //    Overhead   → should skip everything, route to FAS (Stephanie)
    //    Client-paid → should skip everything, status=APPROVED_GOGOV (no reviewer needed)
    { email: 'jennifer.crouse@gsa.gov',    isOverhead: true,  label: '[2] AAS FO Primary OH' },
    { email: 'jennifer.crouse@gsa.gov',    isOverhead: false, label: '[2] AAS FO Primary CP' },

    // 3. The AAS FO BACKUP (Zachary Barefoot) submitting. Not the
    //    active primary, so NO skip rule. Should route normally
    //    through their BU/Sector chain.
    { email: 'zachary.barefoot@gsa.gov',   isOverhead: true,  label: '[3] AAS FO Backup submits' },

    // 4. The FAS FO Primary (Stephanie Shutt) submitting. There's no
    //    skip rule for FAS FO. Should route normally through their
    //    own BU/Sector. (FAS skip only matters for the AAS FO cascading
    //    onward, not for the FAS reviewer themselves.)
    { email: 'stephanie.shutt@gsa.gov',    isOverhead: true,  label: '[4] FAS FO submits' },

    // 5. A Sector Director (other than Brian Oakes) — verify the SD
    //    skip rule fires, routes past Sector to BU.
    { email: 'some.sector.director@gsa.gov', isOverhead: true, label: '[5] Other SD submits' },

    // 6. Someone in Commissioner's Office (orgCode prefix QF1).
    //    BU is excluded — should cascade past BU to AAS FO.
    { email: 'someone.in.cos@gsa.gov',     isOverhead: true,  label: '[6] COS person' },

    // 7. An Admin who isn't ALSO a reviewer (e.g. Justin Aguila).
    //    No skip rules — routes through normal Sector/BU/OSO chain.
    { email: 'justin.aguila@gsa.gov',      isOverhead: true,  label: '[7] Admin-only submits' },

    // 8. A non-HC user (Test_Submitters fallback). orgCode comes
    //    from Test_Submitters row instead of HC bundle.
    { email: 'consultant.via.test@gsa.gov', isOverhead: true, label: '[8] Test_Submitters fallback' },

    // 9. An unknown email (not in HC, not in Test_Submitters).
    //    Should land at AAS FO via cascade (no orgCode → no Sector
    //    → no BU → routes to AAS FO).
    { email: 'totally.unknown@gsa.gov',    isOverhead: true,  label: '[9] Unknown email' }
  ];

  var result = simulateRoutingForList(TEST_LIST);
  if (!result.success) {
    console.error('simulateRoutingForList failed: ' + result.error);
    return result;
  }
  _printRoutingReport('ROUTING SIMULATION — TEST LIST', result.results);
  return result;
}

/**
 * Pretty-print a list of simulator result rows as a scannable report.
 * Banner + per-row block + final summary. Each row uses a status icon
 * so admins can scan the whole log at a glance and only zoom in on
 * the problem rows.
 *
 * Status icons:
 *   ✓ — routed to a real reviewer with no gaps
 *   ⚠ — routed correctly, but with informational warnings
 *   ⛔ — gap detected (vacant reviewer / missing config / unrouteable)
 *
 * @param {string} title
 * @param {Array} rows  — output of simulateRoutingForList(...).results
 * @private
 * @server
 */
function _printRoutingReport(title, rows) {
  var BAR = '════════════════════════════════════════════════════════════════════';
  var SEP = '────────────────────────────────────────────────────────────────────';

  var totals = { ok: 0, warn: 0, gap: 0, err: 0 };
  rows.forEach(function(r) {
    if (r.error) totals.err++;
    else if ((r.gaps || []).length) totals.gap++;
    else if ((r.warnings || []).length) totals.warn++;
    else totals.ok++;
  });

  console.log(BAR);
  console.log('  ' + title);
  console.log('  ' + rows.length + ' rows · ' + totals.ok + ' ok · ' +
    totals.warn + ' with warnings · ' + totals.gap + ' with gaps · ' + totals.err + ' errors');
  console.log(BAR);

  rows.forEach(function(r, i) {
    if (i > 0) console.log(SEP);
    if (r.error) {
      console.warn('⛔ ' + (r.label || ('row ' + (i + 1))) + ' — ' + r.error);
      return;
    }
    var icon = (r.gaps || []).length ? '⛔'
             : (r.warnings || []).length ? '⚠'
             : '✓';
    var bu = (r.submitter && r.submitter.buName) || '(no BU)';
    var name = (r.submitter && r.submitter.name) || '(unknown)';
    var stage = (r.routing && r.routing.stage) || '?';
    var status = (r.routing && r.routing.status) || '?';
    var rev = (r.routing && r.routing.reviewerEmail) || '(no reviewer)';
    var revName = (r.routing && r.routing.reviewerName) || '';
    var trip = r.isOverhead ? 'overhead' : 'client-paid';

    var skipBits = [];
    if (r.skipRules.isOSOReviewer) skipBits.push('skip:AAS-FO');
    if (r.skipRules.isBUReviewer)  skipBits.push('skip:BU');
    if (r.skipRules.isSD)          skipBits.push('skip:SD');
    var skip = skipBits.length ? '  [' + skipBits.join(', ') + ']' : '';

    console.log(icon + ' ' + (r.label || r.email));
    console.log('   ' + name + ' — ' + bu);
    console.log('   ' + trip + '  →  ' + stage + ' (' + status + ')  →  ' +
      (revName ? revName + ' <' + rev + '>' : rev) + skip);

    (r.warnings || []).forEach(function(w) { console.log('   ⓘ ' + w); });
    (r.gaps || []).forEach(function(g) { console.warn('   ⛔ GAP: ' + g); });
  });

  console.log(BAR);
  if (totals.gap || totals.err) {
    console.warn('  ' + (totals.gap + totals.err) + ' row(s) need attention before launch.');
  } else if (totals.warn) {
    console.log('  All rows routed to a real reviewer. ' + totals.warn + ' informational warning(s) — review and confirm intended.');
  } else {
    console.log('  All rows routed cleanly. ✓');
  }
  console.log(BAR);
}

/**
 * Editor convenience wrapper for simulateAllRoutingPaths. Logs a flat
 * one-line-per-BU summary so the result is scannable in the editor's
 * execution log.
 * @editor
 */
function _testAllRoutingPaths() {
  var result = simulateAllRoutingPaths();
  if (!result.success) {
    console.error('simulateAllRoutingPaths failed: ' + result.error);
    return result;
  }
  // Flatten the per-BU matrix into rows the shared renderer expects.
  var rows = [];
  result.perBU.forEach(function(b) {
    rows.push({
      label: b.buName + ' — overhead',
      isOverhead: true,
      submitter: { name: b.sample.name, email: b.sample.email, buName: b.buName },
      skipRules: {},  // not collected in coverage mode; renderer handles missing
      routing: {
        stage: b.overhead.stage,
        status: b.overhead.status,
        reviewerEmail: b.overhead.reviewerEmail,
        reviewerName: b.overhead.reviewerName
      },
      warnings: b.overhead.warnings || [],
      gaps: b.overhead.gaps || []
    });
    rows.push({
      label: b.buName + ' — client-paid',
      isOverhead: false,
      submitter: { name: b.sample.name, email: b.sample.email, buName: b.buName },
      skipRules: {},
      routing: {
        stage: b.clientPaid.stage,
        status: b.clientPaid.status,
        reviewerEmail: b.clientPaid.reviewerEmail,
        reviewerName: b.clientPaid.reviewerName
      },
      warnings: b.clientPaid.warnings || [],
      gaps: b.clientPaid.gaps || []
    });
  });
  _printRoutingReport('ROUTING SIMULATION — ALL BUs (auto-walker)', rows);
  return result;
}

// ============================================================================
// NOTIFICATION FUNCTIONS
// ============================================================================

/**
 * Send submission notification emails
 * Uses TravelEmailService for consistent sender (aastravel@gsa.gov)
 *
 * @param {string} requestId - The request ID
 * @param {Object} formData - The form data
 * @param {Object} reviewer - The assigned reviewer (current reviewer from smart routing)
 * @param {string} reviewLevel - 'Sector', 'BU', or 'OSO' (from smart routing)
 * @private
 * @server
 */
function sendSubmissionNotification(requestId, formData, reviewer, reviewLevel) {
  try {
    console.log('sendSubmissionNotification: Called with requestId=', requestId);
    console.log('sendSubmissionNotification: reviewer=', reviewer ? JSON.stringify(reviewer) : 'null');
    console.log('sendSubmissionNotification: reviewLevel=', reviewLevel);

    // Send confirmation to submitter
    const submitterResult = sendSubmitterConfirmation(requestId, formData, reviewer, reviewLevel);
    if (submitterResult.success) {
      console.log(`Submitter confirmation sent for ${requestId}`);
    } else {
      console.warn(`Failed to send submitter confirmation: ${submitterResult.error}`);
    }

    // Send notification to reviewer
    if (reviewer && reviewer.email) {
      console.log('sendSubmissionNotification: Sending reviewer notification to:', reviewer.email);
      const reviewerResult = sendReviewerNotification(requestId, formData, reviewer, reviewLevel);
      if (reviewerResult.success) {
        console.log(`Reviewer notification sent to ${reviewer.email} for ${requestId}`);
      } else {
        console.warn(`Failed to send reviewer notification: ${reviewerResult.error}`);
      }
    } else {
      console.log(`sendSubmissionNotification: No reviewer found for level="${reviewLevel}", skipping reviewer notification`);
    }

  } catch (error) {
    console.error('Error sending notification emails:', error);
    // Don't throw - email failure shouldn't fail the submission
  }
}

// ============================================================================
// CANCELLATION FUNCTION
// ============================================================================

/**
 * Cancel a travel request (submitter action). No client callers in the
 * current codebase — envelope converted for future-proofing + consistency
 * but should be reviewed for deletion if it stays unused through Chunk 15.
 *
 * @param {string} requestId - The request ID to cancel
 * @param {string} reason - Optional cancellation reason
 * @returns {Object} successResponse({ message }) or errorResponse(msg)
 * @client
 */
function cancelTravelRequest(requestId, reason) {
  try {
    const userEmail = Session.getActiveUser().getEmail();

    const db = new TravelDB();
    const sheet = db.sheet(SHEET_NAMES.REQUESTS);

    if (!sheet) {
      throw new Error('Requests sheet not found');
    }

    // Find the request
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const headerIndex = {};
    headers.forEach((h, i) => headerIndex[h] = i);

    let requestRow = -1;
    let previousStatus = '';
    let submitterEmail = '';

    for (let i = 1; i < data.length; i++) {
      if (data[i][headerIndex['Request_ID']] === requestId) {
        requestRow = i + 1;
        previousStatus = data[i][headerIndex['Status']];
        submitterEmail = data[i][headerIndex['Submitter_Email']];
        break;
      }
    }

    if (requestRow === -1) {
      throw new Error('Request not found');
    }

    // Verify submitter owns this request
    if (submitterEmail.toLowerCase() !== userEmail.toLowerCase()) {
      throw new Error('You can only cancel your own requests');
    }

    // Verify request is not already in terminal state
    const terminalStatuses = [STATUS_CODES.COMPLETED, STATUS_CODES.CANCELLED, STATUS_CODES.DENIED];
    if (terminalStatuses.includes(previousStatus)) {
      throw new Error(`Cannot cancel a request with status: ${previousStatus}`);
    }

    // Update status
    const now = new Date();
    sheet.getRange(requestRow, headerIndex['Status'] + 1).setValue(STATUS_CODES.CANCELLED);
    sheet.getRange(requestRow, headerIndex['Updated_At'] + 1).setValue(now);

    // Log cancellation
    const logSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
    if (logSheet) {
      const logId = generateLogId();
      const logRow = [
        logId,
        requestId,
        ACTION_TYPES.SUBMITTER_CANCELLED,
        formatUserName(userEmail),
        userEmail,
        'Submitter',
        now,
        previousStatus,
        STATUS_CODES.CANCELLED,
        reason || '',
        '',
        '',
        '',
        ''
      ];
      logSheet.appendRow(logRow);
    }

    db.invalidate(SHEET_NAMES.REQUESTS);
    db.invalidate(SHEET_NAMES.APPROVAL_LOG);

    console.log(`Request ${requestId} cancelled by ${userEmail}`);

    return successResponse({ message: 'Request cancelled successfully' });

  } catch (error) {
    logError('cancelTravelRequest', error, { requestId: requestId });
    return errorResponse(error.message);
  }
}
