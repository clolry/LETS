/**
 * Automated Verification Script for the GSA City Pair Program airfare layer.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Section 1 and 2 are the reason this file exists. GSA stores every city pair
 * with origin and destination in ALPHABETICAL order regardless of travel
 * direction — Washington to London is stored as LON|WAS. A lookup that does
 * not normalize the pair returns "no contract fare awarded" for a route that
 * genuinely has one.
 *
 * That failure is silent and it reads as missing data rather than as a bug, so
 * nobody would file it. The user would simply type a fare in by hand and the
 * feature would appear to be working as designed while doing nothing. Section
 * 11 patches the sort out and asserts the reverse-direction lookup breaks, so
 * the suite cannot pass with that mechanism removed.
 *
 * Section 4 covers the other quiet one. In the source CSV a fare of 0 means
 * the cabin was NOT AWARDED on that route, not that it is free. Pre-filling
 * $0.00 would look like a valid estimate for a flight nobody can book.
 *
 * Section 8 pins the transparency requirement @clolry asked for: a summed
 * itinerary must return its per-segment breakdown, and must report
 * `complete: false` when any hop has no contract fare. A partial sum presented
 * as a total is how an under-estimate reaches an approver.
 *
 * HOW IT LOADS THE CODE
 * ---------------------
 * These are Apps Script server files, not modules. They are evaluated in a vm
 * context with SpreadsheetApp, CacheService and PropertiesService stubbed, so
 * the sheet read, the pair matching, the caching and the fare parsing all
 * execute for real against a fixture that includes a multi-carrier pair, an
 * international city-code pair, a zero business fare and a narrow date window.
 *
 * Run: node lets_app/test_city_pairs.js
 */

const fs=require('fs'),vm=require('vm');
// Fake City_Pairs tab exercising: alphabetical storage, multi-carrier,
// zero-as-not-awarded, international city codes, date windows.
const H=['Pair_Key','Award_Year','Origin_Airport_Abbrev','Destination_Airport_Abbrev',
'Origin_City_Name','Origin_State','Origin_Country','Destination_City_Name',
'Destination_State','Destination_Country','Airline_Abbrev','Awarded_Service','YCA_Fare','CA_Fare',
'Business_Fare','Effective_Date','Expiration_Date'];
function R(o){return H.map(h=>h in o?o[h]:'');}
const ROWS=[
 R({Pair_Key:'DCA|ORD',Award_Year:'2027',Origin_Airport_Abbrev:'DCA',Destination_Airport_Abbrev:'ORD',
    Origin_City_Name:'WASHINGTON',Origin_State:'DC',Origin_Country:'UNITED STATES',
    Destination_City_Name:'CHICAGO',Destination_State:'IL',Destination_Country:'UNITED STATES',
    Airline_Abbrev:'UA',YCA_Fare:410,CA_Fare:198,Business_Fare:0,
    Effective_Date:'2026-10-01',Expiration_Date:'2027-09-30'}),
 R({Pair_Key:'DCA|ORD',Award_Year:'2027',Origin_Airport_Abbrev:'DCA',Destination_Airport_Abbrev:'ORD',
    Origin_City_Name:'WASHINGTON',Origin_State:'DC',Origin_Country:'UNITED STATES',
    Destination_City_Name:'CHICAGO',Destination_State:'IL',Destination_Country:'UNITED STATES',
    Airline_Abbrev:'AA',YCA_Fare:388,CA_Fare:0,Business_Fare:0,
    Effective_Date:'2026-10-01',Expiration_Date:'2027-09-30'}),
 R({Pair_Key:'IAD|ORD',Award_Year:'2027',Origin_Airport_Abbrev:'IAD',Destination_Airport_Abbrev:'ORD',
    Origin_City_Name:'WASHINGTON',Origin_State:'DC',Origin_Country:'UNITED STATES',
    Destination_City_Name:'CHICAGO',Destination_State:'IL',Destination_Country:'UNITED STATES',
    Airline_Abbrev:'UA',YCA_Fare:455,CA_Fare:210,Business_Fare:0,
    Effective_Date:'2026-10-01',Expiration_Date:'2027-09-30'}),
 R({Pair_Key:'LON|WAS',Award_Year:'2027',Origin_Airport_Abbrev:'LON',Destination_Airport_Abbrev:'WAS',
    Origin_City_Name:'LONDON',Origin_State:'',Origin_Country:'UNITED KINGDOM',
    Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
    Airline_Abbrev:'BA',YCA_Fare:2100,CA_Fare:0,Business_Fare:4800,
    Effective_Date:'2026-10-01',Expiration_Date:'2027-09-30'}),
 R({Pair_Key:'ATL|DCA',Award_Year:'2027',Origin_Airport_Abbrev:'ATL',Destination_Airport_Abbrev:'DCA',
    Origin_City_Name:'ATLANTA',Origin_State:'GA',Origin_Country:'UNITED STATES',
    Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
    Airline_Abbrev:'DL',YCA_Fare:355,CA_Fare:180,Business_Fare:0,
    Effective_Date:'2027-01-01',Expiration_Date:'2027-03-31'}),
];
const cache={};
const sandbox={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
 SpreadsheetApp:{openById:()=>({getSheetByName:n=>n!=='City_Pairs'?null:({
   getLastRow:()=>1+ROWS.length,
   getRange:(r,c,nr,nc)=>({getValues:()=>ROWS.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc))})})})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>{cache[k]=v;}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})}};
const ctx=vm.createContext(sandbox);
vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",ctx);
for(const f of ['01_constants/Cache.js','01_constants/Sheets.js','91_setup/CityPairSync.js','30_services/CityPairs.js'])
  vm.runInContext(fs.readFileSync('lets_app/server/'+f,'utf8'),ctx,{filename:f});
const run=e=>vm.runInContext(e,ctx);
let fails=0;
const ok=(n,c,x)=>{ if(c) console.log('  PASS',n); else {console.log('  FAIL',n,x===undefined?'':JSON.stringify(x));fails++;} };

console.log('1. pair key normalization (the alphabetical trap)');
ok("buildPairKey_('ORD','DCA') -> DCA|ORD", run("buildPairKey_('ORD','DCA')")==='DCA|ORD', run("buildPairKey_('ORD','DCA')"));
ok("buildPairKey_('DCA','ORD') -> DCA|ORD", run("buildPairKey_('DCA','ORD')")==='DCA|ORD');
ok("WAS/LON -> LON|WAS (GSA's own example)", run("buildPairKey_('WAS','LON')")==='LON|WAS', run("buildPairKey_('WAS','LON')"));
ok("lowercase+spaces normalized", run("buildPairKey_(' dca ','ord')")==='DCA|ORD');
ok("missing code -> ''", run("buildPairKey_('DCA','')")==='');

console.log('2. direction-insensitive lookup');
const f1=run("getCityPairFare('DCA','ORD')"), f2=run("getCityPairFare('ORD','DCA')");
ok('both directions found', f1.found&&f2.found);
ok('both give the same fare', f1.ycaFare===f2.ycaFare, [f1.ycaFare,f2.ycaFare]);

console.log('3. lowest YCA across carriers');
ok('picks AA 388 over UA 410', f1.ycaFare===388, f1.ycaFare);
ok('names the carrier', f1.airline==='AA', f1.airline);
ok('lists both carriers', f1.carriers.length===2, f1.carriers);

console.log('4. zero means NOT AWARDED, never $0.00');
ok('Business_Fare 0 -> null', f1.businessFare===null, f1.businessFare);
ok('AA CA_Fare 0 -> null', f1.caFare===null, f1.caFare);
const lon=run("getCityPairFare('WAS','LON')");
ok('real business fare preserved', lon.businessFare===4800, lon.businessFare);

console.log('5. unawarded route');
const none=run("getCityPairFare('DCA','XXX')");
ok('found=false, success=true', none.success&&!none.found);
ok('no fare fabricated', none.ycaFare===undefined);

console.log('6. international city codes flagged');
const ap=run("getAirportsForCity('WASHINGTON','DC')");
const codes=ap.airports.map(a=>a.code).sort();
ok('derives DCA/IAD/WAS from data', JSON.stringify(codes)===JSON.stringify(['DCA','IAD','WAS']), codes);
ok('WAS flagged isMetroArea (domestic row)', ap.airports.find(a=>a.code==='WAS').isMetroArea===true);
const lonAp=run("getAirportsForCity('LONDON')");
ok('LON flagged isMetroArea', lonAp.airports[0].isMetroArea===true);
ok('DCA most-connected first', ap.airports[0].code==='DCA', ap.airports.map(a=>a.code+':'+a.routeCount));

console.log('7. date window filtering');
const inW=run("getCityPairFare('ATL','DCA','2027-02-15')");
ok('inside window found', inW.found&&inW.ycaFare===355, inW.ycaFare);
const outW=run("getCityPairFare('ATL','DCA','2027-06-15')");
ok('outside window still returns a fare (no better row)', outW.found===true);

console.log('8. itinerary summing + transparency');
const it=run("getItineraryAirfare(['DCA','ORD','DCA'])");
ok('round trip = 2x388 = 776', it.total===776, it.total);
ok('complete=true', it.complete===true);
ok('2 segments listed', it.segments.length===2, it.segments.length);
ok('each segment names from/to/fare', it.segments[0].from==='DCA'&&it.segments[0].to==='ORD'&&it.segments[0].ycaFare===388);
ok('fareBasis is YCA', it.fareBasis==='YCA');
const multi=run("getItineraryAirfare(['DCA','ORD','ATL','DCA'])");
ok('multi-leg prices each hop', multi.segments.length===3, multi.segments.length);
ok('incomplete when a hop is unawarded', multi.complete===false&&multi.missingSegments.length===1, multi.missingSegments);
ok('partial total still returned for display', multi.total>0);
const same=run("getItineraryAirfare(['DCA','DCA'])");
ok('same-airport hop skipped', same.segments.length===0);
const one=run("getItineraryAirfare(['DCA'])");
ok('single code rejected', one.success===false);

console.log('9. CSV date + fare parsing');
ok("'10/01/2026' -> 2026-10-01", run("parseCityPairDate_('10/01/2026')")==='2026-10-01', run("parseCityPairDate_('10/01/2026')"));
ok("'9/30/2027' zero-padded", run("parseCityPairDate_('9/30/2027')")==='2027-09-30', run("parseCityPairDate_('9/30/2027')"));
ok("ISO input rejected (not GSA's format)", run("parseCityPairDate_('2026-10-01')")==='');
ok("junk -> ''", run("parseCityPairDate_('not a date')")==='');
ok("'$1,234' -> 1234", run("parseFare_('$1,234')")===1234, run("parseFare_('$1,234')"));
ok("'0' -> 0", run("parseFare_('0')")===0);
ok("negative clamped to 0", run("parseFare_('-5')")===0);

console.log('10. FY URL template');
const url=run("getCityPairCsvUrl_()");
ok('substitutes a 4-digit FY', /awards_20\d\d\.csv$/.test(url), url);
ok('uses FY27 in Oct 2026', url.indexOf('awards_2027')>-1, url);

console.log('11. negative control (the suite must be able to fail)');
{
  // Remove the alphabetical sort from buildPairKey_ and confirm section 2
  // breaks. That ordering is the whole mechanism; a test that passes without
  // it is not testing anything.
  const src=fs.readFileSync('lets_app/server/91_setup/CityPairSync.js','utf8');
  const broken=src.replace("return x <= y ? (x + '|' + y) : (y + '|' + x);","return x + '|' + y;");
  if(broken===src){ ok('negative control patched the source',false); }
  else{
    const c2=vm.createContext(Object.assign({},sandbox));
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",c2);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Cache.js','utf8'),c2);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),c2);
    vm.runInContext(broken,c2);
    vm.runInContext(fs.readFileSync('lets_app/server/30_services/CityPairs.js','utf8'),c2);
    const rev=vm.runInContext("getCityPairFare('ORD','DCA')",c2);
    ok('unsorted key fails to find the reverse direction', rev.found===false, rev);
  }
}

console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
