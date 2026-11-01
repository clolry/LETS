/**
 * Automated Verification Script for the Trip Overview fields.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Six Trip Overview inputs existed in the request form for the entire life of
 * the budget layer and were NEVER COLLECTED. No getElementById call read them
 * and the Requests schema had no column to hold them, so every Owning Office,
 * Purpose of Travel and Set-Aside selection was silently discarded at
 * submission.
 *
 * That is also why RequestService.createTravelRequest and
 * BudgetEngine.evaluateBudgetCheck have no callers: the travel form and the
 * budget engine were two disconnected systems living in one project. These
 * columns are the join, so the checks here are the foundation for per-person
 * budget attribution rather than a feature in themselves.
 *
 * Section 2 is the one that would catch a real corruption. Writes are
 * POSITIONAL (docs/DATA_DICTIONARY.md §3.9), so a row one value short shifts
 * every column after it. That already happened once — Submission.js wrote 38
 * values into a 40-column schema because DD_Confirmed and DD_Confirmed_At were
 * omitted, and it stayed invisible because the two missing columns were last.
 * This parses the actual row literals and compares their width to the schema.
 *
 * Section 3 pins the office/org mapping on BOTH sides. It is duplicated
 * client and server deliberately: a submission must produce a complete row
 * even if the client omits the derived field, and a server that trusts the
 * client to map its own budget codes can be sent any value at all. The two
 * copies are asserted to agree, because one being wrong would store one code
 * form correctly and the other wrongly.
 *
 * Unknown codes map to '' rather than echoing the input. A wrong org code
 * attributes budget to the wrong DAC; an empty one reads as missing.
 *
 * Run: node lets_app/test_trip_overview.js
 */

// Trip Overview fields: previously rendered but never collected or stored.
const fs=require('fs'),vm=require('vm');
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':String(x).slice(0,200));fails++;}};

console.log('1. schema has somewhere to put them');
{
  const ctx=vm.createContext({console});
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),ctx);
  const S=vm.runInContext('TRAVEL_SHEET_SCHEMAS',ctx);
  ['Owning_Office','Owning_Org_Code','Travel_Purpose','Travel_Purpose_Label',
   'Set_Aside_Type','Is_Event_Plan_Item','Is_LC_Travel','Is_COE_Travel',
   'Primary_Justification','Traveler_Org_Codes'].forEach(c=>{
    ok('Requests has '+c, S.Requests.indexOf(c)>-1);
  });
  // Per-traveller, because a consolidated request draws on several orgs.
  ok('Request_Travelers has Budget_Org_Code', S.Request_Travelers.indexOf('Budget_Org_Code')>-1);
  ok('Request_Travelers has Budget_Office_Code', S.Request_Travelers.indexOf('Budget_Office_Code')>-1);
  // Column order is load-bearing: writes are positional.
  ok('new Requests cols are appended last',
     S.Requests.indexOf('Traveler_Org_Codes')===S.Requests.length-1);
  ok('new traveler cols are appended last',
     S.Request_Travelers.indexOf('Budget_Office_Code')===S.Request_Travelers.length-1);
}

console.log('2. submission row width matches the schema exactly');
{
  const ctx=vm.createContext({console});
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),ctx);
  const S=vm.runInContext('TRAVEL_SHEET_SCHEMAS',ctx);
  const s=fs.readFileSync('lets_app/server/40_domain/Submission.js','utf8');
  function countValues(open, close, from){
    const i=s.indexOf(open, from);
    const j=s.indexOf(close, i);
    const block=s.slice(i+open.length, j);
    const nc=block.split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');
    let depth=0,count=1;
    for(const ch of nc){ if('([{'.includes(ch))depth++; else if(')]}'.includes(ch))depth--; else if(ch===','&&depth===0)count++; }
    return count;
  }
  // Writes are POSITIONAL. A row one value short shifts every later column,
  // which is how DD_Confirmed being omitted stayed invisible.
  const reqCount=countValues('const requestRow = [','\n    ];',0);
  ok('requestRow matches Requests', reqCount===S.Requests.length, 'row='+reqCount+' schema='+S.Requests.length);
  const travCount=countValues('travelerRows.push([','      ]);',0);
  ok('travelerRow matches Request_Travelers', travCount===S.Request_Travelers.length,
     'row='+travCount+' schema='+S.Request_Travelers.length);
}

console.log('3. office <-> org code mapping');
{
  // Two namespaces for the same four offices. Duplicated on client and server
  // deliberately: a server that trusts the client to map its own budget codes
  // can be sent anything.
  const src=fs.readFileSync('lets_app/client/shared/travelUtils.html','utf8');
  const js=/<script[^>]*>([\s\S]*)<\/script>/.exec(src)[1];
  const sb={console,document:{addEventListener(){}}}; sb.window=sb;
  const ctx=vm.createContext(sb); vm.runInContext(js,ctx);
  const U=vm.runInContext('window.TravelUtils',ctx);
  ok('FO -> FC', U.officeCodeToOrgCode('FO')==='FC');
  ok('OMD -> FCA', U.officeCodeToOrgCode('OMD')==='FCA');
  ok('IDV -> FCB', U.officeCodeToOrgCode('IDV')==='FCB');
  ok('CM -> FCC', U.officeCodeToOrgCode('CM')==='FCC');
  ok('FCA -> OMD', U.orgCodeToOfficeCode('FCA')==='OMD');
  // Returning '' rather than echoing: a wrong org code attributes budget to
  // the wrong DAC, which is worse than an empty one that reads as missing.
  ok('unknown office -> empty, not echoed', U.officeCodeToOrgCode('XX')==='');
  ok('unknown org -> empty', U.orgCodeToOfficeCode('ZZZ')==='');
  ok('lowercase accepted', U.officeCodeToOrgCode('omd')==='FCA');
  ok('display name by org code', U.officeDisplayName('FCB')==='IDV DAC');
  ok('display name by office code', U.officeDisplayName('CM')==='CM DAC');

  // Server copy must agree, or a request stores one code form correctly and
  // the other wrongly.
  const srv=fs.readFileSync('lets_app/server/40_domain/Submission.js','utf8');
  const ctx2=vm.createContext({console});
  const i=srv.indexOf('var LETS_OFFICE_MAP');
  const j=srv.indexOf('function _distinctTravelerOrgCodes_');
  const k=srv.indexOf('\n}', j);
  vm.runInContext(srv.slice(i, k+2), ctx2);
  ['FO','OMD','IDV','CM'].forEach(code=>{
    ok('server agrees on '+code,
       vm.runInContext("_officeCodeToOrgCode_('"+code+"')",ctx2)===U.officeCodeToOrgCode(code));
  });
  ok('server unknown -> empty', vm.runInContext("_officeCodeToOrgCode_('XX')",ctx2)==='');
  const d=vm.runInContext("_distinctTravelerOrgCodes_([{orgCode:'FCA'},{orgCode:'FCB'},{orgCode:'FCA'},{}])",ctx2);
  ok('distinct org codes, first-seen order', d.join(',')==='FCA,FCB', d);
  ok('blank org codes dropped', vm.runInContext("_distinctTravelerOrgCodes_([{},{orgCode:''}]).length",ctx2)===0);
}

console.log('4. the form now collects what it renders');
{
  const c=fs.readFileSync('lets_app/client/controllers/form/travelRequestController.html','utf8');
  ['owningOffice','travelPurpose','setAsideType','isEventPlanItem','is_LC_Travel','is_COE_Travel']
    .forEach(id=>{
      ok(id+' is cached', c.indexOf("document.getElementById('"+id+"')")>-1);
    });
  ok('owningOffice is stored', /updateField\('owningOffice'/.test(c));
  ok('org code derived alongside', /updateField\('owningOrgCode'/.test(c));
  // The tracker wants prose, not a code; resolving server-side would
  // duplicate the option list.
  ok('purpose label stored too', /updateField\('travelPurposeLabel'/.test(c));
  ok('owningOffice is validated as required', /Please select an owning office/.test(c));
  ok('purpose is validated as required', /Please select a purpose of travel/.test(c));

  const st=fs.readFileSync('lets_app/client/controllers/form/travelRequestState.html','utf8');
  ['owningOffice','owningOrgCode','travelPurpose','travelPurposeLabel','setAsideType',
   'isEventPlanItem','is_LC_Travel','is_COE_Travel','primaryJustification'].forEach(f=>{
    ok('state has '+f, new RegExp('\\b'+f+':').test(st));
  });
  ok('setAsideType defaults to NONE', /setAsideType: 'NONE'/.test(st));
}

console.log('5. the dropdown shows both code forms');
{
  const pg=fs.readFileSync('lets_app/client/pages/travelRequestPage.html','utf8');
  ok('FCA labelled beside OMD', /value="OMD">FCA/.test(pg));
  ok('FCB labelled beside IDV', /value="IDV">FCB/.test(pg));
  ok('FCC labelled beside CM', /value="CM">FCC/.test(pg));
  ok('FC labelled beside FO', /value="FO">FC/.test(pg));
  // The VALUE stays the BudgetConfig.js key — changing it would break
  // allocation lookups.
  ok('values remain office codes', /value="OMD"/.test(pg) && !/value="FCA"/.test(pg));
}

console.log('6. review reads the new fields back');
{
  const r=fs.readFileSync('lets_app/server/40_domain/Review_Read.js','utf8');
  ok('owningOffice read', /owningOffice: requestRow\[reqIndex\['Owning_Office'\]\]/.test(r));
  ok('travelerOrgCodes parsed to an array', /travelerOrgCodes: String\(/.test(r));
  ok('per-traveller budget org read', /budgetOrgCode: travelersRows/.test(r));
  // Old rows have no values. Falling back to the request's owning office
  // would show a reviewer a guess rather than a recorded fact.
  ok('no fallback to owning office', !/budgetOrgCode:.*owningOffice/.test(r));
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
