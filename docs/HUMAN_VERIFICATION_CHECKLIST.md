---
title: "LETS Human Verification Checklist"
description: "The 29 facts about the live system that cannot be determined from the repository, each with its exact location, its cost, and what to write down"
status: canonical
tier: 1
audience: "whoever has live access — administrator, project manager, or developer. Assumes you have read nothing else."
last_updated: "2026-10-29"
evidence_base: "docs/evidence/pass6_checklist_check.js validates this document, including its own effort arithmetic"
---

# LETS Human Verification Checklist

**Deliverable 10 of 10.** The other nine describe what the code does. **This one is the list of things the code cannot tell you** — because they live in the Apps Script project's settings, in a spreadsheet, in Google Drive, or in someone's account, and none of that is in version control.

**You do not need to have read the other nine documents to use this.** Every task says what to do, exactly where to do it, what to write down, and why it matters in one sentence. Where a task refers to a finding (`G-001`, and so on), that is a pointer into [`GAP_REGISTER.md`](./GAP_REGISTER.md) — you can ignore it and still do the task correctly.

---

## §10.0 How to use this checklist

**29 tasks.** Together they cost **7 hours 1 minute**, of which **5 hours 1 minute needs the live system open** — the remaining two hours are a code review (**VT-26**) that can be done from this repository alone, by someone else, in parallel.

| | |
|---|---|
| **If you have two minutes** | Do **VT-01**. It conditions the severity of all six Critical findings and nothing else should be reported to a security officer until it is known |
| **If you have an afternoon** | Do §10.2's five, then Group B. That is the whole of the access and data picture |
| **If you are handing this to someone** | Groups A–D are location-ordered, so each group is one sitting in one place. Group E is independent of the others |

### Three rules for recording the answers

1. **Write the answer down, in this file or beside it.** Several of these tasks are the *only* record that will ever exist of the thing they measure — see §10.9. A ticked box with no value is a task that will have to be done again.
2. **Copy values verbatim, including spaces and leading zeros.** This is not pedantry. **VT-03** turns entirely on it: `'2'` and `'02'` behave in opposite ways and look identical in a summary.
3. **If a task cannot be completed, write why.** `BLOCKED — no access to the GCP project` is a useful answer and feeds **VT-02**. A blank is not.

### What this checklist deliberately does not contain

**Six questions that only the business owner can answer are in §10.8, not here.** They ask what the system *should* do, and no amount of looking will settle them. They are separated so that this checklist stays completable — a checklist with unanswerable items in it stops being used.

---

## §10.1 Read this before you start — one ordering constraint

> ### ⚠ VT-04 MUST RUN **BEFORE** ANYONE FIXES G-002
>
> **G-002** is the finding that any logged-in user can grant themselves the `admin` role. **VT-04** is the task that determines whether anyone ever has.
>
> **Fixing G-002 destroys the evidence** needed to answer that. The remediation is to add an authorization guard; once added, the historical question *"did this already happen?"* can no longer be investigated by exercising the system, and the Cloud Logging retention window keeps shrinking in the meantime.
>
> **So the order is fixed: VT-04, then remediation.** VT-04 is not one of the five highest-value tasks in §10.2 — it unblocks no other finding — but **this ordering matters more than its rank.** It is an incident-response question, and those have deadlines that severity rankings do not capture.

**Nothing else in this checklist has an ordering requirement**, with two mild conveniences: **VT-27** reads the export that **VT-05** produces, and **VT-23** is easiest in the same sitting as **VT-07**. Both are noted where they appear.

---

## §10.2 The five that unblock the most

**If only part of this gets done, do these.** The ranking criterion is stated so it can be argued with: **how many findings cannot be correctly rated, documented, or fixed until this task is done**, weighted by the severity of those findings and discounted by cost.

| Order | Task | What it unblocks | Cost |
|---|---|---|---|
| 1 | **VT-01** — the deployment's "Execute as" and "Who has access" | All six Critical findings' severity basis, plus the amplifier on G-003, G-005, G-012, G-027, G-044 | **2 min** |
| 2 | **VT-07** — list every tab in the live database | Six findings at once: G-016, G-040, G-041, G-043, G-055, G-057 | **5 min** |
| 3 | **VT-05** and **VT-11** — export the role tables, run the routing check | G-007, G-009, G-010, G-029, G-031, G-032 — and it creates the first historical record of who holds access | **15 min** |
| 4 | **VT-03** — the HR library, and the exact values it emits | G-008, G-074, and whether two of the three ways into the system work at all | **20 min** |
| 5 | **VT-06** and **VT-08** — row 1 of the seven core tabs | G-013, G-014, G-044 — **the only test for silent, ongoing data corruption** | **12 min** |

**Those five cost 54 minutes together and settle twenty-one findings.**

**Why VT-01 leads.** It is two minutes and it changes the meaning of everything else. The project's manifest declares that the app runs as the *person using it*; eight lines of source code across six files assert the opposite — that it runs as the *person who deployed it* `[VERIFIED]`. If the second is true, then every unguarded function runs with the deployer's authority rather than the caller's, and five findings become materially worse. **One screen answers it.**

---

## §10.3 Group A — the Apps Script editor and GitHub

**7 items · 69 min · one sitting, two browser tabs.**

**Where to start:** open the Apps Script project. From the database spreadsheet that is **Extensions → Apps Script**; otherwise it is at `script.google.com` under the project named for LETS/TRIP.

| ID | Do this, and write down the answer | Where exactly | Why it matters | Cost |
|---|---|---|---|---|
| **VT-01** | Record **"Execute as"**, **"Who has access"**, and the **version number** of the active deployment — and **confirm the deployment ID matches** the `GAS_PRODUCTION_DEPLOYMENT_ID` repository variable. If there is more than one deployment, record all of them and which is active | Editor → **Deploy → Manage deployments**; the variable is at GitHub → Settings → Secrets and variables → Actions → Variables | Decides whether unguarded functions run with the caller's authority or the deployer's. **Conditions the severity of all six Criticals.** **The URL is no longer unknown** — see the note below | **2 min** |
| **VT-02** | Record **who holds Apps Script project editor access**, **who holds edit access to the database spreadsheet**, and **who can read the GitHub `CLASPRC_JSON` secret** | Editor → **Share**; the Sheet → **Share**; GitHub → Settings → Secrets and variables → Actions | **These are the three privileges above the application's own `admin` role.** Anyone on any of these lists can bypass every control in the app — the spreadsheet list by typing in a cell. G-009, G-021 | **15 min** |
| **VT-09** | Record **every Script Property and its value**, in **both** the production and sandbox projects. Note which keys are absent | Editor → **Project Settings** (gear) → Script Properties | This is the system's entire configuration — API key, mileage rates, folder IDs, sender address. **Four of the seven keys the code reads may never have been set** (G-020), and **no record of these values exists anywhere else** (§10.9) | **10 min** |
| **VT-10** | Record **the actual list of OAuth scopes** users consent to | Linked GCP project → **APIs & Services → OAuth consent screen**; or revoke your own grant and re-authorise, reading the consent dialog | The manifest declares **no scopes at all**, so the real permission set is inferred from API calls and **includes full Drive access and all spreadsheets**. Nobody chose it; it widens silently as code is added (G-006) | **10 min** |
| **VT-19** | Record the live value of the **`travel_email_address`** property, then check whether the account that executes the app has a matching **send-as alias** in Gmail | Script Properties; then Gmail → Settings → Accounts → "Send mail as" | Two setup functions write **different** defaults to this one key (G-073), so the live sender was decided by whichever ran first. With no alias, mail silently falls back and arrives from a different address than intended | **10 min** |
| **VT-20** | Open the reviewer dashboard — append **`?mode=reviewer-dashboard`** to the deployment URL — and record whether it loads or throws | A browser, using the VT-01 URL | In this repository the dashboard's file is misnamed and **cannot load** (G-017). If it works live, the filenames there are different, and "fixing" the names here would break what currently works | **2 min** |
| **VT-21** | Identify the two **undocumented** Apps Script projects — `1PLzwA_Tin…` (sandbox) and `181ocqi16Ruz…` (wired to this repository's root) — and record what each is, who owns it, **whether the sandbox points at the production database**, and **whether the sandbox web app is reachable and by whom** | **script.google.com** project list; then each project's Script Properties; then the sandbox's **Deploy → Manage deployments** | Two live projects are in no project document. **The sandbox has its own published web app** (§10.3's note), so if it shares the production database it is a **second, undocumented front door onto real travel data** — reachable, not merely pushable. The root-wired project would receive 228 files from a mis-run push, including another organisation's application (G-048) | **20 min** |

> **One warning while you are in this area, and it costs nothing to observe.** **Never run `clasp push` from the repository root.** An untracked `.clasp.json` sits there with `rootDir: ""`, so a push from that directory carries 228 files — including 94 belonging to the GSA/AAS TRIP application — into the undocumented third project. Push only from `lets_app/`. This is the same finding as VT-21 and it is the one accident in this system that a single command can cause.

> ### Both deployment IDs are already known — which changes VT-01 and VT-21
>
> **Added 2026-10-29.** Two **GitHub repository variables** now hold the web-app deployment IDs: `GAS_PRODUCTION_DEPLOYMENT_ID` and `GAS_SANDBOX_DEPLOYMENT_ID`. They are distinct from each other.
>
> | What this changes | |
> |---|---|
> | **VT-01 is now a confirmation, not a discovery** | The deployed URL is `https://script.google.com/macros/s/<production-id>/exec`. **Confirm the ID in Manage deployments matches the variable** — a mismatch means the variable points at a stale or wrong deployment, which is worth catching now rather than after someone automates against it |
> | **VT-21 gained a sub-question** | The sandbox has its **own published web app**, so it is reachable by URL, not merely a code-push target. Record **who can reach it** as well as which database it uses |
> | **Nothing is automated yet** | No workflow reads either variable and there is still no `clasp deploy` step `[VERIFIED]`. **So VT-01's "does a merge reach users?" question is unchanged** — the IDs are known and unused |
>
> **One caveat that depends on VT-01's answer.** Repository variables are **not** secrets — anyone with repository access can read them. That is normally fine for a deployment ID, since it already appears in the URL every user visits. **But if "Who has access" turns out to be *Anyone*,** that URL is the only thing between the public and 412 browser-reachable functions, 51 of which write with no authorization check (**G-001**). In that case the ID is closer to a key than to configuration. **Flag it if you see *Anyone*.**

**If VT-01 shows "Execute as: me (the deployer)"** — stop and tell whoever owns this system before continuing. It does not need to be fixed today, but five findings are worse than this documentation says, and that is worth knowing within the hour rather than at the end of the afternoon.

---

## §10.4 Group B — the database spreadsheet

**9 items · 67 min · one sitting, in one browser tab.**

**Where to start:** open the LETS database spreadsheet. If you do not know which one it is, **VT-09** gives you its ID from the `TRAVEL_DB_SPREADSHEET_ID` property; open `https://docs.google.com/spreadsheets/d/<that-id>/edit`.

**Do VT-05 first.** Three later tasks read its export rather than the live sheet.

| ID | Do this, and write down the answer | Where exactly | Why it matters | Cost |
|---|---|---|---|---|
| **VT-05** | **Export `Travel_Users` and `Travel_User_Roles` in full** — every row, every column. Download as CSV or XLSX, **date the file**, and keep it | File → Download, with each tab selected | **This is the only way to answer "who has access to this system today."** It is also the only historical record of authorisation state that can ever be created — see §10.9. G-007, G-009, G-032 | **10 min** |
| **VT-06** | **Read row 1 of the tab named `Requests` verbatim.** Record the exact header text and the column count | The Sheet, tab `Requests`, row 1 | **Two different schemas in this codebase both claim the tab name `Requests`** (G-013). Row 1 decides which one owns it — and therefore whether the two halves of the system have already collided in one tab | **2 min** |
| **VT-07** | **List every tab name in the workbook.** Note which exist beyond the 16 the main code expects, and whether any tab holds only header rows with no data | The Sheet, tab bar (right-click the tab bar → list) | **One look settles six findings.** It reveals whether the budget half of the system was ever created, which decides whether seventeen findings are live defects or dormant ones. G-016, G-040, G-041, G-043, G-055, G-057 | **5 min** |
| **VT-08** | **Read row 1 of these six tabs verbatim:** `Request_Travelers`, `Request_Legs`, `Traveler_Leg_Costs`, `Approval_Log`, `Travel_Users`, `Travel_User_Roles` | The Sheet, row 1 of each | The code writes to these by **column position**, not by name. **If anyone has inserted, renamed, or reordered a column, data is being written to the wrong field right now and nothing reports it** (G-014). This is the only test for that | **10 min** |
| **VT-16** | **Check `Requests` for duplicate `Request_ID` values.** In a scratch cell: `=COUNTIF(A:A,A2)` filled down, or a pivot on the ID column | The Sheet, a scratch column | ID generation is not locked, so two simultaneous submissions can take the same ID (G-012). **Any duplicate means it has already happened** — and a duplicate ID silently corrupts every child row that references it | **5 min** |
| **VT-17** | **Check for orphan rows** — rows in the five child tabs whose `Request_ID` has no match in `Requests`. In a scratch cell on each child tab: `=MATCH(A2,Requests!A:A,0)` filled down; `#N/A` marks an orphan | The Sheet, one scratch column per child tab | Submission writes the parent and children separately with no transaction. **An orphan is the fingerprint of a half-completed submission** (G-012) — and such a request also skips its compliance review (G-069) | **15 min** |
| **VT-23** | **Does `Requests` contain any rows with IDs shaped `LETS-20NN-NNN`**, or statuses that look unfamiliar? Filter the ID and status columns | The Sheet, tab `Requests` | Would prove the two halves of the system have already been pointed at one tab. **Easiest to do in the same sitting as VT-07.** G-013, G-037 | **5 min** |
| **VT-25** | **Record any data-validation dropdowns, named ranges, or protected ranges** on any tab | Data → Named ranges; Data → Protect sheets and ranges; and click a few cells to see if a dropdown appears | **The code creates none of these** `[VERIFIED]`. So anything you find is an undocumented control that someone added by hand — it may be load-bearing, and it will not survive a rebuild (G-045) | **10 min** |
| **VT-27** | **From VT-05's export, record the exact `Is_Active` cell values** that actually appear — blank, `TRUE`, `FALSE`, `'yes'`, `'no'`, `0`, `1`, typos, anything | VT-05's downloaded file, not the live sheet | **The code treats only `false` and `'false'` as inactive.** Everything else — including blank — reads as **active** (G-032). If a revocation was done by typing `no` in a cell, **that person still has access** | **5 min** |

> **VT-08 is the task people skip, and it is the one that finds live damage.** The other tasks in this group describe risk. This one tests whether data is being written to the wrong columns *today*. It costs ten minutes and the expected answer is "no drift" — but the cost of not knowing is silent, cumulative, and unrecoverable.

---

## §10.5 Group C — run a diagnostic and read the log

**5 items · 65 min · in the Apps Script editor.**

**How to run any of these:** open the editor, pick the function name from the dropdown above the code pane, click **Run**, then read the **Execution log** that appears at the bottom. Nothing here writes data.

> **You must hold the application's `admin` role for VT-11, VT-12 and VT-24, not merely project-editor access.** These functions call an authorisation guard and will refuse otherwise. If they refuse, that is itself a finding worth recording — and **VT-05** tells you who does hold the role.

| ID | Do this, and write down the answer | Where exactly | Why it matters | Cost |
|---|---|---|---|---|
| **VT-03** | **Two parts.** (a) Check whether an **HR data library** is attached — to the production project *and* to the sandbox; record its identifier and version. (b) If one is attached, run **`_probeHcForUser('<any surname>')`** and record the distinct **`supervisoryStatus`** and **`occupancyStatus`** values it prints — **verbatim, with any padding or spaces intact** | (a) Editor → **Libraries** (left panel, under Files). (b) Editor → Run → read the log | **Two of the three ways a person can get into this system depend on this library, and it is declared in no manifest** — so it is invisible to this repository and **will not survive a rebuild** (G-008). Part (b) is why the values matter: see the box below. G-074 | **20 min** |
| **VT-11** | **Run `verifyPhase7Routing()`** and record the whole `issues` array it prints | Editor → Run → log | **One call reports four separate problems if present**: no active admin, no active primary AAS Front Office reviewer, no active primary FAS Front Office reviewer, and business units with no reviewer coverage. G-007, G-010, G-029 | **5 min** |
| **VT-12** | **Run the access diagnostic for 3–5 known people** — an admin, a business-unit reviewer, someone whose only claim is being a supervisor in the HR data, and someone who should have **no** access. Record what each gets and why | Editor → open `30_services/Access.js`, edit `TEST_EMAIL` at **line 513**, run **`_diagnoseAccess()`**, read the log. Repeat per person | **This is the only way to enumerate who has access through the HR data rather than through the role table.** Nobody granted that access and no audit entry records it (G-008, G-031) | **20 min** |
| **VT-18** | **Run `_checkAllTriggersHealth()` — once as *each* person who holds project-editor access** — and record which scheduled jobs exist and under whose account | Editor → Run → log, repeated per editor account (VT-02 gives you the list) | **Scheduled jobs in Apps Script are invisible to everyone except the account that created them.** So no single person can see them all, and **a job owned by someone who has left the organisation fails silently forever** (G-066) | **15 min** |
| **VT-24** | **Confirm whether the `fas_fo_reviewer` role has an active primary assigned** | The admin console (`?mode=admin` → Users), or the `Travel_User_Roles` tab from VT-05 | If that seat is vacant, requests needing the FAS compliance review are sent to an **empty address** and strand there with no error (G-029) | **5 min** |

> ### Why VT-03 asks for exact values, and a correction to an earlier claim
>
> The gate that decides whether a supervisor can enter the system tests two fields from each HR record, two lines apart. **They behave in opposite ways** `[VERIFIED]` `Access.js:416-418`:
>
> | Field | How it is tested | A value nobody anticipated |
> |---|---|---|
> | `supervisoryStatus` | **Allowlist** — only `'2'` passes | **denies** access. `'02'`, `' 2'`, `'2.0'` all fail silently |
> | `occupancyStatus` | **Denylist** — only `VACANT` and `OBLIGATED` are refused | **grants** access. Blank, missing, or an unknown code all let the person in |
>
> **So `'2'` works and `'02'` locks out every supervisor in the organisation, and the two are indistinguishable in a summary.** That is why this task asks you to copy the values character for character rather than describe them.
>
> **An earlier version of this documentation stated that the gate would break "if the library emits a number."** That is wrong — the code converts to text before comparing, so a numeric `2` passes. The claim was checked by executing the actual predicate (`docs/evidence/pass6_hc_gate_predicate.js`) and withdrawn; the full account is in [`GAP_REGISTER.md`](./GAP_REGISTER.md) §6.6.1. **The underlying concern was real, but the trigger named was not** — which is the reason this task survives at its full twenty minutes while its justification changed.

---

## §10.6 Group D — Drive, email, and things outside the system

**6 items · 95 min · several places; the only group that needs more than one account.**

| ID | Do this, and write down the answer | Where exactly | Why it matters | Cost |
|---|---|---|---|---|
| **VT-04** | **Determine whether the self-grant function has ever been called by anyone unexpected.** Two independent checks: (a) search Cloud Logging for `bootstrapTravelAdmin`; (b) in `Travel_User_Roles`, list every row whose `Granted_By` is the literal `bootstrap` | (a) GCP → **Logs Explorer**, filtered to this script project. (b) VT-05's export | **⚠ THIS MUST BE DONE BEFORE G-002 IS FIXED — see §10.1.** The fix removes the ability to investigate, and the log retention window is shrinking. Rows marked `bootstrap` are grants **not attributable to any named person** | **30 min** |
| **VT-13** | **List the members of the Shared Drive** that holds travel attachments | Drive → the shared drive → **Manage members** | **Every attachment on every travel request is visible to that entire membership, regardless of anyone's role in the application.** The membership list is an access-control list and should be reviewed as one. G-004, G-005 | **5 min** |
| **VT-14** | **Test whether attachments actually reach the next reviewer.** Approve a request that has an attachment, then **sign in as the next-stage reviewer** and try to open it | Two accounts, one real or test request | The sharing code grants a role that may not permit opening the file (G-028), and **three separate layers of error suppression mean it reports success either way.** The only honest test is to try it as the other person | **20 min** |
| **VT-15** | **In a *copy* of the FAS tracker**, confirm the tab is named `FAS Travel Exceptions`, record columns A–N, and **capture the exact status strings column M actually contains** | A copy of the FAS tracker spreadsheet — **not the live one** | The code reads that column with a **substring match**, so `"Not Approved"` is read as **approved** `[VERIFIED]`. **It cannot be fixed safely until the real strings are known** — fixing it against guessed values would be worse than leaving it. G-023, G-024 | **15 min** |
| **VT-22** | **Does the prototype spreadsheet `1bsMXl2F4D…` exist?** If so, record its tab names and header rows | Drive, or open the ID directly | This is the **only** available route to recovering a data schema the project brief refers to and that exists in no commit of this repository (G-047). If the sheet is gone, that schema is unrecoverable and should be recorded as such | **15 min** |
| **VT-28** | **Confirm the three Drive folder IDs resolve, and record each one's sharing settings** — including `1BVAqc5GM6L5LAE85kW94uGHLNwIAa3e`, which is written directly into the source code | Drive → open each ID → Share | One folder ID is **hardcoded in the source** rather than configured (G-065), so it was never reviewed as a configuration choice and a rebuild would carry it along. These folders hold travel attachments | **10 min** |

> **VT-15 deserves one extra sentence, because the instruction to use a copy is not caution for its own sake.** The live FAS tracker belongs to another office. The code that would write to it has a well-built environment guard that refuses to touch the official tracker from a non-production project `[VERIFIED]` — **that guard is the best-engineered thing in this codebase.** Work in a copy so you are never the reason it gets tested.

---

## §10.7 Group E — code review and regression

**2 items · 125 min · needs no live access at all.**

**Both of these can be done by a different person, at a different time, from this repository alone.** That is why they are last: they are the only tasks that do not compete for the system owner's time.

| ID | Do this, and write down the answer | Where exactly | Why it matters | Cost |
|---|---|---|---|---|
| **VT-26** | **Targeted review for cross-site scripting** in `travelRequestTravelers.html` and `travelReviewController.html`: every place a traveller name, a justification, or a reviewer comment is interpolated into markup. Record each interpolation and whether the value is escaped | The two files, in this repository | **This is the one security question a static reading of the code could not close.** Those fields are free text entered by users and rendered into other users' pages. It needs a human judgement per site, which is why it is two hours and not two minutes | **2 h** |
| **VT-29** | **Re-run all sixteen evidence scripts and confirm they still reconcile.** Record any line beginning `!!` | `cd docs/evidence && for f in *.js; do echo "== $f"; node "$f"; done` | Every counted claim in all ten documents comes from these scripts, and **several deliberately report where their own answer differs from the prose.** So this is the cheapest regression check available — if a number in these documents has gone stale, this prints it | **5 min** |

> **VT-29 is five minutes and it is the task that keeps this documentation honest.** It has already caught a stale figure in this very checklist: the effort total in §10.0 was published as *"under six hours"* until the validator added up the per-task costs and got **7 h 1 m**. Run it before anyone cites these documents to leadership.

**Also worth running, in the same five minutes** — the application's own three test suites:

```sh
cd lets_app && for f in test_*.js; do echo "== $f"; node "$f"; done
```

> **But do not read green tests as reassurance about the budget half of the system.** All three suites pass *because* they feed the calculation engine data in the shape it wants, bypassing the layer that would convert spreadsheet rows into that shape. **That conversion is broken** (G-040), and no test exercises it.

---

## §10.8 Six business decisions — not tasks, and deliberately not numbered as tasks

**These six questions cannot be answered by this checklist.** Nobody can settle them by opening a screen or running a function, because they ask what the system *should* do rather than what it does. **Only the business owner can decide them.**

They are listed here because **four of the six block findings rated Critical or High** — meaning those findings cannot be closed by engineering effort at all until someone decides. Leaving them inside the task list would have made this checklist uncompletable, and a checklist that cannot be finished stops being used.

| ID | The question | What it blocks | Why only the owner can answer it |
|---|---|---|---|
| **BD-1** | **Is this system supposed to run as the person using it, or as the person who deployed it?** | G-001–G-006 | **VT-01 tells you what it currently is. This asks what it should be** — a different question, and the first does not imply the second. The manifest says one thing and eight lines of source say the other, so **one of the two is a misunderstanding sitting in the codebase either way** |
| **BD-2** | **Should the AAS Front Office reviewer role see every request in the organisation?** | G-031 | It does today — the role carries organisation-wide visibility, identical to `admin` for every filter. **The role's name does not advertise that.** Whether that is correct is policy, not a defect |
| **BD-3** | **When a request is sent back for more information, should the assigned reviewer keep the ability to edit it?** | G-003, **G-067** | **This is the most expensive unanswered question in the system.** Two complete, correct authorisation guards already exist in the codebase and are called from nowhere. Adopting them closes two Critical findings at roughly one line per call site — **but adoption would remove that edit access.** So the cheapest fix for the worst findings waits on this one answer |
| **BD-4** | **Which cost figure is authoritative for budget purposes — the system's calculated total, or a user-entered estimate?** | G-035, G-036, G-040 | The largest open design question here. **The two halves of the system currently assume different answers**, and every budget-integration decision depends on which is right |
| **BD-5** | **Who owns the decision about the duplicated `Requests` tab name, and what is the decision?** | G-013, G-023 | Two separate schemas both claim one tab name. Someone must choose, rename, or separate them. **Gates all budget-integration work** |
| **BD-6** | **Is it intended that a Front Office reviewer's own client-paid request is approved with no human review at any stage?** And should the cost tiers be enforced from the calculated cost rather than a self-declaration? | G-018, G-055 | Both are **emergent side effects of two individually sensible rules**, not deliberate design. *You cannot review your own request* and *client-paid travel needs no compliance review* combine to produce self-approval. If that is intended it should be written down as a rule; if not, it is a defect |

> **BD-3 is the one to answer first, and it is a short conversation.** It is the only item on this page whose answer immediately unlocks work that is already written, reviewed, and sitting unused.

---

## §10.9 Five of these tasks produce the only record that will ever exist

**This is the part of the checklist most likely to be treated as an audit chore and skipped. It should not be.**

**If the Apps Script project were lost tomorrow and rebuilt from this repository, the code would be correct and the system would not work** `[VERIFIED]`. Eight categories of configuration live outside version control, and **there is no recovery runbook anywhere in this repository.**

| Task | What it preserves | What is lost without it |
|---|---|---|
| **VT-09** | Every Script Property and its value | **The system's entire configuration.** API key, mileage rates, folder IDs, sender address. A rebuilt project would start, serve pages, and compute wrong numbers |
| **VT-02** | Who holds the three privileged accesses | Who to ask, and who to re-grant. Also the complete list of people who can bypass every application control |
| **VT-05** | The role tables, in full, dated | **The only historical record of who held access.** This system audits travel decisions well and authorisation changes badly: a role deleted next month leaves no trace it ever existed. *"Who was an administrator in March?"* is already unanswerable — and **every week this waits, more history becomes unrecoverable** |
| **VT-03** | The HR library's identifier, and the values it emits | **The binding itself.** It is declared in no manifest, so a rebuilt project would have no HR library and would **silently deny access to every supervisor** — with no error anywhere, just a quiet wave of access complaints |
| **VT-13** + **VT-28** | The Drive folder IDs and their sharing | Where attachments live and who can see them |

> **One of the eight categories has partly closed since this was written.** The **deployment IDs** are now held in GitHub repository variables (§10.3), so the deployed URL would survive the loss of the Apps Script project. **That is one item of the eight, and the weakest one** — a rebuilt project gets a *new* deployment ID anyway, so the stored value is a record of what the URL *was*, which is what matters for the bookmarks and email deep links that would otherwise break silently. **The other seven are still unrecorded.**

> **Do these five and you have most of a disaster-recovery runbook that does not presently exist.** That is a stronger reason to run them than compliance is. **VT-05 is the urgent one** — it is the only task on this list whose value decreases the longer you wait.

---

## §10.10 A one-page record sheet

**Print or copy this.** It is the minimum worth keeping; several entries are the only record that will exist.

```
LETS verification — completed by ______________________  date __________

GROUP A — Apps Script editor and GitHub
 [ ] VT-01  Execute as: ______________  Who has access: ______________
            Deployment ID matches the repo variable?   Y / N
            Deployment URL: ______________________________  version: ____
 [ ] VT-02  Project editors: _________________________________________
            Spreadsheet editors: ____________________________________
            Can read CLASPRC_JSON: __________________________________
 [ ] VT-09  Properties recorded, production  [ ]   sandbox  [ ]
            Keys found absent: ______________________________________
 [ ] VT-10  OAuth scopes: ____________________________________________
 [ ] VT-19  travel_email_address = ____________  send-as alias?  Y / N
 [ ] VT-20  ?mode=reviewer-dashboard   loads / throws
 [ ] VT-21  Sandbox project is: _______________________________________
            Sandbox DB == production DB?   Y / N  <-- answer this one
            Sandbox web app reachable by whom: __________________________
            Root-wired project is: ______________________________________

GROUP B — the database spreadsheet
 [ ] VT-05  Both tabs exported and dated.  File: ______________________
 [ ] VT-06  Requests row 1 (verbatim): _______________________________
            column count: ____
 [ ] VT-07  Tab count: ____   Unexpected tabs: ______________________
            Budget-layer tabs present?  Y / N   with data?  Y / N
 [ ] VT-08  Row 1 recorded for all six tabs  [ ]   Any drift found?  Y / N
 [ ] VT-16  Duplicate Request_IDs?  Y / N   how many: ____
 [ ] VT-17  Orphan child rows?  Y / N   how many, which tabs: _________
 [ ] VT-23  LETS-style IDs present in Requests?  Y / N
 [ ] VT-25  Named ranges / protections / dropdowns found: _____________
 [ ] VT-27  Distinct Is_Active values seen: __________________________

GROUP C — run a diagnostic
 [ ] VT-03  HR library attached?  production Y / N   sandbox Y / N
            identifier: ____________________  version: ____
            supervisoryStatus values, VERBATIM: ________________________
            occupancyStatus values, VERBATIM: __________________________
 [ ] VT-11  issues[] reported: _______________________________________
 [ ] VT-12  Tested emails and outcome: _______________________________
 [ ] VT-18  Triggers found, and owner of each: _______________________
            Run as how many editor accounts? ____
 [ ] VT-24  fas_fo_reviewer active primary?  Y / N   who: _____________

GROUP D — Drive, email, external
 [ ] VT-04  *** BEFORE ANY G-002 FIX ***
            Cloud Logging hits for bootstrapTravelAdmin: ____
            Rows with Granted_By = 'bootstrap': ____  who: ____________
 [ ] VT-13  Shared Drive members: ____________________________________
 [ ] VT-14  Attachment opened by next reviewer?  Y / N
 [ ] VT-15  Tab name correct?  Y / N   Column M strings: _______________
 [ ] VT-22  Prototype sheet exists?  Y / N   tabs: ____________________
 [ ] VT-28  All three folder IDs resolve?  Y / N   sharing: ____________

GROUP E — no live access needed
 [ ] VT-26  Interpolation sites reviewed: ____   unescaped: ____
 [ ] VT-29  All 16 scripts run; lines beginning '!!' : ____

BLOCKED / not done, and why:
_____________________________________________________________________
_____________________________________________________________________
```

---

## §10.11 What to do with the answers

| If you found | Do this |
|---|---|
| **"Execute as" is the deployer** (VT-01) | Tell the system owner and the security officer **today**. Five findings are worse than documented. It does not need fixing today; it needs to be known today |
| **Rows marked `Granted_By: 'bootstrap'` that you cannot account for** (VT-04) | **Treat as a potential incident, not a defect.** Preserve the evidence, escalate, and do not remediate G-002 until someone has looked |
| **Any column drift in row 1** (VT-08) | **Stop and escalate.** Data is being written to the wrong fields now. This is the one finding on the list that gets worse every hour |
| **Duplicate IDs or orphan rows** (VT-16, VT-17) | Both confirm a known race (G-012) has already fired. Also check whether the affected requests skipped their compliance review (G-069) |
| **The sandbox shares the production database** (VT-21) | Stop testing in the sandbox until it is repointed. Sandbox activity is writing live travel data — **and the sandbox has its own published web app**, so it is reachable, not merely pushable |
| **The deployment ID does not match the repository variable** (VT-01) | The variable points at a stale or wrong deployment. Fix it **before** anyone adds a `clasp deploy` step that trusts it |
| **"Who has access: Anyone"** (VT-01) | The deployment URL is the only barrier to 412 browser-reachable functions. **The deployment ID stored in a plaintext repository variable is then closer to a key than to configuration** — raise it with the system owner |
| **`supervisoryStatus` is anything other than `2` or `'2'`** (VT-03) | Every supervisor is being denied access right now, and the system shows them a normal "no access" page. One-line fix, but **record the value first** |
| **Blank or unfamiliar `occupancyStatus` values** (VT-03) | The opposite problem — people may be getting in who should not (G-074). The fix needs the full value list, which is why this task collects it |
| **`Is_Active` values other than `TRUE`/`FALSE`** (VT-27) | Someone's revocation **did not revoke**. Check whether that person should still have access |
| **No HR library attached** (VT-03) | Expected access failures are explained. Record it as a configuration dependency — it is the single item most likely to be lost in a rebuild |
| **Everything as documented** | Say so, in writing, with the date. **A verified negative is a result**, and it is what lets the next person trust these documents instead of re-doing this work |

### Then do two things that are not on this list

1. **Fix G-022 — it is a wording change.** The intake form tells users their request *"will automatically synchronize with the official FAS Travel Exception Tracker."* **It will not** — that code has no caller `[VERIFIED]`. **The system is currently making a compliance claim to users that is not true**, and that is a one-line edit, cheaper than every item above.
2. **Answer BD-3** (§10.8). It is a conversation, and it unblocks the two best fixes available.

---

## §10.12 Validating this document

**This checklist is itself checked by a script**, because it is a dataset wearing prose and its own arithmetic had already gone wrong once:

```sh
cd docs/evidence && node pass6_checklist_check.js
```

Seven invariants, recomputed on every run: task-ID continuity · **the effort total re-summed from the per-task costs** · every function it names existing in source · every finding it cites resolving in the register · the task count agreeing across all ten documents · the VT-04 ordering constraint being present *and* prominent · business decisions staying out of the task list.

> **It has already earned its place.** The effort total in §10.0 was published as *"under six hours"* in four documents; the script added up the per-task costs and got **7 h 1 m**. The figure had been read off a table instead of summed. **A number derived from a document's own contents goes stale silently** — which is the one failure mode prose review will never catch, and the reason this file has a validator at all.

---

## §10.13 Where to go next

| You want | Read |
|---|---|
| Why any of these findings matter, ranked | [`GAP_REGISTER.md`](./GAP_REGISTER.md) |
| How to fix one without breaking something | [`ENHANCEMENT_PLAYBOOK.md`](./ENHANCEMENT_PLAYBOOK.md) |
| The system in one page | [`SYSTEM_STATE.md`](./SYSTEM_STATE.md) §8.0 |
| Who controls the system, and how to hold it | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) |
| What every tab and column means | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) |
| Everything, indexed by question | [`README.md`](./README.md) |

---

*End of Deliverable 10, and of the set. **Twenty-nine tasks, 7 h 1 m, of which 5 h 1 m needs the system open.** Every task states its exact location, what to write down, and why it matters in one sentence, because this is the one document in the set likely to be printed and carried. The six questions in §10.8 are not tasks and are not numbered as tasks — they are the decisions that no amount of looking will settle, and four of them block findings that engineering cannot close alone. The five tasks in §10.9 produce records that do not currently exist anywhere; if only those five get done, this document has paid for itself.*


