---
name: cli-tasks
description: Read and update the Critical Path board with the cpath CLI while working in the web package. Covers only what differs from using the app itself; the command reference lives in cli/.pi/skills/cli-tasks/SKILL.md.
---

# Track work with `cpath`

Nothing here builds `cpath`. It is an agent's way into the same board this app
renders, and the difference that matters is which server answers: the CLI talks
to the deployed API at `https://criticalpath.skylerberg.com`, while the dev
server proxies `/api` to whatever is on port 3001. A card the CLI shows is
therefore live data, and a card it writes is a live write — never a fixture, and
never the state a browser check just set up.

Every agent call wants `--json`, so the output parses, and `--no-input`, so a
prompt fails the command instead of hanging it.

Read `cli/.pi/skills/cli-tasks/SKILL.md` for the command surface itself.
