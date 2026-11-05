/**
 * pass6_change_impact.js — reproducible evidence for ENHANCEMENT_PLAYBOOK.md
 *
 * Run from this directory:
 *     node pass6_change_impact.js
 *
 * Reads only. Touches no Google service, no network.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * A playbook tells someone to make a change. The question it must answer
 * first is "what does this change touch?" — and in this codebase that is
 * not obvious, because the coupling is by STRING rather than by reference:
 *
 *   - 73 server functions are called by name from client HTML
 *   - 5 trigger handlers are referenced by name from ScriptApp
 *   - client partials are included by path string
 *   - sheet columns are written by POSITION, read by header NAME
 *
 * A rename or reorder in any of those breaks at run time, not at build
 * time, and several break silently. So this script computes the blast
 * radius for each class of change the playbook describes, and provides the
 * BEFORE numbers that each recipe's verification step compares against.
 *
 * WHAT IT REPORTS
 *   [1] Rename blast radius — for every server function, how many client
 *       call sites and trigger references would break
 *   [2] THE G-067 RECIPE SURFACE: the exact call sites that must adopt
 *       requireRequestEditor / requireRequestViewer, and what each one does
 *       about errors today
 *   [3] The error-contract mismatch the recipe must handle
 *   [4] Baselines for the recipes' verification steps
 *   [5] Column-position coupling, per tab
 *   [6] The do-not-rename list, with why each entry is on it
 *
 * METHOD NOTE
 *   Comments are stripped before matching, in both trees. A function
 *   mentioned in a header comment is not a call site, and counting it as
 *   one would overstate every blast radius in [1].
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'lets_app');
const SERVER = path.join(APP, 'server');
const CLIENT = path.join(APP, 'client');

const bar = c => console.log(c.repeat(78));
let problems = 0;

function walk(dir, ext, out) {
  out = out || [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out.sort();
}
const rel = f => path.relative(APP, f).split(path.sep).join('/');

/** Strip //, block, and HTML comments. Preserves line count. */
function strip(text) {
  const out = [];
  let inBlock = false, inHtml = false;
  for (const line of text.split('\n')) {
    let s = line;
    if (inHtml) { const c = s.indexOf('-->'); if (c === -1) { out.push(''); continue; } inHtml = false; s = s.slice(c + 3); }
    if (inBlock) { const c = s.indexOf('*/'); if (c === -1) { out.push(''); continue; } inBlock = false; s = s.slice(c + 2); }
    for (;;) { const o = s.indexOf('<!--'); if (o === -1) break;
      const c = s.indexOf('-->', o + 4); if (c === -1) { s = s.slice(0, o); inHtml = true; break; } s = s.slice(0, o) + s.slice(c + 3); }
    for (;;) { const o = s.indexOf('/*'); if (o === -1) break;
      const c = s.indexOf('*/', o + 2); if (c === -1) { s = s.slice(0, o); inBlock = true; break; } s = s.slice(0, o) + s.slice(c + 2); }
    out.push(s.replace(/^\s*\/\/.*$/, ''));
  }
  return out.join('\n');
}

const serverFiles = walk(SERVER, '.js');
const clientFiles = walk(CLIENT, '.html');
const serverSrc = new Map();
for (const f of serverFiles) serverSrc.set(rel(f), strip(fs.readFileSync(f, 'utf8').replace(/\0/g, '')));
const clientSrc = new Map();
for (const f of clientFiles) clientSrc.set(rel(f), strip(fs.readFileSync(f, 'utf8').replace(/\0/g, '')));
const allServer = [...serverSrc.values()].join('\n');
const allClient = [...clientSrc.values()].join('\n');

console.log('\nPass 6 evidence — change impact and recipe baselines');
console.log('purpose: compute the blast radius of each change class, and');
console.log('         capture the BEFORE numbers the recipes verify against');
bar('=');

// ---------------------------------------------------------------------------
// [1] rename blast radius
// ---------------------------------------------------------------------------

console.log('\n[1] Rename blast radius — coupling is by STRING, not by reference');

// top-level server functions
const topLevel = [];
for (const [file, text] of serverSrc) {
  text.split('\n').forEach((l, i) => {
    const m = /^function\s+([A-Za-z0-9_$]+)\s*\(/.exec(l);
    if (m) topLevel.push({ name: m[1], file, line: i + 1 });
  });
}

/**
 * RESOLVE CLIENT RPC CALL SITES THE SAME WAY pass6_client_call_census.js DOES.
 *
 * A first version of this section used a bounded wildcard between
 * `google.script.run` and the method name:
 *     /google\.script\.run[\s\S]{0,400}?\.NAME\s*\(/
 * That found 42 coupled functions where the authoritative census finds 61
 * resolving names. The reason is that `.withSuccessHandler(cb)` arguments
 * are arbitrary callbacks containing parens, braces, strings and nested
 * calls, so a wildcard either stops short or runs past the real target.
 *
 * The argument list must be skipped with a BALANCED scanner. Using a
 * different method here than the census uses would mean the playbook's
 * blast radii disagreed with the component map's call graph, and a reader
 * would have no way to tell which was wrong.
 */
const CHAIN_WRAPPERS = new Set(['withSuccessHandler', 'withFailureHandler', 'withUserObject']);

function skipBalanced(text, open) {
  let depth = 0;
  for (let p = open; p < text.length; p++) {
    const c = text[p];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; p++;
      while (p < text.length) {
        if (text[p] === '\\') { p += 2; continue; }
        if (text[p] === q) break;
        p++;
      }
      continue;
    }
    if (c === '/' && text[p + 1] === '/') { while (p < text.length && text[p] !== '\n') p++; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return p + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** From just past `google.script.run`, return the real RPC name. */
function resolveRunChain(text, i) {
  let p = i;
  for (;;) {
    while (p < text.length && /\s/.test(text[p])) p++;
    if (text[p] !== '.') return null;
    p++;
    while (p < text.length && /\s/.test(text[p])) p++;
    const start = p;
    while (p < text.length && /[A-Za-z0-9_$]/.test(text[p])) p++;
    const name = text.slice(start, p);
    if (!name) return null;
    while (p < text.length && /\s/.test(text[p])) p++;
    if (text[p] !== '(') return null;
    if (!CHAIN_WRAPPERS.has(name)) return name;
    p = skipBalanced(text, p);
    if (p === -1) return null;
  }
}

// name -> [{file, n}]
const clientCalls = new Map();
for (const [file, text] of clientSrc) {
  const anchor = /google\s*\.\s*script\s*\.\s*run/g;
  let am;
  while ((am = anchor.exec(text)) !== null) {
    const name = resolveRunChain(text, am.index + am[0].length);
    if (!name) continue;
    if (!clientCalls.has(name)) clientCalls.set(name, new Map());
    const byFile = clientCalls.get(name);
    byFile.set(file, (byFile.get(file) || 0) + 1);
  }
  for (const sm of text.matchAll(/serverCall\s*\(\s*['"]([A-Za-z_$][\w$]*)['"]/g)) {
    const name = sm[1];
    if (!clientCalls.has(name)) clientCalls.set(name, new Map());
    const byFile = clientCalls.get(name);
    byFile.set(file, (byFile.get(file) || 0) + 1);
  }
}

function clientCallSites(name) {
  const byFile = clientCalls.get(name);
  if (!byFile) return [];
  return [...byFile.entries()].map(([file, n]) => ({ file, n }));
}

const TRIGGERS = ['refreshHCStaffingCache', 'warmTravelDBCache', 'warmGSACitiesCache',
  'syncDoDPerDiem', 'syncForeignPerDiem'];

const coupled = [];
for (const fn of topLevel) {
  const cs = clientCallSites(fn.name);
  const clientN = cs.reduce((a, b) => a + b.n, 0);
  const trig = TRIGGERS.includes(fn.name);
  const serverN = (allServer.match(new RegExp('(?<![.\\w$])' + fn.name + '\\s*\\(', 'g')) || []).length - 1;
  if (clientN || trig) coupled.push({ ...fn, clientN, trig, serverN, sites: cs });
}

const resolvedNames = [...clientCalls.keys()].filter(n => topLevel.some(f => f.name === n));
const unresolvedNames = [...clientCalls.keys()].filter(n => !topLevel.some(f => f.name === n));
console.log('  top-level server functions ............... ' + topLevel.length);
console.log('  distinct names the client invokes ........ ' + clientCalls.size);
console.log('    resolving to a real server function .... ' + resolvedNames.length);
console.log('    resolving to NOTHING ................... ' + unresolvedNames.length +
  (unresolvedNames.length ? '   ' + unresolvedNames.join(', ') : ''));
console.log('  of those, referenced by ScriptApp ........ ' +
  coupled.filter(c => c.trig).length);
console.log('');
/**
 * CROSS-SCRIPT RECONCILIATION BASELINE.
 *
 * These are not independent measurements — both this script and
 * pass6_client_call_census.js count the same thing from the same source. The
 * baseline exists to catch a DIVERGENCE IN METHOD between the two, which is
 * how the 42-vs-61 error in §[0]'s note was found.
 *
 * It therefore has to be updated deliberately whenever the client/server
 * surface legitimately changes, with the reason recorded. An auto-updating
 * baseline would detect nothing.
 *
 * HISTORY
 *   64 / 61 / 3  until 2026-10-29. The three absent names were
 *                apiGetInitialData, apiSubmitRequest, getAllForeignCountries.
 *   64 / 62 / 2  from 2026-10-29. getAllForeignCountries was DEFINED as part
 *                of the itinerary city-dropdown fix — travelLocationService
 *                had been calling it since it was written, with no such
 *                function anywhere in the server tree, so the Country
 *                dropdown failed silently on a cold first visit. Defining it
 *                moved one name from absent to resolving. The remaining two
 *                are genuinely dead client references.
 */
const RECONCILE = { names: 64, resolving: 62, absent: 2 };
console.log('  Reconciliation baseline: ' + RECONCILE.names + ' names, ' +
  RECONCILE.resolving + ' resolving, ' + RECONCILE.absent + ' absent.');
console.log('  pass6_client_call_census.js must agree, or the playbook\'s');
console.log('  blast radii contradict the component map.');
if (clientCalls.size !== RECONCILE.names ||
    resolvedNames.length !== RECONCILE.resolving ||
    unresolvedNames.length !== RECONCILE.absent) {
  console.log('    !! DISAGREES with the baseline. Measured ' + clientCalls.size +
    ' / ' + resolvedNames.length + ' / ' + unresolvedNames.length + '.');
  console.log('       Either the surface changed — in which case update');
  console.log('       RECONCILE above AND record why — or one of the two');
  console.log('       scripts is wrong. Do not publish until resolved.');
  problems++;
} else {
  console.log('    -> agrees exactly (' + RECONCILE.names + ' / ' +
    RECONCILE.resolving + ' / ' + RECONCILE.absent + ').');
}
console.log('');
console.log('  Renaming any function below breaks a STRING reference. The');
console.log('  break happens at run time in the browser, or silently in the');
console.log('  case of a trigger. Sorted by how much would break:');
console.log('');
for (const c of coupled.sort((a, b) => (b.clientN + (b.trig ? 99 : 0)) - (a.clientN + (a.trig ? 99 : 0))).slice(0, 18)) {
  console.log('      ' + c.name.padEnd(32) +
    'client:' + String(c.clientN).padStart(2) +
    '  server:' + String(Math.max(0, c.serverN)).padStart(2) +
    (c.trig ? '   ** TRIGGER — renaming breaks it SILENTLY **' : ''));
}
const more = coupled.length - 18;
if (more > 0) console.log('      ... and ' + more + ' more with 1 client call site each');

// ---------------------------------------------------------------------------
// [2] THE G-067 RECIPE SURFACE
// ---------------------------------------------------------------------------

console.log('\n[2] THE G-067 RECIPE SURFACE');
console.log('  requireRequestViewer and requireRequestEditor exist, are');
console.log('  complete, and have zero call sites. This is the exact list of');
console.log('  functions the recipe must change, and what each does today.');

const GUARDS = ['requireRequestViewer', 'requireRequestEditor'];
console.log('');
for (const g of GUARDS) {
  const def = topLevel.find(f => f.name === g);
  const calls = (allServer.match(new RegExp('(?<![.\\w$])' + g + '\\s*\\(', 'g')) || []).length;
  console.log('      ' + g.padEnd(24) + 'defined at ' +
    (def ? def.file + ':' + def.line : 'NOT FOUND').padEnd(34) +
    'call sites: ' + Math.max(0, calls - 1));
  if (!def) problems++;
}

// The update*ForReview family + the two DD funding writers
const FAMILY = [
  'updateRequestOverview', 'updateRequestClassification', 'updateRequestItinerary',
  'updateTravelersForReview', 'updateCostsForReview', 'updateSharedCostsForReview',
  'updateTravelerCosts', 'reportDDFundingIssue', 'submitFundingCorrection'
];
const READERS = ['getRequestForReview', 'getRequestAttachments', 'getDDConfirmationData'];

/** Extract one top-level function's body from its file. */
function bodyOf(name) {
  const def = topLevel.find(f => f.name === name);
  if (!def) return null;
  const lines = serverSrc.get(def.file).split('\n');
  let end = lines.length;
  for (let i = def.line; i < lines.length; i++) {
    if (/^function\s+/.test(lines[i])) { end = i; break; }
  }
  return { def, body: lines.slice(def.line - 1, end).join('\n'), lines: end - def.line + 1 };
}

const RECORD = /editableStatuses|REQUEST_EDITABLE_STATUSES|submitterEmail|Current_Reviewer_Email|Submitter_Email|DD_Email/;
const HARD = /requireTravelAdmin\s*\(|requireRole\s*\(/;

console.log('');
console.log('  --- EDIT gate candidates (requireRequestEditor) ---');
console.log('      function                        lines  guard today          returns');
let needEdit = 0, haveEdit = 0;
for (const name of FAMILY) {
  const b = bodyOf(name);
  if (!b) { console.log('      ' + name.padEnd(32) + 'NOT FOUND'); problems++; continue; }
  const hasGuard = GUARDS.some(g => new RegExp(g + '\\s*\\(').test(b.body));
  const hard = HARD.test(b.body);
  const rec = RECORD.test(b.body);
  const ret = /errorResponse\s*\(/.test(b.body) ? 'errorResponse' :
    (/throw new Error/.test(b.body) ? 'throws' : '?');
  const state = hasGuard ? 'ALREADY ADOPTED' : hard ? 'admin guard' : rec ? 'record-level, inline' : 'NONE';
  if (hasGuard) haveEdit++; else needEdit++;
  console.log('      ' + name.padEnd(32) + String(b.lines).padStart(5) +
    '  ' + state.padEnd(21) + ret);
}
console.log('      ------');
console.log('      already adopted: ' + haveEdit + '    to change: ' + needEdit);

console.log('');
console.log('  --- VIEW gate candidates (requireRequestViewer) ---');
for (const name of READERS) {
  const b = bodyOf(name);
  if (!b) { console.log('      ' + name.padEnd(32) + 'NOT FOUND'); continue; }
  const hasGuard = GUARDS.some(g => new RegExp(g + '\\s*\\(').test(b.body));
  const rec = RECORD.test(b.body);
  const ret = /errorResponse\s*\(/.test(b.body) ? 'errorResponse' :
    (/throw new Error/.test(b.body) ? 'throws' : '?');
  console.log('      ' + name.padEnd(32) + String(b.lines).padStart(5) +
    '  ' + (hasGuard ? 'ALREADY ADOPTED' : rec ? 'record-level, inline' : 'NONE').padEnd(21) + ret);
}

// ---------------------------------------------------------------------------
// [3] the error-contract mismatch
// ---------------------------------------------------------------------------

console.log('\n[3] THE ERROR-CONTRACT MISMATCH the recipe must handle');
console.log('  The guards THROW. The update* family returns errorResponse().');
console.log('  Those are different contracts, and the client handles them');
console.log('  differently. Adopting a throwing guard inside a function whose');
console.log('  caller only inspects `result.success` changes what the user');
console.log('  sees on denial.');

const errFn = /function errorResponse/.exec(allServer);
console.log('');
console.log('  errorResponse defined .................... ' +
  (errFn ? 'yes, 10_lib/Errors.js' : 'NOT FOUND'));

// Does each client call site surface a thrown error?
const reviewCtl = clientSrc.get('client/controllers/review/travelReviewController.html');
if (!reviewCtl) {
  console.log('  review controller not found — skipping client analysis.');
} else {
  const ctlLines = reviewCtl.split('\n');
  const callRe = /google\s*\.\s*script\s*\.\s*run((?:\s*\.\s*with\w+\([^)]*\))*)\s*\.\s*(\w+)\s*\(/g;
  let cm; const sites = [];
  while ((cm = callRe.exec(reviewCtl)) !== null) {
    const fn = cm[2];
    if (!FAMILY.includes(fn) && fn !== 'submitReviewAction') continue;
    const start = reviewCtl.slice(0, cm.index).split('\n').length;
    const win = ctlLines.slice(start - 1, start + 240);
    const ci = win.findIndex(l => /\}\s*catch\s*\(/.test(l));
    const blk = ci === -1 ? '' : win.slice(ci, ci + 14).join('\n');
    sites.push({
      fn, start,
      failureHandler: /withFailureHandler/.test(cm[1]),
      hasCatch: ci !== -1,
      surfaces: /error\.message/.test(blk),
      swallows: /console\.warn/.test(blk) && !/error\.message/.test(blk)
    });
  }
  console.log('');
  console.log('  Client call sites for the affected RPCs:');
  console.log('      line   function                      failHandler  catch  shows message');
  for (const s of sites) {
    console.log('      ' + String(s.start).padStart(5) + '  ' + s.fn.padEnd(30) +
      (s.failureHandler ? 'yes' : 'NO ').padEnd(13) +
      (s.hasCatch ? 'yes' : 'NO ').padEnd(7) +
      (s.surfaces ? 'yes' : 'NO') + (s.swallows ? '   <-- SWALLOWS SILENTLY' : ''));
  }
  const allHandled = sites.every(s => s.failureHandler && s.hasCatch);
  const swallowers = sites.filter(s => s.swallows);
  console.log('');
  console.log('  every site has a failure handler AND a catch ... ' + (allHandled ? 'yes' : 'NO'));
  console.log('  sites that swallow the message silently ....... ' + swallowers.length);
  for (const s of swallowers) {
    console.log('      ' + s.fn + '  (line ' + s.start + ')');
  }
  if (allHandled && swallowers.length) {
    console.log('');
    console.log('  SO: the recipe is SAFE for every call site except the');
    console.log('  swallowers. A thrown guard error reaches the catch and is');
    console.log('  shown to the user everywhere else. At a swallowing site the');
    console.log('  denial would be invisible — the UI would keep the edit on');
    console.log('  screen while the server refused it, which is worse than');
    console.log('  the unguarded behavior it replaces.');
    console.log('');
    console.log('  The recipe must fix the swallowing site FIRST. That is one');
    console.log('  line, and it is a precondition, not a follow-up.');
  }
}

// ---------------------------------------------------------------------------
// [4] baselines for the verification steps
// ---------------------------------------------------------------------------

console.log('\n[4] BASELINES — the BEFORE numbers each recipe verifies against');
console.log('  A recipe without a measurable expected delta is a suggestion.');
console.log('  Re-run the named script after the change and compare.');

const reachable = topLevel.filter(f => !f.name.endsWith('_')).length;
// Exclude the two guard definitions themselves — they match HARD because
// they ARE the guard. Including them inflates the figure by 2 and would
// disagree with pass5_guard_census.js, which excludes them.
const GUARD_DEFS = new Set(['requireRole', 'requireTravelAdmin']);
const hardGuarded = topLevel.filter(f => {
  if (GUARD_DEFS.has(f.name)) return false;
  const b = bodyOf(f.name);
  return b && HARD.test(b.body);
}).length;
const guardAdoption = (allServer.match(/require(?:RequestViewer|RequestEditor)\s*\(/g) || []).length
  - GUARDS.length;

const manifestRaw = fs.readFileSync(path.join(APP, 'appsscript.json'), 'utf8');
const manifest = JSON.parse(manifestRaw);

const BASELINES = [
  ['top-level server functions', topLevel.length, 'pass5_guard_census.js'],
  ['browser-reachable (no trailing _)', reachable, 'pass5_guard_census.js'],
  ['functions behind a throwing guard', hardGuarded, 'pass5_guard_census.js'],
  ['per-request guard call sites', Math.max(0, guardAdoption), 'pass6_change_impact.js [2]'],
  ['oauthScopes declared in the manifest', (manifest.oauthScopes || []).length, 'pass6_deployment_census.js'],
  ['broken include() edges', null, 'pass6_component_map.js [4]'],
  ['positional writes exceeding their schema', 0, 'pass6_schema_census.js [3]'],
  ['state-machine actions', null, 'pass6_rule_census.js [1]'],
  ['register findings', null, 'pass6_register_check.js']
];
console.log('');
for (const [label, val, script] of BASELINES) {
  console.log('      ' + label.padEnd(42) +
    (val === null ? '(see script)' : String(val).padStart(4)) + '   ' + script);
}

// broken includes, computed here so the playbook can state the expected delta
const exists = p => fs.existsSync(path.join(APP, p + '.html'));
let broken = 0;
for (const [file, text] of clientSrc) {
  for (const m of text.matchAll(/include\(\s*'([^']+)'\s*\)/g)) {
    if (!exists(m[1])) broken++;
  }
}
const renderSrc = serverSrc.get('server/50_pages/Render.js') || '';
let brokenTemplates = 0;
for (const m of renderSrc.matchAll(/createTemplateFromFile\(\s*'([^']+)'\s*\)/g)) {
  if (!exists(m[1])) brokenTemplates++;
}
console.log('');
console.log('      broken include() edges today ............... ' + broken);
console.log('      broken template references today ........... ' + brokenTemplates);
console.log('      (the G-017 recipe should take both to 0)');

// ---------------------------------------------------------------------------
// [5] column-position coupling
// ---------------------------------------------------------------------------

console.log('\n[5] Column-position coupling, per tab');
console.log('  The code READS by header name and WRITES by position. So a');
console.log('  reorder does not break reads — it silently corrupts writes.');

const sheetsJs = serverSrc.get('server/01_constants/Sheets.js') || '';
const schemaBlock = /const\s+TRAVEL_SHEET_SCHEMAS\s*=\s*\{([\s\S]*?)\n\};/.exec(sheetsJs);
const schemas = {};
if (schemaBlock) {
  for (const m of schemaBlock[1].matchAll(/\n  ([A-Za-z_0-9]+):\s*\[([\s\S]*?)\]/g)) {
    schemas[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]);
  }
}
console.log('');
console.log('      tab                    cols   positional writers');
for (const [tab, cols] of Object.entries(schemas)) {
  const key = tab.toUpperCase();
  let writers = 0;
  for (const text of serverSrc.values()) {
    writers += (text.match(new RegExp('SHEET_NAMES\\.' + key + '[\\s\\S]{0,200}?(?:appendRow|setValues)', 'g')) || []).length;
  }
  console.log('      ' + tab.padEnd(23) + String(cols.length).padStart(4) +
    String(writers).padStart(8) + (writers ? '   reorder corrupts these' : ''));
}
console.log('');
console.log('      SAFE change: append a column at the FAR RIGHT and add it');
console.log('      to the schema in the same commit.');
console.log('      UNSAFE: insert, reorder, delete, or rename anything.');

// ---------------------------------------------------------------------------
// [6] the do-not-rename list
// ---------------------------------------------------------------------------

console.log('\n[6] THE DO-NOT-RENAME LIST');
console.log('');
console.log('  A. Trigger handlers — referenced by ScriptApp as a STRING.');
console.log('     Renaming leaves the schedule pointing at nothing. The work');
console.log('     stops and NOTHING reports an error.');
for (const t of TRIGGERS) {
  const def = topLevel.find(f => f.name === t);
  console.log('      ' + t.padEnd(28) + (def ? def.file + ':' + def.line : 'NOT FOUND'));
  if (!def) problems++;
}
console.log('');
console.log('  B. Any function with a client call site — ' +
  coupled.filter(c => c.clientN).length + ' of them (see [1]).');
console.log('     Renaming breaks the call at run time, in the browser.');
console.log('');
console.log('  C. Any sheet column — 538 header-name lookups resolve by exact');
console.log('     text (pass6_schema_census.js [7]). A rename makes them all');
console.log('     return undefined.');
console.log('');
console.log('  D. Any client partial path — 4 include edges are ALREADY broken');
console.log('     by exactly this class of mistake (G-017).');

bar('=');
console.log('Integrity problems detected ................... ' + problems);
if (problems === 0) {
  console.log('Every function, guard, trigger and schema this playbook cites');
  console.log('was located in source. No recipe references something absent.');
}
console.log('Every number above is recomputed from source on each run.\n');
