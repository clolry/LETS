---
title: "LETS Documentation — Index"
description: "Where to find the answer to your question about the Logistics, Events, and Travel System"
status: canonical
tier: 1
audience: "anyone opening this folder for the first time"
last_updated: "2026-10-28"
---

# LETS Documentation

**Nine documents and fourteen measurement scripts describing the Logistics, Events, and Travel System as it actually is.**

This file is an **index**, not a summary. For the current state of the system in one page, read [`SYSTEM_STATE.md`](./SYSTEM_STATE.md) §8.0.

---

## Start here

**New to this system?** Read [`SYSTEM_STATE.md`](./SYSTEM_STATE.md) §8.0 — one page, and it ends with the four things to do first.

**Arrived with a specific question?** The table below routes you. **Looking for your role?** §Reading orders.

---

## Route by question

### About access and control

| Question | Go to |
|---|---|
| Who can get into this system? | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) §1.4 |
| Who is actually in charge of it? | **`ADMINISTRATOR_GUIDE.md`** §1.5 — the answer is not who you would expect |
| How do I grant someone access? | `ADMINISTRATOR_GUIDE.md` §1.6.1 |
| How do I **revoke** access? | **`ADMINISTRATOR_GUIDE.md`** §1.6.2 — there are two traps |
| Can I see who did what? | `ADMINISTRATOR_GUIDE.md` §1.8 |
| Who held the admin role last March? | **`SYSTEM_STATE.md`** §8.4.1 — you cannot find out from this system |
| Is it secure? | `SYSTEM_STATE.md` §8.2, then [`GAP_REGISTER.md`](./GAP_REGISTER.md) |

### About how it works

| Question | Go to |
|---|---|
| What does the system actually do today? | `ADMINISTRATOR_GUIDE.md` §1.2 |
| What happens when someone submits a travel request? | [`WORKFLOW_AND_BUSINESS_RULES.md`](./WORKFLOW_AND_BUSINESS_RULES.md) §4.2–4.4 |
| What rules does it enforce? | **`WORKFLOW_AND_BUSINESS_RULES.md`** §4.1 — 7 of 70 are genuinely enforced |
| What rules does it *claim* and not enforce? | `WORKFLOW_AND_BUSINESS_RULES.md` §4.8 |
| Does "Completed" mean the trip happened? | **`SYSTEM_STATE.md`** §8.3.2 — no, and this matters for reporting |
| Is the budget check real? | **`SYSTEM_STATE.md`** §8.1.1 — no |
| How is cost calculated? | `WORKFLOW_AND_BUSINESS_RULES.md` §4.5 |

### About the code and data

| Question | Go to |
|---|---|
| What is this system made of? | [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) §2.0 |
| Which file does what? | `SYSTEM_COMPONENT_MAP.md` §2.3 |
| What happens when someone loads a page? | `SYSTEM_COMPONENT_MAP.md` §2.2 |
| What does this spreadsheet column mean? | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) |
| Which columns hold personal or sensitive data? | `DATA_DICTIONARY.md` — sensitivity is marked on every column |
| Can I reorder a column? | **`DATA_DICTIONARY.md`** §3.9 — no, and the failure is silent |
| Why does the budget code not run? | `SYSTEM_COMPONENT_MAP.md` §2.6 |

### About deploying and changing it

| Question | Go to |
|---|---|
| How does code get to production? | [`DEPLOYMENT_AND_ENVIRONMENTS.md`](./DEPLOYMENT_AND_ENVIRONMENTS.md) §5.2 |
| Does my merge reach users? | **`DEPLOYMENT_AND_ENVIRONMENTS.md`** §5.2.1 — unknown, and VT-01 answers it |
| What configuration exists, and where? | `DEPLOYMENT_AND_ENVIRONMENTS.md` §5.4 |
| What would we lose if the project were deleted? | **`DEPLOYMENT_AND_ENVIRONMENTS.md`** §5.7 |
| **How do I make a change without breaking something?** | **[`ENHANCEMENT_PLAYBOOK.md`](./ENHANCEMENT_PLAYBOOK.md)** |
| What must I never do? | **`ENHANCEMENT_PLAYBOOK.md`** §7.2 — five things, all of which fail silently |
| How do I fix the worst finding? | `ENHANCEMENT_PLAYBOOK.md` §7.3 |
| How do I add a field? | `ENHANCEMENT_PLAYBOOK.md` §7.10 |

### About the findings

| Question | Go to |
|---|---|
| What is wrong with it, ranked? | [`GAP_REGISTER.md`](./GAP_REGISTER.md) §6.3 |
| Why is that rated Critical? | `GAP_REGISTER.md` §6.1 — the rubric is stated before it is applied |
| Who owns the fix — us or the system we inherited? | `GAP_REGISTER.md` — the Owner column, derived mechanically |
| What can we not fix without a decision? | **`GAP_REGISTER.md`** §6.8 — seven findings |
| What is already fixed but switched off? | **`GAP_REGISTER.md`** §6.9 — two |
| What do I need to go and check manually? | `HUMAN_VERIFICATION_CHECKLIST.md` *(Deliverable 10 — not yet written)* |

---

## The nine documents

| # | Document | Answers | Lines |
|---|---|---|---|
| 1 | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) | How to obtain, hold, and account for control of the system | 816 |
| 2 | [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) | Every file and module, what it does, who owns it, how the parts connect | 692 |
| 3 | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) | Every tab, every column, its meaning, sensitivity, and provenance | 1,068 |
| 4 | [`WORKFLOW_AND_BUSINESS_RULES.md`](./WORKFLOW_AND_BUSINESS_RULES.md) | Every rule it enforces, every rule it only claims, every rule needing a decision | 702 |
| 5 | [`DEPLOYMENT_AND_ENVIRONMENTS.md`](./DEPLOYMENT_AND_ENVIRONMENTS.md) | The projects, the pipeline, the configuration, and what a rebuild would lose | 608 |
| 6 | [`GAP_REGISTER.md`](./GAP_REGISTER.md) | **73 findings**, severity-ranked with a stated rubric, with ownership and blockers | 635 |
| 7 | [`ENHANCEMENT_PLAYBOOK.md`](./ENHANCEMENT_PLAYBOOK.md) | How to change it without breaking it — recipes, prohibitions, verification | 730 |
| 8 | [`SYSTEM_STATE.md`](./SYSTEM_STATE.md) | **An honest current-state summary.** Start here | 362 |
| 9 | `README.md` | This index | — |
| 10 | `HUMAN_VERIFICATION_CHECKLIST.md` | **29 tasks a human must do with live access.** *Not yet written* | — |

---

## Reading orders

### If you are the project manager or system owner

| Order | Document | Why |
|---|---|---|
| 1 | [`SYSTEM_STATE.md`](./SYSTEM_STATE.md) | §8.0 is one page and ends with what to do this week |
| 2 | [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) | §1.5 tells you who actually controls the system; §1.6 is the operational detail |
| 3 | [`GAP_REGISTER.md`](./GAP_REGISTER.md) | §6.8 — the seven findings **you** have to unblock, not engineering |
| 4 | `HUMAN_VERIFICATION_CHECKLIST.md` | Under six hours of work that closes most of the unknowns |

**The one thing to do first:** `ADMINISTRATOR_GUIDE.md` §1.3.4 — **VT-01**, two minutes, and it conditions the severity of every Critical finding.

### If you are a developer about to change something

| Order | Document | Why |
|---|---|---|
| 1 | **[`ENHANCEMENT_PLAYBOOK.md`](./ENHANCEMENT_PLAYBOOK.md) §7.0–7.2** | **Four pages. Read before any change, however small.** Five ways this codebase breaks silently |
| 2 | [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) | §2.1 for the structural facts; §2.8 for the fragile seams |
| 3 | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) | §3.9 if you are anywhere near the spreadsheet |
| 4 | `ENHANCEMENT_PLAYBOOK.md` §7.3–7.10 | Your specific recipe |

**The one thing to know first:** things here are connected **by string, not by reference** — function names in HTML, trigger handlers in `ScriptApp`, columns by position. **A compiler would catch none of it.**

### If you are the ISSO or an assessor

| Order | Document | Why |
|---|---|---|
| 1 | [`SYSTEM_STATE.md`](./SYSTEM_STATE.md) | §8.2 the security position; §8.7 the inheritance question, answered both ways |
| 2 | [`GAP_REGISTER.md`](./GAP_REGISTER.md) | 73 findings with a stated rubric, mechanical ownership, and evidence pointers |
| 3 | [`DEPLOYMENT_AND_ENVIRONMENTS.md`](./DEPLOYMENT_AND_ENVIRONMENTS.md) | §5.8 — twelve things nobody has recorded, each with the task that closes it |
| 4 | [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) | Sensitivity classification on every column; §3.4 for the authorization tables |

**The two things to ask about first:** §8.4.1 — authorization-change history is unrecoverable, so **export the role tables now** (VT-05). And §8.2.1 — all six Critical findings are inherited, which changes the remediation conversation.

### If you are inheriting this project

Read [`SYSTEM_STATE.md`](./SYSTEM_STATE.md), then [`ENHANCEMENT_PLAYBOOK.md`](./ENHANCEMENT_PLAYBOOK.md) §7.2, then [`GAP_REGISTER.md`](./GAP_REGISTER.md) §6.10.2 — the sequencing constraints that are not obvious from the ranking.

---

## The identifiers

Three ID series run through every document.

| Series | Meaning | Where defined |
|---|---|---|
| **`G-001`…`G-073`** | **Findings.** Permanent; never reused or renumbered | [`GAP_REGISTER.md`](./GAP_REGISTER.md) §6.3 |
| **`VT-01`…`VT-29`** | **Verification tasks** — things a human must check with live access | `HUMAN_VERIFICATION_CHECKLIST.md` |
| **`BD-1`…`BD-6`** | **Business decisions** — questions no amount of code reading can answer | [`WORKFLOW_AND_BUSINESS_RULES.md`](./WORKFLOW_AND_BUSINESS_RULES.md) §4.9 |

> **`G-NNN` is not the current severity order.** The register carries a separate, mutable **`Rank`** column, and **rank is what reflects current severity**. IDs began in severity order and no longer are — one finding has been re-rated and five were added after the initial numbering. Renumbering would invalidate citations in nine documents, so the ID is frozen and the rank moves.

### Confidence markers

Every factual claim in these documents carries one:

| Marker | Meaning |
|---|---|
| `[VERIFIED]` | Measured by a script in [`evidence/`](./evidence/), or read directly from source |
| `[INFERRED]` | A reasoned conclusion — the reasoning is given so you can disagree with it |
| `[CLAIMED]` | Asserted by project documentation and **not** confirmed in code |
| `[CONFIGURED]` | The repository specifies this; whether the live system matches is a separate question |
| `[UNKNOWN]` | Cannot be determined from the repository. Requires someone with live access |
| `[NOT FOUND]` | A rule or mechanism the documentation describes that **does not exist** |

---

## The evidence

**Every counted claim in these documents is produced by a script, not asserted.** None was counted by hand.

```sh
cd docs/evidence && for f in *.js; do echo "== $f"; node "$f"; done
```

**Fourteen scripts, about fifteen seconds, no credentials and no network.** They read the repository and print what they find.

| Script | Proves |
|---|---|
| `pass5_guard_census.js` | The guard census — 459 functions, 412 browser-reachable, 31 behind a refusing guard |
| `pass6_write_surface_census.js` | The write surface — 51 functions that change data with no authorization check |
| `pass6_client_call_census.js` | What the screens actually call — 64 names, 61 resolving, 3 that do not exist |
| `pass6_component_map.js` | Layer metrics, the include graph, and **the two-way proof that the budget layer is unreachable** |
| `pass6_schema_census.js` | Every declared schema, and whether each writer matches the schema it targets |
| `pass6_rule_census.js` | The state machine extracted from source, and **the fail-open test executed against degraded input** |
| `pass6_deployment_census.js` | Clasp targets, the manifest, Script Properties, and **each CI guard run against what it should reject** |
| `pass6_manifest_recount.js` | The file inventory, and **every finding's ownership by byte-comparison** against the inherited application |
| `pass6_change_impact.js` | Rename blast radius per function, the adoption surface for the two unused guards, and the recipe baselines |
| `pass6_register_check.js` | **The register as a dataset** — ID continuity, block counts, bidirectional citation consistency |
| `pass4_budget_engine_baseline.js` | The real FY27 budget figures, by execution |
| `pass4_budget_engine_edge_cases.js` | Four budget defects, by execution |
| `pass4_request_service_edge_cases.js` | Three request-service defects, by execution |
| `pass3_D7_sheet_shape_mismatch.js` | That the budget engine reads **$0 for every office** when fed real sheet data |

### Why the scripts matter more than the numbers

**Several of them deliberately report where their own mechanical answer differs from a document's prose**, rather than silently substituting one for the other.

That convention caught real errors while these documents were being written:

| Caught | Detail |
|---|---|
| **Four mis-numbered finding citations** | Each named a plausible *nearby* finding, which is why a human reviewer would have passed over them |
| **One wrong cross-document count** | Two scripts counted the guard functions themselves as "guarded", reporting 33 where 31 is correct |
| **Four published figures withdrawn** | See below |

**And four times the naive measurement produced a confident wrong answer** — reporting a status vocabulary entry as a status, a verification workflow as a deploying one, 55 of 73 findings as dropped, and 42 coupled functions instead of 61. All four were caught because the result contradicted something already established. **The standing rule: when a measurement contradicts a document's central claim, suspect the measurement first.**

### Also runnable

The application's own three test suites:

```sh
cd lets_app && for f in test_*.js; do echo "== $f"; node "$f"; done
```

**All three pass, and two prove less than they appear to** — [`SYSTEM_COMPONENT_MAP.md`](./SYSTEM_COMPONENT_MAP.md) §2.6.3 explains why. **Do not treat green tests as evidence the budget layer works.**

---

## What is *not* in these documents

### Working notes, superseded

Six files in this folder are the analysis passes that produced the deliverables. **They are working notes, kept for traceability, and the deliverables supersede them wherever the two disagree.**

`FILE_MANIFEST.md` · `ENTRY_POINTS_AND_ROUTING.md` · `DATA_LAYER_PASS3.md` · `BUSINESS_LOGIC_PASS4.md` · `SECURITY_AND_ACCESS_PASS5.md` · `GAP_CONSOLIDATION_PASS6.md`

**Of these, only [`GAP_CONSOLIDATION_PASS6.md`](./GAP_CONSOLIDATION_PASS6.md) is worth reading on its own** — it records how 75 pass-level IDs were reconciled into the register, and §6.11 is the cross-reference appendix if you are following a citation from an older document.

### Four figures that must not be cited again

Found wrong during consolidation `[VERIFIED]`:

| Withdrawn | Use instead |
|---|---|
| *"64 unguarded write-capable functions"* | **51** (writes in its own body) or **72** (including transitive reach) — never 64, which is neither reading |
| A four-way guard breakdown claiming **12** screen-invoked functions have no authorization check | **27.** The original read *"reads the caller's identity"* as *"checks the caller's identity"* |
| An inventory of 112 application files, 87 byte-identical | **113** and **88**. The per-file tables were correct; only the prose summary was wrong |
| Four ownership labels attributing inherited defects to this project | Three are inherited; one is shared |

### Scaffolding, to be deleted

`_RESUME_HERE.md` exists so the documentation work could resume across sessions. **It is not a deliverable. Delete it when Deliverable 10 is finished.**

### What no document here can tell you

**Twelve facts about the live deployment are not in version control** — which project is live, how it executes, who holds the privileged accounts, what every configuration value is. That is not a gap in the work; deployment state genuinely lives outside the repository.

[`DEPLOYMENT_AND_ENVIRONMENTS.md`](./DEPLOYMENT_AND_ENVIRONMENTS.md) §5.8 lists all twelve with the task and cost that closes each. **The whole table is under two hours.**

---

## How these documents were produced

| | |
|---|---|
| **Method** | Six analysis passes over the source, then nine deliverables synthesised from them |
| **Evidence rule** | **If a number appears in a document, a script must produce it.** Adopted after hand-counted figures in the early passes proved wrong |
| **Verification** | Every file and line citation was checked to resolve; every table checked for consistency; every finding ID checked in both directions against the register |
| **Scope** | Static analysis of the repository, plus execution of logic copied verbatim from the source. **No Google service was contacted and no live system was read** |

**That last line is the boundary of this work.** These documents describe the code with confidence and the running system with care. Where the distinction matters, the `[CONFIGURED]` and `[UNKNOWN]` markers say so — and Deliverable 10 is the list of what someone with live access needs to confirm.

---

*Index to Deliverables 1–10. For the state of the system, read [`SYSTEM_STATE.md`](./SYSTEM_STATE.md). For what is wrong with it, [`GAP_REGISTER.md`](./GAP_REGISTER.md). For how to change it, [`ENHANCEMENT_PLAYBOOK.md`](./ENHANCEMENT_PLAYBOOK.md).*