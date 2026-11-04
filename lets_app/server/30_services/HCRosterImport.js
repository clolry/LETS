/**
 * HCRosterImport.js
 * Loads the real HR roster from the FAS HRLinks feed into HC_Positions.
 *
 * WHY THIS EXISTS
 * ---------------
 * HC_Positions holds 16 fictional people. They were written by
 * 91_setup/HCSeed.js as a test fixture — Marguerite Okonkwo, Desmond Whitaker,
 * Priya Raghunathan and thirteen others, all @example.gov — and they are what
 * the per-capita budget split, the org chart and the supervisor-based access
 * gate are currently reading.
 *
 * @clolry: "please make sure that when we seed the HR roster that we remove ALL
 * test records and are relying only on the sheet identified in the system
 * properties and completely ignore my sheet from May."
 *
 * THE ERROR THAT PROMPTED THIS, RECORDED BECAUSE IT WAS MINE
 * ---------------------------------------------------------
 * I reported Melissa Mould as unattributable to any org. I had been reading
 * reference_excel_files/Copy of ASD Staffing Plan 5-12-26.xlsx — a May export —
 * which places her in FCBBB at supervisory status 8. The FAS HR feed has her in
 * FCBBBB as a status-2 supervisor.
 *
 * The consequence was not one wrong row. Every per-capita service-centre figure
 * reported before this module existed was computed from that stale file: 807
 * filled positions, 22 service-centre shares, every dollar allocation. A roster
 * six months out of date produces allocations that look precise and are wrong,
 * which is worse than an obvious gap because nobody checks a confident number.
 *
 * So this module has exactly one source — Props.getFasHrFeedSource(), reading
 * the FAS_HRLinks_Feed Script Property — and NO fallback. Not to a bundled
 * file, not to the May spreadsheet, not to the seed data. An unset property is
 * a hard error, because every available fallback is a stale roster.
 *
 * WHY THE COLUMN MAPPING IS PROPOSED AND NOT ASSUMED
 * --------------------------------------------------
 * The FAS HRLinks feed's exact headers are not known here, and guessing wrong
 * is not a visible failure — it is a roster where Supervisory_Status came from
 * the wrong column, which silently grants or denies LETS access to several
 * hundred people (Access.js:416 reads that field to decide site access).
 *
 * So proposeMapping guesses from a list of plausible header spellings, reports
 * what it matched and what it could not, and the import REFUSES to run when a
 * required field is unmapped. GogovSync.proposeMapping does the same thing for
 * the same reason and the comment there says so: "PROPOSES, never decides."
 *
 * WHY THIS REPLACES RATHER THAN MERGES
 * ------------------------------------
 * A merge would leave the 16 fictional people in place, since nothing in the
 * feed matches them. @clolry asked for ALL test records removed, and a
 * fictional employee in a system that sends email and grants access is a
 * liability rather than a tidiness problem.
 *
 * But a replace that silently drops real rows is worse than a stale roster, so
 * previewRosterImport is a dry run that reports exactly what would be added,
 * changed and deleted, and importRoster refuses unless the caller passes the
 * preview's own token back. That is the same confirm-then-act shape the
 * existing-travel importer uses.
 */

var HCRosterImport = (function () {

  function _str_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  /**
   * Header spellings for each field we need, best guess first.
   *
   * A feed from HRLinks will not use LETS's internal column names, and the
   * same concept is spelled several ways across government HR exports. Matched
   * case-insensitively and whitespace-collapsed, because ' Authorization
   * Submitted' in the travel log proved that real headers carry stray spaces.
   */
  var FIELD_HINTS = {
    positionNumber: ['Position Number', 'Position #', 'Position # (PN)', 'PN',
                     'Position Nbr', 'Position_Number', 'Position ID'],
    reportsTo:      ['Reports To Position Number', 'Supervisor Position Number',
                     'Reports To', 'Supervisor PN', 'Reports To PN',
                     'Supervisor Position'],
    employeeId:     ['Employee ID', 'Employee Id', 'EMPLID', 'Emp ID',
                     'Employee Number'],
    employeeName:   ['Employee Name', 'Full Name', 'Name', 'Employee'],
    emailAddress:   ['Email Address', 'Email', 'Work Email', 'Email Addr'],
    orgCode:        ['Org Code', 'Office Symbol', 'Organization',
                     'Org Symbol', 'Organizational Code'],
    officeTitle:    ['Position Title', 'Office Title', 'Title', 'Job Title'],
    grade:          ['Grade', 'Pay Grade', 'GS Grade', 'Grade Level'],
    supervisoryStatus: ['Supervisory Status', 'Supv Status', 'Supv',
                        'Supervisor Status', 'Supervisory Code'],
    occupancyStatus: ['Occupancy Status', 'Work Status', 'Position Status',
                      'Filled/Vacant', 'Status'],
    lcat:           ['LCAT', 'Labor Category', 'Occupational Series', 'Series'],
    locationCode:   ['Location Code', 'Duty Station Code', 'Location'],
    dutyAddress:    ['Duty Station Address', 'Duty Address', 'Address'],
    dutyCity:       ['Duty Station City', 'Location City (Duty Station)',
                     'Duty City', 'City'],
    dutyState:      ['Duty Station State', 'State', 'Duty State']
  };

  /**
   * Fields without which the import must not proceed.
   *
   * positionNumber     the join key for the entire supervisor chain. Without
   *                    it nothing routes and nothing resolves.
   * employeeName       a roster with no names cannot attribute travel.
   * orgCode            the budget attribution key. Without it every
   *                    per-capita figure is unattributed.
   *
   * reportsTo is NOT required, deliberately. Some feeds express hierarchy only
   * through org codes, and the org hierarchy in HC_Orgs is already stored
   * explicitly — so a roster without supervisor pointers still produces
   * correct budget attribution. It degrades the approval-routing walk and
   * `missingSupervisorChain` says so rather than blocking the import.
   */
  var REQUIRED_FIELDS = ['positionNumber', 'employeeName', 'orgCode'];

  /** Collapses whitespace and lowercases, for header comparison. */
  function _norm_(h) {
    return _str_(h).toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Proposes a header -> field mapping.
   *
   * PROPOSES, never decides. A silently wrong guess on supervisoryStatus
   * changes who can sign in to LETS; on orgCode it misattributes every
   * dollar. The caller is shown the mapping and the unmapped remainder.
   *
   * @param {Array<string>} headers the feed's header row
   * @returns {{mapping: Object, index: Object, unmapped: Array,
   *            missing: Array}}
   */
  function proposeMapping(headers) {
    var hdrs = (headers || []).map(_str_);
    var mapping = {};
    var index = {};
    var used = {};

    Object.keys(FIELD_HINTS).forEach(function (field) {
      var hints = FIELD_HINTS[field];
      for (var i = 0; i < hints.length; i++) {
        var want = _norm_(hints[i]);
        for (var h = 0; h < hdrs.length; h++) {
          if (used[h]) continue;
          if (_norm_(hdrs[h]) === want) {
            mapping[field] = hdrs[h];
            index[field] = h;
            used[h] = true;
            return;
          }
        }
      }
    });

    return {
      mapping: mapping,
      index: index,
      unmapped: hdrs.filter(function (h, i) { return !used[i] && h; }),
      missing: REQUIRED_FIELDS.filter(function (f) { return !(f in mapping); })
    };
  }

  /**
   * Normalises a supervisory-status value.
   *
   * THE FIELD THAT GRANTS SITE ACCESS. Access.js:416 treats '2' as supervisor
   * and that alone can admit someone to LETS, so a value that arrives as the
   * NUMBER 2 and is compared against the STRING '2' fails and silently denies
   * access. The May export carried both '8' and '8.0' for the same meaning —
   * 663 and 11 rows — which is what a spreadsheet does to a numeric column.
   *
   * So a trailing '.0' is stripped and the result is returned as a string.
   * Unrecognised codes are PRESERVED rather than blanked: HR owns this
   * vocabulary and inventing a default would be worse than carrying a value
   * validateRow will flag.
   */
  function normalizeSupervisoryStatus(v) {
    var s = _str_(v);
    if (!s) return '';
    s = s.replace(/\.0+$/, '');
    return s;
  }

  /**
   * Normalises a grade to a zero-padded string.
   *
   * THE VT-03 DEFECT, from HCAdmin.validateHCPosition: a sheet cell holding 07
   * arrives as the number 7, String(7) is '07' to nobody, and every grade
   * comparison in LETS is a string comparison — including the GS-15 Division
   * Director lookup that approval routing depends on.
   *
   * Non-numeric grades (SES, ES, VT-03) pass through untouched.
   */
  function normalizeGrade(v) {
    var s = _str_(v);
    if (!s) return '';
    s = s.replace(/\.0+$/, '');
    if (/^\d$/.test(s)) return '0' + s;
    return s;
  }

  /**
   * Normalises occupancy to FILLED | VACANT | OBLIGATED.
   *
   * The feed may express this as a work status, or not at all. A row whose
   * NAME says vacant is vacant regardless of what the status column holds —
   * the May export used 'VACANT (New position)' in the name field for 107
   * seats, and reading only a status column would have counted all of them as
   * staffed.
   *
   * THIS DECIDES THE PER-CAPITA DENOMINATOR, so it must not guess generously.
   * An unrecognised value on a row that HAS a real name defaults to FILLED,
   * because a named person occupies their seat; a row with no name at all is
   * VACANT.
   */
  function normalizeOccupancy(statusValue, employeeName) {
    var name = _str_(employeeName);
    var s = _str_(statusValue).toUpperCase();

    if (!name || /\bVACANT\b/.test(name.toUpperCase())) return 'VACANT';
    if (s.indexOf('VACAN') > -1) return 'VACANT';
    if (s.indexOf('OBLIGAT') > -1) return 'OBLIGATED';
    if (s.indexOf('FILL') > -1) return 'FILLED';
    return 'FILLED';
  }

  /**
   * One feed row -> an HC_Positions-shaped record.
   *
   * Pure. No sheet access and no clock, so every decision above is testable
   * without a spreadsheet.
   *
   * @param {Array} cells
   * @param {Object} mapped from proposeMapping
   * @param {number} rowNumber 1-based, for messages
   * @returns {Object|null} null for a row that is not a position
   */
  function interpretRow(cells, mapped, rowNumber) {
    var idx = mapped.index;
    var get = function (field) {
      return (field in idx) ? cells[idx[field]] : '';
    };

    var pn = _str_(get('positionNumber'));
    var name = _str_(get('employeeName'));
    var org = _str_(get('orgCode')).toUpperCase();

    // A row with no position number AND no name is a spacer, a subtotal or a
    // banner. The May export had 272 of them among 409 rows.
    if (!pn && !name) return null;

    return {
      sourceRow: rowNumber,
      positionNumber: pn,
      reportsToPositionNumber: _str_(get('reportsTo')),
      employeeId: _str_(get('employeeId')),
      employeeName: name,
      emailAddress: _str_(get('emailAddress')).toLowerCase(),
      orgCode: org,
      officeTitle: _str_(get('officeTitle')),
      grade: normalizeGrade(get('grade')),
      supervisoryStatus: normalizeSupervisoryStatus(get('supervisoryStatus')),
      occupancyStatus: normalizeOccupancy(get('occupancyStatus'), name),
      lcat: _str_(get('lcat')),
      locationCode: _str_(get('locationCode')),
      dutyStationAddress: _str_(get('dutyAddress')),
      dutyStationCity: _str_(get('dutyCity')),
      dutyStationState: _str_(get('dutyState'))
    };
  }

  /**
   * Checks one interpreted row.
   *
   * Problems BLOCK the row. Warnings import it and say so. The split matters:
   * refusing the whole roster because forty people have no email would leave
   * LETS on fictional data, and importing a duplicate position number would
   * make one of two real people invisible to every lookup.
   *
   * @param {Object} row
   * @param {Object} seenPositionNumbers mutated: pn -> first row number
   * @param {Object} orgCodesByCode HC_Orgs index, or null to skip the check
   * @returns {{problems: Array, warnings: Array}}
   */
  function validateRow(row, seenPositionNumbers, orgCodesByCode) {
    var problems = [];
    var warnings = [];

    if (!row.positionNumber) {
      problems.push('No position number. It is the key the supervisor chain ' +
                    'and every lookup join on.');
    } else if (seenPositionNumbers && row.positionNumber in seenPositionNumbers) {
      // THE DUPLICATE-KEY DEFECT. HCAdmin.validateHCPosition guards the same
      // thing for a single edit: the later row wins every lookup and the
      // earlier person becomes invisible.
      problems.push('Position number ' + row.positionNumber +
                    ' already appeared on row ' +
                    seenPositionNumbers[row.positionNumber] +
                    '. A duplicate makes one of the two people invisible.');
    } else if (seenPositionNumbers) {
      seenPositionNumbers[row.positionNumber] = row.sourceRow;
    }

    if (!row.orgCode) {
      problems.push('No org code, so this person\'s travel cannot be ' +
                    'attributed to any budget.');
    } else if (orgCodesByCode && !orgCodesByCode[row.orgCode]) {
      // NOT a problem. An org code absent from HC_Orgs still resolves to its
      // nearest listed ancestor by prefix, so the money lands in the right
      // DAC — it just will not roll up to a named service centre. Blocking
      // would reject real people over a reference-data gap.
      warnings.push('Org code ' + row.orgCode + ' is not in HC_Orgs. Travel ' +
                    'will attribute to its nearest known parent.');
    }

    if (row.occupancyStatus !== 'VACANT') {
      if (!row.employeeName) {
        problems.push('A filled position with no name.');
      }
      if (!row.emailAddress) {
        // Reported, not blocked. A staffed seat without an email cannot be
        // notified or matched for site access, and nothing else reports it.
        warnings.push('No email address, so this person cannot be notified ' +
                      'or matched for LETS access.');
      } else if (row.emailAddress.indexOf('@') === -1) {
        warnings.push('Email "' + row.emailAddress + '" is not an email address.');
      }
    }

    if (row.supervisoryStatus &&
        ['2', '4', '5', '6', '7', '8'].indexOf(row.supervisoryStatus) === -1) {
      warnings.push('Supervisory status "' + row.supervisoryStatus +
                    '" is not a recognised code. This field grants LETS ' +
                    'access on its own, so it is worth checking.');
    }

    if (row.reportsToPositionNumber &&
        row.reportsToPositionNumber === row.positionNumber) {
      problems.push('This position reports to itself, which would hang any ' +
                    'page that walks the supervisor chain.');
    }

    return { problems: problems, warnings: warnings };
  }

  /**
   * Finds supervisor-chain cycles across the whole roster.
   *
   * Run after every row is read, because a cycle is a property of the SET —
   * A reports to B reports to A is invisible when either row is examined
   * alone. HCAdmin does this per-edit; a bulk import has to do it per-batch.
   *
   * A cycle hangs every page that walks the chain, so the rows in one are
   * imported with their reportsTo CLEARED rather than dropped: the people are
   * real and their budget attribution is unaffected, and a broken routing
   * pointer is recoverable while a missing person is not.
   *
   * @param {Array} rows
   * @returns {{cycles: Array<Array<string>>, cleared: number}}
   */
  function findSupervisorCycles(rows) {
    var byPn = {};
    (rows || []).forEach(function (r) {
      if (r.positionNumber) byPn[r.positionNumber] = r;
    });

    var state = {};        // pn -> 'visiting' | 'clean'
    var cycles = [];
    var cleared = 0;

    (rows || []).forEach(function (start) {
      if (!start.positionNumber || state[start.positionNumber]) return;

      var path = [];
      var onPath = {};
      var cursor = start.positionNumber;
      var depth = 0;

      while (cursor && byPn[cursor] && depth < 200) {
        if (onPath[cursor]) {
          // Found a cycle. Record it from its entry point.
          var at = path.indexOf(cursor);
          var ring = path.slice(at);
          cycles.push(ring);
          ring.forEach(function (pn) {
            if (byPn[pn] && byPn[pn].reportsToPositionNumber) {
              byPn[pn].reportsToPositionNumber = '';
              byPn[pn].cycleCleared = true;
              cleared++;
            }
            state[pn] = 'clean';
          });
          break;
        }
        if (state[cursor] === 'clean') break;

        path.push(cursor);
        onPath[cursor] = true;
        cursor = _str_(byPn[cursor].reportsToPositionNumber);
        depth++;
      }

      path.forEach(function (pn) { if (!state[pn]) state[pn] = 'clean'; });
    });

    return { cycles: cycles, cleared: cleared };
  }

  /**
   * Identifies seed/test rows in the CURRENT HC_Positions.
   *
   * @clolry: "remove ALL test records".
   *
   * Detected by the fixture's own markers rather than by "anything the feed
   * does not mention", which would also delete a real person the feed happens
   * to omit this week. Three signals, any one sufficient:
   *
   *   @example.gov            the fixture's email domain, reserved by RFC 2606
   *                           and therefore never a real GSA address
   *   Created_By 'hc-seed'    what seedHCTestData stamps
   *   an FC-0001-style PN     the fixture's synthetic numbering
   *
   * Reported separately from the general delete count, so the preview can say
   * "16 fictional test records" rather than burying them in a total.
   *
   * @param {Array} existing normalized current positions
   * @returns {Array} the subset that is test data
   */
  function identifySeedRows(existing) {
    return (existing || []).filter(function (p) {
      var email = _str_(p.emailAddress).toLowerCase();
      var createdBy = _str_(p.createdBy).toLowerCase();
      var pn = _str_(p.positionNumber).toUpperCase();
      return email.indexOf('@example.gov') > -1 ||
             email.indexOf('@example.com') > -1 ||
             createdBy === 'hc-seed' ||
             /^FC[A-Z]?-\d{4}$/.test(pn);
    });
  }

  /**
   * Compares the feed against what is in HC_Positions.
   *
   * @param {Array} incoming interpreted feed rows
   * @param {Array} existing current positions
   * @returns {Object} { adds, changes, deletes, seedDeletes, unchanged }
   */
  function diffRoster(incoming, existing) {
    var byPn = {};
    (existing || []).forEach(function (p) {
      if (p.positionNumber) byPn[_str_(p.positionNumber)] = p;
    });

    var incomingPns = {};
    var adds = [];
    var changes = [];
    var unchanged = [];

    // Fields whose change is worth reporting. Created_At and the audit columns
    // are excluded: they change on every import by definition and would make
    // every row look modified.
    var COMPARED = ['reportsToPositionNumber', 'employeeId', 'employeeName',
                    'emailAddress', 'orgCode', 'officeTitle', 'grade',
                    'supervisoryStatus', 'occupancyStatus', 'lcat',
                    'locationCode', 'dutyStationCity', 'dutyStationState'];

    (incoming || []).forEach(function (row) {
      if (!row.positionNumber) return;
      incomingPns[row.positionNumber] = true;

      var prior = byPn[row.positionNumber];
      if (!prior) { adds.push(row); return; }

      var fields = [];
      COMPARED.forEach(function (f) {
        var now = _str_(row[f]);
        var before = _str_(prior[f]);
        // Email and org are case-normalised on both sides, so a case-only
        // difference is not a change.
        if (f === 'emailAddress') { now = now.toLowerCase(); before = before.toLowerCase(); }
        if (f === 'orgCode') { now = now.toUpperCase(); before = before.toUpperCase(); }
        if (now !== before) {
          fields.push({ field: f, from: before, to: now });
        }
      });

      if (fields.length) changes.push({ row: row, fields: fields });
      else unchanged.push(row);
    });

    var deletes = (existing || []).filter(function (p) {
      return p.positionNumber && !incomingPns[_str_(p.positionNumber)];
    });
    var seedSet = {};
    identifySeedRows(existing).forEach(function (p) {
      seedSet[_str_(p.positionNumber)] = true;
    });

    return {
      adds: adds,
      changes: changes,
      unchanged: unchanged,
      // Split so the preview can distinguish "removing fictional fixtures"
      // from "removing people the feed no longer lists", which are very
      // different things to confirm.
      seedDeletes: deletes.filter(function (p) { return seedSet[_str_(p.positionNumber)]; }),
      deletes: deletes.filter(function (p) { return !seedSet[_str_(p.positionNumber)]; })
    };
  }

  /**
   * Parses a whole feed read.
   *
   * @param {Array<Array>} values   full range, header row first
   * @param {Object} [orgCodesByCode] HC_Orgs index
   * @returns {Object}
   */
  function parseFeed(values, orgCodesByCode) {
    var out = {
      rows: [], skipped: 0, blocked: [], warnings: [],
      mapping: {}, unmapped: [], headerProblems: [],
      cycles: [], cyclesCleared: 0
    };

    if (!values || values.length < 2) {
      out.headerProblems.push('The feed has no data rows.');
      return out;
    }

    var mapped = proposeMapping(values[0]);
    out.mapping = mapped.mapping;
    out.unmapped = mapped.unmapped;

    if (mapped.missing.length) {
      // REFUSES. See the file header: a wrong guess on supervisoryStatus
      // changes who can sign in, and on orgCode misattributes every dollar.
      out.headerProblems.push(
        'Could not find a column for: ' + mapped.missing.join(', ') +
        '. The import will not run on a partial mapping, because guessing ' +
        'these wrong silently misattributes budget or changes who can access ' +
        'LETS. Columns found in the feed: ' +
        (values[0] || []).map(_str_).filter(Boolean).join(' | '));
      return out;
    }

    var seen = {};
    for (var r = 1; r < values.length; r++) {
      var row = interpretRow(values[r], mapped, r + 1);
      if (!row) { out.skipped++; continue; }

      var checked = validateRow(row, seen, orgCodesByCode);
      if (checked.problems.length) {
        out.blocked.push({ row: row, problems: checked.problems });
        continue;
      }
      if (checked.warnings.length) {
        out.warnings.push({
          positionNumber: row.positionNumber,
          employeeName: row.employeeName,
          warnings: checked.warnings
        });
      }
      out.rows.push(row);
    }

    var cyc = findSupervisorCycles(out.rows);
    out.cycles = cyc.cycles;
    out.cyclesCleared = cyc.cleared;

    return out;
  }

  /**
   * Headcount the imported roster would produce, per service centre.
   *
   * Included in the PREVIEW on purpose. The roster's whole budget consequence
   * is this number, and an admin confirming a replace should see what it does
   * to the allocations before committing — not discover afterwards that a
   * service centre's share moved by a third.
   *
   * Duplicates HCData.hcServiceCentreHeadcount's rule rather than calling it,
   * because that function reads the COMMITTED sheet and this has to count rows
   * that are not written yet.
   *
   * @param {Array} rows interpreted feed rows
   * @param {Array} orgs HC_Orgs records
   * @returns {Object} dac|sc -> counts
   */
  function previewHeadcount(rows, orgs) {
    var byCode = {};
    (orgs || []).forEach(function (o) {
      byCode[_str_(o.orgCode).toUpperCase()] = o;
    });

    function ancestorAtLevel(code, wantLevel) {
      var cursor = _str_(code).toUpperCase();
      // Resolve an unlisted code to its nearest listed ancestor by prefix,
      // the same way HCData.resolveOrgByCode does.
      if (!byCode[cursor]) {
        var best = '';
        Object.keys(byCode).forEach(function (k) {
          if (cursor.indexOf(k) === 0 && k.length > best.length) best = k;
        });
        cursor = best;
      }
      var seen = {};
      var depth = 0;
      while (cursor && byCode[cursor] && !seen[cursor] && depth < 25) {
        seen[cursor] = true;
        if (_str_(byCode[cursor].orgLevel).toUpperCase() === wantLevel) return cursor;
        cursor = _str_(byCode[cursor].parentOrgCode).toUpperCase();
        depth++;
      }
      return '';
    }

    var out = {};
    (rows || []).forEach(function (row) {
      var dac = ancestorAtLevel(row.orgCode, 'DAC') ||
                ancestorAtLevel(row.orgCode, 'AC');
      if (!dac) {
        out.UNATTRIBUTED = out.UNATTRIBUTED ||
          { orgCode: '', dacOrgCode: '', filled: 0, vacant: 0, authorised: 0 };
        out.UNATTRIBUTED.authorised++;
        if (row.occupancyStatus === 'FILLED') out.UNATTRIBUTED.filled++;
        else out.UNATTRIBUTED.vacant++;
        return;
      }
      var sc = ancestorAtLevel(row.orgCode, 'SERVICE_CENTER');
      var key = dac + '|' + sc;
      if (!out[key]) {
        out[key] = {
          orgCode: sc, dacOrgCode: dac,
          filled: 0, vacant: 0, authorised: 0
        };
      }
      out[key].authorised++;
      if (row.occupancyStatus === 'FILLED') out[key].filled++;
      else out[key].vacant++;
    });

    return out;
  }

  return {
    FIELD_HINTS: FIELD_HINTS,
    REQUIRED_FIELDS: REQUIRED_FIELDS,
    proposeMapping: proposeMapping,
    normalizeGrade: normalizeGrade,
    normalizeSupervisoryStatus: normalizeSupervisoryStatus,
    normalizeOccupancy: normalizeOccupancy,
    interpretRow: interpretRow,
    validateRow: validateRow,
    findSupervisorCycles: findSupervisorCycles,
    identifySeedRows: identifySeedRows,
    diffRoster: diffRoster,
    parseFeed: parseFeed,
    previewHeadcount: previewHeadcount
  };
})();

// Node/CommonJS export for the test suite. Inert in Apps Script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HCRosterImport;
}
