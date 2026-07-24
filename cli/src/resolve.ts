import { CliError, EXIT, assertOk } from './api/errors';
import type { RuntimeContext } from './context';
import type { components } from './api/api.generated';

export type ProjectListItem = components['schemas']['ProjectListItem'];
export type User = components['schemas']['User'];
export type BoardPayload = components['schemas']['BoardPayload'];
export type BoardColumn = components['schemas']['BoardColumn'];
export type BoardTask = components['schemas']['BoardTask'];
export type BoardLabel = components['schemas']['BoardLabel'];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ID_PREFIX_RE = /^[0-9a-f][0-9a-f-]{3,}$/;

export function matchRef<T>(
  ref: string,
  items: readonly T[],
  kind: string,
  getId: (item: T) => string,
  getName: (item: T) => string
): T {
  const lower = ref.toLowerCase();
  const tiers: T[][] = [
    items.filter((item) => getId(item).toLowerCase() === lower),
    items.filter((item) => getName(item).toLowerCase() === lower),
    ID_PREFIX_RE.test(lower)
      ? items.filter((item) => getId(item).toLowerCase().startsWith(lower))
      : [],
    items.filter((item) => getName(item).toLowerCase().includes(lower)),
  ];
  for (const tier of tiers) {
    if (tier.length === 1) {
      return tier[0];
    }
    if (tier.length > 1) {
      const candidates = tier
        .slice(0, 10)
        .map((item) => `  ${getId(item).slice(0, 8)}  ${getName(item)}`)
        .join('\n');
      throw new CliError(
        `Ambiguous ${kind} "${ref}"; use an id or a more specific name:\n${candidates}`,
        EXIT.usage
      );
    }
  }
  throw new CliError(`No ${kind} matching "${ref}"`, EXIT.notFound);
}

export async function listProjects(ctx: RuntimeContext): Promise<ProjectListItem[]> {
  return assertOk(await ctx.api.GET('/api/projects')).projects;
}

export async function resolveProject(ctx: RuntimeContext, ref?: string): Promise<ProjectListItem> {
  const effective = ref ?? ctx.deps.env.CRITICAL_PATH_PROJECT ?? ctx.config.default_project;
  if (effective == null || effective === '') {
    throw new CliError(
      'No project specified; pass --project, set CRITICAL_PATH_PROJECT, or run: cpath config set default-project <project>',
      EXIT.usage
    );
  }
  const projects = await listProjects(ctx);
  return matchRef(
    effective,
    projects,
    'project',
    (p) => p.id,
    (p) => p.name
  );
}

export async function fetchBoard(ctx: RuntimeContext, projectId: string): Promise<BoardPayload> {
  return assertOk(await ctx.api.GET('/api/projects/{id}', { params: { path: { id: projectId } } }));
}

export async function resolveBoard(
  ctx: RuntimeContext,
  projectRef?: string
): Promise<BoardPayload> {
  const project = await resolveProject(ctx, projectRef);
  return fetchBoard(ctx, project.id);
}

export function resolveColumn(board: BoardPayload, ref: string): BoardColumn {
  return matchRef(
    ref,
    board.columns,
    'column',
    (c) => c.id,
    (c) => c.name
  );
}

export function resolveTaskInBoard(board: BoardPayload, ref: string): BoardTask {
  return matchRef(
    ref,
    board.tasks,
    'task',
    (t) => t.id,
    (t) => t.title
  );
}

export function resolveLabel(board: BoardPayload, ref: string): BoardLabel {
  return matchRef(
    ref,
    board.labels,
    'label',
    (l) => l.id,
    (l) => l.name
  );
}

export async function resolveTaskId(
  ctx: RuntimeContext,
  ref: string,
  projectRef?: string
): Promise<string> {
  if (UUID_RE.test(ref)) {
    return ref;
  }
  const board = await resolveBoard(ctx, projectRef);
  return resolveTaskInBoard(board, ref).id;
}

export async function listUsers(ctx: RuntimeContext, projectId?: string): Promise<User[]> {
  const result = assertOk(
    await ctx.api.GET('/api/users', {
      params: { query: projectId == null ? {} : { project_id: projectId } },
    })
  );
  return result.users;
}

export async function resolveUser(
  ctx: RuntimeContext,
  ref: string,
  projectId?: string
): Promise<User> {
  const users = await listUsers(ctx, projectId);
  const byEmail = users.filter((u) => u.email.toLowerCase() === ref.toLowerCase());
  if (byEmail.length === 1) {
    return byEmail[0];
  }
  return matchRef(
    ref,
    users,
    'user',
    (u) => u.id,
    (u) => u.name
  );
}
