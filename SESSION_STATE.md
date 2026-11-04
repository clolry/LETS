# Session state — 2026-11-02

Picking this back up: read this file first, then `git log --oneline -12`.

## Where things stand

Branch `sandbox`, one commit ahead of `origin/sandbox`:

```
c0f3451  Add Go.gov import schemas and the reconciliation matcher   <- NOT PUSHED
```

Everything before it is pushed. `origin/main` is at `de74314`, so main is one
behind sandbox and will need a PR eventually.

29 test suites pass. 63 CI guards pass. Working tree is clean apart from the
staffing plan, which is deliberately untracked (see below).

```sh
git push                        # pushes c0f3451
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" || echo "FAIL $f"; done
```

## Waiting on @clolry — in priority order

**1. The org chart has never rendered.** `HC_SPREADSHEET_ID` was pointing at
"Copy of FAS Travel Exemption Request (Responses)" — the wrong file. The fix
is to copy `TRAVEL_DB_SPREADSHEET_ID` from the LETS project's Script
Properties into the org chart project, then run `checkOrgChartSetup()`.

**2. Nothing from the last ~8 commits has been tested in a browser.** Budget
KPIs, event attendance, Set Allocations, Import Existing Travel — all written,
none seen running. The test order is in each commit message under "PUSH, THEN".

**3. `setupTravelDatabase()` needs running** to create the four new tabs:
`Feedback`, `Historical_Events`, `Budget_Allocations`, `Expense_Imports`.
Until then those features fail with "tab not found".

## The open question that blocks reconciliation

@clolry said **~30 ASD travellers in October**. Matching the staffing plan
against the expense export finds **9**, totalling $12,217.94.

Three candidate explanations, not distinguishable from here:

1. The May roster is stale — new hires since won't match.
2. The export is incomplete.
3. **Most likely:** "30 travellers" counted people who *travelled* in October,
   whereas the export lists *expense reports filed*. A voucher lags its trip,
   so October travel surfaces in the November export.

I was about to build rather than resolve it, on the grounds that the review
screen shows exactly which rows were excluded and answers the question better
than guessing. That still seems right, but @clolry should sanity-check whether
$12,217.94 is plausible for ASD's October vouchers.

## Reference files — LOCAL ONLY, never commit

@clolry: "I don't want the export files to be uploaded to a public github,
please keep them local on my machine for your use only."

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

## Still unanswered

- Should the roster importer create LETS user accounts, or only positions?
- No edit or delete for an imported travel row — mistakes need fixing in the
  spreadsheet. @clolry was asked whether that matters and has not said.
- `getBudgetDashboard` and `getTravelEventHistory` are unguarded, consistent
  with the transparency decision. Worth a second look if DAC balances ever
  become sensitive.

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
