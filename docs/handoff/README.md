# Developer handoff — Ozel

Two development tasks, in order. Task 1 is the Go.gov monthly expense
reconciliation. Task 2 is importing existing travel and proving the budget
numbers are right.

| | |
|---|---|
| [`01-gogov-reconciliation.md`](01-gogov-reconciliation.md) | **Task 1.** Monthly Go.gov expense report reconciliation |
| [`02-existing-travel-import.md`](02-existing-travel-import.md) | **Task 2.** Importing existing travel, and verifying budget arithmetic |

Both documents are self-contained. Read this page first for the branch
situation and why these two tasks were chosen.

---

## Before you branch

**Do not continue `0zelKirkland-patch-1`.** It is already merged into `main`,
and `main` has moved **8 commits** past it. A diff from `main` to that branch
shows **2,037 deletions**: `CityPairs.js`, `CityPairSync.js`, both their test
suites, `.github/CODEOWNERS`, 65 lines of `verify.yml` and most of
`README.md`.

Those deletions are not changes anyone made. They are the branch being old.
Pushing it would look like a legitimate PR and would silently remove the
city-pair airfare feature that merged in PR #18.

Start clean:

```sh
git fetch origin
git switch -c feat/gogov-reconcile origin/sandbox
```

**Branch from `sandbox`, not `main`.** `sandbox` is 47 commits ahead of `main`
and is where all of the groundwork for both tasks lives — `GogovSync.js` does
not exist on `main` at all.

---

## Why these two tasks

Development is being split so two people can work without colliding. The
outstanding work was mapped against the files each piece touches:

| | work | files it owns |
|---|---|---|
| A | FAS HR sync + Directory email lookup | new `FasHrSync.js`, `DirectoryLookup.js` |
| B | Fix the four `sector director` call sites | `Access.js`, `Admin_Dashboard.js`, `Users.js`, `HCData.js` |
| C | Reconciliation UI | `GogovSync.js`, new reconcile controller |
| D | Request-report importer | `BudgetBackfill.js`, `GogovSync.js` |
| E | Per-capita service-centre allocations | `BudgetDashboard.js`, budget page |
| F | M&IE deduction from `Meals_Provided` | `travelCostService.html`, `travelPerDiem.html` |
| G | Portfolio partitioning (FAS-wide) | ~everything: 70+ references across 18 files |

**C and D are the only pair that share a file** (`GogovSync.js`). Giving both
to one person removes the conflict entirely and leaves only sequencing — which
is why they are Task 1 and Task 2 here rather than split between people.

A and B go to @clolry: B depends on A's data, and both need the org hierarchy
that was just committed.

**G is deliberately excluded.** It touches everything both threads own, so it
cannot run concurrently with either. It also gets more expensive the longer it
waits, which is a real tension worth deciding deliberately rather than by
default.

---

## Where the two threads touch

Three shared files, in increasing order of danger.

**`verify.yml` and `.claspignore` will conflict on nearly every PR.** 44 and 32
commits respectively; every feature appends a test step and an ignore line.
The conflicts are additive — keep both sides. This is not a sign anything is
broken, and it is worth knowing up front.

**`Sheets.js` is the one to be careful with.** Both threads add tabs. The PR
#16 conflict there was *not* safely unionable: `HC_ORGS: 'HC_Orgs'` had no
trailing comma, so appending after it produced invalid JavaScript, and the
schema hunk straddled a nested array *and* the enclosing object's close.
Reading the diff caught neither problem; `node --check` caught both.

Append at the **end** of `SHEET_NAMES` and `TRAVEL_SHEET_SCHEMAS`, then:

```sh
node --check lets_app/server/01_constants/Sheets.js
```

**One dependency runs the other way.** The ASD roster filter that Task 1 wants
needs @clolry's HR sync. Build without it — it improves the match numbers
later without any matcher change.

---

## Running everything

```sh
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" >/dev/null || echo "FAIL $f"; done
```

34 suites, all green on `sandbox` today. Any new suite needs its filename added
to `lets_app/.claspignore` — tests must not be pushed to Apps Script — and a
step added to `.github/workflows/verify.yml`.

---

## Conventions that apply to both tasks

Read `docs/ENHANCEMENT_PLAYBOOK.md` §7.1 and §7.2 before the first commit.
Five rules and five prohibitions, each of which fails **silently**. The ones
most likely to bite:

**Give every new helper a TRAILING underscore.** `function foo_()` is private
to the platform. `function _foo()` is **not** — a leading underscore confers
nothing, and 118 functions in this repo are named that way, all of them
browser-callable. Playbook Rule 3.

**Every browser-callable function needs an explicit auth check.** Apps Script
exposes all 412 reachable top-level functions to any authenticated browser —
**G-001**. Playbook §7.7.1 has the guard pattern.

**Read sheets BY HEADER NAME.** Eighteen access points are order-dependent and
a column insertion silently misfiles them — **G-014** (Critical, open). Do not
add a nineteenth.

**Writes ARE positional** — eight of those eighteen are positional write
arrays. Build a header-keyed record and map it over the schema. Never
hand-build the array. Playbook §7.2.3.

**Append columns. Never insert, reorder, delete or rename one.** Playbook
Rule 5.

**Do not run `clasp push` locally, and never from the repository root.** CI
deploys. A root push carries 228 files into an undocumented Apps Script
project, including another organisation's application — **G-048**. Playbook
Rule 1.

**If you add a Google API call, read Playbook §7.5.1 first.** The manifest
declares zero `oauthScopes`, so the scope set is inferred from the APIs the
code calls. A new service silently widens permissions for every user with no
code-review signal — **G-006** (Critical).

**Write the negative control before claiming a guard works.** Seven CI guards
in this repo passed when they should have failed, every one found by running
the control rather than reading the code. The pattern is always an assertion
against source text that differs trivially from what was pictured — one space
versus four, a comment that satisfies a grep, a slice between markers in the
wrong order.

**`grep` treats several repo files as binary** because they contain `✓` and `⚠`
and the CI container has no UTF-8 locale. Output-consuming greps need `-a` or
they print "binary file matches" and the guard silently passes. Two guards had
been dead for exactly this reason.

---

## Reference data

Both tasks benefit from @clolry's Go.gov exports, which are **gitignored and
local to his machine**: ~400 real GSA traveller names and 391 employee IDs
each. **G-056** already flags six real employees' addresses in test fixtures
as a problem worth fixing rather than repeating.

Without them, `test_gogov_sync.js` runs **123 assertions instead of 136** and
skips cleanly with `SKIP reference exports not available in this checkout`.
That is a correct run, not a broken checkout. Task 1 §8 explains how to wire
them in if @clolry shares them.

---

## Where the reasoning lives

The commit messages are the design record. Each carries a VERIFICATION section
stating what was actually run.

| | |
|---|---|
| `git show c0f3451` | the Go.gov matcher |
| `git show de74314` | the backfill importer and budget admin |
| `git show 6666019` | the 40-character truncation and request-ID shortening |
| `docs/ENHANCEMENT_PLAYBOOK.md` | the rules above, with the findings behind them |
| `docs/GAP_REGISTER.md` | every G-nnn finding cited in these documents |
| `docs/DATA_DICTIONARY.md` | schemas, and §3.9 on positional writes |
| `SESSION_STATE.md` | current state and what is waiting on @clolry |
