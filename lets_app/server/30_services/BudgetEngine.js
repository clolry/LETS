/**
 * LETS - Logistics, Events, and Travel System
 * Core Financial Management & Budget Calculation Engine
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const config = require('../00_config/BudgetConfig.js');
    module.exports = factory(config);
  } else {
    root.BudgetEngine = factory(root.LETS_CONFIG);
  }
})(typeof self !== 'undefined' ? self : this, function (CONFIG) {
  'use strict';

  /**
   * Helper: round monetary values cleanly to 2 decimal places
   */
  function roundCurrency(val) {
    return Math.round((Number(val) || 0) * 100) / 100;
  }

  /**
   * Calculates the current total allocation for an office,
   * factoring in baseline plus any mid-year adjustments.
   */
  function calculateTotalAllocation(officeCode, baselineAmount, adjustmentsList) {
    const baseline = Number(baselineAmount) || 0;
    const adjustments = (adjustmentsList || [])
      .filter(adj => adj.officeCode === officeCode)
      .reduce((sum, adj) => sum + (Number(adj.amount) || 0), 0);
    return roundCurrency(baseline + adjustments);
  }

  /**
   * Calculates proportional shares for DACs.
   * By default, uses the official stored proportional shares (OMD: 15.3%, IDV: 66.4%, CM: 18.3%)
   * unless dynamically recalculated when re-baselining.
   */
  function calculateProportionalShares(officesMap, adjustmentsList, useStoredShares = true) {
    const dacCodes = ['OMD', 'IDV', 'CM'];
    let totalDacAllocation = 0;
    const totals = {};

    dacCodes.forEach(code => {
      const office = officesMap[code] || CONFIG.baselineAllocations[code];
      const baseline = office ? office.baselineAmount : 0;
      const total = calculateTotalAllocation(code, baseline, adjustmentsList);
      totals[code] = total;
      totalDacAllocation += total;
    });

    const shares = {};
    dacCodes.forEach(code => {
      if (useStoredShares && CONFIG.baselineAllocations[code] && CONFIG.baselineAllocations[code].standardProportionalShare) {
        shares[code] = CONFIG.baselineAllocations[code].standardProportionalShare;
      } else if (totalDacAllocation > 0) {
        shares[code] = roundCurrency((totals[code] / totalDacAllocation) * 1000) / 1000;
      } else {
        shares[code] = 0;
      }
    });

    return { totals, totalDacAllocation: roundCurrency(totalDacAllocation), shares };
  }

  /**
   * Calculates set-asides breakdown for a specific office:
   * - Self-Funded (deducted 100% from that office)
   * - Enterprise Shared (deducted proportionally if DAC)
   */
  function calculateOfficeSetAsides(officeCode, setAsidesList, proportionalShares) {
    let selfFundedTotal = 0;
    let enterpriseSharedTotal = 0;
    const breakdown = [];

    (setAsidesList || []).forEach(item => {
      const amount = Number(item.amount) || 0;
      if (item.type === 'SELF_FUNDED' && item.targetOffice === officeCode) {
        selfFundedTotal += amount;
        breakdown.push({
          id: item.id,
          title: item.title,
          type: 'SELF_FUNDED',
          amount: roundCurrency(amount),
          appliedDeduction: roundCurrency(amount)
        });
      } else if (item.type === 'ENTERPRISE_SHARED') {
        // Shared across DACs by proportional share
        const share = proportionalShares[officeCode] || 0;
        const allocatedAmount = roundCurrency(amount * share);
        enterpriseSharedTotal += allocatedAmount;
        breakdown.push({
          id: item.id,
          title: item.title,
          type: 'ENTERPRISE_SHARED',
          amount: roundCurrency(amount),
          proportionalShare: share,
          appliedDeduction: allocatedAmount
        });
      }
    });

    return {
      selfFundedTotal: roundCurrency(selfFundedTotal),
      enterpriseSharedTotal: roundCurrency(enterpriseSharedTotal),
      totalSetAsides: roundCurrency(selfFundedTotal + enterpriseSharedTotal),
      breakdown
    };
  }

  /**
   * Calculates pending commitments vs. posted actuals for an office.
   * Enforces double-counting prevention:
   * - If a trip is RECONCILED, its actual cost is counted in postedActuals,
   *   and its estimated cost is NOT counted in pendingEstimates.
   */
  function calculateSpendAndCommitments(officeCode, requestsList) {
    let pendingEstimates = 0;
    let postedActuals = 0;
    let pendingRequestCount = 0;
    let reconciledRequestCount = 0;

    const pendingStatuses = [
      CONFIG.requestStatus.SUBMITTED,
      CONFIG.requestStatus.BUDGET_CHECK_PASSED,
      CONFIG.requestStatus.BUDGET_FLAGGED_INSUFFICIENT,
      CONFIG.requestStatus.EXCEPTION_REVIEW,
      CONFIG.requestStatus.LEADERSHIP_REVIEW,
      CONFIG.requestStatus.APPROVED,
      CONFIG.requestStatus.BOOKED,
      CONFIG.requestStatus.TRAVEL_COMPLETE
    ];

    (requestsList || []).forEach(req => {
      if (req.owningOffice !== officeCode) return;

      const estimated = Number(req.totalEstimatedCost) || 0;
      const actual = Number(req.totalActualCost) || 0;

      if (req.status === CONFIG.requestStatus.RECONCILED) {
        // Reconciled: estimate cleared from pending, actual cost posted
        postedActuals += actual;
        reconciledRequestCount++;
      } else if (pendingStatuses.indexOf(req.status) !== -1) {
        // Active in pipeline: temporary commitment against discretionary balance
        pendingEstimates += estimated;
        pendingRequestCount++;
      }
    });

    return {
      pendingEstimates: roundCurrency(pendingEstimates),
      postedActuals: roundCurrency(postedActuals),
      pendingRequestCount,
      reconciledRequestCount
    };
  }

  /**
   * The Core Calculation: Remaining Discretionary Balance
   * Available Balance = [Starting Allocation + MidYearAdjustments]
   *                   - [Sum of Self-Funded Set-Asides]
   *                   - [Calculated Share of Enterprise Set-Asides]
   *                   - [Sum of Pending Estimated Costs]
   *                   - [Sum of Posted Actual Travel Costs]
   */
  function calculateOfficeBudgetSummary(officeCode, state) {
    const officesMap = state.offices || CONFIG.baselineAllocations;
    const adjustmentsList = state.budgetAdjustments || [];
    const setAsidesList = state.setAsides || CONFIG.defaultSetAsides;
    const requestsList = state.requests || [];

    const office = officesMap[officeCode] || CONFIG.baselineAllocations[officeCode] || {
      code: officeCode,
      name: officeCode,
      baselineAmount: 0
    };

    // 1. Total Allocation
    const totalAllocation = calculateTotalAllocation(officeCode, office.baselineAmount, adjustmentsList);

    // 2. Proportional Share (for enterprise set-asides)
    const { shares } = calculateProportionalShares(officesMap, adjustmentsList);

    // 3. Set-Asides
    const setAsides = calculateOfficeSetAsides(officeCode, setAsidesList, shares);

    // 4. Discretionary Base before travel spend
    const discretionaryBase = roundCurrency(totalAllocation - setAsides.totalSetAsides);

    // 5. Spend & Commitments
    const spend = calculateSpendAndCommitments(officeCode, requestsList);

    // 6. Final Remaining Discretionary Balance
    const remainingDiscretionaryBalance = roundCurrency(
      discretionaryBase - spend.pendingEstimates - spend.postedActuals
    );

    return {
      officeCode,
      officeName: office.name,
      baselineAllocation: roundCurrency(office.baselineAmount),
      totalAllocation,
      proportionalShare: shares[officeCode] || 0,
      setAsides,
      discretionaryBase,
      pendingEstimates: spend.pendingEstimates,
      postedActuals: spend.postedActuals,
      pendingRequestCount: spend.pendingRequestCount,
      reconciledRequestCount: spend.reconciledRequestCount,
      remainingDiscretionaryBalance,
      isDeficit: remainingDiscretionaryBalance < 0
    };
  }

  /**
   * Mandatory Budget Check Engine:
   * Triggered before a request is routed for final leadership approval.
   */
  function evaluateBudgetCheck(request, state) {
    const officeCode = request.owningOffice;
    const estimatedCost = roundCurrency(Number(request.totalEstimatedCost) || 0);

    // Current budget summary excluding THIS request if it was already in state
    const filteredRequests = (state.requests || []).filter(r => r.requestId !== request.requestId);
    const currentState = Object.assign({}, state, { requests: filteredRequests });
    const currentSummary = calculateOfficeBudgetSummary(officeCode, currentState);

    const projectedBalanceAfterTrip = roundCurrency(currentSummary.remainingDiscretionaryBalance - estimatedCost);
    const hasSufficientFunds = projectedBalanceAfterTrip >= 0;

    return {
      requestId: request.requestId,
      officeCode,
      officeName: currentSummary.officeName,
      estimatedCost,
      currentAvailableBalance: currentSummary.remainingDiscretionaryBalance,
      projectedBalanceAfterTrip,
      hasSufficientFunds,
      status: hasSufficientFunds
        ? CONFIG.requestStatus.BUDGET_CHECK_PASSED
        : CONFIG.requestStatus.BUDGET_FLAGGED_INSUFFICIENT,
      message: hasSufficientFunds
        ? `Sufficient discretionary funds available ($${currentSummary.remainingDiscretionaryBalance.toLocaleString()} available vs $${estimatedCost.toLocaleString()} estimated).`
        : `INSUFFICIENT FUNDS: Requested $${estimatedCost.toLocaleString()} exceeds available discretionary balance of $${currentSummary.remainingDiscretionaryBalance.toLocaleString()} (Projected deficit: -$${Math.abs(projectedBalanceAfterTrip).toLocaleString()}).`
    };
  }

  /**
   * Calculates line variance and updates request totals during post-travel reconciliation
   */
  function reconcileTravelerCosts(travelers) {
    let totalEstimated = 0;
    let totalActual = 0;

    const processedTravelers = (travelers || []).map((t, idx) => {
      const estAir = Number(t.estAirfare) || 0;
      const actAir = Number(t.actAirfare) || 0;
      const estLodging = Number(t.estLodging) || 0;
      const actLodging = Number(t.actLodging) || 0;
      const estMie = Number(t.estMie) || 0;
      const actMie = Number(t.actMie) || 0;
      const estOther = Number(t.estOther) || 0;
      const actOther = Number(t.actOther) || 0;

      const lineEst = roundCurrency(estAir + estLodging + estMie + estOther);
      const lineAct = roundCurrency(actAir + actLodging + actMie + actOther);
      const lineVariance = roundCurrency(lineAct - lineEst);

      totalEstimated += lineEst;
      totalActual += lineAct;

      return Object.assign({}, t, {
        travelerIndex: idx + 1,
        totalEstimated: lineEst,
        totalActual: lineAct,
        variance: lineVariance
      });
    });

    const tripVariance = roundCurrency(totalActual - totalEstimated);

    return {
      travelers: processedTravelers,
      totalEstimatedCost: roundCurrency(totalEstimated),
      totalActualCost: roundCurrency(totalActual),
      variance: tripVariance
    };
  }

  /**
   * Generates Portfolio Summary across all pools (Front Office + 3 DACs)
   */
  function generatePortfolioSummary(state) {
    const offices = ['FO', 'OMD', 'IDV', 'CM'];
    const dacSummaries = {};
    let totalBaseline = 0;
    let totalAllocation = 0;
    let totalSetAsides = 0;
    let totalPendingEstimates = 0;
    let totalPostedActuals = 0;
    let totalRemainingBalance = 0;

    offices.forEach(code => {
      const summary = calculateOfficeBudgetSummary(code, state);
      dacSummaries[code] = summary;
      totalBaseline += summary.baselineAllocation;
      totalAllocation += summary.totalAllocation;
      totalSetAsides += summary.setAsides.totalSetAsides;
      totalPendingEstimates += summary.pendingEstimates;
      totalPostedActuals += summary.postedActuals;
      totalRemainingBalance += summary.remainingDiscretionaryBalance;
    });

    return {
      fiscalYear: CONFIG.fiscalYear,
      totalBaseline: roundCurrency(totalBaseline),
      totalAllocation: roundCurrency(totalAllocation),
      totalSetAsides: roundCurrency(totalSetAsides),
      totalPendingEstimates: roundCurrency(totalPendingEstimates),
      totalPostedActuals: roundCurrency(totalPostedActuals),
      totalRemainingBalance: roundCurrency(totalRemainingBalance),
      dacSummaries
    };
  }

  return {
    roundCurrency,
    calculateTotalAllocation,
    calculateProportionalShares,
    calculateOfficeSetAsides,
    calculateSpendAndCommitments,
    calculateOfficeBudgetSummary,
    evaluateBudgetCheck,
    reconcileTravelerCosts,
    generatePortfolioSummary
  };
});
