/**
 * Automated Verification Script for the feedback pipeline
 * (30_services/Feedback.js + client/shared/travelFeedbackModal.html).
 *
 * WHY THIS EXISTS
 * ---------------
 * @clolry asked a simple question while testing: "if I press the 'Report a
 * Bug' or 'Request a Feature' button - where does it go?"
 *
 * It went nowhere. 'Feedback' was declared in SHEET_NAMES but had NO SCHEMA,
 * so setupTravelDatabase never created the tab. submitTravelFeedback returned
 * errorResponse('Feedback sheet not found'), and the modal's only callback was
 * onSuccess — withFailureHandler called it too, "Don't block UX on failure".
 * So every bug report was discarded and the user was shown a thank-you screen.
 *
 * Two independent faults, both silent. This suite covers both.
 *
 * Run: node lets_app/test_feedback.js
 */

const fs = require('fs');
const vm = require('vm');
let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : String(x).slice(0, 200)); fails++; }
};

function schemas() {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync('lets_app/server/01_constants/Sheets.js', 'utf8'), ctx);
  return {
    names: vm.runInContext('SHEET_NAMES', ctx),
    schemas: vm.runInContext('TRAVEL_SHEET_SCHEMAS', ctx)
  };
}

console.log('1. the Feedback tab has a schema, so setup creates it');
{
  const { names, schemas: S } = schemas();
  ok('SHEET_NAMES.FEEDBACK is declared', names.FEEDBACK === 'Feedback', names.FEEDBACK);
  ok('and it HAS a schema', Array.isArray(S[names.FEEDBACK]),
     'without one, setupTravelDatabase skips it and every write fails');

  // Every declared tab needs a creator. These five are read-only external
  // caches created by their own sync jobs, not by setupTravelDatabase.
  const EXTERNAL = ['File_Queue', 'DoD_Per_Diem', 'DoD_Sync_Log',
                    'Foreign_Per_Diem', 'DOS_Sync_Tracker'];
  const orphans = Object.values(names).filter(n => !S[n] && EXTERNAL.indexOf(n) === -1);
  ok('no other tab is declared without a schema or a known creator',
     orphans.length === 0, orphans);
}

console.log('2. the schema matches the row the server writes');
{
  const { schemas: S } = schemas();
  const src = fs.readFileSync('lets_app/server/30_services/Feedback.js', 'utf8');

  // Writes are POSITIONAL (docs/DATA_DICTIONARY.md §3.9). A schema one column
  // short shifts every later value into the wrong column.
  const i = src.indexOf('var row = [');
  const j = src.indexOf('];', i);
  const block = src.slice(i + 'var row = ['.length, j);
  const stripped = block.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  let depth = 0, count = 1;
  for (const ch of stripped) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  ok('row width equals schema width', count === S.Feedback.length,
     'row=' + count + ' schema=' + S.Feedback.length);

  // Spot-check the ends, where a drift would be least visible.
  ok('first column is Feedback_ID', S.Feedback[0] === 'Feedback_ID');
  ok('last column is Page_URL', S.Feedback[S.Feedback.length - 1] === 'Page_URL');
  ok('NPS_Score is present', S.Feedback.indexOf('NPS_Score') > -1);

  // THE HIGHEST-VALUE ASSERTION HERE.
  //
  // Two readers resolve columns BY HEADER NAME while the writer is positional.
  // A name the reader does not recognise does not throw — checkNpsEligibility
  // returns eligible:true for everyone, so the NPS prompt reappears forever,
  // and getRecentFeedback shows blanks in the admin view.
  //
  // This caught a live mistake: the schema was first written with 'Type',
  // but the reader looks up 'Feedback_Type'.
  const looked = [];
  const re = /headers\.indexOf\('([^']+)'\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (looked.indexOf(m[1]) === -1) looked.push(m[1]);
  }
  ok('the readers look up at least 3 columns by name', looked.length >= 3, looked);
  const missing = looked.filter(h => S.Feedback.indexOf(h) === -1);
  ok('every header the readers look up exists in the schema',
     missing.length === 0, 'schema is missing: ' + missing.join(', '));

  // dismissNpsPrompt writes its own positional row. Same width or it drifts.
  const k = src.indexOf('db.appendRow(SHEET_NAMES.FEEDBACK, [');
  const kEnd = src.indexOf(']);', k);
  const dBlock = src.slice(k, kEnd).split('\n')
    .map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const dCount = (dBlock.match(/,/g) || []).length;  // trailing comma per value
  ok('dismissNpsPrompt writes the same width', dCount === S.Feedback.length,
     'dismiss=' + dCount + ' schema=' + S.Feedback.length);
}

console.log('3. a FAILED report must not show the success screen');
{
  const src = fs.readFileSync('lets_app/client/shared/travelFeedbackModal.html', 'utf8');

  ok('_submitFeedback accepts an onError callback',
     /_submitFeedback: function\(data, onSuccess, onError\)/.test(src));

  // errorResponse() arrives on the SUCCESS channel — it is a returned value,
  // not a thrown error. Checking only withFailureHandler misses
  // 'Feedback sheet not found' entirely, which is exactly what happened.
  ok('a handled server rejection is detected', /result\.success === false/.test(src),
     'errorResponse arrives via withSuccessHandler');

  ok('submitReport passes an error handler',
     /contextAction: 'help_menu'\s*\}, function\(\) \{[\s\S]*?\}, function\(msg\) \{/.test(src));
  ok('the modal has an error element', /id="tfReportError"/.test(src));
  ok('and clears it when reopened',
     /errEl\.style\.display = 'none'/.test(src));

  // Thumbs and NPS legitimately stay silent — losing one is not worth
  // interrupting the user. The fallback must therefore remain.
  ok('thumbs/NPS still fail silently', /else if \(onSuccess\) onSuccess\(\)/.test(src));
}

console.log('4. negative control (the suite must be able to fail)');
{
  // Removing the Feedback schema must break section 1.
  const src = fs.readFileSync('lets_app/server/01_constants/Sheets.js', 'utf8');
  const broken = src.replace(/  Feedback: \[[\s\S]*?\],\n/, '');
  if (broken === src) {
    console.log('  FAIL negative control could not patch the schema out');
    fails++;
  } else {
    const ctx = vm.createContext({ console });
    vm.runInContext(broken, ctx);
    const S = vm.runInContext('TRAVEL_SHEET_SCHEMAS', ctx);
    ok('without the schema, section 1 fails', !Array.isArray(S.Feedback),
       'patch did not remove it, so section 1 is not live');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
