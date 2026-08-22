---
name: cli-tasks
description: Track this repository's own work on the Critical Path board with the cpath CLI — find, claim, update, comment on and file tasks. Covers only what is specific to working from the api package; cli/.pi/skills/cli-tasks/SKILL.md carries the command reference.
---

# Track work with `cpath`

`cpath` is built from `cli/`, the package this one's `vitest.config.ts` and
`tsconfig.json` already reach into, and its entry point registers tsx and
imports `cli/src` directly. So it is not an outside tool and there is no build
step between the two: an edit there changes the binary in your hand, and
`pnpm -C ../cli run check` is what says whether it still compiles.

**It writes to production by default** (`https://criticalpath.skylerberg.com`),
never the server `pnpm run dev` starts here and never the test database the
suite builds. Confirm the project and the card before any mutation.

Pass `--json` and `--no-input` on every call, exactly as for any other
non-interactive invocation.

`cli/.pi/skills/cli-tasks/SKILL.md` has the rest — signing in, how a task or
project reference resolves, the read and write commands, and the exit codes a
script branches on.
