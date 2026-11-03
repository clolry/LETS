/**
 * Automated Verification Script for importing existing travel
 * (40_domain/BudgetBackfill.js).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * @clolry: "Our fiscal year began October 1st so we have some travel (not a
 * ton, but some) that is planned or already occurred and I want to get it
 * reported in the system so that we can ensure proper budgeting and
 * reconciliation."
 *
 * The normal intake form cannot do this: submitting through it emails a
 * sector director and creates a pending approval for a trip that already
 * happened. So this is a separate path, and four things about it have to hold.
 *
 * 1. NOTHING IS ROUTED OR EMAILED. §2. A reviewer asked to approve completed
 *    travel will reasonably conclude the system is broken.
 *
 * 2. STATUS IS DERIVED, NOT CHOSEN. §3. It decides whether the cost lands as
 *    a commitment or as actual spend, so letting the user pick would let the
 *    same trip land in either bucket.
 *
 * 3. EVERY ROW IS MARKED. §4. These are APPROVED without anyone approving
 *    them; the audit trail must not imply otherwise.
 *
 * 4. NO DOUBLE-COUNTING. §5. @clolry is typing in a quarter of a year, and
 *    entering the same trip twice across two sittings would consume a DAC's
 *    budget twice.
 *
 * Run: node lets_app/test_budget_backfill.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); fails++; }
};

function load(opts) {
  opts = opts || {};
  const logs = [];
  const ctx = vm.createContext({
    console: { log: m => logs.push(String(m)), warn: m => logs.push(String(m)),
               error: m => logs.push(String(m)) },
    JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
    parseInt, parseFloat, isNaN
  });

  // EMAIL AND ROUTING ARE INSTRUMENTED, NOT STUBBED AWAY.
  //
  // The whole claim of this feature is that it sends nothing. A stub that
  // silently absorbs a send would make §2 vacuous, so these record calls and
  // the test asserts the recordings are empty.
  vm.runInContext(`
    function successResponse(d, m) { return { success: true, data: d, message: m || null }; }
    function errorResponse(m) { return { success: false, error: m }; }
    var __ADMIN = ${opts.isAdmin === false ? 'false' : 'true'};
    function isTravelAdmin() { return __ADMIN; }
    function formatUserName() { return 'Chris L'; }
    var LOCK_TIMEOUT_MS = 30000;
    var __LOCK_FAILS = ${opts.lockFails ? 'true' : 'false'};
    var LockService = { getScriptLock: function () { return {
      waitLock: function () { if (__LOCK_FAILS) { throw new Error('busy'); } },
      releaseLock: function () {}
    }; } };
    var Session = { getActiveUser: function () {
      return { getEmail: function () { return '${opts.email || 'chris@gsa.gov'}'; } };
    } };

    var __EMAILS = [];
    var GmailApp = { sendEmail: function () { __EMAILS.push(arguments); } };
    var MailApp = { sendEmail: function () { __EMAILS.push(arguments); } };
    var __ROUTED = [];
    function sendSubmissionNotification() { __ROUTED.push('notification'); }
    function determineInitialRouting() { __ROUTED.push('routing'); return {}; }
    function lookupBUReviewer() { __ROUTED.push('bu'); return null; }
    function findSectorDirector() { __ROUTED.push('sd'); return null; }
  `, ctx);

  ['01_constants/Status.js', '01_constants/Sheets.js', '00_config/BudgetConfig.js']
    .forEach(f => vm.runInContext(fs.readFileSync('lets_app/server/' + f, 'utf8'), ctx,
                                  { filename: f }));

  vm.runInContext(`
    var __S = {};
    var __MISSING = ${JSON.stringify(opts.missingTabs || [])};
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
      this.sheet = function (n) {
        return __MISSING.indexOf(n) > -1 ? null : (__H[n] || null);
      };
      this.readSheet = function (n) {
        var s = __S[n] || { headers: [], rows: [] };
        var hi = {}; s.headers.forEach(function (h, i) { hi[h] = i; });
        return { headers: s.headers, rows: s.rows, headerIndex: hi };
      };
      this.invalidate = function (n) { __INVALIDATED.push(n); };
    }
  `, ctx);

  vm.runInContext(fs.readFileSync('lets_app/server/40_domain/BudgetBackfill.js', 'utf8'),
                  ctx, { filename: 'BudgetBackfill.js' });

  const helper = {
    ctx, logs,
    run: e => vm.runInContext(e, ctx),
    /** A request row as a header-keyed object. */
    req(i) {
      const s = vm.runInContext('__S[SHEET_NAMES.REQUESTS]', ctx);
      const row = s.rows[i];
      if (!row) return null;
      const out = {};
      s.headers.forEach((h, n) => { out[h] = row[n]; });
      return out;
    },
    reqCount() { return vm.runInContext('__S[SHEET_NAMES.REQUESTS].rows.length', ctx); },
    log(i) {
      const s = vm.runInContext('__S[SHEET_NAMES.APPROVAL_LOG]', ctx);
      const row = s.rows[i];
      if (!row) return null;
      const out = {};
      s.headers.forEach((h, n) => { out[h] = row[n]; });
      return out;
    },
    travelers() {
      const s = vm.runInContext('__S[SHEET_NAMES.REQUEST_TRAVELERS]', ctx);
      return s.rows.map(row => {
        const out = {};
        s.headers.forEach((h, n) => { out[h] = row[n]; });
        return out;
      });
    }
  };
  return helper;
}

const trip = o => Object.assign({
  tripName: 'NCMA World Congress',
  startDate: '2026-10-14',
  endDate: '2026-10-17',
  owningOffice: 'IDV',
  totalCost: 12400,
  travelerCount: 3,
  purpose: 'Conference Attendance'
}, o || {});

const imp = (t, entries, options) =>
  t.run('importExistingTravel(' + JSON.stringify(entries) + ',' +
        JSON.stringify(options || {}) + ')');

console.log('--- Budget backfill test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. admin only');
{
  // This writes a request that is APPROVED without anyone approving it, and
  // the figure counts against a DAC's balance immediately. A user who could
  // backfill their own completed travel could consume budget without review.
  const user = load({ isAdmin: false, email: 'reviewer@gsa.gov' });
  const r = imp(user, [trip()]);
  ok('a non-admin cannot import', r.success === false);
  ok('and is told why', /Administrator access is required/.test(r.error), r.error);
  ok('the refusal is logged',
     user.logs.some(l => /refused non-admin caller reviewer@gsa\.gov/.test(l)));
  ok('and nothing was written', user.reqCount() === 0);

  // The dry run leaks existing trip names and request IDs, so it is guarded
  // too.
  const v = user.run("validateExistingTravel([{tripName:'X'}])");
  ok('the dry-run validator is guarded as well', v.success === false, v.error);

  const admin = load();
  ok('an admin can import', imp(admin, [trip()]).success === true);
}

// ---------------------------------------------------------------------------
console.log('\n2. nothing is routed, and nothing is emailed');
{
  // THE CLAIM THIS FEATURE RESTS ON. A reviewer asked to approve travel that
  // happened in October will reasonably conclude the system is broken.
  const t = load();
  const r = imp(t, [trip(), trip({ tripName: 'CGP Fall Conference',
                                   startDate: '2026-11-05', endDate: '2026-11-06',
                                   owningOffice: 'OMD', totalCost: 3100,
                                   travelerCount: 2 })]);
  ok('the import succeeds', r.success === true, r.error || r.problems);

  // Instrumented, not stubbed away: the mocks RECORD calls, so an empty
  // recording is evidence rather than an artefact of the harness.
  ok('no email was sent', t.run('__EMAILS.length') === 0, t.run('__EMAILS.length'));
  ok('no routing function was called', t.run('__ROUTED.length') === 0,
     t.run('__ROUTED'));
  ok('and the payload says so',
     r.data.notificationsSent === 0 && r.data.routedForApproval === false);

  // Reviewer fields must stay EMPTY. Naming a reviewer on a request nobody
  // reviewed puts a false approval in the record, and the reviewer dashboards
  // filter on exactly these columns — a name here would put completed travel
  // on somebody's pending queue.
  ok('no current reviewer is named',
     !t.req(0).Current_Reviewer_Email && !t.req(0).Current_Reviewer_Name,
     [t.req(0).Current_Reviewer_Name, t.req(0).Current_Reviewer_Email]);
  ok('nor an initial review level', !t.req(0).Initial_Review_Level);

  // The source must contain no send call at all, so a later edit cannot
  // reintroduce one without this failing.
  const src = fs.readFileSync('lets_app/server/40_domain/BudgetBackfill.js', 'utf8');
  ok('the module references no mail API',
     !/GmailApp|MailApp|sendSubmissionNotification/.test(src));
}

// ---------------------------------------------------------------------------
console.log('\n3. status is DERIVED from the dates');
{
  // This decides whether the cost lands as a commitment or as actual spend.
  // Letting the user choose would let the same trip land in either bucket.
  const t = load();
  const st = (end) => t.run('BudgetBackfill.statusFor(' + JSON.stringify(end) +
                            ', new Date("2026-11-15T12:00:00"))');

  ok('a trip that has ended is COMPLETED', st('2026-10-17') === 'COMPLETED');
  ok('a trip still ahead is APPROVED_GOGOV', st('2027-02-12') === 'APPROVED_GOGOV');
  // "Planned" travel is exactly the APPROVED_GOGOV case: approved and booked,
  // not yet travelled.
  ok('which is what "planned" travel means', st('2027-02-12') === 'APPROVED_GOGOV');
  ok('a missing end date defaults to a commitment', st('') === 'APPROVED_GOGOV',
     'counting an unknown trip as spent would overstate actuals');

  // BOUNDARY. A trip ending today has not finished, so it is not yet spend.
  ok('a trip ending today is still a commitment',
     st('2026-11-15') === 'APPROVED_GOGOV', st('2026-11-15'));
  ok('and yesterday is completed', st('2026-11-14') === 'COMPLETED');

  // Those statuses must be the ones the dashboard actually counts, or the
  // import lands in neither bucket. This is the BudgetEngine trap: a status
  // vocabulary that matches nothing produces plausible, wrong totals.
  const sctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Status.js', 'utf8'), sctx);
  const groups = vm.runInContext('STATUS_GROUPS', sctx);
  const codes = vm.runInContext('STATUS_CODES', sctx);
  ok('COMPLETED is a real status code', Object.values(codes).indexOf('COMPLETED') > -1);
  ok('APPROVED_GOGOV is a real status code',
     Object.values(codes).indexOf('APPROVED_GOGOV') > -1);
  ok('and both are terminal, so neither sits on a review queue',
     groups.TERMINAL.indexOf('COMPLETED') > -1 &&
     groups.TERMINAL.indexOf('APPROVED_GOGOV') > -1, groups.TERMINAL);

  // Fiscal year. @clolry: "Our fiscal year began October 1st."
  const r = imp(t, [trip()]);
  ok('October travel is FY2027 money', r.data.created[0].fiscalYear === 'FY2027',
     r.data.created[0].fiscalYear);
}

// ---------------------------------------------------------------------------
console.log('\n4. every row says it was backfilled');
{
  // These requests are APPROVED or COMPLETED without anyone approving them. If
  // that is not identifiable afterwards, the audit trail quietly implies an
  // approval that never happened.
  const t = load();
  imp(t, [trip()]);
  const row = t.req(0);

  ok('the justification is prefixed BACKFILL',
     /^BACKFILL:/.test(String(row.Primary_Justification)), row.Primary_Justification);
  ok('and names the administrator',
     /Chris L/.test(String(row.Primary_Justification)));

  const log = t.log(0);
  ok('an approval-log entry is written', !!log);
  ok('with a distinct action', log.Action === 'BACKFILL_IMPORT', log.Action);
  ok('naming the actor', log.Action_By_Email === 'chris@gsa.gov');
  // The log is what someone reads to ask "who approved this". The honest
  // answer is nobody, and it has to say that.
  ok('and stating outright that no review happened',
     /NOT routed for approval/.test(String(log.Comments)), log.Comments);
  ok('with no previous status, because there was no workflow',
     log.Previous_Status === '');

  // SUBMITTED_AT IS THE TRAVEL DATE, NOT THE IMPORT DATE. Reports group by
  // this; stamping it `now` would put October travel in whatever month the
  // import ran, which is precisely the reconciliation @clolry is trying to
  // fix.
  ok('Submitted_At is the travel date, not today',
     String(row.Submitted_At) === '2026-10-14', row.Submitted_At);
}

// ---------------------------------------------------------------------------
console.log('\n5. no double counting');
{
  // @clolry is entering a quarter of a year by hand. The realistic failure is
  // entering the same trip twice across two sittings, which consumes a DAC's
  // budget twice.
  const t = load();
  imp(t, [trip()]);

  const again = imp(t, [trip()]);
  ok('a repeat import is held back', again.success === false);
  ok('and flagged as needing confirmation', again.needsConfirmation === true);
  // Matches BOTH id formats. The generator moved to L27-0001 because Go.gov
  // truncates a trip name at 40 characters and the ID has to fit in front of
  // it; legacy REQ-YYYY-NNNN rows still exist and must still be named here.
  ok('naming the existing request',
     again.warnings.some(w => /\b(L\d{2}-\d{4,5}|REQ-\d{4}-\d{3,5})\b/.test(w)),
     again.warnings);
  ok('with its date and status, so it can be checked',
     again.warnings.some(w => /2026-10-14/.test(w) && /COMPLETED/.test(w)),
     again.warnings);
  ok('and nothing was written', t.reqCount() === 1, t.reqCount());

  // NOT BLOCKED, THOUGH. Two genuine trips to one event in a month happen —
  // @clolry's FAS tracker data has several — so this must be overridable.
  const forced = imp(t, [trip()], { allowDuplicates: true });
  ok('but it can be overridden deliberately', forced.success === true);
  ok('and then it writes', t.reqCount() === 2);

  // A different month is not a duplicate.
  const other = imp(t, [trip({ startDate: '2026-12-14', endDate: '2026-12-17' })]);
  ok('the same event in a different month is not a duplicate',
     other.success === true, other.warnings);

  // Twice in ONE submission passes the per-entry check, because neither row
  // exists yet.
  const t2 = load();
  const twice = imp(t2, [trip(), trip()]);
  ok('the same trip twice in one submission is refused',
     twice.success === false &&
     twice.problems.some(p => /appears twice in this import/.test(p)), twice.problems);
  ok('with nothing written', t2.reqCount() === 0);

  // IDs must be unique. generateRequestId reads the sheet for the highest
  // number, so calling it per entry before any write returns the same ID
  // every time — which is why the sequence is computed once per batch.
  const t3 = load();
  const batch = imp(t3, [
    trip({ tripName: 'Trip A' }),
    trip({ tripName: 'Trip B' }),
    trip({ tripName: 'Trip C' })
  ]);
  const ids = batch.data.created.map(c => c.requestId);
  ok('a batch gets distinct request IDs', new Set(ids).size === 3, ids);
  ok('numbered consecutively', /0001.*0002.*0003/.test(ids.join(',')), ids);
  // THE ID MUST AGREE WITH THE FISCAL YEAR IT SPENDS.
  //
  // The old generator used the CALENDAR year, so a trip entered on 15 October
  // 2026 was numbered REQ-2026-xxxx while drawing on FY2027 money, and the
  // sequence reset on 1 January rather than 1 October. @clolry, twice:
  // "budgeting all resets on 10/1."
  ok('and prefixed with the FISCAL year, not the calendar year',
     ids.every(id => /^L\d{2}-/.test(id)), ids);
}

// ---------------------------------------------------------------------------
console.log('\n6. validation refuses what cannot be reconciled');
{
  const t = load();
  const v = e => t.run('BudgetBackfill.validateEntry(' + JSON.stringify(e) +
                       ', { fiscalYear: "FY2027" })');

  ok('a missing trip name is rejected',
     v(trip({ tripName: '' })).some(p => /name is required/.test(p)));
  ok('a missing start date is rejected',
     v(trip({ startDate: '' })).some(p => /Start date is required/.test(p)));
  ok('an end before the start is rejected',
     v(trip({ startDate: '2026-10-17', endDate: '2026-10-14' }))
       .some(p => /is before the start date/.test(p)));

  // A date outside the fiscal year is almost always a typo in the year, and it
  // would attribute spend to a budget that is already closed.
  ok('travel outside the fiscal year is challenged',
     v(trip({ startDate: '2026-09-15', endDate: '2026-09-16' }))
       .some(p => /falls in FY2026, not FY2027/.test(p)));
  ok('and the message explains the boundary',
     v(trip({ startDate: '2026-09-15', endDate: '2026-09-16' }))
       .some(p => /1 October to 30 September/.test(p)));

  ok('an unknown office is rejected',
     v(trip({ owningOffice: 'XX' })).some(p => /not one of FO, OMD, IDV, CM/.test(p)));
  ok('a missing office is rejected',
     v(trip({ owningOffice: '' })).some(p => /budget the cost counts against/.test(p)));

  // A BLANK cost is not zero. Zero-cost travel is real — @clolry's FAS tracker
  // data is full of local no-cost events — but it must be typed.
  ok('a blank cost is rejected',
     v(trip({ totalCost: '' })).some(p => /For no-cost travel, enter 0/.test(p)));
  ok('but an explicit zero is accepted',
     v(trip({ totalCost: 0 })).length === 0, v(trip({ totalCost: 0 })));
  ok('a negative cost is rejected',
     v(trip({ totalCost: -5 })).some(p => /cannot be negative/.test(p)));
  ok('an implausible cost is challenged',
     v(trip({ totalCost: 5000000 })).some(p => /looks like a typo/.test(p)));

  ok('zero travellers is rejected',
     v(trip({ travelerCount: 0 })).some(p => /at least 1/.test(p)));

  // Names are OPTIONAL — @clolry may only have a headcount. But if names are
  // given they must agree with the count, or the request and its traveller
  // rows disagree and no report reconciles.
  ok('names are optional',
     v(trip({ travelerNames: [] })).length === 0);
  ok('but a mismatched name count is rejected',
     v(trip({ travelerCount: 3, travelerNames: ['A', 'B'] }))
       .some(p => /name\(s\) given but the count says 3/.test(p)));
  ok('and a matching one is accepted',
     v(trip({ travelerCount: 2, travelerNames: ['A', 'B'] })).length === 0);

  // ATOMIC. A partial write would leave @clolry unable to tell which of
  // fifteen trips landed, and re-running would double-count the ones that did.
  const batch = imp(t, [trip(), trip({ tripName: 'Bad', totalCost: -1 })]);
  ok('one bad entry refuses the whole batch', batch.success === false);
  ok('and NOTHING was written', t.reqCount() === 0);
  ok('the problem names the trip it came from',
     batch.problems.some(p => /^Bad:/.test(p)), batch.problems);
}

// ---------------------------------------------------------------------------
console.log('\n7. traveller rows, and the even split');
{
  const t = load();
  imp(t, [trip({ travelerCount: 3, travelerNames: ['A Smith', 'B Jones', 'C Lee'],
                 totalCost: 12400 })]);
  const tr = t.travelers();
  ok('one row per named traveller', tr.length === 3, tr.length);
  ok('each linked to the request',
     tr.every(x => /^(L\d{2}-|REQ-)/.test(String(x.Request_ID))),
     tr.map(x => x.Request_ID));
  ok('with distinct traveller IDs',
     new Set(tr.map(x => x.Traveler_ID)).size === 3);

  // The real split is not known, so it is stated as an even one rather than
  // implied. Someone reconciling a single traveller's cost needs to know the
  // figure is derived.
  const total = tr.reduce((s, x) => s + Number(x.Subtotal), 0);
  ok('the splits sum to the trip total', Math.abs(total - 12400) < 0.05, total);
  ok('and each row says the split is even',
     tr.every(x => /even\s*split/i.test(String(x.Role_Justification))),
     tr[0].Role_Justification);

  // Budget attribution per traveller, so a cross-DAC trip reconciles.
  ok('each traveller carries a budget office code',
     tr.every(x => x.Budget_Office_Code === 'IDV'),
     tr.map(x => x.Budget_Office_Code));

  // No names: no traveller rows, and that is correct rather than a failure.
  const t2 = load();
  imp(t2, [trip({ travelerCount: 4, travelerNames: [] })]);
  ok('a headcount-only import writes no traveller rows',
     t2.travelers().length === 0);
  ok('but the request still records the count',
     Number(t2.req(0).Traveler_Count) === 4);

  // Org codes are hierarchical: FCA0A resolves to the OMD budget key.
  const office = c => t.run('BudgetBackfill.officeForOrgCode(' + JSON.stringify(c) + ')');
  ok('a sub-org code resolves to its parent budget key', office('FCA0A') === 'OMD');
  ok('six levels deep too', office('FCBADDD') === 'IDV');
  ok('and FC does not capture everything', office('FCC0B') === 'CM',
     'FC is a prefix of every code, so longest-prefix must win');
  ok('an unknown code resolves to nothing', office('ZZ') === '');
}

// ---------------------------------------------------------------------------
console.log('\n8. it fails safely');
{
  const busy = load({ lockFails: true });
  const r = imp(busy, [trip()]);
  ok('a busy lock refuses rather than racing', r.success === false);
  ok('and nothing was written', busy.reqCount() === 0);

  const noReq = load({ missingTabs: ['Requests'] });
  const nr = imp(noReq, [trip()]);
  ok('a missing Requests tab fails cleanly', nr.success === false, nr.error);

  // Traveller and log tabs are OPTIONAL. Losing the traveller detail is
  // regrettable; losing the import because of it would be worse.
  const noTrav = load({ missingTabs: ['Request_Travelers', 'Approval_Log'] });
  const tr = imp(noTrav, [trip({ travelerNames: ['A', 'B', 'C'] })]);
  ok('a missing travellers tab does not block the import',
     tr.success === true, tr.error);
  ok('and the request still lands', noTrav.reqCount() === 1);

  ok('an empty list is refused cleanly',
     load().run('importExistingTravel([])').success === false);

  // The dashboard reads cached sheets. Without invalidation the imported
  // travel is invisible and the admin concludes the import failed.
  const t = load();
  imp(t, [trip()]);
  const inval = t.run('__INVALIDATED');
  ok('the Requests cache is invalidated', inval.indexOf('Requests') > -1, inval);
  ok('and the traveller cache too', inval.indexOf('Request_Travelers') > -1);
}

// ---------------------------------------------------------------------------
console.log('\n9. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/40_domain/BudgetBackfill.js', 'utf8');

  // 9a — remove the admin guard. §1 must fail.
  const open = src.replace(
    "  if (!email || !isTravelAdmin(email)) {\n" +
    "    console.warn('importExistingTravel: refused non-admin caller ' + (email || '(none)'));\n" +
    "    return errorResponse('Administrator access is required to import existing travel.');\n" +
    "  }\n", '');
  ok('negative control patched out the admin guard', open !== src);
  {
    const t = load({ isAdmin: false });
    vm.runInContext(open, t.ctx, { filename: 'BudgetBackfill.js (unguarded)' });
    ok('without it a non-admin CAN import', imp(t, [trip()]).success === true,
       'so section 1 is exercising a real guard');
  }

  // 9b — let duplicates through silently. §5 must fail.
  const dupes = src.replace('if (warnings.length && options.allowDuplicates !== true) {',
                            'if (false) {');
  ok('negative control patched the duplicate check', dupes !== src);
  {
    const t = load();
    vm.runInContext(dupes, t.ctx, { filename: 'BudgetBackfill.js (dupes)' });
    imp(t, [trip()]);
    imp(t, [trip()]);
    ok('without it the same trip is counted twice', t.reqCount() === 2,
       'so section 5 is exercising a real guard');
  }

  // 9c — stamp Submitted_At with the import date. §4 must fail.
  const stamped = src.replace("'Submitted_At': start || now,", "'Submitted_At': now,");
  ok('negative control patched the submitted date', stamped !== src);
  {
    const t = load();
    vm.runInContext(stamped, t.ctx, { filename: 'BudgetBackfill.js (stamped)' });
    imp(t, [trip()]);
    ok('without it October travel is stamped with the import date',
       String(t.req(0).Submitted_At) !== '2026-10-14',
       'so section 4 is exercising a real behaviour');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
