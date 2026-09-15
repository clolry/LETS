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
const omdSetAsides = BudgetEngine.calculateOfficeSetAsides('OMD', CONFIG.defaultSetAsides, sharesResult.shares);
console.log('\n2. OMD Set-Asides:');
console.log('   Self-Funded (DAC LC):', omdSetAsides.selfFundedTotal);
console.log('   Enterprise Shared (15.3% of $20k FO Gap):', omdSetAsides.enterpriseSharedTotal);
console.log('   Total OMD Set-Asides:', omdSetAsides.totalSetAsides);
assert.strictEqual(omdSetAsides.selfFundedTotal, 12000);
assert.strictEqual(omdSetAsides.enterpriseSharedTotal, 3060); // 20000 * 0.153 = 3060
assert.strictEqual(omdSetAsides.totalSetAsides, 15060);

const idvSetAsides = BudgetEngine.calculateOfficeSetAsides('IDV', CONFIG.defaultSetAsides, sharesResult.shares);
assert.strictEqual(idvSetAsides.selfFundedTotal, 12000);
assert.strictEqual(idvSetAsides.enterpriseSharedTotal, 13280); // 20000 * 0.664 = 13280

const cmSetAsides = BudgetEngine.calculateOfficeSetAsides('CM', CONFIG.defaultSetAsides, sharesResult.shares);
assert.strictEqual(cmSetAsides.selfFundedTotal, 64500); // 12000 LC + 52500 COE = 64500
assert.strictEqual(cmSetAsides.enterpriseSharedTotal, 3660); // 20000 * 0.183 = 3660
console.log('✔ Set-asides correctly deducted for all DACs (including COE & FO Gap)');

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
// 152,000 - 15,060 = 136,940
assert.strictEqual(omdInitial.remainingDiscretionaryBalance, 136940);

const cmInitial = BudgetEngine.calculateOfficeBudgetSummary('CM', stateInitial);
// 182,000 - (64,500 + 3,660) = 182,000 - 68,160 = 113,840
assert.strictEqual(cmInitial.remainingDiscretionaryBalance, 113840);
console.log('✔ Discretionary base calculation accurate (OMD: $136,940, CM: $113,840)');

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
// 136,940 - 5,000 = 131,940
assert.strictEqual(omdWithEstimate.pendingEstimates, 5000);
assert.strictEqual(omdWithEstimate.remainingDiscretionaryBalance, 131940);

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
// 136,940 - 5,400 = 131,540
assert.strictEqual(omdReconciled.pendingEstimates, 0);
assert.strictEqual(omdReconciled.postedActuals, 5400);
assert.strictEqual(omdReconciled.remainingDiscretionaryBalance, 131540);
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
assert.strictEqual(omdAdjusted.remainingDiscretionaryBalance, 141540);
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
