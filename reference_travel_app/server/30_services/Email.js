/**
 * TravelEmailService.js
 * Centralized email service for the Travel Request system
 *
 * All travel-related emails should be sent via this service to ensure
 * consistent sender address (aastravel@gsa.gov) and formatting.
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
// CORE EMAIL FUNCTION
// ============================================================================

/**
 * Send an email from the travel system
 * Uses GmailApp with send-as alias for aastravel@gsa.gov
 *
 * IMPORTANT: aastravel@gsa.gov must be configured as a send-as alias
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
    if (_isTestSubmitter()) {
      console.log('sendTravelEmail: active user is a test submitter, skipping send (subject="' + options.subject + '")');
      return { success: true, suppressed: true, reason: 'test-submitter' };
    }

    const senderEmail = getTravelEmailAddress();
    const senderName = getTravelEmailName();

    // Try GmailApp first (supports send-as alias)
    try {
      GmailApp.sendEmail(options.to, options.subject, options.body, {
        name: senderName,
        from: senderEmail,
        replyTo: senderEmail,
        htmlBody: options.htmlBody,
        cc: options.cc,
        bcc: options.bcc
      });

      console.log(`Email sent via GmailApp to ${options.to} from ${senderEmail}`);
      return { success: true, method: 'GmailApp' };

    } catch (gmailAppError) {
      console.warn('GmailApp failed, trying MailApp fallback:', gmailAppError.message);

      // Fallback to MailApp (sends with reply-to only)
      MailApp.sendEmail({
        to: options.to,
        subject: options.subject,
        body: options.body,
        name: senderName,
        replyTo: senderEmail,
        htmlBody: options.htmlBody,
        cc: options.cc,
        bcc: options.bcc
      });

      console.log(`Email sent via MailApp to ${options.to} (fallback - reply-to: ${senderEmail})`);
      return { success: true, method: 'MailApp', fallback: true };
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
// Full workflow: SD → BU → FO → FAS (overhead travel, SD-level submitter)
const WORKFLOW_STAGES_FULL = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'sector_review', label: 'SD' },
  { id: 'bu_review', label: 'BU' },
  { id: 'oso_review', label: 'AAS FO' },
  { id: 'fas_submission', label: 'FAS' }
];

// No SD: BU → FO → FAS (overhead travel, BU-level submitter)
const WORKFLOW_STAGES_NO_SECTOR = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'bu_review', label: 'BU' },
  { id: 'oso_review', label: 'AAS FO' },
  { id: 'fas_submission', label: 'FAS' }
];

// No FAS: SD → BU → FO (client-paid travel, SD-level submitter)
const WORKFLOW_STAGES_NO_FAS = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'sector_review', label: 'SD' },
  { id: 'bu_review', label: 'BU' },
  { id: 'oso_review', label: 'AAS FO' }
];

// No SD, No FAS: BU → FO (client-paid travel, BU-level submitter)
const WORKFLOW_STAGES_MINIMAL = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'bu_review', label: 'BU' },
  { id: 'oso_review', label: 'AAS FO' }
];

// Default workflow (full)
const WORKFLOW_STAGES = WORKFLOW_STAGES_FULL;

// ============================================================================
// EMAIL CONTENT CONFIGURATION
// ============================================================================

/**
 * Centralized email content configuration
 * This structure enables future admin editing without code changes
 */
const EMAIL_CONTENT = {
  // Global settings used across all emails
  global: {
    senderName: 'AAS TRIP',
    contactEmail: 'aastravel@gsa.gov',
    systemName: 'AAS TRIP',
    footerText: 'This is an automated notification from the AAS TRIP system.',
    orgLine: 'GENERAL SERVICES ADMINISTRATION • ASSISTED ACQUISITION SERVICES'
  },

  // Submission confirmation to submitter
  submitterConfirmation: {
    subject: 'TRIP Request {{requestId}} Has Been Submitted',
    title: 'Request Submitted',
    intro: '{{submitterName}},<br><br>Your TRIP request has been submitted and is now pending review by <strong>{{reviewerName}}</strong>. You will receive notifications as your request progresses.',
    ctaText: 'Open TRIP Request',
    noActionText: 'No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.',
    contactText: 'If you have questions in the meantime, please contact <a href="mailto:aastravel@gsa.gov" style="color: #2563EB; text-decoration: none;">aastravel@gsa.gov</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Review notification to reviewer (new request)
  reviewerNotification: {
    subject: 'TRIP Request {{requestId}} - New Mission-Critical Travel Request Ready for Review',
    title: 'Review Required',
    intro: '{{reviewerName}},<br><br>A new mission-critical travel request has been submitted and requires your review. Please review the request at your earliest convenience and take the appropriate action in AAS TRIP.',
    contactText: 'If you have any questions, please contact <strong>{{submitterName}}</strong> directly.',
    ctaText: 'Review TRIP Request',
    labels: {
      event: 'Event',
      submittedBy: 'Submitted By',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Resubmission notification to reviewer (after Needs Info)
  resubmissionNotification: {
    subject: 'TRIP Request {{requestId}} - Revised Mission-Critical Travel Request Resubmitted for Review',
    title: 'Request Resubmitted',
    intro: '{{reviewerName}},<br><br>A previously submitted mission-critical travel request has been revised and now requires your review. Please review the request at your earliest convenience and take the appropriate action in AAS TRIP.',
    contactText: 'If you have any questions, please contact <strong>{{submitterName}}</strong> directly.',
    ctaText: 'Review TRIP Request',
    labels: {
      event: 'Event',
      submittedBy: 'Submitted By',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Reviewer approval confirmation (sent to reviewer after they approve)
  reviewerApprovalConfirmation: {
    subject: 'TRIP Request {{requestId}} - Approved and Advancing to {{nextReviewerName}} for Review',
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
    subject: 'TRIP Request {{requestId}} - Additional Information Required',
    title: 'Additional Information Required',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed by <strong>{{reviewerName}}</strong>, and additional information is required before the review can be completed.',
    ctaText: 'Update TRIP Request',
    feedbackTitle: 'Reviewer Feedback',
    nextStepsText: 'Please review the comments above and provide the requested information by updating your submission in AAS TRIP. Once updated, the request will resume routing.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Approval notification to submitter (stage advancement)
  approvalNotification: {
    subject: 'TRIP Request {{requestId}} Approved by {{approverName}} - Advancing to {{nextReviewerName}} for Review',
    subjectFinal: 'TRIP Request {{requestId}} Approved by {{approverName}} - Request Complete',
    title: 'Approved by {{stage}}',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed and approved by <strong>{{approverName}}</strong> and is now advancing to <strong>{{nextReviewerName}}</strong> for review.',
    introFinal: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed and approved by <strong>{{approverName}}</strong>. Your request is now complete!',
    noActionText: 'No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.',
    contactText: 'If you have questions in the meantime, please contact <a href="mailto:aastravel@gsa.gov" style="color: #2563EB; text-decoration: none;">aastravel@gsa.gov</a>.',
    ctaText: 'Open TRIP Request',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    },
    stageNames: {
      Sector: 'SD',
      BU: 'BU',
      OSO: 'AAS FO',
      FAS: 'FAS'
    }
  },

  // Advancing to FAS notification (overhead travel approved at FO)
  advancingToFas: {
    subject: 'TRIP Request {{requestId}} Approved by {{foReviewerName}} - Advancing to FAS for Review',
    title: 'Advancing to FAS',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed and approved by AAS Chief of Staff <strong>{{foReviewerName}}</strong> and is now advancing to the FAS Front Office for review.',
    noActionText: 'No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.',
    contactText: 'If you have questions in the meantime, please contact <a href="mailto:aastravel@gsa.gov" style="color: #2563EB; text-decoration: none;">aastravel@gsa.gov</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // FAS approval notification (overhead travel approved by FAS)
  fasApproval: {
    subject: 'TRIP Request {{requestId}} - Proceed with Booking Travel',
    title: 'Ready to Book',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has completed the full review process and has been approved by the FAS Front Office.',
    bookingInstructions: 'You may now proceed with making travel arrangements in <a href="https://go.gov" style="color: #2563EB; text-decoration: none;">GO.gov</a> in accordance with applicable policies and procedures.',
    contactText: 'If you have any further questions regarding this request, please contact <a href="mailto:aastravel@gsa.gov" style="color: #2563EB; text-decoration: none;">aastravel@gsa.gov</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Proceed with booking notification (client-paid travel approved at FO)
  proceedWithBooking: {
    subject: 'TRIP Request {{requestId}} - Proceed with Booking Travel',
    title: 'Ready to Book',
    intro: '{{submitterName}},<br><br>Your mission-critical travel request has been reviewed and approved by AAS Chief of Staff <strong>{{foReviewerName}}</strong>.',
    bookingInstructions: 'You may now proceed with making travel arrangements in <a href="https://go.gov" style="color: #2563EB; text-decoration: none;">GO.gov</a> in accordance with applicable policies and procedures.',
    contactText: 'If you have any further questions regarding this request, please contact <strong>{{buReviewerName}}</strong> directly. Questions regarding GO.gov may be referred to <a href="mailto:aastravel@gsa.gov" style="color: #2563EB; text-decoration: none;">aastravel@gsa.gov</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Attendee(s)'
    }
  },

  // Denial notification to submitter
  denialNotification: {
    subject: 'TRIP Request {{requestId}} - Denied by {{reviewerName}}',
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
    subject: 'TRIP Request {{requestId}} - Canceled by {{reviewerName}}',
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
    subject: 'TRIP Request {{requestId}} - Please Review and Confirm Travel Details in AAS TRIP',
    title: 'Confirmation Required',
    intro: '{{ddName}},<br><br>The staff listed below have been approved to participate in mission-critical travel. After reviewing their Request(s) in <a href="https://go.gov" style="color: #2563EB; text-decoration: none;">GO.gov</a>, please review and confirm travel details for your staff in AAS TRIP.',
    ctaText: 'Confirm in AAS TRIP',
    contactText: '<strong>Your approval in AAS TRIP certifies that you have reviewed the Request in GO.gov and verified that the correct line of accounting has been selected for the trip.</strong> Once confirmed, the travel request will be closed out. If you have any questions or require further clarification, please contact <a href="mailto:aastravel@gsa.gov" style="color: #2563EB; text-decoration: none;">aastravel@gsa.gov</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Staff Requiring Confirmation'
    }
  },

  // DD re-confirmation email (after correction)
  ddReconfirmation: {
    subject: 'TRIP Request {{requestId}} - Please Review and Re-confirm Travel Details in AAS TRIP',
    title: 'Re-confirmation Required',
    intro: '{{ddName}},<br><br>The funding information for the staff listed below has been updated. Please review the updated Request(s) in <a href="https://go.gov" style="color: #2563EB; text-decoration: none;">GO.gov</a> and re-confirm travel details for your staff in AAS TRIP.',
    ctaText: 'Re-confirm in AAS TRIP',
    contactText: '<strong>Your approval in AAS TRIP certifies that you have reviewed the updated Request in GO.gov and verified that the correct line of accounting has been selected for the trip.</strong> Once confirmed, the travel request will be closed out. If you have any questions or require further clarification, please contact <a href="mailto:aastravel@gsa.gov" style="color: #2563EB; text-decoration: none;">aastravel@gsa.gov</a>.',
    labels: {
      event: 'Event',
      travelDates: 'Travel Dates',
      attendees: 'Updated Staff'
    }
  },

  // DD funding issue notification to submitter
  ddFundingIssue: {
    subject: 'TRIP Request {{requestId}} - Funding Correction Required',
    title: 'Funding Correction Required',
    intro: '{{submitterName}},<br><br><strong>{{ddName}}</strong> has flagged a funding discrepancy for the attendee(s) listed below. Please review and update the funding information in AAS TRIP, then resubmit for confirmation.',
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
 * AAS Travel Logo - Base64 Encoded Image
 *
 * TO UPDATE THE LOGO:
 * 1. Create/edit your logo PNG file (recommended: 600px wide max, transparent background)
 * 2. Convert to base64 at: https://www.base64-image.de/
 * 3. Paste the base64 string below (replace the empty string)
 *
 * Example: const TRAVEL_LOGO_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAA...';
 *
 * Leave empty ('') to use the fallback text logo
 */
const TRAVEL_LOGO_BASE64 = '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';
 
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
        <img src="data:image/png;base64,${TRAVEL_LOGO_BASE64}" alt="AAS TRIP" style="max-width: 240px; height: auto; display: block; margin: ${centered ? '0 auto' : '0'};" />
      </div>
    `;
  }

  // Option 2: Check for Google Drive hosted image (from Properties Service)
  const driveFileId = getTravelLogoDriveFileId();
  if (driveFileId) {
    const imageUrl = `https://drive.google.com/uc?export=view&id=${driveFileId}`;
    return `
      <div style="text-align: ${alignment}; margin: ${margin};">
        <img src="${imageUrl}" alt="AAS TRIP" style="max-width: 200px; height: auto; display: block; margin: ${centered ? '0 auto' : '0'};" />
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
      <!-- TRIP brand -->
      <div style="margin: 0 0 4px;">
        <span style="font-family: Arial, sans-serif; font-size: 36px; font-weight: bold; color: #004f87; letter-spacing: 3px; text-transform: uppercase;">
          TRIP
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
function _buildProgressTracker(currentStage, status = 'pending', stages = WORKFLOW_STAGES) {
  const stageIndex = stages.findIndex(s => s.id === currentStage);

  // Build the dots row - compact design with smaller dots
  const dotsRow = stages.map((stage, index) => {
    let bgColor = '#E5E7EB';
    let textColor = '#9CA3AF';
    let icon = '';
    let dotSize = '20px'; // Smaller base size

    if (index < stageIndex) {
      // Completed
      bgColor = '#10B981';
      textColor = '#FFFFFF';
      icon = '✓';
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
function _buildEmailTemplate(options) {
  const {
    title,
    subtitle = '',
    currentStage = 'submitted',
    status = 'pending',
    content,
    ctaText,
    ctaUrl,
    stages = WORKFLOW_STAGES,
    hideProgressTracker = false
  } = options;

  const logo = _buildAASLogo();
  const progressTracker = hideProgressTracker ? '' : _buildProgressTracker(currentStage, status, stages);

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

  const ctaButton = ctaText && ctaUrl ? `
    <div style="text-align: center; margin: 40px 0 0;">
      <a href="${ctaUrl}" target="_blank" style="display: inline-block; background: ${accentColor}; color: #FFFFFF; text-decoration: none; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); letter-spacing: 0.01em;">
        ${ctaText}
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
  <title>${title}</title>
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
                      ${title}
                    </h1>
                    ${subtitle ? `<p style="margin: 0; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 16px; font-weight: 500; color: #6B7280; line-height: 1.4; text-align: left;">${subtitle}</p>` : ''}
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
              ${content}
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
                      AAS TRIP
                    </p>
                    <p style="margin: 0; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 12px; font-weight: 400; color: #6B7280; line-height: 1.6;">
                      Questions? Email <a href="mailto:aastravel@gsa.gov" style="color: #2563EB; text-decoration: none;">aastravel@gsa.gov</a>
                    </p>
                    <div style="margin: 16px 0 0; padding-top: 16px; border-top: 1px solid #E5E7EB;">
                      <p style="margin: 0; font-family: Calibri, 'Calibri', Arial, sans-serif; font-size: 10px; color: #9CA3AF; letter-spacing: 0.03em;">
                        GENERAL SERVICES ADMINISTRATION • ASSISTED ACQUISITION SERVICES
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

  // Progressive: add reviewers up to and including the current stage
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
  const reviewerName = reviewer && reviewer.name ? reviewer.name : 'your assigned reviewer';
  const currentStage = STAGE_MAP[reviewLevel] || 'bu_review';

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
    stages: _isAllClientPaid ? WORKFLOW_STAGES_NO_FAS : WORKFLOW_STAGES_FULL
  });

  // Plain text fallback
  const body = `
${submitterName},

Your TRIP request has been submitted and is now pending review by ${reviewerName}. You will receive notifications as your request progresses.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(formData)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.

If you have questions in the meantime, please contact aastravel@gsa.gov.

---
AAS TRIP
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
    stages: _isAllClientPaid ? WORKFLOW_STAGES_NO_FAS : WORKFLOW_STAGES_FULL
  });

  // Plain text fallback
  const body = `
${reviewerName},

A new mission-critical travel request has been submitted and requires your review. Please review the request at your earliest convenience and take the appropriate action in AAS TRIP.

REQUEST DETAILS
───────────────
Event: ${tripName}
Submitted By: ${submitterName}
Travel Dates: ${_getTripTravelDates(formData)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

If you have any questions, please contact ${submitterName} directly.

---
AAS TRIP
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
    stages: _isAllClientPaid ? WORKFLOW_STAGES_NO_FAS : WORKFLOW_STAGES_FULL
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

Please review the comments above and provide the requested information by updating your submission in AAS TRIP. Once updated, the request will resume routing.

---
AAS TRIP
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
    stages: isAllClientPaid ? WORKFLOW_STAGES_NO_FAS : WORKFLOW_STAGES_FULL
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

If you have questions, please contact aastravel@gsa.gov.

---
AAS TRIP
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

If you have questions in the meantime, please contact aastravel@gsa.gov.

---
AAS TRIP
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
    stages: _isAllClientPaid ? WORKFLOW_STAGES_NO_FAS : WORKFLOW_STAGES_FULL
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
AAS TRIP
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
    stages: _isAllClientPaid ? WORKFLOW_STAGES_NO_FAS : WORKFLOW_STAGES_FULL
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
AAS TRIP
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
    stages: _isAllClientPaid ? WORKFLOW_STAGES_NO_FAS : WORKFLOW_STAGES_FULL
  });

  // Plain text fallback
  const body = `
${reviewerName},

A previously submitted mission-critical travel request has been revised and now requires your review. Please review the request at your earliest convenience and take the appropriate action in AAS TRIP.

REQUEST DETAILS
───────────────
Event: ${tripName}
Submitted By: ${submitterName}
Travel Dates: ${_getTripTravelDates(formData)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

If you have any questions, please contact ${submitterName} directly.

---
AAS TRIP
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

    const subject = `TRIP Request ${requestId} — Reassigned to you for review`;

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
          Open the request in TRIP to review and take action.
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

    const subject = `TRIP — ${requests.length} request${requests.length === 1 ? '' : 's'} reassigned to you`;

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
    stages: isAllClientPaid ? WORKFLOW_STAGES_NO_FAS : WORKFLOW_STAGES_FULL
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
AAS TRIP
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

Your mission-critical travel request has been reviewed and approved by AAS Chief of Staff ${foReviewerName} and is now advancing to the FAS Front Office for review.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNames || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

No action is required from you at this time. You will be notified if additional information is needed or once a final determination is made.

If you have questions in the meantime, please contact aastravel@gsa.gov.

---
AAS TRIP
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

  const subject = 'TRIP Request ' + requestId + ' - NEW Overhead Travel Request Pending Your Review';

  // Build intro with personalization
  const introText = (reviewerName + ',<br><br>An overhead mission-critical travel request has been approved by AAS leadership and now requires FAS Front Office review. Please review the request at your earliest convenience and take the appropriate action in AAS TRIP.');
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
    ctaText: 'Review TRIP Request',
    ctaUrl: getReviewUrl(requestId)
  });

  // Plain text fallback
  const body = `
${reviewerName},

An overhead mission-critical travel request has been approved by AAS leadership and now requires FAS Front Office review.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(formData)}
Submitted By: ${submitterName}
Attendee(s): ${travelerNames || travelerCount + ' attendee' + (travelerCount !== 1 ? 's' : '')}

Please review the request in AAS TRIP and take the appropriate action (approve or deny).

If you have any questions, please contact Jennifer C. directly.

---
AAS TRIP
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
            Please follow the Salesforce Procedures outlined in the <a href="https://docs.google.com/document/d/10-QK4ur6xRCFQJEiRhJa69y-VH6vdImxc23D53pTBMI/edit?tab=t.i0zc0igzda9j" style="color: #2563EB; text-decoration: none;">AAS Travel SOP</a> prior to booking travel.
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
    stages: WORKFLOW_STAGES_FULL,
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

${hasConferenceType ? 'Salesforce Submission: Please follow the Salesforce Procedures outlined in the AAS Travel SOP prior to booking travel.\nhttps://docs.google.com/document/d/10-QK4ur6xRCFQJEiRhJa69y-VH6vdImxc23D53pTBMI/edit?tab=t.i0zc0igzda9j\n\nGO.gov: Following Salesforce approval, proceed with making travel arrangements in GO.gov in accordance with applicable policies and procedures.' : 'You may now proceed with making travel arrangements in GO.gov in accordance with applicable policies and procedures.'}

If you have any further questions regarding this request, please contact aastravel@gsa.gov.

---
AAS TRIP
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
  const contactText = config.contactText.replace('{{buReviewerName}}', escapeHtml(buReviewerName || 'your BU reviewer'));

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
            Please follow the Salesforce Procedures outlined in the <a href="https://docs.google.com/document/d/10-QK4ur6xRCFQJEiRhJa69y-VH6vdImxc23D53pTBMI/edit?tab=t.i0zc0igzda9j" style="color: #2563EB; text-decoration: none;">AAS Travel SOP</a> prior to booking travel.
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
    stages: WORKFLOW_STAGES_NO_FAS, // Client-paid travel doesn't go to FAS
    content: content
    // No CTA button - they should go to GO.gov
  });

  // Plain text fallback
  const body = `
${submitterName},

Your mission-critical travel request has been reviewed and approved by AAS Chief of Staff ${foReviewerName}.

REQUEST DETAILS
───────────────
Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Attendee(s): ${travelerNamesList || `${travelerCount} attendee${travelerCount !== 1 ? 's' : ''}`}

${isInternational ? 'Salesforce Submission: Please follow the Salesforce Procedures outlined in the AAS Travel SOP prior to booking travel.\nhttps://docs.google.com/document/d/10-QK4ur6xRCFQJEiRhJa69y-VH6vdImxc23D53pTBMI/edit?tab=t.i0zc0igzda9j\n\nGO.gov: Following Salesforce approval, proceed with making travel arrangements in GO.gov in accordance with applicable policies and procedures.' : 'You may now proceed with making travel arrangements in GO.gov in accordance with applicable policies and procedures.'}

If you have any further questions regarding this request, please contact ${buReviewerName || 'your BU reviewer'} directly. Questions regarding GO.gov may be referred to aastravel@gsa.gov.

---
AAS TRIP
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
    const fundingLabel = isClientPaid ? 'Client-Paid' : 'Overhead';
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

The staff listed below have been approved to participate in mission-critical travel. After reviewing their Request(s) in GO.gov, please review and confirm travel details for your staff in AAS TRIP.

Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Staff Requiring Confirmation: ${travelerNames}

Please click the link below to confirm in AAS TRIP:
${ddConfirmUrl}

Your approval in AAS TRIP certifies that you have reviewed the Request in GO.gov and verified that the correct line of accounting has been selected for the trip. Once confirmed, the travel request will be closed out. If you have any questions or require further clarification, please contact aastravel@gsa.gov.

---
AAS TRIP
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
    const fundingLabel = isClientPaid ? 'Client-Paid' : 'Overhead';
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

The funding information for the staff listed below has been updated. Please review the updated Request(s) in GO.gov and re-confirm travel details for your staff in AAS TRIP.

Event: ${tripName}
Travel Dates: ${_getTripTravelDates(request)}
Updated Staff: ${travelerNames}

Please click the link below to re-confirm in AAS TRIP:
${ddConfirmUrl}

Your approval in AAS TRIP certifies that you have reviewed the updated Request in GO.gov and verified that the correct line of accounting has been selected for the trip. Once confirmed, the travel request will be closed out. If you have any questions or require further clarification, please contact aastravel@gsa.gov.

---
AAS TRIP
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
            ${isClient ? 'Client' : 'Overhead'}
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

${ddName} has flagged a funding discrepancy for the attendee(s) listed below. Please review and update the funding information in AAS TRIP, then resubmit for confirmation.

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
AAS TRIP
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
    subject: 'AAS Travel Email Test - Delegated Sending',
    body: `This is a test email from the AAS Travel Request System.

If you received this email FROM: ${senderEmail} (not just reply-to), then delegated sending is working correctly!

Check the "From" field in your email client to verify.

Timestamp: ${new Date().toISOString()}

---
AAS Travel Request System`
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
      [{ employeeName: 'John Smith', currentFunding: 'Overhead' }],
      'GO.gov authorization shows Client-Paid but request shows Overhead. Please verify correct funding source.'
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
