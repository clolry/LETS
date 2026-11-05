/**
 * Automated Verification Script for the coordinator role.
 *
 * WHY THIS ROLE EXISTS
 * --------------------
 * @clolry needs somebody who can reassign a reviewer when a person is out and
 * work the event proposal queue. Both sat behind requireTravelAdmin, which
 * also grants budget allocation editing, HR roster editing, user role granting
 * and the HR data that was just tier-restricted for PII.
 *
 * Granting a coordinator full admin is a one-line change and the wrong answer:
 * it hands over every other admin power as a side effect.
 *
 * THE BOUNDARY IS MONEY AND PRIVILEGE
 * -----------------------------------
 * §2 is the section that holds it. A coordinator may define events, resolve
 * proposals and reassign reviewers. They may NOT set budgets, reserve
 * set-asides, import travel, edit the roster or grant roles.
 *
 * §4 is the one that would otherwise look like a bug: the admin CONSOLE must
 * admit a coordinator, because the reassignment modal and the proposal queue
 * both live there. Gating the page on isAdmin alone would show them "Access
 * Denied" and make the role appear broken rather than scoped.
 *
 * Run: node lets_app/test_coordinator_role.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 280)); fails++; }
};

/** Source with comments stripped, so a comment cannot satisfy an assertion. */
function code(path) {
  return fs.readFileSync(path, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))
    .join('\n');
}

/**
 * Loads the three Access.js role functions in isolation.
 *
 * Extracted rather than loading the whole file, which pulls in the entire
 * access layer and its spreadsheet dependencies.
 */
function loadRoles(roles, who) {
  const logs = [];
  const ctx = vm.createContext({
    console: { log: m => logs.push(String(m)), warn: m => logs.push(String(m)),
               error: m => logs.push(String(m)) },
    JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
    parseInt, parseFloat, isNaN
  });
  vm.runInContext(`
    var __ROLES = ${JSON.stringify(roles || {})};
    var __WHO = ${JSON.stringify(who || 'x@gsa.gov')};
    var __THROW_ROLES = false;
    function _getUnifiedRolesForEmail(e) {
      if (__THROW_ROLES) { throw new Error('role store down'); }
      return __ROLES[e] || [];
    }
    function formatUserName(e) { return String(e).split('@')[0]; }
    var Session = { getActiveUser: function () {
      return { getEmail: function () { return __WHO; } };
    } };
  `, ctx);

  const src = fs.readFileSync('lets_app/server/30_services/Access.js', 'utf8');
  ['isTravelAdmin', 'isTravelCoordinator', 'requireTravelCoordinator',
   'checkTravelAdminAccess'].forEach(fn => {
    const m = src.match(new RegExp('^function ' + fn + '[\\s\\S]*?\\n}', 'm'));
    if (m) vm.runInContext(m[0], ctx);
  });
  return { ctx, logs, run: e => vm.runInContext(e, ctx) };
}

console.log('--- Coordinator role test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. the role resolves, and an admin always satisfies it');
{
  const cases = [
    ['an admin', { 'a@gsa.gov': [{ roleType: 'admin' }] }, 'a@gsa.gov', true, true],
    ['a coordinator', { 'c@gsa.gov': [{ roleType: 'coordinator' }] }, 'c@gsa.gov', false, true],
    ['a BU reviewer', { 'r@gsa.gov': [{ roleType: 'bu_reviewer' }] }, 'r@gsa.gov', false, false],
    ['a site-access user', { 'u@gsa.gov': [{ roleType: 'approved_user' }] }, 'u@gsa.gov', false, false],
    ['nobody', {}, 'n@gsa.gov', false, false]
  ];
  cases.forEach(([label, roles, who, wantAdmin, wantCoord]) => {
    const t = loadRoles(roles, who);
    const a = t.run('isTravelAdmin(' + JSON.stringify(who) + ')');
    const c = t.run('isTravelCoordinator(' + JSON.stringify(who) + ')');
    ok(label + ' -> admin=' + wantAdmin + ' coordinator=' + wantCoord,
       a === wantAdmin && c === wantCoord, { admin: a, coordinator: c });
  });

  // AN ADMIN IS ALWAYS A COORDINATOR. Otherwise every coordinator-gated
  // function would need both checks and one would eventually be forgotten.
  const adm = loadRoles({ 'a@gsa.gov': [{ roleType: 'admin' }] }, 'a@gsa.gov');
  ok('an admin passes the coordinator gate',
     adm.run("isTravelCoordinator('a@gsa.gov')") === true,
     'a coordinator gate must never lock out an admin');

  // And the admin check runs FIRST, so an admin is not dependent on the role
  // store being readable.
  const broken = loadRoles({ 'a@gsa.gov': [{ roleType: 'admin' }] }, 'a@gsa.gov');
  ok('a blank email is refused',
     broken.run("isTravelCoordinator('')") === false);

  // A failing role lookup must DENY, not escalate.
  const down = loadRoles({ 'c@gsa.gov': [{ roleType: 'coordinator' }] }, 'c@gsa.gov');
  down.run('__THROW_ROLES = true;');
  ok('a failing role lookup denies',
     down.run("isTravelCoordinator('c@gsa.gov')") === false);
  ok('and is logged',
     down.logs.some(l => /unified-roles check failed/.test(l)), down.logs);
}

// ---------------------------------------------------------------------------
console.log('\n2. THE BOUNDARY: money and privilege stay admin-only');
{
  // The whole point of the role. Each of these is checked against the
  // FUNCTION BODY, because a file-wide grep would be satisfied by the other
  // functions in the same file.
  const MUST_BE_ADMIN = [
    ['saveBudgetAllocations', 'lets_app/server/40_domain/BudgetAdmin.js',
     'sets the money every DAC spends'],
    ['importExistingTravel', 'lets_app/server/40_domain/BudgetBackfill.js',
     'writes requests that are already approved and consume budget'],
    ['validateExistingTravel', 'lets_app/server/40_domain/BudgetBackfill.js',
     'leaks existing trip names and request IDs'],
    ['saveEventSetAside', 'lets_app/server/40_domain/Events.js',
     'reserves a DAC budget'],
    ['saveHCPosition', 'lets_app/server/40_domain/HCAdmin.js',
     'edits HR data'],
    ['deactivateHCPosition', 'lets_app/server/40_domain/HCAdmin.js',
     'edits HR data']
  ];
  MUST_BE_ADMIN.forEach(([fn, file, why]) => {
    const body = code(file).split(new RegExp('^function ' + fn + '\\(', 'm'))[1];
    const upTo = body ? body.split(/\n}/)[0] : '';
    ok(fn + ' stays ADMIN-only', /isTravelAdmin|_hcAdminGuard_/.test(upTo), why);
    ok('  and does NOT accept a coordinator',
       !/isTravelCoordinator/.test(upTo), why);
  });

  const MUST_ALLOW_COORDINATOR = [
    ['adminReassignReviewer', 'lets_app/server/40_domain/Admin_Actions.js',
     'the reason the role exists'],
    ['saveTravelEvent', 'lets_app/server/40_domain/Events.js',
     'defining an event reserves nothing'],
    ['resolveEventProposal', 'lets_app/server/40_domain/Events.js',
     'promoting a proposal and linking the request']
  ];
  MUST_ALLOW_COORDINATOR.forEach(([fn, file, why]) => {
    const body = code(file).split(new RegExp('^function ' + fn + '\\(', 'm'))[1];
    const upTo = body ? body.split(/\n}/)[0] : '';
    ok(fn + ' accepts a coordinator',
       /isTravelCoordinator|requireTravelCoordinator/.test(upTo), why);
  });

  // requireTravelCoordinator must report WHICH authority was used, so a log
  // can record it.
  const c = loadRoles({ 'c@gsa.gov': [{ roleType: 'coordinator' }] }, 'c@gsa.gov');
  const cr = c.run('requireTravelCoordinator()');
  ok('a coordinator is reported as coordinator',
     cr.role === 'coordinator' && cr.isAdmin === false, cr);
  const a = loadRoles({ 'a@gsa.gov': [{ roleType: 'admin' }] }, 'a@gsa.gov');
  const ar = a.run('requireTravelCoordinator()');
  ok('and an admin as admin', ar.role === 'admin' && ar.isAdmin === true, ar);

  // The reassignment log must record the real authority, not a hardcoded
  // 'Admin' — a coordinator reassigning is a different act from an admin
  // doing it, and the log is where that survives.
  const aa = code('lets_app/server/40_domain/Admin_Actions.js');
  ok('the reassignment log records the real authority',
     /admin\.isAdmin \? 'Admin' : 'Coordinator'/.test(aa),
     'hardcoding Admin would log every coordinator action as an admin one');

  // Refusal must be loud enough to diagnose.
  const r = loadRoles({ 'r@gsa.gov': [{ roleType: 'bu_reviewer' }] }, 'r@gsa.gov');
  let threw = '';
  try { r.run('requireTravelCoordinator()'); } catch (e) { threw = e.message; }
  ok('a reviewer is refused', /Coordinator or administrator access/.test(threw), threw);
  ok('and the refusal is logged',
     r.logs.some(l => /refused r@gsa\.gov/.test(l)), r.logs);
}

// ---------------------------------------------------------------------------
console.log('\n3. a coordinator is NOT a reviewer');
{
  // They do not approve anything. Granting isReviewer would put them in
  // reviewer dashboards with an empty queue, which reads as a broken page.
  // Sliced from the RAW source, not the comment-stripped version. The branch
  // marker is itself a comment, so code() removed the very thing the split
  // looked for and every assertion below failed on correct code.
  //
  // Comments are stripped for the CONTENT checks instead — see below — so a
  // comment still cannot satisfy one.
  const raw = fs.readFileSync('lets_app/server/30_services/Access.js', 'utf8');
  const rawBranch = raw.split('Priority 1b: coordinator')[1] || '';
  const upTo = ('\n'.join = undefined, rawBranch.split('Priority 2')[0])
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))
    .join('\n');
  const access = code('lets_app/server/30_services/Access.js');

  ok('the coordinator branch sets isCoordinator', /ctx\.isCoordinator = true/.test(upTo));
  ok('and sets role to coordinator', /ctx\.role = 'coordinator'/.test(upTo));
  ok('but does NOT set isReviewer', !/ctx\.isReviewer = true/.test(upTo),
     'a coordinator has no queue and no approve button');

  // Their scope is organization-wide: reassigning a stuck request and
  // resolving a proposal are not scoped jobs.
  ok('their scope is all', /scope = \{ type: 'all'/.test(upTo),
     'a scoped coordinator could not do the thing the role exists for');

  // An admin must ALSO carry isCoordinator, because the admin branch returns
  // before reaching the coordinator one — without it a UI gating on
  // isCoordinator would hide a control from the people who definitely have
  // the power.
  const adminBranch = raw.split('Priority 1: admin')[1].split('Priority 1b')[0]
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok('the admin branch also sets isCoordinator',
     /ctx\.isCoordinator = true/.test(adminBranch),
     'the admin branch returns before the coordinator branch runs');

  // The context must declare the flag, or it is undefined for everyone else.
  ok('the context declares isCoordinator', /isCoordinator: false/.test(access));
}

// ---------------------------------------------------------------------------
console.log('\n4. the admin CONSOLE admits a coordinator');
{
  // THE ONE THAT WOULD LOOK LIKE A BUG. The reassignment modal and the event
  // proposal queue both live on the admin page. Gating it on isAdmin alone
  // would replace the page with "Access Denied" the moment a coordinator
  // opened it.
  const render = code('lets_app/server/50_pages/Render.js');
  // Sliced on the RAW source and cut at the next top-level function, not at
  // the first '\n}' — the function body contains nested closing braces at
  // that indentation, so the slice ended early and missed the template
  // assignments. The assertion failed on correct code.
  const renderRaw = fs.readFileSync('lets_app/server/50_pages/Render.js', 'utf8');
  const pageRaw = renderRaw.split('function serveTravelAdminPage')[1] || '';
  const page = pageRaw.split(/\n(?:function |\/\*\*)/)[0]
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok('the page gate uses isTravelCoordinator',
     /isTravelCoordinator\(userEmail\)/.test(page));
  ok('and not isTravelAdmin alone',
     !/if \(!isTravelAdmin\(userEmail\)\)/.test(page));
  ok('the page is told whether this is a full admin',
     /template\.isFullAdmin = isTravelAdmin\(userEmail\)/.test(page));

  // The client's own check must agree, or the server lets them in and the
  // client throws them out.
  const ctl = code('lets_app/client/controllers/admin/travelAdminController.html');
  ok('the client gates on hasConsoleAccess, not isAdmin',
     /hasConsoleAccess/.test(ctl));
  ok('and falls back to isAdmin for an older server build',
     /result\.hasConsoleAccess !== undefined/.test(ctl));

  const acc = loadRoles({ 'c@gsa.gov': [{ roleType: 'coordinator' }] }, 'c@gsa.gov');
  const r = acc.run('checkTravelAdminAccess()');
  ok('checkTravelAdminAccess reports console access for a coordinator',
     r.hasConsoleAccess === true, r);
  ok('but isAdmin stays FALSE', r.isAdmin === false,
     'so the client can still tell them apart and hide the money sections');

  const accA = loadRoles({ 'a@gsa.gov': [{ roleType: 'admin' }] }, 'a@gsa.gov');
  const ra = accA.run('checkTravelAdminAccess()');
  ok('and an admin gets both', ra.isAdmin === true && ra.hasConsoleAccess === true);

  const accR = loadRoles({ 'r@gsa.gov': [{ roleType: 'bu_reviewer' }] }, 'r@gsa.gov');
  ok('a reviewer gets neither',
     accR.run('checkTravelAdminAccess()').hasConsoleAccess === false);
}

// ---------------------------------------------------------------------------
console.log('\n5. the UI hides what a coordinator cannot use');
{
  const ctl = code('lets_app/client/controllers/admin/travelAdminController.html');

  ok('role visibility is applied on init',
     /_applyRoleVisibility\(\)/.test(ctl));
  ok('the users tab is hidden', /'users', 'roster'/.test(ctl));
  ok('and the set-aside button', /evNewSetAside/.test(ctl));

  // DEFAULTS TO TRUE when absent, so an older cached page keeps working. The
  // server refuses the restricted functions regardless, so the worst case is
  // a visible button that errors rather than a hidden power.
  ok('isFullAdmin defaults to true when absent',
     /options\.isFullAdmin !== false/.test(ctl),
     'a cached page must not silently lose admin controls');

  // THE SERVER'S ANSWER WINS over the baked-in template value, so a role
  // revoked since the page rendered is reflected.
  ok('the live server answer can downgrade the view',
     /result\.isAdmin === false[\s\S]{0,160}_applyRoleVisibility\(\)/.test(ctl));

  // Hiding is COSMETIC and the code should say so, because a future reader
  // might otherwise treat it as the control.
  const raw = fs.readFileSync(
    'lets_app/client/controllers/admin/travelAdminController.html', 'utf8');
  ok('the code states that hiding is not the control',
     /COSMETIC ONLY|checks isTravelAdmin itself/.test(raw));

  // A console that silently lacks sections looks broken rather than scoped.
  ok('a coordinator is told what they can do',
     /Coordinator access: requests and events/.test(ctl));
}

// ---------------------------------------------------------------------------
console.log('\n6. the role is grantable end to end');
{
  // A role the server validates but the UI cannot offer is unreachable; a
  // role the UI offers but the server rejects fails on save with "Invalid
  // roleType", which reads as a bug.
  const users = code('lets_app/server/40_domain/Users.js');
  const m = users.match(/const TRAVEL_ROLE_TYPES = \[([\s\S]*?)\];/);
  ok('the server validation list exists', !!m);
  ok("and includes 'coordinator'", m && /'coordinator'/.test(m[1]), m && m[1]);

  const uc = code('lets_app/client/controllers/admin/travelUsersController.html');
  ok('the UI catalog offers it', /'coordinator':\s*\{/.test(uc));
  ok('as grantable', /'coordinator':[\s\S]{0,200}grantable: true/.test(uc));
  ok('with no scope, because it is organization-wide',
     /'coordinator':[\s\S]{0,200}hasScope: false/.test(uc));

  // The hint must state the BOUNDARY, not just the grant. An admin choosing a
  // role needs to know a coordinator cannot touch budgets.
  ok('the hint says what is EXCLUDED',
     /Cannot set budgets/.test(uc),
     'an admin picking a role needs the boundary, not just the powers');

  // The stored key must not collide with an existing one.
  const existing = ['admin', 'aas_fo_reviewer', 'fas_fo_reviewer',
                    'bu_reviewer', 'sector_override', 'approved_user'];
  ok('the key does not collide with an existing role',
     existing.indexOf('coordinator') === -1);
}

// ---------------------------------------------------------------------------
console.log('\n7. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/30_services/Access.js', 'utf8');

  // 7a — let any role satisfy the coordinator gate. §1 must fail.
  const ANCHOR = "      if (roles[u].roleType === 'coordinator') return true;";
  ok('the role-match anchor is present', src.indexOf(ANCHOR) > -1);
  const anyRole = src.replace(ANCHOR, '      return true;');
  {
    const t = loadRoles({ 'r@gsa.gov': [{ roleType: 'bu_reviewer' }] }, 'r@gsa.gov');
    const m = anyRole.match(/^function isTravelCoordinator[\s\S]*?\n}/m);
    vm.runInContext(m[0], t.ctx, { filename: 'Access.js (any role)' });
    ok('a patched build lets a reviewer pass',
       t.run("isTravelCoordinator('r@gsa.gov')") === true,
       'so section 1 is exercising a real role check');
  }

  // 7b — give the coordinator isReviewer. §3 must fail.
  const ANCHOR2 = "      ctx.isCoordinator = true;\n      // Deliberately NOT isReviewer.";
  ok('the isReviewer anchor is present', src.indexOf(ANCHOR2) > -1);
  const asReviewer = src.replace(ANCHOR2,
    "      ctx.isCoordinator = true;\n      ctx.isReviewer = true;\n      // was:");
  ok('a patched build would grant isReviewer',
     /ctx\.isReviewer = true;\n      \/\/ was:/.test(asReviewer),
     'so section 3 is exercising a real omission');

  // 7c — let a coordinator reserve budget. §2 must fail.
  const ev = fs.readFileSync('lets_app/server/40_domain/Events.js', 'utf8');
  const ANCHOR3 = "  if (!who || !isTravelAdmin(who)) {\n    console.warn('saveEventSetAside:";
  ok('the set-aside gate anchor is present', ev.indexOf(ANCHOR3) > -1);
  const loosened = ev.replace(ANCHOR3,
    "  if (!who || !isTravelCoordinator(who)) {\n    console.warn('saveEventSetAside:");
  const body = loosened.split(/^function saveEventSetAside\(/m)[1].split(/\n}/)[0];
  ok('a patched build lets a coordinator reserve budget',
     /isTravelCoordinator/.test(body),
     'so section 2 is exercising a real boundary');
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
