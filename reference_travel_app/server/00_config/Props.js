/**
 * Props.js
 * Typed wrapper around PropertiesService.getScriptProperties() — single
 * home for "what script properties does TRIP read/write?". Every reader
 * goes through a typed getter that documents the default + units.
 *
 * PROPS_KEYS maps "what TRIP calls it internally" → "actual property key
 * in Project Settings → Script Properties". A few keys are still in
 * lowercase_snake from before the Phase 4.1 UPPER_SNAKE convention; those
 * are flagged with `// TODO: rename` and get UPPER-renamed in a focused
 * polish PR (rename = add new UPPER property + flip PROPS_KEYS value +
 * delete old property in one coordinated step).
 *
 * NOT included here:
 *   - TRAVEL_DB_SPREADSHEET_ID — needed at module load by TravelDB; lives
 *     in 00_config/TripConfig.js as a top-level const instead.
 *   - nps_last_event — that's a USER property (per-user state), different
 *     namespace. Logic is also broken under USER_DEPLOYING — separate
 *     cleanup tracked.
 */

// Canonical internal name → actual GAS property key.
const PROPS_KEYS = {
  GSA_API_KEY:                  'GSA_PERDIEM_API_KEY',
  PRIVATE_MILEAGE_RATE:         'MILEAGE_RATE_PRIVATE',
  GOV_MILEAGE_RATE:             'MILEAGE_RATE_GOV',
  MILEAGE_RATE_EFFECTIVE_DATE:  'MILEAGE_RATE_EFFECTIVE_DATE',
  NFS_TEMPLATE_FILE_ID:         'NFS_TEMPLATE_FILE_ID',
  SHARED_DRIVE_FOLDER_ID:       'SHARED_DRIVE_FOLDER_ID',
  TRAVEL_LOGO_DRIVE_FILE_ID:    'TRAVEL_LOGO_DRIVE_FILE_ID',
  TRAVEL_LOGO_BASE64:           'TRAVEL_LOGO_BASE64',
  TRAVEL_USERS_DATA_UPDATED:    'TRAVEL_USERS_DATA_UPDATED',
  // TODO: rename these 6 to UPPER_SNAKE per Phase 4.1 in a focused polish PR
  EMAIL_FROM_ADDRESS:           'travel_email_address',
  EMAIL_FROM_NAME:              'travel_email_name',
  OTHER_COST_PERCENTAGE:        'other_cost_percentage',
  REPORT_BUILDER_PRESETS:       'report_builder_presets',
  DOD_LAST_SYNC:                'dod_last_sync',
  DOS_LAST_SYNC:                'dos_last_sync'
};

// Cache the handle once per execution (cheap; avoids repeated GAS scope lookups).
var _cachedProps = null;
function _props() {
  if (!_cachedProps) _cachedProps = PropertiesService.getScriptProperties();
  return _cachedProps;
}

// ============================================================================
// GETTERS — REQUIRED CONFIG
// ============================================================================

/**
 * GSA Per Diem API key. Required for GSA per diem rate fetches.
 * @returns {string|null}
 * @server
 */
function getGSAApiKey() {
  return _props().getProperty(PROPS_KEYS.GSA_API_KEY);
}

/**
 * Drive file ID for the NFS Worksheet PDF template.
 * @returns {string|null}
 * @server
 */
function getNFSTemplateFileId() {
  return _props().getProperty(PROPS_KEYS.NFS_TEMPLATE_FILE_ID);
}

/**
 * Drive folder ID for travel request attachments (shared drive).
 * @returns {string|null}
 * @server
 */
function getSharedDriveFolderId() {
  return _props().getProperty(PROPS_KEYS.SHARED_DRIVE_FOLDER_ID);
}

// ============================================================================
// GETTERS — RATES + COSTS (with defaults)
// ============================================================================

/**
 * Private vehicle mileage rate per mile. Falls back to 0.70 if unset.
 * @returns {number}
 * @server
 */
function getPrivateMileageRate() {
  return parseFloat(_props().getProperty(PROPS_KEYS.PRIVATE_MILEAGE_RATE)) || 0.70;
}

/**
 * Government vehicle mileage rate per mile. Falls back to 0.22 if unset.
 * @returns {number}
 * @server
 */
function getGovMileageRate() {
  return parseFloat(_props().getProperty(PROPS_KEYS.GOV_MILEAGE_RATE)) || 0.22;
}

/**
 * Effective date of current mileage rates (display only). Default '2026-01-01'.
 * Future automation idea logged as OPEN_QUESTIONS.md Q17.
 * @returns {string}
 * @server
 */
function getMileageRateEffectiveDate() {
  return _props().getProperty(PROPS_KEYS.MILEAGE_RATE_EFFECTIVE_DATE) || '2026-01-01';
}

/**
 * "Other costs" gross-up percentage (15 for 15%). Default 15.
 * @returns {number}
 * @server
 */
function getOtherCostPercentage() {
  return parseInt(_props().getProperty(PROPS_KEYS.OTHER_COST_PERCENTAGE)) || 15;
}

// ============================================================================
// GETTERS — EMAIL CONFIG
// ============================================================================

/**
 * Email sender/reply-to address. Default 'aastravel@gsa.gov'.
 * @returns {string}
 * @server
 */
function getEmailFromAddress() {
  return _props().getProperty(PROPS_KEYS.EMAIL_FROM_ADDRESS) || 'aastravel@gsa.gov';
}

/**
 * Email sender display name. Default 'AAS Travel'.
 * @returns {string}
 * @server
 */
function getEmailFromName() {
  return _props().getProperty(PROPS_KEYS.EMAIL_FROM_NAME) || 'AAS Travel';
}

// ============================================================================
// GETTERS — STATE / CACHE (read-write below)
// ============================================================================

/**
 * Drive file ID for the email logo image, if configured this way.
 * @returns {string|null}
 * @server
 */
function getTravelLogoDriveFileId() {
  return _props().getProperty(PROPS_KEYS.TRAVEL_LOGO_DRIVE_FILE_ID);
}

/**
 * Base64-encoded email logo, if configured this way.
 * @returns {string|null}
 * @server
 */
function getTravelLogoBase64() {
  return _props().getProperty(PROPS_KEYS.TRAVEL_LOGO_BASE64);
}

/**
 * Stored report-builder presets (JSON-stringified).
 * @returns {string|null}
 * @server
 */
function getReportBuilderPresets() {
  return _props().getProperty(PROPS_KEYS.REPORT_BUILDER_PRESETS);
}

/**
 * Last-updated timestamp for the Travel Users cache. Default '0'.
 * @returns {string}
 * @server
 */
function getTravelUsersDataUpdated() {
  return _props().getProperty(PROPS_KEYS.TRAVEL_USERS_DATA_UPDATED) || '0';
}

/**
 * Last successful DoD per-diem sync timestamp (ISO string).
 * @returns {string|null}
 * @server
 */
function getDoDLastSync() {
  return _props().getProperty(PROPS_KEYS.DOD_LAST_SYNC);
}

/**
 * Last successful DOS per-diem sync timestamp (ISO string).
 * @returns {string|null}
 * @server
 */
function getDOSLastSync() {
  return _props().getProperty(PROPS_KEYS.DOS_LAST_SYNC);
}

// ============================================================================
// SETTERS
// ============================================================================

/** @param {string} ts - ISO timestamp string @server */
function setTravelUsersDataUpdated(ts) {
  _props().setProperty(PROPS_KEYS.TRAVEL_USERS_DATA_UPDATED, String(ts));
}

/** @param {string} fileId - Drive file ID @server */
function setTravelLogoDriveFileId(fileId) {
  _props().setProperty(PROPS_KEYS.TRAVEL_LOGO_DRIVE_FILE_ID, String(fileId));
}

/** @param {string} base64 - Base64-encoded image data @server */
function setTravelLogoBase64(base64) {
  _props().setProperty(PROPS_KEYS.TRAVEL_LOGO_BASE64, String(base64));
}

/**
 * Delete both logo properties — reverts to text fallback.
 * @server
 */
function deleteTravelLogoProps() {
  _props().deleteProperty(PROPS_KEYS.TRAVEL_LOGO_DRIVE_FILE_ID);
  _props().deleteProperty(PROPS_KEYS.TRAVEL_LOGO_BASE64);
}

/** @param {string} json - JSON-stringified presets @server */
function setReportBuilderPresets(json) {
  _props().setProperty(PROPS_KEYS.REPORT_BUILDER_PRESETS, String(json));
}

/** @param {string} ts - ISO timestamp string @server */
function setDoDLastSync(ts) {
  _props().setProperty(PROPS_KEYS.DOD_LAST_SYNC, String(ts));
}

/** @param {string} ts - ISO timestamp string @server */
function setDOSLastSync(ts) {
  _props().setProperty(PROPS_KEYS.DOS_LAST_SYNC, String(ts));
}

// ============================================================================
// INIT / EDITOR UTILITIES
// ============================================================================

/**
 * Initialize email config defaults if not yet set. Idempotent — safe to re-run.
 * @editor
 */
function initEmailConfigDefaults() {
  if (!_props().getProperty(PROPS_KEYS.EMAIL_FROM_ADDRESS)) {
    _props().setProperty(PROPS_KEYS.EMAIL_FROM_ADDRESS, 'aastravel@gsa.gov');
  }
  if (!_props().getProperty(PROPS_KEYS.EMAIL_FROM_NAME)) {
    _props().setProperty(PROPS_KEYS.EMAIL_FROM_NAME, 'AAS Travel');
  }
  console.log('Email config defaults checked. Current values:', {
    address: getEmailFromAddress(),
    name: getEmailFromName()
  });
}

/**
 * Verify every key in PROPS_KEYS resolves either to a set property OR a
 * documented "set on demand" property. Catches typos in PROPS_KEYS values
 * + missing setup. Run after any chunk that touches Props.js.
 *
 * @returns {{ok: number, missing: number, byKey: Object}}
 * @editor
 */
function _verifyAllPropsKeys() {
  // Properties that may legitimately be unset (set on demand / cached on first use)
  const OPTIONAL = new Set([
    'TRAVEL_LOGO_DRIVE_FILE_ID',
    'TRAVEL_LOGO_BASE64',
    'REPORT_BUILDER_PRESETS',
    'OTHER_COST_PERCENTAGE',          // has a default
    'EMAIL_FROM_ADDRESS',             // has a default
    'EMAIL_FROM_NAME',                // has a default
    'MILEAGE_RATE_EFFECTIVE_DATE',    // has a default
    'TRAVEL_USERS_DATA_UPDATED',      // has a default
    'DOD_LAST_SYNC',                  // populated by first sync
    'DOS_LAST_SYNC'                   // populated by first sync
  ]);

  var ok = 0, missing = 0, byKey = {};
  Object.keys(PROPS_KEYS).forEach(function(intentName) {
    var actualKey = PROPS_KEYS[intentName];
    var value = _props().getProperty(actualKey);
    var present = value !== null;
    var isOptional = OPTIONAL.has(intentName);

    if (present) {
      console.log('  [SET]      ' + intentName + ' (' + actualKey + ')');
      ok++;
      byKey[intentName] = 'set';
    } else if (isOptional) {
      console.log('  [optional] ' + intentName + ' (' + actualKey + ') — unset, has default');
      ok++;
      byKey[intentName] = 'optional-unset';
    } else {
      console.error('  [MISSING]  ' + intentName + ' (' + actualKey + ') — REQUIRED but not set');
      missing++;
      byKey[intentName] = 'MISSING';
    }
  });

  if (missing === 0) {
    console.log('_verifyAllPropsKeys: all ' + ok + ' properties OK');
  } else {
    console.error('_verifyAllPropsKeys: ' + missing + ' REQUIRED properties missing — fix in Project Settings → Script Properties');
  }
  return { ok: ok, missing: missing, byKey: byKey };
}
