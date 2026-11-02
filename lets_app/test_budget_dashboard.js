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
console.log('\n2. the arithmetic reproduces the mockup\'s intent exactly');
{
  // The mockup's set-aside figures were computed by hand by whoever built it:
  // OMD $15,060, IDV $25,280, CM $68,160, total $108,500. If this code agrees
  // to the cent, the formula matches what @clolry has been reading.
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

  // $12k LC + 15.3% of the $20k FO gap = $15,060.
  ok('OMD set-asides are $15,060', by.OMD.setAsides.total === 15060,
     by.OMD.setAsides);
  ok('IDV set-asides are $25,280', by.IDV.setAsides.total === 25280,
     by.IDV.setAsides);
  // $12k LC + $52.5k COE + 18.3% of $20k = $68,160.
  ok('CM set-asides are $68,160', by.CM.setAsides.total === 68160,
     by.CM.setAsides);
  ok('total set-asides are $108,500', r.data.totals.setAsides === 108500,
     r.data.totals.setAsides);

  // THE FRONT OFFICE MUST NOT CARRY A SHARE OF ITS OWN GAP. Charging it would
  // be circular, and the mockup correctly showed $0.
  ok('the Front Office carries no set-asides', by.FO.setAsides.total === 0,
     by.FO.setAsides);
  ok('and the shared line is attributed to DACs only',
     by.OMD.setAsides.enterpriseShared === 3060 &&
     by.IDV.setAsides.enterpriseShared === 13280 &&
     by.CM.setAsides.enterpriseShared === 3660,
     [by.OMD.setAsides.enterpriseShared, by.IDV.setAsides.enterpriseShared,
      by.CM.setAsides.enterpriseShared]);

  // The three DAC shares must account for the whole shared set-aside, or the
  // enterprise cost is under-recovered and nobody notices.
  const sharedSum = by.OMD.setAsides.enterpriseShared +
                    by.IDV.setAsides.enterpriseShared +
                    by.CM.setAsides.enterpriseShared;
  ok('and the three shares sum to the full $20,000', sharedSum === 20000, sharedSum);
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
  ok('available subtracts both', by.OMD.available === 136940 - 5000,
     by.OMD.available);
  ok('and utilisation is a percentage of the discretionary base',
     by.OMD.utilisationPct === 3.7, by.OMD.utilisationPct);
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
  // reconciliation step. LETS has none — COMPLETED carries the approved
  // estimate. Presenting an estimate as a liquidated actual is a claim the
  // system cannot support.
  ok('it states there is no reconciliation step',
     /no post-travel reconciliation/.test(m.actualsNote), m.actualsNote);

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

  // Statuses seen, so an unrecognised one in the sheet is diagnosable rather
  // than silently uncounted.
  const seen = load([row('R1', 'SOME_NEW_STATUS', 'OMD', 'FCA', 500)]);
  const sr = seen.run('getBudgetDashboard()');
  ok('unrecognised statuses are reported in meta',
     sr.data.meta.statusesSeen.SOME_NEW_STATUS === 1,
     sr.data.meta.statusesSeen);
  ok('and counted against no office',
     sr.data.totals.committed === 0, sr.data.totals.committed);
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
  const drops = src.replace(
    `        out.unattributed.count++;`,
    `        out.unattributed.count += 0;`);
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

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
