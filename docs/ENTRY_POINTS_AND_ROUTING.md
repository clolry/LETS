# LETS Entry Points and Routing — Pass 2

| Field | Value |
|---|---|
| **Title** | LETS Entry Points and Routing (Pass 2) |
| **Purpose** | Map every way a human or machine can enter the system, what each entry point does, and what privilege it requires. Establishes the attack surface and the reachability baseline that every later document depends on. |
| **Date generated** | 2026-10-27 |
| **Audience** | Project manager (non-programmer) first; developer second. Plain language leads each section, with file:line citations for hand-off. |
| **Prerequisite reading** | [FILE_MANIFEST.md](./FILE_MANIFEST.md) — especially Findings M-1 through M-5. |

## Confidence summary

| Evidence class | Share | What it covers |
|---|---|---|
| `[VERIFIED]` | ~80% | All routing logic, all 63 client-callable function bindings, all guard placements, all template resolutions, and all trigger installers were read directly in code. Function-level guard analysis was done by parsing every function body programmatically, not by sampling. |
| `[INFERRED]` | ~8% | Apps Script platform behavior that is documented by Google but not observable in these files: the trailing-underscore privacy convention, `include()` filename resolution, and how a deployment's "Execute as" setting interacts with `Session.getActiveUser()`. |
| `[CLAIMED]` | ~2% | Items the handoff documentation asserts about entry points that code contradicts. Each is named explicitly. |
| `[UNKNOWN]` | ~10% | **Live state I cannot see from files:** which triggers actually exist in each project, who created them, the deployed web app URL, the active deployment's "Execute as" and "Who has access" settings, and whether the manifest's declared values match the deployment's actual values. All routed to the verification checklist. |

---

## 2.0 How to read this document

LETS is a **Google Apps Script web app**. That platform has a small, fixed set of doors:

| Door | Plain-language meaning |
|---|---|
| **Web app URL** | A single web address. Everything a normal user does happens here. Which screen you get is decided by a `?mode=` value on the end of the address. |
| **`google.script.run`** | When you click something on a screen, the browser calls a named function on the server. **Any** function the server defines can be called this way — not only the ones the screens actually use. This is the single most important security fact in this document. |
| **Triggers** | Scheduled jobs. They run on a timer with no human present, using the Google identity of whoever created them. |
| **Apps Script editor** | The developer console. Anyone with editor access can run **any** function by hand, with no permission checks whatsoever. |
| **The spreadsheet itself** | The database is a Google Sheet. Anyone with edit access to that Sheet can change any value without going through the application at all. |
| **GitHub** | Source of truth for code. A merge to `main` deploys to production automatically. |

A reader securing this system must control **all six**. Controlling the web app alone is not control of the system.

---

## 2.1 The web app front door

### 2.1.1 How a request is routed

Every page load enters at one function. `[VERIFIED]` `lets_app/server/90_entrypoint/doGet.js:28`

```
Browser requests  <web app URL>?mode=XXXX
        ↓
doGet(e)                                      doGet.js:28
        ↓
  read ?mode= (defaults to 'travel')          doGet.js:29
  read caller's email via Session             doGet.js:31
        ↓
  [special case] mode=access-blocked&preview=1 AND isTravelAdmin → show blocker page
                                              doGet.js:35-37
        ↓
  SITE GATE: canAccessTrip(email)             doGet.js:41
        ↓ false → access-blocked page (dead end)
        ↓ true
  switch on mode → one of 7 page builders     doGet.js:45-61
```

Two things to understand about this gate:

1. **It is the only gate most pages get.** Of the seven reachable modes, only `admin` and `reviewer-dashboard` apply a second, role-specific check. The other five let through anyone who passes the site gate. `[VERIFIED]` — see the table in 2.1.2.
2. **A blocked user is not blocked from the server.** The site gate controls which *page* renders. It does **not** restrict which server functions the browser may call. A user who is shown the access-blocked page can still invoke server functions directly. See 2.2.3.

### 2.1.2 Every `?mode=` value — the complete routing table

`[VERIFIED]` by resolving each mode through `doGet.js` → `Render.js` → the template file on disk.

| `?mode=` | Page builder (file:line) | Template file requested | Resolves on disk? | Gate beyond the site gate | What the user can see and do |
|---|---|---|---|---|---|
| *(omitted)* or `travel` | `serveTravelPortal` `Render.js:127` | `client/pages/travelPortalPage` | Yes | **None** | The personal portal: own requests, own drafts, requests awaiting their review. Default landing page. |
| `form` | `serveTravelRequestForm` `Render.js:55` | `client/pages/travelRequestPage` | Yes | **None** | The 6-step new-request intake form. Can create travel requests. |
| `review` | `serveTravelReviewPage` `Render.js:154` | `client/pages/travelReviewPage` | Yes | **None at page level** | The review screen for one request (`?requestId=`). Page renders for anyone past the site gate; whether the *buttons* work is decided per-action on the server. |
| `dd-confirm` | `serveDDConfirmPage` `Render.js:184` | `client/pages/ddConfirmPage` | Yes | **None at page level** | Division Director funding-confirmation screen for one request. |
| `admin` | `serveTravelAdminPage` `Render.js:212` | `client/pages/travelAdminPage` | Yes | **`isTravelAdmin(email)`** `Render.js:216` → blocker page if false | Full admin console: all requests, user/role administration, reports, bulk delete. |
| `reviewer-dashboard` | `serveReviewerDashboardPage` `Render.js:251` | `client/pages/travelReviewerDashboardPage` | **NO — BROKEN** | `getReviewerContext` → admins redirected to `?mode=admin`; non-reviewers get blocker page `Render.js:278-294` | **Throws.** See Finding R-1. |
| `budget` | `serveTravelBudgetDashboardPage` `Render.js:379` | `client/pages/travelBudgetDashboardPage` | Yes | **None** | The LETS budget dashboard. Renders, but every number on it is hardcoded. See Finding R-2. |
| `access-blocked` | `serveAccessRestrictedPage` `Render.js:26` | `client/pages/travelAccessBlockedPage` | Yes | n/a (this *is* the denial page) | "You don't have access" card. Admins can preview it with `&preview=1`. |
| **anything else** | falls through `default:` → `serveTravelPortal` `doGet.js:58-60` | `client/pages/travelPortalPage` | Yes | None | An unrecognized mode silently serves the portal. No error. |

### Finding R-1 — `?mode=reviewer-dashboard` is broken by a filename

`Render.js:297` requests the template `client/pages/travelReviewerDashboardPage`. Apps Script resolves that name to a file called `travelReviewerDashboardPage.html`. The file on disk is named **`travelReviewerDashboardPage.html.html`** — a doubled extension. `[VERIFIED]`

The reviewer dashboard therefore throws for every non-admin reviewer who reaches it. Admins never see the failure, because `Render.js:278` redirects them to `?mode=admin` before the template line is reached. **The people who hit this error are exactly the people least likely to have the access needed to report it usefully.**

Two more doubled-extension files cause the same class of failure in `include()` directives:

| Reference | Requested name | File actually on disk | Effect |
|---|---|---|---|
| `travelAdminPage.html:910` | `client/controllers/admin/travelUsersController` | `travelUsersController.html.html` | Admin console's **Users tab has no controller** — user/role administration UI is inert |
| `travelRequestPage.html:803`, `travelReviewPage.html:964` | `client/components/flatpickrConfig` | `flatpickrConfig.html.html` | Date-picker global config missing on the intake form and review page |
| `travelAdminPage.html:30` | `client/styles/travelUsersStyles` | **no such file under any name** (nearest: `travelUserStyles.html`, singular) | Users tab unstyled |

**Speculation on cause, for the developer who fixes this.** `[INFERRED]` All three doubled-extension files are byte-identical to their counterparts in `reference_travel_app/`, and the same four broken references exist there too. This is not damage introduced by LETS — it is inherited. The pattern (`X.html` → `X.html.html`) is the signature of a `clasp pull` from a project where the Apps Script file was itself named `X.html`, causing clasp to append its own `.html`. The fix is a rename, not a code change:

```
git mv lets_app/client/components/flatpickrConfig.html.html            lets_app/client/components/flatpickrConfig.html
git mv lets_app/client/controllers/admin/travelUsersController.html.html lets_app/client/controllers/admin/travelUsersController.html
git mv lets_app/client/pages/travelReviewerDashboardPage.html.html     lets_app/client/pages/travelReviewerDashboardPage.html
```
The fourth (`travelUsersStyles`) is a genuine typo in `travelAdminPage.html:30` and should become `travelUserStyles`. **Caution:** confirm against the live Apps Script project first. If the deployed project already holds correctly-named files, the doubled extensions exist only in this git checkout, and renaming here plus a `clasp push` would be correct — but the reverse (live project also broken) means the reviewer dashboard has never worked in production. That distinction is a verification task, not something files can answer. `[UNKNOWN]`

### Finding R-2 — `?mode=budget` is a non-functional mockup

The page renders and is reachable by **any** user who passes the site gate — no admin check. `[VERIFIED]` `Render.js:379-392` contains no role test. But:

- Every figure on it is a hardcoded HTML literal. 30 distinct dollar amounts (`$997,000`, `$136,940`, `$633,720`, `$113,840`, `$108,500`, …) are typed into the markup. `[VERIFIED]` `travelBudgetDashboardPage.html`
- The only dynamic value on the entire page is the viewer's own name (`<?= userName ?>` at line 88). There are **zero** `google.script.run` calls. `[VERIFIED]`
- The "Sync FAS Tracker Sheet" button's complete implementation is:
  ```javascript
  function syncFASTrackerNow() {
    alert('Scanning FAS Travel Exception Tracker Google Sheet... Sync complete.');
  }
  ```
  `[VERIFIED]` `travelBudgetDashboardPage.html:313-317`. It contacts nothing and syncs nothing. It reports success unconditionally.
- "Log Budget Adjustment" opens a Bootstrap modal (`data-bs-target="#modalBudgetAdjustment"`) that saves nowhere.

**This page will mislead an executive.** It presents itself as live financial governance ("Active discretionary balance tracking across DACs") and will display the same figures regardless of actual spend. It is not linked from any navigation anywhere in the app — reachable only by typing the URL `[VERIFIED]` — which is the one thing currently limiting the damage.

**Speculation on intent, for scoping the fix.** `[INFERRED]` The hardcoded figures match `BudgetEngine`'s computed outputs exactly: I ran the Node test suite and it produces OMD `$136,940`, IDV `$633,720`, CM `$113,840`, baseline `$997,000`, set-asides `$108,500` — the identical numbers typed into the page. So this is a faithful visual prototype of a working engine, built before the two were connected. Wiring it is a bounded job: add a `getBudgetDashboardData()` server function that assembles `state` (see Finding R-5) and calls `BudgetEngine.generatePortfolioSummary(state)`, then replace each literal with a DOM write. The arithmetic already works and is covered by tests.

### 2.1.3 How each page is actually reached by a real user

Knowing a mode exists is not the same as knowing a user can find it. `[VERIFIED]` by searching all client code for `mode=` strings and navigation calls.

| Mode | Discoverable in the UI? | How |
|---|---|---|
| `travel` | Yes | Default landing page; "Return to Portal" links on every page |
| `form` | Yes | "New Travel Request" buttons (3 locations) |
| `review` | Yes | Portal row clicks → `navigateTo('review', {requestId, viewMode})` `travelPortalController.html:1353,1360,1367`; also deep-linked from notification emails `Email.js` |
| `dd-confirm` | Yes | Portal → `navigateTo('dd-confirm', {requestId})` `travelPortalController.html:943`; also emailed to Division Directors |
| `admin` | Yes, **conditionally** | An `#adminLink` element is hidden by default and un-hidden only after `checkTravelAdminAccess()` returns `isAdmin: true` `travelPortalController.html:409-423` |
| `reviewer-dashboard` | Yes, **conditionally** | A `#reviewerDashboardLink` un-hidden only when `isReviewer && !isAdmin` `travelPortalController.html:432-441` |
| `budget` | **No** | Zero links anywhere in the codebase. URL-only. |

**Important nuance for the reader.** The admin and reviewer links being *hidden* is cosmetic. Hiding a link in a browser does not prevent anyone from typing `?mode=admin`. The real protection for `?mode=admin` is the server-side `isTravelAdmin` check at `Render.js:216`, which is sound. The hidden link is convenience, not security — and the same is **not** true for `?mode=budget`, which has no server-side check at all and relies purely on nobody knowing the URL. That is security by obscurity and should be treated as unprotected.

### 2.1.4 The site-level access gate — who gets in at all

`canAccessTrip(email)` `[VERIFIED]` `lets_app/server/30_services/Access.js:394-436`. Returns true if **any** of three conditions hold:

| # | Condition | Source of truth | Code |
|---|---|---|---|
| 1 | Caller holds **any** active role row | `Travel_User_Roles` tab (joined to `Travel_Users`) | `Access.js:399-404` |
| 2 | Caller occupies a **filled supervisor position** | HC staffing library — `supervisoryStatus === '2'` and occupancy not `VACANT`/`OBLIGATED` | `Access.js:408-421` |
| 3 | Caller's HC **office title** marks them a BU-level lead (Client Executive / Chief of Staff and deputies) in a filled seat | HC staffing library, via `_isBuLeadByTitle` | `Access.js:429-433` |

Everyone else sees the access-blocked page.

**Operational consequence the reader must internalise:** conditions 2 and 3 mean **access is granted by an external HR data source, not by anything in this application.** A person can gain or lose access to LETS because their HC record changed — a promotion, a reorg, a vacancy posting — with no action by any LETS administrator and no audit entry in LETS. Conversely, the role table (condition 1) is the only lever an administrator directly controls. `[VERIFIED]` from the code; the *contents* of the HC bundle are `[UNKNOWN]`.

**The HC dependency is undeclared.** Every one of these calls goes through a bare global `HC` (e.g. `HC.hcGetBundle()`, 18 call sites `[VERIFIED]`). That identifier is an Apps Script **library binding** — but `lets_app/appsscript.json` declares **no `libraries` array at all**. `[VERIFIED]` It declares only two advanced services (Drive v3, Gmail v1).

This matters enormously: library bindings live in the Apps Script project's own settings, **not** in the pushed manifest. So the HC library attachment exists (if it exists) only as live project configuration that `clasp push` neither sets nor preserves. A newly created LETS project from this repository would have **no HC library**, every `HC.*` call would throw `ReferenceError: HC is not defined`, and because those calls are wrapped in `try/catch` that merely `console.warn`s `[VERIFIED]` `Access.js:402-404,422-424,431-433`, the failure is **silent**: `canAccessTrip` would simply return `false` for everyone not in the role table. The app would appear to work while locking out every supervisor. This is a disaster-recovery landmine and is recorded as a gap and a verification task.

---

## 2.2 `google.script.run` — the real attack surface

This is the section that matters most for security, and it is the least intuitive. Read it carefully.

### 2.2.1 What the screens actually use

The browser calls server functions by name. I parsed every client file (handling chained `withSuccessHandler`/`withFailureHandler` wrappers and the `serverCall()` promise helper at `client/shared/serverCall.html:33`) and resolved each name against every server definition.

**63 distinct server functions are invoked by the screens.** `[VERIFIED]` Of those, **60 resolve** to a top-level server function and **3 do not exist**:

| Called function | Called from | Server reality | Effect |
|---|---|---|---|
| `apiGetInitialData` | `client/pages/letsAppLayout.html:102` | **No definition anywhere** | The entire LETS single-page UI cannot load data |
| `apiSubmitRequest` | `client/pages/letsRequestPage.html:274` | **No definition anywhere** | The LETS intake form cannot submit |
| `getAllForeignCountries` | `client/shared/travelLocationService.html:82` | **No definition.** Server defines `getForeignCountries` `PerDiemForeign.js:229` — different name | Foreign-country dropdown silently resolves to `[]` |

The third is an inherited TRIP defect: `reference_travel_app` has the identical mismatch. `[VERIFIED]` Its failure handler resolves to an empty array rather than surfacing an error `travelLocationService.html:76-80`, so the dropdown just appears empty — a user would report "no countries listed," not "a function is missing." The fix is a one-word rename at the call site.

The first two are LETS-specific and are the missing half of Finding R-5.

### 2.2.2 Every function the screens use, and whether it checks permissions

**Path convention for this section:** file paths are relative to `lets_app/server/`. Note that two different files are named `Costs.js` (`01_constants/Costs.js` and `30_services/Costs.js`); layer prefixes are given where ambiguous.

`[VERIFIED]` — each function body parsed for the presence of a guard. "Role guard" = `requireTravelAdmin` / `requireRole` / `isTravelAdmin` / `getReviewerContext`. "Record-level" = compares caller's email to a field on the specific record (`Submitter_Email`, `Current_Reviewer_Email`, `DD_Email`).

**Admin-gated (29 functions)** — call `requireTravelAdmin()`, which throws `'Admin access required'` for non-admins. These are sound.

> **Scope note added after Pass 5.** This 29 counts only functions **the screens actually invoke**. Measured across all 412 browser-reachable functions, the total behind a throwing admin guard is **31** — the extra two-plus are admin-gated functions no screen calls (`verifyAccessGate`, `diagnoseTripAccess`, `reportGenerateData`, `reportExportToCSV`, `getTravelUserDetail`, `addRoleToUser`, and the four routing simulators). Both figures are correct for their population; **31 of 412** is the project-wide figure. See [`SECURITY_AND_ACCESS_PASS5.md`](./SECURITY_AND_ACCESS_PASS5.md) §5.2.3 and `evidence/pass5_guard_census.js` section [2].

| Function | Location |
|---|---|
| `getAdminDashboard` | `Admin_Dashboard.js:332` |
| `getAllTravelRequests` | `Admin_Dashboard.js:1014` |
| `getRequestSummary` | `Admin_Dashboard.js:1079` |
| `adminOverrideStatus` | `Admin_Actions.js:34` |
| `adminReassignReviewer` | `Admin_Actions.js:102` |
| `getDeletePreview` | `Admin_Cleanup.js:37` |
| `deleteTravelRequests` | `Admin_Cleanup.js:128` |
| `listTravelUsers` | `Users.js:44` |
| `addTravelUser` | `Users.js:194` |
| `updateTravelUser` | `Users.js:423` |
| `setRoleActive` | `Users.js:890` |
| `setRolePrimary` | `Users.js:1041` |
| `deleteRole` | `Users.js:1172` |
| `reportGetFilterOptions` | `Reporting.js:26` |
| `reportExportToSheets` | `Reporting.js:117` |
| `reportBuilderPreview` | `Reporting.js:1100` |
| `reportBuilderExport` | `Reporting.js:1124` |
| `reportBuilderSavePreset` | `Reporting.js:1185` |
| `reportBuilderGetPresets` | `Reporting.js:1219` |
| `reportBuilderDeletePreset` | `Reporting.js:1235` |
| `getRecentFeedback` | `Feedback.js:256` |
| *(plus 8 more `requireTravelAdmin()` call sites inside `Submission.js` diagnostics and `Users.js` helpers)* | |

**Role-context-gated (4)** — resolve the caller's role and scope, then filter results to that scope:

| Function | Location | Behavior |
|---|---|---|
| `checkTravelAdminAccess` | `Access.js:1123` | Returns the caller's own admin flag |
| `checkTravelReviewerAccess` | `Access.js:1102` | Returns the caller's own reviewer flag |
| `getReviewerDashboard` | `ReviewerDashboard.js:32` | Scopes data to caller's BU/sector |
| `getReviewerRequestSummary` | `ReviewerDashboard.js:288` | Same |
| `getPortalBootstrap` | `Request.js:565` | Resolves caller context for the portal |

**Record-level only (18)** — no role check; authorization is "is your email on this specific record." Representative examples:

| Function | Location | The check it performs |
|---|---|---|
| `submitReviewAction` | `Review_Action.js:41` | Admins bypass; otherwise caller must equal `Current_Reviewer_Email`, or `Submitter_Email` for `resubmit`/`submitter_cancel` `Review_Action.js:78-91` |
| `updateRequestOverview` | `Review_Update.js:200` | Status must be editable **and** caller must equal `Submitter_Email` `Review_Update.js:278-283` |
| `updateRequestItinerary` | `Review_Update.js:401` | Same pattern |
| `updateRequestClassification` | `Review_Update.js:43` | Same pattern |
| `updateTravelersForReview` | `Review_Update.js:1319` | Same pattern |
| `updateCostsForReview` | `Review_Update.js:1760` | Same pattern |
| `updateSharedCostsForReview` | `Review_Update.js:1597` | Same pattern |
| `getRequestForReview` | `Review_Read.js:29` | **Returns the full record to any caller.** Computes `permissions.isCurrentReviewer`/`isSubmitter` for the UI to use, but does not refuse. See below. |
| `getMyTravelRequests` | `Request.js:629` | Filters rows to caller's own email — correct |
| `confirmDDTravelers` | `Review_DDConfirm.js:290` | Caller must match a traveler's `DD_Email` |
| `getDDConfirmationData` | `Review_DDConfirm.js:223` | Caller identity read |
| `reportDDFundingIssue` | `Review_DDConfirm.js:420` | Caller identity read |
| `submitFundingCorrection` | `Review_DDConfirm.js:702` | Caller identity read |
| `submitTravelRequestV2` | `Submission.js:218` | Caller becomes the submitter |
| `submitTravelFeedback` | `Feedback.js:25` | Caller identity recorded |
| `checkNpsEligibility` | `Feedback.js:109` | Caller identity read |
| `dismissNpsPrompt` | `Feedback.js:199` | Caller identity read |
| `uploadTravelDraftFile` | `Attachments.js:69` | Caller identity read |

**No authorization check of any kind (12 of the 63)** — these return data or act for anyone past the site gate:

| Function | Location | Why it is probably acceptable | Why it may not be |
|---|---|---|---|
| `calculatePerDiem` | `30_services/Costs.js:1043` | Public federal rate lookup | — |
| `getGSACitiesForState` | `PerDiemGSA.js:214` | Public reference data | — |
| `getMileageRatesForClient` | `PerDiemGSA.js:742` | Public rates | — |
| `getDoDLocalities` | `PerDiemDoD.js:209` | Public reference data | — |
| `getAllDoDPerDiemData` | `PerDiemDoD.js:586` | Public reference data | Bulk dump |
| `getForeignLocations` | `PerDiemForeign.js:308` | Public reference data | — |
| `getAllForeignPerDiemData` | `PerDiemForeign.js:702` | Public reference data | Bulk dump |
| `calculateTravelDistance` | `Request.js:211` | Geometry helper | — |
| `getScriptUrl` | `Render.js:342` | Returns own URL | — |
| `getTravelUsersUpdateTimestamp` | `DataSync.js:49` | Cache-coherence timestamp | — |
| `getNFSWorksheetTemplate` | `Request.js:22` | Blank form template from Drive | — |
| **`getHCStaffingBundle`** | `HCStaffing.js:21` | — | **Returns the entire HC staffing roster to any caller.** Names, emails, org codes, position numbers, grades, supervisory status, occupancy. This is the organisation's personnel directory, exposed with no role check. One line: `return HC.hcGetBundle();` |
| **`deleteTravelDraftFile`** | `Attachments.js:159` | — | Deletes a Drive file by ID with no ownership verification visible in the function body |

`getHCStaffingBundle` and `deleteTravelDraftFile` are the two in this group a reviewer should look at. Both are inherited verbatim from TRIP `[VERIFIED]`, so the question is whether TRIP's risk acceptance transfers to LETS — a determination for the ISSO, not for me.

### 2.2.3 The finding that reframes everything above

Apps Script exposes **every top-level function in the project** to `google.script.run`, not only the ones the UI happens to call. The sole exception is the platform convention that a function name ending in an underscore is private. `[INFERRED]` — this is documented Google platform behavior, consistent with the codebase's own use of trailing-underscore helpers (`getDoDPerDiemSheet_`, `shareFileSilent_`), but not something these files prove.

Counting that way:

| Measure | Count |
|---|---|
| Top-level function declarations in `lets_app/server/` | 459 |
| Trailing-underscore (private, not reachable from a browser) | 47 |
| **Reachable from any authenticated browser via `google.script.run`** | **412** |
| Of those, containing no role guard | 365 |
| **Of those, performing a write or privileged action** | **64** |

So the screens use 63 functions, but **412 are callable**. The 349 extra are not hidden; they are simply not linked. Anyone who can load any LETS page can open their browser console and invoke any of them.

The 64 unguarded write-capable functions include these, which deserve the reader's specific attention:

| Function | Location | What an arbitrary authenticated caller could do | Guard present |
|---|---|---|---|
| **`bootstrapTravelAdmin`** | `Database.js:228` | **Grant themselves the `admin` role.** Writes a `Travel_Users` row and a `Travel_User_Roles` row with `Role_Type: 'admin'`, then clears the role cache so it takes effect immediately `Database.js:349-358`. Arguments are optional — called with none it defaults to a hardcoded identity, but the signature is `(email, name, userId)` and accepts any values. | **None** |
| **`backupTravelDb`** | `Database.js:816` | Copy the entire production database — all PII, CUI, and financial data — into their own Drive via `makeCopy()`. The copy is owned by the caller. | **None** |
| **`_bulkDeleteSmokeRequests`** | `Database.js:859` | Cascade-delete request rows across 5 sheets. Defaults to dry-run and caps at 50 rows, but `{dryRun: false, maxRows: N}` overrides both. *(Leading underscore is not privacy — only trailing underscores are.)* | **None** |
| **`setupTravelDatabase`** | `Database.js:44` | Rewrite the header row of all 10 schema-bearing tabs. `createOrUpdateSheet` writes headers unconditionally even when the sheet exists `Database.js:418-420` — on a tab whose columns have drifted, this silently re-labels live data. | **None** |
| **`addUnifiedUserSchema`** | `Database.js:85` | Create/alter the user and role tables | **None** |
| **`createOrUpdateSheet`** | `Database.js:407` | Arbitrary header overwrite on any named sheet | **None** |
| **`initTravelSystemConfig`** | `Database.js:446` | Write Script Properties | **None** |
| **`initEmailConfigDefaults`** | `Props.js:252` | Write Script Properties | **None** |
| `setReportBuilderPresets`, `setTravelLogoBase64`, `setTravelLogoDriveFileId`, `deleteTravelLogoProps`, `setTravelUsersDataUpdated`, `setDoDLastSync`, `setDOSLastSync` | `Props.js:206-240` | Write/delete Script Properties | **None** |
| **`sendTravelEmail`** | `Email.js:142` | Send mail via `GmailApp`/`MailApp` from the application's sending identity, to any recipient, with any body | **None** |
| `setupDoDSyncTrigger`, `removeDoDSyncTrigger`, `setupForeignPerDiemTrigger`, `removeForeignPerDiemTrigger`, `installHCRefreshTrigger`, `installTravelDBWarmingTrigger`, `removeTravelDBWarmingTrigger`, `installGSACitiesWarmingTrigger`, `removeGSACitiesWarmingTrigger` | `PerDiemSync.js`, `CacheWarming.js` | Create or delete scheduled jobs | **None** |
| `_reassignPendingForRoleChange`, `_orphanPendingForRoleChange` | `Users.js:1485,1692` | Rewrite `Current_Reviewer_Email` on pending requests — i.e. redirect approvals | **None** |
| `updateTravelerCosts` | `Review_Update.js:806` | Write cost figures to `Request_Travelers` and totals to `Requests`. Documented `@private @server` and intended to be called only internally, but the name has no trailing underscore, so the platform exposes it. | **None** |
| `getFundingCorrectionData` | `Review_DDConfirm.js:605` | Read any request's DD issue notes and flagged-traveler details | **None** |
| `getSubmitterInfo` | `Database.js:621` | Look up any person's name, org code, and BU by email | identity read only |

**How to characterise this accurately.** Every one of these functions exists to be run by a developer from the Apps Script editor — the codebase marks many of them `@editor` in their JSDoc, which is an honest statement of intent. The problem is that intent is not enforcement: Apps Script makes no distinction between "editor-only" and "client-callable," and the only mechanism that would enforce it (a trailing underscore, or a `requireTravelAdmin()` line) is absent.

I am not asserting this has been exploited, and I am not rendering a compliance judgment. I am stating the verifiable fact that **a privilege-escalation path exists from "any user who can load a LETS page" to "application administrator," via `bootstrapTravelAdmin`**, and that the surrounding 63 unguarded write functions have comparable reach. Given the FIPS Moderate / PII / CUI / financial classification recorded in `PROJECT_PLAN.md:60-71`, this belongs in front of an ISSO.

**One mitigating factor, and its limit.** `lets_app/appsscript.json:21` declares `"access": "DOMAIN"` `[VERIFIED]`, so the caller must hold a Google Workspace account in the deploying domain. That bounds the population to insiders rather than the public internet. It does not bound it to LETS users, to supervisors, or to administrators. Also note: the *deployment's* access setting can differ from the manifest's, and the deployment is authoritative. Confirming the live setting is a verification task. `[UNKNOWN]`

**Cheapest durable fix, for scoping.** `[INFERRED]` Two mechanical changes, both low-risk:
1. Rename every `@editor`-intended function to end in `_` (e.g. `bootstrapTravelAdmin_`). The platform then refuses browser calls outright. Breaks nothing, because nothing calls them from the client — but **triggers reference their handlers by string name**, so handler functions themselves (`syncDoDPerDiem`, `warmTravelDBCache`, `refreshHCStaffingCache`, `warmGSACitiesCache`, `syncForeignPerDiem`) must **not** be renamed without reinstalling the triggers. `PerDiemSync.js:6-7` warns about exactly this.
2. Add `requireTravelAdmin();` as the first line of every write-capable function that remains client-reachable. The guard already exists and is used correctly in 29 places; this is extending an established pattern, not inventing one.

---

## 2.3 Triggers — the unattended entry points

A trigger is a scheduled job. It matters disproportionately for two reasons a non-programmer would not guess:

1. **A trigger runs as the person who created it**, using that person's Google permissions — not as the application and not as the user whose data it touches.
2. **Triggers are invisible to other editors.** The Apps Script editor's trigger list shows *only your own* triggers. Another editor's triggers are running, consuming quota, and writing data, and you cannot see them.

Taken together: if a departed developer created the triggers, those jobs will keep running until their Google account is suspended, at which point they **stop silently** — no error, no notification, no visible change except data quietly going stale.

### 2.3.1 Triggers the code can install

There are no simple triggers in this codebase — **no `onOpen`, no `onEdit`, no `onFormSubmit`, no `doPost`, no `onInstall`.** `[VERIFIED]` by exhaustive search. Consequence: **the bound spreadsheet has no custom menu.** Documentation implying a Sheets-menu entry point is wrong; there is none.

All triggers are installable and time-driven, created by running an installer function by hand. `[VERIFIED]`

| Handler function | Schedule | Installer (file:line) | Remover | What it does | What breaks if absent |
|---|---|---|---|---|---|
| `refreshHCStaffingCache` | every 10 min | `installHCRefreshTrigger` `CacheWarming.js:73` | *(none)* | Rebuilds the HC staffing cache via `HC.hcRefreshBundleCache()` | Access decisions and submitter lookups fall back to slow paths or fail; supervisors may lose access |
| `warmTravelDBCache` | every 5 min | `installTravelDBWarmingTrigger` `CacheWarming.js:106` | `removeTravelDBWarmingTrigger` `:137` | Pre-reads 7 hot sheets into CacheService | Portal and dashboards get slow (seconds, not ms); no data loss |
| `warmGSACitiesCache` | every 6 hours | `installGSACitiesWarmingTrigger` `CacheWarming.js:192` | `removeGSACitiesWarmingTrigger` `:206` | Caches GSA per-diem city lists | City autocomplete degrades |
| `syncDoDPerDiem` | daily, 06:00 | `setupDoDSyncTrigger` `PerDiemSync.js:21` | `removeDoDSyncTrigger` `:44` | Pulls DoD OCONUS rates from the Federal Register API into `DoD_Per_Diem` | OCONUS per-diem rates silently go stale; cost estimates drift from policy |
| `syncForeignPerDiem` | monthly, 2nd at 06:00 | `setupForeignPerDiemTrigger` `PerDiemSync.js:70` | `removeForeignPerDiemTrigger` `:94` | Downloads State Dept `.xls` into `Foreign_Per_Diem` | Foreign per-diem rates silently go stale |

**No trigger exists for the FAS tracker poller.** `PROJECT_PLAN.md:160` and the handoff documentation §7.2 both instruct the reader to "add an installable time-driven trigger calling `FASTrackerSync.syncFASTrackerStatus()` every 15 minutes." There is **no installer function for it** `[NOT FOUND]` — unlike the five above, which all have one. And installing it by hand would not help: `syncFASTrackerStatus` reads the tracker and returns a list of changed rows, but **writes nothing back to LETS** `[VERIFIED]` `FASTrackerSync.js:225-258`. See 2.3.3.

### 2.3.2 Which triggers actually exist right now — `[UNKNOWN]`

Nothing in these files can tell you. Trigger installation is live project state. The code provides a diagnostic that will answer it: `_checkAllTriggersHealth()` `[VERIFIED]` `CacheWarming.js:234`, which enumerates `ScriptApp.getProjectTriggers()` and flags any whose handler function no longer exists. **Caveat: it too only sees the triggers belonging to the account that runs it.** Full enumeration requires every editor to run it. This is verification task territory.

### 2.3.3 Finding R-3 — the FAS tracker integration is half-built

`FASTrackerSync.js` is a well-engineered module with a genuinely careful fail-closed environment gate (documented in Pass 5). Its four operations:

| Operation | Location | Implemented? | Assessment |
|---|---|---|---|
| `isFASTrackerRequired(purposeCode)` | `:112` | Yes | Tests a purpose code against the 7 Tier-1 codes in `TRAVEL_PURPOSES.TIER_1_FAS_COS` |
| `submitToFASTracker(request)` | `:134` | Yes | Appends a 14-column row to the tracker, returns `fasRowId` |
| `updateFASTrackerRow(rowId, updates)` | `:198` | Yes | Updates columns J and L by position |
| `syncFASTrackerStatus()` | `:225` | **Only half** | Reads columns A–M, finds rows whose status contains "approved"/"rejected", **returns them, and stops** |

The poller detects decisions and then discards them. There is no write back to the LETS `Requests` tab, no status transition, no notification, no caller. `[VERIFIED]`

**Also missing: the field that makes any of it work.** Both documents state that `FAS_Tracker_Row_ID` is "stored in the LETS request record for exact row tracking" `[CLAIMED]` — handoff doc §4C, line 122. **No such column exists in either data layer.** `[NOT FOUND]` Not in `TRAVEL_SHEET_SCHEMAS.Requests` (42 columns, `Sheets.js:57-100`) and not in `LetsDB.SCHEMAS['Requests']` (20 columns, `LetsDB.js:84-105`). So `submitToFASTracker` returns a row ID that has nowhere to be stored, and `syncFASTrackerStatus` matches rows by `Request_ID` from column A instead — which works only if the tracker's column A holds a LETS request ID.

**Speculation on the intended design, for whoever completes this.** `[INFERRED]` Reconstructing from the pieces present, the intended cycle was:

1. On submission, if `isFASTrackerRequired(purpose)` → call `submitToFASTracker(request)`.
2. Persist the returned `fasRowId` into a new `FAS_Tracker_Row_ID` column on `Requests`, and set status to something like `PENDING_FAS_COS`.
3. Every 15 minutes, `syncFASTrackerStatus()` reads the tracker and, for each decided row, finds the LETS request by `FAS_Tracker_Row_ID` (or `Request_ID`) and transitions it — approved → `APPROVED_GOGOV`, rejected → `DENIED` — writing an `Approval_Log` entry and sending a notification.

To finish it, a developer needs: the new column added to the schema and to `Submission.js`'s positional row builder (see Pass 3 on why order matters), a `submitToFASTracker` call site in the submission path, a write-back loop inside or around `syncFASTrackerStatus`, and an installer following the exact pattern of `setupDoDSyncTrigger` `PerDiemSync.js:21-36`.

**The brittle part to flag now.** The tracker is **another organisation's spreadsheet** — owned by the FAS front office, per the module's own header comment `FASTrackerSync.js:8-11`. The integration depends on:
- the tab being named exactly `'FAS Travel Exceptions'`, with a silent fallback to `getSheets()[0]` if absent `FASTrackerSync.js:25,93`;
- **column positions A–N**, written positionally with no header lookup `FASTrackerSync.js:148-163`;
- the status string in **column M** containing the substring "approved" or "rejected", case-insensitively `FASTrackerSync.js:239-245`;
- the literal value `'Pending FAS CoS Approval'` written to column M on submission `FASTrackerSync.js:161`.

If FAS inserts a column, renames the tab, or changes their status vocabulary, this breaks — and because the status match is a substring test, a FAS value like "Not Approved" would be read as **approved**. That specific case is worth fixing before go-live regardless of the rest.

---

## 2.4 The Apps Script editor — the unrestricted entry point

Anyone with editor access to the Apps Script project can select any function from a dropdown and run it, with **no permission checks of any kind**. Role guards like `requireTravelAdmin()` do not help: the editor runs as the editor's own Google identity, and if that person is not a LETS admin the guard throws — but all 64 unguarded functions in 2.2.3 run fine.

Concretely, an Apps Script editor can:

| Action | Function | Effect |
|---|---|---|
| Make themselves app admin | `bootstrapTravelAdmin` | Immediate admin role |
| Copy the whole database | `backupTravelDb` | Full PII/CUI/financial copy into their Drive |
| Delete request data | `_bulkDeleteSmokeRequests({dryRun:false})` | Cascading deletion |
| Read/write all config | Script Properties UI | Includes repointing `TRAVEL_DB_SPREADSHEET_ID` at a different database |
| Redirect production writes | Change `FAS_TRACKER_SPREADSHEET_ID` | Writes to another sheet |
| Create/remove scheduled jobs | the installer functions | Runs as them |
| Read every execution log | Executions pane | Logs contain emails and request details |

**Editor access to the Apps Script project is the highest privilege in this system — higher than application "admin."** Any inventory of who holds administrative control must start here, not with the `Travel_User_Roles` tab. Who currently holds it is `[UNKNOWN]` from files.

---

## 2.5 The spreadsheet — the entry point that bypasses the application

The database is a Google Sheet, addressed by the Script Property `TRAVEL_DB_SPREADSHEET_ID` `[VERIFIED]` `TripConfig.js:151`. Anyone with edit access to that Sheet can change any cell directly: approve their own request by typing `APPROVED_GOGOV` into the Status column, grant themselves a role by adding a row to `Travel_User_Roles`, or alter cost figures. None of it passes through a guard, and none of it writes to `Approval_Log`.

Three further consequences specific to this design:

- **Caching masks direct edits.** `TravelDB` caches sheet contents in `CacheService` for 600 seconds `[VERIFIED]` `TravelDB.js:39`, and role data for 300 seconds `Access.js:288`. A manual edit may not take effect for up to 10 minutes, and a manual edit made *while* the app writes can be clobbered by a cache re-warm `TravelDB.js:_readFromSheet` → `invalidate()`. Direct editing is therefore both unaudited and unreliable.
- **Column order is load-bearing.** Several write paths address columns by position, not by header name — inserting or reordering a column in the Sheets UI will silently corrupt writes. Detailed in Pass 3.
- **Who can edit it is `[UNKNOWN]`.** Sheet sharing is Drive state. A personally-owned system-of-record is the single largest continuity risk in this system and is central to the Administrator's Guide.

---

## 2.6 GitHub — the code supply chain entry point

`[VERIFIED]` from the two workflow files and the hooks.

| Path to production | Mechanism | Who can use it |
|---|---|---|
| **Merge to `main`** | `.github/workflows/deploy-gas.yml` triggers on `push` to `main` and runs `clasp push --force` into the production project | Anyone who can push or merge to `main` |
| **Manual dispatch** | Same workflow, `workflow_dispatch` | Anyone with Actions run permission |
| **Direct `clasp push`** | A developer's own machine, using `lets_app/.clasp.json` | Anyone with the script ID and an authorised Google account |

The deploy workflow is **well designed in one important respect**: it deliberately has no `pull_request` trigger, and the reason is documented at length in a header comment `deploy-gas.yml:1-16` — a `pull_request` trigger would make opening a PR *be* the deploy. A guard in `verify.yml:62-69` fails the build if anyone re-adds it. `verify.yml` itself is credential-free by design, with its own guard proving it `verify.yml:71-78`. This is careful work and should be preserved.

Three control weaknesses, all already self-documented by the repository:

1. **No branch protection.** `README.md` and `.githooks/pre-push:11-14` state plainly that the repo is private under a personal free account, where GitHub gates branch protection behind a paid plan. The `pre-push` hook that refuses pushes to `main` is **client-side, per-clone, not installed by default, and bypassed by `--no-verify`** — the hook's own comment says so `pre-push:16-26`. This is honest documentation of a real gap, tracked as issue #1.
2. **`CLASPRC_JSON` is production deploy authority.** The secret holds a `clasp` OAuth credential. Whoever holds it can push code to the production Apps Script project outside of CI entirely. Who holds it, and whose Google account it represents, is `[UNKNOWN]`.
3. **The hooks are currently uncommitted.** `git status` shows `.githooks/install.sh` and `.githooks/pre-push` modified (mode change to executable) and not committed.

---

## 2.7 Consolidated entry-point inventory

| # | Entry point | Reach | Privilege needed | Authorization enforced | Audit trail |
|---|---|---|---|---|---|
| 1 | Web app `?mode=travel\|form\|review\|dd-confirm` | Own + assigned requests | Workspace domain account passing `canAccessTrip` | Site gate, then per-record email match | Partial — `Approval_Log` on workflow actions |
| 2 | Web app `?mode=admin` | All data, all users, bulk delete | `admin` role in `Travel_User_Roles` | `isTravelAdmin` at `Render.js:216` + `requireTravelAdmin()` on 29 RPCs | `Approval_Log` for admin actions |
| 3 | Web app `?mode=reviewer-dashboard` | Scoped metrics | Any reviewer role | `getReviewerContext` | None |
| 4 | Web app `?mode=budget` | Static page | Site gate only | **None** | None |
| 5 | **`google.script.run` direct invocation** | **412 functions, 64 unguarded writes incl. self-grant of admin** | Any account passing the site gate | **Mostly none** | Stackdriver execution log only |
| 6 | Time-driven triggers | Per-diem sync, cache warming | Trigger creator's identity | n/a (no human) | Stackdriver; `DoD_Sync_Log`, `DOS_Sync_Tracker` |
| 7 | **Apps Script editor** | **Everything, unrestricted** | Editor on the script project | **None** | Stackdriver executions |
| 8 | **Bound/target spreadsheet** | **Every cell of the database** | Drive edit on the Sheet | **None** | Sheets version history only |
| 9 | GitHub merge to `main` | Production code | Push/merge on `main` | **No branch protection** | Git history, Actions log |
| 10 | GitHub Actions `workflow_dispatch` | Production code | Actions permission | Repo permissions | Actions log |
| 11 | Local `clasp push` | Production code | Script ID + authorised account | None | None |
| 12 | Sandbox project `1PLzwA_Tin…` | Separate instance | Editor on that project | Unknown | Unknown |
| 13 | Root project `181ocqi16Ruz…` | 2 stub files | Editor on that project | Unknown | Unknown |
| 14 | Outbound: GSA per-diem API, Federal Register API, State Dept download, jsDelivr CDN | Data in / scripts in | n/a | n/a | Stackdriver |

---

## 2.8 Findings carried forward from Pass 2

| ID | Finding | Severity | Destination |
|---|---|---|---|
| R-1 | `?mode=reviewer-dashboard` throws — `.html.html` filename. Plus 3 more broken `include()` targets. All inherited from TRIP. | High | Gap register; Enhancement playbook (rename procedure) |
| R-2 | `?mode=budget` is a static mockup with 30 hardcoded figures and a fake sync button; reachable by any user with no admin gate | High | Gap register; Administrator's Guide §1.2 |
| R-3 | FAS tracker: poller reads decisions and discards them; no `FAS_Tracker_Row_ID` column; no trigger installer; brittle substring status match | High | Workflow rules; Gap register |
| R-4 | **412 functions client-callable; 64 unguarded write-capable; `bootstrapTravelAdmin` allows self-grant of admin** | **Critical** | Administrator's Guide §1.4 and §1.8; ISSO review items |
| R-5 | `apiGetInitialData` and `apiSubmitRequest` do not exist; the whole LETS single-page UI (`letsAppLayout` + 4 panels) is unreachable and unserved | High | Gap register; Enhancement playbook |
| R-6 | `HC` library used at 18 sites but declared in no manifest; failures are silently swallowed, degrading to "access denied for everyone" | **Critical** | Administrator's Guide §1.7; verification checklist |
| R-7 | No simple triggers at all — **no spreadsheet custom menu exists**, contrary to convention | Informational | Administrator's Guide §1.3 |
| R-8 | `getHCStaffingBundle` returns the full personnel roster with no role check | Medium | ISSO review items |
| R-9 | No branch protection; `CLASPRC_JSON` holder has standing production deploy authority | High | Administrator's Guide §1.5 |

### Finding R-5 in detail — the orphaned LETS single-page application

Worth isolating, because it is the largest single block of unreachable work and the clearest statement of where the project actually stopped.

There are five LETS-only client files forming a complete single-page app: `letsAppLayout.html` (shell, nav, balance ticker) which includes `letsKanbanPage.html`, `letsRequestPage.html`, `letsDashboardPage.html`, and `letsConfigPage.html`. `[VERIFIED]`

**None of it is reachable.** `letsAppLayout` is referenced by no `createTemplateFromFile` call anywhere `[VERIFIED]` — there is no `?mode=` that serves it. It is pushed to Apps Script and sits there inert.

And were it served, it would not work. Three independent breaks:

| Break | Evidence | Consequence |
|---|---|---|
| Calls `apiGetInitialData()` | `letsAppLayout.html:102` | No such server function — load fails, `withFailureHandler` logs to console only |
| Calls `apiSubmitRequest(formData)` | `letsRequestPage.html:274` | No such server function — submission fails |
| **State-shape mismatch** | `letsAppLayout.html:110-111` assigns `APP_STATE = res` then reads `res.portfolioSummary`; the panels read `APP_STATE.portfolio` `letsDashboardPage.html:172`, `letsRequestPage.html:216` | Even with a working server function, the dashboard and the budget gatekeeper would read `undefined` unless the response contains **both** `portfolioSummary` and `portfolio` |

Each panel also falls back to fabricated data when the server is absent: `letsKanbanPage.html:151-186` defines `MOCK_REQUESTS` with three invented requests (`LETS-2027-001` "FY27 Acquisition Leadership Conf", etc.) and renders them whenever `APP_STATE.requests` is empty `:159`. `letsConfigPage.html`'s save handlers are `alert()` calls `:170-181`. The Kanban reconcile modal hardcodes "Sample Traveler" with a $1,350 estimate `:245-258`. **If this page were served today it would show three fake requests as if they were real.**

**The missing piece both functions need, precisely specified.** `[INFERRED]` — this is deduction from the call signatures, stated so a developer can act on it:

`BudgetEngine` and `RequestService` are pure functions. Every entry point takes a `state` object, and across the two modules exactly five keys are read `[VERIFIED]`: `state.offices`, `state.budgetAdjustments`, `state.setAsides`, `state.requests`, `state.approvers`. Those map one-to-one onto five of the seven tabs in `LETS_CONFIG.sheets` `BudgetConfig.js:122-130`: `Budgets`, `Budget_Adjustments`, `Set_Asides`, `Requests`, `Org_Approvers`.

**Nothing in the codebase builds that object.** `[VERIFIED]` — no code outside `LetsDB.js` itself references `budgetAdjustments`, `setAsides`, or `offices`. `LetsDB` provides the read primitive (`sheetDataToObjects(sheet)` → array of header-keyed objects `LetsDB.js:138`) and the tab creator (`initializeDatabase(spreadsheet)` `:160`, itself never called `[VERIFIED]`), but there is no function that opens the spreadsheet, reads each tab, and assembles `state`.

So the gap is a **repository layer** of roughly this shape:

```javascript
function loadLetsState() {                 // DOES NOT EXIST — [NOT FOUND]
  const ss = SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID);
  const S = LETS_CONFIG.sheets;
  return {
    offices:           keyBy(LetsDB.sheetDataToObjects(ss.getSheetByName(S.budgets)), 'OfficeCode'),
    budgetAdjustments: LetsDB.sheetDataToObjects(ss.getSheetByName(S.budgetAdjustments)),
    setAsides:         LetsDB.sheetDataToObjects(ss.getSheetByName(S.setAsides)),
    requests:          LetsDB.sheetDataToObjects(ss.getSheetByName(S.requests)),
    approvers:         keyBy(LetsDB.sheetDataToObjects(ss.getSheetByName(S.approvers)), 'OfficeCode')
  };
}
```
plus a `saveLetsState`-equivalent for writes (the `Travelers` and `Audit_Log` tabs have schemas but **no writer anywhere** `[VERIFIED]`).

Then `apiGetInitialData` would be approximately `{success, requests, portfolio: BudgetEngine.generatePortfolioSummary(state), portfolioSummary: <same>}` — satisfying both key names until the client mismatch is fixed — and `apiSubmitRequest(formData)` would call `RequestService.createTravelRequest(formData, state)` and persist the returned `request`/`travelers`/`auditEntry`.

**Two hard blockers a developer will hit immediately**, both deferred to Pass 3 but flagged here so nobody starts work unaware:
- `state.offices` is keyed by office code while the `Budgets` tab is a flat row list — a keying step is required, and the shape `BudgetEngine` expects (`{code, name, baselineAmount, standardProportionalShare}`) does not match the tab's header names (`OfficeCode`, `OfficeName`, `BaselineAllocation`, `ProportionalShare`). A field mapping is needed, not a passthrough.
- **`LETS_CONFIG.sheets.requests` is the string `'Requests'` — the same tab name the live TRIP system already uses, with 42 completely different columns.** Implementing this layer against the production database without renaming that tab first would point two incompatible schemas at one sheet. This is the single most consequential unresolved decision in the system.

---

## 2.9 Where documentation contradicts the code

Per the standing rule: the codebase wins, and the wrong document is named.

| Document & section | Claim | Code reality |
|---|---|---|
| `LETS_COMPREHENSIVE_HANDOFF_DOCUMENTATION.md` §4C line 123 | "`syncFASTrackerStatus()`: Scheduled 15-minute background polling function that scans the FAS Sheet for status decisions and **automatically advances the LETS request**" | The function returns a change list and advances nothing. No write-back, no caller, no trigger installer. `[VERIFIED]` `FASTrackerSync.js:225-258` |
| `LETS_COMPREHENSIVE_HANDOFF_DOCUMENTATION.md` §4C line 122 | "`FAS_Tracker_Row_ID`: Stored in the LETS request record for exact row tracking" | No such column in either schema. `[NOT FOUND]` |
| `LETS_COMPREHENSIVE_HANDOFF_DOCUMENTATION.md` §167 | "`doGet.js` # HTTP entrypoint & mode router (?mode=travel, form, budget)" | Accurate as far as it goes, but omits `review`, `dd-confirm`, `admin`, `reviewer-dashboard`, `access-blocked` — and `budget` leads to a mockup |
| `LETS_COMPREHENSIVE_HANDOFF_DOCUMENTATION.md` §146 | "`travelBudgetDashboardPage.html` # Executive Financial Dashboard" | Static HTML, 30 hardcoded figures, `alert()`-only sync button `[VERIFIED]` |
| `README.md` §Core Features 1 | "**Unified Workflow Engine**: Kanban board visualizing request progression" | The Kanban board exists (`letsKanbanPage.html`) but is served by no route and renders `MOCK_REQUESTS` `[VERIFIED]` |
| `README.md` §Core Features 2 & 5 | "**Real-time discretionary balance tracking**"; "Executive & DAC Dashboards" | `BudgetEngine` computes correctly but is called by nothing reachable; dashboards are static `[VERIFIED]` |
| `PROJECT_PLAN.md:160` (Roadmap 2) | "Schedule the FAS Poller Trigger — add an installable time-driven trigger calling `FASTrackerSync.syncFASTrackerStatus()` every 15 minutes" | Correctly identified as *not yet done*. But installing it would accomplish nothing without the write-back half. The roadmap understates the work. |
| `PROJECT_PLAN.md:159` (Roadmap 1) | "Wire `travelRequestTravelers.html` to Budget Engine" | `travelRequestTravelers.html` is byte-identical to TRIP's and contains no budget references. The wiring named does not exist in any partial form. `[VERIFIED]` |
| `PROJECT_PLAN.md:161` (Roadmap 3) | "Finalize Org Approver Routing — connect `Org_Approvers` to the email notification dispatch" | `Org_Approvers` has a schema and seed data `LetsDB.js:74-83,212-225` but **no reader anywhere** `[VERIFIED]`. The live routing uses an entirely different mechanism (`Travel_User_Roles` + HC), documented in Pass 4. These are two unrelated approval models, and the plan does not acknowledge that. |

**The pattern.** The documentation describes TRIP's working skeleton plus LETS's intended financial layer as though they were joined. They are not. Where the handoff documents describe *TRIP-inherited* behavior (the 6-step form, review workflow, per-diem services, user administration), they are broadly accurate — that code is real, byte-identical to a system that presumably ran. Where they describe *LETS-specific* behavior (budget governance, FAS integration, Kanban, executive dashboards), they describe intent that was built as isolated components and never connected.

A reader should treat the two documents as a **design specification**, not a system description. That reframing is itself useful: as a spec, they are a reasonable statement of what the enhancement backlog should deliver.

---

## 2.10 Verification tasks generated by Pass 2

Each becomes a numbered item in `HUMAN_VERIFICATION_CHECKLIST.md`. Ordered by how much they unblock.

| # | Question | Why it matters | Where to look |
|---|---|---|---|
| V-1 | What is the deployed web app URL, and what are the active deployment's **"Execute as"** and **"Who has access"** settings? | Determines whose identity server code runs as and who can reach it at all. The manifest says `USER_ACCESSING` / `DOMAIN`, but the deployment overrides the manifest. Changes the meaning of every `Session.getActiveUser()` call. | Apps Script editor → Deploy → Manage deployments |
| V-2 | Is an **HC library** attached to the production project, and to the sandbox? | If not, all HC-based access silently denies. Highest-impact single unknown. | Editor → Libraries (left panel) |
| V-3 | Who are the **editors and the owner** of the production Apps Script project? | Editor access is the highest privilege in the system. | Project → Share / the container Sheet's sharing dialog |
| V-4 | What triggers exist, with handler and owner — run `_checkAllTriggersHealth()` as **each** editor | Triggers are per-user invisible; a departed owner's triggers fail silently. | Editor → Triggers; run the diagnostic |
| V-5 | Current values of all Script Properties in both projects | Determines the database target, environment gate, and FAS write target. | Project Settings → Script Properties |
| V-6 | Does `?mode=reviewer-dashboard` throw in the live project — i.e. are the `.html.html` names present there too? | Decides whether the rename fix is safe or whether the dashboard has never worked. | Editor file list; or load the URL as a non-admin reviewer |
| V-7 | Who owns the database Sheet, and who has edit access? | Direct, unaudited write access to all PII/CUI/financial data. | Drive → the Sheet → Share |
| V-8 | Who holds GitHub admin, and whose Google account does `CLASPRC_JSON` represent? | Standing production deploy authority. | GitHub → Settings → Collaborators / Secrets |
| V-9 | What are the sandbox (`1PLzwA_Tin…`) and root (`181ocqi16Ruz…`) projects, and should they exist? | Two undocumented live projects. | Apps Script dashboard |
| V-10 | Does the **tab named `Requests`** in the live database carry TRIP's 42 columns or LETS's 20? | Decides whether the two data layers have already collided. | Open the Sheet, read row 1 |
| V-11 | Does the prototype sheet `1bsMXl2F4D…` exist, and what are its 15 tab names and header rows? | The only way to recover the unversioned `LETS_SYSTEM_*` schema. | Open the sheet; export headers |

---

*End of Pass 2. Next: Pass 3 — the data layer (every spreadsheet, tab, column, and every place column order is load-bearing).*
