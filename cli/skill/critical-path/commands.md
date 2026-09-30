# `cpath` command reference

Every command takes `--json`, `--no-input`, `--no-color` and `--api-url <url>`.
Every project-scoped command takes `--project <project>`. `cpath <cmd> -h` is
authoritative; this file is the map.

## Reading the board

| Command | What it gives you |
| --- | --- |
| `cpath project list` | boards with open/done counts (`--archived` for archived ones) |
| `cpath project show <project>` | per-column task counts and the label set |
| `cpath board [project]` | the whole board, cards marked `[ready]` / `[blocked]` |
| `cpath ready --project <p>` | unfinished cards with no unfinished blockers |
| `cpath mine` | your cards on every board, grouped Blocking others / Ready / Blocked, plus Waiting on you |
| `cpath column list --project <p>` | columns in order, with which one is the done column |
| `cpath task list --project <p>` | filters: `--column --label --assignee --search --ready --blocked --done --not-done` |
| `cpath task search <query>` | cards whose title or description matches, best first, max 50, on **every** board; `--project <p>` for one |
| `cpath task show <task>` | full card: state, column, dates, description, checklist, labels |
| `cpath task blockers <task>` | what blocks it and what it blocks; `--tree` for the transitive view |
| `cpath task archived --project <p>` | the archive (`--search <text>`) |
| `cpath comment list <task>` | comments, oldest first |
| `cpath attachment list <task>` | files, images and links on a card |
| `cpath task url <task>` | the card's web URL, bare on stdout |

## Moving work along

```sh
cpath task create <title>            # --column --description[-file|-json] --due --label --assignee
                                     # --top --bottom --before <task> --after <task>
                                     # title of `-` reads one title per line from stdin (max 100)
cpath task update <task>             # --title --description[-file|-json] --clear-description --due --clear-due
cpath task move <task>               # --column --top --bottom --before --after
cpath task done <task>               # bottom of the board's last done column
cpath task archive|restore <task>    # archive leaves the board, stays restorable
cpath task duplicate <task>          # copy placed directly below the original
```

Due dates are `YYYY-MM-DD` only — no shorthand parsing, and a due date is one
calendar day.

## Checklists

`cpath task checklist list|add|check|uncheck|rename|move|remove|promote`

An `<item>` resolves against that card's own items through the same tiers as any
other reference. `add <task> -` reads one item per line from stdin and honors
Markdown bullets and `[ ]` / `[x]` tickboxes, so a checklist pasted out of a
design doc arrives with its ticked state intact. `promote` turns an item into its
own card directly below the parent.

## People and labels

```sh
cpath task assign|unassign <task> <users...>   # user id, name, or email
cpath task assignees set <task> [users...]     # replace the set (no users clears it)
cpath task label add|remove|set <task> <labels...>
cpath label list|create|update|delete
cpath user list --project <p>                  # who is on a board
cpath user search <query>                      # people you don't already share a board with
```

## Comments and attachments

```sh
cpath comment add <task> "<markdown>"    # or --body-file <path> (- for stdin)
cpath comment edit|delete <commentId>    # your own only
cpath attachment upload <task> <file>    # an image is stored as one automatically
cpath attachment link <task> <url>       # --title, else the unfurled page title
cpath attachment download|rename|delete <attachmentId>
```

## Boards, columns, membership

```sh
cpath project create <name>              # --from <project> deep-copies an existing board
cpath project update|archive|unarchive|leave|transfer <project>
cpath project members <project>          # ROLE reads owner / editor / viewer
cpath project invite <project> --email … --role editor|viewer
cpath project invitations|resend-invite|revoke-invite <project>
cpath project set-role <project> <user> --role editor|viewer
cpath column create|update|move|duplicate <column>
cpath column move-tasks <column> --to <column>
cpath column archive-tasks <column>
```

## Account, tokens, config

```sh
cpath whoami | login | logout | signup
cpath account update|change-password|resend-verification
cpath token list|create|revoke          # personal access tokens, secret shown once
cpath config get|set|unset|path         # keys: default-project, api-url, web-url
cpath completion -s zsh|bash|fish
```

The session token lives in the macOS Keychain (service `critical-path-cli`),
keyed per server URL; on other platforms it is a chmod-600 file.

## Environment

| Variable | Effect |
| --- | --- |
| `CRITICAL_PATH_API_URL` | server to talk to (default `https://criticalpath.skylerberg.com`; `http://localhost:3001` for local dev) |
| `CRITICAL_PATH_TOKEN` | overrides the stored token — a session token or a `cpat_…` personal access token |
| `CRITICAL_PATH_PROJECT` | default project for commands that take `--project`, except `watch`, `task search` and `user list` |
| `CRITICAL_PATH_WEB_URL` | base that `task url` builds links from |

## `cpath watch`

Streams delivered realtime events to stdout as newline-delimited JSON, one
compact `{ type, project_id, data }` object per line; everything else goes to
stderr. `--json` and `--no-color` have no effect — the output is always NDJSON.

```sh
cpath watch --project "Critical Path" | jq 'select(.type=="task_created")'
```

Without `--project` it follows every accessible board, including ones created
while it runs, and does **not** fall back to `CRITICAL_PATH_PROJECT` or the
configured default, just as `task search` and `user list` don't. Unscoped, `account_updated`
puts an email address on stdout; it is the only event `watch` prints that
carries one.

It reconnects on its own with backoff and resubscribes — reconnects are normal,
not exceptional, since production caps a WebSocket at one hour. **There is no
replay:** events published while disconnected are gone, so treat the
"Connection restored" line on stderr as the cue to resync with `cpath board`.
Close code 4429 (too many sockets for the account) stops the watch instead of
retrying, exiting 3 with a message that is not the login hint.
