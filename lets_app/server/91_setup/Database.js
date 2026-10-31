/**
 * TravelDatabaseSetup.js
 * Database initialization and schema management for Travel Request System v2
 *
 * Run setupTravelDatabase() once to create all required sheets with headers.
 * Run initSystemConfig() to set up PropertiesService values.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================


const TRAVEL_DB_CONFIG = {
  // Spreadsheet ID
  spreadsheetId: TRAVEL_DB_SPREADSHEET_ID,

  // Sheet names — moved to SHEET_NAMES in 01_constants/Sheets.js (Chunk 8a).
  // Status codes — moved to STATUS_CODES in 01_constants/Status.js (Chunk 8b).
  // Action types — moved to ACTION_TYPES in 01_constants/Status.js (Chunk 8b).

  // Default config values
  //
  // WARNING: initTravelSystemConfig() lowercases these keys when it writes
  // them, but the Props.js getters read UPPER_SNAKE for four of the seven.
  // Only other_cost_percentage, travel_email_address and travel_email_name
  // round-trip; PRIVATE_MILEAGE_RATE, GOV_MILEAGE_RATE, LOCAL_TRAVEL_THRESHOLD
  // and DRIVE_FOLDER_ID are written in a form nothing reads. Set
  // MILEAGE_RATE_PRIVATE, MILEAGE_RATE_GOV and SHARED_DRIVE_FOLDER_ID by hand
  // instead. See the Props.js:28 TODO about renaming these six.
  defaults: {
    PRIVATE_MILEAGE_RATE: 0.70,
    GOV_MILEAGE_RATE: 0.22,
    LOCAL_TRAVEL_THRESHOLD: 50,
    OTHER_COST_PERCENTAGE: 30,
    DRIVE_FOLDER_ID: '1BVAqc5GM6L5LAE85kW94uGHLNwIAa3e',
    TRAVEL_EMAIL_ADDRESS: 'ASD.Travel-Events@gsa.gov',
    TRAVEL_EMAIL_NAME: 'ASD Travel & Events'
  }
};


// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

/**
 * Main setup function - creates all Travel Request sheets with headers
 * Run this once to initialize the database
 * @returns {Object} Result with success status and details
 */
function setupTravelDatabase() {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    const results = [];

    // Create each sheet defined in the schema
    for (const [sheetName, headers] of Object.entries(TRAVEL_SHEET_SCHEMAS)) {
      const result = createOrUpdateSheet(ss, sheetName, headers);
      results.push(result);
    }

    // Log results
    console.log('=== Travel Database Setup Complete ===');
    results.forEach(r => {
      console.log(`${r.action}: ${r.sheetName} (${r.columnCount} columns)`);
    });

    return {
      success: true,
      message: 'Travel database setup complete',
      sheets: results
    };

  } catch (error) {
    console.error('Error setting up travel database:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Surgically install the unified user/role schema on a LIVE database.
 *
 * Safe to run on production. Idempotent: re-running detects what's already
 * been done and skips it. Never touches sheets that aren't part of this
 * migration.
 *
 * @returns {Object} { success, steps: [{step, action, message}] }
 */
function addUnifiedUserSchema() {
  const steps = [];
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    const usersName = SHEET_NAMES.TRAVEL_USERS;
    const rolesName = SHEET_NAMES.TRAVEL_USER_ROLES;

    // Step 1: create Travel_Users (master roster) if missing
    const existingUsers = ss.getSheetByName(usersName);
    if (existingUsers) {
      const lastCol = existingUsers.getLastColumn();
      const headers = lastCol > 0
        ? existingUsers.getRange(1, 1, 1, lastCol).getValues()[0]
        : [];
      if (headers.indexOf('User_ID') !== -1) {
        steps.push({ step: 'create_users', action: 'exists',
          message: 'Travel_Users already present' });
      } else {
        const newHeaders = TRAVEL_SHEET_SCHEMAS[usersName];
        const range = existingUsers.getRange(1, 1, 1, newHeaders.length);
        range.setValues([newHeaders]);
        range.setFontWeight('bold');
        range.setBackground('#f3f4f6');
        range.setWrap(true);
        existingUsers.setFrozenRows(1);
        for (let i = 1; i <= newHeaders.length; i++) existingUsers.autoResizeColumn(i);
        steps.push({ step: 'create_users', action: 'headers_added',
          message: 'Wrote headers onto existing empty Travel_Users sheet' });
      }
    } else {
      const newHeaders = TRAVEL_SHEET_SCHEMAS[usersName];
      const sheet = ss.insertSheet(usersName);
      const range = sheet.getRange(1, 1, 1, newHeaders.length);
      range.setValues([newHeaders]);
      range.setFontWeight('bold');
      range.setBackground('#f3f4f6');
      range.setWrap(true);
      sheet.setFrozenRows(1);
      for (let i = 1; i <= newHeaders.length; i++) sheet.autoResizeColumn(i);
      steps.push({ step: 'create_users', action: 'created',
        message: 'Created Travel_Users (master roster) with ' + newHeaders.length + ' columns' });
    }

    // Step 2: create Travel_User_Roles if missing
    const existingRoles = ss.getSheetByName(rolesName);
    if (existingRoles) {
      steps.push({ step: 'create_roles', action: 'exists',
        message: 'Travel_User_Roles already exists' });
    } else {
      const roleHeaders = TRAVEL_SHEET_SCHEMAS[rolesName];
      const sheet = ss.insertSheet(rolesName);
      const range = sheet.getRange(1, 1, 1, roleHeaders.length);
      range.setValues([roleHeaders]);
      range.setFontWeight('bold');
      range.setBackground('#f3f4f6');
      range.setWrap(true);
      sheet.setFrozenRows(1);
      for (let i = 1; i <= roleHeaders.length; i++) sheet.autoResizeColumn(i);
      steps.push({ step: 'create_roles', action: 'created',
        message: 'Created Travel_User_Roles with ' + roleHeaders.length + ' columns' });
    }

    // Step 3: enforce text format on ID columns so HC employee_ids with
    // leading zeros aren't auto-coerced to numbers by Sheets.
    try {
      _enforceUserIdTextFormat(ss);
      steps.push({ step: 'enforce_text_format', action: 'applied',
        message: 'Set User_ID + Role_ID columns to plain-text format' });
    } catch (fe) {
      steps.push({ step: 'enforce_text_format', action: 'warn',
        message: 'Format enforcement failed (non-fatal): ' + fe.message });
    }

    console.log('=== addUnifiedUserSchema complete ===');
    steps.forEach(s => console.log(s.step + ': ' + s.action + ' - ' + s.message));

    return { success: true, steps: steps };
  } catch (error) {
    console.error('addUnifiedUserSchema error:', error);
    return { success: false, error: error.message, steps: steps };
  }
}

/**
 * Set the User_ID / Role_ID columns to plain-text format on both unified
 * tables. Prevents Google Sheets from auto-coercing values like "00012345"
 * (HC employee IDs with leading zeros) to the number 12345.
 *
 * Idempotent. Cheap. Safe to run repeatedly.
 *
 * @private
 */
function _enforceUserIdTextFormat(ss) {
  // Travel_Users: column 1 = User_ID
  var users = ss.getSheetByName(SHEET_NAMES.TRAVEL_USERS);
  if (users) {
    users.getRange('A:A').setNumberFormat('@');
  }
  // Travel_User_Roles: column 1 = Role_ID, column 2 = User_ID
  var roles = ss.getSheetByName(SHEET_NAMES.TRAVEL_USER_ROLES);
  if (roles) {
    roles.getRange('A:B').setNumberFormat('@');
  }
}

/**
 * Standalone helper — run from the Apps Script editor if column formatting
 * ever drifts (e.g. someone changes the User_ID column format manually).
 * Re-applies plain-text format to all ID columns. Does NOT touch row data.
 *
 * @returns {Object} { success, message }
 */
function enforceUserIdTextFormat() {
  try {
    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    _enforceUserIdTextFormat(ss);
    console.log('enforceUserIdTextFormat: applied to Travel_Users.User_ID + Travel_User_Roles.Role_ID/User_ID');
    return { success: true, message: 'Plain-text format applied to ID columns.' };
  } catch (e) {
    console.error('enforceUserIdTextFormat error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * One-time bootstrap: insert a single user into Travel_Users with the
 * 'admin' role. Used to seed the very first admin so they can log in and
 * use the new admin UI to add everyone else.
 *
 * Idempotent: if the user already exists (matched by User_ID OR by lowercased
 * email), the user row is reused and the admin role is added only if not
 * already present. Safe to re-run.
 *
 * Defaults are set for the project owner (michael.thoennes@gsa.gov,
 * User_ID = ext_thoennes). External user IDs (ext_*) are used for non-HC
 * people; HC users would normally use their employee_id, but for this
 * bootstrap we only seed one external admin.
 *
 * @param {string} [email] - defaults to 'michael.thoennes@gsa.gov'
 * @param {string} [name]  - defaults to 'Michael Thoennes'
 * @param {string} [userId] - defaults to 'ext_thoennes'
 * @returns {Object} { success, action, user, role }
 */
function bootstrapTravelAdmin(email, name, userId) {
  try {
    var now = new Date();
    var emailIn = String(email || 'michael.thoennes@gsa.gov').trim();
    var nameIn = String(name || 'Michael Thoennes').trim();
    var userIdIn = String(userId || 'ext_thoennes').trim();
    var emailLc = emailIn.toLowerCase();

    if (!emailIn || !userIdIn) {
      throw new Error('email and userId are required');
    }

    var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    var usersSheet = ss.getSheetByName(SHEET_NAMES.TRAVEL_USERS);
    var rolesSheet = ss.getSheetByName(SHEET_NAMES.TRAVEL_USER_ROLES);
    if (!usersSheet || !rolesSheet) {
      throw new Error('New schema not present. Run addUnifiedUserSchema() first.');
    }

    // Validate new shape on Travel_Users
    var userHeaders = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
    if (userHeaders.indexOf('User_ID') === -1) {
      throw new Error('Travel_Users does not have new shape (missing User_ID column).');
    }
    var roleHeaders = rolesSheet.getRange(1, 1, 1, rolesSheet.getLastColumn()).getValues()[0];

    // Look for existing user by User_ID or email
    var existingUser = null;
    var existingUserRow = -1;
    if (usersSheet.getLastRow() > 1) {
      var userData = usersSheet.getRange(2, 1, usersSheet.getLastRow() - 1, userHeaders.length).getValues();
      var idIdx = userHeaders.indexOf('User_ID');
      var emIdx = userHeaders.indexOf('Email');
      for (var i = 0; i < userData.length; i++) {
        var rowUid = String(userData[i][idIdx] || '').trim();
        var rowEm = String(userData[i][emIdx] || '').trim().toLowerCase();
        if (rowUid === userIdIn || (rowEm && rowEm === emailLc)) {
          existingUser = {};
          for (var c = 0; c < userHeaders.length; c++) existingUser[userHeaders[c]] = userData[i][c];
          existingUserRow = i + 2; // +1 for header, +1 for 1-based
          break;
        }
      }
    }

    var userAction;
    if (existingUser) {
      userIdIn = existingUser.User_ID;
      userAction = 'exists';
    } else {
      var newUserRecord = {
        User_ID: userIdIn,
        Email: emailIn,
        Name: nameIn,
        Source: 'External',
        Is_Active: true,
        Created_By: 'bootstrap',
        Created_At: now,
        Updated_By: 'bootstrap',
        Updated_At: now
      };
      var newUserRow = [];
      for (var uh = 0; uh < userHeaders.length; uh++) newUserRow.push(newUserRecord[userHeaders[uh]]);
      // Bulletproof write: pin User_ID cell to text format + flush + setValues
      // so leading-zero employee IDs survive (matters when seeding a real HC
      // admin via this helper, not for the default ext_thoennes path).
      var newUserRowNum = usersSheet.getLastRow() + 1;
      usersSheet.getRange(newUserRowNum, 1).setNumberFormat('@');
      SpreadsheetApp.flush();
      usersSheet.getRange(newUserRowNum, 1, 1, userHeaders.length).setValues([newUserRow]);
      existingUser = newUserRecord;
      userAction = 'created';
    }

    // Look for existing admin role for this user
    var roleId = _generateBootstrapRoleId(userIdIn, 'admin', '');
    var existingRoleRow = -1;
    if (rolesSheet.getLastRow() > 1) {
      var roleData = rolesSheet.getRange(2, 1, rolesSheet.getLastRow() - 1, roleHeaders.length).getValues();
      var rUidIdx = roleHeaders.indexOf('User_ID');
      var rTypeIdx = roleHeaders.indexOf('Role_Type');
      var rScopeIdx = roleHeaders.indexOf('Scope');
      for (var ri = 0; ri < roleData.length; ri++) {
        var rUid = String(roleData[ri][rUidIdx] || '').trim();
        var rType = String(roleData[ri][rTypeIdx] || '').trim();
        var rScope = String(roleData[ri][rScopeIdx] || '').trim();
        if (rUid === userIdIn && rType === 'admin' && rScope === '') {
          existingRoleRow = ri + 2;
          break;
        }
      }
    }

    var roleAction;
    if (existingRoleRow > 0) {
      roleAction = 'exists';
    } else {
      var newRoleRecord = {
        Role_ID: roleId,
        User_ID: userIdIn,
        Role_Type: 'admin',
        Scope: '',
        Is_Primary: true,
        Is_Active: true,
        Notes: 'Bootstrap admin',
        Granted_By: 'bootstrap',
        Granted_At: now,
        Updated_By: 'bootstrap',
        Updated_At: now
      };
      var newRoleRow = [];
      for (var rh = 0; rh < roleHeaders.length; rh++) newRoleRow.push(newRoleRecord[roleHeaders[rh]]);
      // Bulletproof write — pin Role_ID + User_ID cells to text format
      var newRoleRowNum = rolesSheet.getLastRow() + 1;
      rolesSheet.getRange(newRoleRowNum, 1, 1, 2).setNumberFormat('@');
      SpreadsheetApp.flush();
      rolesSheet.getRange(newRoleRowNum, 1, 1, roleHeaders.length).setValues([newRoleRow]);
      roleAction = 'created';
    }

    // Clear unified-role cache so the new admin is recognized immediately
    try { _invalidateUnifiedRoleCache(); } catch (ce) {}
    // Clear TravelDB sheet caches for the two new tables so subsequent reads
    // see the just-written rows (TravelDB caches across executions)
    try {
      var dbInval = new TravelDB();
      dbInval.invalidate(SHEET_NAMES.TRAVEL_USERS);
      dbInval.invalidate(SHEET_NAMES.TRAVEL_USER_ROLES);
    } catch (de) {}
    // Broadcast so any open admin sessions pick up the new admin
    try { broadcastTravelUsersChange(); } catch (be) {}

    var summary = 'user=' + userAction + ', role=' + roleAction;
    console.log('=== bootstrapTravelAdmin complete: ' + summary + ' ===');
    console.log('User_ID: ' + userIdIn);

    return {
      success: true,
      action: summary,
      user: { User_ID: userIdIn, Email: emailIn, Name: nameIn, Source: 'External' },
      role: { Role_ID: roleId, Role_Type: 'admin', Scope: '' }
    };
  } catch (error) {
    console.error('bootstrapTravelAdmin error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * ONE-SHOT: seed the two initial LETS administrators.
 * =========================================================================
 * DELETE THIS FUNCTION, AND ITS HELPER _seedInitialAdminsPreflight(),
 * ONCE IT HAS RUN SUCCESSFULLY. See "Removal" below.
 *
 * WHY THIS EXISTS
 * ---------------
 * Admin rights in this system are DATA, not code: an administrator is a row
 * in Travel_User_Roles with Role_Type 'admin', joined to Travel_Users by
 * User_ID. There is no hardcoded admin list anywhere in the codebase, and
 * there must not be one — every access decision routes through that table.
 *
 * The normal way to grant admin is the admin console (?mode=admin → Users),
 * but that path calls requireTravelAdmin(), so it cannot create the FIRST
 * admin. bootstrapTravelAdmin() exists for exactly that, but it takes its
 * identity as arguments and the Apps Script editor's Run button cannot pass
 * arguments — so an unparameterised run would silently fall through to its
 * hardcoded default (a TRIP-era project owner) and seed the wrong person.
 *
 * This wrapper supplies the two real identities explicitly. It follows the
 * same "editor convenience wrapper" pattern as _testAccessGate()
 * (30_services/Access.js:443) and _diagnoseAccess() (:512).
 *
 * HOW TO RUN
 * ----------
 *   1. Apps Script editor → select `_seedInitialAdmins` in the function
 *      dropdown → Run.
 *   2. Authorise if prompted.
 *   3. Read the execution log. Every seeded identity is printed with the
 *      action taken ('created' or 'exists').
 *   4. Confirm in the spreadsheet: two new rows in Travel_Users and two in
 *      Travel_User_Roles with Role_Type 'admin' and Is_Active TRUE.
 *   5. Sign in to the web app and open ?mode=admin.
 *
 * IDEMPOTENT. bootstrapTravelAdmin matches on User_ID OR lowercased email
 * and reuses an existing row, so re-running this is safe and will report
 * 'exists' rather than creating duplicates.
 *
 * WHY ext_* USER IDS
 * ------------------
 * Both administrators are outside the HC directory, so neither has an HC
 * employee_id to use as User_ID. The `ext_` prefix is this schema's
 * convention for non-HC people (see bootstrapTravelAdmin's header and
 * _seedTestSubmitter's 'External' Source value).
 *
 * KNOWN LIMITATION — the audit trail will say 'bootstrap', not a person.
 * bootstrapTravelAdmin hardcodes Granted_By: 'bootstrap' (:333), so these
 * two grants are not attributable to a named human. That is finding G-002
 * and it is not fixed here, because changing the shared bootstrap writer is
 * a separate change with its own blast radius. The console-granted roles
 * that follow WILL carry a real Granted_By.
 *
 * AFTER THIS RUNS — three things, in order
 * ----------------------------------------
 *   a) Verify:  run `verifyPhase7Routing` (30_services/OrgLookup.js:192).
 *      It should no longer report a missing active admin.
 *   b) Grant every subsequent user through the admin console, NOT through
 *      this function or the spreadsheet. Console writes record a real
 *      Granted_By and clear the caches; direct sheet edits do neither and
 *      can take up to 10 minutes to take effect.
 *   c) REMOVAL: delete this function AND _seedInitialAdminsPreflight() from
 *      this file, then push. Leaving them in
 *      place leaves a browser-reachable, unguarded admin-seeding function in
 *      production, which is a second instance of G-002. It has no trailing
 *      underscore in the Apps Script privacy sense (a LEADING underscore
 *      confers nothing — see ADMINISTRATOR_GUIDE.md §1.4.5), so while this
 *      function exists, any authenticated user can call it.
 *
 * @returns {Object} { success, seeded: Object[], adminCountAfter }
 */
function _seedInitialAdmins() {
  // The two initial administrators. Confirmed 2026-10-28.
  var ADMINS = [
    { email: 'ozel.kirkland@gsa.gov',       name: 'Ozel Kirkland',       userId: 'ext_kirkland' },
    { email: 'christopher.olry@gsa.gov',    name: 'Christopher Olry',    userId: 'ext_olry' }
  ];

  console.log('=== _seedInitialAdmins: seeding ' + ADMINS.length + ' administrator(s) ===');

  // ---- PRE-FLIGHT -------------------------------------------------------
  // Every write below reaches the sheet through SpreadsheetApp.openById(
  // TRAVEL_DB_SPREADSHEET_ID). That constant is read from Script Properties
  // at module load (00_config/TripConfig.js:134) and is NULL when the
  // property is unset, which makes openById throw the platform's own
  // 'Invalid argument: id' — a message that says nothing about the cause.
  //
  // This block exists because that is precisely what happened on the first
  // real run of this function: the property was unset in the target project
  // and the log showed three 'Invalid argument: id' errors with no hint that
  // a configuration value was missing. Diagnose it here instead.
  var preflight = _seedInitialAdminsPreflight();
  if (!preflight.ok) {
    console.error('=== _seedInitialAdmins ABORTED — nothing was written ===');
    for (var p = 0; p < preflight.problems.length; p++) {
      console.error('  ' + preflight.problems[p]);
    }
    return { success: false, aborted: true, problems: preflight.problems };
  }
  console.log('  pre-flight OK — database reachable, both role tabs present');

  var results = [];

  for (var i = 0; i < ADMINS.length; i++) {
    var a = ADMINS[i];
    var r = bootstrapTravelAdmin(a.email, a.name, a.userId);
    results.push({ email: a.email, userId: a.userId, result: r });

    if (r && r.success) {
      console.log('  OK   ' + a.email + '  (' + a.userId + ')  ' + r.action);
    } else {
      console.error('  FAIL ' + a.email + '  ' + ((r && r.error) || 'unknown error'));
    }
  }

  // Confirm the grants are visible to the authorization layer, not just
  // written to the sheet. bootstrapTravelAdmin invalidates the caches, so a
  // read here should see the new rows. If this reports false, the role write
  // landed but the cache did not clear — wait 600 seconds and re-check
  // rather than re-running.
  var verified = [];
  for (var j = 0; j < ADMINS.length; j++) {
    var isAdmin = false;
    try {
      isAdmin = isTravelAdmin(ADMINS[j].email);
    } catch (e) {
      console.warn('  verification call failed for ' + ADMINS[j].email + ': ' + e.message);
    }
    verified.push({ email: ADMINS[j].email, recognizedAsAdmin: isAdmin });
    console.log('  verify ' + ADMINS[j].email + ' → isTravelAdmin: ' + isAdmin);
  }

  var allOk = results.every(function (x) { return x.result && x.result.success; }) &&
              verified.every(function (v) { return v.recognizedAsAdmin; });

  console.log('=== _seedInitialAdmins ' + (allOk ? 'COMPLETE' : 'INCOMPLETE — read the log above') + ' ===');
  if (allOk) {
    console.log('NEXT: 1. run verifyPhase7Routing() to confirm the admin gap is closed');
    console.log('      2. DELETE _seedInitialAdmins AND _seedInitialAdminsPreflight');
    console.log('         from 91_setup/Database.js, then push.');
    console.log('      Leaving them in place leaves an unguarded, browser-reachable');
    console.log('      admin-seeding function in production (finding G-002).');
  }

  return { success: allOk, seeded: results, verified: verified };
}

/**
 * ONE-SHOT HELPER — delete alongside _seedInitialAdmins.
 *
 * Pre-flight for _seedInitialAdmins: confirm the database is reachable and
 * both role tabs exist BEFORE attempting any write.
 *
 * Checks, in dependency order — each one is a prerequisite of the next, so
 * the first failure stops the chain and reports the actual cause rather than
 * a downstream symptom:
 *
 *   1. TRAVEL_DB_SPREADSHEET_ID is set.          Unset → openById(null)
 *                                                throws 'Invalid argument: id'.
 *   2. The ID opens.                             Wrong/revoked ID, or the
 *                                                executing account lacks
 *                                                access to that sheet.
 *   3. Travel_Users exists, with a User_ID column.
 *   4. Travel_User_Roles exists.
 *                                                Either missing → run the
 *                                                addUnifiedUserSchema function.
 *
 * Read-only. Writes nothing under any outcome.
 *
 * @private
 * @returns {Object} { ok: boolean, problems: string[], spreadsheetName?: string }
 */
function _seedInitialAdminsPreflight() {
  var problems = [];

  // 1 — is the property set at all?
  if (!TRAVEL_DB_SPREADSHEET_ID) {
    problems.push(
      'TRAVEL_DB_SPREADSHEET_ID is NOT SET in this project\'s Script Properties.');
    problems.push(
      '  Fix: Project Settings (gear) -> Script Properties -> Add script property');
    problems.push(
      '       name:  TRAVEL_DB_SPREADSHEET_ID');
    problems.push(
      '       value: the ID of the LETS database Google Sheet');
    problems.push(
      '  The ID is the long string in the sheet URL between /d/ and /edit.');
    problems.push(
      '  Verify the sheet has Travel_Users and Travel_User_Roles tabs first.');
    problems.push(
      '  Note: this constant is read ONCE at module load, so after setting the');
    problems.push(
      '  property you must re-run this function (no redeploy needed).');
    return { ok: false, problems: problems };
  }

  // 2 — does it open? Covers a wrong ID, a deleted sheet, and the case where
  // the executing account simply cannot see it.
  var ss;
  try {
    ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  } catch (e) {
    problems.push(
      'TRAVEL_DB_SPREADSHEET_ID is set but the sheet could not be opened.');
    problems.push('  value: ' + TRAVEL_DB_SPREADSHEET_ID);
    problems.push('  error: ' + e.message);
    problems.push(
      '  Either the ID is wrong, or the account running this function does not');
    problems.push(
      '  have access to that spreadsheet. Open it in a browser as yourself to');
    problems.push('  check: https://docs.google.com/spreadsheets/d/' +
      TRAVEL_DB_SPREADSHEET_ID + '/edit');
    return { ok: false, problems: problems };
  }

  // 3 and 4 — the two tabs bootstrapTravelAdmin writes. It performs the same
  // checks itself and throws a clearer message than openById does, but by
  // then it has already been called once per administrator; reporting here
  // keeps the failure to a single line and guarantees no partial seeding.
  var usersSheet = ss.getSheetByName(SHEET_NAMES.TRAVEL_USERS);
  var rolesSheet = ss.getSheetByName(SHEET_NAMES.TRAVEL_USER_ROLES);

  if (!usersSheet || !rolesSheet) {
    problems.push('The unified user schema is not present in "' + ss.getName() + '".');
    if (!usersSheet) problems.push('  missing tab: ' + SHEET_NAMES.TRAVEL_USERS);
    if (!rolesSheet) problems.push('  missing tab: ' + SHEET_NAMES.TRAVEL_USER_ROLES);
    problems.push('  Fix: run the addUnifiedUserSchema function in this file,');
    problems.push('       then re-run this one.');
    problems.push(
      '  If this spreadsheet is unexpectedly empty, confirm that');
    problems.push(
      '  TRAVEL_DB_SPREADSHEET_ID points at the LETS database and not at some');
    problems.push('  other sheet. It currently points at: ' + ss.getName());
    return { ok: false, problems: problems };
  }

  // The User_ID column is what bootstrapTravelAdmin keys on, and its absence
  // means the tab predates the unified schema rather than being absent.
  var lastCol = usersSheet.getLastColumn();
  var userHeaders = lastCol > 0
    ? usersSheet.getRange(1, 1, 1, lastCol).getValues()[0]
    : [];
  if (userHeaders.indexOf('User_ID') === -1) {
    problems.push(SHEET_NAMES.TRAVEL_USERS +
      ' exists but has no User_ID column, so it predates the unified schema.');
    problems.push('  headers found: ' + JSON.stringify(userHeaders));
    problems.push('  Fix: run the addUnifiedUserSchema function in this file,');
    problems.push('       then re-run this one.');
    return { ok: false, problems: problems };
  }

  console.log('  pre-flight: database "' + ss.getName() + '" opened; ' +
    SHEET_NAMES.TRAVEL_USERS + ' has ' + userHeaders.length + ' columns');
  return { ok: true, problems: [], spreadsheetName: ss.getName() };
}

/**
 * Generate a deterministic Role_ID from (User_ID, Role_Type, Scope).
 * The triple uniquely identifies a role assignment. Used by the bootstrap
 * helper and by future role-write code so the same role assignment always
 * produces the same Role_ID — re-runs are idempotent without needing to
 * scan for duplicates.
 *
 * @returns {string} 'role_<12 hex chars>'
 */
function _generateBootstrapRoleId(userId, roleType, scope) {
  var key = (userId || '') + '|' + (roleType || '') + '|' + (scope || '');
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    key,
    Utilities.Charset.UTF_8
  );
  var hex = '';
  for (var i = 0; i < 6; i++) {
    var b = bytes[i] & 0xFF;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return 'role_' + hex;
}

/**
 * Create a new sheet or update existing sheet headers
 * @param {Spreadsheet} ss - The spreadsheet
 * @param {string} sheetName - Name of the sheet
 * @param {Array} headers - Array of column headers
 * @returns {Object} Result with action taken
 */
function createOrUpdateSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  let action = 'exists';

  if (!sheet) {
    // Create new sheet
    sheet = ss.insertSheet(sheetName);
    action = 'created';
  }

  // Set headers in row 1
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);

  // Format header row
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f3f4f6');
  headerRange.setWrap(true);

  // Freeze header row
  sheet.setFrozenRows(1);

  // Auto-resize columns for readability
  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }

  return {
    sheetName: sheetName,
    action: action,
    columnCount: headers.length
  };
}

/**
 * Initialize system configuration in PropertiesService
 * Run this once to set default values
 * @returns {Object} Result with configured properties
 */
function initTravelSystemConfig() {
  try {
    const props = PropertiesService.getScriptProperties();
    const configured = [];

    // Set each default value (only if not already set)
    Object.entries(TRAVEL_DB_CONFIG.defaults).forEach(([key, value]) => {
      const propKey = key.toLowerCase();
      const existing = props.getProperty(propKey);

      if (existing === null) {
        props.setProperty(propKey, String(value));
        configured.push({ key: propKey, value: value, action: 'set' });
      } else {
        configured.push({ key: propKey, value: existing, action: 'exists' });
      }
    });

    console.log('=== Travel System Config ===');
    configured.forEach(c => {
      console.log(`${c.action}: ${c.key} = ${c.value}`);
    });

    return {
      success: true,
      message: 'System configuration initialized',
      properties: configured
    };

  } catch (error) {
    console.error('Error initializing system config:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================


/**
 * Generate a new Request ID in format REQ-YYYY-NNNN
 * @returns {string} New unique Request ID
 */
function generateRequestId() {
  const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.REQUESTS);

  const year = new Date().getFullYear();
  const prefix = `REQ-${year}-`;

  // Get highest existing ID for this year
  let maxNum = 0;
  if (sheet && sheet.getLastRow() > 1) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    data.forEach(row => {
      const id = row[0];
      if (id && id.startsWith(prefix)) {
        const num = parseInt(id.substring(prefix.length));
        if (num > maxNum) maxNum = num;
      }
    });
  }

  // Generate next ID with 4-digit padding
  const nextNum = String(maxNum + 1).padStart(4, '0');
  return `${prefix}${nextNum}`;
}

/**
 * Generate next Log ID in format LOG-NNNNNN
 * @returns {string} New unique Log ID
 */
function generateLogId() {
  const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.APPROVAL_LOG);

  let maxNum = 0;
  if (sheet && sheet.getLastRow() > 1) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    data.forEach(row => {
      const id = row[0];
      if (id && id.startsWith('LOG-')) {
        const num = parseInt(id.substring(4));
        if (num > maxNum) maxNum = num;
      }
    });
  }

  // Generate next ID with 6-digit padding
  const nextNum = String(maxNum + 1).padStart(6, '0');
  return `LOG-${nextNum}`;
}

/**
 * Validate that all required sheets exist
 * @returns {Object} Result with missing sheets if any
 */
function validateTravelDatabaseSchema() {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);

    const missing = [];
    const valid = [];

    Object.values(SHEET_NAMES).forEach(sheetName => {
      const sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        valid.push(sheetName);
      } else {
        missing.push(sheetName);
      }
    });

    return {
      success: missing.length === 0,
      valid: valid,
      missing: missing,
      message: missing.length === 0
        ? 'All required sheets exist'
        : `Missing sheets: ${missing.join(', ')}`
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// TEST DATA SEEDING
// ============================================================================

/**
 * One-shot migration to add the Suppress_Emails column to the live
 * Test_Submitters sheet without rerunning the full schema setup. Safe
 * to call repeatedly — no-op once the column is present.
 *
 * Run once from the Apps Script editor after deploy.
 */
function addSuppressEmailsColumn() {
  const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAMES.TEST_SUBMITTERS);
  if (!sheet) {
    console.log('addSuppressEmailsColumn: Test_Submitters sheet does not exist — nothing to do');
    return { success: true, skipped: 'sheet-missing' };
  }
  const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1);
  const headers = headerRange.getValues()[0];
  if (headers.indexOf('Suppress_Emails') !== -1) {
    console.log('addSuppressEmailsColumn: column already present');
    return { success: true, skipped: 'already-exists' };
  }
  const newCol = headers.length + 1;
  sheet.getRange(1, newCol).setValue('Suppress_Emails')
    .setFontWeight('bold')
    .setBackground('#4285f4')
    .setFontColor('#ffffff');
  try { new TravelDB().invalidate(SHEET_NAMES.TEST_SUBMITTERS); } catch (e) {}
  console.log('addSuppressEmailsColumn: added column at index ' + newCol);
  return { success: true, column: newCol };
}

/**
 * Get submitter info for the form
 * First checks staffing data, then falls back to Test_Submitters table
 *
 * @param {string} email - Submitter's email address
 * @returns {Object} Submitter info { name, email, buCode, buName, orgCode }
 */
function getSubmitterInfo(email) {
  if (!email) {
    email = Session.getActiveUser().getEmail();
  }

  // First try HC Data Center bundle (reads from owner-populated Script Cache — no sheet access needed)
  try {
    const bundle = HC.hcGetBundle();
    if (bundle && bundle.success && bundle.data) {
      const emailLower = email.toLowerCase();
      const position = bundle.data.find(pos =>
        pos.emailAddress && pos.emailAddress.toLowerCase() === emailLower
      );

      if (position) {
        const org = position.org || {};
        return {
          success: true,
          source: 'hc_bundle',
          name: position.employeeName || '',
          email: position.emailAddress,
          buCode: (position.orgCode || '').substring(0, 3),
          buName: org.businessUnit || '',
          orgCode: position.orgCode || ''
        };
      }
    }
  } catch (e) {
    // Silently fall back to Test_Submitters
  }

  // Fall back to Test_Submitters table — routed through TravelDB so the
  // sheet read is cached. Without this, every form-load for users not in
  // the HC staffing list (admins, testers) pays a full ~1100ms cold
  // SpreadsheetApp.openById hit.
  try {
    const tdb = new TravelDB();
    const sheetData = tdb.readSheet(SHEET_NAMES.TEST_SUBMITTERS);
    const rows = sheetData.rows || [];
    const idx = sheetData.headerIndex || {};
    if (rows.length > 0 && idx['Email'] !== undefined) {
      // Per-row debug log removed — produced 4-row noise on every form load.
      const emailLower = String(email || '').toLowerCase();
      for (const row of rows) {
        const rawActive = row[idx['Is_Active']];
        const isActive = rawActive === true || String(rawActive).toUpperCase() === 'TRUE';
        const rowEmail = row[idx['Email']] || '';
        if (rowEmail && rowEmail.toLowerCase() === emailLower && isActive) {
          const fullOrgCode = row[idx['Org_Code']] || '';
          return {
            success: true,
            source: 'test_submitters',
            name: row[idx['Name']] || '',
            email: rowEmail,
            buCode: String(fullOrgCode).substring(0, 3),
            buName: row[idx['BU_Name']] || '',
            orgCode: fullOrgCode
          };
        }
      }
      console.log('getSubmitterInfo: No match found in Test_Submitters for:', email);
    }
  } catch (e) {
    console.log('Test_Submitters lookup failed:', e.message);
  }

  // Not found anywhere - return empty with email only
  return {
    success: false,
    source: null,
    name: '',
    email: email,
    buCode: '',
    buName: '',
    orgCode: ''
  };
}

/**
 * Seed test submitter data for people not in staffing (consultants, testers)
 *
 * @param {string} email - Email address
 * @param {string} name - Display name
 * @param {string} buCode - Business unit code (e.g., 'QFA')
 * @param {string} buName - Business unit name (e.g., 'Army')
 * @returns {Object} Result
 */
function _seedTestSubmitter(email, name, buCode, buName) {
  try {
    const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAMES.TEST_SUBMITTERS);

    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAMES.TEST_SUBMITTERS);
      const headers = TRAVEL_SHEET_SCHEMAS.Test_Submitters;
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#4285f4')
        .setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }

    // Check if email already exists and update, or add new row
    const data = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
      : [];

    let rowIndex = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === email.toLowerCase()) {
        rowIndex = i + 2; // +2 for header and 0-index
        break;
      }
    }

    const rowData = [email, name, buCode, buName, true];

    if (rowIndex > 0) {
      // Update existing row
      sheet.getRange(rowIndex, 1, 1, 5).setValues([rowData]);
      console.log(`Updated test submitter: ${email} -> BU: ${buCode} (${buName})`);
    } else {
      // Add new row
      sheet.appendRow(rowData);
      console.log(`Added test submitter: ${email} -> BU: ${buCode} (${buName})`);
    }

    return { success: true, email: email, buCode: buCode };

  } catch (error) {
    console.error('Error seeding test submitter:', error);
    return { success: false, error: error.message };
  }
}


/**
 * Quick setup for testing - runs all setup functions
 * Creates sheets, reference docs, seeds test reviewers, and adds test submitter
 *
 * @param {string} testEmail - Optional email for test reviewers and submitter
 * @param {string} testName - Optional name for test submitter
 * @param {string} testBU - Optional BU code (defaults to 'QFA' = Army)
 */
function _setupTravelDatabaseForTesting(testEmail, testName, testBU) {
  console.log('=== Setting Up Travel Database for Testing ===');

  const email = testEmail || Session.getActiveUser().getEmail();
  const name = testName || 'Test User';
  const buCode = testBU || 'QFA';
  const buName = buCode === 'QFA' ? 'Army' : 'Test BU';

  const results = {
    database: setupTravelDatabase(),
    config: initTravelSystemConfig(),
    reviewers: seedTestReviewers(email),
    submitter: seedTestSubmitter(email, name, buCode, buName, buCode)
  };

  console.log('\n=== Setup Complete ===');
  console.log('Database sheets:', results.database.success ? '✓' : '✗');
  console.log('System config:', results.config.success ? '✓' : '✗');
  console.log('Test reviewers:', results.reviewers.success ? '✓' : '✗');
  console.log('Test submitter:', results.submitter.success ? '✓' : '✗');
  console.log(`\nAll reviewer emails set to: ${results.reviewers.testEmail}`);
  console.log(`Test submitter: ${email} → BU: ${buCode} (${buName})`);

  return results;
}

// ============================================================================
// PRE-MIGRATION HELPERS
// ----------------------------------------------------------------------------
// Editor-run utilities that support the structural refactor migration.
// Will relocate during Chunk 5 of the refactor:
//   - backupTravelDb            → 91_setup/Database.js
//   - _bulkDeleteSmokeRequests  → 91_setup/Database.js
//   - _checkAllTriggersHealth   → 99_triggers/CacheWarming.js (or its own file)
// ============================================================================

/**
 * Duplicate the production spreadsheet via Drive. Run from the GAS editor
 * before any chunk that touches sheet writes (Chunks 8 onward per the refactor
 * plan). Cheap insurance against a write-bug corrupting real rows.
 *
 * Names the copy with an Eastern-time timestamp + optional descriptor so the
 * backup is unambiguously identifiable later in Drive's "Recent" list.
 *
 * @param {string} [suffix] - Optional tag (e.g., 'pre-chunk-10E') appended to the name.
 * @returns {{ success: boolean, name: string, id: string, url: string }}
 *
 * @editor
 */
function backupTravelDb(suffix) {
  var sourceFile = DriveApp.getFileById(TRAVEL_DB_SPREADSHEET_ID);
  var stamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd-HHmm');
  var name = 'TRIP DB backup ' + stamp + (suffix ? '-' + suffix : '');

  var copy = sourceFile.makeCopy(name);

  console.log('backupTravelDb: created "' + name + '"');
  console.log('  Drive ID: ' + copy.getId());
  console.log('  URL:      ' + copy.getUrl());

  return {
    success: true,
    name: name,
    id: copy.getId(),
    url: copy.getUrl()
  };
}

/**
 * Find every Requests row whose Trip_Name starts with '[SMOKE]' and delete it
 * plus its child rows across Approval_Log, Request_Legs, Request_Travelers,
 * Traveler_Leg_Costs. Used to clean up after smoke-testing during the refactor.
 *
 * Defaults to DRY RUN — pass `{ dryRun: false }` to actually delete.
 * Caps deletion at 50 rows by default; pass `{ maxRows: N }` to override
 * (forces investigation if smoke testing has gotten out of hand).
 *
 * Cascade order: child sheets first, then Requests. Within each sheet,
 * row indices are sorted descending so deleteRow doesn't shift subsequent
 * deletions. Invalidates TravelDB cache for every touched sheet at the end.
 *
 * Every actual deletion is logged to Error_Log with function_name
 * '_bulkDeleteSmokeRequests' as an audit trail.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=true]  - When true, lists what would be deleted without deleting.
 * @param {number}  [opts.maxRows=50]   - Refuses to run if more candidates than this exist.
 * @returns {{ found: number, deleted: number, dryRun: boolean, requestIds?: string[],
 *              deletedChildCounts?: Object }}
 *
 * @editor
 */
function _bulkDeleteSmokeRequests(opts) {
  opts = opts || {};
  var dryRun = opts.dryRun !== false;  // default TRUE
  var maxRows = opts.maxRows || 50;

  var ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  var requestsSheet = ss.getSheetByName(SHEET_NAMES.REQUESTS);
  if (!requestsSheet) {
    throw new Error('_bulkDeleteSmokeRequests: Requests sheet not found');
  }

  var data = requestsSheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx = headers.indexOf('Request_ID');
  var nameIdx = headers.indexOf('Trip_Name');
  if (idIdx === -1 || nameIdx === -1) {
    throw new Error('_bulkDeleteSmokeRequests: Request_ID or Trip_Name column missing');
  }

  var smokeRequests = [];
  for (var i = 1; i < data.length; i++) {
    var tripName = String(data[i][nameIdx] || '');
    if (tripName.indexOf('[SMOKE]') === 0) {
      smokeRequests.push({ rowIndex: i + 1, requestId: String(data[i][idIdx]) });
    }
  }

  if (smokeRequests.length === 0) {
    console.log('_bulkDeleteSmokeRequests: nothing to delete');
    return { found: 0, deleted: 0, dryRun: dryRun };
  }

  if (smokeRequests.length > maxRows) {
    throw new Error('_bulkDeleteSmokeRequests: found ' + smokeRequests.length +
      ' [SMOKE] requests, exceeds maxRows cap of ' + maxRows +
      '. Pass {maxRows: N} to override after confirming this is intentional.');
  }

  console.log('_bulkDeleteSmokeRequests: found ' + smokeRequests.length +
    ' [SMOKE] requests' + (dryRun ? ' (DRY RUN — pass {dryRun: false} to delete)' : ''));

  if (dryRun) {
    smokeRequests.forEach(function(r) {
      console.log('  Would delete: ' + r.requestId + ' (row ' + r.rowIndex + ')');
    });
    return { found: smokeRequests.length, deleted: 0, dryRun: true };
  }

  // Cascade: children first
  var smokeIds = smokeRequests.map(function(r) { return r.requestId; });
  var childSheets = ['Approval_Log', 'Request_Legs', 'Request_Travelers', 'Traveler_Leg_Costs'];
  var deletedChildCounts = {};

  childSheets.forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) {
      deletedChildCounts[sheetName] = 0;
      return;
    }
    var childData = sheet.getDataRange().getValues();
    var childHeaders = childData[0];
    var childIdIdx = childHeaders.indexOf('Request_ID');
    if (childIdIdx === -1) {
      console.warn('_bulkDeleteSmokeRequests: ' + sheetName + ' has no Request_ID column — skipping');
      deletedChildCounts[sheetName] = 0;
      return;
    }

    var toDelete = [];
    for (var j = 1; j < childData.length; j++) {
      if (smokeIds.indexOf(String(childData[j][childIdIdx])) !== -1) {
        toDelete.push(j + 1);
      }
    }
    toDelete.sort(function(a, b) { return b - a; });  // descending so deleteRow doesn't shift
    toDelete.forEach(function(rowIdx) { sheet.deleteRow(rowIdx); });
    deletedChildCounts[sheetName] = toDelete.length;
  });

  // Then parent Requests rows (descending)
  var requestRowsToDelete = smokeRequests.map(function(r) { return r.rowIndex; })
    .sort(function(a, b) { return b - a; });
  requestRowsToDelete.forEach(function(rowIdx) { requestsSheet.deleteRow(rowIdx); });

  // Invalidate TravelDB caches for every touched sheet
  try {
    var db = new TravelDB();
    db.invalidate(SHEET_NAMES.REQUESTS);
    childSheets.forEach(function(n) { try { db.invalidate(n); } catch (_) {} });
  } catch (e) {
    console.warn('_bulkDeleteSmokeRequests: cache invalidate failed: ' + e.message);
  }

  // Audit log
  try {
    logError('_bulkDeleteSmokeRequests', 'AUDIT: deleted ' + smokeRequests.length + ' [SMOKE] requests', {
      requestIds: smokeIds,
      deletedChildCounts: deletedChildCounts
    });
  } catch (e) {
    console.warn('_bulkDeleteSmokeRequests: audit log write failed: ' + e.message);
  }

  console.log('_bulkDeleteSmokeRequests: deleted ' + smokeRequests.length + ' requests');
  Object.keys(deletedChildCounts).forEach(function(k) {
    console.log('  + ' + deletedChildCounts[k] + ' rows from ' + k);
  });

  return {
    found: smokeRequests.length,
    deleted: smokeRequests.length,
    deletedChildCounts: deletedChildCounts,
    requestIds: smokeIds,
    dryRun: false
  };
}
