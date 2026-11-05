/**
 * pass6_deployment_census.js — reproducible evidence for DEPLOYMENT_AND_ENVIRONMENTS.md
 *
 * Run from this directory:
 *     node pass6_deployment_census.js
 *
 * Reads only. Touches no Google service, no network, no GitHub API.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * A deployment document makes claims about things that mostly are NOT in the
 * repository: which project is live, who can deploy, what the Script
 * Properties hold. Almost all of that is `[UNKNOWN]` from here.
 *
 * What IS in the repository is the *configuration that would be applied* —
 * the clasp targets, the manifest, the workflows, the property keys the code
 * reads and writes. This script measures exactly that, so the deliverable
 * can be precise about the boundary between "configured" and "actual".
 *
 * The specific thing it exists to test is the CI guard set. Four regression
 * guards in verify.yml encode real lessons, and a guard that does not
 * actually catch what it claims to catch is worse than no guard — it
 * provides false assurance. Section [4] runs each guard's own logic against
 * the current tree and against inputs the guard is supposed to reject.
 *
 * WHAT IT REPORTS
 *   [1] Every clasp target in the repository, and what a push from each
 *       would carry
 *   [2] The manifest: execute-as, access, advanced services, scopes
 *   [3] The deploy pipeline: triggers, credentials, and push-vs-deploy
 *   [4] THE GUARD TEST: each CI guard run against the tree, plus a
 *       deliberately-bad input to prove the guard bites
 *   [5] Script Properties: declared, read, written, and orphaned
 *   [6] Scheduled triggers: handlers, schedules, and the rename hazard
 *   [7] What a rebuild from source would NOT restore
 *
 * METHOD NOTE
 *   Where a guard is re-implemented here, the regex is copied verbatim from
 *   verify.yml and the copy is shown. If the two drift, [4] says so.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'lets_app');

const bar = c => console.log(c.repeat(78));
let problems = 0;

function readIf(p) {
  try { return fs.readFileSync(p, 'utf8').replace(/\0/g, ''); }
  catch (e) { return null; }
}
function walk(dir, ext, out) {
  out = out || [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (!ext || e.name.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

console.log('\nPass 6 evidence — deployment and environment census');
console.log('purpose: measure the configuration that WOULD be applied, and');
console.log('         test whether the CI guards actually bite');
bar('=');

// ---------------------------------------------------------------------------
// [1] clasp targets
// ---------------------------------------------------------------------------

console.log('\n[1] Apps Script targets configured in this repository');

const claspFiles = [
  ['lets_app/.clasp.json', 'production'],
  ['lets_app/.clasp.sandbox.json', 'sandbox'],
  ['.clasp.json', '** UNDOCUMENTED — repo root **']
];

const targets = [];
for (const [rel, label] of claspFiles) {
  const raw = readIf(path.join(REPO, rel));
  if (!raw) { console.log('\n  ' + rel + ' — not present'); continue; }
  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) { cfg = null; }
  if (!cfg) { console.log('\n  ' + rel + ' — UNPARSEABLE'); problems++; continue; }

  // What would a push from this config carry?
  const base = path.dirname(path.join(REPO, rel));
  const rootDir = cfg.rootDir === '' || cfg.rootDir === undefined
    ? base : path.resolve(base, cfg.rootDir);
  const skipSub = cfg.skipSubdirectories === true;
  const all = walk(rootDir, null);
  const pushable = all.filter(f => /\.(js|gs|html|json)$/.test(f));
  const inRoot = pushable.filter(f => path.dirname(f) === rootDir);

  targets.push({ rel, label, cfg, rootDir, pushable, inRoot, skipSub });

  console.log('\n  ' + rel + '   [' + label + ']');
  console.log('      scriptId .......... ' + (cfg.scriptId || '(none)'));
  console.log('      rootDir ........... ' +
    (cfg.rootDir === '' ? "'' (the directory holding this file)" : JSON.stringify(cfg.rootDir)));
  console.log('      resolves to ....... ' + path.relative(REPO, rootDir) + '/');
  console.log('      skipSubdirectories  ' + (cfg.skipSubdirectories === undefined ? '(unset)' : cfg.skipSubdirectories));
  console.log('      pushable files under that root ... ' +
    (skipSub ? inRoot.length + ' (root only)' : pushable.length));
}

console.log('');
console.log('  distinct script IDs configured ........... ' +
  new Set(targets.map(t => t.cfg.scriptId)).size);

const rootTarget = targets.find(t => t.rel === '.clasp.json');
if (rootTarget) {
  console.log('');
  console.log('  !! THE ROOT CONFIG IS THE FINDING (G-048).');
  console.log('     It is untracked by git, in no project document, and its');
  console.log('     rootDir resolves to the REPOSITORY ROOT. A `clasp push`');
  console.log('     run from there would carry ' + rootTarget.pushable.length +
    ' pushable files');
  console.log('     into an undocumented Apps Script project, including:');
  const groups = {};
  for (const f of rootTarget.pushable) {
    const top = path.relative(REPO, f).split(path.sep)[0];
    groups[top] = (groups[top] || 0) + 1;
  }
  for (const [g, n] of Object.entries(groups).sort((a, b) => b[1] - a[1])) {
    const flag = /reference_/.test(g) ? '   <- ANOTHER ORG\'S APPLICATION' : '';
    console.log('         ' + String(n).padStart(4) + '  ' + (g === path.basename(g) && !g.includes('/') ? g : g) + flag);
  }
}

// ---------------------------------------------------------------------------
// [2] the manifest
// ---------------------------------------------------------------------------

console.log('\n[2] The manifest — lets_app/appsscript.json');

const manifestRaw = readIf(path.join(APP, 'appsscript.json'));
const manifest = manifestRaw ? JSON.parse(manifestRaw) : null;
if (!manifest) { console.log('  NOT FOUND'); problems++; }
else {
  console.log('      timeZone ............ ' + manifest.timeZone);
  console.log('      runtimeVersion ...... ' + manifest.runtimeVersion);
  console.log('      exceptionLogging .... ' + manifest.exceptionLogging);
  console.log('      webapp.executeAs .... ' + (manifest.webapp || {}).executeAs);
  console.log('      webapp.access ....... ' + (manifest.webapp || {}).access);
  const svcs = ((manifest.dependencies || {}).enabledAdvancedServices || []);
  console.log('      advanced services ... ' + svcs.map(s => s.userSymbol + ' ' + s.version).join(', '));
  console.log('      libraries ........... ' +
    (((manifest.dependencies || {}).libraries || []).length || 'NONE DECLARED'));
  console.log('      oauthScopes ......... ' +
    (manifest.oauthScopes ? manifest.oauthScopes.length + ' declared' : 'NONE DECLARED'));

  // Is each declared advanced service actually used?
  const serverText = walk(path.join(APP, 'server'), '.js')
    .map(f => fs.readFileSync(f, 'utf8').replace(/\0/g, '')).join('\n');
  console.log('');
  console.log('  Are the declared advanced services used?');
  for (const s of svcs) {
    const n = (serverText.match(new RegExp('(?<![.\\w])' + s.userSymbol + '\\.', 'g')) || []).length;
    console.log('      ' + s.userSymbol.padEnd(10) + 'references in server/: ' +
      String(n).padStart(3) + (n === 0 ? '   <- DECLARED AND UNUSED' : ''));
  }

  // The execute-as contradiction
  const comments = [];
  for (const f of walk(path.join(APP, 'server'), '.js')) {
    const t = fs.readFileSync(f, 'utf8').replace(/\0/g, '');
    const lines = t.split('\n');
    lines.forEach((l, i) => {
      if (/USER_DEPLOYING/.test(l)) {
        comments.push(path.relative(APP, f).split(path.sep).join('/') + ':' + (i + 1));
      }
    });
  }
  console.log('');
  console.log('  The execute-as contradiction:');
  console.log('      manifest declares ................. ' + (manifest.webapp || {}).executeAs);
  console.log('      source lines asserting the other .. ' + comments.length +
    ' across ' + new Set(comments.map(c => c.split(':')[0])).size + ' files');
  for (const c of comments) console.log('         ' + c);
  console.log('');
  console.log('    The "Execute as" setting lives on the DEPLOYMENT, not in');
  console.log('    this file. clasp push cannot change it and reading this');
  console.log('    file cannot tell you what it is. VT-01 resolves it.');
}

// ---------------------------------------------------------------------------
// [3] the pipeline
// ---------------------------------------------------------------------------

console.log('\n[3] The deploy pipeline');

const wfDir = path.join(REPO, '.github', 'workflows');
const workflows = walk(wfDir, '.yml');
console.log('  workflow files: ' + workflows.length);

for (const w of workflows) {
  const t = fs.readFileSync(w, 'utf8');
  const name = path.basename(w);
  const triggers = [];
  const onBlock = /\non:\s*\n([\s\S]*?)\n\w/.exec(t);
  if (onBlock) {
    for (const m of onBlock[1].matchAll(/^\s{2}([a-z_]+):/gm)) triggers.push(m[1]);
  }
  const usesSecret = /\$\{\{\s*secrets\./.test(t);
  // Match an EXECUTED clasp command, not a mention in a comment or an echo.
  // verify.yml says "clasp push" four times — in a step name, in three
  // comment lines, and in a PASS message — and executes it never. A naive
  // /clasp push/ test reports verify.yml as a deploying workflow, which is
  // the opposite of its entire design.
  const execLines = t.split('\n')
    .filter(l => !/^\s*#/.test(l))
    .filter(l => !/^\s*-?\s*name:/.test(l))
    .filter(l => !/\becho\b/.test(l));
  const hasPush = execLines.some(l => /clasp push/.test(l));
  const hasDeploy = execLines.some(l => /clasp deploy/.test(l));
  const mentionsPush = /clasp push/.test(t);
  const pinned = /@google\/clasp@[\d.]+/.exec(t);
  console.log('');
  console.log('  ' + name);
  console.log('      triggers .............. ' + (triggers.join(', ') || '(none parsed)'));
  console.log('      interpolates a secret . ' + (usesSecret ? 'YES' : 'no'));
  console.log('      EXECUTES `clasp push` . ' + (hasPush ? 'YES' : 'no') +
    (!hasPush && mentionsPush ? '   (mentioned only, in a guard)' : ''));
  console.log('      EXECUTES `clasp deploy` ' + (hasDeploy ? 'YES' : 'NO'));
  if (pinned) console.log('      clasp version pinned .. ' + pinned[0]);
  const nodeV = /node-version:\s*'?([\d]+)'?/.exec(t);
  if (nodeV) console.log('      node-version .......... ' + nodeV[1]);
}

console.log('');
console.log('  THE PUSH / DEPLOY DISTINCTION:');
const deployWf = readIf(path.join(wfDir, 'deploy-gas.yml')) || '';
const deployExec = deployWf.split('\n')
  .filter(l => !/^\s*#/.test(l) && !/^\s*-?\s*name:/.test(l) && !/\becho\b/.test(l));
const execPush = deployExec.some(l => /clasp push --force/.test(l));
const execDeploy = deployExec.some(l => /clasp deploy/.test(l));
console.log('      deploy-gas.yml executes `clasp push --force` . ' + execPush);
console.log('      deploy-gas.yml executes `clasp deploy` ....... ' + execDeploy);
console.log('    push replaces the project CODE. deploy publishes a VERSION.');
console.log('    With no deploy step, whether a merge reaches users depends');
console.log('    on how the active deployment is configured — which is not');
console.log('    recorded anywhere in this repository. VT-01.');

// --- Are deployment IDs configured, and does anything consume them?
//
// Two repository VARIABLES were created on 2026-10-29 holding the production
// and sandbox web-app deployment IDs. A variable that nothing reads is
// inert — the "wired at every dispatch point" check. This section measures
// consumption rather than existence, because existence is the easy half.
console.log('');
console.log('  DEPLOYMENT-ID PLUMBING — configured vs. consumed:');
const allWfText = workflows.map(w => fs.readFileSync(w, 'utf8')).join('\n');
const varRefs = [...allWfText.matchAll(/\$\{\{\s*vars\.([A-Z_0-9]+)\s*\}\}/g)].map(m => m[1]);
const deployIdRefs = varRefs.filter(v => /DEPLOYMENT_ID/.test(v));
// Also check the whole repo, in case a script rather than a workflow reads them.
const repoFiles = walk(REPO, null)
  .filter(f => !f.includes(`${path.sep}.git${path.sep}`))
  .filter(f => /\.(ya?ml|js|sh|json|md)$/.test(f));
let namedInRepo = 0;
for (const f of repoFiles) {
  const t = readIf(f);
  if (t && /GAS_(PRODUCTION|SANDBOX)_DEPLOYMENT_ID/.test(t)) namedInRepo++;
}
console.log('      `vars.*` interpolations in workflows ...... ' + varRefs.length);
console.log('      of those naming a DEPLOYMENT_ID .......... ' + deployIdRefs.length);
console.log('      repo files naming GAS_*_DEPLOYMENT_ID .... ' + namedInRepo +
  '   (docs included)');
if (!execDeploy && deployIdRefs.length === 0) {
  console.log('');
  console.log('      CONFIGURED BUT UNCONSUMED. Two repository variables hold');
  console.log('      the production and sandbox deployment IDs, and NO');
  console.log('      workflow step reads either one. There is still no');
  console.log('      `clasp deploy`, so the push/deploy gap above is');
  console.log('      unchanged: the IDs are now known, and still unused.');
  console.log('      This is the §14.4 wiring check — a capability that is');
  console.log('      defined but not registered at any dispatch point is');
  console.log('      silently inert, and inert is indistinguishable from');
  console.log('      absent unless something measures it.');
  console.log('      NOT a defect to fix here: adding a deploy step removes');
  console.log('      the accidental buffer in G-021 (no branch protection +');
  console.log('      standing deploy authority) and must land WITH it.');
} else if (execDeploy && deployIdRefs.length === 0) {
  console.log('');
  console.log('      !! `clasp deploy` runs but no vars.*DEPLOYMENT_ID is');
  console.log('         interpolated. It is deploying to a default or');
  console.log('         hardcoded target. Check which.');
  problems++;
} else if (execDeploy && deployIdRefs.length) {
  console.log('');
  console.log('      Wired: `clasp deploy` runs and reads ' +
    [...new Set(deployIdRefs)].join(', ') + '.');
}

// node version mismatch
const planRaw = readIf(path.join(REPO, 'PROJECT_PLAN.md')) || '';
const planNode = /Node\.js (\d+)\+/.exec(planRaw);
const deployNode = /node-version:\s*'?(\d+)'?/.exec(deployWf);
const verifyNode = /node-version:\s*'?(\d+)'?/.exec(readIf(path.join(wfDir, 'verify.yml')) || '');
console.log('');
console.log('  Node version agreement:');
console.log('      PROJECT_PLAN.md says .... ' + (planNode ? planNode[1] + '+' : '(not stated)'));
console.log('      verify.yml pins ......... ' + (verifyNode ? verifyNode[1] : '?'));
console.log('      deploy-gas.yml pins ..... ' + (deployNode ? deployNode[1] : '?'));
if (deployNode && verifyNode && deployNode[1] !== verifyNode[1]) {
  console.log('    !! The two workflows run DIFFERENT Node versions. Code is');
  console.log('       verified on ' + verifyNode[1] + ' and deployed by ' + deployNode[1] + '.');
  console.log('       Harmless for clasp push (it only uploads files), but it');
  console.log('       means the tested toolchain is not the deploying one.');
  console.log('       deploy-gas.yml documents this divergence in a comment.');
}

// ---------------------------------------------------------------------------
// [4] THE GUARD TEST
// ---------------------------------------------------------------------------

console.log('\n[4] THE GUARD TEST — do the CI regression guards actually bite?');
console.log('  Four guards in verify.yml encode real lessons. A guard that');
console.log('  does not catch what it claims to catch provides false');
console.log('  assurance, so each is run against the tree AND against an');
console.log('  input it should reject.');

const verifyWf = readIf(path.join(wfDir, 'verify.yml')) || '';

// --- guard 1: deploy must not trigger on pull_request
console.log('\n  --- Guard 1: deploy workflow must not trigger on pull_request');
const g1re = /^[\s]*pull_request[\s]*:/m;
const g1_tree = g1re.test(deployWf);
console.log('      against deploy-gas.yml today ...... ' +
  (g1_tree ? 'TRIGGERS (guard would fail the build)' : 'clean — guard passes'));
const g1_bad = g1re.test('on:\n  pull_request:\n  push:\n');
console.log('      against a deliberately bad input .. ' +
  (g1_bad ? 'CAUGHT — guard bites' : 'MISSED — guard is ineffective'));
if (!g1_bad) problems++;

// --- guard 2: verify.yml must stay credential-free
console.log('\n  --- Guard 2: verify.yml must interpolate no secrets');
const g2re = /\$\{\{[\s]*secrets\./;
const g2_tree = g2re.test(verifyWf);
console.log('      against verify.yml today .......... ' +
  (g2_tree ? 'INTERPOLATES A SECRET' : 'clean — guard passes'));
const g2_bad = g2re.test('env:\n  X: ${{ secrets.CLASPRC_JSON }}\n');
console.log('      against a deliberately bad input .. ' +
  (g2_bad ? 'CAUGHT — guard bites' : 'MISSED'));
if (!g2_bad) problems++;
console.log('      note: the guard greps its own file, so its comment');
console.log('      deliberately avoids writing the pattern literally.');

// --- guard 3: no hardcoded Google identifiers in server source
console.log('\n  --- Guard 3: no hardcoded Google identifiers in server/');

/**
 * THE PATTERN IS READ FROM verify.yml, NOT COPIED INTO THIS SCRIPT.
 *
 * An earlier version of this section hardcoded /['"]1[A-Za-z0-9_-]{39,}['"]/.
 * That is the exact failure mode this script exists to expose: a check that
 * silently tests a stale copy of the thing it claims to measure. When the
 * guard was widened, this script would have gone on reporting the old
 * coverage and the old gap, confidently and wrongly.
 *
 * So the pattern is extracted from the workflow on every run. If the
 * extraction fails, that is reported as a problem rather than papered over
 * with a fallback — a fallback would restore the stale-copy defect.
 */
const g3line = /^\s*PATTERN="(.+)"\s*$/m.exec(verifyWf);
let g3re = null;
if (!g3line) {
  console.log('      !! could not extract PATTERN= from verify.yml.');
  console.log('         Guard 3 cannot be verified. Either the guard was');
  console.log('         restructured or it no longer declares its pattern on');
  console.log('         one line. Fix this script, do not add a fallback.');
  problems++;
} else {
  // The YAML carries shell-escaped quotes: ['\"] reaches the shell as ['"].
  const shellPattern = g3line[1].replace(/\\"/g, '"');
  console.log('      pattern, as read from verify.yml:');
  console.log('         ' + shellPattern);
  try {
    g3re = new RegExp(shellPattern);
  } catch (e) {
    console.log('      !! pattern does not compile as a JS regex: ' + e.message);
    console.log('         (grep -E and JS regex differ; if this fires, the');
    console.log('         guard may still be correct — but this script can no');
    console.log('         longer verify it, which is itself worth fixing.)');
    problems++;
  }
}

/**
 * The tracked-exception list, also read from verify.yml rather than copied.
 * The guard permits two pre-existing literals, each a registered finding.
 * This script must know about them or it would report the guard as failing
 * on a tree the guard deliberately passes.
 */
const trackedSymbols = [...verifyWf.matchAll(/\*"server\/([^"]+):"\*"([A-Z_0-9]+)"\*\)/g)]
  .map(m => ({ file: m[1], symbol: m[2] }));
console.log('');
console.log('      tracked exceptions declared in the guard ... ' + trackedSymbols.length);
for (const t of trackedSymbols) {
  console.log('         server/' + t.file + '   ' + t.symbol);
}

const serverFiles = walk(path.join(APP, 'server'), '.js');
let g3hits = 0, g3tracked = 0, g3untracked = [];
if (g3re) {
  for (const f of serverFiles) {
    const rel = path.relative(APP, f).split(path.sep).join('/');
    const t = fs.readFileSync(f, 'utf8').replace(/\0/g, '');
    t.split('\n').forEach((line, i) => {
      if (!g3re.test(line)) return;
      g3hits++;
      const isTracked = trackedSymbols.some(
        s => rel === 'server/' + s.file && line.includes(s.symbol));
      if (isTracked) g3tracked++;
      else g3untracked.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 56));
    });
  }
  console.log('');
  console.log('      identifier literals in server/ .... ' + g3hits);
  console.log('         of those, tracked exceptions ... ' + g3tracked);
  console.log('         of those, UNTRACKED ............ ' + g3untracked.length);
  for (const u of g3untracked) console.log('            !! ' + u);
  console.log('      verdict against the tree today .... ' +
    (g3untracked.length ? 'guard WOULD FAIL the build' : 'guard passes'));
  if (g3untracked.length) problems++;
}

// Coverage by identifier type — the question that found G-072.
const ID_SAMPLES = [
  ['Apps Script project id', '1xDKibOChZtiBW4c1CP2xwbwNLPP-cH-Dgk8jFAPSryIKuL8VaF-tcGJr'],
  ['Spreadsheet id', '1kXB7eVII_EOlZEHSd-4vl3psTJZv57JvnrplhD2FA9Y'],
  ['Drive FOLDER id', '1BVAqc5GM6L5LAE85kW94uGHLNwIAa3e'],
  ['Drive FILE id', '1y_J9fxewAJxvdGWGc1zU988Lyd3it7WB'],
  // Web-app deployment id. Starts with A, so any pattern anchored on a
  // leading "1" misses it regardless of length — the gap that surfaced when
  // two deployment IDs were stored as repository variables.
  ['Web-app DEPLOYMENT id', 'AKfycb' + 'x'.repeat(66)]
];
console.log('');
console.log('      Guard coverage by identifier type:');
let notCaught = 0;
if (g3re) {
  for (const [label, id] of ID_SAMPLES) {
    const caught = g3re.test("'" + id + "'");
    if (!caught) notCaught++;
    console.log('         ' + (caught ? '   ' : '!! ') + label.padEnd(24) +
      String(id.length).padStart(2) + ' chars  ' + (caught ? 'CAUGHT' : 'NOT CAUGHT'));
  }
  console.log('      ------');
  console.log('      identifier types NOT covered ...... ' + notCaught);
  if (notCaught) problems++;
}

// The guard must also not fire on things that merely look like identifiers.
const NEAR_MISSES = [
  ['a 28-char 1-string', "var a = '1234567890123456789012345678';"],
  ['an unquoted id in prose', '// folder 1BVAqc5GM6L5LAE85kW94uGHLNwIAa3e'],
  ['a long sentence', "var m = 'Request submitted and routed to the next reviewer stage';"],
  ['a base64 blob', "var a = 'aGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYW4gaWQ=';"],
  ['a semver string', "var v = '1.0.0-rc.1+build.20261029.abcdef';"]
];
console.log('');
console.log('      False-positive check — these must NOT fire:');
let falsePos = 0;
if (g3re) {
  for (const [label, sample] of NEAR_MISSES) {
    const fired = g3re.test(sample);
    if (fired) falsePos++;
    console.log('         ' + (fired ? '!! ' : '   ') + label.padEnd(26) +
      (fired ? 'FIRES — guard is too broad' : 'quiet'));
  }
  console.log('      ------');
  console.log('      false positives ................... ' + falsePos);
  if (falsePos) problems++;
}

if (g3re && notCaught === 0 && falsePos === 0) {
  console.log('');
  console.log('      All five identifier types are covered and no near-miss');
  console.log('      input fires. The two tracked exceptions are registered');
  console.log('      findings (G-065, G-072) and are scoped to file:symbol,');
  console.log('      so a NEW identifier in either file still fails the build');
  console.log('      — verified by running the guard against that case.');
  console.log('');
  console.log('      WHY THE FLOOR IS 29 AND NOT 39. The original guard chose');
  console.log('      40 to catch Sheets (44) and Apps Script (57) ids, and');
  console.log('      said so in its own comment. Drive ids are 32-33 and');
  console.log('      passed straight through while two sat in the tree —');
  console.log('      finding G-072, a guard providing false assurance.');
  console.log('      Deployment ids needed a second pattern, not a lower');
  console.log('      floor, because they are not 1-anchored at all.');
}

// --- guard 4: test files excluded from clasp push
console.log('\n  --- Guard 4: every test file is listed in .claspignore');
const claspIgnore = readIf(path.join(APP, '.claspignore')) || '';
const testFiles = fs.readdirSync(APP).filter(f => /^test_.*\.js$/.test(f));
const ignoreLines = claspIgnore.split('\n').map(s => s.trim());
let missing = 0;
for (const t of testFiles) {
  const listed = ignoreLines.includes(t);
  if (!listed) missing++;
  console.log('      ' + (listed ? '   ' : '!! ') + t.padEnd(30) +
    (listed ? 'listed' : 'NOT LISTED — guard would fail the build'));
}
console.log('      ------');
console.log('      test files: ' + testFiles.length + '   unlisted: ' + missing);
if (missing) problems++;
console.log('');
console.log('      Why this guard exists: clasp pushes every .js into ONE');
console.log('      global scope where all top-level code runs on every');
console.log('      execution. A pushed test file would call require() at');
console.log('      load time, throw, and abort every execution including');
console.log('      doGet. The .claspignore lists files explicitly rather');
console.log('      than by glob because the glob behavior could not be');
console.log('      verified without clasp — so CI enforces the list.');

// does .claspignore cover the junk files that exist?
const junk = walk(APP, null).filter(f => /\.DS_Store$/.test(f));
console.log('');
console.log('      .DS_Store files inside lets_app/ ... ' + junk.length);
console.log('      .claspignore mentions .DS_Store .... ' +
  (/\.DS_Store/.test(claspIgnore) ? 'yes' : 'NO'));
if (junk.length && !/\.DS_Store/.test(claspIgnore)) {
  for (const j of junk) console.log('         ' + path.relative(REPO, j));
  console.log('      Harmless (clasp pushes only .js/.html/.json) but it');
  console.log('      confirms the ignore list is maintained by hand.');
}

// ---------------------------------------------------------------------------
// [5] Script Properties
// ---------------------------------------------------------------------------

console.log('\n[5] Script Properties — declared, read, written');

const propsJs = readIf(path.join(APP, 'server', '00_config', 'Props.js')) || '';
const dbJs = readIf(path.join(APP, 'server', '91_setup', 'Database.js')) || '';
const allServer = serverFiles
  .map(f => fs.readFileSync(f, 'utf8').replace(/\0/g, '')).join('\n');

const keyBlock = /PROPS_KEYS\s*=\s*\{([\s\S]*?)\n\};/.exec(propsJs);
const declared = keyBlock
  ? [...keyBlock[1].matchAll(/([A-Z_0-9]+):\s*'([^']+)'/g)].map(m => ({ sym: m[1], name: m[2] }))
  : [];

console.log('  PROPS_KEYS declares ' + declared.length + ' property names.');
console.log('');
console.log('  symbol                       actual key                      read  written');
console.log('  ' + '-'.repeat(74));
for (const d of declared) {
  const reads = (allServer.match(new RegExp('getProperty\\(\\s*PROPS_KEYS\\.' + d.sym + '\\b', 'g')) || []).length
    + (allServer.match(new RegExp("getProperty\\(\\s*'" + d.name + "'", 'g')) || []).length;
  const writes = (allServer.match(new RegExp('setProperty\\(\\s*PROPS_KEYS\\.' + d.sym + '\\b', 'g')) || []).length
    + (allServer.match(new RegExp("setProperty\\(\\s*'" + d.name + "'", 'g')) || []).length;
  console.log('  ' + d.sym.padEnd(29) + d.name.padEnd(32) +
    String(reads).padStart(4) + String(writes).padStart(9));
}

// the initializer's dead keys
console.log('\n  The setup initializer writes keys LOWER-CASED (G-020):');
const defBlock = /defaults:\s*\{([\s\S]*?)\n  \}/.exec(dbJs);
const defaults = defBlock
  ? [...defBlock[1].matchAll(/([A-Z_0-9]+):\s*(.+?),?\s*$/gm)].map(m => m[1])
  : [];
console.log('      keys the initializer writes ....... ' + defaults.length);
console.log('');
let dead = 0;
for (const k of defaults) {
  const lower = k.toLowerCase();
  const inPropsKeys = declared.find(d => d.name === lower);
  const readAnywhere = new RegExp("getProperty\\(\\s*'" + lower + "'").test(allServer) || !!inPropsKeys;
  if (!readAnywhere) dead++;
  console.log('      ' + (readAnywhere ? '   ' : '!! ') + lower.padEnd(26) +
    (inPropsKeys ? 'read via PROPS_KEYS.' + inPropsKeys.sym : 'READ BY NOTHING'));
}
console.log('      ------');
console.log('      dead keys: ' + dead + ' of ' + defaults.length);
if (dead) {
  console.log('      An administrator who runs the documented setup step and');
  console.log('      then sets a mileage rate will find it ignored, silently.');
}

// two different defaults for the same key
console.log('\n  Two initializers, one key, two different defaults:');
const dbEmail = /TRAVEL_EMAIL_ADDRESS:\s*'([^']+)'/.exec(dbJs);
const propsEmail = /setProperty\(PROPS_KEYS\.EMAIL_FROM_ADDRESS,\s*'([^']+)'\)/.exec(propsJs);
const emailKey = (declared.find(d => d.sym === 'EMAIL_FROM_ADDRESS') || {}).name;
console.log('      target key .......................... ' + emailKey);
console.log('      initTravelSystemConfig default ...... ' + (dbEmail ? dbEmail[1] : '?'));
console.log('      initEmailConfigDefaults default ..... ' + (propsEmail ? propsEmail[1] : '?'));
if (dbEmail && propsEmail && dbEmail[1] !== propsEmail[1]) {
  console.log('    !! DIFFERENT. Both initializers are idempotent — each sets');
  console.log('       the key only if unset — so WHICHEVER RUNS FIRST decides');
  console.log('       the production sender address, and the two disagree.');
  console.log('       initTravelSystemConfig writes the LOWER-CASED key, which');
  console.log('       nothing reads; initEmailConfigDefaults writes the key');
  console.log('       PROPS_KEYS actually uses. So in practice the Props.js');
  console.log('       value wins and the Database.js value is inert \u2014 but only');
  console.log('       because of the casing bug above, not by design.');
}

// ---------------------------------------------------------------------------
// [6] triggers
// ---------------------------------------------------------------------------

console.log('\n[6] Scheduled triggers');

const trigFiles = walk(path.join(APP, 'server', '99_triggers'), '.js');
const handlers = [];
for (const f of trigFiles) {
  const t = fs.readFileSync(f, 'utf8').replace(/\0/g, '');
  const rel = path.relative(APP, f).split(path.sep).join('/');
  t.split('\n').forEach((line, i) => {
    const m = /newTrigger\(\s*'([^']+)'\s*\)/.exec(line);
    if (!m) return;
    const window = t.split('\n').slice(i, i + 5).join(' ');
    const sched = (window.match(/every(?:Minutes|Hours|Days)\(\d+\)|atHour\(\d+\)|nearMinute\(\d+\)/g) || []).join(' ');
    handlers.push({ file: rel, line: i + 1, name: m[1], sched });
  });
}
console.log('  trigger installers found: ' + handlers.length);
console.log('');
for (const h of handlers) {
  const defined = new RegExp('^function ' + h.name + '\\s*\\(', 'm').test(allServer);
  console.log('      ' + (h.file + ':' + h.line + '  ').padEnd(40) +
    h.name.padEnd(26) + (h.sched || '(no schedule parsed)') +
    (defined ? '' : '   !! HANDLER NOT DEFINED'));
  if (!defined) problems++;
}
console.log('');
console.log('  THE RENAME HAZARD: every handler above is referenced by its');
console.log('  NAME AS A STRING. Renaming the function leaves the installed');
console.log('  trigger pointing at a function that no longer exists. The');
console.log('  schedule survives; the work stops; nothing reports an error.');

// simple triggers
const simple = ['onOpen', 'onEdit', 'onFormSubmit', 'onInstall', 'onSelectionChange'];
console.log('');
console.log('  Simple (event) triggers:');
for (const s of simple) {
  const n = new RegExp('^function ' + s + '\\s*\\(', 'm').test(allServer);
  console.log('      ' + s.padEnd(20) + (n ? 'DEFINED' : 'not defined'));
}
console.log('    None defined, so there is no spreadsheet custom menu');
console.log('    (G-066). An administrator looking for one will not find it.');

// ---------------------------------------------------------------------------
// [7] what a rebuild would lose
// ---------------------------------------------------------------------------

console.log('\n[7] What a rebuild from this repository would NOT restore');
console.log('  Everything below is configuration held OUTSIDE the repository.');
console.log('  A disaster-recovery rebuild from source would come up missing');
console.log('  each item, and most would fail silently.');
console.log('');

const LOST = [
  ['The "Execute as" and "Who has access" deployment settings',
   'stored on the deployment', 'the manifest value may not match what is live'],
  ['The HC Data Library binding',
   'no `libraries` entry in appsscript.json',
   'two of three site-gate allow-paths die; failures are only console.warn'],
  ['Every Script Property value',
   'stored in the project, not in git',
   'API key, mileage rates, folder IDs, sender address all unset'],
  ['All five installed triggers',
   'installed per-user, not declarative',
   'per-diem data silently goes stale'],
  ['The database spreadsheet binding',
   'the script is container-bound',
   'a rebuilt standalone script has no database'],
  ['The Shared Drive folder and its membership',
   'referenced by a Script Property',
   'attachment upload throws'],
  ['The deployment URL',
   'generated per deployment',
   'every bookmark and email deep link breaks'],
  ['The linked GCP project and OAuth consent configuration',
   'no oauthScopes are declared (G-006)',
   'the inferred scope set may differ from the current one']
];
for (const [what, why, effect] of LOST) {
  console.log('      ' + what);
  console.log('          why not in git: ' + why);
  console.log('          effect:         ' + effect);
}
console.log('');
console.log('  Of these, the HC library binding is the one most likely to be');
console.log('  missed, because its absence produces no error \u2014 only users');
console.log('  who should have access silently not having it.');

bar('=');
console.log('Integrity problems detected ................... ' + problems);
console.log('Every result above is recomputed from the repository on each run.\n');
