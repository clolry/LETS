# Handoff: Go.gov reconciliation

For Ozel. Everything needed to pick up the reconciliation thread.

Read this, then `lets_app/server/30_services/GogovSync.js` top to bottom — its
header comment carries the reasoning for every design decision and is the
single most useful thing in the thread.

## 0. Before you branch

**Do not continue `0zelKirkland-patch-1`.** It is already merged into `main`,
and `main` has moved **8 commits** past it. A diff from `main` to that branch
shows **2,037 deletions** — reviving it would delete `CityPairs.js`,
`CityPairSync.js`, their two test suites, the CODEOWNERS file, 65 lines of
`verify.yml` and most of the README. Those are not changes you made; they are
the branch being old.

Start clean:

```sh
git fetch origin
git switch -c feat/gogov-reconcile origin/sandbox
```

**Branch from `sandbox`, not `main`.** `sandbox` is 47 commits ahead and is
where all of the reconciliation groundwork lives — `GogovSync.js` does not
exist on `main` at all.


---

## 1. What the feature is for

@clolry: *"I'll be pulling reports from Go.gov and will need to use those as
input sources for a monthly financial reconciliation process."*

Two Go.gov exports, two different lifetimes:

| | frequency | purpose |
|---|---|---|
| **Travel requests** | a few times, during catch-up | get the existing pipeline into LETS |
| **Expense reports** | **monthly, indefinitely** | reconcile estimates against what GSA actually paid |

A reconciled request shows what was estimated at approval and what was paid
after the voucher, per trip, attributed to the right DAC and the right fiscal
year.

---

## 2. What is already built

| file | lines | state |
|---|---|---|
| `server/30_services/GogovSync.js` | 667 | **complete** — parser, mapper, matcher. Pure functions, no I/O |
| `server/40_domain/BudgetBackfill.js` | 677 | **complete** — writes travel as already-approved requests |
| `test_gogov_sync.js` | 684 | 136 assertions, 10 sections |
| `test_budget_backfill.js` | 560 | 89 assertions, 9 sections |

Schemas are in place and already deployed — **do not redefine them**:

`Expense_Imports`, 24 columns:

```
Import_ID | Import_Batch_ID | Report_Name | Employee_Name
Employee_Name_Normalized | Gogov_Employee_ID | Report_Total
Amount_Approved | Disallowed_Amount | Report_End_Date | Submit_Date
Fiscal_Year | Extracted_LETS_ID | Matched_Request_ID | Match_Method
Match_Status | Match_Candidates | Match_Confirmed_By | Match_Confirmed_At
Office_Code | Org_Code | Notes | Created_At | Created_By
```

Twelve reconciliation columns appended to `Requests`:

```
Gogov_Request_ID | Gogov_Report_Name | Actual_Total | Actual_Source
Actual_Posted_At | Actual_Posted_By | Reconciliation_Status
Reconciliation_Notes | Match_Method | Match_Confirmed_By
Expense_Report_Name | Expense_Report_End_Date
```

`Actual_Source`, `Match_Confirmed_By` and `Actual_Posted_By` exist so that a
disputed number can be traced to the import batch and the person who accepted
it. Fill them — a reconciliation nobody can audit gets re-done by hand.

**Nothing is user-reachable.** `GogovSync` has no browser entry points at all —
that is the work.

### The exported API

```js
GogovSync.proposeMapping(headers, 'request'|'expense')
  -> { mapping, unmapped, missing }

GogovSync.parseRequestRows(rows, mapping)   -> normalized request records
GogovSync.parseExpenseRows(rows, mapping)   -> normalized expense records

GogovSync.matchExpense(expense, requests)
  -> { status, requestId, method, candidates, note }

GogovSync.matchBatch(expenses, requests)
  -> { results, summary }      // summary carries the adoption + FY figures

// helpers, exported for tests but useful directly
extractLetsId, normalizeName, normalizeTitle, toDateString, fiscalYearOf
```

The parsed record shapes, so you can build the UI against them without
re-deriving anything:

```
request: rowIndex gogovRequestId tripName extractedLetsId employeeName
         employeeNameNormalized amount startDate endDate purpose submitDate
         status fiscalYear

expense: rowIndex reportName extractedLetsId employeeName
         employeeNameNormalized gogovEmployeeId reportTotal amountApproved
         disallowedAmount reportEndDate submitDate status fiscalYear
```

`matchBatch().summary` carries: `total autoMatched needsReview unmatched
totalApproved totalDisallowed letsIdPresent letsIdAdoptionPct byFiscalYear`.

### BudgetBackfill's API

```js
BudgetBackfill.saveBackfill(entries, options)   // writes the rows
BudgetBackfill.validateEntry(entry)
BudgetBackfill.findPossibleDuplicates(entry)
BudgetBackfill.statusFor(entry)                 // derived from the dates
BudgetBackfill.fiscalYearOf(date)
BudgetBackfill.officeForOrgCode(code)
```

Two browser entry points already exist and are **admin-gated**:
`importExistingTravel(entries, options)` and `validateExistingTravel(entries)`.

---

## 3. What is left to build

In the order I would do it.

### 3.1 Mapping UI — upload, confirm columns, remember

@clolry chose a mapping screen over a hardcoded parser, so Go.gov renaming a
column costs a remap rather than a code change.

`proposeMapping` already guesses from the real headers and reports what it
could not map. The screen needs to show the guess, let it be corrected, and
store the confirmed mapping for next month.

It returns three things and **all three matter to the UI**: `mapping` (the
guess), `missing` (fields it could not find — a renamed money column shows up
here), and `unmapped` (file columns nothing claimed, 10 of them on the real
expense export, including the useless `Org Level 3`). Surfacing `unmapped` is
how a human notices that a column which used to matter has been renamed, which
is quieter and worse than a column disappearing.

> **The one mapping that must never be wrong:** the actual cost maps to
> **`Amount Approved`**, never `Report Total`. See §5.1.

### 3.2 Expense importer + review queue

Write every parsed row to `Expense_Imports`, run `matchBatch`, then present
the **55% that need a human** (119 review + 169 unmatched of 522). Three
outcomes per row: confirm the proposed match, pick a different request, or
park it.

Confirming writes `Actual_Total` back to the matched request.

A parked row must stay in `Expense_Imports` with its status — the monthly
total has to reconcile to the file, and a row that silently disappears makes
that impossible to check.

### 3.3 Request importer

565 Go.gov requests as `BACKFILL:` rows carrying `Gogov_Request_ID`.
`BudgetBackfill.saveBackfill` already does the writing — this is a parse,
filter and call.

What `saveBackfill` already guarantees, per `test_budget_backfill.js`: admin
only; **nothing is routed and nothing is emailed** (importing 565 historical
trips must not fire 565 approval emails); status is derived from the dates;
every row is marked as backfilled; and `findPossibleDuplicates` guards
against double counting when a month is imported twice.

### 3.4 Learned Employee ID crosswalk

The expense export has a `Employee ID` (`76E00049503`) that does not match
LETS's format. It is stable and unique per person, so each confirmed match
should store the pairing. **24% of travellers appear more than once** across
the sample (94 of 391), so month one is laborious and month six is nearly
free.

---

## 4. The data, measured

Everything below was measured by running the real code over @clolry's actual
exports. Not estimated.

```
requests parsed : 565
expenses parsed : 522

AUTO_MATCHED    : 234 (44.8%)   name-title 230, name-date 4
NEEDS_REVIEW    : 119 (22.8%)
UNMATCHED       : 169 (32.4%)

approved total  : $807,342.03
disallowed      : $14,029.28
LETS ID adoption: 3/522 (0.6%)
fiscal years    : FY2026 $537,451.15   FY2027 $269,890.88
```

**The 32% unmatched are overwhelmingly other offices' people.** 522 expense
rows cover **391 distinct travellers**; @clolry's org is roughly 30 a month.

Restricting the batch to travellers who also appear in the request export —
a proxy for the real ASD roster filter — drops 33% of the rows and gives:

```
kept 352 of 522
AUTO_MATCHED : 234 (66.5%)
NEEDS_REVIEW : 118 (33.5%)
UNMATCHED    :   0 (0.0%)
```

Same matcher, same 234 auto-matches. **The unmatched bucket empties
completely** — it was never a matcher weakness, it was out-of-org rows with
nothing to match against. The real filter needs the HR roster, which is
@clolry's thread, so expect these numbers to improve without you touching the
matcher.

---

## 5. Six traps in the source data

Each cost real time to find. Each is load-bearing.

### 5.1 `Report Total` ≠ `Amount Approved`

Differs on **112 of 522** rows (21%). `Report Total` is what the
traveller **claimed**; `Amount Approved` is what GSA **paid**.

```
CAMERON, CHERYL T.   claimed 3,618.80   approved 3,133.97   disallowed 484.83
```

Reconciling against `Report Total` overstates spend on a fifth of all rows,
and every row still looks plausible. @clolry: *"we need to use Amount Approved
rather than Report Total."*

`Disallowed_Amount` is stored because nobody asks for it until a traveller
disputes a voucher, and then it is the only number that matters.

### 5.2 One monthly export spans TWO fiscal years

`FY2026 $537,451.15` and `FY2027 $269,890.88` in one file.

@clolry, repeatedly: *"our fiscal year is 10/1 through 9/30 so budgeting all
resets on 10/1."* Every row is bucketed on its own date. **A cross-year import
must be refused, not silently charged to the wrong year.**

Requests bucket on **start date** (when the money is committed); expenses on
**report end date** (when the travel finished).

### 5.3 Two date encodings in one file set

`Report End Date` is **text** `YYYY-MM-DD`. `Submit Date` and the request
`Start`/`End` dates are **Excel serials**. A parser assuming either alone
silently yields 1970 for half the data. `toDateString` handles both plus
`Date` objects, and rejects serials below 20000 as typos rather than 1954.

### 5.4 Names are in two incompatible formats, and inconsistently cased

```
expense export:  'Dolezal, Nathan K.'    214 of 522 rows ALL CAPS
request export:  'Jakenberg Almuete'
```

`normalizeName` reduces both to `FIRST LAST` uppercased. The middle initial is
dropped because only one side has it — which is exactly why a name match
**proposes** rather than decides.

### 5.5 The expense export carries NO request ID

I searched every cell of all 522 rows for the Go.gov request codes. **Zero
hits.** `Authorization Requests` is a bare `Y`/`N` (167 Y, 15 N).

So the only automatic link is a LETS ID a traveller typed into the trip name.
Hence the SOP in §7.

### 5.6 Go.gov's org columns are useless

`Org Level 3` is `F` for **every row**; levels 4 and 5 are empty. DAC
attribution must come from LETS's own roster, never from the file.

---

## 6. The matcher: tiers, and why it refuses to guess

```
lets-id      a LETS ID in the report name          exact   AUTO
gogov-id     a Go.gov request ID in the name       exact   AUTO
name-title   same traveller + same trip title      1 hit   AUTO
name-date    same traveller + end within 14 days   1 hit   AUTO
ambiguous    several equally plausible                      NEEDS_REVIEW
unmatched    nothing                                        parked, still counted
```

### The defect this caught — read this one

The test asserting *"no auto-match attaches a report to a different
traveller"* **FAILED when first written.**

A cited LETS ID was trusted on its own. Three real expense reports were
auto-matched to requests belonging to other people — **Brandon Maness's
$1,922.96 landed on another traveller's request.**

An explicit ID is the strongest signal available, which is precisely why a
contradiction between it and the traveller name must **stop** the match rather
than be resolved in the ID's favour. One mistyped digit moves money between
people and nothing downstream questions it.

Both ID tiers now verify the traveller. **Do not relax this.**

### Amount cannot break a tie

Of 274 title-matched pairs, only **7 (3%)** have equal amounts. Median
difference $190.57. Actuals differ from estimates by design — that is what
reconciliation measures. So an ambiguous case offers every candidate with its
estimate and a stated reason, and never picks.

### 14 days, not longer

A voucher is filed after the trip, so a lag is normal and the sample shows up
to a fortnight. Widening the window starts matching the *next* trip to the
same place.

---

## 7. The SOP that makes this get easier

Go.gov **truncates a trip name at exactly 40 characters** — measured across
565 real names: 79 are exactly 40, none longer, and the cut lands mid-word.

So the LETS ID goes at the **front**:

```
suffix:  'Executive Team to visit ASD teams in NY '   <- ID truncated away
prefix:  'L27-0001 Executive Team to visit ASD te'    <- ID survives
```

That is also why the request ID was shortened from `REQ-2026-0123` (13 chars)
to `L27-0001` (8). The full form left room for only 32% of real trip titles;
the short form fits 61%.

**The parser is tolerant of input, strict about output.** Three travellers
already do this by hand and each wrote it differently — these are the actual
three rows out of 522:

```
'Denver to Atlanta -REQ-2026-0362'
'DOCPER Workshop (REQ-2026-0282)'
'TRIP Request REQ-2026-0292'
```

All three resolve. `test_gogov_sync.js` §1 also covers an underscore form
(`'REQ-2026-0435_GABLE, ROBERT'`) that does not appear in this export but is
the kind of thing a fourth traveller will invent.

The current `L27-` form is matched **more strictly** than the legacy `REQ-`
one, because `REQ` is distinctive while `L27` is three characters that occur
by accident — against the real titles a loose pattern matched `'Order
L270001-A'` and `'Hotel L27 0001 confirm'`.

Adoption is **0.6%** today. `matchBatch().summary` reports it every month and
names the travellers who did not follow it. **That feedback loop is the
feature** — a convention nobody measures decays.

---

## 8. Running the tests

```sh
node lets_app/test_gogov_sync.js      # 136 assertions with data, 123 without
node lets_app/test_budget_backfill.js #  89 assertions
```

### Expect 123, not 136

Section 8 **of `test_gogov_sync.js`** runs the matcher over the **real export
files**, which are **gitignored**:
@clolry's exports carry ~400 real GSA traveller names and 391 employee IDs
each, and **G-056** already flags six real employees' addresses in test
fixtures as a problem. Adding hundreds more names to git history is not
reversible.

The section **skips cleanly** when they are absent, printing
`SKIP reference exports not available in this checkout`. A passing run with
123 assertions is correct, not a broken checkout.

To enable it, ask @clolry for the two `.xls` exports and convert each to JSON
at the paths the test reads — `/tmp/opencode/req.json` and
`/tmp/opencode/exp.json` (`lets_app/test_gogov_sync.js:432`). The shape is:

```json
{ "headers": ["Name", "Request ID", "Submit Date", ...],
  "rows":    [ { "Name": "...", "Request ID": "...", ... } ] }
```

Rows are **objects keyed by header**, not arrays. Requests have 10 columns and
565 rows; expenses 18 columns and 522 rows. Any converter will do:

```sh
pip install --break-system-packages --target=/tmp/opencode/pylibs xlrd openpyxl
```

Keep them in `/tmp` or anywhere gitignored. **Do not commit them.**

### Run the whole suite, not just these two

```sh
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" >/dev/null || echo "FAIL $f"; done
```

34 suites, all green on `sandbox` today. Add your new suite's filename to
`lets_app/.claspignore` — tests must not be pushed to Apps Script — and a step
to `verify.yml`.

---

## 9. Conventions this repo holds you to

Read `docs/ENHANCEMENT_PLAYBOOK.md` §7.1 and §7.2 first — five rules and five
prohibitions, each of which fails *silently*. The ones that will bite on this
thread specifically:

**Give every new helper a TRAILING underscore.** `function foo_()` is private
to the platform. `function _foo()` is **not** — a leading underscore confers
nothing, and 118 functions in this repo are named that way. Only the trailing
form is enforced by Apps Script. Playbook Rule 3.

**Read sheets BY HEADER NAME.** Eighteen access points are order-dependent and
a column insertion silently misfiles them — **G-014** (Critical, open). Do not
add a nineteenth.

**Writes ARE positional** — eight of those eighteen are positional write
arrays. Build a header-keyed record and map it over the schema. Never
hand-build the array. Playbook §7.2.3.

**Append columns. Never insert, reorder, delete or rename one.** Playbook
Rule 5. This thread adds twelve columns to `Requests` and they went on the
end for exactly this reason.

**Do not run `clasp push` locally, and never from the repo root.** CI deploys.
A root push carries 228 files into an undocumented Apps Script project,
including another organisation's application — **G-048**. Playbook Rule 1.

**If you add a Google API call, read Playbook §7.5.1 first.** The manifest
declares zero `oauthScopes`, so scopes are inferred from the APIs your code
calls — a new service silently widens permissions for every user with no
code-review signal. **G-006** (Critical). Relevant if the mapping UI ever
reads an uploaded file via Drive.

**`node --check` after touching `Sheets.js`.** The PR #16 conflict there was
not safely unionable: `HC_ORGS: 'HC_Orgs'` had no trailing comma, so appending
after it produced invalid JavaScript, and the schema hunk straddled a nested
array and the enclosing object's close. Reading the diff did not catch either.

**Add new tabs at the END** of `SHEET_NAMES` and `TRAVEL_SHEET_SCHEMAS`.
@clolry's HR thread is also adding tabs, and appending at the end keeps the
conflicts trivially resolvable.

**`verify.yml` and `.claspignore` will conflict on every PR.** 44 and 32
commits respectively; every feature appends a test step and an ignore line.
Additive — keep both sides. Not a sign anything is broken.

**Write the negative control before claiming a guard works.** Seven of my
guards passed when they should have failed, every one found by running the
control rather than reading the code. The pattern is always an assertion
against source text that differs trivially from what I pictured — one space
versus four, a comment satisfying a grep, a slice between markers in the wrong
order.

**Every browser-callable function needs an explicit auth check.** Apps Script
exposes all 412 reachable top-level functions to any authenticated browser —
**G-001**. `importExistingTravel` and `validateExistingTravel` are
admin-gated; anything new that writes must be too. Playbook §7.7.1 has the
guard pattern.

---

## 10. Open questions, with my current thinking

**Per-category actuals are not available.** The expense export has two money
columns and no airfare/lodging/M&IE split. @clolry accepted trip-level
actuals. If finer detail is ever needed it has to come from a different Concur
report.

**Two junk dates** in the expense file. Report end dates run `2026-03-13` to
`2027-08-01` — 521 rows in 2026 and exactly one in 2027, well outside the
stated window. They parse cleanly; they should be flagged for a human rather
than dropped, and somebody should ask Go.gov why they are there.

**Name matching drops middle initials**, so two people with the same first and
last name collide. The traveller check turns that into a review item rather
than a wrong match. At ~30 ASD travellers the risk is negligible; across 391
it is a matter of time.

**Should the importer filter to ASD?** It must, eventually — two thirds of the
export is other offices, and §4 shows the filter is what empties the unmatched
bucket. But it needs the HR roster, which is @clolry's thread. Until then,
importing everything and showing the out-of-org rows is honest; silently
dropping them is not.

---

## 11. Where the two threads touch

@clolry is working the HR thread in parallel: the FAS HR sync, Directory email
lookup, and the four `sector director` call sites. The split was chosen so the
file overlap is almost nil.

| | yours | @clolry's |
|---|---|---|
| owns | `GogovSync.js`, `BudgetBackfill.js`, new reconcile controller | `FasHrSync.js`, `DirectoryLookup.js`, `Access.js`, `Users.js` |

Three shared files, in increasing order of danger:

**`verify.yml` and `.claspignore` will conflict on nearly every PR.** 44 and 32
commits respectively; every feature appends a step and an ignore line. The
conflicts are additive — keep both sides. Not a sign anything is broken.

**`Sheets.js` is the one to be careful with.** Both threads add tabs. The PR
#16 conflict there was *not* safely unionable: `HC_ORGS: 'HC_Orgs'` had no
trailing comma, so appending after it produced invalid JavaScript, and the
schema hunk straddled a nested array *and* the enclosing object's close.
Reading the diff caught neither; `node --check` caught both. Append at the
**end** of `SHEET_NAMES` and `TRAVEL_SHEET_SCHEMAS`, and run:

```sh
node --check lets_app/server/01_constants/Sheets.js
```

**One dependency runs the other way:** the ASD roster filter in §10 needs
@clolry's HR sync. Build the importer without it — it improves the numbers
later without a matcher change.

---

## 12. Where the reasoning lives

| | |
|---|---|
| `GogovSync.js` header | every design decision, with the measurement behind it |
| `docs/ENHANCEMENT_PLAYBOOK.md` §7.1–7.2 | the five rules and five prohibitions. Read before the first commit |
| `git log --grep="Go.gov"` | the commits, each with a VERIFICATION section |
| `docs/DATA_DICTIONARY.md` §3.5.1b | the backfill state and why it is not a tab |
| `docs/GAP_REGISTER.md` §6.12 | why `BudgetEngine.js` could not be reused |
| `SESSION_STATE.md` | current state and what is waiting on @clolry |

The commit messages are the design record. `git show c0f3451` covers the
matcher; `git show de74314` covers the backfill importer; `git show 6666019`
covers the 40-character truncation and the request-ID shortening.
