/**
 * doGet.js
 * The TRIP web app's HTTP entry point. Routes by `?mode=` to a page-server
 * in 50_pages/Render.js after enforcing the site-level access gate.
 *
 * Modes:
 *   (default) / travel   → Portal (my requests + drafts)
 *   form                 → New request form
 *   review               → Reviewer page (expects ?requestId)
 *   dd-confirm           → DD funding confirmation (expects ?requestId)
 *   admin                → Admin dashboard (gated on isTravelAdmin)
 *   reviewer-dashboard   → Reviewer metrics dashboard
 *   access-blocked       → Access-restricted card (admin preview path)
 */

/**
 * Web app entry point. Routes by `?mode=` URL parameter to the appropriate
 * page-server function. Enforces the site-level access gate first — anyone
 * who isn't a TRIP role-holder or HC-confirmed supervisor sees the access-
 * blocked page. Admin-only preview of the blocker page is available via
 * `?mode=access-blocked&preview=1`.
 *
 * @param {Object} e - GAS web app event (has `.parameter` for query string)
 * @returns {HtmlOutput}
 *
 * @webapp
 */
function doGet(e) {
  var mode = (e && e.parameter && e.parameter.mode) || 'travel';
  var params = (e && e.parameter) || {};
  var userEmail = Session.getActiveUser().getEmail() || '';

  // Admin-only preview of the blocker page (?mode=access-blocked&preview=1).
  // Lets admins eyeball the page without being denied access themselves.
  if (mode === 'access-blocked' && params.preview === '1' && isTravelAdmin(userEmail)) {
    return serveAccessRestrictedPage(userEmail);
  }

  // Site-level access gate. Shows blocker page to anyone who isn't an
  // active TRIP role-holder or an HC-confirmed supervisor.
  if (!canAccessTrip(userEmail)) {
    return serveAccessRestrictedPage(userEmail);
  }

  switch (mode) {
    case 'form':
      return serveTravelRequestForm(e);
    case 'review':
      return serveTravelReviewPage(e);
    case 'dd-confirm':
      return serveDDConfirmPage(e);
    case 'admin':
      return serveTravelAdminPage(e);
    case 'reviewer-dashboard':
      return serveReviewerDashboardPage(e);
    case 'budget':
      return serveTravelBudgetDashboardPage(e);
    case 'travel':
    default:
      return serveTravelPortal(e);
  }
}
