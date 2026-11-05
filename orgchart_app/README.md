# Org chart

A read-only web app showing the ASD reporting structure, built from the same
`HC_Positions` and `HC_Orgs` tabs the LETS travel app uses.

## First-time setup

1. Push: `cd orgchart_app && clasp push`
2. In the Apps Script editor: **Project Settings → Script Properties**, add
   `HC_SPREADSHEET_ID` = the LETS travel database spreadsheet ID.

   > **Get this value from the LETS project**, not from a Drive URL you
   > happen to have open. Open LETS → Project Settings → Script Properties →
   > `TRAVEL_DB_SPREADSHEET_ID` and copy it exactly.
   >
   > The travel database is the spreadsheet holding `Requests`,
   > `Travel_Users` and the `HC_` tabs. It is **not** the FAS Travel Exemption
   > Tracker and **not** a Google Form responses sheet — those are separate
   > files and will report both HC tabs as missing.
3. Run `checkOrgChartSetup()` from the editor. It reports whether the
   spreadsheet opens, whether both tabs are present, how many people and org
   codes it found, and any problems in the data.
4. **Deploy → New deployment → Web app.** Set *Execute as* to **Me** and
   *Who has access* to **anyone within the organization**.

### Why "Execute as: Me"

The deploying account reads the spreadsheet on everyone's behalf. The
alternative — *Execute as: User accessing* — would require sharing the entire
LETS travel database with every domain user in order to display a reporting
chart. That is a far larger disclosure than the chart itself.

The access control is therefore the deployment setting plus the data
reduction: each node carries name, title, org and city only. No email, no
grade, no employee ID, no position number.

## Optional properties

| Property | Default | Notes |
|---|---|---|
| `ORG_NAME` | `Acquisition Solutions Development` | Page title and header |
| `CACHE_MINUTES` | `60` | Clamped to 1–360. The chart changes when HR data changes — rarely, never urgently |

## Using it

- **Search** is the primary interaction — `/` focuses it. Matches are
  highlighted and their reporting line is kept, because "where do they sit" is
  the question an org chart answers.
- Levels three and below start collapsed. Expanding everything on a six-level
  chart renders a thousand rows and buries the structure.
- **Refresh** bypasses the cache.
- A yellow banner reports problems in the source data — duplicate position
  numbers, reporting cycles, more than one person reporting to nobody. Those
  are fixed in LETS (**Admin → HR Roster**), not here.

## Org codes

Codes are hierarchical: `FCA0A` sits under `FCA` under `FC`. Each node shows
the **most specific** name available — `FCA0A` displays as "Portfolio
Management Service Center", not as its parent's name.

If org labels show bare codes instead of names, `HC_Orgs` has not been
populated. In LETS: **Admin → HR Roster → Load Org Codes**.

## Relationship to LETS

This project **only reads**. LETS owns both tabs.

`server/20_data/HCRead.js` is a deliberate second implementation of
`lets_app/server/20_data/HCData.js` — not a copy, and not a library call. A
library binding was rejected because LETS exists in its current form precisely
*because* the inherited HC library became unreachable; recreating that
coupling would reproduce the failure it was built to escape.

The cost of duplication is drift, and drift here is silent — a chart that
quietly disagrees with the roster. So `test_orgchart.js` §6 loads both readers
and asserts they agree on all 137 real org codes. It runs in CI.

```
node orgchart_app/test_orgchart.js
```
