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
  ['setValue','setValues','appendRow','deleteRow','insertSheet','clearContent',
   'setProperty','deleteProperty','removeAll','createTrigger'].forEach(w=>{
    ok('no '+w, src.indexOf(w+'(')===-1);
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
    function getAirportsForCity(){return {success:true,airports:[]};}
    function isTravelAdmin(){return true;}
    function getAccessInventory(){return {success:true,hcDerivedEnabled:true,
      roleHolders:[],hcSupervisors:[],buLeads:[]};}
  `,ctx);
  vm.runInContext(fs.readFileSync(SRC,'utf8'),ctx,{filename:'Diagnostics.js'});

  ['diagEnvironment','diagCityPairs','diagHcData','diagAirportPrefs','diagAccess','diagAll']
    .forEach(fn=>{
      let threw=null,ret;
      try{ ret=vm.runInContext(fn+'()',ctx); }catch(e){ threw=e; }
      ok(fn+' does not throw', threw===null, threw&&threw.message);
      // Returning data would make these genuinely useful to a browser caller.
      ok(fn+' returns undefined', ret===undefined, ret);
    });
  ok('produced log output', logs.length>10, logs.length);
}

console.log('3. diagAccess refuses a non-admin');
{
  const logs=[];
  const sb={console:{log:m=>logs.push(String(m)),warn:()=>{},error:()=>{}},
    JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>null})},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
    CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
    Session:{getActiveUser:()=>({getEmail:()=>'nobody@gsa.gov'})}};
  const ctx=vm.createContext(sb);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID=null; var LETS_ENV='development';",ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Cache.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),ctx);
  vm.runInContext(`var AIRPORT_PREF_PROMOTION_THRESHOLD=2;
    function isTravelAdmin(){return false;}
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
