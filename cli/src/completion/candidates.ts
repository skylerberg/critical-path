import { createHash } from 'node:crypto';
import { sortedColumns, sortedTasksIn } from '../board';
import {
  effectiveProjectRef,
  fetchBoard,
  listArchivedTasks,
  listProjects,
  listUsers,
  matchProject,
} from '../resolve';
import { readCached, writeCached } from './cache';
import type { RuntimeContext } from '../context';
import type { Candidate, CompletionPlan } from './plan';

interface NamedRef {
  id: string;
  name: string;
}

interface BoardCandidates {
  columns: Candidate[];
  tasks: Candidate[];
  labels: Candidate[];
}

// Reference resolution is case-insensitive, so names that collide under that comparison
// would be rejected as ambiguous; offer short ids instead.
export function toCandidates(items: readonly NamedRef[]): Candidate[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return items.map((item) =>
    (counts.get(item.name.toLowerCase()) ?? 0) > 1
      ? { value: item.id.slice(0, 8), description: item.name }
      : { value: item.name, description: item.id.slice(0, 8) }
  );
}

// The token is part of the key so a cache written by another account is never served.
function cacheKey(ctx: RuntimeContext, suffix: string): string {
  const fingerprint = createHash('sha256')
    .update(ctx.token ?? '')
    .digest('hex')
    .slice(0, 12);
  return `${fingerprint}|${ctx.baseUrl}|${suffix}`;
}

async function cached<T>(ctx: RuntimeContext, suffix: string, load: () => Promise<T>): Promise<T> {
  const key = cacheKey(ctx, suffix);
  const hit = await readCached<T>(ctx.configDir, key);
  if (hit != null) {
    return hit;
  }
  const value = await load();
  try {
    await writeCached(ctx.configDir, key, value);
  } catch {
    // An unwritable cache must not cost the user the candidates already in hand.
  }
  return value;
}

async function cachedProjects(ctx: RuntimeContext): Promise<NamedRef[]> {
  return cached(ctx, 'projects', async () =>
    (await listProjects(ctx)).map((project) => ({ id: project.id, name: project.name }))
  );
}

async function cachedBoard(ctx: RuntimeContext, projectId: string): Promise<BoardCandidates> {
  return cached(ctx, `board:${projectId}`, async () => {
    const board = await fetchBoard(ctx, projectId);
    const columns = sortedColumns(board);
    return {
      columns: toCandidates(columns),
      tasks: toCandidates(
        columns
          .flatMap((column) => sortedTasksIn(board, column.id))
          .map((task) => ({ id: task.id, name: task.title }))
      ),
      labels: toCandidates([...board.labels].sort((a, b) => a.name.localeCompare(b.name))),
    };
  });
}

async function cachedArchive(ctx: RuntimeContext, projectId: string): Promise<Candidate[]> {
  return cached(ctx, `archive:${projectId}`, async () =>
    toCandidates(
      (await listArchivedTasks(ctx, projectId)).map((task) => ({ id: task.id, name: task.title }))
    )
  );
}

async function cachedUsers(ctx: RuntimeContext, projectId?: string): Promise<Candidate[]> {
  return cached(ctx, `users:${projectId ?? 'all'}`, async () =>
    toCandidates(await listUsers(ctx, projectId))
  );
}

async function resolveProjectId(ctx: RuntimeContext, ref?: string): Promise<string> {
  return matchProject(effectiveProjectRef(ctx, ref), await cachedProjects(ctx)).id;
}

export async function candidatesFor(
  ctx: RuntimeContext,
  plan: CompletionPlan
): Promise<Candidate[]> {
  if (plan.kind !== 'values') {
    return [];
  }
  if (plan.valueKind === 'project') {
    return toCandidates(await cachedProjects(ctx));
  }
  if (plan.valueKind === 'user') {
    let projectId: string | undefined;
    try {
      projectId = await resolveProjectId(ctx, plan.projectRef);
    } catch {
      projectId = undefined;
    }
    return cachedUsers(ctx, projectId);
  }
  const projectId = await resolveProjectId(ctx, plan.projectRef);
  if (plan.valueKind === 'archived-task') {
    return cachedArchive(ctx, projectId);
  }
  const board = await cachedBoard(ctx, projectId);
  if (plan.valueKind === 'column') {
    return board.columns;
  }
  return plan.valueKind === 'label' ? board.labels : board.tasks;
}
