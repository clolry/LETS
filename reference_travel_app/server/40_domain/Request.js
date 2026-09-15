/**
 * TravelRequestService.js
 * Server-side functions for the Travel Request Form
 */

/**
 * Upload NFS Worksheet to Drive
 * @param {string} base64Data - Base64 encoded file content
 * @param {string} fileName - Original file name
 * @param {string} mimeType - File MIME type
 * @returns {Object} Result with fileId or error
 */
/**
 * Get NFS Worksheet template as base64 for embedding in browser.
 * Allows Chrome's native PDF viewer to render it with form support.
 * Template file ID is read from the NFS_TEMPLATE_FILE_ID script property
 * (set in Project Settings → Script Properties) so we don't hardcode it.
 *
 * @returns {{success: boolean, data?: string, mimeType?: string, fileName?: string, error?: string}}
 * @client
 */
function getNFSWorksheetTemplate() {
  try {
    const templateFileId = getNFSTemplateFileId();
    if (!templateFileId) {
      return { success: false, error: 'NFS_TEMPLATE_FILE_ID script property is not set' };
    }
    const file = DriveApp.getFileById(templateFileId);
    const blob = file.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());

    return {
      success: true,
      data: base64,
      mimeType: blob.getContentType(),
      fileName: 'NFS_Worksheet.pdf'
    };
  } catch (error) {
    console.error('Error getting NFS template:', error);
    return {
      success: false,
      error: error.message || 'Failed to load NFS worksheet template'
    };
  }
}


/**
 * Get staffing data for server-side lookups (submitter info, sector director, etc.)
 * Reads from the HC Data Center bundle (owner-populated Script Cache, 10-min refresh).
 * Client-side autocomplete uses HCDataCenter client service directly — this function
 * is only used by other server functions that need staffing data.
 *
 * @returns {Array} Array of employee objects with essential fields, or empty array
 */
function getTravelFormStaffing() {
  try {
    const bundle = HC.hcGetBundle();
    if (!bundle || !bundle.success || !bundle.data) {
      console.warn('getTravelFormStaffing: HC bundle unavailable');
      return [];
    }

    // Map HC positions to the flat shape server consumers expect
    const employees = [];
    const pnLookup = {};

    // First pass: build position lookup for DD chain walking
    for (var i = 0; i < bundle.data.length; i++) {
      var pos = bundle.data[i];
      if (pos.positionNumber) {
        pnLookup[pos.positionNumber] = pos;
      }
    }

    // Second pass: map to flat employee objects
    for (var j = 0; j < bundle.data.length; j++) {
      var pos = bundle.data[j];
      if (pos.occupancyStatus === 'VACANT') continue; // Only staffed positions

      var loc = pos.location || {};
      var org = pos.org || {};

      // Walk supervisor chain to find GS-15 Division Director
      var dd = _findDDFromBundle(pos, pnLookup);

      employees.push({
        employeeId: pos.employeeId || '',
        employeeName: pos.employeeName || '',
        email: pos.emailAddress || '',
        orgCode: pos.orgCode || '',
        bu: org.businessUnit || '',
        lcat: pos.lcat || '',
        dutyLocation: [loc.city, loc.state].filter(Boolean).join(', '),
        supervisorPN: pos.reportsToPositionNumber || '',
        ddName: dd.ddName,
        ddEmail: dd.ddEmail,
        locationCode: pos.locationCode || '',
        dutyStationAddress: loc.address1 || '',
        dutyStationCity: loc.city || '',
        dutyStationState: loc.state || '',
        positionNumber: pos.positionNumber || ''
      });
    }

    console.log('getTravelFormStaffing: Mapped ' + employees.length + ' employees from HC bundle');
    return employees;

  } catch (error) {
    console.error('getTravelFormStaffing: Error reading HC bundle:', error);
    return [];
  }
}

/**
 * Walk supervisor chain in the HC bundle to find GS-15 Division Director.
 * HC bundle includes ALL positions (staffed + vacant) with reportsToPositionNumber,
 * so the chain never breaks on vacants — no Org Directory crosswalk needed.
 *
 * @param {Object} position - Starting position from HC bundle
 * @param {Object} pnLookup - Position number → position lookup map
 * @returns {Object} { ddName, ddEmail }
 */
function _findDDFromBundle(position, pnLookup) {
  var currentPN = position.reportsToPositionNumber;
  var visited = {};
  var depth = 0;

  while (currentPN && depth < 15) {
    if (visited[currentPN]) break; // Prevent infinite loops
    visited[currentPN] = true;

    var supervisor = pnLookup[currentPN];
    if (!supervisor) break;

    // Check if staffed GS-15
    if (String(supervisor.grade || '').trim() === '15' && supervisor.occupancyStatus !== 'VACANT') {
      return {
        ddName: supervisor.employeeName || '',
        ddEmail: supervisor.emailAddress || ''
      };
    }

    currentPN = supervisor.reportsToPositionNumber;
    depth++;
  }

  return { ddName: '', ddEmail: '' };
}

/**
 * Geocode a location to get latitude/longitude coordinates
 * Uses Google Maps service built into Apps Script
 * @param {string} address - Street address (optional, can be empty for city/state only)
 * @param {string} city - City name
 * @param {string} state - State abbreviation or name
 * @returns {Object} Result with lat/lng or error
 */
function geocodeLocation(address, city, state) {
  try {
    // Build the location string
    const locationParts = [];
    if (address && address.trim()) {
      locationParts.push(address.trim());
    }
    if (city && city.trim()) {
      locationParts.push(city.trim());
    }
    if (state && state.trim()) {
      locationParts.push(state.trim());
    }
    locationParts.push('USA'); // Assume US locations

    const locationString = locationParts.join(', ');

    if (!locationString || locationParts.length < 2) {
      return { success: false, error: 'Insufficient location data' };
    }

    // Use Google Maps geocoding service
    const geocoder = Maps.newGeocoder();
    const response = geocoder.geocode(locationString);

    if (response.status !== 'OK' || !response.results || response.results.length === 0) {
      console.log('Geocoding failed for:', locationString, 'Status:', response.status);
      return { success: false, error: 'Location not found' };
    }

    const location = response.results[0].geometry.location;

    return {
      success: true,
      lat: location.lat,
      lng: location.lng,
      formattedAddress: response.results[0].formatted_address
    };

  } catch (error) {
    console.error('Geocoding error:', error);
    return { success: false, error: error.message || 'Geocoding failed' };
  }
}

/**
 * Calculate distance between two locations
 * Geocodes both locations and uses haversine formula
 * @param {Object} origin - { address, city, state }
 * @param {Object} destination - { address, city, state }
 * @returns {Object} Result with distance in miles or error
 */
function calculateTravelDistance(origin, destination) {
  try {
    // Geocode origin
    const originResult = geocodeLocation(
      origin.address || '',
      origin.city || '',
      origin.state || ''
    );
    if (!originResult.success) {
      return { success: false, error: 'Could not geocode origin: ' + originResult.error };
    }

    // Geocode destination
    const destResult = geocodeLocation(
      destination.address || '',
      destination.city || '',
      destination.state || ''
    );
    if (!destResult.success) {
      return { success: false, error: 'Could not geocode destination: ' + destResult.error };
    }

    // Calculate distance using haversine formula
    const distanceMiles = haversineDistance(
      originResult.lat, originResult.lng,
      destResult.lat, destResult.lng
    );

    return {
      success: true,
      distanceMiles: distanceMiles,
      origin: {
        lat: originResult.lat,
        lng: originResult.lng,
        formatted: originResult.formattedAddress
      },
      destination: {
        lat: destResult.lat,
        lng: destResult.lng,
        formatted: destResult.formattedAddress
      }
    };

  } catch (error) {
    console.error('Distance calculation error:', error);
    return { success: false, error: error.message || 'Distance calculation failed' };
  }
}

/**
 * Haversine formula to calculate "as the crow flies" distance
 * @param {number} lat1 - Origin latitude
 * @param {number} lon1 - Origin longitude
 * @param {number} lat2 - Destination latitude
 * @param {number} lon2 - Destination longitude
 * @returns {number} Distance in miles
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Get the current user's travel requests
 * Called from the Travel Portal to display "My Requests" section
 * Also returns pending review requests if user is a reviewer
 * @returns {Object} Result with array of request summaries and pending reviews
 */
/**
 * Build a fresh form blueprint from a previously-submitted request, applying
 * the V2 duplicate copy/reset rules:
 *
 *   COPY (kept on the new request):
 *     - Trip details: tripName, purpose, bluf, locationType, travelTypes,
 *       missionCriticalTypes, isInternational, isOCONUS
 *     - Shared costs: facilities/audioVisual/logistics/other (amount + description)
 *     - Legs: siteName, city, state, country, isInternational, isOCONUS,
 *       locationDisplay, ordering
 *     - Travelers: employeeId/email (identifier), attendingLegs, transportMode,
 *       roleJustification, isClientPaid, localMilesDriven (predictable per route)
 *
 *   RESET (cleared on the new request):
 *     - Event dates (event_start_date, event_end_date)
 *     - Per-leg dates and rate snapshots (per_diem_source, lodging_rate, mie_rate)
 *     - All per-traveler cost fields (transportation, lodging, MIE, local parking/tolls,
 *       rental car, ticket cost, totals, subtotals)
 *     - Was_Gov_Vehicle_Available (decided per trip)
 *     - Attachments (trip-specific)
 *
 *   RE-RESOLVED FROM HC (current values, not stored ones):
 *     - employeeName, orgCode, businessUnit, lcat, ddName, ddEmail,
 *       dutyLocation, dutyLocationCode, isFullTimeTelework, normalCommuteDistance
 *
 * Caller must be the original submitter. Returns:
 *   { success, blueprint, sourceRequestId, sourceTripName, droppedTravelers? }
 *
 * @param {string} requestId - Source request ID to template from
 * @returns {Object}
 */
function getRequestForDuplication(requestId) {
  console.time('getRequestForDuplication');
  try {
    if (!requestId) {
      return { success: false, error: 'requestId is required' };
    }

    const userEmail = (Session.getActiveUser().getEmail() || '').toLowerCase();
    if (!userEmail) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = new TravelDB();

    // ── Source request row ────────────────────────────────────────────────
    const reqData = db.readSheet(SHEET_NAMES.REQUESTS);
    const rIdx = reqData.headerIndex;
    let sourceRow = null;
    for (let i = 0; i < reqData.rows.length; i++) {
      if (reqData.rows[i][rIdx['Request_ID']] === requestId) {
        sourceRow = reqData.rows[i];
        break;
      }
    }
    if (!sourceRow) {
      return { success: false, error: 'Source request not found' };
    }

    // Security: only the original submitter may duplicate their own request
    const submitterEmail = String(sourceRow[rIdx['Submitter_Email']] || '').toLowerCase();
    if (submitterEmail !== userEmail) {
      return { success: false, error: 'You can only duplicate your own requests' };
    }

    // ── Build top-level fields (copy/reset rules) ─────────────────────────
    // Travel_Types and Mission_Critical_Types are stored as JSON array strings
    // by the submission writer (e.g., '["Internal Travel","Foreign Travel"]').
    // Fall back to CSV split if the stored value isn't valid JSON.
    const splitCsv = (s) => s.split(',').map(x => x.trim()).filter(Boolean);
    const parseStringArray = (raw) => {
      const s = String(raw || '').trim();
      if (!s) return [];
      if (s.charAt(0) === '[') {
        try {
          const arr = JSON.parse(s);
          if (Array.isArray(arr)) return arr.map(x => String(x).trim()).filter(Boolean);
        } catch (_) { /* fall through to csv */ }
      }
      return splitCsv(s);
    };

    const blueprint = {
      tripName: sourceRow[rIdx['Trip_Name']] || '',
      locationType: sourceRow[rIdx['Location_Type']] || '',
      eventStartDate: '',  // RESET — submitter provides new dates
      eventEndDate: '',    // RESET
      bluf: sourceRow[rIdx['BLUF']] || '',
      purpose: sourceRow[rIdx['Purpose']] || '',
      travelTypes: parseStringArray(sourceRow[rIdx['Travel_Types']]),
      missionCriticalTypes: parseStringArray(sourceRow[rIdx['Mission_Critical_Types']]),
      isInternational: sourceRow[rIdx['Is_International']] === true ||
        String(sourceRow[rIdx['Is_International']]).toLowerCase() === 'true',
      isOCONUS: sourceRow[rIdx['Is_OCONUS']] === true ||
        String(sourceRow[rIdx['Is_OCONUS']]).toLowerCase() === 'true',
      sharedCosts: {
        facilities: {
          amount: parseFloat(sourceRow[rIdx['Shared_Facilities']]) || 0,
          description: sourceRow[rIdx['Shared_Facilities_Desc']] || ''
        },
        audioVisual: {
          amount: parseFloat(sourceRow[rIdx['Shared_AV']]) || 0,
          description: sourceRow[rIdx['Shared_AV_Desc']] || ''
        },
        logistics: {
          amount: parseFloat(sourceRow[rIdx['Shared_Logistics']]) || 0,
          description: sourceRow[rIdx['Shared_Logistics_Desc']] || ''
        },
        other: {
          amount: parseFloat(sourceRow[rIdx['Shared_Other']]) || 0,
          description: sourceRow[rIdx['Shared_Other_Desc']] || ''
        }
      },
      legs: [],
      travelers: []
    };

    // ── Legs (copy structure, reset dates + rates) ────────────────────────
    const legData = db.readSheet(SHEET_NAMES.REQUEST_LEGS);
    const lIdx = legData.headerIndex;
    const sourceLegs = [];
    for (let i = 0; i < legData.rows.length; i++) {
      if (legData.rows[i][lIdx['Request_ID']] !== requestId) continue;
      sourceLegs.push({
        legId: legData.rows[i][lIdx['Leg_ID']] || '',
        legNumber: parseInt(legData.rows[i][lIdx['Leg_Number']]) || 0,
        siteName: legData.rows[i][lIdx['Site_Name']] || '',
        city: legData.rows[i][lIdx['City']] || '',
        state: legData.rows[i][lIdx['State']] || '',
        country: legData.rows[i][lIdx['Country']] || '',
        isInternational: legData.rows[i][lIdx['Is_International']] === true ||
          String(legData.rows[i][lIdx['Is_International']]).toLowerCase() === 'true',
        isOCONUS: legData.rows[i][lIdx['Is_OCONUS']] === true ||
          String(legData.rows[i][lIdx['Is_OCONUS']]).toLowerCase() === 'true',
        locationDisplay: legData.rows[i][lIdx['Location_Display']] || ''
      });
    }
    sourceLegs.sort((a, b) => a.legNumber - b.legNumber);

    // Re-id legs so the new request gets fresh leg IDs (no collisions with
    // the source). The form expects an `id` field; build canonical client shape.
    const legIdMap = {};  // oldLegId -> newLegId (used to remap attendingLegs)
    sourceLegs.forEach((leg, idx) => {
      const newId = 'leg_' + Date.now() + '_' + idx;
      legIdMap[leg.legId] = newId;
      blueprint.legs.push({
        id: newId,
        siteName: leg.siteName,
        city: leg.city,
        state: leg.state,
        country: leg.country,
        startDate: '',          // RESET
        endDate: '',            // RESET
        isInternational: leg.isInternational,
        isOCONUS: leg.isOCONUS,
        locationDisplay: leg.locationDisplay
        // Per-diem rates intentionally omitted — recomputed when dates entered
      });
    });

    // ── Travelers (copy minimal identity + per-trip role; re-resolve HR) ──
    const travData = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
    const tIdx = travData.headerIndex;

    // Pre-build employeeId/email lookups from current HC staffing
    const staffing = getTravelFormStaffing();  // already filters out VACANT
    const byEmpId = {}, byEmail = {};
    for (let i = 0; i < staffing.length; i++) {
      const e = staffing[i];
      if (e.employeeId) byEmpId[String(e.employeeId)] = e;
      if (e.email) byEmail[String(e.email).toLowerCase()] = e;
    }

    const droppedTravelers = [];
    for (let i = 0; i < travData.rows.length; i++) {
      if (travData.rows[i][tIdx['Request_ID']] !== requestId) continue;

      const sourceTrav = travData.rows[i];
      const sourceEmpId = String(sourceTrav[tIdx['Employee_ID']] || '');
      const sourceEmail = String(sourceTrav[tIdx['Email']] || '').toLowerCase();
      const sourceName = sourceTrav[tIdx['Employee_Name']] || '';

      // Re-resolve from current HC staffing — empId first, email fallback
      const current = byEmpId[sourceEmpId] || byEmail[sourceEmail];
      if (!current) {
        droppedTravelers.push({
          employeeName: sourceName,
          employeeId: sourceEmpId,
          email: sourceEmail,
          reason: 'No longer in staff directory'
        });
        continue;
      }

      // Remap attending legs from old IDs → new IDs (the form keys legs by id).
      // Same JSON-or-CSV resilience as Travel_Types — Attending_Legs is also
      // typically stored as a JSON array string.
      const attendingLegs = parseStringArray(sourceTrav[tIdx['Attending_Legs']])
        .map(oldId => legIdMap[oldId])
        .filter(Boolean);

      blueprint.travelers.push({
        id: 'traveler_' + Date.now() + '_' + i,

        // Identity — from current HC, not source row
        employeeId: current.employeeId || '',
        employeeName: current.employeeName || '',
        email: current.email || '',
        orgCode: current.orgCode || '',
        businessUnit: current.bu || '',
        lcat: current.lcat || '',
        dutyLocation: current.dutyLocation || '',
        dutyLocationCode: current.locationCode || '',
        ddName: current.ddName || '',
        ddEmail: current.ddEmail || '',

        // Per-trip data — copied from source
        attendingLegs: attendingLegs,
        transportMode: sourceTrav[tIdx['Transport_Mode']] || '',
        roleJustification: sourceTrav[tIdx['Role_Justification']] || '',
        isClientPaid: sourceTrav[tIdx['Is_Client_Paid']] || '',

        // Local mileage — predictable per route, retained for repeat trips
        // (rate + parking/tolls reset; user re-enters parking/tolls per trip)
        localMilesDriven: parseFloat(sourceTrav[tIdx['Local_Miles_Driven']]) || 0,

        // Empty legCosts map. The form's _allLegsAreLocalTravel and other
        // render-time helpers index into this object (traveler.legCosts[legId]),
        // so it must exist even when no costs have been computed yet — costs
        // get populated by the date-driven per-diem fetch on the new dates.
        legCosts: {}

        // Everything else (Ticket_Cost, Lodging_Total, MIE_Total, Subtotal,
        // Mileage_Rate, Local_Parking, Local_Tolls, Was_Gov_Vehicle_Available,
        // Is_Full_Time_Telework, Normal_Commute_Distance, etc.) is omitted —
        // recomputed or re-resolved when the user enters dates / when the
        // form pulls fresh HR data.
      });
    }

    const response = {
      success: true,
      blueprint: blueprint,
      sourceRequestId: requestId,
      sourceTripName: sourceRow[rIdx['Trip_Name']] || '',
      droppedTravelers: droppedTravelers
    };

    console.timeEnd('getRequestForDuplication');
    return JSON.parse(JSON.stringify(response));
  } catch (error) {
    console.error('getRequestForDuplication error:', error);
    logError('getRequestForDuplication', error, { requestId: requestId });
    return { success: false, error: error.message || 'Failed to load request for duplication' };
  }
}

/**
 * Single round-trip bootstrap for the Travel Portal page load.
 *
 * Replaces three separate google.script.run calls that the portal used to
 * fire on init (queued, not parallel — total ~600-800ms of stacked latency):
 *   - checkTravelAdminAccess
 *   - checkTravelReviewerAccess
 *   - getMyTravelRequests
 *
 * One call returns everything the portal controller needs to:
 *   - decide which header link (Admin / Reviewer Dashboard) to show
 *   - render My Requests + draft of action items
 *
 * The portal controller falls back to the legacy 3-call path if this one
 * fails — no risk to existing users while we measure the win.
 *
 * @returns {Object} { success, userEmail, isAdmin, isReviewer, role, label,
 *   requests[], pendingReview[], pendingDDConfirmations[] }
 */
function getPortalBootstrap() {
  console.time('getPortalBootstrap');
  try {
    const userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) {
      console.timeEnd('getPortalBootstrap');
      return { success: false, error: 'Not authenticated' };
    }

    // Open the spreadsheet ONCE and share the handle across the two inner
    // helpers — without this, getReviewerContext and getMyTravelRequests
    // each create their own TravelDB instance and pay SpreadsheetApp.openById
    // independently (~500ms each on cold cache). Sharing cuts ~half a second
    // off every cold portal load.
    const db = new TravelDB();

    // Resolve reviewer + admin context in one shot
    // (getReviewerContext checks admin first, then reviewer roles).
    const ctx = getReviewerContext(userEmail, undefined, db);

    // Reuse getMyTravelRequests verbatim for requests + pendingReview +
    // pendingDDConfirmations. Inner console.time block still fires so the
    // breakdown is visible in the execution log.
    const reqResult = getMyTravelRequests(db);
    if (reqResult && !reqResult.success) {
      // Don't throw — return partial bootstrap so portal can still degrade
      // gracefully (header decoration works even if requests list fails).
      console.warn('getPortalBootstrap: getMyTravelRequests failed: ' + reqResult.error);
    }

    // NPS eligibility intentionally NOT bundled here — moved off the critical
    // path. travelFeedbackModal.initNps fires its own google.script.run call
    // after the portal renders. With the UserProperties fast path now in
    // checkNpsEligibility, that follow-up call is ~10ms for repeat users
    // and ~1500ms only for first-ever users (acceptable since it doesn't
    // block the page from rendering).

    const response = {
      success: true,
      userEmail: userEmail,
      isAdmin: !!ctx.isAdmin,
      isReviewer: !!ctx.isReviewer,
      role: ctx.role || 'none',
      label: ctx.label || '',
      requests: (reqResult && reqResult.requests) || [],
      pendingReview: (reqResult && reqResult.pendingReview) || [],
      pendingDDConfirmations: (reqResult && reqResult.pendingDDConfirmations) || []
    };

    console.timeEnd('getPortalBootstrap');
    return JSON.parse(JSON.stringify(response));
  } catch (error) {
    console.error('getPortalBootstrap error:', error);
    logError('getPortalBootstrap', error, {});
    console.timeEnd('getPortalBootstrap');
    return { success: false, error: error.message || 'Bootstrap failed' };
  }
}

/**
 * @param {TravelDB} [sharedDb] - optional pre-opened TravelDB to reuse;
 *   avoids paying SpreadsheetApp.openById twice when called from
 *   getPortalBootstrap.
 */
function getMyTravelRequests(sharedDb) {
  console.time('getMyTravelRequests');
  try {
    const userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) {
      return { success: false, error: 'User not authenticated' };
    }

    const db = sharedDb || new TravelDB();
    const { headers, rows, headerIndex } = db.readSheet(SHEET_NAMES.REQUESTS);

    if (headers.length === 0) {
      console.log('getMyTravelRequests: Requests sheet not found');
      return { success: true, requests: [], pendingReview: [] };
    }

    if (rows.length === 0) {
      console.log('getMyTravelRequests: No data rows found');
      return { success: true, requests: [], pendingReview: [] };
    }

    // Find requests where submitter email matches
    const userRequests = [];
    // Also track requests pending this user's review
    const pendingReview = [];
    // Track requests in DD-confirmation status (used below to find DD-pending travelers)
    const ddPendingRequestsById = {};

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const submitterEmail = row[headerIndex['Submitter_Email']] || '';
      const currentReviewerEmail = row[headerIndex['Current_Reviewer_Email']] || '';
      const status = row[headerIndex['Status']] || '';

      // Per-row log removed — 100+ Stackdriver writes per call added 200-400ms
      // of latency on every portal load. Restore behind a debug flag if needed.

      // Build request summary object - ensure all values are JSON-serializable
      // Convert dates to strings safely
      let submittedAtStr = '';
      let updatedAtStr = '';
      try {
        const submittedRaw = row[headerIndex['Submitted_At']];
        if (submittedRaw) {
          submittedAtStr = submittedRaw instanceof Date
            ? submittedRaw.toISOString()
            : String(submittedRaw);
        }
      } catch (e) {
        console.log('Error converting submittedAt:', e.message);
      }
      try {
        const updatedRaw = row[headerIndex['Updated_At']];
        if (updatedRaw) {
          updatedAtStr = updatedRaw instanceof Date
            ? updatedRaw.toISOString()
            : String(updatedRaw);
        }
      } catch (e) {
        console.log('Error converting updatedAt:', e.message);
      }

      // Convert event dates to strings
      const eventStartStr = formatDateForStorage(row[headerIndex['Event_Start_Date']]);
      const eventEndStr = formatDateForStorage(row[headerIndex['Event_End_Date']]);

      const request = {
        requestId: String(row[headerIndex['Request_ID']] || ''),
        status: String(status),
        eventName: String(row[headerIndex['Trip_Name']] || ''),
        locationType: String(row[headerIndex['Location_Type']] || ''),
        eventStartDate: eventStartStr,
        eventEndDate: eventEndStr,
        grandTotal: parseFloat(row[headerIndex['Grand_Total']]) || 0,
        travelerCount: parseInt(row[headerIndex['Traveler_Count']]) || 0,
        submitterName: String(row[headerIndex['Submitter_Name']] || ''),
        submitterEmail: String(submitterEmail),
        submittedAt: submittedAtStr,
        updatedAt: updatedAtStr
      };

      // User's own requests
      if (submitterEmail.toLowerCase() === userEmail.toLowerCase()) {
        userRequests.push(request);
      }

      // Requests pending this user's review
      if (currentReviewerEmail.toLowerCase() === userEmail.toLowerCase() &&
          (status === STATUS_CODES.PENDING_SECTOR || status === STATUS_CODES.PENDING_BU || status === STATUS_CODES.PENDING_OSO || status === STATUS_CODES.PENDING_FAS)) {
        pendingReview.push(request);
      }

      // Stash requests that may have pending DD confirmations for the
      // second pass below. Both APPROVED_GOGOV (normal post-OSO/FAS flow,
      // DD emails go out, DDs confirm via portal or email link) and
      // Pending_DD_Confirmation (re-confirmation after a funding
      // correction) qualify. The inner traveler-row scan further filters
      // to {DD_Email matches user, DD_Confirmed = false} so requests
      // with nothing left to confirm are not surfaced.
      if (status === STATUS_CODES.APPROVED_GOGOV || status === STATUS_CODES.PENDING_DD_CONFIRMATION) {
        ddPendingRequestsById[request.requestId] = request;
      }
    }

    // Find any unconfirmed traveler rows where this user is the DD.
    // Walking Request_Travelers once is cheap (cached via TravelDB).
    const pendingDDConfirmations = [];
    if (Object.keys(ddPendingRequestsById).length > 0) {
      try {
        const tData = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
        if (tData.rows.length > 0) {
          const tIdx = tData.headerIndex;
          const userEmailLower = userEmail.toLowerCase();
          const matchedByRequestId = {};

          for (let i = 0; i < tData.rows.length; i++) {
            const tRow = tData.rows[i];
            const ddEmail = String(tRow[tIdx['DD_Email']] || '').toLowerCase();
            if (ddEmail !== userEmailLower) continue;

            const reqId = tRow[tIdx['Request_ID']];
            if (!ddPendingRequestsById[reqId]) continue;

            const ddConfirmedRaw = tRow[tIdx['DD_Confirmed']];
            const isConfirmed = ddConfirmedRaw === true || String(ddConfirmedRaw).toLowerCase() === 'true';
            if (isConfirmed) continue;

            if (!matchedByRequestId[reqId]) {
              matchedByRequestId[reqId] = {
                request: ddPendingRequestsById[reqId],
                travelerNames: [],
                travelerSubtotal: 0
              };
            }
            matchedByRequestId[reqId].travelerNames.push(String(tRow[tIdx['Employee_Name']] || ''));
            matchedByRequestId[reqId].travelerSubtotal += parseFloat(tRow[tIdx['Subtotal']]) || 0;
          }

          // Build flat list — one entry per request, with traveler-aware fields
          Object.keys(matchedByRequestId).forEach(function(rid) {
            const m = matchedByRequestId[rid];
            pendingDDConfirmations.push(Object.assign({}, m.request, {
              ddTravelerNames: m.travelerNames,
              ddTravelerCount: m.travelerNames.length,
              ddTravelerSubtotal: roundMoney(m.travelerSubtotal)
            }));
          });

          // Sort by event start ascending (soonest first — most urgent)
          pendingDDConfirmations.sort(function(a, b) {
            const aDate = a.eventStartDate ? new Date(a.eventStartDate).getTime() : 0;
            const bDate = b.eventStartDate ? new Date(b.eventStartDate).getTime() : 0;
            return aDate - bDate;
          });
        }
      } catch (e) {
        console.warn('getMyTravelRequests: DD-confirmation scan error:', e.message);
      }
    }

    // Sort by submitted date descending (most recent first)
    userRequests.sort((a, b) => {
      const dateA = new Date(a.submittedAt || 0);
      const dateB = new Date(b.submittedAt || 0);
      return dateB - dateA;
    });

    // Sort pending reviews by submitted date ascending (oldest first - needs attention)
    pendingReview.sort((a, b) => {
      const dateA = new Date(a.submittedAt || 0);
      const dateB = new Date(b.submittedAt || 0);
      return dateA - dateB;
    });

    console.log(`Found ${userRequests.length} requests for ${userEmail}, ${pendingReview.length} pending review, ${pendingDDConfirmations.length} pending DD confirmation`);

    console.timeEnd('getMyTravelRequests');
    return {
      success: true,
      requests: userRequests,
      pendingReview: pendingReview,
      pendingDDConfirmations: pendingDDConfirmations
    };

  } catch (error) {
    console.error('Error getting user travel requests:', error);
    logError('getMyTravelRequests', error, {});
    console.timeEnd('getMyTravelRequests');
    return {
      success: false,
      error: error.message || 'Failed to load requests'
    };
  }
}
