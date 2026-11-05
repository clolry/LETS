# Session state — 2026-11-05

```sh
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" >/dev/null || echo "FAIL $f"; done
node scripts/gen-editor-functions.js --check
```

## §0 RESUME HERE — the existing-travel importer is built and NOT COMMITTED

**Everything is on disk in the working tree. Nothing is lost by shutting down.**

Last commit is `e60ac64` (the UI defect fixes, pushed). On top of it sit **18
uncommitted files** implementing the FY27 workbook importer. State as of
stopping:

```
36 test suites pass        (245 assertions in the new one)
all shell guards pass      (except the pre-existing .claspignore one, §0.3)
nothing committed
nothing browser-verified
```

### §0.1 First commands tomorrow

```sh
cd ~/Documents/Projects/LETS
git status --short                  # expect 14 modified, 5 untracked
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" || echo "FAIL $f"; done

# The measured test fixture lives in /tmp and IS LOST on reboot. §21 of
# test_travel_import.js will SKIP until you regenerate it. One command:
python3 scripts/workbook_to_fixture.py
node lets_app/test_travel_import.js   # §21 now runs: expect 28 requests, 10 expenses
```

That script is **committed** (`scripts/workbook_to_fixture.py`), so the only
thing reboot costs is one command.

### §0.2 What is uncommitted, and what each file is for

| File | New? | What |
|---|---|---|
| `server/30_services/TravelImport.js` | **new** | The engine. Mapping, parse, scope, validate, diff, preview. No spreadsheet calls — that is what makes it testable |
| `server/40_domain/TravelImportAdmin.js` | **new** | Writes + 7 admin-guarded entrypoints: preview / commit / rollback / history |
| `test_travel_import.js` | **new** | 245 assertions, 23 sections, 6 negative controls |
| `scripts/workbook_to_fixture.py` | **new** | Regenerates the `/tmp` fixture §21 needs |
| `docs/DEPLOYMENT_TRAVEL_IMPORT.md` | **new** | How to deploy, run, and undo. **§0 of it is the thing to tell Chiquita** |
| `server/01_constants/Sheets.js` | mod | `Travel_Imports` (42 cols) + `Import_Batches` (27 cols) |
| `server/40_domain/BudgetDashboard.js` | mod | A reconciled `Actual_Total` now beats the estimate; the payload reports the split |
| `client/pages/travelBudgetDashboardPage.html` | mod | 4-step import wizard, batch history, rollback |
| `test_budget_dashboard.js` | mod | §6b — reconciled vs estimated actuals, and the blank-is-not-zero trap |
| `docs/DATA_DICTIONARY.md` | mod | §3.5.1c — the full schema reasoning |
| `docs/README.md` | mod | Three route-by-question entries |
| `.github/workflows/verify.yml` | mod | 1 test step + 6 guards, each negative-controlled |
| `.gitignore` | mod | The workbook — 1,900 real names — is now ignored |
| `lets_app/.claspignore` | mod | The two new test suites |
| 4 shell scripts | mod | **mode-only** `100644→100755`, from a previous session |

### §0.3 Three things that need a decision, not more work

1. **Commit it.** I did not commit; AGENTS.md requires asking. One commit or
   four (schemas → engine+tests → UI → docs) — your call.
2. **`.claspignore` still fails CI.** Pre-existing, from before this work. The
   bare `test_*.js` glob is not a filename, so the stale-entry guard rejects
   it. One line to delete; every suite is already listed by name above it.
3. **Browser verification is still outstanding**, now for two increments — the
   UI fixes (which you verified) and this importer (which nobody has run).

### §0.4 The one finding to carry into the next conversation

**LETS will not match Chiquita's variance column, deliberately.** Hers is
computed from Report Total (what the traveller claimed); LETS uses Amount
Approved (what GSA paid). Across her 20 matched rows: hers **−$326.93**, true
**−$1,491.32**, gap **$1,164.39** — exactly the disallowed amount. You already
ruled on this during the Go.gov work. **She should be told before the two
diverge in a meeting.** Every import batch records `Variance_Basis` so the
question has an answer on the record.

---

## Where things stand (older context, still true)

Branch `sandbox`, level with `origin/sandbox` at `e60ac64`.

`origin/main` is behind sandbox and will need a PR eventually.

```sh
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" || echo "FAIL $f"; done
```

## One bug open

**The directory email sweep reports false completion.** Full writeup in
`docs/handoff/03-directory-sweep-completion.md` — read that before touching
`DirectoryResolve.js`.


Short version: `complete` is derived from where the resume cursor sits rather
than from whether anyone still needs an address. The cursor is parked at 1046
(the roster length), so `runDirectoryResolve` does nothing and reports success.
**Roughly 218 of 823 staffed positions still have no email.**

I fixed this symptom twice already, by two other routes, without naming the
shared cause. Fix the derivation, not the third symptom.

**2. Browser verification.** The UI defect fixes ARE verified (2026-11-04).
The workbook importer is not — no live import has run.

**3. `setupTravelDatabase()` needs running** to create the new tabs:
`Feedback`, `Historical_Events`, `Budget_Allocations`, `Expense_Imports`, and
now `Travel_Imports` + `Import_Batches`. Until then those features fail with
"tab not found". Safe to re-run — `createOrUpdateSheet` is idempotent.

Immediate unblock, no code: run `resolveDirectoryEmails({startIndex: 0})` from
a scratch function. Twice covers the backlog.

**Do not install `installDirectoryLookupTrigger()` yet** — every 10 minutes it
would do nothing and log success.

## What landed today, all verified against live data

**FY27 budget model is correct and live.** @clolry's agreed set-asides, 30
lines, $552,500. Discretionary: OMD $61,587.50, IDV $306,700.00, CM
$76,212.50, FO $0.00 — $444,500 total, matching his Travel Summary tab.

The $48k FC senior advisor is `FUNDED_FROM_RELEASES` at $0 after the Chief of
Staff declined to charge the DACs. `SetAsideRelease.js` records releases from
cancelled Q1 events; nothing released yet.

**Per-capita service-centre split works off the real roster.** 817 filled
positions, 22 service centres, foots to $444,500 exactly by largest-remainder.
Keyed on org code throughout — `FCBAB` and `FCBBA` are both "Acquisition
Service Center 1", so a name-keyed roll-up would merge six centres into three.

`showServiceCentreHeadcount()` in `40_domain/HCRosterSync.js` prints the table.

**The real HR roster is imported.** 1,046 ASD positions from the FAS HRLinks
feed, scoped to `FC` — the feed is 4,274 rows across all five FAS portfolios,
and importing it would have granted LETS access to several hundred supervisors
outside ASD. 16 fictional seed positions and @clolry's 8 test rows removed.

**Directory email lookup resolves 46 of 50.** The matching logic is sound; see
the handoff for the method table and the deliberate refusals. Three nicknames
need @clolry — Kittrell→Kim, Cayo→Win, Schollaert→Charley — and `Hall,Joseph C`
is unresolvable from three disagreeing sources.

## Known-good numbers, for checking a regression against

| | |
|---|---|
| ASD discretionary | $444,500.00 |
| Filled positions | 817 of 1,046 |
| Service centres | 22 |
| Org codes in `HC_Orgs` | 137 |
| Staffed positions needing an email | ~218 remaining of 564 |
| FY27 travel log rows | 30, all FY27 by voucher-approval date |

## Still waiting on @clolry

- **Three nickname decisions** via `runEmailResolutionQueue()`. Each prints a
  pre-filled `saveEmailOverride(...)`; they persist in `HC_Email_Overrides`
  through every future import.
- **`Hall,Joseph C`** — does that account exist? Feed says `FCA0BAA`, directory
  says nothing, manual org chart says `joe.hall@gsa.gov` which he could not
  resolve.
- **Whether `FCA0EA` is contractor-heavy.** Five of six unresolvable names were
  in that one service centre, which is unlikely to be chance.

## Not started

**The Org Code ledger**, which @clolry asked for and is the next substantial
piece of work. His specification, verbatim in intent:

> Columns for Org Code, Trips, Estimated $, Actual $, Pending $, Total
> Committed, Allocated Budget, Remaining Budget, Budget Health (coloured bar).
> All org codes in proper org-chart structure, expandable per org to show that
> org's travel records — traveller name, type, purpose, route, dates, and the
> three dollar columns. Filterable by all orgs / FC / FCA etc., searchable by
> org code or traveller.

Decisions he already made:

- Estimated/Actual/Pending as three columns; estimates retained after actuals
  arrive.
- Spend at **every** hierarchy level; Allocated/Remaining only where a real
  allocation exists (4 DACs + 22 service centres). Do not invent
  division-level budgets.
- Per-centre spend must come from `Request_Travelers`, not `Requests` — a
  request carries one `Owning_Office` but a consolidated conference request
  holds travellers from several DACs. `BudgetDashboard.spendByServiceCentre`
  already does this correctly; reuse it.

**The daily liability-log pull.** `LiabilityLogSync.js` parses and plans but
has no sheet read or trigger. `LIABILITY_LOG_SHEET_ID` is set. @clolry approved
writing a `LETS_Key` column back to his sheet for idempotency — the log's own
`Document Number` is empty on 29 of 30 rows.

**Five `sector director` call sites** still match a title that does not exist
in this organisation, so all five find nobody. Should use `Org_Level ===
'SERVICE_CENTER'`.

## Process notes worth carrying forward

**A completion signal must be derived from the work, not from a cursor.** Three
false-completion bugs in one evening, each fixed in isolation. The pattern
cost @clolry eight manual runs.

**Strip comments before asserting on source text.** Four occurrences now —
`test_markup_integrity`, `test_page_markup`, `test_hc_roster_import`,
`test_directory_lookup` §7. A file's own explanation of why it does not do X
satisfies a naive grep for X.

**Negative controls break silently when their patch target moves.** Three
occurrences, all anchored on a comment or a renamed variable. Anchor on code
that the change under test must touch.

**@clolry's live output has caught things no test did** — the eight Halls, the
org suffix on surnames, `OBLIGATED` meaning a temp promotion, five "missing"
people who autocompleted instantly in his email client. Ask for a real run
before building the next layer on an assumption.

## Reference files — LOCAL ONLY, never commit

`reference_excel_files/` holds named GSA staff, travel costs and the FY27
liability log. Gitignored by pattern; `test_hc_roster_import.js` §7 fails the
build if any server file references that directory.

The May staffing plan (`Copy of ASD Staffing Plan 5-12-26.xlsx`) is **stale and
must not be read** — it puts Melissa Mould in the wrong org, and every
per-capita figure derived from it was wrong. The roster comes from the
`FAS_HRLinks_Feed` property and nothing else.

Gitignored, and verified absent from all history via
`git log --all -- 'reference_excel_files/*'`:

| file | contents |
|---|---|
| `report_12947.xls` | 182 expense rows, first sample |
| `Expense Report (Sept-Nov).xls` | 522 rows, 391 real traveller names + employee IDs |
| `Travel requests (Sept - Nov).xls` | 565 rows, 415 real names |
| `Copy of ASD Staffing Plan 5-12-26.xlsx` | 806 named ASD staff, 132 org codes |

The two `FY23 *.xlsx` files were already tracked and contain no names.

`test_gogov_sync.js` §8 reads `/tmp/opencode/req.json` and `exp.json` and
SKIPS cleanly when absent, so a fresh checkout passes. To restore them:

```sh
pip install --break-system-packages --target=/tmp/opencode/pylibs xlrd openpyxl
# then the xlrd dump used in this session — see the §8 comment
```

## What is built, and what is not

**Done and committed:**

- Budget KPIs reading live data (`40_domain/BudgetDashboard.js`)
- Admin allocations, append-only and versioned (`40_domain/BudgetAdmin.js`)
- Existing-travel import, trip-level (`40_domain/BudgetBackfill.js`)
- Event attendance history (`30_services/EventHistory.js`)
- Go.gov parser + matcher (`30_services/GogovSync.js`) — **no UI, not reachable**
- Org chart web app (`orgchart_app/`) — **never rendered**

**Next, in the order agreed:**

1. **Roster importer** — 806 people from the staffing plan. Position number as
   key, org from `Office Symbol`, resolving through the existing 137-code
   hierarchy. Must flag rather than silently resolve: 6 duplicate position
   numbers, 2 cells holding two PNs (`'90020413\n90003677'`), 8 PNs that read
   as floats (`90034839.0`).
2. **Expense filter** — roster match plus a learned Go.gov Employee ID
   crosswalk. Unmatched rows must stay visible with a dollar total.
3. **Request importer** — 565 Go.gov requests, same filter, created as
   `BACKFILL:` carrying `Gogov_Request_ID`.
4. **Reconciliation review screen** — for the ~55% needing a human.
5. **Event set-asides** — asked for two sessions ago, still not built. Nothing
   blocks it now that the dashboard knows real balances.

## Findings that must not be relearned

**Go.gov truncates trip names at exactly 40 characters.** 79 request names are
exactly 40, zero are longer. So the LETS ID goes at the FRONT of the name —
a suffix gets truncated away on precisely the long-title trips most likely to
be expensive. This is the whole basis of the SOP.

**The request ID is now `L27-0001`**, 8 characters, fiscal-year prefixed.
Legacy `REQ-2026-0001` rows stay valid for ever — the validator guards a
lookup, so rejecting them would make existing requests unfindable. The short
form is matched MORE strictly than the legacy one: `L27` is three characters
that can occur by accident, and a loose pattern matched `Order L270001-A`
against 1,087 real titles. See DATA_DICTIONARY §3.2.4.

**`Amount Approved`, never `Report Total`.** They differ on 37 of 182 rows by
$4,569.93. Report Total is what the traveller claimed; Amount Approved is what
GSA paid.

**One monthly export spans two fiscal years.** $537,451.15 FY2026 and
$269,890.88 FY2027 in the 522-row file. Every row is bucketed on its own date.

**Two date encodings in one file set.** `Report End Date` is TEXT
`YYYY-MM-DD`; `Submit Date` and the request dates are Excel serials.

**An ID match must still verify the traveller.** The test asserting this FAILED
when first written: a cited LETS ID was trusted alone, and three real expense
reports were auto-matched to other people's requests — Brandon Maness's
$1,922.96 landed on another traveller's request. One mistyped digit moves money
between travellers.

**91 unmatched expense rows share a surname with someone on the roster**
(`Miller, Aurelio H.` vs roster `Miller,Anthony C`). They are different people
and correctly excluded. First-name-exact is the right rule; a fuzzy matcher
would attribute another office's spend to ASD.

**`grep` treats several repo files as binary** because they contain `✓`/`⚠` and
this container has no UTF-8 locale. Output-consuming greps need `-a` or they
print "binary file matches" and the guard silently passes. `test_branding.js`
§7c now enforces this. Two guards had been dead for exactly this reason.

**Count-threshold guards do not bite.** The HCAdmin guard used
`grep -c ... -lt 5`; adding a fifth entry point meant deleting any single
guard still passed. Per-function body extraction replaced it.

## Decisions @clolry made, so they are settled

- Reuse the `BACKFILL` marker rather than a new `IMPORTED_PLANNED` status —
  "I just want to add the requests without having them go through the approval
  process again because they're already approved."
- Mapping UI, not a hardcoded parser.
- Actuals trip-level only; estimates keep their category breakdown.
- Budget figures readable by all users, writable by admins only —
  "we're trying to develop transparency."
- Org attribution comes from LETS, never from Go.gov's `Org Level 3` (which is
  `F` for every row).
- Event history stays blank rather than zero where org detail was never
  recorded.
- Fiscal year is 1 October – 30 September.

## Existing-travel import — built 2026-11-04, NOT COMMITTED

See **§0** at the top for the resume steps and the file inventory. This section
is the detail behind it.

@clolry asked for a repeatable FY27 importer using Chiquita's workbook
(`_Expense Report Calculations File for LETS.xlsx`, 8 tabs). Scope chosen:
**FY27 only, ASD employees only** — 28 requests ($46,196.19) and 10 expense
reports ($16,863.62) out of 1,024 and 274 source rows.

Full detail in `docs/DEPLOYMENT_TRAVEL_IMPORT.md`. The three things worth
knowing without opening it:

1. **LETS will not match Chiquita's variance column, deliberately.** Hers is
   computed from Report Total (claimed); LETS uses Amount Approved (paid).
   Across her 20 matched rows: hers −$326.93, true −$1,491.32, gap $1,164.39
   — exactly the disallowed amount. @clolry already ruled on this. **She
   should be told before the two diverge in a meeting.**
2. **Reuses `GogovSync.js`, which was completely unwired before this.** Its
   matcher had zero callers through four commits. It now runs for real.
3. **Not browser-verified.** 36 suites and all guards pass; no live import has
   run. First run should be a preview against a copy of the Travel DB.

### The three measured findings that shaped it

Each of these is why something in the code looks over-engineered. All three
came from parsing the real file, not from reasoning about it.

| Finding | What it would have cost |
|---|---|
| **A naive fiscal-year filter attaches money to the wrong trip.** Udaya Patnaik's report ends 2026-10-02 (FY2027, in scope); its request `4GNF` starts 2026-09-30 (FY2026, not imported). Filtering the match pool leaves `4NFL` — a different trip three weeks later — as the only title match. | $1,176.10 posted against the wrong trip, `4GNF` unreconciled forever, both figures looking fine. **So: what is imported is scoped; what is matched against is not.** |
| **7 of 1,024 source IDs are stored as numbers.** `4946` reads back `'4946.0'`. | Those seven re-import as NEW requests on every run, consuming a DAC's budget again each time — the exact duplicate-prevention failure the feature exists to avoid. |
| **The obvious expense key collides on 2 of 274 rows.** Stacy Buechele filed two `Trip from WIL to WAS` reports ending the same day, $198.60 and $1,602.06, both real. | A merged key drops $198.60 and the totals still look plausible. |

### Deferred, and NOT fixed

| # | Item | Why deferred |
|---|---|---|
| 7 | **`GogovSync.toDateString` mis-parses a string serial** — `'46356'` → `'46356-01-01'` (the year 46356). `TravelImport.toDateString` resolves it before delegating, so the importer is safe, but the monthly reconciliation path shares that function and would silently drop a row out of scope. | Widening it touches behaviour pinned by `test_gogov_sync.js` §3 and shared with the reconciliation path — blast radius beyond this feature. |
| 8 | **`docs/evidence/verify_city_dropdown_fix.js` throws** (`Cannot read properties of undefined (reading 'mie')`). Verified failing at `e60ac64`, i.e. **before** this work. Not wired into CI, so nothing catches it. | Pre-existing and unrelated. Needs whoever wrote the per-diem fix. |
| 9 | **The import is single-source.** `Source_System` is a column and the mapping is a profile, so a second source is a remap rather than a rewrite — but only `gogov-workbook` has been built and measured. | No second source exists yet (YAGNI). |
| 10 | **One traveller needs manual matching every run** (Patnaik — three requests share his name and title). Correct behaviour, not a defect, but it recurs until a LETS ID appears in the trip name. | Needs the SOP convention to be adopted, which is a people problem rather than a code one. |

## Still unanswered

- Should the roster importer create LETS user accounts, or only positions?
- No edit or delete for an imported travel row — mistakes need fixing in the
  spreadsheet. @clolry was asked whether that matters and has not said.
- `getBudgetDashboard` and `getTravelEventHistory` are unguarded, consistent
  with the transparency decision. Worth a second look if DAC balances ever
  become sensitive.
- **Does Chiquita keep maintaining the workbook, or does LETS become the
  source of truth after the first import?** The importer supports repeated
  incremental runs either way, but the answer decides whether anyone needs to
  keep reconciling the two.

## Tracked follow-up from the 2026-11-04 UI defect fix

@clolry reported three things: CSS printing at the top of New Request and
Admin, the FY27 budget page not scrolling, and panels cropping on zoom. All
three are fixed and guarded by `test_markup_integrity.js` (8 sections, 4 of
them regression guards with negative controls recorded in the session
transcript). **The items below were deliberately deferred and are NOT fixed.**

`gh` could not file these as issues — `GITHUB_TOKEN` is invalid in this
environment (`gh auth status` → "The token in GITHUB_TOKEN is invalid"). They
are recorded here so they are not lost, but **this is a handoff note, not a
tracker**. They should be moved to GitHub issues once `gh` is authorised.

| # | Deferred item | Why it was deferred |
|---|---|---|
| 1 | **`travelPortalStyles` sets `overflow: hidden` on BARE `html`/`body`** (lines 135, 140). This is the root cause of the budget page's scroll lock; the fix applied was a per-page scroller, not this. Any future page that includes this stylesheet hits the same trap — it has already caught one. Scope the rules to the portal shell. | Fixing it means touching the portal, which works. A narrow fix was the lower-risk call for a reported defect. |
| 2 | **Collapse-by-`max-height` loses its expand animation.** The crop fixes set `max-height: none` on the open states of `.tc__stage`, `.action-detail`, `.review-traveler-row__body` and `.tc__reveal`. `max-height` cannot transition to `none`, so the *expand* slide is gone (opacity/transform still animate; collapse still slides). The fix that keeps both is `grid-template-rows: 0fr → 1fr`, which needs each panel wrapped in a grid container. | A real layout change inside the traveller cards, and not one to make without a browser to verify it in. |
| 3 | **Fixed-bar offsets track the TOKEN, not the bar's rendered height.** `--travel-header-h` / `--review-infobar-h` in `tokens.html` removed the drift between a bar's declared height and the offset compensating for it. The bars now use `min-height`, so under text-only zoom or a raised default font size they can still outgrow the token and content slides under by the difference. The real fix is `position: sticky` instead of fixed-plus-offset. | Per-page layout change; needs browser verification. |
| 4 | **`travelRequestController.html:1225` hardcodes `const fixedHeaderHeight = 52`** for its scroll-to-step offset. Same magic number as the CSS, now in JS where the token cannot reach it. Should read the rendered header height, or the custom property. | Out of scope of the reported defects; one-line change but needs a browser to confirm the scroll lands correctly. |
| 5 | **The `.oc-modal` shell is defined twice** — `travelAdminStyles.html:5412` and inline in `travelBudgetDashboardPage.html:42`. The existing comment already flags this as deliberate-for-now. It is now also the thing whose duplicated prose caused the Admin parse failure. Worth consolidating. | Pre-existing, documented decision. Not a defect. |
| 6 | **`.claspignore` has a pre-existing broken entry that fails an existing CI guard** — see the section below. Not caused by this change. | Needs @clolry's intent. |

### A pre-existing CI failure, found while verifying — not caused by this change

`lets_app/.claspignore` carries an **uncommitted** block (present in the
working tree before this session; `git diff` attributes it to no commit) which
ends with a bare glob:

```
# Remaining test scripts
test_*.js
```

The existing verify.yml guard *"every test file is excluded from the clasp
push"* has a stale-entry half that reads each `test_*.js` line and asserts the
named file exists. A literal glob is not a filename, so it reports:

```
::error::A .claspignore lists test files that no longer exist: lets_app/test_*.js
```

**This fails CI today, independently of anything in this change.** Verified by
reverting `.claspignore` to `HEAD` plus only the new
`test_markup_integrity.js` line — the guard passes. Two options, and @clolry
should pick:

- **Drop the glob block.** Every suite is already listed by name above it, so
  the glob is redundant and the guard keeps its stale-entry check.
- **Keep the glob and teach the guard to skip glob patterns.** Weakens the
  check slightly: a renamed suite would then no longer be reported.

The new suite was added by name, consistent with the existing convention.

