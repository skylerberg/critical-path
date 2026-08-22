#!/usr/bin/env bash
# Regenerate every committed API client from the api sources in this working
# tree. One command, run it from anywhere.
#
# The four files it rewrites — web/src/api/{api,realtime}.generated.ts and the
# CLI's two of the same names — are **committed**, and
# .github/workflows/codegen-ci.yaml re-runs this script and fails the build when
# what it produces differs from what was pushed. So a schema or realtime-payload
# change is not finished until this has run and its output is in the commit.
#
# It only sequences the six package scripts; those stay the unit of work and the
# source of truth for how a client is produced. Nothing is reimplemented here.
#
# The two dumps run first even though each generator re-dumps for itself. That
# re-dump is deliberately best-effort and silent when it fails, because it has to
# work in a checkout with no api node_modules — which means a genuinely broken
# dump would otherwise surface as four clients quietly generated from an old
# file. Running the dumps up front, under `set -e`, turns that into a failure at
# the step that caused it.
#
# Needs no .env, no database and no running server: both dumps are pure functions
# of api/src.

set -euo pipefail

# From this script's own path, never from cwd — it is run from package
# directories, from worktrees and from CI, and every step below is relative to
# the repository root.
cd "$(dirname "$0")/.."

step() {
  echo "==> pnpm -C $1 run $2"
  pnpm -C "$1" run "$2"
  echo
}

step api openapi:dump
step api realtime:dump
step web generate:api
step web generate:realtime
step cli generate:api
step cli generate:realtime

echo "Done. Commit any change under web/src/api and cli/src/api with the change that caused it."
