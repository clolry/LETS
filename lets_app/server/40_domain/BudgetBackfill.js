/**
 * BudgetBackfill.js
 * Entering travel that already happened, or is already planned.
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * @clolry: "Our fiscal year began October 1st so we have some travel (not a
 * ton, but some) that is planned or already occurred and I want to get it
 * reported in the system so that we can ensure proper budgeting and
 * reconciliation. Can you please create a way that I can input the existing
 * travel?"
 *
 * The normal intake form cannot do this. Submitting a trip through it starts
 * the approval workflow: it emails the sector director, routes to a BU
 * reviewer, and creates a pending item on somebody's dashboard. For a trip
 * that happened in October, every one of those is wrong — a reviewer being
 * asked to approve completed travel will reasonably assume the system is
 * broken.
 *
 * So this is a separate path with a different shape:
 *
 *   intake form              backfill
 *   -----------              --------
 *   status PENDING_SECTOR    COMPLETED or APPROVED_GOGOV
 *   emails the reviewer      sends nothing
 *   routes for approval      routes nowhere
 *   full cost breakdown      a total, because that is what exists
 *   any user                 ADMIN ONLY
 *
 * WHY ADMIN ONLY
 * --------------
 * This writes a request that is APPROVED without anyone having approved it,
 * and the figure counts against a DAC's balance immediately. That is a
 * reasonable thing for an administrator reconciling a fiscal year to do, and
 * not something to leave open — a user who could backfill their own completed
 * travel could consume budget without review.
 *
 * Reading budget figures is deliberately open to everyone (@clolry: "no
 * secrets to hide there - we're trying to develop transparency"). Writing a
 * request that spends money is not the same act.
 *
 * EVERY ROW IS MARKED
 * -------------------
 * Backfilled requests carry Primary_Justification prefixed 'BACKFILL:' and an
 * Approval_Log entry naming the administrator. A figure that entered the
 * budget without passing through review must be identifiable afterward, or
 * the audit trail quietly implies an approval that never happened.
 */

var BudgetBackfill = (function () {

  function round2(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
  }

  function _str_(v) {
    return (v === null || v === undefined) ? '' : String(v).trim();
  }

  /** YYYY-MM-DD, or '' when unparseable. */
  function _dateOnly_(v) {
    if (!v) return '';
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  /**
   * Status for a backfilled trip, from its dates.
   *
   * THIS CHOICE DRIVES THE BUDGET ARITHMETIC, so it is derived rather than
   * asked for. BudgetDashboard counts COMPLETED as actual spend and
   * APPROVED_GOGOV as a commitment; letting the user pick would let the same
   * trip land in either bucket depending on which they chose.
   *
   * A trip whose end date has passed is COMPLETED. One still ahead is
   * APPROVED_GOGOV — approved and booked, not yet traveled, which is exactly
   * what @clolry's "planned" travel is.
   *
   * @param {string} endDate YYYY-MM-DD
   * @param {Date} [now]
   * @returns {string}
   */
  function statusFor(endDate, now) {
    var today = _dateOnly_(now || new Date());
    if (!endDate) return STATUS_CODES.APPROVED_GOGOV;
    return endDate < today ? STATUS_CODES.COMPLETED : STATUS_CODES.APPROVED_GOGOV;
  }

  /**
   * Fiscal year for a date. October through September.
   *
   * @clolry: "Our fiscal year began October 1st." A trip on 2 October 2026 is
   * FY2027 money, and getting it wrong by one day attributes the spend to the
   * wrong year's budget.
   */
  function fiscalYearOf(dateStr) {
    var d = new Date(String(dateStr) + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    return 'FY' + (d.getMonth() >= 9 ? y + 1 : y);
  }

  /** Budget key for an HR org code, by longest prefix. */
  function officeForOrgCode(orgCode) {
    var ORG_TO_OFFICE = { FC: 'FO', FCA: 'OMD', FCB: 'IDV', FCC: 'CM' };
    var code = _str_(orgCode).toUpperCase();
    if (!code) return '';
    var best = '';
    var bestLen = 0;
    Object.keys(ORG_TO_OFFICE).forEach(function (k) {
      if (code.indexOf(k) !== 0) return;
      if (k.length <= bestLen) return;
      best = ORG_TO_OFFICE[k];
      bestLen = k.length;
    });
    return best;
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Checks one backfill entry.
   *
   * Returns problems rather than throwing, so the UI shows all of them at
   * once rather than one per round trip.
   *
   * @param {Object} entry
   * @param {Object} [options] { now, existingTripNames }
   * @returns {Array<string>}
   */
  function validateEntry(entry, options) {
    options = options || {};
    var problems = [];
    var e = entry || {};

    if (!_str_(e.tripName)) {
      problems.push('Trip or event name is required — it is how this appears in ' +
                    'reports and how event history groups occurrences.');
    }

    var start = _dateOnly_(e.startDate);
    var end = _dateOnly_(e.endDate);

    if (!start) {
      problems.push('Start date is required and must be a real date.');
    }
    if (!end) {
      problems.push('End date is required and must be a real date.');
    }
    if (start && end && end < start) {
      problems.push('End date ' + end + ' is before the start date ' + start + '.');
    }

    // A backfill is for travel in THIS fiscal year. A date outside it is
    // almost always a typo in the year, and it would attribute the spend to a
    // budget that is already closed.
    if (start) {
      var fy = fiscalYearOf(start);
      var expected = options.fiscalYear || _currentFy_(options.now);
      if (fy && expected && fy !== expected) {
        problems.push('Start date ' + start + ' falls in ' + fy + ', not ' + expected +
                      '. The fiscal year runs 1 October to 30 September. If this is ' +
                      'deliberate, change the fiscal year selector.');
      }
    }

    var office = _str_(e.owningOffice).toUpperCase();
    var known = ['FO', 'OMD', 'IDV', 'CM'];
    if (!office) {
      problems.push('Owning office is required — it is the budget the cost ' +
                    'counts against.');
    } else if (known.indexOf(office) === -1) {
      problems.push('Owning office "' + office + '" is not one of ' + known.join(', ') + '.');
    }

    // A blank cost is not zero. Zero-cost travel is real (local, no-cost
    // conferences appear throughout @clolry's FAS tracker data) but it must be
    // typed, not reached by leaving the field empty.
    if (e.totalCost === '' || e.totalCost === null || e.totalCost === undefined) {
      problems.push('Total cost is required. For no-cost travel, enter 0.');
    } else {
      var cost = Number(e.totalCost);
      if (isNaN(cost)) {
        problems.push('Total cost "' + e.totalCost + '" is not a number.');
      } else if (cost < 0) {
        problems.push('Total cost cannot be negative.');
      } else if (cost > 1000000) {
        problems.push('Total cost $' + cost.toLocaleString() + ' looks like a typo.');
      }
    }

    var count = parseInt(e.travelerCount, 10);
    if (!e.travelerCount && e.travelerCount !== 0) {
      problems.push('Number of travelers is required.');
    } else if (isNaN(count) || count < 1) {
      problems.push('Number of travelers must be at least 1.');
    } else if (count > 500) {
      problems.push(count + ' travelers looks like a typo.');
    }

    // Named travelers are OPTIONAL, because @clolry is reconciling a quarter
    // of a year from records that may only hold a headcount. But if names ARE
    // given, the count has to agree — otherwise the request and its traveler
    // rows disagree and no report reconciles.
    var names = (e.travelerNames || []).map(_str_).filter(Boolean);
    if (names.length && !isNaN(count) && names.length !== count) {
      problems.push(names.length + ' traveler name(s) given but the count says ' +
                    count + '. Either match them or leave the names blank.');
    }

    // Duplicate detection is a WARNING, not an error, surfaced separately:
    // two genuine trips to the same event in one month do happen.
    return problems;
  }

  function _currentFy_(now) {
    var d = now || new Date();
    var y = d.getFullYear();
    return 'FY' + (d.getMonth() >= 9 ? y + 1 : y);
  }

  /**
   * Possible duplicates of an entry among existing requests.
   *
   * Reported, never blocked. @clolry is entering a quarter of travel by hand,
   * and the realistic failure is entering the same trip twice across two
   * sittings — which would double-count against a DAC's balance. But two
   * genuine trips to one event in a month also happen, so this cannot refuse.
   *
   * @param {Object} entry
   * @param {Array<Object>} existing [{ requestId, tripName, startDate }]
   * @returns {Array<Object>}
   */
  function findPossibleDuplicates(entry, existing) {
    var name = _str_(entry.tripName).toLowerCase();
    var start = _dateOnly_(entry.startDate);
    if (!name || !start) return [];

    var month = start.slice(0, 7);
    return (existing || []).filter(function (r) {
      return _str_(r.tripName).toLowerCase() === name &&
             _dateOnly_(r.startDate).slice(0, 7) === month;
    });
  }

  /** Existing requests, reduced to what duplicate detection needs. */
  function existingRequests(db) {
    var data;
    try {
      data = db.readSheet(SHEET_NAMES.REQUESTS);
    } catch (e) {
      return [];
    }
    if (!data || !data.headers.length) return [];

    var idx = data.headerIndex;
    var cId = ('Request_ID' in idx) ? idx.Request_ID : -1;
    var cName = ('Trip_Name' in idx) ? idx.Trip_Name : -1;
    var cStart = ('Event_Start_Date' in idx) ? idx.Event_Start_Date : -1;
    var cStatus = ('Status' in idx) ? idx.Status : -1;
    if (cName === -1 || cStart === -1) return [];

    return data.rows.map(function (row) {
      return {
        requestId: cId > -1 ? _str_(row[cId]) : '',
        tripName: _str_(row[cName]),
        startDate: _dateOnly_(row[cStart]),
        status: cStatus > -1 ? _str_(row[cStatus]) : ''
      };
    }).filter(function (r) { return r.tripName; });
  }

  // ==========================================================================
  // WRITE
  // ==========================================================================

  /**
   * Writes backfilled travel. All entries, or none.
   *
   * ATOMIC ACROSS ENTRIES, because a partial write is the worst outcome here:
   * @clolry would have no way to tell which of fifteen trips landed, and
   * re-running would double-count the ones that did.
   *
   * @param {Array<Object>} entries
   * @param {Object} [options] { fiscalYear, now, allowDuplicates }
   * @returns {Object}
   */
  function saveBackfill(entries, options) {
    options = options || {};
    var list = entries || [];
    if (!list.length) return errorResponse('Nothing to import.');

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
    } catch (e) {
      return errorResponse('Another import is in progress. Try again in a moment.');
    }

    try {
      var db = new TravelDB();
      var existing = existingRequests(db);

      // Validate EVERYTHING before writing anything.
      var problems = [];
      list.forEach(function (entry, i) {
        var label = _str_(entry.tripName) || ('Row ' + (i + 1));
        validateEntry(entry, options).forEach(function (p) {
          problems.push(label + ': ' + p);
        });
      });

      // Duplicates WITHIN this submission, which the per-entry check cannot
      // see because neither row exists yet.
      var seen = {};
      list.forEach(function (entry, i) {
        var key = _str_(entry.tripName).toLowerCase() + '|' +
                  _dateOnly_(entry.startDate);
        if (key !== '|' && seen[key]) {
          problems.push((_str_(entry.tripName) || 'Row ' + (i + 1)) +
                        ': appears twice in this import with the same start date.');
        }
        seen[key] = true;
      });

      if (problems.length) {
        return { success: false, problems: problems };
      }

      // Duplicates against EXISTING data are warnings, and the caller must
      // acknowledge them. Blocking would be wrong — two genuine trips to one
      // event in a month happen — but silently double-counting a DAC's budget
      // would be worse.
      var warnings = [];
      list.forEach(function (entry) {
        findPossibleDuplicates(entry, existing).forEach(function (dup) {
          warnings.push(_str_(entry.tripName) + ' starting ' +
                        _dateOnly_(entry.startDate) + ' looks like ' + dup.requestId +
                        ' (' + dup.tripName + ', ' + dup.startDate + ', ' +
                        dup.status + ').');
        });
      });
      if (warnings.length && options.allowDuplicates !== true) {
        return {
          success: false,
          needsConfirmation: true,
          warnings: warnings,
          error: 'Possible duplicates found. Review them, then confirm to import anyway.'
        };
      }

      var reqSheet = db.sheet(SHEET_NAMES.REQUESTS);
      var travSheet = db.sheet(SHEET_NAMES.REQUEST_TRAVELERS);
      var logSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
      if (!reqSheet) {
        return errorResponse(SHEET_NAMES.REQUESTS + ' tab not found.');
      }

      var reqHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.REQUESTS];
      var travHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.REQUEST_TRAVELERS];
      var logHeaders = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.APPROVAL_LOG];

      var actorEmail = Session.getActiveUser().getEmail() || 'backfill';
      var actorName = (typeof formatUserName === 'function')
        ? formatUserName(actorEmail) : actorEmail;
      var now = new Date();

      var reqRows = [];
      var travRows = [];
      var logRows = [];
      var created = [];

      // IDs are generated from a single starting point rather than by calling
      // generateRequestId() per entry: that function reads the sheet to find
      // the highest existing number, and nothing has been written yet, so
      // every call in the loop would return the same ID.
      var nextSeq = _nextRequestSeq_(db, now);

      list.forEach(function (entry, i) {
        var start = _dateOnly_(entry.startDate);
        var end = _dateOnly_(entry.endDate);
        var status = statusFor(end, options.now);
        var office = _str_(entry.owningOffice).toUpperCase();
        var orgCode = _str_(entry.owningOrgCode).toUpperCase() ||
                      ({ FO: 'FC', OMD: 'FCA', IDV: 'FCB', CM: 'FCC' })[office] || '';
        var cost = round2(entry.totalCost);
        var count = parseInt(entry.travelerCount, 10) || 1;
        var requestId = _idPrefix_(now) + String(nextSeq + i).padStart(4, '0');

        var rec = {
          'Request_ID': requestId,
          'Status': status,
          'Trip_Name': _str_(entry.tripName),
          'Location_Type': _str_(entry.locationType) || 'CONUS',
          'Event_Start_Date': start,
          'Event_End_Date': end,
          'Is_International': !!entry.isInternational,
          'Is_OCONUS': !!entry.isOconus,
          'BLUF': _str_(entry.notes),
          'Purpose': _str_(entry.purpose),
          'Travel_Types': '',
          'Shared_Total': 0,
          'Traveler_Total': cost,
          'Grand_Total': cost,
          'Traveler_Count': count,
          'Leg_Count': 0,
          'Submitter_Name': actorName,
          'Submitter_Email': actorEmail,
          'Submitter_Org_Code': orgCode,
          // Reviewer fields stay EMPTY. Naming a reviewer on a request that
          // was never reviewed would put a false approval in the record, and
          // the reviewer dashboards filter on these.
          'Current_Reviewer_Name': '',
          'Current_Reviewer_Email': '',
          'Initial_Review_Level': '',
          'Created_At': now,
          'Updated_At': now,
          // The date the TRAVEL was submitted for, not when it was typed in.
          // Reports group by this, and stamping it `now` would put October
          // travel in whatever month the import ran.
          'Submitted_At': start || now,
          'Version': 1,
          'Owning_Office': office,
          'Owning_Org_Code': orgCode,
          'Travel_Purpose': _str_(entry.purpose),
          'Travel_Purpose_Label': _str_(entry.purpose),
          'Is_Event_Plan_Item': false,
          'Is_LC_Travel': !!entry.isLcTravel,
          'Is_COE_Travel': !!entry.isCoeTravel,
          // MARKED. A figure that entered the budget without review must be
          // identifiable afterward.
          'Primary_Justification': 'BACKFILL: entered retroactively by ' +
            actorName + ' on ' + _dateOnly_(now) +
            (_str_(entry.notes) ? ' — ' + _str_(entry.notes) : ''),
          'Traveler_Org_Codes': (entry.travelerOrgCodes || []).join(',') || orgCode
        };
        // Mapped over the schema headers, never built by hand: writes are
        // positional (docs/DATA_DICTIONARY.md §3.9).
        reqRows.push(reqHeaders.map(function (h) { return h in rec ? rec[h] : ''; }));

        // Traveler rows, when names were given. The per-traveler cost is the
        // total divided evenly — stated as an even split in the record rather
        // than implied, since the real split is not known.
        var names = (entry.travelerNames || []).map(_str_).filter(Boolean);
        var orgs = entry.travelerOrgCodes || [];
        if (travSheet && names.length) {
          var each = round2(cost / names.length);
          names.forEach(function (name, n) {
            var tOrg = _str_(orgs[n]).toUpperCase() || orgCode;
            var tRec = {
              'Request_ID': requestId,
              'Traveler_ID': requestId + '-T' + (n + 1),
              'Employee_Name': name,
              'Org_Code': tOrg,
              'Subtotal': each,
              'Budget_Org_Code': tOrg,
              'Budget_Office_Code': officeForOrgCode(tOrg) || office,
              'Role_Justification': 'Backfilled; per-traveler costs are an even ' +
                                    'split of the trip total.'
            };
            travRows.push(travHeaders.map(function (h) {
              return h in tRec ? tRec[h] : '';
            }));
          });
        }

        if (logSheet) {
          var lRec = {
            'Log_ID': 'LOG-BF-' + now.getTime() + '-' + i,
            'Request_ID': requestId,
            'Action': 'BACKFILL_IMPORT',
            'Action_By_Name': actorName,
            'Action_By_Email': actorEmail,
            'Action_By_Role': 'admin',
            'Timestamp': now,
            'Previous_Status': '',
            'New_Status': status,
            // Says outright that no review happened. The log is what someone
            // reads to ask "who approved this", and the honest answer is
            // nobody.
            'Comments': 'Retroactive import of travel that occurred or was ' +
                        'planned outside the system. NOT routed for approval and ' +
                        'no notifications were sent. Entered by ' + actorEmail + '.',
            'Version_Before': 0,
            'Version_After': 1
          };
          logRows.push(logHeaders.map(function (h) { return h in lRec ? lRec[h] : ''; }));
        }

        created.push({
          requestId: requestId, tripName: rec.Trip_Name, status: status,
          owningOffice: office, totalCost: cost, travelerCount: count,
          startDate: start, endDate: end, fiscalYear: fiscalYearOf(start)
        });
      });

      // Written in one setValues call per sheet. appendRow in a loop is both
      // slow and non-atomic — an execution timeout halfway through would leave
      // an unknown number of rows behind.
      reqSheet.getRange(reqSheet.getLastRow() + 1, 1, reqRows.length, reqHeaders.length)
        .setValues(reqRows);
      if (travSheet && travRows.length) {
        travSheet.getRange(travSheet.getLastRow() + 1, 1, travRows.length,
                           travHeaders.length).setValues(travRows);
      }
      if (logSheet && logRows.length) {
        logSheet.getRange(logSheet.getLastRow() + 1, 1, logRows.length,
                          logHeaders.length).setValues(logRows);
      }

      // The dashboard reads cached sheets; without this the imported travel is
      // invisible and the admin concludes the import failed.
      [SHEET_NAMES.REQUESTS, SHEET_NAMES.REQUEST_TRAVELERS, SHEET_NAMES.APPROVAL_LOG]
        .forEach(function (name) {
          try { db.invalidate(name); } catch (e) {
            console.warn('BudgetBackfill: cache invalidation failed for ' + name);
          }
        });

      console.log('BudgetBackfill: ' + actorEmail + ' imported ' + reqRows.length +
                  ' request(s), ' + travRows.length + ' traveler row(s)');

      return successResponse({
        created: created,
        requestsWritten: reqRows.length,
        travelersWritten: travRows.length,
        // Echoed so the UI can state it rather than the user having to trust
        // that nothing was emailed.
        notificationsSent: 0,
        routedForApproval: false
      }, reqRows.length + ' travel record(s) imported.');
    } catch (e) {
      console.error('saveBackfill failed: ' + e.message);
      return errorResponse('Could not import the travel: ' + e.message);
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * ID prefix for a date: 'L27-' for anything in FY2027.
   *
   * Matches Database.generateRequestId, which the intake form uses. The two
   * must agree or a backfilled request and a form-submitted one would land in
   * different numbering sequences and could collide.
   *
   * FISCAL year, not calendar. The old code used getFullYear(), so a trip
   * entered on 15 October 2026 was numbered REQ-2026-xxxx while drawing on
   * FY2027 money — and the sequence reset on 1 January rather than 1 October.
   *
   * @param {Date} d
   * @returns {string} e.g. 'L27-'
   */
  function _idPrefix_(d) {
    var dt = d || new Date();
    var fy = dt.getMonth() >= 9 ? dt.getFullYear() + 1 : dt.getFullYear();
    return 'L' + String(fy).slice(-2) + '-';
  }

  /**
   * The next free request sequence number for this fiscal year.
   *
   * Matches generateRequestId's L<FY2>-NNNN format, but computed ONCE for a
   * batch. generateRequestId reads the sheet each call, so calling it per
   * entry before any write would return the same ID every time.
   *
   * Scans for the current prefix only. A legacy REQ-YYYY-NNNN row is a
   * different namespace and cannot collide with an L27-xxxx id.
   */
  function _nextRequestSeq_(db, now) {
    var prefix = _idPrefix_(now || new Date());
    var max = 0;
    try {
      var data = db.readSheet(SHEET_NAMES.REQUESTS);
      var cId = (data.headerIndex && 'Request_ID' in data.headerIndex)
        ? data.headerIndex.Request_ID : 0;
      data.rows.forEach(function (row) {
        var id = _str_(row[cId]);
        if (id.indexOf(prefix) !== 0) return;
        var n = parseInt(id.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      });
    } catch (e) {
      console.warn('BudgetBackfill: could not scan existing IDs: ' + e.message);
    }
    return max + 1;
  }

  return {
    saveBackfill: saveBackfill,
    validateEntry: validateEntry,
    findPossibleDuplicates: findPossibleDuplicates,
    existingRequests: existingRequests,
    statusFor: statusFor,
    fiscalYearOf: fiscalYearOf,
    officeForOrgCode: officeForOrgCode
  };
})();

/**
 * Imports travel that already happened or is already planned. ADMIN ONLY.
 *
 * Writes requests that are already APPROVED or COMPLETED without routing them
 * or notifying anyone, and the figures count against a DAC's balance
 * immediately. Reading budget data is open to all users for transparency;
 * writing a request that consumes budget is not the same act.
 *
 * @param {Array<Object>} entries
 * @param {Object} [options] { allowDuplicates }
 * @returns {Object}
 * @client
 */
function importExistingTravel(entries, options) {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  if (!email || !isTravelAdmin(email)) {
    console.warn('importExistingTravel: refused non-admin caller ' + (email || '(none)'));
    return errorResponse('Administrator access is required to import existing travel.');
  }
  return BudgetBackfill.saveBackfill(entries, options || {});
}

/**
 * Validates entries without writing, for inline feedback in the UI.
 *
 * Admin-guarded too: the duplicate check returns existing trip names and
 * request IDs, which is more than a non-admin needs from a dry run.
 *
 * @param {Array<Object>} entries
 * @returns {Object}
 * @client
 */
function validateExistingTravel(entries) {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  if (!email || !isTravelAdmin(email)) {
    return errorResponse('Administrator access is required.');
  }

  try {
    var db = new TravelDB();
    var existing = BudgetBackfill.existingRequests(db);
    var results = (entries || []).map(function (entry, i) {
      return {
        index: i,
        tripName: entry.tripName || '',
        problems: BudgetBackfill.validateEntry(entry),
        possibleDuplicates: BudgetBackfill.findPossibleDuplicates(entry, existing)
          .map(function (d) {
            return { requestId: d.requestId, tripName: d.tripName,
                     startDate: d.startDate, status: d.status };
          }),
        // Shown before saving, because the status determines whether the cost
        // lands as a commitment or as actual spend.
        derivedStatus: BudgetBackfill.statusFor(
          entry.endDate ? String(entry.endDate).slice(0, 10) : '')
      };
    });
    return successResponse({ results: results });
  } catch (e) {
    console.error('validateExistingTravel failed: ' + e.message);
    return errorResponse('Could not validate: ' + e.message);
  }
}
