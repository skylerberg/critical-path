import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import type { Kysely, Updateable } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator, queryValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import {
  accessibleProjectsFilter,
  assertCanWriteProject,
  assertProjectAccess,
  assertProjectOwnedBy,
  assertProjectWrite,
  canAccessProject,
  isProjectMember,
  READ_ONLY_MESSAGE,
  type ProjectRole,
} from '../services/authorization';
import { avatarUrl } from '../services/avatars';
import { stripAssigneesForRemovedMembers } from '../services/assigneeStrip';
import { getArchivedTasks, getBoardPayload } from '../services/boardPayload';
import { exportFilename, projectExportArchive } from '../services/export/archive';
import { buildProjectExport } from '../services/export/payload';
import { copyProject } from '../services/projectCopy';
import {
  PROJECT_COLUMNS,
  fetchMembers,
  publishProjectListItem,
  toMemberEntries,
  toProjectResponse,
  type ProjectRow,
} from '../services/projectListItem';
import { publishAfterCommit } from '../services/realtime/index';
import { recordAssigneeChanges } from '../services/taskActivity';
import { fetchTaskRelations, publishTaskRelationsSet } from '../services/taskRelations';
import { storage } from '../services/storage/index';
import type { DB, Project } from '../db/types';
import {
  idSchema,
  projectSchema,
  projectsListResponseSchema,
  boardPayloadSchema,
  archivedTasksResponseSchema,
  createProjectSchema,
  patchProjectSchema,
  setProjectPositionSchema,
  setProjectMembersSchema,
  setProjectOwnerSchema,
  addProjectMemberByEmailSchema,
  projectMemberUserResponseSchema,
  projectExportQuerySchema,
  projectExportSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  payloadTooLargeErrorResponse,
  validationErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const DEFAULT_COLUMNS = [
  { name: 'Backlog', is_done: false },
  { name: 'To Do', is_done: false },
  { name: 'In Progress', is_done: false },
  { name: 'Done', is_done: true },
];

// Every project_member write decides what to write from created_by, so that
// read has to hold the project row: without the lock an ownership transfer can
// commit mid-request and leave the new creator holding a member row.
async function lockProject(db: Kysely<DB>, projectId: string): Promise<ProjectRow> {
  const row = await db
    .selectFrom('project')
    .select(PROJECT_COLUMNS)
    .where('id', '=', projectId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) {
    throw new AppError(404, 'Project not found');
  }
  return row;
}

async function removeMembers(
  c: Parameters<typeof publishAfterCommit>[0],
  db: Kysely<DB>,
  project: ProjectRow,
  actorUserId: string,
  removed: string[]
): Promise<void> {
  await db
    .deleteFrom('project_member')
    .where('project_id', '=', project.id)
    .where('user_id', 'in', removed)
    .execute();
  const stripped = await stripAssigneesForRemovedMembers(db, project.id, removed);
  await recordAssigneeChanges(
    db,
    actorUserId,
    stripped.map((entry) => ({
      taskId: entry.task_id,
      kind: 'assignee_removed' as const,
      userId: entry.user_id,
    }))
  );
  const strippedTaskIds = [...new Set(stripped.map((entry) => entry.task_id))];
  publishTaskRelationsSet(c, await fetchTaskRelations(db, strippedTaskIds));
}

const router: AppHono = new Hono();

router.get(
  '/',
  describeRoute({
    tags: ['Projects'],
    summary: 'List projects',
    description:
      'List projects the caller can access (created by them or shared with them as a member) ' +
      "with member ids, member roles, open and done task counts, and the caller's personal sort position " +
      '(null when never set). Archived tasks count toward neither total. Ordered by position ' +
      '(nulls last), then created_at, then id.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Accessible projects with task counts',
        content: {
          'application/json': {
            schema: resolver(projectsListResponseSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  async (c) => {
    const user = c.get('user');
    const rows = await c
      .get('db')
      .selectFrom('project')
      .leftJoin('task', 'task.project_id', 'project.id')
      .leftJoin('board_column', 'board_column.id', 'task.column_id')
      .leftJoin('project_user_position', (join) =>
        join
          .onRef('project_user_position.project_id', '=', 'project.id')
          .on('project_user_position.user_id', '=', user.id)
      )
      .select((eb) => [
        'project.id',
        'project.name',
        'project.description',
        'project.archived_at',
        'project.created_at',
        'project.created_by',
        'project.is_public',
        'project_user_position.position',
        jsonArrayFrom(
          eb
            .selectFrom('project_member')
            .select(['project_member.user_id', 'project_member.role'])
            .whereRef('project_member.project_id', '=', 'project.id')
            .orderBy('project_member.created_at')
            .orderBy('project_member.user_id')
        ).as('member_rows'),
        // Archived rows are excluded inside the aggregate, never in the outer
        // where: that would turn the left joins into inner ones and drop every
        // project whose tasks are all archived.
        eb.fn
          .count<string>('task.id')
          .filterWhere(eb.not(eb.fn.coalesce('board_column.is_done', eb.val(false))))
          .filterWhere('task.archived_at', 'is', null)
          .as('open_task_count'),
        eb.fn
          .count<string>('task.id')
          .filterWhere('board_column.is_done', '=', true)
          .filterWhere('task.archived_at', 'is', null)
          .as('done_task_count'),
      ])
      .where(accessibleProjectsFilter(user.id))
      .groupBy(['project.id', 'project_user_position.position'])
      .orderBy('project_user_position.position', (ob) => ob.asc().nullsLast())
      .orderBy('project.created_at')
      .orderBy('project.id')
      .execute();

    return c.json(
      {
        projects: rows.map((row) => ({
          ...toProjectResponse(row, toMemberEntries(row.member_rows)),
          open_task_count: Number(row.open_task_count),
          done_task_count: Number(row.done_task_count),
          position: row.position,
        })),
      },
      200
    );
  }
);

router.post(
  '/',
  describeRoute({
    tags: ['Projects'],
    summary: 'Create project',
    description:
      'Create a project with the default Backlog / To Do / In Progress / Done columns, or ' +
      'deep-copy an existing project by passing source_project_id (copies columns, labels, ' +
      'tasks, task labels, dependencies, and images — not comments, assignees, members, ' +
      'archived cards, or the archived state of the project itself; copies start personal). ' +
      'Returns 422 when source_project_id does not ' +
      'reference an existing project and 404 when it references a project the caller cannot access.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Created project as a full board payload',
        content: {
          'application/json': {
            schema: resolver(boardPayloadSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  jsonValidator(createProjectSchema),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    try {
      if (body.source_project_id !== undefined) {
        const source = await db
          .selectFrom('project')
          .select(['id', 'created_by'])
          .where('id', '=', body.source_project_id)
          .executeTakeFirst();
        if (source && !(await canAccessProject(db, user.id, source))) {
          throw new AppError(404, 'Project not found');
        }

        await copyProject(db, {
          id: body.id,
          name: body.name,
          description: body.description,
          sourceProjectId: body.source_project_id,
          createdBy: user.id,
        });
      } else {
        await db
          .insertInto('project')
          .values({
            id: body.id,
            name: body.name,
            description: body.description ?? '',
            created_by: user.id,
          })
          .execute();

        await db
          .insertInto('board_column')
          .values(
            DEFAULT_COLUMNS.map((column, index) => ({
              id: crypto.randomUUID(),
              project_id: body.id,
              name: column.name,
              position: (index + 1) * 1000,
              is_done: column.is_done,
            }))
          )
          .execute();
      }
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Project id already in use');
      }
      throw err;
    }

    const payload = await getBoardPayload(db, body.id);
    if (!payload) {
      throw new AppError(500, 'Failed to load created project');
    }
    const doneColumnIds = new Set(
      payload.columns.filter((column) => column.is_done).map((column) => column.id)
    );
    const doneCount = payload.tasks.filter((task) => doneColumnIds.has(task.column_id)).length;
    publishAfterCommit(
      c,
      'project_created',
      body.id,
      {
        ...payload.project,
        open_task_count: payload.tasks.length - doneCount,
        done_task_count: doneCount,
      },
      { broadcast: true }
    );
    return c.json(payload, 201);
  }
);

router.get(
  '/:id',
  describeRoute({
    tags: ['Projects'],
    summary: 'Get board payload',
    description:
      'Get a project with its columns, tasks (including label, assignee, and blocker ids ' +
      'plus image counts), and labels in one payload. Archived tasks are excluded, as are ' +
      'archived tasks appearing as blockers of the tasks that are included.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Board payload',
        content: {
          'application/json': {
            schema: resolver(boardPayloadSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const payload = await getBoardPayload(db, id);
    if (!payload || !(await canAccessProject(db, user.id, payload.project))) {
      throw new AppError(404, 'Project not found');
    }
    return c.json(payload, 200);
  }
);

router.get(
  '/:id/archived-tasks',
  describeRoute({
    tags: ['Projects'],
    summary: 'List archived tasks',
    description:
      'List every archived task in a project in board-payload shape plus archived_at, most ' +
      'recently archived first and then in board position order, so a column archived in one ' +
      'call lists the way it was returned. Unpaginated and unfiltered — clients search it ' +
      'themselves, the same way they do the board payload.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Archived tasks, newest first',
        content: {
          'application/json': {
            schema: resolver(archivedTasksResponseSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    await assertProjectAccess(db, c.get('user').id, id);

    return c.json({ tasks: await getArchivedTasks(db, id) }, 200);
  }
);

router.get(
  '/:id/export',
  describeRoute({
    tags: ['Projects'],
    summary: 'Export project',
    description:
      'Download everything in a project. The default zip holds project.json (the manifest ' +
      'below), tasks.csv (one row per task, for spreadsheets), and images/ with the real bytes ' +
      'of every attached image, so the archive survives losing the account. Archived cards are ' +
      'exported too, after the live ones, each carrying the archived_at that marks it and the ' +
      'column_id it was archived from; a live card has archived_at null. Pass format=json ' +
      'for the manifest alone. The manifest is the documented, stable interchange format the ' +
      'importer reads back: format identifies it, version is bumped only on a breaking shape ' +
      'change, and ids are the original server ids — created_by, member_ids and assignee_ids ' +
      'resolve against users[], label_ids against labels[], column_id against columns[], and ' +
      'blocker_ids against tasks[]. Task descriptions are stored verbatim, so their embedded ' +
      '/api/images/<uuid> sources resolve by id against the flattened tasks[].images[]. Each ' +
      'image entry carries the archive-relative path of its file. Every project member may ' +
      'export; the export is free and never gated. A project whose images would exceed the ' +
      '4 GiB zip ceiling answers 413 and must be exported with format=json, which carries no ' +
      'image bytes — fetch those from GET /api/images/{id}, one per tasks[].images[].id.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Project export archive, or the manifest alone with format=json',
        content: {
          'application/json': {
            schema: resolver(projectExportSchema),
          },
          'application/zip': {
            schema: { type: 'string', format: 'binary' },
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...payloadTooLargeErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  queryValidator(projectExportQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { format } = c.req.valid('query');
    const db = c.get('db');
    const user = c.get('user');

    // One reading, so the manifest timestamp and the filename date agree.
    const now = new Date();

    // An export is a file the user keeps and feeds to an importer, so the reads
    // behind it take one snapshot: under read committed a concurrent edit lands
    // between two of them and the archive is permanently self-inconsistent. It
    // closes here — the body must not hold a connection while it streams.
    const snapshot = await db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        const payload = await getBoardPayload(trx, id);
        if (!payload || !(await canAccessProject(trx, user.id, payload.project))) {
          return null;
        }
        return buildProjectExport(trx, payload, now);
      });

    if (!snapshot) {
      throw new AppError(404, 'Project not found');
    }
    const { exportPayload, images } = snapshot;

    if (format === 'json') {
      return c.json(exportPayload, 200);
    }

    const archive = projectExportArchive(exportPayload, images, now);
    c.header('Content-Type', 'application/zip');
    c.header(
      'Content-Disposition',
      `attachment; filename="${exportFilename(exportPayload.project.name, now)}"`
    );
    return c.body(archive, 200);
  }
);

router.patch(
  '/:id',
  describeRoute({
    tags: ['Projects'],
    summary: 'Update project',
    description:
      'Update project fields. Set archived_at to an ISO timestamp to archive or null to ' +
      'unarchive. Set is_public to true to publish the board read-only at ' +
      'GET /api/public/projects/:id/board, which serves card titles, descriptions and their ' +
      'embedded images, labels, blockers, and assignee names and avatars to anyone with the ' +
      'project id and no account. Set it back to false to stop serving it. Editors only: a ' +
      'viewer gets 403 and non-accessors 404.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated project',
        content: {
          'application/json': {
            schema: resolver(projectSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  jsonValidator(patchProjectSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    await assertProjectWrite(db, user.id, id);

    const updates: Updateable<Project> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.archived_at !== undefined) updates.archived_at = body.archived_at;
    if (body.is_public !== undefined) updates.is_public = body.is_public;

    const row =
      Object.keys(updates).length > 0
        ? await db
            .updateTable('project')
            .set(updates)
            .where('id', '=', id)
            .returning(PROJECT_COLUMNS)
            .executeTakeFirst()
        : await db
            .selectFrom('project')
            .select(PROJECT_COLUMNS)
            .where('id', '=', id)
            .executeTakeFirst();

    if (!row) {
      throw new AppError(404, 'Project not found');
    }

    const members = await fetchMembers(db, id);
    await publishProjectListItem(c, db, row, members);
    return c.json(toProjectResponse(row, members), 200);
  }
);

router.delete(
  '/:id',
  describeRoute({
    tags: ['Projects'],
    summary: 'Delete project',
    description:
      'Delete a project and everything in it. Only the project owner may delete: other members ' +
      'with access get 403 and non-accessors get 404. Stored image objects are removed after ' +
      'commit.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Project deleted',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    await assertProjectWrite(db, user.id, id);
    const project = await lockProject(db, id);
    assertProjectOwnedBy(project, user.id, 'Only the project owner can delete this project');

    // Snapshot who can see the project now; post-commit the rows backing the
    // access check are gone.
    const recipients = new Set<string>((await fetchMembers(db, id)).map((m) => m.user_id));
    if (project.created_by !== null) {
      recipients.add(project.created_by);
    }

    const imageRows = await db
      .selectFrom('task_image')
      .innerJoin('task', 'task.id', 'task_image.task_id')
      .select('task_image.storage_key')
      .where('task.project_id', '=', id)
      .execute();

    const result = await db.deleteFrom('project').where('id', '=', id).executeTakeFirst();
    if (result.numDeletedRows === 0n) {
      throw new AppError(404, 'Project not found');
    }

    if (imageRows.length > 0) {
      const keys = imageRows.map((row) => row.storage_key);
      c.get('postCommitHooks').push(async () => {
        await Promise.all(keys.map((key) => storage.delete(key)));
      });
    }

    publishAfterCommit(c, 'project_deleted', id, { id }, { recipientUserIds: [...recipients] });
    return c.body(null, 204);
  }
);

router.put(
  '/:id/position',
  describeRoute({
    tags: ['Projects'],
    summary: 'Set project position',
    description:
      "Set the caller's personal sort position for a project. Positions are per user and " +
      'order the project list for the caller only; other members are unaffected.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Position set',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  jsonValidator(setProjectPositionSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { position } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    await assertProjectAccess(db, user.id, id);

    await db
      .insertInto('project_user_position')
      .values({ user_id: user.id, project_id: id, position })
      .onConflict((oc) => oc.columns(['user_id', 'project_id']).doUpdateSet({ position }))
      .execute();

    // Per-user data: exact recipients sync the caller's other devices without
    // leaking or reshuffling anything for other members.
    publishAfterCommit(
      c,
      'project_position_updated',
      id,
      { id, position },
      { recipientUserIds: [user.id] }
    );
    return c.body(null, 204);
  }
);

router.put(
  '/:id/members',
  describeRoute({
    tags: ['Projects'],
    summary: 'Set project members',
    description:
      'Replace the full member set of a project, change member roles, or both. Editors may ' +
      'call; a viewer may only use it to remove themselves and gets 403 for anything else; ' +
      'non-accessors get 404. Omit user_ids to change roles only, which cannot add or remove ' +
      'anyone however stale the caller’s member list is. The creator has implicit access, is ' +
      'always an editor, and is never stored as a member: their id is silently stripped from ' +
      'both user_ids and roles if present. Every newly added id must reference an existing ' +
      'user and every roles entry must name someone in the resulting member set (422 with a ' +
      'plain error body otherwise). A retained member with no roles entry keeps their stored ' +
      'role. Removed members lose their task assignments in the project.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Members set',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  jsonValidator(setProjectMembersSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { user_ids, roles } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    await assertProjectAccess(db, user.id, id);
    const project = await lockProject(db, id);
    const current = await fetchMembers(db, id);

    const callerRole: ProjectRole =
      project.created_by === user.id
        ? 'editor'
        : (current.find((member) => member.user_id === user.id)?.role ?? 'viewer');

    // Before any domain validation: a viewer must not be able to drive the
    // user-existence check below and read it as an oracle, and must not be able
    // to evict anyone else even with a stale cached member list.
    if (callerRole !== 'editor') {
      // `roles` is refused rather than ignored: leaving is the only thing this can
      // mean for a viewer, and answering 204 to a body asking for something else
      // would report a role change that never happened.
      if (user_ids === undefined || user_ids.includes(user.id) || roles !== undefined) {
        throw new AppError(403, READ_ONLY_MESSAGE);
      }
      await removeMembers(c, db, project, user.id, [user.id]);
      publishAfterCommit(c, 'project_deleted', id, { id }, { recipientUserIds: [user.id] });
      await publishProjectListItem(c, db, project, await fetchMembers(db, id));
      return c.body(null, 204);
    }

    const desired = [...new Set(user_ids ?? current.map((member) => member.user_id))].filter(
      (userId) => userId !== project.created_by
    );
    const desiredSet = new Set(desired);

    const roleByUser = new Map(
      (roles ?? [])
        .filter((entry) => entry.user_id !== project.created_by)
        .map((entry) => [entry.user_id, entry.role])
    );
    for (const userId of roleByUser.keys()) {
      if (!desiredSet.has(userId)) {
        throw new AppError(422, 'roles must reference users in the member set');
      }
    }

    const currentIds = new Set(current.map((member) => member.user_id));
    const added = desired.filter((userId) => !currentIds.has(userId));
    const removed = current
      .filter((member) => !desiredSet.has(member.user_id))
      .map((member) => member.user_id);
    // A retained member with no roles entry keeps their stored role, which is
    // what makes a user_ids-only body from an older client non-destructive.
    const roleChanges = current.flatMap((member) => {
      const next = roleByUser.get(member.user_id);
      return desiredSet.has(member.user_id) && next !== undefined && next !== member.role
        ? [{ user_id: member.user_id, role: next }]
        : [];
    });

    // Only the additions: existing rows already satisfy the member FK.
    if (added.length > 0) {
      const existingUsers = await db
        .selectFrom('app_user')
        .select('id')
        .where('id', 'in', added)
        .execute();
      if (existingUsers.length !== added.length) {
        throw new AppError(422, 'user_ids must reference existing users');
      }
    }

    if (removed.length > 0) {
      await removeMembers(c, db, project, user.id, removed);
    }

    if (added.length > 0) {
      await db
        .insertInto('project_member')
        .values(
          added.map((userId) => ({
            project_id: id,
            user_id: userId,
            role: roleByUser.get(userId) ?? 'editor',
          }))
        )
        .onConflict((oc) => oc.columns(['project_id', 'user_id']).doNothing())
        .execute();
    }

    for (const role of new Set(roleChanges.map((change) => change.role))) {
      await db
        .updateTable('project_member')
        .set({ role })
        .where('project_id', '=', id)
        .where(
          'user_id',
          'in',
          roleChanges.filter((change) => change.role === role).map((change) => change.user_id)
        )
        .execute();
    }

    // Removed members would fail the delivery access re-check, so their
    // eviction is a project_deleted with a snapshotted recipient list.
    if (removed.length > 0) {
      publishAfterCommit(c, 'project_deleted', id, { id }, { recipientUserIds: removed });
    }
    // A demotion keeps access, so the broadcast plus the per-event access
    // re-check is what re-renders an open client.
    await publishProjectListItem(c, db, project, await fetchMembers(db, id));

    return c.body(null, 204);
  }
);

router.post(
  '/:id/members/by-email',
  describeRoute({
    tags: ['Projects'],
    summary: 'Add project member by email',
    description:
      'Add a user to a project by their exact email (case-insensitive), as an editor unless ' +
      'role says otherwise. Editors may call; a viewer gets 403 and non-accessors 404. An ' +
      'unknown email returns 404. Adding an existing member is an idempotent no-op that ' +
      'changes their role only when role is given, so re-inviting never silently promotes a ' +
      'viewer. Adding the creator, who has implicit access and is always an editor, stores ' +
      'nothing. The response carries the effective role after the call.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The added (or already present) member',
        content: {
          'application/json': {
            schema: resolver(projectMemberUserResponseSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  jsonValidator(addProjectMemberByEmailSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { email, role } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    // Locked before the role is read: this write's target is the caller's own
    // authorization state, so a demotion committing against an unlocked read
    // would be undone by the upsert that follows it.
    const project = await lockProject(db, id);
    await assertCanWriteProject(db, user.id, project);

    const target = await db
      .selectFrom('app_user')
      .select(['id', 'email', 'name', 'avatar_storage_key'])
      .where((eb) => eb(eb.fn<string>('lower', ['email']), '=', email.toLowerCase()))
      .executeTakeFirst();
    if (!target) {
      throw new AppError(404, 'User not found');
    }

    let effectiveRole: ProjectRole = 'editor';
    if (target.id !== project.created_by) {
      await db
        .insertInto('project_member')
        .values({ project_id: id, user_id: target.id, role: role ?? 'editor' })
        .onConflict((oc) =>
          role === undefined
            ? oc.columns(['project_id', 'user_id']).doNothing()
            : oc.columns(['project_id', 'user_id']).doUpdateSet({ role })
        )
        .execute();
      const members = await fetchMembers(db, id);
      effectiveRole = members.find((member) => member.user_id === target.id)?.role ?? 'editor';
      await publishProjectListItem(c, db, project, members);
    }

    return c.json(
      {
        user: {
          id: target.id,
          email: target.email,
          name: target.name,
          avatar_url: avatarUrl(target.avatar_storage_key),
        },
        role: effectiveRole,
      },
      200
    );
  }
);

router.put(
  '/:id/owner',
  describeRoute({
    tags: ['Projects'],
    summary: 'Transfer project ownership',
    description:
      'Hand a project to another member. Only the current creator may call: other members with ' +
      'access get 403 and non-accessors get 404. user_id must already be a project member (422 ' +
      'otherwise). The incoming owner becomes created_by and their member row is dropped, so ' +
      'handing the project to a viewer promotes them — the creator is always an editor. The ' +
      'outgoing creator gains an ordinary editor member row and may then leave via ' +
      'PUT /:id/members. Passing your own id is a no-op. Task assignments are unaffected.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The project with its new owner',
        content: {
          'application/json': {
            schema: resolver(projectSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  jsonValidator(setProjectOwnerSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { user_id } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    await assertProjectWrite(db, user.id, id);
    const project = await lockProject(db, id);
    assertProjectOwnedBy(project, user.id, 'Only the project owner can transfer ownership');

    if (user_id === user.id) {
      return c.json(toProjectResponse(project, await fetchMembers(db, id)), 200);
    }

    if (!(await isProjectMember(db, id, user_id))) {
      throw new AppError(422, 'user_id must reference a project member');
    }

    const row = await db
      .updateTable('project')
      .set({ created_by: user_id })
      .where('id', '=', id)
      .returning(PROJECT_COLUMNS)
      .executeTakeFirstOrThrow();

    await db
      .deleteFrom('project_member')
      .where('project_id', '=', id)
      .where('user_id', '=', user_id)
      .execute();

    await db
      .insertInto('project_member')
      .values({ project_id: id, user_id: user.id, role: 'editor' })
      .onConflict((oc) => oc.columns(['project_id', 'user_id']).doUpdateSet({ role: 'editor' }))
      .execute();

    const members = await fetchMembers(db, id);
    await publishProjectListItem(c, db, row, members);
    return c.json(toProjectResponse(row, members), 200);
  }
);

export default router;
