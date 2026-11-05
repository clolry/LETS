/**
 * HCRosterImport.js
 * Loads the real HR roster from the FAS HRLinks feed into HC_Positions.
 *
 * WHY THIS EXISTS
 * ---------------
 * HC_Positions holds 16 fictional people. They were written by
 * 91_setup/HCSeed.js as a test fixture — Marguerite Okonkwo, Desmond Whitaker,
 * Priya Raghunathan and thirteen others, all @example.gov — and they are what
 * the per-capita budget split, the org chart and the supervisor-based access
 * gate are currently reading.
 *
 * @clolry: "please make sure that when we seed the HR roster that we remove ALL
 * test records and are relying only on the sheet identified in the system
 * properties and completely ignore my sheet from May."
 *
 * THE ERROR THAT PROMPTED THIS, RECORDED BECAUSE IT WAS MINE
 * ---------------------------------------------------------
 * I reported Melissa Mould as unattributable to any org. I had been reading
 * reference_excel_files/Copy of ASD Staffing Plan 5-12-26.xlsx — a May export —
 * which places her in FCBBB at supervisory status 8. The FAS HR feed has her in
 * FCBBBB as a status-2 supervisor.
 *
 * The consequence was not one wrong row. Every per-capita service-center figure
 * reported before this module existed was computed from that stale file: 807
 * filled positions, 22 service-center shares, every dollar allocation. A roster
 * six months out of date produces allocations that look precise and are wrong,
 * which is worse than an obvious gap because nobody checks a confident number.
 *
 * So this module has exactly one source — Props.getFasHrFeedSource(), reading
 * the FAS_HRLinks_Feed Script Property — and NO fallback. Not to a bundled
 * file, not to the May spreadsheet, not to the seed data. An unset property is
 * a hard error, because every available fallback is a stale roster.
 *
 * WHY THE COLUMN MAPPING IS PROPOSED AND NOT ASSUMED
 * --------------------------------------------------
 * The FAS HRLinks feed's exact headers are not known here, and guessing wrong
 * is not a visible failure — it is a roster where Supervisory_Status came from
 * the wrong column, which silently grants or denies LETS access to several
 * hundred people (Access.js:416 reads that field to decide site access).
 *
 * So proposeMapping guesses from a list of plausible header spellings, reports
 * what it matched and what it could not, and the import REFUSES to run when a
 * required field is unmapped. GogovSync.proposeMapping does the same thing for
 * the same reason and the comment there says so: "PROPOSES, never decides."
 *
 * WHY THIS REPLACES RATHER THAN MERGES
 * ------------------------------------
 * A merge would leave the 16 fictional people in place, since nothing in the
 * feed matches them. @clolry asked for ALL test records removed, and a
 * fictional employee in a system that sends email and grants access is a
 * liability rather than a tidiness problem.
 *
 * But a replace that silently drops real rows is worse than a stale roster, so
 * previewRosterImport is a dry run that reports exactly what would be added,
 * changed and deleted, and importRoster refuses unless the caller passes the
 * preview's own token back. That is the same confirm-then-act shape the
 * existing-travel importer uses.
 */

var HCRosterImport = (function () {

  function _str_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  /**
   * Header spellings for each field we need, best guess first.
   *
   * An HR export will not use LETS's internal column names, and the same
   * concept is spelled several ways across government HR exports. Matched
   * case-insensitively and whitespace-collapsed, because ' Authorization
   * Submitted' in the travel log proved that real headers carry stray spaces.
   *
   * WHITESPACE COLLAPSING IS LOAD-BEARING HERE, NOT A NICETY. The FC
   * workforce report wraps long headers inside the cell, so they arrive with
   * EMBEDDED NEWLINES: 'Employee\nID', 'Reports to\nPosition\nNumber',
   * 'Obligated To\nEmployee'. _norm_ turns any run of whitespace into one
   * space, so the hints below are written with single spaces and match
   * either form. Without that, four fields would silently fail to map.
   *
   * THE FC WORKFORCE REPORT'S HEADERS ARE LISTED FIRST in each array, with
   * the FAS HRLinks feed's spellings kept after them.
   *
   * WHY THE OLD SPELLINGS ARE KEPT. They cost nothing — proposeMapping stops
   * at the first match — and they are the record of what this code was
   * reading when the live numbers in SESSION_STATE.md were produced. A future
   * reader comparing a 1,046-position figure against a new import needs to
   * know the column it came from.
   *
   * THE FOUR THAT NEEDED THOUGHT ON THIS SOURCE:
   *
   *   'Employee Position Number'  the position key. The old feed's was
   *                               'Position#' with no space. Both are
   *                               present below.
   *   'Dept ID'                   the org code. There is ALSO a 'Dept. ID
   *                               2 Letter' column, which is a two-character
   *                               portfolio abbreviation and must never be
   *                               read as the org code — see orgCode below.
   *   'Supv Lvl'                  decides site access. See supervisoryStatus.
   *   'Position Status Type'      decides the budget denominator. See
   *                               occupancyStatus.
   *
   * THIS SOURCE HAS AN EMAIL COLUMN, which the FAS HRLinks feed did not.
   * 'Employee Email' is authoritative, so the directory name-matching
   * subsystem that existed to infer addresses has been deleted.
   */
  var FIELD_HINTS = {
    // 'Employee Position Number' is the FC report's header. 'Position#' (no
    // space) was the HRLinks one; the spaced variants are kept because an
    // export tool that pretty-prints headers would produce them.
    positionNumber: ['Employee Position Number', 'Position#', 'Position #',
                     'Position Number', 'Position # (PN)', 'Position #      (PN)',
                     'PN', 'Position Nbr', 'Position_Number', 'Position ID'],

    // A position number, which is what the supervisor walk joins on. Both
    // sources also carry a supervisor NAME column, and this source carries a
    // supervisor EMAIL column too — neither is used.
    //
    // A NAME IS NOT A KEY: two people can share one. An EMAIL is nearly a key
    // and still wrong for this purpose, because the thing being walked is a
    // tree of POSITIONS — HCData.hcWalkSupervisorChain follows
    // Position_Number -> Reports_To_Position_Number, and a vacant supervisory
    // seat has no occupant to have an address.
    reportsTo:      ['Reports to Position Number', 'Reports To Position #',
                     'Reports To Position Number', 'Supervisor Position Number',
                     'Reports To', 'Supervisor PN', 'Reports To PN',
                     'Supervisor Position'],

    employeeId:     ['Employee ID', 'Employee Id', 'EMPLID', 'Emp ID',
                     'Employee Number'],

    // 'Name' on this source, 'Employee Name' on the old one. Both kept.
    employeeName:   ['Name', 'Employee Name', 'Full Name', 'Employee'],

    // THE COLUMN THAT MADE THIS SOURCE WORTH SWITCHING TO.
    //
    // The FAS HRLinks feed had 33 columns and not one was an address, which
    // is why ~5,100 lines of directory name matching existed. Email_Address
    // is how LETS decides who someone IS:
    //
    //   Access.js:435-441   the HC supervisor access rule matches the
    //                       signed-in user against Email_Address
    //   Access.js:982       the Division Director lookup matches on email
    //   HCPrivacy.js:79     on the reviewer allow-list, so a reviewer can
    //                       contact a traveler
    //
    // @clolry: "the email address provided in this data source is definitive
    // and without question." So it is read straight through — no inference,
    // no override tab, no name matching.
    //
    // 'Reports to Supervisor Email' is NOT a candidate here and must not
    // become one: it is the SUPERVISOR's address on an employee's row, and
    // mapping it to emailAddress would give every person their boss's
    // identity.
    emailAddress:   ['Employee Email', 'Email Address', 'Email', 'Work Email',
                     'Email Addr', 'EMail', 'Business Email', 'GSA Email'],

    // 'Dept ID' is the org code: FCBBBB and friends.
    //
    // 'Dept. ID 2 Letter' is NOT used and is listed nowhere below. It is a
    // two-character portfolio abbreviation, so reading it as the org code
    // would collapse the entire roster into one bucket and make every
    // per-capita service-center share identical — a figure that looks precise
    // and is meaningless.
    //
    // 'POI' — the HRLinks equivalent — is also NOT used. A POI is a payroll
    // servicing code and several orgs share one, so keying budget attribution
    // off it would merge unrelated service centers.
    orgCode:        ['Dept ID', 'Dept ID (Org)', 'Org Code', 'Office Symbol',
                     'Organization', 'Org Symbol', 'Organizational Code'],

    officeTitle:    ['Position Title', 'Office Title', 'Title', 'Job Title'],

    // A PLAIN GRADE COLUMN, which this source has and the old one did not.
    //
    // HRLinks carried 'PP-Series-Grd' — 'GS-0343-15' in one field — and
    // parsePayPlanGrade split it, because three call sites compare grade to
    // the string '15' to find a Division Director and 'GS-0343-15' is not
    // '15'. This source separates PP, Occ Series and Grade into three
    // columns, so the composite path is no longer exercised by it.
    //
    // parsePayPlanGrade IS STILL APPLIED. A bare '15' falls through its final
    // branch to normalizeGrade, which is what zero-pads '7' to '07' — the
    // VT-03 defect. Dropping it for this source would reintroduce that.
    // 'PP-Series-Grd' stays in the hints below so a composite, if one ever
    // arrives, is still split rather than stored whole.
    grade:          ['Grade', 'PP-Series-Grd', 'PP-Series-Grade', 'Pay Grade',
                     'GS Grade', 'Grade Level'],

    // THE PAY PLAN, as its own column.
    //
    // Only present when the source splits what HRLinks combined. It exists
    // for one case: an SES row whose Grade cell is '00'. '00' is not a grade,
    // it is the ABSENCE of one, and storing it would be worse than storing
    // nothing because '00' sorts and compares as a real low grade — below
    // every GS-01. parsePayPlanGrade substitutes the pay plan for a composite
    // 'ES-0340-00', and interpretRow does the same for a split source using
    // this column.
    //
    // Never required and never written on its own. If the source has no PP
    // column, a '00' grade passes through as '00' and validateRow's grade
    // warning is the signal.
    payPlanOnly:    ['PP', 'Pay Plan'],

    // THE FIELD THAT GRANTS SITE ACCESS, so the mapping is a judgment worth
    // stating rather than a guess worth hiding.
    //
    // Access.js:435 admits anyone whose Supervisory_Status is '2'. The old
    // feed's column was 'Supv Status' and held HR's numeric codes. This
    // source has 'Supv Lvl' sitting beside 'Supervisor Level Desc.' — a code
    // and its human-readable expansion, which is the usual shape.
    //
    // 'Supervisor Level Desc.' is deliberately NOT a candidate. A description
    // is free text; normalizeSupervisoryStatus would pass 'Supervisor
    // (CSRA)' through unchanged, it would never equal '2', and every
    // supervisor would silently lose their only automatic route into LETS.
    //
    // diagnoseHrFeedSource prints the distinct values of BOTH columns with
    // counts, so this can be confirmed against the real sheet before an
    // import. validateRow also warns on any value outside {2,4,5,6,7,8}.
    supervisoryStatus: ['Supv Lvl', 'Supv Status', 'Supervisory Status', 'Supv',
                        'Supervisor Status', 'Supervisory Code'],

    // 'Position Status Type' on this source; 'Position Status' on the old one.
    //
    // THIS DECIDES THE PER-CAPITA DENOMINATOR. Both sources carry an
    // 'Obligated To' column, which only makes sense if this column can say
    // OBLIGATED — and in this vocabulary OBLIGATED is a person's PERMANENT
    // seat held open while they serve a temporary promotion elsewhere. The
    // same human also appears on the temp-promotion row, which is FILLED. See
    // normalizeOccupancy: counting OBLIGATED as filled double-counts six
    // people rather than finding six missing ones.
    //
    // The bare 'Status' is kept as a last resort for an unknown export, but
    // it is the WRONG column when a qualified one exists: 'Status' with no
    // qualifier is most likely the employee's personnel-action status
    // (Active/Separated), which would count a separated employee's seat as
    // filled.
    occupancyStatus: ['Position Status Type', 'Position Status',
                      'Occupancy Status', 'Work Status', 'Filled/Vacant',
                      'Status'],

    // A SECOND status column, read ONLY to detect disagreement with the
    // first, never as the occupancy source.
    //
    // The HRLinks feed had both 'Position Status' and a bare 'Status', and
    // occupancyDisagreement reported when they conflicted — which is how the
    // choice between them was checkable rather than asserted. The FC report
    // has no second status column, so this will not map and the cross-check
    // reports zero. That is correct and not a gap: there is nothing to
    // disagree with.
    secondaryStatus: ['Status'],

    // Who a position is obligated to. Its presence corroborates that the
    // occupancy column above is the position-level one.
    obligatedTo:     ['Obligated To', '"Obligated To" Employee Name',
                      'Obligated To Employee Name', 'Obligated To Employee'],

    // The occupational series. On this source it is its own column; on the
    // old one it came out of the PP-Series-Grd composite and interpretRow
    // fell back to it. Either way it lands in LCAT, where it is more useful
    // than the free-text labour category LETS has never populated.
    lcat:           ['Occ Series', 'LCAT', 'Labor Category',
                     'Occupational Series', 'Series'],

    locationCode:   ['Location Code', 'Duty Station Code', 'Location'],

    // 'Address Line 1' on this source. Admin-only in HCPrivacy — a street
    // address is never returned below admin, because city and state are
    // enough for travel.
    dutyAddress:    ['Address Line 1', 'Location Address',
                     'Duty Station Address', 'Duty Address', 'Address'],
    dutyCity:       ['Location City', 'Duty Station City',
                     'Location City (Duty Station)', 'Duty City', 'City'],
    dutyState:      ['Location State', 'Duty Station State', 'State',
                     'Duty State']
  };

  /**
   * Fields without which the import must not proceed.
   *
   * positionNumber     the join key for the entire supervisor chain. Without
   *                    it nothing routes and nothing resolves.
   * employeeName       a roster with no names cannot attribute travel.
   * orgCode            the budget attribution key. Without it every
   *                    per-capita figure is unattributed.
   *
   * reportsTo is NOT required, deliberately. Some feeds express hierarchy only
   * through org codes, and the org hierarchy in HC_Orgs is already stored
   * explicitly — so a roster without supervisor pointers still produces
   * correct budget attribution. It degrades the approval-routing walk and
   * `missingSupervisorChain` says so rather than blocking the import.
   */
  var REQUIRED_FIELDS = ['positionNumber', 'employeeName', 'orgCode'];

  /**
   * The org code prefix this deployment owns.
   *
   * THE FAS TAB IS ALL OF FAS, NOT ASD. 4,274 rows against ASD's ~914.
   * Without this filter the import would write roughly 3,360 non-ASD people
   * into HC_Positions, and the consequence is not merely wrong data:
   *
   *   Access.js:435   grants LETS access to ANYONE in HC_Positions whose
   *                   Supervisory_Status is '2'. Importing all of FAS would
   *                   silently admit several hundred supervisors from other
   *                   portfolios.
   *   hcGetOrgChartTree  publishes every imported name to a chart reachable by
   *                   any domain user with the link.
   *   the per-capita split  divides by filled headcount, so a denominator
   *                   four times too large makes every service-center
   *                   allocation meaningless.
   *
   * WHY A PREFIX AND NOT "RESOLVES AGAINST HC_Orgs"
   * -----------------------------------------------
   * The obvious filter is to drop any row whose org code is absent from
   * HC_Orgs. That would be wrong in a way that is hard to see: HCData's
   * resolveOrgByCode deliberately falls back to the nearest listed ANCESTOR by
   * prefix, so a real ASD person in a sub-org nobody has cataloged yet still
   * resolves — and validateRow treats an unlisted code as a WARNING for
   * exactly that reason.
   *
   * That tolerance is right for ASD codes and catastrophic for non-ASD ones.
   * Scope has to be decided on the prefix, before the resolve, or the
   * tolerance that protects ASD staff lets all of FAS in.
   *
   * CONFIGURABLE BECAUSE THIS WILL GROW. @clolry: "eventually we need to build
   * this for use across all 5 FAS portfolios, but for now we're focused on
   * getting it working for ASD/FC." So the prefix is a parameter with an ASD
   * default, not a literal buried in a condition — widening it later is a
   * config change rather than a hunt through the import path.
   */
  var DEFAULT_ORG_SCOPE = 'FC';

  /**
   * Is this org code within the scope this deployment owns?
   *
   * ANCHORED AT THE START, and the code must be the prefix itself or extend
   * it. A substring test would be wrong in both directions: 'XFC001' contains
   * 'FC' and is not ours, and an ASD code is always FC followed by more
   * letters.
   *
   * @param {string} orgCode
   * @param {string} [scope] defaults to 'FC'
   * @returns {boolean}
   */
  function isInScope(orgCode, scope) {
    var code = _str_(orgCode).toUpperCase();
    var prefix = _str_(scope || DEFAULT_ORG_SCOPE).toUpperCase();
    if (!code || !prefix) return false;
    return code.indexOf(prefix) === 0;
  }

  /** Collapses whitespace and lowercases, for header comparison. */
  function _norm_(h) {
    return _str_(h).toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Proposes a header -> field mapping.
   *
   * PROPOSES, never decides. A silently wrong guess on supervisoryStatus
   * changes who can sign in to LETS; on orgCode it misattributes every
   * dollar. The caller is shown the mapping and the unmapped remainder.
   *
   * @param {Array<string>} headers the feed's header row
   * @returns {{mapping: Object, index: Object, unmapped: Array,
   *            missing: Array}}
   */
  function proposeMapping(headers) {
    var hdrs = (headers || []).map(_str_);
    var mapping = {};
    var index = {};
    var used = {};

    Object.keys(FIELD_HINTS).forEach(function (field) {
      var hints = FIELD_HINTS[field];
      for (var i = 0; i < hints.length; i++) {
        var want = _norm_(hints[i]);
        for (var h = 0; h < hdrs.length; h++) {
          if (used[h]) continue;
          if (_norm_(hdrs[h]) === want) {
            mapping[field] = hdrs[h];
            index[field] = h;
            used[h] = true;
            return;
          }
        }
      }
    });

    return {
      mapping: mapping,
      index: index,
      unmapped: hdrs.filter(function (h, i) { return !used[i] && h; }),
      missing: REQUIRED_FIELDS.filter(function (f) { return !(f in mapping); })
    };
  }

  /**
   * Normalizes a supervisory-status value.
   *
   * THE FIELD THAT GRANTS SITE ACCESS. Access.js:416 treats '2' as supervisor
   * and that alone can admit someone to LETS, so a value that arrives as the
   * NUMBER 2 and is compared against the STRING '2' fails and silently denies
   * access. The May export carried both '8' and '8.0' for the same meaning —
   * 663 and 11 rows — which is what a spreadsheet does to a numeric column.
   *
   * So a trailing '.0' is stripped and the result is returned as a string.
   * Unrecognized codes are PRESERVED rather than blanked: HR owns this
   * vocabulary and inventing a default would be worse than carrying a value
   * validateRow will flag.
   */
  function normalizeSupervisoryStatus(v) {
    var s = _str_(v);
    if (!s) return '';
    s = s.replace(/\.0+$/, '');
    return s;
  }

  /**
   * Normalizes a grade to a zero-padded string.
   *
   * THE VT-03 DEFECT, from HCAdmin.validateHCPosition: a sheet cell holding 07
   * arrives as the number 7, String(7) is '07' to nobody, and every grade
   * comparison in LETS is a string comparison — including the GS-15 Division
   * Director lookup that approval routing depends on (HCData.js:669,
   * Access.js:133, Request.js:137 all compare against '15').
   *
   * Non-numeric grades (SES, ES, VT-03) pass through untouched.
   */
  function normalizeGrade(v) {
    var s = _str_(v);
    if (!s) return '';
    s = s.replace(/\.0+$/, '');
    if (/^\d$/.test(s)) return '0' + s;
    return s;
  }

  /**
   * Splits the FAS feed's 'PP-Series-Grd' composite.
   *
   * THE OLD FEED HAD NO GRADE COLUMN. It carried 'GS-0343-15' — pay plan,
   * occupational series, grade — in one field, and LETS needs the grade alone
   * because three call sites compare it to the string '15' to find a Division
   * Director for approval routing.
   *
   * Storing the composite in Grade would break all three silently: 'GS-0343-15'
   * is not '15', so every approval would route past its Division Director and
   * nothing would announce that it had happened.
   *
   * THE FC WORKFORCE REPORT SEPARATES THEM — PP, Occ Series and Grade are
   * three columns — so a bare '15' arrives and falls through to the final
   * branch. That branch is still doing necessary work: normalizeGrade is what
   * zero-pads '7' to '07', and skipping it for a "simple" column would
   * reintroduce the VT-03 defect. The composite branches are kept so a
   * combined field, if one ever arrives again, is still split.
   *
   * SES AND ES HAVE NO NUMERIC GRADE. 'ES-0340-00' is a Senior Executive, and
   * '00' is not a grade — it is the absence of one. Returning '00' would be
   * worse than returning the pay plan, because '00' sorts and compares as a
   * real low grade. So a 00 grade yields the PAY PLAN as the grade, which is
   * what the HCSeed fixture already does for its SES rows.
   *
   * ON A SPLIT SOURCE THAT SUBSTITUTION CANNOT HAPPEN HERE, because this
   * function only sees the grade cell and '00' alone carries no pay plan to
   * fall back to. interpretRow does it instead, using the separate PP column —
   * see payPlanOnly in FIELD_HINTS and the grade block in interpretRow.
   *
   * The series is kept and lands in LCAT, where it is more useful than the
   * free-text labour category LETS has never populated.
   *
   * @param {*} v the raw cell
   * @returns {{payPlan: string, series: string, grade: string}}
   */
  function parsePayPlanGrade(v) {
    var s = _str_(v).toUpperCase();
    if (!s) return { payPlan: '', series: '', grade: '' };

    // PP-SERIES-GRADE, e.g. GS-0343-15, ES-0340-00, WG-4749-08.
    var m = s.match(/^([A-Z]{2})[-\s]*(\d{3,4})[-\s]*(\d{1,2})$/);
    if (m) {
      var plan = m[1];
      var series = m[2];
      var grade = m[3];
      // '00' means no numeric grade — SES, ES, SV and similar.
      if (grade === '00' || grade === '0') {
        return { payPlan: plan, series: series, grade: plan };
      }
      return { payPlan: plan, series: series, grade: normalizeGrade(grade) };
    }

    // PP-GRADE with no series, e.g. 'VT-03'. HCAdmin's validator already
    // mentions VT-03 as a real shape.
    var m2 = s.match(/^([A-Z]{2})[-\s]*(\d{1,2})$/);
    if (m2) {
      return { payPlan: m2[1], series: '', grade: normalizeGrade(m2[2]) };
    }

    // A bare number, or something unrecognized. Pass it through rather than
    // blanking it: a value we cannot parse is still evidence, and validateRow
    // will flag a grade that matches nothing.
    return { payPlan: '', series: '', grade: normalizeGrade(s) };
  }

  /**
   * Normalizes occupancy to FILLED | VACANT | OBLIGATED.
   *
   * THIS DECIDES THE PER-CAPITA DENOMINATOR, so it must not guess generously.
   *
   * WHAT OBLIGATED MEANS IN THIS FEED, AND WHY EXCLUDING IT IS CORRECT
   * -----------------------------------------------------------------
   * I had this backward and @clolry corrected it: "The obligated positions
   * that I could find are ones that show the person in a temp promotion so
   * they are listed on the sheet twice (once as temp promotion and once as
   * obligated)."
   *
   * So an OBLIGATED row is a person's PERMANENT seat, held open while they
   * serve a temporary promotion elsewhere. The same human also appears on the
   * temp-promotion row, which is FILLED. They are two real positions and one
   * traveler.
   *
   * Counting OBLIGATED as filled would therefore DOUBLE-COUNT six people, not
   * find six missing ones. I had suggested the denominator should be 823
   * rather than 817 on the reasoning that their 'A'/'T' action codes looked
   * active — which was true and irrelevant. 817 is right, and it is right
   * because excluding OBLIGATED de-duplicates the person rather than because
   * an obligated seat does not travel.
   *
   * The headcount attributes such a person to their TEMP-PROMOTION org, which
   * is where they currently work and therefore where their travel would be
   * approved. That is the better of the two answers available.
   *
   * LETS already treats OBLIGATED as not-filled for access
   * (Access.js:439 excludes it), which is consistent: the person signs in
   * against their temp-promotion row.
   *
   * A row whose NAME says vacant is vacant regardless of the status column.
   * The May export marked 107 seats with 'VACANT (New position)' in the name
   * field, and reading only a status column would have counted all of them as
   * staffed.
   *
   * An unrecognized value on a row that HAS a real name defaults to FILLED,
   * because a named person occupies their seat; a row with no name at all is
   * VACANT.
   */
  function normalizeOccupancy(statusValue, employeeName) {
    var name = _str_(employeeName);
    var s = _str_(statusValue).toUpperCase();

    if (!name || /\bVACANT\b/.test(name.toUpperCase())) return 'VACANT';
    if (s.indexOf('VACAN') > -1) return 'VACANT';
    if (s.indexOf('OBLIGAT') > -1) return 'OBLIGATED';
    if (s.indexOf('FILL') > -1) return 'FILLED';
    if (s.indexOf('ENCUMBER') > -1) return 'FILLED';
    return 'FILLED';
  }

  /**
   * One feed row -> an HC_Positions-shaped record.
   *
   * Pure. No sheet access and no clock, so every decision above is testable
   * without a spreadsheet.
   *
   * @param {Array} cells
   * @param {Object} mapped from proposeMapping
   * @param {number} rowNumber 1-based, for messages
   * @returns {Object|null} null for a row that is not a position
   */
  function interpretRow(cells, mapped, rowNumber) {
    var idx = mapped.index;
    var get = function (field) {
      return (field in idx) ? cells[idx[field]] : '';
    };

    var pn = _str_(get('positionNumber'));
    var name = _str_(get('employeeName'));
    var org = _str_(get('orgCode')).toUpperCase();

    // A row with no position number AND no name is a spacer, a subtotal or a
    // banner. The May export had 272 of them among 409 rows.
    if (!pn && !name) return null;

    // Handles both shapes the grade can arrive in: HRLinks's composite
    // 'GS-0343-15', and the FC report's bare '15'. Storing a composite in
    // Grade would break the three string comparisons that locate a Division
    // Director for approval routing; a bare value still needs zero-padding,
    // which is the VT-03 defect.
    var pay = parsePayPlanGrade(get('grade'));

    // A SPLIT SOURCE NEEDS THE PAY-PLAN SUBSTITUTION DONE HERE.
    //
    // parsePayPlanGrade turns a composite 'ES-0340-00' into grade 'ES',
    // because '00' is the absence of a grade rather than a grade and would
    // otherwise sort below every GS-01. When the source splits PP and Grade
    // into separate columns, that function only sees '00' and has no pay plan
    // to substitute — so the SES rows would come through as '00'.
    //
    // Guarded on there being a pay plan to use. Without a PP column the value
    // passes through unchanged and validateRow's grade warning is the signal,
    // which is better than inventing one.
    var payPlan = _str_(get('payPlanOnly')).toUpperCase() || pay.payPlan;
    if ((pay.grade === '00' || pay.grade === '0') && payPlan) {
      pay = { payPlan: payPlan, series: pay.series, grade: payPlan };
    }

    var occupancy = normalizeOccupancy(get('occupancyStatus'), name);
    var secondary = _str_(get('secondaryStatus'));

    return {
      sourceRow: rowNumber,
      positionNumber: pn,
      reportsToPositionNumber: _str_(get('reportsTo')),
      employeeId: _str_(get('employeeId')),
      employeeName: name,
      emailAddress: _str_(get('emailAddress')).toLowerCase(),
      orgCode: org,
      officeTitle: _str_(get('officeTitle')),
      grade: pay.grade,
      payPlan: payPlan,
      // The occupational series is more useful than the free-text labour
      // category LETS has never populated, so it lands in LCAT when the feed
      // has no LCAT column of its own.
      lcat: _str_(get('lcat')) || pay.series,
      supervisoryStatus: normalizeSupervisoryStatus(get('supervisoryStatus')),
      occupancyStatus: occupancy,
      // The RAW cell, carried so the cross-check can show what the two
      // columns actually said. Never written to the roster.
      occupancyStatusRaw: _str_(get('occupancyStatus')),
      // Carried for the disagreement check only. Never written to the roster.
      secondaryStatus: secondary,
      obligatedTo: _str_(get('obligatedTo')),
      locationCode: _str_(get('locationCode')),
      dutyStationAddress: _str_(get('dutyAddress')),
      dutyStationCity: _str_(get('dutyCity')),
      dutyStationState: _str_(get('dutyState'))
    };
  }

  /**
   * Checks one interpreted row.
   *
   * Problems BLOCK the row. Warnings import it and say so. The split matters:
   * refusing the whole roster because forty people have no email would leave
   * LETS on fictional data, and importing a duplicate position number would
   * make one of two real people invisible to every lookup.
   *
   * @param {Object} row
   * @param {Object} seenPositionNumbers mutated: pn -> first row number
   * @param {Object} orgCodesByCode HC_Orgs index, or null to skip the check
   * @returns {{problems: Array, warnings: Array}}
   */
  function validateRow(row, seenPositionNumbers, orgCodesByCode) {
    var problems = [];
    var warnings = [];

    if (!row.positionNumber) {
      problems.push('No position number. It is the key the supervisor chain ' +
                    'and every lookup join on.');
    } else if (seenPositionNumbers && row.positionNumber in seenPositionNumbers) {
      // THE DUPLICATE-KEY DEFECT. HCAdmin.validateHCPosition guards the same
      // thing for a single edit: the later row wins every lookup and the
      // earlier person becomes invisible.
      problems.push('Position number ' + row.positionNumber +
                    ' already appeared on row ' +
                    seenPositionNumbers[row.positionNumber] +
                    '. A duplicate makes one of the two people invisible.');
    } else if (seenPositionNumbers) {
      seenPositionNumbers[row.positionNumber] = row.sourceRow;
    }

    if (!row.orgCode) {
      problems.push('No org code, so this person\'s travel cannot be ' +
                    'attributed to any budget.');
    } else if (orgCodesByCode && !orgCodesByCode[row.orgCode]) {
      // NOT a problem. An org code absent from HC_Orgs still resolves to its
      // nearest listed ancestor by prefix, so the money lands in the right
      // DAC — it just will not roll up to a named service center. Blocking
      // would reject real people over a reference-data gap.
      warnings.push('Org code ' + row.orgCode + ' is not in HC_Orgs. Travel ' +
                    'will attribute to its nearest known parent.');
    }

    if (row.occupancyStatus !== 'VACANT') {
      if (!row.employeeName) {
        problems.push('A filled position with no name.');
      }
      // NOT blocked, and NOT warned per row either when the whole feed lacks
      // an email column — 900 identical warnings would bury the real ones.
      // parseFeed reports the aggregate instead; see emailCoverage.
      if (row.emailAddress && row.emailAddress.indexOf('@') === -1) {
        warnings.push('Email "' + row.emailAddress + '" is not an email address.');
      }
    }

    if (row.supervisoryStatus &&
        ['2', '4', '5', '6', '7', '8'].indexOf(row.supervisoryStatus) === -1) {
      warnings.push('Supervisory status "' + row.supervisoryStatus +
                    '" is not a recognized code. This field grants LETS ' +
                    'access on its own, so it is worth checking.');
    }

    if (row.reportsToPositionNumber &&
        row.reportsToPositionNumber === row.positionNumber) {
      problems.push('This position reports to itself, which would hang any ' +
                    'page that walks the supervisor chain.');
    }

    return { problems: problems, warnings: warnings };
  }

  /**
   * Finds supervisor-chain cycles across the whole roster.
   *
   * Run after every row is read, because a cycle is a property of the SET —
   * A reports to B reports to A is invisible when either row is examined
   * alone. HCAdmin does this per-edit; a bulk import has to do it per-batch.
   *
   * A cycle hangs every page that walks the chain, so the rows in one are
   * imported with their reportsTo CLEARED rather than dropped: the people are
   * real and their budget attribution is unaffected, and a broken routing
   * pointer is recoverable while a missing person is not.
   *
   * @param {Array} rows
   * @returns {{cycles: Array<Array<string>>, cleared: number}}
   */
  function findSupervisorCycles(rows) {
    var byPn = {};
    (rows || []).forEach(function (r) {
      if (r.positionNumber) byPn[r.positionNumber] = r;
    });

    var state = {};        // pn -> 'visiting' | 'clean'
    var cycles = [];
    var cleared = 0;

    (rows || []).forEach(function (start) {
      if (!start.positionNumber || state[start.positionNumber]) return;

      var path = [];
      var onPath = {};
      var cursor = start.positionNumber;
      var depth = 0;

      while (cursor && byPn[cursor] && depth < 200) {
        if (onPath[cursor]) {
          // Found a cycle. Record it from its entry point.
          var at = path.indexOf(cursor);
          var ring = path.slice(at);
          cycles.push(ring);
          ring.forEach(function (pn) {
            if (byPn[pn] && byPn[pn].reportsToPositionNumber) {
              byPn[pn].reportsToPositionNumber = '';
              byPn[pn].cycleCleared = true;
              cleared++;
            }
            state[pn] = 'clean';
          });
          break;
        }
        if (state[cursor] === 'clean') break;

        path.push(cursor);
        onPath[cursor] = true;
        cursor = _str_(byPn[cursor].reportsToPositionNumber);
        depth++;
      }

      path.forEach(function (pn) { if (!state[pn]) state[pn] = 'clean'; });
    });

    return { cycles: cycles, cleared: cleared };
  }

  /**
   * Identifies seed/test rows in the CURRENT HC_Positions.
   *
   * @clolry: "remove ALL test records".
   *
   * Detected by the fixture's own markers rather than by "anything the feed
   * does not mention", which would also delete a real person the feed happens
   * to omit this week. Three signals, any one sufficient:
   *
   *   @example.gov            the fixture's email domain, reserved by RFC 2606
   *                           and therefore never a real GSA address
   *   Created_By 'hc-seed'    what seedHCTestData stamps
   *   an FC-0001-style PN     the fixture's synthetic numbering
   *
   * Reported separately from the general delete count, so the preview can say
   * "16 fictional test records" rather than burying them in a total.
   *
   * @param {Array} existing normalized current positions
   * @returns {Array} the subset that is test data
   */
  function identifySeedRows(existing) {
    return (existing || []).filter(function (p) {
      var email = _str_(p.emailAddress).toLowerCase();
      var createdBy = _str_(p.createdBy).toLowerCase();
      var pn = _str_(p.positionNumber).toUpperCase();
      return email.indexOf('@example.gov') > -1 ||
             email.indexOf('@example.com') > -1 ||
             createdBy === 'hc-seed' ||
             /^FC[A-Z]?-\d{4}$/.test(pn);
    });
  }

  /**
   * Compares the feed against what is in HC_Positions.
   *
   * @param {Array} incoming interpreted feed rows
   * @param {Array} existing current positions
   * @returns {Object} { adds, changes, deletes, seedDeletes, unchanged }
   */
  function diffRoster(incoming, existing) {
    var byPn = {};
    (existing || []).forEach(function (p) {
      if (p.positionNumber) byPn[_str_(p.positionNumber)] = p;
    });

    var incomingPns = {};
    var adds = [];
    var changes = [];
    var unchanged = [];

    // Fields whose change is worth reporting. Created_At and the audit columns
    // are excluded: they change on every import by definition and would make
    // every row look modified.
    var COMPARED = ['reportsToPositionNumber', 'employeeId', 'employeeName',
                    'emailAddress', 'orgCode', 'officeTitle', 'grade',
                    'supervisoryStatus', 'occupancyStatus', 'lcat',
                    'locationCode', 'dutyStationCity', 'dutyStationState'];

    (incoming || []).forEach(function (row) {
      if (!row.positionNumber) return;
      incomingPns[row.positionNumber] = true;

      var prior = byPn[row.positionNumber];
      if (!prior) { adds.push(row); return; }

      var fields = [];
      COMPARED.forEach(function (f) {
        var now = _str_(row[f]);
        var before = _str_(prior[f]);
        // Email and org are case-normalized on both sides, so a case-only
        // difference is not a change.
        if (f === 'emailAddress') { now = now.toLowerCase(); before = before.toLowerCase(); }
        if (f === 'orgCode') { now = now.toUpperCase(); before = before.toUpperCase(); }
        if (now !== before) {
          fields.push({ field: f, from: before, to: now });
        }
      });

      if (fields.length) changes.push({ row: row, fields: fields });
      else unchanged.push(row);
    });

    var deletes = (existing || []).filter(function (p) {
      return p.positionNumber && !incomingPns[_str_(p.positionNumber)];
    });
    var seedSet = {};
    identifySeedRows(existing).forEach(function (p) {
      seedSet[_str_(p.positionNumber)] = true;
    });

    return {
      adds: adds,
      changes: changes,
      unchanged: unchanged,
      // Split so the preview can distinguish "removing fictional fixtures"
      // from "removing people the feed no longer lists", which are very
      // different things to confirm.
      seedDeletes: deletes.filter(function (p) { return seedSet[_str_(p.positionNumber)]; }),
      deletes: deletes.filter(function (p) { return !seedSet[_str_(p.positionNumber)]; })
    };
  }

  /**
   * Parses a whole feed read.
   *
   * @param {Array<Array>} values   full range, header row first
   * @param {Object} [orgCodesByCode] HC_Orgs index
   * @returns {Object}
   */
  function parseFeed(values, orgCodesByCode, opts) {
    var o = opts || {};
    var scope = _str_(o.orgScope || DEFAULT_ORG_SCOPE).toUpperCase();

    var out = {
      rows: [], skipped: 0, blocked: [], warnings: [],
      mapping: {}, unmapped: [], headerProblems: [],
      cycles: [], cyclesCleared: 0,
      emailCoverage: null, occupancyDisagreement: null,
      orgScope: scope,
      outOfScope: 0,
      // Which org prefixes were seen and excluded, with counts. Reported
      // rather than silently dropped: 3,360 rows disappearing needs to be
      // confirmable as "the other four FAS portfolios" and not as a mapping
      // fault that read the wrong column.
      outOfScopeByPrefix: {},
      noOrgCode: 0
    };

    if (!values || values.length < 2) {
      out.headerProblems.push('The feed has no data rows.');
      return out;
    }

    var mapped = proposeMapping(values[0]);
    out.mapping = mapped.mapping;
    out.unmapped = mapped.unmapped;

    if (mapped.missing.length) {
      // REFUSES. See the file header: a wrong guess on supervisoryStatus
      // changes who can sign in, and on orgCode misattributes every dollar.
      out.headerProblems.push(
        'Could not find a column for: ' + mapped.missing.join(', ') +
        '. The import will not run on a partial mapping, because guessing ' +
        'these wrong silently misattributes budget or changes who can access ' +
        'LETS. Columns found in the feed: ' +
        (values[0] || []).map(_str_).filter(Boolean).join(' | '));
      return out;
    }

    var seen = {};
    for (var r = 1; r < values.length; r++) {
      var row = interpretRow(values[r], mapped, r + 1);
      if (!row) { out.skipped++; continue; }

      // SCOPE IS DECIDED FIRST, before validation and before the duplicate
      // check.
      //
      // Order matters here in a way that is easy to get wrong. If scope were
      // checked after the duplicate check, a non-ASD position number
      // colliding with an ASD one would BLOCK the ASD row — a person outside
      // this deployment's org could make someone inside it invisible. And
      // validating rows we are about to discard would fill the blocked list
      // with thousands of irrelevant problems, burying the handful that
      // concern ASD.
      if (!row.orgCode) {
        // No org code at all. Counted separately from out-of-scope, because
        // "we cannot tell whose this is" and "this belongs to another
        // portfolio" need different responses — the first may be an ASD
        // person with a blank cell.
        out.noOrgCode++;
        continue;
      }
      if (!isInScope(row.orgCode, scope)) {
        out.outOfScope++;
        // First two characters is the portfolio granularity for FAS codes.
        var prefix = row.orgCode.slice(0, 2);
        out.outOfScopeByPrefix[prefix] =
          (out.outOfScopeByPrefix[prefix] || 0) + 1;
        continue;
      }

      var checked = validateRow(row, seen, orgCodesByCode);
      if (checked.problems.length) {
        out.blocked.push({ row: row, problems: checked.problems });
        continue;
      }
      if (checked.warnings.length) {
        out.warnings.push({
          positionNumber: row.positionNumber,
          employeeName: row.employeeName,
          warnings: checked.warnings
        });
      }
      out.rows.push(row);
    }

    var cyc = findSupervisorCycles(out.rows);
    out.cycles = cyc.cycles;
    out.cyclesCleared = cyc.cleared;

    out.emailCoverage = emailCoverage(out.rows, mapped);
    out.occupancyDisagreement = occupancyDisagreement(out.rows, mapped);
    out.duplicatePeople = duplicatePeople(out.rows);
    out.scopeNote = scopeNote(out);

    return out;
  }

  /**
   * People holding more than one position.
   *
   * @clolry: "The obligated positions that I could find are ones that show the
   * person in a temp promotion so they are listed on the sheet twice (once as
   * temp promotion and once as obligated)."
   *
   * WHY THIS IS REPORTED AND NOT DE-DUPLICATED
   * ------------------------------------------
   * Both rows are real POSITIONS — the permanent seat held open, and the
   * temporary one being worked — and HC_Positions is a position table keyed on
   * Position_Number. Merging them would lose the permanent seat, which still
   * exists and which the person returns to.
   *
   * The duplication only matters for HEADCOUNT, and that is already handled:
   * the per-capita split counts FILLED only, the permanent seat is OBLIGATED,
   * so the person is counted once — in their temp-promotion org, which is
   * where they currently work and where their travel would be approved.
   *
   * So this exists to make the invariant CHECKABLE rather than assumed. If a
   * person ever appeared twice as FILLED, they would be double-counted in the
   * denominator and the budget would silently misallocate. That is the thing
   * worth detecting, and it is reported separately from the benign case.
   *
   * MATCHED ON EMPLOYEE ID WHEN PRESENT, name only as a fallback. Two people
   * can share a name; an Employee ID is the person. A name-only match would
   * report a false duplicate for every pair of namesakes, which at 1,046
   * positions is a near certainty.
   *
   * @param {Array} rows
   * @returns {Object}
   */
  function duplicatePeople(rows) {
    var byPerson = {};

    (rows || []).forEach(function (r) {
      // VACANT SEATS ARE SKIPPED FIRST, before any key is built.
      //
      // Found by the test: a vacant row carries the placeholder name 'VACANT'
      // and no Employee ID, so keying on the name collapsed every vacancy
      // into ONE "person holding N positions". On the real roster that is 229
      // vacancies reported as a single person with 229 jobs.
      //
      // Harmless to the arithmetic — none are FILLED, so nothing is
      // double-counted — and corrosive to the report, which exists to make a
      // real double-count visible. A permanent line of nonsense in a
      // diagnostic is how a reader learns to stop reading it.
      if (r.occupancyStatus === 'VACANT') return;

      // An ID is the person; a name is a label. Prefixed so an ID of '12345'
      // cannot collide with a name that happens to be '12345'.
      var key = r.employeeId ? ('id:' + r.employeeId)
                             : ('nm:' + _str_(r.employeeName).toUpperCase());
      if (key === 'nm:') return;              // no name and no ID: not a person
      if (!byPerson[key]) byPerson[key] = [];
      byPerson[key].push(r);
    });

    var benign = [];
    var doubleCounted = [];

    Object.keys(byPerson).forEach(function (key) {
      var held = byPerson[key];
      if (held.length < 2) return;

      var filled = held.filter(function (r) {
        return r.occupancyStatus === 'FILLED';
      });

      var entry = {
        employeeId: held[0].employeeId,
        employeeName: held[0].employeeName,
        positions: held.map(function (r) {
          return {
            positionNumber: r.positionNumber,
            orgCode: r.orgCode,
            occupancyStatus: r.occupancyStatus,
            officeTitle: r.officeTitle
          };
        })
      };

      // THE CASE THAT MATTERS. Two FILLED rows for one person means the
      // per-capita denominator counts them twice, and every service-center
      // share shifts by a fraction nobody would notice.
      if (filled.length > 1) doubleCounted.push(entry);
      else benign.push(entry);
    });

    return {
      peopleWithMultiplePositions: benign.length + doubleCounted.length,
      // Counted once — a temp promotion plus an obligated permanent seat.
      resolvedByOccupancy: benign.length,
      resolvedSamples: benign.slice(0, 10),
      // Counted twice. Should be zero.
      doubleCounted: doubleCounted.length,
      doubleCountedSamples: doubleCounted.slice(0, 20),
      note: doubleCounted.length
        ? (doubleCounted.length + ' person(s) hold more than one FILLED ' +
           'position, so they are counted twice in the per-capita ' +
           'denominator and every service-center share is slightly wrong. ' +
           'This needs a decision — see the samples.')
        : (benign.length
            ? (benign.length + ' person(s) hold two positions — typically a ' +
               'temporary promotion plus their permanent seat held open as ' +
               'OBLIGATED. Each is counted ONCE, in their temp-promotion org, ' +
               'because the split counts FILLED only. No double-counting.')
            : 'Nobody holds more than one position.')
    };
  }

  /**
   * The sentence explaining what scope excluded, and why that is correct.
   *
   * An admin seeing "914 of 4,274 rows imported" needs to know immediately
   * whether 3,360 rows vanished because they belong to other portfolios or
   * because the org column was read wrongly. Both produce the same count.
   */
  function scopeNote(out) {
    var kept = out.rows.length;
    var excluded = out.outOfScope;
    if (!excluded && !out.noOrgCode) {
      return 'Every row in the feed is within scope "' + out.orgScope + '".';
    }

    var prefixes = Object.keys(out.outOfScopeByPrefix).sort(function (a, b) {
      return out.outOfScopeByPrefix[b] - out.outOfScopeByPrefix[a];
    }).slice(0, 8).map(function (p) {
      return p + ' (' + out.outOfScopeByPrefix[p] + ')';
    });

    return 'Scope "' + out.orgScope + '": kept ' + kept + ' position(s), ' +
           'excluded ' + excluded + ' whose org code is outside it' +
           (prefixes.length ? ' — by prefix: ' + prefixes.join(', ') : '') +
           (out.noOrgCode ? ('; ' + out.noOrgCode + ' row(s) had no org code ' +
                             'at all and were also excluded') : '') + '. ' +
           'This feed covers all of FAS, so exclusion is expected. Check the ' +
           'prefixes above look like other portfolios rather than mangled ' +
           'ASD codes — importing out-of-scope staff would grant LETS access ' +
           'to supervisors outside this organization.';
  }

  /**
   * How many staffed positions have an email address, and what that costs.
   *
   * THE FAS HRLINKS FEED HAS NO EMAIL COLUMN. All 33 headers, and not one
   * carries an address. That is not a cosmetic gap:
   *
   *   Access.js:435-441   the HC supervisor access gate matches the signed-in
   *                       user's email against Email_Address. With none, no
   *                       supervisor is admitted by that rule and roughly 184
   *                       status-2 supervisors lose their only automatic route
   *                       into LETS.
   *   Access.js:982       the Division Director lookup matches on email too.
   *   HCPrivacy.js:79     emailAddress is on the reviewer allow-list because
   *                       "a reviewer must be able to contact a traveler".
   *
   * Reported as an aggregate rather than as a warning per row, because 900
   * identical warnings bury the ones that matter. previewRosterImport surfaces
   * this prominently: an admin needs to see it BEFORE confirming an import
   * that would blank a column the access gate reads.
   *
   * WHY THE IMPORT STILL PROCEEDS. The alternative is staying on 16 fictional
   * people, which breaks the same access gate AND every budget allocation.
   * Importing a roster with no emails is strictly better, and the gap is
   * fixable afterward — the Google Directory lookup already scoped in
   * docs/handoff/README.md item A resolves an address from a name, which is
   * exactly this problem.
   *
   * @param {Array} rows
   * @param {Object} mapped
   * @returns {Object}
   */
  function emailCoverage(rows, mapped) {
    var staffed = 0;
    var withEmail = 0;
    var supervisorsWithout = 0;

    (rows || []).forEach(function (r) {
      if (r.occupancyStatus === 'VACANT') return;
      staffed++;
      if (r.emailAddress && r.emailAddress.indexOf('@') > -1) withEmail++;
      else if (r.supervisoryStatus === '2') supervisorsWithout++;
    });

    var hasColumn = 'emailAddress' in (mapped.index || {});
    return {
      columnPresent: hasColumn,
      columnName: mapped.mapping ? (mapped.mapping.emailAddress || '') : '',
      staffedPositions: staffed,
      withEmail: withEmail,
      without: staffed - withEmail,
      supervisorsWithoutEmail: supervisorsWithout,
      // The sentence an admin has to read, not a number they have to
      // interpret.
      impact: hasColumn
        ? ((staffed - withEmail) + ' of ' + staffed + ' staffed positions ' +
           'have no email address. Those people cannot be matched for LETS ' +
           'access or notified.')
        : ('The feed has NO email column, so Email_Address will be blank for ' +
           'all ' + staffed + ' staffed positions. This matters: the HC ' +
           'supervisor access rule in Access.js matches the signed-in user ' +
           'against Email_Address, so ' + supervisorsWithout + ' supervisor(s) ' +
           'will not be admitted to LETS by that rule. Explicit Travel_Users ' +
           'roles still work. Importing is still better than staying on ' +
           'fictional test data, which breaks the same rule and every budget ' +
           'figure — but the email gap needs closing separately.')
    };
  }

  /**
   * Rows where the feed's two status columns disagree.
   *
   * The FAS feed has both 'Position Status' and a bare 'Status'. This module
   * reads the first, on the reasoning that an '"Obligated To" Employee Name'
   * column only makes sense beside a POSITION-level status — but that is a
   * judgment, and it decides the per-capita denominator.
   *
   * So when the two columns suggest different occupancy, say so. A handful of
   * disagreements is normal; hundreds would mean the wrong column was chosen,
   * and that is worth catching before the allocations move.
   *
   * @param {Array} rows
   * @param {Object} mapped
   * @returns {Object|null} null when the feed has only one status column
   */
  function occupancyDisagreement(rows, mapped) {
    var idx = mapped.index || {};
    if (!('secondaryStatus' in idx) || !('occupancyStatus' in idx)) return null;
    if (idx.secondaryStatus === idx.occupancyStatus) return null;

    // THE VOCABULARIES ARE COMPARED BEFORE THE ROWS.
    //
    // The first version of this ran normalizeOccupancy over the secondary
    // column and reported every row where the answer differed. Against the
    // real feed that produced "6 row(s) would be classified differently",
    // which looked like a small data inconsistency and was nothing of the
    // kind.
    //
    // The secondary column holds 'A' and 'T' — personnel ACTION codes, a
    // different vocabulary entirely. normalizeOccupancy recognizes none of
    // them, so every value fell through to its FILLED default. The arithmetic
    // consequence: a FILLED row "agreed" by accident, a VACANT row agreed
    // because the name test fires first, and ONLY the 6 OBLIGATED rows could
    // ever differ. The check could not have returned any other number, and a
    // reader comparing 6 against 1,046 would conclude the columns broadly
    // agree — the opposite of the truth, which is that they are not
    // comparable at all.
    //
    // So: establish whether the secondary column speaks the occupancy
    // vocabulary. If it does not, say so and report NO conflicts, because a
    // conflict count between incommensurable columns is a meaningless number
    // that invites a decision.
    var KNOWN = /VACAN|OBLIGAT|FILL|ENCUMBER/;
    var secondaryValues = {};
    var recognized = 0;
    var seenValues = 0;

    (rows || []).forEach(function (r) {
      var v = _str_(r.secondaryStatus).toUpperCase();
      if (!v) return;
      seenValues++;
      secondaryValues[v] = (secondaryValues[v] || 0) + 1;
      if (KNOWN.test(v)) recognized++;
    });

    var distinct = Object.keys(secondaryValues).sort(function (a, b) {
      return secondaryValues[b] - secondaryValues[a];
    });
    var sampleValues = distinct.slice(0, 8).map(function (v) {
      return v + ' (' + secondaryValues[v] + ')';
    });

    // A column that speaks occupancy will use recognizable words on most
    // rows. Half is a deliberately loose bar: the point is to separate
    // 'Filled/Vacant' from 'A/T', not to grade near-misses.
    var comparable = seenValues > 0 && recognized >= seenValues / 2;

    if (!comparable) {
      return {
        primaryColumn: mapped.mapping.occupancyStatus,
        secondaryColumn: mapped.mapping.secondaryStatus,
        comparable: false,
        conflicts: 0,
        samples: [],
        secondaryValues: sampleValues,
        note: 'The "' + mapped.mapping.secondaryStatus + '" column does not ' +
              'hold occupancy values — its values are ' +
              sampleValues.join(', ') + ', which look like personnel action ' +
              'codes rather than Filled/Vacant/Obligated. So there is nothing ' +
              'to cross-check, and occupancy is correctly taken from "' +
              mapped.mapping.occupancyStatus + '". CONFIRMED by the data ' +
              'rather than assumed from the "Obligated To" column being ' +
              'present.'
      };
    }

    var conflicts = [];
    (rows || []).forEach(function (r) {
      var secondary = _str_(r.secondaryStatus).toUpperCase();
      if (!secondary) return;
      // What the OTHER column would have concluded, by the same rule.
      var alt = normalizeOccupancy(r.secondaryStatus, r.employeeName);
      if (alt !== r.occupancyStatus) {
        conflicts.push({
          positionNumber: r.positionNumber,
          employeeName: r.employeeName,
          chosen: r.occupancyStatus,
          alternative: alt,
          // The RAW primary value, not ''. It was hardcoded empty, so every
          // sample reported `"primaryValue": ""` — the one field that would
          // have shown the conflict was between 'Obligated' and 'A' and
          // therefore not a conflict at all.
          primaryValue: _str_(r.occupancyStatusRaw).toUpperCase(),
          secondaryValue: secondary
        });
      }
    });

    return {
      primaryColumn: mapped.mapping.occupancyStatus,
      secondaryColumn: mapped.mapping.secondaryStatus,
      comparable: true,
      conflicts: conflicts.length,
      samples: conflicts.slice(0, 20),
      secondaryValues: sampleValues,
      // `mapped.mapping.secondaryStatus`, NOT `secondaryColumn`.
      //
      // The latter is a field of the object being BUILT here, not of
      // `mapped.mapping`, so it read undefined and the note said '...
      // classified differently by "undefined"'. The count was right and the
      // sentence was unusable — an admin cannot act on a disagreement without
      // knowing which column disagrees.
      //
      // Nothing failed: JavaScript resolves a missing property to undefined
      // and string-concatenates it happily. A test asserting only that the
      // note mentions "the wrong column was chosen" passed throughout, which
      // is why §1e now asserts the column NAMES appear.
      note: conflicts.length
        ? (conflicts.length + ' row(s) would be classified differently by "' +
           mapped.mapping.secondaryStatus + '". Occupancy is taken from "' +
           mapped.mapping.occupancyStatus + '" because the feed also carries ' +
           'an "Obligated To" column, which is a position-level concept. If ' +
           'this count is large, the wrong column was chosen and every ' +
           'per-capita share is affected.')
        : 'Both status columns agree on every row.'
    };
  }

  /**
   * Headcount the imported roster would produce, per service center.
   *
   * Included in the PREVIEW on purpose. The roster's whole budget consequence
   * is this number, and an admin confirming a replace should see what it does
   * to the allocations before committing — not discover afterward that a
   * service center's share moved by a third.
   *
   * Duplicates HCData.hcServiceCenterHeadcount's rule rather than calling it,
   * because that function reads the COMMITTED sheet and this has to count rows
   * that are not written yet.
   *
   * @param {Array} rows interpreted feed rows
   * @param {Array} orgs HC_Orgs records
   * @returns {Object} dac|sc -> counts
   */
  function previewHeadcount(rows, orgs) {
    var byCode = {};
    (orgs || []).forEach(function (o) {
      byCode[_str_(o.orgCode).toUpperCase()] = o;
    });

    function ancestorAtLevel(code, wantLevel) {
      var cursor = _str_(code).toUpperCase();
      // Resolve an unlisted code to its nearest listed ancestor by prefix,
      // the same way HCData.resolveOrgByCode does.
      if (!byCode[cursor]) {
        var best = '';
        Object.keys(byCode).forEach(function (k) {
          if (cursor.indexOf(k) === 0 && k.length > best.length) best = k;
        });
        cursor = best;
      }
      var seen = {};
      var depth = 0;
      while (cursor && byCode[cursor] && !seen[cursor] && depth < 25) {
        seen[cursor] = true;
        if (_str_(byCode[cursor].orgLevel).toUpperCase() === wantLevel) return cursor;
        cursor = _str_(byCode[cursor].parentOrgCode).toUpperCase();
        depth++;
      }
      return '';
    }

    var out = {};
    (rows || []).forEach(function (row) {
      var dac = ancestorAtLevel(row.orgCode, 'DAC') ||
                ancestorAtLevel(row.orgCode, 'AC');
      if (!dac) {
        out.UNATTRIBUTED = out.UNATTRIBUTED ||
          { orgCode: '', dacOrgCode: '', filled: 0, vacant: 0, authorized: 0 };
        out.UNATTRIBUTED.authorized++;
        if (row.occupancyStatus === 'FILLED') out.UNATTRIBUTED.filled++;
        else out.UNATTRIBUTED.vacant++;
        return;
      }
      var sc = ancestorAtLevel(row.orgCode, 'SERVICE_CENTER');
      var key = dac + '|' + sc;
      if (!out[key]) {
        out[key] = {
          orgCode: sc, dacOrgCode: dac,
          filled: 0, vacant: 0, authorized: 0
        };
      }
      out[key].authorized++;
      if (row.occupancyStatus === 'FILLED') out[key].filled++;
      else out[key].vacant++;
    });

    return out;
  }

  return {
    FIELD_HINTS: FIELD_HINTS,
    REQUIRED_FIELDS: REQUIRED_FIELDS,
    DEFAULT_ORG_SCOPE: DEFAULT_ORG_SCOPE,
    isInScope: isInScope,
    scopeNote: scopeNote,
    duplicatePeople: duplicatePeople,
    proposeMapping: proposeMapping,
    normalizeGrade: normalizeGrade,
    parsePayPlanGrade: parsePayPlanGrade,
    emailCoverage: emailCoverage,
    occupancyDisagreement: occupancyDisagreement,
    normalizeSupervisoryStatus: normalizeSupervisoryStatus,
    normalizeOccupancy: normalizeOccupancy,
    interpretRow: interpretRow,
    validateRow: validateRow,
    findSupervisorCycles: findSupervisorCycles,
    identifySeedRows: identifySeedRows,
    diffRoster: diffRoster,
    parseFeed: parseFeed,
    previewHeadcount: previewHeadcount
  };
})();

// Node/CommonJS export for the test suite. Inert in Apps Script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HCRosterImport;
}
