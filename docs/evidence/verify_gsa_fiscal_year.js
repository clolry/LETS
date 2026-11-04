/**
 * verify_gsa_fiscal_year.js — does the GSA smoke test cover the fiscal year
 * the city dropdown actually asks for?
 *
 * Run from this directory:
 *     node verify_gsa_fiscal_year.js
 *
 * Reads only. Touches no Google service, no network.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * This is the evidence for G-081, and it exists because a setup runbook was
 * about to tell a non-programmer "run _testGSAPerDiemAPI, expect SUCCESS,
 * then the dropdown will work." That inference does not hold.
 *
 * Three places in PerDiemGSA.js decide a fiscal year:
 *
 *   _gsaCurrentFiscalYear()   :389   Oct 1 rollover, from today's date
 *   getFiscalYear(date)       :569   Oct 1 rollover, from a given date
 *   _testGSAPerDiemAPI()      :1095  const years = [2025, 2026]   <-- LITERAL
 *
 * getGSACitiesForState — the function behind the dropdown — computes the FY
 * itself (PerDiemGSA.js:260-261) with the same Oct-1 rule. So after
 * 2026-10-01 the dropdown asks GSA for FY2027 while the smoke test asks for
 * FY2025 and FY2026, and RETURNS ON THE FIRST SUCCESS (:1111).
 *
 * The consequence is a false pass: the key is valid, the smoke test prints
 * SUCCESS, and every dropdown is still empty because GSA has no FY2027 data
 * for that key or that year yet. The operator has a green light and a broken
 * feature, which is the worst of the three possible states.
 *
 * This script does NOT contact GSA. It cannot tell you whether FY2027 data
 * exists — only that nothing in the codebase checks.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\0/g, '');
const GSA = 'lets_app/server/30_services/PerDiemGSA.js';
const src = read(GSA);

console.log('\nGSA fiscal-year agreement — executed, not traced');
console.log('purpose: evidence for G-081');
console.log('='.repeat(78));

let problems = 0;
const check = (label, cond, detail) => {
  if (!cond) problems++;
  console.log('  ' + (cond ? '   ' : '!! ') + label.padEnd(54) + (cond ? 'confirmed' : 'NOT CONFIRMED'));
  if (detail) console.log('        ' + detail);
};

// -------------------------------------------------------------------------
// [1] The three FY computations, copied from source and verified
// -------------------------------------------------------------------------
console.log('\n[1] The fiscal-year rules in PerDiemGSA.js');

// _gsaCurrentFiscalYear, PerDiemGSA.js:389
const RULE_A = "return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();";
check('_gsaCurrentFiscalYear copied verbatim', src.includes(RULE_A), 'PerDiemGSA.js:391');
const fyFromToday = d => { const n = new Date(d); return n.getMonth() >= 9 ? n.getFullYear() + 1 : n.getFullYear(); };

// getFiscalYear, PerDiemGSA.js:569 — month is 1-indexed here, so the test is >= 10
check('getFiscalYear copied verbatim', /if \(parsed\.month >= 10\) \{\s*return parsed\.year \+ 1;/.test(src), 'PerDiemGSA.js:572-573');
const fyFromDate = d => {
  const s = typeof d === 'string' ? d : new Date(d).toISOString().split('T')[0];
  const p = s.split('-');
  return parseInt(p[1], 10) >= 10 ? parseInt(p[0], 10) + 1 : parseInt(p[0], 10);
};

// getGSACitiesForState computes its own, inline. PerDiemGSA.js:260-261
check('getGSACitiesForState computes its FY inline',
  /const fiscalYear = now\.getMonth\(\) >= 9 \? now\.getFullYear\(\) \+ 1 : now\.getFullYear\(\);/.test(src),
  'PerDiemGSA.js:261 — a third copy of the same rule, not a call to either helper');

// _testGSAPerDiemAPI hardcodes its years.
const m = /const years = \[([^\]]+)\]/.exec(src);
check('_testGSAPerDiemAPI hardcodes its years', !!m, m ? 'PerDiemGSA.js:1095 — const years = [' + m[1].trim() + ']' : '');
const HARDCODED = m ? JSON.parse('[' + m[1] + ']') : [];

check('_testGSAPerDiemAPI returns on the FIRST success',
  /if \(result\.success\) \{[\s\S]{0,300}?return result;/.test(src),
  'PerDiemGSA.js:1107-1115 — so a later year in the list is never reached');

// _testRawAPIResponse was pinned to the current FY on 2026-10-29.
check('_testRawAPIResponse uses the CURRENT fiscal year',
  /const fy = _gsaCurrentFiscalYear\(\);[\s\S]{0,200}?year\/\$\{fy\}/.test(src),
  'PerDiemGSA.js:1146-1147 — this one is correct');

// -------------------------------------------------------------------------
// [2] Do the two helpers agree with each other? (they should)
// -------------------------------------------------------------------------
console.log('\n[2] The two helpers, across the Oct 1 boundary');
console.log('      date          _gsaCurrentFiscalYear   getFiscalYear   agree');
console.log('      ' + '-'.repeat(62));
let disagree = 0;
for (const d of ['2026-09-30', '2026-10-01', '2026-10-30', '2027-01-15', '2027-09-30', '2027-10-01']) {
  const a = fyFromToday(d), b = fyFromDate(d);
  if (a !== b) disagree++;
  console.log('      ' + d + '    ' + String(a).padEnd(23) + String(b).padEnd(16) + (a === b ? 'yes' : '** NO **'));
}
console.log('\n  helper disagreements ................................ ' + disagree);
if (disagree === 0) console.log('    The two helpers are consistent. The problem is not here.');
problems += disagree;

// -------------------------------------------------------------------------
// [3] Does the smoke test cover the year the dropdown asks for?
// -------------------------------------------------------------------------
console.log('\n[3] The smoke test vs the dropdown');
const today = fyFromToday(new Date());
console.log('  today ................................... ' + new Date().toISOString().split('T')[0]);
console.log('  FY the dropdown asks GSA for ............ ' + today +
  '   (getGSACitiesForState, PerDiemGSA.js:261)');
console.log('  FY _testGSAPerDiemAPI asks GSA for ...... ' + JSON.stringify(HARDCODED) +
  '   (PerDiemGSA.js:1095)');
const covered = HARDCODED.includes(today);
console.log('  smoke test covers the dropdown\'s FY ..... ' + (covered ? 'YES' : 'NO'));

console.log('\n' + '='.repeat(78));
console.log('[4] Verdict');
console.log('  integrity problems (this script vs the source) ... ' + problems);
console.log('  fiscal-year coverage gap (the G-081 defect) ...... ' + (covered ? 0 : 1));
console.log('');

if (problems > 0) {
  console.log('  !! THE SCRIPT DISAGREES WITH THE SOURCE. Fix this script');
  console.log('     before drawing any conclusion from it.');
} else if (covered) {
  console.log('  No gap TODAY. The hardcoded list happens to include the');
  console.log('  current fiscal year, so a passing smoke test does imply the');
  console.log('  dropdown can reach data. THIS IS LUCK, NOT DESIGN — the list');
  console.log('  is a literal and the dropdown rolls over every October 1.');
  console.log('  G-081 is still open.');
} else {
  console.log('  G-081 CONFIRMED. _testGSAPerDiemAPI PASSES on a fiscal year');
  console.log('  the dropdown never requests.');
  console.log('');
  console.log('  Consequence for anyone following a setup runbook:');
  console.log('    "run the smoke test, expect SUCCESS" is NOT evidence that');
  console.log('    the dropdown will populate. The key can be valid for');
  console.log('    FY' + HARDCODED[0] + ' and GSA can have no FY' + today + ' data published,');
  console.log('    and the operator sees a green light over an empty dropdown.');
  console.log('');
  console.log('  The sound verification is _diagnoseGSACitiesWarmer, which');
  console.log('  reports "Cached states: N / 49" against the SAME fiscal year');
  console.log('  the dropdown uses (CacheWarming.js:1467 calls');
  console.log('  _gsaCurrentFiscalYear). Trust that number, not the smoke test.');
  console.log('');
  console.log('  Fix: replace the literal at PerDiemGSA.js:1095 with');
  console.log('       const years = [_gsaCurrentFiscalYear(), _gsaCurrentFiscalYear() - 1];');
}
console.log('');
console.log('Every result above is recomputed from source on each run.\n');
