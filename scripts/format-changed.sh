#!/bin/sh
# Format the working tree's modified and untracked files with the commit hook's
# own per-package dispatch — .githooks/format-touched in its --no-amend mode —
# so format:check can pass BEFORE the commit instead of only after the hook's
# amend. This is the one sanctioned way to fix formatting by hand: there is no
# root node_modules and only each package's own binary and config may touch its
# files (format-touched's header has the failure modes), so prettier or eslint
# are never run directly.
#
#   scripts/format-changed.sh
#
# Files the branch already committed are deliberately not revisited: the hook
# formatted them at commit time, and re-reading them against a stale base would
# only reformat whatever main gained since.

set -eu

root=$(git rev-parse --show-toplevel)
cd "$root"

# Porcelain's two status letters and their space, and a rename's old name, are
# all that is stripped — extension filtering lives in format-touched, and it
# skips the deleted paths porcelain still names. No quoting is handled here for
# the reason the hook documents: a path containing a space reaches the fixers
# split in two, the known limitation its tests assert.
paths=$(git status --porcelain --untracked-files=all | sed -e 's/^...//' -e 's/.* -> //')
[ -z "$paths" ] && exit 0

# shellcheck disable=SC2086  # one argument per path is the point
exec "$(dirname "$0")/../.githooks/format-touched" --no-amend $paths
