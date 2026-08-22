#!/usr/bin/env bash
# A fresh clone to a checkout that can run the tests, in one command.
#
#   scripts/bootstrap.sh
#
# Getting here by hand was thirteen steps spread over five documents, and the
# step people actually lost was api/.env.test: it is untracked, the whole api
# suite is run with `--env-file=.env.test`, node hard-errors when that file is
# missing, and until this it had no tracked example to copy. `.env.example` did,
# which is why the dev half was the half that worked.
#
# Everything here is idempotent and nothing here overwrites: an existing .env is
# reported and left alone, and a second run reinstalls and re-migrates rather
# than doing anything new. The prerequisites it cannot install — a node, a
# Postgres, a Redis — are checked up front and reported together, because the
# alternative is a two-minute install followed by a failure about a socket.
#
# For a branch rather than a fresh clone, `scripts/new-worktree.sh <branch>`
# does the install half against the worktree it creates and copies the real .env
# files across instead of seeding them from the examples.
#
# It does not create the *dev* database. The suite's database is derived and
# created on demand, so a clone can run the tests without one; `critical_path` is for
# running the app, it is named in your own .env, and creating a database outside
# the checkout is a decision to leave with the person making it. The closing
# message has the two commands.

set -euo pipefail

# From this script's own path, never from cwd.
cd "$(dirname "$0")/.."

step() {
  echo "==> $*"
  "$@"
  echo
}

# Every directory holding a tracked package.json. Derived rather than listed, so
# a fifth package needs no edit here. There is deliberately no root one — this is
# four packages with four lockfiles and no pnpm workspace — so the root is not a
# candidate and is not looked for.
package_dirs=$(git ls-files '*/package.json' | sed 's#/package\.json$##' | sort -u)
if [ -z "$package_dirs" ]; then
  echo "error: no tracked package.json anywhere in this checkout" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# The .env files, before the prerequisite checks: the checks below read the ones
# they are about to test against, so seeding has to come first.
# ---------------------------------------------------------------------------

created=0
kept=0
while IFS= read -r dir; do
  for example in "$dir"/.env*.example; do
    [ -f "$example" ] || continue
    target=${example%.example}
    if [ -f "$target" ]; then
      echo "    kept $target"
      kept=$((kept + 1))
    else
      cp "$example" "$target"
      echo "    created $target from ${example##*/}"
      created=$((created + 1))
    fi
  done
done <<EOT
$package_dirs
EOT
echo "==> env files: $created created, $kept already present"
echo

# Everything below reads this file, and so does every api test script.
if [ ! -f api/.env.test ]; then
  echo "error: api/.env.test is missing and api/.env.test.example did not seed it." >&2
  echo "       Restore that example, or write the file by hand; api/README.md has it." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Prerequisites. All of them, then one report: finding out about Redis after
# fixing node and again after fixing Postgres is three runs for one answer.
# ---------------------------------------------------------------------------

problems=""
note() { problems=$(printf '%s\n  - %s' "$problems" "$1"); }

# bash's own network redirection, so this needs no psql and no redis-cli — a
# machine can have the servers without the clients. It proves a listener and
# nothing more; `migrate:test` at the end is what proves the credentials.
tcp_open() {
  (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null
}

# From api/package.json rather than written here, so the floor cannot drift from
# the one the packages declare. All four say the same thing.
required_node=$(sed -n 's/.*"node": ">=\([0-9][0-9]*\)".*/\1/p' api/package.json | head -n 1)
: "${required_node:=22}"

if ! command -v node >/dev/null 2>&1; then
  note "node is not on PATH. Node >= $required_node (nodejs.org, or \`brew install node\`)."
else
  node_major=$(node -v | sed 's/^v//; s/\..*//')
  if [ "$node_major" -lt "$required_node" ]; then
    note "node $(node -v) is older than the >= $required_node every package declares."
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  note "pnpm is not on PATH. \`corepack enable pnpm\`, or \`brew install pnpm\`."
fi

# What the suite will actually dial, read out of the file seeded above rather
# than assumed, so a non-default port is checked instead of quietly skipped.
db_host=$(sed -n 's/^DB_HOSTNAME=//p' api/.env.test | tail -n 1)
db_port=$(sed -n 's/^DB_PORT=//p' api/.env.test | tail -n 1)
: "${db_host:=127.0.0.1}"
: "${db_port:=5432}"
if ! tcp_open "$db_host" "$db_port"; then
  note "no Postgres listening on $db_host:$db_port, which api/.env.test points the suite at.
    \`brew services start postgresql@18\`, or edit DB_HOSTNAME/DB_PORT in that file."
fi

# Set but unreachable is worse than absent here: the two files that drive a real
# Redis skip with a notice when REDIS_TEST_URL is unset, and fail outright when
# it names a server that is not listening. api/.env.test.example ships the line,
# so a machine without Redis needs to be told now rather than 200 seconds into
# the suite.
redis_url=$(sed -n 's/^REDIS_TEST_URL=//p' api/.env.test | tail -n 1)
if [ -n "$redis_url" ]; then
  redis_hostport=${redis_url#*://}
  redis_hostport=${redis_hostport#*@}
  redis_hostport=${redis_hostport%%/*}
  redis_host=${redis_hostport%%:*}
  redis_port=${redis_hostport##*:}
  # No colon in the authority means no port was written; redis defaults to 6379.
  if [ "$redis_port" = "$redis_host" ]; then
    redis_port=6379
  fi
  if ! tcp_open "$redis_host" "$redis_port"; then
    note "REDIS_TEST_URL names $redis_host:$redis_port and nothing is listening there, so
    two test files will fail rather than skip. \`brew services start redis\`, or
    delete the REDIS_TEST_URL line from api/.env.test and they skip instead."
  fi
fi

if [ -n "$problems" ]; then
  echo "error: this machine is missing something bootstrap cannot install:$problems" >&2
  echo >&2
  echo "Fix those and run ${0##*/} again; the .env files above are already in place." >&2
  exit 1
fi
echo "==> prerequisites: node $(node -v), pnpm $(pnpm --version), Postgres on $db_host:$db_port${redis_url:+, Redis on $redis_host:$redis_port}"
echo

# ---------------------------------------------------------------------------
# Installs. One per package, because there are four lockfiles and no workspace.
# ---------------------------------------------------------------------------

while IFS= read -r dir; do
  step pnpm -C "$dir" install
done <<EOT
$package_dirs
EOT

# Exit 0 is not proof. A pnpm-workspace.yaml at the root that matches no project
# makes every install print "No projects found", exit 0 and write no
# node_modules at all, after which every later command is an unexplained
# cannot-find-module. Assert the directory rather than the status.
missing=""
while IFS= read -r dir; do
  [ -d "$dir/node_modules" ] || missing="$missing $dir"
done <<EOT
$package_dirs
EOT
if [ -n "$missing" ]; then
  echo "error: install exited 0 but left no node_modules in:$missing" >&2
  echo "       investigate before using this checkout; it cannot run the checks" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# The database and the browsers.
# ---------------------------------------------------------------------------

# Not strictly required — the suite's globalSetup creates and migrates this
# database itself on first run. It is here because it is the cheapest honest
# proof that the Postgres half works: a role that cannot CREATEDB, or a DB_USER
# that does not exist, fails here in a second with the migrator's own message
# instead of three minutes into a test run.
step pnpm -C api run migrate:test

# web's browser probes exit 0 with a warning when Playwright's browsers are
# absent, so without this a fresh clone reports a green `check:browser` that ran
# nothing. CI installs Chromium for the same reason; web's own script is the
# source of truth for which engines belong on a laptop.
step pnpm -C web run playwright:install

echo "Ready."
echo
echo "  scripts/check-all.sh --fast    # ~1m: prose, types, lint, generated clients"
echo "  scripts/check-all.sh           # ~9m30s: the above plus every suite"
echo
echo "To run the app as well, create and migrate the dev database named in api/.env:"
echo
echo "  createdb critical_path"
echo "  pnpm -C api run migrate"
echo "  pnpm -C api run dev            # then pnpm -C web run dev"
