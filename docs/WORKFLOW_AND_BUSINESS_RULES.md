---
title: "LETS Workflow and Business Rules"
description: "Every rule the system enforces, every rule it claims and does not enforce, and every rule only the business owner can decide"
status: canonical
tier: 1
audience: "project manager, system owner, reviewer, developer changing workflow behaviour"
last_updated: "2026-10-28"
evidence_base: "docs/evidence/pass6_rule_census.js"
---

# LETS Workflow and Business Rules

**Deliverable 4 of 10.** Companion to [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md), [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) and [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md).

---

## How to read this document

A rule in this document is one of four things, and **the distinction is the whole point**:

| Type | Meaning |
|---|---|
| **ENFORCED** | The code checks it and refuses when it fails `[VERIFIED]` |
| **APPLIED** | The code acts on it, but nothing prevents the opposite — a default, a calculation, a routing choice |
| **CLAIMED** | Documentation or a comment says the system does this. **It does not.** Marked `[NOT FOUND]` |
| **LATENT** | Written and correct, but in code nothing can currently reach (**G-016**) |

Every rule has an ID — `W-nn` for workflow, `C-nn` for cost, `B-nn` for budget, `F-nn` for FAS compliance — so it can be cited, argued with, and tracked. **Rules that are only claimed get an ID too.** That is deliberate: an unenforced rule is a backlog item, and it needs a handle.

### The one thing to understand before reading

**This document describes two rule sets, and only one of them is in force.**

| | System A — travel approval | System B — budget governance |
|---|---|---|
| Status | **Live.** Every rule below runs today | **Unreachable.** No rule below can be triggered `[VERIFIED]` |
| Rules here | §4.2 – §4.5 | §4.6 |
| Budget awareness | **None** | It *is* the budget logic |

They are presented in separate sections and never merged into one list. A combined rule table would imply the budget rules are in force. **They are not** — see `SYSTEM_COMPONENT_MAP.md` §2.6 for the proof.

Every count here is produced by [`evidence/pass6_rule_census.js`](./evidence/pass6_rule_census.js), which extracts the state machine from source rather than trusting a transcription, and **executes** the decision logic it describes.

---

## §4.0 A correction to the earlier analysis, stated first

**Passes 4 and 5 both describe a "13-action state machine". There are twelve actions** `[VERIFIED]`.

`pass6_rule_census.js` parses `getActionConfig()` directly and finds 12 keys. **Pass 4's own table lists 12 rows** — its prose miscounted its own table, and Pass 5 and two deliverables repeated the figure.

The mistake is easy to repeat, because **three unrelated "action" counts exist in this codebase**:

| Count | What it is |
|---|---|
| **12** | Actions in `getActionConfig()` — **the state machine** |
| 23 | Entries in `ACTION_TYPES` — the `Approval_Log` vocabulary |
| 15 | Entries in `STATUS_CODES` — the status vocabulary |

`ACTION_TYPES` is larger because it also covers things that are not reviewer decisions: `Submitted`, `Reminder_Sent`, five `Edit_*` audit actions, `ADMIN_OVERRIDE`, `ADMIN_REASSIGN`, and `All_DD_Confirmed`. Those are *logged* actions, not transitions.

**Use 12 for the state machine.** `ADMINISTRATOR_GUIDE.md` and `SYSTEM_COMPONENT_MAP.md` have been corrected; Pass 4 §4.1.3 and Pass 5 §5.11 still carry the old figure and should not be cited for it.

---

## §4.1 The rule inventory at a glance

| | Enforced | Applied | Claimed only | Latent | Total |
|---|---|---|---|---|---|
| **§4.2** Routing | 0 | 9 | 0 | 0 | 9 |
| **§4.3** State machine | **5** | 2 | 0 | 0 | 7 |
| **§4.4** DD confirmation | 2 | 7 | 1 | 0 | 10 |
| **§4.5** Cost and notification | 0 | 16 | 2 | 0 | 18 |
| **§4.6** Budget | 0 | 0 | 2 | **15** | 17 |
| **§4.7** FAS compliance | 0 | 3 | 2 | 2 | 7 |
| **§4.8** UI claims shown to users | 0 | 0 | 2 | 0 | 2 |
| **Total** | **7** | **37** | **9** | **17** | **70** |

**Read the first column carefully.** **Seven rules out of seventy are genuinely enforced** — and **five of those seven are in one function**, `submitReviewAction` (§4.3.4). That function is the system's single point of real rule enforcement; the other two are the Division Director record-level checks (§4.4).

**Read the last two columns as the backlog.** Nine rules are claimed and absent (§4.8); seventeen are written and unreachable (§4.6). Neither group is doing anything today, and the difference between them is that the latent ones are *correct*.

---

## §4.2 System A — how a request gets routed

### 4.2.1 The two-phase cascade

On submission, `determineInitialRouting()` `Submission.js:74` decides the first reviewer `[VERIFIED]`.

**Phase 1 — the skip rules. "You cannot review your own request."**

| ID | Rule | Type | Resulting start stage |
|---|---|---|---|
| **W-01** | If the submitter **is** the AAS FO (OSO) reviewer, skip to FAS | APPLIED | `PENDING_FAS` |
| **W-02** | If the submitter **is** the BU reviewer, skip to OSO | APPLIED | `PENDING_OSO` |
| **W-03** | If the submitter **is** the Sector Director, skip to BU | APPLIED | `PENDING_BU` |
| **W-04** | Otherwise, if a Sector Director exists for the submitter's sector, start there | APPLIED | `PENDING_SECTOR` |
| **W-05** | If no Sector Director is found, start at BU | APPLIED | `PENDING_BU` |

**Phase 2 — the vacancy cascade.** Walks `Sector → BU → OSO → FAS`, skipping any stage whose reviewer has no email `[VERIFIED]`.

| ID | Rule | Type |
|---|---|---|
| **W-06** | A stage with no assigned reviewer is skipped entirely | APPLIED |
| **W-07** | If the chain exhausts, the request lands at `PENDING_OSO` — **possibly with an empty reviewer email**, which strands it with no assignee | APPLIED |

### 4.2.2 The terminal branch — the most consequential rule in System A

| ID | Rule | Type |
|---|---|---|
| **W-08** | At the FAS stage: if **any** traveller is overhead-funded → `PENDING_FAS`, assigned to the active `fas_fo_reviewer` primary | APPLIED |
| **W-09** | If **no** traveller is overhead-funded → **`APPROVED_GOGOV` immediately. No human approval at any stage.** | APPLIED |

**The overhead test is lenient and inverted** — `!val || val === 'overhead'` `[VERIFIED]` `Review_Action.js:528`. A **blank** `Is_Client_Paid` counts as overhead.

> **That per-row default is correct and is a genuine strength.** A missing funding value routes to *more* scrutiny, not less. §4.3.5 shows the same function making the opposite choice one line earlier, which is what makes this worth stating explicitly.

### 4.2.3 W-01 and W-09 combine into self-approval

**If the AAS Front Office reviewer submits a request where every traveller is client-paid**, W-01 sets the start stage to FAS, and W-09 sees no overhead — so the request reaches `APPROVED_GOGOV` with **no Sector, no BU, no FO, no FAS review, and no email to any approver** `[VERIFIED]`. The `Approval_Log` records a single `Submitted` row.

This is finding **G-018**.

> **This is a policy question, not a defect.** It is the emergent result of two individually sensible rules — *you cannot review your own request* and *client-paid travel needs no FAS review*. Neither is wrong. Their combination produces self-approval.
>
> **Whether that is acceptable is BD-6 — the business owner's decision, not an engineering one.** If it is intended, it should be documented as a rule. If it is not, the fix is a branch that routes a self-submitted client-paid request to one named alternate reviewer. Either way it should be a *conscious* policy.

---

## §4.3 System A — the state machine

### 4.3.1 The twelve actions

`getActionConfig(action, currentStatus)` `Review_Action.js:303` is the single source of transition truth `[VERIFIED]`. Extracted from source:

| Action | Valid only from | → New status | Comment required | Role logged |
|---|---|---|---|---|
| `sector_approve` | `PENDING_SECTOR` | `PENDING_BU` | no | `Sector_Director` |
| `sector_needs_info` | `PENDING_SECTOR` | `NEEDS_INFO_SECTOR` | **yes** | `Sector_Director` |
| `bu_approve` | `PENDING_BU` | `PENDING_OSO` | no | `BU_Reviewer` |
| `bu_needs_info` | `PENDING_BU` | `NEEDS_INFO_BU` | **yes** | `BU_Reviewer` |
| `oso_approve` | `PENDING_OSO` | `PENDING_FAS` *(or `APPROVED_GOGOV` — §4.3.5)* | no | `OSO_Reviewer` |
| `oso_needs_info` | `PENDING_OSO` | `NEEDS_INFO_OSO` | **yes** | `OSO_Reviewer` |
| `fas_approve` | `PENDING_FAS` | `APPROVED_GOGOV` | no | **`Admin`** |
| `fas_deny` | `PENDING_FAS` | `DENIED` | **yes** | **`Admin`** |
| `deny` | any of the three `PENDING_*` (not FAS) | `DENIED` | **yes** | `Reviewer` |
| `cancel` | anything except `COMPLETED` / `CANCELLED` / `DENIED` | `CANCELLED` | **yes** | `Reviewer` |
| `submitter_cancel` | same | `CANCELLED` | no | `Submitter` |
| `resubmit` | the three `NEEDS_INFO_*` | back to the matching `PENDING_*` | no | `Submitter` |

> **`fas_approve` and `fas_deny` record the role as `Admin`, not `FAS_Reviewer`** `[VERIFIED]` `Review_Action.js:420`. The FAS stage is performed by whoever holds `Current_Reviewer_Email`, and the audit trail labels that action `Admin` regardless of who it was. An auditor reading `Approval_Log` cannot distinguish a FAS front-office approval from an administrator override by the role column alone.

### 4.3.2 The lifecycle

```
SUBMIT ──(W-01…W-09 decide the entry point)
  │
  ├─→ PENDING_SECTOR ─approve─→ PENDING_BU ─approve─→ PENDING_OSO
  │        │                        │                     │
  │   needs_info               needs_info            needs_info
  │        ↓                        ↓                     ↓
  │   NEEDS_INFO_SECTOR        NEEDS_INFO_BU        NEEDS_INFO_OSO
  │        └────── resubmit ────────┴─────────────────────┘
  │                                                       │
  │                                                  oso_approve
  │                                                       ↓
  │                     ┌─── any traveller overhead-funded? ───┐
  │                     │ YES                             NO   │
  │                     ↓                                      ↓
  │                PENDING_FAS ──fas_approve──→ APPROVED_GOGOV ←┘
  │                     │                              │
  │                  fas_deny                          ↓
  │                     ↓                  PENDING_DD_CONFIRMATION
  │                  DENIED                  (one per traveller's DD)
  │                                                    │
  │                                   all confirm ─────┴───── issue reported
  │                                          ↓                      ↓
  │                                      COMPLETED         Pending_Correction
  │                                                                 │
  └──────────────────── (submitter corrects funding) ───────────────┘

   Any PENDING_* ──deny──→ DENIED        Anything ──cancel──→ CANCELLED
```

### 4.3.3 Four statuses that are declared but never written

`STATUS_CODES` declares 15 values. **Two are never written by any code path** `[VERIFIED]`:

| Status | Written by | Read by | Assessment |
|---|---|---|---|
| `DRAFT` | **nothing** | `Access.js` (1), `Review_Update.js` (2) | **G-060.** Drafts live only in browser storage. The three readers list it as editable — a branch that can never be taken |
| `SUBMITTER_CANCELLED` | **nothing** | `Status.js` (1), **`Reporting.js` (3)** | See below |

> **`SUBMITTER_CANCELLED` is worse than dead code, and this is new — registered as G-070 (Low).** `Reporting.js` tests for it in **three** places `[VERIFIED]`, but `submitter_cancel` writes `CANCELLED` — so those three branches are unreachable.
>
> **The consequence is a reporting gap:** reports grouping by status **cannot distinguish a submitter cancellation from a reviewer cancellation**. The distinction does exist — in `ACTION_TYPES.SUBMITTER_CANCELLED` and in the `Approval_Log` — but not in the status column the reports group by. The code looks like it handles the distinction. It does not.
>
> This is a new finding from Pass 6 and is not in the register. It should be added as a Low.

### 4.3.4 What `submitReviewAction` enforces — the five real rules

**This is the system's one point of genuine rule enforcement** `[VERIFIED]`, and every check is located:

| ID | Rule | Type | Where |
|---|---|---|---|
| **W-10** | Admins bypass the identity checks | ENFORCED | `Review_Action.js:79` |
| **W-11** | For `resubmit` / `submitter_cancel`, the caller **must be** the submitter | **ENFORCED** — throws | `:82` |
| **W-12** | For every other action, the caller **must be** `Current_Reviewer_Email` | **ENFORCED** — throws | `:87` |
| **W-13** | The action must be legal from the current status | **ENFORCED** — throws | `:94` |
| **W-14** | Comments are mandatory where the action requires them | **ENFORCED** — throws | `:100` |

Seven `throw` sites in the file `[VERIFIED]`. A rule that does not throw is not enforced.

**The contrast is the finding.** `Review_Update.js` — 2,712 lines of request editing — has 10 throws but only **2** identity comparisons `[VERIFIED]`, which is why five of its seven `update*` RPCs check nothing (**G-003**). The pattern to copy exists in the same codebase.

### 4.3.5 The runtime override, and which way it fails

A rule sits **on top of** the table in §4.3.1. On `oso_approve`, the handler re-reads traveller rows and, if no traveller is overhead-funded, rewrites the outcome to `APPROVED_GOGOV` — skipping FAS review entirely `[VERIFIED]` `Review_Action.js:125-145`.

| ID | Rule | Type |
|---|---|---|
| **W-15** | `oso_approve` on an all-client-paid request goes straight to `APPROVED_GOGOV`, bypassing `PENDING_FAS` | APPLIED |
| **W-16** | The overhead test fails **open** on degraded data — see below | APPLIED |

**So one predicate decides whether a request receives FAS Front Office review for Executive Order 14222 compliance.** The question worth asking of such a predicate is not whether it is right for good data, but **which way it fails for bad data**.

The logic, verbatim `[VERIFIED]` `Review_Action.js:541`:

```javascript
if (!rows || !rows.length || isClientPaidCol === undefined) return false;
return rows.some(row => {
  const val = String(row[isClientPaidCol] || '').toLowerCase().trim();
  return !val || val === 'overhead';
});
```

Executed against every input class — the copy is verified character-for-character against the source before running `[VERIFIED]`:

| Input | `isOverhead` | Outcome |
|---|---|---|
| One overhead traveller | `true` | `PENDING_FAS` — reviewed |
| All client-paid | `false` | `APPROVED_GOGOV` — skips FAS |
| **Blank cell on a row** | `true` | `PENDING_FAS` — reviewed |
| Mixed: one of two overhead | `true` | `PENDING_FAS` — reviewed |
| **No traveller rows at all** | `false` | **`APPROVED_GOGOV` — SKIPS FAS** |
| **`rows` is null** | `false` | **`APPROVED_GOGOV` — SKIPS FAS** |
| **`Is_Client_Paid` column missing** | `false` | **`APPROVED_GOGOV` — SKIPS FAS** |

> **All three degraded inputs fail open.** The guard clause returns `false` — "no overhead" — and `false` means skip FAS.
>
> **This is a new finding from Pass 6, registered as G-069 (High).** It matters because the two degraded conditions are not hypothetical: they are **G-012** (partial submission leaves a request with no traveller rows) and **G-014** (a renamed or reordered column). A request hit by either is approved **without** the compliance review it requires.
>
> **Note the asymmetry inside one function.** The per-row default (`!val` → overhead) fails **closed** and is correct. The collection-level guard clause fails **open**. Same function, two lines apart, opposite defaults.
>
> **A mitigation is already present and is worth crediting.** Both degraded conditions are detected and logged before the predicate runs — `console.error` plus `logError` at `Review_Action.js:131` and `:136` `[VERIFIED]`, both tagged `CRITICAL`. **So the condition is recorded.** It is not *prevented*: execution continues and the request is approved. Someone saw this coming and logged it instead of stopping. Changing `return false` to a thrown error would close it.

### 4.3.6 The comment mandate

| ID | Rule | Type |
|---|---|---|
| **W-14** | Six of twelve actions require a written comment | ENFORCED |

**Require comments:** `sector_needs_info`, `bu_needs_info`, `oso_needs_info`, `fas_deny`, `deny`, `cancel`
**Do not:** `sector_approve`, `bu_approve`, `oso_approve`, `fas_approve`, `submitter_cancel`, `resubmit`

**The rule is consistent:** every action that **stops or reverses** a request requires a reason; every action that **advances** one does not `[VERIFIED]`. All six stopping actions are covered.

**One asymmetry worth recording:** `cancel` requires a comment and `submitter_cancel` does not, though both reach `CANCELLED`. A reviewer must justify a cancellation; a submitter cancelling their own request need not. Defensible — but it means `CANCELLED` rows carry inconsistent explanations, and §4.3.3 has already shown the status column cannot tell you which kind it was.

---

## §4.4 System A — Division Director funding confirmation

After `APPROVED_GOGOV`, each traveller's Division Director must confirm funding before the request reaches `COMPLETED` `[VERIFIED]` `Review_DDConfirm.js`.

### 4.4.1 The rules

| ID | Rule | Type | Where |
|---|---|---|---|
| **W-17** | A DD may confirm **only** traveller rows whose `DD_Email` equals their own address | **ENFORCED** — non-matching rows are skipped | `:330` |
| **W-17a** | Attachment sharing to the next reviewer passes `'viewer'`, which is **not a valid Drive role**. Three layers of error suppression report success either way (**G-028**) | APPLIED — broken | `Attachments.js:467` |
| **W-18** | Confirming sets `DD_Confirmed = TRUE` and `DD_Confirmed_At` on that traveller's row | APPLIED | `:333` |
| **W-19** | When **every** traveller row is confirmed, the request becomes `COMPLETED` and an `All_DD_Confirmed` action is logged | APPLIED | `:364` |
| **W-20** | A DD reporting a funding problem sets the request to `Pending_Correction` and records the flagged travellers, notes, and reporter | APPLIED | `:420` |
| **W-21** | The submitter correcting funding sets the request back to `Pending_DD_Confirmation`, clears the three DD issue fields, and re-emails **only the affected DDs** | APPLIED | `:702` |
| **W-22** | Authorization here is **purely record-level**. There is no role check — a person who is nobody's DD matches no rows and confirms nothing | ENFORCED (by construction) | `:330` |

### 4.4.2 W-22 is a real control, with one edge

The comparison is `ddEmail === currentUserEmail` after both are lower-cased `[VERIFIED]`. Executed across input classes:

| `DD_Email` cell | Session email | Result |
|---|---|---|
| `dd@gsa.gov` | `dd@gsa.gov` | **Confirms** — correct |
| `DD@GSA.GOV` | `dd@gsa.gov` | **Confirms** — case handled correctly |
| `other@gsa.gov` | `dd@gsa.gov` | No match — correct |
| *(blank)* | `dd@gsa.gov` | No match — **correct, fails closed** |
| *(blank)* | *(blank)* | **Confirms** |

**The last row is the only edge, and it is narrow.** If a traveller row has a blank `DD_Email` *and* the session returns a blank address, the comparison `'' === ''` succeeds and the row confirms.

**Whether this is reachable is `[UNKNOWN]`.** `Review_DDConfirm.js:292` calls `.getEmail().toLowerCase()` with **no `|| ''` fallback** — while 13 other call sites in the codebase *do* guard against a blank email `[VERIFIED]`. So the codebase elsewhere treats a blank session email as possible, and here does not. If it is possible, a blank-`DD_Email` traveller row self-confirms.

> **This is worth one line of defence rather than an investigation.** Adding `if (!currentUserEmail || !ddEmail) continue;` closes it regardless of whether the condition can occur. Registered as **G-071** (Low).

### 4.4.3 Two naming traps in this sub-workflow

| ID | Rule | Type | Finding |
|---|---|---|---|
| **W-23** | **`COMPLETED` means "funding confirmed", not "travel happened"** — it is reached *before* the trip `[VERIFIED]` `:364` | APPLIED | **G-019** |
| **W-24** | There is **no post-travel status and no actual-cost capture anywhere in System A** `[VERIFIED]` | **CLAIMED** `[NOT FOUND]` | **G-019** |

**W-23 will mislead any report built on it.** A request marked `COMPLETED` tells you the funding was confirmed before travel. It does **not** tell you the trip occurred, what it cost, or whether anyone reconciled estimate against actual. `Request_Travelers` has 38 columns of estimates and **no actuals columns** `[VERIFIED]` — see `DATA_DICTIONARY.md` §3.3.2.

**Any statement to leadership about "completed travel spend" built on this status is wrong.** System A is an approval system that stops at approval.

### 4.4.4 The three columns this sub-workflow invents

`reportDDFundingIssue` **adds three columns to the `Requests` tab at runtime** if they are absent `[VERIFIED]` — `DD_Flagged_Travelers`, `DD_Issue_Notes`, `DD_Issue_Reporter`. None appears in any schema.

| ID | Rule | Type | Finding |
|---|---|---|---|
| **W-25** | The live `Requests` tab becomes 45 columns wide, not 42, as soon as any DD reports a funding issue | APPLIED | **G-044** |

The two column-position calculations disagree — `headers.length + 1` versus `getLastColumn() + 1` `[VERIFIED]` — which differ when the sheet has trailing blanks. Full detail in `DATA_DICTIONARY.md` §3.2.4.

---

## §4.5 System A — cost calculation

**This is the most complete part of the system.** `server/30_services/Costs.js` is 1,083 lines of substantial, correct-looking work `[VERIFIED]`.

### 4.5.1 The rules

All line references below are in `server/30_services/Costs.js`. **Note there are two files named `Costs.js`** — the other is `server/01_constants/Costs.js`, 25 lines of constants `[VERIFIED]`.

| ID | Rule | Type | Where |
|---|---|---|---|
| **C-01** | **M&IE is paid at 75% on the first day, the last day, and any single-day trip** | APPLIED | `calculateMieTotal` `:326` |
| **C-02** | Lodging is paid per **night**, not per day | APPLIED | `calculateLodgingTotal` `:294`, `calculateNights` `:254` |
| **C-03** | Per-diem source routes by location: GSA (CONUS) / DoD (OCONUS) / State (foreign) | APPLIED | `getPerDiemForLeg` `:90` |
| **C-04** | Mileage uses the `private` or `gov` rate per traveller's transport mode | APPLIED | `calculateTransportationTotal` `:392`, modes at `:400`, `:404` |
| **C-05** | An "other costs" gross-up is applied, default **15%** | APPLIED | `calculateOtherCosts` `:499` |
| **C-06** | Lodging and M&IE support an override with `{enabled, amount, reason}`, stored per leg | APPLIED | `:294`, `:326` |
| **C-07** | The rate in force at submission is **copied into the row**, not referenced | APPLIED | `DATA_DICTIONARY.md` §3.3.1 |
| **C-08** | `Grand_Total` = `Shared_Total` + `Traveler_Total` — **the authoritative cost figure for System A** | APPLIED | §3.2.3 col 23 |
| **C-09** | Normal commute distance and parking are netted off local travel | APPLIED | `Request_Travelers` cols 30–31 |

**C-01 matches the Federal Travel Regulation** and is implemented cleanly with a per-day breakdown `[VERIFIED]`. **C-06 is good auditability** — the override reason is the only free-text justification of a financial decision anywhere in the child tabs.

**C-07 is correct behaviour worth knowing:** a later per-diem sync does **not** retroactively change an existing request. Reconciling a request against *current* rates would therefore be wrong.

### 4.5.2 The configurable rates, and the rule that is only claimed

| Script Property | Read by | Default if unset | Live value |
|---|---|---|---|
| `MILEAGE_RATE_PRIVATE` | `Props.js:89` | `0.70` | `[UNKNOWN]` |
| `MILEAGE_RATE_GOV` | `Props.js:98` | `0.22` | `[UNKNOWN]` |
| `other_cost_percentage` | `Props.js:117` | `15` | `[UNKNOWN]` |
| `GSA_PERDIEM_API_KEY` | `PerDiemGSA.js` | none — **CONUS lookups fail** | `[UNKNOWN]` |

**VT-09** captures the live values.

| ID | Rule | Type | Finding |
|---|---|---|---|
| **C-10** | *"Running `initTravelSystemConfig()` sets the system's mileage rates and thresholds."* | **CLAIMED** `[NOT FOUND]` | **G-020** |

**The initializer writes each key lower-cased** `[VERIFIED]` `Database.js:454`, and **four of seven keys it writes are read by nothing**:

| Key written | Read anywhere? |
|---|---|
| `private_mileage_rate` | **No** — readers use `MILEAGE_RATE_PRIVATE` |
| `gov_mileage_rate` | **No** — readers use `MILEAGE_RATE_GOV` |
| `local_travel_threshold` | **No** — the string appears only at its own definition |
| `drive_folder_id` | **No** — readers use `SHARED_DRIVE_FOLDER_ID` |
| `other_cost_percentage` | Yes |
| `travel_email_address` | Yes |
| `travel_email_name` | Yes |

> **An administrator who runs the documented setup step and then sets mileage rates will find the rates unchanged, with no error.** This is the clearest "documented rule that does not exist" in System A, and the fix is to correct the key names in the initializer.

### 4.5.3 Fiscal period derivation — one implementation is mislabelled

| ID | Rule | Type | Finding |
|---|---|---|---|
| **C-11** | Fiscal year = calendar year + 1 for October–December | APPLIED — **correct** `[VERIFIED]` | — |
| **C-12** | The dashboards' *"FY Quarter"* uses quarters starting **Jan / Apr / Jul / Oct** | APPLIED — **mislabelled** | **G-049** |

**Federal Q1 is October–December. This code's "Q1" is January–March** `[VERIFIED]`. The arithmetic is internally consistent; the label is wrong for every quarter of the year.

**And it is implemented twice** — `Admin_Dashboard.js:476` and `ReviewerDashboard.js:466` `[VERIFIED]` — so fixing it means fixing both, and nothing detects divergence. Only `ReviewerDashboard.js` carries the misleading `'FY Quarter'` label.

### 4.5.4 Notification rules

18 notification functions `[VERIFIED]` `Email.js`. The rules that govern sending:

| ID | Rule | Type |
|---|---|---|
| **C-13** | Every stage transition notifies the acting reviewer **and** the next reviewer | APPLIED |
| **C-14** | `APPROVED_GOGOV` triggers a DD confirmation email to **each traveller's** DD with a deep link | APPLIED |
| **C-15** | A funding correction re-emails **only the affected DDs**, not all of them | APPLIED |
| **C-16** | If the acting user has `Suppress_Emails = TRUE` in `Test_Submitters`, **every** send is dropped and reports success | APPLIED |
| **C-17** | Sender identity comes from Script Properties, defaulting to `ASD.Travel-Events@gsa.gov` | APPLIED |
| **C-18** | **No notification exists for any budget event** — no insufficient-funds alert, no deficit warning | **CLAIMED** `[NOT FOUND]` |

**C-16 is a real control and worth knowing about operationally.** A tester with that flag set generates no mail at all — including to real reviewers — and the function returns `{success: true, suppressed: true}` `[VERIFIED]`. **VT-19** confirms the live sender address.

**C-18 is consistent with System B being unreachable.** There is nothing to notify about.

---

## §4.6 System B — the budget rules

### 4.6.1 Read this section differently

**Not one rule in this section can currently be triggered.** All four LETS modules expose zero top-level functions and have zero inbound references `[VERIFIED]` — `SYSTEM_COMPONENT_MAP.md` §2.6, finding **G-016**.

These rules are **LATENT**: written, mostly correct, and unreachable. The section exists because:

1. The arithmetic is genuinely sound and was verified by execution — this is real work, not a sketch.
2. **Every defect here goes live the moment the layer is wired**, and §4.6.7 says which.
3. Two rules are **CLAIMED but absent**, and those are the ones that would hurt.

### 4.6.2 The core formula

```
Remaining Discretionary Balance =
      Baseline Allocation
    + Mid-Year Adjustments            (from Budget_Adjustments, by office)
    − Self-Funded Set-Asides          (100% charged to the target office)
    − Share of Enterprise Set-Asides  (amount × that office's proportional share)
    − Pending Estimated Costs         (requests in any of 8 in-flight statuses)
    − Posted Actual Costs             (requests in RECONCILED status)
```
`[VERIFIED]` `BudgetEngine.js:176-239`

**Observed output for FY27 with no requests** `[VERIFIED]` by execution — `pass4_budget_engine_baseline.js`:

| Office | Baseline | Prop. share | Self-funded | Enterprise share | Remaining |
|---|---|---|---|---|---|
| FO | $4,000 | — | $0 | $0 | **$4,000** |
| OMD | $152,000 | 0.153 | $12,000 | $3,060 | **$136,940** |
| IDV | $659,000 | 0.664 | $12,000 | $13,280 | **$633,720** |
| CM | $182,000 | 0.183 | $64,500 | $3,660 | **$113,840** |
| **Portfolio** | **$997,000** | — | **$108,500** | — | **$888,500** |

> **These are exactly the figures hardcoded into the `?mode=budget` dashboard** `[VERIFIED]` — which confirms the mockup was built from real engine output rather than invented. The dashboard is not lying about the numbers; it is lying about them being live.

### 4.6.3 The rules that work

| ID | Rule | Type |
|---|---|---|
| **B-01** | Self-funded set-asides are charged 100% to the target office | LATENT — correct |
| **B-02** | Enterprise set-asides are spread by proportional share. Observed: $3,060 + $13,280 + $3,660 = **$20,000 exactly** | LATENT — correct |
| **B-03** | **Double-counting is prevented.** A reconciled request's estimate is dropped and only its actual is charged | LATENT — **correct, and verified by execution** |
| **B-04** | `Rejected` and `Cancelled` release the commitment entirely | LATENT — correct |
| **B-05** | An unknown `owningOffice` returns a $0 balance and `hasSufficientFunds: false` — **fails closed** | LATENT — **correct** (**G-068**, a positive finding) |
| **B-06** | 8 of 12 statuses count as pending commitment; 1 counts as posted actual; 3 count as nothing | LATENT — verified by running all 12 |

**B-03 is worth crediting.** Double-counting prevention is the single hardest thing to get right in a commitment-accounting engine, and it is right `[VERIFIED]`.

### 4.6.4 The rules that are wrong

| ID | Rule as implemented | Type | Finding |
|---|---|---|---|
| **B-07** | **`RECONCILED` with blank actuals silently frees the entire commitment.** A $50,000 request marked reconciled with $0 actuals yields `pendingEstimates: 0, postedActuals: 0` | LATENT — **wrong** | **G-035** |
| **B-08** | **`reconcileRequest` overwrites the approved estimate** with whatever the reconciler supplies, destroying the variance basis | LATENT — **wrong** | **G-036** |
| **B-09** | **No validation on cost.** A −$999,999 estimate yields `hasSufficientFunds: true` and a projected balance of **$1,136,939** | LATENT — **wrong** | **G-051** |
| **B-10** | **`Set_Asides.Active` is never read.** Rows marked `FALSE` are still deducted in full | LATENT — **wrong** | **G-052** |
| **B-11** | **`LETS-` IDs are count-based.** Three calls with the same count return `LETS-2027-003` three times; deleting a request causes reuse; the year is **hardcoded to FY27** | LATENT — **wrong** | **G-037** |
| **B-12** | The gatekeeper's self-exclusion filter removes **every** request sharing a blank `requestId` — $130,000 erased in the observed test | LATENT — **wrong** | **G-050** |
| **B-13** | `isDeficit` is `false` when the balance is exactly $0, so a fully exhausted budget raises no flag | LATENT — minor | **G-062** |
| **B-14** | Proportional shares are never recomputed; they go stale after a mid-year rebaseline | LATENT — by design, but undocumented | **G-053** |

**All eight were observed by execution, not inferred** `[VERIFIED]` — `pass4_budget_engine_edge_cases.js` and `pass4_request_service_edge_cases.js`.

**B-07 deserves emphasis.** Marking trips reconciled without entering actuals is **the single most likely data-entry mistake in a reconciliation workflow**, and it inflates the available balance by the full estimate. Because `RECONCILED` is checked *before* the pending-status list, the status alone releases the estimate regardless of what the actuals say.

### 4.6.5 The two rules that are claimed and absent

| ID | Claim | Reality | Finding |
|---|---|---|---|
| **B-15** | `RequestService.js:147` JSDoc: *"Advances Kanban stage with **role and permission checks**"* | **CLAIMED** — no identity comparison, no transition table `[NOT FOUND]` | **G-038** |
| **B-16** | `reconcileRequest` implies a completed-travel precondition | **CLAIMED** — no status check of any kind, accepts reconciliation from `Submitted` `[NOT FOUND]` | **G-036** |

**B-15 observed by execution** `[VERIFIED]`: any `userEmail` string moves a request to any status; a request jumps `Submitted` → `Reconciled / Actuals Posted` directly; the arbitrary string `'Totally Made Up'` is accepted and written.

> **Contrast with System A.** `getActionConfig` validates the source status for **every** action (§4.3.1). **System B has no state machine at all.** If System B is wired up as-is, `updateRequestStatus` is an unguarded hole into the request lifecycle — and because it is also a top-level-callable surface once wired, it would inherit **G-001** too.

### 4.6.6 One rule that is cosmetic rather than wrong

| ID | Rule | Type | Finding |
|---|---|---|---|
| **B-17** | The `SETASIDE_FO_LC_GAP` set-aside appears in the Front Office breakdown with `proportionalShare: 0` and `appliedDeduction: 0` | LATENT — presentational | **G-061** |

**The arithmetic closes** — the $20,000 is fully spread across the three DACs (B-02). FO is listed against a set-aside it is not charged for because it has no `standardProportionalShare` in config, being a non-DAC office. **That is almost certainly the intent** — the set-aside exists to cover the FO gap *using DAC money*. Recorded only because the FO breakdown *lists* a line it is not charged for, which a reader would reasonably query.

### 4.6.7 What activates when this layer is wired

| Activates | Count |
|---|---|
| Rules that start working correctly (B-01…B-06) | 6 |
| **Defects that go live (B-07…B-14)** | **8** |
| **Unenforced claims that become exploitable (B-15, B-16)** | **2** |

> **The scheduling conclusion, and it is the most useful fact in this document:** there is no production data in the budget tabs and no user depending on current behaviour. **Fixing B-07 through B-16 is cheaper now than it will ever be again** — and they should be fixed **before** wiring, not after. Wiring first means debugging a financial engine against live data.

---

## §4.7 FAS compliance — the rules that exist and the integration that does not

### 4.7.1 The policy taxonomy is fully and carefully specified

`TRAVEL_PURPOSES` `TripConfig.js:162` encodes the FAS delegation memo and Executive Order 14222 as **14 purpose codes in two tiers** `[VERIFIED]`.

**Tier 1 — FAS Chief of Staff approval, FAS Exception Tracker required (7 codes):**

| Code | Label | Event tracker |
|---|---|---|
| `FOREIGN_TRAVEL` | Travel to Foreign Areas (OCONUS) | yes |
| `HAE_PARTICIPATION` | Highly Attended Event Participation | yes |
| `NON_GSA_CONFERENCE` | Non-GSA Conference and Event Attendance | yes |
| `SPEAKING_ROLE` | Conference Speaking or Presenter Role (Non-GSA) | yes |
| `IMM_OVER_10K` | Internal Management Meeting > $10,000 | yes |
| `NON_FED_FUNDED` | Non-Federal Source Funded / Fee Reduced Event | yes |
| `TRAINING_OVER_7K` | Third-Party Training > $7,000 | **no** |

**Tier 2 — Portfolio / ASD Chief of Staff approval, no tracker (7 codes):** `GSA_SPONSORED`, `COMPLIANCE_SITE_VISIT`, `CUSTOMER_ENGAGEMENT`, `VENDOR_ENGAGEMENT`, `CLIENT_PAID`, `IMM_UNDER_10K`, `TRAINING_UNDER_7K` `[VERIFIED]`.

**Note the threshold pairs.** `IMM_OVER_10K`/`IMM_UNDER_10K` and `TRAINING_OVER_7K`/`TRAINING_UNDER_7K` are the same activity split by cost — and the split is made by the user, not by the system. That is §4.7.3.

**This is careful policy encoding.** It is also almost entirely inert.

### 4.7.2 The rules

| ID | Rule | Type | Finding |
|---|---|---|---|
| **F-01** | A Tier-1 purpose requires FAS CoS approval and a tracker row | **CLAIMED** `[NOT FOUND]` — `TRAVEL_PURPOSES` is read by exactly one function, which nothing calls | **G-029** |
| **F-02** | **The thresholds in the code names are never evaluated.** Nothing compares a request's total to $10,000 or $7,000 — **the user self-selects the code** | APPLIED | **G-055** |
| **F-03** | **The intake form tells the user their request will sync to the FAS tracker.** It does not | **CLAIMED** `[NOT FOUND]` | **G-022** |
| **F-04** | FAS decision status is read by **substring match** — `"Not Approved"`, `"Unapproved"` and `"Disapproved"` all contain `"approved"` and read as approval | LATENT — **wrong** | **G-023** |
| **F-05** | The Tier-1 code list is **duplicated** as a literal array in the client form | APPLIED — divergence risk | **G-054** |
| **F-06** | All six LETS-added intake fields — owning office, purpose, set-aside type, three policy flags — are **collected and discarded client-side** | APPLIED | **G-039** |
| **F-07** | A row is written to the FAS tracker on submission, and polled for decisions | LATENT — never called | **G-024** |

### 4.7.3 F-02 is the rule a compliance reviewer will ask about

The thresholds are embedded in the **code names and labels** — `IMM_OVER_10K`, `TRAINING_OVER_7K` — not evaluated against cost `[VERIFIED]`.

**So a user selecting the purpose of their own travel decides whether the threshold applies.** Nothing checks a $12,000 internal management meeting against the `IMM_OVER_10K` threshold; if the user selects `IMM_UNDER_10K`, the request routes as Tier 2 and no tracker row is required.

**System A computes `Grand_Total` before routing** `[VERIFIED]`, so the figure needed to enforce this exists at the right moment. The comparison is simply not made. **Whether thresholds should be computed rather than declared is BD-6.**

### 4.7.4 F-05 measured

| | Count |
|---|---|
| Tier-1 codes in `TripConfig.js` | 7 `[VERIFIED]` |
| Tier-2 codes | 7 `[VERIFIED]` |
| Tier-1 codes duplicated in `travelRequestPage.html` | 7 `[VERIFIED]` |
| **The two copies agree today** | **Yes** `[VERIFIED]` |

**They agree now. Nothing detects divergence**, and retiering a purpose requires editing both — one in server JavaScript, one in a client literal array, with no link between them.

### 4.7.5 The two different things called "FAS"

**A point of likely confusion, and worth stating plainly:**

| Concept | Mechanism | Working? |
|---|---|---|
| The `PENDING_FAS` workflow stage | Email to the `fas_fo_reviewer` primary; they approve or deny in the LETS review page | **Yes** |
| The FAS Travel Exception Tracker | A row appended to an external FAS-owned spreadsheet, polled for decisions | **No** — never called |

> **LETS today obtains an internal FAS front-office approval but does not file the EO 14222 exception the tracker exists to record.** If compliance depends on the tracker row existing, that obligation is currently unmet — and **F-03 means the system tells users otherwise.**
>
> **G-022 is the cheapest high-value fix in the entire assessment: a wording change.** Until it is made, the system makes a compliance representation to users that is not true.

### 4.7.6 What is missing to make the budget check real

The product's headline feature. Traced end to end `[VERIFIED]`:

| # | Missing piece | Status |
|---|---|---|
| 1 | The six form fields reach the server | `[NOT FOUND]` — discarded client-side |
| 2 | `Requests` has columns for them | `[NOT FOUND]` — no `Owning_Office` or `Travel_Purpose_Code` in the 42-column schema |
| 3 | A state object assembled from the budget tabs | `[NOT FOUND]` |
| 4 | Field mapping between sheet headers and engine properties | `[NOT FOUND]` — and broken as-is (**G-040**) |
| 5 | A call to `evaluateBudgetCheck` in the submission path | `[NOT FOUND]` |
| 6 | A status for "budget-blocked" in System A | `[NOT FOUND]` — `STATUS_CODES` has no budget state |
| 7 | Routing that diverts a blocked request to exception approval | `[NOT FOUND]` |
| 8 | **Cost bridging** — System A computes `Grand_Total`; System B expects `totalEstimatedCost` | `[NOT FOUND]` |

**Point 8 is the one most likely to be underestimated.** The two systems model cost incompatibly: System A derives per-traveller, per-leg costs from authoritative per-diem rates; System B expects a single total. **Which figure is authoritative is BD-4**, and it is a design decision, not a mapping exercise.

---

## §4.8 Rules that are claimed and do not exist

Collected in one place, because this is the backlog. Each has an ID so it can be tracked, and each is marked `[NOT FOUND]` against the specific mechanism it describes.

| ID | Claim | Where the claim is | Reality |
|---|---|---|---|
| **C-10** | Running the config initializer sets mileage rates | `Database.js:446` + setup documentation | **4 of 7 keys are written to names nothing reads** `[NOT FOUND]` (**G-020**) |
| **B-15** | *"Advances Kanban stage with role and permission checks"* | `RequestService.js:147` JSDoc | **No identity comparison, no transition table** `[NOT FOUND]` (**G-038**) |
| **B-16** | Reconciliation requires completed travel | implied by `reconcileRequest` | **No status check of any kind** `[NOT FOUND]` (**G-036**) |
| **F-01** | A Tier-1 purpose requires FAS CoS approval and a tracker row | `TripConfig.js:162` policy encoding | `TRAVEL_PURPOSES` is read by one function that nothing calls `[NOT FOUND]` (**G-029**) |
| **F-03** | *"This request will automatically synchronize with the official FAS Travel Exception Tracker"* | `travelRequestPage.html:903` — **shown to users** | **No synchronization occurs** `[NOT FOUND]` (**G-022**) |
| **F-07** | *"`syncFASTrackerStatus()` automatically advances the LETS request"* | handoff documentation | Returns a change list; advances nothing `[NOT FOUND]` (**G-024**) |
| **W-26** | *"Mandatory Budget Check Enabled"* — **CLAIMED** | `letsRequestPage.html:4` — a UI badge | **No budget check in any reachable path** `[NOT FOUND]` (**G-015**) |
| **W-27** | *"Real-time discretionary balance tracking"* — **CLAIMED** | `README.md` | Engine works; nothing calls it; dashboards are static `[NOT FOUND]` (**G-025**) |

### 4.8.1 Two of these are shown to users, which changes their character

**F-03 and W-26 are not documentation errors. They are statements the running application makes to the person using it** `[VERIFIED]`:

- The intake form displays a banner asserting the request will be filed with the FAS Travel Exception Tracker for EO 14222 compliance.
- A badge reads *"Mandatory Budget Check Enabled"*.

Neither happens. **A user who reads these and proceeds believes two compliance actions have occurred that have not.** That is a different and more serious category than a stale comment in a source file, and both should be corrected before any other item in this table — they are wording changes, not engineering.

### 4.8.2 The pattern in where claims drift from behaviour

Worth stating because it tells you which comments to trust:

| Where the comment is | Reliability |
|---|---|
| A file header describing **that file's own** behaviour | **Accurate** — `Users.js`, `Reporting.js`, `Admin_Actions.js` all do what they say `[VERIFIED]` |
| A comment describing what **another** file does | Often aspirational |
| A comment describing what **will** happen | Describes intent that was never completed |
| **UI text shown to a user** | **Two of the worst cases in the system** |

**Read file headers as reliable about themselves and aspirational about everything else.** The full list of eleven documentation contradictions is in `ADMINISTRATOR_GUIDE.md` §1.8.3.

---

## §4.9 Rules only the business owner can decide

**Six questions. None can be answered by reading code**, because each asks what the system *should* do.

| ID | Decision | Blocks | Why only the owner can answer |
|---|---|---|---|
| **BD-6** | **Is FO-reviewer self-approval on client-paid travel intended?** (W-01 + W-09) | G-018 | It is the emergent result of two sensible rules. If intended, document it as a rule. If not, it needs one routing branch |
| **BD-6** | **Should tier thresholds be computed from cost rather than self-declared?** (F-02) | G-055 | `Grand_Total` is available at the right moment. Whether to enforce it is policy |
| **BD-4** | **Which cost figure is authoritative — System A's `Grand_Total` or a user-entered estimate?** | B-07, B-08, G-040 | The largest unresolved design question in the system. The two layers assume different answers |
| **BD-3** | **In a `NEEDS_INFO_*` state, should the assigned reviewer retain edit access?** | G-003, G-067 | Gates adoption of `requireRequestEditor` — the cheapest fix for a Critical finding |
| **BD-5** | **Who owns the `Requests` tab-name collision decision, and what is it?** | G-013, G-023 | Two schemas claim one tab name. Someone must choose, rename, or separate them |
| **BD-2** | **Should `aas_fo_reviewer` see every request in the organisation?** | G-031 | The role carries `scope: 'all'` today — admin-equivalent visibility under a name that does not advertise it |

**Four of the six block findings rated Critical or High.** `GAP_REGISTER.md` must mark those `BLOCKED ON BD-n` rather than leaving them looking like open engineering work.

### 4.9.1 One decision that is also a question of fact

**BD-1** — is the deployment meant to run as `USER_ACCESSING` or `USER_DEPLOYING`? — is both. **VT-01** reports what it *is*; only the owner can say what it *should be*. Whichever way it resolves, one of the two bodies of evidence in this codebase is wrong (the manifest, or eight source comments) and should be corrected.

---

## §4.10 What this document cannot know

| Unknown | Why it matters | Resolves with |
|---|---|---|
| **The live mileage rates, cost percentage, and API key** | C-10 means the documented setup step may never have set them | **VT-09** — 10 min |
| **The exact FAS tracker status strings** | **F-04 cannot be fixed safely without them.** A wrong exact-match would reject valid approvals | **VT-15** — 15 min |
| **Whether a `fas_fo_reviewer` primary is assigned** | If vacant, W-08 routes overhead requests to an empty address and strands them | **VT-24** — 5 min |
| **Whether the degraded-data conditions in W-16 have occurred** | VT-16 and VT-17 test for the duplicate IDs and orphan rows that trigger the fail-open | **VT-16, VT-17** — 20 min |
| **Whether `Session.getActiveUser()` can return blank** | Decides whether W-22's narrow edge is reachable | Code review, or **VT-12** |
| **Whether any request has reached `COMPLETED` without travel occurring** | W-23's naming trap may already have misled a report | Spreadsheet query |

**Two findings in this document are new and not in the register:**

1. **W-16 — the fail-open overhead test** (§4.3.5) → **G-069**. Rated **High**: it bypasses a compliance control, and its two trigger conditions are existing findings.
2. **W-22's blank-email edge** (§4.4.2) → **G-071**, and **the `SUBMITTER_CANCELLED` reporting gap** (§4.3.3) → **G-070**. Both **Low**.

---

## §4.11 Where to go next

| You want | Read |
|---|---|
| Who controls the system and how to administer it | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) |
| Which file implements which rule | [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) |
| The exact columns these rules read and write | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) |
| The ranked findings with evidence | `GAP_REGISTER.md` (Deliverable 6) |
| How to change a rule safely | `ENHANCEMENT_PLAYBOOK.md` (Deliverable 7) |
| The verification tasks in order | `HUMAN_VERIFICATION_CHECKLIST.md` (Deliverable 10) |

### Reproducing this document's findings

```sh
cd docs/evidence
node pass6_rule_census.js                # the state machine, reachability, the fail-open test
node pass4_budget_engine_baseline.js     # the real FY27 figures
node pass4_budget_engine_edge_cases.js   # B-07, B-09, B-10, B-12
node pass4_request_service_edge_cases.js # B-08, B-11, B-15
```

`pass6_rule_census.js` extracts the state machine from source rather than trusting a transcription, verifies each cited line still resolves, **confirms its copy of the overhead predicate matches the source character-for-character before executing it**, and reports zero integrity problems. If the source changes, the citation check fails rather than the document quietly going stale.

---

*End of Deliverable 4. Seventy rules, each typed as enforced, applied, claimed, or latent — and the nine that are only claimed carry IDs so they can be tracked rather than forgotten. The System A and System B rule sets are never merged, because merging them would imply the budget rules are in force.*
