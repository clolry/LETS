/**
 * LETS - Logistics, Events, and Travel System
 * Server Configuration: Budget, DAC Allocations, Set-Asides, and Org Approvers
 */

const LETS_CONFIG = {
  appName: 'LETS - Logistics, Events, and Travel System',
  fiscalYear: 'FY27',
  
  // Primary budget pools and baseline allocations
  baselineAllocations: {
    FO: {
      code: 'FO',
      name: 'Front Office / AC',
      isDac: false,
      baselineAmount: 4000.00
    },
    OMD: {
      code: 'OMD',
      name: 'OMD DAC',
      isDac: true,
      baselineAmount: 152000.00,
      standardProportionalShare: 0.153 // 15.3%
    },
    IDV: {
      code: 'IDV',
      name: 'IDV DAC',
      isDac: true,
      baselineAmount: 659000.00,
      standardProportionalShare: 0.664 // 66.4%
    },
    CM: {
      code: 'CM',
      name: 'CM DAC',
      isDac: true,
      baselineAmount: 182000.00,
      standardProportionalShare: 0.183 // 18.3%
    }
  },

  // Official Set-Aside definitions
  defaultSetAsides: [
    {
      id: 'SETASIDE_DAC_LC_OMD',
      title: 'DAC LC Travel - OMD',
      type: 'SELF_FUNDED',
      targetOffice: 'OMD',
      amount: 12000.00,
      description: 'Dedicated LC travel set-aside for OMD DAC'
    },
    {
      id: 'SETASIDE_DAC_LC_IDV',
      title: 'DAC LC Travel - IDV',
      type: 'SELF_FUNDED',
      targetOffice: 'IDV',
      amount: 12000.00,
      description: 'Dedicated LC travel set-aside for IDV DAC'
    },
    {
      id: 'SETASIDE_DAC_LC_CM',
      title: 'DAC LC Travel - CM',
      type: 'SELF_FUNDED',
      targetOffice: 'CM',
      amount: 12000.00,
      description: 'Dedicated LC travel set-aside for CM DAC'
    },
    {
      id: 'SETASIDE_COE_PROGRAM',
      title: 'COE Program',
      type: 'SELF_FUNDED',
      targetOffice: 'CM',
      amount: 52500.00,
      description: 'Center of Excellence program travel, funded solely by CM DAC'
    },
    {
      id: 'SETASIDE_FO_LC_GAP',
      title: 'Front Office LC Travel Gap',
      type: 'ENTERPRISE_SHARED',
      targetOffice: 'SHARED_DAC', // Distributed among OMD (15.3%), IDV (66.4%), CM (18.3%)
      amount: 20000.00,
      description: 'Shared ASD responsibility covering Front Office LC travel gap'
    }
  ],

  // Default initial approver configuration per Owning Office
  defaultApprovers: {
    FO: {
      officeCode: 'FO',
      officeName: 'Front Office / AC',
      primaryApproverName: 'Front Office Director',
      primaryApproverEmail: 'fo.director@gsa.gov',
      alternateApproverName: 'Front Office Deputy',
      alternateApproverEmail: 'fo.deputy@gsa.gov'
    },
    OMD: {
      officeCode: 'OMD',
      officeName: 'OMD DAC',
      primaryApproverName: 'OMD Director',
      primaryApproverEmail: 'omd.director@gsa.gov',
      alternateApproverName: 'OMD Deputy',
      alternateApproverEmail: 'omd.deputy@gsa.gov'
    },
    IDV: {
      officeCode: 'IDV',
      officeName: 'IDV DAC',
      primaryApproverName: 'IDV Director',
      primaryApproverEmail: 'idv.director@gsa.gov',
      alternateApproverName: 'IDV Deputy',
      alternateApproverEmail: 'idv.deputy@gsa.gov'
    },
    CM: {
      officeCode: 'CM',
      officeName: 'CM DAC',
      primaryApproverName: 'CM Director',
      primaryApproverEmail: 'cm.director@gsa.gov',
      alternateApproverName: 'CM Deputy',
      alternateApproverEmail: 'cm.deputy@gsa.gov'
    }
  },

  // Sheet table names
  sheets: {
    budgets: 'Budgets',
    budgetAdjustments: 'Budget_Adjustments',
    setAsides: 'Set_Asides',
    approvers: 'Org_Approvers',
    requests: 'Requests',
    travelers: 'Travelers',
    auditLog: 'Audit_Log'
  },

  // Workflow status definitions
  requestStatus: {
    INTAKE_DRAFT: 'Draft',
    SUBMITTED: 'Submitted - Pending Budget Check',
    BUDGET_CHECK_PASSED: 'Budget Check Passed',
    BUDGET_FLAGGED_INSUFFICIENT: 'Flagged - Insufficient Funds',
    EXCEPTION_REVIEW: 'Pending Exception Approval',
    LEADERSHIP_REVIEW: 'Pending Leadership Review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    BOOKED: 'Booked / Travel Ready',
    TRAVEL_COMPLETE: 'Travel Completed',
    RECONCILED: 'Reconciled / Actuals Posted',
    CANCELLED: 'Cancelled'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LETS_CONFIG;
}
