#!/usr/bin/env bash
# Create a worktree that can actually run the checks.
#
# A fresh `git worktree add` gives you tracked files and nothing else, so
# type-check, lint and the test suite all fail on a missing node_modules, and
# the suite fails again later on a missing .env.test. This closes both gaps: it
# copies the untracked .env files out of the main checkout, then installs each
# package's dependencies where they belong.
#
# Both halves are per package, not per checkout. This is a monorepo of four
# packages with four lockfiles, and the .env files the api suite reads live in
# api/ rather than at the checkout root — a copy loop that looked only at the
# root matched nothing, and because it announced a count only when that count
# was non-zero it said nothing about it either. The failure surfaced much later,
# as a suite dying on a missing .env.test in a worktree whose change was
# unrelated. Every count below is therefore printed even when it is zero.
#
# Repo-agnostic: everything is resolved from the git checkout it is run in, so
# it works from a sibling project too, single-package ones included
# (`../some-project/scripts/new-worktree.sh <branch>`).
#
# At the repository root rather than in api/scripts/, where it lived until it
# bootstrapped four packages: api-deploy.yaml's `paths:` filter includes
# 'api/scripts/**', so every edit to this developer-only script pushed a
# production API release — image build, migration job and rolling restart — for
# a file no image ever contains.
#
# Usage: scripts/new-worktree.sh [--only <pkg>[,<pkg>]] <branch> [base-ref]

set -euo pipefail

usage() {
  echo "Usage: ${0##*/} [--only <pkg>[,<pkg>]] <branch> [base-ref]" >&2
  echo >&2
  echo "Creates ~/.worktrees/<repo>/<branch>, copies the untracked .env files each" >&2
  echo "package needs, and installs each package's dependencies." >&2
  echo >&2
  echo "  --only <pkg>[,<pkg>]  install only these packages (default: all of them)." >&2
  echo "                        The .env files are copied for every package either way." >&2
  exit 1
}

branch=""
base=""
only=""

while [ $# -gt 0 ]; do
  case "$1" in
  -h | --help) usage ;;
  --only)
    only=${2-}
    [ -n "$only" ] || usage
    shift 2
    ;;
  --only=*)
    only=${1#--only=}
    shift
    ;;
  -*)
    echo "error: unknown option: $1" >&2
    usage
    ;;
  *)
    if [ -z "$branch" ]; then
      branch=$1
    elif [ -z "$base" ]; then
      base=$1
    else
      echo "error: unexpected argument: $1" >&2
      usage
    fi
    shift
    ;;
  esac
done

[ -n "$branch" ] || usage

# The main checkout, not wherever this is run from: the git dir of a worktree
# points back at the original, which is the only place node_modules and the
# .env files exist. Deliberately not `..`-counting, which breaks the moment the
# worktree sits at a different depth — or, now, the moment the script is run
# from a package subdirectory rather than the checkout root.
git_common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
main_checkout=$(dirname "$git_common_dir")
repo=$(basename "$main_checkout")
worktree="$HOME/.worktrees/$repo/$branch"

# Named before anything is created. Which repo this acts on comes from the
# directory it runs in, not from where the script itself lives, so invoking one
# project's copy from another project's directory silently branches the wrong
# repo — and every line below this looks identical either way.
echo "==> $repo: $branch in $worktree"

# Every directory holding a tracked package.json, the checkout root included.
# Derived rather than listed: a fifth package, or a sibling project with one,
# needs no edit here, and a hand-maintained list is exactly what went stale when
# cli/ and preview-edge/ were hoisted out of api/.
package_dirs=$(cd "$main_checkout" && git ls-files '*/package.json' | sed 's#/package\.json$##' | sort -u)
if [ -f "$main_checkout/package.json" ]; then
  package_dirs=$(printf '.\n%s' "$package_dirs")
fi
package_dirs=$(printf '%s\n' "$package_dirs" | sed '/^$/d')

if [ -z "$package_dirs" ]; then
  echo "error: no tracked package.json anywhere in $main_checkout" >&2
  exit 1
fi

package_list=$(printf '%s\n' "$package_dirs" | tr '\n' ' ')

# Default: install every package. A worktree that cannot run the checks is worse
# than one that took an extra minute to build, and in a monorepo you routinely
# find out that a two-line api change also touches the generated client in cli/
# or web/ after the worktree exists. The cost is smaller than it looks — pnpm
# hardlinks from one content-addressable store, so a second checkout of an
# already-installed dependency costs inodes rather than downloads, and
# Playwright's browsers live in a shared cache outside node_modules. `--only` is
# there for when you know, and it fails on a name that is not a package rather
# than installing nothing and reporting success.
install_dirs=$package_dirs
if [ -n "$only" ]; then
  install_dirs=""
  for want in $(printf '%s' "$only" | tr ',' ' '); do
    want=${want%/}
    found=""
    while IFS= read -r dir; do
      [ "$dir" = "$want" ] && found=$dir
    done <<EOT
$package_dirs
EOT
    if [ -z "$found" ]; then
      echo "error: --only names '$want', which is not a package in $repo" >&2
      echo "       packages: $package_list" >&2
      exit 1
    fi
    install_dirs=$(printf '%s\n%s' "$install_dirs" "$found")
  done
  install_dirs=$(printf '%s\n' "$install_dirs" | sed '/^$/d' | sort -u)
fi

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

# Before the installs, not after. An install can fail — `strictDepBuilds` rejects any
# dependency whose install scripts nothing has ruled on — and `set -e` then leaves a
# worktree that also has no .env.test, so the suite fails on the missing file rather
# than on the thing that actually went wrong.
#
# Untracked by design (they hold secrets), so the worktree starts without them.
# Examples are tracked already. Copied for every package regardless of --only:
# they cost nothing, and the package you skipped installing is the one whose
# missing .env is hardest to explain later.
env_dirs=$(printf '.\n%s\n' "$package_dirs" | sed '/^$/d' | sort -u)
copied=0
copied_list=""
while IFS= read -r dir; do
  for env_file in "$main_checkout/$dir"/.env*; do
    [ -f "$env_file" ] || continue
    case "${env_file##*/}" in
    *.example | *.sample) continue ;;
    esac
    mkdir -p "$worktree/$dir"
    cp "$env_file" "$worktree/$dir/"
    copied=$((copied + 1))
    case "$dir" in
    .) label=${env_file##*/} ;;
    *) label="$dir/${env_file##*/}" ;;
    esac
    copied_list=$(printf '%s\n  %s' "$copied_list" "$label")
  done
done <<EOT
$env_dirs
EOT

if [ "$copied" -gt 0 ]; then
  echo "==> copied $copied env file(s):$copied_list"
else
  echo "==> warning: no untracked .env files found in: $(printf '%s\n' "$env_dirs" | tr '\n' ' ')" >&2
  echo "    if this checkout needs one, the suite will fail on the missing file" >&2
fi

# A real install per package, not a symlink into the main checkout. pnpm hardlinks
# from one content-addressable store, so this costs inodes rather than downloads —
# and it ends the failure mode the symlink had, where `pnpm install` in a worktree
# rewrote the tree the main checkout was using. Each package installs separately
# because each has its own lockfile; this repo is deliberately not one pnpm
# workspace.
#
# Not --silent: that suppresses the ERR_PNPM_IGNORED_BUILDS output too, so a refused
# install prints nothing at all and the script dies with no clue why.
installed=0
while IFS= read -r dir; do
  [ -f "$worktree/$dir/package.json" ] || continue
  echo "==> installing $dir"
  (cd "$worktree/$dir" && pnpm install)
  installed=$((installed + 1))
done <<EOT
$install_dirs
EOT

# Exit 0 is not proof here. A `pnpm-workspace.yaml` that declares members and
# matches none makes `pnpm install` print "No projects found" and exit 0 having
# written no node_modules at all, which turns every later command into an
# unexplained cannot-find-module. Assert the directory rather than the status.
missing=""
while IFS= read -r dir; do
  [ -f "$worktree/$dir/package.json" ] || continue
  [ -d "$worktree/$dir/node_modules" ] || missing="$missing $dir"
done <<EOT
$install_dirs
EOT

if [ -n "$missing" ]; then
  echo "error: install exited 0 but left no node_modules in:$missing" >&2
  echo "       the worktree cannot run the checks; investigate before using it" >&2
  exit 1
fi

echo "==> installed $installed package(s), each with node_modules"
if [ -n "$only" ]; then
  skipped=""
  while IFS= read -r dir; do
    case "
$install_dirs
" in
    *"
$dir
"*) ;;
    *) skipped="$skipped $dir" ;;
    esac
  done <<EOT
$package_dirs
EOT
  echo "    (--only $only; not installed:${skipped:- none})"
fi

echo
echo "Ready: $worktree"
echo "  cd $worktree"
