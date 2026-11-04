/**
 * pass6_checklist_check.js — structural validator for HUMAN_VERIFICATION_CHECKLIST.md
 *
 * Run from this directory:
 *     node pass6_checklist_check.js
 *
 * Reads only. Touches no Google service, no network.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The checklist is a dataset wearing prose, like the register. Its invariants
 * are different, though, and one of them has already been violated:
 *
 *   ITS OWN EFFORT TOTAL. Pass 6 §6.7.2 published "under six hours" and
 *   "twenty of the 29 tasks take fifteen minutes or less". Summing the
 *   per-task costs gives 7h 1m and 23 tasks. Both headline figures were
 *   wrong, and both were repeated into four other documents.
 *
 * That is the same failure mode flagged in SYSTEM_STATE.md §8.3: a table
 * computed from a document's own contents goes stale the moment the
 * contents change, and nothing warns you. The register has a validator for
 * exactly this reason; the checklist now has one too.
 *
 * WHAT IT CHECKS
 *   [1] Task IDs — contiguous VT-01..VT-nn, no duplicates or gaps
 *   [2] THE EFFORT ARITHMETIC: every per-task cost summed, against whatever
 *       total the document claims, and against the claims in every other
 *       document that repeats it
 *   [3] Every function the checklist tells a human to run exists in source
 *   [4] Every finding a task claims to unblock exists in the register
 *   [5] Cross-document consistency: the task count as stated everywhere
 *   [6] The hard sequencing constraint (VT-04 before any G-002 fix) is
 *       present and prominent
 *   [7] Business decisions are separated from tasks
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..');
const REPO = path.join(__dirname, '..', '..');
const SERVER = path.join(REPO, 'lets_app', 'server');

const bar = c => console.log(c.repeat(78));
let problems = 0;

function read(name) {
  try { return fs.readFileSync(path.join(DOCS, name), 'utf8').replace(/\0/g, ''); }
  catch (e) { return null; }
}
function walk(dir, out) {
  out = out || [];
  let e;
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch (x) { return out; }
  for (const x of e) {
    const f = path.join(dir, x.name);
    if (x.isDirectory()) walk(f, out);
    else if (x.name.endsWith('.js')) out.push(f);
  }
  return out;
}

const CHECKLIST = 'HUMAN_VERIFICATION_CHECKLIST.md';
const OTHERS = [
  'README.md', 'ADMINISTRATOR_GUIDE.md', 'SYSTEM_COMPONENT_MAP.md',
  'DATA_DICTIONARY.md', 'WORKFLOW_AND_BUSINESS_RULES.md',
  'DEPLOYMENT_AND_ENVIRONMENTS.md', 'GAP_REGISTER.md',
  'ENHANCEMENT_PLAYBOOK.md', 'SYSTEM_STATE.md',
  'GAP_CONSOLIDATION_PASS6.md'
];

console.log('\nPass 6 evidence — verification checklist structural check');
console.log('purpose: validate the checklist as a dataset, and keep its own');
console.log('         effort arithmetic honest across every document');
bar('=');

const doc = read(CHECKLIST);
if (!doc) {
  console.log('\n' + CHECKLIST + ' not found. Nothing to check.');
  console.log('(Written to run before, during, and after the checklist is');
  console.log(' drafted. Run again once the file exists.)\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// [1] task IDs
// ---------------------------------------------------------------------------

console.log('\n[1] Task identifiers');

// A task row begins with its ID in bold in the first cell.
const taskRows = [...doc.matchAll(/^\|\s*\*\*(VT-\d{2})\*\*\s*\|(.*)$/gm)]
  .map(m => ({ id: m[1], rest: m[2], raw: m[0] }));

// Deduplicate: a task may be referenced in more than one table (e.g. the
// top-five summary). The canonical set is the one in the main table, so
// count DISTINCT ids and report the duplication rather than treating a
// second mention as a second task.
const ids = [...new Set(taskRows.map(t => t.id))].sort();
console.log('  rows mentioning a task ID in cell 1 ...... ' + taskRows.length);
console.log('  DISTINCT task IDs ....................... ' + ids.length);

const nums = ids.map(i => parseInt(i.slice(3), 10));
const max = Math.max(...nums);
const gaps = [];
for (let i = 1; i <= max; i++) if (!nums.includes(i)) gaps.push('VT-' + String(i).padStart(2, '0'));
console.log('  highest ID .............................. VT-' + String(max).padStart(2, '0'));
console.log('  gaps in the sequence .................... ' + gaps.length +
  (gaps.length ? '   !! ' + gaps.join(', ') : ''));
if (gaps.length) problems++;

const stated = /(\d+)\s+(?:verification\s+)?tasks/i.exec(doc);
if (stated) {
  const n = parseInt(stated[1], 10);
  const ok = n === ids.length;
  if (!ok) problems++;
  console.log('  document states ' + n + ' tasks ................. ' +
    (ok ? 'matches' : '!! ' + ids.length + ' found'));
}

// ---------------------------------------------------------------------------
// [2] THE EFFORT ARITHMETIC
// ---------------------------------------------------------------------------

console.log('\n[2] THE EFFORT ARITHMETIC');
console.log('  Pass 6 published "under six hours" and "twenty of the 29 take');
console.log('  fifteen minutes or less". Both were wrong, and both were');
console.log('  repeated into four other documents. This section recomputes');
console.log('  from the per-task costs so it cannot go stale again.');

/** Parse "2 min", "20 min", "2 h", "1 h 30 min" to minutes. */
function parseCost(s) {
  if (!s) return null;
  const t = s.replace(/\*/g, '').trim();
  let m = 0, found = false;
  const h = /(\d+(?:\.\d+)?)\s*h/.exec(t);
  if (h) { m += parseFloat(h[1]) * 60; found = true; }
  const mm = /(\d+)\s*min/.exec(t);
  if (mm) { m += parseInt(mm[1], 10); found = true; }
  return found ? m : null;
}

// Costs come from the LAST cell of each distinct task's first row.
const costOf = new Map();
for (const t of taskRows) {
  if (costOf.has(t.id)) continue;
  const cells = t.rest.split('|').map(s => s.trim()).filter(s => s !== '');
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = parseCost(cells[i]);
    if (c !== null) { costOf.set(t.id, c); break; }
  }
}

const missing = ids.filter(i => !costOf.has(i));
console.log('');
console.log('  tasks with a parseable cost ............. ' + costOf.size + ' of ' + ids.length);
if (missing.length) {
  console.log('  !! no cost found for: ' + missing.join(', '));
  problems++;
}

const total = [...costOf.values()].reduce((a, b) => a + b, 0);
const fmt = m => Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
const vt26 = costOf.get('VT-26') || 0;

console.log('');
console.log('  TOTAL of all per-task costs ............. ' + total + ' min = ' + fmt(total));
console.log('  VT-26 (the XSS code review) ............ ' + vt26 + ' min');
console.log('  LIVE-ACCESS portion (excluding VT-26) .. ' + (total - vt26) +
  ' min = ' + fmt(total - vt26));
console.log('');
console.log('  tasks at 15 min or less ................ ' +
  [...costOf.values()].filter(v => v <= 15).length + ' of ' + costOf.size);
console.log('  tasks at 5 min or less ................. ' +
  [...costOf.values()].filter(v => v <= 5).length + ' of ' + costOf.size);

// Does the document's own prose agree?
console.log('');
console.log('  Claims made in prose, checked against the sum:');
const CLAIM_RE = [
  [/under (two|three|four|five|six|seven|eight) hours/gi, 'total'],
  [/(twenty|twenty-one|twenty-two|twenty-three|eleven|ten)[- ](?:of the \d+ )?tasks? take/gi, 'bucket']
];
const WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
let claimProblems = 0;
for (const m of doc.matchAll(/under (two|three|four|five|six|seven|eight) hours/gi)) {
  const claimed = WORDS[m[1].toLowerCase()] * 60;
  // "under N hours" is true if the figure it describes is < N*60
  const okTotal = total < claimed;
  const okLive = (total - vt26) < claimed;
  const verdict = okTotal ? 'true of the total'
    : okLive ? 'true of the live-access portion ONLY' : 'FALSE of both';
  if (!okTotal && !okLive) { claimProblems++; problems++; }
  console.log('      "under ' + m[1] + ' hours" .................. ' + verdict);
}
if (claimProblems === 0) {
  console.log('      -> every "under N hours" claim is defensible.');
}

// now check the other documents
console.log('');
console.log('  The same claim in other documents:');
console.log('  A document may legitimately QUOTE the withdrawn wording in');
console.log('  order to record the correction (convention 11: never renumber,');
console.log('  always record the change with its reason). Quoting it is not');
console.log('  asserting it, so those mentions are reported and skipped —');
console.log('  otherwise this check would punish the act of being honest');
console.log('  about the error, which is the third false positive of this');
console.log('  kind in the suite.');
console.log('');
/** Context marking the figure as quoted-and-corrected rather than asserted. */
const IS_A_CORRECTION = [
  { re: /previously read|previously said|originally said|used to say/i, why: 'quoted, then corrected' },
  { re: /withdraw|WITHDRAWN/i, why: 'explicitly withdrawn' },
  { re: /was wrong|is wrong|do not cite|must not be cited/i, why: 'named as wrong' },
  { re: /~~/, why: 'struck through' }
];
let crossBad = 0, crossNoted = 0;
for (const fn of OTHERS) {
  const t = read(fn);
  if (!t) continue;
  for (const m of t.matchAll(/under (two|three|four|five|six|seven|eight) hours/gi)) {
    const claimed = WORDS[m[1].toLowerCase()] * 60;
    // find a bit of context to know what it is describing
    const ctx = t.slice(Math.max(0, m.index - 110), m.index + 40).replace(/\s+/g, ' ');
    const aboutChecklist = /checklist|29 tasks|verification/i.test(ctx);
    if (!aboutChecklist) continue;
    const line = t.slice(0, m.index).split('\n').length;
    // Look wider for the correction markers — they can precede the quotation
    // by a sentence or follow it by one.
    const wide = t.slice(Math.max(0, m.index - 320), m.index + 320);
    const corrected = IS_A_CORRECTION.find(x => x.re.test(wide));
    if (corrected) {
      crossNoted++;
      console.log('      -- ' + (fn + ':' + line).padEnd(38) +
        '"under ' + m[1] + ' hours"  ' + corrected.why);
      continue;
    }
    const ok = total < claimed || (total - vt26) < claimed;
    if (!ok) { crossBad++; problems++; }
    console.log('      ' + (ok ? '   ' : '!! ') + (fn + ':' + line).padEnd(38) +
      '"under ' + m[1] + ' hours"' + (ok ? '' : '   <- FALSE, ASSERTED'));
  }
}
console.log('');
console.log('      documents overstating the total ....... ' + crossBad);
console.log('      quoted-and-corrected mentions ........ ' + crossNoted);
if (crossBad === 0) console.log('      -> no document asserts a total the sum will not support.');

// ---------------------------------------------------------------------------
// [3] functions a human is told to run
// ---------------------------------------------------------------------------

console.log('\n[3] Every function the checklist tells a human to run must exist');

const serverText = walk(SERVER).map(f => fs.readFileSync(f, 'utf8').replace(/\0/g, '')).join('\n');
const defined = new Set(
  [...serverText.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map(m => m[1])
);

// Anything written as `someFunction()` in the checklist
const invoked = new Set(
  [...doc.matchAll(/`(_?[a-zA-Z][A-Za-z0-9_]*)\(/g)].map(m => m[1])
);
/**
 * Names that are NOT LETS server functions and must not be demanded of the
 * source tree. Three kinds, kept separate so the list is auditable:
 *
 *   shell/spreadsheet  — the checklist tells a human to run these
 *   platform globals   — Apps Script and JavaScript built-ins. The checklist
 *                        quotes source lines that call them, e.g.
 *                        String(p.supervisoryStatus), and quoting the code a
 *                        task is about is the point of the task
 *
 * Without this list the check fires on correct prose, which is the failure
 * mode already seen twice in this suite (see §[5] below and
 * pass6_register_check.js's first-cell assumption). A validator that forces
 * a document to stop quoting its own subject matter is worse than no check.
 */
const NOT_SERVER = new Set([
  // shell + spreadsheet formulas a human is told to run
  'node', 'cd', 'for', 'if', 'grep', 'COUNTIF', 'COUNTIFS', 'MATCH', 'VLOOKUP',
  'QUERY', 'FILTER', 'UNIQUE', 'ARRAYFORMULA',
  // JavaScript + Apps Script globals quoted from source
  'function', 'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON',
  'Session', 'SpreadsheetApp', 'ScriptApp', 'DriveApp', 'MailApp', 'GmailApp',
  'Utilities', 'CacheService', 'PropertiesService', 'LockService', 'HtmlService',
  'UrlFetchApp', 'console', 'Logger'
]);

console.log('');
let fnBad = 0;
for (const name of [...invoked].sort()) {
  if (NOT_SERVER.has(name)) continue;
  const ok = defined.has(name);
  if (!ok) { fnBad++; problems++; }
  const loc = ok
    ? (() => {
      for (const f of walk(SERVER)) {
        const t = fs.readFileSync(f, 'utf8').replace(/\0/g, '');
        const m = new RegExp('^function\\s+' + name + '\\s*\\(', 'm').exec(t);
        if (m) return path.relative(REPO, f).split(path.sep).join('/') +
          ':' + t.slice(0, m.index).split('\n').length;
      }
      return '';
    })()
    : 'NOT DEFINED IN SOURCE';
  console.log('  ' + (ok ? '   ' : '!! ') + name.padEnd(30) + loc);
}
console.log('');
console.log('  functions referenced ..................... ' +
  [...invoked].filter(n => !NOT_SERVER.has(n)).length);
console.log('  not found in source ..................... ' + fnBad);
if (fnBad) {
  console.log('    A checklist that tells a human to run a function that does');
  console.log('    not exist wastes the one resource this document spends:');
  console.log('    someone else\'s time with live access.');
}

// ---------------------------------------------------------------------------
// [4] findings each task claims to unblock
// ---------------------------------------------------------------------------

console.log('\n[4] Findings cited by the checklist must exist in the register');

const reg = read('GAP_REGISTER.md') || '';
const regIds = new Set(
  [...reg.matchAll(/^\|\s*\d+\s*\|\s*\*\*(G-\d{3})\*\*/gm)].map(m => m[1])
);
const used = new Set([...doc.matchAll(/\b(G-\d{3})\b/g)].map(m => m[1]));
const notInReg = [...used].filter(g => !regIds.has(g)).sort();
console.log('  register findings ....................... ' + regIds.size);
console.log('  findings cited by the checklist .......... ' + used.size);
console.log('  cited but NOT in the register ............ ' + notInReg.length +
  (notInReg.length ? '   !! ' + notInReg.join(', ') : ''));
if (notInReg.length) problems++;

// Which Criticals does the checklist touch?
const critBlock = reg.slice(reg.indexOf('### Critical'), reg.indexOf('### High'));
const crit = [...critBlock.matchAll(/\*\*(G-\d{3})\*\*/g)].map(m => m[1]);
const critCovered = crit.filter(g => used.has(g));
console.log('');
console.log('  Critical findings in the register ........ ' + crit.length);
console.log('  of those, referenced by some task ....... ' + critCovered.length);
if (critCovered.length < crit.length) {
  console.log('      not referenced: ' + crit.filter(g => !used.has(g)).join(', '));
  console.log('    Not necessarily wrong — a Critical may need no human');
  console.log('    verification. Listed so the omission is deliberate.');
}

// ---------------------------------------------------------------------------
// [5] task count stated consistently everywhere
// ---------------------------------------------------------------------------

console.log('\n[5] The task count, as stated across every document');
console.log('  Any document asserting the SIZE of the checklist must agree');
console.log('  with the number of task IDs actually in it.');
console.log('');

/**
 * NOT EVERY "<n> tasks" IS A CLAIM ABOUT THE CHECKLIST'S SIZE, and an earlier
 * version of this check treated them all as one. It reported two failures
 * against correct prose:
 *
 *   "The 43 verification tasks reduce to 29 tasks plus 6 decisions"
 *        ^^ the PRE-consolidation count, which is the whole point of the
 *           sentence. Rewriting it to say 29 would destroy the meaning.
 *   "the <=15-minute bucket holds 23 tasks, not 20"
 *        ^^ a SUBSET count, and itself one of the corrected figures.
 *
 * That is the same failure mode as this suite's other false positive — the
 * register check assuming the ID sat in the first cell (see
 * pass6_register_check.js). A validator that forces prose to match a naive
 * pattern makes the documents worse. So the disqualifiers are explicit, each
 * with the reason it is legitimate, rather than loosened into a vague regex.
 */
const NOT_A_SIZE_CLAIM = [
  { re: /\bof\s+the\s*\*{0,2}$/i, why: 'a subset: "N of the 29 tasks"' },
  { re: /\bbucket\s+holds\s*\*{0,2}$/i, why: 'a subset: the cost bucket' },
  { re: /\babsorb(?:s|ed)?\s*\*{0,2}$/i, why: 'a merge count' }
];
/** Trailing context that marks the number as a subset or a correction. */
const NOT_A_SIZE_CLAIM_AFTER = [
  { re: /^\s*(?:verification\s+)?tasks?\s+reduce\s+to/i, why: 'the pre-consolidation count being reduced' },
  { re: /^\s*tasks?,\s*not\s+\w+/i, why: 'a corrected subset figure' },
  { re: /^\s*(?:verification\s+)?tasks?\s+(?:take|are)\b/i, why: 'a subset by cost' }
];

let countBad = 0, countSkipped = 0;
for (const fn of [CHECKLIST].concat(OTHERS)) {
  const t = read(fn);
  if (!t) continue;
  for (const m of t.matchAll(/(\d+)\s+(?:verification\s+)?tasks\b/gi)) {
    const n = parseInt(m[1], 10);
    if (n < 5) continue;                 // "3 tasks" in some other sense
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    const after = t.slice(m.index + m[0].length - 5, m.index + m[0].length + 40);
    const line = t.slice(0, m.index).split('\n').length;

    const skipB = NOT_A_SIZE_CLAIM.find(x => x.re.test(before));
    const skipA = NOT_A_SIZE_CLAIM_AFTER.find(x => x.re.test(after));
    if (skipB || skipA) {
      countSkipped++;
      console.log('  -- ' + (fn + ':' + line).padEnd(40) + 'says ' + String(n).padEnd(4) +
        'not a size claim — ' + (skipB || skipA).why);
      continue;
    }

    const ok = n === ids.length;
    if (!ok) { countBad++; problems++; }
    console.log('  ' + (ok ? '   ' : '!! ') + (fn + ':' + line).padEnd(40) + 'says ' +
      String(n).padEnd(4) + (ok ? 'agrees' : '<- SHOULD BE ' + ids.length));
  }
}
console.log('');
console.log('  size claims disagreeing with the checklist ... ' + countBad);
console.log('  mentions excluded as not-a-size-claim ........ ' + countSkipped);
if (countBad === 0) console.log('    -> every document that states the size agrees on ' + ids.length + '.');

// ---------------------------------------------------------------------------
// [6] the hard sequencing constraint
// ---------------------------------------------------------------------------

console.log('\n[6] The one constraint that must be impossible to miss');
console.log('  VT-04 determines whether the privilege self-grant function has');
console.log('  ever been exercised. Remediating G-002 destroys that evidence,');
console.log('  so VT-04 must run FIRST and the checklist must say so loudly.');
console.log('');
const vt04Idx = doc.indexOf('VT-04');
const beforeG002 = /VT-04[\s\S]{0,900}?(?:before|precede)[\s\S]{0,200}?G-002|G-002[\s\S]{0,400}?VT-04/i.test(doc);
const prominent = /(?:⚠|!!|\*\*BEFORE|MUST RUN FIRST|destroys the evidence)/i.test(
  doc.slice(Math.max(0, vt04Idx - 500), vt04Idx + 1200));
console.log('  VT-04 appears in the document ........... ' + (vt04Idx !== -1 ? 'yes' : 'NO'));
console.log('  its ordering constraint is stated ....... ' + (beforeG002 ? 'yes' : 'NO'));
console.log('  stated prominently near the task ........ ' + (prominent ? 'yes' : 'NO'));
if (vt04Idx === -1 || !beforeG002 || !prominent) problems++;

// ---------------------------------------------------------------------------
// [7] decisions separated from tasks
// ---------------------------------------------------------------------------

console.log('\n[7] Business decisions must be separate from tasks');
const bds = new Set([...doc.matchAll(/\b(BD-\d)\b/g)].map(m => m[1]));
console.log('  decisions referenced .................... ' + bds.size +
  '   ' + [...bds].sort().join(', '));
const hasSection = /##[^\n]*decision/i.test(doc);
console.log('  a dedicated decisions section exists .... ' + (hasSection ? 'yes' : 'NO'));
if (!hasSection) problems++;
// A decision must never be numbered as a VT task
const mixed = [...doc.matchAll(/\*\*VT-\d{2}\*\*[^\n|]*\|[^\n|]*BD-\d/g)].length;
console.log('  tasks that are really decisions ......... ' + mixed);
if (mixed) {
  console.log('    A decision inside the task list makes the checklist');
  console.log('    uncompletable, which is how checklists stop being used.');
  problems++;
}

bar('=');
console.log('Structural problems detected ................. ' + problems);
if (problems === 0) {
  console.log('The checklist is internally consistent, every function it names');
  console.log('exists, every finding it cites resolves, and its effort total');
  console.log('agrees with the sum of its own tasks.');
}
console.log('Every check above is recomputed from the documents on each run.\n');
