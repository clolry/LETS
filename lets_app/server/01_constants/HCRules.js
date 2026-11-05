/**
 * HCRules.js
 *
 * The HR roster's two vocabularies, and the predicates that read them.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `String(p.supervisoryStatus) !== '2'` appeared at FOURTEEN sites across
 * eight files, in four different load tiers — 20_data, 30_services, 40_domain
 * and 99_triggers. Two of those sites decide who can sign in to LETS at all;
 * one decides who approves travel; the rest feed diagnostics and dashboards
 * that are supposed to EXPLAIN the first three.
 *
 * Fourteen copies of a rule is fourteen chances to update thirteen of them.
 * The project already has that scar: the "sector director" title match lived
 * at five sites and all five were wrong together, for weeks, because nothing
 * said they were the same rule.
 *
 * So the rule lives here, once, in 01_constants — which loads before every
 * tier that needs it and depends on nothing itself.
 *
 * WHAT MEASUREMENT CHANGED
 * ------------------------
 * diagnoseHrFeedSource against the live FC workforce report, 1,046 rows, with
 * the feed's own description column beside each code:
 *
 *   2  167  Supervisor or Manager
 *   4    6  Supervisor (CSRA)
 *   5    1  Management Official (CSRA)
 *   7    6  Team Leader
 *   8  866  Non-Supervisory
 *
 * The old rule admitted only code 2, which excluded thirteen people whose own
 * HR record calls them a supervisor, a management official or a team leader.
 *
 * @clolry: "it was ok to count all of the numbers except 8 as supervisors and
 * keep 8 as non-supervisor."
 *
 * He is right, and the description column is why: 'Supervisor (CSRA)' and
 * 'Management Official (CSRA)' are supervisors under a different statutory
 * definition, not lesser ones. Excluding them is how FCA0A ended up with no
 * Service Center Director — Taylor Wynings holds one of those codes.
 *
 * INVERTED ON PURPOSE: EXCLUDE 8, DO NOT ENUMERATE THE REST
 * ---------------------------------------------------------
 * The predicate asks "is this NOT code 8", not "is this one of 2, 4, 5, 7".
 *
 * An allow-list would silently drop a code HR adds later — a code 3 or 6
 * appears, nobody notices, and some new supervisor cannot sign in. That is
 * precisely the failure being fixed, re-created in a narrower form.
 *
 * The deny-list fails the other way: an unknown code is treated as
 * supervisory, which grants access rather than withholding it. That is the
 * right direction for THIS field, because the alternative is a real
 * supervisor silently locked out of the system with no error to point at —
 * and because site access is not the only gate. HCAdmin.validateHCPosition
 * reports an unrecognized code, and getSupervisoryCodeCensus below exists so
 * a new value is visible rather than inferred.
 */

/**
 * The supervisory-status vocabulary, as measured on the live feed.
 *
 * Descriptions are the feed's own 'Supervisor Level Desc.' column, not my
 * paraphrase — so a reader can check the mapping against the source rather
 * than taking it on trust.
 */
var HC_SUPERVISORY_CODES = {
  '2': { supervisory: true,  desc: 'Supervisor or Manager' },
  '4': { supervisory: true,  desc: 'Supervisor (CSRA)' },
  '5': { supervisory: true,  desc: 'Management Official (CSRA)' },
  '7': { supervisory: true,  desc: 'Team Leader' },
  '8': { supervisory: false, desc: 'Non-Supervisory' }
};

/** The one code that means "not a supervisor". Everything else does. */
var HC_NON_SUPERVISORY_CODE = '8';

/**
 * Whether a supervisory-status code means this person supervises anyone.
 *
 * THE RULE: anything other than 8. See the file header for why this is a
 * deny-list rather than an allow-list.
 *
 * A BLANK IS NOT SUPERVISORY. 225 live rows are vacant seats and many carry
 * no status at all; treating blank as supervisory would make every empty seat
 * a potential Service Center Director and grant nothing useful. A blank means
 * "unknown", and unknown is not a claim to supervise.
 *
 * COMPARED AS A STRING, after stripping a trailing '.0'. Sheets coerces a
 * cell holding 2 to the NUMBER 2, and a feed read can yield '2.0'. HCData
 * normalizes at the read boundary, but this is called from diagnostics that
 * read raw rows too, so it normalizes defensively rather than assuming.
 *
 * @param {*} code the Supervisory_Status value
 * @returns {boolean}
 */
function isHcSupervisoryCode(code) {
  if (code === null || code === undefined) return false;
  var s = String(code).trim().replace(/\.0+$/, '');
  if (!s) return false;
  return s !== HC_NON_SUPERVISORY_CODE;
}

/**
 * Whether a position's occupant is actually in the seat.
 *
 * Shared because the access gate and the Service Center Director lookup must
 * agree: a seat nobody occupies cannot sign in and cannot approve travel.
 *
 * ONLY VACANT MEANS NOBODY IS THERE. An OBLIGATED row with a name and an
 * address is a REAL, REACHABLE PERSON.
 *
 * I had this wrong, in this function, one commit after fixing the identical
 * mistake in the headcount. The first version excluded OBLIGATED and
 * justified it as "the occupant is working elsewhere, so THAT row is where
 * they sign in and approve from" — which is true of the eleven people who
 * hold both a TEMP PROMOTION row and an OBLIGATED one, and false of everyone
 * else.
 *
 * Measured on the live feed: 19 OBLIGATED rows against 11 TEMP PROMOTION
 * rows. At least eight people have ONLY an obligated row, so there is no
 * other row for them to be found at. @clolry, twice: "Scott Eberle is acting
 * as the supervisor for FCC0C."
 *
 * WHAT THE EXCLUSION ACTUALLY DID, measured against @clolry's live run:
 *
 *   FCC0C had three candidates — Chong (FILLED, grade 14, "Lead Acquisition
 *   Program Management Specialist"), Eberle (OBLIGATED, grade 15,
 *   "Acquisition Manager") and a vacancy. Filtering OBLIGATED removed Eberle
 *   BEFORE the highest-grade tie-break could run, so the center resolved to
 *   Chong.
 *
 * That is worse than resolving to nobody. Routing would have sent the
 * center's travel to someone who is not its approver and looked like it was
 * working. The retired grade-15 check had been masking it by rejecting Chong
 * too; dropping that check is what exposed it.
 *
 * SO THIS NOW DIFFERS FROM THE HEADCOUNT RULE ONLY IN WHAT IT IS ASKING:
 *
 *   headcount   which ONE seat represents a person, so nobody is counted
 *               twice (HCData.hcCountableByPerson prefers the
 *               non-obligated row when there is one)
 *   presence    whether there is a person in this seat at all, which an
 *               obligated seat with an occupant plainly has
 *
 * A NAME IS REQUIRED, and that is the test doing the real work. The live feed
 * carries 225 rows with no name, of which only 207 say VACANT — the other 18
 * are authorized-but-empty seats whose status column reads APPROVED. Trusting
 * the status alone would make all 18 look occupied.
 *
 * @param {Object} position an HC bundle record or roster row
 * @returns {boolean}
 */
function isHcSeatOccupied(position) {
  if (!position) return false;
  var occ = String(position.occupancyStatus || '').trim().toUpperCase();
  if (occ === 'VACANT') return false;
  return !!String(position.employeeName || '').trim();
}

/**
 * Whether this position's occupant is reachable for approval or sign-in.
 *
 * Presence plus a working address. Separated from isHcSeatOccupied because
 * the two failures need different words: a seat with nobody in it is a
 * VACANCY, and a seat whose occupant has no address in the roster is a DATA
 * GAP somebody can fix.
 *
 * @clolry's live run shows five of the 22 centers with a director lacking an
 * address — four of those are vacant seats, so the only real gap is the one
 * the diagnostic names.
 *
 * @param {Object} position
 * @returns {boolean}
 */
function isHcPositionReachable(position) {
  if (!isHcSeatOccupied(position)) return false;
  return !!String(position.emailAddress || '').trim();
}

/**
 * Compares two grades for seniority. Returns > 0 when `a` is more senior.
 *
 * THE TIE-BREAK FOR A SERVICE CENTER WITH MORE THAN ONE SUPERVISOR.
 *
 * @clolry: "when a conflict exists with two 'supervisors' in the same
 * workgroup you can choose the one that is the higher grade."
 *
 * Measured need: diagServiceCenterDirectors found FCA0E with three
 * supervisory rows and FCC0B with two. In both cases the extras were VACANT
 * seats, so filtering unoccupied rows resolved them — but a real tie is one
 * reorganization away, and the old code returned whichever row came first in
 * bundle order, which is NONDETERMINISTIC across re-imports. A service
 * center's approver changing because HR re-sorted a sheet is not acceptable.
 *
 * SES OUTRANKS EVERY NUMBER. HCRosterImport substitutes the pay plan for an
 * SES row's grade, because '00' is the absence of a grade rather than a grade
 * and would otherwise sort below GS-01. So 'ES' and 'SES' are treated as
 * above 15 — there are 7 ES rows on the live roster and a DAC is one of them.
 *
 * A NON-NUMERIC, NON-SES GRADE SORTS LOWEST rather than throwing. 'VT-03' is
 * a real value in this data. Sorting it last is a judgment, and the honest
 * one: an unparseable grade is not evidence of seniority.
 *
 * @param {*} a
 * @param {*} b
 * @returns {number} positive if a is senior, negative if b is, 0 if equal
 */
function compareHcGrade(a, b) {
  function rank(g) {
    var s = String(g === null || g === undefined ? '' : g).trim().toUpperCase();
    if (!s) return -1;
    if (s === 'ES' || s === 'SES') return 100;      // above any GS grade
    var n = parseInt(s.replace(/\.0+$/, ''), 10);
    if (isNaN(n)) return -1;                        // VT-03 and friends
    return n;
  }
  return rank(a) - rank(b);
}

/**
 * Counts the supervisory codes present in a roster.
 *
 * EXISTS BECAUSE THE PREDICATE IS A DENY-LIST. `isHcSupervisoryCode` treats
 * an unknown code as supervisory, which is the right direction to fail but
 * means a code HR invents tomorrow would be absorbed silently. This makes the
 * vocabulary visible, so "HR added a code" is a fact somebody reads rather
 * than a change in who can approve travel.
 *
 * @param {Array} positions
 * @returns {{counts: Object, unknown: Object, supervisory: number,
 *            nonSupervisory: number, blank: number}}
 */
function hcSupervisoryCodeCensus(positions) {
  var out = {
    counts: {}, unknown: {},
    supervisory: 0, nonSupervisory: 0, blank: 0
  };
  (positions || []).forEach(function (p) {
    if (!p) return;
    var raw = p.supervisoryStatus;
    var s = String(raw === null || raw === undefined ? '' : raw)
      .trim().replace(/\.0+$/, '');
    var key = s || '(blank)';
    out.counts[key] = (out.counts[key] || 0) + 1;

    if (!s) { out.blank++; return; }
    if (!HC_SUPERVISORY_CODES[s]) {
      out.unknown[s] = (out.unknown[s] || 0) + 1;
    }
    if (isHcSupervisoryCode(s)) out.supervisory++;
    else out.nonSupervisory++;
  });
  return out;
}

// Node/CommonJS export for the test suites. Inert in Apps Script, where these
// are plain globals.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HC_SUPERVISORY_CODES: HC_SUPERVISORY_CODES,
    HC_NON_SUPERVISORY_CODE: HC_NON_SUPERVISORY_CODE,
    isHcSupervisoryCode: isHcSupervisoryCode,
    isHcSeatOccupied: isHcSeatOccupied,
    isHcPositionReachable: isHcPositionReachable,
    compareHcGrade: compareHcGrade,
    hcSupervisoryCodeCensus: hcSupervisoryCodeCensus
  };
}
