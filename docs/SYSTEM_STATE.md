---
title: "LETS System State"
description: "An honest current-state summary of the Logistics, Events, and Travel System"
status: canonical
tier: 1
audience: "system owner, Deputy Administrator, ISSO, incoming project manager"
last_updated: "2026-10-28"
evidence_base: "Deliverables 1-7 and the fourteen measurement scripts in docs/evidence/"
---

# LETS System State

**Deliverable 8 of 10.** A synthesis. **It contains no findings of its own** — every claim resolves to [`GAP_REGISTER.md`](./GAP_REGISTER.md) or to one of the measurement scripts.

---

## §8.0 The one page

**LETS is a working travel-request and approval system, in production use, built on a proven foundation it inherited from another GSA application. Its approval workflow is sound. Its weakness is a single inherited defect — the server does not consistently check who is calling it — and two complete, correct fixes for the worst of that already exist in the codebase, switched off.**

### What works

| | |
|---|---|
| **The approval workflow** | A 12-action state machine with a single source of transition truth. Correct `[VERIFIED]` |
| **The one function that matters most** | `submitReviewAction` enforces **both** who you are and whether the transition is legal. The approval decisions themselves are properly controlled `[VERIFIED]` |
| **Cost calculation** | 1,083 lines implementing per-diem, mileage, and the FTR 75% first/last-day rule correctly, with override reasons captured for audit `[VERIFIED]` |
| **Request-level auditing** | The `Approval_Log` is a real append-only trail with the actor's identity and the before/after state `[VERIFIED]` |
| **The deployment pipeline** | Better than most. Four deliberate controls, each documenting its own reasoning and enforced by a regression guard so it cannot be silently undone `[VERIFIED]` |
| **No credential handling at all** | No login form, no password, no session token. **The largest class of web vulnerability is structurally absent** `[VERIFIED]` |
| **No back door** | In 412 unguarded entry points, **not one** authorization bypass keyed on a literal email address `[VERIFIED]` |

### What does not

| | |
|---|---|
| **The server does not check who is calling it** | 412 functions are reachable from any authenticated browser; **51 of them change data with no authorization check** `[VERIFIED]`. All six Critical findings reduce to this |
| **Budget governance does not run** | The engine is written, arithmetically sound, and **structurally unreachable** — zero inbound references, zero browser-callable functions `[VERIFIED]` |
| **The system tells users two things that are not true** | The intake form promises a FAS compliance sync that does not happen; a badge announces a "Mandatory Budget Check" that does not exist `[VERIFIED]` |
| **Authorization changes are not auditable** | *"Who held the admin role in March?"* cannot be answered from this system. Not with difficulty — at all `[VERIFIED]` |
| **Nobody has recorded how it is deployed** | Twelve deployment facts are unknown, including whether a merge to `main` reaches users `[VERIFIED]` |

### The number that matters most

**Two.** `requireRequestViewer` and `requireRequestEditor` are complete, correct, and **called from nowhere** `[VERIFIED]`. Together they close two of the six Critical findings at roughly one line per call site.

Someone wrote the right fix and never switched it on. **Switching it on requires one business decision, not an engineering project.**

### What to do this week

| | Action | Cost |
|---|---|---|
| 1 | **Read the deployment's "Execute as" setting** (VT-01). It conditions the severity of every Critical finding | **2 minutes** |
| 2 | **Check whether anyone has used the self-grant function** (VT-04). Must happen *before* it is fixed — remediation destroys the evidence | 30 min |
| 3 | **Answer one question:** in a "needs more information" state, should the assigned reviewer keep edit access? (BD-3) | A conversation |
| 4 | **Correct the false FAS-sync notice** (G-022) | A wording change |

**Steps 1, 2 and 4 take under an hour between them.** Step 3 unblocks the cheapest fix for two Critical findings.

### The sentence to use when asked

> *The system inherits its authorization model from the TRIP application it was directed to build on. That model enforces access at the screen layer but not consistently at the server layer, which means a user can reach data and functions the interface does not offer them. The defect is well understood, bounded, and two correct fixes for the most serious part of it already exist in the codebase, unused. The LETS-specific work added to this foundation is of good quality. The remediation is small; the review that should have preceded adoption is what was missed.*

---

## §8.1 What the system is

A **Google Apps Script web application** whose database is **a Google Sheet** `[VERIFIED]`. Google runs the code; GSA owns the code and the data. There is nothing to patch and no hosting bill.

One web address. The screen a user gets depends on a `?mode=` value in the URL — eight screens in total `[VERIFIED]`.

### 8.1.1 It is two systems in one codebase, and one of them does not run

| | **System A — travel workflow** | **System B — budget governance** |
|---|---|---|
| Origin | Inherited from TRIP | Written for LETS |
| What it does | Intake, routing, review, approval, notification, attachments | Budget commitment, set-aside shares, reconciliation, FAS compliance |
| **Running?** | **Yes.** Every screen a user sees | **No. Nothing can call it** |
| Budget awareness | **None** | It is the budget logic |

**Why System B does not run.** All four of its modules expose **zero** top-level functions, and Apps Script makes only top-level functions callable from a browser. No code anywhere else references them `[VERIFIED]` — tested two independent ways.

**This is not "the wiring is incomplete."** There is currently no path to that code at all.

### 8.1.2 Three consequences

1. **The advertised mandatory budget check does not happen.** A travel request can be approved today with no budget consulted `[VERIFIED]`. If leadership believes budget enforcement is live, that belief is wrong.
2. **Seventeen findings describe defects nobody can trigger.** Real, but latent.
3. **That makes them the cheapest fixes available.** No production data in those tabs, no user depending on current behaviour, no migration. **They will never be cheaper to fix than now** — and they should be fixed *before* the layer is wired, not after.

### 8.1.3 What was inherited

Measured by byte-comparison against the TRIP reference `[VERIFIED]`:

| | Share of application code |
|---|---|
| **Inherited unmodified from TRIP** | **84%** |
| Modified by LETS | 5% |
| Written for LETS | 12% |

**Every controller, every shared service, and every reusable component is inherited unmodified.** LETS wrote **pages** — six new ones — and the budget layer `[VERIFIED]`.

---

## §8.2 The security position

### 8.2.1 One defect explains all six Critical findings

**The screens are not the boundary.** A web page in this system calls server functions by name, and Google makes *every* top-level function callable that way — not only the ones a screen uses.

| Measure | Count |
|---|---|
| Server functions defined | 459 `[VERIFIED]` |
| **Callable from any authenticated browser** | **412** |
| Used by any screen | 61 |
| **Callable but used by no screen** | **351** |
| Behind a guard that actually refuses | **31** |
| **Change data with no authorization check** | **51** |

So hiding a button, hiding a link, or showing someone an access-denied page controls what they **see**. It does not control what they can **call**.

**Everything in the Critical block follows from that one fact:**

| Rank | Finding | What any authenticated user can do |
|---|---|---|
| 1 | **G-001** | Reach 412 functions, 51 of which write without a check |
| 2 | **G-002** | **Grant themselves the `admin` role**, taking effect immediately |
| 3 | **G-004** | Read any request's full record — PII and probable CUI — then obtain its attachment file IDs and grant themselves access. **Request IDs are sequential** |
| 4 | **G-006** | *(configuration)* The application's Google permissions were never declared, so the effective grant is inferred from code and **includes full Drive** |
| 5 | **G-003** | Rewrite any request's itinerary, travellers, costs, grand total, status, and funding determination |
| 6 | **G-005** | **Trash any Google Drive file** by ID, with no ownership check |

**All six live in code byte-identical to the TRIP reference** `[VERIFIED]`.

### 8.2.2 Fifteen things are right, and they are not incidental

A summary listing only failures misrepresents the system. From the security pass `[VERIFIED]`:

- **No credential handling anywhere** — no login form, password, session token, or cookie. The largest class of web vulnerability is structurally absent.
- **No hardcoded back door.** In 412 unguarded entry points, not one authorization bypass keyed on a literal email.
- **Every role detector fails closed.** All five error paths demote to "no role" and never elevate — so a systemic failure locks people out rather than letting them in.
- **The site gate fails closed too.** HR data source unavailable → deny.
- **The admin gate is consistently applied where it was applied** — 31 functions, all through one shim over one function. No partial checks, no duplicated logic.
- **Cache invalidation on role changes is complete** — all eight mutating functions clear it.
- **Cached request data never carries another user's permissions.** Permission flags are recomputed per caller on every cache hit. A subtle thing to get right.
- **Admin "view-as" cannot escalate.** The one place LETS could have introduced a privilege-escalation bug, and it is implemented correctly — the override only narrows scope and fails closed on malformed input.

### 8.2.3 The two constructive findings

| | |
|---|---|
| **G-067** | **`requireRequestViewer` and `requireRequestEditor` exist, are complete, and have zero call sites** `[VERIFIED]`. Together they close G-003 and G-004 at roughly one line per call site. **The highest-value item in the assessment** |
| **G-068** | An unknown budget office fails closed — no crash, no silent pass `[VERIFIED]` by execution |

**G-067 is the most important sentence in this document.** The fix is not a project. It is adopting code that is already written, reviewed, and sitting unused — and it is blocked on one business decision (§8.5).

---

## §8.3 Where the system stands against its own promises

Seventy business rules were inventoried and typed by whether the code enforces them `[VERIFIED]`:

| | Count | Meaning |
|---|---|---|
| **Enforced** | **7** | The code checks it and refuses when it fails |
| Applied | 37 | The code acts on it, but nothing prevents the opposite |
| **Claimed only** | **9** | Documentation or the UI says the system does this. **It does not** |
| Latent | 17 | Written and correct, in code nothing can reach |

**Five of the seven enforced rules are in one function** — `submitReviewAction`. That function is the system's single point of real rule enforcement; the other two are the Division Director checks.

### 8.3.1 Two claims are made to users, not just in documents

**This is a different and more serious category than a stale code comment** `[VERIFIED]`:

| The system displays | Reality |
|---|---|
| *"This request will automatically synchronize with the official FAS Travel Exception Tracker Google Sheet"* | **No synchronization occurs.** The function has no caller (**G-022**) |
| *"Mandatory Budget Check Enabled"* | **No budget check exists in any reachable path** (**G-015**) |

**A user who reads these and proceeds believes two compliance actions have occurred that have not.**

**G-022 is the cheapest high-value fix in the register — a wording change** — and it should be made before anything else in this document.

### 8.3.2 "Completed" does not mean the trip happened

`COMPLETED` means every traveller's Division Director confirmed funding, which occurs **before travel** `[VERIFIED]`. There is **no post-travel status and no actual-cost capture anywhere in the running system**.

> **Any statement to leadership about "completed travel spend" built on this status would be wrong.** The system is an approval system that stops at approval (**G-019**).

### 8.3.3 One emergent rule that is a policy question

**If the AAS Front Office reviewer submits a request where every traveller is client-paid, it is approved with no human review at any stage** `[VERIFIED]`.

**This is not a defect in the ordinary sense.** It is the emergent result of two individually sensible rules — *you cannot review your own request*, and *client-paid travel needs no FAS review*. Neither is wrong; their combination produces self-approval.

**Whether that is acceptable is a business decision** (**G-018**, BD-6). If intended, it should be documented as a rule. If not, the fix is one routing branch. Either way it should be conscious.

---

## §8.4 Accountability — what can and cannot be reconstructed

### 8.4.1 The pattern

**Travel decisions are audited well. Changes to who holds access are not** `[VERIFIED]`.

| | |
|---|---|
| **Request-level actions** | Go into a real append-only log with the actor's identity and the before/after state. `Admin_Actions.js` is the model the rest of the system should follow |
| **Authorization changes** | Audited by **current-state columns that are overwritten on the next change** |

**The concrete consequence:**

> ***"Who held the `admin` role in March?" cannot be answered from this system.*** A role deleted in April leaves no trace it ever existed. A role deactivated in April has overwritten the record of who activated it (**G-009**).

**Two mitigations, both worth acting on now:**

1. **Export the two role tables immediately, and on a schedule** (VT-05). A dated export is the only historical record of authorization state that can be created, and **the longer this waits, the more history is already unrecoverable.**
2. **One audit column cannot be trusted.** Six write sites record the actor's role as the literal `'Submitter'` regardless of who called `[VERIFIED]`. The email beside it is real; the role label may be an assertion.

### 8.4.2 The administrator is not the most privileged person

**Ranked by what each privilege can actually do** `[VERIFIED]`:

| Rank | Privilege | Can the application restrict it? |
|---|---|---|
| **1** | Apps Script project editor — can run any of 459 functions with no role check, and read every stored secret | **No** |
| **2** | Spreadsheet edit access — can grant themselves `admin` by typing in a cell, **with no log entry** | **No** |
| **3** | The CI deployment secret — standing production deploy authority, no second approval | **No** |
| **4** | **The application's `admin` role** | Yes — this is the only one it manages |

**Nobody has recorded who holds ranks 1, 2, or 3** `[UNKNOWN]`. **VT-02** enumerates them in fifteen minutes.

> **Any statement about who controls LETS is incomplete until that is done** — and in systems of this kind the editor list usually includes people who have moved on.

---

## §8.5 What is blocked on a decision rather than on engineering

**Seven findings cannot be closed by engineering effort.** They wait on answers only the business owner can give `[VERIFIED]`.

| Decision | Blocks | The question |
|---|---|---|
| **BD-3** | **G-003** (Critical) and **G-067** | In a "needs more information" state, should the assigned reviewer keep edit access? |
| **BD-5** | G-013, G-023 | Two schemas claim the same database tab name. Who decides, and what is the decision? |
| **BD-6** | G-018, G-055 | Is Front-Office self-approval intended? Should cost thresholds be computed rather than self-declared? |
| **BD-2** | G-031 | Should the AAS Front Office reviewer role see every request in the organisation? |
| **BD-4** | *(blocks no single finding)* | **Which cost figure is authoritative** — the system's computed grand total, or a user-entered estimate? |
| **BD-1** | *(conditions all six Criticals)* | Is the deployment meant to run as the visiting user, or as the deploying owner? |

### 8.5.1 BD-3 is the one to prioritise

**G-003 is a Critical finding, and its cheapest fix is G-067 — and both wait on the same decision.** One conversation unblocks the cheapest available remedy for two of the six Critical findings.

**The decision has substance.** `requireRequestEditor` already implements an answer: it refuses reviewer edits during a "needs information" state, on the reasoning that the ball is with the submitter and co-editing would race. **That may be exactly right** — but adopting the guard *changes workflow behaviour*, not just enforcement, and that needs an owner's assent rather than a developer's.

### 8.5.2 BD-4 is the one most likely to be skipped

No finding is tagged as blocked on it, because it does not block a specific defect — **it blocks the design that three budget findings all assume** `[VERIFIED]`. The two layers currently assume different answers.

**It is the largest unresolved design question in the system**, and fixing the budget findings without answering it would hard-code one of two incompatible answers.

---

## §8.6 What is not known, and what it costs to find out

**Twelve facts about the live deployment cannot be determined from the repository** `[VERIFIED]`. This is not a gap in the assessment — deployment state genuinely lives outside version control.

| Unknown | Task | Cost |
|---|---|---|
| The "Execute as" and "Who has access" settings, **whether a merge reaches users**, and the web-app URL | **VT-01** | **2 min** |
| Who holds project editor, spreadsheet editor, and the CI secret | VT-02 | 15 min |
| Every configuration value (API key, mileage rates, folder IDs, sender address) | VT-09 | 10 min |
| Whether the HR data library is attached, and what values it emits | VT-03 | 20 min |
| What the undocumented third Apps Script project is, and whether the sandbox shares the production database | VT-21 | 20 min |
| Which scheduled jobs are installed, and under whose account | VT-18 | 15 min |
| The actual Google permission scope users consent to | VT-10 | 10 min |
| The live email sender address | VT-19 | 10 min |

**The whole table is under two hours.** The full verification checklist is **29 tasks and under six hours** — Deliverable 10.

### 8.6.1 Two of these are also disaster-recovery artefacts

**If the Apps Script project were lost and rebuilt from the repository, the code would be correct and the system would not work** `[VERIFIED]`. Eight categories of configuration live outside git, and **the most dangerous absence produces no error at all**: the HR data library is referenced at 28 sites, declared in no manifest, and every failure is a logged warning. A rebuilt project would start, serve pages, and **silently deny access to every supervisor** who relies on it.

**There is no recovery runbook.** VT-09 and VT-02 together produce most of one — which is the strongest practical argument for running them promptly rather than treating them as audit chores.

---

## §8.7 The accountability question, answered both ways

**You will be asked whether this is a well-built system. There are two true answers and a summary owes you both.**

### The reassuring reading

**LETS did not introduce the security gaps.** All six Critical findings live in code byte-identical to the TRIP application `[VERIFIED]` — code this project was directed to adopt as a proven foundation.

**Judged on its own work, the project's engineering is good.** The FAS environment gate is exemplary — fail-closed in every direction, citing its NIST controls, with a dedicated passing test suite. The CI/CD separation is deliberate and documents its own reasoning. The `.claspignore` guard shows real understanding of an obscure platform hazard that could take the whole application down. The admin "view-as" feature, the one place LETS could have introduced a privilege-escalation bug, is implemented correctly.

### The uncomfortable reading

**The gaps were adopted without a security review of what was being adopted.** Eighty-four percent of the code was accepted unexamined.

**And the clearest evidence is a pattern propagating rather than being caught:** the one inherited weakness LETS reproduced *by choice* — loading third-party JavaScript with no integrity checking — appears in the **new** pages the project wrote `[VERIFIED]` (**G-034**).

### Neither is a criticism of competence

Adopting a working application wholesale is a reasonable engineering decision under schedule pressure, and the TRIP application does work. **The gap is a process one: there was no step at which someone asked what the adopted code permitted.**

That is a correctable process, and this documentation set is the correction.

---

## §8.8 Where the system is, in one table

| Dimension | State |
|---|---|
| **In production use** | Yes. People submit travel requests through it today |
| **Approval workflow** | **Sound.** 12-action state machine, correctly enforced |
| **Cost calculation** | **Complete and correct**, including the FTR 75% rule |
| **Budget governance** | **Written, correct, unreachable.** Nothing can call it |
| **Server-side authorization** | **The central weakness.** 51 unguarded writers; all six Criticals reduce to it |
| **Request auditing** | **Good.** A real append-only trail |
| **Authorization auditing** | **Largely absent.** Historical state is unrecoverable |
| **Deployment pipeline** | **Better than most**, with four self-documenting controls |
| **Deployment state** | **Unrecorded.** Twelve unknowns, under two hours to close |
| **Disaster recovery** | **No runbook.** Eight configuration categories outside git |
| **Findings** | 73 — 6 Critical, 19 High, 32 Medium, 13 Low, 1 Informational, 2 Constructive |
| **Of those, inherited** | **43 — including every Critical** |
| **Blocked on a decision** | 7 |
| **Currently untriggerable** | 22 |
| **Fixes that already exist, unused** | **2** |

---

## §8.9 Where to go next

| You want | Read |
|---|---|
| How to administer the system, and who controls it | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) |
| What every file and module does | [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) |
| What every tab and column means | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) |
| Every rule, and which are actually enforced | [`WORKFLOW_AND_BUSINESS_RULES.md`](./WORKFLOW_AND_BUSINESS_RULES.md) |
| Deployment, configuration, and recovery | [`DEPLOYMENT_AND_ENVIRONMENTS.md`](./DEPLOYMENT_AND_ENVIRONMENTS.md) |
| **The findings, ranked, with ownership and blockers** | [`GAP_REGISTER.md`](./GAP_REGISTER.md) |
| **How to fix them without breaking something** | [`ENHANCEMENT_PLAYBOOK.md`](./ENHANCEMENT_PLAYBOOK.md) |
| The verification tasks, with locations and costs | `HUMAN_VERIFICATION_CHECKLIST.md` (Deliverable 10) |
| The index to all ten documents | `README.md` (Deliverable 9) |

### Verifying this summary

**Every figure in this document is produced by a script, not asserted.** None was counted by hand.

```sh
cd docs/evidence && for f in *.js; do echo "== $f"; node "$f"; done
```

Fourteen scripts, about fifteen seconds. Several of them deliberately report where their mechanical answer differs from a document's prose, so a stale claim surfaces rather than persisting quietly — **four citation errors and one wrong cross-document count were caught that way while these documents were being written.**

---

*End of Deliverable 8. This document introduces no findings; it synthesises Deliverables 1–7. Where it gives a number, that number resolves to a named script. Where it gives a judgement — §8.7 most of all — it gives both sides, because a one-sided summary of this system would be either alarmist or complacent, and neither would be true.*
