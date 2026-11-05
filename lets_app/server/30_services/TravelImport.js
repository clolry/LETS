/**
 * TravelImport.js
 * Importing travel that already exists outside LETS, repeatably.
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * @clolry: "Import FY27 travel already requested, approved, or completed,
 * using Chiquita's travel spreadsheet as the initial source (not go.gov).
 * Needs an import preview, validation, error log, duplicate prevention via
 * source IDs, rollback or correction, and repeatable incremental runs during
 * the transition."
 *
 * HOW THIS DIFFERS FROM THE TWO THINGS THAT ALREADY EXISTED
 * ---------------------------------------------------------
 * Both were inspected before any of this was written, and both are reused
 * rather than replaced:
 *
 *   BudgetBackfill.js  Admin-only MANUAL entry of existing travel. Validates,
 *                      warns on duplicates, writes marked Requests rows,
 *                      derives status from dates, sends nothing. It has no
 *                      source ID, no batch, no rollback and no file input —
 *                      so it cannot be re-run. Its validation rules and its
 *                      "every row is marked" discipline are reused here.
 *
 *   GogovSync.js       The parser and the 4-tier expense matcher, with the
 *                      traveller-verification rule that stops a cited ID
 *                      moving money between people. Fully tested and
 *                      COMPLETELY UNWIRED — zero callers before this module.
 *                      Reused, not duplicated: matchExpense, normalizeName,
 *                      toDateString and fiscalYearOf are all called from here.
 *
 * MEASURED AGAINST THE REAL WORKBOOK BEFORE DESIGN
 * ------------------------------------------------
 * `_Expense Report Calculations File for LETS.xlsx`, 8 tabs. Seven findings
 * shaped this module, and each is the reason for something that would
 * otherwise look like over-engineering.
 *
 * 1. THE SCOPE IS 2.7% OF THE FILE. @clolry chose FY27 + ASD only. That is 28
 *    requests of 1,024 and 11 expense reports of 274. An importer that
 *    silently discards 97% of its input is indistinguishable from a broken
 *    one, so every excluded row is RECORDED with its reason and counted in
 *    the preview.
 *
 * 2. SEVEN REQUEST IDs ARE STORED AS NUMBERS. '4946' reads back as '4946.0'.
 *    A string compare on upsert misses all seven and re-imports them as new
 *    rows on EVERY run — the exact duplicate-prevention failure this feature
 *    exists to avoid. normalizeSourceId handles it.
 *
 * 3. THE EXPENSE TAB HAS NO ID, AND THE OBVIOUS KEY COLLIDES. (employee,
 *    report name, end date) collides on 2 of 274 rows: Stacy Buechele filed
 *    two 'Trip from WIL to WAS' reports ending the same day, $198.60 and
 *    $1,602.06, both real. Amount and submit date are therefore part of the
 *    key; without them the import silently loses $198.60.
 *
 * 4. A NAIVE FISCAL-YEAR FILTER ATTACHES MONEY TO THE WRONG TRIP. Udaya
 *    Patnaik's report ends 2026-10-02 (FY2027) but its request 4GNF starts
 *    2026-09-30 (FY2026). Filtering requests to FY2027 removes 4GNF, leaving
 *    4NFL — a different trip three weeks later — as the only title match.
 *    $1,176.10 would land on the wrong request. So the MATCH POOL IS NEVER
 *    FISCAL-YEAR FILTERED; only what gets imported is. See candidatePool.
 *
 * 5. THE SOURCE WORKBOOK'S VARIANCE COLUMN USES THE WRONG MONEY COLUMN.
 *    Tested against all 20 of its matched rows: it computes variance from
 *    Report Total, not Amount Approved. Its stated total is -$326.93; the
 *    true figure is -$1,491.32. The $1,164.39 gap is precisely the disallowed
 *    amount — money GSA did not pay, counted as though it had. @clolry
 *    already ruled on this ("we need to use Amount Approved rather than
 *    Report Total"), so LETS will not agree with her sheet, and every batch
 *    records Variance_Basis to say so.
 *
 * 6. ORG ATTRIBUTION CANNOT COME FROM THE EXPORT. Org Level 3 is 'F' on all
 *    274 rows; levels 4 and 5 are empty on all 274. The workbook's own
 *    OfficeSymbol tab (823 rows) plus OffSymbolOverride (2 rows) is the only
 *    usable source — and the overrides are load-bearing: they are the sole
 *    reason Cheryl Cameron's rows resolve at all.
 *
 * 7. SIX EXPENSE ROWS ARE NOT TRAVEL. 'Professional Liability Insurance',
 *    $179.50 each, one of them inside the FY27 ASD scope. They have a report
 *    and no trip, so a naive importer invents a phantom zero-date trip for
 *    each. Classified OUT_OF_SCOPE_NON_TRAVEL and counted, not dropped.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It does not read the workbook itself. The client parses the file and posts
 * rows, exactly as the mapping UI @clolry chose for the Go.gov importer does.
 * This module is pure functions over data passed in, plus two write paths —
 * which is also what makes the whole thing testable without a spreadsheet.
 */

var TravelImport = (function () {

  // ==========================================================================
  // SMALL HELPERS
  // ==========================================================================

  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
  function _str_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

  /** The Go.gov service, when loaded. Kept optional so unit tests can run it alone. */
  function _gogov_() {
    return (typeof GogovSync !== 'undefined') ? GogovSync : null;
  }

  /**
   * A cell value to YYYY-MM-DD.
   *
   * WHY THIS DOES NOT SIMPLY DELEGATE TO GogovSync.toDateString
   * -----------------------------------------------------------
   * It delegates for the cases GogovSync was measured against — a real
   * number, a Date, and ISO text — but it must handle one more first, and
   * that case is a measured defect rather than a hypothetical.
   *
   * GogovSync was built against .xls exports whose dates arrived as NUMBERS.
   * This importer's source is a spreadsheet the client parses, and a parser
   * can hand over the serial as a STRING: '46356', or '46356.0' once it has
   * been through a float round-trip. Found while running this module over the
   * real workbook — every date came through as a string.
   *
   * Passed to GogovSync, '46356' matches neither the number branch nor the
   * ISO branch, so it falls through to `new Date('46356')` — which parses as
   * THE YEAR 46356 and returns '46356-01-01'.
   *
   * That is far worse than returning ''. It is a valid-looking date that
   * passes validation, yields fiscal year 'FY4635', and is then silently
   * dropped as out-of-scope. A whole trip disappears from the import and
   * nothing anywhere says so.
   *
   * So numeric strings are resolved HERE, with the same serial bounds
   * GogovSync uses, before anything else sees them. GogovSync itself is left
   * alone deliberately: its behaviour is pinned by test_gogov_sync.js §3 and
   * it is shared with the monthly reconciliation path, so widening it is a
   * change with blast radius beyond this feature. Filed as follow-up.
   *
   * @param {*} v
   * @returns {string} '' when unparseable
   */
  function toDateString(v) {
    // A numeric string that is really an Excel serial. The bounds match
    // GogovSync's: 25569 is 1970-01-01, and anything outside 20000..80000 is
    // likelier a typo than a date in 1954 or 2119.
    if (typeof v === 'string') {
      var t = v.trim();
      if (/^\d+(\.\d+)?$/.test(t)) {
        var n = parseFloat(t);
        if (n >= 20000 && n <= 80000) {
          return _fmtUtc_(new Date(Math.round((n - 25569) * 86400000)));
        }
        // A bare number outside the serial window is not a date. Returning ''
        // rather than guessing is the whole point — see the header comment.
        return '';
      }
    }

    var g = _gogov_();
    if (g && g.toDateString) return g.toDateString(v);

    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) {
      return isNaN(v.getTime()) ? '' : _fmtUtc_(v);
    }
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return '';
      return _fmtUtc_(new Date(Math.round((v - 25569) * 86400000)));
    }
    var s = _str_(v);
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var d = new Date(s);
    return isNaN(d.getTime()) ? '' : _fmtUtc_(d);
  }

  function _fmtUtc_(d) {
    var m = d.getUTCMonth() + 1;
    var day = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' +
           (day < 10 ? '0' + day : day);
  }

  /** Fiscal year for YYYY-MM-DD. October through September. */
  function fiscalYearOf(dateStr) {
    var s = _str_(dateStr);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    var y = parseInt(s.slice(0, 4), 10);
    var mo = parseInt(s.slice(5, 7), 10);
    if (mo < 1 || mo > 12) return '';
    return 'FY' + (mo >= 10 ? y + 1 : y);
  }

  function currentFiscalYear(now) {
    var d = now || new Date();
    return 'FY' + (d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear());
  }

  /** 'FIRST LAST', uppercased. Delegates to GogovSync when present. */
  function normalizeName(name) {
    var g = _gogov_();
    if (g && g.normalizeName) return g.normalizeName(name);

    var n = _str_(name);
    if (!n) return '';
    if (n.indexOf(',') > -1) {
      var parts = n.split(',');
      var last = _str_(parts[0]);
      var firstBits = _str_(parts[1]).split(/\s+/);
      return ((firstBits[0] || '') + ' ' + last).toUpperCase().replace(/\s+/g, ' ').trim();
    }
    var bits = n.split(/\s+/);
    if (bits.length < 2) return n.toUpperCase();
    return (bits[0] + ' ' + bits[bits.length - 1]).toUpperCase();
  }

  // ==========================================================================
  // THE SOURCE IDENTIFIER
  // ==========================================================================

  /**
   * Normalizes a source record ID for comparison.
   *
   * THIS IS THE DUPLICATE-PREVENTION KEYSTONE, and it exists because of a
   * measured defect rather than a theoretical one.
   *
   * Seven of the 1,024 Go.gov Request IDs in the workbook are all digits —
   * '4946', '4349', '4799', '4734', '4463', '4434', '4394'. The spreadsheet
   * stores those as NUMBERS, so reading the cell yields the number 4946, and
   * String() of it can be '4946' or (via a float round-trip) '4946.0'.
   *
   * A raw string compare against the stored '4946' then fails, the upsert
   * concludes the record is new, and those seven rows are re-imported on
   * EVERY run. @clolry asked for "duplicate prevention via source IDs"; this
   * is the one place that promise can quietly break.
   *
   * Uppercased because the alphanumeric codes are case-insensitive in
   * practice ('4qtc' and '4QTC' are the same request).
   *
   * @param {*} v
   * @returns {string}
   */
  function normalizeSourceId(v) {
    if (v === null || v === undefined) return '';

    // A true number: render as an integer when it is one, so 4946 does not
    // become '4946.0'. Non-integers keep their fraction rather than being
    // silently truncated — a fractional ID is corrupt input and must stay
    // visibly odd rather than be rounded into a plausible-looking value.
    if (typeof v === 'number') {
      if (!isFinite(v)) return '';
      return (Math.floor(v) === v) ? String(Math.floor(v)) : String(v);
    }

    var s = _str_(v).toUpperCase();
    if (!s) return '';

    // '4946.0' — a number that has already been through String(). Only
    // stripped when the whole token is numeric with a zero fraction; an ID
    // like 'A1.0B' is left alone because it is not this case.
    var floaty = /^(\d+)\.0+$/.exec(s);
    if (floaty) return floaty[1];

    return s;
  }

  /**
   * The composite key for a record with no source ID of its own.
   *
   * The expense tab has NO identifier — searched all 274 rows for all 1,024
   * request codes and found zero. So the key is built from the fields.
   *
   * WHY AMOUNT AND SUBMIT DATE ARE IN THE KEY. The obvious key —
   * (employee, report name, report end date) — COLLIDES on 2 of 274 rows:
   *
   *   BUECHELE, STACY E. | Trip from WIL to WAS | 2026-10-28 |   $198.60
   *   BUECHELE, STACY E. | Trip from WIL to WAS | 2026-10-28 | $1,602.06
   *   Santini, James D.  | Trip Reservation     | 2026-11-04 | $1,200.33
   *   Santini, James D.  | Trip Reservation     | 2026-11-04 |   $351.50
   *
   * All four are real, separately-filed reports. A key that merged each pair
   * would drop $198.60 and $351.50 and the totals would still look plausible,
   * which is the worst available outcome. Adding the amount separates all
   * four; adding submit date (which differs too) is belt and braces for the
   * case where two reports genuinely match on everything else.
   *
   * @param {Object} rec a parsed record
   * @returns {string}
   */
  function compositeKey(rec) {
    return [
      normalizeName(rec.employeeName),
      _str_(rec.tripName).toLowerCase().replace(/\s+/g, ' '),
      _str_(rec.reportEndDate) || _str_(rec.startDate),
      round2(rec.approvedAmount || rec.estimateAmount || 0).toFixed(2),
      _str_(rec.submitDate)
    ].join('|');
  }

  /**
   * A stable digest of a record's mapped values.
   *
   * How a re-run tells CHANGED from UNCHANGED. @clolry asked for "repeatable
   * incremental runs": without this, every re-import either rewrites every
   * row (losing the ability to see what actually moved) or compares twenty
   * columns by hand at every call site.
   *
   * NOT A CRYPTOGRAPHIC HASH, and not used as one. Apps Script has
   * Utilities.computeDigest, but this must also run in the test harness and
   * in the browser preview, so it is a plain deterministic string digest. Its
   * only job is to differ when the content differs.
   *
   * @param {Object} rec
   * @returns {string}
   */
  function rowHash(rec) {
    var parts = [
      _str_(rec.sourceRecordId), _str_(rec.recordKind),
      normalizeName(rec.employeeName), _str_(rec.tripName), _str_(rec.purpose),
      _str_(rec.startDate), _str_(rec.endDate), _str_(rec.reportEndDate),
      _str_(rec.submitDate),
      round2(rec.estimateAmount).toFixed(2),
      round2(rec.claimedAmount).toFixed(2),
      round2(rec.approvedAmount).toFixed(2),
      _str_(rec.sourceOfficeSymbol)
    ].join('\u0001');

    // FNV-1a, 32-bit, rendered hex. Short, stable across runtimes, and with
    // no dependency on a GAS-only utility.
    var h = 0x811c9dc5;
    for (var i = 0; i < parts.length; i++) {
      h ^= parts.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  // ==========================================================================
  // ORG RESOLUTION
  // ==========================================================================

  var ORG_TO_OFFICE = { FC: 'FO', FCA: 'OMD', FCB: 'IDV', FCC: 'CM' };
  var OFFICE_TO_ORG = { FO: 'FC', OMD: 'FCA', IDV: 'FCB', CM: 'FCC' };
  var KNOWN_OFFICES = ['FO', 'OMD', 'IDV', 'CM'];

  /**
   * HR office symbol -> LETS budget office, by LONGEST prefix.
   *
   * Longest-prefix and not first-match: 'FCBAEBE' starts with both 'FC' and
   * 'FCB', and the answer is IDV, not FO. Getting this backwards would charge
   * every IDV, OMD and CM trip to the Front Office.
   *
   * Verified against all 28 FY27 ASD symbols in the workbook: FO 2, OMD 5,
   * IDV 17, CM 4, none unresolved.
   *
   * @param {string} symbol e.g. 'FCBAEBE'
   * @returns {string} 'IDV', or '' when nothing matches
   */
  function officeForOrgCode(symbol) {
    var code = _str_(symbol).toUpperCase();
    if (!code) return '';
    var best = '';
    var bestLen = 0;
    Object.keys(ORG_TO_OFFICE).forEach(function (k) {
      if (code.indexOf(k) !== 0) return;
      if (k.length <= bestLen) return;
      best = ORG_TO_OFFICE[k];
      bestLen = k.length;
    });
    return best;
  }

  /** The 2-4 char HR org root for a budget office. */
  function orgRootForOffice(office) {
    return OFFICE_TO_ORG[_str_(office).toUpperCase()] || '';
  }

  /**
   * Builds the name -> office-symbol roster the import resolves against.
   *
   * SOURCED FROM THE WORKBOOK'S OWN LOOKUP TABS, because the export's org
   * columns are unusable: Org Level 3 is 'F' for all 274 expense rows and
   * levels 4-5 are empty on all 274.
   *
   * THE OVERRIDES ARE LOAD-BEARING. OffSymbolOverride has only 2 rows, which
   * invites skipping it. Measured: those 2 rows are the only reason 6 request
   * rows resolve to an org at all — Cheryl Cameron (4 rows) and Jeremy
   * Wustner-Brown. Without them those travellers fall out of ASD scope
   * entirely and their travel silently vanishes from the import.
   *
   * Applied AFTER the base roster so an override wins, which is its purpose.
   *
   * @param {Array<Object>} rosterRows [{fullName, departmentId}]
   * @param {Array<Object>} overrideRows [{name, officeSymbol}]
   * @returns {Object} normalized name -> office symbol
   */
  function buildOrgRoster(rosterRows, overrideRows) {
    var map = {};
    (rosterRows || []).forEach(function (r) {
      var key = normalizeName(r.fullName || r['Full Name']);
      var dept = _str_(r.departmentId || r['Current.Department.ID']);
      if (key && dept) map[key] = dept.toUpperCase();
    });
    (overrideRows || []).forEach(function (r) {
      var key = normalizeName(r.name || r.fullName || r['Name']);
      var dept = _str_(r.officeSymbol || r['Office Symbol']);
      if (key && dept) map[key] = dept.toUpperCase();
    });
    return map;
  }

  // ==========================================================================
  // RECORD KINDS
  // ==========================================================================

  var RECORD_KINDS = {
    REQUEST: 'REQUEST',       // submitted, not yet approved
    COMMITMENT: 'COMMITMENT', // approved, not yet travelled — money promised
    VOUCHER: 'VOUCHER',       // an expense report exists, not yet settled
    ACTUAL: 'ACTUAL'          // Amount Approved — what GSA paid
  };

  /**
   * The financial kind of a request-tab row.
   *
   * @clolry asked to "distinguish requests, commitments, vouchers, and actual
   * expenditures", and the distinction is not cosmetic: BudgetDashboard
   * counts commitments against a DAC's available balance and actuals as
   * spend. Putting a row in the wrong bucket either double-counts the money
   * or hides it.
   *
   * DERIVED, NEVER SUPPLIED. Same reasoning as BudgetBackfill.statusFor:
   * letting a caller choose would let one trip land in either bucket.
   *
   * MEASURED: every row in both tabs has Approval Status 'Approved' — 1,024
   * of 1,024 and 274 of 274. So REQUEST is unreachable from this workbook
   * today. It is still implemented, because the next export need not be so
   * uniform and a silently-missing branch is worse than an unused one.
   *
   * @param {Object} rec
   * @returns {string}
   */
  function recordKindForRequest(rec) {
    var status = _str_(rec.status).toUpperCase();
    if (status && status.indexOf('APPROV') === -1) return RECORD_KINDS.REQUEST;
    return RECORD_KINDS.COMMITMENT;
  }

  /**
   * The financial kind of an expense-tab row.
   *
   * ACTUAL when GSA has approved an amount — that is a settled payment.
   * VOUCHER when a report exists but no approved figure does, meaning the
   * claim is filed and not yet settled.
   *
   * The difference matters for the reconciliation guard: an ACTUAL is
   * evidence and is protected from being overwritten; a VOUCHER is still in
   * flight and may legitimately change on a later run.
   */
  function recordKindForExpense(rec) {
    var approved = Number(rec.approvedAmount);
    if (!isNaN(approved) && approved > 0) return RECORD_KINDS.ACTUAL;
    return RECORD_KINDS.VOUCHER;
  }

  /**
   * The LETS request status implied by a record kind and its dates.
   *
   * Reuses BudgetBackfill's rule so a row imported from a file and one typed
   * into the backfill form end up identically shaped. Two code paths writing
   * different statuses for the same travel would make the budget figures
   * depend on how the data arrived.
   */
  function statusForRecord(rec, now) {
    var SC = (typeof STATUS_CODES !== 'undefined') ? STATUS_CODES : {
      APPROVED_GOGOV: 'APPROVED_GOGOV', COMPLETED: 'COMPLETED',
      PENDING_SECTOR: 'PENDING_SECTOR'
    };
    if (rec.recordKind === RECORD_KINDS.REQUEST) return SC.PENDING_SECTOR;

    var end = _str_(rec.endDate) || _str_(rec.reportEndDate);
    var today = toDateString(now || new Date());
    if (!end) return SC.APPROVED_GOGOV;
    return end < today ? SC.COMPLETED : SC.APPROVED_GOGOV;
  }

  // ==========================================================================
  // COLUMN MAPPING — CONFIGURABLE, NOT HARDCODED
  // ==========================================================================
  //
  // @clolry asked for "configurable column mappings". The header names below
  // are DEFAULTS that get PROPOSED to the admin, who confirms or corrects
  // them. A renamed column then costs a remap, not a deployment.
  //
  // Measured from the real workbook, so the defaults match on the first run.

  /** 'TravelRequest' tab. Header -> field. */
  var REQUEST_FIELD_HINTS = {
    sourceRecordId:   ['Request ID', 'Request Id', 'RequestID'],
    tripName:         ['Name', 'Request Name', 'Trip Name'],
    employeeName:     ['Employee Name', 'Traveler', 'Traveler Name', 'Full Name'],
    estimateAmount:   ['Total Approved Amount', 'Approved Amount', 'Total'],
    startDate:        ['Start Date', 'Begin Date'],
    endDate:          ['End Date'],
    purpose:          ['Purpose', 'Justification'],
    submitDate:       ['Submit Date', 'Submitted'],
    status:           ['Approval Status', 'Status']
  };

  /** 'Expense' tab. Header -> field. */
  var EXPENSE_FIELD_HINTS = {
    tripName:           ['Report Name'],
    employeeName:       ['Full Name', 'Employee Name', 'Traveler'],
    sourceOfficeSymbol: ['Office Symbol'],
    claimedAmount:      ['Report Total'],
    approvedAmount:     ['Amount Approved', 'Approved Amount'],
    reportEndDate:      ['Report End Date', 'End Date'],
    submitDate:         ['Submit Date'],
    employeeId:         ['Employee ID', 'Employee Id'],
    status:             ['Approval Status', 'Status']
  };

  /**
   * REQUIRED fields per tab. Without these the import cannot attribute money
   * to a person, a trip or a fiscal year, which is its entire purpose.
   *
   * `purpose` is NOT required: measured blank on 561 of 1,024 request rows.
   * Requiring it would reject more than half the file.
   *
   * `sourceOfficeSymbol` is NOT required on requests — that tab has no org
   * column at all, so the org comes from the roster lookup instead.
   */
  var REQUIRED_FIELDS = {
    request: ['sourceRecordId', 'employeeName', 'estimateAmount', 'startDate', 'endDate'],
    expense: ['employeeName', 'approvedAmount', 'reportEndDate']
  };

  /**
   * Proposes a header -> field mapping for an admin to confirm.
   *
   * PROPOSES, NEVER DECIDES. A silently wrong guess here is expensive in a
   * specific way: mapping 'Report Total' onto approvedAmount would overstate
   * spend on 51 of 274 rows by $6,009.34, and the figure would look
   * completely plausible. The UI shows every guess and requires confirmation.
   *
   * Exact, case-insensitive matching only. Fuzzy matching was considered and
   * rejected: 'Report Total' and 'Total Approved Amount' are both plausible
   * fuzzy hits for a field called 'total', and the cost of being wrong is the
   * $6,009.34 above.
   *
   * @param {Array<string>} headers
   * @param {string} kind 'request' | 'expense'
   * @returns {{mapping: Object, unmapped: Array, missing: Array, kind: string}}
   */
  function proposeMapping(headers, kind) {
    var k = (kind === 'request') ? 'request' : 'expense';
    var hints = (k === 'request') ? REQUEST_FIELD_HINTS : EXPENSE_FIELD_HINTS;
    var hdrs = (headers || []).map(_str_).filter(Boolean);
    var mapping = {};
    var used = {};

    Object.keys(hints).forEach(function (field) {
      for (var i = 0; i < hints[field].length; i++) {
        var want = hints[field][i].toLowerCase();
        for (var h = 0; h < hdrs.length; h++) {
          if (used[hdrs[h]]) continue;
          if (hdrs[h].toLowerCase() === want) {
            mapping[field] = hdrs[h];
            used[hdrs[h]] = true;
            return;
          }
        }
      }
    });

    return {
      kind: k,
      mapping: mapping,
      unmapped: hdrs.filter(function (h) { return !used[h]; }),
      missing: REQUIRED_FIELDS[k].filter(function (f) { return !mapping[f]; })
    };
  }

  // ==========================================================================
  // PARSING
  // ==========================================================================

  /**
   * Source rows + a confirmed mapping -> normalized records.
   *
   * One shape for both tabs, so everything downstream — scope, diff, upsert,
   * rollback — has a single record type to reason about. Fields irrelevant to
   * a tab stay empty rather than absent, because `undefined` propagating into
   * a money column is how a total becomes NaN.
   *
   * @param {Array<Object>} rows header-keyed objects
   * @param {Object} mapping field -> header
   * @param {string} kind 'request' | 'expense'
   * @param {Object} [options] { orgRoster, firstDataRow }
   * @returns {Array<Object>}
   */
  function parseRows(rows, mapping, kind, options) {
    var opts = options || {};
    var m = mapping || {};
    var roster = opts.orgRoster || {};
    // Row numbers are for a human to find the row in the sheet, so they are
    // 1-based and account for the header. Default 2 = first data row.
    var firstRow = opts.firstDataRow || 2;
    var isRequest = (kind === 'request');

    function val(row, field) {
      return m[field] ? row[m[field]] : undefined;
    }

    return (rows || []).map(function (row, i) {
      var employeeName = _str_(val(row, 'employeeName'));
      var normalized = normalizeName(employeeName);

      // THE ORG COMES FROM THE ROSTER FIRST, THE FILE SECOND.
      //
      // The expense tab does have an Office Symbol column, but the request
      // tab has nothing, and the roster covers both. Preferring the roster
      // keeps one attribution rule for both tabs; falling back to the file's
      // column means an expense row for somebody missing from the roster is
      // still attributable rather than silently unscoped.
      var rosterSymbol = roster[normalized] || '';
      var fileSymbol = _str_(val(row, 'sourceOfficeSymbol')).toUpperCase();
      // 'Not ASD Employee' is a LABEL the workbook writes, not an org code.
      // Measured on 246 of 274 expense rows. Treating it as a symbol would
      // produce an office of '' and look like a lookup failure rather than
      // the deliberate exclusion it is.
      if (fileSymbol === 'NOT ASD EMPLOYEE') fileSymbol = '';
      var symbol = rosterSymbol || fileSymbol;

      var rec = {
        sourceRow: firstRow + i,
        sourceSheet: isRequest ? 'TravelRequest' : 'Expense',

        sourceRecordId: isRequest ? normalizeSourceId(val(row, 'sourceRecordId')) : '',
        employeeName: employeeName,
        employeeNameNormalized: normalized,
        employeeId: _str_(val(row, 'employeeId')),
        tripName: _str_(val(row, 'tripName')),
        purpose: _str_(val(row, 'purpose')),
        status: _str_(val(row, 'status')),

        startDate: isRequest ? toDateString(val(row, 'startDate')) : '',
        endDate: isRequest ? toDateString(val(row, 'endDate')) : '',
        reportEndDate: isRequest ? '' : toDateString(val(row, 'reportEndDate')),
        submitDate: toDateString(val(row, 'submitDate')),

        estimateAmount: isRequest ? round2(val(row, 'estimateAmount')) : 0,
        claimedAmount: isRequest ? 0 : round2(val(row, 'claimedAmount')),
        approvedAmount: isRequest ? 0 : round2(val(row, 'approvedAmount')),

        sourceOfficeSymbol: symbol,
        officeSymbolSource: rosterSymbol ? 'roster' : (fileSymbol ? 'file' : ''),
        officeCode: officeForOrgCode(symbol),
        orgCode: orgRootForOffice(officeForOrgCode(symbol)),
        inOrgRoster: !!rosterSymbol
      };

      // Disallowed is derived, never read from the file. The workbook has no
      // such column, and this is the number nobody asks for until a traveller
      // disputes a voucher.
      rec.disallowedAmount = round2(rec.claimedAmount - rec.approvedAmount);

      rec.recordKind = isRequest ? recordKindForRequest(rec) : recordKindForExpense(rec);

      // THE FISCAL YEAR IS PER ROW, AND THE BASIS DIFFERS BY TAB.
      //
      // Requests bucket on START DATE: that is when the money is committed.
      // Expenses bucket on REPORT END DATE: that is when the travel finished
      // and therefore which year's budget it consumed.
      //
      // Measured: the workbook spans two fiscal years on both sides, and one
      // trip straddles — Udaya Patnaik starts 2026-09-30 (FY2026) and his
      // report ends 2026-10-02 (FY2027). Those really are different years for
      // the commitment and the actual, and the import must not pretend
      // otherwise.
      rec.fiscalYearBasis = isRequest ? 'start-date' : 'report-end-date';
      rec.fiscalYear = fiscalYearOf(isRequest ? rec.startDate : rec.reportEndDate);

      // Expense rows have no ID, so the key IS the identity. See compositeKey
      // for the measured collision that shaped it.
      rec.sourceRecordKey = isRequest ? rec.sourceRecordId : compositeKey(rec);
      if (!isRequest) rec.sourceRecordId = 'EXP:' + rowHash(rec);
      rec.sourceRowHash = rowHash(rec);

      return rec;
    });
  }

  // ==========================================================================
  // NON-TRAVEL DETECTION
  // ==========================================================================

  /**
   * Expense reports that are not travel.
   *
   * MEASURED: 6 of 274 rows are 'Professional Liability Insurance' at $179.50
   * each, and one of those is inside @clolry's FY27 ASD scope (Keith
   * Jeffries, report ending 2026-10-06). Chiquita's own workbook lists them
   * under 'No Travel Request', which is the clue.
   *
   * WHY THIS MATTERS. These rows have an expense report and no trip: no
   * dates, no destination, no request. A naive importer creates a phantom
   * zero-date "trip" for each and charges it to a DAC's travel budget. The
   * money is real and belongs in a financial record somewhere, but it is not
   * travel and must not consume a travel allocation.
   *
   * A PATTERN LIST, NOT A GUESS AT INTENT. Only phrases measured in the real
   * file are matched. An unrecognised non-travel charge is better left
   * visible as an odd-looking trip than silently filtered by a clever rule
   * nobody can audit — which is why this returns the matched reason rather
   * than a bare boolean.
   *
   * @param {Object} rec
   * @returns {string} the reason, or '' when it looks like travel
   */
  function nonTravelReason(rec) {
    var name = _str_(rec.tripName).toLowerCase();
    if (!name) return '';

    // Professional liability insurance — 6 rows, all $179.50.
    if (/professional liability|liability insurance/.test(name)) {
      return 'Professional liability insurance, not travel';
    }
    return '';
  }

  // ==========================================================================
  // SCOPE
  // ==========================================================================

  var SCOPE = {
    IN: 'IN_SCOPE',
    OUT_FY: 'OUT_OF_SCOPE_FY',
    OUT_ORG: 'OUT_OF_SCOPE_ORG',
    OUT_NON_TRAVEL: 'OUT_OF_SCOPE_NON_TRAVEL'
  };

  /**
   * Decides whether a record is in @clolry's chosen scope, and says why not.
   *
   * @clolry: "Only FY27 information and only ASD employees."
   *
   * WHY EXCLUSIONS ARE CLASSIFIED RATHER THAN FILTERED AWAY.
   * That scope keeps 28 of 1,024 request rows and 11 of 274 expense rows —
   * it discards 97%. An importer that silently drops 97% of its input cannot
   * be told apart from one that is broken, and the first time a trip is
   * missing the question will be "did the importer lose it?". So every row
   * carries the specific test that excluded it, and the preview reports the
   * counts.
   *
   * ORDER IS DELIBERATE: non-travel first, then org, then fiscal year. A row
   * gets the MOST SPECIFIC reason available. A non-ASD professional-liability
   * charge in FY2024 is reported as non-travel, because that is the fact a
   * reader needs; 'wrong fiscal year' would be true but useless.
   *
   * @param {Object} rec
   * @param {Object} scope { fiscalYear, orgFilter: 'ASD'|'ALL' }
   * @returns {{decision: string, reason: string}}
   */
  function scopeDecision(rec, scope) {
    var s = scope || {};
    var wantFy = _str_(s.fiscalYear);
    var orgFilter = _str_(s.orgFilter).toUpperCase() || 'ASD';

    var nt = nonTravelReason(rec);
    if (nt) {
      return { decision: SCOPE.OUT_NON_TRAVEL, reason: nt };
    }

    if (orgFilter === 'ASD') {
      // ASD membership is decided by the ROSTER, not by the file's own label.
      // The roster is the authority @clolry's workbook itself uses, and it is
      // the only source that covers both tabs.
      if (!rec.inOrgRoster && !rec.officeCode) {
        return {
          decision: SCOPE.OUT_ORG,
          reason: 'Not in the ASD roster' +
                  (rec.employeeName ? ' (' + rec.employeeName + ')' : '') +
                  '. The workbook labels non-ASD expense rows "Not ASD Employee".'
        };
      }
      if (!rec.officeCode) {
        return {
          decision: SCOPE.OUT_ORG,
          reason: 'Office symbol "' + rec.sourceOfficeSymbol + '" does not resolve ' +
                  'to a LETS budget office (' + KNOWN_OFFICES.join(', ') + ').'
        };
      }
    }

    if (wantFy) {
      if (!rec.fiscalYear) {
        return {
          decision: SCOPE.OUT_FY,
          reason: 'No usable ' +
                  (rec.fiscalYearBasis === 'start-date' ? 'start date' : 'report end date') +
                  ', so the fiscal year cannot be determined.'
        };
      }
      if (rec.fiscalYear !== wantFy) {
        return {
          decision: SCOPE.OUT_FY,
          reason: rec.fiscalYear + ' by ' + rec.fiscalYearBasis + ', not ' + wantFy + '.'
        };
      }
    }

    return { decision: SCOPE.IN, reason: '' };
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Checks one in-scope record.
   *
   * Returns ALL problems rather than throwing on the first, so the error log
   * lists everything wrong with a row at once instead of one item per
   * re-upload. Reuses BudgetBackfill's thresholds so a file-imported row and
   * a hand-typed one are held to the same standard.
   *
   * @param {Object} rec
   * @returns {Array<string>}
   */
  function validateRecord(rec) {
    var problems = [];
    var isRequest = rec.sourceSheet === 'TravelRequest';

    if (!_str_(rec.employeeName)) {
      problems.push('Traveller name is missing — the row cannot be attributed to a person.');
    }
    if (!_str_(rec.tripName)) {
      problems.push('Trip or report name is missing — it is how this appears in reports.');
    }

    if (isRequest) {
      if (!_str_(rec.sourceRecordId)) {
        problems.push('Request ID is missing. It is the key that prevents duplicates ' +
                      'on re-import, so a row without one cannot be imported safely.');
      }
      if (!rec.startDate) problems.push('Start date is missing or unparseable.');
      if (!rec.endDate) problems.push('End date is missing or unparseable.');
      if (rec.startDate && rec.endDate && rec.endDate < rec.startDate) {
        problems.push('End date ' + rec.endDate + ' is before the start date ' +
                      rec.startDate + '.');
      }
      // A zero estimate is legitimate — no-cost local travel is real and
      // appears in this data — but it must be a number, not a blank.
      if (isNaN(Number(rec.estimateAmount))) {
        problems.push('Approved amount is not a number.');
      } else if (rec.estimateAmount < 0) {
        problems.push('Approved amount cannot be negative.');
      } else if (rec.estimateAmount > 1000000) {
        problems.push('Approved amount $' + rec.estimateAmount + ' looks like a typo.');
      }
    } else {
      if (!rec.reportEndDate) {
        problems.push('Report end date is missing or unparseable. It determines which ' +
                      'fiscal year the spend lands in.');
      }
      if (isNaN(Number(rec.approvedAmount))) {
        problems.push('Amount Approved is not a number.');
      } else if (rec.approvedAmount < 0) {
        problems.push('Amount Approved cannot be negative.');
      } else if (rec.approvedAmount > 1000000) {
        problems.push('Amount Approved $' + rec.approvedAmount + ' looks like a typo.');
      }
      // Claimed BELOW approved means GSA paid more than was asked for, which
      // is not a thing. Flagged rather than corrected: it means the two money
      // columns are mapped the wrong way round, and silently swapping them
      // would hide a mapping error on every row.
      if (rec.claimedAmount && rec.approvedAmount &&
          rec.approvedAmount - rec.claimedAmount > 0.005) {
        problems.push('Amount Approved ($' + rec.approvedAmount + ') exceeds Report Total ' +
                      '($' + rec.claimedAmount + '). GSA cannot approve more than was ' +
                      'claimed — the two money columns are probably mapped the wrong ' +
                      'way round.');
      }
    }

    if (!rec.officeCode) {
      problems.push('No LETS budget office could be resolved' +
                    (rec.sourceOfficeSymbol ? ' from "' + rec.sourceOfficeSymbol + '"' : '') +
                    '. The cost would not count against any DAC.');
    }

    return problems;
  }

  // ==========================================================================
  // THE CANDIDATE POOL — and why it is NOT fiscal-year filtered
  // ==========================================================================

  /**
   * The requests an expense row may be matched against.
   *
   * THIS FUNCTION EXISTS BECAUSE OF A MEASURED NEAR-MISS, and it is the
   * subtlest thing in this module.
   *
   * The obvious implementation matches expense rows against the requests
   * being imported — the FY27 ASD ones. That attaches money to the wrong
   * trip, and here is the real case:
   *
   *   Udaya Patnaik, report 'Trip from San Francisco to Washington'
   *     report end date   2026-10-02  -> FY2027, so the report IS in scope
   *
   *   His requests with that exact title:
   *     4GNF  est $1,337.74  2026-09-30 .. 2026-10-02   FY2026
   *     4NFL  est $1,449.55  2026-11-01 .. 2026-11-03   FY2027
   *     3QTT  est $1,671.83  2026-07-15 .. 2026-07-18   FY2026
   *
   * Filtering the pool to FY2027 removes 4GNF, leaving 4NFL as the only
   * title match — a DIFFERENT TRIP three weeks later. $1,176.10 of actuals
   * would post against it, 4GNF would sit unreconciled forever, and both
   * figures would look entirely reasonable.
   *
   * Chiquita's own workbook pairs the report with 4GNF, and she is right:
   * the request end date and the report end date agree to the day.
   *
   * SO: WHAT IS IMPORTED IS SCOPED. WHAT IS MATCHED AGAINST IS NOT.
   * A trip that straddles the fiscal-year boundary is a real thing — the
   * commitment falls in one year and the actual in the next — and the
   * reconciliation has to be able to see across the line even when the
   * import does not cross it.
   *
   * @param {Array<Object>} allRequests every parsed request, unscoped
   * @param {Array<Object>} letsRequests existing LETS requests
   * @returns {Array<Object>} candidates in GogovSync.matchExpense's shape
   */
  function candidatePool(allRequests, letsRequests) {
    var out = [];

    (allRequests || []).forEach(function (r) {
      out.push({
        requestId: r.sourceRecordId,
        gogovRequestId: r.sourceRecordId,
        tripName: r.tripName,
        startDate: r.startDate,
        endDate: r.endDate,
        amount: r.estimateAmount,
        employeeName: r.employeeName,
        employeeNameNormalized: r.employeeNameNormalized,
        owningOffice: r.officeCode,
        fiscalYear: r.fiscalYear,
        isSourceRow: true
      });
    });

    // Rows already in LETS count as candidates too, so a second incremental
    // run can match a report against a request the FIRST run imported.
    // Without this, every re-run would re-match from scratch against the file
    // alone and an expense arriving a month after its request would never
    // find it.
    (letsRequests || []).forEach(function (r) {
      out.push({
        requestId: r.requestId,
        gogovRequestId: r.gogovRequestId || '',
        tripName: r.tripName,
        startDate: r.startDate,
        endDate: r.endDate,
        amount: r.estimate,
        employeeName: r.employeeName,
        employeeNameNormalized: normalizeName(r.employeeName),
        owningOffice: r.owningOffice,
        fiscalYear: fiscalYearOf(r.startDate),
        isSourceRow: false
      });
    });

    return out;
  }

  // ==========================================================================
  // THE DIFF — WHAT AN IMPORT WOULD DO
  // ==========================================================================

  var DIFF = {
    NEW: 'NEW',
    UNCHANGED: 'UNCHANGED',
    CHANGED: 'CHANGED',
    CONFLICT: 'CONFLICT',
    SKIPPED_SCOPE: 'SKIPPED_SCOPE',
    ERROR: 'ERROR'
  };

  /**
   * Fields compared between a source row and what LETS already holds.
   *
   * A CLOSED LIST, not every field. An import must not quietly revert a
   * correction an administrator made in LETS — if somebody fixed a trip name
   * or reassigned an office by hand, re-running the import should not undo
   * it. Only these fields are the source's to own.
   */
  var COMPARED_FIELDS = [
    { field: 'estimateAmount', letsField: 'estimate', label: 'Estimate' },
    { field: 'approvedAmount', letsField: 'actual', label: 'Actual (Amount Approved)' },
    { field: 'startDate', letsField: 'startDate', label: 'Start date' },
    { field: 'endDate', letsField: 'endDate', label: 'End date' },
    { field: 'officeCode', letsField: 'owningOffice', label: 'Owning office' }
  ];

  /**
   * Is an existing LETS actual VERIFIED?
   *
   * @clolry: "Never overwrite verified financial records without an explicit
   * reconciliation rule." This predicate is that rule, made mechanical.
   *
   * Verified means one of two things, and both are deliberate human acts:
   *
   *   Actual_Source is 'manual'  — somebody typed the figure in. A person
   *                                reading a voucher beats a file every time.
   *   Match_Confirmed_By is set  — somebody reviewed an ambiguous match and
   *                                committed to it. That judgement is the
   *                                most expensive data in the system.
   *
   * An actual written by a previous IMPORT is NOT verified. It is the same
   * class of claim as the one now arriving, so a later file supersedes it
   * freely — which is exactly what makes incremental runs useful.
   *
   * @param {Object} existing
   * @returns {boolean}
   */
  function isVerifiedActual(existing) {
    if (!existing) return false;
    if (!existing.actual && existing.actual !== 0) return false;
    if (_str_(existing.actualSource).toLowerCase() === 'manual') return true;
    if (_str_(existing.matchConfirmedBy)) return true;
    return false;
  }

  /**
   * Compares one in-scope record against what LETS holds.
   *
   * Returns the classification, the per-field before/after, and — when the
   * reconciliation rule blocks the write — why.
   *
   * @param {Object} rec parsed source record
   * @param {Object|null} existing { requestId, estimate, actual, startDate,
   *                                 endDate, owningOffice, actualSource,
   *                                 matchConfirmedBy }
   * @returns {{status: string, detail: Object, conflicts: Array}}
   */
  function diffRecord(rec, existing) {
    if (!existing) {
      return { status: DIFF.NEW, detail: {}, conflicts: [] };
    }

    var detail = {};
    var conflicts = [];

    COMPARED_FIELDS.forEach(function (c) {
      var incoming = rec[c.field];
      var current = existing[c.letsField];

      // A source field the row does not carry says nothing about the target.
      // An expense row has no startDate; that must not read as "clear the
      // start date", which would wipe the dates off a matched request.
      if (incoming === '' || incoming === undefined || incoming === null) return;
      // Zero money from a tab that does not carry that figure is absence, not
      // a value. A request row's approvedAmount is 0 because requests have no
      // actuals — writing that over a real actual would destroy it.
      if ((c.field === 'approvedAmount' || c.field === 'estimateAmount') &&
          Number(incoming) === 0 &&
          !(rec.sourceSheet === 'TravelRequest' && c.field === 'estimateAmount') &&
          !(rec.sourceSheet === 'Expense' && c.field === 'approvedAmount')) {
        return;
      }

      var same = (typeof incoming === 'number' || typeof current === 'number')
        ? Math.abs(round2(incoming) - round2(current || 0)) < 0.005
        : _str_(incoming) === _str_(current);
      if (same) return;

      detail[c.field] = { label: c.label, from: current, to: incoming };

      // THE RECONCILIATION GUARD. Only the actual is protected: it is the
      // only figure that represents money GSA has already paid, and the only
      // one a human reviews row by row.
      if (c.field === 'approvedAmount' && isVerifiedActual(existing)) {
        conflicts.push({
          field: c.field,
          label: c.label,
          from: current,
          to: incoming,
          reason: 'The existing actual is VERIFIED (' +
                  (_str_(existing.actualSource).toLowerCase() === 'manual'
                    ? 'entered manually'
                    : 'match confirmed by ' + existing.matchConfirmedBy) +
                  '). An import will not overwrite it. Confirm the override ' +
                  'explicitly, with a reason, or leave the verified figure in place.'
        });
      }
    });

    if (conflicts.length) return { status: DIFF.CONFLICT, detail: detail, conflicts: conflicts };
    if (Object.keys(detail).length) return { status: DIFF.CHANGED, detail: detail, conflicts: [] };
    return { status: DIFF.UNCHANGED, detail: {}, conflicts: [] };
  }

  /**
   * The whole preview: scope, validate, match, diff, and count.
   *
   * ONE FUNCTION FOR PREVIEW AND COMMIT, deliberately. @clolry asked for an
   * import preview; a preview computed by different code than the commit is
   * a preview of something else. The commit path calls this and writes its
   * output rather than recomputing.
   *
   * @param {Object} input
   *   {requestRows, expenseRows, requestMapping, expenseMapping,
   *    orgRoster, scope, existingBySourceId, letsRequests}
   * @returns {Object}
   */
  function buildPreview(input) {
    var inp = input || {};
    var scope = inp.scope || {};
    var roster = inp.orgRoster || {};
    var existing = inp.existingBySourceId || {};

    var allRequests = parseRows(inp.requestRows, inp.requestMapping, 'request',
                                { orgRoster: roster, firstDataRow: inp.requestFirstRow });
    var allExpenses = parseRows(inp.expenseRows, inp.expenseMapping, 'expense',
                                { orgRoster: roster, firstDataRow: inp.expenseFirstRow });

    // UNSCOPED on purpose — see candidatePool.
    var pool = candidatePool(allRequests, inp.letsRequests);
    var g = _gogov_();

    function classify(rec) {
      var sd = scopeDecision(rec, scope);
      rec.scopeDecision = sd.decision;
      rec.scopeReason = sd.reason;

      if (sd.decision !== SCOPE.IN) {
        rec.diffStatus = DIFF.SKIPPED_SCOPE;
        rec.problems = [];
        return rec;
      }

      rec.problems = validateRecord(rec);
      if (rec.problems.length) {
        rec.diffStatus = DIFF.ERROR;
        rec.errorMessage = rec.problems.join(' ');
        return rec;
      }

      // Expense rows have to find their request before they can be diffed
      // against it. Reuses GogovSync's 4-tier matcher, including the rule
      // that a cited ID whose traveller disagrees STOPS the match — the
      // defect that put Brandon Maness's $1,922.96 on another traveller's
      // request when that matcher was first written.
      if (rec.sourceSheet === 'Expense') {
        if (g && g.matchExpense) {
          var m = g.matchExpense({
            extractedLetsId: g.extractLetsId ? g.extractLetsId(rec.tripName) : '',
            reportName: rec.tripName,
            employeeName: rec.employeeName,
            employeeNameNormalized: rec.employeeNameNormalized,
            reportEndDate: rec.reportEndDate,
            amountApproved: rec.approvedAmount
          }, pool);
          rec.matchStatus = m.status;
          rec.matchMethod = m.method;
          rec.matchCandidates = m.candidates || [];
          rec.matchNote = m.note || '';
          rec.targetSourceId = m.requestId || '';
        } else {
          rec.matchStatus = 'NEEDS_REVIEW';
          rec.matchMethod = '';
          rec.matchCandidates = [];
          rec.matchNote = 'The matcher is unavailable.';
          rec.targetSourceId = '';
        }
      } else {
        // A request row IS its own target: its source ID is the key.
        rec.matchStatus = 'AUTO_MATCHED';
        rec.matchMethod = 'source-id';
        rec.matchCandidates = [];
        rec.targetSourceId = rec.sourceRecordId;
      }

      var current = rec.targetSourceId ? (existing[rec.targetSourceId] || null) : null;
      // An unmatched expense is NOT an error and NOT a conflict. It is real
      // money GSA paid against a trip LETS cannot see, and it must stay
      // visible — the Expense_Imports schema comment makes the same point.
      if (rec.sourceSheet === 'Expense' && !rec.targetSourceId) {
        rec.diffStatus = DIFF.NEW;
        rec.diffDetail = {};
        rec.conflicts = [];
        return rec;
      }

      var d = diffRecord(rec, current);
      rec.diffStatus = d.status;
      rec.diffDetail = d.detail;
      rec.conflicts = d.conflicts;
      rec.targetRequestId = current ? current.requestId : '';
      return rec;
    }

    var records = allRequests.map(classify).concat(allExpenses.map(classify));

    var counts = {};
    var scopeCounts = {};
    var inScopeAmount = 0;
    records.forEach(function (r) {
      counts[r.diffStatus] = (counts[r.diffStatus] || 0) + 1;
      scopeCounts[r.scopeDecision] = (scopeCounts[r.scopeDecision] || 0) + 1;
      if (r.scopeDecision === SCOPE.IN) {
        inScopeAmount += (r.sourceSheet === 'Expense') ? r.approvedAmount : r.estimateAmount;
      }
    });

    return {
      records: records,
      summary: {
        sourceRows: records.length,
        inScope: scopeCounts[SCOPE.IN] || 0,
        counts: counts,
        scopeCounts: scopeCounts,
        amountInScope: round2(inScopeAmount),
        newCount: counts[DIFF.NEW] || 0,
        changedCount: counts[DIFF.CHANGED] || 0,
        unchangedCount: counts[DIFF.UNCHANGED] || 0,
        conflictCount: counts[DIFF.CONFLICT] || 0,
        errorCount: counts[DIFF.ERROR] || 0,
        skippedCount: counts[DIFF.SKIPPED_SCOPE] || 0,
        needsReview: records.filter(function (r) {
          return r.scopeDecision === SCOPE.IN && r.matchStatus === 'NEEDS_REVIEW';
        }).length,
        // STATED ON EVERY PREVIEW, because LETS will not agree with the
        // source workbook and somebody will ask why. See Import_Batches
        // .Variance_Basis.
        varianceBasis: 'amount-approved',
        varianceBasisNote: 'LETS reconciles against Amount Approved (what GSA paid). ' +
          'The source workbook computes its variance from Report Total (what the ' +
          'traveller claimed), so the two will differ by the disallowed amount.'
      }
    };
  }

  return {
    // helpers
    round2: round2,
    toDateString: toDateString,
    fiscalYearOf: fiscalYearOf,
    currentFiscalYear: currentFiscalYear,
    normalizeName: normalizeName,
    // identity
    normalizeSourceId: normalizeSourceId,
    compositeKey: compositeKey,
    rowHash: rowHash,
    // org
    officeForOrgCode: officeForOrgCode,
    orgRootForOffice: orgRootForOffice,
    buildOrgRoster: buildOrgRoster,
    KNOWN_OFFICES: KNOWN_OFFICES,
    // kinds
    RECORD_KINDS: RECORD_KINDS,
    recordKindForRequest: recordKindForRequest,
    recordKindForExpense: recordKindForExpense,
    statusForRecord: statusForRecord,
    // mapping
    proposeMapping: proposeMapping,
    REQUEST_FIELD_HINTS: REQUEST_FIELD_HINTS,
    EXPENSE_FIELD_HINTS: EXPENSE_FIELD_HINTS,
    REQUIRED_FIELDS: REQUIRED_FIELDS,
    // parse + scope + validate
    parseRows: parseRows,
    nonTravelReason: nonTravelReason,
    scopeDecision: scopeDecision,
    validateRecord: validateRecord,
    SCOPE: SCOPE,
    // diff + preview
    candidatePool: candidatePool,
    isVerifiedActual: isVerifiedActual,
    diffRecord: diffRecord,
    buildPreview: buildPreview,
    DIFF: DIFF,
    COMPARED_FIELDS: COMPARED_FIELDS
  };
})();
