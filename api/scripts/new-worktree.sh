#!/usr/bin/env bash
# Create a worktree that can actually run the checks.
#
# A fresh `git worktree add` gives you tracked files and nothing else, so
# type-check, lint and the test suite all fail on a missing node_modules, and
# the suite fails again later on a missing .env.test. This does the four steps
# that close that gap, in the order the repo's CLAUDE.md describes them.
#
# Repo-agnostic: everything is resolved from the git checkout it is run in, so
# it works from a sibling project too (`../critical-path-api/scripts/new-worktree.sh <branch>`).
#
# Usage: scripts/new-worktree.sh <branch> [base-ref]

set -euo pipefail

branch=${1-}
base=${2-}

if [ -z "$branch" ] || [ "$branch" = "-h" ] || [ "$branch" = "--help" ]; then
  echo "Usage: ${0##*/} <branch> [base-ref]" >&2
  echo >&2
  echo "Creates ~/.worktrees/<repo>/<branch>, symlinks node_modules from the main" >&2
  echo "checkout, and copies the untracked .env files the suite needs." >&2
  exit 1
fi

# The main checkout, not wherever this is run from: the git dir of a worktree
# points back at the original, which is the only place node_modules and the
# .env files exist. Deliberately not `..`-counting, which breaks the moment the
# worktree sits at a different depth.
git_common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
main_checkout=$(dirname "$git_common_dir")
repo=$(basename "$main_checkout")
worktree="$HOME/.worktrees/$repo/$branch"

if [ -e "$worktree" ]; then
  echo "error: $worktree already exists" >&2
  exit 1
fi

# Outside the repository on purpose. A worktree under the project root is a
# second full copy of the codebase that every recursive search has to walk.
case "$worktree" in
"$main_checkout"/*)
  echo "error: refusing to create a worktree inside the repository" >&2
  exit 1
  ;;
esac

if git -C "$main_checkout" show-ref --verify --quiet "refs/heads/$branch"; then
  echo "==> reusing existing branch $branch"
else
  git -C "$main_checkout" branch "$branch" ${base:+"$base"}
  echo "==> created branch $branch${base:+ from $base}"
fi

git -C "$main_checkout" worktree add "$worktree" "$branch"

# Absolute, so the link does not depend on how deep the worktree sits. A nested
# package with its own dependencies needs its own link.
for dir in "" $(cd "$main_checkout" && git ls-files '*/package.json' | xargs -n1 dirname 2>/dev/null || true); do
  src="$main_checkout${dir:+/$dir}/node_modules"
  dest="$worktree${dir:+/$dir}/node_modules"
  if [ -d "$src" ] && [ ! -e "$dest" ] && [ -d "$(dirname "$dest")" ]; then
    ln -s "$src" "$dest"
    echo "==> linked ${dir:-.}/node_modules"
  fi
done

# Untracked by design (they hold secrets), so the worktree starts without them
# and the suite cannot load .env.test. Examples are tracked already.
copied=0
for env_file in "$main_checkout"/.env*; do
  [ -f "$env_file" ] || continue
  case "${env_file##*/}" in
  *.example | *.sample) continue ;;
  esac
  cp "$env_file" "$worktree/"
  copied=$((copied + 1))
done
[ "$copied" -gt 0 ] && echo "==> copied $copied env file(s)"

echo
echo "Ready: $worktree"
echo "  cd $worktree"
