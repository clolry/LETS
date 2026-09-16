/**
 * Errors.js
 * Centralized error logging + standardized response envelope helpers.
 * Merged from the original TravelErrorLogger.js (logError) and the
 * unused-but-canonical successResponse/errorResponse from TravelServerUtils.
 *
 * Per Phase 3 §5, every @client function should:
 *   try { ... return successResponse(data); }
 *   catch (err) { logError(fnName, err, ctx); return errorResponse(...); }
 *
 * Adoption is rolling per-domain during Chunk 10.x.
 */

/**
 * Log an error to the Error_Log sheet. NEVER throws — entire body wrapped
 * in try/catch so it can't break existing error handling. Opens spreadsheet
 * directly (not via TravelDB) to avoid circular dependency if TravelDB
 * itself errors.
 *
 * @param {string} functionName - Name of the function that errored
 * @param {Error|string} error  - The caught error object or message string
 * @param {Object} [context]    - Optional context (requestId, action, etc.)
 * @server
 */
function logError(functionName, error, context) {
  try {
    var userEmail = 'unknown';
    try {
      userEmail = Session.getActiveUser().getEmail() || 'unknown';
    } catch (_) { /* session unavailable (e.g., trigger context) */ }

    var errorMessage = '';
    var stackTrace = '';
    if (error instanceof Error) {
      errorMessage = error.message || String(error);
      stackTrace = error.stack || '';
    } else {
      errorMessage = String(error);
    }

    var contextStr = '';
    if (context) {
      try { contextStr = JSON.stringify(context); } catch (_) { contextStr = String(context); }
    }

    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.ERROR_LOG);

    // Auto-create sheet with headers if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAMES.ERROR_LOG);
      var headers = TRAVEL_SHEET_SCHEMAS.Error_Log;
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#f3f4f6');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      new Date(),       // Timestamp
      userEmail,        // User_Email
      functionName,     // Function_Name
      errorMessage,     // Error_Message
      stackTrace,       // Stack_Trace
      contextStr        // Context
    ]);
  } catch (_) {
    // Silently fail — never break existing error handling
  }
}

/**
 * Create a standardized success response envelope.
 *
 * @param {*} data - Response data payload
 * @param {string} [message] - Optional success message
 * @returns {{success: boolean, data: *, message: string|null}}
 * @server
 */
function successResponse(data, message = null) {
  return { success: true, data: data, message: message };
}

/**
 * Create a standardized error response envelope. Logs to console.error so
 * the error is visible in GAS Stackdriver even before any @client caller
 * catches the returned envelope.
 *
 * @param {string} message - User-friendly error message
 * @param {string} [code='ERROR'] - Error code for programmatic handling
 * @param {*} [details=null] - Additional error details for debugging
 * @returns {{success: boolean, error: string, code: string}}
 * @server
 */
function errorResponse(message, code = 'ERROR', details = null) {
  if (details) {
    console.error(`[${code}] ${message}`, details);
  } else {
    console.error(`[${code}] ${message}`);
  }
  return { success: false, error: message, code: code };
}
