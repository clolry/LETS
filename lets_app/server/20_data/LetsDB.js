/**
 * LETS - Logistics, Events, and Travel System
 * Google Sheets Database Layer & Persistence Service
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const config = require('../00_config/BudgetConfig.js');
    module.exports = factory(config);
  } else {
    root.LetsDB = factory(root.LETS_CONFIG);
  }
})(typeof self !== 'undefined' ? self : this, function (CONFIG) {
  'use strict';

  /**
   * Table Header Schemas
   */
  const SCHEMAS = {
    [CONFIG.sheets.budgets]: [
      'OfficeCode',
      'OfficeName',
      'BaselineAllocation',
      'MidYearAdjustments',
      'CurrentTotalAllocation',
      'ProportionalShare',
      'SelfFundedSetAsides',
      'EnterpriseSetAsidesAllocated',
      'CommittedPendingEstimated',
      'PostedActualSpend',
      'RemainingDiscretionaryBalance',
      'LastCalculated'
    ],
    [CONFIG.sheets.budgetAdjustments]: [
      'AdjustmentID',
      'OfficeCode',
      'Amount',
      'Reason',
      'EffectiveDate',
      'ApprovedBy',
      'Timestamp'
    ],
    [CONFIG.sheets.setAsides]: [
      'SetAsideID',
      'Title',
      'Type',
      'TargetOffice',
      'Amount',
      'Description',
      'Active'
    ],
    [CONFIG.sheets.approvers]: [
      'OfficeCode',
      'OfficeName',
      'PrimaryApproverName',
      'PrimaryApproverEmail',
      'AlternateApproverName',
      'AlternateApproverEmail',
      'LastUpdated',
      'UpdatedBy'
    ],
    [CONFIG.sheets.requests]: [
      'RequestID',
      'Status',
      'EventName',
      'OwningOffice',
      'FundingSource',
      'SetAsideType',
      'IsEventPlanItem',
      'Is_LC_Travel',
      'Is_COE_Travel',
      'TotalEstimatedCost',
      'TotalActualCost',
      'Variance',
      'BudgetCheckStatus',
      'SubmitterEmail',
      'SubmitterName',
      'Destination',
      'StartDate',
      'EndDate',
      'CreatedAt',
      'UpdatedAt'
    ],
    [CONFIG.sheets.travelers]: [
      'TravelerID',
      'AssociatedRequestID',
      'TravelerName',
      'TravelerEmail',
      'EstAirfare',
      'ActAirfare',
      'EstLodging',
      'ActLodging',
      'EstMie',
      'ActMie',
      'EstOther',
      'ActOther',
      'TotalEstimated',
      'TotalActual',
      'Variance',
      'Status'
    ],
    [CONFIG.sheets.auditLog]: [
      'LogID',
      'Timestamp',
      'ActorEmail',
      'ActionType',
      'TargetEntity',
      'EntityID',
      'DetailsJSON'
    ]
  };

  /**
   * Helper to format rows from Sheet data
   */
  function sheetDataToObjects(sheet) {
    if (!sheet) return [];
    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return [];

    const headers = values[0];
    const results = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!row || row.every(c => c === '' || c === null)) continue;
      const obj = {};
      headers.forEach((h, colIdx) => {
        obj[h] = row[colIdx];
      });
      results.push(obj);
    }
    return results;
  }

  /**
   * Initializes all required Sheets with headers and default configuration if empty
   */
  function initializeDatabase(spreadsheet) {
    if (!spreadsheet) return false;

    Object.keys(SCHEMAS).forEach(sheetName => {
      let sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        sheet = spreadsheet.insertSheet(sheetName);
      }
      if (sheet.getLastRow() === 0) {
        const headers = SCHEMAS[sheetName];
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f1f3f4');
        sheet.setFrozenRows(1);
      }
    });

    // Seed default baseline allocations if Budgets tab has only header
    const budgetSheet = spreadsheet.getSheetByName(CONFIG.sheets.budgets);
    if (budgetSheet && budgetSheet.getLastRow() <= 1) {
      const rows = Object.values(CONFIG.baselineAllocations).map(alloc => [
        alloc.code,
        alloc.name,
        alloc.baselineAmount,
        0,
        alloc.baselineAmount,
        alloc.standardProportionalShare || 0,
        0,
        0,
        0,
        0,
        alloc.baselineAmount,
        new Date().toISOString()
      ]);
      budgetSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }

    // Seed Set-Asides if empty
    const setAsideSheet = spreadsheet.getSheetByName(CONFIG.sheets.setAsides);
    if (setAsideSheet && setAsideSheet.getLastRow() <= 1) {
      const rows = CONFIG.defaultSetAsides.map(sa => [
        sa.id,
        sa.title,
        sa.type,
        sa.targetOffice,
        sa.amount,
        sa.description,
        'TRUE'
      ]);
      setAsideSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }

    // Seed default approvers if empty
    const approverSheet = spreadsheet.getSheetByName(CONFIG.sheets.approvers);
    if (approverSheet && approverSheet.getLastRow() <= 1) {
      const rows = Object.values(CONFIG.defaultApprovers).map(appr => [
        appr.officeCode,
        appr.officeName,
        appr.primaryApproverName,
        appr.primaryApproverEmail,
        appr.alternateApproverName,
        appr.alternateApproverEmail,
        new Date().toISOString(),
        'SYSTEM_INIT'
      ]);
      approverSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }

    return true;
  }

  return {
    SCHEMAS,
    sheetDataToObjects,
    initializeDatabase
  };
});
