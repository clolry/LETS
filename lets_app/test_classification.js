/**
 * Automated Verification Script for the Step 4 classification rewrite.
 *
 * WHY THE STRINGS MATTER MORE THAN THE WORDING
 * --------------------------------------------
 * These option values are written into the FAS Travel Exemption Tracker, which
 * is a GOOGLE FORM. A value the form does not recognise is rejected or lands
 * as free text, so the strings cannot be tidied, abbreviated or re-worded —
 * including the tracker's own typo, "Oversees Employee (within OCONUS)", and
 * its en-dashes (U+2013) in the primary-justification list.
 *
 * Sections 1-3 therefore compare every option against a verbatim transcription
 * of the live form. The visible LABEL may differ from the stored value; the
 * value may not.
 *
 * WHAT WAS WRONG BEFORE
 * ---------------------
 * The Type of Travel list was the inherited TRIP taxonomy and overlapped the
 * tracker's only loosely — "Internal Travel" and "Vendor Meeting" do not exist
 * in the tracker at all. The mission-critical list was the prose from the OAS
 * memo quoted in the tracker's INTRODUCTION rather than the form's own option
 * labels: close in meaning, different strings.
 *
 * And the tracker's SECOND mission-critical question — a single-select
 * "Justification ... select the primary reason when multiple reasons apply" —
 * had no equivalent in the form at all, which is why validateForFASTracker
 * reports a submission as incomplete.
 *
 * SECTION 4 IS THE ONE WORTH READING
 * ----------------------------------
 * The tracker splits Internal Mission Meeting at $10,000. LETS already knows
 * the grand total, so neither option is offered as a checkbox — both are
 * DERIVED. Asking a submitter to classify their own request against a
 * threshold they have not been shown invites the wrong answer, and the answer
 * would go stale the moment a cost changed.
 *
 * The submitter's own Step 1 threshold choice is deliberately NOT trusted: the
 * test asserts that a request marked IMM_UNDER_10K but costing $12,000 sends
 * the >= $10,000 option. Those are two different questions — Step 1 drives FAS
 * delegation tiering, this list is the tracker's taxonomy — and the computed
 * total is authoritative.
 *
 * Because a value appearing in a submission that the user never selected is
 * worse than one they had to choose, getDerivedTrackerPurpose exposes it so
 * the form can say what was added on their behalf.
 *
 * Section 6 covers the draft round-trip. getFormData folds the derived option
 * into travelTypes and appends "Other: <text>", so restoring a draft from
 * those lists would turn a computed value into a ticked checkbox and leave an
 * un-matchable "Other: foo" string. The raw selections are preserved
 * separately for exactly that reason.
 *
 * Run: node lets_app/test_classification.js
 */

// Step 4 classification rewritten against the FAS exemption tracker's own
// option strings. The tracker is a Google Form: a value it does not recognise
// is rejected or lands as free text, so the strings cannot be tidied.
const fs=require('fs'),vm=require('vm');
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x).slice(0,220));fails++;}};

// Transcribed verbatim from the live form, 2026-11-01.
const TRACKER_PURPOSES=[
 'Site Visits, Inspections, Acceptance, Delivery',
 'Internal Mission Meeting (all travelers under $10,000)',
 "Internal Mission Meeting (all travelers >= $10,000 and Event Tracker req'd)",
 'Customer Meeting','Vendor or Industry Meeting','Speaking Engagement',
 'GSA Sponsored Conference','Non-GSA Sponsored Conference','Local Travel',
 'International','Oversees Employee (within OCONUS)',
 'Training (GSA provided or third party under $7000)',
 'Training (third party >= $7000 and CSA required)'];
const TRACKER_MC=[
 'Statutory or Contractual Requirement',
 'Inspection/Acceptance (e.g., vehicles, manufacturing)',
 'SCIF or Secure Facility Activities',
 'Technical Evaluation Board (In-Person Required)',
 'Industry/Customer Engagement Supporting Acquisition',
 'Mission-Critical Internal Coordination (Not Feasible Virtually)',
 'Retail Operations Oversight','Other'];
const TRACKER_PRIMARY=[
 'Conference/Event – Speaker / Presenter',
 'Conference/Event – Attendance (Mission-Linked)',
 'Customer, vendor, or stakeholder engagement with defined outcome',
 'Contract / Task Order Execution',
 'Site inspection, compliance check, requirements validation',
 'Contract oversight, performance management, issue resolution',
 'Technical work requiring physical presence (e.g., installation, engineering, assessment)',
 'Internal mission coordination critical to delivery (planning, alignment, execution support)',
 'Training required to perform current duties or support an active project',
 'Training or workshop aligned to career development goals','Other'];

const page=fs.readFileSync('lets_app/client/pages/travelRequestPage.html','utf8');
function valuesIn(containerId){
  const i=page.indexOf('id="'+containerId+'"');
  const end=page.indexOf('</div>\n              </div>',i);
  const block=page.slice(i, end>0?end:i+8000);
  return [...block.matchAll(/<input type="checkbox" value="([^"]+)"/g)].map(m=>m[1]);
}

console.log('1. Purpose of Travel is derived, not asked');
{
  // The checkbox column was removed. @clolry could not tell what to pick for
  // an internal management meeting, because Step 1 had already asked.
  ok('no travel-types checkbox column', page.indexOf('id="travelTypesContainer"')===-1);
  ok('derived panel present instead', page.indexOf('id="derivedPurposeList"')>-1);
  ok('labelled as automatic', /Determined automatically/.test(page));
  // Nothing in the page should offer these as choices any more.
  ok('no Customer Meeting checkbox', page.indexOf('type="checkbox" value="Customer Meeting"')===-1);
  ok('no Local Travel checkbox', page.indexOf('type="checkbox" value="Local Travel"')===-1);
}

console.log('2. Mission-critical options are the tracker\'s, verbatim');
{
  const got=valuesIn('missionCriticalContainer');
  got.forEach(v=>ok('tracker recognises "'+v.slice(0,40)+'"', TRACKER_MC.indexOf(v)>-1, v));
  ok('all 8 present', got.length===8, got.length);
  // The old list was the prose from the OAS memo quoted in the tracker's
  // introduction, not the form's option labels.
  ok('no memo prose left', !got.some(v=>/Sensitive Compartmented/.test(v)), got);
  ok('Other offered', got.indexOf('Other')>-1);
}

console.log('3. Primary justification exists and matches the tracker');
{
  const i=page.indexOf('id="primaryJustification"');
  ok('single-select present', i>-1);
  const block=page.slice(i, page.indexOf('</select>',i));
  const opts=[...block.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);
  opts.forEach(v=>ok('tracker recognises "'+v.slice(0,38)+'"', TRACKER_PRIMARY.indexOf(v)>-1, v));
  ok('all 11 present', opts.length===11, opts.length);
  // En-dashes, not hyphens: the form uses U+2013.
  ok('en-dash preserved', opts.some(v=>v.indexOf('\u2013')>-1), opts[0]);
}

console.log('4. all 13 tracker purposes derive from data the form already has');
{
  const src=fs.readFileSync('lets_app/client/controllers/form/travelRequestState.html','utf8');
  const js=/<script[^>]*>([\s\S]*)<\/script>/.exec(src)[1];
  function state(formData){
    const sb={console,JSON,Object,Array,String,Number,parseFloat,parseInt,isNaN,Math,Date,
      document:{getElementById:()=>null}};
    sb.window=sb;
    const ctx=vm.createContext(sb);
    vm.runInContext('var TravelUtils={TRAVEL_CONFIG:{MILEAGE_RATES:{PRIVATE:0.70,GOVERNMENT:0.22},OTHER_COST_PERCENTAGE_FALLBACK:30},isOCONUS:function(s){return ["HI","AK","PR","GU","VI","AS","MP"].indexOf(String(s||"").toUpperCase())>-1;}};window.TravelUtils=TravelUtils;',ctx);
    vm.runInContext('window.TravelRequest={getOtherCostPercentage:()=>30};',ctx);
    vm.runInContext(js,ctx);
    const S=vm.runInContext('window.TravelRequest.State',ctx);
    const base={legs:[],travelers:[],
      sharedCosts:{facilities:{amount:0},audioVisual:{amount:0},logistics:{amount:0},other:{amount:0}}};
    Object.assign(S._formData, base, formData);
    return S;
  }

  // Nine 1:1 mappings from the Step 1 delegation code.
  const DIRECT={
    COMPLIANCE_SITE_VISIT:'Site Visits, Inspections, Acceptance, Delivery',
    CUSTOMER_ENGAGEMENT:'Customer Meeting',
    VENDOR_ENGAGEMENT:'Vendor or Industry Meeting',
    SPEAKING_ROLE:'Speaking Engagement',
    GSA_SPONSORED:'GSA Sponsored Conference',
    NON_GSA_CONFERENCE:'Non-GSA Sponsored Conference',
    FOREIGN_TRAVEL:'International',
    TRAINING_UNDER_7K:'Training (GSA provided or third party under $7000)',
    TRAINING_OVER_7K:'Training (third party >= $7000 and CSA required)'};
  Object.keys(DIRECT).forEach(code=>{
    const got=state({travelPurpose:code}).getTrackerPurposes();
    ok(code+' -> '+DIRECT[code].slice(0,30), got.indexOf(DIRECT[code])>-1, got);
    ok(code+' is recognised by the tracker', TRACKER_PURPOSES.indexOf(DIRECT[code])>-1);
  });

  // IMM split by the COMPUTED total, not the submitter's Step 1 guess.
  const under=state({travelPurpose:'IMM_UNDER_10K',travelers:[{subtotal:4000}]});
  ok('IMM under 10k', under.getTrackerPurposes().some(v=>/under \$10,000/.test(v)), under.getTrackerPurposes());
  const over=state({travelPurpose:'IMM_UNDER_10K',travelers:[{subtotal:12000}]});
  ok('computed total overrides the Step 1 threshold choice',
     over.getTrackerPurposes().some(v=>/>= \$10,000/.test(v)), over.getTrackerPurposes());

  // Computed itinerary and duty-station flags, additive to the purpose.
  const intl=state({travelPurpose:'CUSTOMER_ENGAGEMENT',
    legs:[{city:'LONDON',country:'United Kingdom',isInternational:true}]});
  ok('international leg adds International', intl.getTrackerPurposes().indexOf('International')>-1, intl.getTrackerPurposes());
  ok('and keeps the mapped purpose', intl.getTrackerPurposes().indexOf('Customer Meeting')>-1);

  const local=state({travelPurpose:'CUSTOMER_ENGAGEMENT',
    travelers:[{subtotal:100,legCosts:{L1:{isLocalTravel:true}}}]});
  ok('local travel flag adds Local Travel', local.getTrackerPurposes().indexOf('Local Travel')>-1, local.getTrackerPurposes());

  const oconus=state({travelPurpose:'CUSTOMER_ENGAGEMENT',
    travelers:[{subtotal:100,dutyStationState:'HI'}]});
  // The tracker's option is travel BY an OCONUS-based employee, not travel TO
  // an OCONUS place — so this reads duty stations, not destinations.
  ok('OCONUS duty station adds Oversees Employee',
     oconus.getTrackerPurposes().indexOf('Oversees Employee (within OCONUS)')>-1, oconus.getTrackerPurposes());
  const conus=state({travelPurpose:'CUSTOMER_ENGAGEMENT',
    travelers:[{subtotal:100,dutyStationState:'DC'}]});
  ok('CONUS duty station does not', conus.getTrackerPurposes().indexOf('Oversees Employee (within OCONUS)')===-1);

  // Three Step 1 codes have no tracker equivalent, by decision: only data the
  // tracker asks for goes to the tracker.
  ['HAE_PARTICIPATION','NON_FED_FUNDED','CLIENT_PAID'].forEach(code=>{
    ok(code+' sends no purpose', state({travelPurpose:code}).getTrackerPurposes().length===0,
       state({travelPurpose:code}).getTrackerPurposes());
  });
  ok('no purpose at all with nothing selected', state({}).getTrackerPurposes().length===0);

  // Every derived value must be explainable, since nobody chose it.
  const expl=over.getTrackerPurposeExplanations();
  ok('explanations provided', expl.length>0, expl);
  ok('each has a value and a reason', expl.every(e=>e.value&&e.reason), expl);
  ok('IMM reason cites the total', expl.some(e=>/trip total/.test(e.reason)), expl);
  ok('derived values never exceed the tracker list',
     over.getTrackerPurposes().every(v=>TRACKER_PURPOSES.indexOf(v)>-1), over.getTrackerPurposes());
}

console.log('5. "Other" carries its free text to the tracker');
{
  const src=fs.readFileSync('lets_app/client/controllers/form/travelRequestState.html','utf8');
  const js=/<script[^>]*>([\s\S]*)<\/script>/.exec(src)[1];
  const sb={console,JSON,Object,Array,String,Number,parseFloat,parseInt,isNaN,Math,Date};
  sb.window=sb;
  const ctx=vm.createContext(sb);
  vm.runInContext('var TravelUtils={TRAVEL_CONFIG:{MILEAGE_RATES:{PRIVATE:0.70,GOVERNMENT:0.22},OTHER_COST_PERCENTAGE_FALLBACK:30}};window.TravelUtils=TravelUtils;',ctx);
  vm.runInContext('window.TravelRequest={getOtherCostPercentage:()=>30};',ctx);
  vm.runInContext(js,ctx);
  const S=vm.runInContext('window.TravelRequest.State',ctx);
  S._formData.missionCriticalTypes=['Retail Operations Oversight','Other'];
  S._formData.missionCriticalOther='Emergency facility closure';
  ok('appends to the Other entry',
     S.getMissionCriticalForTracker().indexOf('Other: Emergency facility closure')>-1,
     S.getMissionCriticalForTracker());
  // The option VALUE must stay what the Google Form matches, so the suffix is
  // applied at the boundary rather than stored on the checkbox.
  ok('other selections untouched',
     S.getMissionCriticalForTracker().indexOf('Retail Operations Oversight')>-1);
  S._formData.missionCriticalOther='';
  ok('bare Other left alone when no text',
     S.getMissionCriticalForTracker().indexOf('Other')>-1,
     S.getMissionCriticalForTracker());
  S._formData.primaryJustification='Other';
  S._formData.primaryJustificationOther='Statutory deadline';
  ok('primary justification appends too',
     S.getPrimaryJustificationForTracker()==='Other: Statutory deadline',
     S.getPrimaryJustificationForTracker());
  S._formData.primaryJustification='Contract / Task Order Execution';
  ok('non-Other passes through unchanged',
     S.getPrimaryJustificationForTracker()==='Contract / Task Order Execution');
}

console.log('6. getFormData resolves tracker values but preserves raw selections');
{
  const src=fs.readFileSync('lets_app/client/controllers/form/travelRequestState.html','utf8');
  const js=/<script[^>]*>([\s\S]*)<\/script>/.exec(src)[1];
  const sb={console,JSON,Object,Array,String,Number,parseFloat,parseInt,isNaN,Math,Date};
  sb.window=sb;
  const ctx=vm.createContext(sb);
  vm.runInContext('var TravelUtils={TRAVEL_CONFIG:{MILEAGE_RATES:{PRIVATE:0.70,GOVERNMENT:0.22},OTHER_COST_PERCENTAGE_FALLBACK:30}};window.TravelUtils=TravelUtils;',ctx);
  vm.runInContext('window.TravelRequest={getOtherCostPercentage:()=>30};',ctx);
  vm.runInContext(js,ctx);
  const S=vm.runInContext('window.TravelRequest.State',ctx);
  S._formData.travelPurpose='IMM_OVER_10K';
  S._formData.travelers=[{subtotal:15000}];
  S._formData.legs=[];
  S._formData.missionCriticalTypes=['Other'];
  S._formData.missionCriticalOther='Site emergency';
  const d=S.getFormData();
  ok('travelTypes includes the derived option',
     d.travelTypes.some(v=>/Internal Mission/.test(v)), d.travelTypes);
  // travelTypes is now FULLY derived, so there is no raw selection to
  // preserve. The key remains only so a draft saved before the column was
  // removed still loads.
  ok('no raw travel-type selections to keep',
     Array.isArray(d.travelTypesSelected) && d.travelTypesSelected.length===0,
     d.travelTypesSelected);
  ok('mission critical carries Other text',
     d.missionCriticalTypes[0]==='Other: Site emergency', d.missionCriticalTypes);
  ok('raw mission critical preserved',
     d.missionCriticalTypesSelected[0]==='Other', d.missionCriticalTypesSelected);
}

console.log('7. validation requires what the user must still answer');
{
  const c=fs.readFileSync('lets_app/client/controllers/form/travelRequestController.html','utf8');
  ok('primary justification required', /primary justification for this travel/.test(c));
  ok('Other description required for mission critical', /describe the mission-critical basis/.test(c));
  ok('Other description required for primary', /describe the primary justification/.test(c));
  // Purpose of Travel is derived and three Step 1 codes map to nothing, so
  // blocking on an empty derived list would strand the submitter on a step
  // where the problem cannot be fixed.
  ok('does not block on derived purposes', !/at least one Type of Travel/.test(c));
  ok('derived panel is rendered', /_updateDerivedPurposeNote/.test(c));
  ok('primary justification is suggested from mission-critical',
     /_suggestPrimaryJustification/.test(c));
}

console.log('8. the primary-justification suggestion never overwrites a choice');
{
  const c=fs.readFileSync('lets_app/client/controllers/form/travelRequestController.html','utf8');
  const i=c.indexOf('_suggestPrimaryJustification(missionCriticalValues)');
  const body=c.slice(i, c.indexOf('\n    },', i));
  // Overwriting a deliberate choice because a checkbox changed would be worse
  // than not suggesting at all — the mapping is a heuristic and the tracker
  // lists do not correspond one-to-one.
  ok('returns early when already set', /if \(!select \|\| select\.value\) return;/.test(body), body.slice(0,200));
  // A typo in the map would otherwise silently blank the select.
  ok('verifies the option exists', /select\.value !== suggested/.test(body));
  // Suggestions must themselves be real tracker values.
  const suggested=[...body.matchAll(/:\s*\n?\s*'([^']{20,})'/g)].map(m=>m[1]);
  ok('found suggestions to check', suggested.length>=5, suggested.length);
  suggested.forEach(v=>ok('suggestion is a tracker value: '+v.slice(0,34),
    TRACKER_PRIMARY.indexOf(v)>-1, v));
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
