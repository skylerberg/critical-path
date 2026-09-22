# Scaling

What the API does as an instance grows, measured rather than reasoned about.
The harness is `bench/` — see `bench/README.md` for how to run it.

Two tiers were measured. **Fast** is 200 accounts, 300 projects, 37k cards.
**Heavy** is 2,000 accounts, 3,000 projects, 372k cards, 200k dependency edges,
300k comments, 400k activity rows. Both seed three boards sitting exactly on
`MAX_TASKS_PER_PROJECT`, because that is the largest board that can ever exist.

Numbers are a warm cache on a developer laptop, in-process, one request at a
time — not production latencies. What they are good for is the shape of the
curve: whether a path grows with the instance, and whether its statement count
grows with its row count.

## The headline

**No endpoint issues a number of queries that depends on how many rows it
returns.** Every scenario, at both tiers, holds a constant statement count.
Every problem below is about how much work those few statements do, never about
how many there are.

## What is unbounded

These are the cases that grow without a ceiling. None is fixed: each changes a
response shape or an API contract, so each needs a decision and a matching
change in `web/` and `cli/` — and, being an API contract change, one that
respects the two-commit deploy rule in the root `AGENTS.md`.

Ranked by how soon a real customer hits it. The timings are from the last sweep
at the heavy tier and are indicative only.

### 1. `GET /api/my-tasks` has no limit — the only truly unbounded read

Everything else on this list is bounded by `MAX_TASKS_PER_PROJECT`. This one is
bounded by how many cards are assigned to one person across every project they
belong to, which has no ceiling at all. At ~10k assigned cards it answered in
hundreds of milliseconds with a ~10MB payload, growing slightly faster than
linearly, and it carries nested dependency arrays and correlated hidden-edge
counts per card, so the per-card constant is high. A single query returning
10MB also pins a connection for the whole serialization.

**Options.** Cap it (the bucket ordering means the interesting cards sort first
anyway), paginate it, or scope it to non-archived projects the caller has opened
recently. Any of these is a client change.

### 2. Comments on one card have no ceiling

`GET /api/tasks/:id` returns every comment on the card. Linear and cheap per
row, but nothing stops a long-running card from reaching tens of thousands. The
same applies to checklist items and attachments on one card.

### 3. Task search is O(rows matched), not O(rows returned)

`searchTasks` caps results at 50, but `ts_rank` plus `order by rank desc` has to
rank every matching row before the limit can pick 50. 10× the cards cost ~17×
the time. The worst case — a one-character prefix matching most of the instance
— is also **the first keystroke of every search**. Task search accepts a
single-character query; user search already requires two.

**Options.** Require two characters (cheapest, but an API behaviour change),
bound the ranked set to the most recently updated N matches, or accept it and
debounce harder on the client.

### 4. The public board is the largest payload in the product, and it is unauthenticated

`GET /api/public/projects/:id/board` returns every card, comment and checklist
row of a published board in one response — several MB at the cap, with no token
required. Its cost is flat across tiers because the board cap bounds it, but
that per-request size on an unauthenticated route is the cheapest amplification
surface the API has.

**Options.** A cache header, a rate limit keyed to the project, or pagination.

### 5. The board payload is several MB at the cap

`GET /api/projects/:id` is bounded by the cap and its cost is flat across
tiers. This is a client-experience question rather than a scaling one: a board
at the cap ships megabytes before the first card renders. Laying all the cards
in one column is measurably worse than spreading them over six — the single
sort scope — but not dangerously so.

### 6. `POST /api/columns/:id/move-tasks` is the longest write lock

The one bulk path with no item cap. Bounded by the board cap, so a latency
problem rather than a scaling one, but it holds the column's advisory lock for
the whole write and carries two bind parameters per card — at the cap that is
10,001 against Postgres' 65,535 limit, and the headroom shrinks if the
statement ever carries another column per card.

### 7. The projects list still materialises every card

What remains is the `left join task ... group by` that produces the two task
counts: it grows with the total cards across all of a caller's projects rather
than with the number of projects. Splitting it into a separate grouped query
measured no better. A maintained per-project counter would remove it, at the
cost of a column to keep correct on every card create, delete, archive and
column move.

## What was checked and is fine

Measured, and either flat across tiers or comfortably cheap at both: every
write; dependency cycle detection over a thousands-deep chain; cross-project
dependency resolution at 1,000 edges on one card; the activity log on the
instance's busiest card; the people picker on a 500-member project; the archive
drawer on a capped board; account export for an account in hundreds of
projects; and refusals of inaccessible projects.

## Re-measuring

```sh
pnpm run bench            # fast tier
pnpm run bench:heavy      # heavy tier
pnpm run bench --explain --only=my-tasks
```

The tiers keep separate databases and reseed themselves when the seeder,
the scale or the migration set changes.
