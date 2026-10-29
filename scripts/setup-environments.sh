#!/bin/sh
# Creates the `production` and `sandbox` deployment environments on clolry/LETS.
#
# Run from the repo root:   sh scripts/setup-environments.sh
#
# Writes all results to scripts/environments-result.txt so they can be reviewed
# without copying text out of the terminal.
#
# Reversible:  gh api -X DELETE /repos/clolry/LETS/environments/production
#              gh api -X DELETE /repos/clolry/LETS/environments/sandbox
#              (deleting an environment also deletes its secrets and rules, and
#              FAILS any run currently waiting for approval)
#
# RUN THIS BEFORE MERGING THE WORKFLOW CHANGE.
#   If deploy-gas.yml references an environment that does not exist yet, GitHub
#   AUTO-CREATES it on the first run — with no reviewers and no rules. The
#   deploy would then sail through while the workflow and the docs both claim it
#   is gated. That is the worst of the available outcomes, so create the
#   environments first and confirm the read-back, then merge.
#
# ----------------------------------------------------------------------------
# WHAT THIS CONFIGURES, AND WHY
#
#   This is the gate that `environment:` in .github/workflows/deploy-gas.yml
#   hangs off. Branch protection governs what may MERGE; an environment governs
#   what may DEPLOY. They are different controls and this repo needs both,
#   because a merge to `main` is what triggers the production deploy.
#
#   production
#     reviewers            both collaborators. Either may approve, so the pair
#                          is a redundancy, not a two-person rule.
#     prevent_self_review  true. The person who TRIGGERED the deploy cannot
#                          approve it. Combined with two reviewers this gives a
#                          genuine second pair of eyes on every production
#                          deploy, whoever merged.
#     can_admins_bypass    false. Not a documented body parameter of the
#                          create/update endpoint, but observed to take on
#                          2026-10-02 (read-back confirmed false). Because it
#                          is undocumented it could stop working without
#                          notice, so the read-back at the end of this script
#                          reports the observed value every run. If it ever
#                          reads true, uncheck "Allow administrators to bypass
#                          configured protection rules" in the UI — left true,
#                          @clolry could wave through his own production
#                          deploy, reducing the control to self-attestation for
#                          the person making most of the changes.
#     branch policy        `main` only. An independent refusal of any other ref,
#                          separate from the `resolve` job's case statement.
#
#   sandbox
#     No reviewers. The whole point of the sandbox is to iterate without
#     ceremony, and it writes to its own GAS project and its own copy of the FAS
#     tracker. A branch policy still pins it to the `sandbox` branch, so a
#     sandbox deploy cannot be driven from an arbitrary ref.
#
# PREREQUISITES
#   - repo must be PUBLIC (on a personal free account, environment protection
#     rules are ignored entirely on private repos — see the check below)
#   - you must hold admin on the repo
#   - token needs: Administration:write, Environments:write
# ----------------------------------------------------------------------------

set -eu

REPO="clolry/LETS"
OUT="scripts/environments-result.txt"

# Numeric user IDs. The API takes IDs, not logins, for reviewers.
# Resolved and pinned so a typo'd login cannot silently produce an environment
# with zero reviewers (which would look configured but gate nothing).
#   clolry       -> 85366696
#   0zelKirkland -> 308069572   (leading char is the DIGIT ZERO)
REVIEWER_CLOLRY=85366696
REVIEWER_OZEL=308069572

mkdir -p scripts
exec > "$OUT" 2>&1

echo "=== LETS deployment environments — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo

echo "--- preflight: auth ---"
if ! gh auth status 2>&1; then
  echo "FAIL: gh is not authenticated. Run 'gh auth login' and retry."
  exit 1
fi
echo

echo "--- preflight: visibility + admin ---"
gh api "/repos/$REPO" --jq '{private, visibility, admin:.permissions.admin}'
ADMIN=$(gh api "/repos/$REPO" --jq '.permissions.admin')
if [ "$ADMIN" != "true" ]; then
  echo "FAIL: you do not hold admin on $REPO. Cannot configure environments."
  exit 1
fi
PRIVATE=$(gh api "/repos/$REPO" --jq '.private')
if [ "$PRIVATE" = "true" ]; then
  echo "FAIL: repo is private. On a personal free account GitHub IGNORES"
  echo "      environment protection rules on private repos — the environment"
  echo "      would still exist and the workflow would still reference it, but"
  echo "      the required-reviewer gate would NOT be enforced. That is worse"
  echo "      than having no gate, because it looks like one. Make the repo"
  echo "      public or move it to a GSA organization."
  exit 1
fi
echo

echo "--- preflight: reviewers must be real users with push access ---"
# An environment whose reviewer cannot actually see the repo is a gate that can
# never be satisfied. Check before writing the rule.
for id in "$REVIEWER_CLOLRY" "$REVIEWER_OZEL"; do
  login=$(gh api "/user/$id" --jq '.login' 2>/dev/null || echo "")
  if [ -z "$login" ]; then
    echo "  FAIL: user id $id does not resolve. Fix the ID in this script."
    exit 1
  fi
  if gh api "/repos/$REPO/collaborators/$login" >/dev/null 2>&1; then
    echo "  $login (id $id): collaborator OK"
  else
    echo "  FAIL: $login (id $id) is not a collaborator on $REPO."
    echo "        A non-collaborator cannot approve a deployment, so the"
    echo "        production gate would be unsatisfiable. Add them first."
    exit 1
  fi
done
echo

echo "--- snapshot: existing environments (expect total_count 0 on first run) ---"
gh api "/repos/$REPO/environments" --jq '{total_count, names:[.environments[].name]}' 2>&1 \
  || echo "  (could not list environments)"
echo

echo "--- APPLY: production (2 reviewers, no self-approval) ---"
# ONE PUT, not two. A second PUT that omitted "reviewers" would reset them to
# empty — an environment that still looks configured but gates nothing. So
# every field goes in a single request.
#
# can_admins_bypass is included here, but it is NOT a documented body parameter
# for this endpoint. It was observed to take on 2026-10-02; the read-back below
# is still what decides, since undocumented behavior can change silently.
gh api -X PUT "/repos/$REPO/environments/production" \
  -H "Accept: application/vnd.github+json" --input - <<JSON
{
  "wait_timer": 0,
  "prevent_self_review": true,
  "can_admins_bypass": false,
  "reviewers": [
    { "type": "User", "id": $REVIEWER_CLOLRY },
    { "type": "User", "id": $REVIEWER_OZEL }
  ],
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
JSON
echo "production: PUT completed"
echo

echo "--- APPLY: production branch policy (main only) ---"
gh api -X POST "/repos/$REPO/environments/production/deployment-branch-policies" \
  -H "Accept: application/vnd.github+json" \
  -f name='main' -f type='branch' --jq '{name,type}' 2>&1 \
  || echo "  (policy 'main' may already exist — harmless)"
echo

echo "--- APPLY: sandbox (no reviewers, branch-pinned) ---"
gh api -X PUT "/repos/$REPO/environments/sandbox" \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "wait_timer": 0,
  "reviewers": null,
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
JSON
echo "sandbox: PUT completed"
echo

echo "--- APPLY: sandbox branch policy (sandbox only) ---"
gh api -X POST "/repos/$REPO/environments/sandbox/deployment-branch-policies" \
  -H "Accept: application/vnd.github+json" \
  -f name='sandbox' -f type='branch' --jq '{name,type}' 2>&1 \
  || echo "  (policy 'sandbox' may already exist — harmless)"
echo

echo "--- VERIFY: observed state ---"
for e in production sandbox; do
  echo "[$e]"
  # NOTE: every field here must be built with a form that still emits a value
  # when the rule is ABSENT. An earlier version pulled prevent_self_review out
  # of `.protection_rules[] | select(...)`, which yields NOTHING when there is
  # no required_reviewers rule — collapsing the whole object and printing an
  # empty line. That made "sandbox correctly has no reviewer gate" look
  # identical to "the read-back failed". `first(...) // null` and `[...]`
  # always produce a value, so absence reads as an explicit null/[].
  gh api "/repos/$REPO/environments/$e" --jq \
    '{name,
      can_admins_bypass,
      has_reviewer_gate: ([.protection_rules[]? | select(.type=="required_reviewers")] | length > 0),
      prevent_self_review: (first(.protection_rules[]? | select(.type=="required_reviewers") | .prevent_self_review) // null),
      reviewers: [.protection_rules[]? | select(.type=="required_reviewers") | .reviewers[]?.reviewer.login],
      rule_types: [.protection_rules[]?.type]}' 2>&1 \
    || echo "  (could not read back)"
  echo "  branch policies:"
  gh api "/repos/$REPO/environments/$e/deployment-branch-policies" \
    --jq '[.branch_policies[]? | {name,type}]' 2>&1 \
    || echo "    (could not read back)"
done
echo

echo "=== done ==="
echo "Expected production: prevent_self_review:true reviewers:[clolry,0zelKirkland]"
echo "                     rule_types include required_reviewers, policies:[main]"
echo "Expected sandbox:    no required_reviewers rule, policies:[sandbox]"
echo
echo "CHECK THE READ-BACK ABOVE, do not assume:"
echo "  1. production reviewers[] must list BOTH logins, and"
echo "     has_reviewer_gate must be true. An empty list would mean the gate"
echo "     exists but nobody can satisfy it."
echo "  2. production can_admins_bypass must read false. (Confirmed settable via"
echo "     this PUT on 2026-10-02 despite being undocumented — but it is still"
echo "     undocumented, so keep checking rather than trusting it.)"
echo "  3. sandbox is EXPECTED to read has_reviewer_gate:false and"
echo "     can_admins_bypass:true. That is the intended light posture, not a"
echo "     misconfiguration — the sandbox writes only to its own GAS project"
echo "     and its own copy of the FAS tracker."
echo
echo "STILL MANUAL — CLASPRC_JSON is a REPOSITORY secret."
echo "  The reviewer gate above already holds the job before it starts, so the"
echo "  deploy IS gated today. But a repository-scoped secret is readable by any"
echo "  future job in this repo that forgets to name an environment. Moving it to"
echo "  environment scope makes the credential itself unreachable without passing"
echo "  the gate. That requires the raw secret value, so a human must do it:"
echo "    Settings > Environments > production > Add secret > CLASPRC_JSON"
echo "    Settings > Environments > sandbox    > Add secret > CLASPRC_JSON"
echo "  then delete the repository-level CLASPRC_JSON."
echo "  Consider a separate Google identity for the sandbox while you are there."
