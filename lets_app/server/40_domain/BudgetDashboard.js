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
   *                           traveled.
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
   * Allocations in force, from the database when available.
   *
   * @clolry asked for an admin UI to set these per year and mid-year, so the
   * figures no longer live in BudgetConfig.js. BudgetAdmin.currentAllocations
   * returns the row with the latest Effective_Date not in the future, falling
   * back to the config literals when no rows exist yet.
   *
   * The `source` it reports is carried into the payload rather than smoothed
   * over: an unconfirmed fallback figure must not look like one an admin set.
   *
   * @returns {Object} { byOffice, source, fiscalYear }
   */
  function allocations() {
    if (typeof BudgetAdmin === 'undefined') {
      // Defensive: Apps Script load order is alphabetical within a directory,
      // and a missing file here would otherwise be a blank dashboard rather
      // than a stated error.
      console.warn('BudgetDashboard: BudgetAdmin unavailable; using config baselines');
      return null;
    }
    try {
      return BudgetAdmin.currentAllocations();
    } catch (e) {
      console.warn('BudgetDashboard: allocation read failed: ' + e.message);
      return null;
    }
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
   * THE AMOUNT MAY BE OVERRIDDEN BY A SCRIPT PROPERTY. A line carrying
   * `amountPropertyKey` resolves through getSetAsideAmountOverride, so
   * @clolry can move the FC senior advisor figure without a deploy. Resolved
   * HERE rather than in BudgetConfig.js because that file is evaluated before
   * any user code on every execution and must not depend on
   * PropertiesService — see the `var LETS_CONFIG` note there.
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
    // Totalled by group so the dashboard can show "DAC-specific", "shared
    // leadership" and "event plan" separately, the way @clolry's FY27 sheet
    // does. A single total hides which of the three moved.
    var byGroup = {};

    all.forEach(function (sa) {
      var amount = setAsideAmount(sa);
      var group = sa.group || 'OTHER';

      function record(value, note) {
        if (!byGroup[group]) byGroup[group] = 0;
        byGroup[group] = round2(byGroup[group] + value);
        var line = {
          id: sa.id,
          title: sa.title,
          group: group,
          type: sa.type,
          amount: round2(value)
        };
        if (note) line.note = note;
        // Carried so the FO row can show what is funded ON ITS BEHALF without
        // charging it. Not every line has one.
        if (sa.benefitsOffice) line.benefitsOffice = sa.benefitsOffice;
        if (sa.quarter) line.quarter = sa.quarter;
        if (sa.amountPropertyKey) {
          line.configurable = true;
          line.amountPropertyKey = sa.amountPropertyKey;
          line.isOverridden = round2(value) !== round2(Number(sa.amount) || 0);
        }
        lines.push(line);
      }

      if (sa.type === 'SELF_FUNDED' && sa.targetOffice === officeCode) {
        selfFunded += amount;
        record(amount);
        return;
      }

      if (sa.type === 'ENTERPRISE_SHARED' && sa.targetOffice === 'SHARED_DAC') {
        // Only DACs carry the shared burden; the Front Office is the one
        // being covered, so charging it a share would be circular.
        if (!office.isDac) return;
        var portion = amount * share;
        shared += portion;
        record(portion,
               'your ' + Math.round(share * 1000) / 10 + '% share of $' +
               amount.toLocaleString());
      }

      // FUNDED_FROM_RELEASES IS CHARGED TO NOBODY. Falling through here is the
      // behavior, not an omission: the money comes from reservations that
      // were already taken out of a DAC's budget for an event that did not
      // happen, so charging it again would take the same money twice.
      //
      // This is the mechanism that restores $444,500 of discretionary funds.
      // The advisor line was ENTERPRISE_SHARED at $48,000 and cost the DACs
      // $7,344 / $31,872 / $8,784; it now costs them nothing.
      //
      // Asserted in test_budget_dashboard.js §2 — if a future edit makes this
      // type chargeable, every DAC balance moves and the test fails.
    });

    return {
      selfFunded: round2(selfFunded),
      enterpriseShared: round2(shared),
      total: round2(selfFunded + shared),
      byGroup: byGroup,
      lines: lines
    };
  }

  /**
   * One set-aside's dollar amount, with a Script Property override applied.
   *
   * Falls back to the configured literal when the property is unset, when
   * Props.js is unavailable (it is a separate file and Apps Script load order
   * is alphabetical by directory), or when the override is unusable. A budget
   * figure must never render as blank or zero because a lookup failed.
   *
   * @param {Object} sa a defaultSetAsides entry
   * @returns {number}
   */
  function setAsideAmount(sa) {
    var configured = Number(sa && sa.amount) || 0;
    if (!sa || !sa.amountPropertyKey) return configured;
    if (typeof getSetAsideAmountOverride !== 'function') return configured;
    try {
      return getSetAsideAmountOverride(sa.amountPropertyKey, configured);
    } catch (e) {
      console.warn('BudgetDashboard: override lookup failed for ' +
                   sa.amountPropertyKey + ': ' + e.message);
      return configured;
    }
  }

  /**
   * What an office has funded FOR it by others, as distinct from its own
   * baseline.
   *
   * The Front Office's $4,000 baseline understates its position by a factor of
   * 18: the DACs fund its $20,000 LC gap and its $48,000 senior-advisor
   * travel, so FO can actually spend $72,000. @clolry asked for the dashboard
   * to show the funded-in total rather than the baseline, because a reader
   * seeing $4,000 draws the wrong conclusion about whether FO is funded.
   *
   * This is NOT added to the office's own allocation. It is a separate figure
   * with its own label, because the money is still charged to the three DACs
   * and double-counting it would overstate the ASD total by $68,000.
   *
   * @param {string} officeCode
   * @returns {{total: number, lines: Array}}
   */
  function fundedInFor(officeCode) {
    var all = (LETS_CONFIG && LETS_CONFIG.defaultSetAsides) || [];
    var total = 0;
    var lines = [];

    all.forEach(function (sa) {
      if (sa.benefitsOffice !== officeCode) return;

      // A FUNDED_FROM_RELEASES line carries amount 0 in config, because the
      // money comes from released reservations rather than from a charge. Its
      // config amount must NOT be summed as funded-in — doing so would report
      // $0 of advisor travel as funded when $48,000 is expected. What has
      // actually been released is a data question, answered by
      // releaseFundingFor below and reported separately.
      if (sa.type === 'FUNDED_FROM_RELEASES') {
        lines.push({
          id: sa.id,
          title: sa.title,
          amount: 0,
          fundedBy: 'RELEASED_SET_ASIDES',
          isSelfFunded: false,
          fundedFromReleases: true,
          expectedCost: round2(sa.expectedAnnualCost)
        });
        return;
      }

      var amount = setAsideAmount(sa);
      total += amount;
      lines.push({
        id: sa.id,
        title: sa.title,
        amount: round2(amount),
        // Who pays. 'SHARED_DAC' means the three DACs by proportional share;
        // an office code means that office funds it itself.
        fundedBy: sa.targetOffice,
        isSelfFunded: sa.type === 'SELF_FUNDED'
      });
    });

    return { total: round2(total), lines: lines };
  }

  /**
   * Funding status of every set-aside paid for out of released reservations.
   *
   * The FC senior advisor is the only one today. The Chief of Staff refused to
   * charge its $48,000 to the DACs — @clolry: "he does not want to take
   * additional funds from the orgs" — so it is funded by releasing Q1 event
   * reservations that were not used.
   *
   * WHY THE DASHBOARD HAS TO SHOW THIS AT ALL
   * -----------------------------------------
   * Because the config line is $0. Without this block the advisor's travel
   * appears against a $0 reservation, which reads as "no budget needed"
   * rather than "budget expected from somewhere else". A traveler booking
   * against it would see no constraint, and nobody would notice the money had
   * never actually been released.
   *
   * So this reports expected vs released vs shortfall. A shortfall is a real
   * condition — the decision to fund from releases does not itself release
   * anything — and it is surfaced rather than smoothed over.
   *
   * @returns {{available: boolean, lines: Array, note: string}}
   */
  function releaseFundingFor() {
    var out = { available: false, lines: [], note: '' };
    var all = (LETS_CONFIG && LETS_CONFIG.defaultSetAsides) || [];
    var expecting = all.filter(function (sa) {
      return sa.type === 'FUNDED_FROM_RELEASES';
    });
    if (!expecting.length) return out;

    if (typeof SetAsideRelease === 'undefined' || typeof Events === 'undefined') {
      out.note = 'Release records are unavailable, so funding for these lines ' +
                 'cannot be confirmed.';
      out.lines = expecting.map(function (sa) {
        return {
          id: sa.id, title: sa.title,
          expectedCost: round2(sa.expectedAnnualCost),
          releasedTotal: null, shortfall: null, isFullyFunded: false,
          releases: []
        };
      });
      return out;
    }

    var releases = [];
    try {
      var db = new TravelDB();
      releases = SetAsideRelease.readReleases(Events.readSetAsides(db));
    } catch (e) {
      // Same reasoning as the spend read: an unreadable sheet must not blank
      // the page, but "unknown" and "zero" are different claims and the note
      // says which this is.
      console.warn('BudgetDashboard: release records unavailable: ' + e.message);
      out.note = 'Release records could not be read: ' + e.message;
    }

    out.lines = expecting.map(function (sa) {
      var f = SetAsideRelease.fundingFor(sa.id, releases,
                                         round2(sa.expectedAnnualCost));
      return {
        id: sa.id,
        title: sa.title,
        benefitsOffice: sa.benefitsOffice || '',
        expectedCost: f.expectedCost,
        releasedTotal: f.releasedTotal,
        shortfall: f.shortfall,
        isFullyFunded: f.isFullyFunded,
        releases: f.releases
      };
    });

    out.available = true;
    if (!out.note) {
      out.note = 'These lines are funded by releasing reservations from events ' +
                 'that did not happen, NOT by a charge against the DACs — so ' +
                 'they do not reduce any discretionary balance. A shortfall ' +
                 'means the money has not been released yet.';
    }
    return out;
  }


  /**
   * Splits each DAC's discretionary balance across its service centers by
   * filled headcount.
   *
   * @clolry: "my priority right now is getting to the point where I can show
   * each service center's budget (based on per-capita/proportionate
   * distribution of their org's budget)."
   *
   * WHY HEADCOUNT HERE, WHEN THE DAC SPLIT USES FIXED PERCENTAGES
   * -------------------------------------------------------------
   * Two different questions. The 15.3/66.4/18.3 split answers "how do the
   * three DACs share an enterprise cost", and that is agreed policy derived
   * from the baselines. This answers "how much of a DAC's own money belongs to
   * each of its service centers", and there is no agreed policy — headcount is
   * the proxy, because the thing being funded is people traveling.
   *
   * The dashboard therefore shows two different proportionality rules at once.
   * That is deliberate and the payload labels both, because a reader who
   * assumes one rule applies throughout will not be able to reconcile the
   * numbers.
   *
   * FILLED, NOT AUTHORIZED
   * ----------------------
   * @clolry's choice: a vacant seat does not travel. Both counts ride along in
   * the payload so the basis is auditable rather than asserted — the
   * difference is large and uneven, and on the real roster FCC0B is 9 filled
   * against 8 vacant.
   *
   * ROUNDING: LARGEST REMAINDER, NOT round2 PER ROW
   * -----------------------------------------------
   * 26 shares of a dollar figure will not sum to it. Rounding each row
   * independently leaves the service-center column short of the DAC total by
   * up to 13 cents, and a dashboard whose column does not add up is assumed
   * wrong in full. So this allocates whole CENTS by truncation and hands the
   * shortfall out one cent at a time, largest share first — the method used
   * for apportioning seats. Every DAC's rows sum to its discretionary balance
   * EXACTLY, asserted in test_budget_per_capita.js §4.
   *
   * KEYED ON ORG CODE THROUGHOUT
   * ----------------------------
   * 'Acquisition Service Center 1' is both FCBAB and FCBBA. Nothing here keys,
   * groups, matches or sorts on a name; `displayName` is passed through for
   * rendering and is never read back. §2 of the test asserts it.
   *
   * @param {Array} offices the office rows already built by getDashboard
   * @param {Array} [positions] pre-fetched HC bundle
   * @param {Object} [scSpend] per-service-center spend from spendByServiceCenter
   * @returns {Object} { rows, byDac, basis, headcountSource, available, note }
   */
  function serviceCenterAllocations(offices, positions, scSpend) {
    scSpend = scSpend || { byOrgCode: {}, dacLevel: {} };

    var out = {
      rows: [],
      byDac: {},
      basis: 'FILLED',
      headcountSource: '',
      available: false,
      note: ''
    };

    if (typeof HC === 'undefined' || !HC || typeof HC.hcServiceCenterHeadcount !== 'function') {
      out.note = 'HR position data is unavailable, so per-service-center ' +
                 'figures cannot be computed.';
      return out;
    }

    var hc;
    try {
      hc = HC.hcServiceCenterHeadcount(positions);
    } catch (e) {
      console.warn('BudgetDashboard: headcount read failed: ' + e.message);
      out.note = 'HR position data could not be read: ' + e.message;
      return out;
    }

    if (!hc.success) {
      out.note = 'HR position data could not be read: ' +
                 (hc.error || 'unknown error');
      return out;
    }
    if (!hc.counted) {
      out.note = 'No HR positions are loaded, so there is no headcount to ' +
                 'divide by. Import the roster first.';
      return out;
    }

    // Office code <- DAC org code. Built from the office rows rather than
    // hardcoded, so it cannot disagree with them.
    var officeByOrg = {};
    offices.forEach(function (o) {
      if (o.orgCode) officeByOrg[o.orgCode] = o;
    });

    // Group the headcount buckets by DAC org code.
    var buckets = {};
    Object.keys(hc.byOrgCode).forEach(function (key) {
      var b = hc.byOrgCode[key];
      if (!buckets[b.dacOrgCode]) buckets[b.dacOrgCode] = [];
      buckets[b.dacOrgCode].push(b);
    });

    Object.keys(buckets).forEach(function (dacOrg) {
      var office = officeByOrg[dacOrg];
      if (!office) {
        // A DAC with staff but no budget pool. Not dropped silently: the note
        // says so, because the alternative is a headcount that vanishes.
        out.note = (out.note ? out.note + ' ' : '') +
                   'Org ' + dacOrg + ' has staff but no budget pool.';
        return;
      }

      var list = buckets[dacOrg];
      var denominator = list.reduce(function (s, b) { return s + b.filled; }, 0);

      // A DAC whose every seat is vacant cannot be divided by headcount. Zero
      // rows rather than a division by zero, and the reason is stated.
      if (!denominator) {
        out.byDac[dacOrg] = {
          officeCode: office.officeCode,
          pool: office.discretionaryBase,
          filled: 0,
          authorized: list.reduce(function (s, b) { return s + b.authorized; }, 0),
          allocated: 0,
          note: 'Every position in this DAC is vacant, so there is no filled ' +
                'headcount to divide by.'
        };
        return;
      }

      // The pool is the DISCRETIONARY BASE — baseline minus set-asides — and
      // NOT `available`.
      //
      // This is the one choice in this function that would be easy to get
      // wrong and impossible to see. `available` is already net of the DAC's
      // whole spend, so dividing it per capita and then ALSO subtracting each
      // center's own spend below would charge every center twice: once
      // through its own rows and again through its share of its siblings'.
      // Dividing the discretionary base and subtracting per-center spend
      // gives each center an allocation it can reconcile against its own
      // requests.
      var pool = office.discretionaryBase;
      var poolCents = Math.round(pool * 100);

      // Truncate to whole cents, then distribute the shortfall.
      var alloc = list.map(function (b) {
        var exact = poolCents * b.filled / denominator;
        return {
          bucket: b,
          cents: Math.floor(exact),
          // Kept for the tie-break below. Two centers with the same fractional
          // part must not have the extra cent assigned by object key order,
          // which is not stable across engines.
          frac: exact - Math.floor(exact)
        };
      });

      var short = poolCents - alloc.reduce(function (s, a) { return s + a.cents; }, 0);

      // Largest fractional part first; ties broken by headcount, then by org
      // code so the result is deterministic. A negative pool (a DAC whose
      // set-asides exceed its baseline) truncates toward -Infinity, so
      // `short` is still >= 0 and the same loop works.
      var order = alloc.slice().sort(function (a, b) {
        if (b.frac !== a.frac) return b.frac - a.frac;
        if (b.bucket.filled !== a.bucket.filled) return b.bucket.filled - a.bucket.filled;
        return a.bucket.orgCode < b.bucket.orgCode ? -1 : 1;
      });
      for (var i = 0; i < short && order.length; i++) {
        order[i % order.length].cents++;
      }

      var allocated = 0;
      var dacCommitted = 0;
      var dacActual = 0;
      alloc.forEach(function (a) {
        var amount = a.cents / 100;
        allocated += amount;

        var sp = scSpend.byOrgCode[dacOrg + '|' + a.bucket.orgCode] ||
                 { committed: 0, actual: 0, committedCount: 0, actualCount: 0 };
        dacCommitted += sp.committed;
        dacActual += sp.actual;

        var remaining = round2(amount - sp.committed - sp.actual);

        out.rows.push({
          // The key. Blank for staff sitting above any service center.
          orgCode: a.bucket.orgCode,
          dacOrgCode: dacOrg,
          officeCode: office.officeCode,
          isAboveServiceCenter: a.bucket.isAboveServiceCenter,
          // Display only.
          displayName: a.bucket.displayName,
          filled: a.bucket.filled,
          vacant: a.bucket.vacant,
          authorized: a.bucket.authorized,
          // Share of the DAC's FILLED headcount, as a percentage to 2dp.
          sharePct: Math.round((a.bucket.filled / denominator) * 10000) / 100,
          allocation: amount,
          // Live, from this center's own travelers.
          committed: sp.committed,
          committedCount: sp.committedCount,
          completed: sp.actual,
          completedCount: sp.actualCount,
          remaining: remaining,
          isDeficit: remaining < 0,
          utilizationPct: amount > 0
            ? Math.round(((sp.committed + sp.actual) / amount) * 1000) / 10
            : null
        });
      });

      out.byDac[dacOrg] = {
        officeCode: office.officeCode,
        pool: round2(pool),
        filled: denominator,
        authorized: list.reduce(function (s, b) { return s + b.authorized; }, 0),
        allocated: round2(allocated),
        // Must be 0. Carried rather than trusted, so a rounding regression is
        // visible on the page and not only in a test.
        unallocated: round2(pool - allocated),
        // Per-center spend summed back up, against the office figure computed
        // independently from the Requests tab. The two use DIFFERENT grains —
        // traveler Subtotals here, request Grand_Totals there — so a gap is
        // expected wherever a request carries shared costs or a traveler row
        // has no resolvable org. Shown rather than hidden: a reader comparing
        // the two tables will find the difference, and an unexplained
        // difference reads as a bug in both.
        spendReconciliation: {
          centerCommitted: round2(dacCommitted),
          centerCompleted: round2(dacActual),
          officeCommitted: office.committed,
          officeCompleted: office.completed,
          unexplained: round2((office.committed + office.completed) -
                              (dacCommitted + dacActual))
        }
      };
    });

    // Sorted by DAC then org code — NOT by name, and not by amount. A stable
    // order makes the table diffable between refreshes.
    out.rows.sort(function (a, b) {
      if (a.dacOrgCode !== b.dacOrgCode) return a.dacOrgCode < b.dacOrgCode ? -1 : 1;
      // Above-service-center staff lead their DAC's block; '' sorts first
      // naturally, and this makes that explicit rather than incidental.
      if (a.isAboveServiceCenter !== b.isAboveServiceCenter) {
        return a.isAboveServiceCenter ? -1 : 1;
      }
      return a.orgCode < b.orgCode ? -1 : 1;
    });

    out.available = out.rows.length > 0;
    out.headcountSource = 'HC_Positions, ' + hc.counted + ' positions';
    if (hc.unattributed) {
      out.note = (out.note ? out.note + ' ' : '') +
                 hc.unattributed + ' position(s) carry an org code that ' +
                 'resolves to no DAC and are excluded from the split.';
    }
    if (!out.note) {
      out.note = 'Each DAC\'s available balance divided by its share of ' +
                 'FILLED positions. Vacant seats are excluded — they do not ' +
                 'travel. Keyed on org code, never on service-center name: ' +
                 'two different centers share the name "Acquisition Service ' +
                 'Center 1".';
    }
    return out;
  }

  /**
   * Commitments and actuals per SERVICE CENTER, from Request_Travelers.
   *
   * @clolry asked for "real-time updates based on requested estimates and
   * reconciled actuals" at service-center level. That cannot come from the
   * Requests tab: a request carries ONE Owning_Office, and a consolidated
   * conference request can hold travelers from three different DACs and a
   * dozen different service centers.
   *
   * Request_Travelers is the right grain. Each row already carries the
   * traveler's own Org_Code and their Subtotal, for exactly this reason —
   * Sheets.js:320-324: "a consolidated conference request can include people
   * from FCA, FCB and FCC, and each DAC should see only their own share."
   *
   * WHY Org_Code AND NOT Budget_Org_Code
   * ------------------------------------
   * Budget_Org_Code holds the four-character DAC code (FC/FCA/FCB/FCC) — it is
   * written by Submission.js from the owning office, so every traveler on a
   * request shares it and it cannot distinguish service centers. Org_Code is
   * the traveler's actual HC position code, e.g. FCA0BAA, which resolves up
   * the stored parent chain to a service center. Using Budget_Org_Code here
   * would attribute every traveler to their DAC's above-service-center
   * bucket and leave all 22 centers reading zero, which looks like "nobody has
   * traveled" rather than like a bug.
   *
   * SUBTOTAL, NOT Grand_Total. Grand_Total is the whole request including
   * shared costs; summing it per traveler would multiply the request's cost
   * by its traveler count. Shared costs are deliberately NOT attributed to a
   * service center — they belong to the request's owning office, and splitting
   * them would need a policy decision nobody has made.
   *
   * @param {Object} db TravelDB instance
   * @returns {Object} { byOrgCode, unattributed, travelersRead, available }
   */
  function spendByServiceCenter(db) {
    var out = {
      byOrgCode: {},
      unattributed: { committed: 0, actual: 0, count: 0 },
      travelersRead: 0,
      available: false,
      note: ''
    };

    if (typeof HC === 'undefined' || !HC || typeof HC.orgAncestorAtLevel !== 'function') {
      out.note = 'HR org hierarchy unavailable; per-center spend not computed.';
      return out;
    }

    var reqData, travData;
    try {
      reqData = db.readSheet(SHEET_NAMES.REQUESTS);
      travData = db.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
    } catch (e) {
      console.warn('BudgetDashboard: per-center spend unavailable: ' + e.message);
      out.note = 'Could not read traveler rows: ' + e.message;
      return out;
    }
    if (!reqData || !reqData.headers.length || !travData || !travData.headers.length) {
      out.note = 'No traveler rows to read.';
      return out;
    }

    var groups = budgetStatusGroups();

    // Request_ID -> which bucket, so the traveler loop does not rescan.
    var ri = reqData.headerIndex;
    if (!('Request_ID' in ri) || !('Status' in ri)) {
      out.note = 'Requests lacks Request_ID or Status.';
      return out;
    }
    var statusOf = {};
    reqData.rows.forEach(function (row) {
      var id = String(row[ri['Request_ID']] || '').trim();
      if (!id) return;
      var status = String(row[ri['Status']] || '').trim();
      if (groups.committed.indexOf(status) > -1) statusOf[id] = 'committed';
      else if (groups.actual.indexOf(status) > -1) statusOf[id] = 'actual';
      // Denied, cancelled and draft are absent, so their travelers are
      // skipped below rather than counted as unattributed.
    });

    var ti = travData.headerIndex;
    if (!('Request_ID' in ti) || !('Org_Code' in ti) || !('Subtotal' in ti)) {
      out.note = 'Request_Travelers lacks Request_ID, Org_Code or Subtotal.';
      return out;
    }

    var orgs = HC.hcGetOrgHierarchy();
    var byCode = {};
    for (var o = 0; o < orgs.length; o++) {
      byCode[String(orgs[o].orgCode || '').toUpperCase()] = orgs[o];
    }
    if (!orgs.length) {
      out.note = 'HC_Orgs is empty, so a traveler org code cannot be ' +
                 'resolved to a service center.';
      return out;
    }

    travData.rows.forEach(function (row) {
      var reqId = String(row[ti['Request_ID']] || '').trim();
      var bucket = statusOf[reqId];
      if (!bucket) return;                    // dead status, or orphan row

      out.travelersRead++;

      var amount = parseFloat(row[ti['Subtotal']]);
      if (isNaN(amount)) amount = 0;

      var orgCode = String(row[ti['Org_Code']] || '').trim().toUpperCase();
      var dac = HC.orgAncestorAtLevel(orgCode, byCode, 'DAC') ||
                HC.orgAncestorAtLevel(orgCode, byCode, 'AC');
      if (!dac) {
        out.unattributed.count++;
        out.unattributed[bucket] = round2(out.unattributed[bucket] + amount);
        return;
      }

      var sc = HC.orgAncestorAtLevel(orgCode, byCode, 'SERVICE_CENTER');
      var key = dac + '|' + sc;
      if (!out.byOrgCode[key]) {
        out.byOrgCode[key] = { committed: 0, actual: 0,
                               committedCount: 0, actualCount: 0 };
      }
      out.byOrgCode[key][bucket] = round2(out.byOrgCode[key][bucket] + amount);
      out.byOrgCode[key][bucket === 'committed' ? 'committedCount' : 'actualCount']++;
    });

    out.available = true;
    return out;
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
      var alloc = allocations();
      // Office list from config; AMOUNTS from the database when set.
      var codes = Object.keys(baselines);

      var db;
      var spend;
      var scSpend = { byOrgCode: {}, unattributed: { committed: 0, actual: 0, count: 0 },
                      travelersRead: 0, available: false, note: '' };
      try {
        db = new TravelDB();
        spend = spendByOffice(db);
        scSpend = spendByServiceCenter(db);
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
        var set = (alloc && alloc.byOffice[code]) || null;

        // The admin-set figure wins over the config literal. This is the whole
        // point of the allocations tab: a budget that changes mid-year should
        // not need a code deploy.
        var baseline = set ? set.amount : round2(o.baselineAmount);
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
          // Where this number came from, per office. A dashboard mixing
          // admin-set and fallback figures without saying which is the exact
          // problem this field prevents.
          allocationSource: set ? set.source : 'config-fallback',
          allocationEffectiveDate: set ? set.effectiveDate : '',
          allocationSetBy: set ? set.setBy : '',
          allocationReason: set ? set.changeReason : '',
          // A queued change. A DAC reading a balance should know if the
          // ceiling moves next month.
          scheduledChanges: set ? (set.scheduledChanges || []) : [],
          proportionalShare: set ? set.proportionalShare
                                 : (Number(o.standardProportionalShare) || 0),
          setAsides: sa,
          // What other offices fund on this one's behalf. $0 for every DAC;
          // $72,000 for FO, which is why its $4,000 baseline is misleading on
          // its own. NOT added to the allocation — the money is charged to the
          // DACs and counting it twice would overstate the ASD total.
          fundedIn: fundedInFor(code),
          discretionaryBase: discretionaryBase,
          committed: sp.committed,
          committedCount: sp.committedCount,
          completed: sp.actual,
          completedCount: sp.actualCount,
          available: available,
          isDeficit: available < 0,
          // Percentage of the discretionary base already committed. The number
          // a DAC actually reacts to.
          utilizationPct: discretionaryBase > 0
            ? Math.round(((sp.committed + sp.actual) / discretionaryBase) * 1000) / 10
            : null
        };
      });

      var sum = function (f) {
        return round2(offices.reduce(function (s, o) { return s + f(o); }, 0));
      };

      var serviceCenters = serviceCenterAllocations(offices, null, scSpend);

      return successResponse({
        offices: offices,
        serviceCenters: serviceCenters,
        // Set-asides funded by releasing unused reservations rather than by a
        // charge. The advisor line is $0 in config on purpose, so without this
        // the page would show its travel against a $0 reservation and read it
        // as "no budget needed".
        releaseFunding: releaseFundingFor(),
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

          // Allocations are now admin-maintained and versioned by effective
          // date, so a mid-year change is a row rather than a deploy.
          allocationSource: alloc ? alloc.source : 'config-fallback',
          allocationsEditable: true,
          adjustmentsAvailable: true,
          adjustmentsNote: (alloc && alloc.source === 'database')
            ? 'Allocations are admin-set and versioned by effective date; the ' +
              'figures shown are those in force today.'
            : ((alloc && alloc.source === 'partial')
                ? 'Some offices have no admin-set allocation yet and fall back to ' +
                  'the configured baseline. Set them on the Budget page.'
                : 'No admin-set allocations yet — these are the configured ' +
                  'baselines. Set the real figures on the Budget admin page.'),
          actualsNote: 'LETS has no post-travel reconciliation step, so completed ' +
                       'travel is counted at its approved estimate rather than at ' +
                       'a liquidated actual.',
          baselineSource: 'BudgetConfig.js — baseline allocations and standing ' +
                          'set-asides are configuration, not database values.',
          // TWO DIFFERENT PROPORTIONALITY RULES ARE ON THIS PAGE AT ONCE, and
          // a reader who assumes one applies throughout cannot reconcile the
          // numbers. Both are named here rather than left to be inferred.
          proportionalityNote: 'Enterprise set-asides are shared between the ' +
                               'three DACs by their FIXED share of the original ' +
                               'budget (OMD 15.3%, IDV 66.4%, CM 18.3%). Each ' +
                               'DAC\'s own balance is then divided between its ' +
                               'service centers by FILLED HEADCOUNT. These are ' +
                               'deliberately different rules for different ' +
                               'questions.',
          serviceCenterSpendNote: scSpend.available
            ? 'Per-center commitments come from each traveler\'s own ' +
              'Subtotal and org code, so a consolidated request is split ' +
              'between the centers its travelers belong to. Shared request ' +
              'costs stay with the owning office and are not attributed to a ' +
              'center.'
            : (scSpend.note || 'Per-center commitments are not available.'),
          travelersRead: scSpend.travelersRead,
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
    setAsideAmount: setAsideAmount,
    fundedInFor: fundedInFor,
    releaseFundingFor: releaseFundingFor,
    serviceCenterAllocations: serviceCenterAllocations,
    spendByOffice: spendByOffice,
    spendByServiceCenter: spendByServiceCenter,
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
