/**
 * Automated Verification Script for the UI fixes from @clolry's walkthrough.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Section 1 is the important one. An Apps Script web app renders inside a
 * sandbox iframe on *.googleusercontent.com, so a RELATIVE navigation —
 * window.location.href = '?mode=travel' — resolves against the IFRAME origin
 * rather than the /exec address. The browser navigates the iframe to a URL
 * with no handler, producing a blank page AND a history entry per attempt.
 *
 * @clolry hit this on the Travel Budget page and needed roughly 25 back
 * presses to escape. Every other page already used navigateToTravel(), which
 * builds an absolute URL from the cached script URL and navigates window.top;
 * that one page did not. The check is repo-wide so the next page cannot
 * reintroduce it.
 *
 * Section 2 pins the two ordering constraints that make the fix work:
 * window._travelScriptUrl must be set BEFORE navLoader loads, because
 * navLoader's IIFE reads it at load time and otherwise falls back to an async
 * resolve that loses the user-gesture activation a top-level navigation
 * requires; and navLoader cannot sit in <head>, because it renders a <div>.
 *
 * Section 3 covers the gross-up labels. The traveler card and the review cost
 * matrix both printed a hardcoded "15%" beside a figure computed at 30%. A
 * number labelled with the wrong rate is worse than an unlabelled one — an
 * approver reading "15%" next to a 30% figure has been actively misinformed.
 *
 * Section 4 covers GSA Site. Four separate places hardcoded the same
 * client-site/contractor-site pair, which is why adding a type meant finding
 * all four; they now read TRAVEL_CONFIG.LOCATION_TYPES_WITH_SITE.
 *
 * Run: node lets_app/test_ui_fixes.js
 */

// Guards the navigation and label fixes that came out of @clolry's walkthrough.
const fs=require('fs');
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':String(x).slice(0,200));fails++;}};

console.log('1. no page navigates with a relative ?mode= URL');
{
  // An Apps Script web app renders inside a sandbox iframe on
  // *.googleusercontent.com, so a RELATIVE url resolves against the IFRAME
  // origin, not /exec. The browser navigates the iframe to a URL with no
  // handler: a blank page, plus a history entry per attempt. @clolry needed
  // ~25 back presses to escape the budget page.
  const files=fs.readdirSync('lets_app/client/pages').filter(f=>f.endsWith('.html'))
    .map(f=>'lets_app/client/pages/'+f);
  files.forEach(f=>{
    const s=fs.readFileSync(f,'utf8');
    // Skip comment lines: travelBudgetDashboardPage documents the old broken
    // form in a comment explaining why it was replaced, and matching that
    // would make the check fail on its own explanation.
    const bad=s.split('\n').filter(l=>
      /window\.location\.href\s*=\s*['"]\?mode=/.test(l) &&
      !/^\s*(\/\/|\*|<!--|navigateToTravel\(\), NOT)/.test(l.trim()) &&
      !/NOT window\.location/.test(l));
    ok('no relative nav in '+f.split('/').pop(), bad.length===0, bad.join(' | '));
  });
}

console.log('2. the budget page can navigate home');
{
  const s=fs.readFileSync('lets_app/client/pages/travelBudgetDashboardPage.html','utf8');
  ok('uses navigateToTravel', s.indexOf("navigateToTravel('travel')")>-1);
  ok('includes navLoader', s.indexOf("include('client/components/navLoader')")>-1);
  ok('sets _travelScriptUrl', s.indexOf('window._travelScriptUrl')>-1);
  // navLoader's IIFE reads the URL at load time, so the assignment has to come
  // first or it falls back to an async resolve that loses gesture activation.
  ok('scriptUrl is set BEFORE navLoader loads',
     s.indexOf('window._travelScriptUrl') < s.indexOf("include('client/components/navLoader')"));
  // It renders a <div>, which is invalid inside <head>.
  const head=s.slice(0,s.indexOf('</head>'));
  ok('navLoader is not in <head>', head.indexOf("include('client/components/navLoader')")===-1);
}

console.log('3. gross-up labels are not hardcoded');
{
  const tv=fs.readFileSync('lets_app/client/controllers/form/travelRequestTravelers.html','utf8');
  ok('traveler card label is dynamic', tv.indexOf('tcGrandOtherLabel_')>-1);
  ok('no "+15%" literal in the card', !/>\+15%</.test(tv) && tv.indexOf("'+15%:'")===-1);
  ok('label is refreshed on recalc', /tcGrandOtherLabel_\$\{travelerId\}/.test(tv));
  const rv=fs.readFileSync('lets_app/client/controllers/review/travelReviewController.html','utf8');
  ok('review matrix header is dynamic', !/>15% Gross-Up</.test(rv), 'still hardcoded');
  ok('review matrix derives from travelers', rv.indexOf("uniq.length === 1 ? uniq[0] + '% Gross-Up'")>-1);
}

console.log('4. GSA Site is a location type, and site name follows one list');
{
  const pg=fs.readFileSync('lets_app/client/pages/travelRequestPage.html','utf8');
  ok('gsa-site option present', pg.indexOf('value="gsa-site"')>-1);
  const ut=fs.readFileSync('lets_app/client/shared/travelUtils.html','utf8');
  ok('gsa-site needs a site name', /LOCATION_TYPES_WITH_SITE:\s*\['client-site', 'contractor-site', 'gsa-site'\]/.test(ut));
  // Four places hardcoded the same pair, which is why adding a type meant
  // finding all four. They now read the single list.
  ['lets_app/client/controllers/form/travelRequestItinerary.html',
   'lets_app/client/controllers/form/travelRequestController.html',
   'lets_app/client/controllers/form/travelRequestState.html'].forEach(f=>{
    const s=fs.readFileSync(f,'utf8');
    ok('no hardcoded site-type pair in '+f.split('/').pop(),
       !/locationType === 'client-site' \|\| locationType === 'contractor-site'/.test(s));
    ok('reads LOCATION_TYPES_WITH_SITE in '+f.split('/').pop(),
       s.indexOf('LOCATION_TYPES_WITH_SITE')>-1);
  });
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
