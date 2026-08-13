# Benchmarks

An on-demand load harness. It seeds a large instance into a database of its own,
drives the real Hono app in-process, and reports where the time goes.

Nothing here runs in CI or in `npm test`. It is a tool you reach for when you
change a read path, add an index, or want to know what a bigger customer would
feel.

```sh
npm run bench                     # fast tier, ~37k cards, seeds in ~4s
npm run bench:heavy               # heavy tier, ~400k cards, seeds in a few minutes
npm run bench -- --explain        # add the query plan for each scenario's slowest statement
npm run bench -- --only=projects  # just the scenarios whose name or group matches
npm run bench -- --reseed         # rebuild the dataset even if it looks current
```

## What it measures

Each scenario runs a few warmup passes, then one instrumented pass that counts
every statement the request issued, then a run of timed passes. The table
reports the HTTP status, p50/p95/max wall clock, the statement count, the time
spent inside Postgres, and the response size.

The status column is there because a scenario that quietly started returning 404
is otherwise indistinguishable from one that got fast. Any non-2xx is flagged.

Wall clock on a laptop is not a production number. What the harness is actually
for is the shape of the curve: the statement count says whether a request is
O(1) or O(rows), the database share says whether a regression is in SQL or in
serialization, and running both tiers says whether a path grows with the
instance.

## The tiers

`fast` and `heavy` each get their own database (`..._bench_fast_<hash>`,
`..._bench_heavy_<hash>`), so switching between them reconnects rather than
reseeds. Both are stamped with this checkout, so `npm run test:db:prune`
reclaims them once the worktree is gone.

The dataset is rebuilt automatically when the scale, `bench/seed.ts`, or the
migration set changes — the fingerprint in `bench_seed_marker` covers all three,
so you cannot benchmark a dataset against a schema that no longer produced it.

Some things do not scale with the tier, because the product bounds them:
`MAX_TASKS_PER_PROJECT` is the largest board that can exist, so both tiers seed
three boards sitting exactly on it. What the tiers scale is everything with no
ceiling — projects per user, cards assigned to one person, comments on one card,
dependency edges, accounts.

## The seeded instance

Ids are derived, not queried: `benchUuid('task', 5)` is the fifth card, and
`benchIds(scale)` hands scenarios every landmark below without touching the
database.

| Landmark            | What it is                                                        |
| ------------------- | ----------------------------------------------------------------- |
| hub user            | Belongs to a few hundred projects. The landing-screen worst case.  |
| loaded user         | Thousands of assigned cards across every project. `my-tasks`.      |
| ordinary user       | A handful of projects. The control.                                |
| outsider            | Access to nothing, for the refusal paths.                          |
| big project         | A capped board over six columns.                                   |
| single-column board | The same card count in one column: the worst ordering scope.       |
| crowded project     | Hundreds of members.                                               |
| public project      | Capped, public, one comment and two checklist rows per card.       |
| chain project       | One dependency chain thousands of edges deep.                      |
| write project       | Near the cap with room left, so mutations have somewhere to land.  |
| hot card            | The instance's comments, checklist rows, attachments and blockers. |

Every seeded dependency edge points from a higher card ordinal to a lower one,
which makes the graph acyclic by construction. A seeded cycle is unreachable
through the API, so benchmarking the cycle guard against one would measure a
state production cannot be in.

Mutating scenarios create rows with ids they record and delete afterwards, so
repeated runs do not drift.

## Adding a scenario

Add an entry to `bench/scenarios.ts`. `probe` is the sentence printed with the
findings — say what the scenario is testing, not what it calls. Set
`mutating: true` for anything that writes, and give it a `teardown` if it
creates rows.

Prefer a pair: the pathological case and an ordinary control beside it. A number
with nothing to compare it against does not say whether the path scales.
