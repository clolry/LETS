/**
 * HCData.js
 * The HC namespace — employee and org reference data for LETS.
 *
 * WHAT THIS REPLACES
 * ------------------
 * LETS inherited TRIP from another workgroup. TRIP read its HR data from an
 * Apps Script Library bound as `HC`, referenced at 28 sites across 9 server
 * files. That library was:
 *
 *   - bound as a PROJECT SETTING, declared in no manifest, so it was
 *     invisible to this repository and to code review;
 *   - populated with the previous workgroup's employees, not ours;
 *   - no longer reachable by this team at all.
 *
 * Its absence produced NO error. Every call site wraps `HC.*` in a try/catch
 * that logs a warning and continues, so the system served pages and silently
 * denied access to anyone outside the explicit role table. That is
 * docs/GAP_REGISTER.md G-008, rated C4/R2, and docs/DEPLOYMENT_AND_ENVIRONMENTS.md
 * §5.7.2 calls it the most dangerous of the eight unrecoverable settings
 * precisely because it fails quietly.
 *
 * This module provides the same four-function interface, backed by two tabs in
 * the LETS database instead of an external library. The dependency is now code
 * in this repository rather than an unrecorded project setting.
 *
 * THE INTERFACE IS NOT A DESIGN CHOICE
 * ------------------------------------
 * It is a reconstruction. Every function name, return shape and field name
 * below was derived from the 28 existing call sites, which are inherited code
 * this change does not touch:
 *
 *   HC.hcGetBundle()           18 call sites
 *   HC.hcGetOrgHierarchy()      6 call sites
 *   HC.hcRefreshBundleCache()   3 call sites
 *   HC.hcCacheInvalidateAll()   1 call site
 *
 * Changing a field name here breaks consumers silently, because they read
 * properties off plain objects and `undefined` is not an error. The field list
 * is fixed by Access.js, Request.js, Users.js, Submission.js, OrgLookup.js,
 * Admin_Dashboard.js, Database.js, CacheWarming.js and hcDataCenterService.html.
 *
 * WHY NORMALIZATION HAPPENS HERE AND NOWHERE ELSE
 * -----------------------------------------------
 * 16 sites compare HR values as STRINGS:
 *
 *   Access.js:133        String(p.grade) !== '15'
 *   Access.js:134        String(p.supervisoryStatus) !== '2'
 *   Request.js:137       String(supervisor.grade || '').trim() === '15'
 *   ... and 13 more
 *
 * Google Sheets coerces a cell containing 07 to the NUMBER 7. `String(7)` is
 * `'7'`, not `'07'`, so a GS-07 would fail every grade comparison. The same
 * hazard applies to Position_Number and Employee_ID, which may carry leading
 * zeros — Database.js:293 already pins that column to text format for exactly
 * this reason.
 *
 * docs/GAP_CONSOLIDATION_PASS6.md VT-03 flagged this in advance: "the site gate
 * compares supervisoryStatus === '2' as a string; if HC emits a number, two of
 * three allow-paths are already dead and nobody would know."
 *
 * The fix is one choke point, not 16 edits. _normalizePosition() coerces at the
 * read boundary so every consumer receives strings. Editing the 16 inherited
 * comparisons would have been a larger diff with a worse failure mode: a missed
 * site silently denies someone access, logging only a console.warn.
 *
 * SECURITY NOTE
 * -------------
 * This data is PII: names, emails, grades, duty stations and the full
 * reporting tree. hcGetBundle() returns ALL of it and is called from
 * getHCStaffingBundle(), which is browser-reachable (G-001). That exposure is
 * pre-existing and unchanged by this module. The org chart project does NOT
 * use this function — it has its own reduced projection that emits names and
 * reporting lines only. Do not add a new client-facing caller of
 * hcGetBundle() without an authorization guard.
 */

// MUST BE `var`, NOT `const`/`let`. Consumers reference the bare identifier
// `HC` from inside function bodies, which would resolve lexically either way —
// but a top-level `const` is NOT a property of the global object in the Apps
// Script V8 runtime, and anything reading `this.HC` or `root.HC` would get
// undefined. BudgetConfig.js already caused a total production outage this
// way (see its header, and PR #14). Do not "modernize" this keyword.
var HC = (function () {
  'use strict';

  // Cache keys are versioned. Bump the suffix when the normalized record
  // shape changes, so a deploy cannot serve records built by older code.
  var CACHE_KEY_BUNDLE = 'hc_bundle_v1';
  var CACHE_KEY_ORGS   = 'hc_orgs_v1';
  var CACHE_KEY_META   = 'hc_bundle_meta_v1';

  // CacheService caps a single value at 100KB. Stay under it with margin
  // rather than letting put() fail silently and re-read the sheet forever.
  var CACHE_MAX_BYTES = 90000;

  // ==========================================================================
  // INTERNAL — sheet access
  // ==========================================================================

  /**
   * Opens the LETS database. Throws with a diagnosable message when the
   * Script Property is unset, rather than letting openById(null) emit the
   * platform's bare 'Invalid argument: id' — the failure mode that cost real
   * time during initial setup (Database.js:456 documents the same incident).
   */
  function _openDb_() {
    if (!TRAVEL_DB_SPREADSHEET_ID) {
      throw new Error(
        'TRAVEL_DB_SPREADSHEET_ID is not set in Script Properties. ' +
        'HC data lives in the LETS database; set that property and re-run.');
    }
    return SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  }

  /**
   * Reads a tab into an array of plain objects keyed by header NAME.
   *
   * Header-name resolution is deliberate: docs/DATA_DICTIONARY.md §3.9 records
   * that this codebase reads by name (538 sites) and writes by position (22
   * sites). Reading by name means a column appended at the right does not
   * break this function.
   *
   * Returns [] for a missing tab rather than throwing. A missing HC tab is a
   * setup state, not a crash: the caller reports it as an empty bundle and the
   * inherited try/catch sites behave exactly as they did with no library.
   */
  function _readTab_(sheetName) {
    var ss = _openDb_();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      console.warn('HC: tab "' + sheetName + '" not found. Run setupTravelDatabase().');
      return [];
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];   // headers only, or empty

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = values[0];

    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = {};
      var hasAnyValue = false;
      for (var c = 0; c < headers.length; c++) {
        var key = String(headers[c] || '').trim();
        if (!key) continue;
        row[key] = values[r][c];
        if (values[r][c] !== '' && values[r][c] !== null) hasAnyValue = true;
      }
      if (hasAnyValue) rows.push(row);    // skip blank spacer rows
    }
    return rows;
  }

  // ==========================================================================
  // INTERNAL — normalization
  // ==========================================================================

  /** Trimmed string, never null/undefined. */
  function _str_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  /**
   * Grade as a zero-padded two-character string.
   *
   * THE WHOLE POINT OF THIS MODULE'S NORMALIZATION LAYER.
   *
   *   sheet cell 15  -> number 15 -> '15'   comparisons pass
   *   sheet cell 07  -> number 7  -> '07'   comparisons pass ONLY because
   *                                         of the padding below
   *
   * Without the pad, String(7) === '07' is false and a GS-07 fails every
   * grade check in the system. Non-numeric grades (e.g. 'SES', 'ES') pass
   * through untouched — padding them would corrupt them.
   */
  function _grade_(v) {
    var s = _str_(v);
    if (!s) return '';
    if (/^\d+$/.test(s)) return s.length === 1 ? '0' + s : s;
    return s;   // SES, ES, WG-xx and similar: leave alone
  }

  /**
   * Occupancy status, uppercased.
   *
   * Consumers compare against 'VACANT' and 'OBLIGATED' — Access.js:417-418
   * uppercases defensively, but hcDataCenterService.html:193 and
   * Request.js:137 compare `!== 'VACANT'` with NO uppercasing. A lowercase
   * 'vacant' in the sheet would therefore read as STAFFED on the client and
   * VACANT on the server. Normalize once, here.
   */
  function _occupancy_(v) {
    var s = _str_(v).toUpperCase();
    return s || 'FILLED';   // blank means filled; a VACANT seat is explicit
  }

  /** Sheets checkbox / text truthiness. Blank defaults to TRUE (active). */
  function _bool_(v, defaultValue) {
    if (v === '' || v === null || v === undefined) return defaultValue !== false;
    if (typeof v === 'boolean') return v;
    var s = String(v).trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1';
  }

  /**
   * One HC_Positions row -> the position record shape consumers expect.
   *
   * Field names are camelCase and FIXED by the 28 inherited call sites. The
   * nested `org` and `location` objects are required: Submission.js:1149 reads
   * p.org.businessUnit, Request.js:99 reads loc.address1.
   */
  function _normalizePosition_(row) {
    return {
      positionNumber:          _str_(row['Position_Number']),
      reportsToPositionNumber: _str_(row['Reports_To_Position_Number']),
      employeeId:              _str_(row['Employee_ID']),
      employeeName:            _str_(row['Employee_Name']),
      emailAddress:            _str_(row['Email_Address']),
      orgCode:                 _str_(row['Org_Code']),
      officeTitle:             _str_(row['Office_Title']),
      grade:                   _grade_(row['Grade']),
      supervisoryStatus:       _str_(row['Supervisory_Status']),
      occupancyStatus:         _occupancy_(row['Occupancy_Status']),
      lcat:                    _str_(row['LCAT']),
      locationCode:            _str_(row['Location_Code']),

      // Nested shapes the inherited consumers destructure.
      org: {
        businessUnit: '',   // filled by _joinOrgs_ below
        sector:       ''
      },
      location: {
        address1: _str_(row['Duty_Station_Address']),
        city:     _str_(row['Duty_Station_City']),
        state:    _str_(row['Duty_Station_State'])
      }
    };
  }

  /** One HC_Orgs row -> the org record shape OrgLookup.js expects. */
  function _normalizeOrg_(row) {
    var formers = _str_(row['Former_Org_Codes']);
    return {
      orgCode:        _str_(row['Org_Code']),
      officeCode:     _str_(row['Office_Code']),   // LETS addition, see below
      businessUnit:   _str_(row['Business_Unit']),
      sector:         _str_(row['Sector']),
      division:       _str_(row['Division']),
      status:         _str_(row['Status']),
      formerOrgCodes: formers
        ? formers.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
        : []
    };
  }

  /**
   * Denormalizes org attributes onto each position.
   *
   * The inherited code reads p.org.businessUnit and p.org.sector directly off
   * a position and never joins anything itself, so the join must happen before
   * the bundle is returned. Positions whose Org_Code matches no HC_Orgs row
   * keep empty strings — the same thing consumers already handle with
   * `(p.org && p.org.businessUnit) || ''`.
   */
  function _joinOrgs_(positions, orgs) {
    var byCode = {};
    for (var i = 0; i < orgs.length; i++) {
      if (orgs[i].orgCode) byCode[orgs[i].orgCode] = orgs[i];
    }
    // Retired codes resolve to their successor, mirroring OrgLookup.js:52.
    for (var j = 0; j < orgs.length; j++) {
      var formers = orgs[j].formerOrgCodes || [];
      for (var f = 0; f < formers.length; f++) {
        if (!byCode[formers[f]]) byCode[formers[f]] = orgs[j];
      }
    }

    for (var p = 0; p < positions.length; p++) {
      var org = byCode[positions[p].orgCode];
      if (org) {
        positions[p].org.businessUnit = org.businessUnit;
        positions[p].org.sector       = org.sector;
      }
    }
    return positions;
  }

  // ==========================================================================
  // INTERNAL — cache
  // ==========================================================================

  function _cache_() {
    return CacheService.getScriptCache();
  }

  function _cacheGet_(key) {
    try {
      var raw = _cache_().get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('HC: cache read failed for ' + key + ': ' + e.message);
      return null;   // a cache miss is always safe; the sheet is the truth
    }
  }

  function _cachePut_(key, value, ttlSeconds) {
    try {
      var raw = JSON.stringify(value);
      if (raw.length > CACHE_MAX_BYTES) {
        // Do not attempt the put. CacheService rejects oversized values and
        // the failure is easy to miss, producing a permanent silent cache miss
        // that re-reads the sheet on every single request.
        console.warn(
          'HC: payload ' + raw.length + ' bytes exceeds the ' + CACHE_MAX_BYTES +
          '-byte cache limit for "' + key + '". Serving uncached. If the roster ' +
          'has grown past this, HCData.js needs chunked caching (see ' +
          'CACHE_CONFIG.CHUNK_SIZE in 01_constants/Cache.js for the established pattern).');
        return false;
      }
      _cache_().put(key, raw, ttlSeconds);
      return true;
    } catch (e) {
      console.warn('HC: cache write failed for ' + key + ': ' + e.message);
      return false;
    }
  }

  // ==========================================================================
  // INTERNAL — build
  // ==========================================================================

  /** Reads both tabs, normalizes, joins. The uncached path. */
  function _buildBundle_() {
    var orgRows = _readTab_(SHEET_NAMES.HC_ORGS);
    var posRows = _readTab_(SHEET_NAMES.HC_POSITIONS);

    var orgs = [];
    for (var o = 0; o < orgRows.length; o++) {
      if (!_bool_(orgRows[o]['Is_Active'], true)) continue;
      var org = _normalizeOrg_(orgRows[o]);
      if (org.orgCode) orgs.push(org);
    }

    var positions = [];
    for (var p = 0; p < posRows.length; p++) {
      if (!_bool_(posRows[p]['Is_Active'], true)) continue;
      var pos = _normalizePosition_(posRows[p]);
      if (pos.positionNumber) positions.push(pos);
    }

    return {
      positions: _joinOrgs_(positions, orgs),
      orgs: orgs
    };
  }

  // ==========================================================================
  // PUBLIC — the four functions the inherited code calls
  // ==========================================================================

  /**
   * The enriched staffing bundle.
   *
   * Return shape is asserted by consumers at Request.js:59 and
   * hcDataCenterService.html:127 — both check `result.success && result.data`
   * and treat anything else as unavailable.
   *
   * Never throws. Every inherited caller wraps this in a try/catch that
   * degrades silently, so throwing would buy nothing; returning
   * { success: false } keeps the failure visible in the return value AND in
   * the log.
   *
   * @returns {{success: boolean, data: Array, count: number, lastRefreshed: string, error?: string}}
   */
  function hcGetBundle() {
    try {
      var cached = _cacheGet_(CACHE_KEY_BUNDLE);
      if (cached) {
        var meta = _cacheGet_(CACHE_KEY_META) || {};
        return {
          success: true,
          data: cached,
          count: cached.length,
          lastRefreshed: meta.lastRefreshed || '',
          cached: true
        };
      }

      var built = _buildBundle_();
      var now = new Date().toISOString();
      _cachePut_(CACHE_KEY_BUNDLE, built.positions, CACHE_CONFIG.TTL.LONG);
      _cachePut_(CACHE_KEY_META, { lastRefreshed: now }, CACHE_CONFIG.TTL.LONG);

      return {
        success: true,
        data: built.positions,
        count: built.positions.length,
        lastRefreshed: now,
        cached: false
      };
    } catch (e) {
      console.error('HC.hcGetBundle failed: ' + e.message);
      return { success: false, error: e.message, data: [], count: 0, lastRefreshed: '' };
    }
  }

  /**
   * The org hierarchy, as a FLAT ARRAY — not a tree.
   *
   * OrgLookup.js:41 and :99 both iterate it with a plain for loop and index
   * into `.orgCode`, so the return type is an array, NOT the { success, data }
   * envelope hcGetBundle uses. The two inherited functions disagree on shape;
   * this reproduces that faithfully rather than tidying it, because tidying it
   * would break six call sites.
   *
   * Returns [] on failure for the same reason — OrgLookup.js wraps the call in
   * try/catch and an empty array degrades to empty lookups.
   *
   * @returns {Array<{orgCode, officeCode, businessUnit, sector, division, status, formerOrgCodes}>}
   */
  function hcGetOrgHierarchy() {
    try {
      var cached = _cacheGet_(CACHE_KEY_ORGS);
      if (cached) return cached;

      var built = _buildBundle_();
      _cachePut_(CACHE_KEY_ORGS, built.orgs, CACHE_CONFIG.TTL.LONG);
      return built.orgs;
    } catch (e) {
      console.error('HC.hcGetOrgHierarchy failed: ' + e.message);
      return [];
    }
  }

  /**
   * Rebuilds the cache from the sheet and returns the position count.
   *
   * CacheWarming.js:58 uses the return value directly:
   *   var count = HC.hcRefreshBundleCache();
   * so this must return a NUMBER, not an object.
   *
   * @returns {number} positions cached
   */
  function hcRefreshBundleCache() {
    try {
      var built = _buildBundle_();
      var now = new Date().toISOString();
      _cachePut_(CACHE_KEY_BUNDLE, built.positions, CACHE_CONFIG.TTL.LONG);
      _cachePut_(CACHE_KEY_ORGS,   built.orgs,      CACHE_CONFIG.TTL.LONG);
      _cachePut_(CACHE_KEY_META,   { lastRefreshed: now }, CACHE_CONFIG.TTL.LONG);
      console.log('HC.hcRefreshBundleCache: cached ' + built.positions.length +
                  ' positions, ' + built.orgs.length + ' orgs');
      return built.positions.length;
    } catch (e) {
      console.error('HC.hcRefreshBundleCache failed: ' + e.message);
      return 0;
    }
  }

  /**
   * Drops every HC cache entry. The next read rebuilds from the sheet.
   *
   * Call after any write to HC_Positions or HC_Orgs — the admin GUI does this
   * on save. Without it, an edit is invisible for up to CACHE_CONFIG.TTL.LONG
   * (6 hours), which is long enough to look like the edit did not save.
   */
  function hcCacheInvalidateAll() {
    try {
      _cache_().removeAll([CACHE_KEY_BUNDLE, CACHE_KEY_ORGS, CACHE_KEY_META]);
      console.log('HC.hcCacheInvalidateAll: cleared');
      return true;
    } catch (e) {
      console.warn('HC.hcCacheInvalidateAll failed: ' + e.message);
      return false;
    }
  }

  // ==========================================================================
  // PUBLIC — LETS additions (not part of the inherited interface)
  // ==========================================================================

  /**
   * Walks up the supervisor chain from a position until `predicate` matches.
   *
   * Reproduces the traversal that Request.js:124 (_findDDFromBundle) and
   * hcDataCenterService.html:258 (walkSupervisorChain) each implement
   * separately. Both cap depth at 15 and track visited nodes, because a
   * data-entry mistake can make A report to B and B report to A — and without
   * cycle protection that is an infinite loop inside a web request.
   *
   * Exposed so the admin GUI can reject a cycle at WRITE time instead of every
   * reader having to survive one.
   *
   * @param {string} positionNumber starting position
   * @param {function(Object): boolean} predicate
   * @param {Array} [positions] pre-fetched bundle data, to avoid re-reading
   * @param {number} [maxDepth=15]
   * @returns {Object|null} the matching supervisor position, or null
   */
  function hcWalkSupervisorChain(positionNumber, predicate, positions, maxDepth) {
    maxDepth = maxDepth || 15;

    if (!positions) {
      var bundle = hcGetBundle();
      if (!bundle.success) return null;
      positions = bundle.data;
    }

    var byPn = {};
    for (var i = 0; i < positions.length; i++) {
      byPn[positions[i].positionNumber] = positions[i];
    }

    var current = byPn[String(positionNumber).trim()];
    if (!current) return null;

    var visited = {};
    var nextPn = current.reportsToPositionNumber;
    var depth = 0;

    while (nextPn && depth < maxDepth) {
      if (visited[nextPn]) {
        console.warn('HC: supervisor cycle detected at position ' + nextPn);
        return null;
      }
      visited[nextPn] = true;

      var supervisor = byPn[nextPn];
      if (!supervisor) return null;
      if (predicate(supervisor)) return supervisor;

      nextPn = supervisor.reportsToPositionNumber;
      depth++;
    }
    return null;
  }

  /**
   * Finds the nearest staffed GS-15 above a position — the Division Director
   * used for approval routing.
   *
   * Mirrors the predicate at Request.js:137 exactly, including the
   * `occupancyStatus !== 'VACANT'` requirement: an empty GS-15 seat cannot
   * approve travel, so the walk must continue past it.
   *
   * @returns {{ddName: string, ddEmail: string}} empty strings when none found
   */
  function hcFindDivisionDirector(positionNumber, positions) {
    var dd = hcWalkSupervisorChain(positionNumber, function (sup) {
      return sup.grade === '15' && sup.occupancyStatus !== 'VACANT';
    }, positions);

    return dd
      ? { ddName: dd.employeeName || '', ddEmail: dd.emailAddress || '' }
      : { ddName: '', ddEmail: '' };
  }

  /**
   * Reduced projection for the public org chart.
   *
   * Emits ONLY workgroup name, supervisor name and employee names — no email,
   * grade, position number, duty station, employee ID or occupancy status.
   *
   * The tree is resolved HERE, server-side, and the client receives
   * { name, title, org, children }. Position numbers are the join keys, so
   * sending the flat list and letting the browser assemble the tree would put
   * every identifier in the page source. The org chart deployment is reachable
   * by any domain user with the link, so that reduction is the access control.
   *
   * Vacant seats are omitted entirely rather than shown as "Vacant" — a public
   * chart should not advertise which positions are unfilled.
   *
   * @returns {{success: boolean, roots: Array, count: number, error?: string}}
   */
  function hcGetOrgChartTree() {
    try {
      var bundle = hcGetBundle();
      if (!bundle.success) {
        return { success: false, error: bundle.error || 'bundle unavailable', roots: [], count: 0 };
      }

      // Index EVERY position, vacant included. The vacant ones are needed as
      // waypoints for the reparenting walk below, then discarded. Only
      // `staffed` becomes nodes.
      var allByPn = {};
      for (var a = 0; a < bundle.data.length; a++) {
        allByPn[bundle.data[a].positionNumber] = bundle.data[a];
      }

      var staffed = bundle.data.filter(function (p) {
        return p.occupancyStatus !== 'VACANT' && p.employeeName;
      });

      // Build nodes keyed by position number. The key is used only inside this
      // function and is dropped before returning.
      var nodes = {};
      for (var i = 0; i < staffed.length; i++) {
        var p = staffed[i];
        nodes[p.positionNumber] = {
          name: p.employeeName,
          title: p.officeTitle || '',
          org: (p.org && p.org.businessUnit) || p.orgCode || '',
          children: [],
          _pn: p.positionNumber,
          _parent: p.reportsToPositionNumber
        };
      }

      /**
       * Nearest STAFFED ancestor of a position.
       *
       * Vacant seats are omitted from the chart, which would orphan anyone
       * reporting to one. In the seed data Yevgenia Taraschuk reports to a
       * vacant GS-15 deputy; without this walk she renders as a second
       * top-level root, visually implying she is a peer of the Assistant
       * Commissioner rather than two levels below.
       *
       * Skipping the empty seat matches both the real reporting line (people
       * report to whoever actually holds the chain above them) and what
       * approval routing already does — Request.js:137 requires
       * `occupancyStatus !== 'VACANT'` and walks past empty seats to find a
       * Division Director who can act.
       *
       * Cycle-guarded and depth-capped for the same reason
       * hcWalkSupervisorChain is: a data-entry mistake that makes A report to
       * B and B report to A would otherwise be an infinite loop inside a web
       * request, i.e. a hung page rather than an error.
       */
      function nearestStaffedAncestor(startPn) {
        var seen = {};
        var cursor = startPn;
        var depth = 0;
        while (cursor && depth < 15) {
          if (seen[cursor]) {
            console.warn('HC: org chart cycle detected at position ' + cursor);
            return null;
          }
          seen[cursor] = true;

          if (nodes[cursor]) return nodes[cursor];   // staffed — done

          var pos = allByPn[cursor];
          if (!pos) return null;                     // dangling pointer
          cursor = pos.reportsToPositionNumber;      // vacant — keep climbing
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

      // Strip the internal keys so no position number reaches the browser.
      function scrub(node) {
        delete node._pn;
        delete node._parent;
        node.children.sort(function (a, b) { return a.name.localeCompare(b.name); });
        node.children.forEach(scrub);
        return node;
      }
      roots.forEach(scrub);
      roots.sort(function (a, b) { return a.name.localeCompare(b.name); });

      return { success: true, roots: roots, count: staffed.length };
    } catch (e) {
      console.error('HC.hcGetOrgChartTree failed: ' + e.message);
      return { success: false, error: e.message, roots: [], count: 0 };
    }
  }

  // ==========================================================================

  return {
    // Inherited interface — names fixed by 28 existing call sites.
    hcGetBundle:            hcGetBundle,
    hcGetOrgHierarchy:      hcGetOrgHierarchy,
    hcRefreshBundleCache:   hcRefreshBundleCache,
    hcCacheInvalidateAll:   hcCacheInvalidateAll,

    // LETS additions.
    hcWalkSupervisorChain:  hcWalkSupervisorChain,
    hcFindDivisionDirector: hcFindDivisionDirector,
    hcGetOrgChartTree:      hcGetOrgChartTree,

    // Exposed for unit tests only. Prefixed to signal that consumers should
    // not call them; they bypass caching and the org join.
    _normalizePosition:     _normalizePosition_,
    _normalizeOrg:          _normalizeOrg_,
    _grade:                 _grade_,
    _occupancy:             _occupancy_,
    _joinOrgs:              _joinOrgs_
  };
})();

// Node/CommonJS export for the test suites. Apps Script has no `module`, so
// this is inert there — the same pattern 00_config/BudgetConfig.js uses.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HC;
}
