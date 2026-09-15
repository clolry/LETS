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
 * Resolve the active Sector Director for a given sector code.
 *
 * Resolution order:
 *   1. Travel_User_Roles sector_override — if active row for this sector, use it
 *   2. HC auto-derive — find the SD position by:
 *        orgCode === sectorCode
 *        AND officeTitle contains "Sector Director"
 *        AND grade === '15' AND supervisoryStatus === '2' (sanity check)
 *   3. Occupancy gate — if matched position's occupancyStatus is VACANT or
 *      OBLIGATED, return null (caller should cascade to BU stage)
 *
 * @param {string} sectorCode - First 4 chars of an org code (e.g. 'QFAA')
 * @param {TravelDB} [db] - Optional TravelDB instance for cache reuse
 * @returns {Object|null} { name, email, source: 'override'|'hc', positionNumber, occupancyStatus, sectorCode } or null
 */
function getSectorDirector(sectorCode, db) {
  if (!sectorCode || sectorCode.length < 4) return null;
  var sector = sectorCode.substring(0, 4).toUpperCase();

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

  // Step 3: occupancy gate — VACANT and OBLIGATED both = unfilled
  var status = String(match.occupancyStatus || '').toUpperCase();
  if (status === 'VACANT' || status === 'OBLIGATED') return null;
  if (!match.emailAddress) return null;

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
 * Find the SD position record in HC for a given sector.
 * Position-first: identifies the SEAT regardless of occupancy.
 *
 * @private
 * @param {string} sector - Uppercase 4-char sector code
 * @returns {Object|null} HC position record or null
 */
function _findSectorDirectorPosition(sector) {
  try {
    var bundle = HC.hcGetBundle();
    if (!bundle || !bundle.success || !bundle.data) {
      console.warn('_findSectorDirectorPosition: HC bundle unavailable');
      return null;
    }

    var positions = bundle.data;
    for (var i = 0; i < positions.length; i++) {
      var p = positions[i];
      if (!p || !p.orgCode) continue;
      if (String(p.orgCode).toUpperCase() !== sector) continue;
      if (!p.officeTitle) continue;
      if (p.officeTitle.toLowerCase().indexOf('sector director') === -1) continue;
      if (String(p.grade) !== '15') continue;
      if (String(p.supervisoryStatus) !== '2') continue;
      return p;
    }
    return null;
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
      if (String(oc).substring(0, 4).toUpperCase() === sector) {
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
 * Allow if EITHER:
 *   - the user has any active role in Travel_User_Roles
 *     (admin / aas_fo_reviewer / fas_fo_reviewer / bu_reviewer /
 *      sector_override / approved_user), OR
 *   - HC staffing shows them in a filled supervisor position
 *     (supervisoryStatus === '2', occupancy NOT vacant/obligated), OR
 *   - HC office title identifies them as a BU-level lead (Client Executive /
 *     Chief of Staff and their deputies) in a filled seat. These leads carry
 *     no role row and may have a non-'2' supervisoryStatus, but
 *     getReviewerContext already hands them a BU-scoped reviewer dashboard —
 *     so the site gate must admit them too (_isBuLeadByTitle).
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
    if (roles && roles.length > 0) return true;
  } catch (e) {
    console.warn('canAccessTrip: unified-roles check failed: ' + e.message);
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
        if (String(p.supervisoryStatus) !== '2') continue;
        var status = String(p.occupancyStatus || '').toUpperCase();
        if (status === 'VACANT' || status === 'OBLIGATED') continue;
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
    if (_isBuLeadByTitle(emailLower)) return true;
  } catch (e) {
    console.warn('canAccessTrip: bu-lead-by-title check failed: ' + e.message);
  }

  return false;
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
        if (String(p.supervisoryStatus) !== '2') continue;
        var status = String(p.occupancyStatus || '').toUpperCase();
        if (status === 'VACANT' || status === 'OBLIGATED') continue;
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
        out.diagnosis.push('No HC position found for this email (so the supervisor allow-path does not apply).');
      } else {
        out.hcPositions.forEach(function(h) {
          if (!h.grantsAccess) {
            out.diagnosis.push('HC position "' + h.officeTitle + '" does NOT grant access (supervisoryStatus=' +
              h.supervisoryStatus + ', occupancy=' + h.occupancyStatus + '; needs supervisoryStatus=2 and a filled seat).');
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

  // --- 6. Final verdict ---
  out.allowed = canAccessTrip(emailLower);
  if (out.allowed && out.diagnosis.length === 0) {
    out.diagnosis.push('ALLOWED — user has an effective role, a qualifying HC supervisor position, or a BU-lead title.');
  } else if (out.allowed) {
    out.diagnosis.unshift('ALLOWED (despite notes below).');
  } else if (out.diagnosis.length === 0) {
    out.diagnosis.push('DENIED — no active role, no qualifying HC supervisor position, and no BU-lead title.');
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
 * Check if a user is currently an active Sector Director (via override or HC).
 * Walks sector_override role rows first, then scans HC for any SD position they occupy.
 *
 * @param {string} email - Email to check
 * @param {TravelDB} [db] - Optional TravelDB instance for cache reuse
 * @returns {Object} { isSD: boolean, sectorCodes: string[] } — sector codes they oversee
 */
function isSectorDirector(email, db) {
  if (!email) return { isSD: false, sectorCodes: [] };
  var emailLower = email.toLowerCase();
  var sectorCodes = [];

  // 1. sector_override.Scope is the sector NAME.
  // Resolve to 4-char sector codes via HC's orgToSector map so the rest
  // of the function (and consumers) can keep using codes for sector
  // identification (which matches how requests carry their sector).
  try {
    var unifiedRoles = _getUnifiedRolesForEmail(emailLower, db);
    if (unifiedRoles.length > 0) {
      var orgLookups = loadOrgLookups();
      var orgToSector = (orgLookups && orgLookups.orgToSector) || {};
      for (var ur = 0; ur < unifiedRoles.length; ur++) {
        if (unifiedRoles[ur].roleType !== 'sector_override') continue;
        var sectorName = unifiedRoles[ur].scope;
        if (!sectorName) continue;
        // Find every 4-char prefix that maps to this sector name
        for (var oc in orgToSector) {
          if (!orgToSector.hasOwnProperty(oc)) continue;
          if (orgToSector[oc] !== sectorName) continue;
          var resolved = String(oc).substring(0, 4).toUpperCase();
          if (resolved && sectorCodes.indexOf(resolved) === -1) {
            sectorCodes.push(resolved);
          }
        }
      }
    }
  } catch (eu) {
    console.error('isSectorDirector: unified-roles check failed: ' + eu.message);
  }

  // 2. Check HC for any SD position they occupy (filled, not vacant/obligated)
  try {
    var bundle = HC.hcGetBundle();
    if (bundle && bundle.success && bundle.data) {
      var positions = bundle.data;
      for (var j = 0; j < positions.length; j++) {
        var p = positions[j];
        if (!p || !p.officeTitle || !p.emailAddress) continue;
        if (String(p.emailAddress).toLowerCase() !== emailLower) continue;
        if (p.officeTitle.toLowerCase().indexOf('sector director') === -1) continue;
        if (String(p.grade) !== '15') continue;
        if (String(p.supervisoryStatus) !== '2') continue;
        var status = String(p.occupancyStatus || '').toUpperCase();
        if (status === 'VACANT' || status === 'OBLIGATED') continue;
        var sec = String(p.orgCode || '').substring(0, 4).toUpperCase();
        if (sec && sectorCodes.indexOf(sec) === -1) sectorCodes.push(sec);
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
      var status = String(p.occupancyStatus || '').toUpperCase();
      if (status === 'VACANT' || status === 'OBLIGATED') continue;

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
  var ctx = {
    email: resolvedEmail,
    role: 'none',
    scope: { type: 'none', codes: [], names: [] },
    label: '',
    isAdmin: false,
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
    return {
      success: true,
      isAdmin: adminStatus,
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
  STATUS_CODES.PENDING_SECTOR, STATUS_CODES.PENDING_BU, STATUS_CODES.PENDING_OSO, STATUS_CODES.PENDING_FAS,
  STATUS_CODES.NEEDS_INFO_SECTOR, STATUS_CODES.NEEDS_INFO_BU, STATUS_CODES.NEEDS_INFO_OSO
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
      var sec = String(canonical).substring(0, 4).toUpperCase();
      var codes = ctx.scope.codes || [];
      for (var j = 0; j < codes.length; j++) {
        if (String(codes[j]).toUpperCase() === sec) return true;
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
 * Look up a sector code's BU name + readable sector name from HC org hierarchy.
 * @private
 * @param {string} sectorCode - 4-char sector code (e.g. 'QFAA')
 * @returns {Object} { buName: string, sectorName: string } — fields may be empty
 */
function _describeSector(sectorCode) {
  var result = { buName: '', sectorName: '' };
  if (!sectorCode) return result;
  var sector = String(sectorCode).substring(0, 4).toUpperCase();
  try {
    var orgs = HC.hcGetOrgHierarchy();
    for (var i = 0; i < orgs.length; i++) {
      var o = orgs[i];
      if (!o || !o.orgCode) continue;
      if (String(o.orgCode).substring(0, 4).toUpperCase() !== sector) continue;
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
