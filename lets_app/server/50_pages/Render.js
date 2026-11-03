/**
 * Render.js
 * Page-server functions invoked by doGet. Each builds an HtmlOutput from
 * a template under client/pages (today still TravelRequest/index/* until
 * Chunk 6 reorgs HTML). TRIP_FAVICON_ID is read from 00_config/TripConfig.js.
 *
 * Also houses the `include()` template helper, `getScriptUrl()` (client RPC),
 * and `formatUserName()` (shared by services that need a display name).
 */

/**
 * Render the branded access-restricted card. Used for both the site-level gate
 * (no role + not an HC supervisor) and the per-page role gates (admin / reviewer).
 *
 * @param {string} userEmail - Signed-in user (shown on the card)
 * @param {Object} [opts]
 * @param {string} [opts.iconClass='fa-lock']        Font Awesome class for the centered icon
 * @param {string} [opts.title='Access Restricted']  Card headline
 * @param {string} [opts.subtitle]                   One-line explanation under the headline
 * @param {boolean} [opts.showReturnToPortal=false]  Show the "Return to Portal" button
 * @param {string} [opts.pageTitle=getAppName() + ' - Access Restricted']  Browser tab title
 * @returns {HtmlOutput}
 *
 * @server
 */
function serveAccessRestrictedPage(userEmail, opts) {
  opts = opts || {};
  var template = HtmlService.createTemplateFromFile('client/pages/travelAccessBlockedPage');
  template.userEmail = userEmail || '';
  // Branding, so a page can render <?= appName ?> rather than a
  // hardcoded "TRIP". See Props.js getBrandingForClient.
  _applyBranding(template);
  template.iconClass = opts.iconClass || 'fa-lock';
  template.title = opts.title || 'Access Restricted';
  template.subtitle = opts.subtitle || getAppName() + ' is currently limited to authorized ' + getOrgShortName() + ' personnel.';
  template.showReturnToPortal = !!opts.showReturnToPortal;
  template.scriptUrl = ScriptApp.getService().getUrl();
  template.pageTitle = opts.pageTitle || getAppName() + ' - Access Restricted';
  return template
    .evaluate()
    .setFaviconUrl('https://drive.google.com/uc?id=' + TRIP_FAVICON_ID + '&export=download&format=png')
    .setTitle(template.pageTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Serve the new-request form page. Fetches submitter info (BU/sector/org) so
 * the form pre-populates correctly. If `?duplicateFrom=<id>` is present,
 * fetches the source request's blueprint server-side and inlines it into the
 * page — saves a `google.script.run` roundtrip on form load. If `?draftId` is
 * present, the client controller restores from IndexedDB after page load.
 *
 * @param {Object} e - GAS web app event; optional `?draftId`, `?duplicateFrom`
 * @returns {HtmlOutput}
 *
 * @server
 */
function serveTravelRequestForm(e) {
  console.time('serveTravelRequestForm');
  var userEmail = Session.getActiveUser().getEmail() || '';
  var formattedName = formatUserName(userEmail);
  var params = (e && e.parameter) || {};
  var draftId = params.draftId || '';
  var duplicateFrom = params.duplicateFrom || '';

  console.time('serveTravelRequestForm:getSubmitterInfo');
  var submitterInfo = { buCode: '', buName: '', orgCode: '' };
  try {
    var info = getSubmitterInfo(userEmail);
    if (info && info.success) submitterInfo = info;
  } catch (err) {
    console.log('Could not get submitter info: ' + err.message);
  }
  console.timeEnd('serveTravelRequestForm:getSubmitterInfo');

  // If ?duplicateFrom=<id>, fetch the blueprint server-side and inline it
  // into the page. Bypasses an extra google.script.run roundtrip on form load.
  // Errors are non-fatal — form still opens, blank, with a toast on the client.
  var duplicateBlueprint = null;
  var duplicateError = '';
  if (duplicateFrom) {
    console.time('serveTravelRequestForm:duplicateFetch');
    try {
      var dupResult = getRequestForDuplication(duplicateFrom);
      if (dupResult && dupResult.success) {
        duplicateBlueprint = dupResult;
      } else {
        duplicateError = (dupResult && dupResult.error) || 'Failed to load template';
      }
    } catch (err) {
      console.error('serveTravelRequestForm: duplicate fetch error: ' + err.message);
      duplicateError = err.message || 'Failed to load template';
    }
    console.timeEnd('serveTravelRequestForm:duplicateFetch');
  }

  var template = HtmlService.createTemplateFromFile('client/pages/travelRequestPage');
  template.userEmail = userEmail;
  // Branding, so a page can render <?= appName ?> rather than a
  // hardcoded "TRIP". See Props.js getBrandingForClient.
  _applyBranding(template);
  template.userName = formattedName;
  template.submitterBU = submitterInfo.buCode || '';
  template.submitterBUName = submitterInfo.buName || '';
  template.submitterOrgCode = submitterInfo.orgCode || '';
  template.scriptUrl = ScriptApp.getService().getUrl();
  template.draftId = draftId;
  template.duplicateBlueprint = duplicateBlueprint
    ? JSON.stringify(duplicateBlueprint)
    : 'null';
  template.duplicateError = duplicateError;

  console.time('serveTravelRequestForm:templateEvaluate');
  var output = template
    .evaluate()
    .setFaviconUrl('https://drive.google.com/uc?id=' + TRIP_FAVICON_ID + '&export=download&format=png')
    .setTitle(getAppName() + ' - New Request')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  console.timeEnd('serveTravelRequestForm:templateEvaluate');
  console.timeEnd('serveTravelRequestForm');
  return output;
}

/**
 * Serve the Travel Portal — the user's "my requests" landing page (open
 * requests + drafts).
 *
 * @param {Object} e - GAS web app event
 * @returns {HtmlOutput}
 *
 * @server
 */
function serveTravelPortal(e) {
  var userEmail = Session.getActiveUser().getEmail() || '';
  var formattedName = formatUserName(userEmail);

  var template = HtmlService.createTemplateFromFile('client/pages/travelPortalPage');
  template.userEmail = userEmail;
  // Branding, so a page can render <?= appName ?> rather than a
  // hardcoded "TRIP". See Props.js getBrandingForClient.
  _applyBranding(template);
  template.userName = formattedName;
  template.scriptUrl = ScriptApp.getService().getUrl();

  return template
    .evaluate()
    .setFaviconUrl('https://drive.google.com/uc?id=' + TRIP_FAVICON_ID + '&export=download&format=png')
    .setTitle(getAppName() + ' - Travel Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Serve the review page for a single request. Used for both reviewer action
 * (`?viewMode=reviewer`, the default) and submitter read-only display
 * (`?viewMode=submitter`) — the client controller switches behavior based on
 * the template's viewMode value.
 *
 * @param {Object} e - GAS web app event; expects `?requestId`, optional `?viewMode`
 * @returns {HtmlOutput}
 *
 * @server
 */
function serveTravelReviewPage(e) {
  var userEmail = Session.getActiveUser().getEmail() || '';
  var formattedName = formatUserName(userEmail);
  var requestId = (e && e.parameter && e.parameter.requestId) || '';
  var viewMode = (e && e.parameter && e.parameter.viewMode) || 'reviewer';

  var template = HtmlService.createTemplateFromFile('client/pages/travelReviewPage');
  template.userEmail = userEmail;
  // Branding, so a page can render <?= appName ?> rather than a
  // hardcoded "TRIP". See Props.js getBrandingForClient.
  _applyBranding(template);
  template.userName = formattedName;
  template.requestId = requestId;
  template.viewMode = viewMode;
  template.scriptUrl = ScriptApp.getService().getUrl();

  return template
    .evaluate()
    .setFaviconUrl('https://drive.google.com/uc?id=' + TRIP_FAVICON_ID + '&export=download&format=png')
    .setTitle(getAppName() + ' - Review')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Serve the DD funding confirmation page. Travelers on a request with status
 * `APPROVED_GOGOV` or `Pending_DD_Confirmation` confirm or flag funding
 * issues here.
 *
 * @param {Object} e - GAS web app event; expects `?requestId`
 * @returns {HtmlOutput}
 *
 * @server
 */
function serveDDConfirmPage(e) {
  var userEmail = Session.getActiveUser().getEmail() || '';
  var formattedName = formatUserName(userEmail);
  var requestId = (e && e.parameter && e.parameter.requestId) || '';

  var template = HtmlService.createTemplateFromFile('client/pages/ddConfirmPage');
  template.userEmail = userEmail;
  // Branding, so a page can render <?= appName ?> rather than a
  // hardcoded "TRIP". See Props.js getBrandingForClient.
  _applyBranding(template);
  template.userName = formattedName;
  template.requestId = requestId;
  template.scriptUrl = ScriptApp.getService().getUrl();

  return template
    .evaluate()
    .setFaviconUrl('https://drive.google.com/uc?id=' + TRIP_FAVICON_ID + '&export=download&format=png')
    .setTitle(getAppName() + ' - Confirm Travel')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Serve the admin dashboard. Gated on `isTravelAdmin(userEmail)` — non-admins
 * see the "Admin Only" variant of the access-blocked card with a return-to-
 * portal button.
 *
 * @param {Object} e - GAS web app event
 * @returns {HtmlOutput}
 *
 * @server
 */
function serveTravelAdminPage(e) {
  var userEmail = Session.getActiveUser().getEmail() || '';
  var formattedName = formatUserName(userEmail);

  // COORDINATOR OR ADMIN.
  //
  // A coordinator's whole job lives on this page — reassigning a reviewer and
  // working the event proposal queue. Gating it on admin alone would make the
  // role unreachable, which is the mistake that would have made all of this
  // look broken rather than restricted.
  //
  // What a coordinator CANNOT do is still enforced per function: the budget
  // allocation editor, the travel importer, the roster editor and the role
  // granting all check isTravelAdmin independently. The nav hides those
  // sections for a coordinator, and hiding is a convenience — the server
  // refuses regardless.
  if (!isTravelCoordinator(userEmail)) {
    console.log('Access denied to travel admin page for: ' + userEmail);
    return serveAccessRestrictedPage(userEmail, {
      iconClass: 'fa-shield-halved',
      title: 'Admin Only',
      subtitle: 'This page is restricted to ' + getAppName() + ' administrators.',
      showReturnToPortal: true,
      pageTitle: getAppName() + ' - Admin Only'
    });
  }

  var template = HtmlService.createTemplateFromFile('client/pages/travelAdminPage');
  template.userEmail = userEmail;
  // Branding, so a page can render <?= appName ?> rather than a
  // hardcoded "TRIP". See Props.js getBrandingForClient.
  _applyBranding(template);
  template.userName = formattedName;
  template.scriptUrl = ScriptApp.getService().getUrl();

  // Published so the page can hide what a coordinator cannot use.
  //
  // THIS WAS IN THE WRONG FUNCTION. I anchored it on `template.userEmail =
  // userEmail;`, which first occurs in serveTravelRequestForm — so the ADMIN
  // page never received it, options.isFullAdmin was undefined, and the
  // client's `!== false` default meant a coordinator saw every admin control.
  //
  // The hiding is cosmetic either way: every restricted function checks
  // isTravelAdmin itself and refuses. But a coordinator shown a Budget
  // button that errors is a worse experience than one who never sees it.
  template.isFullAdmin = isTravelAdmin(userEmail);

  return template
    .evaluate()
    .setFaviconUrl('https://drive.google.com/uc?id=' + TRIP_FAVICON_ID + '&export=download&format=png')
    .setTitle(getAppName() + ' - Admin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Serve the reviewer dashboard — KPI metrics for active BU / Sector / OSO
 * reviewers, scope-filtered to their reviewer role. Admins auto-redirect to
 * the admin dashboard unless `?force=1` is set. Admins can also use
 * `?force=1&as=<role>&buName=<x>&sector=<x>` to view-as another reviewer
 * for debugging the scope-filter logic.
 *
 * @param {Object} e - GAS web app event; optional `?force`, `?as`, `?buName`, `?sector`
 * @returns {HtmlOutput}
 *
 * @server
 */
function serveReviewerDashboardPage(e) {
  var userEmail = Session.getActiveUser().getEmail() || '';
  var formattedName = formatUserName(userEmail);
  var params = (e && e.parameter) || {};
  var forceDebug = !!params.force;

  // View-as URL params (admin-only override, applied inside getReviewerContext)
  var viewAs = null;
  if (forceDebug && params.as) {
    viewAs = {
      role: String(params.as).toLowerCase(),
      buName: params.buName || '',
      sector: (params.sector || '').toUpperCase()
    };
  }

  // DELEGATION act-as, which is a different thing from the admin view-as
  // above and must not be confused with it.
  //
  //   ?as=bu&force=1     ADMIN preview. Shows a synthetic BU reviewer context
  //                      for testing. Grants nothing real.
  //   ?actAs=a@gsa.gov   DELEGATION. Resolves the actual person's context,
  //                      and only if the caller holds a live delegation from
  //                      them. getReviewerContext refuses otherwise.
  //
  // Passed as a URL parameter rather than read from the session because the
  // page is rendered server-side before any client script runs — the
  // delegation panel sets it in sessionStorage, and the links it builds carry
  // it through. The authority check is in getReviewerContext either way, so a
  // hand-typed parameter buys nothing.
  if (params.actAs) {
    viewAs = viewAs || {};
    viewAs.actAs = String(params.actAs).toLowerCase();
  }

  var ctx;
  try {
    ctx = getReviewerContext(userEmail, viewAs);
  } catch (err) {
    console.error('serveReviewerDashboardPage: getReviewerContext error: ' + err.message);
    ctx = { role: 'none', isReviewer: false };
  }

  // Admins land on the admin dashboard unless ?force=1 is set.
  // Note: when view-as is active, ctx.isAdmin stays true but ctx.role is overridden,
  // so the redirect check is on isAdmin combined with forceDebug being false.
  if (ctx.isAdmin && !ctx.viewAsActive && !forceDebug) {
    return HtmlService.createHtmlOutput(
      '<script>window.location.href = "' + ScriptApp.getService().getUrl() + '?mode=admin";</script>' +
      '<p>Redirecting to admin dashboard...</p>'
    ).setTitle(getAppName() + ' - Redirecting');
  }

  // Non-reviewers don't see this page at all.
  if (!ctx.isReviewer) {
    console.log('Reviewer dashboard access denied for: ' + userEmail);
    return serveAccessRestrictedPage(userEmail, {
      iconClass: 'fa-chart-line',
      title: 'Reviewers Only',
      subtitle: 'This page is for active ' + getAppName() + ' reviewers.',
      showReturnToPortal: true,
      pageTitle: getAppName() + ' - Reviewers Only'
    });
  }

  var template = HtmlService.createTemplateFromFile('client/pages/travelReviewerDashboardPage');
  template.userEmail = userEmail;
  // Branding, so a page can render <?= appName ?> rather than a
  // hardcoded "TRIP". See Props.js getBrandingForClient.
  _applyBranding(template);
  template.userName = formattedName;
  template.scriptUrl = ScriptApp.getService().getUrl();
  template.reviewerRole = ctx.role;       // 'oso' | 'bu' | 'sector'
  template.reviewerLabel = ctx.label;
  template.scopeType = ctx.scope.type;    // 'all' | 'bu' | 'sector'
  template.scopeCodes = JSON.stringify(ctx.scope.codes || []);
  template.scopeNames = JSON.stringify(ctx.scope.names || []);
  template.viewAsActive = !!ctx.viewAsActive;
  template.viewAsLabel = ctx.viewAsLabel || '';
  // Published so the page can render the act-as banner on first paint rather
  // than waiting for a round trip — a delegate should not see one identity
  // flash before the other.
  template.actingAs = ctx.actingAs || '';
  template.actingAsName = ctx.actingAsName || '';
  template.viewAsParams = JSON.stringify(viewAs || null);

  return template
    .evaluate()
    .setFaviconUrl('https://drive.google.com/uc?id=' + TRIP_FAVICON_ID + '&export=download&format=png')
    .setTitle(getAppName() + ' - My Review Queue')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * GAS template include helper — required by `<?!= include('...') ?>` in HTML
 * files. Runs at server-side template eval time, not via google.script.run.
 *
 * @param {string} filename - GAS HTML file path (no extension)
 * @returns {string} The included file's evaluated content
 *
 * @server
 */
/**
 * Attaches branding values to a page template.
 *
 * Called for every served page so a template can write <?= appName ?> instead
 * of hardcoding "TRIP". The app was inherited from another workgroup and its
 * name appeared in 69 places; @clolry wants a redeploy for a different group to
 * be a configuration change, not a code change.
 *
 * @param {HtmlTemplate} template
 */
function _applyBranding(template) {
  var b = getBrandingForClient();
  template.appName = b.appName;
  template.orgShort = b.orgShort;
  template.orgLong = b.orgLong;
  template.foLabel = b.foLabel;
  template.sectorLabel = b.sectorLabel;
  template.buLabel = b.buLabel;
  template.contactEmail = b.contactEmail;
  return template;
}

function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}

/**
 * Get the deployed script URL. Called from the client (navLoader + portal
 * controller) to build navigation links back to other modes.
 *
 * @returns {string} Web app deployment URL
 *
 * @client
 */
function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * Format user email to display name (e.g. "michael.thoennes@gsa.gov" → "Michael T").
 * Used by page-server functions and several submission/review services to
 * derive a human-readable name when only the email is known.
 *
 * @param {string} email - Full email address
 * @returns {string} Display name, or empty string if email is empty
 *
 * @server
 */
function formatUserName(email) {
  if (!email) return '';
  var localPart = email.split('@')[0].trim().toLowerCase();
  if (localPart.indexOf('.') !== -1) {
    var parts = localPart.split('.');
    var f = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    var l = parts[1].charAt(0).toUpperCase();
    return f + ' ' + l;
  }
  if (localPart) {
    return localPart.charAt(0).toUpperCase() + localPart.slice(1);
  }
  return '';
}

/**
 * Serve the LETS Travel Budget & Executive Tracker Dashboard
 *
 * @param {Object} e - GAS web app event
 * @returns {HtmlOutput}
 *
 * @server
 */
function serveTravelBudgetDashboardPage(e) {
  var userEmail = Session.getActiveUser().getEmail() || '';
  var formattedName = formatUserName(userEmail);
  var template = HtmlService.createTemplateFromFile('client/pages/travelBudgetDashboardPage');
  template.userEmail = userEmail;
  // Branding, so a page can render <?= appName ?> rather than a
  // hardcoded "TRIP". See Props.js getBrandingForClient.
  _applyBranding(template);
  template.userName = formattedName;
  template.scriptUrl = ScriptApp.getService().getUrl();

  return template
    .evaluate()
    .setFaviconUrl('https://drive.google.com/uc?id=' + TRIP_FAVICON_ID + '&export=download&format=png')
    .setTitle('LETS - Travel Budget & Discretionary Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
