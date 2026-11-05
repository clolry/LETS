/**
 * Automated Verification Script for the org chart (orgchart_app).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * This project is a DELIBERATE SECOND IMPLEMENTATION of the HC reader in
 * lets_app/server/20_data/HCData.js. A library binding was rejected: LETS
 * exists in its current form precisely because the inherited HC library
 * became unreachable, and recreating that coupling would reproduce the
 * failure it was built to escape.
 *
 * The cost of duplication is drift, and drift here is SILENT — a chart that
 * quietly disagrees with the roster. Nobody files "the chart looks slightly
 * wrong". So section 6 loads BOTH readers and asserts they agree, position
 * for position, on identical input.
 *
 * The second thing this protects is the DATA REDUCTION. The web app is
 * reachable by any domain user with the link. If an email address or a
 * position number ever reaches a node, View Source discloses it, and nothing
 * in the UI would look different. Section 4 serializes the real payload and
 * greps it.
 *
 * Run: node orgchart_app/test_orgchart.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 240)); fails++; }
};

const OC = path.join(__dirname, 'server');
const LETS = path.join(__dirname, '..', 'lets_app', 'server');

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

const posRow = o => POS_HEADERS.map(h => (h in o ? o[h] : ''));
const orgRow = o => ORG_HEADERS.map(h => (h in o ? o[h] : ''));

/**
 * Nodes actually present in the tree.
 *
 * Compared against the reported `count`, which is computed before the tree is
 * assembled. A mismatch means people were lost during assembly — the exact
 * failure mode of a detached cycle, and invisible without this.
 */
function countNodes(roots) {
  let n = 0;
  (function walk(list) {
    list.forEach(x => { n++; walk(x.children || []); });
  })(roots);
  return n;
}

/**
 * Loads orgchart_app the way Apps Script does.
 *
 * SpreadsheetApp and CacheService are STUBBED, not mocked away, so the read
 * path, the header-name resolution and the cache path all execute for real.
 */
function loadOC(positionRows, orgRows, options) {
  options = options || {};
  const cacheStore = {};
  let reads = 0;
  const logs = [];

  function sheet(headers, rows) {
    const values = [headers].concat(rows);
    return {
      getLastRow: () => values.length,
      getLastColumn: () => headers.length,
      getRange: (r1, c1, nr, nc) => ({
        getValues: () => {
          reads++;
          return values.slice(r1 - 1, r1 - 1 + nr).map(r => r.slice(c1 - 1, c1 - 1 + nc));
        }
      })
    };
  }

  const props = Object.assign({
    HC_SPREADSHEET_ID: options.noId ? '' : 'FAKE_ID'
  }, options.props || {});

  const sb = {
    console: { log: m => logs.push(String(m)), warn: m => logs.push(String(m)), error: m => logs.push(String(m)) },
    JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
    parseInt, parseFloat, isNaN,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) })
    },
    SpreadsheetApp: {
      openById: (id) => {
        if (options.openThrows) throw new Error('No item with the given ID could be found');
        return {
          getName: () => 'LETS DB',
          getSheets: () => [{ getName: () => 'HC_Positions' }, { getName: () => 'HC_Orgs' }],
          getSheetByName: (n) => {
            if (n === 'HC_Positions') return options.noPositionsTab ? null : sheet(POS_HEADERS, positionRows);
            if (n === 'HC_Orgs') return options.noOrgsTab ? null : sheet(ORG_HEADERS, orgRows);
            return null;
          }
        };
      }
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in cacheStore ? cacheStore[k] : null),
        put: (k, v, s) => {
          if (options.cachePutThrows) throw new Error('Argument too large: value');
          cacheStore[k] = v;
        },
        removeAll: ks => ks.forEach(k => delete cacheStore[k])
      })
    }
  };

  const ctx = vm.createContext(sb);
  ['00_config/Config.js', '20_data/HCRead.js'].forEach(rel => {
    vm.runInContext(fs.readFileSync(path.join(OC, rel), 'utf8'), ctx, { filename: rel });
  });

  return {
    ctx,
    HCRead: vm.runInContext('HCRead', ctx),
    run: expr => vm.runInContext(expr, ctx),
    cacheStore,
    readCount: () => reads,
    logs
  };
}

/** Loads LETS's HCData.js, for the agreement check in section 6. */
function loadLETS(positionRows, orgRows) {
  let reads = 0;
  function sheet(headers, rows) {
    const values = [headers].concat(rows);
    return {
      getLastRow: () => values.length,
      getLastColumn: () => headers.length,
      getRange: (r1, c1, nr, nc) => ({
        getValues: () => {
          reads++;
          return values.slice(r1 - 1, r1 - 1 + nr).map(r => r.slice(c1 - 1, c1 - 1 + nc));
        }
      })
    };
  }
  const store = {};
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: n => {
          if (n === 'HC_Positions') return sheet(POS_HEADERS, positionRows);
          if (n === 'HC_Orgs') return sheet(ORG_HEADERS, orgRows);
          return null;
        }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in store ? store[k] : null),
        put: (k, v) => { store[k] = v; },
        removeAll: ks => ks.forEach(k => delete store[k])
      })
    }
  };
  const ctx = vm.createContext(sb);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='FAKE_ID';", ctx);
  ['01_constants/Cache.js', '01_constants/Sheets.js', '20_data/HCData.js'].forEach(rel => {
    vm.runInContext(fs.readFileSync(path.join(LETS, rel), 'utf8'), ctx, { filename: rel });
  });
  return vm.runInContext('HC', ctx);
}

/** @clolry's real org codes, read from the LETS seed so the two cannot drift. */
function realOrgs() {
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Array, Math, RegExp, Error
  });
  vm.runInContext('var TRAVEL_DB_SPREADSHEET_ID=null; var SHEET_NAMES={}; ' +
                  'var TRAVEL_SHEET_SCHEMAS={}; var HC={};', ctx);
  vm.runInContext(fs.readFileSync(path.join(LETS, '91_setup', 'HCSeed.js'), 'utf8'), ctx);
  return vm.runInContext('hcRealOrgRecords()', ctx);
}

const REAL = realOrgs();
const REAL_ORG_ROWS = REAL.map(o => orgRow({
  Org_Code: o.orgCode, Office_Code: o.officeCode, Business_Unit: o.businessUnit,
  Sector: o.sector, Division: o.division, Status: o.status, Is_Active: true
}));

console.log('--- Org chart test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. configuration comes from Script Properties, never from source');
{
  // A hardcoded spreadsheet ID is exactly what the LETS CI guard exists to
  // catch. Asserted here for a new project before anyone can paste one in.
  ['00_config/Config.js', '20_data/HCRead.js', '50_pages/Render.js'].forEach(rel => {
    const src = fs.readFileSync(path.join(OC, rel), 'utf8');
    ok('no ID literal in ' + rel, !/['"]1[A-Za-z0-9_-]{39,}['"]/.test(src));
  });

  // An unset property must produce an INSTRUCTION, not a stack trace. A fresh
  // deployment always starts here, so it is the most-seen error in the app.
  const unset = loadOC([], [], { noId: true });
  const r = unset.run('HCRead.buildTree()');
  ok('unset ID fails cleanly', r.success === false);
  ok('and names the property to set', /HC_SPREADSHEET_ID/.test(r.error), r.error);
  ok('and says where to set it', /Script Propert/i.test(r.error), r.error);

  // POINTING AT THE WRONG SPREADSHEET. @clolry's first run opened "Copy of
  // FAS Travel Exemption Request (Responses)" — a Google Form responses sheet
  // — and the error said only "HC_Positions is empty or missing", which reads
  // like the LETS database needs setting up rather than like the ID is wrong.
  //
  // A diagnostic that reports a symptom it already has the evidence to
  // explain costs a round trip, and this one cost @clolry a deploy cycle.
  const wrongSheet = loadOC([], [], { props: { HC_SPREADSHEET_ID: 'OTHER_FILE' } });
  const w = wrongSheet.run('HCRead.buildTree()');
  ok('an empty HC_Positions names the spreadsheet it opened',
     w.success === false && /Copy of FAS|LETS DB/.test(w.error), w.error);
  ok('and says which property to copy the right ID from',
     /TRAVEL_DB_SPREADSHEET_ID/.test(w.error), w.error);
  ok('and lists the tabs it did find',
     /contains:/.test(w.error), w.error);

  // A wrong ID and a permissions failure look identical from here, and the
  // likelier cause is permissions — the deploying account must be able to
  // read the LETS database. Saying only "not found" sends the reader to the
  // wrong fix.
  const thrown = loadOC([], [], { openThrows: true });
  const t = thrown.run('HCRead.buildTree()');
  ok('an unopenable spreadsheet mentions permissions',
     t.success === false && /can read it/.test(t.error), t.error);

  // Cache lifetime is clamped, so a mistyped property cannot disable caching
  // or exceed the CacheService ceiling.
  const clamp = loadOC([], [], { props: { CACHE_MINUTES: '99999' } });
  ok('cache seconds clamped to the 6-hour ceiling',
     clamp.run('getCacheSeconds()') === 360 * 60, clamp.run('getCacheSeconds()'));
  const zero = loadOC([], [], { props: { CACHE_MINUTES: '0' } });
  ok('and floored at a minute', zero.run('getCacheSeconds()') === 60);
  const junk = loadOC([], [], { props: { CACHE_MINUTES: 'soon' } });
  ok('and defaults when unparseable', junk.run('getCacheSeconds()') === 60 * 60);
}

// ---------------------------------------------------------------------------
console.log('\n2. the sheet is read BY HEADER NAME, not by column position');
{
  // LETS calls positional reads its most dangerous routine hazard: eighteen
  // places do it, and inserting a column silently misfiles everything after
  // it (ADMINISTRATOR_GUIDE §1.6.5, finding G-014). This project will not add
  // a nineteenth.
  //
  // Proven by MOVING a column rather than by reading the source: a column
  // order the code has never seen must still resolve.
  const shuffled = ['Employee_Name', 'Org_Code', 'Position_Number',
                    'Reports_To_Position_Number', 'Office_Title', 'Grade',
                    'Occupancy_Status', 'Is_Active'];
  const rows = [
    ['Ada Root', 'FC', 'P1', '', 'Assistant Commissioner', 'SES', 'FILLED', true],
    ['Bo Deep', 'FCA', 'P2', 'P1', 'Director', 15, 'FILLED', true]
  ];

  // Reuse the harness's stub by handing it a different header set.
  const cacheStore = {};
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
    parseInt, parseFloat, isNaN,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'FAKE_ID' }) },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: n => {
          const hdr = n === 'HC_Positions' ? shuffled : ORG_HEADERS;
          const data = n === 'HC_Positions' ? rows : [orgRow({ Org_Code: 'FC', Division: 'ASD', Is_Active: true })];
          const values = [hdr].concat(data);
          return {
            getLastRow: () => values.length,
            getLastColumn: () => hdr.length,
            getRange: (r1, c1, nr, nc) => ({
              getValues: () => values.slice(r1 - 1, r1 - 1 + nr).map(r => r.slice(c1 - 1, c1 - 1 + nc))
            })
          };
        }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in cacheStore ? cacheStore[k] : null),
        put: (k, v) => { cacheStore[k] = v; },
        removeAll: () => {}
      })
    }
  };
  const ctx = vm.createContext(sb);
  ['00_config/Config.js', '20_data/HCRead.js'].forEach(rel => {
    vm.runInContext(fs.readFileSync(path.join(OC, rel), 'utf8'), ctx, { filename: rel });
  });
  const tree = vm.runInContext('HCRead.buildTree()', ctx);
  ok('a reordered sheet still resolves', tree.success === true, tree.error);
  ok('and builds the same structure',
     tree.roots.length === 1 && tree.roots[0].name === 'Ada Root' &&
     tree.roots[0].children.length === 1 &&
     tree.roots[0].children[0].name === 'Bo Deep',
     JSON.stringify(tree.roots));

  // Blank spacer rows accumulate in a hand-maintained sheet. Each one would
  // otherwise become a node with no name.
  const spacers = loadOC(
    [posRow({ Position_Number: 'P1', Employee_Name: 'Solo', Grade: 15 }),
     POS_HEADERS.map(() => ''),
     posRow({ Position_Number: 'P2', Employee_Name: 'Two', Reports_To_Position_Number: 'P1', Grade: 13 })],
    [orgRow({ Org_Code: 'FC', Division: 'ASD' })], { quiet: true });
  const st = spacers.run('HCRead.buildTree()');
  ok('blank rows are skipped', st.count === 2, st.count);
}

// ---------------------------------------------------------------------------
console.log('\n3. the tree is correct, including the cases that fail silently');
{
  const ORGS = [
    orgRow({ Org_Code: 'FC', Office_Code: 'FO', Business_Unit: 'Front Office',
             Division: 'Office of Acquisition Solutions Development', Is_Active: true }),
    orgRow({ Org_Code: 'FCA', Office_Code: 'OMD', Business_Unit: 'OMD',
             Division: 'Office of Mission Delivery', Is_Active: true })
  ];

  // VACANT-SEAT REPARENTING. A vacant seat is omitted from the chart, which
  // would orphan anyone reporting through it — they would render as a second
  // top-level root, implying they report to nobody.
  const viaVacant = loadOC([
    posRow({ Position_Number: 'P1', Employee_Name: 'Top', Org_Code: 'FC',
             Grade: 'SES', Occupancy_Status: 'FILLED' }),
    posRow({ Position_Number: 'P2', Employee_Name: '', Org_Code: 'FCA',
             Reports_To_Position_Number: 'P1', Grade: 15, Occupancy_Status: 'VACANT' }),
    posRow({ Position_Number: 'P3', Employee_Name: 'Deep', Org_Code: 'FCA',
             Reports_To_Position_Number: 'P2', Grade: 13, Occupancy_Status: 'FILLED' })
  ], ORGS);
  const vt = viaVacant.run('HCRead.buildTree()');
  ok('one root, not two', vt.roots.length === 1, vt.roots.map(r => r.name));
  ok('the vacant seat is omitted entirely',
     JSON.stringify(vt.roots).indexOf('VACANT') === -1);
  ok('and the person below it is reparented to the nearest staffed ancestor',
     vt.roots[0].children.length === 1 && vt.roots[0].children[0].name === 'Deep',
     JSON.stringify(vt.roots[0].children));

  // A lowercase 'vacant' must behave identically. LETS has two call sites that
  // compare `!== 'VACANT'` with no uppercasing, so an unnormalized value reads
  // as STAFFED on one side and VACANT on the other — here it would put an
  // empty name on a published chart.
  const lower = loadOC([
    posRow({ Position_Number: 'P1', Employee_Name: 'Top', Grade: 'SES' }),
    posRow({ Position_Number: 'P2', Employee_Name: 'Ghost',
             Reports_To_Position_Number: 'P1', Occupancy_Status: 'vacant' })
  ], ORGS);
  const lt = lower.run('HCRead.buildTree()');
  ok('lowercase "vacant" is still treated as vacant', lt.count === 1, lt.count);

  // CYCLE PROTECTION. A -> B -> A is an infinite loop inside a web request:
  // a hung page rather than an error.
  const cyclic = loadOC([
    posRow({ Position_Number: 'C1', Employee_Name: 'Loop A',
             Reports_To_Position_Number: 'C2', Grade: 14 }),
    posRow({ Position_Number: 'C2', Employee_Name: 'Loop B',
             Reports_To_Position_Number: 'C1', Grade: 14 })
  ], ORGS);
  const ct = cyclic.run('HCRead.buildTree()');
  ok('a reporting cycle terminates', ct.success === true);

  // FOUND BY THIS TEST, and present in LETS's hcGetOrgChartTree too.
  //
  // nearestStaffedAncestor only guards a cycle that passes through a VACANT
  // seat, because it stops at the first STAFFED ancestor. For a staffed
  // cycle both lookups succeed on their first hop: A becomes B's child and B
  // becomes A's child, forming a ring that nothing in roots points at.
  //
  // No error, no hang. Both people and everyone below them vanish, while
  // `count` still includes them — so the header reads "187 people" over a
  // tree of 140. A chart that is confidently wrong.
  // Both people are present, as ONE root with the other beneath it — not two
  // unrelated roots. Promoting a single member keeps the one real reporting
  // edge in the ring; promoting both would discard it.
  ok('both people in the cycle still appear', countNodes(ct.roots) === 2,
     'tree holds ' + countNodes(ct.roots) + ' of 2; a detached ring loses them silently');
  ok('as one root with the other beneath it', ct.roots.length === 1,
     ct.roots.map(r => r.name));
  ok('and the cycle is named so it can be fixed',
     ct.warnings.some(w => /Reporting cycle involving position/.test(w)), ct.warnings);
  ok('count matches what the tree actually contains',
     countNodes(ct.roots) === ct.count,
     'count=' + ct.count + ' but the tree holds ' + countNodes(ct.roots));

  // A cycle with people hanging BELOW it: the subtree must survive too, since
  // those people are not themselves part of the bad data.
  const deepCycle = loadOC([
    posRow({ Position_Number: 'C1', Employee_Name: 'Ring A',
             Reports_To_Position_Number: 'C2', Grade: 15 }),
    posRow({ Position_Number: 'C2', Employee_Name: 'Ring B',
             Reports_To_Position_Number: 'C1', Grade: 15 }),
    posRow({ Position_Number: 'S1', Employee_Name: 'Below',
             Reports_To_Position_Number: 'C1', Grade: 12 }),
    posRow({ Position_Number: 'S2', Employee_Name: 'Further Below',
             Reports_To_Position_Number: 'S1', Grade: 11 })
  ], ORGS);
  const dc = deepCycle.run('HCRead.buildTree()');
  ok('a subtree under a cycle is not lost',
     countNodes(dc.roots) === 4,
     'tree holds ' + countNodes(dc.roots) + ' of 4');
  ok('and everyone is still named',
     JSON.stringify(dc.roots).indexOf('Further Below') > -1);

  // A three-member ring, to confirm the fix is not specific to pairs.
  const triangle = loadOC([
    posRow({ Position_Number: 'T1', Employee_Name: 'One', Reports_To_Position_Number: 'T2', Grade: 14 }),
    posRow({ Position_Number: 'T2', Employee_Name: 'Two', Reports_To_Position_Number: 'T3', Grade: 14 }),
    posRow({ Position_Number: 'T3', Employee_Name: 'Three', Reports_To_Position_Number: 'T1', Grade: 14 })
  ], ORGS);
  const tri = triangle.run('HCRead.buildTree()');
  ok('a three-member ring keeps all three', countNodes(tri.roots) === 3,
     countNodes(tri.roots));
  // Only ONE member is promoted; promoting all three would flatten the ring
  // into three unrelated roots and lose the structure that does exist.
  ok('and promotes exactly one of them to a root', tri.roots.length === 1,
     tri.roots.map(r => r.name));

  // A dangling Reports_To must not drop the person from the chart.
  const dangling = loadOC([
    posRow({ Position_Number: 'P1', Employee_Name: 'Orphan',
             Reports_To_Position_Number: 'NOPE', Grade: 13 })
  ], ORGS);
  const dt = dangling.run('HCRead.buildTree()');
  ok('a dangling Reports_To still shows the person',
     dt.count === 1 && dt.roots.length === 1 && dt.roots[0].name === 'Orphan');

  // Is_Active=false means retired. The row is kept in the sheet so past
  // requests keep their attribution, but the person is gone from lookups — so
  // they must be gone from the chart.
  const retired = loadOC([
    posRow({ Position_Number: 'P1', Employee_Name: 'Current', Grade: 15, Is_Active: true }),
    posRow({ Position_Number: 'P2', Employee_Name: 'Departed',
             Reports_To_Position_Number: 'P1', Grade: 13, Is_Active: false })
  ], ORGS);
  const rt = retired.run('HCRead.buildTree()');
  ok('an inactive position is excluded', rt.count === 1, rt.count);
  ok('and their name does not reach the browser',
     JSON.stringify(rt.roots).indexOf('Departed') === -1);

  // Duplicate keys make one of two people invisible to every lookup. Silent
  // otherwise.
  const dupes = loadOC([
    posRow({ Position_Number: 'SAME', Employee_Name: 'First', Grade: 13 }),
    posRow({ Position_Number: 'SAME', Employee_Name: 'Second', Grade: 13 })
  ], ORGS);
  const dup = dupes.run('HCRead.buildTree()');
  ok('a duplicate Position_Number is reported',
     dup.warnings.some(w => /Duplicate Position_Number/.test(w)), dup.warnings);

  // More than one root means a blank Reports_To somewhere, which is worth
  // saying out loud: the chart still renders and looks plausible.
  const multi = loadOC([
    posRow({ Position_Number: 'A', Employee_Name: 'Root A', Grade: 15 }),
    posRow({ Position_Number: 'B', Employee_Name: 'Root B', Grade: 15 })
  ], ORGS);
  const mt = multi.run('HCRead.buildTree()');
  ok('multiple roots are reported',
     mt.warnings.some(w => /report to nobody/.test(w)), mt.warnings);

  // Subtree counts let the UI label a collapsed node without walking it.
  const counted = loadOC([
    posRow({ Position_Number: 'P1', Employee_Name: 'Boss', Grade: 15 }),
    posRow({ Position_Number: 'P2', Employee_Name: 'Mid', Reports_To_Position_Number: 'P1', Grade: 14 }),
    posRow({ Position_Number: 'P3', Employee_Name: 'Junior', Reports_To_Position_Number: 'P2', Grade: 12 })
  ], ORGS);
  const cnt = counted.run('HCRead.buildTree()');
  ok('report counts are the whole subtree, not direct reports',
     cnt.roots[0].reportCount === 2, cnt.roots[0].reportCount);
  ok('and a leaf counts zero',
     cnt.roots[0].children[0].children[0].reportCount === 0);
}

// ---------------------------------------------------------------------------
console.log('\n4. the payload discloses no more than it must');
{
  // THE HIGHEST-VALUE SECTION HERE. This web app is reachable by any domain
  // user with the link. If an email address or a position number reaches a
  // node, View Source discloses it — and nothing in the UI would look
  // different, so no one would notice.
  const t = loadOC([
    posRow({
      Position_Number: 'FCA0A-0008', Reports_To_Position_Number: '',
      Employee_ID: '0010042', Employee_Name: 'Ada Lovelace',
      Email_Address: 'ada.lovelace@example.gov', Org_Code: 'FCA0A',
      Office_Title: 'Program Manager', Grade: 14, Supervisory_Status: '2',
      Occupancy_Status: 'FILLED', LCAT: 'Analyst', Location_Code: 'DC-CENTRAL',
      Duty_Station_Address: '1800 F Street NW', Duty_Station_City: 'Washington',
      Duty_Station_State: 'DC', Is_Active: true
    })
  ], REAL_ORG_ROWS);

  const tree = t.run('HCRead.buildTree()');
  const json = JSON.stringify(tree.roots);

  // Each of these is a separate disclosure with its own reason for mattering.
  ok('no email address', json.indexOf('ada.lovelace@example.gov') === -1);
  ok('no employee ID', json.indexOf('0010042') === -1);
  ok('no position number', json.indexOf('FCA0A-0008') === -1,
     'position numbers are the join keys for the entire reporting tree');
  ok('no grade', json.indexOf('"14"') === -1 && !/grade/i.test(json),
     'a chart with grades on it is a salary-band chart');
  ok('no supervisory status', !/supervisoryStatus/i.test(json));
  ok('no street address', json.indexOf('1800 F Street NW') === -1);
  ok('no LCAT', json.indexOf('Analyst') === -1);
  ok('no internal parent pointer', !/_parent|_pn/.test(json));

  // And what IS there, deliberately.
  const n = tree.roots[0];
  ok('name is present', n.name === 'Ada Lovelace');
  ok('title is present', n.title === 'Program Manager');
  ok('city and state are present', n.location === 'Washington, DC');
  ok('org label is the SUB-ORG name, not its parent',
     n.org === 'Portfolio Management Service Center', n.org);
}

// ---------------------------------------------------------------------------
console.log('\n5. org labels: "FCA and OMD are two ways to describe the same thing"');
{
  // @clolry, exactly that. So the chart shows ONE org label rather than a code
  // plus a redundant business unit beside it.
  const t = loadOC([], REAL_ORG_ROWS);
  const byCode = t.run('HCRead.indexOrgs(' + JSON.stringify(
    REAL.map(o => ({ orgCode: o.orgCode, officeCode: o.officeCode,
                     businessUnit: o.businessUnit, division: o.division,
                     formerOrgCodes: [] })) ) + ')');
  const label = c => t.run('HCRead.orgLabel(' + JSON.stringify(c) + ',' +
                           JSON.stringify(byCode) + ')');

  ok('a sub-org uses its own name',
     label('FCA0A') === 'Portfolio Management Service Center', label('FCA0A'));
  // The stored name is now the BARE level name — 'Branch A' — not a path.
  //
  // @clolry's corrected org list names each row for itself: FCCACBA is
  // 'Branch A', and its position under Technology Account Management Division
  // comes from parentOrgCode rather than from the name. The May data embedded
  // the path in the name, which is why this assertion expected one.
  //
  // Bare names collide by design: 'Branch A' appears under 21 different
  // divisions. That is fine here because the chart renders the TREE, so the
  // parent is already on screen above it.
  ok('six levels deep too', label('FCCACBA') === 'Branch A', label('FCCACBA'));
  ok('and a bare name is reused across parents, which the tree disambiguates',
     label('FCA0BAA') === 'Branch A' && label('FCCACBA') === 'Branch A',
     'the chart shows the parent above, so the bare name is unambiguous in context');
  ok('a top-level org uses its office name',
     label('FCA') === 'Office of Mission Delivery', label('FCA'));

  // A code absent from HC_Orgs inherits its parent's name rather than
  // rendering blank. @clolry's list is "a bit outdated", so this is the
  // expected path for a new org, not an edge case.
  ok('an unlisted code inherits a name',
     label('FCA0AZZ') === 'Portfolio Management Service Center', label('FCA0AZZ'));

  // Nothing known at all: show the code. Blank would be worse — the reader
  // could not even tell what to go and look up.
  ok('an unknown code falls back to itself', label('ZZ99') === 'ZZ99', label('ZZ99'));
  ok('an empty code yields empty', label('') === '');
}

// ---------------------------------------------------------------------------
console.log('\n6. this reader AGREES with LETS, on all 137 real org codes');
{
  // THE REASON THIS SUITE EXISTS.
  //
  // HCRead.js is a deliberate SECOND implementation of HCData.js. A library
  // binding was rejected: LETS exists in its current form precisely because
  // the inherited HC library became unreachable, and recreating that coupling
  // would reproduce the failure it was built to escape.
  //
  // The cost of duplication is drift, and drift here is silent — a chart that
  // quietly disagrees with the roster. Nobody files "the chart looks slightly
  // wrong". So both readers run on identical input and must agree.
  const codes = REAL.map(o => o.orgCode);
  const rows = codes.map((c, i) => posRow({
    Position_Number: 'Q' + i, Employee_Name: 'Person ' + i,
    Email_Address: 'p' + i + '@example.gov', Org_Code: c,
    Office_Title: 'Title ' + i, Grade: i % 2 ? 7 : 15,
    Occupancy_Status: 'FILLED', Is_Active: true,
    Duty_Station_City: 'Washington', Duty_Station_State: 'DC'
  }));

  const oc = loadOC(rows, REAL_ORG_ROWS);
  const lets = loadLETS(rows, REAL_ORG_ROWS);

  // 6a — the normalizers agree. These encode defects found the hard way, and
  // a difference in any of them is a real divergence between two readers of
  // one table.
  const gradeCases = [7, '7', 15, '15', 'SES', '', 'WG-10', 0];
  const gradeDiffs = gradeCases.filter(g =>
    oc.run('HCRead._grade(' + JSON.stringify(g) + ')') !== lets.HC_grade_probe_unavailable);
  ok('grade padding is testable on both sides',
     typeof oc.run('HCRead._grade(7)') === 'string');
  ok('grade 7 pads to "07" here', oc.run('HCRead._grade(7)') === '07');
  ok('and LETS does the same', lets._grade(7) === '07');
  gradeCases.forEach(g => {
    const a = oc.run('HCRead._grade(' + JSON.stringify(g) + ')');
    const b = lets._grade(g);
    if (a !== b) gradeDiffs.push(g + ': oc=' + a + ' lets=' + b);
  });
  ok('grade normalization agrees on every case',
     gradeCases.every(g => oc.run('HCRead._grade(' + JSON.stringify(g) + ')') === lets._grade(g)),
     gradeCases.map(g => g + ': ' + oc.run('HCRead._grade(' + JSON.stringify(g) + ')') +
                         ' vs ' + lets._grade(g)));

  // 6b — org resolution agrees on all 137. This is the load-bearing one:
  // identity resolves DOWN to the most specific row, attribution resolves UP
  // to the nearest ancestor that has a value, and getting either backward is
  // invisible in the UI.
  const letsBundle = lets.hcGetBundle();
  ok('LETS reads the same sheet successfully', letsBundle.success === true);

  const letsByPn = {};
  letsBundle.data.forEach(p => { letsByPn[p.positionNumber] = p; });

  const ocTree = oc.run('HCRead.buildTree()');
  ok('this reader builds', ocTree.success === true, ocTree.error);
  ok('both see the same number of people',
     ocTree.count === letsBundle.data.length,
     'oc=' + ocTree.count + ' lets=' + letsBundle.data.length);

  // Flatten this project's tree back to a code -> label map.
  const flat = {};
  (function walk(nodes) {
    nodes.forEach(n => { flat[n.orgCode] = n; walk(n.children || []); });
  })(ocTree.roots);

  const budgetDiffs = [];
  const nameDiffs = [];
  codes.forEach(c => {
    const mine = oc.run('HCRead.inheritOrgField(' + JSON.stringify(c) + ',' +
                        JSON.stringify(byCodeFor(REAL)) + ",'officeCode')");
    const theirs = letsOfficeCodeFor(letsBundle.data, c);
    if (mine !== theirs) budgetDiffs.push(c + ': oc=' + mine + ' lets=' + theirs);

    const myLabel = flat[c] ? flat[c].org : '(missing)';
    const theirDivision = letsDivisionFor(letsBundle.data, c);
    if (theirDivision && myLabel !== theirDivision) {
      nameDiffs.push(c + ': oc=' + myLabel + ' lets=' + theirDivision);
    }
  });
  ok('budget key agrees on all 137 codes', budgetDiffs.length === 0, budgetDiffs.slice(0, 4));
  ok('org name agrees on all 137 codes', nameDiffs.length === 0, nameDiffs.slice(0, 4));

  function byCodeFor(real) {
    const m = {};
    real.forEach(o => { m[o.orgCode] = o; });
    return m;
  }
  function letsOfficeCodeFor(positions, code) {
    const p = positions.find(x => x.orgCode === code);
    return p ? (p.org.officeCode || '') : '';
  }
  function letsDivisionFor(positions, code) {
    const p = positions.find(x => x.orgCode === code);
    return p ? (p.org.division || '') : '';
  }
}

// ---------------------------------------------------------------------------
console.log('\n7. caching helps and cannot hurt');
{
  const ORGS = [orgRow({ Org_Code: 'FC', Division: 'ASD', Is_Active: true })];
  const rows = [posRow({ Position_Number: 'P1', Employee_Name: 'Solo', Grade: 15 })];

  const t = loadOC(rows, ORGS);
  const first = t.run('HCRead.getTree(false)');
  const readsAfterFirst = t.readCount();
  const second = t.run('HCRead.getTree(false)');

  ok('first call is not cached', first.cached === false);
  ok('second call is cached', second.cached === true);
  ok('and does not re-read the sheet', t.readCount() === readsAfterFirst,
     'reads went from ' + readsAfterFirst + ' to ' + t.readCount());
  ok('the cached tree is identical',
     JSON.stringify(second.roots) === JSON.stringify(first.roots));

  const bypassed = t.run('HCRead.getTree(true)');
  ok('bypass re-reads', t.readCount() > readsAfterFirst);
  ok('and reports itself as fresh', bypassed.cached === false);

  // A failure must NOT be cached, or a fixed property keeps failing for an
  // hour afterward.
  const broken = loadOC([], [], { noId: true });
  broken.run('HCRead.getTree(false)');
  ok('a failure is not written to the cache',
     Object.keys(broken.cacheStore).length === 0, Object.keys(broken.cacheStore));

  // CacheService caps an entry at 100KB and put() THROWS rather than
  // degrading. A tree too large to cache must still render.
  const tooBig = loadOC(rows, ORGS, { cachePutThrows: true });
  const big = tooBig.run('HCRead.getTree(false)');
  ok('a tree too large to cache still builds', big.success === true, big.error);
  ok('and says so in the log',
     tooBig.logs.some(l => /too large to cache/.test(l)), tooBig.logs);
}

// ---------------------------------------------------------------------------
console.log('\n8. negative controls (the suite must be able to fail)');
{
  const ORGS = [orgRow({ Org_Code: 'FC', Office_Code: 'FO', Business_Unit: 'Front Office',
                         Division: 'ASD', Is_Active: true }),
                orgRow({ Org_Code: 'FCA', Office_Code: 'OMD', Division: 'OMD office',
                         Is_Active: true }),
                orgRow({ Org_Code: 'FCA0A', Division: 'Portfolio Management', Is_Active: true })];

  // 8a — remove the vacant-seat walk: the person below must become a false root.
  const src = fs.readFileSync(path.join(OC, '20_data', 'HCRead.js'), 'utf8');
  const noWalk = src.replace(
    'cursor = pos.reportsToPositionNumber;       // vacant: keep climbing',
    'return null;'
  );
  ok('negative control patched the reparenting walk', noWalk !== src);
  {
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN,
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'FAKE_ID' }) },
      SpreadsheetApp: {
        openById: () => ({
          getSheetByName: n => {
            const hdr = n === 'HC_Positions' ? POS_HEADERS : ORG_HEADERS;
            const data = n === 'HC_Positions' ? [
              posRow({ Position_Number: 'P1', Employee_Name: 'Top', Grade: 'SES' }),
              posRow({ Position_Number: 'P2', Employee_Name: '',
                       Reports_To_Position_Number: 'P1', Occupancy_Status: 'VACANT' }),
              posRow({ Position_Number: 'P3', Employee_Name: 'Deep',
                       Reports_To_Position_Number: 'P2', Grade: 13 })
            ] : ORGS;
            const values = [hdr].concat(data);
            return {
              getLastRow: () => values.length,
              getLastColumn: () => hdr.length,
              getRange: (r1, c1, nr, nc) => ({
                getValues: () => values.slice(r1 - 1, r1 - 1 + nr).map(r => r.slice(c1 - 1, c1 - 1 + nc))
              })
            };
          }
        })
      },
      CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, removeAll: () => {} }) }
    });
    vm.runInContext(fs.readFileSync(path.join(OC, '00_config', 'Config.js'), 'utf8'), ctx);
    vm.runInContext(noWalk, ctx, { filename: 'HCRead.js (no walk)' });
    const t = vm.runInContext('HCRead.buildTree()', ctx);
    ok('without the walk, the person below a vacancy becomes a false root',
       t.roots.length === 2,
       'got ' + t.roots.length + ' roots — section 3 would not be exercising the bug');
  }

  // 8c — remove the detached-cycle reachability pass. Both members of a
  // staffed ring must vanish, or section 3 is not exercising the bug this
  // suite found.
  const noReach = src.replace(/    var reachable = \{\};[\s\S]*?\}\)\(\[node\]\);\n    \}\);\n/,
                              '');
  ok('negative control patched the reachability pass', noReach !== src);
  {
    const rows = [
      posRow({ Position_Number: 'C1', Employee_Name: 'Ring A',
               Reports_To_Position_Number: 'C2', Grade: 14 }),
      posRow({ Position_Number: 'C2', Employee_Name: 'Ring B',
               Reports_To_Position_Number: 'C1', Grade: 14 }),
      posRow({ Position_Number: 'P9', Employee_Name: 'Fine', Grade: 15 })
    ];
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN,
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'FAKE_ID' }) },
      SpreadsheetApp: {
        openById: () => ({
          getSheetByName: n => {
            const hdr = n === 'HC_Positions' ? POS_HEADERS : ORG_HEADERS;
            const data = n === 'HC_Positions' ? rows : ORGS;
            const values = [hdr].concat(data);
            return {
              getLastRow: () => values.length,
              getLastColumn: () => hdr.length,
              getRange: (r1, c1, nr, nc) => ({
                getValues: () => values.slice(r1 - 1, r1 - 1 + nr).map(r => r.slice(c1 - 1, c1 - 1 + nc))
              })
            };
          }
        })
      },
      CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, removeAll: () => {} }) }
    });
    vm.runInContext(fs.readFileSync(path.join(OC, '00_config', 'Config.js'), 'utf8'), ctx);
    vm.runInContext(noReach, ctx, { filename: 'HCRead.js (no reachability)' });
    const t = vm.runInContext('HCRead.buildTree()', ctx);
    ok('without it, a staffed ring silently drops both people',
       countNodes(t.roots) === 1 && t.count === 3,
       'tree=' + countNodes(t.roots) + ' count=' + t.count +
       ' — section 3 would not be exercising the bug');
  }

  // 8b — take the budget key from the exact row instead of inheriting it.
  // This is the trap: FCA0A's own row has a BLANK Office_Code, so an exact
  // match returns '' and the symptom is identical to the original defect.
  const noInherit = src.replace(
    "positions[p].org.officeCode   = inheritOrgField(code, byCode, 'officeCode');",
    "positions[p].org.officeCode   = (org.officeCode || '');"
  );
  // That line lives in LETS, not here — this project reads officeCode only
  // through inheritOrgField, so assert the direct-read pattern is ABSENT.
  ok('this reader never takes officeCode from the exact row',
     !/org\.officeCode\s*\|\|\s*''/.test(src),
     'reading it directly returns blank for all 133 sub-orgs');
  ok('it goes through inheritOrgField', /inheritOrgField\(/.test(src));
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
