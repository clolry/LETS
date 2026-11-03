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

  // User-submitted bug reports, feature requests and NPS. Declared in
  // SHEET_NAMES since the inherited code, but it had NO SCHEMA — so
  // setupTravelDatabase never created it and every submission failed. See
  // the Feedback schema below.
  FEEDBACK:           'Feedback',

  // Event planning. One row per event OCCURRENCE, and one per DAC set-aside.
  HISTORICAL_EVENTS:  'Historical_Events',
  EVENT_SET_ASIDES:   'Event_Set_Asides',

  // Budget allocations, versioned by effective date. Replaces the hardcoded
  // baselines in BudgetConfig.js, which needed a code deploy to change.
  BUDGET_ALLOCATIONS: 'Budget_Allocations',

  // The event CATALOGUE: one row per event occurrence a traveller can pick
  // from. Distinct from Historical_Events, which records what already
  // happened — see the schema comment.
  EVENTS:             'Events',

  // Traveller-proposed events awaiting a coordinator. @clolry: "We need a way
  // for a traveler to define an 'other' and then let the back-end coordinator
  // add that event."
  EVENT_PROPOSALS:    'Event_Proposals',

  // Reviewer delegations: who may act on whose behalf while they are out.
  REVIEW_DELEGATIONS: 'Review_Delegations',

  // One row per imported Go.gov expense report, matched or not. Separate from
  // Requests because an expense report that matches NOTHING is still real
  // money GSA paid — see the schema comment.
  EXPENSE_IMPORTS:    'Expense_Imports',

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
    'Version',

    // ------------------------------------------------------------------
    // Trip Overview fields. APPENDED AT THE FAR RIGHT — writes are
    // positional (docs/DATA_DICTIONARY.md §3.9), so never insert above.
    //
    // These six inputs have existed in the form since the budget layer was
    // written and were NEVER STORED. No getElementById call read them and no
    // column existed to hold them, so every Owning Office, Purpose of Travel
    // and Set-Aside selection was silently discarded at submission.
    //
    // That is why RequestService.createTravelRequest and
    // BudgetEngine.evaluateBudgetCheck have no callers: the travel form and
    // the budget engine were two disconnected systems in one project. These
    // columns are the join.
    // ------------------------------------------------------------------
    'Owning_Office',        // FO | OMD | IDV | CM — BudgetConfig.js key
    'Owning_Org_Code',      // FC | FCA | FCB | FCC — HC_Orgs key
    'Travel_Purpose',       // FAS delegation code, e.g. FOREIGN_TRAVEL
    'Travel_Purpose_Label', // human-readable, for the FAS tracker
    'Set_Aside_Type',       // NONE | DAC_LC | COE_PROGRAM | FO_LC_GAP
    'Is_Event_Plan_Item',
    'Is_LC_Travel',
    'Is_COE_Travel',

    // The tracker's single-select "primary reason when multiple reasons
    // apply". Separate from Mission_Critical_Types, which is its multi-select
    // "type of mission critical travel" — the FAS form asks both and the
    // request form collected neither correctly.
    'Primary_Justification',

    // Distinct HR org codes across this request's travellers, comma-separated.
    // Denormalized deliberately: budget attribution is PER TRAVELLER (a
    // conference can draw from FCA, FCB and FCC at once), and routing needs to
    // know which DACs must approve without re-reading every traveller row.
    'Traveler_Org_Codes',

    // ======================================================================
    // RECONCILIATION — for the monthly Go.gov reconciliation
    // ======================================================================
    //
    // APPENDED, never inserted. Every reader in LETS resolves columns by
    // header NAME, but the eighteen positional readers catalogued in
    // DATA_DICTIONARY §3.9 index from the LEFT — so a column added at the end
    // is invisible to them, while one inserted mid-schema would misfile
    // everything after it.
    //
    // @clolry: "we will need to reconcile against actual costs after the
    // travel has been completed and an expense report is filed."
    //
    // Estimates keep their per-category breakdown in Request_Travelers. The
    // ACTUAL is trip-level only, because the Go.gov expense export has no
    // category split — only Report Total and Amount Approved.
    'Gogov_Request_ID',       // the 4-char Go.gov code, e.g. 4QMN. UNIQUE in
                              // the request export (565/565), so re-importing
                              // updates rather than duplicating
    'Gogov_Report_Name',      // Go.gov's trip name, verbatim. The only bridge
                              // to an expense report when no LETS ID was
                              // embedded in it
    'Actual_Total',           // from Amount Approved, NOT Report Total. Those
                              // differ on 37 of 182 sample rows by $4,569.93 —
                              // Report Total includes items GSA disallowed and
                              // never paid
    'Actual_Source',          // 'gogov-import' | 'manual'
    'Actual_Posted_At',
    'Actual_Posted_By',
    'Reconciliation_Status',  // UNRECONCILED | MATCHED | NO_EXPENSE_EXPECTED
    'Reconciliation_Notes',
    'Match_Method',           // 'lets-id' | 'gogov-id' | 'name-title' |
                              // 'name-date' | 'manual'. Recorded because an ID
                              // match and a human-confirmed match carry
                              // different confidence, and an audit has to be
                              // able to tell them apart
    'Match_Confirmed_By',
    'Expense_Report_Name',
    'Expense_Report_End_Date',

    // ======================================================================
    // EVENT CATALOGUE LINK — appended, same positional reasoning as above
    // ======================================================================
    //
    // Set when the traveller picked an event from the catalogue, which
    // pre-fills dates, location and purpose. Blank for ad-hoc travel, which
    // is most of it.
    //
    // Event_Proposal_ID is set instead when the traveller chose "Other" and
    // described an event that does not exist yet. The request is then
    // SUBMITTABLE but unlinked, and a coordinator resolves the proposal
    // later — @clolry: the coordinator "add[s] that event and then
    // associate[s] the request with that new event."
    //
    // Blocking submission until an event exists would be the obvious
    // alternative and would be wrong: a traveller should not wait on a
    // coordinator to file a request with a deadline.
    'Event_ID',
    'Event_Proposal_ID'
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
    'Airfare_Segments',        // JSON: [{from,to,ycaFare,airline,awardedService}]

    // Budget attribution. Each traveller is charged to THEIR OWN org, not the
    // request's owning office: a consolidated conference request can include
    // people from FCA, FCB and FCC, and each DAC should see only their own
    // share. Org_Code comes from the traveller's HC position; Office_Code is
    // the BudgetConfig.js key it maps to via HC_Orgs.
    'Budget_Org_Code',         // FC | FCA | FCB | FCC
    'Budget_Office_Code'       // FO | OMD | IDV | CM
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

  // ==========================================================================
  // BUDGET ALLOCATIONS
  // ==========================================================================
  //
  // One row per office per EFFECTIVE DATE. Not one row per office.
  //
  // WHY VERSIONED AND NOT EDITABLE IN PLACE
  // ---------------------------------------
  // @clolry: "each year (or even mid-year if budgets change) we can update the
  // numbers for our overall group and each subgroup."
  //
  // A mid-year change is the whole point, and an in-place edit destroys the
  // only record of what the budget WAS. Reconciliation then becomes
  // impossible to defend: a request approved in November against a $152,000
  // allocation looks over-budget if the allocation was later cut to $120,000,
  // and nothing on the row says the ceiling moved.
  //
  // So an update APPENDS. The current allocation is the row with the latest
  // Effective_Date not in the future. History is the rest, and it is the
  // audit trail.
  //
  // Supersedes the hardcoded baselines in 00_config/BudgetConfig.js, which
  // required a code deploy to change a dollar figure. Those remain as the
  // fallback for a database with no rows yet — see BudgetAdmin.js.
  Budget_Allocations: [
    'Allocation_ID',          // PK
    'Fiscal_Year',            // FY27
    'Office_Code',            // FO | OMD | IDV | CM — the budget key
    'Org_Code',               // FC | FCA | FCB | FCC — the HR code, for reference
    'Office_Name',
    'Is_DAC',
    'Amount',                 // dollars
    'Proportional_Share',     // 0..1, for enterprise-shared set-asides
    'Effective_Date',         // the date this figure takes effect
    'Change_Reason',          // required. Why the number moved
    'Supersedes_ID',          // the row this replaces, for a readable chain
    'Is_Active',
    'Created_By',
    'Created_At'
    // No Updated_By / Updated_At. A row here is IMMUTABLE once written — the
    // way to change a figure is a new row. Having update columns would invite
    // exactly the in-place edit this design exists to prevent.
  ],

  // ==========================================================================
  // REVIEWER DELEGATION
  // ==========================================================================
  //
  // @clolry: "In go.gov when a user delegates access, the other logs in and
  // then can choose to emulate that user's access and approvals (of course
  // they're logged as themselves but are given the rights to view/edit as the
  // other person would)."
  //
  // That last clause is the whole design. A delegate ACTS AS THEMSELVES with
  // somebody else's authority — they do not become that person.
  //
  // WHY THIS IS NOT A ROLE ROW
  // --------------------------
  // The obvious implementation is to grant the delegate the principal's role
  // in Travel_User_Roles. That would work and would be wrong in three ways:
  //
  //   1. It is indistinguishable from a real grant afterwards. Six months on,
  //      nobody can tell whether Bob was a BU reviewer or was covering for
  //      Alice for a fortnight.
  //   2. It has no end date. A role row granted for two weeks of leave stays
  //      granted until someone remembers to revoke it.
  //   3. The approval log would record Bob approving under his own authority,
  //      losing the fact that the authority was Alice's.
  //
  // So a delegation is its own record with its own lifetime, and every action
  // taken under it is stamped with BOTH identities.
  //
  // WHO MAY CREATE ONE
  // ------------------
  // The principal, for their own authority — a reviewer going on leave should
  // not need an administrator. Or an admin, because somebody has to be able
  // to delegate on behalf of a person who left abruptly.
  //
  // A delegate CANNOT create a delegation, including re-delegating what they
  // hold. Otherwise authority spreads transitively and the audit trail
  // becomes a chain nobody can follow.
  Review_Delegations: [
    'Delegation_ID',          // PK
    'Principal_Email',        // whose authority is being lent
    'Principal_Name',
    'Delegate_Email',         // who may exercise it
    'Delegate_Name',
    'Scope',                  // 'all' | a role type, when lending only part
    'Start_Date',             // inclusive
    'End_Date',               // inclusive. REQUIRED — see below
    'Reason',                 // required. 'Annual leave', 'Detail to FAS'
    'Status',                 // ACTIVE | REVOKED | EXPIRED
    'Created_By',             // the principal, or an admin acting for them
    'Created_At',
    'Revoked_By',
    'Revoked_At',
    'Revoke_Reason'
    // No Updated_By/Updated_At. A delegation is created, then revoked — it is
    // never edited. Changing the dates or the delegate on an existing row
    // would rewrite history that approvals already reference.
  ],

  // ==========================================================================
  // THE EVENT CATALOGUE
  // ==========================================================================
  //
  // One row per event OCCURRENCE a traveller can select when raising a
  // request. @clolry: "perhaps we build a way for the admin to define events
  // on the back end first and then people select the event from a list - it
  // could pre-fill dates, location, etc."
  //
  // WHY THIS IS NOT Historical_Events
  // ---------------------------------
  // Historical_Events records what ALREADY HAPPENED — attendance counts for
  // budget planning, with no stable key: its PK is evt_<slug>_<YYYY-MM> and
  // events are grouped by name after the fact.
  //
  // This is FORWARD-LOOKING and needs a stable identity, because a request
  // and a set-aside both point at it. Event_ID is that identity. Renaming an
  // event must not orphan the requests that selected it, which name-based
  // grouping cannot promise.
  //
  // The two are linked by Historical_Event_Name so the planning view can show
  // "we sent 25 last year" against a catalogue entry.
  //
  // WHY ONE ROW PER OCCURRENCE, NOT PER EVENT
  // -----------------------------------------
  // "NCMA World Congress" is a series; "NCMA World Congress, July 2027" is
  // the thing a traveller attends and a DAC reserves money for. A series-level
  // row would have to carry a list of dates, and every consumer would have to
  // pick the right one. Series_Key groups the occurrences instead.
  Events: [
    'Event_ID',               // PK. evt_<slug>_<YYYYMM>_<seq>
    'Series_Key',             // stable slug grouping occurrences of one event
    'Event_Name',
    'Event_Month',            // YYYY-MM, for grouping and set-aside matching
    'Start_Date',
    'End_Date',
    'Fiscal_Year',            // Oct-Sep. The year whose budget it consumes
    'Location_City',
    'Location_State',
    'Location_Venue',
    'Is_Virtual',
    'Is_Local',               // no lodging/airfare expected
    'Default_Purpose',        // pre-fills the request's Travel_Purpose
    'Registration_Cost',      // per attendee, if known
    'Registration_Waived_For', // e.g. 'speakers'. See the waiver note below
    'Meals_Provided',         // JSON or prose. Affects the M&IE deduction
    'Requires_Special_Form',  // e.g. a speaking-engagement form
    'Special_Form_Notes',
    'Sponsor_Org',            // who runs it, for the FAS tracker
    'Expected_Attendees',
    'Status',                 // PROPOSED | OPEN | CLOSED | CANCELLED
    'Historical_Event_Name',  // links to Historical_Events for prior-year data
    'Proposed_By',            // set when promoted from a traveller proposal
    'Proposal_ID',
    'Notes',
    'Is_Active',
    'Created_By',
    'Created_At',
    'Updated_By',
    'Updated_At'
  ],

  // ==========================================================================
  // TRAVELLER-PROPOSED EVENTS
  // ==========================================================================
  //
  // @clolry: "We need a way for a traveler to define an 'other' and then let
  // the back-end coordinator add that event and then associate the request
  // with that new event (and then allow future travelers to select that
  // event)."
  //
  // WHY A SEPARATE TAB RATHER THAN A 'PROPOSED' STATUS ON Events
  // -----------------------------------------------------------
  // Events has a Status column including PROPOSED, so this looks redundant.
  // It is not, for one reason: a traveller must not be able to write to the
  // catalogue that every other traveller picks from.
  //
  // If proposals landed in Events as PROPOSED rows, every list query would
  // have to remember to filter them out, and one forgotten filter would show
  // unvetted traveller text — including typos and duplicates — in the picker.
  // A separate tab means the picker CANNOT see a proposal, rather than
  // relying on it being filtered.
  //
  // A proposal is promoted by a coordinator, which creates the Events row and
  // links the originating request to it.
  Event_Proposals: [
    'Proposal_ID',            // PK
    'Proposed_Event_Name',    // traveller's free text, verbatim
    'Proposed_Start_Date',
    'Proposed_End_Date',
    'Proposed_Location',      // free text; a traveller may not know the venue
    'Proposed_Purpose',
    'Notes',                  // the traveller's own justification
    'Request_ID',             // the request that prompted it. Linked to the
                              // created event on promotion
    'Proposed_By',
    'Proposed_At',
    'Status',                 // PENDING | PROMOTED | MERGED | REJECTED
    // Set on promotion. MERGED means the coordinator matched it to an event
    // that already existed — the common case for a duplicate proposal, and a
    // different outcome from PROMOTED which creates a new one.
    'Resolved_Event_ID',
    'Resolution_Notes',
    'Resolved_By',
    'Resolved_At'
  ],

  // ==========================================================================
  // GO.GOV EXPENSE IMPORTS
  // ==========================================================================
  //
  // One row per expense report line in the monthly Go.gov export, matched or
  // not.
  //
  // WHY THIS IS NOT JUST COLUMNS ON Requests
  // ----------------------------------------
  // Measured against @clolry's real exports: only 45% of expense reports can
  // be confidently matched to a request by traveller and title. 32.6% belong
  // to travellers with no request in the export at all, mostly because the
  // request predates the window.
  //
  // An unmatched expense report is still REAL MONEY that GSA paid. Storing
  // actuals only as columns on Requests would leave it nowhere to live, so it
  // would be dropped — and the reconciliation would balance while
  // under-reporting spend. A total that looks right is the worst outcome
  // available here.
  //
  // So every imported row lands here first. Matching then links it to a
  // request and copies the actual across. Unmatched rows stay visible and
  // still roll up into the office total, flagged.
  Expense_Imports: [
    'Import_ID',
    'Import_Batch_ID',        // one per uploaded file, so a bad import can be
                              // identified and reversed as a unit
    'Report_Name',            // Go.gov trip name, verbatim
    'Employee_Name',          // 'Last, First M.' as Go.gov writes it
    'Employee_Name_Normalized', // 'FIRST LAST' uppercased. Stored rather than
                              // derived at query time: 71 of 182 sample rows
                              // are ALL CAPS and the rest mixed, so the
                              // normalisation is not obvious from the raw value
    'Gogov_Employee_ID',      // e.g. 76E00049503. Does NOT match LETS
                              // Employee_ID (0010001) — kept for traceability,
                              // not as a join key
    'Report_Total',           // audit trail only
    'Amount_Approved',        // THE RECONCILIATION FIGURE
    'Disallowed_Amount',      // Report_Total - Amount_Approved. Stored because
                              // it is the number nobody thinks to ask for
                              // until a traveller disputes a voucher
    'Report_End_Date',        // text YYYY-MM-DD in the export, not a serial
    'Submit_Date',
    'Fiscal_Year',            // from Report_End_Date. One monthly export spans
                              // TWO fiscal years in the sample
                              // ($129,470.97 / $143,884.73), so this is
                              // computed per row
    'Extracted_LETS_ID',      // a REQ-… found in the report name, if any
    'Matched_Request_ID',
    'Match_Method',           // 'lets-id' | 'gogov-id' | 'name-title' |
                              // 'name-date' | 'manual' | ''
    'Match_Status',           // AUTO_MATCHED | NEEDS_REVIEW | MANUAL_MATCHED |
                              // UNMATCHED | IGNORED
    'Match_Candidates',       // JSON. Proposed request IDs with reasons, so
                              // the review screen does not recompute them
    'Match_Confirmed_By',
    'Match_Confirmed_At',
    'Office_Code',            // resolved from LETS, never from the file:
                              // Go.gov's Org Level 3 is 'F' for every row and
                              // levels 4-5 are empty
    'Org_Code',
    'Notes',
    'Created_At',
    'Created_By'
  ],

  // ==========================================================================
  // HISTORICAL EVENT ATTENDANCE
  // ==========================================================================
  //
  // One row per EVENT OCCURRENCE, not per event. "NCMA World Congress" is two
  // rows: July 2024 with 25 attendees and July 2026 with 23.
  //
  // WHY OCCURRENCE-LEVEL
  // --------------------
  // A DAC planning next year's budget needs to know WHEN a conference lands
  // and HOW MANY people went last time. An event-level row holding a total
  // answers neither: @clolry's data has NCMA World Congress at 48 total,
  // which is two trips of ~24 and not one trip of 48.
  //
  // Recurrence is DERIVED from the occurrence months rather than stored as a
  // schedule. A stored "annual in July" would be a claim nobody maintains;
  // two July occurrences two years apart are evidence.
  //
  // THE ORG BREAKDOWN IS SPARSE, DELIBERATELY
  // -----------------------------------------
  // @clolry asked to see "how many people from which orgs have attended".
  // The 2024-2026 attendance figures he supplied are TOTALS with no org
  // breakdown — that detail does not exist in the source.
  //
  // So Org_Breakdown is blank on every seeded row and populated only from
  // LETS's own Requests data, where Traveler_Org_Codes is captured per
  // request. The UI must therefore distinguish "no one from FCB attended"
  // from "we do not know who attended", because those are different answers
  // and conflating them would invent data.
  Historical_Events: [
    'Occurrence_ID',          // PK. evt_<slug>_<YYYY-MM>
    'Event_Name',             // canonical name, used to group occurrences
    'Event_Month',            // YYYY-MM. Day is not known for seeded rows
    'Fiscal_Year',            // FY2024.. Oct-Sep. Derived, stored for filtering
    'Attendee_Count',
    'Org_Breakdown',          // JSON {orgCode: count}. BLANK when unknown
    'Total_Est_Spend',        // blank unless known
    'Location',
    'Primary_Purpose',
    'Source',                 // 'historical-seed' | 'lets-requests' | 'manual'
    'Request_IDs',            // comma-separated, when derived from LETS
    'Notes',
    'Is_Active',
    'Created_By',
    'Created_At',
    'Updated_By',
    'Updated_At'
  ],

  // ==========================================================================
  // DAC EVENT SET-ASIDES
  // ==========================================================================
  //
  // NOT YET WRITTEN TO BY ANY CODE PATH. Declared now because the schema is
  // the part worth agreeing before the UI exists, and because a tab with no
  // schema is the defect that lost every bug report (see Feedback above).
  //
  // @clolry: "if the FCB DAC knows that they want to send 10 people to a
  // conference next May then I want to give her a way to setaside the funds
  // so they don't get spent on something else or forgotten."
  //
  // Distinct from LetsDB's Set_Asides, which holds the four standing
  // enterprise set-asides (LC travel, COE, the FO gap). These are
  // event-specific, DAC-owned, and expire.
  Event_Set_Asides: [
    'Set_Aside_ID',           // PK
    // EITHER a catalogue event, or a free-text name.
    //
    // Event_ID is the better path: it pins the reservation to a real
    // occurrence with known dates, and a request that selects that event
    // draws down against it automatically.
    //
    // Event_Name survives because a DAC often knows they want to reserve for
    // a conference before anyone has catalogued it. Requiring a catalogue
    // entry first would mean the reservation could not be made at the moment
    // the DAC is doing their annual planning, which is the moment it matters.
    'Event_ID',
    'Event_Name',             // free text when Event_ID is blank
    'Event_Month',            // YYYY-MM the money is being reserved for
    'Fiscal_Year',
    'Org_Code',               // the DAC reserving it: FCA | FCB | FCC | FC
    'Office_Code',            // budget key: OMD | IDV | CM | FO
    'Planned_Travelers',
    'Amount',                 // dollars reserved
    'Basis',                  // how the amount was arrived at
    'Status',                 // PLANNED | COMMITTED | RELEASED | EXPIRED
    'Consumed_Amount',        // drawn down as requests are approved
    'Linked_Request_IDs',
    'Notes',
    'Created_By',
    'Created_At',
    'Updated_By',
    'Updated_At'
  ],

  // ==========================================================================
  // USER FEEDBACK
  // ==========================================================================
  //
  // Feedback was in SHEET_NAMES but had NO SCHEMA, so setupTravelDatabase
  // never created the tab. submitTravelFeedback returned 'Feedback sheet not
  // found' and the client's withFailureHandler called onSuccess anyway — so
  // every bug report and feature request silently went nowhere while telling
  // the user it had been sent.
  //
  // Column order matches the row built in 30_services/Feedback.js:52. Writes
  // are positional (docs/DATA_DICTIONARY.md §3.9), so these must stay in
  // step.
  Feedback: [
    'Feedback_ID',
    'Timestamp',
    'User_Email',
    'User_Name',
    // Feedback_Type, NOT 'Type'. getRecentFeedback and checkNpsEligibility
    // resolve this column BY HEADER NAME (Feedback.js:146, :276). With the
    // wrong name both silently degrade: checkNpsEligibility returns
    // eligible:true for everyone, so the NPS prompt reappears forever.
    // Values include 'nps_dismiss', written by dismissNpsPrompt.
    'Feedback_Type',
    'Context_Page',
    'Context_Action',
    'Request_ID',
    'NPS_Score',
    'Comment',
    'Category',
    'Browser_Info',
    'Page_URL'
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
