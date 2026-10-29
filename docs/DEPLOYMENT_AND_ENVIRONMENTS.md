---
title: "LETS Deployment and Environments"
description: "The Apps Script projects, the deployment pipeline, the configuration, and what a rebuild would lose"
status: canonical
tier: 1
audience: "project manager, system owner, ISSO, developer deploying a change"
last_updated: "2026-10-28"
evidence_base: "docs/evidence/pass6_deployment_census.js"
---

# LETS Deployment and Environments

**Deliverable 5 of 10.** Companion to [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md), [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md), [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) and [`WORKFLOW_AND_BUSINESS_RULES.md`](./WORKFLOW_AND_BUSINESS_RULES.md).

---

## How to read this document

**This is the deliverable with the most `[UNKNOWN]` in it, and that is the honest answer rather than a gap in the work.**

Almost everything that defines a running Apps Script deployment lives **outside the repository**: which project is live, how it executes, who can reach it, what every Script Property holds, which triggers are installed and under whose account. None of that is in git and none of it can be read from here.

What *is* in the repository is **the configuration that would be applied** — the clasp targets, the manifest, the workflows, the property keys the code reads and writes. This document is precise about that boundary:

| Marker | Meaning in this document |
|---|---|
| `[VERIFIED]` | Read from a file in the repository, or measured by `pass6_deployment_census.js` |
| `[CONFIGURED]` | **New in this deliverable.** The repository specifies this; whether the live project matches is a separate question |
| `[INFERRED]` | A reasoned conclusion, labelled so you can disagree |
| `[UNKNOWN]` | Held outside the repository. Requires someone with live access |

Every count is produced by [`evidence/pass6_deployment_census.js`](./evidence/pass6_deployment_census.js).

---

## §5.0 The short version

| Question | Answer |
|---|---|
| **How many Apps Script projects?** | **Three are configured.** Production, a sandbox, and **one undocumented project wired to the repository root** (§5.1.3) |
| **How does code reach production?** | A merge to `main` triggers `clasp push --force`. **No `clasp deploy` step runs** (§5.2.1) |
| **So does a merge reach users?** | `[UNKNOWN]`. It depends on how the active deployment is configured, which nobody has recorded (**VT-01**) |
| **Who can deploy?** | Whoever holds the `CLASPRC_JSON` secret, or anyone who can merge to `main`. **There is no branch protection** `[VERIFIED]` |
| **Is the pipeline well built?** | **Yes — unusually so.** Four deliberate controls, each documenting its own reasoning (§5.3) |
| **Do those controls work?** | Three of four bite exactly as intended. **One has a real coverage gap** (§5.3.3) |
| **Where is configuration held?** | Script Properties in the live project — **not in git** `[VERIFIED]`. 15 keys declared; **4 more written to names nothing reads** (§5.4) |
| **What would a rebuild from source lose?** | Eight categories of configuration, most failing silently. The HC library binding is the worst (§5.7) |

---

## §5.1 The three Apps Script projects

### 5.1.1 What is configured

`[VERIFIED]` — three distinct script IDs across three clasp config files:

| Config file | Role | Script ID | Tracked by git? |
|---|---|---|---|
| `lets_app/.clasp.json` | **Production** | `1xDKibOChZti…VaF-tcGJr` | yes |
| `lets_app/.clasp.sandbox.json` | Sandbox | `1PLzwA_Tin…yyHzfm` | yes |
| **`.clasp.json`** (repo root) | **Undocumented** | `181ocqi16Ruz…51VFGF` | **no — untracked** |

The production ID matches `PROJECT_PLAN.md` `[CLAIMED]`. **The other two appear in no project document** `[VERIFIED]`.

### 5.1.2 Production and sandbox are configured identically

Both point `rootDir` at `lets_app/` and would each push **111 pushable files** `[VERIFIED]`.

**Switching between them is a file swap**, not a flag — you would rename `.clasp.sandbox.json` over `.clasp.json`. There is no environment variable, no `--project` argument, nothing in CI that targets the sandbox.

> **Two consequences worth knowing.** A developer testing in the sandbox has to modify a tracked file to do it, which risks committing the swap. And **the deploy workflow always targets production** — the sandbox is reachable only by a manual local push `[VERIFIED]`. There is no automated path to the sandbox at all.

### 5.1.3 The root config is the finding, and it is worse than its rating

**This is finding G-048, rated Medium. The measurement suggests that is too low.**

`.clasp.json` at the repository root `[VERIFIED]`:

```json
{
  "scriptId": "181ocqi16Ruz…",
  "rootDir": "",
  "skipSubdirectories": false
}
```

**`rootDir: ""` resolves to the repository root, and `skipSubdirectories: false` means recurse.** A `clasp push` run from the repository root would carry **224 pushable files** into an undocumented Apps Script project `[VERIFIED]`:

| Files | Source tree |
|---|---|
| 111 | `lets_app/` — the real application |
| **94** | **`reference_travel_app/`** — the GSA/AAS TRIP application snapshot |
| 12 | `docs/` — this documentation effort |
| **4** | **`reference_training_tracker/`** — another referenced application |
| 3 | Loose root files: `Code.gs`, `appsscript.json`, `.clasp.json` |

**Why this matters more than "an extra project exists":**

1. **It would push another organisation's application code** into a project nobody has documented. 98 of the 224 files are reference snapshots of systems LETS does not own.
2. **All pushed `.js` files share one global scope** (`SYSTEM_COMPONENT_MAP.md` §2.1.1). Pushing `lets_app/` and `reference_travel_app/` together means **two full copies of the same ~459 function names in one namespace** — the later-loading definition silently wins. The result would not merely be untidy; it would be unpredictable.
3. **It is untracked**, so it exists only on whichever machine created it. Nobody reviewing this repository would see it.
4. **A single `clasp push` from the wrong directory is the whole accident.** No flag, no confirmation.

> **VT-21 resolves this** — identify the project, determine whether it should exist, and if not, delete the root `.clasp.json`. Twenty minutes. **Until then, never run `clasp push` from the repository root.**

### 5.1.4 The manifest

`lets_app/appsscript.json` `[CONFIGURED]`:

| Setting | Value | Note |
|---|---|---|
| `timeZone` | `America/New_York` | |
| `runtimeVersion` | `V8` | Modern runtime |
| `exceptionLogging` | `STACKDRIVER` | Errors reach Cloud Logging |
| `webapp.executeAs` | **`USER_ACCESSING`** | **Contradicted by eight source comments** (§5.2.2) |
| `webapp.access` | `DOMAIN` | Any GSA Google account |
| Advanced services | `Drive v3`, `Gmail v1` | **Gmail is declared and unused** — 0 references `[VERIFIED]` (**G-064**) |
| `libraries` | **NONE DECLARED** | **But the HC library is used at 28 sites** (§5.7.2) |
| `oauthScopes` | **NONE DECLARED** | The permission set is inferred (**G-006**) |

**Two of these rows are findings in their own right**, and both are about something *absent* from the manifest rather than wrong in it:

- **No `libraries` entry**, while `HC.*` is referenced 28 times across 9 files `[VERIFIED]`. The binding exists only in the live project's configuration.
- **No `oauthScopes`**, so the consent screen a user sees was never designed — it is whatever Google calculates from the APIs the code happens to call, which includes full Drive. **VT-10** captures what users actually consent to.

**The `Gmail v1` declaration is the opposite problem** — declared and never used. Harmless, but it widens the inferred scope set for nothing. Removing it is a one-line change.

---

## §5.2 How code reaches users — and the two things nobody has written down

### 5.2.1 `clasp push` is not `clasp deploy`

```
developer → pull request
              ↓
         verify.yml  ── tests + 4 guards, NO credentials, cannot deploy
              ↓
      human merges to main
              ↓
      deploy-gas.yml  ── clasp push --force → production project CODE replaced
              ↓
          ??? ← no `clasp deploy` step exists
```

**Measured** `[VERIFIED]`:

| | `deploy-gas.yml` |
|---|---|
| Executes `clasp push --force` | **yes** |
| Executes `clasp deploy` | **no** |

**`push` replaces the project's code. `deploy` publishes a version that users reach.** With no deploy step, **whether a merge reaches users depends on how the active deployment is configured** — specifically whether it tracks the head version or a pinned one.

| If the deployment… | Then a merge… |
|---|---|
| Tracks the head/latest version | **reaches users immediately** |
| Is pinned to a numbered version | **does not reach users at all** until someone deploys manually |

**Which it is, is `[UNKNOWN]`.** This is not a minor detail: it is the difference between continuous delivery and a pipeline whose output never ships. **VT-01 captures it** along with the execute-as setting, in the same two-minute visit to Deploy → Manage deployments.

> **Do not describe this system as continuously deployed until VT-01 answers that.** It may be; the repository cannot say.

### 5.2.2 The execute-as contradiction, measured

| Source | Says |
|---|---|
| `lets_app/appsscript.json:20` | `"executeAs": "USER_ACCESSING"` `[VERIFIED]` |
| **Eight source lines across six files** | `USER_DEPLOYING` `[VERIFIED]` |

The eight, located `[VERIFIED]`:

| Line | What it says |
|---|---|
| `00_config/Props.js:18` | *"Logic is also broken under USER_DEPLOYING"* |
| `30_services/Attachments.js:5` | *"Architecture (USER_DEPLOYING mode)"* |
| `30_services/Feedback.js:77` | *"KNOWN BUG: under executeAs=USER_DEPLOYING in appsscript.json…"* |
| `30_services/Feedback.js:118` | *"…under USER_DEPLOYING the stamp…"* |
| `30_services/Feedback.js:229` | *"KNOWN BUG: under USER_DEPLOYING this stamps the deploying user's…"* |
| `30_services/HCStaffing.js:6` | *"Since TRIP runs as USER_DEPLOYING, the cache-miss fallback always succeeds"* |
| `40_domain/Reporting.js:310` | *"The web app runs as the deploying owner (USER_DEPLOYING)"* |
| `99_triggers/CacheWarming.js:28` | *"Optional for TRIP since USER_DEPLOYING can always do a direct read"* |

**And the manifest is not authoritative.** The "Execute as" setting is stored on the **deployment**, not in the pushed manifest. `clasp push` cannot change it, and reading the file cannot tell you what it is `[VERIFIED]`.

**Note the shape of the evidence.** Three of the eight describe *bugs that only occur under* `USER_DEPLOYING` — `Feedback.js` explains that `getUserProperties()` reads the deploying user's properties, breaking a fast path. **A developer does not write three bug comments about a mode the system is not in.** Two others (`Attachments.js`, `HCStaffing.js`) explain that a feature *works because of* it.

> **`[INFERRED]`, and stated as inference: the live deployment is probably `USER_DEPLOYING`.** The reasoning is that five of eight comments describe observed behaviour rather than intent. **This is not a substitute for VT-01** — it is a prediction, and `ADMINISTRATOR_GUIDE.md` §1.3.4 rates the Critical findings on the manifest's declared value precisely so the ratings do not rest on this inference.

**Whichever way it resolves, one body of evidence in this codebase is wrong** and should be corrected so the next reader is not misled. That is **BD-1**.

### 5.2.3 Who can deploy

| Path | Who | Controlled by |
|---|---|---|
| Merge to `main` → automatic push | Anyone with write access | **No branch protection** `[VERIFIED]` (**G-021**) |
| `workflow_dispatch` | Anyone who can run Actions | GitHub permissions |
| Local `clasp push` | Anyone holding project editor access | Not managed by this repository |
| Direct Apps Script editor edit | Any project editor | Not managed by this repository |

**The last two bypass the pipeline entirely**, and `ADMINISTRATOR_GUIDE.md` §1.5.1 ranks Apps Script project editor as the **most** privileged role in the system — above the application's own `admin`.

**VT-02** enumerates who holds each. Until it runs, **who can deploy to this system is unknown** `[UNKNOWN]`.

---

## §5.3 The CI/CD pipeline — and whether its controls actually work

### 5.3.1 The controls, and why each exists

**This pipeline is better designed than most, and the design is deliberate and self-documenting** `[VERIFIED]`. Each control carries its own reasoning in the workflow file.

| Control | What it prevents | Why it was added |
|---|---|---|
| **No `pull_request` trigger on deploy** | Opening a PR would *be* the deploy, defeating review entirely | The workflow file cites NIST CM-3 and CM-5 and says *"Do not add `pull_request` here"* |
| **`verify.yml` holds no credentials at all** | A fork PR executing untrusted code cannot deploy | *"DELIBERATELY USES NO CREDENTIALS … therefore cannot deploy … including from fork PRs"* |
| **`concurrency: deploy-gas-production`, `cancel-in-progress: false`** | Two interleaved pushes leaving production in a mixed state | `clasp push --force` overwrites; deploys are serialised |
| **`clasp` pinned to `3.4.1` exactly** | An unpinned install putting an uncontrolled third-party version on the production deploy path | Cites supply-chain control SR-3; notes clasp 2.x/3.x differ in auth handling |
| **`permissions: contents: read`** | Over-broad token scope | Least privilege, both workflows |
| **Four regression guards** | Each of the above silently regressing | §5.3.2 |

**Credit where it is due:** whoever wrote this understood the platform's hazards, wrote down *why* each control exists, and then **encoded the reasoning as tests so it cannot be undone by accident**. This is the strongest security engineering in the project and it is all LETS-original (`SYSTEM_COMPONENT_MAP.md` §2.1.4).

### 5.3.2 The four guards, tested

**A guard that does not catch what it claims to catch is worse than no guard — it provides false assurance.** So each guard was run against the current tree *and* against an input it should reject `[VERIFIED]`:

| Guard | Against the tree | Against a bad input |
|---|---|---|
| 1. Deploy must not trigger on `pull_request` | clean — passes | **CAUGHT** — bites correctly |
| 2. `verify.yml` must interpolate no secrets | clean — passes | **CAUGHT** — bites correctly |
| 3. No hardcoded spreadsheet/script IDs in `server/` | clean — passes | **see §5.3.3** |
| 4. Every test file listed in `.claspignore` | 3 of 3 listed — passes | n/a (enumerates directly) |

**Guard 2 has a nice detail worth noticing:** it greps its own file for a secret-interpolation pattern, so its explanatory comment **deliberately avoids writing the pattern literally** or it would match itself `[VERIFIED]`. Someone thought that through.

**Guard 4's rationale is the most valuable thing in the file.** clasp pushes every `.js` into one global scope where all top-level code runs on **every** execution. A pushed test file would call `require('assert')` at load time, throw, and **abort every execution including `doGet`** — taking the whole application down. `.claspignore` lists files explicitly rather than by glob *because the glob behaviour could not be verified without clasp*, and CI enforces the list `[VERIFIED]`. That is correct paranoia about a real and obscure hazard.

### 5.3.3 Guard 3 has a real coverage gap

**This is a new finding from Pass 6, registered as G-072 (Low).**

The guard rejects any literal matching `'1[A-Za-z0-9_-]{39,}'` — a 40-character floor. Its comment explains the choice: *"Google Sheets IDs are 44 chars and Apps Script IDs are 57; the 40-char floor catches both."* `[VERIFIED]`

**It does catch both. But Google has four identifier types, not two:**

| Identifier type | Length | Caught by the guard? |
|---|---|---|
| Apps Script project ID | 57 | **yes** |
| Spreadsheet ID | 44 | **yes** |
| **Drive folder ID** | **32** | **NO** |
| **Drive file ID** | **33** | **NO** |

**And there are two uncaught hardcoded Drive IDs in the tree right now** `[VERIFIED]`:

| Location | Literal |
|---|---|
| `server/91_setup/Database.js:28` | `DRIVE_FOLDER_ID: '1BVAqc5GM6L5LAE85kW94uGHLNwIAa3e'` — **finding G-065** |
| `server/00_config/TripConfig.js:154` | `const TRIP_FAVICON_ID = '1y_J9fxewAJxvdGWGc1zU988Lyd3it7WB'` |

**So the guard passes while the exact class of defect it exists to prevent is present in the code it scans.** Two asset identifiers are embedded in source where the guard's own stated principle — *"never hardcode connection strings; read from Script Properties"* — says they should not be.

> **The fix is one character: lower the floor from `{39,}` to `{29,}`.** That catches all four identifier types. It would currently fail the build on the two literals above, which is the correct outcome — they are the finding.
>
> **This is not a criticism of the guard's author.** The comment states the reasoning transparently, which is exactly why the gap is findable. A guard that silently used a magic number would have hidden it. **The lesson is that a guard should be tested against what it is supposed to reject, not only against a clean tree** — which is what `pass6_deployment_census.js` §[4] now does on every run.

### 5.3.4 One divergence the pipeline documents about itself

| | Node version |
|---|---|
| `PROJECT_PLAN.md` says | `20+` `[CLAIMED]` |
| `verify.yml` pins | **20** `[VERIFIED]` |
| `deploy-gas.yml` pins | **24** `[VERIFIED]` |

**Code is verified on Node 20 and deployed by Node 24.** Harmless in practice — `clasp push` only uploads files and runs none of the code — but it means **the tested toolchain is not the deploying one**.

`deploy-gas.yml` documents the divergence in a comment and explains it was left alone deliberately to avoid changing deploy-path behaviour during a security fix `[VERIFIED]`. **That is the right call and the right way to record it**; it is noted here only so a future reader does not treat it as an oversight.

---

## §5.4 Configuration — Script Properties

### 5.4.1 All configuration lives outside git

**Every environment-specific value is a Script Property in the live Apps Script project** `[VERIFIED]`. None is in the repository. That is correct practice — configuration separated from code — and it means **this document can tell you which keys exist and nothing about their values** `[UNKNOWN]`.

**VT-09** captures them. Ten minutes in Project Settings → Script Properties.

### 5.4.2 The 15 declared keys

`PROPS_KEYS` in `server/00_config/Props.js` maps an internal symbol to the actual property name `[VERIFIED]`:

| Symbol | Actual key | Read | Written | Purpose |
|---|---|---|---|---|
| `GSA_API_KEY` | `GSA_PERDIEM_API_KEY` | 2 | 0 | **Required** — CONUS per-diem lookups fail without it |
| `PRIVATE_MILEAGE_RATE` | `MILEAGE_RATE_PRIVATE` | 1 | 0 | Defaults to `0.70` |
| `GOV_MILEAGE_RATE` | `MILEAGE_RATE_GOV` | 1 | 0 | Defaults to `0.22` |
| `MILEAGE_RATE_EFFECTIVE_DATE` | `MILEAGE_RATE_EFFECTIVE_DATE` | 1 | 0 | Rate effective date |
| `NFS_TEMPLATE_FILE_ID` | `NFS_TEMPLATE_FILE_ID` | 1 | 0 | Non-federal-sponsorship template |
| `SHARED_DRIVE_FOLDER_ID` | `SHARED_DRIVE_FOLDER_ID` | 1 | 0 | **Required** — attachment uploads throw without it |
| `TRAVEL_LOGO_DRIVE_FILE_ID` | *(same)* | 1 | 1 | Logo asset |
| `TRAVEL_LOGO_BASE64` | *(same)* | 1 | 1 | Cached logo, set on demand |
| `TRAVEL_USERS_DATA_UPDATED` | *(same)* | 1 | 1 | Cache-invalidation broadcast timestamp |
| `EMAIL_FROM_ADDRESS` | **`travel_email_address`** | 2 | 1 | Sender address — see §5.4.4 |
| `EMAIL_FROM_NAME` | **`travel_email_name`** | 2 | 1 | Sender display name |
| `OTHER_COST_PERCENTAGE` | **`other_cost_percentage`** | 1 | 0 | Gross-up, defaults to `15` |
| `REPORT_BUILDER_PRESETS` | **`report_builder_presets`** | 1 | 1 | Saved report configurations |
| `DOD_LAST_SYNC` | **`dod_last_sync`** | 1 | 1 | Sync state |
| `DOS_LAST_SYNC` | **`dos_last_sync`** | 1 | 1 | Sync state |

**Six keys are still `lowercase_snake` while the convention is `UPPER_SNAKE`.** `Props.js` documents this, flags them, and explains that renaming requires a coordinated three-step change — add the new key, flip the mapping, delete the old `[VERIFIED]`. **That is the right way to record a known inconsistency** rather than renaming carelessly.

### 5.4.3 Five more keys exist outside `PROPS_KEYS`

`[VERIFIED]` — read directly rather than through the registry:

| Key | Read by | Why it is not in `PROPS_KEYS` |
|---|---|---|
| **`TRAVEL_DB_SPREADSHEET_ID`** | **33 references across 11 files; 27 of them `openById`** | Needed at *module load* by `TravelDB`, before `Props.js` helpers are available. `Props.js` documents the exception explicitly |
| `LETS_ENV` | `TripConfig.js:131` | Read once at module load by the environment gate (§5.4.5) |
| `FAS_TRACKER_SPREADSHEET_ID` | `TripConfig.js` | Gated — never read raw |
| `TEST_FAS_TRACKER_SPREADSHEET_ID` | `TripConfig.js` | Gated |
| `nps_last_event` | `Feedback.js` | A **user** property, not a script property — a different namespace. `Props.js` notes its logic is broken under `USER_DEPLOYING` |

> **`TRAVEL_DB_SPREADSHEET_ID` is the single most load-bearing configuration value in the system.** It is referenced 33 times across 11 files, 27 of which call `SpreadsheetApp.openById()` with it `[VERIFIED]`. If it is unset or wrong, **every** sheet operation fails — including `logError`, which opens the same spreadsheet to record the failure. **VT-09 should capture this one first.**

### 5.4.4 Two initializers, one key, two different defaults

**This is a new finding from Pass 6, registered as G-073 (Low).**

Two functions set the sender address, both idempotent — each writes only if the key is unset `[VERIFIED]`:

| Function | Default it would write | Key it writes |
|---|---|---|
| `initTravelSystemConfig` `Database.js:446` | `ASD.Travel-Events@gsa.gov` | `travel_email_address` *(lower-cased from `TRAVEL_EMAIL_ADDRESS`)* |
| `initEmailConfigDefaults` `Props.js:252` | **`aastravel@gsa.gov`** | `travel_email_address` *(via `PROPS_KEYS`)* |

**The two defaults disagree, and both target the same property.** Because each is idempotent, **whichever runs first decides the production sender address.**

**In practice the `Props.js` value wins** — but only because of the casing bug in §5.4.6, not by design `[INFERRED]`. `initTravelSystemConfig` lower-cases its keys, which for `TRAVEL_EMAIL_ADDRESS` *happens* to produce the correct key name, so both genuinely compete. For the four dead keys the same lower-casing is a defect.

> **This is the kind of thing that produces a confused incident.** "Why is mail coming from the wrong address?" has no answer in the code, because the answer is *which setup function someone happened to run first, months ago*. **VT-19** records the live value; the fix is to delete the duplicate default.

### 5.4.5 One configuration gate is exemplary

`resolveLetsEnvironment` and `resolveFASTrackerTarget` `TripConfig.js:54-127` `[VERIFIED]`:

```
LETS_ENV unset or unrecognised  →  'development'
'production' (case/space insensitive)  →  'production'
```

**It is fail-closed in every direction, and the file says so:**

> *"This gate is FAIL-CLOSED. An unset or unrecognized LETS_ENV resolves to 'development', so a newly created or misconfigured project can never reach the official tracker. Production must be opted into explicitly."* — cites CM-2, CM-6, SC-7, SI-17 `[VERIFIED]`

**Three properties that make this the quality bar for the rest of the system:**

1. **A new or misconfigured project cannot reach the official FAS tracker** — production must be opted into, never inferred.
2. **The resolved target is computed once at module load and exported**, so consumers read the gated value and cannot bypass it `[VERIFIED]`.
3. **It has a dedicated passing test suite** — `test_fas_tracker_env.js`, run on every PR.

This is LETS-original work. **It also guards an integration that cannot currently run** (**G-016**) — the care went in before the feature did.

### 5.4.6 The setup initializer writes four dead keys

`initTravelSystemConfig()` iterates its defaults and writes each key **lower-cased** `[VERIFIED]` `Database.js:454`:

```javascript
const propKey = key.toLowerCase();
```

Measured against what anything reads `[VERIFIED]`:

| Key written | Read by anything? |
|---|---|
| `private_mileage_rate` | **No** — readers use `MILEAGE_RATE_PRIVATE` |
| `gov_mileage_rate` | **No** — readers use `MILEAGE_RATE_GOV` |
| `local_travel_threshold` | **No** — appears only at its own definition |
| `drive_folder_id` | **No** — readers use `SHARED_DRIVE_FOLDER_ID` |
| `other_cost_percentage` | Yes |
| `travel_email_address` | Yes |
| `travel_email_name` | Yes |

**Four of seven are dead** — finding **G-020**.

> **The operational consequence:** an administrator who runs the documented "initialize system config" step and then sets a mileage rate **will find the rate ignored, with no error**. The system silently uses its hardcoded default of `0.70` or `0.22`.
>
> **The fix is to stop lower-casing** and write the `PROPS_KEYS` values. Four of seven keys would then work; the three that already work are unaffected because their canonical names happen to be lower-case already.

**And `drive_folder_id`'s default value is itself a finding** — a hardcoded Drive folder ID in source `Database.js:28` (**G-065**), which §5.3.3 showed the CI guard does not catch.

---

## §5.5 Scheduled jobs

### 5.5.1 The five triggers

`[VERIFIED]` — all installed by code, none declarative:

| Installer | Handler | Schedule | Purpose |
|---|---|---|---|
| `CacheWarming.js:80` | `refreshHCStaffingCache` | every 10 min | Refresh the HR staffing bundle |
| `CacheWarming.js:116` | `warmTravelDBCache` | every 5 min | Keep the sheet cache warm |
| `CacheWarming.js:196` | `warmGSACitiesCache` | every 6 hours | GSA per-diem city list |
| `PerDiemSync.js:29` | `syncDoDPerDiem` | daily at 06:00 | DoD per-diem rates |
| `PerDiemSync.js:79` | `syncForeignPerDiem` | daily at 06:00 | State Dept foreign rates |

All five handlers are defined `[VERIFIED]`.

### 5.5.2 Two trigger properties that catch administrators out

**1. Triggers belong to the person who installed them, and are invisible to everyone else.**

Apps Script triggers are per-user. If the installer leaves GSA and their account is disabled, **the triggers stop and no error is reported to anyone**. Per-diem rates quietly go stale. **No single account can see the full list** — which is why **VT-18** asks *each* project editor to run the health check separately.

**2. Google references these handlers by their function name as a string.**

`ScriptApp.newTrigger('warmTravelDBCache')` `[VERIFIED]`. **Renaming any of these five functions leaves the installed trigger pointing at a function that no longer exists.** The schedule survives; the work stops; nothing reports an error.

> **This is a hard constraint on the remediation in `ADMINISTRATOR_GUIDE.md` §1.4.5.** That fix involves adding trailing underscores to function names to take them off the browser surface. **These five must be excluded** — and the exclusion is already built into `pass6_write_surface_census.js`, which reports them separately.

### 5.5.3 There are no simple triggers

**None of `onOpen`, `onEdit`, `onFormSubmit`, `onInstall`, or `onSelectionChange` is defined anywhere** `[VERIFIED]`. Finding **G-066**, rated Informational.

It matters only because an administrator familiar with other Apps Script tools will go looking for a spreadsheet custom menu and conclude something is broken. **Nothing is broken; the menu was never built.** Administrative functions live in the `?mode=admin` console and in the Apps Script editor.

---

## §5.6 Environments — what exists, and what a real environment set would need

### 5.6.1 What exists

| Environment | Script project | Database | Configuration | Reachable by CI? |
|---|---|---|---|---|
| **Production** | configured `[VERIFIED]` | `[UNKNOWN]` | Script Properties `[UNKNOWN]` | **yes** — on merge to `main` |
| **Sandbox** | configured `[VERIFIED]` | `[UNKNOWN]` | `[UNKNOWN]` | **no** — manual push only |
| **Undocumented third** | configured, untracked | `[UNKNOWN]` | `[UNKNOWN]` | no |
| Local | n/a — three Node suites | n/a | n/a | yes — on every PR |

### 5.6.2 Four things a complete environment set would need, and whether they exist

| Requirement | Status |
|---|---|
| A distinct database per environment | **`[UNKNOWN]`** — if production and sandbox share one `TRAVEL_DB_SPREADSHEET_ID`, sandbox testing writes production data |
| A distinct FAS tracker target per environment | **Yes — and well done** (§5.4.5) |
| Automated deployment to non-production | **No** — the sandbox is manual-only |
| Documented promotion path | **No** — switching environments means swapping a tracked file (§5.1.2) |

> **The first row is the most important `[UNKNOWN]` in this section.** If the sandbox project's `TRAVEL_DB_SPREADSHEET_ID` points at the production spreadsheet, then **a sandbox test writes to live travel data** — and the only safeguard in place is the FAS tracker gate, which protects a different resource entirely.
>
> **VT-21 should capture the sandbox project's `TRAVEL_DB_SPREADSHEET_ID` alongside identifying the third project.** That turns a 20-minute task into one that also closes this question.

### 5.6.3 The environment gate protects one resource, not the system

**Worth being precise, because the gate's quality invites over-reading it.** `resolveFASTrackerTarget` prevents a non-production project from writing to the official FAS tracker. It does **not**:

- prevent a non-production project from writing to the production **database**
- prevent a non-production project from **sending mail** to real reviewers
- prevent a non-production project from **sharing Drive files** with real users

**Mail has a separate and different safeguard** — the `Suppress_Emails` flag in `Test_Submitters`, which drops every send for a flagged acting user (`WORKFLOW_AND_BUSINESS_RULES.md` C-16) `[VERIFIED]`. That is per-user, not per-environment: it protects against a *tester* generating mail, not against a *sandbox* doing so.

**So environment isolation exists for one integration and one user-level case.** The general question — can a non-production project touch production data — is `[UNKNOWN]` and reduces to §5.6.2's first row.

---

## §5.7 Disaster recovery — what a rebuild would lose

### 5.7.1 The eight categories

**If the Apps Script project were lost and rebuilt from this repository, the code would be correct and the system would not work.** Everything below is held outside git `[VERIFIED]`:

| # | What is lost | Why it is not in git | Effect of its absence |
|---|---|---|---|
| 1 | The **"Execute as"** and **"Who has access"** settings | Stored on the deployment | The manifest value may not match what was live (§5.2.2) |
| 2 | **The HC Data Library binding** | No `libraries` entry in the manifest | **Two of three site-gate allow-paths die. Failures are only `console.warn`** |
| 3 | **Every Script Property value** | Stored in the project | API key, mileage rates, folder IDs, sender address, **and `TRAVEL_DB_SPREADSHEET_ID`** all unset |
| 4 | **All five installed triggers** | Installed per-user, not declarative | Per-diem data silently goes stale |
| 5 | **The database spreadsheet binding** | The script is container-bound | A rebuilt standalone script has no database |
| 6 | **The Shared Drive folder and its membership** | Referenced by a Script Property | Attachment upload throws |
| 7 | **The deployment URL** | Generated per deployment | Every bookmark and email deep link breaks |
| 8 | **The linked GCP project and OAuth consent config** | No `oauthScopes` declared (**G-006**) | The inferred scope set may differ from the current one |

### 5.7.2 Item 2 is the one that would be missed

**Of the eight, the HC library binding is the most dangerous, because its absence produces no error.**

- It is referenced at **28 sites across 9 server files** `[VERIFIED]`.
- It is declared in **no manifest** `[VERIFIED]`, so it is invisible to this repository and to code review.
- Every call in the site gate is wrapped in `try/catch` that logs a warning and **continues** `[VERIFIED]`.

**A rebuilt project would start, serve pages, and deny access to every supervisor who relies on HC-derived access — while appearing to work normally.** The symptom would be a wave of access complaints with no corresponding error anywhere in the system.

**Items 3 and 5 fail loudly**, which is better: a missing `TRAVEL_DB_SPREADSHEET_ID` makes every sheet operation throw immediately.

### 5.7.3 What recovery would actually require

`[INFERRED]` — from the eight items above, in dependency order:

1. **Recreate or re-bind the database spreadsheet**, then set `TRAVEL_DB_SPREADSHEET_ID`.
2. **Attach the HC library** and record its identifier somewhere permanent.
3. **Restore every Script Property** from a record that does not currently exist — **which is why VT-09 is a recovery artefact, not just a verification task.**
4. **Re-create the deployment** with the correct "Execute as" and "Who has access" — which requires BD-1 to have been answered.
5. **Re-install all five triggers**, from an account that will not be deprovisioned.
6. **Re-share the Shared Drive** and set `SHARED_DRIVE_FOLDER_ID`.
7. **Re-publish the deployment URL** to every user and update email templates.

> **There is no runbook for this in the repository** `[VERIFIED]` — no deployment document, no recovery procedure, no record of the values in steps 1, 2, 3 or 6. **VT-09 and VT-02 together produce most of what a runbook would need**, which is the strongest practical argument for running them promptly rather than treating them as audit chores.

### 5.7.4 One backup capability exists, and it has a catch

`backupTravelDb` copies the entire database spreadsheet to the caller's Drive `[VERIFIED]` `Database.js:817`.

**It is unguarded and browser-callable** — part of finding **G-001**. So the backup function is simultaneously:

- **a useful recovery tool**, and
- **a data-exfiltration primitive** that any authenticated domain user can invoke to obtain a complete copy of all PII, CUI, and financial records.

**Both statements are true.** The function should be kept and guarded, not removed — it is the only backup mechanism in the system.

---

## §5.8 What this document cannot know

**Every item here is a verification task. None is left vague.** This section is longer than its equivalents in the other deliverables because deployment state genuinely lives outside the repository.

| # | Unknown | Why it matters | Resolves with |
|---|---|---|---|
| 1 | **The active deployment's "Execute as" and "Who has access"** | Gates the severity of all six Critical findings, and §5.2.2's contradiction | **VT-01** — 2 min |
| 2 | **Whether a merge reaches users** | No `clasp deploy` step exists. The pipeline may or may not ship (§5.2.1) | **VT-01** — same visit |
| 3 | **The deployed web-app URL** | Recorded nowhere in the repository | **VT-01** — same visit |
| 4 | **Who holds project editor, sheet editor, and `CLASPRC_JSON`** | Three privileges above the app's own `admin` (§5.2.3) | **VT-02** — 15 min |
| 5 | **Every Script Property value** | All configuration. Also the core of a recovery runbook (§5.7.3) | **VT-09** — 10 min |
| 6 | **Whether an HC library is attached, and to which projects** | Declared in no manifest; its absence is silent (§5.7.2) | **VT-03** — 20 min |
| 7 | **What the undocumented third project is** | 224 files would push into it, including another org's application (§5.1.3) | **VT-21** — 20 min |
| 8 | **Whether the sandbox shares the production database** | If it does, sandbox testing writes live data (§5.6.2) | **VT-21** — same visit |
| 9 | **Which triggers are installed, and under whose account** | A deprovisioned owner stops them silently (§5.5.2) | **VT-18** — 15 min, per editor |
| 10 | **The actual OAuth consent scope list** | No `oauthScopes` declared; the grant is inferred | **VT-10** — 10 min |
| 11 | **The live sender address, and whether a send-as alias exists** | Two initializers disagree (§5.4.4) | **VT-19** — 10 min |
| 12 | **Whether the manifest in the live project matches this repository's** | `clasp push --force` overwrites it, but deployment settings survive | **VT-01** / **VT-21** |

**Items 1, 2 and 3 are one two-minute task.** Items 7 and 8 are one twenty-minute task. **The whole table is under two hours**, and items 5 and 4 together produce most of a disaster-recovery runbook that does not currently exist.

### 5.8.1 Two findings in this deliverable are new

1. **G-072 — Guard 3's coverage gap** (§5.3.3). The hardcoded-ID guard uses a 40-character floor and **misses Drive folder and file IDs at 32–33 characters**. Two uncaught literals are in the tree now. **Rated Low**: the fix is one character, and the defect it misses is itself only a Low. But it is a false-assurance defect, which deserves more attention than its rating.
2. **G-073 — two initializers writing conflicting defaults to one property** (§5.4.4). **Rated Low**, and the reason to care is diagnostic rather than operational: it makes "why is mail coming from the wrong address?" unanswerable from the code.

**Both are now in `GAP_REGISTER.md` §6.5**, numbered after the existing findings so no ID moved.

---

## §5.9 For whoever deploys next

A short operational summary, drawn from everything above.

### 5.9.1 Before you deploy

| | |
|---|---|
| **Confirm what you are targeting** | `lets_app/.clasp.json` points at production. **Never run `clasp push` from the repository root** (§5.1.3) |
| **Let CI do it** | Merge to `main`. The local path bypasses four guards and the review gate |
| **Know that push ≠ ship** | Your merge replaces the code. Whether users see it depends on the deployment configuration (§5.2.1) |
| **Never rename a trigger handler** | Five functions are referenced by string name (§5.5.2) |
| **Never reorder a spreadsheet column** | `DATA_DICTIONARY.md` §3.9 |

### 5.9.2 If you add a Google service call

**No `oauthScopes` are declared**, so the consent set is inferred from code `[VERIFIED]`. Adding a call to a new Google API **silently widens what the application can do to every user's account**, and users may be re-prompted for consent with no code-review signal that anything changed.

**Declaring `oauthScopes` explicitly would fix this** — and would be the single highest-value change to the manifest. It is finding **G-006**, rated Critical.

### 5.9.3 If you are rebuilding from scratch

**Read §5.7 first.** The code in this repository is correct and insufficient. You will need, in order: the database binding, the HC library, every Script Property, a new deployment with the right execute-as, all five triggers, the Shared Drive, and a new URL communicated to every user.

**There is no runbook.** Running **VT-09** and **VT-02** now creates most of one.

---

## §5.10 Where to go next

| You want | Read |
|---|---|
| Who controls the system and how to administer it | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) — §1.3 covers the same ground for a non-technical reader |
| What every file does and how the parts connect | [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) |
| What every tab and column means | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) |
| Every rule the system enforces | [`WORKFLOW_AND_BUSINESS_RULES.md`](./WORKFLOW_AND_BUSINESS_RULES.md) |
| The ranked findings with evidence | `GAP_REGISTER.md` (Deliverable 6) |
| How to make a change safely | `ENHANCEMENT_PLAYBOOK.md` (Deliverable 7) |
| The verification tasks in order | `HUMAN_VERIFICATION_CHECKLIST.md` (Deliverable 10) |

### Reproducing this document's figures

```sh
cd docs/evidence && node pass6_deployment_census.js
```

That script enumerates every clasp target and what a push from each would carry, parses the manifest, distinguishes an **executed** `clasp push` from one merely mentioned in a guard, **runs each CI guard against the tree and against an input it should reject**, maps every Script Property to its readers and writers, and lists what a rebuild would lose. It reports zero integrity problems.

> **One method note worth carrying forward.** The first draft of that script tested for `clasp push` with a plain text match and reported **`verify.yml` as a deploying workflow** — the exact opposite of its design. `verify.yml` mentions `clasp push` four times, in a step name, three comments, and a success message, and executes it never. The script now filters comment, name, and `echo` lines before matching, and says so. **When a measurement contradicts a document's central claim, suspect the measurement first.**

---

*End of Deliverable 5. This is the deliverable with the most `[UNKNOWN]` in it, and §5.8 enumerates all twelve with the task and cost that closes each. The distinction this document maintains throughout — between what the repository **configures** and what the live project **does** — is the one thing a reader must not lose.*
