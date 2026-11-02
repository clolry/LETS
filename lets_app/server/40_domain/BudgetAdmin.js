/**
 * BudgetAdmin.js
 * Admin-maintained budget allocations.
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * @clolry: "if the budget numbers are gone then we need a user interface where
 * each year (or even mid-year if budgets change) we can update the numbers for
 * our overall group and each subgroup (FCA, FCB, FCC) - this would be an admin
 * function and not be open to reviewers."
 *
 * The baselines lived in 00_config/BudgetConfig.js as literals, so changing a
 * dollar figure required a developer and a deploy. For a number that moves
 * mid-year by design, that is the wrong place for it to live.
 *
 * WHY EVERY CHANGE APPENDS A ROW
 * ------------------------------
 * A mid-year change is the stated requirement, and an in-place edit destroys
 * the only record of what the budget WAS.
 *
 * That matters specifically for reconciliation, which @clolry also asked for.
 * A request approved in November against a $152,000 allocation looks
 * over-budget if the allocation was later cut to $120,000 — and with an
 * in-place edit there is nothing anywhere saying the ceiling moved. The
 * approval decision becomes indefensible after the fact.
 *
 * So Budget_Allocations is append-only. The current figure is the row with the
 * latest Effective_Date that is not in the future; everything else is history,
 * and the history is the audit trail. The schema has no Updated_By column, on
 * purpose: having one would invite the edit this design exists to prevent.
 *
 * FALLBACK, AND WHY IT IS LOUD
 * ----------------------------
 * A database with no rows yet falls back to BudgetConfig.js, so the dashboard
 * is never blank. But the payload says `source: 'config-fallback'` and the UI
 * says so too — a figure nobody has confirmed must not look like one somebody
 * set.
 */

var BudgetAdmin = (function () {

  function round2(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
  }

  /** YYYY-MM-DD in the script's timezone, for an Effective_Date default. */
  function today() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  /**
   * Fiscal year for a date. October through September.
   *
   * @clolry: "Our fiscal year began October 1st". So a trip on 2 October 2026
   * is FY2027 money, and getting this wrong by a day attributes spend to the
   * wrong year's budget.
   *
   * @param {Date|string} d
   * @returns {string} e.g. 'FY2027'
   */
  function fiscalYearOf(d) {
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    var y = dt.getFullYear();
    return 'FY' + (dt.getMonth() >= 9 ? y + 1 : y);   // getMonth() 9 = October
  }

  /** The fiscal year we are in now. */
  function currentFiscalYear() {
    return fiscalYearOf(new Date());
  }

  /**
   * The four offices, in a fixed order.
   *
   * Read from BudgetConfig so the office LIST stays in one place even though
   * the AMOUNTS move to the database. @clolry: "FCA and OMD are two ways to
   * describe the same thing" — both namespaces travel together.
   */
  function officeDefinitions() {
    var base = (typeof LETS_CONFIG !== 'undefined' && LETS_CONFIG.baselineAllocations) || {};
    var ORG = { FO: 'FC', OMD: 'FCA', IDV: 'FCB', CM: 'FCC' };
    return ['FO', 'OMD', 'IDV', 'CM'].filter(function (c) { return !!base[c]; })
      .map(function (code) {
        return {
          officeCode: code,
          orgCode: ORG[code] || '',
          officeName: base[code].name,
          isDac: !!base[code].isDac,
          configAmount: round2(base[code].baselineAmount),
          configShare: Number(base[code].standardProportionalShare) || 0
        };
      });
  }

  /**
   * Every allocation row, newest first.
   *
   * @param {Object} db
   * @returns {Array<Object>}
   */
  function readAllocations(db) {
    var data;
    try {
      data = db.readSheet(SHEET_NAMES.BUDGET_ALLOCATIONS);
    } catch (e) {
      console.warn('BudgetAdmin: could not read ' + SHEET_NAMES.BUDGET_ALLOCATIONS +
                   ': ' + e.message);
      return [];
    }
    if (!data || !data.headers.length) return [];

    var idx = data.headerIndex;
    function col(n) { return (n in idx) ? idx[n] : -1; }

    // By header NAME. Eighteen places in LETS read positionally and a column
    // insertion silently misfiles them (finding G-014).
    var c = {
      id: col('Allocation_ID'), fy: col('Fiscal_Year'),
      office: col('Office_Code'), org: col('Org_Code'),
      name: col('Office_Name'), isDac: col('Is_DAC'),
      amount: col('Amount'), share: col('Proportional_Share'),
      eff: col('Effective_Date'), reason: col('Change_Reason'),
      supersedes: col('Supersedes_ID'), active: col('Is_Active'),
      by: col('Created_By'), at: col('Created_At')
    };
    if (c.office === -1 || c.amount === -1 || c.eff === -1) {
      console.warn('BudgetAdmin: Budget_Allocations is missing required columns');
      return [];
    }

    var out = [];
    data.rows.forEach(function (row) {
      var officeCode = String(row[c.office] || '').trim().toUpperCase();
      if (!officeCode) return;

      // Is_Active is a checkbox for rows written by this code and a typed
      // word for rows entered by hand. Blank defaults to ACTIVE, because
      // leaving the cell empty is the common hand-entry case.
      var activeRaw = c.active > -1 ? row[c.active] : '';
      var isActive = (activeRaw === '' || activeRaw === null || activeRaw === undefined)
        ? true
        : (activeRaw === true ||
           ['true', 'yes', 'y', '1'].indexOf(String(activeRaw).trim().toLowerCase()) > -1);
      if (!isActive) return;

      out.push({
        allocationId: c.id > -1 ? String(row[c.id] || '') : '',
        fiscalYear: c.fy > -1 ? String(row[c.fy] || '').trim() : '',
        officeCode: officeCode,
        orgCode: c.org > -1 ? String(row[c.org] || '').trim().toUpperCase() : '',
        officeName: c.name > -1 ? String(row[c.name] || '').trim() : '',
        isDac: c.isDac > -1 ? (row[c.isDac] === true ||
          String(row[c.isDac]).trim().toLowerCase() === 'true') : false,
        amount: round2(row[c.amount]),
        proportionalShare: c.share > -1 ? (Number(row[c.share]) || 0) : 0,
        effectiveDate: _dateStr_(row[c.eff]),
        changeReason: c.reason > -1 ? String(row[c.reason] || '') : '',
        supersedesId: c.supersedes > -1 ? String(row[c.supersedes] || '') : '',
        createdBy: c.by > -1 ? String(row[c.by] || '') : '',
        createdAt: c.at > -1 ? _dateStr_(row[c.at]) : ''
      });
    });

    // Newest effective date first, so "current" is a head-of-list read.
    out.sort(function (a, b) {
      if (a.effectiveDate !== b.effectiveDate) {
        return a.effectiveDate < b.effectiveDate ? 1 : -1;
      }
      // Same date: the later-created row wins. Two changes on one day is a
      // correction, and the correction is the one that counts.
      return (a.createdAt < b.createdAt) ? 1 : -1;
    });
    return out;
  }

  /** A Date or date-ish cell as YYYY-MM-DD. '' when unparseable. */
  function _dateStr_(v) {
    if (!v) return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      var m = v.getMonth() + 1;
      var d = v.getDate();
      return v.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
    }
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var parsed = new Date(s);
    if (isNaN(parsed.getTime())) return '';
    return _dateStr_(parsed);
  }

  /**
   * The allocation in force for each office, for a fiscal year.
   *
   * "In force" means the latest Effective_Date that is NOT IN THE FUTURE. A
   * future-dated row is a scheduled change and must not take effect early —
   * entering next year's budget in August should not move this month's
   * balances.
   *
   * @param {string} [fiscalYear] defaults to the current one
   * @param {string} [asOf] YYYY-MM-DD, defaults to today. Injectable for tests
   * @returns {Object} { byOffice, source, fiscalYear, rows }
   */
  function currentAllocations(fiscalYear, asOf) {
    var fy = fiscalYear || currentFiscalYear();
    var when = asOf || today();

    var rows = [];
    try {
      rows = readAllocations(new TravelDB());
    } catch (e) {
      console.warn('BudgetAdmin: allocations unavailable: ' + e.message);
      rows = [];
    }

    var defs = officeDefinitions();
    var byOffice = {};
    var usedDb = false;

    defs.forEach(function (d) {
      var inForce = rows.filter(function (r) {
        return r.officeCode === d.officeCode &&
               (!r.fiscalYear || r.fiscalYear === fy) &&
               r.effectiveDate && r.effectiveDate <= when;
      })[0];   // rows are already newest-first

      var scheduled = rows.filter(function (r) {
        return r.officeCode === d.officeCode &&
               (!r.fiscalYear || r.fiscalYear === fy) &&
               r.effectiveDate && r.effectiveDate > when;
      });

      if (inForce) {
        usedDb = true;
        byOffice[d.officeCode] = {
          officeCode: d.officeCode,
          orgCode: inForce.orgCode || d.orgCode,
          officeName: inForce.officeName || d.officeName,
          isDac: d.isDac,
          amount: inForce.amount,
          proportionalShare: inForce.proportionalShare || d.configShare,
          effectiveDate: inForce.effectiveDate,
          changeReason: inForce.changeReason,
          setBy: inForce.createdBy,
          allocationId: inForce.allocationId,
          source: 'database',
          // Named so the UI can warn that a change is queued. A DAC looking at
          // a balance should know if it moves next month.
          scheduledChanges: scheduled.map(function (r) {
            return { effectiveDate: r.effectiveDate, amount: r.amount,
                     changeReason: r.changeReason };
          })
        };
      } else {
        // FALLBACK, and it announces itself. A figure nobody has confirmed
        // must not look like one somebody set.
        byOffice[d.officeCode] = {
          officeCode: d.officeCode,
          orgCode: d.orgCode,
          officeName: d.officeName,
          isDac: d.isDac,
          amount: d.configAmount,
          proportionalShare: d.configShare,
          effectiveDate: '',
          changeReason: '',
          setBy: '',
          allocationId: '',
          source: 'config-fallback',
          scheduledChanges: scheduled.map(function (r) {
            return { effectiveDate: r.effectiveDate, amount: r.amount,
                     changeReason: r.changeReason };
          })
        };
      }
    });

    return {
      byOffice: byOffice,
      fiscalYear: fy,
      asOf: when,
      // 'database' only when EVERY office has a row. A mix is reported as
      // 'partial', because a dashboard mixing confirmed and unconfirmed
      // figures without saying so is the problem this field exists to avoid.
      source: usedDb
        ? (defs.every(function (d) { return byOffice[d.officeCode].source === 'database'; })
            ? 'database' : 'partial')
        : 'config-fallback',
      rows: rows
    };
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Checks one allocation change.
   *
   * Returns problems rather than throwing, so the UI can show all of them at
   * once instead of making the user fix one, resubmit, and find the next.
   *
   * @param {Object} entry
   * @param {Array<Object>} existingRows
   * @returns {Array<string>}
   */
  function validateAllocation(entry, existingRows) {
    var problems = [];
    var e = entry || {};
    var defs = officeDefinitions();
    var known = defs.map(function (d) { return d.officeCode; });

    var office = String(e.officeCode || '').trim().toUpperCase();
    if (!office) {
      problems.push('Office is required.');
    } else if (known.indexOf(office) === -1) {
      problems.push('Office "' + office + '" is not one of ' + known.join(', ') + '.');
    }

    // A blank amount is not zero. Zeroing an office's budget is a real
    // decision and must be typed deliberately, not reached by leaving a field
    // empty.
    if (e.amount === '' || e.amount === null || e.amount === undefined) {
      problems.push('Amount is required. To zero out an office, enter 0 explicitly.');
    } else {
      var amt = Number(e.amount);
      if (isNaN(amt)) {
        problems.push('Amount "' + e.amount + '" is not a number.');
      } else if (amt < 0) {
        problems.push('Amount cannot be negative. A reduction is a lower ' +
                      'number, not a negative one.');
      } else if (amt > 100000000) {
        // A fat-fingered extra digit turns $152,000 into $1,520,000 and
        // nothing downstream would question it.
        problems.push('Amount $' + amt.toLocaleString() + ' looks like a typo. ' +
                      'If it is correct, split it across two entries.');
      }
    }

    var eff = String(e.effectiveDate || '').trim();
    if (!eff) {
      problems.push('Effective date is required — it is what makes the history ' +
                    'readable later.');
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) {
      problems.push('Effective date must be YYYY-MM-DD.');
    } else if (isNaN(new Date(eff + 'T12:00:00').getTime())) {
      problems.push('Effective date "' + eff + '" is not a real date.');
    }

    // REQUIRED, and this is the one people will object to. Without it the
    // audit trail is a list of numbers that changed for no recorded reason,
    // which answers none of the questions it exists to answer.
    var reason = String(e.changeReason || '').trim();
    if (!reason) {
      problems.push('A reason is required. Six months from now this row is the ' +
                    'only record of why the number moved.');
    } else if (reason.length < 5) {
      problems.push('Give a fuller reason than "' + reason + '".');
    }

    var fy = String(e.fiscalYear || '').trim();
    if (!fy) {
      problems.push('Fiscal year is required.');
    } else if (!/^FY\d{4}$/.test(fy)) {
      problems.push('Fiscal year must look like FY2027.');
    } else if (eff && /^\d{4}-\d{2}-\d{2}$/.test(eff)) {
      // An effective date outside its own fiscal year is almost always a
      // mistake, and it would attribute spend to the wrong year's budget.
      var effFy = fiscalYearOf(new Date(eff + 'T12:00:00'));
      if (effFy && effFy !== fy) {
        problems.push('Effective date ' + eff + ' falls in ' + effFy +
                      ', not ' + fy + '. The fiscal year runs 1 October to 30 September.');
      }
    }

    // Duplicate (office, effective date) would make "which is in force"
    // depend on row order, which is not a decision anyone made.
    var clash = (existingRows || []).filter(function (r) {
      return r.officeCode === office && r.effectiveDate === eff;
    });
    if (clash.length && office && eff) {
      problems.push('There is already an allocation for ' + office +
                    ' effective ' + eff + ' ($' + clash[0].amount.toLocaleString() +
                    '). Use a different date, or deactivate that row first.');
    }

    return problems;
  }

  // ==========================================================================
  // WRITES
  // ==========================================================================

  /**
   * Appends allocation rows. All of them, or none.
   *
   * @clolry sets four offices at once at the start of a year, and a partial
   * write would leave the group total wrong in a way that looks like a real
   * budget rather than like a failed save. So every entry is validated before
   * any row is written.
   *
   * @param {Array<Object>} entries
   * @returns {Object} successResponse({ written, allocations }) | errorResponse
   */
  function saveAllocations(entries) {
    var list = entries || [];
    if (!list.length) return errorResponse('No allocations to save.');

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
    } catch (e) {
      return errorResponse('Another budget edit is in progress. Try again in a moment.');
    }

    try {
      var db = new TravelDB();
      var existing = readAllocations(db);

      // Validate EVERYTHING first. A half-applied budget is worse than none:
      // the group total would be wrong and still look plausible.
      var allProblems = [];
      list.forEach(function (entry, i) {
        var probs = validateAllocation(entry, existing);
        probs.forEach(function (p) {
          allProblems.push((entry.officeCode || 'Row ' + (i + 1)) + ': ' + p);
        });
      });

      // Two entries for the same office and date inside ONE submission would
      // pass the per-entry check, because neither is in `existing` yet.
      var seen = {};
      list.forEach(function (entry) {
        var key = String(entry.officeCode || '').toUpperCase() + '|' +
                  String(entry.effectiveDate || '');
        if (seen[key]) {
          allProblems.push('Two entries for ' + entry.officeCode + ' effective ' +
                           entry.effectiveDate + ' in the same save.');
        }
        seen[key] = true;
      });

      if (allProblems.length) {
        return { success: false, problems: allProblems };
      }

      var sheet = db.sheet(SHEET_NAMES.BUDGET_ALLOCATIONS);
      if (!sheet) {
        return errorResponse(SHEET_NAMES.BUDGET_ALLOCATIONS + ' tab not found. ' +
                             'Run setupTravelDatabase() first.');
      }

      var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.BUDGET_ALLOCATIONS];
      var actor = Session.getActiveUser().getEmail() || 'budget-admin';
      var now = new Date();
      var defs = {};
      officeDefinitions().forEach(function (d) { defs[d.officeCode] = d; });

      var rows = list.map(function (entry, i) {
        var office = String(entry.officeCode).trim().toUpperCase();
        var def = defs[office] || {};

        // The row this one replaces, for a chain that reads without having to
        // sort by date.
        var prior = existing.filter(function (r) {
          return r.officeCode === office;
        })[0];

        var rec = {
          'Allocation_ID': 'alloc_' + Date.now() + '_' + i + '_' + office,
          'Fiscal_Year': String(entry.fiscalYear).trim(),
          'Office_Code': office,
          'Org_Code': def.orgCode || '',
          'Office_Name': def.officeName || office,
          'Is_DAC': !!def.isDac,
          'Amount': round2(entry.amount),
          // Shares stay in config: they are a policy split that happens to
          // approximate the baseline ratio. Recomputing from amounts would
          // drift away from the agreed percentages every time a budget moved.
          'Proportional_Share': def.configShare || 0,
          'Effective_Date': entry.effectiveDate,
          'Change_Reason': String(entry.changeReason).trim(),
          'Supersedes_ID': prior ? prior.allocationId : '',
          'Is_Active': true,
          'Created_By': actor,
          'Created_At': now
        };
        // Built by mapping over the schema headers, never by hand: writes are
        // positional (docs/DATA_DICTIONARY.md §3.9).
        return headers.map(function (h) { return h in rec ? rec[h] : ''; });
      });

      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length)
        .setValues(rows);

      // The dashboard reads a cached sheet; without this the new figures are
      // invisible until the cache expires and the admin thinks the save failed.
      try {
        db.invalidate(SHEET_NAMES.BUDGET_ALLOCATIONS);
      } catch (e) {
        console.warn('BudgetAdmin: cache invalidation failed: ' + e.message);
      }

      console.log('BudgetAdmin: ' + actor + ' wrote ' + rows.length +
                  ' allocation row(s)');

      return successResponse({
        written: rows.length,
        allocations: currentAllocations(list[0].fiscalYear)
      }, rows.length + ' allocation(s) saved.');
    } catch (e) {
      console.error('saveAllocations failed: ' + e.message);
      return errorResponse('Could not save the allocations: ' + e.message);
    } finally {
      lock.releaseLock();
    }
  }

  return {
    currentAllocations: currentAllocations,
    readAllocations: readAllocations,
    saveAllocations: saveAllocations,
    validateAllocation: validateAllocation,
    officeDefinitions: officeDefinitions,
    fiscalYearOf: fiscalYearOf,
    currentFiscalYear: currentFiscalYear,
    today: today,
    round2: round2
  };
})();

// ============================================================================
// BROWSER ENTRY POINTS
// ============================================================================
//
// Top-level declarations: Apps Script exposes only these to google.script.run.
// Finding G-016 is this exact trap — the whole LETS budget layer is an IIFE
// assigning to `root`, and is therefore unreachable.

/**
 * Current allocations and their full history.
 *
 * READABLE BY ANY SIGNED-IN USER, deliberately. @clolry: "budgeting info can
 * be available to users at this point - no secrets to hide there - we're
 * trying to develop transparency."
 *
 * @param {string} [fiscalYear]
 * @returns {Object}
 * @client
 */
function getBudgetAllocations(fiscalYear) {
  try {
    var current = BudgetAdmin.currentAllocations(fiscalYear);
    return successResponse({
      fiscalYear: current.fiscalYear,
      asOf: current.asOf,
      source: current.source,
      offices: Object.keys(current.byOffice).map(function (k) {
        return current.byOffice[k];
      }),
      history: current.rows,
      // The UI shows the editor only to admins. The GUARD is on the write
      // function, not on this flag — a client-side check is a convenience,
      // never a control.
      canEdit: isTravelAdmin(Session.getActiveUser().getEmail() || '')
    });
  } catch (e) {
    console.error('getBudgetAllocations failed: ' + e.message);
    return errorResponse('Could not read the budget allocations: ' + e.message);
  }
}

/**
 * Writes new allocation rows. ADMIN ONLY.
 *
 * @clolry: "this would be an admin function and not be open to reviewers."
 *
 * Reading is open to everyone for transparency; writing is not. The two are
 * separate functions so that distinction is in the code rather than in a
 * parameter somebody could get wrong.
 *
 * @param {Array<Object>} entries
 * @returns {Object}
 * @client
 */
function saveBudgetAllocations(entries) {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return errorResponse('Could not determine the active user.');
  }
  if (!email || !isTravelAdmin(email)) {
    // Logged because this function is browser-reachable and writes budget
    // figures; an unexpected caller is worth seeing.
    console.warn('saveBudgetAllocations: refused non-admin caller ' + (email || '(none)'));
    return errorResponse('Administrator access is required to change budget allocations.');
  }
  return BudgetAdmin.saveAllocations(entries);
}
