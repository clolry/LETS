# Session state — 2026-11-05

Read this, then `docs/handoff/03-directory-sweep-completion.md`, then
`git log --oneline -20`.

## Where things stand

Branch `sandbox` @ `cb9dd12`, **pushed**, clean tree. 38 test suites pass.

```sh
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" >/dev/null || echo "FAIL $f"; done
node scripts/gen-editor-functions.js --check
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
