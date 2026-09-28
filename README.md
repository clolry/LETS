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

## Environments

LETS runs in two Apps Script projects that share this codebase. Which FAS
Travel Exception Tracker the app may write to is decided by the `LETS_ENV`
Script Property, resolved in `lets_app/server/00_config/TripConfig.js`.

| | Production | Sandbox |
|---|---|---|
| `LETS_ENV` | `production` | `development` (or unset) |
| FAS tracker property read | `FAS_TRACKER_SPREADSHEET_ID` | `TEST_FAS_TRACKER_SPREADSHEET_ID` |
| Deployed by | `.github/workflows/deploy-gas.yml` on merge to `main` | manual `clasp push` |
| clasp config | `lets_app/.clasp.json` | `lets_app/.clasp.sandbox.json` |

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

### Pushing to the sandbox

Production deploys happen only through CI on merge to `main`. To push to the
sandbox, temporarily swap the clasp config:

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

