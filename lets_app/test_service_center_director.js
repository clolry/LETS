/**
 * Service Center Director resolution, and the service-center scope match.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Five call sites identified an SCD by matching officeTitle against the
 * literal string 'sector director'. @clolry: "We don't call them Sector
 * Directors, we call them Service Center Directors." No position in this
 * organization carries that title, so all five found NOBODY — for as long as
 * the code had existed.
 *
 * Nothing failed. findSectorDirector returned null, determineInitialRouting
 * took its documented "no SD found" branch, and every request in LETS started
 * at the DAC stage with Sector_Director_Name blank. That was accurate: no SCD
 * had ever reviewed anything.
 *
 * A SECOND DEFECT HAD TO BE FIXED IN THE SAME CHANGE
 * --------------------------------------------------
 * Roughly a dozen sites derived a "sector code" as orgCode.substring(0, 4).
 * That was right for the inherited org — their codes ran QFA (business unit) >
 * QFAA (sector), so four characters WAS the sector — and wrong here, where a
 * service center is five characters. 'FCA0' is not an org code at all; the
 * '0' is a filler, not a level. The 22 centers collapsed into 6 buckets.
 *
 * The two defects concealed each other. Fixing only the title match would
 * have made things WORSE: a newly-correct SCD returns 'FCA0B' while the
 * dashboards still compute 'FCA0' from the request side, the two never
 * compare equal, and the director reaches their queue to find it empty —
 * which reads as "no requests yet" rather than as a bug. §4 is the assertion
 * that stops those two halves being separated again.
 *
 * THE FIXTURE IS THE REAL ORG HIERARCHY from HCSeed.hcRealOrgRecords(), 137
 * rows, because the whole class of defect here is a rule that looks right
 * against invented codes and fails against this org's actual shape. The
 * positions are the real ones from @clolry's diagServiceCenterDirectors run.
 *
 * Run: node lets_app/test_service_center_director.js
 */

const fs = require('fs');
const vm = require('vm');
const SERVER = __dirname + '/server/';

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 240)); fails++; }
};

// ---------------------------------------------------------------------------
// The real org hierarchy, loaded the way test_hc_data.js loads HCSeed.
// ---------------------------------------------------------------------------
const seedCtx = vm.createContext({
  console: { log() {}, warn() {}, error() {} },
  JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt, parseFloat,
  RegExp, Error, Boolean
});
vm.runInContext(
  'var TRAVEL_DB_SPREADSHEET_ID=null; var SHEET_NAMES={}; var TRAVEL_SHEET_SCHEMAS={};',
  seedCtx);
vm.runInContext(fs.readFileSync(SERVER + '91_setup/HCSeed.js', 'utf8'), seedCtx);
const ORGS = vm.runInContext('hcRealOrgRecords()', seedCtx);

/**
 * Loads getSectorDirector + isSectorDirector + orgCodeInScope in a vm with
 * HC and the role reader stubbed.
 *
 * Access.js is sliced rather than evaluated whole: it depends on TravelDB,
 * Email and half the domain layer, none of which these functions touch.
 */
function build(positions, roles) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Array, Math, parseFloat, parseInt,
    isNaN, RegExp, Error, Boolean,
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => null }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, removeAll() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Session: { getActiveUser: () => ({ getEmail: () => 't@gsa.gov' }) }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';", ctx);
  vm.runInContext(fs.readFileSync(SERVER + '01_constants/Sheets.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(SERVER + '01_constants/HCRules.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(SERVER + '20_data/HCData.js', 'utf8'), ctx);
  vm.runInContext(`
    var __orgs = ${JSON.stringify(ORGS)};
    var __pos  = ${JSON.stringify(positions)};
    var __roles = ${JSON.stringify(roles || {})};
    HC.hcGetOrgHierarchy = function () { return __orgs; };
    HC.hcGetBundle = function () { return { success: true, data: __pos }; };
    function _getUnifiedRolesForEmail(e) { return __roles[e] || []; }
    function _getUnifiedRoleData() { return { rolesByEmail: __roles, hasData: true }; }
    function loadOrgLookups() {
      var orgToSector = {};
      for (var i = 0; i < __orgs.length; i++) {
        if (__orgs[i].sector) orgToSector[__orgs[i].orgCode] = __orgs[i].sector;
      }
      return { orgToBU: {}, orgToSector: orgToSector, orgToCurrentOrgCode: {} };
    }
    function TravelDB() {}
  `, ctx);

  const src = fs.readFileSync(SERVER + '30_services/Access.js', 'utf8');
  vm.runInContext(
    src.slice(src.indexOf('function getSectorDirector'),
              src.indexOf('// UNIFIED USER/ROLE READER')),
    ctx, { filename: 'Access.scd.js' });
  vm.runInContext(
    src.slice(src.indexOf('function isSectorDirector'),
              src.indexOf('function isActiveBUReviewer')),
    ctx, { filename: 'Access.scope.js' });

  return {
    scd: (code) => vm.runInContext(
      'getSectorDirector(' + JSON.stringify(code) + ')', ctx),
    isSD: (email) => vm.runInContext(
      'isSectorDirector(' + JSON.stringify(email) + ')', ctx),
    inScope: (code, scope) => vm.runInContext(
      'orgCodeInScope(' + JSON.stringify(code) + ',' + JSON.stringify(scope) + ')', ctx)
  };
}

/** A position, in the shape HCData.hcGetBundle yields. */
const P = (pn, email, name, org, sup, grade, occ, title) => ({
  positionNumber: pn, emailAddress: email, employeeName: name, orgCode: org,
  supervisoryStatus: sup, grade: grade, occupancyStatus: occ,
  // NOT 'Sector Director'. These are the real titles from @clolry's run, and
  // using them means a reintroduced title match fails this suite rather than
  // passing against a convenient fixture.
  officeTitle: title || 'Supervisory Contract Specialist'
});

// The roster shapes diagServiceCenterDirectors found on the live sheet.
const POSITIONS = [
  P('1', 'paulette.sepulvado@gsa.gov', 'Fortener,Paulette Sepulvado', 'FCA0B', '2', '15', 'FILLED', 'Supervisory Program Analyst'),
  // FCA0A reported [NONE] under the old rule. @clolry: "FCA0A's supervisor is
  // Taylor Wynings but his supervisor code is something other than 2."
  P('2', 'taylor.wynings@gsa.gov', 'Wynings,Taylor', 'FCA0A', '4', '14', 'FILLED'),
  // FCA0E reported [3!]: one filled, two VACANT at grade 13.
  P('3', 'kristen.irvin@gsa.gov', 'Irvin,Kristen T', 'FCA0E', '2', '15', 'FILLED', 'Supervisory Management and Program Analyst'),
  P('4', '', '', 'FCA0E', '2', '13', 'VACANT', 'Supervisory Transportation Operations Specialist'),
  P('5', '', '', 'FCA0E', '2', '13', 'VACANT', 'Transportation Operations Officer (Motor)'),
  // FCC0B reported [2!]: one filled, one vacant, both grade 15.
  P('6', 'kyra.stewart@gsa.gov', 'Stewart,Kyra', 'FCC0B', '2', '15', 'FILLED', 'Program Analysis Officer'),
  P('7', '', '', 'FCC0B', '2', '15', 'VACANT', 'Program Analysis Officer'),
  // A supervisor in a BRANCH under FCA0B. Must never be its director.
  P('8', 'div.head@gsa.gov', 'Head,Division', 'FCA0BAA', '2', '15', 'FILLED'),
  // A genuine tie: two OCCUPIED supervisory seats at one center.
  P('9', 'low.grade@gsa.gov', 'Low,Grade', 'FCB0A', '2', '14', 'FILLED'),
  P('10', 'high.grade@gsa.gov', 'High,Grade', 'FCB0A', '7', '15', 'FILLED'),
  // Scott Eberle: acting supervisor, OBLIGATED seat. Counted in the headcount
  // (see test_hc_data.js) but he cannot APPROVE from a seat he is not in.
  P('11', 'scott.eberle@gsa.gov', 'Eberle,Scott M', 'FCC0C', '2', '15', 'OBLIGATED', 'Acquisition Manager'),
  // A center whose only supervisory seat is unfilled.
  P('12', '', '', 'FCB0B', '2', '15', 'VACANT', 'Supervisory Compliance Analyst')
];

const A = build(POSITIONS);

// ---------------------------------------------------------------------------
console.log('\n1. the director is found by LEVEL, not by title');
{
  const sd = A.scd('FCA0B');
  ok('a service center resolves to its director',
     sd && sd.email === 'paulette.sepulvado@gsa.gov', sd);
  ok('and reports the FULL service-center code, not a 4-char prefix',
     sd && sd.sectorCode === 'FCA0B',
     'FCA0 is not an org code — the 0 is a filler, not a level');
  ok('the title is NOT "Sector Director" anywhere in the fixture',
     POSITIONS.every(p => String(p.officeTitle).toLowerCase()
       .indexOf('sector director') === -1),
     'so a reintroduced title match fails this suite rather than passing');

  // A BRANCH ROLLS UP TO ITS CENTER. The submitter's org code is their own —
  // FCA0BAA — and the walk has to climb, not truncate.
  const deep = A.scd('FCA0BAA');
  ok('a branch-level org code resolves to the same director',
     deep && deep.email === 'paulette.sepulvado@gsa.gov', deep);
  ok('and names the center, not the branch',
     deep && deep.sectorCode === 'FCA0B', deep);

  // A SUPERVISOR INSIDE A CENTER IS NOT ITS DIRECTOR.
  ok('a branch supervisor is never the center director',
     A.scd('FCA0B').email !== 'div.head@gsa.gov',
     'an indexOf-prefix test would have matched every division head');
}

// ---------------------------------------------------------------------------
console.log('\n2. supervisory means ANY code except 8');
{
  // THE FCA0A CASE. Measured vocabulary, with the feed's own descriptions:
  //   2 = Supervisor or Manager (167)   4 = Supervisor (CSRA) (6)
  //   5 = Management Official CSRA (1)  7 = Team Leader (6)
  //   8 = Non-Supervisory (866)
  // The old rule demanded exactly '2' and so excluded 13 real supervisors.
  const sd = A.scd('FCA0A');
  ok('a code-4 supervisor IS the director — FCA0A was [NONE] before',
     sd && sd.email === 'taylor.wynings@gsa.gov', sd);

  const H = require('./server/01_constants/HCRules.js');
  ['2', '4', '5', '7'].forEach(c => {
    ok('code ' + c + ' (' + H.HC_SUPERVISORY_CODES[c].desc + ') supervises',
       H.isHcSupervisoryCode(c));
  });
  ok('code 8 (Non-Supervisory) does not', !H.isHcSupervisoryCode('8'));

  // A DENY-LIST, NOT AN ALLOW-LIST. An allow-list would silently drop a code
  // HR adds later, which is this exact defect in a narrower form. The
  // deny-list fails the other way — an unknown code grants access — which is
  // the right direction when the alternative is a real supervisor locked out
  // with no error to point at.
  ok('an UNKNOWN code counts as supervisory, not as non-supervisory',
     H.isHcSupervisoryCode('3'),
     'failing closed here would lock out a supervisor silently');
  ok('but a BLANK does not', !H.isHcSupervisoryCode(''),
     'blank means unknown, and unknown is not a claim to supervise');

  // Sheets coerces a status cell to a number, and a feed read can yield '2.0'.
  ok('a numeric 2 and the string "2.0" both read as supervisory',
     H.isHcSupervisoryCode(2) && H.isHcSupervisoryCode('2.0'));

  // The census exists because the predicate is a deny-list.
  const census = H.hcSupervisoryCodeCensus(POSITIONS);
  ok('the census reports an unrecognized code so it is visible',
     Object.keys(H.hcSupervisoryCodeCensus(
       [{ supervisoryStatus: '3' }]).unknown).length === 1,
     census);
}

// ---------------------------------------------------------------------------
console.log('\n3. an unoccupied seat cannot approve; a tie goes to the grade');
{
  // FCA0E had THREE supervisory rows. Two are VACANT, which resolves it —
  // and that is why @clolry's expectation of one director per center held on
  // the live data despite the [3!] marker.
  const e = A.scd('FCA0E');
  ok('FCA0E resolves to its one FILLED supervisor',
     e && e.email === 'kristen.irvin@gsa.gov', e);
  const b = A.scd('FCC0B');
  ok('FCC0B likewise, past its vacant grade-15 seat',
     b && b.email === 'kyra.stewart@gsa.gov', b);

  // A CENTER WITH NO FILLED SUPERVISOR HAS NO DIRECTOR, and that must be
  // null rather than a vacant seat's empty email — routing cascades to the
  // DAC, which is correct.
  ok('a center whose only supervisory seat is vacant has no director',
     A.scd('FCB0B') === null, A.scd('FCB0B'));

  // AN OBLIGATED SEAT CANNOT APPROVE. Eberle is counted in FCC0C's headcount
  // because he is a real person who travels, and he is NOT its approver,
  // because an obligated seat means he is working elsewhere. Two different
  // questions, deliberately answered differently — see HCRules.isHcSeatOccupied.
  ok('an OBLIGATED director is not the approver',
     A.scd('FCC0C') === null,
     'he is counted in the headcount but cannot approve from a seat he is not in');

  // THE TIE-BREAK. @clolry: "when a conflict exists with two 'supervisors' in
  // the same workgroup you can choose the one that is the higher grade."
  const tie = A.scd('FCB0A');
  ok('with two occupied supervisors, the higher grade wins',
     tie && tie.email === 'high.grade@gsa.gov', tie);
  ok('and it is the GS-15 even though the GS-14 has the lower code number',
     tie && tie.email !== 'low.grade@gsa.gov',
     'code 2 vs 7 must not decide seniority — the grade does');

  // DETERMINISM IS THE POINT. The old code took the first match in bundle
  // order, so re-importing the roster could change a center's approver.
  const reversed = build(POSITIONS.slice().reverse());
  ok('the answer does not depend on bundle order',
     reversed.scd('FCB0A').email === 'high.grade@gsa.gov',
     'first-match-wins meant HR re-sorting a sheet could change the approver');

  const H = require('./server/01_constants/HCRules.js');
  ok('SES outranks every numeric grade',
     H.compareHcGrade('ES', '15') > 0,
     "'00' is the absence of a grade, so SES normalizes to ES");
  ok('and an unparseable grade ranks lowest, not highest',
     H.compareHcGrade('VT-03', '06') < 0,
     'VT-03 is real in this data; it is not evidence of seniority');
}

// ---------------------------------------------------------------------------
console.log('\n4. nobody is above a service center by accident');
{
  // SEVEN ORG CODES HAVE NO SERVICE CENTER: FC, FCA, FCB, FCC, FCBA, FCBB,
  // FCCA. Returning null for them is the truth, not a failure — they route
  // from the DAC stage.
  //
  // THIS IS ALSO WHY substring(0, 5) WOULD NOT HAVE BEEN A FIX. It agrees
  // with the stored walk on 130 of 137 codes and hands each of these seven
  // its OWN code as its service center.
  ['FC', 'FCA', 'FCB', 'FCC', 'FCBA', 'FCBB', 'FCCA'].forEach(code => {
    ok(code + ' has no service center, so no SCD stage',
       A.scd(code) === null,
       'a truncation would hand it its own code instead');
  });

  // DEPTH VARIES BY BRANCH, which is the other reason truncation fails: FCA
  // has no 4-char sub-office level while FCB and FCC do.
  ok('FCA0A is two levels below its DAC',
     ORGS.filter(o => o.orgCode === 'FCA0A')[0].parentOrgCode === 'FCA');
  ok('FCBAA is three, under an OFFICE',
     ORGS.filter(o => o.orgCode === 'FCBAA')[0].parentOrgCode === 'FCBA');
  ok('and both are SERVICE_CENTER level all the same',
     ORGS.filter(o => o.orgCode === 'FCA0A')[0].orgLevel === 'SERVICE_CENTER' &&
     ORGS.filter(o => o.orgCode === 'FCBAA')[0].orgLevel === 'SERVICE_CENTER',
     'so the LEVEL is the rule, never the length');
}

// ---------------------------------------------------------------------------
console.log('\n5. both sides of the scope comparison speak the same vocabulary');
{
  // THE ASSERTION THAT STOPS THE TWO HALVES BEING SEPARATED. isSectorDirector
  // hands out full SERVICE_CENTER codes; orgCodeInScope walks a request's org
  // code to its center. If either side reverted to a truncation they would
  // never compare equal, and the director would see an empty queue.
  const sd = A.isSD('paulette.sepulvado@gsa.gov');
  ok('a director is recognized as one', sd.isSD === true, sd);
  ok('and their scope is the FULL center code',
     sd.sectorCodes.length === 1 && sd.sectorCodes[0] === 'FCA0B', sd);

  ok('a request from a branch inside that center is IN scope',
     A.inScope('FCA0BAA', sd.sectorCodes) === true,
     'this is the comparison that returned false for every request');
  ok('the center itself is in scope', A.inScope('FCA0B', sd.sectorCodes) === true);
  ok('a sibling center is NOT',
     A.inScope('FCA0C', sd.sectorCodes) === false);
  ok('and neither is the DAC above it',
     A.inScope('FCA', sd.sectorCodes) === false,
     'scope must not widen upward');

  // A 4-CHAR SCOPE WOULD FAIL THIS, which is the whole point.
  ok('a truncated scope code matches nothing',
     A.inScope('FCA0BAA', ['FCA0']) === false,
     'one side correct and the other truncated = an empty queue, silently');

  // A supervisor inside a center does not hold the role.
  ok('a branch supervisor is not an SCD',
     A.isSD('div.head@gsa.gov').isSD === false);
  // AND THE LOSER OF A TIE DOES NOT EITHER. Without this, both supervisors at
  // FCB0A would claim the role while only one receives the requests.
  ok('the lower-graded supervisor at a tied center is not an SCD',
     A.isSD('low.grade@gsa.gov').isSD === false,
     'the reviewer role and the routing target must name the same person');
  ok('while the higher-graded one is',
     A.isSD('high.grade@gsa.gov').isSD === true);
}

// ---------------------------------------------------------------------------
console.log('\n6. the title match is gone from every call site');
{
  // COMMENTS STRIPPED. Sixth occurrence of this trap in the project: the
  // prose explaining the defect contains the very string being searched for,
  // and a naive grep reads the explanation as the code.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  const files = [
    'server/30_services/Access.js',
    'server/40_domain/Admin_Dashboard.js',
    'server/40_domain/Users.js',
    'client/controllers/admin/travelUsersController.html'
  ];
  files.forEach(f => {
    const code = strip(fs.readFileSync(__dirname + '/' + f, 'utf8'));
    ok(f + ' no longer matches on a title',
       code.toLowerCase().indexOf("indexof('sector director')") === -1,
       'all five sites were wrong together, for weeks');
  });

  // DIAGNOSTICS.JS IS THE DELIBERATE EXCEPTION, and it is excluded by name
  // rather than by a looser pattern so the exception stays visible.
  //
  // diagServiceCenterDirectors still searches the title census for 'sector
  // director' — but it REPORTS the count, it does not gate on it. That line
  // is the evidence the retired rule could never have worked, and it would
  // catch an HR rename that made the old assumption true again.
  const diag = strip(fs.readFileSync(SERVER + '99_triggers/Diagnostics.js', 'utf8'));
  ok('the diagnostic still reports on the title',
     diag.indexOf("indexOf('sector director')") > -1,
     'that count is how the defect was proven in the first place');
  ok('but does not use it to SELECT anyone',
     !/indexOf\('sector director'\) === -1\) (continue|return)/.test(diag),
     'reporting a title is fine; deciding on one is the defect');

  // AND THE GRADE-15 REQUIREMENT IS GONE. @clolry: "I don't know why we would
  // need to check the grade." Measured, it excluded only two VACANT grade-13
  // seats — and it would reject an SES director outright.
  const access = strip(fs.readFileSync(SERVER + '30_services/Access.js', 'utf8'));
  const finder = access.slice(access.indexOf('function _findSectorDirectorPosition'),
                              access.indexOf('function _getSectorDirectorOverride'));
  ok('the SCD finder does not require grade 15',
     !/String\(p\.grade\) !== '15'/.test(finder), finder.slice(0, 300));
  ok('it uses the shared supervisory predicate',
     /isHcSupervisoryCode\(p\.supervisoryStatus\)/.test(finder));
  ok('and the shared occupancy predicate',
     /isHcSeatOccupied\(p\)/.test(finder));
  ok('and the shared grade comparison for the tie-break',
     /compareHcGrade\(/.test(finder));

  // NO TRUNCATION ANYWHERE IN THE SCOPE PATH.
  ['server/30_services/Access.js',
   'server/40_domain/ReviewerDashboard.js',
   'server/40_domain/Admin_Dashboard.js',
   'server/40_domain/Submission.js'].forEach(f => {
    const code = strip(fs.readFileSync(__dirname + '/' + f, 'utf8'));
    ok(f + ' has no substring(0, 4) sector derivation',
       code.indexOf('substring(0, 4)') === -1,
       'the 4-char rule belonged to the inherited org, not this one');
  });
}

// ---------------------------------------------------------------------------
console.log('\n7. negative controls — each half must be able to fail');
{
  const src = fs.readFileSync(SERVER + '30_services/Access.js', 'utf8');

  function rebuild(patchedSrc, positions) {
    const sandbox = {
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Array, Math, parseFloat, parseInt,
      isNaN, RegExp, Error, Boolean,
      SpreadsheetApp: { openById: () => ({ getSheetByName: () => null }) },
      CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, removeAll() {} }) },
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
      Session: { getActiveUser: () => ({ getEmail: () => 't@gsa.gov' }) }
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';", ctx);
    vm.runInContext(fs.readFileSync(SERVER + '01_constants/Sheets.js', 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(SERVER + '01_constants/HCRules.js', 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(SERVER + '20_data/HCData.js', 'utf8'), ctx);
    vm.runInContext(`
      var __orgs = ${JSON.stringify(ORGS)};
      var __pos  = ${JSON.stringify(positions)};
      HC.hcGetOrgHierarchy = function () { return __orgs; };
      HC.hcGetBundle = function () { return { success: true, data: __pos }; };
      function _getUnifiedRolesForEmail() { return []; }
      function _getUnifiedRoleData() { return { rolesByEmail: {}, hasData: true }; }
      function loadOrgLookups() { return { orgToBU: {}, orgToSector: {}, orgToCurrentOrgCode: {} }; }
      function TravelDB() {}
    `, ctx);
    vm.runInContext(
      patchedSrc.slice(patchedSrc.indexOf('function getSectorDirector'),
                       patchedSrc.indexOf('// UNIFIED USER/ROLE READER')),
      ctx, { filename: 'Access.patched.js' });
    return (code) => vm.runInContext(
      'getSectorDirector(' + JSON.stringify(code) + ')', ctx);
  }

  // CONTROL 1: demand code '2' again. FCA0A must lose its director.
  {
    const patched = src.replace(
      '      if (!isHcSupervisoryCode(p.supervisoryStatus)) continue;\n' +
      '      // A vacant or obligated seat cannot approve travel.',
      "      if (String(p.supervisoryStatus) !== '2') continue;\n" +
      '      // A vacant or obligated seat cannot approve travel.');
    ok('control 1 patched the supervisory rule', patched !== src);
    const scd = rebuild(patched, POSITIONS);
    ok('demanding code 2 loses FCA0A entirely',
       scd('FCA0A') === null,
       "this is the [NONE] @clolry saw — Taylor Wynings holds code 4");
  }

  // CONTROL 2: restore the grade-15 requirement. FCA0A's GS-14 must drop out.
  {
    const patched = src.replace(
      '      if (!isHcSeatOccupied(p)) continue;',
      "      if (!isHcSeatOccupied(p)) continue;\n      if (String(p.grade) !== '15') continue;");
    ok('control 2 patched the grade check', patched !== src);
    const scd = rebuild(patched, POSITIONS);
    ok('a grade-15 requirement drops the GS-14 director',
       scd('FCA0A') === null,
       'it would also reject an SES director, whose grade normalizes to ES');
  }

  // CONTROL 3: take the first match instead of the highest grade. The tie at
  // FCB0A must become order-dependent.
  {
    const patched = src.replace(
      '      if (!best || compareHcGrade(p.grade, best.grade) > 0) best = p;',
      '      if (!best) best = p;');
    ok('control 3 patched the tie-break', patched !== src);
    const fwd = rebuild(patched, POSITIONS);
    const rev = rebuild(patched, POSITIONS.slice().reverse());
    ok('first-match-wins gives two different answers for one center',
       fwd('FCB0A').email !== rev('FCB0A').email,
       'so a re-import could silently change who approves a center travel');
  }

  // CONTROL 4: truncate to 4 characters again. The branch code must stop
  // resolving, and a center must resolve to the wrong thing or to nothing.
  {
    const patched = src.replace(
      "    return HC.orgAncestorAtLevel(code, byCode, 'SERVICE_CENTER') || '';",
      '    return code.substring(0, 4);');
    ok('control 4 patched the resolver', patched !== src);
    const scd = rebuild(patched, POSITIONS);
    ok('a 4-char truncation cannot find a branch\'s director',
       scd('FCA0BAA') === null,
       "'FCA0' is not an org code, so no position sits at it");
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
