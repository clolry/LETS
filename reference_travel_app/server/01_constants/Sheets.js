/**
 * Sheets.js
 * Sheet-name registry + column-header schemas — single source of truth
 * for "what sheets exist in the travel DB and what columns they have."
 *
 * SHEET_NAMES is the canonical map: intent name → actual GAS sheet name.
 * Every `getSheetByName(...)` call site reads from SHEET_NAMES so a sheet
 * rename happens in exactly one place. Verified post-deploy by
 * _checkSheetNamesAdoption() in 99_triggers/CacheWarming.js.
 *
 * TRAVEL_SHEET_SCHEMAS is column-header data — consumed by
 * 91_setup/Database.js when (re)creating sheets, 10_lib/Errors.js when
 * auto-creating the Error_Log sheet, and 40_domain/Submission.js for
 * column-index lookups.
 */

// ============================================================================
// SHEET NAMES — canonical registry
// ============================================================================

const SHEET_NAMES = {
  // Core request data
  REQUESTS:           'Requests',
  REQUEST_LEGS:       'Request_Legs',
  REQUEST_TRAVELERS:  'Request_Travelers',
  TRAVELER_LEG_COSTS: 'Traveler_Leg_Costs',
  ATTACHMENTS:        'Attachments',
  APPROVAL_LOG:       'Approval_Log',

  // User + role management
  TRAVEL_USERS:       'Travel_Users',
  TRAVEL_USER_ROLES:  'Travel_User_Roles',
  TEST_SUBMITTERS:    'Test_Submitters',

  // Operational
  ERROR_LOG:          'Error_Log',
  FEEDBACK:           'Feedback',
  FILE_QUEUE:         'File_Queue',

  // Per diem reference data (synced from external sources)
  DOD_PER_DIEM:       'DoD_Per_Diem',
  DOD_SYNC_LOG:       'DoD_Sync_Log',
  FOREIGN_PER_DIEM:   'Foreign_Per_Diem',
  DOS_SYNC_TRACKER:   'DOS_Sync_Tracker'
};

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

/**
 * Column headers for each sheet, matching Data_Model_v2.md
 */
const TRAVEL_SHEET_SCHEMAS = {

  // Main request record - one row per travel request
  Requests: [
    'Request_ID',
    'Status',
    'Trip_Name',
    'Location_Type',
    'Event_Start_Date',
    'Event_End_Date',
    'Is_International',
    'Is_OCONUS',
    'BLUF',
    'Purpose',
    'Travel_Types',
    'Mission_Critical_Types',
    'Shared_Facilities',
    'Shared_Facilities_Desc',
    'Shared_AV',
    'Shared_AV_Desc',
    'Shared_Logistics',
    'Shared_Logistics_Desc',
    'Shared_Other',
    'Shared_Other_Desc',
    'Shared_Total',
    'Traveler_Total',
    'Grand_Total',
    'Traveler_Count',
    'Leg_Count',
    'Submitter_Name',
    'Submitter_Email',
    'Submitter_BU',
    'Submitter_Org_Code',
    'Sector_Director_Name',
    'Sector_Director_Email',
    'BU_Reviewer_Name',
    'BU_Reviewer_Email',
    'Current_Reviewer_Name',
    'Current_Reviewer_Email',
    'Initial_Review_Level',
    'Attachments_Folder',
    'Salesforce_Link',
    'Created_At',
    'Updated_At',
    'Submitted_At',
    'Version'
  ],

  // Destination/leg info - one row per leg
  Request_Legs: [
    'Request_ID',
    'Leg_ID',
    'Leg_Number',
    'Site_Name',
    'City',
    'State',
    'Country',
    'Start_Date',
    'End_Date',
    'Is_International',
    'Is_OCONUS',
    'Per_Diem_Source',
    'Lodging_Rate',
    'MIE_Rate',
    'Location_Display'
  ],

  // Traveler info - one row per traveler
  Request_Travelers: [
    'Request_ID',
    'Traveler_ID',
    'Employee_ID',
    'Employee_Name',
    'Email',
    'Org_Code',
    'Business_Unit',
    'LCAT',
    'DD_Name',
    'DD_Email',
    'Duty_Location',
    'Duty_Location_Code',
    'Attending_Legs',
    'Transport_Mode',
    'Ticket_Cost',
    'Total_Miles',
    'Mileage_Rate',
    'Needs_Rental_Car',
    'Rental_Car_Cost',
    'Transportation_Total',
    'Lodging_Total',
    'MIE_Total',
    'Local_Travel_Total',
    'Other_Percentage',
    'Other_Total',
    'Subtotal',
    'Is_Client_Paid',
    'Role_Justification',
    'Is_Full_Time_Telework',
    'Normal_Commute_Distance',
    'Normal_Commute_Parking',
    'Has_Security_Clearance',
    'Has_Valid_Passport',
    'Is_Speaking',
    'Event_Open_To_Press',
    'Receiving_NFS',
    'DD_Confirmed',
    'DD_Confirmed_At'
  ],

  // Per-traveler, per-leg costs - one row per traveler-leg combination
  Traveler_Leg_Costs: [
    'Request_ID',
    'Traveler_ID',
    'Leg_ID',
    'City',
    'Lodging_Start_Date',
    'Lodging_End_Date',
    'Lodging_Uses_Itinerary_Dates',
    'MIE_Start_Date',
    'MIE_End_Date',
    'MIE_Uses_Itinerary_Dates',
    'Is_Local_Travel',
    'Lodging_Rate',
    'Lodging_Nights',
    'Lodging_Calculated',
    'Lodging_Override',
    'Lodging_Override_Amount',
    'Lodging_Override_Reason',
    'Lodging_Total',
    'MIE_Rate',
    'MIE_Days',
    'MIE_Calculated',
    'MIE_Override',
    'MIE_Override_Amount',
    'MIE_Override_Reason',
    'MIE_Total',
    'Local_Miles_Driven',
    'Was_Gov_Vehicle_Available',
    'Local_Parking',
    'Local_Tolls',
    'Local_Travel_Total',
    'Leg_Subtotal'
  ],

  // File references - one row per uploaded file
  Attachments: [
    'Request_ID',
    'Attachment_ID',
    'Traveler_ID',
    'File_Name',
    'File_ID',
    'File_URL',
    'File_Type',
    'File_Size',
    'Category',
    'Uploaded_By',
    'Uploaded_At'
  ],

  // Audit trail - one row per action
  Approval_Log: [
    'Log_ID',
    'Request_ID',
    'Action',
    'Action_By_Name',
    'Action_By_Email',
    'Action_By_Role',
    'Timestamp',
    'Previous_Status',
    'New_Status',
    'Comments',
    'Section_Comments',
    'Snapshot_Data',
    'Version_Before',
    'Version_After'
  ],

  // Test submitter overrides - for people not in staffing (consultants, testers)
  Test_Submitters: [
    'Email',
    'Name',
    'Org_Code',
    'BU_Name',
    'Is_Active',
    'Suppress_Emails'
  ],

  // Error log for persistent error tracking
  Error_Log: [
    'Timestamp',
    'User_Email',
    'Function_Name',
    'Error_Message',
    'Stack_Trace',
    'Context'
  ],

  // Master roster of every user known to TRIP — admins, reviewers, approved
  // non-supervisor users, and external (non-HC) people. One row per person.
  // User_ID = HC employee_id when known, else 'ext_<random>' for external users.
  // Email is mutable and self-heals from HC at login; User_ID is the stable PK.
  Travel_Users: [
    'User_ID',
    'Email',
    'Name',
    'Source',
    'Is_Active',
    'Created_By',
    'Created_At',
    'Updated_By',
    'Updated_At'
  ],

  // Role assignments — many-to-many between users and roles.
  // One row per (user, role_type, scope) tuple. A user can hold multiple
  // roles (e.g. admin + bu_reviewer for QFAA + sector_override for QM).
  // Role_Type values: 'admin', 'aas_fo_reviewer', 'fas_fo_reviewer',
  //   'bu_reviewer', 'sector_override', 'approved_user'
  // Scope: BU code for bu_reviewer, sector code for sector_override, '' for global roles
  // Is_Primary: AAS FO delegation toggle — true = receives current routing,
  //   false = backup. All other role types should set Is_Primary = true.
  Travel_User_Roles: [
    'Role_ID',
    'User_ID',
    'Role_Type',
    'Scope',
    'Is_Primary',
    'Is_Active',
    'Notes',
    'Granted_By',
    'Granted_At',
    'Updated_By',
    'Updated_At'
  ]
};
