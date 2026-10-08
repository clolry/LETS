/**
 * test_gas_module_load.js
 * Loads the LETS server tree the way GOOGLE APPS SCRIPT loads it, and asserts
 * the LETS modules are actually usable afterward.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * test_budget_engine.js exercises the modules through `require()`. The LETS
 * modules are UMD-wrapped, so `require()` takes the `module.exports` branch —
 * a branch that DOES NOT EXIST in Apps Script. Every assertion in that suite
 * passed while the Apps Script branch was broken, because the broken branch
 * was never executed.
 *
 * Apps Script has no module system. Every .js file in the project is evaluated
 * as a classic script in ONE shared global scope, in alphabetical push order,
 * on every execution. This suite reproduces that: a single `vm` context, files
 * fed in sorted-path order, with `module` and `require` absent.
 *
 * THE BUG THIS LOCKS DOWN
 * -----------------------
 * The Apps Script branch read config off the global object:
 *
 *     root.LetsDB = factory(root.LETS_CONFIG);   // undefined
 *
 * `LETS_CONFIG` is declared `const` in 00_config/BudgetConfig.js. Per
 * ECMAScript, top-level `const`/`let` bind into the global *lexical* record
 * and are deliberately NOT properties of the global object, so `root.LETS_CONFIG`
 * evaluated to `undefined` while bare `LETS_CONFIG` resolved fine. Consequences:
 *
 *   - LetsDB.js threw TypeError at FILE LOAD (it touches CONFIG.sheets in a
 *     computed key), which in Apps Script aborts the whole execution — doGet
 *     included. The deployed web app was down.
 *   - BudgetEngine.js and RequestService.js loaded cleanly with CONFIG
 *     undefined and threw only when a figure was requested, so the budget
 *     gatekeeper and both dashboards failed at call time.
 *
 * Assignment is the asymmetry: `root.LetsDB = ...` DOES create a real global
 * property, so reading `BudgetEngine`/`LetsDB` off `root` happened to work.
 * Only the `const`-declared config was invisible.
 *
 * Controls: SA-11 (developer testing), CM-2 (baseline configuration),
 * SI-17 (fail-safe). AGENTS.md §8.1, §12.3 (regression test for a fixed bug),
 * §14.4 (wiring complete).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SERVER_ROOT = path.join(__dirname, 'server');

let failures = 0;
function pass(msg) { console.log('\u2714 ' + msg); }
function fail(msg) { failures++; console.error('\u2718 ' + msg); }

/**
 * Collects every .js file under a directory as absolute paths.
 *
 * Kept separate from relativizing: an earlier version relativized inside the
 * recursion, which double-relativized anything in a subdirectory.
 */
function collectJsFilesAbsolute(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectJsFilesAbsolute(full);
      return entry.name.endsWith('.js') ? [full] : [];
    });
}

/**
 * Server files as sorted paths relative to SERVER_ROOT.
 * Sorted relative path approximates Apps Script's alphabetical load order,
 * which is what the numeric directory prefixes (00_config, 01_constants, ...)
 * exist to control.
 */
function collectServerFiles() {
  return collectJsFilesAbsolute(SERVER_ROOT)
    .map(full => path.relative(SERVER_ROOT, full))
    .sort();
}

/**
 * Minimal stand-ins for the Apps Script service globals.
 *
 * Deliberately models a BRAND-NEW, UNCONFIGURED project: PropertiesService
 * returns no properties. That is the fail-closed posture the environment gate
 * in 00_config/TripConfig.js is built to handle, and it keeps this suite from
 * needing any credentials or network access.
 *
 * Only what top-level code legitimately touches is stubbed. Anything else is
 * left absent on purpose — a file that reaches for an unstubbed service at
 * load time SHOULD fail this suite, because load-time work is what breaks
 * every execution in Apps Script.
 */
function createAppsScriptStubs() {
  return {
    console: console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
        setProperty: () => {},
        getProperties: () => ({})
      })
    }
  };
}

console.log('--- Starting Apps Script Module Load Test Suite ---\n');

// ===========================================================================
// 1. Every server file must load in one shared global scope
// ===========================================================================

const files = collectServerFiles();
assert.ok(files.length > 0, 'Found no .js files under server/ — check SERVER_ROOT.');

const context = vm.createContext(createAppsScriptStubs());

// Guard the premise of the whole suite: if `module` leaked into the context,
// the UMD wrappers would take the Node branch and we would be testing the
// wrong code path — exactly the blind spot this suite exists to close.
assert.strictEqual(
  vm.runInContext('typeof module', context), 'undefined',
  '`module` is defined in the simulated Apps Script scope. The UMD wrappers ' +
  'would take the Node branch and this suite would not test Apps Script.'
);
assert.strictEqual(
  vm.runInContext('typeof require', context), 'undefined',
  '`require` is defined in the simulated Apps Script scope.'
);

console.log('1. Loading ' + files.length + ' server files in shared global scope:');

const loadErrors = [];
for (const relPath of files) {
  const source = fs.readFileSync(path.join(SERVER_ROOT, relPath), 'utf8');
  try {
    vm.runInContext(source, context, { filename: relPath });
  } catch (err) {
    loadErrors.push({ relPath, err });
  }
}

if (loadErrors.length === 0) {
  console.log('   All ' + files.length + ' files loaded with no module system present');
  pass('Server tree loads cleanly as classic scripts in one shared scope');
} else {
  loadErrors.forEach(({ relPath, err }) => {
    console.error('   LOAD FAILED: ' + relPath + ' -> ' + err.constructor.name + ': ' + err.message);
  });
  fail(loadErrors.length + ' file(s) failed to load. In Apps Script a load-time ' +
    'throw aborts the entire execution, including doGet — the web app would be down.');
}

// ===========================================================================
// 2. The LETS modules must be reachable as bare globals
// ===========================================================================
// Later files (page servers, domain services, triggers) refer to these by bare
// identifier. A module that loads but leaves no usable binding is inert.

console.log('\n2. Global bindings exposed to later files:');

const expectedGlobals = [
  ['LETS_CONFIG',        'object', '00_config/BudgetConfig.js'],
  ['FAS_TRACKER_TARGET', 'object', '00_config/TripConfig.js'],
  ['TRAVEL_PURPOSES',    'object', '00_config/TripConfig.js'],
  ['LetsDB',             'object', '20_data/LetsDB.js'],
  ['BudgetEngine',       'object', '30_services/BudgetEngine.js'],
  ['FASTrackerSync',     'object', '30_services/FASTrackerSync.js'],
  ['RequestService',     'object', '40_domain/RequestService.js']
];

let bindingsOk = true;
for (const [name, expectedType, origin] of expectedGlobals) {
  const actualType = vm.runInContext('typeof ' + name, context);
  if (actualType !== expectedType) {
    console.error('   ' + name.padEnd(20) + 'typeof=' + actualType + ' (expected ' +
      expectedType + ', from ' + origin + ')');
    bindingsOk = false;
  }
}
if (bindingsOk) {
  console.log('   ' + expectedGlobals.map(g => g[0]).join(', '));
  pass('All LETS modules expose a usable global binding');
} else {
  fail('One or more LETS modules did not expose a usable binding.');
}

// ===========================================================================
// 3. The modules must actually WORK when called via the Apps Script path
// ===========================================================================
// A binding that exists but throws on use is the subtler half of this bug:
// BudgetEngine loaded fine with CONFIG === undefined and only failed when a
// dashboard or the gatekeeper asked it for a number.

console.log('\n3. Calling through the Apps Script path (CONFIG must be wired):');

function callInContext(expr) {
  return vm.runInContext(expr, context);
}

// Expected values are the FY27 baseline figures from 00_config/BudgetConfig.js.
// They are asserted here, not just smoke-tested, so a silently empty CONFIG
// (which yields 0) cannot pass.
const budgetChecks = [
  ["BudgetEngine.calculateOfficeBudgetSummary('OMD', {}).remainingDiscretionaryBalance",
    136940, 'OMD discretionary base ($152,000 - $12,000 LC - $3,060 FO gap share)'],
  ["BudgetEngine.calculateOfficeBudgetSummary('IDV', {}).remainingDiscretionaryBalance",
    633720, 'IDV discretionary base ($659,000 - $12,000 LC - $13,280 FO gap share)'],
  ["BudgetEngine.calculateOfficeBudgetSummary('CM', {}).remainingDiscretionaryBalance",
    113840, 'CM discretionary base ($182,000 - $12,000 LC - $52,500 COE - $3,660 gap)'],
  ["BudgetEngine.generatePortfolioSummary({}).totalBaseline",
    997000, 'Portfolio total baseline (FO $4,000 + three DACs $993,000)'],
  ["BudgetEngine.generatePortfolioSummary({}).totalSetAsides",
    108500, 'Portfolio total set-asides ($36,000 LC + $52,500 COE + $20,000 gap)']
];

let callsOk = true;
for (const [expr, expected, label] of budgetChecks) {
  try {
    const actual = callInContext(expr);
    if (actual !== expected) {
      console.error('   ' + label + ': got ' + actual + ', expected ' + expected);
      callsOk = false;
    } else {
      console.log('   ' + label + ' = ' + actual);
    }
  } catch (err) {
    console.error('   ' + label + ' THREW ' + err.constructor.name + ': ' + err.message);
    callsOk = false;
  }
}

// The fiscal-year prefix proves CONFIG reached RequestService, not just that
// the function is callable.
try {
  const requestId = callInContext('RequestService.generateRequestId(0)');
  if (requestId !== 'LETS-2027-001') {
    console.error('   RequestService.generateRequestId(0): got ' + requestId +
      ', expected LETS-2027-001');
    callsOk = false;
  } else {
    console.log('   RequestService.generateRequestId(0) = ' + requestId);
  }
} catch (err) {
  console.error('   RequestService.generateRequestId THREW ' + err.constructor.name +
    ': ' + err.message);
  callsOk = false;
}

// LetsDB's schema map is built from CONFIG.sheets in computed keys — this is
// the exact expression that threw at load time before the fix.
try {
  const schemaNames = callInContext('Object.keys(LetsDB.SCHEMAS)');
  const requiredTables = ['Budgets', 'Set_Asides', 'Org_Approvers', 'Travelers', 'Audit_Log'];
  const missing = requiredTables.filter(t => schemaNames.indexOf(t) === -1);
  if (missing.length > 0) {
    console.error('   LetsDB.SCHEMAS missing table(s): ' + missing.join(', '));
    callsOk = false;
  } else {
    console.log('   LetsDB.SCHEMAS keyed from CONFIG.sheets: ' + schemaNames.length + ' tables');
  }
} catch (err) {
  console.error('   LetsDB.SCHEMAS THREW ' + err.constructor.name + ': ' + err.message);
  callsOk = false;
}

if (callsOk) {
  pass('Budget engine, request service, and LetsDB all resolve CONFIG correctly');
} else {
  fail('A LETS module is reachable but non-functional — CONFIG did not reach it.');
}

// ===========================================================================
// 4. Static guard: never read a top-level const/let off the global object
// ===========================================================================
// Sections 1-3 catch today's instances. This catches the next one, including in
// a file this suite does not yet call into, by rejecting the pattern itself.

console.log('\n4. Static guard against reading lexical declarations off the global:');

// Names declared with top-level `const`/`let` anywhere in server/. These are
// the names that are NOT global object properties.
const lexicalNames = new Set();
const lexicalDeclPattern = /^[ \t]*(?:const|let)[ \t]+([A-Za-z_$][\w$]*)/gm;
for (const relPath of files) {
  const source = fs.readFileSync(path.join(SERVER_ROOT, relPath), 'utf8');
  let match;
  while ((match = lexicalDeclPattern.exec(source)) !== null) {
    lexicalNames.add(match[1]);
  }
}

const offenders = [];
for (const relPath of files) {
  const source = fs.readFileSync(path.join(SERVER_ROOT, relPath), 'utf8');
  source.split('\n').forEach((line, idx) => {
    // Strip line comments so the explanatory prose in the fixed files — which
    // necessarily names the old pattern — does not trip its own guard.
    const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    const accessPattern = /\b(?:root|globalThis|self)\.([A-Za-z_$][\w$]*)/g;
    let match;
    while ((match = accessPattern.exec(code)) !== null) {
      const name = match[1];
      if (!lexicalNames.has(name)) continue;
      // Assignment creates a real global property and is legitimate.
      const after = code.slice(match.index + match[0].length);
      if (/^\s*=(?!=)/.test(after)) continue;
      offenders.push({ relPath, line: idx + 1, name, text: line.trim() });
    }
  });
}

if (offenders.length === 0) {
  console.log('   Scanned ' + files.length + ' files against ' + lexicalNames.size +
    ' const/let-declared names; no global-object reads of lexical declarations');
  pass('No file reads a top-level const/let off root/globalThis/self');
} else {
  offenders.forEach(o => {
    console.error('   ' + o.relPath + ':' + o.line + ' reads lexically-declared `' +
      o.name + '` off the global object');
    console.error('     ' + o.text);
  });
  fail(offenders.length + ' global-object read(s) of a const/let declaration. ' +
    'These evaluate to undefined in Apps Script. Use the bare identifier instead.');
}

// ===========================================================================

console.log('');
if (failures > 0) {
  console.error('--- ' + failures + ' ASSERTION GROUP(S) FAILED ---');
  process.exit(1);
}
console.log('--- ALL APPS SCRIPT MODULE LOAD ASSERTIONS PASSED! ---');
