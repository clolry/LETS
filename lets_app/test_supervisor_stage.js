/**
 * The supervisor review stage.
 *
 * WHY THIS STAGE EXISTS
 * ---------------------
 * @clolry: "One thing that we need to remember is that all employees across
 * the entire org are going to need access to the system. AAS built TRIP to
 * have requests submitted by a director but our Chief of Staff wants
 * individual employees to submit requests on their own (and route through
 * their supervisor/director/SCD, etc). I'm concerned that this shift hasn't
 * been included in the design."
 *
 * It had not been. The inherited chain was Sector -> BU -> OSO -> FAS and
 * started at the Service Center Director, because in AAS a director was the
 * submitter. Measured on the live roster, 866 of 1,046 positions are
 * non-supervisory — so the submitter is now usually somebody with a
 * supervisor above them, and that supervisor reviews first.
 *
 * ADDED, NOT SUBSTITUTED. @clolry: "Supervisor does not replace SCD."
 *
 * THE TWO RULES HE SET
 * --------------------
 *   "Supervisor is the highest grade != 8 in the same org code as the
 *    requestor."
 *   "yes, supervisor submission goes to the next approver."
 *
 * WHAT THIS SUITE GUARDS, AND WHY EACH PART
 * -----------------------------------------
 * §1 the resolver, pure. Keyed on the ORG CODE rather than the reports-to
 *    chain, which is @clolry's choice and the more robust one — see
 *    HCRules.findHcSupervisorForOrg.
 * §2 the eight routing outcomes, including the three pre-existing skip rules
 *    that must still work.
 * §3 the state machine: approve forwards to the SCD, needs-info returns to
 *    the SUPERVISOR and not forward, deny is available.
 * §4 the fourteen lists a new status has to appear in. This is the section
 *    that matters most: a status missing from one of them fails SILENTLY —
 *    an admin count that omits a stage, a stalled report that never shows it,
 *    a submitter with no way to answer a question.
 * §5 site access for the 866, and the three things it does NOT grant.
 * §6 negative controls.
 *
 * Run: node lets_app/test_supervisor_stage.js
 */

const fs = require('fs');
const vm = require('vm');
const SERVER = __dirname + '/server/';

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 240)); fails++; }
};

const HCRules = require('./server/01_constants/HCRules.js');

/** A position, in the shape hcGetBundle yields. */
const P = (pn, email, name, org, sup, grade, occ) => ({
  positionNumber: pn, emailAddress: email, employeeName: name, orgCode: org,
  supervisoryStatus: sup, grade: grade, occupancyStatus: occ || 'FILLED'
});

// ---------------------------------------------------------------------------
console.log('\n1. the supervisor is the most senior non-8 in the same org code');
{
  const roster = [
    P('1', 'boss@gsa.gov', 'Boss,Big', 'FCA0BAA', '2', '14'),
    P('2', 'lead@gsa.gov', 'Lead,Team', 'FCA0BAA', '7', '13'),
    P('3', 'emp@gsa.gov', 'Emp,Regular', 'FCA0BAA', '8', '12'),
    P('4', 'other@gsa.gov', 'Other,Org', 'FCA0BAB', '2', '15'),
    P('5', '', '', 'FCA0BAA', '2', '15', 'VACANT'),
    P('6', 'tie1@gsa.gov', 'Tie,One', 'FCB0A', '2', '14'),
    P('7', 'tie2@gsa.gov', 'Tie,Two', 'FCB0A', '2', '14'),
    P('8', 'noaddr@gsa.gov', '', 'FCC0A', '2', '15'),
    P('9', '', 'Named,NoEmail', 'FCC0B', '2', '15')
  ];
  const find = (org, me) => HCRules.findHcSupervisorForOrg(roster, org, me);

  const s = find('FCA0BAA', 'emp@gsa.gov');
  ok('an employee gets the highest-graded supervisor in their org',
     s && s.emailAddress === 'boss@gsa.gov', s);

  // THE RULE IS GRADE, NOT THE SUPERVISORY CODE NUMBER. Code 2 and code 7 are
  // both supervisory; a GS-14 code 2 outranks a GS-13 code 7 on grade, and
  // the code number carries no seniority at all.
  ok('grade decides, not the code number',
     s && s.grade === '14', s && s.grade);

  // THE REQUESTOR IS EXCLUDED. @clolry: "yes, supervisor submission goes to
  // the next approver." Without this the first stage would approve itself.
  const own = find('FCA0BAA', 'boss@gsa.gov');
  ok('a supervisor is not their own supervisor',
     own && own.emailAddress === 'lead@gsa.gov', own);
  ok('and the next person down is a Team Leader, code 7 — still supervisory',
     own && own.supervisoryStatus === '7',
     'the old "=== 2" rule would have found nobody here');

  // A VACANT SEAT CANNOT APPROVE, even at a higher grade. The GS-15 vacancy
  // in FCA0BAA must lose to the filled GS-14.
  ok('a vacant higher-graded seat does not win',
     s && s.positionNumber !== '5',
     'there is nobody in it to route to');

  // NEITHER CAN A SEAT WITH NO ADDRESS. Email_Address is how a reviewer is
  // identified; assigning a stage to an empty email strands the request.
  ok('a supervisor with no name is not resolved',
     find('FCC0A', 'x@gsa.gov') === null);
  ok('nor one with a name and no address',
     find('FCC0B', 'x@gsa.gov') === null,
     'there would be nobody to notify or to match at sign-in');

  // AN ORG WITH NO OTHER SUPERVISOR RETURNS NULL rather than a placeholder.
  ok('the only supervisor in an org has none themselves',
     find('FCA0BAB', 'other@gsa.gov') === null,
     'a one-person org has no supervisor review to do');
  ok('an unknown org code resolves to nobody',
     find('FCZZZZ', 'x@gsa.gov') === null);

  // A TIE IS BROKEN DETERMINISTICALLY. "Whichever the loop saw first" is not
  // an answer anybody could explain to the person whose request went to the
  // wrong supervisor — and it would change when the roster is re-imported.
  const t1 = find('FCB0A', 'x@gsa.gov');
  const t2 = HCRules.findHcSupervisorForOrg(roster.slice().reverse(),
                                            'FCB0A', 'x@gsa.gov');
  ok('a grade tie resolves the same way regardless of roster order',
     t1 && t2 && t1.positionNumber === t2.positionNumber, [t1, t2]);
  ok('and it is the lowest position number', t1 && t1.positionNumber === '6');

  // THE ORG CODE IS AN EXACT MATCH, not a prefix. FCA0BAA and FCA0BAB are
  // different branches; a prefix test would merge them.
  ok('a sibling org does not supply a supervisor',
     find('FCA0BAB', 'other@gsa.gov') === null,
     'FCA0BAA shares six characters with it and must not match');
}

// ---------------------------------------------------------------------------
console.log('\n2. routing: eight cases, including the three existing skip rules');
{
  const src = fs.readFileSync(SERVER + '40_domain/Submission.js', 'utf8');
  const start = src.indexOf('function determineInitialRouting');
  // ANCHOR ON A FUNCTION DECLARED IN THIS FILE. My first harness sliced to
  // '_hasOverheadFromData', which is CALLED here but DECLARED elsewhere —
  // indexOf returned -1, the slice ran to end-of-file, and the file's own
  // getOSOReviewers overwrote the stub. Two routing cases came out wrong and
  // the code was fine. Verify a slice anchor resolves before trusting it.
  const end = src.indexOf('function _officeCodeToOrgCode_');
  ok('both slice anchors resolve', start > -1 && end > start, { start, end });

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt,
    parseFloat, RegExp, Error, Boolean
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SERVER + '01_constants/Status.js', 'utf8'), ctx);
  vm.runInContext([
    "var __oso = { email: 'fo@gsa.gov', name: 'FO' };",
    "var __fas = { email: 'fas@gsa.gov', name: 'FAS' };",
    'function getOSOReviewers() { return { primary: __oso, cc: [] }; }',
    'function getFASReviewer() { return __fas; }',
    // Overhead, so the FAS stage is reachable rather than short-circuiting
    // to APPROVED_GOGOV.
    'function _hasOverheadFromData() { return true; }'
  ].join('\n'), ctx);
  vm.runInContext(src.slice(start, end), ctx, { filename: 'Submission.slice.js' });

  const SD = { email: 'scd@gsa.gov', name: 'SCD' };
  const BU = { email: 'dac@gsa.gov', name: 'DAC' };
  const SUP = { email: 'sup@gsa.gov', name: 'Sup' };
  const route = (sub, sd, bu, sup) => JSON.parse(vm.runInContext(
    'JSON.stringify(determineInitialRouting(' + JSON.stringify(sub) + ',' +
    JSON.stringify(sd) + ',' + JSON.stringify(bu) + ',[],' +
    JSON.stringify(sup) + '))', ctx));

  // THE NEW DEFAULT PATH. This is what 866 people will hit.
  const emp = route('emp@gsa.gov', SD, BU, SUP);
  ok('an ordinary employee starts at their supervisor',
     emp.status === 'PENDING_SUPERVISOR' &&
     emp.currentReviewerEmail === 'sup@gsa.gov', emp);
  ok('and the stored level says Supervisor',
     emp.initialLevel === 'Supervisor', emp.initialLevel);

  // CASCADE. An org with no supervisor starts at the SCD — the old first
  // stage — rather than failing.
  const noSup = route('emp@gsa.gov', SD, BU, null);
  ok('no supervisor cascades to the SCD',
     noSup.status === 'PENDING_SECTOR', noSup);
  const neither = route('emp@gsa.gov', null, BU, null);
  ok('no supervisor and no SCD cascades to the DAC',
     neither.status === 'PENDING_BU', neither);

  // A SUPERVISOR SUBMITTING GETS THE PERSON ABOVE THEM, not themselves.
  // findSubmitterSupervisor does the excluding, so by the time routing sees
  // `supervisor` it is already somebody else.
  const supSubmits = route('sup@gsa.gov', SD, BU, { email: 'boss@gsa.gov', name: 'Boss' });
  ok('a supervisor submitting routes to THEIR supervisor',
     supSubmits.currentReviewerEmail === 'boss@gsa.gov', supSubmits);
  const topSup = route('sup@gsa.gov', SD, BU, null);
  ok('a supervisor with nobody above them starts at the SCD',
     topSup.status === 'PENDING_SECTOR', topSup);

  // THE THREE PRE-EXISTING SKIP RULES MUST STILL WORK. Each starts BELOW the
  // submitter's own stage, and adding a stage above them must not change
  // that — otherwise the SCD would be sent to their own supervisor for a
  // request they are about to approve.
  ok('the SCD submitting still skips to the DAC',
     route('scd@gsa.gov', SD, BU, SUP).status === 'PENDING_BU');
  ok('the DAC reviewer still skips to the FO',
     route('dac@gsa.gov', SD, BU, SUP).status === 'PENDING_OSO');
  ok('the FO still skips to FAS',
     route('fo@gsa.gov', SD, BU, SUP).status === 'PENDING_FAS');

  // THE SUPERVISOR ARGUMENT IS OPTIONAL, so a caller that does not pass it
  // reproduces the old chain exactly. That is what keeps the diagnostic
  // dry-run and the older tests honest rather than silently rerouted.
  const old = JSON.parse(vm.runInContext(
    "JSON.stringify(determineInitialRouting('emp@gsa.gov'," +
    JSON.stringify(SD) + ',' + JSON.stringify(BU) + ',[]))', ctx));
  ok('omitting the supervisor reproduces the pre-stage chain',
     old.status === 'PENDING_SECTOR', old);
}

// ---------------------------------------------------------------------------
console.log('\n3. the state machine: forward, back, and deny');
{
  const src = fs.readFileSync(SERVER + '40_domain/Review_Action.js', 'utf8');
  const start = src.indexOf('function getActionConfig');
  const end = src.indexOf('function getReviewerRole');
  ok('getActionConfig slice resolves', start > -1 && end > start);

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt, RegExp,
    Error, Boolean
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SERVER + '01_constants/Status.js', 'utf8'), ctx);
  vm.runInContext(src.slice(start, end), ctx, { filename: 'Review_Action.slice.js' });
  const cfg = (action, status) => JSON.parse(vm.runInContext(
    'JSON.stringify(getActionConfig(' + JSON.stringify(action) + ',' +
    JSON.stringify(status) + '))', ctx));

  // APPROVE FORWARDS TO THE SCD, not to the DAC. @clolry: "Supervisor does
  // not replace SCD" — so skipping to the DAC here would silently remove the
  // service-center review from every request.
  const appr = cfg('supervisor_approve', 'PENDING_SUPERVISOR');
  ok('supervisor_approve is valid at PENDING_SUPERVISOR', appr.valid !== false, appr);
  ok('and forwards to the SCD stage, not the DAC',
     appr.newStatus === 'PENDING_SECTOR', appr.newStatus);
  ok('and asks for the next reviewer to be resolved',
     appr.nextReviewer === true);

  // NEEDS-INFO RETURNS TO THE SUPERVISOR. Sending it forward would let a
  // request past the stage that had an objection, and the supervisor would
  // never learn it was resolved.
  const ni = cfg('supervisor_needs_info', 'PENDING_SUPERVISOR');
  ok('supervisor_needs_info goes to NEEDS_INFO_SUPERVISOR',
     ni.newStatus === 'NEEDS_INFO_SUPERVISOR', ni);
  ok('and requires a comment', ni.requiresComments === true,
     'an unexplained return tells the submitter nothing');
  const resub = cfg('resubmit', 'NEEDS_INFO_SUPERVISOR');
  ok('resubmitting returns to the SUPERVISOR, not forward',
     resub.newStatus === 'PENDING_SUPERVISOR', resub);

  // A SUPERVISOR WHO CAN APPROVE MUST BE ABLE TO DENY. Without it the first
  // stage has approve and needs-info only, so the person closest to the work
  // cannot say no.
  ok('deny is available at the supervisor stage',
     cfg('deny', 'PENDING_SUPERVISOR').valid !== false);

  // AND THE ACTIONS ARE STAGE-LOCKED. supervisor_approve at the SCD stage
  // would let a supervisor approve on the director's behalf.
  ok('supervisor_approve is REFUSED at other stages',
     cfg('supervisor_approve', 'PENDING_SECTOR').valid === false);
  ok('and sector_approve is refused at the supervisor stage',
     cfg('sector_approve', 'PENDING_SUPERVISOR').valid === false);

  // THE RESUBMIT MAP IS A LOOKUP, NOT A TERNARY LADDER. The ladder it
  // replaced ended in a bare `: PENDING_OSO`, so any NEEDS_INFO status it did
  // not enumerate silently became an OSO request — which is exactly how
  // NEEDS_INFO_SUPERVISOR would have landed in the wrong queue.
  ['NEEDS_INFO_SECTOR', 'NEEDS_INFO_BU', 'NEEDS_INFO_OSO'].forEach(st => {
    const r = cfg('resubmit', st);
    ok('resubmit from ' + st + ' returns to its own stage',
       r.newStatus === st.replace('NEEDS_INFO', 'PENDING'), r.newStatus);
  });

  const roleSrc = src.slice(src.indexOf('function getReviewerRole'),
                            src.indexOf('function getReviewerRole') + 600);
  ok('a supervisor action is logged with the Supervisor role',
     /action\.startsWith\('supervisor_'\)\) return 'Supervisor'/.test(roleSrc),
     'the audit trail must say which stage acted');
}

// ---------------------------------------------------------------------------
console.log('\n4. every list a new status has to appear in');
{
  // THE SECTION THAT MATTERS MOST. A status missing from one of these lists
  // does not throw — it produces a quiet wrong answer:
  //
  //   a stalled report that never shows a request stuck at the first stage
  //   an admin pipeline count that omits a whole stage
  //   a submitter with a question from their supervisor and no way to answer
  //   a reviewer with an assigned request and no visible sign of it
  //
  // Asserted by reading source rather than by running each surface, because
  // running them all needs the whole domain layer. Comments are STRIPPED
  // first: seventh occurrence of that trap in this project, and the prose
  // above these very assertions would satisfy a naive grep.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  const read = (p) => strip(fs.readFileSync(__dirname + '/' + p, 'utf8'));

  const CHECKS = [
    ['server/01_constants/Status.js', 'STATUS_CODES.PENDING_SUPERVISOR',
     'the PENDING group — isPendingStatus is derived from it'],
    ['server/01_constants/Status.js', 'STATUS_CODES.NEEDS_INFO_SUPERVISOR',
     'the NEEDS_INFO group'],
    ['server/40_domain/ReviewerDashboard.js', 'PENDING_SUPERVISOR',
     'the reviewer queue and the stalled list'],
    ['server/40_domain/Admin_Dashboard.js', 'PENDING_SUPERVISOR',
     'admin pipeline counts and the stalled report'],
    ['server/40_domain/Admin_Actions.js', 'PENDING_SUPERVISOR',
     'the statuses an admin may force a request into'],
    ['server/40_domain/Review_Read.js', 'PENDING_SUPERVISOR',
     'the action buttons a reviewer is offered'],
    ['server/40_domain/Review_Update.js', 'PENDING_SUPERVISOR',
     'the statuses at which a submitter may still edit'],
    ['server/40_domain/Reporting.js', 'PENDING_SUPERVISOR',
     'per-stage dwell time and the pipeline report'],
    ['server/40_domain/Request.js', 'PENDING_SUPERVISOR',
     '"pending your review" on the portal'],
    ['server/30_services/Access.js', 'PENDING_SUPERVISOR',
     'REQUEST_EDITABLE_STATUSES'],
    ['server/30_services/Email.js', 'PENDING_SUPERVISOR',
     'the stage description in every notification'],
    ['server/99_triggers/CacheWarming.js', 'PENDING_SUPERVISOR',
     'the status/action adoption check'],
    ['client/shared/travelUtils.html', 'PENDING_SUPERVISOR',
     'the client status groups, which mirror the server'],
    ['client/controllers/portal/travelPortalController.html', 'PENDING_SUPERVISOR',
     'the portal status badge'],
    ['client/controllers/review/travelReviewController.html', 'PENDING_SUPERVISOR',
     'the review page badge and its editable-status lists'],
    ['client/controllers/admin/travelAdminController.html', 'PENDING_SUPERVISOR',
     'the admin pipeline chart'],
    ['client/controllers/admin/travelReviewerDashboardController.html', 'PENDING_SUPERVISOR',
     'the reviewer dashboard pipeline'],
    ['client/pages/travelAdminPage.html', 'PENDING_SUPERVISOR',
     'the admin status-override dropdown']
  ];
  CHECKS.forEach(([file, needle, why]) => {
    ok(file.replace(/^.*\//, '') + ' carries ' + needle,
       read(file).indexOf(needle) > -1, why);
  });

  // THE NEEDS_INFO TWIN, which is easy to add in half the places.
  [['server/40_domain/Review_Read.js', 'a submitter can edit and resubmit'],
   ['server/40_domain/Review_Update.js', 'a submitter can still edit the request'],
   ['server/40_domain/Admin_Actions.js', 'an admin can force it back'],
   ['client/shared/travelUtils.html', 'the client NEEDS_INFO group']
  ].forEach(([file, why]) => {
    ok(file.replace(/^.*\//, '') + ' carries NEEDS_INFO_SUPERVISOR',
       read(file).indexOf('NEEDS_INFO_SUPERVISOR') > -1, why);
  });

  // THE ACTION TYPES, which the audit trail and the reporting maps key on.
  const status = read('server/01_constants/Status.js');
  ok('ACTION_TYPES has SUPERVISOR_APPROVED',
     /SUPERVISOR_APPROVED: 'Supervisor_Approved'/.test(status));
  ok('and SUPERVISOR_NEEDS_INFO',
     /SUPERVISOR_NEEDS_INFO: 'Supervisor_Needs_Info'/.test(status));

  // THE EMAIL CC LIST. The supervisor stage CCs travelers only — the request
  // has not reached the SCD, and notifying an approver about something they
  // have not been asked to look at trains them to filter the mailbox that
  // later carries their real queue.
  const email = read('server/30_services/Email.js');
  ok('the CC builder knows the Supervisor stage',
     /stage === 'SUPERVISOR'/.test(email), 'progressive CC must include it');
  ok('and the progress tracker shows a supervisor step',
     /supervisor_review/.test(email));
}

// ---------------------------------------------------------------------------
console.log('\n5. site access for the 866, and what it does NOT grant');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  const access = fs.readFileSync(SERVER + '30_services/Access.js', 'utf8');
  const gate = strip(access.slice(access.indexOf('function canAccessTrip'),
                                  access.indexOf('function isHcDerivedAccessEnabled')));

  // 866 OF 1,046 POSITIONS WERE DENIED. Paths 1-3 admit role-holders,
  // supervisors and BU leads — 180 people. Everyone else hit the DENIED line.
  ok('there is a fourth allow path for any employee on the roster',
     /'hc-employee'/.test(gate),
     'without it the people expected to file requests cannot sign in');
  ok('it requires an OCCUPIED seat',
     /isHcSeatOccupied\(emp\)/.test(gate),
     'a vacant seat has nobody to admit');
  ok('and it is reached only after the role, supervisor and BU-lead paths',
     gate.indexOf("'hc-employee'") > gate.indexOf("'hc-bu-lead'"),
     'a supervisor must be logged as a supervisor, not as an employee');

  // GATED BY THE SAME KILL SWITCH. A roster import can now widen access to
  // ~1,040 people with no LETS change, so the switch that closes the
  // HR-driven paths has to close this one too.
  ok('the employee path is below the kill switch',
     gate.indexOf('isHcDerivedAccessEnabled') < gate.indexOf("'hc-employee'"),
     'a bad import is exactly when every HR-derived grant should go off');

  // WHAT IT DOES NOT GRANT. Admission to the site is not admission to
  // anything in particular, and these three are what keep it that way.
  const ctxFn = strip(access.slice(access.indexOf('function getReviewerContext')));
  ok('an employee with no role gets role "none"',
     /role: 'none'/.test(ctxFn),
     'so the reviewer dashboard refuses them');

  const rd = strip(fs.readFileSync(SERVER + '40_domain/ReviewerDashboard.js', 'utf8'));
  ok('the reviewer dashboard refuses a non-reviewer',
     /if \(!ctx\.isReviewer\)/.test(rd));

  const privacy = fs.readFileSync(SERVER + '30_services/HCPrivacy.js', 'utf8');
  ok('HCPrivacy withholds employee ID, grade and duty address from a plain user',
     !/HC_FIELDS_PUBLIC[\s\S]{0,400}'grade'/.test(privacy) &&
     !/HC_FIELDS_PUBLIC[\s\S]{0,400}'employeeId'/.test(privacy),
     'the public field set is names, org codes and titles');

  // A SUPERVISOR GETS A REVIEWER CONTEXT, scoped to their OWN org code.
  ok('a supervisor is given a reviewer context',
     /ctx\.role = 'supervisor'/.test(ctxFn),
     'without isReviewer they could not open the page holding their queue');
  ok('scoped to their own org code, not their service center',
     /type: 'org', codes: \[ownOrg\]/.test(ctxFn),
     'a center scope would expose a dozen other orgs\' requests');
  ok('and it is the LAST role checked',
     ctxFn.indexOf("ctx.role = 'supervisor'") > ctxFn.indexOf("ctx.role = 'sector'"),
     'anyone who is also an SCD or DAC reviewer keeps the wider scope');

  // THE SCOPE TYPE MUST BE UNDERSTOOD BY BOTH MATCHERS, or a supervisor sees
  // either nothing or everything. This is the same class of defect as the
  // 4-char sector truncation: one side speaking a vocabulary the other does
  // not.
  ok('Access.js matches scope type org',
     /ctx\.scope\.type === 'org'/.test(access));
  ok('and ReviewerDashboard.js matches it too',
     /ctx\.scope\.type === 'org'/.test(
       fs.readFileSync(SERVER + '40_domain/ReviewerDashboard.js', 'utf8')),
     'one matcher knowing the type and the other not is an empty queue');
}

// ---------------------------------------------------------------------------
console.log('\n6. negative controls — each half must be able to fail');
{
  const S = SERVER;

  // CONTROL 1: stop excluding the requestor. A supervisor would approve their
  // own request, which is the one thing an approval chain cannot tolerate.
  {
    const src = fs.readFileSync(S + '01_constants/HCRules.js', 'utf8');
    const patched = src.replace(
      "    if (skip && String(p.emailAddress || '').toLowerCase() === skip) continue;",
      '');
    ok('control 1 patched the exclusion', patched !== src);
    const mod = { exports: {} };
    new Function('module', 'exports', patched)(mod, mod.exports);
    const roster = [P('1', 'boss@gsa.gov', 'Boss,Big', 'FCA0BAA', '2', '14'),
                    P('2', 'lead@gsa.gov', 'Lead,Team', 'FCA0BAA', '7', '13')];
    const self = mod.exports.findHcSupervisorForOrg(roster, 'FCA0BAA', 'boss@gsa.gov');
    ok('without it, a supervisor is their own approver',
       self && self.emailAddress === 'boss@gsa.gov', self);
  }

  // CONTROL 2: take the first match instead of the highest grade. The answer
  // becomes order-dependent, so a roster re-import could change who approves
  // a given employee's travel.
  {
    const src = fs.readFileSync(S + '01_constants/HCRules.js', 'utf8');
    const patched = src.replace(
      '    if (!best) { best = p; continue; }',
      '    if (!best) { best = p; } continue;');
    ok('control 2 patched the tie-break', patched !== src);
    const mod = { exports: {} };
    new Function('module', 'exports', patched)(mod, mod.exports);
    const roster = [P('1', 'low@gsa.gov', 'Low,Grade', 'FCB0A', '2', '13'),
                    P('2', 'high@gsa.gov', 'High,Grade', 'FCB0A', '2', '15')];
    const fwd = mod.exports.findHcSupervisorForOrg(roster, 'FCB0A', 'x@gsa.gov');
    const rev = mod.exports.findHcSupervisorForOrg(roster.slice().reverse(),
                                                   'FCB0A', 'x@gsa.gov');
    ok('first-match-wins gives two different answers for one org',
       fwd.emailAddress !== rev.emailAddress,
       'a re-import could silently change an employee\'s approver');
  }

  // CONTROL 3: send a supervisor approval straight to the DAC. @clolry:
  // "Supervisor does not replace SCD" — this is that mistake, and it would
  // remove the service-center review from every request without a trace.
  {
    const src = fs.readFileSync(S + '40_domain/Review_Action.js', 'utf8');
    const patched = src.replace(
      '      actionName: ACTION_TYPES.SUPERVISOR_APPROVED,\n' +
      '      newStatus: STATUS_CODES.PENDING_SECTOR,',
      '      actionName: ACTION_TYPES.SUPERVISOR_APPROVED,\n' +
      '      newStatus: STATUS_CODES.PENDING_BU,');
    ok('control 3 patched the forward target', patched !== src);
    const sandbox = {
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt, RegExp,
      Error, Boolean
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(S + '01_constants/Status.js', 'utf8'), ctx);
    vm.runInContext(patched.slice(patched.indexOf('function getActionConfig'),
                                  patched.indexOf('function getReviewerRole')), ctx);
    const got = JSON.parse(vm.runInContext(
      "JSON.stringify(getActionConfig('supervisor_approve','PENDING_SUPERVISOR'))", ctx));
    ok('a patched build skips the SCD stage entirely',
       got.newStatus === 'PENDING_BU',
       'which is the "supervisor replaces SCD" mistake, silently');
  }

  // CONTROL 4: remove the employee access path. The 866 are locked out again.
  {
    const src = fs.readFileSync(S + '30_services/Access.js', 'utf8');
    const patched = src.replace("'hc-employee'", "'hc-employee-DISABLED'");
    ok('control 4 patched the access path', patched !== src);
    ok('and the marker this section greps for is gone',
       patched.indexOf("'hc-employee'") === -1,
       'so §5 is a real assertion rather than a tautology');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
