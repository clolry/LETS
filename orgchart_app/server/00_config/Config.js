/**
 * Config.js
 * Every environment-specific value the org chart needs, in one place.
 *
 * WHY NOTHING HERE IS A LITERAL
 * -----------------------------
 * Spreadsheet IDs are environment configuration, not source. The LETS repo
 * enforces this with a CI guard that rejects any 40-plus-character
 * `1`-prefixed string in server code, and that guard covers this project too.
 *
 * Set this before first use:
 *
 *   Project Settings -> Script Properties
 *     HC_SPREADSHEET_ID = <the LETS travel database spreadsheet ID>
 *
 * It is the SAME spreadsheet LETS writes HC_Positions and HC_Orgs to. This
 * project only ever reads it.
 */

/** Script Property keys. Internal name -> actual key. */
var PROPS = {
  // The spreadsheet holding HC_Positions and HC_Orgs. Shared with LETS.
  HC_SPREADSHEET_ID: 'HC_SPREADSHEET_ID',

  // Optional. Appears in the page title and header.
  ORG_NAME: 'ORG_NAME',

  // Optional. Minutes to cache the built tree. Default 60.
  CACHE_MINUTES: 'CACHE_MINUTES'
};

/** Tab names. These must match LETS's TRAVEL_SHEET_SCHEMAS keys exactly. */
var TABS = {
  POSITIONS: 'HC_Positions',
  ORGS: 'HC_Orgs'
};

function _props_() {
  return PropertiesService.getScriptProperties();
}

/**
 * Spreadsheet ID, or '' when unset.
 *
 * Returns '' rather than throwing so doGet can render an instruction page.
 * An unset property is the expected state on a fresh deployment, and a stack
 * trace is a worse first impression than "set HC_SPREADSHEET_ID".
 *
 * @returns {string}
 */
function getHCSpreadsheetId() {
  return String(_props_().getProperty(PROPS.HC_SPREADSHEET_ID) || '').trim();
}

/**
 * Organisation name for the page title.
 * @returns {string}
 */
function getOrgName() {
  return String(_props_().getProperty(PROPS.ORG_NAME) || '').trim() ||
    'Acquisition Solutions Development';
}

/**
 * Cache lifetime for the built tree, in seconds.
 *
 * The chart is reference data that changes when HR data changes — rarely, and
 * never urgently. An hour of staleness is invisible to a user looking up who
 * someone reports to; a cache miss on every page load is not.
 *
 * Clamped to Apps Script's 6-hour CacheService ceiling, and floored at a
 * minute so a mistyped property cannot disable caching entirely.
 *
 * @returns {number} seconds
 */
function getCacheSeconds() {
  var raw = parseInt(_props_().getProperty(PROPS.CACHE_MINUTES), 10);
  var minutes = isNaN(raw) ? 60 : raw;
  if (minutes < 1) minutes = 1;
  if (minutes > 360) minutes = 360;
  return minutes * 60;
}
