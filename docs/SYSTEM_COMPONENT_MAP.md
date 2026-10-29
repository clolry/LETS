---
title: "LETS System Component Map"
description: "Every file and module in the system, what it does, who owns it, and how the parts connect"
status: canonical
tier: 1
audience: "project manager, system owner, developer scoping a change"
last_updated: "2026-10-29"
evidence_base: "docs/evidence/pass6_component_map.js"
---

# LETS System Component Map

**Deliverable 2 of 10.** Companion to [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md).

---

## How to read this document

Deliverable 1 told you what the system *does* and who controls it. This one tells you **what it is made of and how the pieces connect** — so that when someone proposes a change, you can tell what it touches.

Conventions carried from Deliverable 1:

| Marker | Meaning |
|---|---|
| `[VERIFIED]` | Read from source or measured by a script in `docs/evidence/` |
| `[INFERRED]` | A reasoned conclusion, labelled so you can disagree with the reasoning |
| `[CLAIMED]` | Asserted by project documentation, not confirmed in code |
| `[UNKNOWN]` | Requires someone with live access |

Ownership is stated for every component, because it decides who can authorise a change:

| Label | Meaning |
|---|---|
| **INHERITED** | Byte-identical to the TRIP reference application `[VERIFIED]` |
| **MODIFIED** | Exists in both, LETS changed it |
| **LETS-ONLY** | Written for this project |

Every count in this document is produced by [`evidence/pass6_component_map.js`](./evidence/pass6_component_map.js). None was counted by hand.

---

## §2.0 The map in one page

```
                          ┌─────────────────────────────┐
     a GSA user's         │   Google authentication     │
       browser  ──────────▶   (outside the application) │
                          └──────────────┬──────────────┘
                                         │ email address
                                         ▼
  ╔══════════════════════════════════════════════════════════════════════╗
  ║  THE APPS SCRIPT PROJECT — 53 server files, 31,620 lines             ║
  ║                                                                      ║
  ║   90_entrypoint/doGet.js  ← the only HTTP entry point (62 lines)     ║
  ║            │                                                         ║
  ║            ├─ site gate: canAccessTrip()  →  30_services/Access.js   ║
  ║            │                                                         ║
  ║            ▼                                                         ║
  ║   50_pages/Render.js  ← 8 page-servers, one per ?mode=               ║
  ║            │                                                         ║
  ║            │  assembles an HTML page from client/ partials           ║
  ║            ▼                                                         ║
  ║   ┌──────────────────────────────────────────────────┐               ║
  ║   │ client/  51 files, 63,045 lines                  │               ║
  ║   │   pages/ 13   controllers/ 11   shared/ 11       │               ║
  ║   │   components/ 8   styles/ 8                      │               ║
  ║   └───────────────────────┬──────────────────────────┘               ║
  ║                           │ google.script.run — 61 functions used    ║
  ║                           │ (412 are callable)                       ║
  ║                           ▼                                          ║
  ║   40_domain/   13 files  ← request, review, admin, users, reporting  ║
  ║   30_services/ 14 files  ← access, email, costs, per-diem, files    ║
  ║   20_data/TravelDB.js    ← THE data layer actually in use            ║
  ║   10_lib/ 01_constants/ 00_config/                                   ║
  ║   91_setup/  99_triggers/ (5 scheduled jobs)                         ║
  ║                                                                      ║
  ║   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐           ║
  ║     THE LETS SUBSYSTEM — detached. No inbound edge.                  ║
  ║   │   RequestService.js ──▶ BudgetEngine.js                │         ║
  ║   │            └──────────▶ LetsDB.js                      │         ║
  ║   │   FASTrackerSync.js  (no edges at all)                 │         ║
  ║   │   0 top-level functions · 0 inbound references         │         ║
  ║   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘           ║
  ╚══════════════════════════════════════════════════════════════════════╝
                    │                              │
                    ▼                              ▼
     ┌──────────────────────────┐    ┌─────────────────────────────┐
     │ The Google Sheet         │    │ External                    │
     │ (the database — 16 tabs) │    │  · HC Data Library (28 refs)│
     │ + a Shared Drive         │    │  · api.gsa.gov              │
     │   (attachments)          │    │  · federalregister.gov      │
     └──────────────────────────┘    │  · aoprals.state.gov        │
                                     │  · jsDelivr / cdnjs (CDN)   │
                                     └─────────────────────────────┘
```

**The dashed box is the point of this document.** Everything else is a conventional web application. That box contains four well-written modules that **nothing can reach** — and a component map that drew them as a connected layer would hide the system's most important structural fact. §2.6 proves it.

---

## §2.1 Four structural facts to hold while reading

### 2.1.1 There is one global scope, not a module system

Google Apps Script pushes every `.js` file into **one shared global namespace** `[VERIFIED]`. There is no `import`, no `require`, no file-level privacy. Any function can call any other function in the project.

Three consequences that shape everything below:

| Consequence | Why it matters |
|---|---|
| **The directory numbering is a convention, not a boundary** | `00_config`, `10_lib`, `30_services`, `40_domain` look like enforced layers. Nothing enforces them (§2.3.2) |
| **Load order is alphabetical by path, and it matters** | A name defined twice resolves to whichever file loads last. The numeric prefixes exist to control this `[VERIFIED]` |
| **A top-level `function` is a public API whether you meant it or not** | This is the root of **G-001** and the reason §2.6's test works at all |

### 2.1.2 Top-level functions are the public surface

| Measure | Count |
|---|---|
| Server files | 53 `[VERIFIED]` |
| Server lines | 31,620 `[VERIFIED]` |
| Top-level functions | 459 `[VERIFIED]` |
| **Callable from a browser** (no trailing underscore) | **412** `[VERIFIED]` |
| Behind a throwing authorization guard | **31** `[VERIFIED]` |
| Used by any screen | 61 `[VERIFIED]` |

Only a **trailing** underscore makes a function private to the platform. A leading underscore — `_bulkDeleteSmokeRequests` — is a naming convention that confers nothing `[VERIFIED]`.

### 2.1.3 The client is bigger than the server

| | Files | Lines |
|---|---|---|
| Server | 53 | 31,620 |
| **Client** | **51** | **63,045** |

Two-thirds of the codebase is browser code `[VERIFIED]`. That is normal for this kind of application, and it has a planning consequence: **the biggest files in the system are client controllers and stylesheets, not business logic.** A change to the review screen touches an 8,130-line file.

### 2.1.4 Ownership is lopsided, and it is not uniform across the tree

| | Inherited | Modified | LETS-only |
|---|---|---|---|
| Server (53) | 44 | 3 | 6 |
| Client (51) | 42 | 2 | 7 |

Where the LETS-original work sits is more informative than the totals:

| Group | Files | Inherited | LETS-only |
|---|---|---|---|
| `controllers/` | 11 | **11** | 0 |
| `shared/` | 11 | **11** | 0 |
| `components/` | 8 | **8** | 0 |
| `styles/` | 8 | 7 | 1 |
| `pages/` | 13 | 5 | **6** |

**Every controller, every shared service, and every component is inherited unmodified** `[VERIFIED]`. LETS wrote **pages** — six new ones — and then wrote no controllers to drive them. §2.4.3 shows what happened to those pages.

---

## §2.2 How one page load works, end to end

Trace this once and the rest of the map follows.

```
 1. Browser requests  <web app URL>?mode=review&requestId=TR-2026-0417
                                  │
 2. doGet(e)                      ▼        90_entrypoint/doGet.js:28
       reads ?mode= (default 'travel')               :29
       reads caller's email via Session              :31
                                  │
 3. SITE GATE  canAccessTrip(email)                  :41
       │                                  30_services/Access.js:394
       │  three allow-paths: a role row, an HC supervisor seat,
       │  or an HC "chief of staff"/"client executive" title
       ├── false ──▶ serveAccessRestrictedPage()  — dead end
       ▼ true
 4. switch on mode  ──▶ one of 8 page-servers        :45-61
                                  │
 5. serveTravelReviewPage(e)              50_pages/Render.js:154
       createTemplateFromFile('client/pages/travelReviewPage')
                                  │
 6. The template is assembled server-side.
       Each <?!= include('…') ?> is replaced by that file's contents.
       travelReviewPage.html pulls in 20 partials — styles, shared
       services, the 8,130-line review controller.
                                  │
 7. One HTML document is returned to the browser.
                                  │
 8. The page now calls server functions by name:
       google.script.run.getRequestForReview(id)
         — or via the Promise wrapper, serverCall('getRequestForReview', id)
                                  │          client/shared/serverCall.html
 9. getRequestForReview()                 40_domain/Review_Read.js
       reads via  new TravelDB()           20_data/TravelDB.js
       which reads the Google Sheet, through a 600-second cache
                                  │
10. A JSON-ish object returns to the browser callback.
```

**Three things this trace reveals that are easy to miss:**

1. **Step 6 is server-side templating.** A "page" is not a file — it is one file plus up to 23 others, stitched together on every load `[VERIFIED]`. This is why a single missing partial breaks a whole screen (**G-017**, §2.4.4).
2. **Step 3 is the only gate most screens get.** Six of the eight page-servers apply nothing beyond it `[VERIFIED]`.
3. **Step 8 does not have to come from step 7.** The browser can call *any* of the 412 reachable functions, not only the ones this page uses. Steps 1–7 are the front door; step 8 is a door with no lock on 381 of them. That is **G-001**, and §2.3.4 shows where the 31 guards actually are.

---

## §2.3 The server, layer by layer

### 2.3.1 The ten layers

In clasp load order `[VERIFIED]`:

| Layer | Files | Lines | Functions | Reachable | Guarded | What it is |
|---|---|---|---|---|---|---|
| `00_config` | 3 | 770 | 28 | 28 | 0 | Script Property accessors, LETS and TRIP configuration |
| `01_constants` | 7 | 539 | 4 | 4 | 0 | Sheet names, status codes, role names, cache keys |
| `10_lib` | 7 | 826 | 35 | 35 | 0 | Date, number, string, JSON, and validation helpers |
| `20_data` | 2 | 655 | **0** | **0** | 0 | The two data-access layers (§2.5) |
| `30_services` | 14 | 10,657 | 177 | 158 | **3** | Access control, email, costs, per-diem, attachments |
| `40_domain` | 13 | 13,280 | 120 | 119 | **28** | Request, review, admin, users, reporting |
| `50_pages` | 1 | 393 | 11 | 11 | 0 | The eight page-servers and `include()` |
| `90_entrypoint` | 1 | 63 | 1 | 1 | 0 | `doGet` — the only HTTP entry point |
| `91_setup` | 3 | 2,297 | 52 | 25 | 0 | Database creation, per-diem bulk sync |
| `99_triggers` | 2 | 2,140 | 31 | 31 | 0 | Scheduled cache warming and sync |
| **Total** | **53** | **31,620** | **459** | **412** | **31** | |

### 2.3.2 The layer numbering is not enforced

The convention implies a file should call only into lower-numbered layers. **Fourteen edges go the other way** `[VERIFIED]`:

| Backward edge | Why it exists |
|---|---|
| `Access.js` (30) → `Users.js` (40) | The self-heal write (**G-027**) — a service calling into domain logic |
| `Access.js` (30) → `Render.js` (50) | Access denial renders a page |
| `PerDiemDoD.js` (30) → `DoDSync.js` (91) | A rate lookup can trigger a bulk sync |
| Six `40_domain` files → `Database.js` (91) | Domain code calling setup/bootstrap helpers |
| Five `40_domain` files → `Render.js` (50) | Domain code rendering or building URLs |
| `Render.js` (50) → `Database.js` (91) | Page rendering reaching into setup |

**None of these is a defect in itself** — in one global scope any function can call any other. They matter for two reasons:

1. **Do not read the numbering as an architecture.** It is a naming convention and a load-order device. A change in `91_setup` can affect page rendering.
2. **`Access.js` → `Users.js` is the one worth remembering.** It is the mechanism behind **G-027**: resolving someone's roles can write to the user table. A reader who assumed services never call domain code would not predict that.

### 2.3.3 Every server file

**`00_config` — 3 files, configuration**

| File | Lines | Fns | Owner | Purpose |
|---|---|---|---|---|
| `Props.js` | 317 | 25 | INHERITED | Typed accessors for every Script Property. Also the source of 8 unguarded config writers (**G-001**) |
| `TripConfig.js` | 301 | 3 | **MODIFIED** | LETS configuration, travel purposes, and the exemplary FAS environment gate (§2.7.3) |
| `BudgetConfig.js` | 152 | **0** | **LETS-ONLY** | `LETS_CONFIG` — fiscal year, budget figures, set-aside shares, the 8 placeholder approvers (**G-063**) |

**`01_constants` — 7 files, 539 lines, the vocabulary**

| File | Lines | Purpose |
|---|---|---|
| `Sheets.js` | 289 | `SHEET_NAMES` — the 16 TRIP tabs. The registry four per-diem modules bypass (**G-042**) |
| `Status.js` | 143 | 15 status codes and 23 logged action types |
| `Roles.js` | 18 | Role name constants |
| `Cache.js`, `Costs.js`, `Locations.js`, `Time.js` | 86 total | Cache keys, cost categories, location constants, time windows |

All seven INHERITED. Six expose **zero** functions — they are pure constant declarations `[VERIFIED]`.

**`10_lib` — 7 files, 826 lines, helpers**

| File | Lines | Fns | Purpose |
|---|---|---|---|
| `Validation.js` | 251 | 12 | A complete 12-function input-validation library with **zero adopters** (**G-033**) |
| `DateTime.js` | 194 | — | Date parsing, formatting, fiscal-period maths |
| `SheetHelpers.js` | 118 | — | Shared sheet-reading utilities |
| `Locations.js` | 111 | — | Location string normalisation |
| `Errors.js` | 103 | — | `logError` — appends to `Error_Log`. One of the four "ambient writers" |
| `JsonSafe.js`, `Numbers.js` | 42 | — | Safe JSON parsing, number coercion |

All INHERITED. **`Validation.js` is the single clearest piece of unrealised value in the codebase** — 251 lines of correct, documented guards, called from nowhere outside its own self-test `[VERIFIED]`, while an ad-hoc `_isValidEmail` helper has 21 call sites.

**`20_data` — 2 files, the data layers.** See §2.5 — this is where the two systems diverge.

**`30_services` — 14 files, 10,657 lines, the service tier**

| File | Lines | Fns | Owner | Purpose |
|---|---|---|---|---|
| `Email.js` | 3,580 | — | INHERITED | 18 notification templates. The largest server file |
| `Access.js` | 1,451 | — | INHERITED | **The authorization layer.** Site gate, role resolution, and the two unused per-record guards (**G-067**) |
| `Costs.js` | 1,083 | — | INHERITED | Per-diem, mileage, and total calculation |
| `PerDiemGSA.js` | 989 | — | INHERITED | GSA per-diem API client |
| `PerDiemForeign.js` | 799 | — | INHERITED | State Department foreign rates |
| `Attachments.js` | 663 | — | INHERITED | Drive upload, share, delete (**G-005**, **G-028**) |
| `PerDiemDoD.js` | 659 | — | INHERITED | DoD per-diem rates |
| `BudgetEngine.js` | 353 | **0** | **LETS-ONLY** | Budget commitment and set-aside logic — **unreachable** (§2.6) |
| `Feedback.js` | 316 | — | INHERITED | NPS prompt and feedback capture |
| `OrgLookup.js` | 296 | — | INHERITED | Org-chart lookup. Contains `verifyPhase7Routing` (**G-010**) |
| `FASTrackerSync.js` | 272 | **0** | **LETS-ONLY** | FAS compliance sync — **unreachable** (§2.6) |
| `TripDates.js` | 81 | — | INHERITED | Travel-date helpers |
| `DataSync.js` | 78 | — | INHERITED | Change-broadcast timestamps |
| `HCStaffing.js` | **23** | 1 | INHERITED | The entire HC library gateway (§2.7.2) |

**`HCStaffing.js` is 23 lines and it is a single point of failure.** It is the whole interface to the dependency that controls two of three site-gate allow-paths (**G-008**).

**`40_domain` — 13 files, 13,280 lines, the business logic**

| File | Lines | Guards | Owner | Purpose |
|---|---|---|---|---|
| `Review_Update.js` | 2,712 | 0 | INHERITED | The seven `update*` RPCs. **Five check nothing** (**G-003**) |
| `Users.js` | 1,854 | **8** | INHERITED | Role CRUD. **All eight RPCs guarded** — the model the rest should follow |
| `Submission.js` | 1,605 | — | INHERITED | Intake and the routing cascade (**G-018**) |
| `Reporting.js` | 1,421 | **9** | INHERITED | Report builder and exports. All nine entry points guarded |
| `Admin_Dashboard.js` | 1,240 | — | INHERITED | Admin console data |
| `Review_DDConfirm.js` | 846 | 0 | INHERITED | Division Director confirmation (**G-003**, **G-044**) |
| `Review_Action.js` | 828 | — | INHERITED | **The 12-action state machine.** The one place authorization is done properly (§2.8.1) |
| `Request.js` | 822 | — | INHERITED | Request read and portal bootstrap |
| `ReviewerDashboard.js` | 822 | — | INHERITED | Scope-filtered reviewer metrics |
| `Review_Read.js` | 498 | 0 | INHERITED | `getRequestForReview` (**G-004**) |
| `Admin_Cleanup.js` | 253 | — | INHERITED | Bulk delete, cascading across 6 tabs (**G-009**) |
| `RequestService.js` | 186 | **0** | **LETS-ONLY** | LETS request orchestration — **unreachable** (§2.6) |
| `Admin_Actions.js` | 180 | — | INHERITED | Status override and reassignment. **Exemplary auditing** (§2.8.1) |

**`50_pages`, `90_entrypoint` — 2 files, the front door**

| File | Lines | Purpose |
|---|---|---|
| `doGet.js` | 63 | The only HTTP entry point. **MODIFIED** — LETS added `?mode=budget` |
| `Render.js` | 393 | Eight page-servers plus `include()`. **MODIFIED** — LETS added the budget page-server |

**Both files LETS touched are the routing layer**, which is exactly where you would expect a project adding screens to an inherited application to work.

**`91_setup`, `99_triggers` — 5 files, 4,437 lines, operations**

| File | Lines | Fns | Reachable | Purpose |
|---|---|---|---|---|
| `CacheWarming.js` | 2,031 | — | — | Cache warming, trigger installers, and ~20 diagnostic probes |
| `Database.js` | 975 | — | — | Tab creation and `bootstrapTravelAdmin` (**G-002**) |
| `ForeignSync.js` | 661 | — | — | Bulk foreign per-diem sync |
| `DoDSync.js` | 658 | — | — | Bulk DoD per-diem sync |
| `PerDiemSync.js` | 107 | — | — | Four trigger install/remove functions |

`91_setup` is the only layer where most functions are properly private: **25 of 52 reachable**, meaning 27 use a trailing underscore `[VERIFIED]`. Someone was careful here — and then `bootstrapTravelAdmin` was left reachable.

### 2.3.4 Where the 31 guards actually are

| Layer | Guarded functions | Share of all guards |
|---|---|---|
| `40_domain` | 28 | **90%** |
| `30_services` | 3 | 10% |
| Every other layer | **0** | — |

And within `40_domain`, they concentrate in three files: `Users.js` (8), `Reporting.js` (9), and the admin modules.

**This is the structural shape of G-001 in one table.** Authorization is not spread thinly across the system — it is **present and consistent in a handful of files and absent everywhere else**. `Users.js` and `Reporting.js` guard every single entry point `[VERIFIED]`. `Review_Update.js`, 2,712 lines of request-editing logic, has **none**.

That is encouraging rather than discouraging: the pattern to copy already exists in the same codebase, written by the same hands.

---

## §2.4 The client

### 2.4.1 Five groups

| Group | Files | Lines | Inherited | Modified | LETS-only | What it holds |
|---|---|---|---|---|---|---|
| `pages/` | 13 | 6,590 | 5 | 2 | **6** | Top-level screens — the only files a page-server serves |
| `controllers/` | 11 | **27,088** | **11** | 0 | 0 | The JavaScript that drives each screen |
| `shared/` | 11 | 5,654 | **11** | 0 | 0 | Services used by more than one screen |
| `components/` | 8 | 1,328 | **8** | 0 | 0 | Reusable widgets — modals, loaders, logo |
| `styles/` | 8 | 22,385 | 7 | 0 | 1 | CSS, one stylesheet per screen |
| **Total** | **51** | **63,045** | **42** | **2** | **7** | |

**`controllers/` and `styles/` are 78% of the client by volume** `[VERIFIED]`. That is where the effort went, and all 11 controllers are inherited unmodified.

### 2.4.2 The files that matter by size

| Lines | File | What it is |
|---|---|---|
| **8,130** | `controllers/review/travelReviewController.html` | The review screen. The largest file in the entire project |
| 6,588 | `styles/travelRequestStyles.html` | Intake-form CSS |
| 5,970 | `styles/travelReviewStyles.html` | Review-screen CSS |
| 5,055 | `styles/travelAdminStyles.html` | Admin-console CSS |
| 3,961 | `controllers/admin/travelAdminController.html` | Admin console logic |
| 3,305 | `controllers/form/travelRequestTravelers.html` | Traveller and cost entry on the intake form |
| 3,147 | `controllers/admin/travelUsersController.html.html` | User and role administration — **and it never loads** (§2.4.4) |

**Planning consequence:** any change to the review experience means working inside an 8,130-line single file. Pass 5 flagged this file and `travelRequestTravelers.html` as the two needing a targeted security review (**VT-26**) precisely because their size defeats casual reading.

### 2.4.3 The six LETS-original pages, and what happened to them

| File | Lines | Reachable? |
|---|---|---|
| `pages/travelBudgetDashboardPage.html` | 318 | **Yes** — served by `?mode=budget`. A mockup (**G-025**) |
| `pages/letsAppLayout.html` | 127 | **No** |
| `pages/letsKanbanPage.html` | 286 | **No** — only via `letsAppLayout` |
| `pages/letsRequestPage.html` | 287 | **No** — only via `letsAppLayout` |
| `pages/letsDashboardPage.html` | 180 | **No** — only via `letsAppLayout` |
| `pages/letsConfigPage.html` | 124 | **No** — only via `letsAppLayout` |
| `styles/letsStyles.html` | 387 | **No** — only via `letsAppLayout` |

**`letsAppLayout.html` is a complete single-page application shell.** It includes the four panel pages and the LETS stylesheet, and all five of those includes resolve correctly `[VERIFIED]`. It is well formed.

**No page-server serves it.** `Render.js` contains no reference to `letsAppLayout` at all `[VERIFIED]`, and there is no `?mode=` value that reaches it. It is pushed to Apps Script and sits inert.

**And it could not work if it were served.** Two RPCs are all it needs, and neither exists:

| Call site | Function requested | Status |
|---|---|---|
| `letsAppLayout.html:102` | `apiGetInitialData()` | **No definition anywhere** `[VERIFIED]` |
| `letsRequestPage.html:274` | `apiSubmitRequest(formData)` | **No definition anywhere** `[VERIFIED]` |

Both pages have a graceful local-mode fallback — `letsRequestPage.html:276` says *"Request simulated locally! Funds committed."* `[VERIFIED]` — which is why the UI looks functional when opened as a static file and does nothing when deployed.

**This is finding G-015, and the shape of it is now clear.** The LETS front end is six finished pages and a layout shell, needing two server functions that were never written, served by no route. Combined with §2.6, the picture is consistent: **the LETS layer was built from both ends and never joined in the middle.**

### 2.4.4 The include graph and its four broken edges

A page is assembled server-side from partials. Include counts `[VERIFIED]`:

| Page | Includes | Broken |
|---|---|---|
| `travelRequestPage.html` | 23 | **1** |
| `travelReviewPage.html` | 20 | **1** |
| `travelPortalPage.html` | 15 | 0 |
| `travelAdminPage.html` | 14 | **2** |
| `travelReviewerDashboardPage.html.html` | 8 | 0 |
| `ddConfirmPage.html` | 5 | 0 |
| `letsAppLayout.html` | 5 | 0 |
| `travelAccessBlockedPage.html` | 4 | 0 |
| `travelBudgetDashboardPage.html` | 3 | 0 |
| The four `lets*Page.html` panels | 0 | 0 |

**Four broken edges, three distinct causes** — this is **G-017** `[VERIFIED]`:

| Broken reference | Cause | Effect |
|---|---|---|
| `client/components/flatpickrConfig` (×2) | File is named `flatpickrConfig.html.html` | Date-picker configuration missing from the intake form **and** the review page |
| `client/controllers/admin/travelUsersController` | File is named `...html.html` | **The admin console's Users tab has no controller** |
| `client/styles/travelUsersStyles` | A genuine typo — the file is `travelUserStyles` (singular) | Users tab unstyled |

**Plus a fifth broken reference that is not an include.** `Render.js` serves eight templates directly; **one does not resolve** — `client/pages/travelReviewerDashboardPage`, because the file is `...html.html` `[VERIFIED]`. That is why `?mode=reviewer-dashboard` throws.

All three doubled-extension files **are** referenced by their correct names `[VERIFIED]`, which confirms the diagnosis: the references are right and the filenames are wrong. The fix is three renames and one typo correction — **but confirm against the live project first (VT-20)**, because if the deployed project has correct filenames, renaming in the repository would break what currently works.

### 2.4.5 Four client files nothing reaches

| File | Owner | Assessment |
|---|---|---|
| `pages/letsAppLayout.html` | **LETS-ONLY** | **G-015** — the SPA shell, served by nothing (§2.4.3) |
| `styles/travelUserStyles.html` | INHERITED | **The file the typo should point at.** Not dead — orphaned *by* the typo in `travelAdminPage.html:30` |
| `components/Loader.html` | INHERITED | Superseded by `planeLoader.html`, which is included |
| `controllers/form/travelRequestStorage.html` | INHERITED | Superseded by `travelRequestDraftStorage.html`, which is included |

**`travelUserStyles.html` is the useful one to notice.** It is a 1,842-line stylesheet that appears orphaned, but it is not dead code — it is the intended target of a misspelled reference. Deleting it as unused would turn a cosmetic defect into a permanent one.

---

## §2.5 The two data layers

`20_data` holds two files. They are not two halves of one design — they are two incompatible designs for the same job, one of which is in use.

| | `TravelDB.js` | `LetsDB.js` |
|---|---|---|
| Lines | 418 | 235 |
| Owner | **INHERITED** | **LETS-ONLY** |
| Form | An ES6 `class` `[VERIFIED]` `:53` | A module factory `[VERIFIED]` |
| Top-level functions | **0** | **0** |
| How callers use it | `new TravelDB()` — **59 call sites in 19 files** `[VERIFIED]` | `LetsDB.<method>` — **0 call sites outside its own group** `[VERIFIED]` |
| Caching | `CacheService`, 600-second TTL, invalidated on every write `[VERIFIED]` `:39` | **None** |
| Reads | `readSheet(name)` → `{ headers, rows, headerIndex }` | `sheetDataToObjects(sheet)` → array of objects |
| Writes | `appendRow`, `updateRowByIndex`, `deleteRowByIndex` — each invalidates cache atomically `[VERIFIED]` | **None.** `initializeDatabase` creates tabs; nothing writes rows |
| Tab vocabulary | `SHEET_NAMES` — 16 TRIP tabs | `LETS_CONFIG.sheets` — 7 tabs |
| **In use today?** | **Yes — this is the data layer** | **No** |

### 2.5.1 Why both expose zero top-level functions, and why that means different things

Both files show `0` in §2.3.1's function column, and the reason is the same — neither uses bare `function name()` at the top level. **But the consequence is opposite.**

`TravelDB` is a `class`. Callers write `new TravelDB()` inside a function that *is* top-level, so the class is reachable through 59 ordinary call sites `[VERIFIED]`. The class itself not being browser-callable is correct design — you do not want the browser constructing a database handle.

`LetsDB` is a module factory assigned to a global name. Nothing outside its own group ever names it `[VERIFIED]`. Its invisibility to the browser is not encapsulation; it is isolation. §2.6 completes this.

**This is the cleanest illustration of why the "0 functions" column in §2.3.1 must be read with care.** Twelve server files show zero reachable functions. Six are constant files, two are data layers, one is config — all appropriate. The remaining three are the subsystem in §2.6.

### 2.5.2 Two tab vocabularies, one collision

| | Tabs declared |
|---|---|
| `SHEET_NAMES` (TRIP, in use) | `Requests`, `Request_Legs`, `Request_Travelers`, `Traveler_Leg_Costs`, `Attachments`, `Approval_Log`, `Travel_Users`, `Travel_User_Roles`, `Test_Submitters`, `Error_Log`, `Feedback`, `File_Queue`, `DoD_Per_Diem`, `DoD_Sync_Log`, `Foreign_Per_Diem`, `DOS_Sync_Tracker` |
| `LETS_CONFIG.sheets` (LETS, unused) | `Budgets`, `Budget_Adjustments`, `Set_Asides`, `Org_Approvers`, **`Requests`**, `Travelers`, `Audit_Log` |

**Both claim a tab named `Requests`** `[VERIFIED]`, and they disagree about what it contains — 42 TRIP columns versus 20 LETS columns, different ID formats, disjoint status vocabularies. This is finding **G-013**.

Today the collision is latent, because nothing calls `LetsDB`. **It becomes live the moment the LETS layer is wired up**, which is why **BD-5** — who owns that decision, and what is the decision — gates all budget-integration work. **VT-06** reads row 1 of the live tab and tells you which schema currently owns the name.

### 2.5.3 The field-name mismatch inside the LETS layer

A separate defect, and it is instructive about how the subsystem was built. `BudgetEngine` reads fields by name from data that `LetsDB` produces — and **every field name mismatches the header `LetsDB` declares** `[VERIFIED]`. The engine fails to zeros rather than to errors, so a budget query returns `$0` balances and `hasSufficientFunds: false` with no indication anything went wrong.

This is **G-040**, and the reason nobody caught it is in §2.6.3: the tests feed the engine objects that bypass `LetsDB` entirely.

---

## §2.6 The detached subsystem

### 2.6.1 The claim, and how it was tested

Four files were written for LETS and form a closed group:

| File | Lines | Internal dependencies |
|---|---|---|
| `40_domain/RequestService.js` | 187 | → `BudgetEngine`, → `LetsDB` `[VERIFIED]` |
| `30_services/BudgetEngine.js` | 354 | none |
| `20_data/LetsDB.js` | 235 | none |
| `30_services/FASTrackerSync.js` | 273 | none |

Finding **G-016** says this group is unreachable. Because that claim decides how this map must be drawn, it was tested two independent ways `[VERIFIED]` — `evidence/pass6_component_map.js` §[5]:

**Test 1 — can a browser call in?** Apps Script exposes only top-level functions to `google.script.run`.

| File | Top-level functions |
|---|---|
| `RequestService.js` | **0** |
| `BudgetEngine.js` | **0** |
| `LetsDB.js` | **0** |
| `FASTrackerSync.js` | **0** |

**Test 2 — does any other server file call in?** Searching all 53 server files for each namespace, with comments stripped first:

| Namespace | Referenced from outside the group |
|---|---|
| `RequestService` | **nothing** |
| `BudgetEngine` | **nothing** |
| `LetsDB` | **nothing** |
| `FASTrackerSync` | **nothing** |

> **Stripping comments matters here, and it is the one place this measurement could have gone wrong.** `Request.js:2` carries a header comment reading *"TravelRequestService.js"*, and `TripConfig.js:139` says *"See 30_services/FASTrackerSync.js"* `[VERIFIED]`. A raw text search would have reported two inbound edges that do not exist, and this document would have drawn the subsystem as connected. The script strips comments before matching and says so in its method notes.

**Verdict: G-016 confirmed on both tests.** Zero inbound edges of either kind.

### 2.6.2 So the map draws it like this

```
   ┌─────────────── the running system ────────────────┐
   │  doGet → Render → client → 412 RPCs → TravelDB    │
   │                                         │          │
   │                                         ▼          │
   │                              the Google Sheet      │
   └────────────────────────────────────────────────────┘

                    ╳  no edge of any kind  ╳

   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
   │   RequestService.js ──▶ BudgetEngine.js            │
   │          │                                         │
   │          └────────────▶ LetsDB.js                  │
   │                                                    │
   │   FASTrackerSync.js      (no edges in or out)      │
   │                                                    │
   │   + 6 client pages and 1 stylesheet, served by     │
   │     nothing, calling 2 RPCs that do not exist      │
   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

**The internal edges are real** — `RequestService` genuinely calls `BudgetEngine` and `LetsDB`. The group is coherent. It simply has no connection to anything that runs.

### 2.6.3 Why the tests pass anyway

This is the part that makes the situation easy to misread, and it is worth understanding before anyone cites test results as evidence of health.

Three Node test suites exist and **all three pass** `[VERIFIED]`:

| Suite | What it proves |
|---|---|
| `test_budget_engine.js` | The budget arithmetic is correct **when given camelCase objects** |
| `test_fas_tracker_env.js` | The FAS environment gate works. **Genuinely valuable** (§2.7.3) |
| `test_gas_module_load.js` | The module factories load under both Node and Apps Script |

**`test_budget_engine.js` passes because it feeds the engine objects built directly from `LETS_CONFIG`, bypassing `LetsDB.sheetDataToObjects()` entirely** `[VERIFIED]`. The one path that is broken — sheet row → object → engine — is the one path no test exercises.

> **Do not treat green tests as evidence the budget layer works.** They prove the arithmetic is right. The arithmetic was never the problem.

### 2.6.4 What this means for scoping

**Three consequences, and the third is the useful one:**

1. **Seventeen findings describe latent defects.** G-013, G-023, G-024, G-035–G-040, G-043, G-050–G-053, G-061, G-062, and G-016 itself all live in code nothing can invoke. Real, but not currently exploitable or triggerable.
2. **Wiring it up activates all seventeen at once.** The collision in §2.5.2, the field mismatch in §2.5.3, the reconciliation defects, the count-based IDs — every one goes live the moment an entry point exists. **Wiring must not be treated as a small task because the modules look finished.**
3. **It is cheaper to fix now than it will ever be again.** No production data in those tabs, no user depending on current behaviour, no migration. **This is the single most useful scheduling fact in the assessment** — and it argues for fixing the seventeen findings *before* wiring, not after.

---

## §2.7 What crosses the system boundary

### 2.7.1 Outbound edges

| Edge | Where | Purpose |
|---|---|---|
| **Google Sheets** | `TravelDB.js`, 59 call sites | The database |
| **Google Drive** | `Attachments.js`, `Database.js` | Attachments, DB backup |
| **Gmail / MailApp** | `Email.js` | 18 notification templates |
| **HC Data Library** | `HCStaffing.js` + 28 references across 9 files | Employee lookup, supervisor chain, **two of three site-gate paths** |
| `api.gsa.gov` | `PerDiemGSA.js`, 4 fetches | CONUS per-diem and mileage |
| `federalregister.gov` | `PerDiemDoD.js`, `DoDSync.js`, 2 fetches | DoD per-diem publication |
| `aoprals.state.gov` | `ForeignSync.js`, 1 fetch | Foreign per-diem |
| **jsDelivr / cdnjs** | 8 client files, 34 references | Bootstrap, FontAwesome, Flatpickr |
| FAS Travel Exception Tracker | `FASTrackerSync.js` | **Unreachable** (§2.6) |

### 2.7.2 The HC library is 23 lines wide and load-bearing

`HCStaffing.js` is the entire interface — one function, `getHCStaffingBundle()`, returning `HC.hcGetBundle()` `[VERIFIED]`. Twenty-eight references across nine files depend on the `HC` namespace it assumes.

**Three facts that together make this the system's most fragile edge** (**G-008**):

1. **Declared in no manifest.** `appsscript.json` has no `libraries` section `[VERIFIED]`. The binding exists only in the live project's configuration — invisible to this repository, invisible to code review, and **it will not survive a rebuild from source**.
2. **Failures are swallowed.** Each HC call in the site gate is wrapped in `try/catch` that warns and continues `[VERIFIED]` `Access.js:423, 434`. Failing closed is right; failing *silently and totally* is the hazard.
3. **`getHCStaffingBundle` is itself unguarded** and returns the full personnel roster to any caller (**G-026**) `[VERIFIED]`.

**And the data crossing this edge is trusted more than it is checked.** The gate tests two fields from each HC record, two lines apart, and they fail in opposite directions `[VERIFIED]` `Access.js:416-418`: `supervisoryStatus` is an **allowlist** (anything but `'2'` denies — so `'02'` or `' 2'` silently locks out a real supervisor), while `occupancyStatus` is a **denylist** (only `VACANT`/`OBLIGATED` deny — so a blank or unrecognised value **grants** access). That asymmetry is **G-074**.

**VT-03** settles whether a library is attached and, critically, **the exact values it emits** — which is the input both the allowlist and the denylist need before either can be corrected.

### 2.7.3 One boundary is exemplary

`resolveFASTrackerTarget` `TripConfig.js:86-127` `[VERIFIED]` refuses to run if a non-production project points at the official FAS tracker, treats an unset environment as non-production, fails closed, cites the NIST controls it implements, and has a dedicated passing test suite.

**It is LETS-original work, and it is the quality bar the rest of the system should be held to.** Worth noting that it guards an integration that does not yet run — the care went in before the feature did.

---

## §2.8 The seams a change is most likely to break

Ordered by how easily a reasonable change breaks something non-obvious.

### 2.8.1 Where the good patterns are

Before the hazards — **three places to copy rather than rewrite** `[VERIFIED]`:

| Component | Pattern worth copying |
|---|---|
| `Users.js` | **All 8 role-CRUD RPCs guarded**, consistently, via one shim over one function |
| `Reporting.js` | **All 9 entry points guarded.** Same pattern |
| `Admin_Actions.js` | Writes `Approval_Log` rows with the real admin identity and the before/after status. **The auditing model the rest of the system should follow** |
| `Review_Action.js` | The 12-action state machine — the one place both identity *and* state are enforced |

### 2.8.2 The hazards

| # | Seam | What breaks | Why it is non-obvious |
|---|---|---|---|
| **1** | **Spreadsheet column order** | 18 order-dependent access points, 8 of them positional write arrays (**G-014**) | **No error.** New rows are silently misfiled while old rows stay correct |
| **2** | **Renaming a trigger handler** | Five handlers are referenced by name as text in `ScriptApp.newTrigger()` `[VERIFIED]` | The schedule survives, pointing at a function that no longer exists. Per-diem data goes stale with no error |
| **3** | **Renaming a server function** | 61 are called by name from client files `[VERIFIED]` | The call fails at runtime in the browser, not at build time |
| **4** | **Renaming a client partial** | 4 include edges are already broken by exactly this (**G-017**) | A missing include throws at render or silently omits a feature |
| **5** | **Adding a Google API call** | No `oauthScopes` are declared (**G-006**), so the consent scope set widens silently `[VERIFIED]` | Users may be re-prompted, or granted more than intended, with no code review signal |
| **6** | **Pushing a `.js` file to Apps Script** | All pushed `.js` share one global scope; a stray `require()` throws and takes down `doGet` | `.claspignore` lists test files explicitly and CI enforces it — **this hazard is already handled** `[VERIFIED]` |
| **7** | **Editing `Access.js`** | It has a backward edge into `Users.js` and can trigger a production write (**G-027**) | A reader expecting a read-only access layer would not predict a sheet write |
| **8** | **Changing a status string** | Statuses appear as literals in client code as well as `Status.js` | A string changed in one place leaves the other silently mismatched |

### 2.8.3 The three duplication hotspots

Places where one fact is stated in more than one file, so a change must be made in all of them `[VERIFIED]`:

| Fact | Lives in | Finding |
|---|---|---|
| The Tier-1 travel purpose list | `TripConfig.js`, a client array, and an `<option>` list — **three places** | **G-054** |
| Per-diem tab names | `SHEET_NAMES` **and** 6 duplicate constants in four per-diem modules | **G-042** |
| Fiscal quarter derivation | Two implementations, one mislabelled | **G-049** |

---

## §2.9 Where to go next

| You want | Read |
|---|---|
| Who controls the system and how to administer it | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) |
| What every tab and column means | `DATA_DICTIONARY.md` (Deliverable 3) |
| The complete business rules and state machine | `WORKFLOW_AND_BUSINESS_RULES.md` (Deliverable 4) |
| Deployment, environments, configuration | `DEPLOYMENT_AND_ENVIRONMENTS.md` (Deliverable 5) |
| The ranked findings with evidence | `GAP_REGISTER.md` (Deliverable 6) |
| How to scope a change safely | `ENHANCEMENT_PLAYBOOK.md` (Deliverable 7) — §2.8 is its starting point |
| The evidence behind every number here | [`GAP_CONSOLIDATION_PASS6.md`](./GAP_CONSOLIDATION_PASS6.md) and `docs/evidence/` |

### Reproducing this document's figures

```sh
cd docs/evidence && node pass6_component_map.js
```

That script prints every count in this document, including the two-way reachability test behind §2.6. Run the whole suite with:

```sh
cd docs/evidence && for f in *.js; do echo "== $f"; node "$f"; done
```

---

*End of Deliverable 2. The structural claim this document rests on — that the LETS subsystem has zero inbound edges — is tested mechanically in two directions and would be visibly contradicted by its own evidence script if it were wrong.*
