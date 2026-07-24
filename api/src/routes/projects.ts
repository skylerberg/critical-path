import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import type { Kysely, Selectable, Updateable } from 'kysely';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import {
  accessibleProjectsFilter,
  assertProjectAccess,
  canAccessProject,
  isWorkspaceMember,
} from '../services/authorization';
import { stripAssigneesForProjectScope } from '../services/assigneeStrip';
import { getBoardPayload } from '../services/boardPayload';
import { copyProject } from '../services/projectCopy';
import { publishAfterCommit } from '../services/realtime/index';
import { fetchTaskRelations, publishTaskRelationsSet } from '../services/taskRelations';
import { storage } from '../services/storage/index';
import type { DB, Project } from '../db/types';
import {
  idSchema,
  projectSchema,
  projectsListResponseSchema,
  boardPayloadSchema,
  createProjectSchema,
  patchProjectSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
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

type ProjectRow = Pick<
  Selectable<Project>,
  'id' | 'name' | 'description' | 'archived_at' | 'created_at' | 'created_by' | 'workspace_id'
>;

const PROJECT_COLUMNS = [
  'id',
  'name',
  'description',
  'archived_at',
  'created_at',
  'created_by',
  'workspace_id',
] as const;

function toProjectResponse(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    archived_at: row.archived_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    created_by: row.created_by,
    workspace_id: row.workspace_id,
  };
}

// project_created/project_updated carry the projects-list item shape so a
// client that just gained visibility can upsert without a refetch.
async function fetchTaskCounts(
  db: Kysely<DB>,
  projectId: string
): Promise<{ open_task_count: number; done_task_count: number }> {
  const row = await db
    .selectFrom('task')
    .leftJoin('board_column', 'board_column.id', 'task.column_id')
    .select((eb) => [
      eb.fn
        .count<string>('task.id')
        .filterWhere(eb.not(eb.fn.coalesce('board_column.is_done', eb.val(false))))
        .as('open_task_count'),
      eb.fn
        .count<string>('task.id')
        .filterWhere('board_column.is_done', '=', true)
        .as('done_task_count'),
    ])
    .where('task.project_id', '=', projectId)
    .executeTakeFirstOrThrow();
  return {
    open_task_count: Number(row.open_task_count),
    done_task_count: Number(row.done_task_count),
  };
}

// The delivery layer's per-event access re-check would drop exactly these
// now-excluded users, so their removal event needs a snapshotted recipient list.
async function membersLosingAccess(
  db: Kysely<DB>,
  oldWorkspaceId: string,
  newWorkspaceId: string | null,
  createdBy: string | null
): Promise<string[]> {
  const oldMembers = await db
    .selectFrom('workspace_member')
    .select('user_id')
    .where('workspace_id', '=', oldWorkspaceId)
    .execute();
  const losing = new Set(oldMembers.map((member) => member.user_id));
  if (createdBy !== null) {
    losing.delete(createdBy);
  }
  if (newWorkspaceId !== null) {
    const newMembers = await db
      .selectFrom('workspace_member')
      .select('user_id')
      .where('workspace_id', '=', newWorkspaceId)
      .execute();
    for (const member of newMembers) {
      losing.delete(member.user_id);
    }
  }
  return [...losing];
}

const router: AppHono = new Hono();

router.get(
  '/',
  describeRoute({
    tags: ['Projects'],
    summary: 'List projects',
    description:
      'List projects the caller can access (created by them or shared via a workspace they ' +
      'belong to) with open and done task counts.',
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
      .select((eb) => [
        'project.id',
        'project.name',
        'project.description',
        'project.archived_at',
        'project.created_at',
        'project.created_by',
        'project.workspace_id',
        eb.fn
          .count<string>('task.id')
          .filterWhere(eb.not(eb.fn.coalesce('board_column.is_done', eb.val(false))))
          .as('open_task_count'),
        eb.fn
          .count<string>('task.id')
          .filterWhere('board_column.is_done', '=', true)
          .as('done_task_count'),
      ])
      .where(accessibleProjectsFilter(user.id))
      .groupBy('project.id')
      .orderBy('project.created_at')
      .orderBy('project.id')
      .execute();

    return c.json(
      {
        projects: rows.map((row) => ({
          ...toProjectResponse(row),
          open_task_count: Number(row.open_task_count),
          done_task_count: Number(row.done_task_count),
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
      'tasks, task labels, dependencies, and images — not assignees or archived state). ' +
      'Returns 422 when source_project_id does not reference an existing project and 404 ' +
      'when it references a project the caller cannot access.',
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
          .select(['created_by', 'workspace_id'])
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
      'plus image counts), and labels in one payload.',
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

router.patch(
  '/:id',
  describeRoute({
    tags: ['Projects'],
    summary: 'Update project',
    description:
      'Update project fields. Set archived_at to an ISO timestamp to archive or null to ' +
      'unarchive. Set workspace_id to share the project with a workspace the caller belongs ' +
      'to (422 otherwise) or null to make it personal; assignees who lose access under the ' +
      'new scope are removed from its tasks.',
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

    const project = await assertProjectAccess(db, user.id, id);

    const workspaceChanged =
      body.workspace_id !== undefined && body.workspace_id !== project.workspace_id;
    if (workspaceChanged && body.workspace_id !== null && body.workspace_id !== undefined) {
      if (!(await isWorkspaceMember(db, body.workspace_id, user.id))) {
        throw new AppError(422, 'workspace_id must reference a workspace you are a member of');
      }
    }

    const updates: Updateable<Project> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.archived_at !== undefined) updates.archived_at = body.archived_at;
    if (workspaceChanged) updates.workspace_id = body.workspace_id;

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

    if (workspaceChanged) {
      const stripped = await stripAssigneesForProjectScope(
        db,
        id,
        row.created_by,
        row.workspace_id
      );
      const strippedTaskIds = [...new Set(stripped.map((entry) => entry.task_id))];
      publishTaskRelationsSet(c, await fetchTaskRelations(db, strippedTaskIds));

      if (project.workspace_id !== null) {
        const losing = await membersLosingAccess(
          db,
          project.workspace_id,
          row.workspace_id,
          row.created_by
        );
        if (losing.length > 0) {
          publishAfterCommit(c, 'project_deleted', id, { id }, { recipientUserIds: losing });
        }
      }
    }

    publishAfterCommit(
      c,
      'project_updated',
      id,
      { ...toProjectResponse(row), ...(await fetchTaskCounts(db, id)) },
      { broadcast: true }
    );
    return c.json(toProjectResponse(row), 200);
  }
);

router.delete(
  '/:id',
  describeRoute({
    tags: ['Projects'],
    summary: 'Delete project',
    description:
      'Delete a project and everything in it. Stored image objects are removed after commit.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Project deleted',
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

    const project = await assertProjectAccess(db, user.id, id);

    // Snapshot who can see the project now; post-commit the rows backing the
    // access check are gone.
    const recipients = new Set<string>();
    if (project.created_by !== null) {
      recipients.add(project.created_by);
    }
    if (project.workspace_id !== null) {
      const members = await db
        .selectFrom('workspace_member')
        .select('user_id')
        .where('workspace_id', '=', project.workspace_id)
        .execute();
      for (const member of members) {
        recipients.add(member.user_id);
      }
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

export default router;
