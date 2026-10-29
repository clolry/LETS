---
title: "LETS Administrator's Guide"
description: "How to obtain, hold, and account for administrative and security control of the Logistics, Events, and Travel System"
status: canonical
tier: 1
audience: "project manager, system owner, ISSO"
last_updated: "2026-10-29"
evidence_base: "docs/GAP_CONSOLIDATION_PASS6.md and docs/evidence/*.js"
---

# LETS Administrator's Guide

**Deliverable 1 of 10.** Written for a capable project manager who is not a programmer.

---

## How to read this document

This guide answers one question in eight parts: **what do you need to know to actually be in charge of this system?**

Every factual claim carries a confidence marker:

| Marker | Meaning |
|---|---|
| `[VERIFIED]` | Read directly from the source code or measured by a script in `docs/evidence/` |
| `[INFERRED]` | A reasoned conclusion from verified facts, labelled so you can disagree with the reasoning |
| `[CLAIMED]` | Asserted by project documentation and **not** confirmed in code |
| `[UNKNOWN]` | Cannot be determined from the repository — requires someone with live access |

Findings are cited as **`G-NNN`**, verification tasks as **`VT-NN`**, and decisions only you can make as **`BD-N`**. All three are defined in [`GAP_CONSOLIDATION_PASS6.md`](./GAP_CONSOLIDATION_PASS6.md). Code is cited as `file.js:line` so a developer can go straight to it.

**Where this guide and the project's own documentation disagree, this guide follows the code and names the document that is wrong.** That happens eleven times. It is not criticism of whoever wrote those documents — most of them describe intent accurately, and the code drifted.

### Three things to know before you read further

1. **The system is live and in use.** This is not a design review of something unbuilt. People are submitting travel requests through it today.
2. **The most serious findings are inherited, not introduced.** 84% of the application code is byte-identical to the GSA/AAS TRIP application that LETS was directed to adopt as its foundation `[VERIFIED]`. All six Critical findings live in that inherited code. §1.8.4 treats this honestly in both directions.
3. **One two-minute task gates almost everything in §1.5 and §1.8.** It is **VT-01**. If you do nothing else after reading this, do that.

---

## §1.0 The short version

If you read only this page, read this table.

| Question | Answer |
|---|---|
| **What is it?** | A Google Apps Script web application, bound to a Google Sheet that serves as its database. One web address; the screen you get depends on a `?mode=` value in the URL |
| **Who can reach it?** | Anyone with a GSA Google account who passes the site gate. **Two of the gate's three allow-paths are controlled by an external HR data source, not by you** (§1.7) |
| **Who is in charge of it?** | Not the person holding the application's `admin` role. That role is **fourth** in actual power, behind Apps Script project editors, spreadsheet editors, and whoever holds the CI deployment secret (§1.5) |
| **How do I grant and revoke access?** | Through the admin console at `?mode=admin`. **Not** by editing the spreadsheet — §1.6.2 explains why that can silently fail to revoke anything |
| **Is it secure?** | It has real strengths — no credential handling, no back doors, every role check fails closed. It also has six Critical findings, all inherited from TRIP, centred on one defect: **the server does not check who is calling it** (§1.4.5) |
| **Can I see who did what?** | For travel decisions, yes — the audit trail is good. For **changes to who holds access**, largely no (§1.8) |
| **What is the single biggest unknown?** | Whether the deployment runs as `USER_ACCESSING` or `USER_DEPLOYING`. The manifest says one thing and eight source comments say the other. It changes whose credentials every file and database operation uses (§1.3.4, **VT-01**) |

### The one-paragraph version

LETS is a working travel-request and approval system built on a proven foundation, with a budget-governance layer that is written but not yet connected to anything. Its approval workflow is sound and well audited. Its weakness is that the browser can call roughly 412 server functions directly, and about 51 of those change data without checking who is asking `[VERIFIED]` — which means the access controls you administer through the console describe what the *screens* allow, not what the *system* allows. Two complete, correct fixes for the worst of this already exist in the codebase and have never been switched on (**G-067**). Closing the gap is a small amount of work, and knowing that it is small is the most useful thing in this guide.

---

## §1.1 What the system is

### 1.1.1 In plain terms

LETS is a **web application that runs inside Google's infrastructure**, not on a server GSA operates. There is nothing to patch, no operating system to maintain, and no hosting bill. Google runs the code; GSA owns the code and the data.

Its database is **a Google Sheet** `[VERIFIED]`. Not a metaphor — the requests, travellers, costs, approvals, and user roles are rows in tabs of a single spreadsheet, and anyone with edit access to that spreadsheet can change any of it directly. That fact drives much of §1.5 and §1.6.

| Component | What it actually is | Identifier |
|---|---|---|
| The application | A Google Apps Script project | `1xDKibOChZtiBW4c1CP2xwbwNLPP-cH-Dgk8jFAPSryIKuL8VaF-tcGJr` `[CLAIMED]` — from `PROJECT_PLAN.md`; **confirm via VT-21** |
| The database | A Google Sheet the script is bound to | `1kXB7eVII_EOlZEHSd-4vl3psTJZv57JvnrplhD2FA9Y` `[CLAIMED]` |
| The code of record | This GitHub repository | `github.com/clolry/LETS` `[CLAIMED]` |
| Deployment | GitHub Actions pushes code to Apps Script | `.github/workflows/deploy-gas.yml` `[VERIFIED]` |

### 1.1.2 It is two systems in one codebase, and only one of them runs

This is the most important structural fact about LETS, and no project document states it plainly.

| | **System A — travel workflow** | **System B — budget governance** |
|---|---|---|
| Origin | Inherited from TRIP, largely unmodified | Written for LETS |
| What it does | Intake, routing, review, approval, notification, attachments | Budget commitment, set-aside shares, reconciliation, FAS compliance sync |
| Files | ~87 inherited code files `[VERIFIED]` | 4 modules: `BudgetEngine.js`, `RequestService.js`, `LetsDB.js`, `FASTrackerSync.js` `[VERIFIED]` |
| **Is it running?** | **Yes.** Every screen a user sees is System A | **No.** Nothing can call it |
| Budget awareness | **None.** System A approves travel without consulting any budget `[VERIFIED]` | It is the budget logic |
| Cost awareness | It calculates per-diem, mileage, and totals | **None.** It checks budgets without reading System A's cost figures `[VERIFIED]` |

**Why System B does not run, stated precisely.** All four LETS modules are written as JavaScript *module factories* — a pattern that wraps everything inside a function and exposes it on a single named object. Google Apps Script only makes **top-level** functions callable from a web page. All four modules expose **zero** top-level functions `[VERIFIED]`, and no code anywhere else in the application calls into them `[VERIFIED]`. This is finding **G-016**, and it is stronger than "the wiring is incomplete" — there is currently no way to reach that code at all.

**What this means for you, in three consequences:**

1. **The advertised "mandatory budget check" does not happen.** A travel request can be approved today with no budget consulted `[VERIFIED]`. If leadership believes budget enforcement is live, that belief is wrong.
2. **Thirteen of the findings in the gap register describe defects in code nobody can currently trigger.** They are real, but latent. Do not spend the first remediation cycle on them.
3. **That same fact makes them cheap.** There is no production data in those tabs to migrate and no user depending on current behaviour. **The budget module is cheaper to fix now than it will ever be again.** This is the single most useful scheduling fact in the whole assessment.

> **`PROJECT_PLAN.md` is misleading on this point.** It describes LETS as "layering in an active financial governance engine" `[CLAIMED]`. The engine exists and is well written; it is not active, and "layering in" understates what remains — the two systems also disagree about which cost figure is authoritative, which is **BD-4**, a decision only you can make.

### 1.1.3 What was inherited, modified, and written fresh

Measured by comparing every file byte-for-byte against the TRIP reference snapshot `[VERIFIED]` — `docs/evidence/pass6_manifest_recount.js`.

| | Files | Share of code |
|---|---|---|
| **Inherited unmodified from TRIP** | 87 | **84%** |
| **Modified by LETS** | 5 | 5% |
| **Written for LETS** | 12 | 12% |

The five modified files are worth knowing by name, because they are the entire surface where LETS changed inherited behaviour `[VERIFIED]`:

| File | What LETS changed |
|---|---|
| `server/00_config/TripConfig.js` | LETS configuration, FAS tracker environment gate |
| `server/50_pages/Render.js` | Added the budget dashboard page-server |
| `server/90_entrypoint/doGet.js` | Added the `?mode=budget` route |
| `client/pages/travelPortalPage.html` | Branding and navigation |
| `client/pages/travelRequestPage.html` | Intake-form changes, including the FAS notice (**G-022**) |

**Read that distribution carefully.** It is the reason this guide can tell you the inherited application is proven in production use — and the reason §1.8.4 has to raise the question of whether it was ever reviewed before being adopted.

### 1.1.4 What does not exist, despite being referenced

| Referenced as existing | Reality | Finding |
|---|---|---|
| A "Stage 1 persistence schema" (`LETS_SYSTEM_*` tables) | **Found nowhere** in the repository or its entire git history `[VERIFIED]` | **G-047** |
| `Data_Model_v2.md`, `BUGS_FOUND.md`, `OPEN_QUESTIONS.md`, `REFACTOR_PLAN.md` | Referenced by code comments; **in no commit** `[VERIFIED]` | **G-046** |
| Automatic sync to the FAS Travel Exception Tracker | The intake form tells users it happens. It does not `[VERIFIED]` | **G-022** |
| A spreadsheet custom menu | No simple triggers exist at all — no `onOpen` anywhere `[VERIFIED]` | **G-066** |

**G-022 deserves a sentence of its own.** The intake form displays a notice telling users their request will be synced to the FAS tracker for Executive Order 14222 compliance. No such sync runs. This is the cheapest high-value fix in the entire assessment — a wording change — and until it is made, the system is making a compliance representation to users that is not true.

---

## §1.2 What it does today

### 1.2.1 The travel request lifecycle, as actually implemented

A request moves through up to four review stages, then a funding-confirmation step `[VERIFIED]`.

```
SUBMIT
  │
  ├─→ PENDING_SECTOR ──approve──→ PENDING_BU ──approve──→ PENDING_OSO
  │        │                          │                       │
  │   needs_info                 needs_info              needs_info
  │        ↓                          ↓                       ↓
  │   NEEDS_INFO_SECTOR          NEEDS_INFO_BU           NEEDS_INFO_OSO
  │        └──── resubmit ───────────┴───────────────────────┘
  │                                                          │
  │                                                     approve
  │                                                          ↓
  │                        ┌──── any traveller overhead-funded? ────┐
  │                        │ YES                               NO   │
  │                        ↓                                        ↓
  │                   PENDING_FAS ──fas_approve──→  APPROVED_GOGOV ←┘
  │                        │                               │
  │                     fas_deny                           ↓
  │                        ↓                   PENDING_DD_CONFIRMATION
  │                     DENIED                   (one per traveller's
  │                                               Division Director)
  │                                                        │
  │                                      all confirmed ────┴──── issue reported
  │                                              ↓                      ↓
  │                                          COMPLETED          Pending_Correction
  │                                                                     │
  └─────────────────────────────── (submitter fixes funding) ───────────┘
```

**Four things in that diagram will surprise a reader who has only seen the project documentation:**

| Surprise | Detail | Finding |
|---|---|---|
| **`COMPLETED` does not mean the trip happened** | It means the last Division Director confirmed funding — which occurs **before travel** `[VERIFIED]` `Review_DDConfirm.js:364-369`. There is no post-travel status, no actual-cost capture, and no reconciliation anywhere in the running system | **G-019** |
| **A request can be approved with no human review at all** | If the AAS Front Office reviewer submits a request where every traveller is client-paid, the skip rules route past every stage and the FAS branch sees no overhead cost — so it lands at `APPROVED_GOGOV` immediately `[VERIFIED]` `Submission.js:100-101, 161-183` | **G-018** |
| **A blank funding field counts as overhead** | The test is `!val \|\| val === 'overhead'` `[VERIFIED]` `Review_Action.js:528-529`. This is the correct conservative default — a missing value routes to *more* scrutiny, not less | *(a strength)* |
| **No budget is consulted at any point** | Nothing in this diagram touches a budget `[VERIFIED]` | **G-015**, **G-016** |

**G-019 needs translating into operational terms, because it will mislead a dashboard reader.** If you look at a report and see a request marked `COMPLETED`, that tells you the funding was confirmed before the trip. It does **not** tell you the trip occurred, what it cost, or whether anyone reconciled the estimate against reality. Any statement to leadership about "completed travel spend" built on that status would be wrong. The system is an approval system that stops at approval.

**G-018 is a policy question disguised as a defect.** It is the emergent result of two individually sensible rules: *you cannot review your own request*, and *client-paid travel needs no FAS review*. Together they produce self-approval. Whether that is acceptable is **BD-6** — your decision, not an engineering one. It should be a conscious policy, documented either way.

### 1.2.2 The approval state machine is the system's strongest component

Worth stating plainly, because §1.4 is going to be critical: **the approval decisions themselves are correctly controlled.**

`getActionConfig(action, currentStatus)` `Review_Action.js:303` is a single source of transition truth with **twelve** defined actions `[VERIFIED]`. Each specifies the status it is valid from, the status it produces, whether comments are mandatory, and the role recorded. `submitReviewAction` enforces **both** that the caller is the assigned reviewer **and** that the transition is legal from the current status `[VERIFIED]`.

That is the one place in the system where authorization is done properly end to end. **Six of the twelve** actions require written comments — every `needs_info`, every denial, and reviewer-initiated cancellation `[VERIFIED]`. An administrator can trust that an approval in the log was made by the assigned reviewer from a valid state.

### 1.2.3 The screens, and which ones work

One web address. The screen is selected by `?mode=` `[VERIFIED]` `doGet.js:28-61`.

| `?mode=` | Screen | Gate beyond the site gate | Status |
|---|---|---|---|
| *(none)* or `travel` | Personal portal — own requests, drafts, items awaiting your review | **None** | Works |
| `form` | Six-step new-request intake | **None** | Works. Shows a false FAS-sync notice (**G-022**) |
| `review` | Review one request | **None at page level** | Works |
| `dd-confirm` | Division Director funding confirmation | **None at page level** | Works |
| `admin` | Full admin console | **`isTravelAdmin`** `Render.js:216` | Works, **except the Users tab** (**G-017**) |
| `reviewer-dashboard` | Scoped metrics for reviewers | Role context | **Throws an error** (**G-017**) |
| `budget` | LETS budget dashboard | **None** | Renders, but **every number is hardcoded** (**G-025**) |
| `access-blocked` | "You don't have access" card | n/a | Works |
| *anything else* | Silently serves the portal | None | Works `[VERIFIED]` `doGet.js:58-60` |

### 1.2.4 Three screen-level defects you need to know about

**G-017 — four broken file references, and one of them disables user administration.**

Three files in the repository are named with a doubled extension — `travelUsersController.html.html` instead of `.html` — and a fourth reference is a simple typo `[VERIFIED]`. Apps Script cannot find them. Consequences:

| Broken reference | Effect |
|---|---|
| `client/pages/travelReviewerDashboardPage` | `?mode=reviewer-dashboard` **throws** for every non-admin reviewer. Admins never see it, because they are redirected to `?mode=admin` first `Render.js:278` |
| `client/controllers/admin/travelUsersController` | **The admin console's Users tab has no controller.** The navigation button exists; the code behind it never loads `[VERIFIED]` |
| `client/styles/travelUsersStyles` | Users tab unstyled (the real file is `travelUserStyles`, singular) |
| `client/components/flatpickrConfig` | Date-picker configuration missing on the intake form and review page |

**The second row is the one that matters for this guide.** §1.6 is going to tell you to administer roles through the console rather than the spreadsheet. **G-017 may mean the console's Users tab does not function** — and the client-side "last admin" protection described in §1.4.6 lives inside that same unloadable file `[VERIFIED]`. Confirm with **VT-20** before relying on the console.

All four are inherited from TRIP — the same four names are broken in the reference application `[VERIFIED]`. The fix is three `git mv` commands and one typo correction, **but confirm against the live project first** (**VT-20**): if the deployed project has correctly-named files, renaming in the repository would break what currently works.

**G-025 — the budget dashboard is a mockup presented as a system.**

`?mode=budget` renders a complete-looking budget dashboard with roughly 30 hardcoded figures and a sync button that does nothing `[VERIFIED]`. Three of the approver names on it are placeholder addresses of the form `<office>.director@gsa.gov` (**G-063**).

**Anyone who can reach the system can open it.** There is no role check `[VERIFIED]`. A user shown this page would reasonably believe they are looking at live budget data.

**G-011 — two pages have no role gate at all.**

`?mode=budget` and `?mode=dd-confirm` apply no check beyond the site gate `[VERIFIED]` `Render.js:379, :184`. For `dd-confirm` this is partly mitigated — the data it loads is filtered by the caller's email matching a traveller's Division Director field. For `budget` there is nothing: the page is protected only by the fact that no link points to it.

> **That distinction matters and is often confused.** Hiding the admin and reviewer links in the navigation is cosmetic — anyone can type `?mode=admin`, and the real protection is the server-side `isTravelAdmin` check, which is sound `[VERIFIED]`. But `?mode=budget` has **no** server-side check, so hiding its link is the *only* protection. That is security by obscurity and should be treated as no protection at all.

---

## §1.3 How to reach it, and how code gets into it

### 1.3.1 The ways in

| # | Path | Who can use it | What it reaches |
|---|---|---|---|
| 1 | **The web app URL** | Anyone with a GSA Google account who passes the site gate | The eight screens in §1.2.3 |
| 2 | **Direct server calls from a browser** | **Anyone who passes the site gate** | Roughly **412 server functions**, most with no authorization check — see §1.4.5 `[VERIFIED]` |
| 3 | **The Apps Script editor** | Project editors | Everything. Run any function, read every stored secret |
| 4 | **The Google Sheet** | Anyone with Drive edit access | Every row of every table, directly |
| 5 | **GitHub Actions** | Whoever can merge to `main` | Replaces the production code |
| 6 | **Five scheduled triggers** | Nobody — they run themselves | Cache warming and per-diem synchronisation |

**Paths 1 and 2 are different, and the difference is the central security fact of this system.** Path 1 is what you administer. Path 2 is what the system actually permits. §1.4.5 explains it.

**The web app URL is not recorded anywhere in this repository** `[UNKNOWN]`. Obtain it via **VT-01**.

### 1.3.2 There is no spreadsheet menu

Apps Script projects conventionally add a custom menu to their bound spreadsheet for administrative functions. **LETS has none** — there are no simple triggers anywhere in the codebase, no `onOpen`, no `onEdit` `[VERIFIED]`. This is finding **G-066**, rated Informational.

It matters only because an administrator who has worked with other Apps Script tools will go looking for that menu and conclude something is broken. Nothing is broken; the menu was never built. Administrative functions live in the `?mode=admin` console and in the Apps Script editor.

### 1.3.3 The five scheduled jobs

These run on Google's schedule with no human present `[VERIFIED]`.

| Handler | Schedule | Purpose |
|---|---|---|
| `refreshHCStaffingCache` | every 10 minutes | Refresh the HR staffing bundle |
| `warmTravelDBCache` | every 5 minutes | Keep the database cache warm |
| `warmGSACitiesCache` | every 6 hours | GSA per-diem city list |
| `syncDoDPerDiem` | daily at 06:00 | Department of Defense per-diem rates |
| `syncForeignPerDiem` | daily at 06:00 | State Department foreign per-diem rates |

**Two operational facts about triggers that catch administrators out:**

1. **Triggers belong to the person who installed them, and are invisible to everyone else.** If the person who installed these leaves GSA and their account is disabled, the triggers stop and **no error is reported to anyone**. Per-diem rates would quietly go stale. No single account can see the full list — this is why **VT-18** asks each project editor to run the health check separately.
2. **Google references these five handlers by their function name as text.** `ScriptApp.newTrigger('warmTravelDBCache')` `[VERIFIED]`. Renaming any of them in the code silently breaks the installed trigger — the schedule survives, pointing at a function that no longer exists. This is a real hazard for the remediation described in §1.4.5, which involves renaming functions, and the exclusion is already built into the evidence script.

### 1.3.4 The deployment question that gates everything else

**This is the single most consequential unknown in the entire assessment.**

Every Apps Script web app runs in one of two modes, chosen when the deployment is created:

| Mode | What it means |
|---|---|
| **`USER_ACCESSING`** | Server code runs with **the visiting user's** Google permissions. A user can only read the database if they personally have access to that spreadsheet |
| **`USER_DEPLOYING`** | Server code runs with **the deploying owner's** permissions. Every user's every action is performed with the owner's full credentials |

**The evidence conflicts:**

| Source | Says | Status |
|---|---|---|
| `lets_app/appsscript.json:20` | `"executeAs": "USER_ACCESSING"` | `[VERIFIED]` in the file |
| **Eight comments across six source files** | `USER_DEPLOYING` — including `Attachments.js:5` *"Architecture (USER_DEPLOYING mode)"* and `Reporting.js:310` *"The web app runs as the deploying owner (USER_DEPLOYING)"* | `[VERIFIED]` as comments |

**And the manifest is not authoritative.** The "Execute as" setting is stored on the *deployment*, not in the pushed manifest file. A deployment created with one setting keeps it regardless of what the manifest says afterwards. `clasp push` cannot change it, and reading the file cannot tell you what it is `[VERIFIED]`.

**Why you cannot defer this.** Under `USER_DEPLOYING`, every unguarded server function in §1.4.5 executes with the owner's full Drive and Sheets credentials — so a user who should have no access to a file can cause the system to act on it anyway. Five findings move from "any user can corrupt data" to "any user can corrupt data **using a privileged identity**": **G-003, G-005, G-012, G-027, G-044**.

**The code behaves as though `USER_DEPLOYING` is true.** `Attachments.js:5-11` explicitly explains that uploads work *because* of it. `HCStaffing.js:6` says the cache-miss path relies on it. Three comments in `Feedback.js` describe known bugs that only occur under it `[VERIFIED]`. That is eight independent places where a developer wrote code assuming the opposite of what the manifest declares.

> **Two things follow, and both are actions.**
>
> **VT-01 — two minutes.** Open the Apps Script editor → Deploy → Manage deployments, and read the active deployment's "Execute as" and "Who has access" values. Record them.
>
> **BD-1 — your decision.** VT-01 tells you what the setting *is*. Only you can say what it *should be*. Those are different questions, and whichever way it resolves, one of the two bodies of evidence in this codebase is wrong and should be corrected so the next reader is not misled.

### 1.3.5 How code reaches production

```
developer → pull request → verify.yml (tests, NO credentials — cannot deploy)
                              ↓
                      human merges to main
                              ↓
          deploy-gas.yml → clasp push --force → production Apps Script project
```

**This pipeline is better designed than most, and the design is deliberate** `[VERIFIED]`:

| Control | Why it is right |
|---|---|
| The deploy workflow has **no `pull_request` trigger** | Deploying on PR would mean opening a PR *is* the deploy, defeating review entirely. The workflow file documents this reasoning and cites NIST CM-3 and CM-5 |
| `verify.yml` runs with **no credentials at all** | It structurally cannot deploy, including from fork PRs |
| A **CI guard fails the build** if a `pull_request` trigger reappears in the deploy workflow | The fix cannot silently regress |
| `clasp` is **pinned to an exact version** (`3.4.1`) | An unpinned install would put an uncontrolled third-party version on the production deploy path |
| `.claspignore` lists test files **explicitly rather than by glob** | All pushed `.js` files share one global scope in Apps Script, so a pushed test file's `require()` would throw and take down the entire app. A CI guard enforces the list |

Whoever wrote this understood the platform's hazards and wrote down why. **This is LETS-original work and it is the strongest security engineering in the project.** §1.8.4 returns to it.

### 1.3.6 Two real weaknesses in that pipeline

**G-021 — standing deploy authority with no second approval.**

Whoever holds the `CLASPRC_JSON` GitHub secret can push code directly to production, bypassing the pipeline entirely `[VERIFIED]`. There is **no branch protection** on `main` `[VERIFIED]`, so a single person with write access can merge their own change and have it deployed automatically.

**Push is not the same as deploy.** The workflow runs `clasp push --force`, which replaces the project's *code*. It does **not** run `clasp deploy` `[VERIFIED]`, so whether a code push reaches users immediately depends on how the deployment is configured — another thing **VT-01** should capture.

**G-048 — an undocumented third Apps Script project is wired to the repository root.**

| Project | Script ID | Where configured |
|---|---|---|
| Production | `1xDKibOChZtiBW4c1CP2xwbwNLPP-cH-Dgk8jFAPSryIKuL8VaF-tcGJr` | `lets_app/.clasp.json` `[VERIFIED]` |
| Sandbox | `1PLzwA_TinEaBrqPGBMM1pnyinqiFtu3goBmX3sOW36hgRjDyqfyyHzfm` | `lets_app/.clasp.sandbox.json` `[VERIFIED]` |
| **Unknown third** | `181ocqi16Ruzb0kaPTiAC8OMXRp9bLwbfH-McBXImV6d5IKe9L751VFGF` | **`.clasp.json` at the repository root** — untracked by git `[VERIFIED]` |

The third is in no project document. Its config has `"rootDir": ""` and `"skipSubdirectories": false`, meaning a `clasp push` run from the repository root would push **the entire repository** — including the TRIP reference snapshot — into it. Resolve via **VT-21**.

A minor related note: **`lets_app/.claspignore` does not exclude `.DS_Store`, and two now exist inside `lets_app/`** — at `lets_app/.DS_Store` and `lets_app/server/.DS_Store` `[VERIFIED]`. Both are untracked by git, so a reviewer looking at a pull request would not see them, **but `clasp push --force` would carry them into the production project.** They are macOS folder-metadata files, not code; the practical cost is clutter rather than risk.

> **It is worth noting *why* this is listed at all.** When these documents were written there was one such file; a second appeared during the work. **An ignore list maintained by hand drifts in exactly this way** — silently, between reviews, in files nobody is watching because they are untracked. The one-line fix is to add `.DS_Store` (or `**/.DS_Store`) to that file. The CI guard in `verify.yml` checks that test files are listed; it does not check this.

---

## §1.4 Roles, and who actually holds them

### 1.4.1 The six roles as designed

Defined in `TRAVEL_ROLE_TYPES` `Users.js:20-27` `[VERIFIED]`. The descriptions are the ones the admin console shows `[VERIFIED]`.

| Role | Console label | What it is for | Needs a scope value? |
|---|---|---|---|
| `admin` | Admin | Full access to the admin console | No |
| `aas_fo_reviewer` | AAS-FO Reviewer | Reviews at the AAS Front Office stage | No |
| `fas_fo_reviewer` | FAS-FO Reviewer | Reviews overhead-funded requests at the FAS stage | No |
| `bu_reviewer` | BU Reviewer | Reviews for a specific business unit | **Yes** — BU name |
| `sector_override` | Sector Reviewer | Overrides the synced sector director for a sector | **Yes** — sector code |
| `approved_user` | Site Access | Grants access to a non-supervisor. No reviewer or admin rights | No |

Roles are rows in the `Travel_User_Roles` tab. A person can hold several. Each row carries `Is_Active` and `Is_Primary` flags.

### 1.4.2 Plus two roles that exist in no table

**This is the part an administrator must not miss.** The site gate has three independent allow-paths, and only one of them is yours `[VERIFIED]` `Access.js:394-436`:

| Allow-path | Controlled by |
|---|---|
| An active row in `Travel_User_Roles` | **A LETS administrator — you** |
| A filled HC supervisor position (`supervisoryStatus === '2'`) | **The HR data source.** No LETS action, no LETS record |
| An HC office title containing "chief of staff" or "client executive", in a filled seat | **The HR data source**, same |

So two further roles effectively exist:

| Implicit role | What it grants | Visible in the admin console? |
|---|---|---|
| **HC supervisor** | Site access | **No** |
| **HC Chief of Staff / Client Executive** | Site access **and** BU-reviewer scope derived from their title | **No** |

**Three consequences you need to hold onto:**

1. **`listTravelUsers` will not show these people** `[VERIFIED]`. The admin console cannot enumerate everyone who has access. If an auditor asks "who can get into this system", the console gives an incomplete answer and does not indicate that it is incomplete.
2. **Access can be gained or lost with no action by you and no entry in any LETS log.** Someone promoted into a supervisory seat gains access; someone whose seat is vacated loses it.
3. **You cannot revoke it.** Removing a `Travel_User_Roles` row does nothing to an HC-derived grant.

This is finding **G-008**, and §1.7 covers the dependency itself.

### 1.4.3 What each role can actually do

Built from enforced behaviour, not role names `[VERIFIED]`.

| Capability | `admin` | `aas_fo` | `fas_fo` | `bu` | `sector` | `approved_user` | HC supervisor | HC COS/CE |
|---|---|---|---|---|---|---|---|---|
| Pass the site gate | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Data scope granted | all | **all** | — | named BUs | sector codes | — | — | derived BUs |
| Submit a request | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reviewer dashboard | → admin | ✅ | **❌** | ✅ | ✅ | ❌ | ❌ | ✅ |
| Act on an **assigned** request | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | n/a | n/a |
| Act on an **unassigned** request | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Admin console | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Grant / revoke roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Override any status | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bulk delete requests | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Export all data | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Read any request in full** | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** | **✅** | **✅** |
| **Edit any request's costs, travellers, itinerary** | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** | **✅** | **✅** |
| **Grant themselves `admin`** | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** | **✅** | **✅** |

### 1.4.4 Read that table twice

**Top to bottom, it describes a careful role design.** Six roles, scoped visibility, admin-only destructive operations, routing driven by primary/backup assignment. That design is real and it was thought about.

**The last three rows are the finding.** They are all ✅ for everyone, including a user whose only role is "Site Access — no admin or reviewer privileges."

Those three rows are not a different design. They are the *same* design, not enforced on the server. The console enforces the upper rows faithfully; the server does not enforce the lower three at all. §1.4.5 explains the mechanism.

**Three structural observations that belong in your head before you grant anything:**

1. **`aas_fo_reviewer` is an all-data role** (**G-031**). Its scope is `type: 'all'` `[VERIFIED]` `Access.js:988` — identical to admin's for every filtering purpose. If the business understands "Front Office reviewer" as a stage role, that understanding is wrong. **Whether it should be is BD-2**, your decision.
2. **`fas_fo_reviewer` gets no reviewer dashboard** (**G-029**). The role is grantable and routing uses it `[VERIFIED]` `Submission.js:882`, but it has no branch in the function that resolves a role into a dashboard view `[VERIFIED]`, so it resolves to "none". The FAS reviewer can still do their job — approvals happen on the review page, which checks the assigned-reviewer field rather than the role — which is probably why nobody has reported it `[INFERRED]`.
3. **Primary versus backup is routing, not privilege.** `Is_Primary` decides who gets routed to `[VERIFIED]` `Submission.js:800-812`. It grants nothing and restricts nothing. A backup BU reviewer has exactly the same data scope as the primary.

### 1.4.5 Why the last three rows are ✅ — the one defect behind the six Criticals

This is the only technical mechanism in this guide you need to understand, and it is simple.

A web page in this system talks to the server by calling server functions by name. Google makes **every top-level function in the project** callable this way — not only the ones the screens use.

| Measure | Count |
|---|---|
| Server functions defined | 459 `[VERIFIED]` |
| **Callable from any authenticated browser** | **412** `[VERIFIED]` |
| Functions the screens actually use | 61 `[VERIFIED]` |
| **Callable but used by no screen** | **351** `[VERIFIED]` |
| Of the 412, those that **change data with no authorization check** | **51** `[VERIFIED]` |
| Behind a real refusing guard | 31 `[VERIFIED]` |

So: **the screens are not the boundary.** Hiding a button, hiding a link, or showing someone the access-blocked page controls what they *see*. It does not control what they can *call*.

Everything in §1.4.3's last three rows follows from this one fact:

| Row | The function behind it | Finding |
|---|---|---|
| Read any request in full | `getRequestForReview` computes permission flags and then returns the record regardless `[VERIFIED]` | **G-004** |
| Edit any request | Five of seven `update*` functions check nothing — itinerary, travellers, per-traveller costs, shared costs, grand total `[VERIFIED]` | **G-003** |
| Grant themselves admin | `bootstrapTravelAdmin` writes an admin role row for the caller and clears the role cache so it takes effect at once `[VERIFIED]` | **G-002** |

**Two aggravating details.** Request IDs are sequential, so "you need to know the ID" is not a control `[VERIFIED]`. And 118 functions are named with a **leading** underscore — `_bulkDeleteSmokeRequests`, for instance — which looks private but confers nothing in Apps Script; only a **trailing** underscore does `[VERIFIED]`.

> **The constructive half, and it is genuinely good news.** Two functions named `requireRequestViewer` and `requireRequestEditor` already exist in this codebase. They are **complete, correct, and called from nowhere** — zero call sites `[VERIFIED]`. Together they close **G-003** and **G-004** at roughly one line per call site.
>
> This is finding **G-067**, and it is the highest-value item in the whole assessment. Someone wrote the right fix and never switched it on. Adopting it requires one decision from you first — **BD-3**: in a "needs more information" state, should the assigned reviewer keep edit access? `requireRequestEditor` would remove it.

### 1.4.6 Two role-management hazards

**G-007 — nothing on the server prevents deleting the last admin.**

`deleteRole` and `setRoleActive` will happily remove the final active `admin` row, locking the console for everyone `[VERIFIED]`. The protection exists — a thorough "last admin" check with a blocking dialog — but it is **browser JavaScript only** `[VERIFIED]`, and it lives in `travelUsersController.html.html`, the file that **G-017** prevents from loading at all.

**Practical guidance: maintain at least two active admins at all times, and verify the count before removing anyone.** **VT-11** reports whether an active admin exists; **VT-05** gives you the full list.

**The "view-as" feature is safe — assessed deliberately.**

An admin can view the reviewer dashboard as another role via `?mode=reviewer-dashboard&force=1&as=<role>`. A client-supplied value flowing into the function that decides data scope is exactly the shape of a privilege-escalation bug. **It is not one** `[VERIFIED]`, for three independent reasons: the override is applied only inside the admin branch so a non-admin never reaches it; it can only *narrow* scope, never widen it; and malformed input returns null and is ignored rather than partially applied.

Worth knowing if an auditor asks: **impersonation is not logged**, because it is a read-only simulation that changes nothing `[VERIFIED]`. The label is marked with "(test)" so the UI can tell the user.

---

## §1.5 Who controls what

### 1.5.1 The application's `admin` role is fourth in actual power

This is the most important thing in this guide for someone whose job is to be in charge of the system. **Granting yourself the `admin` role does not make you the most privileged person in it.**

Ranked by what each privilege can actually do `[VERIFIED]`:

| Rank | Privilege | What it permits | Can the application restrict it? |
|---|---|---|---|
| **1** | **Apps Script project editor** | Select any of the 459 functions from a dropdown and run it with no role check — including `bootstrapTravelAdmin` and `_bulkDeleteSmokeRequests`. Read every stored secret. Change the "Execute as" setting | **No** |
| **2** | **Drive edit access to the database spreadsheet** | Type directly into `Travel_User_Roles` and grant yourself `admin`. Read every row of PII, CUI, and cost data. **No application log entry of any kind** — only Sheets' own version history | **No** |
| **3** | **The `CLASPRC_JSON` GitHub secret** | `clasp push --force` to the production project. Standing deploy authority, no second approval | **No** |
| **4** | **Application `admin` role** | Bounded by the 31 functions that are actually guarded | Yes — this is the only one it manages |
| **5** | **Any authenticated domain user** | Bounded by nothing except the 51 unguarded write functions (§1.4.5) | Partially |
| 6 | **The HC library's contents** | Two of three site-gate allow-paths, plus BU-lead and Sector-Director scope | **No** (§1.7) |
| 7 | **The Shared Drive's membership** | Every travel attachment ever uploaded | **No** |

### 1.5.2 What that ranking means in practice

**Ranks 1, 2, 3, 6, and 7 are not managed by this codebase and cannot be audited from it.** They are Google Workspace and GitHub administration questions. No file in this repository records who holds them `[UNKNOWN]`.

**Three practical conclusions:**

1. **Any statement about who controls LETS is incomplete until ranks 1–3 are enumerated.** This is **VT-02**, fifteen minutes across three screens. Until it is done, you do not know who can administer this system, and neither does anyone else.
2. **Rank 2 is the one people underestimate.** Spreadsheet edit access is a complete bypass of every control in §1.4 — someone can grant themselves the `admin` role by typing in a cell, and the application will neither prevent it nor record it. The spreadsheet's sharing list *is* an access-control list, and it should be reviewed as one.
3. **Rank 5 exists because of §1.4.5.** It is the only rank the application could meaningfully shrink on its own, and **G-067** is how.

> **VT-02 — do this early.** Record, from three screens:
> - Apps Script project: who is **owner**, who is **editor** (Project → Share)
> - The database spreadsheet: who is **owner**, who has **edit** (Drive → Share)
> - GitHub: who holds **admin**, and whose Google account `CLASPRC_JSON` represents (Settings → Collaborators, Settings → Secrets)
>
> Expect the result to be surprising. In systems of this kind the editor list usually includes people who have moved on.

### 1.5.3 What the project documentation says, and why it does not help

`PROJECT_PLAN.md:93-99` lists four access levels for the team: Admin, Write, Write, Read + Review `[CLAIMED]`.

**No mapping exists between those labels and the six implemented roles** `[VERIFIED]`. "Read + Review" has no counterpart in the code at all. The document describes an intended access model that was never built as described, and a reader who takes it as a description of current state will be wrong about who can do what.

This is not the only such case. §1.8.3 lists all eleven places where documentation and code disagree.

### 1.5.4 Things the application genuinely cannot do

Stated so you do not go looking for controls that are not there:

| You might expect | Reality |
|---|---|
| Revoke someone's access entirely from the console | Only if their access comes from a role row. HC-derived access cannot be revoked from LETS at all (**G-008**) |
| See everyone who has access | The console cannot enumerate HC-derived access holders (**G-008**) |
| An audit trail of role changes | Deletions leave no record; updates overwrite the previous value (§1.8, **G-009**) |
| Prevent direct spreadsheet editing | No. There are no sheet protections anywhere in the code (**G-045**) |
| Data validation on entry | None is created anywhere (**G-045**) |
| Restrict what the app can touch in Google | **No `oauthScopes` are declared** (**G-006**), so the permission set is inferred from code and includes **full Drive** and **all spreadsheets**. Nobody chose it, and it widens silently whenever a new Google service is called `[VERIFIED]` |

**G-006 is worth a moment.** Because the manifest declares no scopes, the consent screen a user sees was never designed — it is whatever Google calculates from the APIs the code happens to call. The result grants the application full access to Drive, not just to its own files. **VT-10** captures what users are actually consenting to.

---

## §1.6 Routine operations

### 1.6.1 Granting access

**Use the admin console at `?mode=admin` → Users.** It writes the role row, stamps who granted it and when, and clears the caches so the change takes effect immediately `[VERIFIED]`. All eight role-mutating functions invalidate the caches correctly `[VERIFIED]` — this part of the system works well.

**Caveat:** confirm the Users tab actually loads (**VT-20**). **G-017** may mean it does not, in which case role administration has to happen in the spreadsheet — and §1.6.2 is then mandatory reading, not advisory.

| Role | Also set | Notes |
|---|---|---|
| `admin` | — | Keep **at least two** active at all times (§1.4.6) |
| `aas_fo_reviewer` | `Is_Primary` for the person who should be routed to | **This grants all-data visibility** (**G-031**) |
| `fas_fo_reviewer` | `Is_Primary` | Works for routing; gives no dashboard (**G-029**) |
| `bu_reviewer` | **Scope = BU name**, plus `Is_Primary` | Scope is required |
| `sector_override` | **Scope = sector code**, plus `Is_Primary` | Scope is required |
| `approved_user` | — | Site access only |

### 1.6.2 Revoking access — the two traps

> **Revoke through the admin console, not the spreadsheet.** Both traps below only bite manual spreadsheet edits.

**Trap 1 — `Is_Active` only recognises one word (G-032).**

A row is treated as inactive **only** if the value is the boolean `false` or the text `"false"` `[VERIFIED]` `Access.js:243, 266`:

```javascript
if (rawActive === false || String(rawActive).toLowerCase() === 'false') continue;
```

Everything else means **active**. Specifically: blank, `no`, `N`, `0`, `inactive`, `disabled`, and `"FALSE "` with a trailing space `[VERIFIED]`.

**So an administrator who types `no` into `Is_Active` intending to revoke access has revoked nothing, and nothing will tell them.** The person still has their role. The admin console writes a proper boolean `false` `[VERIFIED]` `Users.js:908-914`, which is exactly why you should use it.

*(The same rule fails in the safe direction on creation: a new row with a blank `Is_Active` is active, so a new user is never accidentally invisible.)*

**Trap 2 — a spreadsheet edit takes up to ten minutes to take effect.**

Three cache layers sit between a role change and its effect `[VERIFIED]`:

| Layer | Lifetime |
|---|---|
| Per-execution in-memory | one execution |
| Joined role lookup (`unified_roles_v1`) | **300 seconds** `Access.js:288` |
| Raw sheet data (`tdb_Travel_Users`, `tdb_Travel_User_Roles`) | **600 seconds** `TravelDB.js:39` |

Console changes clear all three immediately. **A direct spreadsheet edit clears nothing** — and a warming trigger re-reads the sheets every five minutes, so a concurrent application write can re-save stale data over your edit `[VERIFIED]`.

**If you must revoke in the spreadsheet in an emergency:** write the literal word `false`, then allow ten minutes, or have an admin run `_bustRoutingCachesForTesting()` `Submission.js:1051` to clear the caches at once.

### 1.6.3 A read of the role table can write to it (G-027)

Worth knowing because it will appear in the audit trail and look wrong.

When the system looks up someone's roles and finds nothing, it calls `selfHealCurrentUserEmail` `[VERIFIED]`, which:

1. Looks the email up in the HC bundle to get an employee ID
2. Scans `Travel_Users` for a row with that employee ID
3. If that row's email differs, **writes the new email into the production sheet**, stamps `Updated_By: 'hc_self_heal'`, clears the caches, and retries `[VERIFIED]` `Users.js:1284-1292`

**The problem it solves is real.** Someone's email changes — marriage, legal name change, a domain migration — their row goes stale, and they lose all access despite holding valid roles. Keying the repair on the immutable employee ID is a sensible design.

**Three properties you should know about anyway:**

1. **A user holding no role triggers a production write.** They hold none — that is why the lookup missed. Merely loading a page writes to the table that governs authorization `[VERIFIED]`.
2. **It rebinds a role set from one email to another.** Roles granted to a person now attach to whatever address HC reports. The trust in that rebinding is entirely trust in HC's data.
3. **The audit trail records `hc_self_heal`, not who triggered it, and the previous email is not retained in any sheet** `[VERIFIED]`. The old value goes to the Apps Script log only.

**This is a design decision that should be recorded rather than discovered.** Either accept it with the rationale written down, or require that email changes go through the console. Not a code change — a decision.

### 1.6.4 Routine checks worth scheduling

| Cadence | Check | Why |
|---|---|---|
| **Monthly** | Run `verifyPhase7Routing()` (**VT-11**) | One call reports: no active admin, no active primary AAS FO, no active primary FAS FO, and BU coverage gaps `[VERIFIED]` |
| **Monthly** | Confirm at least two active admins | **G-007** has no server-side protection |
| **Quarterly** | Re-run **VT-02** — the three privilege lists | Ranks 1–3 change when people move roles, and nothing notifies you |
| **Quarterly** | Review the database spreadsheet's sharing list | It is an access-control list (§1.5.2) |
| **Quarterly** | Re-run **VT-18** — trigger health, as **each** project editor | A departed owner's triggers fail silently (§1.3.3) |
| **After any FY rollover** | Check per-diem sync status and the fiscal-year configuration | **G-037**: LETS IDs are hardcoded to FY27 `[VERIFIED]` |
| **Before any column change** | Stop — read §1.6.5 first | |

**`verifyPhase7Routing()` has a wrinkle worth knowing** (**G-010**): it is itself unguarded and browser-callable, and it returns the complete role roster — every admin, every primary and backup, with names and addresses. Running it is safe. The finding is that anyone can.

### 1.6.5 The one hard rule: never insert or reorder spreadsheet columns

**This is the most dangerous routine action available, and it produces no error.**

Eighteen places in the code read and write sheet data **by column position** rather than by header name, including eight that write whole rows as positional arrays `[VERIFIED]`. This is finding **G-014**.

**Insert a column in the middle of a tab, and every subsequent write goes into the wrong field.** No exception, no warning, no log entry. Data written after the change is silently misfiled, and existing rows are untouched — so you get a sheet where older rows are correct and newer ones are not.

**Rules:**

- **Never insert a column** except at the far right of a tab.
- **Never reorder columns.**
- **Never delete a column**, even one that looks unused. `Set_Asides.Active` and `Test_Submitters.Suppress_Emails` both look dead and are not, and `File_Queue` is declared but unused (**G-057**).
- **Before and after any schema change, run VT-08** — read row 1 of the seven core tabs and confirm the order is unchanged.

**One complication you should know about:** the application itself adds three columns to the `Requests` tab at runtime the first time a Division Director reports a funding issue `[VERIFIED]` (**G-044**). So the live tab may be wider than the code's own schema expects, and two of those three columns use inconsistent position arithmetic. **VT-06** captures the real current header row.

---

## §1.7 What LETS depends on

### 1.7.1 The dependency inventory

| Dependency | What it provides | If it fails |
|---|---|---|
| **Google Workspace** | Authentication, hosting, Drive, Sheets, Gmail | Everything stops. Nothing LETS can do about it |
| **The HC Data Library** | Employee lookup, supervisor chain, **two of three site-gate allow-paths** | **Silent, total access failure** — see §1.7.2 |
| **A Shared Drive** | Storage for every travel attachment | Uploads and attachment viewing fail |
| **GSA per-diem API** (`api.gsa.gov`) | CONUS per-diem and mileage rates | Rates go stale; cached values persist |
| **Federal Register API** (`federalregister.gov`) | DoD per-diem rate publication | Rates go stale |
| **State Department** (`aoprals.state.gov`) | Foreign per-diem rates | Rates go stale |
| **The FAS Travel Exception Tracker** | EO 14222 compliance reporting | Nothing — **the sync does not run** (**G-022**) |
| **jsDelivr and cdnjs** (CDN) | Bootstrap, FontAwesome, Flatpickr | Pages render unstyled or partly broken — and see §1.7.4 |

### 1.7.2 The HC library is the dependency that matters

**This is finding G-008, and it is the one external dependency that can take the system down invisibly.**

The library is referenced at **28 places across nine server files** `[VERIFIED]` and is called `HC` in the code. It controls:

- Two of the three ways a user can pass the site gate (§1.4.2)
- All BU-lead and Sector-Director scope derived from job titles
- Employee lookup and the supervisor chain on the intake form

**Three facts about it that together make a genuine operational hazard:**

**1. It is declared in no manifest.** `lets_app/appsscript.json` contains no `libraries` section at all `[VERIFIED]`. The binding exists only in the live Apps Script project's configuration. **It is therefore invisible to this repository, invisible to code review, and will not survive a rebuild of the project from source.**

**2. Failures are swallowed.** Every HC call in the site gate is wrapped in a `try/catch` that logs a warning and continues `[VERIFIED]` `Access.js:423, 434`:

```javascript
} catch (e) {
  console.warn('canAccessTrip: HC supervisor check failed: ' + e.message);
}
```

Failing closed is the **right** default — an HR data outage should not grant access. But the *mode* of failure is total and silent.

**3. The failure is indistinguishable from correct operation.** If the library is detached or broken, every HC-derived allow-path returns false. Every supervisor who relies on it is denied access. The application reports no error — it shows them the normal "you don't have access" card. **An administrator would see a wave of access complaints with no corresponding error anywhere in the system.**

**And there is a subtler version of the same failure, which an earlier draft of this guide described wrongly.** The gate reads `String(p.supervisoryStatus) !== '2'` `[VERIFIED]` `Access.js:416`.

> **Correction, recorded rather than quietly fixed.** This section previously said that *if the library emits a number rather than text, two of three allow-paths are already dead.* **That is false, and `pass6_hc_gate_predicate.js` §[1] disproves it by execution:** the explicit `String()` coercion means a numeric `2` **passes**. The comparison is not the bare `===` the claim assumed. It was also wrong about the blast radius — the third allow-path (`_isBuLeadByTitle` `Access.js:864`) never tests `supervisoryStatus` at all, so even a genuine type mismatch would disable **one** path, not two.

**The underlying worry was right; the trigger named was not.** Executed across input classes `[VERIFIED]`, the values that silently deny a real supervisor are **`'02'`, `' 2'`, `'2 '`, `'2.0'`, and `'two'`** — zero-padded, whitespace-bearing, and decimal-formatted text. The gate trims nothing and pads nothing. Those are exactly the shapes a spreadsheet export, a CSV round-trip, or a text-formatted column produces, so **the question is still worth twenty minutes — it just has to ask for the exact distinct values rather than the type.**

**The adjacent field fails the other way.** `occupancyStatus` is read as a **denylist** — only `VACANT` and `OBLIGATED` are refused `[VERIFIED]` `Access.js:417-418` — so a blank, absent, or unrecognised occupancy value **grants** access. Two checks, two lines apart, failing in opposite directions. That is finding **G-074**, and VT-03 captures the data for it in the same visit.

> **VT-03 — twenty minutes, and it answers three questions.**
> 1. Apps Script editor → Libraries: is an HC library attached? To production *and* to the sandbox?
> 2. If yes, run `_probeHcForUser('<any surname>')` `CacheWarming.js:1563` and read the Logs. It prints the distinct `supervisoryStatus` and `occupancyStatus` values the library actually emits.
> 3. **Record those values verbatim — with any padding or whitespace intact.** `'2'` and `'02'` behave differently and look identical in a summary. A value of `2` is fine; a value of `'02'` means supervisors are being denied right now.
>
> Use `_probeHcForUser`, not `_probeHcDistinctValues` — the latter needs an argument the editor's Run button cannot supply.

### 1.7.3 One dependency gate is exemplary — and it is LETS-original

`resolveFASTrackerTarget` `TripConfig.js:86-127` `[VERIFIED]` refuses to run if a non-production project points at the official FAS tracker, and treats an unset environment as non-production. It fails closed, it cites the NIST controls it implements, and it has a dedicated test suite (`test_fas_tracker_env.js`, passing).

**This is the quality bar the rest of the system should be held to, and it was set by this project, not inherited.** §1.8.4 makes the point this implies.

### 1.7.4 The CDN dependency, and a nuance in who owns it

Every screen loads JavaScript and CSS from public CDNs — **34 references, with zero `integrity=` attributes** `[VERIFIED]`. This is finding **G-034**. Subresource integrity is a one-line-per-reference attribute that makes the browser refuse a file whose contents have changed. Without it, a CDN compromise would execute arbitrary JavaScript in every user's session, inside an authenticated page, with full access to everything on screen.

**The ownership nuance matters and corrects an earlier assessment.** 21 of the 34 references are in untouched TRIP files, but **13 are in files LETS wrote or modified** `[VERIFIED]`. This is not purely inherited — LETS reproduced the pattern in its own new pages. That makes it the clearest single example of the point §1.8.4 has to make.

It is rated Medium rather than High only because exploiting it requires compromising jsDelivr or cdnjs, which is not a LETS-specific risk. It should still be fixed, and it is mechanical work.

---

## §1.8 Accountability and audit

### 1.8.1 What is recorded, and what is not

| Change | Recorded where | Who is recorded | Gap |
|---|---|---|---|
| Role granted via the console | `Travel_User_Roles.Granted_By` / `Granted_At` | The admin's email | **None — correct** |
| Role **deactivated** | `Updated_By` / `Updated_At` on the row | The admin's email | **The previous value is overwritten. No history** |
| Role **deleted** | **Nowhere** | — | **The row is gone.** No tombstone, no log entry of any kind `[VERIFIED]` `Users.js:1228` |
| Role granted via `bootstrapTravelAdmin` | `Granted_By: 'bootstrap'` | **Not the caller** | The person who self-granted is not recorded |
| Email auto-patched by self-heal | `Updated_By: 'hc_self_heal'` | **Not the caller** | Previous email not retained in any sheet |
| Request status or reviewer changed by an admin | `Approval_Log` with the before and after status | `admin.name`, `admin.email`, role `Admin` | **None — exemplary** `[VERIFIED]` `Admin_Actions.js:68-80` |
| Requests **bulk deleted** | `console.log` only `[VERIFIED]` `Admin_Cleanup.js:225` | The admin's email, **in Cloud Logging** | **The rows are gone from six tabs** and the application retains no record |
| Costs, travellers, itinerary edited | `Approval_Log` | Real email — but the **role is hardcoded** as `'Submitter'` at six sites `[VERIFIED]` | The role column asserts rather than records |
| An admin viewing as another role | Nowhere | — | Read-only simulation; nothing to attribute (§1.4.6) |

### 1.8.2 The pattern, stated once

**Travel decisions are audited well. Changes to who holds access are not.**

Request-level workflow actions go into the `Approval_Log` tab — a real append-only record, in a tab you can read, with the actor's identity and the before/after state. `Admin_Actions.js` is the model the rest of the system should follow.

Authorization-level changes are audited by **current-state columns that are overwritten on the next change**. This is finding **G-009**, and its consequence is concrete:

> **"Who held the `admin` role in March?" cannot be answered from this system.** Not with difficulty — at all. A role deleted in April leaves no trace that it ever existed, and a role deactivated in April has overwritten the record of who activated it.

If an auditor asks that question, the honest answer is that the data does not exist. Spreadsheet version history may help for a limited retention window, and Cloud Logging retains function executions for its own retention period — neither is an audit trail and neither is complete.

**Two things follow:**

1. **Export `Travel_Users` and `Travel_User_Roles` now, and on a schedule** (**VT-05**). A dated export is the only historical record of authorization state you can create, and the longer you wait the more history is already unrecoverable.
2. **The `Action_By_Role` column cannot be trusted** where it says `Submitter`. Six write sites hardcode that string regardless of who the caller actually was `[VERIFIED]`. The email in the adjacent column is real; the role label beside it may not be.

### 1.8.3 Where the documentation contradicts the code

Eleven cases. The code wins in every one; the document is named so it can be fixed `[VERIFIED]`.

| Document | Claim | Reality |
|---|---|---|
| `Access.js:1-13` (header) | *"SINGLE SOURCE OF TRUTH … **every** access decision funnels through this file"* | False as written. Most server functions make no access decision at all |
| `Access.js:1190-1193` | The per-request guards are *"used by review/edit RPCs"* | **Zero call sites** (**G-067**) |
| `Access.js:1152-1153` | `requireRole` is *"the canonical guard for any future RPC"* | An unrecognized role name **silently grants** access (**G-030**) |
| `Review_Update.js:1366` | `requireRequestEditor` is for *"the standard `update*ForReview` family"* | That family does not call it; five of seven check nothing |
| `Validation.js:9-12` | *"Adoption is rolling"* | Adoption is **zero** outside its own self-test (**G-033**) |
| `RequestService.js:147` | *"Advances Kanban stage with role and permission checks"* | No checks of any kind (**G-038**) |
| Six comments in four files | The app runs as `USER_DEPLOYING` | `appsscript.json:20` declares `USER_ACCESSING` (§1.3.4) |
| `Attachments.js:467` | `accessLevel` is *"`'reader'` or `'writer'`"* | Its only caller passes `'viewer'`, which is not a valid Drive role (**G-028**) |
| `PROJECT_PLAN.md:93-99` | Four team access levels | No mapping to the six implemented roles (§1.5.3) |
| `PROJECT_PLAN.md:116` | *"minimal-scope credentials for each service"* | **No `oauthScopes` declared at all** (**G-006**) |
| `Review_Update.js` ×6 | `Action_By_Role` is `'Submitter'` | The caller may be an admin or a reviewer (§1.8.2) |

**The pattern is worth naming, because it tells you which documentation to trust.** Where a file's comments describe *that file's own* behaviour, they are accurate — `Users.js`, `Reporting.js`, and `Admin_Actions.js` all do exactly what their headers say `[VERIFIED]`. Where a comment describes what *other* files do, or what *will* happen, it describes intent that was never completed. **Read file headers as reliable about themselves and aspirational about everything else.**

### 1.8.4 The accountability question you will be asked

Two readings of the same evidence. Both are true, and a guide that gave you only one would be doing you a disservice.

**The reassuring reading.** LETS did not introduce the security gaps. All six Critical findings live in code byte-identical to the TRIP application `[VERIFIED]` — code this project was directed to adopt as a proven foundation. Judged on its own work, the project's security engineering is good: the FAS environment gate is exemplary, the CI/CD separation is deliberate and documented with its reasoning, the `.claspignore` guard shows real understanding of an obscure platform hazard, and the admin "view-as" feature — the one place LETS could have introduced a privilege-escalation bug — is implemented correctly.

**The uncomfortable reading.** The gaps were adopted **without a security review of what was being adopted**. Eighty-four percent of the code was accepted unexamined. And the clearest evidence is §1.7.4: the one inherited weakness LETS *reproduced by choice* — CDN loading with no integrity checking — appears in **new** pages the project wrote. The pattern propagated rather than being caught.

**Neither reading is a criticism of anyone's competence.** Adopting a working application wholesale is a reasonable engineering decision under schedule pressure, and the TRIP application does work. The gap is a process one: there was no step at which someone asked what the adopted code permitted.

**What to say when asked.** Something close to:

> *The system inherits its authorization model from the TRIP application, which it was directed to build on. That model enforces access at the screen layer but not consistently at the server layer, which means a user can reach data and functions the interface does not offer them. The defect is well understood, bounded, and two correct fixes for the most serious part of it already exist in the codebase, unused. The LETS-specific work added to this foundation is of good quality. The remediation is small; the review that should have preceded adoption is what was missed.*

That is accurate, it does not overstate the risk, it does not hide it, and it does not blame anyone.

### 1.8.5 What to do first

| Order | Action | Effort | Why first |
|---|---|---|---|
| **1** | **VT-01** — read the deployment's "Execute as" and "Who has access" | **2 min** | Gates the severity of all six Criticals. Nothing else should be reported to an ISSO until this is known |
| **2** | **VT-04** — check whether `bootstrapTravelAdmin` has ever been called by anyone unexpected | 30 min | **Must happen before G-002 is fixed** — remediation destroys the evidence |
| **3** | **VT-02** — enumerate privileges 1–3 | 15 min | You do not know who controls this system until this is done (§1.5.2) |
| **4** | **VT-05 + VT-11** — export the role tables; run the routing check | 15 min | Establishes who holds access today, and creates the first historical record (§1.8.2) |
| **5** | **VT-03** — the HC library, and the exact values it emits | 20 min | Two of three access paths depend on it, and whether either works turns on values nobody has recorded (§1.7.2) |
| **6** | **VT-07 + VT-06 + VT-08** — the live tab list and the core header rows | 20 min | Settles six findings and is the only test for silent ongoing data corruption (§1.6.5) |
| **7** | Answer **BD-1** and **BD-3** | A conversation | BD-3 unblocks **G-067**, the cheapest fix for the two worst findings |
| **8** | Fix **G-022** — the false FAS-sync notice | A wording change | The system is currently making a compliance claim to users that is not true |

**The eight actions above sum to 102 minutes of work** — items 1–6 are measured tasks; items 7 and 8 are a conversation and a wording change. **The full checklist is 29 tasks and 7 h 1 m, of which 5 h 1 m needs the live system open** and the remaining two hours are a code review (VT-26) that can be done from the repository alone. It is Deliverable 10, [`HUMAN_VERIFICATION_CHECKLIST.md`](./HUMAN_VERIFICATION_CHECKLIST.md).

> **This sentence previously read "under two hours" and "under six hours".** The first is true (102 min) and now states the figure rather than a bound. **The second was wrong** — it came from `GAP_CONSOLIDATION_PASS6.md` §6.7.2, where the total had been read off a table instead of summed. Corrected there and in every document that repeated it; `pass6_checklist_check.js` §[2] re-sums it on every run.

---

## §1.9 Where to go next

| You want | Read |
|---|---|
| The full list of findings, ranked, with evidence | `GAP_REGISTER.md` (Deliverable 6) |
| What every file and module does | `SYSTEM_COMPONENT_MAP.md` (Deliverable 2) |
| What every sheet tab and column means | `DATA_DICTIONARY.md` (Deliverable 3) |
| The complete business rules and state machine | `WORKFLOW_AND_BUSINESS_RULES.md` (Deliverable 4) |
| Deployment, environments, and configuration | `DEPLOYMENT_AND_ENVIRONMENTS.md` (Deliverable 5) |
| How to scope an enhancement without breaking something | `ENHANCEMENT_PLAYBOOK.md` (Deliverable 7) |
| An honest current-state summary for leadership | `SYSTEM_STATE.md` (Deliverable 8) |
| The verification tasks, in order, with locations | [`HUMAN_VERIFICATION_CHECKLIST.md`](./HUMAN_VERIFICATION_CHECKLIST.md) (Deliverable 10) |
| The evidence behind every number in this guide | [`GAP_CONSOLIDATION_PASS6.md`](./GAP_CONSOLIDATION_PASS6.md) and `docs/evidence/` |

### Reproducing this guide's figures

Every count in this document comes from a script. None was counted by hand.

```sh
cd docs/evidence && for f in *.js; do echo "== $f"; node "$f"; done
```

The scripts print where their mechanical answer differs from the prose of the earlier analysis passes, so a reader can see the disagreements rather than having to trust that they were resolved.

---

*End of Deliverable 1. Written against the evidence base of Passes 1–6. Every `[CLAIMED]` and `[UNKNOWN]` marker in this document is a verification task in Deliverable 10 — there are no gaps left deliberately vague.*
