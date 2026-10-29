---
title: "LETS Gap Register"
description: "Every finding, severity-ranked with a stated rubric, with ownership, evidence, and blocking decisions"
status: canonical
tier: 1
audience: "project manager, system owner, ISSO, remediation planner"
last_updated: "2026-10-29"
evidence_base: "docs/evidence/pass6_register_check.js, pass6_hc_gate_predicate.js, and the fourteen other measurement scripts"
---

# LETS Gap Register

**Deliverable 6 of 10.** The prioritisation document. Its ordering is its product.

---

## How to read this document

**74 canonical findings.** Each has a permanent ID, a severity derived from a stated rubric, an owner, and a pointer to the evidence behind it.

### The two-column rule — read this before anything else

Every finding carries **both** a permanent `G-NNN` **and** a mutable `Rank`.

| Column | Property |
|---|---|
| **`G-NNN`** | **Permanent. Never reused, never renumbered.** Cited in five other deliverables and in six pass documents |
| **`Rank`** | **Mutable. Reflects current severity order.** Changes whenever a finding is re-rated |

> **`G-NNN` is not the current severity order, and the register must not be read as though it were.** The IDs were assigned in severity order when Pass 6 created them, so they *began* aligned. They are no longer: **G-048 has been re-rated from Medium to High** (§6.6.2), so it now sits at **rank 10** while its ID still falls in the Medium band. **Six findings have been added** as `G-069`…`G-074` and are interleaved by rank rather than appended by severity.
>
> **The two-column rule in action, most recently for `G-074`.** It was added at rank 32 beside the other `C3/R2` findings, which **shifted ranks 32–73 up by one** — 42 register rows and 41 rank citations in §6.8–§6.11, all moved mechanically. **No `G-NNN` changed.** That is the whole point of the separation: rank is the column that absorbs change, and `pass6_register_check.js` §[1] re-verifies that ranks still form a contiguous `1..n` sequence afterwards.
>
> This is deliberate. Renumbering on re-rate would invalidate every citation in nine other documents, which is a worse outcome than an ID that no longer matches its block.

### Confidence and status

| Marker | Meaning |
|---|---|
| `[VERIFIED]` | Measured by a script in `docs/evidence/`, or read directly from source |
| `[INFERRED]` | A reasoned conclusion; the reasoning is given in the cited deliverable |
| **`BLOCKED ON BD-n`** | **Cannot be closed by engineering work.** A business decision must come first |

### Ownership

| Label | Meaning | Count |
|---|---|---|
| **TRIP** | The defect lives in code byte-identical to the TRIP reference application `[VERIFIED]` | 43 |
| **LETS** | LETS-original code | 25 |
| **Shared** | LETS modified an inherited file, or reproduced an inherited pattern in new code | 5 |

Ownership is derived mechanically by byte-comparison, not by judgement — `pass6_manifest_recount.js`.

---

## §6.0 The register in one page

| | Count | Of which BLOCKED | Of which inherited from TRIP |
|---|---|---|---|
| **Critical** | 6 | 1 | **6 — all of them** |
| **High** | 19 | 3 | 11 |
| **Medium** | 33 | 2 | 16 |
| **Low** | 13 | 0 | 9 |
| **Informational** | 1 | 0 | 1 |
| **Constructive** | 2 | 1 | 1 |
| **Total** | **74** | **7** | **44** |

### The five things a reader should take from this register

1. **All six Critical findings are inherited, and all six reduce to one defect.** The server does not check who is calling it. 412 functions are reachable from any authenticated browser and 51 of them write without an authorization check `[VERIFIED]`.
2. **Two complete, correct fixes already exist in the codebase and have never been switched on** — `requireRequestViewer` and `requireRequestEditor`, zero call sites (**G-067**). They close the two worst findings at roughly one line per call site.
3. **Twenty-two findings describe defects nothing can currently trigger.** Seventeen are in the unreachable LETS subsystem; five are unreachable for other reasons (§6.7). They are real, latent, and **cheaper to fix now than they will ever be again**.
4. **Seven findings cannot be closed by engineering effort at all.** They wait on a business decision (§6.8).
5. **The cheapest high-value fix in the register is a wording change** — **G-022**, the intake form telling users their request will sync to the FAS tracker when it will not.

---

## §6.1 The severity rubric

**Stated before it is applied, so a rating can be argued with rather than merely disbelieved.**

Severity is **consequence × reachability**. Both axes are needed: a catastrophic defect in code nobody can invoke is not an emergency, and a trivial defect reachable by anyone may be.

### 6.1.1 Consequence — the worst credible outcome of one exercise

| | Meaning |
|---|---|
| **C4** | Unauthorized privilege escalation, or disclosure/alteration of PII, CUI, or financial records across the whole dataset |
| **C3** | Unauthorized alteration or disclosure of a specific record; silent financial misstatement; loss of audit trail |
| **C2** | Incorrect behaviour a user would notice, or data corruption requiring manual repair |
| **C1** | Cosmetic, documentation, naming, or dead-code defect with no behavioural effect |

### 6.1.2 Reachability — who can trigger it, as the system stands today

| | Meaning |
|---|---|
| **R4** | Any authenticated domain user, from a browser, with no special knowledge |
| **R3** | Any authenticated user who knows a function or record ID (enumerable or guessable) |
| **R2** | Requires an application role, spreadsheet edit access, or project editor access |
| **R1** | **Not currently invocable** — unwired, unreferenced, or structurally unreachable |

### 6.1.3 The matrix

| | **R4** any user | **R3** needs an ID | **R2** needs a role | **R1** not invocable |
|---|---|---|---|---|
| **C4** | **Critical** | **Critical** | High | Medium |
| **C3** | **Critical** | High | Medium | Medium |
| **C2** | High | Medium | Medium | Low |
| **C1** | Low | Low | Low | Informational |

**Three consequences of this matrix, each of which changes at least one rating:**

1. **A C4 defect that needs only a guessable ID is still Critical.** `getRequestForReview` requires a request ID, but IDs are sequential `[VERIFIED]`. *"Needs an ID"* is not a control.
2. **Everything in the LETS subsystem drops a band or two** via R1 — §6.7 applies this consistently rather than as a special case.
3. **Role-gated defects cap at High.** An `admin`-only defect presupposes a trust decision already made.

### 6.1.4 Two modifiers, applied explicitly

**The `USER_DEPLOYING` amplifier.** The manifest declares `executeAs: USER_ACCESSING` while eight source lines across six files assert `USER_DEPLOYING` `[VERIFIED]`. If production runs as `USER_DEPLOYING`, every unguarded function executes with the **deployer's** authority rather than the caller's.

**Five findings would move**: G-003, G-005, G-012, G-027, G-044. None is rated below High already, so **no finding changes block** — but the justification for the Critical block changes from *"any user can corrupt data"* to *"any user can corrupt data using a privileged identity."*

**Every rating in this register is on the manifest's declared value.** **VT-01** resolves it in two minutes and must run before the register is treated as final.

**The latency discount is refused.** A defect that has probably never been exercised is rated on consequence, not on luck. G-002 is Critical whether or not anyone has called it; **VT-04** determines whether anyone has, and that is an incident-response question rather than a severity one.

---

## §6.2 How to use the Status column

| Status | Meaning | What to do |
|---|---|---|
| `open` | Closeable by engineering work | Schedule it |
| **`BLOCKED ON BD-n`** | **A business decision must come first** | Get the decision. Do not estimate the work until it lands |
| `**re-rated**` | The severity changed since Pass 6 | Read §6.6 for why |
| `**new**` | Added after Pass 6, during Deliverables 1–5 | Read §6.5 for the evidence |

**Seven findings are BLOCKED.** They must not appear in a remediation plan as though they were open engineering work — that is how a plan slips without anyone noticing it was never actionable.

---

## §6.3 The register


### Critical — 6 findings

*fix before the system is treated as authorized*

| Rank | ID | Finding | C/R | Owner | Status | Pass ID |
|---|---|---|---|---|---|---|
| 1 | **G-001** | **412 functions are reachable from any authenticated browser; 51 of them write with no authorization check.** Includes the 118 `_foo` names that look private and are not | C4/R4 | TRIP | open | R-4, S-19 |
| 2 | **G-002** | **`bootstrapTravelAdmin` lets any authenticated user grant themselves `admin`** — writes both rows and clears the role cache so it takes effect at once | C4/R4 | TRIP | open | S-1 |
| 3 | **G-004** | **Request disclosure chain.** `getRequestForReview` returns any request's full record (PII + probable CUI); `getRequestAttachments` yields its file IDs; `shareAttachmentsWithUsers` grants anyone access. IDs are sequential | C4/R3 | TRIP | open | S-2, S-16 |
| 4 | **G-006** | **No `oauthScopes` declared.** The effective grant is inferred from API usage and includes full Drive and all spreadsheets. Nobody chose it; it widens silently as code is added | C4/R2 | TRIP | open | S-13 |
| 5 | **G-003** | **The review-edit surface has no authorization.** 5 `update*` RPCs plus `reportDDFundingIssue` and `submitFundingCorrection` let any user rewrite itinerary, travellers, costs, `Grand_Total`, status and `Is_Client_Paid` on any request | C3/R4 | TRIP | **BLOCKED ON BD-3** | S-4, S-17 |
| 6 | **G-005** | **`deleteTravelDraftFile` trashes any Drive file ID with no ownership check**; `uploadTravelDraftFile` has no size or MIME limit | C3/R3 | TRIP | open | S-3 |

### High — 19 findings

*fix in the first remediation cycle*

| Rank | ID | Finding | C/R | Owner | Status | Pass ID |
|---|---|---|---|---|---|---|
| 7 | **G-007** | **No server-side last-admin protection.** `deleteRole` / `setRoleActive` can leave zero admins and lock the console for everyone. The guard exists only in browser JavaScript | C4/R2 | TRIP | open | S-8 |
| 8 | **G-008** | **Two of three site-gate allow-paths are controlled by the HC library, not by LETS.** Access can be gained or lost with no LETS action and no LETS audit entry; the admin console cannot see it. The library is declared in no manifest and failures are swallowed | C4/R2 | TRIP | open | S-12, R-6 |
| 9 | **G-021** | **No branch protection; the `CLASPRC_JSON` holder has standing production deploy authority** | C4/R2 | LETS | open | R-9 |
| 10 | **G-048** | **An undocumented third Apps Script project is wired to the repository root** via an untracked `.clasp.json` | C4/R2 | LETS | **re-rated Medium → High** (§6.6.2) | M-5 |
| 11 | **G-010** | **`verifyPhase7Routing` is unguarded and returns the complete role roster** — every admin, the AAS and FAS primaries and backups, with names and addresses. One call maps the entire authorization structure | C3/R4 | TRIP | open | S-25 |
| 12 | **G-011** | **`?mode=budget` and `?mode=dd-confirm` page-servers have no role gate** beyond the site gate | C3/R4 | Shared | open | S-20, R-2 |
| 13 | **G-012** | **`Request_ID` generation has no lock, so duplicate primary keys are possible; the 5-tab submission has no transaction, so partial failure leaves orphan rows.** Self-documented as deferred | C3/R4 | TRIP | open | D-4 |
| 14 | **G-069** | **The client-paid override fails open.** The predicate deciding whether a request receives FAS Front Office review returns "no overhead" — which means *skip FAS* — for missing traveller rows, null rows, and a missing `Is_Client_Paid` column | C3/R4 | TRIP | **new** (§6.5) | D4 §4.3.5 |
| 15 | **G-009** | **Authorization changes are audited by overwritable current-state columns.** `deleteRole` leaves no record at all; bulk request deletion records only to Cloud Logging. "Who had admin in March" is unanswerable | C3/R2 | TRIP | open | S-15 |
| 16 | **G-014** | **18 order-dependent sheet access points, 8 of them positional write arrays.** Inserting a column silently corrupts every subsequent write | C3/R2 | TRIP | open | D-10 |
| 17 | **G-018** | **An AAS FO reviewer submitting an all-client-paid request is auto-approved with zero review** | C3/R2 | TRIP | **BLOCKED ON BD-6** | R-A1 |
| 18 | **G-019** | **`COMPLETED` means "funding confirmed pre-travel", not travel finished.** No post-travel state and no actuals capture anywhere in System A | C3/R2 | TRIP | open | R-A2 |
| 19 | **G-020** | **`initTravelSystemConfig` writes 4 of 7 property keys that nothing reads** — mileage rates set this way are silently ignored | C3/R2 | TRIP | open | R-A3 |
| 20 | **G-013** | **Tab-name collision on `Requests`:** 42 TRIP columns vs 20 LETS columns, different ID formats, disjoint status vocabularies, one tab name | C3/R1 | LETS | **BLOCKED ON BD-5** | D-6, M-2 |
| 21 | **G-023** | **FAS decision status is read by substring match, so `"Not Approved"` and `"Disapproved"` both read as approved** | C3/R1 | LETS | **BLOCKED ON BD-5** | D-14, R-C2 |
| 22 | **G-015** | **The LETS layer is unwired.** Zero references from any entry point; `apiGetInitialData` and `apiSubmitRequest` do not exist, so the single-page UI cannot load or submit | C2/R4 | LETS | open | M-3, R-5 |
| 23 | **G-017** | **Four broken `include()` targets**, including the `.html.html` names that make `?mode=reviewer-dashboard` throw | C2/R4 | TRIP | open | R-1, M-4 |
| 24 | **G-022** | **The intake form tells users their request will sync to the FAS tracker. It does not.** | C2/R4 | Shared | open | R-C4 |
| 25 | **G-016** | **The LETS layer is structurally unreachable, not merely unwired.** All four LETS modules are UMD/IIFE factories exposing zero top-level declarations, and Apps Script exposes only top-level declarations to `google.script.run` | C2/R1 | LETS | open | Pass 6 |

### Medium — 33 findings

*schedule — many are latent and cheapest to fix now*

| Rank | ID | Finding | C/R | Owner | Status | Pass ID |
|---|---|---|---|---|---|---|
| 26 | **G-030** | **`requireRole()` silently grants access for any unrecognized role name** — no `default: throw`. A future guard written against a new role name would do nothing | C4/R1 | TRIP | open | S-10 |
| 27 | **G-034** | **No CDN subresource integrity:** 34 external script and style references, zero `integrity=` attributes. A CDN compromise executes arbitrary JavaScript in every session | C4/R1 | Shared | open | S-24 |
| 28 | **G-026** | `getHCStaffingBundle` returns the full personnel roster with no role check | C3/R4 | TRIP | open | R-8 |
| 29 | **G-027** | **A role-table read can trigger a production write.** `selfHealCurrentUserEmail` patches `Travel_Users.Email` on a cache miss, rebinding a role set to a new address | C3/R4 | TRIP | open | S-5 |
| 30 | **G-031** | `aas_fo_reviewer` carries `scope: 'all'` — organisation-wide visibility identical to admin for all filtering. The role name does not advertise this | C3/R2 | TRIP | **BLOCKED ON BD-2** | S-11 |
| 31 | **G-032** | **`Is_Active` parsing treats only `false` / `'false'` as inactive.** Blank, `'no'`, `0` and typos all read as active, so a manual spreadsheet revocation may not revoke | C3/R2 | TRIP | open | S-14 |
| 32 | **G-074** | **The site gate's occupancy check is a denylist, so a blank or unrecognised `occupancyStatus` grants access.** Sits two lines below an allowlist that fails closed — opposite defaults in one predicate | C3/R2 | TRIP | **new** (§6.5) | Pass 6 re-check |
| 33 | **G-035** | **`RECONCILED` with blank actuals silently frees the entire commitment** | C3/R1 | LETS | open | R-B2 |
| 34 | **G-036** | **`reconcileRequest` overwrites the approved estimate**, destroying the audit basis for variance | C3/R1 | LETS | open | R-B3 |
| 35 | **G-037** | `LETS-` IDs are count-based: they collide under concurrency, reuse numbers after deletion, and are hardcoded to FY27 | C3/R1 | LETS | open | R-B5 |
| 36 | **G-038** | `updateRequestStatus` has no state machine and no permission check, contrary to its own documentation | C3/R1 | LETS | open | R-B11 |
| 37 | **G-040** | **The budget engine cannot read its own tabs** — every `BudgetEngine` field name mismatches its `LetsDB` header. Fails to zeros, not errors. The tests bypass the broken path | C3/R1 | LETS | open | D-7 |
| 38 | **G-050** | The gatekeeper self-exclusion filter erases all commitments sharing a blank `requestId` — $130,000 in the observed test | C3/R1 | LETS | open | R-B4 |
| 39 | **G-025** | `?mode=budget` is a static mockup — 30 hardcoded figures and a non-functional sync button — presented as live system configuration | C2/R4 | LETS | open | R-2 |
| 40 | **G-044** | `reportDDFundingIssue` adds 3 undocumented columns to `Requests` at runtime; two of the three use inconsistent column arithmetic | C2/R4 | TRIP | open | D-9 |
| 41 | **G-028** | Attachment sharing to the next reviewer passes `'viewer'`, which is not a valid Drive role. Three layers of error suppression report success | C2/R2 | TRIP | open | S-6 |
| 42 | **G-029** | `fas_fo_reviewer` has no branch in `getReviewerContext` and resolves to `role: 'none'`, so the FAS reviewer gets no dashboard | C2/R2 | TRIP | open | S-9 |
| 43 | **G-033** | The 12-function `Validation.js` library has zero adoption outside its own self-test | C2/R2 | TRIP | open | S-18 |
| 44 | **G-041** | The `Feedback` tab is written and read but has no schema; nothing creates it; its 13 headers exist nowhere in code | C2/R2 | TRIP | open | D-1 |
| 45 | **G-042** | Four per-diem tabs bypass `SHEET_NAMES` via 6 duplicate constants; renaming through the registry would silently do nothing | C2/R2 | TRIP | open | D-3 |
| 46 | **G-045** | No data validation, named ranges, or sheet protections are created anywhere | C2/R2 | TRIP | open | D-11 |
| 47 | **G-046** | **Four design documents referenced by code exist in no commit:** `Data_Model_v2.md`, `BUGS_FOUND.md`, `OPEN_QUESTIONS.md`, `REFACTOR_PLAN.md` | C2/R2 | TRIP | open | D-12 |
| 48 | **G-049** | `'FY Quarter'` labels calendar quarters, not fiscal ones; duplicate implementations in two files | C2/R2 | TRIP | open | R-A4 |
| 49 | **G-054** | The Tier-1 purpose list exists in three independent places — config, client array, and `<option>` markup | C2/R2 | Shared | open | R-C1 |
| 50 | **G-055** | Tier thresholds ($10k IMM, $7k training) are user-declared, never computed from cost | C2/R2 | Shared | **BLOCKED ON BD-6** | R-C3 |
| 51 | **G-056** | **Six real named GSA employees' addresses are embedded in routing-test fixtures with their role assignments labelled** | C2/R2 | TRIP | open | S-23 |
| 52 | **G-024** | FAS tracker wiring is incomplete: the poller reads decisions and discards them, there is no `FAS_Tracker_Row_ID` column, and no trigger installer | C2/R1 | LETS | open | R-3 |
| 53 | **G-039** | `setAsideType` and the three policy flags are collected and never read. Charging a trip to a specific set-aside pool is a design gap, not a wiring gap | C2/R1 | LETS | open | R-B12 |
| 54 | **G-043** | `Travelers` and `Audit_Log` have schemas and no writer anywhere; `RequestService` builds exactly-shaped data it never persists | C2/R1 | LETS | open | D-8 |
| 55 | **G-047** | **The brief's "Stage 1 persistence schema" (`LETS_SYSTEM_*`) exists nowhere in the repository or its history** | C2/R1 | LETS | open | M-1 |
| 56 | **G-051** | **No input validation on cost** — a negative estimate increases the apparent budget | C2/R1 | LETS | open | R-B7 |
| 57 | **G-052** | The `Set_Asides.Active` column is never read, so deactivation has no effect | C2/R1 | LETS | open | R-B8 |
| 58 | **G-053** | Proportional shares are never recomputed; they go stale after a mid-year rebaseline | C2/R1 | LETS | open | R-B9 |

### Low — 13 findings

*housekeeping*

| Rank | ID | Finding | C/R | Owner | Status | Pass ID |
|---|---|---|---|---|---|---|
| 59 | **G-071** | **DD confirmation self-confirms on a double blank.** `ddEmail === currentUserEmail` succeeds when both are empty; `Review_DDConfirm.js:292` omits the `\|\| ''` guard that 13 other call sites use | C3/R3 | TRIP | **new** (§6.5) | D4 §4.4.2 |
| 60 | **G-070** | **`SUBMITTER_CANCELLED` is read in three places and written nowhere.** `submitter_cancel` writes `CANCELLED`, so reports grouping by status cannot distinguish a submitter cancellation from a reviewer one | C2/R2 | TRIP | **new** (§6.5) | D4 §4.3.3 |
| 61 | **G-063** | **Eight placeholder approver addresses** (`<office>.director@gsa.gov`) are live config defaults, three rendered on the budget dashboard as real configuration | C1/R4 | LETS | open | S-21 |
| 62 | **G-057** | `File_Queue` is declared in the registry and referenced nowhere — a phantom tab | C1/R2 | TRIP | open | D-2 |
| 63 | **G-058** | Two incompatible `Log_ID` formats (`LOG-NNNNNN` and UUID) in one audit column | C1/R2 | TRIP | open | D-5 |
| 64 | **G-059** | `'Edit_SharedCosts'` is written as a literal and is absent from `ACTION_TYPES` | C1/R2 | TRIP | open | D-13 |
| 65 | **G-064** | The Gmail v1 advanced service is declared and never used — `Gmail.` appears nowhere | C1/R2 | TRIP | open | S-22 |
| 66 | **G-065** | A hardcoded Drive folder ID in `Database.js:27` is written to a dead property key | C1/R2 | TRIP | open | R-D1 |
| 67 | **G-072** | **The CI hardcoded-ID guard missed three identifier types.** Its 40-character floor caught Sheets (44) and Apps Script (57) but not Drive folder (32), Drive file (33), or web-app deployment IDs — the last being 72 characters but `A`-prefixed, so length was never the issue | C1/R2 | LETS | **remediated** 2026-10-29 | D5 §5.3.3 |
| 68 | **G-073** | **Two initializers write conflicting defaults to one Script Property.** `initTravelSystemConfig` would write `ASD.Travel-Events@gsa.gov`; `initEmailConfigDefaults` writes `aastravel@gsa.gov`. Both idempotent, both target `travel_email_address` — whichever ran first decided the production sender | C1/R2 | TRIP | **new** (§6.5) | D5 §5.4.4 |
| 69 | **G-060** | `DRAFT` status is vestigial — never written; drafts live only in browser IndexedDB | C1/R1 | TRIP | open | R-A5 |
| 70 | **G-061** | An FO is listed against a set-aside it is not charged for; shares still sum correctly | C1/R1 | LETS | open | R-B1 |
| 71 | **G-062** | `isDeficit` is `false` when the balance is exactly $0, so a fully exhausted budget raises no flag | C1/R1 | LETS | open | R-B10 |

### Informational — 1 finding

*noted, no action implied*

| Rank | ID | Finding | C/R | Owner | Status | Pass ID |
|---|---|---|---|---|---|---|
| 72 | **G-066** | No simple triggers exist at all, so there is no spreadsheet custom menu — contrary to convention | C1/R1 | TRIP | open | R-7 |

### Constructive — 2 findings

*assets, not defects — lead with these*

| Rank | ID | Finding | C/R | Owner | Status | Pass ID |
|---|---|---|---|---|---|---|
| 73 | **G-067** | **`requireRequestViewer` and `requireRequestEditor` are complete, correct, and never called.** Together they close G-003 and G-004 at roughly one line per call site | — | TRIP | **BLOCKED ON BD-3** | S-7 |
| 74 | **G-068** | An unknown `owningOffice` fails closed — no crash, no silent pass | — | LETS | open | R-B6 |

---

## §6.4 Where the evidence for each finding lives

Every finding resolves to a measurement script, a deliverable section, or both. **Nothing in this register rests on assertion alone.**

| Finding group | Evidence |
|---|---|
| G-001, G-002, G-003, G-004, G-005, G-030, G-067 | `pass5_guard_census.js`, `pass6_write_surface_census.js` — the guard census and the write surface |
| G-011, G-015, G-017, G-025, G-026 | `pass6_client_call_census.js`, `pass6_component_map.js` — the RPC census and the include graph |
| G-006, G-020, G-021, G-048, G-064, G-065, G-072, G-073 | `pass6_deployment_census.js` — manifest, clasp targets, Script Properties, CI guards |
| G-012, G-013, G-014, G-040, G-041, G-042, G-044, G-045, G-057, G-058, G-059 | `pass6_schema_census.js` — schemas, the alignment test, key generators |
| G-016, G-043 | `pass6_component_map.js` §[5] — the two-way reachability test |
| G-018, G-019, G-029, G-031, G-032, G-038, G-049, G-054, G-055, G-069, G-070, G-071 | `pass6_rule_census.js` — the state machine, reachability, the fail-open test |
| G-035, G-036, G-037, G-050, G-051, G-052, G-053, G-061, G-062, G-068 | `pass4_budget_engine_*.js`, `pass4_request_service_edge_cases.js` — observed by execution |
| G-034, G-056 | `pass6_manifest_recount.js` §[9a], `pass5_guard_census.js` |
| **G-008, G-074** | **`pass6_hc_gate_predicate.js`** — the site gate's two HC field tests, executed against every input class |
| G-007, G-009, G-010, G-022, G-023, G-024, G-027, G-028, G-033, G-039, G-046, G-047, G-060, G-063, G-066 | Located in source and cited in the deliverable that covers them |

**Reproduce all of it:**

```sh
cd docs/evidence && for f in *.js; do echo "== $f"; node "$f"; done
```

---

## §6.5 The six findings added since Pass 6

**Five were discovered while writing Deliverables 1–5; the sixth came out of re-checking a claim while writing Deliverable 10.** They are numbered `G-069`…`G-074` — **appended, never inserted** — so no existing ID moved.

### G-069 — the client-paid override fails open · High · C3/R4 · TRIP

**What it is.** On `oso_approve`, the handler re-reads traveller rows and, if no traveller is overhead-funded, rewrites the outcome to `APPROVED_GOGOV` — **skipping FAS Front Office review entirely** `[VERIFIED]` `Review_Action.js:125-145`. So one predicate decides whether a request receives the review Executive Order 14222 requires.

**The defect.** The predicate's guard clause returns `false` — meaning *no overhead*, meaning *skip FAS* — for three degraded inputs `[VERIFIED]`:

| Input | Result |
|---|---|
| No traveller rows at all | **skips FAS** |
| `rows` is null | **skips FAS** |
| `Is_Client_Paid` column missing | **skips FAS** |

**Why it is High and not Medium.** The two trigger conditions are **existing findings**, not hypotheticals: **G-012** (partial submission leaves a request with no traveller rows) and **G-014** (a renamed or reordered column). A request hit by either is approved without its compliance review.

**The asymmetry worth noting.** The *per-row* default on the same line — `!val` treats a blank cell as overhead — fails **closed** and is correct. The *collection-level* guard fails **open**. Same function, two lines apart, opposite defaults.

**A mitigation already exists and deserves credit.** Both degraded conditions are detected and logged as `CRITICAL` by the caller before the predicate runs `[VERIFIED]` `Review_Action.js:131, :136`. **The condition is recorded. It is not prevented** — execution continues and the request is approved. Changing `return false` to a thrown error closes it.

**Evidence:** `pass6_rule_census.js` §[4], which verifies its copy of the predicate matches the source character-for-character before executing it. **Detail:** `WORKFLOW_AND_BUSINESS_RULES.md` §4.3.5.

### G-070 — `SUBMITTER_CANCELLED` is read but never written · Low · C2/R2 · TRIP

`STATUS_CODES.SUBMITTER_CANCELLED` is declared, and `Reporting.js` tests for it in **three** places `[VERIFIED]`. But `submitter_cancel` writes `CANCELLED`, so **those three branches are unreachable.**

**The consequence is a reporting gap, not dead code.** Reports grouping by status **cannot distinguish a submitter cancellation from a reviewer cancellation** — while the code looks as though it handles the distinction. The distinction does exist in `ACTION_TYPES.SUBMITTER_CANCELLED` and in the `Approval_Log`, just not in the status column reports group by.

**Evidence:** `pass6_rule_census.js` §[2]. **Detail:** `WORKFLOW_AND_BUSINESS_RULES.md` §4.3.3.

### G-071 — DD confirmation self-confirms on a double blank · Low · C3/R3 · TRIP

Division Director confirmation authorizes by comparing `ddEmail === currentUserEmail` after lower-casing both `[VERIFIED]` `Review_DDConfirm.js:330`. Executed across input classes, every case is correct **except one**: if a traveller row's `DD_Email` is blank **and** the session email is blank, `'' === ''` succeeds and the row confirms.

**Whether it is reachable is `[UNKNOWN]`.** `Review_DDConfirm.js:292` calls `.getEmail().toLowerCase()` with **no `|| ''` fallback**, while **13 other call sites in the codebase do guard against a blank email** `[VERIFIED]`. So the codebase elsewhere treats a blank session email as possible and here does not.

**Worth one line of defence rather than an investigation** — `if (!currentUserEmail || !ddEmail) continue;` closes it regardless.

**Detail:** `WORKFLOW_AND_BUSINESS_RULES.md` §4.4.2.

### G-072 — the CI hardcoded-ID guard missed three identifier types · Low · C1/R2 · LETS · **REMEDIATED 2026-10-29**

A CI guard rejects hardcoded spreadsheet and script IDs in `server/`, using a 40-character floor. **Its own comment stated the reasoning:** *"Sheets IDs are 44 chars and Apps Script IDs are 57; the 40-char floor catches both."* `[VERIFIED]`

**Both correct. But Google has five identifier types:**

| Type | Length | Starts | Old guard | Now |
|---|---|---|---|---|
| Apps Script project | 57 | `1` | yes | yes |
| Spreadsheet | 44 | `1` | yes | yes |
| **Drive folder** | **32** | `1` | **no** | yes |
| **Drive file** | **33** | `1` | **no** | yes |
| **Web-app deployment** | **72** | **`AKfycb`** | **no** | yes |

**Two uncaught literals were in the tree** `[VERIFIED]` — `Database.js:28` (which is **G-065**) and `TripConfig.js:154`. **So the guard passed while the exact defect class it exists to prevent was present in the code it scans.**

**The fifth type is the instructive one, and it was invisible until 2026-10-29**, when two web-app deployment IDs were stored as GitHub repository variables. **A 72-character identifier passed a 40-character floor** — because the pattern was anchored on a leading `1` and deployment IDs begin with `A`. **No lowering of the floor would ever have caught them** `[VERIFIED]` by execution. The guard's reasoning — *"what is the shortest identifier I must catch?"* — was sound and produced a blind spot, because the real question was *"what shapes do these identifiers take?"* **A length test cannot answer a prefix question.**

**Remediation, applied and verified** `[VERIFIED]`:

| | |
|---|---|
| **Pattern** | Two patterns, not one: floor lowered `{39,}` → `{29,}` for the `1`-prefixed types, plus a separate `AKfycb` pattern |
| **Coverage** | All **five** types caught; **five** near-miss inputs (a 28-char string, an unquoted ID in prose, a sentence, a base64 blob, a semver string) stay quiet |
| **Pre-existing literals** | **Tracked exceptions scoped to file *and* symbol**, each naming its finding. A **new** ID in either file still fails the build — verified against that case |
| **The checking script** | `pass6_deployment_census.js` §[4] held its **own copy** of the pattern, so it would have reported the old coverage after the guard changed. **It now reads the pattern out of `verify.yml`** and reports a problem if extraction fails, rather than falling back to a default |

**Rated Low and left at Low.** The rating describes the defect's consequence, not the effort to fix it, and **the entry is kept rather than deleted** per the convention that findings record history. **It is worth more as a record than it ever was as a defect**: it is the clearest example in this register of a control that passes while being wrong, and of a validator inheriting the same flaw as the thing it validates.

**This is not a criticism of the guard's author.** The comment stated the reasoning transparently, which is exactly why the gap was findable. A guard using a bare magic number would have hidden it. **The general lesson — test a guard against what it should reject, not only against a clean tree** — is built into `pass6_deployment_census.js` §[4].

**Detail:** `DEPLOYMENT_AND_ENVIRONMENTS.md` §5.3.3.

### G-073 — two initializers write conflicting defaults to one property · Low · C1/R2 · TRIP

Two setup functions set the email sender address, both idempotent — each writes only if the key is unset `[VERIFIED]`:

| Function | Default | Target key |
|---|---|---|
| `initTravelSystemConfig` `Database.js:446` | `ASD.Travel-Events@gsa.gov` | `travel_email_address` |
| `initEmailConfigDefaults` `Props.js:252` | **`aastravel@gsa.gov`** | `travel_email_address` |

**Whichever ran first decided the production sender address.**

**The cost is diagnostic rather than operational.** *"Why is mail coming from the wrong address?"* has no answer in the code, because the answer is *which setup function someone happened to run first, months ago.* **VT-19** records the live value; the fix is to delete the duplicate default.

**Detail:** `DEPLOYMENT_AND_ENVIRONMENTS.md` §5.4.4.

### G-074 — the site gate's occupancy check fails open on a blank field · Medium · C3/R2 · TRIP

**Found by writing `pass6_hc_gate_predicate.js`, which was written to check a *different* claim — one that turned out to be wrong (§6.6.1).**

**What it is.** Allow-path 2 of the site gate admits a user who holds a filled HC supervisor position. It tests two fields, two lines apart `[VERIFIED]` `Access.js:416-418`:

```javascript
if (String(p.supervisoryStatus) !== '2') continue;      // ALLOWLIST
var status = String(p.occupancyStatus || '').toUpperCase();
if (status === 'VACANT' || status === 'OBLIGATED') continue;   // DENYLIST
```

**The defect.** `occupancyStatus` is a **denylist**. Only `VACANT` and `OBLIGATED` are refused, so **everything else grants access** — and `|| ''` converts a missing field into the empty string, which matches neither. Executed `[VERIFIED]`:

| `occupancyStatus` emitted | Result |
|---|---|
| `''` empty string | **ALLOW** |
| `null` | **ALLOW** |
| field absent | **ALLOW** |
| `' VACANT '` padded | **ALLOW** — the denylist does not trim |
| `'ENCUMBERED'`, `'TERMINATED'` unknown codes | **ALLOW** |

**So a supervisor record with no occupancy data admits its holder**, as does any occupancy code the author did not anticipate, as does `VACANT` with a stray space.

**The asymmetry is the point.** The field above it is an **allowlist** and fails **closed** — an unrecognised `supervisoryStatus` denies. Two checks, two lines apart, failing in opposite directions. Neither default is obviously wrong in isolation; together they mean **the gate is stricter about a value it understands than about a value it does not.**

**Why C3/R2 and not higher.** It grants *site access* — passing the gate, not acquiring a role. A user admitted this way has no role row, so `getReviewerContext` resolves them to `role: 'none'` and the privileged consoles still refuse them. But site access is the precondition for the 412-function reachable surface (**G-001**), so it is not cosmetic. **R2** because it requires the HC bundle to contain a matching record for the caller — not something an arbitrary user controls.

**This also sharpens G-008 rather than duplicating it.** G-008 says the HC library controls two of three allow-paths and that LETS cannot see or audit that. G-074 says that *within* one of those paths, the test LETS does perform is weaker than it appears. Both paths share the same denylist — `_isBuLeadByTitle` repeats it verbatim at `Access.js:885` `[VERIFIED]`.

**The fix is an allowlist, and it needs VT-03 first.** Inverting the test — accept only occupancy values known to mean "filled" — cannot be written safely until the live values are recorded, because an incomplete allowlist would lock out real supervisors. **That is exactly what VT-03 now collects.**

**Evidence:** `pass6_hc_gate_predicate.js` §[2], which verifies its copy of the predicate against the source check-by-check before executing it. **Detail:** `ADMINISTRATOR_GUIDE.md` §1.7.2.

---

## §6.6 Two corrections to this register's own prose

### 6.6.1 A withdrawn claim about the site gate — VT-03's stated mechanism

**Four documents asserted a mechanism that does not exist. The task it justified survives; the reason given for it does not.**

| | |
|---|---|
| **The claim** | *"The site gate compares `supervisoryStatus === '2'` as a **string**; if HC emits a number, two of three allow-paths are already dead."* |
| **The source** | `if (String(p.supervisoryStatus) !== '2') continue;` `[VERIFIED]` `Access.js:416` |
| **Why it is false** | The explicit `String()` coercion means `String(2) === '2'`. **A numeric `2` passes.** All six sites across the server tree coerce the same way — there is no bare `===` against the raw field anywhere `[VERIFIED]` |
| **Why it is false twice** | *"Two of three allow-paths"* is also wrong: path 3 `_isBuLeadByTitle` `Access.js:864` never reads `supervisoryStatus` `[VERIFIED]`. A real type mismatch would disable **one** |

**What actually fails** `[VERIFIED]`: `'02'`, `' 2'`, `'2 '`, `'2.0'`, `'two'` — zero-padded, whitespace-bearing, decimal-formatted text. The gate neither trims nor normalises. **These are the shapes a spreadsheet export or a text-formatted column produces**, so VT-03 keeps its twenty minutes and must record the exact distinct values with padding intact.

**Corrected in place:** `ADMINISTRATOR_GUIDE.md` §1.7.2, and `GAP_CONSOLIDATION_PASS6.md` §6.7.2/§6.7.3 with the withdrawal recorded at §6.7.4. **Left as written:** `SECURITY_AND_ACCESS_PASS5.md` V-38 — a dated working note, per the convention that pass documents are a record and not edited retroactively.

> **The method note, and it is a new one.** Convention 7 says a script must back every structural claim. Five times (§6.11.2 and the working notes' §8.2) a *measurement* produced a confident wrong answer caught only because it contradicted established prose — which is where the standing rule *"suspect the measurement first"* comes from. **This is the first instance in the other direction: the prose was wrong and the measurement was right.** The two are indistinguishable until the predicate is executed. Reading a line of code is not the same as knowing what it does, and `pass6_hc_gate_predicate.js` §[4] now re-scans every deliverable for the withdrawn wording on each run.

### 6.6.2 One re-rating, and why

### G-048: Medium → High

**Pass 6 rated it C3/R2 Medium.** The finding: an undocumented third Apps Script project is wired to the repository root via an untracked `.clasp.json`.

**Deliverable 5 measured what that configuration would actually do** `[VERIFIED]` — `pass6_deployment_census.js` §[1]:

```json
{ "scriptId": "181ocqi16Ruz…", "rootDir": "", "skipSubdirectories": false }
```

`rootDir: ""` resolves to the **repository root**, and `skipSubdirectories: false` means recurse. **A `clasp push` from there carries 228 pushable files**, including **209 from three different applications**:

| Files | Tree |
|---|---|
| 111 | `lets_app/` — the real application |
| **94** | **`reference_travel_app/`** — the GSA/AAS TRIP application |
| **4** | **`reference_training_tracker/`** |
| 16 | `docs/` — evidence scripts; harmless, and the reason this total drifts upward |

**Why the consequence is C4 rather than C3.** All pushed `.js` files share one global scope `[VERIFIED]`. Pushing `lets_app/` and `reference_travel_app/` together puts **two complete copies of ~459 function names in one namespace**, where the later-loading definition silently wins. The result is not untidy; it is **unpredictable** — and it would be running under whatever credentials that project holds, against whatever spreadsheet it is bound to.

It also **pushes another organisation's application code** into a project nobody has documented.

**Reachability stays R2** — it requires project access and a `clasp push` from the wrong directory. **C4/R2 is High.**

> **The register records this change rather than making it silently.** A rating that moves without a visible reason is indistinguishable from an error, and this is the one document where that distinction matters most.
>
> **VT-21 resolves it** in twenty minutes. Until then: **never run `clasp push` from the repository root.**

---

## §6.7 The twenty-two latent findings

**Twenty-two findings carry reachability `R1` — nothing can currently trigger them** `[VERIFIED]`. They fall into two groups, and the distinction matters for scheduling.

### 6.7.1 Seventeen in the unreachable LETS subsystem

G-013, G-016, G-023, G-024, G-035, G-036, G-037, G-038, G-039, G-040, G-043, G-050, G-051, G-052, G-053, G-061, G-062

All four LETS-original modules expose **zero** top-level functions and have **zero** inbound references `[VERIFIED]` — `pass6_component_map.js` §[5]. Apps Script exposes only top-level functions to the browser, so **no browser can call in and no server code calls in.**

> **These seventeen are the cheapest fixes in the register, and that is the single most useful scheduling fact here.** There is no production data in the budget tabs, no user depending on current behaviour, and no migration. **They should be fixed *before* the subsystem is wired, not after** — wiring first means debugging a financial engine against live data, and wiring activates all seventeen simultaneously.

### 6.7.2 Five latent for other reasons

| Finding | Why it is R1 |
|---|---|
| **G-030** | `requireRole()` silently grants on an unrecognized role name — but **no current role name is unrecognized**, so the branch is not reachable today. It becomes live the moment a new role is added |
| **G-034** | No CDN subresource integrity. Exploiting it requires compromising jsDelivr or cdnjs — not a LETS-specific risk, hence R1 |
| **G-047** | The brief's "Stage 1 persistence schema" exists nowhere. An absence cannot be triggered |
| **G-060** | `DRAFT` status is vestigial — never written by any code path |
| **G-066** | No simple triggers exist, so there is no spreadsheet custom menu. An absence |

**G-030 is the one to watch.** It is rated C4 — `requireRole()` is described in its own file as *"the canonical guard for any future RPC"* `[VERIFIED]` — and it is latent only because no unrecognized role name currently exists. **Adding a role without adding its branch would make a C4 defect live.** That belongs in the enhancement playbook as a precondition, not in the backlog.

---

## §6.8 The seven BLOCKED findings

**These cannot be closed by engineering effort.** Each waits on a decision only the business owner can make.

| Finding | Rank | Blocked on | The decision |
|---|---|---|---|
| **G-003** | 5 | **BD-3** | In a `NEEDS_INFO_*` state, should the assigned reviewer retain edit access? `requireRequestEditor` would remove it |
| **G-067** | 73 | **BD-3** | Same decision. **This is the constructive finding** — adopting the two unused guards |
| **G-013** | 20 | **BD-5** | Who owns the `Requests` tab-name collision decision, and what is it? |
| **G-023** | 21 | **BD-5** | Same decision — the FAS substring match cannot be fixed until the schema question settles |
| **G-018** | 17 | **BD-6** | Is FO-reviewer self-approval on client-paid travel intended policy? |
| **G-055** | 50 | **BD-6** | Should tier thresholds be computed from cost rather than self-declared? |
| **G-031** | 30 | **BD-2** | Should `aas_fo_reviewer` see every request in the organisation? |

### 6.8.1 The BD-3 pair is the most consequential

**G-003 is rank 5 — a Critical finding — and its cheapest fix is G-067, which is also blocked on the same decision.** `requireRequestViewer` and `requireRequestEditor` are complete, correct, and called from nowhere `[VERIFIED]`. Together they close G-003 and G-004 at roughly one line per call site.

**So a single business decision unblocks the cheapest available fix for two of the six Critical findings.** If one decision gets priority, it is BD-3.

### 6.8.2 The two decisions that block nothing, and still matter

**All six decisions are defined in `WORKFLOW_AND_BUSINESS_RULES.md` §4.9**, with the reasoning for why each needs an owner rather than an engineer. Two of the six do not appear in the BLOCKED table above, and the reason differs:

| Decision | Blocks no single finding, but |
|---|---|
| **BD-1** — is the deployment meant to run as `USER_ACCESSING` or `USER_DEPLOYING`? | **It conditions the severity of all six Criticals** (§6.1.4). Every rating in this register is on the manifest's declared value, so BD-1 plus **VT-01** decide whether five findings carry the amplifier |
| **BD-4** — which cost figure is authoritative, System A's `Grand_Total` or a user-entered estimate? | **It is the precondition for the whole budget-integration effort.** It does not block a specific finding because it blocks the *design* that G-035, G-036 and G-040 all assume. Fixing them without answering it would hard-code one of two incompatible answers |

**BD-4 is the one most likely to be skipped**, because no row in the register says `BLOCKED ON BD-4`. It is the largest unresolved design question in the system.

---

## §6.9 The two constructive findings

**Lead with these.** A register that lists only defects misrepresents the system and gets dismissed.

| ID | Rank | Finding |
|---|---|---|
| **G-067** | 73 | **`requireRequestViewer` and `requireRequestEditor` are complete, correct, and never called** — zero call sites `[VERIFIED]`. Together they close G-003 and G-004 at roughly one line per call site. **The highest-value item in the entire assessment** |
| **G-068** | 74 | An unknown `owningOffice` fails closed — no crash, no silent pass `[VERIFIED]` by execution |

**And fifteen verified strengths sit behind the register rather than in it.** No credential handling anywhere; **no hardcoded back door** in any authorization path; every role detector failing closed; a correct 12-action state machine on the approval decisions themselves; the exemplary FAS environment gate; and a CI/CD pipeline whose controls each document their own reasoning. Full list: Pass 5 §5.11; the pipeline assessment is `DEPLOYMENT_AND_ENVIRONMENTS.md` §5.3.

> **The honest framing, and it belongs in any summary built on this register.** LETS did not introduce these gaps — **all six Critical findings are byte-identical inherited TRIP code** `[VERIFIED]`. It adopted a working application as directed. What it did not do is review what it was adopting: 84% of the code was accepted unexamined, and the one inherited weakness LETS reproduced *by choice* — CDN loading with no integrity checking — appears in **new** pages (**G-034**).
>
> **That is a process gap, not a competence gap.** The LETS-original security work is good.

---

## §6.10 How to work this register

### 6.10.1 Before remediation starts

| Order | Action | Why first |
|---|---|---|
| 1 | **VT-01** — the deployment's "Execute as" | Conditions the severity of all six Criticals (§6.1.4). Two minutes |
| 2 | **VT-04** — has `bootstrapTravelAdmin` been called? | **Must precede any fix to G-002** — remediation destroys the evidence |
| 3 | **Answer BD-3** | Unblocks G-067, the cheapest fix for two Criticals (§6.8.1) |
| 4 | **VT-07** — the live tab list | Confirms or refutes the latency of seventeen findings (§6.7.1) |
| 5 | **Fix G-022** | A wording change. The system currently makes a false compliance claim to users |

### 6.10.2 Sequencing constraints that are not obvious from rank

| Constraint | Why |
|---|---|
| **VT-04 before G-002** | Remediation destroys the evidence of whether it was exercised |
| **The seventeen latent findings before wiring the subsystem** | Wiring activates all of them at once, against live data (§6.7.1) |
| **G-030 before adding any new role** | Adding a role without its branch makes a C4 defect live (§6.7.2) |
| **VT-15 before G-023** | Fixing a substring match against guessed status strings is worse than leaving it |
| **BD-5 before G-013 and G-023** | Both reduce to the same schema-ownership decision |
| **Never rename the five trigger handlers** | They are referenced by string name; the schedule survives and the work stops silently |

### 6.10.3 Maintaining the register

1. **Never renumber.** Append new findings; retire withdrawn ones with a tombstone row.
2. **Re-rate in the `Rank` column and record why**, as §6.6 does. A silent rating change is indistinguishable from an error.
3. **Re-run the structural check** after any edit: `node docs/evidence/pass6_register_check.js`. It validates ID continuity, block counts, cross-document citations in both directions, continuity with Pass 6, and that every `BLOCKED` row names a real decision.
4. **Keep BLOCKED visible.** A blocked finding in a remediation plan looks like work and is not.

---

## §6.11 Cross-reference — every pass ID to its canonical finding

**The key to every citation in the six pass documents.** All 75 pass IDs issued by Passes 1–5 resolve; `pass6_register_check.js` §[7] verifies none is unaccounted for.

| Pass ID | Pass | Canonical | Rank | Note |
|---|---|---|---|---|
| M-1 | 1 | **G-047** | 55 |  |
| M-2 | 1 | → **G-013** | 20 | merged into G-013 |
| M-3 | 1 | **G-015** | 22 |  |
| M-4 | 1 | → **G-017** | 23 | merged into G-017 |
| M-5 | 1 | **G-048** | 10 |  |
| R-1 | 2 | **G-017** | 23 |  |
| R-2 | 2 | → **G-011** | 12 | **split**: mockup → G-025, missing gate → G-011 |
| R-3 | 2 | **G-024** | 52 |  |
| R-4 | 2 | **G-001** | 1 | **dissolved** into G-001 + G-002 |
| R-5 | 2 | → **G-015** | 22 | merged into G-015 |
| R-6 | 2 | → **G-008** | 8 | merged into G-008 |
| R-7 | 2 | **G-066** | 72 |  |
| R-8 | 2 | **G-026** | 28 |  |
| R-9 | 2 | **G-021** | 9 |  |
| D-1 | 3 | **G-041** | 44 |  |
| D-2 | 3 | **G-057** | 62 |  |
| D-3 | 3 | **G-042** | 45 |  |
| D-4 | 3 | **G-012** | 13 |  |
| D-5 | 3 | **G-058** | 63 |  |
| D-6 | 3 | **G-013** | 20 |  |
| D-7 | 3 | **G-040** | 37 |  |
| D-8 | 3 | **G-043** | 54 |  |
| D-9 | 3 | **G-044** | 40 |  |
| D-10 | 3 | **G-014** | 16 |  |
| D-11 | 3 | **G-045** | 46 |  |
| D-12 | 3 | **G-046** | 47 |  |
| D-13 | 3 | **G-059** | 64 |  |
| D-14 | 3 | **G-023** | 21 |  |
| R-A1 | 4 | **G-018** | 17 |  |
| R-A2 | 4 | **G-019** | 18 |  |
| R-A3 | 4 | **G-020** | 19 |  |
| R-A4 | 4 | **G-049** | 48 |  |
| R-A5 | 4 | **G-060** | 69 |  |
| R-B1 | 4 | **G-061** | 70 |  |
| R-B2 | 4 | **G-035** | 33 |  |
| R-B3 | 4 | **G-036** | 34 |  |
| R-B4 | 4 | **G-050** | 38 |  |
| R-B5 | 4 | **G-037** | 35 |  |
| R-B6 | 4 | **G-068** | 74 |  |
| R-B7 | 4 | **G-051** | 56 |  |
| R-B8 | 4 | **G-052** | 57 |  |
| R-B9 | 4 | **G-053** | 58 |  |
| R-B10 | 4 | **G-062** | 71 |  |
| R-B11 | 4 | **G-038** | 36 |  |
| R-B12 | 4 | **G-039** | 53 |  |
| R-C1 | 4 | **G-054** | 49 |  |
| R-C2 | 4 | → **G-023** | 21 | merged into G-023 |
| R-C3 | 4 | **G-055** | 50 |  |
| R-C4 | 4 | **G-022** | 24 |  |
| R-D1 | 4 | **G-065** | 66 |  |
| S-1 | 5 | **G-002** | 2 |  |
| S-2 | 5 | **G-004** | 3 |  |
| S-3 | 5 | **G-005** | 6 |  |
| S-4 | 5 | **G-003** | 5 |  |
| S-5 | 5 | **G-027** | 29 |  |
| S-6 | 5 | **G-028** | 41 |  |
| S-7 | 5 | **G-067** | 73 |  |
| S-8 | 5 | **G-007** | 7 |  |
| S-9 | 5 | **G-029** | 42 |  |
| S-10 | 5 | **G-030** | 26 |  |
| S-11 | 5 | **G-031** | 30 |  |
| S-12 | 5 | **G-008** | 8 |  |
| S-13 | 5 | **G-006** | 4 |  |
| S-14 | 5 | **G-032** | 31 |  |
| S-15 | 5 | **G-009** | 15 |  |
| S-16 | 5 | → **G-004** | 3 | merged into G-004 |
| S-17 | 5 | → **G-003** | 5 | merged into G-003 |
| S-18 | 5 | **G-033** | 43 |  |
| S-19 | 5 | → **G-001** | 1 | folded into G-001 as evidence |
| S-20 | 5 | **G-011** | 12 |  |
| S-21 | 5 | **G-063** | 61 |  |
| S-22 | 5 | **G-064** | 65 |  |
| S-23 | 5 | **G-056** | 51 |  |
| S-24 | 5 | **G-034** | 27 |  |
| S-25 | 5 | **G-010** | 11 |  |

### 6.11.1 Three merges worth understanding

| Pass ID | What happened |
|---|---|
| **R-4** | **Dissolved**, not merged. It carried three findings of three severities under one ID — *"412 functions client-callable; 64 unguarded write-capable; `bootstrapTravelAdmin` allows self-grant"*. A compound ID cannot be closed, because there is no definition of done. It became G-001 and G-002 |
| **R-2** | **Split.** Its "static mockup" content became G-025; its "no admin gate" content merged into G-011. Pass 2 wrote them as one bullet; they have different fixes and different owners |
| **S-19** | **Folded in as evidence**, not kept as a defect. The leading-underscore naming is not an independent finding — it is the *reason* the reachable surface is larger than it appears. It is part of G-001 |

### 6.11.2 One withdrawn figure, recorded so it is not re-cited

Pass 2 §2.2.3 published **"64 unguarded write-capable functions"**. It is neither of the two defensible readings `[VERIFIED]`:

| Reading | Count |
|---|---|
| Writes in its own body, no authorization check | **51** |
| Including bounded transitive reach | **72** |

**Use 51 with its scope.** Never 64. Three further withdrawn figures are listed in `GAP_CONSOLIDATION_PASS6.md` §6.9.1.

---

## §6.12 Where to go next

| You want | Read |
|---|---|
| Who controls the system and how to administer it | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) |
| Which file holds which finding | [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) |
| The columns a data finding refers to | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) |
| The rule behind a workflow finding | [`WORKFLOW_AND_BUSINESS_RULES.md`](./WORKFLOW_AND_BUSINESS_RULES.md) |
| The deployment and configuration findings in context | [`DEPLOYMENT_AND_ENVIRONMENTS.md`](./DEPLOYMENT_AND_ENVIRONMENTS.md) |
| **How to actually fix these, in order, without breaking something** | `ENHANCEMENT_PLAYBOOK.md` (Deliverable 7) |
| An honest current-state summary for leadership | `SYSTEM_STATE.md` (Deliverable 8) |
| The verification tasks, with locations and costs | [`HUMAN_VERIFICATION_CHECKLIST.md`](./HUMAN_VERIFICATION_CHECKLIST.md) (Deliverable 10) |
| How the first 68 findings were consolidated from 75 pass IDs | [`GAP_CONSOLIDATION_PASS6.md`](./GAP_CONSOLIDATION_PASS6.md) |

### Validating this register

```sh
cd docs/evidence && node pass6_register_check.js
```

Eight structural invariants: ID continuity, no duplicates, block counts matching their rows, bidirectional citation consistency with Deliverables 1–5, continuity with Pass 6 (nothing dropped, additions appended not inserted), every `BLOCKED` row naming a real decision, every pass ID accounted for, and the rank-versus-ID separation.

> **That check already earned its place.** Run against Deliverables 1–5 before this register was drafted, it found **three mis-numbered citations** — `G-055` cited for the `File_Queue` phantom (which is **G-057**), `G-056` for the `Log_ID` formats (**G-058**), and `G-057` for `Edit_SharedCosts` (**G-059**). All three were off by two in the same direction, the signature of reading a register row and miscounting. All three are corrected.

---

*End of Deliverable 6. 74 findings, each with a permanent ID, a rank derived from a stated rubric, a mechanically-derived owner, and a pointer to the script or section that evidences it. Seven are blocked on decisions rather than engineering, twenty-two cannot currently be triggered, and the two most valuable entries are the ones describing fixes that already exist.*
