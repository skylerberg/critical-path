#!/usr/bin/env bash
# Every check CI runs that a laptop can run, in one command. Run it before
# pushing; there was no single command for this, and doing it by hand is four
# `check:all` invocations plus three repo-level checks that belong to no package.
#
#   scripts/check-all.sh          # everything, ~9m30s
#   scripts/check-all.sh --fast   # first tier only, ~1m
#
# What it runs is exactly the four packages' own `check:all`, plus the checks
# `repo-ci.yaml` runs on a bare checkout. Those scripts stay the unit of work
# and the source of truth for what a check is; nothing is reimplemented here.
# api's and web's are expanded into the scripts they compose, and only so that
# the order below can be by cost — `repo-ci.yaml` fails if that expansion ever
# stops covering what those two compose today.
#
# Nothing is passed through to any of them either: `pnpm test -- --shard=1/4`
# silently runs the whole suite, and a wrapper that forwarded arguments would be
# one more place to fall into that.
#
# The order is by measured wall time and deliberately not grouped by package, so
# a typo fails in the first second rather than after the browser probes. The
# tier boundary is not arbitrary: everything above it needs neither a database,
# a browser nor a bundler, which is what holds it to a minute. --fast is for the
# edit loop; a push wants the whole thing.
#
# One step WRITES: `scripts/generate-clients.sh` regenerates the four committed
# API clients in place. If they were current nothing changes, and if they were
# not, your tree now holds the fix that `codegen-ci.yaml` would otherwise have
# failed you for — on a pull request that need never have touched web/ or cli/.
#
# What a green run here does NOT promise, all of it needing a tool this
# repository does not ask you to install:
#
#   - api-ci's `images` job builds api/Dockerfile and preview-edge/Dockerfile
#     (Docker).
#   - k8s-ci validates api/k8s against the schemas for the version cow-cluster
#     runs (kubeconform, pinned by checksum).
#   - infra-ci runs terraform fmt, init and validate over infra/ (terraform,
#     pinned to one version, and `init` downloads providers into the tree).
#   - repo-ci lints the shell and the workflow files, and checks that every
#     pull_request workflow is named in ci-gate.yaml (shellcheck and actionlint,
#     both pinned by checksum).
#   - the deploy and preview workflows need gcloud and a service account.
#
# One further gap, and it is the one to know about: `check:browser` below exits
# 0 with a warning when Playwright's browsers are missing, which is a local-only
# concession — CI sets CI, and web/scripts/lib/browser.mjs throws there instead.
# `scripts/bootstrap.sh` fetches them, and a run that prints "skipped" is a run
# whose browser half proved nothing.

set -euo pipefail

usage() {
  echo "Usage: ${0##*/} [--fast]" >&2
  echo >&2
  echo "Runs every package's checks, cheapest first." >&2
  echo "  --fast  stop before the suites, the browser probes and the api tests." >&2
  exit 1
}

fast=0
while [ $# -gt 0 ]; do
  case "$1" in
  -h | --help) usage ;;
  --fast)
    fast=1
    shift
    ;;
  *)
    echo "error: unknown argument: $1" >&2
    usage
    ;;
  esac
done

# From this script's own path, never from cwd — it is run from package
# directories and from worktrees, and every step below is relative to the
# repository root.
cd "$(dirname "$0")/.."

step() {
  echo "==> $*"
  "$@"
  echo
}

step node scripts/check-comments.mjs --selftest
step node scripts/check-comments.mjs
step pnpm -C preview-edge run check:all
step pnpm -C api run knip
step pnpm -C api run lint
step sh .githooks/tests/format-touched.test.sh
step pnpm -C api run format:check
step pnpm -C api run type-check

step scripts/generate-clients.sh
# Scoped to the two directories holding the four tracked clients rather than a
# bare `git diff`, so an install or a `prepare` script that touched something
# else cannot fail this. The two spec dumps the script also wrote are gitignored.
if ! git diff --exit-code -- web/src/api cli/src/api; then
  echo "error: the committed API clients were stale. They are regenerated in your" >&2
  echo "       tree now — commit them with the change that caused the diff above." >&2
  exit 1
fi
echo

step pnpm -C cli run check:all
step pnpm -C web run check:static

if [ "$fast" -eq 1 ]; then
  echo "--fast: stopped before web's suite, guards and browser probes, and the api suite."
  echo "Run ${0##*/} with no arguments before pushing."
  exit 0
fi

step pnpm -C web run check:suite
step pnpm -C web run check:test-guards
step pnpm -C web run check:browser
step pnpm -C api run test

echo "Done. Everything CI can run on a laptop passed; see the header for what it cannot."
