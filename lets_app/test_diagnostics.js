/**
 * Automated Verification Script for the diagnostics file.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Diagnostics.js is run BY HAND from the Apps Script editor, against live
 * environments including production. Two properties therefore matter more than
 * anything it reports:
 *
 *   1. It must never WRITE. Section 1 greps for every mutating Apps Script
 *      call. A diagnostic that mutates state is one you cannot safely run in
 *      production, and the temptation to add "just a quick fix" to a file like
 *      this is exactly what the check exists to prevent.
 *
 *   2. It must never THROW. A health check that crashes on an unhealthy system
 *      is useless — that is precisely when it is needed. Section 4 runs the
 *      whole suite against an environment where the Script Properties are
 *      unset, SpreadsheetApp.openById throws, and there is no active user.
 *
 * Section 2 also asserts every function returns `undefined`. Apps Script makes
 * every top-level function browser-callable (docs/GAP_REGISTER.md G-001), so
 * these six are reachable. Logging rather than returning means a browser
 * caller gets nothing while a developer in the editor gets the full picture.
 * Returning structured data would make them genuinely useful to an attacker.
 *
 * Section 3 covers diagAccess, the one function that enumerates people. It is
 * admin-guarded, and the test asserts it refuses a non-admin WITHOUT calling
 * getAccessInventory at all — the stub throws if reached.
 *
 * This is a smoke test, not a correctness suite for the subsystems being
 * reported on. Those have their own suites: test_city_pairs.js,
 * test_hc_data.js, test_airport_prefs.js, test_access_audit.js.
 *
 * Run: node lets_app/test_diagnostics.js
 */

// Smoke-test the diagnostics against stubbed GAS services. Not a correctness
// suite for the things it REPORTS on — those have their own suites. This
// checks the diagnostics themselves cannot throw and cannot write.
const fs=require('fs'),vm=require('vm');
const SRC='lets_app/server/99_triggers/Diagnostics.js';
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x));fails++;}};

console.log('1. no write operations anywhere in the file');
{
  const src=fs.readFileSync(SRC,'utf8');

  // A diagnostic that mutates state is a diagnostic you cannot safely run in
  // production. Enforced by inspection because the file is run by hand.
  //
  // THE `run…` WRAPPERS AT THE FOOT OF THE FILE ARE EXCLUDED, and the
  // exclusion is deliberately surgical rather than a relaxed rule.
  //
  // @clolry asked for wrappers here because importRoster(token) and
  // releaseSetAside(entry) cannot be run from the Apps Script dropdown at all
  // — the Run button passes no arguments — and a wrapper pasted into the
  // editor is deleted by the next `clasp push --force`. This file's own header
  // records that happening three times during the City Pair work.
  //
  // Two of those wrappers DO write. They add no new authority: each calls a
  // function that already checks isTravelAdmin and takes its own lock, so a
  // wrapper cannot do anything its target would refuse. What matters is that
  // the diagnostics ABOVE them stay read-only, which is what this checks.
  const runnersAt = src.indexOf('// EDITOR RUNNERS');
  ok('the editor-runner section exists and is at the end', runnersAt > 0,
     runnersAt);
  const diagnosticsOnly = src.slice(0, runnersAt);

  ['setValue','setValues','appendRow','deleteRow','insertSheet','clearContent',
   'setProperty','deleteProperty','removeAll','createTrigger'].forEach(w=>{
    ok('no '+w+' in the diagnostics', diagnosticsOnly.indexOf(w+'(')===-1);
  });

  // The wrappers must not grow their own logic. A wrapper that opens a
  // spreadsheet or writes a cell directly would be a write in Diagnostics.js
  // with none of the guards its targets carry — the thing the rule above
  // exists to prevent, reintroduced through the exception.
  const runners = src.slice(runnersAt);
  ['SpreadsheetApp','setValue','appendRow','clearContent','setProperty',
   'createTrigger','LockService'].forEach(w=>{
    ok('the wrappers do not call '+w+' themselves', runners.indexOf(w)===-1,
       'a wrapper must delegate, never write');
  });

  // Every wrapper must call a function that is admin-guarded. Listed
  // explicitly rather than inferred, so adding a wrapper for an unguarded
  // function fails here.
  // Each of these checks isTravelAdmin (via _hcAdminGuard_ or directly) and,
  // where it writes, takes the script lock. A wrapper can therefore do
  // nothing its target would refuse. ADDING TO THIS LIST IS A DECISION:
  // confirm the new target guards itself before doing it, because a wrapper
  // makes a function one click away in the editor.
  const GUARDED_TARGETS = ['previewRosterImport','importRoster',
    'previewDirectoryEmails','resolveDirectoryEmails','getBudgetDashboard',
    'clearHCPositions','getEmailResolutionQueue','saveEmailOverride'];
  const runnerNames=(runners.match(/^function (run\w+)\(/gm)||[])
    .map(l=>l.replace(/^function /,'').replace(/\($/,''));
  ok('there are wrappers', runnerNames.length>=5, runnerNames);
  runnerNames.forEach(fn=>{
    const body=runners.slice(runners.indexOf('function '+fn+'('));
    const end=body.indexOf('\n}');
    const calls=GUARDED_TARGETS.filter(t=>body.slice(0,end).indexOf(t+'(')>-1);
    ok(fn+' delegates to a guarded function', calls.length>0, fn);
  });

  // The two that write must be named run…, never diag…, so the file's own
  // index and the generated docs cannot describe them as safe.
  //
  // Checked by SLICING each diag… function's own body, not with a lookahead
  // over the whole file. My first version used
  // /function diag\w+\(\)[\s\S]{0,4000}?(importRoster|...)/ which matched
  // across function boundaries — the last diag… function is within 4,000
  // characters of the runners below it, so it failed on code that is correct.
  // A character-window regex cannot express "inside this function".
  const WRITERS = ['importRoster', 'resolveDirectoryEmails', 'releaseSetAside',
                   'clearHCPositions', 'saveEmailOverride'];
  const diagNames = (src.match(/^function (diag\w+)\(/gm) || [])
    .map(l => l.replace(/^function /, '').replace(/\($/, ''));
  ok('there are diagnostics to check', diagNames.length >= 8, diagNames.length);
  diagNames.forEach(fn => {
    const start = src.indexOf('function ' + fn + '(');
    // Top-level functions in this file close on a column-zero brace.
    const end = src.indexOf('\n}', start);
    const body = src.slice(start, end === -1 ? src.length : end);
    const bad = WRITERS.filter(w => body.indexOf(w + '(') > -1);
    ok(fn + ' calls nothing that writes', bad.length === 0, bad);
  });
}

console.log('2. every diag function is reachable and returns nothing');
{
  const logs=[];
  const sb={console:{log:m=>logs.push(String(m)),warn:()=>{},error:()=>{}},
    JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
    SpreadsheetApp:{openById:()=>({getName:()=>'Sandbox DB',
      getSheets:()=>[{getName:()=>'Requests'},{getName:()=>'City_Pairs'}],
      getSheetByName:n=>({getLastRow:()=>1,getLastColumn:()=>17,
        getRange:()=>({getValues:()=>[[]]})})})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>
      k==='LETS_ENV'?'development':k==='TRAVEL_DB_SPREADSHEET_ID'?'1AAAAAAAAAAAAAAAAAAAA':null})},
    CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
    ScriptApp:{getProjectTriggers:()=>[]},
    Session:{getActiveUser:()=>({getEmail:()=>'chris@gsa.gov'})}};
  const ctx=vm.createContext(sb);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='1AAAAAAAAAAAAAAAAAAAA'; var LETS_ENV='development';",ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Cache.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),ctx);
  // Minimal stubs for the services the diagnostics read from.
  vm.runInContext(`
    var AIRPORT_PREF_PROMOTION_THRESHOLD=2;
    var HC={hcGetBundle:()=>({success:true,count:0,data:[],lastRefreshed:'',cached:false}),
            hcGetOrgHierarchy:()=>[],hcFindDivisionDirector:()=>({ddName:'',ddEmail:''})};
    function validateHCData(){return {success:true,problems:[]};}
    function getCityPairFare(){return {success:true,found:false};}
    function getAirportsForCity(){return {success:true,airports:[{code:'DCA',isMetroArea:false}]};}
    function isTravelAdmin(){return true;}
    function getBrandingForClient(){return {appName:'LETS',orgShort:'ASD',
      orgLong:'ACQUISITION SOLUTIONS DEVELOPMENT',foLabel:'ASD Travel & Events',
      sectorLabel:'SCD',buLabel:'DAC',contactEmail:'ASD.Travel-Events@gsa.gov',
      senderName:'ASD Travel & Events'};}
    function getEmailRoutingStatus(){return {environment:'development',isProduction:false,
      willRedirect:true,redirectTo:'t@gsa.gov',blocked:false,reason:null,
      testSubmitterSuppression:false};}
    function getAccessInventory(){return {success:true,hcDerivedEnabled:true,
      roleHolders:[],hcSupervisors:[],buLeads:[]};}
    var FASTrackerSync={
      getEnvironment:()=>'development',
      FAS_PORTFOLIO_CODE:'FC - Office of Acquisition Solutions Development (CREATE)',
      FAS_TRACKER_COLUMNS:['Timestamp','Portfolio','Status:'],
      FAS_TRACKER_READONLY_COLUMNS:['Status:'],
      validateForFASTracker:()=>({valid:true,missing:[]}),
      buildFASTrackerRow:()=>['11/01/2026','FC',''] };
  `,ctx);
  vm.runInContext(fs.readFileSync(SRC,'utf8'),ctx,{filename:'Diagnostics.js'});

  ['diagEnvironment','diagCityPairs','diagHcData','diagAirportPrefs','diagTriggers',
   'diagDutyStationAirports','diagUnresolvedCityNames','diagTripOverviewFields',
   'diagFasTrackerRow','diagAccess','diagAll']
    .forEach(fn=>{
      let threw=null,ret;
      try{ ret=vm.runInContext(fn+'()',ctx); }catch(e){ threw=e; }
      ok(fn+' does not throw', threw===null, threw&&threw.message);
      // Returning data would make these genuinely useful to a browser caller.
      ok(fn+' returns undefined', ret===undefined, ret);
    });
  ok('produced log output', logs.length>10, logs.length);

  // Takes an argument, so it is excluded from diagAll and tested separately.
  let threw2=null, ret2;
  try{ ret2=vm.runInContext("diagCityNamesForState('TX')",ctx); }catch(e){ threw2=e; }
  ok('diagCityNamesForState does not throw', threw2===null, threw2&&threw2.message);
  ok('diagCityNamesForState returns undefined', ret2===undefined, ret2);
  let threw3=null;
  try{ vm.runInContext("diagCityNamesForState()",ctx); }catch(e){ threw3=e; }
  ok('diagCityNamesForState survives a missing argument', threw3===null, threw3&&threw3.message);
}

console.log('2b. every diagAll member takes ZERO arguments');
{
  // The Apps Script editor cannot pass arguments: the Run button always calls
  // with none. A diagnostic that requires a parameter is therefore unrunnable
  // from the editor, which is the whole point of this file. diagAll must only
  // call zero-arity functions.
  const src=fs.readFileSync(SRC,'utf8');
  const called=(src.match(/^  diag\w+\(\);$/gm)||[]).map(l=>l.trim().replace('();',''));
  ok('diagAll calls several diagnostics', called.length>=6, called.length);
  called.forEach(fn=>{
    const m=src.match(new RegExp('function '+fn+'\\(([^)]*)\\)'));
    ok(fn+' takes no arguments', m && m[1].trim()==='', m&&m[1]);
  });
}

console.log('3. diagAccess refuses a non-admin');
{
  const logs=[];
  const sb={console:{log:m=>logs.push(String(m)),warn:()=>{},error:()=>{}},
    JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>null})},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
    CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
    ScriptApp:{getProjectTriggers:()=>[]},
    Session:{getActiveUser:()=>({getEmail:()=>'nobody@gsa.gov'})}};
  const ctx=vm.createContext(sb);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID=null; var LETS_ENV='development';",ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Cache.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),ctx);
  vm.runInContext(`var AIRPORT_PREF_PROMOTION_THRESHOLD=2;
    function isTravelAdmin(){return false;}
    function getEmailRoutingStatus(){throw new Error('config not loaded');}
    function getEmailRoutingStatus(){return {environment:'development',blocked:true,
      reason:'no redirect',willRedirect:false,testSubmitterSuppression:false};}
    function getAccessInventory(){throw new Error('must not be reached');}`,ctx);
  vm.runInContext(fs.readFileSync(SRC,'utf8'),ctx);
  let threw=null;
  try{ vm.runInContext('diagAccess()',ctx); }catch(e){ threw=e; }
  ok('does not throw', threw===null, threw&&threw.message);
  ok('refuses and says so', logs.join('\n').indexOf('Refused')>-1, logs.slice(-3));
  ok('never calls getAccessInventory', logs.join('\n').indexOf('must not be reached')===-1);
}

console.log('4. survives a completely unconfigured environment');
{
  const logs=[];
  const sb={console:{log:m=>logs.push(String(m)),warn:()=>{},error:()=>{}},
    JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
    SpreadsheetApp:{openById:()=>{throw new Error('no such spreadsheet');}},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
    CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
    ScriptApp:{getProjectTriggers:()=>{throw new Error('no access');}},
    Session:{getActiveUser:()=>({getEmail:()=>''})}};
  const ctx=vm.createContext(sb);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID=null; var LETS_ENV='development';",ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Cache.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),ctx);
  vm.runInContext(`var AIRPORT_PREF_PROMOTION_THRESHOLD=2;
    var HC={hcGetBundle:()=>({success:false,error:'no tabs',count:0,data:[]}),
            hcGetOrgHierarchy:()=>[]};
    function validateHCData(){return {success:false,problems:[]};}
    function isTravelAdmin(){return false;}`,ctx);
  vm.runInContext(fs.readFileSync(SRC,'utf8'),ctx);
  let threw=null;
  try{ vm.runInContext('diagAll()',ctx); }catch(e){ threw=e; }
  // A health check that crashes on an unhealthy system is useless.
  ok('diagAll survives an unconfigured env', threw===null, threw&&threw.message);
  ok('reports the unset DB id', logs.join('\n').indexOf('[UNSET]')>-1);
}

console.log('5. property values are not dumped into the log');
{
  const src=fs.readFileSync(SRC,'utf8');
  // Only short, non-sensitive config values are printed verbatim; keys and
  // base64 blobs report presence and length only, so a pasted log cannot leak
  // them.
  ok('GSA key printed as presence only',
     /GSA_PERDIEM_API_KEY/.test(src) && src.indexOf("'[set, '")>-1);
  ok('db id truncated', src.indexOf('dbId.substring(0, 12)')>-1);
}

console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
