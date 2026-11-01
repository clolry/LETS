/**
 * Automated Verification Script for the FAS tracker test-submission harness.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * submitToFASTracker appends to a Google Sheet owned by the FAS front office
 * and shared across every FAS portfolio. @clolry confirmed
 * TEST_FAS_TRACKER_SPREADSHEET_ID points at a real copy, which makes an
 * end-to-end check possible — but only against the copy.
 *
 * Sections 5, 6 and 8 are the reason this suite exists. They assert the
 * harness REFUSES to write:
 *
 *   5 — in production, where the resolved target is the OFFICIAL sheet
 *   6 — when the header no longer matches FAS_TRACKER_COLUMNS, because
 *       appending a positionally-built row to a re-ordered sheet is the exact
 *       corruption this whole exercise exists to prevent
 *   8 — cleanup refuses in production too; LETS must never delete a row from
 *       a sheet the front office owns
 *
 * Section 7 covers the cleanup's matching strategy. It finds rows by the
 * FAS_TEST_ROW_MARKER in Event Name, not by row number: a row number goes
 * stale the moment anyone else appends, and deleting by stale index on a
 * shared sheet would remove someone's real request. The test plants a real
 * request alongside two diagnostic rows and asserts it survives, and that
 * deletion runs bottom-up.
 *
 * Section 3 covers a subtlety worth stating. The live header contains embedded
 * newlines and at least one trailing space. A transcription that normalizes to
 * the same thing must still be allowed to submit — _verifyTrackerHeader
 * compares normalized — but the difference is still REPORTED so the
 * transcription can be corrected rather than left quietly wrong.
 *
 * Section 9 asserts the write path stayed OUT of Diagnostics.js. That file is
 * run by hand against production and a CI guard enforces it never mutates;
 * these two functions live in 91_setup for exactly that reason.
 *
 * Run: node lets_app/test_fas_tracker_submit.js
 */

// Exercises the FAS test-submission harness against stubbed Apps Script
// services. The point is the REFUSALS: this file writes to a sheet.
const fs=require('fs'),vm=require('vm');
let fails=0;
const ok=(n,c,x)=>{if(c)console.log('  PASS',n);else{console.log('  FAIL',n,x===undefined?'':JSON.stringify(x).slice(0,200));fails++;}};

const LIVE_HEADER=['Timestamp','Portfolio','Email Address','Event Name','Start date of Travel/Event:',
'End date of Travel/Event:','Link to Salesforce Request. Leave blank if no Salesforce request has been submitted. ',
'Select Purpose of Travel (check all that apply)',
'Justification for Mission Critical Travel Exemption Request\n\nSelect the primary reason when multiple reasons apply.',
'Number of Travelers:','Estimated Expenses: \nInclude breakdown of lodging, transportation, M&IE, etc.',
'Has this exception been approved by the portfolio Assistant Commissioner or designated delegate?',
'Location traveling to:','Location traveling from:','Names of Travelers and Duty Location:',
'Does this request require international travel?','Is travel requested within the next 10 days?',
'Type of mission critical travel (Check all that apply)','Duty Station of Travelers','Column 13',
'Status:','Date Approved:','Approved By:','Notes:','Notified Portfolio?','Notified Individual Date:','Notified By:'];

function build(opts){
  opts=opts||{};
  const rows=(opts.rows||[]).map(r=>r.slice());
  const header=opts.header||LIVE_HEADER;
  const deleted=[];
  const sheet={
    getLastRow:()=>1+rows.length,
    getLastColumn:()=>header.length,
    getName:()=>'FAS Travel Exceptions',
    getParent:()=>({getName:()=>opts.isProduction?'OFFICIAL FAS Tracker':'TEST copy of FAS Tracker'}),
    getRange:(r,c,nr,nc)=>({getValues:()=>{
      const all=[header].concat(rows);
      return all.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc));
    }}),
    appendRow:row=>{rows.push(row.slice());},
    deleteRow:n=>{deleted.push(n); rows.splice(n-2,1);}
  };
  const sb={console:{log(){},warn(){},error(){}},JSON,Date,Object,String,Number,Array,Math,
    parseFloat,parseInt,isNaN,RegExp,Error,module:{exports:{}},
    // _getFASTrackerSheet logs ss.getName(), so the stub spreadsheet needs it.
    SpreadsheetApp:{openById:(id)=>{
      if(!id) throw new Error('no spreadsheet id');
      return {getName:()=>opts.isProduction?'OFFICIAL FAS Tracker':'TEST copy of FAS Tracker',
              getSheetByName:()=>sheet, getSheets:()=>[sheet]};
    },flush:()=>{}},
    Utilities:{formatDate:()=>'11/01/2026 09:00:00'},
    Session:{getActiveUser:()=>({getEmail:()=>'chris@gsa.gov'})}};
  const ctx=vm.createContext(sb);
  vm.runInContext('var FAS_TRACKER_TARGET='+JSON.stringify({
    environment:opts.isProduction?'production':'development',
    spreadsheetId:'FAKE_ID', propertyKey:opts.isProduction?'FAS_TRACKER_SPREADSHEET_ID':'TEST_FAS_TRACKER_SPREADSHEET_ID',
    isProduction:!!opts.isProduction, configured:true, reason:null})+';',ctx);
  vm.runInContext('var LETS_IS_PRODUCTION='+(!!opts.isProduction)+';',ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/30_services/FASTrackerSync.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync('lets_app/server/91_setup/FASTrackerTest.js','utf8'),ctx);
  return {run:e=>vm.runInContext(e,ctx),rows,deleted,
    F:()=>vm.runInContext('FASTrackerSync',ctx)};
}

console.log('1. header comparison against a correct sheet');
{
  const h=build();
  const r=h.F().compareTrackerHeader();
  ok('success', r.success===true, r.message);
  ok('matches', r.matches===true, r.differences);
  // Byte-identical is the goal, since the list was transcribed by hand.
  ok('no differences at all', r.differences.length===0, r.differences);
  ok('counts agree', r.headerCount===27 && r.expectedCount===27);
}

console.log('2. a renamed column is reported, not silently tolerated');
{
  const bad=LIVE_HEADER.slice(); bad[3]='Event Title';
  const h=build({header:bad});
  const r=h.F().compareTrackerHeader();
  ok('mismatch detected', r.matches===false);
  ok('names the column letter', r.differences[0].column==='D', r.differences[0]);
  ok('reports both values', r.differences[0].expected==='Event Name' && r.differences[0].actual==='Event Title');
}

console.log('3. whitespace-only differences are flagged but not blocking');
{
  // The live header has embedded newlines and a trailing space. A
  // transcription that normalizes to the same thing must still SUBMIT, but
  // should be reported so it can be corrected.
  const ws=LIVE_HEADER.slice(); ws[8]=ws[8].replace(/\n\n/,' ');
  const h=build({header:ws});
  const r=h.F().compareTrackerHeader();
  ok('still allowed to submit', r.matches===true, r.differences);
  ok('difference reported', r.differences.some(d=>/whitespace/.test(d.issue)), r.differences);
}

console.log('4. the test row lands in the right columns');
{
  const h=build();
  const res=h.run('submitFASTrackerTestRow()');
  ok('succeeded', res.success===true, res.message);
  ok('one row appended', h.rows.length===1, h.rows.length);
  const row=h.rows[0];
  const at=n=>row[LIVE_HEADER.indexOf(n)];
  ok('row is full width', row.length===27, row.length);
  ok('Timestamp in A', !!at('Timestamp'));
  ok('Portfolio in B is the FC code', /^FC - Office of Acquisition/.test(at('Portfolio')), at('Portfolio'));
  // Self-identifying, so nobody actions it and the cleanup can find it.
  ok('Event Name carries the marker', /LETS DIAGNOSTIC/.test(at('Event Name')), at('Event Name'));
  ok('two travelers', at('Number of Travelers:')===2);
  ok('expense breakdown present', /TOTAL: \$3224\.00/.test(at('Estimated Expenses: \nInclude breakdown of lodging, transportation, M&IE, etc.')));
  ok('names paired with duty locations', /DIAGNOSTIC Traveler A \(WASHINGTON, DC\)/.test(at('Names of Travelers and Duty Location:')));
  ok('AC approval is No', at('Has this exception been approved by the portfolio Assistant Commissioner or designated delegate?')==='No');
  // Sample is 45 days out on purpose, so the computed answer is exercised.
  ok('not within 10 days', at('Is travel requested within the next 10 days?')==='No');
  // The front office owns these.
  ['Status:','Date Approved:','Approved By:','Notes:'].forEach(c=>{
    ok('blank: '+c, at(c)==='', at(c));
  });
}

console.log('5. REFUSES to write in production');
{
  const h=build({isProduction:true});
  const res=h.run('submitFASTrackerTestRow()');
  ok('refused', res.success===false, res);
  ok('says why', /production/i.test(res.message), res.message);
  // The whole reason this file is separate from Diagnostics.js.
  ok('nothing written', h.rows.length===0, h.rows.length);
}

console.log('6. REFUSES to write when the header has moved');
{
  const bad=LIVE_HEADER.slice(); bad[3]='Event Title';
  const h=build({header:bad});
  const res=h.run('submitFASTrackerTestRow()');
  ok('refused', res.success===false, res);
  ok('points at the diff tool', /diagFasTrackerHeader/.test(res.message), res.message);
  ok('nothing written', h.rows.length===0);
}

console.log('7. cleanup matches on the marker, not a row number');
{
  const h=build();
  h.run('submitFASTrackerTestRow()');
  h.run('submitFASTrackerTestRow()');
  ok('two diagnostic rows', h.rows.length===2);
  // A real request must survive. Deleting by stale row number on a shared
  // sheet would remove someone else's row.
  const real=new Array(27).fill('');
  real[LIVE_HEADER.indexOf('Event Name')]='Real conference request';
  h.rows.push(real);
  const res=h.run('deleteFASTrackerTestRows()');
  ok('deleted exactly 2', res.deleted===2, res);
  ok('real request survived', h.rows.length===1 && /Real conference/.test(h.rows[0][LIVE_HEADER.indexOf('Event Name')]), h.rows.length);
  // Deleting top-down would shift rows and remove the wrong ones.
  ok('deleted bottom-up', h.deleted.length===2 && h.deleted[0]>h.deleted[1], h.deleted);
}

console.log('8. cleanup also refuses in production');
{
  const h=build({isProduction:true, rows:[(()=>{const r=new Array(27).fill('');r[3]='LETS DIAGNOSTIC — DO NOT ACTION x';return r;})()]});
  const res=h.run('deleteFASTrackerTestRows()');
  ok('refused', res.success===false, res);
  ok('nothing deleted', h.deleted.length===0);
  ok('row still there', h.rows.length===1);
}

console.log('9. the write path is not in Diagnostics.js');
{
  // Diagnostics.js is run by hand against production and a CI guard enforces
  // that it never mutates. These two functions belong in 91_setup for exactly
  // that reason.
  const d=fs.readFileSync('lets_app/server/99_triggers/Diagnostics.js','utf8');
  ok('no submitFASTrackerTestRow in Diagnostics', d.indexOf('function submitFASTrackerTestRow')===-1);
  ok('no deleteFASTrackerTestRows in Diagnostics', d.indexOf('function deleteFASTrackerTestRows')===-1);
  ok('Diagnostics has the read-only header diff', d.indexOf('function diagFasTrackerHeader')>-1);
  const t=fs.readFileSync('lets_app/server/91_setup/FASTrackerTest.js','utf8');
  ok('write path lives in 91_setup', t.indexOf('function submitFASTrackerTestRow')>-1);
}
console.log(fails?('\n'+fails+' FAILURE(S)'):'\nALL ASSERTIONS PASSED!');
process.exit(fails?1:0);
