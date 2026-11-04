// Evidence script — re-run with:  node docs/evidence/pass4_budget_engine_baseline.js
// Paths are relative to this file's directory; run from anywhere with:
//   cd docs/evidence && node pass4_budget_engine_baseline.js
const BE = require('../../lets_app/server/30_services/BudgetEngine.js');
const C  = require('../../lets_app/server/00_config/BudgetConfig.js');

// Correct camelCase state (as LETS_CONFIG supplies)
const state = { offices: C.baselineAllocations, setAsides: C.defaultSetAsides, budgetAdjustments: [], requests: [] };

console.log('=== PORTFOLIO (config-shaped, the path tests exercise) ===');
const p = BE.generatePortfolioSummary(state);
for (const k of ['fiscalYear','totalBaseline','totalAllocation','totalSetAsides','totalRemainingBalance']) console.log(k.padEnd(22), p[k]);
console.log('\n=== PER OFFICE ===');
for (const code of ['FO','OMD','IDV','CM']) {
  const s = p.dacSummaries[code];
  console.log(`${code}: baseline=${s.baselineAllocation} propShare=${s.proportionalShare} selfFunded=${s.setAsides.selfFundedTotal} entShared=${s.setAsides.enterpriseSharedTotal} discBase=${s.discretionaryBase} remaining=${s.remainingDiscretionaryBalance}`);
}
console.log('\n=== FO: is it charged any set-aside? ===');
console.log(JSON.stringify(p.dacSummaries.FO.setAsides, null, 1));
