/**
 * pass5_guard_census.js — reproducible evidence for SECURITY_AND_ACCESS_PASS5.md
 *
 * Run from this directory:
 *     node pass5_guard_census.js
 *
 * Reads only. Touches no Google service. Static analysis of
 * lets_app/server/ to re-derive every counted claim in Pass 5, so a reader
 * can confirm the numbers rather than trust them.
 *
 * What it measures, and the Pass 5 section each number backs:
 *   §5.1  Browser-reachable surface (trailing-underscore rule)
 *   §5.2  Role-guard census: which functions contain a real, non-comment
 *         call to requireTravelAdmin / requireRole / isTravelAdmin /
 *         getReviewerContext
 *   §5.3  Session.getActiveUser() census, split authorization vs attribution
 *   §5.5  Hardcoded email-address inventory
 *   §5.7  Google service usage, from which the effective OAuth scope set
 *         is derived (the manifest declares no oauthScopes)
 *
 * Method notes that matter for correctness:
 *   - Comments are stripped before guard detection. Several files *mention*
 *     requireTravelAdmin in JSDoc while not calling it; counting raw text
 *     matches overstates coverage. The two counts are both printed so the
 *     difference is visible.
 *   - Only top-level `function name(` declarations are treated as
 *     browser-reachable. Apps Script exposes exactly these to
 *     google.script.run, minus names ending in `_`.
 *   - A LEADING underscore confers nothing. Only a TRAILING underscore is
 *     private to the platform. Both are reported.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..', '..', 'lets_app', 'server');

// ---------------------------------------------------------------------------
// helpers
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
  // Two server files contain stray NUL bytes (grep reports them as binary).
  // Strip them so line indexing is stable.
  return fs.readFileSync(file, 'utf8').replace(/\0/g, '');
}

/** Blank out // and /* *\/ comments, preserving line count and numbering. */
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

/** Top-level function declarations: [{name, start, end}] (1-based, inclusive). */
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
  return path.relative(path.join(__dirname, '..', '..'), file).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// patterns
// ---------------------------------------------------------------------------

const ROLE_GUARD = /requireTravelAdmin\s*\(|requireRole\s*\(|isTravelAdmin\s*\(|getReviewerContext\s*\(|canAccessTrip\s*\(/;

/**
 * The subset that actually REFUSES: requireRole() throws, and
 * requireTravelAdmin() is a one-line shim over requireRole('admin').
 * isTravelAdmin() / getReviewerContext() / canAccessTrip() only *report* —
 * a function may call them and then ignore the answer. Counting only the
 * throwing guards is what produces the "admin-gated RPC" figure.
 */
const HARD_GUARD = /requireTravelAdmin\s*\(|requireRole\s*\(/;

const PER_RECORD_GUARD = /requireRequestViewer\s*\(|requireRequestEditor\s*\(/;

/**
 * Record-level authorization: the caller's session identity is compared
 * against a field on the specific record. Two flavors, both counted here
 * because both are real checks:
 *   REFUSE — throws / returns an error when the identity does not match
 *   FILTER — silently narrows the result set to the caller's own rows
 * The prose in §5.3 distinguishes them; the count does not.
 */
const RECORD_AUTHZ = new RegExp([
  // refusal messages
  'You can only', 'Only the submitter', 'Only the assigned',
  'Only the request submitter', 'Access denied', 'Edit access denied',
  'not match the submitter', 'editableStatuses', 'REQUEST_EDITABLE_STATUSES',
  // identity comparisons against a record field
  '(?:submitterEmail|assignedReviewer|currentReviewerEmail|ddEmail)' +
    '\\s*(?:===|!==|==|!=)',
  '(?:===|!==|==|!=)\\s*' +
    '(?:submitterEmail|assignedReviewer|currentReviewerEmail|ddEmail|userEmailLower)',
  // the .toLowerCase() === .toLowerCase() idiom used throughout TRIP
  '\\.toLowerCase\\(\\)\\s*(?:===|!==)\\s*\\w*(?:[Ee]mail)\\w*\\.toLowerCase\\(\\)'
].join('|'));

const SESSION_CALL = /Session\.getActiveUser\s*\(\s*\)/;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(?:gov|mil|com|org)/g;

const SERVICES = [
  'SpreadsheetApp', 'DriveApp', 'GmailApp', 'MailApp', 'UrlFetchApp',
  'ScriptApp', 'CacheService', 'PropertiesService', 'HtmlService',
  'LockService', 'Utilities', 'Maps', 'DocumentApp', 'CalendarApp'
];
// Advanced services are bound by userSymbol in appsscript.json, not globals.
const ADVANCED = ['Drive', 'Gmail'];

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

const files = listJsFiles(SERVER_DIR);

const fns = [];                 // every top-level function, annotated
const sessionSites = [];        // every real Session.getActiveUser() call site
const emailHits = new Map();    // address -> [ 'file:line', ... ]
const serviceCounts = new Map();
const advancedCounts = new Map();

for (const file of files) {
  const raw = read(file).split('\n');
  const code = stripComments(raw);

  for (const fn of topLevelFunctions(raw)) {
    const bodyRaw = raw.slice(fn.start - 1, fn.end).join('\n');
    const bodyCode = code.slice(fn.start - 1, fn.end).join('\n');

    fns.push({
      file: rel(file),
      line: fn.start,
      name: fn.name,
      callableFromBrowser: !fn.name.endsWith('_'),
      leadingUnderscore: fn.name.startsWith('_'),
      roleGuardInCode: ROLE_GUARD.test(bodyCode),
      hardGuardInCode: HARD_GUARD.test(bodyCode),
      roleGuardInRawText: ROLE_GUARD.test(bodyRaw),
      perRecordGuard: PER_RECORD_GUARD.test(bodyCode),
      recordAuthz: RECORD_AUTHZ.test(bodyCode),
      usesSession: SESSION_CALL.test(bodyCode)
    });
  }

  code.forEach((line, i) => {
    if (SESSION_CALL.test(line)) {
      const fn = topLevelFunctions(raw).filter(f => f.start <= i + 1).pop();
      sessionSites.push({
        file: rel(file),
        line: i + 1,
        fn: fn ? fn.name : '(top level)'
      });
    }
  });

  // Email addresses: scan raw text so JSDoc/placeholder occurrences are
  // visible too — an address written in a comment is still a disclosure of
  // an internal identity, and several are live defaults.
  raw.forEach((line, i) => {
    const matches = line.match(EMAIL);
    if (!matches) return;
    for (const addr of matches) {
      const key = addr.toLowerCase();
      if (!emailHits.has(key)) emailHits.set(key, []);
      emailHits.get(key).push(`${rel(file)}:${i + 1}`);
    }
  });

  for (const svc of SERVICES) {
    const n = (code.join('\n').match(new RegExp('\\b' + svc + '\\s*\\.', 'g')) || []).length;
    if (n) serviceCounts.set(svc, (serviceCounts.get(svc) || 0) + n);
  }
  for (const svc of ADVANCED) {
    // Avoid double-counting DriveApp/GmailApp as Drive/Gmail.
    const n = (code.join('\n').match(new RegExp('(?<![A-Za-z0-9_])' + svc + '\\.[A-Z]', 'g')) || []).length;
    if (n) advancedCounts.set(svc, (advancedCounts.get(svc) || 0) + n);
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const line = (c) => console.log(c.repeat(78));

console.log('\nPass 5 evidence — security and access census');
console.log('source: lets_app/server/   files analyzed: ' + files.length);
line('=');

// --- §5.1 reachable surface --------------------------------------------------
const callable = fns.filter(f => f.callableFromBrowser);
const privateByUnderscore = fns.filter(f => !f.callableFromBrowser);
const leadingOnly = callable.filter(f => f.leadingUnderscore);

console.log('\n[1] Browser-reachable surface  (Pass 5 §5.1)');
console.log('  top-level function declarations ............ ' + fns.length);
console.log('  trailing underscore (platform-private) ..... ' + privateByUnderscore.length);
console.log('  REACHABLE via google.script.run ............ ' + callable.length);
console.log('  of those, named _foo (leading underscore —');
console.log('  looks private, is NOT) .................... ' + leadingOnly.length);

// --- §5.2 guard census ------------------------------------------------------
const roleGuarded = callable.filter(f => f.roleGuardInCode);
const rawOnly = callable.filter(f => f.roleGuardInRawText && !f.roleGuardInCode);
const recordOnly = callable.filter(f => !f.roleGuardInCode && f.recordAuthz);
const unguarded = callable.filter(f => !f.roleGuardInCode && !f.recordAuthz);

console.log('\n[2] Authorization-guard census  (Pass 5 §5.2)');
console.log('  reachable functions with a REAL role guard . ' + roleGuarded.length);
console.log('  reachable with a record-level check only ... ' + recordOnly.length);
console.log('  reachable with NO check of either kind ..... ' + unguarded.length);
console.log('  --');
console.log('  functions that only MENTION a guard in a');
console.log('  comment (overstated if you grep raw text) .. ' + rawOnly.length);
if (rawOnly.length) {
  for (const f of rawOnly) console.log('      ' + f.file + ':' + f.line + '  ' + f.name);
}

console.log('\n  Role-guarded functions (' + roleGuarded.length + '):');
for (const f of roleGuarded) {
  console.log('      ' + f.file + ':' + f.line + '  ' + f.name);
}

console.log('\n  Record-level-only functions (' + recordOnly.length + '):');
for (const f of recordOnly) {
  const caveat = f.usesSession ? '' : '   <- NOT a session check (see note)';
  console.log('      ' + f.file + ':' + f.line + '  ' + f.name + caveat);
}
const recordNoSession = recordOnly.filter(f => !f.usesSession);
if (recordNoSession.length) {
  console.log('\n  Note: ' + recordNoSession.length + ' function(s) above match the');
  console.log('  record-comparison pattern but never read the session identity —');
  console.log('  they compare an email passed in as an ARGUMENT against sheet');
  console.log('  rows. That is data matching, not authorization. Pass 5 §5.2');
  console.log('  counts them as unguarded in prose; they are listed here so the');
  console.log('  discrepancy between script and prose is explicit, not hidden.');
}

// Of the role-guarded set, the ones living in Access.js ARE the guard
// machinery (isTravelAdmin, requireRole, canAccessTrip ...). They match the
// pattern because they define the check, not because they are protected by
// one. Report the distinction so §5.2's "29 admin-gated RPCs" reconciles.
const guardMachinery = roleGuarded.filter(f => f.file.endsWith('30_services/Access.js'));
console.log('\n  of which live in Access.js and ARE the guard machinery ... ' +
  guardMachinery.length);
console.log('  → genuinely guarded consumers .......................... ' +
  (roleGuarded.length - guardMachinery.length));

// The throwing subset. This is the number that matters operationally: a
// function that calls isTravelAdmin() may branch on the answer, or ignore it.
const hardGuarded = callable.filter(
  f => f.hardGuardInCode && f.name !== 'requireRole' && f.name !== 'requireTravelAdmin'
);
console.log('\n  Functions behind a THROWING guard — requireTravelAdmin()');
console.log('  or requireRole() (Pass 5 §5.2 "admin-gated") ......... ' + hardGuarded.length);
for (const f of hardGuarded) {
  console.log('      ' + f.file + ':' + f.line + '  ' + f.name);
}

// --- per-record guards defined but never called -----------------------------
const perRecordDefs = ['requireRequestViewer', 'requireRequestEditor'];
console.log('\n[3] Per-record guards: defined vs. adopted  (Pass 5 §5.4)');
for (const name of perRecordDefs) {
  const def = fns.find(f => f.name === name);
  let callers = 0;
  for (const file of files) {
    const code = stripComments(read(file).split('\n')).join('\n');
    const hits = (code.match(new RegExp('\\b' + name + '\\s*\\(', 'g')) || []).length;
    // The definition line itself matches; discount exactly one per def site.
    callers += hits - (def && rel(file) === def.file ? 1 : 0);
  }
  console.log('  ' + name.padEnd(22) + ' defined at ' +
    (def ? def.file + ':' + def.line : '(not found)') +
    '   call sites: ' + callers);
}

// --- §5.3 Session census ----------------------------------------------------
const sessionFns = callable.filter(f => f.usesSession);
const sessionAuthz = sessionFns.filter(f => f.roleGuardInCode || f.recordAuthz);
const sessionAttrib = sessionFns.filter(f => !f.roleGuardInCode && !f.recordAuthz);

console.log('\n[4] Session.getActiveUser() census  (Pass 5 §5.3)');
console.log('  real (non-comment) call sites .............. ' + sessionSites.length);
console.log('  distinct reachable functions using it ...... ' + sessionFns.length);
console.log('    identity used for AUTHORIZATION ......... ' + sessionAuthz.length);
console.log('    identity used for ATTRIBUTION only ...... ' + sessionAttrib.length);
console.log('\n  Attribution-only (identity recorded, nothing enforced):');
for (const f of sessionAttrib) {
  console.log('      ' + f.file + ':' + f.line + '  ' + f.name);
}

// --- §5.5 hardcoded emails --------------------------------------------------
console.log('\n[5] Hardcoded email addresses  (Pass 5 §5.5)');
console.log('  distinct addresses in server code .......... ' + emailHits.size);
const sorted = [...emailHits.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [addr, sites] of sorted) {
  console.log('      ' + String(sites.length).padStart(3) + 'x  ' + addr.padEnd(34) +
    sites[0] + (sites.length > 1 ? ' (+' + (sites.length - 1) + ' more)' : ''));
}

// --- §5.7 service usage -> scope derivation ---------------------------------
console.log('\n[6] Google service usage  (Pass 5 §5.7 — scope derivation)');
console.log('  appsscript.json declares no oauthScopes, so the effective');
console.log('  scope set is whatever these calls require at first auth.');
const svcSorted = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [svc, n] of svcSorted) {
  console.log('      ' + String(n).padStart(4) + '  ' + svc);
}
for (const [svc, n] of [...advancedCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log('      ' + String(n).padStart(4) + '  ' + svc + '   (advanced service)');
}

// --- §5.10 validation-library adoption --------------------------------------
console.log('\n[7] Validation.js adoption  (Pass 5 §5.10.1)');
const VALIDATORS = [
  'requireString', 'requireNumber', 'requireNonNegativeNumber',
  'requirePositiveNumber', 'requireBoolean', 'requireArray',
  'requireNonEmptyArray', 'requireEnum', 'requireObject',
  'requireRequestId', 'requireEmail', 'requireDateString'
];
// Call sites are counted OUTSIDE both the library itself and the
// self-test in 99_triggers/CacheWarming.js. Anything left is real adoption.
let adoptionTotal = 0;
for (const name of VALIDATORS) {
  let real = 0;
  const where = [];
  for (const file of files) {
    const r = rel(file);
    if (r.endsWith('10_lib/Validation.js')) continue;
    if (r.endsWith('99_triggers/CacheWarming.js')) continue;  // self-test
    const code = stripComments(read(file).split('\n'));
    code.forEach((l, i) => {
      if (new RegExp('\\b' + name + '\\s*\\(').test(l)) {
        real++;
        where.push(r + ':' + (i + 1));
      }
    });
  }
  adoptionTotal += real;
  console.log('      ' + name.padEnd(26) + ' real call sites: ' + real +
    (where.length ? '  ' + where.slice(0, 3).join(', ') : ''));
}
console.log('  ------');
console.log('  TOTAL real adoption of the 12-guard library ... ' + adoptionTotal);

// Contrast: the ad-hoc helper that WAS adopted.
let isValidEmail = 0;
for (const file of files) {
  const code = stripComments(read(file).split('\n')).join('\n');
  const hits = (code.match(/\b_isValidEmail\s*\(/g) || []).length;
  // discount the single definition site
  isValidEmail += hits - (code.includes('function _isValidEmail(') ? 1 : 0);
}
console.log('  For contrast — _isValidEmail() call sites ..... ' + isValidEmail);

line('=');
console.log('Done. Every number above is recomputed from source on each run.\n');
