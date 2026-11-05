/**
 * pass6_hc_gate_predicate.js — executes the HC site-gate predicate
 *
 * Run from this directory:
 *     node pass6_hc_gate_predicate.js
 *
 * Reads only. Touches no Google service, no network. No HC library is
 * contacted — the predicate is copied from source and run against
 * synthetic inputs.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * It was written to check a published claim, and the claim turned out to be
 * wrong. Four documents asserted:
 *
 *     "The site gate compares supervisoryStatus === '2' as a STRING; if HC
 *      emits a number, two of three allow-paths are already dead."
 *
 * That is false. The source does not compare with `===` against a raw field;
 * it compares `String(p.supervisoryStatus) !== '2'`. The explicit String()
 * coercion means a numeric 2 PASSES. Executed below: `String(2) === '2'` is
 * true, so a number-emitting library would work fine.
 *
 * The underlying worry was sound — a type mismatch here silently removes
 * two of three ways into the system — but the specific mechanism named was
 * not the one in the code. The values that DO fail are zero-padded ('02'),
 * whitespace-bearing (' 2'), decimal-formatted ('2.0'), and empty. Those
 * are realistic spreadsheet- and export-shaped values, so VT-03 is still
 * worth its twenty minutes. It just has to ask for the right thing.
 *
 * This is the same failure mode as the four figures Pass 6 withdrew, and as
 * the effort total in GAP_CONSOLIDATION_PASS6.md §6.7.2: a plausible claim
 * that nobody executed. The standing rule in _RESUME_HERE.md §8.2 says to
 * suspect the measurement first — here the measurement was right and the
 * prose was wrong, which is the other direction, and the only way to tell
 * them apart is to run it.
 *
 * WHAT IT REPORTS
 *   [0] Citation integrity — the cited lines still say what is claimed
 *   [1] THE COERCION TEST: supervisoryStatus across input classes
 *   [2] THE OCCUPANCY TEST: occupancyStatus across input classes, which
 *       found a blank-value fail-open that was in no finding
 *   [3] All three allow-paths, and how many survive each input class
 *   [4] Divergence from the prose in every document that makes the claim
 *
 * METHOD NOTE
 *   The predicate below is COPIED VERBATIM from the cited source and the
 *   copy is shown. [0] verifies the copy against the source on every run,
 *   so if the source changes this script fails loudly rather than testing
 *   a stale copy.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const DOCS = path.join(__dirname, '..');
const SERVER = path.join(REPO, 'lets_app', 'server');

function readServer(rel) {
  return fs.readFileSync(path.join(SERVER, rel), 'utf8').replace(/\0/g, '');
}
function readDoc(name) {
  try { return fs.readFileSync(path.join(DOCS, name), 'utf8').replace(/\0/g, ''); }
  catch (e) { return null; }
}

const bar = c => console.log(c.repeat(78));
let problems = 0;

console.log('\nPass 6 evidence — the HC site-gate predicate, executed');
console.log('purpose: test what the gate actually accepts, and check it');
console.log('         against what four documents claim it accepts');
bar('=');

const accessSrc = readServer('30_services/Access.js');
const accessLines = accessSrc.split('\n');

// ---------------------------------------------------------------------------
// [0] citation integrity
// ---------------------------------------------------------------------------

console.log('\n[0] Citation integrity');
console.log('  Every line this script and the deliverables cite. If an');
console.log('  anchor moves, the citation is stale and must be re-checked');
console.log('  rather than trusted.');
console.log('');

// line number (1-based) -> the text that must be there
const ANCHORS = [
  [394, 'function canAccessTrip(email) {', 'the site gate itself'],
  [416, "if (String(p.supervisoryStatus) !== '2') continue;", 'supervisory test, path 2'],
  [417, "var status = String(p.occupancyStatus || '').toUpperCase();", 'occupancy read, path 2'],
  [418, "if (status === 'VACANT' || status === 'OBLIGATED') continue;", 'occupancy test, path 2'],
  [864, 'function _isBuLeadByTitle(email) {', 'path 3, BU lead by title'],
  [885, "if (status === 'VACANT' || status === 'OBLIGATED') continue;", 'occupancy test, path 3']
];
for (const [ln, txt, label] of ANCHORS) {
  const actual = (accessLines[ln - 1] || '').trim();
  const ok = actual === txt;
  if (!ok) problems++;
  console.log('  ' + (ok ? '   ' : '!! ') + ('Access.js:' + ln).padEnd(18) +
    label.padEnd(30) + (ok ? 'resolves' : 'STALE — found: ' + JSON.stringify(actual)));
}

// Count every site using the same supervisory comparison, so the blast
// radius of the type question is a measured number rather than "the gate".
const supSites = [];
accessLines.forEach((l, i) => {
  if (/String\(p\.supervisoryStatus\)\s*!==\s*'2'/.test(l)) supSites.push(i + 1);
});
const supSitesAllFiles = [];
for (const rel of ['30_services/Access.js', '40_domain/Admin_Dashboard.js', '40_domain/Users.js']) {
  readServer(rel).split('\n').forEach((l, i) => {
    if (/String\(p\.supervisoryStatus\)\s*!==\s*'2'/.test(l)) {
      supSitesAllFiles.push(rel + ':' + (i + 1));
    }
  });
}
console.log('');
console.log('  sites using String(p.supervisoryStatus) !== \'2\'');
console.log('      in Access.js ........................ ' + supSites.length +
  '   (lines ' + supSites.join(', ') + ')');
console.log('      across the server tree .............. ' + supSitesAllFiles.length);
for (const s of supSitesAllFiles) console.log('          ' + s);
console.log('');
console.log('  Every one of them coerces with String() before comparing.');
console.log('  There is no bare === against the raw field anywhere, which');
console.log('  is the fact the published claim got wrong.');

// ---------------------------------------------------------------------------
// the predicate, copied verbatim
// ---------------------------------------------------------------------------

console.log('\n  Logic copied VERBATIM from Access.js:414-419:');
console.log('');
for (let ln = 414; ln <= 419; ln++) {
  console.log('      ' + ln + ': ' + (accessLines[ln - 1] || '').trim());
}

/**
 * The HC-supervisor allow-path, lifted verbatim from canAccessTrip's loop
 * body. Returns the reason rather than `true`/`continue` so each test can
 * report WHICH check rejected the input.
 */
function hcSupervisorPath(p, emailLower) {
  if (!p || !p.emailAddress) return 'skip: no emailAddress';
  if (String(p.emailAddress).toLowerCase() !== emailLower) return 'skip: email mismatch';
  if (String(p.supervisoryStatus) !== '2') return 'DENY: supervisoryStatus';
  var status = String(p.occupancyStatus || '').toUpperCase();
  if (status === 'VACANT' || status === 'OBLIGATED') return 'DENY: occupancy';
  return 'ALLOW';
}

// Verify the copy against the source, check by check, ignoring the
// return-value substitution described above.
const srcBody = accessLines.slice(413, 419).map(s => s.trim()).join(' ');
const COPY_CHECKS = [
  ['!p || !p.emailAddress', 'no-emailAddress guard'],
  ['String(p.emailAddress).toLowerCase() !== emailLower', 'email match'],
  ["String(p.supervisoryStatus) !== '2'", 'supervisory test'],
  ["String(p.occupancyStatus || '').toUpperCase()", 'occupancy read'],
  ["status === 'VACANT' || status === 'OBLIGATED'", 'occupancy test']
];
console.log('');
let copyOk = true;
for (const [frag, label] of COPY_CHECKS) {
  const inSrc = srcBody.includes(frag);
  const inCopy = hcSupervisorPath.toString().includes(frag);
  const ok = inSrc && inCopy;
  if (!ok) { copyOk = false; problems++; }
  console.log('  ' + (ok ? '   ' : '!! ') + 'copy matches source — ' + label.padEnd(24) +
    (ok ? 'yes' : 'NO  (src=' + inSrc + ' copy=' + inCopy + ')'));
}
if (!copyOk) {
  console.log('  !! The source has changed. Re-verify before citing this script.');
}

// ---------------------------------------------------------------------------
// [1] the coercion test
// ---------------------------------------------------------------------------

console.log('\n[1] THE COERCION TEST — supervisoryStatus');
console.log('  occupancyStatus held at \'FILLED\' so only the supervisory');
console.log('  check can reject. The question: which emitted shapes pass?');
console.log('');

const EMAIL = 'someone@gsa.gov';
const SUP_CASES = [
  ["'2'   string two", '2', 'expected-pass'],
  ['2     NUMBER two', 2, 'expected-pass'],
  ['2.0   number, trailing zero', 2.0, 'expected-pass'],
  ["'02'  zero-padded", '02', 'realistic-fail'],
  ["' 2'  leading space", ' 2', 'realistic-fail'],
  ["'2 '  trailing space", '2 ', 'realistic-fail'],
  ["'2.0' decimal as text", '2.0', 'realistic-fail'],
  ["'two' spelled out", 'two', 'realistic-fail'],
  ["''    empty string", '', 'correct-fail'],
  ['0     number zero', 0, 'correct-fail'],
  ['null', null, 'correct-fail'],
  ['undefined  field absent', undefined, 'correct-fail'],
  ['true  boolean', true, 'correct-fail']
];

console.log('  supervisoryStatus emitted        result                   note');
console.log('  ' + '-'.repeat(74));
let numericPasses = 0, realisticFails = 0;
for (const [label, val, kind] of SUP_CASES) {
  const r = hcSupervisorPath(
    { emailAddress: EMAIL, supervisoryStatus: val, occupancyStatus: 'FILLED' }, EMAIL);
  const allowed = r === 'ALLOW';
  if (kind === 'expected-pass' && allowed) numericPasses++;
  if (kind === 'realistic-fail' && !allowed) realisticFails++;
  const note = kind === 'expected-pass' ? 'coerces correctly'
    : kind === 'realistic-fail' ? '<- silent access loss'
      : 'correctly denied';
  console.log('  ' + (kind === 'realistic-fail' && !allowed ? '!! ' : '   ') +
    label.padEnd(32) + r.padEnd(25) + note);
}

console.log('');
console.log('  numeric/string forms of 2 that PASS ..... ' + numericPasses + ' of 3');
console.log('  realistic variants that silently FAIL ... ' + realisticFails + ' of 5');
console.log('');
if (numericPasses === 3) {
  console.log('  THE PUBLISHED CLAIM IS WRONG.');
  console.log('');
  console.log('  "If HC emits a number, two of three allow-paths are already');
  console.log('  dead" does not hold. String(2) === \'2\', so a numeric 2 is');
  console.log('  accepted. The explicit String() coercion is exactly the');
  console.log('  defense the claim says is missing.');
  console.log('');
  console.log('  THE UNDERLYING RISK IS REAL, with a different trigger.');
  console.log('  Zero-padding, surrounding whitespace, and decimal');
  console.log('  formatting all fail — and all three are what you get from');
  console.log('  spreadsheet exports, CSV round-trips, and text-formatted');
  console.log('  columns. The gate trims nothing and pads nothing.');
  console.log('');
  console.log('  So VT-03 keeps its 20 minutes but must ask for the exact');
  console.log('  distinct values, not merely the type.');
}

// ---------------------------------------------------------------------------
// [2] the occupancy test
// ---------------------------------------------------------------------------

console.log('\n[2] THE OCCUPANCY TEST — occupancyStatus');
console.log('  supervisoryStatus held at \'2\' so only the occupancy check');
console.log('  can reject. This is a DENYLIST: two values are refused and');
console.log('  everything else is accepted. Denylists fail open by');
console.log('  construction, so the question is what lands in "everything');
console.log('  else".');
console.log('');

const OCC_CASES = [
  ["'FILLED'", 'FILLED', 'intended-allow'],
  ["'filled'  lowercase", 'filled', 'intended-allow'],
  ["'VACANT'", 'VACANT', 'intended-deny'],
  ["'vacant'  lowercase", 'vacant', 'intended-deny'],
  ["'OBLIGATED'", 'OBLIGATED', 'intended-deny'],
  ["' VACANT ' padded", ' VACANT ', 'unintended-allow'],
  ["''    empty string", '', 'unintended-allow'],
  ['null', null, 'unintended-allow'],
  ['undefined  field absent', undefined, 'unintended-allow'],
  ["'ENCUMBERED' unknown code", 'ENCUMBERED', 'unintended-allow'],
  ["'TERMINATED' unknown code", 'TERMINATED', 'unintended-allow']
];

console.log('  occupancyStatus emitted          result                   note');
console.log('  ' + '-'.repeat(74));
let blankAllows = 0, unknownAllows = 0;
for (const [label, val, kind] of OCC_CASES) {
  const r = hcSupervisorPath(
    { emailAddress: EMAIL, supervisoryStatus: '2', occupancyStatus: val }, EMAIL);
  const allowed = r === 'ALLOW';
  if (kind === 'unintended-allow' && allowed) {
    if (val === '' || val === null || val === undefined) blankAllows++;
    else unknownAllows++;
  }
  const note = kind === 'intended-allow' ? 'as designed'
    : kind === 'intended-deny' ? 'as designed'
      : '<- fails OPEN';
  console.log('  ' + (kind === 'unintended-allow' && allowed ? '!! ' : '   ') +
    label.padEnd(32) + r.padEnd(25) + note);
}

console.log('');
console.log('  blank / absent occupancy that ALLOWS .... ' + blankAllows + ' of 3');
console.log('  unknown codes that ALLOW ............... ' + unknownAllows + ' of 3');
console.log('');
console.log('  THE TWO CHECKS FAIL IN OPPOSITE DIRECTIONS, two lines apart.');
console.log('');
console.log('      supervisoryStatus  ALLOWLIST  -> fails CLOSED');
console.log('                                       (unknown value = no access)');
console.log('      occupancyStatus    DENYLIST   -> fails OPEN');
console.log('                                       (unknown value = access)');
console.log('');
console.log('  Access.js:417\'s `|| \'\'` turns a missing field into the empty');
console.log('  string, which matches neither VACANT nor OBLIGATED, so the');
console.log('  position is treated as filled and access is granted. A');
console.log('  supervisor record with no occupancy data admits its holder.');
console.log('');
console.log('  This is the same asymmetry G-069 records inside one function');
console.log('  in Review_Action.js — a per-row default failing closed beside');
console.log('  a collection-level guard failing open. Here it is a per-field');
console.log('  allowlist beside a per-field denylist. The pattern recurs, so');
console.log('  it is worth naming as a pattern and not only as two findings.');

// ---------------------------------------------------------------------------
// [3] all three allow-paths
// ---------------------------------------------------------------------------

console.log('\n[3] How many of the three allow-paths survive each input class');
console.log('  Path 1 is the role table and does not touch HC, so it is');
console.log('  unaffected by anything in [1] or [2]. Paths 2 and 3 are the');
console.log('  HC-derived ones. Path 3 (_isBuLeadByTitle, Access.js:864)');
console.log('  reads occupancyStatus with the SAME denylist (:885) but does');
console.log('  NOT test supervisoryStatus at all.');
console.log('');

// Path 3's occupancy test, verbatim from Access.js:884-885, plus its title test.
function buLeadPath(p, emailLower) {
  if (!p || !p.officeTitle || !p.emailAddress) return 'skip: missing field';
  if (String(p.emailAddress).toLowerCase() !== emailLower) return 'skip: email mismatch';
  var status = String(p.occupancyStatus || '').toUpperCase();
  if (status === 'VACANT' || status === 'OBLIGATED') return 'DENY: occupancy';
  var titleLower = String(p.officeTitle).toLowerCase();
  var isCos = titleLower.indexOf('chief of staff') !== -1;
  var isCe = titleLower.indexOf('client executive') !== -1;
  if (!isCos && !isCe) return 'DENY: title';
  return 'ALLOW';
}

const SCENARIOS = [
  ['HC emits numeric 2', { supervisoryStatus: 2, occupancyStatus: 'FILLED' }],
  ["HC emits '02'", { supervisoryStatus: '02', occupancyStatus: 'FILLED' }],
  ['HC emits \' 2 \' padded', { supervisoryStatus: ' 2 ', occupancyStatus: 'FILLED' }],
  ['occupancy field absent', { supervisoryStatus: '2', occupancyStatus: undefined }],
  ['both fields absent', { supervisoryStatus: undefined, occupancyStatus: undefined }],
  ['HC library unreachable', null]
];

console.log('  scenario                      path 2 (supervisor)   path 3 (BU lead)');
console.log('  ' + '-'.repeat(74));
for (const [label, shape] of SCENARIOS) {
  let p2, p3;
  if (shape === null) {
    // Every HC call sits in try/catch that warns and continues (:422, :907).
    p2 = 'DENY: swallowed';
    p3 = 'DENY: swallowed';
  } else {
    p2 = hcSupervisorPath(Object.assign({ emailAddress: EMAIL }, shape), EMAIL);
    p3 = buLeadPath(Object.assign(
      { emailAddress: EMAIL, officeTitle: 'Chief of Staff' }, shape), EMAIL);
  }
  console.log('  ' + label.padEnd(30) + p2.padEnd(24) + p3);
}

console.log('');
console.log('  Note the last row. When the library is unreachable, both HC');
console.log('  paths deny — correctly, but SILENTLY: each call site catches,');
console.log('  warns, and continues (Access.js:422, :907). Failing closed is');
console.log('  right. Failing closed with no signal is finding G-008, and it');
console.log('  is why VT-03 asks whether a library is attached at all before');
console.log('  it asks what the library emits.');
console.log('');
console.log('  Note also that path 3 ignores supervisoryStatus entirely, so');
console.log('  a supervisory type mismatch would NOT kill "two of three"');
console.log('  paths even if the comparison were bare. It would kill one.');
console.log('  The published claim was wrong twice over.');

// ---------------------------------------------------------------------------
// [4] divergence from the prose
// ---------------------------------------------------------------------------

console.log('\n[4] Divergence from the prose, per document');
console.log('  Any document still asserting that a NUMERIC value breaks the');
console.log('  gate contradicts [1] and must be corrected.');
console.log('');
console.log('  TWO CLASSES OF DOCUMENT, treated differently — matching how');
console.log('  Pass 6 handled the four figures it withdrew (§6.3):');
console.log('    DELIVERABLE    corrected in place. A stale claim here is a');
console.log('                   problem, because these are what a reader reads.');
console.log('    WORKING NOTE   left as written. The pass documents are a');
console.log('                   dated record; Pass 6 §6.7.4 records the');
console.log('                   withdrawal. Editing them would rewrite history');
console.log('                   and is NOT counted as a problem.');
console.log('');

// Deliverables: a stale claim is a problem.
const DELIVERABLES = [
  'ADMINISTRATOR_GUIDE.md', 'SYSTEM_COMPONENT_MAP.md', 'DATA_DICTIONARY.md',
  'WORKFLOW_AND_BUSINESS_RULES.md', 'DEPLOYMENT_AND_ENVIRONMENTS.md',
  'GAP_REGISTER.md', 'ENHANCEMENT_PLAYBOOK.md', 'SYSTEM_STATE.md',
  'README.md', 'HUMAN_VERIFICATION_CHECKLIST.md'
];
// Working notes: recorded, never edited. Pass 6 is the consolidation and
// must carry the withdrawal, so it is checked as a deliverable would be.
const WORKING_NOTES = [
  'SECURITY_AND_ACCESS_PASS5.md', 'ENTRY_POINTS_AND_ROUTING.md',
  'FILE_MANIFEST.md', 'DATA_LAYER_PASS3.md', 'BUSINESS_LOGIC_PASS4.md',
  '_RESUME_HERE.md'
];
const CONSOLIDATION = ['GAP_CONSOLIDATION_PASS6.md'];

// The wrong claim: a number (or "emits a number") breaking the comparison.
const WRONG = /(?:emits?|emitted)\s+(?:a\s+)?numbers?/gi;
// The right framing: naming padding/whitespace/exact values, saying
// explicitly that String() coercion handles the numeric case, or marking
// the claim withdrawn / quoting it as a correction.
//
// NOTE ON THIS REGEX, because an earlier version of it produced a false
// positive. It must recognize a QUOTATION of the wrong claim inside a
// correction block as corrected, not as stale — otherwise the act of
// recording the withdrawal (convention 11: never renumber, always record
// the re-rating with its reason) trips the very check that is supposed to
// enforce it. An earlier form required `String()` adjacent to `coerc` and
// missed "`String()` coercion" because of the intervening backtick.
const RIGHT = new RegExp([
  'zero-padd', 'coerc', 'whitespace', "'02'",
  'withdrawn', 'Withdrawn', 'WITHDRAWN',
  'previously said', 'That is false', 'is wrong', 'claimed', '~~'
].join('|'));

let stale = 0, corrected = 0, noted = 0;
for (const fn of DELIVERABLES.concat(CONSOLIDATION)) {
  const t = readDoc(fn);
  if (t === null) continue;
  for (const m of [...t.matchAll(WRONG)]) {
    const line = t.slice(0, m.index).split('\n').length;
    const ctx = t.slice(Math.max(0, m.index - 260), m.index + 260);
    const isCorrected = RIGHT.test(ctx);
    if (isCorrected) corrected++; else { stale++; problems++; }
    console.log('  ' + (isCorrected ? '   ' : '!! ') +
      (fn + ':' + line).padEnd(42) +
      (isCorrected ? 'corrected — states the real trigger'
        : 'STALE — still claims a number breaks it'));
  }
}
for (const fn of WORKING_NOTES) {
  const t = readDoc(fn);
  if (t === null) continue;
  for (const m of [...t.matchAll(WRONG)]) {
    const line = t.slice(0, m.index).split('\n').length;
    noted++;
    console.log('  -- ' + (fn + ':' + line).padEnd(42) +
      'working note — withdrawal recorded in Pass 6 §6.7.4');
  }
}
console.log('');
console.log('  deliverables still asserting the wrong trigger ... ' + stale);
console.log('  deliverables stating the real trigger ........... ' + corrected);
console.log('  working-note occurrences, left as written ....... ' + noted);
if (stale === 0 && corrected === 0 && noted === 0) {
  console.log('    -> no document makes the claim in either form.');
}

bar('=');
console.log('Integrity problems detected ................... ' + problems);
if (problems === 0) {
  console.log('All citations resolve, the executed copy matches its source,');
  console.log('and no document asserts the withdrawn numeric-coercion claim.');
}
console.log('');
console.log('Two results from this script belong in the register:');
console.log('  - the WITHDRAWN claim (numeric 2 breaks the gate) — it does not');
console.log('  - the occupancy denylist failing open on a blank field, which');
console.log('    was in no finding before this script was written');
console.log('Every result above is recomputed from source on each run.\n');
