/**
 * LiabilityLogSync.js
 * Daily pull of the ASD FY27 Travel/Liability Log into LETS.
 *
 * WHY THIS EXISTS
 * ---------------
 * @clolry: "it wouldn't hurt for the next few months until we deploy and force
 * everyone to use the system - it would be good to do a daily pull from that
 * spreadsheet."
 *
 * Until LETS is mandatory, the travel coordinator's spreadsheet is the system
 * of record and LETS is a reader. The budget dashboard and the org ledger are
 * worthless if they show 30 trips the coordinator entered last week and
 * nothing since.
 *
 * WHY NOT BudgetBackfill
 * ----------------------
 * BudgetBackfill.saveBackfill already writes imported travel into Requests,
 * and this uses the same target tabs. It is not reused as-is for one reason:
 * it is an APPEND-ONLY importer designed for a human pasting rows once. Run
 * daily against a spreadsheet, it would write 30 more requests every morning.
 *
 * The hard part of a recurring sync is not parsing. It is knowing that the
 * Mould row you are looking at today is the Mould row you imported yesterday,
 * after someone fixed her org code and filed her voucher. That is what
 * Source_Row_Key and the update path below are for.
 *
 * THE IDEMPOTENCY KEY
 * -------------------
 * The log's own Document Number column is empty on 29 of 30 rows (its one
 * value is the word "Cancelled"), so it cannot be the key.
 *
 * So the sync WRITES ITS OWN key back into a LETS_Key column on the source
 * sheet, on first sight of a row, and reads it thereafter. @clolry approved
 * this.
 *
 * A content hash was the alternative and is worse. Hashing last name + start
 * date + cost means that correcting a typo in any of those fields produces a
 * new key, so the sync sees a new trip, imports it, and the old one stays —
 * double-counting against a DAC, from a correction. A written-back key
 * survives every edit to every other column, which is the entire point.
 *
 * WHICH FISCAL YEAR A TRIP IS CHARGED TO
 * --------------------------------------
 * @clolry: "it's not the submission date - it's the date that their expense
 * report is approved (column S 'Voucher Approved') that determines the fiscal
 * year - so 100% of the entries on the spreadsheet should be loaded as FY27
 * travel."
 *
 * It is the APPROVAL date, not the submission date and not the travel date.
 * That correction matters and this is the second time the rule has moved, so
 * the evidence is recorded here rather than left as a bare assertion:
 *
 *   by travel start date      18 FY27, 11 FY26, 1 FY21 (a typo)
 *   by voucher SUBMITTED      17 FY27, 3 FY26
 *   by voucher APPROVED       20 FY27, 0 anything else
 *
 * Three rows separate the submitted rule from the approved rule — Calhoun,
 * Dean and Henry all submitted on 29-30 September and were approved on 1
 * October. Under the submitted rule they are FY26 and drop out of the FY27
 * dashboard entirely, taking $4,119.21 of real spend with them. Under
 * @clolry's actual rule they are FY27, and every approved voucher in the log
 * lands in FY27 — which is what he said to expect, and is the check that the
 * rule has been implemented correctly.
 *
 * For a row with no APPROVED voucher the fiscal year is unknowable, because
 * the event that decides it has not happened. Those 10 rows are attributed
 * provisionally and marked PROVISIONAL_NOT_YET_APPROVED. Because the sync
 * re-evaluates every row daily, such a trip MOVES to its real fiscal year the
 * morning after its voucher is approved. That self-correction is the strongest
 * argument for the daily pull; a one-shot import would freeze a guess.
 *
 * ESTIMATES AND ACTUALS ARE BOTH KEPT
 * -----------------------------------
 * @clolry: "Please keep the estimates and the actuals - we want to see a
 * history of both."
 *
 * Column M (Estimated Cost, what went to Go.gov) is the estimate. Column L
 * (ASD Pre-Approved Travel Request, what went to FAS) is deliberately IGNORED
 * on @clolry's instruction — the two disagree by $1,402.28 across the sheet
 * and reading the wrong one would misstate every commitment.
 *
 * Voucher Approved Cost is the actual. Both are written to their own columns,
 * so the variance survives: five rows came in OVER their estimate, totalling
 * $1,374.59, and a model that overwrote the estimate with the actual would
 * erase the only evidence of that.
 */

var LiabilityLogSync = (function () {

  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

  function _str_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  /** A number from a cell that may hold text, a currency string, or junk. */
  function _num_(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    var n = parseFloat(String(v).replace(/[$,\s]/g, ''));
    return isNaN(n) ? null : n;
  }

  /** YYYY-MM-DD, or '' when unparseable. */
  function _dateOnly_(v) {
    if (!v) return '';
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  /**
   * Fiscal year of a date. October through September.
   *
   * Returns the FY label LETS uses elsewhere ('FY27'), not the full year, so
   * it can be compared to LETS_CONFIG.fiscalYear without reformatting.
   */
  function fiscalYearOf(dateStr) {
    var s = _dateOnly_(dateStr);
    if (!s) return '';
    var y = parseInt(s.slice(0, 4), 10);
    var m = parseInt(s.slice(5, 7), 10);
    var fy = (m >= 10) ? y + 1 : y;
    return 'FY' + String(fy).slice(-2);
  }

  // ==========================================================================
  // COLUMN MAPPING
  // ==========================================================================

  /**
   * The source columns this sync reads, by their EXACT header text.
   *
   * Resolved by header name, never by position. The log has 55 columns, most
   * empty, and a coordinator inserting one would silently shift every
   * positional read — the defect class recorded as G-014.
   *
   * Column L is absent from this list ON PURPOSE. See the file header: it is
   * the FAS pre-approval figure and @clolry directed that column M be used
   * instead. Listing it would invite a future reader to "fix" the omission.
   */
  var COLUMNS = {
    lastName:        'Last Name',
    firstName:       'First Name',
    orgCode:         'Organization',
    approvedBy:      'Approved by',
    travelType:      'Type',
    purpose:         'Purpose',
    fromCity:        'From',
    toCity:          'To',
    startDate:       'Start',
    endDate:         'End',
    authSubmitted:   ' Authorization Submitted',   // leading space is REAL
    estimatedCost:   'Estimated Cost',             // column M
    authApproved:    'Authorization Approval Date',
    voucherSubmitted:'Voucher Submitted',
    voucherCost:     'Voucher Approved Cost',
    voucherApproved: 'Voucher Approved',
    documentNumber:  'Document Number',
    notes:           'NOTES'
  };

  /** The column the sync writes its own key into. */
  var KEY_HEADER = 'LETS_Key';

  /**
   * Maps the header row to indices, reporting what is missing.
   *
   * ' Authorization Submitted' has a LEADING SPACE in the real sheet. It is
   * matched exactly rather than trimmed, because trimming here would hide the
   * fact that the header is odd — and if the coordinator ever fixes it, the
   * loud failure below is the correct outcome, not a silent fallback to a
   * different column.
   *
   * @param {Array} headerRow
   * @returns {{index: Object, missing: Array<string>, keyColumn: number}}
   */
  function mapColumns(headerRow) {
    var row = (headerRow || []).map(function (h) {
      return (h === null || h === undefined) ? '' : String(h);
    });
    var index = {};
    var missing = [];

    Object.keys(COLUMNS).forEach(function (field) {
      var at = row.indexOf(COLUMNS[field]);
      if (at === -1) {
        missing.push(COLUMNS[field]);
      } else {
        index[field] = at;
      }
    });

    return {
      index: index,
      missing: missing,
      // -1 when the sheet has not been keyed yet. The sync adds the column.
      keyColumn: row.indexOf(KEY_HEADER)
    };
  }

  // ==========================================================================
  // ROW INTERPRETATION
  // ==========================================================================

  /**
   * Status for one log row.
   *
   * DERIVED, never read from the sheet, because this single value decides
   * whether a dollar figure lands as actual spend or as a commitment. The log
   * has no status column, and inferring it from the dates is the only
   * consistent rule available.
   *
   *   Document Number == 'Cancelled'  -> CANCELLED   counts for nothing
   *   has a voucher amount            -> COMPLETED   actual spend
   *   otherwise                       -> APPROVED_GOGOV  committed
   *
   * The cancelled check is FIRST. The one cancelled row carries $0 in every
   * money column, so order does not change today's arithmetic — but a
   * cancelled trip that had already been vouchered would otherwise be counted
   * as spend, and that is a real shape.
   *
   * @clolry asked for the cancelled row to be imported rather than skipped, so
   * the record shows what was authorised and then dropped.
   */
  function statusFor(row) {
    if (_str_(row.documentNumber).toUpperCase() === 'CANCELLED') {
      return STATUS_CODES.CANCELLED;
    }
    if (_num_(row.voucherCost) !== null && _num_(row.voucherCost) > 0) {
      return STATUS_CODES.COMPLETED;
    }
    return STATUS_CODES.APPROVED_GOGOV;
  }

  /**
   * Which fiscal year this trip is charged to, and on what basis.
   *
   * @clolry's rule is the date the expense report is APPROVED — column S,
   * 'Voucher Approved'. Not the submission date, and not the travel date.
   *
   * THE THREE ROWS THAT PROVE THE DIFFERENCE. Calhoun, Dean and Henry all
   * submitted vouchers on 29-30 September and had them approved on 1 October.
   * Under a submitted-date rule they are FY26 and vanish from the FY27
   * dashboard, taking $4,119.21 of real spend with them. Under the approval
   * rule they are FY27, and every approved voucher in the log is FY27 — which
   * is the assertion @clolry gave us to check the implementation against.
   *
   * When there is no approval date the answer DOES NOT EXIST YET, so this says
   * so rather than picking one quietly: `basis` is stored on the request and
   * shown on the dashboard. The daily sync re-evaluates it, so the trip moves
   * to its real year the morning after approval without anyone intervening.
   *
   * @returns {{fiscalYear: string, basis: string}}
   */
  function fiscalYearFor(row) {
    var approved = _dateOnly_(row.voucherApproved);
    if (approved) {
      return { fiscalYear: fiscalYearOf(approved), basis: 'VOUCHER_APPROVED' };
    }
    // Not yet approved. The travel end date is the only proxy available, and
    // it is wrong for anything travelling near a year boundary — which is
    // precisely why it is labelled rather than trusted.
    var end = _dateOnly_(row.endDate);
    if (end) {
      return { fiscalYear: fiscalYearOf(end), basis: 'PROVISIONAL_NOT_YET_APPROVED' };
    }
    return { fiscalYear: '', basis: 'UNKNOWN' };
  }

  /**
   * Resolves a traveller's org code, falling back to the HR roster by name.
   *
   * @clolry asked why Melissa Mould showed as unattributed. The answer is that
   * her Organization CELL IS EMPTY — the org code FCBBBB he expected resolves
   * perfectly well; the sheet simply does not carry it on that row.
   *
   * A blank org code means a $1,517.97 actual belongs to no DAC, so it cannot
   * appear in any org's ledger. Dropping it would make the ASD total smaller
   * than reality while every individual DAC row looked right.
   *
   * So when the cell is blank this looks the person up in HC_Positions by
   * surname and forename. The roster is the authority on where someone sits,
   * and it is already loaded for the headcount split.
   *
   * MATCHED ON A UNIQUE NAME ONLY. Two people sharing a surname and forename
   * would make this attribute money to a coin-flip, so an ambiguous match is
   * refused and reported. 'Mould,Melissa J' is matched on surname plus first
   * forename token, because the roster stores a middle initial the log does
   * not.
   *
   * @param {Object} row         the parsed log row
   * @param {Object} rosterIndex from buildRosterIndex
   * @returns {{orgCode: string, source: string, note: string}}
   */
  function resolveOrgCode(row, rosterIndex) {
    var declared = _str_(row.orgCode).toUpperCase();
    if (declared) return { orgCode: declared, source: 'SHEET', note: '' };

    var last = _str_(row.lastName).toUpperCase();
    var first = _str_(row.firstName).toUpperCase().split(/[\s,]+/)[0] || '';
    if (!last || !first || !rosterIndex) {
      return {
        orgCode: '', source: 'NONE',
        note: 'Organization is blank and the traveller could not be looked up.'
      };
    }

    var hits = rosterIndex[last + '|' + first] || [];
    if (hits.length === 1) {
      return {
        orgCode: _str_(hits[0].orgCode).toUpperCase(),
        source: 'ROSTER',
        note: 'Organization was blank; taken from the HR roster for ' +
              _str_(row.firstName) + ' ' + _str_(row.lastName) + '.'
      };
    }
    if (hits.length > 1) {
      return {
        orgCode: '', source: 'AMBIGUOUS',
        note: hits.length + ' people in the HR roster are named ' +
              _str_(row.firstName) + ' ' + _str_(row.lastName) +
              '. Set the Organization cell to resolve it.'
      };
    }
    return {
      orgCode: '', source: 'NONE',
      note: 'Organization is blank and no HR roster entry matches ' +
            _str_(row.firstName) + ' ' + _str_(row.lastName) + '.'
    };
  }

  /**
   * Surname|forename -> roster positions, for the blank-org fallback.
   *
   * Keyed on the FIRST forename token so 'Mould,Melissa J' matches a log row
   * reading 'Melissa'. Vacant seats are excluded: a vacant position has no
   * occupant to have travelled.
   *
   * @param {Array} positions HC bundle
   * @returns {Object}
   */
  function buildRosterIndex(positions) {
    var index = {};
    (positions || []).forEach(function (p) {
      if (!p || p.occupancyStatus === 'VACANT') return;
      var name = _str_(p.employeeName);
      if (!name) return;

      // Roster names are 'Surname,Forename M'. Split on the comma, then take
      // the first whitespace-delimited token of the forename.
      var parts = name.split(',');
      var last = _str_(parts[0]).toUpperCase();
      var first = _str_(parts[1]).toUpperCase().split(/\s+/)[0] || '';
      if (!last || !first) return;

      var key = last + '|' + first;
      if (!index[key]) index[key] = [];
      index[key].push(p);
    });
    return index;
  }

  /**
   * One source row -> the shape the importer writes.
   *
   * Pure: no sheet access, no clock beyond what is passed in. Everything the
   * sync decides about a row is decided here, so the test suite can assert on
   * all of it without a spreadsheet.
   *
   * @param {Array} cells       the raw row
   * @param {Object} mapped     from mapColumns
   * @param {Object} rosterIndex from buildRosterIndex
   * @param {number} rowNumber  1-based sheet row, for error messages
   * @returns {Object|null} null for a row that is not a trip at all
   */
  function interpretRow(cells, mapped, rosterIndex, rowNumber) {
    var idx = mapped.index;
    var get = function (field) {
      return (field in idx) ? cells[idx[field]] : '';
    };

    var row = {};
    Object.keys(COLUMNS).forEach(function (field) { row[field] = get(field); });

    // A row with neither name is a spacer or a formula remnant, not a trip.
    // The log is 409 rows long and only 30 carry data.
    if (!_str_(row.lastName) && !_str_(row.firstName)) return null;

    var org = resolveOrgCode(row, rosterIndex);
    var fy = fiscalYearFor(row);
    var status = statusFor(row);
    var estimate = _num_(row.estimatedCost);
    var actual = _num_(row.voucherCost);

    var problems = [];
    var warnings = [];

    if (!_dateOnly_(row.startDate)) problems.push('Start date is missing or unreadable.');
    if (!_dateOnly_(row.endDate)) problems.push('End date is missing or unreadable.');

    // A start date AFTER the end date is a typo, and one row has it: Calhoun
    // reads 2021-09-21 to 2026-09-24. Reported rather than silently repaired —
    // guessing 2026 would be right here and wrong the day someone logs genuine
    // multi-year travel.
    var s = _dateOnly_(row.startDate);
    var e = _dateOnly_(row.endDate);
    if (s && e && s > e) {
      warnings.push('Start date ' + s + ' is after the end date ' + e +
                    ' — likely a typo in the year. Imported as written.');
    }

    if (estimate === null && status !== STATUS_CODES.CANCELLED) {
      warnings.push('No estimated cost (column M).');
    }
    if (!org.orgCode) problems.push(org.note);
    if (org.note && org.orgCode) warnings.push(org.note);

    // An actual over its estimate is a real and interesting condition, not an
    // error. Five rows have it. Surfaced so the ledger can show the variance
    // rather than quietly presenting the larger number as if it were planned.
    if (actual !== null && estimate !== null && actual > estimate) {
      warnings.push('Voucher $' + round2(actual).toFixed(2) + ' exceeds the estimate $' +
                    round2(estimate).toFixed(2) + ' by $' +
                    round2(actual - estimate).toFixed(2) + '.');
    }

    if (fy.basis === 'PROVISIONAL_NOT_YET_APPROVED') {
      warnings.push('The expense report has not been approved yet, so the ' +
                    'fiscal year is provisional — taken from the travel end ' +
                    'date. It corrects itself once the voucher is approved.');
    }

    return {
      sheetRow: rowNumber,
      lastName: _str_(row.lastName),
      firstName: _str_(row.firstName),
      travelerName: _str_(row.firstName) + ' ' + _str_(row.lastName),
      orgCode: org.orgCode,
      orgCodeSource: org.source,
      officeCode: (typeof BudgetBackfill !== 'undefined' && BudgetBackfill.officeForOrgCode)
        ? BudgetBackfill.officeForOrgCode(org.orgCode) : '',
      approvedBy: _str_(row.approvedBy),
      travelType: _str_(row.travelType),
      purpose: _str_(row.purpose),
      fromCity: _str_(row.fromCity),
      toCity: _str_(row.toCity),
      startDate: s,
      endDate: e,
      authSubmitted: _dateOnly_(row.authSubmitted),
      authApproved: _dateOnly_(row.authApproved),
      voucherSubmitted: _dateOnly_(row.voucherSubmitted),
      voucherApproved: _dateOnly_(row.voucherApproved),
      // BOTH kept. See the file header.
      estimatedCost: estimate === null ? null : round2(estimate),
      actualCost: actual === null ? null : round2(actual),
      documentNumber: _str_(row.documentNumber),
      notes: _str_(row.notes),
      status: status,
      fiscalYear: fy.fiscalYear,
      fiscalYearBasis: fy.basis,
      problems: problems,
      warnings: warnings
    };
  }

  /**
   * A trip name for a row that has no trip name.
   *
   * The log has a Purpose but no event or trip title, and Requests.Trip_Name
   * is what every report and the event-history grouping keys on. Two rows have
   * a blank purpose as well, so this falls back through purpose -> route ->
   * traveller, and never produces an empty string.
   */
  function tripNameFor(trip) {
    var purpose = _str_(trip.purpose);
    if (purpose) return purpose.length > 120 ? purpose.slice(0, 117) + '...' : purpose;

    var route = [_str_(trip.fromCity), _str_(trip.toCity)].filter(Boolean).join(' to ');
    if (route) return 'Travel ' + route;
    return 'Travel for ' + _str_(trip.travelerName);
  }

  /**
   * Parses a whole sheet read into trips.
   *
   * @param {Array<Array>} values   the full range, header row first
   * @param {Array} positions       HC bundle, for the blank-org fallback
   * @returns {Object}
   */
  function parseSheet(values, positions) {
    var out = {
      trips: [], skipped: 0, headerProblems: [],
      keyColumn: -1, columnCount: 0
    };
    if (!values || !values.length) {
      out.headerProblems.push('The sheet is empty.');
      return out;
    }

    var mapped = mapColumns(values[0]);
    out.keyColumn = mapped.keyColumn;
    out.columnCount = (values[0] || []).length;

    if (mapped.missing.length) {
      // A missing column is fatal and LOUD. Importing with Estimated Cost
      // unresolved would write a sheet full of $0 trips that look imported.
      out.headerProblems.push(
        'These expected columns are not in the sheet: ' + mapped.missing.join(', ') +
        '. The sync will not run until the headers match, because a missing ' +
        'money or date column would import silently wrong figures.');
      return out;
    }

    var rosterIndex = buildRosterIndex(positions);

    for (var r = 1; r < values.length; r++) {
      var trip = interpretRow(values[r], mapped, rosterIndex, r + 1);
      if (!trip) { out.skipped++; continue; }
      trip.existingKey = (mapped.keyColumn > -1)
        ? _str_(values[r][mapped.keyColumn]) : '';
      trip.tripName = tripNameFor(trip);
      out.trips.push(trip);
    }

    return out;
  }

  /**
   * What the sync would do to each trip: insert, update, or leave alone.
   *
   * @param {Array} trips    from parseSheet
   * @param {Object} existing key -> { requestId, status, grandTotal, ... }
   * @returns {Object} { inserts, updates, unchanged, blocked }
   */
  function planChanges(trips, existing) {
    var plan = { inserts: [], updates: [], unchanged: [], blocked: [] };
    existing = existing || {};

    (trips || []).forEach(function (trip) {
      if (trip.problems.length) {
        plan.blocked.push(trip);
        return;
      }

      var key = trip.existingKey;
      var prior = key ? existing[key] : null;

      if (!prior) {
        plan.inserts.push(trip);
        return;
      }

      // Compare only the fields the sync owns. A reviewer who edited the BLUF
      // in LETS must not have it reverted every morning.
      var changed = [];
      var cmpMoney = function (name, now, before) {
        var a = (now === null || now === undefined) ? '' : round2(now).toFixed(2);
        var b = (before === null || before === undefined || before === '')
          ? '' : round2(before).toFixed(2);
        if (a !== b) changed.push(name + ': ' + (b || 'blank') + ' -> ' + (a || 'blank'));
      };

      cmpMoney('estimate', trip.estimatedCost, prior.estimatedCost);
      cmpMoney('actual', trip.actualCost, prior.actualCost);
      if (trip.status !== prior.status) {
        changed.push('status: ' + prior.status + ' -> ' + trip.status);
      }
      if (trip.fiscalYear !== _str_(prior.fiscalYear)) {
        changed.push('fiscal year: ' + (prior.fiscalYear || 'blank') +
                     ' -> ' + trip.fiscalYear);
      }
      if (trip.orgCode !== _str_(prior.orgCode).toUpperCase()) {
        changed.push('org code: ' + (prior.orgCode || 'blank') + ' -> ' + trip.orgCode);
      }

      if (changed.length) {
        plan.updates.push({ trip: trip, requestId: prior.requestId, changes: changed });
      } else {
        plan.unchanged.push(trip);
      }
    });

    return plan;
  }

  return {
    COLUMNS: COLUMNS,
    KEY_HEADER: KEY_HEADER,
    mapColumns: mapColumns,
    statusFor: statusFor,
    fiscalYearOf: fiscalYearOf,
    fiscalYearFor: fiscalYearFor,
    resolveOrgCode: resolveOrgCode,
    buildRosterIndex: buildRosterIndex,
    interpretRow: interpretRow,
    tripNameFor: tripNameFor,
    parseSheet: parseSheet,
    planChanges: planChanges,
    round2: round2
  };
})();

// Node/CommonJS export for the test suite. Inert in Apps Script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LiabilityLogSync;
}
