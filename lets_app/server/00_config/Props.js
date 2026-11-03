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
  DOS_LAST_SYNC:                'dos_last_sync',

  // ------------------------------------------------------------------
  // BRANDING. Configurable so this app can be deployed for another
  // workgroup without a code change.
  //
  // Every user-visible mention of the app name, the owning organisation and
  // the contact mailbox resolves through these. They were hardcoded as "TRIP",
  // "AAS" and aastravel@gsa.gov in 136 places, which made the app
  // indistinguishable from the workgroup it was inherited from.
  //
  // Defaults below are THIS deployment's values, so an unset property still
  // produces correct output here. A different workgroup sets the properties.
  // ------------------------------------------------------------------
  APP_NAME:                     'APP_NAME',
  ORG_SHORT_NAME:               'ORG_SHORT_NAME',
  ORG_LONG_NAME:                'ORG_LONG_NAME',
  // The SERVICE above the office, and the agency above that. Both appear in
  // the email footer. Separate from ORG_LONG_NAME because a footer names the
  // service (FAS), not the office (ASD) — see getOrgServiceName.
  ORG_SERVICE_NAME:             'ORG_SERVICE_NAME',
  AGENCY_NAME:                  'AGENCY_NAME',
  ORG_FO_LABEL:                 'ORG_FO_LABEL',
  REVIEW_LABEL_SECTOR:          'REVIEW_LABEL_SECTOR',
  REVIEW_LABEL_BU:              'REVIEW_LABEL_BU'
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
 * "Other costs" gross-up percentage (30 for 30%).
 *
 * Reads the `other_cost_percentage` Script Property. This is the SINGLE SOURCE
 * OF TRUTH; the client reads it at page init via getCostConfigForClient()
 * rather than carrying its own literal.
 *
 * The fallback below applies only when the property is unset or unparseable.
 * It is deliberately the same number as the configured value in both
 * environments so an unset property cannot quietly change the arithmetic —
 * but set the property. Note `parseInt(...) || 30` also maps a configured 0 to
 * 30; a 0% gross-up is not a supported configuration, and treating it as one
 * would silently understate every request.
 *
 * @returns {number}
 * @server
 */
function getOtherCostPercentage() {
  return parseInt(_props().getProperty(PROPS_KEYS.OTHER_COST_PERCENTAGE)) || 30;
}

// ============================================================================
// GETTERS — EMAIL CONFIG
// ============================================================================

/**
 * Email sender/reply-to address. Default 'ASD.Travel-Events@gsa.gov'.
 * @returns {string}
 * @server
 */
function getEmailFromAddress() {
  return _props().getProperty(PROPS_KEYS.EMAIL_FROM_ADDRESS) ||
    'ASD.Travel-Events@gsa.gov';
}

/**
 * Email sender display name. Derived from the org short name, so rebranding
 * via ORG_SHORT_NAME moves the sender too. Default 'ASD Travel & Events'.
 * @returns {string}
 * @server
 */
function getEmailFromName() {
  return _props().getProperty(PROPS_KEYS.EMAIL_FROM_NAME) ||
    (getOrgShortName() + ' Travel & Events');
}

// ============================================================================
// GETTERS — BRANDING
// ============================================================================
//
// WHY THESE EXIST
// ---------------
// The app was inherited from another workgroup and still called itself TRIP,
// signed emails as "AAS TRIP", pointed at aastravel@gsa.gov, and labelled a
// review stage "AAS FO". @clolry: deploying this for another workgroup should
// not require a code change to rebrand it.
//
// Each default is THIS deployment's correct value, so an unset property is not
// a bug — it is the common case. A different workgroup sets the property.

/**
 * Application name, e.g. 'LETS'. Appears in page titles, email subjects and
 * every "Your <app> request" sentence.
 * @returns {string}
 * @server
 */
function getAppName() {
  return _props().getProperty(PROPS_KEYS.APP_NAME) || 'LETS';
}

/**
 * Owning organisation, short form, e.g. 'ASD'. Used where space is tight —
 * review-stage labels, the sender name.
 * @returns {string}
 * @server
 */
function getOrgShortName() {
  return _props().getProperty(PROPS_KEYS.ORG_SHORT_NAME) || 'ASD';
}

/**
 * Owning organisation, long form. 'ACQUISITION SOLUTIONS DEVELOPMENT'.
 *
 * This is the OFFICE. It is not what belongs in an email footer — see
 * getOrgServiceName.
 * @returns {string}
 * @server
 */
function getOrgLongName() {
  return _props().getProperty(PROPS_KEYS.ORG_LONG_NAME) ||
    'ACQUISITION SOLUTIONS DEVELOPMENT';
}

/**
 * The SERVICE this office sits under, for the email footer.
 *
 * @clolry: "The bottom of the emails still say GENERAL SERVICES
 * ADMINISTRATION • ASSISTED ACQUISITION SERVICES. I think it should say
 * FEDERAL ACQUISITION SERVICE rather than ASSISTED ACQUISITION SERVICES."
 *
 * WHY THIS IS A SEPARATE PROPERTY FROM ORG_LONG_NAME
 * --------------------------------------------------
 * A footer names the agency and the SERVICE, which is the level the public
 * recognises — GSA, then FAS. ASD is an office three levels down, and
 * substituting it would have replaced a wrong name with a differently wrong
 * one.
 *
 * The inherited footer said ASSISTED ACQUISITION SERVICES because AAS is a
 * different office under the same service. It was never derivable from the
 * office name, which is why the earlier rebranding sweep missed it: the
 * footer was a hardcoded literal in Email.js, not a token.
 *
 * @returns {string}
 * @server
 */
function getOrgServiceName() {
  return _props().getProperty(PROPS_KEYS.ORG_SERVICE_NAME) ||
    'FEDERAL ACQUISITION SERVICE';
}

/**
 * The agency. Configurable because this app is meant to be redeployable, and
 * a non-GSA workgroup would otherwise have to edit Email.js.
 * @returns {string}
 * @server
 */
function getAgencyName() {
  return _props().getProperty(PROPS_KEYS.AGENCY_NAME) ||
    'GENERAL SERVICES ADMINISTRATION';
}

/**
 * Label for the front-office review stage.
 *
 * Separate from ORG_SHORT_NAME because @clolry prefers the fuller
 * "ASD Travel & Events Team" over "ASD FO" — the two are not derivable from
 * one another.
 * @returns {string}
 * @server
 */
function getOrgFOLabel() {
  return _props().getProperty(PROPS_KEYS.ORG_FO_LABEL) || 'ASD Travel & Events';
}

/**
 * Label for the first review stage.
 *
 * The inherited code says "SD" for Sector Director. This organisation calls it
 * Service Center Director, so the label is SCD. The STORED value in
 * Initial_Review_Level is still 'Sector' — renaming stored data would need a
 * migration, and this is a wording change.
 * @returns {string}
 * @server
 */
function getReviewLabelSector() {
  return _props().getProperty(PROPS_KEYS.REVIEW_LABEL_SECTOR) || 'SCD';
}

/**
 * Label for the second review stage.
 *
 * The inherited code says "BU" for Business Unit. Here it is the DAC — Deputy
 * Assistant Commissioner, the SES running each of FCA, FCB and FCC, which is
 * the same approver the budget-attribution work routes to. The STORED value is
 * still 'BU'.
 * @returns {string}
 * @server
 */
function getReviewLabelBU() {
  return _props().getProperty(PROPS_KEYS.REVIEW_LABEL_BU) || 'DAC';
}

/**
 * Every branding value in one call, for the client.
 *
 * @returns {Object} { appName, orgShort, orgLong, foLabel, sectorLabel,
 *                     buLabel, contactEmail, senderName }
 * @client
 */
function getBrandingForClient() {
  return {
    appName: getAppName(),
    orgShort: getOrgShortName(),
    orgLong: getOrgLongName(),
    orgService: getOrgServiceName(),
    agency: getAgencyName(),
    foLabel: getOrgFOLabel(),
    sectorLabel: getReviewLabelSector(),
    buLabel: getReviewLabelBU(),
    contactEmail: getEmailFromAddress(),
    senderName: getEmailFromName()
  };
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
 * Report the effective email sender configuration. Read-only.
 *
 * THIS FUNCTION USED TO WRITE, AND THE WRITE UN-BRANDED THE APP
 * ------------------------------------------------------------
 * It set EMAIL_FROM_ADDRESS to 'aastravel@gsa.gov' and EMAIL_FROM_NAME to
 * 'AAS Travel' whenever those properties were unset — the inherited
 * workgroup's mailbox and sender name. Because getEmailFromAddress() and
 * getEmailFromName() only apply their defaults while the property is UNSET,
 * one call permanently replaced ASD's sender with AAS's, on every outbound
 * email, with no error anywhere.
 *
 * It was reachable: initTravelEmailConfig (Email.js) is a top-level function
 * and therefore callable from any authenticated browser via
 * google.script.run. Removing the write closes that path at the source, which
 * is why this is not solved by adding a role guard.
 *
 * WHY IT NOW WRITES NOTHING AT ALL, RATHER THAN WRITING THE RIGHT VALUES
 * ---------------------------------------------------------------------
 * Writing the correct values would still be wrong. getEmailFromName()
 * DERIVES from getOrgShortName(), so persisting its current result would
 * freeze the sender name and a later ORG_SHORT_NAME change would silently
 * stop reaching it — the same class of bug, one step removed.
 *
 * The getters already supply this deployment's values when unset, so there is
 * nothing to initialize. Unset is the correct and intended state; a property
 * exists to let a DIFFERENT workgroup override it.
 *
 * @returns {{address: string, name: string}} The effective sender config
 * @editor
 */
function initEmailConfigDefaults() {
  const effective = {
    address: getEmailFromAddress(),
    name: getEmailFromName()
  };
  console.log('Email sender config (resolved from properties, or defaults ' +
    'where unset — nothing written):', effective);
  return effective;
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
