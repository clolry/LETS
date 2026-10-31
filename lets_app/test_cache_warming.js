/**
 * Automated Verification Script for city-pair cache warming.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * A cold getCityPairFare scans all 17,403 City_Pairs rows. Measured in the
 * sandbox: 2,749ms cold, 27ms warm. The scan is ~296,000 cells and is
 * structural; getCityPairFaresBulk collapses N lookups into one, so the
 * remaining cost is the single irreducible scan.
 *
 * warmCityPairCache pre-warms the routes this workgroup actually flies, so the
 * 2.7s is paid by a trigger at 4am rather than by a user mid-form. It CANNOT
 * cover the space — 17,403 pairs, 24h TTL — so it reduces how often someone
 * waits rather than eliminating the wait. @clolry accepted that explicitly;
 * the picker shows a spinner for the uncommon-route case.
 *
 * SECTION 6 IS THE IMPORTANT ONE. It caught a real defect: getCityPairFaresBulk
 * did not write to the cache that getCityPairFare reads. Warming ran, reported
 * success, and left every subsequent single lookup paying the full cold scan —
 * while the warming function's own comment claimed it populated the cache. The
 * whole feature would have been decorative, and nothing would have failed
 * visibly. Section 6 asserts a single lookup after a bulk call costs ZERO
 * additional sheet scans.
 *
 * Section 1 guards the metro-aggregate exclusion. WAS, NYC and CHI carry no
 * awarded fares of their own, so warming them is pure waste and they must not
 * appear in the busiest-airport list.
 *
 * Section 2 asserts the scan count stays bounded rather than growing per pair,
 * which is the whole point of routing warming through the bulk reader.
 *
 * Run: node lets_app/test_cache_warming.js
 */

const fs=require('fs'),vm=require('vm');
const CP_H=['Pair_Key','Award_Year','Origin_Airport_Abbrev','Destination_Airport_Abbrev',
'Origin_City_Name','Origin_State','Origin_Country','Destination_City_Name','Destination_State',
'Destination_Country','Airline_Abbrev','Awarded_Service','YCA_Fare','CA_Fare','Business_Fare',
'Effective_Date','Expiration_Date'];
function cp(o){return CP_H.map(h=>h in o?o[h]:'');}
const D1=new Date(2026,9,1),D2=new Date(2027,8,30);
function pair(o,d,oc,os,dc,ds,fare){
  const k=o<=d?o+'|'+d:d+'|'+o;
  return cp({Pair_Key:k,Origin_Airport_Abbrev:o,Destination_Airport_Abbrev:d,
    Origin_City_Name:oc,Origin_State:os,Origin_Country:'UNITED STATES',
    Destination_City_Name:dc,Destination_State:ds,Destination_Country:'UNITED STATES',
    Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:fare,CA_Fare:0,Business_Fare:0,
    Effective_Date:D1,Expiration_Date:D2});
}
const ROWS=[
 pair('DCA','ORD','WASHINGTON','DC','CHICAGO','IL',112),
 pair('DCA','ATL','WASHINGTON','DC','ATLANTA','GA',150),
 pair('DCA','DEN','WASHINGTON','DC','DENVER','CO',220),
 pair('ORD','ATL','CHICAGO','IL','ATLANTA','GA',130),
 pair('ORD','DEN','CHICAGO','IL','DENVER','CO',160),
 pair('ATL','DEN','ATLANTA','GA','DENVER','CO',175),
 // metro aggregate: must never be warmed as an origin or destination
 pair('ORD','WAS','CHICAGO','IL','WASHINGTON','DC',115),
 pair('ATL','WAS','ATLANTA','GA','WASHINGTON','DC',140),
];
let scans=0;
const cache={};
const sheets={City_Pairs:{getLastRow:()=>1+ROWS.length,getLastColumn:()=>17,
  getRange:(r,c,nr,nc)=>({getValues:()=>{scans++;return ROWS.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc));}})}};
const HCPOS=[
 {positionNumber:'FC-1',employeeName:'A',location:{city:'WASHINGTON',state:'DC'},org:{}},
 {positionNumber:'FCA-1',employeeName:'B',location:{city:'CHICAGO',state:'IL'},org:{}},
 {positionNumber:'FCA-2',employeeName:'C',location:{city:'WASHINGTON',state:'DC'},org:{}},
];
const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,
 parseFloat,parseInt,isNaN,RegExp,Error,
 SpreadsheetApp:{openById:()=>({getSheetByName:n=>sheets[n]||null})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>{cache[k]=v;}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
 Utilities:{sleep:()=>{}},
 ScriptApp:{getProjectTriggers:()=>[],
   newTrigger:()=>({timeBased:()=>({everyHours:()=>({create:()=>{}}),atHour:()=>({everyDays:()=>({create:()=>{}})})})}),
   deleteTrigger:()=>{}},
 Session:{getActiveUser:()=>({getEmail:()=>'t@gsa.gov'})}};
const ctx=vm.createContext(sb);
vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",ctx);
for(const f of ['01_constants/Cache.js','01_constants/Costs.js','01_constants/Sheets.js',
  '91_setup/CityPairSync.js','30_services/CityPairs.js','30_services/AirportPrefs.js'])
  vm.runInContext(fs.readFileSync('lets_app/server/'+f,'utf8'),ctx,{filename:f});
vm.runInContext(`var HC={hcGetBundle:()=>({success:true,count:${HCPOS.length},data:${JSON.stringify(HCPOS)}})};
  var GSA_CONUS_STATES=[];
  function getGSACitiesForState(){return {success:false};}
  function getFiscalYear(){return 2027;}`,ctx);
vm.runInContext(fs.readFileSync('lets_app/server/99_triggers/CacheWarming.js','utf8'),ctx,{filename:'CacheWarming.js'});
const run=e=>vm.runInContext(e,ctx);
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x));fails++;}};

console.log('1. busiest airports exclude metro aggregates');
{
  const busiest=run('_busiestCityPairAirports_(10)');
  ok('returns codes', busiest.length>0, busiest);
  ok('WAS excluded even though it appears twice', busiest.indexOf('WAS')===-1, busiest);
  ok('busiest first', busiest[0]==='DCA'||busiest[0]==='ORD'||busiest[0]==='ATL', busiest);
}

console.log('2. warming derives origins from HC duty stations');
{
  const before=scans;
  const r=run('warmCityPairCache()');
  ok('success', r.success===true, r);
  ok('warmed some pairs', r.warmed>0, r);
  // 2 distinct duty-station cities -> 1 scan each for airport resolution,
  // 1 for the busiest list, 1 bulk scan per origin. Must not be per-pair.
  ok('scan count is bounded, not per-pair', (scans-before)<=8, 'scans='+(scans-before));
}

console.log('3. warming actually populates the per-pair cache');
{
  const keys=Object.keys(cache).filter(k=>k.indexOf('cp_fare_')===0);
  ok('per-pair entries written', keys.length>0, keys.length);
  const t0=Date.now();
  const f=run("getCityPairFare('DCA','ORD')");
  ok('warmed pair resolves', f.found===true&&f.ycaFare===112, f.ycaFare);
}

console.log('4. degrades when HC is unavailable');
{
  const c2=vm.createContext(Object.assign({},sb,{console:{log(){},warn(){},error(){}}}));
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",c2);
  for(const f of ['01_constants/Cache.js','01_constants/Costs.js','01_constants/Sheets.js',
    '91_setup/CityPairSync.js','30_services/CityPairs.js','30_services/AirportPrefs.js'])
    vm.runInContext(fs.readFileSync('lets_app/server/'+f,'utf8'),c2);
  vm.runInContext(`var HC={hcGetBundle:()=>({success:false,error:'no tabs',data:[]})};
    var GSA_CONUS_STATES=[]; function getGSACitiesForState(){return{success:false};}
    function getFiscalYear(){return 2027;}`,c2);
  vm.runInContext(fs.readFileSync('lets_app/server/99_triggers/CacheWarming.js','utf8'),c2);
  const r=vm.runInContext('warmCityPairCache()',c2);
  ok('no HC -> success with 0 warmed, not a throw', r.success===true&&r.warmed===0, r);
}

console.log('5. trigger install is idempotent');
{
  let created=0,deleted=0;
  const sb2=Object.assign({},sb,{ScriptApp:{
    getProjectTriggers:()=>[{getHandlerFunction:()=>'warmCityPairCache'}],
    newTrigger:()=>({timeBased:()=>({everyHours:()=>({create:()=>{created++;}})})}),
    deleteTrigger:()=>{deleted++;}}});
  const c3=vm.createContext(sb2);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",c3);
  for(const f of ['01_constants/Cache.js','01_constants/Costs.js','01_constants/Sheets.js',
    '91_setup/CityPairSync.js','30_services/CityPairs.js','30_services/AirportPrefs.js'])
    vm.runInContext(fs.readFileSync('lets_app/server/'+f,'utf8'),c3);
  vm.runInContext(`var HC={hcGetBundle:()=>({success:true,data:[]})};
    var GSA_CONUS_STATES=[]; function getGSACitiesForState(){return{success:false};}
    function getFiscalYear(){return 2027;}`,c3);
  vm.runInContext(fs.readFileSync('lets_app/server/99_triggers/CacheWarming.js','utf8'),c3);
  vm.runInContext('installCityPairWarmingTrigger()',c3);
  ok('removes the existing trigger before creating', deleted===1, 'deleted='+deleted);
  ok('creates exactly one', created===1, 'created='+created);
}
console.log('6. a bulk call warms the single-lookup path');
{
  // This is the assertion that caught the real defect: getCityPairFaresBulk
  // originally did NOT write to the cache getCityPairFare reads, so warming
  // ran, reported success, and left every later lookup paying the full cold
  // scan. The warming function's comment claimed otherwise.
  const c6cache={};
  let c6scans=0;
  const sheets6={City_Pairs:{getLastRow:()=>1+ROWS.length,getLastColumn:()=>17,
    getRange:(r,c,nr,nc)=>({getValues:()=>{c6scans++;return ROWS.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc));}})}};
  const sb6=Object.assign({},sb,{
    SpreadsheetApp:{openById:()=>({getSheetByName:n=>sheets6[n]||null})},
    CacheService:{getScriptCache:()=>({get:k=>c6cache[k]||null,put:(k,v)=>{c6cache[k]=v;}})}});
  const c6=vm.createContext(sb6);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",c6);
  for(const f of ['01_constants/Cache.js','01_constants/Costs.js','01_constants/Sheets.js',
    '91_setup/CityPairSync.js','30_services/CityPairs.js'])
    vm.runInContext(fs.readFileSync('lets_app/server/'+f,'utf8'),c6);

  vm.runInContext("getCityPairFaresBulk('DCA',['ORD','ATL'])",c6);
  const afterBulk=c6scans;
  const f=vm.runInContext("getCityPairFare('DCA','ORD')",c6);
  ok('single lookup after bulk costs ZERO extra scans', c6scans===afterBulk, 'extra='+(c6scans-afterBulk));
  ok('and returns the right fare', f.found===true&&f.ycaFare===112, f.ycaFare);
  ok('reverse direction also warm', vm.runInContext("getCityPairFare('ORD','DCA')",c6).ycaFare===112);
}

console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
