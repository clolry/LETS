/**
 * Automated Verification Script for the HR roster editor.
 *
 * WHY THIS EXISTS
 * ---------------
 * HC_Positions backs the HC namespace that 28 call sites depend on: traveller
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
      hcGetOrgHierarchy: function(){ return []; },
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
