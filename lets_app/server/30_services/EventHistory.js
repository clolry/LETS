/**
 * EventHistory.js
 * Historical event attendance, for budget planning.
 *
 * WHAT QUESTION THIS ANSWERS
 * --------------------------
 * @clolry: "I want to add a section about historical attendance at events
 * (showing when they are and how many people from which orgs have attended in
 * the past)."
 *
 * A DAC planning next year's travel needs two facts about a conference: WHEN
 * it lands, and HOW MANY people went last time. Both are answerable from
 * occurrence-level history; neither is answerable from a total.
 *
 * ONE AUTHORITATIVE SOURCE FOR HISTORY, DECIDED BY @clolry
 * --------------------------------------------------------
 * 1. HISTORICAL SEED — @clolry's 2024-2026 attendance table. Headcounts,
 *    with no org breakdown and no spend. AUTHORITATIVE for anything before
 *    LETS.
 *
 * 2. LETS REQUESTS — derived from the Requests tab. Carries org breakdown and
 *    cost, and covers only travel submitted through LETS.
 *
 * The FAS Travel Exception Tracker summary is deliberately NOT a source here.
 * It disagreed sharply — CGP Spring Conference at 4 travellers against
 * @clolry's 24 — and @clolry explained why:
 *
 *   "Lets use my table rather than the FAS tracker - while there may have only
 *    been 4 or 5 entries, there were likely multiple people associated with
 *    each row."
 *
 * The tracker counts REQUESTS. The attendance table counts PEOPLE. They were
 * never two measurements of one quantity, so the earlier framing of "two
 * sources that disagree" was wrong: one of them simply does not answer the
 * question a DAC is asking.
 *
 * The two lists are still kept separate rather than summed, because the seed
 * ends where LETS begins and adding them would double-count any overlap. Each
 * occurrence carries its `source`.
 *
 * ON NOT INVENTING THE ORG BREAKDOWN
 * ----------------------------------
 * @clolry asked for attendance "from which orgs". The seeded data has no org
 * detail — it does not exist in the source. Every seeded occurrence therefore
 * reports `orgBreakdown: null`, NOT an empty object, so the UI can say "not
 * recorded" rather than implying nobody attended.
 *
 * That distinction is the whole reason this file is longer than it looks like
 * it should be. "No one from FCB went" and "we do not know who went" are
 * different answers, and a dashboard that confuses them misleads a DAC into
 * thinking they have no history at an event they have been sending people to
 * for three years.
 */

// ============================================================================
// SEED DATA — @clolry, 2024-2026
// ============================================================================
//
// Transcribed from the attendance table @clolry supplied. One entry per event,
// with the months it occurred and the headcount at each.
//
// VERIFIED ON TRANSCRIPTION: every row total and every column total matches
// the stated figures, and the grand total is 187. test_event_history.js §1
// re-checks this against the stated totals rather than trusting the comment.
//
// 'ACT IAC Emerging Tech and Innovation' appears in the source with no
// attendance in any month. It is KEPT, with zero occurrences, because its
// presence in the list is itself information: it is an event ASD tracks and
// did not attend. Dropping it would make it indistinguishable from an event
// nobody has heard of.
var EVENT_HISTORY_SEED = [
  { name: 'CGP Fall Conference',
    occurrences: [{ month: '2024-11', attendees: 15 }, { month: '2026-01', attendees: 5 }] },

  { name: 'Dreamforce',
    occurrences: [{ month: '2024-09', attendees: 6 }] },

  { name: 'ACT IAC Imagine Nation ELC',
    occurrences: [{ month: '2024-10', attendees: 25 }, { month: '2025-12', attendees: 8 }] },

  { name: 'CGP Spring Conference',
    occurrences: [{ month: '2024-05', attendees: 20 }, { month: '2025-06', attendees: 3 },
                  { month: '2026-05', attendees: 1 }] },

  { name: 'NCMA World Congress',
    occurrences: [{ month: '2024-07', attendees: 25 }, { month: '2026-07', attendees: 23 }] },

  { name: 'BIG NTI',
    occurrences: [{ month: '2024-08', attendees: 20 }] },

  { name: 'FEW NTP',
    occurrences: [{ month: '2024-08', attendees: 17 }] },

  { name: 'PA Womens',
    occurrences: [{ month: '2024-11', attendees: 10 }] },

  // Tracked, never attended in the window. See the note above.
  { name: 'ACT IAC Emerging Tech and Innovation',
    occurrences: [] },

  { name: 'NVSBC VETS',
    occurrences: [{ month: '2026-06', attendees: 9 }] }
];

// ============================================================================
// THE TRAVEL RESTRICTION WINDOW
// ============================================================================
//
// @clolry, on being shown NCMA World Congress labelled 'biennial':
//
//   "NCMA is not biennial we just were under a restriction in 2025 where we
//    couldn't send anyone to attend 2025 and most of 2026 were severely
//    limited for travel and events due to the current administration's
//    restrictions."
//
// WHY THIS CONSTANT HAS TO EXIST
// ------------------------------
// Without it the derivation draws two conclusions that are both wrong, and
// both wrong in the direction that loses a DAC money:
//
//   1. CADENCE. NCMA occurred July 2024 and July 2026, so the gap was 24
//      months and the inferred pattern was 'biennial' with a next date of
//      July 2028. The conference is annual. ASD was barred from attending in
//      2025. A DAC reading "biennial, next Jul 2028" does not reserve for
//      July 2027 and misses it.
//
//   2. TREND. Attendance inside the window averages 5.2 against 17.9 outside
//      it. Reported as a trend, that reads as collapsing interest in every
//      conference ASD attends. It is a policy ceiling, and it lifts.
//
// A gap or a low count inside this window is therefore EVIDENCE OF THE
// RESTRICTION, not evidence about the event.
//
// THE WINDOW, AND HOW ITS END WAS CHOSEN
// --------------------------------------
// Start is January 2025 — @clolry: "a restriction in 2025".
//
// End is June 2026, from "most of 2026 were severely limited". The data
// agrees and is unusually clean about it: every occurrence from 2025-01 to
// 2026-06 is in single digits (5, 8, 3, 1, 9), and NCMA's July 2026
// occurrence — the first month outside — came back at 23 against 25 in 2024.
// A window running through the end of 2026 would have to call that near-full
// attendance "restricted", which it plainly was not.
//
// NOT A PRECISE DATE. It approximates a policy, and the boundary month is
// inferred from attendance rather than from a memo. If the real dates are
// known, correct them here — every consumer reads this one constant.
var TRAVEL_RESTRICTION_WINDOWS = [
  {
    id: 'admin-restrictions-2025',
    startMonth: '2025-01',
    endMonth: '2026-06',
    label: 'Administration travel restrictions',
    note: 'ASD was barred from most conference travel from early 2025 through ' +
          'roughly mid-2026. Gaps and low attendance in this period reflect the ' +
          'restriction, not declining interest in the event.'
  }
];

/** Stated totals from the source, for the transcription check in §1. */
var EVENT_HISTORY_SEED_TOTALS = {
  grandTotal: 187,
  byMonth: {
    '2024-05': 20, '2024-07': 25, '2024-08': 37, '2024-09': 6,
    '2024-10': 25, '2024-11': 25, '2025-06': 3, '2025-12': 8,
    '2026-01': 5, '2026-05': 1, '2026-06': 9, '2026-07': 23
  }
};

var EventHistory = (function () {

  // ==========================================================================
  // INTERNAL — dates
  // ==========================================================================

  /**
   * Fiscal year for a YYYY-MM month string.
   *
   * October through September, so November 2024 is FY2025.
   *
   * Written here rather than reused because the two existing implementations
   * are both wrong for this purpose: `'FY Quarter'` in ReviewerDashboard.js
   * labels CALENDAR quarters (finding G-049), and PerDiemGSA's getFiscalYear
   * takes a Date rather than a month string. Budget planning is the one place
   * a calendar-year roll-up would be actively misleading, since a DAC's money
   * expires on 30 September.
   *
   * @param {string} month YYYY-MM
   * @returns {string} e.g. 'FY2025', or '' when unparseable
   */
  function fiscalYearOf(month) {
    var m = String(month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(m)) return '';
    var year = parseInt(m.slice(0, 4), 10);
    var mon = parseInt(m.slice(5, 7), 10);
    if (mon < 1 || mon > 12) return '';
    return 'FY' + (mon >= 10 ? year + 1 : year);
  }

  /** Month name for display. */
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * 'Nov 2024' from '2024-11'.
   * @param {string} month
   * @returns {string}
   */
  function monthLabel(month) {
    var m = String(month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(m)) return m;
    var idx = parseInt(m.slice(5, 7), 10) - 1;
    if (idx < 0 || idx > 11) return m;
    return MONTH_NAMES[idx] + ' ' + m.slice(0, 4);
  }

  /** Current month as YYYY-MM. Injectable so tests are not time-dependent. */
  function currentMonth(now) {
    var d = now || new Date();
    var mon = d.getMonth() + 1;
    return d.getFullYear() + '-' + (mon < 10 ? '0' + mon : String(mon));
  }

  /** Whole months from `from` to `to`. Negative when `to` is earlier. */
  function monthsBetween(from, to) {
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) return null;
    var a = parseInt(from.slice(0, 4), 10) * 12 + parseInt(from.slice(5, 7), 10);
    var b = parseInt(to.slice(0, 4), 10) * 12 + parseInt(to.slice(5, 7), 10);
    return b - a;
  }

  // ==========================================================================
  // RESTRICTION WINDOW
  // ==========================================================================

  /**
   * Restriction label for a month, or null. For embedding in a payload where
   * the whole window object would be repeated 14 times.
   *
   * @param {string} month
   * @returns {string|null}
   */
  function restrictionLabelFor(month) {
    var w = restrictionFor(month);
    return w ? w.label : null;
  }

  /**
   * The restriction window a month falls in, or null.
   *
   * @param {string} month YYYY-MM
   * @returns {Object|null}
   */
  function restrictionFor(month) {
    var m = String(month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(m)) return null;
    for (var i = 0; i < TRAVEL_RESTRICTION_WINDOWS.length; i++) {
      var w = TRAVEL_RESTRICTION_WINDOWS[i];
      if (m >= w.startMonth && m <= w.endMonth) return w;
    }
    return null;
  }

  /**
   * The ANNIVERSARIES skipped between two occurrences, and whether each was
   * blocked by a restriction.
   *
   * WHY ANNIVERSARIES AND NOT MONTHS
   * --------------------------------
   * The first attempt subtracted every restricted MONTH from the gap. That
   * replaced one wrong answer with another: NCMA's 24-month gap minus 18
   * restricted months is 6, which is not annual either. Overcorrecting is not
   * better than undercorrecting, it is just wrong in the other direction.
   *
   * The actual question is narrower. For an annual event, how many times did
   * the anniversary come round and get missed, and was ASD barred from
   * travelling on each of those dates?
   *
   * NCMA: July 2024 to July 2026 skips exactly one anniversary, July 2025,
   * and July 2025 sits inside the restriction window. One skipped cycle,
   * fully explained — so the event is ANNUAL and ASD missed a year.
   *
   * A skipped anniversary with no restriction against it stays unexplained,
   * and the cadence is reported as the data shows it.
   *
   * @param {string} from YYYY-MM
   * @param {string} to YYYY-MM
   * @returns {Array<{month: string, restricted: boolean}>}
   */
  function skippedAnniversaries(from, to) {
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) return [];
    var out = [];
    var y = parseInt(from.slice(0, 4), 10) + 1;
    var mo = from.slice(5, 7);
    var guard = 0;
    while (guard++ < 30) {
      var cur = y + '-' + mo;
      if (cur >= to) break;

      // A DRIFTED occurrence IS the cycle, not a skipped one.
      //
      // @clolry's CGP Spring Conference ran May 2024, June 2025, May 2026. A
      // strict same-month test calls May 2025 a skipped anniversary, then
      // subtracts a full year from a 13-month gap and leaves 1 — turning a
      // plainly annual event into 'irregular'. The conference happened; it
      // just moved by a month.
      //
      // Six months is the threshold because it is the largest drift that
      // cannot be confused with a different cycle: anything closer to the
      // anniversary than half a year is the same instance.
      if (monthsBetween(cur, to) <= 6) break;

      out.push({ month: cur, restricted: !!restrictionFor(cur) });
      y++;
    }
    return out;
  }

  // ==========================================================================
  // RECURRENCE
  // ==========================================================================

  /**
   * Infers when an event next lands, from when it has landed before.
   *
   * WHY DERIVED RATHER THAN STORED
   * ------------------------------
   * A stored "annual, every July" field is a claim that somebody has to keep
   * true. Two July occurrences two years apart are evidence, and evidence does
   * not go stale silently — it just stops being added to, which is visible.
   *
   * WHAT IT WILL AND WILL NOT CLAIM
   * -------------------------------
   * One occurrence is not a pattern. The honest answer there is "attended
   * once, in July 2024", and this returns exactly that rather than predicting
   * next July.
   *
   * Two or more occurrences in the SAME calendar month give a month and a
   * confidence. Occurrences scattered across months give a month range and
   * nothing stronger, because an event that moved from May to June to January
   * is not telling us about next year.
   *
   * @clolry's data has CGP Spring Conference in May 2024, June 2025 and May
   * 2026 — which is 'usually May' rather than 'every May', and the difference
   * matters to someone reserving money for a specific month.
   *
   * @param {Array<{month: string, attendees: number}>} occurrences
   * @returns {Object} { pattern, months[], typicalMonth, confidence, nextExpected }
   */
  function inferRecurrence(occurrences, now) {
    var occ = (occurrences || []).slice().sort(function (a, b) {
      return a.month < b.month ? -1 : (a.month > b.month ? 1 : 0);
    });

    if (!occ.length) {
      return {
        pattern: 'none',
        months: [],
        typicalMonth: null,
        confidence: 'none',
        nextExpected: null,
        note: 'Tracked, but no recorded attendance.'
      };
    }

    if (occ.length === 1) {
      return {
        pattern: 'single',
        months: [parseInt(occ[0].month.slice(5, 7), 10)],
        typicalMonth: parseInt(occ[0].month.slice(5, 7), 10),
        confidence: 'none',
        // Deliberately null. One data point is not a pattern, and offering a
        // prediction from it would be the dashboard inventing a schedule.
        nextExpected: null,
        note: 'Attended once, in ' + monthLabel(occ[0].month) + '. Not enough ' +
              'history to say whether it recurs.'
      };
    }

    var monthNums = occ.map(function (o) { return parseInt(o.month.slice(5, 7), 10); });
    var distinct = {};
    monthNums.forEach(function (m) { distinct[m] = (distinct[m] || 0) + 1; });
    var distinctCount = Object.keys(distinct).length;

    // Modal month, and how dominant it is.
    var modal = monthNums[0];
    var modalHits = 0;
    Object.keys(distinct).forEach(function (m) {
      if (distinct[m] > modalHits) { modalHits = distinct[m]; modal = parseInt(m, 10); }
    });

    var confidence;
    if (distinctCount === 1) {
      confidence = 'high';            // every occurrence in the same month
    } else if (modalHits > 1) {
      confidence = 'medium';          // a dominant month, with drift
    } else {
      confidence = 'low';             // no month repeats at all
    }

    // Next expected occurrence: the modal month, in the first year after the
    // most recent occurrence. Only offered when the month is actually
    // repeating — a 'low' confidence event gets no date.
    // Computed AFTER the gap analysis below, because the step depends on it.
    var nextExpected = null;

    // GAPS, WITH RESTRICTED MONTHS DISCOUNTED.
    //
    // A raw gap measures how long since ASD last attended. That is not the
    // same as how often the event happens, and conflating them produced a
    // wrong answer @clolry had to correct: NCMA World Congress occurred July
    // 2024 and July 2026, a 24-month gap, and was labelled 'biennial' with a
    // next date of July 2028.
    //
    // @clolry: "NCMA is not biennial we just were under a restriction in 2025
    // where we couldn't send anyone to attend 2025."
    //
    // So each gap is reduced by the number of months inside a restriction
    // window. NCMA's 24 months minus the 18 restricted months between its two
    // occurrences leaves 6 — which is no longer biennial, and the 12-month
    // ADJUSTED gap below recovers 'annual'.
    //
    // The raw gap is kept alongside, because the distinction is the finding:
    // the event is annual AND ASD has not attended in two years.
    var gaps = [];
    for (var i = 1; i < occ.length; i++) {
      var rawGap = monthsBetween(occ[i - 1].month, occ[i].month);
      var skipped = skippedAnniversaries(occ[i - 1].month, occ[i].month);
      var blockedCycles = skipped.filter(function (sk) { return sk.restricted; }).length;

      // Each FULLY BLOCKED anniversary removes 12 months from the gap. A
      // skipped year nobody can explain is left in, so the cadence still
      // reports what the data shows.
      gaps.push({
        raw: rawGap,
        skippedAnniversaries: skipped.length,
        blockedCycles: blockedCycles,
        restrictedMonths: skipped.filter(function (sk) { return sk.restricted; })
          .map(function (sk) { return sk.month; }),
        adjusted: Math.max(1, rawGap - blockedCycles * 12)
      });
    }

    var adj = gaps.map(function (g) { return g.adjusted; });
    var annualish = adj.length && adj.every(function (g) { return g >= 10 && g <= 14; });
    // Still recognised, but only when the two-year cadence survives
    // discounting — i.e. the gap was not caused by a travel ban.
    var biennialish = adj.length && adj.every(function (g) { return g >= 22 && g <= 26; });
    var anyRestricted = gaps.some(function (g) { return g.blockedCycles > 0; });

    var pattern = annualish ? 'annual' : (biennialish ? 'biennial' : 'irregular');

    // Next expected occurrence: the modal month, stepped forward by the
    // observed cadence rather than by a hardcoded year. A biennial event
    // predicted one year out would have a DAC reserving money for a
    // conference that is not happening.
    //
    // Offered only when the MONTH repeats. A 'low' confidence event has
    // occurred in three different months, and naming one of them would be the
    // dashboard guessing.
    if (confidence !== 'low') {
      // Steps by the ADJUSTED cadence. Stepping by the raw gap would predict
      // July 2028 for an annual conference ASD was barred from in 2025, and a
      // DAC reading that date does not reserve for July 2027.
      var step = biennialish ? 2 : 1;
      var cm = currentMonth(now);
      var candidateYear = parseInt(occ[occ.length - 1].month.slice(0, 4), 10);
      var guard = 0;
      while (guard++ < 10) {
        var cand = candidateYear + '-' + (modal < 10 ? '0' + modal : String(modal));
        if (monthsBetween(cm, cand) > 0) { nextExpected = cand; break; }
        candidateYear += step;
      }
    }

    return {
      pattern: pattern,
      months: Object.keys(distinct).map(Number).sort(function (a, b) { return a - b; }),
      typicalMonth: modal,
      confidence: confidence,
      nextExpected: nextExpected,
      gapsMonths: gaps.map(function (g) { return g.raw; }),
      gapDetail: gaps,
      // True when a gap spans a travel ban, so the UI can say the absence was
      // imposed rather than letting a planner read it as a lapsed event.
      affectedByRestriction: anyRestricted,
      // Names the missed year explicitly. "Skipped Jul 2025" is actionable;
      // "affected by restrictions" is not.
      skippedDueToRestriction: gaps.reduce(function (acc, g) {
        return acc.concat(g.restrictedMonths);
      }, []),
      restrictionNote: anyRestricted
        ? ('Did not attend ' + gaps.reduce(function (acc, g) {
             return acc.concat(g.restrictedMonths);
           }, []).map(monthLabel).join(', ') + ' — inside the ' +
           TRAVEL_RESTRICTION_WINDOWS[0].label + '. Counted as a skipped year, ' +
           'not a change in how often the event runs.')
        : null,
      note: confidence === 'high'
        ? 'Every recorded occurrence in ' + MONTH_NAMES[modal - 1] +
          (biennialish ? ', about two years apart.' : '.')
        : (confidence === 'medium'
            ? 'Usually ' + MONTH_NAMES[modal - 1] + ', but has moved.'
            : 'No repeating month — has occurred in ' +
              Object.keys(distinct).map(function (m) { return MONTH_NAMES[m - 1]; }).join(', ') +
              '. Treat the month as unsettled.')
    };
  }

  // ==========================================================================
  // TREND
  // ==========================================================================

  /**
   * Direction of travel in headcount.
   *
   * Reported as first-versus-last rather than as a fitted slope: with two or
   * three points a slope implies a precision that is not there, and the
   * planning question is "are we sending fewer people than we used to".
   *
   * THE RESTRICTION CHANGES WHAT THIS MEANS
   * ---------------------------------------
   * The raw numbers fall off a cliff: CGP Spring Conference 20 -> 3 -> 1, ACT
   * IAC ELC 25 -> 8. I first surfaced that as declining interest.
   *
   * @clolry: "most of 2026 were severely limited for travel and events due to
   * the current administration's restrictions."
   *
   * Attendance inside the window averages 5.2 against 17.9 outside it. So the
   * decline is a POLICY CEILING, and a ceiling lifts. A DAC told "attendance
   * is down 95%" plans for one traveller next May; a DAC told "last normal
   * year was 20, and the two readings since were under a travel ban" plans
   * for something near 20.
   *
   * Both are reported. `direction` stays honest about the raw numbers, and
   * `planningBaseline` carries the last unrestricted figure — which is the
   * one worth reserving against.
   *
   * @param {Array} occurrences sorted ascending
   * @returns {Object|null} null when fewer than two occurrences
   */
  function attendanceTrend(occurrences) {
    var occ = (occurrences || []).slice().sort(function (a, b) {
      return a.month < b.month ? -1 : 1;
    });
    if (occ.length < 2) return null;

    var first = occ[0];
    var last = occ[occ.length - 1];
    var delta = last.attendees - first.attendees;
    var pct = first.attendees ? Math.round((delta / first.attendees) * 100) : null;

    // Occurrences outside any restriction window: the only ones that say
    // anything about demand for the event.
    var unrestricted = occ.filter(function (o) { return !restrictionFor(o.month); });
    var restricted = occ.filter(function (o) { return !!restrictionFor(o.month); });

    // The figure a DAC should reserve against. Most recent unrestricted
    // reading, falling back to the most recent of any kind — with
    // `planningBaselineIsRestricted` saying which, so the UI never presents a
    // ban-suppressed number as a normal one.
    var baselineOcc = unrestricted.length
      ? unrestricted[unrestricted.length - 1]
      : last;

    // Trend ACROSS unrestricted readings only. Two normal years tell you
    // whether interest is really moving; a normal year against a banned year
    // tells you only that there was a ban.
    var unrestrictedTrend = null;
    if (unrestricted.length >= 2) {
      var uf = unrestricted[0];
      var ul = unrestricted[unrestricted.length - 1];
      var ud = ul.attendees - uf.attendees;
      unrestrictedTrend = {
        firstMonth: uf.month,
        firstAttendees: uf.attendees,
        lastMonth: ul.month,
        lastAttendees: ul.attendees,
        delta: ud,
        percentChange: uf.attendees ? Math.round((ud / uf.attendees) * 100) : null,
        direction: ud > 0 ? 'up' : (ud < 0 ? 'down' : 'flat')
      };
    }

    return {
      firstMonth: first.month,
      firstAttendees: first.attendees,
      lastMonth: last.month,
      lastAttendees: last.attendees,
      delta: delta,
      percentChange: pct,
      direction: delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat'),

      // Peak matters separately: an event that went 20 -> 3 -> 1 has a
      // meaningfully different story from one that went 1 -> 3 -> 20, and
      // first-vs-last alone cannot tell them apart when the ends match.
      peakAttendees: occ.reduce(function (m, o) { return Math.max(m, o.attendees); }, 0),
      peakMonth: occ.reduce(function (best, o) {
        return o.attendees > best.attendees ? o : best;
      }, occ[0]).month,

      restrictedOccurrences: restricted.map(function (o) { return o.month; }),
      unrestrictedCount: unrestricted.length,
      // When every reading since the first is ban-era, the apparent decline
      // says nothing about the event at all.
      declineExplainedByRestriction: restricted.length > 0 && delta < 0 &&
        !!restrictionFor(last.month),
      unrestrictedTrend: unrestrictedTrend,

      planningBaseline: baselineOcc.attendees,
      planningBaselineMonth: baselineOcc.month,
      planningBaselineIsRestricted: !!restrictionFor(baselineOcc.month)
    };
  }

  // ==========================================================================
  // SEED EXPANSION
  // ==========================================================================

  /** Stable slug for an occurrence ID. */
  function slugify(name) {
    return String(name || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  /**
   * EVENT_HISTORY_SEED -> one record per occurrence.
   *
   * orgBreakdown is NULL, not {}. The seeded figures are totals; the org
   * detail does not exist in the source, and an empty object would read as
   * "nobody from anywhere attended".
   *
   * @returns {Array<Object>}
   */
  function seedOccurrences() {
    var out = [];
    EVENT_HISTORY_SEED.forEach(function (ev) {
      ev.occurrences.forEach(function (o) {
        out.push({
          occurrenceId: 'evt_' + slugify(ev.name) + '_' + o.month,
          eventName: ev.name,
          eventMonth: o.month,
          fiscalYear: fiscalYearOf(o.month),
          attendeeCount: o.attendees,
          // Marked at the occurrence so the UI can flag the individual
          // reading, not just the event. A 2026-05 figure of 1 is not a
          // measurement of demand.
          restriction: restrictionLabelFor(o.month),
          orgBreakdown: null,          // not recorded — see above
          totalEstSpend: null,         // not recorded
          location: '',
          primaryPurpose: '',
          source: 'historical-seed',
          requestIds: [],
          notes: ''
        });
      });
    });
    return out;
  }

  // ==========================================================================
  // LETS REQUEST DERIVATION
  // ==========================================================================

  /**
   * Occurrences derived from LETS's own Requests tab.
   *
   * This is where the org breakdown comes from: Requests carries
   * Traveler_Org_Codes per request, which the seeded history does not have.
   *
   * SCOPE CAVEAT, which the UI must carry through: this covers only travel
   * submitted through LETS. It is not comparable to the seeded figures and is
   * not merged into them.
   *
   * Requests are grouped by TRIP NAME, normalized. That is imperfect — @clolry
   * s FAS tracker summary shows the same conference appearing as "Federal
   * Networks 2026" and "CORRECTION: Federal Networks 2026" — so a prefix like
   * CORRECTION or REVISED is stripped before grouping. Anything subtler than
   * that needs a human, and inventing a fuzzy match would silently merge two
   * genuinely different events.
   *
   * @param {Object} db a TravelDB instance
   * @returns {Array<Object>}
   */
  function requestOccurrences(db) {
    var sheetData;
    try {
      sheetData = db.readSheet(SHEET_NAMES.REQUESTS);
    } catch (e) {
      console.warn('EventHistory: could not read Requests: ' + e.message);
      return [];
    }
    if (!sheetData || !sheetData.headers.length) return [];

    var idx = sheetData.headerIndex;
    function col(name) { return (name in idx) ? idx[name] : -1; }

    var cName = col('Trip_Name');
    var cStart = col('Event_Start_Date');
    var cStatus = col('Status');
    var cCount = col('Traveler_Count');
    var cOrgs = col('Traveler_Org_Codes');
    var cTotal = col('Grand_Total');
    var cId = col('Request_ID');
    var cOwning = col('Owning_Org_Code');

    // Resolved by header NAME above, so a column insertion does not misfile
    // this (docs/DATA_DICTIONARY.md §3.9, finding G-014). A missing column
    // yields -1 and is skipped rather than reading position 0 by accident.
    if (cName === -1 || cStart === -1) {
      console.warn('EventHistory: Requests lacks Trip_Name or Event_Start_Date');
      return [];
    }

    var groups = {};
    sheetData.rows.forEach(function (row) {
      var status = cStatus > -1 ? String(row[cStatus] || '').toUpperCase() : '';
      // Only travel that actually happened or is going to. A denied or draft
      // request is not attendance, and counting it would inflate history with
      // trips nobody took.
      if (status && ['DENIED', 'CANCELLED', 'DRAFT', 'WITHDRAWN'].indexOf(status) > -1) return;

      var name = normalizeEventName(row[cName]);
      if (!name) return;

      var month = monthOfDate(row[cStart]);
      if (!month) return;

      var key = name + '|' + month;
      if (!groups[key]) {
        groups[key] = {
          occurrenceId: 'req_' + slugify(name) + '_' + month,
          eventName: name,
          eventMonth: month,
          fiscalYear: fiscalYearOf(month),
          attendeeCount: 0,
          orgBreakdown: {},
          totalEstSpend: 0,
          location: '',
          primaryPurpose: '',
          source: 'lets-requests',
          requestIds: [],
          notes: ''
        };
      }
      var g = groups[key];

      var n = cCount > -1 ? parseInt(row[cCount], 10) : 0;
      g.attendeeCount += isNaN(n) ? 0 : n;

      var spend = cTotal > -1 ? parseFloat(row[cTotal]) : 0;
      if (!isNaN(spend)) g.totalEstSpend += spend;

      if (cId > -1 && row[cId]) g.requestIds.push(String(row[cId]));

      // Traveler_Org_Codes is a comma-separated list, one entry per traveller.
      // Falls back to the owning org when it is blank, so a request still
      // attributes somewhere rather than vanishing from the breakdown.
      var orgsRaw = cOrgs > -1 ? String(row[cOrgs] || '') : '';
      var codes = orgsRaw.split(',').map(function (c) { return c.trim().toUpperCase(); })
        .filter(Boolean);
      if (!codes.length && cOwning > -1 && row[cOwning]) {
        codes = [String(row[cOwning]).trim().toUpperCase()];
      }
      codes.forEach(function (c) {
        g.orgBreakdown[c] = (g.orgBreakdown[c] || 0) + 1;
      });
    });

    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      // An all-blank breakdown is unknown, not zero. Same rule as the seeded
      // rows: a request with no Traveler_Org_Codes and no Owning_Org_Code
      // tells us nothing about which org went.
      if (!Object.keys(g.orgBreakdown).length) g.orgBreakdown = null;
      if (!g.totalEstSpend) g.totalEstSpend = null;
      return g;
    });
  }

  /**
   * Normalizes a trip name for grouping.
   *
   * Strips correction prefixes, which @clolry's FAS tracker summary shows are
   * real: "CORRECTION: Federal Networks 2026" and "Federal Networks 2026" are
   * the same conference. Deliberately conservative — only prefixes that are
   * unambiguously editorial, never fuzzy similarity, because merging two
   * genuinely different events is worse than listing one twice.
   *
   * @param {*} raw
   * @returns {string}
   */
  function normalizeEventName(raw) {
    var s = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!s) return '';
    // Repeated because "CORRECTION REVISED TRAVEL DATES: ..." appears in the
    // source data.
    var prev = null;
    var guard = 0;
    while (s !== prev && guard++ < 5) {
      prev = s;
      s = s.replace(/^(CORRECTION|REVISED|REVISION|UPDATED|UPDATE|CORRECTED)\b[\s:–-]*/i, '')
           .replace(/^REVISED TRAVEL DATES\b[\s:–-]*/i, '')
           .replace(/^TRAVEL DATES\b[\s:–-]*/i, '')
           .trim();
    }
    return s;
  }

  /** YYYY-MM from a Date or a date-ish string. '' when unparseable. */
  function monthOfDate(v) {
    if (!v) return '';
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    var mon = d.getMonth() + 1;
    return d.getFullYear() + '-' + (mon < 10 ? '0' + mon : String(mon));
  }

  // ==========================================================================
  // PUBLIC
  // ==========================================================================

  /**
   * Events, each with their occurrences, recurrence and trend.
   *
   * Seeded history and LETS-derived history are kept in SEPARATE occurrence
   * lists on the same event, never summed. They measure different populations
   * — @clolry's table is ASD-wide, LETS covers only what was submitted through
   * it — and a combined figure would describe neither.
   *
   * @param {Object} [options] { now } injectable clock for tests
   * @returns {Object} { success, data: { events[], summary }, error? }
   */
  function getEventHistory(options) {
    options = options || {};
    var now = options.now || new Date();

    try {
      var byName = {};

      function ensure(name) {
        if (!byName[name]) {
          byName[name] = {
            eventName: name,
            historical: [],
            letsDerived: [],
            orgBreakdown: null,
            orgBreakdownSource: 'none'
          };
        }
        return byName[name];
      }

      // Register EVERY seeded event by name first, including the one with no
      // occurrences. 'ACT IAC Emerging Tech and Innovation' appears in
      // @clolry's table with no attendance in any month, and its presence is
      // information: it is an event ASD tracks and did not attend. Building
      // the index from occurrences alone silently dropped it, which made it
      // indistinguishable from an event nobody has heard of.
      EVENT_HISTORY_SEED.forEach(function (ev) { ensure(ev.name); });

      seedOccurrences().forEach(function (o) {
        ensure(o.eventName).historical.push(o);
      });

      // LETS-derived occurrences are additive and optional: the dashboard must
      // still render from seed data alone on a database where no requests have
      // been submitted yet.
      var derived = [];
      try {
        derived = requestOccurrences(new TravelDB());
      } catch (e) {
        console.warn('EventHistory: request derivation skipped: ' + e.message);
      }
      derived.forEach(function (o) {
        ensure(o.eventName).letsDerived.push(o);
      });

      var events = Object.keys(byName).map(function (name) {
        var ev = byName[name];

        var sortOcc = function (a, b) { return a.eventMonth < b.eventMonth ? -1 : 1; };
        ev.historical.sort(sortOcc);
        ev.letsDerived.sort(sortOcc);

        // Recurrence uses EVERY known occurrence regardless of source: the
        // question is when the event happens, and that does not depend on
        // which system recorded it.
        var allMonths = {};
        ev.historical.concat(ev.letsDerived).forEach(function (o) {
          allMonths[o.eventMonth] = Math.max(allMonths[o.eventMonth] || 0, o.attendeeCount);
        });
        var merged = Object.keys(allMonths).sort().map(function (m) {
          return { month: m, attendees: allMonths[m] };
        });

        // Org breakdown comes ONLY from LETS, because only LETS records it.
        var orgTotals = {};
        var sawAny = false;
        ev.letsDerived.forEach(function (o) {
          if (!o.orgBreakdown) return;
          sawAny = true;
          Object.keys(o.orgBreakdown).forEach(function (c) {
            orgTotals[c] = (orgTotals[c] || 0) + o.orgBreakdown[c];
          });
        });

        return {
          eventName: name,
          historical: ev.historical,
          letsDerived: ev.letsDerived,
          occurrenceMonths: merged.map(function (m) { return m.month; }),
          totalHistoricalAttendees: ev.historical.reduce(function (s, o) {
            return s + o.attendeeCount;
          }, 0),
          totalLetsAttendees: ev.letsDerived.reduce(function (s, o) {
            return s + o.attendeeCount;
          }, 0),
          recurrence: inferRecurrence(merged, now),
          trend: attendanceTrend(merged),
          // null, not {}. The UI must say "not recorded" rather than implying
          // no one attended.
          orgBreakdown: sawAny ? orgTotals : null,
          orgBreakdownSource: sawAny ? 'lets-requests' : 'none'
        };
      });

      // Biggest history first: that is what a planner scans for.
      events.sort(function (a, b) {
        var at = a.totalHistoricalAttendees + a.totalLetsAttendees;
        var bt = b.totalHistoricalAttendees + b.totalLetsAttendees;
        if (bt !== at) return bt - at;
        return a.eventName.localeCompare(b.eventName);
      });

      var byFy = {};
      events.forEach(function (ev) {
        ev.historical.forEach(function (o) {
          byFy[o.fiscalYear] = (byFy[o.fiscalYear] || 0) + o.attendeeCount;
        });
      });

      return successResponse({
        events: events,
        summary: {
          eventCount: events.length,
          historicalAttendees: events.reduce(function (s, e) {
            return s + e.totalHistoricalAttendees;
          }, 0),
          letsAttendees: events.reduce(function (s, e) { return s + e.totalLetsAttendees; }, 0),
          attendeesByFiscalYear: byFy,
          // Stated plainly in the payload so the UI is not left to infer it.
          sourceNote: 'Attendance for 2024-2026 is ASD-wide headcount and carries ' +
                      'no org breakdown — that detail was never recorded, and is ' +
                      'being collected from here on for travel submitted through ' +
                      'LETS. Figures from 2025 to mid-2026 sit inside the ' +
                      'administration travel restrictions and are not a guide to ' +
                      'normal demand.',
          restrictionWindows: TRAVEL_RESTRICTION_WINDOWS,
          // Named so the dashboard can say which events have a usable baseline
          // and which only have ban-era readings.
          eventsAffectedByRestriction: events.filter(function (e) {
            return e.recurrence && e.recurrence.affectedByRestriction;
          }).length,
          eventsWithoutOrgDetail: events.filter(function (e) {
            return !e.orgBreakdown;
          }).length
        }
      });
    } catch (e) {
      console.error('getEventHistory failed: ' + e.message);
      return errorResponse('Could not build event history: ' + e.message);
    }
  }

  return {
    getEventHistory: getEventHistory,

    // Exposed for test_event_history.js.
    fiscalYearOf: fiscalYearOf,
    monthLabel: monthLabel,
    monthsBetween: monthsBetween,
    inferRecurrence: inferRecurrence,
    restrictionFor: restrictionFor,
    skippedAnniversaries: skippedAnniversaries,
    attendanceTrend: attendanceTrend,
    seedOccurrences: seedOccurrences,
    requestOccurrences: requestOccurrences,
    normalizeEventName: normalizeEventName,
    monthOfDate: monthOfDate,
    slugify: slugify
  };
})();

/**
 * Historical event attendance, for the budget dashboard.
 *
 * @returns {Object} successResponse({ events, summary })
 * @client
 */
function getTravelEventHistory() {
  return EventHistory.getEventHistory();
}
