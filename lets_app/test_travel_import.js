/**
 * Automated Verification Script for the existing-travel importer
 * (30_services/TravelImport.js + 40_domain/TravelImportAdmin.js).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * @clolry: "Import FY27 travel already requested, approved, or completed,
 * using Chiquita's travel spreadsheet as the initial source... Needs an import
 * preview, validation, error log, duplicate prevention via source IDs,
 * rollback or correction, and repeatable incremental runs."
 *
 * Eight things here would be expensive AND SILENT. Each was found by parsing
 * the real workbook before the code was written, not by reasoning about it.
 *
 * 1. SEVEN REQUEST IDs ARE STORED AS NUMBERS. '4946' reads back '4946.0', so
 *    a string compare re-imports those seven on every run. §2
 *
 * 2. THE EXPENSE KEY COLLIDES ON 2 OF 274 ROWS. Stacy Buechele filed two
 *    identically-named reports ending the same day, $198.60 and $1,602.06.
 *    A naive key loses $198.60. §3
 *
 * 3. A NAIVE FISCAL-YEAR FILTER ATTACHES MONEY TO THE WRONG TRIP. $1,176.10
 *    would land on a trip three weeks after the one it belongs to. §6
 *
 * 4. DATE SERIALS ARRIVE AS STRINGS, and '46356' parses as the YEAR 46356 —
 *    a valid-looking date that silently drops the row out of scope. §4
 *
 * 5. THE SOURCE WORKBOOK RECONCILES AGAINST THE WRONG MONEY COLUMN, by
 *    $1,164.39 across its 20 matched rows. §5
 *
 * 6. VERIFIED ACTUALS MUST SURVIVE A RE-IMPORT. §7
 *
 * 7. SCOPE DISCARDS 97% OF THE FILE, so every exclusion must be counted and
 *    explained or the importer cannot be told from a broken one. §8
 *
 * 8. ROLLBACK DELETING ASCENDING DESTROYS THE WRONG ROWS. §9
 *
 * §11 is the measured section: it runs the real workbook through the real
 * engine and asserts the figures. It SKIPS when the workbook is absent, so a
 * fresh checkout still passes — see the note there.
 *
 * Run: node lets_app/test_travel_import.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
let skipped = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); fails++; }
};
const skip = (n, why) => { console.log('  SKIP', n, '—', why); skipped++; };

// ---------------------------------------------------------------------------
// THE ENGINE, LOADED ALONE
//
// TravelImport.js touches no spreadsheet, which is the whole reason it is a
// separate file from TravelImportAdmin.js. Loading it with nothing but
// GogovSync proves that: if it ever reaches for SpreadsheetApp, this throws.
// ---------------------------------------------------------------------------
function engine() {
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
    parseInt, parseFloat, isNaN, isFinite
  });
  vm.runInContext(fs.readFileSync('lets_app/server/30_services/GogovSync.js', 'utf8'),
                  ctx, { filename: 'GogovSync.js' });
  vm.runInContext(fs.readFileSync('lets_app/server/30_services/TravelImport.js', 'utf8'),
                  ctx, { filename: 'TravelImport.js' });
  return vm.runInContext('TravelImport', ctx);
}
const T = engine();

console.log('--- Existing-travel import test suite ---\n');

// ===========================================================================
console.log('1. the module layering holds');
{
  // The engine must be loadable with no GAS globals at all. If a spreadsheet
  // call creeps into it, every test here becomes untestable and the only way
  // to verify the importer is to run it against production data.
  ok('the engine loads with no GAS runtime', typeof T.buildPreview === 'function');

  const src = fs.readFileSync('lets_app/server/30_services/TravelImport.js', 'utf8');
  ['SpreadsheetApp', 'PropertiesService', 'LockService', 'Session', 'MailApp', 'GmailApp']
    .forEach(g => {
      ok('the engine never calls ' + g, src.indexOf(g) === -1);
    });

  // And the admin layer is where the writes live, so it SHOULD use them.
  const admin = fs.readFileSync('lets_app/server/40_domain/TravelImportAdmin.js', 'utf8');
  ok('the admin layer is the one that writes', admin.indexOf('LockService') > -1);
}

// ===========================================================================
console.log('\n2. duplicate prevention survives the numeric-ID trap');
{
  // MEASURED: 7 of the 1,024 Request IDs in the real workbook are all digits
  // — 4946, 4349, 4799, 4734, 4463, 4434, 4394 — and the spreadsheet stores
  // them as NUMBERS. Reading the cell yields the number, and String() of a
  // float round-trip yields '4946.0'.
  //
  // @clolry asked for "duplicate prevention via source IDs". This is the one
  // place that promise can break quietly: those seven rows would be
  // re-imported on EVERY run, as new requests, consuming budget each time.
  ok('a numeric ID normalizes to its digits', T.normalizeSourceId(4946) === '4946');
  ok("the float round-trip '4946.0' normalizes to the same thing",
     T.normalizeSourceId('4946.0') === '4946');
  ok('so a stored value and an incoming value MATCH',
     T.normalizeSourceId('4946.0') === T.normalizeSourceId(4946));

  ok('an alphanumeric ID is untouched apart from case',
     T.normalizeSourceId('4qtc') === '4QTC' && T.normalizeSourceId('4QTC') === '4QTC');
  ok('surrounding whitespace does not create a second identity',
     T.normalizeSourceId('  4QTC  ') === '4QTC');

  // NOT over-eager: only a whole numeric token with a zero fraction is
  // stripped. 'A1.0B' is an ID, not a float.
  ok('a non-numeric token containing .0 is left alone',
     T.normalizeSourceId('A1.0B') === 'A1.0B');
  // A fractional ID is corrupt input and must stay visibly odd rather than be
  // rounded into something plausible.
  ok('a fractional value keeps its fraction rather than being truncated',
     T.normalizeSourceId(4946.5) === '4946.5');
  ok('blank input yields blank', T.normalizeSourceId(null) === '' &&
     T.normalizeSourceId(undefined) === '' && T.normalizeSourceId('') === '');
}

// ===========================================================================
console.log('\n3. the expense composite key separates the colliding reports');
{
  // MEASURED COLLISION, from the real file:
  //   BUECHELE, STACY E. | Trip from WIL to WAS | 2026-10-28 |   $198.60
  //   BUECHELE, STACY E. | Trip from WIL to WAS | 2026-10-28 | $1,602.06
  // Both real, separately filed. The obvious key — person + title + end date
  // — merges them, drops $198.60, and the totals still look plausible.
  const a = { employeeName: 'BUECHELE, STACY E.', tripName: 'Trip from WIL to WAS',
              reportEndDate: '2026-10-28', approvedAmount: 198.60, submitDate: '2026-11-04' };
  const b = { employeeName: 'BUECHELE, STACY E.', tripName: 'Trip from WIL to WAS',
              reportEndDate: '2026-10-28', approvedAmount: 1602.06, submitDate: '2026-10-27' };

  ok('two same-day same-title reports get DIFFERENT keys',
     T.compositeKey(a) !== T.compositeKey(b),
     { a: T.compositeKey(a), b: T.compositeKey(b) });

  // And the key is stable, or every re-run looks like a brand new row.
  ok('the same record yields the same key twice', T.compositeKey(a) === T.compositeKey(a));

  // Casing and name format differ between the two tabs — measured: 'Dolezal,
  // Nathan K.' vs 'Nathan Dolezal', 71 of 182 rows ALL CAPS.
  const c1 = { employeeName: 'Dolezal, Nathan K.', tripName: 'X',
               reportEndDate: '2026-10-01', approvedAmount: 10, submitDate: '2026-10-02' };
  const c2 = { employeeName: 'NATHAN DOLEZAL', tripName: 'X',
               reportEndDate: '2026-10-01', approvedAmount: 10, submitDate: '2026-10-02' };
  ok('the two name formats produce ONE identity', T.compositeKey(c1) === T.compositeKey(c2));
}

// ===========================================================================
console.log('\n4. date serials arriving as STRINGS do not become the year 46356');
{
  // THE DEFECT THIS SECTION EXISTS FOR.
  //
  // GogovSync.toDateString was built against .xls exports whose dates were
  // NUMBERS. This importer's rows come from a client-side parse, and the
  // serial can arrive as a STRING. Passed to GogovSync, '46356' matches
  // neither the number branch nor the ISO branch and falls through to
  // `new Date('46356')` — which parses as THE YEAR 46356.
  //
  // That is worse than failing: '46356-01-01' passes validation, yields
  // fiscal year 'FY4635', and is then silently dropped as out-of-scope. A
  // whole trip vanishes and nothing says so.
  ok('a numeric-string serial resolves to the right date',
     T.toDateString('46356') === '2026-11-30', T.toDateString('46356'));
  ok("the float form '46356.0' too",
     T.toDateString('46356.0') === '2026-11-30', T.toDateString('46356.0'));
  ok('a serial with a time fraction keeps the right day',
     T.toDateString('46356.68983') === '2026-11-30', T.toDateString('46356.68983'));
  ok('a real number still works', T.toDateString(46356) === '2026-11-30');
  ok('ISO text still works', T.toDateString('2026-10-28') === '2026-10-28');

  // The bound is what stops a small number being read as a 1950s date.
  ok('an implausibly small numeric string is refused, not guessed',
     T.toDateString('5') === '', T.toDateString('5'));
  ok('an implausibly large one too', T.toDateString('999999') === '');
  ok('junk is refused', T.toDateString('not a date') === '');

  // And the fiscal-year boundary, which is the thing all of this protects.
  ok('30 September is the old fiscal year', T.fiscalYearOf('2026-09-30') === 'FY2026');
  ok('1 October is the new one', T.fiscalYearOf('2026-10-01') === 'FY2027');
}

// ===========================================================================
console.log('\n5. the money columns are not interchangeable');
{
  // @clolry, during the Go.gov work: "we need to use Amount Approved rather
  // than Report Total." Report Total is what the traveler CLAIMED; Amount
  // Approved is what GSA PAID.
  //
  // MEASURED: they differ on 51 of 274 rows by $6,009.34 overall, and on 5 of
  // the 11 in-scope rows by $863.51.
  const m = T.proposeMapping(
    ['Full Name', 'Report Name', 'Report Total', 'Amount Approved',
     'Report End Date', 'Submit Date', 'Office Symbol'], 'expense');
  ok('the actual maps to Amount Approved', m.mapping.approvedAmount === 'Amount Approved');
  ok('and the claim maps to Report Total', m.mapping.claimedAmount === 'Report Total');
  ok('nothing is missing from a real header set', m.missing.length === 0, m.missing);

  // Mapping is EXACT, never fuzzy. 'Report Total' and 'Total Approved Amount'
  // are both plausible fuzzy hits for a field called 'total', and being wrong
  // costs the $6,009.34 above.
  const weird = T.proposeMapping(['Full Name', 'Report Name', 'Totals',
                                  'Approved Amt', 'Report End Date'], 'expense');
  ok('an unrecognized money header is reported MISSING, not guessed at',
     weird.missing.indexOf('approvedAmount') > -1, weird);

  // A required field that cannot be mapped must stop the import rather than
  // let it run against blanks.
  const bare = T.proposeMapping(['Full Name', 'Report Name'], 'expense');
  ok('a bare header set reports every missing requirement',
     bare.missing.indexOf('approvedAmount') > -1 &&
     bare.missing.indexOf('reportEndDate') > -1, bare.missing);

  // Disallowed is DERIVED. The workbook has no such column.
  const rows = [{ 'Full Name': 'A B', 'Report Name': 'X', 'Report Total': 2104.48,
                  'Amount Approved': 1841.32, 'Report End Date': '2026-10-28' }];
  const parsed = T.parseRows(rows, m.mapping, 'expense', {});
  ok('disallowed is derived as claimed minus approved',
     parsed[0].disallowedAmount === 263.16, parsed[0].disallowedAmount);
  ok('and the reconciliation figure is the approved one',
     parsed[0].approvedAmount === 1841.32);
}

// ===========================================================================
console.log('\n6. the match pool is NOT fiscal-year filtered');
{
  // THE MEASURED NEAR-MISS, and the subtlest thing in the module.
  //
  // Udaya Patnaik's expense report 'Trip from San Francisco to Washington'
  // ends 2026-10-02, so it is FY2027 and IN scope. His requests with that
  // exact title:
  //
  //   4GNF  $1,337.74  2026-09-30 .. 2026-10-02   FY2026   <- the right one
  //   4NFL  $1,449.55  2026-11-01 .. 2026-11-03   FY2027
  //   3QTT  $1,671.83  2026-07-15 .. 2026-07-18   FY2026
  //
  // Filter the pool to FY2027 and 4GNF disappears, leaving 4NFL — a DIFFERENT
  // TRIP three weeks later — as the only title match. $1,176.10 posts against
  // it and 4GNF sits unreconciled forever. Both figures look fine.
  //
  // Chiquita's own workbook pairs the report with 4GNF, and she is right: the
  // request end date and the report end date agree to the day.
  const allRequests = [
    { sourceRecordId: '4GNF', tripName: 'Trip from San Francisco to Washington',
      startDate: '2026-09-30', endDate: '2026-10-02', estimateAmount: 1337.74,
      employeeName: 'Udaya Patnaik', employeeNameNormalized: 'UDAYA PATNAIK',
      officeCode: 'FO', fiscalYear: 'FY2026' },
    { sourceRecordId: '4NFL', tripName: 'Trip from San Francisco to Washington',
      startDate: '2026-11-01', endDate: '2026-11-03', estimateAmount: 1449.55,
      employeeName: 'Udaya Patnaik', employeeNameNormalized: 'UDAYA PATNAIK',
      officeCode: 'FO', fiscalYear: 'FY2027' }
  ];

  const pool = T.candidatePool(allRequests, []);
  ok('the pool keeps the FY2026 request', pool.some(c => c.requestId === '4GNF'));
  ok('and the FY2027 one', pool.some(c => c.requestId === '4NFL'));
  ok('so a straddling trip is still reachable', pool.length === 2);

  // The pool also includes rows ALREADY in LETS, so a second incremental run
  // can match a report against a request the FIRST run imported. Without
  // that, an expense arriving a month after its request never finds it.
  const withLets = T.candidatePool(allRequests, [
    { requestId: 'L27-0001', tripName: 'Prior trip', startDate: '2026-10-05',
      endDate: '2026-10-07', estimate: 500, employeeName: 'Audrea White',
      owningOffice: 'IDV', gogovRequestId: '4H96' }
  ]);
  ok('already-imported LETS requests are candidates too',
     withLets.some(c => c.requestId === 'L27-0001'), withLets.length);
  ok('and they are marked as not being source rows',
     withLets.find(c => c.requestId === 'L27-0001').isSourceRow === false);
}

// ===========================================================================
console.log('\n7. a VERIFIED actual is never overwritten silently');
{
  // @clolry: "Never overwrite verified financial records without an explicit
  // reconciliation rule." isVerifiedActual IS that rule.
  //
  // Verified means a deliberate human act: somebody typed the figure, or
  // somebody reviewed an ambiguous match and committed to it. An actual
  // written by a PREVIOUS IMPORT is not verified — it is the same class of
  // claim as the one now arriving, which is what makes re-runs useful.
  ok('a manually-entered actual is verified',
     T.isVerifiedActual({ actual: 1500, actualSource: 'manual' }) === true);
  ok('a human-confirmed match is verified',
     T.isVerifiedActual({ actual: 1500, actualSource: 'import',
                          matchConfirmedBy: 'chris@gsa.gov' }) === true);
  ok('an import-written actual is NOT verified',
     T.isVerifiedActual({ actual: 1500, actualSource: 'import' }) === false);
  ok('no actual at all is not verified',
     T.isVerifiedActual({ actual: '', actualSource: 'manual' }) === false);
  // Zero is a real actual — no-cost travel exists in this data.
  ok('a verified actual of ZERO still counts as verified',
     T.isVerifiedActual({ actual: 0, actualSource: 'manual' }) === true);

  const incoming = { sourceSheet: 'Expense', approvedAmount: 1841.32,
                     estimateAmount: 0, startDate: '', endDate: '',
                     officeCode: 'OMD' };

  const verified = { requestId: 'L27-0001', actual: 1500, actualSource: 'manual',
                     owningOffice: 'OMD' };
  const d1 = T.diffRecord(incoming, verified);
  ok('overwriting a verified actual is a CONFLICT', d1.status === 'CONFLICT', d1);
  ok('and the conflict names the figure and says why',
     d1.conflicts.length === 1 && d1.conflicts[0].from === 1500 &&
     d1.conflicts[0].to === 1841.32 && /VERIFIED/.test(d1.conflicts[0].reason),
     d1.conflicts);

  const unverified = { requestId: 'L27-0002', actual: 1500, actualSource: 'import',
                       owningOffice: 'OMD' };
  const d2 = T.diffRecord(incoming, unverified);
  ok('replacing an import-written actual is a normal CHANGE', d2.status === 'CHANGED', d2);

  // An unchanged re-run must be recognized, or every incremental run rewrites
  // every row and the diff becomes useless.
  const same = { requestId: 'L27-0003', actual: 1841.32, actualSource: 'import',
                 owningOffice: 'OMD' };
  ok('an identical re-import is UNCHANGED',
     T.diffRecord(incoming, same).status === 'UNCHANGED');

  // THE ABSENCE TRAP. A request row carries approvedAmount 0 because requests
  // have no actuals. Writing that over a real actual would destroy it.
  const requestRow = { sourceSheet: 'TravelRequest', estimateAmount: 1337.74,
                       approvedAmount: 0, startDate: '2026-09-30',
                       endDate: '2026-10-02', officeCode: 'FO' };
  const hasActual = { requestId: 'L27-0004', estimate: 1337.74, actual: 1176.10,
                      actualSource: 'manual', startDate: '2026-09-30',
                      endDate: '2026-10-02', owningOffice: 'FO' };
  const d3 = T.diffRecord(requestRow, hasActual);
  ok('a request row does not wipe an existing actual with its zero',
     d3.status === 'UNCHANGED' && !d3.detail.approvedAmount, d3);

  // Same trap for dates: an expense row has no start date, and that must not
  // read as "clear the start date".
  const d4 = T.diffRecord(incoming, { requestId: 'L27-0005', actual: '',
                                      startDate: '2026-10-19', endDate: '2026-10-21',
                                      owningOffice: 'OMD' });
  ok('an expense row does not blank the dates on the request it posts to',
     !d4.detail.startDate && !d4.detail.endDate, d4.detail);

  // Only the source's own fields are compared. An administrator's correction
  // to a trip name must survive a re-import.
  ok('trip name is not a compared field, so a hand correction survives',
     T.COMPARED_FIELDS.every(c => c.field !== 'tripName'),
     T.COMPARED_FIELDS.map(c => c.field));
}

// ===========================================================================
console.log('\n8. scope is enforced, and every exclusion is explained');
{
  // @clolry: "Only FY27 information and only ASD employees."
  //
  // That keeps 28 of 1,024 request rows and 11 of 274 expense rows — it
  // DISCARDS 97%. An importer that silently drops 97% of its input cannot be
  // distinguished from one that is broken, so each exclusion carries the
  // specific test that caused it.
  const scope = { fiscalYear: 'FY2027', orgFilter: 'ASD' };

  const good = { tripName: 'Leadership Offsite', fiscalYear: 'FY2027',
                 fiscalYearBasis: 'start-date', inOrgRoster: true,
                 officeCode: 'IDV', sourceOfficeSymbol: 'FCBBC' };
  ok('an FY27 ASD row is in scope',
     T.scopeDecision(good, scope).decision === 'IN_SCOPE');

  const wrongFy = Object.assign({}, good, { fiscalYear: 'FY2026' });
  const r1 = T.scopeDecision(wrongFy, scope);
  ok('an FY26 row is excluded', r1.decision === 'OUT_OF_SCOPE_FY');
  ok('and the reason names both years and the basis',
     /FY2026/.test(r1.reason) && /FY2027/.test(r1.reason) &&
     /start-date/.test(r1.reason), r1.reason);

  const nonAsd = Object.assign({}, good, { inOrgRoster: false, officeCode: '',
                                           sourceOfficeSymbol: '' });
  const r2 = T.scopeDecision(nonAsd, scope);
  ok('a non-ASD row is excluded', r2.decision === 'OUT_OF_SCOPE_ORG');
  ok("and the reason mentions the workbook's own label",
     /Not ASD Employee/.test(r2.reason), r2.reason);

  // MEASURED: 6 rows are 'Professional Liability Insurance' at $179.50, and
  // one is inside the FY27 ASD scope. They have a report and NO trip, so a
  // naive importer invents a phantom zero-date trip and charges a DAC's
  // travel budget for insurance.
  const insurance = Object.assign({}, good, { tripName: 'Professional Liability Insurance' });
  const r3 = T.scopeDecision(insurance, scope);
  ok('professional liability insurance is excluded as non-travel',
     r3.decision === 'OUT_OF_SCOPE_NON_TRAVEL', r3);
  ok('and it says it is not travel', /not travel/i.test(r3.reason), r3.reason);
  ok('the FY27 variant is caught too',
     T.nonTravelReason({ tripName: 'FY27 Professional Liability Ins' }) !== '');
  ok('an ordinary trip is not mistaken for insurance',
     T.nonTravelReason({ tripName: 'Trip from Dallas to Atlanta' }) === '');

  // The MOST SPECIFIC reason wins. A non-ASD FY24 insurance charge is
  // reported as non-travel, because that is the useful fact.
  const allBad = { tripName: 'Professional Liability', fiscalYear: 'FY2024',
                   fiscalYearBasis: 'report-end-date', inOrgRoster: false,
                   officeCode: '', sourceOfficeSymbol: '' };
  ok('the most specific exclusion reason is the one reported',
     T.scopeDecision(allBad, scope).decision === 'OUT_OF_SCOPE_NON_TRAVEL');

  // orgFilter ALL still honours the fiscal year — the two filters are
  // independent.
  ok('orgFilter ALL admits a non-ASD row',
     T.scopeDecision(nonAsd, { fiscalYear: 'FY2027', orgFilter: 'ALL' })
       .decision === 'IN_SCOPE');
  ok('but still excludes the wrong fiscal year',
     T.scopeDecision(Object.assign({}, nonAsd, { fiscalYear: 'FY2026' }),
                     { fiscalYear: 'FY2027', orgFilter: 'ALL' })
       .decision === 'OUT_OF_SCOPE_FY');

  // A row with no usable date cannot be assigned a year, and must not default
  // into one.
  const noDate = Object.assign({}, good, { fiscalYear: '' });
  ok('a row with no usable date is excluded rather than defaulted',
     T.scopeDecision(noDate, scope).decision === 'OUT_OF_SCOPE_FY');
}

// ===========================================================================
console.log('\n9. the office mapping is longest-prefix');
{
  // 'FCBAEBE' starts with BOTH 'FC' and 'FCB'. The answer is IDV, not FO.
  // First-match would charge every IDV, OMD and CM trip to the Front Office —
  // which is every trip in the file except two.
  ok('FC is the Front Office', T.officeForOrgCode('FC') === 'FO');
  ok('FCB is IDV, not FO', T.officeForOrgCode('FCB') === 'IDV');
  ok('FCBAEBE is IDV', T.officeForOrgCode('FCBAEBE') === 'IDV');
  ok('FCA0BAB is OMD', T.officeForOrgCode('FCA0BAB') === 'OMD');
  ok('FCC0C is CM', T.officeForOrgCode('FCC0C') === 'CM');
  ok('an unknown prefix resolves to nothing rather than a default',
     T.officeForOrgCode('XYZ') === '' && T.officeForOrgCode('') === '');

  // THE OVERRIDES ARE LOAD-BEARING. OffSymbolOverride has only 2 rows, which
  // invites skipping it — but measured, those 2 rows are the only reason 6
  // request rows resolve at all (Cheryl Cameron's 4, Jeremy Wustner-Brown's).
  const roster = T.buildOrgRoster(
    [{ fullName: 'Cheryl Cameron', departmentId: '' }],
    [{ name: 'Cheryl Cameron', officeSymbol: 'FCB' }]);
  ok('an override supplies a symbol the base roster lacks',
     roster['CHERYL CAMERON'] === 'FCB', roster);

  const roster2 = T.buildOrgRoster(
    [{ fullName: 'Cheryl Cameron', departmentId: 'FCC' }],
    [{ name: 'Cheryl Cameron', officeSymbol: 'FCB' }]);
  ok('and an override WINS over the base roster, which is its purpose',
     roster2['CHERYL CAMERON'] === 'FCB', roster2);
}

// ===========================================================================
console.log('\n10. record kinds, and the status they imply');
{
  // @clolry asked to "distinguish requests, commitments, vouchers, and actual
  // expenditures". The distinction drives the budget arithmetic:
  // BudgetDashboard counts commitments against available balance and actuals
  // as spend, so the wrong bucket either double-counts money or hides it.
  ok('an approved request is a COMMITMENT',
     T.recordKindForRequest({ status: 'Approved' }) === 'COMMITMENT');
  ok('an unapproved one is a REQUEST',
     T.recordKindForRequest({ status: 'Pending' }) === 'REQUEST');
  // MEASURED: every row in both tabs is 'Approved' — 1,024 and 274 of each —
  // so REQUEST is currently unreachable from this workbook. Implemented
  // anyway: the next export need not be so uniform, and a silently missing
  // branch is worse than an unused one.
  ok('a blank status defaults to COMMITMENT, matching this workbook',
     T.recordKindForRequest({ status: '' }) === 'COMMITMENT');

  ok('an expense with an approved amount is an ACTUAL',
     T.recordKindForExpense({ approvedAmount: 1841.32 }) === 'ACTUAL');
  ok('one with no approved amount is still only a VOUCHER',
     T.recordKindForExpense({ approvedAmount: 0 }) === 'VOUCHER');

  const now = new Date('2026-11-15T12:00:00Z');
  ok('travel that has finished is COMPLETED',
     T.statusForRecord({ recordKind: 'COMMITMENT', endDate: '2026-10-28' }, now)
       === 'COMPLETED');
  ok('travel still ahead is APPROVED_GOGOV',
     T.statusForRecord({ recordKind: 'COMMITMENT', endDate: '2026-12-04' }, now)
       === 'APPROVED_GOGOV');
  ok('an unapproved request does not arrive pre-approved',
     T.statusForRecord({ recordKind: 'REQUEST', endDate: '2026-12-04' }, now)
       === 'PENDING_SECTOR');
}

// ---------------------------------------------------------------------------
// THE WRITE PATH, with a fake spreadsheet
//
// EMAIL AND ROUTING ARE INSTRUMENTED, NOT STUBBED AWAY. The whole claim of
// this feature — as of BudgetBackfill before it — is that it sends nothing
// and routes nothing. A stub that silently absorbs a send would make §12
// vacuous, so these record their calls and the test asserts the recordings
// are empty.
// ---------------------------------------------------------------------------
function loadAdmin(opts) {
  opts = opts || {};
  const logs = [];
  const ctx = vm.createContext({
    console: { log: m => logs.push(String(m)), warn: m => logs.push(String(m)),
               error: m => logs.push(String(m)) },
    JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
    parseInt, parseFloat, isNaN, isFinite
  });

  vm.runInContext(`
    function successResponse(d, m) { return { success: true, data: d, message: m || null }; }
    function errorResponse(m) { return { success: false, error: m }; }
    var __ERRORS = [];
    function logError(fn, e, c) { __ERRORS.push({ fn: fn, e: String(e && e.message || e), c: c }); }
    var __ADMIN = ${opts.isAdmin === false ? 'false' : 'true'};
    function isTravelAdmin() { return __ADMIN; }
    function formatUserName() { return 'Chris L'; }
    var LOCK_TIMEOUT_MS = 30000;
    var __LOCK_FAILS = ${opts.lockFails ? 'true' : 'false'};
    var LockService = { getScriptLock: function () { return {
      waitLock: function () { if (__LOCK_FAILS) { throw new Error('busy'); } },
      releaseLock: function () {}
    }; } };
    var Session = { getActiveUser: function () {
      return { getEmail: function () { return '${opts.email || 'chris@gsa.gov'}'; } };
    } };
    var __PROPS = {};
    var PropertiesService = { getScriptProperties: function () { return {
      getProperty: function (k) { return __PROPS[k] === undefined ? null : __PROPS[k]; },
      setProperty: function (k, v) { __PROPS[k] = v; }
    }; } };

    var __EMAILS = [];
    var GmailApp = { sendEmail: function () { __EMAILS.push(arguments); } };
    var MailApp = { sendEmail: function () { __EMAILS.push(arguments); } };
    var __ROUTED = [];
    function sendSubmissionNotification() { __ROUTED.push('notification'); }
    function determineInitialRouting() { __ROUTED.push('routing'); return {}; }
  `, ctx);

  ['01_constants/Status.js', '01_constants/Sheets.js']
    .forEach(f => vm.runInContext(fs.readFileSync('lets_app/server/' + f, 'utf8'),
                                  ctx, { filename: f }));

  // A fake TravelDB over in-memory tables. Supports the operations the
  // importer actually uses: read, append via getRange().setValues, per-cell
  // update, and deleteRow — the last one being what §14 exercises.
  vm.runInContext(`
    var __S = {};
    var __MISSING = ${JSON.stringify(opts.missingTabs || [])};
    Object.keys(TRAVEL_SHEET_SCHEMAS).forEach(function (k) {
      __S[k] = { headers: TRAVEL_SHEET_SCHEMAS[k].slice(), rows: [] };
    });
    function __sheet(name) {
      if (__MISSING.indexOf(name) > -1) return null;
      var t = __S[name];
      if (!t) return null;
      return {
        getLastRow: function () { return 1 + t.rows.length; },
        getLastColumn: function () { return t.headers.length; },
        deleteRow: function (rowNum) { t.rows.splice(rowNum - 2, 1); },
        getRange: function (r, c, nr, nc) {
          return {
            setValues: function (v) {
              // Append when the range starts past the last row; otherwise
              // overwrite in place. Mirrors real Sheets behavior closely
              // enough for the importer's two write shapes.
              v.forEach(function (row, i) {
                var idx = (r - 2) + i;
                if (idx >= t.rows.length) t.rows[idx] = row.slice();
                else for (var j = 0; j < row.length; j++) t.rows[idx][c - 1 + j] = row[j];
              });
            },
            setValue: function (val) { t.rows[r - 2][c - 1] = val; },
            getValues: function () {
              var a = [t.headers].concat(t.rows);
              return a.slice(r - 1, r - 1 + nr)
                      .map(function (y) { return y.slice(c - 1, c - 1 + nc); });
            }
          };
        }
      };
    }
    var __INVALIDATED = [];
    function TravelDB() {
      this.sheet = __sheet;
      this.readSheet = function (n) {
        var t = __S[n] || { headers: [], rows: [] };
        var hi = {}; t.headers.forEach(function (h, i) { hi[h] = i; });
        return { headers: t.headers, rows: t.rows, headerIndex: hi };
      };
      this.updateRowByIndex = function (n, rowNum, changes) {
        var t = __S[n];
        var hi = {}; t.headers.forEach(function (h, i) { hi[h] = i; });
        var row = t.rows[rowNum - 2];
        if (!row) throw new Error('no row ' + rowNum + ' in ' + n);
        Object.keys(changes).forEach(function (k) {
          if (!(k in hi)) throw new Error('no column ' + k + ' in ' + n);
          row[hi[k]] = changes[k];
        });
        return Object.keys(changes).length;
      };
      this.invalidate = function (n) { __INVALIDATED.push(n); };
    }
  `, ctx);

  ['30_services/GogovSync.js', '30_services/TravelImport.js',
   '40_domain/TravelImportAdmin.js']
    .forEach(f => vm.runInContext(fs.readFileSync('lets_app/server/' + f, 'utf8'),
                                  ctx, { filename: f }));

  function table(name) {
    const t = vm.runInContext('__S[' + JSON.stringify(name) + ']', ctx);
    return t.rows.map(row => {
      const o = {};
      t.headers.forEach((h, i) => { o[h] = row[i]; });
      return o;
    });
  }

  return {
    ctx, logs,
    run: e => vm.runInContext(e, ctx),
    call: (fn, ...args) =>
      vm.runInContext(fn + '(' + args.map(a => JSON.stringify(a)).join(',') + ')', ctx),
    requests: () => table('Requests'),
    ledger: () => table('Travel_Imports'),
    batches: () => table('Import_Batches'),
    approvals: () => table('Approval_Log'),
    emails: () => vm.runInContext('__EMAILS.length', ctx),
    routed: () => vm.runInContext('__ROUTED.length', ctx),
    errors: () => vm.runInContext('JSON.stringify(__ERRORS)', ctx),
    seedRequest(fields) {
      vm.runInContext(`(function () {
        var t = __S['Requests'];
        var hi = {}; t.headers.forEach(function (h, i) { hi[h] = i; });
        var row = t.headers.map(function () { return ''; });
        var f = ${JSON.stringify(fields)};
        Object.keys(f).forEach(function (k) { row[hi[k]] = f[k]; });
        t.rows.push(row);
      })()`, ctx);
    }
  };
}

/** The two source tabs, in the shape the client posts. */
const srcRequest = (o) => Object.assign({
  'Request ID': '4GVK',
  'Name': 'Leadership Offsite - Oct 2026',
  'Employee Name': 'Beverly Machinist',
  'Approval Status': 'Approved',
  'Total Approved Amount': 1044.34,
  'Start Date': '2026-10-27',
  'End Date': '2026-10-29',
  'Purpose': 'Leadership offsite',
  'Submit Date': '2026-10-01'
}, o);

const srcExpense = (o) => Object.assign({
  'Full Name': 'Beverly Machinist',
  'Office Symbol': 'FCBBC',
  'Report Name': 'Leadership Offsite - Oct 2026',
  'Employee Name': 'Machinist, Beverly',
  'Approval Status': 'Approved',
  'Report Total': 959.99,
  'Amount Approved': 959.99,
  'Report End Date': '2026-10-29',
  'Submit Date': '2026-11-02'
}, o);

const ROSTER = [{ 'Full Name': 'Beverly Machinist', 'Current.Department.ID': 'FCBBC' },
                { 'Full Name': 'Udaya Patnaik', 'Current.Department.ID': 'FC' },
                { 'Full Name': 'Audrea White', 'Current.Department.ID': 'FCBB' }];

const previewInput = (o) => Object.assign({
  sourceLabel: 'Expense Report Calculations File for LETS',
  fiscalYear: 'FY2027',
  orgFilter: 'ASD',
  rosterRows: ROSTER,
  overrideRows: [],
  requestRows: [srcRequest()],
  expenseRows: []
}, o);

// ===========================================================================
console.log('\n11. admin only, on every entrypoint');
{
  // Every one of these either reads a named traveler's financial detail or
  // writes a request that consumes a DAC's budget without review. Reading
  // budget TOTALS is deliberately open for transparency; this is not that.
  const user = loadAdmin({ isAdmin: false, email: 'reviewer@gsa.gov' });
  const fns = ['proposeTravelImportMapping', 'saveTravelImportMapping',
               'previewTravelImport', 'commitTravelImport',
               'rollbackTravelImport', 'listTravelImportBatches',
               'getTravelImportBatchRows'];
  fns.forEach(fn => {
    const r = user.call(fn, {});
    ok(fn + ' refuses a non-admin', r && r.success === false, r);
  });
  ok('and the refusal says why',
     /Administrator access is required/.test(user.call('previewTravelImport', {}).error));
  ok('the refusal is logged with the caller',
     user.logs.some(l => /refused non-admin caller reviewer@gsa\.gov/.test(l)));
  ok('and nothing was written', user.requests().length === 0);

  const admin = loadAdmin();
  ok('an admin can preview', admin.call('previewTravelImport', previewInput()).success === true);
}

// ===========================================================================
console.log('\n12. the preview writes nothing to Requests, and sends nothing');
{
  const t = loadAdmin();
  const r = t.call('previewTravelImport', previewInput({
    requestRows: [srcRequest(), srcRequest({ 'Request ID': '4H96',
      'Employee Name': 'Audrea White', 'Name': 'Trip from Washington to Dallas',
      'Total Approved Amount': 1058.16, 'Start Date': '2026-10-26',
      'End Date': '2026-10-28' })],
    expenseRows: [srcExpense()]
  }));

  ok('the preview succeeds', r.success === true, r);
  ok('REQUESTS IS UNTOUCHED', t.requests().length === 0, t.requests().length);
  // The claim the whole feature rests on. A reviewer asked to approve travel
  // that already happened will reasonably conclude the system is broken.
  ok('no email was sent', t.emails() === 0);
  ok('nothing was routed for approval', t.routed() === 0);

  ok('a PREVIEW batch is persisted', t.batches().length === 1);
  ok('and its status is PREVIEW', t.batches()[0].Status === 'PREVIEW');
  ok('the ledger holds the in-scope rows', t.ledger().length === 3, t.ledger().length);
  ok('the batch records the source label',
     /Expense Report Calculations/.test(t.batches()[0].Source_Label));
  ok('and the scope it used', t.batches()[0].Scope_Fiscal_Year === 'FY2027' &&
     t.batches()[0].Scope_Org_Filter === 'ASD');

  // THE MAPPING SNAPSHOT. A profile can be edited later; what THIS batch did
  // must stay knowable.
  const snap = JSON.parse(t.batches()[0].Mapping_Snapshot);
  ok('the mapping as used is snapshotted on the batch',
     snap.request && snap.request.sourceRecordId === 'Request ID', snap.request);
  ok('and the expense side maps the actual to Amount Approved',
     snap.expense.approvedAmount === 'Amount Approved', snap.expense);

  // THE VARIANCE BASIS, stated on every batch, because LETS will NOT agree
  // with the source workbook and somebody will ask why.
  ok('the batch records the variance basis',
     t.batches()[0].Variance_Basis === 'amount-approved');
  ok('and the summary explains the divergence',
     /Amount Approved/.test(r.data.summary.varianceBasisNote) &&
     /Report Total/.test(r.data.summary.varianceBasisNote));

  // Every source ID is preserved in the ledger — this is what makes run 2 an
  // update instead of a duplicate.
  const ids = t.ledger().map(l => l.Source_Record_ID);
  ok('the request source IDs are preserved', ids.indexOf('4GVK') > -1 &&
     ids.indexOf('4H96') > -1, ids);
  ok('the expense row gets a derived identity too',
     t.ledger().some(l => l.Source_Sheet === 'Expense' && l.Source_Record_Key));
}

// ===========================================================================
console.log('\n13. commit, and the shape of what it writes');
{
  const t = loadAdmin();
  const p = t.call('previewTravelImport', previewInput());
  const batchId = p.data.batchId;
  const c = t.call('commitTravelImport', batchId);

  ok('the commit succeeds', c.success === true, c);
  ok('one request was created', t.requests().length === 1);
  ok('and the batch is now COMMITTED', t.batches()[0].Status === 'COMMITTED');
  ok('with the committer recorded', t.batches()[0].Committed_By === 'chris@gsa.gov');

  const req = t.requests()[0];
  ok('the LETS id uses the FISCAL year prefix', /^L27-\d{4}$/.test(req.Request_ID),
     req.Request_ID);
  // THE SOURCE IDENTITY, preserved on the request itself. Without this, run 2
  // cannot tell this row came from source record 4GVK.
  ok('the source ID is stored on the request', req.Gogov_Request_ID === '4GVK');
  ok('the office resolved from the roster', req.Owning_Office === 'IDV',
     req.Owning_Office);
  ok('the estimate is the approved request amount', Number(req.Grand_Total) === 1044.34);

  // Travel that has already finished is COMPLETED; the status drives whether
  // the money is a commitment or actual spend, so it is derived from dates.
  ok('a finished trip is COMPLETED or APPROVED_GOGOV',
     ['COMPLETED', 'APPROVED_GOGOV'].indexOf(req.Status) > -1, req.Status);

  // REVIEWER FIELDS STAY EMPTY. A name there would put imported travel on
  // somebody's pending queue and record an approval that never happened.
  ok('no reviewer is named', !req.Current_Reviewer_Name && !req.Current_Reviewer_Email);
  ok('and no review level is set', !req.Initial_Review_Level);

  // EVERY ROW IS MARKED. A figure that entered the budget without review must
  // be identifiable afterward.
  ok('the row is marked as imported', /^IMPORT: /.test(req.Primary_Justification),
     req.Primary_Justification);
  ok('and names the batch, the source row and the source ID',
     req.Primary_Justification.indexOf(batchId) > -1 &&
     /source row \d+/.test(req.Primary_Justification) &&
     req.Primary_Justification.indexOf('4GVK') > -1, req.Primary_Justification);

  // Submitted_At is the TRAVEL date, not the import date. Reports group by
  // it, and stamping it `now` would file October travel under whatever month
  // the import ran — the reconciliation problem this feature exists to fix.
  ok('Submitted_At is the travel date, not today',
     String(req.Submitted_At).indexOf('2026-10') === 0, req.Submitted_At);

  // The audit log says outright that nobody approved it.
  const log = t.approvals();
  ok('an approval-log row was written', log.length === 1);
  ok('its action names the import', log[0].Action === 'TRAVEL_IMPORT');
  ok('and it states that nothing was routed or emailed',
     /NOT routed for approval and no notifications were sent/.test(log[0].Comments),
     log[0].Comments);

  ok('still no email', t.emails() === 0);
  ok('still nothing routed', t.routed() === 0);
  ok('and the response says so', c.data.notificationsSent === 0 &&
     c.data.routedForApproval === false);
}

// ===========================================================================
console.log('\n14. a batch commits ONCE, and re-running is an update');
{
  const t = loadAdmin();
  const p1 = t.call('previewTravelImport', previewInput());
  t.call('commitTravelImport', p1.data.batchId);
  ok('first commit created the request', t.requests().length === 1);

  // DOUBLE-COMMIT. Without the status check, pressing the button twice writes
  // every row twice — the exact duplication the source-ID key exists to
  // prevent, arriving by a different route.
  const again = t.call('commitTravelImport', p1.data.batchId);
  ok('committing the same batch twice is refused', again.success === false, again);
  ok('and says the batch is already committed', /COMMITTED/.test(again.error), again.error);
  ok('no second request was written', t.requests().length === 1);

  // INCREMENTAL RUN with the SAME data: recognized as unchanged.
  const p2 = t.call('previewTravelImport', previewInput());
  ok('a re-preview of identical data reports it UNCHANGED',
     p2.data.summary.unchangedCount === 1 && p2.data.summary.newCount === 0,
     p2.data.summary);
  t.call('commitTravelImport', p2.data.batchId);
  ok('and committing it creates nothing new', t.requests().length === 1,
     t.requests().length);

  // INCREMENTAL RUN with a CHANGED amount: an update, not a duplicate.
  const p3 = t.call('previewTravelImport', previewInput({
    requestRows: [srcRequest({ 'Total Approved Amount': 1200.00 })]
  }));
  ok('a changed amount is reported CHANGED',
     p3.data.summary.changedCount === 1 && p3.data.summary.newCount === 0,
     p3.data.summary);
  ok('and the diff names the before and after',
     p3.data.records[0].diffDetail.estimateAmount.from === 1044.34 &&
     p3.data.records[0].diffDetail.estimateAmount.to === 1200,
     p3.data.records[0].diffDetail);
  t.call('commitTravelImport', p3.data.batchId);
  ok('committing it updates in place', t.requests().length === 1);
  ok('and the new amount landed', Number(t.requests()[0].Grand_Total) === 1200);
}

// ===========================================================================
console.log('\n15. THE NUMERIC-ID TRAP, end to end');
{
  // §2 proved normalizeSourceId. This proves the whole path: a numeric source
  // ID must not re-import as a new request on the second run.
  //
  // MEASURED: 7 of 1,024 real IDs are all-digit and the spreadsheet stores
  // them as numbers. Without normalization these seven duplicate on EVERY
  // run, each time consuming a DAC's budget again.
  const t = loadAdmin();
  const numeric = previewInput({
    requestRows: [srcRequest({ 'Request ID': 4946 })]   // a NUMBER, as stored
  });
  const p1 = t.call('previewTravelImport', numeric);
  ok('a numeric ID previews as NEW', p1.data.summary.newCount === 1);
  t.call('commitTravelImport', p1.data.batchId);
  ok('and commits one request', t.requests().length === 1);
  ok('storing the normalized id', t.requests()[0].Gogov_Request_ID === '4946',
     t.requests()[0].Gogov_Request_ID);

  // Run 2, the same row arriving as the float-stringified form.
  const p2 = t.call('previewTravelImport', previewInput({
    requestRows: [srcRequest({ 'Request ID': '4946.0' })]
  }));
  ok("'4946.0' is recognized as the SAME record, not a new one",
     p2.data.summary.newCount === 0 && p2.data.summary.unchangedCount === 1,
     p2.data.summary);
  t.call('commitTravelImport', p2.data.batchId);
  ok('so no duplicate request is created', t.requests().length === 1,
     t.requests().length);
}

// ===========================================================================
console.log('\n16. a verified actual blocks the commit until overridden');
{
  const t = loadAdmin();
  // A request already in LETS carrying a VERIFIED actual — somebody read a
  // voucher and typed the figure.
  t.seedRequest({
    'Request_ID': 'L27-0001', 'Gogov_Request_ID': '4GVK',
    'Trip_Name': 'Leadership Offsite - Oct 2026', 'Grand_Total': 1044.34,
    'Actual_Total': 900.00, 'Actual_Source': 'manual',
    'Event_Start_Date': '2026-10-27', 'Event_End_Date': '2026-10-29',
    'Owning_Office': 'IDV', 'Status': 'COMPLETED', 'Version': 1
  });

  const p = t.call('previewTravelImport', previewInput({
    requestRows: [srcRequest()],
    expenseRows: [srcExpense()]
  }));
  ok('the preview flags a CONFLICT', p.data.summary.conflictCount === 1,
     p.data.summary);
  const conflictRow = p.data.records.find(r => r.diffStatus === 'CONFLICT');
  ok('and names the verified figure it would replace',
     conflictRow.conflicts[0].from === 900 &&
     conflictRow.conflicts[0].to === 959.99, conflictRow.conflicts);
  ok('explaining that it was entered manually',
     /entered manually/.test(conflictRow.conflicts[0].reason),
     conflictRow.conflicts[0].reason);

  // @clolry: "Never overwrite verified financial records without an explicit
  // reconciliation rule." The commit REFUSES rather than merely warning.
  const c1 = t.call('commitTravelImport', p.data.batchId);
  ok('the commit is REFUSED, not merely warned about', c1.success === false, c1);
  ok('and it asks for confirmation', c1.needsConfirmation === true);
  ok('naming the row', c1.conflicts.length === 1 &&
     c1.conflicts[0].targetRequestId === 'L27-0001', c1.conflicts);
  ok('THE VERIFIED FIGURE IS UNTOUCHED',
     Number(t.requests()[0].Actual_Total) === 900, t.requests()[0].Actual_Total);
  ok('and the batch is still PREVIEW, so it can be retried',
     t.batches()[0].Status === 'PREVIEW');

  // An explicit override, with a reason, is honoured — and recorded.
  const importId = c1.conflicts[0].importId;
  const overrides = {}; overrides[importId] = 'Voucher reissued; GSA repaid 959.99.';
  const c2 = t.call('commitTravelImport', p.data.batchId, { overrides: overrides });
  ok('an explicit override commits', c2.success === true, c2);
  ok('and the new actual landed',
     Number(t.requests()[0].Actual_Total) === 959.99, t.requests()[0].Actual_Total);
  ok('the reason is written into the reconciliation notes',
     /Voucher reissued/.test(String(t.requests()[0].Reconciliation_Notes)),
     t.requests()[0].Reconciliation_Notes);
  ok('and names who overrode it',
     /chris@gsa\.gov/.test(String(t.requests()[0].Reconciliation_Notes)));

  const led = t.ledger().find(l => l.Import_ID === importId);
  ok('the ledger records that a verified figure was overwritten',
     led.Overwrote_Verified === true, led.Overwrote_Verified);
  ok('with the reason and the actor',
     /Voucher reissued/.test(led.Override_Reason) &&
     led.Override_By === 'chris@gsa.gov', led);
}

// ===========================================================================
console.log('\n17. rollback');
{
  const t = loadAdmin();
  const p = t.call('previewTravelImport', previewInput({
    requestRows: [srcRequest(), srcRequest({ 'Request ID': '4H96',
      'Employee Name': 'Audrea White', 'Name': 'Trip from Washington to Dallas',
      'Total Approved Amount': 1058.16, 'Start Date': '2026-10-26',
      'End Date': '2026-10-28' })]
  }));
  const batchId = p.data.batchId;
  t.call('commitTravelImport', batchId);
  ok('two requests were created', t.requests().length === 2);

  // A REASON IS REQUIRED. Rollback destroys financial records; a reason is
  // the cheapest audit control available and the one most likely to matter
  // six months later.
  const noReason = t.call('rollbackTravelImport', batchId, '');
  ok('rollback without a reason is refused', noReason.success === false, noReason);
  ok('and still has both requests', t.requests().length === 2);

  const rb = t.call('rollbackTravelImport', batchId, 'Wrong source file.');
  ok('rollback succeeds with a reason', rb.success === true, rb);
  ok('both created requests are gone', t.requests().length === 0,
     t.requests().length);
  ok('and the count is reported', rb.data.deleted === 2, rb.data);
  ok('the batch is ROLLED_BACK', t.batches()[0].Status === 'ROLLED_BACK');
  ok('with the reason and actor recorded',
     t.batches()[0].Rollback_Reason === 'Wrong source file.' &&
     t.batches()[0].Rolled_Back_By === 'chris@gsa.gov');

  ok('rolling back twice is refused',
     t.call('rollbackTravelImport', batchId, 'again').success === false);
}

// ===========================================================================
console.log('\n18. rollback deletes from the BOTTOM UP');
{
  // THE BUG THIS SECTION EXISTS FOR. Deleting row 2 shifts row 3 into
  // position 2, so ascending deletion removes the WRONG rows after the first
  // — and here the wrong row is somebody else's travel request.
  //
  // Three imported rows interleaved with a pre-existing one. If deletion is
  // ascending, the survivor is wrong.
  const t = loadAdmin();
  t.seedRequest({
    'Request_ID': 'L27-9999', 'Trip_Name': 'PRE-EXISTING, MUST SURVIVE',
    'Grand_Total': 500, 'Owning_Office': 'CM', 'Version': 1,
    'Primary_Justification': 'Submitted through the form'
  });

  const p = t.call('previewTravelImport', previewInput({
    requestRows: [
      srcRequest({ 'Request ID': 'AAA1' }),
      srcRequest({ 'Request ID': 'AAA2' }),
      srcRequest({ 'Request ID': 'AAA3' })
    ]
  }));
  t.call('commitTravelImport', p.data.batchId);
  ok('four rows now exist', t.requests().length === 4);

  const rb = t.call('rollbackTravelImport', p.data.batchId, 'Testing deletion order.');
  ok('three were deleted', rb.data.deleted === 3, rb.data);
  ok('exactly one row survives', t.requests().length === 1, t.requests().length);
  ok('AND IT IS THE PRE-EXISTING ONE',
     t.requests()[0].Request_ID === 'L27-9999',
     t.requests().map(r => r.Request_ID));
}

// ===========================================================================
console.log('\n19. rollback does not destroy a human\'s later edit');
{
  // A rollback that silently deletes an administrator's corrections is worse
  // than one that stops and says so. Version > 1 means somebody touched it.
  const t = loadAdmin();
  const p = t.call('previewTravelImport', previewInput());
  t.call('commitTravelImport', p.data.batchId);
  ok('the request was created', t.requests().length === 1);

  // Somebody edits it afterward.
  t.run(`(function () {
    var t = __S['Requests'];
    var hi = {}; t.headers.forEach(function (h, i) { hi[h] = i; });
    t.rows[0][hi['Version']] = 2;
  })()`);

  const rb = t.call('rollbackTravelImport', p.data.batchId, 'Testing edit protection.');
  ok('rollback succeeds', rb.success === true, rb);
  ok('but the edited request is NOT deleted', t.requests().length === 1);
  ok('it is reported for manual review', rb.data.keptForReview.length === 1,
     rb.data.keptForReview);
  ok('NAMED, not just counted',
     rb.data.keptForReview[0].requestId === t.requests()[0].Request_ID,
     rb.data.keptForReview);
  ok('with the version that caused it',
     /version 2/.test(rb.data.keptForReview[0].reason),
     rb.data.keptForReview[0].reason);
}

// ===========================================================================
console.log('\n20. errors are per-row, and reach the error log');
{
  const t = loadAdmin();
  const p = t.call('previewTravelImport', previewInput({
    requestRows: [
      srcRequest(),                                        // good
      srcRequest({ 'Request ID': '', 'Employee Name': 'Beverly Machinist' }), // no id
      srcRequest({ 'Request ID': 'BAD2', 'Start Date': '', 'End Date': '' })  // no dates
    ]
  }));

  ok('the preview still succeeds', p.success === true, p);
  // ONE BAD ROW MUST NOT VOID A BATCH. @clolry is reconciling a quarter of a
  // year; an all-or-nothing file-level failure means one typo blocks
  // everything and gives no clue which row caused it.
  ok('the good row is still importable', p.data.summary.newCount >= 1,
     p.data.summary);
  ok('and the bad ones are counted as errors', p.data.summary.errorCount >= 1,
     p.data.summary);

  const errs = p.data.records.filter(r => r.diffStatus === 'ERROR');
  ok('each error names its source row', errs.every(e => e.sourceRow > 0),
     errs.map(e => e.sourceRow));
  ok('the missing-ID row explains why an ID is needed',
     errs.some(e => /prevents duplicates/.test(e.errorMessage || '')),
     errs.map(e => e.errorMessage));

  // @clolry asked for an error log. Per-row detail is in the ledger; Error_Log
  // is where an administrator already looks.
  ok('errors are sent to logError too', /travelImportPreview/.test(t.errors()),
     t.errors().slice(0, 200));

  const led = t.ledger().filter(l => l.Diff_Status === 'ERROR');
  ok('and persisted in the ledger with their message',
     led.length >= 1 && led.every(l => String(l.Error_Message).length > 0),
     led.map(l => l.Error_Message));
}

// ===========================================================================
console.log('\n21. measured against the REAL workbook');
{
  // WHY THIS SECTION SKIPS RATHER THAN FAILS WHEN THE FILE IS ABSENT
  // ----------------------------------------------------------------
  // The source workbook carries ~1,900 real GSA traveler names, 823 real
  // email addresses and 274 employee IDs. Finding G-056 already flags six
  // real employees' addresses in test fixtures as a problem; committing this
  // would be a much larger instance of the same thing, and git history is not
  // something you can take back. So it is gitignored and this section skips
  // on a fresh checkout — exactly as test_gogov_sync.js §8 does.
  //
  // To run it: convert the workbook to JSON at the path below. The converter
  // is documented in docs/DEPLOYMENT_TRAVEL_IMPORT.md §6.
  const FIXTURE = '/tmp/opencode/fy27_workbook.json';

  if (!fs.existsSync(FIXTURE)) {
    skip('the measured section', 'no workbook fixture at ' + FIXTURE +
         ' (expected on a fresh checkout — see the comment)');
  } else {
    const wb = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

    // The shape itself is an assertion: if Chiquita restructures the
    // workbook, this is where it shows up rather than at the first import.
    ok('the workbook has both source tabs',
       !!wb.TravelRequest && !!wb.Expense);
    ok('and both lookup tabs',
       !!wb.OfficeSymbol && !!wb.OffSymbolOverride);
    ok('TravelRequest has 1,024 data rows', wb.TravelRequest.rows.length === 1024,
       wb.TravelRequest.rows.length);
    ok('Expense has 274', wb.Expense.rows.length === 274, wb.Expense.rows.length);

    // THE DEFAULT MAPPING MATCHES THE REAL HEADERS. If it did not, the admin
    // would have to remap by hand on the very first run.
    const rm = T.proposeMapping(wb.TravelRequest.headers, 'request');
    const em = T.proposeMapping(wb.Expense.headers, 'expense');
    ok('the request defaults map cleanly', rm.missing.length === 0, rm.missing);
    ok('the expense defaults map cleanly', em.missing.length === 0, em.missing);
    ok('and the actual maps to Amount Approved, not Report Total',
       em.mapping.approvedAmount === 'Amount Approved' &&
       em.mapping.claimedAmount === 'Report Total');

    const roster = T.buildOrgRoster(wb.OfficeSymbol.rows, wb.OffSymbolOverride.rows);
    ok('the roster covers the ASD workforce', Object.keys(roster).length > 800,
       Object.keys(roster).length);

    const preview = T.buildPreview({
      requestRows: wb.TravelRequest.rows,
      expenseRows: wb.Expense.rows,
      requestMapping: rm.mapping,
      expenseMapping: em.mapping,
      orgRoster: roster,
      scope: { fiscalYear: 'FY2027', orgFilter: 'ASD' },
      existingBySourceId: {},
      letsRequests: []
    });
    const s = preview.summary;

    // ---- THE NUMBERS. A behavior change shows up as one of these moving.
    ok('28 FY27 ASD requests are in scope',
       preview.records.filter(r => r.scopeDecision === 'IN_SCOPE' &&
                              r.sourceSheet === 'TravelRequest').length === 28,
       preview.records.filter(r => r.scopeDecision === 'IN_SCOPE' &&
                              r.sourceSheet === 'TravelRequest').length);
    ok('10 FY27 ASD expense reports are in scope',
       preview.records.filter(r => r.scopeDecision === 'IN_SCOPE' &&
                              r.sourceSheet === 'Expense').length === 10,
       preview.records.filter(r => r.scopeDecision === 'IN_SCOPE' &&
                              r.sourceSheet === 'Expense').length);

    const reqAmount = T.round2(preview.records
      .filter(r => r.scopeDecision === 'IN_SCOPE' && r.sourceSheet === 'TravelRequest')
      .reduce((a, r) => a + r.estimateAmount, 0));
    ok('the committed FY27 ASD estimate is $46,196.19', reqAmount === 46196.19, reqAmount);

    const expAmount = T.round2(preview.records
      .filter(r => r.scopeDecision === 'IN_SCOPE' && r.sourceSheet === 'Expense')
      .reduce((a, r) => a + r.approvedAmount, 0));
    ok('the FY27 ASD actuals total $16,863.62', expAmount === 16863.62, expAmount);

    // The exclusions, which are 97% of the file. These counts are what the
    // preview screen reports, and what proves the importer is filtering
    // rather than losing rows.
    ok('the non-travel insurance rows are excluded',
       s.scopeCounts.OUT_OF_SCOPE_NON_TRAVEL === 5,
       s.scopeCounts.OUT_OF_SCOPE_NON_TRAVEL);
    ok('every source row is accounted for in exactly one bucket',
       Object.keys(s.scopeCounts).reduce((a, k) => a + s.scopeCounts[k], 0) ===
       wb.TravelRequest.rows.length + wb.Expense.rows.length,
       s.scopeCounts);

    // ---- NO ERRORS on the real in-scope data. A validation rule that
    // rejected real rows would be a rule that is wrong.
    ok('no in-scope row fails validation', s.errorCount === 0,
       preview.records.filter(r => r.diffStatus === 'ERROR')
         .map(r => r.sourceRow + ': ' + r.errorMessage).slice(0, 5));

    // ---- MATCHING, measured. 9 by title, 1 by date, 1 needing review.
    const matched = preview.records.filter(
      r => r.scopeDecision === 'IN_SCOPE' && r.sourceSheet === 'Expense' &&
           r.matchStatus === 'AUTO_MATCHED');
    ok('9 of 10 expense reports auto-match', matched.length === 9, matched.length);
    ok('and one needs human review', s.needsReview === 1, s.needsReview);

    // THE PATNAIK CASE — the near-miss §6 protects against, in the real data.
    // His report ends 2026-10-02 and belongs to request 4GNF, which starts
    // 2026-09-30 and is therefore FY2026 and NOT imported. The matcher must
    // still SEE it: three requests share his name and title, so the honest
    // answer is NEEDS_REVIEW with all three proposed — not a silent match to
    // the FY2027 trip three weeks later.
    const patnaik = preview.records.find(
      r => r.sourceSheet === 'Expense' && r.scopeDecision === 'IN_SCOPE' &&
           /Patnaik/i.test(r.employeeName));
    ok('the straddling report is NOT auto-matched',
       patnaik && patnaik.matchStatus === 'NEEDS_REVIEW',
       patnaik && patnaik.matchStatus);
    ok('and the FY2026 request it really belongs to IS proposed',
       patnaik && patnaik.matchCandidates.some(c => c.requestId === '4GNF'),
       patnaik && patnaik.matchCandidates.map(c => c.requestId));
    ok('alongside the FY2027 trip it must not be silently matched to',
       patnaik && patnaik.matchCandidates.some(c => c.requestId === '4NFL'),
       patnaik && patnaik.matchCandidates.map(c => c.requestId));

    // ---- THE VARIANCE GAP. This is the finding @clolry should see: the
    // source workbook computes variance from Report Total, so LETS will not
    // agree with it, and the difference is exactly the disallowed amount.
    if (wb.Combined) {
      // BLANK IS NOT ZERO, and this helper got that wrong on the first
      // attempt. `Number('')` is 0, not NaN, so a naive numeric coercion
      // admitted the 8 'No Travel Request' rows as $0.00 estimates and the
      // variance totals came out -$4,304.15 instead of -$1,491.32.
      //
      // That is precisely the class of error this section exists to measure,
      // arriving in the measuring code. Worth the comment: anywhere a money
      // column can be empty, blank must be distinguished from zero BEFORE
      // coercion, not after.
      const num = (v) => {
        if (v === '' || v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      };
      const rows = wb.Combined.rows.filter(r => num(r['Total Approved Amount']) !== null);
      ok('20 of the 28 rows have a matched request',
         rows.length === 20, rows.length);
      ok('and 8 are reported as having no travel request',
         wb.Combined.rows.length - rows.length === 8);

      const stated = T.round2(rows.reduce(
        (a, r) => a + num(r['Variance from Travel Request']), 0));
      const trueVar = T.round2(rows.reduce(
        (a, r) => a + T.round2(num(r['Amount Approved']) - num(r['Total Approved Amount'])), 0));
      const disallowed = T.round2(rows.reduce(
        (a, r) => a + T.round2(num(r['Report Total']) - num(r['Amount Approved'])), 0));

      ok("the workbook's stated variance is -$326.93", stated === -326.93, stated);
      ok('the variance on Amount Approved is -$1,491.32', trueVar === -1491.32, trueVar);
      ok('and the $1,164.39 gap is EXACTLY the disallowed amount',
         T.round2(stated - trueVar) === disallowed && disallowed === 1164.39,
         { gap: T.round2(stated - trueVar), disallowed: disallowed });
    } else {
      skip('the variance-basis comparison', 'the Combined tab is not in the fixture');
    }
  }
}

// ===========================================================================
console.log('\n22. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/30_services/TravelImport.js', 'utf8');

  function patched(find, replace, label) {
    const out = src.replace(find, replace);
    ok('negative control patched ' + label, out !== src);
    const c = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN, isFinite
    });
    vm.runInContext(fs.readFileSync('lets_app/server/30_services/GogovSync.js', 'utf8'), c);
    vm.runInContext(out, c, { filename: 'TravelImport.js (' + label + ')' });
    return vm.runInContext('TravelImport', c);
  }

  // 22a — drop the numeric-ID normalization. §2 and §15 must fail.
  {
    const g = patched(
      "    var floaty = /^(\\d+)\\.0+$/.exec(s);\n    if (floaty) return floaty[1];\n",
      '', 'the float-suffix strip');
    ok("without it '4946.0' no longer matches 4946",
       g.normalizeSourceId('4946.0') !== g.normalizeSourceId(4946),
       'so sections 2 and 15 are exercising a real guard');
  }

  // 22b — drop the string-serial branch. §4 must fail, and in the specific
  // way that matters: a trip silently leaves the scope.
  {
    const g = patched(
      /    if \(typeof v === 'string'\) \{\n      var t = v\.trim\(\);[\s\S]*?\n    \}\n\n    var g = _gogov_\(\);/,
      '    var g = _gogov_();', 'the string-serial branch');
    const bad = g.toDateString('46356');
    ok("without it '46356' becomes the YEAR 46356, not a 2026 date",
       bad !== '2026-11-30', bad);
    ok('and its fiscal year is nonsense, so the row drops out of scope silently',
       g.fiscalYearOf(bad) !== 'FY2027', g.fiscalYearOf(bad));
  }

  // 22c — make the office lookup first-match instead of longest-prefix.
  // §9 must fail.
  {
    const g = patched(
      '      if (k.length <= bestLen) return;',
      '      if (bestLen) return;', 'the longest-prefix rule');
    ok('first-match charges an IDV trip to the Front Office',
       g.officeForOrgCode('FCBAEBE') === 'FO',
       'so section 9 is exercising a real rule: ' + g.officeForOrgCode('FCBAEBE'));
  }

  // 22d — let a verified actual be overwritten. §7 and §16 must fail.
  {
    const g = patched(
      "    if (_str_(existing.actualSource).toLowerCase() === 'manual') return true;",
      '', 'the verified-actual rule');
    ok('without it a manual actual is no longer protected',
       g.isVerifiedActual({ actual: 1500, actualSource: 'manual' }) === false,
       'so sections 7 and 16 are exercising a real guard');
    const d = g.diffRecord(
      { sourceSheet: 'Expense', approvedAmount: 959.99, estimateAmount: 0,
        startDate: '', endDate: '', officeCode: 'IDV' },
      { requestId: 'L27-0001', actual: 900, actualSource: 'manual', owningOffice: 'IDV' });
    ok('and the overwrite becomes an ordinary CHANGE', d.status === 'CHANGED', d.status);
  }

  // 22e — fiscal-year filter the match pool. §6 and §21 must fail, and this
  // is the one that moves real money to the wrong trip.
  {
    const g = patched(
      '    (allRequests || []).forEach(function (r) {',
      "    (allRequests || []).filter(function (x) { return x.fiscalYear === 'FY2027'; })\n      .forEach(function (r) {",
      'the unfiltered candidate pool');
    const pool = g.candidatePool([
      { sourceRecordId: '4GNF', tripName: 'Trip from San Francisco to Washington',
        startDate: '2026-09-30', endDate: '2026-10-02', estimateAmount: 1337.74,
        employeeNameNormalized: 'UDAYA PATNAIK', fiscalYear: 'FY2026' },
      { sourceRecordId: '4NFL', tripName: 'Trip from San Francisco to Washington',
        startDate: '2026-11-01', endDate: '2026-11-03', estimateAmount: 1449.55,
        employeeNameNormalized: 'UDAYA PATNAIK', fiscalYear: 'FY2027' }
    ], []);
    ok('a filtered pool loses the request the report belongs to',
       !pool.some(c => c.requestId === '4GNF'), pool.map(c => c.requestId));
    // And THIS is the damage: with 4GNF gone, the FY2027 trip becomes the
    // only title match and $1,176.10 posts against the wrong trip.
    const gg = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN, isFinite
    });
    vm.runInContext(fs.readFileSync('lets_app/server/30_services/GogovSync.js', 'utf8'), gg);
    const G = vm.runInContext('GogovSync', gg);
    const m = G.matchExpense({
      extractedLetsId: '', reportName: 'Trip from San Francisco to Washington',
      employeeName: 'Patnaik, Udaya', employeeNameNormalized: 'UDAYA PATNAIK',
      reportEndDate: '2026-10-02', amountApproved: 1176.10
    }, pool);
    ok('and the actual auto-matches to the WRONG trip',
       m.status === 'AUTO_MATCHED' && m.requestId === '4NFL',
       'so section 6 is exercising a real decision: ' + JSON.stringify(m));
  }

  // 22f — stop detecting non-travel. §8 must fail.
  {
    const g = patched(
      '    if (/professional liability|liability insurance/.test(name)) {',
      '    if (false) {', 'the non-travel detector');
    ok('without it insurance enters the scope as a phantom trip',
       g.scopeDecision({ tripName: 'Professional Liability Insurance',
                         fiscalYear: 'FY2027', fiscalYearBasis: 'report-end-date',
                         inOrgRoster: true, officeCode: 'IDV' },
                       { fiscalYear: 'FY2027', orgFilter: 'ASD' }).decision === 'IN_SCOPE',
       'so section 8 is exercising a real filter');
  }
}

// ===========================================================================
console.log('\n23. the page is actually wired to it');
{
  // A feature nobody can reach is not a feature. Every prior increment in
  // this repo that shipped "server side only" stayed unreachable until
  // somebody noticed — GogovSync sat fully tested and completely unwired
  // through four commits.
  const page = fs.readFileSync('lets_app/client/pages/travelBudgetDashboardPage.html', 'utf8');

  ['proposeTravelImportMapping', 'saveTravelImportMapping', 'previewTravelImport',
   'commitTravelImport', 'rollbackTravelImport', 'listTravelImportBatches']
    .forEach(fn => {
      ok('the page calls ' + fn, page.indexOf("'" + fn + "'") > -1);
    });

  ok('the import button exists', /id="btnImportWorkbook"/.test(page));
  ok('and is revealed only for an admin',
     /btnImportWorkbook'\)\.classList\.remove\('d-none'\)/.test(page));

  // All four steps have to exist, or the wizard dead-ends.
  [1, 2, 3, 4].forEach(n => {
    ok('step ' + n + ' has a pane', new RegExp('data-wb-pane="' + n + '"').test(page));
  });

  // THE PARSER URL MUST RESOLVE, AND BE PINNED. Both halves matter, and the
  // first one is here because asserting only the version string is what let a
  // dead URL through 244 passing assertions into the first live import.
  //
  // WHAT HAPPENED: the tag read cdn.jsdelivr.net/npm/xlsx@0.20.2 and 404'd —
  // "Couldn't find the requested release version 0.20.2". jsdelivr's /npm/
  // path mirrors npm, and SheetJS stopped publishing `xlsx` there after
  // 0.18.5; it self-hosts now. The version was right, the host was wrong, and
  // the page reported it as a network problem on every network.
  //
  // A string match cannot prove a URL resolves — that needs egress, which a
  // unit test must not have. So this pins the two things that ARE checkable:
  // the host that actually serves 0.20.2, and the absence of the npm path
  // that cannot. Reachability is a deploy-time check, noted in the guide.
  const parserTag = /<script src="([^"]*xlsx[^"]*)"/.exec(page);
  ok('the spreadsheet parser is loaded from a script tag', !!parserTag, page.slice(0, 200));
  const parserUrl = parserTag ? parserTag[1] : '';
  ok('the spreadsheet parser is version-pinned',
     /0\.20\.2/.test(parserUrl), parserUrl);
  ok('and served from the host that actually publishes 0.20.2',
     /^https:\/\/cdn\.sheetjs\.com\//.test(parserUrl), parserUrl);
  ok('NOT from jsdelivr/npm, which stopped carrying xlsx after 0.18.5',
     parserUrl.indexOf('jsdelivr.net/npm/xlsx') === -1, parserUrl);
  ok('and a failed parser load is reported, not left to throw',
     /The spreadsheet parser did not load/.test(page));

  // raw:true keeps Excel serials as serials. Letting SheetJS format them
  // would hand the server a locale-formatted string.
  ok('dates are read as raw serials', /raw: true/.test(page));

  // THE HONESTY REQUIREMENTS, carried into the UI.
  ok('the preview states the variance basis divergence',
     /varianceBasisNote/.test(page));
  ok('the UI says records are not routed and no emails are sent',
     /not routed for approval and no emails/i.test(page));
  ok('conflicts require a typed reason to override',
     /data-wb-override/.test(page) && /leave it blank to keep/i.test(page));
  ok('rollback demands a reason in the UI as well as the server',
     /Reason \(required\)/.test(page));
  ok('and the excluded rows are shown rather than hidden',
     /wbExcluded/.test(page) && /Excluded rows and errors/.test(page));

  // A class used but never defined renders as nothing — the kind of thing
  // that looks fine until someone reads the styles.
  ok('no undefined form-label--sm class (it lives in travelRequestStyles, '
     + 'which this page does not include)',
     page.indexOf('form-label--sm') === -1);
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
if (skipped) console.log(skipped + ' assertion group(s) skipped.');
process.exit(fails ? 1 : 0);
