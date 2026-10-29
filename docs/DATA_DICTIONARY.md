---
title: "LETS Data Dictionary"
description: "Every spreadsheet tab, every column, its meaning, sensitivity, and provenance"
status: canonical
tier: 1
audience: "project manager, system owner, ISSO, developer planning a schema change"
last_updated: "2026-10-28"
evidence_base: "docs/evidence/pass6_schema_census.js"
---

# LETS Data Dictionary

**Deliverable 3 of 10.** Companion to [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) and [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md).

---

## How to read this document

The LETS database is **a Google Sheet**. Each table is a tab; each record is a row; each field is a column. There is no schema enforcement of any kind — no column types, no constraints, no validation. **The spreadsheet will accept anything typed into it**, and the application's correctness depends entirely on the data matching what the code expects.

That makes this document unusually load-bearing. It is the only place the expected shape is written down in one piece.

### Confidence markers, and what they mean here specifically

| Marker | Meaning in this document |
|---|---|
| `[VERIFIED]` | The column name and position are read directly from a schema declaration in code, or measured by `pass6_schema_census.js` |
| `[INFERRED]` | Reconstructed by cross-referencing a writer's positional order against a reader's field names. **The order is verified; the pairing is reasoned** |
| `[CLAIMED]` | Asserted by project documentation, not confirmed in code |
| `[UNKNOWN]` | Cannot be determined from the repository. Requires reading the live spreadsheet |

### Three things this dictionary cannot tell you

Stated up front rather than buried, because each one bounds how far you can trust what follows:

1. **Whether the live tabs match these schemas.** This document describes what the *code* declares and writes. A human has edited these sheets. **VT-06, VT-07, and VT-08** read the real header rows; until they run, every tab below is "what the code expects", not "what exists".
2. **Which schema owns the `Requests` tab.** Two incompatible schemas claim that exact tab name `[VERIFIED]`. §3.2 treats this properly rather than picking one.
3. **The full width of the live `Requests` tab.** The code adds three columns to it at runtime that no schema declares `[VERIFIED]`. A dictionary built only from source is **incomplete by construction**, and §3.2.4 says by how much.

### Sensitivity classification

Assigned from each column's semantics against the system's FIPS Moderate classification `[CLAIMED]` — `PROJECT_PLAN.md`.

| Label | Meaning |
|---|---|
| **PII** | Personally identifiable information — names, email addresses, employee IDs |
| **CUI** | Controlled Unclassified Information — pre-decisional justifications, mission-critical rationale |
| **Financial** | Cost figures, budget amounts, funding determinations |
| — | No special handling implied |

Every count in this document is produced by [`evidence/pass6_schema_census.js`](./evidence/pass6_schema_census.js).

---

## §3.0 The inventory at a glance

### 3.0.1 Three layers of tabs

| Layer | Tabs | Declared in | Status |
|---|---|---|---|
| **A — TRIP** | 16 | `SHEET_NAMES` `server/01_constants/Sheets.js:21` | **In use. This is the live database** |
| **B — LETS** | 7 | `LETS_CONFIG.sheets` `server/00_config/BudgetConfig.js` | **Declared, never created, never read** (§3.6) |
| **C — FAS tracker** | 1 tab, external | `FASTrackerSync.js` | **Another organisation's spreadsheet** (§3.7) |

**One tab name is claimed by both A and B** `[VERIFIED]`. That is §3.2.

### 3.0.2 Layer A — all sixteen tabs

| Tab | Columns | Schema in code? | Created by | Live? |
|---|---|---|---|---|
| `Requests` | **42** `[VERIFIED]` | Yes | `setupTravelDatabase` | **Core.** See §3.2 — may be 45 wide |
| `Request_Legs` | 15 | Yes | `setupTravelDatabase` | Core |
| `Request_Travelers` | 38 | Yes | `setupTravelDatabase` | Core |
| `Traveler_Leg_Costs` | 31 | Yes | `setupTravelDatabase` | Core |
| `Attachments` | 11 | Yes | `setupTravelDatabase` | Active |
| `Approval_Log` | 14 | Yes | `setupTravelDatabase` | **Core — the audit trail** |
| `Travel_Users` | 9 | Yes | `setupTravelDatabase` | **Core — identity** |
| `Travel_User_Roles` | 11 | Yes | `setupTravelDatabase` | **Core — authorization** |
| `Test_Submitters` | 6 | Yes | `setupTravelDatabase` | Fallback for non-HC users |
| `Error_Log` | 6 | Yes | **self-creates** on first error | Active |
| `Feedback` | 13 `[INFERRED]` | **NO** | **nothing** | **Used but uncreated** (§3.5.2) |
| `File_Queue` | — | **NO** | nothing | **Phantom — never used** (§3.5.3) |
| `DoD_Per_Diem` | 9 | **NO** | self-creates | Active via a duplicate constant |
| `DoD_Sync_Log` | 5 | **NO** | self-creates | Active via a duplicate constant |
| `Foreign_Per_Diem` | 11 | **NO** | self-creates | Active via a duplicate constant |
| `DOS_Sync_Tracker` | 4 | **NO** | self-creates | Active via a duplicate constant |

**Ten of sixteen tabs have a declared schema** `[VERIFIED]`. The gap matters because `setupTravelDatabase()` iterates the *schemas*, not the *names* — so the six without one are never created by setup. Five self-create on first use; one never does.

### 3.0.3 What the alignment test found

Every positional write in the codebase was measured against the schema it targets `[VERIFIED]`:

| Result | Count |
|---|---|
| Positional writes resolved | 22 |
| **Exactly match their schema width** | **15** |
| Trailing omission — writes fewer columns, leaves the rest blank | 5 |
| **Over-wide — would write past the declared schema** | **0** |

**No writer exceeds its schema.** The schemas in `Sheets.js` accurately describe what the code writes today — which is precisely why §3.9's never-reorder rule matters. The agreement is *positional*, and nothing re-checks it at run time.

The five trailing omissions are not corruption, but two of them are an audit gap worth knowing about (§3.4.3).

---

## §3.1 The relationships

```
                        ┌───────────────┐
                        │   Requests    │  PK: Request_ID
                        │   42 columns  │
                        └───┬───┬───┬───┘
            ┌───────────────┘   │   └───────────────┬──────────────┐
            │                   │                   │              │
    ┌───────▼────────┐  ┌───────▼─────────┐  ┌──────▼──────┐  ┌───▼────────┐
    │  Request_Legs  │  │Request_Travelers│  │ Attachments │  │Approval_Log│
    │   15 columns   │  │   38 columns    │  │ 11 columns  │  │ 14 columns │
    │  PK: Leg_ID    │  │ PK: Traveler_ID │  │PK: Attach_ID│  │PK: Log_ID  │
    └───────┬────────┘  └───────┬─────────┘  └─────────────┘  └────────────┘
            │                   │
            └─────────┬─────────┘
                      │
          ┌───────────▼────────────┐
          │   Traveler_Leg_Costs   │  PK: (Request_ID, Traveler_ID, Leg_ID)
          │      31 columns        │  — one row per traveller per leg
          └────────────────────────┘

    ┌──────────────┐         ┌───────────────────┐
    │ Travel_Users │────────▶│ Travel_User_Roles │  joined on User_ID
    │  9 columns   │         │    11 columns     │
    │ PK: User_ID  │         │   PK: Role_ID     │
    └──────────────┘         └───────────────────┘
          ╎
          ╎ Email = Requests.Submitter_Email
          ╎ (by convention only — not a key, not enforced)
```

### 3.1.1 What the code enforces, and what it does not

| Rule | Enforced? | Where |
|---|---|---|
| Child rows carry `Request_ID` | **Yes**, at write time | All four child writers put it in column 1 `[VERIFIED]` |
| Cascading delete across children | **Yes** — the only referential integrity in the system | `deleteTravelRequests` cascades across 6 tabs, children first `Admin_Cleanup.js:128` `[VERIFIED]` |
| Orphan prevention on partial failure | **No** | Five separate writes, no transaction (§3.8.2) |
| `Travel_User_Roles.User_ID` must exist | **At read time only** — the join skips roles whose user is missing or inactive `Access.js:267` | A role row pointing at a deleted user is invisible, not an error |
| `Role_Type` is one of six values | **Yes, on write** `Users.js:279, 713` `[VERIFIED]` | **Direct sheet edits bypass this entirely** |
| `Scope` required for scoped roles | **Yes, on write** `Users.js:287, 721` | Same bypass |
| One primary `aas_fo_reviewer` | **Yes** — adding a primary demotes the incumbent `Users.js:306-323` | Same bypass |
| `Submitter_Email` is a known user | **No** | Free text from the session |
| `Status` is a valid status code | **No column constraint.** Transitions are validated, values are not `Review_Action.js:303` | A direct sheet edit can set any string |
| Data-validation dropdowns | **None created by code** `[VERIFIED]` — zero `newDataValidation` calls | Manual ones would be `[UNKNOWN]` |
| Named ranges | **None** `[VERIFIED]` | |
| Sheet protections | **None created by code** `[VERIFIED]` | |

> **The sheet has no defences of its own.** Every rule above that says "yes, on write" means *the application validates it*. The spreadsheet does not. This is finding **G-045**, and it is why §1.5.1 of the Administrator's Guide ranks spreadsheet edit access as the **second** most powerful privilege in the system.

---

## §3.2 The `Requests` tab — and why it needs its own section

### 3.2.1 Two schemas claim this tab name

This tab gets a section rather than a row because **two incompatible schemas declare a tab named exactly `Requests`** `[VERIFIED]`, and no document can responsibly pick one without reading the live spreadsheet.

| | **Layer A — TRIP** | **Layer B — LETS** |
|---|---|---|
| Declared at | `Sheets.js:23` → `TRAVEL_SHEET_SCHEMAS.Requests` | `BudgetConfig.js` → `LetsDB.SCHEMAS['Requests']` |
| Columns | **42** | **20** |
| Column 1 | `Request_ID` | `RequestID` |
| Column 2 | `Status` | `Status` ← **the only shared header** |
| Column 3 | `Trip_Name` | `EventName` |
| ID format | `REQ-2026-0001` | `LETS-2027-001` |
| Status vocabulary | `PENDING_SECTOR`, `APPROVED_GOGOV`, `COMPLETED` … (15 values, mostly ALL_CAPS) | `Submitted - Pending Budget Check`, `Flagged - Insufficient Funds` … (12 prose values) |
| Naming convention | `Snake_Case_With_Underscores` | `PascalCaseNoSeparator` |
| **Written by** | **The live application** | **Nothing** |

This is finding **G-013**.

### 3.2.2 What this dictionary can and cannot say about it

**What is certain** `[VERIFIED]`: the running application writes the 42-column TRIP schema. `submitTravelRequestV2` builds a 42-element array and appends it, and that array matches the declared schema exactly `Submission.js:342`.

**What is certain about Layer B** `[VERIFIED]`: `LetsDB.initializeDatabase()` — the only function that would create the 20-column version — **is never called anywhere**. Nothing in the running system writes the LETS schema.

**What is not knowable from the repository** `[UNKNOWN]`: what row 1 of the live tab actually says. It could be the 42 TRIP headers, the 42 plus three runtime additions (§3.2.4), or something a human has edited.

> **This dictionary therefore states the TRIP 42-column schema as the operative one, and does not assert that the live tab matches it.**
>
> **VT-06 settles it in two minutes:** open the spreadsheet, read row 1 of the `Requests` tab verbatim, record the exact header text and the column count. Until then, treat §3.2.3 as "what the code writes", not "what is there".

### 3.2.3 The 42 declared columns

`[VERIFIED]` — `TRAVEL_SHEET_SCHEMAS.Requests`.

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1 | `Request_ID` | Primary key. Format `REQ-<year>-<4 digits>`. **No collision protection** (§3.8.1) | — |
| 2 | `Status` | Workflow state. One of 15 values (§3.8.4) | — |
| 3 | `Trip_Name` | Human-readable trip title | — |
| 4 | `Location_Type` | One of `conference`, `client-site`, `contractor-site`, `teb`, `other` | — |
| 5 | `Event_Start_Date` | First day of the event | — |
| 6 | `Event_End_Date` | Last day of the event | — |
| 7 | `Is_International` | Boolean flag | — |
| 8 | `Is_OCONUS` | Outside the continental US — `AK, HI, PR, VI, GU, AS, MP` | — |
| 9 | `BLUF` | "Bottom line up front" — the request's summary justification | **CUI** |
| 10 | `Purpose` | Travel purpose, from the Tier-1 list | **CUI** |
| 11 | `Travel_Types` | Categorisation of the travel | — |
| 12 | `Mission_Critical_Types` | Mission-criticality rationale | **CUI** |
| 13 | `Shared_Facilities` | Shared facilities cost | **Financial** |
| 14 | `Shared_Facilities_Desc` | Description of that cost | — |
| 15 | `Shared_AV` | Shared audio-visual cost | **Financial** |
| 16 | `Shared_AV_Desc` | Description | — |
| 17 | `Shared_Logistics` | Shared logistics cost | **Financial** |
| 18 | `Shared_Logistics_Desc` | Description | — |
| 19 | `Shared_Other` | Other shared cost | **Financial** |
| 20 | `Shared_Other_Desc` | Description | — |
| 21 | `Shared_Total` | Sum of columns 13, 15, 17, 19 | **Financial** |
| 22 | `Traveler_Total` | Sum of all travellers' subtotals | **Financial** |
| 23 | `Grand_Total` | `Shared_Total` + `Traveler_Total`. **The authoritative cost figure for System A** | **Financial** |
| 24 | `Traveler_Count` | Number of traveller rows | — |
| 25 | `Leg_Count` | Number of itinerary legs | — |
| 26 | `Submitter_Name` | Who submitted | **PII** |
| 27 | `Submitter_Email` | Submitter's address. **The field record-level authorization compares against** | **PII** |
| 28 | `Submitter_BU` | Business unit | — |
| 29 | `Submitter_Org_Code` | Organisation code | — |
| 30 | `Sector_Director_Name` | Routed sector director | **PII** |
| 31 | `Sector_Director_Email` | " | **PII** |
| 32 | `BU_Reviewer_Name` | Routed BU reviewer | **PII** |
| 33 | `BU_Reviewer_Email` | " | **PII** |
| 34 | `Current_Reviewer_Name` | Whoever the request is waiting on now | **PII** |
| 35 | `Current_Reviewer_Email` | **The field `submitReviewAction` checks to authorize an approval** | **PII** |
| 36 | `Initial_Review_Level` | Which stage the routing cascade started at | — |
| 37 | `Attachments_Folder` | Drive folder ID for this request's files | — |
| 38 | `Salesforce_Link` | Salesforce Event Tracker reference | — |
| 39 | `Created_At` | Row creation timestamp | — |
| 40 | `Updated_At` | Last modification timestamp | — |
| 41 | `Submitted_At` | Submission timestamp | — |
| 42 | `Version` | Optimistic-concurrency counter, incremented on edit | — |

**Columns 27 and 35 are the two most security-relevant fields in the database.** `Submitter_Email` and `Current_Reviewer_Email` are what record-level authorization compares the caller against — they are the *entire* access-control mechanism for the handful of functions that implement one (§3.4.4). A direct spreadsheet edit to either column reassigns authority over that request with no audit entry.

### 3.2.4 Three more columns appear at runtime

**The live tab will be 45 columns wide, not 42, as soon as any Division Director reports a funding issue** `[VERIFIED]`.

`reportDDFundingIssue` checks for three columns and **creates them if absent**, writing the header into the next free column `Review_DDConfirm.js:513, 522, 531`:

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 43 | `DD_Flagged_Travelers` | JSON array of traveller IDs the DD flagged | **PII** |
| 44 | `DD_Issue_Notes` | The DD's description of the funding problem | **CUI** |
| 45 | `DD_Issue_Reporter` | Which DD raised it | **PII** |

**None of the three appears in any schema** `[VERIFIED]`. Consequences:

1. **A reader comparing the live sheet to this dictionary will find three undocumented columns.** They are documented — here — but not in the code's own schema.
2. **A later `setupTravelDatabase()` run writes only the 42 schema headers**, leaving 43–45 intact. Benign, because it writes a 42-wide range rather than clearing the row.
3. **There is a latent bug in how the three find their position** `[VERIFIED]`. The first uses `headers.length + 1`; the other two use `getLastColumn() + 1`. **These differ whenever the sheet has trailing blank columns** — so under that condition two of the three could write to different positions than intended. This is part of finding **G-044**.

### 3.2.5 The LETS 20-column schema, for completeness

`[VERIFIED]` — `LetsDB.SCHEMAS['Requests']`. **Nothing writes this.** Recorded so that whoever resolves **BD-5** can see both sides.

| # | Column | # | Column |
|---|---|---|---|
| 1 | `RequestID` | 11 | `TotalActualCost` |
| 2 | `Status` | 12 | `Variance` |
| 3 | `EventName` | 13 | `BudgetCheckStatus` |
| 4 | `OwningOffice` | 14 | `SubmitterEmail` |
| 5 | `FundingSource` | 15 | `SubmitterName` |
| 6 | `SetAsideType` | 16 | `Destination` |
| 7 | `IsEventPlanItem` | 17 | `StartDate` |
| 8 | `Is_LC_Travel` | 18 | `EndDate` |
| 9 | `Is_COE_Travel` | 19 | `CreatedAt` |
| 10 | `TotalEstimatedCost` | 20 | `UpdatedAt` |

**Note columns 8 and 9.** `Is_LC_Travel` and `Is_COE_Travel` break the schema's own PascalCase convention with underscores `[VERIFIED]` — the only two that do. Worth recording because a future reader will otherwise assume a typo and "fix" it.

---

## §3.3 The request child tabs

One request has many legs, many travellers, one cost row per traveller per leg, any number of attachments, and an audit trail.

### 3.3.1 `Request_Legs` — 15 columns

One row per itinerary leg. `[VERIFIED]`

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1 | `Request_ID` | Parent request | — |
| 2 | `Leg_ID` | Format `leg_<epoch ms>_<index>`, or client-supplied | — |
| 3 | `Leg_Number` | Ordering within the trip | — |
| 4 | `Site_Name` | Destination site | — |
| 5 | `City` | — | — |
| 6 | `State` | — | — |
| 7 | `Country` | — | — |
| 8 | `Start_Date` | Arrival | — |
| 9 | `End_Date` | Departure | — |
| 10 | `Is_International` | Flag | — |
| 11 | `Is_OCONUS` | Flag | — |
| 12 | `Per_Diem_Source` | Which rate source applied — GSA, DoD, or State | — |
| 13 | `Lodging_Rate` | Nightly rate used | **Financial** |
| 14 | `MIE_Rate` | Meals and incidentals rate used | **Financial** |
| 15 | `Location_Display` | Formatted location string for the UI | — |

**Columns 13 and 14 are a snapshot, not a reference.** The rate in force at the time of submission is copied into the row. A later per-diem sync does not retroactively change an existing request — which is correct behaviour, and worth knowing before anyone tries to reconcile a request against current rates.

### 3.3.2 `Request_Travelers` — 38 columns

One row per traveller per request. The widest child tab, and the one holding the most sensitive data. `[VERIFIED]`

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1 | `Request_ID` | Parent request | — |
| 2 | `Traveler_ID` | Format `traveler_<epoch ms>_<index>` | — |
| 3 | `Employee_ID` | HC employee identifier | **PII** |
| 4 | `Employee_Name` | — | **PII** |
| 5 | `Email` | — | **PII** |
| 6 | `Org_Code` | — | — |
| 7 | `Business_Unit` | — | — |
| 8 | `LCAT` | Labour category | **PII** |
| 9 | `DD_Name` | Division Director who must confirm funding | **PII** |
| 10 | `DD_Email` | **The field DD confirmation authorizes against** `Review_DDConfirm.js:330` | **PII** |
| 11 | `Duty_Location` | Where the traveller is based | **PII** |
| 12 | `Duty_Location_Code` | — | **PII** |
| 13 | `Attending_Legs` | Which legs this traveller is on | — |
| 14 | `Transport_Mode` | `private` or `gov` | — |
| 15 | `Ticket_Cost` | Airfare | **Financial** |
| 16 | `Total_Miles` | Driving distance | **Financial** |
| 17 | `Mileage_Rate` | Rate applied — snapshot (§3.3.1) | **Financial** |
| 18 | `Needs_Rental_Car` | Flag | — |
| 19 | `Rental_Car_Cost` | — | **Financial** |
| 20 | `Transportation_Total` | Sum of transport costs | **Financial** |
| 21 | `Lodging_Total` | Rolled up from `Traveler_Leg_Costs` | **Financial** |
| 22 | `MIE_Total` | " | **Financial** |
| 23 | `Local_Travel_Total` | " | **Financial** |
| 24 | `Other_Percentage` | Uplift percentage applied | **Financial** |
| 25 | `Other_Total` | Computed from the percentage | **Financial** |
| 26 | `Subtotal` | This traveller's total | **Financial** |
| 27 | `Is_Client_Paid` | **The field that decides FAS routing.** See the warning below | — |
| 28 | `Role_Justification` | Why this person must travel | **CUI** |
| 29 | `Is_Full_Time_Telework` | — | **PII** |
| 30 | `Normal_Commute_Distance` | Used to net off normal commuting | **PII** |
| 31 | `Normal_Commute_Parking` | " | **PII** |
| 32 | `Has_Security_Clearance` | — | **PII** |
| 33 | `Has_Valid_Passport` | — | **PII** |
| 34 | `Is_Speaking` | Presenting at the event | — |
| 35 | `Event_Open_To_Press` | — | — |
| 36 | `Receiving_NFS` | Receiving non-federal sponsorship | — |
| 37 | `DD_Confirmed` | Set TRUE when that traveller's DD confirms funding | — |
| 38 | `DD_Confirmed_At` | Timestamp | — |

> **Column 27, `Is_Client_Paid`, carries more weight than its name suggests.** It determines whether a request needs FAS Front Office review for Executive Order 14222 compliance. The test is `!val || val === 'overhead'` `[VERIFIED]` `Review_Action.js:528` — meaning **a blank cell counts as overhead-funded** and routes to *more* scrutiny. That is the correct conservative default and is one of the system's quiet strengths.
>
> It is also the field that **`submitFundingCorrection` can flip with no authorization check** (**G-003**) `[VERIFIED]`. Anyone who can reach the system can change a request's funding determination.

**Columns 29–33 deserve an ISSO's attention.** Telework status, commute distance, security clearance, and passport validity are personnel attributes stored in a spreadsheet whose sharing list is an access-control list (§3.1.1). They are collected for legitimate cost and logistics reasons; they are also the most sensitive fields in the database.

> **A related disclosure that is not in any tab.** Six real named GSA employees' email addresses are embedded in routing-test fixtures in `Submission.js`, with their role assignments labelled `[VERIFIED]` — finding **G-056**. It is inherited TRIP code, not LETS-added, and it is the one place personnel data appears in **source** rather than in the database.

**On submission, 36 of the 38 columns are written** `[VERIFIED]`. Columns 37 and 38 are intentionally left blank — no Division Director has confirmed anything at submission time. That is correct, and it is the clearest example of why a narrower write is not automatically a defect.

### 3.3.3 `Traveler_Leg_Costs` — 31 columns

One row per traveller per leg — the finest-grained cost data in the system. `[VERIFIED]`
Composite key: (`Request_ID`, `Traveler_ID`, `Leg_ID`).

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1–3 | `Request_ID`, `Traveler_ID`, `Leg_ID` | The composite key | — |
| 4 | `City` | Leg destination | — |
| 5 | `Lodging_Start_Date` | — | — |
| 6 | `Lodging_End_Date` | — | — |
| 7 | `Lodging_Uses_Itinerary_Dates` | Whether lodging dates were derived or entered | — |
| 8 | `MIE_Start_Date` | — | — |
| 9 | `MIE_End_Date` | — | — |
| 10 | `MIE_Uses_Itinerary_Dates` | — | — |
| 11 | `Is_Local_Travel` | No overnight stay | — |
| 12 | `Lodging_Rate` | Per-diem rate applied | **Financial** |
| 13 | `Lodging_Nights` | Count | — |
| 14 | `Lodging_Calculated` | Rate × nights | **Financial** |
| 15 | `Lodging_Override` | Flag — a human overrode the calculation | — |
| 16 | `Lodging_Override_Amount` | The overriding figure | **Financial** |
| 17 | `Lodging_Override_Reason` | Written justification | **CUI** |
| 18 | `Lodging_Total` | The figure actually used | **Financial** |
| 19 | `MIE_Rate` | — | **Financial** |
| 20 | `MIE_Days` | Count | — |
| 21 | `MIE_Calculated` | Rate × days | **Financial** |
| 22 | `MIE_Override` | Flag | — |
| 23 | `MIE_Override_Amount` | — | **Financial** |
| 24 | `MIE_Override_Reason` | Written justification | **CUI** |
| 25 | `MIE_Total` | The figure used | **Financial** |
| 26 | `Local_Miles_Driven` | — | **Financial** |
| 27 | `Was_Gov_Vehicle_Available` | Affects the mileage rate | — |
| 28 | `Local_Parking` | — | **Financial** |
| 29 | `Local_Tolls` | — | **Financial** |
| 30 | `Local_Travel_Total` | — | **Financial** |
| 31 | `Leg_Subtotal` | This leg for this traveller | **Financial** |

**The override triplets (15–17 and 22–24) are the audit-relevant part of this tab.** Each records that a human overrode a computed per-diem figure, by how much, and why. Those three columns together are the evidence for any question about why a cost differs from the published rate — and the reason columns are the only free-text justification of a financial decision anywhere in the child tabs.

### 3.3.4 `Attachments` — 11 columns

Metadata only. The files themselves live in a Shared Drive. `[VERIFIED]`

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1 | `Request_ID` | Parent request | — |
| 2 | `Attachment_ID` | Format `att_<epoch ms>_<6 random chars>` | — |
| 3 | `Traveler_ID` | Optional — attachments can be request- or traveller-level | — |
| 4 | `File_Name` | — | — |
| 5 | `File_ID` | **The Drive file ID.** See the warning below | — |
| 6 | `File_URL` | Direct Drive link | — |
| 7 | `File_Type` | MIME type | — |
| 8 | `File_Size` | Bytes | — |
| 9 | `Category` | Classification of the document | — |
| 10 | `Uploaded_By` | — | **PII** |
| 11 | `Uploaded_At` | Timestamp | — |

> **Column 5 is the link in a disclosure chain.** `getRequestAttachments` returns these file IDs to any caller, and `shareAttachmentsWithUsers` will grant access to any file ID handed to it — both unguarded (**G-004**) `[VERIFIED]`. The file ID is not a secret, but in this system it is the only thing standing between a request ID and the documents attached to it.
>
> **And `deleteTravelDraftFile` will trash any Drive file ID with no ownership check** (**G-005**) `[VERIFIED]`.

**Separately: everything in the Shared Drive is visible to that drive's membership regardless of LETS role** `[VERIFIED]`. **VT-13** lists who that is.

---

## §3.4 The authorization and audit tabs

**These three tabs are the most operationally important in the database.** Two of them decide who can do what; the third is the only audit trail the system has.

### 3.4.1 `Travel_Users` — 9 columns

The identity table. One row per person known to the system. `[VERIFIED]`

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1 | `User_ID` | Primary key. The HC `employee_id`, or `ext_<token>` for externals | — |
| 2 | `Email` | **The address all authorization is keyed to.** Patched automatically by self-heal (§3.4.5) | **PII** |
| 3 | `Name` | Display name | **PII** |
| 4 | `Source` | How the row was created — HC lookup or admin entry | — |
| 5 | `Is_Active` | **Read the warning below before touching this column** | — |
| 6 | `Created_By` | Which admin added them | **PII** |
| 7 | `Created_At` | Timestamp | — |
| 8 | `Updated_By` | Last modifier — or the literal `hc_self_heal` (§3.4.5) | **PII** |
| 9 | `Updated_At` | Timestamp | — |

### 3.4.2 `Travel_User_Roles` — 11 columns

The authorization table. One row per role grant. A person may hold several. `[VERIFIED]`

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1 | `Role_ID` | Format `role_<12 hex>` — a digest of (`User_ID`, `Role_Type`, `Scope`), so **deterministic and idempotent by design** | — |
| 2 | `User_ID` | Joins to `Travel_Users.User_ID` | — |
| 3 | `Role_Type` | One of six values (§3.8.5). Validated on write, **not** on direct sheet edit | — |
| 4 | `Scope` | BU name or sector code. **Required** for `bu_reviewer` and `sector_override` | — |
| 5 | `Is_Primary` | Decides who gets *routed* to. **Grants no extra privilege** | — |
| 6 | `Is_Active` | **Same parsing trap as `Travel_Users.Is_Active`** — see below | — |
| 7 | `Notes` | Free text | **CUI** |
| 8 | `Granted_By` | The granting admin's email — or the literal `bootstrap` (§3.4.5) | **PII** |
| 9 | `Granted_At` | Timestamp | — |
| 10 | `Updated_By` | Last modifier | **PII** |
| 11 | `Updated_At` | **Overwritten on every change. No history is kept** | — |

### 3.4.3 The `Is_Active` parsing trap

**This applies to both tabs and it is the single most likely way to think you have revoked access when you have not.**

A row is treated as inactive **only** when the value is boolean `false` or the text `"false"` `[VERIFIED]` `Access.js:243, 266`:

```javascript
if (rawActive === false || String(rawActive).toLowerCase() === 'false') continue;
```

Everything else means **active**:

| Value typed | Result |
|---|---|
| `FALSE` (boolean, as the console writes) | **Inactive** ✓ |
| `false` / `False` / `FALSE` (text) | **Inactive** ✓ |
| *(blank)* | **ACTIVE** |
| `no` / `N` / `0` | **ACTIVE** |
| `inactive` / `disabled` | **ACTIVE** |
| `"FALSE "` with a trailing space | **ACTIVE** — `String()` does not trim here |

This is finding **G-032**. **Revoke through the admin console**, which writes a proper boolean `[VERIFIED]` `Users.js:908-914`. The failure direction is safe on *creation* — a blank `Is_Active` on a new row means active, so a new user is never accidentally invisible.

**VT-27** captures the raw values actually present in the live tabs, from **VT-05**'s export.

### 3.4.4 `Approval_Log` — 14 columns

The audit trail. Append-only in practice, though nothing enforces that. `[VERIFIED]`

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1 | `Log_ID` | **Two incompatible formats in one column** — see below | — |
| 2 | `Request_ID` | Which request | — |
| 3 | `Action` | One of 22 action types (§3.8.6) | — |
| 4 | `Action_By_Name` | Who acted | **PII** |
| 5 | `Action_By_Email` | **Reliable.** The real caller's address | **PII** |
| 6 | `Action_By_Role` | **Not reliable** — see the warning below | — |
| 7 | `Timestamp` | When | — |
| 8 | `Previous_Status` | State before | — |
| 9 | `New_Status` | State after | — |
| 10 | `Comments` | The actor's written comment. Mandatory for every `needs_info` and every denial | **CUI** |
| 11 | `Section_Comments` | Per-section review comments | **CUI** |
| 12 | `Snapshot_Data` | JSON snapshot of the request at the time | **CUI** |
| 13 | `Version_Before` | Optimistic-concurrency version before | — |
| 14 | `Version_After` | " after | — |

> **Column 6, `Action_By_Role`, cannot be trusted where it reads `Submitter`.** Six write sites hardcode that literal string regardless of who actually called the function `[VERIFIED]` `Review_Update.js:155, 360, 707, 1553, 1710, 2677`. The caller may have been an admin or a reviewer. **Column 5 is real; column 6 beside it may be an assertion rather than a record.**

**Two findings sit in this tab, and both are things an auditor will ask about.**

**`Log_ID` has two formats** `[VERIFIED]` — finding **G-058**:

| Path | Generator | Format | Call sites |
|---|---|---|---|
| Workflow actions | `generateLogId()` | `LOG-000123` — sequential | 13 |
| Admin actions and bulk role changes | `Utilities.getUuid()` | `a1b2c3d4-…` | 4 |

Both land in column 1. `generateLogId()` scans only for the `LOG-` prefix and ignores UUIDs, so the sequence is unaffected — but anything that parses or sorts `Log_ID` must handle both vocabularies.

**`Version_Before` and `Version_After` are blank for every administrator action** `[VERIFIED]`. The alignment test found this: fourteen writers populate all 14 columns, and **four write only 12**, leaving the version columns empty:

| Writer | What it logs |
|---|---|
| `Admin_Actions.js:68` | `ADMIN_OVERRIDE` — an admin forcing a status change |
| `Admin_Actions.js:142` | `ADMIN_REASSIGN` — an admin reassigning a reviewer |
| `Users.js:1602` | Bulk reviewer reassignment following a role change |
| `Users.js:1767` | Bulk reviewer orphaning following a role change |

**So the audit trail carries before/after versions for ordinary reviewer actions and omits them for administrator actions** — the opposite of what an auditor would want. This is not a corruption bug; `appendRow` simply leaves the trailing columns blank. It is a data-quality gap in exactly the four places where the actor held the most authority.

### 3.4.5 Two values in these tabs that are not a person

When reading the audit columns, two literal strings appear where you would expect an email address `[VERIFIED]`:

| Value | Appears in | What it means |
|---|---|---|
| `bootstrap` | `Travel_User_Roles.Granted_By` | The role was created by `bootstrapTravelAdmin`. **The actual caller is not recorded anywhere** — finding **G-002**. If you see this value, someone self-granted admin and the system does not know who |
| `hc_self_heal` | `Travel_Users.Updated_By` | The email was patched automatically after an HC lookup found a changed address. **The previous email is not retained in any sheet** — only in the Apps Script execution log. Finding **G-027** |

**`bootstrap` in `Granted_By` is the single most important value to look for in this database.** **VT-04** searches for exactly that, and it must run **before** G-002 is remediated, because remediation destroys the evidence.

### 3.4.6 `Test_Submitters` — 6 columns

A fallback identity source for users absent from HC. `[VERIFIED]`

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1 | `Email` | Primary key | **PII** |
| 2 | `Name` | — | **PII** |
| 3 | `Org_Code` | — | — |
| 4 | `BU_Name` | Business unit for routing | — |
| 5 | `Is_Active` | — | — |
| 6 | `Suppress_Emails` | **Never written by the seeding function** — see below | — |

**The seeder writes only 5 of the 6 columns** `[VERIFIED]` `Database.js:746`, leaving `Suppress_Emails` blank.

**The reader resolves that safely.** `_isTestSubmitter()` tests `flag === true || String(flag).toUpperCase() === 'TRUE'` `[VERIFIED]` `Email.js:3574` — so a blank means "do not suppress", mail is sent normally, and the whole function returns `false` on any error so a misconfigured row can never break email.

**This is the opposite of the `Is_Active` trap, and the comparison is instructive.** Both columns are boolean-ish fields read from a spreadsheet. `Is_Active` defaults to the *permissive* reading (blank = active = has access), which is a security hazard. `Suppress_Emails` defaults to the *conservative* reading (blank = do not suppress = behave normally), which is correct. Same codebase, same kind of column, opposite defaults — which is worth noting because it shows the `Is_Active` behaviour is an oversight rather than a house style.

A separate one-shot migration exists to add this column to live sheets that predate it `Database.js:585-605` `[VERIFIED]`, which is why the seeder and the schema can disagree about its presence.

---

## §3.5 The operational tabs

Six tabs that support the system rather than hold travel data. **None of the six has a declared schema** `[VERIFIED]`, and that single fact explains all three findings in this section.

### 3.5.1 `Error_Log` — 6 columns

The only tab that self-creates *and* has a schema. `[VERIFIED]`

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1 | `Timestamp` | When | — |
| 2 | `User_Email` | Who was acting | **PII** |
| 3 | `Function_Name` | Where it failed | — |
| 4 | `Error_Message` | — | **CUI** |
| 5 | `Stack_Trace` | — | **CUI** |
| 6 | `Context` | Serialised context at failure | **CUI** |

`logError` creates the tab with headers on first use if it is absent `[VERIFIED]` `Errors.js:50-58`, then appends a 6-element row — matching the schema exactly. **This is the pattern the `Feedback` tab should have followed.**

Columns 4–6 are marked CUI because a stack trace and serialised context can contain request content, email addresses, and internal paths.

### 3.5.2 `Feedback` — 13 columns, and no schema anywhere

This tab is **written and read by the application but declared nowhere** `[VERIFIED]`. This is finding **G-041**.

| What happens | Detail |
|---|---|
| Written by | `submitTravelFeedback` appends 13 values `Feedback.js:69`; `dismissNpsPrompt` appends 13 more `:211` `[VERIFIED]` |
| Read by | `getRecentFeedback` resolves columns **by header name** `[VERIFIED]` |
| Declared in `TRAVEL_SHEET_SCHEMAS` | **No** |
| Created by `setupTravelDatabase` | **No** |
| Self-creates on first use | **No** — unlike `Error_Log` and the four per-diem tabs |
| What a user sees if it is absent | `submitTravelFeedback` returns *"Feedback sheet not found"* `Feedback.js:45` — a visible failure. **No data is lost, but no feedback is captured** |

**The required header row, reconstructed** `[INFERRED]`:

| # | Required header | Source in the writer |
|---|---|---|
| 1 | `Feedback_ID` | `fb_<epoch ms>_<6 random>` |
| 2 | `Timestamp` | `new Date()` |
| 3 | `User_Email` | `Session.getActiveUser().getEmail()` |
| 4 | `User_Name` | `feedbackData.userName` |
| 5 | `Feedback_Type` | `feedbackData.type` — including the literal `nps_dismiss` |
| 6 | `Context_Page` | `feedbackData.contextPage` |
| 7 | `Context_Action` | `feedbackData.contextAction` |
| 8 | `Request_ID` | `feedbackData.requestId` |
| 9 | `NPS_Score` | numeric, only when `type === 'nps'` |
| 10 | `Comment` | `feedbackData.comment` |
| 11 | `Category` | `feedbackData.category` |
| 12 | `Browser_Info` | `feedbackData.browserInfo` |
| 13 | `Page_URL` | `feedbackData.pageUrl` |

> **Be precise about the confidence here.** The **order** is `[VERIFIED]` — read straight from the writer's positional array. The **names** are `[VERIFIED]` — read from what the reader looks up by header. **The pairing of name to position is `[INFERRED]`.**
>
> Three of the thirteen are certain in both respects because the reader resolves them explicitly: `User_Email`, `Feedback_Type`, and `Timestamp` `[VERIFIED]` `Feedback.js:145-147`. The other ten are reasoned from order.
>
> **VT-15 settles it:** does a `Feedback` tab exist in the live database, and what is its row 1? If one exists and its headers differ from this list, **the live tab wins** and this table should be corrected.

**The fix is one line of code** — add this array to `TRAVEL_SHEET_SCHEMAS` so the tab is created by setup like every other. Recorded here because it is probably the cheapest closeable finding in the entire register.

### 3.5.3 `File_Queue` — a phantom

`SHEET_NAMES.FILE_QUEUE = 'File_Queue'` `[VERIFIED]` `Sheets.js:38`. **That line is the only occurrence of the name or the string anywhere in the codebase** `[VERIFIED]` — measured directly: 1 literal reference, 0 uses via the registry key.

No schema, no reader, no writer, no creator. This is finding **G-057**, rated Low.

**Speculation on intent** `[INFERRED]`: the name and its placement under the `// Operational` comment beside `Error_Log` and `Feedback` suggest a planned asynchronous file-processing queue — most plausibly to decouple Drive uploads from the request-submission path, which currently happen inline. Worth recording for whoever later wonders whether attachment handling was meant to be asynchronous.

**Do not delete the constant to tidy up.** It costs nothing and its presence is the only surviving record of the intent.

### 3.5.4 The four per-diem tabs

Reference data synced from external sources. All four **self-create**, all four are **read positionally**, and all four **bypass the sheet-name registry** `[VERIFIED]`.

**`DoD_Per_Diem` — 9 columns** `[VERIFIED]` `DoDSync.js:161`:

| # | Header (exact) | # | Header (exact) |
|---|---|---|---|
| 1 | `Territory` | 6 | `MIE` |
| 2 | `Locality` | 7 | `Per Diem` |
| 3 | `Season Start` | 8 | `Effective Date` |
| 4 | `Season End` | 9 | `Document Number` |
| 5 | `Lodging` | | |

**`Foreign_Per_Diem` — 11 columns** `[VERIFIED]` `ForeignSync.js:497`:

| # | Header (exact) | # | Header (exact) |
|---|---|---|---|
| 1 | `Country` | 7 | `M&IE` |
| 2 | `Location` | 8 | `Per Diem` |
| 3 | `Season Code` | 9 | `Effective Date` |
| 4 | `Season Start` | 10 | `Footnote` |
| 5 | `Season End` | 11 | `Location Code` |
| 6 | `Lodging` | | |

**`DoD_Sync_Log` — 5 columns** `[VERIFIED]`: `Timestamp`, `Document Number`, `Territory`, `Rows Added`, `Status`. Append-only; nothing reads it.

**`DOS_Sync_Tracker` — 4 columns** `[VERIFIED]`: `Sync Key`, `Synced At`, `Record Count`, `Source URL`. Read positionally to decide whether a re-sync is needed.

**Three things to notice about these four:**

1. **The header style breaks the convention used everywhere else.** `Season Start` with a space, `M&IE` with an ampersand `[VERIFIED]`. Harmless given positional access — but it means these four tabs **cannot** be read by the header-name pattern the rest of the system uses.
2. **They are addressed through duplicate constants, bypassing `SHEET_NAMES`** — finding **G-042**. Measured: each has **0** uses via its registry key and 2–3 literal references instead `[VERIFIED]`.

   | Tab | Registry entry (unused) | What the code actually uses |
   |---|---|---|
   | `DoD_Per_Diem` | `SHEET_NAMES.DOD_PER_DIEM` | `DOD_PERDIEM_SHEET_NAME` **and** `DOD_SHEET_NAME` — two constants for one tab |
   | `DoD_Sync_Log` | `SHEET_NAMES.DOD_SYNC_LOG` | `DOD_SYNC_LOG_SHEET_NAME` |
   | `Foreign_Per_Diem` | `SHEET_NAMES.FOREIGN_PER_DIEM` | `DOS_PERDIEM_SHEET_NAME` **and** `FOREIGN_PERDIEM_SHEET_NAME` — two constants |
   | `DOS_Sync_Tracker` | `SHEET_NAMES.DOS_SYNC_TRACKER` | `DOS_SYNC_TRACKER_SHEET` |

   **`Sheets.js`'s own header comment promises that "a sheet rename happens in exactly one place"** `[VERIFIED]`. For these four tabs that promise is false — renaming via the registry would change nothing while the duplicate constants kept pointing at the old name. This is one of the eleven documentation contradictions in Administrator's Guide §1.8.3.
3. **GSA CONUS rates are not in a tab at all.** They come live from `api.gsa.gov` with cache-based caching `[VERIFIED]` `PerDiemGSA.js`, requiring the `GSA_PERDIEM_API_KEY` Script Property. So three of the four rate sources are sheet-backed and one is not — relevant if anyone tries to audit rates from the spreadsheet alone.

---

## §3.6 Layer B — the seven LETS budget tabs

### 3.6.1 Read this section differently

**None of these seven tabs exists.** `LetsDB.initializeDatabase()` — the only function that would create them — **is never called anywhere in the codebase** `[VERIFIED]`. Nothing reads them, nothing writes them, and the modules that would are structurally unreachable (see `SYSTEM_COMPONENT_MAP.md` §2.6, finding **G-016**).

This section is therefore **a specification, not a description.** It is included because:

1. The schemas are complete and considered — they are a real design, not a sketch.
2. **Everything in §3.6.4 goes live the moment the budget layer is wired**, and knowing that in advance is the difference between a planned migration and a surprise.
3. The one defect in §3.6.3 makes "wire up the budget engine" a larger job than it appears.

### 3.6.2 The seven tabs

`[VERIFIED]` — `LetsDB.SCHEMAS`.

| Tab | Columns | Seeded at creation? |
|---|---|---|
| `Budgets` | 12 | **Yes** — 4 rows from `baselineAllocations` |
| `Budget_Adjustments` | 7 | No |
| `Set_Asides` | 7 | **Yes** — 5 rows from `defaultSetAsides` |
| `Org_Approvers` | 8 | **Yes** — 4 rows from `defaultApprovers` |
| **`Requests`** | **20** | No — **and this is the collision** (§3.2) |
| `Travelers` | 16 | No |
| `Audit_Log` | 7 | No |

**`Budgets` — 12 columns.** One row per budget-holding office.

| # | Column | Meaning | Sensitivity |
|---|---|---|---|
| 1 | `OfficeCode` | `FO`, `OMD`, `IDV`, or `CM` | — |
| 2 | `OfficeName` | Display name | — |
| 3 | `BaselineAllocation` | Start-of-year allocation | **Financial** |
| 4 | `MidYearAdjustments` | Net adjustments applied | **Financial** |
| 5 | `CurrentTotalAllocation` | Baseline + adjustments | **Financial** |
| 6 | `ProportionalShare` | This office's share of enterprise set-asides | **Financial** |
| 7 | `SelfFundedSetAsides` | Set-asides this office funds alone | **Financial** |
| 8 | `EnterpriseSetAsidesAllocated` | Share of enterprise-wide set-asides | **Financial** |
| 9 | `CommittedPendingEstimated` | Committed but not yet spent | **Financial** |
| 10 | `PostedActualSpend` | Actuals posted | **Financial** |
| 11 | `RemainingDiscretionaryBalance` | **The figure the gatekeeper checks** | **Financial** |
| 12 | `LastCalculated` | Timestamp of the last recalculation | — |

**The seed values** `[VERIFIED]` `BudgetConfig.js:11-38` — fiscal year **FY27**:

| Office | Name | Baseline | Proportional share |
|---|---|---|---|
| `FO` | Front Office / AC | $4,000 | — (not a DAC) |
| `OMD` | OMD DAC | $152,000 | 15.3% |
| `IDV` | IDV DAC | $659,000 | 66.4% |
| `CM` | CM DAC | $182,000 | 18.3% |

**`Set_Asides` — 7 columns:** `SetAsideID`, `Title`, `Type`, `TargetOffice`, `Amount` (**Financial**), `Description`, `Active`.

> **`Active` is never read by any code** `[VERIFIED]` — finding **G-052**. Deactivating a set-aside by setting this column to `FALSE` would have no effect. The column exists; nothing consults it.

**`Budget_Adjustments` — 7 columns:** `AdjustmentID`, `OfficeCode`, `Amount` (**Financial**), `Reason`, `EffectiveDate`, `ApprovedBy` (**PII**), `Timestamp`.

**`Org_Approvers` — 8 columns:** `OfficeCode`, `OfficeName`, `PrimaryApproverName` (**PII**), `PrimaryApproverEmail` (**PII**), `AlternateApproverName` (**PII**), `AlternateApproverEmail` (**PII**), `LastUpdated`, `UpdatedBy` (**PII**).

> **The seeded approver addresses are placeholders** of the form `<office>.director@gsa.gov` — finding **G-063** `[VERIFIED]`. Eight of them, three rendered on the budget dashboard as if they were real system configuration. **These must be replaced before this tab is created**, or the system will be seeded with addresses that do not exist.
>
> Note also that `Org_Approvers` is **a second, incompatible approval model** — the live routing uses `Travel_User_Roles`. Wiring one does not wire the other.

**`Travelers` — 16 columns:** `TravelerID`, `AssociatedRequestID`, `TravelerName` (**PII**), `TravelerEmail` (**PII**), then six estimate/actual pairs — `EstAirfare`/`ActAirfare`, `EstLodging`/`ActLodging`, `EstMie`/`ActMie`, `EstOther`/`ActOther` — plus `TotalEstimated`, `TotalActual`, `Variance` (all **Financial**), and `Status`.

> **This is the only place in the entire system designed to hold actual costs.** Layer A's `Request_Travelers` has 38 columns of estimates and **no actuals columns at all** `[VERIFIED]`. So reconciliation — comparing what a trip was estimated to cost against what it did cost — has exactly one intended home, and that home does not exist. This is the data-level expression of **G-019**: `COMPLETED` means "funding confirmed", not "travel finished".

**`Audit_Log` — 7 columns:** `LogID`, `Timestamp`, `ActorEmail` (**PII**), `ActionType`, `TargetEntity`, `EntityID`, `DetailsJSON` (**CUI**).

### 3.6.3 Why these tabs could not be read even if they existed

**This is the finding that makes wiring harder than it looks.** `[VERIFIED]` — finding **G-040**.

`LetsDB.sheetDataToObjects()` keys each row object by **raw header text**:

```javascript
headers.forEach((h, colIdx) => { obj[h] = row[colIdx]; });
```

So reading `Budgets` yields objects with keys `OfficeCode`, `OfficeName`, `BaselineAllocation`, and so on.

**But `BudgetEngine` reads camelCase properties** — `office.name`, `office.baselineAmount`, `item.amount`, `req.owningOffice`.

Measured mechanically:

| Measure | Count |
|---|---|
| Distinct camelCase properties `BudgetEngine` reads | 20 |
| Distinct column headers `LetsDB` declares | 70 |
| **Headers that are also a property the engine reads** | **0** |

**Zero overlap.** Not one declared header matches any property the engine reads `[VERIFIED]`. JavaScript returns `undefined` for a missing key, and the engine's coercions are `Number(x) || 0` — so **every sheet-sourced financial field silently becomes zero.**

**Demonstrated by execution, not inferred.** `pass3_D7_sheet_shape_mismatch.js` builds the exact objects `sheetDataToObjects()` would return and feeds them to the engine:

```
officeName                   : undefined
baselineAllocation           : 0
remainingDiscretionaryBalance: 0
isDeficit                    : false

gatekeeper on a $2,500 request:
  hasSufficientFunds : false
  message            : INSUFFICIENT FUNDS: Requested $2,500 exceeds available
                       discretionary balance of $0
```

**Every office would report a $0 budget and the gatekeeper would reject every request as unfunded** — including requests well within a real allocation.

**Why no test caught it** `[VERIFIED]`: the test suites feed the engine objects taken directly from `LETS_CONFIG`, which uses camelCase. The path from sheet → object → engine is the one path no test exercises. **Green tests here prove the arithmetic, not the integration.**

**The fix, and where to put it** `[INFERRED]`: add a mapping layer in `LetsDB` that translates header text to the engine's property names on read. Doing it there — rather than renaming the sheet headers — keeps the tabs human-readable and leaves the tested engine untouched. A regression test that round-trips through `sheetDataToObjects` should land in the same change, or the defect will return.

### 3.6.4 What goes live the moment this layer is wired

Seventeen findings currently describe latent defects in this layer. **Wiring it activates them all at once**, so wiring must not be scoped as a small task:

| Finding | What activates |
|---|---|
| **G-013** | The `Requests` tab-name collision becomes real |
| **G-040** | Every budget reads as $0 (§3.6.3) |
| **G-052** | `Set_Asides.Active` deactivations silently do nothing |
| **G-037** | `LETS-` IDs are count-based: they collide under concurrency, reuse numbers after deletion, and are **hardcoded to FY27** |
| **G-035** | `RECONCILED` with blank actuals frees the entire commitment |
| **G-036** | `reconcileRequest` overwrites the approved estimate, destroying the variance basis |
| **G-051** | No validation on cost — a negative estimate *increases* the apparent budget |
| **G-063** | Eight placeholder approver addresses are seeded as live config |

> **The scheduling conclusion, and it is the most useful fact in this section:** there is no production data in these tabs and no user depending on current behaviour. **Fixing these eight is cheaper now than it will ever be again** — and they should be fixed *before* wiring, not after.

---

## §3.7 Layer C — the external FAS tracker

**This is not our spreadsheet.** It belongs to another organisation and is the system of record for Executive Order 14222 travel-exception reporting. The structure below is inferred entirely from how the code reads and writes it `[INFERRED]` from `[VERIFIED]` code. **The real sheet is `[UNKNOWN]`.**

Tab name expected: `'FAS Travel Exceptions'`, **with a silent fallback to the first sheet** if that name is absent `[VERIFIED]` `FASTrackerSync.js:25, 93`.

| Col | # | Content written | Source field | Sensitivity |
|---|---|---|---|---|
| A | 1 | LETS Request ID | `request.requestId` | — |
| B | 2 | Timestamp, `MM/dd/yyyy HH:mm:ss` America/New_York | `new Date()` | — |
| C | 3 | Requester name | `submitterName` | **PII** |
| D | 4 | Portfolio / owning office | `owningOffice` | — |
| E | 5 | Purpose of travel | `travelPurposeLabel` | **CUI** |
| F | 6 | Event / trip title | `eventName` | — |
| G | 7 | Destination | `destination` | — |
| H | 8 | Start date | `startDate` | — |
| I | 9 | End date | `endDate` | — |
| J | 10 | Estimated cost | `Number(totalEstimatedCost)` | **Financial** |
| K | 11 | Brief written justification | `roleJustification` | **CUI — pre-decisional** |
| L | 12 | Salesforce Event Tracker ID | `eventTrackerId` | — |
| M | 13 | **Official approval status** | literal `'Pending FAS CoS Approval'` on write; **read back** for decisions | — |
| N | 14 | Submitter email | `Session.getActiveUser().getEmail()` | **PII** |

`updateFASTrackerRow` writes only columns **12** and **10**, by hardcoded number `[VERIFIED]` `:205, 208`.

### 3.7.1 Four brittle integration points, ranked

| # | Issue | Why it matters |
|---|---|---|
| **1** | **Substring status matching.** The read is `normalizedStatus.indexOf('approved') !== -1` `[VERIFIED]` `:245` | **`"Not Approved"`, `"Unapproved"`, and `"Pre-approved"` all contain `"approved"`** and would be read as an approval. This is finding **G-023** |
| **2** | **Positional writes into a foreign schema** | If FAS inserts a column, every field lands one position off — **in their system of record**, where it cannot be cleanly retracted |
| **3** | **Fixed read width** — `getRange(2, 1, lastRow-1, 13)` `:233` | Fewer than 13 columns throws; more are silently ignored |
| **4** | **Tab-name fallback** to the first sheet | A renamed tab means writes land somewhere unintended |

> **VT-15 must run before G-023 is fixed.** Open a *copy* of the FAS tracker, confirm the tab name, record columns A–N, and capture **the exact status strings column M actually uses**. Fixing a substring match against guessed strings would be worse than leaving it — a wrong exact-match would reject valid approvals instead of accepting invalid ones.

### 3.7.2 The environment gate protecting it is exemplary

`resolveFASTrackerTarget` `TripConfig.js:86-127` `[VERIFIED]` refuses to run if a non-production project points at the official tracker, treats an unset environment as non-production, fails closed in every direction, cites the NIST controls it implements, and has a dedicated passing test suite.

**It is LETS-original work and the quality bar for the rest of the system.** Worth noting the care went in before the feature did — nothing can currently reach this code (**G-016**).

---

## §3.8 Keys, formats, and vocabularies

### 3.8.1 Primary keys

| Tab | Key | Format | Collision safety |
|---|---|---|---|
| `Requests` | `Request_ID` | `REQ-<year>-<4 digits>` | **None** — see §3.8.2 |
| `Request_Legs` | `Leg_ID` | `leg_<epoch ms>_<index>` | Timestamp + index |
| `Request_Travelers` | `Traveler_ID` | `traveler_<epoch ms>_<index>` | Timestamp + index |
| `Traveler_Leg_Costs` | composite | (`Request_ID`, `Traveler_ID`, `Leg_ID`) | n/a |
| `Approval_Log` | `Log_ID` | `LOG-<6 digits>` **or** a UUID | **Two vocabularies** (§3.4.4) |
| `Attachments` | `Attachment_ID` | `att_<epoch ms>_<6 random>` | Random suffix — safe |
| `Travel_Users` | `User_ID` | HC `employee_id`, else `ext_<token>` | Admin-enforced |
| `Travel_User_Roles` | `Role_ID` | `role_<12 hex>` — digest of (`User_ID`, `Role_Type`, `Scope`) | **Deterministic — idempotent by design** |
| `Feedback` | `Feedback_ID` | `fb_<epoch ms>_<6 random>` | Random suffix — safe |
| `Error_Log` | *(none)* | — | append-only |

**`Role_ID` is the best-designed key in the system.** Because it is a digest of the role's own content, re-granting the same role produces the same ID — so the operation is naturally idempotent and cannot create duplicate grants.

### 3.8.2 `Request_ID` can collide, and the consequence compounds

**Three generators take no lock** `[VERIFIED]`: `generateRequestId`, `generateLogId`, and `_generateBootstrapRoleId`.

`generateRequestId()` reads column A of `Requests`, finds the highest `REQ-<year>-NNNN`, and returns max + 1 `[VERIFIED]` `Database.js:493`. **Two submissions in the same moment both read the same maximum and both return the same ID.** This is finding **G-012**.

**`LockService` is used elsewhere in this codebase** `[VERIFIED]` — so the mechanism is available and understood. It is simply not applied here.

**Two consequences compound it:**

1. **A duplicate `Request_ID` makes request lookup match the first row only.** Several lookups test `rows[i][0] === requestId` `[VERIFIED]`. Approving one request would operate on another's row. **Nothing detects it.**
2. **`submitTravelRequestV2` writes to five tabs with no transaction** `[VERIFIED]`. A failure partway through leaves a request with legs but no travellers, or travellers but no costs. There is no rollback and no repair tool.

**VT-16 and VT-17 test whether either has already happened** — a `COUNTIF` for duplicate IDs, and a `MATCH` across the child tabs for orphan rows. Both are five to fifteen minutes and both are direct tests for real corruption.

### 3.8.3 Column A is load-bearing in ten places

Beyond the positional writes, **ten code sites assume a specific column is column A** `[VERIFIED]`:

| Assumption | Where | Failure if violated |
|---|---|---|
| `Requests.Request_ID` is column A | `Review_Action.js:64, 475, 593`; `Review_Read.js:81` | Request lookup silently finds nothing → *"Request not found"* |
| `Requests.Request_ID` is column A | `Database.js:505` — the ID generator reads `getRange(2, 1, ...)` | **ID sequence resets to 1 → duplicate primary keys** |
| `Approval_Log.Log_ID` is column A | `Database.js:530` | Same — log ID sequence resets |
| `Feedback.Feedback_ID` is column A | `Feedback.js:272` — `row[0]` as the "has an ID" test | Rows silently filtered out |

**Moving `Request_ID` out of column A would reset the ID sequence** and start generating IDs that already exist. That is the worst single-change outcome available in this database.

### 3.8.4 Request status — the live vocabulary

`[VERIFIED]` `01_constants/Status.js` — 15 values:

`DRAFT`, `PENDING_SECTOR`, `PENDING_BU`, `PENDING_OSO`, `PENDING_FAS`, `Pending_DD_Confirmation`, `Pending_Correction`, `NEEDS_INFO_SECTOR`, `NEEDS_INFO_BU`, `NEEDS_INFO_OSO`, `APPROVED_GOGOV`, `COMPLETED`, `DENIED`, `CANCELLED`, `SUBMITTER_CANCELLED`

**Two break the casing convention on purpose.** `Pending_DD_Confirmation` and `Pending_Correction` are TitleCase while the rest are ALL_CAPS. **The code documents why** — a pre-existing inconsistency deliberately preserved rather than migrated `[VERIFIED]`. Do not "fix" these: live rows carry the TitleCase values.

**`DRAFT` is vestigial** — never written by any code path `[VERIFIED]`. Drafts live only in browser storage. Finding **G-060**.

> **`COMPLETED` does not mean the trip happened.** It means every Division Director confirmed funding, which occurs *before* travel `[VERIFIED]`. Finding **G-019**. Any report that treats `COMPLETED` as "travel finished and paid" is wrong.

### 3.8.5 Role types

`[VERIFIED]` `Users.js:20-27` — the only six values valid in `Travel_User_Roles.Role_Type`:

`admin`, `aas_fo_reviewer`, `fas_fo_reviewer`, `bu_reviewer`, `sector_override`, `approved_user`

`Scope` is required for `bu_reviewer` and `sector_override` `[VERIFIED]`.

### 3.8.6 Other enumerated values

| Field | Valid values | Source |
|---|---|---|
| Action types | 22 values, mostly TitleCase, with three deliberate ALL_CAPS exceptions (`ADMIN_REASSIGN`, `ADMIN_OVERRIDE`, `ALL_DD_CONFIRMED`) | `Status.js` `[VERIFIED]` |
| `Location_Type` | `conference`, `client-site`, `contractor-site`, `teb`, `other` | `Locations.js` `[VERIFIED]` |
| `Transport_Mode` | `private`, `gov` | `Costs.js` `[VERIFIED]` |
| OCONUS states | `AK`, `HI`, `PR`, `VI`, `GU`, `AS`, `MP` | `Locations.js` `[VERIFIED]` |
| `Is_Client_Paid` | `overhead` (default) and client-paid variants. **Blank counts as overhead** | `Submission.js` `[VERIFIED]` |
| LETS status (unused) | 12 prose values including `'Submitted - Pending Budget Check'`, `'Flagged - Insufficient Funds'` | `BudgetConfig.js` `[VERIFIED]` |

**One name collides across vocabularies.** `'Edit_SharedCosts'` is written as a literal into `Approval_Log.Action` but is **absent from the `ACTION_TYPES` list** `[VERIFIED]` — finding **G-059**. Anything validating actions against that list would reject a value the system itself writes.

---

## §3.9 Why you must never reorder a column

**This is the single most important operational rule in this document.** It is also in Administrator's Guide §1.6.5; it is repeated here with the measurement behind it.

### 3.9.1 The code reads flexibly and writes rigidly

| Access mode | Count |
|---|---|
| **Reads by header name** — `row[headerIndex['Status']]` | **538 usages across 20 files** `[VERIFIED]` |
| **Writes by position** — a literal array appended in column order | **22 sites** `[VERIFIED]` |

Reading by header name is safe: move a column and the index map moves with it. **Writing by position is not.** The writer builds an array of *n* values and the *n*th value lands in the *n*th column, whatever that column now holds.

### 3.9.2 What the alignment test proves, and what it does not

Every positional write was measured against its schema `[VERIFIED]`:

| Result | Count |
|---|---|
| Exactly match the schema width | 15 |
| Trailing omission — safe; leaves later columns blank | 5 |
| Partial-range writes to specific columns | 0 |
| **Over-wide — would write past the schema** | **0** |

**No writer exceeds its schema.** The declarations in `Sheets.js` are an accurate description of what the code writes today.

> **That is exactly why reordering is dangerous.** The agreement between writer and schema is **positional**, verified nowhere at run time. It holds because the two lists currently happen to match. Insert a column and they still "match" in length while meaning entirely different things — and **nothing raises an error.**

### 3.9.3 The failure mode, in operational terms

| | |
|---|---|
| What happens | Every write **after** the change puts values in the wrong columns |
| What happens to existing rows | **Nothing.** They stay correct |
| What the user sees | Nothing. No error, no warning, no log entry |
| What you end up with | A tab where older rows are right and newer rows are wrong, with no marker between them |
| How you would notice | A reviewer seeing nonsense on a request — days or weeks later |
| How you would fix it | By hand, row by row, after establishing when the change happened |

### 3.9.4 The rules

1. **Never insert a column** except at the far right of a tab.
2. **Never reorder columns.**
3. **Never delete a column**, even one that looks unused. `Set_Asides.Active` and `Test_Submitters.Suppress_Emails` both look dead and are not.
4. **Never move `Request_ID` out of column A** (§3.8.3) — it resets the ID generator.
5. **Never rename a column.** Reads resolve by exact header text; a rename makes 538 lookups return `undefined`.
6. **Adding at the far right is safe** — but update the schema in `Sheets.js` in the same change, or the next `setupTravelDatabase()` run will not know about it.
7. **Run VT-08 before and after any schema change** — read row 1 of the seven core tabs and confirm the order is unchanged.

**One wrinkle to expect:** the application itself adds three columns to `Requests` at runtime (§3.2.4). So a live tab wider than the schema is not necessarily evidence of tampering.

---

## §3.10 Data freshness — why an edit may not take effect

Three cache layers sit between the spreadsheet and what a user sees `[VERIFIED]`.

| Cache | Key | Lifetime | Cleared by |
|---|---|---|---|
| Per-execution, in memory | `TravelDB._data[sheet]` | one execution | n/a |
| Joined role lookup | `unified_roles_v1` | **300 s** `Access.js:288` | role writers, `bootstrapTravelAdmin` |
| Raw sheet contents | `tdb_<SheetName>` (chunked at ~90 KB) | **600 s** `TravelDB.js:39` | every `appendRow` / `updateRowByIndex` / `deleteRowByIndex` |
| Review envelope | `request_review_v2_<id>` | per config | — |
| Per-diem data | `dod_perdiem_all_data`, `foreign_perdiem_all_data`, versioned lists | 1 h – 24 h | version-suffixed keys |
| Feedback rate-limit | `feedback_rate_<email>` | 60 s | — |

**Writes through the application invalidate correctly.** All eight role-mutating functions clear the caches, and every `TravelDB` write invalidates the affected sheet and re-reads it `[VERIFIED]`. This part of the system works well.

> **The exposure is edits made outside the application.** A change typed directly into a tab clears nothing. The application may keep serving the old value for **up to ten minutes** — and a warming trigger re-reads the sheets every five minutes, so **a concurrent application write can re-save stale data over your edit.**
>
> If you must edit a sheet directly: allow ten minutes, or have an admin run `_bustRoutingCachesForTesting()` `Submission.js:1051` to clear the caches immediately.

**One cache behaviour is worth praising.** The review envelope caches request *data* but **recomputes permission flags per user on every cache hit** `[VERIFIED]` `Review_Read.js:48-67`. Cached data never carries another user's permissions — a subtle thing to get right, and it was got right.

---

## §3.11 What this dictionary cannot know

Every item here is a verification task. None is left vague.

| Unknown | Why it matters | Resolves with |
|---|---|---|
| **The live `Requests` header row** | Two schemas claim the tab; the code adds three columns at runtime. This is the single biggest gap | **VT-06** — 2 min |
| **Which tabs actually exist** | Six of sixteen are never created by setup; seven Layer B tabs may or may not have been created | **VT-07** — 5 min |
| **Whether column order still matches** | §3.9's whole argument assumes it does. This is the only test for silent ongoing corruption | **VT-08** — 10 min |
| **Whether a `Feedback` tab exists, and its headers** | §3.5.2's 13-column list is `[INFERRED]`. A live tab would supersede it | **VT-15** |
| **Whether duplicate `Request_ID`s already exist** | A direct test for whether **G-012** has already occurred | **VT-16** — 5 min |
| **Whether orphan child rows exist** | A direct test for past partial-submission failures | **VT-17** — 15 min |
| **The live `Is_Active` raw values** | **G-032** means `no`, `0`, or blank read as active. Someone may believe they revoked access | **VT-27** — 5 min |
| **Whether any validation, named ranges, or protections exist** | Code creates none. Anything found is an undocumented control | **VT-25** — 10 min |
| **The real FAS tracker layout and status strings** | §3.7 is entirely inferred. **G-023** cannot be fixed safely without this | **VT-15** — 15 min |
| **Whether the prototype sheet's `LETS_SYSTEM_*` schema is recoverable** | The brief's "Stage 1 schema" exists nowhere in the repository (**G-047**) | **VT-22** — 15 min |

**Five of these ten take fifteen minutes or less, and VT-06 plus VT-07 together take seven minutes and resolve the two biggest gaps.**

---

## §3.12 Where to go next

| You want | Read |
|---|---|
| How to administer the system and who controls it | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) |
| Which file reads or writes which tab | [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) — §2.5 covers the two data layers |
| What the statuses mean as a workflow | `WORKFLOW_AND_BUSINESS_RULES.md` (Deliverable 4) |
| The ranked findings with evidence | `GAP_REGISTER.md` (Deliverable 6) |
| How to change a schema safely | `ENHANCEMENT_PLAYBOOK.md` (Deliverable 7) — §3.9 is its starting point |
| The verification tasks in order | `HUMAN_VERIFICATION_CHECKLIST.md` (Deliverable 10) |

### Reproducing this document's figures

```sh
cd docs/evidence
node pass6_schema_census.js            # every schema, the alignment test, the key generators
node pass3_D7_sheet_shape_mismatch.js  # demonstrates §3.6.3 by execution
```

`pass6_schema_census.js` prints the exact column count of every declared schema, measures each positional write against the schema it targets with a balanced-paren scanner, and reports any disagreement with Pass 3's prose. It currently reports **zero** disagreements.

---

*End of Deliverable 3. Every column listed here is marked `[VERIFIED]` where it is read from a schema declaration and `[INFERRED]` where it is reconstructed from a writer's order — and §3.11 lists, without exception, everything a human with spreadsheet access would need to check to make this document authoritative rather than merely accurate about the code.*
