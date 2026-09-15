/**
 * Status.js
 * Request status enum + group membership for the workflow state machine.
 * Helpers (isPendingStatus / isTerminalStatus / isNeedsInfoStatus) consume
 * STATUS_GROUPS and are the canonical way to ask about status semantics.
 */

const STATUS_CODES = {
  DRAFT: 'DRAFT',

  // Pending statuses
  PENDING_SECTOR: 'PENDING_SECTOR',
  PENDING_BU: 'PENDING_BU',
  PENDING_OSO: 'PENDING_OSO',
  PENDING_FAS: 'PENDING_FAS',

  // TitleCase exceptions — these two are written to the Status column with
  // TitleCase_TitleCase casing, unlike every other status which is ALL_CAPS.
  // Pre-existing inconsistency; documented Option A in REFACTOR_PLAN. Option C
  // (normalize to ALL_CAPS with a one-shot data migration) is deferred — see
  // OPEN_QUESTIONS.md Q1.
  PENDING_DD_CONFIRMATION: 'Pending_DD_Confirmation',
  PENDING_CORRECTION: 'Pending_Correction',

  // Needs info statuses
  NEEDS_INFO_SECTOR: 'NEEDS_INFO_SECTOR',
  NEEDS_INFO_BU: 'NEEDS_INFO_BU',
  NEEDS_INFO_OSO: 'NEEDS_INFO_OSO',

  // Terminal statuses
  APPROVED_GOGOV: 'APPROVED_GOGOV',
  COMPLETED: 'COMPLETED',
  DENIED: 'DENIED',
  CANCELLED: 'CANCELLED',
  SUBMITTER_CANCELLED: 'SUBMITTER_CANCELLED'
};

const ACTION_TYPES = {
  SUBMITTED: 'Submitted',
  RESUBMITTED: 'Resubmitted',
  SUBMITTER_CANCELLED: 'Submitter_Cancelled',
  SECTOR_APPROVED: 'Sector_Approved',
  SECTOR_NEEDS_INFO: 'Sector_Needs_Info',
  BU_APPROVED: 'BU_Approved',
  BU_NEEDS_INFO: 'BU_Needs_Info',
  OSO_APPROVED: 'OSO_Approved',
  OSO_NEEDS_INFO: 'OSO_Needs_Info',
  FAS_APPROVED: 'FAS_Approved',
  FAS_DENIED: 'FAS_Denied',
  COMPLETED: 'Completed',
  DENIED: 'Denied',
  CANCELLED: 'Cancelled',
  REMINDER_SENT: 'Reminder_Sent',

  // Edit-tracking actions logged when a reviewer edits a request post-submission
  EDIT_OVERVIEW: 'Edit_Overview',
  EDIT_TRAVELERS: 'Edit_Travelers',
  EDIT_COSTS: 'Edit_Costs',
  EDIT_CLASSIFICATION: 'Edit_Classification',
  EDIT_ITINERARY: 'Edit_Itinerary',

  // Admin + DD-confirmation actions. ADMIN_* are intentionally UPPER_SNAKE
  // in the value (not TitleCase) — matches existing prod data; documented
  // as casing exceptions same as PENDING_DD_CONFIRMATION / PENDING_CORRECTION.
  ADMIN_REASSIGN: 'ADMIN_REASSIGN',
  ADMIN_OVERRIDE: 'ADMIN_OVERRIDE',
  ALL_DD_CONFIRMED: 'All_DD_Confirmed'
};

const STATUS_GROUPS = {
  PENDING: [
    STATUS_CODES.PENDING_SECTOR,
    STATUS_CODES.PENDING_BU,
    STATUS_CODES.PENDING_OSO,
    STATUS_CODES.PENDING_FAS,
    STATUS_CODES.PENDING_DD_CONFIRMATION,
    STATUS_CODES.PENDING_CORRECTION
  ],
  NEEDS_INFO: [
    STATUS_CODES.NEEDS_INFO_SECTOR,
    STATUS_CODES.NEEDS_INFO_BU,
    STATUS_CODES.NEEDS_INFO_OSO
  ],
  APPROVED: [
    STATUS_CODES.APPROVED_GOGOV,
    STATUS_CODES.COMPLETED
  ],
  TERMINAL: [
    STATUS_CODES.APPROVED_GOGOV,
    STATUS_CODES.COMPLETED,
    STATUS_CODES.DENIED,
    STATUS_CODES.CANCELLED,
    STATUS_CODES.SUBMITTER_CANCELLED
  ],
  CANCELLED: [
    STATUS_CODES.CANCELLED,
    STATUS_CODES.SUBMITTER_CANCELLED
  ]
};

/**
 * Check if a status is in a specific group.
 *
 * @param {string} status - The status to check
 * @param {string} groupName - PENDING | NEEDS_INFO | APPROVED | TERMINAL | CANCELLED
 * @returns {boolean}
 * @server
 */
function isStatusInGroup(status, groupName) {
  const group = STATUS_GROUPS[groupName];
  return group ? group.includes(status) : false;
}

/**
 * Check if a status is terminal (no further action possible).
 * @param {string} status
 * @returns {boolean}
 * @server
 */
function isTerminalStatus(status) {
  return isStatusInGroup(status, 'TERMINAL');
}

/**
 * Check if a status is pending review (includes TitleCase exceptions).
 * @param {string} status
 * @returns {boolean}
 * @server
 */
function isPendingStatus(status) {
  return isStatusInGroup(status, 'PENDING');
}

/**
 * Check if a status is needs-info.
 * @param {string} status
 * @returns {boolean}
 * @server
 */
function isNeedsInfoStatus(status) {
  return isStatusInGroup(status, 'NEEDS_INFO');
}
