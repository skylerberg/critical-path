import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { consume, consumeWithCount, type Scenario } from './harness';
import { SELECTIVE_SEARCH_TERM, UNIVERSAL_SEARCH_TERM } from './seed';

const READ = 'read';
const WRITE = 'write';
const PATHOLOGICAL = 'pathological';

function docBody(text: string): unknown {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function countOf(body: unknown, key: string): number {
  const value = (body as Record<string, unknown> | null)?.[key];
  return Array.isArray(value) ? value.length : 0;
}

// Ids this run creates, so teardown removes exactly what it added and a
// benchmark database survives repeated runs without drifting.
const created = { tasks: new Set<string>(), comments: new Set<string>() };

// Resolved in setup rather than derived: the column move alternates between two
// real columns of the single-column board, and reading them back is what keeps
// the pair correct if the seeder's layout changes.
let moveColumns: string[] = [];

export const scenarios: Scenario[] = [
  // ---------------------------------------------------------------- reads
  {
    name: 'GET /api/projects (hub user)',
    group: READ,
    probe:
      'The landing screen. One query left-joins every card of every accessible project and ' +
      'groups them, and carries a correlated unseen-changes probe per project.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.hubUser.token).get('/api/projects'),
        (body) => `${String(countOf(body, 'projects'))} projects`
      );
    },
  },
  {
    name: 'GET /api/projects (ordinary user)',
    group: READ,
    probe: 'Control for the hub user: same query, a handful of projects.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.ordinaryUser.token).get('/api/projects'),
        (body) => `${String(countOf(body, 'projects'))} projects`
      );
    },
  },
  {
    name: 'GET /api/projects/:id (capped board, 6 columns)',
    group: READ,
    probe:
      'The biggest board the product allows, laid out normally. Eight correlated subqueries ' +
      'run per card.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.hubUser.token).get(`/api/projects/${ctx.ids.bigProject.id}`),
        (body) => `${String(countOf(body, 'tasks'))} cards`
      );
    },
  },
  {
    name: 'GET /api/projects/:id (ordinary board)',
    group: READ,
    probe: 'Control for the capped board: the board size a real project has.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.hubUser.token).get(`/api/projects/${ctx.ids.ordinaryProject.id}`),
        (body) => `${String(countOf(body, 'tasks'))} cards`
      );
    },
  },
  {
    name: 'GET /api/my-tasks (loaded user)',
    group: READ,
    probe:
      'One query with two nested dependency arrays and two correlated hidden-edge counts, ' +
      'over every card assigned to the caller across every project.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.loadedUser.token).get('/api/my-tasks'),
        (body) => `${String(countOf(body, 'tasks'))} cards`
      );
    },
  },
  {
    name: 'GET /api/my-tasks (ordinary user)',
    group: READ,
    probe: 'Control for the loaded user.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.ordinaryUser.token).get('/api/my-tasks'),
        (body) => `${String(countOf(body, 'tasks'))} cards`
      );
    },
  },
  {
    name: 'GET /api/tasks/:id (hot card)',
    group: READ,
    probe: 'A card carrying the instance’s comments, checklist rows, attachments and blockers.',
    async run(ctx) {
      return consume(await ctx.as(ctx.ids.hubUser.token).get(`/api/tasks/${ctx.ids.hotTask.id}`));
    },
  },
  {
    name: 'GET /api/tasks/:id (ordinary card)',
    group: READ,
    probe: 'Control for the hot card.',
    async run(ctx) {
      return consume(
        await ctx.as(ctx.ids.loadedUser.token).get(`/api/tasks/${ctx.ids.ordinaryTask.id}`)
      );
    },
  },
  {
    name: 'GET /api/tasks/:id/activity (hot card)',
    group: READ,
    probe: 'The activity log for a card with a long history.',
    async run(ctx) {
      return consume(
        await ctx.as(ctx.ids.hubUser.token).get(`/api/tasks/${ctx.ids.hotTask.id}/activity`)
      );
    },
  },
  {
    name: `GET /api/search?q=${SELECTIVE_SEARCH_TERM}`,
    group: READ,
    probe: 'A selective full-text search: the GIN index should carry almost all of the work.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.loadedUser.token).get(`/api/search?q=${SELECTIVE_SEARCH_TERM}`),
        (body) => `${String(countOf(body, 'results'))} results`
      );
    },
  },
  {
    name: 'GET /api/users?project_id (crowded project)',
    group: READ,
    probe:
      'The people picker for a heavily shared project. Five EXISTS arms, two of which reach ' +
      'task_assignee and task_activity through the whole project.',
    async run(ctx) {
      return consumeWithCount(
        await ctx
          .as(ctx.ids.hubUser.token)
          .get(`/api/users?project_id=${ctx.ids.crowdedProject.id}`),
        (body) => `${String(countOf(body, 'users'))} users`
      );
    },
  },

  // --------------------------------------------------------------- writes
  {
    name: 'POST /api/tasks (near-cap board)',
    group: WRITE,
    mutating: true,
    probe:
      'The hottest write in the product, against a board near the cap: the capacity guard ' +
      'counts the project’s cards and the sort key is ranked against its column.',
    async run(ctx, iteration) {
      const id = randomUUID();
      const response = await ctx.as(ctx.ids.hubUser.token).post('/api/tasks', {
        id,
        project_id: ctx.ids.writeProject.id,
        column_id: ctx.ids.writeProject.columnIds[0],
        title: `Bench created card ${String(iteration)}`,
      });
      if (response.status === 201) created.tasks.add(id);
      return consume(response);
    },
    async teardown(ctx) {
      if (created.tasks.size === 0) return;
      await ctx.db
        .deleteFrom('task')
        .where('task.id', 'in', [...created.tasks])
        .execute();
      created.tasks.clear();
    },
  },
  {
    name: 'PATCH /api/tasks/:id (retitle)',
    group: WRITE,
    mutating: true,
    probe: 'An ordinary edit: transaction, activity row, realtime publish.',
    async run(ctx, iteration) {
      return consume(
        await ctx
          .as(ctx.ids.hubUser.token)
          .patch(`/api/tasks/${ctx.ids.writeProject.firstTaskId}`, {
            title: `Bench retitled ${String(iteration)} widget`,
          })
      );
    },
  },
  {
    name: 'POST /api/comments (hot card)',
    group: WRITE,
    mutating: true,
    probe: 'Commenting on a card that already carries thousands of comments.',
    async run(ctx, iteration) {
      const id = randomUUID();
      const response = await ctx.as(ctx.ids.hubUser.token).post('/api/comments', {
        id,
        task_id: ctx.ids.hotTask.id,
        body: docBody(`Bench comment ${String(iteration)}`),
      });
      if (response.status === 201) created.comments.add(id);
      return consume(response);
    },
    async teardown(ctx) {
      if (created.comments.size === 0) return;
      await ctx.db
        .deleteFrom('task_comment')
        .where('task_comment.id', 'in', [...created.comments])
        .execute();
      created.comments.clear();
    },
  },
  {
    name: 'POST /api/tasks/batch (100 cards)',
    group: WRITE,
    mutating: true,
    iterations: 6,
    probe: 'The largest batch create the schema allows, against a near-cap board.',
    async run(ctx, iteration) {
      const ids = Array.from({ length: 100 }, () => randomUUID());
      const response = await ctx.as(ctx.ids.hubUser.token).post('/api/tasks/batch', {
        project_id: ctx.ids.writeProject.id,
        column_id: ctx.ids.writeProject.columnIds[1],
        tasks: ids.map((id, index) => ({
          id,
          title: `Bench batch ${String(iteration)}-${String(index)}`,
        })),
      });
      if (response.status === 201) for (const id of ids) created.tasks.add(id);
      return consume(response);
    },
    async teardown(ctx) {
      if (created.tasks.size === 0) return;
      await ctx.db
        .deleteFrom('task')
        .where('task.id', 'in', [...created.tasks])
        .execute();
      created.tasks.clear();
    },
  },

  // -------------------------------------------------------- pathological
  {
    name: 'GET /api/projects/:id (capped board, ONE column)',
    group: PATHOLOGICAL,
    probe:
      'The same card count in a single column. Every sort key competes in one scope, which is ' +
      'the worst ordering case a board can reach.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.hubUser.token).get(`/api/projects/${ctx.ids.oneColumnProject.id}`),
        (body) => `${String(countOf(body, 'tasks'))} cards`
      );
    },
  },
  {
    name: 'GET /api/public/.../board (capped, unauthenticated)',
    group: PATHOLOGICAL,
    probe:
      'The largest payload the product can produce, and the only one a stranger can ask for: ' +
      'every card, every comment, every checklist row on a capped board, with no pagination.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as().get(`/api/public/projects/${ctx.ids.publicProject.id}/board`),
        (body) =>
          `${String(countOf(body, 'tasks'))} cards, ${String(countOf(body, 'comments'))} comments, ` +
          `${String(countOf(body, 'checklist_items'))} checklist rows`
      );
    },
  },
  {
    name: `GET /api/search?q=${UNIVERSAL_SEARCH_TERM} (matches everything)`,
    group: PATHOLOGICAL,
    probe:
      'A term every card in the instance carries. The result set is capped at 50, but the ' +
      'rank-and-sort that picks them is not.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.loadedUser.token).get(`/api/search?q=${UNIVERSAL_SEARCH_TERM}`),
        (body) => `${String(countOf(body, 'results'))} results`
      );
    },
  },
  {
    name: 'GET /api/search?q=w (one-character prefix)',
    group: PATHOLOGICAL,
    probe: 'The first keystroke in the search box, which prefix-matches most of the instance.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.loadedUser.token).get('/api/search?q=w'),
        (body) => `${String(countOf(body, 'results'))} results`
      );
    },
  },
  {
    name: 'GET /api/search (12 terms)',
    group: PATHOLOGICAL,
    probe: 'A long query: every term becomes another arm of the tsquery.',
    async run(ctx) {
      const query = [
        'bench',
        'task',
        'widget',
        ...Array.from({ length: 9 }, (_, i) => `term${String(i)}`),
      ].join('+');
      return consumeWithCount(
        await ctx.as(ctx.ids.loadedUser.token).get(`/api/search?q=${query}`),
        (body) => `${String(countOf(body, 'results'))} results`
      );
    },
  },
  {
    name: 'GET /api/users/search?q=be (matches everyone)',
    group: PATHOLOGICAL,
    probe: 'The first keystroke of the invite box, against every account in the instance.',
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.hubUser.token).get('/api/users/search?q=be'),
        (body) => `${String(countOf(body, 'users'))} users`
      );
    },
  },
  {
    name: 'GET /api/tasks/:id/cross-project-dependencies (fan-in)',
    group: PATHOLOGICAL,
    probe:
      'A card blocked from many other projects. Two queries, each with a per-row access ' +
      'EXISTS, and no limit on the rows they build.',
    async run(ctx) {
      return consume(
        await ctx
          .as(ctx.ids.hubUser.token)
          .get(`/api/tasks/${ctx.ids.hotTask.id}/cross-project-dependencies`)
      );
    },
  },
  {
    name: 'POST /api/tasks/:id/blockers (deep cycle rejection)',
    group: PATHOLOGICAL,
    mutating: true,
    iterations: 8,
    probe:
      'The worst case for the cycle guard: an edge that closes a loop across the whole ' +
      'dependency chain, so the recursive walk and the path reconstruction both traverse it all.',
    async run(ctx) {
      const response = await ctx
        .as(ctx.ids.hubUser.token)
        .post(`/api/tasks/${ctx.ids.chainProject.tailTaskId}/blockers`, {
          blocker_task_id: ctx.ids.chainProject.headTaskId,
        });
      return { ...(await consume(response)), note: `expects 409, got ${String(response.status)}` };
    },
  },
  {
    name: 'GET /api/projects/:id/archived-tasks (capped board)',
    group: PATHOLOGICAL,
    probe: 'The archive drawer: the same eight subqueries per card, with no limit.',
    async run(ctx) {
      return consumeWithCount(
        await ctx
          .as(ctx.ids.hubUser.token)
          .get(`/api/projects/${ctx.ids.bigProject.id}/archived-tasks`),
        (body) => `${String(countOf(body, 'tasks'))} cards`
      );
    },
  },
  {
    name: 'GET /api/projects/:id/export (capped board)',
    group: PATHOLOGICAL,
    probe: 'A whole capped board serialized in one request.',
    async run(ctx) {
      return consume(
        await ctx.as(ctx.ids.hubUser.token).get(`/api/projects/${ctx.ids.bigProject.id}/export`)
      );
    },
  },
  {
    name: 'GET /api/auth/me/export (hub account)',
    group: PATHOLOGICAL,
    probe: 'Every project the caller owns or belongs to, in one response.',
    iterations: 4,
    warmup: 1,
    async run(ctx) {
      return consume(await ctx.as(ctx.ids.hubUser.token).get('/api/auth/me/export'));
    },
  },
  {
    name: 'POST /api/columns/:id/move-tasks (5,000 cards)',
    group: PATHOLOGICAL,
    mutating: true,
    iterations: 4,
    warmup: 0,
    probe:
      'The one bulk path with no item cap: it moves an entire column, however many cards that ' +
      'is, inside one request transaction holding the column’s advisory lock.',
    async setup(ctx) {
      // The single-column board is the only place 5,000 cards sit in one
      // column, which is what makes this the uncapped case rather than a
      // sixth of one.
      const columns = await ctx.db
        .selectFrom('board_column')
        .select('board_column.id')
        .where('board_column.project_id', '=', ctx.ids.oneColumnProject.id)
        .orderBy('board_column.sort_key')
        .limit(2)
        .execute();
      moveColumns = columns.map((column) => column.id);
    },
    async run(ctx, iteration) {
      // Alternated so the run does not pile every card into one column and then
      // measure an empty move.
      const [from, to] =
        iteration % 2 === 0 ? [moveColumns[0], moveColumns[1]] : [moveColumns[1], moveColumns[0]];
      return consume(
        await ctx
          .as(ctx.ids.hubUser.token)
          .post(`/api/columns/${String(from)}/move-tasks`, { target_column_id: to })
      );
    },
  },
  {
    name: 'GET /api/projects/:id refused (no access)',
    group: PATHOLOGICAL,
    probe:
      'What a caller with no access costs. A refusal that assembles the payload first would ' +
      'make an unauthenticated scan as expensive as serving the board.',
    async run(ctx) {
      const response = await ctx
        .as(ctx.ids.outsider.token)
        .get(`/api/projects/${ctx.ids.bigProject.id}`);
      return { ...(await consume(response)), note: `expects 404, got ${String(response.status)}` };
    },
  },
  {
    name: 'GET /api/tasks/:id refused (no access)',
    group: PATHOLOGICAL,
    probe: 'The same question for a single card.',
    async run(ctx) {
      const response = await ctx.as(ctx.ids.outsider.token).get(`/api/tasks/${ctx.ids.hotTask.id}`);
      return { ...(await consume(response)), note: `expects 404, got ${String(response.status)}` };
    },
  },
  {
    name: 'PUT /api/projects/:id/seen (capped board)',
    group: PATHOLOGICAL,
    mutating: true,
    probe:
      'Opening a board clears its dot, which means resolving what changed across every card ' +
      'in it.',
    async run(ctx) {
      return consume(
        await ctx.as(ctx.ids.hubUser.token).put(`/api/projects/${ctx.ids.bigProject.id}/seen`)
      );
    },
  },
  {
    name: 'GET /api/projects (hub user, all dots lit)',
    group: PATHOLOGICAL,
    probe:
      'The landing screen when every board has unseen activity. The unseen probe can stop at ' +
      'the first changed card; this is the case where it cannot stop early on any project.',
    async setup(ctx) {
      await sql`
        update project_user_seen
        set last_seen_at = now() - interval '10 years'
        where user_id = ${ctx.ids.hubUser.id}
      `.execute(ctx.db);
    },
    async run(ctx) {
      return consumeWithCount(
        await ctx.as(ctx.ids.hubUser.token).get('/api/projects'),
        (body) => `${String(countOf(body, 'projects'))} projects`
      );
    },
    async teardown(ctx) {
      await sql`
        update project_user_seen
        set last_seen_at = now() - interval '2 days'
        where user_id = ${ctx.ids.hubUser.id}
      `.execute(ctx.db);
    },
  },
];
