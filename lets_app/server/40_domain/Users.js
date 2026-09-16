/**
 * TravelUserService.js
 *
 * Server CRUD for the unified user/role schema (Travel_Users +
 * Travel_User_Roles). Backs the new admin UI (Phase 5) and replaces
 * the legacy reviewer/admin CRUD in TravelAdminService.js, which gets
 * deleted in Phase 7.
 *
 * All RPCs guarded by requireTravelAdmin(). All writes invalidate the
 * unified-role CacheService key + the TravelDB sheet caches for both
 * tables, so the next read sees fresh data.
 *
 * Return shape: { success: true, ...data } | { success: false, error: '...' }
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const TRAVEL_ROLE_TYPES = [
  'admin',
  'aas_fo_reviewer',
  'fas_fo_reviewer',
  'bu_reviewer',
  'sector_override',
  'approved_user'
];

// Roles that require Scope (BU code or sector code)
const TRAVEL_ROLES_WITH_SCOPE = ['bu_reviewer', 'sector_override'];

// ============================================================================
// READ
// ============================================================================

/**
 * List every active and inactive Travel_Users row, each with their flattened
 * roles array (including inactive roles so the UI can render them dimmed).
 * Sorts users by Name asc.
 *
 * @returns {Object} successResponse({ users, version }) or errorResponse(msg)
 * @client
 */
function listTravelUsers() {
  try {
    requireTravelAdmin();
    const db = new TravelDB();
    const usersData = db.readSheet(SHEET_NAMES.TRAVEL_USERS);
    const rolesData = db.readSheet(SHEET_NAMES.TRAVEL_USER_ROLES);

    // Capture the broadcast version snapshot at read time. Returning it on
    // every list lets the client seed its known-version baseline without a
    // separate round trip — avoids a spurious silent refresh on the next
    // poll after the client's own writes.
    const version = getTravelUsersUpdateTimestamp();

    if (!usersData.headers || usersData.headers.length === 0) {
      return successResponse({ users: [], version: version });
    }

    const userIdx = usersData.headerIndex;
    const userMap = {};
    for (let i = 0; i < usersData.rows.length; i++) {
      const r = usersData.rows[i];
      const uid = String(r[userIdx['User_ID']] || '').trim();
      if (!uid) continue;
      userMap[uid] = {
        userId: uid,
        email: String(r[userIdx['Email']] || '').trim(),
        name: String(r[userIdx['Name']] || '').trim(),
        source: String(r[userIdx['Source']] || '').trim(),
        isActive: r[userIdx['Is_Active']] !== false && String(r[userIdx['Is_Active']]).toLowerCase() !== 'false',
        createdBy: String(r[userIdx['Created_By']] || ''),
        createdAt: _formatDateForJson(r[userIdx['Created_At']]),
        updatedBy: String(r[userIdx['Updated_By']] || ''),
        updatedAt: _formatDateForJson(r[userIdx['Updated_At']]),
        roles: []
      };
    }

    if (rolesData.rows && rolesData.rows.length > 0) {
      const rIdx = rolesData.headerIndex;
      for (let j = 0; j < rolesData.rows.length; j++) {
        const r = rolesData.rows[j];
        const uid = String(r[rIdx['User_ID']] || '').trim();
        if (!uid || !userMap[uid]) continue;
        userMap[uid].roles.push({
          roleId: String(r[rIdx['Role_ID']] || ''),
          roleType: String(r[rIdx['Role_Type']] || ''),
          scope: String(r[rIdx['Scope']] || ''),
          isPrimary: r[rIdx['Is_Primary']] !== false && String(r[rIdx['Is_Primary']]).toLowerCase() !== 'false',
          isActive: r[rIdx['Is_Active']] !== false && String(r[rIdx['Is_Active']]).toLowerCase() !== 'false',
          notes: String(r[rIdx['Notes']] || ''),
          grantedBy: String(r[rIdx['Granted_By']] || ''),
          grantedAt: _formatDateForJson(r[rIdx['Granted_At']]),
          updatedBy: String(r[rIdx['Updated_By']] || ''),
          updatedAt: _formatDateForJson(r[rIdx['Updated_At']])
        });
      }
    }

    const users = Object.keys(userMap).map(k => userMap[k]);
    users.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));

    return successResponse({ users: users, version: version });
  } catch (error) {
    return errorResponse(error.message);
  }
}

/**
 * Detail view for one user + all their roles.
 *
 * @param {string} userId
 * @returns {Object} successResponse({ user, roles }) or errorResponse(msg)
 * @client
 */
function getTravelUserDetail(userId) {
  try {
    requireTravelAdmin();
    if (!userId) throw new Error('userId required');

    const db = new TravelDB();
    const usersData = db.readSheet(SHEET_NAMES.TRAVEL_USERS);
    const userIdx = usersData.headerIndex;

    let user = null;
    for (let i = 0; i < usersData.rows.length; i++) {
      const r = usersData.rows[i];
      if (String(r[userIdx['User_ID']] || '').trim() === userId) {
        user = {
          userId: userId,
          email: String(r[userIdx['Email']] || ''),
          name: String(r[userIdx['Name']] || ''),
          source: String(r[userIdx['Source']] || ''),
          isActive: r[userIdx['Is_Active']] !== false,
          createdBy: String(r[userIdx['Created_By']] || ''),
          createdAt: _formatDateForJson(r[userIdx['Created_At']]),
          updatedBy: String(r[userIdx['Updated_By']] || ''),
          updatedAt: _formatDateForJson(r[userIdx['Updated_At']])
        };
        break;
      }
    }
    if (!user) throw new Error('User not found: ' + userId);

    const rolesData = db.readSheet(SHEET_NAMES.TRAVEL_USER_ROLES);
    const roles = [];
    if (rolesData.rows && rolesData.rows.length > 0) {
      const rIdx = rolesData.headerIndex;
      for (let j = 0; j < rolesData.rows.length; j++) {
        const r = rolesData.rows[j];
        if (String(r[rIdx['User_ID']] || '').trim() !== userId) continue;
        roles.push({
          roleId: String(r[rIdx['Role_ID']] || ''),
          roleType: String(r[rIdx['Role_Type']] || ''),
          scope: String(r[rIdx['Scope']] || ''),
          isPrimary: r[rIdx['Is_Primary']] !== false,
          isActive: r[rIdx['Is_Active']] !== false,
          notes: String(r[rIdx['Notes']] || ''),
          grantedBy: String(r[rIdx['Granted_By']] || ''),
          grantedAt: _formatDateForJson(r[rIdx['Granted_At']]),
          updatedBy: String(r[rIdx['Updated_By']] || ''),
          updatedAt: _formatDateForJson(r[rIdx['Updated_At']])
        });
      }
    }

    return successResponse({ user: user, roles: roles });
  } catch (error) {
    return errorResponse(error.message);
  }
}

// ============================================================================
// WRITE — USERS
// ============================================================================

/**
 * Add a new user to Travel_Users. User_ID is auto-resolved by looking up the
 * email in HC; for non-HC people, the caller must supply userIdOverride.
 *
 * Optionally accepts an initialRole — { roleType, scope?, isPrimary?, notes? }
 * — to grant a role atomically in the same call. The user-row write and the
 * role-row write share one _invalidateUserCaches() at the end, and either
 * both succeed or neither did (validation throws before any write). Brief
 * item #11: every new user must be created with a role to avoid the broken
 * 'no roles assigned' state.
 *
 * @param {Object} input - { email, name, userIdOverride?, initialRole? }
 * @returns {Object} successResponse({ user, reassignedCount, reassignedRequestIds }) or errorResponse(msg)
 * @client
 */
function addTravelUser(input) {
  try {
    const adminCtx = requireTravelAdmin();
    const adminEmail = (adminCtx && adminCtx.email) || Session.getActiveUser().getEmail();
    let reassignSummary = { reassignedCount: 0, requestIds: [] };
    const email = String((input && input.email) || '').trim();
    const name = String((input && input.name) || '').trim();
    const override = String((input && input.userIdOverride) || '').trim();

    if (!email) throw new Error('email required');
    if (!_isValidEmail(email)) throw new Error('Invalid email format: ' + email);
    if (!name) throw new Error('name required');

    const emailLower = email.toLowerCase();
    const hc = _lookupHCByEmail(emailLower);

    let userId, source;
    if (hc) {
      userId = hc.employeeId;
      source = 'HC';
    } else {
      if (!override) {
        throw new Error('No HC record found for ' + email + '. Provide userIdOverride (e.g. "ext_smith") for non-HC users.');
      }
      if (!/^ext_[a-z0-9_-]{2,40}$/i.test(override)) {
        throw new Error('userIdOverride must match pattern ext_<2-40 alphanumeric/_/-> chars: got "' + override + '"');
      }
      userId = override.toLowerCase();
      source = 'External';
    }

    const db = new TravelDB();
    const sheet = db.sheet(SHEET_NAMES.TRAVEL_USERS);
    if (!sheet) throw new Error('Travel_Users sheet not found. Run addUnifiedUserSchema() first.');

    // Defensive: pin the User_ID column to plain-text format BEFORE the
    // append. Even if enforceUserIdTextFormat() was never run on this
    // database, HC employee_ids with leading zeros stay intact.
    try { _enforceUserIdTextFormat(db.ss); } catch (fe) { /* non-fatal */ }

    const usersData = db.readSheet(SHEET_NAMES.TRAVEL_USERS);
    const uIdx = usersData.headerIndex;
    for (let i = 0; i < usersData.rows.length; i++) {
      const existingId = String(usersData.rows[i][uIdx['User_ID']] || '').trim();
      const existingEmail = String(usersData.rows[i][uIdx['Email']] || '').trim().toLowerCase();
      if (existingId === userId) {
        throw new Error('User_ID ' + userId + ' already exists. Use updateTravelUser to modify.');
      }
      if (existingEmail && existingEmail === emailLower) {
        throw new Error('A user with email ' + email + ' already exists (User_ID=' + existingId + ').');
      }
    }

    const now = new Date();
    const headers = usersData.headers;
    const record = {
      User_ID: userId,
      Email: email,
      Name: name,
      Source: source,
      Is_Active: true,
      Created_By: adminEmail,
      Created_At: now,
      Updated_By: adminEmail,
      Updated_At: now
    };
    const row = headers.map(h => record[h]);

    // Targeted text-format on the new row's User_ID cell + flush + setValues
    // is the bulletproof path. db.appendRow + column-level setNumberFormat is
    // batched and Sheets can race the format change, coercing leading-zero
    // employee_ids to numbers. This guarantees the format is committed
    // before the value is written. Manual db.invalidate after to keep the
    // cache consistent (db.appendRow would handle this but we can't use it).
    const newRowNum = sheet.getLastRow() + 1;
    sheet.getRange(newRowNum, 1).setNumberFormat('@');
    SpreadsheetApp.flush();
    sheet.getRange(newRowNum, 1, 1, headers.length).setValues([row]);
    db.invalidate(SHEET_NAMES.TRAVEL_USERS);

    // ---- Optional initial role assignment (atomic with the user write) ----
    let createdRole = null;
    if (input && input.initialRole && input.initialRole.roleType) {
      const ir = input.initialRole;
      const roleType = String(ir.roleType).trim();
      if (TRAVEL_ROLE_TYPES.indexOf(roleType) === -1) {
        // The user row was already written; we can't roll back cheaply.
        // Surface the validation error and let the admin re-add the role
        // from the slidein. _invalidateUserCaches still fires at the end.
        console.warn('addTravelUser: invalid initialRole.roleType ' + roleType + ' — skipped');
      } else {
        // Scope holds a BU or sector NAME — preserve original casing.
        const irScope = String(ir.scope || '').trim();
        const requiresScope = TRAVEL_ROLES_WITH_SCOPE.indexOf(roleType) !== -1;
        if (requiresScope && !irScope) {
          console.warn('addTravelUser: initialRole skipped — scope required for ' + roleType);
        } else if (!requiresScope && irScope) {
          console.warn('addTravelUser: initialRole skipped — scope must be empty for ' + roleType);
        } else {
          const irExplicitPrimary = (ir.isPrimary === true || ir.isPrimary === false);
          const irNotes = String(ir.notes || '').trim();
          const rolesSheet = db.sheet(SHEET_NAMES.TRAVEL_USER_ROLES);
          if (rolesSheet) {
            const irPrimary = irExplicitPrimary
              ? ir.isPrimary
              : _smartDefaultPrimary(rolesSheet, roleType, irScope);
            const rolesData = db.readSheet(SHEET_NAMES.TRAVEL_USER_ROLES);
            const rHeaders = rolesData.headers;
            const rIdx = rolesData.headerIndex;
            const roleId = _generateBootstrapRoleId(userId, roleType, irScope);
            // For aas_fo_reviewer + isPrimary=true: demote any existing primary
            const demotedUserIds = [];
            if (roleType === 'aas_fo_reviewer' && irPrimary) {
              for (let j = 0; j < rolesData.rows.length; j++) {
                const existingRow = rolesData.rows[j];
                if (String(existingRow[rIdx['Role_Type']]).trim() !== 'aas_fo_reviewer') continue;
                const stillActive = existingRow[rIdx['Is_Active']] !== false
                  && String(existingRow[rIdx['Is_Active']]).toLowerCase() !== 'false';
                const wasPrimary = existingRow[rIdx['Is_Primary']] === true
                  || String(existingRow[rIdx['Is_Primary']]).toLowerCase() === 'true';
                if (stillActive && wasPrimary) {
                  db.updateRowByIndex(SHEET_NAMES.TRAVEL_USER_ROLES, j + 2, {
                    Is_Primary: false,
                    Updated_By: adminEmail,
                    Updated_At: now
                  });
                  demotedUserIds.push(String(existingRow[rIdx['User_ID']] || '').trim());
                }
              }
            }
            const roleRecord = {
              Role_ID: roleId,
              User_ID: userId,
              Role_Type: roleType,
              Scope: irScope,
              Is_Primary: irPrimary,
              Is_Active: true,
              Notes: irNotes,
              Granted_By: adminEmail,
              Granted_At: now,
              Updated_By: adminEmail,
              Updated_At: now
            };
            const newRoleRow = rHeaders.map(h => roleRecord[h]);
            // Same number-format-then-write pattern as the user-row append:
            // db.appendRow batches and Sheets can race the format change. Pin
            // first 2 columns (Role_ID + User_ID) to text, flush, then write.
            const newRoleRowNum = rolesSheet.getLastRow() + 1;
            rolesSheet.getRange(newRoleRowNum, 1, 1, 2).setNumberFormat('@');
            SpreadsheetApp.flush();
            rolesSheet.getRange(newRoleRowNum, 1, 1, rHeaders.length).setValues([newRoleRow]);
            db.invalidate(SHEET_NAMES.TRAVEL_USER_ROLES);
            createdRole = {
              roleId: roleId,
              roleType: roleType,
              scope: irScope,
              isPrimary: irPrimary,
              isActive: true,
              notes: irNotes
            };

            // Pending-request reassignment — same hooks as addRoleToUser.
            // Demote case (aas_fo_reviewer demoted): transfer pending from
            // demoted to new. Vacant-fill: smart-default fired (no prior
            // active primary) — pending with no current reviewer get
            // assigned to new.
            const PROMOTABLE = ['aas_fo_reviewer', 'fas_fo_reviewer', 'bu_reviewer'];
            if (irPrimary && PROMOTABLE.indexOf(roleType) !== -1) {
              try {
                const adminName = (adminCtx && adminCtx.name) || '';
                const lookupIds = [userId].concat(demotedUserIds).filter(Boolean);
                const userInfo = _lookupTravelUserEmails(db.ss, lookupIds);
                const newRec = userInfo[userId] || { email: email, name: name };
                if (demotedUserIds.length && newRec.email) {
                  const oldUid = demotedUserIds[0];
                  const oldRec = userInfo[oldUid] || {};
                  if (oldRec.email) {
                    reassignSummary = _reassignPendingForRoleChange({
                      roleType: roleType, scope: irScope,
                      oldEmail: oldRec.email, newEmail: newRec.email, newName: newRec.name || '',
                      adminEmail: adminEmail, adminName: adminName,
                      reason: 'new primary added; previous primary demoted'
                    });
                  }
                } else if (!irExplicitPrimary && newRec.email) {
                  reassignSummary = _reassignPendingForRoleChange({
                    roleType: roleType, scope: irScope,
                    oldEmail: '', newEmail: newRec.email, newName: newRec.name || '',
                    adminEmail: adminEmail, adminName: adminName,
                    reason: 'primary seat filled (was vacant)'
                  });
                }
              } catch (re) {
                console.error('addTravelUser: bulk reassign failed (non-blocking): ' + re.message);
                logError('addTravelUser.bulkReassign', re, { userId: userId, roleType: roleType, scope: irScope });
              }
            }
          }
        }
      }
    }

    _invalidateUserCaches();

    return successResponse({
      user: {
        userId: userId,
        email: email,
        name: name,
        source: source,
        isActive: true,
        roles: createdRole ? [createdRole] : []
      },
      reassignedCount: reassignSummary.reassignedCount,
      reassignedRequestIds: reassignSummary.requestIds
    });
  } catch (error) {
    return errorResponse(error.message);
  }
}

/**
 * Update Email / Name / Is_Active for an existing user. User_ID immutable.
 *
 * @param {string} userId
 * @param {Object} fields - { email?, name?, isActive? }
 * @returns {Object} successResponse({ user, reassignedCount, orphanedCount, perRoleReassign }) or errorResponse(msg)
 * @client
 */
function updateTravelUser(userId, fields) {
  try {
    const adminCtx = requireTravelAdmin();
    const adminEmail = (adminCtx && adminCtx.email) || Session.getActiveUser().getEmail();
    const adminName = (adminCtx && adminCtx.name) || '';
    if (!userId) throw new Error('userId required');
    fields = fields || {};

    const db = new TravelDB();
    const sheet = db.sheet(SHEET_NAMES.TRAVEL_USERS);
    if (!sheet) throw new Error('Travel_Users sheet not found.');

    const usersData = db.readSheet(SHEET_NAMES.TRAVEL_USERS);
    const uIdx = usersData.headerIndex;
    if (usersData.rows.length === 0) throw new Error('User not found: ' + userId);

    let foundRow = -1;
    for (let i = 0; i < usersData.rows.length; i++) {
      if (String(usersData.rows[i][uIdx['User_ID']] || '').trim() === userId) { foundRow = i; break; }
    }
    if (foundRow === -1) throw new Error('User not found: ' + userId);

    const row = usersData.rows[foundRow];
    // Capture state BEFORE mutation so we can detect active→inactive transition.
    const wasActive = row[uIdx['Is_Active']] !== false &&
      String(row[uIdx['Is_Active']]).toLowerCase() !== 'false';
    const userEmail = String(row[uIdx['Email']] || '').trim();
    const userName = String(row[uIdx['Name']] || '').trim();

    // Build partial update payload + run validations
    const updates = {};
    let newEmailFinal = userEmail;
    let newNameFinal = userName;
    let newActiveFinal = wasActive;

    if (fields.email !== undefined && fields.email !== null) {
      const newEmail = String(fields.email).trim();
      if (!_isValidEmail(newEmail)) throw new Error('Invalid email format: ' + newEmail);
      const newEmailLower = newEmail.toLowerCase();
      for (let j = 0; j < usersData.rows.length; j++) {
        if (j === foundRow) continue;
        const existingEmail = String(usersData.rows[j][uIdx['Email']] || '').trim().toLowerCase();
        if (existingEmail === newEmailLower) {
          throw new Error('Email ' + newEmail + ' is already used by User_ID=' + usersData.rows[j][uIdx['User_ID']]);
        }
      }
      updates.Email = newEmail;
      newEmailFinal = newEmail;
    }
    if (fields.name !== undefined && fields.name !== null) {
      const newName = String(fields.name).trim();
      if (!newName) throw new Error('name cannot be empty');
      updates.Name = newName;
      newNameFinal = newName;
    }
    let willDeactivate = false;
    if (fields.isActive !== undefined && fields.isActive !== null) {
      const newActive = fields.isActive === true || String(fields.isActive).toLowerCase() === 'true';
      updates.Is_Active = newActive;
      willDeactivate = wasActive && !newActive;
      newActiveFinal = newActive;
    }
    updates.Updated_By = adminEmail;
    updates.Updated_At = new Date();

    db.updateRowByIndex(SHEET_NAMES.TRAVEL_USERS, foundRow + 2, updates);

    _invalidateUserCaches();

    // User-level deactivation: pending requests assigned to this user
    // would otherwise stay stuck on their (now inactive) queue. Walk
    // every active primary role they hold; for each, hand off to the
    // role's backup if one exists, otherwise orphan + log. Same hooks
    // as setRoleActive on a single primary, just iterated.
    let bulkSummary = { totalReassigned: 0, totalOrphaned: 0, perRole: [] };
    if (willDeactivate && userEmail) {
      try {
        bulkSummary = _reassignAllPendingForUserDeactivation(db.ss, {
          userId: userId,
          userEmail: userEmail,
          userName: userName,
          adminEmail: adminEmail,
          adminName: adminName
        });
      } catch (re) {
        console.error('updateTravelUser: bulk reassign on deactivation failed (non-blocking): ' + re.message);
        logError('updateTravelUser.bulkReassign', re, { userId: userId });
      }
    }

    return successResponse({
      user: {
        userId: userId,
        email: newEmailFinal,
        name: newNameFinal,
        isActive: newActiveFinal
      },
      reassignedCount: bulkSummary.totalReassigned,
      orphanedCount: bulkSummary.totalOrphaned,
      perRoleReassign: bulkSummary.perRole
    });
  } catch (error) {
    return errorResponse(error.message);
  }
}

/**
 * Walk every active primary routing role held by `userId` and run the
 * same auto-promote-backup OR orphan dance that setRoleActive does for
 * a single role. Used when the USER (not a single role) is deactivated.
 *
 * Approach: for each active primary role, look in Travel_User_Roles for
 * an active backup in the same (roleType, scope) pair. If one exists,
 * promote it (set Is_Primary=true) and call _reassignPendingForRoleChange.
 * Otherwise orphan via _orphanPendingForRoleChange.
 *
 * Note: this does NOT deactivate the role rows themselves. The user's
 * Is_Active flag handles "this person can no longer take action"; the
 * role rows stay so re-activation restores their place in the table.
 *
 * @private
 * @param {Spreadsheet} ss
 * @param {Object} args  { userId, userEmail, userName, adminEmail, adminName }
 * @returns {Object} { totalReassigned, totalOrphaned, perRole: [{roleType, scope, ...}] }
 * @private
 * @server
 */
function _reassignAllPendingForUserDeactivation(_unusedSs, args) {
  const out = { totalReassigned: 0, totalOrphaned: 0, perRole: [] };
  const PROMOTABLE_PAIR_ROLES = ['aas_fo_reviewer', 'fas_fo_reviewer', 'bu_reviewer'];
  const HANDLED = PROMOTABLE_PAIR_ROLES.concat(['sector_override']);

  const db = new TravelDB();
  const rolesData = db.readSheet(SHEET_NAMES.TRAVEL_USER_ROLES);
  if (!rolesData.rows || rolesData.rows.length === 0) return out;
  const rIdx = rolesData.headerIndex;
  const allRows = rolesData.rows;

  // Find this user's active primary routing roles
  const userPrimaryRoles = [];
  for (let i = 0; i < allRows.length; i++) {
    if (String(allRows[i][rIdx['User_ID']] || '').trim() !== args.userId) continue;
    const isAct = allRows[i][rIdx['Is_Active']] !== false && String(allRows[i][rIdx['Is_Active']]).toLowerCase() !== 'false';
    if (!isAct) continue;
    const isPri = allRows[i][rIdx['Is_Primary']] === true || String(allRows[i][rIdx['Is_Primary']]).toLowerCase() === 'true';
    const rt = String(allRows[i][rIdx['Role_Type']] || '').trim();
    if (HANDLED.indexOf(rt) === -1) continue;
    // sector_override has no primary/backup — its "active assignment" is
    // the override itself, so we always reassign on user deactivation.
    if (rt === 'sector_override' || isPri) {
      userPrimaryRoles.push({
        rowIndex: i,
        rowNum: i + 2,
        roleId: String(allRows[i][rIdx['Role_ID']] || '').trim(),
        roleType: rt,
        scope: String(allRows[i][rIdx['Scope']] || '').trim(),
        isPrimary: isPri
      });
    }
  }
  if (!userPrimaryRoles.length) return out;

  const now = new Date();

  for (let r = 0; r < userPrimaryRoles.length; r++) {
    const role = userPrimaryRoles[r];
    let promotedUserId = '';

    // Find an active backup partner for routing-pair roles
    if (PROMOTABLE_PAIR_ROLES.indexOf(role.roleType) !== -1) {
      for (let j = 0; j < allRows.length; j++) {
        if (j === role.rowIndex) continue;
        const rt = String(allRows[j][rIdx['Role_Type']] || '').trim();
        const rs = String(allRows[j][rIdx['Scope']] || '').trim();
        if (rt !== role.roleType || rs !== role.scope) continue;
        const isAct = allRows[j][rIdx['Is_Active']] !== false && String(allRows[j][rIdx['Is_Active']]).toLowerCase() !== 'false';
        if (!isAct) continue;
        // Backup user must themselves be active — skip inactive users
        const partnerUserId = String(allRows[j][rIdx['User_ID']] || '').trim();
        if (!partnerUserId) continue;
        promotedUserId = partnerUserId;
        // Promote them: Is_Primary=true; the deactivated user's role
        // row stays untouched (user.Is_Active=false handles routing
        // suppression at the access-control layer).
        db.updateRowByIndex(SHEET_NAMES.TRAVEL_USER_ROLES, j + 2, {
          Is_Primary: true,
          Updated_By: args.adminEmail,
          Updated_At: now
        });
        // Keep allRows in sync so subsequent iterations see the promoted state
        allRows[j][rIdx['Is_Primary']] = true;
        allRows[j][rIdx['Updated_By']] = args.adminEmail;
        allRows[j][rIdx['Updated_At']] = now;
        break;
      }
    }

    let perRoleResult;
    if (promotedUserId) {
      // Resolve promoted user's email + name
      const lookup = _lookupTravelUserEmails(db.ss, [promotedUserId]);
      const promotedRec = lookup[promotedUserId] || {};
      if (promotedRec.email) {
        perRoleResult = _reassignPendingForRoleChange({
          roleType: role.roleType,
          scope: role.scope,
          oldEmail: args.userEmail,
          newEmail: promotedRec.email,
          newName: promotedRec.name || '',
          adminEmail: args.adminEmail,
          adminName: args.adminName,
          reason: 'user deactivated, backup auto-promoted'
        });
        out.totalReassigned += perRoleResult.reassignedCount;
      }
    }

    // sector_override has no primary/backup pairing. When the override
    // holder is deactivated, routing semantics say "override gone, fall
    // back to the synced HC sector director." Cascade to the HC SD if
    // one exists for that sector; only orphan when no HC SD is filled
    // (or when the sector name is ambiguous across BUs).
    if (!perRoleResult && role.roleType === 'sector_override') {
      const hcSD = _findHCSectorDirector(role.scope);
      if (hcSD && hcSD.email) {
        perRoleResult = _reassignPendingForRoleChange({
          roleType: role.roleType,
          scope: role.scope,
          oldEmail: args.userEmail,
          newEmail: hcSD.email,
          newName: hcSD.name || '',
          adminEmail: args.adminEmail,
          adminName: args.adminName,
          reason: 'sector override holder deactivated; cascading to HC sector director'
        });
        out.totalReassigned += perRoleResult.reassignedCount;
      }
    }

    if (!perRoleResult) {
      // No backup, no HC SD fallback, or promoted user lacked an email → orphan
      perRoleResult = _orphanPendingForRoleChange({
        roleType: role.roleType,
        scope: role.scope,
        oldEmail: args.userEmail,
        adminEmail: args.adminEmail,
        adminName: args.adminName
      });
      out.totalOrphaned += perRoleResult.reassignedCount;
    }

    out.perRole.push({
      roleType: role.roleType,
      scope: role.scope,
      promotedUserId: promotedUserId,
      reassignedCount: perRoleResult.reassignedCount,
      requestIds: perRoleResult.requestIds
    });
  }

  _invalidateUserCaches();
  return out;
}

// ============================================================================
// WRITE — ROLES
// ============================================================================

/**
 * Grant a role to a user. Validates role_type enum and scope rules.
 *
 * For aas_fo_reviewer with isPrimary=true: any other role row of type
 * aas_fo_reviewer (across all users) gets Is_Primary auto-flipped to false
 * in the same call so there is exactly one primary at a time.
 *
 * @param {string} userId
 * @param {Object} input - { roleType, scope?, isPrimary?, notes? }
 * @returns {Object} successResponse({ role, reassignedCount, reassignedRequestIds }) or errorResponse(msg)
 * @client
 */
function addRoleToUser(userId, input) {
  try {
    const adminCtx = requireTravelAdmin();
    const adminEmail = (adminCtx && adminCtx.email) || Session.getActiveUser().getEmail();
    const adminName = (adminCtx && adminCtx.name) || '';
    if (!userId) throw new Error('userId required');
    input = input || {};

    const roleType = String(input.roleType || '').trim();
    if (!roleType) throw new Error('roleType required');
    if (TRAVEL_ROLE_TYPES.indexOf(roleType) === -1) {
      throw new Error('Invalid roleType "' + roleType + '". Must be one of: ' + TRAVEL_ROLE_TYPES.join(', '));
    }

    // Scope holds the BU or sector NAME — preserve HC's casing.
    // Names are stored as-is so they match downstream lookups against
    // orgToBU / orgToSector which return names in their original casing.
    const scope = String(input.scope || '').trim();
    if (TRAVEL_ROLES_WITH_SCOPE.indexOf(roleType) !== -1) {
      if (!scope) throw new Error('scope required for role_type=' + roleType);
    } else if (scope) {
      throw new Error('scope must be empty for role_type=' + roleType);
    }

    // Smart default: if caller didn't pass an explicit isPrimary, decide
    // based on whether an active primary already exists for this scope.
    // First role = primary, subsequent = backup. Admin swaps via star icon.
    const explicitPrimary = (input.isPrimary === true || input.isPrimary === false);
    const notes = String(input.notes || '').trim();

    // Verify user exists
    const db = new TravelDB();
    const usersSheet = db.sheet(SHEET_NAMES.TRAVEL_USERS);
    if (!usersSheet) throw new Error('Travel_Users sheet not found.');

    // Defensive text-format on ID columns BEFORE existence check or write —
    // protects against HC employee_id leading-zero coercion that would
    // make _userExists return false on what's really a real user.
    try { _enforceUserIdTextFormat(db.ss); } catch (fe) { /* non-fatal */ }

    if (!_userExists(usersSheet, userId)) throw new Error('User not found: ' + userId);

    const rolesSheet = db.sheet(SHEET_NAMES.TRAVEL_USER_ROLES);
    if (!rolesSheet) throw new Error('Travel_User_Roles sheet not found.');

    // Resolve isPrimary now that we have the rolesSheet handle
    const isPrimary = explicitPrimary
      ? input.isPrimary
      : _smartDefaultPrimary(rolesSheet, roleType, scope);

    const rolesData = db.readSheet(SHEET_NAMES.TRAVEL_USER_ROLES);
    const rHeaders = rolesData.headers;
    const rIdx = rolesData.headerIndex;

    const roleId = _generateBootstrapRoleId(userId, roleType, scope);

    // Check for existing assignment (Role_ID collision = same triple)
    for (let i = 0; i < rolesData.rows.length; i++) {
      if (String(rolesData.rows[i][rIdx['Role_ID']] || '').trim() === roleId) {
        throw new Error('Role assignment already exists (' + roleType + (scope ? '/' + scope : '') + '). Use setRoleActive to reactivate, or remove first.');
      }
    }

    const now = new Date();

    // For aas_fo_reviewer + isPrimary=true: demote any existing primary
    const demotedUserIds = [];
    if (roleType === 'aas_fo_reviewer' && isPrimary) {
      for (let j = 0; j < rolesData.rows.length; j++) {
        const r = rolesData.rows[j];
        if (String(r[rIdx['Role_Type']]).trim() !== 'aas_fo_reviewer') continue;
        const wasPrimary = r[rIdx['Is_Primary']];
        const wasActive = r[rIdx['Is_Active']];
        const stillActive = wasActive !== false && String(wasActive).toLowerCase() !== 'false';
        if (stillActive && (wasPrimary === true || String(wasPrimary).toLowerCase() === 'true')) {
          db.updateRowByIndex(SHEET_NAMES.TRAVEL_USER_ROLES, j + 2, {
            Is_Primary: false,
            Updated_By: adminEmail,
            Updated_At: now
          });
          demotedUserIds.push(String(r[rIdx['User_ID']] || '').trim());
        }
      }
    }

    const record = {
      Role_ID: roleId,
      User_ID: userId,
      Role_Type: roleType,
      Scope: scope,
      Is_Primary: isPrimary,
      Is_Active: true,
      Notes: notes,
      Granted_By: adminEmail,
      Granted_At: now,
      Updated_By: adminEmail,
      Updated_At: now
    };
    const newRow = rHeaders.map(h => record[h]);

    // Same bulletproof write pattern as addTravelUser — pin Role_ID + User_ID
    // cells to text format, flush, then setValues. db.appendRow can't be used
    // because it batches and Sheets races the format change for leading-zero
    // employee IDs in User_ID. Explicit db.invalidate after.
    const newRoleRowNum = rolesSheet.getLastRow() + 1;
    rolesSheet.getRange(newRoleRowNum, 1, 1, 2).setNumberFormat('@');
    SpreadsheetApp.flush();
    rolesSheet.getRange(newRoleRowNum, 1, 1, rHeaders.length).setValues([newRow]);
    db.invalidate(SHEET_NAMES.TRAVEL_USER_ROLES);

    _invalidateUserCaches();

    // Pending-request reassignment when this role is a routing primary.
    //   - Demote case (aas_fo_reviewer with isPrimary=true that demoted
    //     an existing primary): pending requests transfer from the
    //     demoted user to the new primary.
    //   - Vacant-fill case (smart-default fired because no active
    //     primary existed for this scope): pending requests at that
    //     stage with no Current_Reviewer_Email get assigned to new.
    //
    //   - Skipped: explicit isPrimary=true added when an active primary
    //     ALREADY exists and we didn't demote it. That's a data
    //     inconsistency (two active primaries for the same scope) we
    //     shouldn't paper over with a silent reassign.
    let reassign = { reassignedCount: 0, requestIds: [] };
    const PROMOTABLE_PAIR_ROLES = ['aas_fo_reviewer', 'fas_fo_reviewer', 'bu_reviewer'];
    if (isPrimary && PROMOTABLE_PAIR_ROLES.indexOf(roleType) !== -1) {
      try {
        const lookupIds = [userId].concat(demotedUserIds).filter(Boolean);
        const userInfo = _lookupTravelUserEmails(db.ss, lookupIds);
        const newRec = userInfo[userId] || {};
        if (demotedUserIds.length && newRec.email) {
          // Demote case — first demoted user owns the queue we're moving
          const oldUid = demotedUserIds[0];
          const oldRec = userInfo[oldUid] || {};
          if (oldRec.email) {
            reassign = _reassignPendingForRoleChange({
              roleType: roleType,
              scope: scope,
              oldEmail: oldRec.email,
              newEmail: newRec.email,
              newName: newRec.name || '',
              adminEmail: adminEmail,
              adminName: adminName,
              reason: 'new primary added; previous primary demoted'
            });
          }
        } else if (!explicitPrimary && newRec.email) {
          // Smart-default fired → no prior active primary existed → vacant-fill
          reassign = _reassignPendingForRoleChange({
            roleType: roleType,
            scope: scope,
            oldEmail: '',
            newEmail: newRec.email,
            newName: newRec.name || '',
            adminEmail: adminEmail,
            adminName: adminName,
            reason: 'primary seat filled (was vacant)'
          });
        }
      } catch (re) {
        console.error('addRoleToUser: bulk reassign failed (non-blocking): ' + re.message);
        logError('addRoleToUser.bulkReassign', re, { userId: userId, roleType: roleType, scope: scope });
      }
    }

    return successResponse({
      role: {
        roleId: roleId, roleType: roleType, scope: scope,
        isPrimary: isPrimary, isActive: true, notes: notes
      },
      reassignedCount: reassign.reassignedCount,
      reassignedRequestIds: reassign.requestIds
    });
  } catch (error) {
    return errorResponse(error.message);
  }
}

/**
 * Toggle Is_Active on a role row. Soft-deactivate; preserves history.
 *
 * @param {string} roleId
 * @param {boolean} isActive
 * @returns {Object} successResponse({ role, promoted, reassignedCount, reassignedRequestIds }) or errorResponse(msg)
 * @client
 */
function setRoleActive(roleId, isActive) {
  try {
    const adminCtx = requireTravelAdmin();
    const adminEmail = (adminCtx && adminCtx.email) || Session.getActiveUser().getEmail();
    const adminName = (adminCtx && adminCtx.name) || '';
    if (!roleId) throw new Error('roleId required');

    const db = new TravelDB();
    const rolesData = db.readSheet(SHEET_NAMES.TRAVEL_USER_ROLES);
    const rIdx = rolesData.headerIndex;
    if (rolesData.rows.length === 0) throw new Error('Role not found: ' + roleId);

    let foundRow = -1;
    for (let i = 0; i < rolesData.rows.length; i++) {
      if (String(rolesData.rows[i][rIdx['Role_ID']] || '').trim() === roleId) { foundRow = i; break; }
    }
    if (foundRow === -1) throw new Error('Role not found: ' + roleId);

    const row = rolesData.rows[foundRow];
    const newActive = isActive === true || String(isActive).toLowerCase() === 'true';
    const now = new Date();

    // Capture role state before mutation (so the auto-promote logic can
    // tell whether we're deactivating an active primary in a routing pair).
    const wasPrimary = row[rIdx['Is_Primary']] === true ||
      String(row[rIdx['Is_Primary']]).toLowerCase() === 'true';
    const targetType = String(row[rIdx['Role_Type']] || '').trim();
    const targetScope = String(row[rIdx['Scope']] || '').trim();

    // PROMOTABLE_PAIR_ROLES — these have primary/backup semantics. When
    // the primary is deactivated, the backup auto-promotes to primary so
    // routing has someone to route to. Without this, the system would
    // be left with an inactive primary and a non-primary backup —
    // 'no active primary' means no routing target.
    const PROMOTABLE_PAIR_ROLES = ['aas_fo_reviewer', 'fas_fo_reviewer', 'bu_reviewer'];

    let promoted = null;

    // Apply the deactivation/activation
    db.updateRowByIndex(SHEET_NAMES.TRAVEL_USER_ROLES, foundRow + 2, {
      Is_Active: newActive,
      Updated_By: adminEmail,
      Updated_At: now
    });

    // Auto-promote: when deactivating an active primary in a routing
    // pair, find the active backup and promote it. Demote the
    // deactivated role's Is_Primary to false (cosmetic but keeps the
    // 'one active primary at a time' invariant clean).
    if (!newActive && wasPrimary && PROMOTABLE_PAIR_ROLES.indexOf(targetType) !== -1) {
      let backupRow = -1;
      for (let j = 0; j < rolesData.rows.length; j++) {
        if (j === foundRow) continue;
        const rt = String(rolesData.rows[j][rIdx['Role_Type']] || '').trim();
        const rs = String(rolesData.rows[j][rIdx['Scope']] || '').trim();
        if (rt !== targetType || rs !== targetScope) continue;
        const isAct = rolesData.rows[j][rIdx['Is_Active']] !== false &&
          String(rolesData.rows[j][rIdx['Is_Active']]).toLowerCase() !== 'false';
        if (!isAct) continue;
        // Found an active partner — first one wins (typically there's
        // only one backup per pair anyway)
        backupRow = j;
        break;
      }
      if (backupRow !== -1) {
        // Promote backup to primary
        db.updateRowByIndex(SHEET_NAMES.TRAVEL_USER_ROLES, backupRow + 2, {
          Is_Primary: true,
          Updated_By: adminEmail,
          Updated_At: now
        });
        // Demote the deactivated role for clean invariants
        db.updateRowByIndex(SHEET_NAMES.TRAVEL_USER_ROLES, foundRow + 2, { Is_Primary: false });
        promoted = {
          roleId: String(rolesData.rows[backupRow][rIdx['Role_ID']] || '').trim(),
          userId: String(rolesData.rows[backupRow][rIdx['User_ID']] || '').trim(),
          isPrimary: true
        };
      }
    }

    _invalidateUserCaches();

    // Pending-request reassignment when a primary just got deactivated.
    //   - Backup auto-promoted: pending requests transfer from the
    //     deactivated primary to the new primary.
    //   - No backup found: primary is gone with no replacement. We
    //     still clear Current_Reviewer_Email so the orphaned requests
    //     surface in the routing dashboard's gap states; the next time
    //     someone gets added as primary (addRoleToUser hook), the
    //     vacant-fill path picks them up.
    let reassign = { reassignedCount: 0, requestIds: [] };
    if (!newActive && wasPrimary && PROMOTABLE_PAIR_ROLES.indexOf(targetType) !== -1) {
      try {
        const oldPrimaryUserId = String(row[rIdx['User_ID']] || '').trim();
        const idsToLookup = [oldPrimaryUserId];
        if (promoted) idsToLookup.push(promoted.userId);
        const userInfo = _lookupTravelUserEmails(db.ss, idsToLookup);
        const oldRec = userInfo[oldPrimaryUserId] || {};
        const newRec = promoted ? (userInfo[promoted.userId] || {}) : {};
        if (promoted && newRec.email) {
          reassign = _reassignPendingForRoleChange({
            roleType: targetType,
            scope: targetScope,
            oldEmail: oldRec.email || '',
            newEmail: newRec.email,
            newName: newRec.name || '',
            adminEmail: adminEmail,
            adminName: adminName,
            reason: 'primary deactivated, backup auto-promoted'
          });
        } else if (oldRec.email) {
          // No backup to absorb the queue. Orphan the pending requests
          // by clearing their reviewer so the routing dashboard can show
          // the gap and the next addRoleToUser fill picks them up.
          reassign = _orphanPendingForRoleChange({
            roleType: targetType,
            scope: targetScope,
            oldEmail: oldRec.email,
            adminEmail: adminEmail,
            adminName: adminName
          });
        }
      } catch (re) {
        console.error('setRoleActive: bulk reassign failed (non-blocking): ' + re.message);
        logError('setRoleActive.bulkReassign', re, { roleId: roleId });
      }
    }

    return successResponse({
      role: { roleId: roleId, isActive: newActive, isPrimary: promoted ? false : wasPrimary },
      promoted: promoted,
      reassignedCount: reassign.reassignedCount,
      reassignedRequestIds: reassign.requestIds
    });
  } catch (error) {
    return errorResponse(error.message);
  }
}

/**
 * Atomic primary swap. For delegation: among all roles of (roleType, scope),
 * sets exactly the row matching userId to Is_Primary=true and every other
 * matching row to Is_Primary=false. Both rows must already be active.
 *
 * @param {string} userId
 * @param {string} roleType - typically 'aas_fo_reviewer'
 * @param {string} [scope] - default ''
 * @returns {Object} successResponse({ primaryUserId, demoted, reassignedCount, reassignedRequestIds }) or errorResponse(msg)
 * @client
 */
function setRolePrimary(userId, roleType, scope) {
  try {
    const adminCtx = requireTravelAdmin();
    const adminEmail = (adminCtx && adminCtx.email) || Session.getActiveUser().getEmail();
    const adminName = (adminCtx && adminCtx.name) || '';
    if (!userId) throw new Error('userId required');
    if (!roleType) throw new Error('roleType required');
    // Preserve scope casing — names are stored as HC delivers them
    const scopeKey = String(scope || '').trim();

    const db = new TravelDB();
    const rolesData = db.readSheet(SHEET_NAMES.TRAVEL_USER_ROLES);
    const rIdx = rolesData.headerIndex;
    if (rolesData.rows.length === 0) throw new Error('No roles found.');

    let targetRow = -1;
    const otherRows = [];
    let oldPrimaryUserId = '';
    for (let i = 0; i < rolesData.rows.length; i++) {
      const r = rolesData.rows[i];
      const rType = String(r[rIdx['Role_Type']] || '').trim();
      const rScope = String(r[rIdx['Scope']] || '').trim();
      const isActive = r[rIdx['Is_Active']] !== false && String(r[rIdx['Is_Active']]).toLowerCase() !== 'false';
      if (rType !== roleType || rScope !== scopeKey || !isActive) continue;
      const wasPrimary = r[rIdx['Is_Primary']] === true || String(r[rIdx['Is_Primary']]).toLowerCase() === 'true';
      if (String(r[rIdx['User_ID']] || '').trim() === userId) {
        targetRow = i;
      } else {
        otherRows.push(i);
        if (wasPrimary && !oldPrimaryUserId) {
          oldPrimaryUserId = String(r[rIdx['User_ID']] || '').trim();
        }
      }
    }
    if (targetRow === -1) {
      throw new Error('No active role of type ' + roleType + (scopeKey ? '/' + scopeKey : '') + ' for user ' + userId);
    }

    const now = new Date();
    db.updateRowByIndex(SHEET_NAMES.TRAVEL_USER_ROLES, targetRow + 2, {
      Is_Primary: true,
      Updated_By: adminEmail,
      Updated_At: now
    });

    for (let o = 0; o < otherRows.length; o++) {
      db.updateRowByIndex(SHEET_NAMES.TRAVEL_USER_ROLES, otherRows[o] + 2, {
        Is_Primary: false,
        Updated_By: adminEmail,
        Updated_At: now
      });
    }

    _invalidateUserCaches();

    // Pending-request reassignment. Without this, every PENDING request
    // currently assigned to the demoted primary stays stuck on their
    // queue, the new primary's queue is empty, and there's no audit
    // trail of the routing change. Resolve user IDs to emails via
    // Travel_Users so the helper can match Current_Reviewer_Email rows.
    let reassign = { reassignedCount: 0, requestIds: [] };
    try {
      const userInfo = _lookupTravelUserEmails(db.ss, [oldPrimaryUserId, userId].filter(Boolean));
      const oldEmail = userInfo[oldPrimaryUserId] ? userInfo[oldPrimaryUserId].email : '';
      const newRec = userInfo[userId] || {};
      reassign = _reassignPendingForRoleChange({
        roleType: roleType,
        scope: scopeKey,
        oldEmail: oldEmail,
        newEmail: newRec.email || '',
        newName: newRec.name || '',
        adminEmail: adminEmail,
        adminName: adminName,
        reason: 'promoted to primary'
      });
    } catch (re) {
      console.error('setRolePrimary: bulk reassign failed (non-blocking): ' + re.message);
      logError('setRolePrimary.bulkReassign', re, { userId: userId, roleType: roleType, scope: scopeKey });
    }

    return successResponse({
      primaryUserId: userId,
      demoted: otherRows.length,
      reassignedCount: reassign.reassignedCount,
      reassignedRequestIds: reassign.requestIds
    });
  } catch (error) {
    return errorResponse(error.message);
  }
}

/**
 * Resolve a list of User_IDs to their email + name from Travel_Users.
 * Returns map keyed by userId. Missing IDs map to undefined.
 *
 * @private
 * @server
 * @param {Spreadsheet} _unusedSs - Legacy ss param, ignored (kept for caller compatibility)
 * @param {string[]} userIds
 * @returns {Object<string, {email, name}>}
 */
function _lookupTravelUserEmails(_unusedSs, userIds) {
  if (!userIds || !userIds.length) return {};
  var out = {};
  var db = new TravelDB();
  var data = db.readSheet(SHEET_NAMES.TRAVEL_USERS);
  if (!data.rows || data.rows.length === 0) return out;
  var idx = data.headerIndex;
  if (idx['User_ID'] === undefined) return out;
  var wanted = {};
  for (var w = 0; w < userIds.length; w++) wanted[String(userIds[w]).trim()] = true;
  for (var r = 0; r < data.rows.length; r++) {
    var uid = String(data.rows[r][idx['User_ID']] || '').trim();
    if (!wanted[uid]) continue;
    out[uid] = {
      email: idx['Email'] !== undefined ? String(data.rows[r][idx['Email']] || '').trim() : '',
      name: idx['Name'] !== undefined ? String(data.rows[r][idx['Name']] || '').trim() : ''
    };
  }
  return out;
}

/**
 * Hard-delete a role row. Used to remove a role assignment outright.
 * Soft-deactivate via setRoleActive(roleId, false) is preferred for normal
 * delegation/handoff; this is for cleanup and mistakes.
 *
 * @param {string} roleId
 * @returns {Object} successResponse({ promoted }) or errorResponse(msg)
 * @client
 */
function deleteRole(roleId) {
  try {
    requireTravelAdmin();
    if (!roleId) throw new Error('roleId required');

    const db = new TravelDB();
    const rolesData = db.readSheet(SHEET_NAMES.TRAVEL_USER_ROLES);
    const rIdx = rolesData.headerIndex;
    if (rolesData.rows.length === 0) throw new Error('Role not found: ' + roleId);

    let foundRow = -1;
    for (let i = 0; i < rolesData.rows.length; i++) {
      if (String(rolesData.rows[i][rIdx['Role_ID']] || '').trim() === roleId) { foundRow = i; break; }
    }
    if (foundRow === -1) throw new Error('Role not found: ' + roleId);

    const row = rolesData.rows[foundRow];
    // Same auto-promote behavior as setRoleActive: deleting an active
    // primary in a routing pair promotes the active backup. Routing
    // stays whole.
    const wasPrimary = row[rIdx['Is_Primary']] === true ||
      String(row[rIdx['Is_Primary']]).toLowerCase() === 'true';
    const wasActive = row[rIdx['Is_Active']] !== false &&
      String(row[rIdx['Is_Active']]).toLowerCase() !== 'false';
    const targetType = String(row[rIdx['Role_Type']] || '').trim();
    const targetScope = String(row[rIdx['Scope']] || '').trim();
    const PROMOTABLE_PAIR_ROLES = ['aas_fo_reviewer', 'fas_fo_reviewer', 'bu_reviewer'];

    let promoted = null;
    if (wasActive && wasPrimary && PROMOTABLE_PAIR_ROLES.indexOf(targetType) !== -1) {
      const adminEmail = Session.getActiveUser().getEmail();
      const now = new Date();
      for (let j = 0; j < rolesData.rows.length; j++) {
        if (j === foundRow) continue;
        const rt = String(rolesData.rows[j][rIdx['Role_Type']] || '').trim();
        const rs = String(rolesData.rows[j][rIdx['Scope']] || '').trim();
        if (rt !== targetType || rs !== targetScope) continue;
        const isAct = rolesData.rows[j][rIdx['Is_Active']] !== false &&
          String(rolesData.rows[j][rIdx['Is_Active']]).toLowerCase() !== 'false';
        if (!isAct) continue;
        // Apply promotion BEFORE deletion so the j+2 row index is still valid
        // (deletion shifts subsequent rows up by 1).
        db.updateRowByIndex(SHEET_NAMES.TRAVEL_USER_ROLES, j + 2, {
          Is_Primary: true,
          Updated_By: adminEmail,
          Updated_At: now
        });
        promoted = {
          roleId: String(rolesData.rows[j][rIdx['Role_ID']] || '').trim(),
          userId: String(rolesData.rows[j][rIdx['User_ID']] || '').trim(),
          isPrimary: true
        };
        break;
      }
    }

    db.deleteRowByIndex(SHEET_NAMES.TRAVEL_USER_ROLES, foundRow + 2);
    _invalidateUserCaches();

    return successResponse({ promoted: promoted });
  } catch (error) {
    return errorResponse(error.message);
  }
}

// ============================================================================
// SELF-HEAL — keep Travel_Users.Email in sync with HC after email changes
// ============================================================================

/**
 * If the calling user's current email doesn't match a Travel_Users row but
 * their HC employee_id does (under a stale email), patch the email so future
 * lookups by current email succeed. No-op for non-HC users.
 *
 * Called lazily from _getUnifiedRolesForEmail on a miss — bounds the cost so
 * we only hit HC on first miss, not every request. Successful patches
 * invalidate caches so subsequent reads find the user.
 *
 * @param {string} currentEmail - the email Session.getActiveUser() returned
 * @returns {{patched: boolean, userId?: string, oldEmail?: string, newEmail?: string}}
 * @server
 */
function selfHealCurrentUserEmail(currentEmail) {
  try {
    var email = String(currentEmail || '').trim();
    if (!email) return { patched: false };
    var emailLower = email.toLowerCase();

    var hc = _lookupHCByEmail(emailLower);
    if (!hc || !hc.employeeId) return { patched: false };

    var db = new TravelDB();
    var data = db.readSheet(SHEET_NAMES.TRAVEL_USERS);
    if (!data.rows || data.rows.length === 0) return { patched: false };

    var idx = data.headerIndex;
    if (idx['User_ID'] === undefined || idx['Email'] === undefined) return { patched: false };

    for (var i = 0; i < data.rows.length; i++) {
      var rowUid = String(data.rows[i][idx['User_ID']] || '').trim();
      if (rowUid !== hc.employeeId) continue;
      var rowEmail = String(data.rows[i][idx['Email']] || '').trim();
      if (rowEmail.toLowerCase() === emailLower) {
        // Already correct — no patch needed. Lookup just missed because of
        // case difference or whitespace; normalize once and move on.
        if (rowEmail !== email) {
          db.updateRowByIndex(SHEET_NAMES.TRAVEL_USERS, i + 2, { Email: email });
          _invalidateUserCaches();
        }
        return { patched: false };
      }
      // Stale — patch email
      var oldEmail = rowEmail;
      var patch = { Email: email };
      if (idx['Updated_By'] !== undefined) patch.Updated_By = 'hc_self_heal';
      if (idx['Updated_At'] !== undefined) patch.Updated_At = new Date();
      db.updateRowByIndex(SHEET_NAMES.TRAVEL_USERS, i + 2, patch);
      _invalidateUserCaches();
      console.log('selfHealCurrentUserEmail: User_ID=' + rowUid +
        ' email patched ' + oldEmail + ' -> ' + email);
      return { patched: true, userId: rowUid, oldEmail: oldEmail, newEmail: email };
    }
    return { patched: false };
  } catch (e) {
    console.warn('selfHealCurrentUserEmail error: ' + e.message);
    return { patched: false };
  }
}

// ============================================================================
// HELPERS (private)
// ============================================================================

/**
 * Look up an HC staffing record by lowercased email. Returns the first match
 * or null. Used by addTravelUser to auto-resolve User_ID = HC employeeId.
 *
 * @param {string} emailLower
 * @returns {Object|null} { employeeId, employeeName, emailAddress } or null
 * @private
 * @server
 */
function _lookupHCByEmail(emailLower) {
  try {
    const bundle = HC.hcGetBundle();
    if (!bundle) return null;
    // hcGetBundle returns { success, data } per existing patterns; fallback to .staffing
    const list = (bundle.data && bundle.data.length) ? bundle.data
                : (bundle.staffing && bundle.staffing.length) ? bundle.staffing
                : [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s || !s.emailAddress || !s.employeeId) continue;
      if (String(s.emailAddress).trim().toLowerCase() === emailLower) {
        return {
          employeeId: String(s.employeeId).trim(),
          employeeName: s.employeeName || '',
          emailAddress: s.emailAddress
        };
      }
    }
    return null;
  } catch (e) {
    console.warn('_lookupHCByEmail: ' + e.message);
    return null;
  }
}

/**
 * Check if a User_ID exists in Travel_Users.
 *
 * @param {Sheet} sheet - Travel_Users sheet
 * @param {string} userId
 * @returns {boolean}
 * @private
 * @server
 */
function _userExists(sheet, userId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const uidIdx = headers.indexOf('User_ID');
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][uidIdx] || '').trim() === userId) return true;
  }
  return false;
}

/**
 * Invalidate all caches that depend on Travel_Users / Travel_User_Roles AND
 * broadcast the change to other open admin sessions. Call after every write.
 * @private
 * @server
 */
function _invalidateUserCaches() {
  try { _invalidateUnifiedRoleCache(); } catch (e) {}
  try {
    const db = new TravelDB();
    db.invalidate(SHEET_NAMES.TRAVEL_USERS);
    db.invalidate(SHEET_NAMES.TRAVEL_USER_ROLES);
  } catch (e) {}
  try { broadcastTravelUsersChange(); } catch (e) {}
}

/**
 * Smart default for Is_Primary: if no active role of (roleType, scope)
 * is currently primary, the new one becomes primary. Else backup.
 *
 * Encodes the "first one wins, second one is backup" rule. Admin swaps
 * later via the star icon. Used by addTravelUser.initialRole and
 * addRoleToUser whenever the caller doesn't pass an explicit isPrimary.
 *
 * @returns {boolean}
 * @private
 * @server
 */
function _smartDefaultPrimary(rolesSheet, roleType, scope) {
  if (!rolesSheet) return true;
  var lastRow = rolesSheet.getLastRow();
  if (lastRow < 2) return true;
  var headers = rolesSheet.getRange(1, 1, 1, rolesSheet.getLastColumn()).getValues()[0];
  var typeIdx = headers.indexOf('Role_Type');
  var scopeIdx = headers.indexOf('Scope');
  var primaryIdx = headers.indexOf('Is_Primary');
  var activeIdx = headers.indexOf('Is_Active');
  var data = rolesSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var scopeKey = String(scope || '').trim();
  for (var i = 0; i < data.length; i++) {
    var rt = String(data[i][typeIdx] || '').trim();
    var rs = String(data[i][scopeIdx] || '').trim();
    if (rt !== roleType || rs !== scopeKey) continue;
    var isActive = data[i][activeIdx] !== false && String(data[i][activeIdx]).toLowerCase() !== 'false';
    var isPrimary = data[i][primaryIdx] === true || String(data[i][primaryIdx]).toLowerCase() === 'true';
    if (isActive && isPrimary) return false;
  }
  return true;
}

/**
 * Serialize a date value to ISO string for JSON transport. Returns null for
 * blank/invalid. Distinct from DateTime.js display formatters — this is for
 * google.script.run envelope timestamps, not human-readable output.
 * @private
 * @server
 */
function _formatDateForJson(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  return String(value);
}

// ============================================================================
// ROUTING HELPERS (relocated from Admin.js in Chunk 14, 2026-05-21)
// ============================================================================
//
// These three helpers were originally in Admin.js but have zero callers
// inside any Admin_*.js file — their only consumers are the role-change
// flows in Users.js (7 call sites). Domain home is here, not there.
//
//   _reassignPendingForRoleChange — bulk-reassign pending requests when
//     a sector/BU role assignment changes
//   _orphanPendingForRoleChange   — counterpart for role removal that
//     doesn't have a replacement assigned yet
//   _findHCSectorDirector         — HC-staffing-driven Sector Director
//     lookup used by the reassignment path
// ============================================================================

// ============================================================================
// HELPERS — bulk pending-request reassignment on routing config change
// ============================================================================

/**
 * Bulk-reassign every PENDING request currently routed to oldEmail at
 * the stage owned by `roleType` over to newEmail, and write one
 * ADMIN_REASSIGN entry per request to Approval_Log.
 *
 * Called by every server function that mutates routing assignment:
 *   - setRolePrimary       — promote a different user to primary;
 *                            pending requests transfer from the old
 *                            primary to the new one
 *   - setRoleActive(false) — deactivating an active primary; the
 *                            auto-promoted backup picks up pending
 *   - addRoleToUser        — first primary added to a previously
 *                            empty seat; vacant pending get assigned
 *
 * Status filter per role type:
 *   aas_fo_reviewer  → PENDING_OSO
 *   fas_fo_reviewer  → PENDING_FAS
 *   bu_reviewer      → PENDING_BU + Submitter_BU == scope
 *   sector_override  → PENDING_SECTOR  (matched by oldEmail; see caveat)
 *
 * Sector caveat: sector_override.Scope is the bare sector NAME, so a
 * single user holding overrides for multiple sectors that share a
 * name across BUs can over-match. Same limitation as the routing
 * dashboard's sector override resolution. Documented for now;
 * scope=BU::Sector schema migration would close it.
 *
 * @param {Object} args
 * @param {string} args.roleType       'aas_fo_reviewer'|'fas_fo_reviewer'|'bu_reviewer'|'sector_override'
 * @param {string} args.scope          BU/sector name; '' for unscoped roles
 * @param {string} args.oldEmail       Previous assignee's email; '' to fill a vacant seat
 * @param {string} args.newEmail       New assignee's email (required)
 * @param {string} args.newName        Display name for the new assignee
 * @param {string} args.adminEmail     Acting admin's email (Action_By_Email on log)
 * @param {string} args.adminName      Acting admin's display name (Action_By_Name on log)
 * @param {string} args.reason         Free-text reason (e.g. 'promoted to primary')
 * @returns {Object} { reassignedCount, requestIds: string[] }
 * @private
 * @server
 */
function _reassignPendingForRoleChange(args) {
  if (!args || !args.roleType || !args.newEmail) {
    throw new Error('_reassignPendingForRoleChange: roleType + newEmail required');
  }

  // Status filter spans both PENDING_* and NEEDS_INFO_* for the role's stage.
  // NEEDS_INFO requests are bounced to the submitter for clarification — when
  // they resubmit, the request returns to PENDING_* with the same
  // Current_Reviewer_Email. If we skip the NEEDS_INFO row during a swap,
  // the resubmitted request silently lands back in the OLD primary's queue.
  var STATUS_BY_ROLE = {
    'aas_fo_reviewer': [STATUS_CODES.PENDING_OSO,    STATUS_CODES.NEEDS_INFO_OSO],
    'fas_fo_reviewer': [STATUS_CODES.PENDING_FAS], // FAS doesn't issue needs-info per workflow design
    'bu_reviewer':     [STATUS_CODES.PENDING_BU,     STATUS_CODES.NEEDS_INFO_BU],
    'sector_override': [STATUS_CODES.PENDING_SECTOR, STATUS_CODES.NEEDS_INFO_SECTOR]
  };
  var targetStatuses = STATUS_BY_ROLE[args.roleType];
  if (!targetStatuses) {
    return { reassignedCount: 0, requestIds: [] };
  }
  var statusSet = {};
  for (var ts = 0; ts < targetStatuses.length; ts++) statusSet[targetStatuses[ts]] = true;

  // Serialize concurrent role-change paths so two admins clicking swap at the
  // same time can't both write Approval_Log rows for the same requests. The
  // role-table mutation upstream is its own race; this lock only protects
  // the bulk-write window.
  var lock = LockService.getScriptLock();
  try { lock.waitLock(LOCK_TIMEOUT_MS); } catch (le) {
    console.warn('_reassignPendingForRoleChange: lock acquisition timed out — skipping bulk write');
    return { reassignedCount: 0, requestIds: [], lockTimeout: true };
  }

  try {

  var db = new TravelDB();
  var requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
  var approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
  if (!requestsSheet || !approvalLogSheet) {
    return { reassignedCount: 0, requestIds: [] };
  }

  var data = requestsSheet.getDataRange().getValues();
  if (data.length < 2) return { reassignedCount: 0, requestIds: [] };
  var headers = data[0];
  var idx = {};
  for (var h = 0; h < headers.length; h++) idx[headers[h]] = h;
  if (idx['Status'] === undefined || idx['Current_Reviewer_Email'] === undefined) {
    console.warn('_reassignPendingForRoleChange: required columns missing on Requests');
    return { reassignedCount: 0, requestIds: [] };
  }

  var oldEmailLower = String(args.oldEmail || '').toLowerCase();
  var newEmail = String(args.newEmail).trim();
  var newName = String(args.newName || '').trim();
  var scopeKey = String(args.scope || '').trim();
  var now = new Date();
  var hits = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var status = String(row[idx['Status']] || '').toUpperCase();
    if (!statusSet[status]) continue;

    var currentEmail = String(row[idx['Current_Reviewer_Email']] || '').toLowerCase();

    // Two valid match modes:
    //   - replace flow: oldEmail given; row must currently be assigned to it
    //   - vacant-fill:  oldEmail empty; row must currently have NO reviewer
    if (oldEmailLower) {
      if (currentEmail !== oldEmailLower) continue;
    } else {
      if (currentEmail) continue;
    }

    // Skip if the current assignee already IS the new assignee (no-op).
    if (currentEmail === String(newEmail).toLowerCase()) continue;

    // Scope check for bu_reviewer (extra safety beyond email match)
    if (args.roleType === 'bu_reviewer' && scopeKey && idx['Submitter_BU'] !== undefined) {
      var submitterBU = String(row[idx['Submitter_BU']] || '').trim();
      if (submitterBU !== scopeKey) continue;
    }

    hits.push({
      rowNum: r + 1,
      requestId: String(row[idx['Request_ID']] || ''),
      tripName: idx['Trip_Name'] !== undefined ? String(row[idx['Trip_Name']] || '') : ''
    });
  }

  if (hits.length === 0) {
    return { reassignedCount: 0, requestIds: [] };
  }

  var reviewerNameCol = idx['Current_Reviewer_Name'] !== undefined ? idx['Current_Reviewer_Name'] + 1 : null;
  var reviewerEmailCol = idx['Current_Reviewer_Email'] + 1;
  var updatedAtCol = idx['Updated_At'] !== undefined ? idx['Updated_At'] + 1 : null;
  var adminEmail = args.adminEmail || '';
  var adminName = args.adminName || '';
  var reason = args.reason || 'routing config change';

  for (var k = 0; k < hits.length; k++) {
    var hit = hits[k];
    if (reviewerNameCol) requestsSheet.getRange(hit.rowNum, reviewerNameCol).setValue(newName);
    requestsSheet.getRange(hit.rowNum, reviewerEmailCol).setValue(newEmail);
    if (updatedAtCol) requestsSheet.getRange(hit.rowNum, updatedAtCol).setValue(now);

    var snapshot = JSON.stringify({
      newReviewerEmail: newEmail,
      newReviewerName: newName,
      previousReviewer: args.oldEmail || '',
      roleType: args.roleType,
      scope: scopeKey,
      bulk: true,
      reason: reason
    });
    approvalLogSheet.appendRow([
      Utilities.getUuid(),
      hit.requestId,
      ACTION_TYPES.ADMIN_REASSIGN,
      adminName,
      adminEmail,
      'Admin',
      now,
      '',
      '',
      'Bulk reassignment (' + reason + '): ' + (args.oldEmail || '<unassigned>') + ' → ' + newEmail,
      '',
      snapshot
    ]);
  }

  db.invalidate(SHEET_NAMES.REQUESTS);
  db.invalidate(SHEET_NAMES.APPROVAL_LOG);

  // Per-request CacheService entries (request_review_v2_${id}, TTL 120s)
  // carry the OLD Current_Reviewer_Email. Without invalidating, a
  // reviewer hitting their dashboard within the cache window sees
  // themselves as the assigned reviewer when they no longer are.
  try {
    var cache = CacheService.getScriptCache();
    for (var ic = 0; ic < hits.length; ic++) {
      try { cache.remove('request_review_v2_' + hits[ic].requestId); } catch (cacheErr) { /* per-key best effort */ }
    }
  } catch (cacheTopErr) {
    console.warn('_reassignPendingForRoleChange: cache invalidation pass failed: ' + cacheTopErr.message);
  }

  console.log('_reassignPendingForRoleChange: ' + hits.length + ' requests reassigned for ' +
    args.roleType + (scopeKey ? '/' + scopeKey : '') +
    ' (' + (args.oldEmail || 'vacant') + ' → ' + newEmail + ')');

  // Notify the new reviewer with ONE summary email instead of N
  // per-request emails. Email failure is non-blocking — the bulk write
  // already committed.
  try {
    var scopeLabel = '';
    if (args.roleType === 'bu_reviewer') scopeLabel = scopeKey + ' BU';
    else if (args.roleType === 'sector_override') scopeLabel = scopeKey;
    else if (args.roleType === 'aas_fo_reviewer') scopeLabel = 'AAS FO';
    else if (args.roleType === 'fas_fo_reviewer') scopeLabel = 'FAS FO';
    sendBulkReassignmentNotification({
      newReviewer: { name: newName, email: newEmail },
      previousReviewerEmail: args.oldEmail || '',
      adminName: args.adminName || args.adminEmail || 'Admin',
      scopeLabel: scopeLabel,
      reason: reason,
      requests: hits.map(function(h) { return { requestId: h.requestId, tripName: h.tripName }; })
    });
  } catch (emailErr) {
    console.error('_reassignPendingForRoleChange: email send failed (non-blocking): ' + emailErr.message);
    logError('_reassignPendingForRoleChange.email', emailErr, {
      roleType: args.roleType, scope: scopeKey, recipient: newEmail
    });
  }

  return {
    reassignedCount: hits.length,
    requestIds: hits.map(function(h) { return h.requestId; })
  };

  } finally {
    try { lock.releaseLock(); } catch (e) { /* harmless */ }
  }
}

/**
 * Clear Current_Reviewer_Email on every PENDING request currently routed
 * to oldEmail at the stage owned by `roleType`. Used when a primary is
 * deactivated and there's no backup to absorb the queue — the orphaned
 * requests surface as a routing-dashboard gap until a new primary fills
 * the seat. Each clear writes an ADMIN_REASSIGN row with newReviewerEmail
 * empty so the audit trail still shows the unassignment.
 *
 * Same status filter logic as _reassignPendingForRoleChange.
 *
 * @param {Object} args
 * @param {string} args.roleType
 * @param {string} args.scope
 * @param {string} args.oldEmail   Required — orphan only matches the prior assignee
 * @param {string} args.adminEmail
 * @param {string} args.adminName
 * @returns {Object} { reassignedCount, requestIds }
 * @private
 * @server
 */
function _orphanPendingForRoleChange(args) {
  if (!args || !args.roleType || !args.oldEmail) {
    throw new Error('_orphanPendingForRoleChange: roleType + oldEmail required');
  }
  // Same NEEDS_INFO_* coverage as _reassignPendingForRoleChange — see the
  // comment there for the rationale.
  var STATUS_BY_ROLE = {
    'aas_fo_reviewer': [STATUS_CODES.PENDING_OSO,    STATUS_CODES.NEEDS_INFO_OSO],
    'fas_fo_reviewer': [STATUS_CODES.PENDING_FAS], // FAS doesn't issue needs-info per workflow design
    'bu_reviewer':     [STATUS_CODES.PENDING_BU,     STATUS_CODES.NEEDS_INFO_BU],
    'sector_override': [STATUS_CODES.PENDING_SECTOR, STATUS_CODES.NEEDS_INFO_SECTOR]
  };
  var targetStatuses = STATUS_BY_ROLE[args.roleType];
  if (!targetStatuses) return { reassignedCount: 0, requestIds: [] };
  var statusSet = {};
  for (var ts = 0; ts < targetStatuses.length; ts++) statusSet[targetStatuses[ts]] = true;

  var lock = LockService.getScriptLock();
  try { lock.waitLock(LOCK_TIMEOUT_MS); } catch (le) {
    console.warn('_orphanPendingForRoleChange: lock acquisition timed out — skipping orphan write');
    return { reassignedCount: 0, requestIds: [], lockTimeout: true };
  }

  try {

  var db = new TravelDB();
  var requestsSheet = db.sheet(SHEET_NAMES.REQUESTS);
  var approvalLogSheet = db.sheet(SHEET_NAMES.APPROVAL_LOG);
  if (!requestsSheet || !approvalLogSheet) return { reassignedCount: 0, requestIds: [] };

  var data = requestsSheet.getDataRange().getValues();
  if (data.length < 2) return { reassignedCount: 0, requestIds: [] };
  var headers = data[0];
  var idx = {};
  for (var h = 0; h < headers.length; h++) idx[headers[h]] = h;
  if (idx['Status'] === undefined || idx['Current_Reviewer_Email'] === undefined) {
    return { reassignedCount: 0, requestIds: [] };
  }

  var oldEmailLower = String(args.oldEmail).toLowerCase();
  var scopeKey = String(args.scope || '').trim();
  var now = new Date();
  var hits = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (!statusSet[String(row[idx['Status']] || '').toUpperCase()]) continue;
    if (String(row[idx['Current_Reviewer_Email']] || '').toLowerCase() !== oldEmailLower) continue;
    if (args.roleType === 'bu_reviewer' && scopeKey && idx['Submitter_BU'] !== undefined) {
      if (String(row[idx['Submitter_BU']] || '').trim() !== scopeKey) continue;
    }
    hits.push({ rowNum: r + 1, requestId: String(row[idx['Request_ID']] || '') });
  }
  if (!hits.length) return { reassignedCount: 0, requestIds: [] };

  var reviewerNameCol = idx['Current_Reviewer_Name'] !== undefined ? idx['Current_Reviewer_Name'] + 1 : null;
  var reviewerEmailCol = idx['Current_Reviewer_Email'] + 1;
  var updatedAtCol = idx['Updated_At'] !== undefined ? idx['Updated_At'] + 1 : null;

  for (var k = 0; k < hits.length; k++) {
    var hit = hits[k];
    if (reviewerNameCol) requestsSheet.getRange(hit.rowNum, reviewerNameCol).setValue('');
    requestsSheet.getRange(hit.rowNum, reviewerEmailCol).setValue('');
    if (updatedAtCol) requestsSheet.getRange(hit.rowNum, updatedAtCol).setValue(now);

    var snapshot = JSON.stringify({
      newReviewerEmail: '',
      newReviewerName: '',
      previousReviewer: args.oldEmail,
      roleType: args.roleType,
      scope: scopeKey,
      bulk: true,
      orphaned: true,
      reason: 'primary deactivated, no backup configured'
    });
    approvalLogSheet.appendRow([
      Utilities.getUuid(),
      hit.requestId,
      ACTION_TYPES.ADMIN_REASSIGN,
      args.adminName || '',
      args.adminEmail || '',
      'Admin',
      now,
      '',
      '',
      'Orphaned (primary deactivated, no backup): was ' + args.oldEmail,
      '',
      snapshot
    ]);
  }

  db.invalidate(SHEET_NAMES.REQUESTS);
  db.invalidate(SHEET_NAMES.APPROVAL_LOG);

  // Per-request review cache invalidation — see _reassignPendingForRoleChange
  try {
    var cache = CacheService.getScriptCache();
    for (var ic = 0; ic < hits.length; ic++) {
      try { cache.remove('request_review_v2_' + hits[ic].requestId); } catch (cacheErr) { /* per-key */ }
    }
  } catch (cacheTopErr) {
    console.warn('_orphanPendingForRoleChange: cache invalidation pass failed: ' + cacheTopErr.message);
  }

  console.log('_orphanPendingForRoleChange: ' + hits.length + ' requests orphaned ' +
    args.roleType + (scopeKey ? '/' + scopeKey : ''));

  return { reassignedCount: hits.length, requestIds: hits.map(function(h) { return h.requestId; }) };

  } finally {
    try { lock.releaseLock(); } catch (e) { /* harmless */ }
  }
}

/**
 * Find the HC-derived Sector Director for a sector NAME, ignoring any
 * Travel_User_Roles overrides. Used when a sector_override holder is
 * deactivated — pending requests in that sector should cascade to the
 * synced (HC) SD instead of being orphaned outright.
 *
 * Sector names collide across BUs ("Sector 1" exists in Army, Defense,
 * AF/Navy/SF, ...). When ambiguous (multiple BUs have an HC SD with
 * the same sector name), returns null and the caller orphans —
 * auto-cascading to the wrong BU's SD would be worse than orphaning.
 *
 * @param {string} sectorName
 * @returns {Object|null} { name, email, buName } or null
 * @private
 * @server
 */
function _findHCSectorDirector(sectorName) {
  if (!sectorName) return null;
  try {
    var bundle = HC.hcGetBundle();
    if (!bundle || !bundle.success || !bundle.data) return null;
    var matches = [];
    for (var i = 0; i < bundle.data.length; i++) {
      var p = bundle.data[i];
      if (!p || !p.org || !p.officeTitle || !p.emailAddress) continue;
      if (p.org.sector !== sectorName) continue;
      if (String(p.officeTitle).toLowerCase().indexOf('sector director') === -1) continue;
      if (String(p.grade) !== '15') continue;
      if (String(p.supervisoryStatus) !== '2') continue;
      var occ = String(p.occupancyStatus || '').toUpperCase();
      if (occ === 'VACANT' || occ === 'OBLIGATED') continue;
      matches.push({
        name: p.employeeName || '',
        email: p.emailAddress,
        buName: (p.org && p.org.businessUnit) || ''
      });
    }
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      console.warn('_findHCSectorDirector: ambiguous — ' + matches.length +
        ' SDs match sector "' + sectorName + '" across BUs; not auto-cascading');
      return null;
    }
    return matches[0];
  } catch (e) {
    console.error('_findHCSectorDirector error: ' + e.message);
    return null;
  }
}
