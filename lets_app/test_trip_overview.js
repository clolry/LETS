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
  // Per-traveler, because a consolidated request draws on several orgs.
  ok('Request_Travelers has Budget_Org_Code', S.Request_Travelers.indexOf('Budget_Org_Code')>-1);
  ok('Request_Travelers has Budget_Office_Code', S.Request_Travelers.indexOf('Budget_Office_Code')>-1);
  // Column order is load-bearing: writes are positional.
  //
  // This asserted that Traveler_Org_Codes was the LAST column, which only
  // held until the next feature appended anything. The twelve reconciliation
  // columns went on after it and this failed — correctly flagging a real
  // positional-width break in Submission.js, then complaining about the
  // column order itself, which was fine.
  //
  // The INVARIANT is that the trip-overview columns form a contiguous block
  // appended AFTER the original 42, not that any one of them is last. Stated
  // that way it survives the next append.
  const TRIP_BLOCK = ['Owning_Office','Owning_Org_Code','Travel_Purpose',
    'Travel_Purpose_Label','Set_Aside_Type','Is_Event_Plan_Item','Is_LC_Travel',
    'Is_COE_Travel','Primary_Justification','Traveler_Org_Codes'];
  const positions = TRIP_BLOCK.map(c=>S.Requests.indexOf(c));
  ok('the trip-overview columns are contiguous',
     positions.every((p,i)=>i===0||p===positions[i-1]+1), positions);
  ok('and sit after the original 42 columns', positions[0]===42, positions[0]);

  // Nothing may be inserted BEFORE them either: the eighteen positional
  // readers index from the left.
  ok('no duplicate headers', new Set(S.Requests).size===S.Requests.length);
  ok('new traveler cols are appended last',
     S.Request_Travelers.indexOf('Budget_Office_Code')===S.Request_Travelers.length-1);

  // THE RECONCILIATION BLOCK. @clolry needs actuals against estimates for a
  // monthly Go.gov reconciliation; these carry them. Appended after the trip
  // block for the same positional reason.
  const RECON_BLOCK = ['Gogov_Request_ID','Gogov_Report_Name','Actual_Total',
    'Actual_Source','Actual_Posted_At','Actual_Posted_By','Reconciliation_Status',
    'Reconciliation_Notes','Match_Method','Match_Confirmed_By',
    'Expense_Report_Name','Expense_Report_End_Date',
    // The event catalog link, appended after the reconciliation block for
    // the same positional reason: the eighteen positional readers index from
    // the left, so appending is invisible to them.
    'Event_ID','Event_Proposal_ID'];
  const rpos = RECON_BLOCK.map(c=>S.Requests.indexOf(c));
  ok('every reconciliation column exists', rpos.every(p=>p>-1),
     RECON_BLOCK.filter((c,i)=>rpos[i]===-1));
  ok('they are contiguous', rpos.every((p,i)=>i===0||p===rpos[i-1]+1), rpos);
  ok('and sit after the trip-overview block',
     rpos[0]===S.Requests.indexOf('Traveler_Org_Codes')+1, rpos[0]);
  // Actual_Total must NOT be confused with Grand_Total, which is the estimate.
  ok('the estimate column still exists separately',
     S.Requests.indexOf('Grand_Total')>-1 &&
     S.Requests.indexOf('Grand_Total')<rpos[0],
     'Grand_Total is the ESTIMATE; Actual_Total is what GSA actually paid');

  // THE SOURCE-PROVENANCE BLOCK. The daily liability-log sync needs to know
  // which requests it owns, and the budget dashboard needs to know which
  // fiscal year each cost is charged to.
  //
  // Charged_Fiscal_Year is NOT derivable from the travel dates. @clolry: "The
  // date the expense report is filed is what determines which fiscal year it
  // gets charged to." 11 of the 30 log rows are September 2026 travel and 8
  // were filed in October, so they are FY27 money — about $9,200 that
  // attributing by travel date would push into a closed year.
  const SOURCE_BLOCK = ['Source_System','Source_Row_Key','Source_Row_Number',
    'Source_Synced_At','Charged_Fiscal_Year','Charged_FY_Basis'];
  const spos = SOURCE_BLOCK.map(c=>S.Requests.indexOf(c));
  ok('every source-provenance column exists', spos.every(p=>p>-1),
     SOURCE_BLOCK.filter((c,i)=>spos[i]===-1));
  ok('they are contiguous', spos.every((p,i)=>i===0||p===spos[i-1]+1), spos);
  ok('and sit after the event-catalog link',
     spos[0]===S.Requests.indexOf('Event_Proposal_ID')+1, spos[0]);

  // The basis must be STORED, not inferred. A trip with no expense report yet
  // has a provisional year, and a dashboard that cannot tell provisional from
  // settled will present a guess as a fact.
  ok('the fiscal-year basis is a column of its own',
     S.Requests.indexOf('Charged_FY_Basis') > S.Requests.indexOf('Charged_Fiscal_Year'),
     'the year without its basis is an unqualified claim');
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
  ok('FCA labeled beside OMD', /value="OMD">FCA/.test(pg));
  ok('FCB labeled beside IDV', /value="IDV">FCB/.test(pg));
  ok('FCC labeled beside CM', /value="CM">FCC/.test(pg));
  ok('FC labeled beside FO', /value="FO">FC/.test(pg));
  // The VALUE stays the BudgetConfig.js key — changing it would break
  // allocation lookups.
  ok('values remain office codes', /value="OMD"/.test(pg) && !/value="FCA"/.test(pg));
}

console.log('6. review reads the new fields back');
{
  const r=fs.readFileSync('lets_app/server/40_domain/Review_Read.js','utf8');
  ok('owningOffice read', /owningOffice: requestRow\[reqIndex\['Owning_Office'\]\]/.test(r));
  ok('travelerOrgCodes parsed to an array', /travelerOrgCodes: String\(/.test(r));
  ok('per-traveler budget org read', /budgetOrgCode: travelersRows/.test(r));
  // Old rows have no values. Falling back to the request's owning office
  // would show a reviewer a guess rather than a recorded fact.
  ok('no fallback to owning office', !/budgetOrgCode:.*owningOffice/.test(r));
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
