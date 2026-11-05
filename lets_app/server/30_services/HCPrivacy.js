/**
 * HCPrivacy.js
 * The PII boundary for HR data.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * @clolry: "I need for you to ensure that the PII information in the HR
 * database is properly secured and restricted to comply with IT security
 * requirements for PII."
 *
 * THE EXPOSURE, MEASURED
 * ----------------------
 * Apps Script makes EVERY top-level function callable from any authenticated
 * browser — finding G-001, 412 functions. Seven of them read HC data and
 * perform no authorization check at all:
 *
 *   getHCStaffingBundle          the whole roster, every field
 *   getSubmitterInfo             one person, by email
 *   getTravelFormStaffing        roster subset for the form
 *   getAASOrgScope               org structure
 *   loadOrgLookups               org structure
 *   diagHcData                   diagnostic dump
 *   forceRefreshHCStaffingBundle cache rebuild, returns the bundle
 *
 * Executed against a stub roster, `getHCStaffingBundle()` returns per person:
 * employee ID, full name, email address, GS grade, duty-station street
 * address, supervisory status and LCAT. No role is required. Any user who can
 * open the app can call it from the browser console.
 *
 * That is ~1100 people's records once the real FAS feed lands, and GS grade
 * plus name is effectively salary disclosure.
 *
 * WHAT THIS FILE DOES
 * -------------------
 * One function — hcSanitizeForCaller — that reduces an HC record to what the
 * CALLER is entitled to see. Three tiers:
 *
 *   PUBLIC     name, title, org, city/state. What a directory shows.
 *   REVIEWER   adds email, because a reviewer has to contact a traveler.
 *   ADMIN      everything, because the roster editor has to edit it.
 *
 * WHY TIERS RATHER THAN A SINGLE GATE
 * -----------------------------------
 * A single admin-only gate would be simpler and would break the application:
 * the travel form needs names and org codes to let a submitter pick
 * travelers, and routing needs the supervisor chain. Locking HC to admins
 * would mean nobody could file a request.
 *
 * So the question is not "may this caller read HC" but "which FIELDS". That is
 * also what a PII review asks — minimum necessary, not all-or-nothing.
 *
 * WHAT IS NEVER RETURNED TO A NON-ADMIN
 * -------------------------------------
 *   employeeId      a cross-system identifier. Its disclosure value is that
 *                   it joins to payroll and HR systems this app does not own
 *   grade           name + grade is salary. A travel tool has no business
 *                   publishing it, and it is excluded from the org chart for
 *                   the same reason
 *   duty address    a street address. City and state are enough for travel
 *   lcat            contract labour category, which implies employment status
 *
 * The org chart project reached the same conclusion independently and strips
 * the same fields — see orgchart_app/server/20_data/HCRead.js.
 */

/** Fields a signed-in user with no privileged role may see. */
var HC_FIELDS_PUBLIC = [
  'positionNumber',          // the org-chart join key, not personal
  'reportsToPositionNumber',
  'employeeName',
  'orgCode',
  'officeTitle',
  'occupancyStatus',
  'supervisoryStatus'        // needed to find a supervisor for routing
];

/** Additionally visible to a reviewer or above. */
var HC_FIELDS_REVIEWER = [
  'emailAddress'             // a reviewer must be able to contact a traveler
];

/**
 * Fields NEVER returned below admin. Each is listed with the reason, because
 * a future reader will otherwise assume the omission was an oversight and
 * "fix" it.
 */
var HC_FIELDS_ADMIN_ONLY = [
  'employeeId',   // joins to payroll/HR systems this app does not own
  'grade',        // name + grade is salary disclosure
  'lcat',         // implies employment status (contractor vs federal)
  'locationCode'  // internal facility code; city/state is enough for travel
];

/**
 * The caller's PII tier.
 *
 * Derived from roles, never passed in. A tier parameter would be the first
 * thing an attacker set — and the first thing a careless caller got wrong.
 *
 * @param {string} [email] defaults to the active user
 * @returns {{tier: string, email: string, isAdmin: boolean}}
 */
function hcCallerTier(email) {
  var who = email;
  if (!who) {
    try {
      who = Session.getActiveUser().getEmail() || '';
    } catch (e) {
      who = '';
    }
  }
  who = String(who || '').toLowerCase();

  // No identifiable user gets the narrowest tier, not an error. Apps Script
  // can return an empty email for a legitimately signed-in user in some
  // deployment configurations, and failing closed on data the travel form
  // needs would break submission for everyone.
  if (!who) return { tier: 'public', email: '', isAdmin: false };

  var isAdmin = false;
  try {
    isAdmin = (typeof isTravelAdmin === 'function') && isTravelAdmin(who);
  } catch (e) {
    console.error('hcCallerTier: admin check failed: ' + e.message);
  }
  if (isAdmin) return { tier: 'admin', email: who, isAdmin: true };

  // Reviewer tier: any active reviewer role. Read through the same unified
  // role resolution the access gate uses, so a role granted one way is not
  // invisible here.
  var isReviewer = false;
  try {
    if (typeof _getUnifiedRolesForEmail === 'function') {
      var roles = _getUnifiedRolesForEmail(who) || [];
      for (var i = 0; i < roles.length; i++) {
        var rt = String(roles[i].roleType || '');
        if (rt.indexOf('reviewer') > -1 || rt === 'sector_override') {
          isReviewer = true;
          break;
        }
      }
    }
  } catch (e) {
    console.error('hcCallerTier: reviewer check failed: ' + e.message);
  }

  return { tier: isReviewer ? 'reviewer' : 'public', email: who, isAdmin: false };
}

/**
 * Reduces one HC record to the caller's tier.
 *
 * Builds a NEW object from an allow-list rather than deleting from a copy.
 * A deny-list means a field added to HC_Positions tomorrow is exposed by
 * default — which is how this kind of leak happens. With an allow-list a new
 * field is invisible until someone decides it should not be.
 *
 * @param {Object} rec a normalized HC position
 * @param {string} tier 'public' | 'reviewer' | 'admin'
 * @returns {Object}
 */
function hcSanitizeRecord(rec, tier) {
  if (!rec) return null;
  if (tier === 'admin') return rec;

  var allowed = HC_FIELDS_PUBLIC.slice();
  if (tier === 'reviewer') allowed = allowed.concat(HC_FIELDS_REVIEWER);

  var out = {};
  allowed.forEach(function (f) {
    if (f in rec) out[f] = rec[f];
  });

  // Org attribution is not personal and every consumer needs it.
  if (rec.org) {
    out.org = {
      businessUnit: rec.org.businessUnit || '',
      sector: rec.org.sector || '',
      division: rec.org.division || '',
      officeCode: rec.org.officeCode || '',
      resolvedOrgCode: rec.org.resolvedOrgCode || ''
    };
  }

  // City and state only. The street address is withheld: it is a physical
  // location for a named individual, and travel needs the city.
  if (rec.location) {
    out.location = {
      city: rec.location.city || '',
      state: rec.location.state || ''
    };
  }

  // Stated in the payload so a consumer can tell a withheld field from a
  // blank one. Without this, "no email" and "not allowed to see the email"
  // are indistinguishable — the same mistake as zero-versus-unknown in the
  // event history.
  out._piiTier = tier;

  return out;
}

/**
 * Sanitizes a whole bundle for the active caller.
 *
 * @param {Object} bundle { success, data: [...], orgs: [...] }
 * @param {string} [email]
 * @returns {Object} same shape, reduced
 */
function hcSanitizeBundle(bundle, email) {
  if (!bundle || !bundle.success) return bundle;
  var t = hcCallerTier(email);
  if (t.tier === 'admin') return bundle;

  var out = {
    success: true,
    data: (bundle.data || []).map(function (r) {
      return hcSanitizeRecord(r, t.tier);
    }),
    // Org records carry no personal data.
    orgs: bundle.orgs || [],
    _piiTier: t.tier,
    _piiNote: 'Fields withheld for this caller: ' + HC_FIELDS_ADMIN_ONLY.join(', ') +
              (t.tier === 'public' ? ', emailAddress' : '') +
              ', duty-station street address.'
  };
  return out;
}

/**
 * Logs an HC read that returned PII, for the audit trail a PII review wants.
 *
 * Writes to Access_Log, which already exists for site-access decisions
 * (G-008). Reusing it rather than adding a table keeps one place to look.
 *
 * Failures are swallowed: an audit write that breaks the read it is auditing
 * would be worse than a missing log line.
 *
 * @param {string} fn the function that served the data
 * @param {string} tier
 * @param {number} recordCount
 */
function hcLogPiiAccess(fn, tier, recordCount) {
  // Only ADMIN reads are logged. A public-tier read returns directory-level
  // data to every user on every page load, and logging those would bury the
  // entries that matter under thousands that do not.
  if (tier !== 'admin') return;
  try {
    var db = new TravelDB();
    if (!db.sheet(SHEET_NAMES.ACCESS_LOG)) return;
    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.ACCESS_LOG];
    // Keys match the REAL Access_Log schema. Written as a header-keyed record
    // and mapped below, never as a positional array — writes here are
    // positional and an invented column name silently lands nowhere.
    var rec = {
      'Log_ID': 'pii_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      'Timestamp': new Date(),
      'Email': Session.getActiveUser().getEmail() || '',
      'Decision': 'PII_READ',
      'Path': fn,
      'Detail': recordCount + ' full HC record(s) returned at tier ' + tier
    };
    db.appendRow(SHEET_NAMES.ACCESS_LOG,
      headers.map(function (h) { return h in rec ? rec[h] : ''; }));
  } catch (e) {
    console.warn('hcLogPiiAccess: could not write audit row: ' + e.message);
  }
}
