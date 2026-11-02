/**
 * Automated Verification Script for the HC data layer (20_data/HCData.js).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * HCData.js reconstructs the interface of the inherited HC Apps Script
 * Library, which held another workgroup's employees and is no longer
 * reachable. 28 call sites across 9 server files depend on it, and every one
 * of them wraps the call in a try/catch that logs a warning and CONTINUES.
 *
 * That means a regression here does not throw. It degrades: the staffing
 * autocomplete empties, approval routing finds no Division Director, and two
 * of three site-gate allow-paths silently deny access. The only error a user
 * would see is "no results" — which is why these assertions exist.
 *
 * The highest-value test in this file is section 3. docs/GAP_CONSOLIDATION_PASS6.md
 * VT-03 predicted the exact failure: "the site gate compares supervisoryStatus
 * === '2' as a string; if HC emits a number, two of three allow-paths are
 * already dead and nobody would know."
 *
 * HOW IT LOADS THE MODULE
 * -----------------------
 * HCData.js is Apps Script, not CommonJS. It is evaluated in a vm context with
 * stubbed GAS globals, the same technique test_budget_config_global.js uses —
 * `require()` would not exercise the `var HC = (function(){...})()` global
 * assignment that Apps Script actually depends on.
 *
 * Run: node lets_app/test_hc_data.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('--- Starting HC Data Layer Test Suite ---');

const SERVER = path.join(__dirname, 'server');

// ---------------------------------------------------------------------------
// Harness: load HCData.js the way Apps Script does
// ---------------------------------------------------------------------------

/**
 * Builds a fresh sandbox with fake HC_Positions / HC_Orgs tabs.
 *
 * SpreadsheetApp and CacheService are stubbed rather than mocked away, so the
 * read path, the normalization and the cache path all execute for real. The
 * cache stub is a plain object, which also lets the tests assert invalidation.
 */
function loadHC(positionRows, orgRows, options) {
  options = options || {};
  const cacheStore = {};
  let sheetReads = 0;

  function makeSheet(headers, rows) {
    const values = [headers].concat(rows);
    return {
      getLastRow: () => values.length,
      getLastColumn: () => headers.length,
      getRange: (r1, c1, nr, nc) => ({
        getValues: () => {
          sheetReads++;
          return values.slice(r1 - 1, r1 - 1 + nr).map(row => row.slice(c1 - 1, c1 - 1 + nc));
        }
      })
    };
  }

  const sandbox = {
    console: options.quiet ? { log() {}, warn() {}, error() {} } : console,
    JSON,
    Date,
    Object,
    String,
    Number,
    Boolean,
    Array,
    RegExp,
    Error,
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name) => {
          if (name === 'HC_Positions') return options.noPositionsTab ? null : makeSheet(POS_HEADERS, positionRows);
          if (name === 'HC_Orgs') return options.noOrgsTab ? null : makeSheet(ORG_HEADERS, orgRows);
          return null;
        }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cacheStore ? cacheStore[k] : null),
        put: (k, v) => { cacheStore[k] = v; },
        removeAll: (keys) => { keys.forEach(k => delete cacheStore[k]); }
      })
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(
    `var TRAVEL_DB_SPREADSHEET_ID = ${options.noDbId ? 'null' : "'FAKE_SHEET_ID'"};`,
    ctx
  );
  for (const rel of [
    ['01_constants', 'Cache.js'],
    ['01_constants', 'Sheets.js'],
    ['20_data', 'HCData.js']
  ]) {
    const file = path.join(SERVER, rel[0], rel[1]);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel.join('/') });
  }

  return {
    HC: vm.runInContext('HC', ctx),
    cacheStore,
    sheetReadCount: () => sheetReads,
    isGlobalProperty: () => vm.runInContext('typeof this.HC !== "undefined"', ctx)
  };
}

// Headers must match TRAVEL_SHEET_SCHEMAS exactly. Section 1 asserts that.
const POS_HEADERS = [
  'Position_Number', 'Reports_To_Position_Number', 'Employee_ID', 'Employee_Name',
  'Email_Address', 'Org_Code', 'Office_Title', 'Grade', 'Supervisory_Status',
  'Occupancy_Status', 'LCAT', 'Location_Code', 'Duty_Station_Address',
  'Duty_Station_City', 'Duty_Station_State', 'Is_Active',
  'Created_By', 'Created_At', 'Updated_By', 'Updated_At'
];
const ORG_HEADERS = [
  'Org_Code', 'Office_Code', 'Business_Unit', 'Sector', 'Division', 'Status',
  'Former_Org_Codes', 'Is_Active', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At'
];

function posRow(o) {
  return POS_HEADERS.map(h => (h in o ? o[h] : ''));
}
function orgRow(o) {
  return ORG_HEADERS.map(h => (h in o ? o[h] : ''));
}

const ORGS = [
  orgRow({ Org_Code: 'FC',  Office_Code: 'FO',  Business_Unit: 'Front Office', Sector: 'FAS', Status: 'Active' }),
  orgRow({ Org_Code: 'FCA', Office_Code: 'OMD', Business_Unit: 'OMD',          Sector: 'FAS', Status: 'Active',
           Former_Org_Codes: 'FCX, FCY' }),
  orgRow({ Org_Code: 'FCB', Office_Code: 'IDV', Business_Unit: 'IDV',          Sector: 'FAS', Status: 'Active' })
];

// ---------------------------------------------------------------------------
// 1. The schema and the reader agree
// ---------------------------------------------------------------------------
console.log('\n1. Schema / reader agreement:');

{
  const ctx = vm.createContext({ console: { log() {}, warn() {} } });
  vm.runInContext(fs.readFileSync(path.join(SERVER, '01_constants', 'Sheets.js'), 'utf8'), ctx);
  const names = vm.runInContext('SHEET_NAMES', ctx);
  const schemas = vm.runInContext('TRAVEL_SHEET_SCHEMAS', ctx);

  assert.strictEqual(names.HC_POSITIONS, 'HC_Positions');
  assert.strictEqual(names.HC_ORGS, 'HC_Orgs');
  console.log('   SHEET_NAMES registers both HC tabs');

  // If a header is renamed in the schema but not in HCData.js's reader, every
  // field silently becomes ''. Pinning the test headers to the schema means
  // such a rename fails here instead of in production.
  //
  // Array.from() is required: values built inside a vm context carry that
  // realm's Array.prototype, and deepStrictEqual compares prototypes, so a
  // direct comparison fails even on identical contents.
  assert.deepStrictEqual(Array.from(schemas.HC_Positions), POS_HEADERS,
    'HC_Positions schema drifted from what HCData.js reads. Update both together.');
  assert.deepStrictEqual(Array.from(schemas.HC_Orgs), ORG_HEADERS,
    'HC_Orgs schema drifted from what HCData.js reads. Update both together.');
  console.log('   Both schemas match the column names HCData.js reads');
}

// ---------------------------------------------------------------------------
// 2. HC is a property of the global object
// ---------------------------------------------------------------------------
console.log('\n2. Global binding (the PR #14 failure mode):');

{
  const src = fs.readFileSync(path.join(SERVER, '20_data', 'HCData.js'), 'utf8');
  assert.ok(/^var HC = /m.test(src),
    'REGRESSION: HC is not declared with `var`. A top-level const/let is not a ' +
    'property of the global object in Apps Script V8, so anything reading ' +
    'this.HC or root.HC gets undefined. BudgetConfig.js caused a total outage ' +
    'this exact way (PR #14).');
  console.log('   Declared with `var`');

  const { isGlobalProperty } = loadHC([], ORGS, { quiet: true });
  assert.ok(isGlobalProperty(), 'this.HC is undefined in the shared global realm');
  console.log('   this.HC is reachable as a global-object property');
}

// ---------------------------------------------------------------------------
// 3. Grade and supervisoryStatus survive Sheets numeric coercion
// ---------------------------------------------------------------------------
console.log('\n3. String normalization (VT-03 — the predicted failure):');

{
  const { HC } = loadHC([], ORGS, { quiet: true });

  // Sheets turns a cell containing 07 into the NUMBER 7. Unpadded, String(7)
  // is '7' and every `=== '15'`-style grade comparison fails for GS-01..09.
  assert.strictEqual(HC._grade(7), '07', 'GS-07 must normalize to the string "07"');
  assert.strictEqual(HC._grade('07'), '07');
  assert.strictEqual(HC._grade(15), '15');
  assert.strictEqual(HC._grade('15'), '15');
  console.log('   Numeric 7 -> "07"; 15 -> "15"');

  // Non-numeric grades must pass through. Zero-padding 'SES' would corrupt it.
  assert.strictEqual(HC._grade('SES'), 'SES');
  assert.strictEqual(HC._grade(''), '');
  assert.strictEqual(HC._grade(null), '');
  console.log('   SES / blank pass through unpadded');

  // Access.js:134 does String(p.supervisoryStatus) !== '2'. A numeric 2 would
  // pass that, but normalizing here keeps every consumer on one type.
  const normalized = HC._normalizePosition({
    Position_Number: 12345,
    Supervisory_Status: 2,
    Grade: 15,
    Employee_ID: 98765
  });
  assert.strictEqual(typeof normalized.supervisoryStatus, 'string');
  assert.strictEqual(normalized.supervisoryStatus, '2');
  assert.strictEqual(typeof normalized.positionNumber, 'string');
  assert.strictEqual(typeof normalized.employeeId, 'string');
  console.log('   supervisoryStatus, positionNumber, employeeId are all strings');

  // hcDataCenterService.html:193 and Request.js:137 compare !== 'VACANT' with
  // NO uppercasing, so a lowercase sheet value would read FILLED on the client
  // and VACANT on the server.
  assert.strictEqual(HC._occupancy('vacant'), 'VACANT');
  assert.strictEqual(HC._occupancy('VACANT'), 'VACANT');
  assert.strictEqual(HC._occupancy(''), 'FILLED');
  console.log('   occupancyStatus uppercased; blank defaults to FILLED');
}

// ---------------------------------------------------------------------------
// 4. The bundle matches the shape the 18 inherited call sites expect
// ---------------------------------------------------------------------------
console.log('\n4. hcGetBundle() return contract:');

{
  const rows = [
    posRow({ Position_Number: 'P1', Employee_Name: 'Ada Boss', Email_Address: 'ada@gsa.gov',
             Org_Code: 'FC', Grade: 'SES', Supervisory_Status: 2, Occupancy_Status: 'FILLED' }),
    posRow({ Position_Number: 'P2', Reports_To_Position_Number: 'P1', Employee_Name: 'Dee Director',
             Email_Address: 'dee@gsa.gov', Org_Code: 'FCA', Grade: 15, Supervisory_Status: 2 })
  ];
  const { HC } = loadHC(rows, ORGS, { quiet: true });
  const bundle = HC.hcGetBundle();

  // Request.js:59 and hcDataCenterService.html:127 both check exactly this.
  assert.strictEqual(bundle.success, true);
  assert.ok(Array.isArray(bundle.data));
  assert.strictEqual(bundle.count, 2);
  assert.strictEqual(typeof bundle.lastRefreshed, 'string');
  console.log('   { success, data[], count, lastRefreshed } present');

  // Submission.js:1149 reads p.org.businessUnit; Request.js:99 reads
  // loc.address1. Both would throw on a missing nested object.
  const p = bundle.data[1];
  assert.ok(p.org, 'position.org must exist — Submission.js:1149 dereferences it');
  assert.ok(p.location, 'position.location must exist — Request.js:99 dereferences it');
  assert.strictEqual(p.org.businessUnit, 'OMD', 'org attributes must be joined onto the position');
  console.log('   Nested org / location objects present and joined');
}

// ---------------------------------------------------------------------------
// 5. Division Director resolution, including the vacant-seat rule
// ---------------------------------------------------------------------------
console.log('\n5. Supervisor chain and Division Director:');

{
  const rows = [
    posRow({ Position_Number: 'P1', Employee_Name: 'Ada Boss', Grade: 'SES', Org_Code: 'FC' }),
    posRow({ Position_Number: 'P2', Reports_To_Position_Number: 'P1', Employee_Name: 'Vic Vacant',
             Grade: 15, Occupancy_Status: 'VACANT', Org_Code: 'FCA' }),
    posRow({ Position_Number: 'P3', Reports_To_Position_Number: 'P2', Employee_Name: 'Dee Director',
             Email_Address: 'dee@gsa.gov', Grade: 15, Org_Code: 'FCA' }),
    posRow({ Position_Number: 'P4', Reports_To_Position_Number: 'P3', Employee_Name: 'Stan Staff',
             Grade: 13, Org_Code: 'FCA' })
  ];
  const { HC } = loadHC(rows, ORGS, { quiet: true });

  // Walking up from P4: P3 is the first staffed GS-15. P2 is also GS-15 but
  // VACANT, and an empty seat cannot approve travel — Request.js:137 skips it.
  // Note P2 sits ABOVE P3 here only in the sense of the chain order; the
  // assertion is that the vacant GS-15 is not selected.
  const dd = HC.hcFindDivisionDirector('P4');
  assert.strictEqual(dd.ddName, 'Dee Director');
  assert.strictEqual(dd.ddEmail, 'dee@gsa.gov');
  console.log('   Nearest STAFFED GS-15 selected');

  // Objects returned from the vm context carry that realm's Object.prototype,
  // so deepStrictEqual would fail on prototype identity alone. Compare fields.
  const none = HC.hcFindDivisionDirector('P1');
  assert.strictEqual(none.ddName, '',
    'No DD above the top of the tree must return an empty string, not null');
  assert.strictEqual(none.ddEmail, '');
  console.log('   Top of tree returns empty strings, not null');

  assert.strictEqual(HC.hcWalkSupervisorChain('NOPE', () => true), null);
  console.log('   Unknown position number returns null');
}

// ---------------------------------------------------------------------------
// 6. A supervisor cycle must not hang the request
// ---------------------------------------------------------------------------
console.log('\n6. Cycle protection:');

{
  // A reports to B, B reports to A. Without visited-tracking this is an
  // infinite loop inside a web request, which is a hung page, not an error.
  const rows = [
    posRow({ Position_Number: 'A', Reports_To_Position_Number: 'B', Employee_Name: 'Aa', Grade: 13 }),
    posRow({ Position_Number: 'B', Reports_To_Position_Number: 'A', Employee_Name: 'Bb', Grade: 13 })
  ];
  const { HC } = loadHC(rows, ORGS, { quiet: true });

  const started = Date.now();
  const result = HC.hcWalkSupervisorChain('A', () => false);
  const elapsed = Date.now() - started;

  assert.strictEqual(result, null, 'A cycle must terminate and return null');
  assert.ok(elapsed < 1000, `cycle walk took ${elapsed}ms — suspiciously slow`);
  console.log(`   2-node cycle terminates (${elapsed}ms), returns null`);

  // Self-reference is the other data-entry mistake that produces a cycle.
  const selfRef = loadHC(
    [posRow({ Position_Number: 'S', Reports_To_Position_Number: 'S', Employee_Name: 'Sam', Grade: 13 })],
    ORGS, { quiet: true });
  assert.strictEqual(selfRef.HC.hcWalkSupervisorChain('S', () => false), null);
  console.log('   Self-reference terminates');
}

// ---------------------------------------------------------------------------
// 7. Retired org codes resolve to their successor
// ---------------------------------------------------------------------------
console.log('\n7. Former org code mapping:');

{
  // OrgLookup.js:52 maps retired codes onto current values so historical
  // requests still resolve. FCX and FCY are listed as former codes of FCA.
  const rows = [
    posRow({ Position_Number: 'P1', Employee_Name: 'Old Code', Org_Code: 'FCX', Grade: 13 })
  ];
  const { HC } = loadHC(rows, ORGS, { quiet: true });
  const p = HC.hcGetBundle().data[0];
  assert.strictEqual(p.org.businessUnit, 'OMD',
    'A position on retired code FCX must inherit FCA\'s business unit');
  console.log('   Position on retired code FCX inherits OMD from FCA');

  const orgs = HC.hcGetOrgHierarchy();
  // OrgLookup.js iterates this with a for loop and indexes .orgCode, so it
  // must be a bare ARRAY — not the { success, data } envelope hcGetBundle uses.
  assert.ok(Array.isArray(orgs), 'hcGetOrgHierarchy must return a bare array');
  const fca = orgs.find(o => o.orgCode === 'FCA');
  assert.deepStrictEqual(Array.from(fca.formerOrgCodes), ['FCX', 'FCY'],
    'Former_Org_Codes must split on commas and trim');
  assert.strictEqual(fca.officeCode, 'OMD',
    'Office_Code carries the BudgetConfig.js key alongside the HR org code');
  console.log('   hcGetOrgHierarchy returns a bare array; FCA -> officeCode OMD');
}

// ---------------------------------------------------------------------------
// 7b. Hierarchical sub-org codes
// ---------------------------------------------------------------------------
console.log('\n7b. Sub-org codes resolve to their parent by longest prefix:');

{
  // @clolry: "Our org has hundreds of different codes under FC." The codes are
  // hierarchical — FCA0A sits under FCA under FC — and only the four
  // top-level codes carry a budget office key.
  //
  // The join used to require an EXACT match, so every real code failed:
  // entering FCA0A-0008 produced 'Org_Code "FCA0A" has no matching HC_Orgs
  // row. Business unit and sector will be blank', with no way to fix it from
  // the editor.
  const rows = [
    posRow({ Position_Number: 'FCA0A-0008', Employee_Name: 'Sub Org', Org_Code: 'FCA0A', Grade: 13 }),
    posRow({ Position_Number: 'FCB12-0001', Employee_Name: 'Deeper',  Org_Code: 'FCB12', Grade: 13 }),
    posRow({ Position_Number: 'FC-0001',    Employee_Name: 'Top',     Org_Code: 'FC',    Grade: 15 }),
    posRow({ Position_Number: 'XX99-0001',  Employee_Name: 'Typo',    Org_Code: 'XX99',  Grade: 13 })
  ];
  const { HC } = loadHC(rows, ORGS, { quiet: true });
  const byNum = {};
  HC.hcGetBundle().data.forEach(p => { byNum[p.positionNumber] = p; });

  assert.strictEqual(byNum['FCA0A-0008'].org.businessUnit, 'OMD',
    'FCA0A must resolve to FCA and inherit OMD');
  assert.strictEqual(byNum['FCA0A-0008'].org.resolvedOrgCode, 'FCA',
    'resolvedOrgCode must report the PARENT the position attributed to');
  console.log('   FCA0A -> FCA (OMD)');

  assert.strictEqual(byNum['FCB12-0001'].org.businessUnit, 'IDV',
    'FCB12 must resolve to FCB, not to FC');
  console.log('   FCB12 -> FCB (IDV)');

  // THE CRITICAL CASE. FC is a prefix of every other code, so a first-match
  // or shortest-match rule would attribute all travel to the Front Office.
  assert.strictEqual(byNum['FCA0A-0008'].org.businessUnit !== 'Front Office', true,
    'LONGEST prefix must win — FC is a prefix of FCA0A and must not capture it');
  console.log('   FC does not capture FCA0A (longest prefix wins)');

  // An exact match still wins outright, so adding a specific HC_Orgs row for
  // a sub-org overrides the derivation.
  assert.strictEqual(byNum['FC-0001'].org.businessUnit, 'Front Office',
    'An exact code must still match its own row');
  console.log('   Exact code FC still matches its own row');

  // A code matching no parent is a typo, and must stay blank rather than be
  // silently attributed somewhere wrong.
  assert.strictEqual(byNum['XX99-0001'].org.businessUnit, '',
    'A code matching no known prefix must not be attributed to any org');
  console.log('   Unmatched code XX99 stays blank rather than guessing');

  // An explicit sub-org row must beat the prefix rule.
  const withSub = ORGS.concat([
    orgRow({ Org_Code: 'FCA0A', Office_Code: 'SUB', Business_Unit: 'Sub Unit',
             Sector: 'FAS', Status: 'Active' })
  ]);
  const sub = loadHC(rows, withSub, { quiet: true });
  const subPos = sub.HC.hcGetBundle().data.find(p => p.positionNumber === 'FCA0A-0008');
  assert.strictEqual(subPos.org.businessUnit, 'Sub Unit',
    'An explicit HC_Orgs row for FCA0A must override the FCA derivation');
  console.log('   An explicit FCA0A row overrides the derivation');
}

// ---------------------------------------------------------------------------
// 7c. Identity resolves DOWN, attribution resolves UP
// ---------------------------------------------------------------------------
console.log('\n7c. A sub-org keeps its own NAME but inherits its parent\'s BUDGET KEY:');

{
  // THE TRAP THE PREFIX FIX ALONE WOULD HAVE FALLEN INTO.
  //
  // @clolry supplied 137 real codes, six levels deep. Once all 137 are rows in
  // HC_Orgs, FCA0A has an EXACT match — and resolveOrgByCode prefers an exact
  // match, correctly, since FCA0A is the "Portfolio Management Service Center"
  // and not its parent.
  //
  // But only FC/FCA/FCB/FCC carry an Office_Code, because only those four are
  // budget offices in BudgetConfig.js. An exact match alone would therefore
  // return a BLANK budget key for all 133 sub-orgs — which is the same blank
  // @clolry reported in the first place. The fix would have MOVED the failure
  // and the symptom would have looked identical.
  const orgs = [
    orgRow({ Org_Code: 'FC',    Office_Code: 'FO',  Business_Unit: 'Front Office',
             Sector: 'ASD', Division: 'Office of Acquisition Solutions Development',
             Status: 'Active' }),
    orgRow({ Org_Code: 'FCA',   Office_Code: 'OMD', Business_Unit: 'OMD',
             Sector: 'ASD', Division: 'Office of Mission Delivery', Status: 'Active' }),
    // The real shape: name only, no budget key.
    orgRow({ Org_Code: 'FCA0A', Division: 'Portfolio Management Service Center',
             Sector: '', Status: 'Active' }),
    orgRow({ Org_Code: 'FCA0BAA', Division: 'Stakeholder Connection Division / Branch A',
             Status: 'Active' })
  ];
  const rows = [
    posRow({ Position_Number: 'FCA0A-0008', Employee_Name: 'Portfolio Person',
             Org_Code: 'FCA0A', Grade: 13 }),
    posRow({ Position_Number: 'DEEP-1', Employee_Name: 'Six Levels Down',
             Org_Code: 'FCA0BAA', Grade: 12 })
  ];
  const { HC } = loadHC(rows, orgs, { quiet: true });
  const byNum = {};
  HC.hcGetBundle().data.forEach(p => { byNum[p.positionNumber] = p; });

  const sub = byNum['FCA0A-0008'];
  // IDENTITY — the most specific row wins.
  assert.strictEqual(sub.org.division, 'Portfolio Management Service Center',
    'FCA0A must keep its OWN name, not inherit "Office of Mission Delivery"');
  assert.strictEqual(sub.org.resolvedOrgCode, 'FCA0A',
    'an exact row must resolve to itself');
  console.log('   FCA0A keeps its own name: Portfolio Management Service Center');

  // ATTRIBUTION — the nearest ancestor that actually has a value wins.
  assert.strictEqual(sub.org.officeCode, 'OMD',
    'THE REGRESSION TO WATCH: a blank Office_Code on the exact row must not ' +
    'blank the budget key. It must inherit OMD from FCA.');
  assert.strictEqual(sub.org.businessUnit, 'OMD',
    'business unit must inherit too');
  assert.strictEqual(sub.org.sector, 'ASD',
    'an empty-string cell must not stop the walk');
  console.log('   and inherits budget key OMD + sector ASD from FCA');

  // Six levels deep, skipping ancestors that are not even rows (FCA0B, FCA0BA
  // are absent here).
  const deep = byNum['DEEP-1'];
  assert.strictEqual(deep.org.officeCode, 'OMD',
    'inheritance must skip missing intermediate rows and keep climbing');
  assert.strictEqual(deep.org.division, 'Stakeholder Connection Division / Branch A',
    'a six-level code keeps its own name');
  console.log('   FCA0BAA inherits OMD across missing intermediate rows');

  // An explicit value on the sub-org must WIN, so a reorganisation moving a
  // service center to another DAC is one row rather than a code change.
  const moved = orgs.slice();
  moved[2] = orgRow({ Org_Code: 'FCA0A', Office_Code: 'IDV', Business_Unit: 'IDV',
                      Division: 'Portfolio Management Service Center', Status: 'Active' });
  const m = loadHC(rows, moved, { quiet: true });
  const movedPos = m.HC.hcGetBundle().data.find(p => p.positionNumber === 'FCA0A-0008');
  assert.strictEqual(movedPos.org.officeCode, 'IDV',
    'an explicit budget key on the sub-org row must override the inherited one');
  console.log('   An explicit key on the sub-org row overrides inheritance');
}

// ---------------------------------------------------------------------------
// 7d. @clolry's real 137-code list
// ---------------------------------------------------------------------------
console.log('\n7d. The real org list is internally consistent:');

{
  // Loaded from HCSeed.js rather than restated here: a copy would drift from
  // the table that actually gets written to the sheet.
  const seedCtx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Array, Math, RegExp, Error
  });
  vm.runInContext('var TRAVEL_DB_SPREADSHEET_ID=null; var SHEET_NAMES={}; ' +
                  'var TRAVEL_SHEET_SCHEMAS={}; var HC={};', seedCtx);
  vm.runInContext(fs.readFileSync(path.join(SERVER, '91_setup', 'HCSeed.js'), 'utf8'),
                  seedCtx, { filename: 'HCSeed.js' });
  const real = vm.runInContext('hcRealOrgRecords()', seedCtx);

  assert.strictEqual(real.length, 137, 'expected @clolry\'s 137 codes');
  const codes = real.map(o => o.orgCode);
  assert.strictEqual(new Set(codes).size, 137, 'org codes must be unique — they are the PK');
  console.log('   137 unique codes');

  // EXACTLY four budget keys. More would mean a sub-org had been given one by
  // accident, which silently misattributes its travel.
  //
  // Compared as a JOINED STRING, not with deepStrictEqual: `real` comes from a
  // separate vm context, so its arrays have a different Array.prototype and
  // deepStrictEqual fails on two arrays that print identically. That cost ten
  // minutes once; it should not cost them twice.
  const keyed = real.filter(o => o.officeCode);
  assert.strictEqual(keyed.map(o => o.orgCode + '=' + o.officeCode).join(' '),
    'FC=FO FCA=OMD FCB=IDV FCC=CM',
    'only the four top-level orgs may carry a budget key');
  console.log('   exactly four budget keys: FC=FO FCA=OMD FCB=IDV FCC=CM');

  // THE PROPERTY THE WHOLE SCHEME RESTS ON: every code's longest proper
  // prefix is a real code, so every position reaches a budget key.
  const set = new Set(codes);
  const orphans = codes.filter(c => {
    if (c === 'FC') return false;
    return ![...set].some(k => k !== c && c.startsWith(k));
  });
  assert.strictEqual(orphans.join(','), '',
    'every code must have an ancestor in the list, or its travel attributes nowhere');
  console.log('   every code has an ancestor in the list');

  // The prefix chain must be unambiguous — no code may have two ancestors
  // that are not themselves nested, or "longest prefix" would be arbitrary.
  codes.forEach(c => {
    const anc = [...set].filter(k => k !== c && c.startsWith(k)).sort((a, b) => a.length - b.length);
    for (let i = 0; i + 1 < anc.length; i++) {
      assert.ok(anc[i + 1].startsWith(anc[i]),
        'ambiguous ancestry for ' + c + ': ' + anc[i] + ' and ' + anc[i + 1]);
    }
  });
  console.log('   ancestry is a strict chain, so longest-prefix is well defined');

  // And the real list actually resolves through the real code path.
  const realOrgRows = real.map(o => orgRow({
    Org_Code: o.orgCode, Office_Code: o.officeCode, Business_Unit: o.businessUnit,
    Sector: o.sector, Division: o.division, Status: o.status
  }));
  const samples = ['FCA0A', 'FCBADDD', 'FCCACBA', 'FCCAAAA', 'FCB0BBB'];
  const { HC: realHC } = loadHC(
    samples.map((c, i) => posRow({ Position_Number: 'P' + i, Employee_Name: 'X' + i,
                                   Org_Code: c, Grade: 13 })),
    realOrgRows, { quiet: true });
  const resolved = realHC.hcGetBundle().data;
  const blanks = resolved.filter(p => !p.org.officeCode);
  assert.strictEqual(blanks.map(p => p.orgCode).join(','), '',
    'every sampled real code must reach a budget key');
  assert.strictEqual(resolved.find(p => p.orgCode === 'FCCACBA').org.officeCode, 'CM');
  assert.strictEqual(resolved.find(p => p.orgCode === 'FCBADDD').org.officeCode, 'IDV');
  console.log('   all 5 sampled codes resolve to a budget key (FCCACBA->CM, FCBADDD->IDV)');

  // Every one of the 137, not just a sample.
  const allRows = codes.map((c, i) => posRow({ Position_Number: 'Q' + i,
    Employee_Name: 'Y' + i, Org_Code: c, Grade: 13 }));
  const { HC: allHC } = loadHC(allRows, realOrgRows, { quiet: true });
  const allResolved = allHC.hcGetBundle().data;
  const noKey = allResolved.filter(p => !p.org.officeCode).map(p => p.orgCode);
  assert.strictEqual(noKey.join(','), '', 'these codes reach no budget key');
  const noName = allResolved.filter(p => !p.org.division).map(p => p.orgCode);
  assert.strictEqual(noName.join(','), '', 'these codes resolve to no name');
  console.log('   all 137 resolve to both a budget key and their own name');
}

// ---------------------------------------------------------------------------
// 8. Caching, and the return type CacheWarming.js depends on
// ---------------------------------------------------------------------------
console.log('\n8. Cache behaviour:');

{
  const rows = [posRow({ Position_Number: 'P1', Employee_Name: 'Ada', Org_Code: 'FC', Grade: 15 })];
  const h = loadHC(rows, ORGS, { quiet: true });

  h.HC.hcGetBundle();
  const afterFirst = h.sheetReadCount();
  h.HC.hcGetBundle();
  assert.strictEqual(h.sheetReadCount(), afterFirst,
    'Second hcGetBundle() re-read the sheet — the cache is not being used');
  console.log('   Second call served from cache (no extra sheet read)');

  // CacheWarming.js:58 does `var count = HC.hcRefreshBundleCache();` and logs
  // it as a number. Returning an object here would print [object Object].
  const count = h.HC.hcRefreshBundleCache();
  assert.strictEqual(typeof count, 'number',
    'hcRefreshBundleCache must return a NUMBER — CacheWarming.js:58 uses it directly');
  assert.strictEqual(count, 1);
  console.log('   hcRefreshBundleCache() returns a position count');

  h.HC.hcCacheInvalidateAll();
  const beforeReread = h.sheetReadCount();
  h.HC.hcGetBundle();
  assert.ok(h.sheetReadCount() > beforeReread,
    'After hcCacheInvalidateAll() the next read must hit the sheet. Without ' +
    'this, an admin edit stays invisible for CACHE_CONFIG.TTL.LONG (6 hours) ' +
    'and looks like the save failed.');
  console.log('   hcCacheInvalidateAll() forces a re-read');
}

// ---------------------------------------------------------------------------
// 9. Degrades quietly, exactly as the 28 try/catch call sites assume
// ---------------------------------------------------------------------------
console.log('\n9. Failure modes:');

{
  // Missing tabs are a setup state, not a crash. Every inherited caller checks
  // `bundle.success && bundle.data` and continues, so an empty-but-successful
  // bundle reproduces the pre-existing no-library behaviour.
  const noTabs = loadHC([], ORGS, { quiet: true, noPositionsTab: true });
  const b = noTabs.HC.hcGetBundle();
  assert.strictEqual(b.success, true);
  assert.ok(Array.isArray(b.data) && b.data.length === 0, 'data must be an empty array');
  console.log('   Missing HC_Positions tab -> success:true, data:[]');

  // An unset Script Property must produce a diagnosable message, not the
  // platform's bare 'Invalid argument: id' (the real incident at Database.js:456).
  const noId = loadHC([], ORGS, { quiet: true, noDbId: true });
  const failed = noId.HC.hcGetBundle();
  assert.strictEqual(failed.success, false);
  assert.ok(/TRAVEL_DB_SPREADSHEET_ID/.test(failed.error),
    'The error must name the missing property; got: ' + failed.error);
  assert.ok(Array.isArray(failed.data) && failed.data.length === 0,
    'data must still be an empty array on failure');
  console.log('   Unset TRAVEL_DB_SPREADSHEET_ID -> named error, data still []');

  const failedOrgs = noId.HC.hcGetOrgHierarchy();
  assert.ok(Array.isArray(failedOrgs) && failedOrgs.length === 0,
    'hcGetOrgHierarchy must return [] on failure — OrgLookup.js iterates it directly');
  console.log('   hcGetOrgHierarchy returns [] on failure');
}

// ---------------------------------------------------------------------------
// 10. The org chart projection leaks nothing
// ---------------------------------------------------------------------------
console.log('\n10. Org chart projection (PII reduction):');

{
  const rows = [
    posRow({ Position_Number: 'P1', Employee_Name: 'Ada Boss', Email_Address: 'ada@gsa.gov',
             Employee_ID: '0012345', Org_Code: 'FC', Office_Title: 'Assistant Commissioner',
             Grade: 'SES', Supervisory_Status: 2, Location_Code: 'DC01',
             Duty_Station_Address: '1800 F St NW', Duty_Station_City: 'Washington',
             Duty_Station_State: 'DC' }),
    posRow({ Position_Number: 'P2', Reports_To_Position_Number: 'P1', Employee_Name: 'Dee Director',
             Email_Address: 'dee@gsa.gov', Employee_ID: '0067890', Org_Code: 'FCA',
             Office_Title: 'Division Director', Grade: 15, Supervisory_Status: 2 }),
    posRow({ Position_Number: 'P3', Reports_To_Position_Number: 'P2', Employee_Name: 'Stan Staff',
             Email_Address: 'stan@gsa.gov', Org_Code: 'FCA', Grade: 13 }),
    posRow({ Position_Number: 'P4', Reports_To_Position_Number: 'P2', Employee_Name: 'Vic Vacant',
             Org_Code: 'FCA', Grade: 14, Occupancy_Status: 'VACANT' })
  ];
  const { HC } = loadHC(rows, ORGS, { quiet: true });
  const tree = HC.hcGetOrgChartTree();

  assert.strictEqual(tree.success, true);
  assert.strictEqual(tree.roots.length, 1, 'P1 is the only root');
  assert.strictEqual(tree.roots[0].name, 'Ada Boss');
  assert.strictEqual(tree.roots[0].children.length, 1);
  assert.strictEqual(tree.roots[0].children[0].children.length, 1,
    'Stan should hang off Dee; the vacant seat must be dropped');
  console.log('   Tree assembled server-side: Ada -> Dee -> Stan');

  // The org chart deployment is reachable by any domain user with the link, so
  // the reduced payload IS the access control. Serialize the whole thing and
  // assert that no sensitive value appears anywhere in it.
  const serialized = JSON.stringify(tree);
  const mustNotLeak = {
    'email address': 'gsa.gov',
    'employee ID': '0012345',
    'grade': 'SES',
    'supervisory status': '"supervisoryStatus"',
    'position number': '"P1"',
    'location code': 'DC01',
    'duty station address': '1800 F St NW',
    'duty station city': 'Washington',
    'occupancy status': 'VACANT'
  };
  Object.keys(mustNotLeak).forEach(label => {
    assert.ok(!serialized.includes(mustNotLeak[label]),
      `PII LEAK: ${label} ("${mustNotLeak[label]}") appears in the org chart payload. ` +
      'This projection is served to any domain user with the link; it must emit ' +
      'only workgroup name, supervisor name and employee names.');
  });
  console.log('   No email, employee ID, grade, position number, or duty station in payload');

  // Vacant seats are omitted entirely. A public chart should not advertise
  // which positions are unfilled.
  assert.ok(!serialized.includes('Vic Vacant'), 'Vacant seats must be omitted');
  console.log('   Vacant positions omitted entirely');

  // Only the four intended keys survive.
  const keys = Object.keys(tree.roots[0]).sort();
  assert.deepStrictEqual(Array.from(keys), ['children', 'name', 'org', 'title'],
    'Org chart nodes must carry exactly: name, title, org, children. Got: ' + keys.join(', '));
  console.log('   Node keys are exactly [children, name, org, title]');
}

// ---------------------------------------------------------------------------
// 10b. Reporting through a vacant seat must reparent, not orphan
// ---------------------------------------------------------------------------
console.log('\n10b. Vacant-seat reparenting:');

{
  // Dropping vacant seats from the chart would orphan anyone reporting to one.
  // Without the nearest-staffed-ancestor walk, Nia renders as a SECOND
  // top-level root — visually implying she is a peer of the Assistant
  // Commissioner rather than two levels below her.
  //
  // This was a real defect found by running the seed data through the
  // projection, not a hypothetical: Yevgenia Taraschuk reports to a vacant
  // GS-15 deputy in HCSeed.js and appeared as a false root.
  const rows = [
    posRow({ Position_Number: 'T1', Employee_Name: 'Ada Boss', Grade: 'SES', Org_Code: 'FC' }),
    posRow({ Position_Number: 'T2', Reports_To_Position_Number: 'T1', Employee_Name: 'Vic Vacant',
             Grade: 15, Occupancy_Status: 'VACANT', Org_Code: 'FCA' }),
    posRow({ Position_Number: 'T3', Reports_To_Position_Number: 'T2', Employee_Name: 'Nia Analyst',
             Grade: 13, Org_Code: 'FCA' })
  ];
  const { HC } = loadHC(rows, ORGS, { quiet: true });
  const tree = HC.hcGetOrgChartTree();

  assert.strictEqual(tree.roots.length, 1,
    'Reporting through a vacant seat must NOT create a second root. Got ' +
    tree.roots.length + ' roots: ' + tree.roots.map(r => r.name).join(', '));
  assert.strictEqual(tree.roots[0].name, 'Ada Boss');
  assert.strictEqual(tree.roots[0].children.length, 1);
  assert.strictEqual(tree.roots[0].children[0].name, 'Nia Analyst',
    'Nia should reparent onto the nearest STAFFED ancestor (Ada), skipping Vic');
  console.log('   Reports-to-vacant reparents onto the nearest staffed ancestor');

  // Every staffed person must appear exactly once. A reparenting bug that
  // dropped a subtree would still produce one root, so count the nodes.
  function countNodes(n) {
    return 1 + n.children.reduce((sum, c) => sum + countNodes(c), 0);
  }
  const inTree = tree.roots.reduce((sum, r) => sum + countNodes(r), 0);
  assert.strictEqual(inTree, tree.count,
    `Node accounting mismatch: ${tree.count} staffed but ${inTree} in the tree. ` +
    'Someone was dropped or duplicated.');
  console.log(`   Node accounting balances (${inTree} staffed, ${inTree} rendered)`);

  // A chain of two vacant seats must still resolve rather than stopping at
  // the first one.
  const deep = loadHC([
    posRow({ Position_Number: 'D1', Employee_Name: 'Top Boss', Grade: 'SES', Org_Code: 'FC' }),
    posRow({ Position_Number: 'D2', Reports_To_Position_Number: 'D1', Employee_Name: 'Gap One',
             Grade: 15, Occupancy_Status: 'VACANT', Org_Code: 'FCA' }),
    posRow({ Position_Number: 'D3', Reports_To_Position_Number: 'D2', Employee_Name: 'Gap Two',
             Grade: 14, Occupancy_Status: 'VACANT', Org_Code: 'FCA' }),
    posRow({ Position_Number: 'D4', Reports_To_Position_Number: 'D3', Employee_Name: 'Deep Staff',
             Grade: 12, Org_Code: 'FCA' })
  ], ORGS, { quiet: true });
  const deepTree = deep.HC.hcGetOrgChartTree();
  assert.strictEqual(deepTree.roots.length, 1, 'Two stacked vacancies must still resolve');
  assert.strictEqual(deepTree.roots[0].children[0].name, 'Deep Staff');
  console.log('   Two stacked vacancies resolve to the staffed ancestor above them');

  // A cycle among vacant seats must terminate. Unguarded, the reparenting
  // walk would loop forever inside a web request — a hung page, not an error.
  const cyclic = loadHC([
    posRow({ Position_Number: 'C1', Reports_To_Position_Number: 'C2', Employee_Name: 'Ghost A',
             Grade: 15, Occupancy_Status: 'VACANT', Org_Code: 'FCA' }),
    posRow({ Position_Number: 'C2', Reports_To_Position_Number: 'C1', Employee_Name: 'Ghost B',
             Grade: 15, Occupancy_Status: 'VACANT', Org_Code: 'FCA' }),
    posRow({ Position_Number: 'C3', Reports_To_Position_Number: 'C1', Employee_Name: 'Real Person',
             Grade: 13, Org_Code: 'FCA' })
  ], ORGS, { quiet: true });

  const started = Date.now();
  const cyclicTree = cyclic.HC.hcGetOrgChartTree();
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `vacant-seat cycle took ${elapsed}ms — likely looping`);
  assert.strictEqual(cyclicTree.success, true);
  assert.strictEqual(cyclicTree.roots.length, 1,
    'The one real person becomes a root when the chain above is a vacant cycle');
  assert.strictEqual(cyclicTree.roots[0].name, 'Real Person');
  console.log(`   Cycle among vacant seats terminates (${elapsed}ms)`);
}

// ---------------------------------------------------------------------------
// 11. Negative control
// ---------------------------------------------------------------------------
console.log('\n11. Negative control (the suite must be able to fail):');

{
  // Patch the zero-padding out of _grade_ and confirm section 3's core
  // assertion breaks. A test that cannot fail is not a test.
  const src = fs.readFileSync(path.join(SERVER, '20_data', 'HCData.js'), 'utf8');
  const broken = src.replace(
    "if (/^\\d+$/.test(s)) return s.length === 1 ? '0' + s : s;",
    'if (/^\\d+$/.test(s)) return s;'
  );
  assert.notStrictEqual(broken, src, 'negative control failed to patch the source');

  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} }, String, RegExp, Object, JSON, Date });
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';", ctx);
  vm.runInContext(fs.readFileSync(path.join(SERVER, '01_constants', 'Cache.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(SERVER, '01_constants', 'Sheets.js'), 'utf8'), ctx);
  vm.runInContext(broken, ctx, { filename: 'HCData.js (unpadded)' });
  const brokenHC = vm.runInContext('HC', ctx);

  assert.strictEqual(brokenHC._grade(7), '7',
    'NEGATIVE CONTROL FAILED: removing the pad did not change behaviour, so ' +
    'section 3 is not actually exercising the GS-07 coercion bug.');
  console.log('   Unpadded _grade(7) returns "7" as expected — section 3 is live');
}

console.log('\n--- ALL HC DATA LAYER ASSERTIONS PASSED! ---');
