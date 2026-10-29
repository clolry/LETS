/**
 * Automated Verification Script for the global-object binding of LETS_CONFIG.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Three files read the config as a PROPERTY OF THE GLOBAL OBJECT:
 *
 *   server/20_data/LetsDB.js:11           root.LETS_CONFIG
 *   server/30_services/BudgetEngine.js:11 root.LETS_CONFIG
 *   server/40_domain/RequestService.js:13 root.LETS_CONFIG
 *
 * In the Apps Script V8 runtime, a top-level `const`/`let`/`class` creates a
 * lexical binding that is NOT a property of the global object. `var` creates
 * both. So with `const LETS_CONFIG`, `root.LETS_CONFIG` is `undefined` and
 * LetsDB.js:20 throws:
 *
 *   TypeError: Cannot read properties of undefined (reading 'sheets')
 *
 * That throw happens inside an IIFE at FILE EVALUATION time, and Apps Script
 * evaluates every file on every execution — so it broke the whole web app,
 * including the travel workflow, which never touches this object.
 *
 * WHY A PLAIN `require()` DOES NOT CATCH IT
 * -----------------------------------------
 * Under Node, BudgetConfig.js ends with `module.exports = LETS_CONFIG`, which
 * closes over the lexical binding and works identically for `const` and `var`.
 * `node -e "require('./BudgetConfig.js')"` therefore passes either way. The
 * defect is invisible to CommonJS and only appears under the shared-global
 * script model that Apps Script uses.
 *
 * So this suite does not require() the file. It reads the SOURCE and evaluates
 * it the way Apps Script does: each server file as a separate script in one
 * shared global realm, in numeric-prefix order, with `module` absent so the
 * UMD wrappers take their browser/GAS branch.
 *
 * Run: node lets_app/test_budget_config_global.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('--- Starting LETS_CONFIG Global Binding Test Suite ---');

const SERVER = path.join(__dirname, 'server');
const BUDGET_CONFIG = path.join(SERVER, '00_config', 'BudgetConfig.js');

// ---------------------------------------------------------------------------
// 1. The declaration itself
// ---------------------------------------------------------------------------
console.log('\n1. Declaration keyword in BudgetConfig.js:');

const source = fs.readFileSync(BUDGET_CONFIG, 'utf8');

assert.ok(
  /^var LETS_CONFIG\s*=/m.test(source),
  'REGRESSION: LETS_CONFIG is not declared with `var` at the top level of ' +
  'BudgetConfig.js. Three files read it as root.LETS_CONFIG, which is ' +
  'undefined for a const/let declaration in the Apps Script V8 runtime. ' +
  'This breaks the ENTIRE web app at file-evaluation time, not just the ' +
  'budget layer. Restore `var LETS_CONFIG = {`.'
);
console.log('   Declared with `var` -> becomes a global-object property');

assert.ok(
  !/^(?:const|let)\s+LETS_CONFIG\s*=/m.test(source),
  'REGRESSION: found a top-level `const`/`let` declaration of LETS_CONFIG.'
);
console.log('   No top-level const/let declaration of LETS_CONFIG');

// ---------------------------------------------------------------------------
// 2. Evaluate as Apps Script does: shared global realm, one script per file
// ---------------------------------------------------------------------------
console.log('\n2. Apps Script global-realm simulation:');

// Numeric-prefix order is the load order Apps Script uses, and is why
// 00_config evaluates before its 20_/30_/40_ consumers.
const FILES = [
  ['00_config', 'BudgetConfig.js'],
  ['20_data', 'LetsDB.js'],
  ['30_services', 'BudgetEngine.js'],
  ['40_domain', 'RequestService.js']
];

// No `module` and no `require` in this context, so each UMD wrapper takes its
// `root.X = factory(root.LETS_CONFIG)` branch — the path that actually runs in
// production, and the one that was broken.
const sandbox = { console };
const context = vm.createContext(sandbox);

for (const [dir, file] of FILES) {
  const full = path.join(SERVER, dir, file);
  const code = fs.readFileSync(full, 'utf8');
  try {
    vm.runInContext(code, context, { filename: `${dir}/${file}` });
  } catch (err) {
    assert.fail(
      `Evaluating ${dir}/${file} threw under the Apps Script global model: ` +
      `${err.constructor.name}: ${err.message}\n` +
      '  This is the production failure mode. Apps Script evaluates every ' +
      'file on every execution, so a throw here takes down the whole web app.'
    );
  }
  console.log(`   ${dir}/${file} evaluated clean`);
}

// ---------------------------------------------------------------------------
// 3. The config is reachable the way its consumers reach it
// ---------------------------------------------------------------------------
console.log('\n3. Global-object reachability:');

const globalConfig = vm.runInContext('this.LETS_CONFIG', context);
assert.ok(
  globalConfig,
  'REGRESSION: this.LETS_CONFIG is undefined in the shared global realm. ' +
  'root.LETS_CONFIG resolves to this, so its consumers see undefined.'
);
console.log('   this.LETS_CONFIG is defined');

assert.ok(
  globalConfig.sheets && globalConfig.sheets.budgets,
  'REGRESSION: LETS_CONFIG.sheets.budgets is not readable. This is the exact ' +
  'property dereference at LetsDB.js:20 that produced ' +
  '"Cannot read properties of undefined (reading \'sheets\')" in production.'
);
console.log(`   LETS_CONFIG.sheets.budgets = ${globalConfig.sheets.budgets}`);

// ---------------------------------------------------------------------------
// 4. Every consumer namespace actually got constructed
// ---------------------------------------------------------------------------
console.log('\n4. Consumer namespaces built:');

for (const name of ['LetsDB', 'BudgetEngine', 'RequestService']) {
  const ns = vm.runInContext(`this.${name}`, context);
  assert.ok(
    ns,
    `REGRESSION: this.${name} was not assigned. Its UMD wrapper either threw ` +
    'or took the CommonJS branch, so the namespace does not exist on the ' +
    'global object where Apps Script expects it.'
  );
  console.log(`   ${name} constructed`);
}

// ---------------------------------------------------------------------------
// 5. The CommonJS path still works, so the Node test suites keep running
// ---------------------------------------------------------------------------
console.log('\n5. CommonJS export path (used by the other test suites):');

const required = require('./server/00_config/BudgetConfig.js');
assert.ok(required && required.sheets && required.sheets.budgets);
assert.strictEqual(required.fiscalYear, 'FY27');
console.log('   require() still returns a usable config object');

// ---------------------------------------------------------------------------
// 6. Negative control: prove this suite would have caught the real bug
// ---------------------------------------------------------------------------
console.log('\n6. Negative control (const must fail this simulation):');

// A test that cannot fail is not a test. Re-run the simulation against a
// deliberately broken copy and assert that it DOES throw the production error.
const brokenSource = source.replace(/^var LETS_CONFIG\s*=/m, 'const LETS_CONFIG =');
assert.notStrictEqual(brokenSource, source, 'negative control failed to patch the source');

const brokenContext = vm.createContext({ console: { log() {} } });
vm.runInContext(brokenSource, brokenContext, { filename: 'BudgetConfig.js (const)' });

let threw = null;
try {
  const letsDbCode = fs.readFileSync(path.join(SERVER, '20_data', 'LetsDB.js'), 'utf8');
  vm.runInContext(letsDbCode, brokenContext, { filename: 'LetsDB.js' });
} catch (err) {
  threw = err;
}

assert.ok(
  threw,
  'NEGATIVE CONTROL FAILED: a `const` declaration did NOT break the ' +
  'simulation, so this suite is not actually exercising the production ' +
  'failure mode and would not catch a regression.'
);
assert.ok(
  /Cannot read properties of undefined/.test(threw.message),
  `NEGATIVE CONTROL FAILED: expected the production TypeError, got: ${threw.message}`
);
console.log(`   const form throws as expected: ${threw.message}`);

console.log('\n--- ALL LETS_CONFIG GLOBAL BINDING ASSERTIONS PASSED! ---');
