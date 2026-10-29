---
title: "LETS Enhancement Playbook"
description: "How to change this system without breaking it — recipes, prohibitions, and a verification step for each"
status: canonical
tier: 1
audience: "developer making a change, whether or not they have read the other nine documents"
last_updated: "2026-10-28"
evidence_base: "docs/evidence/pass6_change_impact.js"
---

# LETS Enhancement Playbook

**Deliverable 7 of 10.** Written for a developer who has **not** read the other nine documents.

---

## How to read this document

This is the only deliverable that tells you to *do* something. Everything else describes the system; this one changes it.

**Read §7.1 and §7.2 before any change, however small.** They are four pages and they cover the five ways this codebase breaks silently. Then find your change in §7.3–§7.8.

Every recipe has the same shape:

| Part | Why it is there |
|---|---|
| **Blocked?** | Some changes wait on a business decision. Stated **first**, before the instructions, so you do not estimate work that is not actionable |
| **Blast radius** | What else this touches, measured — not guessed |
| **Preconditions** | What must be true before you start |
| **Steps** | The change itself |
| **Verification** | A named script and an **expected numeric delta.** A recipe without one is a suggestion |

Findings are cited as `G-NNN` and resolve in [`GAP_REGISTER.md`](./GAP_REGISTER.md). Verification tasks are `VT-NN`, decisions are `BD-N`.

Every number here is produced by [`evidence/pass6_change_impact.js`](./evidence/pass6_change_impact.js).

---

## §7.0 The one thing to understand first

**In this codebase, things are connected by string, not by reference.** `[VERIFIED]`

| Coupling | Count | Breaks |
|---|---|---|
| Server functions called by name from client HTML | **61** | at run time, in the browser |
| Trigger handlers referenced by `ScriptApp` as a string | **5** | **silently — the schedule survives, the work stops** |
| Client partials included by path string | 4 **already broken** | at render, or by silently omitting a feature |
| Sheet columns written by **position**, read by **name** | 538 name lookups | **silently — new rows are misfiled, old rows stay correct** |

**A compiler would catch none of this.** There is no build step, no type checker, and no module system — every pushed `.js` file lands in one shared global scope `[VERIFIED]`.

So the governing rule of this playbook is: **before you rename or reorder anything, measure what points at it.** §7.2 is the list of things that cannot be renamed, and `pass6_change_impact.js` §[1] computes the radius for any function you name.

---

## §7.1 Five rules for every change

### Rule 1 — Let CI deploy

Merge to `main`. The pipeline runs `clasp push --force` and four regression guards `[VERIFIED]`.

**Do not push locally.** A local `clasp push` bypasses the review gate and all four guards.

> **And never run `clasp push` from the repository root.** An untracked `.clasp.json` there has `rootDir: ""` and `skipSubdirectories: false`, so a push from that directory carries **224 files** into an undocumented Apps Script project — including 94 files from `reference_travel_app/`, which is another organisation's application (**G-048**) `[VERIFIED]`.

### Rule 2 — `clasp push` is not `clasp deploy`

The pipeline replaces the project's **code**. It never runs `clasp deploy` `[VERIFIED]`.

**Whether your merge reaches users is `[UNKNOWN]`** — it depends on whether the active deployment tracks the head version or a pinned one, which nobody has recorded. **VT-01** settles it in two minutes. Until then, do not assume your change is live because CI went green.

### Rule 3 — Any new top-level function is a public API

Google exposes **every** top-level function to `google.script.run`. There are 459, and **412 are reachable from any authenticated browser** `[VERIFIED]`.

| Naming | Effect |
|---|---|
| `function foo()` | **Callable by anyone who can reach the web app** |
| `function _foo()` | **Also callable.** A leading underscore confers nothing — 118 functions are named this way `[VERIFIED]` |
| `function foo_()` | **Private to the platform.** Only a *trailing* underscore works |

**So: give every new helper a trailing underscore unless the browser must call it.** If the browser must call it, it needs a guard — see §7.7.1.

### Rule 4 — Adding a Google API call silently widens permissions

The manifest declares **zero `oauthScopes`** `[VERIFIED]`, so the consent scope set is **inferred from the APIs your code calls** (**G-006**, Critical).

Calling a new Google service widens what the application can do to every user's account, with **no code-review signal that anything changed**. Users may be silently re-prompted for consent.

**If your change adds a Google service call, read §7.5.1 first.**

### Rule 5 — Append columns; never insert, reorder, delete, or rename

The code reads flexibly by header name and **writes rigidly by position** `[VERIFIED]`. Full detail in §7.2.3.

---

## §7.2 Things you must not do

**Each entry fails silently.** That is the reason this section exists rather than being left to judgement.

### 7.2.1 Never rename a trigger handler

Five functions are referenced by `ScriptApp.newTrigger('name')` as a **string** `[VERIFIED]`:

| Handler | Defined at | Schedule |
|---|---|---|
| `refreshHCStaffingCache` | `server/99_triggers/CacheWarming.js:33` | every 10 min |
| `warmTravelDBCache` | `server/99_triggers/CacheWarming.js:95` | every 5 min |
| `warmGSACitiesCache` | `server/99_triggers/CacheWarming.js:162` | every 6 hours |
| `syncDoDPerDiem` | `server/91_setup/DoDSync.js:548` | daily 06:00 |
| `syncForeignPerDiem` | `server/91_setup/ForeignSync.js:187` | daily 06:00 |

**Renaming any of these leaves the installed trigger pointing at a function that no longer exists.** The schedule survives. The work stops. **Nothing reports an error** — per-diem rates simply go stale.

> **This constrains §7.4 directly**, because that recipe renames functions to take them off the browser surface. These five are excluded, and `pass6_write_surface_census.js` already reports them separately so the exclusion is not left to memory.

### 7.2.2 Never rename a function the client calls

**61 server functions are invoked by name from client HTML** `[VERIFIED]`. The highest-coupled:

| Function | Client call sites |
|---|---|
| `submitReviewAction` | 5 |
| `listTravelUsers` | 5 |
| `calculatePerDiem` | 3 |
| `checkTravelAdminAccess`, `deleteTravelDraftFile`, `getAllDoDPerDiemData`, `getAllForeignPerDiemData`, `getAdminDashboard`, `updateTravelUser`, `getScriptUrl` | 2 each |

**Check before you rename:** `node docs/evidence/pass6_change_impact.js` §[1] lists every coupled function with its radius.

**Three names are already broken this way** — the client calls `apiGetInitialData`, `apiSubmitRequest`, and `getAllForeignCountries`, and **none exists** `[VERIFIED]` (**G-015**, and an inherited TRIP defect for the third).

### 7.2.3 Never insert, reorder, delete, or rename a spreadsheet column

**This is the most dangerous routine action available and it produces no error.** `[VERIFIED]`

| | |
|---|---|
| Reads | By header name — **538 lookups**, which move correctly if a column moves |
| Writes | **By position** — a literal array whose *n*th value lands in the *n*th column |

Five tabs have positional writers `[VERIFIED]`: `Requests` (42 cols), `Attachments` (11), `Approval_Log` (14), `Test_Submitters` (6), `Error_Log` (6).

**What happens if you insert a column in the middle:**

| | |
|---|---|
| Every write **after** the change | Values land in the wrong columns |
| Existing rows | **Untouched — still correct** |
| User-visible error | **None** |
| What you get | A tab where older rows are right and newer rows are wrong, with no marker between them |
| How you would notice | A reviewer seeing nonsense, days or weeks later |

**The safe change:** append at the **far right**, and add the column to `TRAVEL_SHEET_SCHEMAS` in the **same commit**. §7.5.5 is the recipe.

**One complication:** the application itself adds three columns to `Requests` at runtime the first time a Division Director reports a funding issue (**G-044**) `[VERIFIED]`. So a live tab wider than the schema is not necessarily evidence of tampering.

### 7.2.4 Never rename a client partial

A page is assembled server-side from partials referenced by path string. **Four include edges and one template reference are already broken by exactly this mistake** (**G-017**) `[VERIFIED]` — three files are named `*.html.html` and one reference is a typo.

### 7.2.5 Never add a `pull_request` trigger to the deploy workflow

Opening a PR would *become* the deploy, defeating review entirely. **A CI guard fails the build if this reappears** `[VERIFIED]`, and the workflow file documents the reasoning with its NIST control references. Leave both alone.

---

## §7.3 Recipe 1 — Adopt the two existing per-request guards

**This is the highest-value change available in the system.** It closes two of the six Critical findings using code that already exists.

### 7.3.1 Blocked — read this before planning the work

> ### ⛔ BLOCKED ON BD-3
>
> **The decision:** in a `NEEDS_INFO_*` state, should the assigned reviewer retain edit access?
>
> **Why it blocks:** `requireRequestEditor` **already implements an answer.** Its code reads `[VERIFIED]` `Access.js:1409-1413`:
>
> > *"NEEDS_INFO_* states: the workflow says 'the ball is with the submitter.' Reviewers wait for the resubmit — they don't share edit access during this window. Avoids racey co-editing where the assigned reviewer and the submitter both touch the same fields."*
>
> **So adopting the guard changes behaviour**, not just enforcement. Today a reviewer can edit during `NEEDS_INFO_*` because nothing stops them. After adoption they cannot.
>
> **That may be exactly right** — the reasoning in the comment is sound. But it is a workflow policy change and it needs an owner's assent, not a developer's.
>
> **Do not skip this and adopt the guard anyway.** If the business wants reviewers to retain that access, the guard needs a one-line change *before* adoption, not a rollback after a reviewer complains.

### 7.3.2 What already exists

| | |
|---|---|
| `requireRequestViewer(requestId, db)` | `server/30_services/Access.js:1325` — **0 call sites** `[VERIFIED]` |
| `requireRequestEditor(requestId, db)` | `server/30_services/Access.js:1384` — **0 call sites** `[VERIFIED]` |

Both are complete. Both throw on denial. Both return `{ email, ctx, request }` so the caller can reuse the loaded data without a second read `[VERIFIED]`.

**`requireRequestViewer` allows:** the submitter; the currently-assigned reviewer; any admin; any reviewer whose scope covers the request; **and any Division Director assigned to a traveller on it** `[VERIFIED]`. That last clause matters — a naive guard would have locked DDs out.

**`requireRequestEditor` additionally enforces** that the status is in `REQUEST_EDITABLE_STATUSES` — the eight pre-decision states `[VERIFIED]`. Terminal and DD-pending requests are immutable through this gate regardless of role.

### 7.3.3 The precondition nobody would predict

**One client call site swallows server errors silently, and it must be fixed first.** `[VERIFIED]`

Every client call site for the affected RPCs has both a failure handler and a `try/catch` — twelve of twelve `[VERIFIED]`. Eleven surface `error.message` to the user. **One does not:**

```javascript
// client/controllers/review/travelReviewController.html:3335
} catch (error) {
  console.warn('Failed to save updated costs:', error);
  // Don't show error toast - the costs are already updated in the UI
}
```

**Why this is a precondition and not a follow-up.** Add a throwing guard to `updateTravelerCosts` and the denial reaches that `catch`, where it is logged to a console nobody is watching. **The UI keeps the edit on screen while the server refused it** — the user believes a cost was saved that was not. That is worse than the unguarded behaviour it replaces.

**Fix it first.** It is one line:

```javascript
} catch (error) {
  console.warn('Failed to save updated costs:', error);
  this._showToast('Failed to save costs: ' + error.message, 'error');
}
```

### 7.3.4 The surface to change

**Nine EDIT-gate candidates** `[VERIFIED]` — `pass6_change_impact.js` §[2]:

| Function | Lines | Guard today | Returns |
|---|---|---|---|
| `updateRequestOverview` | 201 | record-level, inline | `errorResponse` |
| `updateRequestClassification` | 157 | record-level, inline | `errorResponse` |
| `updateRequestItinerary` | 405 | **none** | `errorResponse` |
| `updateTravelersForReview` | 278 | **none** | `errorResponse` |
| `updateCostsForReview` | 954 | **none** | `errorResponse` |
| `updateSharedCostsForReview` | 163 | **none** | `errorResponse` |
| `updateTravelerCosts` | 157 | **none** | **throws** |
| `reportDDFundingIssue` | 185 | record-level, inline | `errorResponse` |
| `submitFundingCorrection` | 146 | record-level, inline | `errorResponse` |

**Three VIEW-gate candidates:** `getRequestForReview` (367 lines, record-level inline), `getRequestAttachments` (48 lines, **none**), `getDDConfirmationData` (67 lines, record-level inline).

### 7.3.5 The contract mismatch, and how to handle it

**The guards throw. Eight of the nine functions return `errorResponse()`.** Those are different contracts.

**Do not change the functions' return contract.** Wrap the guard instead, so a denial becomes the `errorResponse` the client already understands:

```javascript
function updateRequestItinerary(requestId, updatedLegs, removedLegIds, confirmedDateShifts) {
  try {
    if (!requestId) return errorResponse('Request ID is required');

    // --- ADD: one line, plus reuse of what it returns ---
    var gate;
    try {
      gate = requireRequestEditor(requestId);
    } catch (e) {
      return errorResponse(e.message);      // keeps the existing contract
    }
    // `gate.request` and `gate.ctx` are now available — no second sheet read
    // ... existing body, unchanged ...
```

**Four reasons to do it this way rather than letting the guard throw:**

1. **The client contract is unchanged.** Eleven of twelve call sites already display `result.error`.
2. **The denial message is the guard's own**, which is specific — *"Cannot edit request in status: COMPLETED"* rather than a generic failure.
3. **`gate.request` replaces a sheet read** the function was doing anyway, so adoption can be net-neutral on quota.
4. **`updateTravelerCosts` already throws**, so it needs no wrapper — adopt the guard bare there, *after* §7.3.3.

### 7.3.6 Steps

1. **Get BD-3 answered.** Stop here until it is.
2. **Fix the swallowing call site** (§7.3.3). One line.
3. **Adopt `requireRequestEditor` in the four fully-unguarded functions first** — `updateRequestItinerary`, `updateTravelersForReview`, `updateCostsForReview`, `updateSharedCostsForReview`. These are pure gain: they have no check at all today.
4. **Adopt it in `updateTravelerCosts`** bare, no wrapper.
5. **Adopt it in the four record-level functions**, and **delete the inline check it replaces.** Two of them carry a duplicate copy of the editable-status list `[VERIFIED]` `Review_Update.js:89, 269` — deleting those is the point, since `REQUEST_EDITABLE_STATUSES` in `Access.js:1202` is the single source.
6. **Adopt `requireRequestViewer` in the three readers**, `getRequestAttachments` first — it has no check and returns Drive file IDs.
7. **Do not touch `submitReviewAction`.** It already enforces both identity and state correctly (§7.7.1) and is the pattern the rest should match.

### 7.3.7 Verification

```sh
node docs/evidence/pass6_change_impact.js      # §[2]
node docs/evidence/pass5_guard_census.js
```

| Measure | Before | Expected after |
|---|---|---|
| Per-request guard call sites | **0** | **12** |
| `requireRequestEditor` adoption | 0 | 9 |
| `requireRequestViewer` adoption | 0 | 3 |
| Duplicate `editableStatuses` arrays in `Review_Update.js` | 2 | **0** |
| Client sites that swallow a server error silently | **1** | **0** |

**Then test by hand**, because a guard that denies the wrong people is worse than none:

| Test | Expected |
|---|---|
| Submitter edits own request in `PENDING_BU` | allowed |
| Assigned reviewer edits it | allowed |
| Unrelated user edits it | **denied, with a visible message** |
| Anyone edits a `COMPLETED` request | **denied** — *"Cannot edit request in status: COMPLETED"* |
| A DD opens a request they are on | **allowed** — this is the clause a naive guard would break |

---

## §7.4 Recipe 2 — Shrink the browser-reachable surface

**This addresses G-001, the top-ranked finding.** 412 functions are reachable from any authenticated browser and **51 of them write with no authorization check** `[VERIFIED]`.

### 7.4.1 Not blocked, and the cheapest half is mechanical

**No business decision gates this.** Giving an internal helper a trailing underscore is not a behaviour change — it removes a capability nobody was supposed to have.

### 7.4.2 The 51 split three ways

Of the 51 direct unguarded writers `[VERIFIED]`:

| Group | Count | What to do |
|---|---|---|
| **Safe to rename** — no client call site, not a trigger | **38** | Add a trailing underscore. §7.4.3 |
| …of those, already named `_foo` | **7** | **A one-character change each** |
| **Client-called** — cannot be renamed | **13** | Needs a guard, not a rename. §7.4.4 |
| **Trigger handlers** | 0 of the 51 | Excluded by §7.2.1 anyway |

**Start with the 7.** `_bulkDeleteSmokeRequests` → `_bulkDeleteSmokeRequests_` is one character and takes a cascade-delete function off the public surface.

### 7.4.3 Steps for the rename group

1. **Confirm the function has no client call site.** `node docs/evidence/pass6_change_impact.js` §[1] lists all 61 that do. If yours is there, go to §7.4.4 instead.
2. **Confirm it is not one of the five trigger handlers** (§7.2.1).
3. **Append a trailing underscore to the declaration.**
4. **Update every server-side caller.** They are ordinary function calls, so a project-wide search finds them — but note Apps Script has no build step, **so a missed caller fails at run time, not now.**
5. **Run the suites.** `test_gas_module_load.js` loads the server tree the way Apps Script does and will catch a broken reference at file-load time `[VERIFIED]`.

> **Do this in small batches and verify each.** There is no compiler. A batch of 38 renames with one typo is harder to diagnose than six batches of six.

### 7.4.4 The 13 that cannot be renamed

These are the functions a real user must reach: `submitTravelRequestV2`, the five `update*` RPCs, `reportDDFundingIssue`, `submitFundingCorrection`, `uploadTravelDraftFile`, `deleteTravelDraftFile`, `uploadNFSDraftFile`, `submitTravelFeedback`, and the NPS pair `[VERIFIED]`.

**Renaming them breaks the application.** They need a guard:

| Function | Recipe |
|---|---|
| The five `update*` RPCs, `reportDDFundingIssue`, `submitFundingCorrection` | **§7.3** — `requireRequestEditor` |
| `uploadTravelDraftFile`, `deleteTravelDraftFile`, `uploadNFSDraftFile` | **§7.5.3** — these are **G-005**, Critical: `deleteTravelDraftFile` trashes any Drive file ID with no ownership check |
| `submitTravelRequestV2` | Submission is legitimately open to any authenticated user. **Leave it** — the finding is not that it is callable but that it writes five tabs without a transaction (**G-012**) |
| `submitTravelFeedback`, `checkNpsEligibility`, `dismissNpsPrompt` | Low risk. Worth rate-limiting rather than guarding |

### 7.4.5 Verification

```sh
node docs/evidence/pass5_guard_census.js
node docs/evidence/pass6_write_surface_census.js
```

| Measure | Before | After renaming all 38 |
|---|---|---|
| Top-level server functions | 459 | 459 (unchanged — renames, not deletions) |
| **Browser-reachable** | **412** | **374** |
| Direct unguarded writers | **51** | **13** |
| Trigger handlers renamed | — | **must be 0** |

**If the trigger-handler count is anything but zero, stop and revert.** That is the silent-failure case in §7.2.1.

---

## §7.5 Six more recipes

### 7.5.1 Declare `oauthScopes` — closes G-006 (Critical)

**Blocked?** No. **Blast radius:** every user's consent screen.

The manifest declares no scopes, so the grant is inferred from code and **includes full Drive** `[VERIFIED]`. Nobody chose it, and it widens whenever a new Google service is called.

**Steps:**

1. **Run VT-10 first** — capture the *actual* consent scope list from the linked GCP project. **Do not guess the current set**; declaring a narrower set than production uses breaks the application for every user at once.
2. Add an `oauthScopes` array to `lets_app/appsscript.json` listing exactly what VT-10 found.
3. **Remove the unused `Gmail v1` advanced service** while you are there — `Gmail.` appears **0 times** in `server/` `[VERIFIED]` (**G-064**). It widens the inferred set for nothing.
4. **Test with a fresh account** that has never consented. Existing users will not re-prompt; a new user will, and that is the only way to see what the declaration produces.

**Verification:** `node docs/evidence/pass6_deployment_census.js` §[2] — `oauthScopes declared` should move from **0** to your count, and `Gmail references in server/: 0 <- DECLARED AND UNUSED` should disappear.

> **Narrow deliberately but not aggressively.** Going from an inferred broad grant to a declared broad grant is already a large win: the scope set becomes **reviewable**, and widening it becomes a visible diff. Narrowing it is a second, separate change.

### 7.5.2 Fix the false FAS-sync notice — closes G-022

**Blocked?** No. **Blast radius:** one string. **This is the cheapest high-value fix in the register.**

The intake form tells users their request *"will automatically synchronize with the official FAS Travel Exception Tracker Google Sheet"* `[VERIFIED]` `client/pages/travelRequestPage.html:903`. **No synchronization occurs** — `submitToFASTracker` has no caller.

**So the running system makes a compliance representation to users that is not true.**

**Steps:** change the wording to state what actually happens — that the request requires FAS Chief of Staff approval and that tracker filing is handled separately. **Do not** describe a sync that does not run.

**Verification:** read the rendered page. Then `grep -n "automatically synchronize" lets_app/client/pages/travelRequestPage.html` → expect no match.

**Related, same session:** the budget dashboard badge reading *"Mandatory Budget Check Enabled"* `letsRequestPage.html:4` is the same class of false claim (**G-015**). The page is unreachable, so it is lower priority — but if you are fixing one, fix both.

### 7.5.3 Add an ownership check to the Drive file operations — closes G-005 (Critical)

**Blocked?** No. **Blast radius:** 3 client-called functions.

`deleteTravelDraftFile` **trashes any Drive file ID handed to it, with no ownership check** `[VERIFIED]`. `uploadTravelDraftFile` has no size or MIME limit.

**Steps:**

1. Before trashing, confirm the file ID appears in the `Attachments` tab **for a request the caller may edit** — which is exactly what `requireRequestEditor` establishes (§7.3). The two recipes compose.
2. For a draft file not yet attached to a request, confirm the caller is the uploader — `Attachments.Uploaded_By` records it `[VERIFIED]`.
3. Add a size cap and a MIME allowlist to the upload path. **`Validation.js` already has 12 validators and zero adopters outside its own self-test** (**G-033**) `[VERIFIED]` — use them rather than writing new ones:

   `requireString` · `requireNumber` · `requireNonNegativeNumber` · `requirePositiveNumber` · `requireBoolean` · `requireArray` · `requireNonEmptyArray` · `requireEnum` · `requireObject` · **`requireRequestId`** · **`requireEmail`** · `requireDateString`

   **`requireRequestId` and `requireEmail` are the two every recipe in this playbook could use**, and an ad-hoc `_isValidEmail` helper has 21 call sites while `requireEmail` has none `[VERIFIED]`.

**Verification:** attempt `deleteTravelDraftFile` with a Drive file ID belonging to another user's request. Expect a denial. Today it succeeds.

### 7.5.4 Add a server-side last-admin check — closes G-007 (High)

**Blocked?** No. **Blast radius:** 2 functions.

`deleteRole` and `setRoleActive` will remove the final active `admin`, **locking the console for everyone** `[VERIFIED]`. The protection exists — a thorough check with a blocking dialog — but it is **browser JavaScript only**, and it lives in `travelUsersController.html.html`, the file **G-017** prevents from loading at all.

**So the only guard against locking out all administrators is in a file that never loads.**

**Steps:** in both functions, before the write, count active `admin` rows. If the change would leave zero, throw. Both functions already call `requireTravelAdmin()` `[VERIFIED]`, so the pattern is consistent with the file.

**Verification:** with exactly two admins, deactivate one (expect success), then the other (expect a refusal). **Do this in the sandbox**, and read §7.9 first.

### 7.5.5 Add a spreadsheet column — the only safe schema change

**Blocked?** No. **Blast radius:** the tab, plus every positional writer on it.

**Steps, in this order:**

1. **Run VT-08** — read row 1 of the target tab and confirm it matches `TRAVEL_SHEET_SCHEMAS`. If it does not, stop: the drift is a bigger problem than your change.
2. **Append the column at the far right.** Never insert (§7.2.3).
3. **Add it to the end of the schema array** in `server/01_constants/Sheets.js`, same commit.
4. **Extend every positional writer for that tab** to supply the new value. `pass6_schema_census.js` §[3] lists them with their element counts.
5. **Read by header name**, never by index.

**Verification:** `node docs/evidence/pass6_schema_census.js` §[3].

| Measure | Expected |
|---|---|
| Positional writes **exceeding** their schema | **0** — any non-zero is a real corruption bug |
| Writes with a trailing omission | may increase by 1 per writer you did not extend — **check each is deliberate** |

> **A trailing omission is safe but rarely what you want.** `appendRow` leaves later columns blank, so a writer you forgot to extend produces silently empty cells rather than an error. The script names exactly which columns each writer leaves blank, which is how **the `Approval_Log.Version_Before`/`Version_After` audit gap was found** — four admin-path writers never populate them while ten workflow writers do.

### 7.5.6 Fix the broken file references — closes G-017 (High)

**Blocked?** No, but it has a hard precondition.

Three files are named `*.html.html` and one reference is a typo `[VERIFIED]`:

| The reference says | The file is actually named |
|---|---|
| `client/controllers/admin/travelUsersController` | `travelUsersController.html.html` |
| `client/components/flatpickrConfig` | `flatpickrConfig.html.html` |
| `client/pages/travelReviewerDashboardPage` | `travelReviewerDashboardPage.html.html` |
| `client/styles/travelUsersStyles` | `travelUserStyles.html` — **a typo, singular** |

> **Precondition: run VT-20 first.** Confirm the *live* Apps Script project has the same wrong filenames. **If the deployed project has correct names, renaming in the repository would break what currently works.**

**Steps:** three `git mv` commands removing the doubled extension, and one typo correction in `travelAdminPage.html:30`.

**Why this matters more than it looks:** the broken `travelUsersController` means **the admin console's Users tab has no controller** — and §7.5.4's only existing last-admin protection lives inside it.

**Verification:** `node docs/evidence/pass6_component_map.js` §[4].

| Measure | Before | After |
|---|---|---|
| Broken `include()` edges | **4** | **0** |
| Broken template references | **1** | **0** |

Then load `?mode=reviewer-dashboard` as a non-admin reviewer. Today it throws.

---

## §7.6 Wiring the budget layer — read this before starting

**This is the largest piece of work in the system, and the order matters more than the work.**

### 7.6.1 What exists and why nothing reaches it

Four LETS-original modules — `RequestService.js`, `BudgetEngine.js`, `LetsDB.js`, `FASTrackerSync.js` — are complete, coherent, and **structurally unreachable** `[VERIFIED]`:

| Test | Result |
|---|---|
| Top-level functions exposed (what the browser can call) | **0** across all four |
| Inbound references from any other server file | **0** |

This is **G-016**, and it is confirmed two independent ways by `pass6_component_map.js` §[5].

### 7.6.2 The seventeen findings that go live the moment you wire it

G-013, G-016, G-023, G-024, G-035, G-036, G-037, G-038, G-039, G-040, G-043, G-050, G-051, G-052, G-053, G-061, G-062 `[VERIFIED]`.

**Four of them would cause financial misstatement:**

| Finding | What happens |
|---|---|
| **G-040** | **Every office reports a $0 budget and the gatekeeper rejects every request as unfunded.** Not one declared column header matches any property the engine reads — zero overlap, measured |
| **G-035** | `RECONCILED` with blank actuals **silently frees the entire commitment** |
| **G-036** | `reconcileRequest` **overwrites the approved estimate**, destroying the variance basis |
| **G-051** | No cost validation — a **negative** estimate *increases* the apparent budget |

**And two claimed controls do not exist:** `updateRequestStatus` documents *"role and permission checks"* and has none; `reconcileRequest` accepts reconciliation from any status, including `Submitted` `[VERIFIED]`.

### 7.6.3 The order

> **Fix the seventeen findings BEFORE wiring, not after.**
>
> There is no production data in the budget tabs, no user depending on current behaviour, and no migration. **These are the cheapest fixes available in the entire system and they will never be cheaper.** Wiring first means debugging a financial engine against live data while users submit against it.

| Phase | Work | Gate |
|---|---|---|
| **0** | **Answer BD-4** — which cost figure is authoritative, System A's `Grand_Total` or a user-entered estimate? | **Nothing starts until this lands.** It is the largest unresolved design question in the system, and the two layers currently assume different answers |
| **0** | **Answer BD-5** — who owns the `Requests` tab-name collision, and what is the decision? | Two schemas claim that exact tab name: 42 TRIP columns vs 20 LETS columns, different ID formats, disjoint status vocabularies |
| 1 | Fix G-040 — add a mapping layer in `LetsDB` translating header text to the engine's property names | A regression test that round-trips through `sheetDataToObjects`, or the defect returns |
| 2 | Fix G-035, G-036, G-051, G-052 — the reconciliation and validation defects | `pass4_budget_engine_edge_cases.js` |
| 3 | Fix G-037, G-038 — count-based IDs and the missing state machine | `pass4_request_service_edge_cases.js` |
| 4 | Resolve the tab collision per BD-5 | — |
| 5 | **Only now**, add the entry points: `loadLetsState()`, the two missing `api*` functions, and a call to `evaluateBudgetCheck` in the submission path | §7.3's guards apply to anything new and browser-reachable |
| 6 | Wire the six discarded intake fields and add their columns per §7.5.5 | `pass6_schema_census.js` |

### 7.6.4 The thing most likely to be underestimated

**The two systems model cost incompatibly** `[VERIFIED]`. System A derives per-traveller, per-leg costs from authoritative per-diem rates and stores a `Grand_Total`. System B expects a single `totalEstimatedCost` supplied to it.

**That is not a mapping exercise — it is BD-4.** Picking one without a decision hard-codes an answer to a question nobody asked.

### 7.6.5 One precondition that is easy to miss

**`requireRole()` silently grants access for any unrecognized role name** — there is no `default: throw` `[VERIFIED]` (**G-030**, rated C4).

It is latent *only* because every current role name is recognized. **If wiring the budget layer introduces a new role, a C4 defect becomes live.** Add the `default: throw` **before** adding any role, not after.

---

## §7.7 Patterns to copy

**Do not invent a pattern this codebase already has.** Four exist and are correct.

### 7.7.1 Authorization — copy `submitReviewAction`

`server/40_domain/Review_Action.js` is **the one place in the system where authorization is done properly end to end** `[VERIFIED]`. It enforces five rules, each with a `throw`:

| Line | Check |
|---|---|
| `:79` | Admins bypass the identity checks |
| `:82` | For `resubmit` / `submitter_cancel`, the caller **must be** the submitter |
| `:87` | For every other action, the caller **must be** `Current_Reviewer_Email` |
| `:94` | The action must be **legal from the current status** |
| `:100` | Comments are mandatory where the action requires them |

**Both identity and state.** Most of the system checks neither; a few check identity only. This is the shape to copy.

**And note what it does not do:** it does not consult a role to decide whether you may act on *this* request. It compares your email to the field on the record. That is why `requireRequestEditor` (§7.3) is the right complement rather than a replacement.

### 7.7.2 Guarding a whole file — copy `Users.js` or `Reporting.js`

| File | Pattern |
|---|---|
| `server/40_domain/Users.js` | **All 8 role-CRUD RPCs guarded**, consistently, through one shim over one function |
| `server/40_domain/Reporting.js` | **All 9 entry points guarded.** Same pattern |

**31 functions in the whole project sit behind a throwing guard, and 28 of them are in `40_domain`** `[VERIFIED]`. Seven of the ten server layers have **zero**. The concentration is the point: authorization here is not thin everywhere, it is **complete in a few files and absent elsewhere**. Copy the complete ones.

### 7.7.3 Auditing a change — copy `Admin_Actions.js`

`server/40_domain/Admin_Actions.js:68` writes an `Approval_Log` row with the real admin's identity and the before/after status `[VERIFIED]`. **That is the model.**

**Two traps to avoid when you copy it:**

1. **Do not hardcode `Action_By_Role`.** Six write sites in `Review_Update.js` write the literal `'Submitter'` regardless of who called `[VERIFIED]`. The email column beside it is real; the role column is an assertion.
2. **Populate `Version_Before` and `Version_After`.** Ten workflow writers do; **four admin-path writers leave them blank** `[VERIFIED]` — so the audit trail carries before/after versions for ordinary reviewer actions and omits them precisely where the actor held the most authority.

### 7.7.4 An environment gate — copy `resolveFASTrackerTarget`

`server/00_config/TripConfig.js:86-127` `[VERIFIED]`. **Fail-closed in every direction**, with the reasoning in the file:

> *"This gate is FAIL-CLOSED. An unset or unrecognized LETS_ENV resolves to 'development', so a newly created or misconfigured project can never reach the official tracker. Production must be opted into explicitly."*

It cites its NIST controls, computes the resolved target once at module load so consumers cannot bypass it, and has a dedicated passing test suite. **It is the quality bar for the rest of the system**, and it is LETS-original work.

### 7.7.5 The anti-pattern: a guard that does not refuse

**A check that does not `throw` is not a guard.** Three examples in this codebase, each a finding:

| Anti-pattern | Finding |
|---|---|
| `getRequestForReview` computes permission flags, then **returns the record regardless** | **G-004**, Critical |
| `requireRole()` has **no `default: throw`** — an unrecognized role name silently grants | **G-030**, C4 |
| The client-paid override's guard clause returns `false` on degraded data, which means **skip FAS review** | **G-069**, High |

**G-069 is worth understanding before you write any defaulting logic.** The same function gets it right one line and wrong the next: the *per-row* default treats a blank cell as overhead and fails **closed**; the *collection-level* guard clause fails **open** `[VERIFIED]`. **When you write a default, state which way it fails and why.**

---

## §7.8 Verification protocol by change class

**A change without a measurable expected delta is a suggestion.** Find your change class, run the script, compare.

| If you changed… | Run | Expect |
|---|---|---|
| **Guards or function visibility** | `pass5_guard_census.js`, `pass6_write_surface_census.js` | reachable count **down**, guarded count **up**, trigger handlers renamed **= 0** |
| **A sheet schema or a positional writer** | `pass6_schema_census.js` | over-wide writes **= 0**; check every new trailing omission is deliberate |
| **A workflow rule or status** | `pass6_rule_census.js` | the action table matches your intent; **no status becomes read-but-never-written** |
| **A client partial or page** | `pass6_component_map.js` | broken include edges **= 0**, broken template references **= 0** |
| **The manifest, clasp config, or CI** | `pass6_deployment_census.js` | **all four CI guards still bite**; scope count as intended |
| **The budget layer** | `pass4_budget_engine_*.js`, `pass4_request_service_edge_cases.js` | and **add a test that round-trips through `sheetDataToObjects`** |
| **Anything in `docs/`** | `pass6_register_check.js` | **0** structural problems |
| **Anything at all** | all three project suites | 3 PASS |

### 7.8.1 Run everything

```sh
cd docs/evidence && for f in *.js; do echo "== $f"; node "$f"; done
cd ../../lets_app && for f in test_*.js; do echo "== $f"; node "$f"; done
```

**Fourteen evidence scripts, three test suites, about fifteen seconds.** Several scripts self-report where their mechanical answer differs from a document's prose, so a stale claim surfaces rather than persisting quietly.

### 7.8.2 What green tests do and do not prove

**The three project suites pass today, and two of them prove less than they appear to** `[VERIFIED]`:

| Suite | Proves |
|---|---|
| `test_budget_engine.js` | The budget **arithmetic** is correct when given camelCase objects. **It feeds the engine objects built straight from `LETS_CONFIG`, bypassing `LetsDB.sheetDataToObjects()` entirely** — so the one path that is broken is the one path no test exercises |
| `test_fas_tracker_env.js` | The environment gate works. **Genuinely valuable** |
| `test_gas_module_load.js` | The server tree loads the way Apps Script loads it — one global scope, no module system. **The most useful of the three for the renames in §7.4** |

> **Do not treat green tests as evidence the budget layer works.** They prove the arithmetic. The arithmetic was never the problem.

---

## §7.9 Before you touch anything live

### 7.9.1 Three facts about the environment

| | |
|---|---|
| **The database is a Google Sheet with no constraints.** No column types, no validation, no protections `[VERIFIED]` | It will accept anything typed into it |
| **Spreadsheet edit access is the second most powerful privilege in the system** — above the application's own `admin` role | Someone with it can grant themselves admin by typing in a cell, with no log entry |
| **Whether the sandbox shares the production database is `[UNKNOWN]`** | If it does, **a sandbox test writes live travel data.** VT-21 settles it |

**So before testing anything destructive in the sandbox, run VT-21.** It is twenty minutes and it tells you whether "sandbox" means anything.

### 7.9.2 Three caches sit between a sheet edit and what a user sees

| Layer | Lifetime |
|---|---|
| Joined role lookup | **300 s** |
| Raw sheet contents | **600 s** |
| Per-execution, in memory | one execution |

**Application writes invalidate correctly** `[VERIFIED]`. **A direct spreadsheet edit clears nothing** — and a warming trigger re-reads every five minutes, so a concurrent application write can re-save stale data over your edit.

If you must edit a sheet directly: allow ten minutes, or have an admin run `_bustRoutingCachesForTesting()` `server/40_domain/Submission.js:1051`.

### 7.9.3 The one email safeguard, and its limit

If the acting user has `Suppress_Emails = TRUE` in `Test_Submitters`, **every** send is dropped and the function reports success `[VERIFIED]`.

**It is per-user, not per-environment.** It protects against *a tester* generating mail; it does **not** prevent a sandbox project from emailing real reviewers. Set it on your own account before testing any workflow transition.

---

## §7.10 A worked example — adding a field end to end

Collecting one new piece of information is the most common enhancement, and it touches six layers. **In this order:**

| # | Step | Reference |
|---|---|---|
| 1 | **Append** the column to the right-hand end of the tab | §7.5.5 |
| 2 | Add it to the end of the schema array in `server/01_constants/Sheets.js`, **same commit** | §7.5.5 |
| 3 | **Extend every positional writer** for that tab — `pass6_schema_census.js` §[3] lists them | §7.2.3 |
| 4 | Add the form field to the client page, and **wire it into the controller's payload** | below |
| 5 | Read it server-side **by header name**, never by index | §7.2.3 |
| 6 | Add it to [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) with its sensitivity classification | — |

**Step 4 is where this has gone wrong before.** Six LETS-added intake fields — owning office, purpose, set-aside type, and three policy flags — are **collected from the user and discarded client-side** (**G-039**) `[VERIFIED]`. Two of them are marked `required`, so the browser blocks submission until they are chosen, and **then the values are thrown away**.

**So: after adding a field, verify it reaches the sheet.** Submit a request and read the row. Do not assume the payload carries it because the form collects it.

### 7.10.1 If the field holds personal or cost data

| | |
|---|---|
| Classify it in the data dictionary | `PII`, `CUI`, `Financial`, or none |
| Remember the whole tab is visible to anyone with spreadsheet access | §7.9.1 |
| **Never add it to a log line** | `Error_Log` captures serialised context; a new PII field would land there |

---

## §7.11 Where to go next

| You want | Read |
|---|---|
| What the system is and who controls it | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) |
| Which file does what, and the fragile seams in full | [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) — §2.8 is this playbook's source |
| Every tab and column, with sensitivity | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) |
| Every rule, and which are enforced | [`WORKFLOW_AND_BUSINESS_RULES.md`](./WORKFLOW_AND_BUSINESS_RULES.md) |
| Deployment, configuration, and recovery | [`DEPLOYMENT_AND_ENVIRONMENTS.md`](./DEPLOYMENT_AND_ENVIRONMENTS.md) |
| **The findings, ranked, with ownership and blockers** | [`GAP_REGISTER.md`](./GAP_REGISTER.md) — §6.10.2 has the sequencing constraints |
| An honest current-state summary | `SYSTEM_STATE.md` (Deliverable 8) |
| The verification tasks, with locations and costs | `HUMAN_VERIFICATION_CHECKLIST.md` (Deliverable 10) |

### Computing the blast radius of your own change

```sh
cd docs/evidence && node pass6_change_impact.js
```

§[1] gives the rename radius for every coupled function. §[2] is the G-067 surface. §[4] lists the baselines each recipe verifies against. §[6] is the do-not-rename list with the reason for each entry.

> **One method note.** That script's first version used a bounded wildcard to find client call sites and reported **42** coupled functions where the authoritative census finds **61**. `withSuccessHandler` arguments are arbitrary callbacks containing parens and braces, so a wildcard either stops short or runs past the target. It now uses the same balanced-paren scanner `pass6_client_call_census.js` uses, and **asserts agreement with it (64 / 61 / 3) on every run** — because a playbook whose blast radii contradicted the component map would be worse than no playbook.

---

*End of Deliverable 7. Eight recipes, each with its blocking decision stated before its instructions, its blast radius measured rather than guessed, and a named script with an expected numeric delta. The prohibitions in §7.2 carry equal weight to the recipes, because every one of them fails silently.*
