/**
 * Automated Verification Script for routing visibility.
 *
 * WHY THIS EXISTS
 * ---------------
 * @clolry: "I received an email confirmation about the submission. I don't
 * know who it was routed to." The reviewer's name appeared once, inside a
 * prose sentence, and their email appeared nowhere. The portal card showed a
 * status badge and nothing else.
 *
 * THE UNROUTED CASE IS THE POINT
 * ------------------------------
 * Routing degrades quietly. getSubmitterInfo and the reviewer lookups both
 * swallow failures: if HC cannot resolve a Sector Director, or no BU Reviewer
 * is configured for a business unit, the request still submits, the
 * confirmation still arrives reading entirely normally, and the portal shows
 * a normal "pending" badge — while the request sits unrouted indefinitely.
 *
 * An empty reviewer name is the ONLY evidence. So both surfaces now say
 * "not yet assigned" explicitly and name a contact, rather than omitting the
 * line when there is nothing to show. Sections 1 and 4 assert that.
 *
 * Section 4 also asserts the line is SUPPRESSED on terminal statuses.
 * "Now with X" is misleading on a finished request, and the status badge
 * already says what happened.
 *
 * Section 5 checks the two level-label maps agree. The email needs a
 * server-side copy and the portal a client-side one, so they can drift — and
 * a submitter seeing "Business Unit review" in email but different wording in
 * the portal would reasonably think they were different things.
 *
 * Run: node lets_app/test_routing_visibility.js
 */

// Routing visibility. @clolry: "I received an email confirmation about the
// submission. I don't know who it was routed to."
const fs=require('fs'),vm=require('vm');
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x).slice(0,200));fails++;}};

console.log('1. the email names the destination');
{
  const src=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  const i=src.indexOf('function _describeRoutingDestination');
  const j=src.indexOf('\nfunction sendSubmitterConfirmation');
  const sb={console,String,Object,Array};
  const ctx=vm.createContext(sb);
  vm.runInContext(src.slice(i,j),ctx);
  const d=(rev,lvl,st)=>vm.runInContext('_describeRoutingDestination('+
    JSON.stringify(rev)+','+JSON.stringify(lvl)+','+JSON.stringify(st)+')',ctx);

  ok('name and email both shown',
     d({name:'Dee Director',email:'dee@gsa.gov'},'BU','PENDING_BU')==='Dee Director <dee@gsa.gov> — Business Unit review',
     d({name:'Dee Director',email:'dee@gsa.gov'},'BU','PENDING_BU'));
  ok('name alone still useful',
     d({name:'Dee Director'},'Sector','PENDING_SECTOR')==='Dee Director — Sector Director review');

  // THE CASE THAT MATTERS. Routing degrades quietly: the request submits, the
  // confirmation arrives reading normally, and it sits unrouted.
  const none=d(null,'BU','PENDING_BU');
  ok('no reviewer -> says so plainly', /not yet assigned/.test(none), none);
  ok('and tells the submitter what to do', /aastravel@gsa.gov/.test(none), none);
  ok('empty reviewer object handled', /not yet assigned/.test(d({},'BU','PENDING_BU')));
}

console.log('1b. the stage comes from STATUS, not the frozen initial level');
{
  const src=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  const i=src.indexOf('function describeReviewStage');
  const j=src.indexOf('\nfunction sendSubmitterConfirmation');
  const sb={console,String,Object};
  const ctx=vm.createContext(sb);
  vm.runInContext(src.slice(i,j),ctx);
  const stage=(st,lvl)=>vm.runInContext('describeReviewStage('+
    JSON.stringify(st)+','+JSON.stringify(lvl)+')',ctx);

  // Initial_Review_Level records where a request STARTED and never advances,
  // while Current_Reviewer_Name does. Pairing them showed the right person
  // against the wrong stage once a request progressed — a request that began
  // at BU and reached FAS read "FAS reviewer — Business Unit review".
  ok('status wins over a stale initial level',
     stage('PENDING_FAS','BU')==='FAS Front Office review', stage('PENDING_FAS','BU'));
  ok('BU', stage('PENDING_BU','BU')==='Business Unit review');
  ok('Sector', stage('PENDING_SECTOR','Sector')==='Sector Director review');
  ok('OSO', stage('PENDING_OSO','BU')==='AAS Front Office review');
  ok('DD confirmation', stage('PENDING_DD_CONFIRMATION','BU')==='Division Director confirmation');
  // These are waiting on the SUBMITTER.
  ok('NEEDS_INFO names the submitter',
     /submitter/.test(stage('NEEDS_INFO_BU','BU')), stage('NEEDS_INFO_BU','BU'));
  ok('PENDING_CORRECTION names the submitter',
     /submitter/.test(stage('PENDING_CORRECTION','BU')));
  ok('lowercase status accepted', stage('pending_bu','BU')==='Business Unit review');

  // An unmapped status must fall back rather than invent a stage name.
  ok('unknown status falls back to the level',
     stage('SOMETHING_NEW','BU')==='Business Unit review', stage('SOMETHING_NEW','BU'));
  ok('no status and no level still reads sensibly', stage('','')==='review');
  ok('never emits undefined', stage('ODD','ODD').indexOf('undefined')===-1);
}

console.log('2. the confirmation body includes it');
{
  const src=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  const i=src.indexOf('function sendSubmitterConfirmation');
  const body=src.slice(i, src.indexOf('\nfunction sendReviewerNotification'));
  ok('HTML card has a "Now with" row', /Now with/.test(body));
  ok('plain text body has it too', /Now with: \$\{_describeRoutingDestination/.test(body));
  // The status must reach the describer or the stage falls back to the frozen
  // initial level, which is the bug this fixes.
  ok('status is passed through', /_describeRoutingDestination\(reviewer, reviewLevel, formData\.status\)/.test(body),
     'status not forwarded');
  // Previously the reviewer name appeared once, inside prose, with no email.
  ok('uses the shared describer, not ad-hoc text',
     (body.match(/_describeRoutingDestination/g)||[]).length>=2,
     (body.match(/_describeRoutingDestination/g)||[]).length);
  ok('HTML is escaped', /escapeHtml\(_describeRoutingDestination/.test(body));
}

console.log('3. the server sends the fields to the portal');
{
  const r=fs.readFileSync('lets_app/server/40_domain/Request.js','utf8');
  ok('currentReviewerName returned', /currentReviewerName: String\(row\[headerIndex\['Current_Reviewer_Name'\]\]/.test(r));
  ok('currentReviewerEmail returned', /currentReviewerEmail: String\(currentReviewerEmail\)/.test(r));
  ok('initialReviewLevel returned', /initialReviewLevel: String\(row\[headerIndex\['Initial_Review_Level'\]\]/.test(r));
}

console.log('4. the portal card describes routing, and flags unrouted');
{
  const utilsSrc=fs.readFileSync('lets_app/client/shared/travelUtils.html','utf8');
  const utilsJs=/<script[^>]*>([\s\S]*)<\/script>/.exec(utilsSrc)[1];
  const src=fs.readFileSync('lets_app/client/controllers/portal/travelPortalController.html','utf8');
  const js=src.match(/<script[^>]*>([\s\S]*?)<\/script>/g).map(b=>b.replace(/<\/?script[^>]*>/g,'')).join('\n');
  const sb={console,String,Object,Array,Number,parseFloat,parseInt,isNaN,Math,Date,
    document:{addEventListener(){},getElementById:()=>null}};
  sb.window=sb;
  const ctx=vm.createContext(sb);
  vm.runInContext(utilsJs,ctx);
  vm.runInContext(js,ctx);
  const C=vm.runInContext('window.TravelPortal.Controller',ctx);
  const d=req=>C._describeRouting(req);

  const pending=d({status:'PENDING_BU',currentReviewerName:'Dee Director',initialReviewLevel:'BU'});
  ok('names the reviewer', pending.text==='With Dee Director — Business Unit review', pending);
  ok('not flagged', pending.unrouted===false);

  // The fix: a request that STARTED at BU and reached FAS must read FAS.
  const advanced=d({status:'PENDING_FAS',currentReviewerName:'Fas Reviewer',initialReviewLevel:'BU'});
  ok('advanced request shows its CURRENT stage',
     advanced.text==='With Fas Reviewer — FAS Front Office review', advanced);

  // NEEDS_INFO is waiting on the submitter. "With <reviewer>" there actively
  // misleads: the request will not move until the submitter acts.
  const needsInfo=d({status:'NEEDS_INFO_BU',currentReviewerName:'Dee Director',initialReviewLevel:'BU'});
  ok('needs-info says "Waiting on you"', /Waiting on you/.test(needsInfo.text), needsInfo);
  ok('and is marked actionable', needsInfo.actionable===true);
  ok('not treated as unrouted', needsInfo.unrouted===false);
  const correction=d({status:'PENDING_CORRECTION',currentReviewerName:'X',initialReviewLevel:'BU'});
  ok('pending-correction also waits on the submitter', /Waiting on you/.test(correction.text));

  const unrouted=d({status:'PENDING_BU',currentReviewerName:'',initialReviewLevel:'BU'});
  ok('unrouted is flagged', unrouted.unrouted===true, unrouted);
  ok('unrouted explains itself', /No reviewer assigned yet/.test(unrouted.text), unrouted.text);
  ok('and gives a contact', /aastravel@gsa.gov/.test(unrouted.text));

  // "Now with X" is misleading on a finished request, and the badge says so.
  ['COMPLETED','APPROVED','APPROVED_GOGOV','DENIED','CANCELLED','SUBMITTER_CANCELLED','DRAFT'].forEach(st=>{
    ok('no routing line for '+st, d({status:st,currentReviewerName:'X'})===null);
  });
  ok('case-insensitive status match', d({status:'completed',currentReviewerName:'X'})===null);
  ok('unknown status still describes something',
     d({status:'PENDING_X',currentReviewerName:'X',initialReviewLevel:'BU'}).text.indexOf('undefined')===-1);
}

console.log('5. the server and client stage maps agree');
{
  // Duplicated because one feeds email and the other the portal card. A
  // submitter seeing "Business Unit review" in email and different wording in
  // the portal would reasonably think they were different things.
  const e=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  const u=fs.readFileSync('lets_app/client/shared/travelUtils.html','utf8');

  function stageMap(src){
    const i=src.indexOf('STATUS_STAGES = {');
    const block=src.slice(i, src.indexOf('};', i));
    const out={};
    for(const m of block.matchAll(/(\w+):\s*'([^']+)'/g)) out[m[1]]=m[2];
    return out;
  }
  const se=stageMap(e), su=stageMap(u);
  ok('server map found', Object.keys(se).length>=8, Object.keys(se).length);
  ok('client map found', Object.keys(su).length>=8, Object.keys(su).length);
  ok('same statuses mapped',
     Object.keys(se).sort().join()===Object.keys(su).sort().join(),
     {server:Object.keys(se).sort(), client:Object.keys(su).sort()});
  Object.keys(se).forEach(k=>{
    ok('same label for '+k, se[k]===su[k], {server:se[k], client:su[k]});
  });
}

console.log('6. the submission forwards the routed status');
{
  const sub=fs.readFileSync('lets_app/server/40_domain/Submission.js','utf8');
  // Without this the confirmation falls back to initialLevel and the fix is
  // inert on the one email that matters most.
  ok('status merged into formData for the notification',
     /status: routing\.status \}\)/.test(sub), 'routed status not forwarded');
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
