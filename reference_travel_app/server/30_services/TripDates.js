/**
 * TripDates.js
 *
 * SINGLE SOURCE OF TRUTH for a request's TRAVEL window.
 *
 * "Travel Dates" = earliest leg Start_Date -> latest leg End_Date, derived from
 * Request_Legs. This is NOT the event date range (Event_Start/End describes the
 * event, not when people travel). Consumed by:
 *   - Email.js          (notification "Travel Dates" lines + summary cards)
 *   - Admin_Dashboard.js (request summary travelStartDate/travelEndDate)
 * so "Travel Dates" means the same thing everywhere.
 *
 * Depends on TravelDB (20_data), DateTime (10_lib), SHEET_NAMES (01_constants).
 */

/**
 * Load Request_Legs rows for one request as [{startDate, endDate}, ...].
 * TravelDB-cached read; returns [] on any miss or error.
 *
 * @param {string} requestId
 * @returns {Array<{startDate:*, endDate:*}>}
 */
function _loadLegsForRequest(requestId) {
  if (!requestId) return [];
  try {
    const data = new TravelDB().readSheet(SHEET_NAMES.REQUEST_LEGS);
    const idIdx = data.headerIndex['Request_ID'];
    const sIdx = data.headerIndex['Start_Date'];
    const eIdx = data.headerIndex['End_Date'];
    if (idIdx === undefined || sIdx === undefined || eIdx === undefined) return [];
    const out = [];
    for (let i = 0; i < data.rows.length; i++) {
      if (String(data.rows[i][idIdx]) !== String(requestId)) continue;
      out.push({ startDate: data.rows[i][sIdx], endDate: data.rows[i][eIdx] });
    }
    return out;
  } catch (e) {
    console.warn('_loadLegsForRequest: ' + requestId + ': ' + e.message);
    return [];
  }
}

/**
 * Raw travel window for a request: { start: Date|null, end: Date|null }.
 * Earliest leg Start_Date -> latest leg End_Date. Returns nulls when no legs
 * (caller decides the fallback). Accepts:
 *   - a request/formData object (uses .legs if present, else loads by
 *     .requestId), OR
 *   - a bare requestId string.
 *
 * @param {Object|string} data
 * @returns {{start: (Date|null), end: (Date|null)}}
 */
function _getTripTravelWindow(data) {
  if (typeof data === 'string') data = { requestId: data };
  data = data || {};
  const legs = (data.legs && data.legs.length) ? data.legs : _loadLegsForRequest(data.requestId);
  let minStart = null, maxEnd = null;
  for (let i = 0; i < legs.length; i++) {
    const s = parseDateAny(legs[i] && legs[i].startDate);
    const e = parseDateAny(legs[i] && legs[i].endDate);
    if (s && (minStart === null || s.getTime() < minStart.getTime())) minStart = s;
    if (e && (maxEnd === null || e.getTime() > maxEnd.getTime())) maxEnd = e;
  }
  return { start: minStart, end: maxEnd };
}

/**
 * Formatted "Travel Dates" range for display ("Jan 28 - Feb 3, 2026").
 * Derives the window from legs; falls back to the object's event dates for
 * legacy records with no legs, so nothing regresses to 'TBD'.
 *
 * @param {Object|string} data - request/formData (or requestId)
 * @returns {string}
 */
function _getTripTravelDates(data) {
  const w = _getTripTravelWindow(data);
  if (w.start && w.end) return formatDateRange(w.start, w.end);
  const obj = (typeof data === 'object' && data) ? data : {};
  return formatDateRange(obj.eventStartDate, obj.eventEndDate);
}
