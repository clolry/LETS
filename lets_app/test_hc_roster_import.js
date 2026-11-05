/**
 * Automated Verification Script for the HR roster importer.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * HC_Positions drives three things that are easy to break invisibly:
 *
 *   1. SITE ACCESS. Access.js:416 admits a supervisor to LETS on the strength
 *      of Supervisory_Status === '2'. A value that arrives as the NUMBER 2, or
 *      as '2.0' from a spreadsheet numeric column, fails that comparison and
 *      silently denies access to every supervisor in the roster.
 *   2. APPROVAL ROUTING. The GS-15 Division Director lookup is a STRING
 *      comparison on Grade, so a cell holding 07 that arrives as the number 7
 *      fails every grade check — the VT-03 defect HCAdmin already guards for a
 *      single edit.
 *   3. EVERY BUDGET ALLOCATION. The per-capita split divides each DAC's
 *      discretionary balance by its share of FILLED positions, so the
 *      occupancy rule decides where the money goes.
 *
 * WHY THIS MODULE EXISTS AT ALL — and it was my error
 * --------------------------------------------------
 * I reported Melissa Mould as unattributable, having read the May 2026
 * staffing plan, which places her in FCBBB at supervisory status 8. The FAS HR
 * feed has her in FCBBBB as a status-2 supervisor.
 *
 * The damage was not one row. Every per-capita figure reported before this
 * existed came from that stale file — 807 filled positions, 22 service-center
 * shares, every dollar. §7 is the guard that no code path can read the May
 * file again.
 *
 * Run: node lets_app/test_hc_roster_import.js
 */

const fs = require('fs');
const path = require('path');
const R = require('./server/30_services/HCRosterImport.js');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else {
    console.log('  FAIL', n, x === undefined ? '' : String(x).slice(0, 300));
    fails++;
  }
};

/** A feed row builder, so each test states only what it is about. */
const HEADERS = ['Position Number', 'Reports To Position Number', 'Employee ID',
                 'Employee Name', 'Email Address', 'Org Code', 'Position Title',
                 'Grade', 'Supervisory Status', 'Work Status', 'LCAT',
                 'Location Code', 'Duty Station Address',
                 'Duty Station City', 'State'];
const row = (o = {}) => [
  o.pn ?? '90000001', o.reportsTo ?? '', o.empId ?? '0010001',
  o.name ?? 'Doe,Jane A', o.email ?? 'jane.doe@gsa.gov', o.org ?? 'FCA0B',
  o.title ?? 'Program Analyst', o.grade ?? '13', o.supv ?? '8',
  o.work ?? 'Active', o.lcat ?? '', o.loc ?? '', o.addr ?? '',
  o.city ?? 'Washington', o.state ?? 'DC'
];

console.log('--- HR roster importer test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. the column mapping is proposed, and refuses to guess');
{
  // The feed's real headers are not known here, and the same concept is
  // spelled several ways across government HR exports.
  const m = R.proposeMapping(HEADERS);
  ok('maps the canonical header spellings',
     m.mapping.positionNumber === 'Position Number' &&
     m.mapping.orgCode === 'Org Code' &&
     m.mapping.supervisoryStatus === 'Supervisory Status',
     m.mapping);
  ok('and nothing is missing', m.missing.length === 0, m.missing);

  // The May export's spellings, which are what a real GSA roster looks like.
  const may = R.proposeMapping(['Office Symbol', 'Full Name',
                                'Position #      (PN)', 'Position Title',
                                'Location City (Duty Station)', 'State',
                                'Work Status', 'Location Code', 'Supv Status']);
  ok('maps a real-world header set with different names',
     may.mapping.orgCode === 'Office Symbol' &&
     may.mapping.employeeName === 'Full Name' &&
     may.mapping.supervisoryStatus === 'Supv Status',
     may.mapping);
  // 'Position #      (PN)' carries SIX internal spaces in the real file.
  ok('and tolerates collapsed internal whitespace in a header',
     may.mapping.positionNumber === 'Position #      (PN)',
     may.mapping.positionNumber);
  ok('with no required field missing', may.missing.length === 0, may.missing);

  // THE REFUSAL. A wrong guess on orgCode misattributes every dollar; on
  // supervisoryStatus it changes who can sign in. Neither fails visibly.
  const bad = R.proposeMapping(['Name', 'Title', 'Email']);
  ok('a feed with no position-number column is REFUSED',
     bad.missing.indexOf('positionNumber') > -1, bad.missing);
  ok('and a feed with no org column is REFUSED',
     bad.missing.indexOf('orgCode') > -1, bad.missing);

  const parsed = R.parseFeed([['Name', 'Title'], ['x', 'y']]);
  ok('parseFeed stops rather than importing a partial mapping',
     parsed.headerProblems.length > 0 && parsed.rows.length === 0,
     parsed.headerProblems);
  ok('and the message lists what the feed actually contained',
     /Columns found in the feed/.test(parsed.headerProblems[0] || ''),
     'an admin cannot fix a mapping failure without seeing the headers');

  // reportsTo is deliberately NOT required: the org hierarchy is stored
  // explicitly in HC_Orgs, so budget attribution survives without it.
  ok('a supervisor column is NOT required',
     R.REQUIRED_FIELDS.indexOf('reportsTo') === -1,
     'org codes carry budget attribution; reportsTo only affects routing');
}

// ---------------------------------------------------------------------------
console.log('\n1b. the REAL FC workforce report headers, as supplied by @clolry');
{
  // All 46, verbatim, INCLUDING THE EMBEDDED NEWLINES.
  //
  // The sheet wraps long headers inside the cell, so they arrive as
  // 'Employee\nID' rather than 'Employee ID'. That is not cosmetic: four
  // fields depend on _norm_ collapsing whitespace, and without it
  // positionNumber's neighbours — employeeId, reportsTo, lcat — would
  // silently fail to map. Written here exactly as the sheet delivers them, so
  // the test exercises the real shape rather than a tidied one.
  const FCWF = ['Record Date', 'SSO', 'Dept. ID\n2 Letter', 'Dept ID',
    'Employee Position Number', 'Employee\nID', 'Name', 'Employee Email',
    'Position Title', 'Position Status Type', 'PD\nNumber', 'PP',
    'Occ\nSeries', 'Grade', 'Step', 'Target Grade', 'Grade Entry Date',
    'WGI Due Dt', 'Eligible for Career Ladder Promotion?\nY/N',
    'Type Appt Desc', 'EOD\nDate', 'Supv Lvl', 'Supervisor\nLevel Desc.',
    'FLSA\nStatus', 'Reports to\nPosition\nNumber',
    'Reports to Supervisor Name', 'Reports to Supervisor Email',
    'Location Code', 'Location Code Description', 'Address Line 1',
    'Location City', 'Location County', 'Location State', 'Obligated To',
    'Obligated To\nEmployee', 'Accounting Code', 'Hire NTE Date',
    'Temp\nPromotion\nExpire Date', 'Detail\nPosition',
    'Detail\nExpire Date', 'Work\nSchedule', 'POID', 'SCD Leave',
    'Base Pay', 'Local Adjust', 'Total Pay'];

  const m = R.proposeMapping(FCWF);
  ok('nothing required is missing', m.missing.length === 0, m.missing);

  // WRAPPED HEADERS MUST MAP. Three of the four below arrive with a newline
  // in the middle, and a hint list written with literal newlines would be
  // unreadable and fragile — so the hints use single spaces and _norm_
  // collapses.
  ok('a header wrapped onto two lines still maps',
     m.mapping.employeeId === 'Employee\nID', m.mapping.employeeId);
  ok('and one wrapped onto three lines',
     m.mapping.reportsTo === 'Reports to\nPosition\nNumber',
     m.mapping.reportsTo);
  ok('and the occupational series',
     m.mapping.lcat === 'Occ\nSeries', m.mapping.lcat);

  ok('the position key comes from Employee Position Number',
     m.mapping.positionNumber === 'Employee Position Number',
     m.mapping.positionNumber);

  // 'Dept ID', NOT 'Dept. ID 2 Letter'. The two-letter column is a portfolio
  // abbreviation; reading it as the org code would collapse the whole roster
  // into one bucket and make all 22 per-capita service-center shares
  // identical — a figure that looks precise and means nothing.
  ok('the org code comes from Dept ID',
     m.mapping.orgCode === 'Dept ID', m.mapping.orgCode);
  ok('and NOT from the 2-letter department column',
     m.unmapped.indexOf('Dept. ID\n2 Letter') > -1,
     'a 2-letter code would merge every service center into one');

  // THE COLUMN THAT MADE THIS SOURCE WORTH SWITCHING TO. The HRLinks feed had
  // 33 columns and no address, which is why ~5,100 lines of directory name
  // matching existed.
  ok('there IS an email column, and it is the employee\'s own',
     m.mapping.emailAddress === 'Employee Email', m.mapping.emailAddress);

  // AND IT MUST NOT BE THE SUPERVISOR'S. 'Reports to Supervisor Email' is the
  // boss's address sitting on the employee's row; mapping it to emailAddress
  // would hand every person their supervisor's identity, and Access.js:435
  // matches the signed-in user against exactly this field.
  ok('the supervisor email column is NOT read',
     m.unmapped.indexOf('Reports to Supervisor Email') > -1 &&
     m.mapping.emailAddress !== 'Reports to Supervisor Email',
     'it would give everyone their supervisor\'s access');

  // The supervisor join must be on the position NUMBER, not the name or the
  // address. Two people can share a name; and the thing being walked is a
  // tree of POSITIONS, where a vacant supervisory seat has no occupant to
  // have an address at all.
  ok('and the supervisor NAME column is not read either',
     m.unmapped.indexOf('Reports to Supervisor Name') > -1,
     'a name is not a key — the chain joins on position numbers');

  // 'Position Status Type' decides the per-capita denominator. OBLIGATED in
  // this vocabulary is a permanent seat held during a temp promotion, so
  // counting it as filled double-counts the person.
  ok('occupancy comes from Position Status Type',
     m.mapping.occupancyStatus === 'Position Status Type',
     m.mapping.occupancyStatus);

  // THIS SOURCE HAS NO SECOND STATUS COLUMN, so the cross-check has nothing
  // to compare and reports zero. That is correct rather than a gap — there is
  // no disagreement to find.
  ok('there is no secondary status column to cross-check',
     !('secondaryStatus' in m.mapping),
     'the HRLinks feed had two status columns; this one has one');

  // GRADE IS ITS OWN COLUMN HERE, not the 'GS-0343-15' composite.
  ok('grade comes from the plain Grade column',
     m.mapping.grade === 'Grade', m.mapping.grade);
  ok('and the pay plan is read separately, for the SES case',
     m.mapping.payPlanOnly === 'PP', m.mapping.payPlanOnly);

  // THE FIELD THAT GRANTS SITE ACCESS. Access.js:435 admits anyone whose
  // Supervisory_Status is '2'.
  ok('supervisory status comes from Supv Lvl',
     m.mapping.supervisoryStatus === 'Supv Lvl', m.mapping.supervisoryStatus);

  // AND NOT FROM THE DESCRIPTION BESIDE IT. 'Supervisor Level Desc.' is free
  // text; it would never equal '2', so every supervisor would silently lose
  // their only automatic route into LETS — a failure with no symptom other
  // than people being unable to sign in.
  ok('and NOT from Supervisor Level Desc.',
     m.unmapped.indexOf('Supervisor\nLevel Desc.') > -1,
     'a description never equals "2"; every supervisor would be locked out');

  // Pay columns must stay unmapped. Base Pay / Total Pay are salary, which a
  // travel tool has no business storing — HCPrivacy already withholds grade
  // below admin for the same reason.
  ['Base Pay', 'Local Adjust', 'Total Pay', 'SCD Leave', 'Step'].forEach(h => {
    ok('"' + h + '" is not mapped to anything',
       m.unmapped.indexOf(h) > -1, 'salary and leave are not travel data');
  });

  ok('emailAddress is still not a REQUIRED field',
     R.REQUIRED_FIELDS.indexOf('emailAddress') === -1,
     'the source has one, but requiring it would block an import over a ' +
     'single blank cell');
}

// ---------------------------------------------------------------------------
console.log('\n1b-ii. the retired FAS HRLinks headers still map');
{
  // All 33, verbatim. KEPT DELIBERATELY after the source changed.
  //
  // The old spellings cost nothing — proposeMapping stops at the first match
  // — and they are the record of what the code was reading when the live
  // figures in SESSION_STATE.md were produced: 1,046 positions, 817 filled,
  // $444,500 split 22 ways. A future reader comparing a new import against
  // those numbers needs to know which column each came from.
  const FAS = ['Position Status', 'Status', '"Obligated To" Employee Name',
    'Employee ID', 'Employee Name', 'Position#', 'PAR#', 'Position Title',
    'PP-Series-Grd', 'FPL', 'PD #', 'Dept ID (Org)', 'POI',
    'Location Description', 'Location Address', 'Location City',
    'Location State', 'Location Code', 'Work Sch', 'Reports To Name',
    'Reports To Position #', 'Accounting Code', 'FLSA', 'BUS code',
    'Appt Hire NTE Date', 'Temp Prom Expiration Date', 'Detail Position',
    'Detail Expiration Date', 'WIG Due Date',
    'Last Career Ladder Promotion Date', 'Detailee', 'Sub-Agency',
    'Supv Status'];

  const m = R.proposeMapping(FAS);
  ok('nothing required is missing', m.missing.length === 0, m.missing);

  // 'Position#' has NO space before the hash. The original hints had
  // 'Position Number', 'Position #' and 'PN' and missed it, so the import
  // refused — which is how the gap became visible instead of silently
  // importing a roster with no join key.
  ok('Position# maps despite having no space',
     m.mapping.positionNumber === 'Position#', m.mapping.positionNumber);

  // 'Dept ID (Org)' not 'POI'. A POI is a payroll servicing code shared by
  // several orgs, so keying budget attribution off it would merge unrelated
  // service centers.
  ok('the org code comes from Dept ID (Org)',
     m.mapping.orgCode === 'Dept ID (Org)', m.mapping.orgCode);
  ok('and NOT from POI',
     m.mapping.orgCode !== 'POI' && m.unmapped.indexOf('POI') > -1,
     'a POI is shared across orgs; it would merge service centers');

  ok('the supervisor join uses Reports To Position #',
     m.mapping.reportsTo === 'Reports To Position #', m.mapping.reportsTo);
  ok('and ignores Reports To Name',
     m.unmapped.indexOf('Reports To Name') > -1,
     'a name is not a key — the chain joins on position numbers');

  // 'Position Status' over the bare 'Status'. That feed had both; the choice
  // decided the per-capita denominator.
  ok('occupancy comes from Position Status',
     m.mapping.occupancyStatus === 'Position Status', m.mapping.occupancyStatus);
  ok('and the bare Status column is read only for cross-checking',
     m.mapping.secondaryStatus === 'Status', m.mapping.secondaryStatus);

  ok('grade comes from the PP-Series-Grd composite',
     m.mapping.grade === 'PP-Series-Grd', m.mapping.grade);
  ok('supervisory status comes from Supv Status',
     m.mapping.supervisoryStatus === 'Supv Status');

  // THE GAP THAT MADE THIS SOURCE OBSOLETE. 33 columns, not one address —
  // which is why the directory name-matching subsystem existed at all.
  ok('there is NO email column in the old feed',
     !('emailAddress' in m.mapping),
     'this absence is the whole reason the source was replaced');
}

// ---------------------------------------------------------------------------
console.log('\n1c. PP-Series-Grd is split, not stored whole');
{
  // Three call sites compare Grade to the STRING '15' to find a Division
  // Director for approval routing — HCData.js:669, Access.js:133,
  // Request.js:137. Storing 'GS-0343-15' would make all three fail and
  // nothing would announce it: every approval would route past its DD.
  const gs15 = R.parsePayPlanGrade('GS-0343-15');
  ok('GS-0343-15 yields grade "15"', gs15.grade === '15', gs15);
  ok('and keeps the pay plan and series', gs15.payPlan === 'GS' &&
     gs15.series === '0343', gs15);

  // The VT-03 defect: a single-digit grade must be zero-padded or it fails
  // every string comparison in the system.
  ok('GS-1102-07 yields "07", not "7"',
     R.parsePayPlanGrade('GS-1102-07').grade === '07',
     R.parsePayPlanGrade('GS-1102-07'));

  // SES AND ES HAVE NO NUMERIC GRADE. '00' is the absence of one, and
  // returning it would be worse than returning the pay plan because '00'
  // compares and sorts as a real low grade — an SES would read as junior to a
  // GS-07.
  const es = R.parsePayPlanGrade('ES-0340-00');
  ok('ES-0340-00 yields "ES", not "00"', es.grade === 'ES', es);
  ok('and SV-1801-00 yields "SV"',
     R.parsePayPlanGrade('SV-1801-00').grade === 'SV');

  // VT-03 is pay plan + grade with no series. HCAdmin's validator already
  // names this shape.
  const vt = R.parsePayPlanGrade('VT-03');
  ok('VT-03 yields grade "03" with no series',
     vt.grade === '03' && vt.series === '', vt);

  // An unparseable value passes through rather than being blanked: a value we
  // cannot read is still evidence.
  ok('a bare 13 still yields "13"', R.parsePayPlanGrade('13').grade === '13');
  ok('and a blank stays blank', R.parsePayPlanGrade('').grade === '');

  // The series lands in LCAT, which LETS has never populated.
  const FAS_MIN = ['Position#', 'Employee Name', 'Dept ID (Org)', 'PP-Series-Grd'];
  const p = R.parseFeed([FAS_MIN,
    ['90000001', 'Doe,Jane', 'FCA0B', 'GS-0343-15']], null);
  ok('the occupational series lands in LCAT',
     p.rows[0].lcat === '0343', p.rows[0]);
  ok('and the grade is the bare number',
     p.rows[0].grade === '15', p.rows[0].grade);
}

// ---------------------------------------------------------------------------
console.log('\n1c-ii. a SPLIT grade column needs the same two protections');
{
  // The FC workforce report separates what HRLinks combined: PP, Occ Series
  // and Grade are three columns. The composite-splitting branches are no
  // longer exercised by the live source, so the two things they were doing
  // have to be checked on the new shape — both fail silently if dropped.
  const SPLIT = ['Employee Position Number', 'Name', 'Dept ID', 'PP',
                 'Occ\nSeries', 'Grade'];

  // 1. ZERO-PADDING. A sheet cell holding 07 arrives as the number 7, and
  //    every grade comparison in LETS is a string comparison. This is the
  //    VT-03 defect, and a "simple" column is exactly where it would be
  //    assumed away.
  const g7 = R.parseFeed([SPLIT,
    ['90000001', 'Doe,Jane', 'FCA0B', 'GS', '1102', 7]], null);
  ok('a numeric 7 from a plain Grade column becomes "07"',
     g7.rows[0].grade === '07', g7.rows[0].grade);
  const g15 = R.parseFeed([SPLIT,
    ['90000002', 'Roe,John', 'FCA0B', 'GS', '0343', 15]], null);
  ok('and 15 stays "15" for the Division Director lookup',
     g15.rows[0].grade === '15', g15.rows[0].grade);

  // 2. THE SES SUBSTITUTION. parsePayPlanGrade turns a composite
  //    'ES-0340-00' into grade 'ES' because '00' is the absence of a grade
  //    and sorts below every GS-01. On a split source that function only sees
  //    '00' and has no pay plan to substitute — so interpretRow must do it,
  //    using the separate PP column.
  const ses = R.parseFeed([SPLIT,
    ['90000003', 'Senior,Exec', 'FCA', 'ES', '0340', '00']], null);
  ok('a split ES row with grade 00 yields "ES", not "00"',
     ses.rows[0].grade === 'ES', ses.rows[0].grade);
  ok('and the pay plan is carried',
     ses.rows[0].payPlan === 'ES', ses.rows[0].payPlan);

  // NEGATIVE CONTROL for that substitution: without a PP column there is no
  // pay plan to use, and inventing one would be worse than passing the value
  // through for validateRow to flag.
  const noPp = R.parseFeed([
    ['Employee Position Number', 'Name', 'Dept ID', 'Grade'],
    ['90000004', 'Senior,Exec', 'FCA', '00']], null);
  ok('with no PP column, 00 passes through rather than being invented',
     noPp.rows[0].grade === '00', noPp.rows[0].grade);

  // The series still reaches LCAT, now from its own column.
  ok('the occupational series lands in LCAT from its own column',
     g15.rows[0].lcat === '0343', g15.rows[0].lcat);
}

// ---------------------------------------------------------------------------
console.log('\n1d. the missing email column is reported as an aggregate');
{
  // 900 identical per-row warnings would bury the ones that matter, so this
  // is one block an admin reads before confirming.
  const FAS_MIN = ['Position#', 'Employee Name', 'Dept ID (Org)',
                   'Position Status', 'Supv Status'];
  const p = R.parseFeed([FAS_MIN,
    ['90000001', 'Supervisor,A', 'FCA0B', 'Filled', '2'],
    ['90000002', 'Worker,B', 'FCA0B', 'Filled', '8'],
    ['90000003', 'VACANT', 'FCA0B', 'Vacant', '']
  ], null);

  const ec = p.emailCoverage;
  ok('the absence of the column is detected',
     ec && ec.columnPresent === false, ec);
  ok('only STAFFED positions are counted',
     ec.staffedPositions === 2, ec.staffedPositions);
  ok('and supervisors without email are counted separately',
     ec.supervisorsWithoutEmail === 1, ec.supervisorsWithoutEmail);

  // The message has to name the consequence, not just the number — an admin
  // cannot weigh "0 of 2 have email" without knowing what email does.
  ok('the impact names the access rule it breaks',
     /Access\.js/.test(ec.impact) && /supervisor access rule/.test(ec.impact),
     ec.impact);
  ok('and says explicit Travel_Users roles still work',
     /Travel_Users/.test(ec.impact), ec.impact);
  ok('and says importing is still the better option',
     /still better than staying on/.test(ec.impact), ec.impact);

  // No per-row spam.
  ok('no per-row email warnings are emitted', p.warnings.length === 0,
     p.warnings);

  // With a column present, the aggregate counts real blanks instead.
  const withCol = R.parseFeed(
    [['Position#', 'Employee Name', 'Dept ID (Org)', 'Position Status', 'Email Address'],
     ['90000001', 'A,A', 'FCA0B', 'Filled', 'a@gsa.gov'],
     ['90000002', 'B,B', 'FCA0B', 'Filled', '']], null);
  ok('with a column present it counts the blanks',
     withCol.emailCoverage.columnPresent === true &&
     withCol.emailCoverage.without === 1,
     withCol.emailCoverage);
}

// ---------------------------------------------------------------------------
console.log('\n1e. the two status columns are cross-checked');
{
  // The feed has 'Position Status' AND a bare 'Status'. Occupancy comes from
  // the first, on the reasoning that an '"Obligated To" Employee Name' column
  // only makes sense beside a position-level status. That is a judgment, and
  // it decides the per-capita denominator — so a disagreement is reported.
  const H2 = ['Position#', 'Employee Name', 'Dept ID (Org)',
              'Position Status', 'Status'];
  const p = R.parseFeed([H2,
    ['90000001', 'A,A', 'FCA0B', 'Filled', 'Active'],
    ['90000002', 'B,B', 'FCA0B', 'Filled', 'Vacant']   // the columns disagree
  ], null);

  const d = p.occupancyDisagreement;
  ok('the cross-check runs when both columns exist', !!d, d);
  ok('it names which column was used',
     d.primaryColumn === 'Position Status' && d.secondaryColumn === 'Status', d);
  ok('comparable columns are compared', d.comparable === true, d);
  ok('a disagreeing row is reported', d.conflicts === 1, d);
  // The sample must show BOTH raw values, or it cannot be judged. primaryValue
  // was hardcoded '' and every sample reported an empty string for the one
  // field that would have revealed the comparison was meaningless.
  ok('and the sample shows both raw values',
     d.samples[0].primaryValue === 'FILLED' &&
     d.samples[0].secondaryValue === 'VACANT', d.samples[0]);
  ok('and the note explains what a large count would mean',
     /the wrong column was chosen/.test(d.note), d.note);

  // THE NOTE MUST NAME BOTH COLUMNS.
  //
  // It read '... classified differently by "undefined"' in @clolry's live
  // output, because the builder referenced mapped.mapping.secondaryColumn —
  // a field of the object being constructed, not of mapped.mapping. Nothing
  // threw: JavaScript resolves the missing property to undefined and
  // concatenates it.
  //
  // The assertion above passed throughout, because it only checked for the
  // explanatory clause. An admin cannot act on a disagreement without knowing
  // WHICH column disagrees, so the names are now asserted directly.
  ok('the note names the column occupancy came from',
     d.note.indexOf('"Position Status"') > -1, d.note);
  ok('and names the column that disagrees, not "undefined"',
     d.note.indexOf('"Status"') > -1 && d.note.indexOf('undefined') === -1,
     d.note);

  // Agreement must be silent, or the signal is worthless.
  const agree = R.parseFeed([H2,
    ['90000001', 'A,A', 'FCA0B', 'Filled', 'Active']], null);
  ok('full agreement reports zero conflicts',
     agree.occupancyDisagreement.conflicts === 0,
     agree.occupancyDisagreement);

  // A feed with only one status column has nothing to cross-check.
  const one = R.parseFeed(
    [['Position#', 'Employee Name', 'Dept ID (Org)', 'Position Status'],
     ['90000001', 'A,A', 'FCA0B', 'Filled']], null);
  ok('a single-status feed skips the check',
     one.occupancyDisagreement === null, one.occupancyDisagreement);

  // THE REAL FEED'S SECOND COLUMN IS NOT AN OCCUPANCY COLUMN AT ALL.
  //
  // @clolry's live preview reported "6 row(s) would be classified differently
  // by Status", which reads as a small data inconsistency and was nothing of
  // the kind. The Status column holds 'A' and 'T' — personnel ACTION codes.
  // normalizeOccupancy recognizes neither, so every value fell through to its
  // FILLED default: a FILLED row agreed by accident, a VACANT row agreed
  // because the name test fires first, and ONLY the 6 OBLIGATED rows could
  // ever differ.
  //
  // The check could not have produced any other number. 6 against 1,046 reads
  // as "the columns broadly agree" when the truth is that they are not
  // comparable. That is worse than no check, because it invites a decision.
  const action = R.parseFeed([H2,
    ['90000001', 'Filled,Person', 'FCA0B', 'Filled', 'A'],
    ['90000002', 'Obligated,Person', 'FCA0B', 'Obligated', 'A'],
    ['90000003', 'Another,Person', 'FCA0B', 'Filled', 'T'],
    ['90000004', 'VACANT', 'FCA0B', 'Vacant', '']
  ], null);
  const a = action.occupancyDisagreement;
  ok('an action-code column is detected as incomparable',
     a.comparable === false, a);
  ok('and reports ZERO conflicts rather than a meaningless count',
     a.conflicts === 0,
     'the old code would have reported 1 here — the OBLIGATED row');
  ok('it lists the actual values found',
     a.secondaryValues.join(' ').indexOf('A (2)') > -1 &&
     a.secondaryValues.join(' ').indexOf('T (1)') > -1,
     a.secondaryValues);
  ok('and says the column choice is confirmed BY THE DATA',
     /CONFIRMED by the data rather than assumed/.test(a.note), a.note);

  // The threshold must not be so tight that a real occupancy column with a
  // few odd values is thrown out.
  const mostly = R.parseFeed([H2,
    ['1', 'A,A', 'FCA0B', 'Filled', 'Filled'],
    ['2', 'B,B', 'FCA0B', 'Filled', 'Filled'],
    ['3', 'C,C', 'FCA0B', 'Filled', 'X']
  ], null);
  ok('a mostly-occupancy column is still compared',
     mostly.occupancyDisagreement.comparable === true,
     mostly.occupancyDisagreement);
}

// ---------------------------------------------------------------------------
console.log('\n2. the three fields a spreadsheet silently corrupts');
{
  // GRADE — the VT-03 defect. Every grade comparison in LETS is a string
  // comparison, including the GS-15 Division Director lookup.
  ok('a numeric 7 becomes "07"', R.normalizeGrade(7) === '07', R.normalizeGrade(7));
  ok('"07" stays "07"', R.normalizeGrade('07') === '07');
  ok('a float 13.0 becomes "13"', R.normalizeGrade('13.0') === '13',
     R.normalizeGrade('13.0'));
  ok('SES is left alone', R.normalizeGrade('SES') === 'SES');
  ok('VT-03 is left alone', R.normalizeGrade('VT-03') === 'VT-03');
  ok('and a blank stays blank', R.normalizeGrade(null) === '');

  // SUPERVISORY STATUS — this field grants LETS access on its own. The May
  // export carried '8' on 663 rows and '8.0' on 11 for the same meaning,
  // which is what a spreadsheet does to a numeric column.
  ok('"8.0" becomes "8"', R.normalizeSupervisoryStatus('8.0') === '8');
  ok('"2.0" becomes "2"', R.normalizeSupervisoryStatus('2.0') === '2',
     'a supervisor whose status reads 2.0 would be denied LETS access');
  ok('a numeric 2 becomes the string "2"',
     R.normalizeSupervisoryStatus(2) === '2',
     typeof R.normalizeSupervisoryStatus(2));
  // An unknown code is PRESERVED, not blanked. HR owns this vocabulary.
  ok('an unrecognized code is preserved, not defaulted',
     R.normalizeSupervisoryStatus('9') === '9',
     'inventing a default is worse than carrying a value we flag');

  // OCCUPANCY — this decides the per-capita denominator.
  ok('a name saying VACANT is vacant',
     R.normalizeOccupancy('Active', 'VACANT (New position)') === 'VACANT',
     'the May export marked 107 seats this way in the NAME field');
  ok('a real name with no status is FILLED',
     R.normalizeOccupancy('', 'Mould,Melissa J') === 'FILLED');
  ok('no name at all is VACANT',
     R.normalizeOccupancy('Active', '') === 'VACANT',
     'a seat with no occupant does not travel');
  ok('an explicit Obligated status is kept',
     R.normalizeOccupancy('Obligated', 'Doe,Jane') === 'OBLIGATED',
     'committed to someone not yet in post — not filled, and not vacant');
}

// ---------------------------------------------------------------------------
console.log('\n3. rows that must be blocked, and rows that must not be');
{
  const feed = [HEADERS,
    row({ pn: '90000001', name: 'Alpha,A' }),
    row({ pn: '90000001', name: 'Beta,B' }),              // duplicate PN
    row({ pn: '90000003', name: 'Gamma,G', org: '' }),     // no org
    row({ pn: '', name: '' }),                            // spacer
    row({ pn: '90000005', name: 'Delta,D', email: '' }),   // no email
    row({ pn: '90000006', name: 'Eps,E', reportsTo: '90000006' }) // self-report
  ];
  const p = R.parseFeed(feed, null);

  // THE DUPLICATE KEY. The later row wins every lookup and the earlier person
  // becomes invisible to routing, access and the org chart.
  const dupe = p.blocked.find(b => b.row.positionNumber === '90000001' &&
                                   b.row.employeeName === 'Beta,B');
  ok('a duplicate position number is BLOCKED', !!dupe, p.blocked.map(b => b.row.employeeName));
  ok('and the message names the row it collides with',
     /already appeared on row 2/.test((dupe && dupe.problems[0]) || ''),
     dupe && dupe.problems);
  ok('the FIRST of the two is still imported',
     p.rows.some(r => r.positionNumber === '90000001' && r.employeeName === 'Alpha,A'));

  // A POSITION WITH NO ORG CODE IS EXCLUDED BY SCOPE, NOT BLOCKED.
  //
  // It used to be blocked by validateRow. The scope filter now runs FIRST and
  // drops it before validation, which is the right order — see §14 — but it
  // moved the row from `blocked` to the `noOrgCode` count. Asserting the old
  // location would have passed only because the row was absent from `rows`,
  // which is the same outcome for the wrong reason.
  ok('a position with no org code never reaches the roster',
     !p.rows.some(r => r.employeeName === 'Gamma,G') && p.noOrgCode === 1,
     [p.noOrgCode, p.rows.map(r => r.employeeName)]);

  ok('a self-reporting position is BLOCKED',
     p.blocked.some(b => b.row.positionNumber === '90000006'),
     'it would hang every page that walks the supervisor chain');

  ok('a blank spacer row is skipped, not blocked', p.skipped === 1, p.skipped);

  // A MISSING EMAIL IS NOT A PER-ROW WARNING ANY MORE. The FAS feed has no
  // email column at all, so warning per row would emit ~900 identical lines
  // and bury the real problems. §1d asserts the aggregate that replaced it.
  ok('a missing email still imports the position',
     p.rows.some(r => r.positionNumber === '90000005'),
     'blocking on email would leave LETS running on fictional data');
  ok('and does NOT emit a per-row warning',
     !p.warnings.some(w => w.positionNumber === '90000005'),
     'see §1d: the email gap is reported once, as an aggregate');

  // An unknown org code is a warning too: it still resolves to its nearest
  // listed ancestor, so the money lands in the right DAC.
  const orgIdx = { FCA: { orgCode: 'FCA' } };
  const unknown = R.parseFeed([HEADERS, row({ org: 'FCAZZZ' })], orgIdx);
  ok('an org code absent from HC_Orgs warns but imports',
     unknown.rows.length === 1 && unknown.warnings.length === 1,
     unknown.warnings);
}

// ---------------------------------------------------------------------------
console.log('\n4. supervisor cycles are found across the SET, not per row');
{
  // A cycle is invisible when either row is examined alone: A reports to B
  // reports to A is two individually valid rows. HCAdmin checks this per
  // edit; a bulk import has to check per batch.
  const rows = [
    { positionNumber: 'A', reportsToPositionNumber: 'B', sourceRow: 2 },
    { positionNumber: 'B', reportsToPositionNumber: 'C', sourceRow: 3 },
    { positionNumber: 'C', reportsToPositionNumber: 'A', sourceRow: 4 },
    { positionNumber: 'D', reportsToPositionNumber: '', sourceRow: 5 },
    { positionNumber: 'E', reportsToPositionNumber: 'D', sourceRow: 6 }
  ];
  const c = R.findSupervisorCycles(rows);

  ok('a three-node cycle is detected', c.cycles.length === 1, c.cycles);
  ok('all three members are named',
     c.cycles[0].length === 3 && c.cycles[0].indexOf('A') > -1, c.cycles[0]);

  // CLEARED, NOT DROPPED. These are real people; a broken routing pointer is
  // recoverable, a missing person is not, and their budget attribution is
  // unaffected either way.
  ok('their supervisor pointers are cleared', c.cleared === 3, c.cleared);
  ok('and the rows survive',
     rows[0].reportsToPositionNumber === '' && rows[0].cycleCleared === true,
     rows[0]);

  // A VALID chain must be untouched, or every roster loses its routing.
  ok('a valid chain is NOT cleared',
     rows[4].reportsToPositionNumber === 'D', rows[4]);
  ok('and a root with no supervisor is fine',
     rows[3].reportsToPositionNumber === '' && !rows[3].cycleCleared);

  // Two independent cycles, to prove the walk does not stop at the first.
  const two = R.findSupervisorCycles([
    { positionNumber: 'P', reportsToPositionNumber: 'Q', sourceRow: 2 },
    { positionNumber: 'Q', reportsToPositionNumber: 'P', sourceRow: 3 },
    { positionNumber: 'X', reportsToPositionNumber: 'Y', sourceRow: 4 },
    { positionNumber: 'Y', reportsToPositionNumber: 'X', sourceRow: 5 }
  ]);
  ok('two separate cycles are both found', two.cycles.length === 2, two.cycles);

  // A dangling pointer is not a cycle and must not be reported as one.
  const dangle = R.findSupervisorCycles([
    { positionNumber: 'M', reportsToPositionNumber: 'GONE', sourceRow: 2 }
  ]);
  ok('a dangling supervisor pointer is not a cycle',
     dangle.cycles.length === 0 && dangle.cleared === 0, dangle);
}

// ---------------------------------------------------------------------------
console.log('\n5. the 16 fictional people are identified by their own markers');
{
  // @clolry: "remove ALL test records". Detected by the fixture's markers, NOT
  // by "anything the feed does not mention" — that would also delete a real
  // person the feed happens to omit this week.
  const existing = [
    { positionNumber: 'FC-0001', employeeName: 'Marguerite Okonkwo',
      emailAddress: 'marguerite.okonkwo@example.gov', createdBy: 'hc-seed' },
    { positionNumber: 'FCA-0002', employeeName: 'Thandiwe Mbeki-Lawson',
      emailAddress: 'thandiwe@example.gov', createdBy: 'hc-seed' },
    { positionNumber: '90012345', employeeName: 'Mould,Melissa J',
      emailAddress: 'melissa.mould@gsa.gov', createdBy: 'admin@gsa.gov' },
    // A real person whose email is missing — must NOT be mistaken for a
    // fixture just because it cannot be matched on the domain.
    { positionNumber: '90067890', employeeName: 'Real,Person',
      emailAddress: '', createdBy: 'admin@gsa.gov' }
  ];
  const seed = R.identifySeedRows(existing);

  ok('the @example.gov fixtures are found', seed.length === 2,
     seed.map(s => s.positionNumber));
  ok('a real @gsa.gov person is NOT flagged',
     !seed.some(s => s.positionNumber === '90012345'));
  ok('and nor is a real person with no email',
     !seed.some(s => s.positionNumber === '90067890'),
     'a blank email is not evidence of being fictional');

  // Each of the three markers independently.
  ok('Created_By hc-seed alone is enough',
     R.identifySeedRows([{ positionNumber: 'X1', emailAddress: 'a@gsa.gov',
                           createdBy: 'hc-seed' }]).length === 1);
  ok('the synthetic FC-0001 numbering alone is enough',
     R.identifySeedRows([{ positionNumber: 'FCB-0003', emailAddress: 'a@gsa.gov',
                           createdBy: 'admin' }]).length === 1);
  ok('a real 8-digit position number is not synthetic',
     R.identifySeedRows([{ positionNumber: '00123456', emailAddress: 'a@gsa.gov',
                           createdBy: 'admin' }]).length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n6. the diff separates fixtures from real people');
{
  const existing = [
    { positionNumber: 'FC-0001', employeeName: 'Marguerite Okonkwo',
      emailAddress: 'm@example.gov', createdBy: 'hc-seed', orgCode: 'FC' },
    { positionNumber: '90012345', employeeName: 'Mould,Melissa J',
      emailAddress: 'melissa.mould@gsa.gov', createdBy: 'admin',
      orgCode: 'FCBBB', supervisoryStatus: '8', occupancyStatus: 'FILLED' },
    { positionNumber: '90099999', employeeName: 'Departed,Person',
      emailAddress: 'd@gsa.gov', createdBy: 'admin', orgCode: 'FCA',
      occupancyStatus: 'FILLED' }
  ];
  const incoming = [
    // THE CORRECTION THAT PROMPTED THIS MODULE. The May file had Mould in
    // FCBBB at status 8; the feed has her in FCBBBB at status 2.
    { positionNumber: '90012345', employeeName: 'Mould,Melissa J',
      emailAddress: 'melissa.mould@gsa.gov', orgCode: 'FCBBBB',
      supervisoryStatus: '2', occupancyStatus: 'FILLED' },
    { positionNumber: '90055555', employeeName: 'New,Hire',
      emailAddress: 'n@gsa.gov', orgCode: 'FCA0B', occupancyStatus: 'FILLED' }
  ];
  const d = R.diffRoster(incoming, existing);

  ok('a new position is an add', d.adds.length === 1 &&
     d.adds[0].positionNumber === '90055555', d.adds);

  const mould = d.changes.find(c => c.row.positionNumber === '90012345');
  ok('Mould is reported as changed', !!mould, d.changes);
  ok('her org code move FCBBB -> FCBBBB is named',
     mould.fields.some(f => f.field === 'orgCode' &&
                            f.from === 'FCBBB' && f.to === 'FCBBBB'),
     mould.fields);
  ok('and her supervisory status 8 -> 2, which changes her LETS access',
     mould.fields.some(f => f.field === 'supervisoryStatus' &&
                            f.from === '8' && f.to === '2'),
     mould.fields);

  // THE SPLIT THAT MATTERS. "Removing 1 fictional fixture" and "removing 1
  // real person the feed no longer lists" are very different confirmations.
  ok('the fictional row is a SEED delete',
     d.seedDeletes.length === 1 && d.seedDeletes[0].positionNumber === 'FC-0001',
     d.seedDeletes);
  ok('the departed real person is a separate, flagged delete',
     d.deletes.length === 1 && d.deletes[0].positionNumber === '90099999',
     d.deletes);

  // A case-only difference is not a change, or every import reports the whole
  // roster as modified and the real changes are unreadable.
  const caseOnly = R.diffRoster(
    [{ positionNumber: 'P1', emailAddress: 'A@GSA.GOV', orgCode: 'fca' }],
    [{ positionNumber: 'P1', emailAddress: 'a@gsa.gov', orgCode: 'FCA' }]);
  ok('a case-only email or org difference is not a change',
     caseOnly.changes.length === 0 && caseOnly.unchanged.length === 1,
     caseOnly.changes);
}

// ---------------------------------------------------------------------------
console.log('\n7. the May spreadsheet can never be read again');
{
  // THE GUARD FOR MY OWN ERROR. I read Copy of ASD Staffing Plan 5-12-26.xlsx
  // and reported allocations from it. Every per-capita figure in that report
  // was wrong because the file is six months stale.
  //
  // @clolry: "completely ignore my sheet from May."
  const serverFiles = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) serverFiles.push(p);
    });
  })('lets_app/server');

  const offenders = [];
  serverFiles.forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    // Strip comments: this file's own prose names the May file while
    // explaining why it must not be read, and several server files now do the
    // same. A naive grep reports those as violations.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
                    .replace(/^\s*\/\/.*$/gm, '');
    if (/Staffing Plan|staffing_plan|reference_excel_files/i.test(code)) {
      offenders.push(f);
    }
  });
  ok('no server file references the May staffing plan or the reference folder',
     offenders.length === 0, offenders);

  // And the roster has exactly one source, which must be the Script Property.
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');
  ok('the importer reads the FC workforce feed property',
     /getFcWorkforceFeedSource\(\)/.test(sync));
  ok('and no longer reads the retired FAS HRLinks getter',
     !/getFasHrFeedSource\(\)/.test(sync),
     'two HR sources with no way to tell which is live is worse than one');

  const props = fs.readFileSync('lets_app/server/00_config/Props.js', 'utf8');
  ok('and that property is FC_WF_Data_Report',
     /FC_WF_FEED:\s*'FC_WF_Data_Report'/.test(props));
  ok('with its tab in FC_WF_Tab',
     /FC_WF_FEED_TAB:\s*'FC_WF_Tab'/.test(props));

  // THE OLD KEYS ARE GONE, not merely unread. @clolry deleted them from
  // Script Properties; leaving them in PROPS_KEYS would make
  // _verifyAllPropsKeys report two permanent MISSINGs on a correct install.
  ok('the retired HRLinks keys are removed from PROPS_KEYS',
     !/FAS_HR_FEED/.test(props),
     'an unread key still shows up in the setup verifier');

  // NO DEFAULT. Every other getter in Props.js falls back to something
  // sensible; this one must not, because every available fallback is a stale
  // roster — which is the failure being prevented.
  const getter = props.slice(props.indexOf('function getFcWorkforceFeedSource'),
                             props.indexOf('function getLiabilityLogSource'));
  ok('an unset HR feed property is an ERROR, not a default',
     /ok:\s*false/.test(getter) && /is not set/.test(getter),
     'defaulting to a stale roster is exactly what went wrong');
  ok('and the error explains why there is no fallback',
     /no other source|no fallback/i.test(getter), getter.slice(0, 200));

  // THE TAB HAS NO DEFAULT EITHER, which is a change from the HRLinks getter.
  //
  // That one defaulted to 'FAS' and the default was defensible: a wrong tab
  // in the RIGHT workbook fails loudly, because the required columns are
  // absent and parseFeed refuses. This workbook's layout is not known to the
  // code, so a default would be a guess at which sheet holds the roster.
  ok('an unset TAB is also an error, not a guess',
     /PROPS_KEYS\.FC_WF_FEED_TAB \+ ' is not set/.test(getter),
     'guessing a tab means guessing which sheet is the roster');
  ok('and it points at the diagnostic that lists the real tabs',
     /diagnoseHrFeedSource\(\)/.test(getter));
  ok('there is no tab fallback expression at all',
     !/tabName: tab \|\|/.test(getter), getter.slice(-400));

  // The spreadsheet IDs must not be in the OPTIONAL set, or setup can
  // complete without them and the importer fails at the point of use.
  const optionalBlock = props.slice(props.indexOf('const OPTIONAL = new Set(['),
                                    props.indexOf(']);', props.indexOf('const OPTIONAL')));
  ok('FC_WF_FEED is NOT optional',
     !/'FC_WF_FEED'/.test(optionalBlock), optionalBlock.slice(0, 200));
  // AND NEITHER IS THE TAB, unlike FAS_HR_FEED_TAB which was optional
  // because it had a default. Removing the default without removing the
  // exemption would let setup report complete while the import cannot run.
  ok('FC_WF_FEED_TAB is NOT optional either',
     !/'FC_WF_FEED_TAB'/.test(optionalBlock),
     'it has no default, so an unset value must be reported MISSING');
  ok('LIABILITY_LOG_SHEET is NOT optional',
     !/'LIABILITY_LOG_SHEET'/.test(optionalBlock));
}

// ---------------------------------------------------------------------------
console.log('\n8. the import cannot wipe the roster, and cannot run unconfirmed');
{
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');

  // THE WORST OUTCOME THIS FILE PREVENTS. A feed that parses to nothing —
  // wrong tab, cleared sheet, permissions change returning headers only —
  // would replace the roster with nothing and revoke supervisor-based LETS
  // access for everyone.
  ok('an empty parse result REFUSES to import',
     /if \(!parsed\.rows\.length\)/.test(sync) &&
     /would remove every position/.test(sync),
     'there is no legitimate reason to import zero positions');

  // Confirmation is mandatory, because this deletes HR rows.
  ok('importRoster requires a preview token',
     /indexOf\('roster_'\) !== 0/.test(sync));
  ok('both entry points are admin-gated',
     (sync.match(/_hcAdminGuard_\(\)/g) || []).length >= 2);
  ok('and it takes the script lock',
     /LockService\.getScriptLock\(\)/.test(sync));

  // Created_At must survive. Stamping it `now` on every import makes the
  // whole roster look created today and destroys the only record of when a
  // position first appeared.
  ok('Created_At is preserved for an existing position',
     /createdAtByPn\[r\.positionNumber\] \|\| now/.test(sync));

  // Leading zeros. Employee_ID '0010001' and Grade '07' both lose theirs
  // unless the column is pinned to text BEFORE the write.
  ok('identifier columns are pinned to text before writing',
     /setNumberFormat\('@'\)/.test(sync) &&
     sync.indexOf("setNumberFormat('@')") < sync.indexOf('sheet.getRange(2, 1, rows.length'),
     'pinning after the write is too late — Sheets has already coerced 07 to 7');

  // The HC bundle is cached for six hours. Without invalidation the dashboard
  // serves the OLD roster, the admin concludes the import failed, and runs it
  // again.
  ok('the HC cache is invalidated after a write',
     /hcCacheInvalidateAll\(\)/.test(sync));

  // The preview must state the headcount consequence, because that is the
  // whole budget impact of the roster.
  ok('the preview reports filled headcount and says what it drives',
     /per-capita budget split divides by/.test(sync));
  ok('and warns separately about deleting non-test positions',
     /are NOT test data/.test(sync));
}

// ---------------------------------------------------------------------------
console.log('\n9. the headcount preview matches the live rule');
{
  // The preview counts rows that are not written yet, so it duplicates
  // HCData.hcServiceCenterHeadcount's rule. Duplicated rules drift, so this
  // asserts they agree on the shape that matters.
  const orgs = [
    { orgCode: 'FC', parentOrgCode: '', orgLevel: 'AC' },
    { orgCode: 'FCB', parentOrgCode: 'FC', orgLevel: 'DAC' },
    { orgCode: 'FCBB', parentOrgCode: 'FCB', orgLevel: 'OFFICE' },
    { orgCode: 'FCBBB', parentOrgCode: 'FCBB', orgLevel: 'SERVICE_CENTER' },
    { orgCode: 'FCBBBB', parentOrgCode: 'FCBBB', orgLevel: 'DIVISION' }
  ];
  const rows = [
    { orgCode: 'FCBBBB', occupancyStatus: 'FILLED' },
    { orgCode: 'FCBBBB', occupancyStatus: 'VACANT' },
    { orgCode: 'FCBBB', occupancyStatus: 'FILLED' },
    { orgCode: 'FCB', occupancyStatus: 'FILLED' },        // above SC level
    { orgCode: 'FCBBBBZZ', occupancyStatus: 'FILLED' },   // unlisted sub-org
    { orgCode: 'ZZZZ', occupancyStatus: 'FILLED' }        // unattributable
  ];
  const h = R.previewHeadcount(rows, orgs);

  // A DIVISION rolls up to its service center. Mould sits at FCBBBB, which is
  // Division 2 of Acquisition Service Center 2.
  ok('a division-level position rolls up to its service center',
     h['FCB|FCBBB'] && h['FCB|FCBBB'].filled === 3,
     h['FCB|FCBBB']);
  ok('and its vacant seat is counted separately, not dropped',
     h['FCB|FCBBB'].vacant === 1 && h['FCB|FCBBB'].authorized === 4,
     h['FCB|FCBBB']);

  // An unlisted code resolves to its nearest listed ancestor by prefix — the
  // same rule HCData.resolveOrgByCode uses — so the money still lands.
  ok('an org code absent from HC_Orgs resolves to its nearest parent',
     h['FCB|FCBBB'].filled === 3,
     'FCBBBBZZ must count toward FCBBB, not vanish');

  // Someone sitting directly at the DAC is NOT discarded. Dropping them would
  // inflate every service center's share and the total would still foot.
  ok('a position above any service center gets its own bucket',
     h['FCB|'] && h['FCB|'].filled === 1 &&
     h['FCB|'].orgCode === '', h['FCB|']);

  // And a genuinely unattributable code is reported, not silently lost.
  ok('an unattributable position is reported',
     h.UNATTRIBUTED && h.UNATTRIBUTED.filled === 1, h.UNATTRIBUTED);
}

// ---------------------------------------------------------------------------
console.log('\n10. negative controls (the suite must be able to fail)');
{
  // 10a — if the duplicate check is removed, §3 must fail.
  const src = fs.readFileSync('lets_app/server/30_services/HCRosterImport.js', 'utf8');
  const noDupe = src.replace(
    "} else if (seenPositionNumbers && row.positionNumber in seenPositionNumbers) {",
    "} else if (false) {");
  ok('negative control patched the duplicate check', noDupe !== src);
  {
    const mod = { exports: {} };
    new Function('module', 'exports', noDupe)(mod, mod.exports);
    const p = mod.exports.parseFeed(
      [HEADERS, row({ pn: 'D1', name: 'A,A' }), row({ pn: 'D1', name: 'B,B' })], null);
    ok('a patched build imports BOTH duplicate rows', p.rows.length === 2,
       'so section 3 is exercising a real guard — and both would be in the roster');
  }

  // 10b — if occupancy defaults to FILLED regardless of name, §2 must fail and
  // every vacant seat would inflate its org's per-capita share.
  const vacantFilled = src.replace(
    "if (!name || /\\bVACANT\\b/.test(name.toUpperCase())) return 'VACANT';",
    "if (false) return 'VACANT';");
  ok('negative control patched the vacancy rule', vacantFilled !== src);
  {
    const mod = { exports: {} };
    new Function('module', 'exports', vacantFilled)(mod, mod.exports);
    ok('a patched build counts a VACANT seat as FILLED',
       mod.exports.normalizeOccupancy('Active', 'VACANT (New position)') === 'FILLED',
       'so section 2 is real: 107 vacant seats would skew every allocation');
  }

  // 10c — if the cycle walk only looks one hop, §4 must fail.
  const shallow = src.replace('depth < 200', 'depth < 1');
  ok('negative control patched the cycle depth', shallow !== src);
  {
    const mod = { exports: {} };
    new Function('module', 'exports', shallow)(mod, mod.exports);
    const c = mod.exports.findSupervisorCycles([
      { positionNumber: 'A', reportsToPositionNumber: 'B', sourceRow: 2 },
      { positionNumber: 'B', reportsToPositionNumber: 'C', sourceRow: 3 },
      { positionNumber: 'C', reportsToPositionNumber: 'A', sourceRow: 4 }
    ]);
    ok('a patched build misses a three-node cycle', c.cycles.length === 0,
       'so section 4 is real: the cycle would hang every org-chart page');
  }
}

// ---------------------------------------------------------------------------
console.log('\n11. seedHCTestData cannot overwrite a real roster');
{
  // The fixture loader has a `force` flag, but `force: true` is exactly what
  // someone types when they are determined — and it would then replace a real
  // 900-person roster with 16 fictional people, revoking supervisor-based
  // LETS access for everyone and skewing every budget allocation.
  const seed = fs.readFileSync('lets_app/server/91_setup/HCSeed.js', 'utf8');

  ok('it refuses when existing rows have real email addresses',
     /REFUSED: /.test(seed) && /with real email addresses/.test(seed),
     'an @example.gov address is RFC 2606 reserved, so anything else is real');

  // Checked BEFORE force is consulted, or the flag defeats the guard.
  const realCheck = seed.indexOf('realLooking > 0');
  const forceCheck = seed.indexOf('force !== true');
  ok('and that check runs BEFORE the force flag is read',
     realCheck > -1 && forceCheck > -1 && realCheck < forceCheck,
     'otherwise force:true bypasses the only guard that matters');

  ok('the refusal has no override',
     /There is no `force` for/.test(seed), 'overwriting a real roster ' +
     'with test data has no legitimate use');

  // And it must point at the right function, or the reader works around it.
  ok('it names importRoster as the correct alternative',
     /run importRoster\(\)/.test(seed));

  // The fixture emails must stay on a reserved domain, so identifySeedRows
  // keeps working and nothing can ever be delivered to an invented person.
  const addrs = seed.match(/email: '[^']+'/g) || [];
  ok('every fixture email is on a reserved domain',
     addrs.length > 0 && addrs.every(a => /@example\.(gov|com)'/.test(a)),
     addrs.filter(a => !/@example\.(gov|com)'/.test(a)));
}

// ---------------------------------------------------------------------------
console.log('\n12. the tab is resolved tolerantly, but never fuzzily');
{
  // previewRosterImport once failed twice with the same message — Tab
  // "FAS_HRLinks_Feed" was not found — the second time AFTER the default had
  // been corrected in the repository. The deployment was stale, and that is
  // invisible from the editor: the log is identical whether the default is
  // wrong or the code is old.
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');

  // THE REAL WORKBOOK HAS A TAB WITH A TRAILING SPACE: 'NEW - NTE REPORT '.
  // getSheetByName is exact, so a name typed without noticing that space
  // fails with an error reading "does not exist" about a tab that plainly
  // does.
  ok('tab lookup tolerates whitespace and case', /_findFeedTab_/.test(sync));
  const finder = sync.slice(sync.indexOf('function _findFeedTab_'),
                            sync.indexOf('function diagnoseHrFeedSource'));
  ok('it tries exact first', /ss\.getSheetByName\(want\)/.test(finder));
  ok('then trimmed', /getName\(\)\.trim\(\) === want/.test(finder));
  ok('then case-insensitive', /toLowerCase\(\) === lower/.test(finder));

  // AND STOPS THERE. 'FAS' must not resolve to 'FAS Recruit Data from STAR' —
  // that tab is in the same workbook, has different columns, and would
  // produce a roster of the wrong people.
  ok('it does NOT do prefix or substring matching',
     !/indexOf\(want\)/.test(finder) && !/startsWith/.test(finder),
     '"FAS" must not match "FAS Recruit Data from STAR"');

  // Both read paths must use it, or the preview succeeds and the import
  // fails on the same workbook.
  ok('both the preview and the import use the tolerant lookup',
     (sync.match(/_findFeedTab_\(ss, source\.tabName\)/g) || []).length >= 2,
     'a preview that resolves where the import does not is worse than both ' +
     'failing');

  // The error must name the actual tabs, quoted, or an admin cannot see the
  // trailing space that is causing the failure.
  ok('the failure quotes every tab name it found',
     /'"' \+ n \+ '"'/.test(sync),
     'an unquoted list hides the trailing space in "NEW - NTE REPORT "');
  ok('and names the property to set',
     /PROPS_KEYS\.FC_WF_FEED_TAB/.test(sync));
  // The stale-deployment note is gone with the default it was about: there is
  // no built-in tab name now, so "the property overrides the default" is no
  // longer a thing to explain. What replaces it is the diagnostic, which
  // lists the real tabs and carries a version marker — see §13.
  ok('and points at the diagnostic instead of explaining a default',
     /diagnoseHrFeedSource\(\)/.test(sync) &&
     !/older version of the code/.test(sync),
     'there is no tab default left to be stale about');
}

// ---------------------------------------------------------------------------
console.log('\n13. the deployment can be told apart from the code');
{
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');

  // A VERSION MARKER is the only way to tell "the default is wrong" from "the
  // deployment is behind the repository" without a second round trip.
  ok('there is a diagnostic entry point',
     /function diagnoseHrFeedSource\(\)/.test(sync));
  const diag = sync.slice(sync.indexOf('function diagnoseHrFeedSource'),
                          sync.indexOf('function previewRosterImport'));
  ok('it carries a version marker', /var MARKER = '/.test(diag),
     'if the marker is absent from the output, the deploy is stale and ' +
     'nothing else in the output can be trusted');
  ok('it reports the resolved spreadsheet and tab',
     /spreadsheetId: source\.spreadsheetId/.test(diag) &&
     /tabName: source\.tabName/.test(diag));
  ok('it lists the tabs actually present', /ss\.getSheets\(\)\.map/.test(diag));

  // The tab property must be printed with JSON.stringify, not bare. A
  // trailing space is otherwise invisible and that is the bug it diagnoses.
  ok('property values are printed quoted',
     /JSON\.stringify\(rawTab\)/.test(diag),
     'a bare print hides the whitespace that caused the failure');

  // It must NOT print the spreadsheet ID in full — the log is readable by
  // anyone with project access, and the ID is a capability.
  ok('the spreadsheet ID is reported as a length, not a value',
     /String\(rawId\)\.length \+ ' chars'/.test(diag),
     'an execution log is wider-read than the property store');

  // The header row, so a mapping failure is diagnosable in the same run.
  ok('it prints the feed header row',
     /headerRow/.test(diag) && /getRange\(1, 1, 1, found\.getLastColumn\(\)\)/.test(diag));

  // Read-only: this is the function an admin runs when confused, so it must
  // be safe to run at any time.
  ok('it writes nothing',
     !/setValue|appendRow|clearContent|setProperty/.test(diag),
     'the diagnostic must be safe to run on a live roster');
}

// ---------------------------------------------------------------------------
console.log('\n14. org scope — the feed is all of FAS, not just ASD');
{
  // THE DEFECT THIS PREVENTS. The FAS tab is 4,274 rows across five FAS
  // portfolios; ASD is about 914. Without a scope filter the import writes
  // roughly 3,360 non-ASD people into HC_Positions, and Access.js:435 grants
  // LETS access to ANYONE there whose Supervisory_Status is '2' — several
  // hundred supervisors from other portfolios, admitted silently. It would
  // also publish them to the org chart and quadruple the per-capita
  // denominator.
  ok('the default scope is FC', R.DEFAULT_ORG_SCOPE === 'FC',
     R.DEFAULT_ORG_SCOPE);

  ok('an ASD code is in scope', R.isInScope('FCBBBB') === true);
  ok('the root FC itself is in scope', R.isInScope('FC') === true);
  ok('another portfolio is not', R.isInScope('QMAB') === false);
  ok('nor is AAS', R.isInScope('FA10') === false);

  // ANCHORED, NOT A SUBSTRING TEST. 'XFC001' contains 'FC' and is not ours;
  // a substring match would import it.
  ok('a code merely CONTAINING the prefix is out of scope',
     R.isInScope('XFC001') === false,
     'indexOf without the === 0 anchor would let this through');

  ok('the scope is configurable for a narrower org',
     R.isInScope('FCA0B', 'FCA') === true &&
     R.isInScope('FCB0A', 'FCA') === false,
     '@clolry: eventually all 5 FAS portfolios, ASD first');

  const H = ['Position#', 'Employee Name', 'Dept ID (Org)',
             'Position Status', 'Supv Status'];
  const p = R.parseFeed([H,
    ['1', 'Asd,Person', 'FCBBBB', 'Filled', '2'],
    ['2', 'Other,Supervisor', 'QMAB', 'Filled', '2'],
    ['3', 'Other,Two', 'QMAC', 'Filled', '8'],
    ['4', 'NoOrg,Person', '', 'Filled', '8'],
    ['5', 'Aas,Person', 'FA10', 'Filled', '2']
  ], null);

  ok('only the in-scope position is imported',
     p.rows.length === 1 && p.rows[0].employeeName === 'Asd,Person',
     p.rows.map(r => r.employeeName));
  ok('out-of-scope rows are counted', p.outOfScope === 3, p.outOfScope);
  ok('and a row with no org code is counted separately',
     p.noOrgCode === 1, p.noOrgCode);

  // SEPARATE COUNTS, because "we cannot tell whose this is" and "this belongs
  // to another portfolio" need different responses — the first may be an ASD
  // person with a blank cell.
  ok('the two exclusion reasons are not conflated',
     p.outOfScope === 3 && p.noOrgCode === 1,
     'a blank org code may be an ASD person; an out-of-scope one is not');

  // The prefix breakdown is what makes 3,360 vanished rows confirmable as
  // "other portfolios" rather than "the org column was read wrongly" — both
  // produce the same count.
  ok('excluded rows are broken down by prefix',
     p.outOfScopeByPrefix.QM === 2 && p.outOfScopeByPrefix.FA === 1,
     p.outOfScopeByPrefix);
  ok('and the note names the risk of getting this wrong',
     /grant LETS access to supervisors outside/.test(p.scopeNote),
     p.scopeNote);

  // SCOPE IS DECIDED BEFORE THE DUPLICATE CHECK. If it were not, an
  // out-of-scope position number colliding with an in-scope one would BLOCK
  // the ASD row — someone in another portfolio could make an ASD person
  // invisible to routing and access.
  const collide = R.parseFeed([H,
    ['SHARED1', 'Asd,Person', 'FCBBBB', 'Filled', '2'],
    ['SHARED1', 'Other,Person', 'QMAB', 'Filled', '2']
  ], null);
  ok('an out-of-scope duplicate key does NOT block the in-scope row',
     collide.rows.length === 1 &&
     collide.rows[0].employeeName === 'Asd,Person' &&
     collide.blocked.length === 0,
     [collide.rows.map(r => r.employeeName), collide.blocked.length]);

  // And validation is not wasted on rows about to be discarded, or the
  // blocked list fills with thousands of irrelevant problems and buries the
  // handful that concern ASD.
  const noisy = R.parseFeed([H,
    ['', 'Other,NoPn', 'QMAB', 'Filled', '2'],
    ['9', 'Asd,Person', 'FCBBBB', 'Filled', '2']
  ], null);
  ok('out-of-scope rows do not appear in the blocked list',
     noisy.blocked.length === 0 && noisy.rows.length === 1,
     noisy.blocked);

  // Everything downstream must be computed on the SURVIVING rows only.
  ok('email coverage counts only in-scope staff',
     p.emailCoverage.staffedPositions === 1, p.emailCoverage);
}

// ---------------------------------------------------------------------------
console.log('\n15. the scope property defaults narrow, never wide');
{
  const props = fs.readFileSync('lets_app/server/00_config/Props.js', 'utf8');

  ok('there is an HR_ORG_SCOPE property',
     /HR_ORG_SCOPE:\s*'HR_ORG_SCOPE'/.test(props));

  // The slice must START AT THE JSDOC, not at the `function` keyword. My
  // first version sliced from `function getHrOrgScope` and then asserted on
  // the explanatory comment — which sits ABOVE that point, so the assertion
  // could only ever fail. The same slice-excludes-the-doc mistake would
  // silently PASS for any assertion about the body, which is why it is worth
  // naming.
  const docStart = props.lastIndexOf('/**',
                                     props.indexOf('function getHrOrgScope'));
  const getter = props.slice(docStart,
                             props.indexOf('function getLiabilityLogSource'));

  // UNLIKE THE FEED ID, THIS DEFAULTS. The difference is which way the
  // failure points: defaulting the scope narrow can only import too FEW
  // people, which is visible and recoverable. Defaulting wide imports too
  // many, which is neither.
  ok('an unset scope defaults to FC, the narrowest',
     /if \(!raw\) return 'FC';/.test(getter), getter.slice(0, 300));
  ok('and the comment explains why this defaults where the feed ID does not',
     /narrowest/.test(getter) && /no safe answer/.test(getter),
     'the asymmetry needs stating, or someone will "fix" the inconsistency');

  // A stray comma or space would silently void the scope — ' FC' matches
  // nothing once anchored, and 'FC,FA' matches nothing either. Both would
  // import ZERO positions and look like an entirely different bug.
  ok('punctuation is stripped rather than voiding the scope',
     /replace\(\/\[\^A-Z0-9\]\/g, ''\)/.test(getter), getter);
  ok('and an unusable value falls back to FC rather than matching nothing',
     /no usable org code/.test(getter), getter);

  // Both read paths must apply it, or the preview and the import disagree
  // about who is being imported.
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');
  ok('both the preview and the import pass the scope through',
     (sync.match(/parseFeed\(values, orgsByCode, \{ orgScope: scope \}\)/g) || [])
       .length === 2,
     'a preview that imports a different set than the import is worse than ' +
     'either being wrong');
  ok('the import logs what scope excluded',
     /excluded ' \+\s*\n?\s*parsed\.outOfScope/.test(sync) ||
     /parsed\.outOfScope \+/.test(sync), 'the audit trail needs the count');
}

// ---------------------------------------------------------------------------
console.log('\n16. the preview prints itself to the execution log');
{
  // @clolry ran previewRosterImport from the editor and the log showed only
  // the TravelDB reads and "Execution completed". A returned object goes
  // nowhere from the Run button — so the dry run did all its work and showed
  // nothing, which is worse than failing: it looks like it succeeded.
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');

  ok('the preview logs its payload', /_logRosterPreview_\(payload\)/.test(sync));

  const logger = sync.slice(sync.indexOf('function _logRosterPreview_'),
                            sync.indexOf('function importRoster'));
  ok('it states plainly that nothing was written',
     /NOTHING HAS BEEN WRITTEN/.test(logger), logger.slice(0, 200));
  ok('it leads with the scope note',
     logger.indexOf('SCOPE') < logger.indexOf('COUNTS'),
     'the first question is which people this covers');
  ok('it flags removals that are NOT test data',
     /CHECK THIS/.test(logger),
     'a real person removed loses LETS access and their org\'s headcount share');
  ok('it reports the email impact', /emailCoverage\.impact/.test(logger));
  ok('it reports the filled headcount and names what it drives',
     /per-capita budget denominator/.test(logger));
  ok('and the token comes LAST, after everything to be read',
     logger.lastIndexOf('p.token') > logger.indexOf('HEADCOUNT'),
     'putting the token first invites confirming without reading');
}

// ---------------------------------------------------------------------------
console.log('\n17. the org hierarchy must exist before the roster is useful');
{
  // @clolry's first live preview: 1,046 importable positions, 817 filled,
  // "service centers 0". The roster was correct and the DENOMINATOR did not
  // exist — HC_Orgs held only the four seed rows, which carry no Org_Level and
  // no Parent_Org_Code, so the walk to the nearest SERVICE_CENTER found
  // nothing.
  //
  // The import would have succeeded and every per-capita allocation would have
  // been zero, with the symptom appearing on the budget page two steps from
  // the cause.
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');
  const diag = fs.readFileSync('lets_app/server/99_triggers/Diagnostics.js', 'utf8');

  ok('the preview counts service centers in HC_Orgs',
     /orgLevel \|\| ''\)\.toUpperCase\(\) === 'SERVICE_CENTER'/.test(sync), sync.length);
  ok('and reports the hierarchy state in the payload',
     /orgHierarchy: \{/.test(sync) && /ready: serviceCenters > 0/.test(sync));

  // A ZERO MUST SAY WHICH CAUSE IT IS. "No hierarchy loaded" and "the roster
  // matched none of it" are a missing setup step and a data disagreement
  // respectively, and the count alone cannot distinguish them.
  ok('a zero names the missing-hierarchy cause',
     /BLOCKED: HC_Orgs holds/.test(sync), 'the number alone is ambiguous');
  ok('and names the fix',
     /run hcLoadRealOrgCodes\(\)/.test(sync));
  ok('and distinguishes it from a code mismatch',
     /org codes and HC_Orgs disagree/.test(sync),
     'a hierarchy that exists but matches nothing is a different problem');

  // runRosterImport must REFUSE, not warn. hcLoadRealOrgCodes is a ten-second
  // fix and the alternative is a roster whose budget output is silently zero.
  ok('runRosterImport refuses when the hierarchy is absent',
     /if \(!oh\.ready\) \{/.test(diag) &&
     /REFUSING: HC_Orgs has no service-center hierarchy/.test(diag));
  ok('and its refusal names hcLoadRealOrgCodes and its file',
     /hcLoadRealOrgCodes\(\) in 40_domain\/HCAdmin\.js/.test(diag));

  // The check runs BEFORE the deletes check, so the more fundamental problem
  // is reported first rather than being hidden behind a removal warning.
  ok('the hierarchy check precedes the deletions check',
     diag.indexOf('if (!oh.ready)') < diag.indexOf('if (c.deletes > 0)'),
     'otherwise a removal warning masks a missing hierarchy');
}

// ---------------------------------------------------------------------------
console.log('\n18. clearing the roster is deliberate, guarded and fails closed');
{
  // @clolry: "Remove all data in the existing HC sheet - I added our team for
  // testing purposes."
  //
  // Needed because runRosterImport REFUSES removals that are not recognizable
  // fixtures, and 8 of the 24 rows are hand-entered team members with real
  // @gsa.gov addresses. identifySeedRows is right to decline those — the
  // answer is a deliberate clear, not a weaker refusal.
  const seed = fs.readFileSync('lets_app/server/91_setup/HCSeed.js', 'utf8');
  const fn = seed.slice(seed.indexOf('function clearHCPositions'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));

  ok('clearHCPositions exists', body.length > 500, body.length);

  // FAILS CLOSED. My first version used
  //   (typeof _hcAdminGuard_ === 'function') ? _hcAdminGuard_() : null
  // which SKIPS the admin check when the guard is absent and then deletes
  // every row. For a destructive function, a missing guard must mean refuse.
  ok('a missing admin guard REFUSES rather than proceeding',
     /typeof _hcAdminGuard_ !== 'function'/.test(body) &&
     /Refusing to clear the roster/.test(body),
     'the ternary form fails OPEN, which is the wrong direction for a delete');
  ok('and it still calls the guard when present',
     /var denied = _hcAdminGuard_\(\);/.test(body));

  // HC_Orgs IS REFERENCE DATA. The per-capita split walks each position's
  // parent chain to the nearest SERVICE_CENTER row in it, so clearing it
  // would make every allocation zero — the exact defect §17 guards against.
  ok('it clears HC_POSITIONS only',
     body.indexOf('SHEET_NAMES.HC_POSITIONS') > -1 &&
     body.indexOf('SHEET_NAMES.HC_ORGS') === -1,
     'clearing HC_Orgs would zero every per-capita allocation');

  // DRY RUN BY DEFAULT, because the Run button passes no arguments. A misclick
  // must list and stop.
  ok('it is a dry run unless confirmed', /if \(confirm !== true\)/.test(body));
  ok('and a dry run reports success, not failure',
     /success: true, removed: 0, rows: rows, dryRun: true/.test(body),
     'a correct dry run returning success:false reads as a malfunction');

  // NAMES PRINTED BEFORE THE DELETE. An admin running this against the wrong
  // environment should see real names scroll past and stop — only possible if
  // the rows are printed before the write, not counted after it.
  const printAt = body.indexOf('rows.forEach(function (r) {');
  const clearAt = body.indexOf('.clearContent()');
  ok('every row is printed BEFORE anything is deleted',
     printAt > -1 && clearAt > -1 && printAt < clearAt,
     'counting after the fact is not a safeguard');
  ok('and each row is labeled fixture or real',
     /looksLikeFixture \? '\[fixture\] ' : '\[real\]/.test(body),
     'the 16-vs-8 distinction must be visible, not inferred');

  // The cache is six hours long. Without invalidation the access gate, org
  // chart and budget dashboard all keep serving deleted rows.
  ok('the HC cache is invalidated after the clear',
     /hcCacheInvalidateAll\(\)/.test(body));
  ok('and it takes the script lock',
     /LockService\.getScriptLock\(\)/.test(body),
     'saveHCPosition and importRoster both read the roster to validate');

  // It must point at what to do next, or the roster is left empty and the
  // app is in a worse state than before.
  ok('it names the next step',
     /runRosterPreview\(\)/.test(body), 'an empty roster is not a resting state');
}

// ---------------------------------------------------------------------------
console.log('\n19. the log limit does not eat the headcount table');
{
  // @clolry's run printed "Logging output too large. Truncating output." and
  // the thing cut off was the headcount — the one block the per-capita budget
  // depends on. It sits last in a payload carrying 1,046 positions' worth of
  // diff, so it is always the casualty.
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');
  const diag = fs.readFileSync('lets_app/server/99_triggers/Diagnostics.js', 'utf8');

  ok('there is a dedicated headcount printer',
     /function showServiceCenterHeadcount\(\)/.test(sync));
  ok('and it is admin-gated', /function showServiceCenterHeadcount\(\) \{\n  var denied = _hcAdminGuard_\(\);/.test(sync));

  // runRosterPreview must NOT dump the whole payload any more.
  ok('runRosterPreview no longer prints the entire payload',
     !/JSON\.stringify\(r\.data, null, 2\)/.test(diag),
     'that is what triggered the truncation');
  ok('it prints selected blocks instead',
     /--- column mapping ---/.test(diag) &&
     /--- would REMOVE \(not test data\) ---/.test(diag));
  ok('and points at the headcount printer',
     /showServiceCenterHeadcount\(\) in 40_domain\/HCRosterSync\.js/.test(diag));

  // THE QUIET FLAG IS A PARAMETER, NOT A FUNCTION SWAP. My first version
  // reassigned _logRosterPreview_ and restored it in a finally block. That
  // works — Apps Script function declarations are mutable globals — and is a
  // trap: two concurrent executions share those globals, so one run could
  // silence another's output or restore a stale reference.
  ok('the quiet mode is an option, not a global reassignment',
     /previewRosterImport\(\{ quiet: true \}\)/.test(sync) &&
     !/_logRosterPreview_ = function \(\) \{\}/.test(sync),
     'swapping a global function is not safe under concurrent executions');
  ok('and the default still logs',
     /if \(!quiet\) _logRosterPreview_\(payload\);/.test(sync),
     'the Run button passes no arguments, so the normal case must log');
}

// ---------------------------------------------------------------------------
console.log('\n20. one person holding two positions is counted once');
{
  // @clolry: "The obligated positions that I could find are ones that show
  // the person in a temp promotion so they are listed on the sheet twice
  // (once as temp promotion and once as obligated)."
  //
  // I had this backward. I suggested the denominator should be 823 rather
  // than 817 because the OBLIGATED rows' A/T action codes looked active —
  // true, and irrelevant. An OBLIGATED row is the person's PERMANENT seat held
  // open while they serve a temp promotion, and the same human is also on a
  // FILLED temp-promotion row. Counting OBLIGATED would DOUBLE-COUNT six
  // people, not find six missing ones. 817 is right.
  const H = ['Position#', 'Employee ID', 'Employee Name', 'Dept ID (Org)',
             'Position Status'];

  const real = R.parseFeed([H,
    // One person, two positions: temp promotion + permanent seat.
    ['90001', '0012345', 'Kelly,Shaun Michael', 'FCBAB', 'Filled'],
    ['90002', '0012345', 'Kelly,Shaun Michael', 'FCB0A', 'Obligated'],
    ['90003', '0067890', 'Other,Person', 'FCBAB', 'Filled']
  ], null);

  // BOTH ROWS ARE KEPT. They are real positions, and HC_Positions is a
  // position table — merging them would lose the permanent seat the person
  // returns to.
  ok('both positions are imported', real.rows.length === 3, real.rows.length);

  const d = real.duplicatePeople;
  ok('the person holding two positions is detected',
     d.peopleWithMultiplePositions === 1, d);
  ok('and is resolved by occupancy, not flagged as a problem',
     d.resolvedByOccupancy === 1 && d.doubleCounted === 0, d);
  ok('the note explains the temp-promotion shape',
     /temporary promotion plus their permanent seat/.test(d.note), d.note);

  // THE HEADCOUNT IS THE POINT. The person must appear once.
  const orgs = [
    { orgCode: 'FC', parentOrgCode: '', orgLevel: 'AC' },
    { orgCode: 'FCB', parentOrgCode: 'FC', orgLevel: 'DAC' },
    { orgCode: 'FCB0A', parentOrgCode: 'FCB', orgLevel: 'SERVICE_CENTER' },
    { orgCode: 'FCBA', parentOrgCode: 'FCB', orgLevel: 'OFFICE' },
    { orgCode: 'FCBAB', parentOrgCode: 'FCBA', orgLevel: 'SERVICE_CENTER' }
  ];
  const hc = R.previewHeadcount(real.rows, orgs);
  const filled = Object.keys(hc).reduce((s, k) => s + hc[k].filled, 0);
  ok('the filled headcount counts each PERSON once', filled === 2, hc);
  ok('and attributes them to their TEMP-PROMOTION org',
     hc['FCB|FCBAB'].filled === 2 && hc['FCB|FCB0A'].filled === 0,
     'that is where they currently work, so where travel would be approved');
  ok('while the permanent seat still counts as a vacancy there',
     hc['FCB|FCB0A'].vacant === 1 && hc['FCB|FCB0A'].authorized === 1,
     hc['FCB|FCB0A']);

  // THE CASE THAT WOULD BREAK THE BUDGET. Two FILLED rows for one person
  // double-counts them in the denominator, shifting every service-center
  // share by a fraction nobody would notice.
  const bad = R.parseFeed([H,
    ['90001', '0012345', 'Kelly,Shaun', 'FCBAB', 'Filled'],
    ['90002', '0012345', 'Kelly,Shaun', 'FCB0A', 'Filled']
  ], null);
  ok('two FILLED rows for one person are flagged',
     bad.duplicatePeople.doubleCounted === 1, bad.duplicatePeople);
  ok('and the note says the shares are wrong',
     /counted twice in the per-capita denominator/.test(bad.duplicatePeople.note),
     bad.duplicatePeople.note);
  ok('with the positions named so it can be resolved',
     bad.duplicatePeople.doubleCountedSamples[0].positions.length === 2,
     bad.duplicatePeople.doubleCountedSamples[0]);

  // MATCHED ON EMPLOYEE ID, NOT NAME. Two people sharing a name is a near
  // certainty at 1,046 positions, and a name-only match would report every
  // namesake pair as a duplicate person.
  const namesakes = R.parseFeed([H,
    ['90001', '0011111', 'Smith,Michael', 'FCBAB', 'Filled'],
    ['90002', '0022222', 'Smith,Michael', 'FCBAC', 'Filled']
  ], null);
  ok('two different people with the same name are NOT a duplicate',
     namesakes.duplicatePeople.peopleWithMultiplePositions === 0,
     namesakes.duplicatePeople);

  // Falls back to the name only when there is no ID to match on.
  const noId = R.parseFeed(
    [['Position#', 'Employee Name', 'Dept ID (Org)', 'Position Status'],
     ['90001', 'Kelly,Shaun', 'FCBAB', 'Filled'],
     ['90002', 'Kelly,Shaun', 'FCB0A', 'Obligated']], null);
  ok('with no Employee ID column it falls back to the name',
     noId.duplicatePeople.peopleWithMultiplePositions === 1,
     noId.duplicatePeople);

  // Vacant seats have no occupant, so they must not all collapse into one
  // "person" named VACANT.
  const vacants = R.parseFeed([H,
    ['90001', '', 'VACANT', 'FCBAB', 'Vacant'],
    ['90002', '', 'VACANT', 'FCBAC', 'Vacant']
  ], null);
  ok('vacant seats are not treated as one person holding two positions',
     vacants.duplicatePeople.peopleWithMultiplePositions === 0,
     vacants.duplicatePeople);
}

// ---------------------------------------------------------------------------
console.log('\n23. the occupancy vocabulary is MATCHED, not defaulted');
{
  // MEASURED on the live sheet by diagnoseHrFeedSource, 1,046 rows:
  //
  //   APPROVED        804
  //   VACANT          207
  //   OBLIGATED        19
  //   TEMP PROMOTION   11
  //   TEMPORARY         5
  //
  // normalizeOccupancy used to test for VACAN / OBLIGAT / FILL / ENCUMBER and
  // then fall through to a FILLED default. None of APPROVED, TEMP PROMOTION or
  // TEMPORARY contains any of those, so all 820 of them reached FILLED through
  // the FALLBACK rather than through a match.
  //
  // The answer came out roughly right, which is worse than being wrong: the
  // function whose header says it "DECIDES THE PER-CAPITA DENOMINATOR" was
  // guessing on 78% of the roster and nothing said so.
  const named = 'Doe,Jane';

  ok('APPROVED on a named row is FILLED',
     R.normalizeOccupancy('APPROVED', named) === 'FILLED');
  ok('TEMP PROMOTION is FILLED — the person is in the seat',
     R.normalizeOccupancy('TEMP PROMOTION', named) === 'FILLED');
  ok('TEMPORARY is FILLED — a term appointment is a person who travels',
     R.normalizeOccupancy('TEMPORARY', named) === 'FILLED');
  ok('OBLIGATED stays OBLIGATED', 
     R.normalizeOccupancy('OBLIGATED', named) === 'OBLIGATED');
  ok('VACANT stays VACANT',
     R.normalizeOccupancy('VACANT', named) === 'VACANT');

  // The retired HRLinks vocabulary must still classify, so re-importing an
  // older export does not silently change the roster's meaning.
  ok('the old feed\'s FILLED still works',
     R.normalizeOccupancy('Filled', named) === 'FILLED');
  ok('and ENCUMBERED', R.normalizeOccupancy('ENCUMBERED', named) === 'FILLED');

  // EACH OF THE FIVE IS RECOGNIZED, not absorbed. This is the assertion that
  // would have caught the original defect: the values classified correctly
  // either way, and only `isKnownOccupancy` distinguishes a match from a
  // fallback.
  ['APPROVED', 'VACANT', 'OBLIGATED', 'TEMP PROMOTION', 'TEMPORARY',
   'Filled', 'ENCUMBERED'].forEach(v => {
    ok('"' + v + '" is a RECOGNIZED status, not a fallback',
       R.isKnownOccupancy(v), 'it classified correctly by accident before');
  });

  // AND A GENUINELY NEW VALUE IS REPORTED. A named person still counts —
  // dropping them would understate the denominator — but the value is flagged
  // so HR adding a status is visible rather than absorbed.
  ok('an unseen status still counts a named person',
     R.normalizeOccupancy('SOME NEW HR STATUS', named) === 'FILLED');
  ok('but is NOT reported as recognized',
     !R.isKnownOccupancy('SOME NEW HR STATUS'),
     'this is the signal the old default never gave');

  // THE NAME STILL DECIDES FIRST, and on this feed that is load-bearing for a
  // new reason: 225 rows have no name but only 207 say VACANT. The other 18
  // are authorized-but-empty seats reading APPROVED. Trusting the status
  // column would turn all 18 into phantom people.
  ok('APPROVED with NO NAME is VACANT, not FILLED',
     R.normalizeOccupancy('APPROVED', '') === 'VACANT',
     '18 live rows are exactly this shape');
  ok('and a VACANT placeholder name overrides any status',
     R.normalizeOccupancy('APPROVED', 'VACANT (New position)') === 'VACANT');

  // NEGATIVE CONTROL: put the old fallback back and the recognition claim
  // collapses, while every classification above still passes. That asymmetry
  // is the point — the classifications were never the problem.
  {
    const src = fs.readFileSync(
      'lets_app/server/30_services/HCRosterImport.js', 'utf8');
    const patched = src.replace(
      "    'APPROVED':       'FILLED',", "    'XX_NOT_APPROVED': 'FILLED',");
    ok('control patched the vocabulary table', patched !== src);
    const mod = { exports: {} };
    new Function('module', 'exports', patched)(mod, mod.exports);
    ok('without the explicit entry, APPROVED still classifies as FILLED',
       mod.exports.normalizeOccupancy('APPROVED', named) === 'FILLED',
       'which is why the defect was invisible');
  }
}

// ---------------------------------------------------------------------------
console.log('\n24. Eberle is counted — one seat per PERSON, not per FILLED row');
{
  // @clolry: "Eberle should be included in the FCC0C headcount."
  //
  // Scott Eberle is the acting supervisor of the Non-IT Program Management
  // Service Center and his only row is OBLIGATED. The rule was a flat
  // `occupancyStatus === 'FILLED'`, so he was counted ZERO times — not in his
  // own center, not anywhere.
  //
  // AND NOTHING REPORTED IT. duplicatePeople returns early for anyone holding
  // fewer than two positions, so a lone OBLIGATED row was invisible to the one
  // diagnostic that could have caught it.
  //
  // The flat rule came from @clolry correcting me — an OBLIGATED row is
  // usually the permanent seat of someone serving a temp promotion, who is
  // ALSO on a filled row, so counting both double-counts them. True for the
  // PAIRED case. Measured on the live sheet: 19 OBLIGATED against 11 TEMP
  // PROMOTION, so at least eight people had no other row to be counted at.
  const rows = [
    // Eberle: obligated and nothing else.
    { positionNumber: 'P1', employeeId: 'E1', employeeName: 'Eberle,Scott M',
      orgCode: 'FCC0C', occupancyStatus: 'OBLIGATED' },
    // Kelly: temp promotion + permanent seat held open. The paired case.
    { positionNumber: 'P2', employeeId: 'E2', employeeName: 'Kelly,Shaun',
      orgCode: 'FCBAB', occupancyStatus: 'FILLED' },
    { positionNumber: 'P3', employeeId: 'E2', employeeName: 'Kelly,Shaun',
      orgCode: 'FCB0A', occupancyStatus: 'OBLIGATED' },
    { positionNumber: 'P4', employeeId: 'E3', employeeName: 'Other,Person',
      orgCode: 'FCC0C', occupancyStatus: 'FILLED' },
    { positionNumber: 'P5', employeeId: '', employeeName: '',
      orgCode: 'FCC0C', occupancyStatus: 'VACANT' }
  ];

  const pick = R.headcountCountable(rows);
  ok('three people, counted once each', pick.counted === 3, pick.counted);
  ok('EBERLE IS COUNTED, at his obligated seat',
     pick.countable[0] === true,
     'a flat FILLED rule counted him nowhere at all');
  ok('Kelly is counted at the TEMP PROMOTION seat, where she works',
     pick.countable[1] === true && !pick.countable[2],
     'that is where travel would be approved');
  ok('and her permanent seat is not counted again',
     pick.pairedAway === 1, pick.pairedAway);
  ok('the vacant seat is never countable', !pick.countable[4]);
  ok('Eberle is REPORTED as obligated-only, not silently absorbed',
     pick.lonelyObligated.length === 1 &&
     pick.lonelyObligated[0].employeeName === 'Eberle,Scott M',
     pick.lonelyObligated);
  ok('and the note explains both halves',
     /counted once each/.test(pick.note) &&
     /counted nowhere at all/.test(pick.note), pick.note);

  // THE HEADCOUNT, which is what actually moves money.
  const orgs = [
    { orgCode: 'FC', parentOrgCode: '', orgLevel: 'AC' },
    { orgCode: 'FCB', parentOrgCode: 'FC', orgLevel: 'DAC' },
    { orgCode: 'FCC', parentOrgCode: 'FC', orgLevel: 'DAC' },
    { orgCode: 'FCC0C', parentOrgCode: 'FCC', orgLevel: 'SERVICE_CENTER' },
    { orgCode: 'FCB0A', parentOrgCode: 'FCB', orgLevel: 'SERVICE_CENTER' },
    { orgCode: 'FCBA', parentOrgCode: 'FCB', orgLevel: 'OFFICE' },
    { orgCode: 'FCBAB', parentOrgCode: 'FCBA', orgLevel: 'SERVICE_CENTER' }
  ];
  const h = R.previewHeadcount(rows, orgs);
  ok('FCC0C has TWO filled — Eberle and Other',
     h['FCC|FCC0C'].filled === 2, h['FCC|FCC0C']);
  ok('and its vacancy is still counted as authorized',
     h['FCC|FCC0C'].vacant === 1 && h['FCC|FCC0C'].authorized === 3,
     h['FCC|FCC0C']);
  ok('Kelly lands at FCBAB, not at her obligated FCB0A',
     h['FCB|FCBAB'].filled === 1 && h['FCB|FCB0A'].filled === 0,
     'counting both would double her');

  // KEYED ON ROW INDEX, NOT POSITION NUMBER.
  //
  // The first version returned a set keyed on positionNumber. §9's rows carry
  // no position number, so every blank collapsed to the single key '' and one
  // countable row made every other blank-numbered row look countable — a
  // filled count of 4 where it should have been 3.
  const noPn = [
    { orgCode: 'FCC0C', occupancyStatus: 'FILLED' },
    { orgCode: 'FCC0C', occupancyStatus: 'VACANT' },
    { orgCode: 'FCC0C', occupancyStatus: 'FILLED' }
  ];
  const anon = R.headcountCountable(noPn);
  ok('rows with no position number do not collide',
     anon.counted === 2, anon.counted);
  ok('and the vacant one among them stays uncounted',
     anon.countable[0] && !anon.countable[1] && anon.countable[2],
     anon.countable);

  // AN ANONYMOUS SEAT IS STILL COUNTED, because the committed sheet can hold
  // a hand-edited FILLED row with no name and the old rule counted it.
  // Dropping it would be the same class of bug as dropping Eberle.
  ok('a FILLED row with no name or ID is still counted',
     R.headcountCountable([
       { positionNumber: 'X', employeeId: '', employeeName: '',
         orgCode: 'FCC0C', occupancyStatus: 'FILLED' }]).counted === 1);
  // But an anonymous OBLIGATED seat has no occupant for the Eberle rule to
  // apply to, so it must not be counted.
  ok('an OBLIGATED row with no name is NOT counted',
     R.headcountCountable([
       { positionNumber: 'X', employeeId: '', employeeName: '',
         orgCode: 'FCC0C', occupancyStatus: 'OBLIGATED' }]).counted === 0,
     'there is no person there to count');

  // NEGATIVE CONTROL 1: the flat FILLED rule. Must drop Eberle.
  {
    const src = fs.readFileSync(
      'lets_app/server/30_services/HCRosterImport.js', 'utf8');
    const patched = src.replace(
      "      var counts = !!pick.countable[rowIndex];",
      "      var counts = row.occupancyStatus === 'FILLED';");
    ok('control 1 patched the headcount rule', patched !== src);
    const mod = { exports: {} };
    new Function('module', 'exports', patched)(mod, mod.exports);
    const bad = mod.exports.previewHeadcount(rows, orgs);
    ok('a flat FILLED rule counts FCC0C as ONE, dropping Eberle',
       bad['FCC|FCC0C'].filled === 1,
       'this is the bug @clolry reported');
  }

  // NEGATIVE CONTROL 2: count OBLIGATED as filled too — the naive fix. Must
  // double-count Kelly, which is why the flat rule existed in the first place.
  {
    const src = fs.readFileSync(
      'lets_app/server/30_services/HCRosterImport.js', 'utf8');
    const patched = src.replace(
      "      var counts = !!pick.countable[rowIndex];",
      "      var counts = row.occupancyStatus === 'FILLED' || " +
      "row.occupancyStatus === 'OBLIGATED';");
    ok('control 2 patched the headcount rule', patched !== src);
    const mod = { exports: {} };
    new Function('module', 'exports', patched)(mod, mod.exports);
    const bad = mod.exports.previewHeadcount(rows, orgs);
    ok('counting OBLIGATED outright double-counts Kelly',
       bad['FCB|FCB0A'].filled === 1 && bad['FCB|FCBAB'].filled === 1,
       'she appears in two service centers at once — the error nobody finds');
  }
}

// ---------------------------------------------------------------------------
console.log('\n25. the preview reports ONE denominator, and names the fields it changes');
{
  // TWO DIFFERENT FILLED COUNTS IN ONE PREVIEW. @clolry's live run:
  //
  //   HEADCOUNT — the per-capita budget denominator
  //     filled positions       821
  //   NOTE: 815 of 1046 positions are FILLED. That is the number the
  //         per-capita budget split divides by …
  //
  // Six apart, in one output, both claiming to be the denominator. The COUNTS
  // block came from previewHeadcount, which counts ONE SEAT PER PERSON since
  // d27e449; the note counted `occupancyStatus === 'FILLED'`, the rule
  // d27e449 replaced. The six are the people whose only seat is OBLIGATED —
  // Scott Eberle among them.
  //
  // The note was also the WRONG one: it understated the denominator, so every
  // service center's share computed from it would have been slightly too
  // large.
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  const code = strip(sync);

  ok('the preview note uses headcountCountable, not a FILLED tally',
     /HCRosterImport\.headcountCountable\(parsed\.rows\)/.test(code),
     'the same function the budget split uses, so they cannot disagree');
  ok('and no longer counts occupancyStatus === FILLED for the denominator',
     !/if \(r\.occupancyStatus === 'FILLED'\) filled\+\+/.test(code),
     'that was the pre-d27e449 rule and it dropped the obligated-only people');
  ok('the note says one seat per PERSON',
     /one seat per PERSON/.test(sync),
     'otherwise a reader cannot tell why it differs from a FILLED count');
  ok('and names the obligated-only people it counts',
     /lonelyObligated/.test(code),
     'six unexplained extra bodies in a denominator is worse than none');

  // THE NUMBERS MUST ACTUALLY AGREE. previewHeadcount and the note both
  // derive from headcountCountable now, so assert that on real data rather
  // than trusting the source text.
  const orgs = [
    { orgCode: 'FC', parentOrgCode: '', orgLevel: 'AC' },
    { orgCode: 'FCC', parentOrgCode: 'FC', orgLevel: 'DAC' },
    { orgCode: 'FCC0C', parentOrgCode: 'FCC', orgLevel: 'SERVICE_CENTER' }
  ];
  const rows = [
    // Eberle: obligated only. Counts once.
    { positionNumber: 'P1', employeeId: 'E1', employeeName: 'Eberle,Scott M',
      orgCode: 'FCC0C', occupancyStatus: 'OBLIGATED' },
    { positionNumber: 'P2', employeeId: 'E2', employeeName: 'Other,Person',
      orgCode: 'FCC0C', occupancyStatus: 'FILLED' },
    { positionNumber: 'P3', employeeId: '', employeeName: '',
      orgCode: 'FCC0C', occupancyStatus: 'VACANT' }
  ];
  const hc = R.previewHeadcount(rows, orgs);
  const headcountFilled = Object.keys(hc)
    .reduce((s, k) => s + hc[k].filled, 0);
  const noteFilled = R.headcountCountable(rows).counted;
  ok('previewHeadcount and headcountCountable agree on the denominator',
     headcountFilled === noteFilled, { headcountFilled, noteFilled });
  ok('and both include the obligated-only person',
     noteFilled === 2,
     'a raw FILLED tally would say 1 and drop Eberle');

  // THE FIELD BREAKDOWN. '1046 change, 0 unchanged' is true and
  // unreviewable — it reads identically whether every row gained an email
  // address or every row's org code moved. The first is the expected result
  // of switching sources; the second would rewrite the hierarchy and every
  // per-capita share with it.
  ok('the preview payload counts changes per FIELD',
     /changedFields:/.test(code),
     'a bare change count is a number somebody has to accept on faith');
  ok('and the printed report lists them',
     /fields changed, across those rows/.test(sync));
  ok('and says which fields are expected to move versus alarming',
     /A LARGE COUNT ON emailAddress IS THE EXPECTED RESULT/.test(sync) &&
     /the hierarchy is about to be rewritten/.test(sync),
     'the reader has to decide whether to apply it');

  // AND IT SHOWS AN EXAMPLE VALUE PER FIELD. A count is not enough:
  // @clolry's run reported dutyStationState changing on 1045 of 1046 rows,
  // which could mean full state names replacing abbreviations, or the column
  // being blanked, or 'VA' compared against 'va'. Those have very different
  // consequences and the count reads the same for all three.
  ok('the report shows one example of each changed field',
     /one example of each, old -> new/.test(sync),
     'a count cannot distinguish a format change from data loss');
  ok('and renders an empty new value as (blank) rather than nothing',
     /\(blank\)/.test(sync),
     'an invisible blank is how a column gets erased without anyone noticing');
  ok('and warns that a change to blank is a LOSS',
     /is a LOSS/.test(sync));
  ok('and names what duty city and state actually drive',
     /airfare from the duty city/.test(sync) && /OCONUS/.test(sync),
     'they are not display fields — a silent change there moves money');

  // A SHRINKING TITLE CAN REVOKE ACCESS. @clolry's preview showed the FC feed
  // truncating Position Title: 'Asst. Commissioner, Office of Acq. Solutions
  // Development' arrives as 'Asst. Commissioner, Office of'.
  //
  // Access.js:865 admits a Chief of Staff or Client Executive by SEARCHING
  // THE TITLE for those words, so a title carrying them late would lose them
  // and the person would stop being able to sign in with nothing to explain
  // it. 'Chief of Staff' as a whole title is 14 characters and survives;
  // 'Supervisory Program Analyst (Chief of Staff)' would not.
  ok('the preview checks whether a BU-lead title loses its matched words',
     /BU_LEAD_WORDS/.test(code),
     'a title match is access, so a shorter title is a revocation');
  ok('and states the all-clear when none does, rather than staying silent',
     /No BU-lead title/.test(sync),
     'absence of a warning is not the same as a check having run');
  ok('and tells the admin what to do first when one would',
     /Travel_User_Roles row BEFORE applying/.test(sync));
  ok('the words it checks are the ones Access.js actually matches',
     /'chief of staff', 'client executive'/.test(sync) &&
     /'chief of staff'/.test(
       fs.readFileSync('lets_app/server/30_services/Access.js', 'utf8')),
     'two copies of a match list is how one goes stale');
}

// ---------------------------------------------------------------------------
console.log('\n26. the diff reads BOTH shapes, so a change can actually resolve');
{
  // THE TWO SIDES OF diffRoster HAVE DIFFERENT SHAPES.
  //
  //   incoming  parsed feed rows from interpretRow — FLAT:
  //               r.dutyStationCity, r.dutyStationState
  //   existing  HC bundle records from HCData._normalizePosition_ — NESTED:
  //               p.location.city, p.location.state
  //
  // The comparison read `prior.dutyStationCity`, which is undefined on every
  // existing row, so the feed's 'WASHINGTON' differed from '' forever.
  //
  // @clolry's preview reported 1,045 duty-state and 1,039 duty-city changes.
  // He applied the import. The next preview reported THE SAME COUNTS — the
  // data had been written correctly all along and the diff was reading the
  // wrong property. Seven of the ten fields went away; these three did not.
  //
  // A field whose change never resolves is worse than one that is not
  // compared at all: it trains the reader to ignore the change list, which is
  // the one place a genuinely bad import would announce itself.

  // A feed row, flat.
  const incoming = [{
    positionNumber: 'P1', employeeId: '1', employeeName: 'Doe,Jane',
    emailAddress: 'jane@gsa.gov', orgCode: 'FCA0B', officeTitle: 'Analyst',
    grade: '15', supervisoryStatus: '2', occupancyStatus: 'FILLED',
    lcat: '0343', locationCode: '0000000172',
    reportsToPositionNumber: 'P0',
    dutyStationCity: 'WASHINGTON', dutyStationState: 'DC'
  }];
  // The SAME person as the HC bundle yields them — city and state nested,
  // location code unpadded because Location_Code is not pinned to text.
  const existing = [{
    positionNumber: 'P1', employeeId: '1', employeeName: 'Doe,Jane',
    emailAddress: 'jane@gsa.gov', orgCode: 'FCA0B', officeTitle: 'Analyst',
    grade: '15', supervisoryStatus: '2', occupancyStatus: 'FILLED',
    lcat: '0343', locationCode: '172',
    reportsToPositionNumber: 'P0',
    location: { address1: '', city: 'WASHINGTON', state: 'DC' }
  }];

  const d = R.diffRoster(incoming, existing);
  ok('an unchanged person reports NO changes',
     d.changes.length === 0 && d.unchanged.length === 1,
     d.changes.length ? d.changes[0].fields : d);

  // A REAL CHANGE MUST STILL REPORT. The fix is reading the right property,
  // not ignoring the field — and ignoring it would have been the easy wrong
  // answer, since duty city drives airfare pricing.
  const moved = JSON.parse(JSON.stringify(existing));
  moved[0].location.city = 'PHILADELPHIA';
  const dm = R.diffRoster(incoming, moved);
  ok('a genuine duty-city change still reports',
     dm.changes.length === 1 &&
     dm.changes[0].fields[0].field === 'dutyStationCity', dm.changes);
  ok('and carries the old value, not a blank',
     dm.changes[0].fields[0].from === 'PHILADELPHIA',
     'reading the wrong property reported every old value as blank');

  const stateMoved = JSON.parse(JSON.stringify(existing));
  stateMoved[0].location.state = 'PA';
  ok('a genuine duty-state change still reports',
     R.diffRoster(incoming, stateMoved).changes.length === 1);

  // LOCATION CODE: '0000000172' vs 172 is the same code. The feed pads it and
  // the sheet stores a number, because Location_Code is not pinned to text —
  // so a string compare reported 763 changes no import could settle. The
  // padding carries no meaning; nothing joins on this column.
  ok('a zero-padded location code equals its unpadded form',
     d.changes.length === 0, 'the sheet stores 172, the feed sends 0000000172');

  // BUT ONLY WHEN BOTH SIDES ARE NUMERIC. 'DC-CENTRAL' to '172' is a real
  // change and must not be normalized away — HCSeed uses codes like that.
  const codeMoved = JSON.parse(JSON.stringify(existing));
  codeMoved[0].locationCode = 'DC-CENTRAL';
  const dc = R.diffRoster(incoming, codeMoved);
  ok('a non-numeric location code change still reports',
     dc.changes.length === 1 &&
     dc.changes[0].fields[0].field === 'locationCode', dc.changes);

  // The pre-existing normalizations must survive the rewrite.
  const cased = JSON.parse(JSON.stringify(existing));
  cased[0].emailAddress = 'JANE@GSA.GOV';
  cased[0].orgCode = 'fca0b';
  ok('email and org code are still compared case-insensitively',
     R.diffRoster(incoming, cased).changes.length === 0,
     'a case-only difference is not a change');

  // THE SPEC LIST MUST COVER EVERY FIELD THE WRITE EMITS, or a field nobody
  // compares can drift silently. Checked against the write in HCRosterSync
  // rather than against a hand-kept list.
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');
  const src = fs.readFileSync('lets_app/server/30_services/HCRosterImport.js', 'utf8');
  const compared = [...src.matchAll(/\{ field: '(\w+)'/g)].map(m => m[1]);
  ['emailAddress', 'orgCode', 'officeTitle', 'grade', 'supervisoryStatus',
   'occupancyStatus', 'lcat', 'locationCode', 'dutyStationCity',
   'dutyStationState', 'employeeId', 'employeeName',
   'reportsToPositionNumber'].forEach(f => {
    ok('the diff compares ' + f, compared.indexOf(f) > -1);
  });
  ok('and the nested ones carry a reader for the bundle shape',
     /from: function \(p\) \{ return \(p\.location \|\| \{\}\)\.city/.test(src) &&
     /from: function \(p\) \{ return \(p\.location \|\| \{\}\)\.state/.test(src),
     'without it the comparison reads undefined on every existing row');
  ok('Duty_Station_City is written, so comparing it is not pointless',
     /'Duty_Station_City': r\.dutyStationCity/.test(sync));
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
