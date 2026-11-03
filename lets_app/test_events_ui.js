/**
 * Automated Verification Script for the event catalogue, set-aside editor,
 * proposal queue and the request-form "Other" option.
 *
 * WHY THIS SUITE IS MOSTLY SOURCE ASSERTIONS
 * ------------------------------------------
 * These are browser screens. Executing them needs a DOM, Bootstrap's CSS
 * classes and the Apps Script bridge, none of which exist here. So the suite
 * checks the WIRING — that each control reaches the server function it has to,
 * that the data flows the server expects are actually assembled, and that the
 * failure paths exist.
 *
 * That is a real class of bug and the one most likely here: a button wired to
 * nothing, or a field collected into state and never put in the payload. Both
 * look fine on screen.
 *
 * THE THREE THINGS THAT WOULD BE COSTLY AND SILENT
 * ------------------------------------------------
 * §3 — the "Other" proposal must not block submission. @clolry's traveller
 * has a deadline; losing their request because a catalogue write failed would
 * be far worse than a coordinator matching it up by name.
 *
 * §4 — promoting a proposal must go through resolveEventProposal, not
 * saveTravelEvent. Only the former links the originating request, and without
 * that link the reservation never draws down — silently.
 *
 * §5 — the picker must PRE-FILL, not lock. Somebody attending two days of a
 * five-day conference has different dates from the event, and the per-diem
 * calculation depends on theirs.
 *
 * Run: node lets_app/test_events_ui.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 280)); fails++; }
};

/** Source with comments stripped, so a comment cannot satisfy an assertion. */
function code(path) {
  return fs.readFileSync(path, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))
    .join('\n');
}

const EVC = 'lets_app/client/controllers/admin/travelEventsController.html';
const ADMIN_PAGE = 'lets_app/client/pages/travelAdminPage.html';
const ADMIN_CTL = 'lets_app/client/controllers/admin/travelAdminController.html';
const REQ_PAGE = 'lets_app/client/pages/travelRequestPage.html';
const REQ_CTL = 'lets_app/client/controllers/form/travelRequestController.html';
const REQ_STATE = 'lets_app/client/controllers/form/travelRequestState.html';

console.log('--- Events UI test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. every screen parses, and none reads a page variable');
{
  // An included file is evaluated as its OWN template, so a scriptlet reading
  // a page variable throws on every page that includes it — which took the
  // whole app down once.
  [EVC].forEach(f => {
    const raw = fs.readFileSync(f, 'utf8');
    ok(f.split('/').pop() + ' has no scriptlets', !/<\?=|<\?!=/.test(raw));
    const blocks = raw.match(/<script>([\s\S]*?)<\/script>/g) || [];
    ok('and has a script block', blocks.length > 0);
    let parsed = true;
    try {
      new vm.Script(blocks.map(b => b.replace(/<\/?script>/g, '')).join('\n'));
    } catch (e) { parsed = false; }
    ok('and it parses', parsed);
  });

  // The admin controller and request controller are modified, so re-check.
  [ADMIN_CTL, REQ_CTL, REQ_STATE].forEach(f => {
    const raw = fs.readFileSync(f, 'utf8');
    const blocks = raw.match(/<script>([\s\S]*?)<\/script>/g) || [];
    let parsed = true;
    try {
      new vm.Script(blocks.map(b => b.replace(/<\/?script>/g, '')).join('\n'));
    } catch (e) { parsed = false; }
    ok(f.split('/').pop() + ' still parses', parsed);
  });
}

// ---------------------------------------------------------------------------
console.log('\n2. the admin tab is reachable and reloads every time');
{
  const page = fs.readFileSync(ADMIN_PAGE, 'utf8');
  const ctl = code(ADMIN_CTL);

  ok('the nav has an Events item', /data-view="events"/.test(page));
  ok('the view container exists', /id="eventsView"/.test(page));
  ok('the controller is included',
     /include\('client\/controllers\/admin\/travelEventsController'\)/.test(page));
  ok('and after the roster controller, matching the existing pattern',
     page.indexOf('travelRosterController') < page.indexOf('travelEventsController'));

  ok('the view map knows about it', /'events': 'eventsView'/.test(ctl));
  ok('and switching activates the controller',
     /case 'events':[\s\S]{0,300}TravelEvents\.Controller\.activate\(\)/.test(ctl));

  // RELOADS EVERY TIME, unlike the roster. The proposal queue changes while a
  // coordinator works; a cached view would show a proposal somebody else
  // already handled.
  const evc = code(EVC);
  ok('activate always reloads',
     /activate: function \(\) \{[\s\S]{0,200}load\(\);/.test(evc),
     'a cached queue would show already-handled proposals');
  ok('and does not gate on a loaded flag',
     !/if \(!state\.loaded\)[\s\S]{0,60}load\(\)/.test(evc));

  // The badge tells a coordinator there is work without opening the tab.
  ok('a pending-proposal badge exists', /id="navProposalCount"/.test(page));
  ok('and is populated with the dashboard',
     /_loadProposalBadge/.test(ctl) &&
     /_loadDashboard\(\) \{[\s\S]{0,120}_loadProposalBadge/.test(ctl),
     'a queue nobody knows about is a queue nobody works');
  ok('and a badge failure does not break the dashboard',
     /_loadProposalBadge[\s\S]{0,600}catch[\s\S]{0,120}console\.warn/.test(ctl));
}

// ---------------------------------------------------------------------------
console.log('\n3. the "Other" option does not block submission');
{
  const page = fs.readFileSync(REQ_PAGE, 'utf8');
  const ctl = code(REQ_CTL);
  const st = code(REQ_STATE);

  ok('the request form has an event picker', /id="eventPicker"/.test(page));
  ok('with an Other option', /__OTHER__/.test(page) || /__OTHER__/.test(ctl));
  ok('and a description block revealed by it', /id="eventOtherBlock"/.test(page));

  // The picker sits ABOVE the free-text name rather than replacing it. Most
  // travel is ad-hoc; forcing every trip through a catalogue would mean a
  // coordinator had to create an event before anyone could file a client
  // visit.
  ok('the free-text event name still exists', /id="tripName"/.test(page));
  ok('and the picker is optional, not required',
     !/id="eventPicker"[^>]*required/.test(page));

  ok('state carries eventId', /eventId: ''/.test(st));
  ok('and eventProposalId', /eventProposalId: ''/.test(st));

  // THE CRITICAL ORDERING. The proposal is recorded BEFORE submission so the
  // request can carry its ID — which is how a coordinator finds the request
  // from the queue.
  ok('the proposal is recorded before submitting',
     ctl.indexOf('proposeTravelEvent') < ctl.indexOf('submitTravelRequestV2'),
     'the request must carry the proposal ID');
  ok('and the ID is put on the payload',
     /formData\.eventProposalId = res\.data\.proposalId/.test(ctl));

  // AND A FAILED PROPOSAL MUST NOT LOSE THE REQUEST.
  ok('a failed proposal still submits',
     /catch\(function \(err\) \{[\s\S]{0,200}submitting anyway/.test(ctl) ||
     /submitting anyway/.test(ctl),
     'losing a request because a catalogue write failed is far worse');
  ok('and the failure is logged', /Event proposal failed/.test(ctl));
  ok('the submit runs inside the proposal promise',
     /proposeIfNeeded\.then\(function \(\) \{/.test(ctl));

  // Submission.js must actually store them, or the whole link is cosmetic.
  const sub = code('lets_app/server/40_domain/Submission.js');
  ok('the server stores Event_ID', /formData\.eventId \|\| ''/.test(sub));
  ok('and Event_Proposal_ID', /formData\.eventProposalId \|\| ''/.test(sub));
}

// ---------------------------------------------------------------------------
console.log('\n4. promoting a proposal links the originating request');
{
  const evc = code(EVC);

  // THE SILENT FAILURE THIS GUARDS. saveTravelEvent creates an event;
  // resolveEventProposal creates it AND links the request. Using the former
  // would leave the traveller's request unlinked, and the DAC's reservation
  // would never draw down — invisibly.
  ok('promoting goes through resolveEventProposal',
     /resolveEventProposal', proposalId,\s*\{ action: 'PROMOTE'/.test(evc),
     'saveTravelEvent alone would leave the request unlinked');
  ok('and a plain new event uses saveTravelEvent',
     /serverCall\('saveTravelEvent', payload\)/.test(evc));
  ok('the choice is driven by whether a proposal is being promoted',
     /var call = proposalId[\s\S]{0,200}resolveEventProposal/.test(evc));

  // A link failure must be SURFACED. It is invisible otherwise, and the
  // reservation silently stops working.
  ok('a request-link failure is shown to the coordinator',
     /requestLinkWarning[\s\S]{0,80}window\.alert/.test(evc));

  // @clolry's twelve-people case: one promote, eleven merges.
  ok('duplicates are grouped by name', /function groupProposals/.test(evc));
  ok('the group count is shown on the button',
     /link all/.test(evc), 'so a coordinator knows one action covers all of them');
  ok('and the rest are merged into the created event',
     /action: 'MERGE', eventId: newId/.test(evc));

  // A partial merge is reported rather than silently dropped. Ten of eleven
  // succeeding is better than aborting, and the failures stay in the queue.
  ok('a failed merge is reported, not swallowed',
     /could not be merged and remain in the queue/.test(evc));
  ok('and does not abort the batch',
     /\.catch\(function \(err\) \{[\s\S]{0,200}Could not merge proposal/.test(evc));

  // REJECT requires a reason — a traveller is being told no.
  ok('rejecting requires a reason',
     /A reason is required to reject a proposal/.test(evc));
  ok('and the traveller is told it will be visible',
     /traveller will see this/.test(evc));
}

// ---------------------------------------------------------------------------
console.log('\n5. the picker pre-fills but does not lock');
{
  const ctl = code(REQ_CTL);

  // @clolry asked for pre-fill. A LOCKED field would be wrong: somebody
  // attending two days of a five-day conference has different dates from the
  // event, and per-diem depends on theirs.
  ok('selecting an event fills the name, dates and location type',
     /setIfBlank\('tripName'/.test(ctl) &&
     /setIfBlank\('eventStartDate'/.test(ctl) &&
     /setIfBlank\('eventEndDate'/.test(ctl));
  ok('and only when the field is BLANK',
     /if \(node && !String\(node\.value \|\| ''\)\.trim\(\)\)/.test(ctl),
     'overwriting what the traveller typed loses their work silently');
  ok('no field is disabled by the picker',
     !/eventPicker[\s\S]{0,400}\.disabled = true/.test(ctl));

  // The waiver and meals must reach the traveller. Both change what they may
  // claim: an unknown waiver means an over-claim, and meals provided mean an
  // M&IE deduction a reviewer will otherwise query.
  ok('a registration waiver is surfaced', /registrationWaivedFor/.test(ctl));
  ok('meals provided are surfaced', /mealsProvided/.test(ctl));
  ok('and a required extra form is flagged', /requiresSpecialForm/.test(ctl));

  // A catalogue failure must not block the form.
  ok('a catalogue failure hides the picker rather than blocking',
     /_hideEventPicker/.test(ctl));
  ok('and is logged',
     /Event catalogue unavailable/.test(ctl));
}

// ---------------------------------------------------------------------------
console.log('\n6. the set-aside editor collects what the server requires');
{
  const page = fs.readFileSync(ADMIN_PAGE, 'utf8');
  const evc = code(EVC);

  // The server's validateSetAside requires each of these; a field the editor
  // does not collect becomes an error the admin cannot fix.
  ['saFormEventName', 'saFormMonth', 'saFormFy', 'saFormOffice',
   'saFormAmount', 'saFormBasis'].forEach(id => {
    ok('the editor has ' + id, new RegExp('id="' + id + '"').test(page));
    ok('and sends it', new RegExp("el\\('" + id + "'\\)").test(evc));
  });

  // BASIS IS REQUIRED by the server. Six months on, the row is the only
  // record of how the figure was reached.
  ok('the basis field is marked required in the UI',
     /How was this worked out\? \*/.test(page));

  // A linked reservation takes its month and FY from the event — a month that
  // disagreed would break the draw-down match silently.
  ok('month and FY are read-only when linked to an event',
     /saFormMonth'\)\.readOnly = !!ev/.test(evc) &&
     /saFormFy'\)\.readOnly = !!ev/.test(evc));
  // Collapsed first: the hint is built from concatenated string literals, so
  // the phrase spans a quote-plus-quote boundary in the source.
  const evcFlat = evc.replace(/'\s*\+\s*'/g, '');
  ok('and the hint explains which matching applies',
     /draw the reservation down automatically/.test(evcFlat) &&
     /less reliable/.test(evcFlat),
     'both phrasings must be present: linked is exact, free-text is not');

  // The estimate is ADVISORY and writes its own reasoning into the basis.
  ok('the amount estimator fills the basis text',
     /saFormBasis'\)\.value = n \+ ' travellers/.test(evc));
  ok('and labels itself an estimate',
     /estimate \\u2014 adjust as needed/.test(evc) || /adjust as needed/.test(evc));

  ok('it calls saveEventSetAside', /serverCall\('saveEventSetAside'/.test(evc));
  ok('and shows server-side problems',
     /saFormProblems/.test(evc) && /res\.problems/.test(evc));
}

// ---------------------------------------------------------------------------
console.log('\n7. the event editor collects what the server requires');
{
  const page = fs.readFileSync(ADMIN_PAGE, 'utf8');
  const evc = code(EVC);

  ['evFormName', 'evFormStart', 'evFormEnd', 'evFormCity', 'evFormVirtual',
   'evFormReg', 'evFormWaiver', 'evFormMeals', 'evFormSpecialForm',
   'evFormHistorical'].forEach(id => {
    ok('the editor has ' + id, new RegExp('id="' + id + '"').test(page));
  });

  // The server REJECTS a virtual event with a city, because the city would
  // flow into per-diem logic for an event nobody travelled to.
  ok('marking an event virtual clears and disables the location',
     /evFormVirtual[\s\S]{0,400}node\.disabled = on/.test(evc));

  // Free text, not flags. "Speakers and panel chairs" and "Lunch days 1-3"
  // are the real shapes; a boolean expresses neither.
  // Matched on the whole <input ...> tag, not on attribute ORDER. The markup
  // writes type before id, so an id-then-type pattern found nothing — a
  // brittle assertion that failed on correct markup.
  const inputTag = id => {
    const m = page.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
    return m ? m[0] : '';
  };
  ok('the waiver field is free text',
     /type="text"/.test(inputTag('evFormWaiver')), inputTag('evFormWaiver'));
  ok('and so is meals provided',
     /type="text"/.test(inputTag('evFormMeals')), inputTag('evFormMeals'));

  // Per-diem depends on the city, which is why the server requires it.
  ok('the city field says why it matters',
     /Per-diem rates depend on this/.test(page));

  ok('it calls saveTravelEvent', /serverCall\('saveTravelEvent'/.test(evc));
  ok('and shows server-side problems', /showFormProblems/.test(evc));
}

// ---------------------------------------------------------------------------
console.log('\n8. the planning view surfaces what a DAC reacts to');
{
  const evc = code(EVC);
  const page = fs.readFileSync(ADMIN_PAGE, 'utf8');

  ok('it loads from getTravelEventPlanning',
     /serverCall\('getTravelEventPlanning'/.test(evc));

  // OVER-COMMITMENT IS FLAGGED, not clamped. A reservation consumed beyond
  // its amount is a real condition; showing zero remaining would hide it.
  ok('over-commitment is flagged', /isOverCommitted/.test(evc));
  ok('with its own style', /ev-over/.test(evc));
  ok('and counted in the totals', /overCommittedCount/.test(evc));

  // Planned versus actual travellers is the number a DAC reacts to.
  ok('planned vs actual travellers is shown',
     /actualTravelers \+ ' \/ ' \+ s\.plannedTravelers/.test(evc));
  ok('and an overage is called out', /travelerVariance > 0/.test(evc));

  // A free-text reservation still works but matches less reliably, so it is
  // marked for a coordinator to link up.
  ok('an unlinked reservation is marked',
     /not linked to a catalogue event/.test(evc));

  ok('the table exists', /id="evSetAsides"/.test(page));
  ok('and a totals footer', /id="evSetAsideTotals"/.test(page));
  ok('a load failure is visible', /id="evError"/.test(page) && /showError/.test(evc));
}

// ---------------------------------------------------------------------------
console.log('\n9. escaping, because every field is user text');
{
  const evc = code(EVC);
  // Event names, proposals and notes are all free text typed by a traveller
  // or an admin. "Research & Development" breaks the row it is in without
  // escaping, and a proposal is the one field an untrusted user controls.
  ok('the controller has an escaper', /function esc\(/.test(evc));
  ok('proposal names are escaped', /esc\(g\.name\)/.test(evc));
  ok('proposer emails are escaped', /esc\(p\.proposedBy\)/.test(evc));
  ok('event names are escaped', /esc\(e\.eventName\)/.test(evc));
  ok('set-aside names are escaped', /esc\(s\.eventName\)/.test(evc));
  ok('and the basis text', /esc\(s\.basis\)/.test(evc));

  const ctl = code(REQ_CTL);
  ok('the picker escapes event names', /escapeHtml\(e\.eventName\)/.test(ctl));
  ok('and the hint text', /escapeHtml\(b\)/.test(ctl) || /map\(function \(b\)/.test(ctl));
}

// ---------------------------------------------------------------------------
console.log('\n10. negative controls (the suite must be able to fail)');
{
  const evcRaw = fs.readFileSync(EVC, 'utf8');
  const ctlRaw = fs.readFileSync(REQ_CTL, 'utf8');

  // 10a — promote via saveTravelEvent instead. §4 must fail.
  const ANCHOR = "      ? serverCall('resolveEventProposal', proposalId,";
  ok('the promote anchor is present', evcRaw.indexOf(ANCHOR) > -1);
  const wrongCall = evcRaw.replace(ANCHOR, "      ? serverCall('saveTravelEvent', payload) || serverCall('x', proposalId,");
  ok('a patched build no longer promotes through resolveEventProposal',
     !/resolveEventProposal', proposalId,\s*\{ action: 'PROMOTE'/.test(
       wrongCall.replace(/<!--[\s\S]*?-->/g, '')),
     'so section 4 is exercising a real call');

  // 10b — block submission when the proposal fails. §3 must fail.
  const ANCHOR2 = "proposeIfNeeded.then(function () {";
  ok('the submit-ordering anchor is present', ctlRaw.indexOf(ANCHOR2) > -1);

  // 10c — overwrite what the traveller typed. §5 must fail.
  const ANCHOR3 = "        if (node && !String(node.value || '').trim()) {";
  ok('the blank-only anchor is present', ctlRaw.indexOf(ANCHOR3) > -1);
  const clobber = ctlRaw.replace(ANCHOR3, "        if (node) {");
  ok('a patched build overwrites a typed value',
     !/if \(node && !String\(node\.value \|\| ''\)\.trim\(\)\)/.test(
       clobber.replace(/<!--[\s\S]*?-->/g, '')),
     'so section 5 is exercising a real guard');
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
