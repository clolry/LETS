# Handoff — directory sweep completion is derived from the wrong thing

**Status:** one bug open, diagnosed, not fixed. Everything else from this
session is pushed and working.

**Branch:** `sandbox` @ `cb9dd12`, pushed, clean tree, 38 suites pass.

---

## Read this first: the shape of the mistake

The directory email sweep has reported false completion to @clolry **three
times, by three different routes.** I fixed each one and none of them was the
actual problem, because all three shared a cause I did not name:

> `complete` has been derived from WHERE THE CURSOR IS, never from WHETHER
> ANYONE STILL NEEDS AN ADDRESS. Those two only coincide by accident.

The three symptoms, in order:

1. `complete` meant "the loop reached the end of the list" — so a run that
   errored on 281 positions reported done. Fixed in `bfaa0de`.
2. A position that errored, waited out the quota and then resolved was still
   counted as a failure, so a fully successful run reported itself incomplete.
   Fixed in `cb9dd12` via `unresolvedByError`.
3. **Open.** The stored resume index was parked at 1046 (the roster length), so
   the next run's loop never executed: zero lookups, zero errors,
   `reachedEnd: true` → `complete: true`. It did nothing and declared victory.

If you fix only #3 as stated, a fourth route will appear. Fix the derivation.

### The evidence #3 is real

- 9:36 PM — `runEmailResolutionQueue` reported **564 staffed positions with no
  address**.
- Eight `runDirectoryResolve` runs wrote **346** addresses
  (76+0+3+86+0+94+1+86).
- So roughly **218 people still have no email**, including the ~130 the
  pre-`cb9dd12` skip bug abandoned.
- 10:03 PM — `runDirectoryResolve` reported `lookups: 0, complete: true`.

`runEmailResolutionQueue`'s "N staffed positions still have no address" count
has been accurate throughout. It is the number to trust, and the one `complete`
should be derived from.

---

## The fix

All in `lets_app/server/40_domain/DirectoryResolve.js`, function
`resolveDirectoryEmails` (around line 575).

### 1. A cursor at or past the end means "wrap", not "done"

Line ~589:

```js
var start = parseInt(o.startIndex, 10);
if (isNaN(start)) start = _directoryResumeIndex_();
```

If `start >= bundle.data.length`, reset it to 0. The roster also shrinks when
positions are removed, so this is not only reachable after a completed sweep.

### 2. Derive completion from the work remaining

After the batch and the write, count positions that still need an address —
the same predicate `getEmailResolutionQueue` already uses (line ~470):

```js
x && x.occupancyStatus !== 'VACANT' && x.employeeName &&
  !x.emailAddress && !overrides[x.positionNumber]
```

Count it from a FRESH `HC.hcGetBundle()` after the write, not from the
pre-write `bundle` — the cache is invalidated at line ~714 and the stale copy
would undercount by however many were just written.

`complete` should be `stillNeedingEmail === 0`. Not `batch.complete`, not
`reachedEnd`. Put the count in the response and in the log line so the claim is
checkable against something real.

### 3. Only clear the resume index on real completion

Line ~720:

```js
_setDirectoryResumeIndex_(batch.complete ? 0 : batch.nextIndex);
```

Should key off the derived completion, and when `reachedEnd` is true but work
remains it should store `0` so the next run wraps to the top and picks up the
gaps rather than sitting at the end.

### 4. Tests — `lets_app/test_directory_lookup.js`

The suite has 274 assertions in 27 sections; add §28. Needed:

- a cursor at `roster.length` resolves positions rather than no-opping
- a cursor past `roster.length` (shrunken roster) also wraps
- `complete` is false when positions still need an address, even with
  `reachedEnd: true` and zero errors — **this is the #3 regression**
- `complete` is true only when the count is zero
- the resume index stores 0 when `reachedEnd` with work remaining
- **negative control:** restore `complete: batch.complete` and confirm the
  above fails

`resolveDirectoryEmails` touches `SpreadsheetApp`, `HC` and
`PropertiesService`, so either extract the completion decision into a pure
helper in `30_services/DirectoryLookup.js` (preferred — the whole file is pure
and injectable for exactly this reason) or assert on source text with comments
stripped.

**Strip comments before any source-text assertion.** That trap has bitten four
times in this project: `test_markup_integrity`, `test_page_markup`,
`test_hc_roster_import`, and `test_directory_lookup` §7. A file's own
explanation of why it does not do X satisfies a naive grep for X.

---

## Do not install the trigger until this is fixed

`installDirectoryLookupTrigger()` is set to every 10 minutes. With the cursor
at 1046 it would run every 10 minutes, do nothing, and log success.

### Immediate unblock, no code needed

From a scratch function in the editor:

```js
function sweepFromTop() {
  console.log(JSON.stringify(resolveDirectoryEmails({ startIndex: 0 }), null, 2));
}
```

Two runs covers the ~218 remaining. The pacing (650ms) and rewind fixes in
`cb9dd12` are sound; only the resume bookkeeping is wrong.

---

## What is already working — do not re-litigate

The matching logic is good: **46 of 50** on the last clean preview, zero
ambiguous. Resolution methods, strongest first:

| Method | What it means |
|---|---|
| `unique-name` | one exact surname + forename match |
| `email-confirms-name` | mailbox carries both legal names as whole tokens |
| `org-code` | namesakes separated by the directory's org suffix |
| `compound-surname` | `Heller` vs `Azarcon Heller`, three conditions required |
| `verified-convention` | constructed `first.last@gsa.gov`, then looked up |

Deliberate refusals, which must stay refused:

- nicknames whose mailbox also uses the nickname — Kittrell→Kim, Cayo→Win,
  Schollaert→Charley. Only @clolry knows these.
- `Hall,Joseph C` — eight Halls, no Joseph, and @clolry could not find
  `joe.hall@gsa.gov` either despite the manual org chart listing it. Three
  sources, two disagreeing. Not a code problem.
- a shared first letter is **not** a signal. Offering `Jermaine Hall` for
  `Joseph C Hall` was a real regression; the bar is a 3-character shared
  prefix, measured against this roster's actual nicknames.

Admin resolutions persist in `HC_Email_Overrides`, keyed on `Position_Number`,
re-applied by `importRoster`. @clolry has recorded none yet.

---

## Also open, lower priority

**`hc_bundle_v1` logs an oversize warning on every run.** The chunked cache in
`dd536b4` works — "HC: cached 1046 positions in chunks" follows it — but
`_cachePut_` warns before returning false and the fallback is silent. Cosmetic,
and it reads as a failure when it is the designed path. Downgrade to `log` or
move the message into the fallback.

**`runEmailResolutionQueue` for the three nicknames.** Each prints a pre-filled
`saveEmailOverride(...)` call. Worth doing once the sweep is clean.

---

## Project conventions that matter here

- **Positional writes.** Always map over the schema headers from
  `TRAVEL_SHEET_SCHEMAS`; never build a row by hand. `appendRow` pads short
  rows silently — that is how `DD_Confirmed` was lost once.
- **`var LETS_CONFIG`, never `const`** in `00_config/BudgetConfig.js`. CI
  guards it.
- Admin writes need `_hcAdminGuard_()` **and** `LockService`.
- Invalidate the HC cache after any `HC_Positions` write — six-hour TTL
  otherwise, which reads as "the write did not save".
- `docs/EDITOR_FUNCTIONS.md` is generated: `node scripts/gen-editor-functions.js`,
  and CI fails if stale.
- Tag editor-runnable functions `@editor` or they will not appear in that index.

## Verify

```
for f in lets_app/test_*.js orgchart_app/test_*.js; do node "$f" >/dev/null || echo "FAIL $f"; done
node scripts/gen-editor-functions.js --check
```

38 suites, all passing at `cb9dd12`.
