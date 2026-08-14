# Scaling

What the API does as an instance grows, measured rather than reasoned about.
The harness is `bench/` — see `bench/README.md` for how to run it.

Two tiers were measured. **Fast** is 200 accounts, 300 projects, 37k cards
(100MB). **Heavy** is 2,000 accounts, 3,000 projects, 372k cards, 200k
dependency edges, 300k comments, 400k activity rows (663MB). Both seed three
boards sitting exactly on `MAX_TASKS_PER_PROJECT`, because that is the largest
board that can ever exist.

Numbers are a warm cache on a developer laptop, in-process, one request at a
time. They are not production latencies. What they are good for is the shape of
the curve — whether a path grows with the instance, and whether its statement
count grows with its row count.

## The headline

**No endpoint issues a number of queries that depends on how many rows it
returns.** Every scenario, at both tiers, holds a constant statement count: the
capped board is 7 queries whether it holds 60 cards or 5,000; my-tasks is 2
whether it returns 1 card or 10,123. Convention 9 is holding. Every problem
below is about how much work those few statements do, never about how many
there are.

## What was fixed

### The board payload was assembled before access was checked

`GET /api/projects/:id` and `GET /api/projects/:id/export` built the entire
board and then asked whether the caller could see it. Any signed-in account —
a free signup — could spend a capped board's worth of queries per 404, and an
inaccessible project took measurably longer to refuse than a nonexistent one,
which is the existence oracle that answering 404 rather than 403 exists to
close. `getPublicBoard` already avoided this and says so in a comment; the
authenticated path did not.

| | before | after |
| --- | --- | --- |
| refusing a capped board | 60ms, 6 queries | 0.4ms, 3 queries |

### The unseen-changes dot scanned two whole tables per project

`hasUnseenChanges` asked one `EXISTS` over a project's cards carrying two more
inside it. The inner pair correlates only on the card id, so the planner hoists
each into a hash of everything in `task_activity` and `task_comment` that clears
the seen marker — and rebuilds it once per project. For a caller in 160 projects
that was a sequential scan of both tables 160 times over: 347,860 buffer hits
for one screen.

Splitting the existential across the two arms lets each drive its own
`(task_id, created_at)` index and stop at the first hit. The arms themselves are
unchanged, so the dot and the per-card highlight still share one definition of
"changed". `∃x.(P(x) ∨ Q(x))` is `∃x.P(x) ∨ ∃x.Q(x)`, so the two forms answer
identically.

| | before | after |
| --- | --- | --- |
| `GET /api/projects`, 160 projects | 978ms | 32ms |
| same, every board with unseen activity | 1.34s | 31ms |
| buffer hits | 347,860 | 11,328 |

This one is the argument for owning a harness. At the heavy tier the planner
already chose the good plan and the endpoint answered in 237ms, so the defect
was **invisible at the size that looks most like production** and catastrophic
at the size a real mid-size customer sits at. It was a plan cliff, not a
constant cost.

### User search re-derived the caller's project list per candidate

`GET /api/users/search` excluded people the caller already shares a project with
using a correlated anti-join. Under a `LIMIT`, that predicate is re-evaluated
for every row the limit steps over, and each evaluation loops the caller's whole
project list. At 2,000 accounts and a caller in 800 projects, one keystroke in
the invite box discarded 503,444 join rows and touched **1,010,883 buffers**.
Resolving the sharer set once instead is one hashed pass.

| | before | after |
| --- | --- | --- |
| `GET /api/users/search?q=be`, 2,000 accounts | 345ms | 4.5ms |

## What is unbounded

These are the cases that grow without a ceiling. None is fixed here: each
changes a response shape or an API contract, so each needs a decision and a
matching change in `../critical-path-web` and `cli/`.

Ranked by how soon a real customer hits it.

### 1. `GET /api/my-tasks` has no limit — the only truly unbounded read

Everything else on this list is bounded by `MAX_TASKS_PER_PROJECT`. This one is
bounded by how many cards are assigned to one person across every project they
belong to, which has no ceiling at all.

| assigned cards | p50 | payload |
| ---: | ---: | ---: |
| 1,625 | 44ms | 1.4MB |
| 10,123 | 412ms | 9.5MB |

It also carries the two nested dependency arrays and two correlated hidden-edge
counts per card, so the per-card constant is high. A single query returning
9.5MB also pins a connection for the whole serialization.

Worth noting: it grows slightly faster than linearly (6.2× the cards cost 9.4×
the time), so extrapolating to 50k assigned cards is optimistic, not
pessimistic.

**Options.** Cap it (the bucket ordering means the interesting cards sort first
anyway), paginate it, or scope it to non-archived projects the caller has opened
recently. Any of these is a client change.

### 2. Comments on one card have no ceiling

`GET /api/tasks/:id` returns every comment on the card.

| comments on the card | p50 | payload |
| ---: | ---: | ---: |
| 1,000 | 6.2ms | 382KB |
| 5,000 | 26ms | 1.7MB |

Linear and cheap per row, but nothing stops a long-running card from reaching
50,000. The same applies to checklist items and attachments on one card.

### 3. Task search is O(rows matched), not O(rows returned)

`searchTasks` caps results at 50, but `ts_rank` plus `order by rank desc` has to
rank every matching row before the limit can pick 50.

| | fast (37k cards) | heavy (372k cards) |
| --- | ---: | ---: |
| `q=widget` (matches every card) | 28ms | 471ms |
| `q=w` (one character) | 25ms | 439ms |
| `q=alpha` (matches ~5%) | 2.7ms | 21ms |

10× the cards costs 17× the time. The worst case — a one-character prefix
matching most of the instance — is also **the first keystroke of every search**,
so it is the common case, not the rare one. Task search accepts a
single-character query; user search already requires two.

**Options.** Require two characters (cheapest, one-line, but it is an API
behaviour change). Bound the ranked set to the most recently updated N matches.
Or accept it and debounce harder on the client.

### 4. The public board is the largest payload in the product, and it is unauthenticated

`GET /api/public/projects/:id/board` returns every card, every comment and every
checklist row of a published board in one response: **7.0MB** at the cap, with
no token required. It is correctly gated on `is_public` before assembly, and its
cost is flat across tiers because the board cap bounds it — but 7MB per request
from an unauthenticated route is the cheapest amplification surface the API has.

**Options.** A cache header, a rate limit keyed to the project, or pagination.

### 5. The board payload is 3.4MB at the cap

`GET /api/projects/:id` is bounded by the cap, and its cost is flat across tiers
(171ms at both). This is a client-experience question rather than a scaling one:
a board at the cap ships 3.4MB before the first card renders. Laying all 5,000
cards in one column costs 224ms against 171ms spread over six — the single sort
scope is measurably worse, but not dangerously so.

### 6. `POST /api/columns/:id/move-tasks` is the longest write lock

The one bulk path with no item cap. It is bounded by the board cap, so it is a
latency problem rather than a scaling one, but it holds the column's advisory
lock for the whole time and writes one `UPDATE ... FROM (VALUES ...)` carrying
two bind parameters per card.

| | p50 | max |
| --- | ---: | ---: |
| moving 5,000 cards, fast | 214ms | 285ms |
| moving 5,000 cards, heavy | 342ms | 1.49s |

At 5,000 cards that is 10,001 bind parameters, against Postgres' 65,535 limit —
comfortable now, but the headroom shrinks if the statement ever carries another
column per card.

### 7. The projects list still materialises every card

With the unseen probe fixed, what remains is the `left join task ... group by`
that produces the two task counts: ~57ms of the ~140ms floor at heavy, growing
with the total cards across all of a caller's projects rather than with the
number of projects. Splitting it into a separate grouped query measured no
better. A maintained per-project counter would remove it, at the cost of a
column to keep correct on every card create, delete, archive and column move.

## What was checked and is fine

Measured, and either flat across tiers or comfortably cheap at both:

- **Every write.** Create, retitle, comment and the 100-card batch are all
  single-digit milliseconds at both tiers with constant statement counts. The
  task-cap `count(*)` on every card create — the obvious suspect — costs nothing
  measurable against a board near the cap.
- **Dependency cycle detection.** A blocker edge that closes a loop across a
  2,000-deep chain is refused in 8.7ms. Both the recursive walk and the path
  reconstruction traverse the whole chain and neither is a problem.
- **Cross-project dependencies.** A card with 1,000 cross-project edges resolves
  in 15ms, per-row access filter included.
- **The activity log**, at sub-millisecond on the instance's busiest card.
- **The people picker** (`GET /api/users?project_id`) on a 500-member project:
  8ms, despite five `EXISTS` arms reaching through the whole project.
- **The archive drawer**, 9.7ms for a capped board.
- **Account export**, 5.5ms for an account in 811 projects.
- **Refusals**, sub-millisecond after the fix above.

## Re-measuring

```sh
pnpm run bench            # fast tier
pnpm run bench:heavy      # heavy tier
pnpm run bench --explain --only=my-tasks
```

The tiers keep separate databases and reseed themselves when the seeder,
the scale or the migration set changes.
