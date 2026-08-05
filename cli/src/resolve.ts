import { CliError, EXIT, assertOk } from './api/errors';
import { configPath } from './config';
import { decodeId } from './short-links';
import { displayTitle } from './output';
import type { RuntimeContext } from './context';
import type { components } from './api/api.generated';

export type ProjectListItem = components['schemas']['ProjectListItem'];
export type User = components['schemas']['User'];
export type BoardPayload = components['schemas']['BoardResponse'];
export type BoardColumn = components['schemas']['BoardColumn'];
export type BoardTask = components['schemas']['BoardTask'];
export type BoardLabel = components['schemas']['BoardLabel'];
export type ArchivedTask = components['schemas']['ArchivedTask'];
export type MyTask = components['schemas']['MyTask'];
export type MyTaskLink = components['schemas']['MyTaskLink'];
export type MyTaskPersonGroup = components['schemas']['MyTaskPersonGroup'];
export type MyTasksResponse = components['schemas']['MyTasksResponse'];
export type ProjectInvitation = components['schemas']['ProjectInvitation'];
export type TaskDetail = components['schemas']['TaskDetailResponse'];
export type ChecklistItem = components['schemas']['ChecklistItem'];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ID_PREFIX_RE = /^[0-9a-f][0-9a-f-]{3,}$/;

export function matchRefOrNull<T>(
  ref: string,
  items: readonly T[],
  kind: string,
  getId: (item: T) => string,
  getName: (item: T) => string
): T | null {
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
        .map((item) => `  ${getId(item).slice(0, 8)}  ${displayTitle(getName(item))}`)
        .join('\n');
      throw new CliError(
        `Ambiguous ${kind} "${ref}"; use an id or a more specific name:\n${candidates}`,
        EXIT.usage
      );
    }
  }
  return null;
}

export function matchRef<T>(
  ref: string,
  items: readonly T[],
  kind: string,
  getId: (item: T) => string,
  getName: (item: T) => string
): T {
  const match = matchRefOrNull(ref, items, kind, getId, getName);
  if (match === null) {
    throw new CliError(`No ${kind} matching "${ref}"`, EXIT.notFound);
  }
  return match;
}

// The matcher lowercases every ref and a case-flipped alias is a different id, so
// the decode happens out here.
export function matchRefOrAliasOrNull<T>(
  ref: string,
  items: readonly T[],
  kind: string,
  getId: (item: T) => string,
  getName: (item: T) => string
): T | null {
  const decoded = decodeId(ref);
  const byAlias =
    decoded === null
      ? undefined
      : items.find((item) => getId(item).toLowerCase() === decoded.toLowerCase());
  return byAlias ?? matchRefOrNull(ref, items, kind, getId, getName);
}

export function matchRefOrAlias<T>(
  ref: string,
  items: readonly T[],
  kind: string,
  getId: (item: T) => string,
  getName: (item: T) => string
): T {
  const match = matchRefOrAliasOrNull(ref, items, kind, getId, getName);
  if (match === null) {
    throw new CliError(`No ${kind} matching "${ref}"`, EXIT.notFound);
  }
  return match;
}

export async function listProjects(ctx: RuntimeContext): Promise<ProjectListItem[]> {
  return assertOk(await ctx.api.GET('/api/projects')).projects;
}

export async function listMyTasks(ctx: RuntimeContext): Promise<MyTasksResponse> {
  return assertOk(await ctx.api.GET('/api/my-tasks'));
}

type ProjectRef = { value: string; source: 'argument' | 'env' | 'config' };

function projectRef(ctx: RuntimeContext, ref?: string): ProjectRef | null {
  const chosen: ProjectRef | null =
    ref != null
      ? { value: ref, source: 'argument' }
      : ctx.deps.env.CRITICAL_PATH_PROJECT != null
        ? { value: ctx.deps.env.CRITICAL_PATH_PROJECT, source: 'env' }
        : ctx.config.default_project != null
          ? { value: ctx.config.default_project, source: 'config' }
          : null;
  return chosen === null || chosen.value === '' ? null : chosen;
}

function requireProjectRef(ctx: RuntimeContext, ref?: string): ProjectRef {
  const chosen = projectRef(ctx, ref);
  if (chosen === null) {
    throw new CliError(
      'No project specified; pass --project, set CRITICAL_PATH_PROJECT, or run: cpath config set default-project <project>',
      EXIT.usage
    );
  }
  return chosen;
}

export function projectRefOrNull(ctx: RuntimeContext, ref?: string): string | null {
  return projectRef(ctx, ref)?.value ?? null;
}

export function effectiveProjectRef(ctx: RuntimeContext, ref?: string): string {
  return requireProjectRef(ctx, ref).value;
}

export function matchProject<T extends { id: string; name: string }>(
  ref: string,
  projects: readonly T[]
): T {
  return matchRefOrAlias(
    ref,
    projects,
    'project',
    (p) => p.id,
    (p) => p.name
  );
}

export async function resolveProject(ctx: RuntimeContext, ref?: string): Promise<ProjectListItem> {
  const { value, source } = requireProjectRef(ctx, ref);
  const match = matchRefOrAliasOrNull(
    value,
    await listProjects(ctx),
    'project',
    (p) => p.id,
    (p) => p.name
  );
  if (match !== null) {
    return match;
  }
  // A ref the caller never typed has to name where it came from, or the id in the
  // message looks like the CLI's own invention.
  const origin =
    source === 'config'
      ? `; it is the default-project in ${configPath(ctx.configDir)} — replace it with "cpath config set default-project <project>" or drop it with "cpath config unset default-project"`
      : source === 'env'
        ? '; it is the value of CRITICAL_PATH_PROJECT'
        : '';
  throw new CliError(`No project matching "${value}"${origin}`, EXIT.notFound);
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
  return matchRefOrAlias(
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

export async function listArchivedTasks(
  ctx: RuntimeContext,
  projectId: string
): Promise<ArchivedTask[]> {
  return assertOk(
    await ctx.api.GET('/api/projects/{id}/archived-tasks', {
      params: { path: { id: projectId } },
    })
  ).tasks;
}

export function matchArchivedTask(archived: readonly ArchivedTask[], ref: string): ArchivedTask {
  return matchRef(
    ref,
    archived,
    'task',
    (t) => t.id,
    (t) => t.title
  );
}

// Null rather than a throw: the caller may still have a title tier to try.
export async function fetchTaskOrNull(ctx: RuntimeContext, id: string): Promise<TaskDetail | null> {
  const result = await ctx.api.GET('/api/tasks/{id}', { params: { path: { id } } });
  return result.response.status === 404 ? null : assertOk(result);
}

export async function resolveTaskId(
  ctx: RuntimeContext,
  ref: string,
  projectRef?: string,
  opts: { includeArchived?: boolean } = {}
): Promise<string> {
  if (UUID_RE.test(ref)) {
    return ref;
  }
  // An alias is also a legal title, so one that names no task falls through to the
  // title tiers instead of shadowing them — and titles need a project to live in.
  const decoded = decodeId(ref);
  if (decoded !== null) {
    if ((await fetchTaskOrNull(ctx, decoded)) !== null) {
      return decoded;
    }
    if (projectRefOrNull(ctx, projectRef) === null) {
      throw new CliError(`No task matching "${ref}"`, EXIT.notFound);
    }
  }
  const board = await resolveBoard(ctx, projectRef);
  const task = matchRefOrNull(
    ref,
    board.tasks,
    'task',
    (t) => t.id,
    (t) => t.title
  );
  if (task !== null) {
    return task.id;
  }
  if (opts.includeArchived === true) {
    return matchArchivedTask(await listArchivedTasks(ctx, board.project.id), ref).id;
  }
  throw new CliError(`No task matching "${ref}"`, EXIT.notFound);
}

// Resolved against the pending list rather than sent as typed, so the id the
// table prints is one that can be pasted back.
export async function resolveInvitation(
  ctx: RuntimeContext,
  projectId: string,
  ref: string
): Promise<ProjectInvitation> {
  const { invitations } = assertOk(
    await ctx.api.GET('/api/projects/{id}/invitations', { params: { path: { id: projectId } } })
  );
  return matchRef(
    ref,
    invitations,
    'invitation',
    (invitation) => invitation.id,
    (invitation) => invitation.email
  );
}

export async function listUsers(
  ctx: RuntimeContext,
  projectId?: string,
  email?: string
): Promise<User[]> {
  const result = assertOk(
    await ctx.api.GET('/api/users', {
      params: {
        query: {
          ...(projectId == null ? {} : { project_id: projectId }),
          ...(email == null ? {} : { email }),
        },
      },
    })
  );
  return result.users;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Costs a round trip because the server is the only side that holds an address.
// Still just the first tier: one that names nobody falls through to the name tiers.
export async function resolveUser(
  ctx: RuntimeContext,
  ref: string,
  projectId?: string
): Promise<User> {
  if (EMAIL_RE.test(ref)) {
    const [match] = await listUsers(ctx, projectId, ref);
    if (match !== undefined) {
      return match;
    }
  }
  return matchRef(
    ref,
    await listUsers(ctx, projectId),
    'user',
    (u) => u.id,
    (u) => u.name
  );
}
