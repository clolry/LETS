# Task 2 — Importing existing travel, and verifying the budget numbers

Pick this up after Task 1. It shares `BudgetBackfill.js` with Task 1 §3.3,
which is why both tasks belong to the same person.

Read [`README.md`](README.md) first for the branch situation and the repo
conventions. Then read
`lets_app/server/40_domain/BudgetBackfill.js` and
`lets_app/server/40_domain/BudgetDashboard.js` — both header comments carry
the reasoning, including why an obvious-looking shortcut was rejected.

---

## 1. What the feature is for

@clolry, verbatim:

> "Our fiscal year began October 1st so we have some travel (not a ton, but
> some) that is planned or already occurred and I want to get it reported in
> the system so that we can ensure proper budgeting and reconciliation. Can
> you please create a way that I can input the existing travel?"

And separately, on the budget figures:

> "If the budget numbers are gone then we need a user interface where each year
> (or even mid-year if budgets change) we can update the numbers for our
> overall group and each subgroup (FCA, FCB, FCC) — this would be an admin
> function and not be open to reviewers."

So the task has two halves that only make sense together:

1. **Get pre-existing travel into the system** without firing the approval
   workflow at trips that already happened.
2. **Prove the resulting budget figures are right**, because the whole point
   of entering the travel is that the DAC balances become trustworthy.

Half 2 is the part that is genuinely unfinished, and it is the harder one.

---

## 2. Why the intake form cannot do this

Submitting a trip through the normal form starts the approval workflow: it
emails a reviewer, routes to a BU reviewer, and creates a pending item on
somebody's dashboard. For a trip that happened in October, every one of those
is wrong. A reviewer asked to approve completed travel will reasonably
conclude the system is broken.

So backfill is a separate path with a different shape:

| | intake form | backfill |
|---|---|---|
| status | `PENDING_SECTOR` | `COMPLETED` or `APPROVED_GOGOV` |
| email | notifies the reviewer | **sends nothing** |
| routing | routes for approval | routes nowhere |
| cost | full category breakdown | a total, because that is what exists |
| who | any user | **admin only** |

### Why admin only

This writes a request that is `APPROVED` without anyone having approved it,
and the figure counts against a DAC's balance immediately. That is reasonable
for an administrator reconciling a fiscal year. It is not something to leave
open — a user who could backfill their own completed travel could consume
budget without review.

Note the asymmetry, which is deliberate. @clolry: *"no secrets to hide there —
we're trying to develop transparency."* **Reading** budget figures is open to
everyone. **Writing** a request that spends money is not the same act.

### Every backfilled row is marked

Backfilled requests carry `Primary_Justification` prefixed `BACKFILL:` and an
`Approval_Log` entry naming the administrator, with `Action` set to
`BACKFILL_IMPORT` and a comment that says outright that no review happened.

A figure that entered the budget without passing through review must be
identifiable afterward, or the audit trail quietly implies an approval that
never happened. The log is what someone reads to ask "who approved this", and
the honest answer is nobody.

---

## 3. What is already built

| file | lines | state |
|---|---|---|
| `server/40_domain/BudgetBackfill.js` | 677 | **complete** — validation, duplicate detection, atomic write |
| `server/40_domain/BudgetDashboard.js` | 441 | **complete** — live KPIs, attribution, honest metadata |
| `server/40_domain/BudgetAdmin.js` | 603 | **complete** — append-only versioned allocations |
| `client/pages/travelBudgetDashboardPage.html` | — | Import modal **exists and is wired** |
| `test_budget_backfill.js` | 560 | 89 assertions, 9 sections |
| `test_budget_dashboard.js` | 445 | 63 assertions, 8 sections |
| `test_budget_admin.js` | 464 | 68 assertions, 8 sections |

### The API

```js
BudgetBackfill.saveBackfill(entries, options)   // writes; atomic across entries
BudgetBackfill.validateEntry(entry, options)    // returns problems, never throws
BudgetBackfill.findPossibleDuplicates(entry, existing)
BudgetBackfill.existingRequests(db)
BudgetBackfill.statusFor(endDate, now)          // DERIVED, not asked for
BudgetBackfill.fiscalYearOf(dateStr)
BudgetBackfill.officeForOrgCode(orgCode)
```

Two browser entry points, both **admin-gated**:

```js
importExistingTravel(entries, options)   // options: { fiscalYear, now, allowDuplicates }
validateExistingTravel(entries)
```

The import modal already calls `importExistingTravel` from
`travelBudgetDashboardPage.html:1288`. **The entry path works.** What is not
proven is that the numbers it produces are correct.

---

## 4. What is left to build

### 4.1 Prove the budget arithmetic end to end — the actual task

This is the part @clolry asked for and the part nobody has done. Everything
below it is secondary.

Right now each layer is unit-tested in isolation and **nothing tests the
join**. There is no test that imports travel and then asserts the dashboard
moves by the right amount, in the right DAC, in the right fiscal year.

Write that test. The shape:

```
1. start from a known allocation set
2. import a trip with a known cost, office and date
3. read the dashboard
4. assert: that DAC's `committed` or `completed` rose by exactly that cost
           `available` fell by exactly that cost
           no other DAC moved
           the total moved by the same amount
           the fiscal year is the one the dates imply
```

Then the cases that actually break:

- **a trip spanning 30 September / 1 October** — which year does it land in,
  and does the dashboard agree with `fiscalYearOf`?
- **a completed trip and a planned trip of equal cost** — one must land in
  `completed`, the other in `committed`, and `available` must fall by both
- **a trip on a sub-org code six levels deep** (`FCA0BAA`) — it must attribute
  to `OMD`, not vanish
- **a trip on an org code outside the four DACs** — it must appear in
  `meta.unattributed` with its amount and request ID, not be dropped
- **the same trip imported twice** — the second must be held back

### 4.2 A reconciliation view: estimate versus actual

The twelve reconciliation columns exist on `Requests` and Task 1 writes
`Actual_Total` into them. **Nothing reads it yet** — see §6.1, which is the
most important thing in this document.

### 4.3 Edit and delete for imported rows

There is none. A mistyped cost has to be fixed in the spreadsheet by hand,
which bypasses every guard and leaves no log entry. @clolry was asked whether
this matters and has not answered. Worth raising again before building it.

### 4.4 Mid-year adjustments

`BudgetAdmin` already handles this correctly by appending a new allocation row
with a later `Effective_Date`. What does not exist is the **Budget_Adjustments**
concept the dashboard header comment still refers to — see §6.3.

---

## 5. The design decisions, and why they are not negotiable

### 5.1 Status is DERIVED from the dates, never chosen

```js
function statusFor(endDate, now) {
  var today = _dateOnly_(now || new Date());
  if (!endDate) return STATUS_CODES.APPROVED_GOGOV;
  return endDate < today ? STATUS_CODES.COMPLETED : STATUS_CODES.APPROVED_GOGOV;
}
```

**This choice drives the budget arithmetic.** `BudgetDashboard` counts
`COMPLETED` as actual spend and `APPROVED_GOGOV` as a commitment. Letting the
user pick the status would let the same trip land in either bucket depending
on which they chose, and both would look correct.

A trip whose end date has passed is `COMPLETED`. One still ahead is
`APPROVED_GOGOV` — approved and booked, not yet traveled, which is exactly
what @clolry's "planned" travel is.

### 5.2 The fiscal year, and the off-by-one-day that matters

```js
function fiscalYearOf(dateStr) {
  var d = new Date(String(dateStr) + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  var y = d.getFullYear();
  return 'FY' + (d.getMonth() >= 9 ? y + 1 : y);
}
```

October through September. A trip on **2 October 2026 is FY2027 money**, and
getting it wrong by one day attributes the spend to the wrong year's budget.

Note the `T12:00:00`. Parsing a bare `YYYY-MM-DD` in JavaScript gives UTC
midnight, which in a negative timezone offset lands on the previous day — so
a trip starting 1 October could read as 30 September and land in the wrong
fiscal year. **Do not remove it.**

The request-ID prefix uses the **fiscal** year too (`L27-` for FY2027). The
old code used `getFullYear()`, so a trip entered on 15 October 2026 was
numbered `REQ-2026-xxxx` while drawing on FY2027 money, and the sequence reset
on 1 January rather than 1 October.

### 5.3 Validation refuses what cannot be reconciled later

`validateEntry` returns problems rather than throwing, so the UI shows all of
them at once rather than one per round trip. Current rules, each with a reason:

| rule | why |
|---|---|
| trip name required | it is how this appears in reports and how event history groups occurrences |
| start and end required, end not before start | — |
| start date must be in the selected fiscal year | a date outside it is almost always a typo in the year, and it would attribute spend to a budget that is already closed |
| office must be one of `FO`, `OMD`, `IDV`, `CM` | it is the budget the cost counts against |
| cost required, **zero allowed**, not blank | zero-cost travel is real — local and no-cost conferences appear throughout @clolry's FAS tracker data — but it must be *typed*, not reached by leaving the field empty |
| cost not negative, not over $1,000,000 | typo detection |
| traveler count ≥ 1, ≤ 500 | typo detection |
| names optional, but if given the count must agree | @clolry is reconciling a quarter from records that may hold only a headcount; but a request and its traveler rows disagreeing means no report reconciles |

### 5.4 Duplicates are a warning, never a block

@clolry is entering a quarter of travel by hand. The realistic failure is
entering the same trip twice across two sittings, which double-counts against
a DAC's balance.

But **two genuine trips to one event in a month also happen**, so this cannot
refuse. The flow is: detect, report, require explicit `allowDuplicates: true`
to proceed. Blocking would be wrong; silently double-counting would be worse.

Three distinct checks, and the second is the one that is easy to forget:

1. against **existing** requests — same name, same month
2. **within the submission** — the per-entry check cannot see this, because
   neither row exists yet
3. the same `tripName|startDate` twice in one batch is refused outright

### 5.5 The write is atomic across entries

```js
reqSheet.getRange(lastRow + 1, 1, reqRows.length, reqHeaders.length)
  .setValues(reqRows);
```

One `setValues` per sheet, after validating everything. `appendRow` in a loop
is both slow and non-atomic — an execution timeout halfway through would leave
an unknown number of rows behind.

**A partial write is the worst outcome here:** @clolry would have no way to
tell which of fifteen trips landed, and re-running would double-count the ones
that did.

The whole thing is wrapped in `LockService`, and a busy lock refuses rather
than racing.

### 5.6 Request IDs come from one starting point, not per-entry

```js
var nextSeq = _nextRequestSeq_(db, now);
// ... then nextSeq + i per entry
```

`generateRequestId()` reads the sheet to find the highest existing number.
Nothing has been written yet, so **every call in the loop would return the
same ID**. This is the kind of bug that produces a clean-looking import where
fifteen trips share one request ID.

### 5.7 Reviewer fields stay empty, and `Submitted_At` is the travel date

```js
'Current_Reviewer_Name': '',
'Current_Reviewer_Email': '',
'Initial_Review_Level': '',
'Submitted_At': start || now,
```

Naming a reviewer on a request that was never reviewed puts a false approval
in the record, and the reviewer dashboards filter on those fields — a
backfilled row with a reviewer name would appear on somebody's queue.

`Submitted_At` is the date the **travel** was for, not when it was typed in.
Reports group by this, and stamping it `now` would put October travel in
whatever month the import ran. There is a negative control for exactly this
(`test_budget_backfill.js` §9).

### 5.8 Per-traveler costs are an even split, and say so

When names are given, each traveler row gets `total / names.length` and a
`Role_Justification` reading *"Backfilled; per-traveler costs are an even
split of the trip total."*

The real split is not known. Stating the assumption in the record is the
difference between a figure someone can reason about and one that silently
implies precision it does not have.

### 5.9 The cache must be invalidated

```js
[REQUESTS, REQUEST_TRAVELERS, APPROVAL_LOG].forEach(name => db.invalidate(name));
```

The dashboard reads cached sheets. Without this the imported travel is
invisible and the admin concludes the import failed — then imports it again.

---

## 6. Four things worth acting on

Found while preparing this handoff. In descending order of consequence.

### 6.1 `Actual_Total` is written but never read

Task 1 writes `Actual_Total` from Go.gov's `Amount Approved`. The entire
purpose of reconciliation is that the budget then reflects what GSA actually
paid.

**`BudgetDashboard` reads `Grand_Total` — the estimate — and nothing else.**

```
lets_app/server/40_domain/BudgetDashboard.js:218
  var cTotal = col('Grand_Total');
```

A repo-wide search for `Actual_Total` finds four hits: the schema definition,
a blank-string positional write in `Submission.js`, and two lines in
`test_trip_overview.js` asserting the column exists. **No consumer.**

So reconciliation currently has no effect on any number anyone looks at. The
dashboard even says so honestly in its payload:

```js
actualsNote: 'LETS has no post-travel reconciliation step, so completed ' +
             'travel is counted at its approved estimate rather than at ' +
             'a liquidated actual.'
```

That note was accurate when written. Once Task 1 ships it becomes false, and
the dashboard will keep displaying the estimate while a reconciled actual sits
in the next column. The two figures differ by design — that is what
reconciliation measures.

**This is the single most valuable thing in Task 2.** Whether `completed`
should prefer `Actual_Total` when present, or whether the dashboard should
show both and the variance, is a question for @clolry. But as it stands the
reconciliation work has no destination.

### 6.2 The org-code-to-DAC mapping exists three times

```
server/40_domain/Submission.js:238       var LETS_OFFICE_MAP = [...]
server/40_domain/BudgetDashboard.js:229  var ORG_TO_OFFICE = { FC:'FO', FCA:'OMD', ... }
server/40_domain/BudgetBackfill.js:108   var ORG_TO_OFFICE = { FC:'FO', FCA:'OMD', ... }
```

Three independent copies of the same four-pair mapping, with three different
resolution algorithms. @clolry: *"FCA and OMD are two ways to describe the
same thing."*

**I checked whether they disagree.** Against all 137 real org codes from
`HC_REAL_ORGS`, plus adversarial inputs (`FCD`, `FCZ`, lowercase, empty): the
two prefix matchers agree on every single one, and all 137 real codes resolve.
So there is **no live defect** — this is not urgent.

But the `BudgetDashboard` version is fragile in a way the others are not:

```js
if (org.indexOf(k) === 0 && (!office || k.length > (office === 'FO' ? 2 : 3))) {
```

That `office === 'FO' ? 2 : 3` encodes the current code lengths as literals.
`BudgetBackfill.officeForOrgCode` does the same job by tracking the longest
matched prefix, which is correct for any input. If a fifth DAC with a
four-character code is ever added, the backfill version keeps working and the
dashboard version does not.

Worth consolidating onto `officeForOrgCode` when you are in that file anyway.
Not worth a dedicated change.

### 6.3 The dashboard header comment contradicts its own payload

```
BudgetDashboard.js:43   * `adjustmentsAvailable: false` rather than implying the baseline is final.
BudgetDashboard.js:397          adjustmentsAvailable: true,
```

The header comment describes the pre-`BudgetAdmin` state, where allocations
were config literals and mid-year adjustments were impossible. `BudgetAdmin`
shipped and made them possible, the flag flipped to `true`, and the comment
was not updated.

**No test asserts either value** — a grep for `adjustmentsAvailable` across
both budget test suites finds nothing. So the flag can be flipped in either
direction without any suite noticing, which is how it drifted from its own
documentation in the first place.

Fix the comment and add an assertion. Five minutes, and it stops the next
person trusting a comment that is wrong.

### 6.4 `AGENTS.md` is cited ten times and does not exist

```
PROJECT_PLAN.md:129                      "Generates AGENTS.md"
server/00_config/TripConfig.js:25        "AGENTS.md §12.1, §14.5"
server/00_config/BudgetConfig.js:30      "AGENTS.md §12.3"
server/30_services/FASTrackerSync.js:19  "AGENTS.md §4.1, §12.1, §14.5"
.github/workflows/verify.yml             four citations
.github/workflows/deploy-gas.yml         two citations
```

The file has never existed in this repository — `git log --all -- AGENTS.md`
is empty. One of those citations sits directly above a load-bearing
instruction:

```js
// Do not "modernize" this to `const` (AGENTS.md §12.3 — encode the fix so it
// cannot silently regress).
var LETS_CONFIG = {
```

The instruction is real and there is a CI guard enforcing it. The citation
points at nothing. The conventions actually live in
`docs/ENHANCEMENT_PLAYBOOK.md` §7.1–7.2.

Not a defect in behavior, but it will cost whoever follows the reference the
same time it cost me.

---

## 7. The numbers the dashboard must reproduce

From `BudgetConfig.js`, asserted in `test_budget_dashboard.js` §2:

```
FO     $4,000     Front Office / AC   (not a DAC)
OMD  $152,000     DAC                 share 0.153
IDV  $659,000     DAC                 share 0.664
CM   $182,000     DAC                 share 0.183
                  ----------
total $997,000
```

The three DAC shares sum to **1.000**, and each matches its actual proportion
of the DAC total to four decimal places (`0.1531`, `0.6636`, `0.1833`). That
is a useful invariant: if a share and a baseline ever disagree, one of them
was edited without the other.

Five standing set-asides totalling **$108,500** — $15,060 OMD, $25,280 IDV,
$68,160 CM, and none on the Front Office. The shared $20,000 line splits
across the three DACs by their proportional shares and the three parts sum to
the full $20,000.

`discretionaryBase` is baseline minus set-asides. `available` is
`discretionaryBase − committed − completed`. Utilization is a percentage of
the discretionary base, not of the baseline.

### What the statuses mean to a budget

| status group | meaning |
|---|---|
| `PENDING` + `NEEDS_INFO` | **committed.** Not spent, but promised — a DAC that treats it as available will overspend |
| `APPROVED_GOGOV` | **committed.** Approved and booked, not yet traveled |
| `COMPLETED` | **actual.** Travel happened |
| `DENIED` / `CANCELLED` | **neither.** The money was never spent |

These are read from `STATUS_GROUPS` rather than listed inline, so a new status
added to the workflow cannot silently fall outside the budget maths.

---

## 8. Why `BudgetEngine.js` was not reused

It already implements this arithmetic, correctly, in 339 lines. It is not used,
for two reasons worth stating because reusing it looks obviously right.

**1. It is unreachable.** It is a UMD/IIFE factory assigning to
`root.BudgetEngine`, and Apps Script exposes only **top-level declarations** to
`google.script.run`. That is **G-016** — the whole LETS budget layer is
structurally unreachable, not merely unwired.

**2. Its status vocabulary does not exist.** It filters requests by statuses
like `'Submitted - Pending Budget Check'` and `'Reconciled / Actuals Posted'`.
The `Requests` tab stores `PENDING_SECTOR`, `APPROVED_GOGOV`, `COMPLETED`. The
intersection of the two vocabularies is **empty** — measured in
`test_budget_dashboard.js` §1.

Wired up as-is it would have reported **every DAC at its full baseline with
zero commitments**, which looks completely plausible and is completely wrong.

This is the clearest example in the repo of why reading the status vocabulary
matters more than reading the arithmetic. Keep §1 of that suite; it is what
stops someone re-making the decision.

---

## 9. Running the tests

```sh
node lets_app/test_budget_backfill.js    #  89 assertions, 9 sections
node lets_app/test_budget_dashboard.js   #  63 assertions, 8 sections
node lets_app/test_budget_admin.js       #  68 assertions, 8 sections
```

All three run without any external data — unlike Task 1, nothing here is
gated on @clolry's exports.

Then the whole suite:

```sh
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" >/dev/null || echo "FAIL $f"; done
```

### The negative controls to keep

`test_budget_backfill.js` §9 patches out three protections and asserts the
suite then fails:

```
negative control patched out the admin guard
  -> without it a non-admin CAN import
negative control patched the duplicate check
  -> without it the same trip is counted twice
negative control patched the submitted date
  -> without it October travel is stamped with the import date
```

**Add one of these for every new protection you write.** Seven CI guards in
this repo passed when they should have failed, and every one was found by
running the control rather than reading the code.

---

## 10. Open questions

**Should `completed` use `Actual_Total` when it exists?** See §6.1. This needs
@clolry's answer, and it is the decision the whole reconciliation effort rests
on. Options: replace the estimate, show both with a variance column, or keep
the estimate for budget maths and report actuals separately.

**No edit or delete for an imported row.** Mistakes have to be fixed in the
spreadsheet, bypassing every guard and leaving no log entry. @clolry was asked
and has not said whether it matters.

**`getBudgetDashboard` is unguarded**, consistent with the transparency
decision. Worth a second look if DAC balances ever become sensitive.

**Mid-year adjustments versus new allocation rows.** `BudgetAdmin` models a
changed budget as a new append-only row with a later effective date, which
preserves what the budget *was* — and that matters for reconciliation,
because a request approved in November against $152,000 looks over-budget if
the allocation was later cut to $120,000 and nothing records the ceiling
moving. Whether a separate adjustments concept is also needed is unresolved;
the dashboard still carries a comment implying one exists.

---

## 11. Where the reasoning lives

| | |
|---|---|
| `BudgetBackfill.js` header | why backfill is a separate path, and why admin-only |
| `BudgetDashboard.js` header | why `BudgetEngine.js` was not reused |
| `BudgetAdmin.js` header | why every allocation change appends |
| [`README.md`](README.md) | branch situation, repo conventions, thread overlap |
| [`01-gogov-reconciliation.md`](01-gogov-reconciliation.md) | Task 1, which writes the actuals this task should read |
| `docs/GAP_REGISTER.md` | **G-016**, the unreachable budget layer. Search the heading *"G-016 is worse than unreachable"* — the register has **two** sections numbered §6.12, so the number alone will not find it |
| `docs/DATA_DICTIONARY.md` §3.9 | positional writes |
| `SESSION_STATE.md` | current state and what is waiting on @clolry |

`git show de74314` covers the backfill importer and the budget admin together,
with a VERIFICATION section stating what was actually run.
