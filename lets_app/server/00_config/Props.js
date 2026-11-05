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
  REVIEW_LABEL_BU:              'REVIEW_LABEL_BU',

  // ------------------------------------------------------------------
  // EXTERNAL DATA SOURCES
  // ------------------------------------------------------------------
  //
  // THE HR ROSTER'S ONLY AUTHORITATIVE SOURCE.
  //
  // @clolry: "please make sure that when we seed the HR roster that we remove
  // ALL test records and are relying only on the sheet identified in the
  // system properties and completely ignore my sheet from May."
  //
  // That instruction came out of a real error. Melissa Mould was reported as
  // unattributed, and the reason was that the May staffing plan
  // (reference_excel_files/Copy of ASD Staffing Plan 5-12-26.xlsx) places her
  // in FCBBB with supervisory status 8, while the HR feed has her in FCBBBB
  // as a status-2 supervisor. The May file is six months stale.
  //
  // The consequence was not one wrong row. Every per-capita service-centre
  // figure produced before this property existed was computed from that stale
  // file, so all 22 shares need recomputing from the feed. A roster that is
  // quietly out of date produces allocations that look precise and are wrong,
  // which is worse than an obvious gap.
  //
  // So: HCRosterImport reads THIS property and nothing else. There is no
  // fallback to a bundled file, and no default — an unset property is an
  // error, because defaulting to a stale roster is the failure being
  // prevented.
  //
  // THIS REPLACED THE FAS HRLINKS FEED, AND THE REPLACEMENT IS STRICTLY
  // BETTER IN TWO WAYS.
  //
  // @clolry: "I was able to get access to a completely different data source.
  // It's specific to FC only (and doesn't have the rest of FAS) and it
  // includes all of the information we need - including an email address!"
  //
  //   1. IT CARRIES EMAIL ADDRESSES. The HRLinks feed had 33 columns and not
  //      one was an address, which is why ~5,100 lines of directory name
  //      matching existed at all. That whole subsystem is now deleted —
  //      Email_Address comes from the feed's own column, which is
  //      authoritative rather than inferred.
  //   2. IT IS FC-ONLY. The HRLinks FAS tab was 4,274 rows across five
  //      portfolios against ASD's ~1,046, so the scope filter was load-
  //      bearing: without it the import admitted several hundred non-ASD
  //      supervisors to LETS. HR_ORG_SCOPE still applies and still defaults
  //      to FC, because a source being narrow today is not a reason to stop
  //      checking.
  //
  // The old keys FAS_HRLinks_Feed and FAS_HRLinks_Feed_Tab have been removed
  // from Script Properties. Nothing reads them.
  FC_WF_FEED:                   'FC_WF_Data_Report',
  // Tab within that spreadsheet. Separate so the tab can be renamed without
  // re-pasting the ID, and because the feed workbook holds several sheets.
  //
  // NO DEFAULT, unlike the HRLinks tab which defaulted to 'FAS'. That default
  // was defensible there because a wrong tab in the right workbook fails
  // loudly — the required columns are absent and parseFeed refuses. It is not
  // defensible here because this workbook's tab name is not yet known to the
  // code, and guessing one means guessing which sheet holds the roster.
  FC_WF_FEED_TAB:               'FC_WF_Tab',

  // WHICH ORG THIS DEPLOYMENT OWNS. Historically load-bearing: the HRLinks
  // FAS tab was 4,274 rows covering all five FAS portfolios against ASD's
  // ~1,046. The FC workforce report is FC-only, so the filter should now be a
  // no-op — and previewRosterImport reporting outOfScope: 0 is the evidence
  // that the source really is scoped, rather than an assumption.
  //
  // Without a scope filter the import writes every non-ASD employee the
  // source happens to carry into HC_Positions, and Access.js:435 grants LETS
  // access to anyone there whose Supervisory_Status is '2' — which under the
  // old FAS-wide feed meant several hundred supervisors from other
  // portfolios, admitted silently. It would also publish them to the org
  // chart and inflate every per-capita denominator.
  //
  // KEPT EVEN THOUGH THE NEW SOURCE IS FC-ONLY. A filter that is currently a
  // no-op costs nothing; removing it would mean a future source change could
  // widen the roster with no guard and no signal.
  //
  // A PROPERTY rather than a constant because @clolry: "eventually we need to
  // build this for use across all 5 FAS portfolios, but for now we're focused
  // on getting it working for ASD/FC." Widening the scope then is a property
  // change, not a code change.
  HR_ORG_SCOPE:                 'HR_ORG_SCOPE',

  // The travel coordinator's ASD FY27 Travel/Liability Log, pulled daily until
  // LETS is mandatory. @clolry: "this is a temporary process only until the
  // system is fully in use then we'll discontinue the importing of existing
  // travel." See 30_services/LiabilityLogSync.js.
  LIABILITY_LOG_SHEET:          'LIABILITY_LOG_SHEET_ID',
  LIABILITY_LOG_TAB:            'LIABILITY_LOG_TAB'
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

/**
 * Dollar amount of a set-aside whose config entry names a property key.
 *
 * @clolry asked for the FC senior advisor figure to be configurable: the
 * estimate is "about twice a month at approximately $2k/trip" and both halves
 * of that are approximate. Changing it must not need a deploy.
 *
 * WHY THIS LIVES IN Props.js AND NOT IN BudgetConfig.js
 * -----------------------------------------------------
 * BudgetConfig.js is evaluated on EVERY execution, before any user code, and a
 * failure there takes down the whole web app including the travel workflow
 * (see the `var LETS_CONFIG` note in that file). PropertiesService is an
 * external call that can throw or be unauthorised. Calling it at
 * file-evaluation time would put the entire app behind a service that has
 * nothing to do with rendering a page.
 *
 * So the config carries a `amountPropertyKey` string and a default amount, and
 * this resolves it at READ time, inside BudgetDashboard's try/catch.
 *
 * WHY A ZERO IS HONOURED HERE, UNLIKE getOtherCostPercentage ABOVE
 * ----------------------------------------------------------------
 * `parseInt(...) || 30` maps a configured 0 to 30, which is right there: a 0%
 * gross-up is not a supported configuration. A $0 set-aside IS meaningful — it
 * is how an admin retires a line without a deploy — so this checks for null
 * and NaN explicitly rather than for falsiness. A `|| fallback` here would
 * make a deliberate $0 silently become $48,000.
 *
 * A NEGATIVE VALUE IS REFUSED, not clamped. A negative set-aside would ADD to
 * a DAC's discretionary balance, which is money that does not exist, and the
 * dashboard has no way to show that it happened.
 *
 * @param {string} key the PROPS_KEYS-style property name, e.g.
 *                     'BUDGET_FC_ADVISOR_AMOUNT'
 * @param {number} defaultAmount used when the property is unset or unusable
 * @returns {number}
 * @server
 */
function getSetAsideAmountOverride(key, defaultAmount) {
  var fallback = Number(defaultAmount) || 0;
  if (!key) return fallback;

  var raw;
  try {
    raw = _props().getProperty(String(key));
  } catch (e) {
    // An unreadable property store must not blank a budget figure.
    console.warn('getSetAsideAmountOverride: ' + key + ' unreadable: ' + e.message);
    return fallback;
  }
  if (raw === null || raw === undefined || String(raw).trim() === '') return fallback;

  var n = parseFloat(String(raw).replace(/[$,]/g, ''));
  if (isNaN(n)) {
    console.warn('getSetAsideAmountOverride: ' + key + ' is not a number: ' + raw);
    return fallback;
  }
  if (n < 0) {
    console.warn('getSetAsideAmountOverride: ' + key + ' is negative (' + n +
                 '); refusing. A negative set-aside would inflate a DAC balance.');
    return fallback;
  }
  return Math.round(n * 100) / 100;
}

// ============================================================================
// GETTERS — EXTERNAL DATA SOURCES
// ============================================================================

/**
 * The FC workforce data report: the ONLY authoritative source for the roster.
 *
 * @clolry: "please make sure that when we seed the HR roster that we remove
 * ALL test records and are relying only on the sheet identified in the system
 * properties and completely ignore my sheet from May."
 *
 * RETURNS AN ERROR RATHER THAN A DEFAULT, which is the point. Every other
 * getter in this file falls back to a sensible value; this one must not,
 * because the plausible fallbacks are all stale rosters and a stale roster
 * produces allocations that look precise and are wrong.
 *
 * The concrete case: the May 2026 staffing plan places Melissa Mould in FCBBB
 * at supervisory status 8. The HR feed has her in FCBBBB as a status-2
 * supervisor. Every per-capita service-centre allocation computed before this
 * property existed came from the May file, so all 22 shares are suspect until
 * recomputed from the feed.
 *
 * REPLACED getFasHrFeedSource. The FAS HRLinks feed had no email column, which
 * is why a 5,100-line directory name-matching subsystem existed; this source
 * carries Employee Email, so that subsystem is deleted. It is also FC-only
 * rather than all five FAS portfolios.
 *
 * THE TAB HAS NO DEFAULT HERE, unlike the HRLinks version which defaulted to
 * 'FAS'. That default was defensible because a wrong tab in the right workbook
 * fails loudly — the required columns are absent and parseFeed refuses. It is
 * not defensible now, because this workbook's layout is not yet known to the
 * code and guessing a tab means guessing which sheet holds the roster.
 *
 * @returns {{ok: boolean, spreadsheetId: string, tabName: string,
 *            error: string}}
 * @server
 */
function getFcWorkforceFeedSource() {
  var id = '';
  var tab = '';
  try {
    id = String(_props().getProperty(PROPS_KEYS.FC_WF_FEED) || '').trim();
    tab = String(_props().getProperty(PROPS_KEYS.FC_WF_FEED_TAB) || '').trim();
  } catch (e) {
    return {
      ok: false, spreadsheetId: '', tabName: '',
      error: 'Could not read Script Properties: ' + e.message
    };
  }

  if (!id) {
    return {
      ok: false, spreadsheetId: '', tabName: '',
      error: 'Script Property ' + PROPS_KEYS.FC_WF_FEED + ' is not set. The ' +
             'HR roster has no other source — there is deliberately no ' +
             'fallback, because defaulting to a stale roster silently ' +
             'misattributes every org\'s budget. Set it in Project Settings ' +
             'then re-run the import.'
    };
  }

  if (!tab) {
    return {
      ok: false, spreadsheetId: id, tabName: '',
      error: 'Script Property ' + PROPS_KEYS.FC_WF_FEED_TAB + ' is not set. ' +
             'There is no default: this workbook may hold several sheets, and ' +
             'guessing which one is the roster risks importing the wrong ' +
             'people. Run diagnoseHrFeedSource() — it lists every tab in the ' +
             'workbook with its row and column counts — then set this to the ' +
             'right name, copied exactly.'
    };
  }

  // A pasted Google Sheets URL rather than a bare ID is the likeliest setup
  // mistake, and it is recoverable without troubling anyone.
  var m = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) id = m[1];

  return {
    ok: true,
    spreadsheetId: id,
    tabName: tab,
    error: ''
  };
}

/**
 * The org code prefix this deployment owns.
 *
 * Defaults to 'FC' — ASD. The feed's FAS tab carries all five FAS portfolios,
 * and importing the other four would grant LETS access to their supervisors
 * (Access.js:435 admits anyone in HC_Positions with Supervisory_Status '2'),
 * publish them to the org chart, and make every per-capita budget share
 * meaningless by quadrupling the denominator.
 *
 * DEFAULTS RATHER THAN ERRORING, unlike the feed ID above. The difference is
 * which way the failure points: an unset spreadsheet ID has no safe answer, so
 * guessing would read a stale roster. An unset scope has a safe answer — the
 * narrowest one, this deployment's own org — and defaulting to it can only
 * ever import too FEW people, which is visible and recoverable. Defaulting
 * wide would import too many, which is neither.
 *
 * @returns {string}
 * @server
 */
function getHrOrgScope() {
  var raw = '';
  try {
    raw = String(_props().getProperty(PROPS_KEYS.HR_ORG_SCOPE) || '').trim();
  } catch (e) {
    console.warn('getHrOrgScope: property unreadable, using FC: ' + e.message);
    return 'FC';
  }
  if (!raw) return 'FC';

  // Letters and digits only. A stray comma or space would silently widen or
  // void the scope — ' FC' matches nothing once anchored, and 'FC,FA' matches
  // nothing either, so both would import zero positions and look like a
  // different bug entirely.
  var code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) {
    console.warn('getHrOrgScope: "' + raw + '" contains no usable org code; ' +
                 'using FC.');
    return 'FC';
  }
  return code;
}

/**
 * The travel coordinator's ASD FY27 Travel/Liability Log.
 *
 * Temporary. @clolry: "this is a temporary process only until the system is
 * fully in use then we'll discontinue the importing of existing travel."
 *
 * Same no-default rule as the HR feed, for a weaker but still real reason: a
 * wrong spreadsheet here imports someone else's travel as ASD commitments.
 *
 * @returns {{ok: boolean, spreadsheetId: string, tabName: string,
 *            error: string}}
 * @server
 */
function getLiabilityLogSource() {
  var id = '';
  var tab = '';
  try {
    id = String(_props().getProperty(PROPS_KEYS.LIABILITY_LOG_SHEET) || '').trim();
    tab = String(_props().getProperty(PROPS_KEYS.LIABILITY_LOG_TAB) || '').trim();
  } catch (e) {
    return {
      ok: false, spreadsheetId: '', tabName: '',
      error: 'Could not read Script Properties: ' + e.message
    };
  }

  if (!id) {
    return {
      ok: false, spreadsheetId: '', tabName: '',
      error: 'Script Property ' + PROPS_KEYS.LIABILITY_LOG_SHEET + ' is not ' +
             'set, so there is no travel log to pull from.'
    };
  }

  var m = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) id = m[1];

  return {
    ok: true,
    spreadsheetId: id,
    tabName: tab || 'Travel FY27',
    error: ''
  };
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
    'DOS_LAST_SYNC',                  // populated by first sync

    // Branding has defaults for THIS deployment, so an unset key still
    // produces correct output. Listed because _verifyAllPropsKeys otherwise
    // reports eight false MISSINGs on a working install.
    'APP_NAME', 'ORG_SHORT_NAME', 'ORG_LONG_NAME', 'ORG_SERVICE_NAME',
    'AGENCY_NAME', 'ORG_FO_LABEL', 'REVIEW_LABEL_SECTOR', 'REVIEW_LABEL_BU',

    // The liability log's tab defaults to the known tab in that workbook.
    // The spreadsheet IDs do not and must not.
    //
    // FC_WF_FEED_TAB IS NOT LISTED HERE, deliberately, which is a change from
    // the HRLinks feed it replaced. That one defaulted to 'FAS' — safe,
    // because a wrong tab in the right workbook fails loudly when the
    // required columns are absent. This workbook's layout is not known to the
    // code, so there is no tab to default to and an unset value must be
    // reported MISSING rather than guessed around.
    'LIABILITY_LOG_TAB',

    // Defaults to 'FC' (ASD), the NARROWEST scope. Safe to leave unset:
    // defaulting narrow can only import too few people, which is visible.
    // Defaulting wide would admit other portfolios' supervisors to LETS.
    'HR_ORG_SCOPE'

    // DELIBERATELY NOT OPTIONAL: FC_WF_FEED, FC_WF_FEED_TAB and
    // LIABILITY_LOG_SHEET.
    //
    // A missing spreadsheet ID has no safe default. Defaulting the HR feed to
    // a bundled file is the exact failure @clolry asked to prevent — the May
    // staffing plan put Melissa Mould in the wrong org and every per-capita
    // figure derived from it was wrong while looking precise. These must be
    // reported MISSING so setup is incomplete until they are set.
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
