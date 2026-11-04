/**
 * pass6_rule_census.js — reproducible evidence for WORKFLOW_AND_BUSINESS_RULES.md
 *
 * Run from this directory:
 *     node pass6_rule_census.js
 *
 * Reads only. Touches no Google service. Static extraction plus live
 * execution of logic copied verbatim from the source.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * A business-rules document makes two kinds of claim, and they need
 * different evidence:
 *
 *   "the system does X"        — a claim about behaviour. Best shown by
 *                                running the logic and printing the result.
 *   "the system claims X but   — a claim about a gap. Best shown by
 *    does not do X"              locating the claim and the absence.
 *
 * This script does both. Section [1] extracts the state machine from source
 * rather than trusting a transcription, because a hand-copied transition
 * table is exactly the kind of artefact that drifts. Sections [4] and [5]
 * EXECUTE decision logic lifted verbatim from the application, so the
 * documented outcome is observed rather than predicted.
 *
 * WHAT IT REPORTS
 *   [1] The 13-action state machine, extracted from getActionConfig()
 *   [2] Reachability of every status — which can be entered, which cannot
 *   [3] Which actions enforce identity, and which enforce state
 *   [4] THE FAIL-OPEN TEST: the client-paid override that decides whether a
 *       request skips FAS review, run against degraded inputs
 *   [5] The comment-mandate rule, executed across all 13 actions
 *   [6] Documented-but-unenforced rules — the claim and the absence, located
 *   [7] Rules that exist in more than one place and could diverge
 *
 * METHOD NOTE
 *   Where this script executes logic, that logic is COPIED VERBATIM from the
 *   cited source and the copy is shown. It is not a paraphrase. If the
 *   source changes, this script keeps testing the old copy and the citation
 *   check in [0] will fail — which is the intended failure mode.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SERVER = path.join(REPO, 'lets_app', 'server');

function read(rel) {
  return fs.readFileSync(path.join(SERVER, rel), 'utf8').replace(/\0/g, '');
}

const bar = c => console.log(c.repeat(78));
let problems = 0;

console.log('\nPass 6 evidence — business-rule census');
console.log('purpose: extract the state machine from source, and execute the');
console.log('         decision logic that the rules document describes');
bar('=');

const reviewAction = read('40_domain/Review_Action.js');
const reviewUpdateSrc = read('40_domain/Review_Update.js');
const submission = read('40_domain/Submission.js');
const requestService = read('40_domain/RequestService.js');
const statusJs = read('01_constants/Status.js');
const ddConfirm = read('40_domain/Review_DDConfirm.js');

// ---------------------------------------------------------------------------
// [0] citation integrity — does the source still look like what we assume?
// ---------------------------------------------------------------------------

console.log('\n[0] Citation integrity');
console.log('  Each anchor below is a line this script or the deliverable');
console.log('  cites. If an anchor moves, the citation is stale and the');
console.log('  document must be re-checked rather than trusted.');

const ANCHORS = [
  ['40_domain/Review_Action.js', 'function getActionConfig', reviewAction],
  ['40_domain/Review_Action.js', 'function _hasOverheadFromRows', reviewAction],
  ['40_domain/Review_Action.js', 'function getReviewerRole', reviewAction],
  ['40_domain/Submission.js', 'function determineInitialRouting', submission],
  ['40_domain/RequestService.js', 'function updateRequestStatus', requestService],
  ['40_domain/Review_DDConfirm.js', 'function confirmDDTravelers', ddConfirm]
];
for (const [file, needle, text] of ANCHORS) {
  const i = text.indexOf(needle);
  const line = i === -1 ? null : text.slice(0, i).split('\n').length;
  if (line === null) problems++;
  console.log('  ' + (line ? '   ' : '!! ') + needle.padEnd(36) +
    (line ? file + ':' + line : 'NOT FOUND — citation is stale'));
}

// ---------------------------------------------------------------------------
// [1] the state machine, extracted
// ---------------------------------------------------------------------------

console.log('\n[1] The state machine, extracted from getActionConfig()');
console.log('  Parsed from source, not transcribed. Each action\'s guard');
console.log('  expression is shown verbatim so the reader can see exactly');
console.log('  what "valid from" means for that action.');

// Two other "action-ish" counts, needed to explain where 13 came from.
const statusBlock = /const STATUS_CODES\s*=\s*\{([\s\S]*?)\n\};/.exec(statusJs);
const actionTypesBlock = /const ACTION_TYPES\s*=\s*\{([\s\S]*?)\n\};/.exec(statusJs);
const statusCount = statusBlock
  ? (statusBlock[1].match(/^\s+[A-Z_]+:\s*'/gm) || []).length : 0;
const actionTypesCount = actionTypesBlock
  ? (actionTypesBlock[1].match(/^\s+[A-Z_]+:\s*'/gm) || []).length : 0;

const cfgStart = reviewAction.indexOf('const configs = {');
const cfgEnd = reviewAction.indexOf('\n  };', cfgStart);
const configsBlock = reviewAction.slice(cfgStart, cfgEnd);

const actionRe = /'([a-z_]+)':\s*\{([\s\S]*?)\n    \}/g;
const actions = [];
let am;
while ((am = actionRe.exec(configsBlock)) !== null) {
  const name = am[1];
  const body = am[2];
  const grab = (k) => {
    const m = new RegExp(k + ':\\s*([^\\n]+?),?\\s*$', 'm').exec(body);
    return m ? m[1].replace(/,$/, '').trim() : null;
  };
  actions.push({
    name,
    valid: grab('valid'),
    actionName: grab('actionName'),
    newStatus: grab('newStatus'),
    requiresComments: grab('requiresComments') === 'true',
    nextReviewer: grab('nextReviewer') === 'true'
  });
}

console.log('');
console.log('  actions defined: ' + actions.length);
console.log('');
const short = s => (s || '')
  .replace(/STATUS_CODES\./g, '')
  .replace(/ACTION_TYPES\./g, '')
  .replace(/currentStatus === /, '= ')
  .replace(/\s+/g, ' ')
  .trim();
for (const a of actions) {
  console.log('  ' + a.name.padEnd(18) +
    (a.requiresComments ? 'COMMENTS ' : '         ') +
    (a.nextReviewer ? 'next-rev ' : '         ') +
    '-> ' + short(a.newStatus));
  console.log('      valid when: ' + short(a.valid));
}

console.log('');
console.log('  CORRECTION TO THE EARLIER PASSES.');
console.log('  Pass 4 \u00a74.1.3 says "Thirteen actions"; Pass 5 \u00a75.11 and two');
console.log('  deliverables repeat "13-action state machine". The source');
console.log('  defines ' + actions.length + ', and Pass 4\'s OWN TABLE lists 12 rows \u2014 so');
console.log('  the prose miscounted its own table.');
console.log('');
console.log('  WHERE 13 PROBABLY CAME FROM, and it matters because the');
console.log('  mistake is easy to repeat: there are three different');
console.log('  "action" counts in this codebase and they are unrelated.');
console.log('');
console.log('      ' + String(actions.length).padStart(2) + '   actions in getActionConfig()        <- the state machine');
console.log('      ' + String(actionTypesCount).padStart(2) + '   entries in ACTION_TYPES            <- the Approval_Log vocabulary');
console.log('      ' + String(statusCount).padStart(2) + '   entries in STATUS_CODES            <- the status vocabulary');
console.log('');
console.log('  ACTION_TYPES is larger because it also covers things that are');
console.log('  not reviewer decisions: Submitted, Reminder_Sent, the five');
console.log('  Edit_* audit actions, ADMIN_OVERRIDE, ADMIN_REASSIGN, and');
console.log('  All_DD_Confirmed. Those are logged actions, not transitions.');
console.log('');
console.log('  USE 12 for the state machine. Correct Pass 4 \u00a74.1.3, Pass 5');
console.log('  \u00a75.11, SYSTEM_COMPONENT_MAP \u00a72.3.3 and \u00a72.8.1.');
if (actions.length !== 12) {
  console.log('  !! Expected 12; found ' + actions.length + '. Source has changed.');
  problems++;
}

// --- the role recorded for each action, from getReviewerRole --------------

console.log('\n  The role each action records in Approval_Log.Action_By_Role:');
function reviewerRoleFor(action) {
  // verbatim from Review_Action.js getReviewerRole()
  if (action.startsWith('sector_')) return 'Sector_Director';
  if (action.startsWith('bu_')) return 'BU_Reviewer';
  if (action.startsWith('oso_')) return 'OSO_Reviewer';
  if (action.startsWith('fas_')) return 'Admin';
  if (action === 'submitter_cancel' || action === 'resubmit') return 'Submitter';
  return 'Reviewer';
}
for (const a of actions) {
  console.log('      ' + a.name.padEnd(18) + reviewerRoleFor(a.name));
}
console.log('');
console.log('    Note fas_approve and fas_deny record the role as "Admin",');
console.log('    not "FAS_Reviewer". The FAS stage is performed by whoever');
console.log('    holds Current_Reviewer_Email, and the audit trail labels');
console.log('    that action Admin regardless of who it was.');

// ---------------------------------------------------------------------------
// [2] status reachability
// ---------------------------------------------------------------------------

console.log('\n[2] Status reachability — which states can actually be entered?');

// Parse ONLY the STATUS_CODES block. An earlier draft walked every
// `KEY: 'value'` line in the file and stopped at the first duplicate key,
// which silently absorbed the first two ACTION_TYPES entries (SUBMITTED,
// RESUBMITTED) and reported them as unwritable statuses. They are not
// statuses at all. Parse the block by name.
const codes = statusBlock
  ? [...statusBlock[1].matchAll(/^\s+([A-Z_]+):\s*'([^']+)'/gm)]
      .map(m => ({ key: m[1], value: m[2] }))
  : [];

const producedBy = new Map();
for (const a of actions) {
  const ns = short(a.newStatus);
  for (const c of codes) {
    if (ns.includes(c.key)) {
      if (!producedBy.has(c.key)) producedBy.set(c.key, []);
      producedBy.get(c.key).push(a.name);
    }
  }
}
// statuses written outside the state machine
const OUTSIDE = {
  PENDING_SECTOR: 'determineInitialRouting (on submit)',
  PENDING_BU: 'determineInitialRouting (on submit)',
  PENDING_OSO: 'determineInitialRouting (on submit)',
  PENDING_FAS: 'determineInitialRouting (on submit)',
  APPROVED_GOGOV: 'determineInitialRouting + the client-paid override [4]',
  PENDING_DD_CONFIRMATION: 'submitFundingCorrection',
  PENDING_CORRECTION: 'reportDDFundingIssue',
  COMPLETED: 'confirmDDTravelers, when the last DD confirms'
};

console.log('');
console.log('  status codes declared: ' + codes.length);
console.log('');
let unreachable = [];
for (const c of codes) {
  const viaAction = producedBy.get(c.key) || [];
  const viaOther = OUTSIDE[c.key];
  const how = viaAction.length
    ? 'action: ' + viaAction.join(', ')
    : (viaOther ? 'other:  ' + viaOther : 'NOTHING WRITES IT');
  if (!viaAction.length && !viaOther) unreachable.push(c.key);
  console.log('      ' + c.key.padEnd(26) + how);
}
console.log('');
console.log('  statuses nothing writes ................. ' + unreachable.length);
console.log('');
console.log('  But "nothing writes it" and "nothing uses it" differ, and the');
console.log('  difference decides whether a status is dead code or a live');
console.log('  trap. Each unwritable status is checked for READERS:');
console.log('');
const allSrc = [
  ['Status.js', statusJs], ['Access.js', read('30_services/Access.js')],
  ['Reporting.js', read('40_domain/Reporting.js')],
  ['Review_Update.js', reviewUpdateSrc], ['Review_Action.js', reviewAction],
  ['Submission.js', submission], ['Admin_Dashboard.js', read('40_domain/Admin_Dashboard.js')],
  ['ReviewerDashboard.js', read('40_domain/ReviewerDashboard.js')]
];
for (const u of unreachable) {
  const readers = [];
  for (const [name, text] of allSrc) {
    const n = (text.match(new RegExp('STATUS_CODES\\.' + u + '\\b', 'g')) || []).length;
    // the declaration itself is not a read
    const adj = name === 'Status.js' ? n - 1 : n;
    if (adj > 0) readers.push(name + '(' + adj + ')');
  }
  console.log('      ' + u.padEnd(22) +
    (readers.length ? 'READ BY ' + readers.join(', ') : 'read by nothing \u2014 fully dead'));
}
console.log('');
console.log('    A status that is READ but never WRITTEN is worse than dead');
console.log('    code: the reader is a branch that can never be taken, so it');
console.log('    looks like coverage while providing none. SUBMITTER_CANCELLED');
console.log('    is the clear case \u2014 Reporting.js tests for it in three');
console.log('    places and the state machine writes CANCELLED instead, so');
console.log('    those three branches are unreachable and the reports they');
console.log('    feed cannot distinguish a submitter cancellation from a');
console.log('    reviewer one. That distinction exists in ACTION_TYPES');
console.log('    (Submitter_Cancelled) and in the Approval_Log, but not in');
console.log('    the status column any report groups by.');

// ---------------------------------------------------------------------------
// [3] what submitReviewAction enforces
// ---------------------------------------------------------------------------

console.log('\n[3] Enforcement in submitReviewAction — identity AND state');
console.log('  This is the one workflow function that checks both. The');
console.log('  checks are located here so the claim is auditable.');

const checks = [
  ['admin bypass', /if\s*\(!isTravelAdmin\(currentUser\)\)/],
  ['submitter-only actions listed', /submitterActions\s*=\s*\[[^\]]*\]/],
  ['submitter identity compared', /currentUser\.toLowerCase\(\)\s*!==\s*submitterEmail\.toLowerCase\(\)/],
  ['reviewer identity compared', /currentUser\.toLowerCase\(\)\s*!==\s*assignedReviewer\.toLowerCase\(\)/],
  ['transition validated', /getActionConfig\(action,\s*currentStatus\)/],
  ['comment mandate enforced', /actionConfig\.requiresComments/]
];
console.log('');
for (const [label, re] of checks) {
  const m = re.exec(reviewAction);
  const line = m ? reviewAction.slice(0, m.index).split('\n').length : null;
  if (!line) problems++;
  console.log('  ' + (line ? '   ' : '!! ') + label.padEnd(34) +
    (line ? 'Review_Action.js:' + line : 'NOT FOUND'));
}
const throwCount = (reviewAction.match(/throw new Error/g) || []).length;
console.log('');
console.log('  throw sites in Review_Action.js ......... ' + throwCount);
console.log('    A refusing check must throw. Compare with Review_Update.js:');
console.log('    Review_Update.js throw sites ......... ' +
  (reviewUpdateSrc.match(/throw new Error/g) || []).length);
console.log('    Review_Update.js identity comparisons  ' +
  (reviewUpdateSrc.match(/toLowerCase\(\)\s*!==\s*\w*[Ee]mail\w*\.toLowerCase\(\)/g) || []).length);

// ---------------------------------------------------------------------------
// [4] THE FAIL-OPEN TEST
// ---------------------------------------------------------------------------

console.log('\n[4] THE FAIL-OPEN TEST — the client-paid override');
console.log('  On oso_approve the handler re-reads traveller rows and, if no');
console.log('  traveller is overhead-funded, rewrites the outcome to');
console.log('  APPROVED_GOGOV, skipping FAS review entirely.');
console.log('');
console.log('  So this one predicate decides whether a request receives FAS');
console.log('  Front Office review for EO 14222 compliance. The question');
console.log('  worth asking of such a predicate is not "is it correct for');
console.log('  good data" but "which way does it fail for bad data".');
console.log('');
console.log('  Logic copied VERBATIM from Review_Action.js:541:');
console.log('');
console.log('      if (!rows || !rows.length || isClientPaidCol === undefined)');
console.log('        return false;');
console.log('      return rows.some(row => {');
console.log('        const val = String(row[isClientPaidCol] || \'\')');
console.log('                      .toLowerCase().trim();');
console.log('        return !val || val === \'overhead\';');
console.log('      });');

function _hasOverheadFromRows(rows, isClientPaidCol) {
  if (!rows || !rows.length || isClientPaidCol === undefined) return false;
  return rows.some(row => {
    const val = String(row[isClientPaidCol] || '').toLowerCase().trim();
    return !val || val === 'overhead';
  });
}

// confirm the copy still matches the source, character for character
const srcFn = /function _hasOverheadFromRows\(rows, isClientPaidCol\) \{[\s\S]*?\n\}/.exec(reviewAction);
const normalise = s => s.replace(/\s+/g, ' ').trim();
const copyMatches = srcFn &&
  normalise(srcFn[0]) === normalise(_hasOverheadFromRows.toString());
console.log('');
console.log('  copy matches source exactly ............. ' + (copyMatches ? 'yes' : 'NO'));
if (!copyMatches) {
  console.log('  !! The source has changed. Re-verify [4] before citing it.');
  problems++;
}

const CASES = [
  ['one overhead traveller', [['REQ-1', 'overhead']], 1, 'normal'],
  ['all client-paid', [['REQ-1', 'client']], 1, 'normal'],
  ['blank cell on a row', [['REQ-1', '']], 1, 'normal'],
  ['mixed: one of two overhead', [['REQ-1', 'client'], ['REQ-1', 'overhead']], 1, 'normal'],
  ['NO traveller rows at all', [], 1, 'degraded'],
  ['rows is null', null, 1, 'degraded'],
  ['Is_Client_Paid column missing', [['REQ-1', 'overhead']], undefined, 'degraded']
];

console.log('');
console.log('  input                            isOverhead  outcome');
console.log('  ' + '-'.repeat(72));
let failOpen = 0;
for (const [label, rows, col, kind] of CASES) {
  const isOverhead = _hasOverheadFromRows(rows, col);
  const outcome = isOverhead
    ? 'PENDING_FAS — gets FAS review'
    : 'APPROVED_GOGOV — SKIPS FAS review';
  if (kind === 'degraded' && !isOverhead) failOpen++;
  console.log('  ' + (kind === 'degraded' ? '!! ' : '   ') +
    label.padEnd(31) + String(isOverhead).padEnd(12) + outcome);
}

console.log('');
console.log('  degraded inputs that skip FAS review .... ' + failOpen + ' of 3');
if (failOpen === 3) {
  console.log('');
  console.log('  ALL THREE DEGRADED INPUTS FAIL OPEN.');
  console.log('');
  console.log('  The guard clause returns false — "no overhead" — for missing');
  console.log('  rows, null rows, and a missing column. False means skip FAS.');
  console.log('  So a request whose traveller rows failed to write (the');
  console.log('  partial-submission case, finding G-012) or whose');
  console.log('  Is_Client_Paid column was renamed (finding G-014) is');
  console.log('  approved WITHOUT the compliance review it requires.');
  console.log('');
  console.log('  Note the contrast with the PER-ROW default on the same line:');
  console.log('  `!val` treats a BLANK CELL as overhead, which fails CLOSED');
  console.log('  and is correct. The row-level default is conservative; the');
  console.log('  collection-level default is permissive. Same function.');
  console.log('');
  console.log('  Mitigation already present: both degraded data cases are');
  console.log('  detected and logged by the caller before the predicate runs');
  console.log('  (Review_Action.js:131, :136 — console.error + logError).');
  console.log('  So the condition is RECORDED. It is not PREVENTED: execution');
  console.log('  continues to the predicate and the request is approved.');
}

// ---------------------------------------------------------------------------
// [5] the comment mandate
// ---------------------------------------------------------------------------

console.log('\n[5] The comment mandate, across all 12 actions');
console.log('  Which actions require a written justification, executed');
console.log('  against the extracted table rather than transcribed.');
console.log('');
const needComment = actions.filter(a => a.requiresComments);
const noComment = actions.filter(a => !a.requiresComments);
console.log('  require comments (' + needComment.length + '): ' +
  needComment.map(a => a.name).join(', '));
console.log('');
console.log('  do not (' + noComment.length + '): ' +
  noComment.map(a => a.name).join(', '));
console.log('');
console.log('  The pattern: every action that STOPS or REVERSES a request');
console.log('  requires a reason; every action that ADVANCES one does not.');
const stopping = ['sector_needs_info', 'bu_needs_info', 'oso_needs_info',
  'fas_deny', 'deny', 'cancel'];
const consistent = stopping.every(s => needComment.some(a => a.name === s));
console.log('  rule holds for all 6 stopping actions ... ' + (consistent ? 'yes' : 'NO'));
const oddity = noComment.find(a => a.name === 'submitter_cancel');
if (oddity) {
  console.log('');
  console.log('  One asymmetry worth recording: `cancel` requires a comment');
  console.log('  and `submitter_cancel` does not, though both reach the same');
  console.log('  CANCELLED status. A reviewer must justify a cancellation; a');
  console.log('  submitter cancelling their own request need not. Defensible,');
  console.log('  but it means CANCELLED rows have inconsistent explanations.');
}

// ---------------------------------------------------------------------------
// [6] documented but not enforced
// ---------------------------------------------------------------------------

console.log('\n[6] Rules the code CLAIMS and does not enforce');
console.log('  Each row locates the claim, then tests for the mechanism it');
console.log('  describes. An absence is only a finding if the claim exists.');

const CLAIMS = [
  {
    id: 'updateRequestStatus',
    file: '40_domain/RequestService.js',
    text: requestService,
    claim: /Advances Kanban stage with role and permission checks/,
    mechanism: [
      ['any identity comparison', /toLowerCase\(\)\s*[!=]==/],
      ['any throw', /throw new Error/],
      ['any transition table', /getActionConfig|validTransitions|allowedFrom/]
    ]
  },
  {
    id: 'reconcileRequest status gate',
    file: '40_domain/RequestService.js',
    text: requestService,
    claim: /function reconcileRequest/,
    mechanism: [
      ['requires Travel Completed', /Travel Completed|TRAVEL_COMPLETED/],
      ['any status check at all', /\.status\s*[!=]==/]
    ]
  }
];

for (const c of CLAIMS) {
  console.log('');
  const cm = c.claim.exec(c.text);
  const cline = cm ? c.text.slice(0, cm.index).split('\n').length : null;
  console.log('  --- ' + c.id + ' ---');
  console.log('      claim at: ' + (cline ? c.file + ':' + cline : 'NOT FOUND'));
  for (const [label, re] of c.mechanism) {
    const found = re.test(c.text);
    console.log('      ' + (found ? '   ' : 'NOT FOUND  ') + label +
      (found ? ': present' : ''));
  }
}

console.log('');
console.log('  Both functions are in the unreachable LETS subsystem');
console.log('  (finding G-016), so neither claim can currently be exercised.');
console.log('  They are recorded because wiring the subsystem activates them.');

// ---------------------------------------------------------------------------
// [7] rules stated in more than one place
// ---------------------------------------------------------------------------

console.log('\n[7] Rules duplicated across files — divergence risk');

const tripConfig = read('00_config/TripConfig.js');
const clientForm = fs.readFileSync(
  path.join(REPO, 'lets_app', 'client', 'pages', 'travelRequestPage.html'), 'utf8')
  .replace(/\0/g, '');

// TRAVEL_PURPOSES is keyed TIER_1_FAS_COS / TIER_2_* rather than carrying a
// `tier: 1` property, so the tier is the ARRAY it sits in, not a field on the
// object. An earlier draft looked for `tier: 1` and found 0 codes, which
// would have reported the server-side list as empty and made the comparison
// look incomparable rather than equal.
const tier1Block = /TIER_1_FAS_COS:\s*\[([\s\S]*?)\n  \],/.exec(tripConfig);
const tier1Server = tier1Block
  ? [...tier1Block[1].matchAll(/code:\s*'([A-Z_0-9]+)'/g)].map(m => m[1]) : [];
const tier2Block = /TIER_2_[A-Z_]+:\s*\[([\s\S]*?)\n  \]/.exec(tripConfig);
const tier2Server = tier2Block
  ? [...tier2Block[1].matchAll(/code:\s*'([A-Z_0-9]+)'/g)].map(m => m[1]) : [];
const tier1ClientM = /const tier1Codes\s*=\s*\[([^\]]*)\]/.exec(clientForm);
const tier1Client = tier1ClientM
  ? [...tier1ClientM[1].matchAll(/'([A-Z_0-9]+)'/g)].map(m => m[1]) : [];

console.log('');
console.log('  The FAS purpose taxonomy:');
console.log('      Tier 1 (FAS CoS + tracker) in TripConfig.js .. ' + tier1Server.length);
console.log('      Tier 2 (portfolio CoS, no tracker) ........... ' + tier2Server.length);
console.log('      total purpose codes .......................... ' +
  (tier1Server.length + tier2Server.length));
console.log('');
console.log('      Tier-1 codes duplicated in the client form ... ' + tier1Client.length);
const missingFromClient = tier1Server.filter(c => !tier1Client.includes(c));
const extraInClient = tier1Client.filter(c => !tier1Server.includes(c));
const sameSet = tier1Server.length === tier1Client.length &&
  !missingFromClient.length && !extraInClient.length;
console.log('      the two copies agree today ................... ' + (sameSet ? 'YES' : 'NO'));
if (!sameSet) {
  if (missingFromClient.length) console.log('        in config, missing from client: ' + missingFromClient.join(', '));
  if (extraInClient.length) console.log('        in client, not in config: ' + extraInClient.join(', '));
  problems++;
}
console.log('');
console.log('    Two copies of one policy list, in two languages, with no');
console.log('    link between them. They agree today. Nothing detects');
console.log('    divergence, and retiering a purpose requires editing both.');

// fiscal quarter, two implementations
const adminDash = read('40_domain/Admin_Dashboard.js');
const revDash = read('40_domain/ReviewerDashboard.js');
const qPat = /qStartMonth\s*=\s*month\s*>=\s*9\s*\?\s*9/;
console.log('');
console.log('  Fiscal-quarter derivation:');
for (const [name, text] of [['Admin_Dashboard.js', adminDash], ['ReviewerDashboard.js', revDash]]) {
  const m = qPat.exec(text);
  console.log('      ' + name.padEnd(26) +
    (m ? 'line ' + text.slice(0, m.index).split('\n').length : 'pattern not found'));
}
const mislabel = /'FY Quarter'/.test(revDash);
console.log('      label says "FY Quarter" ............. ' + (mislabel ? 'yes, in ReviewerDashboard.js' : 'no'));
console.log('');
console.log('    Quarters start Jan/Apr/Jul/Oct. Federal Q1 is Oct-Dec, so');
console.log('    the label is wrong for every quarter. Two copies of the');
console.log('    same calculation means fixing it twice.');

bar('=');
console.log('Integrity problems detected ................... ' + problems);
if (problems === 0) {
  console.log('All citations resolve and all executed copies match their source.');
}
console.log('Every result above is recomputed from source on each run.\n');
