/**
 * HCRead.js
 * Reads HC_Positions and HC_Orgs and builds the org-chart tree.
 *
 * RELATIONSHIP TO LETS
 * --------------------
 * This is a DELIBERATE SECOND IMPLEMENTATION of the reader in
 * `lets_app/server/20_data/HCData.js`, not a copy and not a library call.
 *
 * The alternative was binding this project to LETS as an Apps Script library.
 * That was rejected: LETS exists in its current form precisely BECAUSE the
 * inherited HC library became unreachable, and HCData.js had to be written to
 * replace it. Recreating that coupling would reproduce the failure it was
 * built to escape.
 *
 * The cost of duplication is drift, and drift here is silent — a chart that
 * quietly disagrees with the roster. So `test_orgchart.js` loads BOTH this
 * file and LETS's HCData.js and asserts they agree, position for position, on
 * the same input. Duplication that is tested is a different thing from
 * duplication that is hoped about.
 *
 * WHAT THIS FILE DOES NOT DO
 * --------------------------
 * It never writes. LETS owns these tabs; this project is a reader. There is
 * no code path here that opens the spreadsheet for anything but getValues().
 */

var HCRead = (function () {

  // ==========================================================================
  // INTERNAL — normalization
  // ==========================================================================
  //
  // These four helpers are byte-equivalent in intent to HCData.js's. The
  // comments explain WHY each exists rather than restating what it does,
  // because every one of them encodes a defect that was found the hard way.

  /** Trimmed string, never null/undefined. */
  function _str_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  /**
   * Grade as a zero-padded two-character string.
   *
   * A sheet cell containing 07 arrives as the NUMBER 7, and String(7) is '7',
   * not '07'. Every grade comparison in LETS is a string comparison, so an
   * unpadded GS-07 silently fails all of them.
   *
   * The chart does not display grade, and does not compare it either — so why
   * normalize at all? Because test_orgchart.js asserts this project and LETS
   * produce identical records, and a difference here would be a real
   * divergence between two readers of one table. Normalizing keeps the
   * comparison meaningful rather than papering over it.
   *
   * Non-numeric grades (SES, ES, WG-xx) pass through: padding would corrupt
   * them.
   */
  function _grade_(v) {
    var s = _str_(v);
    if (!s) return '';
    if (/^\d+$/.test(s)) return s.length === 1 ? '0' + s : s;
    return s;
  }

  /**
   * Occupancy status, uppercased.
   *
   * Load-bearing HERE in a way it is not in LETS: this file decides which
   * seats appear in a chart by comparing `!== 'VACANT'`. A lowercase 'vacant'
   * in the sheet would put an empty seat on a published chart with a blank
   * name under it.
   *
   * Blank means filled. A vacancy is explicit.
   */
  function _occupancy_(v) {
    var s = _str_(v).toUpperCase();
    return s || 'FILLED';
  }

  /**
   * Sheets checkbox / text truthiness, defaulting to TRUE.
   *
   * Is_Active is a checkbox for rows written by the LETS editor, but a typed
   * word for rows entered by hand — and @clolry types rows by hand. 'TRUE',
   * 'Yes', 'y' and 1 all appear in practice.
   *
   * Blank defaults to ACTIVE, because the overwhelming majority of rows are
   * active and leaving the cell empty is the common hand-entry case. The
   * alternative default would hide most of the organisation.
   */
  function _bool_(v, defaultValue) {
    if (v === '' || v === null || v === undefined) return defaultValue !== false;
    if (typeof v === 'boolean') return v;
    var s = String(v).trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1';
  }

  // ==========================================================================
  // INTERNAL — sheet reading
  // ==========================================================================

  /**
   * One tab -> array of header-keyed objects.
   *
   * Reads BY HEADER NAME, not by column position. LETS's own documentation
   * calls positional reads its most dangerous routine hazard — eighteen places
   * do it, and inserting a column silently misfiles everything after it
   * (ADMINISTRATOR_GUIDE §1.6.5, finding G-014).
   *
   * This project will not add a nineteenth. Reading by header costs one
   * row-one read and makes a column insertion a non-event.
   *
   * @param {Spreadsheet} ss
   * @param {string} tabName
   * @returns {Array<Object>} empty when the tab is missing or holds only headers
   */
  function _readTab_(ss, tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return [];

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = values[0].map(function (h) { return _str_(h); });

    var out = [];
    for (var r = 1; r < values.length; r++) {
      var row = {};
      var hasAnyValue = false;
      for (var c = 0; c < headers.length; c++) {
        if (!headers[c]) continue;
        row[headers[c]] = values[r][c];
        if (values[r][c] !== '' && values[r][c] !== null) hasAnyValue = true;
      }
      // Skip blank spacer rows. A hand-maintained sheet accumulates them, and
      // each one would otherwise become a node with no name.
      if (hasAnyValue) out.push(row);
    }
    return out;
  }

  function _normalizePosition_(row) {
    return {
      positionNumber:          _str_(row['Position_Number']),
      reportsToPositionNumber: _str_(row['Reports_To_Position_Number']),
      employeeName:            _str_(row['Employee_Name']),
      orgCode:                 _str_(row['Org_Code']).toUpperCase(),
      officeTitle:             _str_(row['Office_Title']),
      grade:                   _grade_(row['Grade']),
      supervisoryStatus:       _str_(row['Supervisory_Status']),
      occupancyStatus:         _occupancy_(row['Occupancy_Status']),
      locationCity:            _str_(row['Duty_Station_City']),
      locationState:           _str_(row['Duty_Station_State']),
      isActive:                _bool_(row['Is_Active'], true)
    };
  }

  function _normalizeOrg_(row) {
    var formers = _str_(row['Former_Org_Codes']);
    return {
      orgCode:        _str_(row['Org_Code']).toUpperCase(),
      officeCode:     _str_(row['Office_Code']),
      businessUnit:   _str_(row['Business_Unit']),
      sector:         _str_(row['Sector']),
      division:       _str_(row['Division']),
      status:         _str_(row['Status']),
      isActive:       _bool_(row['Is_Active'], true),
      formerOrgCodes: formers
        ? formers.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean)
        : []
    };
  }

  // ==========================================================================
  // ORG CODE RESOLUTION
  // ==========================================================================

  /**
   * Builds the orgCode -> org index, including retired codes.
   *
   * A retired code resolves to its successor so historical rows still land
   * somewhere. An explicit current row always wins over a former-code alias,
   * which is why the former-code pass runs second and does not overwrite.
   *
   * @param {Array<Object>} orgs
   * @returns {Object} orgCode -> org record
   */
  function indexOrgs(orgs) {
    var byCode = {};
    for (var i = 0; i < orgs.length; i++) {
      if (orgs[i].orgCode) byCode[orgs[i].orgCode] = orgs[i];
    }
    for (var j = 0; j < orgs.length; j++) {
      var formers = orgs[j].formerOrgCodes || [];
      for (var f = 0; f < formers.length; f++) {
        if (!byCode[formers[f]]) byCode[formers[f]] = orgs[j];
      }
    }
    return byCode;
  }

  /**
   * The org row that NAMES this code — longest prefix, exact match preferred.
   *
   * Org codes are hierarchical and there are 137 of them: FCA0A sits under
   * FCA, which sits under FC. @clolry's organisation uses six levels.
   *
   * Longest prefix wins, and that is the load-bearing part: FC is a prefix of
   * every other code, so a first-match or shortest-match rule would resolve
   * every position to the Front Office.
   *
   * This answers IDENTITY only — what the org is called. Budget attribution
   * is a different question with a different answer; see inheritOrgField.
   *
   * @param {string} code already uppercased
   * @param {Object} byCode from indexOrgs
   * @returns {Object|null}
   */
  function resolveOrgByCode(code, byCode) {
    var c = _str_(code).toUpperCase();
    if (!c) return null;
    if (byCode[c]) return byCode[c];

    var best = null;
    var bestLen = 0;
    Object.keys(byCode).forEach(function (key) {
      if (c.indexOf(key) !== 0) return;
      if (key.length <= bestLen) return;
      best = byCode[key];
      bestLen = key.length;
    });
    return best;
  }

  /**
   * Walks UP the prefix chain for a field this code's own row leaves blank.
   *
   * THE DISTINCTION THIS ENCODES IS THE EASY ONE TO GET WRONG.
   *
   * Only FC, FCA, FCB and FCC carry an Office_Code, because only those four
   * are budget offices. All 133 sub-org rows leave it deliberately blank —
   * copying the parent's value onto every descendant would mean a
   * reorganisation had to edit 22 rows instead of one.
   *
   * So resolveOrgByCode alone returns a BLANK key for every sub-org, which is
   * the exact symptom the hierarchy work set out to remove. Identity resolves
   * DOWN to the most specific row; attribution resolves UP to the nearest
   * ancestor that actually holds a value. Same code, two directions.
   *
   * An explicit value on a sub-org row still wins, so moving a service center
   * to a different parent is one cell, not a code change.
   *
   * @param {string} code already uppercased
   * @param {Object} byCode from indexOrgs
   * @param {string} field
   * @returns {string} '' when no ancestor supplies it
   */
  function inheritOrgField(code, byCode, field) {
    var c = _str_(code).toUpperCase();
    if (!c) return '';

    var best = null;
    var bestLen = -1;
    Object.keys(byCode).forEach(function (key) {
      if (c.indexOf(key) !== 0) return;
      if (!_str_(byCode[key][field])) return;
      if (key.length <= bestLen) return;
      best = byCode[key];
      bestLen = key.length;
    });
    return best ? _str_(best[field]) : '';
  }

  /**
   * Org label for display: the most specific NAME available.
   *
   * @clolry: "FCA and OMD are two ways to describe the same thing." So the
   * chart shows ONE org label, not a code plus a redundant business unit.
   *
   * Preference order, most specific first:
   *   1. the code's own Division  — "Portfolio Management Service Center"
   *   2. its own Business_Unit    — for the four top-level orgs, where
   *                                 Division is the long office name
   *   3. an inherited Division    — code absent from HC_Orgs entirely
   *   4. the raw code             — nothing else is known; better than blank
   *
   * @param {string} code
   * @param {Object} byCode
   * @returns {string}
   */
  function orgLabel(code, byCode) {
    var c = _str_(code).toUpperCase();
    if (!c) return '';

    var own = byCode[c];
    if (own) {
      if (_str_(own.division)) return _str_(own.division);
      if (_str_(own.businessUnit)) return _str_(own.businessUnit);
    }

    var inheritedDivision = inheritOrgField(c, byCode, 'division');
    if (inheritedDivision) return inheritedDivision;

    var inheritedBu = inheritOrgField(c, byCode, 'businessUnit');
    if (inheritedBu) return inheritedBu;

    return c;
  }

  // ==========================================================================
  // PUBLIC — the tree
  // ==========================================================================

  /**
   * Builds the org-chart tree.
   *
   * WHAT REACHES THE BROWSER, AND WHY SO LITTLE
   * -------------------------------------------
   * Each node carries name, title, org label, city/state and children. It
   * carries NO email, NO grade, NO employee ID, NO position number and NO
   * occupancy status.
   *
   * This is the access control, not a tidying-up. The web app is reachable by
   * any domain user with the link, and position numbers are the join keys for
   * the whole supervisor tree — sending the flat list and assembling the tree
   * in the browser would put every identifier in the page source where View
   * Source reaches it. So the tree is resolved HERE and the keys are stripped
   * before returning.
   *
   * Grade is excluded for a different reason: a chart that shows grades is a
   * salary-band chart, and that is a different document with different
   * approval requirements.
   *
   * VACANT SEATS ARE OMITTED
   * ------------------------
   * Not shown as "Vacant" — omitted. A published chart should not advertise
   * which positions are unfilled. But a vacant seat is still used as a
   * WAYPOINT: someone reporting through an empty seat is reparented to the
   * nearest staffed ancestor, so they do not render as a false top-level root
   * implying they report to nobody.
   *
   * @returns {{success: boolean, roots: Array, count: number, error?: string,
   *            orgCount: number, warnings: Array<string>}}
   */
  function buildTree() {
    var ssId = getHCSpreadsheetId();
    if (!ssId) {
      return {
        success: false,
        error: 'HC_SPREADSHEET_ID is not set. Open Project Settings -> Script ' +
               'Properties and set it to the LETS travel database spreadsheet ID.',
        roots: [], count: 0, orgCount: 0, warnings: []
      };
    }

    var ss;
    try {
      ss = SpreadsheetApp.openById(ssId);
    } catch (e) {
      // Almost always a permissions problem rather than a wrong ID: the
      // deploying account must be able to read the LETS database.
      return {
        success: false,
        error: 'Could not open the spreadsheet. Confirm HC_SPREADSHEET_ID is ' +
               'correct and that this account can read it. (' + e.message + ')',
        roots: [], count: 0, orgCount: 0, warnings: []
      };
    }

    var rawPositions = _readTab_(ss, TABS.POSITIONS);
    var rawOrgs = _readTab_(ss, TABS.ORGS);

    if (!rawPositions.length) {
      // Name what WAS found. @clolry's first run pointed at a spreadsheet
      // called "Copy of FAS Travel Exemption Request (Responses)" and the
      // error said only "HC_Positions is empty or missing", which reads like
      // a problem with the LETS database rather than a pointer at the wrong
      // file. The spreadsheet's own name is the fastest way to see that.
      var found = [];
      try {
        found = ss.getSheets().map(function (sh) { return sh.getName(); });
      } catch (e2) {
        found = [];
      }
      return {
        success: false,
        error: TABS.POSITIONS + ' was not found in "' + ss.getName() + '". ' +
               (found.length
                 ? 'That spreadsheet contains: ' + found.slice(0, 8).join(', ') +
                   (found.length > 8 ? ', …' : '') + '. '
                 : '') +
               'HC_SPREADSHEET_ID must point at the LETS travel database — the ' +
               'spreadsheet holding Requests and the HC tabs. Copy it from the ' +
               "LETS project's TRAVEL_DB_SPREADSHEET_ID property.",
        roots: [], count: 0, orgCount: 0, warnings: []
      };
    }

    var orgs = rawOrgs.map(_normalizeOrg_).filter(function (o) {
      return o.orgCode && o.isActive;
    });
    var byCode = indexOrgs(orgs);

    // Is_Active=false means retired. The row is KEPT in the sheet so past
    // requests keep their attribution, but the person is gone from lookups —
    // so they must be gone from the chart too.
    var positions = rawPositions.map(_normalizePosition_).filter(function (p) {
      return p.positionNumber && p.isActive;
    });

    var warnings = [];

    // Index EVERY position, vacant included: the vacant ones are needed as
    // reparenting waypoints below, then discarded.
    var allByPn = {};
    for (var a = 0; a < positions.length; a++) {
      if (allByPn[positions[a].positionNumber]) {
        // A duplicate key means the later row wins every lookup and the
        // earlier person vanishes. Worth surfacing: it is invisible otherwise.
        warnings.push('Duplicate Position_Number "' + positions[a].positionNumber +
                      '" — one of those two people will be missing from the chart.');
      }
      allByPn[positions[a].positionNumber] = positions[a];
    }

    var staffed = positions.filter(function (p) {
      return p.occupancyStatus !== 'VACANT' && p.employeeName;
    });

    var nodes = {};
    for (var i = 0; i < staffed.length; i++) {
      var p = staffed[i];
      nodes[p.positionNumber] = {
        name: p.employeeName,
        title: p.officeTitle || '',
        org: orgLabel(p.orgCode, byCode),
        orgCode: p.orgCode,
        location: p.locationCity
          ? (p.locationState ? p.locationCity + ', ' + p.locationState : p.locationCity)
          : '',
        children: [],
        // Internal, stripped before returning.
        _pn: p.positionNumber,
        _parent: p.reportsToPositionNumber
      };
    }

    /**
     * Nearest STAFFED ancestor of a position.
     *
     * Vacant seats are omitted from the chart, which would orphan anyone
     * reporting to one — they would render as a second top-level root,
     * visually implying they are a peer of the head of the organisation
     * rather than several levels below.
     *
     * Cycle-guarded and depth-capped. A data-entry mistake making A report to
     * B and B report to A would otherwise be an infinite loop inside a web
     * request: a hung page rather than an error. The depth cap is generous
     * relative to the six real levels, so it bounds pathology without
     * truncating a legitimate chain.
     */
    function nearestStaffedAncestor(startPn) {
      var seen = {};
      var cursor = startPn;
      var depth = 0;
      while (cursor && depth < 25) {
        if (seen[cursor]) {
          warnings.push('Reporting cycle detected at position ' + cursor +
                        ' — the people in it appear at the top level.');
          return null;
        }
        seen[cursor] = true;

        if (nodes[cursor]) return nodes[cursor];

        var pos = allByPn[cursor];
        if (!pos) return null;                      // dangling pointer
        cursor = pos.reportsToPositionNumber;       // vacant: keep climbing
        depth++;
      }
      return null;
    }

    var roots = [];
    Object.keys(nodes).forEach(function (pn) {
      var node = nodes[pn];
      var parent = node._parent ? nearestStaffedAncestor(node._parent) : null;
      if (parent && parent !== node) parent.children.push(node);
      else roots.push(node);
    });

    // DETACHED CYCLES. Found while testing this file, and present in LETS's
    // hcGetOrgChartTree too.
    //
    // nearestStaffedAncestor only guards cycles that pass through a VACANT
    // seat, because it stops at the first STAFFED ancestor it finds. So for a
    // staffed cycle — A reports to B, B reports to A — both lookups succeed
    // on their first hop: A becomes B's child and B becomes A's child. The
    // pair is a closed ring that nothing in `roots` points at.
    //
    // No error, no warning, no hang. Both people and EVERYONE BELOW THEM
    // simply disappear from the chart, while `count` still includes them — so
    // the header says "187 people" over a tree containing 140. That is the
    // worst available outcome: a chart that is confidently wrong.
    //
    // Detected by reachability rather than by a smarter walk: whatever the
    // shape, a node the roots cannot reach is lost. One member of each ring
    // is promoted to a root so the people under it reappear, and the warning
    // names it so the data can be fixed.
    var reachable = {};
    (function mark(list) {
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (reachable[n._pn]) continue;      // already seen: ring inside a ring
        reachable[n._pn] = true;
        mark(n.children);
      }
    })(roots);

    Object.keys(nodes).forEach(function (pn) {
      if (reachable[pn]) return;
      var node = nodes[pn];

      // Detach from the parent that cannot be reached, or the ring stays a
      // ring and the scrub walk below recurses forever.
      var parentPn = node._parent;
      while (parentPn && !nodes[parentPn]) {
        parentPn = allByPn[parentPn] ? allByPn[parentPn].reportsToPositionNumber : '';
      }
      if (parentPn && nodes[parentPn]) {
        var siblings = nodes[parentPn].children;
        var at = siblings.indexOf(node);
        if (at > -1) siblings.splice(at, 1);
      }

      roots.push(node);
      warnings.push('Reporting cycle involving position ' + pn + ' (' + node.name +
                    '). They and anyone below them would otherwise be missing ' +
                    'from the chart entirely — fix Reports_To_Position_Number.');

      // Re-mark, because promoting this node may have made a whole subtree
      // reachable and the remaining members of its ring must not be promoted
      // too.
      (function mark(list) {
        for (var i = 0; i < list.length; i++) {
          var n = list[i];
          if (reachable[n._pn]) continue;
          reachable[n._pn] = true;
          mark(n.children);
        }
      })([node]);
    });

    // Strip internal keys so no position number reaches the browser, and
    // count the subtree so the UI can show "42 people" on a collapsed node
    // without walking it in JavaScript.
    function scrub(node) {
      delete node._pn;
      delete node._parent;
      node.children.sort(function (x, y) {
        // Supervisors first, then alphabetical. A chart sorted purely by name
        // buries the person who runs a branch in the middle of their reports.
        var xs = x.children.length > 0 ? 0 : 1;
        var ys = y.children.length > 0 ? 0 : 1;
        if (xs !== ys) return xs - ys;
        return x.name.localeCompare(y.name);
      });
      var total = 0;
      node.children.forEach(function (c) { total += scrub(c); });
      node.reportCount = total;
      return total + 1;
    }
    roots.forEach(scrub);
    roots.sort(function (x, y) { return y.reportCount - x.reportCount; });

    if (roots.length > 1) {
      // Expected to be exactly one. More means either a genuine second
      // top-level office or a broken Reports_To, and the user should be able
      // to tell which.
      warnings.push(roots.length + ' people report to nobody. Expect one; the ' +
                    'others usually mean a blank or wrong Reports_To_Position_Number.');
    }

    return {
      success: true,
      roots: roots,
      count: staffed.length,
      orgCount: orgs.length,
      warnings: warnings
    };
  }

  /**
   * buildTree with caching.
   *
   * The chart changes when HR data changes — rarely, never urgently. An hour
   * of staleness is invisible when looking up a reporting line; rebuilding on
   * every page load is not.
   *
   * A failure is NOT cached. Caching an error would mean a misconfigured
   * property kept failing for an hour after being fixed.
   *
   * Apps Script caps a cache entry at 100KB. A large tree can exceed that, and
   * put() throws rather than degrading — so the write is wrapped and a tree
   * too big to cache simply gets rebuilt each time. Slower, still correct.
   *
   * @param {boolean} [bypass] skip the cache, for the Refresh control
   * @returns {Object} same shape as buildTree, plus `cached`
   */
  function getTree(bypass) {
    var cache = CacheService.getScriptCache();
    var KEY = 'orgchart_tree_v1';

    if (bypass !== true) {
      try {
        var hit = cache.get(KEY);
        if (hit) {
          var parsed = JSON.parse(hit);
          parsed.cached = true;
          return parsed;
        }
      } catch (e) {
        // A corrupt or truncated entry must not take the page down.
        console.warn('Org chart cache read failed: ' + e.message);
      }
    }

    var fresh = buildTree();
    if (fresh.success) {
      try {
        cache.put(KEY, JSON.stringify(fresh), getCacheSeconds());
      } catch (e) {
        console.warn('Org chart too large to cache (' + e.message + '); ' +
                     'it will be rebuilt on each load.');
      }
    }
    fresh.cached = false;
    return fresh;
  }

  return {
    getTree: getTree,
    buildTree: buildTree,

    // Exposed for test_orgchart.js, which compares these against LETS's
    // equivalents on identical input.
    indexOrgs: indexOrgs,
    resolveOrgByCode: resolveOrgByCode,
    inheritOrgField: inheritOrgField,
    orgLabel: orgLabel,
    _grade: _grade_,
    _occupancy: _occupancy_,
    _bool: _bool_,
    _normalizePosition: _normalizePosition_,
    _normalizeOrg: _normalizeOrg_
  };
})();

/**
 * Browser entry point for the chart data.
 *
 * @param {boolean} [bypassCache]
 * @returns {Object}
 */
function getOrgChart(bypassCache) {
  try {
    return HCRead.getTree(bypassCache === true);
  } catch (e) {
    console.error('getOrgChart failed: ' + e.message);
    return {
      success: false, error: e.message,
      roots: [], count: 0, orgCount: 0, warnings: []
    };
  }
}
