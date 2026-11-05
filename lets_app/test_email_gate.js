/**
 * Automated Verification Script for the environment email gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * Nothing was preventing the sandbox from emailing real people. The only
 * suppression was _isTestSubmitter(), which checks whether the ACTIVE USER has
 * Suppress_Emails=TRUE in the Test_Submitters sheet — a per-tester opt-in,
 * keyed on the sender, and not gated on the environment at all.
 *
 * @clolry confirmed Test_Submitters is EMPTY. So every sandbox submission has
 * been sending real notifications, and any Sector Director or BU Reviewer that
 * HC resolved received them. That is inherited behavior, not something recent
 * work introduced, and it is why he declined to supply real approver addresses
 * for the routing work.
 *
 * Sections 4 and 5 are the important ones: the gate FAILS CLOSED. A trigger has
 * no active user, and a project where TripConfig did not load has no known
 * environment. In both cases the send is BLOCKED rather than allowed through.
 * The cost of a blocked test email is a confusing log line; the cost of a
 * wrongly-allowed one is a real person receiving a fabricated travel
 * notification.
 *
 * Section 2 asserts nothing is silently dropped. A redirected email still
 * ARRIVES, with the intended recipients named in the body, so a tester can
 * verify content and routing. Cc and Bcc are dropped rather than redirected,
 * because copying them to the same address would send duplicates.
 *
 * Section 6 covers the MailApp fallback path, which is easy to forget: the
 * primary path is GmailApp and the fallback is only reached when the send-as
 * alias is unconfigured.
 *
 * Section 9 is unrelated to email and guards the four misnamed template files
 * that broke the admin page. clasp strips ONE .html extension, so a file named
 * x.html.html is reachable as 'x.html' and NOT as 'x' — which is why
 * travelAdminPage threw "No HTML file named client/styles/travelUsersStyles".
 * It walks every include() and createTemplateFromFile() reference in the repo
 * and asserts the target exists.
 *
 * Run: node lets_app/test_email_gate.js
 */

// The environment email gate. Nothing was stopping sandbox from emailing real
// people: _isTestSubmitter checks the SENDER and Test_Submitters was empty.
const fs=require('fs'),vm=require('vm');
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x).slice(0,220));fails++;}};

function build(opts){
  opts=opts||{};
  const sent=[];
  const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,
    parseFloat,parseInt,isNaN,RegExp,Error,
    GmailApp:{sendEmail:(to,subject,body,o)=>{ if(opts.gmailFails) throw new Error('alias not configured');
      sent.push({via:'GmailApp',to,subject,body,...o}); }},
    MailApp:{sendEmail:o=>{sent.push({via:'MailApp',...o});}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>
      (opts.props&&k in opts.props)?opts.props[k]:null})},
    Session:{getActiveUser:()=>({getEmail:()=>opts.activeUser===undefined?'chris@gsa.gov':opts.activeUser})},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>null})}};
  const ctx=vm.createContext(sb);
  if(opts.envUndefined!==true){
    vm.runInContext('var LETS_ENV='+JSON.stringify(opts.env||'development')+';',ctx);
    vm.runInContext('var LETS_IS_PRODUCTION='+(opts.env==='production')+';',ctx);
  }
  // Collaborators sendTravelEmail needs.
  vm.runInContext(`
    function getTravelEmailAddress(){ return 'aastravel@gsa.gov'; }
    function getTravelEmailName(){ return 'ASD Travel & Events'; }
    function logError(){}
    // Branding getters live in 00_config/Props.js. Stubbed here rather than
    // loading that file, which pulls in PropertiesService wiring the gate does
    // not exercise.
    function getAppName(){ return 'LETS'; }
    function getOrgShortName(){ return 'ASD'; }
    function getOrgLongName(){ return 'ACQUISITION SOLUTIONS DEVELOPMENT'; }
    // The email FOOTER names the agency and the SERVICE, not the office.
    // @clolry: it should read FEDERAL ACQUISITION SERVICE, not ASSISTED
    // ACQUISITION SERVICES — and ASD, the office, would be a third wrong
    // answer.
    function getOrgServiceName(){ return 'FEDERAL ACQUISITION SERVICE'; }
    function getAgencyName(){ return 'GENERAL SERVICES ADMINISTRATION'; }
    function getOrgFOLabel(){ return 'ASD Travel & Events'; }
    function getReviewLabelSector(){ return 'SCD'; }
    function getReviewLabelBU(){ return 'DAC'; }
    function getEmailFromAddress(){ return 'ASD.Travel-Events@gsa.gov'; }
    function getEmailFromName(){ return 'ASD Travel & Events'; }
    var SHEET_NAMES={TEST_SUBMITTERS:'Test_Submitters'};
    // Stub the DATA, not the function: Email.js defines its own
    // _isTestSubmitter later in the file and would overwrite a stubbed one.
    // Exercising the real lookup is also more faithful.
    function TravelDB(){}
    TravelDB.prototype.readSheet=function(){
      return ${opts.isTestSubmitter===true
        ? JSON.stringify({rows:[['chris@gsa.gov',true]],headerIndex:{Email:0,Suppress_Emails:1}})
        : JSON.stringify({rows:[],headerIndex:{Email:0,Suppress_Emails:1}})};
    };
  `,ctx);
  const src=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  // Only the gate + core send; the rest of the file pulls in many deps.
  const a=src.indexOf('function _getTestEmailRedirect');
  const b=src.indexOf('\n/**\n * Send a travel request confirmation');
  vm.runInContext(src.slice(a, b>0?b:src.indexOf('function sendTravelRequestEmail')),ctx,{filename:'Email.js'});
  return {run:e=>vm.runInContext(e,ctx),sent,
    send:o=>vm.runInContext('sendTravelEmail('+JSON.stringify(o)+')',ctx)};
}

const MSG={to:'real.director@gsa.gov',cc:'real.cos@gsa.gov',
  subject:'Request REQ-0001 pending your review',body:'Please review.',
  htmlBody:'<p>Please review.</p>'};

console.log('1. production is a pass-through');
{
  const h=build({env:'production'});
  const r=h.send(MSG);
  ok('sent', r.success===true, r);
  ok('not redirected', r.redirected===false, r);
  ok('went to the real recipient', h.sent[0].to==='real.director@gsa.gov', h.sent[0].to);
  ok('cc preserved', h.sent[0].cc==='real.cos@gsa.gov');
  ok('subject unchanged', h.sent[0].subject===MSG.subject, h.sent[0].subject);
  ok('no banner in the body', h.sent[0].body.indexOf('NOT SENT TO THE REAL')===-1);
}

console.log('2. sandbox redirects instead of sending to real people');
{
  const h=build({env:'development'});
  const r=h.send(MSG);
  ok('still sent', r.success===true, r);
  // Nothing is silently dropped: a tester must still be able to read the mail.
  ok('redirected', r.redirected===true);
  ok('went to the active user', h.sent[0].to==='chris@gsa.gov', h.sent[0].to);
  ok('real recipient NOT in To', h.sent[0].to.indexOf('real.director')===-1);
  // Copying cc to the same address would send duplicates.
  ok('cc dropped, not redirected', h.sent[0].cc==='', h.sent[0].cc);
  ok('bcc dropped', h.sent[0].bcc==='');
  ok('subject is prefixed', /^\[DEVELOPMENT TEST\]/.test(h.sent[0].subject), h.sent[0].subject);
  ok('body names the intended To', h.sent[0].body.indexOf('real.director@gsa.gov')>-1);
  ok('body names the intended Cc', h.sent[0].body.indexOf('real.cos@gsa.gov')>-1);
  ok('original content preserved', h.sent[0].body.indexOf('Please review.')>-1);
  ok('html banner added', h.sent[0].htmlBody.indexOf('NOT SENT TO THE REAL RECIPIENTS')>-1);
  ok('original html preserved', h.sent[0].htmlBody.indexOf('<p>Please review.</p>')>-1);
  ok('result reports the original', r.originalTo==='real.director@gsa.gov');
}

console.log('3. TEST_EMAIL_REDIRECT wins over the active user');
{
  const h=build({env:'development',props:{TEST_EMAIL_REDIRECT:'sandbox-sink@gsa.gov'}});
  h.send(MSG);
  ok('uses the configured address', h.sent[0].to==='sandbox-sink@gsa.gov', h.sent[0].to);
}

console.log('4. FAILS CLOSED with no resolvable recipient');
{
  // A trigger has no active user. Sending to the real recipient in that case
  // would be the worst possible default.
  const h=build({env:'development',activeUser:''});
  const r=h.send(MSG);
  ok('blocked', r.blocked===true, r);
  ok('nothing sent', h.sent.length===0, h.sent.length);
  ok('explains how to fix it', /TEST_EMAIL_REDIRECT/.test(r.reason), r.reason);
}

console.log('5. FAILS CLOSED when the environment is unknown');
{
  // If TripConfig did not load, an unknown environment must not be treated as
  // production.
  const h=build({envUndefined:true});
  const r=h.send(MSG);
  ok('blocked', r.blocked===true, r);
  ok('nothing sent', h.sent.length===0);
  ok('reason names the config', /TripConfig/.test(r.reason), r.reason);
}

console.log('6. the gate applies to the MailApp fallback too');
{
  const h=build({env:'development',gmailFails:true});
  const r=h.send(MSG);
  ok('fell back', r.fallback===true, r);
  ok('still redirected', h.sent[0].to==='chris@gsa.gov', h.sent[0].to);
  ok('via MailApp', h.sent[0].via==='MailApp');
  ok('banner present on the fallback path', h.sent[0].body.indexOf('NOT SENT TO THE REAL')>-1);
}

console.log('7. Test_Submitters suppression still short-circuits first');
{
  const h=build({env:'development',isTestSubmitter:true});
  const r=h.send(MSG);
  ok('suppressed entirely', r.suppressed===true, r);
  ok('nothing sent', h.sent.length===0);
  // Per-tester opt-in remains available; the environment gate is the backstop.
  ok('reason is test-submitter', r.reason==='test-submitter');
}

console.log('8. routing status reports without sending');
{
  const dev=build({env:'development'});
  const s1=dev.run('getEmailRoutingStatus()');
  ok('reports environment', s1.environment==='development', s1);
  ok('reports willRedirect', s1.willRedirect===true);
  ok('names the redirect target', s1.redirectTo==='chris@gsa.gov', s1.redirectTo);
  ok('probe sent nothing', dev.sent.length===0, dev.sent.length);

  const prod=build({env:'production'});
  const s2=prod.run('getEmailRoutingStatus()');
  ok('production reports no redirect', s2.willRedirect===false, s2);
  ok('production probe sent nothing', prod.sent.length===0);

  const broken=build({env:'development',activeUser:''});
  const s3=broken.run('getEmailRoutingStatus()');
  ok('blocked state surfaced', s3.blocked===true, s3);
}

console.log('9. template file references all resolve');
{
  // clasp strips ONE .html extension, so a file named x.html.html is reachable
  // as 'x.html' and NOT as 'x'. Four files were named that way, which is why
  // the admin page threw "No HTML file named client/styles/travelUsersStyles".
  const path=require('path');
  const files=[];
  (function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){
    const p=path.join(d,e.name);
    if(e.isDirectory())walk(p); else files.push(p);
  }})('lets_app');
  ok('no .html.html files remain', files.filter(f=>/\.html\.html$/.test(f)).length===0,
     files.filter(f=>/\.html\.html$/.test(f)));
  const refs=new Set();
  for(const f of files){
    if(!/\.(html|js)$/.test(f))continue;
    const s=fs.readFileSync(f,'utf8');
    for(const m of s.matchAll(/(?:include|createTemplateFromFile|createHtmlOutputFromFile)\(\s*'([^']+)'/g)){
      if(m[1]==='...')continue; // the JSDoc example in Render.js
      refs.add(m[1]);
    }
  }
  const missing=[...refs].filter(r=>!fs.existsSync('lets_app/'+r+'.html'));
  ok('every include() target exists', missing.length===0, missing);
  ok('checked a meaningful number of refs', refs.size>=40, refs.size);
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
