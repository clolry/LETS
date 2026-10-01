/**
 * TripConfig.js / LetsConfig.js
 * Application-level configuration for LETS (Logistics, Events, and Travel System).
 * Incorporates EO 14222 FAS Delegation of Travel-Approving Official Authority.
 */

// ============================================================================
// ENVIRONMENT GATE
// ============================================================================
//
// LETS runs in two Google Apps Script projects that share this codebase:
//   production — deployed by .github/workflows/deploy-gas.yml on merge to main
//   development — the sandbox project, pushed to manually for testing
//
// The environment decides which FAS Travel Exception Tracker spreadsheet the
// app is allowed to write to. The official tracker is owned by the FAS front
// office, not by this project; appending test rows to it is an uncorrectable
// write to someone else's system of record.
//
// This gate is FAIL-CLOSED. An unset or unrecognized LETS_ENV resolves to
// 'development', so a newly created or misconfigured project can never reach
// the official tracker. Production must be opted into explicitly.
//
// Controls: CM-2/CM-6 (baseline + settings), SC-7 (boundary protection),
// SI-17 (fail-safe procedures). AGENTS.md §12.1, §14.5.

const LETS_ENV_PRODUCTION = 'production';
const LETS_ENV_DEVELOPMENT = 'development';

/**
 * Reads a Script Property, normalizing "absent" and "present but blank" to
 * null. Safe to call outside Apps Script (returns null under Node).
 *
 * @param {string} key - Script Property key
 * @returns {string|null} Trimmed value, or null if unset/blank/unavailable
 */
function _readScriptProperty(key) {
  if (typeof PropertiesService === 'undefined') return null;
  try {
    const props = PropertiesService.getScriptProperties();
    if (!props) return null;
    const raw = props.getProperty(key);
    if (raw === null || raw === undefined) return null;
    const trimmed = String(raw).trim();
    return trimmed === '' ? null : trimmed;
  } catch (err) {
    // PropertiesService can throw in restricted execution contexts. Treat as
    // unset, which the fail-closed logic below reads as "development".
    return null;
  }
}

/**
 * Normalizes a raw LETS_ENV value to a known environment.
 *
 * Fail-closed: anything that is not exactly 'production' (case/whitespace
 * insensitive) resolves to 'development'. Never infer production.
 *
 * @param {string|null} rawEnv - Raw LETS_ENV property value
 * @returns {string} LETS_ENV_PRODUCTION or LETS_ENV_DEVELOPMENT
 */
function resolveLetsEnvironment(rawEnv) {
  if (rawEnv === null || rawEnv === undefined) return LETS_ENV_DEVELOPMENT;
  const normalized = String(rawEnv).trim().toLowerCase();
  return normalized === LETS_ENV_PRODUCTION ? LETS_ENV_PRODUCTION : LETS_ENV_DEVELOPMENT;
}

/**
 * Decides which FAS Travel Exception Tracker spreadsheet this project may use.
 *
 * Invariants enforced here — all of them fail closed:
 *   1. Production uses FAS_TRACKER_SPREADSHEET_ID only.
 *   2. Development uses TEST_FAS_TRACKER_SPREADSHEET_ID only, and NEVER falls
 *      back to the official tracker. A missing test ID disables the feature
 *      rather than redirecting writes to production.
 *   3. If development is pointed at the same ID as production, the target is
 *      rejected outright. This catches the copy/paste mistake that would
 *      otherwise look correctly configured while writing to the real sheet.
 *
 * @param {string} environment - Result of resolveLetsEnvironment()
 * @param {string|null} productionId - FAS_TRACKER_SPREADSHEET_ID value
 * @param {string|null} developmentId - TEST_FAS_TRACKER_SPREADSHEET_ID value
 * @returns {{environment: string, spreadsheetId: string|null, propertyKey: string,
 *            isProduction: boolean, configured: boolean, reason: string|null}}
 */
function resolveFASTrackerTarget(environment, productionId, developmentId) {
  const isProduction = environment === LETS_ENV_PRODUCTION;
  const propertyKey = isProduction
    ? 'FAS_TRACKER_SPREADSHEET_ID'
    : 'TEST_FAS_TRACKER_SPREADSHEET_ID';

  const candidate = isProduction ? productionId : developmentId;
  const normalized = (candidate === null || candidate === undefined || String(candidate).trim() === '')
    ? null
    : String(candidate).trim();

  const result = {
    environment: environment,
    spreadsheetId: null,
    propertyKey: propertyKey,
    isProduction: isProduction,
    configured: false,
    reason: null
  };

  if (!normalized) {
    result.reason = 'Script Property ' + propertyKey + ' is not set for environment "' +
      environment + '". FAS Tracker integration is disabled. ' +
      (isProduction
        ? 'Set it in Project Settings > Script Properties.'
        : 'Point it at YOUR OWN COPY of the FAS tracker — never the official sheet.');
    return result;
  }

  // Invariant 3: refuse to let a non-production project target the official sheet.
  const productionNormalized = (productionId === null || productionId === undefined)
    ? null
    : String(productionId).trim();
  if (!isProduction && productionNormalized && normalized === productionNormalized) {
    result.reason = 'REFUSING TO RUN: TEST_FAS_TRACKER_SPREADSHEET_ID matches ' +
      'FAS_TRACKER_SPREADSHEET_ID. A non-production environment must not write to the ' +
      'official FAS Travel Exception Tracker. Point TEST_FAS_TRACKER_SPREADSHEET_ID at a copy.';
    return result;
  }

  result.spreadsheetId = normalized;
  result.configured = true;
  return result;
}

const LETS_ENV = resolveLetsEnvironment(_readScriptProperty('LETS_ENV'));
const LETS_IS_PRODUCTION = LETS_ENV === LETS_ENV_PRODUCTION;

const TRAVEL_DB_SPREADSHEET_ID = _readScriptProperty('TRAVEL_DB_SPREADSHEET_ID');

/**
 * The FAS tracker target for THIS project, resolved once at module load.
 * Consumers should read this rather than the raw property, so the environment
 * gate cannot be bypassed. See 30_services/FASTrackerSync.js.
 */
const FAS_TRACKER_TARGET = resolveFASTrackerTarget(
  LETS_ENV,
  _readScriptProperty('FAS_TRACKER_SPREADSHEET_ID'),
  _readScriptProperty('TEST_FAS_TRACKER_SPREADSHEET_ID')
);

/**
 * Effective FAS tracker spreadsheet ID, or null when not configured / refused.
 * Retains the original identifier so existing readers keep working, but the
 * value is now environment-gated rather than always the official sheet.
 */
const FAS_TRACKER_SPREADSHEET_ID = FAS_TRACKER_TARGET.spreadsheetId;

const TRIP_FAVICON_ID = '1y_J9fxewAJxvdGWGc1zU988Lyd3it7WB';

const LETS_APP_NAME = 'LETS - Logistics, Events, and Travel System';
const LETS_FISCAL_YEAR = 'FY27';

/**
 * Two-Tiered Travel Purpose Taxonomy (per FAS Delegation Memo & EO 14222)
 */
const TRAVEL_PURPOSES = {
  // TIER 1: Delegated to FAS Chief of Staff (FAS CoS) - Official FAS Travel Exception Tracker Required
  TIER_1_FAS_COS: [
    {
      code: 'FOREIGN_TRAVEL',
      label: 'Travel to Foreign Areas (OCONUS)',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Foreign travel including in-country travel by OCONUS-based employees'
    },
    {
      code: 'HAE_PARTICIPATION',
      label: 'Highly Attended Event (HAE) Participation',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Participation in events with high federal attendee count'
    },
    {
      code: 'NON_GSA_CONFERENCE',
      label: 'Non-GSA Conference and Event Attendance',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Attendance at external/industry conferences not sponsored by GSA'
    },
    {
      code: 'SPEAKING_ROLE',
      label: 'Conference Speaking or Presenter Role (Non-GSA)',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Speaking or presenter roles at non-GSA events, including virtual'
    },
    {
      code: 'IMM_OVER_10K',
      label: 'Internal Management Meeting (IMM) > $10,000',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Planning, alignment, and coordination meetings exceeding $10k total cost'
    },
    {
      code: 'NON_FED_FUNDED',
      label: 'Non-Federal Source Funded / Fee Reduced Event',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Non-Federal entity pays expenses or reduces/waives registration fee'
    },
    {
      code: 'TRAINING_OVER_7K',
      label: 'Third-Party Training > $7,000 (CSA Required)',
      requiresEventTracker: false,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Training where Continuing Service Agreement is required'
    }
  ],

  // TIER 2: Delegated to Portfolio-level Chief of Staff (e.g. ASD CoS / CREATE)
  TIER_2_PORTFOLIO_COS: [
    {
      code: 'GSA_SPONSORED',
      label: 'GSA-Sponsored or Co-sponsored Event',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Official GSA conferences and internal summits'
    },
    {
      code: 'COMPLIANCE_SITE_VISIT',
      label: 'Compliance (Site Visit / Inspection)',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'On-site compliance inspections, program reviews, and audits'
    },
    {
      code: 'CUSTOMER_ENGAGEMENT',
      label: 'Customer or Agency Engagement',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Customer agency meetings and client support'
    },
    {
      code: 'VENDOR_ENGAGEMENT',
      label: 'Vendor Engagement',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Industry day, supplier reviews, and contractor interactions'
    },
    {
      code: 'CLIENT_PAID',
      label: 'Client Paid Travel',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Directly reimbursable or customer-funded travel'
    },
    {
      code: 'IMM_UNDER_10K',
      label: 'Internal Management Meeting (IMM) < $10,000',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Internal alignment and planning meetings under $10k total cost'
    },
    {
      code: 'TRAINING_UNDER_7K',
      label: 'Training < $7,000 or Internal GSA Training',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Standard third-party training under threshold or GSA-provided training'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LETS_ENV,
    LETS_ENV_PRODUCTION,
    LETS_ENV_DEVELOPMENT,
    LETS_IS_PRODUCTION,
    resolveLetsEnvironment,
    resolveFASTrackerTarget,
    FAS_TRACKER_TARGET,
    TRAVEL_DB_SPREADSHEET_ID,
    FAS_TRACKER_SPREADSHEET_ID,
    TRIP_FAVICON_ID,
    LETS_APP_NAME,
    LETS_FISCAL_YEAR,
    TRAVEL_PURPOSES
  };
}
