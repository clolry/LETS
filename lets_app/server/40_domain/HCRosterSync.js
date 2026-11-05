/**
 * HCRosterSync.js
 * Entry points for loading the real HR roster from the FAS HRLinks feed.
 *
 * Split from 30_services/HCRosterImport.js deliberately: that file is pure —
 * no spreadsheet, no clock, no session — so every mapping, normalization and
 * diff decision is testable without Apps Script. This file is the part that
 * touches the world, and it is kept thin for the same reason.
 *
 * TWO STEPS, NOT ONE
 * ------------------
 * previewRosterImport reports what WOULD happen. importRoster does it, and
 * refuses unless handed the preview's own token back.
 *
 * The import REPLACES HC_Positions, including deleting rows. @clolry asked for
 * all test records removed, and a merge cannot do that — nothing in the feed
 * matches a fictional person, so they would survive forever. But a replace
 * that silently drops real people is worse than a stale roster, and the
 * roster drives approval routing, site access and every budget allocation.
 *
 * So the destructive step cannot be reached without seeing the numbers first.
 * BudgetBackfill uses the same confirm-then-act shape for the same reason.
 *
 * WHY THE PREVIEW SHOWS HEADCOUNT
 * -------------------------------
 * Because that is the roster's entire budget consequence. The per-capita split
 * divides each DAC's discretionary balance by its share of filled positions,
 * so replacing the roster moves money between service centers. An admin
 * confirming this should see that before committing, not discover it after.
 */

/**
 * Finds a tab by name, tolerating the ways a sheet name goes wrong.
 *
 * getSheetByName is EXACT. Three things defeat it in practice, and the old
 * HRLinks workbook demonstrated one of them: its tab list included
 * 'NEW - NTE REPORT ' with a trailing space. A name typed into a Script
 * Property without noticing that space fails, and the error reads as "the tab
 * does not exist" when it plainly does.
 *
 * So: exact first, then trimmed, then case-insensitive on the trimmed form.
 *
 * WHY NOT FUZZY. There is no partial or prefix matching. In that workbook
 * 'FAS' must not have resolved to 'FAS Recruit Data from STAR' — a different
 * tab, different columns, and importing it would have produced a roster of the
 * wrong people. A near-miss here is a silently wrong roster, which is the
 * failure this whole module is shaped against, so the tolerance stops at
 * whitespace and case.
 *
 * @param {Spreadsheet} ss
 * @param {string} wanted
 * @returns {Sheet|null}
 */
function _findFeedTab_(ss, wanted) {
  var want = String(wanted || '').trim();
  if (!want) return null;

  var exact = ss.getSheetByName(want);
  if (exact) return exact;

  var sheets = ss.getSheets();
  var i;

  // Trailing/leading whitespace on EITHER side.
  for (i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim() === want) return sheets[i];
  }

  // Case differences.
  var lower = want.toLowerCase();
  for (i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === lower) return sheets[i];
  }

  return null;
}

/**
 * Reports which HR feed source this DEPLOYMENT is actually reading, and how
 * its columns would map.
 *
 * WHY THIS EXISTS
 * ---------------
 * previewRosterImport once failed twice with the same message — Tab
 * "FAS_HRLinks_Feed" was not found — the second time AFTER the default had
 * been fixed on the sandbox branch. The code running in Apps Script was an
 * older deploy, which is invisible from inside the editor: the log looks
 * identical whether the default is wrong or the deployment is stale.
 *
 * Diagnosing that cost a round trip. This function makes the question
 * answerable in one run: it prints the resolved source, the property values,
 * the tab names actually present, and a VERSION MARKER that only exists in
 * this revision. If the marker is absent from the output, the deployment is
 * behind the repository and nothing else in the output can be trusted.
 *
 * WHY IT ALSO PRINTS THE MAPPING AND SAMPLE VALUES
 * ------------------------------------------------
 * The source changed. @clolry replaced the FAS HRLinks feed with an FC-only
 * workforce report that carries an email column, and its headers are
 * different — 'Employee Position Number' rather than 'Position#', 'Supv Lvl'
 * rather than 'Supv Status', and a plain 'Grade' rather than the composite
 * 'PP-Series-Grd'.
 *
 * Two of those decide things that fail SILENTLY if guessed wrong:
 *
 *   Supv Lvl             Access.js:435 admits anyone whose Supervisory_Status
 *                        is '2'. The old feed's 'Supv Status' held HR's
 *                        numeric codes. A column named 'Supv Lvl' sitting
 *                        beside 'Supervisor Level Desc.' may hold the same
 *                        codes or may hold something else entirely, and
 *                        mapping it wrong either admits the wrong people or
 *                        locks out every supervisor.
 *   Position Status Type The per-capita denominator. 'OBLIGATED' in this
 *                        vocabulary is a person's permanent seat held open
 *                        during a temp promotion, so counting it as filled
 *                        double-counts six people.
 *
 * So this prints the DISTINCT VALUES of each, with counts, from the real
 * sheet. That is the evidence needed to map them — and it is the pattern that
 * has caught more in this project than any test: @clolry's live output found
 * the eight Halls, the org suffix on surnames, and what OBLIGATED means.
 *
 * Reads nothing from LETS and writes nothing. Safe to run at any time.
 *
 * @returns {Object}
 * @editor
 */
function diagnoseHrFeedSource() {
  // Bumped whenever the resolution logic changes. Its only job is to prove
  // which revision is deployed.
  var MARKER = 'hr-feed-diag-v3-fc-workforce-report';

  var out = {
    marker: MARKER,
    propertyKeys: {
      id: PROPS_KEYS.FC_WF_FEED,
      tab: PROPS_KEYS.FC_WF_FEED_TAB
    },
    propertyValues: {},
    resolved: null,
    tabsPresent: [],
    tabResolves: false,
    notes: []
  };

  try {
    var props = PropertiesService.getScriptProperties();
    var rawId = props.getProperty(PROPS_KEYS.FC_WF_FEED);
    var rawTab = props.getProperty(PROPS_KEYS.FC_WF_FEED_TAB);
    out.propertyValues[PROPS_KEYS.FC_WF_FEED] =
      rawId ? ('set, ' + String(rawId).length + ' chars') : 'NOT SET';
    // The tab name is shown verbatim and quoted, because a trailing space is
    // invisible otherwise and a real workbook had exactly that.
    out.propertyValues[PROPS_KEYS.FC_WF_FEED_TAB] =
      rawTab === null ? 'NOT SET (there is no default — see the error below)'
                      : JSON.stringify(rawTab);

    // THE OLD KEYS MUST BE GONE. Leaving them set is harmless to the code,
    // which no longer reads them, and misleading to a human reading Project
    // Settings — two HR feed properties with no way to tell which is live.
    ['FAS_HRLinks_Feed', 'FAS_HRLinks_Feed_Tab'].forEach(function (dead) {
      if (props.getProperty(dead) !== null) {
        out.notes.push('Script Property "' + dead + '" is still set and is no ' +
                       'longer read by anything. Delete it, so Project ' +
                       'Settings does not show two HR sources.');
      }
    });
  } catch (e) {
    out.notes.push('Could not read Script Properties: ' + e.message);
  }

  var source = getFcWorkforceFeedSource();
  out.resolved = {
    ok: source.ok,
    spreadsheetId: source.spreadsheetId,
    tabName: source.tabName,
    error: source.error
  };

  // A MISSING TAB STILL LISTS THE WORKBOOK'S TABS. That is the one piece of
  // information needed to fix a missing tab name, and refusing to open the
  // workbook because the tab is unset would withhold it.
  if (!source.ok && !source.spreadsheetId) {
    out.notes.push(source.error);
    console.log(JSON.stringify(out, null, 2));
    return out;
  }
  if (!source.ok) out.notes.push(source.error);

  try {
    var ss = SpreadsheetApp.openById(source.spreadsheetId);
    out.spreadsheetName = ss.getName();
    out.tabsPresent = ss.getSheets().map(function (s) {
      var n = s.getName();
      return {
        // Quoted so whitespace is visible.
        name: JSON.stringify(n),
        rows: s.getLastRow(),
        columns: s.getLastColumn()
      };
    });

    var found = source.tabName ? _findFeedTab_(ss, source.tabName) : null;
    out.tabResolves = !!found;

    if (!found) {
      out.notes.push(source.tabName
        ? ('Tab "' + source.tabName + '" does not resolve. Set ' +
           PROPS_KEYS.FC_WF_FEED_TAB + ' to one of the names above, copied ' +
           'exactly.')
        : ('Set ' + PROPS_KEYS.FC_WF_FEED_TAB + ' to whichever tab above ' +
           'holds the roster, then re-run this.'));
      console.log(JSON.stringify(out, null, 2));
      return out;
    }

    out.notes.push('Tab resolved to "' + found.getName() + '" with ' +
                   found.getLastRow() + ' rows and ' +
                   found.getLastColumn() + ' columns.');

    if (found.getLastColumn() < 1 || found.getLastRow() < 2) {
      out.notes.push('That tab has no data rows, so there is nothing to map.');
      console.log(JSON.stringify(out, null, 2));
      return out;
    }

    // Header row, quoted. A header that wraps in the sheet arrives with an
    // embedded newline — 'Employee\nID' — and unquoted that is invisible and
    // reads as a mapping bug.
    var headers = found.getRange(1, 1, 1, found.getLastColumn())
      .getValues()[0].map(function (h) { return String(h); });
    out.headerRow = headers;
    out.headerCount = headers.length;

    // WHAT WOULD MAP, AND WHAT WOULD NOT.
    var mapped = HCRosterImport.proposeMapping(headers);
    out.mapping = mapped.mapping;
    out.unmappedHeaders = mapped.unmapped;
    out.missingRequired = mapped.missing;
    if (mapped.missing.length) {
      out.notes.push('REQUIRED field(s) unmapped: ' + mapped.missing.join(', ') +
                     '. The import refuses in this state, which is correct — ' +
                     'add the real header spelling to FIELD_HINTS in ' +
                     '30_services/HCRosterImport.js.');
    }

    // DISTINCT VALUES for the two columns that fail silently. Sampled over up
    // to 2,000 rows, which covers this roster.
    //
    // Reported for the field whether or not it mapped: when it did not map,
    // the values are how to decide what it is. A column read as a name is
    // useless; a column shown to hold {2, 4, 5, 8} is a supervisory code.
    var lastRow = Math.min(found.getLastRow(), 2001);
    var body = found.getRange(2, 1, lastRow - 1, headers.length).getValues();
    out.rowsSampled = body.length;

    function _distinct_(headerName, cap) {
      var col = -1;
      for (var h = 0; h < headers.length; h++) {
        if (headers[h] === headerName) { col = h; break; }
      }
      if (col === -1) return null;
      var counts = {};
      for (var r = 0; r < body.length; r++) {
        var v = body[r][col];
        var key = (v === null || v === undefined || v === '')
          ? '(blank)' : String(v).trim();
        if (key === '') key = '(blank)';
        counts[key] = (counts[key] || 0) + 1;
      }
      var keys = Object.keys(counts).sort(function (a, b) {
        return counts[b] - counts[a];
      });
      var outv = {};
      keys.slice(0, cap || 25).forEach(function (k) { outv[k] = counts[k]; });
      if (keys.length > (cap || 25)) {
        outv['… and ' + (keys.length - (cap || 25)) + ' more'] = 0;
      }
      return { column: headerName, distinctCount: keys.length, values: outv };
    }

    // The vocabularies that decide site access and the budget denominator.
    out.distinctValues = {};
    ['Supv Lvl', 'Supervisor\nLevel Desc.', 'Position Status Type',
     'PP', 'Grade', 'Type Appt Desc', 'Work\nSchedule'
    ].forEach(function (h) {
      var d = _distinct_(h, 25);
      if (d) out.distinctValues[h] = d;
    });

    // EMAIL COVERAGE, straight off the column, because the whole reason this
    // source replaced the last one is that it has addresses. If coverage is
    // not ~100% the directory removal needs reconsidering, and that is better
    // known now than after 5,100 lines are deleted.
    var emailCol = -1;
    var nameCol = -1;
    for (var hh = 0; hh < headers.length; hh++) {
      if (headers[hh] === 'Employee Email') emailCol = hh;
      if (headers[hh] === 'Name') nameCol = hh;
    }
    if (emailCol > -1) {
      var withEmail = 0, named = 0, blankEmail = 0, notAnAddress = 0;
      for (var br = 0; br < body.length; br++) {
        var nm = nameCol > -1 ? String(body[br][nameCol] || '').trim() : '';
        if (nameCol > -1 && !nm) continue;        // unoccupied/spacer row
        named++;
        var em = String(body[br][emailCol] || '').trim();
        if (!em) blankEmail++;
        else if (em.indexOf('@') === -1) notAnAddress++;
        else withEmail++;
      }
      out.emailCoverage = {
        namedRows: named,
        withEmail: withEmail,
        blank: blankEmail,
        notAnAddress: notAnAddress,
        verdict: (blankEmail + notAnAddress) === 0
          ? 'Every named row has an address. The directory lookup is ' +
            'genuinely unnecessary.'
          : ((blankEmail + notAnAddress) + ' named row(s) have no usable ' +
             'address. Worth seeing before the directory lookup is deleted.')
      };
    }

    // DUPLICATE POSITION NUMBERS would BLOCK rows at import. This source has
    // a 'Record Date' column, which suggests it may be a dated snapshot — and
    // if it ever carries more than one snapshot, every position appears twice
    // and validateRow blocks the lot. Counted here rather than discovered
    // during an import.
    var pnCol = -1, recCol = -1;
    for (var ph = 0; ph < headers.length; ph++) {
      if (headers[ph] === 'Employee Position Number') pnCol = ph;
      if (headers[ph] === 'Record Date') recCol = ph;
    }
    if (pnCol > -1) {
      var seen = {}, dupes = 0, blankPn = 0;
      for (var pr = 0; pr < body.length; pr++) {
        var pv = String(body[pr][pnCol] || '').trim();
        if (!pv) { blankPn++; continue; }
        if (seen[pv]) dupes++;
        else seen[pv] = true;
      }
      out.positionNumbers = {
        distinct: Object.keys(seen).length,
        duplicateRows: dupes,
        blank: blankPn,
        verdict: dupes === 0
          ? 'No duplicate position numbers.'
          : (dupes + ' row(s) repeat a position number. validateRow BLOCKS a ' +
             'duplicate, because the later row wins every lookup and makes ' +
             'the earlier person invisible. If this sheet holds more than one ' +
             'Record Date, the import needs to filter to the latest.')
      };
    }
    if (recCol > -1) {
      var d2 = _distinct_('Record Date', 10);
      if (d2) out.recordDates = d2;
    }
  } catch (e) {
    out.notes.push('Could not read the spreadsheet: ' + e.message +
                   ' — check the ID and that this account has read access.');
  }

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * Dry run: what importing the feed would change.
 *
 * Reads the feed, compares it to HC_Positions, and returns the adds, changes,
 * deletions and the resulting service-center headcount — plus a token that
 * importRoster requires.
 *
 * @returns {Object} successResponse({ ... }) | errorResponse
 * @client
 * @editor  Run this from the editor before importing. Admin-only either way.
 */
function previewRosterImport(opts) {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  // The Run button passes no arguments, so `opts` is undefined in the normal
  // case and the preview logs — which is the whole point of it.
  var quiet = !!(opts && opts.quiet);

  try {
    var source = getFcWorkforceFeedSource();
    if (!source.ok) {
      // NO FALLBACK. See HCRosterImport.js's header: every available fallback
      // is a stale roster, and a stale roster produces allocations that look
      // precise and are wrong.
      return errorResponse(source.error);
    }

    var values;
    try {
      var ss = SpreadsheetApp.openById(source.spreadsheetId);
      var sheet = _findFeedTab_(ss, source.tabName);
      if (!sheet) {
        var names = ss.getSheets().map(function (s) { return s.getName(); });
        return errorResponse(
          'Tab "' + source.tabName + '" was not found in the HR feed.\n' +
          'Tabs present: ' + names.map(function (n) {
            return '"' + n + '"';
          }).join(', ') + '\n' +
          'FIX: set the Script Property ' + PROPS_KEYS.FC_WF_FEED_TAB +
          ' to one of those names, copied exactly.\n' +
          'Run diagnoseHrFeedSource() for the row and column counts of each, ' +
          'plus the header row of whichever one you pick.');
      }

      // READ ONLY THE MAPPED COLUMNS' WORTH OF WIDTH, not getDataRange().
      //
      // This is a live HR export — 46 columns and a row per position.
      // getDataRange() on a sheet that wide and long is the likeliest way
      // this hits the 6-minute execution limit or the 50MB payload cap — and
      // it would do so AFTER reading everything, wasting the whole run.
      //
      // getLastRow()/getLastColumn() bound it explicitly so the failure, if
      // it comes, is a clear "too many rows" rather than a timeout.
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow < 2) {
        return errorResponse(
          'Tab "' + source.tabName + '" has no data rows (last row ' +
          lastRow + ').');
      }
      values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    } catch (e) {
      return errorResponse(
        'Could not open the HR feed (' + source.spreadsheetId + '): ' +
        e.message + '. The LETS service account needs at least read access.');
    }

    var orgs = HC.hcGetOrgHierarchy() || [];
    var orgsByCode = {};
    orgs.forEach(function (o) {
      orgsByCode[String(o.orgCode || '').toUpperCase()] = o;
    });

    // HC_Orgs MUST CARRY Org_Level, or the roster imports fine and every
    // budget figure derived from it is silently zero.
    //
    // The per-capita split works by walking each position's stored parent
    // chain to the nearest row whose Org_Level is 'SERVICE_CENTER'. With
    // HC_Orgs holding only the four seed rows — which have no Org_Level and no
    // Parent_Org_Code at all — that walk finds nothing, so all 22 service
    // centers read zero and every allocation is undefined.
    //
    // @clolry's first live preview showed exactly this: 1,046 importable
    // positions, 817 filled, and "service centers 0". The roster was right and
    // the denominator did not exist. Checked HERE rather than after the import
    // because the symptom appears on the budget page, two steps removed from
    // the cause.
    var levelled = orgs.filter(function (o) {
      return String(o.orgLevel || '').trim();
    }).length;
    var serviceCenters = orgs.filter(function (o) {
      return String(o.orgLevel || '').toUpperCase() === 'SERVICE_CENTER';
    }).length;

    var scope = getHrOrgScope();
    var parsed = HCRosterImport.parseFeed(values, orgsByCode, { orgScope: scope });
    if (parsed.headerProblems.length) {
      console.error(parsed.headerProblems.join('\n'));
      return { success: false, problems: parsed.headerProblems };
    }

    var bundle = HC.hcGetBundle();
    var existing = bundle.success ? bundle.data : [];

    var diff = HCRosterImport.diffRoster(parsed.rows, existing);
    var headcount = HCRosterImport.previewHeadcount(parsed.rows, orgs);

    // The token binds a confirmation to THIS preview. Without it an admin
    // could preview a sane feed, the feed could change, and the confirm would
    // apply something nobody looked at.
    var token = 'roster_' + Date.now() + '_' + parsed.rows.length + '_' +
                diff.adds.length + 'a' + diff.changes.length + 'c' +
                (diff.deletes.length + diff.seedDeletes.length) + 'd';

    var payload = {
      token: token,
      source: {
        spreadsheetId: source.spreadsheetId,
        tabName: source.tabName,
        // Stated so a reader can confirm the roster did NOT come from the May
        // spreadsheet, which is the error this whole module exists to prevent.
        propertyKey: PROPS_KEYS.FC_WF_FEED
      },
      mapping: parsed.mapping,
      unmappedColumns: parsed.unmapped,
      // WHICH ORG THIS IMPORT IS LIMITED TO. The FC workforce report should
      // already be FC-only, so outOfScope is expected to be 0 — and reporting
      // it is how that expectation gets checked rather than assumed.
      orgScope: parsed.orgScope,
      scopeNote: parsed.scopeNote,
      outOfScopeByPrefix: parsed.outOfScopeByPrefix,
      // The org hierarchy the per-capita split depends on. Reported even when
      // healthy, so "service centers 0" is never ambiguous between "no
      // hierarchy loaded" and "no staff matched".
      orgHierarchy: {
        rows: orgs.length,
        withOrgLevel: levelled,
        serviceCenters: serviceCenters,
        ready: serviceCenters > 0
      },
      // Admin-resolved email addresses that the import will RE-APPLY. Shown
      // because the alternative — an admin seeing "1,046 rows replaced" and
      // wondering whether their corrections survive — is a question the
      // preview should answer before it is asked.
      emailOverrides: (function () {
        try {
          var o = readEmailOverrides();
          var withEmail = 0;
          Object.keys(o).forEach(function (k) { if (o[k].email) withEmail++; });
          return {
            stored: Object.keys(o).length,
            withAddress: withEmail,
            note: Object.keys(o).length
              ? (withEmail + ' admin-resolved address(es) will be re-applied ' +
                 'after the import, so they are not lost.')
              : 'No admin-resolved addresses are stored yet.'
          };
        } catch (e2) {
          return { stored: null, withAddress: null,
                   note: 'Could not read the override tab: ' + e2.message };
        }
      })(),
      counts: {
        feedRows: values.length - 1,
        outOfScope: parsed.outOfScope,
        noOrgCode: parsed.noOrgCode,
        positions: parsed.rows.length,
        skippedNonPositions: parsed.skipped,
        blocked: parsed.blocked.length,
        warnings: parsed.warnings.length,
        adds: diff.adds.length,
        changes: diff.changes.length,
        unchanged: diff.unchanged.length,
        deletes: diff.deletes.length,
        seedDeletes: diff.seedDeletes.length,
        currentPositions: existing.length,
        supervisorCyclesCleared: parsed.cyclesCleared
      },
      // Capped. A 900-row roster's full diff would exceed the 50MB RPC limit
      // and nobody reads 900 rows in a dialog; the counts above are the
      // decision and these are the evidence.
      blocked: parsed.blocked.slice(0, 50),
      warnings: parsed.warnings.slice(0, 50),
      changes: diff.changes.slice(0, 100),
      deletes: diff.deletes.slice(0, 100).map(function (p) {
        return {
          positionNumber: p.positionNumber,
          employeeName: p.employeeName,
          orgCode: p.orgCode
        };
      }),
      seedDeletes: diff.seedDeletes.map(function (p) {
        return {
          positionNumber: p.positionNumber,
          employeeName: p.employeeName,
          emailAddress: p.emailAddress
        };
      }),
      supervisorCycles: parsed.cycles.slice(0, 20),
      // THE FEED HAS NO EMAIL COLUMN. Surfaced as its own block rather than
      // buried in warnings, because Access.js matches the signed-in user
      // against Email_Address — importing a roster with none costs every
      // supervisor their automatic route into LETS.
      emailCoverage: parsed.emailCoverage,
      // The feed has two status columns and occupancy is taken from one of
      // them. A large disagreement count means the wrong one was chosen, and
      // that moves every per-capita share.
      occupancyDisagreement: parsed.occupancyDisagreement,
      // People holding two positions — a temp promotion plus their permanent
      // seat held open as OBLIGATED. Benign, because the split counts FILLED
      // only, but `doubleCounted` must be zero or the denominator is wrong.
      duplicatePeople: parsed.duplicatePeople,
      headcount: headcount,
      notes: _rosterPreviewNotes_(parsed, diff, existing)
    };

    // LOGGED, NOT JUST RETURNED.
    //
    // Run from the editor's Run button, a returned object goes nowhere — the
    // execution log showed only the TravelDB reads and "Execution completed",
    // so @clolry ran this and saw nothing. The whole point of a dry run is
    // that a human reads it before confirming a destructive import, and a
    // dry run whose output is invisible is worse than none: it looks like it
    // succeeded.
    if (!quiet) _logRosterPreview_(payload);
    return successResponse(payload);
  } catch (e) {
    console.error('previewRosterImport failed: ' + e.message);
    return errorResponse('Could not preview the roster import: ' + e.message);
  }
}

/**
 * Prints the preview to the execution log, decision-first.
 *
 * Ordered by what stops an import, not by what is easy to format: the scope
 * note, then the counts, then the things that change who can sign in, then
 * the headcount that moves the budget. The confirmation token is last,
 * because reading everything above it is the point of the exercise.
 */
function _logRosterPreview_(p) {
  var L = [];
  var c = p.counts;

  L.push('=== previewRosterImport — NOTHING HAS BEEN WRITTEN ===');
  L.push('source: ' + p.source.tabName + ' tab of the sheet in ' +
         p.source.propertyKey);
  L.push('');
  L.push('SCOPE');
  L.push('  ' + p.scopeNote);
  L.push('');
  L.push('COUNTS');
  L.push('  feed rows              ' + c.feedRows);
  L.push('  out of scope           ' + c.outOfScope);
  L.push('  no org code            ' + c.noOrgCode);
  L.push('  non-position rows      ' + c.skippedNonPositions);
  L.push('  blocked by validation  ' + c.blocked);
  L.push('  -> importable          ' + c.positions);
  L.push('');
  L.push('CHANGES TO HC_Positions (currently ' + c.currentPositions + ' rows)');
  L.push('  add                    ' + c.adds);
  L.push('  change                 ' + c.changes);
  L.push('  unchanged              ' + c.unchanged);
  L.push('  remove, fictional      ' + c.seedDeletes);
  L.push('  remove, NOT test data  ' + c.deletes +
         (c.deletes ? '   <-- CHECK THIS' : ''));
  L.push('');

  if (p.emailCoverage) {
    L.push('EMAIL / LETS ACCESS');
    L.push('  ' + p.emailCoverage.impact);
    L.push('');
  }

  if (p.occupancyDisagreement &&
      (p.occupancyDisagreement.conflicts ||
       p.occupancyDisagreement.comparable === false)) {
    L.push('OCCUPANCY CROSS-CHECK');
    L.push('  ' + p.occupancyDisagreement.note);
    L.push('');
  }

  var dp = p.duplicatePeople;
  if (dp && dp.peopleWithMultiplePositions) {
    L.push('PEOPLE HOLDING TWO POSITIONS');
    L.push('  ' + dp.note);
    if (dp.doubleCounted) {
      dp.doubleCountedSamples.forEach(function (e) {
        L.push('  DOUBLE-COUNTED: ' + e.employeeName + ' — ' +
               e.positions.map(function (x) {
                 return x.positionNumber + ' ' + x.orgCode + ' ' +
                        x.occupancyStatus;
               }).join('; '));
      });
    }
    L.push('');
  }

  var filled = 0;
  var scTotal = 0;
  Object.keys(p.headcount || {}).forEach(function (k) {
    filled += p.headcount[k].filled;
    if (p.headcount[k].orgCode) scTotal++;
  });
  L.push('HEADCOUNT — the per-capita budget denominator');
  L.push('  filled positions       ' + filled);
  L.push('  service centers        ' + scTotal);

  // A ZERO HERE HAS TWO VERY DIFFERENT CAUSES and the number alone cannot
  // tell them apart: either HC_Orgs has no hierarchy to roll up to, or the
  // roster matched none of it. The first is a missing setup step; the second
  // would mean the org codes disagree. Naming which one it is saves a
  // diagnostic round trip.
  var oh = p.orgHierarchy || {};
  if (!scTotal) {
    if (!oh.serviceCenters) {
      L.push('');
      L.push('  BLOCKED: HC_Orgs holds ' + (oh.rows || 0) + ' row(s), ' +
             (oh.withOrgLevel || 0) + ' with an Org_Level, and 0 service ' +
             'centers. The per-capita split walks each position\'s parent ' +
             'chain to the nearest SERVICE_CENTER row, so it has nothing to ' +
             'roll up to and every allocation would be zero.');
      L.push('  FIX: run hcLoadRealOrgCodes() in 40_domain/HCAdmin.js — it ' +
             'loads the 137 real ASD org codes with their parents and levels. ' +
             'Then re-run this preview.');
    } else {
      L.push('');
      L.push('  WARNING: HC_Orgs has ' + oh.serviceCenters + ' service ' +
             'center(s) but no imported position rolls up to any of them. ' +
             'The roster\'s org codes and HC_Orgs disagree.');
    }
  }
  L.push('');

  if ((p.blocked || []).length) {
    L.push('FIRST BLOCKED ROWS');
    p.blocked.slice(0, 10).forEach(function (b) {
      L.push('  row ' + b.row.sourceRow + ' ' + b.row.employeeName + ': ' +
             b.problems.join(' | '));
    });
    L.push('');
  }

  (p.notes || []).forEach(function (n) { L.push('NOTE: ' + n); });
  L.push('');
  L.push('To apply, call importRoster with this token:');
  L.push('  ' + p.token);

  console.log(L.join('\n'));
}

/**
 * The per-service-center headcount, as a readable table.
 *
 * SEPARATE FROM THE PREVIEW BECAUSE OF THE LOG LIMIT. @clolry's run printed
 * "Logging output too large. Truncating output." and the headcount — the one
 * block the budget depends on — was the thing cut off, because it sits last in
 * a payload containing 1,046 positions' worth of diff.
 *
 * So this prints only the table, in about 30 lines. It re-runs the preview
 * rather than taking a payload, because a function that needs an argument
 * cannot be run from the editor's Run button at all.
 *
 * @editor
 */
function showServiceCenterHeadcount() {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  var r = previewRosterImportQuiet();
  if (!r || r.success !== true) {
    console.log(JSON.stringify(r, null, 2));
    return r;
  }

  var hc = r.data.headcount || {};
  var orgs = HC.hcGetOrgHierarchy() || [];
  var nameByCode = {};
  orgs.forEach(function (o) {
    nameByCode[String(o.orgCode || '').toUpperCase()] = o.division || '';
  });

  // Grouped by DAC, because that is the pool each per-capita share divides.
  var byDac = {};
  Object.keys(hc).forEach(function (key) {
    var b = hc[key];
    if (!byDac[b.dacOrgCode]) byDac[b.dacOrgCode] = [];
    byDac[b.dacOrgCode].push(b);
  });

  var L = [];
  L.push('=== Service-center headcount (FILLED positions) ===');
  L.push('');
  L.push('DAC   Org code  Filled  Vacant  Share   Service center');

  var grandFilled = 0;
  Object.keys(byDac).sort().forEach(function (dac) {
    var list = byDac[dac];
    var dacFilled = list.reduce(function (s, b) { return s + b.filled; }, 0);
    grandFilled += dacFilled;

    list.sort(function (a, b) {
      // Above-service-center staff lead their DAC's block.
      if (!a.orgCode !== !b.orgCode) return a.orgCode ? 1 : -1;
      return a.orgCode < b.orgCode ? -1 : 1;
    }).forEach(function (b) {
      var share = dacFilled ? (b.filled / dacFilled * 100) : 0;
      L.push(
        _pad_(dac, 6) +
        _pad_(b.orgCode || '—', 10) +
        _lpad_(String(b.filled), 6) + '  ' +
        _lpad_(String(b.vacant), 6) + '  ' +
        _lpad_(share.toFixed(2) + '%', 7) + ' ' +
        (b.orgCode ? (nameByCode[b.orgCode] || '') : '(above service-center level)'));
    });
    L.push(_pad_(dac, 6) + _pad_('TOTAL', 10) + _lpad_(String(dacFilled), 6));
    L.push('');
  });

  L.push('ASD total filled: ' + grandFilled);
  L.push('');
  L.push('These are counts only — no names, no emails. The per-capita split ' +
         'divides each DAC\'s discretionary balance by its share column above.');
  console.log(L.join('\n'));
  return r.data.headcount;
}

function _pad_(v, n) {
  var s = String(v);
  while (s.length < n) s += ' ';
  return s;
}

function _lpad_(v, n) {
  var s = String(v);
  while (s.length < n) s = ' ' + s;
  return s;
}

/**
 * previewRosterImport without the log output.
 *
 * Used by showServiceCenterHeadcount, which prints its own table and would
 * otherwise emit the full preview above it — pushing the table past the log
 * limit, which is the problem it exists to solve.
 *
 * An OPTION, not a reassignment of _logRosterPreview_. My first version
 * swapped the logger out and restored it in a finally block, which works
 * because Apps Script function declarations are mutable globals — and is a
 * trap: two concurrent executions share those globals, so one run could
 * silence the other's output, or restore a stale reference. A parameter cannot
 * do that.
 */
function previewRosterImportQuiet() {
  return previewRosterImport({ quiet: true });
}

/**
 * The sentences an admin needs before confirming.
 *
 * Built here rather than in the client so the warnings cannot be styled away,
 * and so the same text appears in the execution log.
 */
function _rosterPreviewNotes_(parsed, diff, existing) {
  var notes = [];

  if (diff.seedDeletes.length) {
    notes.push(diff.seedDeletes.length + ' fictional test positions will be ' +
               'removed. These are HCSeed.js fixtures with @example.gov ' +
               'addresses — they are currently what the per-capita budget ' +
               'split, the org chart and the supervisor access gate read.');
  }

  if (diff.deletes.length) {
    // THE ONE THAT MATTERS. A real person missing from the feed loses their
    // LETS access and their org's headcount share.
    notes.push(diff.deletes.length + ' position(s) that are NOT test data ' +
               'will be removed, because the feed no longer lists them. ' +
               'Check this number: anyone removed loses supervisor-based LETS ' +
               'access and stops counting toward their org\'s per-capita ' +
               'budget share.');
  }

  if (parsed.blocked.length) {
    notes.push(parsed.blocked.length + ' feed row(s) cannot be imported and ' +
               'will be skipped. Duplicate position numbers and missing org ' +
               'codes are the usual causes.');
  }

  if (parsed.cyclesCleared) {
    notes.push(parsed.cyclesCleared + ' position(s) are in a supervisor cycle ' +
               '(A reports to B reports to A). They will be imported with ' +
               'their supervisor pointer CLEARED, because a cycle hangs every ' +
               'page that walks the chain. Their budget attribution is ' +
               'unaffected; approval routing for them needs fixing in the feed.');
  }

  // THE EMAIL GAP, stated before the headcount because it is the one thing in
  // this preview that makes the system worse in one respect while making it
  // better overall. An admin must not discover it after confirming.
  if (parsed.emailCoverage && parsed.emailCoverage.impact) {
    notes.push(parsed.emailCoverage.impact);
  }

  // Printed whether or not there are conflicts, because "the second column is
  // not an occupancy column" is the useful finding and it produces ZERO
  // conflicts. Suppressing it on a zero count would hide the confirmation
  // that the right column was chosen.
  if (parsed.occupancyDisagreement &&
      (parsed.occupancyDisagreement.conflicts ||
       parsed.occupancyDisagreement.comparable === false)) {
    notes.push(parsed.occupancyDisagreement.note);
  }

  // Only when it is a PROBLEM. The benign case — a temp promotion beside an
  // obligated permanent seat — is already handled by counting FILLED only,
  // and repeating it as a note on every run would train a reader to skip the
  // notes block.
  if (parsed.duplicatePeople && parsed.duplicatePeople.doubleCounted) {
    notes.push(parsed.duplicatePeople.note);
  }

  var filled = 0;
  parsed.rows.forEach(function (r) {
    if (r.occupancyStatus === 'FILLED') filled++;
  });
  notes.push(filled + ' of ' + parsed.rows.length + ' positions are FILLED. ' +
             'That is the number the per-capita budget split divides by — ' +
             'vacant seats do not travel, so every service center\'s share ' +
             'will move when this is applied.');

  if (!existing.length) {
    notes.push('HC_Positions is currently empty, so nothing will be removed.');
  }

  return notes;
}

/**
 * Applies the import. Destructive: replaces every row in HC_Positions.
 *
 * @param {string} token the token from previewRosterImport
 * @returns {Object} successResponse({ ... }) | errorResponse
 * @client
 * @editor  Needs the token from previewRosterImport, so call it from a
 *          one-line wrapper rather than the Run dropdown.
 */
function importRoster(token) {
  var denied = _hcAdminGuard_();
  if (denied) return denied;

  // CONFIRMATION IS MANDATORY. This deletes HR rows that drive site access and
  // budget attribution, so it cannot be reachable by a bare call.
  if (!token || String(token).indexOf('roster_') !== 0) {
    return errorResponse(
      'A confirmation token from previewRosterImport is required. This ' +
      'replaces every row in HC_Positions, including deletions, so it cannot ' +
      'run without the preview having been seen.');
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(typeof LOCK_TIMEOUT_MS !== 'undefined' ? LOCK_TIMEOUT_MS : 30000);
  } catch (e) {
    return errorResponse('Another HR edit is in progress. Try again in a moment.');
  }

  try {
    var source = getFcWorkforceFeedSource();
    if (!source.ok) return errorResponse(source.error);

    var ss = SpreadsheetApp.openById(source.spreadsheetId);
    var feedSheet = _findFeedTab_(ss, source.tabName);
    if (!feedSheet) {
      return errorResponse('Tab "' + source.tabName + '" not found in the HR feed.');
    }
    var lastRow = feedSheet.getLastRow();
    var lastCol = feedSheet.getLastColumn();
    if (lastRow < 2) {
      return errorResponse('Tab "' + source.tabName + '" has no data rows.');
    }
    var values = feedSheet.getRange(1, 1, lastRow, lastCol).getValues();

    var orgs = HC.hcGetOrgHierarchy() || [];
    var orgsByCode = {};
    orgs.forEach(function (o) {
      orgsByCode[String(o.orgCode || '').toUpperCase()] = o;
    });

    var scope = getHrOrgScope();
    var parsed = HCRosterImport.parseFeed(values, orgsByCode, { orgScope: scope });
    if (parsed.headerProblems.length) {
      return { success: false, problems: parsed.headerProblems };
    }

    // REFUSE AN EMPTY RESULT. A feed that parsed to nothing — wrong tab, a
    // cleared sheet, a permissions change returning headers only — would
    // otherwise wipe the roster and take every supervisor's LETS access with
    // it. There is no legitimate reason to import zero positions.
    if (!parsed.rows.length) {
      return errorResponse(
        'The feed produced no importable positions, so nothing was changed. ' +
        'Importing an empty roster would remove every position and revoke ' +
        'supervisor-based access for everyone. ' +
        (parsed.blocked.length
          ? (parsed.blocked.length + ' row(s) were blocked by validation.')
          : 'Check that the tab and column headers are correct.'));
    }

    var db = new TravelDB();
    var targetSs = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = targetSs.getSheetByName(SHEET_NAMES.HC_POSITIONS);
    if (!sheet) {
      return errorResponse(SHEET_NAMES.HC_POSITIONS + ' tab not found. ' +
                           'Run setupTravelDatabase() first.');
    }

    var bundle = HC.hcGetBundle();
    var existing = bundle.success ? bundle.data : [];
    var diff = HCRosterImport.diffRoster(parsed.rows, existing);

    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.HC_POSITIONS];
    var actor = _hcAdminActor_();
    var now = new Date();

    // Created_At is PRESERVED for a position that already exists. Stamping it
    // `now` on every import would make the whole roster look created today and
    // destroy the only record of when a position first appeared.
    var createdAtByPn = {};
    existing.forEach(function (p) {
      if (p.positionNumber && p.createdAt) {
        createdAtByPn[String(p.positionNumber)] = p.createdAt;
      }
    });

    // ADMIN-RESOLVED ADDRESSES, RE-APPLIED.
    //
    // @clolry: "we need a way to save these so they aren't replaced when we
    // pull the daily feed - once we make the match we need to keep it."
    //
    // This import CLEARS HC_Positions, so without this an address an admin
    // resolved by hand is destroyed by the next daily run. The person stops
    // being able to sign in days later, with nothing connecting cause to
    // effect — and the natural response is to type it in again, and lose it
    // again.
    //
    // THE FEED WINS WHEN IT HAS AN ADDRESS. @clolry: "the email address
    // provided in this data source is definitive and without question", and
    // measured coverage is 821 of 821 named rows — so in practice an override
    // almost never applies.
    //
    // That is a change from when this was written: the previous feed had no
    // email column at all, so every address came from the directory sweep or
    // from an admin. The precedence is unchanged and still correct — HR is
    // authoritative about an address it actually publishes, and an override
    // exists to fill a gap rather than to contradict the source.
    //
    // Kept rather than deleted with the rest of the subsystem because this is
    // the ONLY correction path that survives an import. A hand edit to
    // HC_Positions lives until tomorrow morning, then this function clears
    // the row and the person silently stops being able to sign in.
    var overrides = {};
    try {
      overrides = readEmailOverrides();
    } catch (oe) {
      // A missing or unreadable override tab must not block the import, but
      // it MUST be loud: proceeding silently would quietly blank every
      // resolved address.
      console.error('importRoster: could not read ' +
                    SHEET_NAMES.HC_EMAIL_OVERRIDES + ': ' + oe.message +
                    ' — admin-resolved email addresses will NOT be ' +
                    're-applied by this run.');
    }
    var overridesApplied = 0;

    var rows = parsed.rows.map(function (r) {
      var email = r.emailAddress;
      if (!email && overrides[r.positionNumber] &&
          overrides[r.positionNumber].email) {
        email = overrides[r.positionNumber].email;
        overridesApplied++;
      }
      var rec = {
        'Position_Number': r.positionNumber,
        'Reports_To_Position_Number': r.reportsToPositionNumber,
        'Employee_ID': r.employeeId,
        'Employee_Name': r.employeeName,
        'Email_Address': email,
        'Org_Code': r.orgCode,
        'Office_Title': r.officeTitle,
        'Grade': r.grade,
        'Supervisory_Status': r.supervisoryStatus,
        'Occupancy_Status': r.occupancyStatus,
        'LCAT': r.lcat,
        'Location_Code': r.locationCode,
        'Duty_Station_Address': r.dutyStationAddress,
        'Duty_Station_City': r.dutyStationCity,
        'Duty_Station_State': r.dutyStationState,
        'Is_Active': true,
        // PROVENANCE, and the name is the source it actually came from.
        // Was 'fas-hr-feed' when the roster came from the FAS HRLinks feed.
        // Rows written before this change keep the old stamp; nothing reads
        // these values, so mixed provenance is harmless and the truthful name
        // is worth more than uniformity.
        'Created_By': createdAtByPn[r.positionNumber] ? '' : 'fc-wf-feed',
        'Created_At': createdAtByPn[r.positionNumber] || now,
        'Updated_By': 'fc-wf-feed:' + actor,
        'Updated_At': now
      };
      // Mapped over the schema headers, never built by hand: writes are
      // positional (docs/DATA_DICTIONARY.md §3.9).
      return headers.map(function (h) { return h in rec ? rec[h] : ''; });
    });

    // NOT `lastRow` — that name is already taken by the FEED's row count
    // above, and `var` would silently reassign it. Both are in this function's
    // scope, and confusing the source sheet's length with the target's is
    // exactly the kind of mistake that clears the wrong range.
    var targetLastRow = sheet.getLastRow();
    if (targetLastRow > 1) {
      sheet.getRange(2, 1, targetLastRow - 1, headers.length).clearContent();
    }

    // Pin the identifier columns to TEXT before writing, so leading zeros
    // survive. Employee_ID '0010001' and Grade '07' both lose theirs
    // otherwise, and every grade comparison in LETS is a string comparison —
    // including the GS-15 Division Director lookup that approval routing
    // depends on. HCSeed.js does the same and documents the same reason.
    var pinned = ['Position_Number', 'Employee_ID', 'Grade'];
    pinned.forEach(function (name) {
      var col = headers.indexOf(name) + 1;
      if (col > 0) sheet.getRange(2, col, rows.length, 1).setNumberFormat('@');
    });
    SpreadsheetApp.flush();

    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

    // The HC bundle is cached for six hours. Without this the dashboard and
    // the org chart serve the OLD roster and an admin concludes the import
    // failed — then runs it again.
    try { db.invalidate(SHEET_NAMES.HC_POSITIONS); } catch (e) { /* non-fatal */ }
    try { HC.hcCacheInvalidateAll(); } catch (e) { /* non-fatal */ }

    var filled = parsed.rows.filter(function (r) {
      return r.occupancyStatus === 'FILLED';
    }).length;

    console.log('=== importRoster ===');
    console.log('source: ' + source.spreadsheetId + ' / ' + source.tabName);
    console.log('scope: ' + parsed.orgScope + ' — excluded ' +
                parsed.outOfScope + ' out-of-scope and ' + parsed.noOrgCode +
                ' org-less row(s)');
    console.log('by: ' + actor);
    console.log('positions written: ' + rows.length + ' (' + filled + ' filled)');
    console.log('admin-resolved emails re-applied: ' + overridesApplied +
                ' of ' + Object.keys(overrides).length + ' stored');
    console.log('adds ' + diff.adds.length + ', changes ' + diff.changes.length +
                ', removed ' + (diff.deletes.length + diff.seedDeletes.length) +
                ' (' + diff.seedDeletes.length + ' fictional)');
    if (parsed.cyclesCleared) {
      console.log('supervisor cycles cleared: ' + parsed.cyclesCleared);
    }

    return successResponse({
      positions: rows.length,
      filled: filled,
      vacant: rows.length - filled,
      adds: diff.adds.length,
      changes: diff.changes.length,
      removed: diff.deletes.length + diff.seedDeletes.length,
      seedRemoved: diff.seedDeletes.length,
      blocked: parsed.blocked.length,
      supervisorCyclesCleared: parsed.cyclesCleared,
      emailOverridesApplied: overridesApplied,
      emailOverridesStored: Object.keys(overrides).length
    }, 'Imported ' + rows.length + ' positions (' + filled + ' filled) from ' +
       'the FAS HR feed. ' + diff.seedDeletes.length + ' fictional test ' +
       'record(s) removed.');
  } catch (e) {
    console.error('importRoster failed: ' + e.message);
    return errorResponse('Could not import the roster: ' + e.message);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* already released */ }
  }
}
