# RESUME HERE — LETS

**Stopped:** 2026-10-30, at a clean stopping point.
**Resume at:** §0 below.
**To restart:** open this repository and say *"Resume LETS — read docs/_RESUME_HERE.md §0."*

**In one sentence:** the City-dropdown fix, its documentation, and a GSA/CONUS
per-diem setup runbook are all **complete and verified in the working tree, and
nothing is committed** — the only open work is **pushing it and running the deploy
steps in §0.2**, which needs the user.

Two separate efforts are recorded in this file. **Both are now finished.** The
documentation effort produced ten deliverables (§8). The code change and its
documentation are described in §0 and are what remains to be *deployed*.

---

## §0 WHAT TO DO FIRST — read this before anything else

### Nothing is broken, nothing is committed, and no analysis work is outstanding.

**A code fix plus its full documentation are written, verified, and NOT YET PUSHED.**
The fix repairs the City dropdown on New Request → Itinerary and closes two Critical
security findings found alongside it. **The user intends to push and deploy it.**

**There is no documentation task left.** Three tasks were completed on 2026-10-30:

| | |
|---|---|
| **Register the new findings** | `G-076`…`G-079` registered; eight deliverables updated |
| **G-079 — annotate the 30 departing rows** | Done, by the user's decision. Each carries a **†**; reasons at `GAP_REGISTER.md` §6.6.4a |
| **Write a per-diem setup runbook** | `PER_DIEM_SETUP_GUIDE.md` (root), GSA/CONUS only, by the user's scoping decision |

**Six findings now exist that did not on 2026-10-28** — `G-076`…`G-081`. **Two of
them, `G-080` and `G-081`, were found by writing that runbook** and are open.
**All 19 validators and all 3 project suites pass.**

> **If the user asks "what's next?", the answer is §0.2 — deployment — and it is
> theirs to run, not yours.** Do not re-do §0.3; it is done.

---

## §0.1 What is in the working tree right now

`git status` on branch **`setup/lets-local-development`**:

```
 M .github/workflows/verify.yml                      <- MINE (earlier CI-guard work)
 M lets_app/client/controllers/form/travelRequestItinerary.html   <- MINE
 M lets_app/client/shared/travelLocationService.html              <- MINE
 M lets_app/client/styles/travelRequestStyles.html                <- MINE
 M lets_app/server/30_services/PerDiemForeign.js                  <- MINE
 M lets_app/server/30_services/PerDiemGSA.js                      <- MINE
 M lets_app/server/99_triggers/CacheWarming.js                    <- MINE
?? DEPLOYMENT_GUIDE_CITY_DROPDOWN_FIX.md             <- MINE (root, 469 lines)
?? PER_DIEM_SETUP_GUIDE.md                           <- MINE (root, GSA/CONUS runbook)
?? docs/                                             <- MINE (10 deliverables + 19 scripts)

 M .githooks/install.sh        <- NOT MINE, pre-existing, mode-only (100644 -> 100755)
 M .githooks/pre-push          <- NOT MINE, pre-existing, mode-only
?? .clasp.json                 <- NOT MINE. THIS IS FINDING G-048
?? .claspignore                <- NOT MINE
?? Code.gs                     <- NOT MINE
?? appsscript.json             <- NOT MINE
?? clipboard_content.txt       <- NOT MINE
```

**+575 / −89 across 7 tracked files**, plus the untracked `docs/` tree and the
deployment guide. Nothing has been committed, per the standing rule that commits
happen only when the user asks.

> **When staging, include ONLY these paths:**
> ```
> lets_app/server/30_services/PerDiemGSA.js
> lets_app/server/30_services/PerDiemForeign.js
> lets_app/server/99_triggers/CacheWarming.js
> lets_app/client/shared/travelLocationService.html
> lets_app/client/controllers/form/travelRequestItinerary.html
> lets_app/client/styles/travelRequestStyles.html
> .github/workflows/verify.yml
> docs/
> DEPLOYMENT_GUIDE_CITY_DROPDOWN_FIX.md
> PER_DIEM_SETUP_GUIDE.md
> ```
>
> **Never stage the five untracked root files.** The root `.clasp.json` has
> `rootDir: ""`, so a `clasp push` from the repository root carries **229
> files** — including a full copy of the GSA/AAS TRIP application — into an
> undocumented Apps Script project. That is **G-048**. The `.githooks/`
> entries are mode-only and predate this work.

---

## §0.2 THE ONLY OPEN WORK — deployment, and it is the user's to run

**`DEPLOYMENT_GUIDE_CITY_DROPDOWN_FIX.md`** (repository root, 469 lines) is a
step-by-step for a non-coder, written at the user's request. 10 steps, a tick-off
checklist, troubleshooting, and a rollback procedure. **Follow it rather than
improvising.** Its own key facts:

| | |
|---|---|
| **Merging to `main` IS deploying** | There is no separate button. `DEPLOYMENT_AND_ENVIRONMENTS.md` §5.2.1 — and whether a merge reaches *users* is still **VT-01**, unanswered |
| **`clearGSACitiesCache()` is MANDATORY after deploy** | The cached payload changed shape. **It is in `PerDiemGSA.gs`, not `CacheWarming.gs`** — the Apps Script Run dropdown only lists functions from the open file. If skipped: no rate hints for 24 h, **no error anywhere**. `DATA_DICTIONARY.md` §3.10.1 |
| **Set `GSA_PERDIEM_API_KEY` by hand first** | Project Settings → Script Properties. **Do not run `_setupGSAPerDiemProperties` expecting it to set the key** — it never writes the key, by design, since the G-076 fix |
| **Step 2 warns before Step 3 sets the key** | Deliberate ordering: the dangerous version of `_setupGSAPerDiemProperties` is live until this change deploys |

**Nobody has clicked the dropdown in a real browser.** The logic was executed
directly against stubs, not through a rendered page. **Step 10 of the guide is the
first real test** and the guide says so twice.

---

## §0.2a The per-diem runbook, and the two findings writing it produced

**`PER_DIEM_SETUP_GUIDE.md`** (repository root) is a step-by-step for a non-coder
covering **GSA/CONUS per diem only** — the user scoped it that way deliberately.
DoD (AK, HI, PR, VI, GU, AS, MP) and DOS (foreign) each need their own syncs and
tabs; **CONUS works without them.**

**8 steps, each with its own `✅ Verification` block, plus a handover record to fill in.**

> **The two most important things in it are warnings, not instructions.**
>
> | | |
> |---|---|
> | **`warmGSACitiesCache` returns `success: true` even when all 49 locations fail** `[VERIFIED]` `CacheWarming.js:176`. The only signal is the `N ok / N failed` log line | The guide says *"read the line, not the tick"* in bold, twice |
> | **`_testGSAPerDiemAPI` reports `✓ SUCCESS!` on a fiscal year the dropdown never asks for** — this is **G-081** | Step 6 exists solely to tell the operator not to trust it, and names `_diagnoseGSACitiesWarmer` as the sound check instead |

### Two new findings, both from tracing the feature

| ID | Finding | Rating | Status |
|---|---|---|---|
| **G-080** | **OCONUS legs re-priced by a reviewer's edit are sent to the GSA API**, which excludes AK/HI by design. The lookup fails, **the stale rate is kept**, nights are recomputed against it, **and nothing errors.** The intake form is unaffected | **Medium** C3/R2 | **open** |
| **G-081** | **The GSA smoke test passes on a fiscal year the dropdown never requests.** `[2025, 2026]` hardcoded; the dropdown computes 2027 | Low C1/R2 | **open** |

**Evidence scripts added:** `verify_oconus_routing.js` and `verify_gsa_fiscal_year.js`.
**Both are defect detectors, not reconcilers** — they report `integrity problems: 0`
(which must stay 0) alongside `misrouted paths: 2` and `coverage gap: 1`, **which are
the open defects and are the correct output until fixed.**

> **G-080 is the one worth escalating.** It is a **silent wrong financial figure** in a
> reimbursement calculation, and the fix is one line: derive the routing key instead of
> requiring three callers to pass it. **`isOCONUSLocation` at `Locations.js:29` already
> implements the test and the dispatcher does not call it** — the same shape as G-067.
> `ENHANCEMENT_PLAYBOOK.md` §7.11.3.

### Why these were not found by any of the 19 scripts

**Neither is a bug in any single function.** G-080 is a mismatch between what one
function *requires* and what three callers *provide*; G-081 is a mismatch between two
fiscal-year sources. **The censuses measure the codebase in aggregate — none of them
traces one feature from the client click to the external API.** That is now recorded at
`GAP_REGISTER.md` §6.5 as a third discovery mode, and it is the cheapest of the three:
no new tooling, no live access, just following a chain nobody had followed.

---

## §0.3 The code change — what it does and why

**The user reported:** on New Request → Itinerary, the **City** field was supposed to
behave like **State** — a dropdown of cities with their per-diem rates — and did not
work. **Three real breaks were found by tracing the chain in source.** This is now
finding **G-078**, documented at `SYSTEM_COMPONENT_MAP.md` §2.4.6.

| | The break | Fix |
|---|---|---|
| **1** | **The actual bug.** The city list loads only from the State field's `onSelect`, which fires **only on a dropdown click**. A user who TYPED `VA` and pressed Tab got a state that looked right, was never saved to form state, and never triggered the city load | `setupStateAutocomplete` now commits on blur, guarded against double-fire. Fixed in the **shared service**, so the review page benefits too |
| **2** | City had **no initializer**. So a **restored draft** had city text and no dropdown | New `Controller._initLegCityAutocomplete`, called from `_populateLegInputs` |
| **3** | `travelLocationService` called `getAllForeignCountries()` — **a function that existed nowhere**, including in TRIP. Silent failure inside `withFailureHandler`, so the **Country** dropdown was empty on any first visit | Defined `getAllForeignCountries` in `PerDiemForeign.js` as a bare-array wrapper |

**The rates are now retained instead of discarded, at zero additional API cost.**
`getGSACitiesForState` already received M&IE and twelve monthly lodging values per
locality and **kept only `rate.city`**. The dropdown now renders
`Richmond · $107-131 lodging · $68 M&IE`. **Two deliberate choices that must survive
any future edit:** lodging shows as a **range** (it varies by month), and the hint is
**display-only** — the authoritative figure still comes from `calculatePerDiem` →
`getPerDiemForLeg`, untouched. `ENHANCEMENT_PLAYBOOK.md` §7.11 has what remains
available and why it needs **BD-4** first.

**Two Critical security findings were found while working in these files:**

| Finding | Was | Now |
|---|---|---|
| **G-077** `_viewScriptProperties` | **Returned every Script Property — the GSA key, `TRAVEL_DB_SPREADSHEET_ID`, the Drive IDs — to any caller.** One-call secret exfiltration | `requireTravelAdmin()` + name-based redaction |
| **G-076** `_setupGSAPerDiemProperties` | **Wrote `'YOUR_API_KEY_HERE'` over the live API key, unconditionally, from any browser.** Also reset both mileage rates | `requireTravelAdmin()`, conditional writes, **never touches the key** |

**Also fixed:** `_testGSAPerDiemAPI` called `testRawAPIResponse()` while the function
is declared `_testRawAPIResponse` — **a `ReferenceError` on the failure path only**,
so the diagnostic died exactly when the API was misbehaving. Folded into G-076 as
evidence rather than given its own ID.

> **The user obtained a real GSA API key and was told to set it by hand** as
> `GSA_PERDIEM_API_KEY`. **The key is NOT in the repository and must never be.** It
> was shared in chat, so the user was advised to regenerate it. Whether they set it,
> or ran `_testGSAPerDiemAPI`, is **unknown** — ask.

---

## §0.4 What the documentation task produced — do not redo it

**Completed 2026-10-30.** Four findings registered, eight deliverables updated.

### Four new findings, `G-076`…`G-079`

Appended, never inserted, and interleaved by rank per the two-column rule.
**This was the third rank shift and the largest: 73 of the 75 existing rows moved**,
because `G-077` lands at rank 3 inside the Critical block. **No `G-NNN` changed.**

| ID | Finding | Rating | Status |
|---|---|---|---|
| **G-077** | `_viewScriptProperties` returned every Script Property to any caller | **Critical** C4/R4 | remediated |
| **G-076** | `_setupGSAPerDiemProperties` destroyed the live GSA API key — **and was never run** | **Critical** C3/R4 | remediated |
| **G-078** | The City dropdown had never worked — three independent breaks | **High** C2/R4 | remediated |
| **G-079** | 30 of the register's own rated rows depart from its §6.1.3 matrix | Low C1/R2 | **annotated** |

**Then two more on 2026-10-30, from writing the per-diem runbook** — §0.2a:

| ID | Finding | Rating | Status |
|---|---|---|---|
| **G-080** | OCONUS legs re-priced server-side go to the GSA API; **stale rate silently kept** | **Medium** C3/R2 | **open** |
| **G-081** | The GSA smoke test passes on a fiscal year the dropdown never requests | Low C1/R2 | **open** |

**G-079 was resolved by annotation, on the user's instruction.** Thirty rows carry a
**†**; `GAP_REGISTER.md` §6.6.4a gives the reason for each, grouped into **five
systematic causes**. **No rating was changed.**

> **The annotation answered the question and raised a bigger one.** Grouping the
> thirty reasons showed that **three of the five are defects in the rubric's own axes,
> not in any row**: `R2` conflates *"needs an application role"* with *"needs
> spreadsheet or project-editor access"* — which `ADMINISTRATOR_GUIDE.md` §1.5.1 ranks
> in the **opposite** order to the matrix's assumption — and `R1` double-discounts
> latency that §6.1.4 explicitly refuses to discount. **Seventeen of the thirty
> departures would disappear if those axes were fixed, with no severity change to any
> finding.** That is a rubric change, it would move ranks a sixth time, and **it is the
> owner's call.** §6.6.4a records it as pending.
>
> **Two rows are flagged there as the weakest judgements in the register — G-026 and
> G-027** — and **G-071** is rated on an assumption that **VT-09/VT-12 could
> overturn**, in which case it becomes High.

### Two register defects found while doing it

| | |
|---|---|
| **The ownership tally was wrong** | It read **43 / 25 / 5 = 73** against a **75**-row register. `G-074` and `G-075` were added to the body and never to that table. **`pass6_register_check.js` passed anyway** — it validates severity block counts and never validated this one. Corrected to 47 / 27 / 5. §6.6.5 |
| **Six measurement scripts could not see the two Criticals** | Both lived in `PerDiemGSA.js`, which six scripts parse on every run. **A census counts guards; it does not read what an unguarded function does.** §6.6.6 — and it is why **VT-26** was rewritten to ask a human to read all 50 unguarded writers |

### Nine published figures moved, and that is not the same as being wrong

The code change moved every census figure. **Each is now stated with its date and
cause** rather than silently updated:

| | Was | Now |
|---|---|---|
| Top-level server functions | 459 | **461** |
| Browser-reachable | 412 | **414** |
| Behind a throwing guard | 31 | **34** |
| Direct unguarded writers | 51 | **50** |
| Client RPCs: invoked / resolve / missing | 64 / 61 / 3 | **64 / 62 / 2** |
| `lets_app/` byte-identical to TRIP | 88 | **82** |
| Application code inherited | 84% | **77%** |
| Repository files | 231 | **233** |
| Evidence scripts | 16 | **19** |

> **A withdrawn figure was always wrong; a moved figure was right when published.**
> Both leave a document disagreeing with its script and only one is an error. The
> distinction is now stated in `README.md`.

### Where the new prose lives

| Document | Section |
|---|---|
| `GAP_REGISTER.md` | §6.5 the four findings · §6.6.3 rating derivations · §6.6.4 the rubric audit · §6.6.5 the tally error · §6.6.6 what the scripts could not see |
| `SYSTEM_COMPONENT_MAP.md` | **§2.4.6** the city-dropdown chain and the missing dispatch point · **§2.7.4** the GSA edge and its credential |
| `DATA_DICTIONARY.md` | **§3.10.1** the cache-shape change, the versioned key, the mandatory deploy step |
| `DEPLOYMENT_AND_ENVIRONMENTS.md` | **§5.4.7** G-076 and G-077 in configuration context · **§5.9.1a** the post-deploy step |
| `ENHANCEMENT_PLAYBOOK.md` | **§7.10a** adding a dispatch point · **§7.11** the GSA integration · §7.4 re-measured |
| `SYSTEM_STATE.md` | **§8.6.0** the one unknown that expires · §8.7's uncomfortable reading, sharpened |
| `ADMINISTRATOR_GUIDE.md`, `README.md`, `HUMAN_VERIFICATION_CHECKLIST.md` | Counts, the moved figures, and VT-09/VT-26 rewritten |

---

## §0.5 Verification — all of it passing, so it need not be redone

| | |
|---|---|
| **19 evidence scripts** | **All clean.** Six report `0 problems` explicitly; two are **defect detectors** reporting `integrity problems: 0` beside the open G-080/G-081 counts; the rest are censuses |
| **`verify_city_dropdown_fix.js`** | **22 assertions, all passing.** Executes the real rewritten client logic with Awesomplete stubbed |
| **`verify_oconus_routing.js`** | `integrity 0 / misrouted 2` — **2 is G-080, correct until fixed** |
| **`verify_gsa_fiscal_year.js`** | `integrity 0 / gap 1` — **1 is G-081, correct until fixed** |
| **3 project suites** | **3/3 PASS** |
| `node --check` | All touched JS/HTML-script files parse |
| CI guards | **4/4 PASS** against the live tree |
| Secret hygiene | The API key appears **nowhere** in the tree or git history |

> **A trap worth remembering from building that harness.** The first run showed 4
> failures in the state-blur section. **The code was correct** — the stub put
> `TravelUtils` on the global, but `setupStateAutocomplete` guards on
> `window.TravelUtils`, so it returned `null` and every assertion passed
> **vacuously**. The harness now asserts the instance is non-null first. **A test
> that silently proves nothing is worse than no test**, because it is counted as
> evidence.

---

## §0.6 Answered on 2026-10-30 — do not re-ask

| | |
|---|---|
| **G-079's remediation** | **Annotate.** Done — 30 rows carry a **†**, reasons at `GAP_REGISTER.md` §6.6.4a |
| **Was `_setupGSAPerDiemProperties` ever run?** | **No, never** `[CLAIMED]` — the owner. **So the live GSA API key was never destroyed**, no mileage rate was reset, and **no past per-diem figure is suspect on that account** |
| **Per-diem runbook scope** | **GSA/CONUS only.** Written as `PER_DIEM_SETUP_GUIDE.md` |

> **The answer to the second exposed a conflation worth keeping.** *"Never overwritten"*
> and *"ever set"* are different facts. **Nothing in this system has ever written
> `GSA_PERDIEM_API_KEY`** — `DEPLOYMENT_AND_ENVIRONMENTS.md` §5.4.2 records **2 reads,
> 0 writes.** So whether the key was ever entered by hand is **still open, and it is
> the question that decides whether CONUS per diem has ever worked at all.** §5.8.2.

## §0.7 Still unanswered — ask, do not guess

1. **Has `GSA_PERDIEM_API_KEY` ever been set?** Not "was it destroyed" — **was it ever
   entered.** One glance at Project Settings. **If not, no CONUS per-diem has ever
   resolved**, silently. This is Step 3 of the new runbook.
2. **Was `_viewScriptProperties` ever called, and by whom?** Still `[UNKNOWN]` and
   **still expiring** — if by anyone other than a developer, treat it as a credential
   disclosure (**G-077**).
3. **Which Apps Script project was `_seedInitialAdmins` run in?** If the sandbox, its
   `TRAVEL_DB_SPREADSHEET_ID` may point at the production database and **sandbox
   activity writes live travel data.** Now **VT-21**.
4. **Is `1qcY1w387i5L…fcj9YR4` really the database?** The owner reported it;
   `PROJECT_PLAN.md:35` names a different sheet. **Finding G-075.** Only **VT-09**
   settles it.
5. **`lets_app/.claspignore` still does not exclude `.DS_Store`** — one line, not
   done, not authorised. Two such files are on disk and would be pushed.
6. **Should G-080 be fixed before the per-diem runbook is handed to anyone?** It is a
   **one-line fix for a silent wrong reimbursement figure** on reviewer-side edits of
   OCONUS legs. The runbook warns about it rather than fixing it, because fixing code
   was not the task. **Worth asking.**

> **One of these expires and the rest do not.** Apps Script execution logs are retained
> for a limited window, so item 2 stops being answerable. **Items 1 and 2 are the same
> visit** — `SYSTEM_STATE.md` §8.6.0 and **VT-09**.

---

## 1. The task

A nine-document (plus one concluding checklist) evidence-based system definition of
LETS, written for a **capable project manager who is not a programmer**, serving two
jobs:

1. Let the reader obtain and retain full administrative and security control.
2. Serve as a precise blueprint for scoping leadership-requested enhancements.

**Standing rules carried across sessions:**

- Every factual claim carries `[VERIFIED]` / `[INFERRED]` / `[CLAIMED]` / `[NOT FOUND]` / `[UNKNOWN]`.
- Never invent. An honest `[NOT FOUND]` beats a confident guess.
- Cite everything as `path/file.js:line` or `path/file.js:functionName()`.
- Plain language first, then technical precision. Tables over prose.
- **If the codebase contradicts the handoff documentation, the codebase wins — and name the wrong document and section.**
- Treat `LETS_COMPREHENSIVE_HANDOFF_DOCUMENTATION.md`, `PROJECT_PLAN.md`, and
  `README.md` as unverified claims.
- Where a documented rule has no implementing code, give it a rule ID anyway and
  mark it `[NOT FOUND]` — those become the enhancement backlog.
- Split a document into numbered parts rather than compressing detail.
- **Nothing is committed to git unless the user asks.**

**Three user decisions already made (do not re-ask):**

| Question | Decision |
|---|---|
| The brief's "Stage 1 persistence schema" (`SystemSchema.js` etc.) does not exist anywhere in the repo or its full history | **Proceed, documenting the two data layers that actually exist.** Record `LETS_SYSTEM_*` as `[NOT FOUND]` with the search evidence, plus a verification task to inspect the Drive sheet manually. |
| Order of the nine deliverables | **Strict order 1–9 as listed in the brief**, with the verification checklist last. |
| Standing instruction added mid-session | *"Document what is found and what is not found, speculating on what functions these missing or conflicting items are supposed to handle in enough detail to facilitate subsequent development efforts."* → Keep writing the `[INFERRED]` "speculation on intent" blocks. They have been the most actionable content in every pass. Pass 5 §5.4.2 is the clearest example so far. |

**One method improvement adopted in Pass 5 and vindicated in Pass 6 — keep it.**
Counted claims are produced by a committed script that re-derives them from source,
and the script deliberately prints where its mechanical answer differs from the prose.
Pass 6 applied this to the hand-counted figures in Passes 1–2 and **four of them were
wrong** (§3.1). Every figure that had a script behind it reconciled. The rule for the
deliverables: **if a number appears in a deliverable, a script in `evidence/` must
produce it.** See §4.

---

## 2. Progress

### Analysis passes — all 6 complete

| Pass | Scope | Output | Status |
|---|---|---|---|
| 1 | Inventory | [`FILE_MANIFEST.md`](./FILE_MANIFEST.md) | Done — 230 files **at the time**. **Its prose counts are corrected by Pass 6 §6.3.3; its tables are correct.** The tree has since gained a second untracked `.DS_Store` and the deployment guide, so the live total is 232 — see §4.1 |
| 2 | Entry points and routing | [`ENTRY_POINTS_AND_ROUTING.md`](./ENTRY_POINTS_AND_ROUTING.md) | Done. **Its §2.2.2 guard breakdown is withdrawn — see Pass 6 §6.3.2** |
| 3 | Data layer | [`DATA_LAYER_PASS3.md`](./DATA_LAYER_PASS3.md) | Done — D-1…D-14 |
| 4 | Business logic | [`BUSINESS_LOGIC_PASS4.md`](./BUSINESS_LOGIC_PASS4.md) | Done — R-A1…R-D1 |
| 5 | Security and access | [`SECURITY_AND_ACCESS_PASS5.md`](./SECURITY_AND_ACCESS_PASS5.md) | Done — S-1…S-25. **Four ownership labels corrected by Pass 6 §6.6.3** |
| 6 | Gap consolidation | [`GAP_CONSOLIDATION_PASS6.md`](./GAP_CONSOLIDATION_PASS6.md) | **Done — 68 canonical findings at the time (G-001…G-068), 29 verification tasks (VT-01…VT-29), 6 business-owner decisions (BD-1…BD-6).** Eleven findings have been appended since, so the register now holds **79**. Its own effort total and one of its claims have been corrected — §6.7.2 and §6.7.4 |

### Deliverables — all 10 written

The six pass documents above are the evidence base. **Pass 6 is the
one to read first** — it supersedes the earlier passes wherever they disagree, and
§6.9 maps exactly what each deliverable draws from it.

1. ~~`ADMINISTRATOR_GUIDE.md`~~ — **DONE** ([link](./ADMINISTRATOR_GUIDE.md), 826 lines)
2. ~~`SYSTEM_COMPONENT_MAP.md`~~ — **DONE** ([link](./SYSTEM_COMPONENT_MAP.md), 691 lines)
3. ~~`DATA_DICTIONARY.md`~~ — **DONE** ([link](./DATA_DICTIONARY.md), 1,067 lines)
4. ~~`WORKFLOW_AND_BUSINESS_RULES.md`~~ — **DONE** ([link](./WORKFLOW_AND_BUSINESS_RULES.md), 701 lines)
5. ~~`DEPLOYMENT_AND_ENVIRONMENTS.md`~~ — **DONE** ([link](./DEPLOYMENT_AND_ENVIRONMENTS.md), 607 lines)
6. ~~`GAP_REGISTER.md`~~ — **DONE** ([link](./GAP_REGISTER.md), 1,195 lines, **81 findings**)
7. ~~`ENHANCEMENT_PLAYBOOK.md`~~ — **DONE** ([link](./ENHANCEMENT_PLAYBOOK.md), 730 lines)
8. ~~`SYSTEM_STATE.md`~~ — **DONE** ([link](./SYSTEM_STATE.md), 364 lines)
9. ~~`README.md`~~ — **DONE** ([link](./README.md), 280 lines)
10. ~~`HUMAN_VERIFICATION_CHECKLIST.md`~~ — **DONE** ([link](./HUMAN_VERIFICATION_CHECKLIST.md), 369 lines, **29 tasks**)

---

## 3. Pass 6 — complete. What it produced, and what it changed

Full detail in [`GAP_CONSOLIDATION_PASS6.md`](./GAP_CONSOLIDATION_PASS6.md). All eight
items in the Pass 6 brief were executed.

| # | Item | Outcome |
|---|---|---|
| 1 | Reconcile the five finding-ID namespaces | **Done.** One flat scheme: `G-001`…`G-068`, severity-ordered at birth, with a 75-row cross-reference table back to every pass ID (§6.1.3). `VT-01`…`VT-29` for verification, `BD-1`…`BD-6` for owner decisions |
| 2 | Re-verify Pass 1 and Pass 2's hand-counted figures | **Done, and four were wrong** — see §3.1 below. Three new evidence scripts |
| 3 | Merge duplicate findings | **Done.** 7 pairs merged, 1 ID dissolved, 1 folded in as evidence, 1 new finding added (§6.2) |
| 4 | Single severity ranking with a stated rubric | **Done.** Consequence × reachability matrix (§6.4): 6 Critical, 17 High, 33 Medium, 9 Low, 1 Informational, 2 Constructive. **The register now reads 6 / 19 / 33 / 13 / 1 / 2** after six appended findings and one re-rating |
| 5 | Inherited-from-TRIP column on every finding | **Done, mechanically.** 39 TRIP / 24 LETS / 5 Shared at the time; **the register now reads 44 / 25 / 5** after six additions. Four of Pass 5's own labels corrected (Pass 6 §6.6.3) |
| 6 | Consolidate V-1…V-43 | **Done.** 43 → 29 tasks + 6 owner decisions; 12 merged away (§6.7) |
| 7 | Rank verification tasks by unblocking power | **Done.** Top five named (§6.7.3). **VT-01 leads and takes two minutes** |
| 8 | Business-owner decisions | **Done.** BD-1…BD-6, four of which block Critical or High findings (§6.8) |

### 3.1 Five published figures were withdrawn — do not cite them again

This replaces the old §3.1, which litigated a 29-vs-31 discrepancy that Pass 6
superseded entirely. **The fifth was found while writing Deliverable 10, and it
is Pass 6's own.**

| Withdrawn | Replace with |
|---|---|
| Pass 2's **"64 unguarded write-capable functions"** | **51** (writes in its own body, no check) or **72** (including bounded transitive reach). Never 64 — it is neither reading. State the scope with the number |
| Pass 2 §2.2.2's **four-way guard breakdown** (29/4/18/12) | **22/4/8/27.** Its "12 with no authorization check" should be **27** |
| Pass 1's **`lets_app/` = 112 files**, **87 byte-identical**, **"5 server files modified"** | **113**, **88**, **3 server + 2 client + 2 non-code**. Pass 1's *tables* are correct; only its prose is wrong |
| Pass 5's ownership labels for **S-13, S-23, S-24, S-25** | S-13/S-23/S-25 are **inherited TRIP**, not LETS. S-24 is **Shared**, not inherited |
| Pass 6 §6.7.2's **"under six hours"** and **"twenty of the 29 tasks"** | **7 h 1 m** total, **5 h 1 m** excluding the 2 h code review, and **23** tasks ≤15 min. The total had been read off the task table instead of summed |

**The most important one is the second, and it is not arithmetic.** Pass 2 classified
11 functions as having a record-level authorization check when they have **no check at
all** — it read "reads the caller's identity via `Session.getActiveUser()`" as "checks
the caller's identity." The identity is stamped into a record and never compared
against anything. Pass 5 §5.3 names the distinction correctly. The effect is that Pass
2 understates the unguarded screen-invoked surface by more than a factor of two.

### 3.2 The one new finding Pass 6 produced

**G-016: the LETS layer is structurally unreachable, not merely unwired.** All four
LETS-original modules (`RequestService.js`, `BudgetEngine.js`, `LetsDB.js`,
`FASTrackerSync.js`) are UMD/IIFE factories exposing **zero top-level function
declarations** `[VERIFIED]`, and Apps Script exposes only top-level declarations to
`google.script.run`.

Two consequences, both of which change scheduling:

- **Seventeen findings are latent, not live** — they carry reachability `R1` and describe defects in code nobody can currently invoke.
- **The budget module is cheap to fix now and expensive to fix later.** No production data to migrate, no user depending on current behavior. This is the most useful scheduling fact in the whole effort.

### 3.3 Thirteen findings have been added since Pass 6 closed

**Appended as `G-069`…`G-081`, never inserted, so no existing ID moved.** Five
came out of writing Deliverables 1–5; the sixth came out of re-checking one of
Pass 6's own claims while preparing Deliverable 10; **the seventh was reported
by the project owner and could not have been found by analysis at all**; and
**four more came out of a single code change on 2026-10-29** — see §0.4.

| ID | Finding | Severity |
|---|---|---|
| **G-069** | The client-paid override **fails open** — missing, null, or mis-keyed traveller rows skip FAS review entirely | High |
| **G-070** | `SUBMITTER_CANCELLED` is read in three places and written nowhere, so reports cannot distinguish cancellation types | Low |
| **G-071** | DD confirmation self-confirms when `DD_Email` **and** the session email are both blank | Low |
| **G-072** | The CI hardcoded-ID guard used a 40-char floor and **missed 32/33-char Drive IDs and 72-char `AKfycb` deployment IDs** — length was never the issue; the pattern was `1`-anchored. **Remediated 2026-10-29** | Low |
| **G-073** | Two initializers write **conflicting defaults** to one Script Property; whichever ran first decided the production sender | Low |
| **G-074** | The site gate's `occupancyStatus` test is a **denylist**, so blank or unrecognised values **grant** access — two lines below an allowlist that fails closed | **Medium** |
| **G-075** | **The project brief names the wrong spreadsheet as the database.** `PROJECT_PLAN.md:35` identifies a "Parent Container" sheet; the live `TRAVEL_DB_SPREADSHEET_ID` points elsewhere. **Recovery performed from the brief would silently restore the wrong sheet** | **Medium** |
| **G-076** | `_setupGSAPerDiemProperties` **destroyed the live GSA API key** and reset both mileage rates, unconditionally, from any browser. **Remediated 2026-10-29** | **Critical** |
| **G-077** | `_viewScriptProperties` **returned every Script Property to any caller** — a one-call secret read. **Remediated 2026-10-29** | **Critical** |
| **G-078** | **The itinerary City dropdown had never worked** — three independent breaks. **Remediated 2026-10-29** | High |
| **G-079** | 30 of the register's own rated rows depart from its stated §6.1.3 matrix. **Annotated 2026-10-30; the rubric question is open** | Low |
| **G-080** | **OCONUS legs re-priced by a reviewer's edit go to the GSA API, which excludes AK/HI.** The stale rate is silently kept | **Medium** |
| **G-081** | The GSA smoke test passes on a fiscal year the city dropdown never requests | Low |

**G-074 is the one with a method lesson attached.** It was found by writing a
script to test a *different* claim — Pass 6's assertion that the gate would
break if the HR library emitted a number. **That claim was false** (the code
coerces with `String()`), and executing the predicate to prove it is what
surfaced the real defect two lines below. See `GAP_REGISTER.md` §6.6.1.

**G-075 is the one that vindicates Deliverable 10.** It is the only finding in
the register that **static analysis could not have produced** — it took a human
with live access to contradict a document. And yet **Pass 3 predicted the exact
mechanism eight days earlier**: `DATA_LAYER_PASS3.md:43` recorded that *"the
database need not be the bound sheet at all — and a misconfigured property
would silently point production at the wrong spreadsheet,"* then filed it as
verification task V-5, which became **VT-09**. **Analysis named the task; only
a human could close it.** That is the whole argument for the checklist, proved
before anyone has run it.

**G-076 and G-077 carry the opposite lesson, and it is the uncomfortable one.**
Both are Critical. Both sat in a file that **six measurement scripts parse on
every run**, and none of them saw either defect — a census counts guards and
does not read what an unguarded function *does*. **They were found by a
developer opening the file to fix an unrelated dropdown bug.** See
`GAP_REGISTER.md` §6.6.6, and note the inference: **48 of the 50 unguarded
write functions have still not been read by anyone.** That is why **VT-26** was
rewritten to require exactly that.

**G-080 and G-081 add a third discovery mode, and it is the cheapest.** Both came
from **tracing one feature — per diem — from the client click to the external
API and writing down every step**, in order to produce a setup runbook. No new
tooling, no live access, no accident. **G-081 is the sharper of the two because
of *when* it surfaced: mid-sentence, while writing the instruction "run the
smoke test, expect SUCCESS, then the dropdown will work."** Writing the
verification step is what exposed that the verification does not verify.

**Of the thirteen findings added since Pass 6, only four came from the
aggregate-measurement method this effort relies on.** One needed a human with
live access, three needed someone reading code for an unrelated reason, one was
reported by a user, one came from auditing this documentation against its own
rules, and two came from tracing a single feature end to end. **A clean run of
all 19 scripts is not coverage** — **none of them follows one feature from end
to end**, which is why a silent wrong reimbursement figure survived six passes.

---

## 4. Reproducible evidence — nineteen scripts

Seventeen Node scripts in [`evidence/`](./evidence/) back every counted claim. All
seventeen run clean; paths are relative, so they work from anywhere in the repo.

**The seventeenth is `verify_city_dropdown_fix.js`**, added with the code change
in §0.2. It differs from the other sixteen: they measure the codebase, it
**executes rewritten client logic** against stubs. See §0.5.

```sh
cd docs/evidence
node pass3_D7_sheet_shape_mismatch.js      # G-040: sheet-shaped input -> all budgets $0
node pass4_budget_engine_baseline.js       # the real FY27 figures ($997,000 / $888,500)
node pass4_budget_engine_edge_cases.js     # G-035, G-050, G-051, G-052
node pass4_request_service_edge_cases.js   # G-036, G-037, G-038
node pass5_guard_census.js                 # the guard/identity/email/scope census
node pass6_write_surface_census.js         # the write surface: 51 / 72 / 94
node pass6_manifest_recount.js             # the inventory + every finding's ownership
node pass6_client_call_census.js           # the client RPC census: 64 / 62 / 2
node pass6_component_map.js                # layers, include graph, the G-016 two-way test
node pass6_schema_census.js                # every schema + the writer/schema alignment test
node pass6_rule_census.js                  # the state machine, status reachability, the fail-open test
node pass6_deployment_census.js            # clasp targets, manifest, the CI guard test, props
node pass6_register_check.js               # validates GAP_REGISTER.md as a dataset
node pass6_change_impact.js                # blast radius per change class + recipe baselines
node pass6_checklist_check.js              # validates D10, incl. its own effort arithmetic
node pass6_hc_gate_predicate.js            # the site gate executed: the withdrawn claim + G-074
```

Or all of it, including the project's own three suites:

```sh
cd docs/evidence && for f in *.js; do echo "== $f"; node "$f"; done
cd ../../lets_app && for f in test_*.js; do echo "== $f"; node "$f"; done
```

**What each Pass 6 script is for:**

- **`pass6_write_surface_census.js`** — builds a call graph over all 459 server functions and cross-tabulates write-capability against guard class. Replaces Pass 2's hand-counted 64. Also quantifies what the trailing-underscore rename would close (7 one-character renames, 44 needing new names, 5 trigger handlers that **must not** be renamed because `ScriptApp` references them by string).
- **`pass6_manifest_recount.js`** — re-derives Pass 1's whole inventory, compares `lets_app/` byte-for-byte against `reference_travel_app/`, and **derives the ownership column for all 68 findings**. Also audits Pass 5's own ownership labels and reports the four that were wrong.
- **`pass6_client_call_census.js`** — resolves every `google.script.run` chain and `serverCall('name')` literal against the server tree, using a balanced-paren scanner to walk past handler wrappers. Produces the corrected guard breakdown and the 11 misclassified functions.
- **`pass6_change_impact.js`** — rename blast radius for every string-coupled function, the exact G-067 adoption surface, **the error-contract analysis that found the silent-swallow precondition**, the BEFORE baselines each recipe verifies against, column-position coupling per tab, and the do-not-rename list. Asserts agreement with `pass6_client_call_census.js` on every run — baseline **64/62/2** since 2026-10-29 (was 64/61/3; `getAllForeignCountries` moved from absent to resolving when the city-dropdown fix defined it).
- **`pass6_register_check.js`** — eight structural invariants on the register: ID continuity, no duplicates or gaps, contiguous ranks, block counts matching their rows, **bidirectional** citation consistency with D1-D5, continuity with Pass 6 (nothing dropped, additions appended not inserted), every BLOCKED row naming a real decision, every pass ID accounted for, and the rank-vs-ID separation.
- **`pass6_deployment_census.js`** — every clasp target and what a push from each would carry, the manifest, an **executed**-vs-mentioned `clasp push` distinction, **each CI guard run against the tree AND against an input it should reject**, every Script Property mapped to readers and writers, and what a rebuild would lose.
- **`pass6_rule_census.js`** — extracts the 12-action state machine from source, maps status reachability (written vs merely read), locates each enforcement check, and **executes the overhead predicate against degraded inputs after verifying its copy matches the source character-for-character**. Also checks every line it cites still resolves, so a stale citation fails loudly.
- **`pass6_schema_census.js`** — both tab registries and their collision, every declared schema with its exact column count, **the alignment test** (every positional write measured against the schema it targets, classified as exact / trailing-omission / over-wide by the appendRow semantics rather than by an author's allowlist), the runtime-added columns, the key generators, and the zero-overlap proof behind G-040.
- **`pass6_component_map.js`** — per-layer and per-file metrics, the `include()` graph with its four broken edges, cross-layer call edges, orphan detection, and **the two-way reachability test for G-016**. That test is the one Deliverable 2's central structural claim rests on, and it strips comments first so that two header-comment mentions of the LETS modules are not miscounted as dependencies.
- **`pass6_hc_gate_predicate.js`** — copies the site gate's HC allow-path from `Access.js:414-419`, **verifies the copy against source check-by-check**, then executes it against every input class for both fields. Produced two results: it **disproved** the published claim that a numeric `supervisoryStatus` breaks the gate, and it **found G-074** in the adjacent occupancy denylist. §[4] re-scans every deliverable for the withdrawn wording on each run, treating pass documents as a dated record rather than editing them.
- **`pass6_checklist_check.js`** — seven structural invariants on Deliverable 10: task-ID continuity, **the effort total re-summed from the per-task costs**, every named function existing in source, every cited finding resolving in the register, the task count agreeing across all ten documents, the VT-04 sequencing constraint being present *and prominent*, and business decisions kept out of the task list. **It is what found Pass 6's effort total to be wrong.**

### 4.1 Regression baseline

Current output as of **2026-10-30**, for comparison on any future run. **Every one of
these is reconciled across at least two independent scripts.**

| Measure | Value | Was, before 2026-10-29 |
|---|---|---|
| Repository files (excluding `.git/`, `docs/`) | **232** | 231 |
| `lets_app/` files — **git-tracked** | **112** | 112 |
| `lets_app/` files — **on disk**, top-level / client / server | 9 / 51 / 54 = **114** | 114 |
| Byte-identical to TRIP / modified / LETS-only — on disk | **82 / 13 / 19** | 88 / 7 / 19 |
| Byte-identical / modified / LETS-only — **git-tracked only** | **82 / 12 / 18** | 88 / 6 / 18 |
| Code files only: inherited / modified / LETS-original | 81 / 11 / 13 (**77% inherited**, of 105) | 87 / 5 / 13 (83%) |
| Top-level server function declarations | **461** | 459 |
| **Browser-reachable via `google.script.run`** | **414** | 412 |
| Leading-underscore but still reachable | **119** | 118 |
| Behind a **throwing** guard, whole surface | **34** | 31 |
| **Write-capable with no check, writing in its own body** | **50** | 51 |
| Write-capable with no check, including transitive reach | **71** | 72 |
| Distinct server functions the screens invoke / resolve / missing | **64 / 62 / 2** | 64 / 61 / 3 |
| Screen-invoked with **no check of any kind** | **28** | 27 |
| `requireRequestViewer` / `requireRequestEditor` call sites | **0 / 0** | 0 / 0 |
| Real `Session.getActiveUser()` call sites — authz / attribution | 57 — 23 / 31 | unchanged |
| Distinct hardcoded email addresses | 27 | unchanged |
| `Validation.js` adoption outside its self-test / `_isValidEmail` | **0** / 21 | unchanged |
| CDN references / `integrity=` attributes | 34 / **0** | unchanged |

> **Read the second column before concluding anything got worse.** The reachable
> surface grew by two because the fix **added** two functions; the guard count grew by
> three because it **added three guards**; the unguarded-writer count **fell** by one.
> **A security fix is supposed to move these numbers, and it did.** The six files that
> moved from INHERITED to MODIFIED moved because this project *repaired* them.

**Why the file counts moved, and why three framings are listed.** Pass 1 measured
**113** files in `lets_app/`, counting one `.DS_Store`. **A second `.DS_Store` has
since appeared** at `lets_app/server/.DS_Store`, making the on-disk figure **114**; the
repository total reached **232** when `DEPLOYMENT_GUIDE_CITY_DROPDOWN_FIX.md` was
added at the root. Neither `.DS_Store` is tracked by git — the root `.gitignore` *does*
exclude them, which is why they never appear in a diff. **`lets_app/.claspignore`
does not exclude them**, so `clasp push --force` would still carry them to production.

> **The git-tracked figure, 112, is the one to quote for anything about the
> application.** It is stable, it is what a reviewer sees, and it is what a rebuild
> from source would produce. The on-disk figures are listed because
> `pass6_manifest_recount.js` reports them, and a validator whose output silently
> disagreed with this table would be worse than one that explains the gap.

**The ownership split barely moves between framings** — 82 inherited either way. The
two `.DS_Store` files account for the entire difference. **Neither is code**, which is
why the code-only row is the one that matters: **77% of the 105 application code files
are untouched TRIP**, down from 83% because six inherited files were fixed.

**Important caveat to remember:** the project's three test suites pass *because* they
feed the engine camelCase objects straight from `LETS_CONFIG`, bypassing
`LetsDB.sheetDataToObjects()` entirely. The sheet-to-engine path is untested and
broken (G-040). Do not treat green tests as evidence the budget layer works.

---

## 5. The findings that matter most

**This section is now formal.** Pass 6 §6.5 is the authoritative register; what
follows is its Critical block plus the two positive findings, reproduced here so a
cold restart has the shape of the problem without opening another file.

### 5.1 The eight Critical findings — all eight inherited from TRIP

| ID | Finding | C/R |
|---|---|---|
| **G-001** | **414 functions are reachable from any authenticated browser; 50 of them write with no authorization check.** Includes the 119 `_foo` names that look private and confer nothing | C4/R4 |
| **G-002** | **`bootstrapTravelAdmin` lets any authenticated user grant themselves `admin`** — writes both rows and clears the role cache, so it takes effect at once | C4/R4 |
| **G-003** | **The review-edit surface has no authorization.** 5 `update*` RPCs plus `reportDDFundingIssue` and `submitFundingCorrection` let any user rewrite itinerary, travellers, costs, `Grand_Total`, status and `Is_Client_Paid` on any request | C3/R4 |
| **G-004** | **Request disclosure chain.** `getRequestForReview` returns any request's full record (PII + probable CUI); `getRequestAttachments` yields its file IDs; `shareAttachmentsWithUsers` grants anyone access. IDs are sequential | C4/R3 |
| **G-005** | **`deleteTravelDraftFile` trashes any Drive file ID with no ownership check**; `uploadTravelDraftFile` has no size or MIME limit | C3/R3 |
| **G-006** | **No `oauthScopes` declared.** The effective grant is inferred from API usage and includes full Drive and all spreadsheets. Nobody chose it; it widens silently as code is added | C4/R2 |
| **G-077** | **`_viewScriptProperties` returned every Script Property to any caller** — the GSA key, `TRAVEL_DB_SPREADSHEET_ID`, the Drive IDs. **The exfiltration path that made G-006 exploitable.** Remediated 2026-10-29 | C4/R4 |
| **G-076** | **`_setupGSAPerDiemProperties` destroyed the live GSA API key** and reset both mileage rates, unconditionally, from any browser. Remediated 2026-10-29 | C3/R4 |

Then 20 High, 34 Medium, 14 Low, 1 Informational, 2 Constructive — **79 in total.** Full table: `GAP_REGISTER.md` §6.3. **Six of the eight Criticals are open; two are remediated and kept as record** per §6.2 of the register.

> **G-006 is the one to fix next.** Closing G-077 removed the published *address* of the data; it did not narrow the *grant*. G-006 is a manifest change rather than a project — `ENHANCEMENT_PLAYBOOK.md` §7.5.1.

### 5.2 The two constructive findings — lead with these

| ID | Finding |
|---|---|
| **G-067** | **`requireRequestViewer` and `requireRequestEditor` are complete, correct, and never called.** Together they close G-003 and G-004 at roughly one line per call site. **The highest-value constructive finding in the report** |
| **G-068** | An unknown `owningOffice` fails closed — no crash, no silent pass |

### 5.3 Counterweight, and it matters for credibility

Pass 5 §5.11 records 15 verified strengths: no credential handling anywhere, **no
hardcoded back door** in any authorization path, every role detector failing closed, a
correct 12-action state machine on the approval decisions themselves, and a genuinely
exemplary FAS-tracker environment gate (`TripConfig.js:86-127`) that fails closed and
cites its NIST controls.

Pass 6 §6.6.4 sharpens the framing into two readings, and **both belong in
`SYSTEM_STATE.md`**:

- **The reassuring one.** LETS did not introduce the security gaps. All eight Criticals are inherited TRIP code — and the four files now modified were byte-identical to TRIP at the commit before this project fixed them. It adopted a working application and built on it as directed.
- **The uncomfortable one.** It adopted them *without a security review of what it was adopting*. **77% of the application code is still accepted unexamined**, down from 84% only because six files were repaired. The one place LETS reproduced an inherited pattern by choice — CDN loading with no integrity checking, in **new** pages — shows the pattern propagating rather than being caught.
- **And the sharper evidence, added 2026-10-29.** A developer opened one inherited file to fix a dropdown and **found two Criticals in it**, after six measurement scripts had parsed that file clean on every run for eight days. **48 of the 50 unguarded write functions have still not been read by anyone.**

Any deliverable that reports only failures will misrepresent the system and be
dismissed. Any deliverable that omits the second reading is not doing its job.

---

## 6. Open verification work — 29 tasks + 6 decisions (now Deliverable 10)

Pass 6 consolidated V-1…V-43 into **29 verification tasks (VT-01…VT-29)** and
separated out **6 business-owner decisions (BD-1…BD-6)** that no amount of code
reading can answer. Full checklist with locations and costs: §6.7.2. It becomes
[`HUMAN_VERIFICATION_CHECKLIST.md`](./HUMAN_VERIFICATION_CHECKLIST.md), which is
now written — **this section is superseded by it** and is kept only as the
derivation record.

**Total effort: about five hours of live-access work, plus a two-hour code
review (VT-26) — 7h 1m in total.** 23 of the 29 take fifteen minutes or less;
11 are a single look at a spreadsheet or a settings page.
*(Corrected — Pass 6's "under six hours" and "twenty tasks" were both wrong,
and the correction is now made in every document that repeated them.
`pass6_checklist_check.js` §[2] re-sums it on every run. See §0.2.)*

### 6.1 The five that unblock the most (§6.7.3)

| Rank | Task | Unblocks | Cost |
|---|---|---|---|
| **1** | **VT-01** — the deployment's "Execute as" and "Who has access" settings | All 6 Criticals + the severity amplifier on G-003, G-005, G-012, G-027, G-044 | **2 min** |
| **2** | **VT-07** — list every tab in the live database | G-016, G-040, G-041, G-043, G-055, G-057 | **5 min** |
| **3** | **VT-05 + VT-11** — export the role tables; run `verifyPhase7Routing()` | G-007, G-009, G-010, G-029, G-031, G-032 | **15 min** |
| **4** | **VT-03** — is an HC library attached, and **what exact values does it emit**? | G-008, **G-074**, and the site gate itself | **20 min** |
| **5** | **VT-06 + VT-08** — row 1 of the seven core tabs | G-013, G-014, G-044 — the only test for silent ongoing data corruption | **12 min** |

**VT-01 is two minutes and gates the severity of every Critical finding.** If only one
thing gets done, it is that.

### 6.2 One hard sequencing constraint

**VT-04** — determine whether `bootstrapTravelAdmin` has ever been called by anyone
unexpected — **must run before G-002 is remediated.** Remediation destroys the
evidence. It is not a top-five *unblocking* task, but the ordering matters more than
its rank.

### 6.3 The six decisions (§6.8)

`BD-1` deployment intent · `BD-2` should `aas_fo_reviewer` see all data · `BD-3`
reviewer edit rights in `NEEDS_INFO_*` · `BD-4` which cost figure is authoritative ·
`BD-5` who owns the `Requests` collision decision · `BD-6` is FO self-approval
intended, and should tier thresholds be computed.

**Four of the six (BD-3, BD-4, BD-5, BD-6) block findings rated Critical or High.**
`GAP_REGISTER.md` must mark those findings `BLOCKED ON BD-n` rather than leaving them
looking like open engineering work.

---

## 7. Repository state

**SUPERSEDED BY §0.1 — read that instead.** This section described the tree at
the end of the *documentation* effort, when `lets_app/` was byte-identical to
`HEAD`. **That is no longer true:** seven files now carry the city-dropdown fix
(+575 / −89). §0.1 has the current `git status` and the exact list of paths to
stage.

**What still holds from this section:**

**Two `.DS_Store` files exist inside `lets_app/`** but never appear in
`git status` — the root `.gitignore` excludes them, so git never reports them.
They are still on disk and still outside `lets_app/.claspignore`, so
`clasp push --force` would carry them to production.

**Nothing is committed, per the standing rule that commits happen only when
you ask.**

> **Do not sweep the five untracked root files into a commit.** `Code.gs` +
> `appsscript.json` + `.clasp.json` at the repository root point at an
> **undocumented third Apps Script project**
> (`181ocqi16Ruzb0kaPTiAC8OMXRp9bLwbfH-McBXImV6d5IKe9L751VFGF`). That root
> `.clasp.json` has `rootDir: ""` and `skipSubdirectories: false`, so a
> `clasp push` from the repository root would carry **229 files** into it —
> including 94 from `reference_travel_app/`, which is another organisation's
> application. That is finding **G-048**, re-rated to **High**. **Never run
> `clasp push` from the repository root.** VT-21 resolves it.

---

## 8. Deliverables — all 10 written

| # | Document | Lines | Centrepieces |
|---|---|---|---|
| 9 | [`README.md`](./README.md) | 280 | Routes by question, not by document title; three reading orders; the ID scheme; what is *not* in the set |
| 1 | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) | 829 | §1.4.3's role × capability matrix; §1.5.1's privilege ranking; §1.8.4's two readings |
| 2 | [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) | 693 | §2.3.4's guard concentration; §2.6's two-way detachment proof; §2.8's fragile seams |
| 3 | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) | 1,093 | §3.2's `Requests` section; every column of 10 TRIP + 7 LETS tabs; §3.9's reorder rule |
| 4 | [`WORKFLOW_AND_BUSINESS_RULES.md`](./WORKFLOW_AND_BUSINESS_RULES.md) | 701 | 70 rules typed; §4.3.5's fail-open test; §4.8's claimed-and-absent rules |
| 5 | [`DEPLOYMENT_AND_ENVIRONMENTS.md`](./DEPLOYMENT_AND_ENVIRONMENTS.md) | 687 | §5.1.3's root-config hazard; §5.2.1's push-≠-deploy; §5.3.3's CI guard gap |
| 6 | [`GAP_REGISTER.md`](./GAP_REGISTER.md) | 746 | **74 findings, rank-ordered**; §6.1's rubric; §6.6.1's withdrawn claim and §6.6.2's re-rating, each with its reason |
| 7 | [`ENHANCEMENT_PLAYBOOK.md`](./ENHANCEMENT_PLAYBOOK.md) | 729 | §7.2's silent-failure prohibitions; §7.3's G-067 recipe with its precondition |
| 8 | [`SYSTEM_STATE.md`](./SYSTEM_STATE.md) | 370 | **§8.0's one page**; §8.2.2's fifteen strengths; §8.7's two readings |
| **10** | **[`HUMAN_VERIFICATION_CHECKLIST.md`](./HUMAN_VERIFICATION_CHECKLIST.md)** | **363** | **29 tasks grouped by where the work happens**; §10.1's VT-04 ordering constraint; §10.8's six decisions kept out of the task list; §10.9's five tasks that produce the only record that will exist; §10.10's one-page record sheet |

**Total written: 7,597 lines across ten deliverables**, plus 19 evidence
scripts, 6 pass documents, and two root-level runbooks. **The set is complete.**

### 8.1 The fourteen conventions — keep all of them

1. **Confidence marker on every factual claim.**
2. **Consequence before mechanism.**
3. **Name the wrong document** where code and documentation disagree.
4. **Strengths stated as plainly as defects.**
5. **Every `[CLAIMED]` / `[UNKNOWN]` becomes a VT task.**
6. **Forward references by name, not link**, until the target exists.
7. **A script per deliverable that makes structural claims.**
8. **Distinguish verified order from inferred pairing** (D3).
9. **Give unenforced rules an ID anyway** (D4).
10. **`[CONFIGURED]` for "the repo specifies this; the live system may differ"** (D5).
11. **Never renumber; record every re-rating with its reason** (D6).
12. **A recipe states its blocking decision before its instructions, and ends with a named script and an expected delta** (D7).
13. **A synthesis introduces nothing** — new findings go in the register first (D8).
14. **An index routes by question and says what is *not* in the set** (D9).

### 8.2 The standing method rule, earned five times — and once in reverse

**When a measurement contradicts a document's central claim, suspect the
measurement first.** Five times a naive measurement produced a confident wrong
answer, and all five were caught only because the result contradicted
something already established:

| | The wrong answer |
|---|---|
| D4 | Reported `SUBMITTED` as an unwritable *status* (it is an `ACTION_TYPE`) |
| D5 | Reported `verify.yml` as a **deploying** workflow — the opposite of its design |
| D6 | Reported **55 of 73 findings as dropped** from a correct register |
| D7 | Reported **42 coupled functions instead of 61** |
| D10 prep | Reported a read-only pre-flight as **write-capable**, because a function name appeared in a *string* |

**But the sixth went the other way, and it is the one to remember.** Four
documents asserted that the site gate's `supervisoryStatus` test would break
if the HR library emitted a *number*. The measurement said otherwise — the
code coerces with `String()`, so a number passes. **Here the prose was wrong
and the measurement was right**, and the two cases are indistinguishable
until the predicate is actually executed.

> **So the rule needs its second half: suspect the measurement first, then
> execute the claim.** "Suspect the measurement" is a good prior precisely
> because it was right five times out of six — but a prior is not a verdict.
> Both failure modes look identical from the armchair, and reading a line of
> code is not the same as knowing what it does. Full account:
> `GAP_REGISTER.md` §6.6.1.

**Also caught by cross-checking rather than by reading:** four mis-numbered
finding citations, one wrong cross-document count (33 vs 31 guarded
functions), one stale derived table (D4's rule tally), one ragged table, one
in-range-but-wrong line citation, **Pass 6's own effort total** (§0.2), and a
**file-inventory drift** caused by two `.DS_Store` files appearing mid-effort
(§4.1).

### 8.3 Now that all ten are written — candidates, none started, none approved

**Two of these are one-line fixes and are the cheapest items in the whole effort.**

> **One item has since moved off this list entirely.** The itinerary
> city-dropdown fix was requested, implemented, **and documented** — it is
> **G-078**, with its two companion Criticals **G-076** and **G-077**. §0 has
> the account. **Only deployment remains.**

| Candidate | Why |
|---|---|
| **Fix G-080 — one line, a silent wrong reimbursement figure** | **The newest and highest-value item.** OCONUS legs re-priced by a reviewer's edit go to the GSA API, which excludes AK/HI; the stale rate is kept and nights are recomputed against it, with no error. **`isOCONUSLocation` already implements the test the dispatcher fails to call.** `ENHANCEMENT_PLAYBOOK.md` §7.11.3 |
| **Decide the G-079 rubric question** | **Annotation is done.** What remains is whether to fix the rubric's axes: `R2` conflates two populations of very different risk, `R1` double-discounts latency. **Seventeen of the thirty departures would disappear**, with no severity change to any finding. §6.6.4a |
| **Fix G-081 — the lying diagnostic** | One line, in the same file as G-080's fix. `_testGSAPerDiemAPI` prints `✓ SUCCESS!` on a fiscal year the dropdown never requests. **Do it with G-080 or the per-diem runbook's Step 6 has to keep warning people not to trust it** |
| **Fix G-006 — declare `oauthScopes`** | **Now the most serious open Critical.** Closing G-077 removed the published address of the data; it did not narrow the grant. A manifest change — `ENHANCEMENT_PLAYBOOK.md` §7.5.1 |
| **Add `.DS_Store` to `lets_app/.claspignore`** | **One line.** Two untracked `.DS_Store` files sit inside `lets_app/` and that ignore list does not exclude them, so `clasp push --force` carries them to production. Untracked means invisible in review — §0 |
| **Fix G-022 — the false FAS-sync notice** | **A wording change**, and the cheapest high-value fix in the register. The intake form tells users their request will sync to the official FAS tracker; it will not. **The system is making a compliance claim to users that is not true** |
| **VT-26 — read the 50 unguarded write functions** | **Re-prioritised upward on 2026-10-29.** Two of the two that have been read closely turned out to be Critical. It was placed last in Deliverable 10 because it needs no live access; **it is now the highest-value unperformed task in the set** |
| **Correct the root `README.md`** | Pre-existing, 111 lines, dated 2026-10-02. It advertises *"Real-time discretionary balance tracking"* and automated FAS sync — **G-025** and **G-024**, neither of which runs. It is the first thing a GitHub visitor reads |
| **Remove four dead document references from source comments** | `Data_Model_v2.md`, `BUGS_FOUND.md`, `OPEN_QUESTIONS.md`, `REFACTOR_PLAN.md` exist in no commit (**G-046**). Three are superseded by D3 and D6. **Do not create them** — delete the comments |
| **An ADR for the `Requests` tab collision** | Once **BD-5** is answered. Two schemas claim one tab name |
| **A disaster-recovery runbook** | `DEPLOYMENT_AND_ENVIRONMENTS.md` §5.7.3 notes none exists. **Cannot be written from the repository** — needs VT-09 and VT-02 first. **Deliverable 10 §10.9 names the five tasks that produce most of it** |

---

*End of the scaffolding. Ten deliverables, 7,597 lines, 19 evidence scripts,
six pass documents, 81 findings, 29 verification tasks, six business
decisions. **Six published figures and one published claim were withdrawn
during the work, each recorded as a withdrawal rather than quietly fixed — and
nine more figures MOVED on 2026-10-29 because the code changed, which is a
different thing and is labelled as such.***

**Do not delete this file yet.** All ten deliverables are written and the code
change is documented, **but nothing is committed and nothing is deployed** —
§0.2. Delete it once the change is pushed, the cache is cleared, and someone has
clicked the dropdown in a real browser.*
