/**
 * DateTime.js
 * Canonical date/time helpers. Consumes EASTERN_TIMEZONE from 01_constants/Time.js.
 *
 * The 7-function canonical API (revised in Chunk 9 from the original 6, after
 * data probe confirmed two distinct semantic categories in the live data):
 *
 *   parseDateAny(input)                — Date|null. Read-boundary normalizer.
 *                                        Handles Date objects, ISO strings,
 *                                        yyyy-MM-dd, M/D/YYYY, "Mon DD, YYYY".
 *   formatDateForStorage(input)        — "yyyy-MM-dd". Date-only OUTPUT format
 *                                        (CSV exports, filenames). NOT the
 *                                        canonical storage format — sheets use
 *                                        native Date objects.
 *   formatDateForDisplay(input)        — "Jan 28, 2026". For CALENDAR DATES
 *                                        (event dates, lodging dates). Formats
 *                                        in UTC — defensive against the
 *                                        midnight-Pacific anchor convention
 *                                        in the spreadsheet (see Q19).
 *   formatTimestampForDisplay(input)   — "Jan 28, 2026 at 9:58 AM ET". For
 *                                        TIMESTAMPS (Submitted_At, log
 *                                        entries). Formats in Eastern.
 *   formatDateRange(start, end)        — "Jan 28 – Feb 2, 2026". Calendar-
 *                                        date pair display. Collapses same
 *                                        year and same month where possible.
 *   getEasternTimestamp()              — "yyyy-MM-dd HH:mm:ss" of now in ET.
 *   businessDaysBetween(start, end)    — Fractional business days, Mon–Fri.
 *
 * Adoption rule (Phase 3 §3.7, refined): no Utilities.formatDate, no
 * toLocaleDateString, and no .toISOString() for date-OR-timestamp DISPLAY
 * outside DateTime.js. .toISOString() for JSON envelope serialization
 * (generatedAt, periodWindow, etc.) is still fine — that's transport, not
 * display.
 */

/**
 * Get current timestamp in Eastern timezone, formatted "yyyy-MM-dd HH:mm:ss".
 * @returns {string}
 * @server
 */
function getEasternTimestamp() {
  return Utilities.formatDate(new Date(), EASTERN_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Business-day duration between two timestamps. Counts only Mon–Fri portions;
 * weekends contribute zero. Returns fractional days (e.g., 1.5 = 1.5 business
 * days). Used for "Time per Stage" and per-reviewer "Avg time" so reviewers
 * aren't penalized for weekends. Federal holidays are NOT excluded — weekend
 * exclusion alone catches ~104 of the ~115 non-working days/year.
 *
 * Examples (Eastern, ignoring federal holidays):
 *   Friday 4pm → Monday 9am  ≈ 0.04 days  (1h Fri + 1h Mon)
 *   Tuesday 9am → Thursday 9am = 2.0 days (no weekend in span)
 *   Friday 9am → Monday 9am  ≈ 0.33 days  (8h Fri only)
 *
 * @param {Date|string} start
 * @param {Date|string} end
 * @returns {number} Fractional business days, or 0 if invalid/inverted
 * @server
 */
function businessDaysBetween(start, end) {
  var startMs = (start instanceof Date) ? start.getTime() : new Date(start).getTime();
  var endMs = (end instanceof Date) ? end.getTime() : new Date(end).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return 0;

  var DAY_MS = 86400000;
  var totalMs = 0;
  var cursor = new Date(startMs);

  while (cursor.getTime() < endMs) {
    var dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      // Weekday — count contribution from cursor to end-of-day or end,
      // whichever is sooner.
      var endOfDay = new Date(cursor);
      endOfDay.setHours(23, 59, 59, 999);
      var sliceEnd = Math.min(endMs, endOfDay.getTime() + 1);
      totalMs += sliceEnd - cursor.getTime();
    }
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() + 1);
  }

  return totalMs / DAY_MS;
}

/**
 * Read-boundary normalizer. Accepts whatever a sheet read / cache hit / form
 * payload might produce, returns a valid Date or null. Use this anywhere you
 * need to coerce an unknown date-ish value before working with it.
 *
 * @param {Date|string|number} input
 * @returns {Date|null}
 * @server
 */
function parseDateAny(input) {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    var d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === 'string') {
    var parsed = new Date(input);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Convert any date value to "yyyy-MM-dd". Used for CSV exports, filename
 * timestamps, date-only output where a string is needed. NOT the canonical
 * storage format — the spreadsheet stores native Date objects.
 *
 * @param {Date|string} input
 * @returns {string} "yyyy-MM-dd" or empty string if invalid
 * @server
 */
function formatDateForStorage(input) {
  if (!input) return '';
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  var d = parseDateAny(input);
  if (!d) return '';
  return Utilities.formatDate(d, EASTERN_TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Display a CALENDAR DATE (event date, lodging date, perdiem season). Output:
 * "Jan 28, 2026". Formats in UTC because the live data anchors calendar dates
 * at midnight Pacific = morning UTC (see OPEN_QUESTIONS Q19) — UTC formatting
 * is the defensive choice that gives the right calendar day regardless of
 * which TZ the original write anchored to.
 *
 * For instant-in-time values (Submitted_At, Approval_Log/Timestamp, etc.) use
 * formatTimestampForDisplay instead.
 *
 * @param {Date|string} input
 * @returns {string} "Jan 28, 2026" or empty string if invalid
 * @server
 */
function formatDateForDisplay(input) {
  var d = parseDateAny(input);
  if (!d) return '';
  return Utilities.formatDate(d, 'UTC', 'MMM d, yyyy');
}

/**
 * Display a TIMESTAMP (instant in time — Submitted_At, log entries, etc.).
 * Output: "Jan 28, 2026 at 9:58 AM ET". Formats in Eastern (script TZ).
 *
 * @param {Date|string} input
 * @returns {string} formatted timestamp or empty string if invalid
 * @server
 */
function formatTimestampForDisplay(input) {
  var d = parseDateAny(input);
  if (!d) return '';
  return Utilities.formatDate(d, EASTERN_TIMEZONE, 'MMM d, yyyy \'at\' h:mm a') + ' ET';
}

/**
 * Display a calendar-date range. Collapses common parts where possible:
 *   - Same date:        "Jan 28, 2026"
 *   - Same month/year:  "Jan 28 – 30, 2026"
 *   - Same year:        "Jan 28 – Feb 2, 2026"
 *   - Different years:  "Dec 30, 2025 – Jan 2, 2026"
 *
 * Either bound missing returns the present bound, or "TBD" if both missing.
 *
 * @param {Date|string} start
 * @param {Date|string} end
 * @returns {string}
 * @server
 */
function formatDateRange(start, end) {
  var s = parseDateAny(start);
  var e = parseDateAny(end);
  if (!s && !e) return 'TBD';
  if (!s) return formatDateForDisplay(e);
  if (!e) return formatDateForDisplay(s);

  var sy = Utilities.formatDate(s, 'UTC', 'yyyy');
  var ey = Utilities.formatDate(e, 'UTC', 'yyyy');
  var sm = Utilities.formatDate(s, 'UTC', 'MMM');
  var em = Utilities.formatDate(e, 'UTC', 'MMM');
  var sd = Utilities.formatDate(s, 'UTC', 'd');
  var ed = Utilities.formatDate(e, 'UTC', 'd');

  if (sy === ey && sm === em && sd === ed) return formatDateForDisplay(s);
  if (sy === ey && sm === em) return sm + ' ' + sd + ' – ' + ed + ', ' + sy;
  if (sy === ey) return sm + ' ' + sd + ' – ' + em + ' ' + ed + ', ' + sy;
  return formatDateForDisplay(s) + ' – ' + formatDateForDisplay(e);
}
