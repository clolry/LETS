/**
 * LETS - Logistics, Events, and Travel System
 * Web App Entrypoint & Client RPC Bridge
 */

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || 'kanban';
  const template = HtmlService.createTemplateFromFile('client/pages/letsAppLayout');
  template.initialPage = page;
  
  return template.evaluate()
    .setTitle('LETS - Logistics, Events, and Travel System')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Helper to include partial HTML files in GAS templates
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Returns current user context and initial application state
 */
function apiGetInitialData() {
  try {
    const userEmail = Session.getActiveUser().getEmail() || 'chris.olry@gsa.gov';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Ensure database sheets are initialized
    LetsDB.initializeDatabase(ss);
    
    const rawBudgets = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.budgets));
    const rawAdjustments = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.budgetAdjustments));
    const rawSetAsides = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.setAsides));
    const rawApprovers = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.approvers));
    const rawRequests = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.requests));
    const rawTravelers = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.travelers));

    const state = {
      userEmail: userEmail,
      fiscalYear: LETS_CONFIG.fiscalYear,
      offices: LETS_CONFIG.baselineAllocations,
      budgetAdjustments: rawAdjustments,
      setAsides: rawSetAsides.length ? rawSetAsides : LETS_CONFIG.defaultSetAsides,
      approvers: rawApprovers.length ? rawApprovers : LETS_CONFIG.defaultApprovers,
      requests: rawRequests,
      travelers: rawTravelers
    };

    const portfolioSummary = BudgetEngine.generatePortfolioSummary(state);

    return {
      success: true,
      userEmail: userEmail,
      portfolioSummary: portfolioSummary,
      requests: rawRequests,
      travelers: rawTravelers,
      approvers: state.approvers,
      setAsides: state.setAsides,
      config: {
        fiscalYear: LETS_CONFIG.fiscalYear,
        requestStatus: LETS_CONFIG.requestStatus
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || err.toString()
    };
  }
}

/**
 * Client RPC: Submits a new travel request from Intake Form
 */
function apiSubmitRequest(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const rawRequests = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.requests));
    const rawAdjustments = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.budgetAdjustments));
    const rawSetAsides = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.setAsides));
    const rawApprovers = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.approvers));

    const state = {
      offices: LETS_CONFIG.baselineAllocations,
      budgetAdjustments: rawAdjustments,
      setAsides: rawSetAsides,
      approvers: rawApprovers,
      requests: rawRequests
    };

    const result = RequestService.createTravelRequest(formData, state);
    const req = result.request;

    // Append Request to sheet
    const reqSheet = ss.getSheetByName(LETS_CONFIG.sheets.requests);
    reqSheet.appendRow([
      req.requestId,
      req.status,
      req.eventName,
      req.owningOffice,
      req.fundingSource,
      req.setAsideType,
      req.isEventPlanItem ? 'TRUE' : 'FALSE',
      req.is_LC_Travel ? 'TRUE' : 'FALSE',
      req.is_COE_Travel ? 'TRUE' : 'FALSE',
      req.totalEstimatedCost,
      req.totalActualCost,
      req.variance,
      req.budgetCheckStatus,
      req.submitterEmail,
      req.submitterName,
      req.destination,
      req.startDate,
      req.endDate,
      req.createdAt,
      req.updatedAt
    ]);

    // Append Travelers
    const travSheet = ss.getSheetByName(LETS_CONFIG.sheets.travelers);
    (result.travelers || []).forEach(t => {
      travSheet.appendRow([
        t.travelerId,
        t.associatedRequestId,
        t.travelerName || '',
        t.travelerEmail || '',
        t.estAirfare || 0,
        0,
        t.estLodging || 0,
        0,
        t.estMie || 0,
        0,
        t.estOther || 0,
        0,
        t.totalEstimated || 0,
        0,
        0,
        'ESTIMATED'
      ]);
    });

    return {
      success: true,
      requestId: req.requestId,
      status: req.status,
      budgetCheck: result.budgetCheck,
      assignedApprover: result.assignedApprover
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || err.toString()
    };
  }
}

/**
 * Client RPC: Reconciles post-travel actual costs
 */
function apiSaveActuals(requestId, travelersData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const rawRequests = LetsDB.sheetDataToObjects(ss.getSheetByName(LETS_CONFIG.sheets.requests));
    const state = { requests: rawRequests };

    const recResult = RequestService.reconcileRequest(requestId, travelersData, state);
    
    // Update request in Sheet
    const reqSheet = ss.getSheetByName(LETS_CONFIG.sheets.requests);
    const reqValues = reqSheet.getDataRange().getValues();
    for (let i = 1; i < reqValues.length; i++) {
      if (reqValues[i][0] === requestId) {
        reqSheet.getRange(i + 1, 2).setValue(recResult.request.status);
        reqSheet.getRange(i + 1, 10).setValue(recResult.request.totalEstimatedCost);
        reqSheet.getRange(i + 1, 11).setValue(recResult.request.totalActualCost);
        reqSheet.getRange(i + 1, 12).setValue(recResult.request.variance);
        reqSheet.getRange(i + 1, 20).setValue(recResult.request.updatedAt);
        break;
      }
    }

    return {
      success: true,
      request: recResult.request,
      variance: recResult.variance
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || err.toString()
    };
  }
}
