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
  // PII BOUNDARY. This is browser-callable by any signed-in user (G-001),
  // and unsanitized it returned employee ID, email, GS grade, LCAT and
  // duty-station street address for every person on the roster — ~1100
  // records once the FAS feed lands. Name plus grade is salary disclosure.
  //
  // hcSanitizeBundle reduces each record to the caller's tier and returns the
  // bundle unchanged for an admin. See 30_services/HCPrivacy.js.
  var bundle = HC.hcGetBundle();
  var tier = hcCallerTier();
  hcLogPiiAccess('getHCStaffingBundle', tier.tier,
                 (bundle && bundle.data) ? bundle.data.length : 0);
  return hcSanitizeBundle(bundle);
}
