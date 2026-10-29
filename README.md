# LETS - Logistics, Events, and Travel System

The **Logistics, Events, and Travel System (LETS)** is a unified travel workflow, financial governance, and reporting platform designed to replace manual tracking sheets with a single automated source of truth.

## Core Features
1. **Unified Workflow Engine**: Kanban board visualizing request progression from Intake to Travel Completion and Reconciliation.
2. **Budget & Financial Management Engine**: Real-time discretionary balance tracking initialized with FY27 baseline travel pools:
   - Front Office / AC: $4,000
   - OMD DAC: $152,000 (15.3% proportional share)
   - IDV DAC: $659,000 (66.4% proportional share)
   - CM DAC: $182,000 (18.3% proportional share)
3. **Set-Aside Governance**:
   - DAC-Specific (Self-Funded) Set-Asides (e.g. $12,000 DAC LC travel, $52,500 COE Program)
   - Shared / Enterprise Set-Asides (e.g. Front Office LC Travel Gap $20,000 allocated proportionally)
4. **Expense Lifecycle & Variance Reconciliation**:
   - Temporary commitment of pending estimates against DAC discretionary balance
   - Post-travel actual cost entry with automated variance calculation and double-counting prevention
   - Mandatory budget availability check before leadership routing
5. **Executive & DAC Dashboards**:
   - Portfolio overview and DAC-level discretionary spend-to-date tracking

## Repository Layout
- `reference_travel_app/`: Source code and assets from the in-house TRIP travel application.
- `reference_training_tracker/`: Reference source code from the Executive Budget Dashboard & Tracker.
- `reference_excel_files/`: Legacy CONCUR and FAS travel tracking spreadsheets.
- `lets_app/`: Application source code (backend services, client views, styles, and controllers).
- `docs/`: Reverse-engineering analysis of the system as it actually is. See below.

## Documentation

`docs/` holds a measured, as-built analysis of LETS — nine documents covering
access control, the component map, the data dictionary, the business rules it
genuinely enforces versus the ones it only claims, the deployment pipeline, and
a severity-ranked register of findings.

| Start with | For |
|---|---|
| [`docs/SYSTEM_STATE.md`](./docs/SYSTEM_STATE.md) §8.0 | One page on the current state. Read this first. |
| [`docs/README.md`](./docs/README.md) | Index — routes a specific question to the document and section that answers it. |
| [`docs/ENHANCEMENT_PLAYBOOK.md`](./docs/ENHANCEMENT_PLAYBOOK.md) §7.2 | Read before changing anything. Five things that fail silently. |
| [`docs/GAP_REGISTER.md`](./docs/GAP_REGISTER.md) §6.3 | Findings, ranked, with ownership. |

Two caveats before you rely on any of it:

- **The findings are about the inherited TRIP foundation, not this README.** The
  "Core Features" above describe the intended system. `docs/SYSTEM_STATE.md`
  §8.1 documents which parts are actually reachable in running code — notably
  that the budget governance layer exposes no callable entry points, so the
  mandatory budget check described above does not currently execute. Treat the
  docs as the authority on present behaviour and this README as the intent.
- **The deployment sections were measured before this repository's deploy
  gates existed.** `docs/DEPLOYMENT_AND_ENVIRONMENTS.md` §5.2.1 records that no
  `clasp deploy` step runs and that it is therefore unknown whether a merge
  reaches users. That gap is closed by the workflow described under "Web app
  deployments" below; the doc has not yet been updated to match.

## Environments

LETS runs in two Apps Script projects that share this codebase. Which FAS
Travel Exception Tracker the app may write to is decided by the `LETS_ENV`
Script Property, resolved in `lets_app/server/00_config/TripConfig.js`.

| | Production | Sandbox |
|---|---|---|
| `LETS_ENV` | `production` | `development` (or unset) |
| FAS tracker property read | `FAS_TRACKER_SPREADSHEET_ID` | `TEST_FAS_TRACKER_SPREADSHEET_ID` |
| Deployed by | `deploy-gas.yml` on merge to `main`, **after a deploy approval** | `deploy-gas.yml` on push to `sandbox` (no approval) |
| clasp config | `lets_app/.clasp.json` | `lets_app/.clasp.sandbox.json` |
| GitHub Environment | `production` — required reviewer, prevent-self-review | `sandbox` — branch-pinned, no reviewer |

The gate is **fail-closed**: an unset or unrecognized `LETS_ENV` resolves to
`development`, and a development environment never falls back to the official
FAS tracker. A sandbox whose `TEST_FAS_TRACKER_SPREADSHEET_ID` matches the
production ID is refused outright.

### Required Script Properties

Set these per project in **Project Settings > Script Properties**. Every value
is environment-specific — the sandbox must point at its own copies.

| Key | Production | Sandbox |
|---|---|---|
| `LETS_ENV` | `production` | `development` |
| `TRAVEL_DB_SPREADSHEET_ID` | production container sheet | the sandbox's own bound sheet |
| `FAS_TRACKER_SPREADSHEET_ID` | official FAS tracker | leave unset |
| `TEST_FAS_TRACKER_SPREADSHEET_ID` | unused | your copy of the FAS tracker |
| `GSA_PERDIEM_API_KEY` | GSA per diem API key | same or a separate key |

> The sandbox's `TRAVEL_DB_SPREADSHEET_ID` must point at the sandbox's **own**
> bound spreadsheet. The `LETS_ENV` gate isolates the FAS tracker, not the
> database — a sandbox pointed at the production container would write real
> traveler PII into the live system of record.

### Pushing to the sandbox manually

Normally you do not need to: pushing to the `sandbox` branch deploys there via
CI (see "Branches and deployment" below). For a local push without going
through git, temporarily swap the clasp config:

```sh
cd lets_app
cp .clasp.json .clasp.production.json.bak   # keep the production pointer
cp .clasp.sandbox.json .clasp.json
clasp push
cp .clasp.production.json.bak .clasp.json   # restore before committing
```

Do not commit a `.clasp.json` that points at the sandbox — CI reads that file
to find the production target.

## Verification

```sh
node lets_app/test_budget_engine.js    # FY27 budget engine logic
node lets_app/test_fas_tracker_env.js  # environment gate / FAS tracker isolation
```

Both run automatically on every pull request via `.github/workflows/verify.yml`,
which holds no credentials and therefore cannot deploy.

## Branches and deployment

| Branch | Deploys to | How code gets there |
|---|---|---|
| `main` | **Production** GAS project | pull request + 1 approving review, then a deploy approval |
| `sandbox` | **Sandbox** GAS project | direct push (no review required) |
| feature branches | nothing | PR into `main`, or merge into `sandbox` to test |

Pushing to `main` or `sandbox` triggers `.github/workflows/deploy-gas.yml`,
which resolves the target from the branch name and refuses to deploy from any
other ref. Pull requests never deploy — they run `verify.yml`, which holds no
credentials.

### The two gates

Merging and deploying are protected separately, because on this repo a merge to
`main` is what *triggers* the production deploy:

| Gate | Mechanism | What it stops |
|---|---|---|
| **Merge gate** | branch protection on `main` | unreviewed code reaching the default branch, and force pushes or deletion of history |
| **Deploy gate** | the `production` GitHub Environment | the deploy job starting until a reviewer who did **not** trigger it approves |

The deploy gate is the `environment:` key on the deploy job. GitHub applies the
environment's rules *before* the job starts, which is also what will scope
`CLASPRC_JSON` once that secret is moved to environment scope. `verify.yml` has
a guard that fails the build if that key is removed or hardcoded.

Both are available at no cost **because this repository is public**. On a
personal free account, making it private would cause GitHub to ignore the
environment protection rules entirely — the gate would still appear in the UI
and the workflow would still reference it, but it would not be enforced. If this
repo ever needs to be private, move it to a GSA organization first. Both setup
scripts refuse to run on a private repo for this reason.

### Applying the protection

```sh
sh scripts/setup-environments.sh        # deploy gate -> scripts/environments-result.txt
sh scripts/setup-branch-protection.sh   # merge gate  -> scripts/protection-result.txt
```

**Run `setup-environments.sh` before the workflow change reaches `main`.** If
`deploy-gas.yml` names an environment that does not exist, GitHub auto-creates
it with no reviewers and no rules, and the deploy proceeds ungated while the
workflow and these docs both claim otherwise.

Both need repo **admin** and are idempotent — re-run them after changing
collaborators. Each writes a read-back of the *observed* state to its result
file; check that, rather than assuming the write took. Neither result file is
committed.

### Who can approve what

`main` requires one approving review, and the `production` environment requires
a deploy approval with **Prevent self-review** on. GitHub does not allow
approving your own pull request, and prevent-self-review stops the person who
triggered a deploy from approving it. With two collaborators that means each
person's production changes are genuinely seen by the other at both gates.

> **If one of you is unavailable, the other cannot ship to production.** That is
> the intended effect, but it does block releases. `sandbox` is unaffected and
> needs no approval at either gate — use it to keep working.
>
> Branch protection sets `enforce_admins: false`, so @clolry can bypass the
> *merge* gate to recover a broken `main`. The *deploy* gate is stricter: the
> `production` environment has `can_admins_bypass: false`, so **not even an
> admin can wave through a production deploy** — recovering from a stuck deploy
> means deliberately editing or deleting the environment, which is a logged
> config change rather than a one-click bypass. Either way, say why in the PR.

### Day-to-day: testing in the sandbox

```sh
git switch sandbox
git pull
git merge your-feature-branch     # or commit directly
git push                          # deploys to the sandbox GAS project
```

### Shipping to production

```sh
sh .githooks/install.sh           # run once per clone
git switch -c your-branch-name
# ...work, commit...
git push -u origin your-branch-name
gh pr create --base main
```

After the other developer approves and you merge, the deploy workflow starts and
then **waits** — go approve the `production` deployment (or ask the other
developer to, if prevent-self-review blocks you) under the run's summary page or
the repo's **Deployments** tab. Until that approval, nothing reaches the live
Apps Script project.

### The pre-push hook

`.githooks/install.sh` points `core.hooksPath` at `.githooks/`, activating a
`pre-push` hook that refuses direct pushes to `main`.

> **The hook is a convenience, not the control.** It is client-side, applies
> only to the clone where it is installed, is bypassed by
> `git push --no-verify`, and is inert until the installer is run. Server-side
> branch protection is the real gate; the hook just catches muscle memory
> before it reaches GitHub.
>
> If the hook is ignored with a *"not set as executable"* hint, run
> `chmod +x .githooks/pre-push .githooks/install.sh`.

### Web app deployments (`/exec` vs `/dev`)

`clasp push` updates script **content** only. A versioned `/exec` web app keeps
serving its pinned version until a new version is created and the deployment is
updated, so a green deploy run can still leave the live URL on stale code. The
`/dev` URL always serves HEAD and reflects a push immediately.

The deploy workflow therefore runs `clasp deploy -i <deploymentId>` after
pushing, reading the ID from a repository variable:

| Variable | Target |
|---|---|
| `GAS_PRODUCTION_DEPLOYMENT_ID` | production `/exec` deployment |
| `GAS_SANDBOX_DEPLOYMENT_ID` | sandbox `/exec` deployment |

Set these in **Settings > Secrets and variables > Actions > Variables**. Find
the ID in the Apps Script editor under **Deploy > Manage deployments** (it
starts with `AKfycb...`). If a variable is unset the workflow still pushes
code, warns, and leaves the `/exec` deployment on its previous version.

