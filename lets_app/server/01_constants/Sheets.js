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
  DOS_SYNC_TRACKER:   'DOS_Sync_Tracker',

  // HR / org reference data. Replaces the inherited HC Apps Script Library,
  // which held another workgroup's employees and is no longer reachable.
  // See 20_data/HCData.js for the HC namespace these two tabs back.
  HC_POSITIONS:       'HC_Positions',
  HC_ORGS:            'HC_Orgs',

  // Government contract airfares, synced daily from the GSA City Pair
  // Program CSV. See 91_setup/CityPairSync.js.
  CITY_PAIRS:         'City_Pairs',
  CITY_PAIR_SYNC_LOG: 'City_Pair_Sync_Log',

  // Audit trail for site-access decisions. See 30_services/Access.js and
  // docs/GAP_REGISTER.md G-008.
  ACCESS_LOG:         'Access_Log',

  // Learned per-traveler airport preferences. See 30_services/AirportPrefs.js.
  TRAVELER_AIRPORT_PREFS: 'Traveler_Airport_Prefs'
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
    'DD_Confirmed_At',

    // GSA City Pair airfare provenance. APPENDED AT THE FAR RIGHT — column
    // order is load-bearing (docs/DATA_DICTIONARY.md §3.9: reads resolve by
    // header name, writes are positional), so never insert above this point.
    //
    // Ticket_Cost above remains the submitted figure. These record WHERE that
    // number came from, so an approver can see whether it is a contract fare
    // or the submitter's own estimate, and which airports it assumed.
    // Without them, a $776 airfare is unexplainable after the fact.
    'Airfare_Source',          // CITY_PAIR_ESTIMATE | MANUAL
    'Airfare_Origin_Airport',
    'Airfare_Fare_Basis',      // YCA
    'Airfare_Segments'         // JSON: [{from,to,ycaFare,airline,awardedService}]
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
  ],

  // ==========================================================================
  // HR / ORG REFERENCE DATA — backs the HC namespace (20_data/HCData.js)
  // ==========================================================================
  //
  // These two tabs replace the inherited HC Apps Script Library. That library
  // was bound as a PROJECT SETTING, declared in no manifest, and held the
  // previous workgroup's employees — so it was invisible to this repository
  // and its data was never ours. See docs/GAP_REGISTER.md G-008.
  //
  // COLUMN ORDER IS LOAD-BEARING. docs/DATA_DICTIONARY.md §3.9: reads resolve
  // by header name but writes are positional. Append at the far right only;
  // never insert or reorder.

  // One row per POSITION, filled or vacant. The position — not the person —
  // is the unit of record, because the supervisor chain is a tree of
  // positions: Position_Number -> Reports_To_Position_Number.
  //
  // Grade and Supervisory_Status are compared as STRINGS at 16 sites
  // (e.g. Access.js:133-134 `String(p.grade) !== '15'`). Sheets coerces a
  // cell holding 07 to the number 7, and String(7) is '7', not '07' — so
  // HCData.js normalizes both at the read boundary rather than trusting the
  // sheet. Do not add client-side comparisons that skip that normalization.
  HC_Positions: [
    'Position_Number',             // PK. Text format — may carry leading zeros
    'Reports_To_Position_Number',  // FK to Position_Number. Empty = top of tree
    'Employee_ID',                 // Text format — may carry leading zeros
    'Employee_Name',
    'Email_Address',
    'Org_Code',                    // FK to HC_Orgs.Org_Code
    'Office_Title',                // Access.js:132 substring-matches this
    'Grade',                       // '15', '14', '07' — zero-padded STRING
    'Supervisory_Status',          // '2' = supervisor. Compared as a STRING
    'Occupancy_Status',            // FILLED | VACANT | OBLIGATED
    'LCAT',
    'Location_Code',
    'Duty_Station_Address',
    'Duty_Station_City',
    'Duty_Station_State',
    'Is_Active',
    'Created_By',
    'Created_At',
    'Updated_By',
    'Updated_At'
  ],

  // One row per ORG. Two code namespaces coexist deliberately:
  //   Org_Code    — HR org code (FC, FCA, FCB, FCC). What positions carry.
  //   Office_Code — budget office key (FO, OMD, IDV, CM). What
  //                 00_config/BudgetConfig.js keys allocations off.
  // Confirmed mapping: FC->FO, FCA->OMD, FCB->IDV, FCC->CM. Keeping both on
  // one row makes the correspondence explicit instead of implied by position.
  //
  // Former_Org_Codes is a comma-separated list. OrgLookup.js:52 maps retired
  // codes onto current values so historical requests still resolve.
  HC_Orgs: [
    'Org_Code',                    // PK
    'Office_Code',                 // BudgetConfig.js key. May be blank
    'Business_Unit',
    'Sector',
    'Division',
    'Status',                      // Active | Decommissioned | Not In Use
    'Former_Org_Codes',            // comma-separated
    'Is_Active',
    'Created_By',
    'Created_At',
    'Updated_By',
    'Updated_At'
  ],

  // ==========================================================================
  // GSA CITY PAIR PROGRAM CONTRACT AIRFARES
  // ==========================================================================
  //
  // Synced from https://www.gsa.gov/system/files/awards_<FY>.csv, which GSA
  // rewrites each business day after 23:59 ET. 17,403 rows for FY27.
  //
  // The source CSV has 24 columns; this schema keeps 14 of them plus one
  // computed key. ITEM_NUM, PAX_COUNT and the four redundant location columns
  // (ORIGIN_AIRPORT_LOCATION, DESTINATION_AIRPORT_LOCATION,
  // ORIGIN_CITY_STATE_AIRPORT, DESTINATION_CITY_STATE_AIRPORT) are dropped —
  // they restate CITY_NAME and AIRPORT_ABBREV, and at 17k rows the write
  // volume is what threatens the 6-minute execution cap.
  //
  // Pair_Key is COMPUTED during sync; it is not in the CSV. GSA stores each
  // pair with origin and destination in ALPHABETICAL order regardless of
  // travel direction, so DCA->ORD and ORD->DCA are the same row. Pair_Key is
  // the normalized 'ABE|ATL' form both directions resolve to. Without it every
  // lookup must re-derive that ordering, and getting it wrong returns "no fare
  // found" for a route that genuinely has one — a failure that reads as
  // missing data rather than as a bug.
  City_Pairs: [
    'Pair_Key',                  // computed: alphabetically-sorted 'ORIG|DEST'
    'Award_Year',
    'Origin_Airport_Abbrev',     // airport code (domestic) or city code (intl)
    'Destination_Airport_Abbrev',
    'Origin_City_Name',
    'Origin_State',
    'Origin_Country',
    'Destination_City_Name',
    'Destination_State',
    'Destination_Country',
    'Airline_Abbrev',            // multiple carriers per pair = multiple rows
    'Awarded_Service',           // Non-stop | Connect; explains the fare spread
    'YCA_Fare',                  // unrestricted coach. The pre-fill basis.
    'CA_Fare',                   // capacity-controlled discount; 0 = none
    'Business_Fare',             // 0 = NOT AWARDED on this route, not free
    'Effective_Date',
    'Expiration_Date'
  ],

  // One row per sync attempt. Mirrors DoD_Sync_Log so all three external-data
  // syncs are auditable the same way.
  City_Pair_Sync_Log: [
    'Sync_ID',
    'Synced_At',
    'Fiscal_Year',
    'Source_URL',
    'Rows_Parsed',
    'Rows_Written',
    'Rows_Skipped',
    'Status',
    'Error',
    'Duration_Ms'
  ],

  // ==========================================================================
  // ACCESS AUDIT TRAIL — G-008
  // ==========================================================================
  //
  // canAccessTrip() has three allow-paths. Two of them are driven by HR data
  // rather than by anything LETS stores:
  //
  //   1. an active row in Travel_User_Roles        (visible, auditable)
  //   2. an HC position with Supervisory_Status=2  (invisible)
  //   3. an HC office title naming a BU lead       (invisible)
  //
  // Paths 2 and 3 grant access with no role row and no audit record, so access
  // appears and disappears as HR data changes and the admin console cannot see
  // it. That is docs/GAP_REGISTER.md G-008, rated C4/R2.
  //
  // This tab makes those decisions observable. It records the path taken and
  // the HC position that justified it, so "who can get in, and why?" is
  // answerable from the data instead of by reading Access.js.
  //
  // Writes are best-effort and must never block a page load — a failure to log
  // cannot be allowed to deny access. See _logAccessDecision_().
  Access_Log: [
    'Log_ID',
    'Timestamp',
    'Email',
    'Decision',            // GRANTED | DENIED
    'Path',                // role | hc-supervisor | hc-bu-lead | none | disabled
    'Position_Number',     // the HC position that justified paths 2 and 3
    'Office_Title',
    'Org_Code',
    'Detail'
  ],

  // ==========================================================================
  // LEARNED AIRPORT PREFERENCES
  // ==========================================================================
  //
  // Which airport a traveler actually uses is a LOGISTICAL constraint, not a
  // cost optimization. @clolry's example: he will only fly into DCA because of
  // Metro access to the office, so a cheaper BWI fare is not a real option for
  // him. Offering the cheapest airport as the default would present choices
  // nobody would accept and invite approvers to ask why the saving was not
  // taken.
  //
  // Much executive travel is repeatable — the same person to the same hub
  // offices — so the airport they chose last time is the best available
  // prediction.
  //
  // KEYED ON USER_ID, NOT ON POSITION. These rows must survive an HC roster
  // re-import, and they follow the person rather than the seat: someone moving
  // jobs should keep their own preferences, not inherit the previous
  // occupant's. That is why this is not a column on HC_Positions, which the
  // admin GUI replaces wholesale.
  //
  // ORIGIN AND DESTINATION HAVE DIFFERENT SHAPES. Origin is one value per
  // person (you depart from one airport). Destination is per destination city
  // — ORD for Chicago, LGA for New York — so it is a set of rows, not a
  // column. Pref_Type distinguishes them; City_Name and State are blank for
  // HOME_ORIGIN.
  //
  // HYBRID LEARNING (confirmed with @clolry): a preference is only promoted to
  // "your usual" after the SAME airport has been chosen at least
  // AIRPORT_PREF_PROMOTION_THRESHOLD times. One accidental mis-click must not
  // become a sticky default, and the UI labels a promoted preference
  // explicitly rather than silently pre-selecting it.
  Traveler_Airport_Prefs: [
    'Pref_ID',
    'User_ID',           // FK to Travel_Users.User_ID
    'Pref_Type',         // HOME_ORIGIN | DESTINATION
    'City_Name',         // blank for HOME_ORIGIN
    'State',             // blank for HOME_ORIGIN
    'Airport_Code',
    'Use_Count',         // drives promotion; see threshold above
    'First_Used_At',
    'Last_Used_At',
    'Updated_By'
  ]
};
