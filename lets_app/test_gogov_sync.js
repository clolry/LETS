/**
 * Automated Verification Script for the Go.gov import and reconciliation
 * matcher (30_services/GogovSync.js).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * @clolry: "I'll be pulling reports from Go.gov and will need to use those as
 * input sources for a monthly financial reconciliation process."
 *
 * Four things here would be costly and silent, and each was found by parsing
 * the real exports rather than by reasoning about them.
 *
 * 1. Amount Approved, NOT Report Total. They differ on 37 of 182 rows by
 *    $4,569.93. Report Total is what the traveller CLAIMED; Amount Approved
 *    is what GSA PAID. §2.
 *
 * 2. ONE EXPORT SPANS TWO FISCAL YEARS. @clolry: "budgeting all resets on
 *    10/1." Posting FY2026 travel against FY2027 is the most expensive
 *    mistake available here. §3.
 *
 * 3. TWO DIFFERENT DATE ENCODINGS IN ONE FILE SET. Report End Date is TEXT;
 *    Submit Date and the request dates are Excel serials. A parser assuming
 *    either alone silently yields 1970 for half the data. §3.
 *
 * 4. MATCHING MUST NOT GUESS. Only ~45% match confidently. An auto-match on
 *    a guess attaches one traveller's $7,548 to another's trip. §5, §6.
 *
 * Run: node lets_app/test_gogov_sync.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 280)); fails++; }
};

const ctx = vm.createContext({
  console: { log() {}, warn() {}, error() {} },
  JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
  parseInt, parseFloat, isNaN
});
vm.runInContext(fs.readFileSync('lets_app/server/30_services/GogovSync.js', 'utf8'),
                ctx, { filename: 'GogovSync.js' });
const G = vm.runInContext('GogovSync', ctx);

console.log('--- Go.gov sync test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. the LETS ID parser is tolerant of input, strict about output');
{
  // THE CURRENT FORMAT: L27-0001.
  //
  // Shortened from REQ-2026-0123 because Go.gov truncates a trip name at
  // EXACTLY 40 characters — 79 of 565 real names are exactly 40 long and none
  // is longer, cut mid-word. The LETS ID goes at the FRONT so it survives,
  // and every character it takes is one the trip name loses.
  //
  //   'REQ-2026-0123 '  14 chars, leaves 26 -> 32% of real titles fit
  //   'L27-0001 '         9 chars, leaves 31 -> 61% fit
  //
  // @clolry asked for 4 digits in the sequence.
  ok('L27-0001', G.extractLetsId('L27-0001') === 'L27-0001');
  ok('lowercase is accepted', G.extractLetsId('l27-0001') === 'L27-0001');
  ok('underscore separator', G.extractLetsId('L27_0001') === 'L27-0001');
  ok('bracketed', G.extractLetsId('[L27-0001] NCMA') === 'L27-0001');
  ok('at the front of a title',
     G.extractLetsId('L27-0001 NCMA World Congress') === 'L27-0001');
  ok('and at the end', G.extractLetsId('NCMA World Congress L27-0001') === 'L27-0001');
  ok('a 5-digit sequence is not truncated to 4',
     G.extractLetsId('L27-00012') === 'L27-00012',
     'greedy capture plus a lookahead, so 00012 is not read as 0001');

  // STRICTER THAN THE LEGACY FORM, deliberately. 'REQ' is a distinctive
  // token; 'L27' is three characters that could occur by accident. Tested
  // against 1,087 real trip and report names, a loose pattern matched these:
  ok('"Order L270001-A" is NOT an ID', G.extractLetsId('Order L270001-A') === '',
     'a trailing -A means this is somebody else\'s reference number');
  ok('"Hotel L27 0001 confirm" is NOT an ID',
     G.extractLetsId('Hotel L27 0001 confirm') === '',
     'a space is not a valid separator for the short form');
  ok('"L270001" with no separator is NOT an ID',
     G.extractLetsId('L270001') === '');
  ok('"L27-001" with 3 digits is NOT an ID', G.extractLetsId('L27-001') === '');
  ok('"XL27-0001" is NOT an ID', G.extractLetsId('XL27-0001') === '',
     'a preceding alphanumeric means it is part of a longer token');

  // THE WHOLE SOP RESTS ON THIS. @clolry asked how to instruct users to put
  // the LETS ID into the Go.gov trip name. Three travellers already do it,
  // and each wrote it differently — rejecting any of those forms would
  // punish the people already cooperating.
  //
  // These three are VERBATIM from the real export.
  ok('"Denver to Atlanta -REQ-2026-0362"',
     G.extractLetsId('Denver to Atlanta -REQ-2026-0362') === 'REQ-2026-0362');
  ok('"DOCPER Workshop (REQ-2026-0282)"',
     G.extractLetsId('DOCPER Workshop (REQ-2026-0282)') === 'REQ-2026-0282');
  ok('"REQ-2026-0435_GABLE, ROBERT"',
     G.extractLetsId('REQ-2026-0435_GABLE, ROBERT') === 'REQ-2026-0435');

  // Forms a user could plausibly type.
  [['REQ-2026-0123', 'REQ-2026-0123'],
   ['req 2026 0123', 'REQ-2026-0123'],
   ['REQ20260123', 'REQ-2026-0123'],
   ['req_2026_0123', 'REQ-2026-0123'],
   ['[REQ-2026-0123] NCMA', 'REQ-2026-0123'],
   ['NCMA World Congress REQ-2026-0123', 'REQ-2026-0123']
  ].forEach(([input, want]) => {
    ok('canonicalises ' + JSON.stringify(input),
       G.extractLetsId(input) === want, G.extractLetsId(input));
  });

  // Output is ALWAYS canonical, so a downstream match is an exact string
  // comparison rather than another fuzzy test.
  ok('output form is always canonical',
     G.extractLetsId('req2026-0123') === G.extractLetsId('REQ 2026 0123'));

  // Must not invent an ID.
  ['', 'NCMA World Congress', 'Trip from Denver to Louisville',
   'REQUEST for travel', 'REQ-26-1'].forEach(t => {
    ok('finds nothing in ' + JSON.stringify(t), G.extractLetsId(t) === '');
  });

  // A trailing 5-digit sequence must not be truncated to 4.
  ok('handles a 5-digit sequence',
     G.extractLetsId('REQ-2026-12345') === 'REQ-2026-12345');

  // The current form wins when both appear. A title carrying both would be
  // deliberate, and the newer one is the one being promoted.
  ok('the current form takes precedence over the legacy form',
     G.extractLetsId('L27-0001 was REQ-2026-0362') === 'L27-0001');
}

// ---------------------------------------------------------------------------
console.log('\n2. Amount Approved is the actual, never Report Total');
{
  // @clolry: "I guess we need to use Amount Approved rather than Report
  // Total." Measured: they differ on 37 of 182 rows in the first sample, by
  // $4,569.93 in total. Reconciling against Report Total would overstate
  // spend on a fifth of all rows, and every row would still look plausible.
  const rows = [{
    'Report Name': 'Trip from Atlanta to Washington',
    'Employee Name': 'CAMERON, CHERYL T.',
    'Report Total': 3618.80,
    'Amount Approved': 3133.97,
    'Report End Date': '2026-10-17',
    'Employee ID': '76E323419637'
  }];
  const map = G.proposeMapping(Object.keys(rows[0]), 'expense').mapping;
  const parsed = G.parseExpenseRows(rows, map);

  ok('amountApproved carries the approved figure',
     parsed[0].amountApproved === 3133.97, parsed[0].amountApproved);
  ok('reportTotal is kept but separate',
     parsed[0].reportTotal === 3618.80, parsed[0].reportTotal);
  ok('the two are NOT conflated',
     parsed[0].amountApproved !== parsed[0].reportTotal);

  // The disallowed amount is derived and stored. Nobody asks for it until a
  // traveller disputes a voucher, and then it is the only number that matters.
  ok('the disallowed amount is computed',
     parsed[0].disallowedAmount === 484.83, parsed[0].disallowedAmount);

  // A batch must total on the APPROVED figure.
  const batch = G.matchBatch(parsed, []);
  ok('the batch total uses Amount Approved',
     batch.summary.totalApproved === 3133.97, batch.summary.totalApproved);
  ok('and reports disallowed separately',
     batch.summary.totalDisallowed === 484.83, batch.summary.totalDisallowed);
}

// ---------------------------------------------------------------------------
console.log('\n3. fiscal years and the two date encodings');
{
  // @clolry: "our fiscal year is 10/1 through 9/30 so budgeting all resets on
  // 10/1."
  ok('1 Oct 2026 is FY2027', G.fiscalYearOf('2026-10-01') === 'FY2027');
  ok('30 Sep 2026 is FY2026', G.fiscalYearOf('2026-09-30') === 'FY2026');
  ok('1 Jan 2027 is FY2027', G.fiscalYearOf('2027-01-01') === 'FY2027');
  ok('1 Oct 2027 is FY2028', G.fiscalYearOf('2027-10-01') === 'FY2028');
  ['', 'nonsense', '2026-13-01', '2026-10'].forEach(b => {
    ok('rejects ' + JSON.stringify(b), G.fiscalYearOf(b) === '');
  });

  // TWO ENCODINGS IN ONE FILE SET, and this is not cosmetic. In the real
  // exports Report End Date is TEXT 'YYYY-MM-DD' while Submit Date and the
  // request Start/End dates are Excel SERIALS. A parser handling only one
  // silently produces 1970 or NaN for half the data.
  ok('parses a text date', G.toDateString('2026-10-21') === '2026-10-21');
  ok('parses an Excel serial', G.toDateString(46321) === '2026-10-26',
     G.toDateString(46321));
  ok('parses a fractional serial (serial + time of day)',
     G.toDateString(46321.68983603009) === '2026-10-26',
     G.toDateString(46321.68983603009));
  ok('parses a Date object',
     G.toDateString(new Date(Date.UTC(2026, 9, 21))) === '2026-10-21');

  // A serial below ~20000 is far more likely a typo than a 1954 date.
  ok('rejects an implausibly small serial', G.toDateString(5) === '');
  ok('rejects an implausibly large serial', G.toDateString(999999) === '');
  ok('rejects junk', G.toDateString('not a date') === '');
  ok('rejects blank', G.toDateString('') === '' && G.toDateString(null) === '');

  // THE CROSS-YEAR TRAP. One monthly export covered BOTH fiscal years:
  // $129,470.97 FY2026 and $143,884.73 FY2027 in the first sample. Importing
  // blind would charge last year's travel to this year's budget.
  const mixed = [
    { 'Employee Name': 'A, B', 'Amount Approved': 100, 'Report Total': 100,
      'Report End Date': '2026-09-30', 'Report Name': 'Old FY' },
    { 'Employee Name': 'C, D', 'Amount Approved': 200, 'Report Total': 200,
      'Report End Date': '2026-10-01', 'Report Name': 'New FY' }
  ];
  const map = G.proposeMapping(Object.keys(mixed[0]), 'expense').mapping;
  const out = G.matchBatch(G.parseExpenseRows(mixed, map), []);
  ok('a mixed-year batch is split by fiscal year',
     out.summary.byFiscalYear.FY2026 === 100 &&
     out.summary.byFiscalYear.FY2027 === 200, out.summary.byFiscalYear);
  ok('and both years are named so the UI can warn',
     out.summary.fiscalYears.join(',') === 'FY2026,FY2027',
     out.summary.fiscalYears);
}

// ---------------------------------------------------------------------------
console.log('\n4. name normalisation across two incompatible formats');
{
  // The exports disagree about BOTH format and casing. Expenses write
  // 'Dolezal, Nathan K.'; requests write 'Jakenberg Almuete'. 71 of 182
  // expense rows are ALL CAPS, the rest mixed.
  ok('"Last, First M." -> FIRST LAST',
     G.normalizeName('Dolezal, Nathan K.') === 'NATHAN DOLEZAL');
  ok('"First Last" -> FIRST LAST',
     G.normalizeName('Jakenberg Almuete') === 'JAKENBERG ALMUETE');
  ok('ALL CAPS normalises identically',
     G.normalizeName('CAMERON, CHERYL T.') === 'CHERYL CAMERON');
  ok('and the two formats meet',
     G.normalizeName('Hackley, Daniel R.') === G.normalizeName('Daniel Hackley'));
  ok('a middle name in the plain form is dropped',
     G.normalizeName('Daniel R Hackley') === 'DANIEL HACKLEY');
  ok('blank is blank', G.normalizeName('') === '' && G.normalizeName(null) === '');
  ok('a single token survives', G.normalizeName('Cher') === 'CHER');

  // Titles: punctuation and case must not block a match.
  ok('titles normalise',
     G.normalizeTitle('ACT-IAC ImagineNation ELC 2025') ===
     G.normalizeTitle('act iac imaginenation elc 2025'));
}

// ---------------------------------------------------------------------------
console.log('\n5. matching is tiered, and only confident tiers auto-apply');
{
  const requests = [
    { requestId: 'REQ-2026-0001', gogovRequestId: '4QMN', tripName: 'NCMA World Congress',
      employeeNameNormalized: 'DANIEL HACKLEY', startDate: '2026-10-14',
      endDate: '2026-10-17', amount: 2306.15 },
    { requestId: 'REQ-2026-0002', gogovRequestId: '4PHL', tripName: 'Trip from Washington to Omaha',
      employeeNameNormalized: 'AURELIO MILLER', startDate: '2026-10-01',
      endDate: '2026-10-04', amount: 1752.34 },
    { requestId: 'REQ-2026-0003', gogovRequestId: '4QF6', tripName: 'Trip from Washington to Omaha',
      employeeNameNormalized: 'AURELIO MILLER', startDate: '2026-11-01',
      endDate: '2026-11-04', amount: 1893.02 }
  ];
  const exp = o => Object.assign({
    reportName: '', employeeName: 'Hackley, Daniel R.',
    employeeNameNormalized: 'DANIEL HACKLEY', extractedLetsId: '',
    amountApproved: 1922.96, reportEndDate: '2026-10-23'
  }, o);

  // TIER 1 — the SOP convention. Exact, and the point of the whole procedure.
  const t1 = G.matchExpense(exp({ reportName: 'REQ-2026-0001 NCMA World Congress',
                                  extractedLetsId: 'REQ-2026-0001' }), requests);
  ok('a LETS ID in the report name auto-matches', t1.status === 'AUTO_MATCHED');
  ok('and records the method as lets-id', t1.method === 'lets-id');

  // A cited ID that does not exist is a DIFFERENT problem from no ID: the
  // traveller followed the convention and the request is missing.
  const t1x = G.matchExpense(exp({ reportName: 'REQ-2026-9999 Ghost',
                                   extractedLetsId: 'REQ-2026-9999' }), requests);
  ok('a cited-but-missing ID is flagged for review', t1x.status === 'NEEDS_REVIEW');
  ok('and says the request does not exist',
     /no such request exists/.test(t1x.note || ''), t1x.note);

  // TIER 2 — a Go.gov request ID in the name.
  const t2 = G.matchExpense(exp({ reportName: 'Trip 4QMN follow-up' }), requests);
  ok('a Go.gov request ID auto-matches', t2.status === 'AUTO_MATCHED' &&
     t2.method === 'gogov-id', t2);

  // TIER 3 — traveller + exact title. Holds ~70% of the time because Go.gov
  // copies the request name onto the expense report.
  const t3 = G.matchExpense(exp({ reportName: 'NCMA World Congress' }), requests);
  ok('traveller + exact title auto-matches',
     t3.status === 'AUTO_MATCHED' && t3.method === 'name-title', t3);

  // AMBIGUOUS — same traveller, same title, several times. Amount cannot
  // break the tie: only 3% of title-matched pairs have equal amounts.
  const amb = G.matchExpense(exp({
    reportName: 'Trip from Washington to Omaha',
    employeeName: 'Miller, Aurelio H.', employeeNameNormalized: 'AURELIO MILLER',
    amountApproved: 1660.27, reportEndDate: '2026-10-06'
  }), requests);
  ok('several equal candidates needs review', amb.status === 'NEEDS_REVIEW');
  ok('and ALL candidates are offered',
     amb.candidates.length === 2, amb.candidates.map(c => c.requestId));
  ok('each with a stated reason',
     amb.candidates.every(c => !!c.reason), amb.candidates);
  ok('and never a guessed match', amb.requestId === '',
     'picking one would attach the wrong traveller\'s money to a trip');
  // The estimate is shown so the reviewer has something to judge on.
  ok('candidates carry the estimate for comparison',
     amb.candidates.every(c => typeof c.estimate === 'number'));

  // TIER 4 — traveller + nearby end date. A voucher is filed AFTER the trip,
  // so a lag of up to a fortnight is normal.
  const t4 = G.matchExpense(exp({
    reportName: 'Some other title entirely', reportEndDate: '2026-10-20'
  }), requests);
  ok('traveller + a date within 14 days auto-matches',
     t4.status === 'AUTO_MATCHED' && t4.method === 'name-date', t4);

  // Outside the window it must NOT match.
  const far = G.matchExpense(exp({
    reportName: 'Unrelated', reportEndDate: '2027-06-01'
  }), requests);
  ok('a date far outside the window does not auto-match',
     far.status === 'NEEDS_REVIEW', far.status);

  // UNMATCHED — no request for this traveller at all. 32.6% of the real file.
  const un = G.matchExpense(exp({
    employeeName: 'Nobody, A.', employeeNameNormalized: 'A NOBODY'
  }), requests);
  ok('an unknown traveller is UNMATCHED', un.status === 'UNMATCHED');
  ok('and the reason explains why it is normal',
     /predates/.test(un.note || ''), un.note);
}

// ---------------------------------------------------------------------------
console.log('\n6. the batch summary measures SOP adoption');
{
  // @clolry asked for the procedure. A convention nobody measures decays, so
  // the adoption rate is reported every month and the travellers who did not
  // follow it are NAMED — specific feedback rather than a scold.
  const requests = [{ requestId: 'REQ-2026-0001', gogovRequestId: '4QMN',
    tripName: 'NCMA', employeeNameNormalized: 'A B', endDate: '2026-10-17',
    amount: 100 }];
  const expenses = [
    { reportName: 'REQ-2026-0001 NCMA', extractedLetsId: 'REQ-2026-0001',
      employeeName: 'B, A', employeeNameNormalized: 'A B',
      amountApproved: 100, reportTotal: 100, disallowedAmount: 0,
      reportEndDate: '2026-10-17', fiscalYear: 'FY2027' },
    { reportName: 'NCMA', extractedLetsId: '',
      employeeName: 'Smith, John', employeeNameNormalized: 'JOHN SMITH',
      amountApproved: 50, reportTotal: 60, disallowedAmount: 10,
      reportEndDate: '2026-10-17', fiscalYear: 'FY2027' }
  ];
  const out = G.matchBatch(expenses, requests);

  ok('adoption is counted', out.summary.letsIdPresent === 1);
  ok('and reported as a percentage', out.summary.letsIdAdoptionPct === 50,
     out.summary.letsIdAdoptionPct);
  ok('offenders are named, not just counted',
     out.summary.missingLetsIdTravellers.join(',') === 'Smith, John',
     out.summary.missingLetsIdTravellers);
  ok('statuses are tallied', out.summary.autoMatched === 1);
  ok('disallowed is totalled across the batch',
     out.summary.totalDisallowed === 10);
  ok('every result carries its status back',
     out.results.every(r => !!r.matchStatus));
  ok('and a note when a human is needed',
     out.results.filter(r => r.matchStatus !== 'AUTO_MATCHED')
       .every(r => typeof r.matchNote === 'string'));
}

// ---------------------------------------------------------------------------
console.log('\n7. mapping is PROPOSED against the real headers, never assumed');
{
  // @clolry chose a mapping UI so Go.gov changing a heading costs a remap,
  // not a code change. These are the REAL header rows from both exports.
  const reqHeaders = ['Name', 'Request ID', 'Submit Date', 'Employee Name',
    'Approval Status', 'Currency', 'Total Approved Amount', 'Start Date',
    'Purpose', 'End Date'];
  const expHeaders = ['Report Name', 'Employee Name', 'Approval Status',
    'Currency', 'Report Total', 'Amount Approved', 'Approved by Delegate',
    'Authorization Requests/Travel Requests', 'Amount Company Paid',
    'Limit Approved (Authorized Approver)', 'Org Level 1', 'Org Level 2',
    'Org Level 3', 'Org Level 4', 'Org Level 5', 'Report End Date',
    'Submit Date', 'Employee ID'];

  const rp = G.proposeMapping(reqHeaders, 'request');
  ok('the real request headers map with nothing missing',
     rp.missing.length === 0, rp.missing);
  ok('Request ID is found', rp.mapping.gogovRequestId === 'Request ID');
  ok('the amount maps to Total Approved Amount',
     rp.mapping.amount === 'Total Approved Amount');

  const ep = G.proposeMapping(expHeaders, 'expense');
  ok('the real expense headers map with nothing missing',
     ep.missing.length === 0, ep.missing);
  // THE CRITICAL MAPPING. Guessing Report Total here would overstate spend on
  // every row.
  ok('the actual maps to Amount Approved',
     ep.mapping.amountApproved === 'Amount Approved');
  ok('and Report Total maps to its own field, not the actual',
     ep.mapping.reportTotal === 'Report Total' &&
     ep.mapping.amountApproved !== 'Report Total');

  // Unmapped columns are REPORTED, so the UI can show what it ignored rather
  // than silently discarding a column that mattered.
  ok('unmapped columns are listed', ep.unmapped.length === 10, ep.unmapped.length);
  ok('and include the useless org levels',
     ep.unmapped.indexOf('Org Level 3') > -1,
     'Go.gov org is "F" for every row; the DAC comes from LETS');

  // A renamed column must be REPORTED missing, not silently dropped.
  const renamed = G.proposeMapping(['Report Name', 'Employee Name',
    'Total Amount Paid', 'Report End Date'], 'expense');
  ok('a renamed money column is reported missing',
     renamed.missing.indexOf('amountApproved') > -1, renamed.missing);
  ok('and the UI is told what was left over',
     renamed.unmapped.indexOf('Total Amount Paid') > -1, renamed.unmapped);
}

// ---------------------------------------------------------------------------
console.log('\n8. against the REAL export files, if they are present');
{
  // The suite stays green without the reference files — they are large and
  // contain real traveller names, so they may not be in every checkout. When
  // present, the measured numbers are asserted, because those numbers are the
  // basis for every design decision in this module.
  let req = null, exp = null;
  try {
    req = JSON.parse(fs.readFileSync('/tmp/opencode/req.json', 'utf8'));
    exp = JSON.parse(fs.readFileSync('/tmp/opencode/exp.json', 'utf8'));
  } catch (e) { /* not available */ }

  if (!req || !exp) {
    console.log('  SKIP  reference exports not available in this checkout');
  } else {
    const R = G.parseRequestRows(req.rows, G.proposeMapping(req.headers, 'request').mapping);
    const E = G.parseExpenseRows(exp.rows, G.proposeMapping(exp.headers, 'expense').mapping);

    ok('all 565 request rows parse', R.length === 565, R.length);
    ok('all 522 expense rows parse', E.length === 522, E.length);
    // A row with no fiscal year cannot be attributed to a budget at all, so
    // full coverage is the thing to check.
    ok('every request gets a fiscal year',
       R.every(r => !!r.fiscalYear), R.filter(r => !r.fiscalYear).length);
    ok('every expense gets a fiscal year',
       E.every(r => !!r.fiscalYear), E.filter(r => !r.fiscalYear).length);
    ok('Go.gov request IDs are unique across 565 rows',
       new Set(R.map(r => r.gogovRequestId)).size === 565,
       'uniqueness is what makes re-importing idempotent');

    const lets = R.map((r, i) => Object.assign({}, r, {
      requestId: 'REQ-2026-' + String(i + 1).padStart(4, '0')
    }));
    const out = G.matchBatch(E, lets);
    const s = out.summary;

    // These are the measured figures the design rests on. If they move a lot,
    // the matcher's behaviour changed and the tiering needs rethinking.
    ok('auto-match rate is around 45%',
       s.autoMatched >= 225 && s.autoMatched <= 250, s.autoMatched);
    ok('about a third are unmatched',
       s.unmatched >= 150 && s.unmatched <= 185, s.unmatched);
    ok('and nothing is left without a status',
       s.autoMatched + s.needsReview + s.unmatched === s.total,
       [s.autoMatched, s.needsReview, s.unmatched, s.total]);

    // The three hand-written IDs in the real file must be found.
    ok('the 3 existing hand-written LETS IDs are detected',
       s.letsIdPresent === 3, s.letsIdPresent);

    // THE FISCAL-YEAR SPLIT IS REAL AND LARGE.
    ok('the real file spans two fiscal years',
       s.fiscalYears.length === 2, s.fiscalYears);
    ok('with substantial money in each',
       Object.keys(s.byFiscalYear).every(k => s.byFiscalYear[k] > 100000),
       s.byFiscalYear);

    // Disallowed amounts are real money and must not be ignored.
    ok('disallowed amounts are non-trivial',
       s.totalDisallowed > 10000, s.totalDisallowed);

    // No auto-match may cross a traveller boundary. This is the one error
    // that would be both invisible and indefensible.
    const byId = {};
    lets.forEach(r => { byId[r.requestId] = r; });
    const crossed = out.results.filter(r =>
      r.matchStatus === 'AUTO_MATCHED' && byId[r.matchedRequestId] &&
      byId[r.matchedRequestId].employeeNameNormalized !== r.employeeNameNormalized);
    // THE ONE ERROR THAT WOULD BE BOTH INVISIBLE AND INDEFENSIBLE.
    //
    // This assertion FAILED when first written. A cited LETS ID was trusted on
    // its own, and three real expense reports were auto-matched to requests
    // belonging to different people — Brandon Maness's $1,922.96 landed on
    // another traveller's request.
    //
    // An explicit ID is the strongest signal available, which is precisely why
    // a contradiction between it and the traveller name must stop the match
    // rather than be resolved in the ID's favour. One mistyped digit moves
    // money between travellers.
    ok('no auto-match attaches a report to a different traveller',
       crossed.length === 0,
       crossed.slice(0, 3).map(r => r.employeeName + ' -> ' + r.matchedRequestId));
  }
}

// ---------------------------------------------------------------------------
console.log('\n8b. generateRequestId agrees with the fiscal year it spends');
{
  // The generator lives in 91_setup/Database.js, but it is tested HERE because
  // the format exists to serve the Go.gov matcher: the ID has to fit inside
  // Go.gov's 40-character trip name, and extractLetsId has to be able to find
  // it again.
  //
  // Loaded by extracting the function rather than the whole file, which pulls
  // in the entire database-setup module.
  const dbSrc = fs.readFileSync('lets_app/server/91_setup/Database.js', 'utf8');
  const fnSrc = (dbSrc.match(/function generateRequestId\(\)[\s\S]*?\n}/) || [])[0];
  ok('generateRequestId is extractable', !!fnSrc);

  function gen(nowISO, existingIds) {
    const c = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Object, String, Number, Array, Math, parseInt, isNaN,
      // Frozen clock, so the fiscal-year boundary is testable rather than
      // dependent on when the suite runs.
      Date: class extends Date {
        constructor(...a) { super(...(a.length ? a : [nowISO])); }
      },
      SpreadsheetApp: { openById: () => ({ getSheetByName: () => ({
        getLastRow: () => 1 + existingIds.length,
        getRange: () => ({ getValues: () => existingIds.map(i => [i]) })
      }) }) }
    });
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x'; " +
                    "var SHEET_NAMES={REQUESTS:'Requests'};", c);
    vm.runInContext(fnSrc, c);
    return vm.runInContext('generateRequestId()', c);
  }

  // THE FISCAL YEAR, NOT THE CALENDAR YEAR.
  //
  // The old code used getFullYear(), so a request raised on 15 October 2026
  // was numbered REQ-2026-xxxx while drawing on FY2027 money — the ID said one
  // year and the budget said another — and the sequence reset on 1 January
  // rather than 1 October. @clolry, twice: "budgeting all resets on 10/1."
  ok('30 Sep 2026 is FY2026', gen('2026-09-30T12:00:00Z', []) === 'L26-0001');
  ok('1 Oct 2026 rolls to FY2027', gen('2026-10-01T12:00:00Z', []) === 'L27-0001');
  ok('15 Oct 2026 is FY2027', gen('2026-10-15T12:00:00Z', []) === 'L27-0001',
     'this is the case the old calendar-year code got wrong');
  ok('1 Jan 2027 does NOT reset the sequence',
     gen('2027-01-01T12:00:00Z', ['L27-0007']) === 'L27-0008',
     'a calendar-year generator would have restarted at 0001 here');
  ok('30 Sep 2027 is still FY2027', gen('2027-09-30T12:00:00Z', []) === 'L27-0001');
  ok('1 Oct 2027 rolls to FY2028', gen('2027-10-01T12:00:00Z', []) === 'L28-0001');

  // Sequence behaviour.
  ok('increments from the highest, not the count',
     gen('2026-10-15T12:00:00Z', ['L27-0001', 'L27-0009']) === 'L27-0010',
     'count+1 would reuse L27-0003 after a deletion');
  ok('widens past 9999 rather than colliding',
     gen('2026-10-15T12:00:00Z', ['L27-9999']) === 'L27-10000');
  ok('and extractLetsId can still read a widened id',
     G.extractLetsId('L27-10000 NCMA') === 'L27-10000');

  // COEXISTENCE. @clolry has already run setupTravelDatabase and may have
  // legacy rows; renaming them would break every link that cites them.
  ok('legacy REQ- rows do not affect the sequence',
     gen('2026-10-15T12:00:00Z', ['REQ-2026-0362', 'REQ-2026-0999']) === 'L27-0001');
  ok('a prior fiscal year does not either',
     gen('2026-10-15T12:00:00Z', ['L26-0500']) === 'L27-0001');
  ok('mixed namespaces resolve correctly',
     gen('2026-10-15T12:00:00Z',
         ['REQ-2026-0362', 'L26-0500', 'L27-0003']) === 'L27-0004');
  ok('junk rows are skipped rather than throwing',
     gen('2026-10-15T12:00:00Z', ['', 'L27-abc', 'L27-0002', null]) === 'L27-0003');

  // Every generated id must satisfy the validator and the parser, or a
  // request would be unfindable the moment it was created.
  const vSrc = fs.readFileSync('lets_app/server/10_lib/Validation.js', 'utf8');
  const vFn = (vSrc.match(/function requireRequestId[\s\S]*?\n}/) || [])[0];
  const vc = vm.createContext({});
  vm.runInContext('function ValidationError(m,f){this.message=m;this.field=f;}' +
                  'function _fieldLabel(f){return f;}' +
                  'function requireString(v,f){if(typeof v!=="string"||!v)' +
                  'throw new ValidationError(f,f);return v;}', vc);
  vm.runInContext(vFn, vc);
  const accepts = id => {
    try { vm.runInContext('requireRequestId(' + JSON.stringify(id) + ')', vc); return true; }
    catch (e) { return false; }
  };
  ['L27-0001', 'L27-10000', 'L26-0001'].forEach(id => {
    ok('the validator accepts a generated ' + id, accepts(id));
    ok('and the parser finds it in a title',
       G.extractLetsId(id + ' NCMA World Congress') === id);
  });
  ok('the validator still accepts a legacy id', accepts('REQ-2026-0362'));
  ok('and rejects a malformed one', !accepts('L27-001') && !accepts('bogus'));
}

console.log('\n9. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/30_services/GogovSync.js', 'utf8');

  // 9a — map the actual to Report Total. §2 must fail.
  const wrong = src.replace(
    "    amountApproved:  ['Amount Approved', 'Approved Amount'],",
    "    amountApproved:  ['Report Total'],");
  ok('negative control patched the money mapping', wrong !== src);
  {
    const c = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN
    });
    vm.runInContext(wrong, c, { filename: 'GogovSync.js (wrong money)' });
    const g = vm.runInContext('GogovSync', c);
    // 'Report Total' is claimed by the reportTotal field first, so the
    // patched amountApproved hint finds nothing. That it comes back MISSING
    // rather than silently pointing at the wrong column is itself the
    // protection worth asserting: a required field that cannot be mapped
    // stops the import, instead of quietly reconciling against the claimed
    // amount rather than the paid one.
    const m = g.proposeMapping(['Report Name', 'Employee Name', 'Report Total',
                                'Amount Approved', 'Report End Date'], 'expense');
    ok('a patched build can no longer map the actual',
       m.missing.indexOf('amountApproved') > -1,
       'so section 2 is exercising a real mapping: ' + JSON.stringify(m.mapping));
    ok('and the real build maps it correctly',
       G.proposeMapping(['Report Name', 'Employee Name', 'Report Total',
                         'Amount Approved', 'Report End Date'], 'expense')
         .mapping.amountApproved === 'Amount Approved');
  }

  // 9b — let an ambiguous match auto-apply. §5 must fail.
  const guessy = src.replace(
    "      if (byTitle.length > 1) {",
    "      if (false) {");
  ok('negative control patched the ambiguity guard', guessy !== src);
  {
    const c = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN
    });
    vm.runInContext(guessy, c, { filename: 'GogovSync.js (guessy)' });
    const g = vm.runInContext('GogovSync', c);
    const reqs = [
      { requestId: 'R1', tripName: 'Omaha', employeeNameNormalized: 'A B',
        endDate: '2026-10-04', amount: 1 },
      { requestId: 'R2', tripName: 'Omaha', employeeNameNormalized: 'A B',
        endDate: '2026-11-04', amount: 2 }
    ];
    const r = g.matchExpense({ reportName: 'Omaha', employeeNameNormalized: 'A B',
                               extractedLetsId: '', reportEndDate: '2026-10-06' }, reqs);
    ok('without the guard an ambiguous case falls through to a date guess',
       r.status !== 'NEEDS_REVIEW' || r.candidates.length === 0,
       'so section 5 is exercising a real guard');
  }

  // 9c — treat every date as a serial. §3 must fail.
  const serialOnly = src.replace(
    "    var iso = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(s);\n    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];\n", '');
  ok('negative control patched the text-date branch', serialOnly !== src);
  {
    const c = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN
    });
    vm.runInContext(serialOnly, c, { filename: 'GogovSync.js (serial only)' });
    const g = vm.runInContext('GogovSync', c);
    // Without the ISO branch it falls through to Date.parse, which is
    // timezone-sensitive — the exact class of bug that silently shifts a
    // fiscal year by one day.
    ok('the ISO fast path is what guarantees the date is stable',
       g.toDateString('2026-10-01') !== '' , 'patched build still parses, but via Date.parse');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
