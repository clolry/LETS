/**
 * TravelAccessControl.js
 *
 * SINGLE SOURCE OF TRUTH for "who is this user, and what can they see?"
 * in TRIP. Every access decision in the app — admin pill visibility,
 * Action Center scope, dashboard route guards, RPC permission checks —
 * funnels through this file.
 *
 * The one function callers should use:
 *   getReviewerContext(email?, viewAs?, sharedDb?) → {
 *     email, role, scope: { type, codes, names },
 *     label, isAdmin, isReviewer, viewAsActive, viewAsLabel
 *   }
 *
 * Role priority (first match wins):
 *   admin → oso → bu → bu-lead-by-title (COS/CE) → sector → none
 *
 * Scope shapes:
 *   admin / oso  →  type: 'all'                (full org)
 *   bu           →  type: 'bu'    + codes/names of BUs
 *   sector       →  type: 'sector' + codes/names of sectors
 *   none         →  type: 'none'              (locked out)
 *
 * Used by:
 *   - serveReviewerDashboardPage()  — gate access
 *   - getReviewerDashboard()        — derive scope filters server-side
 *   - getAdminDashboard()           — gated by requireTravelAdmin()
 *   - Submission routing            — uses isSectorDirector / isActiveBUReviewer
 *
 * NOTE on data accessors that live elsewhere:
 *   - getOSOReviewers() lives in TravelSubmissionService.js (multi-consumer:
 *     used by routing too, kept there as the data layer).
 *
 * ──────────────────────────────────────────────────────────────────────
 * ADDING A NEW ROLE
 * ──────────────────────────────────────────────────────────────────────
 *  1. Define a detector function below (e.g. isXRole(email, db?) returning
 *     a match object with the BU/sector codes the role implies).
 *  2. Add a branch in getReviewerContext() at the right priority slot.
 *     Pick scope shape based on what the role should see:
 *       - all-org access     → type: 'all'
 *       - one or more BUs    → type: 'bu'
 *       - one or more sectors→ type: 'sector'
 *  3. Set ctx.label to a human-readable role+scope ("Chief of Staff · Army").
 *  4. If the role should be guard-able (throw on missing access), add a
 *     case in requireRole() at the bottom of this file.
 */

// ============================================================================
// SECTOR DIRECTOR — position-first auto-derive with occupancy gate + override
// ============================================================================

/**
 * Resolve the active Service Center Director for an org code.
 *
 * WHAT WAS WRONG, AND HOW LONG IT WAS WRONG FOR
 * ---------------------------------------------
 * This used to identify an SCD by matching officeTitle against the literal
 * string 'sector director'. @clolry: "We don't call them Sector Directors, we
 * call them Service Center Directors."
 *
 * No position in this organization carries that title. Measured by
 * diagServiceCenterDirectors on the live roster: of the 22 service centers'
 * supervisory occupants, the titles are 9x Supervisory Contract Specialist,
 * 3x Program Analysis Officer, 2x Supervisory Program Analyst, and nine
 * others. The count of titles containing 'sector director' is ZERO.
 *
 * So this returned null for every submission, determineInitialRouting took
 * its "no SD found" branch, and every request in LETS started at the DAC
 * stage. Nothing errored. The service-center review stage simply never
 * happened, and Sector_Director_Name was blank on every row — which was
 * accurate, because no SCD had ever reviewed anything.
 *
 * THE RULE NOW, AND WHY EACH PART OF IT
 * -------------------------------------
 * A Service Center Director is the most senior supervisory person whose own
 * Dept ID sits at the SERVICE_CENTER level of the org hierarchy.
 *
 *   SERVICE_CENTER level, read from HC_Orgs.Org_Level via
 *   HC.orgAncestorAtLevel        NOT a 4- or 5-character truncation of the
 *                                org code. Depth varies by branch: FCA has no
 *                                sub-office level while FCB and FCC do, so
 *                                FCA0A is two levels deep and FCBAA three.
 *                                And a person ABOVE a service center has none
 *                                at all, which a truncation cannot express.
 *
 *   supervisory means != 8       isHcSupervisoryCode. The old rule demanded
 *                                exactly '2', which excluded the 13 people
 *                                whose HR record says Supervisor (CSRA),
 *                                Management Official (CSRA) or Team Leader.
 *                                That is why FCA0A had no director at all.
 *
 *   the seat must be occupied    isHcSeatOccupied. A vacant seat cannot
 *                                approve travel. This is also the tie-break
 *                                for the two centers that showed multiple
 *                                supervisory rows: at FCA0E and FCC0B the
 *                                extras were VACANT.
 *
 *   highest grade wins a tie     @clolry: "when a conflict exists with two
 *                                'supervisors' in the same workgroup you can
 *                                choose the one that is the higher grade."
 *                                The old code returned whichever row came
 *                                first in bundle order — nondeterministic
 *                                across re-imports, so a center's approver
 *                                could change because HR re-sorted a sheet.
 *
 * THE GRADE-15 REQUIREMENT IS GONE. @clolry: "I don't know why we would need
 * to check the grade." It was a proxy for seniority that Org_Level already
 * states, and it excluded nobody real — measured, the only rows it rejected
 * were two VACANT grade-13 seats at FCA0E. It would also have rejected an SES
 * director outright, since HCRosterImport normalizes an SES grade to 'ES'
 * rather than a number.
 *
 * @param {string} orgCode - the submitter's full org code, e.g. 'FCA0BAA'
 * @param {TravelDB} [db] - Optional TravelDB instance for cache reuse
 * @returns {Object|null} { name, email, source: 'override'|'hc', positionNumber, occupancyStatus, sectorCode } or null
 */
function getSectorDirector(orgCode, db) {
  if (!orgCode) return null;

  // THE SERVICE CENTER THIS ORG CODE BELONGS TO, from the stored hierarchy.
  //
  // Returns '' for anyone at or above a DAC — FC itself, FCA, FCB, FCBA — and
  // that is the correct answer rather than a failure. Those people have no
  // service center, so there is no SCD stage for them and routing starts at
  // the DAC. The same distinction already drives the per-capita budget split,
  // which buckets them as isAboveServiceCenter.
  var sector = _resolveServiceCenterCode(orgCode);
  if (!sector) return null;

  // Step 1: manual override from Travel_User_Roles sector_override
  try {
    var override = _getSectorDirectorOverride(sector, db);
    if (override) {
      return {
        name: override.name,
        email: override.email,
        source: 'override',
        positionNumber: null,
        occupancyStatus: null,
        sectorCode: sector
      };
    }
  } catch (e) {
    console.error('getSectorDirector: override lookup error: ' + e.message);
    // fall through to HC derive
  }

  // Step 2: HC position-first auto-derive
  var match = _findSectorDirectorPosition(sector);
  if (!match) return null;

  // Step 3: reachability gate. ONLY VACANT MEANS NOBODY IS THERE.
  //
  // This read `status === 'VACANT' || status === 'OBLIGATED'`, which removed
  // Scott Eberle — the acting supervisor of FCC0C, whose seat is OBLIGATED at
  // grade 15 — and left the center resolving to a grade-14 "Lead". That is
  // worse than resolving to nobody: routing would have sent the center's
  // travel to someone who is not its approver and looked like it worked.
  //
  // _findSectorDirectorPosition already applies isHcSeatOccupied, so this is
  // now only the ADDRESS check. Kept separate because the two failures need
  // different words — a vacancy is a staffing fact, a missing address is a
  // roster gap somebody can fix.
  var status = String(match.occupancyStatus || '').toUpperCase();
  if (!isHcPositionReachable(match)) {
    console.log('getSectorDirector: ' + sector + ' resolves to ' +
                (match.employeeName || '(unnamed)') + ' but that row has no ' +
                'email address, so there is nobody to route to. Cascading to ' +
                'the DAC stage.');
    return null;
  }

  return {
    name: match.employeeName || '',
    email: match.emailAddress,
    source: 'hc',
    positionNumber: match.positionNumber || '',
    occupancyStatus: status,
    sectorCode: sector
  };
}

/**
 * Which service center an org code belongs to, from the STORED hierarchy.
 *
 * NOT A TRUNCATION. The inherited code took `orgCode.substring(0, 4)` and
 * called it the sector, which was correct for the previous workgroup — their
 * codes ran QFA (business unit) > QFAA (sector), so four characters WAS the
 * sector. It was carried over without re-deriving against this org.
 *
 * Here a service center is five characters, so a 4-char prefix of FCA0BAA is
 * 'FCA0' — which is not an org code at all. The '0' is a filler, not a level.
 * Measured: the 22 service centers collapse into 6 buckets under that rule,
 * three of them named for codes that do not exist.
 *
 * AND LENGTHENING IT TO 5 WOULD NOT FIX IT. 130 of 137 org codes agree with a
 * 5-char truncation, but the other 7 are FC, FCA, FCB, FCC, FCBA, FCBB and
 * FCCA — everyone at or above an office. Truncation hands those people their
 * OWN code as their service center; the stored walk returns '', which is the
 * truth: they have none.
 *
 * @param {string} orgCode
 * @returns {string} the SERVICE_CENTER org code, or '' if there is none
 * @private
 */
function _resolveServiceCenterCode(orgCode) {
  var code = String(orgCode || '').trim().toUpperCase();
  if (!code) return '';
  try {
    var orgs = HC.hcGetOrgHierarchy() || [];
    if (!orgs.length) {
      console.warn('_resolveServiceCenterCode: HC_Orgs is empty, so no org ' +
                   'code can be resolved to a service center. Run ' +
                   'loadRealOrgCodes().');
      return '';
    }
    var byCode = {};
    for (var i = 0; i < orgs.length; i++) {
      byCode[String(orgs[i].orgCode || '').toUpperCase()] = orgs[i];
    }
    return HC.orgAncestorAtLevel(code, byCode, 'SERVICE_CENTER') || '';
  } catch (e) {
    console.error('_resolveServiceCenterCode: ' + e.message);
    return '';
  }
}

/**
 * Find the Service Center Director's position record in HC.
 *
 * Position-first: identifies the SEAT, then the caller applies its own
 * occupancy gate. See getSectorDirector's header for why each clause.
 *
 * WHY THE SEARCH IS OVER THE WHOLE BUNDLE RATHER THAN A PREFIX MATCH: a
 * director sits AT the service center's own code, not in a division beneath
 * it. Somebody in FCA0BAA belongs to a branch; somebody at FCA0B is at the
 * service-center level. An `indexOf(sector) === 0` test would have matched
 * every division head in the center and returned whichever came first.
 *
 * @private
 * @param {string} sector - a SERVICE_CENTER org code, e.g. 'FCA0B'
 * @returns {Object|null} HC position record or null
 */
function _findSectorDirectorPosition(sector) {
  try {
    var bundle = HC.hcGetBundle();
    if (!bundle || !bundle.success || !bundle.data) {
      console.warn('_findSectorDirectorPosition: HC bundle unavailable');
      return null;
    }

    var want = String(sector || '').toUpperCase();
    if (!want) return null;

    var positions = bundle.data;
    var best = null;

    for (var i = 0; i < positions.length; i++) {
      var p = positions[i];
      if (!p || !p.orgCode) continue;
      // AT the service center's own code, never beneath it.
      if (String(p.orgCode).toUpperCase() !== want) continue;
      // Anything other than code 8. The old rule demanded exactly '2' and so
      // missed the 13 people HR calls Supervisor (CSRA), Management Official
      // (CSRA) or Team Leader — which is why FCA0A had no director.
      if (!isHcSupervisoryCode(p.supervisoryStatus)) continue;
      // A vacant or obligated seat cannot approve travel. This is also what
      // resolves FCA0E's three supervisory rows and FCC0B's two: the extras
      // are VACANT.
      if (!isHcSeatOccupied(p)) continue;

      // HIGHEST GRADE WINS, deterministically. Taking the first match left
      // the answer dependent on bundle order, so a center's approver could
      // change because HR re-sorted the source sheet.
      if (!best || compareHcGrade(p.grade, best.grade) > 0) best = p;
    }

    return best;
  } catch (e) {
    console.error('_findSectorDirectorPosition: HC error: ' + e.message);
    return null;
  }
}

/**
 * Read Travel_User_Roles for an active sector_override matching this sector.
 * Scope stores the sector NAME (e.g. "Sector 1") — caller passes a 4-char
 * sector code; we resolve the matching sector name from HC, then look up
 * sector_override roles by name.
 * Returns { name, email } or null.
 *
 * @private
 * @param {string} sector - Uppercase 4-char sector code
 * @param {TravelDB} [db] - Optional TravelDB instance for cache reuse
 * @returns {Object|null}
 */
function _getSectorDirectorOverride(sector, db) {
  var localDb = db || new TravelDB();
  try {
    var sectorName = '';
    var orgLookups = loadOrgLookups();
    var orgToSector = (orgLookups && orgLookups.orgToSector) || {};
    for (var oc in orgToSector) {
      if (!orgToSector.hasOwnProperty(oc)) continue;
      // MATCHED ON THE SERVICE CENTER CODE, not a 4-char prefix of it. The
      // caller now passes a real SERVICE_CENTER code, so this is an exact
      // comparison; under the old truncation 'FCA0' matched five different
      // centers and the first one's name won.
      if (String(oc).toUpperCase() === sector) {
        sectorName = orgToSector[oc];
        break;
      }
    }
    if (sectorName) {
      var data = _getUnifiedRoleData(localDb);
      for (var em in data.rolesByEmail) {
        if (!data.rolesByEmail.hasOwnProperty(em)) continue;
        var roles = data.rolesByEmail[em];
        for (var k = 0; k < roles.length; k++) {
          if (roles[k].roleType === 'sector_override' && roles[k].scope === sectorName) {
            return {
              name: roles[k].userName || '',
              email: em
            };
          }
        }
      }
    }
  } catch (ue) {
    console.warn('_getSectorDirectorOverride: unified-roles check failed: ' + ue.message);
  }
  return null;
}

// ============================================================================
// UNIFIED USER/ROLE READER (NEW SCHEMA — Travel_Users + Travel_User_Roles)
// ============================================================================
//
// Phase 3 of the access-control unification: every legacy role detector
// (isTravelAdmin, isActiveOSOReviewer, isActiveBUReviewer, _sector overrides)
// now ALSO consults the new unified tables. Returns merge legacy ∪ new
// results — a user matched in either source counts as having the role.
//
// This dual-read mode lets the new admin UI add real users to the new tables
// one at a time without breaking anyone whose role is still only in legacy
// sheets. Phase 7 (hard cutover) will drop the legacy reads.
//
// Cache: in-memory + CacheService 'unified_roles_v1' for 300s. Bootstrap and
// future CRUD writers must call _invalidateUnifiedRoleCache() to clear.

/**
 * Load and join Travel_Users + Travel_User_Roles into an email-keyed lookup.
 * Skips inactive users and inactive roles. Cached for 5 minutes.
 *
 * @param {TravelDB} [db] - Optional TravelDB for cache reuse
 * @returns {{rolesByEmail: Object<string, Array<{roleType, scope, isPrimary, userId, userName}>>, hasData: boolean}}
 */
function _getUnifiedRoleData(db) {
  try {
    var cache = CacheService.getScriptCache();
    var cacheKey = 'unified_roles_v1';
    var cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { cache.remove(cacheKey); }
    }

    var localDb = db || new TravelDB();
    var idToUser = {};
    var rolesByEmail = {};
    var hasData = false;

    var userData = localDb.readSheet(SHEET_NAMES.TRAVEL_USERS);
    if (!userData || !userData.headers || userData.headers.length === 0
        || userData.headerIndex['User_ID'] === undefined) {
      // New schema not present yet — return empty result
      return { rolesByEmail: {}, hasData: false };
    }

    var uIdIdx = userData.headerIndex['User_ID'];
    var uEmailIdx = userData.headerIndex['Email'];
    var uNameIdx = userData.headerIndex['Name'];
    var uActiveIdx = userData.headerIndex['Is_Active'];
    for (var i = 0; i < userData.rows.length; i++) {
      var ur = userData.rows[i];
      var uid = String(ur[uIdIdx] || '').trim();
      if (!uid) continue;
      var rawActive = uActiveIdx !== undefined ? ur[uActiveIdx] : true;
      if (rawActive === false || String(rawActive).toLowerCase() === 'false') continue;
      var email = String(ur[uEmailIdx] || '').trim().toLowerCase();
      idToUser[uid] = {
        userId: uid,
        email: email,
        name: String(ur[uNameIdx] || '').trim()
      };
    }

    var roleData = localDb.readSheet(SHEET_NAMES.TRAVEL_USER_ROLES);
    if (roleData && roleData.rows && roleData.rows.length > 0
        && roleData.headerIndex['User_ID'] !== undefined) {
      var rUidIdx = roleData.headerIndex['User_ID'];
      var rTypeIdx = roleData.headerIndex['Role_Type'];
      var rScopeIdx = roleData.headerIndex['Scope'];
      var rPrimaryIdx = roleData.headerIndex['Is_Primary'];
      var rActiveIdx = roleData.headerIndex['Is_Active'];

      for (var j = 0; j < roleData.rows.length; j++) {
        var rr = roleData.rows[j];
        var ruid = String(rr[rUidIdx] || '').trim();
        if (!ruid) continue;
        var roleActive = rActiveIdx !== undefined ? rr[rActiveIdx] : true;
        if (roleActive === false || String(roleActive).toLowerCase() === 'false') continue;
        var user = idToUser[ruid];
        if (!user || !user.email) continue;
        var rawPrimary = rPrimaryIdx !== undefined ? rr[rPrimaryIdx] : true;
        var role = {
          userId: ruid,
          userName: user.name,
          roleType: String(rr[rTypeIdx] || '').trim(),
          // Scope preserves original casing — for bu_reviewer and
          // sector_override it stores a BU/sector NAME (e.g. "Army",
          // "Sector 1") that must round-trip exactly to match HC's
          // orgToBU / orgToSector values.
          scope: String(rr[rScopeIdx] || '').trim(),
          isPrimary: rawPrimary !== false && String(rawPrimary).toLowerCase() !== 'false'
        };
        if (!rolesByEmail[user.email]) rolesByEmail[user.email] = [];
        rolesByEmail[user.email].push(role);
        hasData = true;
      }
    }

    var result = { rolesByEmail: rolesByEmail, hasData: hasData };
    try { cache.put(cacheKey, JSON.stringify(result), 300); } catch (e) {}
    return result;
  } catch (error) {
    console.error('_getUnifiedRoleData error: ' + error.message);
    return { rolesByEmail: {}, hasData: false };
  }
}

/**
 * Get all active roles for an email from the new unified tables. On a miss,
 * attempts a one-shot self-heal — if HC says the email belongs to an
 * employee_id that matches a Travel_Users row with a stale email, patches
 * the email and retries the lookup. Bounded cost: HC is consulted only on
 * cache miss, not every request. Returns [] if still no roles after heal.
 *
 * @param {string} email
 * @param {TravelDB} [db]
 * @returns {Array<{roleType, scope, isPrimary}>}
 */
function _getUnifiedRolesForEmail(email, db) {
  if (!email) return [];
  var lc = email.toLowerCase();
  var data = _getUnifiedRoleData(db);
  var hit = data.rolesByEmail[lc];
  if (hit && hit.length > 0) return hit;

  // Miss — try self-heal once. If HC links this email to a User_ID whose
  // sheet email is stale, patch and re-read.
  try {
    var heal = selfHealCurrentUserEmail(email);
    if (heal && heal.patched) {
      var fresh = _getUnifiedRoleData(db);
      return fresh.rolesByEmail[lc] || [];
    }
  } catch (e) {
    console.warn('_getUnifiedRolesForEmail: self-heal failed: ' + e.message);
  }
  return [];
}

/**
 * Invalidate the unified-role CacheService key. Must be called by any code
 * that writes to Travel_Users or Travel_User_Roles.
 */
function _invalidateUnifiedRoleCache() {
  try {
    CacheService.getScriptCache().remove('unified_roles_v1');
  } catch (e) {
    console.warn('_invalidateUnifiedRoleCache: ' + e.message);
  }
}

/**
 * Build a { 3-char BU code: BU display name } map by walking HC org
 * hierarchy. Used to resolve display names for BU codes stored in the new
 * Travel_User_Roles.Scope column. Codes that match no HC entry resolve to ''.
 *
 * @returns {Object<string, string>}
 */
function _buildBuCodeToNameMap() {
  var map = {};
  try {
    var lookups = loadOrgLookups();
    var orgToBU = (lookups && lookups.orgToBU) || {};
    for (var orgCode in orgToBU) {
      if (!orgToBU.hasOwnProperty(orgCode)) continue;
      var buCode = String(orgCode).substring(0, 3).toUpperCase();
      if (!buCode) continue;
      // First non-empty name wins; deterministic given orgToBU iteration order
      if (!map[buCode] && orgToBU[orgCode]) {
        map[buCode] = orgToBU[orgCode];
      }
    }
  } catch (e) {
    console.warn('_buildBuCodeToNameMap: ' + e.message);
  }
  return map;
}

// ============================================================================
// SITE-LEVEL ACCESS GATE
// ============================================================================

/**
 * Top-level access gate for the entire TRIP site. doGet() calls this for every
 * mode and serves the access-blocked page if it returns false.
 *
 * Allow if ANY of:
 *   1. the user has an active role in Travel_User_Roles
 *      (admin / aas_fo_reviewer / fas_fo_reviewer / bu_reviewer /
 *       sector_override / approved_user)
 *   2. HC staffing shows them in a supervisory position (any code except 8)
 *      whose seat is occupied
 *   3. their HC office title identifies them as a BU-level lead (Client
 *      Executive / Chief of Staff and their deputies). These leads carry no
 *      role row and may have a non-supervisory code, but getReviewerContext
 *      already hands them a BU-scoped dashboard, so the gate must match
 *   4. they are ON THE ROSTER at all, in an occupied seat with an address
 *
 * PATH 4 IS NEW AND IS THE WIDEST BY FAR — 866 of 1,046 positions are
 * non-supervisory. @clolry: "all employees across the entire org are going to
 * need access to the system... our Chief of Staff wants individual employees
 * to submit requests on their own."
 *
 * It grants much less than it appears to. Admission to the site is not
 * admission to anything in particular: getReviewerContext returns role 'none'
 * with isReviewer false, so the reviewer dashboard refuses them; HCPrivacy
 * returns the PUBLIC field set with no employee ID, grade, duty address or
 * email; and the portal shows their own requests. The grant is "may file a
 * travel request and see mine".
 *
 * PATHS 2, 3 AND 4 ARE ALL HR-DRIVEN and all gated by
 * HC_SUPERVISOR_ACCESS_ENABLED. Setting it to 'false' now closes all three,
 * which is a wider blast radius than before and the right one: a bad roster
 * import is exactly when every HR-derived grant should go off, not only the
 * supervisor ones.
 *
 * Inputs are already cached upstream (_getUnifiedRolesForEmail uses
 * CacheService; HC.hcGetBundle is cached at the library level), so this is
 * cheap to call per page-load.
 *
 * @param {string} email
 * @returns {boolean}
 */
function canAccessTrip(email) {
  if (!email) return false;
  var emailLower = email.toLowerCase();

  // 1. Any active role in Travel_User_Roles → allow.
  try {
    var roles = _getUnifiedRolesForEmail(emailLower);
    if (roles && roles.length > 0) {
      _logAccessDecision_(emailLower, 'GRANTED', 'role', {
        detail: roles.length + ' active role row(s)'
      });
      return true;
    }
  } catch (e) {
    console.warn('canAccessTrip: unified-roles check failed: ' + e.message);
  }

  // Paths 2, 3 AND 4 are HR-driven: they grant access with no row in
  // Travel_User_Roles and no admin-console visibility (G-008). The kill switch
  // below exists because a roster import can widen access without any LETS
  // change — setting HC_SUPERVISOR_ACCESS_ENABLED to 'false' closes all three
  // without a deploy, leaving the explicit role table as the only way in.
  //
  // THE SWITCH NOW REACHES FURTHER THAN ITS NAME SUGGESTS, and that is
  // deliberate. Path 4 admits every employee on the roster, so flipping this
  // locks out ~1,040 people rather than ~180 — and that is the correct
  // behavior for the situation it exists for. A bad roster import is exactly
  // when an administrator wants every HR-derived grant off, not only the
  // supervisory ones.
  //
  // The property is NOT renamed. It is read from live Script Properties, so a
  // rename needs the property set before the deploy lands or the switch
  // silently reverts to its default — which is ENABLED, the opposite of what
  // somebody reaching for a kill switch wants.
  //
  // Defaults to ENABLED. The previous workgroup relied on these paths, and
  // defaulting to closed would lock out every supervisor the moment a real
  // roster lands — and now every employee too.
  if (!isHcDerivedAccessEnabled()) {
    _logAccessDecision_(emailLower, 'DENIED', 'disabled', {
      detail: 'HC-derived access paths are disabled by HC_SUPERVISOR_ACCESS_ENABLED'
    });
    return false;
  }

  // 2. HC supervisor → allow. Walks the bundle for any filled position
  // owned by this email with supervisoryStatus === '2'.
  try {
    var bundle = HC.hcGetBundle();
    if (bundle && bundle.success && bundle.data) {
      var positions = bundle.data;
      for (var i = 0; i < positions.length; i++) {
        var p = positions[i];
        if (!p || !p.emailAddress) continue;
        if (String(p.emailAddress).toLowerCase() !== emailLower) continue;
        // ANY SUPERVISORY CODE, not just '2'. The old test excluded the 13
        // people whose HR record says Supervisor (CSRA), Management Official
        // (CSRA) or Team Leader — so each of them was denied LETS entirely,
        // with no error to point at. See 01_constants/HCRules.js.
        if (!isHcSupervisoryCode(p.supervisoryStatus)) continue;
        // ONLY VACANT MEANS NOBODY IS THERE.
        //
        // This excluded OBLIGATED too, and that is the same mistake as the
        // headcount's: an obligated row is the seat of a REAL person, not an
        // empty one. Measured on the live feed, 19 OBLIGATED against 11
        // TEMP PROMOTION — so at least eight people have no other row to be
        // matched against and were denied LETS entirely.
        //
        // The symptom here is the worst kind: "I cannot sign in", with an
        // Access_Log line reading DENIED/none and nothing pointing at the
        // cause.
        var status = String(p.occupancyStatus || '').toUpperCase();
        if (!isHcSeatOccupied(p)) continue;
        _logAccessDecision_(emailLower, 'GRANTED', 'hc-supervisor', {
          positionNumber: p.positionNumber,
          officeTitle: p.officeTitle,
          orgCode: p.orgCode,
          detail: 'Supervisory_Status=2, occupancy ' + status
        });
        return true;
      }
    }
  } catch (e) {
    console.warn('canAccessTrip: HC supervisor check failed: ' + e.message);
  }

  // 3. BU-lead by HC office title (Client Executive / Chief of Staff and
  // their deputies) → allow. Independent of supervisoryStatus; matches filled
  // seats only. Mirrors the BU-lead access getReviewerContext already grants.
  try {
    var buLead = _isBuLeadByTitle(emailLower);
    if (buLead) {
      _logAccessDecision_(emailLower, 'GRANTED', 'hc-bu-lead', {
        officeTitle: buLead.title || '',
        orgCode: (buLead.buCodes || []).join(','),
        detail: 'BU lead by office title: ' + ((buLead.buNames || []).join(', ') || 'unknown BU')
      });
      return true;
    }
  } catch (e) {
    console.warn('canAccessTrip: bu-lead-by-title check failed: ' + e.message);
  }

  // 4. ANY EMPLOYEE ON THE ROSTER → allow.
  //
  // @clolry: "all employees across the entire org are going to need access to
  // the system. AAS built TRIP to have requests submitted by a director but
  // our Chief of Staff wants individual employees to submit requests on their
  // own (and route through their supervisor/director/SCD, etc). I'm concerned
  // that this shift hasn't been included in the design."
  //
  // It had not been. Paths 1-3 admit role-holders, supervisors and BU leads —
  // 180 of 1,046 positions. The other 866 were DENIED at the line below, so
  // the people the system now expects to file their own requests could not
  // reach it at all.
  //
  // WHY THIS IS A SMALLER GRANT THAN IT LOOKS. Being admitted to the site is
  // not being given anything to look at:
  //
  //   getReviewerContext returns role 'none' with isReviewer false, so the
  //   reviewer dashboard refuses them (ReviewerDashboard.js:36)
  //   HCPrivacy returns the PUBLIC field set — no employee ID, no grade, no
  //   duty address, no email
  //   the portal shows their OWN requests, which is the point
  //
  // So this grants "may file a travel request and see mine", which is what
  // every employee needs and nothing more.
  //
  // MATCHED ON AN OCCUPIED SEAT WITH AN ADDRESS, not on mere presence in the
  // roster. A vacant seat has nobody to admit, and a row with no address
  // cannot match a signed-in user anyway — Email_Address is the join.
  //
  // GATED BY THE SAME KILL SWITCH as paths 2 and 3, which is why it sits
  // below that check rather than beside path 1. HC_SUPERVISOR_ACCESS_ENABLED
  // set to 'false' now closes all three HR-driven paths, leaving the explicit
  // role table as the only way in — a wider blast radius than before, and the
  // right one: a bad roster import is exactly when an administrator wants
  // every HR-derived grant off, not merely the supervisor ones.
  try {
    var allBundle = HC.hcGetBundle();
    if (allBundle && allBundle.success && allBundle.data) {
      var all = allBundle.data;
      for (var e = 0; e < all.length; e++) {
        var emp = all[e];
        if (!emp || !emp.emailAddress) continue;
        if (String(emp.emailAddress).toLowerCase() !== emailLower) continue;
        if (!isHcSeatOccupied(emp)) continue;
        _logAccessDecision_(emailLower, 'GRANTED', 'hc-employee', {
          positionNumber: emp.positionNumber,
          officeTitle: emp.officeTitle,
          orgCode: emp.orgCode,
          detail: 'On the HR roster, occupancy ' +
                  String(emp.occupancyStatus || '').toUpperCase() +
                  '. Submitter access only — no reviewer role.'
        });
        return true;
      }
    }
  } catch (e) {
    console.warn('canAccessTrip: HC employee check failed: ' + e.message);
  }

  _logAccessDecision_(emailLower, 'DENIED', 'none', {
    detail: 'No role row, and not on the HR roster in an occupied seat'
  });
  return false;
}

/**
 * Whether the two HR-driven allow-paths in canAccessTrip are active.
 *
 * Reads the HC_SUPERVISOR_ACCESS_ENABLED Script Property. Anything other than
 * the exact string 'false' leaves them enabled, so a typo or a blank value
 * cannot accidentally lock the site down — a fail-open default is correct here
 * because the alternative is denying every supervisor at once.
 *
 * @returns {boolean}
 * @server
 */
function isHcDerivedAccessEnabled() {
  try {
    var raw = PropertiesService.getScriptProperties()
      .getProperty('HC_SUPERVISOR_ACCESS_ENABLED');
    return String(raw).trim().toLowerCase() !== 'false';
  } catch (e) {
    console.warn('isHcDerivedAccessEnabled: property read failed, defaulting to enabled: ' + e.message);
    return true;
  }
}

/**
 * Appends one row to Access_Log.
 *
 * BEST EFFORT, NEVER THROWS. canAccessTrip runs on every page load, so a
 * logging failure must not deny access — an audit gap is bad, locking the
 * whole site out because a sheet write failed is worse.
 *
 * Why this exists: before it, paths 2 and 3 returned `true` silently. Access
 * granted by HR data left no trace anywhere, so nobody could answer "who can
 * get in, and why?" without reading this file. docs/GAP_REGISTER.md G-008.
 *
 * DENIED rows are logged too. A user reporting "I can't get in" is the most
 * common support question this system will get, and the log turns it into a
 * lookup instead of a reproduction.
 *
 * @param {string} email
 * @param {string} decision GRANTED | DENIED
 * @param {string} path role | hc-supervisor | hc-bu-lead | none | disabled
 * @param {Object} [info] { positionNumber, officeTitle, orgCode, detail }
 */
function _logAccessDecision_(email, decision, path, info) {
  try {
    if (!TRAVEL_DB_SPREADSHEET_ID) return;
    info = info || {};

    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.ACCESS_LOG);
    // Absent tab is not an error: this runs before setupTravelDatabase() has
    // necessarily been run against a given environment.
    if (!sheet) return;

    sheet.appendRow([
      'ACC-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      new Date(),
      email || '',
      decision || '',
      path || '',
      info.positionNumber || '',
      info.officeTitle || '',
      info.orgCode || '',
      info.detail || ''
    ]);
  } catch (e) {
    // Deliberately swallowed. See the contract above.
    console.warn('_logAccessDecision_ failed (access unaffected): ' + e.message);
  }
}

/**
 * Everyone who currently holds access, and by which path.
 *
 * Answers "who can get in?" from the data rather than by reading code. The
 * two HC-driven paths are the point: those grants exist only in HR data, so
 * before this there was no way to enumerate them.
 *
 * Reads HC and the role table directly rather than replaying Access_Log —
 * the log records decisions that HAPPENED, which is a different question from
 * who WOULD be admitted right now.
 *
 * @returns {Object} { success, hcDerivedEnabled, roleHolders[], hcSupervisors[], buLeads[], error? }
 * @server
 */
function getAccessInventory() {
  try {
    var out = {
      success: true,
      hcDerivedEnabled: isHcDerivedAccessEnabled(),
      roleHolders: [],
      hcSupervisors: [],
      buLeads: []
    };

    // Role table. _getUnifiedRoleData already returns an email-keyed map and
    // is CacheService-backed, so this reuses it rather than re-reading the
    // sheet — and it is the SAME source canAccessTrip path 1 consults, so the
    // inventory cannot disagree with the gate.
    try {
      var roleData = _getUnifiedRoleData();
      var rolesByEmail = (roleData && roleData.rolesByEmail) || {};
      out.roleHolders = Object.keys(rolesByEmail).map(function (em) {
        return {
          email: em,
          roles: (rolesByEmail[em] || []).map(function (r) {
            return r.roleType + (r.scope ? ':' + r.scope : '');
          })
        };
      });
    } catch (e) {
      out.roleError = e.message;
    }

    // HC supervisors and BU leads.
    try {
      var bundle = HC.hcGetBundle();
      if (bundle && bundle.success && bundle.data) {
        for (var i = 0; i < bundle.data.length; i++) {
          var p = bundle.data[i];
          if (!p || !p.emailAddress) continue;
          var status = String(p.occupancyStatus || '').toUpperCase();
          // Same rule as the gate: only VACANT means nobody is in the seat.
          if (!isHcSeatOccupied(p)) continue;

          // Same widened rule as the gate at canAccessTrip, so the access
          // INVENTORY and the access DECISION cannot disagree about who is a
          // supervisor. They are read side by side when someone asks why they
          // cannot sign in.
          if (isHcSupervisoryCode(p.supervisoryStatus)) {
            out.hcSupervisors.push({
              email: String(p.emailAddress).toLowerCase(),
              name: p.employeeName || '',
              positionNumber: p.positionNumber || '',
              officeTitle: p.officeTitle || '',
              orgCode: p.orgCode || ''
            });
          }

          var titleLower = String(p.officeTitle || '').toLowerCase();
          if (titleLower.indexOf('chief of staff') !== -1 ||
              titleLower.indexOf('client executive') !== -1) {
            out.buLeads.push({
              email: String(p.emailAddress).toLowerCase(),
              name: p.employeeName || '',
              positionNumber: p.positionNumber || '',
              officeTitle: p.officeTitle || '',
              orgCode: p.orgCode || ''
            });
          }
        }
      } else if (bundle && bundle.error) {
        out.hcError = bundle.error;
      }
    } catch (e) {
      out.hcError = e.message;
    }

    return out;
  } catch (error) {
    console.error('getAccessInventory failed: ' + error.message);
    return { success: false, error: error.message, roleHolders: [], hcSupervisors: [], buLeads: [] };
  }
}

/**
 * Editor convenience wrapper: edit TEST_EMAIL, save, click Run, check Logs.
 * The GAS Run button can't pass args, so this exists purely so admins can
 * spot-check gate decisions for any email without writing a wrapper themselves.
 */
function _testAccessGate() {
  var TEST_EMAIL = 'someone@gsa.gov';  // edit me
  var result = verifyAccessGate(TEST_EMAIL);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Admin diagnostic: explain whether a given email passes canAccessTrip and why.
 * Run from the Apps Script editor or call as an RPC. Read-only.
 *
 * @param {string} email
 * @returns {Object} { success, email, allowed, reasons: string[] }
 */
function verifyAccessGate(email) {
  requireTravelAdmin();
  if (!email) return { success: false, error: 'email required' };
  var emailLower = String(email).toLowerCase();
  var reasons = [];

  try {
    var roles = _getUnifiedRolesForEmail(emailLower);
    if (roles && roles.length > 0) {
      var labels = roles.map(function(r) {
        return r.roleType + (r.scope ? ':' + r.scope : '') + (r.isPrimary ? ' (primary)' : '');
      });
      reasons.push('unified-role: ' + labels.join(', '));
    }
  } catch (e) {
    reasons.push('unified-roles error: ' + e.message);
  }

  try {
    var bundle = HC.hcGetBundle();
    if (bundle && bundle.success && bundle.data) {
      var positions = bundle.data;
      for (var i = 0; i < positions.length; i++) {
        var p = positions[i];
        if (!p || !p.emailAddress) continue;
        if (String(p.emailAddress).toLowerCase() !== emailLower) continue;
        // Must match canAccessTrip's rule exactly: this function EXPLAINS that
        // decision, and an explanation that applies a different test is worse
        // than none.
        if (!isHcSupervisoryCode(p.supervisoryStatus)) continue;
        var status = String(p.occupancyStatus || '').toUpperCase();
        if (!isHcSeatOccupied(p)) continue;
        reasons.push('hc-supervisor: ' + (p.officeTitle || '(no title)') + ' [' + (p.orgCode || '?') + ', ' + status + ']');
        break;
      }
    }
  } catch (e) {
    reasons.push('hc error: ' + e.message);
  }

  var allowed = canAccessTrip(emailLower);
  if (!allowed && reasons.length === 0) reasons.push('denied: no unified role and no HC supervisor position');

  console.log('verifyAccessGate(' + emailLower + ') => ' + (allowed ? 'ALLOW' : 'DENY'));
  reasons.forEach(function(r, i) { console.log('  ' + (i + 1) + '. ' + r); });

  return {
    success: true,
    email: emailLower,
    allowed: allowed,
    reasons: reasons
  };
}

/**
 * Editor convenience runner for the deep diagnostic. Edit TEST_EMAIL, save,
 * click Run, read Logs. Exists because the GAS Run button can't pass args.
 */
function _diagnoseAccess() {
  var TEST_EMAIL = 'kimberly.mcfall@gsa.gov';  // edit me
  var result = diagnoseTripAccess(TEST_EMAIL);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * DEEP access diagnostic. Unlike verifyAccessGate (which only reports the two
 * allow-paths), this walks the RAW Travel_Users and Travel_User_Roles rows and
 * the HC bundle so you can see exactly why an email is "read differently" —
 * e.g. the user row exists but Is_Active=false, a role row exists but is
 * inactive, or the email on file doesn't match the login email. Read-only.
 *
 * @param {string} email - the login email to diagnose
 * @returns {Object} { success, email, allowed, diagnosis, userRows, roleRows,
 *                      effectiveRoles, hcPositions }
 */
function diagnoseTripAccess(email) {
  requireTravelAdmin();
  if (!email) return { success: false, error: 'email required' };

  var emailLower = String(email).trim().toLowerCase();
  var db = new TravelDB();
  var out = {
    success: true,
    email: emailLower,
    allowed: false,
    diagnosis: [],
    userRows: [],
    roleRows: [],
    effectiveRoles: [],
    hcPositions: [],
    buLeadByTitle: null
  };

  // --- 1. Raw Travel_Users scan (match by email, any active state) ---
  var matchedUserIds = {};
  try {
    var ud = db.readSheet(SHEET_NAMES.TRAVEL_USERS);
    if (!ud || ud.headerIndex['User_ID'] === undefined) {
      out.diagnosis.push('Travel_Users sheet missing or has no User_ID column.');
    } else {
      var uIdIdx = ud.headerIndex['User_ID'];
      var uEmailIdx = ud.headerIndex['Email'];
      var uNameIdx = ud.headerIndex['Name'];
      var uActiveIdx = ud.headerIndex['Is_Active'];
      for (var i = 0; i < ud.rows.length; i++) {
        var ur = ud.rows[i];
        var rowEmail = String(ur[uEmailIdx] || '').trim().toLowerCase();
        if (rowEmail !== emailLower) continue;
        var rawActive = uActiveIdx !== undefined ? ur[uActiveIdx] : true;
        var isActive = !(rawActive === false || String(rawActive).toLowerCase() === 'false');
        var uid = String(ur[uIdIdx] || '').trim();
        out.userRows.push({
          userId: uid,
          emailOnFile: rowEmail,
          name: String(ur[uNameIdx] || '').trim(),
          isActive: isActive
        });
        if (isActive && uid) matchedUserIds[uid] = true;
      }
      if (out.userRows.length === 0) {
        out.diagnosis.push('NOT in Travel_Users — no row with Email=' + emailLower +
          '. (Login email may differ from the email on file, or the user was never added.)');
      } else {
        out.userRows.forEach(function(u) {
          if (!u.isActive) out.diagnosis.push('Travel_Users row exists but Is_Active=FALSE (User_ID ' + u.userId + ') — roles are ignored while inactive.');
        });
      }
    }
  } catch (e) {
    out.diagnosis.push('Travel_Users read error: ' + e.message);
  }

  // --- 2. Raw Travel_User_Roles scan for the matched (active) user IDs ---
  try {
    var rd = db.readSheet(SHEET_NAMES.TRAVEL_USER_ROLES);
    if (rd && rd.headerIndex['User_ID'] !== undefined) {
      var rUidIdx = rd.headerIndex['User_ID'];
      var rTypeIdx = rd.headerIndex['Role_Type'];
      var rScopeIdx = rd.headerIndex['Scope'];
      var rActiveIdx = rd.headerIndex['Is_Active'];
      for (var j = 0; j < rd.rows.length; j++) {
        var rr = rd.rows[j];
        var ruid = String(rr[rUidIdx] || '').trim();
        if (!ruid || !matchedUserIds[ruid]) continue;
        var rawRoleActive = rActiveIdx !== undefined ? rr[rActiveIdx] : true;
        var roleActive = !(rawRoleActive === false || String(rawRoleActive).toLowerCase() === 'false');
        out.roleRows.push({
          userId: ruid,
          roleType: String(rr[rTypeIdx] || '').trim(),
          scope: String(rr[rScopeIdx] || '').trim(),
          isActive: roleActive
        });
      }
      if (Object.keys(matchedUserIds).length > 0 && out.roleRows.length === 0) {
        out.diagnosis.push('Active Travel_Users row exists but it has NO role rows in Travel_User_Roles — grant a role (e.g. "Site Access" / approved_user) to let them in.');
      }
      out.roleRows.forEach(function(r) {
        if (!r.isActive) out.diagnosis.push('Role row "' + r.roleType + '" exists but Is_Active=FALSE — reactivate it to grant access.');
      });
    }
  } catch (e2) {
    out.diagnosis.push('Travel_User_Roles read error: ' + e2.message);
  }

  // --- 3. Effective roles (what the gate actually sees, post-join) ---
  try {
    out.effectiveRoles = _getUnifiedRolesForEmail(emailLower, db) || [];
  } catch (e3) {
    out.diagnosis.push('effective-roles error: ' + e3.message);
  }

  // --- 4. HC supervisor path ---
  try {
    var bundle = HC.hcGetBundle();
    if (bundle && bundle.success && bundle.data) {
      var positions = bundle.data;
      for (var k = 0; k < positions.length; k++) {
        var p = positions[k];
        if (!p || !p.emailAddress) continue;
        if (String(p.emailAddress).toLowerCase() !== emailLower) continue;
        var status = String(p.occupancyStatus || '').toUpperCase();
        var supes = String(p.supervisoryStatus);
        var qualifies = supes === '2' && status !== 'VACANT' && status !== 'OBLIGATED';
        out.hcPositions.push({
          officeTitle: p.officeTitle || '',
          orgCode: p.orgCode || '',
          supervisoryStatus: supes,
          occupancyStatus: status,
          grantsAccess: qualifies
        });
      }
      if (out.hcPositions.length === 0) {
        out.diagnosis.push('No HC position found for this email, so NO HR-driven ' +
          'allow-path applies — not the supervisor path, not the BU-lead path, ' +
          'and not the employee path. This is the usual reason a real person is ' +
          'denied: their roster row carries a different address, or none.');
      } else {
        out.hcPositions.forEach(function(h) {
          if (!h.grantsAccess) {
            // A ROW THAT DOES NOT GRANT *SUPERVISOR* ACCESS MAY STILL GRANT
            // EMPLOYEE ACCESS. Saying only "does NOT grant access" was true
            // when there were three paths and is now misleading: a
            // non-supervisory employee in an occupied seat is admitted by
            // path 4, and a reader of this line would conclude otherwise.
            out.diagnosis.push('HC position "' + h.officeTitle + '" does not grant ' +
              'SUPERVISOR access (supervisoryStatus=' + h.supervisoryStatus +
              ', occupancy=' + h.occupancyStatus + '; needs a code other than 8 ' +
              'and an occupied seat). It may still grant EMPLOYEE access — see ' +
              'the verdict below.');
          }
        });
      }
    } else {
      out.diagnosis.push('HC bundle unavailable — supervisor path could not be evaluated.');
    }
  } catch (e4) {
    out.diagnosis.push('HC check error: ' + e4.message);
  }

  // --- 5. BU-lead-by-title path (Client Executive / Chief of Staff + deputies) ---
  try {
    var buLead = _isBuLeadByTitle(emailLower);
    out.buLeadByTitle = buLead || null;
    if (buLead) {
      out.diagnosis.push('BU-lead by title: "' + buLead.title + '" (' + (buLead.buNames.join(', ') || buLead.buCodes.join(', ')) + ') — grants access regardless of supervisoryStatus.');
    }
  } catch (e5) {
    out.diagnosis.push('bu-lead-by-title error: ' + e5.message);
  }

  // --- 6. Employee path (every occupied roster seat) ---
  //
  // Reported SEPARATELY from the supervisor path even though both read the
  // same bundle, because the two answer different questions and an admin
  // asking "why can this person get in" needs to know WHICH path admitted
  // them. A single "HC grants access" line would make a non-supervisory
  // employee look like a supervisor.
  try {
    out.employeePath = { onRoster: false, occupiedSeat: false, positionNumber: '' };
    (out.hcPositions || []).forEach(function (h) {
      out.employeePath.onRoster = true;
      var occ = String(h.occupancyStatus || '').toUpperCase();
      if (occ !== 'VACANT') {
        out.employeePath.occupiedSeat = true;
        if (!out.employeePath.positionNumber) {
          out.employeePath.positionNumber = h.positionNumber || '';
        }
      }
    });
    if (out.employeePath.occupiedSeat) {
      out.diagnosis.push('On the HR roster in an occupied seat (position ' +
        (out.employeePath.positionNumber || '?') + ') — grants EMPLOYEE access: ' +
        'may file a travel request and see their own. No reviewer dashboard, ' +
        'and HCPrivacy returns the public field set only.');
    }
  } catch (e6) {
    out.diagnosis.push('employee-path error: ' + e6.message);
  }

  // --- 7. Final verdict ---
  out.allowed = canAccessTrip(emailLower);
  if (out.allowed && out.diagnosis.length === 0) {
    out.diagnosis.push('ALLOWED — an active role, a supervisory HC position, a ' +
      'BU-lead title, or an occupied seat on the HR roster.');
  } else if (out.allowed) {
    out.diagnosis.unshift('ALLOWED (despite notes below).');
  } else if (out.diagnosis.length === 0) {
    out.diagnosis.push('DENIED — no active role, and no HC position at all for ' +
      'this address. Check that the roster carries this exact email.');
  }

  console.log('diagnoseTripAccess(' + emailLower + ') => ' + (out.allowed ? 'ALLOW' : 'DENY'));
  out.diagnosis.forEach(function(d, idx) { console.log('  ' + (idx + 1) + '. ' + d); });

  return out;
}

// ============================================================================
// ROLE GATES — is this person an active reviewer at any level?
// ============================================================================

/**
 * Check if a user is a Travel Portal admin.
 *
 * Reads from Travel_User_Roles (admin role type).
 *
 * @param {string} email - Email to check
 * @returns {boolean}
 */
function isTravelAdmin(email) {
  if (!email) return false;
  var emailLower = email.toLowerCase();
  try {
    var roles = _getUnifiedRolesForEmail(emailLower);
    for (var u = 0; u < roles.length; u++) {
      if (roles[u].roleType === 'admin') return true;
    }
  } catch (e) {
    console.error('isTravelAdmin: unified-roles check failed: ' + e.message);
  }
  return false;
}

/**
 * Check if a user is an active AAS FO reviewer (formerly "OSO reviewer").
 * Reads from Travel_User_Roles (aas_fo_reviewer role type).
 *
 * @param {string} email - Email to check
 * @returns {boolean}
 */
function isActiveOSOReviewer(email) {
  if (!email) return false;
  var emailLower = email.toLowerCase();
  try {
    var roles = _getUnifiedRolesForEmail(emailLower);
    for (var u = 0; u < roles.length; u++) {
      if (roles[u].roleType === 'aas_fo_reviewer') return true;
    }
  } catch (e) {
    console.error('isActiveOSOReviewer: unified-roles check failed: ' + e.message);
  }
  return false;
}

/**
 * Whether this user is a Service Center Director, and of which centers.
 *
 * THE RETURNED CODES ARE FULL SERVICE_CENTER ORG CODES — 'FCA0B', 'FCBAA' —
 * not 4-character prefixes. Every consumer compares them against a request's
 * org code, so the two sides must speak the same vocabulary; see
 * orgCodeInScope.
 *
 * WHAT CHANGED, AND WHY BOTH HALVES HAD TO CHANGE TOGETHER
 * -------------------------------------------------------
 * The HC half matched officeTitle against 'sector director', a title no
 * position in this organization holds, so it found nobody — ever.
 *
 * The override half resolved a sector NAME to codes by taking
 * `substring(0, 4)` of every org whose Sector matched. Two separate problems
 * compounded there:
 *
 *   HC_Orgs.Sector is 'ASD' on all 137 rows (HCSeed.js), so ONE name matched
 *   the entire organization; and the 4-char truncation of a 5-char service
 *   center yielded FCA0 / FCB0 / FCC0, which are not org codes at all.
 *
 * Resolved against the real hierarchy, scope "ASD" reached 137 of 137 org
 * codes. A single sector_override row would have granted read access to every
 * ASD travel request rather than one center's. diagServiceCenterDirectors
 * confirmed zero such rows exist, so the over-grant was latent — but it would
 * have appeared the first time one was granted.
 *
 * Fixing only the title match would have made this WORSE, not better: a
 * newly-correct SCD would return 'FCA0B' while the dashboards still computed
 * 'FCA0' from the request side, the two would never compare equal, and the
 * director would reach their queue and see nothing at all.
 *
 * @param {string} email - Email to check
 * @param {TravelDB} [db] - Optional TravelDB instance for cache reuse
 * @returns {Object} { isSD: boolean, sectorCodes: string[] } full SERVICE_CENTER codes
 */
function isSectorDirector(email, db) {
  if (!email) return { isSD: false, sectorCodes: [] };
  var emailLower = email.toLowerCase();
  var sectorCodes = [];

  // 1. sector_override.Scope holds a sector NAME, so it has to be resolved to
  //    codes. Resolved to FULL service-center codes via the stored hierarchy.
  try {
    var unifiedRoles = _getUnifiedRolesForEmail(emailLower, db);
    if (unifiedRoles.length > 0) {
      var orgLookups = loadOrgLookups();
      var orgToSector = (orgLookups && orgLookups.orgToSector) || {};
      for (var ur = 0; ur < unifiedRoles.length; ur++) {
        if (unifiedRoles[ur].roleType !== 'sector_override') continue;
        var sectorName = unifiedRoles[ur].scope;
        if (!sectorName) continue;
        for (var oc in orgToSector) {
          if (!orgToSector.hasOwnProperty(oc)) continue;
          if (orgToSector[oc] !== sectorName) continue;
          // THE SERVICE CENTER, WALKED, not a prefix. An org whose own level
          // is above a service center resolves to '' and is skipped rather
          // than contributing its own code — otherwise a scope matching FCA
          // would silently cover all five of its centers.
          var resolved = _resolveServiceCenterCode(oc);
          if (resolved && sectorCodes.indexOf(resolved) === -1) {
            sectorCodes.push(resolved);
          }
        }
      }
    }
  } catch (eu) {
    console.error('isSectorDirector: unified-roles check failed: ' + eu.message);
  }

  // 2. The HC position they occupy. Same rule as _findSectorDirectorPosition:
  //    at a service center's own code, supervisory, seat occupied.
  try {
    var bundle = HC.hcGetBundle();
    if (bundle && bundle.success && bundle.data) {
      var positions = bundle.data;
      for (var j = 0; j < positions.length; j++) {
        var p = positions[j];
        if (!p || !p.emailAddress) continue;
        if (String(p.emailAddress).toLowerCase() !== emailLower) continue;
        if (!isHcSupervisoryCode(p.supervisoryStatus)) continue;
        if (!isHcSeatOccupied(p)) continue;

        // Their own code must BE a service center. Somebody supervising a
        // division inside one is not its director.
        var own = String(p.orgCode || '').toUpperCase();
        if (!own) continue;
        if (_resolveServiceCenterCode(own) !== own) continue;

        // AND THEY MUST BE THE ONE THIS CENTER RESOLVES TO. Without this, any
        // supervisor sharing a center's code would claim the role — and at
        // FCA0E and FCC0B there is more than one supervisory row. The
        // highest-grade rule lives in one place, so asking it here keeps the
        // reviewer role and the routing target from disagreeing about who the
        // director is.
        var director = _findSectorDirectorPosition(own);
        if (!director) continue;
        if (String(director.emailAddress || '').toLowerCase() !== emailLower) continue;

        if (sectorCodes.indexOf(own) === -1) sectorCodes.push(own);
      }
    }
  } catch (e) {
    console.error('isSectorDirector: HC scan error: ' + e.message);
  }

  return {
    isSD: sectorCodes.length > 0,
    sectorCodes: sectorCodes
  };
}

/**
 * Whether a request's org code falls inside a reviewer's service-center scope.
 *
 * THE ONE PLACE THAT COMPARES A REQUEST TO A SECTOR SCOPE. There were four
 * copies of this comparison — ReviewerDashboard twice, Admin_Dashboard once,
 * and the review-assignment path — each written as
 * `String(orgCode).substring(0, 4).toUpperCase()`, and each therefore
 * comparing a 4-character truncation against whatever isSectorDirector
 * happened to return.
 *
 * That worked only because BOTH sides were wrong in the same way. Correcting
 * one side alone leaves a director looking at an empty queue, which reads as
 * "no requests yet" rather than as a bug — so the comparison is centralized
 * here and the truncations are gone.
 *
 * A REQUEST IN A DIVISION BELONGS TO ITS SERVICE CENTER. The submitter's org
 * code is their own — FCA0BAA, a branch — so this walks UP to the center
 * rather than comparing strings. A prefix test would be close but not
 * equivalent: FCBA and FCBAA share a prefix and are an office and a service
 * center respectively.
 *
 * @param {string} orgCode the request's (or submitter's) org code
 * @param {Array<string>} scopeCodes full SERVICE_CENTER codes from isSectorDirector
 * @returns {boolean}
 */
function orgCodeInScope(orgCode, scopeCodes) {
  var scope = scopeCodes || [];
  if (!scope.length) return false;
  var sc = _resolveServiceCenterCode(orgCode);
  if (!sc) return false;
  for (var i = 0; i < scope.length; i++) {
    if (String(scope[i] || '').toUpperCase() === sc) return true;
  }
  return false;
}

/**
 * Check if a user is an active BU Reviewer.
 * Reads from Travel_User_Roles where role_type='bu_reviewer'.
 * Scope on bu_reviewer rows is the BU NAME (e.g. "Army") — both buCodes
 * and buNames return the name; consumers standardize on names downstream.
 *
 * @param {string} email - Email to check
 * @param {TravelDB} [db] - Optional TravelDB instance for cache reuse
 * @returns {Object} { isBUReviewer: boolean, buCodes: string[], buNames: string[] }
 */
function isActiveBUReviewer(email, db) {
  if (!email) return { isBUReviewer: false, buCodes: [], buNames: [] };
  var emailLower = email.toLowerCase();
  var buCodes = [];
  var buNames = [];

  function addBU(code, name) {
    if (!code) return;
    var upper = String(code).toUpperCase();
    if (buCodes.indexOf(upper) !== -1) return;
    buCodes.push(upper);
    buNames.push(name || '');
  }

  try {
    var unifiedRoles = _getUnifiedRolesForEmail(emailLower, db);
    for (var u = 0; u < unifiedRoles.length; u++) {
      if (unifiedRoles[u].roleType !== 'bu_reviewer') continue;
      var name = unifiedRoles[u].scope;
      if (!name) continue;
      addBU(name, name);
    }
  } catch (e) {
    console.error('isActiveBUReviewer: unified-roles check failed: ' + e.message);
  }

  return {
    isBUReviewer: buCodes.length > 0,
    buCodes: buCodes,
    buNames: buNames
  };
}

/**
 * Check if a user holds a position whose office title identifies them as
 * a BU-level lead by HC staffing — Chief of Staff / Deputy Chief of Staff
 * (matched via "chief of staff" contains) or Client Executive / Deputy
 * Client Executive (via "client executive" contains). These roles aren't
 * granted bu_reviewer rows but should see the Action Center scoped to
 * their BU (same UI as a BU reviewer; per-request reviewer-email check still
 * gates approve/deny so they can't action requests they're not assigned).
 *
 * Walks HC's filled positions only — vacant/obligated positions don't
 * count, and a position with no email or no orgCode is skipped.
 *
 * @param {string} email - Email to check
 * @returns {Object|null} { buCodes, buNames, title } or null when not matched
 */
function _isBuLeadByTitle(email) {
  if (!email) return null;
  var emailLower = email.toLowerCase();

  try {
    var bundle = HC.hcGetBundle();
    if (!bundle || !bundle.success || !bundle.data) return null;

    var orgLookups = loadOrgLookups();
    var orgToBU = (orgLookups && orgLookups.orgToBU) || {};
    var orgToCurrentOrgCode = (orgLookups && orgLookups.orgToCurrentOrgCode) || {};

    var buCodes = [];
    var buNames = [];
    var matchedTitle = '';

    for (var i = 0; i < bundle.data.length; i++) {
      var p = bundle.data[i];
      if (!p || !p.officeTitle || !p.emailAddress) continue;
      if (String(p.emailAddress).toLowerCase() !== emailLower) continue;
      // Only VACANT. A Chief of Staff serving a temp promotion is still the
      // Chief of Staff, and excluding OBLIGATED would deny them the access
      // this title exists to grant.
      if (!isHcSeatOccupied(p)) continue;

      var titleLower = String(p.officeTitle).toLowerCase();
      var isCos = titleLower.indexOf('chief of staff') !== -1;
      var isCe = titleLower.indexOf('client executive') !== -1;
      if (!isCos && !isCe) continue;

      var orgCode = p.orgCode || '';
      if (!orgCode) continue;
      var canonical = orgToCurrentOrgCode[orgCode] || orgCode;
      var buCode = String(canonical).substring(0, 3).toUpperCase();
      var buName = orgToBU[canonical] || '';

      if (buCode && buCodes.indexOf(buCode) === -1) {
        buCodes.push(buCode);
        buNames.push(buName);
        if (!matchedTitle) matchedTitle = p.officeTitle;
      }
    }

    if (buCodes.length === 0) return null;
    return { buCodes: buCodes, buNames: buNames, title: matchedTitle };
  } catch (e) {
    console.error('_isBuLeadByTitle: HC scan error: ' + e.message);
    return null;
  }
}

// ============================================================================
// CONSOLIDATED CONTEXT — used by route gate + dashboard server
// ============================================================================

/**
 * Resolve the calling user's reviewer role and scope.
 * Priority: admin > oso > bu > sector > none.
 *
 * Used by:
 *   - serveReviewerDashboardPage() — gate access; reject if role === 'none'
 *   - getReviewerDashboard()       — derive scope filters server-side
 *
 * VIEW-AS OVERRIDE (dev/test affordance):
 *   When viewAs is provided AND the resolved baseline role is admin, the
 *   override is applied — admin can simulate any reviewer role for testing.
 *   Non-admins passing viewAs are ignored (security: silent no-op).
 *
 *   viewAs shape: { role: 'oso'|'bu'|'sector', buName?: string, sector?: string }
 *
 * @param {string} [email] - Defaults to Session.getActiveUser().getEmail()
 * @param {Object} [viewAs] - Optional admin-only override
 * @returns {Object} {
 *   email, role, scope: { type, codes, names }, label, isAdmin, isReviewer,
 *   viewAsActive: boolean, viewAsLabel: string
 * }
 */
function getReviewerContext(email, viewAs, sharedDb) {
  var resolvedEmail = email || (Session.getActiveUser().getEmail() || '');

  // ACT-AS DELEGATION.
  //
  // @clolry: "when a user delegates access, the other logs in and then can
  // choose to emulate that user's access and approvals (of course they're
  // logged as themselves but are given the rights to view/edit as the other
  // person would)."
  //
  // Resolved FIRST, so everything below computes the PRINCIPAL's context —
  // their role, their scope, their queue. The delegate's own identity stays
  // on the context as actorEmail, so every write can stamp both and the log
  // never claims the principal did something their delegate did.
  //
  // CHECKED AT EVERY CALL rather than trusted from a session: a delegation
  // can be revoked while somebody is sitting on a page with the switch on.
  var _actorEmail = resolvedEmail;
  var _actingDelegation = null;
  if (viewAs && viewAs.actAs && typeof Delegation !== 'undefined') {
    try {
      var _chk = Delegation.canActAs(resolvedEmail, viewAs.actAs);
      if (_chk.allowed) {
        _actingDelegation = _chk.delegation;
        resolvedEmail = _chk.delegation.principalEmail;
      } else {
        // Logged rather than silently ignored. Falling back to the delegate's
        // own context would show them their own empty queue, which looks like
        // a bug rather than a refusal.
        console.warn('getReviewerContext: act-as refused for ' + _actorEmail +
                     ' as ' + viewAs.actAs + ': ' + _chk.reason);
      }
    } catch (e) {
      console.error('getReviewerContext: delegation check failed: ' + e.message);
    }
  }

  var ctx = {
    // The identity whose AUTHORITY is in use. Role and scope resolve against
    // this.
    email: resolvedEmail,
    // The human at the keyboard. Equal to email unless acting as somebody
    // else.
    actorEmail: _actorEmail,
    actingAs: _actingDelegation ? _actingDelegation.principalEmail : '',
    actingAsName: _actingDelegation ? _actingDelegation.principalName : '',
    delegationId: _actingDelegation ? _actingDelegation.delegationId : '',
    role: 'none',
    scope: { type: 'none', codes: [], names: [] },
    label: '',
    isAdmin: false,
    // A coordinator handles workflow — reassignment and event proposals —
    // without the money and privilege powers an admin has. See
    // isTravelCoordinator.
    isCoordinator: false,
    isReviewer: false,
    viewAsActive: false,
    viewAsLabel: ''
  };
  if (!resolvedEmail) return ctx;

  // Reuse a passed-in TravelDB handle when available (saves the
  // SpreadsheetApp.openById cost when chained from getPortalBootstrap).
  var db = sharedDb || new TravelDB();

  // Priority 1: admin
  try {
    if (isTravelAdmin(resolvedEmail)) {
      ctx.role = 'admin';
      ctx.scope = { type: 'all', codes: [], names: [] };
      ctx.label = 'Admin';
      ctx.isAdmin = true;
      ctx.isReviewer = true;
      // An admin IS a coordinator. Set here as well as in the coordinator
      // branch below, because the admin branch RETURNS before reaching it —
      // without this, a UI showing a control on isCoordinator would hide it
      // from the very people who definitely have the power.
      ctx.isCoordinator = true;

      // View-as override only applies for admins
      if (viewAs && viewAs.role) {
        var override = _applyViewAsOverride(viewAs);
        if (override) {
          ctx.role = override.role;
          ctx.scope = override.scope;
          ctx.label = override.label + ' (test)';
          ctx.viewAsActive = true;
          ctx.viewAsLabel = override.label;
          // isAdmin stays true so the user can switch off; isReviewer stays true
        }
      }
      return ctx;
    }
  } catch (e) {
    console.error('getReviewerContext: admin check error: ' + e.message);
  }

  // Priority 1b: coordinator.
  //
  // Sits between admin and the reviewer roles. A coordinator is NOT a
  // reviewer — they do not approve anything — so isReviewer stays false and
  // they get no review queue. What they get is the admin console's request
  // list and the event screens.
  //
  // Their SCOPE is 'all', because reassigning a stuck request and resolving a
  // proposal are organization-wide jobs. A scoped coordinator could not do
  // the thing the role exists for.
  try {
    if (typeof isTravelCoordinator === 'function' &&
        isTravelCoordinator(resolvedEmail)) {
      ctx.role = 'coordinator';
      ctx.scope = { type: 'all', codes: [], names: [] };
      ctx.label = 'Coordinator';
      ctx.isCoordinator = true;
      // Deliberately NOT isReviewer. They have no queue and no approve
      // button; granting isReviewer would put them in reviewer dashboards
      // with nothing in them.
      return ctx;
    }
  } catch (e) {
    console.error('getReviewerContext: coordinator check failed: ' + e.message);
  }

  // Priority 2: OSO/FO reviewer
  try {
    if (isActiveOSOReviewer(resolvedEmail)) {
      ctx.role = 'oso';
      ctx.scope = { type: 'all', codes: [], names: [] };
      ctx.label = 'Front Office';
      ctx.isReviewer = true;
      return ctx;
    }
  } catch (e) {
    console.error('getReviewerContext: oso check error: ' + e.message);
  }

  // Priority 3: BU reviewer
  try {
    var bu = isActiveBUReviewer(resolvedEmail, db);
    if (bu.isBUReviewer) {
      ctx.role = 'bu';
      ctx.scope = { type: 'bu', codes: bu.buCodes, names: bu.buNames };
      ctx.label = bu.buNames[0] || bu.buCodes[0];
      ctx.isReviewer = true;
      return ctx;
    }
  } catch (e) {
    console.error('getReviewerContext: bu check error: ' + e.message);
  }

  // Priority 3.5: BU-level lead by HC office title (Chief of Staff,
  // Deputy COS, Client Executive, Deputy CE). Same scope/UI as a BU
  // reviewer — they see the Action Center filtered to their BU. The
  // per-request currentReviewerEmail check still gates approve/deny
  // actions so a COS/CE can't action requests they're not assigned;
  // this branch grants visibility, not authority.
  try {
    var buLead = _isBuLeadByTitle(resolvedEmail);
    if (buLead) {
      ctx.role = 'bu';
      ctx.scope = { type: 'bu', codes: buLead.buCodes, names: buLead.buNames };
      ctx.label = buLead.title + (buLead.buNames[0] ? ' · ' + buLead.buNames[0] : '');
      ctx.isReviewer = true;
      return ctx;
    }
  } catch (e) {
    console.error('getReviewerContext: bu-lead title check error: ' + e.message);
  }

  // Priority 4: Sector Director — label includes BU + Sector for context
  try {
    var sd = isSectorDirector(resolvedEmail, db);
    if (sd.isSD) {
      var firstSector = sd.sectorCodes[0];
      var desc = _describeSector(firstSector);
      var label;
      if (desc.buName && desc.sectorName) label = desc.buName + ' · ' + desc.sectorName;
      else if (desc.buName) label = desc.buName + ' · ' + firstSector;
      else label = firstSector + ' Sector Director';
      ctx.role = 'sector';
      ctx.scope = { type: 'sector', codes: sd.sectorCodes, names: desc.sectorName ? [desc.sectorName] : [] };
      ctx.label = label;
      ctx.isReviewer = true;
      return ctx;
    }
  } catch (e) {
    console.error('getReviewerContext: sd check error: ' + e.message);
  }

  // Priority 5: SUPERVISOR. The lowest-priority reviewer role, checked last
  // so anyone who is also an SCD, a DAC reviewer or the FO gets their wider
  // context instead — those scopes already include everything a supervisor
  // would see.
  //
  // THE SCOPE IS THEIR OWN ORG CODE, AND ONLY THAT. A supervisor is not a
  // service-center reviewer: they review the people they supervise, which is
  // the org code they sit in. Granting them the center's scope would let
  // every supervisor read every request in their center — around a dozen
  // orgs' worth — which is a far wider grant than the role implies and
  // nobody asked for.
  //
  // WHY THIS IS NEEDED AT ALL, given that the dashboard's "your reviews"
  // list keys off Current_Reviewer_Email rather than on role: without
  // isReviewer the dashboard refuses the caller outright
  // (ReviewerDashboard.js:36), so a supervisor with a request assigned to
  // them could not open the page that holds it.
  try {
    var bundle = HC.hcGetBundle();
    if (bundle && bundle.success && bundle.data) {
      var positions = bundle.data;
      for (var si = 0; si < positions.length; si++) {
        var sp = positions[si];
        if (!sp || !sp.emailAddress) continue;
        if (String(sp.emailAddress).toLowerCase() !== resolvedEmail.toLowerCase()) continue;
        if (!isHcSupervisoryCode(sp.supervisoryStatus)) continue;
        if (!isHcSeatOccupied(sp)) continue;
        var ownOrg = String(sp.orgCode || '').toUpperCase();
        if (!ownOrg) continue;

        ctx.role = 'supervisor';
        // type 'org' rather than 'sector': a different shape, because the
        // comparison is an exact org-code match rather than a walk to the
        // service-center level. _isRequestInUserScope handles it explicitly.
        ctx.scope = { type: 'org', codes: [ownOrg], names: [] };
        ctx.label = 'Supervisor · ' + ownOrg;
        ctx.isReviewer = true;
        return ctx;
      }
    }
  } catch (e) {
    console.error('getReviewerContext: supervisor check error: ' + e.message);
  }

  return ctx;
}

/**
 * Build a role + scope override from an admin's view-as request.
 * Returns null if the override is malformed or unsupported.
 *
 * @private
 * @param {Object} viewAs - { role: 'oso'|'bu'|'sector', buName?, sector? }
 * @returns {Object|null} { role, scope, label } or null
 */
function _applyViewAsOverride(viewAs) {
  var role = String(viewAs.role || '').toLowerCase();

  if (role === 'oso') {
    return {
      role: 'oso',
      scope: { type: 'all', codes: [], names: [] },
      label: 'Front Office'
    };
  }

  if (role === 'bu' && viewAs.buName) {
    return {
      role: 'bu',
      scope: { type: 'bu', codes: [], names: [viewAs.buName] },
      label: viewAs.buName
    };
  }

  if (role === 'sector' && viewAs.sector) {
    var sectorCode = String(viewAs.sector).toUpperCase();
    var desc = _describeSector(sectorCode);
    var label = (desc.buName && desc.sectorName)
      ? desc.buName + ' · ' + desc.sectorName
      : sectorCode + ' Sector Director';
    return {
      role: 'sector',
      scope: { type: 'sector', codes: [sectorCode], names: desc.sectorName ? [desc.sectorName] : [] },
      label: label
    };
  }

  return null;
}

/**
 * Client-callable: is the current user a reviewer (not admin)?
 *
 * Returns role + label so the portal can show appropriate UI without a second call.
 * @returns {Object} { success, isReviewer, isAdmin, role, label, email }
 */
function checkTravelReviewerAccess() {
  try {
    var ctx = getReviewerContext();
    return {
      success: true,
      isReviewer: !!ctx.isReviewer,
      isAdmin: !!ctx.isAdmin,
      role: ctx.role || 'none',
      label: ctx.label || '',
      email: ctx.email || ''
    };
  } catch (error) {
    console.error('checkTravelReviewerAccess error:', error);
    return { success: false, error: error.message || 'Failed to check reviewer access' };
  }
}

/**
 * Client-callable: is the current user an admin?
 * @returns {Object} { success, isAdmin, email }
 */
function checkTravelAdminAccess() {
  try {
    const email = Session.getActiveUser().getEmail();
    const adminStatus = isTravelAdmin(email);
    // A coordinator reaches the admin console too — the reassignment modal
    // and the event proposal queue both live there. Without this the client's
    // _checkAccess would replace the page with "Access Denied" the moment a
    // coordinator opened it, which is how the role would appear broken
    // rather than scoped.
    //
    // isAdmin stays TRUE only for real admins, so the client can still tell
    // them apart and hide the money and privilege sections.
    const coordinatorStatus = (typeof isTravelCoordinator === 'function')
      ? isTravelCoordinator(email) : adminStatus;
    return {
      success: true,
      isAdmin: adminStatus,
      isCoordinator: coordinatorStatus,
      // What the client should gate page ACCESS on. Named separately from
      // isAdmin so an existing caller reading isAdmin keeps its old meaning.
      hasConsoleAccess: coordinatorStatus,
      email: email
    };
  } catch (error) {
    console.error('checkTravelAdminAccess error:', error);
    return {
      success: false,
      isAdmin: false,
      error: error.message
    };
  }
}

/**
 * Generalized server-side role guard. Throws if the current user doesn't
 * meet the role requirement. Returns the resolved context on success so
 * callers can use email/name/role without a second Session call.
 *
 * Supported role names:
 *   'admin'    — must be a Travel Portal admin (admin role in Travel_User_Roles)
 *   'reviewer' — must be ANY reviewer (admin / OSO / BU / SD / COS / CE).
 *                Equivalent to "has access to the Action Center."
 *
 * Designed to be the canonical guard for any future RPC that needs role
 * gating. Add new role names here as the role catalog grows.
 *
 * @param {string} roleName - 'admin' | 'reviewer'
 * @returns {Object} { email, name, role } on success
 * @throws {Error} 'Not authenticated' or '<Role> access required'
 */
function requireRole(roleName) {
  const ctx = getReviewerContext();
  if (!ctx.email) {
    throw new Error('Not authenticated');
  }

  if (roleName === 'admin' && !ctx.isAdmin) {
    throw new Error('Admin access required');
  }
  if (roleName === 'reviewer' && !ctx.isReviewer) {
    throw new Error('Reviewer access required');
  }

  return {
    email: ctx.email,
    name: formatUserName(ctx.email),
    role: ctx.role
  };
}

/**
 * Back-compat shim: the same admin guard 18+ RPCs already call.
 * New code should prefer requireRole('admin') for consistency.
 *
 * @returns {Object} { email, name } on success
 * @throws {Error} 'Not authenticated' or 'Admin access required'
 */
function requireTravelAdmin() {
  return requireRole('admin');
}

/**
 * Is this user a travel coordinator?
 *
 * WHY THIS ROLE EXISTS
 * --------------------
 * @clolry needs a coordinator who can reassign a reviewer when somebody is
 * out, and resolve the event proposals travelers raise. Both of those sat
 * behind requireTravelAdmin, which also grants budget allocation editing, HR
 * roster editing, user role granting, and the HR data that was just
 * tier-restricted for PII.
 *
 * Granting a coordinator full admin to reassign a reviewer is a one-line
 * change and the wrong answer: it hands them every other admin power as a
 * side effect.
 *
 * WHAT A COORDINATOR MAY DO
 * -------------------------
 *   reassign a reviewer on a stuck request
 *   resolve event proposals — promote, merge, reject
 *   define and edit catalog events
 *   see the admin console's request list
 *
 * WHAT THEY MAY NOT
 * -----------------
 *   set budget allocations          money
 *   reserve event set-asides        money
 *   import existing travel          money, and writes approved requests
 *   edit the HR roster              HR data
 *   grant or revoke roles           privilege escalation
 *   read full HR PII                stays at the reviewer tier
 *
 * The split is money and privilege on one side, workflow on the other.
 *
 * AN ADMIN IS ALWAYS A COORDINATOR. Otherwise every coordinator-gated
 * function would need both checks, and one of them would eventually be
 * forgotten.
 *
 * @param {string} email
 * @returns {boolean}
 * @server
 */
function isTravelCoordinator(email) {
  if (!email) return false;
  var emailLower = email.toLowerCase();

  // Admins pass. Checked FIRST so a coordinator gate never locks out an
  // admin, which would be a confusing failure to diagnose.
  try {
    if (isTravelAdmin(emailLower)) return true;
  } catch (e) {
    console.error('isTravelCoordinator: admin check failed: ' + e.message);
  }

  try {
    var roles = _getUnifiedRolesForEmail(emailLower);
    for (var u = 0; u < roles.length; u++) {
      if (roles[u].roleType === 'coordinator') return true;
    }
  } catch (e) {
    console.error('isTravelCoordinator: unified-roles check failed: ' + e.message);
  }
  return false;
}

/**
 * Throws unless the caller is a coordinator or an admin.
 *
 * Returns the same shape as requireTravelAdmin so a call site can switch
 * between them without changing what it does with the result.
 *
 * @returns {{email: string, name: string, role: string, isAdmin: boolean}}
 * @server
 */
function requireTravelCoordinator() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    throw new Error('Not authenticated');
  }
  if (!email) throw new Error('Not authenticated');

  if (!isTravelCoordinator(email)) {
    // Logged because these functions are browser-reachable (G-001) and an
    // unexpected caller is worth seeing.
    console.warn('requireTravelCoordinator: refused ' + email);
    throw new Error('Coordinator or administrator access is required.');
  }

  var isAdmin = false;
  try { isAdmin = isTravelAdmin(email); } catch (e) { isAdmin = false; }

  return {
    email: email,
    name: formatUserName(email),
    // Reported so a caller can tell the two apart when it matters — the
    // approval log records which authority was used.
    role: isAdmin ? 'admin' : 'coordinator',
    isAdmin: isAdmin
  };
}

// ============================================================================
// PER-REQUEST GUARDS — used by review/edit RPCs to verify caller may
// touch THIS specific request, not just hold a generic role.
// ============================================================================

/**
 * Statuses where data edits are allowed (by submitter, current reviewer,
 * or admin via the standard update*ForReview RPC family).
 * Pending_DD_Confirmation, Pending_Correction, APPROVED_GOGOV, COMPLETED,
 * CANCELLED, DENIED are intentionally excluded — those need admin-only
 * status-change tools, not the standard editor.
 */
var REQUEST_EDITABLE_STATUSES = [
  STATUS_CODES.DRAFT,
  STATUS_CODES.PENDING_SUPERVISOR, STATUS_CODES.PENDING_SECTOR,
  STATUS_CODES.PENDING_BU, STATUS_CODES.PENDING_OSO, STATUS_CODES.PENDING_FAS,
  STATUS_CODES.NEEDS_INFO_SUPERVISOR, STATUS_CODES.NEEDS_INFO_SECTOR,
  STATUS_CODES.NEEDS_INFO_BU, STATUS_CODES.NEEDS_INFO_OSO
];

/**
 * Lightweight request lookup used by both per-request guards. Returns
 * the row's submitter email + current reviewer email + status, plus the
 * traveler list (for scope + DD checks). Cached via TravelDB so repeated
 * gate calls within an execution don't re-read the sheet.
 *
 * @private
 * @param {string} requestId
 * @param {TravelDB} [db]
 * @returns {Object|null} { submitterEmail, currentReviewerEmail, status, submitterOrgCode, travelers: [{orgCode, ddEmail}] }
 */
function _loadRequestForGate(requestId, db) {
  if (!requestId) return null;
  var localDb = db || new TravelDB();

  try {
    var reqData = localDb.readSheet(SHEET_NAMES.REQUESTS);
    var rIdx = reqData.headerIndex;
    var requestRow = null;
    for (var i = 0; i < reqData.rows.length; i++) {
      if (String(reqData.rows[i][rIdx['Request_ID']] || '').trim() === String(requestId).trim()) {
        requestRow = reqData.rows[i];
        break;
      }
    }
    if (!requestRow) return null;

    var travelers = [];
    try {
      var tData = localDb.readSheet(SHEET_NAMES.REQUEST_TRAVELERS);
      var tIdx = tData.headerIndex;
      for (var j = 0; j < tData.rows.length; j++) {
        if (String(tData.rows[j][tIdx['Request_ID']] || '').trim() === String(requestId).trim()) {
          travelers.push({
            orgCode: String(tData.rows[j][tIdx['Org_Code']] || ''),
            ddEmail: String(tData.rows[j][tIdx['DD_Email']] || '').toLowerCase()
          });
        }
      }
    } catch (te) { /* travelers optional for some checks */ }

    return {
      submitterEmail: String(requestRow[rIdx['Submitter_Email']] || '').toLowerCase(),
      currentReviewerEmail: String(requestRow[rIdx['Current_Reviewer_Email']] || '').toLowerCase(),
      status: String(requestRow[rIdx['Status']] || ''),
      submitterOrgCode: String(requestRow[rIdx['Submitter_Org_Code']] || ''),
      travelers: travelers
    };
  } catch (e) {
    console.error('_loadRequestForGate: error: ' + e.message);
    return null;
  }
}

/**
 * Test if a loaded request matches the user's role-context scope.
 * Mirrors the dashboard's traveler-aware scope checker so a COS/CE/BU
 * reviewer can see requests their staff are on, even when submitter
 * is in another BU.
 *
 * @private
 */
function _isRequestInUserScope(request, ctx) {
  if (!ctx || !ctx.scope) return false;
  if (ctx.scope.type === 'all') return true;

  var orgLookups;
  try { orgLookups = loadOrgLookups(); } catch (e) { return false; }
  var orgToBU = (orgLookups && orgLookups.orgToBU) || {};
  var orgToCurrentOrgCode = (orgLookups && orgLookups.orgToCurrentOrgCode) || {};

  function _orgInScope(orgCode) {
    if (!orgCode) return false;
    var canonical = orgToCurrentOrgCode[orgCode] || orgCode;
    if (ctx.scope.type === 'bu') {
      var bu = String(orgToBU[canonical] || '').toUpperCase();
      var names = ctx.scope.names || [];
      for (var i = 0; i < names.length; i++) {
        if (String(names[i]).toUpperCase() === bu) return true;
      }
      return false;
    }
    if (ctx.scope.type === 'sector') {
      // Walked, not truncated. ctx.scope.codes holds full SERVICE_CENTER
      // codes from isSectorDirector, so both sides must speak that
      // vocabulary — see orgCodeInScope.
      return orgCodeInScope(canonical, ctx.scope.codes || []);
    }
    if (ctx.scope.type === 'org') {
      // A SUPERVISOR'S SCOPE IS AN EXACT ORG MATCH, not a walk.
      //
      // Deliberately narrower than 'sector'. A supervisor reviews the people
      // they supervise — the org code they sit in — and walking upward or
      // matching a prefix would hand them their whole service center, around
      // a dozen orgs' worth of other people's travel.
      //
      // That matters because this function also gates READ access to a
      // request (:1989), not only the dashboard list. Getting it wrong here
      // is a privacy widening, not a cosmetic one.
      var codes = ctx.scope.codes || [];
      var own = String(canonical || '').toUpperCase();
      for (var oi = 0; oi < codes.length; oi++) {
        if (String(codes[oi]).toUpperCase() === own) return true;
      }
      return false;
    }
    return false;
  }

  if (_orgInScope(request.submitterOrgCode)) return true;
  for (var k = 0; k < request.travelers.length; k++) {
    if (_orgInScope(request.travelers[k].orgCode)) return true;
  }
  return false;
}

/**
 * VIEW gate: throws unless the caller is allowed to read this request.
 * Allowed:
 *   - The submitter
 *   - The currently-assigned reviewer
 *   - Any admin
 *   - Any reviewer whose scope covers this request (BU/SD/COS/CE/OSO)
 *   - Any DD assigned to a traveler on this request
 *
 * Returns the resolved context + loaded request so callers can use the
 * same data without re-loading.
 *
 * @param {string} requestId
 * @param {TravelDB} [db]
 * @returns {Object} { email, ctx, request } on success
 * @throws {Error} 'Not authenticated' | 'Request not found' | 'Access denied'
 */
function requireRequestViewer(requestId, db) {
  var ctx = getReviewerContext(null, null, db);
  if (!ctx.email) throw new Error('Not authenticated');
  if (ctx.isAdmin) {
    var requestForAdmin = _loadRequestForGate(requestId, db);
    if (!requestForAdmin) throw new Error('Request not found');
    return { email: ctx.email, ctx: ctx, request: requestForAdmin };
  }

  var request = _loadRequestForGate(requestId, db);
  if (!request) throw new Error('Request not found');

  var emailLower = ctx.email.toLowerCase();

  // Submitter
  if (request.submitterEmail && request.submitterEmail === emailLower) {
    return { email: ctx.email, ctx: ctx, request: request };
  }

  // Current assigned reviewer
  if (request.currentReviewerEmail && request.currentReviewerEmail === emailLower) {
    return { email: ctx.email, ctx: ctx, request: request };
  }

  // Reviewer whose scope covers this request
  if (ctx.isReviewer && _isRequestInUserScope(request, ctx)) {
    return { email: ctx.email, ctx: ctx, request: request };
  }

  // DD on any traveler in this request
  for (var i = 0; i < request.travelers.length; i++) {
    if (request.travelers[i].ddEmail === emailLower) {
      return { email: ctx.email, ctx: ctx, request: request };
    }
  }

  throw new Error('Access denied');
}

/**
 * EDIT gate: throws unless the caller is allowed to modify this request's
 * data via the standard update*ForReview RPC family.
 * Allowed:
 *   - The submitter, when status is in REQUEST_EDITABLE_STATUSES
 *   - The currently-assigned reviewer, same status check
 *   - Any admin, same status check (admins fix typos pre-finalization;
 *     post-finalization edits go through admin-only status tools, not
 *     this gate)
 *
 * Terminal-state requests (COMPLETED / CANCELLED / DENIED) — and
 * DD-pending states (APPROVED_GOGOV / Pending_DD_Confirmation /
 * Pending_Correction) — are immutable via this gate regardless of role.
 *
 * @param {string} requestId
 * @param {TravelDB} [db]
 * @returns {Object} { email, ctx, request } on success
 * @throws {Error} 'Not authenticated' | 'Request not found' |
 *                 'Cannot edit request in status: <X>' | 'Edit access denied'
 */
function requireRequestEditor(requestId, db) {
  var ctx = getReviewerContext(null, null, db);
  if (!ctx.email) throw new Error('Not authenticated');

  var request = _loadRequestForGate(requestId, db);
  if (!request) throw new Error('Request not found');

  if (REQUEST_EDITABLE_STATUSES.indexOf(request.status) === -1) {
    throw new Error('Cannot edit request in status: ' + request.status);
  }

  // Admin override always allowed (within editable statuses).
  if (ctx.isAdmin) {
    return { email: ctx.email, ctx: ctx, request: request };
  }

  var emailLower = ctx.email.toLowerCase();
  var isSubmitter = request.submitterEmail === emailLower;
  var isCurrentReviewer = request.currentReviewerEmail === emailLower;

  // NEEDS_INFO_* states: the workflow says "the ball is with the
  // submitter." Reviewers wait for the resubmit — they don't share
  // edit access during this window. Avoids racey co-editing where the
  // assigned reviewer and the submitter both touch the same fields.
  if (request.status.indexOf('NEEDS_INFO_') === 0) {
    if (isSubmitter) {
      return { email: ctx.email, ctx: ctx, request: request };
    }
    throw new Error('Edit access denied: only the submitter can edit a request that needs more info');
  }

  // PENDING_* states: submitter (corrections / additions) and the
  // currently-assigned reviewer can both edit.
  if (isSubmitter || isCurrentReviewer) {
    return { email: ctx.email, ctx: ctx, request: request };
  }

  throw new Error('Edit access denied');
}

/**
 * A service center's DAC name and readable center name, for display.
 *
 * TAKES A FULL SERVICE_CENTER CODE and matches it exactly. It used to
 * truncate both sides to four characters, which made 'FCA0' match all five of
 * FCA's centers and return whichever came first — so a reviewer's scope label
 * could name a different center than the one they actually oversee.
 *
 * @private
 * @param {string} sectorCode - a SERVICE_CENTER org code, e.g. 'FCA0B'
 * @returns {Object} { buName: string, sectorName: string } — fields may be empty
 */
function _describeSector(sectorCode) {
  var result = { buName: '', sectorName: '' };
  if (!sectorCode) return result;
  var sector = String(sectorCode).toUpperCase();
  try {
    var orgs = HC.hcGetOrgHierarchy();
    for (var i = 0; i < orgs.length; i++) {
      var o = orgs[i];
      if (!o || !o.orgCode) continue;
      if (String(o.orgCode).toUpperCase() !== sector) continue;
      if (!result.buName && o.businessUnit) result.buName = o.businessUnit;
      if (!result.sectorName && o.sector) {
        // Normalize "Sector 1 (Systems)" → "Sector 1"
        result.sectorName = String(o.sector).replace(/\s*\(.*\)$/, '');
      }
      if (result.buName && result.sectorName) break;
    }
  } catch (e) {
    console.warn('_describeSector: HC error: ' + e.message);
  }
  return result;
}
