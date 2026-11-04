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
 * existed came from that stale file — 807 filled positions, 22 service-centre
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
console.log('\n1b. the REAL FAS HRLinks headers, as supplied by @clolry');
{
  // All 33, verbatim. This is the mapping the import will actually use, so it
  // is asserted column by column rather than counted.
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

  // 'Position#' has NO space before the hash. My original hints had 'Position
  // Number', 'Position #' and 'PN' and missed it, so the import refused —
  // which is how the gap became visible instead of silently importing a
  // roster with no join key.
  ok('Position# maps despite having no space',
     m.mapping.positionNumber === 'Position#', m.mapping.positionNumber);

  // 'Dept ID (Org)' not 'POI'. A POI is a payroll servicing code shared by
  // several orgs, so keying budget attribution off it would merge unrelated
  // service centres.
  ok('the org code comes from Dept ID (Org)',
     m.mapping.orgCode === 'Dept ID (Org)', m.mapping.orgCode);
  ok('and NOT from POI',
     m.mapping.orgCode !== 'POI' && m.unmapped.indexOf('POI') > -1,
     'a POI is shared across orgs; it would merge service centres');

  // The supervisor join must be on the position NUMBER, not the name. Two
  // people can share a name, and hcWalkSupervisorChain follows numbers.
  ok('the supervisor join uses Reports To Position #',
     m.mapping.reportsTo === 'Reports To Position #', m.mapping.reportsTo);
  ok('and ignores Reports To Name',
     m.unmapped.indexOf('Reports To Name') > -1,
     'a name is not a key — the chain joins on position numbers');

  // 'Position Status' over the bare 'Status'. The feed has both; the choice
  // decides the per-capita denominator.
  ok('occupancy comes from Position Status',
     m.mapping.occupancyStatus === 'Position Status', m.mapping.occupancyStatus);
  ok('and the bare Status column is read only for cross-checking',
     m.mapping.secondaryStatus === 'Status', m.mapping.secondaryStatus);

  ok('grade comes from the PP-Series-Grd composite',
     m.mapping.grade === 'PP-Series-Grd', m.mapping.grade);
  ok('supervisory status comes from Supv Status',
     m.mapping.supervisoryStatus === 'Supv Status');

  // THE GAP THAT MATTERS. 33 columns and not one email address.
  ok('there is NO email column in the feed',
     !('emailAddress' in m.mapping),
     'Access.js matches the signed-in user against Email_Address');
  ok('and emailAddress is deliberately not a required field',
     R.REQUIRED_FIELDS.indexOf('emailAddress') === -1,
     'requiring it would block the import and leave LETS on fictional data');
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
  // only makes sense beside a position-level status. That is a judgement, and
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
  ok('a disagreeing row is reported', d.conflicts === 1, d);
  ok('and the note explains what a large count would mean',
     /the wrong column was chosen/.test(d.note), d.note);

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
  ok('an unrecognised code is preserved, not defaulted',
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
  ok('the importer reads the FAS HR feed property',
     /getFasHrFeedSource\(\)/.test(sync));

  const props = fs.readFileSync('lets_app/server/00_config/Props.js', 'utf8');
  ok('and that property is FAS_HRLinks_Feed',
     /FAS_HR_FEED:\s*'FAS_HRLinks_Feed'/.test(props));

  // NO DEFAULT. Every other getter in Props.js falls back to something
  // sensible; this one must not, because every available fallback is a stale
  // roster — which is the failure being prevented.
  const getter = props.slice(props.indexOf('function getFasHrFeedSource'),
                             props.indexOf('function getLiabilityLogSource'));
  ok('an unset HR feed property is an ERROR, not a default',
     /ok:\s*false/.test(getter) && /is not set/.test(getter),
     'defaulting to a stale roster is exactly what went wrong');
  ok('and the error explains why there is no fallback',
     /no other source|no fallback/i.test(getter), getter.slice(0, 200));

  // The two spreadsheet IDs must not be in the OPTIONAL set, or setup can
  // complete without them and the importer fails at the point of use.
  const optionalBlock = props.slice(props.indexOf('const OPTIONAL = new Set(['),
                                    props.indexOf(']);', props.indexOf('const OPTIONAL')));
  ok('FAS_HR_FEED is NOT optional',
     !/'FAS_HR_FEED'/.test(optionalBlock), optionalBlock.slice(0, 200));
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
  // HCData.hcServiceCentreHeadcount's rule. Duplicated rules drift, so this
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

  // A DIVISION rolls up to its service centre. Mould sits at FCBBBB, which is
  // Division 2 of Acquisition Service Center 2.
  ok('a division-level position rolls up to its service centre',
     h['FCB|FCBBB'] && h['FCB|FCBBB'].filled === 3,
     h['FCB|FCBBB']);
  ok('and its vacant seat is counted separately, not dropped',
     h['FCB|FCBBB'].vacant === 1 && h['FCB|FCBBB'].authorised === 4,
     h['FCB|FCBBB']);

  // An unlisted code resolves to its nearest listed ancestor by prefix — the
  // same rule HCData.resolveOrgByCode uses — so the money still lands.
  ok('an org code absent from HC_Orgs resolves to its nearest parent',
     h['FCB|FCBBB'].filled === 3,
     'FCBBBBZZ must count toward FCBBB, not vanish');

  // Someone sitting directly at the DAC is NOT discarded. Dropping them would
  // inflate every service centre's share and the total would still foot.
  ok('a position above any service centre gets its own bucket',
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
  // previewRosterImport failed twice with the same message — Tab
  // "FAS_HRLinks_Feed" was not found — the second time AFTER the default had
  // been corrected to 'FAS' in the repository. The deployment was stale, and
  // that is invisible from the editor: the log is identical whether the
  // default is wrong or the code is old.
  const sync = fs.readFileSync('lets_app/server/40_domain/HCRosterSync.js', 'utf8');

  ok('the tab default is FAS, not the property name',
     /tabName: tab \|\| 'FAS'/.test(
       fs.readFileSync('lets_app/server/00_config/Props.js', 'utf8')),
     'defaulting a value to the key that holds it was the original mistake');

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
     /PROPS_KEYS\.FAS_HR_FEED_TAB/.test(sync));
  ok('and warns that a stale deployment produces this same message',
     /older version of the code/.test(sync),
     'this exact confusion cost a diagnostic round trip');
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

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
