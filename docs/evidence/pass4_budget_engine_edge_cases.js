// Evidence script — re-run with:  node docs/evidence/pass4_budget_engine_edge_cases.js
// Paths are relative to this file's directory; run from anywhere with:
//   cd docs/evidence && node pass4_budget_engine_edge_cases.js
const BE = require('../../lets_app/server/30_services/BudgetEngine.js');
const C  = require('../../lets_app/server/00_config/BudgetConfig.js');
const S = C.requestStatus;
const base = { offices: C.baselineAllocations, setAsides: C.defaultSetAsides, budgetAdjustments: [] };
const sum = reqs => BE.calculateSpendAndCommitments('OMD', reqs);

console.log('=== which statuses consume budget? (est=1000, act=900) ===');
for (const [k,v] of Object.entries(S)) {
  const r = [{requestId:'R', owningOffice:'OMD', status:v, totalEstimatedCost:1000, totalActualCost:900}];
  const s = sum(r);
  console.log(`${k.padEnd(28)} "${v}"`.padEnd(66), `pending=${s.pendingEstimates} posted=${s.postedActuals}`);
}

console.log('\n=== HOLE 1: RECONCILED with no actuals posted ===');
console.log(JSON.stringify(sum([{requestId:'R',owningOffice:'OMD',status:S.RECONCILED,totalEstimatedCost:50000,totalActualCost:0}])));
console.log('-> a $50,000 trip marked Reconciled with blank actuals frees the entire commitment.');

console.log('\n=== HOLE 2: evaluateBudgetCheck with missing requestId ===');
const existing = [
  {requestId:undefined, owningOffice:'OMD', status:S.APPROVED, totalEstimatedCost:100000, totalActualCost:0},
  {requestId:'',        owningOffice:'OMD', status:S.APPROVED, totalEstimatedCost:30000,  totalActualCost:0}
];
const st = Object.assign({}, base, {requests: existing});
const chk = BE.evaluateBudgetCheck({requestId:undefined, owningOffice:'OMD', totalEstimatedCost:5000}, st);
console.log('available balance seen by check:', chk.currentAvailableBalance, '| hasSufficientFunds:', chk.hasSufficientFunds);
const chk2 = BE.evaluateBudgetCheck({requestId:'NEW-1', owningOffice:'OMD', totalEstimatedCost:5000}, st);
console.log('with a real new requestId     :', chk2.currentAvailableBalance, '| hasSufficientFunds:', chk2.hasSufficientFunds);

console.log('\n=== HOLE 3: unknown owningOffice ===');
const chk3 = BE.evaluateBudgetCheck({requestId:'X', owningOffice:'ZZZ', totalEstimatedCost:5000}, Object.assign({},base,{requests:[]}));
console.log('officeName:', JSON.stringify(chk3.officeName), 'balance:', chk3.currentAvailableBalance, 'sufficient:', chk3.hasSufficientFunds);

console.log('\n=== HOLE 4: negative / string costs ===');
const chk4 = BE.evaluateBudgetCheck({requestId:'X', owningOffice:'OMD', totalEstimatedCost:-999999}, Object.assign({},base,{requests:[]}));
console.log('negative estimate -> sufficient:', chk4.hasSufficientFunds, 'projected:', chk4.projectedBalanceAfterTrip);

console.log('\n=== HOLE 5: set-aside Active=FALSE still deducted? ===');
const sa = C.defaultSetAsides.map(s=>Object.assign({},s,{Active:'FALSE', active:false}));
const s5 = BE.calculateOfficeBudgetSummary('OMD', Object.assign({},base,{setAsides:sa, requests:[]}));
console.log('OMD totalSetAsides with all set-asides marked inactive:', s5.setAsides.totalSetAsides);
