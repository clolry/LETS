/**
 * Render.js
 * The web app entry point.
 *
 * ONE ROUTE, ON PURPOSE
 * ---------------------
 * LETS has a `?mode=` switch with seven destinations because it is seven
 * screens. This app is one screen. A mode parameter here would be a hook
 * waiting for a second use that may never come.
 */

/**
 * Serves the org chart.
 *
 * NO ACCESS GATE, AND THAT IS DELIBERATE
 * --------------------------------------
 * LETS gates every page on `canAccessTrip`, because LETS exposes travel
 * requests, costs and approval decisions. This app exposes a reporting
 * structure, which is already visible in the directory and on any
 * conference-room wall.
 *
 * The control that matters is the DEPLOYMENT setting — `access: DOMAIN` in
 * appsscript.json — plus the data reduction in HCRead.buildTree: no email, no
 * grade, no employee ID, no position number. If this ever needs to be
 * narrower than "anyone in the domain", that is a deployment change, not a
 * code change.
 *
 * `executeAs: USER_DEPLOYING` is the other half. The LETS database is not
 * shared with every domain user, and it should not have to be — the deploying
 * account reads it on their behalf. The alternative, USER_ACCESSING, would
 * require sharing the entire travel database with the whole domain to show a
 * reporting chart. That would be a far larger disclosure than the chart.
 *
 * @param {Object} e
 * @returns {HtmlOutput}
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('client/orgChartPage');

  template.orgName = getOrgName();
  // Resolved server-side and inlined, so the first paint has the tree. A
  // google.script.run round-trip after load would show an empty frame for a
  // second or two on every visit.
  template.payload = JSON.stringify(getOrgChart(false));

  return template.evaluate()
    .setTitle(getOrgName() + ' — Org Chart')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Includes a client file into a template.
 *
 * Each included file is evaluated as its OWN template, so a variable set on
 * the page template is NOT visible inside it. That is not a quirk worth
 * discovering twice: in LETS, a `<?= appName ?>` added to an included file
 * threw "appName is not defined" on every page that included it — including
 * pages that never referenced appName — and took the whole app down.
 *
 * Included files here therefore take data through the DOM or through
 * window globals, never through scriptlets.
 *
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Setup check, for the Apps Script console.
 *
 * Reports what the deployment can actually see, which is the first question
 * when the page is empty. Logs rather than returns so the output is readable
 * in the execution log.
 *
 * @editor
 */
function checkOrgChartSetup() {
  console.log('--- Org chart setup check ---');

  var id = getHCSpreadsheetId();
  console.log('HC_SPREADSHEET_ID: ' + (id ? 'set (' + id.length + ' chars)' : 'NOT SET'));
  if (!id) {
    console.log('  -> Project Settings -> Script Properties -> add HC_SPREADSHEET_ID');
    return;
  }

  try {
    var ss = SpreadsheetApp.openById(id);
    console.log('opens OK:          ' + ss.getName());
    var tabs = ss.getSheets().map(function (s) { return s.getName(); });
    var hasPos = tabs.indexOf(TABS.POSITIONS) > -1;
    var hasOrgs = tabs.indexOf(TABS.ORGS) > -1;
    console.log(TABS.POSITIONS + ':      ' + (hasPos ? 'present' : 'MISSING'));
    console.log(TABS.ORGS + ':           ' + (hasOrgs ? 'present' : 'MISSING'));

    // LIST WHAT IS ACTUALLY THERE when a tab is missing.
    //
    // @clolry's first run reported both tabs MISSING against a spreadsheet
    // named "Copy of FAS Travel Exemption Request (Responses)" — the wrong
    // spreadsheet entirely. The check printed the NAME and the word MISSING
    // but not the tab list, so it looked like a setup problem in the LETS
    // database rather than a pointer at the wrong file.
    //
    // A diagnostic that reports a symptom it already has the evidence to
    // explain is a diagnostic that costs a round trip.
    if (!hasPos || !hasOrgs) {
      console.log('');
      console.log('tabs actually present (' + tabs.length + '):');
      tabs.forEach(function (t) { console.log('  - ' + t); });
      console.log('');
      console.log('  -> This looks like the WRONG SPREADSHEET. HC_SPREADSHEET_ID must');
      console.log('     point at the LETS TRAVEL DATABASE — the one holding Requests,');
      console.log('     Travel_Users and the HC tabs — not at a Google Form responses');
      console.log('     sheet or the FAS Exemption Tracker.');
      console.log('');
      console.log('     Find it: open the LETS project -> Project Settings ->');
      console.log('     Script Properties -> TRAVEL_DB_SPREADSHEET_ID, and use that');
      console.log('     exact value here.');
      console.log('');
      console.log('     If the ID is right and the tabs are genuinely absent, run');
      console.log('     setupTravelDatabase() in the LETS project to create them.');
      return;
    }
  } catch (e) {
    console.log('FAILED to open:    ' + e.message);
    console.log('  -> the deploying account must be able to READ that spreadsheet');
    return;
  }

  var tree = HCRead.buildTree();
  console.log('builds:            ' + (tree.success ? 'yes' : 'no — ' + tree.error));
  if (!tree.success) return;
  console.log('people:            ' + tree.count);
  console.log('org codes:         ' + tree.orgCount);
  console.log('top-level roots:   ' + tree.roots.length);
  if (tree.orgCount < 10) {
    console.log('  -> only ' + tree.orgCount + ' org codes. Run loadRealOrgCodes() in ' +
                'the LETS project, or press Load Org Codes on its HR Roster page.');
  }
  if (tree.warnings.length) {
    console.log('warnings:');
    tree.warnings.forEach(function (w) { console.log('  - ' + w); });
  } else {
    console.log('warnings:          none');
  }
}
