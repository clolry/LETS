/**
 * Automated Verification Script for reviewer delegation
 * (30_services/Delegation.js, the act-as wiring, and the client panel).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * @clolry: "In go.gov when a user delegates access, the other logs in and
 * then can choose to emulate that user's access and approvals (of course
 * they're logged as themselves but are given the rights to view/edit as the
 * other person would)."
 *
 * The parenthetical is the whole design, and §4 is the section that holds it:
 * the approval log must record the HUMAN who pressed the button, not the
 * principal. Logging the principal would make the record read as though Alice
 * approved her own coverage while she was on leave — and who actually did it
 * is the one question that log exists to answer.
 *
 * §2 is the other load-bearing one: a delegation is not a role grant. No end
 * date, re-delegation, and lending somebody else's authority are each refused.
 *
 * Run: node lets_app/test_delegation.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 280)); fails++; }
};

const DAY = 86400000;
const iso = d => new Date(d).toISOString().slice(0, 10);
const today = iso(Date.now());
const plus = n => iso(Date.now() + n * DAY);
const minus = n => iso(Date.now() - n * DAY);

/** Loads Delegation.js with a writable stub spreadsheet. */
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
    var __WHO = ${JSON.stringify(opts.email || 'alice@gsa.gov')};
    var __ADMIN = ${opts.admin ? 'true' : 'false'};
    function isTravelAdmin() { return __ADMIN; }
    function formatUserName(e) { return String(e).split('@')[0]; }
    var LOCK_TIMEOUT_MS = 30000;
    var __LOCK_FAILS = ${opts.lockFails ? 'true' : 'false'};
    var LockService = { getScriptLock: function () { return {
      waitLock: function () { if (__LOCK_FAILS) { throw new Error('busy'); } },
      releaseLock: function () {}
    }; } };
    var Session = { getActiveUser: function () {
      return { getEmail: function () { return __WHO; } };
    } };
  `, ctx);
  ['01_constants/Status.js', '01_constants/Sheets.js'].forEach(f =>
    vm.runInContext(fs.readFileSync('lets_app/server/' + f, 'utf8'), ctx, { filename: f }));
  vm.runInContext(`
    var __S = {};
    var __NO_TAB = ${opts.noTab ? 'true' : 'false'};
    function __mk(name, headers) {
      __S[name] = { headers: headers, rows: [] };
      return {
        getLastRow: function () { return 1 + __S[name].rows.length; },
        getLastColumn: function () { return headers.length; },
        getRange: function (r, c, nr, nc) { return {
          setValues: function (v) {
            for (var i = 0; i < v.length; i++) {
              var tr = r - 2 + i;
              if (tr < __S[name].rows.length) __S[name].rows[tr] = v[i];
              else __S[name].rows.push(v[i]);
            }
          },
          setValue: function (v) {
            var tr = r - 2;
            if (tr < __S[name].rows.length) __S[name].rows[tr][c - 1] = v;
          },
          getValues: function () {
            var a = [headers].concat(__S[name].rows);
            return a.slice(r - 1, r - 1 + nr).map(function (x) { return x.slice(c - 1, c - 1 + nc); });
          }
        }; }
      };
    }
    var __H = {};
    Object.keys(TRAVEL_SHEET_SCHEMAS).forEach(function (k) {
      __H[k] = __mk(k, TRAVEL_SHEET_SCHEMAS[k]);
    });
    function TravelDB() {
      this.sheet = function (n) { return __NO_TAB ? null : (__H[n] || null); };
      this.readSheet = function (n) {
        var s = __S[n] || { headers: [], rows: [] };
        var hi = {}; s.headers.forEach(function (h, i) { hi[h] = i; });
        return { headers: s.headers, rows: s.rows, headerIndex: hi };
      };
      this.appendRow = function (n, r) { __S[n].rows.push(r); };
      this.invalidate = function () {};
    }
  `, ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/30_services/Delegation.js', 'utf8'),
                  ctx, { filename: 'Delegation.js' });
  return {
    ctx, logs,
    run: e => vm.runInContext(e, ctx),
    as: e => vm.runInContext('__WHO=' + JSON.stringify(e), ctx),
    admin: v => vm.runInContext('__ADMIN=' + (v ? 'true' : 'false'), ctx)
  };
}

const grant = (t, delegate, start, end, reason, principal) =>
  t.run('createDelegation(' + JSON.stringify({
    delegateEmail: delegate, startDate: start, endDate: end,
    reason: reason || 'Annual leave',
    principalEmail: principal
  }) + ')');

console.log('--- Delegation test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. a delegate can act; nobody else can');
{
  const t = load({ email: 'alice@gsa.gov' });
  const c = grant(t, 'bob@gsa.gov', today, plus(14));
  ok('alice can delegate to bob', c.success === true, c.problems || c.error);
  ok('and is told the window', /from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/.test(c.message),
     c.message);

  ok('bob can act as alice',
     t.run("Delegation.canActAs('bob@gsa.gov','alice@gsa.gov').allowed") === true);
  ok('carol cannot',
     t.run("Delegation.canActAs('carol@gsa.gov','alice@gsa.gov').allowed") === false);
  ok('and is told why',
     /do not hold an active delegation/.test(
       t.run("Delegation.canActAs('carol@gsa.gov','alice@gsa.gov').reason")));
  // Not an error worth refusing loudly, but it must NOT return a delegation
  // object — the caller would otherwise stamp an action as delegated when it
  // was not.
  const self = t.run("Delegation.canActAs('bob@gsa.gov','bob@gsa.gov')");
  ok('acting as yourself returns no delegation',
     self.allowed === false && self.delegation === null, self);
  ok('bob cannot act as someone who never delegated to him',
     t.run("Delegation.canActAs('bob@gsa.gov','dave@gsa.gov').allowed") === false);
}

// ---------------------------------------------------------------------------
console.log('\n2. a delegation is NOT a role grant');
{
  // The obvious implementation was a Travel_User_Roles row. These four
  // refusals are what makes this different from one.
  const t = load({ email: 'alice@gsa.gov' });

  // NO END DATE. An open-ended delegation is indistinguishable from a
  // permanent grant, which is the thing this design exists to avoid.
  const noEnd = t.run("createDelegation({delegateEmail:'eve@gsa.gov'," +
    "startDate:'" + today + "',reason:'indefinite cover'})");
  ok('an open-ended delegation is refused', noEnd.success === false);
  ok('and says to grant a role instead',
     noEnd.problems.some(p => /role grant in disguise/.test(p)), noEnd.problems);

  // Longer than a year is the same thing with extra steps.
  const tooLong = t.run("createDelegation({delegateEmail:'eve@gsa.gov'," +
    "startDate:'" + today + "',endDate:'" + plus(400) + "',reason:'long detail'})");
  ok('longer than a year is refused', tooLong.success === false);
  ok('for the same reason',
     tooLong.problems.some(p => /should be a role grant/.test(p)), tooLong.problems);

  // LENDING SOMEBODY ELSE'S AUTHORITY.
  t.as('carol@gsa.gov');
  const notMine = grant(t, 'carol@gsa.gov', today, plus(5), 'grabbing', 'alice@gsa.gov');
  ok('carol cannot lend alice\'s authority', notMine.success === false);
  ok('and is told to ask alice or an admin',
     notMine.problems.some(p => /only delegate your own authority/.test(p)),
     notMine.problems);

  // RE-DELEGATION. Authority would spread transitively and the audit chain
  // would be unfollowable.
  t.as('alice@gsa.gov');
  grant(t, 'bob@gsa.gov', today, plus(14));
  t.as('bob@gsa.gov');
  const onward = grant(t, 'dave@gsa.gov', today, plus(5), 'passing it on');
  ok('bob cannot re-delegate what he holds', onward.success === false);
  ok('and is told he is himself acting under one',
     onward.problems.some(p => /cannot lend authority onward/.test(p)), onward.problems);

  // A REASON IS REQUIRED. Six months on, the row is the only record of why
  // somebody else was approving travel.
  t.as('alice@gsa.gov');
  const noReason = t.run("createDelegation({delegateEmail:'frank@gsa.gov'," +
    "startDate:'" + today + "',endDate:'" + plus(5) + "',reason:''})");
  ok('a missing reason is refused', noReason.success === false);
  ok('and explains why it matters',
     noReason.problems.some(p => /only record of why/.test(p)), noReason.problems);

  ok('self-delegation is refused',
     grant(t, 'alice@gsa.gov', today, plus(5)).success === false);
  ok('an end before the start is refused',
     grant(t, 'frank@gsa.gov', plus(10), plus(2)).success === false);

  // An ADMIN may delegate on somebody's behalf — a person who left abruptly
  // cannot arrange their own cover.
  const adm = load({ email: 'admin@gsa.gov', admin: true });
  ok('an admin can delegate for someone else',
     grant(adm, 'bob@gsa.gov', today, plus(5), 'covering a departure',
           'alice@gsa.gov').success === true);
}

// ---------------------------------------------------------------------------
console.log('\n3. expiry is COMPUTED, not stored');
{
  // The Status column has an EXPIRED value and nothing writes it. A stored
  // EXPIRED needs a nightly job, and a delegation that stays live until the
  // job next runs is exactly the failure this avoids.
  const t = load({ email: 'alice@gsa.gov' });
  grant(t, 'bob@gsa.gov', today, plus(14), 'current');
  grant(t, 'frank@gsa.gov', minus(30), minus(10), 'old cover');
  grant(t, 'gina@gsa.gov', plus(10), plus(20), 'future leave');

  const all = t.run('Delegation.readAll(new TravelDB())');
  const byDelegate = {};
  all.forEach(d => { byDelegate[d.delegateEmail] = d; });

  ok('every stored status is ACTIVE', all.every(d => d.status === 'ACTIVE'),
     all.map(d => d.status));

  const eff = d => t.run('Delegation.effectiveStatus(' + JSON.stringify(d) + ')');
  const force = d => t.run('Delegation.isInForce(' + JSON.stringify(d) + ')');

  ok('a current one reads ACTIVE', eff(byDelegate['bob@gsa.gov']) === 'ACTIVE');
  ok('and is in force', force(byDelegate['bob@gsa.gov']) === true);
  ok('a past one reads EXPIRED', eff(byDelegate['frank@gsa.gov']) === 'EXPIRED');
  ok('and is NOT in force', force(byDelegate['frank@gsa.gov']) === false);
  ok('a future one reads SCHEDULED', eff(byDelegate['gina@gsa.gov']) === 'SCHEDULED');
  ok('and is not yet in force', force(byDelegate['gina@gsa.gov']) === false);

  ok('an expired delegate cannot act',
     t.run("Delegation.canActAs('frank@gsa.gov','alice@gsa.gov').allowed") === false);
  ok('nor a scheduled one, before it starts',
     t.run("Delegation.canActAs('gina@gsa.gov','alice@gsa.gov').allowed") === false);

  // BOUNDARIES. Inclusive at both ends — cover that ends "Friday" includes
  // Friday.
  const d = byDelegate['bob@gsa.gov'];
  ok('the start date is inclusive',
     t.run('Delegation.isInForce(' + JSON.stringify(d) + ',' +
           JSON.stringify(d.startDate) + ')') === true);
  ok('the end date is inclusive',
     t.run('Delegation.isInForce(' + JSON.stringify(d) + ',' +
           JSON.stringify(d.endDate) + ')') === true);
  ok('the day after the end is not',
     t.run('Delegation.isInForce(' + JSON.stringify(d) + ',' +
           JSON.stringify(iso(Date.parse(d.endDate) + DAY)) + ')') === false);
}

// ---------------------------------------------------------------------------
console.log('\n4. the approval log records the HUMAN, not the principal');
{
  // THE SECTION THAT HOLDS @clolry's REQUIREMENT.
  //
  // "of course they're logged as themselves but are given the rights to
  // view/edit as the other person would."
  //
  // Logging the principal would make the record read as though Alice approved
  // her own coverage while on leave, and who actually did it is the one
  // question the log exists to answer. Asserted against the SOURCE because
  // submitReviewAction needs the whole Apps Script runtime.
  const src = fs.readFileSync('lets_app/server/40_domain/Review_Action.js', 'utf8');

  ok('the actor is captured separately from the authority',
     /const actorEmail = Session\.getActiveUser\(\)\.getEmail\(\)/.test(src));
  ok('and the authority is the principal when delegated',
     /const currentUser = delegation \? delegation\.principalEmail : actorEmail/.test(src));

  // Action_By_Email must be the ACTOR.
  ok('Action_By_Email records the actor',
     /actorEmail,\s*\/\/ Action_By_Email/.test(src), 'not the principal');
  ok('Action_By_Name records the actor', /actorName,\s*\/\/ Action_By_Name/.test(src));
  // Whose authority goes in the role column and the comment, so it survives
  // in the text somebody reads rather than only in a column.
  ok('the role column marks it delegated',
     /actionByRole \+ \(delegation \? ' \(delegated\)' : ''\)/.test(src));
  ok('and the comment names the principal and the delegation',
     /\[Acting for/.test(src) && /delegation\.delegationId/.test(src));

  // AUTHORIZATION uses the PRINCIPAL, or a delegate could not act at all.
  ok('the authorization check uses the principal',
     /if \(!isTravelAdmin\(currentUser\)\)/.test(src));

  // RE-CHECKED AT ACTION TIME, not trusted from the page that drew the
  // button. A delegation can be revoked between the page loading and the
  // approval being pressed.
  ok('the delegation is re-checked at action time',
     /Delegation\.canActAs\(actorEmail, actAs\)/.test(src));
  ok('and a refusal throws rather than falling back',
     /throw new Error\('Cannot act as '/.test(src),
     'falling back to the actor\'s own authority would approve under the wrong one');
}

// ---------------------------------------------------------------------------
console.log('\n5. revocation, and who may do it');
{
  const t = load({ email: 'alice@gsa.gov' });
  grant(t, 'bob@gsa.gov', today, plus(14));
  let all = t.run('Delegation.readAll(new TravelDB())');
  const id = all[0].delegationId;

  // A reason is required — the row is the record.
  ok('a revoke with no reason is refused',
     t.run("revokeDelegation(" + JSON.stringify(id) + ",'')").success === false);

  // THE DELEGATE MAY DECLINE. Somebody handed unexpected authority should be
  // able to give it back without chasing the principal.
  t.as('bob@gsa.gov');
  const declined = t.run("revokeDelegation(" + JSON.stringify(id) +
    ",'I am also out that week')");
  ok('the delegate can decline', declined.success === true, declined.error);
  ok('and can no longer act',
     t.run("Delegation.canActAs('bob@gsa.gov','alice@gsa.gov').allowed") === false);

  all = t.run('Delegation.readAll(new TravelDB())');
  // REVOKED, not deleted. Approvals already taken under it reference the ID.
  ok('the row is marked REVOKED, not deleted',
     all.length === 1 && all[0].status === 'REVOKED', all.length);
  ok('and records who revoked it', all[0].revokedBy === 'bob@gsa.gov');
  ok('and why', /also out that week/.test(all[0].revokeReason));
  ok('revoking twice is refused',
     t.run("revokeDelegation(" + JSON.stringify(id) + ",'again')").success === false);

  // An unrelated user may not revoke.
  const t2 = load({ email: 'alice@gsa.gov' });
  grant(t2, 'bob@gsa.gov', today, plus(14));
  const id2 = t2.run('Delegation.readAll(new TravelDB())')[0].delegationId;
  t2.as('stranger@gsa.gov');
  const refused = t2.run("revokeDelegation(" + JSON.stringify(id2) + ",'meddling')");
  ok('a stranger cannot revoke', refused.success === false);
  ok('and the refusal is logged',
     t2.logs.some(l => /refused stranger@gsa\.gov/.test(l)), t2.logs);

  // An admin can.
  t2.as('admin@gsa.gov');
  t2.admin(true);
  ok('an admin can revoke anyone\'s',
     t2.run("revokeDelegation(" + JSON.stringify(id2) + ",'offboarding')").success === true);
}

// ---------------------------------------------------------------------------
console.log('\n6. every change is audited');
{
  // Lending review authority is an authorization change, and that is where
  // authorization changes live.
  const t = load({ email: 'alice@gsa.gov' });
  grant(t, 'bob@gsa.gov', today, plus(14), 'Annual leave');
  const id = t.run('Delegation.readAll(new TravelDB())')[0].delegationId;
  t.run("revokeDelegation(" + JSON.stringify(id) + ",'back early')");

  const log = t.run('__S[SHEET_NAMES.ACCESS_LOG].rows');
  ok('both events are logged', log.length === 2, log.length);
  ok('creation is recorded',
     log[0].indexOf('DELEGATION_CREATED') > -1, log[0]);
  ok('revocation is recorded',
     log[1].indexOf('DELEGATION_REVOKED') > -1, log[1]);
  ok('the creation names both parties and the window',
     log[0].some(c => /alice@gsa\.gov -> bob@gsa\.gov/.test(String(c))) &&
     log[0].some(c => /Annual leave/.test(String(c))), log[0]);
  // Writes to Access_Log are positional, so width matters.
  ok('rows match the Access_Log width', log.every(r => r.length === 9),
     log.map(r => r.length));

  // An audit write must never break the operation it records.
  const noTab = load({ email: 'alice@gsa.gov', noTab: true });
  const r = grant(noTab, 'bob@gsa.gov', today, plus(5));
  ok('a missing tab fails cleanly rather than throwing',
     r.success === false && /tab not found/.test(r.error), r.error);

  const busy = load({ email: 'alice@gsa.gov', lockFails: true });
  ok('a busy lock refuses rather than racing',
     grant(busy, 'bob@gsa.gov', today, plus(5)).success === false);
}

// ---------------------------------------------------------------------------
console.log('\n7. getMyDelegations returns both directions');
{
  // A reviewer needs to see both: what they lent out, to revoke it, and what
  // they hold, to use it.
  const t = load({ email: 'alice@gsa.gov' });
  grant(t, 'bob@gsa.gov', today, plus(14), 'Alice on leave');
  t.as('carol@gsa.gov');
  grant(t, 'alice@gsa.gov', today, plus(7), 'Carol at a conference');

  t.as('alice@gsa.gov');
  const mine = t.run('getMyDelegations()');
  ok('the call succeeds', mine.success === true, mine.error);
  ok('granted lists what alice lent out',
     mine.data.granted.length === 1 &&
     mine.data.granted[0].delegateEmail === 'bob@gsa.gov', mine.data.granted);
  ok('received lists what alice holds',
     mine.data.received.length === 1 &&
     mine.data.received[0].principalEmail === 'carol@gsa.gov', mine.data.received);
  ok('canActAs lists only what is usable NOW',
     mine.data.canActAs.length === 1 &&
     mine.data.canActAs[0].principalEmail === 'carol@gsa.gov');
  ok('the status returned is the DERIVED one',
     mine.data.granted[0].status === 'ACTIVE' &&
     typeof mine.data.granted[0].inForce === 'boolean');

  // A non-admin does not get everybody's.
  ok('a non-admin sees no global list',
     mine.data.all.length === 0 && mine.data.isAdmin === false);

  const adm = load({ email: 'admin@gsa.gov', admin: true });
  grant(adm, 'x@gsa.gov', today, plus(5), 'cover', 'someone@gsa.gov');
  const asAdmin = adm.run('getMyDelegations()');
  ok('an admin sees all of them',
     asAdmin.data.isAdmin === true && asAdmin.data.all.length === 1);
}

// ---------------------------------------------------------------------------
console.log('\n8. the client panel and its wiring');
{
  const panel = fs.readFileSync('lets_app/client/shared/travelDelegationPanel.html', 'utf8');

  // An included file is evaluated as its OWN template, so a page variable is
  // invisible inside it. A scriptlet here would throw on every page that
  // includes it — which took the whole app down once before.
  ok('the panel contains no scriptlets', !/<\?=|<\?!=/.test(panel),
     'an included file cannot read a page template variable');

  // THE BANNER MUST NOT BE DISMISSIBLE. A delegate who forgot they held
  // somebody\'s authority and approved under it by accident is the failure
  // this guards against, and a dismissible banner does not guard it.
  ok('the banner offers only "stop acting as"',
     /actas-bar__stop/.test(panel) && !/actas-bar__dismiss|data-dismiss/.test(panel));
  ok('and switching off reloads the page',
     /function switchTo[\s\S]{0,400}window\.location\.reload\(\)/.test(panel),
     'role, scope and queue are all server-resolved; a partial re-render would ' +
     'leave part of the page showing the old identity');

  // sessionStorage, not localStorage: cover for an absence should not survive
  // closing the browser.
  ok('the choice is kept in sessionStorage', /window\.sessionStorage/.test(panel));
  // Comments mention localStorage to explain why it is NOT used, so the
  // check has to look at code. Stripping comment lines first — my earlier
  // version grepped the whole file and failed on a correct one, the same
  // comment-satisfies-the-check mistake I have now made five times.
  // Strips the leading HTML comment block AND line comments. The panel opens
  // with an <!-- ... --> block whose interior lines start with plain prose,
  // so a per-line comment filter does not see them as comments at all.
  const panelCode = panel
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))
    .join('\n');
  ok('and not in localStorage', !/localStorage/.test(panelCode),
     panelCode.split('\n').filter(l => /localStorage/.test(l)));

  // A revoked delegation must clear the stored choice, or the banner keeps
  // claiming authority the server refuses.
  ok('a no-longer-valid choice is cleared on load',
     /stillValid[\s\S]{0,200}setActAs\(''\)/.test(panel));

  // The server-confirmed value wins over storage.
  ok('the server context takes precedence over storage',
     /window\.REVIEWER_CTX[\s\S]{0,200}ctx\.actingAs/.test(panel),
     'storage alone would show a banner for authority the server refused');

  // EVERY review action must carry the act-as parameter, or a delegate\'s
  // approval would be attempted under their own authority and refused.
  const rev = fs.readFileSync(
    'lets_app/client/controllers/review/travelReviewController.html', 'utf8');
  const calls = (rev.match(/\.submitReviewAction\(/g) || []).length;
  const passed = (rev.match(/_actingAs\(\)/g) || []).length;
  ok('every submitReviewAction call passes the act-as value',
     calls > 0 && passed === calls, 'calls=' + calls + ' passing=' + passed);
  ok('and the helper tolerates the panel being absent',
     /window\.TravelDelegation && window\.TravelDelegation\.actingAs\(\)/.test(rev),
     'this controller also loads on pages without the panel');

  // The panel has to be included where reviewers work.
  ['travelPortalPage', 'travelReviewPage', 'travelReviewerDashboardPage'].forEach(page => {
    const src = fs.readFileSync('lets_app/client/pages/' + page + '.html', 'utf8');
    ok(page + ' includes the panel',
       /include\('client\/shared\/travelDelegationPanel'\)/.test(src));
  });

  // Included AFTER serverCall, which it calls on DOMContentLoaded.
  const portal = fs.readFileSync('lets_app/client/pages/travelPortalPage.html', 'utf8');
  ok('and after serverCall, which it depends on',
     portal.indexOf("include('client/shared/serverCall')") <
     portal.indexOf("include('client/shared/travelDelegationPanel')"));

  // Render must distinguish the admin preview from a real delegation.
  const render = fs.readFileSync('lets_app/server/50_pages/Render.js', 'utf8');
  ok('Render accepts an actAs parameter', /params\.actAs/.test(render));
  ok('and publishes the VERIFIED result, not the request',
     /template\.actingAs = ctx\.actingAs/.test(render),
     'ctx.actingAs is empty when the delegation was refused');
}

// ---------------------------------------------------------------------------
console.log('\n9. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/30_services/Delegation.js', 'utf8');

  // 9a — allow an open-ended delegation. §2 must fail.
  const ANCHOR_END = "    if (!end) {";
  ok('the end-date anchor is present', src.indexOf(ANCHOR_END) > -1);
  const openEnded = src.replace(ANCHOR_END, "    if (false) {");
  {
    const t = load({ email: 'alice@gsa.gov' });
    vm.runInContext(openEnded, t.ctx, { filename: 'Delegation.js (open-ended)' });
    const r = t.run("createDelegation({delegateEmail:'eve@gsa.gov'," +
      "startDate:'" + today + "',reason:'indefinite'})");
    ok('a patched build allows an open-ended delegation', r.success === true,
       'so section 2 is exercising a real guard');
  }

  // 9b — allow re-delegation. §2 must fail.
  const ANCHOR_RE = "    return x.delegateEmail === principal && isInForce(x);";
  ok('the re-delegation anchor is present', src.indexOf(ANCHOR_RE) > -1);
  const reDel = src.replace(ANCHOR_RE, "    return false;");
  {
    const t = load({ email: 'alice@gsa.gov' });
    vm.runInContext(reDel, t.ctx, { filename: 'Delegation.js (re-delegate)' });
    grant(t, 'bob@gsa.gov', today, plus(14));
    t.as('bob@gsa.gov');
    const r = grant(t, 'dave@gsa.gov', today, plus(5), 'passing on');
    ok('a patched build allows re-delegation', r.success === true,
       'so section 2 is exercising a real guard');
  }

  // 9c — ignore the window. §3 must fail.
  const ANCHOR_FORCE = "    return d.startDate <= when && when <= d.endDate;";
  ok('the in-force anchor is present', src.indexOf(ANCHOR_FORCE) > -1);
  const alwaysOn = src.replace(ANCHOR_FORCE, "    return true;");
  {
    const t = load({ email: 'alice@gsa.gov' });
    vm.runInContext(alwaysOn, t.ctx, { filename: 'Delegation.js (always on)' });
    grant(t, 'frank@gsa.gov', minus(30), minus(10), 'old');
    ok('a patched build lets an expired delegate act',
       t.run("Delegation.canActAs('frank@gsa.gov','alice@gsa.gov').allowed") === true,
       'so section 3 is exercising a real window check');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
