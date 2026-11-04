/**
 * verify_oconus_routing.js — executes the per-diem dispatcher's routing
 * predicate against the leg objects the server-side paths actually build.
 *
 * Run from this directory:
 *     node verify_oconus_routing.js
 *
 * Reads only. Touches no Google service, no network.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * This is the evidence for G-080. getPerDiemForLeg (Costs.js:90) decides
 * which of three rate sources to use. It keys OCONUS off ONE field:
 *
 *     else if (effectiveLocationType === 'OCONUS')      Costs.js:102
 *
 * The CLIENT computes and sends locationType (travelCostService.html:396-402).
 * The two SERVER-INITIATED paths do not:
 *
 *   - Review_Update.js:730-745 builds legs with isOCONUS and perDiemSource
 *     and NO locationType. Costs.js:883 then passes `leg.locationType`,
 *     which is undefined.
 *   - Review_Update.js:1788-1796 builds legs with no locationType field
 *     at all, and Review_Update.js:2245-2251 passes no locationType.
 *
 * With locationType undefined and isIntl false, Costs.js:96 resolves to
 * 'CONUS' and Costs.js:107 routes to the GSA API — for a state the GSA
 * module itself excludes (PerDiemGSA.js:376-377: "AK and HI go through the
 * DoD path").
 *
 * METHOD NOTE, and it is the reason this file exists rather than a prose
 * claim: the predicate is COPIED from source and the copy is verified
 * against the source text before it is executed. A hand-traced routing
 * claim is exactly the kind of thing that turns out to be wrong — see
 * GAP_REGISTER.md 6.6.1, where four documents asserted a mechanism that
 * executing the predicate disproved.
 */

'use strict';
const fs = require('fs');
const path = require('path');

// Paths are relative to this file, so the script runs from anywhere.
const REPO = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\0/g, '');

const src = read('lets_app/server/30_services/Costs.js');
const review = read('lets_app/server/40_domain/Review_Update.js');
const client = read('lets_app/client/shared/travelCostService.html');
const gsa = read('lets_app/server/30_services/PerDiemGSA.js');

console.log('\nPer-diem dispatcher routing — executed, not traced');
console.log('purpose: evidence for G-080');
console.log('='.repeat(78));

// --- verify the copy matches source before executing it ---
const need = [
  "const { city, state, country, locationType, startDate, endDate, isInternational } = params;",
  "const isIntl = isInternational || (country && country !== 'United States');",
  "const effectiveLocationType = locationType || (isIntl ? 'Foreign' : 'CONUS');",
  "} else if (effectiveLocationType === 'OCONUS') {"
];
let ok = true;
for (const n of need) { if (!src.includes(n)) { console.log('COPY MISMATCH: ' + n); ok = false; } }
console.log('copy verified against source ......... ' + (ok ? 'yes' : 'NO'));
if (!ok) process.exit(1);

function route(params) {
  const { country, locationType, isInternational } = params;
  const isIntl = isInternational || (country && country !== 'United States');
  const effectiveLocationType = locationType || (isIntl ? 'Foreign' : 'CONUS');
  if (isIntl || effectiveLocationType === 'Foreign') return 'DOS';
  else if (effectiveLocationType === 'OCONUS') return 'DoD';
  else return 'GSA';
}

// Leg object as built at Review_Update.js:730-745 (the itinerary-edit path)
const legFromItineraryEdit = {
  city: 'Anchorage', state: 'AK', country: 'United States',
  isInternational: false, isOCONUS: true, perDiemSource: 'DoD'
};
// Leg object as built at Review_Update.js:1788-1796 (the cost-edit path)
const legFromCostEdit = {
  city: 'Anchorage', state: 'AK', country: 'United States',
  isInternational: false
};
// What the CLIENT sends (travelCostService.html:396-402 computes locationType)
const fromClient = {
  city: 'Anchorage', state: 'AK', country: 'United States',
  locationType: 'OCONUS'
};

const cases = [
  ['client form path          ', { ...fromClient }, 'DoD'],
  ['server itinerary-edit path', { ...legFromItineraryEdit, locationType: legFromItineraryEdit.locationType }, 'DoD'],
  ['server cost-edit path     ', { ...legFromCostEdit }, 'DoD'],
  ['foreign, server path      ', { city: 'Paris', country: 'France', isInternational: true }, 'DOS'],
  ['CONUS, server path        ', { city: 'Richmond', state: 'VA', country: 'United States', isInternational: false }, 'GSA']
];

console.log('\n  path                        routes to   should be   verdict');
console.log('  ' + '-'.repeat(60));
let bad = 0;
for (const [name, params, expect] of cases) {
  const got = route(params);
  const pass = got === expect;
  if (!pass) bad++;
  console.log('  ' + name + '  ' + got.padEnd(11) + expect.padEnd(11) + (pass ? 'ok' : '** MISROUTED **'));
}
console.log('\n  misrouted paths ..................... ' + bad);

// -------------------------------------------------------------------------
// [2] Corroborate each premise against source, so the cases above are not
//     just assertions about what the leg objects contain.
// -------------------------------------------------------------------------
console.log('\n[2] Premises, each checked against source');
let problems = 0;
const check = (label, cond, detail) => {
  if (!cond) problems++;
  console.log('  ' + (cond ? '   ' : '!! ') + label.padEnd(52) + (cond ? 'confirmed' : 'NOT CONFIRMED'));
  if (detail) console.log('        ' + detail);
};

// The dispatcher reads locationType and nothing else for the OCONUS branch.
check('dispatcher branches on locationType only',
  /else if \(effectiveLocationType === 'OCONUS'\)/.test(src),
  "Costs.js:102");
check('dispatcher never reads isOCONUS',
  !/isOCONUS/.test(src),
  'grep isOCONUS in Costs.js: ' + (src.match(/isOCONUS/g) || []).length + ' hits');
// NOTE on this check, because the naive version of it was WRONG and that is
// worth keeping. A bare grep for /perDiemSource/ in Costs.js returns 1 hit
// and the check failed. The hit is `_perDiemSource:` at Costs.js:930 — the
// dispatcher WRITING its own answer into the leg-cost record, not reading a
// routing input. The underscore prefix is the whole distinction. A validator
// that cannot tell a write from a read reports a false problem, which is the
// third time in this suite a crude pattern has done so.
const readsPerDiemSourceAsInput = /(?<!_)perDiemSource\s*(?:\)|,|\}|===|!==)/.test(src)
  || /params\.perDiemSource|leg\.perDiemSource/.test(src);
check('dispatcher never reads perDiemSource as an input',
  !readsPerDiemSourceAsInput,
  'the 1 occurrence is `_perDiemSource:` at Costs.js:930 — an OUTPUT it writes');

// Costs.js:883 passes leg.locationType — a field the leg objects lack.
check('Costs.js passes leg.locationType to the dispatcher',
  /locationType: leg\.locationType/.test(src),
  (src.match(/locationType: leg\.locationType/g) || []).length + ' call sites');

// The itinerary-edit leg object: has isOCONUS + perDiemSource, no locationType.
const legBuild = review.slice(review.indexOf('allLegs.push({'), review.indexOf('allLegs.push({') + 1200);
check('itinerary-edit leg object carries isOCONUS',
  /isOCONUS:/.test(legBuild));
check('itinerary-edit leg object carries perDiemSource',
  /perDiemSource:/.test(legBuild));
check('itinerary-edit leg object has NO locationType',
  !/locationType:/.test(legBuild));

// The cost-edit leg map: no locationType, and the call site passes none.
const mapBuild = review.slice(review.indexOf('legsMap[legId] = {'), review.indexOf('legsMap[legId] = {') + 700);
check('cost-edit leg map has NO locationType',
  !/locationType:/.test(mapBuild));
check('cost-edit call sites pass NO locationType',
  !/locationType: legInfo/.test(review));

// The client does compute it — so the form path is correct.
check('client computes locationType before the RPC',
  /locationType = 'CONUS'/.test(client) && /locationType = 'OCONUS'/.test(client),
  'travelCostService.html:396-402');

// And GSA itself excludes the OCONUS states, so the misroute targets an API
// that cannot answer.
check("GSA_CONUS_STATES excludes AK",
  !/'AK'/.test(gsa.slice(gsa.indexOf('var GSA_CONUS_STATES'), gsa.indexOf('var GSA_CONUS_STATES') + 400)),
  'PerDiemGSA.js:376-377 says so in a comment too');

console.log('\n  unconfirmed premises ................ ' + problems);

// -------------------------------------------------------------------------
// [3] Verdict
//
// IMPORTANT, AND THE REASON THIS SECTION IS WORDED CAREFULLY.
// The other scripts in evidence/ report "0 problems" when the DOCUMENTS and
// the CODE agree. This one is different: it is a DEFECT DETECTOR for an open
// finding. While G-080 is open, 2 misrouted paths is the CORRECT and
// EXPECTED output, and a reader skimming the suite must not read it as the
// suite being broken.
//
// GAP_REGISTER.md 6.6.4 makes the same argument for keeping the rubric audit
// out of the suite: a check that always fails trains people to ignore checks.
// So this script separates the two questions and exits 0 either way.
// -------------------------------------------------------------------------
console.log('\n' + '='.repeat(78));
console.log('[3] Verdict');
console.log('  integrity problems (this script vs the source) ... ' + problems);
console.log('  misrouted paths (the G-080 defect itself) ........ ' + bad);
console.log('');

if (problems > 0) {
  console.log('  !! THE SCRIPT DISAGREES WITH THE SOURCE.');
  console.log('     One or more premises above could not be confirmed, so the');
  console.log('     routing cases are not trustworthy. Fix this script before');
  console.log('     drawing any conclusion from it.');
} else if (bad === 0) {
  console.log('  G-080 appears REMEDIATED. Every path routes correctly.');
  console.log('  Update GAP_REGISTER.md 6.3 to mark it remediated with a date,');
  console.log('  and keep the row (see 6.2 on why remediated rows stay).');
} else {
  console.log('  G-080 CONFIRMED and still open. This is the expected output.');
  console.log('  The intake form routes correctly; the two server-initiated');
  console.log('  re-pricing paths send OCONUS legs to the GSA API, which');
  console.log('  excludes AK and HI by design (PerDiemGSA.js:376-377).');
  console.log('');
  console.log('  Why nobody sees an error:');
  console.log('    Costs.js:127-135  GSA returns success:false');
  console.log('    Costs.js:923      KEEPS the stale rate instead of failing');
  console.log('    Costs.js:927      _preCalculatedLodging := null');
  console.log('    Costs.js:581      falls back to nights x stale rate');
  console.log('  The night count DID change, so the total updates and looks');
  console.log('  freshly calculated. The rate behind it was never re-verified.');
  console.log('');
  console.log('  Fix: ENHANCEMENT_PLAYBOOK.md 7.11.3 — derive the routing key');
  console.log('  rather than requiring three callers to remember to pass it.');
  console.log('  isOCONUSLocation (Locations.js:29) already implements it.');
}
console.log('');
console.log('Every result above is recomputed from source on each run.\n');
