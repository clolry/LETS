/**
 * Automated Verification Script for request read authorization
 * (30_services/RequestAccess.js + the gate in 40_domain/Review_Read.js).
 *
 * WHY THIS EXISTS
 * ---------------
 * @clolry: "Reduce the exposure on getRequestForReview to at or below TRIP's
 * HC exposure."
 *
 * WHAT WAS EXPOSED
 * ----------------
 * getRequestForReview contained NO authorization check. It computed a
 * `permissions` object and returned it ALONGSIDE the data; the client used it
 * to decide which buttons to draw. Nothing gated the payload.
 *
 * Any signed-in user who knew a request ID received the submitter and all four
 * reviewers by name and email, and per traveller: employee ID, LCAT, security
 * clearance held, valid passport held, telework status, home commute distance
 * and parking cost — plus every attachment file ID, which
 * shareAttachmentsWithUsers would then grant anyone access to.
 *
 * Request IDs are SEQUENTIAL, so enumeration is a loop. Finding G-004, C4/R3.
 *
 * THE TWO THINGS THIS SUITE WATCHES
 * ---------------------------------
 * §2 — the CACHED path. The review cache is keyed per REQUEST with no user in
 * the key, so gating only the slow path would mean the first legitimate read
 * populated the cache and every later caller was served unchecked. That is
 * the path an enumeration loop hits.
 *
 * §4 — a failing scope lookup must DENY. The HC directory could safely
 * degrade to a narrower tier; here the only safe degradation is refusal.
 *
 * Run: node lets_app/test_request_access.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 280)); fails++; }
};

const REQ = {
  requestId: 'L27-0001',
  submitterEmail: 'sub@gsa.gov',
  currentReviewerEmail: 'rev@gsa.gov',
  sectorDirectorEmail: 'sd@gsa.gov',
  buReviewerEmail: 'bu@gsa.gov',
  submitterOrgCode: 'FCA0A',
  submitterBU: 'OMD',
  status: 'PENDING_BU'
};

const TRAV = [
  { email: 'trav1@gsa.gov', employeeName: 'Ada Lovelace', employeeId: '0010042',
    lcat: 'Analyst', hasSecurityClearance: true, hasValidPassport: true,
    isFullTimeTelework: false, normalCommuteDistance: 12,
    normalCommuteParking: 9.5, receivingNFS: false, subtotal: 1200 },
  { email: 'trav2@gsa.gov', employeeName: 'Bo Deep', employeeId: '0010043',
    lcat: 'PM', hasSecurityClearance: false, hasValidPassport: false,
    isFullTimeTelework: true, normalCommuteDistance: 4,
    normalCommuteParking: 0, receivingNFS: true, subtotal: 900 }
];

const LOG = [{ actionByEmail: 'prior@gsa.gov', action: 'Sector_Approved' }];

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
    var __ADMIN = ${opts.admin ? 'true' : 'false'};
    var __ADMIN_THROWS = ${opts.adminThrows ? 'true' : 'false'};
    function isTravelAdmin() {
      if (__ADMIN_THROWS) { throw new Error('role store down'); }
      return __ADMIN;
    }
    var __CTX = ${JSON.stringify(opts.ctx || { role: 'none', scope: { type: 'none', codes: [], names: [] } })};
    var __CTX_THROWS = ${opts.ctxThrows ? 'true' : 'false'};
    function getReviewerContext() {
      if (__CTX_THROWS) { throw new Error('scope store down'); }
      return __CTX;
    }
    var Session = { getActiveUser: function () {
      return { getEmail: function () { return ${JSON.stringify(opts.email === undefined ? 'x@gsa.gov' : opts.email)}; } };
    } };
    var __ROWS = [];
    var __DB_THROWS = ${opts.dbThrows ? 'true' : 'false'};
    function TravelDB() {
      if (__DB_THROWS) { throw new Error('no db'); }
      this.sheet = function () { return {}; };
      this.appendRow = function (n, r) { __ROWS.push({ sheet: n, row: r }); };
    }
    var SHEET_NAMES = { ACCESS_LOG: 'Access_Log' };
    var TRAVEL_SHEET_SCHEMAS = { 'Access_Log': ['Log_ID','Timestamp','Email',
      'Decision','Path','Position_Number','Office_Title','Org_Code','Detail'] };
  `, ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/30_services/RequestAccess.js', 'utf8'),
                  ctx, { filename: 'RequestAccess.js' });
  return { ctx, logs, run: e => vm.runInContext(e, ctx) };
}

const access = opts => {
  const t = load(opts);
  return t.run('requestReadAccess(' + JSON.stringify(REQ) + ',' +
               JSON.stringify(TRAV) + ',' + JSON.stringify(LOG) + ')');
};

console.log('--- Request read authorization test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. who may read a request');
{
  // A travel request is not a public record. Unlike the HC directory — which
  // is organisation-visible by design — an unrelated user is REFUSED, not
  // served a redacted copy. A redacted copy would still confirm the request
  // exists and who is on it.
  const cases = [
    ['an admin', { admin: true }, true, 'admin'],
    ['the submitter', { email: 'sub@gsa.gov' }, true, 'submitter'],
    ['a traveller on it', { email: 'trav1@gsa.gov' }, true, 'traveler'],
    ['the current reviewer', { email: 'rev@gsa.gov' }, true, 'current-reviewer'],
    ['a named sector director', { email: 'sd@gsa.gov' }, true, 'named-reviewer'],
    ['a named BU reviewer', { email: 'bu@gsa.gov' }, true, 'named-reviewer'],
    // They already acted and may need to justify that decision later.
    // Excluding them would mean a reviewer cannot see what they approved.
    ['a PRIOR reviewer who acted', { email: 'prior@gsa.gov' }, true, 'prior-reviewer'],
    ['an org-wide reviewer',
     { email: 'z@gsa.gov', ctx: { role: 'oso', scope: { type: 'all', codes: [], names: [] } } },
     true, 'reviewer-scope-all'],
    ['an UNRELATED signed-in user', { email: 'nobody@gsa.gov' }, false, 'none']
  ];
  cases.forEach(([label, opts, allowed, basis]) => {
    const r = access(opts);
    ok(label + ' -> ' + (allowed ? 'allowed' : 'REFUSED'),
       r.allowed === allowed && r.basis === basis, r);
  });

  // The refusal must explain itself, or a legitimate user who hits it has no
  // idea what to do.
  const denied = access({ email: 'nobody@gsa.gov' });
  ok('the refusal names who CAN see it',
     /submitter.*travellers.*reviewers.*administrators/.test(denied.reason), denied.reason);
}

// ---------------------------------------------------------------------------
console.log('\n2. scope matching, including the hierarchy');
{
  // Org codes are hierarchical: a reviewer scoped to FCA must see a request
  // from FCA0A. Exact matching would silently deny every sub-org request.
  const byCode = access({ email: 'z@gsa.gov',
    ctx: { role: 'bu', scope: { type: 'bu', codes: ['FCA'], names: [] } } });
  ok('a reviewer scoped to FCA sees an FCA0A request',
     byCode.allowed && byCode.basis === 'reviewer-scope', byCode);

  const byName = access({ email: 'z@gsa.gov',
    ctx: { role: 'bu', scope: { type: 'bu', codes: [], names: ['OMD'] } } });
  ok('and a BU-name scope matches too', byName.allowed, byName);

  // THE IMPORTANT NEGATIVE. A reviewer for one DAC must not read another's.
  const wrongOrg = access({ email: 'z@gsa.gov',
    ctx: { role: 'bu', scope: { type: 'bu', codes: ['FCB'], names: [] } } });
  ok('a reviewer scoped to FCB does NOT see an FCA0A request',
     !wrongOrg.allowed, wrongOrg);

  // Prefix matching must not run backwards: scope FCA0A0B must not match a
  // request from FCA0A.
  const narrower = access({ email: 'z@gsa.gov',
    ctx: { role: 'bu', scope: { type: 'bu', codes: ['FCA0A0B'], names: [] } } });
  ok('a NARROWER scope does not match a broader request',
     !narrower.allowed, narrower);

  // A role of 'none' with an 'all' scope must not pass. getReviewerContext
  // initialises scope before resolving the role, so this combination is
  // reachable.
  const noRole = access({ email: 'z@gsa.gov',
    ctx: { role: 'none', scope: { type: 'all', codes: [], names: [] } } });
  ok('scope "all" with role "none" is refused', !noRole.allowed, noRole);
}

// ---------------------------------------------------------------------------
console.log('\n3. field reduction for callers who are entitled but not everything');
{
  // These callers are already allowed to read the request. They are still not
  // entitled to another person's security clearance or home commute.
  const SENSITIVE = ['employeeId', 'hasSecurityClearance', 'hasValidPassport',
    'isFullTimeTelework', 'normalCommuteDistance', 'normalCommuteParking',
    'receivingNFS', 'lcat'];

  const sanitize = (basis, email) => {
    const t = load({ email });
    return t.run('sanitizeTravelersForCaller(' + JSON.stringify(TRAV) + ',' +
                 JSON.stringify(basis) + ',' + JSON.stringify(email) + ')');
  };

  // A named reviewer who is NOT the current reviewer has not been asked to
  // act yet.
  const named = sanitize('named-reviewer', 'sd@gsa.gov');
  SENSITIVE.forEach(f => {
    ok('a named (non-current) reviewer does not see ' + f, !(f in named[0]));
  });
  ok('but still sees name and email, which they need',
     named[0].employeeName === 'Ada Lovelace' && named[0].email === 'trav1@gsa.gov');
  ok('and the cost figures, which are the point of the review',
     named[0].subtotal === 1200);
  // Said explicitly, so a consumer can tell withheld from empty — the same
  // reason the HC bundle carries _piiTier.
  ok('and is told which fields were withheld',
     Array.isArray(named[0]._redacted) && named[0]._redacted.length === 8,
     named[0]._redacted);

  // THE CURRENT REVIEWER NEEDS THEM. Clearance and passport bear on whether
  // someone can attend a classified or foreign event; commute figures feed
  // the local-travel calculation.
  const current = sanitize('current-reviewer', 'rev@gsa.gov');
  ok('the CURRENT reviewer sees clearance', current[0].hasSecurityClearance === true);
  ok('and passport status', current[0].hasValidPassport === true);
  ok('and the commute figures', current[0].normalCommuteDistance === 12);
  ok('with no redaction marker', !('_redacted' in current[0]));

  const admin = sanitize('admin', 'a@gsa.gov');
  ok('an admin sees everything', admin[0].employeeId === '0010042');

  // A TRAVELLER SEES THEIR OWN ROW IN FULL, and only theirs.
  const self = sanitize('traveler', 'trav1@gsa.gov');
  ok('a traveller sees their own clearance',
     self[0].hasSecurityClearance === true && self[0].employeeId === '0010042');
  ok('but NOT the other traveller\'s',
     !('hasSecurityClearance' in self[1]) && !('employeeId' in self[1]),
     Object.keys(self[1]));
  ok('and the other row says it was redacted', Array.isArray(self[1]._redacted));
}

// ---------------------------------------------------------------------------
console.log('\n4. failures DENY, they do not degrade');
{
  // The HC directory could safely fall back to a narrower tier, because what
  // remained was harmless. Here the only safe degradation is refusal.
  const scopeDown = access({ email: 'z@gsa.gov', ctxThrows: true });
  ok('a failing scope lookup refuses', !scopeDown.allowed, scopeDown);

  const t = load({ email: 'z@gsa.gov', ctxThrows: true });
  t.run('requestReadAccess(' + JSON.stringify(REQ) + ',' + JSON.stringify(TRAV) +
        ',' + JSON.stringify(LOG) + ')');
  ok('and logs why', t.logs.some(l => /scope check failed/.test(l)), t.logs);

  // A failing ADMIN check must not block a submitter who is otherwise
  // entitled — the submitter test runs after it and does not depend on roles.
  const adminDown = access({ email: 'sub@gsa.gov', adminThrows: true });
  ok('a failing admin check still lets the submitter through',
     adminDown.allowed && adminDown.basis === 'submitter', adminDown);
  const adminDownStranger = access({ email: 'nobody@gsa.gov', adminThrows: true });
  ok('but does not let a stranger through', !adminDownStranger.allowed);

  // An anonymous caller reads nothing. Unlike the HC directory, where failing
  // closed would break the travel form for everyone, nothing legitimate needs
  // an anonymous request read.
  const anon = access({ email: '' });
  ok('an anonymous caller is refused', !anon.allowed, anon);
  ok('and told why', /active user/.test(anon.reason), anon.reason);

  // Missing or malformed inputs must not throw — getRequestForReview calls
  // this before it has validated much.
  const t2 = load({ email: 'x@gsa.gov' });
  ok('a null request is handled',
     t2.run('requestReadAccess(null,null,null)').allowed === false);
  ok('an empty request is handled',
     t2.run('requestReadAccess({},[],[])').allowed === false);
}

// ---------------------------------------------------------------------------
console.log('\n5. the gate is on BOTH paths in Review_Read');
{
  // THE CACHED PATH IS THE ONE THAT MATTERS.
  //
  // The review cache is keyed 'request_review_v2_<id>' — per REQUEST, with no
  // user in the key. Gating only the slow path would mean the first
  // legitimate read populated the cache and every subsequent caller was
  // served from it unchecked. An enumeration loop hits the fast path.
  const src = fs.readFileSync('lets_app/server/40_domain/Review_Read.js', 'utf8');

  const cachedBlock = src.slice(src.indexOf('if (!isChainedCall)'),
                                src.indexOf('db = db || new TravelDB()'));
  ok('the CACHED path checks access',
     /requestReadAccess\(/.test(cachedBlock), 'the cache is shared across users');
  ok('and refuses with FORBIDDEN',
     /errorResponse\(cachedAccess\.reason, 'FORBIDDEN'\)/.test(cachedBlock));
  ok('and logs the refusal', /logRequestAccessDenial/.test(cachedBlock));
  // The cached copy is the FULL envelope, so serving it as-is would hand a
  // scoped reviewer another traveller's clearance.
  ok('and re-sanitizes the cached travellers',
     /sanitizeTravelersForCaller\(\s*cachedData\.travelers/.test(cachedBlock));

  const uncached = src.slice(src.indexOf('========== AUTHORIZATION =========='));
  ok('the uncached path checks access', /const access = requestReadAccess\(/.test(uncached));
  ok('refuses before building the envelope',
     uncached.indexOf('return errorResponse(access.reason') <
     uncached.indexOf('const envelope = successResponse'), 'order matters');
  ok('and sanitizes travellers in the envelope',
     /travelers: sanitizeTravelersForCaller\(travelers, access\.basis/.test(uncached));

  // accessBasis is surfaced so a bug report can distinguish "no access" from
  // "reduced access".
  ok('the payload reports the access basis', /accessBasis: access\.basis/.test(uncached));
  ok('and the cached payload does too', /accessBasis: cachedAccess\.basis/.test(cachedBlock));
}

// ---------------------------------------------------------------------------
console.log('\n6. refusals are logged, successes are not');
{
  // A successful read happens constantly in normal use. A refusal means
  // somebody asked for a request they have no relationship to — and with
  // sequential IDs, that is what enumeration looks like.
  const t = load({ email: 'nobody@gsa.gov' });
  t.run("logRequestAccessDenial('L27-0001','nobody@gsa.gov','no access')");
  const rows = t.run('__ROWS');
  ok('a refusal is logged', rows.length === 1);
  ok('to Access_Log', rows[0].sheet === 'Access_Log');
  ok('with a REQUEST_DENIED decision', rows[0].row.indexOf('REQUEST_DENIED') > -1);
  ok('naming the caller', rows[0].row.indexOf('nobody@gsa.gov') > -1);
  ok('and the request they asked for',
     rows[0].row.some(c => /L27-0001/.test(String(c))), rows[0].row);
  // Writes to Access_Log are positional, so width matters.
  ok('the row matches the Access_Log width', rows[0].row.length === 9);

  // An audit write must never break the refusal it is recording.
  const broken = load({ email: 'n@gsa.gov', dbThrows: true });
  let threw = false;
  try { broken.run("logRequestAccessDenial('L27-0001','n@gsa.gov','x')"); }
  catch (e) { threw = true; }
  ok('a failing audit write does not throw', !threw);
  ok('and warns instead',
     broken.logs.some(l => /logRequestAccessDenial/.test(l)), broken.logs);
}

// ---------------------------------------------------------------------------
console.log('\n6b. the attachment disclosure chain is closed');
{
  // G-004 WAS A CHAIN, not a single hole. getRequestForReview leaked file
  // IDs; getRequestAttachments listed them for any request; and
  // shareAttachmentsWithUsers granted any email access to any file ID.
  // Together: enumerate a sequential request ID, read its files, share them
  // to yourself.
  const att = fs.readFileSync('lets_app/server/30_services/Attachments.js', 'utf8');

  // Sliced to the END of the file, not to shareAttachmentsWithUsers —
  // getRequestAttachments appears AFTER it in source order, so the original
  // slice was backwards and empty. A test that slices nothing asserts
  // nothing, and it reported two failures that looked like missing guards.
  const listStart = att.indexOf('function getRequestAttachments');
  const listBody = att.slice(listStart,
    att.indexOf('function getOrCreateSubfolder_', listStart));
  ok('the slice found the function body', listBody.length > 200, listBody.length);
  ok('getRequestAttachments checks request access',
     /requestReadAccess\(/.test(listBody),
     'if you may not read the request, you may not list its files');
  ok('and refuses on a failed check',
     /Could not verify access to this request/.test(listBody),
     'a failure must DENY, not serve file IDs unchecked');
  ok('and reuses the same rule rather than reimplementing it',
     !/submitterEmail ===|isCurrentReviewer =/.test(listBody),
     'a second implementation would drift from the first');

  // The browser-callable wrapper is admin-gated.
  const shareWrapper = att.slice(att.indexOf('function shareAttachmentsWithUsers'),
                                 att.indexOf('function _shareAttachmentsInternal_'));
  ok('shareAttachmentsWithUsers is admin-gated',
     /isTravelAdmin/.test(shareWrapper) && /refused non-admin caller/.test(shareWrapper));

  // THE PART THAT WOULD HAVE BROKEN SILENTLY.
  //
  // Review_Action shares attachments with the NEXT REVIEWER on approval, and
  // that actor is a reviewer, not an admin. An admin gate on the shared
  // implementation would have broken every handoff — and the call site
  // catches its own errors and logs a warning, so the approval would still
  // succeed and nobody would notice until a reviewer could not open a file.
  const action = fs.readFileSync('lets_app/server/40_domain/Review_Action.js', 'utf8');
  ok('the reviewer handoff uses the INTERNAL function',
     /_shareAttachmentsInternal_\(\s*$|_shareAttachmentsInternal_\(/m.test(action),
     'the admin-gated wrapper would have broken every handoff');
  ok('and not the admin-gated wrapper',
     !/=\s*shareAttachmentsWithUsers\(/.test(action), 'checked by assignment form');
  ok('the internal function exists', /function _shareAttachmentsInternal_/.test(att));
}

console.log('\n7. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/30_services/RequestAccess.js', 'utf8');

  // 7a — fail OPEN on a scope lookup error. §4 must fail.
  const failOpen = src.replace(
    "    console.error('requestReadAccess: scope check failed: ' + e.message);",
    "    return { allowed: true, basis: 'reviewer-scope', depth: 'full', reason: '' };");
  ok('negative control patched the scope failure path', failOpen !== src);
  {
    const t = load({ email: 'z@gsa.gov', ctxThrows: true });
    vm.runInContext(failOpen, t.ctx, { filename: 'RequestAccess.js (fail open)' });
    const r = t.run('requestReadAccess(' + JSON.stringify(REQ) + ',' +
                    JSON.stringify(TRAV) + ',' + JSON.stringify(LOG) + ')');
    ok('a patched build allows a stranger when the scope store is down',
       r.allowed === true, 'so section 4 is exercising a real deny');
  }

  // 7b — drop the final refusal. §1 must fail.
  const allowAll = src.replace(
    "  return {\n    allowed: false, basis: 'none', depth: 'redacted',",
    "  return {\n    allowed: true, basis: 'none', depth: 'full',");
  ok('negative control patched the default refusal', allowAll !== src);
  {
    const t = load({ email: 'nobody@gsa.gov' });
    vm.runInContext(allowAll, t.ctx, { filename: 'RequestAccess.js (allow all)' });
    const r = t.run('requestReadAccess(' + JSON.stringify(REQ) + ',' +
                    JSON.stringify(TRAV) + ',' + JSON.stringify(LOG) + ')');
    ok('a patched build serves an unrelated user', r.allowed === true,
       'so section 1 is exercising a real default-deny');
  }

  // 7c — treat every caller as the current reviewer, so nothing is reduced.
  // §3 must fail.
  //
  // My first attempt renamed the sensitive-field array and expected a throw.
  // It did not throw: Array.prototype.indexOf on an undefined receiver would,
  // but the rename left `REQUEST_TRAVELER_SENSITIVE` undefined only at the
  // point of use inside a closure that was never reached for that basis. A
  // control that does not provoke the behaviour proves nothing, so this one
  // targets the branch directly.
  const noRedact = src.replace(
    "  if (basis === 'admin' || basis === 'current-reviewer') return travelers || [];",
    "  return travelers || [];");
  ok('negative control patched the reduction branch', noRedact !== src);
  {
    const t = load({ email: 'sd@gsa.gov' });
    vm.runInContext(noRedact, t.ctx, { filename: 'RequestAccess.js (no redact)' });
    const out = t.run('sanitizeTravelersForCaller(' + JSON.stringify(TRAV) +
                      ",'named-reviewer','sd@gsa.gov')");
    ok('a patched build leaks clearance to a non-current reviewer',
       out[0].hasSecurityClearance === true && out[0].employeeId === '0010042',
       'so section 3 is exercising a real reduction');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
