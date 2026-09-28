/**
 * FASTrackerSync.js
 * Integration Service for the official FAS Travel Exception Tracker Google Sheet.
 * Fulfills EO 14222 and the FAS Delegation of Travel-Approving Official Authority.
 *
 * ENVIRONMENT SAFETY
 * ------------------
 * The official FAS Travel Exception Tracker is owned by the FAS front office,
 * not by this project. submitToFASTracker() appends rows containing traveler
 * PII and pre-decisional justifications to it. Appending test data is an
 * uncorrectable write to another organization's system of record.
 *
 * Which spreadsheet this service may touch is therefore decided entirely by the
 * environment gate in 00_config/TripConfig.js (FAS_TRACKER_TARGET). This module
 * never reads FAS_TRACKER_SPREADSHEET_ID directly, so a non-production project
 * cannot reach the official sheet even if that property is set.
 *
 * Controls: SC-7 (boundary protection), AU-3 (audit content), SI-17 (fail-safe),
 * MP-4/SC-28 (data at rest). AGENTS.md §4.1, §12.1, §14.5.
 */

var FASTrackerSync = (function() {
  'use strict';

  var DEFAULT_TRACKER_TAB_NAME = 'FAS Travel Exceptions';

  /**
   * Resolves the environment-gated FAS tracker target.
   *
   * Reads the single resolved target from config rather than a raw property, so
   * the production/development decision is made in exactly one place.
   *
   * @returns {Object} FAS_TRACKER_TARGET-shaped object
   */
  function _getTarget() {
    if (typeof FAS_TRACKER_TARGET !== 'undefined' && FAS_TRACKER_TARGET) {
      return FAS_TRACKER_TARGET;
    }
    // Config did not load. Fail closed rather than guessing a target.
    return {
      environment: 'unknown',
      spreadsheetId: null,
      propertyKey: 'FAS_TRACKER_SPREADSHEET_ID',
      isProduction: false,
      configured: false,
      reason: 'FAS_TRACKER_TARGET is unavailable — 00_config/TripConfig.js did not load.'
    };
  }

  /**
   * Returns the current environment label for logging and audit messages.
   * @returns {string}
   */
  function getEnvironment() {
    return _getTarget().environment;
  }

  /**
   * Reports whether this project has a usable, environment-appropriate tracker.
   * Callers should check this before offering FAS submission in the UI.
   *
   * @returns {{configured: boolean, environment: string, isProduction: boolean, reason: string|null}}
   */
  function getTrackerStatus() {
    var target = _getTarget();
    return {
      configured: target.configured,
      environment: target.environment,
      isProduction: target.isProduction,
      reason: target.reason
    };
  }

  /**
   * Helper to open the environment-appropriate FAS Tracker Spreadsheet.
   *
   * Returns null — never the official sheet — when the current environment has
   * no configured target. There is deliberately no fallback path.
   *
   * @returns {Sheet|null}
   */
  function _getFASTrackerSheet() {
    var target = _getTarget();

    if (!target.configured) {
      console.warn('FASTrackerSync: no FAS Tracker target for environment "' +
        target.environment + '". ' + (target.reason || ''));
      return null;
    }

    try {
      var ss = SpreadsheetApp.openById(target.spreadsheetId);
      var sheet = ss.getSheetByName(DEFAULT_TRACKER_TAB_NAME) || ss.getSheets()[0];
      // Audit which environment and which property selected this target (AU-3).
      // The spreadsheet name is logged; the ID is not, to avoid copying an
      // identifier for a sheet this project does not own into the log stream.
      console.log('FASTrackerSync: resolved target via ' + target.propertyKey +
        ' [env=' + target.environment + '] -> "' + ss.getName() + '" / tab "' + sheet.getName() + '"');
      return sheet;
    } catch (err) {
      console.error('FASTrackerSync: failed to open FAS Tracker spreadsheet from ' +
        target.propertyKey + ' [env=' + target.environment + ']: ' + err.message);
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
   * In a non-production environment this writes to the configured test copy, and
   * the returned message states which environment was used so the audit trail
   * records where the row actually went.
   *
   * @param {Object} request - The LETS request object
   * @returns {Object} { success: boolean, fasRowId: number, environment: string, message: string }
   */
  function submitToFASTracker(request) {
    var target = _getTarget();
    var sheet = _getFASTrackerSheet();
    if (!sheet) {
      return {
        success: false,
        environment: target.environment,
        message: 'FAS Travel Tracker is unavailable for environment "' + target.environment +
          '". Saved in LETS pending manual sync. ' + (target.reason || '')
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

      console.log('FASTrackerSync: appended Request ' + request.requestId +
        ' to FAS Tracker row ' + lastRow + ' [env=' + target.environment + ']');

      return {
        success: true,
        fasRowId: lastRow,
        environment: target.environment,
        status: 'Pending FAS CoS Approval',
        message: target.isProduction
          ? 'Successfully submitted to the FAS Travel Exception Tracker (Row ' + lastRow + ').'
          : 'Submitted to the TEST FAS Travel Exception Tracker copy (Row ' + lastRow +
            '). This did NOT reach the official FAS tracker — environment is "' + target.environment + '".'
      };
    } catch (err) {
      console.error('FASTrackerSync.submitToFASTracker error [env=' + target.environment + ']: ' + err.message);
      return {
        success: false,
        environment: target.environment,
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
      console.error('FASTrackerSync.updateFASTrackerRow error [env=' +
        getEnvironment() + ']: ' + err.message);
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

    console.log('FASTrackerSync: found ' + changes.length +
      ' decided requests in FAS Tracker [env=' + getEnvironment() + '].');
    return { syncedCount: changes.length, changes: changes };
  }

  return {
    getEnvironment: getEnvironment,
    getTrackerStatus: getTrackerStatus,
    isFASTrackerRequired: isFASTrackerRequired,
    submitToFASTracker: submitToFASTracker,
    updateFASTrackerRow: updateFASTrackerRow,
    syncFASTrackerStatus: syncFASTrackerStatus
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FASTrackerSync;
}
