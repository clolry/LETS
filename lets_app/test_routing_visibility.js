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
  const d=e=>vm.runInContext('_describeRoutingDestination('+JSON.stringify(e[0])+','+JSON.stringify(e[1])+')',ctx);

  ok('name and email both shown',
     d([{name:'Dee Director',email:'dee@gsa.gov'},'BU'])==='Dee Director <dee@gsa.gov> — Business Unit review',
     d([{name:'Dee Director',email:'dee@gsa.gov'},'BU']));
  ok('name alone still useful', d([{name:'Dee Director'},'Sector'])==='Dee Director — Sector Director review');
  ok('level labels are readable, not stage keys',
     d([{name:'X',email:'x@y.gov'},'FAS']).indexOf('FAS Front Office review')>-1,
     d([{name:'X',email:'x@y.gov'},'FAS']));
  ok('AAS FO maps to the same label as OSO',
     d([{name:'X'},'AAS FO'])===d([{name:'X'},'OSO']));

  // THE CASE THAT MATTERS. Routing degrades quietly: the request submits, the
  // confirmation arrives reading normally, and it sits unrouted.
  const none=d([null,'BU']);
  ok('no reviewer -> says so plainly', /not yet assigned/.test(none), none);
  ok('and tells the submitter what to do', /aastravel@gsa.gov/.test(none), none);
  ok('empty reviewer object handled', /not yet assigned/.test(d([{},'BU'])));
  ok('unknown level does not produce "undefined"',
     d([{name:'X'},'WEIRD']).indexOf('undefined')===-1, d([{name:'X'},'WEIRD']));
  ok('no level at all still reads sensibly',
     d([{name:'X'},''])==='X — review', d([{name:'X'},'']));
}

console.log('2. the confirmation body includes it');
{
  const src=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  const i=src.indexOf('function sendSubmitterConfirmation');
  const body=src.slice(i, src.indexOf('\nfunction sendReviewerNotification'));
  ok('HTML card has a "Now with" row', /Now with/.test(body));
  ok('plain text body has it too', /Now with: \$\{_describeRoutingDestination/.test(body));
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
  const src=fs.readFileSync('lets_app/client/controllers/portal/travelPortalController.html','utf8');
  const js=src.match(/<script[^>]*>([\s\S]*?)<\/script>/g).map(b=>b.replace(/<\/?script[^>]*>/g,'')).join('\n');
  const sb={console,String,Object,Array,document:{addEventListener(){},getElementById:()=>null}};
  sb.window=sb;
  const ctx=vm.createContext(sb);
  vm.runInContext(js,ctx);
  const C=vm.runInContext('window.TravelPortal.Controller',ctx);
  const d=req=>C._describeRouting(req);

  const pending=d({status:'PENDING_BU',currentReviewerName:'Dee Director',initialReviewLevel:'BU'});
  ok('names the reviewer', pending.text==='With Dee Director — Business Unit review', pending);
  ok('not flagged', pending.unrouted===false);

  const unrouted=d({status:'PENDING_BU',currentReviewerName:'',initialReviewLevel:'BU'});
  ok('unrouted is flagged', unrouted.unrouted===true, unrouted);
  ok('unrouted explains itself', /No reviewer assigned yet/.test(unrouted.text), unrouted.text);
  ok('and gives a contact', /aastravel@gsa.gov/.test(unrouted.text));

  // "Now with X" is misleading on a finished request, and the badge says so.
  ['COMPLETED','APPROVED_GOGOV','DENIED','CANCELLED','DRAFT'].forEach(st=>{
    ok('no routing line for '+st, d({status:st,currentReviewerName:'X'})===null);
  });
  ok('case-insensitive status match', d({status:'completed',currentReviewerName:'X'})===null);
  ok('unknown level does not emit "undefined"',
     d({status:'PENDING_X',currentReviewerName:'X',initialReviewLevel:'ODD'}).text.indexOf('undefined')===-1);
}

console.log('5. the two level-label maps agree');
{
  // The email and the portal each need their own copy (server vs client), so
  // they can drift. A submitter seeing "Business Unit review" in email and
  // something else in the portal would reasonably think they were different
  // things.
  const e=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  const p=fs.readFileSync('lets_app/client/controllers/portal/travelPortalController.html','utf8');
  ['Sector Director review','Business Unit review','AAS Front Office review','FAS Front Office review']
    .forEach(label=>{
      ok('email has "'+label+'"', e.indexOf("'"+label+"'")>-1);
      ok('portal has "'+label+'"', p.indexOf("'"+label+"'")>-1);
    });
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
