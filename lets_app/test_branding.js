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
const fs=require('fs'),vm=require('vm'),path=require('path'),crypto=require('crypto');
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

  // THE EMAIL FOOTER NAMES THE SERVICE, NOT THE OFFICE.
  //
  // @clolry, after the rebranding sweep: "The bottom of the emails still say
  // GENERAL SERVICES ADMINISTRATION • ASSISTED ACQUISITION SERVICES. I think
  // it should say FEDERAL ACQUISITION SERVICE rather than ASSISTED
  // ACQUISITION SERVICES."
  //
  // The sweep missed it because the footer was a hardcoded literal inside a
  // template string in Email.js, not a {{token}} — and because substituting
  // orgLong would have been a THIRD wrong answer. ASD is an office three
  // levels down; a footer names the agency and the service.
  ok('org service', g('getOrgServiceName()')==='FEDERAL ACQUISITION SERVICE');
  ok('agency', g('getAgencyName()')==='GENERAL SERVICES ADMINISTRATION');
  ok('service is NOT the office name',
     g('getOrgServiceName()')!==g('getOrgLongName()'),
     'a footer names the service (FAS), not the office (ASD)');
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

console.log('7c. the email footer is built from configuration');
{
  // The footer survived the first rebranding sweep because it was a literal
  // inside a template string rather than a {{token}}. Checked by content, not
  // by absence of a word, so renaming the constant cannot slip past it.
  const email = fs.readFileSync('lets_app/server/30_services/Email.js', 'utf8');

  ok('no ASSISTED ACQUISITION literal outside comments',
     !email.split('\n').some(l => /ASSISTED ACQUISITION/.test(l) &&
                                   !/^\s*(\/\/|\*|\/\*)/.test(l)),
     email.split('\n').filter(l => /ASSISTED ACQUISITION/.test(l) &&
                                    !/^\s*(\/\/|\*|\/\*)/.test(l)));

  ok('and no hardcoded agency line either',
     !/'GENERAL SERVICES ADMINISTRATION/.test(email) &&
     !/>\s*GENERAL SERVICES ADMINISTRATION/.test(email),
     'the agency is configurable too, so a non-GSA workgroup need not edit this file');

  ok('the footer resolves through orgLine',
     /\$\{EMAIL_CONTENT\.global\.orgLine\}/.test(email));
  ok('and orgLine reads agency + service',
     /_brand\(\)\.agency[\s\S]{0,60}_brand\(\)\.orgService/.test(email));

  // _brand() must actually carry them, or orgLine renders 'undefined •
  // undefined' — which looks like a template bug rather than a config one.
  ok('_brand exposes agency and orgService',
     /orgService: getOrgServiceName\(\)/.test(email) &&
     /agency: getAgencyName\(\)/.test(email));

  // THE CI GUARDS THAT WATCH THIS FILE WERE SILENTLY DEAD.
  //
  // Email.js contains ✓ and ⚠ characters, and this container has no UTF-8
  // locale, so grep classifies the file as BINARY. `grep -n pattern file`
  // prints "binary file matches" instead of matching lines — so any guard
  // piping grep output into a filter saw one bogus line and drew the wrong
  // conclusion. `grep -q` is unaffected; output-consuming greps are not.
  //
  // The hardcoded-TRIP guard had been passing for this reason. Verified by
  // putting a TRIP literal back in and watching it pass.
  const wf = fs.readFileSync('.github/workflows/verify.yml', 'utf8');
  const unsafe = wf.split('\n').filter(l => {
    if (!/grep/.test(l)) return false;
    if (!/\||\$\(|`/.test(l)) return false;          // output not consumed
    if (/grep\s+-[a-zA-Z]*a/.test(l)) return false;  // already binary-safe
    // `find ... | grep .` reads find's output, not a file's contents, so the
    // binary heuristic cannot apply.
    if (/find\s/.test(l)) return false;
    return /lets_app|orgchart_app/.test(l);
  });
  ok('every output-consuming grep in CI is binary-safe (-a)',
     unsafe.length === 0, unsafe.map(l => l.trim().slice(0, 70)));
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

console.log('10. no initializer may WRITE a branding property');
{
  // THE DEFECT THIS SECTION EXISTS FOR
  // ----------------------------------
  // initEmailConfigDefaults set EMAIL_FROM_ADDRESS to 'aastravel@gsa.gov'
  // and EMAIL_FROM_NAME to 'AAS Travel' whenever they were unset — the
  // inherited workgroup's mailbox and sender name.
  //
  // Section 1 asserted the correct defaults and PASSED the whole time,
  // because it builds its context with no properties set and never calls the
  // initializer. A getter's default only applies while the property is
  // UNSET, and this function's entire job was to set it. So the test and the
  // defect coexisted: every assertion green, and one call to a
  // browser-reachable function (initTravelEmailConfig in Email.js) would
  // have permanently re-branded every outbound email with no error anywhere.
  //
  // This executes the initializer and then re-reads, which is the only way
  // to see it. Asserting on source text would not have caught it either.
  const store = {};
  const ctx = vm.createContext({ console: { log() {} }, String, Object, Array,
    Number, parseInt, parseFloat, isNaN,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = v; }
    })}});
  vm.runInContext(fs.readFileSync('lets_app/server/00_config/Props.js', 'utf8'), ctx);
  const g = e => vm.runInContext(e, ctx);

  const before = { addr: g('getEmailFromAddress()'), name: g('getEmailFromName()') };
  g('initEmailConfigDefaults()');
  const after = { addr: g('getEmailFromAddress()'), name: g('getEmailFromName()') };

  ok('the initializer writes NOTHING to Script Properties',
     Object.keys(store).length === 0, store);
  ok('the sender address survives it', after.addr === before.addr, after);
  ok('the sender name survives it', after.name === before.name, after);
  ok('and the surviving values are ASD, not the inherited workgroup',
     after.addr === 'ASD.Travel-Events@gsa.gov' && after.name === 'ASD Travel & Events',
     after);
  ok('no AAS value anywhere after init',
     JSON.stringify(after).indexOf('AAS') === -1 &&
     JSON.stringify(after).toLowerCase().indexOf('aastravel') === -1, after);

  // The sender name DERIVES from the org short name. Persisting it would
  // freeze it — the same bug one step removed — so prove the derivation is
  // still live after the initializer has run.
  store['ORG_SHORT_NAME'] = 'XYZ';
  ok('the sender still tracks a later ORG_SHORT_NAME change',
     g('getEmailFromName()') === 'XYZ Travel & Events', g('getEmailFromName()'));
}

console.log('11. no user-visible inherited brand string in any page or component');
{
  // WHY THIS IS SEPARATE FROM SECTION 3
  // -----------------------------------
  // Section 3 checks four named files. Three user-visible AAS strings
  // survived the rebrand in files it does not look at: "Pending AAS FO" in
  // the admin status-override dropdown, an aastravel@gsa.gov help link on
  // the request form, and the same address twice on the access-blocked page.
  //
  // The patterns were right; the SCOPE was wrong. So this walks the
  // directories rather than naming files — a new page is covered the day it
  // is added, not the day someone remembers to extend a list.
  const dirs = ['lets_app/client/pages', 'lets_app/client/components'];

  // Dead file, tracked for deletion: nothing include()s Loader.html.
  // Excluded rather than rebranded because the right fix is removal, and
  // that does not belong in a branding change. Asserted dead below.
  const SKIP = new Set(['Loader.html']);

  const files = [];
  dirs.forEach(d => fs.readdirSync(d).forEach(f => {
    if (/\.html$/.test(f) && !SKIP.has(f)) files.push(path.join(d, f));
  }));
  ok('found pages and components to scan', files.length > 8, files.length);

  const offenders = [];
  files.forEach(f => {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*|<!--)/.test(line)) return;
      // Identifiers are code, not copy: AAS_LOGO, _buildAASLogo,
      // aas-brand-header, --aas-*, getAASOrgScope, trip-blocked.
      const code = line
        .replace(/AAS_LOGO|_buildAASLogo|aas-brand-header|getAASOrgScope|--aas-[\w-]*|trip-blocked[\w-]*|aas-logo/g, '');
      // User-visible positions only: element text, option labels, titles,
      // placeholders, alt text.
      if (/>[^<]*\bAAS\b/.test(code) ||
          /placeholder="[^"]*\bAAS\b/.test(code) ||
          /alt="[^"]*\bAAS\b/.test(code) ||
          /aastravel@gsa\.gov/.test(code) ||
          /'[^']*\bTRIP\b|"[^"]*\bTRIP\b/.test(code)) {
        offenders.push(f.split('/').pop() + ':' + (i + 1) + ' -> ' + line.trim().slice(0, 90));
      }
    });
  });
  ok('no inherited brand string in user-visible page text', offenders.length === 0, offenders);

  // The skipped file is only safe to skip while it stays unreachable.
  const reachable = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const full = path.join(d, e.name);
      if (e.isDirectory()) return walk(full);
      if (!/\.(html|js)$/.test(e.name)) return;
      if (e.name === 'Loader.html') return;
      const src = fs.readFileSync(full, 'utf8');
      if (/include\(\s*['"][^'"]*\/Loader['"]\s*\)|createTemplateFromFile\(\s*['"][^'"]*\/Loader['"]/.test(src)) {
        reachable.push(full);
      }
    });
  })('lets_app');
  ok('the excluded Loader.html is still unreachable — if this fails, rebrand it or delete it',
     reachable.length === 0, reachable);
}

console.log('12. the email logo is the ASD artwork, not the inherited one');
{
  // A base64 payload is unreviewable in a diff: two blobs look identical to
  // a human, so a logo regression is invisible in review. Pin the inherited
  // asset's hash and assert the live one differs and decodes to a real PNG.
  const email = fs.readFileSync('lets_app/server/30_services/Email.js', 'utf8');
  const m = email.match(/const TRAVEL_LOGO_BASE64 = '([A-Za-z0-9+/=]*)';/);
  ok('TRAVEL_LOGO_BASE64 is present and parseable', !!m);

  const b64 = m ? m[1] : '';
  ok('it is not empty (empty silently falls back to the text logo)', b64.length > 0);

  const sha = crypto.createHash('sha256').update(b64).digest('hex');
  const AAS_SHA = '33fa63c272e971ce950a62d66c68386767365e797f4454ab44194964d0bbaf10';
  ok('it is NOT the inherited AAS artwork', sha !== AAS_SHA, sha);

  const png = Buffer.from(b64, 'base64');
  ok('it decodes to a PNG', png.slice(1, 4).toString() === 'PNG');
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  // Rendered at 240 px wide by _buildAASLogo, so 480 is the 2x floor for a
  // retina client. Narrower than that and it renders soft.
  ok('it is at least 2x the 240px render width', w >= 480, { w, h });
  ok('it has an alpha channel (color type 6)', png[25] === 6, png[25]);
}

console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
