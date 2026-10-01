#!/bin/sh
#
# Installs the repository's git hooks into this clone.
#
# Hooks live in .githooks/ (versioned, reviewable) and are activated by
# pointing git's core.hooksPath at that directory. This is per-clone
# configuration — every developer runs this once after cloning.
#
#   sh .githooks/install.sh
#
# To uninstall:
#
#   git config --unset core.hooksPath

set -e

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

chmod +x .githooks/pre-push

git config core.hooksPath .githooks

printf 'Installed git hooks (core.hooksPath -> .githooks)\n\n'
printf 'Active hooks:\n'
printf '  pre-push  refuses direct pushes to main (bypass: git push --no-verify)\n\n'
printf 'Reminder: this is a local guardrail, NOT enforced branch protection.\n'
printf 'It only affects this clone and is bypassable. See issue #1.\n'
