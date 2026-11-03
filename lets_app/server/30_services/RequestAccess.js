/**
 * RequestAccess.js
 * Who may read a travel request.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * @clolry: "Reduce the exposure on getRequestForReview to at or below TRIP's
 * HC exposure."
 *
 * THE EXPOSURE, MEASURED
 * ----------------------
 * `getRequestForReview(requestId)` contains NO authorization check of any
 * kind. It computes a `permissions` object — isCurrentReviewer, isSubmitter,
 * availableActions — and returns it ALONGSIDE the data. The permissions are
 * advisory, used by the client to decide which buttons to draw. Nothing gates
 * the payload on them.
 *
 * So any signed-in user who knows a request ID receives:
 *
 *   request       submitter name/email, all four reviewer names and emails,
 *                 BLUF, justification, every cost figure
 *   travelers     per traveller: employee ID, name, email, LCAT, division
 *                 director name and email, security clearance held, valid
 *                 passport held, full-time telework status, normal commute
 *                 distance, home parking cost, NFS receipt
 *   legs          every destination and date
 *   attachments   file IDs, which `shareAttachmentsWithUsers` will then grant
 *                 anybody access to — also ungated
 *   approvalLog   every decision, comment and reviewer
 *
 * And request IDs are SEQUENTIAL — REQ-2026-0001, L27-0001, L27-0002 — so
 * enumeration is a loop, not an attack.
 *
 * That is finding G-004, rated C4/R3. Security clearance and passport status
 * are a materially worse disclosure than anything in the HC bundle.
 *
 * THE BAR @clolry SET
 * -------------------
 * "At or below TRIP's HC exposure" — which, after HCPrivacy.js, is: a
 * signed-in user with no role sees directory-level fields only, and the
 * sensitive ones are withheld by allow-list rather than removed by deny-list.
 *
 * Meeting that bar here needs two different things, because a request is not
 * a directory entry:
 *
 *   1. AUTHORIZATION. Most users have no business reading most requests at
 *      all. A directory is public within the organisation; a travel request
 *      is not.
 *   2. FIELD REDUCTION for the cases where read access is legitimate but
 *      total disclosure is not.
 *
 * WHO MAY READ A REQUEST
 * ----------------------
 *   the submitter          they wrote it
 *   a traveller on it      it is their trip, their clearance, their commute
 *   the current reviewer   they have to act on it
 *   any PRIOR reviewer     they already acted and may need to justify it
 *   a scoped reviewer      within their BU or sector, per getReviewerContext
 *   an admin               everything
 *
 * Anyone else is refused. Not reduced — refused. A travel request is not a
 * public record, and returning a redacted version to an unrelated user would
 * still confirm the request exists and who is on it.
 */

/**
 * Decides whether the active user may read a request, and at what depth.
 *
 * TAKES THE ALREADY-LOADED ROWS rather than re-reading them. The caller has
 * them in hand, and a second read would double the cost of every review page
 * load for no benefit.
 *
 * @param {Object} request a normalized request record
 * @param {Array<Object>} travelers its traveller rows
 * @param {Array<Object>} approvalLog its approval log entries
 * @param {string} [email] defaults to the active user
 * @returns {{allowed: boolean, basis: string, depth: string, reason: string}}
 *          depth is 'full' | 'redacted'
 */
function requestReadAccess(request, travelers, approvalLog, email) {
  var who = email;
  if (!who) {
    try {
      who = Session.getActiveUser().getEmail() || '';
    } catch (e) {
      who = '';
    }
  }
  who = String(who || '').toLowerCase();

  // No identifiable user reads nothing. Unlike the HC directory — where
  // failing closed would break the travel form for everyone — nothing
  // legitimate needs an anonymous request read.
  if (!who) {
    return { allowed: false, basis: 'none', depth: 'redacted',
             reason: 'Could not determine the active user.' };
  }

  var req = request || {};

  // ADMIN — everything, and logged.
  try {
    if (typeof isTravelAdmin === 'function' && isTravelAdmin(who)) {
      return { allowed: true, basis: 'admin', depth: 'full', reason: '' };
    }
  } catch (e) {
    console.error('requestReadAccess: admin check failed: ' + e.message);
  }

  var lower = function (v) { return String(v || '').toLowerCase(); };

  // SUBMITTER — they wrote it.
  if (lower(req.submitterEmail) === who) {
    return { allowed: true, basis: 'submitter', depth: 'full', reason: '' };
  }

  // A TRAVELLER ON THE REQUEST. This matters more than it looks: the
  // traveller rows hold THEIR security clearance, passport status, telework
  // status and home commute. A person is entitled to see their own.
  var isTraveler = (travelers || []).some(function (t) {
    return lower(t.email) === who;
  });
  if (isTraveler) {
    return { allowed: true, basis: 'traveler', depth: 'full', reason: '' };
  }

  // CURRENT REVIEWER — they have to act on it.
  if (lower(req.currentReviewerEmail) === who) {
    return { allowed: true, basis: 'current-reviewer', depth: 'full', reason: '' };
  }

  // A NAMED REVIEWER anywhere in the chain. A sector director or BU reviewer
  // named on the request will be asked to act on it, or already has.
  if (lower(req.sectorDirectorEmail) === who ||
      lower(req.buReviewerEmail) === who) {
    return { allowed: true, basis: 'named-reviewer', depth: 'full', reason: '' };
  }

  // A PRIOR REVIEWER. They already acted and may need to justify that
  // decision later. Excluding them would mean a reviewer could not see what
  // they themselves approved once the request moved on — which is both
  // unhelpful and bad for an audit.
  var actedOnIt = (approvalLog || []).some(function (entry) {
    return lower(entry.actionByEmail) === who;
  });
  if (actedOnIt) {
    return { allowed: true, basis: 'prior-reviewer', depth: 'full', reason: '' };
  }

  // A SCOPED REVIEWER — within their BU or sector. Reuses getReviewerContext
  // so the scope rules live in one place; a second implementation here would
  // drift from the dashboards.
  try {
    if (typeof getReviewerContext === 'function') {
      var ctx = getReviewerContext(who) || {};
      var scope = ctx.scope || {};

      if (scope.type === 'all' && ctx.role && ctx.role !== 'none') {
        // OSO and equivalent: organisation-wide review authority.
        return { allowed: true, basis: 'reviewer-scope-all', depth: 'full', reason: '' };
      }

      var codes = (scope.codes || []).map(function (c) { return String(c).toUpperCase(); });
      var names = (scope.names || []).map(function (n) { return String(n).toUpperCase(); });
      var reqOrg = String(req.submitterOrgCode || '').toUpperCase();
      var reqBu = String(req.submitterBU || '').toUpperCase();

      // Prefix match, because org codes are hierarchical: a reviewer scoped
      // to FCA must see a request from FCA0A.
      var inScope = codes.some(function (c) { return c && reqOrg.indexOf(c) === 0; }) ||
                    names.some(function (n) { return n && reqBu === n; });
      if (inScope) {
        return { allowed: true, basis: 'reviewer-scope', depth: 'full', reason: '' };
      }
    }
  } catch (e) {
    // A failing scope lookup must DENY, not allow. The HC directory could
    // degrade to a narrower tier because something harmless remained; here
    // the only safe degradation is refusal.
    console.error('requestReadAccess: scope check failed: ' + e.message);
  }

  return {
    allowed: false, basis: 'none', depth: 'redacted',
    reason: 'You do not have access to this request. Only its submitter, its ' +
            'travellers, its reviewers and administrators can view it.'
  };
}

/**
 * Fields stripped from a traveller row for a caller who is NOT that traveller.
 *
 * Reachable only by someone already entitled to read the request — a reviewer
 * or the submitter. They are still not entitled to everything.
 *
 * Each of these answers a question about a person rather than about the trip:
 *
 *   employeeId               joins to payroll and HR systems
 *   hasSecurityClearance     a security attribute of the individual
 *   hasValidPassport         likewise
 *   isFullTimeTelework       an employment arrangement
 *   normalCommuteDistance    implies where they live
 *   normalCommuteParking     likewise
 *   receivingNFS             non-federal source receipt; a conduct matter
 *   lcat                     implies federal vs contractor status
 *
 * A REVIEWER LEGITIMATELY NEEDS SOME OF THESE. Clearance and passport bear on
 * whether a person can attend a classified or foreign event; commute figures
 * feed the local-travel calculation. So they are retained for the CURRENT
 * reviewer and for admins, and withheld from everyone else — including
 * reviewers further down the chain who have not been asked to act yet.
 */
var REQUEST_TRAVELER_SENSITIVE = [
  'employeeId', 'hasSecurityClearance', 'hasValidPassport',
  'isFullTimeTelework', 'normalCommuteDistance', 'normalCommuteParking',
  'receivingNFS', 'lcat'
];

/**
 * Reduces traveller rows for the caller.
 *
 * @param {Array<Object>} travelers
 * @param {string} basis from requestReadAccess
 * @param {string} email the active user
 * @returns {Array<Object>}
 */
function sanitizeTravelersForCaller(travelers, basis, email) {
  var who = String(email || '').toLowerCase();

  // The people who need the full picture to do their job.
  if (basis === 'admin' || basis === 'current-reviewer') return travelers || [];

  return (travelers || []).map(function (t) {
    // A traveller always sees their OWN row in full. It is their clearance,
    // their passport, their commute.
    if (String(t.email || '').toLowerCase() === who) return t;

    var out = {};
    Object.keys(t).forEach(function (k) {
      if (REQUEST_TRAVELER_SENSITIVE.indexOf(k) === -1) out[k] = t[k];
    });
    // Said explicitly, so a consumer can tell a withheld field from an empty
    // one — the same reason the HC bundle carries _piiTier.
    out._redacted = REQUEST_TRAVELER_SENSITIVE.slice();
    return out;
  });
}

/**
 * Logs a request read that was refused.
 *
 * REFUSALS are logged, not successes. A successful read happens constantly in
 * normal use; a refusal means somebody asked for a request they have no
 * relationship to, and with sequential IDs that is what enumeration looks
 * like.
 *
 * @param {string} requestId
 * @param {string} email
 * @param {string} reason
 */
function logRequestAccessDenial(requestId, email, reason) {
  try {
    var db = new TravelDB();
    if (!db.sheet(SHEET_NAMES.ACCESS_LOG)) return;
    var headers = TRAVEL_SHEET_SCHEMAS[SHEET_NAMES.ACCESS_LOG];
    var rec = {
      'Log_ID': 'deny_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      'Timestamp': new Date(),
      'Email': email || '',
      'Decision': 'REQUEST_DENIED',
      'Path': 'getRequestForReview',
      'Detail': 'Refused ' + requestId + ': ' + reason
    };
    db.appendRow(SHEET_NAMES.ACCESS_LOG,
      headers.map(function (h) { return h in rec ? rec[h] : ''; }));
  } catch (e) {
    // An audit write must never break the refusal it is recording.
    console.warn('logRequestAccessDenial: ' + e.message);
  }
}
