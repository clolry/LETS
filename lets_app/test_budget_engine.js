/**
 * Automated Verification Script for LETS Budget Engine
 */

const assert = require('assert');
const CONFIG = require('./server/00_config/BudgetConfig.js');
const BudgetEngine = require('./server/30_services/BudgetEngine.js');

console.log('--- Starting LETS Budget Engine Test Suite ---');

// 1. Verify Proportional Shares
const sharesResult = BudgetEngine.calculateProportionalShares(CONFIG.baselineAllocations, []);
console.log('1. Proportional Shares calculated:');
console.log('   Total DAC Pool:', sharesResult.totalDacAllocation);
console.log('   Shares:', sharesResult.shares);
assert.strictEqual(sharesResult.totalDacAllocation, 993000);
assert.strictEqual(sharesResult.shares.OMD, 0.153);
assert.strictEqual(sharesResult.shares.IDV, 0.664);
assert.strictEqual(sharesResult.shares.CM, 0.183);
console.log('✔ Proportional shares match specification (15.3%, 66.4%, 18.3%)');

// 2. Verify Set-Asides for each DAC
//
// THE SHARED POOL IS $560,500, NOT $20,000. @clolry's FY27 funding model puts
// four things in it: the $20,000 FO LC gap, the $440,000 travel portion of the
// FY27 Event Plan (23 lines), the $52,500 COE programme, and $48,000 of FC
// senior-advisor travel.
//
// COE MOVED, which is why this file had to change rather than merely be
// re-run. It was SELF_FUNDED against CM alone — "funded solely by CM DAC" —
// and the assertion below used to read `cmSetAsides.selfFundedTotal === 64500`
// (12,000 LC + 52,500 COE). @clolry: "we finally decided to share the costs
// for COE proportionately across the orgs."
const SHARED_POOL = 20000 + 440000 + 52500 + 48000;   // 560,500

const omdSetAsides = BudgetEngine.calculateOfficeSetAsides('OMD', CONFIG.defaultSetAsides, sharesResult.shares);
console.log('\n2. OMD Set-Asides:');
console.log('   Self-Funded (DAC LC):', omdSetAsides.selfFundedTotal);
console.log('   Enterprise Shared (15.3% of $560,500):', omdSetAsides.enterpriseSharedTotal);
console.log('   Total OMD Set-Asides:', omdSetAsides.totalSetAsides);
assert.strictEqual(omdSetAsides.selfFundedTotal, 12000);
assert.strictEqual(omdSetAsides.enterpriseSharedTotal, SHARED_POOL * 0.153); // 85,756.50
assert.strictEqual(omdSetAsides.totalSetAsides, 97756.50);

const idvSetAsides = BudgetEngine.calculateOfficeSetAsides('IDV', CONFIG.defaultSetAsides, sharesResult.shares);
assert.strictEqual(idvSetAsides.selfFundedTotal, 12000);
assert.strictEqual(idvSetAsides.enterpriseSharedTotal, SHARED_POOL * 0.664); // 372,172.00
assert.strictEqual(idvSetAsides.totalSetAsides, 384172.00);

const cmSetAsides = BudgetEngine.calculateOfficeSetAsides('CM', CONFIG.defaultSetAsides, sharesResult.shares);
// 12,000 LC only now. The COE's $52,500 is in the shared pool above.
assert.strictEqual(cmSetAsides.selfFundedTotal, 12000);
assert.strictEqual(cmSetAsides.enterpriseSharedTotal, SHARED_POOL * 0.183); // 102,571.50
assert.strictEqual(cmSetAsides.totalSetAsides, 114571.50);

// The three shares must account for the WHOLE pool, or the enterprise cost is
// under-recovered and no single DAC row looks wrong.
assert.strictEqual(
  omdSetAsides.enterpriseSharedTotal + idvSetAsides.enterpriseSharedTotal +
  cmSetAsides.enterpriseSharedTotal, SHARED_POOL);

// THE FRONT OFFICE: no shared burden, because the gap exists to cover FO and
// charging it a share would be circular. But its entire $4,000 baseline IS
// committed to LC travel, so it holds no discretionary money — @clolry's sheet
// shows ($4,000) in the FO set-aside column and $0.00 remaining.
const foSetAsides = BudgetEngine.calculateOfficeSetAsides('FO', CONFIG.defaultSetAsides, sharesResult.shares);
assert.strictEqual(foSetAsides.enterpriseSharedTotal, 0);
assert.strictEqual(foSetAsides.selfFundedTotal, 4000);
console.log('✔ Set-asides correct for all DACs (LC, Event Plan, COE, advisor, FO gap)');

// 3. Verify Discretionary Base
const stateInitial = {
  offices: CONFIG.baselineAllocations,
  budgetAdjustments: [],
  setAsides: CONFIG.defaultSetAsides,
  requests: []
};

const omdInitial = BudgetEngine.calculateOfficeBudgetSummary('OMD', stateInitial);
console.log('\n3. OMD Discretionary Base:');
console.log('   Baseline:', omdInitial.baselineAllocation);
console.log('   Total Set-Asides:', omdInitial.setAsides.totalSetAsides);
console.log('   Remaining Discretionary Balance:', omdInitial.remainingDiscretionaryBalance);

// These are the FY27 Discretionary Travel Balances @clolry published to the
// DACs, with the $48,000 advisor line added. They are the numbers each DAC
// manages against all year, so they are asserted as LITERALS rather than
// re-derived from the config: a config edit that moves them must fail here
// loudly, not quietly compute a new "correct" answer and agree with itself.
// 152,000 - 97,756.50 = 54,243.50
assert.strictEqual(omdInitial.remainingDiscretionaryBalance, 54243.50);

const idvInitial = BudgetEngine.calculateOfficeBudgetSummary('IDV', stateInitial);
// 659,000 - 384,172.00 = 274,828.00
assert.strictEqual(idvInitial.remainingDiscretionaryBalance, 274828.00);

const cmInitial = BudgetEngine.calculateOfficeBudgetSummary('CM', stateInitial);
// 182,000 - 114,571.50 = 67,428.50
assert.strictEqual(cmInitial.remainingDiscretionaryBalance, 67428.50);

const foInitial = BudgetEngine.calculateOfficeBudgetSummary('FO', stateInitial);
// 4,000 - 4,000 = 0
assert.strictEqual(foInitial.remainingDiscretionaryBalance, 0);

assert.strictEqual(
  omdInitial.remainingDiscretionaryBalance + idvInitial.remainingDiscretionaryBalance +
  cmInitial.remainingDiscretionaryBalance + foInitial.remainingDiscretionaryBalance,
  396500);
console.log('✔ Discretionary balances match the published FY27 figures ' +
            '(OMD $54,243.50, IDV $274,828.00, CM $67,428.50, total $396,500)');

// 4. Verify Expense Commitment & Double-Counting Prevention
console.log('\n4. Testing Expense Lifecycle & Double-Counting Prevention:');
const stateWithTrip1 = {
  offices: CONFIG.baselineAllocations,
  budgetAdjustments: [],
  setAsides: CONFIG.defaultSetAsides,
  requests: [
    {
      requestId: 'REQ-001',
      owningOffice: 'OMD',
      status: CONFIG.requestStatus.APPROVED,
      totalEstimatedCost: 5000.00,
      totalActualCost: 0
    }
  ]
};

const omdWithEstimate = BudgetEngine.calculateOfficeBudgetSummary('OMD', stateWithTrip1);
console.log('   Pending Estimate committed: $5,000');
console.log('   Remaining Discretionary Balance:', omdWithEstimate.remainingDiscretionaryBalance);
// 54,243.50 - 5,000 = 49,243.50
assert.strictEqual(omdWithEstimate.pendingEstimates, 5000);
assert.strictEqual(omdWithEstimate.remainingDiscretionaryBalance, 49243.50);

// Trip 1 completes and reconciles with Actual of $5,400 (Variance: +$400)
const stateWithTrip1Reconciled = {
  offices: CONFIG.baselineAllocations,
  budgetAdjustments: [],
  setAsides: CONFIG.defaultSetAsides,
  requests: [
    {
      requestId: 'REQ-001',
      owningOffice: 'OMD',
      status: CONFIG.requestStatus.RECONCILED,
      totalEstimatedCost: 5000.00,
      totalActualCost: 5400.00
    }
  ]
};

const omdReconciled = BudgetEngine.calculateOfficeBudgetSummary('OMD', stateWithTrip1Reconciled);
console.log('   Trip Reconciled: Actuals posted $5,400');
console.log('   Pending Estimates (cleared):', omdReconciled.pendingEstimates);
console.log('   Posted Actuals:', omdReconciled.postedActuals);
console.log('   Remaining Discretionary Balance:', omdReconciled.remainingDiscretionaryBalance);
// 54,243.50 - 5,400 = 48,843.50
assert.strictEqual(omdReconciled.pendingEstimates, 0);
assert.strictEqual(omdReconciled.postedActuals, 5400);
assert.strictEqual(omdReconciled.remainingDiscretionaryBalance, 48843.50);
console.log('✔ Double-counting prevented: estimate cleared and actual posted');

// 5. Verify Mid-Year Budget Adjustments
console.log('\n5. Testing Mid-Year Budget Adjustments:');
const stateWithAdjustment = {
  offices: CONFIG.baselineAllocations,
  budgetAdjustments: [
    {
      adjustmentId: 'ADJ-001',
      officeCode: 'OMD',
      amount: 10000.00,
      reason: 'Q2 Discretionary Augmentation',
      effectiveDate: '2027-02-15'
    }
  ],
  setAsides: CONFIG.defaultSetAsides,
  requests: stateWithTrip1Reconciled.requests
};

const omdAdjusted = BudgetEngine.calculateOfficeBudgetSummary('OMD', stateWithAdjustment);
console.log('   OMD Total Allocation with +$10k:', omdAdjusted.totalAllocation);
console.log('   Revised Available Discretionary Balance:', omdAdjusted.remainingDiscretionaryBalance);
assert.strictEqual(omdAdjusted.totalAllocation, 162000);
// 162,000 - 97,756.50 - 5,400 = 58,843.50
assert.strictEqual(omdAdjusted.remainingDiscretionaryBalance, 58843.50);
console.log('✔ Mid-year budget adjustments successfully updated and reconciled');

// 6. Verify Budget Check Gatekeeper
console.log('\n6. Testing Budget Check Gatekeeper:');
const validRequest = {
  requestId: 'REQ-002',
  owningOffice: 'OMD',
  totalEstimatedCost: 2500.00
};
const checkPass = BudgetEngine.evaluateBudgetCheck(validRequest, stateWithAdjustment);
assert.strictEqual(checkPass.status, CONFIG.requestStatus.BUDGET_CHECK_PASSED);
assert.strictEqual(checkPass.hasSufficientFunds, true);
console.log('   Pass check for $2,500:', checkPass.message);

const excessiveRequest = {
  requestId: 'REQ-003',
  owningOffice: 'OMD',
  totalEstimatedCost: 150000.00
};
const checkFail = BudgetEngine.evaluateBudgetCheck(excessiveRequest, stateWithAdjustment);
assert.strictEqual(checkFail.status, CONFIG.requestStatus.BUDGET_FLAGGED_INSUFFICIENT);
assert.strictEqual(checkFail.hasSufficientFunds, false);
console.log('   Fail check for $150,000:', checkFail.message);
console.log('✔ Budget check gatekeeper operating accurately');

// 7. Verify Portfolio Summary
console.log('\n7. Portfolio Summary:');
const portfolio = BudgetEngine.generatePortfolioSummary(stateWithAdjustment);
console.log('   Total Baseline:', portfolio.totalBaseline);
console.log('   Total Current Allocation:', portfolio.totalAllocation);
console.log('   Total Set-Asides:', portfolio.totalSetAsides);
console.log('   Total Net Discretionary Balance:', portfolio.totalRemainingBalance);
assert.strictEqual(portfolio.totalBaseline, 997000); // 4000 FO + 993000 DACs
assert.strictEqual(portfolio.totalAllocation, 1007000); // with +$10k adj
console.log('✔ Portfolio summary totals verified');

console.log('\n--- ALL TEST SUITE ASSERTIONS PASSED! ---');
