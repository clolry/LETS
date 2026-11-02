/**
 * Automated Verification Script for historical event attendance
 * (30_services/EventHistory.js).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * @clolry asked for "historical attendance at events (showing when they are
 * and how many people from which orgs have attended in the past)" so DACs can
 * plan a year's budget.
 *
 * Two things here are load-bearing and both fail SILENTLY.
 *
 * 1. THE TRANSCRIPTION. 187 attendees across 12 months in @clolry's table
 *    were typed into EVENT_HISTORY_SEED by hand. A fat-fingered digit is
 *    invisible — the dashboard renders a plausible number and a DAC reserves
 *    money against it. §1 re-derives every row and column total from the
 *    stated figures rather than trusting the transcription.
 *
 * 2. THE DIFFERENCE BETWEEN ZERO AND UNKNOWN. The seeded figures are totals
 *    with no org breakdown — that detail does not exist in the source. If the
 *    code reports {} instead of null, the UI shows "no attendees from FCB" for
 *    an event FCB has been sending people to for three years. §4 asserts the
 *    distinction end to end.
 *
 * Run: node lets_app/test_event_history.js
 */

const fs = require('fs');
const vm = require('vm');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 260)); fails++; }
};

/**
 * Loads EventHistory.js with a stubbed TravelDB.
 *
 * @param {Object} [requests] { headers, rows } for the Requests tab, or null
 *        to make TravelDB throw — which is the state of a database where no
 *        requests have been submitted yet, and the dashboard must still work.
 */
function load(requests) {
  const logs = [];
  const sb = {
    console: { log: m => logs.push(String(m)), warn: m => logs.push(String(m)),
               error: m => logs.push(String(m)) },
    JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
    parseInt, parseFloat, isNaN
  };
  const ctx = vm.createContext(sb);

  vm.runInContext(`
    function successResponse(d, m) { return { success: true, data: d, message: m || null }; }
    function errorResponse(m) { return { success: false, error: m }; }
    var SHEET_NAMES = { REQUESTS: 'Requests' };
  `, ctx);

  if (requests) {
    const headerIndex = {};
    requests.headers.forEach((h, i) => { headerIndex[h] = i; });
    vm.runInContext(
      'var __REQ = ' + JSON.stringify({
        headers: requests.headers, rows: requests.rows, headerIndex
      }) + ';\n' +
      'function TravelDB() { this.readSheet = function () { return __REQ; }; }', ctx);
  } else {
    vm.runInContext('function TravelDB() { throw new Error("Requests tab not found"); }', ctx);
  }

  vm.runInContext(fs.readFileSync('lets_app/server/30_services/EventHistory.js', 'utf8'), ctx);
  return { ctx, run: e => vm.runInContext(e, ctx), logs };
}

const E = load(null);
const EH = name => E.run('EventHistory.' + name);

console.log('--- Event history test suite ---\n');

// ---------------------------------------------------------------------------
console.log('1. the transcription of @clolry\'s table is exact');
{
  // 187 attendees, 12 months, 10 events, typed in by hand. A wrong digit is
  // invisible in the UI, so this re-derives every total from the stated
  // figures instead of trusting the comment next to the data.
  const seed = E.run('EVENT_HISTORY_SEED');
  const stated = E.run('EVENT_HISTORY_SEED_TOTALS');

  ok('all 10 events are present', seed.length === 10, seed.length);

  // Row totals. The source table states a per-event total; recomputing it
  // from the months catches a digit typed into the wrong month.
  const ROW_TOTALS = {
    'CGP Fall Conference': 20, 'Dreamforce': 6, 'ACT IAC Imagine Nation ELC': 33,
    'CGP Spring Conference': 24, 'NCMA World Congress': 48, 'BIG NTI': 20,
    'FEW NTP': 17, 'PA Womens': 10, 'ACT IAC Emerging Tech and Innovation': 0,
    'NVSBC VETS': 9
  };
  const rowDiffs = [];
  seed.forEach(ev => {
    const sum = ev.occurrences.reduce((s, o) => s + o.attendees, 0);
    if (!(ev.name in ROW_TOTALS)) { rowDiffs.push('unexpected event: ' + ev.name); return; }
    if (sum !== ROW_TOTALS[ev.name]) {
      rowDiffs.push(ev.name + ': got ' + sum + ', table says ' + ROW_TOTALS[ev.name]);
    }
  });
  ok('every event total matches the source table', rowDiffs.length === 0, rowDiffs);
  ok('and no event is missing',
     Object.keys(ROW_TOTALS).every(n => seed.some(e => e.name === n)),
     Object.keys(ROW_TOTALS).filter(n => !seed.some(e => e.name === n)));

  // Column totals. These are the independent check — a figure moved from one
  // month to another keeps the row total right and breaks the column.
  const byMonth = {};
  seed.forEach(ev => ev.occurrences.forEach(o => {
    byMonth[o.month] = (byMonth[o.month] || 0) + o.attendees;
  }));
  const colDiffs = [];
  Object.keys(stated.byMonth).forEach(m => {
    if ((byMonth[m] || 0) !== stated.byMonth[m]) {
      colDiffs.push(m + ': got ' + (byMonth[m] || 0) + ', table says ' + stated.byMonth[m]);
    }
  });
  Object.keys(byMonth).forEach(m => {
    if (!(m in stated.byMonth)) colDiffs.push('month not in the source table: ' + m);
  });
  ok('every month total matches the source table', colDiffs.length === 0, colDiffs);

  const grand = Object.keys(byMonth).reduce((s, m) => s + byMonth[m], 0);
  ok('grand total is 187', grand === stated.grandTotal, grand);

  // The event with no attendance is KEPT. Its presence is information: ASD
  // tracks it and did not go. Dropping it makes it indistinguishable from an
  // event nobody has heard of.
  const empty = seed.find(e => e.name === 'ACT IAC Emerging Tech and Innovation');
  ok('the tracked-but-unattended event is retained',
     !!empty && empty.occurrences.length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n2. fiscal years, because a DAC\'s money expires on 30 September');
{
  // Written fresh rather than reused: ReviewerDashboard's 'FY Quarter' labels
  // CALENDAR quarters (finding G-049), and budget planning is the one place
  // that error would actively mislead.
  const cases = [
    ['2024-10', 'FY2025'],  // October rolls over
    ['2024-09', 'FY2024'],  // September does not
    ['2024-11', 'FY2025'],
    ['2025-12', 'FY2026'],
    ['2026-01', 'FY2026'],
    ['2026-09', 'FY2026'],
    ['2024-05', 'FY2024']
  ];
  const diffs = cases.filter(([m, want]) => EH('fiscalYearOf(' + JSON.stringify(m) + ')') !== want)
    .map(([m, want]) => m + ': got ' + EH('fiscalYearOf(' + JSON.stringify(m) + ')') + ', want ' + want);
  ok('October through September', diffs.length === 0, diffs);

  ['', 'nonsense', '2024', '2024-13', '2024-00', null].forEach(bad => {
    ok('rejects ' + JSON.stringify(bad),
       EH('fiscalYearOf(' + JSON.stringify(bad) + ')') === '');
  });

  ok('month labels read naturally', EH("monthLabel('2024-11')") === 'Nov 2024');
  ok('and pass through what they cannot parse', EH("monthLabel('later')") === 'later');
}

// ---------------------------------------------------------------------------
console.log('\n3. recurrence is INFERRED, and refuses to over-claim');
{
  const infer = (occ, now) => E.run('EventHistory.inferRecurrence(' +
    JSON.stringify(occ) + ', new Date(' + JSON.stringify(now) + '))');

  // ONE OCCURRENCE IS NOT A PATTERN. The honest answer is "attended once".
  // Predicting next July from a single July would be the dashboard inventing
  // a schedule, and a DAC could reserve against it.
  const single = infer([{ month: '2024-08', attendees: 20 }], '2026-08-15');
  ok('a single occurrence claims no pattern', single.pattern === 'single');
  ok('and offers NO next date', single.nextExpected === null,
     'a prediction from one data point is invention');
  ok('and says so in words', /Not enough history/.test(single.note), single.note);

  // Same month twice: a real pattern, and a date worth planning against.
  const annual = infer([{ month: '2024-05', attendees: 20 },
                        { month: '2025-05', attendees: 18 }], '2026-01-10');
  ok('same month twice is annual', annual.pattern === 'annual');
  ok('with high confidence', annual.confidence === 'high');
  ok('and a next date in the future', annual.nextExpected === '2026-05',
     annual.nextExpected);

  // BIENNIAL. @clolry's NCMA World Congress: July 2024 and July 2026, same
  // month, 24 months apart. Labelling that 'irregular' while also reporting
  // high confidence in the month is self-contradictory, and a DAC reading
  // "irregular" would not reserve for it.
  const biennial = infer([{ month: '2024-07', attendees: 25 },
                          { month: '2026-07', attendees: 23 }], '2026-08-15');
  ok('a two-year cadence is labelled biennial', biennial.pattern === 'biennial',
     biennial.pattern);
  ok('the month is still high confidence', biennial.confidence === 'high');
  // Stepped by the observed cadence, not by a hardcoded year. Predicting 2027
  // would have money reserved for a conference that is not happening.
  ok('and the next date steps two years, not one',
     biennial.nextExpected === '2028-07', biennial.nextExpected);
  ok('the note states the cadence', /two years apart/.test(biennial.note), biennial.note);

  // DRIFT. @clolry's CGP Spring Conference: May 2024, June 2025, May 2026.
  // 'Usually May' is true; 'every May' is not, and the difference matters to
  // someone reserving for a specific month.
  const drift = infer([{ month: '2024-05', attendees: 20 },
                       { month: '2025-06', attendees: 3 },
                       { month: '2026-05', attendees: 1 }], '2026-08-15');
  ok('a dominant month with drift is medium confidence',
     drift.confidence === 'medium', drift.confidence);
  ok('and still offers a date', drift.nextExpected === '2027-05', drift.nextExpected);
  ok('but says the month has moved', /has moved/.test(drift.note), drift.note);

  // NO REPEATING MONTH AT ALL. Three different months tells us nothing about
  // next year, so naming one would be a guess dressed as a finding.
  const scattered = infer([{ month: '2024-11', attendees: 15 },
                           { month: '2026-01', attendees: 5 }], '2026-08-15');
  ok('no repeating month is low confidence', scattered.confidence === 'low',
     scattered.confidence);
  ok('and offers NO next date', scattered.nextExpected === null,
     'naming one of three months would be a guess');
  ok('and says the month is unsettled', /unsettled/.test(scattered.note), scattered.note);

  // Zero occurrences must not throw — that event exists in the data.
  const none = infer([], '2026-08-15');
  ok('zero occurrences is handled', none.pattern === 'none' && none.nextExpected === null);

  // The predicted date must always be in the FUTURE relative to the clock,
  // not simply last-occurrence-plus-one.
  const stale = infer([{ month: '2020-03', attendees: 5 },
                       { month: '2021-03', attendees: 5 }], '2026-08-15');
  ok('a stale event predicts forward, not into the past',
     stale.nextExpected === '2027-03', stale.nextExpected);
}

// ---------------------------------------------------------------------------
console.log('\n4. zero and UNKNOWN are different answers');
{
  // THE HIGHEST-VALUE SECTION. @clolry asked for attendance "from which orgs".
  // The seeded figures have no org detail — it does not exist in the source.
  //
  // If this reports {} instead of null, the UI shows "no attendees from FCB"
  // for an event FCB has been sending people to for three years, and a DAC
  // concludes they have no history at it.
  const occ = EH('seedOccurrences()');
  // 14, counted from the source table: every non-dash cell across 10 events
  // and 12 months. Asserted as a number so a dropped event is caught here
  // rather than showing up as a quietly shorter list in the UI.
  ok('all 14 occurrences from the source table are expanded',
     occ.length === 14, occ.length);
  ok('EVERY seeded occurrence reports org breakdown as null',
     occ.every(o => o.orgBreakdown === null),
     occ.filter(o => o.orgBreakdown !== null).map(o => o.occurrenceId));
  ok('and none reports an empty object',
     !occ.some(o => o.orgBreakdown && Object.keys(o.orgBreakdown).length === 0),
     'an empty object reads as "nobody attended"');
  ok('spend is null, not zero, when unrecorded',
     occ.every(o => o.totalEstSpend === null),
     'zero spend is a claim; unrecorded is not');
  ok('every occurrence is tagged with its source',
     occ.every(o => o.source === 'historical-seed'));
  ok('occurrence IDs are unique',
     new Set(occ.map(o => o.occurrenceId)).size === occ.length);

  // And the event-level roll-up carries it through.
  const r = E.run('EventHistory.getEventHistory({ now: new Date("2026-08-15") })');
  ok('the payload builds without a Requests tab', r.success === true, r.error);
  ok('all 10 events reach the UI, including the unattended one',
     r.data.events.length === 10, r.data.events.length);
  ok('org breakdown is null at event level too',
     r.data.events.every(e => e.orgBreakdown === null));
  ok('and the source is labelled "none"',
     r.data.events.every(e => e.orgBreakdownSource === 'none'));
  ok('the summary counts events lacking org detail',
     r.data.summary.eventsWithoutOrgDetail === 10,
     r.data.summary.eventsWithoutOrgDetail);
  ok('and the payload states the scope caveat in words',
     /not comparable and are never summed/.test(r.data.summary.sourceNote));
}

// ---------------------------------------------------------------------------
console.log('\n5. the two sources are never summed');
{
  // @clolry supplied both an attendance table and a FAS tracker summary, and
  // they disagree: CGP Spring Conference is 24 travellers in one and 4 in the
  // other. Different populations — ASD-wide versus FAS-exception-only.
  //
  // Averaging or adding them produces a number that describes neither, so the
  // two lists stay separate on the same event.
  const headers = ['Request_ID', 'Status', 'Trip_Name', 'Event_Start_Date',
                   'Traveler_Count', 'Traveler_Org_Codes', 'Grand_Total',
                   'Owning_Org_Code'];
  const rows = [
    ['R1', 'APPROVED', 'CGP Spring Conference', new Date('2026-05-12'), 2, 'FCA,FCB', 4416, 'FCA'],
    ['R2', 'APPROVED', 'CGP Spring Conference', new Date('2026-05-13'), 2, 'FCB,FCB', 0, 'FCB']
  ];
  const withReq = load({ headers, rows });
  const r = withReq.run('EventHistory.getEventHistory({ now: new Date("2026-08-15") })');
  const cgp = r.data.events.find(e => e.eventName === 'CGP Spring Conference');

  ok('historical attendance is unchanged by LETS data',
     cgp.totalHistoricalAttendees === 24, cgp.totalHistoricalAttendees);
  ok('LETS attendance is reported separately',
     cgp.totalLetsAttendees === 4, cgp.totalLetsAttendees);
  ok('the two lists are distinct',
     cgp.historical.length === 3 && cgp.letsDerived.length === 1,
     'historical=' + cgp.historical.length + ' lets=' + cgp.letsDerived.length);
  ok('and no field holds their sum',
     JSON.stringify(cgp).indexOf('"28"') === -1 &&
     cgp.totalHistoricalAttendees + cgp.totalLetsAttendees === 28);

  // The org breakdown now EXISTS, because LETS records it and the seed does not.
  ok('org breakdown appears once LETS has data', cgp.orgBreakdown !== null);
  ok('and is attributed to its source', cgp.orgBreakdownSource === 'lets-requests');
  ok('counting one entry per traveller',
     cgp.orgBreakdown.FCA === 1 && cgp.orgBreakdown.FCB === 3,
     cgp.orgBreakdown);
  ok('the summary no longer counts this event as lacking detail',
     r.data.summary.eventsWithoutOrgDetail === 9,
     r.data.summary.eventsWithoutOrgDetail);

  // Recurrence uses every known month regardless of source: when an event
  // happens does not depend on which system recorded it.
  ok('recurrence sees both sources',
     cgp.occurrenceMonths.indexOf('2026-05') > -1);
}

// ---------------------------------------------------------------------------
console.log('\n6. request derivation refuses to count travel that did not happen');
{
  const headers = ['Request_ID', 'Status', 'Trip_Name', 'Event_Start_Date',
                   'Traveler_Count', 'Traveler_Org_Codes', 'Grand_Total',
                   'Owning_Org_Code'];
  const rows = [
    ['R1', 'APPROVED', 'Some Summit', new Date('2026-03-02'), 3, 'FCA', 1000, 'FCA'],
    // A denied or abandoned request is not attendance. Counting it inflates
    // history with trips nobody took.
    ['R2', 'DENIED', 'Some Summit', new Date('2026-03-02'), 50, 'FCB', 9999, 'FCB'],
    ['R3', 'CANCELLED', 'Some Summit', new Date('2026-03-02'), 40, 'FCB', 9999, 'FCB'],
    ['R4', 'DRAFT', 'Some Summit', new Date('2026-03-02'), 30, 'FCB', 9999, 'FCB'],
    ['R5', 'WITHDRAWN', 'Some Summit', new Date('2026-03-02'), 20, 'FCB', 9999, 'FCB']
  ];
  const t = load({ headers, rows });
  const r = t.run('EventHistory.getEventHistory({ now: new Date("2026-08-15") })');
  const ev = r.data.events.find(e => e.eventName === 'Some Summit');
  ok('only the approved request counts', ev.totalLetsAttendees === 3,
     ev.totalLetsAttendees);
  ok('and the denied org does not appear in the breakdown',
     !ev.orgBreakdown.FCB, ev.orgBreakdown);

  // Correction prefixes. @clolry's FAS tracker summary has both "Federal
  // Networks 2026" and "CORRECTION: Federal Networks 2026" — the same
  // conference, listed twice.
  const norm = s => t.run('EventHistory.normalizeEventName(' + JSON.stringify(s) + ')');
  ok('CORRECTION: is stripped',
     norm('CORRECTION: Federal Networks 2026') === 'Federal Networks 2026');
  ok('and a stacked prefix too',
     norm('CORRECTION REVISED TRAVEL DATES: Support NOAA') === 'Support NOAA',
     norm('CORRECTION REVISED TRAVEL DATES: Support NOAA'));
  // Deliberately conservative: merging two genuinely different events is
  // worse than listing one twice, so nothing fuzzy happens here.
  ok('a name that merely CONTAINS the word is untouched',
     norm('Fraud Correction Workshop') === 'Fraud Correction Workshop');
  ok('and a normal name is unchanged',
     norm('NCMA World Congress') === 'NCMA World Congress');

  // A row with no org codes at all must not fabricate a breakdown.
  const blank = load({
    headers,
    rows: [['R9', 'APPROVED', 'Blind Event', new Date('2026-04-01'), 2, '', 500, '']]
  });
  const br = blank.run('EventHistory.getEventHistory({ now: new Date("2026-08-15") })');
  const be = br.data.events.find(e => e.eventName === 'Blind Event');
  ok('a request with no org codes yields null, not {}',
     be.orgBreakdown === null, be.orgBreakdown);

  // Falls back to the owning org, so a request still attributes somewhere.
  const fallback = load({
    headers,
    rows: [['R8', 'APPROVED', 'Owned Event', new Date('2026-04-01'), 2, '', 500, 'FCC']]
  });
  const fr = fallback.run('EventHistory.getEventHistory({ now: new Date("2026-08-15") })');
  const fe = fr.data.events.find(e => e.eventName === 'Owned Event');
  ok('a blank traveller list falls back to the owning org',
     fe.orgBreakdown && fe.orgBreakdown.FCC === 1, fe.orgBreakdown);

  // Columns are resolved BY NAME. A reordered sheet must still work — LETS
  // calls positional reads its most dangerous routine hazard (G-014).
  const shuffled = load({
    headers: ['Trip_Name', 'Traveler_Org_Codes', 'Event_Start_Date', 'Status',
              'Traveler_Count', 'Request_ID', 'Grand_Total', 'Owning_Org_Code'],
    rows: [['Reordered Event', 'FCA', new Date('2026-06-01'), 'APPROVED', 5, 'R7', 100, 'FCA']]
  });
  const sr = shuffled.run('EventHistory.getEventHistory({ now: new Date("2026-08-15") })');
  const se = sr.data.events.find(e => e.eventName === 'Reordered Event');
  ok('a reordered Requests tab still resolves',
     !!se && se.totalLetsAttendees === 5, se && se.totalLetsAttendees);

  // A Requests tab missing its key columns must degrade, not throw.
  const broken = load({ headers: ['Request_ID', 'Status'], rows: [['R1', 'APPROVED']] });
  const brr = broken.run('EventHistory.getEventHistory({ now: new Date("2026-08-15") })');
  ok('a Requests tab without Trip_Name degrades to seed data only',
     brr.success === true && brr.data.events.length === 10);
}

// ---------------------------------------------------------------------------
console.log('\n7. the trend a planner actually needs');
{
  // @clolry's data trends down hard: CGP Spring Conference 20 -> 3 -> 1, ACT
  // IAC ELC 25 -> 8. Surfacing that is most of the value of showing history —
  // a DAC about to reserve for 20 should see that 20 was two years ago.
  const r = E.run('EventHistory.getEventHistory({ now: new Date("2026-08-15") })');
  const cgp = r.data.events.find(e => e.eventName === 'CGP Spring Conference');
  ok('direction is reported', cgp.trend.direction === 'down');
  ok('with the actual endpoints', cgp.trend.firstAttendees === 20 &&
     cgp.trend.lastAttendees === 1, cgp.trend);
  ok('and a percentage', cgp.trend.percentChange === -95, cgp.trend.percentChange);

  // Peak is reported separately: 20 -> 3 -> 1 and 1 -> 3 -> 20 are different
  // stories that first-versus-last alone cannot always tell apart.
  ok('peak is reported separately', cgp.trend.peakAttendees === 20 &&
     cgp.trend.peakMonth === '2024-05', cgp.trend);

  const single = r.data.events.find(e => e.eventName === 'Dreamforce');
  ok('a single occurrence has no trend', single.trend === null,
     'one point is not a direction');

  // Fiscal-year roll-up, which is the unit a DAC budgets in.
  ok('attendance rolls up by fiscal year',
     r.data.summary.attendeesByFiscalYear.FY2024 === 88 &&
     r.data.summary.attendeesByFiscalYear.FY2025 === 53 &&
     r.data.summary.attendeesByFiscalYear.FY2026 === 46,
     r.data.summary.attendeesByFiscalYear);
  ok('and the fiscal years sum to 187',
     Object.values(r.data.summary.attendeesByFiscalYear).reduce((a, b) => a + b, 0) === 187);

  // Biggest history first: that is what a planner scans for.
  ok('events are ordered by total attendance',
     r.data.events[0].eventName === 'NCMA World Congress',
     r.data.events.slice(0, 3).map(e => e.eventName));
}

// ---------------------------------------------------------------------------
console.log('\n8. the dashboard section is actually wired up');
{
  // This page had ZERO server calls before this change — 34 hardcoded dollar
  // figures and a stub button. So "the feature is built" and "the feature is
  // reachable" are genuinely separate claims here.
  const page = fs.readFileSync('lets_app/client/pages/travelBudgetDashboardPage.html', 'utf8');
  const srv = fs.readFileSync('lets_app/server/30_services/EventHistory.js', 'utf8');

  // Apps Script exposes only TOP-LEVEL declarations to google.script.run.
  // Finding G-016 is exactly this: the whole LETS budget layer is unreachable
  // because every module is an IIFE exposing nothing at the top level. A
  // function defined inside the EventHistory closure would be invisible.
  ok('the entry point is a top-level declaration',
     /^function getTravelEventHistory\(\)/m.test(srv),
     'a function inside the IIFE is unreachable from google.script.run — see G-016');

  ok('the page calls it', /serverCall\('getTravelEventHistory'\)/.test(page));
  ok('and includes serverCall', /include\('client\/shared\/serverCall'\)/.test(page));
  // Every name, note and org code from the sheet goes through escapeHtml.
  // "Research & Development" would otherwise break the row it is in.
  ok('and includes escapeHtml', /include\('client\/shared\/escapeHtml'\)/.test(page));
  ok('event names are escaped', /escapeHtml\(ev\.eventName\)/.test(page));

  // A failure must be visible. This page has never made a server call, so a
  // silent failure reads as "the feature was not built".
  ok('a failed call shows an error', /id="ehError"/.test(page) &&
     /function showError/.test(page));

  // THE HONESTY REQUIREMENT. A reader who sees real numbers in this section
  // will reasonably assume the KPI cards above are live too. They are not.
  ok('the page states that the figures above are placeholders',
     /placeholders and are not yet wired to live data/.test(page),
     'real data beside mockup data, unlabelled, is worse than mockup alone');

  // The stub button must stop claiming it worked.
  ok('the FAS sync button no longer claims success',
     !/Sync complete/.test(page) && /Not yet implemented/.test(page),
     'it used to alert "Sync complete" without doing anything');

  // Null breakdown must render as "not recorded", never as zero.
  ok('a null org breakdown renders as Not recorded',
     /Not recorded/.test(page) && /if \(!ev\.orgBreakdown\)/.test(page));

  // The UI must not invent a date the server declined to give.
  ok('no date is shown when the server returns none',
     /No reliable date/.test(page));
}

console.log('\n9. negative controls (the suite must be able to fail)');
{
  const src = fs.readFileSync('lets_app/server/30_services/EventHistory.js', 'utf8');

  // 8a — report {} instead of null for an unknown org breakdown. §4 must fail.
  const zeroed = src.replace('orgBreakdown: null,          // not recorded — see above',
                             'orgBreakdown: {},');
  ok('negative control patched the null breakdown', zeroed !== src);
  {
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN
    });
    vm.runInContext(`
      function successResponse(d) { return { success: true, data: d }; }
      function errorResponse(m) { return { success: false, error: m }; }
      var SHEET_NAMES = { REQUESTS: 'Requests' };
      function TravelDB() { throw new Error('nodb'); }
    `, ctx);
    vm.runInContext(zeroed, ctx, { filename: 'EventHistory.js (zeroed)' });
    const occ = vm.runInContext('EventHistory.seedOccurrences()', ctx);
    ok('with {} instead of null, section 4 would pass a false claim',
       occ.every(o => o.orgBreakdown !== null),
       'the patch did not take, so section 4 is not live');
  }

  // 8b — predict from a single occurrence. §3 must fail.
  const guessing = src.replace(
    '        // Deliberately null. One data point is not a pattern, and offering a\n' +
    '        // prediction from it would be the dashboard inventing a schedule.\n' +
    '        nextExpected: null,',
    '        nextExpected: occ[0].month,');
  ok('negative control patched the single-occurrence guard', guessing !== src);
  {
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN
    });
    vm.runInContext(`
      function successResponse(d) { return { success: true, data: d }; }
      function errorResponse(m) { return { success: false, error: m }; }
      var SHEET_NAMES = { REQUESTS: 'Requests' };
      function TravelDB() { throw new Error('nodb'); }
    `, ctx);
    vm.runInContext(guessing, ctx, { filename: 'EventHistory.js (guessing)' });
    const one = vm.runInContext(
      'EventHistory.inferRecurrence([{month:"2024-08",attendees:20}], new Date("2026-08-15"))', ctx);
    ok('a patched build does predict from one point', one.nextExpected !== null,
       'so section 3 is exercising a real guard');
  }

  // 8c — the transcription check must be able to see a wrong digit.
  const typo = src.replace("{ month: '2024-07', attendees: 25 }",
                           "{ month: '2024-07', attendees: 52 }");
  ok('negative control patched a digit', typo !== src);
  {
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      JSON, Date, Object, String, Number, Boolean, Array, Math, RegExp, Error,
      parseInt, parseFloat, isNaN
    });
    vm.runInContext(`
      function successResponse(d) { return { success: true, data: d }; }
      function errorResponse(m) { return { success: false, error: m }; }
      var SHEET_NAMES = { REQUESTS: 'Requests' };
      function TravelDB() { throw new Error('nodb'); }
    `, ctx);
    vm.runInContext(typo, ctx, { filename: 'EventHistory.js (typo)' });
    const seed = vm.runInContext('EVENT_HISTORY_SEED', ctx);
    const total = seed.reduce((s, e) => s + e.occurrences.reduce((t, o) => t + o.attendees, 0), 0);
    ok('a transposed digit changes the grand total', total !== 187,
       'got ' + total + ' — section 1 would not catch a typo');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
