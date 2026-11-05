# Editor functions

Every function meant to be run by hand from the Apps Script editor,
with the file and line to find it.

**This file is generated.** Run `node scripts/gen-editor-functions.js`
after adding or moving an `@editor` function; CI fails if it is stale.
A hand-maintained index would be wrong within a week, and a stale index
is worse than none — it sends a reader to a file that no longer holds the
function, and they conclude the function is gone.

## How to run one

1. Open the Apps Script project (Extensions → Apps Script, or script.google.com).
2. Open the file named in the table below from the left-hand file list.
3. Choose the function in the dropdown at the top, then **Run**.
4. Read **Execution log** for the output.

Functions taking arguments cannot be run from the dropdown directly —
the editor passes no parameters. Call them from a one-line wrapper, or
use the argument-free variant where one is listed.

## Setting up — run once, in this order

A new or rebuilt environment needs these, in sequence. `setupTravelDatabase` creates every tab; nothing else works until it has run.

| Function | File | Line | What it does |
|---|---|---:|---|
| `hcLoadRealOrgCodes()` | `lets_app/server/40_domain/HCAdmin.js` | 263 | Loads @clolry's 137 real org codes into HC_Orgs, from the admin GUI. |
| `setupTravelDatabase()` | `lets_app/server/91_setup/Database.js` | 54 | Main setup function - creates all Travel Request sheets with headers |
| `backupTravelDb(…)` | `lets_app/server/91_setup/Database.js` | 1150 | Duplicate the production spreadsheet via Drive. Run from the GAS editor |
| `_bulkDeleteSmokeRequests(…)` | `lets_app/server/91_setup/Database.js` | 1193 | Find every Requests row whose Trip_Name starts with '[SMOKE]' and delete it |
| `loadRealOrgCodes()` | `lets_app/server/91_setup/HCSeed.js` | 428 | Loads the 137 real org codes into HC_Orgs, REPLACING what is there. |

## HR roster — the FAS HRLinks feed

The roster drives approval routing, supervisor-based site access and every per-capita budget figure. Run the diagnostic first if anything is unexpected: it reports which code version is actually deployed.

| Function | File | Line | What it does |
|---|---|---:|---|
| `diagnoseHrFeedSource()` | `lets_app/server/40_domain/HCRosterSync.js` | 101 | Reports which HR feed source this DEPLOYMENT is actually reading. |
| `previewRosterImport(…)` | `lets_app/server/40_domain/HCRosterSync.js` | 197 | Dry run: what importing the feed would change. |
| `showServiceCentreHeadcount()` | `lets_app/server/40_domain/HCRosterSync.js` | 553 | The per-service-centre headcount, as a readable table. |
| `importRoster(…)` | `lets_app/server/40_domain/HCRosterSync.js` | 735 | Applies the import. Destructive: replaces every row in HC_Positions. |
| `seedHCTestData(…)` | `lets_app/server/91_setup/HCSeed.js` | 708 | Seeds both HC tabs with FICTIONAL test data. |
| `validateHCData()` | `lets_app/server/91_setup/HCSeed.js` | 916 | Read-only sanity check on whatever is currently in the HC tabs. |
| `clearHCPositions(…)` | `lets_app/server/91_setup/HCSeed.js` | 1103 | Empties HC_Positions. Keeps HC_Orgs. |

## Email addresses — Google directory lookup

The HR feed carries no email column, and Email_Address is how LETS identifies a signed-in user. Requires the People advanced service: Apps Script editor -> Services -> People API (v1).

| Function | File | Line | What it does |
|---|---|---:|---|
| `previewDirectoryEmails(…)` | `lets_app/server/40_domain/DirectoryResolve.js` | 180 | Dry run: what the directory would resolve, without writing anything. |
| `diagnoseDirectoryBuild()` | `lets_app/server/40_domain/DirectoryResolve.js` | 337 | Reports which build of the directory matcher is deployed. |
| `diagnoseDirectoryMatch(…)` | `lets_app/server/40_domain/DirectoryResolve.js` | 484 | Prints the RAW directory response for one name. |
| `resolveDirectoryEmails(…)` | `lets_app/server/40_domain/DirectoryResolve.js` | 565 | Resolves and WRITES email addresses onto HC_Positions. |
| `syncDirectoryEmails()` | `lets_app/server/40_domain/DirectoryResolve.js` | 785 | Trigger entry point: resumes the sweep where it stopped. |
| `installDirectoryLookupTrigger()` | `lets_app/server/40_domain/DirectoryResolve.js` | 802 | Installs an hourly trigger until the sweep completes. |

## Budget

| Function | File | Line | What it does |
|---|---|---:|---|
| `releaseSetAside(…)` | `lets_app/server/40_domain/SetAsideRelease.js` | 348 | Releases money from a reservation and records where it went. |

## Reference data syncs and their triggers

Per diem rates, GSA City Pair airfares and the directory sweep. Each `install…Trigger` removes its own prior trigger first, so running one twice does not create two schedules.

| Function | File | Line | What it does |
|---|---|---:|---|
| `clearGSACitiesCache()` | `lets_app/server/30_services/PerDiemGSA.js` | 366 | Drop every CONUS state's cached city list. Run from the Apps Script |
| `syncCityPairs()` | `lets_app/server/91_setup/CityPairSync.js` | 168 | Downloads the current fiscal year's CSV and replaces the City_Pairs tab. |
| `installCityPairSyncTrigger()` | `lets_app/server/91_setup/CityPairSync.js` | 318 | Installs the daily sync trigger at 05:00 project time. |
| `setupDoDSyncTrigger()` | `lets_app/server/99_triggers/PerDiemSync.js` | 21 | Set up daily trigger for automatic DoD per diem sync. Runs at 6 AM. |
| `removeDoDSyncTrigger()` | `lets_app/server/99_triggers/PerDiemSync.js` | 44 | Remove the DoD per diem sync trigger. |
| `setupForeignPerDiemTrigger()` | `lets_app/server/99_triggers/PerDiemSync.js` | 70 | Set up monthly trigger to auto-sync DOS per diem data. Runs on the 2nd |
| `removeForeignPerDiemTrigger()` | `lets_app/server/99_triggers/PerDiemSync.js` | 94 | Remove the DOS per diem sync trigger. |

## Editor runners — wrappers for functions that take arguments

The Apps Script Run button passes no arguments, so these wrap the functions that need them. **`runRosterImport` and `runDirectoryResolve` WRITE DATA.** The other three write nothing. Each wrapper prints its result, because a value returned to the Run button is never displayed.

| Function | File | Line | What it does |
|---|---|---:|---|
| `runRosterPreview()` | `lets_app/server/99_triggers/Diagnostics.js` | 1224 | Preview the HR roster import, and print the result. |
| `runRosterImport()` | `lets_app/server/99_triggers/Diagnostics.js` | 1297 | Apply the HR roster import. DESTRUCTIVE — replaces every row in |
| `runClearHCPositions()` | `lets_app/server/99_triggers/Diagnostics.js` | 1384 | Empty HC_Positions. DESTRUCTIVE. |
| `runDirectoryPreview()` | `lets_app/server/99_triggers/Diagnostics.js` | 1408 | Preview the directory email lookup, and print the result. |
| `runDirectoryResolve()` | `lets_app/server/99_triggers/Diagnostics.js` | 1458 | Resolve directory email addresses and WRITE them to HC_Positions. |
| `runEmailResolutionQueue()` | `lets_app/server/99_triggers/Diagnostics.js` | 1530 | Show the email-resolution queue: who needs an address, and what to offer. |
| `runSaveEmailOverride()` | `lets_app/server/99_triggers/Diagnostics.js` | 1611 | Record one admin email decision. |
| `runBudgetDashboard()` | `lets_app/server/99_triggers/Diagnostics.js` | 1644 | Print the current budget dashboard payload. |

## Diagnostics — safe to run any time, write nothing

Start with `diagAll`. These read and report; none of them change data.

| Function | File | Line | What it does |
|---|---|---:|---|
| `diagAll()` | `lets_app/server/99_triggers/Diagnostics.js` | 83 | Runs every diagnostic. Start here after a deploy. |
| `diagEnvironment()` | `lets_app/server/99_triggers/Diagnostics.js` | 112 | Environment, database binding, and Script Property presence. |
| `diagCityPairs()` | `lets_app/server/99_triggers/Diagnostics.js` | 272 | City Pair data: how much, how fresh, and does a lookup work. |
| `diagHcData()` | `lets_app/server/99_triggers/Diagnostics.js` | 372 | HC roster: counts, referential problems, and a live supervisor-chain walk. |
| `diagAirportPrefs()` | `lets_app/server/99_triggers/Diagnostics.js` | 469 | Stored airport preferences and whether promotion is working. |
| `diagTriggers()` | `lets_app/server/99_triggers/Diagnostics.js` | 534 | Installed triggers, and whether their handlers still exist. |
| `diagDutyStationAirports()` | `lets_app/server/99_triggers/Diagnostics.js` | 592 | Does every HC duty-station city resolve to an airport? |
| `diagUnresolvedCityNames()` | `lets_app/server/99_triggers/Diagnostics.js` | 667 | Zero-argument companion to diagDutyStationAirports. |
| `diagCityNamesForState(…)` | `lets_app/server/99_triggers/Diagnostics.js` | 724 | Every city name GSA uses in one state, with its airport codes. |
| `diagFasTrackerRow()` | `lets_app/server/99_triggers/Diagnostics.js` | 818 | Prints the FAS tracker row LETS would submit, beside the expected columns. |
| `diagFasTrackerHeader()` | `lets_app/server/99_triggers/Diagnostics.js` | 938 | Compares the live tracker header against FAS_TRACKER_COLUMNS. |
| `diagTripOverviewFields()` | `lets_app/server/99_triggers/Diagnostics.js` | 1002 | Trip Overview and budget-attribution fields on recent requests. |
| `diagAccess()` | `lets_app/server/99_triggers/Diagnostics.js` | 1087 | Who currently holds site access, and by which path. |

## Cache warming and adoption checks

Mostly internal verification used while refactoring. `forceRefreshHCStaffingBundle` is the one worth knowing: it rebuilds the HC cache after a roster change.

| Function | File | Line | What it does |
|---|---|---:|---|
| `forceRefreshHCStaffingBundle()` | `lets_app/server/99_triggers/CacheWarming.js` | 55 | Force a full HC staffing-bundle refresh — busts BOTH server cache layers |
| `installHCRefreshTrigger()` | `lets_app/server/99_triggers/CacheWarming.js` | 73 | Install the HC staffing cache refresh trigger. Safe to re-run. |
| `installTravelDBWarmingTrigger()` | `lets_app/server/99_triggers/CacheWarming.js` | 106 | Install the TravelDB warming trigger. Idempotent — removes existing |
| `removeTravelDBWarmingTrigger()` | `lets_app/server/99_triggers/CacheWarming.js` | 137 | Remove the TravelDB warming trigger. Cache continues to serve from |
| `installGSACitiesWarmingTrigger()` | `lets_app/server/99_triggers/CacheWarming.js` | 192 | Install (or reinstall) the GSA cities warming trigger. |
| `removeGSACitiesWarmingTrigger()` | `lets_app/server/99_triggers/CacheWarming.js` | 206 | Remove the daily GSA cities warming trigger. |
| `_checkAllTriggersHealth()` | `lets_app/server/99_triggers/CacheWarming.js` | 234 | List every installed project trigger with handler name + source + event |
| `_checkSheetNamesAdoption()` | `lets_app/server/99_triggers/CacheWarming.js` | 289 | Verify every name in SHEET_NAMES (01_constants/Sheets.js) resolves to an |
| `_verifyStatusActionAdoption()` | `lets_app/server/99_triggers/CacheWarming.js` | 328 | Verify Chunk 8b adoption: every STATUS_CODES / ACTION_TYPES value resolves |
| `_verifySubmissionDomainAdoption()` | `lets_app/server/99_triggers/CacheWarming.js` | 466 | Verify Chunk 10.E Submission domain adoption: confirms function existence |
| `_verifyAdminDomainAdoption()` | `lets_app/server/99_triggers/CacheWarming.js` | 556 | Verify Chunk 10.D Admin domain adoption: live calls to read endpoints, |
| `_verifyReportingDomainAdoption()` | `lets_app/server/99_triggers/CacheWarming.js` | 653 | Verify Chunk 10.C Reporting domain adoption: calls reportGetFilterOptions |
| `_verifyFeedbackDomainAdoption()` | `lets_app/server/99_triggers/CacheWarming.js` | 746 | Verify Chunk 10.B Feedback domain adoption: calls checkNpsEligibility + |
| `_verifyReviewDomainAdoption()` | `lets_app/server/99_triggers/CacheWarming.js` | 825 | Verify Chunk 10.F.1 Review domain adoption: confirms function existence, |
| `_verifyValidationLibrary()` | `lets_app/server/99_triggers/CacheWarming.js` | 944 | Verify Chunk 11 Validation library: exercises every require* guard with |
| `_verifyEmailColorMirror()` | `lets_app/server/99_triggers/CacheWarming.js` | 1140 | Verify Chunk 13 EMAIL_STYLES.colors integrity: |
| `_verifyUsersDomainAdoption()` | `lets_app/server/99_triggers/CacheWarming.js` | 1237 | Verify Chunk 10.A Users domain adoption: live call to listTravelUsers returns |
| `_verifyTravelDBWriteHelpers()` | `lets_app/server/99_triggers/CacheWarming.js` | 1336 | Verify Chunk 10.0 TravelDB write helpers. Creates a temp scratch sheet inside |
| `_diagnoseGSACitiesWarmer()` | `lets_app/server/99_triggers/CacheWarming.js` | 1465 | Diagnostic: report status of the GSA cities warming trigger + cache. |
| `_probeHcDistinctValues(…)` | `lets_app/server/99_triggers/CacheWarming.js` | 1516 | Diagnostic: list every distinct value of a given field across the HC bundle |
| `_probeHcForUser(…)` | `lets_app/server/99_triggers/CacheWarming.js` | 1569 | Diagnostic: search the HC bundle for ANY position where any field contains |
| `_verifyDateTimeAdoption()` | `lets_app/server/99_triggers/CacheWarming.js` | 1670 | Verify Chunk 9 adoption: every DateTime.js helper exists, produces expected |
| `_probeDateFormats()` | `lets_app/server/99_triggers/CacheWarming.js` | 1782 | Probe date-column shapes across every sheet. Reports JS types + string |
| `_checkAllPageTemplates()` | `lets_app/server/99_triggers/CacheWarming.js` | 1970 | Smoke-test every served page template by running it through full GAS |
| `installCityPairWarmingTrigger()` | `lets_app/server/99_triggers/CacheWarming.js` | 2209 | Install (or reinstall) the city-pair warming trigger. |
| `removeCityPairWarmingTrigger()` | `lets_app/server/99_triggers/CacheWarming.js` | 2223 | Remove the city-pair warming trigger. |

## Testing and routing simulation

Simulations do not submit anything. The FAS tracker test functions DO write a row — read their comments before running them.

| Function | File | Line | What it does |
|---|---|---:|---|
| `simulateSubmissionRouting(…)` | `lets_app/server/40_domain/Submission.js` | 1169 | Trace what would happen if `submitterEmail` submitted a request right now. |
| `_bustRoutingCachesForTesting()` | `lets_app/server/40_domain/Submission.js` | 1317 | Editor helper: clear every cache that could be holding stale role |
| `_testRouting()` | `lets_app/server/40_domain/Submission.js` | 1353 | Editor convenience wrapper: edit TEST_EMAIL + TEST_OVERHEAD, save, |
| `simulateAllRoutingPaths()` | `lets_app/server/40_domain/Submission.js` | 1394 | Walk HC staffing for one representative submitter per BU and simulate |
| `simulateRoutingForList(…)` | `lets_app/server/40_domain/Submission.js` | 1489 | Run simulateSubmissionRouting across a hand-picked list of submissions. |
| `_testRoutingList()` | `lets_app/server/40_domain/Submission.js` | 1537 | Editor convenience wrapper for simulateRoutingForList. Edit the |
| `_testAllRoutingPaths()` | `lets_app/server/40_domain/Submission.js` | 1683 | Editor convenience wrapper for simulateAllRoutingPaths. Logs a flat |
| `submitFASTrackerTestRow()` | `lets_app/server/91_setup/FASTrackerTest.js` | 55 | Appends one diagnostic row to the TEST tracker copy. |
| `deleteFASTrackerTestRows()` | `lets_app/server/91_setup/FASTrackerTest.js` | 201 | Deletes every row whose Event Name carries FAS_TEST_ROW_MARKER. |

## Everything else

| Function | File | Line | What it does |
|---|---|---:|---|
| `initEmailConfigDefaults()` | `lets_app/server/00_config/Props.js` | 746 | Report the effective email sender configuration. Read-only. |
| `_verifyAllPropsKeys()` | `lets_app/server/00_config/Props.js` | 764 | Verify every key in PROPS_KEYS resolves either to a set property OR a |
| `initTravelEmailConfig()` | `lets_app/server/30_services/Email.js` | 113 | Initialize travel email configuration. Delegates to Props.js |
| `debugReviewerPerf(…)` | `lets_app/server/40_domain/Admin_Dashboard.js` | 143 | Diagnostic: per-action breakdown for a single reviewer email. |

---

Generated from the `@editor` JSDoc tag across `lets_app/server/**/*.js`.
