// Evidence script — re-run with:  node docs/evidence/pass3_D7_sheet_shape_mismatch.js
// Paths are relative to this file's directory; run from anywhere with:
//   cd docs/evidence && node pass3_D7_sheet_shape_mismatch.js
const BE = require('../../lets_app/server/30_services/BudgetEngine.js');

// Simulate exactly what LetsDB.sheetDataToObjects() returns for the Budgets tab
const budgetsSheetRows = [
  { OfficeCode:'FO',  OfficeName:'Front Office / AC', BaselineAllocation:4000,   ProportionalShare:0 },
  { OfficeCode:'OMD', OfficeName:'OMD DAC',           BaselineAllocation:152000, ProportionalShare:0.153 },
  { OfficeCode:'IDV', OfficeName:'IDV DAC',           BaselineAllocation:659000, ProportionalShare:0.664 },
  { OfficeCode:'CM',  OfficeName:'CM DAC',            BaselineAllocation:182000, ProportionalShare:0.183 }
];
const setAsidesSheetRows = [
  { SetAsideID:'SETASIDE_DAC_LC_OMD', Title:'DAC LC Travel - OMD', Type:'SELF_FUNDED', TargetOffice:'OMD', Amount:12000, Active:'TRUE' },
  { SetAsideID:'SETASIDE_FO_LC_GAP',  Title:'FO LC Gap',           Type:'ENTERPRISE_SHARED', TargetOffice:'SHARED_DAC', Amount:20000, Active:'TRUE' }
];

// keyBy OfficeCode, as any repository layer would
const offices = {};
budgetsSheetRows.forEach(r => offices[r.OfficeCode] = r);

const state = { offices, setAsides: setAsidesSheetRows, budgetAdjustments: [], requests: [] };
const s = BE.calculateOfficeBudgetSummary('OMD', state);
console.log('--- OMD summary, fed sheet-shaped rows ---');
console.log('officeName                   :', JSON.stringify(s.officeName));
console.log('baselineAllocation           :', s.baselineAllocation);
console.log('totalAllocation              :', s.totalAllocation);
console.log('setAsides.totalSetAsides     :', s.setAsides.totalSetAsides);
console.log('discretionaryBase            :', s.discretionaryBase);
console.log('remainingDiscretionaryBalance:', s.remainingDiscretionaryBalance);
console.log('isDeficit                    :', s.isDeficit);

const p = BE.generatePortfolioSummary(state);
console.log('\n--- portfolio ---');
console.log('totalBaseline       :', p.totalBaseline);
console.log('totalSetAsides      :', p.totalSetAsides);
console.log('totalRemainingBalance:', p.totalRemainingBalance);

const chk = BE.evaluateBudgetCheck({ requestId:'X', owningOffice:'OMD', totalEstimatedCost: 2500 }, state);
console.log('\n--- gatekeeper on a $2,500 request ---');
console.log('hasSufficientFunds  :', chk.hasSufficientFunds);
console.log('message             :', chk.message);
