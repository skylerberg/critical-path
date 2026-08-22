# Critical Path — cli

`cpath`, a full command-line client for **Critical Path** — boards, cards,
dependencies and the realtime stream, from a terminal or a script.

This is the `cli/` package of the Critical Path monorepo. It is a client of the
`api/` package and of nothing else; `web/` is the other client. Each package
installs on its own; there is no pnpm workspace. `CLAUDE.md` beside this file is
the manual for *changing* the CLI — everything below is for using it.

## Install

The package keeps its own lockfile and `node_modules` on purpose: nothing about
the deployed API image or the deploy workflow changes when the CLI changes. From
the repository root:

```sh
pnpm -C cli install --frozen-lockfile   # once; also required before the CLI tests run
pnpm add --global ./cli                 # installs the global `cpath` command
```

## Authenticating

The password is prompted (or piped via `--password-stdin`) and never stored; the
30-day session token goes into the macOS Keychain (`security` service
`critical-path-cli`), or a chmod-600 file on other platforms:

```sh
cpath login --email you@example.com
cpath whoami
```

`cpath account delete` destroys the account for good. It re-asks for the
password and confirms before sending; `--force` skips the confirmation and is
mandatory alongside `--password-stdin`, which drains stdin and so leaves
nothing for a prompt to read. It exits 5, naming the boards, while any project
you created still has other members — `cpath project transfer` hands one over.

## Everyday usage

```sh
cpath project list
cpath board "My Project"                # columns with [ready]/[blocked] markers
cpath ready --project "My Project"      # unblocked, unfinished tasks
cpath mine                              # your tasks everywhere, ordered by who you block
cpath task create "Fix the bug" --project "My Project" --description "See **notes**"
cpath task create - --project "My Project" < titles.txt   # one card per line, max 100
cpath task update "Fix the bug" --project "My Project" --due 2026-08-03   # --clear-due removes it
cpath task move "Fix the bug" --project "My Project" --column "In Progress" --top
cpath task done "Fix the bug" --project "My Project"
cpath task block "Ship it" --by "Fix the bug" --project "My Project"
cpath task block "Ship it" --by "Sign off" --by-project "Design" --project "My Project"  # across boards
cpath task unblock "Ship it" --by 0f0e2d1c-...  # a bare id needs no read access to the far side
cpath task blockers "Ship it" --project "My Project"   # both directions, both boards
cpath task duplicate "Fix the bug" --project "My Project"
cpath task archive "Fix the bug" --project "My Project"
cpath column duplicate "In Progress" --project "My Project"
cpath column move-tasks "Done" --to "Backlog" --project "My Project"
cpath column archive-tasks "Done" --project "My Project"
cpath task archived --project "My Project" --search bug
cpath task restore "Fix the bug" --project "My Project"
cpath task delete "Fix the bug" --project "My Project"  # archived cards only
cpath task checklist add "Fix the bug" "Write the regression test" --project "My Project"
cpath task checklist add "Fix the bug" - --project "My Project" < steps.md  # bullets and [x] honored
cpath task checklist check "Fix the bug" "regression" --project "My Project"
cpath task checklist promote "Fix the bug" "regression" --project "My Project"
cpath comment add "Fix the bug" "Reproduced on **staging**" --project "My Project"
cpath project invite "My Project" --email them@example.com --role viewer  # editor by default
cpath project invitations "My Project"  # pending invites: id, email, role, expiry
cpath project resend-invite "My Project" --id 3f9a1c2b   # id as listed, a prefix, or the address
cpath project set-role "My Project" them@example.com --role editor   # id, name, or address
cpath project members "My Project"      # ROLE column reads owner / editor / viewer
cpath task url "Fix the bug" --project "My Project"   # shareable web link
cpath config set default-project "My Project"   # makes --project optional
cpath config set web-url https://criticalpath.example.com   # base for task url
cpath watch --project "My Project" | jq 'select(.type=="task_created")'
```

## Naming a card, a board or a person

Entity references accept a UUID, a unique id prefix (>= 4 chars), an exact
name/title (case-insensitive), or a unique substring; ambiguity is an error
listing the candidates. A user reference additionally accepts an email address,
which is tried first and matched by the server, since no user record the CLI
receives carries one; an address naming nobody visible falls through to the
name tiers rather than failing outright. Project and task references
additionally accept the
22-character short alias the web app puts in its URLs; column, label,
invitation and user references do not. The alias is base64url of the id's 16
raw bytes and is **case sensitive** — one flipped letter is a different
reference, and a non-canonical spelling is rejected rather than silently
resolving to the same card. A task alias names the card outright, so it needs
no `--project`; what it does not do is let a board mutation reach an archived
card. Task references resolve against the board, which has no archived cards in
it, so `task show`, `task duplicate`, `task archive`, `task restore`, `task delete`
and `task url` fall back to the archive on a miss; every board-shaped mutation
(`move`, `done`, `update`, `label`, `assign`, `block`) deliberately does not,
and answers `No task matching` for an archived card — by alias and id just as
by title. Task descriptions are Markdown in and out, converted to the API's
restricted Tiptap JSON (`--description-json` is the raw escape hatch). A due
date is one calendar day and `--due` accepts `YYYY-MM-DD` only — there is no
shorthand parsing.

Markdown is a one-way door for mentions: `task show` and `comment list` print
one as `@label`, and writing that text back with `task update --description` or
`comment edit` stores plain text, dropping the link to the person for everyone.
`--description-json` is the lossless path; comment bodies have no equivalent,
so edit one from the web app if it contains a mention.

## Checklists

`cpath task checklist` has `list`, `add`, `check`, `uncheck`, `rename`, `move`,
`remove` and `promote`. An `<item>` reference resolves through the same four
tiers as every other reference, against that card's own items — id, exact text,
id prefix, unique text substring. `add` and `move` take `--top`, `--bottom`,
`--before` and `--after` like the task commands, defaulting to the bottom.
`add <task> -` reads one item per line from stdin and consumes Markdown list
markers and `[ ]` / `[x]` tickboxes as syntax, so a checklist pasted out of a
design doc arrives with its ticked state intact — each line is its own request,
so a failure part-way leaves the items before it in place. `promote` places the
new card directly below its parent and prints the card, not the item.

## Links back to the web app

`cpath task url <task>` prints the card's canonical web URL — the bare URL on
stdout so it pipes into `git commit -m`, or `{ "url": ... }` under `--json`. The
base comes from `CRITICAL_PATH_WEB_URL`, then the configured `web-url`, then the
public instance. Wherever it comes from, it has to be an absolute http(s) URL
with no query, fragment or credentials — a path is appended to it, so anything
else yields a broken link, and credentials would ride along in every link
shared from it. Only the origin and path are kept.

## Output and exit codes

Every command takes `--json` for machine-readable output and `--no-input` to
fail instead of prompting. Exit codes: 0 ok, 1 network/server error, 2
usage/ambiguous reference, 3 auth, 4 not found, 5 conflict, 6 invalid input.

## Watching realtime events

`cpath watch` opens the API's `/ws` connection and prints every delivered event
to stdout as newline-delimited JSON — one compact object per line, exactly the
frame the server sent, in the `{ type, project_id, data }` envelope the
Realtime section of `api/README.md` catalogs. Everything else (the startup
summary, connection notices, errors) goes to stderr, so `cpath watch | jq …` is
the intended shape. `--json` and `--no-color` have no effect: the output is
always NDJSON.

`--project` narrows the stream to one project. Unlike every other command it
does **not** fall back to `CRITICAL_PATH_PROJECT` or the configured
`default-project` — without the flag, `watch` follows every accessible
project, including ones created while it runs, and each line's `project_id`
disambiguates. Scoping to a project also drops the account-scoped events —
`user_updated` and `account_updated` — which carry `project_id: null` and belong
to no project. Unscoped, note that `account_updated` puts your own email address
on stdout; it is the only event `watch` prints that contains one.

The connection reconnects on its own with exponential backoff (1s doubling to
30s) and resubscribes each time, re-listing projects first when it is
following all of them. **Reconnects are normal, not exceptional**:
production's load balancer caps a WebSocket at one hour, so a day-long
`watch` reconnects roughly two dozen times.

**There is no replay.** The server keeps no event log, so events published
while disconnected are lost — a predictable, recurring gap, not a rare
failure. `watch` is a live tap, not an event ledger; treat the "Connection
restored" line on stderr as the cue to resync with `cpath board`.

A close code of 4401 is confirmed with one HTTP request before the process
gives up, because the server also sends it for transient auth-protocol
closes. A genuinely revoked or expired session exits 3 with the usual login
hint.

A close code of 4429 stops the watch instead. The account was over the API's
per-account socket ceiling — the Realtime section of `api/README.md` states the
number — and this connection was the oldest, so the credential is still good;
reconnecting would only take the slot back off whichever client the server
handed it to, which reconnects and takes it back. A watcher is a
process someone started, so it says so and exits rather than idling. Close
another client and start it again. It exits 3, the same code an expired
session gives, but without the login hint — the message is what tells the two
apart. Any other close code reconnects.

## Shell completion

```sh
# zsh — into a directory on $fpath, or eval it in ~/.zshrc *after* compinit
cpath completion -s zsh > "${fpath[1]}/_cpath"        # or: eval "$(cpath completion -s zsh)"

# bash
eval "$(cpath completion -s bash)"                    # in ~/.bashrc

# fish
cpath completion -s fish > ~/.config/fish/completions/cpath.fish
```

TAB completes subcommands and flags, and — where a reference is expected —
project, column, label, task and member names, taken from the
project named on the command line or, failing that, from
`CRITICAL_PATH_PROJECT` / the configured `default-project`. Those lookups are
cached for ~30 seconds under the config directory and fail silently: an
unreachable server or an expired session just means no suggestions, never an
error in the middle of your prompt.

The bash and zsh scripts are verified against bash 3.2 and zsh 5.9. **The fish
script is untested** — it was written from the documented behavior of
`commandline` and has never been run against a real fish.

## Which server it talks to

The CLI talks to the production instance
(`https://criticalpath.skylerberg.com`) by default. `CRITICAL_PATH_API_URL`
(or `--api-url`, or `cpath config set api-url`) selects another server — e.g.
`cpath config set api-url http://localhost:3001` for local development.
Tokens are stored per server URL. `CRITICAL_PATH_TOKEN` overrides the stored
token; `CRITICAL_PATH_PROJECT` sets the default project;
`CRITICAL_PATH_WEB_URL` (or `cpath config set web-url`) sets the base that
`cpath task url` builds links from, which is a separate setting because the web
app and the API need not share an origin.

## Working on the CLI

```sh
pnpm -C cli run check:all  # type-check, lint, format:check
pnpm -C api test           # the CLI's own tests run in api's vitest, not here
```

`CLAUDE.md` in this directory explains both — why the tests live in the api
package's suite, how the committed client under `src/api/` is regenerated, and
which of this package's config files exist only because a config search that
walks up out of `cli/` finds nothing.
