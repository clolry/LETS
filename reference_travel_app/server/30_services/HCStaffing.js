/**
 * HCStaffing.js
 * Server-side gateway to the HC Data Library for TRIP.
 *
 * TRIP only needs the enriched staffing bundle (employee lookups +
 * supervisor chain). Since TRIP runs as USER_DEPLOYING, the cache-miss
 * fallback (direct spreadsheet read) always succeeds. The optional
 * trigger that pre-warms the cache lives in 99_triggers/CacheWarming.js.
 */

/**
 * Get the enriched staffing list.
 * Called by:
 *   - getSubmitterInfo() in 91_setup/Database.js (server-side employee lookup)
 *   - hcDataCenterService.html (client-side autocomplete + supervisor chain)
 *
 * @returns {Object} { success: true, data: Array, count: number, lastRefreshed: string }
 *                or { success: false, error: string, data: [] }
 * @client
 */
function getHCStaffingBundle() {
  return HC.hcGetBundle();
}
