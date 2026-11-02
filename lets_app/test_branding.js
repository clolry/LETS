/**
 * Automated Verification Script for configurable branding.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app was inherited from another workgroup and still identified as theirs:
 * "TRIP" in 69 places, "AAS FO" in 56, aastravel@gsa.gov in 11, signed as
 * "AAS TRIP", footered as ASSISTED ACQUISITION SERVICES. @clolry: deploying
 * this for another workgroup should be a configuration change, not a code
 * change.
 *
 * Section 2 is the actual requirement — a different workgroup sets six Script
 * Properties and nothing hardcoded leaks through. Section 1 asserts the
 * defaults are THIS deployment's values, so an unset property is the common
 * case rather than a bug.
 *
 * TERMINOLOGY, CONFIRMED WITH @clolry
 * -----------------------------------
 *   SD  -> SCD   Service Center Director
 *   BU  -> DAC   Deputy Assistant Commissioner, the SES running each of
 *                FCA / FCB / FCC — the same approver the budget-attribution
 *                work routes to
 *   AAS FO -> ASD Travel & Events
 *
 * Only LABELS changed. 'Sector', 'BU' and 'AAS FO' remain as STORED
 * Initial_Review_Level values, and section 3 explicitly permits those while
 * rejecting display literals — renaming stored data would need a migration.
 *
 * SECTION 4 IS THE BUG @clolry REPORTED
 * -------------------------------------
 * His submission confirmation showed green checkmarks against Submitted, SD,
 * BU and AAS FO, with only FAS pending — on a request reviewed by nobody.
 *
 * sendSubmitterConfirmation passed currentStage = STAGE_MAP[reviewLevel], and
 * a FAS-routed request resolves to index 4 of 5. Everything before the current
 * index rendered as COMPLETE. The tracker was showing position in the sequence
 * and reading as work done.
 *
 * Two fixes, both asserted: the confirmation now starts at 'submitted', and a
 * stage before the current one is only "complete" if it was VISITED. The four
 * workflow variants mean "skipped" and "completed" are genuinely different
 * states, and rendering them identically was the second half of the lie.
 *
 * Run: node lets_app/test_branding.js
 */

// Branding must be configurable: the app was inherited from another workgroup
// and still called itself TRIP, signed as AAS, and pointed at aastravel@.
const fs=require('fs'),vm=require('vm');
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x).slice(0,220));fails++;}};

function props(overrides){
  const p=overrides||{};
  const ctx=vm.createContext({console,String,Object,Array,Number,parseInt,parseFloat,isNaN,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>(k in p?p[k]:null)})}});
  vm.runInContext(fs.readFileSync('lets_app/server/00_config/Props.js','utf8'),ctx);
  return ctx;
}

console.log('1. defaults are THIS deployment, so unset is not a bug');
{
  const c=props();
  const g=e=>vm.runInContext(e,c);
  ok('app name', g('getAppName()')==='LETS', g('getAppName()'));
  ok('org short', g('getOrgShortName()')==='ASD');
  ok('org long', g('getOrgLongName()')==='ACQUISITION SOLUTIONS DEVELOPMENT');
  ok('front office label', g('getOrgFOLabel()')==='ASD Travel & Events');
  // SD -> SCD (Service Center Director), BU -> DAC (Deputy Assistant
  // Commissioner, the SES running each of FCA/FCB/FCC).
  ok('sector label is SCD', g('getReviewLabelSector()')==='SCD');
  ok('BU label is DAC', g('getReviewLabelBU()')==='DAC');
  ok('contact mailbox', g('getEmailFromAddress()')==='ASD.Travel-Events@gsa.gov');
  // Derived from org short, so one property rebrands the sender too.
  ok('sender derives from org', g('getEmailFromName()')==='ASD Travel & Events');
  ok('no "TRIP" anywhere in the defaults',
     JSON.stringify(g('getBrandingForClient()')).indexOf('TRIP')===-1,
     g('getBrandingForClient()'));
  ok('no "AAS" anywhere in the defaults',
     JSON.stringify(g('getBrandingForClient()')).indexOf('AAS')===-1);
}

console.log('2. another workgroup rebrands with properties only');
{
  const c=props({APP_NAME:'TRAVELX', ORG_SHORT_NAME:'XYZ',
    ORG_LONG_NAME:'SOME OTHER SERVICE', ORG_FO_LABEL:'XYZ Front Office',
    REVIEW_LABEL_SECTOR:'Regional Director', REVIEW_LABEL_BU:'Division Chief',
    travel_email_address:'xyz.travel@gsa.gov'});
  const b=vm.runInContext('getBrandingForClient()',c);
  ok('app name overridden', b.appName==='TRAVELX', b);
  ok('org overridden', b.orgShort==='XYZ');
  ok('stage labels overridden', b.sectorLabel==='Regional Director' && b.buLabel==='Division Chief', b);
  ok('contact overridden', b.contactEmail==='xyz.travel@gsa.gov');
  ok('nothing hardcoded leaks through',
     JSON.stringify(b).indexOf('ASD')===-1 && JSON.stringify(b).indexOf('LETS')===-1, b);
}

console.log('3. no literal brand strings remain in user-visible code');
{
  // Comments and STORED values are fine; display strings are not.
  const files=['lets_app/server/30_services/Email.js',
               'lets_app/server/50_pages/Render.js',
               'lets_app/client/shared/travelUtils.html',
               'lets_app/client/controllers/portal/travelPortalController.html'];
  files.forEach(f=>{
    const lines=fs.readFileSync(f,'utf8').split('\n');
    const bad=lines.filter((l,i)=>{
      if(/^\s*(\/\/|\*|\/\*|<!--)/.test(l)) return false;
      if(/'AAS FO'|"AAS FO"/.test(l)) return false;   // STORED review level
      if(/_buildAASLogo|aas-brand-header|TRAVEL_LOGO|TRIP_FAVICON/.test(l)) return false; // identifiers
      return /'[^']*\bTRIP\b|"[^"]*\bTRIP\b|aastravel@gsa\.gov/.test(l);
    });
    ok('no brand literals in '+f.split('/').pop(), bad.length===0, bad.slice(0,2));
  });
}

console.log('4. the progress tracker no longer claims completed reviews');
{
  // @clolry's confirmation showed green checkmarks against SD, BU and AAS FO
  // on a brand-new request. Cause: currentStage came from the ROUTED level,
  // and everything before that index rendered as complete — the tracker was
  // showing position in the sequence and reading as work done.
  const e=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  const i=e.indexOf('function sendSubmitterConfirmation');
  const body=e.slice(i, e.indexOf('\nfunction sendReviewerNotification'));
  ok('submission starts at the first stage', /const currentStage = 'submitted';/.test(body),
     (body.match(/const currentStage = [^;]+;/)||[])[0]);
  ok('no longer derives the stage from the routed level',
     !/const currentStage = STAGE_MAP\[reviewLevel\]/.test(body));

  // A skipped stage is not an approved one: four workflow variants mean
  // "skipped" and "completed" are genuinely different states.
  const t=e.slice(e.indexOf('function _buildProgressTracker'));
  ok('tracker distinguishes visited from skipped', /wasVisited/.test(t));
  ok('skipped renders differently', /index < stageIndex && !wasVisited/.test(t));
  ok('completion requires a visit', /index < stageIndex && wasVisited/.test(t));
}

console.log('5. the confirmation names the reviewer');
{
  const e=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  const i=e.indexOf('function sendSubmitterConfirmation');
  const body=e.slice(i, e.indexOf('\nfunction sendReviewerNotification'));
  // "your assigned reviewer" told @clolry nothing. Matched in CODE only: the
  // comment explaining the removal necessarily contains the old string, and a
  // check that trips on its own documentation is one people delete.
  const code=body.split('\n').filter(l=>!/^\s*(\/\/|\*)/.test(l)).join('\n');
  ok('no "your assigned reviewer" placeholder', !/your assigned reviewer/.test(code));
  ok('names the reviewer and email', /reviewer\.email \? reviewer\.name/.test(body));
  // An unrouted request must not read like a normal one.
  ok('says so when unassigned', /has not been assigned yet/.test(body));
}

console.log('6. stage labels resolve from configuration');
{
  const e=fs.readFileSync('lets_app/server/30_services/Email.js','utf8');
  ok('workflow stages are built at call time', /function getWorkflowStagesFull/.test(e));
  ok('labels come from getters', /case 'bu_review': return getReviewLabelBU\(\)/.test(e));
  ok('no frozen WORKFLOW_STAGES_FULL const', !/const WORKFLOW_STAGES_FULL/.test(e));
  // 'SD', 'BU' and 'AAS FO' were the inherited labels.
  ok("no 'SD' stage literal", !/label: 'SD'/.test(e));
  ok("no 'BU' stage literal", !/label: 'BU'/.test(e));
  ok("no 'AAS FO' stage literal", !/label: 'AAS FO'/.test(e));
}
console.log('7. every review surface reads one label source');
{
  // Four status maps plus the help modal each hardcoded 'AAS FO' and 'BU'
  // independently. A REVIEW_LABEL_BU change has to move all of them, or the
  // help text contradicts the status badge next to it.
  const surfaces = [
    'lets_app/client/controllers/review/travelReviewController.html',
    'lets_app/client/controllers/admin/travelAdminController.html',
    'lets_app/client/controllers/admin/travelReviewerDashboardController.html',
    'lets_app/client/controllers/admin/travelUsersController.html',
    'lets_app/client/controllers/portal/travelPortalController.html'
  ];
  surfaces.forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n');
    // Permit stored values and CSS classes; reject display labels.
    const bad = code.split('\n').filter(l =>
      /label:\s*'[^']*AAS FO|displayLong:\s*'[^']*BU |label:\s*'(Pending )?(BU|Sector) /.test(l));
    ok('no hardcoded stage label in ' + f.split('/').pop(), bad.length === 0, bad.slice(0, 2));
    ok('reads stageLabels in ' + f.split('/').pop(),
       /stageLabels\(\)/.test(code), 'does not use the shared source');
  });

  // Help documentation must follow the same source, or it describes a
  // workflow using names no other screen shows.
  const help = fs.readFileSync('lets_app/client/shared/travelHelpModal.html', 'utf8');
  ok('help modal marks stages for substitution', (help.match(/data-help-stage/g) || []).length >= 10,
     (help.match(/data-help-stage/g) || []).length);
  ok('help modal applies branding at runtime', /applyHelpBranding/.test(help));
  const helpCode = help.split('\n').filter(l => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n');
  ok('no "AAS" left in help text', !/\bAAS\b/.test(helpCode),
     (helpCode.match(/.{0,40}\bAAS\b.{0,40}/) || [])[0]);
  ok('no "overhead-funded" left in help text', !/overhead-funded/.test(helpCode));
}

console.log('7b. admin Users page must not hardcode the inherited org name');
{
  // @clolry, testing the admin portal: "it has many references to AAS — when I
  // went to add a user it says Search AAS staff ... I wanted it to say ASD not
  // AAS."
  //
  // Section 7 only rejected hardcoded STAGE labels, so these survived: they
  // name the ORG, not a review stage.
  const f = 'lets_app/client/controllers/admin/travelUsersController.html';
  const src = fs.readFileSync(f, 'utf8');
  // Strips single-line comments too (/** ... */ on one line), which section 7's
  // filter does not — it only skips lines STARTING with * or //.
  const code = src.split('\n')
    .filter(l => !/^\s*(\/\/|\/\*|\*|<!--)/.test(l))
    .join('\n');

  // STORED role types and sheet values legitimately contain 'aas' — renaming
  // 'aas_fo_reviewer' would orphan every existing Travel_User_Roles row. Only
  // DISPLAY strings are checked.
  const hits = code.split('\n')
    .filter(l => /\bAAS\b/.test(l))
    .filter(l => !/'aas_fo_reviewer'|AAS FO'|'AAS/.test(l));
  ok('no user-visible "AAS" in the Users controller', hits.length === 0, hits.slice(0, 3));

  ok('org name comes from branding', /_L\(\)\.orgShort/.test(code),
     'should read stageLabels().orgShort');

  // ROLE_META must be built LAZILY. This file is included above the page's
  // window._letsBranding assignment, so an object literal calling _L() at
  // definition time captured the fallback labels and ignored the property.
  ok('role metadata is built lazily, after branding is published',
     /function _roleMeta\(\)/.test(code) && !/^\s*var ROLE_META = \{/m.test(code));

  // stageLabels must actually carry the org, or _L().orgShort is undefined
  // and the UI prints "Search undefined staff".
  const utils = fs.readFileSync('lets_app/client/shared/travelUtils.html', 'utf8');
  ok('stageLabels exposes orgShort', /orgShort: b\.orgShort/.test(utils));
  ok('stageLabels exposes appName', /appName: b\.appName/.test(utils));
}

console.log('8. all four page templates publish branding to the client');
{
  // A page that does not set window._letsBranding falls back to hardcoded
  // defaults, which works for THIS deployment and silently breaks rebranding
  // for the next one.
  ['travelPortalPage','travelReviewPage','travelAdminPage','travelReviewerDashboardPage']
    .forEach(page => {
      const src = fs.readFileSync('lets_app/client/pages/' + page + '.html', 'utf8');
      ok(page + ' publishes branding', /window\._letsBranding/.test(src));
      ok(page + ' passes appName', /appName: '<\?= appName \?>'/.test(src));
    });
  // And the server must supply it to every served page.
  const r = fs.readFileSync('lets_app/server/50_pages/Render.js', 'utf8');
  ok('Render applies branding to templates', (r.match(/_applyBranding\(template\)/g) || []).length >= 8,
     (r.match(/_applyBranding\(template\)/g) || []).length);
}

console.log('9. included files must not reference page template variables');
{
  // include() evaluates each file as its OWN template (Render.js:373), so a
  // variable set on a PAGE template is invisible inside an included file.
  //
  // This broke the whole app: <?= appName ?> was added to travelHelpModal,
  // which every page includes, and threw "ReferenceError: appName is not
  // defined" — on pages with no appName reference of their own, which is why
  // the error location was misleading.
  //
  // Section 8 checked that PAGES publish branding. It could not catch this,
  // because the page/include distinction is invisible in the file itself.
  const path = require('path');
  const dirs = ['lets_app/client/shared', 'lets_app/client/components',
                'lets_app/client/controllers'];
  const offenders = [];
  dirs.forEach(dir => {
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
        const full = path.join(d, e.name);
        if (e.isDirectory()) return walk(full);
        if (!/\.html$/.test(e.name)) return;
        const src = fs.readFileSync(full, 'utf8');
        src.split('\n').forEach((line, i) => {
          // Scriptlets calling a SERVER FUNCTION are fine — those resolve in
          // any template. A bare identifier is a page variable and will throw.
          const m = line.match(/<\?=?!?=\s*([A-Za-z_$][\w$]*)\s*\?>/);
          if (m && !/\(/.test(line)) {
            offenders.push(full.split('/').pop() + ':' + (i + 1) + ' -> ' + m[1]);
          }
        });
      });
    })(dir);
  });
  ok('no included file reads a page template variable', offenders.length === 0, offenders);

  // The help modal must get its app name at runtime instead.
  const help = fs.readFileSync('lets_app/client/shared/travelHelpModal.html', 'utf8');
  ok('help modal marks the app name for substitution', /data-help-app/.test(help));
  ok('and fills it from branding', /_letsBranding && window\._letsBranding\.appName/.test(help));
}

console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
