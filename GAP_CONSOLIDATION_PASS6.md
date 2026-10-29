# Pass 6 — Gap consolidation

**Scope.** Merge the findings of Passes 1–5 into one severity-ranked register, reconcile duplicate IDs across passes, correct the figures that do not survive mechanical re-derivation, and resolve the numbering before the ten deliverables are written.

**Method.** No new code reading. Pass 6 is reconciliation: it reads the five pass documents against each other and against the source tree, and it re-derives every hand-counted figure with a committed script. Where a pass's prose disagrees with a script, the script wins and the disagreement is named rather than quietly corrected.

**Reading guide.** §6.1 is the ID scheme and the cross-reference table — read it first, because it is the key to every other section. §6.2 is the merge decisions. §6.3 is the corrections, and it is the section a reviewer should be most skeptical of, because it says four published numbers were wrong. §6.4 states the severity rubric before §6.5 applies it, so the ranking can be argued with. §6.6 is remediation ownership. §6.7–6.9 consolidate the verification work and the decisions that only the business owner can make.

---

## 6.0 What Pass 6 found

The 75 finding IDs issued by Passes 1–5 reduce to **68 canonical findings**: seven duplicate pairs merged, one umbrella ID dissolved into its parts, one finding folded in as evidence for another, and one new finding added by Pass 6's own measurement. **Four published figures do not survive re-derivation** and must not be cited again: Pass 2's "64 unguarded write-capable functions", Pass 2's four-way guard breakdown of the client-callable surface, Pass 1's `lets_app/` file count, and Pass 1's byte-identical count. Four of Pass 5's 24 ownership labels were wrong — three of them in the same direction, attributing to LETS what is in fact byte-identical inherited TRIP code. The single most consequential correction is not a count: **Pass 2 classified 11 functions as having a record-level authorization check when they have no check at all**, because it read "reads the caller's identity" as "checks the caller's identity" — so Pass 2 understates the unguarded screen-invoked surface as 12 when it is 27. The 43 verification tasks reduce to **29 tasks plus 6 business-owner decisions**. **84% of the application code is byte-identical to the TRIP reference, and all six Critical findings live in it** — the ownership split is clean: TRIP owns the unguarded surface, LETS owns its own unfinished features, and Pass 6's new finding is that those unfinished features are not merely unwired but structurally unreachable, which makes them the cheapest fixes on the list.

---

## 6.1 The ID scheme (Pass 6 item 1)

### 6.1.1 Why the current IDs cannot go into a deliverable

Five passes produced five independent ID namespaces, and they collide:

| Namespace | Pass | Range | Collision |
|---|---|---|---|
| `M-n` | 1 | M-1…M-5 | — |
| `R-n` | 2 | R-1…R-9 | **`R-` is reused by Pass 4** |
| `D-n` | 3 | D-1…D-14 | — |
| `R-An`, `R-Bn`, `R-Cn`, `R-Dn` | 4 | R-A1…R-D1 | **`R-` prefix shared with Pass 2** |
| `S-n` | 5 | S-1…S-25 | — |
| `V-n` | 2,3,4,5 | V-1…V-43 | Sequential across passes — the one namespace that *was* managed |

A reader who sees "R-4" in a deliverable cannot tell whether it means Pass 2's *412 functions client-callable* or something in Pass 4's `R-A`/`R-B`/`R-C`/`R-D` family. Worse, Pass 4 skipped `R-B10` in its own carry-forward table while discussing it in the body, and Pass 2's `R-` numbers run 1–9 where Pass 4's run `A1`–`D1`, so a careless citation of "R-1" is ambiguous between a broken `include()` target and nothing at all.

### 6.1.2 The scheme

Findings get a flat, zero-padded `G-NNN` — **G for gap** — assigned in the severity order established in §6.5. Verification tasks get a flat `VT-NN`, assigned in the execution order established in §6.7. Business-owner decisions get `BD-N`.

| Series | Meaning | Count | Ordered by |
|---|---|---|---|
| `G-001`…`G-068` | Canonical findings | 68 | Severity, then reachability |
| `VT-01`…`VT-29` | Verification tasks | 29 | Unblocking power, then cost |
| `BD-1`…`BD-6` | Business-owner decisions | 6 | Dependency order |

Three properties make this scheme safe to put in front of a non-programmer and safe to cite for years:

1. **Flat.** No sub-families. `G-017` is `G-017` in every document.
2. **Severity-ordered at birth.** `G-001` is the worst finding. A reader who stops after ten entries has read the ten that matter most. This is deliberate and has a cost — see the warning below.
3. **Never reused.** If a finding is later withdrawn, its ID is retired with a tombstone row, not recycled.

> **Warning, stated once and carried into `GAP_REGISTER.md`.** Severity-ordered IDs are readable but brittle: if a verification task later changes a severity, the *rank* changes and the *ID must not*. A finding numbered in the Medium block may end up rated High after re-rating. That is correct and expected. The register therefore carries **both** a permanent `G-NNN` and a mutable `Rank` column, and the reader is told that rank, not ID, reflects current severity. The alternative — renumbering on re-rate — would invalidate every citation in nine other documents and is not acceptable.

### 6.1.3 Cross-reference: pass ID → canonical ID

This is the authoritative map. Every citation in the five pass documents resolves through this table. `→ merged into` marks a finding that no longer has its own entry; see §6.2 for why.

| Pass ID | Pass | Canonical | Finding (abbreviated) | Merge note |
|---|---|---|---|---|
| M-1 | 1 | **G-047** | **The brief's "Stage 1 persistence schema" (`LETS_SYSTEM_*`) exists nowhere in t… |  |
| M-2 | 1 | → **G-013** | **Tab-name collision on `Requests`:** 42 TRIP columns vs 20 LETS columns, differ… | merged into G-013 (with D-6) |
| M-3 | 1 | **G-015** | **The LETS layer is unwired.** Zero references from any entry point; `apiGetInit… | canonical for the unwired-layer family |
| M-4 | 1 | → **G-017** | **Four broken `include()` targets**, including the `.html.html` names that make … | merged into G-017 (with R-1) |
| M-5 | 1 | **G-048** | **An undocumented third Apps Script project is wired to the repository root** vi… |  |
| R-1 | 2 | **G-017** | **Four broken `include()` targets**, including the `.html.html` names that make … | canonical for the broken-reference family |
| R-2 | 2 | **G-025** | `?mode=budget` is a static mockup — 30 hardcoded figures and a non-functional sy… | **split**: mockup content → G-025, missing gate → G-011 |
| R-3 | 2 | **G-024** | FAS tracker wiring is incomplete: the poller reads decisions and discards them, … |  |
| R-4 | 2 | **G-001** | **412 functions are reachable from any authenticated browser; 51 of them write w… | **dissolved** into G-001 and G-002 — see §6.2.2 |
| R-5 | 2 | → **G-015** | **The LETS layer is unwired.** Zero references from any entry point; `apiGetInit… | merged into G-015 (with M-3) |
| R-6 | 2 | → **G-008** | **Two of three site-gate allow-paths are controlled by the HC library, not by LE… | merged into G-008 (with S-12) |
| R-7 | 2 | **G-066** | No simple triggers exist at all, so there is no spreadsheet custom menu — contra… |  |
| R-8 | 2 | **G-026** | `getHCStaffingBundle` returns the full personnel roster with no role check |  |
| R-9 | 2 | **G-021** | **No branch protection; the `CLASPRC_JSON` holder has standing production deploy… |  |
| D-1 | 3 | **G-041** | The `Feedback` tab is written and read but has no schema; nothing creates it; it… |  |
| D-2 | 3 | **G-057** | `File_Queue` is declared in the registry and referenced nowhere — a phantom tab |  |
| D-3 | 3 | **G-042** | Four per-diem tabs bypass `SHEET_NAMES` via 6 duplicate constants; renaming thro… |  |
| D-4 | 3 | **G-012** | **`Request_ID` generation has no lock, so duplicate primary keys are possible; t… |  |
| D-5 | 3 | **G-058** | Two incompatible `Log_ID` formats (`LOG-NNNNNN` and UUID) in one audit column |  |
| D-6 | 3 | **G-013** | **Tab-name collision on `Requests`:** 42 TRIP columns vs 20 LETS columns, differ… | canonical for the `Requests` collision |
| D-7 | 3 | **G-040** | **The budget engine cannot read its own tabs** — every `BudgetEngine` field name… |  |
| D-8 | 3 | **G-043** | `Travelers` and `Audit_Log` have schemas and no writer anywhere; `RequestService… |  |
| D-9 | 3 | **G-044** | `reportDDFundingIssue` adds 3 undocumented columns to `Requests` at runtime; two… |  |
| D-10 | 3 | **G-014** | **18 order-dependent sheet access points, 8 of them positional write arrays.** I… |  |
| D-11 | 3 | **G-045** | No data validation, named ranges, or sheet protections are created anywhere |  |
| D-12 | 3 | **G-046** | **Four design documents referenced by code exist in no commit:** `Data_Model_v2.… |  |
| D-13 | 3 | **G-059** | `'Edit_SharedCosts'` is written as a literal and is absent from `ACTION_TYPES` |  |
| D-14 | 3 | **G-023** | **FAS decision status is read by substring match, so `"Not Approved"` and `"Disa… | canonical for the FAS substring match |
| R-A1 | 4 | **G-018** | **An AAS FO reviewer submitting an all-client-paid request is auto-approved with… |  |
| R-A2 | 4 | **G-019** | **`COMPLETED` means "funding confirmed pre-travel", not travel finished.** No po… |  |
| R-A3 | 4 | **G-020** | **`initTravelSystemConfig` writes 4 of 7 property keys that nothing reads** — mi… |  |
| R-A4 | 4 | **G-049** | `'FY Quarter'` labels calendar quarters, not fiscal ones; duplicate implementati… |  |
| R-A5 | 4 | **G-060** | `DRAFT` status is vestigial — never written; drafts live only in browser Indexed… |  |
| R-B1 | 4 | **G-061** | An FO is listed against a set-aside it is not charged for; shares still sum corr… |  |
| R-B2 | 4 | **G-035** | **`RECONCILED` with blank actuals silently frees the entire commitment** |  |
| R-B3 | 4 | **G-036** | **`reconcileRequest` overwrites the approved estimate**, destroying the audit ba… |  |
| R-B4 | 4 | **G-050** | The gatekeeper self-exclusion filter erases all commitments sharing a blank `req… |  |
| R-B5 | 4 | **G-037** | `LETS-` IDs are count-based: they collide under concurrency, reuse numbers after… |  |
| R-B6 | 4 | **G-068** | An unknown `owningOffice` fails closed — no crash, no silent pass |  |
| R-B7 | 4 | **G-051** | **No input validation on cost** — a negative estimate increases the apparent bud… |  |
| R-B8 | 4 | **G-052** | The `Set_Asides.Active` column is never read, so deactivation has no effect |  |
| R-B9 | 4 | **G-053** | Proportional shares are never recomputed; they go stale after a mid-year rebasel… |  |
| R-B10 | 4 | **G-062** | `isDeficit` is `false` when the balance is exactly $0, so a fully exhausted budg… |  |
| R-B11 | 4 | **G-038** | `updateRequestStatus` has no state machine and no permission check, contrary to … |  |
| R-B12 | 4 | **G-039** | `setAsideType` and the three policy flags are collected and never read. Charging… |  |
| R-C1 | 4 | **G-054** | The Tier-1 purpose list exists in three independent places — config, client arra… |  |
| R-C2 | 4 | → **G-023** | **FAS decision status is read by substring match, so `"Not Approved"` and `"Disa… | merged into G-023 (with D-14) |
| R-C3 | 4 | **G-055** | Tier thresholds ($10k IMM, $7k training) are user-declared, never computed from … |  |
| R-C4 | 4 | **G-022** | **The intake form tells users their request will sync to the FAS tracker. It doe… |  |
| R-D1 | 4 | **G-065** | A hardcoded Drive folder ID in `Database.js:27` is written to a dead property key |  |
| S-1 | 5 | **G-002** | **`bootstrapTravelAdmin` lets any authenticated user grant themselves `admin`** … |  |
| S-2 | 5 | **G-004** | **Request disclosure chain.** `getRequestForReview` returns any request's full r… | canonical for the disclosure chain |
| S-3 | 5 | **G-005** | **`deleteTravelDraftFile` trashes any Drive file ID with no ownership check**; `… |  |
| S-4 | 5 | **G-003** | **The review-edit surface has no authorization.** 5 `update*` RPCs plus `reportD… | canonical for the unguarded-write family |
| S-5 | 5 | **G-027** | **A role-table read can trigger a production write.** `selfHealCurrentUserEmail`… |  |
| S-6 | 5 | **G-028** | Attachment sharing to the next reviewer passes `'viewer'`, which is not a valid … |  |
| S-7 | 5 | **G-067** | **`requireRequestViewer` and `requireRequestEditor` are complete, correct, and n… |  |
| S-8 | 5 | **G-007** | **No server-side last-admin protection.** `deleteRole` / `setRoleActive` can lea… |  |
| S-9 | 5 | **G-029** | `fas_fo_reviewer` has no branch in `getReviewerContext` and resolves to `role: '… |  |
| S-10 | 5 | **G-030** | **`requireRole()` silently grants access for any unrecognized role name** — no `… |  |
| S-11 | 5 | **G-031** | `aas_fo_reviewer` carries `scope: 'all'` — organisation-wide visibility identica… |  |
| S-12 | 5 | **G-008** | **Two of three site-gate allow-paths are controlled by the HC library, not by LE… | canonical for HC delegation |
| S-13 | 5 | **G-006** | **No `oauthScopes` declared.** The effective grant is inferred from API usage an… |  |
| S-14 | 5 | **G-032** | **`Is_Active` parsing treats only `false` / `'false'` as inactive.** Blank, `'no… |  |
| S-15 | 5 | **G-009** | **Authorization changes are audited by overwritable current-state columns.** `de… |  |
| S-16 | 5 | → **G-004** | **Request disclosure chain.** `getRequestForReview` returns any request's full r… | merged into G-004 (with S-2) |
| S-17 | 5 | → **G-003** | **The review-edit surface has no authorization.** 5 `update*` RPCs plus `reportD… | merged into G-003 (with S-4) |
| S-18 | 5 | **G-033** | The 12-function `Validation.js` library has zero adoption outside its own self-t… |  |
| S-19 | 5 | → **G-001** | **412 functions are reachable from any authenticated browser; 51 of them write w… | folded into G-001 — it explains the surface, is not a separate defect |
| S-20 | 5 | **G-011** | **`?mode=budget` and `?mode=dd-confirm` page-servers have no role gate** beyond … | canonical; absorbs R-2 |
| S-21 | 5 | **G-063** | **Eight placeholder approver addresses** (`<office>.director@gsa.gov`) are live … |  |
| S-22 | 5 | **G-064** | The Gmail v1 advanced service is declared and never used — `Gmail.` appears nowh… |  |
| S-23 | 5 | **G-056** | **Six real named GSA employees' addresses are embedded in routing-test fixtures … |  |
| S-24 | 5 | **G-034** | **No CDN subresource integrity:** 34 external script and style references, zero … |  |
| S-25 | 5 | **G-010** | **`verifyPhase7Routing` is unguarded and returns the complete role roster** — ev… |  |

---

## 6.2 Merge decisions (Pass 6 item 3)

### 6.2.1 The rule applied

Two findings merge when they describe **one defect in one place with one fix**. They stay separate when they share a cause but need different remediation, or when they sit in different files and could be fixed independently. Seven pairs merged. In every case the surviving entry is the one with the stronger evidence, and the merged entry carries **both** pass IDs so no citation breaks.

| Merged | Into | Why they are one finding | Why it matters that they merged |
|---|---|---|---|
| M-2 | **D-6** → G-013 | Both describe the `Requests` tab-name collision: 42 TRIP columns vs 20 LETS columns on one name. Pass 1 found it structurally, Pass 3 found the column-level detail | Counting them twice made the collision look like two problems and understated the single decision needed |
| M-3 | **R-5** → G-015 | Both describe the LETS layer being unwired. Pass 1 found no references; Pass 2 found the two missing `api*` functions that would have been the entry point | One fix (wire the layer) closes both |
| M-4 | **R-1** → G-017 | Both are the broken `include()` / `.html.html` family. Pass 1 found three; Pass 2 found a fourth | One rename procedure closes all four |
| R-6 | **S-12** → G-008 | Both are the HC library dependency. Pass 2 found the undeclared binding and the silent swallow; Pass 5 found the access-control consequence | Pass 5's framing is the one that matters: this is delegated authorization, not a dependency hygiene issue |
| R-C2 | **D-14** → G-023 | Identical finding — FAS status read by substring, so `"Not Approved"` matches `"Approved"`. Pass 3 found it in the data layer, Pass 4 re-derived it in the business logic | Two IDs for one one-line fix |
| S-16 | **S-2** → G-004 | `shareAttachmentsWithUsers` and `getRequestAttachments` compose *with* `getRequestForReview` to form one disclosure chain | See §6.2.3 — the composition is the finding |
| S-17 | **S-4** → G-003 | `reportDDFundingIssue` / `submitFundingCorrection` are two more members of the same unguarded-write family Pass 5 counted as five | Pass 5 itself split them only because it found them in different files |

Two further consolidations are **not** merges and are recorded so the distinction is auditable:

- **S-19 (leading-underscore naming) is folded into G-001**, the unguarded-surface finding, because it is not an independent defect — it is the *reason* the surface is larger than it appears. It keeps a cross-reference, not an entry.
- **R-2 splits.** Its "static mockup with 30 hardcoded figures" content becomes G-025; its "no admin gate" content merges into S-20 → **G-011**. Pass 2 wrote them as one bullet; they have different fixes and different owners.

### 6.2.2 Pass 2's R-4 is dissolved, not merged

R-4 read: *"412 functions client-callable; 64 unguarded write-capable; `bootstrapTravelAdmin` allows self-grant of admin."* That is three findings of three different severities wearing one ID, and the middle figure is wrong (§6.3.1). It dissolves into:

| Part of R-4 | Canonical | Severity |
|---|---|---|
| 412 functions reachable from any authenticated browser | **G-001** | Critical |
| 51 of them write with no authorization check | **G-001** (same finding — the write census is its evidence) | Critical |
| `bootstrapTravelAdmin` permits privilege self-grant | **G-002** | Critical |
| `Is_Active` parsing trap (R-4's unstated dependency) | **G-032** | Medium |

Dissolving rather than merging matters: a compound ID cannot be closed. A remediation ticket for "R-4" has no definition of done. `G-002` does — one guard on one function.

### 6.2.3 Why two compositions are single findings

Pass 5 found S-2 (read any request), S-16 (read its attachment IDs, grant anyone access), and S-3 (delete any Drive file). Individually each is a High. Together they are one capability: **enumerate a sequential request ID, read the full record, extract the attachment file IDs, grant yourself write access, and optionally trash the originals** — with no role check at any step, attributed to nobody, on data Pass 5 classified as PII and probable CUI.

The register records this as **G-004** with the composition stated in the finding text, because:

1. A reviewer triaging three separate Highs may fix the cheapest and leave the chain intact.
2. The severity of the chain exceeds the maximum of its parts. The register must be able to say so.
3. The fix is shared — `requireRequestViewer` (G-067) closes the first two links at one line per call site.

The same logic applies to G-003: five unguarded `update*` RPCs plus the two DD-funding writes are one finding — *the review-edit surface has no authorization* — not seven.

---

## 6.3 Corrections to published figures (Pass 6 item 2)

Four counted claims in Passes 1–2 do not survive mechanical re-derivation. All four were hand-counted; every figure produced by a script in Passes 3–5 reconciled. Two new committed scripts do the re-derivation:

| Script | Re-derives |
|---|---|
| [`evidence/pass6_write_surface_census.js`](./evidence/pass6_write_surface_census.js) | Pass 2's write-capability and guard figures, over a call graph of all 459 server functions |
| [`evidence/pass6_manifest_recount.js`](./evidence/pass6_manifest_recount.js) | Pass 1's whole inventory, plus the ownership column for every finding |
| [`evidence/pass6_client_call_census.js`](./evidence/pass6_client_call_census.js) | Pass 2's client-RPC census and its four-way guard breakdown |

### 6.3.1 Pass 2's "64 unguarded write-capable functions" — withdrawn

`pass6_write_surface_census.js` builds a call graph over every top-level server function, classifies each by mutation sink (sheet / Drive / Script-Property / trigger / mail), and cross-tabulates against guard class. Result:

| Measure | Count |
|---|---|
| Browser-reachable functions | 412 `[VERIFIED]` |
| Write-capable, bounded | 94 |
| …behind a throwing guard | 14 |
| …record-level check only | 6 |
| …**no check of any kind** | 74 |
| …of those, trigger handlers (unguarded by necessity) | 2 |
| **Unguarded write-capable, excluding trigger handlers** | **72** |
| …**writing in their own body** | **51** |
| …reaching a write only through a callee | 21 |

**64 is neither of the two defensible readings.** It falls between them. Pass 2 listed privileged writers by hand and neither enumerated every mutation sink nor followed the call graph.

**Use 51**, always with its scope: *"51 of 412 browser-reachable functions perform a write in their own body with no authorization check of any kind."* Use 72 only when transitive reach is explicitly in scope, and say so. Never mix the readings in one sentence.

> **A method note the script makes, and that the deliverables must preserve.** Transitive write-reach must be *bounded* or it is meaningless. Four helpers — `logError`, `selfHealCurrentUserEmail`, `sendTravelEmail`, `parseExcelBlob_` — are called from nearly everywhere and each writes something incidental to its caller's purpose. Propagating through them makes `doGet()` itself "write-capable": technically true, analytically worthless, since the caller controls none of it. The script reports both the bounded figure (94) and the unbounded one (174) so the exclusion is auditable rather than hidden.

**What survives unchanged.** A 28-function spot-check of every function Passes 2 and 5 name *by hand* produced **zero** disagreements with the prose. The findings are confirmed at the function level; only the aggregate was wrong. That is the reassuring half of this correction: the analysis was right, the arithmetic was not.

### 6.3.2 Pass 2's guard breakdown of the client-callable surface — withdrawn, and the reason matters most

Pass 2 §2.2.2 published four categories: *Admin-gated (29), Role-context-gated (4), Record-level only (18), No authorization check (12 of the 63)*. `pass6_client_call_census.js` resolves every `google.script.run` chain and `serverCall('name')` literal in the 51 client files against the 53 server files, using a balanced-paren scanner to walk past `withSuccessHandler`/`withFailureHandler`/`withUserObject` links.

Three problems, in ascending order of importance:

**(a) Arithmetic.** The four labels sum to 29+4+18+12 = 63 — but they are supposed to partition the functions that *resolve*, and 3 of the names do not exist. The breakdown double-counts by exactly 3.

**(b) The tables contradict their own labels.** The role-context table says 4 and lists 5 rows. The no-check table says 12 and lists 13.

**(c) The substantive error.** Pass 2's list of 18 "record-level only" functions was transcribed verbatim into the script and re-classified. **Seven have a record-level check. Eleven have no check at all.**

| Pass 2 called it record-level | Actually |
|---|---|
| `submitReviewAction`, `updateRequestOverview`, `updateRequestClassification`, `getRequestForReview`, `getMyTravelRequests`, `confirmDDTravelers`, `getDDConfirmationData` | Record-level check — correct `[VERIFIED]` |
| `updateRequestItinerary`, `updateTravelersForReview`, `updateCostsForReview`, `updateSharedCostsForReview`, `reportDDFundingIssue`, `submitFundingCorrection`, `submitTravelRequestV2`, `submitTravelFeedback`, `checkNpsEligibility`, `dismissNpsPrompt`, `uploadTravelDraftFile` | **No check of any kind** `[VERIFIED]` |

**The cause is the same mistake in all eleven cases, and it is conceptual rather than clerical.** Each function reads the caller's identity via `Session.getActiveUser()`, and Pass 2 treated that as evidence of a check. It is not. The identity is stamped into a record or an `Approval_Log` row and never compared against anything. Pass 5 §5.3 names the distinction precisely — *identity as evidence vs. identity as permission* — and its findings S-4 and S-17 correct the specific functions.

**Corrected census:**

| Measure | Pass 2 said | Measured |
|---|---|---|
| Distinct server functions the screens invoke | 63 | **64** |
| …resolve to a real server function | 60 | **61** |
| …do not exist | 3 | **3** `[VERIFIED]` |
| Admin-gated (throwing guard) | 29 | **22** |
| Record-level check only | 18 | **8** |
| Calls a role function but may ignore the answer | 4 | **4** `[VERIFIED]` |
| **No check of any kind** | **12** | **27** |

**Pass 2 understates the unguarded screen-invoked surface by more than a factor of two.** Do not cite Pass 2 §2.2.2 anywhere. This is the most consequential correction in Pass 6: it is the difference between "twelve utility reads are open" and "twenty-seven functions including every cost-editing RPC and the submission path are open."

The three non-existent targets are confirmed and unchanged: `apiGetInitialData`, `apiSubmitRequest` (G-013), and `getAllForeignCountries` — the last an inherited TRIP defect whose failure handler resolves to an empty array, so the symptom is an empty dropdown, not an error `[VERIFIED]`.

### 6.3.3 Pass 1's inventory — corrected, but its tables were right

| Figure | Pass 1 prose | Measured | Verdict |
|---|---|---|---|
| Total files (excluding `.git/`, `docs/`) | 230 | **230** | Confirmed `[VERIFIED]` |
| `lets_app/` files | 112 | **113** | Prose wrong |
| Byte-identical to TRIP | 87 | **88** | Prose wrong |
| Modified server files | 5 | **3** | Prose wrong |
| Modified client files | 2 | **2** | Confirmed |
| Modified non-code files | *not stated* | **2** | Prose incomplete |
| LETS-only (new) | 18 | **18** | Confirmed |
| Server `.js` / client `.html` pushed | 53 / 51 | **53 / 51** | Confirmed |

Pass 1's own subtotals sum to 229 against its stated 230 — an internal arithmetic error independent of anything measured.

**The important finding here is reassuring.** Counting the rows of Pass 1's own per-file tables gives 9 + 53 + 51 = **113**, and its status column gives **88 / 7 / 18** — all three matching the filesystem exactly. **Pass 1's evidence is sound; only its prose summaries are wrong.** The inventory does not need re-gathering. Four prose figures need correcting, and `SYSTEM_COMPONENT_MAP.md` should cite the tables, not the summary.

### 6.3.4 Figures that were re-derived and held

Stated explicitly, because a corrections section that lists only failures misrepresents the evidence base:

| Figure | Source | Status |
|---|---|---|
| 459 top-level server functions; 412 browser-reachable; 47 trailing-underscore | Pass 5 | Confirmed by two independent scripts `[VERIFIED]` |
| 118 functions named `_foo` with no privacy effect | Pass 5 | Confirmed `[VERIFIED]` |
| `requireRequestViewer` / `requireRequestEditor`: 0 call sites | Pass 5 | Confirmed `[VERIFIED]` |
| `Validation.js`: 0 adoption; `_isValidEmail`: 21 call sites | Pass 5 | Confirmed `[VERIFIED]` |
| 57 `Session.getActiveUser()` call sites; 31 attribution-only | Pass 5 | Confirmed `[VERIFIED]` |
| 34 CDN references, 0 `integrity=` attributes | Pass 5 | Confirmed `[VERIFIED]` |
| Budget-engine field mismatch fails to zeros, not errors | Pass 3 | Confirmed by `pass3_D7_sheet_shape_mismatch.js` |
| All Pass 4 budget edge cases | Pass 4 | Confirmed by three Pass 4 scripts |

### 6.3.5 One new finding, from Pass 6's own measurement

Layer B is not merely unwired — it is **structurally unreachable**. All four LETS-original modules (`RequestService.js`, `BudgetEngine.js`, `LetsDB.js`, `FASTrackerSync.js`) are wrapped in UMD/IIFE module factories and expose **zero top-level function declarations** `[VERIFIED]`. Apps Script exposes only top-level declarations to `google.script.run`, so none of Layer B is browser-callable at all, and no server function outside those files references them.

This sharpens G-015 and **lowers the practical severity of the entire budget-finding family**. Seventeen findings — G-013, G-023, G-024, G-035, G-036, G-037, G-038, G-039, G-040, G-043, G-050, G-051, G-052, G-053, G-061, G-062, and G-016 itself — describe real defects in code that **cannot currently be invoked by anyone**. They are latent, not live, and they carry reachability **R1** in §6.4 for that reason. The register must say so, because a reader triaging by severity alone would otherwise spend remediation effort on inert code while G-001 through G-006 remain open.

It is also recorded as its own finding, **G-016**, rather than only as a note on G-015, because it changes the remediation order for a third of the register.

It also means the budget module's defects are **cheap to fix now and expensive to fix later** — there is no production data in those tabs to migrate and no user depending on current behavior. That is the single most useful scheduling fact Pass 6 produced.

---

## 6.4 The severity rubric (Pass 6 item 4)

### 6.4.1 Why a rubric is stated before the ranking

Passes 1–5 each assigned severities without writing down what the words meant. Comparing a Pass 3 "High" to a Pass 5 "High" is therefore not meaningful, and the five passes were not consistent: Pass 5 rated a data-disclosure defect Critical while Pass 3 rated a data-corruption defect High, with no stated basis for the difference. A single ranking requires a single rubric, and the rubric must be visible so the reader can disagree with a specific rating rather than distrusting all of them.

### 6.4.2 The two axes

Severity is **consequence × reachability**. Both are needed. A catastrophic defect in code nobody can invoke is not an emergency; a trivial defect reachable by anyone may be.

**Consequence** — the worst credible outcome of one exercise of the defect:

| Level | Meaning |
|---|---|
| **C4** | Unauthorized privilege escalation, or disclosure/alteration of PII, CUI, or financial records across the whole dataset |
| **C3** | Unauthorized alteration or disclosure of a specific record; silent financial misstatement; loss of audit trail |
| **C2** | Incorrect behavior a user would notice, or data corruption requiring manual repair |
| **C1** | Cosmetic, documentation, naming, or dead-code defect with no behavioral effect |

**Reachability** — who can trigger it, as the system stands today:

| Level | Meaning |
|---|---|
| **R4** | Any authenticated domain user, from a browser, with no special knowledge |
| **R3** | Any authenticated user who knows a function or record ID (enumerable or guessable) |
| **R2** | Requires an application role (`admin`, a reviewer role) or spreadsheet edit access |
| **R1** | Not currently invocable — unwired, unreferenced, or structurally unreachable |

### 6.4.3 The matrix

| | **R4** any user | **R3** needs an ID | **R2** needs a role | **R1** not invocable |
|---|---|---|---|---|
| **C4** | **Critical** | **Critical** | High | Medium |
| **C3** | **Critical** | High | Medium | Medium |
| **C2** | High | Medium | Medium | Low |
| **C1** | Low | Low | Low | Informational |

Three deliberate consequences of this matrix, each of which changes at least one rating:

1. **A C4 defect that needs only a guessable ID is still Critical.** `getRequestForReview` requires a request ID, but IDs are sequential `[VERIFIED]`. "Needs an ID" is not a control.
2. **Everything in Layer B drops a band or two** via R1. This is §6.3.5's finding applied consistently rather than as a special case.
3. **Role-gated defects cap at High.** An `admin`-only defect is serious but presupposes a trust decision already made. G-007 (no last-admin protection) sits here.

### 6.4.4 Two modifiers, applied explicitly

**The `USER_DEPLOYING` amplifier.** Pass 5 §5.1.1 found the manifest declares `executeAs: USER_ACCESSING` while six source comments assert `USER_DEPLOYING` `[VERIFIED]`. If production is deployed as `USER_DEPLOYING`, every unguarded function runs with the **deployer's** authority rather than the caller's — so Drive and sheet writes execute as a privileged identity regardless of who calls them. That converts several C3s to C4s. The findings whose rating moves are **G-003, G-005, G-012, G-027** and **G-044** — every one of them an unguarded write to a sheet or to Drive. None is rated below High already, so the amplifier changes no finding's *block*; it changes how the Critical block is justified, from "any user can corrupt data" to "any user can corrupt data using a privileged identity". **VT-01 resolves this and must run before the register is published.**

**The latency discount is refused.** A defect that has probably never been exercised is rated on consequence, not on luck. G-002 (`bootstrapTravelAdmin`) is Critical whether or not anyone has called it. VT-04 exists to determine whether it *has* been, and that is an incident-response question, not a severity question.

---

## 6.5 The consolidated register (Pass 6 items 4 and 5)

68 canonical findings, severity-ranked by the §6.4 rubric. **`C/R`** is consequence/reachability. **`Owner`** is remediation ownership derived mechanically in §6.6 — `TRIP` means the defect lives in code byte-identical to the reference application, `LETS` means LETS-original, `Shared` means LETS modified an inherited file or reproduced an inherited pattern in new code.

This table is the direct input to `GAP_REGISTER.md`. That deliverable adds per-finding evidence citations, remediation detail, and the mutable `Rank` column described in §6.1.2; it must not renumber.

#### Critical — 6 findings · *fix before the system is treated as authorized*

| ID | Finding | C/R | Owner | Pass IDs |
|---|---|---|---|---|
| **G-001** | **412 functions are reachable from any authenticated browser; 51 of them write with no authorization check.** Includes the 118 `_foo` names that look private and are not | C4/R4 | TRIP | R-4, S-19 |
| **G-002** | **`bootstrapTravelAdmin` lets any authenticated user grant themselves `admin`** — writes both rows and clears the role cache so it takes effect at once | C4/R4 | TRIP | S-1 |
| **G-003** | **The review-edit surface has no authorization.** 5 `update*` RPCs plus `reportDDFundingIssue` and `submitFundingCorrection` let any user rewrite itinerary, travellers, costs, `Grand_Total`, status and `Is_Client_Paid` on any request | C3/R4 | TRIP | S-4, S-17 |
| **G-004** | **Request disclosure chain.** `getRequestForReview` returns any request's full record (PII + probable CUI); `getRequestAttachments` yields its file IDs; `shareAttachmentsWithUsers` grants anyone access. IDs are sequential | C4/R3 | TRIP | S-2, S-16 |
| **G-005** | **`deleteTravelDraftFile` trashes any Drive file ID with no ownership check**; `uploadTravelDraftFile` has no size or MIME limit | C3/R3 | TRIP | S-3 |
| **G-006** | **No `oauthScopes` declared.** The effective grant is inferred from API usage and includes full Drive and all spreadsheets. Nobody chose it; it widens silently as code is added | C4/R2 | TRIP | S-13 |

#### High — 17 findings · *fix in the first remediation cycle*

| ID | Finding | C/R | Owner | Pass IDs |
|---|---|---|---|---|
| **G-007** | **No server-side last-admin protection.** `deleteRole` / `setRoleActive` can leave zero admins and lock the console for everyone. The guard exists only in browser JavaScript | C4/R2 | TRIP | S-8 |
| **G-008** | **Two of three site-gate allow-paths are controlled by the HC library, not by LETS.** Access can be gained or lost with no LETS action and no LETS audit entry; the admin console cannot see it. The library is declared in no manifest and failures are swallowed | C4/R2 | TRIP | S-12, R-6 |
| **G-009** | **Authorization changes are audited by overwritable current-state columns.** `deleteRole` leaves no record at all; bulk request deletion records only to Cloud Logging. "Who had admin in March" is unanswerable | C3/R2 | TRIP | S-15 |
| **G-010** | **`verifyPhase7Routing` is unguarded and returns the complete role roster** — every admin, the AAS and FAS primaries and backups, with names and addresses. One call maps the entire authorization structure | C3/R4 | TRIP | S-25 |
| **G-011** | **`?mode=budget` and `?mode=dd-confirm` page-servers have no role gate** beyond the site gate | C3/R4 | Shared | S-20, R-2 |
| **G-012** | **`Request_ID` generation has no lock, so duplicate primary keys are possible; the 5-tab submission has no transaction, so partial failure leaves orphan rows.** Self-documented as deferred | C3/R4 | TRIP | D-4 |
| **G-013** | **Tab-name collision on `Requests`:** 42 TRIP columns vs 20 LETS columns, different ID formats, disjoint status vocabularies, one tab name | C3/R1 | LETS | D-6, M-2 |
| **G-014** | **18 order-dependent sheet access points, 8 of them positional write arrays.** Inserting a column silently corrupts every subsequent write | C3/R2 | TRIP | D-10 |
| **G-015** | **The LETS layer is unwired.** Zero references from any entry point; `apiGetInitialData` and `apiSubmitRequest` do not exist, so the single-page UI cannot load or submit | C2/R4 | LETS | M-3, R-5 |
| **G-016** | **The LETS layer is structurally unreachable, not merely unwired.** All four LETS modules are UMD/IIFE factories exposing zero top-level declarations, and Apps Script exposes only top-level declarations to `google.script.run` | C2/R1 | LETS | Pass 6 |
| **G-017** | **Four broken `include()` targets**, including the `.html.html` names that make `?mode=reviewer-dashboard` throw | C2/R4 | TRIP | R-1, M-4 |
| **G-018** | **An AAS FO reviewer submitting an all-client-paid request is auto-approved with zero review** | C3/R2 | TRIP | R-A1 |
| **G-019** | **`COMPLETED` means "funding confirmed pre-travel", not travel finished.** No post-travel state and no actuals capture anywhere in System A | C3/R2 | TRIP | R-A2 |
| **G-020** | **`initTravelSystemConfig` writes 4 of 7 property keys that nothing reads** — mileage rates set this way are silently ignored | C3/R2 | TRIP | R-A3 |
| **G-021** | **No branch protection; the `CLASPRC_JSON` holder has standing production deploy authority** | C4/R2 | LETS | R-9 |
| **G-022** | **The intake form tells users their request will sync to the FAS tracker. It does not.** | C2/R4 | Shared | R-C4 |
| **G-023** | **FAS decision status is read by substring match, so `"Not Approved"` and `"Disapproved"` both read as approved** | C3/R1 | LETS | D-14, R-C2 |

#### Medium — 33 findings · *schedule — many are latent and cheap to fix now*

| ID | Finding | C/R | Owner | Pass IDs |
|---|---|---|---|---|
| **G-024** | FAS tracker wiring is incomplete: the poller reads decisions and discards them, there is no `FAS_Tracker_Row_ID` column, and no trigger installer | C2/R1 | LETS | R-3 |
| **G-025** | `?mode=budget` is a static mockup — 30 hardcoded figures and a non-functional sync button — presented as live system configuration | C2/R4 | LETS | R-2 |
| **G-026** | `getHCStaffingBundle` returns the full personnel roster with no role check | C3/R4 | TRIP | R-8 |
| **G-027** | **A role-table read can trigger a production write.** `selfHealCurrentUserEmail` patches `Travel_Users.Email` on a cache miss, rebinding a role set to a new address | C3/R4 | TRIP | S-5 |
| **G-028** | Attachment sharing to the next reviewer passes `'viewer'`, which is not a valid Drive role. Three layers of error suppression report success | C2/R2 | TRIP | S-6 |
| **G-029** | `fas_fo_reviewer` has no branch in `getReviewerContext` and resolves to `role: 'none'`, so the FAS reviewer gets no dashboard | C2/R2 | TRIP | S-9 |
| **G-030** | **`requireRole()` silently grants access for any unrecognized role name** — no `default: throw`. A future guard written against a new role name would do nothing | C4/R1 | TRIP | S-10 |
| **G-031** | `aas_fo_reviewer` carries `scope: 'all'` — organisation-wide visibility identical to admin for all filtering. The role name does not advertise this | C3/R2 | TRIP | S-11 |
| **G-032** | **`Is_Active` parsing treats only `false` / `'false'` as inactive.** Blank, `'no'`, `0` and typos all read as active, so a manual spreadsheet revocation may not revoke | C3/R2 | TRIP | S-14 |
| **G-033** | The 12-function `Validation.js` library has zero adoption outside its own self-test | C2/R2 | TRIP | S-18 |
| **G-034** | **No CDN subresource integrity:** 34 external script and style references, zero `integrity=` attributes. A CDN compromise executes arbitrary JavaScript in every session | C4/R1 | Shared | S-24 |
| **G-035** | **`RECONCILED` with blank actuals silently frees the entire commitment** | C3/R1 | LETS | R-B2 |
| **G-036** | **`reconcileRequest` overwrites the approved estimate**, destroying the audit basis for variance | C3/R1 | LETS | R-B3 |
| **G-037** | `LETS-` IDs are count-based: they collide under concurrency, reuse numbers after deletion, and are hardcoded to FY27 | C3/R1 | LETS | R-B5 |
| **G-038** | `updateRequestStatus` has no state machine and no permission check, contrary to its own documentation | C3/R1 | LETS | R-B11 |
| **G-039** | `setAsideType` and the three policy flags are collected and never read. Charging a trip to a specific set-aside pool is a design gap, not a wiring gap | C2/R1 | LETS | R-B12 |
| **G-040** | **The budget engine cannot read its own tabs** — every `BudgetEngine` field name mismatches its `LetsDB` header. Fails to zeros, not errors. The tests bypass the broken path | C3/R1 | LETS | D-7 |
| **G-041** | The `Feedback` tab is written and read but has no schema; nothing creates it; its 13 headers exist nowhere in code | C2/R2 | TRIP | D-1 |
| **G-042** | Four per-diem tabs bypass `SHEET_NAMES` via 6 duplicate constants; renaming through the registry would silently do nothing | C2/R2 | TRIP | D-3 |
| **G-043** | `Travelers` and `Audit_Log` have schemas and no writer anywhere; `RequestService` builds exactly-shaped data it never persists | C2/R1 | LETS | D-8 |
| **G-044** | `reportDDFundingIssue` adds 3 undocumented columns to `Requests` at runtime; two of the three use inconsistent column arithmetic | C2/R4 | TRIP | D-9 |
| **G-045** | No data validation, named ranges, or sheet protections are created anywhere | C2/R2 | TRIP | D-11 |
| **G-046** | **Four design documents referenced by code exist in no commit:** `Data_Model_v2.md`, `BUGS_FOUND.md`, `OPEN_QUESTIONS.md`, `REFACTOR_PLAN.md` | C2/R2 | TRIP | D-12 |
| **G-047** | **The brief's "Stage 1 persistence schema" (`LETS_SYSTEM_*`) exists nowhere in the repository or its history** | C2/R1 | LETS | M-1 |
| **G-048** | **An undocumented third Apps Script project is wired to the repository root** via an untracked `.clasp.json` | C3/R2 | LETS | M-5 |
| **G-049** | `'FY Quarter'` labels calendar quarters, not fiscal ones; duplicate implementations in two files | C2/R2 | TRIP | R-A4 |
| **G-050** | The gatekeeper self-exclusion filter erases all commitments sharing a blank `requestId` — $130,000 in the observed test | C3/R1 | LETS | R-B4 |
| **G-051** | **No input validation on cost** — a negative estimate increases the apparent budget | C2/R1 | LETS | R-B7 |
| **G-052** | The `Set_Asides.Active` column is never read, so deactivation has no effect | C2/R1 | LETS | R-B8 |
| **G-053** | Proportional shares are never recomputed; they go stale after a mid-year rebaseline | C2/R1 | LETS | R-B9 |
| **G-054** | The Tier-1 purpose list exists in three independent places — config, client array, and `<option>` markup | C2/R2 | Shared | R-C1 |
| **G-055** | Tier thresholds ($10k IMM, $7k training) are user-declared, never computed from cost | C2/R2 | Shared | R-C3 |
| **G-056** | **Six real named GSA employees' addresses are embedded in routing-test fixtures with their role assignments labelled** | C2/R2 | TRIP | S-23 |

#### Low — 9 findings · *housekeeping*

| ID | Finding | C/R | Owner | Pass IDs |
|---|---|---|---|---|
| **G-057** | `File_Queue` is declared in the registry and referenced nowhere — a phantom tab | C1/R2 | TRIP | D-2 |
| **G-058** | Two incompatible `Log_ID` formats (`LOG-NNNNNN` and UUID) in one audit column | C1/R2 | TRIP | D-5 |
| **G-059** | `'Edit_SharedCosts'` is written as a literal and is absent from `ACTION_TYPES` | C1/R2 | TRIP | D-13 |
| **G-060** | `DRAFT` status is vestigial — never written; drafts live only in browser IndexedDB | C1/R1 | TRIP | R-A5 |
| **G-061** | An FO is listed against a set-aside it is not charged for; shares still sum correctly | C1/R1 | LETS | R-B1 |
| **G-062** | `isDeficit` is `false` when the balance is exactly $0, so a fully exhausted budget raises no flag | C1/R1 | LETS | R-B10 |
| **G-063** | **Eight placeholder approver addresses** (`<office>.director@gsa.gov`) are live config defaults, three rendered on the budget dashboard as real configuration | C1/R4 | LETS | S-21 |
| **G-064** | The Gmail v1 advanced service is declared and never used — `Gmail.` appears nowhere | C1/R2 | TRIP | S-22 |
| **G-065** | A hardcoded Drive folder ID in `Database.js:27` is written to a dead property key | C1/R2 | TRIP | R-D1 |

#### Informational — 1 finding · *noted, no action implied*

| ID | Finding | C/R | Owner | Pass IDs |
|---|---|---|---|---|
| **G-066** | No simple triggers exist at all, so there is no spreadsheet custom menu — contrary to convention | C1/R1 | TRIP | R-7 |

#### Constructive — 2 findings · *assets, not defects*

| ID | Finding | C/R | Owner | Pass IDs |
|---|---|---|---|---|
| **G-067** | **`requireRequestViewer` and `requireRequestEditor` are complete, correct, and never called.** Together they close G-003 and G-004 at roughly one line per call site | — | TRIP | S-7 |
| **G-068** | An unknown `owningOffice` fails closed — no crash, no silent pass | — | LETS | R-B6 |

---

## 6.6 Remediation ownership (Pass 6 item 5)

### 6.6.1 Why this column decides scheduling, not blame

A defect in code byte-identical to the TRIP reference is a **pre-existing condition of the foundation LETS was directed to adopt**. A defect in LETS-original code is this project's own work. The distinction is not about fault; it changes four practical things:

1. **Who can authorize the fix.** Changing inherited TRIP code may affect the TRIP application if the two are ever reconciled, and that is a conversation with TRIP's owner.
2. **Whether a fix can be upstreamed** — an inherited fix benefits both systems.
3. **How a finding is presented to an ISSO.** "Inherited from the system we were told to build on" and "introduced by this project" invite different remediation conversations.
4. **Scheduling.** LETS-original defects in unreachable code are the cheapest fixes available (§6.3.5).

### 6.6.2 How it was derived

Not by judgment. `pass6_manifest_recount.js` compares every file under `lets_app/` byte-for-byte against the same relative path under `reference_travel_app/`, then maps each finding to the files it actually lives in. A finding spanning several files takes the **widest** ownership: if any part is LETS-original, LETS owns the fix.

| File state | Count | Meaning |
|---|---|---|
| `INHERITED` | 88 | Byte-identical to TRIP `[VERIFIED]` |
| `MODIFIED` | 7 | Exists in both, contents differ |
| `LETS-ONLY` | 18 | No counterpart in the reference |

Counting only the 104 `server/` + `client/` code files: **87 inherited (84%), 5 modified (5%), 12 LETS-original (12%)**.

### 6.6.3 Three of Pass 5's ownership labels were wrong

All three in the same direction — Pass 5 attributed to LETS what is actually untouched TRIP code:

| Finding | Pass 5 said | Correct | Evidence |
|---|---|---|---|
| **G-006** (S-13, no `oauthScopes`) | "Partly — the manifest is LETS's" | **TRIP** | `lets_app/appsscript.json` is byte-identical to the reference, which also declares no `oauthScopes` `[VERIFIED]` |
| **G-056** (S-23, named GSA employees in fixtures) | "No — LETS-original" | **TRIP** | `Submission.js` is byte-identical; all six addresses are present in the reference at the same lines `[VERIFIED]` |
| **G-010** (S-25, `verifyPhase7Routing` unguarded) | "No — LETS-era file" | **TRIP** | `OrgLookup.js` is byte-identical; the function exists in the reference at `:192` `[VERIFIED]` |

One further correction in the opposite direction:

| Finding | Pass 5 said | Correct | Evidence |
|---|---|---|---|
| **G-034** (S-24, no CDN integrity) | "Yes — inherited" | **Shared** | 21 of the 34 CDN references are in untouched TRIP files, but **13 are in files LETS wrote or modified** `[VERIFIED]`. LETS reproduced the pattern in its own new pages rather than only inheriting it |

G-010 is the most consequential of the four. Pass 5 argued S-25 deserved its own finding partly because it looked like a LETS-era addition; it is in fact an inherited TRIP diagnostic. The finding stands on its own merits — it is still an unguarded function that dumps the entire role roster — but the framing changes, and `GAP_REGISTER.md` must not repeat Pass 5's attribution.

### 6.6.4 The distribution, and what it tells the reader

| Owner | Findings | Share |
|---|---|---|
| **TRIP** — untouched inherited code | 39 | 57% |
| **LETS** — LETS-original | 24 | 35% |
| **Shared** — modified inherited, or inherited pattern reproduced | 5 | 7% |

The split is clean and worth stating plainly in the deliverables, because it is the single most useful orienting fact for a project manager inheriting this system:

> **TRIP owns the unguarded surface. LETS owns its own unfinished features.**

**Every one of the six Critical findings is inherited.** G-001 through G-006 all live in code that is byte-identical to the TRIP reference `[VERIFIED]` — LETS neither wrote nor modified any of it. Conversely, the budget and FAS findings are almost entirely LETS-original, and almost entirely in code that cannot yet be invoked.

Two readings follow, and both belong in `SYSTEM_STATE.md`:

- **The reassuring one.** LETS did not introduce the security gaps. It adopted a working application and built on it as directed.
- **The uncomfortable one.** LETS adopted them *without a security review of what it was adopting*, and the one place LETS did reproduce an inherited pattern by choice — CDN loading with no integrity checking, in new pages — shows the pattern propagating rather than being caught. Eighty-four percent of the code was accepted unexamined. That is the finding behind the findings, and no individual `G-NNN` captures it.

---

## 6.7 The consolidated verification checklist (Pass 6 item 6)

### 6.7.1 What the consolidation did

Passes 2–5 generated 43 verification items, V-1…V-43, in a single sequential namespace — the one thing the passes did manage consistently. They still needed consolidating, because the later passes re-asked earlier questions in sharper form.

| | Count |
|---|---|
| Items generated by Passes 2–5 | 43 |
| Merged into another item | 12 |
| Reclassified as a business-owner decision (§6.8) | 6 |
| **Canonical verification tasks** | **29** |

Twelve items merged away, across the eight groups below. Each group is a case of two or more passes asking one question:

| Merged | Into | Why |
|---|---|---|
| V-1 | **VT-01** (with V-30) | Both ask the deployment's "Execute as" setting; Pass 5 stated the consequence |
| V-3, V-7, V-8 | **VT-02** (with V-43) | Four items asking "who holds privilege above the app's `admin` role" |
| V-2 | **VT-03** (with V-38) | Pass 5 added the specific diagnostic to run and the values to capture |
| V-10 | **VT-06** (with V-13) | Identical question — which schema owns the `Requests` tab |
| V-15, V-16, V-17 | **VT-07** (with V-12) | All four are answered by one look at the live tab list |
| V-23 | **VT-09** (with V-5) | Pass 4's property subset is a subset of Pass 2's "all Script Properties" |
| V-27 | **VT-15** (with V-21) | Both need the exact FAS status strings from column M |
| V-24 | **VT-11** (with V-39) | `verifyPhase7Routing()` reports the FAS-primary vacancy Pass 4 asked about |

Four tasks are Pass 6 additions rather than carry-forwards: **VT-24** (split back out of V-24, because the FAS-primary vacancy is answerable from the role table without running code), **VT-27** and **VT-28** (both implied by findings G-032 and G-065 but never written as tasks by the pass that found them), and **VT-29** (re-run the eight evidence scripts before publishing — they self-report divergence, so this is the cheapest regression check the effort has).

### 6.7.2 The checklist, in execution order

Ordered by unblocking power, then by cost — §6.7.3 explains the ranking. This is the direct input to `HUMAN_VERIFICATION_CHECKLIST.md`.

| ID | Task | Absorbs | Unblocks | Where | Cost |
|---|---|---|---|---|---|
| **VT-01** | **Record the active deployment's "Execute as" and "Who has access" settings**, and the deployed web-app URL | V-1, V-30 | G-001–G-006 severity basis; the whole §6.4.4 amplifier; `DEPLOYMENT_AND_ENVIRONMENTS.md` | Apps Script editor → Deploy → Manage deployments | 2 min |
| **VT-02** | **Record who holds Apps Script project editor access, spreadsheet edit access, and the GitHub `CLASPRC_JSON` secret** | V-3, V-7, V-8, V-43 | G-009, G-021; `ADMINISTRATOR_GUIDE.md` §1.5 — these are privileges 1–3, all above the app's own `admin` role | Project share dialog; Drive share dialog; GitHub → Settings → Secrets | 15 min |
| **VT-03** | **Confirm whether an HC library is attached**, to production and to sandbox — and if so run `_probeHcForUser('<surname>')` and record the distinct `supervisoryStatus` / `occupancyStatus` values | V-2, V-38 | G-008. The site gate compares `supervisoryStatus === '2'` as a **string**; if HC emits a number, two of three allow-paths are already dead | Editor → Libraries; then Run the probe → read Logs | 20 min |
| **VT-04** | **Determine whether `bootstrapTravelAdmin` has ever been called by anyone other than the project owner.** Search Cloud Logging for the function name; check `Travel_User_Roles` for rows with `Granted_By: 'bootstrap'` | V-41 | G-002 incident response. **Do this before remediating** — remediation destroys the evidence | GCP → Logs Explorer, filtered to the script project; plus the role tab | 30 min |
| **VT-05** | **Export `Travel_Users` and `Travel_User_Roles` in full**, every row and column, including the raw `Is_Active` cell values | V-32 | G-007, G-009, G-032; `ADMINISTRATOR_GUIDE.md` §1.4. The only way to answer “who are the admins today” | Open the Sheet → export both tabs | 10 min |
| **VT-06** | **Read row 1 of the tab named `Requests` verbatim** and record the exact header text and column count | V-10, V-13 | G-013 — decides which schema owns the tab, and therefore whether the two data layers have already collided. Also reveals whether G-044's three runtime columns are present | Open the Sheet, read row 1 | 2 min |
| **VT-07** | **List every tab name in the live database** and compare against the 16 in `SHEET_NAMES` plus the 7 in `LETS_CONFIG.sheets`; note which Layer-B tabs exist and whether they hold seed rows | V-12, V-15, V-16, V-17 | G-016, G-040, G-041, G-043, G-055, G-057 — one look settles six findings | Open the Sheet | 5 min |
| **VT-08** | **Read row 1 of `Request_Travelers`, `Request_Legs`, `Traveler_Leg_Costs`, `Approval_Log`, `Travel_Users`, `Travel_User_Roles`** | V-14 | G-014 — confirms the 8 positional write arrays still align. **Any drift here is a live data-corruption bug** | Open the Sheet | 10 min |
| **VT-09** | **Record the current values of all Script Properties** in both projects — including `MILEAGE_RATE_PRIVATE`, `MILEAGE_RATE_GOV`, `other_cost_percentage`, `GSA_PERDIEM_API_KEY`, `travel_email_address` | V-5, V-23 | G-020 (4 of 7 keys are never read, so these may never have been set), G-065; `DEPLOYMENT_AND_ENVIRONMENTS.md` | Project Settings → Script Properties | 10 min |
| **VT-10** | **Record the actual OAuth consent-screen scope list** | V-31 | G-006 — the only way to see the scope set nobody chose | Linked GCP project → OAuth consent; or revoke and re-authorize as a test user | 10 min |
| **VT-11** | **Run `verifyPhase7Routing()` and record the `issues` array** | V-24, V-39 | G-007, G-010, G-029 — one call reports no active admin, no active primary AAS FO, no active primary FAS FO, and BU coverage gaps | Apps Script editor → Run → read Logs | 5 min |
| **VT-12** | **Run `diagnoseTripAccess()` for 3–5 known users** — an admin, a BU reviewer, an HC-only supervisor, and someone who should have no access | V-40 | G-008, G-031 — the only way to enumerate implicit HC-derived access | Editor → edit `TEST_EMAIL` `Access.js:513` → `_diagnoseAccess()`. **The runner must already hold `admin`** — project-editor access is not sufficient | 20 min |
| **VT-13** | **List the Shared Drive's members** (the drive behind `SHARED_DRIVE_FOLDER_ID`) | V-33 | G-004, G-005 — every travel attachment is visible to that membership regardless of LETS role | Drive → the shared drive → Manage members | 5 min |
| **VT-14** | **Test whether attachments actually reach the next reviewer.** Approve a request with an attachment, then sign in as the next-stage reviewer and try to open it | V-34 | G-028 — confirms or refutes the `'viewer'` role defect. Three layers of error suppression report success either way | Two accounts, one live request | 20 min |
| **VT-15** | **In the FAS tracker (test copy first), confirm the tab name is `FAS Travel Exceptions`, record columns A–N, and capture the exact status strings column M uses** | V-21, V-27 | G-023, G-024 — required before the substring match can be fixed correctly. Fixing it against guessed strings would be worse than leaving it | Open a copy of the FAS tracker | 15 min |
| **VT-16** | **Check `Requests` for duplicate `Request_ID` values** | V-19 | G-012 — a direct test for whether the unlocked-ID race has already occurred | Sheet → a `COUNTIF` over the ID column | 5 min |
| **VT-17** | **Check for orphan rows** — child rows whose `Request_ID` has no parent in `Requests` | V-20 | G-012 — a direct test for partial-submission failures | Sheet → `MATCH` across the five child tabs | 15 min |
| **VT-18** | **Inventory the installed triggers with handler and owner — run `_checkAllTriggersHealth()` as *each* project editor** | V-4 | G-066; `ADMINISTRATOR_GUIDE.md` §1.6. Triggers are per-user invisible, so a departed owner's triggers fail silently and no single account can see them all | Editor → Run, repeated per editor account | 15 min |
| **VT-19** | **Confirm the sender address production actually uses.** Read the `travel_email_address` property and check whether a send-as alias exists on the executing account | V-42 | Two different hardcoded defaults exist. With no alias, mail silently falls back to `MailApp` and arrives from a different address | Script Properties; Gmail settings of the executing account | 10 min |
| **VT-20** | **Does `?mode=reviewer-dashboard` throw in the live project** — are the `.html.html` names present there too? | V-6 | G-017 — decides whether the rename is a safe fix or whether that dashboard has never worked in production | Open the URL | 2 min |
| **VT-21** | **Identify the sandbox (`1PLzwA_Tin…`) and root (`181ocqi16Ruz…`) Apps Script projects and determine whether they should exist** | V-9 | G-048; `DEPLOYMENT_AND_ENVIRONMENTS.md`. Two undocumented live projects, one wired to the repository root | Apps Script dashboard | 20 min |
| **VT-22** | **Does the prototype sheet `1bsMXl2F4D…` exist, and what are its tab names and header rows?** | V-11 | G-047 — the only available route to recovering the unversioned `LETS_SYSTEM_*` schema the brief refers to | Open the sheet; export headers | 15 min |
| **VT-23** | **Does the `Requests` tab contain rows with `LETS-20NN-NNN` IDs or Layer-B status strings?** | V-22 | G-013, G-037 — would prove the two layers have already been pointed at one sheet | Sheet → filter the ID and status columns | 5 min |
| **VT-24** | **Confirm whether the `fas_fo_reviewer` role has an active primary assigned** | — (from V-24, kept separate) | G-029 — if vacant, overhead requests cascade to FAS with an empty reviewer address and strand | The admin console, or `Travel_User_Roles` | 5 min |
| **VT-25** | **Are there any data-validation dropdowns, named ranges, or protected ranges on any tab?** | V-18 | G-045 — code creates none, so anything found is an undocumented control | Sheet → Data → Named ranges / Protected sheets | 10 min |
| **VT-26** | **Targeted XSS review of `travelRequestTravelers.html` and `travelReviewController.html`** — every template-literal interpolation that renders a name, justification, or comment | V-35 | Pass 5 flagged this as the one security question its static pass could not close | Code review, two files | 2 h |
| **VT-27** | **Record the exact `Is_Active` cell values** found in VT-05's export — blank, `'no'`, `0`, `FALSE`, typos | — (derived from V-32) | G-032 — only `false`/`'false'` read as inactive, so a manual revocation may silently not have revoked | From VT-05's export | 5 min |
| **VT-28** | **Confirm the three Drive folder IDs resolve, and record their sharing settings** — including the hardcoded `1BVAqc5GM6L5LAE85kW94uGHLNwIAa3e` | — (from R-D1 / G-065) | G-065; the asset inventory in `SYSTEM_COMPONENT_MAP.md` | Drive | 10 min |
| **VT-29** | **Re-run all eight evidence scripts and confirm they still reconcile** before the deliverables are published | — (Pass 6 addition) | Every counted claim in all ten deliverables. The scripts self-report divergence from the prose, so this is the cheapest regression check available | `cd docs/evidence && for f in *.js; do node $f; done` | 5 min |

Total estimated effort: **under six hours**, of which VT-26 (the XSS review) is two. Twenty of the 29 tasks take fifteen minutes or less, and eleven are a single look at a spreadsheet or a settings page.

### 6.7.3 The five tasks that unblock the most (Pass 6 item 7)

Ranking criterion, stated so it can be argued with: **how many findings cannot be correctly rated, documented, or remediated until this task is done** — weighted by the severity of those findings, and discounted by the task's cost.

| Rank | Task | Unblocks | Cost | Why it leads |
|---|---|---|---|---|
| **1** | **VT-01** — the "Execute as" setting | All 6 Criticals, plus the §6.4.4 amplifier across G-003, G-005, G-012, G-027, G-044 | **2 min** | The single highest-value item in the entire effort. Two minutes in a settings dialog determines whether every unguarded write executes with the caller's authority or with a privileged identity. No Critical finding can be finally rated until it is answered, and the codebase contradicts itself on the point in six places |
| **2** | **VT-07** — the live tab list | G-016, G-040, G-041, G-043, G-055, G-057 — six findings | **5 min** | Settles whether Layer B's tabs were ever created. If they were not, §6.3.5's latency conclusion is confirmed and seventeen findings are formally inert. If they were, several Medium findings become live and must be re-rated upward |
| **3** | **VT-05 + VT-11** — the role export and the routing check | G-007, G-009, G-010, G-029, G-031, G-032 | **15 min** | Together these answer "who actually holds authority in this system today" — the question `ADMINISTRATOR_GUIDE.md` exists to answer and which no file in the repository can. VT-11 is one function call that reports four distinct coverage gaps |
| **4** | **VT-03** — the HC library and its emitted values | G-008, and by extension the site gate itself | **20 min** | If no HC library is attached, access silently denies for everyone outside the explicit role table. If one is attached but emits numbers where the gate compares strings, two of three allow-paths are already dead and nobody would know. Both outcomes change the access model as documented |
| **5** | **VT-06 + VT-08** — row 1 of the seven core tabs | G-013, G-014, G-044 — including the live data-corruption risk | **12 min** | G-014's 8 positional write arrays are correct only while the column order holds. This is the only task that can detect silent, ongoing data corruption, and it is twelve minutes of reading header rows |

**What is deliberately not in the top five.** VT-04 (has `bootstrapTravelAdmin` been exercised?) is the most urgent *incident-response* task and is not a top-five *unblocking* task — it changes what must be reported, not how anything is rated. It must still run **before** G-002 is remediated, because remediation destroys the evidence. That sequencing constraint is more important than its rank.

---

## 6.8 Decisions only the business owner can make (Pass 6 item 8)

Six items in the V-series were not verification tasks at all. Nobody can resolve them by reading code or opening a spreadsheet, because they ask what the system *should* do. Mixing them into the verification checklist would have stalled it — a checklist that cannot be completed stops being used.

| ID | Decision | From | Blocks | Why only the owner can answer |
|---|---|---|---|---|
| **BD-1** | **Is the deployment supposed to run as `USER_ACCESSING` or `USER_DEPLOYING`?** | — (Pass 6 addition) | G-001–G-006 | VT-01 reports what it *is*. Only the owner can say what it should be. The answer changes whether every unguarded write executes with the caller's authority or a privileged one — and six source comments contradict the manifest, so one of the two is a latent misunderstanding in the codebase either way |
| **BD-2** | **Should `aas_fo_reviewer` see every request in the organisation?** | V-36 | G-031 | The role carries `scope: 'all'` today — admin-equivalent data visibility under a name that does not advertise it. This is a policy question, not a defect, until the owner answers it |
| **BD-3** | **In a `NEEDS_INFO_*` state, should the assigned reviewer retain edit access?** | V-37 | G-003, G-067 | Gates adoption of `requireRequestEditor`, which would remove that access. The cheapest fix for a Critical finding is blocked on this one answer |
| **BD-4** | **Which cost figure is authoritative for budget purposes — System A's `Grand_Total`, or a user-entered estimate?** | V-28 | G-035, G-036, G-040 | The largest unresolved design question in the system. Every budget-integration decision depends on it, and the two layers currently assume different answers |
| **BD-5** | **Who owns the `Requests` tab-name collision decision, and what is the decision?** | V-29 | G-013, G-023 | Gates all budget-integration work. Two schemas claim one tab name; someone must choose, rename, or separate them |
| **BD-6** | **Is FO-reviewer self-approval on client-paid travel intended policy?** And should tier thresholds be enforced from computed cost rather than self-declared? | V-25, V-26 | G-018, G-055 | Both are emergent side effects of two rules interacting, not deliberate design. If intended, they should be documented as rules; if not, they are defects |

**Why these are separated, and what the separation costs.** Four of the six (BD-3, BD-4, BD-5, BD-6) block remediation of findings rated Critical or High. Separating them makes the verification checklist completable in an afternoon, but it also means **four findings cannot be closed by engineering effort alone**. `GAP_REGISTER.md` must mark them `BLOCKED ON BD-n` rather than leaving them to look like open engineering work, and `ENHANCEMENT_PLAYBOOK.md` must sequence them after the decision rather than estimating them as if the decision were made.

BD-1 is both: VT-01 answers what the setting *is*, BD-1 answers what it *should be*. Those are different questions and the first does not imply the second.

---

## 6.9 What Pass 6 means for the ten deliverables

Mapping forward, so each deliverable can be written without re-deriving Pass 6.

| Deliverable | What Pass 6 supplies |
|---|---|
| 1. `ADMINISTRATOR_GUIDE.md` | §6.5's Critical and High blocks for §1.4/§1.8; §6.6.4's ownership split for framing; VT-02's privilege ranking — the application's own `admin` role is **fourth** behind project editor, sheet editor, and the CI secret holder |
| 2. `SYSTEM_COMPONENT_MAP.md` | §6.3.3's corrected inventory — **cite Pass 1's tables, not its prose**; §6.3.5's finding that Layer B is structurally unreachable, which changes how the component map must draw the LETS modules |
| 3. `DATA_DICTIONARY.md` | G-013 (the tab collision) as a dedicated section; G-014's 18 order-dependent access points as a hard rule; G-044's three runtime-added columns; G-041, G-055, G-057 |
| 4. `WORKFLOW_AND_BUSINESS_RULES.md` | G-018, G-019, G-023, G-038 as rules that are documented but unenforced; BD-4, BD-5, BD-6 as the three decisions that must precede any workflow change |
| 5. `DEPLOYMENT_AND_ENVIRONMENTS.md` | VT-01, VT-09, VT-21 — all three deployment unknowns; G-021 and G-048 |
| 6. `GAP_REGISTER.md` | **§6.5 verbatim**, plus §6.1.3 as its cross-reference appendix, plus §6.4 as its stated rubric. Must carry a mutable `Rank` column and must not renumber. Must mark the four BD-blocked findings `BLOCKED` |
| 7. `ENHANCEMENT_PLAYBOOK.md` | §6.3.5's scheduling conclusion — the budget module is cheap to fix now and expensive later; G-067's two unused guards as the highest-value constructive fix in the system; the trigger-rename caveat from §6.3.1 |
| 8. `SYSTEM_STATE.md` | §6.6.4's two readings, both of them; §6.3's four corrections, stated as corrections; G-067 and G-068 as the two positive findings |
| 9. `README.md` | §6.1.2's ID scheme, so a reader arriving cold knows what `G-NNN` and `VT-NN` mean before opening anything else |
| 10. `HUMAN_VERIFICATION_CHECKLIST.md` | **§6.7.2 verbatim**, led by §6.7.3's top five, with §6.8's six decisions as a separate section and VT-04's sequencing constraint called out explicitly |

### 6.9.1 Four things the deliverables must not do

Stated as prohibitions because each is a mistake the pass documents would otherwise lead a writer into:

1. **Do not cite Pass 2 §2.2.2's guard breakdown.** It understates the unguarded screen-invoked surface as 12 when it is 27, because it read "reads the caller's identity" as "checks the caller's identity" (§6.3.2). This is the single most misleading number in the evidence base.
2. **Do not cite "64 unguarded write-capable functions."** Use 51 with its scope, or 72 with its scope, never 64 (§6.3.1).
3. **Do not cite Pass 1's prose counts.** Use its tables, which are correct, or `pass6_manifest_recount.js` (§6.3.3).
4. **Do not repeat Pass 5's ownership labels for S-13, S-23, S-24, S-25.** All four were wrong (§6.6.3).

### 6.9.2 The honest limits of this consolidation

- **Severity ratings are provisional until VT-01 runs.** The §6.4.4 amplifier is unresolved, and it affects five findings. Pass 6 rated them on the manifest's declared value and said so; it did not guess.
- **Reachability `R1` rests on a static reading.** §6.3.5 concludes Layer B is unreachable because its modules expose no top-level declarations `[VERIFIED]`. If a future change adds one wrapper function, seventeen findings become live simultaneously. The register should say so where it marks them latent.
- **Consequence ratings for the budget findings assume the tabs hold real data.** VT-07 may show they are empty or absent, in which case several Mediums should drop to Low. They were not pre-discounted on that assumption.
- **No finding here was re-verified against source.** Pass 6 re-derived the *counts* and the *ownership*, mechanically. It took the individual findings on the evidence the earlier passes cited. The 28-function spot-check in `pass6_write_surface_census.js` is the only function-level re-verification, and it passed with zero disagreements — which is grounds for confidence in the findings, not proof of all 68.

---

## 6.10 Pass 6 verification transcript

Every script committed under `docs/evidence/` was run to completion. The three Pass 6 scripts are new; the five earlier ones were re-run to confirm they still reconcile against the current tree.

| Script | Result |
|---|---|
| `pass3_D7_sheet_shape_mismatch.js` | Runs clean — D-7/G-040 confirmed |
| `pass4_budget_engine_baseline.js` | Runs clean |
| `pass4_budget_engine_edge_cases.js` | Runs clean |
| `pass4_request_service_edge_cases.js` | Runs clean |
| `pass5_guard_census.js` | Runs clean — 459/412/47 unchanged |
| **`pass6_write_surface_census.js`** | **New.** 51 / 72 / 94; 0 prose disagreements in the 28-function spot-check; 0 duplicate function names; fixpoint converges in 4 rounds |
| **`pass6_manifest_recount.js`** | **New.** 230 total confirmed; 5 disagreements with Pass 1's prose; Pass 1's tables confirmed correct; 3 Pass 5 ownership labels corrected |
| **`pass6_client_call_census.js`** | **New.** 64/61/3; 6 disagreements with Pass 2's prose, including the 11 misclassified functions |

Project test suites, re-run unchanged: `test_budget_engine.js` **PASS**, `test_fas_tracker_env.js` **PASS**, `test_gas_module_load.js` **PASS**.

Reproduce all of it:

```sh
cd docs/evidence && for f in *.js; do echo "== $f"; node "$f"; done
cd ../../lets_app && for f in test_*.js; do echo "== $f"; node "$f"; done
```

---

*End of Pass 6. The evidence base is complete: 68 canonical findings, 29 verification tasks, 6 business-owner decisions, eight reproducible scripts, and four corrected figures. Next: the ten deliverables, in strict order 1–9 with the verification checklist last, beginning with `ADMINISTRATOR_GUIDE.md`.*
