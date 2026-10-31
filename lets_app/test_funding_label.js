/**
 * Automated Verification Script for the funding-label change.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * "Overhead" was relabelled "GSA-Paid" and made the default, because this
 * workgroup does roughly one client-paid trip a year where the group this code
 * was inherited from did a great deal of customer-funded travel.
 *
 * The critical constraint is that ONLY THE LABEL CHANGED. The stored value is
 * still 'overhead', and four server paths branch on that string:
 *
 *   Submission.js:483          writes Is_Client_Paid
 *   Submission.js:162          routes to FAS for overhead, GOGOV for client
 *   Admin_Dashboard.js:446     funding-type spend buckets
 *   ReviewerDashboard.js:426   reviewer queue filtering
 *   Review_Action.js           _hasOverheadFromData / _hasOverheadFromRows
 *
 * Renaming the value would mean a data migration of every submitted row for a
 * wording change, and a half-done rename would silently misroute requests —
 * which is why section 2 asserts the radio VALUE is unchanged while the label
 * is not, and section 4 checks the detection helpers still exist.
 *
 * Section 2 also pins `isClientPaid !== 'client'` as the checked condition
 * rather than `=== 'overhead'`: a legacy row with a blank value then renders
 * as GSA-Paid instead of showing neither option selected.
 *
 * Section 3 greps the client for leftover display text, permitting the stored
 * value (value="Overhead") and CSS class names (--overhead). A partial
 * relabel is worse than none: two names for one concept in the same UI.
 *
 * Run: node lets_app/test_funding_label.js
 */

// The funding default and label change: stored value must stay 'overhead'
// while the label reads GSA-Paid, because routing and reporting branch on it.
const fs=require('fs');
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':String(x).slice(0,160));fails++;}};

console.log('1. new travelers default to GSA-Paid');
{
  const s=fs.readFileSync('lets_app/client/controllers/form/travelRequestState.html','utf8');
  ok("isClientPaid defaults to 'overhead'", /isClientPaid:\s*'overhead'/.test(s),
     (s.match(/isClientPaid:\s*'[^']*'/)||[])[0]);
  ok('not left blank', !/isClientPaid:\s*''/.test(s));
}

console.log('2. the label says GSA-Paid, the value stays overhead');
{
  const s=fs.readFileSync('lets_app/client/controllers/form/travelRequestTravelers.html','utf8');
  ok('label reads GSA-Paid', s.indexOf('<span>GSA-Paid</span>')>-1);
  ok('no Overhead label left', s.indexOf('<span>Overhead</span>')===-1);
  // Submission.js:483, Admin_Dashboard.js:446, ReviewerDashboard.js:426 and
  // Review_Action all branch on this string, and submitted rows already carry
  // it. Renaming the value would mean a data migration for a wording change.
  ok("radio value is still 'overhead'", s.indexOf("value=\"overhead\"")>-1);
  ok('GSA-Paid is rendered first', s.indexOf('<span>GSA-Paid</span>') < s.indexOf('<span>Client-Paid</span>'));
  // Anything not explicitly 'client' is GSA-Paid, so a legacy blank row shows
  // as GSA-Paid rather than as neither option selected.
  ok('checked when not client', /traveler\.isClientPaid !== 'client' \? 'checked' : ''/.test(s));
}

console.log('3. no user-facing "Overhead" remains');
{
  const files=[
    'lets_app/client/controllers/form/travelRequestTravelers.html',
    'lets_app/client/controllers/review/travelReviewController.html',
    'lets_app/client/controllers/admin/travelAdminController.html',
    'lets_app/client/controllers/admin/travelReviewerDashboardController.html',
    'lets_app/client/controllers/portal/travelPortalController.html',
    'lets_app/client/pages/ddConfirmPage.html',
    'lets_app/client/shared/travelHelpModal.html'
  ];
  files.forEach(f=>{
    const s=fs.readFileSync(f,'utf8');
    // Permit the stored VALUE and CSS class names; reject display text.
    const bad=s.split('\n').filter(l=>
      /Overhead/.test(l) &&
      !/value="Overhead"/.test(l) &&
      !/--overhead/.test(l) &&
      !/^\s*(\/\/|\*|<!--)/.test(l) &&
      !/stored|branch|VALUE/.test(l));
    ok('no display text in '+f.split('/').pop(), bad.length===0, bad.join(' | '));
  });
}

console.log('4. server display labels updated, stored values untouched');
{
  const ad=fs.readFileSync('lets_app/server/40_domain/Admin_Dashboard.js','utf8');
  ok('dashboard label is GSA-Paid', ad.indexOf("hasClientPaid ? 'Client-Paid' : 'GSA-Paid'")>-1);
  const em=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  ok('email label is GSA-Paid', em.indexOf("isClientPaid ? 'Client-Paid' : 'GSA-Paid'")>-1);
  ok('no Overhead in email subjects', !/NEW Overhead Travel/.test(em));
  // The detection helpers must keep reading the stored string.
  const ra=fs.readFileSync('lets_app/server/40_domain/Review_Action.js','utf8');
  ok('overhead detection still present', /_hasOverheadFrom(Data|Rows)/.test(ra));
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
