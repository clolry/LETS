/**
 * Automated Verification Script for the G-008 access-audit controls.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * canAccessTrip() has three allow-paths, and two of them are driven by HR data
 * rather than by anything LETS stores:
 *
 *   1. an active row in Travel_User_Roles        (visible, auditable)
 *   2. an HC position with Supervisory_Status=2  (was invisible)
 *   3. an HC office title naming a BU lead       (was invisible)
 *
 * Paths 2 and 3 returned `true` silently. Access granted by HR data left no
 * trace anywhere, so "who can get in, and why?" could only be answered by
 * reading Access.js — and access appeared or disappeared as the roster changed,
 * with no LETS action and no audit entry. That is docs/GAP_REGISTER.md G-008,
 * rated C4/R2.
 *
 * Three sections carry most of the weight:
 *
 *   §3 — the kill switch closes paths 2 and 3 WITHOUT closing path 1. If a
 *        roster import ever widens access, the explicit role table must remain
 *        a way in; a switch that locked everyone out would never be used.
 *
 *   §4 — the switch FAILS OPEN. Any value other than the exact string 'false'
 *        leaves HR-driven access enabled, because the alternative is denying
 *        every supervisor at once over a typo.
 *
 *   §5 — a logging failure must NEVER deny access. canAccessTrip runs on every
 *        page load. An audit gap is bad; locking the site out because a sheet
 *        write failed is worse.
 *
 * §8 patches the kill-switch check out and asserts access is granted where it
 * should have been denied, so the suite cannot pass with the control removed.
 *
 * HOW IT LOADS THE CODE
 * ---------------------
 * Access.js is ~900 lines with wide dependencies, so only the functions under
 * test are evaluated, with their collaborators (_getUnifiedRolesForEmail,
 * _getUnifiedRoleData, HC.hcGetBundle, _isBuLeadByTitle) stubbed in the vm
 * context. SpreadsheetApp and PropertiesService are stubbed too, so the log
 * write and the property read execute for real.
 *
 * Run: node lets_app/test_access_audit.js
 */

const fs=require('fs'),vm=require('vm');
// Harness: Access.js canAccessTrip + the new G-008 helpers.
function build(opts){
  opts=opts||{};
  const appended=[];
  const sandbox={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
    SpreadsheetApp:{openById:()=>({getSheetByName:n=>n!=='Access_Log'?(opts.noLogTab?null:null):(opts.noLogTab?null:{appendRow:r=>appended.push(r)})})},
    CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{},remove:()=>{}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>opts.props&&k in opts.props?opts.props[k]:null})},
    Session:{getActiveUser:()=>({getEmail:()=>'tester@gsa.gov'})}};
  const ctx=vm.createContext(sandbox);
  vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),ctx);
  // Stub the collaborators canAccessTrip depends on.
  vm.runInContext(`
    var __roles = ${JSON.stringify(opts.roles||{})};
    var __bundle = ${JSON.stringify(opts.bundle||{success:true,data:[]})};
    function _getUnifiedRolesForEmail(e){ return __roles[e]||[]; }
    function _getUnifiedRoleData(){ return { rolesByEmail: __roles, hasData:true }; }
    var HC = { hcGetBundle: function(){ return __bundle; } };
    function _isBuLeadByTitle(e){
      for (var i=0;i<__bundle.data.length;i++){
        var p=__bundle.data[i];
        if(!p.emailAddress||p.emailAddress.toLowerCase()!==e) continue;
        var t=String(p.officeTitle||'').toLowerCase();
        if(t.indexOf('chief of staff')>-1||t.indexOf('client executive')>-1)
          return {buCodes:[p.orgCode],buNames:['Front Office'],title:p.officeTitle};
      }
      return null;
    }
    function loadOrgLookups(){ return {orgToBU:{},orgToCurrentOrgCode:{}}; }
    function selfHealCurrentUserEmail(){ return null; }
  `,ctx);
  const src=fs.readFileSync('lets_app/server/30_services/Access.js','utf8');
  // Only evaluate the functions under test, to avoid pulling the whole file's deps.
  const slice=src.slice(src.indexOf('function canAccessTrip'));
  const end=slice.indexOf('\n/**\n * Editor convenience wrapper');
  vm.runInContext(slice.slice(0,end>0?end:slice.length),ctx,{filename:'Access.js'});
  return {ctx,appended,run:e=>vm.runInContext(e,ctx)};
}
let fails=0;
const ok=(n,c,x)=>{ if(c)console.log('  PASS',n); else {console.log('  FAIL',n,x===undefined?'':JSON.stringify(x));fails++;} };
const SUP={emailAddress:'sup@gsa.gov',employeeName:'Sue Super',supervisoryStatus:'2',occupancyStatus:'FILLED',positionNumber:'FCA-0001',officeTitle:'Division Director',orgCode:'FCA'};
const COS={emailAddress:'cos@gsa.gov',employeeName:'Cal Staff',supervisoryStatus:'',occupancyStatus:'FILLED',positionNumber:'FC-0002',officeTitle:'Chief of Staff',orgCode:'FC'};
const VAC={emailAddress:'vac@gsa.gov',employeeName:'',supervisoryStatus:'2',occupancyStatus:'VACANT',positionNumber:'FCB-0002',officeTitle:'Deputy',orgCode:'FCB'};

console.log('1. the three allow-paths still work');
{
  const h=build({roles:{'admin@gsa.gov':[{roleType:'admin',scope:''}]},bundle:{success:true,data:[SUP,COS,VAC]}});
  ok('role row grants', h.run("canAccessTrip('admin@gsa.gov')")===true);
  ok('hc supervisor grants', h.run("canAccessTrip('sup@gsa.gov')")===true);
  ok('bu lead by title grants', h.run("canAccessTrip('cos@gsa.gov')")===true);
  ok('vacant seat denied', h.run("canAccessTrip('vac@gsa.gov')")===false);
  ok('unknown denied', h.run("canAccessTrip('nobody@gsa.gov')")===false);
  ok('empty email denied', h.run("canAccessTrip('')")===false);
}

console.log('2. every decision is logged with its path');
{
  const h=build({roles:{'admin@gsa.gov':[{roleType:'admin',scope:''}]},bundle:{success:true,data:[SUP,COS]}});
  h.run("canAccessTrip('admin@gsa.gov')");
  h.run("canAccessTrip('sup@gsa.gov')");
  h.run("canAccessTrip('cos@gsa.gov')");
  h.run("canAccessTrip('nobody@gsa.gov')");
  const paths=h.appended.map(r=>r[4]);
  ok('4 rows written', h.appended.length===4, h.appended.length);
  ok('paths recorded in order', JSON.stringify(paths)===JSON.stringify(['role','hc-supervisor','hc-bu-lead','none']), paths);
  const sup=h.appended[1];
  ok('GRANTED recorded', sup[3]==='GRANTED', sup[3]);
  ok('position number captured', sup[5]==='FCA-0001', sup[5]);
  ok('office title captured', sup[6]==='Division Director', sup[6]);
  ok('org code captured', sup[7]==='FCA', sup[7]);
  ok('DENIED also logged', h.appended[3][3]==='DENIED', h.appended[3][3]);
  ok('log id prefixed', String(sup[0]).startsWith('ACC-'), sup[0]);
}

console.log('3. kill switch closes the HR-driven paths only');
{
  const h=build({props:{HC_SUPERVISOR_ACCESS_ENABLED:'false'},
    roles:{'admin@gsa.gov':[{roleType:'admin',scope:''}]},bundle:{success:true,data:[SUP,COS]}});
  ok('role path still works', h.run("canAccessTrip('admin@gsa.gov')")===true);
  ok('hc supervisor now denied', h.run("canAccessTrip('sup@gsa.gov')")===false);
  ok('bu lead now denied', h.run("canAccessTrip('cos@gsa.gov')")===false);
  const d=h.appended.filter(r=>r[4]==='disabled');
  ok('denial logged as path=disabled', d.length===2, d.length);
}

console.log('4. fail-open default (a typo must not lock everyone out)');
{
  for (const v of [null,'','true','TRUE','yes','garbage']) {
    const h=build({props:{HC_SUPERVISOR_ACCESS_ENABLED:v},bundle:{success:true,data:[SUP]}});
    ok('enabled when property is '+JSON.stringify(v), h.run("isHcDerivedAccessEnabled()")===true);
  }
  const h=build({props:{HC_SUPERVISOR_ACCESS_ENABLED:'False'},bundle:{success:true,data:[SUP]}});
  ok("'False' (any case) disables", h.run("isHcDerivedAccessEnabled()")===false);
}

console.log('5. logging failure must never deny access');
{
  const h=build({noLogTab:true,bundle:{success:true,data:[SUP]}});
  ok('missing Access_Log tab does not block', h.run("canAccessTrip('sup@gsa.gov')")===true);
  ok('nothing written', h.appended.length===0);
}

console.log('6. access inventory answers "who can get in?"');
{
  const h=build({roles:{'admin@gsa.gov':[{roleType:'admin',scope:''},{roleType:'bu_reviewer',scope:'QFA'}]},
    bundle:{success:true,data:[SUP,COS,VAC]}});
  const inv=h.run("getAccessInventory()");
  ok('success', inv.success===true);
  ok('hcDerivedEnabled reported', inv.hcDerivedEnabled===true);
  ok('role holders listed', inv.roleHolders.length===1, inv.roleHolders);
  ok('multiple roles joined with scope', JSON.stringify(inv.roleHolders[0].roles)===JSON.stringify(['admin','bu_reviewer:QFA']), inv.roleHolders[0].roles);
  ok('hc supervisors listed', inv.hcSupervisors.length===1, inv.hcSupervisors.map(x=>x.email));
  ok('vacant seat excluded', !inv.hcSupervisors.some(x=>x.email==='vac@gsa.gov'));
  ok('bu leads listed', inv.buLeads.length===1, inv.buLeads.map(x=>x.email));
  ok('supervisor carries position metadata', inv.hcSupervisors[0].positionNumber==='FCA-0001');
}

console.log('7. HC unavailable degrades without denying role holders');
{
  const h=build({roles:{'admin@gsa.gov':[{roleType:'admin',scope:''}]},bundle:{success:false,error:'bundle unavailable',data:[]}});
  ok('role holder still admitted', h.run("canAccessTrip('admin@gsa.gov')")===true);
  ok('others denied, not errored', h.run("canAccessTrip('sup@gsa.gov')")===false);
  const inv=h.run("getAccessInventory()");
  ok('inventory reports hcError', !!inv.hcError, inv.hcError);
  ok('inventory still returns success', inv.success===true);
}

console.log('8. negative control (the suite must be able to fail)');
{
  const src=fs.readFileSync('lets_app/server/30_services/Access.js','utf8');
  const broken=src.replace("return String(raw).trim().toLowerCase() !== 'false';","return true;");
  if(broken===src){ ok('negative control patched source',false); }
  else{
    const appended=[];
    const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,parseFloat,parseInt,isNaN,RegExp,Error,
      SpreadsheetApp:{openById:()=>({getSheetByName:()=>({appendRow:r=>appended.push(r)})})},
      CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{},remove:()=>{}})},
      PropertiesService:{getScriptProperties:()=>({getProperty:()=>'false'})},
      Session:{getActiveUser:()=>({getEmail:()=>'t@gsa.gov'})}};
    const c2=vm.createContext(sb);
    vm.runInContext("var TRAVEL_DB_SPREADSHEET_ID='x';",c2);
    vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js','utf8'),c2);
    vm.runInContext(`var __b={success:true,data:[${JSON.stringify(SUP)}]};
      function _getUnifiedRolesForEmail(){return [];}
      function _getUnifiedRoleData(){return {rolesByEmail:{},hasData:true};}
      var HC={hcGetBundle:function(){return __b;}};
      function _isBuLeadByTitle(){return null;}`,c2);
    const sl=broken.slice(broken.indexOf('function canAccessTrip'));
    const e2=sl.indexOf('\n/**\n * Editor convenience wrapper');
    vm.runInContext(sl.slice(0,e2>0?e2:sl.length),c2);
    ok('ignoring the kill switch grants access it should have denied',
       vm.runInContext("canAccessTrip('sup@gsa.gov')",c2)===true);
  }
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
