---
name: cli-tasks
description: Read and write tasks on the Critical Path production board using the cpath CLI (https://criticalpath.skylerberg.com). Use when an agent needs to look up, create, update, move, block, or comment on tasks — e.g. tracking work in the Critical Path project itself. Covers non-interactive auth, --json/--no-input, entity resolution, and exit codes.
---

# Read and write tasks with `cpath`

`cpath` (built from `cli/`) is a full client for Critical Path. **It defaults
to production** (`https://criticalpath.skylerberg.com`), not localhost — every
write lands on the live board, so confirm the target project and task before
mutating.

## Authenticate (once)

```sh
cpath login --email <you>@example.com --password-stdin <<< "$PASSWORD"   # stores token in macOS Keychain
cpath whoami                                                            # confirm
```

After login, every later `cpath` call reads the token from the Keychain — no
flags needed. For headless use where there is no Keychain, export
`CRITICAL_PATH_TOKEN=cpat_…` (a personal access token from the web Account
page or `POST /api/auth/tokens`); it shadows the stored token. Tokens carry the
full account permission set and are individually revocable.

## Make a project the default

```sh
cpath config set default-project "Critical Path"
```

Then `--project` is optional on every command. Confirm with `cpath config get`.

## Always pass these for agent use

- `--json` — machine-readable output.
- `--no-input` — fail instead of hanging on a prompt.

## Entity references

A `<task>`/`<project>`/`<column>`/`<label>`/`<user>` ref accepts: a UUID, an id
prefix (≥ 4 chars), an exact name/title (case-insensitive), or a unique
substring. Task and project refs also accept the 22-character short alias out
of a web URL (`/t/<alias>/…`, `/p/<alias>/…`); it is **case sensitive**, and a
task alias names the card outright so it needs no `--project`. Column, label,
invitation and user refs take no alias. Ambiguity is an error that **lists the
candidates** — read it and narrow the ref. Task refs resolve against the live
board (no archived cards); the commands that opt into the archive (`show`,
`duplicate`, `archive`, `restore`, `delete`, `url`) find an archived card by
any ref form, board mutations (`move`, `done`, `update`, `label`, `assign`,
`block`) do not.

## Read

```sh
cpath board                          # full board for the default project
cpath ready --project "Critical Path"   # unblocked, unfinished tasks
cpath mine                           # your tasks everywhere, by who you block
cpath task show "<title>"            # detail incl. comments and activity
cpath task blockers "<title>"        # what blocks it and what it blocks
```

## Write

```sh
cpath task create "Fix the login bug" --due 2026-08-03 \
  --description "Repro on **staging**" --label backend --assignee me@example.com
cpath task update "<title>" --due 2026-08-10          # --clear-due removes it
cpath task move "<title>" --column "In Progress" --top
cpath task done "<title>"
cpath task block "Ship it" --by "Fix the login bug"   # "Fix the login bug" blocks "Ship it"
cpath task duplicate "<title>"
cpath task archive "<title>" | cpath task restore "<title>"
cpath comment add "<title>" "Reproduced on **staging**"
```

`task create <title>` with title `-` reads one title per line from stdin (max
100). Descriptions are **Markdown in and out**; a `@mention` round-trips as
plain text `@label`, so use `--description-json <path>` (Tiptap JSON) to keep a
mention lossless. `--due` accepts `YYYY-MM-DD` only.

## Exit codes (for scripting)

`0` ok · `1` network/server · `2` usage/ambiguous ref · `3` auth · `4` not
found · `5` conflict · `6` invalid input. On `3`, re-`login`. On `2`, the
stderr lists candidates.

## A safe read-then-write loop

```sh
cpath --no-input task show "Fix the login bug" --json \
  | jq -r '.id, .column.name, .due_date'   # inspect before acting
cpath --no-input task done "Fix the login bug"
```
