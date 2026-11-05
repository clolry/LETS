---
title: "Existing-Travel Import — Deployment Guide"
description: "How to deploy, configure and run the FY27 workbook importer, and how to undo a bad run"
status: canonical
tier: 2
audience: "system owner, administrator running the import"
last_updated: "2026-11-04"
evidence_base: "lets_app/test_travel_import.js — 245 assertions, 23 sections, 6 negative controls"
---

# Existing-Travel Import — Deployment Guide

> **Scope as chosen by @clolry:** FY27 only, ASD employees only. Measured against the real workbook that is **28 travel requests ($46,196.19) and 10 expense reports ($16,863.62)** out of 1,024 and 274 source rows.

---

## §0 Read this first — one thing will surprise someone

**LETS will not agree with Chiquita's variance column, and that is deliberate.**

Her workbook computes `Variance from Travel Request` from **Report Total** — what the traveller claimed. LETS reconciles against **Amount Approved** — what GSA actually paid. Measured across all 20 of her matched rows:

| | |
|---|---|
| Workbook's stated total variance | **−$326.93** |
| Variance on `Amount Approved` | **−$1,491.32** |
| Difference | **$1,164.39** — exactly the disallowed amount |

The $1,164.39 is money GSA did **not** pay, counted in her sheet as though it had. @clolry already ruled on this during the Go.gov work: *"we need to use Amount Approved rather than Report Total."*

**Tell Chiquita before the two diverge in a meeting.** Every import batch records `Variance_Basis: amount-approved` so the question has an answer on the record.

---

## §1 What gets deployed

| File | Change | Lines |
|---|---|---|
| `server/01_constants/Sheets.js` | `Travel_Imports` (42 cols) + `Import_Batches` (27 cols) | +260 |
| `server/30_services/TravelImport.js` | **New.** The engine: mapping, parse, scope, validate, diff, preview | +900 |
| `server/40_domain/TravelImportAdmin.js` | **New.** Writes + 7 admin-guarded entrypoints | +950 |
| `server/40_domain/BudgetDashboard.js` | Prefers a reconciled `Actual_Total` over the estimate; reports the split | +80 |
| `client/pages/travelBudgetDashboardPage.html` | 4-step import wizard, batch history, rollback | +480 |
| `test_travel_import.js` | **New.** 245 assertions | +950 |
| `test_budget_dashboard.js` | §6b — reconciled vs estimated actuals | +65 |
| `.github/workflows/verify.yml` | 1 test step + 5 guards | +180 |

**No existing behaviour is replaced.** `BudgetBackfill.js` (manual entry) and `GogovSync.js` (the matcher) are both reused — `GogovSync` was fully tested and **completely unwired** before this; its `matchExpense` is now called for real.

---

## §2 Deploy

```sh
# 1. Verify locally first. 36 suites, all must pass.
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" || echo "FAIL $f"; done

# 2. Push the code.
cd lets_app && clasp push

# 3. Create the two new tabs. SAFE TO RE-RUN — createOrUpdateSheet is
#    idempotent and setupTravelDatabase iterates the schema registry, so
#    existing tabs keep their data and only have their headers rewritten.
#    Run from the Apps Script editor:
#      setupTravelDatabase()
```

Confirm in the log:

```
created: Travel_Imports (42 columns)
created: Import_Batches (27 columns)
```

> **If `setupTravelDatabase` is not run, the first import fails with a clear message** — `preview` checks for both tabs and returns *"Travel_Imports tab not found. Run the setup."* It does not fail obscurely, but it does fail.

### §2.1 Nothing to configure

No Script Properties are required. The column mapping is stored under `TRAVEL_IMPORT_MAPPING_DEFAULT` the first time an administrator confirms it, and the built-in defaults already match the real workbook's headers — verified by `test_travel_import.js` §21.

---

## §3 Run an import

**Travel → Budget dashboard → Import From Workbook.** The button appears only for a travel administrator; the real guard is on all seven server functions.

| Step | What happens | What is written |
|---|---|---|
| **1 · File** | Pick the `.xlsx`. Parsed **in the browser** — the file never reaches the server, only the mapped rows for the two tabs being imported. Confirm FY and ASD/All. | nothing |
| **2 · Columns** | The server proposes a mapping from the headers. **Check it** — the money columns are the ones that matter. | nothing |
| **3 · Preview** | New / changed / unchanged / conflict / error counts, every in-scope row, and the excluded rows with reasons. | a `PREVIEW` batch + its ledger rows |
| **4 · Commit** | Projects the ledger into `Requests`. | requests, traveller rows, approval log |

**Nothing touches `Requests` until you press Commit.**

### §3.1 What the preview should show on the first FY27 ASD run

```
38 in scope · 38 new · 0 changed · 0 unchanged · 0 conflict · 0 error · $63,059.81
Excluded: 1,173 not an ASD employee · 82 wrong fiscal year · 5 not travel
```

9 of the 10 expense reports auto-match. **One needs review** — Udaya Patnaik's, and it is correct that it does: three of his requests share the same traveller and trip name, so the matcher proposes all three rather than guessing. Pick `4GNF` (ends 2026-10-02, matching the report end date exactly).

### §3.2 Incremental runs

Just run it again. A row whose source ID is already in LETS is an **update**, not a duplicate:

| Preview says | Means |
|---|---|
| `NEW` | no LETS row carries this source ID |
| `UNCHANGED` | same source ID, identical values — nothing written |
| `CHANGED` | same source ID, a value moved — updated in place |
| `CONFLICT` | would overwrite a **verified** actual — refused (§4) |
| `ERROR` | the row failed validation — skipped, logged, the rest still import |

A batch can be committed **once**. Pressing Commit twice is refused.

---

## §4 When a commit is refused

A `CONFLICT` means the import would replace an actual a **human** entered or confirmed. That figure is evidence; a file re-read must not quietly overwrite it.

The preview shows each conflict with the existing and incoming figures and a **reason box**. Type a reason to override; leave it blank to keep the existing figure. Overrides are recorded in the ledger (`Overwrote_Verified`, `Override_Reason`, `Override_By`) and written into `Reconciliation_Notes` on the request.

An actual written by a **previous import** is not verified and is superseded without ceremony — that is what makes re-runs useful.

---

## §5 Undo

**Import From Workbook → History → Roll back.** A reason is required, in the UI and again on the server.

- Requests the batch **created** are deleted
- Requests it **changed** are restored from the recorded before-values
- A request **edited since the import** (`Version` > 1) is **not** deleted — it is reported by name for manual attention

> Rollback deletes rows **bottom-up**. Ascending deletion would shift rows under itself and remove the wrong requests; `test_travel_import.js` §18 proves the order with a pre-existing row interleaved among imported ones.

To correct rather than reverse: fix the workbook and re-run. The source-ID upsert makes it an update.

---

## §6 Running the measured tests locally

`test_travel_import.js` §21 asserts the real figures and **skips** when the workbook fixture is absent, so a fresh checkout passes.

> **The workbook is deliberately not committed.** It carries ~1,900 real GSA traveller names, 823 real email addresses and 274 employee IDs across its lookup tabs. Finding **G-056** already flags six real employees' addresses in test fixtures as a problem; adding these would be a far larger instance, and git history cannot be taken back. A CI guard checks that neither the workbook nor the other reference files are tracked, and that the ignore rules still work — tested by asking `git check-ignore`, not by grepping `.gitignore`.

To enable §21, convert the workbook with the committed script:

```sh
python3 scripts/workbook_to_fixture.py "_Expense Report Calculations File for LETS.xlsx"
# Wrote /tmp/opencode/fy27_workbook.json
#     TravelRequest         1024 rows, 10 columns
#     Expense                274 rows, 20 columns
#     Combined                28 rows, 20 columns
#     OfficeSymbol           823 rows,  3 columns
#     OffSymbolOverride        2 rows,  2 columns

node lets_app/test_travel_import.js   # §21 runs instead of skipping
```

Run it with no argument and it finds the workbook in the repository root.

Three things about that script are deliberate:

- **It writes to `/tmp`, never into the repository.** The output holds the same 1,900 names as the source. The CI guard would catch the workbook itself, but not a JSON file nobody thought to name.
- **It does not convert dates.** Serials are passed through as the raw numbers the spreadsheet holds, because that is exactly what the browser's parser sends (`raw: true`). Formatting them would test a different input than production receives.
- **It uses only the standard library.** An `.xlsx` is a zip of XML; adding `openpyxl` to run one fixture is a poor trade.

§22's six negative controls always run, so the guards are proven able to fail on every push regardless.

---

## §7 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| *"Travel_Imports tab not found"* | setup not run | `setupTravelDatabase()` |
| *"The spreadsheet parser did not load"* | the SheetJS CDN was unreachable | reload; check egress to `cdn.jsdelivr.net` |
| *"This workbook has no TravelRequest tab"* | wrong file, or a tab was renamed | the message lists the tabs it did find |
| Every row is `OUT_OF_SCOPE_ORG` | the `OfficeSymbol` tab is empty or unmapped | check the roster tab has `Full Name` and `Current.Department.ID` |
| A traveller is missing who should be in scope | not in `OfficeSymbol` | add them to `OffSymbolOverride` — those 2 rows are the only reason Cheryl Cameron's travel resolves at all |
| Totals differ from the workbook | §0 — Amount Approved vs Report Total | expected; the gap is the disallowed amount |
| 7 requests duplicate on a re-run | `normalizeSourceId` is broken | a CI guard checks this behaviourally; see §8 |

---

## §8 Why the odd-looking parts are there

Each of these exists because of something **measured in the real file**, not anticipated:

| Looks like | Is actually |
|---|---|
| `normalizeSourceId` stripping `.0` | 7 of 1,024 IDs are all-digit and stored as **numbers**; without it they re-import every run |
| A 5-part composite key for expenses | `(employee, title, end date)` **collides on 2 of 274 rows** — two of Stacy Buechele's reports, $198.60 and $1,602.06, both real |
| The match pool not being FY-filtered | filtering it posts **$1,176.10 against a trip three weeks after** the one it belongs to |
| A string-serial date branch | serials arrive as strings from the browser parser, and `new Date('46356')` is **the year 46356** — a valid-looking date that silently drops the row out of scope |
| A non-travel pattern list | 6 rows are **professional liability insurance**, one in scope; they would become phantom zero-date trips |
| Exclusions stored, not filtered | the scope discards **97%** of the file, and a silent 97% drop is indistinguishable from a broken importer |

---

## §9 Known gaps

1. **Not verified in a browser.** Every assertion passes and the wizard is wired, but no live import has been run. First run should be a preview on a copy of the Travel DB.
2. **`GogovSync.toDateString` still mis-parses a string serial** — `'46356'` → `'46356-01-01'`. `TravelImport.toDateString` resolves it before delegating, so this importer is safe, but the monthly reconciliation path shares that function. Tracked separately; widening it touches behaviour pinned by `test_gogov_sync.js` §3.
3. **One traveller needs manual matching each run** (Patnaik). Correct behaviour, not a defect — but it will recur until a LETS ID appears in the trip name.
4. **`docs/evidence/verify_city_dropdown_fix.js` fails** at `e60ac64`, before this work. Not in CI. Unrelated, and worth a look.
5. **The `.claspignore` glob still fails an existing CI guard.** `test_*.js` is not a filename; one line to delete.
