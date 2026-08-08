import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { sql } from 'kysely';
import type { Updateable } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { jsonValidator } from '../middleware/jsonValidator';
import {
  assertInvitationSendBudget,
  enforceInvitationLookupRateLimit,
  enforceInvitationResendRateLimit,
  enforceInvitationSendRateLimit,
} from '../services/rateLimit';
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
import { attachmentStorageKeys } from '../services/attachments/index';
import {
  crossProjectDependentsOf,
  publishCrossProjectBlockerCounts,
  refreshCrossProjectBlockerCounts,
} from '../services/crossProjectBlockers';
import { avatarUrl } from '../services/avatars';
import { getArchivedTasks, getBoardPayload } from '../services/boardPayload';
import { exportFilename, projectExportArchive } from '../services/export/archive';
import { buildProjectExport } from '../services/export/payload';
import { notify } from '../services/notifications';
import { copyProject } from '../services/projectCopy';
import { lockProject } from '../services/projectLock';
import {
  INVITATION_COLUMNS,
  MAX_PENDING_INVITATIONS_PER_PROJECT,
  enqueueInvitationEmail,
  invitationExpiry,
  invitationTokenHash,
  publishInvitationsChanged,
  revokeInvitationsFromNonEditors,
  toInvitationResponse,
} from '../services/invitations';
import {
  PROJECT_COLUMNS,
  fetchMembers,
  publishProjectListItem,
  toMemberEntries,
  toProjectResponse,
} from '../services/projectListItem';
import { removeProjectMembers } from '../services/projectMembers';
import { changedTaskIds, hasUnseenChanges } from '../services/projectSeen';
import { publishAfterCommit } from '../services/realtime/index';
import { keysBetween, resolveSortKey } from '../services/sortKey';
import { deleteStoredObjectsAfterCommit } from '../services/storage/cleanup';
import type { Project } from '../db/types';
import {
  idSchema,
  projectSchema,
  projectsListResponseSchema,
  boardResponseSchema,
  archivedTasksResponseSchema,
  createProjectSchema,
  patchProjectSchema,
  setProjectPositionSchema,
  setProjectMembersSchema,
  setProjectOwnerSchema,
  addProjectMemberByEmailSchema,
  addMemberByEmailResponseSchema,
  projectInvitationParamsSchema,
  projectInvitationsResponseSchema,
  projectExportQuerySchema,
  projectExportSchema,
  jsonResponse,
  emptyResponse,
  rawResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  positionConflictErrorResponse,
  payloadTooLargeErrorResponse,
  validationErrorResponse,
  validationOrUnprocessableErrorResponse,
  tooManyRequestsErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const DEFAULT_COLUMNS = [
  { name: 'Backlog', is_done: false },
  { name: 'To Do', is_done: false },
  { name: 'In Progress', is_done: false },
  { name: 'Done', is_done: true },
];

const router: AppHono = new Hono();

const listProjectsResponses = {
  200: jsonResponse('Accessible projects with task counts', projectsListResponseSchema),
};

router.get(
  '/',
  describeRoute({
    tags: ['Projects'],
    summary: 'List projects',
    description:
      'List projects the caller can access (created by them or shared with them as a member) ' +
      "with member ids, member roles, open and done task counts, and the caller's personal sort position " +
      '(null when never set). Archived tasks count toward neither total. Ordered by position ' +
      '(nulls last), then created_at, then id. last_seen_at is when the caller last opened the ' +
      'board (null until they have), and has_unseen_changes says whether a live card in an ' +
      'unarchived project has been commented on or logged activity by somebody else since ' +
      'then — so a board the caller has never opened reports false, not everything.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...listProjectsResponses,
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  async (c): Promise<Returned<typeof listProjectsResponses>> => {
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
      .leftJoin('project_user_seen', (join) =>
        join
          .onRef('project_user_seen.project_id', '=', 'project.id')
          .on('project_user_seen.user_id', '=', user.id)
      )
      .select((eb) => [
        'project.id',
        'project.name',
        'project.description',
        'project.archived_at',
        'project.created_at',
        'project.created_by',
        'project.is_public',
        'project.color',
        'project_user_position.sort_key',
        'project_user_seen.last_seen_at',
        hasUnseenChanges(user.id).as('has_unseen_changes'),
        jsonArrayFrom(
          eb
            .selectFrom('project_member')
            .select(['project_member.user_id', 'project_member.role'])
            .whereRef('project_member.project_id', '=', 'project.id')
            .orderBy('project_member.created_at')
            .orderBy('project_member.user_id')
        ).as('member_rows'),
        // Excluded inside the aggregate, never in the outer where: that would
        // turn the left joins into inner ones and drop every project whose
        // tasks are all archived.
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
      .groupBy(['project.id', 'project_user_position.sort_key', 'project_user_seen.last_seen_at'])
      .orderBy('project_user_position.sort_key', (ob) => ob.asc().nullsLast())
      .orderBy('project.created_at')
      .orderBy('project.id')
      .execute();

    return c.json(
      {
        projects: rows.map((row) => ({
          ...toProjectResponse(row, toMemberEntries(row.member_rows)),
          open_task_count: Number(row.open_task_count),
          done_task_count: Number(row.done_task_count),
          sort_key: row.sort_key,
          last_seen_at: row.last_seen_at?.toISOString() ?? null,
          has_unseen_changes: row.has_unseen_changes,
        })),
      },
      200
    );
  }
);

const createProjectResponses = {
  201: jsonResponse('Created project as a full board payload', boardResponseSchema),
};

router.post(
  '/',
  describeRoute({
    tags: ['Projects'],
    summary: 'Create project',
    description:
      'Create a project with the default Backlog / To Do / In Progress / Done columns, or ' +
      'deep-copy an existing project by passing source_project_id (copies columns, labels, ' +
      'tasks, task labels, dependencies, images, and recurring series with their templates — ' +
      'not comments, assignees, members, archived cards, the accent colour, or the archived ' +
      'state of the project itself; copies start personal). A copied series keeps the ' +
      'source’s status and schedules its next occurrence from today, so it behaves like the ' +
      'original without firing an occurrence the source already missed. ' +
      'Returns 422 when source_project_id does not ' +
      'reference an existing project and 404 when it references a project the caller cannot access.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...createProjectResponses,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(createProjectSchema),
  async (c): Promise<Returned<typeof createProjectResponses>> => {
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

        const columnKeys = keysBetween(null, null, DEFAULT_COLUMNS.length);
        await db
          .insertInto('board_column')
          .values(
            DEFAULT_COLUMNS.map((column, index) => ({
              id: crypto.randomUUID(),
              project_id: body.id,
              name: column.name,
              sort_key: columnKeys[index]!,
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
    return c.json(
      { ...payload, changed_task_ids: await changedTaskIds(db, body.id, user.id) },
      201
    );
  }
);

const getBoardResponses = { 200: jsonResponse('Board payload', boardResponseSchema) };

router.get(
  '/:id',
  describeRoute({
    tags: ['Projects'],
    summary: 'Get board payload',
    description:
      'Get a project with its columns, tasks (including label, assignee, and blocker ids ' +
      'plus image counts), and labels in one payload. Archived tasks are excluded, as are ' +
      'archived tasks appearing as blockers of the tasks that are included. ' +
      'changed_task_ids names the tasks in this payload that somebody else commented on or ' +
      'logged activity for since the caller last stamped the board with PUT /:id/seen, and is ' +
      'empty for a caller who never has. Reading the board does not stamp it.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...getBoardResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof getBoardResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const payload = await getBoardPayload(db, id);
    if (!payload || !(await canAccessProject(db, user.id, payload.project))) {
      throw new AppError(404, 'Project not found');
    }
    return c.json({ ...payload, changed_task_ids: await changedTaskIds(db, id, user.id) }, 200);
  }
);

const listArchivedTasksResponses = {
  200: jsonResponse('Archived tasks, newest first', archivedTasksResponseSchema),
};

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
      ...listArchivedTasksResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof listArchivedTasksResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    await assertProjectAccess(db, c.get('user').id, id);

    return c.json({ tasks: await getArchivedTasks(db, id) }, 200);
  }
);

const exportProjectResponses = {
  200: rawResponse({
    description: 'Project export archive, or the manifest alone with format=json',
    content: {
      'application/json': {
        schema: resolver(projectExportSchema),
      },
      'application/zip': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  }),
};

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
      '/api/images/<uuid> sources resolve by id against the entries of tasks[].attachments[] ' +
      'whose kind is image, and each such entry carries the archive-relative path of its file. ' +
      'Every project member may export; the export is free and never gated. A project whose ' +
      'images would exceed the 4 GiB zip ceiling answers 413 and must be exported with ' +
      'format=json, which carries no stored bytes — fetch each image from GET /api/images/{id} ' +
      'by the id of its tasks[].attachments[] entry.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...exportProjectResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...payloadTooLargeErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  queryValidator(projectExportQuerySchema),
  async (c): Promise<Returned<typeof exportProjectResponses>> => {
    const { id } = c.req.valid('param');
    const { format } = c.req.valid('query');
    const db = c.get('db');
    const user = c.get('user');

    // One reading, so the manifest timestamp and the filename date agree.
    const now = new Date();

    // One snapshot: under read committed a concurrent edit lands between two of
    // these reads and the archive is permanently self-inconsistent. It closes
    // here — the body must not hold a connection while it streams.
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
    const { exportPayload, attachments } = snapshot;

    if (format === 'json') {
      return c.json(exportPayload, 200);
    }

    const archive = projectExportArchive(exportPayload, attachments, now);
    c.header('Content-Type', 'application/zip');
    c.header(
      'Content-Disposition',
      `attachment; filename="${exportFilename(exportPayload.project.name, now)}"`
    );
    return c.body(archive, 200);
  }
);

const patchProjectResponses = { 200: jsonResponse('Updated project', projectSchema) };

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
      'project id and no account. Set it back to false to stop serving it. Set color to one of ' +
      'the fixed accent keys to mark the board across every surface that lists it, or null for ' +
      'no colour; the choice is shared with everyone who can see the board and rides the ' +
      'project_updated realtime and webhook events. The public board never carries it. ' +
      'Editors only: a viewer gets 403 and non-accessors 404.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...patchProjectResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(patchProjectSchema),
  async (c): Promise<Returned<typeof patchProjectResponses>> => {
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
    if (body.color !== undefined) updates.color = body.color;

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

const deleteProjectResponses = { 204: emptyResponse('Project deleted') };

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
      ...deleteProjectResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof deleteProjectResponses>> => {
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

    const attachmentKeys = await attachmentStorageKeys(db, { projectId: id });

    // Read before the cascade takes the edges: the tasks these blocked live in
    // projects that survive, and their counts have to come down with the work
    // that was blocking them.
    const remoteDependents = await crossProjectDependentsOf(db, { projectIds: [id] });

    const result = await db.deleteFrom('project').where('id', '=', id).executeTakeFirst();
    if (result.numDeletedRows === 0n) {
      throw new AppError(404, 'Project not found');
    }

    // No recipient snapshot, unlike project_deleted: these events land on
    // projects that still exist, so the delivery layer's live access re-check
    // is exactly right.
    publishCrossProjectBlockerCounts(
      c,
      await refreshCrossProjectBlockerCounts(
        db,
        remoteDependents.map((dependent) => dependent.task_id)
      )
    );

    deleteStoredObjectsAfterCommit(c, attachmentKeys);

    publishAfterCommit(c, 'project_deleted', id, { id }, { recipientUserIds: [...recipients] });
    return c.body(null, 204);
  }
);

const setProjectPositionResponses = { 204: emptyResponse('Position set') };

router.put(
  '/:id/position',
  describeRoute({
    tags: ['Projects'],
    summary: 'Set project position',
    description:
      "Set the caller's personal sort position for a project. Positions are per user and " +
      'order the project list for the caller only; other members are unaffected. A sort_key ' +
      'already taken among the caller’s positions ranks the project immediately after the one ' +
      'holding it, so the stored key is not always the one that was sent; the ' +
      'project_position_updated event carries the key that was stored.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...setProjectPositionResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...positionConflictErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(setProjectPositionSchema),
  async (c): Promise<Returned<typeof setProjectPositionResponses>> => {
    const { id } = c.req.valid('param');
    const { sort_key } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    await assertProjectAccess(db, user.id, id);

    // The list the client ranks against carries the projects it has never
    // positioned, which hold no key at all, so a drag routinely re-stamps the
    // whole list and asks for keys its neighbours are still on.
    const resolved = await resolveSortKey(db, 'project_user_position', user.id, sort_key);

    try {
      await db
        .insertInto('project_user_position')
        .values({ user_id: user.id, project_id: id, sort_key: resolved })
        .onConflict((oc) =>
          oc.columns(['user_id', 'project_id']).doUpdateSet({ sort_key: resolved })
        )
        .execute();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'That position was taken while the move was in flight');
      }
      throw err;
    }

    // Per-user data: exact recipients sync the caller's other devices without
    // reshuffling anything for other members.
    publishAfterCommit(
      c,
      'project_position_updated',
      id,
      { id, sort_key: resolved },
      { recipientUserIds: [user.id] }
    );
    return c.body(null, 204);
  }
);

const markProjectSeenResponses = { 204: emptyResponse('Marker moved') };

router.put(
  '/:id/seen',
  describeRoute({
    tags: ['Projects'],
    summary: 'Mark project seen',
    description:
      "Move the caller's marker for a project to now, so nothing already in it counts as an " +
      'unseen change any more. Per user and invisible to everyone else; any member may call, ' +
      'viewers included, and non-accessors get 404. Archiving does not stop it. Only this ' +
      'endpoint stamps — reading the board, the export or a webhook never does, so a script ' +
      'cannot clear somebody else’s dot.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...markProjectSeenResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof markProjectSeenResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    await assertProjectAccess(db, user.id, id);

    // Deliberately takes no project lock, so a board open never queues behind an
    // unrelated member edit. The removal that deletes these rows under the
    // project lock cannot deadlock with it: this row is invisible to that delete
    // until it commits, so the delete never waits on it.
    await db
      .insertInto('project_user_seen')
      .values({ user_id: user.id, project_id: id })
      .onConflict((oc) =>
        oc.columns(['user_id', 'project_id']).doUpdateSet({ last_seen_at: sql`now()` })
      )
      .execute();

    // Per-user data: exact recipients clear the dot on the caller's other
    // devices without touching anyone else's.
    publishAfterCommit(c, 'project_seen', id, { id }, { recipientUserIds: [user.id] });
    return c.body(null, 204);
  }
);

const setProjectMembersResponses = { 204: emptyResponse('Members set') };

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
      'role. Removed members lose their task assignments in the project, and pending ' +
      'invitations sent by anyone this leaves without write access are revoked with it.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...setProjectMembersResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(setProjectMembersSchema),
  async (c): Promise<Returned<typeof setProjectMembersResponses>> => {
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
    // user-existence check below and read it as an oracle, nor evict anyone else
    // with a stale cached member list.
    if (callerRole !== 'editor') {
      // `roles` is refused rather than ignored: leaving is the only thing this
      // can mean for a viewer, and 204 would report a role change that never
      // happened.
      if (user_ids === undefined || user_ids.includes(user.id) || roles !== undefined) {
        throw new AppError(403, READ_ONLY_MESSAGE);
      }
      await removeProjectMembers(c, db, project, user.id, [user.id]);
      publishAfterCommit(c, 'project_deleted', id, { id }, { recipientUserIds: [user.id] });
      const remaining = await fetchMembers(db, id);
      await revokeInvitationsFromNonEditors(c, db, id, project.created_by, remaining);
      await publishProjectListItem(c, db, project, remaining);
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
      await removeProjectMembers(c, db, project, user.id, removed);
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

    // Only the additions: a role change and a removal are not an invitation.
    await notify(c, {
      kind: 'added_to_project',
      actor: user,
      project,
      recipientUserIds: added,
    });

    // Removed members would fail the delivery access re-check, so their
    // eviction is a project_deleted with a snapshotted recipient list.
    if (removed.length > 0) {
      publishAfterCommit(c, 'project_deleted', id, { id }, { recipientUserIds: removed });
    }
    const remaining = await fetchMembers(db, id);
    await revokeInvitationsFromNonEditors(c, db, id, project.created_by, remaining);
    // A demotion keeps access, so the broadcast is what re-renders an open
    // client.
    await publishProjectListItem(c, db, project, remaining);

    return c.body(null, 204);
  }
);

const addProjectMemberByEmailResponses = {
  200: jsonResponse(
    'The added member, or the pending invitation that was created',
    addMemberByEmailResponseSchema
  ),
};

router.post(
  '/:id/members/by-email',
  describeRoute({
    tags: ['Projects'],
    summary: 'Add project member by email',
    description:
      'Share a project with one exact, case-insensitive email address. When the address ' +
      'already has an account the user is added immediately and the response is ' +
      'status "member": adding an existing member is an idempotent no-op that changes ' +
      'their role only when role is given, so re-inviting never silently promotes a viewer, ' +
      'and adding the creator (implicit access, always an editor) stores nothing. When the ' +
      'address has no account a pending invitation is created instead and the response is ' +
      'status "invited"; the invitation is emailed a link and takes effect when the ' +
      'recipient signs up with that address or accepts the link, whichever comes first. ' +
      'role defaults to editor and is the effective role either way. The invitation token ' +
      'is never returned. Unlike other POSTs this one takes no client-supplied id: the ' +
      'invitation is keyed by project and address, which the client already supplies, and ' +
      'whether a row is created at all depends on server state the client cannot see, so ' +
      'there is nothing to render optimistically. A pending invitation for an address that ' +
      'has since gained an account is dropped as the member is added, since only signup ' +
      'claims one. 422 past 100 pending invitations on the project (expired ones count ' +
      'until they are revoked). Two hourly budgets answer 429: 100 addresses looked up per ' +
      'caller, which every call spends whether or not the address has an account, and 20 ' +
      'invitation emails per caller, which only a call that actually sends one spends — so ' +
      'adding people who already have accounts never runs the mail budget down, though once ' +
      'that budget is gone every call answers 429 until the hour is out, whatever the address, ' +
      'rather than letting the 429 itself say which addresses have accounts. A third limit ' +
      'allows three re-mails an hour of any one address. Editors may call; a viewer gets 403 ' +
      'and non-accessors 404.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...addProjectMemberByEmailResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...tooManyRequestsErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(addProjectMemberByEmailSchema),
  async (c): Promise<Returned<typeof addProjectMemberByEmailResponses>> => {
    const { id } = c.req.valid('param');
    const { email, role } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    // Locked before the role is read: this write's target is the caller's own
    // authorization state, so a demotion committing against an unlocked read
    // would be undone by the upsert below. It also serializes two editors
    // inviting the same address.
    const project = await lockProject(db, id);
    await assertCanWriteProject(db, user.id, project);

    // Both budgets settle before the address is looked up, and both act whatever
    // the answer, so neither the reply nor the 429 tells an address with an
    // account from one without.
    await enforceInvitationLookupRateLimit(user.id);
    await assertInvitationSendBudget(user.id);

    const emailLower = email.toLowerCase();
    const target = await db
      .selectFrom('app_user')
      .select(['id', 'name', 'avatar_storage_key'])
      .where((eb) => eb(eb.fn<string>('lower', ['email']), '=', emailLower))
      .executeTakeFirst();

    if (target) {
      // Signup is the sole claimer and this address already has an account, so
      // nothing will ever consume the row — while its link stays redeemable by
      // anyone holding it.
      const dropped = await db
        .deleteFrom('project_invitation')
        .where('project_id', '=', id)
        .where('email_lower', '=', emailLower)
        .executeTakeFirst();
      if (dropped.numDeletedRows > 0n) {
        publishInvitationsChanged(c, id);
      }

      let effectiveRole: ProjectRole = 'editor';
      if (target.id !== project.created_by) {
        // Read under the lock, so a re-invite that only changes a role is
        // distinguishable from one that actually granted access.
        const alreadyMember = await isProjectMember(db, id, target.id);
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
        if (!alreadyMember) {
          await notify(c, {
            kind: 'added_to_project',
            actor: user,
            project,
            recipientUserIds: [target.id],
          });
        }
      }

      return c.json(
        {
          status: 'member' as const,
          role: effectiveRole,
          user: {
            id: target.id,
            name: target.name,
            avatar_url: avatarUrl(target.avatar_storage_key),
          },
          invitation: null,
        },
        200
      );
    }

    const existing = await db
      .selectFrom('project_invitation')
      .select('id')
      .where('project_id', '=', id)
      .where('email_lower', '=', emailLower)
      .executeTakeFirst();

    if (existing === undefined) {
      const { total } = await db
        .selectFrom('project_invitation')
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .where('project_id', '=', id)
        .executeTakeFirstOrThrow();
      if (Number(total) >= MAX_PENDING_INVITATIONS_PER_PROJECT) {
        throw new AppError(422, 'This project has too many pending invitations');
      }
    } else {
      // Re-inviting re-mails the identical link, so it answers to the same
      // per-invitation budget a resend does.
      await enforceInvitationResendRateLimit(existing.id);
    }
    await enforceInvitationSendRateLimit(user.id);

    // Reusing the id keeps the link already in the recipient's mailbox working,
    // and lets both branches store the hash of the link actually mailed — a
    // re-invite under a rotated signing secret otherwise stores neither.
    const invitationId = existing?.id ?? crypto.randomUUID();
    const row = await db
      .insertInto('project_invitation')
      .values({
        id: invitationId,
        project_id: id,
        email,
        role: role ?? 'editor',
        invited_by: user.id,
        token_hash: invitationTokenHash(invitationId),
        expires_at: invitationExpiry(),
      })
      .onConflict((oc) =>
        oc.columns(['project_id', 'email_lower']).doUpdateSet({
          expires_at: invitationExpiry(),
          token_hash: invitationTokenHash(invitationId),
          ...(role === undefined ? {} : { role }),
        })
      )
      .returning(INVITATION_COLUMNS)
      .executeTakeFirstOrThrow();

    const invitation = toInvitationResponse(row);
    enqueueInvitationEmail(c, invitation, project.name, user.name);
    publishInvitationsChanged(c, id);

    return c.json(
      { status: 'invited' as const, role: invitation.role, user: null, invitation },
      200
    );
  }
);

const listProjectInvitationsResponses = {
  200: jsonResponse('The project’s pending invitations', projectInvitationsResponseSchema),
};

router.get(
  '/:id/invitations',
  describeRoute({
    tags: ['Projects'],
    summary: 'List pending project invitations',
    description:
      'List the invitations outstanding on a project — addresses invited to share it that ' +
      'have no account yet. Expired invitations stay listed with their expires_at so they ' +
      'can be resent or revoked rather than silently vanishing. Invitation tokens are never ' +
      'returned. Editors only: the list is a management surface made entirely of email ' +
      'addresses that only editors can create, so a viewer gets 403 and non-accessors 404.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...listProjectInvitationsResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof listProjectInvitationsResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    await assertProjectWrite(db, c.get('user').id, id);

    const rows = await db
      .selectFrom('project_invitation')
      .select(INVITATION_COLUMNS)
      .where('project_id', '=', id)
      .orderBy('created_at')
      .orderBy('id')
      .execute();

    return c.json({ invitations: rows.map(toInvitationResponse) }, 200);
  }
);

const revokeProjectInvitationResponses = { 204: emptyResponse('Invitation revoked') };

router.delete(
  '/:id/invitations/:invitationId',
  describeRoute({
    tags: ['Projects'],
    summary: 'Revoke a project invitation',
    description:
      'Withdraw a pending invitation. Every copy of its link stops working at once, ' +
      'including one already sitting in the recipient’s mailbox, because redemption always ' +
      'consults the row. 404 when the project has no such invitation. Editors only.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...revokeProjectInvitationResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(projectInvitationParamsSchema),
  async (c): Promise<Returned<typeof revokeProjectInvitationResponses>> => {
    const { id, invitationId } = c.req.valid('param');
    const db = c.get('db');

    await assertProjectWrite(db, c.get('user').id, id);
    await lockProject(db, id);

    const deleted = await db
      .deleteFrom('project_invitation')
      .where('id', '=', invitationId)
      .where('project_id', '=', id)
      .executeTakeFirst();
    if (deleted.numDeletedRows === 0n) {
      throw new AppError(404, 'Invitation not found');
    }
    publishInvitationsChanged(c, id);

    return c.body(null, 204);
  }
);

const resendProjectInvitationResponses = { 204: emptyResponse('Invitation resent') };

router.post(
  '/:id/invitations/:invitationId/resend',
  describeRoute({
    tags: ['Projects'],
    summary: 'Resend a project invitation',
    description:
      'Email a pending invitation again and give it a fresh 14-day deadline, which is also ' +
      'how an expired invitation is revived. The link is unchanged, so the copy the ' +
      'recipient already has keeps working. 404 when the project has no such invitation, ' +
      '429 past three resends an hour for one invitation or past the caller’s hourly ' +
      'budget of invitation emails. Editors only.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...resendProjectInvitationResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...tooManyRequestsErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(projectInvitationParamsSchema),
  async (c): Promise<Returned<typeof resendProjectInvitationResponses>> => {
    const { id, invitationId } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const project = await assertProjectWrite(db, user.id, id);

    const existing = await db
      .selectFrom('project_invitation')
      .select(['id', 'email'])
      .where('id', '=', invitationId)
      .where('project_id', '=', id)
      .executeTakeFirst();
    if (!existing) {
      throw new AppError(404, 'Invitation not found');
    }

    // Refused before anything is spent: a re-mail unit burned by a resend the
    // mail budget was never going to allow outlives the budget that refused it.
    await assertInvitationSendBudget(user.id);
    await enforceInvitationResendRateLimit(invitationId);
    await enforceInvitationSendRateLimit(user.id);

    await db
      .updateTable('project_invitation')
      // Re-derived rather than left alone: a rotation of the signing secret
      // would otherwise strand every outstanding row unredeemable.
      .set({ expires_at: invitationExpiry(), token_hash: invitationTokenHash(invitationId) })
      .where('id', '=', invitationId)
      .execute();

    enqueueInvitationEmail(c, existing, project.name, user.name);
    publishInvitationsChanged(c, id);

    return c.body(null, 204);
  }
);

const transferProjectOwnerResponses = {
  200: jsonResponse('The project with its new owner', projectSchema),
};

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
      ...transferProjectOwnerResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(setProjectOwnerSchema),
  async (c): Promise<Returned<typeof transferProjectOwnerResponses>> => {
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
