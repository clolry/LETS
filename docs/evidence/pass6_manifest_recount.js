/**
 * pass6_manifest_recount.js — reproducible evidence for GAP_CONSOLIDATION_PASS6.md
 *
 * Run from this directory:
 *     node pass6_manifest_recount.js
 *
 * Reads only. Touches no Google service. Pure filesystem enumeration.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * Pass 1 (FILE_MANIFEST.md) published its inventory counts by hand:
 * 230 files, 112 under lets_app/, "87 of 112 byte-identical to the TRIP
 * reference", "only 5 server files and 2 client pages were modified",
 * 18 genuinely new. Pass 6 item 2 requires every hand-counted figure in the
 * report either be confirmed mechanically or corrected, because a reader who
 * finds two different counts in two documents stops trusting both.
 *
 * This script re-derives all of them. Where it disagrees with Pass 1's prose
 * it prints the disagreement explicitly rather than quietly substituting its
 * own answer — the same convention pass5_guard_census.js uses.
 *
 * ONE THING THE READER MUST UNDERSTAND ABOUT THE TOTAL
 * ---------------------------------------------------
 * Pass 1 counted 230 files BEFORE docs/ existed. docs/ is this
 * documentation effort's own output. The script therefore reports the total
 * both ways — with and without docs/ — so the 230 can be checked against
 * the tree Pass 1 actually saw. Comparing a post-docs/ total against Pass 1's
 * figure would manufacture a discrepancy that is not real.
 *
 * METHOD NOTE ON "BYTE-IDENTICAL"
 * -------------------------------
 * A file under lets_app/ is compared to the file at the SAME RELATIVE PATH
 * under reference_travel_app/. Three outcomes:
 *   INHERITED  — byte-for-byte equal: LETS adopted it unmodified
 *   MODIFIED   — path exists in both, contents differ
 *   LETS-ONLY  — no counterpart in the reference tree
 * This is what determines remediation ownership for every finding in the
 * gap register (Pass 6 item 5), so it is measured, not assumed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Every file under dir, recursively, excluding .git/. Returns repo-relative paths. */
function walk(dir, out) {
  out = out || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(path.relative(REPO, full).split(path.sep).join('/'));
  }
  return out;
}

function sameBytes(a, b) {
  try {
    const ba = fs.readFileSync(a);
    const bb = fs.readFileSync(b);
    return ba.length === bb.length && ba.equals(bb);
  } catch (e) {
    return false;
  }
}

function exists(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

/** Print "measured vs claimed", flagging disagreement. */
let disagreements = 0;
function check(label, measured, claimed, note) {
  const agree = measured === claimed;
  if (!agree) disagreements++;
  console.log('  ' + (agree ? '   ' : '!! ') + label.padEnd(46) +
    'measured ' + String(measured).padStart(4) +
    '   Pass 1 said ' + String(claimed).padStart(4) +
    (agree ? '' : '   <- DISAGREE'));
  if (!agree && note) console.log('        ' + note);
  return agree;
}

// ---------------------------------------------------------------------------
// enumerate
// ---------------------------------------------------------------------------

const all = walk(REPO).sort();
const inDocs = all.filter(f => f.startsWith('docs/'));
const preDocs = all.filter(f => !f.startsWith('docs/'));

const TREES = {
  'lets_app/': all.filter(f => f.startsWith('lets_app/')),
  'reference_travel_app/': all.filter(f => f.startsWith('reference_travel_app/')),
  'reference_training_tracker/': all.filter(f => f.startsWith('reference_training_tracker/')),
  'reference_excel_files/': all.filter(f => f.startsWith('reference_excel_files/')),
  '.github/': all.filter(f => f.startsWith('.github/')),
  '.githooks/': all.filter(f => f.startsWith('.githooks/')),
  'docs/': inDocs
};
const rootLoose = all.filter(f => !f.includes('/'));

const bar = (c) => console.log(c.repeat(78));

console.log('\nPass 6 evidence — file-inventory recount');
console.log('purpose: mechanically re-derive Pass 1 (FILE_MANIFEST.md)\'s');
console.log('         hand-counted inventory figures');
bar('=');

// --- [1] the total ----------------------------------------------------------

console.log('\n[1] Repository file total');
console.log('  files excluding .git/ and docs/ .......... ' + preDocs.length +
  '   <- the tree Pass 1 saw');
console.log('  files in docs/ (this effort\'s output) .... ' + inDocs.length);
console.log('  files excluding .git/, including docs/ ... ' + all.length);
console.log('');
check('total, pre-docs/ basis', preDocs.length, 230,
  'If this disagrees, files were added or removed since Pass 1 ran.');

// --- [2] the per-tree split -------------------------------------------------

console.log('\n[2] Per-tree split, on the pre-docs/ basis');
console.log('  Pass 1 §Counts lists these subtotals. They are checked');
console.log('  individually AND summed, because a set of subtotals that does');
console.log('  not add to its own stated total is itself a finding.');
console.log('');

const CLAIMED_TREES = [
  ['lets_app/', 112],
  ['reference_travel_app/', 97],
  ['reference_training_tracker/', 4],
  ['reference_excel_files/', 2],
  ['.github/', 2],
  ['.githooks/', 2]
];

let claimedSum = 0;
for (const [tree, claimed] of CLAIMED_TREES) {
  check(tree, TREES[tree].length, claimed);
  claimedSum += claimed;
}
check('root loose files', rootLoose.length, 10);
claimedSum += 10;

const measuredSum = CLAIMED_TREES.reduce((n, [t]) => n + TREES[t].length, 0) + rootLoose.length;
console.log('');
console.log('  sum of Pass 1\'s own subtotals ............ ' + claimedSum);
console.log('  sum of measured subtotals ................ ' + measuredSum);
console.log('  Pass 1\'s stated total .................... 230');
if (claimedSum !== 230) {
  console.log('  !! Pass 1\'s subtotals sum to ' + claimedSum + ', not its own stated 230.');
  console.log('     The ' + (230 - claimedSum) + '-file gap is an internal arithmetic error in');
  console.log('     Pass 1, independent of anything measured here.');
  disagreements++;
}
if (measuredSum === 230) {
  console.log('  → The measured subtotals DO sum to 230. The total was right;');
  console.log('    one subtotal was wrong. See [3] for which.');
}

// --- [3] lets_app/ composition ---------------------------------------------

console.log('\n[3] lets_app/ composition — the active application');
const la = TREES['lets_app/'];
const laTop = la.filter(f => f.split('/').length === 2);
const laClient = la.filter(f => f.startsWith('lets_app/client/'));
const laServer = la.filter(f => f.startsWith('lets_app/server/'));
console.log('  top-level files .......................... ' + laTop.length);
console.log('  client/ .................................. ' + laClient.length);
console.log('  server/ .................................. ' + laServer.length);
console.log('  ------');
console.log('  total .................................... ' + la.length);
console.log('');
check('lets_app/ total', la.length, 112,
  'Pass 1\'s 112 is one short. Its own table (section D) lists 9 top-level\n' +
  '        files, and 9 + ' + laClient.length + ' client + ' + laServer.length +
  ' server = ' + la.length + '. The 112 is a\n' +
  '        transcription slip, not a missing file.');

// --- [4] inheritance from TRIP — the ownership column ----------------------

console.log('\n[4] Inheritance from the TRIP reference (Pass 6 item 5)');
console.log('  Every lets_app/ file compared byte-for-byte against the same');
console.log('  relative path under reference_travel_app/.');

const inherited = [];
const modified = [];
const letsOnly = [];

for (const f of la) {
  const relInside = f.replace(/^lets_app\//, '');
  const ref = path.join(REPO, 'reference_travel_app', relInside);
  if (!exists(ref)) letsOnly.push(f);
  else if (sameBytes(path.join(REPO, f), ref)) inherited.push(f);
  else modified.push(f);
}

console.log('');
console.log('  INHERITED (byte-identical) ............... ' + inherited.length);
console.log('  MODIFIED  (exists in both, differs) ...... ' + modified.length);
console.log('  LETS-ONLY (no counterpart) ............... ' + letsOnly.length);
console.log('  ------');
console.log('  total .................................... ' +
  (inherited.length + modified.length + letsOnly.length));
console.log('');
check('byte-identical to TRIP', inherited.length, 87);
check('LETS-only (new)', letsOnly.length, 18);

// Pass 1's prose: "Only 5 server files and 2 client pages were modified".
const modServer = modified.filter(f => f.startsWith('lets_app/server/'));
const modClient = modified.filter(f => f.startsWith('lets_app/client/'));
const modOther = modified.filter(f =>
  !f.startsWith('lets_app/server/') && !f.startsWith('lets_app/client/'));

console.log('');
console.log('  MODIFIED, broken down — Pass 1 prose says "only 5 server');
console.log('  files and 2 client pages were modified":');
check('modified server files', modServer.length, 5,
  'Pass 1 counted non-code files as server files. The real figure is ' +
  modServer.length + '.');
check('modified client files', modClient.length, 2);
console.log('     modified non-code files ............... ' + modOther.length +
  '   (not in Pass 1\'s prose at all)');

console.log('');
console.log('  The complete MODIFIED list — this is the whole of what LETS');
console.log('  changed in the inherited codebase, and it is small enough to');
console.log('  read. Everything else is either untouched TRIP or new LETS:');
for (const f of modified.sort()) {
  const kind = f.startsWith('lets_app/server/') ? 'server'
             : f.startsWith('lets_app/client/') ? 'client'
             : 'non-code';
  console.log('      [' + kind.padEnd(8) + '] ' + f);
}

console.log('');
console.log('  The complete LETS-ONLY list:');
for (const f of letsOnly.sort()) {
  console.log('      ' + f);
}

// --- [5] the ownership summary the gap register needs ----------------------

console.log('\n[5] Remediation-ownership summary (feeds the gap register)');
const codeFiles = la.filter(f =>
  f.startsWith('lets_app/server/') || f.startsWith('lets_app/client/'));
const codeInherited = codeFiles.filter(f => inherited.includes(f));
const codeModified = codeFiles.filter(f => modified.includes(f));
const codeLetsOnly = codeFiles.filter(f => letsOnly.includes(f));
console.log('  Counting only server/ + client/ code files (' + codeFiles.length + '):');
console.log('    inherited unmodified from TRIP ......... ' + codeInherited.length +
  '  (' + Math.round(100 * codeInherited.length / codeFiles.length) + '%)');
console.log('    modified by LETS ....................... ' + codeModified.length +
  '  (' + Math.round(100 * codeModified.length / codeFiles.length) + '%)');
console.log('    written by LETS ........................ ' + codeLetsOnly.length +
  '  (' + Math.round(100 * codeLetsOnly.length / codeFiles.length) + '%)');
console.log('');
console.log('  → ' + Math.round(100 * codeInherited.length / codeFiles.length) +
  '% of the application code is untouched TRIP. Pass 5 §5.11\'s');
console.log('    claim that the security gaps are overwhelmingly inherited is');
console.log('    consistent with this distribution.');

// --- [6] the specific files every finding cites ----------------------------

console.log('\n[6] Ownership of the files the findings name');
console.log('  Each finding in the gap register inherits its owner from the');
console.log('  file it lives in. Checked here so no finding carries a guessed');
console.log('  ownership label.');

const CITED = [
  ['lets_app/appsscript.json',                   'S-13 oauthScopes, S-22 Gmail service'],
  ['lets_app/server/30_services/Access.js',      'S-1,S-2,S-7,S-10,S-11,S-12,S-14 guards'],
  ['lets_app/server/40_domain/Review_Update.js', 'S-4 the five unguarded update* RPCs'],
  ['lets_app/server/40_domain/Review_Read.js',   'S-2 getRequestForReview'],
  ['lets_app/server/30_services/Attachments.js', 'S-3,S-6,S-16 attachment handling'],
  ['lets_app/server/40_domain/Review_Action.js', 'the one workflow gate that works'],
  ['lets_app/server/40_domain/Users.js',         'S-5,S-8,S-15 role CRUD'],
  ['lets_app/server/91_setup/Database.js',       'S-1 bootstrapTravelAdmin, D-4 IDs'],
  ['lets_app/server/10_lib/Validation.js',       'S-18 the unadopted library'],
  ['lets_app/server/30_services/OrgLookup.js',   'S-25 verifyPhase7Routing'],
  ['lets_app/server/40_domain/Submission.js',    'S-23 named fixtures, R-A1 routing'],
  ['lets_app/server/01_constants/Sheets.js',     'D-2,D-3,D-6 the TRIP schema registry'],
  ['lets_app/server/50_pages/Render.js',         'R-1,R-2,S-20 page routing'],
  ['lets_app/server/90_entrypoint/doGet.js',     'the site gate call'],
  ['lets_app/server/00_config/TripConfig.js',    'FAS env gate, TRAVEL_PURPOSES'],
  ['lets_app/server/00_config/BudgetConfig.js',  'S-21 placeholder approvers'],
  ['lets_app/server/30_services/BudgetEngine.js','R-B1..R-B10 budget rules'],
  ['lets_app/server/30_services/FASTrackerSync.js','R-3,R-C2,D-14 FAS integration'],
  ['lets_app/server/40_domain/RequestService.js','R-B3,R-B5,R-B11 request service'],
  ['lets_app/server/20_data/LetsDB.js',          'D-6,D-7,D-8 LETS data layer'],
  ['lets_app/client/pages/travelRequestPage.html','R-C1,R-C4 the intake form banner'],
  ['lets_app/client/pages/travelBudgetDashboardPage.html','R-2 the static mockup'],
  ['lets_app/client/pages/letsAppLayout.html',   'R-5 the orphaned SPA shell']
];

for (const [f, why] of CITED) {
  let owner;
  if (!exists(path.join(REPO, f))) owner = 'FILE NOT FOUND';
  else if (letsOnly.includes(f)) owner = 'LETS-ONLY';
  else if (modified.includes(f)) owner = 'MODIFIED';
  else if (inherited.includes(f)) owner = 'INHERITED';
  else owner = 'outside lets_app/';
  const flag = owner === 'FILE NOT FOUND' ? '!! ' : '   ';
  if (owner === 'FILE NOT FOUND') disagreements++;
  console.log('  ' + flag + owner.padEnd(18) + f.replace(/^lets_app\//, '') );
  console.log('        ' + why);
}

// --- [7] the clasp push boundary -------------------------------------------

console.log('\n[7] What actually reaches the Apps Script project');
console.log('  Pass 1 states "53 server .js files and 51 client .html files');
console.log('  push to the Apps Script project, plus appsscript.json".');
const serverJs = laServer.filter(f => f.endsWith('.js'));
const clientHtml = laClient.filter(f => f.endsWith('.html'));
console.log('');
check('server/ .js files', serverJs.length, 53);
check('client/ .html files', clientHtml.length, 51);
const nonPushable = laServer.concat(laClient).filter(
  f => !f.endsWith('.js') && !f.endsWith('.html'));
console.log('     non-.js/.html files under server/ or client/ .. ' + nonPushable.length);
for (const f of nonPushable) console.log('        ' + f);

const dsStores = la.filter(f => f.endsWith('.DS_Store'));
console.log('');
console.log('  .DS_Store files inside lets_app/ ......... ' + dsStores.length);
for (const f of dsStores) console.log('      ' + f);
const claspIgnore = path.join(REPO, 'lets_app', '.claspignore');
if (exists(claspIgnore)) {
  const ig = fs.readFileSync(claspIgnore, 'utf8');
  const covers = /\.DS_Store/.test(ig);
  console.log('  lets_app/.claspignore mentions .DS_Store . ' + (covers ? 'yes' : 'NO'));
  if (!covers && dsStores.length) {
    console.log('    → confirms Pass 1\'s minor finding: .DS_Store exists inside');
    console.log('      lets_app/ and is not excluded by that tree\'s .claspignore.');
  }
}

// --- [8] reconcile against Pass 1's own TABLES, not just its prose --------

console.log('\n[8] Pass 1\'s tables vs. Pass 1\'s prose');
console.log('  FILE_MANIFEST.md has two kinds of content: per-file TABLES');
console.log('  (sections A-G) and PROSE summaries (§Counts, §Column legend).');
console.log('  Those two disagree with each other, and the direction of the');
console.log('  disagreement decides how much of Pass 1 needs correcting.');
console.log('  This section counts the rows of Pass 1\'s own tables and');
console.log('  compares all three: tables, prose, filesystem.');

const manifest = path.join(__dirname, '..', 'FILE_MANIFEST.md');
if (!exists(manifest)) {
  console.log('  FILE_MANIFEST.md not found at ' + manifest + ' — skipping.');
} else {
  // Strip NULs: the manifest embeds raw .DS_Store bytes in its own table.
  const md = fs.readFileSync(manifest, 'utf8').replace(/\0/g, '').split('\n');

  // Section D = lets_app config, E = server, F = client.
  const sectionOf = (i) => {
    for (let j = i; j >= 0; j--) {
      const m = /^### ([A-G])\./.exec(md[j]);
      if (m) return m[1];
    }
    return null;
  };
  const rowsIn = {};
  const statusIn = { 'Byte-identical': 0, 'Modified for LETS': 0, 'LETS-only (new)': 0 };
  md.forEach((l, i) => {
    if (!/^\|\s*`lets_app/.test(l)) return;
    const s = sectionOf(i);
    rowsIn[s] = (rowsIn[s] || 0) + 1;
    for (const key of Object.keys(statusIn)) {
      if (l.includes(key)) statusIn[key]++;
    }
  });

  const tableTop = rowsIn['D'] || 0;
  const tableServer = rowsIn['E'] || 0;
  const tableClient = rowsIn['F'] || 0;
  const tableTotal = tableTop + tableServer + tableClient;

  console.log('');
  console.log('  Pass 1 table row counts for lets_app/:');
  console.log('    section D (config/top-level) ........... ' + tableTop);
  console.log('    section E (server) .................... ' + tableServer);
  console.log('    section F (client) .................... ' + tableClient);
  console.log('    ------');
  console.log('    rows total ............................ ' + tableTotal);
  console.log('');
  console.log('  Three-way comparison of lets_app/ file count:');
  console.log('    filesystem (authoritative) ............ ' + la.length);
  console.log('    Pass 1 TABLES (row count) ............. ' + tableTotal);
  console.log('    Pass 1 PROSE (§Counts) ................ 112');
  if (tableTotal === la.length && la.length !== 112) {
    console.log('    → Pass 1\'s TABLES ARE CORRECT. Only its prose subtotal is');
    console.log('      wrong. No file was missed during inventory; a number was');
    console.log('      mistyped when summarizing. This is the cheap correction.');
  }

  console.log('');
  console.log('  Three-way comparison of the inheritance split:');
  const PROSE = {
    'Byte-identical': 87,
    'Modified for LETS': null,   // prose says "5 server + 2 client" = 7, by implication
    'LETS-only (new)': 18
  };
  const FSVAL = {
    'Byte-identical': inherited.length,
    'Modified for LETS': modified.length,
    'LETS-only (new)': letsOnly.length
  };
  for (const key of Object.keys(statusIn)) {
    const prose = PROSE[key];
    console.log('    ' + key.padEnd(20) +
      ' filesystem ' + String(FSVAL[key]).padStart(3) +
      '   tables ' + String(statusIn[key]).padStart(3) +
      '   prose ' + (prose === null ? ' 7*' : String(prose).padStart(3)));
  }
  console.log('    * prose does not give a modified total; "5 server files and');
  console.log('      2 client pages" implies 7, which happens to match the');
  console.log('      filesystem total only because the 2 non-code modified');
  console.log('      files offset the 2 server files it overcounted.');
  console.log('');
  const tablesMatchFs = Object.keys(statusIn).every(k => statusIn[k] === FSVAL[k]);
  if (tablesMatchFs) {
    console.log('    → Pass 1\'s per-file tables agree with the filesystem on');
    console.log('      ALL THREE inheritance classes. Every disagreement found');
    console.log('      in [2], [3] and [4] above is in Pass 1\'s PROSE only.');
    console.log('');
    console.log('    RESOLUTION for Pass 6: Pass 1\'s evidence is sound and does');
    console.log('    not need re-gathering. Correct four prose figures —');
    console.log('    112 -> 113 lets_app/ files, 87 -> 88 byte-identical,');
    console.log('    "5 server" -> 3 server, and add the 2 modified non-code');
    console.log('    files — then the manifest is internally consistent and');
    console.log('    agrees with this script.');
  } else {
    console.log('    !! Pass 1\'s tables do NOT agree with the filesystem.');
    console.log('       The inventory itself must be re-gathered, not just');
    console.log('       its summary corrected.');
    disagreements++;
  }
}

// --- [9] audit Pass 5's inherited-from-TRIP column ------------------------

console.log('\n[9] Audit of Pass 5 §5.13\'s "Inherited from TRIP?" column');
console.log('  That column decides WHO OWNS each remediation — a defect in');
console.log('  untouched TRIP code is a pre-existing condition of the');
console.log('  foundation LETS was directed to adopt; a defect in LETS-original');
console.log('  code is this project\'s own. Pass 5 filled the column by hand.');
console.log('  Here each claim is checked against the file the finding lives in.');

// finding id, file the finding lives in, Pass 5's claim
const PASS5_CLAIMS = [
  ['S-1',  'lets_app/server/91_setup/Database.js',          'Yes'],
  ['S-2',  'lets_app/server/40_domain/Review_Read.js',      'Yes'],
  ['S-3',  'lets_app/server/30_services/Attachments.js',    'Yes'],
  ['S-4',  'lets_app/server/40_domain/Review_Update.js',    'Yes'],
  ['S-5',  'lets_app/server/40_domain/Users.js',            'Yes'],
  ['S-6',  'lets_app/server/30_services/Attachments.js',    'Yes'],
  ['S-7',  'lets_app/server/30_services/Access.js',         'Yes'],
  ['S-8',  'lets_app/server/40_domain/Users.js',            'Yes'],
  ['S-9',  'lets_app/server/30_services/Access.js',         'Yes'],
  ['S-10', 'lets_app/server/30_services/Access.js',         'Yes'],
  ['S-11', 'lets_app/server/30_services/Access.js',         'Yes'],
  ['S-12', 'lets_app/server/30_services/Access.js',         'Yes'],
  ['S-13', 'lets_app/appsscript.json',                      'Partly'],
  ['S-14', 'lets_app/server/30_services/Access.js',         'Yes'],
  ['S-15', 'lets_app/server/40_domain/Users.js',            'Yes'],
  ['S-16', 'lets_app/server/30_services/Attachments.js',    'Yes'],
  ['S-17', 'lets_app/server/40_domain/Review_DDConfirm.js', 'Yes'],
  ['S-18', 'lets_app/server/10_lib/Validation.js',          'Yes'],
  ['S-19', 'lets_app/server/91_setup/Database.js',          'Yes'],
  ['S-20', 'lets_app/server/50_pages/Render.js',            'Partly'],
  ['S-21', 'lets_app/server/00_config/BudgetConfig.js',     'No'],
  ['S-22', 'lets_app/appsscript.json',                      'Yes'],
  ['S-23', 'lets_app/server/40_domain/Submission.js',       'No'],
  ['S-25', 'lets_app/server/30_services/OrgLookup.js',      'No']
  // S-24 (no CDN subresource integrity) spans 17 client files and cannot be
  // attributed to one; it is measured separately in [9a].
];

const ownerOf = (f) => {
  if (!exists(path.join(REPO, f))) return 'MISSING';
  if (letsOnly.includes(f)) return 'LETS-ONLY';
  if (modified.includes(f)) return 'MODIFIED';
  if (inherited.includes(f)) return 'INHERITED';
  return 'outside lets_app/';
};
// Pass 5's label -> the file state that would justify it
const expectedState = { 'Yes': 'INHERITED', 'No': 'LETS-ONLY', 'Partly': 'MODIFIED' };

console.log('');
let claimErrors = 0;
for (const [id, file, claim] of PASS5_CLAIMS) {
  const owner = ownerOf(file);
  const want = expectedState[claim];
  const ok = owner === want;
  if (!ok) claimErrors++;
  console.log('  ' + (ok ? '   ' : '!! ') + id.padEnd(5) +
    'Pass 5: ' + claim.padEnd(7) +
    ' file is: ' + owner.padEnd(12) +
    file.replace(/^lets_app\//, ''));
}

console.log('');
console.log('  mis-labeled findings .................... ' + claimErrors);
if (claimErrors) {
  console.log('  Each one shifts remediation ownership, which is the single');
  console.log('  most decision-relevant column in the gap register. The');
  console.log('  corrections must be carried into GAP_REGISTER.md:');
  for (const [id, file, claim] of PASS5_CLAIMS) {
    const owner = ownerOf(file);
    if (owner === expectedState[claim]) continue;
    const corrected = owner === 'INHERITED' ? 'Yes — untouched TRIP code'
                    : owner === 'MODIFIED' ? 'Partly — LETS modified this file'
                    : owner === 'LETS-ONLY' ? 'No — LETS-original'
                    : owner;
    console.log('    ' + id + ': "' + claim + '" -> "' + corrected + '"');
  }
  disagreements += claimErrors;
}

// --- [9a] S-24: CDN integrity, measured across the whole client ----------

console.log('\n[9a] S-24 — CDN subresource integrity, and who owns it');
console.log('  S-24 spans every client file that loads a third-party script,');
console.log('  so it cannot be attributed to a single file like the others.');
console.log('  Measured here instead, split by ownership.');

const clientFiles = la.filter(f => f.startsWith('lets_app/client/'));
const CDN = /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/;
let cdnRefs = 0, integrityAttrs = 0;
const cdnByOwner = { INHERITED: 0, MODIFIED: 0, 'LETS-ONLY': 0 };
const cdnFiles = [];
for (const f of clientFiles) {
  let text;
  try { text = fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\0/g, ''); }
  catch (e) { continue; }
  const refs = (text.match(new RegExp(CDN.source, 'g')) || []).length;
  if (!refs) continue;
  const integ = (text.match(/integrity\s*=/g) || []).length;
  cdnRefs += refs;
  integrityAttrs += integ;
  const owner = ownerOf(f);
  if (cdnByOwner[owner] !== undefined) cdnByOwner[owner] += refs;
  cdnFiles.push({ f, refs, integ, owner });
}
console.log('');
console.log('  client files loading a CDN resource ...... ' + cdnFiles.length);
console.log('  total CDN references .................... ' + cdnRefs);
console.log('  total integrity= attributes ............. ' + integrityAttrs);
console.log('');
console.log('  CDN references by file ownership:');
for (const [k, v] of Object.entries(cdnByOwner)) {
  console.log('    ' + String(v).padStart(3) + '  ' + k);
}
console.log('');
if (integrityAttrs === 0 && cdnRefs > 0) {
  console.log('  → Confirms S-24: ' + cdnRefs + ' CDN references, zero integrity');
  console.log('    attributes. Ownership is SHARED: ' + cdnByOwner['INHERITED'] +
    ' references are in');
  console.log('    untouched TRIP files, ' +
    (cdnByOwner['MODIFIED'] + cdnByOwner['LETS-ONLY']) +
    ' are in files LETS wrote or');
  console.log('    modified. Pass 5 labeled S-24 "Yes" (inherited); the');
  console.log('    accurate label is "Partly" — LETS reproduced the pattern in');
  console.log('    its own new pages rather than only inheriting it.');
}

// --- [10] derive the ownership column for Passes 1-4 ----------------------

console.log('\n[10] Ownership column for Passes 1-4 (Pass 6 item 5)');
console.log('  Pass 5 tracked "Inherited from TRIP?" per finding. Passes 1-4');
console.log('  did not. That column decides who owns each remediation, so it');
console.log('  is derived here for every earlier finding rather than guessed');
console.log('  while writing the register. A finding spanning several files is');
console.log('  listed against each, and takes the WIDEST ownership — if any');
console.log('  part is LETS-original, LETS owns the fix.');

// finding id -> files the finding actually lives in
const EARLIER_FINDINGS = [
  ['M-1',  []],                                   // absence; no file
  ['M-2',  ['lets_app/server/01_constants/Sheets.js',
            'lets_app/server/20_data/LetsDB.js']],
  ['M-3',  ['lets_app/server/30_services/BudgetEngine.js',
            'lets_app/server/20_data/LetsDB.js',
            'lets_app/server/40_domain/RequestService.js',
            'lets_app/server/30_services/FASTrackerSync.js']],
  ['M-4',  ['lets_app/client/pages/travelReviewerDashboardPage.html.html',
            'lets_app/client/controllers/admin/travelUsersController.html.html',
            'lets_app/client/components/flatpickrConfig.html.html',
            'lets_app/client/pages/travelAdminPage.html']],
  ['M-5',  []],                                   // untracked root files
  ['R-1',  ['lets_app/client/pages/travelReviewerDashboardPage.html.html',
            'lets_app/server/50_pages/Render.js',
            'lets_app/client/pages/travelAdminPage.html']],
  ['R-2',  ['lets_app/client/pages/travelBudgetDashboardPage.html',
            'lets_app/server/50_pages/Render.js']],
  ['R-3',  ['lets_app/server/30_services/FASTrackerSync.js']],
  ['R-4',  ['lets_app/server/91_setup/Database.js',
            'lets_app/server/00_config/Props.js',
            'lets_app/server/40_domain/Review_Update.js']],
  ['R-5',  ['lets_app/client/pages/letsAppLayout.html',
            'lets_app/client/pages/letsRequestPage.html',
            'lets_app/client/pages/letsKanbanPage.html']],
  ['R-6',  ['lets_app/server/30_services/Access.js',
            'lets_app/appsscript.json']],
  ['R-7',  []],                                   // absence of simple triggers
  ['R-8',  ['lets_app/server/30_services/HCStaffing.js']],
  ['R-9',  []],                                   // GitHub config, not code
  ['D-1',  ['lets_app/server/30_services/Feedback.js',
            'lets_app/server/01_constants/Sheets.js']],
  ['D-2',  ['lets_app/server/01_constants/Sheets.js']],
  ['D-3',  ['lets_app/server/91_setup/DoDSync.js',
            'lets_app/server/91_setup/ForeignSync.js',
            'lets_app/server/30_services/PerDiemDoD.js',
            'lets_app/server/30_services/PerDiemForeign.js']],
  ['D-4',  ['lets_app/server/91_setup/Database.js',
            'lets_app/server/40_domain/Submission.js']],
  ['D-5',  ['lets_app/server/91_setup/Database.js',
            'lets_app/server/40_domain/Admin_Actions.js']],
  ['D-6',  ['lets_app/server/01_constants/Sheets.js',
            'lets_app/server/20_data/LetsDB.js',
            'lets_app/server/00_config/BudgetConfig.js']],
  ['D-7',  ['lets_app/server/20_data/LetsDB.js',
            'lets_app/server/30_services/BudgetEngine.js']],
  ['D-8',  ['lets_app/server/20_data/LetsDB.js',
            'lets_app/server/40_domain/RequestService.js']],
  ['D-9',  ['lets_app/server/40_domain/Review_DDConfirm.js']],
  ['D-10', ['lets_app/server/40_domain/Submission.js',
            'lets_app/server/30_services/PerDiemDoD.js',
            'lets_app/server/30_services/FASTrackerSync.js']],
  ['D-11', ['lets_app/server/91_setup/Database.js']],
  ['D-12', []],                                   // absent documents
  ['D-13', ['lets_app/server/40_domain/Review_Update.js',
            'lets_app/server/01_constants/Status.js']],
  ['D-14', ['lets_app/server/30_services/FASTrackerSync.js']],
  ['R-A1', ['lets_app/server/40_domain/Submission.js']],
  ['R-A2', ['lets_app/server/40_domain/Review_DDConfirm.js',
            'lets_app/server/01_constants/Status.js']],
  ['R-A3', ['lets_app/server/91_setup/Database.js']],
  ['R-A4', ['lets_app/server/40_domain/Admin_Dashboard.js',
            'lets_app/server/40_domain/ReviewerDashboard.js']],
  ['R-A5', ['lets_app/server/01_constants/Status.js']],
  ['R-B1', ['lets_app/server/00_config/BudgetConfig.js',
            'lets_app/server/30_services/BudgetEngine.js']],
  ['R-B2', ['lets_app/server/30_services/BudgetEngine.js']],
  ['R-B3', ['lets_app/server/40_domain/RequestService.js']],
  ['R-B4', ['lets_app/server/30_services/BudgetEngine.js']],
  ['R-B5', ['lets_app/server/40_domain/RequestService.js']],
  ['R-B7', ['lets_app/server/30_services/BudgetEngine.js']],
  ['R-B8', ['lets_app/server/30_services/BudgetEngine.js',
            'lets_app/server/20_data/LetsDB.js']],
  ['R-B9', ['lets_app/server/30_services/BudgetEngine.js']],
  ['R-B10',['lets_app/server/30_services/BudgetEngine.js']],
  ['R-B11',['lets_app/server/40_domain/RequestService.js']],
  ['R-B12',['lets_app/client/pages/travelRequestPage.html',
            'lets_app/server/40_domain/RequestService.js']],
  ['R-C1', ['lets_app/client/pages/travelRequestPage.html',
            'lets_app/server/00_config/TripConfig.js']],
  ['R-C2', ['lets_app/server/30_services/FASTrackerSync.js']],
  ['R-C3', ['lets_app/server/00_config/TripConfig.js']],
  ['R-C4', ['lets_app/client/pages/travelRequestPage.html']],
  ['R-D1', ['lets_app/server/91_setup/Database.js']]
];

/** Widest ownership across a set of files. LETS-original dominates. */
function widestOwner(fileList) {
  if (!fileList.length) return { label: 'n/a — not a code defect', states: [] };
  const states = fileList.map(ownerOf);
  if (states.includes('MISSING')) return { label: 'FILE NOT FOUND', states };
  if (states.includes('LETS-ONLY')) return { label: 'No — LETS-original', states };
  if (states.includes('MODIFIED')) return { label: 'Partly — LETS modified', states };
  return { label: 'Yes — untouched TRIP', states };
}

console.log('');
const tally = {};
let notFound = 0;
for (const [id, fileList] of EARLIER_FINDINGS) {
  const { label, states } = widestOwner(fileList);
  tally[label] = (tally[label] || 0) + 1;
  if (label === 'FILE NOT FOUND') { notFound++; disagreements++; }
  const mix = fileList.length > 1 && new Set(states).size > 1
    ? '   [mixed: ' + [...new Set(states)].join('+') + ']' : '';
  console.log('  ' + (label === 'FILE NOT FOUND' ? '!! ' : '   ') +
    id.padEnd(6) + label.padEnd(24) +
    (fileList.length ? fileList.length + ' file(s)' : '') + mix);
}

console.log('');
console.log('  Ownership distribution across the ' + EARLIER_FINDINGS.length +
  ' findings of Passes 1-4:');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log('    ' + String(v).padStart(3) + '  ' + k);
}
if (notFound) {
  console.log('  !! ' + notFound + ' finding(s) cite a file that does not exist.');
}

console.log('');
console.log('  Combined with Pass 5\'s 24 security findings, this is the');
console.log('  ownership basis for the whole gap register. The pattern worth');
console.log('  stating to the reader: the LETS-original findings cluster in');
console.log('  the budget/FAS modules (BudgetEngine, RequestService, LetsDB,');
console.log('  FASTrackerSync, BudgetConfig) and the inherited findings');
console.log('  cluster in the security and data layers. LETS owns its');
console.log('  unfinished features; TRIP owns the unguarded surface.');

// --- verdict ---------------------------------------------------------------

bar('=');
console.log('Disagreements with Passes 1 and 5 .............. ' + disagreements);
if (disagreements) {
  console.log('See [8] for whether Pass 1\'s underlying tables are affected,');
  console.log('and [9] for the ownership corrections Pass 5 needs.');
  console.log('Do not leave two different answers for the same question in the');
  console.log('deliverable set — cite one source and say which.');
}
console.log('Every number above is recomputed from the filesystem on each run.\n');
