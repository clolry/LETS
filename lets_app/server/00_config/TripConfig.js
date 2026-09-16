/**
 * TripConfig.js / LetsConfig.js
 * Application-level configuration for LETS (Logistics, Events, and Travel System).
 * Incorporates EO 14222 FAS Delegation of Travel-Approving Official Authority.
 */

const TRAVEL_DB_SPREADSHEET_ID = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties())
  ? PropertiesService.getScriptProperties().getProperty('TRAVEL_DB_SPREADSHEET_ID')
  : null;

const FAS_TRACKER_SPREADSHEET_ID = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties())
  ? PropertiesService.getScriptProperties().getProperty('FAS_TRACKER_SPREADSHEET_ID')
  : null;

const TRIP_FAVICON_ID = '1y_J9fxewAJxvdGWGc1zU988Lyd3it7WB';

const LETS_APP_NAME = 'LETS - Logistics, Events, and Travel System';
const LETS_FISCAL_YEAR = 'FY27';

/**
 * Two-Tiered Travel Purpose Taxonomy (per FAS Delegation Memo & EO 14222)
 */
const TRAVEL_PURPOSES = {
  // TIER 1: Delegated to FAS Chief of Staff (FAS CoS) - Official FAS Travel Exception Tracker Required
  TIER_1_FAS_COS: [
    {
      code: 'FOREIGN_TRAVEL',
      label: 'Travel to Foreign Areas (OCONUS)',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Foreign travel including in-country travel by OCONUS-based employees'
    },
    {
      code: 'HAE_PARTICIPATION',
      label: 'Highly Attended Event (HAE) Participation',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Participation in events with high federal attendee count'
    },
    {
      code: 'NON_GSA_CONFERENCE',
      label: 'Non-GSA Conference and Event Attendance',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Attendance at external/industry conferences not sponsored by GSA'
    },
    {
      code: 'SPEAKING_ROLE',
      label: 'Conference Speaking or Presenter Role (Non-GSA)',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Speaking or presenter roles at non-GSA events, including virtual'
    },
    {
      code: 'IMM_OVER_10K',
      label: 'Internal Management Meeting (IMM) > $10,000',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Planning, alignment, and coordination meetings exceeding $10k total cost'
    },
    {
      code: 'NON_FED_FUNDED',
      label: 'Non-Federal Source Funded / Fee Reduced Event',
      requiresEventTracker: true,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Non-Federal entity pays expenses or reduces/waives registration fee'
    },
    {
      code: 'TRAINING_OVER_7K',
      label: 'Third-Party Training > $7,000 (CSA Required)',
      requiresEventTracker: false,
      approvalAuthority: 'FAS Chief of Staff',
      requiresFASTracker: true,
      description: 'Training where Continuing Service Agreement is required'
    }
  ],

  // TIER 2: Delegated to Portfolio-level Chief of Staff (e.g. ASD CoS / CREATE)
  TIER_2_PORTFOLIO_COS: [
    {
      code: 'GSA_SPONSORED',
      label: 'GSA-Sponsored or Co-sponsored Event',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Official GSA conferences and internal summits'
    },
    {
      code: 'COMPLIANCE_SITE_VISIT',
      label: 'Compliance (Site Visit / Inspection)',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'On-site compliance inspections, program reviews, and audits'
    },
    {
      code: 'CUSTOMER_ENGAGEMENT',
      label: 'Customer or Agency Engagement',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Customer agency meetings and client support'
    },
    {
      code: 'VENDOR_ENGAGEMENT',
      label: 'Vendor Engagement',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Industry day, supplier reviews, and contractor interactions'
    },
    {
      code: 'CLIENT_PAID',
      label: 'Client Paid Travel',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Directly reimbursable or customer-funded travel'
    },
    {
      code: 'IMM_UNDER_10K',
      label: 'Internal Management Meeting (IMM) < $10,000',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Internal alignment and planning meetings under $10k total cost'
    },
    {
      code: 'TRAINING_UNDER_7K',
      label: 'Training < $7,000 or Internal GSA Training',
      requiresEventTracker: false,
      approvalAuthority: 'Portfolio Chief of Staff',
      requiresFASTracker: false,
      description: 'Standard third-party training under threshold or GSA-provided training'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRAVEL_DB_SPREADSHEET_ID,
    FAS_TRACKER_SPREADSHEET_ID,
    TRIP_FAVICON_ID,
    LETS_APP_NAME,
    LETS_FISCAL_YEAR,
    TRAVEL_PURPOSES
  };
}
