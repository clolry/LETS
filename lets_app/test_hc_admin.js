/**
 * Automated Verification Script for the HR roster editor.
 *
 * WHY THIS EXISTS
 * ---------------
 * HC_Positions backs the HC namespace that 28 call sites depend on: traveler
 * lookup, duty station, GS-15 Division Director routing, and two of the three
 * site-access paths in canAccessTrip.
 *
 * It was hand-edited in the spreadsheet, which is how three defects get
 * introduced — and all three fail SILENTLY:
 *
 *   §2  Grade losing its leading zero. A cell holding 07 becomes the number 7,
 *       and String(7) !== '07', so a GS-07 fails every grade comparison in the
 *       system. docs/GAP_CONSOLIDATION_PASS6.md VT-03 predicted this exactly.
 *   §3  A supervisor cycle. Without the visited-set in hcWalkSupervisorChain
 *       that is an infinite loop inside a web request — a hung page, not an
 *       error.
 *   §5  A staffed seat with no email, which cannot be notified and cannot be
 *       matched by canAccessTrip.
 *
 * SECTION 6 IS THE ONE THAT MATTERS MOST. An invalid write is refused
 * ENTIRELY. A half-applied edit to HR data is worse than no edit: it produces
 * the dangling references and cycles this editor exists to prevent.
 *
 * Section 1 asserts every entry point guards independently. Apps Script makes
 * every top-level function browser-callable (G-001), so the admin page's own
 * gate protects the page, not these functions.
 *
 * Section 8 covers deactivation refusing to orphan a subtree, and that it sets
 * Is_Active=false rather than deleting — Request_Travelers rows carry
 * Budget_Org_Code and the approval log references positions by number, so
 * removing a row turns a past request's attribution into a dangling reference.
 *
 * Section 10 checks the UI removes the OPPORTUNITY for error rather than only
 * reporting it: Grade is a select of zero-padded values, Reports To is a
 * dropdown of real positions, Supervisory_Status offers only the one
 * meaningful code, and Position_Number is read-only once set because it is the
 * join key for the entire supervisor tree.
 *
 * Run: node lets_app/test_hc_admin.js
 */

// HC roster editor. Its job is to make three silent-failure defects
// impossible, not to be convenient.
const fs=require('fs'),vm=require('vm');
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x).slice(0,220));fails++;}};

function srv(opts){
  opts=opts||{};
  const positions=(opts.positions||[]).map(p=>Object.assign({},p));
  const writes=[];
  const headers=['Position_Number','Reports_To_Position_Number','Employee_ID','Employee_Name',
    'Email_Address','Org_Code','Office_Title','Grade','Supervisory_Status','Occupancy_Status',
    'LCAT','Location_Code','Duty_Station_Address','Duty_Station_City','Duty_Station_State',
    'Is_Active','Created_By','Created_At','Updated_By','Updated_At'];
  const rows=positions.map(p=>headers.map(h=>{
    const m={Position_Number:p.positionNumber,Reports_To_Position_Number:p.reportsToPositionNumber,
      Employee_Name:p.employeeName,Grade:p.grade,Supervisory_Status:p.supervisoryStatus,
      Occupancy_Status:p.occupancyStatus,Is_Active:true};
    return h in m ? (m[h]===undefined?'':m[h]) : '';
  }));
  const sheet={
    getLastRow:()=>1+rows.length, getLastColumn:()=>headers.length,
    getRange:(r,c,nr,nc)=>({
      getValues:()=>{
        const all=[headers].concat(rows);
        return all.slice(r-1,r-1+(nr||1)).map(x=>x.slice(c-1,c-1+(nc||1)));
      },
      setValue:v=>{writes.push({r,c,v});},
      setValues:v=>{writes.push({r,c,v});},
      setNumberFormat:f=>{writes.push({r,c,format:f});}
    })
  };
  const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,
    parseFloat,parseInt,isNaN,RegExp,Error,
    SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='HC_Positions'?sheet:null}),flush:()=>{}},
    LockService:{getScriptLock:()=>({waitLock:()=>{if(opts.lockFails)throw new Error('busy');},releaseLock:()=>{}})},
    Session:{getActiveUser:()=>({getEmail:()=>opts.user===undefined?'chris@gsa.gov':opts.user})},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
    CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{},removeAll:()=>{}})}};
  const ctx=vm.createContext(sb);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x'; var LOCK_TIMEOUT_MS=30000;",ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),ctx);
  let invalidated=0;
  vm.runInContext(`
    function isTravelAdmin(e){ return ${opts.isAdmin===false?'false':'true'}; }
    var __positions = ${JSON.stringify(positions)};
    var HC = {
      hcGetBundle: function(){ return ${opts.bundleFails
        ? "{success:false,error:'no tabs',data:[]}"
        : "{success:true,data:__positions,count:__positions.length}"}; },
      hcGetOrgHierarchy: function(){ return ${JSON.stringify(opts.orgs||[])}; },
      hcCacheInvalidateAll: function(){ globalThis.__invalidated=(globalThis.__invalidated||0)+1; return true; }
    };
    function validateHCData(){ return {success:true,problems:${JSON.stringify(opts.problems||[])}}; }
  `,ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/40_domain/HCAdmin.js','utf8'),ctx);
  return {run:e=>vm.runInContext(e,ctx),writes,
    invalidated:()=>vm.runInContext('globalThis.__invalidated||0',ctx)};
}

const ROSTER=[
  {positionNumber:'FC-0001',reportsToPositionNumber:'',employeeName:'Top Boss',
   emailAddress:'top@example.gov',grade:'SES',supervisoryStatus:'2',occupancyStatus:'FILLED',orgCode:'FC'},
  {positionNumber:'FCA-0001',reportsToPositionNumber:'FC-0001',employeeName:'Dee Director',
   emailAddress:'dee@example.gov',grade:'15',supervisoryStatus:'2',occupancyStatus:'FILLED',orgCode:'FCA'},
  {positionNumber:'FCA-0002',reportsToPositionNumber:'FCA-0001',employeeName:'Stan Staff',
   emailAddress:'stan@example.gov',grade:'13',supervisoryStatus:'',occupancyStatus:'FILLED',orgCode:'FCA'}
];

console.log('1. every entry point refuses a non-admin');
{
  // These functions are browser-reachable (G-001), so a guard inside each is
  // the only real protection — the admin page's gate protects the page.
  const h=srv({isAdmin:false,positions:ROSTER});
  ['getHCAdminData()','refreshHCAdminData()',
   "saveHCPosition({positionNumber:'X'})","deactivateHCPosition('FCA-0002')"].forEach(call=>{
    const r=h.run(call);
    ok(call.split('(')[0]+' refused', r.success===false && /[Aa]dministrator/.test(r.error||''), r);
  });
  ok('nothing written', h.writes.length===0, h.writes.length);
  const noUser=srv({user:'',positions:ROSTER});
  ok('no active user refused', noUser.run('getHCAdminData()').success===false);
}

console.log('2. Grade must be zero-padded (the VT-03 defect)');
{
  const h=srv({positions:ROSTER});
  const v=(p)=>h.run('validateHCPosition('+JSON.stringify(p)+',__positions)');
  // A cell holding 07 becomes the number 7, and String(7) !== '07', so a GS-07
  // fails every grade comparison including the GS-15 DD lookup.
  const bad=v({positionNumber:'NEW-1',grade:'7'});
  ok('single-digit grade rejected', bad.some(m=>/must be written as "07"/.test(m)), bad);
  ok('and explains the consequence', bad.some(m=>/fails every grade check/.test(m)));
  ok('zero-padded accepted', v({positionNumber:'NEW-1',grade:'07'}).length===0);
  ok('two-digit accepted', v({positionNumber:'NEW-1',grade:'15'}).length===0);
  ok('SES accepted', v({positionNumber:'NEW-1',grade:'SES'}).length===0);
}

console.log('3. supervisor cycles are refused');
{
  const h=srv({positions:ROSTER});
  const v=(p,orig)=>h.run('validateHCPosition('+JSON.stringify(p)+',__positions'+
    (orig?','+JSON.stringify(orig):'')+')');
  // Without the visited-set in hcWalkSupervisorChain a cycle is an infinite
  // loop inside a web request — a hung page, not an error.
  const direct=v({positionNumber:'FC-0001',reportsToPositionNumber:'FCA-0002'},'FC-0001');
  ok('indirect cycle caught', direct.some(m=>/supervisor cycle/.test(m)), direct);
  ok('and names both ends', direct.some(m=>/FC-0001/.test(m) && /FCA-0002/.test(m)));
  const self=v({positionNumber:'FCA-0001',reportsToPositionNumber:'FCA-0001'},'FCA-0001');
  ok('self-reference caught', self.some(m=>/cannot report to itself/.test(m)), self);
  ok('a valid chain is accepted',
     v({positionNumber:'NEW-1',reportsToPositionNumber:'FCA-0001'}).length===0);
}

console.log('4. dangling references and duplicate keys are refused');
{
  const h=srv({positions:ROSTER});
  const v=(p,orig)=>h.run('validateHCPosition('+JSON.stringify(p)+',__positions'+
    (orig?','+JSON.stringify(orig):'')+')');
  const dangling=v({positionNumber:'NEW-1',reportsToPositionNumber:'NOPE'});
  ok('nonexistent supervisor caught', dangling.some(m=>/does not exist/.test(m)), dangling);
  ok('explains the routing consequence',
     dangling.some(m=>/no Division Director/.test(m)));
  const dup=v({positionNumber:'FCA-0001'});
  ok('duplicate position number caught', dup.some(m=>/already exists/.test(m)), dup);
  // A duplicate makes the earlier person invisible to every lookup.
  ok('explains why that matters', dup.some(m=>/invisible/.test(m)));
  // Editing a row must be able to keep its own key.
  ok('editing keeps its own key',
     v({positionNumber:'FCA-0001',grade:'15'},'FCA-0001').length===0);
}

console.log('5. a staffed seat needs an email');
{
  const h=srv({positions:ROSTER});
  const v=(p)=>h.run('validateHCPosition('+JSON.stringify(p)+',__positions)');
  // Without one the person cannot be notified and cannot be matched by
  // canAccessTrip.
  const noEmail=v({positionNumber:'NEW-1',employeeName:'Someone',occupancyStatus:'FILLED'});
  ok('missing email caught', noEmail.some(m=>/needs an Email Address/.test(m)), noEmail);
  ok('vacant seat exempt',
     v({positionNumber:'NEW-1',employeeName:'',occupancyStatus:'VACANT'}).length===0);
  ok('malformed email caught',
     v({positionNumber:'NEW-1',employeeName:'X',emailAddress:'notanemail'})
       .some(m=>/is not an email address/.test(m)));
}

console.log('5b. hierarchical org codes');
{
  // @clolry: "Our org has hundreds of different codes under FC." The codes are
  // hierarchical — FCA0A sits under FCA under FC — and only the top-level
  // codes carry a budget office key.
  //
  // The rule here used to be an exact match against a HARDCODED
  // ['FC','FCA','FCB','FCC'], so every real code was rejected. @clolry typed
  // FCA0A-0008 into the sheet and the roster page reported a problem that the
  // editor could not fix, because its Org field was a four-option dropdown.
  const h=srv({positions:ROSTER});
  const v=(p)=>h.run('validateHCPosition('+JSON.stringify(p)+',__positions)');

  ok('a sub-org code is accepted',
     v({positionNumber:'NEW-1',orgCode:'FCA0A'}).filter(m=>/Org Code/.test(m)).length===0,
     v({positionNumber:'NEW-1',orgCode:'FCA0A'}));
  ok('a deeper sub-org code is accepted',
     v({positionNumber:'NEW-1',orgCode:'FCB1234'}).filter(m=>/Org Code/.test(m)).length===0);
  ok('a top-level code is still accepted',
     v({positionNumber:'NEW-1',orgCode:'FCA'}).filter(m=>/Org Code/.test(m)).length===0);
  ok('lowercase is accepted',
     v({positionNumber:'NEW-1',orgCode:'fca0a'}).filter(m=>/Org Code/.test(m)).length===0);

  // A code matching no parent prefix is a typo and must still be caught —
  // otherwise this change has just deleted the validation.
  const bad=v({positionNumber:'NEW-1',orgCode:'XX99'});
  ok('a code matching no parent is still rejected',
     bad.some(m=>/does not start with any known org code/.test(m)), bad);
  ok('and the message explains the hierarchy',
     bad.some(m=>/FCA0A attributes to FCA/.test(m)), bad);
  // With 137 codes loaded, listing them all makes the message unreadable.
  ok('it names the four top-level codes, not all 137',
     bad.some(m=>/none of FC, FCA, FCB, FCC/.test(m)), bad);
  ok('and says how to populate HC_Orgs if it is empty',
     bad.some(m=>/loadRealOrgCodes\(\)/.test(m)), bad);

  // The known codes must come from HC_Orgs, not a literal in the validator —
  // a new org should not need a code change.
  const h2=srv({positions:ROSTER,orgs:[{orgCode:'ZZ'},{orgCode:'ZZA'}]});
  const r=h2.run("saveHCPosition({positionNumber:'NEW-9',grade:'12',orgCode:'ZZA7'})");
  ok('codes are sourced from HC_Orgs, not hardcoded',
     !(r.problems||[]).some(m=>/Org Code/.test(m)), r.problems);
  const r2=h2.run("saveHCPosition({positionNumber:'NEW-9',grade:'12',orgCode:'FCA'})");
  ok('and a code absent from HC_Orgs is rejected even if it was once hardcoded',
     (r2.problems||[]).some(m=>/Org Code/.test(m)), r2.problems);
}

console.log('5c. the ROSTER PAGE validator applies the same rule');
{
  // This is the banner @clolry actually saw: "Position FCA0A-0008 has Org_Code
  // FCA0A with no matching HC_Orgs row. Business unit and sector will be
  // blank" — "but I don't know how to fix this using the GUI."
  //
  // validateHCData lives in HCSeed.js and had its OWN exact-match check,
  // separate from the join in HCData.js and the write-time check in HCAdmin.js.
  // Three implementations of one rule; fixing two of them would have left the
  // banner lying.
  function seed(positions, orgs) {
    const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,
      Math,parseFloat,parseInt,isNaN,RegExp,Error,
      SpreadsheetApp:{openById:()=>({getSheetByName:()=>null}),flush:()=>{}},
      Session:{getActiveUser:()=>({getEmail:()=>'chris@gsa.gov'})},
      PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
      CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{},removeAll:()=>{}})}};
    const ctx=vm.createContext(sb);
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",ctx);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),ctx);
    vm.runInContext(`
      function isTravelAdmin(){ return true; }
      var HC = {
        hcGetBundle: function(){ return {success:true,data:${JSON.stringify(positions)}}; },
        hcGetOrgHierarchy: function(){ return ${JSON.stringify(orgs)}; }
      };
    `,ctx);
    vm.runInContext(fs.readFileSync('lets_app/server/91_setup/HCSeed.js','utf8'),ctx);
    return vm.runInContext('validateHCData()',ctx);
  }

  const ORGS=[{orgCode:'FC'},{orgCode:'FCA'},{orgCode:'FCB'}];
  const orgProblems=(r)=>(r.problems||[]).filter(m=>/Org_Code/.test(m));

  const r1=seed([{positionNumber:'FCA0A-0008',orgCode:'FCA0A',grade:'13',
                  employeeName:'Sub',emailAddress:'s@x.gov',occupancyStatus:'FILLED'}],ORGS);
  ok('FCA0A no longer reported as a problem', orgProblems(r1).length===0, orgProblems(r1));

  // The typo case must still be caught, or the banner has simply gone quiet.
  const r2=seed([{positionNumber:'XX-1',orgCode:'XX99',grade:'13',
                  employeeName:'Typo',emailAddress:'t@x.gov',occupancyStatus:'FILLED'}],ORGS);
  ok('a genuine typo is still reported', orgProblems(r2).length===1, r2.problems);
  ok('and the message says HOW to fix it',
     orgProblems(r2).some(m=>/Fix the code in HC_Positions, or add an HC_Orgs row/.test(m)),
     orgProblems(r2));
  ok('and names the top-level codes that would work',
     orgProblems(r2).some(m=>/none of FC, FCA, FCB/.test(m)), orgProblems(r2));
  // The banner must say how many codes are loaded. @clolry's symptom was a
  // page full of these; "3 codes loaded" would have pointed straight at an
  // unpopulated HC_Orgs instead of at the positions.
  ok('and says how many codes are loaded',
     orgProblems(r2).some(m=>/codes loaded — run loadRealOrgCodes/.test(m)), orgProblems(r2));

  // The GS-15 reachability check must resolve too, or a DAC whose deputy sits
  // in a sub-org is reported as unstaffed.
  const r3=seed([
    {positionNumber:'FCA-0001',orgCode:'FCA0A',grade:'15',employeeName:'Deputy',
     emailAddress:'d@x.gov',occupancyStatus:'FILLED',supervisoryStatus:'2'}
  ],[{orgCode:'FCA',businessUnit:'OMD'}]);
  ok('a GS-15 in a SUB-org counts toward its parent',
     !(r3.problems||[]).some(m=>/no staffed GS-15|GS-15/.test(m)), r3.problems);
}

console.log('5d. the EDITOR\'s resolution preview agrees with the SERVER');
{
  // _updateOrgResolution reimplements the server's two lookups in the browser,
  // because the preview must update as the user types. A reimplementation that
  // disagrees is worse than no preview: the editor would promise an
  // attribution the server does not make.
  //
  // So this runs the REAL client function against the REAL 137 codes and
  // compares it to what HCData actually produces.
  const src=fs.readFileSync('lets_app/client/controllers/admin/travelRosterController.html','utf8');
  const body=(src.match(/<script>([\s\S]*)<\/script>/)||[])[1]||'';

  // Load @clolry's real list from HCSeed, the same table that gets written.
  const seedCtx=vm.createContext({console:{log(){},warn(){},error(){}},
    JSON,Date,Object,String,Number,Array,Math,RegExp,Error});
  vm.runInContext('var TRAVEL_DB_SPREADSHEET_ID=null; var SHEET_NAMES={}; '+
                  'var TRAVEL_SHEET_SCHEMAS={}; var HC={};',seedCtx);
  vm.runInContext(fs.readFileSync('lets_app/server/91_setup/HCSeed.js','utf8'),seedCtx);
  const real=vm.runInContext('hcRealOrgRecords()',seedCtx).map(o=>({
    orgCode:o.orgCode, officeCode:o.officeCode, division:o.division
  }));

  // Minimal DOM: two elements the function reads and writes.
  const els={rfOrgCode:{value:''}, rfOrgResolution:{textContent:'',className:''}};
  const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,
    Math,RegExp,Error,escapeHtml:x=>String(x),
    document:{getElementById:id=>els[id]||null,
              querySelectorAll:()=>[],addEventListener(){}},
    window:{}, setTimeout(){}, clearTimeout(){}};
  const ctx=vm.createContext(sb);
  vm.runInContext(body,ctx);
  const Ctl=vm.runInContext('window.TravelRoster && window.TravelRoster.Controller',ctx);
  ok('the roster controller is reachable for testing', !!Ctl);

  if (Ctl) {
    Ctl._orgs=real; Ctl._offices=[];
    const preview=(code)=>{ els.rfOrgCode.value=code;
      Ctl._updateOrgResolution(); return els.rfOrgResolution; };

    // Identity DOWN, attribution UP — the distinction the whole scheme rests on.
    const r=preview('FCA0A');
    ok('names the sub-org itself', /Portfolio Management Service Center/.test(r.textContent), r.textContent);
    ok('and shows the INHERITED budget key', /budget OMD via FCA/.test(r.textContent), r.textContent);
    ok('not flagged as an error', !/--bad/.test(r.className), r.className);

    const top=preview('FCA');
    ok('a top-level code shows its key without "via"',
       /budget OMD/.test(top.textContent) && !/via/.test(top.textContent), top.textContent);

    const typo=preview('XX99');
    ok('a typo is flagged', /--bad/.test(typo.className) && /check for a typo/.test(typo.textContent),
       typo.textContent);

    // A code ABSENT from HC_Orgs but with a real ancestor must still work, and
    // must SAY it is not in the list — @clolry's list is "a bit outdated".
    const unlisted=preview('FCA0AZZ');
    ok('an unlisted sub-code still resolves', /budget OMD/.test(unlisted.textContent), unlisted.textContent);
    ok('and says it is not in HC_Orgs', /not in HC_Orgs/.test(unlisted.textContent), unlisted.textContent);

    // THE AGREEMENT CHECK: all 137, client vs server.
    const srvCtx=vm.createContext({console:{log(){},warn(){},error(){}},
      JSON,Date,Object,String,Number,Array,Math,RegExp,Error});
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",srvCtx);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Cache.js','utf8'),srvCtx);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),srvCtx);
    vm.runInContext(fs.readFileSync('lets_app/server/20_data/HCData.js','utf8'),srvCtx);
    const byCode={}; real.forEach(o=>{byCode[o.orgCode]=o;});
    vm.runInContext('var __byCode='+JSON.stringify(byCode)+';',srvCtx);
    const serverKey=(c)=>vm.runInContext(
      "HC.inheritOrgField("+JSON.stringify(c)+",__byCode,'officeCode')",srvCtx);

    const disagree=[];
    real.forEach(o=>{
      const txt=preview(o.orgCode).textContent;
      const shown=(txt.match(/budget ([A-Z]+)/)||[])[1]||'';
      const actual=serverKey(o.orgCode);
      if (shown!==actual) disagree.push(o.orgCode+': editor='+shown+' server='+actual);
    });
    ok('editor and server agree on all 137 budget keys', disagree.length===0, disagree.slice(0,4));
  }
}

console.log('6. an invalid write is refused ENTIRELY, not partially applied');
{
  const h=srv({positions:ROSTER});
  // A half-applied edit to HR data is worse than none: it produces exactly the
  // dangling references this editor exists to prevent.
  const r=h.run("saveHCPosition({positionNumber:'NEW-1',grade:'7',reportsToPositionNumber:'NOPE'})");
  ok('refused', r.success===false, r);
  ok('reports BOTH problems, not just the first', r.problems.length>=2, r.problems);
  ok('nothing written to the sheet', h.writes.length===0, h.writes.length);
  ok('cache not invalidated', h.invalidated()===0);
}

console.log('7. a valid write lands and invalidates the cache');
{
  const h=srv({positions:ROSTER});
  const r=h.run("saveHCPosition({positionNumber:'FCA-0003',employeeName:'New Person'," +
    "emailAddress:'new@example.gov',grade:'12',orgCode:'FCA'," +
    "reportsToPositionNumber:'FCA-0001',occupancyStatus:'FILLED'})");
  ok('succeeded', r.success===true, r);
  ok('reported as created', r.created===true);
  ok('wrote to the sheet', h.writes.some(w=>w.v && Array.isArray(w.v)), h.writes.length);
  // The bundle caches for six hours; without invalidation the edit is
  // invisible for long enough to look like the save failed.
  ok('cache invalidated', h.invalidated()===1, h.invalidated());
  // Position_Number, Employee_ID and Grade carry leading zeros.
  ok('identifier columns pinned to text',
     h.writes.filter(w=>w.format==='@').length===3,
     h.writes.filter(w=>w.format==='@').length);
}

console.log('8. deactivate refuses to orphan a subtree');
{
  const h=srv({positions:ROSTER});
  // FCA-0001 has a dependent. Deactivating it would leave FCA-0002 with no
  // supervisor, and approval routing would find no Division Director.
  const blocked=h.run("deactivateHCPosition('FCA-0001')");
  ok('refused', blocked.success===false, blocked);
  ok('names the dependents', /FCA-0002/.test(blocked.problems[0]), blocked.problems);
  ok('explains the routing consequence', /Division Director/.test(blocked.problems[0]));
  ok('nothing written', h.writes.length===0);

  // A leaf is fine.
  const h2=srv({positions:ROSTER});
  const leaf=h2.run("deactivateHCPosition('FCA-0002')");
  ok('a leaf deactivates', leaf.success===true, leaf);
  ok('sets Is_Active false, does not delete',
     h2.writes.some(w=>w.v===false), h2.writes);
  ok('cache invalidated', h2.invalidated()===1);
}

console.log('9. concurrent edits are serialized');
{
  const h=srv({positions:ROSTER,lockFails:true});
  const r=h.run("saveHCPosition({positionNumber:'NEW-1',employeeName:'X'," +
    "emailAddress:'x@example.gov',grade:'12'})");
  ok('lock timeout refuses rather than racing', r.success===false, r);
  ok('says so usefully', /Another edit is in progress/.test(r.error), r.error);
  ok('nothing written', h.writes.length===0);
}

console.log('10. the editor removes the opportunity for error, not just the error');
{
  const src=fs.readFileSync('lets_app/client/controllers/admin/travelRosterController.html','utf8');
  // Grade as a SELECT of zero-padded values: a text field accepts "7".
  ok('grade is a select', /_populateGradeSelect/.test(src));
  ok('grade options are zero-padded', /i < 10 \? '0' \+ i/.test(src));
  // Reports To as a dropdown: a text field accepts a nonexistent key.
  ok('reports-to is a dropdown of real positions', /_populateReportsToSelect/.test(src));
  ok('excludes the current row', /p\.positionNumber !== excludePositionNumber/.test(src));
  // Position number is the join key for the whole tree.
  ok('position number is read-only when editing', /pnInput\.readOnly = !!positionNumber/.test(src));
  const page=fs.readFileSync('lets_app/client/pages/travelAdminPage.html','utf8');
  // Org Code is the ONE field that must NOT be a closed dropdown. It was one,
  // of four options, which is why @clolry had to type FCA0A-0008 into the
  // sheet directly — the editor could not express it.
  ok('org code is free text, not a four-option select',
     /id="rfOrgCode"[^>]*list="rfOrgCodeList"/.test(page) &&
     !/<select[^>]*id="rfOrgCode"/.test(page));
  ok('with a datalist of the known codes', /<datalist id="rfOrgCodeList">/.test(page));
  // Built from _orgs (all 137 HC_Orgs rows), not _offices (the four budget
  // offices). Using _offices is what made this a four-option dropdown.
  ok('populated from HC_Orgs, not the four budget offices',
     /this\._orgs && this\._orgs\.length\) \? this\._orgs : this\._offices/.test(src));
  // Typing FCA0A must show WHICH parent it will attribute to, or the user
  // cannot tell a working sub-org from a typo.
  ok('and shows what a typed code resolves to',
     /id="rfOrgResolution"/.test(page) && /_updateOrgResolution/.test(src));
  ok('resolution prefers the LONGEST prefix',
     /b\.orgCode\.length - a\.orgCode\.length/.test(src),
     'FC is a prefix of every code and must not win');

  // THE FIX MUST BE REACHABLE FROM THE GUI. @clolry's words: "I don't know
  // how to fix this using the GUI." loadRealOrgCodes is @editor — Apps Script
  // console only — so leaving the remedy there reproduces the complaint.
  ok('a Load Org Codes button exists', /id="rosterLoadOrgsBtn"/.test(page));
  ok('wired to a handler', /rosterLoadOrgsBtn/.test(src) && /loadOrgCodes: function/.test(src));
  ok('which calls the admin-guarded server function',
     /serverCall\('hcLoadRealOrgCodes'\)/.test(src));
  ok('confirms first, because it REPLACES HC_Orgs',
     /window\.confirm\(/.test(src) && /will be overwritten/.test(src));
  // Without a cache bypass the warnings appear not to have cleared.
  ok('and reloads bypassing the cache', /self\.load\(true\)/.test(src));

  const adm=fs.readFileSync('lets_app/server/40_domain/HCAdmin.js','utf8');
  ok('the server entry point is admin-guarded',
     /function hcLoadRealOrgCodes\(\)\s*\{\s*var denied = _hcAdminGuard_\(\);/.test(adm));
  ok('and takes the same lock as saveHCPosition',
     /function hcLoadRealOrgCodes[\s\S]{0,900}?LockService\.getScriptLock/.test(adm),
     'saveHCPosition reads HC_Orgs to validate, so a concurrent replace would race');

  ok('supervisory status offers only the meaningful value',
     /<option value="2">2 — Supervisor<\/option>/.test(page));
  ok('and says what it grants', /[Gg]rants LETS access on its own/.test(page));
  ok('roster view is wired into the admin nav', /data-view="roster"/.test(page));
  const admin=fs.readFileSync('lets_app/client/controllers/admin/travelAdminController.html','utf8');
  ok('view map includes roster', /'roster': 'rosterView'/.test(admin));
  ok('activates the module', /TravelRoster\.Controller\.activate\(\)/.test(admin));
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
