---
title: "Project Plan"
description: "Starting point for a new federal coding project — fill this out and let the AI agent set up everything else"
status: canonical
tier: 3
load_priority: reference-only
audience: ["developers", "managers"]
---

# Project Plan

> **Instructions:** Fill out each section below. Your AI coding agent will use this to automatically set up the repository, generate compliance documentation, and create the initial project structure. Be specific — the more detail you provide, the better the agent can help.

## Project Identity

| Field | Value |
|---|---|
| **Project Name** | Logistics, Events, and Travel System (LETS) |
| **Repository Name** | LETS |
| **Organization/Agency** | GSA / FAS / ASD (Acquisition Solutions Development) |
| **Project Owner** | Chris Olry, Project Manager, Portfolio Management Service Center |
| **Start Date** | September 28, 2026 |
| **Target Completion** | December 31, 2026 |

## Business Objective

The Logistics, Events, and Travel System (LETS) will replace fragmented, manual spreadsheets with an automated, centralized system of record for intaking, approving, budgeting, tracking, and reconciling all travel and event activities across the ASD portfolio. It serves three primary sub-organizations: FCA (Office of Mission Delivery / "OMD"), FCB (Office of Indefinite Delivery Vehicle Acquisition Management / "IDV"), and FCC (Office of Category Management / "CM"). LETS directly adopts the proven user experience of the GSA/AAS TRIP application as its foundation, layering in an active financial governance engine and mandatory compliance routing per Executive Order 14222.

## Key System & Repository Identifiers

| Asset / System | Identifier / URL | Notes |
| :--- | :--- | :--- |
| **GitHub Repository** | `https://github.com/clolry/LETS` | Primary branch: `main` |
| **Active GAS Project ID** | `1xDKibOChZtiBW4c1CP2xwbwNLPP-cH-Dgk8jFAPSryIKuL8VaF-tcGJr` | Project Title: `GSA_FCA0A_"LETS"` |
| **Parent Container** | `1kXB7eVII_EOlZEHSd-4vl3psTJZv57JvnrplhD2FA9Y` | Container-bound Google Sheet (Database) |
| **Reference TRIP App** | `1Bt_rs-1C8vR-Gydfhu2pBX5X9_olp_wHY497kMxn1pT97dXmzJm-pSkP` | Source snapshot: `~/code/LETS/reference_travel_app/` |
| **Reference Training Tracker** | `1sV1zkTTSRmAQ_Aak0W8BpABLNnqD61ZpzCs-xx7BWCnkPBsuUzxqcXuI` | Source snapshot: `~/code/LETS/training_tracker/` |
| **Reference Excel Trackers**| `FY23 CONCUR...` & `FY23 TRAVEL REPORT...` | Archived in: `~/code/LETS/reference_excel_files/` |
| **Deployment Workflow File** | `.github/workflows/deploy-gas.yml` | Triggers on `pull_request` and `push` to `main` |
| **Clasp Config File** | `lets_app/.clasp.json` | Points to the Active GAS Project ID above |
| **Auth Secret (GitHub)** | `CLASPRC_JSON` | Stored in GitHub Repository Secrets for CI/CD |

## Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| **Language** | JavaScript (Google Apps Script, V8 Runtime) | Native language for the Google Workspace platform; matches the reference TRIP application's foundation. |
| **Framework** | Google Apps Script / HTML Service (Bootstrap 5.3) | Directly inherited from the reference TRIP application to preserve its proven UX and GSA design tokens. |
| **Database** | Google Sheets (Container-bound) | Serves as the LETS relational database (Budgets, Requests, Travelers), consistent with the reference app's `TravelDB.js` pattern. |
| **Cloud/Hosting** | Google Cloud (via Google Apps Script) | Required serverless hosting environment for Apps Script. `cloud.gov` is explicitly out of scope. |
| **CI/CD** | GitHub Actions + `clasp` | Automates deployment to the GAS project ID on PR/merge. Developers must not run `clasp push` directly except for sandbox testing. |
| **Container Runtime** | None | Not applicable for the serverless Apps Script environment. |
| **Testing** | Node.js 20+ (`test_budget_engine.js`) | Used to run automated unit tests for the financial engine's business logic before deployment. |

## Compliance Level

<!-- Check ONE: -->

- [ ] **FIPS Low** — Public-facing informational content, no PII, no CUI
- [x] **FIPS Moderate** — Most federal systems: PII, financial data, internal tools
- [ ] **FIPS High** — National security systems, critical infrastructure

## Data Classification

<!-- Check all that apply: -->

- [ ] Public data only
- [x] PII (Personally Identifiable Information) — Employee names, travel itineraries, and justifications.
- [x] CUI (Controlled Unclassified Information) — Internal pre-decisional budget data and approval justifications.
- [ ] PHI (Protected Health Information)
- [x] Financial data (FTI, payment info) — FY27 budget allocations, set-asides, estimated/actual travel costs.
- [ ] Authentication credentials/secrets

## Key Requirements

1. **Adopt & Customize TRIP Application Baseline:** The system must use the complete, existing GSA/AAS TRIP application (from `reference_travel_app/`) as its starting point, preserving its core UX, per-diem caching, and role-based workflows.
2. **Active Financial Governance Engine:** Implement the full FY27 budget logic, including baseline allocations, proportional shares for DAC-level orgs (OMD, IDV, CM), self-funded/enterprise set-asides, and a mandatory "Budget Gatekeeper" check before final approval.
3. **EO 14222 & FAS Delegation Compliance:** Implement the two-tiered approval routing engine (Tier 1: FAS CoS; Tier 2: Portfolio CoS) exactly as defined in the FAS Delegation of Travel-Approving Official Authority memo.
4. **FAS Travel Exception Tracker Integration:** Build the `FASTrackerSync.js` service to programmatically append new Tier 1 requests to the official FAS Google Sheet and run a 15-minute polling trigger (`syncFASTrackerStatus`) to sync approval decisions back into LETS.
5. **Expense Lifecycle & Reconciliation:** Ensure the traveler cost table supports both "Estimated" (at intake) and "Actual" (post-travel) costs, with logic to prevent double-counting against the budget upon reconciliation.

## Constraints

- [ ] Must use FedRAMP-authorized services only
- [x] Must support Section 508 accessibility
- [x] Must integrate with existing system: **FAS Travel Exception Tracker Google Sheet** (read/write/monitor)
- [x] Must integrate with existing system: **Salesforce Event Tracker** (via manual data entry facilitated by LETS)
- [ ] Must support offline/air-gapped operation
- [x] Other: **Project must be built entirely on the Google Apps Script platform (V8 runtime), using the existing container-bound Google Sheet as its database. Deployment must occur exclusively through GitHub Actions/clasp; direct `clasp push` from local machines is restricted to sandbox testing only.**

## Team

| Role | Person | Access Level |
|---|---|---|
| Project Owner | Chris Olry | Admin |
| Lead Developer | Chris Olry | Write |
| Assistant Developer | Ozel Kirkland | Write |
| Security/ISSO | TBD | Read + Review |
| Approving Official | TBD | Read |

## Agent Environment

<!-- Where will the AI coding agent run? Check all that apply: -->

- [x] **Local machine** — developer's workstation with CLI access (`opencode` edits local files at `~/code/LETS/`, accessed via `acq/msb`).
- [ ] **GitHub Codespace** — cloud-hosted dev environment
- [ ] **Sandboxed container** — isolated Docker/Podman environment
- [x] **CI/CD only** — agent runs in GitHub Actions for automated deployment to the GAS project via `clasp`.

<!-- What services does the agent need access to? Check all that apply: -->

- [x] **GitHub** — push code to feature branches, create PRs against `main`; merges trigger deployment via `.github/workflows/deploy-gas.yml`.
- [ ] **npm/PyPI** — publish packages
- [ ] **Container registry** — push images

<!-- The `agent-permissions` skill will configure minimal-scope credentials for each checked service. -->

## Implementation Approach

LETS will be built by forking and customizing the existing GSA/AAS TRIP application (`reference_travel_app/`) rather than building from scratch, preserving its proven UX, GSA design tokens, per-diem rate services, and role-based workflow patterns. The `lets_app/` directory will follow the TRIP application's modular structure (`client/` for pages, controllers, and components; `server/` organized into numbered layers: `00_config`, `20_data`, `30_services`, `40_domain`, `50_pages`, `90_entrypoint`). New capabilities — the FY27 Budget Engine (`BudgetEngine.js`), the FAS Travel Exception Tracker sync service (`FASTrackerSync.js`), and the LETS-specific relational tables (`LetsDB.js`) — will be added alongside the inherited TRIP codebase rather than modifying its core logic where avoidable, to ease future upstream merges. Financial and compliance logic will be unit-tested locally via `test_budget_engine.js` (Node.js) prior to opening a pull request. All code changes will be developed on feature branches locally, pushed to GitHub, reviewed via pull request, and deployed to the Active GAS Project (`1xDKibOChZtiBW4c1CP2xwbwNLPP-cH-Dgk8jFAPSryIKuL8VaF-tcGJr`) exclusively through the GitHub Actions CI/CD pipeline using `clasp`. Direct `clasp push` from local machines is reserved for isolated sandbox testing only. `cloud.gov` is explicitly out of scope, as Google Apps Script's native serverless hosting is the required deployment target.

## What Happens Next

After you fill out this template and place it in your repository:

1. **The AI agent reads this file** and understands your project
2. **It runs the project-bootstrap skill** which:
   - Creates the directory structure appropriate for your stack
   - Generates AGENTS.md (behavioral contract for AI agents)
   - Copies CODING_PRACTICES.md (secure coding standards)
   - Creates ADR-001 from your implementation approach
   - Generates a risk assessment from your compliance level + data classification
   - Sets up CI/CD workflows for your stack
   - Creates SECURITY.md, CONTRIBUTING.md, LICENSE
3. **You review the generated files** and adjust as needed
4. **Start building** — the agent follows the standards automatically

The entire setup takes about 5 minutes of human input and 2 minutes of agent work.

---

## Appendix: Repository File Structure & Module Map

For reference during bootstrap, the target repository structure (inherited from the TRIP baseline plus LETS-specific additions) is:
LETS/ ├── .github/ │ └── workflows/ │ └── deploy-gas.yml ├── lets_app/ │ ├── .clasp.json │ ├── .claspignore │ ├── appsscript.json │ ├── preview.html │ ├── test_budget_engine.js │ ├── client/ │ │ ├── components/ │ │ ├── controllers/ │ │ ├── pages/ │ │ │ ├── travelPortalPage.html │ │ │ ├── travelRequestPage.html │ │ │ ├── travelBudgetDashboardPage.html │ │ │ ├── travelReviewPage.html │ │ │ ├── travelAdminPage.html │ │ │ └── letsKanbanPage.html │ │ ├── shared/ │ │ └── styles/ │ └── server/ │ ├── 00_config/ │ │ ├── TripConfig.js │ │ └── BudgetConfig.js │ ├── 20_data/ │ │ ├── TravelDB.js │ │ └── LetsDB.js │ ├── 30_services/ │ │ ├── BudgetEngine.js │ │ ├── FASTrackerSync.js │ │ └── PerDiemGSA/DoD/Foreign │ ├── 40_domain/ │ ├── 50_pages/ │ │ └── Render.js │ └── 90_entrypoint/ │ └── doGet.js ├── reference_travel_app/ ├── training_tracker/ └── reference_excel_files/

## Appendix: Required Script Properties (Google Apps Script)

Configure the following in the container-bound project's **Project Settings > Script Properties**:

| Key | Value / Source |
|---|---|
| `TRAVEL_DB_SPREADSHEET_ID` | ID of the LETS Google Sheet database (parent container: `1kXB7eVII_EOlZEHSd-4vl3psTJZv57JvnrplhD2FA9Y`) |
| `TEST_FAS_TRACKER_SPREADSHEET_ID` | Google Sheet ID of the copy used for internal testing and development instead of the official FAS Travel Exception Tracker '1FYLY0t9UCveY-NwG4x83oOECln9R2js9B9U57yH4_Og' |
| `FAS_TRACKER_SPREADSHEET_ID` | Google Sheet ID of the official FAS Travel Exception Tracker '1Qf_-U6tuKpR-1REj2C_ireaLipcbeD6aDfcgJcCeFG0' |

## Appendix: Immediate Engineering Roadmap

1. **Wire `travelRequestTravelers.html` to Budget Engine** — ensure the multi-traveler table populates Estimated costs at intake and unlocks Actual cost inputs during post-travel reconciliation.
2. **Schedule the FAS Poller Trigger** — add an installable time-driven trigger in GAS calling `FASTrackerSync.syncFASTrackerStatus()` every 15 minutes.
3. **Finalize Org Approver Routing** — connect `Org_Approvers` to the email notification dispatch so requests for OMD (FCA), IDV (FCB), and CM (FCC) route to their designated primary and alternate approvers.