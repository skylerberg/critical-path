---
name: critical-path
description: Work with Critical Path, Skyler's kanban + dependency tracker, from any repo via the `cpath` CLI — find the next card, claim it, tick checklist items, comment progress, mark it done, file newly discovered work, and record blockers. Use whenever Critical Path, cpath, "the board", a card/task/ticket, "what should I work on", "add a task", or "mark it done" comes up, in any project.
---

# Critical Path

Critical Path is Skyler's project-management app: kanban boards whose cards carry
real dependency edges, so the board can answer what is *ready* — unfinished, with
no unfinished blockers — rather than only what exists. `cpath` is its CLI and is
the agent-facing surface; the web app is where Skyler works, so anything you
write lands in front of a person.

`cpath` is installed globally and talks to the production instance by default.
Its source is `~/Code/critical-path/cli`, the package this skill lives in.

## Before anything else

```sh
cpath whoami          # exit 3 => no token, or the session expired
```

Exit 3 means **stop and say so** — logging in needs a password you do not have.
`cpath login --email …` is Skyler's to run.

Three habits keep every other call boring:

- Pass `--project "<name>"` explicitly on everything that accepts it.
- Add `--no-input` to writes, so a command can never block on a prompt.
- Add `--json` when you are parsing; plain text when you are reading.

## Which board does this repo belong to?

Resolve in this order and stop at the first answer:

1. **An explicit signal in the repo** — a Critical Path line in its `CLAUDE.md`,
   or `CRITICAL_PATH_PROJECT`.
2. **Discovery** — `cpath project list`, then match the repo against the board
   names. They are not the same strings: one product's several repos share one
   board. Take a match only if it is unmistakable.
3. **Ask Skyler.** Then offer to record the answer as one line in that repo's
   `CLAUDE.md`, so the next agent stops at step 1.

**Never rely on the configured `default-project`.** It is a single global value —
whatever board was set once — so in any other repo it silently aims every
unflagged command at the wrong board.

Personal boards (House, Shopping, Social Life, …) are not work boards. Don't
write to a board nobody pointed you at.

## The working card

You have standing permission to drive **the one card you are working on** end to
end — claim it, tick its checklist, comment on it, finish it — without asking
each time. Every other card on the board is read-only unless Skyler asks.

Columns differ per board (`In Progress` here, `Doing` there, and one board's done
column is named `Done (not necessarily submitted to app store)`), so look before
you move:

```sh
cpath column list --project "Critical Path"
```

1. **Pick up** — the card Skyler named, or find one:

   ```sh
   cpath ready --project "Critical Path"   # unfinished, nothing blocking it
   cpath mine                              # yours everywhere: Blocking others / Ready / Blocked
   cpath board "Critical Path"             # columns with [ready] / [blocked] markers
   ```

2. **Claim it** — move it to the in-progress column of that board:

   ```sh
   cpath task move 44b0155a --project "Critical Path" --column "In Progress" --top
   ```

3. **Tick items** as you actually finish them:

   ```sh
   cpath task checklist check 44b0155a "regression test" --project "Critical Path"
   ```

4. **Comment** when there is something a human would want later — a decision, a
   surprise, the PR link. Not a play-by-play.

   ```sh
   cpath comment add 44b0155a "Fixed by rejecting the key at the write site; see PR #181" --project "Critical Path"
   ```

5. **Finish** — moves the card to the bottom of that board's last done column:

   ```sh
   cpath task done 44b0155a --project "Critical Path"
   ```

`cpath task url 44b0155a --project "Critical Path"` prints the bare web URL, so
it pipes straight into a commit message or PR body. Put it there.

Mark a card done when the thing it asks for is *true*, not when the code
compiles. If you finished only part of it, comment what is left and leave it
where it is.

## Naming a card

A reference resolves as: uuid → the 22-character short alias from a web URL
(case-sensitive) → id prefix of 4+ chars → exact title, case-insensitive →
unique title substring. Ambiguity is exit 2 with the candidates printed — re-run
with an id from that list rather than guessing a longer substring.

The 8-character id in every listing is the handle to use: unique, and immune to
a retitle. Titles change; ids don't.

To find a card by what it says rather than what it is called, search:

```sh
cpath task search "invite token cascade" --project "Critical Path"
```

It matches titles and descriptions word by word, each word as a prefix, so
a query of "secure_token" finds cards that mention "secure" and "token" rather
than that literal string. Without `--project` it covers every board, since the default
project never narrows it. A hit's id then resolves only with that hit's
`--project`.

Archived cards are reachable by `task show`, `duplicate`, `archive`, `restore`,
`delete` and `url`, which fall back to the archive on a miss. Board mutations
(`move`, `done`, `update`, `label`, `assign`, `block`) deliberately do not, and
answer `No task matching` for an archived card even by id.

## Filing new work

Found something out of scope? File it rather than growing the current card.
Search first (`cpath task search "<key words>" --project "…"`), so something
already on the board gets a comment rather than a twin:

```sh
cpath task create "Type-check the test directories" --project "Critical Path" \
  --column Backlog --description "Found while fixing 44b0155a: tests/ is outside the build tsconfig." --no-input
```

Titles are imperative and name one deliverable; the context goes in the
description, which is Markdown in and out (`--description-file <path>` for
anything long, `-` as the title to create one card per stdin line).

Real dependencies go in as **edges, not prose** — that is the entire point of the
app, and it is what makes `ready` and `mine` mean anything:

```sh
cpath task block "Ship it" --by 44b0155a --project "Critical Path"
cpath task blockers "Ship it" --project "Critical Path" --tree
```

An edge may span two boards (`--by-project`).

**@mentions are a one-way door.** `task show` and `comment list` print a mention
as plain `@label`; writing that text back with `task update --description` or
`comment edit` stores plain text and drops the link to that person for everyone.
If a description holds a mention, edit it in the web app, or use
`--description-json`.

Note that `--json` returns a description as the API's Tiptap document; the plain
text output is the one that reads as Markdown.

## Don't, unless asked

`task delete`, `project delete`, `column delete`, `account delete`,
`column archive-tasks`, `column move-tasks`, `project set-members` — each is
irreversible or board-wide. Archiving a card you created this session is fine;
archiving anything else is not.

## Exit codes

`0` ok · `1` network/server · `2` usage or ambiguous reference · `3` auth ·
`4` not found · `5` conflict · `6` invalid input.

**429 also exits 3**, so a rate limit reads as an auth failure by code alone —
check the message before telling anyone their session expired.

## More

`cpath <command> -h` is authoritative for flags; `commands.md` beside this file
is the whole surface at a glance. `cpath watch --project "…"` streams realtime
events as NDJSON on stdout — a live tap with no replay, so resync with
`cpath board` after any gap.
