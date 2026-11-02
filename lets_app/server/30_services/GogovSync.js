/**
 * GogovSync.js
 * Importing Go.gov travel requests and expense reports, and reconciling them.
 *
 * WHAT THIS IS FOR
 * ----------------
 * @clolry: "I'll be pulling reports from Go.gov and will need to use those as
 * input sources for a monthly financial reconciliation process."
 *
 * Two imports with different lifetimes:
 *
 *   REQUESTS  — a one-time catch-up. @clolry: "it will only need to happen a
 *               few times as we get going and then once we are using the LETS
 *               system we won't need to ever import outstanding requests
 *               again."
 *   EXPENSES  — every month, indefinitely.
 *
 * WHAT THE EXPORTS ACTUALLY CONTAIN — measured, not assumed
 * ---------------------------------------------------------
 * Both sample files were parsed before any of this was written. Four findings
 * shaped the design, and each is the reason for something that would otherwise
 * look over-engineered.
 *
 * 1. NO EXPENSE CATEGORY SPLIT. The expense export has 18 columns and exactly
 *    two money columns: Report Total and Amount Approved. There is no
 *    airfare/lodging/M&IE breakdown anywhere. So actuals are TRIP-LEVEL only,
 *    while estimates keep their per-category detail. Variance is therefore a
 *    trip-level number, and pretending otherwise would invent data.
 *
 * 2. Report Total != Amount Approved ON 37 OF 182 ROWS, by $4,569.93. Report
 *    Total is what the traveller claimed; Amount Approved is what GSA paid.
 *    Reconciling against Report Total would overstate spend on a fifth of all
 *    rows. @clolry: "we need to use Amount Approved rather than Report Total."
 *
 * 3. ONE MONTHLY EXPORT SPANS TWO FISCAL YEARS. Report End Dates in the sample
 *    run 2026-03 to 2027-08: $129,470.97 in FY2026 and $143,884.73 in FY2027.
 *    @clolry: "our fiscal year is 10/1 through 9/30 so budgeting all resets on
 *    10/1." Every row is therefore bucketed individually, and a cross-year
 *    import is refused rather than silently charged to the wrong year.
 *
 * 4. THE EXPENSE EXPORT CARRIES NO REQUEST ID. Every cell of all 522 rows was
 *    searched for the Go.gov request codes; zero hits. 'Authorization
 *    Requests' is a bare Y/N. So the only automatic link is a LETS ID that a
 *    traveller typed into the trip name — which is why the SOP exists, and why
 *    matching falls back to proposing candidates for a human.
 *
 * WHY MATCHING CANNOT BE FULLY AUTOMATIC
 * --------------------------------------
 * Measured on the real files: traveller + exact title matches 231 of 522
 * expense reports (44.3%), plus 4 by date window. 32.6% belong to travellers
 * with no request in the export at all. 20 rows have 2-3 equally plausible
 * candidates.
 *
 * Amount cannot break a tie: of 274 title-matched pairs only 7 (3%) have equal
 * amounts, median difference $190.57. Actuals differ from estimates by design —
 * that is what reconciliation measures.
 *
 * So a confident match is applied, an ambiguous one is PROPOSED, and anything
 * else is parked. An auto-match on a guess would attach one traveller's $7,548
 * to another's trip, and nothing downstream would question it.
 */

var GogovSync = (function () {

  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
  function _str_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

  // ==========================================================================
  // THE LETS ID PARSER
  // ==========================================================================

  /**
   * Finds a LETS request ID inside arbitrary text.
   *
   * TOLERANT INPUT, STRICT OUTPUT. Three travellers already do this by hand,
   * and each wrote it differently:
   *
   *   'Denver to Atlanta -REQ-2026-0362'
   *   'DOCPER Workshop (REQ-2026-0282)'
   *   'REQ-2026-0435_GABLE, ROBERT'
   *
   * Rejecting any of those would punish the people already cooperating. The
   * separator is optional and may be a hyphen, underscore or space, so
   * 'req 2026 0362' and 'REQ20260362' both resolve.
   *
   * Returns the CANONICAL form, so a match is an exact string comparison
   * downstream rather than another fuzzy test.
   *
   * @param {string} text
   * @returns {string} 'REQ-2026-0362', or '' when absent
   */
  function extractLetsId(text) {
    var m = /REQ[-_\s]?(\d{4})[-_\s]?(\d{3,5})/i.exec(_str_(text));
    if (!m) return '';
    return 'REQ-' + m[1] + '-' + m[2];
  }

  // ==========================================================================
  // NAMES
  // ==========================================================================

  /**
   * Normalizes a name to 'FIRST LAST', uppercased.
   *
   * The two exports disagree about format AND casing. Expenses write
   * 'Dolezal, Nathan K.'; requests write 'Jakenberg Almuete'. 71 of 182
   * expense rows are ALL CAPS and the rest are mixed.
   *
   * The middle initial is dropped because only one side has it. Dropping it
   * loses the ability to tell two people with the same first and last name
   * apart — which is exactly why a name match PROPOSES rather than decides.
   *
   * @param {string} name
   * @returns {string}
   */
  function normalizeName(name) {
    var n = _str_(name);
    if (!n) return '';
    if (n.indexOf(',') > -1) {
      var parts = n.split(',');
      var last = _str_(parts[0]);
      var firstBits = _str_(parts[1]).split(/\s+/);
      var first = firstBits.length ? firstBits[0] : '';
      return (first + ' ' + last).toUpperCase().replace(/\s+/g, ' ').trim();
    }
    var bits = n.split(/\s+/);
    if (bits.length < 2) return n.toUpperCase();
    return (bits[0] + ' ' + bits[bits.length - 1]).toUpperCase();
  }

  /** Title reduced to comparable form: lowercase, punctuation collapsed. */
  function normalizeTitle(t) {
    return _str_(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // ==========================================================================
  // DATES AND THE FISCAL YEAR
  // ==========================================================================

  /**
   * A cell value to YYYY-MM-DD.
   *
   * The two exports store dates DIFFERENTLY and this is not cosmetic:
   * Report End Date arrives as TEXT 'YYYY-MM-DD', while Submit Date and the
   * request Start/End dates are Excel serial numbers. A parser assuming either
   * one alone silently produces 1970 or NaN for half the data.
   *
   * @param {*} v
   * @returns {string} '' when unparseable
   */
  function toDateString(v) {
    if (v === null || v === undefined || v === '') return '';

    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      return _fmt_(v);
    }

    // Excel serial. 25569 is 1970-01-01; anything below ~20000 is more likely
    // a typo than a 1954 date, so it is rejected rather than accepted.
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return '';
      return _fmt_(new Date(Math.round((v - 25569) * 86400000)));
    }

    var s = _str_(v);
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];

    var d = new Date(s);
    return isNaN(d.getTime()) ? '' : _fmt_(d);
  }

  function _fmt_(d) {
    var m = d.getUTCMonth() + 1;
    var day = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' +
           (day < 10 ? '0' + day : day);
  }

  /**
   * Fiscal year for a YYYY-MM-DD date. October through September.
   *
   * @clolry: "our fiscal year is 10/1 through 9/30 so budgeting all resets on
   * 10/1."
   *
   * @param {string} dateStr
   * @returns {string} 'FY2027', or ''
   */
  function fiscalYearOf(dateStr) {
    var s = _str_(dateStr);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    var y = parseInt(s.slice(0, 4), 10);
    var mo = parseInt(s.slice(5, 7), 10);
    if (mo < 1 || mo > 12) return '';
    return 'FY' + (mo >= 10 ? y + 1 : y);
  }

  /** The fiscal year in progress. */
  function currentFiscalYear(now) {
    var d = now || new Date();
    return 'FY' + (d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear());
  }

  // ==========================================================================
  // COLUMN MAPPING
  // ==========================================================================
  //
  // @clolry chose a mapping UI over a hardcoded parser, so the header names
  // are DEFAULTS rather than requirements. Go.gov changing a column heading
  // then costs a remap, not a code change.

  /** Default header -> field, for the request export. */
  var REQUEST_FIELD_HINTS = {
    gogovRequestId: ['Request ID', 'Request Id', 'RequestID'],
    tripName:       ['Name', 'Request Name', 'Trip Name'],
    employeeName:   ['Employee Name', 'Traveler', 'Traveler Name'],
    amount:         ['Total Approved Amount', 'Approved Amount', 'Total'],
    startDate:      ['Start Date', 'Begin Date'],
    endDate:        ['End Date'],
    purpose:        ['Purpose', 'Justification'],
    submitDate:     ['Submit Date', 'Submitted'],
    status:         ['Approval Status', 'Status']
  };

  /** Default header -> field, for the expense export. */
  var EXPENSE_FIELD_HINTS = {
    reportName:      ['Report Name'],
    employeeName:    ['Employee Name', 'Traveler'],
    reportTotal:     ['Report Total'],
    amountApproved:  ['Amount Approved', 'Approved Amount'],
    reportEndDate:   ['Report End Date', 'End Date'],
    submitDate:      ['Submit Date'],
    employeeId:      ['Employee ID', 'Employee Id'],
    status:          ['Approval Status', 'Status']
  };

  /**
   * Proposes a header -> field mapping, for the UI to confirm.
   *
   * PROPOSES, never decides. A silently wrong guess here would map Report
   * Total onto the actual and overstate spend on every row — the exact error
   * @clolry corrected. The UI shows what was guessed and requires
   * confirmation.
   *
   * @param {Array<string>} headers
   * @param {string} kind 'request' | 'expense'
   * @returns {{mapping: Object, unmapped: Array<string>, missing: Array<string>}}
   */
  function proposeMapping(headers, kind) {
    var hints = kind === 'request' ? REQUEST_FIELD_HINTS : EXPENSE_FIELD_HINTS;
    var hdrs = (headers || []).map(_str_);
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

    // REQUIRED fields, by kind. Without these the import cannot attribute
    // money to a person or a fiscal year, which is the whole purpose.
    var required = kind === 'request'
      ? ['gogovRequestId', 'employeeName', 'amount', 'startDate', 'endDate']
      : ['employeeName', 'amountApproved', 'reportEndDate'];

    return {
      mapping: mapping,
      unmapped: hdrs.filter(function (h) { return !used[h]; }),
      missing: required.filter(function (f) { return !mapping[f]; })
    };
  }

  // ==========================================================================
  // PARSING
  // ==========================================================================

  /**
   * Rows + a confirmed mapping -> normalized request records.
   *
   * @param {Array<Object>} rows header-keyed objects from the client
   * @param {Object} mapping field -> header
   * @returns {Array<Object>}
   */
  function parseRequestRows(rows, mapping) {
    var m = mapping || {};
    function val(row, field) {
      return m[field] ? row[m[field]] : undefined;
    }
    return (rows || []).map(function (row, i) {
      var start = toDateString(val(row, 'startDate'));
      var end = toDateString(val(row, 'endDate'));
      var name = _str_(val(row, 'employeeName'));
      var title = _str_(val(row, 'tripName'));
      return {
        rowIndex: i,
        gogovRequestId: _str_(val(row, 'gogovRequestId')).toUpperCase(),
        tripName: title,
        // The SOP convention. If the traveller put the LETS ID in the trip
        // name, the match is exact and no human is needed.
        extractedLetsId: extractLetsId(title),
        employeeName: name,
        employeeNameNormalized: normalizeName(name),
        amount: round2(val(row, 'amount')),
        startDate: start,
        endDate: end,
        purpose: _str_(val(row, 'purpose')),
        submitDate: toDateString(val(row, 'submitDate')),
        status: _str_(val(row, 'status')),
        // Bucketed on the START date: that is when the money is committed.
        fiscalYear: fiscalYearOf(start)
      };
    });
  }

  /**
   * Rows + a confirmed mapping -> normalized expense records.
   */
  function parseExpenseRows(rows, mapping) {
    var m = mapping || {};
    function val(row, field) {
      return m[field] ? row[m[field]] : undefined;
    }
    return (rows || []).map(function (row, i) {
      var name = _str_(val(row, 'employeeName'));
      var title = _str_(val(row, 'reportName'));
      var endDate = toDateString(val(row, 'reportEndDate'));
      var total = round2(val(row, 'reportTotal'));
      var approved = round2(val(row, 'amountApproved'));
      return {
        rowIndex: i,
        reportName: title,
        extractedLetsId: extractLetsId(title),
        employeeName: name,
        employeeNameNormalized: normalizeName(name),
        gogovEmployeeId: _str_(val(row, 'employeeId')),
        reportTotal: total,
        amountApproved: approved,
        // Kept because nobody asks for it until a traveller disputes a
        // voucher, and then it is the only number that matters.
        disallowedAmount: round2(total - approved),
        reportEndDate: endDate,
        submitDate: toDateString(val(row, 'submitDate')),
        status: _str_(val(row, 'status')),
        // Bucketed on the REPORT END DATE: that is when the travel finished
        // and therefore which year's budget it consumed.
        fiscalYear: fiscalYearOf(endDate)
      };
    });
  }

  // ==========================================================================
  // MATCHING
  // ==========================================================================

  /**
   * Matches one expense record against candidate requests.
   *
   * TIERED BY CONFIDENCE, and only the top two tiers are applied
   * automatically:
   *
   *   lets-id     a LETS ID in the report name. Exact. AUTO.
   *   gogov-id    a Go.gov request ID in the report name. Exact. AUTO.
   *   name-title  same traveller, same trip title, exactly one hit. AUTO.
   *   name-date   same traveller, end dates within 14 days, one hit. AUTO.
   *   ambiguous   several equally plausible. NEEDS_REVIEW.
   *   unmatched   nothing. Parked, still counted.
   *
   * The 14-day window is wide because a voucher is filed after the trip, not
   * during it, and the sample shows up to a fortnight's lag. Widening it
   * further starts matching the NEXT trip to the same place.
   *
   * @param {Object} expense a parsed expense record
   * @param {Array<Object>} requests candidate request records
   * @returns {{status: string, requestId: string, method: string, candidates: Array}}
   */
  function matchExpense(expense, requests) {
    var list = requests || [];

    // TIER 1 — a LETS ID typed into the report name. The SOP convention.
    if (expense.extractedLetsId) {
      var byLets = list.filter(function (r) {
        return r.requestId === expense.extractedLetsId;
      });

      if (byLets.length === 1) {
        // THE TRAVELLER MUST STILL AGREE.
        //
        // Found by running this matcher over the real export: a cited ID was
        // trusted on its own, and three expense reports were auto-matched to
        // requests belonging to DIFFERENT PEOPLE. Brandon Maness's $1,922.96
        // landed on another traveller's request.
        //
        // One mistyped digit — or a copied trip name — moves money between
        // travellers, and nothing downstream questions it. An explicit ID is
        // the STRONGEST signal available, which is exactly why a contradiction
        // between it and the traveller name has to stop the match rather than
        // be resolved in the ID's favour.
        var owner = byLets[0].employeeNameNormalized;
        if (owner && expense.employeeNameNormalized &&
            owner !== expense.employeeNameNormalized) {
          return {
            status: 'NEEDS_REVIEW', requestId: '', method: '',
            candidates: [_cand_(byLets[0], 'cited by ID, but belongs to ' +
                                           byLets[0].employeeName || owner)],
            note: 'Report name cites ' + expense.extractedLetsId + ', but that ' +
                  'request belongs to ' + (byLets[0].employeeName || owner) +
                  ' and this report is ' + (expense.employeeName || 'someone else') +
                  '. Usually a mistyped ID or a copied trip name.'
          };
        }
        return { status: 'AUTO_MATCHED', requestId: byLets[0].requestId,
                 method: 'lets-id', candidates: [] };
      }

      // An ID that matches nothing is worth saying out loud: it means the
      // traveller followed the convention and the request is missing, which
      // is a different problem from not following it.
      if (!byLets.length) {
        return { status: 'NEEDS_REVIEW', requestId: '', method: '',
                 candidates: [],
                 note: 'Report name cites ' + expense.extractedLetsId +
                       ' but no such request exists in LETS.' };
      }
    }

    // TIER 2 — a Go.gov request ID in the report name. Not present in the
    // sample data, but costs nothing and is exact when it occurs.
    var gogovIds = list.filter(function (r) {
      return r.gogovRequestId &&
             new RegExp('\\b' + r.gogovRequestId + '\\b', 'i')
               .test(expense.reportName);
    });
    if (gogovIds.length === 1) {
      // Traveller must agree here too, for the same reason as tier 1. A
      // 4-character code is short enough to collide with an ordinary word in
      // a trip name.
      var gOwner = gogovIds[0].employeeNameNormalized;
      if (gOwner && expense.employeeNameNormalized &&
          gOwner !== expense.employeeNameNormalized) {
        return {
          status: 'NEEDS_REVIEW', requestId: '', method: '',
          candidates: [_cand_(gogovIds[0], 'Go.gov ID appears in the name, but ' +
                                           'belongs to another traveller')],
          note: 'The Go.gov request ID in this report name belongs to ' +
                (gogovIds[0].employeeName || gOwner) + ', not ' +
                (expense.employeeName || 'this traveller') + '.'
        };
      }
      return { status: 'AUTO_MATCHED', requestId: gogovIds[0].requestId,
               method: 'gogov-id', candidates: [] };
    }

    // From here on, the traveller must match. Nothing else is reliable enough
    // to cross person boundaries.
    var samePerson = list.filter(function (r) {
      return r.employeeNameNormalized &&
             r.employeeNameNormalized === expense.employeeNameNormalized;
    });
    if (!samePerson.length) {
      return { status: 'UNMATCHED', requestId: '', method: '', candidates: [],
               note: 'No request in LETS for ' + (expense.employeeName || 'this traveller') +
                     '. Usually means the request predates what has been imported.' };
    }

    // TIER 3 — same trip title. Go.gov copies the request name onto the
    // expense report, so this holds about 70% of the time.
    var t = normalizeTitle(expense.reportName);
    if (t) {
      var byTitle = samePerson.filter(function (r) {
        return normalizeTitle(r.tripName) === t;
      });
      if (byTitle.length === 1) {
        return { status: 'AUTO_MATCHED', requestId: byTitle[0].requestId,
                 method: 'name-title', candidates: [] };
      }
      if (byTitle.length > 1) {
        // Same person, same title, several times. Common for recurring
        // travel. The amounts differ, but amount is not a reliable key — 3%
        // of title-matched pairs have equal amounts — so a human decides.
        return { status: 'NEEDS_REVIEW', requestId: '', method: '',
                 candidates: byTitle.map(function (r) {
                   return _cand_(r, 'same traveller and trip name');
                 }),
                 note: byTitle.length + ' requests share this traveller and ' +
                       'trip name. Amounts cannot distinguish them.' };
      }
    }

    // TIER 4 — same traveller, end dates close together.
    var withDates = samePerson.filter(function (r) { return r.endDate; });
    if (expense.reportEndDate && withDates.length) {
      var near = withDates.filter(function (r) {
        return Math.abs(_daysBetween_(r.endDate, expense.reportEndDate)) <= 14;
      });
      if (near.length === 1) {
        return { status: 'AUTO_MATCHED', requestId: near[0].requestId,
                 method: 'name-date', candidates: [] };
      }
      if (near.length > 1) {
        return { status: 'NEEDS_REVIEW', requestId: '', method: '',
                 candidates: near.map(function (r) {
                   return _cand_(r, 'same traveller, trip ended within 14 days');
                 }),
                 note: near.length + ' of this traveller\'s trips ended near ' +
                       expense.reportEndDate + '.' };
      }
    }

    // Everything the traveller has, as candidates. Better than nothing: the
    // reviewer can see the whole list rather than searching for it.
    return {
      status: 'NEEDS_REVIEW', requestId: '', method: '',
      candidates: samePerson.slice(0, 20).map(function (r) {
        return _cand_(r, 'same traveller');
      }),
      note: 'Traveller matches but neither the trip name nor the dates line up.'
    };
  }

  function _cand_(r, reason) {
    return {
      requestId: r.requestId, tripName: r.tripName,
      startDate: r.startDate, endDate: r.endDate,
      estimate: r.amount, owningOffice: r.owningOffice || '',
      reason: reason
    };
  }

  function _daysBetween_(a, b) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 9999;
    return Math.round((Date.parse(b + 'T12:00:00Z') -
                       Date.parse(a + 'T12:00:00Z')) / 86400000);
  }

  /**
   * Matches a whole batch, and summarises it.
   *
   * The summary is the SOP's feedback loop. @clolry asked how to instruct
   * users to put the LETS ID in the Go.gov trip name, and a convention nobody
   * measures decays — so the adoption rate is reported every month, with the
   * travellers who did not follow it named.
   *
   * @param {Array<Object>} expenses
   * @param {Array<Object>} requests
   * @returns {Object}
   */
  function matchBatch(expenses, requests) {
    var results = (expenses || []).map(function (e) {
      var m = matchExpense(e, requests || []);
      return Object.assign({}, e, {
        matchStatus: m.status,
        matchedRequestId: m.requestId,
        matchMethod: m.method,
        matchCandidates: m.candidates,
        matchNote: m.note || ''
      });
    });

    var withId = results.filter(function (r) { return !!r.extractedLetsId; });
    var counts = {};
    results.forEach(function (r) {
      counts[r.matchStatus] = (counts[r.matchStatus] || 0) + 1;
    });

    var byFy = {};
    results.forEach(function (r) {
      var k = r.fiscalYear || 'UNKNOWN';
      byFy[k] = round2((byFy[k] || 0) + r.amountApproved);
    });

    return {
      results: results,
      summary: {
        total: results.length,
        counts: counts,
        autoMatched: counts.AUTO_MATCHED || 0,
        needsReview: counts.NEEDS_REVIEW || 0,
        unmatched: counts.UNMATCHED || 0,
        totalApproved: round2(results.reduce(function (s, r) {
          return s + r.amountApproved;
        }, 0)),
        totalDisallowed: round2(results.reduce(function (s, r) {
          return s + r.disallowedAmount;
        }, 0)),
        // The adoption measurement.
        letsIdPresent: withId.length,
        letsIdAdoptionPct: results.length
          ? Math.round((withId.length / results.length) * 1000) / 10 : 0,
        // Named, so the feedback can be specific rather than a scold.
        missingLetsIdTravellers: _distinct_(results
          .filter(function (r) { return !r.extractedLetsId; })
          .map(function (r) { return r.employeeName; })).slice(0, 50),
        byFiscalYear: byFy,
        // THE CROSS-YEAR WARNING. One export spans two fiscal years, and
        // posting FY2026 travel against FY2027 budgets is the single most
        // expensive mistake available here.
        fiscalYears: Object.keys(byFy).sort()
      }
    };
  }

  function _distinct_(arr) {
    var seen = {};
    return (arr || []).filter(function (x) {
      if (!x || seen[x]) return false;
      seen[x] = true;
      return true;
    });
  }

  return {
    extractLetsId: extractLetsId,
    normalizeName: normalizeName,
    normalizeTitle: normalizeTitle,
    toDateString: toDateString,
    fiscalYearOf: fiscalYearOf,
    currentFiscalYear: currentFiscalYear,
    proposeMapping: proposeMapping,
    parseRequestRows: parseRequestRows,
    parseExpenseRows: parseExpenseRows,
    matchExpense: matchExpense,
    matchBatch: matchBatch,
    round2: round2,
    REQUEST_FIELD_HINTS: REQUEST_FIELD_HINTS,
    EXPENSE_FIELD_HINTS: EXPENSE_FIELD_HINTS
  };
})();
