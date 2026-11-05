/**
 * TravelEmailService.js
 * Centralized email service for the Travel Request system
 *
 * All travel-related emails should be sent via this service to ensure
 * consistent sender address ({{contactEmail}}) and formatting.
 */

// ============================================================================
// CONSTANTS & STYLE CONFIGURATION
// ============================================================================

/**
 * Centralized email styling configuration
 * All colors, fonts, and visual styles should reference this object
 */
const EMAIL_STYLES = {
  colors: {
    // Primary actions
    primary: '#2563EB',
    primaryLight: '#3B82F6',
    primaryDark: '#1D4ED8',
    primaryDeepDark: '#1E40AF',
    success: '#10B981',
    successDark: '#059669',
    successDarker: '#047857',
    warning: '#F59E0B',
    warningDark: '#D97706',
    error: '#DC2626',
    errorDark: '#991B1B',

    // Text colors
    textPrimary: '#111827',
    textSecondary: '#374151',
    textBody: '#4B5563',
    textMuted: '#6B7280',
    textLight: '#9CA3AF',

    // Background colors
    bgWhite: '#FFFFFF',
    bgLight: '#F9FAFB',
    bgCard: '#FAFBFC',
    border: '#E5E7EB',
    borderLight: '#F3F4F6',
    borderMuted: '#D1D5DB',

    // Semantic info box colors
    infoBg: '#E3F2F9',
    infoBgLight: '#EFF6FF',
    infoBorder: '#1B7CAC',
    infoText: '#004f87',
    successBg: '#E8F5EC',
    successBgLight: '#ECFDF5',
    successBorder: '#286D3B',
    successText: '#1a5229',
    warningBg: '#FFFBEB',
    warningBorder: '#F59E0B',
    warningText: '#92400E',
    errorBg: '#FEF2F2',
    errorBgDeep: '#FEE2E2',
    errorBorder: '#DC2626',
    errorBorderLight: '#FECACA',
    errorText: '#7F1D1D'
  },
  fonts: {
    family: 'Calibri, Arial, sans-serif'
  }
};

/**
 * Maps approval stage names to review step identifiers
 * Used for progress tracker highlighting
 */
const STAGE_MAP = {
  'Supervisor': 'supervisor_review',
  'Sector': 'sector_review',
  'BU': 'bu_review',
  'OSO': 'oso_review',
  'AAS FO': 'oso_review',
  'FAS': 'fas_submission'
};

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Get the configured travel email address. Delegates to Props.js
 * (getEmailFromAddress) which handles the property read + default.
 *
 * @returns {string} The sender/reply-to email address
 * @server
 */
function getTravelEmailAddress() {
  return getEmailFromAddress();
}

/**
 * Get the configured travel email display name. Delegates to Props.js.
 *
 * @returns {string} The sender display name
 * @server
 */
function getTravelEmailName() {
  return getEmailFromName();
}

/**
 * Initialize travel email configuration. Delegates to Props.js
 * (initEmailConfigDefaults) which is idempotent.
 *
 * @editor
 */
function initTravelEmailConfig() {
  initEmailConfigDefaults();
  return { success: true };
}

// Date formatting helpers moved to 10_lib/DateTime.js (Chunk 9).
// _formatEmailDate → formatDateForDisplay (callsites wrap with || 'TBD')
// _formatEmailDateRange → formatDateRange (which has its own TBD handling)

// ============================================================================
// ENVIRONMENT EMAIL GATE
// ============================================================================
//
// WHY THIS EXISTS
// ---------------
// Nothing was preventing the sandbox from emailing real people. The only
// suppression was _isTestSubmitter(), which checks whether the ACTIVE USER has
// Suppress_Emails=TRUE in the Test_Submitters sheet — a per-tester opt-in,
// keyed on the sender, not gated on the environment at all.
//
// @clolry confirmed Test_Submitters is EMPTY. So every sandbox submission has
// been sending real notifications, and any Sector Director or BU Reviewer that
// HC resolved received them. That is pre-existing inherited behavior, not
// something introduced by recent work, and it is why he declined to supply real
// approver addresses for the routing work.
//
// HOW IT WORKS
// ------------
// Outside production, every recipient is replaced with ONE safe address and the
// intended recipients are listed at the top of the body. Nothing is silently
// dropped: a redirected email still arrives, so a tester can confirm content
// and routing without anyone else being notified.
//
// FAIL CLOSED. If the environment cannot be determined, or no safe address can
// be resolved, the send is BLOCKED rather than allowed through. The cost of a
// blocked test email is a confusing log line; the cost of a wrongly-allowed one
// is a real person receiving a fabricated travel notification.
//
// Mirrors the FAS_TRACKER_TARGET gate in 00_config/TripConfig.js: the
// production decision is made in exactly one place and a non-production project
// cannot reach the real destination even if the properties are misconfigured.

/**
 * Where a non-production email should actually go.
 *
 * Precedence:
 *   1. TEST_EMAIL_REDIRECT Script Property, if set
 *   2. the active user's own address
 *
 * Returns null when neither is available, which blocks the send.
 *
 * @returns {string|null}
 */
function _getTestEmailRedirect() {
  try {
    var configured = PropertiesService.getScriptProperties()
      .getProperty('TEST_EMAIL_REDIRECT');
    if (configured && String(configured).trim()) return String(configured).trim();
  } catch (e) {
    console.warn('_getTestEmailRedirect: property read failed: ' + e.message);
  }
  try {
    // Falling back to the active user means a developer testing in sandbox
    // gets their own mail with no configuration at all. In a TRIGGER context
    // there is no active user, which is why this can return null.
    var active = Session.getActiveUser().getEmail();
    if (active && String(active).trim()) return String(active).trim();
  } catch (e) {
    console.warn('_getTestEmailRedirect: no active user: ' + e.message);
  }
  return null;
}

/**
 * Applies the environment gate to one outgoing email.
 *
 * In production this is a pass-through. Outside production it rewrites the
 * recipients and prepends a banner naming the intended ones.
 *
 * @param {Object} options as passed to sendTravelEmail
 * @returns {Object} { to, cc, bcc, subject, body, htmlBody,
 *                     redirected, originalTo, blocked, reason }
 */
function _resolveEmailRecipients(options) {
  var isProduction;
  try {
    // LETS_IS_PRODUCTION is a module-level const computed at file-evaluation
    // time in 00_config/TripConfig.js.
    isProduction = (typeof LETS_IS_PRODUCTION !== 'undefined') ? LETS_IS_PRODUCTION : null;
  } catch (e) {
    isProduction = null;
  }

  // Fail closed. An unknown environment must not be treated as production.
  if (isProduction === null || isProduction === undefined) {
    return {
      blocked: true,
      reason: 'the environment could not be determined (00_config/TripConfig.js ' +
        'did not load), so LETS cannot tell whether this email is safe to send'
    };
  }

  if (isProduction === true) {
    return {
      to: options.to,
      cc: options.cc,
      bcc: options.bcc,
      subject: options.subject,
      body: options.body,
      htmlBody: options.htmlBody,
      redirected: false,
      originalTo: options.to,
      blocked: false
    };
  }

  var redirect = _getTestEmailRedirect();
  if (!redirect) {
    return {
      blocked: true,
      reason: 'this is a non-production environment and no safe recipient could ' +
        'be resolved. Set the TEST_EMAIL_REDIRECT Script Property (a trigger ' +
        'has no active user to fall back to)'
    };
  }

  var intended = [];
  if (options.to) intended.push('To: ' + options.to);
  if (options.cc) intended.push('Cc: ' + options.cc);
  if (options.bcc) intended.push('Bcc: ' + options.bcc);
  var intendedText = intended.length ? intended.join('\n') : 'To: (none specified)';

  var envLabel = (typeof LETS_ENV !== 'undefined') ? LETS_ENV : 'non-production';

  // The subject is prefixed so a redirected email is unmistakable in an inbox
  // even before it is opened.
  var subject = '[' + String(envLabel).toUpperCase() + ' TEST] ' + options.subject;

  var banner =
    '*** ' + String(envLabel).toUpperCase() + ' ENVIRONMENT — NOT SENT TO THE REAL RECIPIENTS ***\n\n' +
    'This message was redirected to you because LETS is not running in\n' +
    'production. In production it would have been sent to:\n\n' +
    intendedText + '\n\n' +
    '----------------------------------------------------------------------\n\n';

  var htmlBanner =
    '<div style="border:2px solid #92400e;background:#fef3c7;color:#92400e;' +
    'padding:12px;margin-bottom:16px;font-family:sans-serif;font-size:13px;">' +
    '<strong>' + _escapeForEmailBanner(String(envLabel).toUpperCase()) +
    ' ENVIRONMENT — NOT SENT TO THE REAL RECIPIENTS</strong><br><br>' +
    'This message was redirected to you because LETS is not running in ' +
    'production. In production it would have been sent to:<br><br>' +
    '<code>' + _escapeForEmailBanner(intendedText).replace(/\n/g, '<br>') + '</code>' +
    '</div>';

  return {
    // Cc and bcc are DROPPED, not redirected. Copying them to the same
    // address would send the tester duplicates of every message.
    to: redirect,
    cc: '',
    bcc: '',
    subject: subject,
    body: banner + (options.body || ''),
    htmlBody: options.htmlBody ? (htmlBanner + options.htmlBody) : undefined,
    redirected: true,
    originalTo: options.to,
    blocked: false
  };
}

/** Minimal escaping for text interpolated into the HTML banner. */
function _escapeForEmailBanner(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Reports how email is currently being routed, without sending anything.
 *
 * @returns {Object} { environment, isProduction, willRedirect, redirectTo,
 *                     blocked, reason }
 * @server
 */
function getEmailRoutingStatus() {
  var probe = _resolveEmailRecipients({
    to: 'intended@example.gov',
    subject: 'probe',
    body: 'probe'
  });
  return {
    environment: (typeof LETS_ENV !== 'undefined') ? LETS_ENV : 'unknown',
    isProduction: (typeof LETS_IS_PRODUCTION !== 'undefined') ? LETS_IS_PRODUCTION : null,
    willRedirect: probe.redirected === true,
    redirectTo: probe.redirected ? probe.to : null,
    blocked: probe.blocked === true,
    reason: probe.reason || null,
    testSubmitterSuppression: _isTestSubmitter()
  };
}

// ============================================================================
// CORE EMAIL FUNCTION
// ============================================================================

/**
 * Send an email from the travel system
 * Uses GmailApp with send-as alias for {{contactEmail}}
 *
 * IMPORTANT: {{contactEmail}} must be configured as a send-as alias
 * in the Gmail settings of users who send travel request emails.
 *
 * @param {Object} options Email options
 * @param {string} options.to - Recipient email address(es), comma-separated
 * @param {string} options.subject - Email subject
 * @param {string} options.body - Plain text body
 * @param {string} [options.htmlBody] - HTML body (optional)
 * @param {string} [options.cc] - CC recipients (optional)
 * @param {string} [options.bcc] - BCC recipients (optional)
 * @returns {Object} Result with success status
 */
function sendTravelEmail(options) {
  try {
    if (!options.to || !options.subject || !options.body) {
      throw new Error('Missing required email parameters: to, subject, body');
    }

    // Test-mode bypass: if the active user has Suppress_Emails=TRUE in the
    // Test_Submitters sheet, drop the email entirely. Lets a tester
    // submit, review, deny, etc. without flooding real inboxes.
    //
    // NOTE: this checks the SENDER, not the recipients, and is not gated on
    // the environment. It is a per-tester opt-in, which is why the
    // environment redirect below exists as well — Test_Submitters was empty
    // in sandbox, so every notification was reaching real mailboxes.
    if (_isTestSubmitter()) {
      console.log('sendTravelEmail: active user is a test submitter, skipping send (subject="' + options.subject + '")');
      return { success: true, suppressed: true, reason: 'test-submitter' };
    }

    const senderEmail = getTravelEmailAddress();
    const senderName = getTravelEmailName();

    // Last-chance token expansion. _buildEmailTemplate handles the HTML body,
    // but subjects and plain-text bodies are assembled at each call site — and
    // 40 of those each remembering to expand is a guarantee that one will not.
    options = Object.assign({}, options, {
      subject: _expandBrandTokens(options.subject),
      body: _expandBrandTokens(options.body),
      htmlBody: _expandBrandTokens(options.htmlBody)
    });

    // Environment gate. Outside production, every recipient is replaced with
    // a single safe address and the intended ones are listed in the body.
    const routed = _resolveEmailRecipients(options);
    if (routed.blocked) {
      console.warn('sendTravelEmail: BLOCKED — ' + routed.reason +
        ' (subject="' + options.subject + '")');
      return { success: false, blocked: true, reason: routed.reason };
    }

    // Try GmailApp first (supports send-as alias)
    try {
      GmailApp.sendEmail(routed.to, routed.subject, routed.body, {
        name: senderName,
        from: senderEmail,
        replyTo: senderEmail,
        htmlBody: routed.htmlBody,
        cc: routed.cc,
        bcc: routed.bcc
      });

      console.log(`Email sent via GmailApp to ${routed.to} from ${senderEmail}` +
        (routed.redirected ? ' [REDIRECTED from: ' + routed.originalTo + ']' : ''));
      return {
        success: true,
        method: 'GmailApp',
        redirected: routed.redirected,
        originalTo: routed.originalTo
      };

    } catch (gmailAppError) {
      console.warn('GmailApp failed, trying MailApp fallback:', gmailAppError.message);

      // Fallback to MailApp (sends with reply-to only)
      MailApp.sendEmail({
        to: routed.to,
        subject: routed.subject,
        body: routed.body,
        name: senderName,
        replyTo: senderEmail,
        htmlBody: routed.htmlBody,
        cc: routed.cc,
        bcc: routed.bcc
      });

      console.log(`Email sent via MailApp to ${routed.to} (fallback - reply-to: ${senderEmail})` +
        (routed.redirected ? ' [REDIRECTED from: ' + routed.originalTo + ']' : ''));
      return {
        success: true,
        method: 'MailApp',
        fallback: true,
        redirected: routed.redirected,
        originalTo: routed.originalTo
      };
    }

  } catch (error) {
    console.error('Failed to send email:', error);
    logError('sendTravelEmail', error, { to: options && options.to, subject: options && options.subject });
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// HTML EMAIL TEMPLATE SYSTEM
// ============================================================================

/**
 * Workflow stages for the progress tracker
 */
// Full workflow: Supervisor → SCD → DAC → FO → FAS (overhead travel)
// Stage LABELS are resolved at call time from branding properties, not frozen
// at file-evaluation time. The inherited labels were 'SD', 'BU' and 'AAS FO';
// this organization calls them SCD (Service Center Director), DAC (Deputy
// Assistant Commissioner) and the ASD Travel & Events team.
//
// The stage IDs are unchanged — they are internal identifiers that STAGE_MAP
// and the progress tracker key off, and renaming them would be churn with no
// user-visible benefit.
function _stageLabel(id) {
  switch (id) {
    case 'submitted': return 'Submitted';
    // NOT a branding property. SCD and DAC are this organization's names for
    // roles the inherited code called SD and BU, so those are configurable.
    // 'Supervisor' is the generic word for the relationship itself — every
    // workgroup that adopts this has supervisors, and making it configurable
    // would invite somebody to rename it to something their own staff do not
    // use.
    case 'supervisor_review': return 'Supervisor';
    case 'sector_review': return getReviewLabelSector();
    case 'bu_review': return getReviewLabelBU();
    case 'oso_review': return getOrgFOLabel();
    case 'fas_submission': return 'FAS';
    default: return id;
  }
}

function _stages(ids) {
  return ids.map(function (id) { return { id: id, label: _stageLabel(id) }; });
}

// Full: Supervisor → SCD → DAC → ASD Travel & Events → FAS
//
// THE SUPERVISOR STAGE IS SHOWN TO EVERY SUBMITTER, including the ones who
// skip it. @clolry: every employee now submits their own request and it routes
// through their supervisor first.
//
// A progress tracker that omitted the stage for a director would be
// technically accurate and practically confusing: two people comparing their
// emails would see different chains for the same process. The tracker already
// greys out stages that are not current, so a skipped stage reads as
// "not needed for mine" rather than as a missing step.
//
// THAT IS A JUDGMENT ABOUT A PICTURE, NOT ABOUT ROUTING. The chain a request
// actually walks is decided by determineInitialRouting, and nothing here
// affects it.
function getWorkflowStagesFull() {
  return _stages(['submitted', 'supervisor_review', 'sector_review',
                  'bu_review', 'oso_review', 'fas_submission']);
}

// No SCD (DAC-level submitter)
function getWorkflowStagesNoSector() {
  return _stages(['submitted', 'supervisor_review', 'bu_review',
                  'oso_review', 'fas_submission']);
}

// No FAS (client-paid travel)
function getWorkflowStagesNoFas() {
  return _stages(['submitted', 'supervisor_review', 'sector_review',
                  'bu_review', 'oso_review']);
}

// Neither (client-paid, DAC-level submitter)
function getWorkflowStagesMinimal() {
  return _stages(['submitted', 'supervisor_review', 'bu_review', 'oso_review']);
}

// ============================================================================
// EMAIL CONTENT CONFIGURATION
// ============================================================================

/**
 * Centralized email content configuration
 * This structure enables future admin editing without code changes
 */
// Branding resolved once per execution. The getters read Script Properties,
// and this file interpolates them into dozens of templates — caching avoids a
// property read per string while keeping a single source of truth.
//
// Deliberately a FUNCTION, not a const: EMAIL_CONTENT is evaluated at file
// load, and reading properties then would run before TripConfig.js has
// necessarily loaded.
var _brandCache = null;
function _brand() {
  if (_brandCache) return _brandCache;
  _brandCache = {
    app: getAppName(),
    orgShort: getOrgShortName(),
    orgLong: getOrgLongName(),
    orgService: getOrgServiceName(),
    agency: getAgencyName(),
    contact: getEmailFromAddress(),
    sender: getEmailFromName()
  };
  return _brandCache;
}

const EMAIL_CONTENT = {
  // Global settings used across all emails.
  //
  // These were hardcoded '{{appName}}' and {{contactEmail}}. The app was
  // inherited from another workgroup, and @clolry wants a redeploy for a
  // different group to be a configuration change rather than a code change —
  // so each is a getter rather than a literal.
  global: {
    get senderName() { return _brand().sender; },
    get contactEmail() { return _brand().contact; },
    get systemName() { return _brand().app; },
    get footerText() {
      return 'This is an automated notification from the ' + _brand().app + ' system.';
    },
    get orgLine() {
      // Agency then SERVICE, not agency then office. @clolry: it "should say
      // FEDERAL ACQUISITION SERVICE rather than ASSISTED ACQUISITION
      // SERVICES" — and ASD, the office, would have been a third wrong
      // answer. A footer names the level the reader recognizes.
      return _brand().agency + ' \u2022 ' + _brand().orgService;
    }
  },

  // Submission confirmation to submitter
  submitterConfirmation: {
    subject: '{{appName}} Request {{requestId}} Has Been Submitted',
    title: 'Request Submitted',
    intro: '{{submitterName}},<br><br>Your {{appName}} request has been submitted and is now pending review by <strong>{{reviewerName}}</strong>. You will receive notifications as your request progresses.',
    ctaText: 'Open {{appName}} Request',
    noActionText: 'No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.',
    contactText: 'If you have questions in the meantime, please contact <a href="mailto:{{contactEmail}}" style="color: #2563EB; text-decoration: none;">{{contactEmail}}</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Review notification to reviewer (new request)
  reviewerNotification: {
    subject: '{{appName}} Request {{requestId}} - New Mission-Critical Travel Request Ready for Review',
    title: 'Review Required',
    intro: '{{reviewerName}},<br><br>A new mission-critical travel request has been submitted and requires your review. Please review the request at your earliest convenience and take the appropriate action in {{appName}}.',
    contactText: 'If you have any questions, please contact <strong>{{submitterName}}</strong> directly.',
    ctaText: 'Review {{appName}} Request',
    labels: {
      event: 'Event',
      submittedBy: 'Submitted By',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Resubmission notification to reviewer (after Needs Info)
  resubmissionNotification: {
    subject: '{{appName}} Request {{requestId}} - Revised Mission-Critical Travel Request Resubmitted for Review',
    title: 'Request Resubmitted',
    intro: '{{reviewerName}},<br><br>A previously submitted mission-critical travel request has been revised and now requires your review. Please review the request at your earliest convenience and take the appropriate action in {{appName}}.',
    contactText: 'If you have any questions, please contact <strong>{{submitterName}}</strong> directly.',
    ctaText: 'Review {{appName}} Request',
    labels: {
      event: 'Event',
      submittedBy: 'Submitted By',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Reviewer approval confirmation (sent to reviewer after they approve)
  reviewerApprovalConfirmation: {
    subject: '{{appName}} Request {{requestId}} - Approved and Advancing to {{nextReviewerName}} for Review',
    title: 'Approval Confirmed',
    intro: '{{reviewerName}},<br><br>This message confirms that the travel request you approved has successfully advanced to <strong>{{nextReviewerName}}</strong> for review. No further action is required from you at this time.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Needs more information notification to submitter
  needsInfoNotification: {
    subject: '{{appName}} Request {{requestId}} - Additional Information Required',
    title: 'Additional Information Required',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed by <strong>{{reviewerName}}</strong>, and additional information is required before the review can be completed.',
    ctaText: 'Update {{appName}} Request',
    feedbackTitle: 'Reviewer Feedback',
    nextStepsText: 'Please review the comments above and provide the requested information by updating your submission in {{appName}}. Once updated, the request will resume routing.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Approval notification to submitter (stage advancement)
  approvalNotification: {
    subject: '{{appName}} Request {{requestId}} Approved by {{approverName}} - Advancing to {{nextReviewerName}} for Review',
    subjectFinal: '{{appName}} Request {{requestId}} Approved by {{approverName}} - Request Complete',
    title: 'Approved by {{stage}}',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed and approved by <strong>{{approverName}}</strong> and is now advancing to <strong>{{nextReviewerName}}</strong> for review.',
    introFinal: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed and approved by <strong>{{approverName}}</strong>. Your request is now complete!',
    noActionText: 'No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.',
    contactText: 'If you have questions in the meantime, please contact <a href="mailto:{{contactEmail}}" style="color: #2563EB; text-decoration: none;">{{contactEmail}}</a>.',
    ctaText: 'Open {{appName}} Request',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    },
    stageNames: {
      // Spelled out rather than abbreviated. 'SD' and 'BU' are internal
      // shorthand that a submitter has no way to decode, and an email saying
      // "SUP Review Approved" would read as a typo. The abbreviations below
      // are pre-existing and left alone; a new stage does not need to inherit
      // a convention that was already a problem.
      Supervisor: 'Supervisor',
      Sector: 'SD',
      BU: 'BU',
      OSO: '{{foLabel}}',
      FAS: 'FAS'
    }
  },

  // Advancing to FAS notification (overhead travel approved at FO)
  advancingToFas: {
    subject: '{{appName}} Request {{requestId}} Approved by {{foReviewerName}} - Advancing to FAS for Review',
    title: 'Advancing to FAS',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed and approved by {{orgShort}} Chief of Staff <strong>{{foReviewerName}}</strong> and is now advancing to the FAS Front Office for review.',
    noActionText: 'No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.',
    contactText: 'If you have questions in the meantime, please contact <a href="mailto:{{contactEmail}}" style="color: #2563EB; text-decoration: none;">{{contactEmail}}</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // FAS approval notification (overhead travel approved by FAS)
  fasApproval: {
    subject: '{{appName}} Request {{requestId}} - Proceed with Booking Travel',
    title: 'Ready to Book',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has completed the full review process and has been approved by the FAS Front Office.',
    bookingInstructions: 'You may now proceed with making travel arrangements in <a href="https://go.gov" style="color: #2563EB; text-decoration: none;">GO.gov</a> in accordance with applicable policies and procedures.',
    contactText: 'If you have any further questions regarding this request, please contact <a href="mailto:{{contactEmail}}" style="color: #2563EB; text-decoration: none;">{{contactEmail}}</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Proceed with booking notification (client-paid travel approved at FO)
  proceedWithBooking: {
    subject: '{{appName}} Request {{requestId}} - Proceed with Booking Travel',
    title: 'Ready to Book',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed and approved by {{orgShort}} Chief of Staff <strong>{{foReviewerName}}</strong>.',
    bookingInstructions: 'You may now proceed with making travel arrangements in <a href="https://go.gov" style="color: #2563EB; text-decoration: none;">GO.gov</a> in accordance with applicable policies and procedures.',
    contactText: 'If you have any further questions regarding this request, please contact <strong>{{buReviewerName}}</strong> directly. Questions regarding GO.gov may be referred to <a href="mailto:{{contactEmail}}" style="color: #2563EB; text-decoration: none;">{{contactEmail}}</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Denial notification to submitter
  denialNotification: {
    subject: '{{appName}} Request {{requestId}} - Denied by {{reviewerName}}',
    title: 'Request Denied',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed by <strong>{{reviewerName}}</strong> and was not approved.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    },
    reasonTitle: 'Reason for Denial',
    conclusionText: 'This decision concludes the routing process for this request. No further action will be taken at this time.',
    contactText: 'If you have questions regarding this decision, please contact <strong>{{reviewerName}}</strong> directly.'
  },

  // Cancellation notification to submitter
  cancellationNotification: {
    subject: '{{appName}} Request {{requestId}} - Canceled by {{reviewerName}}',
    title: 'Request Canceled',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has been canceled by <strong>{{reviewerName}}</strong> and will no longer move forward in the routing process.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    },
    reasonTitle: 'Reason for Cancellation',
    conclusionText: 'This cancellation reflects an internal determination that the travel will not proceed at this time. No further action is required.',
    contactText: 'If you have questions regarding this cancellation, please contact <strong>{{reviewerName}}</strong> directly.'
  },

  // DD confirmation email (initial)
  ddConfirmation: {
    subject: '{{appName}} Request {{requestId}} - Please Review and Confirm Travel Details in {{appName}}',
    title: 'Confirmation Required',
    intro: '{{ddName}},<br><br>The staff listed below have been approved to participate in mission-critical travel. After reviewing their Request(s) in <a href="https://go.gov" style="color: #2563EB; text-decoration: none;">GO.gov</a>, please review and confirm travel details for your staff in {{appName}}.',
    ctaText: 'Confirm in {{appName}}',
    contactText: '<strong>Your approval in {{appName}} certifies that you have reviewed the Request in GO.gov and verified that the correct line of accounting has been selected for the trip.</strong> Once confirmed, the travel request will be closed out. If you have any questions or require further clarification, please contact <a href="mailto:{{contactEmail}}" style="color: #2563EB; text-decoration: none;">{{contactEmail}}</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Staff Requiring Confirmation'
    }
  },

  // DD re-confirmation email (after correction)
  ddReconfirmation: {
    subject: '{{appName}} Request {{requestId}} - Please Review and Re-confirm Travel Details in {{appName}}',
    title: 'Re-confirmation Required',
    intro: '{{ddName}},<br><br>The funding information for the staff listed below has been updated. Please review the updated Request(s) in <a href="https://go.gov" style="color: #2563EB; text-decoration: none;">GO.gov</a> and re-confirm travel details for your staff in {{appName}}.',
    ctaText: 'Re-confirm in {{appName}}',
    contactText: '<strong>Your approval in {{appName}} certifies that you have reviewed the updated Request in GO.gov and verified that the correct line of accounting has been selected for the trip.</strong> Once confirmed, the travel request will be closed out. If you have any questions or require further clarification, please contact <a href="mailto:{{contactEmail}}" style="color: #2563EB; text-decoration: none;">{{contactEmail}}</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Updated Staff'
    }
  },

  // DD funding issue notification to submitter
  ddFundingIssue: {
    subject: '{{appName}} Request {{requestId}} - Funding Correction Required',
    title: 'Funding Correction Required',
    intro: '{{submitterName}},<br><br><strong>{{ddName}}</strong> has flagged a funding discrepancy for the attendee(s) listed below. Please review and update the funding information in {{appName}}, then resubmit for confirmation.',
    issueTitle: 'Issue Details',
    flaggedTitle: 'Attendee(s) Requiring Update',
    ctaText: 'Update Funding',
    contactText: 'If you have questions about this funding issue, please contact <strong>{{ddName}}</strong> directly.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  }
};

// ============================================================================
// LOGO CONFIGURATION
// ============================================================================

/**
 * ASD logo for the email header - base64-encoded PNG.
 *
 * 480x160, transparent background, ink #064C9A. Rendered at 240 px wide by
 * _buildAASLogo, so this is the 2x asset a retina client needs.
 *
 * WHY THIS IS EMBEDDED RATHER THAN LINKED
 * ---------------------------------------
 * Mail clients block remote images by default, and a Drive-hosted logo also
 * leaks a read on every open. A data URI renders offline and discloses
 * nothing. The cost is that the payload sits in source: this one is ~7 KB of
 * base64, down from the 33 KB inherited asset it replaced.
 *
 * TO UPDATE THE LOGO:
 * 1. Work from brand/ASD_mark_1002x636_blue_transparent.png - it is already
 *    keyed and recolored. Downscale with an AREA-AVERAGE filter, not
 *    nearest-neighbor, or the antialiased edges will fringe.
 * 2. Keep it at 2x the rendered size. 240 px displayed means 480 px here.
 * 3. Base64-encode the PNG and replace the string below.
 *
 * Leave empty ('') to fall back to the text logo in _buildAASLogo.
 *
 * The CI guard 'branding must stay configurable' pins the SHA-256 of the
 * inherited AAS asset and fails if it reappears - a logo regression is
 * otherwise invisible in review, because a diff of two base64 blobs is
 * unreadable. See brand/README.md for where else the mark is embedded.
 */
const TRAVEL_LOGO_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAeAAAACgCAYAAADU+79NAAAUiklEQVR42u2dC7BVVRnHQcQrYiIKKqbkGx3HB4aAiI9KzSdqYWYoYFaTPaw0NZ9NlkrCvQiiMxqaj9S08pFTqfl2fCRy703HmdBS85GIoHIRQS5iaznr2J7T3vvsvb5vv875/Wb+c+7jnL0e+5z1P2utb63Vpw8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkxjqHX7XKqLeBVjt9GPg5+HvU31eHXCNK9c9rlHaj6/SmSDvN9VYrXbdRmeLSiCpfkjL3KilpHhvdk96E9yzqtdL3Q5ryrm5wnU/uKS0LACQx4I8QQrqiZQEADBghDBgAMGCEMGAAAAwYIQwYADBghDBgAMCAEUIYMABgwAhhwACAASOEMGAAwIARwoABoDUMeLFRd0BddT8H1R2iv8eoO+a1Uderv25UXqJeH/yffeyMeF3tf50R/2uUTlzanRF/74qp3+6Y+kpSf0nqpDMmL/X1nUT2+c+E3O/OBve9K2E5454Xlv/ukHvaHZKvxRgwAJTBgC+l1qDFPiNzMGAAKIMBz6TWAAPGgAEAAwbI+jNyGQYMAGUw4A5qDVrsMzIbAwaAMhhwO7UGLfYZmYUBAwAGDJD/Z+RSDBgAymDADEEDPWAMGAAwYAAMGABaw4AZggYMGAMGAHrAABgwAFSzcVnDOmAADBgAyt8DxoCh1T4jREEDAAbcIvdkLaNBRjsbfdFoktHXjU4ymmw0wWi00TCjdYyoNAwYADBg8LwPg42ONZpr9JzRigT34kOjN4zuMTrbaJRRP2oTAwYADFiat12M/mb0tNH8kKPrOiM0P+aYudoxdPOMti247vsbHWZ0u9FyhXNo7Xz+S0YXGW2fQX5tb/uvgfrtqqvTrgRHOXZGHHMY/Lt9fNTVS4fRd4zGG21Q0H1iDhgAWs6Ap2Z8cPrEgup8baNj3BeLNRmVzfagr7dfMrSGqM111jVaVNAh97aelhjdaXSc0YZ5Db1jwADQigZ8ScaN+rkF1Pf2Rg/kaFzLjM63vVclA36zIAOu19tGlxtthQEDAAasn7e7Mm7Eb8yxLH2NphgtLciw7JDuZ5rIgGuyQ/c/N1ofAwaAZjfgjpzyZSOBF2TceNv5xr45lKWf0QUuaKpIs3rdaEyTGXBNNnBtTBbD0hxHCACtZsAbKQUmxeldo4E5fJGYneFcb1q9Y5cweZalzWhhSQ241hs+HgMGAAxYlq8xOQX27JBhGazOK5H51mSXLg1vsh5wTb1G31C+jwxBA0BLGfBJOTXYEzIswyFGq0tqVHZOuK0JDbhmwscoRn9jwADQUgY8K6fG+qyM8m831ni55EZ1SpMa8Ecu2G1HhqABAANOn6/7c2qob8oo/zMrYFJ2PnfDJjVgqyeUll9hwADQGgbsoobfyKmR7taOnLXLfdz62yqY1GkpDXhhhQz4I435YAwYAFrJgLfMccnOO9qR0OZ6F1bIoP5pI7WbtAds9aLNt/B+MgcMAC1jwIfm2EBbo99JMe92m8lXlPJmA7gecZHUx7rAotON7jVapVgHeyYsW5uCAS93veiFbpTjP+5xSYZfuqYK7ymHMQBAyxjwmTn3kiYq5n1fpTzZAw7GhW0U4nbVGukORdBI67wUBiwdgp7lrtPmDneoaYDbt/pEN/+vGT3+pGTDFXrAANBKBnxTzgb8M8W8a+xf/YzRxgnS2tjoWYX07ksyD640BN2RIB27ecnBRq8pjnKMwIABAANu3Pg+m7MB366Ud9szfUxh2HlUijT3Vtjo440ka4KVhqDbkwa92YMW3Byuxj3+EQYMAFU34PaM87NBARHEC5TybodRFwvz8qc0UdlKpm83rtg0px7wjJTlG6m0JentgvtKFDQAlMKAZ2Scn92Ehw34vO4Da54KeR+uEEh0oke6P1EwqM/mZcApy9bH9Zql5fu3UX8MGADoAUfn53jBzke/EjTQuyrkfR+Fval39kj3AAWDOiAnA273KN82Cl9sen2PY8SAAaBVesC+QUzzjL4vaKCPVcj7UUKTsD3xTTzS3VHBoI5OkE5bQQZs9XQeXzIwYABo5R7w3Z6N6w3CnuDPFPI+SWgQK+0xjB7pDlNYFzwpoQEvzHMIOpD2dAUD/iYGDAAYcHhe+ru5Op/G9Ryjrd1QYyGR0OYaXxMahDXRYR7pDnW9Z0naJ5TcgKfmtd45JO3LMGAAKIMBz8gwL5u7XqDXsYIuCtl3iHRB0i0ZY/I/UWEOeA+PdIe0gAFrzHPPwoABgB5weF7GCzZa2MHNFT7leY0VRoOE+T+4iGFStyHHSmG6U3Iy4HbPuh2nULfXeKbNEDQAlMKAOzLMy3c8G9ae2jIi83htlktxGuR/NwWTuDPt6UzOgFfkYMCFREG7tEcr1O2NnmmzEQcANL0BX+nZsM4PXOOMAjftH6rQE7Wv3yxluhu5zUt667TKqf5v9b/b4euv5mXAPsc/2gMjFAz4ZgwYADDg8Lw87hsBHbjGBEEDPU2YfxtE9rKCUVyYMl27fedmbg59WECbOg0L+V9N9nWbJNyKssgesIYB/9YzbU5DAoDmNWB3Is7bvhHQgeuMEDTQdwnLYHWHglHYIfXtSvheyeUwhoi0RynU6630gAGgygbcnlE+Rgg2kziyziSWel7nJYVI6FOU9qd+2H4paUIDnllgD/h3GDAA0AP+/3x8SRABvVPgOvZwgk5BJPRQYTl2UDxYfprPfCkGrN4DJgoaAJragH/q2ai+a7R+3bVuFjTSY4XlkMxlh60L/kaTGbDvEDQGDAAYcAZ5sLrNs1Htsr3euuudK2ikv6VQnimKRyWuSrJJRo4GvKjCQVjMAQNApQ14RgZ56Gf0gtbaTjsnLGikL1coz0CjVxRN+ANn6s1gwL47YRU5B0wUNACUwoCnZZAHyU5OZ4dcTzIP+6BSmU5RNGCr1Uan1vf2CzDgN1vQgOkBA0AmjepeRnsHNC6g8U725zGuEdwigzyMFzSqR4Rcb4CbG/a53iINk3Nm9YyyCa9xG1n0L+i9UvWdsHwNeOvAZ2Os0151n5Vx7m8f/4+WBQCq8iXgZIEhbRNxzXmCqOotFMpUO0DgQ2UTrm1XuX5BBryo1QwYAKCZDfgKzwZ1cW0P6JBrzs374PYIE74sAwO2eszn6MISGLDvEPToooKwAACa1Xz7ODPxaVCfjBouFs7B/lDZtB7OyIRfNNo9x3ulcRrSdAwYAKAcBrye0VueDercmOt+TtBQX6Vcxi3cLltZmLCd6z4ijwhpDBgAoLkMeAcX4evToP6ogemt8rzu49qGZq63i2Cv6yRrhU/O2oQZggYAaC4DlqzZPahBb+11z+u+qb0Psxtq318QnZ0kIO3SLCOkmyAI6xY+cQAA/2tYzxZEKw9vcO0HBWY2PKPy7me0JCMTtvqz0aAmNOAxRR1HCADQrAbsu2/zO416e+b/cwSN9WEZlnm0gpHF6QnpoRIxBvxWhQ2YHjAAgGtUrZ7zbEyfSnD9kwWN9ZkZl31nF8WclQk/F7VGWpDnAQoGzBwwAEAJDPhTRss9G9PrE1x/X0FjfX0O5beBYk9naMKvWqMvmQETBQ0AUAID3sPNt/o0pmckuP5mgkjo+Tkt7Rls9JcMTfg119vWMuDFFTZgdsICgFKZ4JA6DQ1oiDsooSb7+0DFtCcLGtNDElx/baOXPa//dtQuWxncg/7uzNk1GZmwjQYfgQF77wU9MOLzMTTk8/LxZ4aWBQCSNC4r6rQyoBUhmq6Y9nTPhrTXaNsE17e6VxBlvW2O92Eto++6Os7ChJ+Xbl1Z8BD0mAINeEbE52Nl1OeFlgUAkjQuuUSxRpjjPZ4N6ZKkvVPXsyxdJHRMnRyQ4TKlxyWHODSBAf/eM+3U+3nTsgBAmQ3YDru+4RsBnXRO0zzv24IG+9yC7omds12QkQlf7XvcYsE7YWkY8B88056DAQNAGQx4plK6nxYc1XdtinT2q9rGDa4nvInRQxkYsK3zqT5BWS1swPSAAaCpDPigPNbomudu7uaMfdLpLvjerCs8VjFuE5PPFGTARW7E4WvAszFgACiDAXcopXu6oCE9KkU6/QSm8b7dU7rg+2ODs34uGC2I0h322h4GXOWdsHzngGdhwABQBgPWmgO+UbBP83Yp03pKkNauJbhHfV2E9GrloeiDWsyAb/VM+1IMGACawoBdr+4ZwfrcQS6Iq17rONX//WZBo31cie6VXTf9gfKe0f1yNuAi54Bv8UwbAwaAUhhwh0KaGxr1CHql79dpecjfguoVNNoXlex+TRaWp74uD6yIAY8t6jQkDBgAymLAMxXSHJnh1ova+mPJ7ldtaZXWrll35GzAvuuAMWAAwIAV0pxSIQNekDZYKScTnqNUPruD05AUBryIHjAGDADVNeDpFTLgDyS7R6U11pS90b8plXFyijTfxIAxYACorgHfUyEDttojYbnsph9/NvqTe7SnHN0dob8EdLfbs/qalPU40vVgpeW7AQOOTZtlSABQfQN263JfrZgBT0pYtuOkw90eQ9FXKw2z90uQXqsaMBtxAEBTGPDmgjN6i9KFCct2fJ4G7NLcUWF9sO1Fb5TQgBcVFIQ1BgMGAAxYlt4XKma+VnfmZMDPe9RnX7eeV1rG3XMy4CJ7wDdhwABQZQPuEKZ3agUN+MUkkdDmOV8TpvOCZ53+QqGMByZIp8gh6H0UyjjXM20OYwCAUhhwuzC96ypowHaIdmgOBvwvzzr9qkIZJyZIp61AAz5CoYy+22BiwABQbQN2w6WdFTRgq71yMOCXPOt1vEL5TsipB+w7B/wDhTL+mCFoAGhVA17faFlFDfikBOU7VpjGojR7MwfS3VVhZ6zJCdIpMgjr2jx6+fSAAaBZDXhXQeNpI30fNrrf6EH3eK/TX53uc7q/7ucH3KOk99aRoHzSYdIVRoML6gEfnZMBX+JRPnt4x8sK+17vggEDQJkMeE2OBiyJEn7dnWzUR6DZgvTvSVC+PRVMYpRHvU5VMOC9y9oDVgrAetfoUxgwALSqAV8iaEAfUSjrd4VfABpdf0uFNbk/SVkmq18rnA28dRkN2G3corFz2pM2BsHzfcMcMABUfgj6PkEDOluhrJI1yPYIwE0bXH+A0WKFXan6pyjTYNe7k6S5xOa9jEPQdu5daQ7/YsH7BgMGgFIYcIdnOm2uF+nbgH5boaybu96ebx72b3B9G+X9qIJZnJXkYAY3N6qxFeWjCdMboGDAv0xxv77iznPWMOB9MWAAaFUD3kZ4kPz+CmVdW9hD/V6CNKYpncB0sht+jSvLBUrnAl+csP4GZN0DdkPqm9gd1xSG82t6zX4BFLxvmAMGgOoOQZvXHSVoQO3e0cOUyvuUIB9XZjzMXR+QdZ+LrB7sjMn2sIcYHWP0mOISq70T1p2GAd9s03NbS452gWvjjA6xX3Dsfs0KQ+r1miZ8z2DAAFBpA75A0IC+kmZetEE+JAFLjyUIxGpTMKmwHvFCt4xK+yCLfyVde+wM+K2Krd+2S7u2Eb5nOI4QAEphwL5bCd4uWQKU5rD6Bvk4XZCPxUm+CAijvfPWGSnqbt0MvlxkrWuk7x0MGAAq2wN2wUIvZLkJRoq8HCps0IcnSGNro+UVMCdrphunqLuq9YDfMdpK4T1DEBYAVLMH7IJqVma5DWSKvGwvDO45NGE6l1fAoL6fsu6qZsAnKb1nMGAAqKwB7ytsSMcqlnc9YST06Sm+dLxaYnN6NG1kcMWGoH+T5AhJDBgAqmTAPlsJfk8YAb2BYnmtnhbk57oUaR0kXHqVlezGG9t61F2bCwYru/k+ZDRQ8T2DAQNAZXvAcwWN6fO+WwjG5OcGQX7mJQ3qcWb/Q+HmH9qyc9MHeNabxnGEWcse1DFI+f2CAQNA9QzYrV2dJ2hQ79SKgA7k6UxhJPR6Kct/WgbLh3wPJDhYUG9lHoJe4yKe18vgM4IBA0D1hqBd4E6PoGG9KIMyHy5s6Lf3GPb+stHSAg3KrqX+rLDeBpTUgO2w+CTtkZJAuVmGBACV7AHvImxcj8+gzCOEWzge7Znujso7WCX9wnBHo4MkKmrA77tdqoZm/BnBgAGgFAbcnvL6JwjNY88MyryB0TJBvs4RpG3PNJ7idqDK2qDs/PlExWjgMswBf+jWlJ9vtIX29EREuRmCBoBKGnC7oLF9z2jDDMpsDzn4hyBfNyjkYaDRN43mKwdp2S8tXe4YvwHK9Za3Aa9xUeT/MbrXme5YrW1JMWAAaHYDHuUOFLDzroeF6PCA7PMmuEe7Y9X+Gc7rjYnIQy0fQdXyfqh7HK2YDxuktZPR2UaPePbMbYDXs24LzJEZ1tlarg6ODLlnEwJ1FVWPRwT+fnhEHdfqeT9XL4O1evCCcnMYAwCUwoA7qLXM7kVfNzw+2g3d2x7fFUa3GN3ldJvRtXYu3q2v/rzRZnFHF4L4vszBgAGgDAY8k1oDDBgDBgB6wAAYMABgwAAYMAYMABgwAAYMABgwQEU/I0RBAwAGDFDAZ4R1wACAAQNgwACAAQNgwBgwAORmwKwDBgwYAwYAesAAmX9GCMICgFIYcDu1BhgwBgwA+RswQ9DQap8R1gEDQCkMeJE7Qq+mTqfgz10J1Vkn+7dup66Q37tD1FX33L/H/D8u7c6Q/3VF5CPueVHlCctTo9eH1UlcvmvPi6vPrsD9qr+HnQnuV9Tr4vIVVi9xvye5H43uZVQe6/PflSCfb2HAAFAGA0YIYcAAgAEjhAEDAAaMEMKAAQADRggDBgAMGCEMGAAAA0YIAwYADBghDBgAMGCEEAYMABgwQhgwADSlAS816nGPQfXU/bysTu/VPdZ+fi/kecG/99Rdryfi9VHp99QpKt04hb0+LG/B/PVE/H9ZzP+TvjZK78VcK+65aeugp0HZg3Wc5L4sDXltXN7j0g9eL+p+xb22J+Vze2Lep43q7JO6oWUBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADIj/8CE6r0c31aULIAAAAASUVORK5CYII=';
 
/** 
 * Build the AAS logo for email header
 * @param {boolean} centered - Whether to center the logo (default: false for left-aligned)
 * @returns {string} HTML logo
 */
function _buildAASLogo(centered = false) {
  const alignment = centered ? 'center' : 'left';
  const margin = centered ? '0 auto 20px' : '0 0 16px 0';

  // Option 1: Use base64 encoded image if configured
  if (TRAVEL_LOGO_BASE64 && TRAVEL_LOGO_BASE64.length > 0) {
    return `
      <div style="text-align: ${alignment}; margin: ${margin};">
        <img src="data:image/png;base64,${TRAVEL_LOGO_BASE64}" alt="${_brand().app}" style="max-width: 240px; height: auto; display: block; margin: ${centered ? '0 auto' : '0'};" />
      </div>
    `;
  }

  // Option 2: Check for Google Drive hosted image (from Properties Service)
  const driveFileId = getTravelLogoDriveFileId();
  if (driveFileId) {
    const imageUrl = `https://drive.google.com/uc?export=view&id=${driveFileId}`;
    return `
      <div style="text-align: ${alignment}; margin: ${margin};">
        <img src="${imageUrl}" alt="${_brand().app}" style="max-width: 200px; height: auto; display: block; margin: ${centered ? '0 auto' : '0'};" />
      </div>
    `;
  }

  // Option 3: Fallback to HTML text logo
  return `
    <div style="text-align: ${alignment}; margin: ${margin};">
      <!-- AAS lettermark -->
      <div style="margin: 0 0 4px;">
        <span style="display: inline-block; font-family: Arial, sans-serif; font-size: 28px; font-weight: bold; color: #1F2937; letter-spacing: 4px;">
          AAS
        </span>
      </div>
      <!-- app brand -->
      <div style="margin: 0 0 4px;">
        <span style="font-family: Arial, sans-serif; font-size: 36px; font-weight: bold; color: #004f87; letter-spacing: 3px; text-transform: uppercase;">
          ${_brand().app}
        </span>
      </div>
      <!-- Tagline -->
      <div>
        <span style="font-family: Arial, sans-serif; font-size: 10px; font-weight: normal; color: #6B7280; letter-spacing: 1.5px; text-transform: uppercase;">
          Travel Request, Intake &amp; Processing
        </span>
      </div>
    </div>
  `;
}

/**
 * Helper function to set the logo configuration
 * Run this from Apps Script editor to configure your logo
 *
 * @param {string} method - 'drive' or 'base64'
 * @param {string} value - Drive file ID or base64 string
 */
function _setTravelLogo(method, value) {
  if (method === 'drive') {
    setTravelLogoDriveFileId(value);
    console.log('Logo set to Google Drive file ID:', value);
    console.log('Image URL:', `https://drive.google.com/uc?export=view&id=${value}`);
  } else if (method === 'base64') {
    setTravelLogoBase64(value);
    console.log('Logo set to base64 encoded image');
    console.log('Image size:', Math.round(value.length / 1024), 'KB');
  } else {
    console.error('Invalid method. Use "drive" or "base64"');
    return { success: false };
  }

  return { success: true };
}

/**
 * Clear the logo configuration (will use fallback text logo)
 */
function _clearTravelLogo() {
  deleteTravelLogoProps();
  console.log('Logo configuration cleared. Will use fallback text logo.');
  return { success: true };
}

/**
 * Build the progress tracker HTML - Gmail-optimized simple design
 * @param {string} currentStage - Current stage ID ('submitted', 'bu_review', 'oso_review', 'fas_submission')
 * @param {string} status - Status within stage ('pending', 'approved', 'denied', 'needs_info')
 * @returns {string} HTML for progress tracker
 */
/**
 * Renders the stage dots.
 *
 * THE BUG THIS FIXES
 * ------------------
 * @clolry's submission confirmation showed green checkmarks against Submitted,
 * SD, BU and AAS FO, with only FAS pending — on a request that had just been
 * created and reviewed by nobody.
 *
 * Cause: sendSubmitterConfirmation passed currentStage = STAGE_MAP[reviewLevel],
 * and a request routed to FAS resolves to 'fas_submission' — index 4 of 5.
 * Everything before the current index was then marked COMPLETE.
 *
 * The tracker was showing POSITION IN THE SEQUENCE and reading as WORK DONE.
 *
 * Two separate wrongs, now both addressed:
 *
 *   1. On submission the request is at the START. The confirmation passes
 *      'submitted' so the first dot is current and nothing is complete.
 *
 *   2. Earlier stages are only "complete" if they were VISITED. A request that
 *      skipped SCD because the submitter is DAC-level did not complete SCD
 *      review — it bypassed it. Those render as skipped (gray, dashed) rather
 *      than as approved, because the four workflow variants mean "skipped" and
 *      "completed" are genuinely different states.
 *
 * @param {string} currentStage stage id the request is AT
 * @param {string} [status]
 * @param {Array} [stages]
 * @param {Array<string>} [completedStages] stage ids actually visited. When
 *        omitted, every stage before the current one is assumed visited —
 *        correct for a request moving linearly, and the only safe default for
 *        the many call sites that cannot know the history.
 */
function _buildProgressTracker(currentStage, status = 'pending', stages = getWorkflowStagesFull(), completedStages = null) {
  const stageIndex = stages.findIndex(s => s.id === currentStage);

  // Build the dots row - compact design with smaller dots
  const dotsRow = stages.map((stage, index) => {
    let bgColor = '#E5E7EB';
    let textColor = '#9CA3AF';
    let icon = '';
    let dotSize = '20px'; // Smaller base size

    // A stage before the current one is COMPLETE only if it was visited.
    // Without an explicit list, assume linear progress — but never claim
    // completion for a stage the request has not reached.
    const wasVisited = completedStages
      ? completedStages.indexOf(stage.id) !== -1
      : index < stageIndex;

    if (index < stageIndex && wasVisited) {
      // Completed
      bgColor = '#10B981';
      textColor = '#FFFFFF';
      icon = '✓';
    } else if (index < stageIndex && !wasVisited) {
      // Skipped by this request's workflow variant. Not an approval.
      bgColor = '#F3F4F6';
      textColor = '#9CA3AF';
      icon = '–';
    } else if (index === stageIndex) {
      // Current
      dotSize = '24px'; // Current stage slightly larger
      if (status === 'denied') {
        bgColor = '#EF4444';
        textColor = '#FFFFFF';
        icon = '✕';
      } else if (status === 'cancelled') {
        bgColor = '#6B7280';
        textColor = '#FFFFFF';
        icon = '⊘';
      } else if (status === 'needs_info') {
        bgColor = '#F59E0B';
        textColor = '#FFFFFF';
        icon = '!';
      } else if (status === 'complete') {
        // Complete status shows current stage as green checkmark
        bgColor = '#10B981';
        textColor = '#FFFFFF';
        icon = '✓';
      } else {
        bgColor = '#3B82F6';
        textColor = '#FFFFFF';
        icon = '●';
      }
    } else {
      // Upcoming
      icon = '○';
      textColor = '#D1D5DB';
    }

    // Connection line
    const showLineBefore = index > 0;
    const showLineAfter = index < stages.length - 1;
    const lineBgBefore = index <= stageIndex && index > 0 ? (index - 1 < stageIndex ? '#10B981' : bgColor) : '#E5E7EB';
    const lineBgAfter = index < stageIndex ? '#10B981' : '#E5E7EB';

    return `
      <td align="center" valign="middle" style="padding: 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td align="right" valign="middle" width="40%" style="padding: 0;">
              ${showLineBefore ? `<div style="height: 3px; background: ${lineBgBefore}; width: 100%;"></div>` : ''}
            </td>
            <td align="center" valign="middle" style="padding: 0 4px;">
              <div style="width: ${dotSize}; height: ${dotSize}; background: ${bgColor}; border-radius: 50%; color: ${textColor}; font-size: 14px; font-weight: bold; line-height: ${dotSize}; text-align: center;">
                ${icon}
              </div>
            </td>
            <td align="left" valign="middle" width="40%" style="padding: 0;">
              ${showLineAfter ? `<div style="height: 3px; background: ${lineBgAfter}; width: 100%;"></div>` : ''}
            </td>
          </tr>
        </table>
      </td>
    `;
  }).join('');

  // Build the labels row
  const labelsRow = stages.map((stage, index) => {
    let labelColor = '#9CA3AF';
    let labelWeight = '500';

    if (index < stageIndex) {
      labelColor = '#047857';
      labelWeight = '600';
    } else if (index === stageIndex) {
      labelWeight = '700';
      if (status === 'denied') {
        labelColor = '#991B1B';
      } else if (status === 'cancelled') {
        labelColor = '#4B5563';
      } else if (status === 'needs_info') {
        labelColor = '#B45309';
      } else if (status === 'complete') {
        labelColor = '#047857';
      } else {
        labelColor = '#1E3A8A';
      }
    }

    return `
      <td align="center" style="padding: 6px 4px 0; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 10px; font-weight: ${labelWeight}; color: ${labelColor}; text-transform: uppercase; letter-spacing: 0.03em; line-height: 1.2;">
        ${stage.label}
      </td>
    `;
  }).join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 580px; margin: 0 auto;">
      <tr>${dotsRow}</tr>
      <tr>${labelsRow}</tr>
    </table>
  `;
}

/**
 * Build the base HTML email template
 * @param {Object} options Template options
 * @param {string} options.title - Hero title
 * @param {string} options.subtitle - Hero subtitle (optional)
 * @param {string} options.currentStage - Current workflow stage
 * @param {string} options.status - Status within stage
 * @param {string} options.content - Main content HTML
 * @param {string} options.ctaText - Call to action button text (optional)
 * @param {string} options.ctaUrl - Call to action URL (optional)
 * @returns {string} Complete HTML email
 */
/**
 * Expands brand tokens in any email string.
 *
 * Applied centrally in _buildEmailTemplate and to subjects/bodies at the send
 * sites, so a template author writes {{appName}} once and every caller gets
 * the substitution — rather than 40 call sites each remembering to do it.
 *
 * @param {string} text
 * @returns {string}
 */
function _expandBrandTokens(text) {
  if (!text) return text;
  var b = _brand();
  return String(text)
    .replace(/\{\{appName\}\}/g, b.app)
    .replace(/\{\{contactEmail\}\}/g, b.contact)
    .replace(/\{\{orgShort\}\}/g, b.orgShort)
    .replace(/\{\{orgLong\}\}/g, b.orgLong)
    .replace(/\{\{senderName\}\}/g, b.sender)
    .replace(/\{\{foLabel\}\}/g, getOrgFOLabel())
    .replace(/\{\{sectorLabel\}\}/g, getReviewLabelSector())
    .replace(/\{\{buLabel\}\}/g, getReviewLabelBU());
}

function _buildEmailTemplate(options) {
  const {
    title,
    subtitle = '',
    currentStage = 'submitted',
    status = 'pending',
    content,
    ctaText,
    ctaUrl,
    stages = getWorkflowStagesFull(),
    hideProgressTracker = false
  } = options;

  const logo = _buildAASLogo();
  const progressTracker = hideProgressTracker ? '' : _buildProgressTracker(currentStage, status, stages);

  // Expand brand tokens centrally, so a template writes {{appName}} once and
  // every caller gets the substitution rather than 40 call sites each
  // remembering to do it.
  const brandedTitle = _expandBrandTokens(title);
  const brandedSubtitle = _expandBrandTokens(subtitle);
  const brandedContent = _expandBrandTokens(content);
  const brandedCta = _expandBrandTokens(ctaText);

  // Status-driven accent colors
  let accentColor = '#3B82F6'; // default blue
  let accentGradient = 'linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%)';

  if (status === 'approved') {
    accentColor = '#059669';
    accentGradient = 'linear-gradient(135deg, #047857 0%, #059669 100%)';
  } else if (status === 'denied') {
    accentColor = '#DC2626';
    accentGradient = 'linear-gradient(135deg, #991B1B 0%, #DC2626 100%)';
  } else if (status === 'needs_info') {
    accentColor = '#F59E0B';
    accentGradient = 'linear-gradient(135deg, #D97706 0%, #F59E0B 100%)';
  }

  const ctaButton = brandedCta && ctaUrl ? `
    <div style="text-align: center; margin: 40px 0 0;">
      <a href="${ctaUrl}" target="_blank" style="display: inline-block; background: ${accentColor}; color: #FFFFFF; text-decoration: none; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); letter-spacing: 0.01em;">
        ${brandedCta}
      </a>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${brandedTitle}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background: #F9FAFB; font-family: Calibri, 'Calibri', Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">

  <!-- Email Container -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #F9FAFB; padding: 40px 16px;">
    <tr>
      <td align="center">

        <!-- Main Card -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="700" style="max-width: 700px; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);">

          <!-- Header with Logo and Title Side-by-Side -->
          <tr>
            <td style="background: #FFFFFF; padding: 32px 40px; border-bottom: 3px solid #F3F4F6;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="vertical-align: middle; width: 180px;">
                    ${logo}
                  </td>
                  <td style="vertical-align: middle; padding-left: 24px;">
                    <h1 style="margin: 0 0 6px; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 34px; font-weight: 700; color: #111827; letter-spacing: -0.02em; line-height: 1.2; text-align: left;">
                      ${brandedTitle}
                    </h1>
                    ${brandedSubtitle ? `<p style="margin: 0; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 16px; font-weight: 500; color: #6B7280; line-height: 1.4; text-align: left;">${brandedSubtitle}</p>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${progressTracker ? `
          <!-- Progress Tracker Section -->
          <tr>
            <td style="padding: 16px 24px; background: #FAFBFC; border-bottom: 1px solid #E5E7EB;">
              ${progressTracker}
            </td>
          </tr>
          ` : ''}

          <!-- Main Content -->
          <tr>
            <td style="padding: 48px 40px;">
              ${brandedContent}
              ${ctaButton}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 32px 40px; background: #F9FAFB; border-top: 1px solid #E5E7EB;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0 0 8px; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 13px; font-weight: 600; color: #374151; letter-spacing: 0.01em;">
                      ${_brand().sender}
                    </p>
                    <p style="margin: 0; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 12px; font-weight: 400; color: #6B7280; line-height: 1.6;">
                      Questions? Email <a href="mailto:${_brand().contact}" style="color: #2563EB; text-decoration: none;">${_brand().contact}</a>
                    </p>
                    <div style="margin: 16px 0 0; padding-top: 16px; border-top: 1px solid #E5E7EB;">
                      <p style="margin: 0; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 10px; color: #9CA3AF; letter-spacing: 0.03em;">
                        ${EMAIL_CONTENT.global.orgLine}
                      </p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
  `.trim();
}

// ============================================================================
// SHARED HELPER FUNCTIONS (for email content building)
// ============================================================================

/**
 * Extract and format traveler names from a travelers array
 * @param {Array} travelers - Array of traveler objects with employeeName property
 * @param {string} separator - Separator between names (default: ', ')
 * @returns {string} Formatted traveler names
 */
function _getTravelerNames(travelers, separator = ', ') {
  if (!travelers || !Array.isArray(travelers)) return '';
  return travelers
    .filter(t => t && typeof t === 'object')
    .map(t => t.employeeName)
    .filter(Boolean)
    .join(separator);
}

/**
 * Build traveler pill badges for email display
 * @param {Array} travelers - Array of traveler objects
 * @returns {string} HTML for traveler pills
 */
function _buildTravelerPills(travelers) {
  if (!travelers || !Array.isArray(travelers) || travelers.length === 0) {
    return '';
  }
  return travelers
    .filter(t => t && typeof t === 'object')
    .map(t => `
      <span style="display: inline-block; background: ${EMAIL_STYLES.colors.border}; color: ${EMAIL_STYLES.colors.textSecondary}; font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 16px; margin: 0 6px 6px 0; font-family: ${EMAIL_STYLES.fonts.family};">
        ${escapeHtml(t.employeeName || 'Traveler')}
      </span>
    `).join('');
}

/**
 * Build simplified inline request details box
 * @param {string} tripName - Event/trip name
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @param {string} attendees - Formatted attendee names
 * @returns {string} HTML for request details box
 */
// Travel-date helpers (_loadLegsForRequest / _getTripTravelWindow /
// _getTripTravelDates) now live in 30_services/TripDates.js — the single
// source of truth shared with Admin_Dashboard.js.

/**
 * Compact request summary card (Event / Travel Dates / Attendees).
 * @param {string} tripName
 * @param {string} travelDates - preformatted range from _getTripTravelDates()
 * @param {string} attendees
 * @returns {string} HTML
 */
function _buildSimplifiedRequestDetails(tripName, travelDates, attendees) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${EMAIL_STYLES.colors.bgCard}; border: 1px solid ${EMAIL_STYLES.colors.border}; border-radius: 8px; padding: 16px 20px;">
      <tr>
        <td style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; color: ${EMAIL_STYLES.colors.textSecondary}; line-height: 1.6;">
          <strong style="color: ${EMAIL_STYLES.colors.textPrimary};">Event:</strong> ${escapeHtml(tripName || 'Untitled Event')}<br>
          <strong style="color: ${EMAIL_STYLES.colors.textPrimary};">Travel Dates:</strong> ${escapeHtml(travelDates || 'TBD')}<br>
          <strong style="color: ${EMAIL_STYLES.colors.textPrimary};">Attendee(s):</strong> ${escapeHtml(attendees) || 'N/A'}
        </td>
      </tr>
    </table>
  `;
}

/**
 * Build uppercase section header
 * @param {string} text - Header text
 * @returns {string} HTML for section header
 */
function _buildSectionHeader(text) {
  return `
    <h2 style="margin: 0 0 12px; font-family: ${EMAIL_STYLES.fonts.family}; font-size: 12px; font-weight: 700; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em;">
      ${escapeHtml(text)}
    </h2>
  `;
}

/**
 * Build inline CTA button
 * @param {string} text - Button text
 * @param {string} url - Button URL
 * @param {string} color - Button background color (default: primary blue)
 * @returns {string} HTML for CTA button
 */
function _buildInlineButton(text, url, color = EMAIL_STYLES.colors.primary) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td align="center">
          <a href="${url}" style="display: inline-block; padding: 14px 32px; background: ${color}; color: #FFFFFF; text-decoration: none; font-family: ${EMAIL_STYLES.fonts.family}; font-size: 15px; font-weight: 600; border-radius: 8px;">
            ${escapeHtml(text)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Build feedback/reason box (for needs info, denial, cancellation)
 * @param {string} content - Box content
 * @param {string} type - 'warning' (amber) or 'error' (red)
 * @returns {string} HTML for feedback box
 */
function _buildFeedbackBox(content, type = 'warning') {
  const styles = {
    warning: {
      bg: EMAIL_STYLES.colors.warningBg,
      border: EMAIL_STYLES.colors.warningBorder,
      text: EMAIL_STYLES.colors.warningText
    },
    error: {
      bg: EMAIL_STYLES.colors.errorBg,
      border: EMAIL_STYLES.colors.errorBorder,
      text: EMAIL_STYLES.colors.errorText
    }
  };
  const s = styles[type] || styles.warning;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 20px;">
      <tr>
        <td style="background: ${s.bg}; border-left: 4px solid ${s.border}; border-radius: 8px; padding: 16px 20px;">
          <div style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 15px; color: ${s.text}; line-height: 1.5;">
            ${escapeHtml(content)}
          </div>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Basic email validation
 * @param {string} email - Email address to validate
 * @returns {boolean} Whether the email appears valid
 */
function _isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Build a deduplicated CC list for final approval emails.
 * Collects traveler emails + approval chain (SD, BU, final approver),
 * excludes the submitter (already in TO), validates all addresses.
 *
 * @param {Object} params
 * @param {string} params.submitterEmail - The submitter email (excluded from CC)
 * @param {Array}  params.travelers - Array of traveler objects with .email field
 * @param {string} params.sectorDirectorEmail - SD approver email
 * @param {string} params.buReviewerEmail - BU approver email
 * @param {string} params.finalApproverEmail - The reviewer who clicked approve (AAS FO or FAS)
 * @returns {string} Comma-separated CC string, or empty string if no valid CCs
 */
function _buildFinalApprovalCcList(params) {
  var submitterLower = (params.submitterEmail || '').toLowerCase().trim();
  var seen = {};
  var ccList = [];

  // Mark submitter as seen so they're excluded from CC
  if (submitterLower) {
    seen[submitterLower] = true;
  }

  function addIfValid(email) {
    if (!email || !_isValidEmail(email)) return;
    var lower = email.toLowerCase().trim();
    if (seen[lower]) return;
    seen[lower] = true;
    ccList.push(email.trim());
  }

  // Add all traveler emails
  var travelers = params.travelers || [];
  for (var i = 0; i < travelers.length; i++) {
    addIfValid(travelers[i].email);
  }

  // Add approval chain
  addIfValid(params.sectorDirectorEmail);
  addIfValid(params.buReviewerEmail);
  addIfValid(params.finalApproverEmail);

  return ccList.join(',');
}

/**
 * Build a stage-aware CC list for intermediate emails (Needs Info, Denial, etc.).
 * Only includes reviewers up to and including the current review stage.
 *
 * SD stage  → travelers + SD
 * BU stage  → travelers + SD + BU
 * OSO stage → travelers + SD + BU + current reviewer (AAS FO)
 *
 * @param {Object} params
 * @param {string} params.submitterEmail - The submitter email (excluded from CC)
 * @param {Array}  params.travelers - Array of traveler objects with .email field
 * @param {string} params.sectorDirectorEmail - SD approver email
 * @param {string} params.buReviewerEmail - BU approver email
 * @param {string} params.currentReviewerEmail - The reviewer taking action at this stage
 * @param {string} params.stage - 'Sector', 'BU', or 'OSO'
 * @returns {string} Comma-separated CC string, or empty string if no valid CCs
 */
function _buildStageCcList(params) {
  var submitterLower = (params.submitterEmail || '').toLowerCase().trim();
  var seen = {};
  var ccList = [];

  // Mark submitter as seen so they're excluded from CC
  if (submitterLower) {
    seen[submitterLower] = true;
  }

  function addIfValid(email) {
    if (!email || !_isValidEmail(email)) return;
    var lower = email.toLowerCase().trim();
    if (seen[lower]) return;
    seen[lower] = true;
    ccList.push(email.trim());
  }

  // Always add travelers
  var travelers = params.travelers || [];
  for (var i = 0; i < travelers.length; i++) {
    addIfValid(travelers[i].email);
  }

  var stage = (params.stage || '').toUpperCase();

  // Progressive: add reviewers up to and including the current stage.
  //
  // SUPERVISOR IS THE FIRST STAGE and carries nobody but the travelers. The
  // request has not reached the SCD yet, so CCing them would notify an
  // approver about a request they have not been asked to look at — and a
  // stream of those is how a reviewer learns to filter the mailbox that
  // later carries their real queue.
  //
  // The supervisor's own address is added from SUPERVISOR onward rather than
  // only at their own stage, because they are part of the chain from then on
  // — the same progressive rule the SCD and DAC already follow.
  if (stage === 'SUPERVISOR' || stage === 'SECTOR' || stage === 'BU' || stage === 'OSO') {
    addIfValid(params.supervisorEmail);
  }
  if (stage === 'SECTOR' || stage === 'BU' || stage === 'OSO') {
    addIfValid(params.sectorDirectorEmail);
  }
  if (stage === 'BU' || stage === 'OSO') {
    addIfValid(params.buReviewerEmail);
  }
  if (stage === 'OSO') {
    addIfValid(params.currentReviewerEmail);
  }

  return ccList.join(',');
}

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

/**
 * Send submission confirmation to the submitter
 * @param {string} requestId - The request ID
 * @param {Object} formData - The form data
 * @param {Object} reviewer - The assigned reviewer (optional)
 * @param {string} reviewLevel - 'Sector', 'BU', or 'OSO' (from smart routing)
 */
/**
 * Human-readable description of where a request has just been routed.
 *
 * WHY THIS EXISTS
 * ---------------
 * @clolry: "I received an email confirmation about the submission. I don't
 * know who it was routed to." The reviewer's name appeared once, inside a
 * prose sentence, and their email address appeared nowhere — so a submitter
 * could not follow up, and could not tell whether routing had resolved at all.
 *
 * Routing failing to resolve is the case that matters most. getSubmitterInfo
 * and the reviewer lookups degrade quietly: if HC cannot resolve a Sector
 * Director or no BU Reviewer is configured, the request still submits and the
 * confirmation still arrives, reading exactly as though everything worked. The
 * explicit "not yet assigned" wording below is the only signal a submitter
 * gets that their request is sitting unrouted.
 *
 * @param {Object|null} reviewer { name, email } from smart routing
 * @param {string} reviewLevel 'Sector' | 'BU' | 'OSO' | 'AAS FO' | 'FAS'
 * @returns {string} plain text, safe for both the HTML and text bodies
 */
function _describeRoutingDestination(reviewer, reviewLevel, status) {
  var stage = describeReviewStage(status, reviewLevel);

  var name = reviewer && reviewer.name ? String(reviewer.name).trim() : '';
  var email = reviewer && reviewer.email ? String(reviewer.email).trim() : '';

  if (name && email) return name + ' <' + email + '> — ' + stage;
  if (name) return name + ' — ' + stage;

  // No reviewer resolved. Say so plainly rather than implying the request is
  // progressing: an unrouted request will sit until someone notices.
  return stage + ' — reviewer not yet assigned. Contact ' + _brand().contact +
    ' if this request does not progress within two business days.';
}

/**
 * The CURRENT review stage, derived from status where possible.
 *
 * WHY STATUS AND NOT Initial_Review_Level
 * ---------------------------------------
 * Initial_Review_Level records where a request STARTED and never advances,
 * while Current_Reviewer_Name does. Pairing them meant a request past its
 * first stage showed the current reviewer against the stage it began at —
 * correct on submission, progressively wrong afterward.
 *
 * Status advances with the request, so it is the better source. The review
 * level is kept only as a fallback for a status this does not recognize.
 *
 * Deliberately NOT reusing STAGE_MAP: that maps to progress-tracker stage
 * keys ('bu_review'), which are internal identifiers. These are the words a
 * submitter should read.
 *
 * Shared by the email and mirrored on the client in travelUtils, because one
 * feeds notifications and the other the portal card. A test asserts the two
 * agree — a submitter seeing different wording in each would reasonably think
 * they were different things.
 *
 * @param {string} status Requests.Status
 * @param {string} [reviewLevel] Initial_Review_Level, used only as a fallback
 * @returns {string}
 */
function describeReviewStage(status, reviewLevel) {
  var STATUS_STAGES = {
    // KEPT IN STEP WITH travelUtils.html's copy, which test_routing_visibility
    // §5 asserts by comparing key sets — one map feeds email, the other the
    // portal card, and a submitter seeing different wording in each would
    // reasonably think they were different things.
    //
    // Not a branding property: every workgroup has supervisors, and the word
    // names the relationship rather than this org's title for a role.
    PENDING_SUPERVISOR: 'supervisor review',
    PENDING_SECTOR: getReviewLabelSector() + ' review',
    PENDING_BU: getReviewLabelBU() + ' review',
    PENDING_OSO: getOrgFOLabel() + ' review',
    PENDING_FAS: 'FAS Front Office review',
    PENDING_DD_CONFIRMATION: 'Division Director confirmation',
    PENDING_CORRECTION: 'correction by the submitter',
    NEEDS_INFO: 'more information from the submitter',
    NEEDS_INFO_SUPERVISOR: 'more information from the submitter',
    NEEDS_INFO_SECTOR: 'more information from the submitter',
    NEEDS_INFO_BU: 'more information from the submitter',
    NEEDS_INFO_OSO: 'more information from the submitter'
  };

  var key = String(status || '').toUpperCase().trim();
  if (STATUS_STAGES[key]) return STATUS_STAGES[key];

  // Fall back to the initial level. Reached when a status is added without
  // being mapped here, which is better than inventing a stage name.
  // Keys are STORED Initial_Review_Level values and must not change —
  // 'AAS FO' in particular is data, not a label, and renaming it would need a
  // migration. The VALUES are configurable labels.
  var LEVEL_LABELS = {
    'Supervisor': 'supervisor review',
    'Sector': getReviewLabelSector() + ' review',
    'BU': getReviewLabelBU() + ' review',
    'OSO': getOrgFOLabel() + ' review',
    'AAS FO': getOrgFOLabel() + ' review',
    'FAS': 'FAS Front Office review'
  };
  if (LEVEL_LABELS[reviewLevel]) return LEVEL_LABELS[reviewLevel];
  return reviewLevel ? reviewLevel + ' review' : 'review';
}

function sendSubmitterConfirmation(requestId, formData, reviewer, reviewLevel) {
  const config = EMAIL_CONTENT.submitterConfirmation;

  const submitterEmail = formData.submitterEmail || Session.getActiveUser().getEmail();
  if (!_isValidEmail(submitterEmail)) {
    return { success: false, error: 'No valid submitter email' };
  }

  const submitterName = formData.submitterName || _formatEmailUserName(submitterEmail);
  const tripName = formData.tripName || formData.eventName || 'Travel Request';
  const travelerCount = (formData.travelers || []).length;
  const travelerNames = _getTravelerNames(formData.travelers);

  // "your assigned reviewer" told @clolry nothing. Name them, with their email
  // when it resolved, and say plainly when it did not — an unrouted request
  // otherwise reads exactly like a normally-progressing one.
  const reviewerName = (reviewer && reviewer.name)
    ? (reviewer.email ? reviewer.name + ' (' + reviewer.email + ')' : reviewer.name)
    : 'a reviewer who has not been assigned yet';

  // The request has just been created and reviewed by nobody, so the tracker
  // must show the FIRST dot as current. Passing STAGE_MAP[reviewLevel] here is
  // what put green checkmarks against SD, BU and AAS FO on a brand-new
  // request: a FAS-routed request resolves to index 4 of 5, and everything
  // before the current index rendered as complete.
  const currentStage = 'submitted';

  // Determine workflow stages based on funding type
  const _travelers = formData.travelers || [];
  const _isAllClientPaid = _travelers.length > 0 && _travelers.every(t => {
    const val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return val.includes('client');
  });

  const subject = config.subject.replace('{{requestId}}', requestId);

  // Build intro with personalization
  const introText = config.intro
    .replace('{{submitterName}}', escapeHtml(submitterName))
    .replace('{{reviewerName}}', escapeHtml(reviewerName));

  // Build attendee pills using helper
  const travelerPills = _buildTravelerPills(formData.travelers);

  // Build 2-column grid details card
  const detailsCard = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${EMAIL_STYLES.colors.bgCard}; border: 2px solid ${EMAIL_STYLES.colors.border}; border-radius: 12px; margin: 20px 0;">
      <!-- Row 1: Event | Travel Dates -->
      <tr>
        <td width="60%" style="padding: 12px 20px; vertical-align: top; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.event}
          </div>
          <div style="font-size: 15px; font-weight: 700; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family}; line-height: 1.3;">
            ${escapeHtml(tripName)}
          </div>
        </td>
        <td width="40%" style="padding: 12px 20px; vertical-align: top; border-left: 1px solid ${EMAIL_STYLES.colors.border}; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.travelDates}
          </div>
          <div style="font-size: 14px; font-weight: 600; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family};">
            ${_getTripTravelDates(formData)}
          </div>
        </td>
      </tr>
      <!-- Row 2: Attendees (full width, pills) -->
      <tr>
        <td colspan="2" style="padding: 12px 20px; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.attendees}
          </div>
          <div style="line-height: 1.6;">
            ${travelerPills || `<span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; color: ${EMAIL_STYLES.colors.textSecondary};">${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}</span>`}
          </div>
        </td>
      </tr>
      <!--
        Row 3: WHERE IT WENT.
        @clolry: "I received an email confirmation about the submission. I
        don't know who it was routed to." The reviewer's name was buried in a
        prose sentence and their email was nowhere, so a submitter had no way
        to follow up or to tell whether routing had resolved at all.
      -->
      <tr>
        <td colspan="2" style="padding: 12px 20px;">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            Now with
          </div>
          <div style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; color: ${EMAIL_STYLES.colors.textBody};">
            ${escapeHtml(_describeRoutingDestination(reviewer, reviewLevel, formData.status))}
          </div>
        </td>
      </tr>
    </table>
  `;

  const content = `
    <p style="margin: 0 0 20px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    ${detailsCard}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    currentStage: currentStage,
    status: 'pending',
    content: content,
    ctaText: config.ctaText,
    ctaUrl: getPortalUrl(),
    stages: _isAllClientPaid ? getWorkflowStagesNoFas() : getWorkflowStagesFull()
  });

  // Plain text fallback
  const body = `
${submitterName},

Your {{appName}} request has been submitted and is now pending review by ${reviewerName}. You will receive notifications as your request progresses.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(formData)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}
Now with: ${_describeRoutingDestination(reviewer, reviewLevel, formData.status)}

No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.

If you have questions in the meantime, please contact {{contactEmail}}.

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: submitterEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Get the production web app base URL (/exec, never /dev).
 * ScriptApp.getService().getUrl() returns /dev when run from the editor
 * or triggers, which is only accessible by the script owner.
 * This helper ensures emails always contain the /exec URL.
 * @returns {string} Production base URL
 */
function _getProductionBaseUrl() {
  const raw = ScriptApp.getService().getUrl();
  if (!raw) return '';
  return raw.replace(/\/dev$/, '/exec');
}

/**
 * Get the Travel Portal URL
 * @returns {string} Portal URL
 */
function getPortalUrl() {
  const baseUrl = _getProductionBaseUrl();
  return baseUrl ? `${baseUrl}?mode=travel` : 'https://script.google.com';
}

/**
 * Get the Review Page URL for a specific request
 * @param {string} requestId - The request ID
 * @returns {string} Review page URL
 */
function getReviewUrl(requestId) {
  const baseUrl = _getProductionBaseUrl();
  return baseUrl ? `${baseUrl}?mode=review&requestId=${encodeURIComponent(requestId)}` : 'https://script.google.com';
}

/**
 * Get the DD Confirmation Page URL for a specific request
 * @param {string} requestId - The request ID
 * @returns {string} DD confirmation page URL
 */
function getDDConfirmUrl(requestId) {
  const baseUrl = _getProductionBaseUrl();
  return baseUrl ? `${baseUrl}?mode=dd-confirm&requestId=${encodeURIComponent(requestId)}` : 'https://script.google.com';
}

/**
 * Send review notification to a reviewer
 * @param {string} requestId - The request ID
 * @param {Object} formData - The form data
 * @param {Object} reviewer - The reviewer to notify
 * @param {string} reviewStage - 'Sector', 'BU', or 'OSO'
 */
function sendReviewerNotification(requestId, formData, reviewer, reviewStage) {
  const config = EMAIL_CONTENT.reviewerNotification;

  if (!reviewer || !reviewer.email || !_isValidEmail(reviewer.email)) {
    console.log('No valid reviewer email, skipping notification');
    return { success: false, error: 'No valid reviewer email' };
  }

  const tripName = formData.tripName || formData.eventName || 'Travel Request';
  const submitterName = formData.submitterName || _formatEmailUserName(Session.getActiveUser().getEmail());
  const reviewerName = reviewer.name || _formatEmailUserName(reviewer.email);
  const travelerCount = (formData.travelers || []).length;
  const travelerNames = _getTravelerNames(formData.travelers);
  const currentStage = STAGE_MAP[reviewStage] || 'bu_review';

  // Determine workflow stages based on funding type
  const _travelers = formData.travelers || [];
  const _isAllClientPaid = _travelers.length > 0 && _travelers.every(t => {
    const val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return val.includes('client');
  });

  const subject = config.subject.replace('{{requestId}}', requestId);

  // Build intro with personalization
  const introText = config.intro.replace('{{reviewerName}}', escapeHtml(reviewerName));
  const contactText = config.contactText.replace('{{submitterName}}', escapeHtml(submitterName));

  // Build attendee pills using helper
  const travelerPills = _buildTravelerPills(formData.travelers);

  // Build 2-column grid details card
  const detailsCard = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${EMAIL_STYLES.colors.bgCard}; border: 2px solid ${EMAIL_STYLES.colors.border}; border-radius: 12px; margin: 0 0 20px;">
      <tr>
        <td width="50%" style="padding: 12px 20px; vertical-align: top; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.event}
          </div>
          <div style="font-size: 15px; font-weight: 700; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family}; line-height: 1.3;">
            ${escapeHtml(tripName)}
          </div>
        </td>
        <td width="50%" style="padding: 12px 20px; vertical-align: top; border-left: 1px solid ${EMAIL_STYLES.colors.border}; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.submittedBy}
          </div>
          <div style="font-size: 14px; font-weight: 600; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family};">
            ${escapeHtml(submitterName)}
          </div>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 12px 20px; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.travelDates}
          </div>
          <div style="font-size: 14px; font-weight: 600; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family};">
            ${_getTripTravelDates(formData)}
          </div>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 12px 20px;">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.attendees}
          </div>
          <div style="line-height: 1.6;">
            ${travelerPills || `<span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; color: ${EMAIL_STYLES.colors.textSecondary};">${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}</span>`}
          </div>
        </td>
      </tr>
    </table>
  `;

  const content = `
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${contactText}
    </p>
    ${detailsCard}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    currentStage: currentStage,
    status: 'action_required',
    content: content,
    ctaText: config.ctaText,
    ctaUrl: getReviewUrl(requestId),
    stages: _isAllClientPaid ? getWorkflowStagesNoFas() : getWorkflowStagesFull()
  });

  // Plain text fallback
  const body = `
${reviewerName},

A new mission-critical travel request has been submitted and requires your review. Please review the request at your earliest convenience and take the appropriate action in {{appName}}.

REQUEST DETAILS
───────────────
Event: ${tripName}
Submitted By: ${submitterName}
Travel Dates: ${_getTripTravelDates(formData)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

If you have any questions, please contact ${submitterName} directly.

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: reviewer.email,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Send "needs more info" notification to submitter
 * @param {string} requestId - The request ID
 * @param {Object} request - The request data
 * @param {string} reviewerName - Who requested more info
 * @param {string} comments - Reviewer comments
 * @param {Object} sectionComments - Section-specific comments (optional)
 * @param {string} reviewStage - 'Sector', 'BU', or 'AAS FO'
 * @param {string} ccString - Optional comma-separated CC recipients (travelers + reviewers at current stage)
 */
function sendNeedsInfoNotification(requestId, request, reviewerName, comments, sectionComments, reviewStage = 'BU', ccString) {
  const config = EMAIL_CONTENT.needsInfoNotification;

  const submitterEmail = request.submitterEmail;
  if (!submitterEmail || !_isValidEmail(submitterEmail)) {
    return { success: false, error: 'No valid submitter email' };
  }

  const submitterName = request.submitterName || _formatEmailUserName(submitterEmail);
  const tripName = request.tripName || 'Travel Request';
  const travelerCount = (request.travelers || []).length;
  const travelerNames = _getTravelerNames(request.travelers);
  const travelerNamesList = _getTravelerNames(request.travelers, ' • ');
  const currentStage = STAGE_MAP[reviewStage] || 'bu_review';

  // Determine workflow stages based on funding type
  const _travelers = request.travelers || [];
  const _isAllClientPaid = _travelers.length > 0 && _travelers.every(t => {
    const val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return val.includes('client');
  });

  const subject = config.subject.replace('{{requestId}}', requestId);

  // Build intro with personalization
  const introText = config.intro
    .replace('{{submitterName}}', escapeHtml(submitterName))
    .replace('{{reviewerName}}', escapeHtml(reviewerName));

  // Build contact text
  const contactText = (config.contactText || 'If you have questions regarding the comments above, please contact <strong>{{reviewerName}}</strong> directly.')
    .replace('{{reviewerName}}', escapeHtml(reviewerName));

  // Build feedback content (overall comments + section comments)
  const hasOverallComments = comments && comments.trim().length > 0;
  const hasSectionComments = sectionComments && Object.keys(sectionComments).length > 0;

  let feedbackContent = '';
  if (hasOverallComments) {
    feedbackContent += `<div style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 15px; color: ${EMAIL_STYLES.colors.warningText}; line-height: 1.5;">${escapeHtml(comments)}</div>`;
  }
  if (hasSectionComments) {
    if (hasOverallComments) {
      feedbackContent += `<div style="border-top: 1px solid #FCD34D; margin: 12px 0; padding-top: 12px;"></div>`;
    }
    feedbackContent += `
      <ul style="margin: 0; padding-left: 18px; color: ${EMAIL_STYLES.colors.warningText}; font-family: ${EMAIL_STYLES.fonts.family}; font-size: 13px; line-height: 1.6;">
        ${Object.entries(sectionComments).map(([key, value]) =>
          `<li><strong>${escapeHtml(key.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()))}:</strong> ${escapeHtml(value)}</li>`
        ).join('')}
      </ul>
    `;
  }

  const feedbackSection = (hasOverallComments || hasSectionComments) ? `
    ${_buildSectionHeader(config.feedbackTitle)}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 20px;">
      <tr>
        <td style="background: ${EMAIL_STYLES.colors.warningBg}; border-left: 4px solid ${EMAIL_STYLES.colors.warningBorder}; border-radius: 8px; padding: 16px 20px;">
          ${feedbackContent}
        </td>
      </tr>
    </table>
  ` : `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0;">
      <tr>
        <td style="background: ${EMAIL_STYLES.colors.warningBg}; border-left: 4px solid ${EMAIL_STYLES.colors.warningBorder}; border-radius: 8px; padding: 16px 20px;">
          <div style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 15px; color: ${EMAIL_STYLES.colors.warningText}; line-height: 1.5;">
            Please review and update your request.
          </div>
        </td>
      </tr>
    </table>
  `;

  // Build request details using helper
  const attendeeDisplay = travelerNamesList || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`;
  const requestDetails = _buildSimplifiedRequestDetails(
    tripName,
    _getTripTravelDates(request),
    attendeeDisplay
  );

  // Inline CTA button using helper
  const inlineButton = _buildInlineButton(config.ctaText, getPortalUrl(), EMAIL_STYLES.colors.warning);

  const content = `
    <p style="margin: 0 0 20px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    ${feedbackSection}
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.nextStepsText}
    </p>
    <p style="margin: 0 0 0; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${contactText}
    </p>
    ${inlineButton}
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    currentStage: currentStage,
    status: 'needs_info',
    content: content,
    stages: _isAllClientPaid ? getWorkflowStagesNoFas() : getWorkflowStagesFull()
  });

  // Plain text fallback
  const body = `
${submitterName},

Your mission-critical travel request has been reviewed by ${reviewerName}, and additional information is required before the review can be completed.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

REVIEWER FEEDBACK
─────────────────
${comments || 'Please review and update your request.'}

Please review the comments above and provide the requested information by updating your submission in {{appName}}. Once updated, the request will resume routing.

---
{{senderName}}
  `.trim();

  const emailOptions = {
    to: submitterEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  };
  if (ccString) {
    emailOptions.cc = ccString;
  }
  return sendTravelEmail(emailOptions);
}

/**
 * Send approval notification to submitter
 * @param {string} requestId - The request ID
 * @param {Object} request - The request data
 * @param {string} stage - What was approved ('Sector', 'BU', 'OSO', 'FAS')
 * @param {string} nextStep - Description of next step (deprecated, use approverInfo instead)
 * @param {Object} approverInfo - Optional info about approver and next reviewer
 * @param {string} approverInfo.approverName - Name of the person who approved
 * @param {string} approverInfo.nextReviewerName - Name of the next reviewer (if applicable)
 * @param {boolean} approverInfo.isFinal - Whether this is the final approval (no next reviewer)
 * @param {string} ccString - Optional comma-separated CC recipients (travelers + reviewers at current stage)
 */
function sendApprovalNotification(requestId, request, stage, nextStep, approverInfo = {}, ccString) {
  const config = EMAIL_CONTENT.approvalNotification;

  const submitterEmail = request.submitterEmail;
  if (!submitterEmail || !_isValidEmail(submitterEmail)) {
    return { success: false, error: 'No valid submitter email' };
  }

  const submitterName = request.submitterName || _formatEmailUserName(submitterEmail);
  const tripName = request.tripName || 'Travel Request';
  const travelerCount = (request.travelers || []).length;
  const travelerNames = _getTravelerNames(request.travelers);
  const travelerNamesList = _getTravelerNames(request.travelers, ' • ');

  // Determine if all travelers are client-paid (to select correct workflow stages)
  const travelers = request.travelers || [];
  const isAllClientPaid = travelers.length > 0 && travelers.every(t => {
    const val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return val.includes('client');
  });

  const stageNames = config.stageNames;
  const approverName = approverInfo.approverName || 'the reviewer';
  const nextReviewerName = approverInfo.nextReviewerName || 'the next reviewer';
  const isFinal = approverInfo.isFinal || stage === 'FAS';

  // Build subject line
  const subject = isFinal
    ? (config.subjectFinal || config.subject)
        .replace('{{requestId}}', requestId)
        .replace('{{approverName}}', escapeHtml(approverName))
    : config.subject
        .replace('{{requestId}}', requestId)
        .replace('{{approverName}}', escapeHtml(approverName))
        .replace('{{nextReviewerName}}', escapeHtml(nextReviewerName));

  // Build intro text
  const introText = isFinal
    ? (config.introFinal || config.intro)
        .replace('{{submitterName}}', escapeHtml(submitterName))
        .replace('{{approverName}}', escapeHtml(approverName))
    : config.intro
        .replace('{{submitterName}}', escapeHtml(submitterName))
        .replace('{{approverName}}', escapeHtml(approverName))
        .replace('{{nextReviewerName}}', escapeHtml(nextReviewerName));

  // Build title
  const title = (config.title || '{{stage}} Review Approved')
    .replace('{{stage}}', stageNames[stage] || stage);

  // Build request details using helper
  const attendeeDisplay = travelerNamesList || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`;
  const requestDetails = _buildSimplifiedRequestDetails(
    tripName,
    _getTripTravelDates(request),
    attendeeDisplay
  );

  const content = `
    <p style="margin: 0 0 20px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.noActionText}
    </p>
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.contactText}
    </p>
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: title,
    subtitle: tripName,
    currentStage: STAGE_MAP[stage] || 'fas_submission',
    status: 'approved',
    content: content,
    ctaText: config.ctaText,
    ctaUrl: getPortalUrl(),
    stages: isAllClientPaid ? getWorkflowStagesNoFas() : getWorkflowStagesFull()
  });

  // Plain text fallback
  const body = isFinal
    ? `
${submitterName},

Your mission-critical travel request has been reviewed and approved by ${approverName}. Your request is now complete!

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

No action is required from you at this time.

If you have questions, please contact {{contactEmail}}.

---
{{senderName}}
  `.trim()
    : `
${submitterName},

Your mission-critical travel request has been reviewed and approved by ${approverName} and is now advancing to ${nextReviewerName} for review.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.

If you have questions in the meantime, please contact {{contactEmail}}.

---
{{senderName}}
  `.trim();

  const emailOptions = {
    to: submitterEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  };
  if (ccString) {
    emailOptions.cc = ccString;
  }
  return sendTravelEmail(emailOptions);
}

/**
 * Send denial notification to submitter
 * @param {string} requestId - The request ID
 * @param {Object} request - The request data
 * @param {string} reviewerName - Who denied
 * @param {string} reason - Denial reason
 * @param {string} reviewStage - 'Sector', 'BU', or 'OSO'
 */
function sendDenialNotification(requestId, request, reviewerName, reason, reviewStage = 'BU') {
  const config = EMAIL_CONTENT.denialNotification;

  const submitterEmail = request.submitterEmail;
  if (!submitterEmail || !_isValidEmail(submitterEmail)) {
    return { success: false, error: 'No valid submitter email' };
  }

  const submitterName = request.submitterName || _formatEmailUserName(submitterEmail);
  const tripName = request.tripName || 'Travel Request';
  const travelerCount = (request.travelers || []).length;
  const travelerNames = _getTravelerNames(request.travelers);
  const travelerNamesList = _getTravelerNames(request.travelers, ' • ');
  const currentStage = STAGE_MAP[reviewStage] || 'bu_review';

  // Determine workflow stages based on funding type
  const _travelers = request.travelers || [];
  const _isAllClientPaid = _travelers.length > 0 && _travelers.every(t => {
    const val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return val.includes('client');
  });

  const subject = config.subject
    .replace('{{requestId}}', requestId)
    .replace('{{reviewerName}}', escapeHtml(reviewerName));

  // Build intro with personalization
  const introText = config.intro
    .replace('{{submitterName}}', escapeHtml(submitterName))
    .replace('{{reviewerName}}', escapeHtml(reviewerName));

  // Build contact text with reviewer name
  const contactText = config.contactText.replace('{{reviewerName}}', escapeHtml(reviewerName));

  // Build request details using helper
  const attendeeDisplay = travelerNamesList || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`;
  const requestDetails = _buildSimplifiedRequestDetails(
    tripName,
    _getTripTravelDates(request),
    attendeeDisplay
  );

  const content = `
    <p style="margin: 0 0 20px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    ${_buildSectionHeader(config.reasonTitle)}
    ${_buildFeedbackBox(reason || 'No reason provided.', 'error')}
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.conclusionText}
    </p>
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${contactText}
    </p>
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    currentStage: currentStage,
    status: 'denied',
    content: content,
    stages: _isAllClientPaid ? getWorkflowStagesNoFas() : getWorkflowStagesFull()
  });

  // Plain text fallback
  const body = `
${submitterName},

Your mission-critical travel request has been reviewed by ${reviewerName} and was not approved.

REASON FOR DENIAL
─────────────────
${reason || 'No reason provided.'}

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

This decision concludes the routing process for this request. No further action will be taken at this time.

If you have questions regarding this decision, please contact ${reviewerName} directly.

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: submitterEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Send cancellation notification to submitter
 * Used when a reviewer cancels a request (different from denial - not a rejection)
 *
 * @param {string} requestId - The request ID
 * @param {Object} request - Request object with submitterEmail, tripName, etc.
 * @param {string} reviewerName - Name of reviewer who cancelled
 * @param {string} reason - Reason for cancellation
 * @param {string} reviewStage - 'Sector', 'BU', 'OSO', or 'FAS'
 */
function sendCancellationNotification(requestId, request, reviewerName, reason, reviewStage = 'BU') {
  const config = EMAIL_CONTENT.cancellationNotification;

  const submitterEmail = request.submitterEmail;
  if (!submitterEmail || !_isValidEmail(submitterEmail)) {
    return { success: false, error: 'No valid submitter email' };
  }

  const submitterName = request.submitterName || _formatEmailUserName(submitterEmail);
  const tripName = request.tripName || 'Travel Request';
  const travelerCount = (request.travelers || []).length;
  const travelerNames = _getTravelerNames(request.travelers);
  const travelerNamesList = _getTravelerNames(request.travelers, ' • ');
  const currentStage = STAGE_MAP[reviewStage] || 'bu_review';

  // Determine workflow stages based on funding type
  const _travelers = request.travelers || [];
  const _isAllClientPaid = _travelers.length > 0 && _travelers.every(t => {
    const val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return val.includes('client');
  });

  const subject = config.subject
    .replace('{{requestId}}', requestId)
    .replace('{{reviewerName}}', escapeHtml(reviewerName));

  // Build intro with personalization
  const introText = config.intro
    .replace('{{submitterName}}', escapeHtml(submitterName))
    .replace('{{reviewerName}}', escapeHtml(reviewerName));

  // Build contact text with reviewer name
  const contactText = config.contactText.replace('{{reviewerName}}', escapeHtml(reviewerName));

  // Build request details using helper
  const attendeeDisplay = travelerNamesList || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`;
  const requestDetails = _buildSimplifiedRequestDetails(
    tripName,
    _getTripTravelDates(request),
    attendeeDisplay
  );

  const content = `
    <p style="margin: 0 0 20px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    ${_buildSectionHeader(config.reasonTitle)}
    ${_buildFeedbackBox(reason || 'No reason provided.', 'warning')}
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.conclusionText}
    </p>
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${contactText}
    </p>
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    currentStage: currentStage,
    status: 'cancelled',
    content: content,
    stages: _isAllClientPaid ? getWorkflowStagesNoFas() : getWorkflowStagesFull()
  });

  // Plain text fallback
  const body = `
${submitterName},

Your mission-critical travel request has been canceled by ${reviewerName} and will no longer move forward in the routing process.

REASON FOR CANCELLATION
───────────────────────
${reason || 'No reason provided.'}

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

This cancellation reflects an internal determination that the travel will not proceed at this time. No further action is required.

If you have questions regarding this cancellation, please contact ${reviewerName} directly.

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: submitterEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

// ============================================================================
// ADDITIONAL EMAIL FUNCTIONS
// ============================================================================

/**
 * Send resubmission notification to a reviewer after submitter updates request
 * @param {string} requestId - The request ID
 * @param {Object} formData - The form data
 * @param {Object} reviewer - The reviewer to notify
 * @param {string} reviewStage - 'Sector', 'BU', or 'OSO'
 */
function sendResubmissionNotification(requestId, formData, reviewer, reviewStage) {
  const config = EMAIL_CONTENT.resubmissionNotification;

  if (!reviewer || !reviewer.email || !_isValidEmail(reviewer.email)) {
    console.log('No valid reviewer email, skipping notification');
    return { success: false, error: 'No valid reviewer email' };
  }

  const tripName = formData.tripName || formData.eventName || 'Travel Request';
  const submitterName = formData.submitterName || _formatEmailUserName(Session.getActiveUser().getEmail());
  const reviewerName = reviewer.name || _formatEmailUserName(reviewer.email);
  const travelerCount = (formData.travelers || []).length;
  const travelerNames = _getTravelerNames(formData.travelers);
  const currentStage = STAGE_MAP[reviewStage] || 'bu_review';

  // Determine workflow stages based on funding type
  const _travelers = formData.travelers || [];
  const _isAllClientPaid = _travelers.length > 0 && _travelers.every(t => {
    const val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return val.includes('client');
  });

  const subject = config.subject.replace('{{requestId}}', requestId);

  // Build intro with personalization
  const introText = config.intro.replace('{{reviewerName}}', escapeHtml(reviewerName));
  const contactText = config.contactText.replace('{{submitterName}}', escapeHtml(submitterName));

  // Build attendee pills using helper
  const travelerPills = _buildTravelerPills(formData.travelers);

  // Build 2-column grid details card
  const detailsCard = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${EMAIL_STYLES.colors.bgCard}; border: 2px solid ${EMAIL_STYLES.colors.border}; border-radius: 12px; margin: 0 0 20px;">
      <tr>
        <td width="50%" style="padding: 12px 20px; vertical-align: top; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.event}
          </div>
          <div style="font-size: 15px; font-weight: 700; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family}; line-height: 1.3;">
            ${escapeHtml(tripName)}
          </div>
        </td>
        <td width="50%" style="padding: 12px 20px; vertical-align: top; border-left: 1px solid ${EMAIL_STYLES.colors.border}; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.submittedBy}
          </div>
          <div style="font-size: 14px; font-weight: 600; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family};">
            ${escapeHtml(submitterName)}
          </div>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 12px 20px; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.travelDates}
          </div>
          <div style="font-size: 14px; font-weight: 600; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family};">
            ${_getTripTravelDates(formData)}
          </div>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 12px 20px;">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.attendees}
          </div>
          <div style="line-height: 1.6;">
            ${travelerPills || `<span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; color: ${EMAIL_STYLES.colors.textSecondary};">${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}</span>`}
          </div>
        </td>
      </tr>
    </table>
  `;

  const content = `
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${contactText}
    </p>
    ${detailsCard}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    currentStage: currentStage,
    status: 'action_required',
    content: content,
    ctaText: config.ctaText,
    ctaUrl: getReviewUrl(requestId),
    stages: _isAllClientPaid ? getWorkflowStagesNoFas() : getWorkflowStagesFull()
  });

  // Plain text fallback
  const body = `
${reviewerName},

A previously submitted mission-critical travel request has been revised and now requires your review. Please review the request at your earliest convenience and take the appropriate action in {{appName}}.

REQUEST DETAILS
───────────────
Event: ${tripName}
Submitted By: ${submitterName}
Travel Dates: ${_getTripTravelDates(formData)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

If you have any questions, please contact ${submitterName} directly.

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: reviewer.email,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Send reviewer approval confirmation after they approve a request
/**
 * Notify a reviewer that an admin has reassigned a request to them.
 *
 * Lightweight standalone email — doesn't include the full request details
 * card; the reviewer clicks through to see them on the review page. Includes
 * the admin's reason verbatim so the recipient knows the context.
 *
 * Wrapped in try/catch by the caller — email failure must never block the
 * reassignment itself.
 *
 * @param {Object} params - { requestId, tripName, newReviewer:{name,email},
 *   previousReviewerEmail, adminName, reason }
 * @returns {Object} { success, error? }
 */
function sendReassignmentNotification(params) {
  try {
    const requestId = params.requestId;
    const tripName = params.tripName || 'Travel Request';
    const newReviewer = params.newReviewer || {};
    const previousReviewerEmail = params.previousReviewerEmail || '';
    const adminName = params.adminName || 'Admin';
    const reason = String(params.reason || '').trim();

    if (!newReviewer.email || !_isValidEmail(newReviewer.email)) {
      console.log('sendReassignmentNotification: no valid recipient — skipping');
      return { success: false, error: 'No valid recipient email' };
    }

    const reviewerName = newReviewer.name || _formatEmailUserName(newReviewer.email);
    const baseUrl = _getProductionBaseUrl();
    const reviewUrl = baseUrl ? `${baseUrl}?mode=review&requestId=${encodeURIComponent(requestId)}` : '';

    const subject = `${_brand().app} Request ${requestId} — Reassigned to you for review`;

    // Body: greeting → context → reason callout → CTA → footer text
    const introText = `${escapeHtml(reviewerName)},<br><br>` +
      `${escapeHtml(adminName)} has reassigned travel request <strong>${escapeHtml(requestId)}</strong> ` +
      (tripName ? `(<em>${escapeHtml(tripName)}</em>) ` : '') +
      (previousReviewerEmail ? `from ${escapeHtml(previousReviewerEmail)} ` : '') +
      `to you for review.`;

    const reasonCard = reason
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
          `style="background: ${EMAIL_STYLES.colors.bgCard}; border-left: 4px solid #F59E0B; ` +
          `border-radius: 6px; margin: 16px 0; padding: 14px 18px;">` +
          `<tr><td style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 13px; ` +
            `color: ${EMAIL_STYLES.colors.textSecondary}; line-height: 1.6;">` +
            `<div style="font-size: 10px; font-weight: bold; ` +
              `color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; ` +
              `letter-spacing: 0.08em; margin-bottom: 6px;">Reason for reassignment</div>` +
            `<div style="font-size: 14px; color: ${EMAIL_STYLES.colors.textPrimary}; ` +
              `font-weight: 500;">${escapeHtml(reason)}</div>` +
          `</td></tr></table>`
      : '';

    const htmlBody = _buildEmailTemplate({
      title: 'Request Reassigned',
      subtitle: requestId,
      currentStage: 'review',
      status: 'pending',
      hideProgressTracker: true,
      content: `
        <p style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; line-height: 1.6;
                  color: ${EMAIL_STYLES.colors.textSecondary}; margin: 0 0 12px;">
          ${introText}
        </p>
        ${reasonCard}
        <p style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; line-height: 1.6;
                  color: ${EMAIL_STYLES.colors.textSecondary}; margin: 12px 0 0;">
          Open the request in {{appName}} to review and take action.
        </p>
      `,
      ctaText: 'Review Request',
      ctaUrl: reviewUrl
    });

    const plainBody =
      `${reviewerName},\n\n` +
      `${adminName} reassigned travel request ${requestId}` +
      (tripName ? ` (${tripName})` : '') +
      (previousReviewerEmail ? ` from ${previousReviewerEmail}` : '') +
      ` to you for review.\n\n` +
      (reason ? `Reason: ${reason}\n\n` : '') +
      (reviewUrl ? `Open the request: ${reviewUrl}\n` : '');

    return sendTravelEmail({
      to: newReviewer.email,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody
    });
  } catch (error) {
    console.error('sendReassignmentNotification error:', error);
    return { success: false, error: error.message || 'Failed to send reassignment email' };
  }
}

/**
 * Notify a reviewer that an admin has bulk-reassigned multiple pending
 * requests to them at once. Used by every routing-config change path
 * (setRolePrimary, setRoleActive, addRoleToUser, addTravelUser,
 * updateTravelUser-on-deactivation) — NOT just BU reassignments.
 *
 * Different shape from the single sendReassignmentNotification: lists
 * every moved request with a link, instead of one email per request.
 *
 * @param {Object} params - { newReviewer:{name,email}, previousReviewerEmail,
 *   adminName, scopeLabel, reason, requests:[{requestId, tripName}, ...] }
 * @returns {Object} { success, error? }
 */
function sendBulkReassignmentNotification(params) {
  try {
    const newReviewer = params.newReviewer || {};
    const previousReviewerEmail = params.previousReviewerEmail || '';
    const adminName = params.adminName || 'Admin';
    const scopeLabel = params.scopeLabel || params.buCode || '';
    const reason = String(params.reason || '').trim();
    const requests = Array.isArray(params.requests) ? params.requests : [];

    if (!newReviewer.email || !_isValidEmail(newReviewer.email)) {
      return { success: false, error: 'No valid recipient email' };
    }
    if (requests.length === 0) {
      return { success: false, error: 'No requests to notify about' };
    }

    const reviewerName = newReviewer.name || _formatEmailUserName(newReviewer.email);
    const baseUrl = _getProductionBaseUrl();
    const portalUrl = baseUrl ? `${baseUrl}?mode=travel` : '';

    const subject = `${_brand().app} — ${requests.length} request${requests.length === 1 ? '' : 's'} reassigned to you`;

    const introText = `${escapeHtml(reviewerName)},<br><br>` +
      `${escapeHtml(adminName)} reassigned <strong>${requests.length} pending review${requests.length === 1 ? '' : 's'}</strong>` +
      (scopeLabel ? ` for ${escapeHtml(scopeLabel)}` : '') +
      (previousReviewerEmail ? ` from ${escapeHtml(previousReviewerEmail)}` : '') +
      ` to you${reason ? ' (' + escapeHtml(reason) + ')' : ''}.`;

    // List the moved requests with per-row links
    const requestRows = requests.map(r => {
      const url = baseUrl ? `${baseUrl}?mode=review&requestId=${encodeURIComponent(r.requestId)}` : '';
      const linkOpen = url ? `<a href="${url}" style="color: ${EMAIL_STYLES.colors.primary}; text-decoration: none;">` : '';
      const linkClose = url ? '</a>' : '';
      return `<tr>` +
        `<td style="padding: 8px 12px; font-family: ${EMAIL_STYLES.fonts.family}; font-size: 13px; ` +
          `border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">` +
          `${linkOpen}<code style="font-size: 12px;">${escapeHtml(r.requestId)}</code>${linkClose}` +
          (r.tripName ? ` — <span style="color: ${EMAIL_STYLES.colors.textSecondary};">${escapeHtml(r.tripName)}</span>` : '') +
        `</td></tr>`;
    }).join('');

    const requestsTable =
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
        `style="background: ${EMAIL_STYLES.colors.bgCard}; border: 1px solid ${EMAIL_STYLES.colors.border}; ` +
        `border-radius: 8px; margin: 16px 0;">${requestRows}</table>`;

    const htmlBody = _buildEmailTemplate({
      title: 'Requests Reassigned',
      subtitle: requests.length + ' request' + (requests.length === 1 ? '' : 's'),
      currentStage: 'review',
      status: 'pending',
      hideProgressTracker: true,
      content: `
        <p style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; line-height: 1.6;
                  color: ${EMAIL_STYLES.colors.textSecondary}; margin: 0 0 12px;">
          ${introText}
        </p>
        ${requestsTable}
        <p style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 13px; line-height: 1.6;
                  color: ${EMAIL_STYLES.colors.textMuted}; margin: 12px 0 0;">
          Click any request ID above to open it directly, or open the portal to see your full reviewer queue.
        </p>
      `,
      ctaText: 'Open Portal',
      ctaUrl: portalUrl
    });

    const plainBody =
      `${reviewerName},\n\n` +
      `${adminName} reassigned ${requests.length} pending review${requests.length === 1 ? '' : 's'}` +
      (scopeLabel ? ` for ${scopeLabel}` : '') +
      (previousReviewerEmail ? ` from ${previousReviewerEmail}` : '') +
      ` to you${reason ? ' (' + reason + ')' : ''}.\n\n` +
      requests.map(r => `- ${r.requestId}${r.tripName ? ' — ' + r.tripName : ''}`).join('\n') +
      `\n\n` +
      (portalUrl ? `Open the portal: ${portalUrl}\n` : '');

    return sendTravelEmail({
      to: newReviewer.email,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody
    });
  } catch (error) {
    console.error('sendBulkReassignmentNotification error:', error);
    return { success: false, error: error.message || 'Failed to send bulk reassignment email' };
  }
}

/**
 * @param {string} requestId - The request ID
 * @param {Object} request - The request data
 * @param {Object} reviewer - The reviewer who approved
 * @param {string} nextReviewerName - Name of the next reviewer
 * @param {string} reviewStage - 'Sector', 'BU', or 'OSO'
 */
function sendReviewerApprovalConfirmation(requestId, request, reviewer, nextReviewerName, reviewStage) {
  const config = EMAIL_CONTENT.reviewerApprovalConfirmation;

  if (!reviewer || !reviewer.email || !_isValidEmail(reviewer.email)) {
    console.log('No valid reviewer email, skipping confirmation');
    return { success: false, error: 'No valid reviewer email' };
  }

  const reviewerName = reviewer.name || _formatEmailUserName(reviewer.email);
  const tripName = request.tripName || 'Travel Request';
  const travelerCount = (request.travelers || []).length;
  const travelerNames = _getTravelerNames(request.travelers);
  const travelerNamesList = _getTravelerNames(request.travelers, ' • ');

  // Determine if all travelers are client-paid (to select correct workflow stages)
  const travelers = request.travelers || [];
  const isAllClientPaid = travelers.length > 0 && travelers.every(t => {
    const val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return val.includes('client');
  });

  // Map review stage to NEXT stage for progress tracker (after approval advances)
  const nextStageMap = { 'Sector': 'bu_review', 'BU': 'oso_review', 'OSO': isAllClientPaid ? 'oso_review' : 'fas_submission' };
  const currentStage = nextStageMap[reviewStage] || 'oso_review';

  const subject = config.subject
    .replace('{{requestId}}', requestId)
    .replace('{{nextReviewerName}}', escapeHtml(nextReviewerName));

  // Build intro with personalization
  const introText = config.intro
    .replace('{{reviewerName}}', escapeHtml(reviewerName))
    .replace('{{nextReviewerName}}', escapeHtml(nextReviewerName));

  // Build request details using helper
  const attendeeDisplay = travelerNamesList || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`;
  const requestDetails = _buildSimplifiedRequestDetails(
    tripName,
    _getTripTravelDates(request),
    attendeeDisplay
  );

  const content = `
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    currentStage: currentStage,
    status: 'approved',
    content: content,
    stages: isAllClientPaid ? getWorkflowStagesNoFas() : getWorkflowStagesFull()
  });

  // Plain text fallback
  const body = `
${reviewerName},

This message confirms that the travel request you approved has successfully advanced to ${nextReviewerName} for review. No further action is required from you at this time.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: reviewer.email,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Send advancing to FAS notification (overhead travel approved at FO)
 * @param {string} requestId - The request ID
 * @param {Object} request - The request data
 * @param {string} foReviewerName - Name of the FO reviewer who approved
 */
function sendAdvancingToFasNotification(requestId, request, foReviewerName) {
  const config = EMAIL_CONTENT.advancingToFas;

  const submitterEmail = request.submitterEmail;
  if (!submitterEmail || !_isValidEmail(submitterEmail)) {
    return { success: false, error: 'No valid submitter email' };
  }

  // Defensive: this function should only be called for overhead travel
  var _travelers = request.travelers || [];
  var _isAllClientPaid = _travelers.length > 0 && _travelers.every(function(t) {
    var val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return val.includes('client');
  });
  if (_isAllClientPaid) {
    console.log('sendAdvancingToFasNotification skipped: request is client-paid');
    return { success: true, skipped: true };
  }

  const submitterName = request.submitterName || _formatEmailUserName(submitterEmail);
  const tripName = request.tripName || 'Travel Request';
  const travelerCount = (request.travelers || []).length;
  const travelerNames = _getTravelerNames(request.travelers);
  const travelerNamesList = _getTravelerNames(request.travelers, ' • ');

  const subject = config.subject
    .replace('{{requestId}}', requestId)
    .replace('{{foReviewerName}}', escapeHtml(foReviewerName));

  // Build intro with personalization
  const introText = config.intro
    .replace('{{submitterName}}', escapeHtml(submitterName))
    .replace('{{foReviewerName}}', escapeHtml(foReviewerName));

  // Build request details using helper
  const attendeeDisplay = travelerNamesList || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`;
  const requestDetails = _buildSimplifiedRequestDetails(
    tripName,
    _getTripTravelDates(request),
    attendeeDisplay
  );

  const content = `
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.noActionText}
    </p>
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.contactText}
    </p>
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    currentStage: 'fas_submission',
    status: 'pending',
    content: content
  });

  // Plain text fallback
  const body = `
${submitterName},

Your mission-critical travel request has been reviewed and approved by {{orgShort}} Chief of Staff ${foReviewerName} and is now advancing to the FAS Front Office for review.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.

If you have questions in the meantime, please contact {{contactEmail}}.

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: submitterEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Send notification to FAS reviewer that a request needs their review
 * @param {string} requestId - The request ID
 * @param {Object} formData - The request data (emailRequest shape)
 * @param {Object} reviewer - The FAS reviewer { name, email }
 */
function sendFasReviewerNotification(requestId, formData, reviewer) {
  const config = EMAIL_CONTENT.reviewerNotification;

  if (!reviewer || !reviewer.email || !_isValidEmail(reviewer.email)) {
    console.log('No valid FAS reviewer email, skipping notification');
    return { success: false, error: 'No valid FAS reviewer email' };
  }

  const tripName = formData.tripName || formData.eventName || 'Travel Request';
  const submitterName = formData.submitterName || _formatEmailUserName('');
  const reviewerName = reviewer.name || _formatEmailUserName(reviewer.email);
  const travelerCount = (formData.travelers || []).length;
  const travelerNames = _getTravelerNames(formData.travelers);

  const subject = _brand().app + ' Request ' + requestId +
    ' - NEW GSA-Paid Travel Request Pending Your Review';

  // Build intro with personalization
  const introText = (reviewerName + ',<br><br>A GSA-Paid mission-critical travel request has been approved by ${_brand().orgShort} leadership and now requires FAS Front Office review. Please review the request at your earliest convenience and take the appropriate action in ${_brand().app}.');
  const contactText = config.contactText.replace('{{submitterName}}', escapeHtml(submitterName));

  // Build attendee pills using helper
  const travelerPills = _buildTravelerPills(formData.travelers);

  // Build 2-column grid details card (same pattern as sendReviewerNotification)
  const detailsCard = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${EMAIL_STYLES.colors.bgCard}; border: 2px solid ${EMAIL_STYLES.colors.border}; border-radius: 12px; margin: 0 0 20px;">
      <tr>
        <td width="50%" style="padding: 12px 20px; vertical-align: top; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.event}
          </div>
          <div style="font-size: 15px; font-weight: 700; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family}; line-height: 1.3;">
            ${escapeHtml(tripName)}
          </div>
        </td>
        <td width="50%" style="padding: 12px 20px; vertical-align: top; border-left: 1px solid ${EMAIL_STYLES.colors.border}; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.submittedBy}
          </div>
          <div style="font-size: 14px; font-weight: 600; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family};">
            ${escapeHtml(submitterName)}
          </div>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 12px 20px; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.travelDates}
          </div>
          <div style="font-size: 14px; font-weight: 600; color: ${EMAIL_STYLES.colors.textPrimary}; font-family: ${EMAIL_STYLES.fonts.family};">
            ${_getTripTravelDates(formData)}
          </div>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 12px 20px;">
          <div style="font-size: 10px; font-weight: bold; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; font-family: ${EMAIL_STYLES.fonts.family};">
            ${config.labels.attendees}
          </div>
          <div style="line-height: 1.6;">
            ${travelerPills || '<span style="font-family: ' + EMAIL_STYLES.fonts.family + '; font-size: 14px; color: ' + EMAIL_STYLES.colors.textSecondary + ';">' + travelerCount + ' attendee' + (travelerCount !== 1 ? 's' : '') + '</span>'}
          </div>
        </td>
      </tr>
    </table>
  `;

  const content = `
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${contactText}
    </p>
    ${detailsCard}
  `;

  const htmlBody = _buildEmailTemplate({
    title: 'FAS Review Required',
    subtitle: tripName,
    currentStage: 'fas_submission',
    status: 'action_required',
    content: content,
    ctaText: 'Review ' + _brand().app + ' Request',
    ctaUrl: getReviewUrl(requestId)
  });

  // Plain text fallback
  const body = `
${reviewerName},

An overhead mission-critical travel request has been approved by {{orgShort}} leadership and now requires FAS Front Office review.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(formData)}
Submitted By: ${submitterName}
Attendee(s): ${travelerNames || travelerCount + ' attendee' + (travelerCount !== 1 ? 's' : '')}

Please review the request in {{appName}} and take the appropriate action (approve or deny).

If you have any questions, please contact Jennifer C. directly.

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: reviewer.email,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Send FAS approval notification (overhead travel approved by FAS - ready to book)
 * @param {string} requestId - The request ID
 * @param {Object} request - The request data
 * @param {string} ccString - Optional comma-separated CC recipients (travelers + approval chain)
 */
function sendFasApprovalNotification(requestId, request, ccString) {
  const config = EMAIL_CONTENT.fasApproval;

  const submitterEmail = request.submitterEmail;
  if (!submitterEmail || !_isValidEmail(submitterEmail)) {
    return { success: false, error: 'No valid submitter email' };
  }

  // Defensive: this function should only be called for overhead travel
  var _travelers = request.travelers || [];
  var _isAllClientPaid = _travelers.length > 0 && _travelers.every(function(t) {
    var val = String(t.isClientPaid || t.Is_Client_Paid || '').toLowerCase().trim();
    return val.includes('client');
  });
  if (_isAllClientPaid) {
    console.log('sendFasApprovalNotification skipped: request is client-paid');
    return { success: true, skipped: true };
  }

  const submitterName = request.submitterName || _formatEmailUserName(submitterEmail);
  const tripName = request.tripName || 'Travel Request';
  const travelerCount = (request.travelers || []).length;
  const travelerNames = _getTravelerNames(request.travelers);
  const travelerNamesList = _getTravelerNames(request.travelers, ' • ');

  const subject = config.subject.replace('{{requestId}}', requestId);

  // Build intro with personalization
  const introText = config.intro.replace('{{submitterName}}', escapeHtml(submitterName));

  // Build request details using helper
  const attendeeDisplay = travelerNamesList || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`;
  const requestDetails = _buildSimplifiedRequestDetails(
    tripName,
    _getTripTravelDates(request),
    attendeeDisplay
  );

  // Conditional Salesforce SOP reminder for overhead conference/training travel
  const travelTypes = request.travelTypes || [];
  const hasConferenceType = travelTypes.some(function(t) {
    return t === 'GSA Sponsored Conference' || t === 'Non-GSA Sponsored Conference Attendance (including training)';
  });

  // When SOP applies, show numbered steps (1. SOP, 2. Booking); otherwise just booking paragraph
  const sopBookingInstructions = 'Following Salesforce approval, proceed with making travel arrangements in <a href="https://go.gov" style="color: #2563EB; text-decoration: none;">GO.gov</a> in accordance with applicable policies and procedures.';
  const bookingAndSopHtml = hasConferenceType ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 16px; width: 100%;">
      <tr>
        <td style="width: 36px; vertical-align: top; padding-right: 12px;">
          <div style="width: 32px; height: 32px; background: #2563EB; border-radius: 50%; text-align: center; line-height: 32px; color: white; font-weight: bold; font-size: 15px; font-family: ${EMAIL_STYLES.fonts.family};">1</div>
        </td>
        <td style="vertical-align: top; padding-top: 4px;">
          <p style="margin: 0 0 4px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textHeading}; font-size: 14px; font-weight: 700; line-height: 1.3;">Salesforce Submission</p>
          <p style="margin: 0; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
            Please follow the Salesforce Procedures outlined in the <a href="https://docs.google.com/document/d/10-QK4ur6xRCFQJEiRhJa69y-VH6vdImxc23D53pTBMI/edit?tab=t.i0zc0igzda9j" style="color: #2563EB; text-decoration: none;">{{orgShort}} Travel SOP</a> prior to booking travel.
          </p>
        </td>
      </tr>
      <tr><td colspan="2" style="height: 12px;"></td></tr>
      <tr>
        <td style="width: 36px; vertical-align: top; padding-right: 12px;">
          <div style="width: 32px; height: 32px; background: #2563EB; border-radius: 50%; text-align: center; line-height: 32px; color: white; font-weight: bold; font-size: 15px; font-family: ${EMAIL_STYLES.fonts.family};">2</div>
        </td>
        <td style="vertical-align: top; padding-top: 4px;">
          <p style="margin: 0 0 4px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textHeading}; font-size: 14px; font-weight: 700; line-height: 1.3;">GO.gov</p>
          <p style="margin: 0; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
            ${sopBookingInstructions}
          </p>
        </td>
      </tr>
    </table>` : `
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.bookingInstructions}
    </p>`;

  const content = `
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    ${bookingAndSopHtml}
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.contactText}
    </p>
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: hasConferenceType ? 'Approved: Next Steps' : config.title,
    subtitle: tripName,
    currentStage: 'fas_submission',
    status: 'complete',
    stages: getWorkflowStagesFull(),
    content: content
  });

  // Plain text fallback
  const body = `
${submitterName},

Your mission-critical travel request has completed the full review process and has been approved by the FAS Front Office.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

${hasConferenceType ? 'Salesforce Submission: Please follow the Salesforce Procedures outlined in the {{orgShort}} Travel SOP prior to booking travel.\nhttps://docs.google.com/document/d/10-QK4ur6xRCFQJEiRhJa69y-VH6vdImxc23D53pTBMI/edit?tab=t.i0zc0igzda9j\n\nGO.gov: Following Salesforce approval, proceed with making travel arrangements in GO.gov in accordance with applicable policies and procedures.' : 'You may now proceed with making travel arrangements in GO.gov in accordance with applicable policies and procedures.'}

If you have any further questions regarding this request, please contact {{contactEmail}}.

---
{{senderName}}
  `.trim();

  const emailOptions = {
    to: submitterEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  };
  if (ccString) {
    emailOptions.cc = ccString;
  }
  return sendTravelEmail(emailOptions);
}

/**
 * Send proceed with booking notification (client-paid travel approved at FO)
 * @param {string} requestId - The request ID
 * @param {Object} request - The request data
 * @param {string} foReviewerName - Name of the FO reviewer who approved
 * @param {string} buReviewerName - Name of the BU reviewer (for contact)
 * @param {string} ccString - Optional comma-separated CC recipients (travelers + approval chain)
 */
function sendProceedWithBookingNotification(requestId, request, foReviewerName, buReviewerName, ccString) {
  const config = EMAIL_CONTENT.proceedWithBooking;

  const submitterEmail = request.submitterEmail;
  if (!submitterEmail || !_isValidEmail(submitterEmail)) {
    return { success: false, error: 'No valid submitter email' };
  }

  const submitterName = request.submitterName || _formatEmailUserName(submitterEmail);
  const tripName = request.tripName || 'Travel Request';
  const travelerCount = (request.travelers || []).length;
  const travelerNamesList = _getTravelerNames(request.travelers, ' • ');

  const subject = config.subject.replace('{{requestId}}', requestId);

  // Build intro with personalization
  const introText = config.intro
    .replace('{{submitterName}}', escapeHtml(submitterName))
    .replace('{{foReviewerName}}', escapeHtml(foReviewerName));

  // Build contact text with BU reviewer name
  const contactText = config.contactText.replace('{{buReviewerName}}', escapeHtml(buReviewerName || 'your {{buLabel}} reviewer'));

  // Build request details using helper
  const attendeeDisplay = travelerNamesList || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`;
  const requestDetails = _buildSimplifiedRequestDetails(
    tripName,
    _getTripTravelDates(request),
    attendeeDisplay
  );

  // Conditional Salesforce SOP reminder for international client-paid travel
  const isInternational = request.isInternational === true || String(request.isInternational).toLowerCase() === 'true';

  // When SOP applies, show numbered steps (1. SOP, 2. Booking); otherwise just booking paragraph
  const sopBookingInstructions = 'Following Salesforce approval, proceed with making travel arrangements in <a href="https://go.gov" style="color: #2563EB; text-decoration: none;">GO.gov</a> in accordance with applicable policies and procedures.';
  const bookingAndSopHtml = isInternational ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 16px; width: 100%;">
      <tr>
        <td style="width: 36px; vertical-align: top; padding-right: 12px;">
          <div style="width: 32px; height: 32px; background: #2563EB; border-radius: 50%; text-align: center; line-height: 32px; color: white; font-weight: bold; font-size: 15px; font-family: ${EMAIL_STYLES.fonts.family};">1</div>
        </td>
        <td style="vertical-align: top; padding-top: 4px;">
          <p style="margin: 0 0 4px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textHeading}; font-size: 14px; font-weight: 700; line-height: 1.3;">Salesforce Submission</p>
          <p style="margin: 0; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
            Please follow the Salesforce Procedures outlined in the <a href="https://docs.google.com/document/d/10-QK4ur6xRCFQJEiRhJa69y-VH6vdImxc23D53pTBMI/edit?tab=t.i0zc0igzda9j" style="color: #2563EB; text-decoration: none;">{{orgShort}} Travel SOP</a> prior to booking travel.
          </p>
        </td>
      </tr>
      <tr><td colspan="2" style="height: 12px;"></td></tr>
      <tr>
        <td style="width: 36px; vertical-align: top; padding-right: 12px;">
          <div style="width: 32px; height: 32px; background: #2563EB; border-radius: 50%; text-align: center; line-height: 32px; color: white; font-weight: bold; font-size: 15px; font-family: ${EMAIL_STYLES.fonts.family};">2</div>
        </td>
        <td style="vertical-align: top; padding-top: 4px;">
          <p style="margin: 0 0 4px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textHeading}; font-size: 14px; font-weight: 700; line-height: 1.3;">GO.gov</p>
          <p style="margin: 0; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
            ${sopBookingInstructions}
          </p>
        </td>
      </tr>
    </table>` : `
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.bookingInstructions}
    </p>`;

  const content = `
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    ${bookingAndSopHtml}
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${contactText}
    </p>
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: isInternational ? 'Approved: Next Steps' : config.title,
    subtitle: tripName,
    currentStage: 'oso_review',
    status: 'complete',
    stages: getWorkflowStagesNoFas(), // Client-paid travel doesn't go to FAS
    content: content
    // No CTA button - they should go to GO.gov
  });

  // Plain text fallback
  const body = `
${submitterName},

Your mission-critical travel request has been reviewed and approved by {{orgShort}} Chief of Staff ${foReviewerName}.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNamesList || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

${isInternational ? 'Salesforce Submission: Please follow the Salesforce Procedures outlined in the {{orgShort}} Travel SOP prior to booking travel.\nhttps://docs.google.com/document/d/10-QK4ur6xRCFQJEiRhJa69y-VH6vdImxc23D53pTBMI/edit?tab=t.i0zc0igzda9j\n\nGO.gov: Following Salesforce approval, proceed with making travel arrangements in GO.gov in accordance with applicable policies and procedures.' : 'You may now proceed with making travel arrangements in GO.gov in accordance with applicable policies and procedures.'}

If you have any further questions regarding this request, please contact ${buReviewerName || ('your ' + getReviewLabelBU() + ' reviewer')} directly. Questions regarding GO.gov may be referred to ${_brand().contact}.

---
{{senderName}}
  `.trim();

  const emailOptions = {
    to: submitterEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  };
  if (ccString) {
    emailOptions.cc = ccString;
  }
  return sendTravelEmail(emailOptions);
}

// ============================================================================
// DD CONFIRMATION EMAILS
// ============================================================================

/**
 * Send DD confirmation email to a Division Director
 * Uses the master template for consistent branding
 *
 * @param {Object} ddGroup - DD group info { ddName, ddEmail, travelers }
 * @param {Object} request - Request data { tripName, eventStartDate, eventEndDate, requestId }
 * @param {string} confirmUrl - URL for DD to confirm funding (optional, will generate if not provided)
 * @returns {Object} Result with success status
 */
function sendDDConfirmationEmail(ddGroup, request, confirmUrl) {
  const config = EMAIL_CONTENT.ddConfirmation;

  if (!ddGroup || !ddGroup.ddEmail || !_isValidEmail(ddGroup.ddEmail)) {
    return { success: false, error: 'No valid DD email provided' };
  }

  const ddName = ddGroup.ddName || 'Division Director';
  const tripName = request.tripName || 'Travel Request';
  const travelerNames = (ddGroup.travelers || []).map(t => t.employeeName || t.name).join(', ');

  // Generate confirm URL if not provided
  const ddConfirmUrl = confirmUrl || getDDConfirmUrl(request.requestId);

  const subject = config.subject.replace('{{requestId}}', request.requestId || 'N/A');

  // Build intro with personalization
  const introText = config.intro.replace('{{ddName}}', escapeHtml(ddName));

  // Build traveler list table
  const travelerListHtml = (ddGroup.travelers || []).map(t => {
    const name = escapeHtml(t.employeeName || t.name || 'Unknown');
    const dutyLocation = escapeHtml(t.dutyLocation || 'N/A');
    const isClientPaid = String(t.isClientPaid || '').toLowerCase().includes('client');
    const fundingLabel = isClientPaid ? 'Client-Paid' : 'GSA-Paid';
    const fundingColor = isClientPaid ? EMAIL_STYLES.colors.successDark : EMAIL_STYLES.colors.primary;
    const fundingBg = isClientPaid ? '#ECFDF5' : '#EFF6FF';

    return `
      <tr>
        <td style="padding: 10px 16px; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; font-weight: 500; color: ${EMAIL_STYLES.colors.textPrimary};">
            ${name}
          </span>
          <br><span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 12px; color: ${EMAIL_STYLES.colors.textSecondary};">
            ${dutyLocation}
          </span>
        </td>
        <td style="padding: 10px 16px; border-bottom: 1px solid ${EMAIL_STYLES.colors.border}; text-align: right;">
          <span style="display: inline-block; padding: 4px 10px; background: ${fundingBg}; color: ${fundingColor}; font-size: 11px; font-weight: 600; border-radius: 16px;">
            ${fundingLabel}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  // Build simplified request details
  const requestDetails = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${EMAIL_STYLES.colors.bgCard}; border: 1px solid ${EMAIL_STYLES.colors.border}; border-radius: 8px; padding: 16px 20px;">
      <tr>
        <td style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; color: ${EMAIL_STYLES.colors.textSecondary}; line-height: 1.6;">
          <strong style="color: ${EMAIL_STYLES.colors.textPrimary};">Event:</strong> ${escapeHtml(tripName)}<br>
          <strong style="color: ${EMAIL_STYLES.colors.textPrimary};">Travel Dates:</strong> ${_getTripTravelDates(request)}
        </td>
      </tr>
    </table>
  `;

  const content = `
    <p style="margin: 0 0 20px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    ${_buildSectionHeader(config.labels.attendees)}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${EMAIL_STYLES.colors.bgCard}; border: 1px solid ${EMAIL_STYLES.colors.border}; border-radius: 8px; overflow: hidden; margin: 0 0 24px;">
      <tr>
        <td style="padding: 10px 16px; background: ${EMAIL_STYLES.colors.borderLight}; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 10px; font-weight: 700; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.05em;">
            Staff Member
          </span>
        </td>
        <td style="padding: 10px 16px; background: ${EMAIL_STYLES.colors.borderLight}; border-bottom: 1px solid ${EMAIL_STYLES.colors.border}; text-align: right;">
          <span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 10px; font-weight: 700; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.05em;">
            Funding Type
          </span>
        </td>
      </tr>
      ${travelerListHtml}
    </table>
    ${_buildInlineButton(config.ctaText, ddConfirmUrl)}
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.contactText}
    </p>
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    content: content,
    hideProgressTracker: true  // DD emails are post-approval, no workflow to show
  });

  // Plain text fallback
  const body = `
${ddName},

The staff listed below have been approved to participate in mission-critical travel. After reviewing their Request(s) in GO.gov, please review and confirm travel details for your staff in {{appName}}.

Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Staff Requiring Confirmation: ${travelerNames}

Please click the link below to confirm in {{appName}}:
${ddConfirmUrl}

Your approval in {{appName}} certifies that you have reviewed the Request in GO.gov and verified that the correct line of accounting has been selected for the trip. Once confirmed, the travel request will be closed out. If you have any questions or require further clarification, please contact {{contactEmail}}.

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: ddGroup.ddEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Send DD re-confirmation email after funding correction
 * Uses the master template for consistent branding
 *
 * @param {Object} ddGroup - DD group info { ddName, ddEmail, travelers }
 * @param {Object} request - Request data { tripName, eventStartDate, eventEndDate, requestId }
 * @param {string} confirmUrl - URL for DD to confirm funding (optional, will generate if not provided)
 * @returns {Object} Result with success status
 */
function sendDDReconfirmationEmail(ddGroup, request, confirmUrl) {
  const config = EMAIL_CONTENT.ddReconfirmation;

  if (!ddGroup || !ddGroup.ddEmail || !_isValidEmail(ddGroup.ddEmail)) {
    return { success: false, error: 'No valid DD email provided' };
  }

  const ddName = ddGroup.ddName || 'Division Director';
  const tripName = request.tripName || 'Travel Request';
  const travelerNames = (ddGroup.travelers || []).map(t => t.employeeName || t.name).join(', ');

  // Generate confirm URL if not provided
  const ddConfirmUrl = confirmUrl || getDDConfirmUrl(request.requestId);

  const subject = config.subject.replace('{{requestId}}', request.requestId || 'N/A');

  // Build intro with personalization
  const introText = config.intro.replace('{{ddName}}', escapeHtml(ddName));

  // Build traveler list with funding status
  const travelerListHtml = (ddGroup.travelers || []).map(t => {
    const name = escapeHtml(t.employeeName || t.name || 'Unknown');
    const dutyLocation = escapeHtml(t.dutyLocation || 'N/A');
    const isClientPaid = String(t.isClientPaid || '').toLowerCase().includes('client');
    const fundingLabel = isClientPaid ? 'Client-Paid' : 'GSA-Paid';
    const fundingColor = isClientPaid ? EMAIL_STYLES.colors.successDark : EMAIL_STYLES.colors.primary;
    const fundingBg = isClientPaid ? '#ECFDF5' : '#EFF6FF';

    return `
      <tr>
        <td style="padding: 10px 16px; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; font-weight: 500; color: ${EMAIL_STYLES.colors.textPrimary};">
            ${name}
          </span>
          <br><span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 12px; color: ${EMAIL_STYLES.colors.textSecondary};">
            ${dutyLocation}
          </span>
        </td>
        <td style="padding: 10px 16px; border-bottom: 1px solid ${EMAIL_STYLES.colors.border}; text-align: right;">
          <span style="display: inline-block; padding: 4px 10px; background: ${fundingBg}; color: ${fundingColor}; font-size: 11px; font-weight: 600; border-radius: 16px;">
            ${fundingLabel}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  // Build simplified request details
  const requestDetails = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${EMAIL_STYLES.colors.bgCard}; border: 1px solid ${EMAIL_STYLES.colors.border}; border-radius: 8px; padding: 16px 20px;">
      <tr>
        <td style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; color: ${EMAIL_STYLES.colors.textSecondary}; line-height: 1.6;">
          <strong style="color: ${EMAIL_STYLES.colors.textPrimary};">Event:</strong> ${escapeHtml(tripName)}<br>
          <strong style="color: ${EMAIL_STYLES.colors.textPrimary};">Travel Dates:</strong> ${_getTripTravelDates(request)}
        </td>
      </tr>
    </table>
  `;

  const content = `
    <p style="margin: 0 0 20px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    ${_buildSectionHeader(config.labels.attendees)}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${EMAIL_STYLES.colors.bgCard}; border: 1px solid ${EMAIL_STYLES.colors.border}; border-radius: 8px; overflow: hidden; margin: 0 0 24px;">
      <tr>
        <td style="padding: 10px 16px; background: ${EMAIL_STYLES.colors.borderLight}; border-bottom: 1px solid ${EMAIL_STYLES.colors.border};">
          <span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 10px; font-weight: 700; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.05em;">
            Staff Member
          </span>
        </td>
        <td style="padding: 10px 16px; background: ${EMAIL_STYLES.colors.borderLight}; border-bottom: 1px solid ${EMAIL_STYLES.colors.border}; text-align: right;">
          <span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 10px; font-weight: 700; color: ${EMAIL_STYLES.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.05em;">
            Updated Funding
          </span>
        </td>
      </tr>
      ${travelerListHtml}
    </table>
    ${_buildInlineButton(config.ctaText, ddConfirmUrl)}
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${config.contactText}
    </p>
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    content: content,
    hideProgressTracker: true  // DD emails are post-approval, no workflow to show
  });

  // Plain text fallback
  const body = `
${ddName},

The funding information for the staff listed below has been updated. Please review the updated Request(s) in GO.gov and re-confirm travel details for your staff in {{appName}}.

Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Updated Staff: ${travelerNames}

Please click the link below to re-confirm in {{appName}}:
${ddConfirmUrl}

Your approval in {{appName}} certifies that you have reviewed the updated Request in GO.gov and verified that the correct line of accounting has been selected for the trip. Once confirmed, the travel request will be closed out. If you have any questions or require further clarification, please contact {{contactEmail}}.

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: ddGroup.ddEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Send DD funding issue notification to submitter
 * Uses the master template for consistent branding
 *
 * @param {Object} request - Request data { tripName, submitterEmail, submitterName, requestId }
 * @param {Object} reporter - Who reported the issue { name, email }
 * @param {Array} flaggedTravelers - Array of { employeeName, currentFunding }
 * @param {string} description - Issue description
 * @returns {Object} Result with success status
 */
function sendDDFundingIssueEmail(request, reporter, flaggedTravelers, description) {
  const config = EMAIL_CONTENT.ddFundingIssue;

  if (!request || !request.submitterEmail || !_isValidEmail(request.submitterEmail)) {
    return { success: false, error: 'No valid submitter email provided' };
  }

  const submitterName = request.submitterName || _formatEmailUserName(request.submitterEmail);
  const ddName = reporter.name || 'the Division Director';
  const tripName = request.tripName || 'Travel Request';
  const travelerNamesList = _getTravelerNames(request.travelers, ' • ');
  const portalUrl = getPortalUrl();

  const subject = config.subject.replace('{{requestId}}', request.requestId || 'N/A');

  // Build intro with personalization
  const introText = config.intro
    .replace('{{submitterName}}', escapeHtml(submitterName))
    .replace('{{ddName}}', escapeHtml(ddName));

  // Build contact text with DD name
  const contactText = config.contactText.replace('{{ddName}}', escapeHtml(ddName));

  // Build flagged travelers HTML
  const flaggedTravelersHtml = (flaggedTravelers || []).map(t => {
    const name = t.employeeName ? formatTravelerNameForEmail(t.employeeName) : 'Unknown';
    const funding = t.currentFunding || 'Unknown';
    const isClient = funding === 'Client-Paid' || funding.toLowerCase().includes('client');

    return `
      <tr>
        <td style="padding: 10px 16px; border-bottom: 1px solid #FECACA;">
          <span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 14px; font-weight: 500; color: ${EMAIL_STYLES.colors.errorText};">
            ${escapeHtml(name)}
          </span>
        </td>
        <td style="padding: 10px 16px; border-bottom: 1px solid #FECACA; text-align: right;">
          <span style="display: inline-block; padding: 4px 10px; background: ${isClient ? '#DCFCE7' : '#E0F2FE'}; color: ${isClient ? '#15803D' : '#0369A1'}; font-size: 11px; font-weight: 600; border-radius: 16px;">
            ${isClient ? 'Client-Paid' : 'GSA-Paid'}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  // Build request details using helper
  const requestDetails = _buildSimplifiedRequestDetails(
    tripName,
    _getTripTravelDates(request),
    travelerNamesList || 'N/A'
  );

  const content = `
    <p style="margin: 0 0 16px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${introText}
    </p>
    ${description ? `
    ${_buildSectionHeader(config.issueTitle)}
    ${_buildFeedbackBox(description, 'warning')}
    ` : ''}
    ${flaggedTravelers && flaggedTravelers.length > 0 ? `
    <h2 style="margin: 0 0 12px; font-family: ${EMAIL_STYLES.fonts.family}; font-size: 12px; font-weight: 700; color: ${EMAIL_STYLES.colors.error}; text-transform: uppercase; letter-spacing: 0.08em;">
      ${config.flaggedTitle}
    </h2>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${EMAIL_STYLES.colors.errorBg}; border: 1px solid #FECACA; border-radius: 8px; overflow: hidden; margin: 0 0 24px;">
      <tr>
        <td style="padding: 10px 16px; background: #FEE2E2; border-bottom: 1px solid #FECACA;">
          <span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 10px; font-weight: 700; color: ${EMAIL_STYLES.colors.errorDark}; text-transform: uppercase; letter-spacing: 0.05em;">
            Attendee
          </span>
        </td>
        <td style="padding: 10px 16px; background: #FEE2E2; border-bottom: 1px solid #FECACA; text-align: right;">
          <span style="font-family: ${EMAIL_STYLES.fonts.family}; font-size: 10px; font-weight: 700; color: ${EMAIL_STYLES.colors.errorDark}; text-transform: uppercase; letter-spacing: 0.05em;">
            Current Funding
          </span>
        </td>
      </tr>
      ${flaggedTravelersHtml}
    </table>
    ` : ''}
    ${_buildInlineButton(config.ctaText, portalUrl)}
    <p style="margin: 0 0 24px; font-family: ${EMAIL_STYLES.fonts.family}; color: ${EMAIL_STYLES.colors.textBody}; font-size: 15px; line-height: 1.5;">
      ${contactText}
    </p>
    ${_buildSectionHeader('Request Details')}
    ${requestDetails}
  `;

  const htmlBody = _buildEmailTemplate({
    title: config.title,
    subtitle: tripName,
    content: content,
    hideProgressTracker: true  // DD emails are post-approval, no workflow to show
  });

  // Plain text fallback
  const flaggedNames = (flaggedTravelers || []).map(t => t.employeeName).join(', ');
  const body = `
${submitterName},

${ddName} has flagged a funding discrepancy for the attendee(s) listed below. Please review and update the funding information in {{appName}}, then resubmit for confirmation.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}

ATTENDEE(S) REQUIRING UPDATE
────────────────────────────
${flaggedNames || 'None specified'}

${description ? `ISSUE DETAILS\n─────────────\n${description}\n\n` : ''}Update funding at: ${portalUrl}

If you have questions about this funding issue, please contact ${ddName} directly.

---
{{senderName}}
  `.trim();

  return sendTravelEmail({
    to: request.submitterEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Helper to format traveler name for email display
 * Converts "LastName,FirstName M" to "FirstName LastName"
 */
function formatTravelerNameForEmail(name) {
  if (!name) return '';
  if (name.includes(',')) {
    const parts = name.split(',');
    const lastName = parts[0].trim();
    const firstPart = parts[1] ? parts[1].trim().split(/\s+/)[0] : '';
    return firstPart + ' ' + lastName;
  }
  return name;
}

/**
 * Helper to escape HTML characters
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Test email sending configuration
 * Sends a test email to verify delegated sending is working correctly
 */
function _testTravelEmailConfig() {
  const testEmail = Session.getActiveUser().getEmail();
  const senderEmail = getTravelEmailAddress();

  console.log(`Testing travel email config:`);
  console.log(`- Sender: ${senderEmail}`);
  console.log(`- Test recipient: ${testEmail}`);
  console.log(`- Current user: ${Session.getActiveUser().getEmail()}`);

  const result = sendTravelEmail({
    to: testEmail,
    subject: _brand().sender + ' Email Test - Delegated Sending',
    body: `This is a test email from the ${_brand().app} travel request system.

If you received this email FROM: ${senderEmail} (not just reply-to), then delegated sending is working correctly!

Check the "From" field in your email client to verify.

Timestamp: ${new Date().toISOString()}

---
${_brand().sender}`
  });

  console.log('Test result:', JSON.stringify(result, null, 2));

  if (result.success) {
    console.log(`✓ Email sent successfully using: ${result.method}`);
    if (result.fallback) {
      console.log('⚠ Note: Using fallback method - Gmail API may not be configured correctly');
    } else if (result.method === 'GmailAPI') {
      console.log('✓ Gmail API delegated sending is working!');
    }
  } else {
    console.log(`✗ Email failed: ${result.error}`);
  }

  return result;
}

/**
 * Test all email templates by sending samples to your inbox
 * Sends one of each email type so you can preview the designs
 *
 * Run this function from the Apps Script editor to see all email templates
 */
/**
 * Test just the submission confirmation email
 * Run this from Apps Script editor to test the redesigned submission email
 */
function _testSubmissionEmail() {
  const testEmail = Session.getActiveUser().getEmail();
  const userName = _formatEmailUserName(testEmail);

  console.log(`Sending test submission email to: ${testEmail}`);
  console.log('─────────────────────────────────────');

  // Test data
  const testRequestId = 'TR-2026-TEST-' + Date.now();
  const testFormData = {
    submitterEmail: testEmail,
    submitterName: userName,
    tripName: 'Annual IT Conference',
    eventName: 'Annual IT Conference',
    eventStartDate: '03/15/2026',
    eventEndDate: '03/20/2026',
    legs: [
      { startDate: '03/14/2026', endDate: '03/16/2026' },
      { startDate: '03/20/2026', endDate: '03/22/2026' }
    ],
    travelers: [
      { employeeName: 'John Smith', id: 'traveler1' },
      { employeeName: 'Jane Doe', id: 'traveler2' }
    ]
  };

  const testReviewer = {
    name: 'Sarah Johnson',
    email: testEmail
  };

  console.log('Sending: Submission Confirmation...');
  try {
    const result = sendSubmitterConfirmation(testRequestId, testFormData, testReviewer);
    console.log(`✓ ${result.success ? 'SENT SUCCESSFULLY!' : 'Failed'}`);
    console.log(`Check your inbox: ${testEmail}`);
    return result;
  } catch (e) {
    console.error(`✗ Error: ${e.message}`);
    throw e;
  }
}

function _testAllEmailTemplates() {
  const testEmail = Session.getActiveUser().getEmail();
  const userName = _formatEmailUserName(testEmail);

  console.log(`Sending ALL 14 test emails to: ${testEmail}`);
  console.log('─────────────────────────────────────');

  // Test data
  const testRequestId = 'TR-2026-TEST-' + Date.now();
  const testFormData = {
    submitterEmail: testEmail,
    submitterName: userName,
    tripName: 'Annual IT Conference',
    eventName: 'Annual IT Conference',
    eventStartDate: '03/15/2026',
    eventEndDate: '03/20/2026',
    legs: [
      { startDate: '03/14/2026', endDate: '03/16/2026' },
      { startDate: '03/20/2026', endDate: '03/22/2026' }
    ],
    travelers: [
      { employeeName: 'John Smith', id: 'traveler1', isClientPaid: false },
      { employeeName: 'Jane Doe', id: 'traveler2', isClientPaid: true }
    ]
  };

  const testReviewer = {
    name: 'Sarah Johnson',
    email: testEmail
  };

  const testRequest = {
    submitterEmail: testEmail,
    submitterName: userName,
    tripName: 'Annual IT Conference',
    eventStartDate: '03/15/2026',
    eventEndDate: '03/20/2026',
    legs: [
      { startDate: '03/14/2026', endDate: '03/16/2026' },
      { startDate: '03/20/2026', endDate: '03/22/2026' }
    ],
    travelers: testFormData.travelers,
    requestId: testRequestId
  };

  const testDDGroup = {
    ddName: 'Michael Director',
    ddEmail: testEmail,
    travelers: [
      { employeeName: 'John Smith', isClientPaid: false },
      { employeeName: 'Jane Doe', isClientPaid: true }
    ]
  };

  const results = [];

  // Helper to run a test
  function runTest(num, name, fn) {
    console.log(`${num}. Sending: ${name}...`);
    try {
      const result = fn();
      results.push({ type: name, success: result.success });
      console.log(`   ${result.success ? '✓ Sent' : '✗ Failed'}`);
    } catch (e) {
      results.push({ type: name, success: false, error: e.message });
      console.log(`   ✗ Error: ${e.message}`);
    }
    Utilities.sleep(500);
  }

  // 1. Submission Confirmation
  runTest(1, 'Submission Confirmation', () =>
    sendSubmitterConfirmation(testRequestId, testFormData, testReviewer, 'BU')
  );

  // 2. Reviewer Notification
  runTest(2, 'Reviewer Notification', () =>
    sendReviewerNotification(testRequestId, testFormData, testReviewer, 'BU')
  );

  // 3. Resubmission Notification
  runTest(3, 'Resubmission Notification', () =>
    sendResubmissionNotification(testRequestId, testFormData, testReviewer, 'BU')
  );

  // 4. Needs More Info
  runTest(4, 'Needs More Info', () =>
    sendNeedsInfoNotification(
      testRequestId,
      testRequest,
      testReviewer.name,
      'The itinerary needs clarification on travel dates and destinations.',
      { trip_overview: 'Please provide conference agenda', costs: 'Break down costs by category' },
      'BU'
    )
  );

  // 5. Approval Notification
  runTest(5, 'Approval Notification', () =>
    sendApprovalNotification(testRequestId, testRequest, 'BU', '', {
      approverName: testReviewer.name,
      nextReviewerName: 'FO Reviewer',
      isFinal: false
    })
  );

  // 6. Reviewer Approval Confirmation
  runTest(6, 'Reviewer Approval Confirmation', () =>
    sendReviewerApprovalConfirmation(testRequestId, testRequest, testReviewer, 'FO Reviewer', 'BU')
  );

  // 7. Advancing to FAS
  runTest(7, 'Advancing to FAS', () =>
    sendAdvancingToFasNotification(testRequestId, testRequest, 'Alex FO-Reviewer')
  );

  // 8. FAS Approval (Final)
  runTest(8, 'FAS Approval', () =>
    sendFasApprovalNotification(testRequestId, testRequest)
  );

  // 9. Proceed with Booking (Client-Paid)
  runTest(9, 'Proceed with Booking', () =>
    sendProceedWithBookingNotification(testRequestId, testRequest, 'Alex FO-Reviewer', 'Bob BU-Reviewer')
  );

  // 10. Denial Notification
  runTest(10, 'Denial Notification', () =>
    sendDenialNotification(
      testRequestId,
      testRequest,
      testReviewer.name,
      'The conference does not align with current fiscal year training priorities.',
      'BU'
    )
  );

  // 11. Cancellation Notification
  runTest(11, 'Cancellation Notification', () =>
    sendCancellationNotification(
      testRequestId,
      testRequest,
      testReviewer.name,
      'The event has been postponed. Please resubmit when new dates are confirmed.',
      'BU'
    )
  );

  // 12. DD Confirmation
  runTest(12, 'DD Confirmation', () =>
    sendDDConfirmationEmail(testDDGroup, testRequest)
  );

  // 13. DD Re-confirmation
  runTest(13, 'DD Re-confirmation', () =>
    sendDDReconfirmationEmail(testDDGroup, testRequest)
  );

  // 14. DD Funding Issue
  runTest(14, 'DD Funding Issue', () =>
    sendDDFundingIssueEmail(
      testRequest,
      { name: 'Michael Director', email: testEmail },
      [{ employeeName: 'John Smith', currentFunding: 'GSA-Paid' }],
      'GO.gov authorization shows Client-Paid but request shows GSA-Paid. Please verify correct funding source.'
    )
  );

  // Summary
  console.log('─────────────────────────────────────');
  console.log('TEST SUMMARY:');
  const successCount = results.filter(r => r.success).length;
  console.log(`✓ ${successCount} of ${results.length} emails sent successfully`);
  console.log('');
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.type}: ${r.success ? '✓' : '✗ ' + (r.error || 'Failed')}`);
  });
  console.log('');
  console.log('Check your inbox for the test emails!');
  console.log(`Recipient: ${testEmail}`);

  return {
    testEmail: testEmail,
    results: results,
    successCount: successCount,
    totalCount: results.length
  };
}

/**
 * Format user name from email for email display (internal helper)
 * Returns full "First Last" format for better email readability
 * @param {string} email - User email
 * @returns {string} Formatted name
 * @private
 */
function _formatEmailUserName(email) {
  if (!email) return 'User';
  const name = email.split('@')[0];
  return name
    .split('.')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// ============================================================================
// TEST SUBMITTERS — emails skipped entirely when one of these users acts
// ============================================================================

/**
 * True if the currently-acting user has Suppress_Emails=TRUE in the
 * Test_Submitters sheet. Read goes through TravelDB so it's cached for
 * the rest of the execution. Returns false on any error (Session,
 * sheet missing, etc.) so a misconfigured row never breaks email.
 * @private
 */
function _isTestSubmitter() {
  try {
    const active = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (!active) return false;

    const tdb = new TravelDB();
    const sheetData = tdb.readSheet(SHEET_NAMES.TEST_SUBMITTERS);
    const rows = sheetData.rows || [];
    const idx = sheetData.headerIndex || {};
    if (idx['Email'] === undefined || idx['Suppress_Emails'] === undefined) return false;

    for (const row of rows) {
      const rowEmail = String(row[idx['Email']] || '').trim().toLowerCase();
      if (rowEmail !== active) continue;
      const flag = row[idx['Suppress_Emails']];
      return flag === true || String(flag).toUpperCase() === 'TRUE';
    }
    return false;
  } catch (e) {
    return false;
  }
}
