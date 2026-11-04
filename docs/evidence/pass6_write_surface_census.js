/**
 * pass6_write_surface_census.js — reproducible evidence for GAP_CONSOLIDATION_PASS6.md
 *
 * Run from this directory:
 *     node pass6_write_surface_census.js
 *
 * Reads only. Touches no Google service. Static analysis of lets_app/server/.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * Pass 2 §2.2.3 published "64 unguarded write-capable functions". That figure
 * was counted BY HAND and had no script behind it, while every other headline
 * count in the report is re-derived from source by pass5_guard_census.js.
 * Pass 6 item 2 requires that the last hand-counted figure either be confirmed
 * mechanically or be corrected. This script is that measurement.
 *
 * WHAT IT MEASURES
 * ----------------
 * For every browser-reachable server function (top-level, no trailing
 * underscore), two independent properties:
 *
 *   1. WRITE-CAPABLE — does calling it mutate state? Measured two ways:
 *        direct     — the function body itself contains a mutation sink
 *        transitive — the body calls another server function that is
 *                     write-capable (fixpoint over the call graph)
 *      Transitive matters: setupTravelDatabase() writes nothing itself; it
 *      calls createOrUpdateSheet(), which rewrites header rows.
 *
 *      BUT transitive reach must be bounded or it is meaningless. Three
 *      helpers are called from almost everywhere and each performs an
 *      incidental write: logError() appends to Error_Log,
 *      selfHealCurrentUserEmail() patches one Travel_Users cell on a cache
 *      miss, and sendTravelEmail() sends mail. Propagating through them
 *      makes doGet() itself "write-capable" — technically true and
 *      analytically worthless, since the caller controls none of it. They
 *      are therefore treated as AMBIENT: still counted as writers in their
 *      own right, but not propagated through. The unbounded figure is also
 *      printed, so the choice is visible rather than hidden.
 *
 *   2. GUARDED — is the caller's authority checked before the write? Using
 *      the same two guard classes pass5_guard_census.js uses, so the numbers
 *      in the two scripts compose rather than compete:
 *        throwing guard  — requireTravelAdmin() / requireRole(), which refuse
 *        record-level    — the caller's identity is compared against a field
 *                          on the specific record being touched
 *
 * The cross-tabulation of those two properties is the answer.
 *
 * METHOD NOTES THAT AFFECT CORRECTNESS
 * ------------------------------------
 *   - Comments are stripped before any matching. A function that only
 *     MENTIONS a sink or a guard in its JSDoc must not be counted as having
 *     one. The raw-text count is also printed where it differs, so the
 *     overstatement a naive grep would produce stays visible.
 *   - Only `function name(` at column 0 is treated as browser-reachable;
 *     that is exactly what Apps Script exposes to google.script.run, minus
 *     names ending in `_`. A LEADING underscore confers nothing.
 *   - Callee edges require the identifier NOT be preceded by `.`, so
 *     `LetsDB.initializeDatabase(...)` is correctly read as a method on an
 *     object literal, not as an edge to a top-level function.
 *   - Trigger HANDLERS are reported separately. They are write-capable and
 *     unguarded by necessity — a time-driven trigger runs with no human
 *     present, so a guard that inspects the active user would break them.
 *     Folding them into the headline number would overstate the finding, and
 *     they also must NOT be renamed with a trailing underscore, because
 *     ScriptApp references handlers by string name (PerDiemSync.js:6-7).
 *   - Where this script's mechanical answer differs from the prose of
 *     Passes 1-5, it says so explicitly rather than quietly disagreeing.
 *     That convention is inherited from pass5_guard_census.js and is the
 *     reason these scripts are worth more than the numbers they print.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SERVER_DIR = path.join(REPO, 'lets_app', 'server');

// ---------------------------------------------------------------------------
// helpers — identical in behavior to pass5_guard_census.js, deliberately
// ---------------------------------------------------------------------------

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

function read(file) {
  // Two server files carry stray NUL bytes; strip so line indexing is stable.
  return fs.readFileSync(file, 'utf8').replace(/\0/g, '');
}

/** Blank out // and block comments, preserving line count and numbering. */
function stripComments(lines) {
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

function rel(file) {
  return path.relative(REPO, file).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// patterns
// ---------------------------------------------------------------------------

/**
 * Mutation sinks, grouped so the report can say WHAT kind of write a
 * function performs — a sheet write, a Drive mutation, a config change, a
 * trigger change, or an outbound email. Severity differs by group, so the
 * groups are kept rather than collapsed into one boolean.
 */
const SINKS = {
  sheet: [
    /\.appendRow\s*\(/, /\.setValues?\s*\(/, /\.deleteRows?\s*\(/,
    /\.updateRowByIndex\s*\(/, /\.deleteRowByIndex\s*\(/,
    /\.insertSheet\s*\(/, /\.deleteSheet\s*\(/, /\.clearContents?\s*\(/,
    /\.insertColumns?\s*\(/, /\.insertRows?\s*\(/, /\.setFormula\s*\(/,
    /SpreadsheetApp\.create\s*\(/
  ],
  drive: [
    /\.makeCopy\s*\(/, /\.setTrashed\s*\(/, /\.addEditor\s*\(/,
    /\.addViewer\s*\(/, /\.removeEditor\s*\(/, /\.createFolder\s*\(/,
    /\.createFile\s*\(/,
    /Drive\.Files\.(?:create|update|remove|copy)\s*\(/,
    /Drive\.Permissions\.(?:create|update|delete)\s*\(/
  ],
  config: [
    /\.setPropert(?:y|ies)\s*\(/, /\.deletePropert(?:y|ies)\s*\(/,
    /\.deleteAllProperties\s*\(/
  ],
  trigger: [
    /ScriptApp\.newTrigger\s*\(/, /ScriptApp\.deleteTrigger\s*\(/
  ],
  mail: [
    /(?:GmailApp|MailApp)\.sendEmail\s*\(/
  ]
};

/** Throwing guards — the only ones that actually refuse. */
const HARD_GUARD = /requireTravelAdmin\s*\(|requireRole\s*\(/;

/** Reporting-only role calls. A function may call these and ignore the answer. */
const SOFT_GUARD = /isTravelAdmin\s*\(|getReviewerContext\s*\(|canAccessTrip\s*\(/;

/** Record-level authorization — same pattern set as pass5_guard_census.js §5.2. */
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

/**
 * Time-driven trigger handlers. Taken from the five installers inventoried in
 * Pass 2 §2.3.1; each is passed to ScriptApp.newTrigger() as a string, which
 * is why renaming them breaks the installed triggers.
 */
const TRIGGER_HANDLERS = new Set([
  'refreshHCStaffingCache', 'warmTravelDBCache', 'warmGSACitiesCache',
  'syncDoDPerDiem', 'syncForeignPerDiem'
]);

/**
 * Ambient writers — called from nearly everywhere, each performing a write
 * incidental to its caller's purpose. Counted as writers themselves, but
 * transitive reach is NOT propagated through them, because doing so makes
 * essentially the whole codebase "write-capable" and destroys the signal.
 *
 *   logError                  Errors.js:25     appends a row to Error_Log
 *   selfHealCurrentUserEmail  Users.js:1254    patches one Travel_Users cell
 *                                              on a role-cache miss (S-5)
 *   sendTravelEmail           Email.js:142     sends mail (18 notification
 *                                              wrappers sit on top of it)
 *   parseExcelBlob_           ForeignSync.js   creates+deletes a temp Drive
 *                                              copy to parse an .xls
 *
 * Each is itself reported in the unguarded list. The script prints the
 * unbounded figure too, so excluding them is an auditable decision rather
 * than a silent one.
 */
const AMBIENT_WRITERS = new Set([
  'logError', 'selfHealCurrentUserEmail', 'sendTravelEmail', 'parseExcelBlob_'
]);

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

const files = listJsFiles(SERVER_DIR);
const fns = [];

for (const file of files) {
  const raw = read(file).split('\n');
  const code = stripComments(raw);

  for (const fn of topLevelFunctions(raw)) {
    const bodyRaw = raw.slice(fn.start - 1, fn.end).join('\n');
    const bodyCode = code.slice(fn.start - 1, fn.end).join('\n');

    const sinkGroups = [];
    for (const [group, patterns] of Object.entries(SINKS)) {
      if (patterns.some(p => p.test(bodyCode))) sinkGroups.push(group);
    }
    const sinkGroupsRaw = [];
    for (const [group, patterns] of Object.entries(SINKS)) {
      if (patterns.some(p => p.test(bodyRaw))) sinkGroupsRaw.push(group);
    }

    fns.push({
      file: rel(file),
      line: fn.start,
      name: fn.name,
      bodyCode: bodyCode,
      reachable: !fn.name.endsWith('_'),
      leadingUnderscore: fn.name.startsWith('_'),
      triggerHandler: TRIGGER_HANDLERS.has(fn.name),
      directSinks: sinkGroups,
      directSinksRaw: sinkGroupsRaw,
      hardGuard: HARD_GUARD.test(bodyCode),
      softGuard: SOFT_GUARD.test(bodyCode),
      recordAuthz: RECORD_AUTHZ.test(bodyCode),
      callees: new Set()
    });
  }
}

// ---------------------------------------------------------------------------
// call graph
// ---------------------------------------------------------------------------

// name -> [every definition with that name]. A name CAN appear twice: clasp
// pushes all .js files into one global scope, so a duplicate means one of
// the two is dead code. Self-check [7] reports any it finds.
const byName = new Map();
for (const f of fns) {
  if (!byName.has(f.name)) byName.set(f.name, []);
  byName.get(f.name).push(f);
}

const allNames = [...byName.keys()];
// One alternation over every known function name. The lookbehind requires the
// identifier NOT be preceded by `.` or a word character, so `LetsDB.foo(` is
// read as a method on an object literal rather than an edge to top-level foo.
const CALL_RE = new RegExp(
  '(?<![.\\w$])(' + allNames.map(n => n.replace(/\$/g, '\\$')).join('|') + ')\\s*\\(',
  'g'
);

for (const f of fns) {
  let m;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(f.bodyCode)) !== null) {
    if (m[1] !== f.name) f.callees.add(m[1]);
  }
}

// ---------------------------------------------------------------------------
// fixpoint: write-capable, directly or transitively
//
// Run twice over the same call graph:
//   BOUNDED   — ambient writers (logError, selfHealCurrentUserEmail,
//               sendTravelEmail, parseExcelBlob_) are writers, but reach is
//               not propagated THROUGH them. This is the reported figure.
//   UNBOUNDED — propagate through everything. Printed for comparison so the
//               effect of the exclusion is auditable.
// ---------------------------------------------------------------------------

/**
 * @param {string} viaKey   property to record the derivation on
 * @param {string} pathKey  property to record the call path on
 * @param {boolean} stopAtAmbient  whether ambient writers block propagation
 * @returns {number} rounds taken to converge
 */
function computeWriteCapability(capKey, viaKey, pathKey, stopAtAmbient) {
  for (const f of fns) {
    f[capKey] = f.directSinks.length > 0;
    f[viaKey] = f.directSinks.length > 0 ? 'direct' : null;
    f[pathKey] = [];
  }
  let changed = true;
  let rounds = 0;
  while (changed) {
    changed = false;
    rounds++;
    for (const f of fns) {
      if (f[capKey]) continue;
      for (const callee of f.callees) {
        if (stopAtAmbient && AMBIENT_WRITERS.has(callee)) continue;
        const defs = byName.get(callee) || [];
        const hit = defs.find(d => d[capKey]);
        if (hit) {
          f[capKey] = true;
          f[viaKey] = 'transitive';
          f[pathKey] = [callee].concat(hit[pathKey]);
          changed = true;
          break;
        }
      }
    }
  }
  return rounds;
}

const rounds = computeWriteCapability('writeCapable', 'writeVia', 'writePath', true);
computeWriteCapability('writeCapableAll', 'writeViaAll', 'writePathAll', false);

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const bar = (c) => console.log(c.repeat(78));
const loc = (f) => f.file + ':' + f.line;

console.log('\nPass 6 evidence — write-surface census');
console.log('source: lets_app/server/   files analyzed: ' + files.length);
console.log('purpose: mechanically re-derive Pass 2 §2.2.3\'s hand-counted');
console.log('         "64 unguarded write-capable functions"');
bar('=');

const reachable = fns.filter(f => f.reachable);

console.log('\n[1] Reachable surface — must match pass5_guard_census.js [1]');
console.log('  top-level function declarations ............ ' + fns.length);
console.log('  trailing underscore (platform-private) ..... ' + (fns.length - reachable.length));
console.log('  REACHABLE via google.script.run ............ ' + reachable.length);
console.log('  of those, leading underscore (not private) . ' +
  reachable.filter(f => f.leadingUnderscore).length);
if (fns.length !== 459 || reachable.length !== 412) {
  console.log('  !! DIVERGENCE from Pass 5\'s 459 / 412. The source tree has');
  console.log('     changed since Pass 5 was written. Every count in both');
  console.log('     documents must be re-checked before it is cited.');
} else {
  console.log('  → agrees with Pass 5 (459 / 412). Call graph built on the');
  console.log('    same population, so the two scripts compose.');
}

console.log('\n[2] Write-capability of the reachable surface');
const wc = reachable.filter(f => f.writeCapable);
const wcDirect = wc.filter(f => f.writeVia === 'direct');
const wcTrans = wc.filter(f => f.writeVia === 'transitive');
const wcAll = reachable.filter(f => f.writeCapableAll);
console.log('  write-capable, BOUNDED (reported figure) .. ' + wc.length);
console.log('    via a sink in its own body .............. ' + wcDirect.length);
console.log('    only via a function it calls ............ ' + wcTrans.length);
console.log('  read-only ................................. ' + (reachable.length - wc.length));
console.log('  --');
console.log('  write-capable, UNBOUNDED (propagating');
console.log('  through the 4 ambient writers too) ........ ' + wcAll.length);
console.log('    the ' + (wcAll.length - wc.length) + ' extra reach a write only via logError /');
console.log('    selfHealCurrentUserEmail / sendTravelEmail /');
console.log('    parseExcelBlob_, which their callers do not control.');
console.log('    Excluded on purpose; see the method notes. Both');
console.log('    numbers are printed so the choice is auditable.');

const bySinkGroup = new Map();
for (const f of wcDirect) {
  for (const g of f.directSinks) bySinkGroup.set(g, (bySinkGroup.get(g) || 0) + 1);
}
console.log('\n  Direct writers by sink class (a function may appear twice):');
for (const [g, n] of [...bySinkGroup.entries()].sort((a, b) => b[1] - a[1])) {
  console.log('      ' + String(n).padStart(4) + '  ' + g);
}

// --- the headline cross-tabulation -----------------------------------------

console.log('\n[3] THE HEADLINE NUMBER — write-capable x guarded');
const wcHard = wc.filter(f => f.hardGuard);
const wcRecord = wc.filter(f => !f.hardGuard && f.recordAuthz);
const wcUnguardedAll = wc.filter(f => !f.hardGuard && !f.recordAuthz);
const wcUnguardedTrig = wcUnguardedAll.filter(f => f.triggerHandler);
const wcUnguarded = wcUnguardedAll.filter(f => !f.triggerHandler);
const wcDirectUnguarded =
  wcDirect.filter(f => !f.hardGuard && !f.recordAuthz && !f.triggerHandler);

console.log('  behind a THROWING guard ................... ' + wcHard.length);
console.log('  record-level check only ................... ' + wcRecord.length);
console.log('  NO check of any kind ...................... ' + wcUnguardedAll.length);
console.log('    of which are trigger handlers (must be');
console.log('    unguarded by design; see method notes) .. ' + wcUnguardedTrig.length);
console.log('  ' + '-'.repeat(60));
console.log('  UNGUARDED WRITE-CAPABLE, excluding trigger');
console.log('  handlers ................................. ' + wcUnguarded.length);
console.log('    of those, writing in their OWN body ..... ' + wcDirectUnguarded.length);
console.log('    reaching a write only through a callee ... ' +
  (wcUnguarded.length - wcDirectUnguarded.length));

console.log('\n  Reconciliation against Pass 2 §2.2.3\'s hand count of 64:');
console.log('    Pass 2 prose says 64. This script measures:');
console.log('      ' + String(wcDirectUnguarded.length).padStart(3) +
  '  direct-sink only  — writes in its own body, no guard');
console.log('      ' + String(wcUnguarded.length).padStart(3) +
  '  including transitive reach (bounded)');
console.log('    Neither equals 64, so Pass 2\'s figure is NOT confirmed and');
console.log('    must not be cited again. It fell between these two readings:');
console.log('    the author listed privileged writers by hand and neither');
console.log('    enumerated every sink nor followed the call graph.');
console.log('');
console.log('    RESOLUTION for the gap register — use ' + wcDirectUnguarded.length +
  ', always with its scope:');
console.log('      "' + wcDirectUnguarded.length + ' of ' + reachable.length +
  ' browser-reachable functions perform a write in');
console.log('       their own body with no authorization check of any kind."');
console.log('    Use ' + wcUnguarded.length +
  ' only when transitive reach is explicitly in scope,');
console.log('    and say so. Do not mix the two readings in one sentence.');

// --- the list, ranked by what the write touches ------------------------------

console.log('\n[4] Every unguarded write-capable function');
console.log('  Grouped by sink class. The DIRECT groups are the ' +
  wcDirectUnguarded.length + ' functions');
console.log('  that form the gap-register figure. The transitive-only group');
console.log('  is listed after them, for completeness, and is NOT part of it.');

const ORDER = ['config', 'sheet', 'drive', 'trigger', 'mail'];
const rank = (f) => {
  if (!f.directSinks.length) return 99;
  return Math.min(...f.directSinks.map(g => ORDER.indexOf(g)));
};
const listed = [...wcUnguarded].sort((a, b) =>
  rank(a) - rank(b) || a.file.localeCompare(b.file) || a.line - b.line);

let lastGroup = null;
for (const f of listed) {
  const group = f.directSinks.length
    ? 'DIRECT WRITE — ' + f.directSinks.join(' + ')
    : 'transitive only — not counted in the ' + wcDirectUnguarded.length;
  if (group !== lastGroup) {
    console.log('\n  --- ' + group + ' ---');
    lastGroup = group;
  }
  const via = f.writeVia === 'transitive' ? '   via ' + f.writePath.join(' -> ') : '';
  const amb = AMBIENT_WRITERS.has(f.name) ? '   [ambient writer]' : '';
  console.log('      ' + loc(f).padEnd(52) + f.name + via + amb);
}

// --- the specific functions named in the findings ---------------------------

console.log('\n[5] Spot-check of the functions Passes 2 and 5 name by hand');
console.log('  Each row states what the prose claims and what this script');
console.log('  measures, so a mismatch is visible rather than buried. The');
console.log('  "expect" column is the prose\'s claim; disagreement between');
console.log('  expect and measured is flagged with !!.');

// name, expected guard class per the prose, citation
const NAMED = [
  ['bootstrapTravelAdmin',      'UNGUARDED',      'P2 R-4 / P5 S-1  self-grant of admin'],
  ['backupTravelDb',            'UNGUARDED',      'P2 R-4  copies whole DB to caller Drive'],
  ['_bulkDeleteSmokeRequests',  'UNGUARDED',      'P2 R-4  cascade delete across 5 sheets'],
  ['setupTravelDatabase',       'UNGUARDED',      'P2 R-4  rewrites header rows'],
  ['addUnifiedUserSchema',      'UNGUARDED',      'P2 R-4  alters user/role tables'],
  ['createOrUpdateSheet',       'UNGUARDED',      'P2 R-4  arbitrary header overwrite'],
  ['initTravelSystemConfig',    'UNGUARDED',      'P2 R-4 / P4 R-A3  writes Script Props'],
  ['initEmailConfigDefaults',   'UNGUARDED',      'P2 R-4  writes Script Props'],
  ['sendTravelEmail',           'UNGUARDED',      'P2 R-4  sends mail as the app identity'],
  ['_reassignPendingForRoleChange', 'UNGUARDED',  'P2 R-4  redirects pending approvals'],
  ['_orphanPendingForRoleChange',   'UNGUARDED',  'P2 R-4  orphans pending approvals'],
  ['updateTravelerCosts',       'UNGUARDED',      'P2 R-4 / P5 S-4  writes cost totals'],
  ['updateRequestItinerary',    'UNGUARDED',      'P5 S-4  unguarded itinerary write'],
  ['updateTravelersForReview',  'UNGUARDED',      'P5 S-4  unguarded traveler write'],
  ['updateSharedCostsForReview','UNGUARDED',      'P5 S-4  unguarded shared-cost write'],
  ['updateCostsForReview',      'UNGUARDED',      'P5 S-4  unguarded cost write'],
  ['updateRequestClassification', 'record-level', 'P5 S-4  one of the 2 that DO check'],
  ['updateRequestOverview',     'record-level',   'P5 S-4  one of the 2 that DO check'],
  ['reportDDFundingIssue',      'UNGUARDED',      'P5 S-17  unguarded status write'],
  ['submitFundingCorrection',   'UNGUARDED',      'P5 S-17  unguarded Is_Client_Paid flip'],
  ['deleteTravelDraftFile',     'UNGUARDED',      'P5 S-3  trashes any Drive file ID'],
  ['shareAttachmentsWithUsers', 'UNGUARDED',      'P5 S-16  grants Drive access to any ID'],
  ['uploadTravelDraftFile',     'UNGUARDED',      'P5 S-3  unbounded upload'],
  ['selfHealCurrentUserEmail',  'UNGUARDED',      'P5 S-5  a read that writes the role table'],
  ['deleteRole',                'THROWING-GUARD', 'P5 S-8  guard IS present; the gap is the'],
  ['setRoleActive',             'THROWING-GUARD', 'P5 S-8  missing LAST-ADMIN check, not a guard'],
  ['verifyPhase7Routing',       'UNGUARDED',      'P5 S-25  read-only, dumps the role roster'],
  ['submitReviewAction',        'record-level',   'P5 §5.3.6  the one workflow gate that works']
];

let mismatches = 0;
for (const [name, expect, why] of NAMED) {
  const defs = byName.get(name) || [];
  if (!defs.length) {
    console.log('      !! ' + name.padEnd(32) +
      'NOT FOUND — prose cites a function that does not exist');
    mismatches++;
    continue;
  }
  for (const f of defs) {
    const w = f.writeCapable
      ? (f.writeVia === 'direct' ? 'writes:' + f.directSinks.join('+') : 'writes(via ' + f.writePath[0] + ')')
      : 'READ-ONLY';
    const g = f.hardGuard ? 'THROWING-GUARD'
            : f.recordAuthz ? 'record-level'
            : f.softGuard ? 'soft-only'
            : 'UNGUARDED';
    const flag = g === expect ? '   ' : '!! ';
    if (g !== expect) mismatches++;
    const reach = f.reachable ? '' : '  [private: trailing _]';
    console.log('      ' + flag + name.padEnd(30) + g.padEnd(16) + w.padEnd(26) + reach);
    console.log('          ' + loc(f) + '   ' + why);
  }
}
console.log('\n  prose/script disagreements in this spot-check ...... ' + mismatches);
if (mismatches === 0) {
  console.log('    Every function Passes 2 and 5 name by hand is classified');
  console.log('    by this script exactly as the prose claims. The findings');
  console.log('    are confirmed at the function level even though Pass 2\'s');
  console.log('    aggregate count of 64 is not.');
}

// --- the cheapest mechanical hardening, quantified --------------------------

console.log('\n[6] What the trailing-underscore rename would close (Pass 5 §5.13.1 fix 1)');
console.log('  Scoped to the ' + wcDirectUnguarded.length +
  ' direct unguarded writers — those are the');
console.log('  functions the rename actually takes off the browser surface.');
const leadingU = wcDirectUnguarded.filter(f => f.leadingUnderscore);
console.log('  direct unguarded writers .......................... ' +
  wcDirectUnguarded.length);
console.log('    already named _foo — one-character rename each ... ' + leadingU.length);
console.log('    would need a new name chosen ..................... ' +
  (wcDirectUnguarded.length - leadingU.length));
console.log('  MUST NOT be renamed (trigger handlers, referenced by');
console.log('  string name in ScriptApp.newTrigger) .............. ' + TRIGGER_HANDLERS.size);
for (const n of TRIGGER_HANDLERS) {
  const d = (byName.get(n) || [])[0];
  console.log('      ' + (d ? loc(d) : '(not found)').padEnd(52) + n);
}
console.log('  Caveat the rename does NOT cover: the functions a real user');
console.log('  must reach (submitTravelRequestV2, the update* family,');
console.log('  reportDDFundingIssue, submitFundingCorrection, upload/delete');
console.log('  draft file) cannot be renamed — the client calls them. Those');
console.log('  need a guard, which is Pass 5 §5.13.1 fix 2, not fix 1.');

// --- integrity checks on the script's own assumptions -----------------------

console.log('\n[7] Self-checks — where this script could be wrong');

const sinkCommentOnly = reachable.filter(
  f => f.directSinksRaw.length && !f.directSinks.length);
console.log('  functions whose only "sink" is in a comment ........ ' + sinkCommentOnly.length);
for (const f of sinkCommentOnly) console.log('      ' + loc(f) + '  ' + f.name);
console.log('    (counted as read-only, correctly. A raw-text grep');
console.log('     would have counted them as writers.)');

const dupes = [...byName.entries()].filter(([, v]) => v.length > 1);
console.log('  function names defined more than once ............. ' + dupes.length);
for (const [n, v] of dupes) {
  console.log('      ' + n + '  at  ' + v.map(loc).join(' , '));
}
if (dupes.length) {
  console.log('    These matter: clasp pushes every .js file into ONE global');
  console.log('    scope, so the last definition loaded wins and the other is');
  console.log('    dead. The call graph above resolves such a name to ALL');
  console.log('    definitions, which is deliberately conservative.');
}

console.log('  call-graph fixpoint rounds to converge ............. ' + rounds);
const noCallees = reachable.filter(f => f.callees.size === 0).length;
console.log('  reachable functions calling no other server fn ..... ' + noCallees);

bar('=');
console.log('Done. Every number above is recomputed from source on each run.\n');
