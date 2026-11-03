/**
 * Automated Verification Script for the HR PII boundary
 * (30_services/HCPrivacy.js and the entry points it guards).
 *
 * WHY THIS EXISTS
 * ---------------
 * @clolry: "I need for you to ensure that the PII information in the HR
 * database is properly secured and restricted to comply with IT security
 * requirements for PII."
 *
 * THE EXPOSURE THAT WAS MEASURED
 * ------------------------------
 * Apps Script makes every top-level function callable from any authenticated
 * browser — finding G-001. Executed against a stub roster BEFORE this work,
 * `getHCStaffingBundle()` returned, per person, with no role required:
 *
 *   employeeId        0010042
 *   employeeName      Ada Lovelace
 *   emailAddress      ada.lovelace@gsa.gov
 *   grade             14
 *   location.address1 1800 F Street NW
 *   lcat              Analyst
 *
 * That is ~1100 records once the FAS feed lands, and name + grade is
 * effectively salary disclosure.
 *
 * WHAT THIS SUITE PROTECTS
 * ------------------------
 * §2 is an ALLOW-LIST test, not a deny-list test. A deny-list passes the
 * moment someone adds a field to HC_Positions — the leak would be silent and
 * the test green. §2 asserts the exact field set instead, so a new field is a
 * test failure until someone decides it is safe.
 *
 * Run: node lets_app/test_hc_privacy.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 280)); fails++; }
};

/** A full HC record as HCData normalizes it — every field, nothing withheld. */
const FULL = {
  positionNumber: 'FCA-0001',
  reportsToPositionNumber: 'FC-0001',
  employeeId: '0010042',
  employeeName: 'Ada Lovelace',
  emailAddress: 'ada.lovelace@gsa.gov',
  orgCode: 'FCA0A',
  officeTitle: 'Program Manager',
  grade: '14',
  supervisoryStatus: '2',
  occupancyStatus: 'FILLED',
  lcat: 'Analyst',
  locationCode: 'DC-CENTRAL',
  org: { businessUnit: 'OMD', sector: 'ASD', division: 'OMD office',
         officeCode: 'OMD', resolvedOrgCode: 'FCA' },
  location: { address1: '1800 F Street NW', city: 'Washington', state: 'DC' }
};

/**
 * Loads HCPrivacy with a stubbed role resolver.
 * @param {string} role 'none' | 'reviewer' | 'admin'
 */
function load(role, email) {
  const logs = [];
  const ctx = vm.createContext({
    console: { log: m => logs.push(String(m)), warn: m => logs.push(String(m)),
               error: m => logs.push(String(m)) },
    JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
    parseInt, parseFloat, isNaN
  });
  vm.runInContext(`
    var __ROLE = ${JSON.stringify(role)};
    function isTravelAdmin() { return __ROLE === 'admin'; }
    function _getUnifiedRolesForEmail() {
      return __ROLE === 'reviewer' ? [{ roleType: 'bu_reviewer' }] : [];
    }
    var Session = { getActiveUser: function () {
      return { getEmail: function () { return ${JSON.stringify(email === undefined ? 'u@gsa.gov' : email)}; } };
    } };
    var __ROWS = [];
    function TravelDB() {
      this.sheet = function () { return {}; };
      this.appendRow = function (n, r) { __ROWS.push({ sheet: n, row: r }); };
    }
    var SHEET_NAMES = { ACCESS_LOG: 'Access_Log' };
    var TRAVEL_SHEET_SCHEMAS = { 'Access_Log': ['Log_ID','Timestamp','Email',
      'Decision','Path','Position_Number','Office_Title','Org_Code','Detail'] };
  `, ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/30_services/HCPrivacy.js', 'utf8'),
                  ctx, { filename: 'HCPrivacy.js' });
  return { ctx, logs, run: e => vm.runInContext(e, ctx) };
}

const sanitize = (role, rec) => {
  const t = load(role);
  const tier = t.run('hcCallerTier()').tier;
  return t.run('hcSanitizeRecord(' + JSON.stringify(rec || FULL) + ',' +
               JSON.stringify(tier) + ')');
};

console.log('--- HC PII boundary test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. the tier is DERIVED from roles, never supplied');
{
  // A tier parameter would be the first thing an attacker set, and the first
  // thing a careless caller got wrong.
  ok('no role -> public', load('none').run('hcCallerTier()').tier === 'public');
  ok('reviewer role -> reviewer', load('reviewer').run('hcCallerTier()').tier === 'reviewer');
  ok('admin role -> admin', load('admin').run('hcCallerTier()').tier === 'admin');

  // An unidentifiable user gets the NARROWEST tier, not an error. Apps Script
  // can return an empty email for a legitimately signed-in user in some
  // deployment configurations, and failing closed on data the travel form
  // needs would break submission for everyone.
  const anon = load('admin', '');
  ok('an empty email falls back to public, not admin',
     anon.run('hcCallerTier()').tier === 'public',
     'failing OPEN here would hand the roster to an unauthenticated caller');

  // A role lookup that throws must not escalate.
  const broken = load('none');
  broken.run('_getUnifiedRolesForEmail = function () { throw new Error("db down"); }');
  ok('a failing role lookup degrades to public',
     broken.run('hcCallerTier()').tier === 'public');
  ok('and logs why', broken.logs.some(l => /reviewer check failed/.test(l)));

  const brokenAdmin = load('none');
  brokenAdmin.run('isTravelAdmin = function () { throw new Error("db down"); }');
  ok('a failing admin check degrades to public',
     brokenAdmin.run('hcCallerTier()').tier === 'public');
}

// ---------------------------------------------------------------------------
console.log('\n2. the field set is an ALLOW-LIST, asserted exactly');
{
  // THE HIGHEST-VALUE SECTION.
  //
  // A deny-list test ("employeeId must be absent") passes the moment someone
  // adds Home_Address to HC_Positions — the new field flows straight through
  // and the test stays green. Asserting the EXACT set means a new field fails
  // this test until somebody decides it is safe to expose.
  const PUBLIC_EXPECTED = ['positionNumber', 'reportsToPositionNumber',
    'employeeName', 'orgCode', 'officeTitle', 'occupancyStatus',
    'supervisoryStatus', 'org', 'location', '_piiTier'];
  const pub = sanitize('none');
  ok('public tier returns exactly the expected fields',
     Object.keys(pub).sort().join(',') === PUBLIC_EXPECTED.slice().sort().join(','),
     Object.keys(pub).sort());

  const REVIEWER_EXPECTED = PUBLIC_EXPECTED.concat(['emailAddress']);
  const rev = sanitize('reviewer');
  ok('reviewer tier adds emailAddress and nothing else',
     Object.keys(rev).sort().join(',') === REVIEWER_EXPECTED.slice().sort().join(','),
     Object.keys(rev).sort());

  // Each withheld field, named individually with its reason, so a future
  // reader cannot mistake the omission for an oversight.
  ok('employeeId is withheld below admin', !('employeeId' in pub) && !('employeeId' in rev),
     'it joins to payroll and HR systems this app does not own');
  ok('grade is withheld below admin', !('grade' in pub) && !('grade' in rev),
     'name + grade is salary disclosure');
  ok('lcat is withheld below admin', !('lcat' in pub) && !('lcat' in rev),
     'it implies employment status, federal vs contractor');
  ok('locationCode is withheld below admin',
     !('locationCode' in pub) && !('locationCode' in rev));
  ok('the duty-station STREET ADDRESS is withheld',
     !pub.location.address1 && !rev.location.address1,
     'a physical location for a named individual; city and state suffice');
  ok('but city and state survive, because travel needs them',
     pub.location.city === 'Washington' && pub.location.state === 'DC');
  ok('emailAddress is withheld at PUBLIC tier', !('emailAddress' in pub));
  ok('and present at reviewer tier, who must contact travellers',
     rev.emailAddress === 'ada.lovelace@gsa.gov');

  // Admin gets the record untouched — the roster editor has to edit it.
  const adm = sanitize('admin');
  ok('admin receives the record unchanged',
     JSON.stringify(adm) === JSON.stringify(FULL));

  // THE ALLOW-LIST PROOF. A field nobody has classified must not appear.
  const withNewField = Object.assign({}, FULL, {
    homeAddress: '42 Private Road',
    ssnLast4: '1234',
    dateOfBirth: '1815-12-10'
  });
  const sanitized = sanitize('none', withNewField);
  ok('a NEW unclassified field does not leak',
     !('homeAddress' in sanitized) && !('ssnLast4' in sanitized) &&
     !('dateOfBirth' in sanitized),
     'this is what an allow-list buys: silence by default');
  ok('and the public field set is unchanged by its presence',
     Object.keys(sanitized).sort().join(',') === PUBLIC_EXPECTED.slice().sort().join(','));
}

// ---------------------------------------------------------------------------
console.log('\n3. the payload says a field was WITHHELD, not that it is empty');
{
  // Same distinction as zero-versus-unknown in the event history. A consumer
  // that cannot tell "no email on file" from "not allowed to see the email"
  // will display the wrong thing, or worse, conclude the data is missing and
  // try to re-enter it.
  const pub = sanitize('none');
  ok('the record carries its tier', pub._piiTier === 'public');
  ok('reviewer records too', sanitize('reviewer')._piiTier === 'reviewer');

  const t = load('none');
  const bundle = t.run('hcSanitizeBundle(' + JSON.stringify({
    success: true, data: [FULL], orgs: [{ orgCode: 'FCA' }]
  }) + ')');
  ok('the bundle carries its tier', bundle._piiTier === 'public');
  ok('and names what was withheld', /employeeId/.test(bundle._piiNote) &&
     /grade/.test(bundle._piiNote), bundle._piiNote);
  ok('including the email at public tier',
     /emailAddress/.test(bundle._piiNote), bundle._piiNote);
  ok('and the street address', /street address/.test(bundle._piiNote));

  // Org records are not personal and must survive intact, or every consumer
  // loses its attribution.
  ok('org records pass through untouched',
     bundle.orgs.length === 1 && bundle.orgs[0].orgCode === 'FCA');

  const adminBundle = load('admin').run('hcSanitizeBundle(' + JSON.stringify({
    success: true, data: [FULL], orgs: []
  }) + ')');
  ok('an admin bundle is returned unchanged, with no tier noise',
     adminBundle._piiNote === undefined && adminBundle.data[0].grade === '14');

  // A failed bundle must pass straight through rather than being rewritten
  // into a success-shaped object with no data.
  const failed = load('none').run("hcSanitizeBundle({success:false,error:'boom'})");
  ok('a failed bundle is not reshaped', failed.success === false && failed.error === 'boom');
  ok('null is handled', load('none').run('hcSanitizeBundle(null)') === null);
  ok('a null record is handled', load('none').run("hcSanitizeRecord(null,'public')") === null);
}

// ---------------------------------------------------------------------------
console.log('\n4. the entry points apply the boundary');
{
  // The boundary is worthless if the functions that serve HC data do not call
  // it. Asserted against the SOURCE, because these functions need the whole
  // Apps Script runtime to execute.
  const staffing = fs.readFileSync('lets_app/server/30_services/HCStaffing.js', 'utf8');
  ok('getHCStaffingBundle sanitizes', /hcSanitizeBundle\(bundle\)/.test(staffing));
  ok('and logs an admin-tier read', /hcLogPiiAccess\('getHCStaffingBundle'/.test(staffing));

  const req = fs.readFileSync('lets_app/server/40_domain/Request.js', 'utf8');
  ok('getTravelFormStaffing resolves a tier', /hcCallerTier\(\)\.tier/.test(req));
  // Resolved ONCE outside the loop: per-person role lookups would be ~1100
  // reads per page load.
  ok('and resolves it outside the per-person loop',
     req.indexOf('_formStaffingTier = hcCallerTier()') <
     req.indexOf('for (var j = 0; j < bundle.data.length'), 'performance, not style');
  ok('the form payload withholds employeeId below admin',
     /if \(_formStaffingTier === 'admin'\)[\s\S]{0,200}emp\.employeeId/.test(req));
  ok('and withholds the street address',
     /if \(_formStaffingTier === 'admin'\)[\s\S]{0,300}emp\.dutyStationAddress/.test(req));
  // Grade was never in this payload. Asserting its absence stops it being
  // added by someone wiring up a new column.
  ok('grade is not in the form payload at all', !/emp\.grade|grade: pos\.grade/.test(req));

  // getSubmitterInfo takes an EMAIL parameter, so unrestricted it is a lookup
  // oracle over the whole roster.
  const db = fs.readFileSync('lets_app/server/91_setup/Database.js', 'utf8');
  ok('getSubmitterInfo refuses a cross-user lookup below reviewer',
     /refused cross-user lookup/.test(db));
  ok('and compares against the ACTIVE user, not a parameter',
     /Session\.getActiveUser\(\)[\s\S]{0,200}_self/.test(db));

  // simulateSubmissionRouting returns a person's whole reviewer chain.
  const sub = fs.readFileSync('lets_app/server/40_domain/Submission.js', 'utf8');
  ok('simulateSubmissionRouting is admin-gated',
     /simulateSubmissionRouting[\s\S]{0,900}refused non-admin caller/.test(sub));

  const diag = fs.readFileSync('lets_app/server/99_triggers/Diagnostics.js', 'utf8');
  ok('diagHcData is admin-gated',
     /function diagHcData[\s\S]{0,800}refused non-admin caller/.test(diag));
}

// ---------------------------------------------------------------------------
console.log('\n5. stripping employeeId did not break the traveller picker');
{
  // FOUND BY AUDITING WHAT THE SANITISER REMOVED, not by the form failing.
  //
  // The traveller autocomplete used employeeId as its option VALUE and
  // looked people up by it. Withholding the field alone would have made every
  // selection resolve to null — the picker would appear to work and select
  // nobody, for every non-admin user, which is almost all of them.
  const svc = fs.readFileSync('lets_app/client/shared/hcDataCenterService.html', 'utf8');

  ok('the picker value is now positionNumber',
     /value: p\.positionNumber \|\| p\.employeeId/.test(svc),
     'positionNumber is the primary key of HC_Positions and is not personal');
  ok('getEmployee accepts either key',
     /_employeeIndex\[k\] \|\| _positionIndex\[k\]/.test(svc));
  ok('and the details map is keyed by position number too',
     /for \(var pn in _positionIndex\)/.test(svc),
     'built from _employeeIndex alone it was empty for a non-admin');

  // The client script must still parse — a syntax error here takes the whole
  // request form down.
  const blocks = svc.match(/<script>([\s\S]*?)<\/script>/g) || [];
  ok('the service file has a script block', blocks.length > 0);
  let parsed = true;
  try {
    new vm.Script(blocks.map(b => b.replace(/<\/?script>/g, '')).join('\n'));
  } catch (e) { parsed = false; }
  ok('and it parses', parsed);
}

// ---------------------------------------------------------------------------
console.log('\n6. the audit trail records admin reads only');
{
  // A PII review wants to know who read what. But a public-tier read happens
  // on every page load for every user, and logging those would bury the
  // entries that matter under thousands that do not.
  const adm = load('admin');
  adm.run("hcLogPiiAccess('getHCStaffingBundle','admin',1100)");
  const rows = adm.run('__ROWS');
  ok('an admin read is logged', rows.length === 1, rows.length);
  ok('to Access_Log, reusing the existing audit table',
     rows[0] && rows[0].sheet === 'Access_Log');
  ok('with a PII_READ decision', rows[0].row.indexOf('PII_READ') > -1, rows[0].row);
  ok('the caller', rows[0].row.indexOf('u@gsa.gov') > -1);
  ok('and the record count', rows[0].row.some(c => /1100 full HC record/.test(String(c))),
     rows[0].row);
  // Column alignment: writes here are positional, so an invented column name
  // lands nowhere silently.
  ok('the row matches the Access_Log width', rows[0].row.length === 9, rows[0].row.length);

  const pub = load('none');
  pub.run("hcLogPiiAccess('getHCStaffingBundle','public',1100)");
  ok('a public read is NOT logged', pub.run('__ROWS').length === 0,
     'otherwise every page load buries the entries that matter');

  // An audit write that breaks the read it audits would be worse than a
  // missing log line.
  const noLog = load('admin');
  noLog.run('TravelDB = function () { throw new Error("no sheet"); }');
  let threw = false;
  try { noLog.run("hcLogPiiAccess('x','admin',1)"); } catch (e) { threw = true; }
  ok('a failing audit write does not throw', !threw);
  ok('and warns instead', noLog.logs.some(l => /could not write audit row/.test(l)));
}

// ---------------------------------------------------------------------------
console.log('\n7. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/30_services/HCPrivacy.js', 'utf8');

  // 7a — add employeeId to the public allow-list. §2 must fail.
  const leaky = src.replace("  'employeeName',\n  'orgCode',",
                            "  'employeeName',\n  'employeeId',\n  'orgCode',");
  ok('negative control patched the allow-list', leaky !== src);
  {
    const t = load('none');
    vm.runInContext(leaky, t.ctx, { filename: 'HCPrivacy.js (leaky)' });
    const out = t.run("hcSanitizeRecord(" + JSON.stringify(FULL) + ",'public')");
    ok('a patched build does leak employeeId', out.employeeId === '0010042',
       'so section 2 is exercising a real allow-list');
  }

  // 7b — fail OPEN when the user is unidentifiable. §1 must fail.
  const failOpen = src.replace(
    "  if (!who) return { tier: 'public', email: '', isAdmin: false };",
    "  if (!who) return { tier: 'admin', email: '', isAdmin: true };");
  ok('negative control patched the anonymous fallback', failOpen !== src);
  {
    const t = load('none', '');
    vm.runInContext(failOpen, t.ctx, { filename: 'HCPrivacy.js (fail open)' });
    ok('a patched build hands an anonymous caller admin tier',
       t.run('hcCallerTier()').tier === 'admin',
       'so section 1 is exercising a real fallback');
  }

  // 7c — build by deletion rather than from an allow-list. §2's new-field
  // assertion must fail.
  // Swap the allow-list construction for a deny-list. Anchored on a single
  // unique line rather than a multi-line regex — the regex was brittle and
  // silently matched nothing, which made the control itself a no-op.
  const ANCHOR = "  var allowed = HC_FIELDS_PUBLIC.slice();";
  ok('the allow-list anchor is present', src.indexOf(ANCHOR) > -1);
  const denyList = src.replace(ANCHOR,
    "  var out0 = {};\n" +
    "  Object.keys(rec).forEach(function (f) { out0[f] = rec[f]; });\n" +
    "  HC_FIELDS_ADMIN_ONLY.forEach(function (f) { delete out0[f]; });\n" +
    "  if (tier !== 'reviewer') { delete out0.emailAddress; }\n" +
    "  return out0;\n" +
    ANCHOR);
  ok('negative control patched in a deny-list', denyList !== src);
  {
    const t = load('none');
    vm.runInContext(denyList, t.ctx, { filename: 'HCPrivacy.js (deny-list)' });
    const withNew = Object.assign({}, FULL, { homeAddress: '42 Private Road' });
    const out = t.run("hcSanitizeRecord(" + JSON.stringify(withNew) + ",'public')");
    ok('a deny-list leaks a newly added field',
       out.homeAddress === '42 Private Road',
       'this is why the allow-list matters: a deny-list fails silently');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
