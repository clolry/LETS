# How to Turn On GSA Per Diem (CONUS)

**A step-by-step guide. No coding knowledge assumed.**

| | |
|---|---|
| **What this does** | Makes the system fetch real lodging and meal rates from the government's per-diem service for travel **inside the lower 48 states and DC — 49 locations** |
| **What this does NOT do** | Alaska, Hawaii, Puerto Rico, Guam, USVI, American Samoa and the Northern Marianas use a **different** source (DoD). Foreign travel uses a **third** source (State Dept). Neither is covered here. **CONUS travel works fine without them** |
| **How long** | About **40 minutes**, most of it waiting and checking |
| **Can you break production?** | **Only at Step 4.** Steps 1–3 are reading and preparation |
| **What you need** | An **administrator** account in the LETS Apps Script project, and an email address to register for a free API key |

---

## Read this first: three facts that make every step make sense

**1. There are three separate per-diem systems, and only one needs an API key.**

| Source | Covers | Where its data lives | Needs a key? |
|---|---|---|---|
| **GSA** | The lower 48 + DC | **Nowhere.** Fetched live, held in temporary memory | **Yes** |
| DoD | AK, HI, PR, VI, GU, AS, MP | A spreadsheet tab | No |
| State Dept | Foreign countries | A spreadsheet tab | No |

**GSA is the odd one out: there is no GSA tab in the spreadsheet.** Nothing is stored. The system asks the government service every time, then remembers the answer for a few hours. **If you go looking for a tab of CONUS rates, you will not find one, and nothing is wrong.**

**2. The system has never set this key, and it never will.**

The key lives in a settings screen, not in the code — that is correct practice, because code gets published and keys must not be. We checked: **the system reads this key in two places and writes it in none.** So it is set by hand or it is not set at all. **You are about to do the only thing that can set it.**

**3. One of the built-in test functions will tell you everything is fine when it is not.**

This is important enough to have its own step. `_testGSAPerDiemAPI` asks the government service about **fiscal year 2025**, which is written into the code as a fixed number. The city dropdown asks about **fiscal year 2027**, because it works out the current year each time it runs.

**So the test can succeed while the dropdown stays empty.** Step 6 tells you which number to trust instead. *(This is logged as finding G-081.)*

---

## Before you start: is the city-dropdown update deployed?

**This matters and it changes the order of the steps.**

| | How to tell | What to do |
|---|---|---|
| **Not yet deployed** (most likely) | `DEPLOYMENT_GUIDE_CITY_DROPDOWN_FIX.md` has not been worked through | **Read the warning box below**, then do Steps 1–3 only. Come back for Steps 4–8 after deploying |
| **Already deployed** | You have run that guide's Step 9 | Do every step here in order |

> ### ⚠️ If the update is NOT yet deployed, do not run these two functions
>
> **`_setupGSAPerDiemProperties`** — the version running right now **overwrites your API key with the placeholder text `YOUR_API_KEY_HERE`, every time, with no warning.** Setting a key and then running this would undo your work.
>
> **`_viewScriptProperties`** — the version running right now **prints every stored secret in full**, including your new key, into a log.
>
> **Both are fixed by the update.** Until it is deployed, **set the key by hand (Step 3) and run nothing.**
>
> *Good news on the first one: the project owner has confirmed it has never been run, so your key — if one was ever set — was never destroyed by it.*

---

## Step 1 — Confirm you have the two kinds of access

There are **two** different administrator permissions and you need both. They are granted separately, and having one tells you nothing about the other.

### 1a. Apps Script project editor

Open the LETS database spreadsheet → menu **Extensions → Apps Script**.

| What you see | Meaning |
|---|---|
| The code editor opens | ✅ You have it. Continue |
| A permission error | ❌ Ask whoever owns the Apps Script project to add you as an editor |

### 1b. The LETS `admin` role

You cannot test this one directly yet. **You will find out at Step 5**, and the symptom is specific:

> If a function stops with **`Admin access required`**, you have 1a and not 1b. Ask a LETS administrator to grant you the `admin` role in the application's own user administration — **it is not the same thing as Apps Script access.**

### ✅ Verification for Step 1

- [ ] The Apps Script editor opens for me
- [ ] I know who to ask if I hit `Admin access required`

---

## Step 2 — Get a free API key from GSA

1. Go to **https://open.gsa.gov/api/perdiem/**
2. Find the sign-up link for an **api.data.gov** key
3. Enter your name and your **government email address**
4. The key arrives **by email**, usually within a minute

The key is a long string of letters and numbers, about 40 characters.

> **Treat it like a password.** Do not paste it into a chat message, a ticket, a commit, or a document. If you already have, **request a new one** — the old one should be considered compromised. It takes a minute and costs nothing.

### ✅ Verification for Step 2

- [ ] I have the key in front of me, from the email
- [ ] It has not been pasted anywhere other than where Step 3 puts it

---

## Step 3 — Put the key into the settings screen

**This is the step that turns the feature on.** Everything after it is confirmation.

### 3a. Open the settings screen

1. In the Apps Script editor, look at the **left-hand sidebar**
2. Click the **gear icon** (⚙️ **Project Settings**)
3. Scroll to the bottom, to the **Script Properties** section

### 3b. Add the property

1. Click **Add script property**
2. **Property** — type exactly:
   ```
   GSA_PERDIEM_API_KEY
   ```
3. **Value** — paste your key
4. Click **Save script properties**

> ### Three ways this goes wrong, all silent
>
> | Mistake | What happens |
> |---|---|
> | **Name misspelled** — `GSA_PER_DIEM_API_KEY`, `GSA_PERDIEM_KEY`, a lowercase letter | The system looks for the exact name, finds nothing, and behaves as if you never set it |
> | **A space before or after the key value** | The government service rejects it with the same error as a wrong key |
> | **Pasted into the wrong box** | Name and value swapped is easy to do and produces the same symptom |
>
> **Compare the name character by character.** It is `GSA_PERDIEM_API_KEY` — one word for "perdiem", underscores between the other parts.

### ✅ Verification for Step 3

- [ ] `GSA_PERDIEM_API_KEY` appears in the Script Properties list
- [ ] Its name matches the box above exactly
- [ ] The value has no leading or trailing space *(click into it; the cursor should land immediately against the first character)*

> **You can verify this far without running anything, and if the update is not deployed yet, stop here.** The key is set. It will start working the moment the code is deployed. **Return for Step 4 afterwards.**

---

## Step 4 — Set the mileage rates by hand, too

**Not strictly per-diem, but it is in the same settings screen and it has a trap in it.**

Mileage rates look as though a setup function configures them. **One does not, and the one that does writes the wrong names.**

| | |
|---|---|
| `initTravelSystemConfig` **appears** to set mileage rates | It writes `private_mileage_rate`. **Nothing reads that name.** The system reads `MILEAGE_RATE_PRIVATE` — *(finding G-020)* |
| So what is actually used? | **A fallback buried in the code: $0.70 private, $0.22 government** |
| Are those right? | **They are not the current GSA figures.** They are whatever was correct when that line was written |

**So add these two properties the same way you added the key:**

| Property | Value |
|---|---|
| `MILEAGE_RATE_PRIVATE` | the current GSA privately-owned-vehicle rate, as a decimal — e.g. `0.70` |
| `MILEAGE_RATE_GOV` | the current government-vehicle rate — e.g. `0.22` |
| `MILEAGE_RATE_EFFECTIVE_DATE` | the date those rates took effect, as `YYYY-MM-DD` |

> **Look the current rates up rather than copying the examples above.** They are at **https://www.gsa.gov/travel/plan-book/transportation-airfare-pov-etc/privately-owned-vehicle-pov-mileage-reimbursement-rates**. The numbers in this guide are examples of the *format*, not a recommendation.
>
> **And do not assume `_setupGSAPerDiemProperties` will help.** After the update it does fill these in — with `0.725` and `0.205`, values hardcoded in 2026. **If you set them yourself first, it leaves yours alone.** Setting them by hand now is the safer order.

### ✅ Verification for Step 4

- [ ] All three mileage properties appear in the list, spelled as above
- [ ] The values came from the GSA website today, not from this guide
- [ ] I recorded somewhere what I set them to and when

---

## Step 5 — Confirm the key is accepted

**From here on you are running functions, which means you need the `admin` role from Step 1b.**

### How to run a function — read this once

1. In the **left-hand file list**, click the file named in the table
2. Above the code is a **dropdown of function names** and a **▶ Run** button
3. Pick the function, click **▶ Run**
4. Output appears in the **Execution log** at the bottom

> **The file matters.** The dropdown only lists functions from the file you have open. If a function seems to be missing, you are in the wrong file.

> **First run only:** Google asks you to authorise the script. Click through the prompts. This is normal and expected.

### Run the raw connection test

| Open this file | Run this |
|---|---|
| **`PerDiemGSA.gs`** | **`_testRawAPIResponse`** |

**Why this one and not the obvious-sounding `_testGSAPerDiemAPI`:** this function asks about **the current fiscal year** — the same year the dropdown asks about. The other one does not. Step 6 explains.

> ### Only true once the update is deployed
>
> The version running right now asks about **FY2025**, hardcoded — so **before deployment this test has the same flaw Step 6 warns about.** After deployment it is the right one to use.
>
> Two of the messages in the table below also **only exist after deployment**: the *"not set — nothing to test"* line and the 403 advice were both added by the update. Pre-deployment, a missing key produces a bare 403 with no explanation.
>
> **Testing before deployment: treat a `200` as "the key is probably fine" and nothing more.** Confirm properly at Step 7c once the update is live.

### What the log should say

| Log output | Meaning | Do this |
|---|---|---|
| **`Response Code: 200`** + a wall of JSON | ✅ **The key works** | Continue to Step 6 |
| `GSA_PERDIEM_API_KEY is not set — nothing to test.` | The name is wrong or it did not save | Back to Step 3b. Compare the name character by character |
| **`Response Code: 403`** | The key was rejected | See the box below |
| `Admin access required` | You have Apps Script access but not the LETS `admin` role | Step 1b |
| `Response Code: 404` | The key is fine; **GSA has no data for this fiscal year yet** | This is the Step 6 problem. Read it before concluding anything |

> ### A 403 means one of three things
>
> 1. **Whitespace in the value.** The most common cause. Re-paste it, carefully.
> 2. **The name is subtly wrong** — but then you would get the "not set" message instead, so this is unlikely if you got a 403.
> 3. **The key is not activated yet.** Newly issued keys occasionally take a few minutes. Wait five and retry.
>
> The function prints this advice itself when it sees a 403, so you do not have to remember it.

### ✅ Verification for Step 5

- [ ] `Response Code: 200`
- [ ] The JSON that follows mentions a city and a dollar figure
- [ ] If not 200, I identified which row of the table above applies **before** changing anything

---

## Step 6 — Do not trust the other test function

**Read this even if Step 5 succeeded. Especially if it succeeded.**

There is a function called **`_testGSAPerDiemAPI`** that sounds exactly like what you want. **It will mislead you.**

| | |
|---|---|
| **What it asks the government service** | Fiscal year **2025**, then **2026** — both written into the code as fixed numbers |
| **What the city dropdown asks** | The **current** fiscal year, worked out from today's date. Since 1 October 2026 that is **2027** |
| **And it stops at the first success** | So it never even reaches the second year in its list |

**The consequence, stated plainly:** your key can be valid, this function can print `✓ SUCCESS!` with a cheerful dollar amount, **and every city dropdown in the system can still be empty** — because GSA has not published data for the year the dropdown is asking about, or your key does not cover it.

> **A test that cannot tell "working" from "broken" is worse than no test**, because it stops you investigating. You can run it if you like — it does no harm — but **do not treat `✓ SUCCESS!` as permission to stop.** Step 8 is the real test.
>
> *This is finding G-081. The fix is a one-line change. To confirm the problem still exists today, a developer can run `node docs/evidence/verify_gsa_fiscal_year.js` from the repository.*

**One more oddity, in case you run it anyway:** if it fails on every attempt it then calls a function that *does* require the `admin` role. So without that role you see `Admin access required` **instead of the actual error** — the wrong message at the worst moment.

### ✅ Verification for Step 6

- [ ] I understand that `✓ SUCCESS!` from `_testGSAPerDiemAPI` does not mean the dropdown works
- [ ] I will judge success on Step 7's count and Step 8's live test

---

## Step 7 — Load every state's city list

Now you fill the system's temporary memory with city lists, so the first person to pick a state does not wait for a round trip.

### 7a. Clear out anything old

| Open this file | Run this | Expect in the log |
|---|---|---|
| **`PerDiemGSA.gs`** | **`clearGSACitiesCache`** | `cleared 98 keys for FY2027 (current + legacy shapes)` |

**98 is correct: 49 locations × 2 formats** — the lower 48 plus DC. The city-dropdown update changed the format of these stored lists, and this clears both the new and the old shape so nothing stale survives.

> **If the log says `cleared 49 keys` instead of 98, the update is not deployed yet.** The older version of this function only knows about one format. **That is your signal to stop and go back to `DEPLOYMENT_GUIDE_CITY_DROPDOWN_FIX.md`** — Steps 7 and 8 here will not give meaningful results until the new code is live.

> **If you skip this after a fresh deploy,** the dropdown works but shows city names with **no rates beside them**, for up to a day, and then fixes itself. Confusing and harmless.

### 7b. Fetch all 49 locations

**Switch files.** The next two functions live in a different file.

| Open this file | Run this | Expect |
|---|---|---|
| **`CacheWarming.gs`** | **`warmGSACitiesCache`** | **Takes about 15 seconds.** Be patient — it is making 49 separate requests |

**Read the last line of the log.** It says something like:

```
warmGSACitiesCache: 49 ok / 0 failed (FY2027)
```

> ### ⚠️ This function reports success even when it completely fails
>
> It always finishes with `success: true`, **even if all 49 states failed.** The failures are only visible in that `N ok / N failed` line.
>
> **So read the line. Do not read the green tick.**
>
> | The line says | Meaning |
> |---|---|
> | `49 ok / 0 failed` | ✅ Everything worked |
> | `0 ok / 49 failed` | The key is not working, or GSA has no data for this fiscal year. **Go back to Step 5, then read Step 6 again** |
> | Something in between, e.g. `44 ok / 5 failed` | Mostly fine. Those five states will fetch on demand when someone picks them. Worth retrying once |

### 7c. Confirm what is actually stored

| Open this file | Run this | Expect |
|---|---|---|
| **`CacheWarming.gs`** | **`_diagnoseGSACitiesWarmer`** | `Cached states: 49 / 49` |

**This is the number to trust.** It checks the stored lists **against the same fiscal year the dropdown uses** — unlike the test function in Step 6. It also tells you whether the automatic refresh is scheduled, and recommends what to do if not.

| Log output | Meaning |
|---|---|
| `Cached states: 49 / 49` and `Everything looks healthy.` | ✅ Done. Continue to Step 7d |
| `Cached states: 0 / 49` | Nothing stored. Step 7b failed — re-read its log |
| `Trigger installed: NO` | Expected at this point. Step 7d fixes it |

### 7d. Schedule the automatic refresh

| Open this file | Run this | What it does |
|---|---|---|
| **`CacheWarming.gs`** | **`installGSACitiesWarmingTrigger`** | Refreshes all 49 lists every 6 hours, automatically |

**Run it once.** Running it twice is harmless — it replaces the existing schedule rather than adding a second one.

> ### ⚠️ Write down who ran this
>
> Scheduled jobs in Apps Script are **visible only to the account that created them.** Nobody else can see this job exists, including you if you use a different account.
>
> **If that person leaves the organisation, the job silently stops.** Nothing breaks immediately — lists are fetched on demand instead, just more slowly — but no warning is ever issued.
>
> **Record the date and the account in whatever handover notes your team keeps.**

### ✅ Verification for Step 7

- [ ] 7a reported `cleared 98 keys` — **if it said 49, the update is not deployed; stop here**
- [ ] 7b's last line reported `49 ok / 0 failed` — **I read the line, not the tick**
- [ ] 7c reported `Cached states: 49 / 49`
- [ ] 7d ran, and I wrote down **who** ran it and **when**

---

## Step 8 — The real test: use the application

**Everything so far proved the plumbing. This proves the feature.**

### 8a. The city dropdown

1. Open LETS and start a **New Request**
2. Go to the **Itinerary** section
3. Leave **Country** as `United States`
4. **Click into the State box and TYPE `VA`. Then press Tab.** *Do not click the dropdown*
5. **Click into the City box**

**Expected:** a dropdown of Virginia cities, each showing rates — something like:

```
Richmond        $107-131 lodging · $68 M&IE
Virginia Beach  $122-186 lodging · $79 M&IE
```

| What you see | Meaning |
|---|---|
| Cities **with** rates | ✅ **It works.** This is the finish line |
| Cities with **no rates** beside them | Step 7a was skipped, or ran before the update was deployed. Re-run 7a then 7b |
| **No dropdown at all** | The key is not reaching the service. Back to Step 5 |

> **Typing rather than clicking is deliberate.** Clicking a state from its dropdown used to work when typing one did not. **If you click, you are testing the path that was never broken.**

### 8b. The lodging range is a range on purpose

`$107-131` is not an error and not an average. **GSA publishes twelve monthly lodging figures per city** because rates are seasonal. A single number would imply a precision the data does not have.

**The figure in the dropdown is a hint for picking a city. It is not what anyone is reimbursed.** The actual amount is calculated separately, day by day, from the travel dates.

### 8c. Confirm the hint did not get saved as the city

1. Pick a city from the dropdown
2. **Look at the City box.** It must show only `Richmond` — **not** `Richmond $107-131 lodging · $68 M&IE`

If the rate text ended up in the box, **stop and report it.** It would be stored as the destination.

### 8d. Confirm an amount actually appears

1. Fill in travel dates for the leg
2. Go to the **Travelers** section and add a traveller
3. **Lodging and M&IE amounts should appear against that leg**

> ### ⚠️ If the amounts stay at zero, nothing will tell you why
>
> When a rate lookup fails on this screen, **the error goes to the browser console and nowhere else.** No message, no warning — the cost fields simply stay empty while the form looks perfectly normal.
>
> **To see the real reason:** press **F12** (or **Cmd+Option+I** on a Mac), click the **Console** tab, and look for a line beginning `[PerDiem] Fetch failed`. The text after it is the actual error.

### ✅ Verification for Step 8

- [ ] Typing a state and pressing Tab produces a city dropdown
- [ ] The cities show rate hints
- [ ] The City box holds **only** the city name
- [ ] Lodging and M&IE amounts appear on the Travelers screen
- [ ] A reviewer other than me repeated 8a successfully

---

## You are done. Here is what you turned on, and what you did not

### Working now

| | |
|---|---|
| City dropdowns with rate hints | All 49 CONUS locations — the lower 48 plus DC |
| Live lodging and M&IE calculation | Day by day, with the first/last-day 75% rule applied |
| Automatic refresh | Every 6 hours, owned invisibly by whoever ran Step 7d |
| Mileage rates | At whatever you set in Step 4 |

### Still not working, deliberately out of scope

| | What it needs |
|---|---|
| **Alaska, Hawaii, Puerto Rico, Guam, USVI, American Samoa, N. Marianas** | The **DoD** source: two sync functions and a scheduled job, which create two spreadsheet tabs |
| **Foreign travel** | The **State Dept** source: another sync, another tab, and the Drive advanced service |

**Neither affects what you just set up.** CONUS travel is complete.

> ### ⚠️ One known defect that will bite you on OCONUS travel
>
> **Do not assume OCONUS is merely "not set up yet."** There is a separate fault:
>
> When a **reviewer edits** an itinerary or cost dates on a request with an Alaska or Hawaii leg, the system asks the **GSA** service for the rate — **and GSA deliberately does not cover those states.** The lookup fails, **the old rate is silently kept**, and the night count is recalculated against it.
>
> **The total changes, so it looks freshly calculated.** It is not. No error appears anywhere.
>
> The intake form is **not** affected — it routes correctly. **Only reviewer-side edits.**
>
> *This is finding G-080. It is a one-line fix and it should be done before DoD per-diem is switched on, or the DoD data will be correct and unused on those paths.*

---

## If something goes wrong

### The dropdown is empty and Step 5 said 200

**Most likely the fiscal year, not the key.** Re-read Step 6. Then run `_diagnoseGSACitiesWarmer` (Step 7c) — if it reports `0 / 49` while Step 5 reported 200, **GSA almost certainly has no data published for the current fiscal year.** That is outside your control; the dropdown will populate when they publish.

### Everything worked yesterday and the dropdown is empty today

**Check the date.** If it has just passed **1 October**, the fiscal year rolled over and the system is now asking GSA for a year they may not have published yet. **This happens every year.** Run `_diagnoseGSACitiesWarmer` to confirm, then re-run Step 7b once GSA publishes.

### Rates appear for some cities and not others

**Expected, and correct.** GSA publishes specific rates for some localities and a single "standard rate" for everywhere else in a state. A city not individually listed correctly falls back to its state's standard rate — it just has no hint in the dropdown.

### `Admin access required`

You have Apps Script project access but not the LETS `admin` role. They are separate (Step 1).

### I need to undo this

**Remove the `GSA_PERDIEM_API_KEY` property** in Project Settings and the feature returns to its previous state. Then run `clearGSACitiesCache` (Step 7a) to drop the stored lists, and `removeGSACitiesWarmingTrigger` in `CacheWarming.gs` to cancel the schedule.

**Nothing is deleted and no travel data is touched.** This whole guide changes settings and temporary memory only.

---

## For the record — what to hand over

Fill this in and keep it with your team's operational notes. **None of it is recorded anywhere in the system.**

```
GSA PER DIEM (CONUS) — SETUP RECORD

Date completed ......................... ____________________
Completed by ........................... ____________________

API key obtained from open.gsa.gov on .. ____________________
Key was shared over chat/email? ........ YES / NO
   if YES, was it regenerated? ......... YES / NO

Step 5  _testRawAPIResponse response code ....... ______
Step 7b warmGSACitiesCache ..... ______ ok / ______ failed
Step 7c _diagnoseGSACitiesWarmer ...... ______ / 49 cached

Step 7d installGSACitiesWarmingTrigger
   RUN BY (account) .................... ____________________
   ON (date) ........................... ____________________
   ^ this job is invisible to every other account.
     If this person leaves, the job stops with no warning.

Mileage rates set in Step 4:
   MILEAGE_RATE_PRIVATE ................ ______
   MILEAGE_RATE_GOV .................... ______
   MILEAGE_RATE_EFFECTIVE_DATE ......... ____________________
   Source + date looked up ............. ____________________

Step 8 live test confirmed by a second person ... ____________________

NEXT REVIEW: 1 October ______  (fiscal year rollover — see
"Everything worked yesterday" in the troubleshooting section)
```

---

*Covers GSA/CONUS per diem only. For the full technical account see `docs/SYSTEM_COMPONENT_MAP.md` §2.7.4 (the rate-source dispatcher), `docs/DATA_DICTIONARY.md` §3.10.2 (why there is no GSA tab), and `docs/GAP_REGISTER.md` for findings G-020, G-080 and G-081.*
