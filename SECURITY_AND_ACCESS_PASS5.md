# LETS Security and Access as Implemented — Pass 5

| Field | Value |
|---|---|
| **Title** | LETS Security and Access as Implemented (Pass 5) |
| **Purpose** | State exactly how the system decides who someone is, what they may do, and where that decision is made — or not made. Covers every role check, permission gate, `Session.getActiveUser()` call, hardcoded email address, and authorization decision point. |
| **Date generated** | 2026-10-28 |
| **Prerequisite reading** | [FILE_MANIFEST.md](./FILE_MANIFEST.md) · [ENTRY_POINTS_AND_ROUTING.md](./ENTRY_POINTS_AND_ROUTING.md) · [DATA_LAYER_PASS3.md](./DATA_LAYER_PASS3.md) · [BUSINESS_LOGIC_PASS4.md](./BUSINESS_LOGIC_PASS4.md) |
| **Reproducible evidence** | [`evidence/pass5_guard_census.js`](./evidence/pass5_guard_census.js) — recomputes every count below from source |

## Confidence summary

| Evidence class | Share | Scope |
|---|---|---|
| `[VERIFIED]` | ~84% | Every guard, role detector, and identity call read directly in code. **All counts in this document are produced by a script that re-derives them from source on each run** (`evidence/pass5_guard_census.js`) rather than by hand-counting, and the script deliberately reports where its mechanical answer differs from this document's prose. |
| `[INFERRED]` | ~7% | Intent behind unfinished guard machinery, and consequences in live conditions I cannot reproduce (concurrent role edits, cache eviction timing, Apps Script's internal scope-consent behavior). Reasoning given each time. |
| `[CLAIMED]` | ~2% | Documented security behavior with no implementing code. |
| `[UNKNOWN]` | ~7% | The live deployment's **"Execute as"** and **"Who has access"** settings; the actual contents of `Travel_Users` / `Travel_User_Roles`; the HC library attachment; the real OAuth consent scope list; who holds editor access. None of these can be answered from files. All become verification tasks. |

---

## 5.0 The central fact of Pass 5

**There are two separate, non-equivalent answers to "who can do this?" in LETS, and only one of them is enforced.**

| | **The designed model** | **The enforced model** |
|---|---|---|
| Where it lives | `Travel_User_Roles` — six role types, scoped, with primary/backup semantics; plus two per-record gates (`requireRequestViewer`, `requireRequestEditor`) written to cover read and edit authority on individual requests | What the running code actually checks at the moment of action |
| Unit of authority | role × scope × record | mostly: "did you get past the front door?" |
| Coverage | Intended to cover every data access | **47 of 412 browser-reachable functions contain any role check at all; 31 are behind a guard that actually throws** `[VERIFIED]` |
| Per-record gates | Both fully written, 97 lines of correct logic | **Zero call sites. Neither has ever been invoked.** `[VERIFIED]` `Access.js:1325,1384` |

This is the security analogue of Pass 4's finding. Pass 4 found two business-logic systems where only one is reachable. Pass 5 finds an authorization model that is substantially *designed but not wired*. The guard functions exist, they are correct, they are documented — and the code paths that need them call nothing.

The practical consequence, stated plainly for a non-programmer:

> **Once a person is inside LETS at all, the application mostly stops asking who they are.** It records who they are — diligently, in 57 places — but recording is not restricting. Of the 54 reachable functions that look up the caller's identity, **31 use it only to stamp a name on something**, not to decide whether the action is allowed. `[VERIFIED]`

Everything below is the detail behind that sentence.

---

## 5.1 How the system decides who you are

Three layers, in the order they execute. Only the first is universal.

### 5.1.1 Layer 1 — Google authentication (outside the application)

Before any LETS code runs, Google has already authenticated the browser. The application never sees or handles a password, and there is no login screen in this codebase `[VERIFIED]` — exhaustive search finds no password field, no session token, no cookie handling, no `doPost`. This is a genuine strength and should be stated as such: **LETS cannot leak a credential it never holds.**

What the application receives is a single string — the signed-in Google account's email — via `Session.getActiveUser().getEmail()`.

**Two platform facts about that string that change its meaning entirely, and that no file in the repository settles:**

| Fact | Consequence | Status |
|---|---|---|
| The manifest declares `"executeAs": "USER_ACCESSING"` `lets_app/appsscript.json:20` | Server code runs with **the visiting user's** Google permissions | `[VERIFIED]` in the manifest |
| **Eight comments in the source say the opposite** — `"Architecture (USER_DEPLOYING mode)"` `Attachments.js:5`, `"The web app runs as the deploying owner (USER_DEPLOYING)"` `Reporting.js:310`, `"under executeAs=USER_DEPLOYING in appsscript.json"` `Feedback.js:77` | If the deployment really is `USER_DEPLOYING`, every Drive and Sheets operation runs as the **owner**, not the caller | `[VERIFIED]` that the comments say this; **which is true in the live deployment is `[UNKNOWN]`** |
| A deployment's "Execute as" setting is stored on the *deployment*, not in the pushed manifest. The deployment wins. | `clasp push` cannot change it, and reading the manifest cannot tell you it | Documented platform behavior `[INFERRED]` from consistent codebase assumptions |

**This contradiction is not cosmetic, and it is the single most important unknown in this document.** Here is why, in concrete terms:

- Under **`USER_ACCESSING`**, a user can only read the database if *they personally* have Drive access to the spreadsheet. The application's access control would be backed by Google's file permissions. The three `Feedback.js` "KNOWN BUG" comments about `UserProperties` would be wrong — the bug wouldn't exist.
- Under **`USER_DEPLOYING`**, every user's every action is performed with the owner's full credentials. The spreadsheet needs no per-user sharing, `getHCStaffingBundle` can return the whole personnel roster to anyone, `backupTravelDb` copies the production database using the *owner's* Drive rights, and the application's own role checks become **the only thing standing between any domain user and all the data.** The `Feedback.js` bugs are real.

The code behaves as if `USER_DEPLOYING` is true: `Attachments.js:5-11` explicitly explains that uploads work without user Drive access *because* of it, and `HCStaffing.js:6-8` says "Since TRIP runs as `USER_DEPLOYING`, the cache-miss fallback (direct spreadsheet read) always succeeds." Those are load-bearing architectural assumptions, not stray comments.

> **Reader's takeaway.** Do not accept this document's risk statements as final until V-30 is answered. If the deployment is `USER_DEPLOYING`, every unguarded function in §5.2 runs with owner privilege and the severity of §5.2 rises. If it is genuinely `USER_ACCESSING`, Google's file permissions provide a second, independent backstop that the application is not aware of — and several features are quietly broken instead. **Either answer is actionable; not knowing is not.**

### 5.1.2 Layer 2 — the site gate (`canAccessTrip`)

`doGet.js:41` calls `canAccessTrip(userEmail)` on **every** page load for **every** mode. Anyone who fails sees the access-blocked card. `[VERIFIED]`

This was documented in full in Pass 2 §2.1.4 and is not repeated here. The one point that belongs in a security pass:

**The gate has three independent allow-paths, and only one of them is under an administrator's control.** `[VERIFIED]` `Access.js:394-436`

| Path | Controlled by | Code |
|---|---|---|
| Any active role row in `Travel_User_Roles` | **A LETS administrator** | `:399-404` |
| A filled HC supervisor position (`supervisoryStatus === '2'`) | **The HR data source.** No LETS action required, no LETS audit entry | `:408-421` |
| An HC office title containing "chief of staff" or "client executive", in a filled seat | **The HR data source**, same caveat | `:429-433` via `_isBuLeadByTitle` `:864-911` |

Pass 2 recorded the operational consequence (access changes when an HR record changes). The security consequence to add here: **two of the three paths are a trust delegation to an external system whose contents this project does not control, cannot audit, and — per Pass 2 finding R-6 — may not even be connected.** The `HC` identifier is a library binding declared in no manifest; when it throws, the failure is caught and `console.warn`ed, and the gate silently falls through to "deny" for everyone outside the role table `[VERIFIED]` `Access.js:402-404, 422-424, 431-433`.

Fail-closed is the right default and the code gets it right. But the *mode* of failure — total, silent, and indistinguishable from correct operation — means a disaster-recovery rebuild would lock out every supervisor while appearing healthy.

### 5.1.3 Layer 3 — role resolution (`getReviewerContext`)

`Access.js:939-1051` resolves one email into one role, by a strict first-match-wins ladder. This is the function that decides what a reviewer sees. `[VERIFIED]`

| Priority | Role | Scope granted | Detector | Line |
|---|---|---|---|---|
| 1 | `admin` | `type: 'all'` — every request in the system | `isTravelAdmin()` | `:959` |
| 2 | `oso` | `type: 'all'` — every request in the system | `isActiveOSOReviewer()` | `:986` |
| 3 | `bu` | `type: 'bu'`, scoped to named BUs | `isActiveBUReviewer()` | `:999` |
| 3.5 | `bu` | `type: 'bu'`, scoped to BUs derived from HC title | `_isBuLeadByTitle()` | `:1018` |
| 4 | `sector` | `type: 'sector'`, scoped to 4-char sector codes | `isSectorDirector()` | `:1032` |
| — | `none` | `type: 'none'` | fallthrough | `:1050` |

**Four observations a reader should carry forward.**

1. **`fas_fo_reviewer` is not in the ladder.** The role exists in `TRAVEL_ROLE_TYPES` `Users.js:23`, is grantable in the admin UI, and is read by routing (`getFASReviewer()` `Submission.js:872`) — but `getReviewerContext` has **no branch for it** `[VERIFIED]` (`Access.js` contains no case-insensitive match for "fas" outside a status constant and a comment). A person holding **only** `fas_fo_reviewer` resolves to `role: 'none'`, `isReviewer: false`. They would pass the site gate (they have a role row) but be refused the reviewer dashboard, and `requireRole('reviewer')` would throw for them.
   **Why this probably has not been noticed** `[INFERRED]`: the FAS reviewer's actual job is performed on the review page via `submitReviewAction`, which checks `Current_Reviewer_Email` rather than role (§5.3.2). So the FAS reviewer *can* approve the requests assigned to them — they simply cannot see the dashboard. The gap shows up as "the dashboard link never appears for me," which a reviewer is unlikely to report as a bug.
2. **`approved_user` also has no branch.** By design, per its admin-UI hint: *"Grants TRIP access to a non-supervisor. No admin or reviewer privileges."* `travelUsersController.html.html:54-55`. This one is intentional and correct.
3. **Priority 1 and 2 both grant `type: 'all'`.** An AAS FO reviewer sees every request in the organisation, identically to an admin, for all scope-filtering purposes `[VERIFIED]` `:988`. They do not get the admin console — but they get organisation-wide data visibility through the reviewer dashboard. If "Front Office reviewer" is understood by the business as a *stage* role rather than an *all-data* role, this is a privilege the role's name does not advertise.
4. **Every detector is wrapped in `try/catch` that logs and continues.** `:980, 993, 1007, 1026, 1046`. An error in the admin check does not deny access — it falls through to the OSO check. The net effect of a systemic failure (e.g. HC unavailable, role sheet unreadable) is **demotion to `role: 'none'`**, never accidental elevation. That is the correct direction, and worth crediting explicitly.

---

## 5.2 The definitive answer: how the system decides someone is an administrator

This was Pass 5's first assigned question. The answer is short, and shorter than the documentation implies.

### 5.2.1 The determination, in full

```
isTravelAdmin(email)                                    Access.js:702-714
  └─ _getUnifiedRolesForEmail(email.toLowerCase())      Access.js:307-326
       ├─ _getUnifiedRoleData()                         Access.js:213-294
       │    ├─ CacheService key 'unified_roles_v1'  (300 s TTL)      :215-220
       │    ├─ read Travel_Users       → skip rows where Is_Active is false   :238-250
       │    ├─ read Travel_User_Roles  → skip rows where Is_Active is false   :261-285
       │    └─ join on User_ID; key the result by lowercased Email            :267-282
       └─ on a miss: selfHealCurrentUserEmail(email)    Users.js:1254-1298
            └─ if HC knows this email under a different Travel_Users row,
               PATCH the sheet's Email column and re-read                      :1283-1292
  └─ return true iff any resulting role has roleType === 'admin'   Access.js:707-709
```

**That is the entire test.** `[VERIFIED]` There is exactly one way to be an administrator:

> **An active row in `Travel_Users` whose `Email` matches your signed-in address, joined by `User_ID` to an active row in `Travel_User_Roles` whose `Role_Type` is the literal string `admin`.**

And the things that do **not** confer admin, each confirmed by exhaustive search `[VERIFIED]`:

| Not a path to admin | Evidence |
|---|---|
| Any hardcoded email address | No email literal is ever compared against the active user for an authorization decision. See the full inventory in §5.5 |
| Any HC office title, grade, or supervisory status | HC confers site access (§5.1.2) and BU/sector reviewer scope — never `admin`. `_isBuLeadByTitle` sets `ctx.role = 'bu'` `Access.js:1020`, never `'admin'` |
| Owning or editing the spreadsheet | The application never consults Drive permissions |
| Being an editor on the Apps Script project | Irrelevant *to the application's* check — and simultaneously **a complete bypass of it**, see §5.8 |
| A Script Property | No property is read in any authorization path. `PROPS_KEYS` `Props.js:23-40` contains no role or admin key |
| Membership in a Google Group | No Groups API usage anywhere `[VERIFIED]` |

**Three consequences of this design worth naming.**

- **It is admirably simple and auditable.** One sheet, one column value. An administrator can answer "who are the admins?" by filtering one tab. Many systems cannot.
- **Two boolean columns are load-bearing.** `Travel_Users.Is_Active` and `Travel_User_Roles.Is_Active` each independently void the role. The code treats only the literal `false` and the string `'false'` as inactive `:243, :266` — so a blank cell, the string `'no'`, or `0` all read as **active**. A spreadsheet typo in either column grants or revokes administrative privilege silently.
- **The join is by `User_ID`, but the lookup is by email.** When those disagree, `selfHealCurrentUserEmail` **writes to the production user table** to reconcile them — a write triggered by a *read*, on behalf of a user who may hold no role at all (§5.6).

### 5.2.2 The two guards, and exactly what they throw

```javascript
function requireRole(roleName) {                        // Access.js:1159-1177
  const ctx = getReviewerContext();
  if (!ctx.email)                      throw new Error('Not authenticated');
  if (roleName === 'admin'    && !ctx.isAdmin)    throw new Error('Admin access required');
  if (roleName === 'reviewer' && !ctx.isReviewer) throw new Error('Reviewer access required');
  return { email: ctx.email, name: formatUserName(ctx.email), role: ctx.role };
}

function requireTravelAdmin() { return requireRole('admin'); }   // Access.js:1186-1188
```

`[VERIFIED]` Properties of this implementation that matter:

| Property | Detail |
|---|---|
| **It throws; it does not return false.** | Callers that invoke it as a bare statement are protected by the exception propagating out of the RPC. The thrown message reaches the browser via `google.script.run`'s failure handler. |
| **Only two role names are supported.** | `'admin'` and `'reviewer'`. **Any other string is accepted and silently grants access** — `requireRole('budget_approver')` matches neither `if`, falls through, and returns successfully. `[VERIFIED]` A future developer adding a role and guarding it by name would produce a guard that does nothing. The file's own header anticipates this (`"add a case in requireRole()"` `:46`) but the function has no `default: throw` to enforce it. |
| **It returns the resolved identity.** | `{email, name, role}` — which is why 7 admin RPCs use the pattern `const adminCtx = requireTravelAdmin()` and then attribute writes to `adminCtx.email`. Good design: one call both authorizes and identifies. |
| **`'reviewer'` means *any* reviewer.** | Admin, OSO, BU, BU-lead-by-title, or Sector Director. It is not a stage check. |
| **`requireRole('reviewer')` has zero call sites.** | `[VERIFIED]` The only invocations of `requireRole` anywhere are the definition itself and the one-line shim at `:1187`. Every real guard in the codebase goes through `requireTravelAdmin()`. The generalized guard the file advertises as "the canonical guard for any future RPC" is, today, admin-only in practice. |

### 5.2.3 Guard coverage, measured

Counts from `evidence/pass5_guard_census.js`, which strips comments before matching — this matters, because at least one function *mentions* a guard in its JSDoc without calling it (`serveDDConfirmPage` `Render.js:184`, whose docblock is adjacent to `serveTravelAdminPage`'s). A raw text search overstates coverage. `[VERIFIED]`

| Measure | Count |
|---|---|
| Top-level function declarations in `lets_app/server/` | 459 |
| Trailing underscore — platform-private, **not** browser-callable | 47 |
| **Reachable from any authenticated browser via `google.script.run`** | **412** |
| Of those, named `_foo` — **leading** underscore, which confers nothing | **118** |
| Reachable functions containing any real role-related call | 47 |
| — of which live in `Access.js` and *are* the guard machinery | 11 |
| **Reachable functions behind a guard that actually throws** (`requireTravelAdmin` / `requireRole`) | **31** |
| Reachable functions whose only check is a record-level identity comparison | 9 |
| **Reachable functions with no authorization check of any kind** | **~356** |

**The 118 leading-underscore functions deserve their own sentence**, because this is the single most likely misreading in the codebase. Apps Script's privacy convention is a **trailing** underscore (`shareFileSilent_`). A **leading** underscore is an ordinary name. So `_bulkDeleteSmokeRequests` `Database.js:859` — which cascade-deletes rows across five sheets — *looks* private, is documented `@editor`, and is **fully callable from any user's browser console** `[VERIFIED]`. The codebase uses both conventions, 47 trailing and 118 leading, and only one of them does anything.

**The 31 throwing guards are correct and well-placed.** They cover the admin console end to end: all 8 user/role CRUD functions, all 9 reporting functions, both admin actions, both cleanup functions, all 3 dashboard reads, the 4 routing simulators, and the 2 access diagnostics. Within its intended surface, the admin gate is complete and consistently applied. The problem is not the quality of the guard; it is the size of the surface it was applied to.

### 5.2.4 Finding S-1 — the self-grant path, restated with its full chain

Pass 2 R-4 identified `bootstrapTravelAdmin` as a privilege-escalation path. Pass 5 traces the chain to its end, because the *completeness* of that chain is the finding:

| Step | Code | Result |
|---|---|---|
| 1 | Any domain user loads any LETS page and passes `canAccessTrip` | Browser now holds a live `google.script.run` channel |
| 2 | `google.script.run.bootstrapTravelAdmin('them@gsa.gov','Their Name','ext_them')` | `Database.js:228` — **no guard of any kind** `[VERIFIED]` |
| 3 | Writes a `Travel_Users` row with `Is_Active: true` | `:296-298` |
| 4 | Writes a `Travel_User_Roles` row with `Role_Type: 'admin'`, `Is_Active: true` | `:325-344` |
| 5 | `_invalidateUnifiedRoleCache()` | `:349` — **clears the 300-second cache so the grant takes effect on the next request, not in 5 minutes** |
| 6 | `broadcastTravelUsersChange()` | `:356` — stamps a Script Property so open admin sessions refresh and display the new admin |
| 7 | Next page load: `isTravelAdmin()` returns true | Full admin console, all data, bulk delete, reporting export |

Steps 5 and 6 are what make this complete rather than theoretical. The function was written to be *correct and immediate* as a bootstrap tool, and it is — which is exactly why it is effective as an escalation. The arguments are optional and default to a specific named individual `:231-233`, but the signature accepts anything.

**The audit trail this leaves.** `Granted_By: 'bootstrap'`, `Updated_By: 'bootstrap'` `:334-337` — not the caller's email. The row records *that* a bootstrap happened, not *who* ran it. The Apps Script execution log in Google Cloud would hold the caller identity `[INFERRED]`, with whatever retention that project is configured for. **The application's own audit trail would not.**

**No "last admin" protection on the server.** `setRoleActive`, `deleteRole`, and `updateTravelUser` contain no check for removing the final admin `[VERIFIED]`. The protection exists — in the *browser*, at `travelUsersController.html.html:638-652`, which computes `activeAdminCount` and blocks the UI action. A `google.script.run.deleteRole(...)` call bypasses it entirely and can leave the system with **zero** administrators, at which point the admin console is unreachable by anyone (`verifyPhase7Routing` names this exact state: *"No active admin — admin console inaccessible"* `OrgLookup.js:240`). Recovery would require `bootstrapTravelAdmin` — which is, with grim symmetry, the same unguarded function.

---

## 5.3 The `Session.getActiveUser()` census — identity as evidence vs. identity as permission

There are **57 real (non-comment) call sites** across **54 reachable functions** `[VERIFIED]`. The distinction that matters is not where they are, but what the answer is used for.

| Use | Reachable functions | Meaning |
|---|---|---|
| **Authorization** — the identity is compared against something, and a mismatch changes the outcome | 23 | A real check |
| **Attribution** — the identity is stamped into a record, an email, a log row, or a page template | 31 | Not a check |

Both are legitimate uses. The hazard is that they look identical in a code review: `const userEmail = Session.getActiveUser().getEmail();` appears at the top of both kinds of function. **Presence of this line tells you nothing about whether a function is protected.**

### 5.3.1 Attribution-only — the full list

These read the caller's identity and never test it. `[VERIFIED]` — enumerated by `evidence/pass5_guard_census.js`, section [4].

| Function | Location | What the identity is used for | Does that matter? |
|---|---|---|---|
| `logError` | `10_lib/Errors.js:29` | `User_Email` column of `Error_Log` | No — correct use |
| `uploadTravelDraftFile` | `Attachments.js:78` | `uploadedBy` in the Drive file's `description` JSON | **Yes** — see §5.3.4 |
| `finalizeRequestAttachments` | `Attachments.js:254` | `Uploaded_By` column of `Attachments` | **Yes** — writes to any `requestId` passed in |
| `sendSubmitterConfirmation` | `Email.js:1105` | Fallback sender name when `formData` omits it | Minor |
| `sendReviewerNotification` | `Email.js:1274` | Same | Minor |
| `sendResubmissionNotification` | `Email.js:1925` | Same | Minor |
| `_isTestSubmitter` | `Email.js:3561` | Decides whether to suppress outbound mail | **Yes** — a `Test_Submitters` row silences all mail for that user |
| `_testTravelEmailConfig`, `_testSubmissionEmail`, `_testAllEmailTemplates` | `Email.js:3251,3301,3344` | Sends test mail **to the caller** | Self-limiting, and good practice |
| `submitTravelFeedback` | `Feedback.js:37` | `User_Email` on the feedback row | No |
| `checkNpsEligibility` | `Feedback.js:111` | Cooldown lookup | No |
| `dismissNpsPrompt` | `Feedback.js:201` | Cooldown stamp | No |
| `_reportBuildSheetsExport` | `Reporting.js:317` | **Grants the caller edit rights on the exported spreadsheet** via `DriveApp.addEditor` `:319` | See §5.7.2 — the enclosing RPCs *are* admin-gated, so this is sound |
| `getMyTravelRequests` | `Request.js:632` | Filters rows to the caller's own email `:711` | **This is a real filter** — see note below |
| `_sendReviewActionNotificationWithData` | `Review_Action.js:638` | Email body attribution | No |
| `reportDDFundingIssue` | `Review_DDConfirm.js:422` | `flaggedBy` on each flagged traveler | **Yes** — §5.3.3 |
| `submitFundingCorrection` | `Review_DDConfirm.js:704` | `Action_By_Email` in `Approval_Log` | **Yes** — §5.3.3 |
| `getRequestForReview` | `Review_Read.js:52,320` | Computes `permissions.isSubmitter` / `isCurrentReviewer` **and returns the record either way** | **Yes** — §5.3.2 |
| `updateRequestItinerary` | `Review_Update.js:423` | `Action_By_Email` in `Approval_Log` only | **Yes** — §5.3.5 |
| `updateTravelersForReview` | `Review_Update.js:1521` | Same | **Yes** — §5.3.5 |
| `updateSharedCostsForReview` | `Review_Update.js:1675` | Same | **Yes** — §5.3.5 |
| `updateCostsForReview` | `Review_Update.js:2581` | Same | **Yes** — §5.3.5 |
| `submitTravelRequestV2` | `Submission.js:232` | The caller becomes the submitter | No — correct by construction |
| `serveTravelRequestForm`, `serveTravelPortal`, `serveTravelReviewPage`, `serveDDConfirmPage`, `serveTravelBudgetDashboardPage` | `Render.js:57,128,155,185,380` | Injected into the page template for display | No — but note `serveDDConfirmPage` and `serveTravelBudgetDashboardPage` have **no gate at all** |
| `getSubmitterInfo` | `Database.js:623` | Defaults the lookup to the caller when no email is passed | No — but the function happily looks up **anyone** when an email *is* passed |
| `_setupTravelDatabaseForTesting` | `Database.js:770` | Seeds test data under the caller's identity | Dev tool, unguarded |
| `_verifySubmissionDomainAdoption`, `_verifyAdminDomainAdoption` | `CacheWarming.js:515,558` | Self-test diagnostics | Dev tool, unguarded |

**A note on `getMyTravelRequests`, because it is the pattern the rest of the system should have used.** `Request.js:629` reads every row of `Requests` and then emits a row only when `submitterEmail.toLowerCase() === userEmail.toLowerCase()` `:711`, with parallel filters for assigned-reviewer rows `:716-718` and DD-assigned travelers `:741-748`. It refuses nothing and throws nothing — it simply cannot return another person's data. `[VERIFIED]` This is **filter-based authorization**, and for a read endpoint it is both safer and simpler than a gate: there is no path through the function that leaks. The census script classifies it as authorization for exactly this reason.

### 5.3.2 Finding S-2 — `getRequestForReview` computes permissions and then ignores them

`Review_Read.js:29` is the function the review page calls to load a request. It:

1. Reads the caller's email `:320`
2. Computes `isCurrentReviewer` and `isSubmitter` `:325-326`
3. Computes `availableActions` from those `:329`
4. **Returns the complete request record — all travelers, all legs, all costs, all attachments, the full approval log — to whoever asked** `:337-350` `[VERIFIED]`

There is no branch in which it refuses. The permission flags are **advice to the user interface**, which uses them to decide which buttons to render.

**Why this is a genuine exposure and not a theoretical one.** Any authenticated domain user can call `google.script.run.getRequestForReview('REQ-2026-0001')` and receive another person's complete travel record: traveler names, justification text, itinerary, per-traveler costs, division-director assignments, and every reviewer comment in the approval history. Pass 3 classified that content as PII and CUI; `PROJECT_PLAN.md:68-69` classifies it the same way. Request IDs are **sequential and predictable** — `generateRequestId()` produces `REQ-<year>-0001`, `0002`, … `Database.js:493-516` `[VERIFIED]` — so enumeration requires no guesswork.

**The function that would fix it already exists and is 37 lines long.** `requireRequestViewer(requestId, db)` `Access.js:1325-1362` implements precisely the right rule: allow the submitter, the currently-assigned reviewer, any admin, any reviewer whose BU/sector scope covers the request, or any DD assigned to a traveler on it — and `throw new Error('Access denied')` otherwise. One line at the top of `getRequestForReview` would close this. See §5.4.

**One mitigating detail, stated for accuracy.** The response is cached in `CacheService` under `request_review_v2_<id>` and the cached envelope has its `permissions` block **recomputed per caller** on every hit `:48-67` `[VERIFIED]`. So the permission flags are never stale or cross-contaminated between users — the caching is implemented carefully. It is the absence of a refusal, not a caching defect.

### 5.3.3 The DD-confirmation family — two checks, two gaps

Four functions serve the Division Director funding-confirmation flow. They split evenly. `[VERIFIED]`

| Function | Check | Verdict |
|---|---|---|
| `getDDConfirmationData` `Review_DDConfirm.js:223` | Filters travelers to those whose `DD_Email` equals the caller `:244-247`, then **errors if none match** `:250` | **Sound.** Also validates status. Note it reaches the record *via* `getRequestForReview`, so the caller still gets `request` — bounded by what that function already exposes (§5.3.2) |
| `confirmDDTravelers` `:290` | Writes `DD_Confirmed` only on rows where `ddEmail === currentUserEmail` `:330` | **Sound** — the identity comparison *is* the write filter |
| `reportDDFundingIssue` `:420` | **None.** Reads the caller's email for the `flaggedBy` stamp, then sets the request's status to `Pending_Correction`, writes `DD_Flagged_Travelers`, `DD_Issue_Notes`, `DD_Issue_Reporter` | **Unguarded write.** Any authenticated user can push any request into correction limbo and attach arbitrary notes, attributed to themselves |
| `submitFundingCorrection` `:702` | **None.** Flips `Is_Client_Paid` on named travelers, resets `DD_Confirmed` to false, sets status back to `Pending_DD_Confirmation` `:783-785` | **Unguarded write with financial meaning** — `Is_Client_Paid` is the field that determines whether travel is charged to a client or to overhead, which per Pass 4 §4.1.1 also governs FAS routing |

The asymmetry is instructive: the two functions a DD uses to *approve* are correctly gated; the two they use to *object and correct* are not. `[INFERRED]` A plausible reading is that the read/confirm pair was written first with the gate, and the exception-handling pair was added later under time pressure. Nothing in the files confirms that, but the shape fits.

### 5.3.4 Finding S-3 — attachment functions trust their arguments

Three functions, all `@client`, all unguarded:

| Function | Location | Behavior |
|---|---|---|
| `uploadTravelDraftFile` | `Attachments.js:69` | Writes a base64 payload into `Drafts/<draftId>/` on the Shared Drive. `draftId` is caller-supplied. Records `uploadedBy` honestly. No size limit, no MIME allowlist, no quota check `[VERIFIED]` |
| `deleteTravelDraftFile` | `Attachments.js:159` | `Drive.Files.update({trashed: true}, fileId, ...)` — **trashes any Drive file ID the caller names**, with no ownership verification whatsoever. Four lines of body `[VERIFIED]` |
| `getTravelDraftFiles` | `Attachments.js:183` | Returns name, URL, size, and MIME type for **any array of Drive file IDs** `[VERIFIED]` |

**The scope of `deleteTravelDraftFile` is bounded by the executing identity, not by the function.** Under `USER_DEPLOYING` that identity is the project owner, so the reachable blast radius is every file the owner can trash — which includes the production database spreadsheet. Under `USER_ACCESSING` it is bounded by the caller's own Drive rights, which is a materially different risk. **This is the clearest illustration of why V-30 must be answered before severity can be assigned.** `[INFERRED]` — the platform semantics are documented; which applies here is not.

Both functions are byte-identical to `reference_travel_app/` `[VERIFIED]`, so this is inherited TRIP behavior, not something LETS introduced. That changes who should answer for it, not whether it is true.

### 5.3.5 Finding S-4 — five of the seven `update*` functions lost their guard

`Review_Update.js` holds the review-page editing RPCs. Two of them check; five do not. `[VERIFIED]`

| Function | Line | Status check | Identity check |
|---|---|---|---|
| `updateRequestClassification` | `:43` | `editableStatuses` `:89-95` | **`Only the submitter can edit this request`** `:100-103` |
| `updateRequestOverview` | `:200` | `editableStatuses` `:269-275` | **`Only the submitter can edit this request`** `:280-283` |
| `updateRequestItinerary` | `:401` | **None** | **None** — reads the email only to stamp `Approval_Log` `:423, :704-706` |
| `updateTravelerCosts` | `:806` | **None** | **None** — and it never reads the session at all |
| `updateTravelersForReview` | `:1319` | **None** | **None** `:1521, :1549-1553` |
| `updateSharedCostsForReview` | `:1597` | **None** | **None** `:1675, :1703-1708` |
| `updateCostsForReview` | `:1760` | **None** | **None** `:2581, :2671-2676` |

All seven are reachable from the browser; six are tagged `@client` and `updateTravelerCosts` is tagged `@private @server` while lacking the trailing underscore that would make that true `[VERIFIED]`.

**What the five unguarded ones can change:** trip legs and dates, the traveler roster (including *deleting* travelers and their leg-cost rows `:1348-1384`), per-traveler cost figures, shared event costs, and `Traveler_Total` / `Shared_Total` / `Grand_Total` on the request row. `Grand_Total` is the figure Pass 4 §4.3.2 identifies as the probable input to any future budget check. **These are the financial fields of the system, editable by any authenticated user on any request in any status.**

Worse, each writes an `Approval_Log` row with the hardcoded role literal `'Submitter'` `:707, :1553, :1708, :2677` `[VERIFIED]` regardless of who actually called it. So the audit trail records the caller's real email in `Action_By_Email` — correctly — alongside a role attribution that is simply asserted. An admin editing costs is logged as a "Submitter."

**The inconsistency is itself the strongest evidence of intent.** `[INFERRED]` Two functions in the same file implement the identical check with identical wording; five do not. The guard was understood and applied, then not carried forward as the file grew to 2,713 lines. And the per-record gate that would have made the check uniform — `requireRequestEditor`, which enforces exactly `REQUEST_EDITABLE_STATUSES` plus submitter/reviewer/admin `Access.js:1384-1422` — was written for this job and never adopted. The file is byte-identical to TRIP's `[VERIFIED]`, so the omission predates LETS.

### 5.3.6 `submitReviewAction` — the one place the workflow gate is real

Credit where due. `Review_Action.js:41` is the function that moves a request through the approval chain, and it is guarded properly `[VERIFIED]` `:77-91`:

```
if (!isTravelAdmin(currentUser)) {
  if (action is 'resubmit' or 'submitter_cancel')
       caller must equal Submitter_Email         else throw
  else caller must equal Current_Reviewer_Email  else throw
}
```

Then `getActionConfig(action, currentStatus)` `:303-412` validates that the action is legal **for the current status** — a genuine state machine, with 13 actions each declaring which statuses they are valid from `[VERIFIED]`. An invalid combination throws with a message that even anticipates the concurrent-edit case: *"This may happen if the request was updated by another user."*

So the **approval decisions themselves** — approve, deny, needs-info, cancel, resubmit, at all four stages — are correctly restricted to the assigned reviewer or the submitter, with admin override. That is the highest-value control in the workflow and it holds.

The contrast with §5.3.5 is the finding: **you cannot approve a request you are not assigned to, but you can rewrite its costs, its travelers, and its itinerary.** An attacker does not need the approval button if they can edit the record the approver is looking at.

### 5.3.7 One identity call is not about identity at all

`FASTrackerSync.js:162` writes `Session.getActiveUser().getEmail()` into **column N of the official FAS Travel Exception Tracker** — a spreadsheet owned by the FAS front office, outside this project `[VERIFIED]`. Pass 4 §4.4 established that `submitToFASTracker` has no caller, so nothing reaches this line today. Recorded here because when that integration is wired, the caller's identity will be exported to another organisation's system of record, and the environment gate (`FAS_TRACKER_TARGET` `TripConfig.js:139-143`) is what stands between a test run and a permanent row in the real tracker. That gate is well built and fails closed `[VERIFIED]` `TripConfig.js:86-127` — a genuine strength of the LETS-specific code.

---

## 5.4 The guards that were built and never used

### 5.4.1 What exists

Two complete per-record authorization gates sit in `Access.js`, fully implemented, carefully documented, and invoked **zero times**. `[VERIFIED]` — confirmed by `evidence/pass5_guard_census.js` section [3], which counts call sites across all 53 server files and discounts the definition itself.

**`requireRequestViewer(requestId, db)`** `Access.js:1325-1362` — 38 lines. Resolves the caller's context, loads the request, and returns `{email, ctx, request}` if **any** of five conditions hold, else throws `'Access denied'`:

| Allowed | Line |
|---|---|
| Any admin (short-circuits before the scope work) | `:1328-1332` |
| The submitter | `:1340-1342` |
| The currently-assigned reviewer | `:1345-1347` |
| Any reviewer whose BU/sector scope covers the request **or any traveler on it** | `:1350-1352` |
| Any Division Director assigned to a traveler on the request | `:1355-1359` |

**`requireRequestEditor(requestId, db)`** `Access.js:1384-1422` — 39 lines. Stricter, and status-aware:

| Rule | Line |
|---|---|
| Throws `'Cannot edit request in status: <X>'` unless the status is in `REQUEST_EDITABLE_STATUSES` | `:1391-1393` |
| Admin may edit within those statuses | `:1396-1398` |
| In any `NEEDS_INFO_*` status, **only** the submitter may edit — explicitly to prevent racey co-editing | `:1408-1413` |
| In `PENDING_*` statuses, submitter or assigned reviewer | `:1417-1419` |
| Else `'Edit access denied'` | `:1421` |

Both are supported by two helpers written solely for them: `_loadRequestForGate` `:1219-1260` (one cached read returning submitter, reviewer, status, org code, and the traveler list with DD emails) and `_isRequestInUserScope` `:1270-1306` (traveler-aware BU/sector matching that mirrors the dashboard's own scope checker, including historic org-code expansion).

`REQUEST_EDITABLE_STATUSES` `:1202-1206` is defined with a comment naming each excluded status and why: *"Pending_DD_Confirmation, Pending_Correction, APPROVED_GOGOV, COMPLETED, CANCELLED, DENIED are intentionally excluded — those need admin-only status-change tools, not the standard editor."*

### 5.4.2 Speculation on intent — what these were for

Per the standing instruction, stated in enough detail to be actionable. `[INFERRED]` throughout this subsection; the reasoning is given so a reader can weigh it.

**The evidence that they were written for a specific, identified job:**

1. The `requireRequestEditor` docblock names its intended callers precisely: *"the standard `update*ForReview` RPC family"* `:1366`. That family is exactly the seven functions in §5.3.5 — five of which have no check.
2. `REQUEST_EDITABLE_STATUSES` `:1202-1206` is **character-for-character the same list** as the inline `editableStatuses` arrays in `updateRequestClassification` `:89-95` and `updateRequestOverview` `:269-275`. Same eight statuses, same order. The constant was extracted *from* those two functions.
3. The `NEEDS_INFO_*` rule in `requireRequestEditor` is **stricter than anything currently implemented anywhere** `:1404-1413` — it adds a concurrency protection ("the ball is with the submitter") that no live code enforces. That is not refactoring; that is a design decision made during the writing of this gate.
4. `requireRequestViewer`'s five-way allow-list is a **superset** of every record check scattered through `Review_Read.js`, `Review_DDConfirm.js`, and `Review_Update.js`, and it includes the DD path that only `getDDConfirmationData` implements.

**The most probable sequence:** someone audited the review RPCs, found the checks inconsistent (two of seven present, each inline and duplicated), wrote a single pair of correct gates plus their helpers, extracted the shared status list into a constant — and then stopped before the adoption step. The file-level comment block at `:1190-1193` even introduces the section as *"PER-REQUEST GUARDS — used by review/edit RPCs to verify caller may touch THIS specific request, not just hold a generic role,"* written in the present tense about something that never happened.

**What this means for scoping, which is why it matters.** The expensive part of fixing §5.3.2 and §5.3.5 is *deciding the rules* — who may read, who may edit, in which statuses, with what concurrency behavior. That work is done, it is written down in executable form, and its author clearly understood the domain. The remaining work is adoption:

| Change | Functions | Nature |
|---|---|---|
| `requireRequestViewer(requestId, db);` as the first statement | `getRequestForReview` `Review_Read.js:29`; `getFundingCorrectionData` `Review_DDConfirm.js:605` | One line each |
| `requireRequestEditor(requestId, db);` as the first statement | `updateRequestItinerary` `:401`, `updateTravelersForReview` `:1319`, `updateSharedCostsForReview` `:1597`, `updateCostsForReview` `:1760` | One line each |
| Replace the inline check with the gate | `updateRequestClassification` `:43`, `updateRequestOverview` `:200` | Behavior-preserving, removes duplication |
| Rename to `updateTravelerCosts_` | `Review_Update.js:806` | Already documented `@private`; the trailing underscore makes it true. **Check for callers first** — `recalculateRequestCostsAfterItineraryChange` is in the same file |

**Two cautions a developer must respect before touching this.** `[INFERRED]`
- `requireRequestEditor` is **stricter than current behavior** for reviewers in `NEEDS_INFO_*` states. Adopting it verbatim will take away edit access that assigned reviewers have today. That may be the intended policy — the comment argues for it — but it is a behavior change and needs an owner's decision, not a developer's.
- The four cost functions take a single `updates` object containing `requestId` `:1321, :1599, :1762`, not a positional `requestId` argument. The gate call must read `updates.requestId`, and all four should validate it is present before the gate runs or the error message will be confusing.

### 5.4.3 Why this is the most important constructive finding in Pass 5

Everything else in this document describes a missing control. This describes a **present** control that is one line per call site from being active. For a reader scoping remediation, the distinction is the difference between a design project and an afternoon.

---

## 5.5 Hardcoded email addresses — the complete inventory

27 distinct addresses appear in `lets_app/server/` `[VERIFIED]`, enumerated by `evidence/pass5_guard_census.js` section [5]. **None of them confers authorization.** Not one is compared against the active user to make an access decision — confirmed by reading every occurrence. They fall into four groups.

### 5.5.1 Group 1 — live operational defaults (4 addresses)

These affect running behavior.

| Address | Where | Role | Risk |
|---|---|---|---|
| `aastravel@gsa.gov` | `Props.js:131` (the default returned by `getEmailFromAddress()`), plus 31 further occurrences in email bodies and a `mailto:` on the access-blocked page `travelAccessBlockedPage.html:188` | **The outbound sender identity** for every notification, when the `travel_email_address` Script Property is unset | Requires a Gmail send-as alias on the sending account `Email.js:130-131`. If absent, `GmailApp.sendEmail` throws and the code falls back to `MailApp` with reply-to only `:174-189` — mail still goes out, from a different address |
| `ASD.Travel-Events@gsa.gov` | `Database.js:29` | A **second, different** sender default, written by `initTravelSystemConfig()` under the key `travel_email_address` (lowercased from `TRAVEL_EMAIL_ADDRESS` `:452`) | **Two different hardcoded senders for the same setting.** Per Pass 4 R-A3 this is one of the three keys the initializer writes *correctly*, so whichever ran last wins. Which address production actually sends from is `[UNKNOWN]` |
| `michael.thoennes@gsa.gov` | `Database.js:231` | The **default identity `bootstrapTravelAdmin` grants admin to** when called with no arguments | Named individual embedded in the privilege-granting path. See §5.2.4 |
| `approvals@gsa.gov` | `RequestService.js:107` | Fallback approver when an owning office has no `Org_Approvers` entry | In System B, which has no callers (Pass 4 §4.0). Inert today |

### 5.5.2 Group 2 — placeholder approvers that look real (8 addresses)

`BudgetConfig.js:86-119` — `fo.director@`, `fo.deputy@`, `omd.director@`, `omd.deputy@`, `idv.director@`, `idv.deputy@`, `cm.director@`, `cm.deputy@`, all `@gsa.gov`. `[VERIFIED]`

These are `LETS_CONFIG.defaultApprovers`, read by `RequestService.createTravelRequest` `:105` when `state.approvers` has no match. **They are almost certainly not real mailboxes** — the pattern `<office>.director@gsa.gov` is a placeholder convention, not a GSA address format.

Three of them are also **rendered to the screen** in the budget dashboard as the named approvers for OMD, IDV, and CM `travelBudgetDashboardPage.html:294,298,302` `[VERIFIED]`. Pass 2 R-2 established that page is a static mockup reachable by any user with no gate. So an executive loading `?mode=budget` today sees three fabricated approver addresses presented as system configuration.

`[INFERRED]` Harmless while System B is unwired. The moment a notification path reads `defaultApprovers`, mail for unmapped offices goes to addresses that either bounce or — worse — belong to someone unintended. Worth replacing with `null` and an explicit "no approver configured" error, which fails closed rather than silently mailing a placeholder.

### 5.5.3 Group 3 — real named individuals in test and diagnostic code (6 addresses)

| Address | Where | Context |
|---|---|---|
| `kimberly.mcfall@gsa.gov` | `Access.js:513` | `_diagnoseAccess()`'s `TEST_EMAIL` constant — "edit me" |
| `michael.baumann@gsa.gov` | `Admin_Dashboard.js:135` | JSDoc usage example for `debugReviewerPerf` |
| `jennifer.crouse@gsa.gov` | `Submission.js:1289,1290` | Routing-simulation fixture, labelled "AAS FO Primary" |
| `zachary.barefoot@gsa.gov` | `Submission.js:1295` | Fixture, "AAS FO Backup" |
| `stephanie.shutt@gsa.gov` | `Submission.js:1301` | Fixture, "FAS FO submits" |
| `justin.aguila@gsa.gov` | `Submission.js:1313` | Fixture, "Admin-only submits" |

`[VERIFIED]` These are in `simulateAllRoutingPaths`, which **is** admin-gated `:1128`. The addresses are not used for authorization — they are inputs to a read-only routing trace.

**But they are a disclosure, and they are informative.** The fixture labels assert who holds which role: "AAS FO Primary," "AAS FO Backup," "FAS FO," "Admin-only." Anyone reading this repository learns the probable role assignments of four named GSA employees. The repository is the right place to raise this; whether it matters depends on repository visibility, which is a question for the owner. The addresses should move to a config sheet or be replaced with `example.gsa.gov` placeholders regardless, because as fixtures they will silently rot when any of those people change roles.

### 5.5.4 Group 4 — obvious placeholders (9 addresses)

`someone@gsa.gov` `Access.js:444`, `Submission.js:1088`; `user@gsa.gov` `CacheWarming.js:1095` and two further sites; `employee.in.qfaa@`, `some.sector.director@`, `someone.in.cos@`, `consultant.via.test@`, `totally.unknown@` (all `Submission.js:1284-1322`); `nobody-no-match@gsa.gov` `CacheWarming.js:1295`; `smoke@test.gov` `CacheWarming.js:1981`. `[VERIFIED]` No operational significance.

Two more live in client files and so are outside the server census: `user@gsa.gov` as the mock `APP_STATE.userEmail` in the orphaned LETS shell `letsAppLayout.html:74`, and `a@b.com` in a JSDoc example `hcDataCenterService.html:18`. Listed for completeness so a future reader searching for hardcoded addresses can account for every hit.

### 5.5.5 The conclusion that matters

**There is no hardcoded back door.** This is a real and reportable positive finding. In a codebase with 412 unguarded entry points, the authorization logic itself contains no `if (email === 'someone@gsa.gov')` escape hatch anywhere. Every access decision routes through the role tables or HC. The weakness in this system is *absent* checks, not *corrupt* ones — which is a materially easier problem to fix and a materially better starting position than the alternative.

---

## 5.6 Authorization data integrity — caching, self-healing, and staleness

### 5.6.1 Three cache layers sit between a role change and its effect

| Layer | Key | TTL | Code |
|---|---|---|---|
| Per-execution in-memory | `TravelDB._data[sheetName]` | one execution | `TravelDB.js:83-86` |
| `CacheService` — joined role lookup | `unified_roles_v1` | **300 s** | `Access.js:216, 288` |
| `CacheService` — raw sheet data | `tdb_Travel_Users`, `tdb_Travel_User_Roles` | **600 s** | `TravelDB.js:39, 318` |

A warming trigger re-reads the sheets every 5 minutes `CacheWarming.js:95-128`, and `Travel_Users` + `Travel_User_Roles` are both in `TDB_WARM_SHEETS` `TravelDB.js:43-51` `[VERIFIED]`.

**Every write path invalidates correctly.** `_invalidateUserCaches()` `Users.js:1367-1375` clears the unified-role key, both sheet caches, and broadcasts a change timestamp — and all eight role-mutating functions call it `[VERIFIED]`. `bootstrapTravelAdmin` does the same inline `Database.js:349-357`. **Role changes made through the application take effect immediately.** This is well built and should be credited.

**The exposure is edits made outside the application.** A change typed directly into the `Travel_User_Roles` tab — the most likely way an administrator would revoke access in a hurry, and a path §5.8 shows is wide open — triggers no invalidation. The revoked role stays live for up to 600 seconds, and the 5-minute warming trigger will re-read the sheet and re-cache the *new* value, so the window is bounded. But during it, a user who has just been removed still passes `isTravelAdmin()`.

**Practical guidance for an administrator:** revoke through the admin console, not the spreadsheet. If you must use the spreadsheet, allow 10 minutes, or have an admin run `_bustRoutingCachesForTesting()` `Submission.js:1051` — which is admin-gated and clears every relevant key `:1056-1074`.

### 5.6.2 Finding S-5 — a read of the role table can write to it

`_getUnifiedRolesForEmail(email, db)` `Access.js:307-326` is the lookup behind `isTravelAdmin`, `isActiveOSOReviewer`, `isActiveBUReviewer`, `isSectorDirector`, and `canAccessTrip`. On a **miss**, it calls `selfHealCurrentUserEmail(email)` `:317`, which:

1. Looks the email up in the HC bundle to get an `employeeId` `Users.js:1260`
2. Scans `Travel_Users` for a row whose `User_ID` equals that `employeeId` `:1271-1273`
3. If that row's `Email` differs, **writes the new email into the production `Travel_Users` sheet** `:1288`, stamps `Updated_By: 'hc_self_heal'` `:1286`, invalidates caches `:1289`, and retries the lookup `[VERIFIED]`

**The problem it solves is real.** An employee's email changes (marriage, legal name change, a domain migration); their `Travel_Users` row goes stale; they lose all access despite holding valid roles. Self-healing keyed on the immutable HC employee ID is a sound answer, and the cost is bounded — HC is consulted only on a cache miss, not every request `:300-301`.

**Three properties of it that belong in a security document:**

1. **An unauthenticated-for-this-purpose user triggers a production write.** The caller holds no role (that is why the lookup missed). Merely loading a page causes a write to the table that governs authorization. `[VERIFIED]`
2. **It rebinds a role set from one email to another.** The roles attached to `User_ID` were granted to a person; after the patch they attach to whatever address HC now reports. The system's trust in that rebinding is **entirely** trust in HC's accuracy. If an HC record carried a wrong email, the roles would follow it, and no LETS administrator would be notified. `[INFERRED]` — this requires an HC data error to matter, which I cannot assess from files.
3. **The audit trail says `hc_self_heal`, not who triggered it.** `Updated_By: 'hc_self_heal'` and `Updated_At: new Date()` `:1286-1287`. The old email is written to the Apps Script log `:1290-1291` but not to any sheet. **The prior value is not recoverable from the database** — only from Cloud Logging, with whatever retention applies.

**Recommendation for the owner, not a code change:** this is a design decision that should be *recorded* rather than discovered. Either accept it with the rationale written down, or require that email changes go through the admin console (where `updateTravelUser` `Users.js:423` already handles them with proper `Updated_By` attribution). The middle state — an undocumented automatic write triggered by anonymous reads — is the one to avoid.

### 5.6.3 The `Is_Active` parsing rule, and why it is a real hazard

Both the user row and the role row are skipped only when the value is boolean `false` or the case-insensitive string `'false'` `Access.js:243, 266` `[VERIFIED]`:

```javascript
if (rawActive === false || String(rawActive).toLowerCase() === 'false') continue;
```

Everything else is active. Specifically: **blank**, `'no'`, `'N'`, `0`, `'inactive'`, `'disabled'`, `'FALSE '` (trailing space — `String()` does not trim here), and any typo. `[VERIFIED]`

Two directions of failure:

- **Fails open on deactivation.** An administrator who types `no` or `0` into `Is_Active` intending to revoke access has revoked nothing. The admin console writes a proper boolean `false` `Users.js:908-914`, so this only bites manual spreadsheet edits — which, again, is the path §5.8 leaves open.
- **Fails open on creation**, which is the right default. A new row with a blank `Is_Active` is active, so `addTravelUser` cannot accidentally create an invisible user.

`diagnoseTripAccess` `Access.js:530` is the admin tool that surfaces this: it reports *"Travel_Users row exists but Is_Active=FALSE"* and *"Role row ... exists but Is_Active=FALSE"* `:579, :612`. Useful — but it applies the same parsing, so a row reading `no` is reported as active, consistent with how the gate treats it. The diagnostic is honest about what the system does; it will not tell you that what you typed is not what you meant.

### 5.6.4 Audit coverage of authorization changes

| Change | Recorded where | Who is recorded | Gap |
|---|---|---|---|
| Role granted via admin console | `Travel_User_Roles.Granted_By` / `Granted_At` | The admin's email, from `requireTravelAdmin()`'s return | None — correct |
| Role deactivated | `Updated_By` / `Updated_At` on the row | The admin's email | **The prior value is overwritten.** No history |
| Role **deleted** | Nowhere | — | `deleteRole` `Users.js:1172` calls `db.deleteRowByIndex` `:1228`. **The row is gone.** No tombstone, no `Approval_Log` entry, no `Error_Log` entry `[VERIFIED]`. The function's own docblock recommends `setRoleActive` instead `:1164-1166`, but offers no enforcement |
| Role granted via `bootstrapTravelAdmin` | `Granted_By: 'bootstrap'` | **Not the caller** | §5.2.4 |
| Email auto-patched by self-heal | `Updated_By: 'hc_self_heal'` | **Not the caller**; prior email not retained | §5.6.2 |
| Request status/reviewer changed by admin | `Approval_Log` with `ADMIN_OVERRIDE` / `ADMIN_REASSIGN` | `admin.name`, `admin.email`, role `'Admin'` | None — `Admin_Actions.js:68-80, :102+` is exemplary |
| Requests bulk-deleted | `console.log` only `Admin_Cleanup.js:225` | The admin's email, **in Cloud Logging** | **The deleted rows are gone and the application retains no record.** Cascades across 6 tabs |
| Costs/travelers/itinerary edited | `Approval_Log` | Real email, with role hardcoded `'Submitter'` | §5.3.5 |

**The pattern:** request-level workflow actions are audited well, inside the application, in a tab an administrator can read. Authorization-level changes are audited by *current-state columns* that are overwritten on the next change, with two paths that do not record the actor at all and two destructive operations that record nothing recoverable. For a FIPS Moderate system where `PROJECT_PLAN.md:60-71` records PII, CUI, and financial data, "who had admin last March" is not answerable from this database. `[VERIFIED]`

---

## 5.7 OAuth scopes — what the application can actually do to a Google account

### 5.7.1 The manifest declares none

`lets_app/appsscript.json` has **no `oauthScopes` array** `[VERIFIED]` — the entire file is 23 lines and declares a timezone, two advanced services, Stackdriver logging, the V8 runtime, and the web-app block. Nothing else.

This matters more than it sounds, and the explanation is worth giving plainly because it is the kind of thing that is invisible to a non-programmer reviewing a system:

> An Apps Script project asks the user to approve a list of permissions the first time they use it — the "consent screen." If the project **declares** that list, it is fixed, reviewable, and minimal. If it does not, **Apps Script infers the list by scanning the code for API calls**, and asks for everything it finds. The result is correct in the sense that nothing breaks, and wrong in the sense that nobody ever decided what the application should be allowed to do. The permission set becomes an emergent property of the codebase rather than a design choice. `[INFERRED]` — this is documented Google platform behavior; the consequence for this project follows from it.

So: **the effective permission set cannot be read from this repository. It can only be derived from API usage, then confirmed against the live consent screen.** The derivation follows; the confirmation is V-31.

### 5.7.2 Derived scope set, with the evidence for each

Service call counts from `evidence/pass5_guard_census.js` section [6], counted after comment stripping. `[VERIFIED]`

| Service | Call sites | Scope Apps Script will request `[INFERRED]` | What that permits, in plain terms |
|---|---|---|---|
| `SpreadsheetApp` | 36 | `.../auth/spreadsheets` | Read and write **every spreadsheet the authorizing account can reach** — not only this database |
| `ScriptApp` | 36 | `.../auth/script.scriptapp` (triggers) + deployment URL read | Create, inspect, and delete scheduled jobs on this project |
| `CacheService` | 36 | *(none)* | Internal; no user-visible permission |
| `Utilities` | 29 | *(none)* | Internal |
| `HtmlService` | 11 | *(none)* | Internal |
| `PropertiesService` | 10 | *(none)* | Internal, but holds the GSA API key |
| `DriveApp` | 8 | `.../auth/drive` | **Full Drive access.** `DriveApp.getFileById().makeCopy()` `Database.js:817` and `.addEditor()` `Reporting.js:319` both require the broad scope, not the narrower `drive.file` |
| `Drive` (advanced) | 15 | `.../auth/drive` | Same breadth; this is the Drive v3 REST API bound as `Drive` |
| `UrlFetchApp` | 7 | `.../auth/script.external_request` | Make outbound HTTPS requests to any host |
| `LockService` | 2 | *(none)* | Internal |
| `GmailApp` | 1 | `.../auth/gmail.send` — and plausibly broader | `GmailApp.sendEmail(..., {from: alias})` `Email.js:161-168` requires send-as alias rights on the account |
| `MailApp` | 1 | `.../auth/script.send_mail` | Send mail as the authorizing account |
| `Maps` | 1 | `.../auth/maps` (via `script.external_request`) | `Maps.newGeocoder()` `Request.js:181` |

**The two to put in front of an ISSO:**

1. **`.../auth/drive` — full Drive, not scoped to this app's files.** Apps Script offers a narrow `drive.file` scope covering only files the app created or the user explicitly picked. This codebase cannot use it: `backupTravelDb` copies a file by hardcoded ID `Database.js:817`, `Admin_Cleanup.js:214` trashes folders by ID extracted from a URL, and `deleteTravelDraftFile` `Attachments.js:165` trashes an arbitrary caller-supplied ID. All three need the broad scope. So the authorizing account grants LETS the ability to read, modify, and trash **anything in its Drive** — and under `USER_DEPLOYING` that account is the owner's.
2. **`.../auth/spreadsheets` — all spreadsheets, same reasoning.** `SpreadsheetApp.openById(TRAVEL_DB_SPREADSHEET_ID)` needs the general scope; there is no per-file spreadsheet scope.

Neither is an implementation error — they are what the features require. The point is that **nobody chose them**, there is no record of accepting them, and because they are undeclared they will silently expand the first time someone adds a call to a new service. A declared `oauthScopes` array would turn that silent expansion into a visible manifest diff in a pull request.

**The `enabledAdvancedServices` block is the opposite case, and shows the right pattern.** `appsscript.json:4-15` declares Drive v3 and Gmail v1 explicitly, by `userSymbol`. That is why `Drive.Files.create(...)` resolves at all. And it exposes a small discrepancy worth noting: **Gmail v1 is declared and enabled, but the `Gmail.` advanced-service symbol is never used anywhere** `[VERIFIED]` — all mail goes through the built-in `GmailApp` / `MailApp` services. The declaration is vestigial. Removing it is a one-line reduction in attack surface with zero behavior change, though it should be confirmed against the live project first in case an editor-only script depends on it.

### 5.7.3 Drive file sharing — attachments

`shareFileSilent_(fileId, email, role)` `Attachments.js:618-631` `[VERIFIED]`:

```javascript
Drive.Permissions.create(
  { role: role, type: 'user', emailAddress: email },
  fileId,
  { sendNotificationEmail: false, supportsAllDrives: true }
);
```

| Property | Detail | Assessment |
|---|---|---|
| `sendNotificationEmail: false` | The grantee gets **no email** when a file is shared with them | Correct for this use — the application sends its own notification with a deep link. Avoids duplicate mail |
| Failure is swallowed | `catch (e) { console.warn(...) }` `:627-629` | **A sharing failure is invisible to the user.** The approval proceeds; the reviewer silently cannot open the attachment |
| Trailing underscore | Not browser-callable | Correct |

Its only caller is `shareAttachmentsWithUsers(fileIds, emails, accessLevel)` `:470`, which **is** browser-callable and **has no guard** `[VERIFIED]`. Any authenticated user can grant any email address access to any Drive file ID they can name. The practical limit is knowing a file ID; `getRequestAttachments(requestId)` `:533` — also unguarded `[VERIFIED]` — returns the `fileId` for every attachment on any request. **The two compose:** enumerate a request ID (§5.3.2 established these are sequential), read its attachment file IDs, then grant yourself or anyone else access to them.

**Finding S-6 — the only real caller asks for a permission that does not exist.** `Review_Action.js:217` calls:

```javascript
shareAttachmentsWithUsers(fileIds, [nextReviewer.email], 'viewer');
```

The Drive v3 API accepts `owner`, `organizer`, `fileOrganizer`, `writer`, `commenter`, and **`reader`** — not `viewer` `[INFERRED]` from the API contract; the function's own docblock says *"`'reader'` or `'writer'` (default `'reader'`)"* `:467` `[VERIFIED]`. Because `accessLevel` is supplied and truthy, the `|| 'reader'` default at `:471` does **not** engage. So `Drive.Permissions.create` is called with `role: 'viewer'`, which should be rejected — and the rejection is swallowed by `shareFileSilent_`'s `catch`, logged as a `console.warn`, after which `shareAttachmentsWithUsers` **returns `{success: true}`** `:486` because the loop completed without an uncaught throw.

The visible symptom: `console.log('Shared N attachments with ...')` `:220` reports success, and **the next reviewer in the chain cannot open the attachments.** Three layers of error suppression turn an invalid API argument into a silent functional failure that reports success.

This is `[VERIFIED]` as code and `[INFERRED]` as consequence — I cannot call the Drive API from here to confirm `'viewer'` is rejected. It is a one-word fix (`'viewer'` → `'reader'`) and a cheap verification: approve a request with an attachment, then check whether the next reviewer can open it. Recorded as V-34. Both files are byte-identical to `reference_travel_app/` `[VERIFIED]`, so if confirmed, TRIP has the same defect.

**Where attachments live.** All files go to a Shared Drive folder from the `SHARED_DRIVE_FOLDER_ID` Script Property `Attachments.js:29-31`, in the tree `Drafts/<draftId>/` then `Requests/<requestId>/{Supporting_Documents,Travelers/<Name>}/` `:13-21`. Because they sit on a Shared Drive, **the Shared Drive's own membership is an access path this application knows nothing about** — anyone with access to that Drive sees every travel attachment regardless of any LETS role. Who those members are is `[UNKNOWN]` and becomes V-33.

---

## 5.8 The paths that bypass the application entirely

Pass 2 §2.4–2.6 inventoried these as entry points. Here they are assessed as *authorization* bypasses, because a reader needs to understand that the application's own controls are not the outermost boundary.

| # | Path | What it grants | What the application can do about it |
|---|---|---|---|
| 1 | **Editor on the Apps Script project** | Select any of the 459 functions from a dropdown and run it with no role check, including `bootstrapTravelAdmin` and `_bulkDeleteSmokeRequests`. Also: read every Script Property — including `GSA_PERDIEM_API_KEY` — via the Project Settings UI or `_viewScriptProperties()` `PerDiemGSA.js:915`. Also: change the deployment's "Execute as" and "Who has access" | **Nothing.** This is above the application |
| 2 | **Drive edit access to the database spreadsheet** | Type directly into `Travel_User_Roles` and grant yourself `admin`. Read every row of PII, CUI, and cost data. No `Approval_Log` entry, no `Error_Log` entry — only Sheets version history | **Nothing** |
| 3 | **The `CLASPRC_JSON` GitHub secret** | `clasp push --force` to the production project. Standing deploy authority with no second approval `deploy-gas.yml` | Out of scope for the app |
| 4 | **The HC library's contents** | Two of three site-gate allow-paths, plus all BU-lead and Sector-Director scope (§5.1.2) | **Nothing** — and per Pass 2 R-6 the binding is undeclared |
| 5 | **The Shared Drive's membership** | Every travel attachment ever uploaded (§5.7.3) | **Nothing** |

**The ranking a reader should take away.** The application's `admin` role is **not** the highest privilege in this system. Ordered by actual power:

1. Apps Script project **editor** — can run anything, read secrets, and redefine who the app executes as
2. Spreadsheet **editor** — can grant themselves the app's `admin` role, invisibly
3. `CLASPRC_JSON` **holder** — can replace the production code
4. Application **`admin`** — bounded by the 31 guarded RPCs
5. Any **authenticated domain user** — bounded by nothing except the ~356 unguarded functions

Items 1–3 are not managed by this codebase and cannot be audited from it. They are Google Workspace and GitHub administration questions, and they are V-3, V-7, and V-8 from Pass 2 — still unanswered. **Any statement about who controls LETS is incomplete until they are.**

---

## 5.9 The role × capability privilege matrix

Required by the Administrator's Guide §1.4. Built from the enforced behavior, not the role names. `[VERIFIED]` except where marked.

**Roles as defined** `TRAVEL_ROLE_TYPES` `Users.js:20-27`: `admin`, `aas_fo_reviewer`, `fas_fo_reviewer`, `bu_reviewer`, `sector_override`, `approved_user` — plus two **implicit** roles conferred by HC with no role row at all.

### 5.9.1 What each role gets

| Capability | `admin` | `aas_fo_reviewer` | `fas_fo_reviewer` | `bu_reviewer` | `sector_override` | `approved_user` | HC supervisor *(implicit)* | HC COS/CE *(implicit)* |
|---|---|---|---|---|---|---|---|---|
| Pass the site gate | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `getReviewerContext` role | `admin` | `oso` | **`none`** ⚠️ | `bu` | `sector` | `none` | `none` | `bu` |
| Scope granted | all | **all** | — | named BUs | sector codes | — | — | derived BUs |
| Submit a request | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| See own requests | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reviewer dashboard | → admin | ✅ | **❌** ⚠️ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Act on an assigned request | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | n/a | n/a |
| Act on an **unassigned** request | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Admin console | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Grant/revoke roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Override any status | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reassign a reviewer | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bulk delete requests | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Export all data | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Be routed requests | ❌ | ✅ *(primary)* | ✅ *(primary)* | ✅ *(primary)* | ✅ | ❌ | ❌ | ❌ |
| **Read any request's full record** | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** | **✅** | **✅** |
| **Edit any request's costs/travelers/itinerary** | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** | **✅** | **✅** |
| **Grant themselves `admin`** | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** | **✅** | **✅** |

⚠️ `fas_fo_reviewer` resolving to `none` is §5.1.3 observation 1 — the role works for routing and for acting on assigned requests, but grants no dashboard.

### 5.9.2 The matrix's own verdict

**The last three rows are the finding.** Read the matrix top-down and it describes a careful, well-separated RBAC design: six roles, scoped data visibility, admin-only destructive operations, routing driven by primary/backup assignment. Read the last three rows and **every column is identical** — the role taxonomy has no effect on the capabilities that matter most.

That is not a criticism of the design. It is a precise statement of the gap between the design and its enforcement, which is the same gap §5.0 opens with and §5.4 shows is one line per call site from closing.

**Three structural observations an administrator needs:**

1. **`aas_fo_reviewer` is an all-data role.** Scope `type: 'all'` `Access.js:988` is identical to admin's for every filtering purpose. If the business understands "Front Office reviewer" as a stage role, that understanding is wrong.
2. **The two implicit HC roles are not in any LETS table.** An HC supervisor and an HC Chief of Staff / Client Executive hold access that no `Travel_User_Roles` row records. `listTravelUsers` will not show them. **The admin console cannot give a complete answer to "who has access to this system?"** — only `diagnoseTripAccess(email)` `Access.js:530`, one email at a time, can.
3. **Primary/backup is a routing concept, not a privilege concept.** `Is_Primary` decides who gets routed to `Submission.js:800-812`; it grants nothing and restricts nothing. A backup BU reviewer has the same scope as the primary.

### 5.9.3 The "view-as" impersonation path — assessed, and it holds

An administrator can view the reviewer dashboard as another role. Because this is impersonation, it needs explicit assessment. **It is implemented correctly.** `[VERIFIED]`

**How it is reached.** `?mode=reviewer-dashboard&force=1&as=<role>&buName=<x>&sector=<x>` `Render.js:251-265`. `serveReviewerDashboardPage` builds a `viewAs` object from the URL `:258-265`, passes it to `getReviewerContext(userEmail, viewAs)` `:269`, and then injects it into the page as `viewAsParams` `:308`. The client controller forwards that value on every subsequent data call — `getReviewerDashboard(..., viewAs)` `travelReviewerDashboardController.html:359` and `getReviewerRequestSummary(requestId, viewAs)` `:1527`.

**So a client-supplied value flows into the function that decides scope.** That is exactly the shape of a privilege-escalation bug, and here it is not one, for three independent reasons:

| Control | Code | Effect |
|---|---|---|
| The override is applied **only inside the admin branch** | `Access.js:967-977` — nested within `if (isTravelAdmin(resolvedEmail))` `:959` | A non-admin's `viewAs` is reached by no code path. The file documents this as *"Non-admins passing viewAs are ignored (security: silent no-op)"* `:928` |
| The override can only **narrow**, never widen | `_applyViewAsOverride` `:1061-1094` returns `type: 'all'` for `'oso'` (identical to the admin's own scope), or a specific BU/sector for the other two | An admin already holds `type: 'all'`. There is no value of `viewAs` that yields more than the caller started with |
| Malformed input fails closed | `:1093` returns `null` for an unrecognized role or a missing `buName`/`sector`; the caller then leaves `ctx` at full admin `:969` | A bad override is ignored, not partially applied |

**Two residual notes, neither a finding.**

- **`isAdmin` deliberately stays `true` while `viewAsActive` is set** `:975`. The comment explains why — *"so the user can switch off"* — and the dashboard redirect at `Render.js:278` tests `ctx.isAdmin && !ctx.viewAsActive && !forceDebug` to avoid bouncing the admin away from the page they asked for. The consequence is that **anything else checking `ctx.isAdmin` during a view-as session still sees an admin.** That is the correct behavior for a debugging affordance, but it means view-as is a *display* simulation, not a privilege simulation: an admin in view-as mode retains every admin capability. An administrator using it to verify "what can a BU reviewer do?" will get the wrong answer.
- **The label is marked.** `ctx.label` gets ` (test)` appended `:972` and `viewAsActive` / `viewAsLabel` reach the page `:306-307`, so the UI can tell the user they are impersonating. Good practice; whether the page actually displays it is a client concern not assessed here.

**No audit entry is written when an admin views as another role** `[VERIFIED]` — it is a read-only simulation, so there is nothing to attribute. Worth knowing if an auditor asks whether impersonation is logged: it is not, because nothing is changed.

---

## 5.10 Input validation and injection surface

A security pass has to ask whether untrusted input reaches a sensitive sink. In Apps Script the usual suspects are narrower than in a web stack — there is no SQL and no shell — but three sinks exist.

### 5.10.1 The validation library nobody adopted

`10_lib/Validation.js` provides twelve guards — `requireString`, `requireNumber`, `requireNonNegativeNumber`, `requirePositiveNumber`, `requireBoolean`, `requireArray`, `requireNonEmptyArray`, `requireEnum`, `requireObject`, `requireRequestId`, `requireEmail`, `requireDateString` — each throwing a typed `ValidationError` carrying the field name and an error code `:28-39` `[VERIFIED]`.

**Every one has zero call sites outside its own self-test.** `[VERIFIED]` — the only invocations anywhere in `lets_app/server/` are inside `_verifyValidationLibrary()` `CacheWarming.js:944+`, the diagnostic that proves the library works. The library's header is candid about this: *"Adoption is rolling — a function can mix new guards with legacy inline if-checks during transition. Picking up validation is part of touching a function for any other reason; no chunk dedicated to bulk migration"* `:9-12`.

So this is the **third** instance of the Pass 5 pattern: correct machinery, written, tested, documented, never wired. `requireRequestId` in particular would reject a malformed ID at the door — its regex is `/^REQ-\d{4}-\d{4,6}$/` `:201` — which is exactly the guard the unguarded `update*` functions need before they scan the sheet.

What *is* used instead: ad-hoc `if (!x) throw new Error('X is required')` checks, present in most `@client` functions and absent in several, plus `_isValidEmail` `Email.js:984` which **is** genuinely adopted at 21 call sites `[VERIFIED]` and correctly refuses to send mail to a malformed address.

### 5.10.2 The three sinks, assessed

| Sink | Risk | Reality |
|---|---|---|
| **SQL injection** | — | **Not applicable.** No database, no query language, no `eval`. Searched for `eval(`, `new Function(`, and `Utilities.newBlob` script execution: none in any authorization or data path `[VERIFIED]` |
| **Drive query injection** | Real | `getOrCreateSubfolder_` `Attachments.js:584` builds a Drive query string by concatenation: `"name = '" + name.replace(/'/g, "\\'") + "' and '" + parentId + "' in parents ..."`. **It does escape single quotes** — the one character that would break out of the literal `[VERIFIED]`. `cleanupDraftFolder_:637` applies the same escape to `draftId`. This is handled correctly, and deliberately: the `.replace()` is not accidental |
| **HTML injection into the UI** | Real | See below |

### 5.10.3 Client-side output encoding

`client/shared/escapeHtml.html` provides a shared `escapeHtml(text)` with documented edge cases (`0` → `"0"`, `null` → `""`, Date coerced via `String()`) `:19-22`, and its header notes it *"replaces five per-controller `_escapeHtml` reimplementations"* `:14`. Adoption is substantial: **273 escape-helper call sites across the client, against 224 `innerHTML` references** `[VERIFIED]`.

That ratio is genuinely good, and spot-checking the highest-risk renderers confirms the pattern holds where it matters most — `ddConfirmPage.html:1123` and `:1287` both escape `t.employeeName`, which is the clearest case of server data flowing into markup.

**The caveat that keeps this from being a clean pass.** A heuristic scan for template-literal interpolations that pass through no escape helper flags roughly 1,100 sites across 17 client files, concentrated in `travelRequestTravelers.html` (~457) and `travelReviewController.html` (~435) `[INFERRED]` — the heuristic cannot distinguish a CSS class name from a traveler's name, and the large majority are plainly the former (`${fundingClass}`, `${idx}`, `${isChecked ? 'a' : 'b'}`). **I am not asserting these are vulnerabilities.** I am recording that the two largest client controllers mix escaped and unescaped interpolation densely enough that a targeted review is warranted, and that such a review needs someone who can distinguish the two cases file by file. Recorded as V-35 rather than as a finding.

The threat model also bounds the impact: the data being rendered originates from `Travel_Users`, `Requests`, and the HC bundle — all populated by authenticated domain users, not the public. A stored-XSS payload would have to be typed into a travel request by a GSA employee. That makes it an insider-threat concern rather than an internet-facing one, which is a different severity, not zero.

### 5.10.4 Two input gaps with concrete consequences

| Gap | Code | Consequence |
|---|---|---|
| **No email domain restriction when granting roles.** `addTravelUser` validates format via `_isValidEmail` `Users.js:204` and `updateTravelUser` does the same `:460`, but **neither constrains the domain.** An admin can create a `Travel_Users` row for `anyone@example.com` and grant it any role | `Users.js:204, 460` `[VERIFIED]` | Bounded in effect — the site gate requires a Workspace account in the deploying domain, so a non-domain row cannot actually sign in `[INFERRED]`. But the row exists, `listTravelUsers` shows it, and `lookupBUReviewer` will route requests to it, sending notification mail outside the domain. Fails confusingly rather than safely |
| **No upload size or type restriction.** `uploadTravelDraftFile` `Attachments.js:69` accepts `{name, type, data}` where `data` is caller-supplied base64, with no MIME allowlist and no size ceiling | `Attachments.js:69-120` `[VERIFIED]` | Any authenticated user can write arbitrary binary content to the Shared Drive under an arbitrary `draftId`. Apps Script's own payload and execution limits are the only ceiling. Combined with §5.3.4's unguarded delete, the Shared Drive is effectively writable storage for any domain user |

---

## 5.11 What this pass found that works

A security document that lists only failures gives a false picture and is easy to dismiss. These are `[VERIFIED]` strengths, and several are non-trivial.

| # | Strength | Why it matters |
|---|---|---|
| 1 | **No credential handling anywhere.** No login form, no password, no session token, no cookie, no `doPost` | The largest class of web vulnerability is structurally absent. Authentication is delegated entirely to Google |
| 2 | **No hardcoded back door** (§5.5.5) | In 412 unguarded entry points, not one authorization bypass keyed on a literal email. Every decision routes through the role tables |
| 3 | **The admin gate is consistently applied where it was applied.** 31 functions, all via one shim over one function | No partial admin checks, no duplicated logic, no bypassable variant. The admin console is properly sealed |
| 4 | **`submitReviewAction` enforces both identity and state** (§5.3.6) | The approval decisions themselves — the system's highest-value action — are correctly restricted, with a real 13-action state machine |
| 5 | **Every role detector fails closed.** All five `try/catch` blocks in `getReviewerContext` demote to `none`, never elevate | A systemic failure locks people out rather than letting them in. The correct direction |
| 6 | **The site gate fails closed too.** HC unavailable → deny | Same |
| 7 | **The FAS tracker environment gate is exemplary.** `resolveFASTrackerTarget` `TripConfig.js:86-127` refuses to run if a non-production project points at the official tracker, and an unset `LETS_ENV` resolves to `development` | This is the single best-engineered security control in the codebase, with its NIST control mapping written into the comments `:23-24`. It is LETS-original code, not inherited |
| 8 | **Cache invalidation on role writes is complete.** All 8 mutating functions call `_invalidateUserCaches()`; `bootstrapTravelAdmin` does it inline | Role changes through the UI take effect immediately. Easy to get wrong; got right |
| 9 | **Per-caller permission recomputation on cache hits.** `Review_Read.js:48-67` | Cached request data never carries another user's permission flags |
| 10 | **Drive query escaping is deliberate** (§5.10.2) | `.replace(/'/g, "\\'")` in both query builders |
| 11 | **`_isValidEmail` is genuinely adopted** — 21 call sites, all refusing to mail a malformed address | Prevents notification failures and mis-sends |
| 12 | **Admin actions are audited properly.** `Admin_Actions.js` writes `ADMIN_OVERRIDE` / `ADMIN_REASSIGN` rows with the real admin identity and the before/after status | The model the rest of the system should follow |
| 13 | **Attachment sharing suppresses notification mail** `sendNotificationEmail: false` | Correct; the app sends its own |
| 14 | **CI cannot deploy.** `verify.yml` runs with no credentials and a guard step fails the build if a `pull_request` trigger reappears in the deploy workflow | Deliberate separation of verification from deployment, with its reasoning documented in the file |
| 15 | **A `.claspignore` guard prevents test files reaching production**, enforced by CI because the glob behavior could not be verified | Correct paranoia about a real Apps Script hazard: all pushed `.js` files share one global scope |
| 16 | **Admin "view-as" impersonation cannot escalate** (§5.9.3). The override is applied only inside the admin branch, can only narrow scope, and fails closed on malformed input | A client-supplied value reaches the scope resolver and is nonetheless safe — by construction, not by accident |

Items 7, 14, and 15 are worth isolating: they are the LETS-specific security work, they are well reasoned, and they cite the controls they implement. **The security engineering judgment in this project is demonstrably sound where it was applied.** The gaps in §5.2–§5.5 are overwhelmingly inherited TRIP code — `Review_Update.js`, `Review_Read.js`, `Attachments.js`, and `Review_Action.js` are all byte-identical to `reference_travel_app/` `[VERIFIED]`. That does not make them acceptable, but it does locate them: they are a pre-existing condition of the foundation this project was directed to adopt, not defects introduced by it.

---

## 5.12 Where documentation contradicts implemented security behavior

Per the standing rule: the codebase wins, and the wrong document is named.

| Document & section | Claim | Implemented reality |
|---|---|---|
| `Access.js:1-13` (header) | *"SINGLE SOURCE OF TRUTH for 'who is this user, and what can they see?' ... **Every** access decision in the app ... funnels through this file"* | **False as written.** ~356 reachable functions make no call into this file. It is the single source of truth for the decisions that *are* made, which is a materially weaker claim |
| `Access.js:1190-1193` | *"PER-REQUEST GUARDS — **used by** review/edit RPCs"* | Zero call sites (§5.4). Present tense about something that never happened |
| `Access.js:1152-1153` | `requireRole` is *"the canonical guard for any future RPC that needs role gating"* | `requireRole('reviewer')` has no call sites; and an unrecognized role name **silently grants** access (§5.2.2) |
| `Users.js:9` | *"**All** RPCs guarded by `requireTravelAdmin()`"* | True for `Users.js` itself `[VERIFIED]` — all 8 CRUD RPCs are guarded. Easy to misread as a project-wide statement |
| `Reporting.js:13` | *"**All** entry points call `requireTravelAdmin()` for access control"* | True for `Reporting.js` `[VERIFIED]` — all 9 |
| `Review_Update.js:1366` | `requireRequestEditor` is for *"the standard `update*ForReview` RPC family"* | That family does not call it; 5 of 7 have no check at all (§5.3.5) |
| `Validation.js:9-12` | *"Adoption is rolling"* | Adoption is **zero** outside the self-test (§5.10.1) |
| `Attachments.js:5` + `HCStaffing.js:6` + `Reporting.js:310` + `Feedback.js:77,118,229` | Six statements that the app runs as `USER_DEPLOYING` | `appsscript.json:20` declares `USER_ACCESSING`. **One of these is wrong and the files cannot say which** (§5.1.1). The highest-priority unknown in this document |
| `Review_Update.js:707,1553,1708,2677` | `Approval_Log.Action_By_Role` written as the literal `'Submitter'` | The actual caller may be an admin, a reviewer, or anyone. The role column is asserted, not derived (§5.3.5) |
| `RequestService.js:147` (JSDoc) | *"Advances Kanban stage with role and permission checks"* | No checks of any kind — already recorded as Pass 4 R-B11. Restated here because it is a *security* claim |
| `Attachments.js:467` | `accessLevel` is *"`'reader'` or `'writer'`"* | Its only caller passes `'viewer'` (§5.7.3, S-6) |
| `PROJECT_PLAN.md:93-99` (Team table) | Lists four access levels: Admin, Write, Write, Read + Review | **No mapping exists** between these labels and the six implemented role types. "Read + Review" for the ISSO corresponds to nothing in `TRAVEL_ROLE_TYPES`; the closest is `approved_user`, which grants site access and nothing else |
| `PROJECT_PLAN.md:116` | *"The `agent-permissions` skill will configure minimal-scope credentials for each checked service"* | `appsscript.json` declares **no** `oauthScopes`, so scopes are inferred and maximal, not minimal (§5.7) |
| `LETS_COMPREHENSIVE_HANDOFF_DOCUMENTATION.md:11` | LETS *"directly adopts ... the **role-based workflows** of the TRIP application"* | Accurate, and the sentence is more load-bearing than intended: LETS adopted TRIP's role-based workflows **including the places where the roles are not enforced** |

**The pattern, stated once.** Where a file's documentation describes *that file's* behavior, it is accurate — `Users.js`, `Reporting.js`, and `Admin_Actions.js` all do what their headers say. Where documentation describes the behavior of *other* files (`Access.js`'s "every access decision," `Validation.js`'s "rolling adoption," `requireRequestEditor`'s "used by"), it describes an intended end state that was never reached. **A reader auditing this system must verify guard presence at the call site, not infer it from the guard's documentation.**

---

## 5.13 Findings carried forward from Pass 5

Severity reflects consequence under the **worst credible** interpretation of the `USER_DEPLOYING` / `USER_ACCESSING` ambiguity (§5.1.1). Where that ambiguity changes the rating, it is stated.

| ID | Finding | Severity | Inherited from TRIP? | Destination |
|---|---|---|---|---|
| **S-1** | **Any authenticated domain user can call `bootstrapTravelAdmin` and grant themselves `admin`.** The chain is complete: writes both rows, clears the role cache so it takes effect immediately, and broadcasts the change. Records `Granted_By: 'bootstrap'` — not the caller | **Critical** | Yes | ISSO items; Administrator's Guide §1.4, §1.8; Gap register |
| **S-2** | **`getRequestForReview` returns any request's complete record to any caller.** Computes permission flags and ignores them. Request IDs are sequential and enumerable. Content is PII + CUI per `PROJECT_PLAN.md:68-69` | **Critical** | Yes | ISSO items; Gap register |
| **S-3** | **`deleteTravelDraftFile` trashes any Drive file ID with no ownership check**; `getTravelDraftFiles` returns metadata for any file ID; `uploadTravelDraftFile` has no size or MIME limit | **High** (Critical if `USER_DEPLOYING`) | Yes | ISSO items; Gap register |
| **S-4** | **5 of 7 `update*` RPCs have no authorization check** — itinerary, travelers, per-traveler costs, shared costs, and `Grand_Total` are editable by any authenticated user on any request in any status. The other 2 implement the check correctly, in the same file | **Critical** | Yes | ISSO items; Gap register; Workflow rules |
| **S-5** | **A role-table read can trigger a production write.** `selfHealCurrentUserEmail` patches `Travel_Users.Email` on a cache miss, rebinding a role set to a new address, attributed to `hc_self_heal`, with the prior value unrecoverable from the database | Medium | Yes | Administrator's Guide §1.6; verification checklist |
| **S-6** | **Attachment sharing to the next reviewer passes `'viewer'`, which is not a valid Drive role.** Three layers of error suppression report success. Probable symptom: reviewers cannot open attachments | Medium | Yes | Gap register; cheap fix + cheap verification |
| **S-7** | **`requireRequestViewer` and `requireRequestEditor` are complete, correct, and never called.** Together they close S-2 and S-4 at roughly one line per call site | **Informational — highest-value constructive finding** | Yes | Enhancement playbook; Gap register |
| **S-8** | **No server-side "last admin" protection.** `deleteRole` / `setRoleActive` can leave zero admins, locking the console for everyone. The protection exists only in browser JavaScript | High | Yes | Administrator's Guide §1.4; Gap register |
| **S-9** | **`fas_fo_reviewer` has no branch in `getReviewerContext`** — resolves to `role: 'none'`, so the FAS reviewer gets no reviewer dashboard, though routing and per-request actions still work | Medium | Yes | Gap register; Workflow rules |
| **S-10** | **`requireRole()` silently grants access for any unrecognized role name.** No `default: throw`. A future developer guarding a new role by name would write a guard that does nothing | Medium | Yes | Gap register — fix before any new role is added |
| **S-11** | **`aas_fo_reviewer` carries `scope: 'all'`** — organisation-wide data visibility identical to admin for all filtering. The role's name does not advertise this | Medium | Yes | Administrator's Guide §1.4; needs a business-owner decision |
| **S-12** | **Two of three site-gate allow-paths are controlled by HC, not by LETS.** Access can be gained or lost with no LETS administrator action and no LETS audit entry; the admin console cannot enumerate these users | High | Yes | Administrator's Guide §1.7; verification checklist |
| **S-13** | **No `oauthScopes` declared.** The effective permission set is inferred from API usage and includes **full Drive** and **all spreadsheets**. Nobody chose it; it expands silently when a new service is called | High | Partly — the manifest is LETS's | ISSO items; Administrator's Guide §1.5 |
| **S-14** | **`Is_Active` parsing treats only `false` / `'false'` as inactive.** Blank, `'no'`, `0`, and typos all read as **active**, so a manual spreadsheet revocation may silently not revoke | Medium | Yes | Administrator's Guide §1.6 |
| **S-15** | **Authorization changes are audited by overwritable current-state columns.** `deleteRole` leaves no record at all; `bulk delete` of requests records only to Cloud Logging. "Who had admin in March" is not answerable from the database | High | Yes | ISSO items; Administrator's Guide §1.8 |
| **S-16** | **`shareAttachmentsWithUsers` + `getRequestAttachments` are both unguarded and compose**: enumerate a request, read its file IDs, grant anyone access | High | Yes | ISSO items; Gap register |
| **S-17** | **`reportDDFundingIssue` and `submitFundingCorrection` are unguarded writes** that change request status and flip `Is_Client_Paid` — the field that determines client vs. overhead funding and drives FAS routing. The two *read/confirm* functions beside them are correctly gated | High | Yes | Gap register; Workflow rules |
| **S-18** | **The 12-function `Validation.js` library has zero adoption** outside its own self-test | Medium | Yes | Enhancement playbook |
| **S-19** | **118 functions are named `_foo`** — a leading underscore, which confers no privacy in Apps Script. Several are destructive (`_bulkDeleteSmokeRequests`) and documented `@editor`. Only the 47 with **trailing** underscores are actually private | High | Yes | Gap register — the cheapest mechanical hardening available |
| **S-20** | **`?mode=budget` and `?mode=dd-confirm` page-servers have no role gate**; `serveTravelBudgetDashboardPage` `Render.js:379` and `serveDDConfirmPage` `:184` check nothing beyond the site gate | Medium | Partly | Gap register (extends Pass 2 R-2) |
| **S-21** | **8 placeholder approver addresses** (`<office>.director@gsa.gov`) are live config defaults, 3 of them rendered on the budget dashboard as real system configuration | Low | No — LETS-original | Gap register; Asset inventory |
| **S-22** | **Gmail v1 advanced service is declared and never used.** `Gmail.` appears nowhere; all mail goes through `GmailApp`/`MailApp` | Low | Yes | Enhancement playbook — one-line surface reduction |
| **S-23** | **6 real named GSA employees' addresses are embedded in routing-test fixtures with their role assignments labelled** (`Submission.js:1284-1322`) | Low | No — LETS-original | Gap register |
| **S-24** | **No CDN subresource integrity.** 34 external `<script>` / `<link>` references to jsDelivr and cdnjs, **zero `integrity=` attributes** `[VERIFIED]`. A CDN compromise executes arbitrary JavaScript in every LETS page, including the admin console | Medium | Yes | ISSO items; Gap register |
| **S-25** | **`verifyPhase7Routing()` is browser-callable and unguarded, and returns the complete role roster** — every admin's name and email, the AAS FO primary and backups, the FAS FO primary, every BU reviewer pair, every sector override, and an `issues` array that names which routing stages are unmanned `OrgLookup.js:192-250` `[VERIFIED]`. Documented *"Run from the Apps Script editor"*, but nothing enforces that | High | No — LETS-era file | ISSO items; Gap register |

**Why S-25 is worth its own row rather than being folded into the 356.** Most unguarded functions expose *one* record or perform *one* action. This one hands an attacker the system's entire authorization map in a single call, including which stages have no reviewer — i.e. exactly where to aim. It is also the ideal first call before exercising S-1, because it tells the caller who the current admins are and therefore whether a new admin row will be noticed. The fix is one line (`requireTravelAdmin();`) or one character (rename to `verifyPhase7Routing_`), and the same reasoning applies to `_checkAllTriggersHealth` `CacheWarming.js:234` and `getAASOrgScope` `OrgLookup.js:84`.

### 5.13.1 The three fixes that remove the most risk per unit of effort

Stated separately because the table above is long and a reader needs a starting point. `[INFERRED]` — this is my prioritisation, not a finding.

1. **Rename every `@editor`-intended function to end in `_`.** Closes S-1 and S-19 outright, plus most of the 64 unguarded writes from Pass 2 R-4. The platform then refuses browser calls with no code change. **One critical caveat, already flagged in Pass 2:** trigger handlers are referenced *by string name*, so `syncDoDPerDiem`, `warmTravelDBCache`, `refreshHCStaffingCache`, `warmGSACitiesCache`, and `syncForeignPerDiem` must **not** be renamed without reinstalling the triggers. `PerDiemSync.js:6-7` warns about exactly this.
2. **Adopt the two per-record gates** (§5.4.2). Six one-line additions close S-2 and S-4. Requires one owner decision about reviewer edit rights in `NEEDS_INFO_*` states.
3. **Declare `oauthScopes` in `appsscript.json`.** Closes S-13 and makes any future scope expansion a visible diff in a pull request. Must be done carefully — declaring too narrow a set breaks features at runtime, so it should be derived from §5.7.2 and then confirmed against the live consent screen.

---

## 5.14 Verification tasks generated by Pass 5

Continuing from V-29. Each needs a human with live Google or GitHub access; **none can be answered from files.** Ordered by how much they unblock.

| # | Task | Why it matters | Where to look |
|---|---|---|---|
| **V-30** | **Record the active deployment's "Execute as" setting.** Is it `USER_ACCESSING` (as the manifest declares) or `USER_DEPLOYING` (as six source comments assert)? | **The highest-priority unknown in this document.** It determines whose credentials every Drive, Sheets, and mail operation uses, and therefore the true severity of S-3, S-13, and S-16. It also decides whether the three `Feedback.js` `UserProperties` "KNOWN BUG" comments describe a real defect | Apps Script editor → Deploy → Manage deployments → the active deployment |
| **V-31** | **Record the actual OAuth consent screen scope list.** Open the project's linked Google Cloud project → OAuth consent, or revoke and re-authorize as a test user and screenshot the prompt | Confirms or corrects the derivation in §5.7.2. Required for any ATO scope documentation (S-13) | GCP console → APIs & Services → OAuth consent screen; or `myaccount.google.com/permissions` as a LETS user |
| **V-32** | **Export `Travel_Users` and `Travel_User_Roles` in full.** Every row, every column, including the raw `Is_Active` cell values | The only way to answer "who are the administrators?" Also tests S-14 — look for any `Is_Active` value that is not a true boolean | Open the database spreadsheet, both tabs |
| **V-33** | **List the Shared Drive's members** (the one behind `SHARED_DRIVE_FOLDER_ID`) | Every travel attachment is visible to that membership regardless of LETS role. The application cannot see or control this (§5.7.3) | Drive → the Shared Drive → Manage members |
| **V-34** | **Test whether attachments actually reach the next reviewer.** Approve a request that has an attachment, then sign in as the next-stage reviewer and try to open it | Confirms or refutes S-6. If it fails, one word fixes it. Cheap test, clear answer | Live app, two accounts |
| **V-35** | **Targeted XSS review of `travelRequestTravelers.html` and `travelReviewController.html`** — specifically, every template-literal interpolation that renders a *name*, *justification*, *comment*, or *trip name* | §5.10.3 — these two files hold ~890 interpolations mixing escaped and unescaped. Needs someone who can distinguish a CSS class from user data | Both files, by hand |
| **V-36** | **Ask the business owner: should `aas_fo_reviewer` see every request in the organisation?** | S-11. The role currently has admin-equivalent data visibility. This is a policy question, not a bug, until the owner says otherwise | Business owner |
| **V-37** | **Ask the business owner: in a `NEEDS_INFO_*` state, should the assigned reviewer retain edit access?** | Gates adoption of `requireRequestEditor` (§5.4.2), which would remove that access. Blocks fix #2 above | Business owner |
| **V-38** | **Confirm whether an HC library is attached — and if so, obtain the distinct `supervisoryStatus` and `occupancyStatus` values it actually emits.** Run `_probeHcForUser('<any surname>')` `CacheWarming.js:1563`, which prints both distributions across the whole bundle before it searches | S-12. The site gate tests `supervisoryStatus === '2'` as a **string** `Access.js:416`. If HC emits a number, the comparison fails for everyone and two of three allow-paths are already dead. Extends Pass 2 V-2 with the specific data needed. *(`_probeHcDistinctValues` `:1510` also exists but requires a field-path argument, which the editor's Run button cannot pass — `_probeHcForUser` defaults its argument and prints the distributions unconditionally at `:1609-1613`)* | Apps Script editor → run the diagnostic → read Logs |
| **V-39** | **Run `verifyPhase7Routing()` and record the `issues` array** | One call reports: no active admin, no active primary AAS FO, no active primary FAS FO, and BU coverage gaps. Directly tests S-8 and S-9 against live data. *(Note: this function is itself unguarded — S-25. Running it is safe; the finding is that anyone can)* | Apps Script editor → run → read Logs |
| **V-40** | **Run `diagnoseTripAccess()` for 3–5 known users** spanning an admin, a BU reviewer, an HC-only supervisor, and someone who should have no access | The only way to enumerate the implicit HC-derived access of S-12. Confirms the gate agrees with intent, one person at a time | Apps Script editor → `_diagnoseAccess()` after editing `TEST_EMAIL` `Access.js:513`. **Note:** `diagnoseTripAccess` itself calls `requireTravelAdmin()` `:531`, so whoever runs it must already hold the `admin` role — being a project editor is not sufficient |
| **V-41** | **Determine whether `bootstrapTravelAdmin` has ever been called by anyone other than the project owner.** Search Cloud Logging for executions of that function name, and check `Travel_User_Roles` for any row with `Granted_By: 'bootstrap'` beyond the expected one | The only available detection for S-1 having been exercised. **Do this before remediating**, because remediation will not preserve the evidence | GCP → Logs Explorer, filtered to the Apps Script project; plus the role tab |
| **V-42** | **Confirm the sender address production actually uses.** Read the `travel_email_address` Script Property, and check whether a send-as alias exists on the executing account | §5.5.1 — two different hardcoded defaults exist (`aastravel@` vs `ASD.Travel-Events@`). If no alias exists, mail silently falls back to `MailApp` and arrives from a different address | Project Settings → Script Properties; Gmail settings of the executing account |
| **V-43** | **Record who holds Apps Script project editor access, spreadsheet edit access, and the GitHub `CLASPRC_JSON` secret** | These are privileges 1–3 in §5.8's ranking — all above the application's own `admin` role. Re-states Pass 2 V-3 / V-7 / V-8, which remain the largest unanswered governance questions | Project share dialog; Drive share dialog; GitHub → Settings → Secrets |

---

## 5.15 What Pass 5 means for the deliverables

Mapping forward, so the nine documents can be written without re-deriving this.

| Deliverable | What Pass 5 supplies |
|---|---|
| `ADMINISTRATOR_GUIDE.md` §1.4 (roles) | The §5.9 matrix, verbatim. Plus the three structural observations: `aas_fo_reviewer` is all-data, HC roles are invisible to the console, primary/backup is routing not privilege |
| `ADMINISTRATOR_GUIDE.md` §1.6 (operations) | §5.6 — revoke through the console not the spreadsheet; the 600-second staleness window; the `Is_Active` parsing trap; the self-heal write |
| `ADMINISTRATOR_GUIDE.md` §1.5 / §1.8 (control, accountability) | §5.8's privilege ranking — the application's `admin` is **fourth**. Plus §5.6.4's audit coverage table and S-15 |
| `ADMINISTRATOR_GUIDE.md` §1.7 (dependencies) | §5.1.2 and S-12 — access delegated to HC, undeclared binding, silent failure mode |
| `GAP_REGISTER.md` | S-1 through S-25, with the inherited-from-TRIP column preserved: it determines who owns each remediation |
| `ENHANCEMENT_PLAYBOOK.md` | §5.4.2's adoption table and §5.13.1's three fixes, including the trigger-rename caveat |
| `WORKFLOW_AND_BUSINESS_RULES.md` | §5.3.6's state machine (the one gate that works), plus S-4 and S-17 as rules that are *documented but unenforced* |
| `SYSTEM_STATE.md` | §5.11's 15 strengths, and the §5.12 contradiction table |
| `HUMAN_VERIFICATION_CHECKLIST.md` | V-30 through V-43. **V-30 is the single most consequential item in the entire checklist** and should lead it |

---

*End of Pass 5. Next: Pass 6 — gap consolidation: merge the findings of Passes 1–5 into one severity-ranked register, reconcile duplicate IDs across passes, and resolve the final numbering before the nine deliverables are written.*
