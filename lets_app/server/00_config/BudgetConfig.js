/**
 * LETS - Logistics, Events, and Travel System
 * Server Configuration: Budget, DAC Allocations, Set-Asides, and Org Approvers
 */

// MUST BE `var`, NOT `const`/`let`.
//
// Three files read this as a property of the global object:
//   20_data/LetsDB.js:11          root.LETS_CONFIG
//   30_services/BudgetEngine.js:11 root.LETS_CONFIG
//   40_domain/RequestService.js:13 root.LETS_CONFIG
//
// In the Apps Script V8 runtime a top-level `const`/`let`/`class` creates a
// LEXICAL binding that is NOT a property of the global object, while `var`
// creates both. Declared `const`, `LETS_CONFIG` is visible to code that
// references the bare identifier but `root.LETS_CONFIG` is `undefined`.
//
// That is not a latent problem confined to the budget layer. Those three files
// read it inside an IIFE that runs at FILE EVALUATION time, and Apps Script
// evaluates every file on every execution. So the `const` form threw
// "TypeError: Cannot read properties of undefined (reading 'sheets')" from
// LetsDB.js:20 before any user code ran, taking down the entire web app —
// including the travel workflow, which does not use this object at all.
//
// `docs/SYSTEM_COMPONENT_MAP.md` §2.6 establishes that nothing CALLS these
// four modules. True, and it is why this went unnoticed: unreachable code
// still has its top-level IIFE evaluated, so it can still break the app at
// load. Reachability and evaluation are different things.
//
// Do not "modernize" this to `const` (AGENTS.md §12.3 — encode the fix so it
// cannot silently regress). verify.yml has a guard that fails the build if
// this declaration changes, and test_budget_config_global.js asserts the
// global-object property exists.

// ============================================================================
// THE FY27 EVENT PLAN
// ============================================================================
//
// 23 planned events, $440,000, every one shared across the three DACs by the
// 15.3 / 66.4 / 18.3 split. These are @clolry's FY27 Event Plan rows verbatim;
// the per-DAC columns in his spreadsheet are this amount times the share, and
// the test asserts each one reproduces to the cent.
//
// WHY A FUNCTION RATHER THAN 23 LITERALS IN defaultSetAsides
// ----------------------------------------------------------
// Each line is needed in three places with different shapes: as a budget
// set-aside, as a seeded Event_Set_Asides row, and as a seeded Events
// catalogue row so a traveller can pick it. One table generates all three, so
// the $15,000 for Atlanta Q1 cannot say one thing to the budget and another
// to the picker.
//
// DECLARED ABOVE LETS_CONFIG ON PURPOSE. Function declarations hoist, so this
// would work below it — but this file's whole history is a load-order failure
// that took the app down (see the `var` note above), and a reader should not
// have to reason about hoisting to be sure.
//
// THE QUARTER IS STORED; THE DATES ARE NOT INVENTED
// -------------------------------------------------
// The plan gives a quarter, not dates. `quarter` is therefore the only time
// field here, and the seeder writes NO Start_Date or End_Date. Deriving "Q1"
// into, say, 2026-10-15 would put a date in front of a traveller that nobody
// agreed to, and per-diem and airfare lookups would then quote against it.
// A coordinator sets real dates when the event is scheduled.
//
// FY27 quarters, fiscal year 1 Oct - 30 Sep:
//   Q1 Oct-Dec 2026    Q2 Jan-Mar 2027    Q3 Apr-Jun 2027    Q4 Jul-Sep 2027
//
// `locationHint` IS DISPLAY ONLY. It is never a key, never matched against,
// and deliberately not split into city/state: "KC/FW" and "PHL/NY" are two
// cities each, and forcing them into Location_City would make the picker
// claim a precision the plan does not have.
//
// WHAT IS NOT HERE
// ----------------
// The Event Plan totals $590,000. The $150,000 difference is three training
// conferences funded from a MARKETING budget, not from ASD travel, per
// @clolry — OASIS+ / Professional Services MAS, IT Solutions / GWACs / MAS IT,
// and MAS. They are absent rather than zero-valued, because a $0 set-aside
// would read as "nobody has budgeted this yet".
function _letsEventPlanSetAsides_() {
  // [id suffix, title, amount, quarter, location hint, series key]
  var PLAN = [
    // ---- ASD Executive Team visits and strategic planning: $200,000 -------
    ['EXEC_ATL_Q1',    'ASD Exec Team - Atlanta',      15000.00, 'Q1', 'Atlanta, GA',             'asd-exec-team-atlanta'],
    ['EXEC_DC_Q1',     'ASD Exec Team - DC',           15000.00, 'Q1', 'Washington, DC',          'asd-exec-team-dc'],
    ['EXEC_KCFW_Q1',   'ASD Exec Team - KC/FW',        20000.00, 'Q1', 'Kansas City / Fort Worth', 'asd-exec-team-kcfw'],
    ['EXEC_TAC_Q2',    'ASD Exec Team - Tacoma',       15000.00, 'Q2', 'Tacoma, WA',              'asd-exec-team-tacoma'],
    ['EXEC_CHI_Q2',    'ASD Exec Team - Chicago',      15000.00, 'Q2', 'Chicago, IL',             'asd-exec-team-chicago'],
    ['EXEC_PHLNY_Q2',  'ASD Exec Team - PHL/NY',       20000.00, 'Q2', 'Philadelphia / New York', 'asd-exec-team-phlny'],
    ['EXEC_ATL_Q3',    'ASD Exec Team - Atlanta',      15000.00, 'Q3', 'Atlanta, GA',             'asd-exec-team-atlanta'],
    ['EXEC_DC_Q3',     'ASD Exec Team - DC',           15000.00, 'Q3', 'Washington, DC',          'asd-exec-team-dc'],
    ['EXEC_KCFW_Q3',   'ASD Exec Team - KC/FW',        20000.00, 'Q3', 'Kansas City / Fort Worth', 'asd-exec-team-kcfw'],
    ['EXEC_TAC_Q4',    'ASD Exec Team - Tacoma',       15000.00, 'Q4', 'Tacoma, WA',              'asd-exec-team-tacoma'],
    ['EXEC_CHI_Q4',    'ASD Exec Team - Chicago',      15000.00, 'Q4', 'Chicago, IL',             'asd-exec-team-chicago'],
    ['EXEC_PHLNY_Q4',  'ASD Exec Team - PHL/NY',       20000.00, 'Q4', 'Philadelphia / New York', 'asd-exec-team-phlny'],

    // ---- Office and portfolio strategic planning onsites: $80,000 --------
    ['ONSITE_OMD_Q2',  'ASD OMD Onsite',               15000.00, 'Q2', '',                        'asd-omd-onsite'],
    ['ONSITE_ACQ_Q2',  'ASD Acq Onsite',               15000.00, 'Q2', '',                        'asd-acq-onsite'],
    ['ONSITE_CM_Q2',   'ASD Cat Man Onsite',           15000.00, 'Q2', '',                        'asd-cat-man-onsite'],
    ['ONSITE_ITC_Q2',  'ASD IT Cat Onsite',            10000.00, 'Q2', '',                        'asd-it-cat-onsite'],
    ['ONSITE_MAS_Q2',  'ASD MAS Exec Onsite',          15000.00, 'Q2', '',                        'asd-mas-exec-onsite'],
    ['ONSITE_OEA_Q2',  'ASD OEA Exec Onsite',          10000.00, 'Q2', '',                        'asd-oea-exec-onsite'],

    // ---- All-hands: $95,000 ----------------------------------------------
    ['ALLHANDS_Q3',    'ASD All Execs & Staff',        95000.00, 'Q3', '',                        'asd-all-execs-staff'],

    // ---- Alliant programme management review: $10,000 --------------------
    ['ALLIANT_PMR_Q4', 'ASD Alliant PMR',              10000.00, 'Q4', '',                        'asd-alliant-pmr'],

    // ---- Sponsored / co-sponsored, travel-funded portion: $55,000 --------
    ['ITVMO_Q2',       'ASD ITVMO Summit',             20000.00, 'Q2', '',                        'asd-itvmo-summit'],
    ['CATMAN_FORUM_Q3', 'ASD Cat Man Forum',           20000.00, 'Q3', '',                        'asd-cat-man-forum'],
    ['PQC_SUMMIT_Q4',  'ASD PQC Summit',               15000.00, 'Q4', '',                        'asd-pqc-summit']
  ];

  return PLAN.map(function (r) {
    return {
      id: 'SETASIDE_EVENT_' + r[0],
      // The quarter is part of the TITLE as well as a field, because the same
      // event recurs: 'ASD Exec Team - Atlanta' appears in Q1 and again in Q3
      // and they are different $15,000. A title without the quarter would
      // read as a duplicate on the dashboard.
      title: r[1] + ' (' + r[3] + ')',
      eventName: r[1],
      group: 'EVENT_PLAN',
      type: 'ENTERPRISE_SHARED',
      targetOffice: 'SHARED_DAC',
      amount: r[2],
      quarter: r[3],
      locationHint: r[4],
      seriesKey: r[5],
      description: 'FY27 Event Plan: ' + r[1] + ', ' + r[3]
    };
  });
}

var LETS_CONFIG = {
  appName: 'LETS - Logistics, Events, and Travel System',
  fiscalYear: 'FY27',
  
  // Primary budget pools and baseline allocations
  baselineAllocations: {
    FO: {
      code: 'FO',
      name: 'Front Office / AC',
      isDac: false,
      baselineAmount: 4000.00
    },
    OMD: {
      code: 'OMD',
      name: 'OMD DAC',
      isDac: true,
      baselineAmount: 152000.00,
      standardProportionalShare: 0.153 // 15.3%
    },
    IDV: {
      code: 'IDV',
      name: 'IDV DAC',
      isDac: true,
      baselineAmount: 659000.00,
      standardProportionalShare: 0.664 // 66.4%
    },
    CM: {
      code: 'CM',
      name: 'CM DAC',
      isDac: true,
      baselineAmount: 182000.00,
      standardProportionalShare: 0.183 // 18.3%
    }
  },

  // ==========================================================================
  // SET-ASIDES
  // ==========================================================================
  //
  // @clolry, on the funding model agreed with the DACs:
  //
  //   "Expenses that support the leadership team and certain portfolio
  //    set-asides (like the Event Plan, COE program, and corporate Executive
  //    leadership travel) are shared proportionately by each of the FCs.
  //    These shares are based on your portion of the original travel budget."
  //
  // So there are exactly two funding types:
  //
  //   SELF_FUNDED       one office pays the whole line.
  //   ENTERPRISE_SHARED the three DACs pay 15.3 / 66.4 / 18.3.
  //
  // WHERE THE SHARES COME FROM, AND WHY THEY ARE NOT RECOMPUTED
  // -----------------------------------------------------------
  // They are the baselines restated over the DAC-only pool of $993,000:
  //
  //   OMD 152,000 / 993,000 = 15.3072%  -> 15.3%
  //   IDV 659,000 / 993,000 = 66.3646%  -> 66.4%
  //   CM  182,000 / 993,000 = 18.3283%  -> 18.3%
  //
  // Rounded to one decimal they sum to exactly 100.0%, which is why every
  // shared line foots to the cent with no remainder to assign. They are
  // STORED rather than derived because they are an agreed policy split that
  // happens to approximate the baseline ratio; recomputing them would move
  // every DAC's share the moment a baseline changed, silently.
  //
  // THEY ARE NOT HEADCOUNT SHARES. On filled positions the split would be
  // OMD 16.65 / IDV 66.83 / CM 16.52, which would move about $9,100 off CM.
  // Headcount drives the per-service-centre split INSIDE a DAC
  // (BudgetDashboard.serviceCentreAllocations); it does not drive this.
  //
  // WHY THE FRONT OFFICE CARRIES A SELF_FUNDED LINE FOR ITS WHOLE BASELINE
  // ----------------------------------------------------------------------
  // FO's $4,000 is entirely committed to LC travel, so its discretionary
  // balance is $0. @clolry's FY27 sheet shows this as ($4,000) in the FO
  // set-aside column with $0.00 remaining, and the line below is what produces
  // that. Without it FO would appear to hold $4,000 of discretionary money it
  // does not have.
  //
  // FO's actual LC travel is funded at $4,000 + $20,000 + the advisor line,
  // all of which name FO in `benefitsOffice`. BudgetDashboard sums those into
  // `fundedInTotal` so the dashboard can show FO's real spending power rather
  // than a $4,000 baseline that understates it many times over.
  //
  // NOT SET ASIDE HERE, DELIBERATELY
  // --------------------------------
  // The FY27 Event Plan totals $590,000. Only $440,000 of it is set aside
  // below. The missing $150,000 is three training conferences — OASIS+ /
  // Professional Services MAS, IT Solutions / GWACs / MAS IT, and MAS —
  // which @clolry confirms are funded from a MARKETING budget, not from ASD
  // travel. Recording the reason here because a reader comparing the Event
  // Plan to this file will otherwise find $150,000 missing and assume an
  // omission.
  defaultSetAsides: [

    // ---- A. DAC-specific, self-funded -------------------------------------
    {
      id: 'SETASIDE_DAC_LC_OMD',
      title: 'DAC LC Travel - OMD',
      group: 'DAC_SPECIFIC',
      type: 'SELF_FUNDED',
      targetOffice: 'OMD',
      amount: 12000.00,
      description: 'Dedicated LC travel set-aside for OMD DAC'
    },
    {
      id: 'SETASIDE_DAC_LC_IDV',
      title: 'DAC LC Travel - IDV',
      group: 'DAC_SPECIFIC',
      type: 'SELF_FUNDED',
      targetOffice: 'IDV',
      amount: 12000.00,
      description: 'Dedicated LC travel set-aside for IDV DAC'
    },
    {
      id: 'SETASIDE_DAC_LC_CM',
      title: 'DAC LC Travel - CM',
      group: 'DAC_SPECIFIC',
      type: 'SELF_FUNDED',
      targetOffice: 'CM',
      amount: 12000.00,
      description: 'Dedicated LC travel set-aside for CM DAC'
    },

    // ---- The Front Office's own baseline, fully committed ------------------
    {
      id: 'SETASIDE_FO_BASELINE_COMMITTED',
      title: 'Front Office LC Travel (own baseline)',
      group: 'DAC_SPECIFIC',
      type: 'SELF_FUNDED',
      targetOffice: 'FO',
      benefitsOffice: 'FO',
      amount: 4000.00,
      description: 'The Front Office baseline is committed in full to LC travel, ' +
                   'leaving no discretionary balance.'
    },

    // ---- B. Shared: leadership and programme ------------------------------
    {
      id: 'SETASIDE_FO_LC_GAP',
      title: 'FO LC Gap',
      group: 'SHARED_LEADERSHIP',
      type: 'ENTERPRISE_SHARED',
      targetOffice: 'SHARED_DAC',
      // Who the money is SPENT ON, as distinct from who pays for it. Used to
      // show FO's funded-in total; it is not a charge against FO.
      benefitsOffice: 'FO',
      amount: 20000.00,
      description: 'Shared ASD responsibility covering the Front Office ' +
                   '(Larry and Udaya) LC travel gap'
    },
    {
      // @clolry: "FC has a senior advisor that is required to travel to DC
      // about twice a month at approximately $2k/trip."
      //
      // 2 trips x 12 months x $2,000 = $48,000. @clolry first said ~$24,000
      // and confirmed $48,000 once the arithmetic was shown, and asked for the
      // figure to be configurable — so the amount below is a DEFAULT and
      // BUDGET_FC_ADVISOR_AMOUNT overrides it without a deploy.
      //
      // Resolved at read time by BudgetDashboard, not here: this file is
      // evaluated on every execution and must not depend on
      // PropertiesService. See the `var` note at the top — a load-time failure
      // in this file takes down the whole web app, including the travel
      // workflow that does not use this object at all.
      id: 'SETASIDE_FC_SENIOR_ADVISOR',
      title: 'FC Senior Advisor - DC travel',
      group: 'SHARED_LEADERSHIP',
      type: 'ENTERPRISE_SHARED',
      targetOffice: 'SHARED_DAC',
      benefitsOffice: 'FO',
      amount: 48000.00,
      amountPropertyKey: 'BUDGET_FC_ADVISOR_AMOUNT',
      description: 'Recurring DC travel for the FC senior advisor, ' +
                   'approximately twice monthly at $2,000 per trip'
    },
    {
      // MOVED FROM SELF_FUNDED. This was 'funded solely by CM DAC' and is now
      // shared, on @clolry's confirmation: "we finally decided to share the
      // costs for COE proportionately across the orgs."
      //
      // The change moves $42,892.50 of COE cost off CM and onto OMD and IDV.
      // test_budget_engine.js asserted the old CM-only figure and was updated
      // in the same commit.
      id: 'SETASIDE_COE_PROGRAM',
      title: 'COE Program',
      group: 'SHARED_LEADERSHIP',
      type: 'ENTERPRISE_SHARED',
      targetOffice: 'SHARED_DAC',
      amount: 52500.00,
      description: 'Center of Excellence for Outcome Based Contracting, ' +
                   'shared proportionately across the three DACs'
    }

  ].concat(_letsEventPlanSetAsides_()),

  // Default initial approver configuration per Owning Office
  defaultApprovers: {
    FO: {
      officeCode: 'FO',
      officeName: 'Front Office / AC',
      primaryApproverName: 'Front Office Director',
      primaryApproverEmail: 'fo.director@gsa.gov',
      alternateApproverName: 'Front Office Deputy',
      alternateApproverEmail: 'fo.deputy@gsa.gov'
    },
    OMD: {
      officeCode: 'OMD',
      officeName: 'OMD DAC',
      primaryApproverName: 'OMD Director',
      primaryApproverEmail: 'omd.director@gsa.gov',
      alternateApproverName: 'OMD Deputy',
      alternateApproverEmail: 'omd.deputy@gsa.gov'
    },
    IDV: {
      officeCode: 'IDV',
      officeName: 'IDV DAC',
      primaryApproverName: 'IDV Director',
      primaryApproverEmail: 'idv.director@gsa.gov',
      alternateApproverName: 'IDV Deputy',
      alternateApproverEmail: 'idv.deputy@gsa.gov'
    },
    CM: {
      officeCode: 'CM',
      officeName: 'CM DAC',
      primaryApproverName: 'CM Director',
      primaryApproverEmail: 'cm.director@gsa.gov',
      alternateApproverName: 'CM Deputy',
      alternateApproverEmail: 'cm.deputy@gsa.gov'
    }
  },

  // Sheet table names
  sheets: {
    budgets: 'Budgets',
    budgetAdjustments: 'Budget_Adjustments',
    setAsides: 'Set_Asides',
    approvers: 'Org_Approvers',
    requests: 'Requests',
    travelers: 'Travelers',
    auditLog: 'Audit_Log'
  },

  // Workflow status definitions
  requestStatus: {
    INTAKE_DRAFT: 'Draft',
    SUBMITTED: 'Submitted - Pending Budget Check',
    BUDGET_CHECK_PASSED: 'Budget Check Passed',
    BUDGET_FLAGGED_INSUFFICIENT: 'Flagged - Insufficient Funds',
    EXCEPTION_REVIEW: 'Pending Exception Approval',
    LEADERSHIP_REVIEW: 'Pending Leadership Review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    BOOKED: 'Booked / Travel Ready',
    TRAVEL_COMPLETE: 'Travel Completed',
    RECONCILED: 'Reconciled / Actuals Posted',
    CANCELLED: 'Cancelled'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LETS_CONFIG;
}
