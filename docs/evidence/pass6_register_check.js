/**
 * pass6_register_check.js — structural validator for GAP_REGISTER.md
 *
 * Run from this directory:
 *     node pass6_register_check.js
 *
 * Reads only. Touches no Google service, no network. Reads the deliverables
 * in docs/ and checks them against each other.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The gap register is the one deliverable whose PRODUCT is its structure.
 * Every other document can be judged by reading it; this one is a dataset,
 * and a dataset has invariants that prose review will not catch:
 *
 *   - no duplicate IDs, no gaps in the sequence
 *   - the severity-block headings must match the rows beneath them
 *   - the per-block counts must sum to the stated total
 *   - every finding cited anywhere in the narrative deliverables must exist here
 *   - every finding here should be cited somewhere, or it is orphaned
 *   - the cross-reference appendix must account for every pass ID
 *   - a finding marked BLOCKED must name a real BD-n
 *
 * Writing the register by hand and eyeballing those is how registers drift.
 * This script fails loudly instead.
 *
 * A NOTE ON WHAT THIS SCRIPT ALREADY CAUGHT
 * -----------------------------------------
 * An earlier version of this check, run against the narrative deliverables before the
 * register was written, found THREE mis-numbered citations: G-055 cited for
 * the File_Queue phantom (which is G-057), G-056 for the Log_ID formats
 * (G-058), and G-057 for Edit_SharedCosts (G-059). All three were off by
 * two in the same direction, which is the signature of reading a register
 * row and miscounting. They are corrected in the deliverables; the check
 * stays so the next such slip is caught at once.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..');
const bar = c => console.log(c.repeat(78));
let problems = 0;

function read(name) {
  try { return fs.readFileSync(path.join(DOCS, name), 'utf8').replace(/\0/g, ''); }
  catch (e) { return null; }
}

const REGISTER = 'GAP_REGISTER.md';
const PASS6 = 'GAP_CONSOLIDATION_PASS6.md';
const DELIVERABLES = [
  'ADMINISTRATOR_GUIDE.md',
  'SYSTEM_COMPONENT_MAP.md',
  'DATA_DICTIONARY.md',
  'WORKFLOW_AND_BUSINESS_RULES.md',
  'DEPLOYMENT_AND_ENVIRONMENTS.md',
  'ENHANCEMENT_PLAYBOOK.md',
  'SYSTEM_STATE.md',
  'README.md'
];

console.log('\nPass 6 evidence — gap register structural check');
console.log('purpose: validate the register as a DATASET, not as prose');
bar('=');

const regDoc = read(REGISTER);
if (!regDoc) {
  console.log('\n' + REGISTER + ' not found. Nothing to check.');
  console.log('(This script is written to run before, during, and after the');
  console.log(' register is drafted. Run it again once the file exists.)\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// [1] parse the register
// ---------------------------------------------------------------------------

console.log('\n[1] Parsing the register');

/**
 * SCOPE THE PARSE TO THE REGISTER SECTION, AND DO NOT ASSUME COLUMN ORDER.
 *
 * The first version of this check required the ID in the first cell
 * (`| **G-001** | ...`). The register puts Rank first — `| 1 | **G-001** |`
 * — because rank is what a reader scans. The check reported 13 rows out of
 * 73, 55 "gaps", and 55 "dropped" findings: a catastrophic false positive
 * produced entirely by the validator's own assumption.
 *
 * It also swept up ID mentions from the prose tables in later sections,
 * which is why the Constructive block appeared to hold 14 rows. The parse
 * is now bounded to the register section and matches an ID in ANY cell of a
 * row whose first cell is a bare integer rank.
 */
const regStart = regDoc.search(/^##\s*§?6\.3\b/m);
const regEnd = regDoc.search(/^##\s*§?6\.4\b/m);
if (regStart === -1 || regEnd === -1) {
  console.log('  !! Cannot locate the register section (§6.3 .. §6.4).');
  console.log('     Checks [2] and [3] need that boundary to be meaningful.');
  problems++;
}
const regBody = (regStart !== -1 && regEnd !== -1)
  ? regDoc.slice(regStart, regEnd) : regDoc;

const rows = [];
const rowRe = /^\|\s*(\d+)\s*\|\s*\*\*(G-\d{3})\*\*\s*\|(.*)$/gm;
let m;
while ((m = rowRe.exec(regBody)) !== null) {
  rows.push({
    rank: parseInt(m[1], 10),
    id: m[2],
    cells: m[3].split('|').map(s => s.trim()),
    raw: m[0],
    line: regDoc.slice(0, regStart + m.index).split('\n').length
  });
}
console.log('  register section bounded ................. ' +
  (regStart !== -1 ? '§6.3 to §6.4' : 'NO — scanning whole file'));
console.log('  rows found ............................... ' + rows.length);

// Rank must be a contiguous 1..n permutation, or "Rank" means nothing.
const ranks = rows.map(r => r.rank).sort((a, b) => a - b);
const rankOk = ranks.every((v, i) => v === i + 1);
console.log('  ranks form a contiguous 1..n sequence .... ' + (rankOk ? 'yes' : 'NO'));
if (!rankOk) {
  const dup = ranks.filter((v, i) => ranks.indexOf(v) !== i);
  console.log('      duplicate ranks: ' + ([...new Set(dup)].join(', ') || 'none'));
  const miss = [];
  for (let i = 1; i <= rows.length; i++) if (!ranks.includes(i)) miss.push(i);
  console.log('      missing ranks:   ' + (miss.join(', ') || 'none'));
  problems++;
}

// the register's own stated total
const statedTotal = /(\d+)\s+canonical findings/.exec(regDoc);
if (statedTotal) {
  const n = parseInt(statedTotal[1], 10);
  const unique = new Set(rows.map(r => r.id)).size;
  const ok = n === unique;
  if (!ok) problems++;
  console.log('  register states ' + n + ' canonical findings ..... ' +
    (ok ? 'matches ' + unique + ' unique rows' : '!! ' + unique + ' unique rows found'));
}

// ---------------------------------------------------------------------------
// [2] ID integrity
// ---------------------------------------------------------------------------

console.log('\n[2] ID integrity');

const ids = rows.map(r => r.id);
const nums = ids.map(i => parseInt(i.slice(2), 10));
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
console.log('  duplicate IDs ............................ ' + dupes.length +
  (dupes.length ? '   !! ' + [...new Set(dupes)].join(', ') : ''));
if (dupes.length) problems++;

const max = Math.max(...nums);
const missing = [];
for (let i = 1; i <= max; i++) if (!nums.includes(i)) missing.push('G-' + String(i).padStart(3, '0'));
console.log('  highest ID ............................... G-' + String(max).padStart(3, '0'));
console.log('  gaps in the sequence ..................... ' + missing.length +
  (missing.length ? '   ' + missing.join(', ') : ''));
if (missing.length) {
  console.log('    A gap is acceptable ONLY if the register carries a');
  console.log('    tombstone row for the retired ID. Checking:');
  for (const g of missing) {
    const hasTomb = new RegExp(g + '[^\\n]*(retired|withdrawn|tombstone)', 'i').test(regDoc);
    console.log('      ' + g + '  tombstone present: ' + (hasTomb ? 'yes' : 'NO'));
    if (!hasTomb) problems++;
  }
}

// ---------------------------------------------------------------------------
// [3] severity blocks must match their rows
// ---------------------------------------------------------------------------

console.log('\n[3] Severity-block headings vs the rows beneath them');

const blocks = [];
const blockRe = /^#+\s*(Critical|High|Medium|Low|Informational|Constructive)\b[^\n]*?(\d+)\s+finding/gim;
while ((m = blockRe.exec(regBody)) !== null) {
  blocks.push({ sev: m[1], claimed: parseInt(m[2], 10), start: m.index });
}
blocks.forEach((b, i) => { b.end = i + 1 < blocks.length ? blocks[i + 1].start : regBody.length; });

if (!blocks.length) {
  console.log('  no severity blocks with a stated count were found.');
} else {
  console.log('  severity      stated   actual rows');
  console.log('  ' + '-'.repeat(44));
  let sum = 0;
  for (const b of blocks) {
    const seg = regBody.slice(b.start, b.end);
    const n = (seg.match(/^\|\s*\d+\s*\|\s*\*\*G-\d{3}\*\*/gm) || []).length;
    sum += n;
    const ok = n === b.claimed;
    if (!ok) problems++;
    console.log('  ' + (ok ? '  ' : '!!') + ' ' + b.sev.padEnd(14) +
      String(b.claimed).padStart(5) + String(n).padStart(13) +
      (ok ? '' : '   MISMATCH'));
  }
  console.log('  ' + '-'.repeat(44));
  console.log('     ' + 'sum of blocks'.padEnd(14) + '     ' + String(sum).padStart(13));
  const ok = sum === new Set(ids).size;
  if (!ok) problems++;
  console.log('     ' + 'unique rows'.padEnd(14) + '     ' +
    String(new Set(ids).size).padStart(13) + (ok ? '' : '   !! BLOCKS DO NOT COVER ALL ROWS'));
}

// ---------------------------------------------------------------------------
// [4] cross-document citation check — both directions
// ---------------------------------------------------------------------------

console.log('\n[4] Cross-document citations');

const cited = new Map();   // G-id -> [doc...]
for (const fn of DELIVERABLES) {
  const t = read(fn);
  if (!t) continue;
  for (const g of new Set(t.match(/\bG-\d{3}\b/g) || [])) {
    if (!cited.has(g)) cited.set(g, []);
    cited.get(g).push(fn.replace('.md', ''));
  }
}

const idSet = new Set(ids);
const citedNotInRegister = [...cited.keys()].filter(g => !idSet.has(g));
console.log('  distinct findings cited in the deliverables ......... ' + cited.size);
console.log('  cited but NOT in the register ............ ' + citedNotInRegister.length);
for (const g of citedNotInRegister) {
  console.log('      !! ' + g + '   cited by ' + cited.get(g).join(', '));
  problems++;
}

const orphans = ids.filter(g => !cited.has(g));
console.log('  in the register but cited nowhere ........ ' + orphans.length);
if (orphans.length) {
  console.log('    Not an error — a finding can be real and not yet');
  console.log('    referenced by a narrative document. Listed so the gap is');
  console.log('    visible rather than accidental:');
  for (const g of orphans) {
    const row = rows.find(r => r.id === g);
    const txt = (row.cells[0] || '').replace(/\*\*/g, '').replace(/`/g, '').slice(0, 58);
    console.log('      ' + g + '  ' + txt);
  }
}

// ---------------------------------------------------------------------------
// [5] continuity with Pass 6's register
// ---------------------------------------------------------------------------

console.log('\n[5] Continuity with GAP_CONSOLIDATION_PASS6.md §6.5');

const pass6 = read(PASS6);
if (!pass6) {
  console.log('  Pass 6 not found — skipping.');
} else {
  // Pass 6's own register puts the ID first; take IDs only from its §6.5.
  const p6s = pass6.search(/^## 6\.5 /m), p6e = pass6.search(/^## 6\.6 /m);
  const p6body = (p6s !== -1 && p6e !== -1) ? pass6.slice(p6s, p6e) : pass6;
  const p6ids = new Set([...p6body.matchAll(/^\|\s*\*\*(G-\d{3})\*\*/gm)].map(x => x[1]));
  const dropped = [...p6ids].filter(g => !idSet.has(g));
  const added = ids.filter(g => !p6ids.has(g));
  console.log('  findings in Pass 6 ....................... ' + p6ids.size);
  console.log('  findings in the register ................. ' + new Set(ids).size);
  console.log('  Pass 6 findings DROPPED ................. ' + dropped.length +
    (dropped.length ? '   !! ' + dropped.join(', ') : ''));
  if (dropped.length) {
    console.log('    A dropped finding must be a documented withdrawal, not');
    console.log('    an omission. Pass 6 IDs are cited in five deliverables.');
    problems++;
  }
  console.log('  findings ADDED since Pass 6 ............. ' + added.length +
    (added.length ? '   ' + added.join(', ') : ''));
  if (added.length) {
    console.log('    Each addition must appear above G-' + String(Math.min(...added.map(a => parseInt(a.slice(2), 10))) - 1).padStart(3, '0') +
      '\'s successor, i.e. be');
    console.log('    APPENDED rather than inserted, so no existing ID moves.');
    const minAdded = Math.min(...added.map(a => parseInt(a.slice(2), 10)));
    const maxP6 = Math.max(...[...p6ids].map(a => parseInt(a.slice(2), 10)));
    const appended = minAdded > maxP6;
    console.log('    appended, not inserted ............... ' + (appended ? 'yes' : 'NO — IDs have shifted'));
    if (!appended) problems++;
  }
}

// ---------------------------------------------------------------------------
// [6] BLOCKED findings must name a real decision
// ---------------------------------------------------------------------------

console.log('\n[6] BLOCKED findings');

const blockedRows = rows.filter(r => /BLOCKED/i.test(r.raw));
console.log('  rows marked BLOCKED ...................... ' + blockedRows.length);
const bdIds = new Set((regDoc.match(/\bBD-\d\b/g) || []));
for (const r of blockedRows) {
  const bd = r.raw.match(/BD-\d/g) || [];
  const ok = bd.length > 0;
  if (!ok) problems++;
  console.log('      ' + (ok ? '   ' : '!! ') + r.id + '  blocked on ' +
    (ok ? bd.join(', ') : 'NOTHING NAMED — a BLOCKED row must name its decision'));
}
console.log('  distinct BD-n referenced anywhere ........ ' + bdIds.size +
  '   ' + [...bdIds].sort().join(', '));
// All six decisions are defined in WORKFLOW_AND_BUSINESS_RULES §4.9. A
// decision that blocks nothing is fine; one that is never mentioned in the
// register is a reader dead-end when they follow a BLOCKED row's reasoning.
const allBd = new Set();
for (const fn of DELIVERABLES) {
  const t = read(fn);
  if (t) for (const b of (t.match(/\bBD-\d\b/g) || [])) allBd.add(b);
}
const bdMissing = [...allBd].filter(b => !bdIds.has(b)).sort();
console.log('  BD-n defined in the deliverables but absent here .... ' + bdMissing.length +
  (bdMissing.length ? '   ' + bdMissing.join(', ') : ''));
if (bdMissing.length) {
  console.log('    Not an error if the decision blocks no finding, but the');
  console.log('    register should say so rather than omit it silently.');
}

// ---------------------------------------------------------------------------
// [7] the cross-reference appendix
// ---------------------------------------------------------------------------

console.log('\n[7] The cross-reference appendix — every pass ID accounted for');

// The pass-ID namespaces issued by Passes 1-5.
const EXPECTED = []
  .concat([1, 2, 3, 4, 5].map(n => 'M-' + n))
  .concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => 'R-' + n))
  .concat(Array.from({ length: 14 }, (_, i) => 'D-' + (i + 1)))
  .concat([1, 2, 3, 4, 5].map(n => 'R-A' + n))
  .concat(Array.from({ length: 12 }, (_, i) => 'R-B' + (i + 1)))
  .concat([1, 2, 3, 4].map(n => 'R-C' + n))
  .concat(['R-D1'])
  .concat(Array.from({ length: 25 }, (_, i) => 'S-' + (i + 1)));

console.log('  pass IDs issued by Passes 1-5 ............ ' + EXPECTED.length);

const missingPass = [];
for (const pid of EXPECTED) {
  // word-boundary match that will not let R-1 match R-10 or R-A1
  const re = new RegExp('(?<![A-Za-z0-9-])' + pid + '(?![A-Za-z0-9])');
  if (!re.test(regDoc)) missingPass.push(pid);
}
console.log('  not mentioned anywhere in the register .... ' + missingPass.length +
  (missingPass.length ? '   !! ' + missingPass.join(', ') : ''));
if (missingPass.length) {
  console.log('    Every pass ID is cited in at least one earlier document.');
  console.log('    An unaccounted ID means a reader following a citation');
  console.log('    from Pass 1-5 hits a dead end.');
  problems++;
}

// ---------------------------------------------------------------------------
// [8] rank vs ID
// ---------------------------------------------------------------------------

console.log('\n[8] Rank and ID must be separate columns');

const hasRankCol = /\|\s*Rank\s*\|/i.test(regDoc);
console.log('  register has an explicit Rank column ..... ' + (hasRankCol ? 'yes' : 'NO'));
if (!hasRankCol) {
  console.log('    Pass 6 \u00a76.1.2 requires both a permanent G-NNN and a');
  console.log('    mutable Rank, because severity-ordered IDs are brittle');
  console.log('    after re-rating. Without a Rank column a reader will');
  console.log('    read the ID as the current severity order.');
  problems++;
}
const warnsAboutIt = /rank,? not ID|ID does not|permanent.*mutable|not renumber/i.test(regDoc);
console.log('  register warns ID \u2260 current severity ..... ' + (warnsAboutIt ? 'yes' : 'NO'));
if (!warnsAboutIt) problems++;

bar('=');
console.log('Structural problems detected ................. ' + problems);
if (problems === 0) {
  console.log('The register is internally consistent, continuous with Pass 6,');
  console.log('and every finding cited in the narrative deliverables resolves.');
}
console.log('Every check above is recomputed from the documents on each run.\n');
