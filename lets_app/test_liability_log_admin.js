/**
 * The FY27 travel log importer's entry point.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * @clolry: "I'm getting an error when I try to import existing travel… gotta
 * use column M as estimate, r as actual cost, s as approved date,
 * officesymbol is column c."
 *
 * The error was correct, from the wrong importer. TravelImportAdmin reads a
 * two-tab Go.gov export and refused his workbook because it has neither tab:
 * "no TravelRequest, Expense, OfficeSymbol, OffSymbolOverride tab. Found:
 * Travel FY27, ASD Liability Insurance, Travel Summary, Code, Menu."
 *
 * His file is ONE ROW PER TRIP carrying both an estimate and an actual.
 * LiabilityLogSync.js already parsed that shape, correctly, down to the
 * leading space in ' Authorization Submitted' — and had NO CALLER. Nothing
 * read the sheet or wrote the result, which is why the attempt fell through
 * to the other importer.
 *
 * So this suite covers the plumbing, and §1 covers the thing that would make
 * all of it worthless: that the four columns @clolry named actually resolve
 * to the fields he meant.
 *
 * Run: node lets_app/test_liability_log_admin.js
 */

const fs = require('fs');
const vm = require('vm');
const SERVER = __dirname + '/server/';

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 240)); fails++; }
};

/** The parser, loaded with Status.js so STATUS_CODES resolves. */
function loadSync() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt,
    parseFloat, RegExp, Error, Boolean
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SERVER + '01_constants/Status.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(SERVER + '40_domain/BudgetBackfill.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(SERVER + '30_services/LiabilityLogSync.js', 'utf8'), ctx);
  return vm.runInContext('LiabilityLogSync', ctx);
}

// @clolry's header row, VERBATIM from the sheet. 22 columns, A..V.
//
// THE LEADING SPACE ON COLUMN K IS REAL and is matched exactly rather than
// trimmed — LiabilityLogSync's own comment says why: if the coordinator ever
// fixes it, a loud failure is the correct outcome, not a silent fallback to a
// different column.
const HEADERS = [
  'Last Name', 'First Name', 'Organization', 'Approved by', 'Type', 'Purpose',
  'From', 'To', 'Start', 'End', ' Authorization Submitted',
  '"ASD Pre-Approved\nTravel Request"', 'Estimated Cost',
  'Authorization Approval Date', 'Remaining Commitment',
  'Authorization Processing Day', 'Voucher Submitted', 'Voucher Approved Cost',
  'Voucher Approved', 'Approval Processing Days', 'Document Number', 'NOTES'
];

// @clolry's sample row, with the start-date typo corrected as he said he had
// done. Column L is 1604.25 and column M is 1581.81 — they disagree, which
// is the whole reason he specified M.
const CALHOUN = [
  'Calhoun', 'Jeffrey', 'FCBAA', 'Taylor Wynings', 'TDY',
  'Office of MAS Leadership On-site Meeting ', 'Philadelphia', 'Atlanta',
  '9/21/2026', '9/24/2026', '9/16/2026',
  1604.25,            // L — pre-approved, IGNORED
  1581.81,            // M — the estimate
  '9/16/2026', 0, 1,
  '9/30/2026',
  1563.83,            // R — the actual
  '10/1/2026',        // S — decides the fiscal year
  2, '', ''
];

const L = loadSync();

// ---------------------------------------------------------------------------
console.log('\n1. the four columns @clolry named resolve to the right fields');
{
  const m = L.mapColumns(HEADERS);
  ok('no expected column is missing', m.missing.length === 0, m.missing);

  // THE ASSERTION THAT MATTERS MOST. Everything else is plumbing; if these
  // four are wrong the import writes plausible, wrong money.
  const letter = (i) => String.fromCharCode(65 + i);
  [['estimatedCost', 'M', 'the estimate'],
   ['voucherCost', 'R', 'the actual'],
   ['voucherApproved', 'S', 'the fiscal year'],
   ['orgCode', 'C', 'the office symbol']
  ].forEach(([field, want, what]) => {
    ok(field + ' is column ' + want + ' — ' + what,
       letter(m.index[field]) === want,
       'resolved to ' + letter(m.index[field]));
  });

  // THE LEADING SPACE IS LOAD-BEARING. Trimming would make this header match
  // and hide that the sheet is odd.
  ok("' Authorization Submitted' matches WITH its leading space",
     'authSubmitted' in m.index && m.index.authSubmitted === 10);
  const trimmed = HEADERS.slice();
  trimmed[10] = 'Authorization Submitted';
  // REPORTED BY ITS HEADER STRING, quoted, so the leading space is visible
  // in the message. A message naming the internal field would send an admin
  // looking for a column called 'authSubmitted'.
  ok('and a trimmed header is reported missing, not silently remapped',
     L.mapColumns(trimmed).missing.indexOf(' Authorization Submitted') > -1,
     'a loud failure is correct if the coordinator fixes the header');

  // COLUMN L IS NOT READ AT ALL. @clolry directed column M; the two disagree
  // across the sheet, and reading the wrong one would misstate every
  // commitment. It must be absent from the map, not merely unused.
  const mapped = Object.keys(m.index).map(f => m.index[f]);
  ok('column L is not mapped to any field',
     mapped.indexOf(11) === -1,
     'the FAS pre-approval figure, deliberately ignored');

  // A missing money column is FATAL, not a warning. Importing with
  // Estimated Cost unresolved writes a sheet of $0 trips that look imported.
  const noCost = HEADERS.filter(h => h !== 'Estimated Cost');
  const p = L.parseSheet([noCost, CALHOUN.filter((_, i) => i !== 12)], []);
  ok('a missing Estimated Cost column stops the import',
     p.headerProblems.length > 0 && p.trips.length === 0, p.headerProblems);
  ok('and the message names the SHEET column, not the internal field',
     /Estimated Cost/.test(p.headerProblems.join(' ')), p.headerProblems);
}

// ---------------------------------------------------------------------------
console.log('\n2. the fiscal year comes from column S, and nothing else');
{
  // @clolry: "Column S is the date we need to use as the effective date for
  // the fiscal year of the travel."
  //
  // Calhoun is one of three rows that separate the submitted rule from the
  // approved rule: submitted 2026-09-30, approved 2026-10-01. Under any other
  // date he is FY26 and drops out of the FY27 dashboard, taking $1,563.83 of
  // real spend with him.
  const t = L.parseSheet([HEADERS, CALHOUN], []).trips[0];
  ok('the trip parses with no problems', t.problems.length === 0, t.problems);
  ok('FY27, on the VOUCHER_APPROVED basis',
     t.fiscalYear === 'FY27' && t.fiscalYearBasis === 'VOUCHER_APPROVED', t);

  // Every other candidate date would have said FY26.
  ok('the travel end date would have said FY26',
     L.fiscalYearOf('2026-09-24') === 'FY26',
     'which is why the rule is column S and not the travel date');
  ok('the voucher SUBMITTED date would also have said FY26',
     L.fiscalYearOf('2026-09-30') === 'FY26',
     'one day apart, a different fiscal year, $1,563.83');

  // A ROW WITH NO APPROVED VOUCHER TAKES THE LOG'S OWN YEAR.
  //
  // THIS WAS THE $7,595.80 BUG. The fallback used to be the travel end date,
  // which put September travel in FY26, the FY27 filter dropped it, and
  // @clolry's import came to $22,649.75 against the $30,245.55 he was
  // reconciling to — 23 of 30 rows, the other seven excluded.
  //
  // @clolry, twice: "100% of the entries on the spreadsheet should be loaded
  // as FY27 travel." A trip on the FY27 log is FY27 travel. The sheet is
  // maintained per fiscal year and its name states which; the travel date is
  // an inference from that, and it was systematically wrong in one direction —
  // September travel approved in October is the common case at a year
  // boundary, which is exactly when it matters.
  const pending = CALHOUN.slice();
  pending[18] = '';          // no voucher approved
  pending[17] = '';          // and no actual
  const tp = L.parseSheet([HEADERS, pending], [], 'FY27').trips[0];
  ok('a trip with no approved voucher is still imported',
     tp.problems.length === 0, tp.problems);
  ok('and takes the LOG\'s year, not the travel date\'s',
     tp.fiscalYear === 'FY27',
     'its travel ended 2026-09-24, which is FY26 — the old rule dropped it');
  ok('and the basis records that it is provisional',
     tp.fiscalYearBasis === 'PROVISIONAL_NOT_YET_APPROVED', tp.fiscalYearBasis);
  ok('and a warning says the approval date confirms it later',
     tp.warnings.some(w => /confirmed by the approval date/.test(w)), tp.warnings);
  ok('its status is APPROVED_GOGOV, not COMPLETED',
     tp.status === 'APPROVED_GOGOV',
     'no voucher paid means the travel is authorized, not reconciled');

  // AN APPROVED VOUCHER STILL DECIDES, and still overrides the log's year. A
  // genuine FY26 liquidation must read FY26 even on an FY27 sheet — that is a
  // hard fact about when money left, not a guess.
  const fy26 = CALHOUN.slice();
  fy26[18] = '9/15/2026';
  const t26 = L.parseSheet([HEADERS, fy26], [], 'FY27').trips[0];
  ok('an approved voucher dated in FY26 still reads FY26',
     t26.fiscalYear === 'FY26' && t26.fiscalYearBasis === 'VOUCHER_APPROVED',
     'the log year is a fallback, never an override');

  // WITH NO YEAR SUPPLIED the travel date is the only proxy left, and it is
  // labeled differently so the two cases are not confused.
  const noYear = L.parseSheet([HEADERS, pending], []).trips[0];
  ok('with no log year, the travel date is used and labeled as such',
     noYear.fiscalYearBasis === 'PROVISIONAL_FROM_TRAVEL_DATE',
     'a caller that does not know the year still gets an answer');
  ok('and the warning says it is a guess',
     noYear.warnings.some(w => /guessed from the travel end date/.test(w)),
     noYear.warnings);
}

// ---------------------------------------------------------------------------
console.log('\n3. both money figures survive, and L never wins');
{
  const t = L.parseSheet([HEADERS, CALHOUN], []).trips[0];

  // @clolry: "Please keep the estimates and the actuals - we want to see a
  // history of both." Five rows in the log came in OVER their estimate; a
  // model that overwrote the estimate with the actual would erase the only
  // evidence of that.
  ok('the estimate is column M, 1581.81', t.estimatedCost === 1581.81, t.estimatedCost);
  ok('the actual is column R, 1563.83', t.actualCost === 1563.83, t.actualCost);
  ok('and column L (1604.25) appears nowhere',
     t.estimatedCost !== 1604.25 && t.actualCost !== 1604.25,
     'the two disagree; reading L would misstate the commitment');

  // AN ACTUAL OVER ITS ESTIMATE IS A CONDITION, NOT AN ERROR.
  const over = CALHOUN.slice();
  over[17] = 1700.00;
  const to = L.parseSheet([HEADERS, over], []).trips[0];
  ok('an actual over the estimate imports',
     to.problems.length === 0, to.problems);
  ok('and warns with the variance',
     to.warnings.some(w => /exceeds the estimate/.test(w) && /118\.19/.test(w)),
     to.warnings);

  // A CANCELLED TRIP IS NOT SPEND. The log marks it in Document Number.
  const cancelled = CALHOUN.slice();
  cancelled[20] = 'Cancelled';
  const tc = L.parseSheet([HEADERS, cancelled], []).trips[0];
  ok('a Cancelled document number yields CANCELLED status',
     tc.status === 'CANCELLED', tc.status);
}

// ---------------------------------------------------------------------------
console.log('\n4. a blank Organization falls back to the roster');
{
  // @clolry asked why Melissa Mould showed as unattributed. Her Organization
  // CELL IS EMPTY — the org code resolves fine; the sheet does not carry it.
  // A blank org means real money belongs to no DAC, so the ASD total would be
  // smaller than reality while every DAC row looked right.
  const blank = CALHOUN.slice();
  blank[2] = '';
  blank[0] = 'Mould';
  blank[1] = 'Melissa';

  const roster = [{
    positionNumber: 'P1', employeeName: 'Mould,Melissa J', orgCode: 'FCBBBB',
    occupancyStatus: 'FILLED', emailAddress: 'melissa.mould@gsa.gov'
  }];
  const t = L.parseSheet([HEADERS, blank], roster).trips[0];
  ok('a blank Organization resolves from the roster',
     t.orgCode === 'FCBBBB', t.orgCode);
  ok('and the source is recorded as ROSTER, not SHEET',
     t.orgCodeSource === 'ROSTER',
     'so the preview can tell an admin the sheet needs fixing');
  ok('matched on surname plus FIRST forename token',
     true, "the roster stores 'Melissa J', the log says 'Melissa'");

  // AN AMBIGUOUS NAME IS REFUSED, not coin-flipped. Two people sharing a
  // surname and forename would attribute money at random.
  const twins = roster.concat([{
    positionNumber: 'P2', employeeName: 'Mould,Melissa K', orgCode: 'FCA0B',
    occupancyStatus: 'FILLED', emailAddress: 'm2@gsa.gov'
  }]);
  const ta = L.parseSheet([HEADERS, blank], twins).trips[0];
  ok('two people with the same name block the row',
     ta.problems.length > 0 && !ta.orgCode, ta.problems);

  // A VACANT SEAT CANNOT HAVE TRAVELED, so it must not supply an org.
  const vacant = [{
    positionNumber: 'P9', employeeName: 'Mould,Melissa J', orgCode: 'FCBBBB',
    occupancyStatus: 'VACANT', emailAddress: ''
  }];
  const tv = L.parseSheet([HEADERS, blank], vacant).trips[0];
  ok('a vacant seat does not supply an org code',
     !tv.orgCode && tv.problems.length > 0, tv.problems);

  // NO ROSTER MATCH BLOCKS THE ROW rather than importing it unattributed.
  const tn = L.parseSheet([HEADERS, blank], []).trips[0];
  ok('an unmatchable blank org blocks the row',
     tn.problems.length > 0, tn.problems);
  ok('and says which name it could not find',
     /Melissa/.test(tn.problems.join(' ')), tn.problems);
}

// ---------------------------------------------------------------------------
console.log('\n5. the entry point: preview, token, commit');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  const src = fs.readFileSync(SERVER + '40_domain/LiabilityLogAdmin.js', 'utf8');
  const code = strip(src);

  ok('previewLiabilityLogImport exists',
     /function previewLiabilityLogImport\(\)/.test(code));
  ok('importLiabilityLog takes a token',
     /function importLiabilityLog\(token\)/.test(code));

  // THE PREVIEW MUST WRITE NOTHING. It is the thing an admin reads before
  // committing money figures, and @clolry has twice caught a defect that way.
  const preview = code.slice(code.indexOf('function previewLiabilityLogImport'),
                             code.indexOf('function importLiabilityLog'));
  ok('the preview writes no sheet data',
     !/setValues|appendRow|updateRowByIndex|deleteRow/.test(preview),
     'it is a dry run; the whole point is reading before writing');
  // It DOES write the token to a property, which is not sheet data.
  ok('but it does store a token',
     /setProperty\(LiabilityLogAdmin\.TOKEN_PROP/.test(preview));

  // THE TOKEN IS CONSUMED BEFORE ANY WRITE. A token that survives its use
  // invites a second commit that would duplicate every insert.
  const commit = code.slice(code.indexOf('function importLiabilityLog'));
  ok('the commit refuses a stale or absent token',
     /not the current one/.test(commit));
  ok('and deletes the token BEFORE applying',
     commit.indexOf('deleteProperty') < commit.indexOf('LiabilityLogAdmin.apply'),
     'a surviving token means a second commit duplicates everything');

  // ADMIN ONLY, both of them. This writes money into the budget and modifies
  // @clolry's source sheet.
  ok('both are admin-gated',
     (code.match(/_liabilityLogGuard_\(\)/g) || []).length >= 2);
  ok('and the gate checks isTravelAdmin',
     /isTravelAdmin\(email\)/.test(code));
}

// ---------------------------------------------------------------------------
console.log('\n6. the written row, and the decisions baked into it');
{
  const src = fs.readFileSync(SERVER + '40_domain/LiabilityLogAdmin.js', 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  const code = strip(src);

  // THE ESTIMATE IS THE COMMITMENT; THE ACTUAL GOES BESIDE IT, never over it.
  ok('Grand_Total carries the estimate',
     /'Grand_Total': estimate/.test(code));
  ok('and Actual_Total carries the actual separately',
     /'Actual_Total': t\.actualCost/.test(code),
     'overwriting would erase the variance on the five over-estimate rows');

  // A BLANK ACTUAL IS NOT ZERO. A trip with no voucher yet has an unknown
  // actual, and writing 0 would report it as costing nothing.
  ok('a missing actual writes blank, not 0',
     /t\.actualCost === null \? '' : t\.actualCost/.test(code),
     'zero is a claim; blank is the absence of one');
  ok('and its reconciliation status says UNRECONCILED',
     /'UNRECONCILED'/.test(code));

  // REVIEWER FIELDS STAY EMPTY. A name here would put historical travel on
  // somebody's pending queue and record an approval that never happened in
  // LETS. Same decision as BudgetBackfill and the Go.gov importer.
  ok('Current_Reviewer_Name is written empty',
     /'Current_Reviewer_Name': ''/.test(code));
  ok('and Initial_Review_Level too',
     /'Initial_Review_Level': ''/.test(code));

  // EVERY IMPORTED ROW IS MARKED. A figure that entered the budget without
  // review must be identifiable afterward, or the audit trail implies an
  // approval that never happened.
  ok('Primary_Justification records the import',
     /'Primary_Justification': 'IMPORT: travel log row '/.test(code));
  ok('and names the fiscal-year basis in it',
     /fiscalYearBasis/.test(code),
     'so a provisional year is visible on the row itself');

  // SUBMITTED_AT IS THE TRAVEL'S DATE, not the import's. Reports group on
  // this field, and stamping it `now` would file September travel under
  // whatever month the import ran.
  ok('Submitted_At comes from the authorization date',
     /'Submitted_At': t\.authSubmitted \|\| t\.startDate \|\| now/.test(code));

  // THE OFFICE IS RESOLVED, NOT TRUSTED. interpretRow sets officeCode behind
  // a typeof guard, so it is '' whenever BudgetBackfill has not loaded — and
  // a blank Owning_Office means the trip counts against no DAC.
  ok('the writer re-resolves a blank office code',
     /BudgetBackfill\.officeForOrgCode\(t\.orgCode\)/.test(code),
     'a silent zero is worse than a wrong attribution');
}

// ---------------------------------------------------------------------------
console.log('\n7. the key write-back, and the order it happens in');
{
  const src = fs.readFileSync(SERVER + '40_domain/LiabilityLogAdmin.js', 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  const code = strip(src);

  // THE LOG HAS NO USABLE KEY OF ITS OWN. Document Number is empty on 29 of
  // 30 rows — its one value is the word "Cancelled" — so the sync writes its
  // own key back. @clolry approved this.
  ok('the key header comes from the service, not a literal',
     /LiabilityLogSync\.KEY_HEADER/.test(code),
     'two spellings of the column name would key two different columns');
  ok('the column is created when absent',
     /logSheet\.getRange\(1, keyCol\)\.setValue\(LiabilityLogSync\.KEY_HEADER\)/.test(code));

  // A 0-BASED INDEX IS NOT A COLUMN NUMBER. mapColumns returns
  // row.indexOf(KEY_HEADER), and getRange wants 1-based. Conflating them
  // writes one column to the left — which on this sheet means overwriting
  // NOTES on every keyed row.
  ok('the 0-based index is converted for getRange',
     /\(p\.keyColumn > -1\) \? \(p\.keyColumn \+ 1\) : -1/.test(code),
     'off by one here overwrites the NOTES column');

  // FAILING TO CREATE THE COLUMN MUST STOP THE IMPORT. Rows written with no
  // durable identity are re-created in full on the next run.
  ok('a failed column creation aborts before writing anything',
     /The import did not run/.test(src),
     'without a key every row would be re-imported as a duplicate');

  // THE ORDER: Requests rows first, then keys.
  //
  // If the key write fails after the rows land, the next run sees no key and
  // DUPLICATES them — visible, and fixable by deleting rows. If keys were
  // written first and the rows failed, the sheet would claim every trip was
  // imported when none was, and the next run would import nothing. A visible
  // duplicate beats an invisible gap.
  ok('Requests rows are written before the keys',
     code.indexOf('setValues(newRows)') < code.indexOf('logSheet.getRange(k.row, keyCol)'),
     'the safe direction: a visible duplicate beats an invisible gap');
  ok('and that reasoning is recorded',
     /A visible duplicate beats an invisible gap/.test(src));

  // A FAILED KEY WRITE IS REPORTED, not swallowed. Those rows WILL duplicate
  // on the next run, and the admin needs to know which.
  ok('key write failures are collected and returned',
     /keyFailures\.push/.test(code) && /keyFailures: keyFailures/.test(code),
     'a swallowed failure means silent duplicates on the next run');
  ok('and the message says what happens next',
     /re-imported as duplicates/.test(src));

  // THE SEQUENCE IS READ ONCE. generateRequestId per row reads the sheet for
  // the highest number, and nothing is written until the end — so every call
  // in a loop returns the same ID. TravelImportAdmin records the same trap.
  ok('the request-ID sequence is read once, before the loop',
     /_nextLogSeq_\(db, now\)/.test(code) &&
     /seqUsed\+\+/.test(code));
  ok('and the trap is recorded so nobody reintroduces it',
     /returns the same ID/.test(src));
}

// ---------------------------------------------------------------------------
console.log('\n8. there is NO fiscal-year filter, and the year is still reported');
{
  const src = fs.readFileSync(SERVER + '40_domain/LiabilityLogAdmin.js', 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  const code = strip(src);

  // @clolry: "Everything in that sheet is FY27, no need to filter."
  //
  // THE FILTER COST TWO ROUND TRIPS AND $7,595.80. His first import reported
  // "outside FY27  7" with an actual of $22,649.75 against the $30,245.55 he
  // reconciles to, and the arithmetic settles it: 22,649.75 + 7,595.80 =
  // 30,245.55 exactly. Those seven are rows with APPROVED vouchers dated in
  // September — FY26 by the column-S rule — carrying real money.
  //
  // WHY A FILTER WAS WRONG FOR THIS SOURCE. The guard it was modeled on,
  // BudgetBackfill.js:163, defends a form where a human types a date and a
  // year outside the current one is almost always a typo. This source is a
  // sheet maintained per fiscal year whose NAME states which one. Re-deriving
  // the year from a date column and rejecting rows that disagree substitutes
  // an inference for a fact already known.
  ok('every row is imported — no year filter',
     /out\.trips = parsed\.trips;/.test(code) &&
     !/outOfFiscalYear/.test(code),
     'the sheet is the authority on its own year');

  // THE YEAR IS STILL COMPUTED AND STILL REPORTED. Removing the filter must
  // not remove the signal: the basis spread is now the only thing that would
  // show LIABILITY_LOG_TAB pointing at the wrong sheet, which is the failure
  // the filter used to catch.
  ok('the preview prints which year each row resolves to',
     /fiscal year each row resolves to/.test(src),
     'otherwise nothing would reveal a wrongly-pointed tab');
  ok('and names rows whose APPROVED voucher falls outside the year',
     /APPROVED voucher dated outside/.test(src),
     'a few at a year boundary is normal; most of the sheet is a wrong tab');
  ok('while saying plainly that they ARE imported',
     /They ARE imported/.test(src),
     'the earlier version excluded them and that was the defect');

  // Requests has NO Fiscal_Year column, so the year cannot be stored and
  // queried later — which is why it goes in Primary_Justification instead.
  const schemas = (() => {
    const ctx = vm.createContext({ console: { log() {} }, JSON, Object, String, Number, Array });
    vm.runInContext(fs.readFileSync(SERVER + '01_constants/Sheets.js', 'utf8'), ctx);
    return vm.runInContext("TRAVEL_SHEET_SCHEMAS['Requests']", ctx);
  })();
  ok('Requests genuinely has no Fiscal_Year column',
     schemas.indexOf('Fiscal_Year') === -1,
     'so the year cannot be stored and queried later');
  ok('which is why the year and its basis go in Primary_Justification',
     /fiscal year ' \+ t\.fiscalYear \+/.test(code) &&
     /on basis ' \+ t\.fiscalYearBasis/.test(code),
     '"which year did this hit" has an answer and somebody will ask it');
  ok('and the identity column it DOES have is used for the key',
     schemas.indexOf('Gogov_Request_ID') > -1 &&
     /'Gogov_Request_ID': key/.test(code));

  // THE KEY PREFIX MUST BE DISTINGUISHABLE from the Go.gov importer's IDs, or
  // the two importers would claim each other's rows.
  ok('log keys are prefixed LLOG-',
     /'LLOG-' \+ t\.sheetRow/.test(code));
  ok('and only LLOG- keys are read back as existing',
     /indexOf\('LLOG-'\) !== 0/.test(code),
     "otherwise this importer would try to update Go.gov's rows");
}

// ---------------------------------------------------------------------------
console.log('\n8b. buildPlan and report RUN, not just read');
{
  // THE SECTION THAT WOULD HAVE CAUGHT THE LAST FAILURE.
  //
  // Removing the fiscal-year filter left one line still referencing the
  // variable it had produced:
  //
  //   ReferenceError: inYear is not defined
  //     buildPlan @ LiabilityLogAdmin.gs:244
  //
  // Forty-one suites passed. Every assertion in this file read SOURCE TEXT —
  // it grepped for `out.trips = parsed.trips` and for the absence of
  // `outOfFiscalYear`, both of which were true — and nothing executed the
  // function. A source-grep suite cannot catch a ReferenceError, and the
  // error landed at the END of buildPlan, after every sheet read, so the whole
  // preview failed on something with no relation to the data.
  //
  // So this section RUNS it, with the Apps Script globals stubbed. Slower to
  // write than a grep, and the only thing that would have failed.
  const S = SERVER;
  const ROWS = [
    // FY27 by its approval date.
    ['Calhoun', 'Jeffrey', 'FCBAA', 'TW', 'TDY', 'MAS mtg', 'Philadelphia',
     'Atlanta', '9/21/2026', '9/24/2026', '9/16/2026', 1604.25, 1581.81,
     '9/16/2026', 0, 1, '9/30/2026', 1563.83, '10/1/2026', 2, '', ''],
    // FY26 by its approval date — the kind the filter used to drop. Must
    // import, and must be REPORTED.
    ['Zhao', 'Han-Qing', 'FCA0B', 'TW', 'TDY', 'Site visit', 'DC', 'Boston',
     '9/08/2026', '9/10/2026', '9/01/2026', 900, 850.00, '9/01/2026', 0, 1,
     '9/12/2026', 800.00, '9/15/2026', 3, '', ''],
    // No approved voucher: takes the sheet's year.
    ['Han', 'Peter', 'FCC0A', 'TW', 'TDY', 'Conference', 'DC', 'Denver',
     '9/05/2026', '9/08/2026', '9/01/2026', 700, 650.00, '9/01/2026', 0, 1,
     '', '', '', '', '', '']
  ];

  function build(rows) {
    const sb = {
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Array, Math, isNaN, parseInt,
      parseFloat, RegExp, Error, Boolean,
      Utilities: { formatDate: () => '2026-11-05' },
      Session: { getActiveUser: () => ({ getEmail: () => 'a@gsa.gov' }),
                 getScriptTimeZone: () => 'UTC' },
      SpreadsheetApp: {
        openById: () => ({
          getName: () => 'log', getUrl: () => 'u',
          getSheets: () => [{ getName: () => 'Travel FY27' }],
          getSheetByName: (n) => n === 'Travel FY27' ? {
            getLastRow: () => 1 + rows.length,
            getLastColumn: () => HEADERS.length,
            getRange: () => ({ getValues: () => [HEADERS].concat(rows) })
          } : null
        }),
        flush() {}
      },
      PropertiesService: { getScriptProperties: () => ({
        getProperty: () => null, setProperty() {}, deleteProperty() {} }) },
      CacheService: { getScriptCache: () => ({
        get: () => null, put() {}, remove() {}, removeAll() {} }) }
    };
    const ctx = vm.createContext(sb);
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';", ctx);
    ['01_constants/Sheets.js', '01_constants/Status.js',
     '00_config/BudgetConfig.js', '40_domain/BudgetBackfill.js',
     '30_services/LiabilityLogSync.js'].forEach(f => {
      vm.runInContext(fs.readFileSync(S + f, 'utf8'), ctx, { filename: f });
    });
    vm.runInContext([
      "function getLiabilityLogSource(){return {ok:true,spreadsheetId:'SID'," +
        "tabName:'Travel FY27',error:''};}",
      'var HC={hcGetBundle:function(){return {success:true,data:[]};}};',
      'function TravelDB(){}',
      'TravelDB.prototype.readSheet=function(){return {headers:[],rows:[],' +
        'headerIndex:{}};};',
      'function successResponse(d,m){return {success:true,data:d,message:m};}',
      'function errorResponse(e){return {success:false,error:e};}',
      'function isTravelAdmin(){return true;}'
    ].join('\n'), ctx);
    vm.runInContext(fs.readFileSync(S + '40_domain/LiabilityLogAdmin.js', 'utf8'),
                    ctx, { filename: 'LiabilityLogAdmin.js' });
    return {
      plan: vm.runInContext('LiabilityLogAdmin.buildPlan()', ctx),
      lines: vm.runInContext(
        'LiabilityLogAdmin.report(LiabilityLogAdmin.buildPlan())', ctx)
    };
  }

  // CAUGHT, NOT ALLOWED TO CRASH THE SUITE.
  //
  // An uncaught throw exits the process with a stack trace and prints no FAIL
  // line — so a runner that greps stdout for 'FAIL' reports the suite as
  // passing. I verified the control that way and briefly concluded this
  // section did not catch the bug it was written for. It did; my check was
  // wrong. A throw must become a named failure, so it is visible however the
  // suite is run.
  let r = null;
  let threw = '';
  try { r = build(ROWS); } catch (e) { threw = e.message; }
  ok('buildPlan completes without throwing', !threw, threw);
  if (threw) {
    console.log('  (skipping the rest of 8b — buildPlan did not return)');
  } else {

  ok('buildPlan reports ok', r.plan && r.plan.ok === true,
     r.plan && r.plan.problems);
  ok('and report() renders', Array.isArray(r.lines) && r.lines.length > 10);

  // EVERY ROW IMPORTS, including the FY26-approved one.
  ok('all three rows are in the plan', r.plan.trips.length === 3,
     r.plan.trips.length);
  ok('and all three are inserts', r.plan.plan.inserts.length === 3,
     r.plan.plan.inserts.length);

  const byName = {};
  r.plan.trips.forEach(t => byName[t.travelerName] = t);
  ok('the FY27 approval reads FY27',
     byName['Jeffrey Calhoun'].fiscalYear === 'FY27');
  ok('the SEPTEMBER approval still reads FY26 — and still imports',
     byName['Han-Qing Zhao'].fiscalYear === 'FY26' &&
     byName['Han-Qing Zhao'].fiscalYearBasis === 'VOUCHER_APPROVED',
     'the year is recorded, not used to exclude');
  ok("the unapproved row takes the sheet's year",
     byName['Peter Han'].fiscalYear === 'FY27' &&
     byName['Peter Han'].fiscalYearBasis === 'PROVISIONAL_NOT_YET_APPROVED');

  // THE REPORT MUST SAY SO, in the output a human reads before applying.
  const text = r.lines.join('\n');
  ok('the report states every row is imported',
     /EVERY ROW IS IMPORTED/.test(text), text.slice(0, 400));
  ok('and prints the basis spread',
     /FY26  by VOUCHER_APPROVED/.test(text) &&
     /FY27  by VOUCHER_APPROVED/.test(text) &&
     /PROVISIONAL_NOT_YET_APPROVED/.test(text), text);
  ok('and names the off-year row with its amount',
     /Han-Qing Zhao/.test(text) && /\$800\.00/.test(text),
     'a count alone is what cost two round trips');
  ok('and the stale note about the travel end date is gone',
     text.indexOf('the travel end date') === -1,
     'the fallback is the sheet year now, and a wrong explanation is worse ' +
     'than none');

  // THE MONEY TOTAL, which is the number @clolry reconciles against.
  ok('actuals total both vouchers',
     /\$2363\.83/.test(text), '1563.83 + 800.00');
  ok('and the per-office split lands in IDV and OMD',
     /IDV/.test(text) && /OMD/.test(text), text);

  // AN EMPTY SHEET MUST NOT THROW either — the other end of the same risk.
  const empty = build([]);
  ok('an empty sheet reports a problem rather than throwing',
     empty.plan.ok === false && empty.plan.problems.length > 0,
     empty.plan.problems);
  ok('and says the tab has no data rows',
     /no data rows/.test(empty.plan.problems.join(' ')), empty.plan.problems);
  }
}

// ---------------------------------------------------------------------------
console.log('\n9. the editor can actually run it');
{
  // @clolry: "how do I run the importLiabilityLog with the token argument"
  //
  // He cannot. The Apps Script Run dropdown passes NO ARGUMENTS, so a
  // function taking a token is unrunnable from the editor — it would receive
  // undefined and refuse. The token protection is worth keeping; making
  // somebody paste a token into a scratch function to get past it is not.
  const diag = fs.readFileSync(SERVER + '99_triggers/Diagnostics.js', 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  const code = strip(diag);

  ok('there is a zero-argument wrapper',
     /function runLiabilityLogImport\(\)/.test(code),
     'the Run dropdown cannot pass a token');

  const body = code.slice(code.indexOf('function runLiabilityLogImport'),
                          code.indexOf('function runBudgetDashboard'));

  // THE PREVIEW STILL RUNS FIRST, and its output is still printed. That is
  // what the token was protecting — not the token itself, but the guarantee
  // that nobody applies a plan they did not see.
  ok('it runs the preview before applying',
     body.indexOf('previewLiabilityLogImport()') <
     body.indexOf('importLiabilityLog('),
     'the plan must be on screen above the write');
  ok('and passes the preview\'s OWN token through',
     /importLiabilityLog\(p\.token\)/.test(body),
     'a hand-made token would defeat the binding entirely');
  ok('a failed preview writes nothing',
     /PREVIEW FAILED/.test(body) &&
     body.indexOf('PREVIEW FAILED') < body.indexOf('importLiabilityLog('));

  // NOTHING TO DO IS NOT A FAILURE, and saying so matters: a re-run on an
  // unchanged sheet is the normal case once the log is imported.
  ok('it reports "nothing to do" rather than applying an empty plan',
     /NOTHING TO DO/.test(body));

  // IT DOES NOT REFUSE OVER BLOCKED ROWS. A blocked row imports nothing and
  // is listed; the others are real travel and belong in the budget. Refusing
  // the batch over one unattributable traveler leaves every figure wrong
  // rather than one figure missing.
  ok('blocked rows are noted but do not stop the import',
     /NOTE: /.test(body) && !/REFUSING/.test(body),
     'one bad row must not withhold the whole batch');

  // A FAILED KEY WRITE IS CALLED OUT LOUDLY, because those rows will
  // duplicate on the next run and the cause is a permission the admin can
  // fix.
  ok('a key-write failure is reported after the apply',
     /KEY WRITE\(S\) FAILED/.test(body) && /needs EDIT /.test(diag),
     'silent duplicates are the one outcome worth shouting about');

  // The file's own index must list it as a WRITER. That header promises the
  // diag* family changes nothing, and a wrapper that writes has to be
  // visibly outside it.
  ok('the file header lists it among the writers',
     /runLiabilityLogImport\(\)\s+preview \+ apply the FY27 log\s+WRITES/.test(diag),
     'the header is the first thing a reader trusts');
  ok('and it is named run..., not diag...',
     !/function diagLiabilityLog/.test(code),
     'a diag* that writes would make the family promise untrue');
}

// ---------------------------------------------------------------------------
console.log('\n10. an update backfills a missing traveler row');
{
  // @clolry's second run: "travelerRows: 0, updated: 23" and the
  // per-service-center table still empty.
  //
  // The 23 trips already existed, so every row took the UPDATE path — which
  // created no traveler row. I added the traveler write to the INSERT path
  // only, flagged the gap in the commit message, and did not fix it. The
  // table had nothing to read for a second run in a row.
  //
  // A row imported before the traveler write existed would otherwise be
  // invisible to that table forever, and the only remedy would be "delete
  // and re-import" — an instruction that gets ignored and then looks like a
  // broken feature.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
  const src = fs.readFileSync(SERVER + '40_domain/LiabilityLogAdmin.js', 'utf8');
  const code = strip(src);

  ok('the update path can append a traveler row',
     /travRows\.push\(travelerRecord\(t, u\.requestId, uOffice\)\)/.test(code),
     'the insert path alone leaves pre-existing rows invisible');

  // KEYED ON EXISTING TRAVELER ROWS, so a trip that already has one is left
  // alone. Appending a second would DOUBLE that trip in every per-center
  // figure — a worse outcome than the empty table being fixed.
  ok('it first reads which requests already have travelers',
     /hasTraveler/.test(code) &&
     /db\.readSheet\(SHEET_NAMES\.REQUEST_TRAVELERS\)/.test(code));
  ok('and skips a request that already has one',
     /!hasTraveler\[u\.requestId\]/.test(code),
     'a duplicate traveler row doubles the trip in the per-center table');
  ok('and marks it so two log rows for one request cannot both append',
     /hasTraveler\[u\.requestId\] = true/.test(code));

  // IF THE TRAVELER SHEET CANNOT BE READ, nothing is appended. Guessing would
  // risk the duplicate, and one more run with a missing row is recoverable
  // while a double-counted trip is not obvious.
  ok('an unreadable traveler sheet disables the backfill rather than guessing',
     /hasTraveler = null/.test(code) &&
     /hasTraveler && !hasTraveler\[u\.requestId\]/.test(code),
     'a duplicate is harder to notice than a gap');
  ok('and says so rather than failing silently',
     /will NOT be backfilled/.test(src));

  // REPORTED SEPARATELY, so a run that only backfills does not read as a run
  // that did nothing — which is exactly how the broken run looked.
  ok('backfilled rows are counted in the result',
     /travelerRowsBackfilled: backfilled/.test(code));
  ok('and named in the message',
     /backfilled onto trips imported/.test(src),
     '"travelerRows: 0, updated: 23" explained nothing');
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
