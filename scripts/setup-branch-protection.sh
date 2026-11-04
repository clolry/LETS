#!/bin/sh
# Applies branch protection to clolry/LETS (main + sandbox).
#
# Run from the repo root:   sh scripts/setup-branch-protection.sh
#
# Writes all results to scripts/protection-result.txt so they can be reviewed
# without copying text out of the terminal.
#
# Reversible:  gh api -X DELETE /repos/clolry/LETS/branches/main/protection
#              gh api -X DELETE /repos/clolry/LETS/branches/sandbox/protection
#
# ----------------------------------------------------------------------------
# WHAT THIS CONFIGURES, AND WHY
#
#   main     Requires 1 approving review. With exactly two collaborators this
#            is genuinely mutual: GitHub forbids approving your own pull
#            request, so whoever opens it, only the other person can approve.
#            Also requires the `Verify` status check, so a red test run blocks
#            the merge instead of merely looking bad.
#
#   sandbox  Light. Direct pushes allowed so either developer can iterate
#            quickly, but force pushes and deletion are blocked so history
#            cannot be rewritten or the branch lost.
#
#   enforce_admins=false is deliberate: it prevents locking the repo owner out
#   of recovering a broken main. The tradeoff is that protection is advisory
#   FOR ADMINS ONLY (@clolry). Non-admin collaborators are genuinely gated.
#
# PREREQUISITE: both branches must already exist on the remote.
# ----------------------------------------------------------------------------

set -eu

REPO="clolry/LETS"
OUT="scripts/protection-result.txt"

# The exact check name from .github/workflows/verify.yml (job `name:`).
# If that job is renamed, update this or merges will block forever waiting on
# a check that no longer reports.
VERIFY_CHECK="Tests and Safety Guards"

mkdir -p scripts
exec > "$OUT" 2>&1

echo "=== LETS branch protection — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo

echo "--- preflight: auth ---"
if ! gh auth status 2>&1; then
  echo "FAIL: gh is not authenticated. Run 'gh auth login' and retry."
  exit 1
fi
echo

echo "--- preflight: repo visibility + admin permission ---"
gh api "/repos/$REPO" --jq '{private, visibility, owner_type:.owner.type, admin:.permissions.admin}'
ADMIN=$(gh api "/repos/$REPO" --jq '.permissions.admin')
if [ "$ADMIN" != "true" ]; then
  echo "FAIL: you do not hold admin on $REPO. Cannot set branch protection."
  exit 1
fi
PRIVATE=$(gh api "/repos/$REPO" --jq '.private')
if [ "$PRIVATE" = "true" ]; then
  echo "FAIL: repo is private. On a personal free account, branch protection AND"
  echo "      deployment environments both require the repo to be public (or a"
  echo "      paid plan). This repo is currently public, so if you are seeing"
  echo "      this, its visibility changed — and every protection rule and"
  echo "      environment rule configured here is now being IGNORED by GitHub."
  echo "      Make it public again or move it to a GSA organization."
  exit 1
fi
echo "OK: repo is public, so branch protection and environments are available"
echo "    at no cost on a personal account."
echo

echo "--- preflight: collaborators (mutual review depends on there being 2) ---"
gh api "/repos/$REPO/collaborators" --jq '.[] | "\(.login) admin=\(.permissions.admin) push=\(.permissions.push)"' 2>&1 \
  || echo "  (could not list collaborators with this token)"
echo

echo "--- preflight: branches must exist ---"
for b in main sandbox; do
  if gh api "/repos/$REPO/branches/$b" --jq '.name' >/dev/null 2>&1; then
    echo "  $b: exists"
  else
    echo "  FAIL: branch '$b' does not exist on the remote. Create it first:"
    echo "        git switch main && git pull && git switch -c $b && git push -u origin $b"
    exit 1
  fi
done
echo

echo "--- snapshot: existing protection (404 = none, expected baseline) ---"
for b in main sandbox; do
  echo "[$b]"
  gh api "/repos/$REPO/branches/$b/protection" 2>&1 || echo "  (no existing protection)"
done
echo

echo "--- APPLY: main (review required + Verify must pass) ---"
gh api -X PUT "/repos/$REPO/branches/main/protection" \
  -H "Accept: application/vnd.github+json" --input - <<JSON
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["$VERIFY_CHECK"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false
}
JSON
echo "main: PUT completed"
echo

echo "--- APPLY: sandbox (light — direct pushes allowed, no review required) ---"
gh api -X PUT "/repos/$REPO/branches/sandbox/protection" \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "required_conversation_resolution": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false
}
JSON
echo "sandbox: PUT completed"
echo

echo "--- VERIFY: observed state ---"
for b in main sandbox; do
  echo "[$b]"
  gh api "/repos/$REPO/branches/$b/protection" --jq \
    '{admins:.enforce_admins.enabled,
      reviews:.required_pull_request_reviews.required_approving_review_count,
      stale:.required_pull_request_reviews.dismiss_stale_reviews,
      last_push:.required_pull_request_reviews.require_last_push_approval,
      checks:.required_status_checks.contexts,
      force:.allow_force_pushes.enabled,
      del:.allow_deletions.enabled,
      convo:.required_conversation_resolution.enabled}' 2>&1 \
    || echo "  (could not read back — token may lack permission to GET protection)"
done
echo

echo "=== done ==="
echo "Expected main:    admins:false reviews:1 stale:true last_push:true checks:[\"$VERIFY_CHECK\"] force:false del:false convo:true"
echo "Expected sandbox: reviews:null force:false del:false"
echo
echo "REMINDER: with only two collaborators, 'reviews:1' means each person's"
echo "pull requests require the OTHER person to approve. If one of you is"
echo "unavailable, the other cannot merge to main unless an admin bypasses"
echo "(enforce_admins:false permits this for @clolry only)."
