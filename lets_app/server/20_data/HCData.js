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
      // STORED, not derived from the code length. Reading the parent off
      // length gave the wrong tree: FCBA is under FCB, not FCA, and the '0'
      // in FCA0A is a filler rather than a level. See HCSeed.js HC_REAL_ORGS.
      parentOrgCode:  _str_(row['Parent_Org_Code']).toUpperCase(),
      // AC | DAC | OFFICE | SERVICE_CENTER | DIVISION | BRANCH. SERVICE_CENTER
      // is how a Service Center Director is identified.
      orgLevel:       _str_(row['Org_Level']).toUpperCase(),
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
      var code = _str_(positions[p].orgCode).toUpperCase();
      var org = resolveOrgByCode(code, byCode);
      if (!org) continue;

      // IDENTITY comes from the position's OWN row: FCA0A is the Portfolio
      // Management Service Center, not "Office of Mission Delivery".
      positions[p].org.resolvedOrgCode = org.orgCode;
      positions[p].org.division        = org.division || '';

      // ATTRIBUTION is INHERITED, because only the four top-level rows carry
      // a budget key — see inheritOrgField.
      positions[p].org.businessUnit = inheritOrgField(code, byCode, 'businessUnit');
      positions[p].org.sector       = inheritOrgField(code, byCode, 'sector');
      positions[p].org.officeCode   = inheritOrgField(code, byCode, 'officeCode');
    }
    return positions;
  }

  /**
   * Walks UP the prefix chain for a field the position's own org row leaves
   * blank.
   *
   * WHY THIS IS SEPARATE FROM resolveOrgByCode
   * ------------------------------------------
   * This is the trap that the prefix fix alone would have fallen into, and it
   * is worth being explicit about because it fails SILENTLY.
   *
   * @clolry supplied the real list: 137 org codes, six levels deep. Once all
   * 137 are rows in HC_Orgs, FCA0A has an EXACT match — and
   * resolveOrgByCode prefers an exact match, correctly, because FCA0A's NAME
   * is "Portfolio Management Service Center" and not its parent's.
   *
   * But only FC, FCA, FCB and FCC carry an Office_Code, because only those
   * four are budget offices in BudgetConfig.js. So an exact match would have
   * returned a BLANK budget key for all 133 sub-orgs — and blank is exactly
   * what the bug @clolry reported produced. The fix would have moved the
   * failure rather than removed it, and the symptom would have looked
   * identical.
   *
   * Identity resolves DOWN to the most specific row; attribution resolves UP
   * to the nearest ancestor that actually has a value. They are different
   * questions about the same code.
   *
   * A sub-org MAY override an inherited value by filling the cell in its own
   * HC_Orgs row — a reorganization that moves a service center to a different
   * DAC is one row, not a code change.
   *
   * @param {string} code position's own org code, already uppercased
   * @param {Object} byCode orgCode -> org record
   * @param {string} field which value to inherit
   * @returns {string} '' when no ancestor supplies it
   */
  function inheritOrgField(code, byCode, field) {
    var best = null;
    var bestLen = -1;
    Object.keys(byCode).forEach(function (key) {
      if (code.indexOf(key) !== 0) return;              // not an ancestor
      if (!_str_(byCode[key][field])) return;           // has nothing to give
      if (key.length <= bestLen) return;                // a nearer one wins
      best = byCode[key];
      bestLen = key.length;
    });
    return best ? _str_(best[field]) : '';
  }

  /**
   * Resolves a position's org code to an HC_Orgs row by LONGEST PREFIX.
   *
   * WHY PREFIX MATCHING
   * -------------------
   * @clolry: "Our org has hundreds of different codes under FC." The codes are
   * hierarchical — FCA0A sits under FCA, which sits under FC — and only the
   * four top-level codes carry a budget office key.
   *
   * An exact-match join therefore failed for every real code. @clolry entered
   * FCA0A-0008 and got "Org_Code FCA0A has no matching HC_Orgs row. Business
   * unit and sector will be blank", with no way to fix it: the editor's org
   * dropdown offered only the four parents, and maintaining hundreds of
   * HC_Orgs rows by hand would be worse than the problem.
   *
   * Longest prefix wins, so FCA0A resolves to FCA (3 chars) rather than FC
   * (2 chars). That matters: FC is a prefix of every other code, so a
   * shortest-match or first-match rule would attribute all travel to the
   * Front Office.
   *
   * An exact match always wins outright, so adding a specific HC_Orgs row for
   * a sub-org overrides the derivation. With @clolry's real list loaded, all
   * 137 codes ARE rows, so this is usually an exact match — the prefix walk is
   * what keeps a code missing from the list working anyway.
   *
   * This resolves IDENTITY only. Budget key, business unit and sector are
   * INHERITED separately by inheritOrgField, because only the four top-level
   * rows carry them.
   *
   * @param {string} code the position's Org_Code
   * @param {Object} byCode orgCode -> org record, including former codes
   * @returns {Object|null}
   */
  function resolveOrgByCode(code, byCode) {
    var c = _str_(code).toUpperCase();
    if (!c) return null;

    // Exact match first: a specific row overrides prefix derivation.
    if (byCode[c]) return byCode[c];

    var best = null;
    var bestLen = 0;
    Object.keys(byCode).forEach(function (key) {
      if (c.indexOf(key) !== 0) return;          // not a prefix
      if (key.length <= bestLen) return;          // shorter than current best
      best = byCode[key];
      bestLen = key.length;
    });
    return best;
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

  /**
   * Writes one cache entry. Returns false when the payload is too large.
   *
   * @param {string} key
   * @param {*} value
   * @param {number} ttlSeconds
   * @param {boolean} [chunkFallbackFollows] the caller will chunk on false.
   *        AN OVERSIZE PAYLOAD IS THE DESIGNED PATH FOR THE ROSTER, not a
   *        failure: the real roster is 514KB against a 90KB cap, so every
   *        single run logged
   *
   *          HC: payload 514154 bytes exceeds the 90000-byte cache limit
   *
   *        as a WARNING, immediately followed by 'HC: cached 1046 positions in
   *        chunks'. The chunking worked; the warning said otherwise, and a log
   *        that cries wolf on its own healthy path is how a real warning gets
   *        scrolled past. So a caller that is about to chunk says so, and this
   *        reports the size at log level instead.
   * @returns {boolean}
   */
  function _cachePut_(key, value, ttlSeconds, chunkFallbackFollows) {
    try {
      var raw = JSON.stringify(value);
      if (raw.length > CACHE_MAX_BYTES) {
        // Do not attempt the put. CacheService rejects oversized values and
        // the failure is easy to miss, producing a permanent silent cache miss
        // that re-reads the sheet on every single request.
        if (chunkFallbackFollows) {
          console.log(
            'HC: payload ' + raw.length + ' bytes exceeds the ' +
            CACHE_MAX_BYTES + '-byte single-entry cache limit for "' + key +
            '"; chunking instead.');
        } else {
          console.warn(
            'HC: payload ' + raw.length + ' bytes exceeds the ' + CACHE_MAX_BYTES +
            '-byte cache limit for "' + key + '". Serving uncached. If the roster ' +
            'has grown past this, HCData.js needs chunked caching (see ' +
            'CACHE_CONFIG.CHUNK_SIZE in 01_constants/Cache.js for the established pattern).');
        }
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
  // INTERNAL — chunked cache, for payloads past the 100KB single-entry cap
  // ==========================================================================
  //
  // THE WARNING THAT PROMPTED THIS WAS CORRECT AND IS NOW LIVE.
  //
  //   HC: payload 514154 bytes exceeds the 90000-byte cache limit for
  //   "hc_bundle_v1". Serving uncached.
  //
  // The real roster is 1,046 positions and 514KB — 5.7x the cap. The guard
  // above did its job: it refused the put rather than letting CacheService
  // reject it silently, and said what to do. But "serving uncached" means
  // _buildBundle_ reads BOTH HC tabs and re-runs the org join on EVERY call,
  // and hcGetBundle is called by the access gate on every page load, by the
  // reviewer dashboards, by the budget dashboard and by the org chart.
  //
  // Three seconds of sheet reads per page, forever, is not a stable state —
  // and it is the kind of regression that reads as "the app got slow" rather
  // than as a cache that stopped working.
  //
  // WHY putAll/getAll AND NOT A LOOP
  // --------------------------------
  // CacheService.putAll and getAll are single round trips. A loop of put()
  // calls over 7 chunks is 7 round trips on every cache write, which at this
  // payload size costs more than it saves.
  //
  // THE MANIFEST IS WRITTEN LAST AND READ FIRST
  // -------------------------------------------
  // A reader that found chunk 0 and assumed the rest were present would
  // deserialize a truncated roster — and a roster missing its last 150 people
  // is indistinguishable from a roster where those people left. Both are
  // "valid" JSON of the right shape.
  //
  // So the manifest records the chunk COUNT and the total length, it is
  // written after every chunk, and the reader verifies that every chunk is
  // present and that the reassembled string is exactly the expected length
  // before parsing. Any mismatch is a miss, not a partial result. Chunks
  // expiring individually is normal — CacheService evicts under pressure — and
  // this is what makes that safe rather than silently lossy.

  var CACHE_CHUNK_BYTES = 90000;

  /** Chunk key for index i. Versioned with the base key. */
  function _chunkKey_(key, i) {
    return key + '__c' + i;
  }

  function _chunkManifestKey_(key) {
    return key + '__m';
  }

  /**
   * Writes a large value across several cache entries.
   *
   * @returns {boolean} true when every chunk and the manifest were written
   */
  function _cachePutChunked_(key, value, ttlSeconds) {
    try {
      var raw = JSON.stringify(value);
      var total = raw.length;
      var count = Math.ceil(total / CACHE_CHUNK_BYTES);

      // CacheService allows ~1000 entries per put; well past anything a
      // roster will reach, but a runaway payload should fail loudly rather
      // than write 10,000 keys.
      if (count > 50) {
        console.warn('HC: ' + total + ' bytes would need ' + count +
                     ' chunks for "' + key + '"; refusing. Serving uncached.');
        return false;
      }

      var entries = {};
      for (var i = 0; i < count; i++) {
        entries[_chunkKey_(key, i)] =
          raw.substring(i * CACHE_CHUNK_BYTES, (i + 1) * CACHE_CHUNK_BYTES);
      }
      // The manifest goes in the SAME putAll, so there is no window in which
      // chunks exist without it.
      entries[_chunkManifestKey_(key)] =
        JSON.stringify({ chunks: count, length: total });

      _cache_().putAll(entries, ttlSeconds);
      return true;
    } catch (e) {
      console.warn('HC: chunked cache write failed for ' + key + ': ' + e.message);
      return false;
    }
  }

  /**
   * Reads a chunked value back, or null.
   *
   * Returns null unless the manifest and EVERY chunk are present and the
   * reassembled length matches exactly. A partial read is a miss.
   */
  function _cacheGetChunked_(key) {
    try {
      var manifestRaw = _cache_().get(_chunkManifestKey_(key));
      if (!manifestRaw) return null;

      var manifest = JSON.parse(manifestRaw);
      var count = parseInt(manifest.chunks, 10);
      if (!count || count < 1) return null;

      var keys = [];
      for (var i = 0; i < count; i++) keys.push(_chunkKey_(key, i));

      var got = _cache_().getAll(keys);
      var parts = [];
      for (var j = 0; j < count; j++) {
        var part = got[_chunkKey_(key, j)];
        // A single evicted chunk makes the whole value unusable. Treating it
        // as a miss costs one sheet read; treating it as data would serve a
        // truncated roster.
        if (part === null || part === undefined) return null;
        parts.push(part);
      }

      var raw = parts.join('');
      if (raw.length !== manifest.length) {
        console.warn('HC: chunked cache for "' + key + '" reassembled to ' +
                     raw.length + ' bytes, expected ' + manifest.length +
                     '. Treating as a miss.');
        return null;
      }
      return JSON.parse(raw);
    } catch (e) {
      console.warn('HC: chunked cache read failed for ' + key + ': ' + e.message);
      return null;
    }
  }

  /** Removes a chunked value's manifest and chunks. */
  function _cacheRemoveChunked_(key) {
    try {
      var manifestRaw = _cache_().get(_chunkManifestKey_(key));
      var keys = [_chunkManifestKey_(key)];
      if (manifestRaw) {
        var count = parseInt(JSON.parse(manifestRaw).chunks, 10) || 0;
        for (var i = 0; i < count; i++) keys.push(_chunkKey_(key, i));
      } else {
        // No manifest: remove a generous fixed range so orphaned chunks from
        // an interrupted write cannot be reassembled by a later read.
        for (var k = 0; k < 50; k++) keys.push(_chunkKey_(key, k));
      }
      _cache_().removeAll(keys);
    } catch (e) {
      console.warn('HC: chunked cache clear failed for ' + key + ': ' + e.message);
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
      // CHUNKED FIRST, then the single-entry form.
      //
      // Both are tried because the two coexist in practice: a deploy that
      // switches to chunking leaves a single-entry value live for up to six
      // hours, and an environment whose roster is small enough still writes
      // one. Reading only the chunked form would discard a warm cache for no
      // reason; reading only the single form is what produced the 514KB
      // "serving uncached" warning on every page load.
      var cached = _cacheGetChunked_(CACHE_KEY_BUNDLE) ||
                   _cacheGet_(CACHE_KEY_BUNDLE);
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

      // Try the single entry first — it is one round trip and most
      // deployments' rosters fit. _cachePut_ returns false rather than
      // throwing when the payload is too large, which is the signal to chunk.
      //
      // The fourth argument tells it a chunked write follows, so the size
      // report is a log rather than a warning: on this roster the oversize
      // branch is the NORMAL path and warning about it buried the real ones.
      if (!_cachePut_(CACHE_KEY_BUNDLE, built.positions, CACHE_CONFIG.TTL.LONG,
                      true)) {
        if (_cachePutChunked_(CACHE_KEY_BUNDLE, built.positions,
                              CACHE_CONFIG.TTL.LONG)) {
          console.log('HC: cached ' + built.positions.length +
                      ' positions in chunks.');
        } else {
          // NOW it is a real failure: neither form stored anything, so every
          // subsequent call re-reads both HC tabs and re-runs the org join.
          console.warn('HC: could not cache the bundle in a single entry OR ' +
                       'in chunks. Serving uncached — expect seconds of ' +
                       'sheet reads on every page load.');
        }
      }
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

      // Stale chunks are removed BEFORE the write, not after. Writing N
      // chunks over a previous set of N+2 leaves two orphans, and the
      // manifest's count would stop the reader seeing them — but only until
      // the next write produced a LONGER value, at which point the reader
      // would reassemble a mixture of two generations. Clearing first makes
      // that impossible rather than improbable.
      _cacheRemoveChunked_(CACHE_KEY_BUNDLE);

      if (!_cachePut_(CACHE_KEY_BUNDLE, built.positions, CACHE_CONFIG.TTL.LONG,
                      true)) {
        _cachePutChunked_(CACHE_KEY_BUNDLE, built.positions, CACHE_CONFIG.TTL.LONG);
      }
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
      // THE CHUNKS TOO. Without this, clearing the cache after a roster import
      // removes the single-entry key and leaves the chunk set live for six
      // hours — so hcGetBundle, which reads chunked FIRST, keeps serving the
      // pre-import roster. The invalidation would appear to work and the app
      // would show the old data, which is the worst of both.
      _cacheRemoveChunked_(CACHE_KEY_BUNDLE);
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
   * Which org code a position's travel budget belongs to, at a given level.
   *
   * Walks UP the STORED Parent_Org_Code chain until it reaches a row whose
   * Org_Level matches, and returns that code.
   *
   * WHY THE STORED PARENT AND NOT THE CODE'S LENGTH
   * -----------------------------------------------
   * Deriving the tree from code length produced a wrong answer and it was not
   * obvious: FCBA is under FCB, not FCA, and the '0' in FCA0A is a filler, so
   * FCA0A's parent is FCA and FCA0 does not exist. Depth also varies by branch
   * — FCA has no OFFICE level while FCB and FCC do — so FCA0A is two levels
   * deep where FCBAA is three. Commit e421c98 stored both columns for exactly
   * this reason.
   *
   * CYCLE PROTECTION IS NOT THEORETICAL. HC_Orgs is hand-maintainable and a
   * typo making FCA the parent of FC would hang the walk. The visited set
   * returns null instead, so one bad row costs one position's attribution
   * rather than the whole dashboard.
   *
   * @param {string} code      the position's Org_Code
   * @param {Object} byCode    orgCode -> org record
   * @param {string} wantLevel 'SERVICE_CENTER' | 'DAC' | 'OFFICE' | ...
   * @returns {string} the matching ancestor's code, or '' when none
   */
  function orgAncestorAtLevel(code, byCode, wantLevel) {
    var want = _str_(wantLevel).toUpperCase();
    if (!want) return '';

    // Start from the resolved row, not from the raw string: a code absent from
    // HC_Orgs still resolves to its nearest listed ancestor by prefix, so a
    // position in an uncataloged sub-org is attributed rather than dropped.
    var node = resolveOrgByCode(code, byCode);
    var visited = {};
    var depth = 0;

    while (node && depth < 25) {
      var nodeCode = _str_(node.orgCode).toUpperCase();
      if (visited[nodeCode]) {
        console.warn('HC.orgAncestorAtLevel: parent cycle at org ' + nodeCode);
        return '';
      }
      visited[nodeCode] = true;

      if (_str_(node.orgLevel).toUpperCase() === want) return nodeCode;

      var parent = _str_(node.parentOrgCode).toUpperCase();
      if (!parent) return '';
      node = byCode[parent] || null;
      depth++;
    }
    return '';
  }

  /**
   * Filled and authorized headcount per service center.
   *
   * THIS IS THE DENOMINATOR FOR THE PER-CAPITA BUDGET SPLIT, so what it counts
   * is a policy decision, not an implementation detail.
   *
   * @clolry chose FILLED positions: a vacant seat does not travel. Both counts
   * are returned regardless, because the choice is only auditable if the
   * dashboard can show what the other basis would have been. On the real
   * roster the difference is large and uneven — FCC0B is 9 filled against 8
   * vacant, and switching basis would nearly double its allocation.
   *
   * KEYED ON ORG CODE, NEVER ON NAME
   * --------------------------------
   * @clolry: "Due to the service center name repetition, please ensure nothing
   * ever is based on the name and that we always use the org code."
   *
   * He is right and it is not a style preference. 'Acquisition Service Center
   * 1' is BOTH FCBAB (under Office of MAS) and FCBBA (under Office of Non-MAS),
   * and the same holds for 2 and 3. A name-keyed roll-up would silently merge
   * six real service centers into three and hand one DAC's money to another.
   * `displayName` is carried for rendering only; test_budget_per_capita.js
   * §2 asserts no allocation path reads it.
   *
   * POSITIONS ABOVE THE SERVICE-CENTER LEVEL ARE NOT DISCARDED
   * ----------------------------------------------------------
   * 17 people sit directly at a DAC or office code, above any service center.
   * They are returned under orgCode '' with `isAboveServiceCenter: true`, so
   * they still draw a per-capita share. Dropping them would inflate every
   * service center's share of its DAC and the total would still foot, which is
   * the kind of error nobody finds.
   *
   * @param {Array} [positions] pre-fetched bundle, to avoid a second read
   * @returns {{success: boolean, byOrgCode: Object, byDac: Object,
   *            counted: number, unattributed: number, error?: string}}
   */
  function hcServiceCenterHeadcount(positions) {
    try {
      var data = positions;
      if (!data) {
        var bundle = hcGetBundle();
        if (!bundle.success) {
          return {
            success: false, error: bundle.error || 'bundle unavailable',
            byOrgCode: {}, byDac: {}, counted: 0, unattributed: 0
          };
        }
        data = bundle.data;
      }

      var orgs = hcGetOrgHierarchy();
      var byCode = {};
      for (var o = 0; o < orgs.length; o++) {
        byCode[_str_(orgs[o].orgCode).toUpperCase()] = orgs[o];
      }

      var byOrgCode = {};
      var byDac = {};
      var counted = 0;
      var unattributed = 0;

      for (var i = 0; i < data.length; i++) {
        var p = data[i];
        if (!p) continue;

        var dac = orgAncestorAtLevel(p.orgCode, byCode, 'DAC');
        if (!dac) {
          // The AC itself (FC) has no DAC ancestor and is its own pool.
          dac = orgAncestorAtLevel(p.orgCode, byCode, 'AC');
        }
        if (!dac) { unattributed++; continue; }

        var sc = orgAncestorAtLevel(p.orgCode, byCode, 'SERVICE_CENTER');
        var key = dac + '|' + sc;          // '' sc = above the SC level

        if (!byOrgCode[key]) {
          byOrgCode[key] = {
            orgCode: sc,
            dacOrgCode: dac,
            isAboveServiceCenter: !sc,
            // Display only. Not a key, never compared.
            displayName: sc ? _str_((byCode[sc] || {}).division) : '',
            filled: 0, vacant: 0, authorized: 0
          };
        }
        if (!byDac[dac]) byDac[dac] = { filled: 0, vacant: 0, authorized: 0 };

        // _occupancy_ already uppercased and defaulted blank to FILLED, so
        // this is an exact comparison rather than a defensive one. OBLIGATED
        // counts as NOT filled: the seat is committed to someone who is not
        // in it yet, so nobody travels against it this year.
        var isFilled = p.occupancyStatus === 'FILLED';

        byOrgCode[key].authorized++;
        byDac[dac].authorized++;
        if (isFilled) { byOrgCode[key].filled++; byDac[dac].filled++; }
        else { byOrgCode[key].vacant++; byDac[dac].vacant++; }
        counted++;
      }

      return {
        success: true,
        byOrgCode: byOrgCode,
        byDac: byDac,
        counted: counted,
        unattributed: unattributed
      };
    } catch (e) {
      console.error('HC.hcServiceCenterHeadcount failed: ' + e.message);
      return {
        success: false, error: e.message,
        byOrgCode: {}, byDac: {}, counted: 0, unattributed: 0
      };
    }
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

      // DETACHED CYCLES. Found while building the org chart project's own
      // reader, which is a second implementation of this function and is
      // tested against it.
      //
      // nearestStaffedAncestor guards a cycle that passes through a VACANT
      // seat, because it walks until it finds a staffed one. It does NOT
      // guard a cycle between two STAFFED positions: both lookups succeed on
      // their first hop, so A becomes B's child and B becomes A's child, and
      // the pair is a closed ring that nothing in `roots` points at.
      //
      // No error, no warning, no hang. Both people and EVERYONE BELOW THEM
      // disappear, while `count` still reports them — so a caller sees
      // "187 people" alongside a tree holding 140. A chart that is
      // confidently wrong is worse than one that fails.
      //
      // Detected by reachability rather than by a smarter walk: whatever
      // shape the bad data takes, a node the roots cannot reach is lost.
      var reachable = {};
      (function mark(list) {
        for (var m = 0; m < list.length; m++) {
          if (reachable[list[m]._pn]) continue;    // a ring inside a ring
          reachable[list[m]._pn] = true;
          mark(list[m].children);
        }
      })(roots);

      Object.keys(nodes).forEach(function (pn) {
        if (reachable[pn]) return;
        var orphan = nodes[pn];

        // Detach from the unreachable parent first, or the ring stays a ring
        // and the scrub walk below recurses forever.
        var parentPn = orphan._parent;
        while (parentPn && !nodes[parentPn]) {
          parentPn = allByPn[parentPn] ? allByPn[parentPn].reportsToPositionNumber : '';
        }
        if (parentPn && nodes[parentPn]) {
          var siblings = nodes[parentPn].children;
          var at = siblings.indexOf(orphan);
          if (at > -1) siblings.splice(at, 1);
        }

        roots.push(orphan);
        console.warn('HC: reporting cycle at position ' + pn + '; promoted to a ' +
                     'root so its subtree is not lost from the org chart.');

        // Re-mark: promoting this node may have made a whole subtree
        // reachable, and the other members of its ring must not be promoted
        // as well.
        (function mark(list) {
          for (var k = 0; k < list.length; k++) {
            if (reachable[list[k]._pn]) continue;
            reachable[list[k]._pn] = true;
            mark(list[k].children);
          }
        })([orphan]);
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

    // Per-capita budget support. Counts only — no names, no emails, no
    // position numbers — so these sit OUTSIDE the HCPrivacy allow-list rather
    // than being sanitized by it.
    hcServiceCenterHeadcount: hcServiceCenterHeadcount,
    orgAncestorAtLevel:       orgAncestorAtLevel,

    // Shared so the validator and the roster editor apply the SAME rule as
    // the join. A second implementation would disagree with the data.
    resolveOrgByCode:       resolveOrgByCode,
    inheritOrgField:        inheritOrgField,

    // Exposed for unit tests only. Prefixed to signal that consumers should
    // not call them; they bypass caching and the org join.
    _normalizePosition:     _normalizePosition_,
    _normalizeOrg:          _normalizeOrg_,
    _grade:                 _grade_,
    _occupancy:             _occupancy_,
    _joinOrgs:              _joinOrgs_,

    // Chunked cache internals, for the test suite. The real roster is 514KB —
    // 5.7x the single-entry cap — so the reassembly and partial-read
    // behavior is load-bearing and must be assertable without CacheService.
    _cachePutChunked:       _cachePutChunked_,
    _cacheGetChunked:       _cacheGetChunked_,
    _cacheRemoveChunked:    _cacheRemoveChunked_,
    // Exposed so a test can assert on its LOG LEVEL. An oversize payload is
    // the designed path for this roster, and warning about it on every page
    // load is what trained the reader to ignore the warning.
    _cachePut:              _cachePut_,
    _chunkKey:              _chunkKey_,
    _chunkManifestKey:      _chunkManifestKey_
  };
})();

// Node/CommonJS export for the test suites. Apps Script has no `module`, so
// this is inert there — the same pattern 00_config/BudgetConfig.js uses.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HC;
}
