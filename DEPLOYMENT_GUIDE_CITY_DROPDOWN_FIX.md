# How to Deploy the Itinerary City Dropdown Fix

**A step-by-step guide. No coding knowledge assumed.**

| | |
|---|---|
| **What this fixes** | The **City** field on the New Request → Itinerary screen. It never showed a dropdown of cities. Now it does, and each city shows its per-diem rates |
| **How long it takes** | About **45 minutes**, most of it waiting and checking |
| **Can you break production?** | **Yes, at Step 8.** Everything before that is reversible. Steps 1–7 are safe |
| **What you need** | A GitHub account with access to `clolry/LETS`, and an **administrator** account in the LETS Apps Script project |

---

## Before you start: what is actually going on

You do not need to understand the code, but **three facts will make every step below make sense.**

**1. There are two separate places the system lives.**

| | What it is | How it gets updated |
|---|---|---|
| **GitHub** | The filing cabinet holding the official copy of the code | You upload changes to it |
| **Apps Script** | The live system people actually use | GitHub **automatically** copies code here when changes reach the `main` branch |

So "deploying" means: **put the code in GitHub's `main` branch, and GitHub pushes it to the live system for you.**

**2. There are three kinds of change in this update.**

- **The bug fix** — typing a state now loads the city list. This is what you asked for.
- **A new feature** — the dropdown now shows each city's lodging and meal rates.
- **Three security fixes** — I found these while working on the above. One of them matters a great deal, and Step 2 explains why.

**3. One thing must happen by hand.**

The system needs a password-like **API key** to ask the government's per-diem service for rates. **Keys are never stored in GitHub** — that would publish them. You will type it into the Apps Script settings yourself, in Step 3.

---

## Step 1 — Check you have what you need

**Do this first.** If either answer is "no", stop and sort it out before continuing.

### 1a. Can you reach the code?

Open **https://github.com/clolry/LETS** in a browser.

- **You see a list of files** → good, continue.
- **You see "404" or "Not Found"** → you do not have access. Ask the repository owner to add you.

### 1b. Are you a LETS administrator?

Open the LETS Apps Script project. **Easiest route:** open the LETS database spreadsheet → menu **Extensions → Apps Script**.

- **The code editor opens** → good, continue.
- **You get a permission error** → you are not a project editor. You need this for Steps 3 and 9.

> **A note on "administrator".** There are **two different kinds** and you need both:
> - **Apps Script project editor** — lets you open the settings screen (Step 3)
> - **LETS `admin` role** — lets you run the diagnostic functions (Step 9)
>
> They are granted separately. If Step 9 says *"permission denied"* but Step 3 worked, you have the first and not the second.

---

## Step 2 — Read this warning before you touch anything

**There is a function in the live system right now that will destroy your API key.**

It is called `_setupGSAPerDiemProperties`. The old version of it overwrites the real key with the placeholder text `YOUR_API_KEY_HERE` — **every single time it runs**, with no warning and no confirmation.

| | |
|---|---|
| **Until this update is deployed** | **Do not run that function.** Do not run anything you were not told to run in this guide |
| **After this update is deployed** | It is fixed — it now refuses to overwrite a key that is already set, and only an administrator can run it |

**This is why Step 3 (set the key) comes before Step 8 (deploy), but Step 9 (test) comes after.** The order is deliberate: you set the key while the dangerous function is still present but untouched, then the deploy removes the danger, then you test.

**If you have already run that function at some point:** your key is probably the placeholder text. Step 3 will overwrite it correctly, so just carry on.

---

## Step 3 — Put the API key into the live system

**This is done by hand, once, and it is not part of the code upload.**

### 3a. Get to the settings screen

1. Open the LETS Apps Script project (as in Step 1b)
2. On the **left sidebar**, click the **gear icon** (⚙) labeled **Project Settings**
3. Scroll down to the section headed **Script Properties**
4. Click **Edit script properties**, then **Add script property**

### 3b. Enter the key

Two boxes appear. Fill them in **exactly**:

| Box | What to type |
|---|---|
| **Property** | `GSA_PERDIEM_API_KEY` |
| **Value** | Your 40-character key from https://open.gsa.gov/api/perdiem/ |

5. Click **Save script properties**

> ### Three ways this goes wrong. All three fail silently.
>
> | Mistake | What happens |
> |---|---|
> | **The name is not exactly `GSA_PERDIEM_API_KEY`** | The system looks for that exact name. `GSA_API_KEY` or a typo reads as *"no key at all."* No error message — just no cities, forever |
> | **A space before or after the key** | Copy-paste often grabs a trailing space. The government's service rejects it. Click into the box and check the cursor sits right against the last character |
> | **You pasted it into the wrong project** | There are **at least three** Apps Script projects associated with LETS. Make sure you are in the one you opened via the database spreadsheet |

### 3c. If your key was shared over chat or email

**Treat it as compromised and get a new one.** It takes a minute at the link above and costs nothing. This key only reads public rate data, so the risk is low — someone else using up your hourly quota — but a credential that has traveled through a chat window is no longer private.

---

## Step 4 — Upload the changed files to GitHub

**Seven files changed.** You are putting them in GitHub, not yet in the live system.

Ask whoever handles the code to **create a branch and open a pull request** containing exactly these seven files:

```
lets_app/server/30_services/PerDiemGSA.js
lets_app/server/30_services/PerDiemForeign.js
lets_app/server/99_triggers/CacheWarming.js
lets_app/client/shared/travelLocationService.html
lets_app/client/controllers/form/travelRequestItinerary.html
lets_app/client/styles/travelRequestStyles.html
docs/evidence/verify_city_dropdown_fix.js
```

> ### ⚠ Five files must NOT be included
>
> If you run `git status`, you will see these listed as untracked. **Leave every one of them out:**
>
> ```
> .clasp.json
> .claspignore
> Code.gs
> appsscript.json
> clipboard_content.txt
> ```
>
> **Why this matters more than it looks.** That `.clasp.json` in the top folder is configured to upload **the entire repository** — 228 files, including a complete copy of another GSA office's application — into an Apps Script project that appears in no project document. It is a known problem, recorded as finding **G-048**. Committing it makes an accident likelier.
>
> **Related rule, same cause: never run `clasp push` from the top folder.** Only ever from inside `lets_app`.

### What a "pull request" is, in one sentence

A pull request is a **proposal**: *"here are my changes, please review them before they go live."* It does not deploy anything. **Opening one is safe.**

---

## Step 5 — Let the automatic checks run

The moment the pull request opens, GitHub runs **seven automatic checks**. You do not start them; they start themselves.

1. On the pull request page, scroll to the bottom
2. Look for a panel showing check results
3. Wait for it — **usually under two minutes**

| What you see | What it means | What to do |
|---|---|---|
| **Green tick** ✓ | All seven passed | Continue to Step 6 |
| **Yellow dot** ● | Still running | Wait |
| **Red X** ✗ | Something failed | **Stop.** Click the X to see which check. Do not merge |

**What those seven checks are**, so a red X is not a mystery:

| | Check | What it protects against |
|---|---|---|
| 1 | Budget engine tests | The cost maths still works |
| 2 | FAS tracker isolation tests | Test runs cannot write to the real FAS tracker |
| 3 | Module load tests | Every code file still loads |
| 4 | Deploy-on-PR guard | Nobody accidentally makes "opening a PR" deploy to production |
| 5 | Credential-free guard | The check workflow can never touch production |
| 6 | Hardcoded-identifier guard | Spreadsheet IDs and keys are not buried in code |
| 7 | Test-file exclusion guard | Test files never reach the live system (they would crash it) |

> **These checks cannot deploy anything.** They are deliberately built with no access to production credentials, so a failed check is informative and never dangerous.

---

## Step 6 — Have a person review it

**The automatic checks verify the code is safe. They cannot verify it is correct.** A second pair of human eyes is required — and for AI-assisted changes like this one, it is not optional.

Ask your reviewer to look at:

| | |
|---|---|
| **The actual fix** | In `travelLocationService.html`, the State field's "blur" handler now saves what you typed. That one change is the bug fix |
| **The three security fixes** | In `PerDiemGSA.js` — the functions `_setupGSAPerDiemProperties`, `_viewScriptProperties`, and `_testRawAPIResponse` all now require administrator rights |
| **The rate display** | The dropdown shows rates for information only. It does **not** change any amount the system calculates — those still come from the existing, untouched calculation path |

**Tell your reviewer plainly: this code was written by an AI assistant and has not been run in a real browser.** It has been tested by executing the logic directly (22 automated checks, all passing), but **nobody has yet clicked the dropdown in a live page.** That is Step 10, and it is why Step 10 is not optional.

---

## Step 7 — Decide whether to test in the sandbox first

**There is a `sandbox` branch, and a separate sandbox Apps Script project.** Testing there first is the safer path.

**But be aware of an unresolved question before you do.** Nobody has confirmed whether the sandbox reads the **production database**. If it does, **testing in the sandbox writes real travel data.**

| Your situation | What to do |
|---|---|
| You know the sandbox has its own separate database | **Test there first.** Safest option |
| You do not know | **Find out first** — open the sandbox project's Script Properties and compare its `TRAVEL_DB_SPREADSHEET_ID` to production's. Five minutes |
| You cannot find out, and need this fixed now | Go straight to production, but **do Step 10 immediately** and be ready to roll back |

> **Also note:** there is **no automatic deployment for the sandbox branch.** Pushing to `sandbox` updates GitHub only. Someone has to deploy it to the sandbox project by hand.

---

## Step 8 — Merge, which deploys to production

**This is the irreversible step.** Everything before this was reversible.

**The moment the pull request is merged into `main`, GitHub automatically copies the code into the live Apps Script project.** No separate deploy button. **Merging *is* deploying.**

1. On the pull request page, click **Merge pull request**
2. Confirm
3. Click the **Actions** tab at the top of the repository
4. Watch the run named **"Deploy to Google Apps Script"**
5. Wait for a green tick — **about one minute**

| What you see | What it means |
|---|---|
| **Green tick** ✓ | Code is live. Continue to Step 9 |
| **Red X** ✗ | Deploy failed. **The live system is unchanged** — it still runs the old code. See Troubleshooting |

> **One thing to know about what "live" means here.** The deploy replaces the *code* in the project. Whether users immediately see the new version depends on a deployment setting nobody has recorded yet. **If Step 10 shows no change, this is the likely reason** — see Troubleshooting.

---

## Step 9 — Run four functions in order

**Now the code is live, you prepare the data.** These are run from the Apps Script editor and **you must hold the LETS `admin` role.**

### How to run a function — read this once

1. Open the Apps Script project
2. **In the file list on the left, click the file named in the table below.** This matters: the Run dropdown only lists functions from the file you have open, so the function you want will be missing if you are in the wrong file
3. Above the code there is a **dropdown listing function names** and a **▶ Run** button
4. Pick the function from the dropdown, click **▶ Run**
5. Output appears in the **Execution log** panel at the bottom

**First run only:** Google will ask you to authorize the script. Click through the permission prompts. This is normal.

### Run these four, in this order

| | Open this file | Then run | What it does | Expect |
|---|---|---|---|---|
| **9a** | `PerDiemGSA.gs` | `_testGSAPerDiemAPI` | Asks the government service for one city's rates | `✓ SUCCESS!` and a dollar figure |
| **9b** | `PerDiemGSA.gs` | `clearGSACitiesCache` | **Required.** Deletes the old stored city lists | `cleared 98 keys` |
| **9c** | `CacheWarming.gs` | `warmGSACitiesCache` | Fetches fresh lists for all 49 states — **takes ~15 seconds, be patient** | `49 ok / 0 failed` |
| **9d** | `CacheWarming.gs` | `_diagnoseGSACitiesWarmer` | Reports what is now stored | `Cached states: 49 / 49` |

> **Note the file change between 9b and 9c.** The first two functions live in `PerDiemGSA.gs`; the last two live in `CacheWarming.gs`. You have to switch files in the left-hand list, or the dropdown will not show them.

> ### Why 9b is not optional
>
> The system keeps a temporary copy of each state's city list to stay fast. **This update changed the format of that copy** — it now holds rates alongside names.
>
> Old-format copies linger for up to 24 hours. They are harmless but useless: a city list without rates. `clearGSACitiesCache` deletes them so the next step rebuilds everything in the new format.
>
> **Skip it and the dropdown will work but show no rates, confusingly, for about a day.**

### Then schedule the automatic refresh

| | Open this file | Then run | What it does |
|---|---|---|---|
| **9e** | `CacheWarming.gs` | `installGSACitiesWarmingTrigger` | Sets the list to refresh itself every 6 hours |

**Run this once.** Running it twice is harmless — it replaces the existing schedule rather than adding a second one.

> **A caution about this one.** Scheduled jobs in Apps Script are **visible only to the account that created them.** Whoever runs 9e owns it invisibly. **If that person leaves the organization, the job stops and nobody is told.** Note down who ran it.

---

## Step 10 — Check it actually works

**Do not skip this.** Everything so far verified the code is *present*. This verifies it *works*.

### 10a. The main test — the bug you reported

1. Open LETS and start a **New Request**
2. Go to the **Itinerary** section
3. Leave **Country** as `United States`
4. **Click into the State box and TYPE `VA`. Then press Tab.** Do not click the dropdown
5. **Click into the City box**

**Expected:** a dropdown of Virginia cities, each with rates like `$107-131 lodging · $68 M&IE`.

> **Typing rather than clicking is the whole point of this test.** The old bug was that *clicking* a state worked and *typing* one did not. If you click the state from its dropdown, you are testing the path that was never broken.

### 10b. Clicking still works

Repeat, but **click** `CA` from the State dropdown instead of typing. Cities should appear the same way.

### 10c. Saved drafts now work

1. Fill in a destination, save the request as a draft
2. Close it, reopen it
3. Click into **City**

**Expected:** the dropdown appears. **Previously it did not** — this was the second bug.

### 10d. International travel

1. Change **Country** to `France`
2. The State box should disappear
3. Click into **City** → French locations appear, **without** rates

**No rates is correct here.** Rates for international destinations come from a different source that does not supply them in list form.

### 10e. The rate text is not saved as the city

1. Pick a city with rates showing
2. Look at what landed in the City box

**Expected:** `Richmond` — **not** `Richmond $107-131 lodging`.

**This is the most important check on the page.** The rates are decoration. If rate text ever got saved as the city name, the system would store a nonsense destination and per-diem calculations would fail downstream.

### 10f. The amounts did not change

Complete a request you have figures for and **confirm the calculated totals match what the system produced before this update.**

**This update deliberately did not touch cost calculation.** The dropdown rates are a preview; the real figures come from the same untouched code as always. **If a total changed, something is wrong — roll back.**

---

## If something goes wrong

### Nothing looks different after deploying

**Most likely: the browser cached the old page.** Hard-refresh — **Ctrl+Shift+R** (Windows) or **Cmd+Shift+R** (Mac).

**Second possibility, and a real one:** the deploy updated the *code* but the live web app still serves an older published *version*. Check **Deploy → Manage deployments** in the Apps Script editor. **Nobody has recorded how this project is configured**, so this genuinely may need a manual step.

### Cities still do not appear

Work through this in order — it is ordered by likelihood:

| Check | How |
|---|---|
| **Is the key set, with the exact name?** | Project Settings → Script Properties. Must read `GSA_PERDIEM_API_KEY` |
| **Does the key work?** | Run `_testGSAPerDiemAPI` (in `PerDiemGSA.gs`). A `403` means the key was rejected — check for stray spaces |
| **Is anything cached?** | Run `_diagnoseGSACitiesWarmer` (in `CacheWarming.gs`). If it says `0 / 49`, run `warmGSACitiesCache` — same file |
| **Permission denied?** | You need the LETS `admin` role, which is separate from Apps Script project access |

### Cities appear but without rates

You skipped **9b**. Run `clearGSACitiesCache` (in `PerDiemGSA.gs`), then `warmGSACitiesCache` (in `CacheWarming.gs`).

### Automatic checks failed on the pull request

**Do not merge.** Click the red X to see which check failed. The failure message names the file and the problem. Send it to whoever wrote the change.

### I need to undo the whole thing

**You can.** On GitHub, open the merged pull request and click **Revert**. That creates a new pull request undoing everything, which deploys the old code back when merged.

**Then run `clearGSACitiesCache`** (in `PerDiemGSA.gs`) **and `warmGSACitiesCache`** (in `CacheWarming.gs`) **again** — the stored city lists will be in the new format, which the old code cannot read.

> **The API key is unaffected by a revert.** It lives in Apps Script settings, not in the code. You will not need to set it again.

---

## What this update does not fix

**Being straight about scope**, so nobody expects more than they got:

| | |
|---|---|
| **Per-diem calculations are unchanged** | Intentionally. The amounts on a request are computed by the same code as before. Only the dropdown preview is new |
| **International destinations show no rates** | The international data source does not provide them in list form. A separate change could add this |
| **ZIP code lookup was not added** | The government service supports finding a locality by ZIP, which would be genuinely useful since travelers rarely know which locality covers their hotel. **Not included here** — it is a new feature, not a bug fix |
| **Nobody has clicked this in a browser yet** | The logic was verified by executing it directly, not by using the real page. **Step 10 is the first real test.** Treat it as such |

---

## The deployment checklist

Print this. Tick as you go.

```
BEFORE YOU START
 [ ] 1a  I can open github.com/clolry/LETS
 [ ] 1b  I can open the Apps Script project
 [ ] 2   I have read the warning and will NOT run
         _setupGSAPerDiemProperties before deploying

SET THE KEY (by hand, in Apps Script)
 [ ] 3a  Project Settings > Script Properties
 [ ] 3b  Name is exactly: GSA_PERDIEM_API_KEY
 [ ] 3b  Value has no leading or trailing space
 [ ] 3b  Saved
 [ ] 3c  Key regenerated if it was shared over chat/email

UPLOAD TO GITHUB
 [ ] 4   Pull request opened with exactly 7 files
 [ ] 4   The 5 forbidden root files are NOT included
 [ ] 5   All automatic checks show green
 [ ] 6   A human has reviewed it
 [ ] 6   Reviewer told it is AI-written and browser-untested
 [ ] 7   Sandbox decision made (and sandbox database checked)

DEPLOY
 [ ] 8   Merged to main
 [ ] 8   Actions tab shows a green deploy

PREPARE THE DATA (Apps Script, as an admin)
 [ ] 9a  PerDiemGSA.gs   _testGSAPerDiemAPI        -> SUCCESS
 [ ] 9b  PerDiemGSA.gs   clearGSACitiesCache       -> cleared
 [ ] 9c  CacheWarming.gs warmGSACitiesCache        -> 49 ok / 0 failed
 [ ] 9d  CacheWarming.gs _diagnoseGSACitiesWarmer  -> 49 / 49
 [ ] 9e  CacheWarming.gs installGSACitiesWarmingTrigger
 [ ] 9e  Noted who ran it: ______________________

CHECK IT WORKS
 [ ] 10a TYPE a state -> cities appear with rates
 [ ] 10b CLICK a state -> cities appear
 [ ] 10c Reopened draft -> dropdown works
 [ ] 10d France -> locations appear, no rates
 [ ] 10e City box holds "Richmond", not rate text
 [ ] 10f Calculated totals unchanged

Deployed by: ____________________  Date: ____________

Problems encountered:
_____________________________________________________
_____________________________________________________
```

---

## Reference: the seven files, in plain English

| File | What it does |
|---|---|
| `travelLocationService.html` | **The actual bug fix.** Saves the state when you type it instead of only when you click it. Also renders the rates in the dropdown |
| `travelRequestItinerary.html` | Makes the City dropdown work on a reopened draft |
| `PerDiemGSA.js` | Keeps the rates the government already sends instead of discarding them. Also the three security fixes |
| `PerDiemForeign.js` | Adds a missing function the Country dropdown had been calling for months without it existing |
| `CacheWarming.js` | Points the health-check at the new storage format |
| `travelRequestStyles.html` | Makes the rates line up neatly on the right of each dropdown row |
| `verify_city_dropdown_fix.js` | 22 automated checks proving the fix works. Does not run in the live system |

---

## Who to ask

| Problem | Who |
|---|---|
| Cannot reach GitHub | Repository owner |
| Cannot open Apps Script | Whoever administers the project |
| A check failed, or something looks wrong in the code | Whoever wrote the change |
| Is the sandbox safe to test in? | Whoever set up the sandbox project |
| Need a new API key | Yourself — https://open.gsa.gov/api/perdiem/ |

---

*Written 2026-10-29 to accompany the itinerary city-dropdown fix. Steps 1–7 are reversible; **Step 8 deploys to production**. The three security fixes in this change mean deploying it promptly is better than deferring it — the function described in Step 2 is live right now.*
