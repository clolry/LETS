/**
 * Automated Verification Script for admin-maintained budget allocations
 * (40_domain/BudgetAdmin.js).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * @clolry: "we need a user interface where each year (or even mid-year if
 * budgets change) we can update the numbers for our overall group and each
 * subgroup (FCA, FCB, FCC) - this would be an admin function and not be open
 * to reviewers."
 *
 * Three things here fail silently and each would be costly:
 *
 * 1. THE ACCESS SPLIT. Reading is open to every user — @clolry: "budgeting
 *    info can be available to users at this point - no secrets to hide there."
 *    Writing is admin-only. Those are two functions, and §1 proves the write
 *    actually refuses rather than relying on the button being hidden.
 *
 * 2. APPEND, NEVER OVERWRITE. An in-place edit destroys the record of what the
 *    budget WAS, which makes a November approval indefensible if the ceiling
 *    was later cut. §3 proves history survives.
 *
 * 3. FUTURE-DATED ROWS MUST NOT TAKE EFFECT EARLY. Entering next year's
 *    budget in August must not move today's balances. §4.
 *
 * Run: node lets_app/test_budget_admin.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 260)); fails++; }
};

/**
 * Loads BudgetAdmin.js with a WRITABLE stub spreadsheet.
 *
 * Writes land in an in-memory sheet and are read back through the same
 * header-name resolution the real code uses, so the append-and-read-back
 * behavior is exercised rather than asserted.
 */
function load(opts) {
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
    var __ADMIN = ${opts.isAdmin === false ? 'false' : 'true'};
    function isTravelAdmin() { return __ADMIN; }
    var LOCK_TIMEOUT_MS = 30000;
    var __LOCK_FAILS = ${opts.lockFails ? 'true' : 'false'};
    var LockService = { getScriptLock: function () { return {
      waitLock: function () { if (__LOCK_FAILS) { throw new Error('busy'); } },
      releaseLock: function () {}
    }; } };
    var Session = { getActiveUser: function () {
      return { getEmail: function () { return '${opts.email || 'chris@gsa.gov'}'; } };
    } };
  `, ctx);

  ['01_constants/Status.js', '01_constants/Sheets.js', '00_config/BudgetConfig.js']
    .forEach(f => vm.runInContext(fs.readFileSync('lets_app/server/' + f, 'utf8'), ctx,
                                  { filename: f }));

  vm.runInContext(`
    var __S = {};
    var __NO_TAB = ${opts.noTab ? 'true' : 'false'};
    function __mk(name, headers) {
      __S[name] = { headers: headers, rows: [] };
      return {
        getLastRow: function () { return 1 + __S[name].rows.length; },
        getLastColumn: function () { return headers.length; },
        getRange: function (r, c, nr, nc) { return {
          setValues: function (v) { v.forEach(function (x) { __S[name].rows.push(x); }); },
          getValues: function () {
            var a = [headers].concat(__S[name].rows);
            return a.slice(r - 1, r - 1 + nr).map(function (y) { return y.slice(c - 1, c - 1 + nc); });
          }
        }; }
      };
    }
    var __H = {};
    Object.keys(TRAVEL_SHEET_SCHEMAS).forEach(function (k) {
      __H[k] = __mk(k, TRAVEL_SHEET_SCHEMAS[k]);
    });
    var __INVALIDATED = [];
    function TravelDB() {
      this.sheet = function (n) { return __NO_TAB ? null : (__H[n] || null); };
      this.readSheet = function (n) {
        var s = __S[n] || { headers: [], rows: [] };
        var hi = {}; s.headers.forEach(function (h, i) { hi[h] = i; });
        return { headers: s.headers, rows: s.rows, headerIndex: hi };
      };
      this.invalidate = function (n) { __INVALIDATED.push(n); };
    }
  `, ctx);

  vm.runInContext(fs.readFileSync('lets_app/server/40_domain/BudgetAdmin.js', 'utf8'),
                  ctx, { filename: 'BudgetAdmin.js' });
  return { ctx, run: e => vm.runInContext(e, ctx), logs };
}

const entry = (o, amt, eff, reason, fy) => ({
  officeCode: o, amount: amt, effectiveDate: eff,
  changeReason: reason || 'FY27 opening allocation', fiscalYear: fy || 'FY2027'
});

console.log('--- Budget admin test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. reading is open, writing is admin-only');
{
  // @clolry asked for both halves of this in one breath: "this would be an
  // admin function and not be open to reviewers" and, separately, "budgeting
  // info can be available to users at this point - no secrets to hide there -
  // we're trying to develop transparency."
  //
  // They are two functions so the distinction lives in the code rather than in
  // a parameter somebody could pass wrongly.
  const user = load({ isAdmin: false, email: 'reviewer@gsa.gov' });

  const read = user.run('getBudgetAllocations()');
  ok('a non-admin CAN read allocations', read.success === true, read.error);
  ok('and the payload says they cannot edit', read.data.canEdit === false);

  const write = user.run("saveBudgetAllocations([" +
    JSON.stringify(entry('OMD', 1, '2026-10-01')) + "])");
  ok('a non-admin CANNOT write', write.success === false);
  ok('and is told why', /Administrator access is required/.test(write.error), write.error);

  // The refusal must be LOGGED. This function is browser-reachable and writes
  // budget figures; an unexpected caller is worth seeing.
  ok('the refusal is logged',
     user.logs.some(l => /refused non-admin caller reviewer@gsa\.gov/.test(l)),
     user.logs);

  // Nothing may have been written.
  ok('and nothing reached the sheet',
     user.run('__S[SHEET_NAMES.BUDGET_ALLOCATIONS].rows.length') === 0);

  const admin = load({ isAdmin: true });
  ok('an admin can write',
     admin.run("saveBudgetAllocations([" +
       JSON.stringify(entry('OMD', 150000, '2026-10-01')) + "])").success === true);
  ok('and sees canEdit true', admin.run('getBudgetAllocations()').data.canEdit === true);

  // The guard must be on the SERVER function. A client-side check is a
  // convenience, never a control.
  const src = fs.readFileSync('lets_app/server/40_domain/BudgetAdmin.js', 'utf8');
  ok('the write function guards independently of the page',
     /function saveBudgetAllocations[\s\S]{0,400}isTravelAdmin\(email\)/.test(src));
  ok('and the read function does NOT guard',
     !/function getBudgetAllocations[\s\S]{0,300}return errorResponse\('Admin/.test(src),
     'reading is deliberately open');
}

// ---------------------------------------------------------------------------
console.log('\n2. the fiscal year starts on 1 October');
{
  // @clolry: "Our fiscal year began October 1st." Off by one day here
  // attributes a budget to the wrong year.
  const t = load();
  const fy = d => t.run('BudgetAdmin.fiscalYearOf(new Date(' + JSON.stringify(d) + '))');

  ok('1 October 2026 is FY2027', fy('2026-10-01T12:00:00') === 'FY2027', fy('2026-10-01T12:00:00'));
  ok('30 September 2026 is FY2026', fy('2026-09-30T12:00:00') === 'FY2026');
  ok('1 January 2027 is FY2027', fy('2027-01-01T12:00:00') === 'FY2027');
  ok('30 September 2027 is FY2027', fy('2027-09-30T12:00:00') === 'FY2027');
  ok('1 October 2027 is FY2028', fy('2027-10-01T12:00:00') === 'FY2028');

  // An effective date in the wrong fiscal year is almost always a typo in the
  // year, and it would put the money in a budget that is already closed.
  const probs = t.run("BudgetAdmin.validateAllocation(" +
    JSON.stringify(entry('OMD', 100, '2026-09-30')) + ", [])");
  ok('an effective date outside its fiscal year is rejected',
     probs.some(p => /falls in FY2026, not FY2027/.test(p)), probs);
  ok('and the message states the year boundary',
     probs.some(p => /1 October to 30 September/.test(p)), probs);
}

// ---------------------------------------------------------------------------
console.log('\n3. every change APPENDS — history is never destroyed');
{
  // An in-place edit destroys the only record of what the budget was. A
  // request approved in November against $152,000 looks over-budget if the
  // figure was later cut to $120,000, and nothing says the ceiling moved.
  const t = load();

  t.run("saveBudgetAllocations([" +
    JSON.stringify(entry('IDV', 659000, '2026-10-01', 'FY27 opening allocation')) + "])");
  t.run("saveBudgetAllocations([" +
    JSON.stringify(entry('IDV', 520000, '2027-03-01', 'Mid-year reduction per FAS guidance')) + "])");

  const rows = t.run('__S[SHEET_NAMES.BUDGET_ALLOCATIONS].rows.length');
  ok('both figures are stored as separate rows', rows === 2, rows);

  const read = t.run("getBudgetAllocations('FY2027')");
  ok('history is returned to the caller', read.data.history.length === 2);
  ok('newest first', read.data.history[0].effectiveDate === '2027-03-01',
     read.data.history.map(h => h.effectiveDate));
  ok('the original figure is still readable',
     read.data.history.some(h => h.amount === 659000));
  ok('with its reason intact',
     read.data.history.some(h => /FY27 opening allocation/.test(h.changeReason)));

  // The chain must be followable without sorting by date.
  ok('the newer row names the one it supersedes',
     !!read.data.history[0].supersedesId &&
     read.data.history[0].supersedesId === read.data.history[1].allocationId,
     [read.data.history[0].supersedesId, read.data.history[1].allocationId]);

  // The schema must not even OFFER an update column — having one invites the
  // edit this design exists to prevent.
  const sctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js', 'utf8'), sctx);
  const schema = vm.runInContext('TRAVEL_SHEET_SCHEMAS.Budget_Allocations', sctx);
  ok('the schema has no Updated_By column', schema.indexOf('Updated_By') === -1, schema);
  ok('nor Updated_At', schema.indexOf('Updated_At') === -1);
  ok('but does record who created each row', schema.indexOf('Created_By') > -1);
  ok('and why', schema.indexOf('Change_Reason') > -1);
}

// ---------------------------------------------------------------------------
console.log('\n4. a future-dated change does not take effect early');
{
  // Entering next year's budget in August must not move this month's
  // balances. Without this, scheduling a cut would apply it immediately.
  const t = load();
  t.run("saveBudgetAllocations([" +
    JSON.stringify(entry('IDV', 640000, '2026-10-01', 'FY27 opening allocation')) + "])");
  t.run("saveBudgetAllocations([" +
    JSON.stringify(entry('IDV', 500000, '2027-03-01', 'Scheduled mid-year reduction')) + "])");

  const nov = t.run("BudgetAdmin.currentAllocations('FY2027', '2026-11-15')");
  ok('in November the opening figure is in force',
     nov.byOffice.IDV.amount === 640000, nov.byOffice.IDV.amount);
  // The DAC must still be TOLD a change is queued. A balance that moves next
  // month without warning is worse than one that moved already.
  ok('and the queued change is reported',
     nov.byOffice.IDV.scheduledChanges.length === 1 &&
     nov.byOffice.IDV.scheduledChanges[0].amount === 500000,
     nov.byOffice.IDV.scheduledChanges);

  const apr = t.run("BudgetAdmin.currentAllocations('FY2027', '2027-04-01')");
  ok('in April the reduction is in force',
     apr.byOffice.IDV.amount === 500000, apr.byOffice.IDV.amount);
  ok('and nothing is queued any more',
     apr.byOffice.IDV.scheduledChanges.length === 0);

  // On the exact effective date it IS in force — a change dated the 1st
  // applies on the 1st.
  const onDay = t.run("BudgetAdmin.currentAllocations('FY2027', '2027-03-01')");
  ok('a change applies on its effective date, not the day after',
     onDay.byOffice.IDV.amount === 500000, onDay.byOffice.IDV.amount);

  // Two rows on ONE day is a correction; the later-created one wins.
  const t2 = load();
  t2.run("saveBudgetAllocations([" +
    JSON.stringify(entry('CM', 180000, '2026-10-01', 'FY27 opening allocation')) + "])");
  const dup = t2.run("saveBudgetAllocations([" +
    JSON.stringify(entry('CM', 175000, '2026-10-01', 'Corrected opening figure')) + "])");
  ok('a second row on the same date is refused as a clash',
     dup.success === false &&
     dup.problems.some(p => /already an allocation for CM effective 2026-10-01/.test(p)),
     dup.problems);
  ok('and the message quotes the existing amount',
     dup.problems.some(p => /\$180,000/.test(p)), dup.problems);
}

// ---------------------------------------------------------------------------
console.log('\n5. the config fallback announces itself');
{
  // A database with no rows must not leave the dashboard blank. But an
  // unconfirmed figure must not look like one an admin set.
  const t = load();
  const empty = t.run('getBudgetAllocations()');
  ok('an empty tab still returns four offices', empty.data.offices.length === 4);
  ok('with the configured baselines',
     empty.data.offices.find(o => o.officeCode === 'IDV').amount === 659000);
  ok('and source config-fallback', empty.data.source === 'config-fallback');
  ok('marked per office too',
     empty.data.offices.every(o => o.source === 'config-fallback'));
  ok('with no effective date, because nobody set one',
     empty.data.offices.every(o => o.effectiveDate === ''));

  // PARTIAL is its own state. A dashboard mixing confirmed and unconfirmed
  // figures without saying so is the problem this reports.
  t.run("saveBudgetAllocations([" +
    JSON.stringify(entry('OMD', 150000, '2026-10-01')) + "])");
  const partial = t.run("getBudgetAllocations('FY2027')");
  ok('one office set reports "partial"', partial.data.source === 'partial',
     partial.data.source);
  ok('the set office reads from the database',
     partial.data.offices.find(o => o.officeCode === 'OMD').source === 'database');
  ok('and the others still say fallback',
     partial.data.offices.filter(o => o.source === 'config-fallback').length === 3);

  // All four set -> 'database'.
  t.run("saveBudgetAllocations([" +
    JSON.stringify(entry('FO', 4000, '2026-10-01')) + "," +
    JSON.stringify(entry('IDV', 640000, '2026-10-01')) + "," +
    JSON.stringify(entry('CM', 180000, '2026-10-01')) + "])");
  ok('all four set reports "database"',
     t.run("getBudgetAllocations('FY2027')").data.source === 'database');
}

// ---------------------------------------------------------------------------
console.log('\n6. validation refuses what cannot be reconciled later');
{
  const t = load();
  const v = (e, rows) => t.run('BudgetAdmin.validateAllocation(' + JSON.stringify(e) +
                               ',' + JSON.stringify(rows || []) + ')');

  // A BLANK amount is not zero. Zeroing an office is a real decision and must
  // be typed, not reached by leaving a field empty.
  ok('a blank amount is rejected',
     v({ officeCode: 'OMD', amount: '', effectiveDate: '2026-10-01',
         changeReason: 'test reason', fiscalYear: 'FY2027' })
       .some(p => /To zero out an office, enter 0 explicitly/.test(p)));
  ok('but an explicit zero is accepted',
     v({ officeCode: 'OMD', amount: 0, effectiveDate: '2026-10-01',
         changeReason: 'Office stood down', fiscalYear: 'FY2027' }).length === 0);

  // A reduction is a lower number, not a negative one.
  ok('a negative amount is rejected',
     v(entry('OMD', -100, '2026-10-01')).some(p => /cannot be negative/.test(p)));

  // A fat-fingered extra digit turns $152,000 into $1,520,000 and nothing
  // downstream would question it.
  ok('an implausibly large amount is challenged',
     v(entry('OMD', 500000000, '2026-10-01')).some(p => /looks like a typo/.test(p)));

  // THE REQUIREMENT PEOPLE WILL OBJECT TO. Without a reason the audit trail
  // is a list of numbers that changed for no recorded cause, which answers
  // none of the questions it exists to answer.
  ok('a missing reason is rejected',
     v({ officeCode: 'OMD', amount: 100, effectiveDate: '2026-10-01',
         changeReason: '', fiscalYear: 'FY2027' })
       .some(p => /only record of why the number moved/.test(p)));
  ok('and a token reason too',
     v(entry('OMD', 100, '2026-10-01', 'x')).some(p => /fuller reason/.test(p)));

  ok('an unknown office is rejected',
     v(entry('XX', 100, '2026-10-01')).some(p => /not one of FO, OMD, IDV, CM/.test(p)));
  ok('a malformed date is rejected',
     v(entry('OMD', 100, '10/01/2026')).some(p => /must be YYYY-MM-DD/.test(p)));
  ok('a malformed fiscal year is rejected',
     v(entry('OMD', 100, '2026-10-01', 'valid reason', '27'))
       .some(p => /must look like FY2027/.test(p)));

  // ATOMIC. @clolry sets four offices at once; a partial write leaves the
  // group total wrong in a way that looks like a real budget.
  const batch = t.run("saveBudgetAllocations([" +
    JSON.stringify(entry('FO', 4000, '2026-10-01')) + "," +
    JSON.stringify(entry('OMD', -1, '2026-10-01')) + "])");
  ok('one bad entry refuses the whole batch', batch.success === false);
  ok('and NOTHING was written',
     t.run('__S[SHEET_NAMES.BUDGET_ALLOCATIONS].rows.length') === 0,
     'a half-applied budget is worse than none');
  ok('the problem names the office it came from',
     batch.problems.some(p => /^OMD:/.test(p)), batch.problems);

  // Two entries for one office and date inside ONE submission pass the
  // per-entry check, because neither is in `existing` yet.
  const self = t.run("saveBudgetAllocations([" +
    JSON.stringify(entry('CM', 1000, '2026-10-01')) + "," +
    JSON.stringify(entry('CM', 2000, '2026-10-01')) + "])");
  ok('a duplicate within one submission is caught',
     self.success === false &&
     self.problems.some(p => /same save/.test(p)), self.problems);
}

// ---------------------------------------------------------------------------
console.log('\n7. it fails safely');
{
  // A busy lock must not half-write. saveBudgetAllocations reads existing rows
  // to validate, so a concurrent write could validate against a half-written
  // table.
  const busy = load({ lockFails: true });
  const r = busy.run("saveBudgetAllocations([" +
    JSON.stringify(entry('OMD', 100, '2026-10-01')) + "])");
  ok('a busy lock refuses rather than racing', r.success === false);
  ok('and says to retry', /Try again in a moment/.test(r.error), r.error);
  ok('with nothing written',
     busy.run('__S[SHEET_NAMES.BUDGET_ALLOCATIONS].rows.length') === 0);

  // A missing tab is a setup problem and must say so.
  const noTab = load({ noTab: true });
  const nr = noTab.run("saveBudgetAllocations([" +
    JSON.stringify(entry('OMD', 100, '2026-10-01')) + "])");
  ok('a missing tab names setupTravelDatabase',
     nr.success === false && /setupTravelDatabase/.test(nr.error), nr.error);

  // An empty submission is a no-op, not a crash.
  const t = load();
  ok('an empty list is refused cleanly',
     t.run('saveBudgetAllocations([])').success === false);

  // The dashboard reads a CACHED sheet. Without invalidation the new figures
  // are invisible and the admin concludes the save failed.
  t.run("saveBudgetAllocations([" + JSON.stringify(entry('OMD', 100, '2026-10-01')) + "])");
  ok('a successful write invalidates the cache',
     t.run('__INVALIDATED').indexOf('Budget_Allocations') > -1,
     t.run('__INVALIDATED'));

  // Who made the change must be recorded — the row is the audit trail.
  const hist = t.run("getBudgetAllocations('FY2027')").data.history;
  ok('the actor is stamped on the row', hist[0].createdBy === 'chris@gsa.gov',
     hist[0].createdBy);
}

// ---------------------------------------------------------------------------
console.log('\n8. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/40_domain/BudgetAdmin.js', 'utf8');

  // 8a — drop the admin check on the write. §1 must fail.
  const open = src.replace(
    "  if (!email || !isTravelAdmin(email)) {\n" +
    "    // Logged because this function is browser-reachable and writes budget\n" +
    "    // figures; an unexpected caller is worth seeing.\n" +
    "    console.warn('saveBudgetAllocations: refused non-admin caller ' + (email || '(none)'));\n" +
    "    return errorResponse('Administrator access is required to change budget allocations.');\n" +
    "  }\n", '');
  ok('negative control patched out the admin guard', open !== src);
  {
    const t = load({ isAdmin: false });
    vm.runInContext(open, t.ctx, { filename: 'BudgetAdmin.js (unguarded)' });
    const w = t.run("saveBudgetAllocations([" +
      JSON.stringify(entry('OMD', 1, '2026-10-01')) + "])");
    ok('without it a non-admin CAN write', w.success === true,
       'so section 1 is exercising a real guard');
  }

  // 8b — let a future-dated row take effect immediately. §4 must fail.
  const early = src.replace('r.effectiveDate && r.effectiveDate <= when;',
                            'r.effectiveDate;');
  ok('negative control patched the effective-date filter', early !== src);
  {
    const t = load();
    vm.runInContext(early, t.ctx, { filename: 'BudgetAdmin.js (early)' });
    t.run("saveBudgetAllocations([" +
      JSON.stringify(entry('IDV', 640000, '2026-10-01')) + "])");
    t.run("saveBudgetAllocations([" +
      JSON.stringify(entry('IDV', 500000, '2027-03-01', 'Scheduled reduction')) + "])");
    const nov = t.run("BudgetAdmin.currentAllocations('FY2027', '2026-11-15')");
    ok('without it, a scheduled cut applies immediately',
       nov.byOffice.IDV.amount === 500000,
       'so section 4 is exercising a real filter');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
