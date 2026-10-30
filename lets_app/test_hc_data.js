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
