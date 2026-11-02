/**
 * BudgetDashboard.js
 * Live figures for the Travel Budget & Executive Tracker.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The dashboard was a layout mockup: 34 hardcoded dollar figures, zero server
 * calls, and a "Sync FAS Tracker" button that alerted "Sync complete" without
 * doing anything. Every number on it — the $997,000 baseline, each DAC
 * balance, the set-aside table — was a literal in HTML.
 *
 * @clolry asked for the KPIs next, so this computes them from the database.
 *
 * WHY NOT BudgetEngine.js
 * -----------------------
 * BudgetEngine.js already implements this arithmetic, correctly, in 339 lines.
 * It is not used here, for two reasons that are worth stating because reusing
 * it looks obviously right:
 *
 * 1. IT IS UNREACHABLE. It is a UMD/IIFE factory assigning to
 *    `root.BudgetEngine`, and Apps Script exposes only TOP-LEVEL declarations
 *    to google.script.run. That is finding G-016 — the whole LETS budget layer
 *    is structurally unreachable, not merely unwired.
 *
 * 2. ITS STATUS VOCABULARY DOES NOT EXIST. It filters requests by statuses
 *    like 'Submitted - Pending Budget Check' and 'Reconciled / Actuals
 *    Posted'. The Requests tab stores 'PENDING_SECTOR', 'APPROVED_GOGOV',
 *    'COMPLETED'. The intersection of the two vocabularies is EMPTY — measured
 *    in test_budget_dashboard.js §1. Wired up as-is it would have reported
 *    every DAC at its full baseline with zero commitments, which looks
 *    completely plausible and is completely wrong.
 *
 * So this file reads the live status codes from 01_constants/Status.js and
 * does the arithmetic against those. BudgetEngine.js stays where it is; making
 * it reachable and retranslating its status list is a larger change than this
 * dashboard needs, and doing it badly would produce confident wrong numbers.
 *
 * WHAT IS STILL NOT HERE
 * ----------------------
 * Mid-year budget ADJUSTMENTS. The Budget_Adjustments tab is part of the
 * unreachable LetsDB layer and has never been created, so `totalAllocation`
 * equals `baselineAllocation` on every office. The payload says so via
 * `adjustmentsAvailable: false` rather than implying the baseline is final.
 */

var BudgetDashboard = (function () {

  /** Two decimal places, no float dust. */
  function round2(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
  }

  /**
   * Which statuses count as a COMMITMENT against a DAC's balance.
   *
   * Read from STATUS_GROUPS rather than listed here, so a new status added to
   * the workflow cannot silently fall outside the budget maths.
   *
   * The three groups mean different things to a budget:
   *
   *   PENDING + NEEDS_INFO -> committed. The money is not spent, but it is
   *                           promised, and a DAC that treats it as available
   *                           will overspend.
   *   APPROVED_GOGOV       -> committed. Approved and booked but not yet
   *                           travelled.
   *   COMPLETED            -> actual. Travel happened.
   *   DENIED / CANCELLED   -> neither. The money was never spent.
   *
   * @returns {{committed: Array<string>, actual: Array<string>}}
   */
  function budgetStatusGroups() {
    var committed = []
      .concat(STATUS_GROUPS.PENDING || [])
      .concat(STATUS_GROUPS.NEEDS_INFO || [])
      .concat([STATUS_CODES.APPROVED_GOGOV]);

    return {
      committed: committed,
      // COMPLETED is the only status meaning travel actually happened. LETS
      // has no reconciliation step, so there are no post-travel actuals — the
      // estimate at approval is the best figure available. The payload labels
      // this `estimatedNotReconciled` so the dashboard stops calling it
      // "Posted Actuals", which implied a liquidation step that does not
      // exist.
      actual: [STATUS_CODES.COMPLETED]
    };
  }

  /**
   * Standing set-asides for one office, from BudgetConfig.
   *
   * SELF_FUNDED comes off the owning office alone. ENTERPRISE_SHARED is split
   * across the DACs by proportional share — the Front Office LC gap is
   * $20,000 shared 15.3/66.4/18.3, which is why the mockup showed OMD carrying
   * $3,060 of it.
   *
   * Shares are read from config rather than recomputed from baselines. They
   * are a policy decision that happens to approximate the baseline ratio, and
   * recomputing would silently drift away from the agreed percentages as
   * baselines change.
   *
   * @param {string} officeCode
   * @returns {Object}
   */
  function officeSetAsides(officeCode) {
    var all = (LETS_CONFIG && LETS_CONFIG.defaultSetAsides) || [];
    var office = (LETS_CONFIG && LETS_CONFIG.baselineAllocations &&
                  LETS_CONFIG.baselineAllocations[officeCode]) || {};
    var share = Number(office.standardProportionalShare) || 0;

    var selfFunded = 0;
    var shared = 0;
    var lines = [];

    all.forEach(function (sa) {
      var amount = Number(sa.amount) || 0;

      if (sa.type === 'SELF_FUNDED' && sa.targetOffice === officeCode) {
        selfFunded += amount;
        lines.push({ title: sa.title, type: sa.type, amount: round2(amount) });
        return;
      }

      if (sa.type === 'ENTERPRISE_SHARED' && sa.targetOffice === 'SHARED_DAC') {
        // Only DACs carry the shared burden; the Front Office is the one
        // being covered, so charging it a share would be circular.
        if (!office.isDac) return;
        var portion = amount * share;
        shared += portion;
        lines.push({
          title: sa.title, type: sa.type, amount: round2(portion),
          note: 'your ' + Math.round(share * 1000) / 10 + '% share of $' +
                amount.toLocaleString()
        });
      }
    });

    return {
      selfFunded: round2(selfFunded),
      enterpriseShared: round2(shared),
      total: round2(selfFunded + shared),
      lines: lines
    };
  }

  /**
   * Commitments and actuals per office, from the Requests tab.
   *
   * ATTRIBUTION. A request is attributed by Owning_Office — the budget key
   * (FO/OMD/IDV/CM) the submitter selected. Falls back to deriving it from
   * Owning_Org_Code, because the field was added later and older rows may
   * carry only the org code.
   *
   * A request attributable to NOTHING is counted in `unattributed` rather than
   * dropped. Silently discarding it would make the dashboard's total smaller
   * than reality while every individual DAC row looked correct — the kind of
   * error nobody finds.
   *
   * @param {Object} db TravelDB instance
   * @returns {Object}
   */
  function spendByOffice(db) {
    var groups = budgetStatusGroups();
    var out = {
      byOffice: {},
      unattributed: { committed: 0, actual: 0, count: 0, requestIds: [] },
      requestsRead: 0,
      statusesSeen: {}
    };

    var data;
    try {
      data = db.readSheet(SHEET_NAMES.REQUESTS);
    } catch (e) {
      console.warn('BudgetDashboard: could not read Requests: ' + e.message);
      return out;
    }
    if (!data || !data.headers.length) return out;

    var idx = data.headerIndex;
    function col(n) { return (n in idx) ? idx[n] : -1; }

    // By header NAME, not position. Eighteen places in LETS read positionally
    // and a column insertion silently misfiles them (finding G-014); this is
    // not a nineteenth.
    var cStatus = col('Status');
    var cOffice = col('Owning_Office');
    var cOrgCode = col('Owning_Org_Code');
    var cTotal = col('Grand_Total');
    var cId = col('Request_ID');

    if (cStatus === -1 || cTotal === -1) {
      console.warn('BudgetDashboard: Requests lacks Status or Grand_Total');
      return out;
    }

    // HR org code -> budget key. Same four pairs as Submission.js's
    // LETS_OFFICE_MAP; @clolry: "FCA and OMD are two ways to describe the same
    // thing."
    var ORG_TO_OFFICE = { FC: 'FO', FCA: 'OMD', FCB: 'IDV', FCC: 'CM' };

    data.rows.forEach(function (row) {
      out.requestsRead++;

      var status = String(row[cStatus] || '').trim();
      out.statusesSeen[status] = (out.statusesSeen[status] || 0) + 1;

      var isCommitted = groups.committed.indexOf(status) > -1;
      var isActual = groups.actual.indexOf(status) > -1;
      if (!isCommitted && !isActual) return;    // denied, cancelled, draft

      var amount = parseFloat(row[cTotal]);
      if (isNaN(amount)) amount = 0;

      var office = cOffice > -1 ? String(row[cOffice] || '').trim().toUpperCase() : '';
      if (!office && cOrgCode > -1) {
        var org = String(row[cOrgCode] || '').trim().toUpperCase();
        // Longest prefix, so FCA0A resolves to FCA -> OMD. Sub-org codes are
        // hierarchical and there are 137 of them.
        Object.keys(ORG_TO_OFFICE).forEach(function (k) {
          if (org.indexOf(k) === 0 &&
              (!office || k.length > (office === 'FO' ? 2 : 3))) {
            office = ORG_TO_OFFICE[k];
          }
        });
      }

      var reqId = cId > -1 ? String(row[cId] || '') : '';

      if (!office || !LETS_CONFIG.baselineAllocations[office]) {
        out.unattributed.count++;
        if (isCommitted) out.unattributed.committed += amount;
        if (isActual) out.unattributed.actual += amount;
        if (reqId) out.unattributed.requestIds.push(reqId);
        return;
      }

      if (!out.byOffice[office]) {
        out.byOffice[office] = { committed: 0, actual: 0, committedCount: 0, actualCount: 0 };
      }
      if (isCommitted) {
        out.byOffice[office].committed += amount;
        out.byOffice[office].committedCount++;
      }
      if (isActual) {
        out.byOffice[office].actual += amount;
        out.byOffice[office].actualCount++;
      }
    });

    Object.keys(out.byOffice).forEach(function (k) {
      out.byOffice[k].committed = round2(out.byOffice[k].committed);
      out.byOffice[k].actual = round2(out.byOffice[k].actual);
    });
    out.unattributed.committed = round2(out.unattributed.committed);
    out.unattributed.actual = round2(out.unattributed.actual);

    return out;
  }

  /**
   * Everything the dashboard needs, in one call.
   *
   * @returns {Object} successResponse({ offices, totals, setAsides, meta })
   */
  function getDashboard() {
    try {
      var baselines = (LETS_CONFIG && LETS_CONFIG.baselineAllocations) || {};
      var codes = Object.keys(baselines);

      var db;
      var spend;
      try {
        db = new TravelDB();
        spend = spendByOffice(db);
      } catch (e) {
        // A database that cannot be read must not take the page down: the
        // baselines and set-asides are config and still render. `liveSpend`
        // tells the UI the commitment figures are absent rather than zero.
        console.warn('BudgetDashboard: spend unavailable: ' + e.message);
        spend = { byOffice: {}, unattributed: { committed: 0, actual: 0, count: 0 },
                  requestsRead: 0, statusesSeen: {}, unavailable: e.message };
      }

      var offices = codes.map(function (code) {
        var o = baselines[code];
        var sa = officeSetAsides(code);
        var sp = spend.byOffice[code] || { committed: 0, actual: 0,
                                           committedCount: 0, actualCount: 0 };

        var baseline = round2(o.baselineAmount);
        // No adjustments layer exists, so this equals the baseline today. Kept
        // as a separate field so wiring Budget_Adjustments later does not
        // change the payload shape.
        var totalAllocation = baseline;
        var discretionaryBase = round2(totalAllocation - sa.total);
        var available = round2(discretionaryBase - sp.committed - sp.actual);

        return {
          officeCode: code,
          officeName: o.name,
          // Both namespaces, since the page shows DAC names and the data
          // carries org codes.
          orgCode: ({ FO: 'FC', OMD: 'FCA', IDV: 'FCB', CM: 'FCC' })[code] || '',
          isDac: !!o.isDac,
          baselineAllocation: baseline,
          totalAllocation: totalAllocation,
          proportionalShare: Number(o.standardProportionalShare) || 0,
          setAsides: sa,
          discretionaryBase: discretionaryBase,
          committed: sp.committed,
          committedCount: sp.committedCount,
          completed: sp.actual,
          completedCount: sp.actualCount,
          available: available,
          isDeficit: available < 0,
          // Percentage of the discretionary base already committed. The number
          // a DAC actually reacts to.
          utilisationPct: discretionaryBase > 0
            ? Math.round(((sp.committed + sp.actual) / discretionaryBase) * 1000) / 10
            : null
        };
      });

      var sum = function (f) {
        return round2(offices.reduce(function (s, o) { return s + f(o); }, 0));
      };

      return successResponse({
        offices: offices,
        totals: {
          baseline: sum(function (o) { return o.baselineAllocation; }),
          setAsides: sum(function (o) { return o.setAsides.total; }),
          discretionaryBase: sum(function (o) { return o.discretionaryBase; }),
          committed: sum(function (o) { return o.committed; }),
          completed: sum(function (o) { return o.completed; }),
          available: sum(function (o) { return o.available; }),
          committedCount: offices.reduce(function (s, o) { return s + o.committedCount; }, 0),
          completedCount: offices.reduce(function (s, o) { return s + o.completedCount; }, 0)
        },
        meta: {
          fiscalYear: (LETS_CONFIG && LETS_CONFIG.fiscalYear) || '',
          requestsRead: spend.requestsRead,
          // Flagged, not hidden. A request attributable to no office makes the
          // total smaller than reality while every DAC row looks right.
          unattributed: spend.unattributed,
          liveSpend: !spend.unavailable,
          spendError: spend.unavailable || null,

          // Said in the payload so the UI cannot quietly imply otherwise.
          adjustmentsAvailable: false,
          adjustmentsNote: 'Mid-year budget adjustments are not yet tracked, so ' +
                           'each allocation shown is the FY baseline.',
          actualsNote: 'LETS has no post-travel reconciliation step, so completed ' +
                       'travel is counted at its approved estimate rather than at ' +
                       'a liquidated actual.',
          baselineSource: 'BudgetConfig.js — baseline allocations and standing ' +
                          'set-asides are configuration, not database values.',
          statusesSeen: spend.statusesSeen
        }
      });
    } catch (e) {
      console.error('getBudgetDashboard failed: ' + e.message);
      return errorResponse('Could not build the budget dashboard: ' + e.message);
    }
  }

  return {
    getDashboard: getDashboard,
    budgetStatusGroups: budgetStatusGroups,
    officeSetAsides: officeSetAsides,
    spendByOffice: spendByOffice,
    round2: round2
  };
})();

/**
 * Live budget figures for the Travel Budget & Executive Tracker.
 *
 * Top-level declaration: Apps Script exposes only these to google.script.run,
 * which is why BudgetEngine.js — an IIFE assigning to `root` — is unreachable
 * (finding G-016).
 *
 * @returns {Object} successResponse({ offices, totals, meta })
 * @client
 */
function getBudgetDashboard() {
  return BudgetDashboard.getDashboard();
}
