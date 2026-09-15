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
