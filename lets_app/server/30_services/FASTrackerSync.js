/**
 * FASTrackerSync.js
 * Integration Service for the official FAS Travel Exception Tracker Google Sheet.
 * Fulfills EO 14222 and the FAS Delegation of Travel-Approving Official Authority.
 */

var FASTrackerSync = (function() {
  'use strict';

  var DEFAULT_TRACKER_TAB_NAME = 'FAS Travel Exceptions';

  /**
   * Helper to open the external FAS Tracker Spreadsheet
   */
  function _getFASTrackerSheet() {
    var ssId = FAS_TRACKER_SPREADSHEET_ID;
    if (!ssId) {
      console.warn('FASTrackerSync: FAS_TRACKER_SPREADSHEET_ID property is not configured.');
      return null;
    }
    try {
      var ss = SpreadsheetApp.openById(ssId);
      var sheet = ss.getSheetByName(DEFAULT_TRACKER_TAB_NAME) || ss.getSheets()[0];
      return sheet;
    } catch (err) {
      console.error('FASTrackerSync: Failed to open FAS Tracker spreadsheet: ' + err.message);
      return null;
    }
  }

  /**
   * Checks if a travel purpose requires FAS Chief of Staff approval via the FAS Tracker
   * @param {string} purposeCode
   * @returns {boolean}
   */
  function isFASTrackerRequired(purposeCode) {
    if (!purposeCode) return false;
    var tier1List = TRAVEL_PURPOSES.TIER_1_FAS_COS;
    for (var i = 0; i < tier1List.length; i++) {
      if (tier1List[i].code === purposeCode) {
        return true;
      }
    }
    return false;
  }

  /**
   * Submits a new row to the FAS Travel Exception Tracker Google Sheet.
   * Called when a request has a Tier 1 Purpose of Travel and has passed internal budget check.
   *
   * @param {Object} request - The LETS request object
   * @returns {Object} { success: boolean, fasRowId: number, message: string }
   */
  function submitToFASTracker(request) {
    var sheet = _getFASTrackerSheet();
    if (!sheet) {
      return {
        success: false,
        message: 'FAS Travel Tracker sheet is unavailable or not configured. Saved in LETS pending manual sync.'
      };
    }

    try {
      var timestamp = new Date();
      var rowData = [
        request.requestId,                         // Col A: LETS Request ID
        Utilities.formatDate(timestamp, 'America/New_York', 'MM/dd/yyyy HH:mm:ss'), // Col B: Timestamp
        request.submitterName || request.requesterName || '', // Col C: Requester Name
        request.owningOffice || '',                // Col D: Portfolio / Owning Office
        request.travelPurposeLabel || request.purpose || '', // Col E: Purpose of Travel
        request.eventName || request.tripName || '', // Col F: Event / Trip Title
        request.destination || '',                 // Col G: Destination
        request.startDate || '',                   // Col H: Start Date
        request.endDate || '',                     // Col I: End Date
        Number(request.totalEstimatedCost) || 0,   // Col J: Estimated Cost ($)
        request.roleJustification || request.justification || '', // Col K: Brief Written Justification
        request.eventTrackerId || '',              // Col L: Salesforce Event Tracker ID
        'Pending FAS CoS Approval',               // Col M: Official Approval Status
        Session.getActiveUser().getEmail() || ''   // Col N: Submitter Email
      ];

      sheet.appendRow(rowData);
      var lastRow = sheet.getLastRow();

      console.log('FASTrackerSync: Appended Request ' + request.requestId + ' to FAS Tracker at row ' + lastRow);

      return {
        success: true,
        fasRowId: lastRow,
        status: 'Pending FAS CoS Approval',
        message: 'Successfully submitted to the FAS Travel Exception Tracker (Row ' + lastRow + ').'
      };
    } catch (err) {
      console.error('FASTrackerSync.submitToFASTracker error: ' + err.message);
      return {
        success: false,
        message: 'Error submitting to FAS Tracker: ' + err.message
      };
    }
  }

  /**
   * Updates an existing row in the FAS Travel Exception Tracker
   * (e.g. to link Salesforce Event Tracker ID or adjust estimated costs)
   *
   * @param {number} fasRowId - The 1-indexed row number in the FAS sheet
   * @param {Object} updates - Fields to update: { eventTrackerId, estimatedCost, notes }
   */
  function updateFASTrackerRow(fasRowId, updates) {
    if (!fasRowId || fasRowId <= 1) return false;
    var sheet = _getFASTrackerSheet();
    if (!sheet) return false;

    try {
      if (updates.eventTrackerId !== undefined) {
        sheet.getRange(fasRowId, 12).setValue(updates.eventTrackerId); // Col L
      }
      if (updates.estimatedCost !== undefined) {
        sheet.getRange(fasRowId, 10).setValue(updates.estimatedCost);  // Col J
      }
      return true;
    } catch (err) {
      console.error('FASTrackerSync.updateFASTrackerRow error: ' + err.message);
      return false;
    }
  }

  /**
   * Time-Driven Sync Function: Monitors the FAS Travel Exception Tracker for status changes.
   * Scans rows for status updates made by the FAS Front Office (e.g. from 'Pending' to 'Approved').
   * Can be triggered on a ~15 minute schedule or manually on demand.
   *
   * @returns {Object} { syncedCount: number, changes: Array }
   */
  function syncFASTrackerStatus() {
    var sheet = _getFASTrackerSheet();
    if (!sheet) return { syncedCount: 0, changes: [] };

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { syncedCount: 0, changes: [] };

    // Read Col A (LETS Request ID) through Col M (Approval Status)
    var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
    var changes = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var requestId = String(row[0] || '').trim();
      var fasStatus = String(row[12] || '').trim();

      if (!requestId || !fasStatus) continue;

      // Check if status is Approved or Rejected
      var normalizedStatus = fasStatus.toLowerCase();
      if (normalizedStatus.indexOf('approved') !== -1 || normalizedStatus.indexOf('rejected') !== -1) {
        changes.push({
          requestId: requestId,
          fasRowIndex: i + 2,
          fasStatus: fasStatus,
          isApproved: normalizedStatus.indexOf('approved') !== -1
        });
      }
    }

    console.log('FASTrackerSync: Found ' + changes.length + ' decided requests in FAS Tracker.');
    return { syncedCount: changes.length, changes: changes };
  }

  return {
    isFASTrackerRequired: isFASTrackerRequired,
    submitToFASTracker: submitToFASTracker,
    updateFASTrackerRow: updateFASTrackerRow,
    syncFASTrackerStatus: syncFASTrackerStatus
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FASTrackerSync;
}
