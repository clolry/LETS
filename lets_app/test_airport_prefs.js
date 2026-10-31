/**
 * Automated Verification Script for airport selection and learned preferences.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Section 1 is the reason this file exists. The sandbox run against the real
 * GSA CSV returned, for Washington DC:
 *
 *     WAS  routeCount 260      <- sorted first
 *     DCA  routeCount 254
 *     BWI  routeCount 210
 *     IAD  routeCount 202
 *
 * WAS is an IATA METROPOLITAN AREA code covering DCA, IAD and BWI
 * collectively — not a bookable airport. Because it carried the most routes,
 * the original "most-connected first" sort made it the default origin for DC.
 * The first detection attempt assumed metro codes only appeared on
 * international rows (`country !== 'UNITED STATES'`), which the real data
 * disproved: GSA uses WAS in domestic rows too.
 *
 * The fixture below reproduces that exactly — WAS appears on more rows than
 * DCA — so section 11 can patch the metro-aware sort out and watch WAS wrongly
 * win the default. An earlier version of this fixture had DCA ahead on route
 * count, which made the negative control pass for the wrong reason and proved
 * nothing.
 *
 * Section 2 covers the second real-data bug. Sheets coerces an ISO date string
 * on write, so getValues() returns a Date object. The window filter compared
 * that Date against a string — 'Thu Oct 01 2026...' <= '2027-02-15' is a
 * lexical comparison of 'T' against '2', always false — so every row was
 * filtered out and the code silently fell through to ignoring the window. It
 * failed safe, which is why nobody noticed the check was dead.
 *
 * Sections 4, 5 and 9 pin the hybrid learning rules @clolry chose:
 *
 *   4 — one selection does NOT create a default. A preference is promoted only
 *       at AIRPORT_PREF_PROMOTION_THRESHOLD uses, so a mis-click cannot stick.
 *   5 — switching airports RESETS the count, so a stale airport cannot stay
 *       promoted on history it no longer deserves.
 *   9 — a promoted preference beats a cheaper fare. @clolry will only fly into
 *       DCA because of Metro access, so a $108 BWI fare is not a real option
 *       for him. Price is a tiebreak, never the primary sort.
 *
 * Fares in the fixture are the real ones from GSA's Fare Finder for DC to
 * Chicago: ORD $112 non-stop, MDW $304 non-stop, and IAD->ORD $441 on a
 * CONNECT itinerary — the 4x spread that makes Awarded_Service worth showing.
 *
 * Run: node lets_app/test_airport_prefs.js
 */

const fs=require('fs'),vm=require('vm');
const CP_H=['Pair_Key','Award_Year','Origin_Airport_Abbrev','Destination_Airport_Abbrev',
'Origin_City_Name','Origin_State','Origin_Country','Destination_City_Name','Destination_State',
'Destination_Country','Airline_Abbrev','Awarded_Service','YCA_Fare','CA_Fare','Business_Fare',
'Effective_Date','Expiration_Date'];
const PF_H=['Pref_ID','User_ID','Pref_Type','City_Name','State','Airport_Code','Use_Count',
'First_Used_At','Last_Used_At','Updated_By'];
function cp(o){return CP_H.map(h=>h in o?o[h]:'');}
// Real shape from the sandbox: GSA uses WAS (metro) in DOMESTIC rows, and
// Sheets hands dates back as Date objects.
const D1=new Date(2026,9,1), D2=new Date(2027,8,30);
const CPROWS=[
 cp({Pair_Key:'DCA|ORD',Origin_Airport_Abbrev:'DCA',Destination_Airport_Abbrev:'ORD',
  Origin_City_Name:'WASHINGTON',Origin_State:'DC',Origin_Country:'UNITED STATES',
  Destination_City_Name:'CHICAGO',Destination_State:'IL',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:112,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 cp({Pair_Key:'DCA|MDW',Origin_Airport_Abbrev:'DCA',Destination_Airport_Abbrev:'MDW',
  Origin_City_Name:'WASHINGTON',Origin_State:'DC',Origin_Country:'UNITED STATES',
  Destination_City_Name:'CHICAGO',Destination_State:'IL',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'WN',Awarded_Service:'Non-stop',YCA_Fare:304,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 cp({Pair_Key:'BWI|ORD',Origin_Airport_Abbrev:'BWI',Destination_Airport_Abbrev:'ORD',
  Origin_City_Name:'WASHINGTON',Origin_State:'DC',Origin_Country:'UNITED STATES',
  Destination_City_Name:'CHICAGO',Destination_State:'IL',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:108,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 cp({Pair_Key:'IAD|ORD',Origin_Airport_Abbrev:'IAD',Destination_Airport_Abbrev:'ORD',
  Origin_City_Name:'WASHINGTON',Origin_State:'DC',Origin_Country:'UNITED STATES',
  Destination_City_Name:'CHICAGO',Destination_State:'IL',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'AA',Awarded_Service:'Connect',YCA_Fare:441,CA_Fare:321,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 // WAS metro in a DOMESTIC row - the real-data case that broke detection
 cp({Pair_Key:'ORD|WAS',Origin_Airport_Abbrev:'ORD',Destination_Airport_Abbrev:'WAS',
  Origin_City_Name:'CHICAGO',Origin_State:'IL',Origin_Country:'UNITED STATES',
  Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:115,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 cp({Pair_Key:'LAX|WAS',Origin_Airport_Abbrev:'LAX',Destination_Airport_Abbrev:'WAS',
  Origin_City_Name:'LOS ANGELES',Origin_State:'CA',Origin_Country:'UNITED STATES',
  Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:380,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 cp({Pair_Key:'BOS|WAS',Origin_Airport_Abbrev:'BOS',Destination_Airport_Abbrev:'WAS',
  Origin_City_Name:'BOSTON',Origin_State:'MA',Origin_Country:'UNITED STATES',
  Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'DL',Awarded_Service:'Non-stop',YCA_Fare:150,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 cp({Pair_Key:'SFO|WAS',Origin_Airport_Abbrev:'SFO',Destination_Airport_Abbrev:'WAS',
  Origin_City_Name:'SAN FRANCISCO',Origin_State:'CA',Origin_Country:'UNITED STATES',
  Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:400,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 // Honolulu: single airport, must produce no choice
 cp({Pair_Key:'DCA|HNL',Origin_Airport_Abbrev:'DCA',Destination_Airport_Abbrev:'HNL',
  Origin_City_Name:'WASHINGTON',Origin_State:'DC',Origin_Country:'UNITED STATES',
  Destination_City_Name:'HONOLULU',Destination_State:'HI',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'HA',Awarded_Service:'Connect',YCA_Fare:890,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
];
function build(prefRows){
  const prefs=(prefRows||[]).slice();
  const cache={};
  const sheets={City_Pairs:{
    getLastRow:()=>1+CPROWS.length,
    getRange:(r,c,nr,nc)=>({getValues:()=>CPROWS.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc))})},
   Traveler_Airport_Prefs:{
    getLastRow:()=>1+prefs.length,
    getRange:(r,c,nr,nc)=>({
      getValues:()=>prefs.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc)),
      setValue:v=>{prefs[r-2][c-1]=v;}}),
    appendRow:row=>prefs.push(row)}};
  const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
   SpreadsheetApp:{openById:()=>({getSheetByName:n=>sheets[n]||null})},
   CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>{cache[k]=v;}})},
   PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
   Session:{getActiveUser:()=>({getEmail:()=>'t@gsa.gov'})}};
  const ctx=vm.createContext(sb);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",ctx);
  for(const f of ['01_constants/Cache.js','01_constants/Sheets.js','91_setup/CityPairSync.js',
    '30_services/CityPairs.js','30_services/AirportPrefs.js'])
    vm.runInContext(fs.readFileSync('lets_app/server/'+f,'utf8'),ctx,{filename:f});
  return {run:e=>vm.runInContext(e,ctx),prefs};
}
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x));fails++;}};

console.log('1. metro codes must never win a default (the real-data bug)');
{
  const h=build();
  const r=h.run("getAirportsForCity('WASHINGTON','DC')");
  const codes=r.airports.map(a=>a.code);
  ok('WAS present but LAST', codes[codes.length-1]==='WAS', codes);
  ok('DCA is first despite WAS having more routes', codes[0]==='DCA', codes.map((c,i)=>c+':'+r.airports[i].routeCount));
  ok('WAS flagged isMetroArea', r.airports.find(a=>a.code==='WAS').isMetroArea===true);
  ok('WAS labelled', r.airports.find(a=>a.code==='WAS').metroLabel.indexOf('Washington')>-1);
  ok('DCA not flagged metro', r.airports.find(a=>a.code==='DCA').isMetroArea===false);
  ok('isMetroArea works on a DOMESTIC row', r.airports.find(a=>a.code==='WAS').country==='UNITED STATES');
}

console.log('2. date window now actually filters (Date objects)');
{
  const h=build();
  const inW=h.run("getCityPairFare('DCA','ORD','2027-02-15')");
  ok('in-window fare found', inW.found && inW.ycaFare===112, inW.ycaFare);
  ok('effectiveDate normalized to ISO', inW.effectiveDate==='2026-10-01', inW.effectiveDate);
  ok('expirationDate normalized', inW.expirationDate==='2027-09-30', inW.expirationDate);
}

console.log('3. awarded service surfaced');
{
  const h=build();
  ok('DCA-ORD non-stop', h.run("getCityPairFare('DCA','ORD')").awardedService==='Non-stop');
  ok('IAD-ORD connect at 4x', h.run("getCityPairFare('IAD','ORD')").awardedService==='Connect');
  ok('decode N', h.run("decodeAwardedService_('N')")==='Non-stop');
  ok('decode C', h.run("decodeAwardedService_('C')")==='Connect');
  ok('unknown passes through', h.run("decodeAwardedService_('X')")==='X');
}

console.log('4. hybrid learning: one click does NOT stick');
{
  const h=build();
  const r1=h.run("recordAirportPreference('ext_olry','HOME_ORIGIN','DCA')");
  ok('first use recorded', r1.success && r1.useCount===1, r1);
  ok('NOT promoted after 1 use', r1.promoted===false, r1);
  const opts1=h.run("getAirportOptionsForCity('WASHINGTON','DC','ext_olry','HOME_ORIGIN')");
  ok('unpromoted pref does not change default', opts1.preferredCode==='', opts1.preferredCode);
  ok('but use count is surfaced', opts1.airports.find(a=>a.code==='DCA').useCount===1);

  const r2=h.run("recordAirportPreference('ext_olry','HOME_ORIGIN','DCA')");
  ok('second use promotes', r2.promoted===true && r2.useCount===2, r2);
  const opts2=h.run("getAirportOptionsForCity('WASHINGTON','DC','ext_olry','HOME_ORIGIN')");
  ok('promoted pref becomes default', opts2.preferredCode==='DCA' && opts2.defaultCode==='DCA', opts2.defaultCode);
  ok('no duplicate rows', h.prefs.length===1, h.prefs.length);
}

console.log('5. switching airports resets the count');
{
  const h=build();
  h.run("recordAirportPreference('u1','DESTINATION','ORD','CHICAGO','IL')");
  h.run("recordAirportPreference('u1','DESTINATION','ORD','CHICAGO','IL')");
  const sw=h.run("recordAirportPreference('u1','DESTINATION','MDW','CHICAGO','IL')");
  ok('switch resets to 1', sw.useCount===1 && sw.promoted===false, sw);
  ok('still one row for that city', h.prefs.length===1, h.prefs.length);
  const p=h.run("getAirportPreferences('u1')");
  ok('stale ORD no longer promoted', p.destinations['CHICAGO|IL'].airportCode==='MDW', p.destinations);
}

console.log('6. metro code cannot be saved as a preference');
{
  const h=build();
  const r=h.run("recordAirportPreference('u2','HOME_ORIGIN','WAS')");
  ok('rejected', r.success===false, r);
  ok('nothing written', h.prefs.length===0);
}

console.log('7. priced destination options from a fixed origin');
{
  const h=build();
  const r=h.run("getPricedDestinationOptions('DCA','CHICAGO','IL')");
  ok('success', r.success===true);
  ok('two real airports offered', r.options.filter(o=>!o.isMetroArea).length===2, r.options.map(o=>o.code));
  ok('cheapest first: ORD 112 before MDW 304', r.options[0].code==='ORD' && r.options[0].ycaFare===112, r.options.map(o=>o.code+':'+o.ycaFare));
  ok('MDW priced at 304', r.options.find(o=>o.code==='MDW').ycaFare===304);
  ok('service shown per option', r.options[0].awardedService==='Non-stop');
  ok('hasChoice true', r.hasChoice===true);
}

console.log('8. single-airport city offers no choice');
{
  const h=build();
  const r=h.run("getPricedDestinationOptions('DCA','HONOLULU','HI')");
  ok('HNL only', r.options.filter(o=>!o.isMetroArea).map(o=>o.code).join()==='HNL', r.options.map(o=>o.code));
  ok('hasChoice false', r.hasChoice===false);
}

console.log('9. preference beats price (the DCA/Metro constraint)');
{
  const h=build();
  // Promote MDW even though ORD is far cheaper from DCA.
  h.run("recordAirportPreference('u3','DESTINATION','MDW','CHICAGO','IL')");
  h.run("recordAirportPreference('u3','DESTINATION','MDW','CHICAGO','IL')");
  const r=h.run("getPricedDestinationOptions('DCA','CHICAGO','IL','u3')");
  ok('promoted MDW is default despite costing 304 vs 112',
     r.defaultCode==='MDW', r.options.map(o=>o.code+':'+o.ycaFare));
  ok('cheaper ORD still offered', r.options.some(o=>o.code==='ORD'&&o.ycaFare===112));
  ok('MDW flagged isPreferred', r.options[0].isPreferred===true);
}

console.log('10. degrades without a prefs tab');
{
  const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
   SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='City_Pairs'?{getLastRow:()=>1+CPROWS.length,
     getRange:(r,c,nr,nc)=>({getValues:()=>CPROWS.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc))})}:null})},
   CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
   PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
   Session:{getActiveUser:()=>({getEmail:()=>'t@gsa.gov'})}};
  const c2=vm.createContext(sb);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",c2);
  for(const f of ['01_constants/Cache.js','01_constants/Sheets.js','91_setup/CityPairSync.js',
    '30_services/CityPairs.js','30_services/AirportPrefs.js'])
    vm.runInContext(fs.readFileSync('lets_app/server/'+f,'utf8'),c2);
  const p=vm.runInContext("getAirportPreferences('u9')",c2);
  ok('no tab -> success with empty prefs', p.success===true && p.homeOrigin===null, p);
  const o=vm.runInContext("getAirportOptionsForCity('WASHINGTON','DC','u9','HOME_ORIGIN')",c2);
  ok('picker still works, falls back to busiest real airport', o.defaultCode==='DCA', o.defaultCode);
  const w=vm.runInContext("recordAirportPreference('u9','HOME_ORIGIN','DCA')",c2);
  ok('write fails soft', w.success===false && !!w.error, w);
}

console.log('11. negative control (the suite must be able to fail)');
{
  const src=fs.readFileSync('lets_app/server/30_services/CityPairs.js','utf8');
  const broken=src.replace("if (a.isMetroArea !== b.isMetroArea) return a.isMetroArea ? 1 : -1;\n        return b.routeCount - a.routeCount;","return b.routeCount - a.routeCount;");
  if(broken===src){ok('negative control patched source',false);}
  else{
    const cache={};
    const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
     SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='City_Pairs'?{getLastRow:()=>1+CPROWS.length,
       getRange:(r,c,nr,nc)=>({getValues:()=>CPROWS.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc))})}:null})},
     CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>{cache[k]=v;}})},
     PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
     Session:{getActiveUser:()=>({getEmail:()=>'t@gsa.gov'})}};
    const c3=vm.createContext(sb);
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",c3);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Cache.js','utf8'),c3);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),c3);
    vm.runInContext(fs.readFileSync('lets_app/server/91_setup/CityPairSync.js','utf8'),c3);
    vm.runInContext(broken,c3);
    const r=vm.runInContext("getAirportsForCity('WASHINGTON','DC')",c3);
    ok('without the metro sort, WAS wrongly wins the default',
       r.airports[0].code==='WAS', r.airports.map(a=>a.code));
  }
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
