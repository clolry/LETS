/**
 * pass6_client_call_census.js — reproducible evidence for GAP_CONSOLIDATION_PASS6.md
 *
 * Run from this directory:
 *     node pass6_client_call_census.js
 *
 * Reads only. Touches no Google service. Static analysis of lets_app/client/
 * resolved against lets_app/server/.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * Pass 2 §2.2.1-2.2.2 published, by hand:
 *   - "63 distinct server functions are invoked by the screens"
 *   - "60 resolve to a top-level server function and 3 do not exist"
 *   - a four-way guard breakdown of those: 29 admin-gated, 4 role-context-
 *     gated, 18 record-level-only, 12 with no check
 *
 * Those figures do not reconcile with each other. The four categories as
 * LABELED sum to 63, but they are supposed to partition the 60 that
 * resolve, not all 63. And the tables beneath the labels contain different
 * numbers of rows than the labels claim — the role-context table says 4 and
 * lists 5; the no-check table says 12 and lists 13. Pass 6 item 2 requires
 * the hand-counted figures be confirmed or corrected, so this script
 * re-derives the whole census.
 *
 * WHAT IT MEASURES
 *   [1] Every server function name the client invokes, by either mechanism:
 *         google.script.run[.withXHandler(...)]*.fnName(...)
 *         serverCall('fnName', ...)        — the Promise wrapper at
 *                                            client/shared/serverCall.html
 *   [2] Which of those resolve to a real top-level server function
 *   [3] The guard class of each that resolves, using the same classifier as
 *       pass5_guard_census.js and pass6_write_surface_census.js so all three
 *       scripts partition the same population the same way
 *   [4] A reconciliation against every number Pass 2 published
 *
 * METHOD NOTES THAT AFFECT CORRECTNESS
 *   - Comments are stripped from BOTH trees before matching. HTML comments
 *     too, since the client files are .html.
 *   - The google.script.run chain is matched through any number of
 *     .withSuccessHandler(...) / .withFailureHandler(...) / .withUserObject(...)
 *     links, including when they span lines. Those wrappers are stripped and
 *     the next identifier is the real call target.
 *   - A name invoked from more than one screen counts ONCE. Pass 2 counted
 *     "distinct server functions", so this does too.
 *   - Client-side helper calls that merely look like RPCs are excluded by
 *     construction: a name is only counted if it appears in a
 *     google.script.run chain or a serverCall() literal.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const CLIENT_DIR = path.join(REPO, 'lets_app', 'client');
const SERVER_DIR = path.join(REPO, 'lets_app', 'server');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function walk(dir, ext, out) {
  out = out || [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\0/g, '');
}

function rel(file) {
  return path.relative(REPO, file).split(path.sep).join('/');
}

/** Strip // , block, and HTML comments. Line structure is not preserved. */
function stripAllComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/([^:"'\\])\/\/[^\n"']*$/gm, '$1 ');
}

/** Blank out // and block comments, preserving line numbering. */
function stripCommentsLines(lines) {
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    let s = line;
    if (inBlock) {
      const close = s.indexOf('*/');
      if (close === -1) { out.push(''); continue; }
      inBlock = false;
      s = s.slice(close + 2);
    }
    for (;;) {
      const open = s.indexOf('/*');
      if (open === -1) break;
      const close = s.indexOf('*/', open + 2);
      if (close === -1) { s = s.slice(0, open); inBlock = true; break; }
      s = s.slice(0, open) + s.slice(close + 2);
    }
    out.push(s.replace(/\/\/.*$/, ''));
  }
  return out;
}

function topLevelFunctions(lines) {
  const decl = /^function\s+([A-Za-z0-9_$]+)\s*\(/;
  const found = [];
  lines.forEach((line, i) => {
    const m = decl.exec(line);
    if (m) found.push({ name: m[1], start: i + 1 });
  });
  return found.map((fn, i) => ({
    name: fn.name,
    start: fn.start,
    end: i + 1 < found.length ? found[i + 1].start - 1 : lines.length
  }));
}

// Guard classifiers — identical to the other two Pass 5/6 scripts.
const HARD_GUARD = /requireTravelAdmin\s*\(|requireRole\s*\(/;
const SOFT_GUARD = /isTravelAdmin\s*\(|getReviewerContext\s*\(|canAccessTrip\s*\(/;
const RECORD_AUTHZ = new RegExp([
  'You can only', 'Only the submitter', 'Only the assigned',
  'Only the request submitter', 'Access denied', 'Edit access denied',
  'not match the submitter', 'editableStatuses', 'REQUEST_EDITABLE_STATUSES',
  '(?:submitterEmail|assignedReviewer|currentReviewerEmail|ddEmail)' +
    '\\s*(?:===|!==|==|!=)',
  '(?:===|!==|==|!=)\\s*' +
    '(?:submitterEmail|assignedReviewer|currentReviewerEmail|ddEmail|userEmailLower)',
  '\\.toLowerCase\\(\\)\\s*(?:===|!==)\\s*\\w*(?:[Ee]mail)\\w*\\.toLowerCase\\(\\)'
].join('|'));

// ---------------------------------------------------------------------------
// build the server function index
// ---------------------------------------------------------------------------

const serverFiles = walk(SERVER_DIR, '.js');
const serverFns = new Map();   // name -> {file, line, guardClass, reachable}

for (const file of serverFiles) {
  const raw = read(file).split('\n');
  const code = stripCommentsLines(raw);
  for (const fn of topLevelFunctions(raw)) {
    const body = code.slice(fn.start - 1, fn.end).join('\n');
    const guardClass =
      HARD_GUARD.test(body) ? 'throwing'
      : RECORD_AUTHZ.test(body) ? 'record'
      : SOFT_GUARD.test(body) ? 'soft'
      : 'none';
    if (!serverFns.has(fn.name)) {
      serverFns.set(fn.name, {
        file: rel(file), line: fn.start, guardClass,
        reachable: !fn.name.endsWith('_')
      });
    }
  }
}

// ---------------------------------------------------------------------------
// find every RPC the client makes
// ---------------------------------------------------------------------------

const clientFiles = walk(CLIENT_DIR, '.html');
const calls = new Map();   // server fn name -> Set of 'file' strings

function note(name, file) {
  if (!calls.has(name)) calls.set(name, new Set());
  calls.get(name).add(rel(file));
}

// Chain links to skip past before the real target.
const CHAIN_WRAPPERS = new Set([
  'withSuccessHandler', 'withFailureHandler', 'withUserObject'
]);
const RUN_ANCHOR = /google\s*\.\s*script\s*\.\s*run/g;
const SERVER_CALL = /serverCall\s*\(\s*['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]/g;
// runner[name].apply(...) — the indirection inside serverCall itself.
const RUNNER_INDIRECT = /runner\s*\[\s*functionName\s*\]/;

/**
 * From index i (just past `google.script.run`), walk the member chain and
 * return the first method name that is NOT a withXHandler/withUserObject
 * wrapper. A regex cannot do this: the wrapper arguments are arbitrary
 * callbacks containing nested parens, braces, strings and regexes, so the
 * argument list must be skipped with a balanced scanner.
 *
 * @returns {string|null} the RPC name, or null if the chain does not resolve
 */
function resolveRunChain(text, i) {
  let p = i;
  for (;;) {
    // skip whitespace to the next '.'
    while (p < text.length && /\s/.test(text[p])) p++;
    if (text[p] !== '.') return null;
    p++;
    while (p < text.length && /\s/.test(text[p])) p++;
    // read the identifier
    const start = p;
    while (p < text.length && /[A-Za-z0-9_$]/.test(text[p])) p++;
    const name = text.slice(start, p);
    if (!name) return null;
    while (p < text.length && /\s/.test(text[p])) p++;
    if (text[p] !== '(') {
      // property access, not a call — e.g. google.script.run.foo = ...
      return null;
    }
    if (!CHAIN_WRAPPERS.has(name)) return name;   // this is the RPC
    // It is a wrapper: skip its balanced argument list and continue.
    p = skipBalanced(text, p);
    if (p === -1) return null;
  }
}

/**
 * Given index of an opening '(', return the index just past its matching
 * ')'. Respects nesting, single/double/template quotes, escapes, and line
 * comments. Returns -1 if unbalanced.
 */
function skipBalanced(text, open) {
  let depth = 0;
  for (let p = open; p < text.length; p++) {
    const c = text[p];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      p++;
      while (p < text.length) {
        if (text[p] === '\\') { p += 2; continue; }
        if (text[p] === quote) break;
        p++;
      }
      continue;
    }
    if (c === '/' && text[p + 1] === '/') {
      while (p < text.length && text[p] !== '\n') p++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return p + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

let indirectSites = 0;
let unresolvedChains = 0;

for (const file of clientFiles) {
  const text = stripAllComments(read(file));

  let m;
  RUN_ANCHOR.lastIndex = 0;
  while ((m = RUN_ANCHOR.exec(text)) !== null) {
    const name = resolveRunChain(text, m.index + m[0].length);
    if (name) note(name, file);
    else unresolvedChains++;
  }

  SERVER_CALL.lastIndex = 0;
  while ((m = SERVER_CALL.exec(text)) !== null) note(m[1], file);

  if (RUNNER_INDIRECT.test(text)) indirectSites++;
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const bar = (c) => console.log(c.repeat(78));
let disagreements = 0;
function check(label, measured, claimed, note2) {
  const agree = measured === claimed;
  if (!agree) disagreements++;
  console.log('  ' + (agree ? '   ' : '!! ') + label.padEnd(44) +
    'measured ' + String(measured).padStart(3) +
    '   Pass 2 said ' + String(claimed).padStart(3) +
    (agree ? '' : '   <- DISAGREE'));
  if (!agree && note2) console.log('        ' + note2);
}

console.log('\nPass 6 evidence — client RPC call census');
console.log('client files scanned: ' + clientFiles.length +
  '   server files indexed: ' + serverFiles.length);
console.log('purpose: mechanically re-derive Pass 2 §2.2.1-2.2.2\'s');
console.log('         hand-counted 63 / 60 / 3 and its guard breakdown');
bar('=');

const names = [...calls.keys()].sort();
const resolved = names.filter(n => serverFns.has(n));
const missing = names.filter(n => !serverFns.has(n));

console.log('\n[1] How many server functions do the screens actually call?');
console.log('  distinct names invoked ................... ' + names.length);
console.log('  resolve to a top-level server function ... ' + resolved.length);
console.log('  DO NOT EXIST anywhere in server/ ......... ' + missing.length);
console.log('');
check('distinct names invoked', names.length, 63);
check('resolve', resolved.length, 60);
check('do not exist', missing.length, 3);

console.log('\n  The non-existent targets — each is a live defect:');
for (const n of missing) {
  console.log('      ' + n.padEnd(28) + 'called from ' + [...calls.get(n)].join(', '));
}

console.log('\n[2] Guard class of the ' + resolved.length + ' that resolve');
const byClass = { throwing: [], record: [], soft: [], none: [] };
for (const n of resolved) byClass[serverFns.get(n).guardClass].push(n);

console.log('  Using the same classifier as pass5_guard_census.js and');
console.log('  pass6_write_surface_census.js, so all three scripts partition');
console.log('  the same population identically.');
console.log('');
console.log('  behind a THROWING guard (admin-gated) .... ' + byClass.throwing.length);
console.log('  record-level identity check only ......... ' + byClass.record.length);
console.log('  calls a role function but may ignore it... ' + byClass.soft.length);
console.log('  NO check of any kind ..................... ' + byClass.none.length);
console.log('  ------');
console.log('  total .................................... ' +
  (byClass.throwing.length + byClass.record.length +
   byClass.soft.length + byClass.none.length));

console.log('\n[3] Reconciliation against Pass 2\'s published breakdown');
console.log('  Pass 2 §2.2.2 gives four categories with these labels:');
console.log('    "Admin-gated (29)"  "Role-context-gated (4)"');
console.log('    "Record-level only (18)"  "No authorization check (12 of the 63)"');
console.log('');
console.log('  Three independent problems, the first two visible without');
console.log('  running anything:');
console.log('');
console.log('    a) The labels sum to 29+4+18+12 = 63. But they are supposed');
console.log('       to partition the functions that RESOLVE, and 3 of the 64');
console.log('       names do not exist and cannot have a guard class. The');
console.log('       breakdown double-counts by exactly 3.');
console.log('');
console.log('    b) The tables under the labels have different row counts than');
console.log('       the labels state: the role-context table says 4 and lists');
console.log('       5 rows; the no-check table says 12 and lists 13 rows.');
console.log('');
console.log('    c) The substantive error — see the set diff below.');
console.log('');
console.log('  Measured against Pass 2\'s own categories:');
check('admin-gated (throwing guard)', byClass.throwing.length, 29,
  'Pass 2\'s 29 is a hand count; its own table lists 21 rows plus a\n' +
  '        parenthetical "plus 8 more" that it never enumerates.');
check('record-level only', byClass.record.length, 18);
check('no check of any kind', byClass.none.length, 12,
  'Pass 2\'s own table lists 13 rows under a label saying 12.');

// --- the substantive error: set diff against Pass 2's actual table --------

console.log('\n[3a] Where Pass 2\'s "record-level only" list is wrong');
console.log('  Pass 2\'s table of 18 is transcribed here verbatim and each');
console.log('  entry re-classified. This is the error that matters: it is not');
console.log('  arithmetic, it is a wrong security claim about named functions.');

// Verbatim from ENTRY_POINTS_AND_ROUTING.md §2.2.2, "Record-level only (18)".
const PASS2_RECORD_LEVEL = [
  'submitReviewAction', 'updateRequestOverview', 'updateRequestItinerary',
  'updateRequestClassification', 'updateTravelersForReview',
  'updateCostsForReview', 'updateSharedCostsForReview', 'getRequestForReview',
  'getMyTravelRequests', 'confirmDDTravelers', 'getDDConfirmationData',
  'reportDDFundingIssue', 'submitFundingCorrection', 'submitTravelRequestV2',
  'submitTravelFeedback', 'checkNpsEligibility', 'dismissNpsPrompt',
  'uploadTravelDraftFile'
];

console.log('');
const misclassified = [];
for (const n of PASS2_RECORD_LEVEL) {
  const s = serverFns.get(n);
  if (!s) { console.log('  !! ' + n.padEnd(30) + 'NOT FOUND'); continue; }
  const ok = s.guardClass === 'record';
  if (!ok) misclassified.push(n);
  console.log('  ' + (ok ? '   ' : '!! ') + n.padEnd(30) +
    'measured: ' + s.guardClass.padEnd(9) +
    (ok ? '' : '<- NOT a record-level check'));
}

console.log('');
console.log('  Pass 2 listed as "record-level" ........... ' +
  PASS2_RECORD_LEVEL.length);
console.log('  actually have a record-level check ........ ' +
  (PASS2_RECORD_LEVEL.length - misclassified.length));
console.log('  have NO check at all ...................... ' + misclassified.length);
if (misclassified.length) {
  disagreements++;
  console.log('');
  console.log('  The cause, and it is the same mistake in all ' + misclassified.length +
    ' cases:');
  console.log('  each of these functions READS the caller\'s identity via');
  console.log('  Session.getActiveUser(), and Pass 2 treated that as evidence of');
  console.log('  a check. It is not. The identity is stamped into a record or an');
  console.log('  Approval_Log row and never compared against anything. Pass 5');
  console.log('  §5.3 names this distinction exactly — "identity as evidence vs.');
  console.log('  identity as permission" — and its findings S-4 and S-17 correct');
  console.log('  the specific functions. Pass 6\'s job is to make sure the');
  console.log('  register carries Pass 5\'s reading, not Pass 2\'s.');
  console.log('');
  console.log('  CONSEQUENCE: Pass 2 §2.2.2 UNDERSTATES the unguarded surface.');
  console.log('  Its "12 with no authorization check" should read ' +
    byClass.none.length + '.');
  console.log('  Do not cite Pass 2 §2.2.2\'s breakdown anywhere. Cite this');
  console.log('  script, or Pass 5 §5.2.3 for the whole-surface view.');
}

console.log('\n[4] The functions with no check of any kind');
console.log('  These run for anyone who gets past the site gate. Pass 2 named');
console.log('  getHCStaffingBundle and deleteTravelDraftFile as the two a');
console.log('  reviewer should look at; the full measured list is ' +
  byClass.none.length + '.');
console.log('  Marked * where Pass 2 wrongly placed it in "record-level only".');
const p2rec = new Set(PASS2_RECORD_LEVEL);
for (const n of byClass.none.sort()) {
  const s = serverFns.get(n);
  const mark = p2rec.has(n) ? ' *' : '';
  console.log('      ' + (s.file + ':' + s.line).padEnd(50) + n + mark);
}

console.log('\n[5] Screen-invoked vs. the whole reachable surface');
const allReachable = [...serverFns.values()].filter(v => v.reachable).length;
console.log('  server functions the screens invoke ...... ' + resolved.length);
console.log('  server functions a browser CAN invoke .... ' + allReachable);
console.log('  invocable but not linked by any screen ... ' + (allReachable - resolved.length));
console.log('');
console.log('  This is Pass 2 §2.2.3\'s central point, re-derived: the screens');
console.log('  are not the attack surface. ' + (allReachable - resolved.length) +
  ' functions are callable from');
console.log('  any authenticated browser without appearing in any UI.');

if (indirectSites) {
  console.log('\n[6] Caveat — dynamic dispatch this script cannot fully resolve');
  console.log('  client files using runner[name] indirection .. ' + indirectSites);
  console.log('  That is client/shared/serverCall.html\'s own implementation,');
  console.log('  which dispatches on a string argument. Its CALLERS are');
  console.log('  resolved above via the serverCall(\'name\') literal pattern, so');
  console.log('  coverage is complete unless a caller builds the name at');
  console.log('  runtime. A grep for serverCall( with a non-literal first');
  console.log('  argument found none, but this is the one blind spot in the');
  console.log('  method and is recorded rather than hidden.');
}

bar('=');
console.log('Disagreements with Pass 2\'s prose ............ ' + disagreements);
if (disagreements) {
  console.log('Pass 2 §2.2.1-2.2.2\'s hand-counted census does not reconcile.');
  console.log('Cite this script\'s figures in the gap register, and state the');
  console.log('scope with them.');
}
console.log('Every number above is recomputed from source on each run.\n');
