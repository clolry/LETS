/**
 * Automated Verification Script for the FAS Travel Exception Tracker mapping.
 *
 * WHY THIS IS THE MOST IMPORTANT SUITE IN THE REPO
 * ------------------------------------------------
 * submitToFASTracker does a bare appendRow against a LIVE Google Sheet that
 * the FAS front office owns and every FAS portfolio shares. A misaligned row
 * is an uncorrectable write to another organization's system of record.
 *
 * The previous implementation wrote 14 values in an order matching nothing.
 * Its own comments claimed "Col A: LETS Request ID", "Col D: Portfolio" — the
 * real columns are Timestamp and Event Name. Thirteen columns were never
 * written, including three REQUIRED fields it had no way to supply. It also
 * wrote 'Pending FAS CoS Approval' into whatever index 12 happened to be,
 * which is the front office's own decision column.
 *
 * Nothing called it, so nothing broke. Section 1 pins the column list
 * character-for-character against the live header transcribed on 2026-10-31,
 * and section 4 asserts LETS writes blanks into every front-office column.
 *
 * Section 3 covers the three fields that made the old row unsubmittable: the
 * traveler/duty-location pairing, the expense BREAKDOWN the tracker explicitly
 * asks for, and the AC-approval answer. Section 8 asserts a zero-cost request
 * produces an empty expense field rather than "$0.00" — writing a meaningless
 * figure into a required field on a shared sheet is worse than refusing.
 *
 * Section 2 pins Portfolio to the FC portfolio code. FCA/FCB/FCC are DIVISIONS
 * within FC; they drive internal DAC routing and budget attribution and are
 * not in the tracker's own option list, so sending one would put an invalid
 * value into a shared sheet.
 *
 * Run: node lets_app/test_fas_tracker_mapping.js
 */

const fs=require('fs'),vm=require('vm');
function load(){
  const ctx=vm.createContext({console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,
    parseFloat,parseInt,isNaN,RegExp,Error,module:{exports:{}},
    Utilities:{formatDate:()=>'11/01/2026 09:00:00'},
    Session:{getActiveUser:()=>({getEmail:()=>'chris@gsa.gov'})}});
  vm.runInContext('var FAS_TRACKER_TARGET={environment:"development",spreadsheetId:null,isProduction:false,configured:false};',ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/30_services/FASTrackerSync.js','utf8'),ctx);
  return vm.runInContext('FASTrackerSync',ctx);
}
const F=load();
// Transcribed from the live tracker on 2026-10-31.
const LIVE=['Timestamp','Portfolio','Email Address','Event Name','Start date of Travel/Event:',
'End date of Travel/Event:','Link to Salesforce Request. Leave blank if no Salesforce request has been submitted. ',
'Select Purpose of Travel (check all that apply)',
'Justification for Mission Critical Travel Exemption Request\n\nSelect the primary reason when multiple reasons apply.',
'Number of Travelers:','Estimated Expenses: \nInclude breakdown of lodging, transportation, M&IE, etc.',
'Has this exception been approved by the portfolio Assistant Commissioner or designated delegate?',
'Location traveling to:','Location traveling from:','Names of Travelers and Duty Location:',
'Does this request require international travel?','Is travel requested within the next 10 days?',
'Type of mission critical travel (Check all that apply)','Duty Station of Travelers','Column 13',
'Status:','Date Approved:','Approved By:','Notes:','Notified Portfolio?','Notified Individual Date:','Notified By:'];

let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x).slice(0,220));fails++;}};
const norm=h=>String(h||'').replace(/\s+/g,' ').trim().toLowerCase();

function fullRequest(over){
  return Object.assign({
    requestId:'LETS-0001', eventName:'OASIS+ Industry Day',
    startDate:'2027-03-15', endDate:'2027-03-17',
    submitterEmail:'chris@gsa.gov', salesforceLink:'https://sf/123',
    travelTypes:['Customer Meeting','Site Visits, Inspections, Acceptance, Delivery'],
    missionCriticalTypes:['Inspection/Acceptance (e.g., vehicles, manufacturing)',
                          'Industry/Customer Engagement Supporting Acquisition'],
    primaryJustification:'Site inspection, compliance check, requirements validation',
    isInternational:false, isOCONUS:false, sharedTotal:500, grandTotal:3224,
    legs:[{city:'CHICAGO',state:'IL',country:'United States'}],
    travelers:[
      {employeeName:'Alasdair Benavides',dutyStationCity:'WASHINGTON',dutyStationState:'DC',
       transportationTotal:224,lodgingTotal:900,mieTotal:300,localTravelTotal:0,otherTotal:430},
      {employeeName:'Rutger Vandersloot',dutyStationCity:'PHILADELPHIA',dutyStationState:'PA',
       transportationTotal:180,lodgingTotal:600,mieTotal:200,localTravelTotal:0,otherTotal:290}
    ]
  }, over||{});
}

console.log('1. column list matches the live tracker exactly');
{
  ok('27 columns', F.FAS_TRACKER_COLUMNS.length===27, F.FAS_TRACKER_COLUMNS.length);
  ok('same length as live', F.FAS_TRACKER_COLUMNS.length===LIVE.length);
  let mismatch=null;
  for(let i=0;i<LIVE.length;i++){
    if(norm(F.FAS_TRACKER_COLUMNS[i])!==norm(LIVE[i])){mismatch={i,got:F.FAS_TRACKER_COLUMNS[i],want:LIVE[i]};break;}
  }
  ok('every column in order', mismatch===null, mismatch);
  // The old implementation claimed col A was Request ID and col D Portfolio.
  ok('col A is Timestamp, not Request ID', F.FAS_TRACKER_COLUMNS[0]==='Timestamp');
  ok('col D is Event Name, not Portfolio', F.FAS_TRACKER_COLUMNS[3]==='Event Name');
}

console.log('2. a complete request maps into the right cells');
{
  const row=F.buildFASTrackerRow(fullRequest());
  const at=name=>row[F.FAS_TRACKER_COLUMNS.indexOf(name)];
  ok('row width matches the sheet', row.length===27, row.length);
  ok('Timestamp set', !!at('Timestamp'));
  // Portfolio-level, not FCA/FCB/FCC — those are divisions within FC and are
  // not in the tracker's own option list.
  ok('Portfolio is the FC portfolio code', at('Portfolio')===F.FAS_PORTFOLIO_CODE, at('Portfolio'));
  ok('Portfolio is not a division code', !/FCA|FCB|FCC/.test(at('Portfolio')));
  ok('Event Name in column D', at('Event Name')==='OASIS+ Industry Day');
  ok('Email Address set', at('Email Address')==='chris@gsa.gov');
  ok('start date', at('Start date of Travel/Event:')==='2027-03-15');
  ok('salesforce link', at('Link to Salesforce Request. Leave blank if no Salesforce request has been submitted. ')==='https://sf/123');
  ok('traveler count', at('Number of Travelers:')===2, at('Number of Travelers:'));
  ok('destination from legs', at('Location traveling to:')==='CHICAGO, IL', at('Location traveling to:'));
  ok('origins from duty stations', at('Location traveling from:').indexOf('WASHINGTON, DC')>-1, at('Location traveling from:'));
  ok('international = No', at('Does this request require international travel?')==='No');
}

console.log('3. the three fields the old code could not supply');
{
  const row=F.buildFASTrackerRow(fullRequest());
  const at=name=>row[F.FAS_TRACKER_COLUMNS.indexOf(name)];
  const names=at('Names of Travelers and Duty Location:');
  ok('names paired with duty locations', /Alasdair Benavides \(WASHINGTON, DC\)/.test(names), names);
  ok('all travelers listed', names.split('\n').length===2, names);
  const exp=at('Estimated Expenses: \nInclude breakdown of lodging, transportation, M&IE, etc.');
  // The tracker asks for a BREAKDOWN; a bare total is a non-answer.
  ok('expenses broken down', /Transportation: \$404\.00/.test(exp), exp);
  ok('lodging line', /Lodging: \$1500\.00/.test(exp));
  ok('shared costs included', /Shared event costs: \$500\.00/.test(exp));
  ok('total line', /TOTAL: \$3224\.00/.test(exp), exp);
  // Defaults to No: claiming an approval that has not happened is the worse error.
  ok('AC approval defaults to No', at('Has this exception been approved by the portfolio Assistant Commissioner or designated delegate?')==='No');
  const approved=F.buildFASTrackerRow(fullRequest({acApproved:true}));
  ok('AC approval reflects state', approved[F.FAS_TRACKER_COLUMNS.indexOf('Has this exception been approved by the portfolio Assistant Commissioner or designated delegate?')]==='Yes');
}

console.log('4. front-office columns are never written');
{
  const row=F.buildFASTrackerRow(fullRequest({acApproved:true}));
  F.FAS_TRACKER_READONLY_COLUMNS.forEach(c=>{
    const i=F.FAS_TRACKER_COLUMNS.indexOf(c);
    ok('blank: '+c, row[i]==='', row[i]);
  });
  // The old code wrote 'Pending FAS CoS Approval' into whatever index 12 was.
  ok('no status asserted anywhere', row.every(v=>!/Pending FAS/.test(String(v))));
}

console.log('5. multi-selects are newline-joined, not comma-joined');
{
  const row=F.buildFASTrackerRow(fullRequest());
  const mc=row[F.FAS_TRACKER_COLUMNS.indexOf('Type of mission critical travel (Check all that apply)')];
  // Several option labels contain commas, so a comma-joined cell could not be
  // split back apart by a human reading it.
  ok('newline separated', mc.indexOf('\n')>-1, mc);
  ok('both selections present', mc.split('\n').length===2, mc);
  // Submission.js stores these as JSON strings, so that form must work too.
  const fromJson=F.buildFASTrackerRow(fullRequest({missionCriticalTypes:'["SCIF or Secure Facility Activities"]'}));
  ok('JSON string input parsed',
     fromJson[F.FAS_TRACKER_COLUMNS.indexOf('Type of mission critical travel (Check all that apply)')]==='SCIF or Secure Facility Activities');
}

console.log('6. ten-day lead time is computed, not asked');
{
  const soon=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  const far=new Date(Date.now()+60*86400000).toISOString().slice(0,10);
  const a=F.buildFASTrackerRow(fullRequest({startDate:soon}));
  const b=F.buildFASTrackerRow(fullRequest({startDate:far}));
  const i=F.FAS_TRACKER_COLUMNS.indexOf('Is travel requested within the next 10 days?');
  ok('3 days out -> Yes', a[i]==='Yes', a[i]);
  ok('60 days out -> No', b[i]==='No', b[i]);
}

console.log('7. incomplete requests are refused, with reasons');
{
  ok('complete request validates', F.validateForFASTracker(fullRequest()).valid===true,
     F.validateForFASTracker(fullRequest()).missing);
  const noJust=F.validateForFASTracker(fullRequest({primaryJustification:''}));
  ok('missing primary justification caught',
     !noJust.valid && noJust.missing.some(m=>/primary reason/.test(m)), noJust.missing);
  const noMc=F.validateForFASTracker(fullRequest({missionCriticalTypes:[]}));
  ok('missing mission-critical type caught', !noMc.valid && noMc.missing.some(m=>/mission critical/.test(m)), noMc.missing);
  const noDuty=F.validateForFASTracker(fullRequest({travelers:[{employeeName:'X'}]}));
  ok('missing duty location caught', !noDuty.valid && noDuty.missing.some(m=>/duty location/.test(m)), noDuty.missing);
  const noCost=F.validateForFASTracker(fullRequest({travelers:[{employeeName:'X',dutyLocation:'DC'}],sharedTotal:0,grandTotal:0}));
  ok('missing expenses caught', !noCost.valid && noCost.missing.some(m=>/Expenses/.test(m)), noCost.missing);
  const empty=F.validateForFASTracker({});
  ok('empty request is invalid', empty.valid===false);
  ok('null request does not throw', F.validateForFASTracker(null).valid===false);
}

console.log('8. a zero-cost request produces no expense figure');
{
  // Writing "$0.00" into a required field on a shared sheet would be worse
  // than refusing to submit.
  const r=fullRequest({travelers:[{employeeName:'X',dutyLocation:'DC'}],sharedTotal:0,grandTotal:0});
  const row=F.buildFASTrackerRow(r);
  const exp=row[F.FAS_TRACKER_COLUMNS.indexOf('Estimated Expenses: \nInclude breakdown of lodging, transportation, M&IE, etc.')];
  ok('expenses blank, not $0.00', exp==='', exp);
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
