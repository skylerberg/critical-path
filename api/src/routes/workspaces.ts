import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import type { Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { isWorkspaceMember } from '../services/authorization';
import { avatarUrl } from '../services/avatars';
import { stripAssigneesForRemovedMembers } from '../services/assigneeStrip';
import { publishAfterCommit } from '../services/realtime/index';
import { fetchTaskRelations, publishTaskRelationsSet } from '../services/taskRelations';
import {
  idSchema,
  workspaceSchema,
  workspacesListResponseSchema,
  createWorkspaceSchema,
  patchWorkspaceSchema,
  setWorkspaceMembersSchema,
  addWorkspaceMemberByEmailSchema,
  workspaceMemberUserResponseSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
  type WorkspaceResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

async function assertWorkspaceMember(
  db: Kysely<DB>,
  workspaceId: string,
  userId: string
): Promise<void> {
  if (!(await isWorkspaceMember(db, workspaceId, userId))) {
    throw new AppError(404, 'Workspace not found');
  }
}

async function fetchWorkspaceResponse(
  db: Kysely<DB>,
  workspaceId: string
): Promise<WorkspaceResponse | undefined> {
  const row = await db
    .selectFrom('workspace')
    .select((eb) => [
      'workspace.id',
      'workspace.name',
      'workspace.created_by',
      'workspace.created_at',
      jsonArrayFrom(
        eb
          .selectFrom('workspace_member')
          .select('workspace_member.user_id')
          .whereRef('workspace_member.workspace_id', '=', 'workspace.id')
          .orderBy('workspace_member.created_at')
          .orderBy('workspace_member.user_id')
      ).as('members'),
    ])
    .where('workspace.id', '=', workspaceId)
    .executeTakeFirst();

  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    name: row.name,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    member_ids: row.members.map((member) => member.user_id),
  };
}

router.get(
  '/',
  describeRoute({
    tags: ['Workspaces'],
    summary: 'List workspaces',
    description: 'List the workspaces the caller belongs to, including member ids.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Workspaces the caller belongs to',
        content: {
          'application/json': {
            schema: resolver(workspacesListResponseSchema),
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
      .selectFrom('workspace')
      .select((eb) => [
        'workspace.id',
        'workspace.name',
        'workspace.created_by',
        'workspace.created_at',
        jsonArrayFrom(
          eb
            .selectFrom('workspace_member')
            .select('workspace_member.user_id')
            .whereRef('workspace_member.workspace_id', '=', 'workspace.id')
            .orderBy('workspace_member.created_at')
            .orderBy('workspace_member.user_id')
        ).as('members'),
      ])
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('workspace_member')
            .select('workspace_member.user_id')
            .whereRef('workspace_member.workspace_id', '=', 'workspace.id')
            .where('workspace_member.user_id', '=', user.id)
        )
      )
      .orderBy('workspace.created_at')
      .orderBy('workspace.id')
      .execute();

    return c.json(
      {
        workspaces: rows.map((row) => ({
          id: row.id,
          name: row.name,
          created_by: row.created_by,
          created_at: row.created_at.toISOString(),
          member_ids: row.members.map((member) => member.user_id),
        })),
      },
      200
    );
  }
);

router.post(
  '/',
  describeRoute({
    tags: ['Workspaces'],
    summary: 'Create workspace',
    description:
      'Create a workspace. The client supplies the workspace id; the creator is added as ' +
      'its first member.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Created workspace',
        content: {
          'application/json': {
            schema: resolver(workspaceSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...conflictErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  jsonValidator(createWorkspaceSchema),
  async (c) => {
    const { id, name } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    let createdAt: Date;
    try {
      const row = await db
        .insertInto('workspace')
        .values({ id, name, created_by: user.id })
        .returning('created_at')
        .executeTakeFirstOrThrow();
      createdAt = row.created_at;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Workspace id already in use');
      }
      throw err;
    }

    await db
      .insertInto('workspace_member')
      .values({ workspace_id: id, user_id: user.id })
      .execute();

    const workspace = {
      id,
      name,
      created_by: user.id,
      created_at: createdAt.toISOString(),
      member_ids: [user.id],
    };
    publishAfterCommit(c, 'workspace_created', null, workspace, { workspaceId: id });
    return c.json(workspace, 201);
  }
);

router.patch(
  '/:id',
  describeRoute({
    tags: ['Workspaces'],
    summary: 'Rename workspace',
    description: 'Rename a workspace. Members only; non-members get 404.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated workspace',
        content: {
          'application/json': {
            schema: resolver(workspaceSchema),
          },
        },
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
  jsonValidator(patchWorkspaceSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    await assertWorkspaceMember(db, id, user.id);

    if (body.name !== undefined) {
      await db.updateTable('workspace').set({ name: body.name }).where('id', '=', id).execute();
    }

    const workspace = await fetchWorkspaceResponse(db, id);
    if (!workspace) {
      throw new AppError(404, 'Workspace not found');
    }
    publishAfterCommit(c, 'workspace_updated', null, workspace, { workspaceId: id });
    return c.json(workspace, 200);
  }
);

router.delete(
  '/:id',
  describeRoute({
    tags: ['Workspaces'],
    summary: 'Delete workspace',
    description:
      'Delete a workspace. Members only; non-members get 404. Its projects become personal ' +
      '(creator-only).',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Workspace deleted',
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

    await assertWorkspaceMember(db, id, user.id);

    // Snapshot the members in-transaction; the rows are gone post-commit.
    const memberRows = await db
      .selectFrom('workspace_member')
      .select('user_id')
      .where('workspace_id', '=', id)
      .execute();

    await db.deleteFrom('workspace').where('id', '=', id).execute();

    publishAfterCommit(
      c,
      'workspace_deleted',
      null,
      { id },
      { recipientUserIds: memberRows.map((row) => row.user_id) }
    );
    return c.body(null, 204);
  }
);

router.put(
  '/:id/members',
  describeRoute({
    tags: ['Workspaces'],
    summary: 'Set workspace members',
    description:
      'Replace the full member set of a workspace. Members only; non-members get 404. The ' +
      'set must include the caller and every id must reference an existing user (422 with a ' +
      'plain error body otherwise). Removed members lose their task assignments in the ' +
      'workspace’s projects unless they created the project.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Members set',
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
  jsonValidator(setWorkspaceMembersSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { user_ids } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    await assertWorkspaceMember(db, id, user.id);

    const desired = [...new Set(user_ids)];
    if (!desired.includes(user.id)) {
      throw new AppError(422, 'user_ids must include the caller');
    }

    const existingUsers = await db
      .selectFrom('app_user')
      .select('id')
      .where('id', 'in', desired)
      .execute();
    if (existingUsers.length !== desired.length) {
      throw new AppError(422, 'user_ids must reference existing users');
    }

    const currentRows = await db
      .selectFrom('workspace_member')
      .select('user_id')
      .where('workspace_id', '=', id)
      .execute();
    const current = new Set(currentRows.map((row) => row.user_id));
    const desiredSet = new Set(desired);
    const added = desired.filter((userId) => !current.has(userId));
    const removed = [...current].filter((userId) => !desiredSet.has(userId));

    if (removed.length > 0) {
      await db
        .deleteFrom('workspace_member')
        .where('workspace_id', '=', id)
        .where('user_id', 'in', removed)
        .execute();
      const stripped = await stripAssigneesForRemovedMembers(db, id, removed);
      const strippedTaskIds = [...new Set(stripped.map((entry) => entry.task_id))];
      publishTaskRelationsSet(c, await fetchTaskRelations(db, strippedTaskIds));
    }

    if (added.length > 0) {
      await db
        .insertInto('workspace_member')
        .values(added.map((userId) => ({ workspace_id: id, user_id: userId })))
        .onConflict((oc) => oc.columns(['workspace_id', 'user_id']).doNothing())
        .execute();
    }

    const workspace = await fetchWorkspaceResponse(db, id);
    if (workspace) {
      // Removed members must still hear about their removal, so the recipient
      // set is snapshotted instead of using a live membership check.
      publishAfterCommit(c, 'workspace_members_set', null, workspace, {
        recipientUserIds: [...new Set([...workspace.member_ids, ...removed])],
      });
    }

    return c.body(null, 204);
  }
);

router.post(
  '/:id/members/by-email',
  describeRoute({
    tags: ['Workspaces'],
    summary: 'Add workspace member by email',
    description:
      'Add a user to a workspace by their exact email (case-insensitive). Members only; ' +
      'non-members get 404. An unknown email returns 404. Adding an existing member is ' +
      'idempotent.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The added (or already present) member',
        content: {
          'application/json': {
            schema: resolver(workspaceMemberUserResponseSchema),
          },
        },
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
  jsonValidator(addWorkspaceMemberByEmailSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { email } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    await assertWorkspaceMember(db, id, user.id);

    const target = await db
      .selectFrom('app_user')
      .select(['id', 'email', 'name', 'avatar_storage_key'])
      .where((eb) => eb(eb.fn<string>('lower', ['email']), '=', email.toLowerCase()))
      .executeTakeFirst();
    if (!target) {
      throw new AppError(404, 'User not found');
    }

    await db
      .insertInto('workspace_member')
      .values({ workspace_id: id, user_id: target.id })
      .onConflict((oc) => oc.columns(['workspace_id', 'user_id']).doNothing())
      .execute();

    const workspace = await fetchWorkspaceResponse(db, id);
    if (workspace) {
      publishAfterCommit(c, 'workspace_members_set', null, workspace, {
        recipientUserIds: workspace.member_ids,
      });
    }

    return c.json(
      {
        user: {
          id: target.id,
          email: target.email,
          name: target.name,
          avatar_url: avatarUrl(target.avatar_storage_key),
        },
      },
      200
    );
  }
);

export default router;
