/**
 * FASTrackerTest.js
 * Writes a single clearly-marked diagnostic row to the TEST FAS tracker copy.
 *
 * WHY THIS IS NOT IN Diagnostics.js
 * ---------------------------------
 * It WRITES. Diagnostics.js is run by hand against live environments and a CI
 * guard enforces that it contains no mutating Apps Script call — that guard is
 * correct and this function would violate it.
 *
 * WHY IT EXISTS AT ALL
 * --------------------
 * submitToFASTracker has never run. The column mapping was reconstructed from
 * a transcription of the live header, and diagFasTrackerRow() plus
 * diagFasTrackerHeader() can only prove that LETS's idea of the sheet matches
 * the sheet's header row. Neither proves that an append actually lands in the
 * columns we think it does.
 *
 * @clolry confirmed TEST_FAS_TRACKER_SPREADSHEET_ID points at a real copy of
 * the live sheet, which makes an end-to-end check safe. Doing it on a copy is
 * the entire point: a misaligned append to the official tracker is an
 * uncorrectable write to another organization's system of record.
 *
 * THREE INDEPENDENT REFUSALS
 * --------------------------
 * 1. resolveFASTrackerTarget (TripConfig.js) already refuses to resolve the
 *    production sheet outside production, and refuses outright if the test ID
 *    equals the production ID.
 * 2. This function additionally refuses when target.isProduction is true, so
 *    running it in the production project does nothing regardless of how the
 *    properties are set.
 * 3. The row it writes is self-identifying — the Event Name begins with
 *    "LETS DIAGNOSTIC" — so anyone reading the sheet can see it is not a real
 *    request, and deleteFASTrackerTestRows() can find and remove them.
 *
 * Belt and braces on purpose. One of these checks failing silently should not
 * be enough to touch the official tracker.
 */

/** Marks every row this file writes, so they can be identified and removed. */
var FAS_TEST_ROW_MARKER = 'LETS DIAGNOSTIC — DO NOT ACTION';

/**
 * Appends one diagnostic row to the TEST tracker copy.
 *
 * Run from the editor, read the log, then open the test sheet and confirm each
 * value sits under the right header. That visual confirmation is the actual
 * deliverable; this function just makes it possible.
 *
 * REFUSES to run against production.
 *
 * @returns {Object} { success, environment, row, rowNumber, message }
 * @editor
 */
function submitFASTrackerTestRow() {
  console.log('=== FAS TRACKER TEST SUBMISSION ===');
  try {
    if (typeof FASTrackerSync === 'undefined') {
      console.log('FASTrackerSync is unavailable.');
      return { success: false, message: 'FASTrackerSync unavailable' };
    }

    var status = FASTrackerSync.getTrackerStatus
      ? FASTrackerSync.getTrackerStatus()
      : { environment: FASTrackerSync.getEnvironment() };

    console.log('Environment: ' + status.environment);

    // Refusal 2. The config gate already prevents a non-production project
    // from resolving the official sheet; this stops the inverse — running the
    // diagnostic inside production, where the resolved target IS official.
    if (status.isProduction === true ||
        (typeof LETS_IS_PRODUCTION !== 'undefined' && LETS_IS_PRODUCTION)) {
      var refusal = 'REFUSED: this is the production environment. ' +
        'This function writes to whichever tracker the environment resolves, ' +
        'and in production that is the OFFICIAL FAS sheet. Run it in sandbox.';
      console.log(refusal);
      return { success: false, environment: status.environment, message: refusal };
    }

    // Header first. An append to a sheet whose layout has moved is the exact
    // corruption this whole exercise exists to prevent, and it is worth
    // checking even against a copy — a copy with a stale layout would give a
    // false pass.
    if (FASTrackerSync.compareTrackerHeader) {
      var cmp = FASTrackerSync.compareTrackerHeader();
      if (!cmp.success) {
        console.log('Could not read the tracker header: ' + cmp.message);
        return { success: false, environment: status.environment, message: cmp.message };
      }
      console.log('Target: ' + cmp.sheetName);
      if (!cmp.matches) {
        console.log('REFUSED: the header does not match FAS_TRACKER_COLUMNS.');
        console.log('Run diagFasTrackerHeader() for the column-by-column diff.');
        return {
          success: false,
          environment: status.environment,
          message: 'Header mismatch — run diagFasTrackerHeader() for details.'
        };
      }
      console.log('Header matches FAS_TRACKER_COLUMNS.');
    }

    // Deliberately a two-org, two-traveler request: that is the case the
    // single-office form could not represent, and the one whose expense
    // breakdown and traveler/duty pairing are most likely to reveal a
    // mapping error.
    var sample = {
      requestId: 'LETS-DIAG-' + Date.now(),
      eventName: FAS_TEST_ROW_MARKER + ' — mapping verification',
      startDate: _fasTestDate_(45),
      endDate: _fasTestDate_(47),
      submitterEmail: _fasTestActor_(),
      salesforceLink: '',
      travelTypes: [
        'Customer Meeting',
        'Site Visits, Inspections, Acceptance, Delivery'
      ],
      missionCriticalTypes: [
        'Industry/Customer Engagement Supporting Acquisition',
        'Inspection/Acceptance (e.g., vehicles, manufacturing)'
      ],
      primaryJustification:
        'Customer, vendor, or stakeholder engagement with defined outcome',
      isInternational: false,
      isOCONUS: false,
      sharedTotal: 500,
      grandTotal: 3224,
      acApproved: false,
      legs: [{ city: 'CHICAGO', state: 'IL', country: 'United States' }],
      travelers: [
        {
          employeeName: 'DIAGNOSTIC Traveler A', orgCode: 'FCA',
          dutyStationCity: 'WASHINGTON', dutyStationState: 'DC',
          transportationTotal: 224, lodgingTotal: 900, mieTotal: 300,
          localTravelTotal: 0, otherTotal: 430
        },
        {
          employeeName: 'DIAGNOSTIC Traveler B', orgCode: 'FCB',
          dutyStationCity: 'PHILADELPHIA', dutyStationState: 'PA',
          transportationTotal: 180, lodgingTotal: 600, mieTotal: 200,
          localTravelTotal: 0, otherTotal: 290
        }
      ]
    };

    var check = FASTrackerSync.validateForFASTracker(sample);
    if (!check.valid) {
      console.log('REFUSED: the sample request is itself incomplete: ' +
        check.missing.join('; '));
      return {
        success: false,
        environment: status.environment,
        message: 'Sample request incomplete: ' + check.missing.join('; ')
      };
    }

    var result = FASTrackerSync.submitToFASTracker(sample);
    console.log('');
    console.log('submitToFASTracker: ' + (result.success ? 'SUCCESS' : 'FAILED'));
    console.log('  ' + result.message);
    if (result.fasRowId) {
      console.log('  row: ' + result.fasRowId);
      console.log('');
      console.log('NOW OPEN THE TEST SHEET and confirm row ' + result.fasRowId +
        ' has each value under the correct header.');
      console.log('That visual check is the point of this function — the code');
      console.log('can only verify its own assumptions.');
      console.log('');
      console.log('When finished: deleteFASTrackerTestRows() removes every row');
      console.log('marked "' + FAS_TEST_ROW_MARKER + '".');
    }

    return {
      success: result.success,
      environment: status.environment,
      rowNumber: result.fasRowId || null,
      message: result.message
    };

  } catch (error) {
    console.error('submitFASTrackerTestRow failed: ' + error.message);
    return { success: false, message: error.message };
  }
}

/**
 * Deletes every row whose Event Name carries FAS_TEST_ROW_MARKER.
 *
 * Matches on the MARKER, not on a row number: a row number goes stale the
 * moment anyone else appends, and deleting by stale index on a shared sheet
 * would remove someone's real request.
 *
 * Deletes bottom-up, because deleting a row shifts every row beneath it.
 *
 * REFUSES to run against production.
 *
 * @returns {Object} { success, environment, deleted, message }
 * @editor
 */
function deleteFASTrackerTestRows() {
  console.log('=== REMOVE FAS TRACKER TEST ROWS ===');
  try {
    if (typeof FASTrackerSync === 'undefined') {
      return { success: false, message: 'FASTrackerSync unavailable' };
    }

    var status = FASTrackerSync.getTrackerStatus
      ? FASTrackerSync.getTrackerStatus()
      : { environment: FASTrackerSync.getEnvironment() };

    console.log('Environment: ' + status.environment);
    if (status.isProduction === true ||
        (typeof LETS_IS_PRODUCTION !== 'undefined' && LETS_IS_PRODUCTION)) {
      var refusal = 'REFUSED: this is production. Never delete rows from the ' +
        'official FAS tracker — the front office owns it.';
      console.log(refusal);
      return { success: false, environment: status.environment, message: refusal };
    }

    var cmp = FASTrackerSync.compareTrackerHeader();
    if (!cmp.success) {
      console.log('Could not read the tracker: ' + cmp.message);
      return { success: false, environment: status.environment, message: cmp.message };
    }

    var ss = SpreadsheetApp.openById(
      (typeof FAS_TRACKER_TARGET !== 'undefined' && FAS_TRACKER_TARGET)
        ? FAS_TRACKER_TARGET.spreadsheetId : null);
    var sheet = ss.getSheetByName('FAS Travel Exceptions') || ss.getSheets()[0];

    var eventNameIdx = FASTrackerSync.FAS_TRACKER_COLUMNS.indexOf('Event Name');
    if (eventNameIdx === -1) {
      return { success: false, message: 'Event Name column not found in FAS_TRACKER_COLUMNS.' };
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      console.log('Nothing to delete.');
      return { success: true, environment: status.environment, deleted: 0 };
    }

    var values = sheet.getRange(2, eventNameIdx + 1, lastRow - 1, 1).getValues();
    var toDelete = [];
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').indexOf(FAS_TEST_ROW_MARKER) !== -1) {
        toDelete.push(i + 2);
      }
    }

    // Bottom-up: deleting a row shifts everything below it.
    for (var d = toDelete.length - 1; d >= 0; d--) {
      sheet.deleteRow(toDelete[d]);
    }
    SpreadsheetApp.flush();

    console.log('Deleted ' + toDelete.length + ' diagnostic row(s).');
    return {
      success: true,
      environment: status.environment,
      deleted: toDelete.length,
      message: 'Deleted ' + toDelete.length + ' row(s) marked "' + FAS_TEST_ROW_MARKER + '".'
    };

  } catch (error) {
    console.error('deleteFASTrackerTestRows failed: ' + error.message);
    return { success: false, message: error.message };
  }
}

/** ISO date N days out, for a sample that is never within the 10-day window. */
function _fasTestDate_(daysOut) {
  var d = new Date(Date.now() + daysOut * 24 * 60 * 60 * 1000);
  var m = String(d.getMonth() + 1);
  var day = String(d.getDate());
  return d.getFullYear() + '-' +
    (m.length === 1 ? '0' + m : m) + '-' +
    (day.length === 1 ? '0' + day : day);
}

function _fasTestActor_() {
  try {
    return Session.getActiveUser().getEmail() || 'unknown';
  } catch (e) {
    return 'unknown';
  }
}
