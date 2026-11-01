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
   * The official tracker's column order, transcribed verbatim from the live
   * sheet on 2026-10-31.
   *
   * WHY THIS CONSTANT EXISTS
   * ------------------------
   * The previous implementation wrote 14 values in an order that matched
   * nothing. Its own comments claimed "Col A: LETS Request ID", "Col B:
   * Timestamp", "Col D: Portfolio" — while the real sheet is Timestamp,
   * Portfolio, Email Address, Event Name. Every value would have landed in the
   * wrong column, and 13 columns were never written at all.
   *
   * It was never called, so nothing broke. But submitToFASTracker does a bare
   * appendRow against a LIVE sheet shared across every FAS portfolio, and the
   * FAS front office owns it — a misaligned row is an uncorrectable write to
   * another organization's system of record.
   *
   * Writes are POSITIONAL. Building the row by mapping over this list means a
   * column added to the tracker shifts nothing: the new field is simply blank
   * until someone maps it. Hand-ordering the array is what produced the
   * original defect.
   *
   * Columns the tracker owns and LETS must NOT write are listed here anyway,
   * so the array length always matches the sheet. They are left blank:
   * 'Column 13' (an artefact of the live sheet), and everything from 'Status:'
   * onward, which the FAS front office fills in during their review.
   */
  var FAS_TRACKER_COLUMNS = [
    'Timestamp',
    'Portfolio',
    'Email Address',
    'Event Name',
    'Start date of Travel/Event:',
    'End date of Travel/Event:',
    'Link to Salesforce Request. Leave blank if no Salesforce request has been submitted. ',
    'Select Purpose of Travel (check all that apply)',
    'Justification for Mission Critical Travel Exemption Request\n\nSelect the primary reason when multiple reasons apply.',
    'Number of Travelers:',
    'Estimated Expenses: \nInclude breakdown of lodging, transportation, M&IE, etc.',
    'Has this exception been approved by the portfolio Assistant Commissioner or designated delegate?',
    'Location traveling to:',
    'Location traveling from:',
    'Names of Travelers and Duty Location:',
    'Does this request require international travel?',
    'Is travel requested within the next 10 days?',
    'Type of mission critical travel (Check all that apply)',
    'Duty Station of Travelers',
    'Column 13',
    // --- FAS front office owns everything below. LETS writes blanks. ---
    'Status:',
    'Date Approved:',
    'Approved By:',
    'Notes:',
    'Notified Portfolio?',
    'Notified Individual Date:',
    'Notified By:'
  ];

  /**
   * Columns LETS must never populate.
   *
   * 'Status:' in particular: the previous implementation wrote
   * 'Pending FAS CoS Approval' into whatever column index 12 happened to be.
   * Even correctly aligned, LETS asserting a status in the FAS front office's
   * own decision column would be claiming an approval state it does not own.
   */
  var FAS_TRACKER_READONLY_COLUMNS = [
    'Column 13',
    'Status:',
    'Date Approved:',
    'Approved By:',
    'Notes:',
    'Notified Portfolio?',
    'Notified Individual Date:',
    'Notified By:'
  ];

  /**
   * The portfolio code the tracker expects.
   *
   * The tracker's Portfolio field is PORTFOLIO-level: this whole organisation
   * is 'FC — Office of Acquisition Solutions Development (CREATE)'. The
   * FCA/FCB/FCC codes in HC_Orgs are DIVISIONS within FC and drive internal DAC
   * routing and budget attribution — they are not what the tracker wants.
   *
   * Sending a division code would put a value outside the tracker's own option
   * list into a shared sheet.
   */
  var FAS_PORTFOLIO_CODE = 'FC - Office of Acquisition Solutions Development (CREATE)';

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

    // Refuse to write a row the tracker would reject or that would be
    // misleading once a human reads it. Better to hold the request in LETS for
    // manual submission than to put a half-populated row into a shared sheet.
    var validation = validateForFASTracker(request);
    if (!validation.valid) {
      return {
        success: false,
        environment: target.environment,
        missingFields: validation.missing,
        message: 'Not submitted to the FAS tracker — required fields are missing: ' +
          validation.missing.join('; ') + '. Saved in LETS for manual submission.'
      };
    }

    try {
      var rowData = buildFASTrackerRow(request);

      // Verify the header actually matches what we think we are writing. The
      // tracker is owned by the FAS front office and can change without
      // notice; appending a positionally-built row to a re-ordered sheet is
      // the exact failure this guard exists to prevent.
      var headerCheck = _verifyTrackerHeader(sheet);
      if (!headerCheck.ok) {
        return {
          success: false,
          environment: target.environment,
          message: 'Not submitted — the FAS tracker layout has changed: ' +
            headerCheck.reason + ' Update FAS_TRACKER_COLUMNS in FASTrackerSync.js ' +
            'before submitting. Saved in LETS for manual submission.'
        };
      }

      sheet.appendRow(rowData);
      var lastRow = sheet.getLastRow();

      console.log('FASTrackerSync: appended Request ' + request.requestId +
        ' to FAS Tracker row ' + lastRow + ' [env=' + target.environment + ']');

      return {
        success: true,
        fasRowId: lastRow,
        environment: target.environment,
        // LETS does not assert a status: 'Status:' is the FAS front office's
        // own decision column and is written blank.
        status: 'Submitted — awaiting FAS front office review',
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
   * Builds one tracker row by MAPPING OVER the header list.
   *
   * Never hand-order this array. The previous implementation did, and wrote 14
   * values into a 27-column sheet in an order matching nothing — its comments
   * said "Col D: Portfolio" where the real column D is Event Name.
   *
   * @param {Object} request LETS request, with travelers attached
   * @returns {Array} one row, FAS_TRACKER_COLUMNS.length wide
   */
  function buildFASTrackerRow(request) {
    var values = {};

    values['Timestamp'] = Utilities.formatDate(
      new Date(), 'America/New_York', 'MM/dd/yyyy HH:mm:ss');

    // Portfolio-level, not division. See FAS_PORTFOLIO_CODE.
    values['Portfolio'] = FAS_PORTFOLIO_CODE;

    values['Email Address'] = request.submitterEmail ||
      (function () {
        try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
      })();

    values['Event Name'] = request.eventName || request.tripName || '';
    values['Start date of Travel/Event:'] = request.startDate || request.eventStartDate || '';
    values['End date of Travel/Event:'] = request.endDate || request.eventEndDate || '';
    values['Link to Salesforce Request. Leave blank if no Salesforce request has been submitted. '] =
      request.salesforceLink || request.eventTrackerId || '';

    // Both of these are multi-select on the tracker's form. Newline-joined
    // rather than comma-joined because several option labels contain commas
    // ("Inspection/Acceptance (e.g., vehicles, manufacturing)"), and a
    // comma-joined cell could not be split back apart by anyone reading it.
    values['Select Purpose of Travel (check all that apply)'] =
      _joinMultiSelect(request.travelTypes || request.purposeOfTravel);

    values['Type of mission critical travel (Check all that apply)'] =
      _joinMultiSelect(request.missionCriticalTypes);

    // Single-select on the tracker: the ONE primary reason.
    values['Justification for Mission Critical Travel Exemption Request\n\nSelect the primary reason when multiple reasons apply.'] =
      request.primaryJustification || '';

    var travelers = request.travelers || [];
    values['Number of Travelers:'] = travelers.length || Number(request.travelerCount) || 0;

    // The tracker asks for a BREAKDOWN, not a single figure. A bare total
    // would be a non-answer to a required question and would come back to the
    // submitter as a query.
    values['Estimated Expenses: \nInclude breakdown of lodging, transportation, M&IE, etc.'] =
      _formatExpenseBreakdown(request);

    // "Has this exception been approved by the portfolio AC or delegate?"
    // LETS knows this from its own approval chain, so it is answered from
    // recorded state rather than asked again. Defaults to 'No' — claiming an
    // approval that has not happened is the worse error.
    values['Has this exception been approved by the portfolio Assistant Commissioner or designated delegate?'] =
      request.acApproved === true ? 'Yes' : 'No';

    values['Location traveling to:'] = _formatDestinations(request);
    values['Location traveling from:'] = _formatOrigins(request);

    // Required free-text pairing each name with a duty location.
    values['Names of Travelers and Duty Location:'] = travelers.map(function (t) {
      var name = t.employeeName || t.name || '';
      var duty = t.dutyLocation || _joinCityState(t.dutyStationCity, t.dutyStationState) || '';
      return duty ? (name + ' (' + duty + ')') : name;
    }).filter(Boolean).join('\n');

    // Distinct duty stations, which the tracker tracks separately from the
    // name/duty pairing above.
    values['Duty Station of Travelers'] = _distinct(travelers.map(function (t) {
      return t.dutyLocation || _joinCityState(t.dutyStationCity, t.dutyStationState);
    }).filter(Boolean)).join('; ');

    values['Does this request require international travel?'] =
      (request.isInternational === true || request.isOCONUS === true) ? 'Yes' : 'No';

    // Ten-day lead time is computed, not asked. It is the tracker's own
    // submission deadline and a submitter answering it by hand would be
    // guessing at a date comparison.
    values['Is travel requested within the next 10 days?'] = _isWithinTenDays(request) ? 'Yes' : 'No';

    return FAS_TRACKER_COLUMNS.map(function (col) {
      // Front-office-owned columns stay blank regardless of what is in values.
      if (FAS_TRACKER_READONLY_COLUMNS.indexOf(col) !== -1) return '';
      return values.hasOwnProperty(col) ? values[col] : '';
    });
  }

  /**
   * Checks every tracker-required field LETS is responsible for.
   *
   * The tracker marks 13 fields required. Three of them could not be supplied
   * by the previous implementation at all — the traveler/duty-location
   * pairing, the expense breakdown, and the AC-approval answer — so a
   * submission would have been rejected or returned for clarification.
   *
   * @returns {{valid: boolean, missing: Array<string>}}
   */
  function validateForFASTracker(request) {
    var missing = [];
    var travelers = (request && request.travelers) || [];

    if (!request) return { valid: false, missing: ['request object'] };
    if (!(request.eventName || request.tripName)) missing.push('Event Name');
    if (!(request.startDate || request.eventStartDate)) missing.push('Start date of Travel/Event');
    if (!(request.endDate || request.eventEndDate)) missing.push('End date of Travel/Event');
    if (!travelers.length) missing.push('at least one traveler');

    if (!_joinMultiSelect(request.travelTypes || request.purposeOfTravel)) {
      missing.push('Select Purpose of Travel (at least one)');
    }
    if (!_joinMultiSelect(request.missionCriticalTypes)) {
      missing.push('Type of mission critical travel (at least one)');
    }
    if (!request.primaryJustification) {
      missing.push('Justification for Mission Critical Travel Exemption Request (primary reason)');
    }
    if (!_formatDestinations(request)) missing.push('Location traveling to');
    if (!_formatOrigins(request)) missing.push('Location traveling from');

    // Every traveler needs a duty location, not just some: the field is a
    // name-and-duty-location pairing and a partial list reads as an error.
    var missingDuty = travelers.filter(function (t) {
      return !(t.dutyLocation || _joinCityState(t.dutyStationCity, t.dutyStationState));
    });
    if (missingDuty.length) {
      missing.push('duty location for ' + missingDuty.length + ' traveler(s)');
    }

    if (!_formatExpenseBreakdown(request)) {
      missing.push('Estimated Expenses breakdown');
    }

    return { valid: missing.length === 0, missing: missing };
  }

  /**
   * Confirms the live sheet's header still matches FAS_TRACKER_COLUMNS.
   *
   * Compares only the columns LETS writes. Trailing front-office columns are
   * ignored: they are allowed to be renamed or added to without blocking a
   * submission, because LETS writes blanks there.
   */
  function _verifyTrackerHeader(sheet) {
    try {
      var lastCol = sheet.getLastColumn();
      if (lastCol < 1) return { ok: false, reason: 'the sheet has no header row.' };

      var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
        .map(function (h) { return String(h || '').trim(); });

      var writable = FAS_TRACKER_COLUMNS.filter(function (c) {
        return FAS_TRACKER_READONLY_COLUMNS.indexOf(c) === -1;
      });

      for (var i = 0; i < writable.length; i++) {
        var expected = writable[i].trim();
        var actual = (header[i] || '').trim();
        // Compare on a normalized form: the live header contains newlines and
        // trailing spaces that are invisible and easy to lose in transcription.
        if (_normalizeHeader(actual) !== _normalizeHeader(expected)) {
          return {
            ok: false,
            reason: 'column ' + (i + 1) + ' is "' + actual + '", expected "' + expected + '".'
          };
        }
      }
      return { ok: true };
    } catch (e) {
      // Cannot verify -> do not write. Failing closed is correct for someone
      // else's system of record.
      return { ok: false, reason: 'could not read the header row (' + e.message + ').' };
    }
  }

  function _normalizeHeader(h) {
    return String(h || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** Newline-joins a multi-select value given as an array, JSON string, or string. */
  function _joinMultiSelect(value) {
    if (!value) return '';
    var arr = value;
    if (typeof value === 'string') {
      var trimmed = value.trim();
      if (!trimmed) return '';
      // Submission.js stores these as JSON strings.
      if (trimmed.charAt(0) === '[') {
        try { arr = JSON.parse(trimmed); } catch (e) { return trimmed; }
      } else {
        return trimmed;
      }
    }
    if (!Array.isArray(arr)) return String(arr);
    return arr.map(function (x) { return String(x || '').trim(); })
              .filter(Boolean).join('\n');
  }

  /**
   * The expense breakdown the tracker explicitly asks for.
   *
   * Returns '' when there is nothing to report, so validateForFASTracker can
   * treat a missing breakdown as a missing required field rather than writing
   * "$0.00" into a shared sheet.
   */
  function _formatExpenseBreakdown(request) {
    var travelers = (request && request.travelers) || [];
    if (!travelers.length && !request.sharedTotal) return '';

    var sum = function (field) {
      return travelers.reduce(function (acc, t) {
        return acc + (Number(t[field]) || 0);
      }, 0);
    };

    var transport = sum('transportationTotal');
    var lodging = sum('lodgingTotal');
    var mie = sum('mieTotal');
    var local = sum('localTravelTotal');
    var other = sum('otherTotal');
    var shared = Number(request.sharedTotal) || 0;
    var grand = Number(request.grandTotal) ||
                (transport + lodging + mie + local + other + shared);

    if (!grand) return '';

    var money = function (n) { return '$' + (Number(n) || 0).toFixed(2); };
    var parts = [];
    if (transport) parts.push('Transportation: ' + money(transport));
    if (lodging) parts.push('Lodging: ' + money(lodging));
    if (mie) parts.push('M&IE: ' + money(mie));
    if (local) parts.push('Local travel: ' + money(local));
    if (other) parts.push('Other: ' + money(other));
    if (shared) parts.push('Shared event costs: ' + money(shared));
    parts.push('TOTAL: ' + money(grand));
    if (travelers.length) {
      parts.push('(' + travelers.length + ' traveler' +
                 (travelers.length === 1 ? '' : 's') + ')');
    }
    return parts.join('\n');
  }

  /** Distinct leg destinations, in itinerary order. */
  function _formatDestinations(request) {
    var legs = (request && request.legs) || [];
    var fromLegs = _distinct(legs.map(function (l) {
      return _joinCityState(l.city, l.state, l.country);
    }).filter(Boolean));
    if (fromLegs.length) return fromLegs.join('; ');
    return request.destination || '';
  }

  /** Distinct traveler duty stations — where the travel departs FROM. */
  function _formatOrigins(request) {
    var travelers = (request && request.travelers) || [];
    var origins = _distinct(travelers.map(function (t) {
      return _joinCityState(t.dutyStationCity, t.dutyStationState) || t.dutyLocation;
    }).filter(Boolean));
    if (origins.length) return origins.join('; ');
    return request.origin || '';
  }

  function _joinCityState(city, state, country) {
    var c = String(city || '').trim();
    var s = String(state || '').trim();
    var k = String(country || '').trim();
    if (!c) return '';
    if (s) return c + ', ' + s;
    if (k && k !== 'United States') return c + ', ' + k;
    return c;
  }

  function _distinct(list) {
    var seen = {};
    return (list || []).filter(function (x) {
      var key = String(x).toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  /**
   * Whether travel starts within 10 calendar days.
   *
   * The tracker asks this because its own policy requires submission at least
   * ten days ahead. Computed rather than asked: a submitter answering by hand
   * is guessing at a date comparison, and the answer changes with time.
   */
  function _isWithinTenDays(request) {
    var raw = request.startDate || request.eventStartDate;
    if (!raw) return false;
    var start = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(start.getTime())) return false;
    var days = (start.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days <= 10;
  }

  /**
   * Reads the resolved tracker's header row and diffs it against
   * FAS_TRACKER_COLUMNS.
   *
   * WHY A PROGRAMMATIC COMPARISON
   * -----------------------------
   * FAS_TRACKER_COLUMNS was transcribed from a paste; nobody on this side has
   * opened the live sheet. The live header contains embedded newlines
   * ("...Exemption Request\n\nSelect the primary reason...") and at least one
   * trailing space — differences that are invisible in a log and that a human
   * comparing two lists will not reliably catch.
   *
   * Reports BOTH the normalized comparison (which is what _verifyTrackerHeader
   * actually enforces) and the exact characters, so a mismatch can be
   * diagnosed rather than merely detected.
   *
   * Read-only.
   *
   * @returns {Object} { success, environment, isProduction, sheetName,
   *                     headerCount, expectedCount, matches, differences[] }
   */
  function compareTrackerHeader() {
    var target = _getTarget();
    var sheet = _getFASTrackerSheet();
    if (!sheet) {
      return {
        success: false,
        environment: target.environment,
        isProduction: target.isProduction,
        message: 'No FAS tracker target for environment "' + target.environment +
          '". ' + (target.reason || '')
      };
    }

    try {
      var lastCol = sheet.getLastColumn();
      var header = lastCol > 0
        ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h === null || h === undefined ? '' : h); })
        : [];

      var differences = [];
      var maxLen = Math.max(header.length, FAS_TRACKER_COLUMNS.length);
      for (var i = 0; i < maxLen; i++) {
        var expected = FAS_TRACKER_COLUMNS[i];
        var actual = header[i];
        if (expected === undefined) {
          differences.push({
            index: i, column: _columnLetterFas_(i + 1),
            issue: 'extra column in the sheet', expected: null, actual: actual
          });
          continue;
        }
        if (actual === undefined) {
          differences.push({
            index: i, column: _columnLetterFas_(i + 1),
            issue: 'column missing from the sheet', expected: expected, actual: null
          });
          continue;
        }
        if (_normalizeHeader(actual) !== _normalizeHeader(expected)) {
          differences.push({
            index: i, column: _columnLetterFas_(i + 1),
            issue: 'name differs', expected: expected, actual: actual
          });
        } else if (actual !== expected) {
          // Normalized match but not byte-identical. Harmless — this is what
          // _verifyTrackerHeader tolerates — but worth surfacing so the
          // transcription can be corrected rather than left slightly wrong.
          differences.push({
            index: i, column: _columnLetterFas_(i + 1),
            issue: 'whitespace only (tolerated)', expected: expected, actual: actual
          });
        }
      }

      var blocking = differences.filter(function (d) {
        return d.issue !== 'whitespace only (tolerated)' &&
               d.issue !== 'extra column in the sheet';
      });

      return {
        success: true,
        environment: target.environment,
        isProduction: target.isProduction,
        sheetName: sheet.getParent().getName() + ' / ' + sheet.getName(),
        headerCount: header.length,
        expectedCount: FAS_TRACKER_COLUMNS.length,
        header: header,
        differences: differences,
        // `matches` means a submission would be ALLOWED, not that the
        // transcription is byte-perfect.
        matches: blocking.length === 0
      };
    } catch (err) {
      return {
        success: false,
        environment: target.environment,
        isProduction: target.isProduction,
        message: 'Could not read the tracker header: ' + err.message
      };
    }
  }

  /** 1 -> A, 27 -> AA. Local copy so this module has no external dependency. */
  function _columnLetterFas_(n) {
    var out = '';
    while (n > 0) {
      var rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
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
    syncFASTrackerStatus: syncFASTrackerStatus,

    // Exposed so a submission can be checked BEFORE it is offered in the UI,
    // and so the row can be inspected without writing to a shared sheet.
    validateForFASTracker: validateForFASTracker,
    buildFASTrackerRow: buildFASTrackerRow,

    // Reads row 1 of the resolved target and compares it against
    // FAS_TRACKER_COLUMNS. Exposed because the column list was transcribed by
    // hand from a paste, and comparing it against a real header by eye is
    // exactly the kind of check people get wrong — the live header contains
    // embedded newlines and trailing spaces that are invisible in a log.
    compareTrackerHeader: compareTrackerHeader,
    FAS_TRACKER_COLUMNS: FAS_TRACKER_COLUMNS,
    FAS_TRACKER_READONLY_COLUMNS: FAS_TRACKER_READONLY_COLUMNS,
    FAS_PORTFOLIO_CODE: FAS_PORTFOLIO_CODE
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FASTrackerSync;
}
