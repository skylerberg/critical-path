import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { sql } from 'kysely';
import { jsonValidator } from '../middleware/jsonValidator';
import { AppError } from '../utils/errors';
import { recordBulkAssignments } from '../services/assignmentDigest';
import { assertProjectWrite, projectAccessIdsAmong } from '../services/authorization';
import { assertColumnInProject, lockColumnTail } from '../services/boardColumns';
import { getArchivedTasksByIds } from '../services/boardPayload';
import { syncCrossProjectBlockers } from '../services/crossProjectBlockers';
import { publishAfterCommit } from '../services/realtime/index';
import { recordAssigneeChanges, recordTaskActivity } from '../services/taskActivity';
import { fetchTaskRelations } from '../services/taskRelations';
import {
  applyTaskAssigneeDelta,
  applyTaskLabelDelta,
  loadBulkTargets,
  relocateSelectedTasks,
  type SetDelta,
} from '../services/taskBulk';
import {
  bulkTaskIdsSchema,
  bulkMoveTasksSchema,
  bulkTaskLabelsSchema,
  bulkTaskAssigneesSchema,
  bulkMovedTasksResponseSchema,
  bulkArchivedTasksResponseSchema,
  bulkTaskRelationsResponseSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  notFoundErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
  type BulkTaskRelations,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

const errorResponses = {
  ...badRequestErrorResponse,
  ...unauthorizedErrorResponse,
  ...forbiddenErrorResponse,
  ...notFoundErrorResponse,
  ...validationOrUnprocessableErrorResponse,
  ...internalServerErrorResponse,
};

const SKIPPED_NOTE =
  'Ids that are unknown, in another project, or (where noted) archived are reported in ' +
  '`skipped_task_ids` rather than failing the call, so one card changing underneath the ' +
  'caller never costs them the rest of the batch. Duplicate ids are applied once. Between 1 ' +
  'and 100 ids; anything else is a 422.';

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function changedTaskIds(delta: SetDelta, order: readonly string[]): string[] {
  const changed = new Set([...delta.added, ...delta.removed].map((pair) => pair.task_id));
  return order.filter((id) => changed.has(id));
}

// The relations reader carries the project id for the per-task publisher; the
// batched event is already scoped to one project, so it never reaches a client.
function toRelations(rows: Awaited<ReturnType<typeof fetchTaskRelations>>): BulkTaskRelations[] {
  return rows.map(
    ({ task_id, label_ids, assignee_ids, blocker_ids, open_cross_project_blocker_count }) => ({
      task_id,
      label_ids,
      assignee_ids,
      blocker_ids,
      open_cross_project_blocker_count,
    })
  );
}

router.post(
  '/bulk-move',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Move a selection of tasks to a column',
    description:
      'Move any number of a project’s tasks into one of its columns in a single transaction. ' +
      'The tasks are appended after the target column’s existing cards, keeping the order the ' +
      'ids were sent in, so the caller decides where the selection lands. Archived tasks are ' +
      'skipped: an archived card has no board position, and restoring one is contracted to ' +
      'return it to the column it was archived from. A card already in the target column is ' +
      're-stamped so the selection lands contiguous, but keeps its column_since and records no ' +
      'move in its activity log. A column_id outside the project returns 422, even when every ' +
      'task id was skipped. Emits one bulk_tasks_moved event and no per-task events. ' +
      SKIPPED_NOTE,
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The tasks that moved, with their new positions, plus what was skipped',
        content: {
          'application/json': { schema: resolver(bulkMovedTasksResponseSchema) },
        },
      },
      ...errorResponses,
    },
  }),
  jsonValidator(bulkMoveTasksSchema),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const project = await assertProjectWrite(db, user.id, body.project_id);
    // Before the row locks, not after: the column routes take this lock first
    // and reach the same rows through their own write, so acquiring the two in
    // the other order here deadlocks a drag against a column emptied into the
    // same place. Validating the target ahead of the early return keeps a bad
    // column the caller's mistake either way.
    const target = await assertColumnInProject(db, body.column_id, project.id);
    await lockColumnTail(db, target.id);

    const { rows, skipped } = await loadBulkTargets(db, project.id, body.task_ids, {
      liveOnly: true,
    });

    if (rows.length === 0) {
      return c.json({ moved_tasks: [], skipped_task_ids: skipped }, 200);
    }

    const moved_tasks = await relocateSelectedTasks(db, user.id, project.id, rows, target);
    // A selection can span columns on both sides of the done line, so unlike the
    // column-scoped moves there is no single before-state to compare against.
    await syncCrossProjectBlockers(c, db, { taskIds: moved_tasks.map((task) => task.id) });
    publishAfterCommit(c, 'bulk_tasks_moved', project.id, { moved_tasks });
    return c.json({ moved_tasks, skipped_task_ids: skipped }, 200);
  }
);

router.post(
  '/bulk-archive',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Archive a selection of tasks',
    description:
      'Archive any number of a project’s tasks in a single transaction: a soft delete that ' +
      'keeps the rows and their dependency edges but takes the cards out of the board payload, ' +
      'out of every blocker and dependent list, and out of the project task counts. Already ' +
      'archived ids keep their original archived_at, land in `skipped_task_ids`, and make a ' +
      'repeat call a no-op 200. The batch shares one archived_at, so the archive view breaks ' +
      'the tie on position and then id, which interleaves the columns of a selection that ' +
      'spans several. Emits one bulk_tasks_archived event and no per-task events. ' +
      SKIPPED_NOTE,
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Newly archived tasks in board-payload shape, plus what was skipped',
        content: {
          'application/json': { schema: resolver(bulkArchivedTasksResponseSchema) },
        },
      },
      ...errorResponses,
    },
  }),
  jsonValidator(bulkTaskIdsSchema),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const project = await assertProjectWrite(db, user.id, body.project_id);
    const { rows, skipped } = await loadBulkTargets(db, project.id, body.task_ids, {
      liveOnly: true,
    });

    if (rows.length === 0) {
      return c.json({ tasks: [], skipped_task_ids: skipped }, 200);
    }

    const taskIds = rows.map((row) => row.id);
    await db
      .updateTable('task')
      .set({ archived_at: sql<Date>`now()` })
      .where('task.project_id', '=', project.id)
      .where('task.id', 'in', taskIds)
      .where('task.archived_at', 'is', null)
      .execute();

    await recordTaskActivity(
      db,
      user.id,
      taskIds.map((taskId) => ({ taskId, kind: 'archived' as const }))
    );

    await syncCrossProjectBlockers(c, db, { taskIds });

    const tasks = await getArchivedTasksByIds(db, project.id, taskIds);
    publishAfterCommit(c, 'bulk_tasks_archived', project.id, { tasks });
    return c.json({ tasks, skipped_task_ids: skipped }, 200);
  }
);

router.post(
  '/bulk-labels',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Add or remove labels across a selection of tasks',
    description:
      'Apply a label delta to any number of a project’s tasks in a single transaction. This is ' +
      'an add/remove delta, never a replace: a selection rarely shares a label set, and ' +
      'replacing one from a client snapshot would strip every label the cards did not have in ' +
      'common. At least one of add_label_ids and remove_label_ids must be non-empty and the two ' +
      'must not overlap; both are 422. Ids in add_label_ids must be labels of the project (422 ' +
      'otherwise); ids in remove_label_ids are not validated, since removing an absent label is ' +
      'a no-op. Archived cards are labelled rather than skipped. A card the call applied to but ' +
      'did not change — it already carried the label — appears in neither list and writes no ' +
      'activity. The response carries the full label, assignee and blocker sets of every card ' +
      'that changed. Emits one bulk_tasks_relations_set event and no per-task events. ' +
      SKIPPED_NOTE,
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The relations of every card that changed, plus what was skipped',
        content: {
          'application/json': { schema: resolver(bulkTaskRelationsResponseSchema) },
        },
      },
      ...errorResponses,
    },
  }),
  jsonValidator(bulkTaskLabelsSchema),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const project = await assertProjectWrite(db, user.id, body.project_id);

    const add = dedupe(body.add_label_ids ?? []);
    const remove = dedupe(body.remove_label_ids ?? []);
    if (add.length === 0 && remove.length === 0) {
      throw new AppError(422, 'add_label_ids or remove_label_ids must be non-empty');
    }
    const overlap = new Set(remove);
    if (add.some((id) => overlap.has(id))) {
      throw new AppError(422, 'add_label_ids and remove_label_ids must not overlap');
    }

    if (add.length > 0) {
      const known = await db
        .selectFrom('label')
        .select('label.id')
        .where('label.id', 'in', add)
        .where('label.project_id', '=', project.id)
        .execute();
      if (known.length !== add.length) {
        throw new AppError(422, 'label_ids must reference labels in the project');
      }
    }

    const { rows, skipped } = await loadBulkTargets(db, project.id, body.task_ids);
    if (rows.length === 0) {
      return c.json({ tasks: [], skipped_task_ids: skipped }, 200);
    }

    const taskIds = rows.map((row) => row.id);
    const delta = await applyTaskLabelDelta(db, taskIds, add, remove);

    const touchedLabelIds = dedupe([...delta.added, ...delta.removed].map((pair) => pair.value));
    if (touchedLabelIds.length > 0) {
      const names = new Map(
        (
          await db
            .selectFrom('label')
            .select(['label.id', 'label.name'])
            .where('label.id', 'in', touchedLabelIds)
            .execute()
        ).map((label) => [label.id, label.name])
      );
      await recordTaskActivity(db, user.id, [
        ...delta.removed.map((pair) => ({
          taskId: pair.task_id,
          kind: 'label_removed' as const,
          oldValue: { id: pair.value, name: names.get(pair.value) ?? '' },
        })),
        ...delta.added.map((pair) => ({
          taskId: pair.task_id,
          kind: 'label_added' as const,
          newValue: { id: pair.value, name: names.get(pair.value) ?? '' },
        })),
      ]);
    }

    const changed = changedTaskIds(delta, taskIds);
    const tasks = toRelations(await fetchTaskRelations(db, changed));
    if (tasks.length > 0) {
      publishAfterCommit(c, 'bulk_tasks_relations_set', project.id, { tasks });
    }
    return c.json({ tasks, skipped_task_ids: skipped }, 200);
  }
);

router.post(
  '/bulk-assignees',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Add or remove assignees across a selection of tasks',
    description:
      'Apply an assignee delta to any number of a project’s tasks in a single transaction. Like ' +
      'the label delta this is add/remove, never a replace. At least one of add_user_ids and ' +
      'remove_user_ids must be non-empty and the two must not overlap; both are 422. Ids in ' +
      'add_user_ids must be users with access to the project (422 otherwise); ids in ' +
      'remove_user_ids are not validated. A bulk assignment sends no per-card email: each ' +
      'added user instead gets one digest naming how many cards they were handed, once their ' +
      'assigner has stopped for a couple of minutes, gated on their own bulk_task_assigned ' +
      'preference. Assigning yourself notifies nobody, and a copy notifies nobody either. ' +
      'A card the call applied to but did not change appears in neither list and writes no ' +
      'activity. Emits one bulk_tasks_relations_set event and no per-task events. ' +
      SKIPPED_NOTE,
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The relations of every card that changed, plus what was skipped',
        content: {
          'application/json': { schema: resolver(bulkTaskRelationsResponseSchema) },
        },
      },
      ...errorResponses,
    },
  }),
  jsonValidator(bulkTaskAssigneesSchema),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const project = await assertProjectWrite(db, user.id, body.project_id);

    const add = dedupe(body.add_user_ids ?? []);
    const remove = dedupe(body.remove_user_ids ?? []);
    if (add.length === 0 && remove.length === 0) {
      throw new AppError(422, 'add_user_ids or remove_user_ids must be non-empty');
    }
    const overlap = new Set(remove);
    if (add.some((id) => overlap.has(id))) {
      throw new AppError(422, 'add_user_ids and remove_user_ids must not overlap');
    }

    if (add.length > 0) {
      const withAccess = await projectAccessIdsAmong(db, project, add);
      if (withAccess.length !== add.length) {
        throw new AppError(
          422,
          'assignee user ids must reference users with access to the project'
        );
      }
    }

    const { rows, skipped } = await loadBulkTargets(db, project.id, body.task_ids);
    if (rows.length === 0) {
      return c.json({ tasks: [], skipped_task_ids: skipped }, 200);
    }

    const taskIds = rows.map((row) => row.id);
    const delta = await applyTaskAssigneeDelta(db, taskIds, add, remove);

    await recordAssigneeChanges(db, user.id, [
      ...delta.removed.map((pair) => ({
        taskId: pair.task_id,
        kind: 'assignee_removed' as const,
        userId: pair.value,
      })),
      ...delta.added.map((pair) => ({
        taskId: pair.task_id,
        kind: 'assignee_added' as const,
        userId: pair.value,
      })),
    ]);

    await recordBulkAssignments(c, {
      actorUserId: user.id,
      projectId: project.id,
      pairs: delta.added.map((pair) => ({ task_id: pair.task_id, user_id: pair.value })),
    });

    const changed = changedTaskIds(delta, taskIds);
    const tasks = toRelations(await fetchTaskRelations(db, changed));
    if (tasks.length > 0) {
      publishAfterCommit(c, 'bulk_tasks_relations_set', project.id, { tasks });
    }
    return c.json({ tasks, skipped_task_ids: skipped }, 200);
  }
);

export default router;
