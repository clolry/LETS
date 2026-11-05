/**
 * Automated Verification Script for the budget dashboard
 * (40_domain/BudgetDashboard.js).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * The Travel Budget & Executive Tracker was a layout mockup: 34 hardcoded
 * dollar figures, zero server calls. @clolry asked for the KPIs to be real.
 *
 * The danger in this specific change is that a budget dashboard which is
 * WRONG looks exactly like one that is right. A DAC reads "$629,220
 * available" and spends against it. There is no visual tell.
 *
 * §1 is the highest-value section and documents why BudgetEngine.js — which
 * already implements this arithmetic correctly — is not used: its status
 * vocabulary has an EMPTY intersection with what the Requests tab actually
 * stores. Wired up as-is it would report every DAC at full baseline with zero
 * commitments, which is plausible and false.
 *
 * Run: node lets_app/test_budget_dashboard.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 260)); fails++; }
};

const REQ_HEADERS = ['Request_ID', 'Status', 'Trip_Name', 'Owning_Office',
                     'Owning_Org_Code', 'Grand_Total'];

// The same tab WITH the reconciliation column the existing-travel importer
// writes. Kept separate from REQ_HEADERS deliberately: most of this suite
// should keep proving the dashboard works on a database that has no
// Actual_Total at all, because that is what a pre-import deployment looks
// like.
const REQ_HEADERS_RECONCILED = REQ_HEADERS.concat(['Actual_Total']);

/**
 * Loads BudgetDashboard.js with a stubbed TravelDB.
 *
 * Status.js, Sheets.js and BudgetConfig.js are loaded for REAL — the point is
 * to exercise the actual status vocabulary and the actual baselines, not a
 * restatement of them.
 */
function load(rows, opts) {
  opts = opts || {};
  const logs = [];
  const ctx = vm.createContext({
    console: { log: m => logs.push(String(m)), warn: m => logs.push(String(m)),
               error: m => logs.push(String(m)) },
    JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
    parseInt, parseFloat, isNaN
  });
  vm.runInContext(`
    function successResponse(d, m) { return { success: true, data: d, message: m || null }; }
    function errorResponse(m) { return { success: false, error: m }; }
  `, ctx);
  ['01_constants/Status.js', '01_constants/Sheets.js', '00_config/BudgetConfig.js']
    .forEach(f => vm.runInContext(fs.readFileSync('lets_app/server/' + f, 'utf8'), ctx,
                                  { filename: f }));

  if (opts.dbThrows) {
    vm.runInContext('function TravelDB() { throw new Error("Travel DB unreachable"); }', ctx);
  } else {
    const headers = opts.headers || REQ_HEADERS;
    const headerIndex = {};
    headers.forEach((h, i) => { headerIndex[h] = i; });
    vm.runInContext('var __D = ' + JSON.stringify({ headers, rows: rows || [], headerIndex }) +
      '; function TravelDB() { this.readSheet = function () { return __D; }; }', ctx);
  }

  vm.runInContext(fs.readFileSync('lets_app/server/40_domain/BudgetDashboard.js', 'utf8'),
                  ctx, { filename: 'BudgetDashboard.js' });
  return { ctx, run: e => vm.runInContext(e, ctx), logs };
}

const row = (id, status, office, orgCode, total) =>
  [id, status, 'Trip ' + id, office, orgCode, total];

/** A row with a reconciled actual. Blank `actual` means NOT reconciled. */
const rowRec = (id, status, office, orgCode, total, actual) =>
  [id, status, 'Trip ' + id, office, orgCode, total,
   actual === undefined ? '' : actual];

console.log('--- Budget dashboard test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. WHY BudgetEngine.js could not simply be wired up');
{
  // This section exists because reusing BudgetEngine.js looks obviously
  // right. It is 339 lines of correct arithmetic. Using it would have
  // produced confidently wrong numbers.
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Status.js', 'utf8'), ctx);
  const realStatuses = Object.values(vm.runInContext('STATUS_CODES', ctx));
  const cfg = require('./server/00_config/BudgetConfig.js');
  const engineStatuses = Object.values(cfg.requestStatus);

  const overlap = engineStatuses.filter(s => realStatuses.indexOf(s) > -1);
  ok('BudgetEngine\'s status vocabulary does not exist in the Requests tab',
     overlap.length === 0, overlap);
  ok('so it would match zero requests and report full balances',
     overlap.length === 0,
     'every DAC would show its baseline with no commitments — plausible and false');

  // The second, independent reason: Apps Script exposes only top-level
  // declarations to google.script.run. BudgetEngine assigns to `root`.
  const engineSrc = fs.readFileSync('lets_app/server/30_services/BudgetEngine.js', 'utf8');
  ok('and it is an IIFE with no top-level declaration (finding G-016)',
     /root\.BudgetEngine = factory/.test(engineSrc) &&
     !/^function (calculateOfficeBudgetSummary|evaluateBudgetCheck)/m.test(engineSrc));

  // This file must therefore read the live vocabulary, not restate it.
  const src = fs.readFileSync('lets_app/server/40_domain/BudgetDashboard.js', 'utf8');
  ok('BudgetDashboard reads STATUS_GROUPS instead of listing statuses',
     /STATUS_GROUPS\.PENDING/.test(src) && /STATUS_GROUPS\.NEEDS_INFO/.test(src),
     'a hardcoded list cannot know about a status added later');
  ok('and its entry point IS top-level',
     /^function getBudgetDashboard\(\)/m.test(src));
}

// ---------------------------------------------------------------------------
console.log('\n2. the arithmetic reproduces @clolry\'s FY27 sheet exactly');
{
  // These are the figures @clolry circulated to the DACs. If this code agrees
  // to the cent, the formula matches what they have been reading.
  //
  // THE SHARED POOL IS $512,500 AND THE ADVISOR IS NOT IN IT.
  //
  // The advisor was briefly ENTERPRISE_SHARED at $48,000, which charged the
  // DACs $7,344 / $31,872 / $8,784 and cut ASD discretionary to $396,500. The
  // Chief of Staff rejected that — @clolry: "he does not want to take
  // additional funds from the orgs to fund the FC senior advisor's $48k of
  // travel ... please restore the $48k back to the DACs discretionary
  // budgets."
  //
  // It is now FUNDED_FROM_RELEASES at $0, paid for by releasing Q1 event
  // reservations that went unused. §2c covers that mechanism. The assertions
  // below are the restored figures, which match @clolry's original table and
  // the Allowance cell on his Travel Summary tab.
  const t = load([]);
  const r = t.run('getBudgetDashboard()');
  ok('builds', r.success === true, r.error);

  const by = {};
  r.data.offices.forEach(o => { by[o.officeCode] = o; });

  ok('FO baseline is $4,000', by.FO.baselineAllocation === 4000);
  ok('OMD baseline is $152,000', by.OMD.baselineAllocation === 152000);
  ok('IDV baseline is $659,000', by.IDV.baselineAllocation === 659000);
  ok('CM baseline is $182,000', by.CM.baselineAllocation === 182000);
  ok('total baseline is $997,000', r.data.totals.baseline === 997000,
     r.data.totals.baseline);

  // Each DAC's own LC travel is $12,000, unshared.
  ok('each DAC self-funds $12,000 of LC travel',
     by.OMD.setAsides.selfFunded === 12000 &&
     by.IDV.setAsides.selfFunded === 12000 &&
     by.CM.setAsides.selfFunded === 12000,
     [by.OMD.setAsides.selfFunded, by.IDV.setAsides.selfFunded,
      by.CM.setAsides.selfFunded]);

  // The shared pool: $20,000 FO gap + $440,000 event plan + $52,500 COE.
  // The advisor's $48,000 is NOT here — that is the Chief of Staff's decision,
  // expressed as arithmetic.
  const sharedSum = by.OMD.setAsides.enterpriseShared +
                    by.IDV.setAsides.enterpriseShared +
                    by.CM.setAsides.enterpriseShared;
  ok('the three DAC shares account for the whole $512,500 shared pool',
     sharedSum === 512500, sharedSum);
  ok('split 15.3 / 66.4 / 18.3',
     by.OMD.setAsides.enterpriseShared === 78412.50 &&
     by.IDV.setAsides.enterpriseShared === 340300.00 &&
     by.CM.setAsides.enterpriseShared === 93787.50,
     [by.OMD.setAsides.enterpriseShared, by.IDV.setAsides.enterpriseShared,
      by.CM.setAsides.enterpriseShared]);

  // @clolry's published Total Set-Asides column.
  ok('OMD set-asides are $90,412.50', by.OMD.setAsides.total === 90412.50,
     by.OMD.setAsides.total);
  ok('IDV set-asides are $352,300.00', by.IDV.setAsides.total === 352300.00,
     by.IDV.setAsides.total);
  ok('CM set-asides are $105,787.50', by.CM.setAsides.total === 105787.50,
     by.CM.setAsides.total);

  // His published Discretionary Balance column, restored.
  ok('OMD discretionary is $61,587.50', by.OMD.discretionaryBase === 61587.50,
     by.OMD.discretionaryBase);
  ok('IDV discretionary is $306,700.00', by.IDV.discretionaryBase === 306700.00,
     by.IDV.discretionaryBase);
  ok('CM discretionary is $76,212.50', by.CM.discretionaryBase === 76212.50,
     by.CM.discretionaryBase);
  ok('and the ASD total is back to $444,500',
     r.data.totals.discretionaryBase === 444500,
     r.data.totals.discretionaryBase);

  // THE REGRESSION THAT WOULD COST THE DACS $48,000. If a future edit makes
  // FUNDED_FROM_RELEASES chargeable, or flips the advisor back to
  // ENTERPRISE_SHARED, every figure above moves and this names why.
  const advisorLines = [].concat(
    by.OMD.setAsides.lines, by.IDV.setAsides.lines, by.CM.setAsides.lines,
    by.FO.setAsides.lines
  ).filter(l => l.id === 'SETASIDE_FC_SENIOR_ADVISOR');
  ok('the advisor line charges NO office anything',
     advisorLines.length === 0,
     'a FUNDED_FROM_RELEASES line must not appear in any office set-aside total');

  // THE FRONT OFFICE MUST NOT CARRY A SHARE OF ITS OWN GAP. Charging it would
  // be circular, and @clolry's sheet correctly shows $0.00 in every shared row
  // of the FO column.
  ok('the Front Office carries no SHARED set-aside',
     by.FO.setAsides.enterpriseShared === 0, by.FO.setAsides);

  // But its whole $4,000 baseline IS committed to LC travel, which is why his
  // sheet shows ($4,000) in the FO set-aside column and $0.00 remaining. FO
  // appearing to hold $4,000 of discretionary money would be wrong.
  ok('FO\'s entire baseline is committed, leaving $0 discretionary',
     by.FO.setAsides.selfFunded === 4000 && by.FO.discretionaryBase === 0,
     [by.FO.setAsides.selfFunded, by.FO.discretionaryBase]);

  // THE FIGURE A READER MISJUDGES WITHOUT. FO's $4,000 baseline understates
  // it: the DACs fund its $20,000 LC gap on top.
  //
  // $24,000, not $72,000. The advisor's $48,000 is no longer a charge, and a
  // FUNDED_FROM_RELEASES line contributes 0 to funded-in — counting its
  // expectedAnnualCost here would claim $48,000 was funded when nothing has
  // been released yet.
  ok('FO reports $24,000 funded in on its behalf',
     by.FO.fundedIn.total === 24000, by.FO.fundedIn);
  ok('and the advisor appears as a release-funded line worth $0 so far',
     by.FO.fundedIn.lines.some(l => l.id === 'SETASIDE_FC_SENIOR_ADVISOR' &&
                                    l.amount === 0 &&
                                    l.fundedFromReleases === true &&
                                    l.expectedCost === 48000),
     by.FO.fundedIn.lines);
  ok('and the DACs report none, because they fund rather than receive',
     by.OMD.fundedIn.total === 0 && by.IDV.fundedIn.total === 0 &&
     by.CM.fundedIn.total === 0);

  // NOT DOUBLE-COUNTED. The funded-in total is DAC money already charged to
  // the DACs above; adding it to an allocation would overstate ASD.
  ok('funded-in is reported separately and not added to any allocation',
     r.data.totals.baseline === 997000 &&
     r.data.totals.discretionaryBase === 444500,
     'adding FO\'s $20,000 of DAC-funded gap to its allocation would inflate both');

  // The three group subtotals @clolry's sheet shows as separate blocks.
  ok('set-asides are grouped the way the FY27 sheet groups them',
     by.OMD.setAsides.byGroup.DAC_SPECIFIC === 12000 &&
     by.OMD.setAsides.byGroup.EVENT_PLAN === 67320 &&
     by.OMD.setAsides.byGroup.SHARED_LEADERSHIP === 11092.50,
     by.OMD.setAsides.byGroup);

  // $150,000 of the $590,000 Event Plan is funded from MARKETING, not travel.
  // Asserted so that adding it later is a deliberate act with a failing test
  // rather than a quiet correction.
  const eventLines = by.IDV.setAsides.lines.filter(l => l.group === 'EVENT_PLAN');
  ok('the event plan sets aside 23 lines totalling $440,000 of travel',
     eventLines.length === 23 &&
     Math.round(eventLines.reduce((s, l) => s + l.amount, 0) * 100) / 100 === 292160,
     [eventLines.length, eventLines.reduce((s, l) => s + l.amount, 0)]);
}

// ---------------------------------------------------------------------------
console.log('\n2b. the configurable set-aside amount');
{
  // @clolry: "Please make it configurable but yes, you were correct that it's
  // $48k". The estimate is "about twice a month at approximately $2k/trip" —
  // both halves approximate, so it must move without a deploy.
  const cfg = require('./server/00_config/BudgetConfig.js');
  const advisor = cfg.defaultSetAsides.find(
    s => s.id === 'SETASIDE_FC_SENIOR_ADVISOR');

  ok('the advisor line exists and names a property key',
     !!advisor && advisor.amountPropertyKey === 'BUDGET_FC_ADVISOR_AMOUNT',
     advisor);
  // $0 CHARGED, $48,000 EXPECTED. The two numbers mean different things and
  // the split is the whole mechanism: amount is what any office pays, and
  // expectedAnnualCost is what the travel will cost and therefore how much
  // has to be released to cover it.
  ok('it charges $0, because the DACs do not fund it',
     advisor.amount === 0, advisor.amount);
  ok('and expects $48,000, which is 2 trips x 12 months x $2,000',
     advisor.expectedAnnualCost === 48000, advisor.expectedAnnualCost);
  ok('it is FUNDED_FROM_RELEASES, not charged to anyone',
     advisor.type === 'FUNDED_FROM_RELEASES' &&
     advisor.fundedFromReleases === true &&
     advisor.benefitsOffice === 'FO',
     advisor);

  // BudgetConfig.js is evaluated before any user code on every execution and
  // a failure there takes the whole web app down. So the config must carry a
  // KEY and the resolution must happen at read time — it must NOT call
  // PropertiesService at file scope.
  //
  // COMMENTS ARE STRIPPED FIRST. The naive grep for /PropertiesService/ FAILED
  // when written, because the file's own comment EXPLAINS why it must not call
  // PropertiesService. That is the playbook's recurring trap — an assertion
  // against source text that a comment satisfies — and it cuts both ways: here
  // it produced a false failure, but the same shape silently passes when the
  // comment happens to contain the string the guard wants to see.
  const cfgSrc = fs.readFileSync('lets_app/server/00_config/BudgetConfig.js', 'utf8');
  const cfgCode = cfgSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the comment-stripper left the code intact',
     /var LETS_CONFIG = \{/.test(cfgCode) && !/MUST BE `var`/.test(cfgCode));
  ok('BudgetConfig does NOT call PropertiesService',
     !/PropertiesService/.test(cfgCode),
     'it is evaluated before user code; a failure there takes down the app');

  const dashSrc = fs.readFileSync('lets_app/server/40_domain/BudgetDashboard.js', 'utf8');
  ok('the dashboard resolves the override at read time',
     /getSetAsideAmountOverride/.test(dashSrc));

  // THE DEFECT THIS SHAPE PREVENTS. The dashboard runs in a context where
  // Props.js may not have loaded — Apps Script load order is alphabetical by
  // directory — and a budget figure must never render blank because a lookup
  // failed.
  const t = load([]);
  const r = t.run('getBudgetDashboard()');
  ok('with no Props.js present it falls back to the configured amount',
     r.success === true &&
     r.data.offices.find(o => o.officeCode === 'IDV').setAsides.total === 352300.00,
     'the test harness loads no Props.js, so this exercises the fallback');

  // And the resolver itself, executed rather than read.
  const pctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    String, Number, Math, parseFloat, isNaN, Object, JSON, Date, Boolean, Array,
    RegExp, Error, parseInt
  });
  const store = { BUDGET_FC_ADVISOR_AMOUNT: null };
  vm.runInContext(
    'var __store = ' + JSON.stringify(store) + ';\n' +
    'var PropertiesService = {\n' +
    '  getScriptProperties: function () {\n' +
    '    return { getProperty: function (k) { return __store[k]; } };\n' +
    '  }\n' +
    '};\n', pctx);
  vm.runInContext(fs.readFileSync('lets_app/server/00_config/Props.js', 'utf8'),
                  pctx, { filename: 'Props.js' });
  const call = (v) => {
    vm.runInContext('__store.BUDGET_FC_ADVISOR_AMOUNT = ' + JSON.stringify(v) + ';', pctx);
    return vm.runInContext(
      'getSetAsideAmountOverride("BUDGET_FC_ADVISOR_AMOUNT", 48000)', pctx);
  };

  ok('an unset property yields the default', call(null) === 48000);
  ok('a blank property yields the default', call('   ') === 48000);
  ok('a set property wins', call('36000') === 36000);
  ok('and tolerates how a human types money', call('$42,500.50') === 42500.5);

  // A DELIBERATE ZERO MUST SURVIVE. `parseFloat(x) || default` would turn it
  // into $48,000 — the standard idiom, and wrong here: zero is how an admin
  // retires a line without a deploy.
  ok('a configured $0 is HONOURED, not treated as unset', call('0') === 0,
     'a `|| fallback` idiom would silently restore $48,000');

  // A NEGATIVE WOULD ADD money to a DAC's balance — funds that do not exist,
  // with nothing on the page to show it happened.
  ok('a negative amount is refused, not clamped', call('-5000') === 48000);
  ok('and garbage falls back', call('soon') === 48000);
}


// ---------------------------------------------------------------------------
console.log('\n3. statuses are classified by what they mean to a budget');
{
  const t = load([
    // Committed: promised but not spent. A DAC treating these as available
    // will overspend.
    row('P1', 'PENDING_SECTOR', 'OMD', 'FCA', 1000),
    row('P2', 'PENDING_BU', 'OMD', 'FCA', 2000),
    row('P3', 'PENDING_OSO', 'OMD', 'FCA', 500),
    row('P4', 'PENDING_FAS', 'OMD', 'FCA', 500),
    row('P5', 'Pending_DD_Confirmation', 'OMD', 'FCA', 300),
    row('P6', 'Pending_Correction', 'OMD', 'FCA', 200),
    row('N1', 'NEEDS_INFO_SECTOR', 'OMD', 'FCA', 100),
    row('A1', 'APPROVED_GOGOV', 'OMD', 'FCA', 400),
    // Actual: travel happened.
    row('C1', 'COMPLETED', 'IDV', 'FCB', 5000),
    // Neither: the money was never spent, and counting it would understate
    // every DAC's available balance.
    row('D1', 'DENIED', 'CM', 'FCC', 99999),
    row('X1', 'CANCELLED', 'CM', 'FCC', 88888),
    row('X2', 'SUBMITTER_CANCELLED', 'CM', 'FCC', 77777),
    row('DR', 'DRAFT', 'CM', 'FCC', 66666)
  ]);
  const r = t.run('getBudgetDashboard()');
  const by = {};
  r.data.offices.forEach(o => { by[o.officeCode] = o; });

  ok('every pending and needs-info status commits',
     by.OMD.committed === 5000, by.OMD.committed);
  ok('across the right number of requests', by.OMD.committedCount === 8,
     by.OMD.committedCount);
  ok('COMPLETED is counted separately as actual spend',
     by.IDV.completed === 5000 && by.IDV.committed === 0,
     [by.IDV.committed, by.IDV.completed]);
  ok('denied, cancelled and draft count for NOTHING',
     by.CM.committed === 0 && by.CM.completed === 0,
     'counting them would understate every available balance');

  // The TitleCase statuses are a known inconsistency in LETS and the exact
  // kind of thing a hand-written list drops.
  ok('the TitleCase statuses are included', by.OMD.committedCount === 8,
     'Pending_DD_Confirmation and Pending_Correction are TitleCase, unlike the rest');

  // Available = base - committed - actual.
  ok('available subtracts both', by.OMD.available === 61587.50 - 5000,
     by.OMD.available);
  ok('and utilization is a percentage of the discretionary base',
     by.OMD.utilizationPct === 8.1, by.OMD.utilizationPct);
}

// ---------------------------------------------------------------------------
console.log('\n4. attribution, including the request that belongs nowhere');
{
  const t = load([
    row('O1', '', 'OMD', '', 1000),                 // explicit office
    row('O2', 'PENDING_SECTOR', '', 'FCA', 2000),   // derived from org code
    row('O3', 'PENDING_SECTOR', '', 'FCA0A', 3000), // SUB-org code
    row('O4', 'PENDING_SECTOR', '', 'FCB0BBB', 4000),
    row('O5', 'PENDING_SECTOR', '', 'ZZZ', 700),    // attributable to nothing
    row('O6', 'PENDING_SECTOR', '', '', 800)        // no attribution at all
  ]);
  const r = t.run('getBudgetDashboard()');
  const by = {};
  r.data.offices.forEach(o => { by[o.officeCode] = o; });

  // Hierarchical codes: FCA0A is six levels of org under FCA, which maps to
  // the OMD budget key. @clolry: "FCA and OMD are two ways to describe the
  // same thing."
  ok('a sub-org code attributes to its parent DAC',
     by.OMD.committed === 5000, by.OMD.committed);
  ok('six levels deep too', by.IDV.committed === 4000, by.IDV.committed);

  // THE ONE THAT MATTERS. A request attributable to no office must be
  // REPORTED, not dropped: dropping it makes the total smaller than reality
  // while every individual DAC row still looks correct.
  ok('unattributable requests are counted, not discarded',
     r.data.meta.unattributed.count === 2, r.data.meta.unattributed);
  ok('with their amounts', r.data.meta.unattributed.committed === 1500,
     r.data.meta.unattributed.committed);
  ok('and their IDs, so they can be found and fixed',
     r.data.meta.unattributed.requestIds.join(',') === 'O5,O6',
     r.data.meta.unattributed.requestIds);

  // A blank status is not a committed status.
  ok('a blank status commits nothing',
     !by.OMD.committed || by.OMD.committed === 5000,
     'O1 has no status and must not be counted');
}

// ---------------------------------------------------------------------------
console.log('\n5. it degrades honestly rather than reporting zero');
{
  // A database that cannot be read must not take the page down — baselines
  // and set-asides are configuration and still render. But the commitment
  // figures are ABSENT, not zero, and the payload has to say which.
  const t = load([], { dbThrows: true });
  const r = t.run('getBudgetDashboard()');
  ok('an unreadable database still renders baselines', r.success === true, r.error);
  ok('and the totals are intact', r.data.totals.baseline === 997000);
  ok('but liveSpend is false', r.data.meta.liveSpend === false,
     'zero commitments and unknown commitments are different claims');
  ok('and the error is carried through', /unreachable/.test(r.data.meta.spendError || ''),
     r.data.meta.spendError);

  // A Requests tab missing its key columns is the same class of problem.
  const missing = load([['R1', 'x']], { headers: ['Request_ID', 'Trip_Name'] });
  const mr = missing.run('getBudgetDashboard()');
  ok('a Requests tab without Status degrades', mr.success === true);
  ok('and logs why', missing.logs.some(l => /lacks Status/.test(l)), missing.logs);

  // Columns resolved BY NAME: a reordered sheet must still work.
  const shuffled = load(
    [[5000, 'PENDING_SECTOR', 'R1', 'FCA', 'OMD', 'Trip']],
    { headers: ['Grand_Total', 'Status', 'Request_ID', 'Owning_Org_Code',
                'Owning_Office', 'Trip_Name'] });
  const sr = shuffled.run('getBudgetDashboard()');
  const omd = sr.data.offices.find(o => o.officeCode === 'OMD');
  ok('a reordered Requests tab still resolves', omd.committed === 5000,
     omd.committed);
}

// ---------------------------------------------------------------------------
console.log('\n6. the payload admits what it does not know');
{
  const t = load([]);
  const r = t.run('getBudgetDashboard()');
  const m = r.data.meta;

  // The mockup's "Posted Actuals / Liquidated post-travel" card implied a
  // reconciliation step that did not exist. One partly exists now — the
  // existing-travel importer posts Amount Approved into Actual_Total for the
  // rows it can match — so the note is no longer a constant and reports the
  // split instead. §6b below covers the mixed case, which is the one a reader
  // can actually be misled by.
  ok('with no completed travel it says exactly that',
     /No completed travel yet/.test(m.actualsNote), m.actualsNote);

  const unreconciled = load([row('C1', 'COMPLETED', 'IDV', 'FCB', 5000)]);
  const mu = unreconciled.run('getBudgetDashboard()').data.meta;
  ok('on a database with no Actual_Total column at all, it says so plainly',
     /approved estimate/.test(mu.actualsNote) &&
     /not a liquidated actual|none of this figure/.test(mu.actualsNote),
     mu.actualsNote);

  // Allocations are now admin-set and versioned by effective date, so a
  // mid-year change is a row rather than a deploy. @clolry: "each year (or
  // even mid-year if budgets change) we can update the numbers."
  ok('allocations are reported as editable', m.allocationsEditable === true);

  // With no rows in the database, every figure is a CONFIG FALLBACK and must
  // say so. An unconfirmed number must not look like one an admin set.
  ok('an empty allocations tab reports config-fallback',
     m.allocationSource === 'config-fallback', m.allocationSource);
  ok('and every office is individually marked',
     r.data.offices.every(o => o.allocationSource === 'config-fallback'));
  ok('and the note tells the admin to set the real figures',
     /No admin-set allocations yet/.test(m.adjustmentsNote), m.adjustmentsNote);

  // Baselines are config until set. Worth saying: a reader seeing live
  // commitment figures reasonably assumes the allocations are live too.
  ok('it names BudgetConfig as the source of the baselines',
     /BudgetConfig\.js/.test(m.baselineSource), m.baselineSource);

  ok('and reports the fiscal year', m.fiscalYear === 'FY27', m.fiscalYear);

  // Statuses seen, so an unrecognized one in the sheet is diagnosable rather
  // than silently uncounted.
  const seen = load([row('R1', 'SOME_NEW_STATUS', 'OMD', 'FCA', 500)]);
  const sr = seen.run('getBudgetDashboard()');
  ok('unrecognized statuses are reported in meta',
     sr.data.meta.statusesSeen.SOME_NEW_STATUS === 1,
     sr.data.meta.statusesSeen);
  ok('and counted against no office',
     sr.data.totals.committed === 0, sr.data.totals.committed);
}

// ---------------------------------------------------------------------------
console.log('\n6b. a reconciled actual replaces the estimate, and blank is NOT zero');
{
  // WHAT THE EXISTING-TRAVEL IMPORTER CHANGED HERE.
  //
  // Before it, every "completed" figure was an approved estimate. The
  // importer posts Amount Approved — what GSA actually paid — into
  // Actual_Total for rows it can match, so the completed total is now a MIX,
  // and the dashboard has to prefer the reconciled figure without losing the
  // unreconciled ones.
  const t = load([
    // Reconciled: GSA paid 959.99 against a 1044.34 estimate.
    rowRec('C1', 'COMPLETED', 'IDV', 'FCB', 1044.34, 959.99),
    // NOT reconciled: blank actual. Must still count at its estimate.
    rowRec('C2', 'COMPLETED', 'IDV', 'FCB', 2000, ''),
    // Committed travel has not happened, so an actual on it is a
    // contradiction and must be ignored.
    rowRec('A1', 'APPROVED_GOGOV', 'OMD', 'FCA', 500, 123.45)
  ], { headers: REQ_HEADERS_RECONCILED });

  const r = t.run('getBudgetDashboard()');
  const by = {};
  r.data.offices.forEach(o => { by[o.officeCode] = o; });

  // 959.99 (paid) + 2000 (estimate, unreconciled) = 2959.99.
  ok('the reconciled actual replaces its estimate',
     by.IDV.completed === 2959.99, by.IDV.completed);

  // THE BLANK TRAP. `parseFloat('')` is NaN but `Number('')` is 0 — so a
  // naive coercion would count C2 as $0 and report IDV's spend as 959.99
  // instead of 2959.99. Every unreconciled completed trip would vanish from
  // the figure while the dashboard still looked entirely plausible.
  ok('a BLANK actual does not zero out the estimate',
     by.IDV.completed !== 959.99,
     'blank means "not reconciled yet", not "cost nothing"');

  ok('a committed row keeps its estimate even if an actual is present',
     by.OMD.committed === 500, by.OMD.committed);
  ok('and the stray actual does not leak into the actual bucket',
     by.OMD.completed === 0, by.OMD.completed);

  // THE SPLIT IS REPORTED. A total that mixes paid and estimated figures,
  // while calling itself either one, misrepresents part of itself — and the
  // reader has no way to tell which part.
  const ab = r.data.meta.actualBasis;
  ok('the payload counts how many actuals are reconciled', ab.reconciled === 1, ab);
  ok('and how many are still estimates', ab.estimated === 1, ab);
  ok('with the amount behind each', ab.reconciledAmount === 959.99 &&
     ab.estimatedAmount === 2000, ab);
  ok('and the note states the mix rather than claiming one or the other',
     /1 of 2/.test(r.data.meta.actualsNote) &&
     /Amount Approved/.test(r.data.meta.actualsNote) &&
     /approved estimate/.test(r.data.meta.actualsNote),
     r.data.meta.actualsNote);

  // The all-reconciled case must not keep hedging.
  const allRec = load([rowRec('C1', 'COMPLETED', 'IDV', 'FCB', 1044.34, 959.99)],
                      { headers: REQ_HEADERS_RECONCILED });
  ok('when everything is reconciled it says so without hedging',
     /All 1 completed trip\(s\) are reconciled/.test(
       allRec.run('getBudgetDashboard()').data.meta.actualsNote),
     allRec.run('getBudgetDashboard()').data.meta.actualsNote);
}

// ---------------------------------------------------------------------------
console.log('\n7. the page is actually wired to it');
{
  const page = fs.readFileSync('lets_app/client/pages/travelBudgetDashboardPage.html', 'utf8');

  ok('the page calls getBudgetDashboard',
     /serverCall\('getBudgetDashboard'\)/.test(page));
  ok('and includes serverCall', /include\('client\/shared\/serverCall'\)/.test(page));

  // THE POINT OF THE EXERCISE. Every hardcoded dollar figure in the KPI cards
  // and the DAC table must be gone, or a stale literal sits beside a live one
  // and nobody can tell which is which.
  const kpiBlock = page.slice(page.indexOf('Executive KPI Grid'),
                              page.indexOf('Two-Column Governance Section'));
  const literals = kpiBlock.match(/\$[0-9][0-9,]{2,}/g) || [];
  ok('no hardcoded dollar figures remain in the KPI or DAC sections',
     literals.length === 0, literals);

  ok('KPI values have IDs to be filled at runtime',
     /id="kpiBaseline"/.test(page) && /id="kpiAvailable"/.test(page));
  ok('the DAC table body is built from data',
     /id="dacTableBody"/.test(page));
  ok('and a failed load is visible', /id="bdError"/.test(page));

  // The honesty requirements, carried into the UI.
  ok('the page surfaces unattributed requests',
     /unattributed/i.test(page),
     'a request belonging to no DAC must not vanish from the page either');
  ok('and says estimates are not liquidated actuals',
     /actualsNote/.test(page));

  // The set-aside table was hardcoded too, which meant a BudgetConfig change
  // moved the DAC balances and left that table stating the old amounts.
  ok('the set-aside table is built from the payload',
     /id="setAsideTableBody"/.test(page) && /setAsides\.lines/.test(page));

  // The stub button must not claim success. It alerted "Sync complete"
  // without doing anything.
  ok('the FAS sync button admits it is a stub',
     /Not yet implemented/.test(page) && !/Sync complete/.test(page));

  // A CI guard now prevents this page regressing to literals. Asserted here
  // too, so deleting the guard does not silently remove the protection.
  const wf = fs.readFileSync('.github/workflows/verify.yml', 'utf8');
  ok('CI guards against reintroducing hardcoded currency',
     /must not hardcode dollar figures/.test(wf));
}

// ---------------------------------------------------------------------------
console.log('\n8. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/40_domain/BudgetDashboard.js', 'utf8');

  // 8a — count denied requests as commitments. §3 must fail.
  const countsDenied = src.replace(
    'if (!isCommitted && !isActual) return;    // denied, cancelled, draft',
    'if (!isCommitted && !isActual) { isCommitted = true; }');
  ok('negative control patched the status filter', countsDenied !== src);
  {
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN
    });
    vm.runInContext(`
      function successResponse(d) { return { success: true, data: d }; }
      function errorResponse(m) { return { success: false, error: m }; }
    `, ctx);
    ['01_constants/Status.js', '01_constants/Sheets.js', '00_config/BudgetConfig.js']
      .forEach(f => vm.runInContext(fs.readFileSync('lets_app/server/' + f, 'utf8'), ctx));
    const headers = REQ_HEADERS;
    const headerIndex = {};
    headers.forEach((h, i) => { headerIndex[h] = i; });
    vm.runInContext('var __D = ' + JSON.stringify({
      headers, rows: [row('D1', 'DENIED', 'CM', 'FCC', 99999)], headerIndex
    }) + '; function TravelDB() { this.readSheet = function () { return __D; }; }', ctx);
    vm.runInContext(countsDenied, ctx, { filename: 'BudgetDashboard.js (counts denied)' });
    const r = vm.runInContext('getBudgetDashboard()', ctx);
    const cm = r.data.offices.find(o => o.officeCode === 'CM');
    ok('a patched build does count a denied request', cm.committed === 99999,
       'so section 3 is exercising a real filter');
  }

  // 8b — drop unattributable requests instead of reporting them. §4 must fail.
  //
  // THE PATCH TARGET MUST BE UNIQUE. `out.unattributed.count++;` at the same
  // indentation now appears TWICE — once in spendByOffice and once in
  // spendByServiceCenter — and String.replace takes the first match, which is
  // the service-center one. This control therefore passed while patching code
  // §4 does not exercise: a negative control that proves nothing, which is
  // worse than none because it is counted as evidence. Anchored on the
  // following line, which is unique to spendByOffice.
  const dropTarget = `        out.unattributed.count++;
        if (isCommitted) out.unattributed.committed += amount;`;
  ok('the patch target is unique to spendByOffice',
     src.split(dropTarget).length === 2, src.split(dropTarget).length - 1);
  const drops = src.replace(dropTarget,
    `        out.unattributed.count += 0;
        if (isCommitted) out.unattributed.committed += amount;`);
  ok('negative control patched the unattributed counter', drops !== src);
  {
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN
    });
    vm.runInContext(`
      function successResponse(d) { return { success: true, data: d }; }
      function errorResponse(m) { return { success: false, error: m }; }
    `, ctx);
    ['01_constants/Status.js', '01_constants/Sheets.js', '00_config/BudgetConfig.js']
      .forEach(f => vm.runInContext(fs.readFileSync('lets_app/server/' + f, 'utf8'), ctx));
    const headerIndex = {};
    REQ_HEADERS.forEach((h, i) => { headerIndex[h] = i; });
    vm.runInContext('var __D = ' + JSON.stringify({
      headers: REQ_HEADERS, rows: [row('Z1', 'PENDING_SECTOR', '', 'ZZZ', 700)], headerIndex
    }) + '; function TravelDB() { this.readSheet = function () { return __D; }; }', ctx);
    vm.runInContext(drops, ctx, { filename: 'BudgetDashboard.js (drops)' });
    const r = vm.runInContext('getBudgetDashboard()', ctx);
    ok('a patched build loses the unattributed request silently',
       r.data.meta.unattributed.count === 0,
       'so section 4 is exercising a real guard');
  }
}

// ---------------------------------------------------------------------------
console.log('\n10. the service center table is RENDERED, not just computed');
{
  // @clolry: "Let's finish the per-capita model so we can get a report that
  // shows the budget allocations (and pending/actual spend) by service center.
  // I want that to be a part of the budget dashboard page asap."
  //
  // THE PAYLOAD WAS ALREADY THERE. getBudgetDashboard has returned a full
  // `serviceCenters` block — 22 rows, allocations footing to each DAC's
  // discretionary base — and the page read only `d.offices`, the four DACs.
  // The per-center split was visible nowhere but showServiceCenterHeadcount()
  // in the Apps Script editor.
  //
  // So this section RUNS the page's renderer rather than grepping it. A
  // source-text assertion would pass on a renderer that throws, and the whole
  // defect being fixed is "the data exists and nobody sees it".
  const PAGE = 'lets_app/client/pages/travelBudgetDashboardPage.html';
  const html = fs.readFileSync(PAGE, 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]);
  const page = scripts[scripts.length - 1];

  // The page's script is an IIFE, so its functions are not reachable from
  // outside. Export from INSIDE it by splicing before the closing '})();'.
  const close = page.lastIndexOf('})();');
  ok('the page script is an IIFE with a findable close', close > 0);

  const els = {};
  function mkEl(id) {
    return {
      id: id, innerHTML: '', textContent: '', value: '',
      options: { length: 1 }, style: {}, dataset: {},
      classList: { add() {}, remove() {} },
      appendChild(c) { this.options.length++; (this._kids = this._kids || []).push(c); },
      addEventListener() {}, querySelectorAll: () => [], closest: () => null
    };
  }
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt,
    parseFloat, RegExp, Error, Boolean, setTimeout, clearTimeout,
    document: {
      getElementById: (id) => (els[id] || (els[id] = mkEl(id))),
      createElement: () => ({ value: '', textContent: '' }),
      addEventListener() {}, querySelectorAll: () => []
    },
    window: { _letsBranding: {} },
    google: { script: { run: {
      withSuccessHandler() { return this; },
      withFailureHandler() { return this; }
    } } },
    // Provided by travelUtils.html in the real app.
    serverCall: () => ({ then() { return this; }, catch() { return this; } }),
    escapeHtml: (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  };
  sandbox.module = { exports: {} };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(
    page.slice(0, close) +
    '\nmodule.exports={renderServiceCenters,dacSubtotalRow,money,renderBudget};\n' +
    page.slice(close),
    ctx, { filename: 'travelBudgetDashboardPage.js' });
  const UI = sandbox.module.exports;
  ok('the renderer is defined',
     typeof UI.renderServiceCenters === 'function');

  // A payload shaped like the real one: two DACs, an above-center bucket, a
  // DEFICIT center, and a reconciliation gap on one DAC.
  const payload = {
    offices: [
      { orgCode: 'FCA', officeName: 'Office of Portfolio Management' },
      { orgCode: 'FCB', officeName: 'Office of IDV Management' }
    ],
    serviceCenters: {
      available: true, basis: 'FILLED',
      headcountSource: 'HC_Positions, 1046 positions',
      note: 'Each DAC\u2019s available balance divided by its share of FILLED positions.',
      rows: [
        { orgCode: '', dacOrgCode: 'FCA', isAboveServiceCenter: true,
          displayName: '', filled: 12, vacant: 2, authorized: 14, sharePct: 9.3,
          allocation: 5725, committed: 0, committedCount: 0, completed: 0,
          completedCount: 0, remaining: 5725, isDeficit: false, utilizationPct: 0 },
        { orgCode: 'FCA0A', dacOrgCode: 'FCA', isAboveServiceCenter: false,
          displayName: 'Portfolio Management Service Center', filled: 30,
          vacant: 4, authorized: 34, sharePct: 23.3, allocation: 14312.5,
          committed: 2500, committedCount: 3, completed: 1200, completedCount: 2,
          remaining: 10612.5, isDeficit: false, utilizationPct: 25.9 },
        { orgCode: 'FCA0B', dacOrgCode: 'FCA', isAboveServiceCenter: false,
          displayName: 'Stakeholder Connection and Engagement Service Center',
          filled: 28, vacant: 1, authorized: 29, sharePct: 21.7,
          allocation: 13350, committed: 14000, committedCount: 9, completed: 900,
          completedCount: 1, remaining: -1550, isDeficit: true,
          utilizationPct: 111.6 },
        { orgCode: 'FCB0A', dacOrgCode: 'FCB', isAboveServiceCenter: false,
          displayName: 'IDV Implementation Service Center', filled: 40,
          vacant: 3, authorized: 43, sharePct: 100, allocation: 306700,
          committed: 5000, committedCount: 4, completed: 0, completedCount: 0,
          remaining: 301700, isDeficit: false, utilizationPct: 1.6 }
      ],
      byDac: {
        FCA: { officeCode: 'OMD', pool: 61587.5, filled: 129, authorized: 140,
               allocated: 61587.5, unallocated: 0,
               spendReconciliation: { centerCommitted: 16500, centerCompleted: 2100,
                 officeCommitted: 16500, officeCompleted: 2100, unexplained: 0 } },
        FCB: { officeCode: 'IDV', pool: 306700, filled: 40, authorized: 43,
               allocated: 306700, unallocated: 0,
               spendReconciliation: { centerCommitted: 5000, centerCompleted: 0,
                 officeCommitted: 5400, officeCompleted: 0, unexplained: 400 } }
      }
    }
  };

  UI.renderServiceCenters(payload);
  const out = els.scTableBody.innerHTML;

  // EVERY CENTER APPEARS. A reader scanning for their own center and not
  // finding it cannot tell "no budget" from "not in the report".
  ['FCA0A', 'FCA0B', 'FCB0A'].forEach(code => {
    ok(code + ' is in the table', out.indexOf(code) > -1);
  });
  ok('and so is its display name',
     out.indexOf('Portfolio Management Service Center') > -1);

  // THE FIGURES @clolry ASKED FOR: allocation, pending, actual.
  ok('the allocation is shown', out.indexOf('$14,313') > -1, out.slice(0, 400));
  ok('pending spend is shown', out.indexOf('$2,500') > -1);
  ok('actual spend is shown', out.indexOf('$1,200') > -1);
  ok('and the request counts beside them', out.indexOf('(3)') > -1);

  // A DEFICIT MUST READ AS NEGATIVE MONEY. money() was '$' + value, so -1550
  // rendered '$-1,550' — not how anyone writes money, and at a glance it
  // reads as positive with stray punctuation. Reachable all along: a DAC can
  // be overspent (BudgetDashboard.js:1042) and so can a center (:599); there
  // had simply never been a negative balance while anyone was looking.
  ok('a deficit renders as -$1,550, not $-1,550',
     out.indexOf('-$1,550') > -1 && out.indexOf('$-1,550') === -1,
     'the sign belongs before the symbol');
  ok('and is colored as a deficit', /text-danger/.test(out));

  // GROUPED BY DAC WITH A SUBTOTAL, because an allocation is a share of its
  // OWN DAC's pool. Ranking all 22 by dollars compares numbers with no common
  // denominator.
  ok('each DAC gets a header row',
     out.indexOf('Office of Portfolio Management') > -1 &&
     out.indexOf('Office of IDV Management') > -1);
  ok('and a subtotal row that foots to the pool',
     out.indexOf('Office of Portfolio Management total') > -1 &&
     out.indexOf('$61,588') > -1,
     'the subtotal is what makes the block checkable on sight');
  ok('shares sum to 100% in the subtotal', out.indexOf('100%') > -1);

  // ABOVE-CENTER STAFF ARE LABELED, NOT DROPPED. They hold a real
  // allocation, so omitting them would make the block's shares fail to sum to
  // 100% and the table would look broken.
  ok('staff above any service center are labeled',
     out.indexOf('Above any service center') > -1,
     'they hold an allocation; dropping them breaks the block arithmetic');

  // VACANCIES ARE VISIBLE BUT NOT COUNTED. The split divides by FILLED.
  ok('vacant seats are shown beside the filled count',
     out.indexOf('vac') > -1);

  // THE RECONCILIATION GAP IS SHOWN, not hidden. The two tables count at
  // different grains, so a gap is expected — and an unexplained difference a
  // reader finds for themselves reads as a bug in both numbers.
  ok('a spend gap against the DAC table is disclosed',
     /Office of IDV Management \$400/.test(els.scFooter.innerHTML),
     els.scFooter.innerHTML.slice(0, 300));
  ok('and the reason for it is given',
     /different grains/.test(els.scFooter.innerHTML));

  ok('the basis line names the headcount source',
     /FILLED/.test(els.scBasis.textContent) &&
     /HC_Positions/.test(els.scBasis.textContent), els.scBasis.textContent);
  ok('the badge counts service centers, not buckets',
     els.scCountBadge.textContent.indexOf('3 service centers') > -1,
     'the above-center bucket is not a service center');

  // UNAVAILABLE IS NOT EMPTY. serviceCenterAllocations returns a REASON when
  // the roster is missing; a blank table would read as "no service centers",
  // which is a claim rather than an absence of one.
  UI.renderServiceCenters({ offices: [],
    serviceCenters: { available: false, note: 'Import the roster first.' } });
  ok('an unavailable split explains itself',
     els.scTableBody.innerHTML.indexOf('Import the roster first.') > -1,
     els.scTableBody.innerHTML);
  ok('and does not leave stale rows on screen',
     els.scTableBody.innerHTML.indexOf('FCA0A') === -1,
     'stale allocations beside a failure read as current');

  // NEGATIVE CONTROL: the table must be able to come out empty. Without this,
  // every assertion above would pass against a renderer that emitted the
  // whole payload as one undifferentiated blob.
  UI.renderServiceCenters({ offices: [],
    serviceCenters: { available: true, rows: [], byDac: {}, basis: 'FILLED',
                      headcountSource: '', note: '' } });
  ok('an available split with no rows says so',
     /No rows/.test(els.scTableBody.innerHTML),
     els.scTableBody.innerHTML);

  // THE RENDERER MUST ACTUALLY BE CALLED. Everything above exercises it
  // directly, so it would all pass on a page that defines the function and
  // never invokes it — which is a hair's breadth from the defect being fixed,
  // where the data existed and nothing rendered it.
  //
  // Asserted by RUNNING renderBudget with a full payload and checking the
  // service center table filled in, rather than grepping for the call. A grep
  // would pass on a call inside dead code.
  const fullPayload = Object.assign({}, payload, {
    totals: { baseline: 0, setAsides: 0, discretionaryBase: 0, committed: 0,
              completed: 0, available: 0, committedCount: 0, completedCount: 0 },
    meta: { fiscalYear: 'FY27', liveSpend: true, requestsRead: 0,
            adjustmentsNote: '', actualsNote: '', baselineSource: '',
            unattributed: {} }
  });
  fullPayload.offices = payload.offices.map(o => Object.assign({
    officeCode: o.orgCode, baselineAllocation: 0, proportionalShare: 0,
    setAsides: { total: 0, lines: [] }, discretionaryBase: 0, committed: 0,
    committedCount: 0, completed: 0, available: 0, isDeficit: false,
    utilizationPct: null
  }, o));

  els.scTableBody.innerHTML = '';
  // Exported through the same splice as the others: renderBudget lives
  // inside the page's IIFE, so vm.runInContext cannot see it from outside.
  ok('renderBudget is reachable', typeof UI.renderBudget === 'function');
  UI.renderBudget(fullPayload);
  ok('renderBudget populates the service center table',
     els.scTableBody.innerHTML.indexOf('FCA0A') > -1,
     'a renderer nobody calls is the defect this section exists for');

  // And money() itself, directly — the function the deficit bug was in.
  ok('money formats a positive figure', UI.money(1234) === '$1,234');
  ok('money formats a negative figure', UI.money(-1234) === '-$1,234');
  ok('money returns an em-dash for null, not $0',
     UI.money(null) === '\u2014',
     'a zero balance is a claim; an unknown balance is not');
}

// ---------------------------------------------------------------------------
console.log('\n11. per-center spend prefers the reconciled actual');
{
  // @clolry: "I'm showing actual approved expenses of $30,245.55 and the
  // budget sheet is showing 22650. Also, none of the planned or actual costs
  // are being applied to the service center allocations and spend table."
  //
  // TWO INDEPENDENT CAUSES.
  //
  // The table was EMPTY because spendByServiceCenter reads Request_Travelers
  // and ONLY that sheet — and neither importer wrote traveler rows. That is
  // not a display bug; there was nothing to read. Fixed in both importers.
  //
  // The figure was WRONG because this function summed Subtotal for both
  // buckets and never looked at Actual_Total. spendByOffice has preferred the
  // reconciled figure since the importer landed; this function was written
  // before that and never got the same treatment. So two tables on one page
  // disagreed, each claiming to show actual spend.
  //
  // SCALED, NOT SUBSTITUTED. The reconciled figure is a REQUEST total and
  // this loop attributes per TRAVELER, so applying it whole to each traveler
  // would multiply a shared trip by its headcount.
  const S = __dirname + '/server/';

  const seed = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt,
    parseFloat, RegExp, Error, Boolean
  });
  vm.runInContext('var TRAVEL_DB_SPREADSHEET_ID=null;var SHEET_NAMES={};' +
                  'var TRAVEL_SHEET_SCHEMAS={};', seed);
  vm.runInContext(fs.readFileSync(S + '91_setup/HCSeed.js', 'utf8'), seed);
  const ORGS = vm.runInContext('hcRealOrgRecords()', seed);

  function run(trips) {
    const sb = {
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt,
      parseFloat, RegExp, Error, Boolean
    };
    const ctx = vm.createContext(sb);
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';", ctx);
    ['01_constants/Sheets.js', '01_constants/Status.js',
     '01_constants/HCRules.js', '00_config/BudgetConfig.js',
     '20_data/HCData.js'].forEach(f => {
      vm.runInContext(fs.readFileSync(S + f, 'utf8'), ctx, { filename: f });
    });
    const REQ_H = vm.runInContext("TRAVEL_SHEET_SCHEMAS['Requests']", ctx);
    const TRV_H = vm.runInContext("TRAVEL_SHEET_SCHEMAS['Request_Travelers']", ctx);

    const reqRows = trips.map(t => {
      const rec = {
        'Request_ID': t.id, 'Status': t.status, 'Grand_Total': t.est,
        'Owning_Org_Code': t.org, 'Owning_Office': '',
        'Actual_Total': t.act === null ? '' : t.act
      };
      return REQ_H.map(h => h in rec ? rec[h] : '');
    });
    // One traveler row per trip unless the fixture says otherwise.
    const trvRows = [];
    trips.forEach(t => {
      (t.travelers || [{ org: t.org, sub: t.est }]).forEach((tr, n) => {
        const rec = {
          'Request_ID': t.id, 'Traveler_ID': t.id + '-T' + (n + 1),
          'Org_Code': tr.org, 'Subtotal': tr.sub
        };
        trvRows.push(TRV_H.map(h => h in rec ? rec[h] : ''));
      });
    });
    const mk = (h, r) => {
      const ix = {}; h.forEach((c, i) => ix[c] = i);
      return { headers: h, rows: r, headerIndex: ix };
    };
    vm.runInContext(
      'var __orgs=' + JSON.stringify(ORGS) + ';' +
      'HC.hcGetOrgHierarchy=function(){return __orgs;};' +
      'HC.hcGetBundle=function(){return {success:true,data:[]};};' +
      'var __sheets={Requests:' + JSON.stringify(mk(REQ_H, reqRows)) + ',' +
      'Request_Travelers:' + JSON.stringify(mk(TRV_H, trvRows)) + '};' +
      'function TravelDB(){}' +
      'TravelDB.prototype.readSheet=function(n){return __sheets[n]||' +
      '{headers:[],rows:[],headerIndex:{}};};' +
      'function BudgetAdmin(){}', ctx);
    vm.runInContext(fs.readFileSync(S + '40_domain/BudgetDashboard.js', 'utf8'),
                    ctx, { filename: 'BudgetDashboard.js' });
    return JSON.parse(vm.runInContext(
      'JSON.stringify(BudgetDashboard.spendByServiceCenter(new TravelDB()))', ctx));
  }

  // @clolry's real shape: estimate and actual differ, in both directions.
  const out = run([
    { id: 'R1', org: 'FCBAA', est: 1581.81, act: 1563.83, status: 'COMPLETED' },
    { id: 'R2', org: 'FCA0B', est: 9000.00, act: 11200.00, status: 'COMPLETED' },
    { id: 'R3', org: 'FCC0C', est: 4500.00, act: null, status: 'APPROVED_GOGOV' }
  ]);
  ok('all three traveler rows are read', out.travelersRead === 3, out.travelersRead);
  ok('the split is available', out.available === true, out.note);

  // THE ACTUAL IS THE VOUCHER, NOT THE ESTIMATE.
  ok('an under-spend reports the voucher, not the estimate',
     out.byOrgCode['FCB|FCBAA'].actual === 1563.83,
     out.byOrgCode['FCB|FCBAA']);
  ok('and an OVER-spend does too',
     out.byOrgCode['FCA|FCA0B'].actual === 11200,
     'reporting 9000 would understate it by 2200');

  // A COMMITTED TRIP KEEPS ITS ESTIMATE. It has not happened, so there is no
  // actual to prefer — and an actual on a committed row would be a
  // contradiction.
  ok('a committed trip counts at its estimate',
     out.byOrgCode['FCC|FCC0C'].committed === 4500 &&
     out.byOrgCode['FCC|FCC0C'].actual === 0, out.byOrgCode['FCC|FCC0C']);

  // THE TOTALS MUST EQUAL WHAT GSA PAID. This is the number @clolry
  // reconciles against.
  const totalActual = Object.keys(out.byOrgCode)
    .reduce((s, k) => s + out.byOrgCode[k].actual, 0);
  ok('per-center actuals total the vouchers exactly',
     Math.round(totalActual * 100) / 100 === 12763.83, totalActual);

  // BLANK IS NOT ZERO. A completed trip with no voucher yet must keep its
  // estimate, or a DAC's spend reads far lower than it is.
  const noVoucher = run([
    { id: 'R9', org: 'FCBAA', est: 2000, act: null, status: 'COMPLETED' }
  ]);
  ok('a completed trip with no actual keeps its estimate',
     noVoucher.byOrgCode['FCB|FCBAA'].actual === 2000,
     'treating blank as zero would wipe the estimate off every ' +
     'unreconciled completed trip');

  // SCALED ACROSS A SHARED TRIP. @clolry's log is one traveler per trip, but
  // a Go.gov consolidated conference request has several and this function
  // reads both sources. Applying the request actual whole to each traveler
  // would multiply it by the headcount.
  const shared = run([{
    id: 'R5', org: 'FCA0B', est: 10000, act: 8000, status: 'COMPLETED',
    travelers: [{ org: 'FCA0B', sub: 6000 }, { org: 'FCC0C', sub: 4000 }]
  }]);
  const sharedTotal = Object.keys(shared.byOrgCode)
    .reduce((s, k) => s + shared.byOrgCode[k].actual, 0);
  ok('a two-traveler trip totals the request actual, not twice it',
     Math.round(sharedTotal * 100) / 100 === 8000, sharedTotal);
  ok('and each traveler keeps their SHARE of it',
     shared.byOrgCode['FCA|FCA0B'].actual === 4800 &&
     shared.byOrgCode['FCC|FCC0C'].actual === 3200,
     '60/40 of 8000, matching their 6000/4000 estimates');

  // BOTH IMPORTERS MUST WRITE TRAVELER ROWS, or this function has nothing to
  // read and the table is empty however correct the arithmetic is.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  [['40_domain/LiabilityLogAdmin.js', 'the FY27 travel log importer'],
   ['40_domain/TravelImportAdmin.js', 'the Go.gov importer']
  ].forEach(([file, what]) => {
    const code = strip(fs.readFileSync(S + file, 'utf8'));
    ok(what + ' writes Request_Travelers rows',
       /SHEET_NAMES\.REQUEST_TRAVELERS/.test(code) &&
       /travRows/.test(code),
       'without a traveler row a trip is invisible to the per-center table');
    ok(what + ' refuses when that tab is missing',
       /REQUEST_TRAVELERS \+ ' tab not found/.test(code),
       'writing Requests rows with no traveler rows is the silent version ' +
       'of this bug');
    ok(what + ' invalidates the traveler cache',
       /REQUEST_TRAVELERS/.test(code.slice(code.indexOf('invalidate') - 400)),
       'a stale cache looks exactly like the import having failed');
  });
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
