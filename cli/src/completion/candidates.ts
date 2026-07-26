import { createHash } from 'node:crypto';
import { sortedColumns, sortedTasksIn } from '../board';
import { effectiveProjectRef, fetchBoard, listProjects, listUsers, matchProject } from '../resolve';
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

// A name shared by two rows is not usable as a reference, so offer short ids instead.
function toCandidates(items: readonly NamedRef[]): Candidate[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  }
  return items.map((item) =>
    (counts.get(item.name) ?? 0) > 1
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
  await writeCached(ctx.configDir, key, value);
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

async function cachedUsers(ctx: RuntimeContext, projectId?: string): Promise<Candidate[]> {
  return cached(ctx, `users:${projectId ?? 'all'}`, async () =>
    (await listUsers(ctx, projectId)).map((user) => ({ value: user.email, description: user.name }))
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
  const board = await cachedBoard(ctx, await resolveProjectId(ctx, plan.projectRef));
  if (plan.valueKind === 'column') {
    return board.columns;
  }
  return plan.valueKind === 'label' ? board.labels : board.tasks;
}
