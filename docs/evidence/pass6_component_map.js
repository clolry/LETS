/**
 * pass6_component_map.js — reproducible evidence for ADMINISTRATOR_GUIDE.md's
 * companion deliverable SYSTEM_COMPONENT_MAP.md
 *
 * Run from this directory:
 *     node pass6_component_map.js
 *
 * Reads only. Touches no Google service. Static analysis of lets_app/.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * A component map is a set of claims about structure: how many files are in
 * each layer, which files call which, which modules nothing reaches, and
 * which pages load which includes. Every one of those is countable, and
 * Deliverable 1 established the rule that if a number appears in a
 * deliverable, a script must produce it.
 *
 * The specific claim this script exists to settle is the one that decides
 * how the map must be DRAWN: Pass 6 finding G-016 says the four
 * LETS-original modules are structurally unreachable, not merely unwired.
 * Section [5] tests that mechanically, in both directions:
 *   - do they expose any top-level function the browser could call?
 *   - does any other server file reference them?
 * If either answer were yes, the map would have to show them connected and
 * the deliverable's central structural statement would be wrong.
 *
 * WHAT IT REPORTS
 *   [1] Server layers: files, lines, functions, reachable, guarded
 *   [2] Per-file detail for every server file, with ownership
 *   [3] Client tree: pages, controllers, shared, components, styles
 *   [4] The include() graph — which page pulls in which partial, and which
 *       of those references do not resolve on disk (finding G-017)
 *   [5] The reachability test for the LETS-original subsystem (G-016)
 *   [6] Cross-layer call edges, to check the layer numbering is honest
 *   [7] Orphans: server files no entry point reaches, client files no page
 *       includes
 *
 * METHOD NOTES THAT AFFECT CORRECTNESS
 *   - Comments are stripped before any match. A file that MENTIONS another
 *     file in a header comment is not an edge. `Request.js` mentions
 *     "TravelRequestService.js" in a comment and must not be read as
 *     depending on `RequestService.js`; §[6] would otherwise invent an edge
 *     that does not exist.
 *   - Only `function name(` at column 0 counts as top-level. That is exactly
 *     what Apps Script exposes to google.script.run, and it is the basis of
 *     the G-016 test.
 *   - Layer order is taken from the directory prefixes (00, 01, 10, 20, 30,
 *     40, 50, 90, 91, 99). clasp pushes files in alphabetical path order,
 *     so these prefixes are a real load-order mechanism, not decoration.
 *   - A "backward" edge (a lower layer calling a higher one) is reported
 *     rather than assumed absent. Layer numbering is a convention the code
 *     may violate.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'lets_app');
const SERVER = path.join(APP, 'server');
const CLIENT = path.join(APP, 'client');
const REF = path.join(REPO, 'reference_travel_app');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function walk(dir, ext) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, ext));
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\0/g, '');
}

function rel(file) {
  return path.relative(APP, file).split(path.sep).join('/');
}

/** Blank out //, block, and HTML comments while preserving line count. */
function stripComments(lines) {
  const out = [];
  let inBlock = false, inHtml = false;
  for (const line of lines) {
    let s = line;
    if (inHtml) {
      const c = s.indexOf('-->');
      if (c === -1) { out.push(''); continue; }
      inHtml = false; s = s.slice(c + 3);
    }
    if (inBlock) {
      const c = s.indexOf('*/');
      if (c === -1) { out.push(''); continue; }
      inBlock = false; s = s.slice(c + 2);
    }
    for (;;) {
      const o = s.indexOf('<!--');
      if (o === -1) break;
      const c = s.indexOf('-->', o + 4);
      if (c === -1) { s = s.slice(0, o); inHtml = true; break; }
      s = s.slice(0, o) + s.slice(c + 3);
    }
    for (;;) {
      const o = s.indexOf('/*');
      if (o === -1) break;
      const c = s.indexOf('*/', o + 2);
      if (c === -1) { s = s.slice(0, o); inBlock = true; break; }
      s = s.slice(0, o) + s.slice(c + 2);
    }
    out.push(s.replace(/^\s*\/\/.*$/, ''));
  }
  return out;
}

function topLevelFunctions(lines) {
  const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/;
  const out = [];
  lines.forEach((l, i) => { const m = re.exec(l); if (m) out.push({ name: m[1], line: i + 1 }); });
  return out;
}

const HARD_GUARD = /requireTravelAdmin\s*\(|requireRole\s*\(/;

/**
 * `requireRole` and `requireTravelAdmin` ARE the guard, so their own bodies
 * match HARD_GUARD. Counting them as "guarded functions" inflates the total
 * by 2 and is the reason this script reported 33 while pass5_guard_census.js
 * reported 31 for the same property. 31 is correct: it counts functions
 * PROTECTED BY a guard, not the guard definitions themselves.
 */
const GUARD_DEFINITIONS = new Set(['requireRole', 'requireTravelAdmin']);

/** INHERITED / MODIFIED / LETS-ONLY, by byte comparison with the reference. */
function ownership(file) {
  const r = path.relative(APP, file);
  const ref = path.join(REF, r);
  try {
    const a = fs.readFileSync(file), b = fs.readFileSync(ref);
    return (a.length === b.length && a.equals(b)) ? 'INHERITED' : 'MODIFIED';
  } catch (e) { return 'LETS-ONLY'; }
}

// ---------------------------------------------------------------------------
// collect: server
// ---------------------------------------------------------------------------

const serverFiles = walk(SERVER, '.js');
const srv = [];                    // one record per server file
const fnOwner = new Map();         // function name -> file record

for (const file of serverFiles) {
  const raw = read(file).split('\n');
  const code = stripComments(raw);
  const fns = topLevelFunctions(raw);
  const layer = rel(file).split('/')[1];

  const rec = {
    file: rel(file),
    base: path.basename(file),
    layer,
    lines: raw.length,
    fns,
    reachable: fns.filter(f => !f.name.endsWith('_')).length,
    guarded: 0,
    own: ownership(file),
    code: code.join('\n'),
    calls: new Set(),              // function names it calls
    deps: new Set()                // server files it depends on
  };

  // guarded = functions whose body contains a throwing guard
  for (let i = 0; i < fns.length; i++) {
    const start = fns[i].line - 1;
    const end = i + 1 < fns.length ? fns[i + 1].line - 1 : raw.length;
    if (HARD_GUARD.test(code.slice(start, end).join('\n')) &&
        !GUARD_DEFINITIONS.has(fns[i].name)) rec.guarded++;
  }

  srv.push(rec);
  for (const f of fns) if (!fnOwner.has(f.name)) fnOwner.set(f.name, rec);
}

// file-to-file dependency edges, via function calls
const allFnNames = [...fnOwner.keys()];
const CALL_RE = new RegExp(
  '(?<![.\\w$])(' + allFnNames.map(n => n.replace(/\$/g, '\\$')).join('|') + ')\\s*\\(', 'g');

for (const rec of srv) {
  let m; CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(rec.code)) !== null) {
    const owner = fnOwner.get(m[1]);
    if (!owner) continue;
    rec.calls.add(m[1]);
    if (owner !== rec) rec.deps.add(owner.file);
  }
}

// ---------------------------------------------------------------------------
// collect: client
// ---------------------------------------------------------------------------

const clientFiles = walk(CLIENT, '.html');
const cli = clientFiles.map(file => {
  const raw = read(file).split('\n');
  const code = stripComments(raw).join('\n');
  const includes = [...code.matchAll(/include\(\s*'([^']+)'\s*\)/g)].map(m => m[1]);
  return {
    file: rel(file),
    base: path.basename(file),
    group: rel(file).split('/')[1],
    lines: raw.length,
    includes,
    own: ownership(file),
    doubledExt: /\.html\.html$/.test(file)
  };
});

// Which client files are templates served directly by a page-server?
const renderFile = srv.find(r => r.base === 'Render.js');
const servedTemplates = renderFile
  ? [...renderFile.code.matchAll(/createTemplateFromFile\(\s*'([^']+)'\s*\)/g)].map(m => m[1])
  : [];

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const bar = c => console.log(c.repeat(78));
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '-';

console.log('\nPass 6 evidence — component map');
console.log('server files: ' + serverFiles.length + '   client files: ' + clientFiles.length);
bar('=');

// --- [1] layers -------------------------------------------------------------

console.log('\n[1] Server layers, in clasp load order');
console.log('  Directory prefixes are a real mechanism: clasp pushes files in');
console.log('  alphabetical path order, and every pushed .js shares ONE global');
console.log('  scope, so load order decides which definition wins.');
console.log('');
console.log('  layer                files   lines    fns  reachable  guarded');
console.log('  ' + '-'.repeat(64));
const layers = [...new Set(srv.map(r => r.layer))].sort();
let T = { files: 0, lines: 0, fns: 0, reach: 0, guard: 0 };
for (const L of layers) {
  const g = srv.filter(r => r.layer === L);
  const f = g.length,
    li = g.reduce((n, r) => n + r.lines, 0),
    fn = g.reduce((n, r) => n + r.fns.length, 0),
    re = g.reduce((n, r) => n + r.reachable, 0),
    gu = g.reduce((n, r) => n + r.guarded, 0);
  T.files += f; T.lines += li; T.fns += fn; T.reach += re; T.guard += gu;
  console.log('  ' + L.padEnd(20) + String(f).padStart(5) + String(li).padStart(8) +
    String(fn).padStart(7) + String(re).padStart(11) + String(gu).padStart(9));
}
console.log('  ' + '-'.repeat(64));
console.log('  ' + 'TOTAL'.padEnd(20) + String(T.files).padStart(5) + String(T.lines).padStart(8) +
  String(T.fns).padStart(7) + String(T.reach).padStart(11) + String(T.guard).padStart(9));
console.log('');
console.log('  Guard concentration — of ' + T.guard + ' throwing-guarded functions:');
for (const L of layers) {
  const gu = srv.filter(r => r.layer === L).reduce((n, r) => n + r.guarded, 0);
  if (gu) console.log('      ' + String(gu).padStart(3) + '  ' + L + '   (' + pct(gu, T.guard) + ' of all guards)');
}

// --- [2] per-file -----------------------------------------------------------

console.log('\n[2] Every server file');
console.log('  own = INHERITED (byte-identical to TRIP) / MODIFIED / LETS-ONLY');
console.log('  dep = count of other server files it calls into');
console.log('');
let lastLayer = null;
for (const r of srv.sort((a, b) => a.layer.localeCompare(b.layer) || a.base.localeCompare(b.base))) {
  if (r.layer !== lastLayer) { console.log('  --- ' + r.layer + ' ---'); lastLayer = r.layer; }
  console.log('      ' + r.base.padEnd(22) + String(r.lines).padStart(6) + 'L' +
    String(r.fns.length).padStart(5) + 'fn' +
    String(r.guarded).padStart(4) + 'g' +
    '  ' + r.own.padEnd(10) + ' dep:' + r.deps.size);
}

// --- [3] client tree --------------------------------------------------------

console.log('\n[3] Client tree');
console.log('  group            files   lines   inherited  modified  LETS-only');
console.log('  ' + '-'.repeat(64));
const groups = [...new Set(cli.map(c => c.group))].sort();
for (const G of groups) {
  const g = cli.filter(c => c.group === G);
  console.log('  ' + G.padEnd(16) + String(g.length).padStart(5) +
    String(g.reduce((n, c) => n + c.lines, 0)).padStart(8) +
    String(g.filter(c => c.own === 'INHERITED').length).padStart(12) +
    String(g.filter(c => c.own === 'MODIFIED').length).padStart(10) +
    String(g.filter(c => c.own === 'LETS-ONLY').length).padStart(11));
}
console.log('  ' + '-'.repeat(64));
console.log('  ' + 'TOTAL'.padEnd(16) + String(cli.length).padStart(5) +
  String(cli.reduce((n, c) => n + c.lines, 0)).padStart(8) +
  String(cli.filter(c => c.own === 'INHERITED').length).padStart(12) +
  String(cli.filter(c => c.own === 'MODIFIED').length).padStart(10) +
  String(cli.filter(c => c.own === 'LETS-ONLY').length).padStart(11));

const big = [...cli].sort((a, b) => b.lines - a.lines).slice(0, 6);
console.log('\n  The six largest client files — where the UI logic actually lives:');
for (const c of big) console.log('      ' + String(c.lines).padStart(5) + 'L  ' + c.file);

// --- [4] the include graph and its broken edges -----------------------------

console.log('\n[4] The include() graph, and which edges are broken (G-017)');
console.log('  A page is assembled server-side: include(\'x\') is replaced by');
console.log('  the contents of x.html. A reference that does not resolve');
console.log('  throws at render time or silently omits the partial.');
console.log('');
const exists = p => fs.existsSync(path.join(APP, p + '.html'));
let brokenEdges = 0;
const pages = cli.filter(c => c.group === 'pages');
for (const p of pages.sort((a, b) => a.base.localeCompare(b.base))) {
  if (!p.includes.length) { console.log('  ' + p.base.padEnd(38) + '(no includes)'); continue; }
  const bad = p.includes.filter(i => !exists(i));
  brokenEdges += bad.length;
  console.log('  ' + p.base.padEnd(38) + p.includes.length + ' includes' +
    (bad.length ? '   !! ' + bad.length + ' BROKEN' : ''));
  for (const b of bad) console.log('        BROKEN -> ' + b);
}
console.log('');
console.log('  total broken include edges ............... ' + brokenEdges);

const doubled = cli.filter(c => c.doubledExt);
console.log('  files named *.html.html (cause of most) ... ' + doubled.length);
for (const c of doubled) {
  const wanted = c.file.replace(/\.html\.html$/, '');
  const referenced = cli.some(x => x.includes.includes(wanted)) ||
    servedTemplates.includes(wanted);
  console.log('      ' + c.file);
  console.log('        wanted as: ' + wanted + (referenced ? '   <- IS referenced' : '   <- not referenced'));
}

// --- [5] THE G-016 TEST -----------------------------------------------------

console.log('\n[5] Is the LETS-original subsystem reachable?  (tests G-016)');
console.log('  This decides how the component map must be drawn. Two');
console.log('  independent questions, both of which must be NO for the');
console.log('  subsystem to be genuinely unreachable.');
console.log('');

const LETS_MODULES = [
  'server/40_domain/RequestService.js',
  'server/30_services/BudgetEngine.js',
  'server/20_data/LetsDB.js',
  'server/30_services/FASTrackerSync.js'
];
const NAMESPACES = ['RequestService', 'BudgetEngine', 'LetsDB', 'FASTrackerSync'];

console.log('  Q1: does any of them expose a top-level function?');
console.log('      (Apps Script exposes ONLY top-level functions to the browser)');
let anyTopLevel = 0;
for (const m of LETS_MODULES) {
  const r = srv.find(x => x.file === m);
  if (!r) { console.log('      !! ' + m + ' NOT FOUND'); continue; }
  anyTopLevel += r.fns.length;
  console.log('      ' + path.basename(m).padEnd(22) +
    'top-level functions: ' + r.fns.length +
    (r.fns.length ? '   <- REACHABLE' : ''));
}
console.log('      ------');
console.log('      total top-level functions across all four: ' + anyTopLevel);

console.log('');
console.log('  Q2: does any OTHER server file reference their namespaces?');
console.log('      (comments stripped first — Request.js mentions');
console.log('       "TravelRequestService.js" in a header comment, which is');
console.log('       not a dependency and must not be counted as one)');
let inbound = 0;
for (const ns of NAMESPACES) {
  const re = new RegExp('(?<![.\\w$])' + ns + '\\s*\\.');
  const callers = srv.filter(r =>
    !LETS_MODULES.includes(r.file) && re.test(r.code)).map(r => r.base);
  inbound += callers.length;
  console.log('      ' + ns.padEnd(20) + 'referenced by: ' +
    (callers.length ? callers.join(', ') + '   <- INBOUND EDGE' : 'nothing outside the group'));
}

console.log('');
console.log('  Internal edges WITHIN the group (these do exist):');
for (const m of LETS_MODULES) {
  const r = srv.find(x => x.file === m);
  if (!r) continue;
  const internal = NAMESPACES.filter(ns => {
    const re = new RegExp('(?<![.\\w$])' + ns + '\\s*\\.');
    return ns !== path.basename(m, '.js') && re.test(r.code);
  });
  console.log('      ' + path.basename(m).padEnd(22) + '-> ' + (internal.join(', ') || '(none)'));
}

console.log('');
if (anyTopLevel === 0 && inbound === 0) {
  console.log('  VERDICT: G-016 CONFIRMED on both tests.');
  console.log('    Zero top-level functions, so no browser can call in.');
  console.log('    Zero inbound references, so no server code calls in.');
  console.log('    The four modules form a closed group with internal edges');
  console.log('    and NO inbound edge from anything.');
  console.log('');
  console.log('    CONSEQUENCE FOR THE MAP: this subsystem must be drawn');
  console.log('    detached. Drawing it as a normal layer would misrepresent');
  console.log('    the system\'s single most important structural fact.');
} else {
  console.log('  VERDICT: G-016 NOT confirmed. ' + anyTopLevel + ' top-level function(s), ' +
    inbound + ' inbound edge(s).');
  console.log('    The map must show the subsystem CONNECTED, and Pass 6');
  console.log('    §6.3.5 plus Deliverable 1 §1.1.2 both need correcting.');
}

// --- [6] cross-layer edges --------------------------------------------------

console.log('\n[6] Cross-layer call edges — is the layer numbering honest?');
console.log('  Convention: a file should call only into LOWER-numbered layers.');
console.log('  Violations are reported rather than assumed absent.');
console.log('');
const layerNum = l => parseInt(l.slice(0, 2), 10);
const matrix = new Map();
let backward = [];
for (const r of srv) {
  for (const d of r.deps) {
    const dr = srv.find(x => x.file === d);
    if (!dr) continue;
    const k = r.layer + ' -> ' + dr.layer;
    matrix.set(k, (matrix.get(k) || 0) + 1);
    if (layerNum(dr.layer) > layerNum(r.layer)) {
      backward.push(r.base + ' (' + r.layer + ') -> ' + dr.base + ' (' + dr.layer + ')');
    }
  }
}
for (const [k, v] of [...matrix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log('      ' + String(v).padStart(3) + '  ' + k);
}
console.log('');
console.log('  BACKWARD edges (lower layer calling a higher one) ... ' + backward.length);
for (const b of backward.slice(0, 20)) console.log('      ' + b);
if (backward.length > 20) console.log('      ... and ' + (backward.length - 20) + ' more');
if (backward.length) {
  console.log('    These are not necessarily defects — in one global scope');
  console.log('    any function can call any other. They mean the layer');
  console.log('    numbering is a naming convention, not an enforced');
  console.log('    boundary, and the map should say so rather than imply');
  console.log('    an architecture the code does not have.');
}

// --- [7] orphans ------------------------------------------------------------

console.log('\n[7] Orphans — components nothing reaches');

console.log('\n  Client files included by no page and served by no page-server:');
const includedSomewhere = new Set();
for (const c of cli) for (const i of c.includes) includedSomewhere.add(i);
for (const t of servedTemplates) includedSomewhere.add(t);
const orphanClient = cli.filter(c => {
  const key = c.file.replace(/\.html(\.html)?$/, '');
  return !includedSomewhere.has(key);
});
for (const c of orphanClient.sort((a, b) => a.file.localeCompare(b.file))) {
  console.log('      ' + c.file.padEnd(52) + c.own);
}
console.log('      ------');
console.log('      ' + orphanClient.length + ' of ' + cli.length + ' client files');

console.log('\n  Templates Render.js serves directly (' + servedTemplates.length + '):');
for (const t of servedTemplates) {
  console.log('      ' + t + (exists(t) ? '' : '   !! DOES NOT RESOLVE'));
}

console.log('\n  Server files with zero reachable functions:');
const noReach = srv.filter(r => r.reachable === 0);
for (const r of noReach) console.log('      ' + r.file.padEnd(44) + r.own);
console.log('      ------');
console.log('      ' + noReach.length + ' of ' + srv.length + ' server files');
console.log('      These are the module-factory files. In a conventional');
console.log('      codebase that is good encapsulation. In Apps Script it');
console.log('      means the browser cannot reach them at all — see [5].');

bar('=');
console.log('Every number above is recomputed from source on each run.\n');
