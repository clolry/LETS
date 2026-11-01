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

console.log('1. Type of Travel options are the tracker\'s, verbatim');
{
  const got=valuesIn('travelTypesContainer');
  got.forEach(v=>ok('tracker recognises "'+v.slice(0,40)+'"', TRACKER_PURPOSES.indexOf(v)>-1, v));
  // The two cost-split options are DERIVED, not asked: LETS knows the total,
  // and asking a submitter to classify against a threshold they have not been
  // shown invites the wrong answer.
  ok('IMM options are not checkboxes',
     !got.some(v=>/Internal Mission Meeting/.test(v)), got.filter(v=>/Internal/.test(v)));
  ok('11 of the 13 offered', got.length===11, got.length);
  // Inherited TRIP values the tracker does not have.
  ok('no "Internal Travel"', got.indexOf('Internal Travel')===-1);
  ok('no "Vendor Meeting"', got.indexOf('Vendor Meeting')===-1);
  ok('no CONUS/OCONUS phrasing', !got.some(v=>/CONUS and OCONUS/.test(v)));
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

console.log('4. derived IMM option follows the computed total');
{
  const src=fs.readFileSync('lets_app/client/controllers/form/travelRequestState.html','utf8');
  const js=/<script[^>]*>([\s\S]*)<\/script>/.exec(src)[1];
  function state(formData){
    const sb={console,JSON,Object,Array,String,Number,parseFloat,parseInt,isNaN,Math,Date};
    sb.window=sb;
    const ctx=vm.createContext(sb);
    // travelRequestState reads TravelUtils at load time for mileage rates.
    vm.runInContext('var TravelUtils={TRAVEL_CONFIG:{MILEAGE_RATES:{PRIVATE:0.70,GOVERNMENT:0.22},OTHER_COST_PERCENTAGE_FALLBACK:30}};window.TravelUtils=TravelUtils;',ctx);
    vm.runInContext('window.TravelRequest={getOtherCostPercentage:()=>30};',ctx);
    vm.runInContext(js,ctx);
    const S=vm.runInContext('window.TravelRequest.State',ctx);
    Object.assign(S._formData, formData);
    return S;
  }
  const under=state({travelPurpose:'IMM_UNDER_10K',travelTypes:['Customer Meeting'],
    travelers:[{subtotal:4000}],sharedCosts:{facilities:{amount:0},audioVisual:{amount:0},logistics:{amount:0},other:{amount:0}}});
  ok('under 10k picks the under option',
     under.getTrackerPurposes().some(v=>/under \$10,000/.test(v)), under.getTrackerPurposes());
  const over=state({travelPurpose:'IMM_UNDER_10K',travelTypes:['Customer Meeting'],
    travelers:[{subtotal:12000}],sharedCosts:{facilities:{amount:0},audioVisual:{amount:0},logistics:{amount:0},other:{amount:0}}});
  // The submitter's own Step 1 threshold choice is NOT trusted: costs can
  // change after Step 1 is filled in, and the computed total is authoritative.
  ok('computed total overrides the Step 1 choice',
     over.getTrackerPurposes().some(v=>/>= \$10,000/.test(v)), over.getTrackerPurposes());
  const none=state({travelPurpose:'CUSTOMER_ENGAGEMENT',travelTypes:['Customer Meeting'],
    travelers:[{subtotal:12000}],sharedCosts:{facilities:{amount:0},audioVisual:{amount:0},logistics:{amount:0},other:{amount:0}}});
  ok('no IMM option when not an internal meeting',
     !none.getTrackerPurposes().some(v=>/Internal Mission/.test(v)), none.getTrackerPurposes());
  ok('derived value is reportable to the user',
     over.getDerivedTrackerPurpose().indexOf('Internal Mission')>-1, over.getDerivedTrackerPurpose());
  ok('nothing derived reports empty', none.getDerivedTrackerPurpose()==='');
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
  S._formData.travelTypes=['Customer Meeting'];
  S._formData.travelers=[{subtotal:15000}];
  S._formData.missionCriticalTypes=['Other'];
  S._formData.missionCriticalOther='Site emergency';
  const d=S.getFormData();
  ok('travelTypes includes the derived option',
     d.travelTypes.some(v=>/Internal Mission/.test(v)), d.travelTypes);
  // Restoring a draft from the tracker-facing list would turn a computed value
  // into a ticked checkbox the user never chose.
  ok('raw selections preserved separately',
     d.travelTypesSelected.length===1 && d.travelTypesSelected[0]==='Customer Meeting',
     d.travelTypesSelected);
  ok('mission critical carries Other text',
     d.missionCriticalTypes[0]==='Other: Site emergency', d.missionCriticalTypes);
  ok('raw mission critical preserved',
     d.missionCriticalTypesSelected[0]==='Other', d.missionCriticalTypesSelected);
}

console.log('7. validation requires the new fields');
{
  const c=fs.readFileSync('lets_app/client/controllers/form/travelRequestController.html','utf8');
  ok('primary justification required', /primary justification for this travel/.test(c));
  ok('Other description required for mission critical', /describe the mission-critical basis/.test(c));
  ok('Other description required for primary', /describe the primary justification/.test(c));
  // A derived IMM option can satisfy the tracker with no checkbox ticked.
  ok('derived purposes count toward the type requirement',
     /getTrackerPurposes\(\)\.length === 0/.test(c), 'validation does not consider derived');
  ok('derived note is shown to the user', /_updateDerivedPurposeNote/.test(c));
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
