# Session state — 2026-11-05 (late)

```sh
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" >/dev/null || echo "FAIL $f"; done
node scripts/gen-editor-functions.js --check
```

40 suites, 18 verify.yml guards, 87 editor functions. Branch `sandbox`, level
with `origin/sandbox` at `6414596`. Clean tree, nothing uncommitted.

---

## §0 RESUME HERE

Everything described below is committed and pushed. The HR roster, the
Service Center Director resolution and the per-capita headcount are all
correct against live data and confirmed by @clolry's own runs.

### §0.1 The next piece of work, and it is a design change

**Every ASD employee needs to submit their own travel request, routing through
their supervisor.** @clolry: "AAS built TRIP to have requests submitted by a
director but our Chief of Staff wants individual employees to submit requests
on their own (and route through their supervisor/director/SCD, etc). I'm
concerned that this shift hasn't been included in the design."

He is right that it has not been. Two gaps, and the second is larger than it
looks:

**1. 866 of 1,046 positions cannot sign in at all.** `canAccessTrip`
(`30_services/Access.js:540`) has exactly three allow paths: a
`Travel_User_Roles` row, a supervisory HC position, or a BU-lead title. A
non-supervisory employee with no role row is DENIED at `Access.js:631`. There
are 3 rows in `Travel_Users`.

**2. There is no supervisor stage in the workflow.** The chain is
`Sector → BU → OSO → FAS`, and `determineInitialRouting`
(`40_domain/Submission.js:85`) goes straight to the Service Center Director.

Decisions @clolry has already made on this:

- **Supervisor = the highest-grade person with `Supv Lvl != 8` in the SAME org
  code as the requestor.** Not the reports-to chain — so it does not depend on
  `Reports_To_Position_Number` being accurate.
- **The supervisor stage does NOT replace the SCD stage.** New chain:
  `supervisor → SCD → DAC → ASD T&E → FAS`.
- **A supervisor submitting their own request skips to the next approver**,
  matching the existing "you cannot review your own request" rules.

What this needs, for scoping: a new `PENDING_SUPERVISOR` status, two new
actions in `Review_Action.js` (`supervisor_approve`, `supervisor_needs_info`),
status-group membership in `01_constants/Status.js`, a stage label in
`travelUtils.html:343` (`describeReviewStage`), and an access path for the 866. `PENDING_SECTOR`
appears 87 times across 26 files — that is the blast radius to expect for a
new stage.

### §0.2 Smaller things that are ready to do

- **Delete the directory email lookup.** ~5,100 lines across
  `30_services/DirectoryLookup.js`, `40_domain/DirectoryResolve.js` and
  `test_directory_lookup.js`, plus the People API scope in `appsscript.json`.
  It existed only because the old HR feed had no email column. The new feed's
  coverage is **821 of 821 named rows, zero blank, zero malformed** —
  @clolry's own `diagnoseHrFeedSource()` run. Keep `HC_Email_Overrides` and
  `saveEmailOverride`: it is the only way to correct one person's address that
  survives the daily import.
- **The 22-row per-capita table is computed and rendered nowhere.**
  `BudgetDashboard.js:1059` puts `serviceCenters` in the payload;
  `travelBudgetDashboardPage.html` reads `d.offices` (4 DACs) and never
  touches it. The only way to see the 22 centers today is
  `showServiceCenterHeadcount()` in the editor.
- **`setupTravelDatabase()` still needs running** to create `Feedback`,
  `Historical_Events`, `Budget_Allocations`, `Expense_Imports`,
  `Travel_Imports` and `Import_Batches`. Idempotent; safe to re-run.

---

## The HR roster: source, vocabulary, and what each column decides

**The source changed.** @clolry: "I was able to get access to a completely
different data source. It's specific to FC only (and doesn't have the rest of
FAS) and it includes all of the information we need - including an email
address!"

Script Properties `FC_WF_Data_Report` and `FC_WF_Tab` are set and live:
spreadsheet `1dvljU6a3dG1jyDkowb9_3XlT3K3pPfzJnTLvDOZHC0o`, tab
**`Employee Roster`**, 1,047 rows × 46 columns. `FAS_HRLinks_Feed` and
`FAS_HRLinks_Feed_Tab` are deleted and nothing reads them.

The workbook has six other tabs that LETS does not read: `Joiners`,
`Separations`, `Reassignments`, `Career Ladder Due`, `Security Clearance`,
`Email Listing-by geographical Zone`.

### The two vocabularies, measured — not assumed

`diagnoseHrFeedSource()` prints both. These are the values that decide site
access and the budget denominator, so they are recorded here verbatim.

**`Supv Lvl`**, with the feed's own description column beside it:

| code | n | description |
|---|---|---|
| 2 | 167 | Supervisor or Manager |
| 4 | 6 | Supervisor (CSRA) |
| 5 | 1 | Management Official (CSRA) |
| 7 | 6 | Team Leader |
| 8 | 866 | Non-Supervisory |

**Anything except 8 is a supervisor.** @clolry ruled on this. The rule lives
once, in `01_constants/HCRules.js`, written as a **deny-list** — "is this not
8" rather than "is this one of 2/4/5/7" — so a code HR adds later cannot
silently lock a supervisor out. The cost is that an unknown code grants
access; `diagHcData` prints a code census and
`HCAdmin.validateHCPosition` warns, so that is visible rather than inferred.

**`Position Status Type`:**

| value | n | normalizes to |
|---|---|---|
| APPROVED | 804 | FILLED (the NAME decides whether anyone is in it) |
| VACANT | 207 | VACANT |
| OBLIGATED | 19 | OBLIGATED |
| TEMP PROMOTION | 11 | FILLED |
| TEMPORARY | 5 | FILLED |

**None of APPROVED, TEMP PROMOTION or TEMPORARY contains `FILL` or
`ENCUMBER`**, so under the old substring rules all 820 reached FILLED through
a *fallback* rather than a match. The answer came out roughly right, which is
worse than wrong: the per-capita denominator was a guess on 78% of the roster
and nothing said so. Now matched explicitly against `OCCUPANCY_VOCABULARY`,
with `isKnownOccupancy` reporting match-versus-absorbed.

### The column mapping, and the four that were judgment calls

| LETS field | column | note |
|---|---|---|
| positionNumber | `Employee Position Number` | was `Position#` |
| employeeName | `Name` | |
| emailAddress | `Employee Email` | **authoritative** — @clolry: "definitive and without question" |
| orgCode | `Dept ID` | NOT `Dept. ID 2 Letter` |
| supervisoryStatus | `Supv Lvl` | NOT `Supervisor Level Desc.` |
| occupancyStatus | `Position Status Type` | |
| grade | `Grade` + `PP` | was the `PP-Series-Grd` composite |
| reportsTo | `Reports to\nPosition\nNumber` | NOT the supervisor name or email |

**`Dept ID`, not `Dept. ID 2 Letter`.** The two-letter column is a portfolio
abbreviation; reading it as the org code would collapse the whole roster into
one bucket and make all 22 per-capita shares identical — precise-looking and
meaningless. Same class of error as `POI` on the old feed.

**`Employee Email`, not `Reports to Supervisor Email`.** The latter is the
boss's address on the employee's row. Mapping it would hand every person their
supervisor's identity, against the exact field the access gate matches on.

**Headers arrive with EMBEDDED NEWLINES** — the sheet wraps them inside the
cell, so `Employee\nID`, `Reports to\nPosition\nNumber`, `Occ\nSeries`.
`_norm_` collapsing whitespace is load-bearing, not cosmetic: without it four
fields fail to map silently.

**Pay columns stay unmapped and are asserted so** — `Base Pay`,
`Local Adjust`, `Total Pay`, `Step`, `SCD Leave`. Salary is not travel data.

**One `Record Date` (11/01/2026), 1,046 distinct position numbers, zero
duplicates.** If that sheet ever carries two snapshot dates, every position
appears twice and `validateRow` blocks the lot — correctly, since a duplicate
key makes one of two real people invisible.

---

## Service Center Directors — resolved, and confirmed live

**21 of 22 centers route to a real person.** @clolry's
`diagServiceCenterDirectors()` run, 12:29 PM.

### What was wrong

Five call sites identified an SCD by matching `officeTitle` against the string
`'sector director'`. @clolry: "We don't call them Sector Directors, we call
them Service Center Directors." **No position in this organization carries
that title** — the live title census confirms zero.

So `findSectorDirector` returned null for every submission,
`determineInitialRouting` took its "no SD found" branch, and every request in
LETS started at the DAC stage with `Sector_Director_Name` blank. Nothing
errored; the SCD review stage simply never happened.

### The rule now

The most senior supervisory person whose own `Dept ID` sits at
`Org_Level = SERVICE_CENTER`, read through `HC.orgAncestorAtLevel`:

- **level, never length** — see the truncation note below
- **supervisory = `Supv Lvl != 8`** (`isHcSupervisoryCode`)
- **the seat must hold a person** (`isHcSeatOccupied` — only VACANT means
  nobody)
- **reachable, i.e. has an address** (`isHcPositionReachable`)
- **highest grade breaks a tie** (`compareHcGrade`, SES above every number)

The **grade-15 requirement is gone**. @clolry: "I don't know why we would need
to check the grade." Measured, it rejected only vacant seats and a grade-14
acting lead — and it would reject an SES director outright, since an SES grade
normalizes to `ES`.

### The three centers with more than one candidate

| center | resolution |
|---|---|
| FCA0E | 3 candidates; 2 are VACANT → Irvin, Kristen T |
| FCC0B | 2 candidates; 1 is VACANT → Stewart, Kyra |
| FCC0C | 3 candidates → **Eberle, Scott M, from an OBLIGATED seat**, over a FILLED grade-14 Lead |

**FCB0B routes nowhere, correctly** — its one supervisory seat is vacant, so
it cascades to the DAC.

**FCA0A → Wynings, Taylor S**, who the old `=== '2'` rule could not see. His
title is "Chief of Staff", which independently grants BU-lead access, so he
appears at two routing stages and can approve his own request. @clolry: "Having
Taylor approve his own requests is ok because eventually when he makes a
reservation in Go.gov it will route to his supervisor (Jack Tekus) for
approval." **Settled, deliberately.**

---

## Findings that must not be relearned

### An OBLIGATED seat holds a real person

The roster's own vocabulary reads like an absence and is not one. @clolry,
twice: "Scott Eberle is acting as the supervisor for FCC0C."

**19 OBLIGATED rows against 11 TEMP PROMOTION rows.** If every obligated seat
were the permanent half of a temp-promotion pair those counts would match.
They do not, so at least eight people hold ONLY an obligated row and have no
other row to be found at.

I got this wrong twice, in two layers, one commit apart:

1. **The headcount** counted `occupancyStatus === 'FILLED'` only, so Eberle was
   counted zero times — and `duplicatePeople` could not report it, because it
   returns early for anyone holding fewer than two positions.
2. **The SCD lookup and the access gate** excluded OBLIGATED, which I justified
   as "the occupant is working elsewhere, so THAT row is where they sign in."
   True of the eleven paired people. False of everyone else.

**The second one named the WRONG director, not none** — FCC0C resolved to a
grade-14 "Lead" because Eberle was filtered out before the grade tie-break
ran. A plausible name appeared, so nothing looked broken. The retired grade-15
check had been masking it by rejecting the Lead too.

The two rules now differ only in what they ask:

| | question | OBLIGATED |
|---|---|---|
| `isHcSeatOccupied` | is there a person in this seat? | **yes** |
| `hcCountableByPerson` | which ONE seat represents this person? | prefer the other one |

Both headers say why. Sharing a single "is this seat real" predicate is the
obvious-looking simplification that would break one of them.

### A 4-character sector code was inherited, not derived

About a dozen sites computed a sector as `orgCode.substring(0, 4)`. That was
correct for the previous workgroup — `OrgLookup.js:118` records
`QFAA = Army's Sector 1`, where four characters WAS the sector — and it was
carried over without re-deriving against this org.

Here a service center is **five** characters, so `FCA0` is not an org code at
all; the `0` is a filler, not a level. The 22 centers collapsed into 6
buckets, three named for codes that do not exist.

**Lengthening it to 5 would not have fixed it.** 130 of 137 codes agree with a
5-char truncation; the other seven are `FC`, `FCA`, `FCB`, `FCC`, `FCBA`,
`FCBB`, `FCCA` — everyone at or above an office. Truncation hands those people
their own code as their service center. The stored walk returns `''`, which is
the truth: they have none, and they route from the DAC stage. Depth also
varies by branch — FCA has no sub-office level while FCB and FCC do, so FCA0A
is two levels deep and FCBAA three.

**The two defects concealed each other.** Fixing the title match alone would
have made it worse: a correct SCD returns `FCA0B` while the dashboards still
computed `FCA0`, the two never compare equal, and the director reaches an
empty queue that reads as "no requests yet."

### The `sector_override` over-grant is latent

`active sector_override rows: 0`, so nothing is wrong today. It would appear
the first time one is granted.

`HC_Orgs.Sector` is `'ASD'` on **all 137 rows**, so a single scope name
matches the whole organization. Scope `"ASD"` resolves to 137 of 137 org
codes. The scope *matchers* are fixed (`orgCodeInScope` walks the hierarchy),
but the **scope VALUE** is still a sector NAME, and that name is useless as a
discriminator here. If `sector_override` is ever to be used, `Scope` should
hold a `SERVICE_CENTER` code and the Users page should offer the 22 centers
rather than one meaningless "ASD".

### A completion signal must be derived from the work, not from a cursor

The directory sweep reported false completion three times, by three routes,
each fixed in isolation before the shared cause was named: `complete` came
from WHERE THE CURSOR SAT, never from whether anyone still needed an address.
The third symptom — cursor parked at 1046 of 1046 — cost @clolry eight manual
runs that did nothing and logged success. Fixed in `80bec3b` by deriving
completion from a fresh count of outstanding work.

### A guard must assert the thing, not a proxy for it

Four occurrences now, and the newest is the clearest:

- **`.length` is not evidence of printing.** `diagServiceCenterDirectors`
  computed two report sections and printed neither. My first test accepted
  `unresolved.length` as a read — but that is the `if` guard above the
  `forEach`, so deleting the `forEach` still passed. Tightened to require
  `forEach`/`join`/`map`.
- **Strip comments before asserting on source text.** Six occurrences. A
  file's own explanation of why it does not do X satisfies a naive grep for X.
- **Negative controls break silently when their patch target moves.** Anchor
  on code the change under test must touch, not on a comment or a variable
  name.
- **Count-threshold guards do not bite.** `grep -c ... -lt 5` passed when a
  fifth entry point was added and any single guard deleted.

### A scripted multi-part edit can half-apply

The missing report sections were caused by a Python edit that applied its
first replacement, raised on a later anchor, and never wrote the file. An
unused variable is not a JS error and no test read that output, so nothing
failed. **Re-read the result of every scripted edit.**

### @clolry's live output has caught more than any test

The eight Halls, the org suffix on surnames, OBLIGATED meaning a temp
promotion, the FCC0C wrong-director, the two unprinted report sections. **Ask
for a real run before building the next layer on an assumption.**

### Other standing traps

**`grep` treats several repo files as binary** because they contain `✓`/`⚠`
and this container has no UTF-8 locale. Output-consuming greps need `-a` or
the guard silently passes. `test_branding.js` §7c enforces this; two guards
had been dead for exactly this reason.

**Go.gov truncates trip names at exactly 40 characters.** So the LETS ID goes
at the FRONT. This is the whole basis of the SOP.

**`Amount Approved`, never `Report Total`.** They differ on 51 of 274 rows by
$6,009.34.

**An ID match must still verify the traveler.** The test asserting this FAILED
when first written — Brandon Maness's $1,922.96 landed on another traveler's
request.

---

## Known-good numbers, for checking a regression against

| | |
|---|---|
| ASD discretionary | $444,500.00 |
| Roster positions | 1,046 |
| Named rows (people) | 821 |
| Email coverage | 821 of 821 — zero gaps |
| Service centers | 22 |
| Centers routing to a real person | 21 of 22 (FCB0B vacant) |
| Org codes in `HC_Orgs` | 137 |
| Supervisory positions (`!= 8`) | 180 of 1,046 |
| Non-supervisory | 866 |
| OBLIGATED rows | 19 |
| TEMP PROMOTION rows | 11 |
| Directors from an OBLIGATED seat | 1 (Eberle, FCC0C) |
| FY27 travel log rows | 30 |

---

## Decisions @clolry made, so they are settled

**On the roster and identification:**

- Anything except `Supv Lvl` 8 is a supervisor; 8 is not.
- A Service Center Director is identified by `Org_Level`, never by title.
- No grade check on the SCD lookup. Grade breaks ties only.
- Two supervisors in one workgroup → the higher grade wins.
- Eberle is included in the FCC0C headcount, and is its approver.
- **American spelling everywhere, including identifiers.** "please NEVER use
  the brittish spelling."

**On routing and access:**

- Every employee submits their own request; it routes through their
  supervisor.
- Supervisor = highest grade `!= 8` in the same org code.
- The supervisor stage is additional, not a replacement for the SCD stage.
- A supervisor's own request goes to the next approver.
- Taylor Wynings approving his own request is acceptable — Go.gov routes it to
  Jack Tekus afterward.

**Older, still binding:**

- Reuse the `BACKFILL` marker rather than a new status for imports.
- Actuals trip-level only; estimates keep their category breakdown.
- Budget figures readable by all, writable by admins — "we're trying to
  develop transparency."
- Org attribution comes from LETS, never Go.gov's `Org Level 3`.
- Fiscal year is 1 October – 30 September.
- Eventually all five FAS portfolios; for now ASD/FC only.

---

## Still waiting on @clolry

- **Nothing is blocking.** The three nickname decisions and the
  `Hall,Joseph C` question are **void** — the new feed carries every address,
  so there is nothing to resolve by hand.
- **Whether `FCA0EA` is contractor-heavy** was a directory-lookup question and
  no longer matters.
- **Does Chiquita keep maintaining her workbook**, or does LETS become the
  source of truth after the first import? The importer supports repeated runs
  either way; the answer decides whether anyone keeps reconciling two sets of
  numbers.
- **She should be told that LETS will not match her variance column**, before
  the two diverge in a meeting. Hers is computed from Report Total (claimed),
  LETS uses Amount Approved (paid). Across her 20 matched rows: hers
  −$326.93, true −$1,491.32, gap $1,164.39 — exactly the disallowed amount.
  Every batch records `Variance_Basis` so the question has an answer on the
  record.

---

## Not started

**The Org Code ledger**, the next substantial piece after routing. @clolry's
specification:

> Columns for Org Code, Trips, Estimated $, Actual $, Pending $, Total
> Committed, Allocated Budget, Remaining Budget, Budget Health (colored bar).
> All org codes in proper org-chart structure, expandable per org to show that
> org's travel records — traveler name, type, purpose, route, dates, and the
> three dollar columns. Filterable by all orgs / FC / FCA etc., searchable by
> org code or traveler.

Decisions already made:

- Estimated/Actual/Pending as three columns; estimates retained after actuals
  arrive.
- Spend at **every** hierarchy level; Allocated/Remaining only where a real
  allocation exists (4 DACs + 22 service centers). Do not invent
  division-level budgets.
- Per-center spend must come from `Request_Travelers`, not `Requests` — a
  request carries one `Owning_Office` but a consolidated conference request
  holds travelers from several DACs. `BudgetDashboard.spendByServiceCenter`
  already does this correctly; reuse it.

**The daily liability-log pull.** `LiabilityLogSync.js` parses and plans but
has no sheet read or trigger. `LIABILITY_LOG_SHEET_ID` is set. @clolry
approved writing a `LETS_Key` column back to his sheet for idempotency — the
log's own `Document Number` is empty on 29 of 30 rows.

**Event set-asides**, asked for three sessions ago. Nothing blocks it now that
the dashboard knows real balances.

**Org chart web app** (`orgchart_app/`) — built, never rendered.

---

## Reference files — LOCAL ONLY, never commit

`reference_excel_files/` holds named GSA staff, travel costs and the FY27
liability log. Gitignored by pattern; `test_hc_roster_import.js` §7 fails the
build if any server file references that directory.

The May staffing plan (`Copy of ASD Staffing Plan 5-12-26.xlsx`) is **stale
and must not be read** — it puts Melissa Mould in the wrong org, and every
per-capita figure derived from it was wrong. The roster comes from the
`FC_WF_Data_Report` property and nothing else, and
`getFcWorkforceFeedSource()` returns an ERROR rather than a default precisely
because every available fallback is a stale roster.

| file | contents |
|---|---|
| `report_12947.xls` | 182 expense rows |
| `Expense Report (Sept-Nov).xls` | 522 rows, 391 real traveler names + employee IDs |
| `Travel requests (Sept - Nov).xls` | 565 rows, 415 real names |
| `Copy of ASD Staffing Plan 5-12-26.xlsx` | **STALE** — 806 named staff |
| `_Expense Report Calculations File for LETS.xlsx` | Chiquita's workbook, 8 tabs, ~1,900 names |

`test_gogov_sync.js` §8 and `test_travel_import.js` §21 read fixtures from
`/tmp` and SKIP cleanly when absent, so a fresh checkout passes. §21's fixture
regenerates with one command:

```sh
python3 scripts/workbook_to_fixture.py    # expect 28 requests, 10 expenses
```

---

## Deferred, with reasons — not forgotten

| # | Item | Why deferred |
|---|---|---|
| 1 | **`travelPortalStyles` sets `overflow: hidden` on bare `html`/`body`** (lines 137, 144). Root cause of the budget page's scroll lock; the fix applied was a per-page scroller. Any future page including this stylesheet hits the same trap. | Fixing it means touching the portal, which works. |
| 2 | **Collapse-by-`max-height` loses its expand animation.** `max-height` cannot transition to `none`. The fix that keeps both is `grid-template-rows: 0fr → 1fr`, needing each panel wrapped in a grid container. | A real layout change; needs a browser to verify. |
| 3 | **Fixed-bar offsets track the TOKEN, not the rendered height.** Under text-only zoom a bar can outgrow its token and content slides under. Real fix is `position: sticky`. | Needs browser verification. |
| 4 | **`controllers/form/travelRequestController.html:1225` hardcodes `fixedHeaderHeight = 52`** — the CSS magic number, now in JS where the token cannot reach it. | One line, but needs a browser to confirm the scroll lands. |
| 5 | **`.oc-modal` is defined twice** — `travelAdminStyles.html:5431` and inline in `travelBudgetDashboardPage.html:42`. | Pre-existing, documented decision. |
| 6 | **`GogovSync.toDateString` mis-parses a string serial** — `'46356'` → year 46356. `TravelImport` resolves it before delegating, so the importer is safe, but the monthly reconciliation path shares that function and would silently drop a row out of scope. | Widening it touches behavior pinned by `test_gogov_sync.js` §3. |
| 7 | **`docs/evidence/verify_city_dropdown_fix.js` throws.** Pre-existing, not wired into CI. | Needs whoever wrote the per-diem fix. |
| 8 | **One traveler needs manual matching every run** (Patnaik — three requests share his name and title). Correct behavior; recurs until a LETS ID appears in the trip name. | A people problem, not a code one. |
| 9 | **No edit or delete for an imported travel row.** Mistakes need fixing in the spreadsheet. | @clolry was asked and has not said whether it matters. |
| 10 | **`getBudgetDashboard` and `getTravelEventHistory` are unguarded**, consistent with the transparency decision. | Worth a second look if DAC balances become sensitive. |

`gh` cannot file these as issues — `GITHUB_TOKEN` is invalid in this
environment. **This is a handoff note, not a tracker.**

---

## What is built

**Committed and live:**

- HR roster import from the FC workforce report (`30_services/HCRosterImport.js`,
  `40_domain/HCRosterSync.js`)
- Service Center Director resolution by org level (`30_services/Access.js`,
  `01_constants/HCRules.js`)
- Per-capita service-center headcount, one seat per person
  (`20_data/HCData.js`)
- FY27 budget model, allocations, KPIs (`40_domain/BudgetDashboard.js`,
  `BudgetAdmin.js`)
- Existing-travel import with preview/commit/rollback
  (`30_services/TravelImport.js`, `40_domain/TravelImportAdmin.js`) —
  **not browser-verified; no live import has run**
- Go.gov parser + matcher (`30_services/GogovSync.js`)
- Event attendance history (`30_services/EventHistory.js`)
- Directory email lookup (`30_services/DirectoryLookup.js`) — **obsolete,
  delete it**

**Diagnostics worth knowing about**, all read-only, all admin-guarded:

| function | file | what it answers |
|---|---|---|
| `diagServiceCenterDirectors()` | `99_triggers/Diagnostics.js` | who each center routes to, and why |
| `diagnoseHrFeedSource()` | `40_domain/HCRosterSync.js` | the feed's columns, vocabularies, email coverage |
| `diagAll()` | `99_triggers/Diagnostics.js` | everything, including the code census |
| `showServiceCenterHeadcount()` | `40_domain/HCRosterSync.js` | the 22-row per-capita table |
| `previewRosterImport()` | `40_domain/HCRosterSync.js` | what an import would change, before it changes it |
