/**
 * TravelDataSyncService.js
 *
 * Lightweight pub/sub bus for cross-session data sync. Mirrors the pattern
 * in nucleus_pull/src/server/DataSyncService.js: writes bump a timestamp
 * stored in Script Properties; clients poll cheaply, refetch when the
 * stamp changes.
 *
 * Why ScriptProperties (not CacheService): properties survive cache
 * eviction, so the broadcast doesn't get lost during low-traffic periods.
 * Read/write of a single property is ~10ms — cheap enough to poll on a
 * 30s interval from every active admin without measurable cost.
 *
 * Channel naming: TRAVEL_<scope>_DATA_UPDATED. Today there's only one
 * (TRAVEL_USERS); add new channels here as more sync surfaces emerge
 * (e.g. TRAVEL_REQUESTS_DATA_UPDATED for admin's Requests tab).
 */

// ============================================================================
// CHANNEL: travel users + roles
// ============================================================================

/**
 * Bump the users/roles change timestamp. Called from every TravelUserService
 * write path (addTravelUser, addRoleToUser, setRolePrimary, setRoleActive,
 * deleteRole, updateTravelUser, bootstrapTravelAdmin).
 *
 * Best-effort: failure logs but never throws — sync is nice-to-have.
 */
function broadcastTravelUsersChange() {
  try {
    var ts = String(Date.now());
    setTravelUsersDataUpdated(ts);
    console.log('broadcastTravelUsersChange: ' + ts);
  } catch (e) {
    console.warn('broadcastTravelUsersChange failed: ' + e.message);
  }
}

/**
 * Return the latest users/roles change timestamp. Client compares with its
 * last-known value; if newer, refetches.
 *
 * Returns '0' as a sentinel before any write has happened, so a fresh
 * environment doesn't trigger an immediate refetch loop.
 *
 * @returns {string} milliseconds since epoch as a string
 */
function getTravelUsersUpdateTimestamp() {
  try {
    return getTravelUsersDataUpdated();
  } catch (e) {
    console.warn('getTravelUsersUpdateTimestamp failed: ' + e.message);
    return '0';
  }
}

// ============================================================================
// BATCHED ENDPOINT — for clients watching multiple channels
// ============================================================================

/**
 * Batch read of every TRAVEL channel timestamp in one round trip. Cheaper
 * than N separate calls when admin has multiple sync surfaces open.
 *
 * @returns {Object} { users: '<ms>' } — additional channels added as needed
 */
function getTravelDataUpdateTimestamps() {
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    return {
      users: props['TRAVEL_USERS_DATA_UPDATED'] || '0'
    };
  } catch (e) {
    console.warn('getTravelDataUpdateTimestamps failed: ' + e.message);
    return { users: '0' };
  }
}
