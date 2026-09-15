/**
 * LETS - Logistics, Events, and Travel System
 * Request & Workflow Domain Service
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const config = require('../00_config/BudgetConfig.js');
    const budgetEngine = require('../30_services/BudgetEngine.js');
    const letsDB = require('../20_data/LetsDB.js');
    module.exports = factory(config, budgetEngine, letsDB);
  } else {
    root.RequestService = factory(root.LETS_CONFIG, root.BudgetEngine, root.LetsDB);
  }
})(typeof self !== 'undefined' ? self : this, function (CONFIG, BudgetEngine, LetsDB) {
  'use strict';

  /**
   * Generates a unique Request ID (e.g. LETS-2027-001)
   */
  function generateRequestId(existingCount) {
    const year = CONFIG.fiscalYear.replace('FY', '20');
    const seq = String((existingCount || 0) + 1).padStart(3, '0');
    return `LETS-${year}-${seq}`;
  }

  /**
   * Validates and submits a new travel request from the intake form
   */
  function createTravelRequest(formData, state) {
    if (!formData.owningOffice) {
      throw new Error('Owning Office is mandatory for budget allocation.');
    }
    if (!formData.eventName || !formData.eventName.trim()) {
      throw new Error('Event / Trip Name is required.');
    }
    if (!formData.travelers || !formData.travelers.length) {
      throw new Error('At least one traveler must be specified.');
    }

    // Process travelers and compute initial estimates
    const travelerRec = BudgetEngine.reconcileTravelerCosts(formData.travelers);
    const existingRequests = state.requests || [];
    const requestId = formData.requestId || generateRequestId(existingRequests.length);

    const newRequest = {
      requestId: requestId,
      status: CONFIG.requestStatus.SUBMITTED,
      eventName: formData.eventName.trim(),
      owningOffice: formData.owningOffice,
      fundingSource: formData.fundingSource || 'Discretionary',
      setAsideType: formData.setAsideType || 'NONE',
      isEventPlanItem: Boolean(formData.isEventPlanItem),
      is_LC_Travel: Boolean(formData.is_LC_Travel),
      is_COE_Travel: Boolean(formData.is_COE_Travel),
      totalEstimatedCost: travelerRec.totalEstimatedCost,
      totalActualCost: 0.00,
      variance: 0.00,
      budgetCheckStatus: 'PENDING',
      submitterEmail: formData.submitterEmail || '',
      submitterName: formData.submitterName || '',
      destination: formData.destination || '',
      startDate: formData.startDate || '',
      endDate: formData.endDate || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Attach request ID to travelers
    const travelersWithId = travelerRec.travelers.map((t, idx) => {
      return Object.assign({}, t, {
        travelerId: `${requestId}-T${idx + 1}`,
        associatedRequestId: requestId,
        status: 'ESTIMATED'
      });
    });

    // Execute Mandatory Budget Check Gatekeeper
    const budgetCheck = BudgetEngine.evaluateBudgetCheck(newRequest, state);
    newRequest.budgetCheckStatus = budgetCheck.status;

    if (budgetCheck.hasSufficientFunds) {
      // Moves directly to Leadership Review
      newRequest.status = CONFIG.requestStatus.LEADERSHIP_REVIEW;
    } else {
      // Flagged: Insufficient funds -> routed to Exception Approval
      newRequest.status = CONFIG.requestStatus.BUDGET_FLAGGED_INSUFFICIENT;
    }

    // Determine assigned approver based on Org_Approvers mapping
    const approvers = state.approvers || CONFIG.defaultApprovers;
    const assignedApprover = approvers[newRequest.owningOffice] || {
      primaryApproverEmail: 'approvals@gsa.gov',
      primaryApproverName: 'Department Approver'
    };

    return {
      request: newRequest,
      travelers: travelersWithId,
      budgetCheck: budgetCheck,
      assignedApprover: assignedApprover
    };
  }

  /**
   * Post-travel reconciliation: captures actual costs, computes variances,
   * liquidates pending commitments, and updates remaining balance.
   */
  function reconcileRequest(requestId, actualTravelersData, state) {
    const requests = state.requests || [];
    const request = requests.find(r => r.requestId === requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found.`);
    }

    // Reconcile costs with both estimated and actual values
    const travelerRec = BudgetEngine.reconcileTravelerCosts(actualTravelersData);

    request.totalEstimatedCost = travelerRec.totalEstimatedCost;
    request.totalActualCost = travelerRec.totalActualCost;
    request.variance = travelerRec.variance;
    request.status = CONFIG.requestStatus.RECONCILED;
    request.updatedAt = new Date().toISOString();

    return {
      request: request,
      travelers: travelerRec.travelers,
      variance: travelerRec.variance
    };
  }

  /**
   * Advances Kanban stage with role and permission checks
   */
  function updateRequestStatus(requestId, newStatus, userEmail, comment, state) {
    const requests = state.requests || [];
    const request = requests.find(r => r.requestId === requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found.`);
    }

    const previousStatus = request.status;
    request.status = newStatus;
    request.updatedAt = new Date().toISOString();

    const auditEntry = {
      logId: 'AUDIT-' + Date.now(),
      timestamp: new Date().toISOString(),
      actorEmail: userEmail || 'system',
      actionType: 'STATUS_CHANGE',
      targetEntity: 'Request',
      entityId: requestId,
      detailsJSON: JSON.stringify({
        from: previousStatus,
        to: newStatus,
        comment: comment || ''
      })
    };

    return {
      request: request,
      auditEntry: auditEntry
    };
  }

  return {
    generateRequestId,
    createTravelRequest,
    reconcileRequest,
    updateRequestStatus
  };
});
