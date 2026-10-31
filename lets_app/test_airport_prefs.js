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
// Real shape from the sandbox: Sheets hands dates back as Date objects.
const D1=new Date(2026,9,1), D2=new Date(2027,8,30);
// A pair between DCA and a code, used to give the city/state columns real
// values for cities other than the hand-written ones below.
function pair2(code,city,state,fare){
  const first=code<='DCA';
  const k=first?code+'|DCA':'DCA|'+code;
  return cp({Pair_Key:k,
    Origin_Airport_Abbrev:first?code:'DCA',
    Destination_Airport_Abbrev:first?'DCA':code,
    Origin_City_Name:first?city:'WASHINGTON',
    Origin_State:first?state:'DC',
    Origin_Country:'UNITED STATES',
    Destination_City_Name:first?'WASHINGTON':city,
    Destination_State:first?'DC':state,
    Destination_Country:'UNITED STATES',
    Airline_Abbrev:'AA',Awarded_Service:'Non-stop',YCA_Fare:fare,CA_Fare:0,Business_Fare:0,
    Effective_Date:D1,Expiration_Date:D2});
}
// Real shape from the sandbox: GSA uses WAS (metro) in DOMESTIC rows, and
// Sheets hands dates back as Date objects.
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
 // Extra WAS rows. The negative control in section 15 depends on WAS
 // outranking DCA on route count, as it does in the real data (260 vs 254).
 // The TX rows below each add a DCA side, so without these the control stops
 // discriminating and would pass for the wrong reason.
 cp({Pair_Key:'SEA|WAS',Origin_Airport_Abbrev:'SEA',Destination_Airport_Abbrev:'WAS',
  Origin_City_Name:'SEATTLE',Origin_State:'WA',Origin_Country:'UNITED STATES',
  Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:390,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 cp({Pair_Key:'MIA|WAS',Origin_Airport_Abbrev:'MIA',Destination_Airport_Abbrev:'WAS',
  Origin_City_Name:'MIAMI',Origin_State:'FL',Origin_Country:'UNITED STATES',
  Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:300,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 cp({Pair_Key:'MSP|WAS',Origin_Airport_Abbrev:'MSP',Destination_Airport_Abbrev:'WAS',
  Origin_City_Name:'MINNEAPOLIS',Origin_State:'MN',Origin_Country:'UNITED STATES',
  Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:280,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 cp({Pair_Key:'PDX|WAS',Origin_Airport_Abbrev:'PDX',Destination_Airport_Abbrev:'WAS',
  Origin_City_Name:'PORTLAND',Origin_State:'OR',Origin_Country:'UNITED STATES',
  Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:410,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 cp({Pair_Key:'PHX|WAS',Origin_Airport_Abbrev:'PHX',Destination_Airport_Abbrev:'WAS',
  Origin_City_Name:'PHOENIX',Origin_State:'AZ',Origin_Country:'UNITED STATES',
  Destination_City_Name:'WASHINGTON',Destination_State:'DC',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'UA',Awarded_Service:'Non-stop',YCA_Fare:330,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
 // Texas. GSA files DFW and DAL under DALLAS; there is no FORT WORTH row,
 // which is exactly why a Fort Worth duty station resolved to nothing.
 pair2('DFW','DALLAS','TX',260),
 pair2('DAL','DALLAS','TX',200),
 pair2('AUS','AUSTIN','TX',240),
 pair2('SAT','SAN ANTONIO','TX',310),
 // Honolulu: single airport, must produce no choice
 cp({Pair_Key:'DCA|HNL',Origin_Airport_Abbrev:'DCA',Destination_Airport_Abbrev:'HNL',
  Origin_City_Name:'WASHINGTON',Origin_State:'DC',Origin_Country:'UNITED STATES',
  Destination_City_Name:'HONOLULU',Destination_State:'HI',Destination_Country:'UNITED STATES',
  Airline_Abbrev:'HA',Awarded_Service:'Connect',YCA_Fare:890,CA_Fare:0,Business_Fare:0,
  Effective_Date:D1,Expiration_Date:D2}),
];
// Models Apps Script WRITE BUFFERING. This is the whole reason the flush bug
// reached production: the original stub applied appendRow synchronously, so a
// subsequent read saw it immediately and the missing flush was invisible.
//
// Here `committed` is what reads see and `pending` is what has been written but
// not yet flushed. SpreadsheetApp.flush() moves pending into committed. Any
// code that writes and then re-reads without flushing sees stale data, exactly
// as it does on the real platform.
function build(prefRows, opts){
  opts=opts||{};
  const committed=(prefRows||[]).map(r=>r.slice());
  let pending=[];
  let scans=0;
  const cache={};
  const flush=()=>{ pending.forEach(op=>op()); pending=[]; };
  const sheets={City_Pairs:{
    getLastRow:()=>1+CPROWS.length,
    getRange:(r,c,nr,nc)=>({getValues:()=>{scans++;return CPROWS.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc));}})},
   Traveler_Airport_Prefs:{
    getLastRow:()=>1+committed.length,
    getRange:(r,c,nr,nc)=>({
      getValues:()=>committed.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc)),
      setValue:v=>{pending.push(()=>{committed[r-2][c-1]=v;});},
      setValues:vals=>{pending.push(()=>{for(let i=0;i<vals.length;i++)committed[r-2+i]=vals[i].slice();});}}),
    appendRow:row=>{pending.push(()=>committed.push(row.slice()));}}};
  const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
   SpreadsheetApp:{openById:()=>({getSheetByName:n=>sheets[n]||null}),flush:flush},
   LockService:{getScriptLock:()=>({
     waitLock:()=>{ if(opts.lockTimeout) throw new Error('lock timeout'); },
     releaseLock:()=>{}})},
   CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>{cache[k]=v;}})},
   PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
   Session:{getActiveUser:()=>({getEmail:()=>'t@gsa.gov'})}};
  const ctx=vm.createContext(sb);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",ctx);
  for(const f of ['01_constants/Cache.js','01_constants/Costs.js','01_constants/Sheets.js',
    '91_setup/CityPairSync.js','30_services/CityPairs.js','30_services/AirportPrefs.js'])
    vm.runInContext(fs.readFileSync('lets_app/server/'+f,'utf8'),ctx,{filename:f});
  return {run:e=>vm.runInContext(e,ctx),prefs:committed,scanCount:()=>scans};
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

console.log('11. write buffering: the flush bug that reached production');
{
  const h=build();
  const r1=h.run("recordAirportPreference('u8','HOME_ORIGIN','DCA')");
  const r2=h.run("recordAirportPreference('u8','HOME_ORIGIN','DCA')");
  // Without SpreadsheetApp.flush(), the second call read a stale getLastRow(),
  // found no existing row, and appended onto the SAME physical row. Both calls
  // reported useCount 1, Use_Count could never pass 1, and promotion never
  // happened — the hybrid learning feature was entirely inert. Confirmed in
  // the sandbox: one row, Use_Count 1, after two calls.
  ok('second call sees the first write', r2.useCount===2, [r1.useCount,r2.useCount]);
  ok('promotion actually fires', r2.promoted===true, r2);
  ok('exactly one row, not two', h.prefs.length===1, h.prefs.length);
  const stored=h.prefs[0];
  ok('stored Use_Count is 2', stored[6]===2, stored);
}

console.log('12. scan cost does not grow with airport count');
{
  const h=build();
  const before=h.scanCount();
  const r=h.run("getPricedDestinationOptions('DCA','CHICAGO','IL')");
  const scans=h.scanCount()-before;
  // Two scans is the floor: one to enumerate the city's airports, one to price
  // them all together. Before this, pricing was one scan PER airport — three
  // Chicago airports meant four full 17,403-row scans and took 11 seconds in
  // the sandbox. This is reached from a form keystroke.
  //
  // Both are CacheService-backed in production, so a repeat lookup for the
  // same city costs zero scans; this measures the cold path.
  ok('priced options cost 2 scans regardless of airport count', scans===2, 'scans='+scans);
  ok('still priced correctly', r.options[0].code==='ORD'&&r.options[0].ycaFare===112, r.options.map(o=>o.code+':'+o.ycaFare));
  ok('bulk and single paths agree',
     h.run("getCityPairFare('DCA','ORD').ycaFare")===r.options[0].ycaFare);
}

console.log('13. lock timeout must not block a submission');
{
  const h=build(null,{lockTimeout:true});
  const r=h.run("recordAirportPreference('u7','HOME_ORIGIN','DCA')");
  ok('reports lockTimeout', r.lockTimeout===true, r);
  ok('does not throw', r.success===false);
  ok('nothing written', h.prefs.length===0);
}

console.log('13b. city-name resolution never returns an empty picker');
{
  const h=build();
  // Tier 1: exact match.
  const exact=h.run("getAirportsForCity('DALLAS','TX')");
  ok('exact match reports matchType exact', exact.matchType==='exact', exact.matchType);
  ok('DFW busiest first', exact.airports[0].code==='DFW', exact.airports.map(a=>a.code));

  // Tier 2: alias. GSA files DFW and DAL under DALLAS, so a FORT WORTH duty
  // station resolved to NOTHING — an empty airport picker, which blocks a
  // submission rather than merely inconveniencing it. Confirmed against the
  // real FY27 data: of the 22 Texas city names GSA uses, none is FORT WORTH.
  const alias=h.run("getAirportsForCity('FORT WORTH','TX')");
  ok('alias resolves', alias.airports.length>0, alias);
  ok('alias reports matchType alias', alias.matchType==='alias', alias.matchType);
  ok('alias names the matched city', alias.matchedCity==='DALLAS', alias.matchedCity);
  ok('alias preserves what was asked for', alias.requestedCity==='FORT WORTH', alias.requestedCity);
  ok('alias yields DFW first', alias.airports[0].code==='DFW', alias.airports.map(a=>a.code));

  // Tier 3: unknown city, known state. Must degrade to state-wide rather than
  // empty — "no airports" reads to a user as a broken form.
  const fallback=h.run("getAirportsForCity('LUBBOCK','TX')");
  ok('unknown TX city still returns airports', fallback.airports.length>0, fallback);
  ok('reports matchType state', fallback.matchType==='state', fallback.matchType);
  ok('matchedCity blank on a state match', fallback.matchedCity==='', fallback.matchedCity);
  // Each TX airport has one fixture row, so route counts tie at 1 and the
  // order is insertion-dependent. Assert the SET; ranking is already covered
  // by section 1 against the WAS/DCA counts that actually differ.
  const txCodes=fallback.airports.map(a=>a.code).sort().join(',');
  ok('state list contains every TX airport', txCodes==='AUS,DAL,DFW,SAT', txCodes);
  ok('no metro aggregate in the state list', fallback.airports.every(a=>!a.isMetroArea));

  // No state means nothing to fall back to.
  const nostate=h.run("getAirportsForCity('NOWHERESVILLE')");
  ok('unknown city with no state -> none', nostate.matchType==='none', nostate.matchType);
  ok('and an empty list, not a throw', nostate.airports.length===0);

  // The tier must survive into the priced-options payload, or the UI cannot
  // explain why it is showing four Texas airports for Fort Worth.
  const priced=h.run("getPricedDestinationOptions('ORD','FORT WORTH','TX')");
  ok('priced options carry matchType', priced.matchType==='alias', priced.matchType);
  ok('priced options carry requestedCity', priced.requestedCity==='FORT WORTH', priced.requestedCity);
}

console.log('14. negative control: removing the flushes must reproduce the bug');
{
  const src=fs.readFileSync('lets_app/server/30_services/AirportPrefs.js','utf8');
  const broken=src.split('      SpreadsheetApp.flush();').join('      // flush removed');
  if(broken===src){ ok('negative control patched AirportPrefs',false); }
  else{
    const committed=[]; let pending=[];
    const flush=()=>{pending.forEach(o=>o());pending=[];};
    const sheets={City_Pairs:{getLastRow:()=>1+CPROWS.length,
      getRange:(r,c,nr,nc)=>({getValues:()=>CPROWS.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc))})},
     Traveler_Airport_Prefs:{getLastRow:()=>1+committed.length,
      getRange:(r,c,nr,nc)=>({getValues:()=>committed.slice(r-2,r-2+nr).map(x=>x.slice(c-1,c-1+nc)),
        setValue:v=>{pending.push(()=>{committed[r-2][c-1]=v;});},
        setValues:vals=>{pending.push(()=>{for(let i=0;i<vals.length;i++)committed[r-2+i]=vals[i].slice();});}}),
      appendRow:row=>{pending.push(()=>committed.push(row.slice()));}}};
    const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
     SpreadsheetApp:{openById:()=>({getSheetByName:n=>sheets[n]||null}),flush:flush},
     LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
     CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
     PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
     Session:{getActiveUser:()=>({getEmail:()=>'t@gsa.gov'})}};
    const c4=vm.createContext(sb);
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",c4);
    for(const f of ['01_constants/Cache.js','01_constants/Costs.js','01_constants/Sheets.js',
      '91_setup/CityPairSync.js','30_services/CityPairs.js'])
      vm.runInContext(fs.readFileSync('lets_app/server/'+f,'utf8'),c4);
    vm.runInContext(broken,c4,{filename:'AirportPrefs.js (no flush)'});
    vm.runInContext("recordAirportPreference('nf','HOME_ORIGIN','DCA')",c4);
    const second=vm.runInContext("recordAirportPreference('nf','HOME_ORIGIN','DCA')",c4);
    ok('without flush, the second call wrongly reports first use',
       second.useCount===1, second);
  }
}

console.log('15. negative control: the metro sort');
{
  const src=fs.readFileSync('lets_app/server/30_services/CityPairs.js','utf8');
  // Patch out ONLY the metro discriminator, leaving the route-count sort. Keyed
  // on the single line rather than a multi-line block, so extracting or
  // reindenting rank() cannot silently break the control.
  const broken=src.replace(
    "if (a.isMetroArea !== b.isMetroArea) return a.isMetroArea ? 1 : -1;",
    "// metro discriminator removed");
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
