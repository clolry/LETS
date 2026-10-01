/**
 * Automated Verification Script for the LETS environment gate.
 *
 * Covers the fail-closed rules that keep a non-production Apps Script project
 * from writing test rows into the official FAS Travel Exception Tracker — a
 * sheet owned by the FAS front office, not by this project.
 *
 * These are pure functions in 00_config/TripConfig.js, so they are testable
 * under Node without Apps Script. No Google service is contacted.
 *
 * Run: node lets_app/test_fas_tracker_env.js
 */

const assert = require('assert');
const {
  LETS_ENV_PRODUCTION,
  LETS_ENV_DEVELOPMENT,
  resolveLetsEnvironment,
  resolveFASTrackerTarget
} = require('./server/00_config/TripConfig.js');

console.log('--- Starting LETS Environment Gate Test Suite ---');

// Stand-in identifiers. Deliberately NOT the real spreadsheet IDs — this file
// asserts on gate behavior, and hardcoding real IDs here would both leak them
// and trip the CI guard against ID literals in source.
const PROD_ID = 'PROD_TRACKER_ID_PLACEHOLDER';
const TEST_ID = 'TEST_TRACKER_ID_PLACEHOLDER';

// ---------------------------------------------------------------------------
// 1. Environment resolution is fail-closed
// ---------------------------------------------------------------------------
console.log('\n1. Environment resolution (fail-closed):');

// Anything that is not exactly 'production' must resolve to development.
// An unconfigured project must never be treated as production.
assert.strictEqual(resolveLetsEnvironment(null), LETS_ENV_DEVELOPMENT);
assert.strictEqual(resolveLetsEnvironment(undefined), LETS_ENV_DEVELOPMENT);
assert.strictEqual(resolveLetsEnvironment(''), LETS_ENV_DEVELOPMENT);
assert.strictEqual(resolveLetsEnvironment('   '), LETS_ENV_DEVELOPMENT);
assert.strictEqual(resolveLetsEnvironment('dev'), LETS_ENV_DEVELOPMENT);
assert.strictEqual(resolveLetsEnvironment('development'), LETS_ENV_DEVELOPMENT);
assert.strictEqual(resolveLetsEnvironment('staging'), LETS_ENV_DEVELOPMENT);
assert.strictEqual(resolveLetsEnvironment('PRODUCTIONISH'), LETS_ENV_DEVELOPMENT);
assert.strictEqual(resolveLetsEnvironment('prod'), LETS_ENV_DEVELOPMENT);
console.log('   Unset / blank / unknown values -> development');

// Production must be opted into explicitly, but tolerate case and whitespace.
assert.strictEqual(resolveLetsEnvironment('production'), LETS_ENV_PRODUCTION);
assert.strictEqual(resolveLetsEnvironment('PRODUCTION'), LETS_ENV_PRODUCTION);
assert.strictEqual(resolveLetsEnvironment('  Production  '), LETS_ENV_PRODUCTION);
console.log('   Explicit "production" (any case/padding) -> production');
console.log('\u2714 Environment gate defaults closed; production requires opt-in');

// ---------------------------------------------------------------------------
// 2. Production resolves to the official tracker
// ---------------------------------------------------------------------------
console.log('\n2. Production target resolution:');
const prodTarget = resolveFASTrackerTarget(LETS_ENV_PRODUCTION, PROD_ID, TEST_ID);
assert.strictEqual(prodTarget.configured, true);
assert.strictEqual(prodTarget.isProduction, true);
assert.strictEqual(prodTarget.spreadsheetId, PROD_ID);
assert.strictEqual(prodTarget.propertyKey, 'FAS_TRACKER_SPREADSHEET_ID');
assert.strictEqual(prodTarget.reason, null);
console.log('   Production reads FAS_TRACKER_SPREADSHEET_ID');
console.log('\u2714 Production targets the official tracker');

// ---------------------------------------------------------------------------
// 3. Development resolves to the test copy ONLY
// ---------------------------------------------------------------------------
console.log('\n3. Development target resolution:');
const devTarget = resolveFASTrackerTarget(LETS_ENV_DEVELOPMENT, PROD_ID, TEST_ID);
assert.strictEqual(devTarget.configured, true);
assert.strictEqual(devTarget.isProduction, false);
assert.strictEqual(devTarget.spreadsheetId, TEST_ID);
assert.strictEqual(devTarget.propertyKey, 'TEST_FAS_TRACKER_SPREADSHEET_ID');
// The critical assertion: even with the production ID available, development
// must not resolve to it.
assert.notStrictEqual(devTarget.spreadsheetId, PROD_ID);
console.log('   Development reads TEST_FAS_TRACKER_SPREADSHEET_ID');
console.log('\u2714 Development targets the test copy, never the official tracker');

// ---------------------------------------------------------------------------
// 4. No fallback from missing test ID to production
// ---------------------------------------------------------------------------
console.log('\n4. Missing test ID must DISABLE, not fall back:');
[null, undefined, '', '   '].forEach(function (emptyValue) {
  const target = resolveFASTrackerTarget(LETS_ENV_DEVELOPMENT, PROD_ID, emptyValue);
  assert.strictEqual(target.configured, false,
    'unconfigured dev target must not report configured');
  assert.strictEqual(target.spreadsheetId, null,
    'unconfigured dev target must not resolve to any spreadsheet');
  assert.notStrictEqual(target.spreadsheetId, PROD_ID,
    'FAIL-OPEN REGRESSION: dev fell back to the official tracker');
  assert.ok(target.reason && target.reason.length > 0,
    'an unconfigured target must explain why');
});
console.log('   Unset TEST_FAS_TRACKER_SPREADSHEET_ID -> feature disabled, no fallback');

// Same rule in production: missing prod ID disables rather than guessing.
const prodMissing = resolveFASTrackerTarget(LETS_ENV_PRODUCTION, null, TEST_ID);
assert.strictEqual(prodMissing.configured, false);
assert.strictEqual(prodMissing.spreadsheetId, null);
assert.notStrictEqual(prodMissing.spreadsheetId, TEST_ID,
  'production must not silently write to the test copy');
console.log('   Unset FAS_TRACKER_SPREADSHEET_ID in production -> disabled, no test fallback');
console.log('\u2714 No silent fallback in either direction');

// ---------------------------------------------------------------------------
// 5. Misconfiguration guard: dev pointed at the official sheet is refused
// ---------------------------------------------------------------------------
console.log('\n5. Copy/paste misconfiguration guard:');
const collision = resolveFASTrackerTarget(LETS_ENV_DEVELOPMENT, PROD_ID, PROD_ID);
assert.strictEqual(collision.configured, false,
  'dev pointed at the production sheet must be refused');
assert.strictEqual(collision.spreadsheetId, null);
assert.ok(/REFUSING TO RUN/.test(collision.reason),
  'refusal must be explicit in the reason string');
console.log('   TEST id == PROD id in development -> refused with explicit reason');

// Whitespace must not be usable to sneak past the collision check.
const collisionPadded = resolveFASTrackerTarget(LETS_ENV_DEVELOPMENT, PROD_ID, '  ' + PROD_ID + '  ');
assert.strictEqual(collisionPadded.configured, false,
  'whitespace-padded production ID must still be caught');
console.log('   Whitespace-padded duplicate -> still refused');

// Production legitimately uses the production ID; the guard must not fire there.
const prodSelf = resolveFASTrackerTarget(LETS_ENV_PRODUCTION, PROD_ID, PROD_ID);
assert.strictEqual(prodSelf.configured, true,
  'the collision guard must not block legitimate production use');
assert.strictEqual(prodSelf.spreadsheetId, PROD_ID);
console.log('   Production with matching ids -> allowed (guard is dev-only)');
console.log('\u2714 Misconfigured development environment fails closed');

// ---------------------------------------------------------------------------
// 6. Default posture of a brand-new project
// ---------------------------------------------------------------------------
console.log('\n6. Brand-new / unconfigured project posture:');
// Nothing set at all: no LETS_ENV, no tracker IDs.
const virgin = resolveFASTrackerTarget(resolveLetsEnvironment(null), null, null);
assert.strictEqual(virgin.environment, LETS_ENV_DEVELOPMENT);
assert.strictEqual(virgin.isProduction, false);
assert.strictEqual(virgin.configured, false);
assert.strictEqual(virgin.spreadsheetId, null);
console.log('   No properties set -> development, unconfigured, no target');

// Worst realistic case: someone sets ONLY the production ID and forgets LETS_ENV.
// This is the scenario the gate exists for.
const forgotEnv = resolveFASTrackerTarget(resolveLetsEnvironment(null), PROD_ID, null);
assert.strictEqual(forgotEnv.isProduction, false);
assert.strictEqual(forgotEnv.configured, false);
assert.strictEqual(forgotEnv.spreadsheetId, null,
  'FAIL-OPEN REGRESSION: forgetting LETS_ENV exposed the official tracker');
console.log('   Only FAS_TRACKER_SPREADSHEET_ID set, LETS_ENV forgotten -> still no access');
console.log('\u2714 An unconfigured project cannot reach the official FAS tracker');

console.log('\n--- ALL ENVIRONMENT GATE ASSERTIONS PASSED! ---');
