import type { Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';
import type {
  ArchivedTask,
  BoardPayload,
  BoardTask,
  PublicBoard,
  PublicBoardUser,
  TiptapDoc,
} from '../schemas/index';
import { assertPublicProject, usersWithProjectAccess } from './authorization';
import { MIRRORED_IMAGE_KIND } from './attachments/index';
import { normalizeProjectAccent, toMemberEntries } from './projectListItem';
import { dueDateText } from './dueDate';
import { unarchivedBlockerIds } from './taskRelations';

function boardTasksQuery(db: Kysely<DB>) {
  return db.selectFrom('task').select((eb) => [
    'task.id',
    'task.project_id',
    'task.column_id',
    'task.title',
    'task.description',
    'task.position',
    'task.sort_key',
    dueDateText.as('due_date'),
    'task.created_at',
    'task.updated_at',
    'task.column_since',
    'task.archived_at',
    jsonArrayFrom(
      eb
        .selectFrom('task_label')
        .select('task_label.label_id')
        .whereRef('task_label.task_id', '=', 'task.id')
        .orderBy('task_label.label_id')
    ).as('label_rows'),
    jsonArrayFrom(
      eb
        .selectFrom('task_assignee')
        .select('task_assignee.user_id')
        .whereRef('task_assignee.task_id', '=', 'task.id')
        .orderBy('task_assignee.user_id')
    ).as('assignee_rows'),
    unarchivedBlockerIds(eb).as('blocker_rows'),
    eb
      .selectFrom('task_image')
      .select((ib) => ib.fn.countAll<string>().as('image_count'))
      .whereRef('task_image.task_id', '=', 'task.id')
      .as('image_count'),
    eb
      .selectFrom('task_image')
      .select('task_image.id')
      .whereRef('task_image.task_id', '=', 'task.id')
      .where('task_image.is_cover', '=', true)
      .as('cover_image_id'),
    eb
      .selectFrom('task_comment')
      .select((cb) => cb.fn.countAll<string>().as('comment_count'))
      .whereRef('task_comment.task_id', '=', 'task.id')
      .as('comment_count'),
    eb
      .selectFrom('checklist_item')
      .select((kb) => kb.fn.countAll<string>().as('checklist_item_count'))
      .whereRef('checklist_item.task_id', '=', 'task.id')
      .as('checklist_item_count'),
    eb
      .selectFrom('checklist_item')
      .select((kb) => kb.fn.countAll<string>().as('checklist_done_count'))
      .whereRef('checklist_item.task_id', '=', 'task.id')
      .where('checklist_item.checked', '=', true)
      .as('checklist_done_count'),
    eb
      .selectFrom('task_attachment')
      .select((ab) => ab.fn.countAll<string>().as('attachment_count'))
      .whereRef('task_attachment.task_id', '=', 'task.id')
      .where('task_attachment.kind', '<>', MIRRORED_IMAGE_KIND)
      .as('attachment_count'),
  ]);
}

// A sort key only orders a task against its own column's, so a project-wide
// list has to sort by the column first. `position` used to be globally
// comparable and hid this.
function projectTasksQuery(db: Kysely<DB>, projectId: string) {
  return boardTasksQuery(db)
    .innerJoin('board_column', 'board_column.id', 'task.column_id')
    .where('task.project_id', '=', projectId);
}

type ProjectTaskRow = Awaited<ReturnType<ReturnType<typeof boardTasksQuery>['execute']>>[number];

function toBoardTask(task: ProjectTaskRow): BoardTask {
  return {
    id: task.id,
    column_id: task.column_id,
    title: task.title,
    description: task.description as TiptapDoc | null,
    position: task.position,
    sort_key: task.sort_key,
    due_date: task.due_date,
    created_at: task.created_at.toISOString(),
    updated_at: task.updated_at.toISOString(),
    column_since: task.column_since.toISOString(),
    label_ids: task.label_rows.map((row) => row.label_id),
    assignee_ids: task.assignee_rows.map((row) => row.user_id),
    blocker_ids: task.blocker_rows.map((row) => row.blocker_task_id),
    image_count: Number(task.image_count),
    cover_image_url: task.cover_image_id == null ? null : `/api/images/${task.cover_image_id}`,
    comment_count: Number(task.comment_count),
    checklist_item_count: Number(task.checklist_item_count),
    checklist_done_count: Number(task.checklist_done_count),
    attachment_count: Number(task.attachment_count),
  };
}

function toArchivedTask(row: ProjectTaskRow): ArchivedTask {
  return { ...toBoardTask(row), archived_at: (row.archived_at as Date).toISOString() };
}

export interface BoardTaskRow {
  task: BoardTask;
  project_id: string;
  archived_at: string | null;
}

export async function fetchBoardTaskRows(
  db: Kysely<DB>,
  taskIds: readonly string[]
): Promise<BoardTaskRow[]> {
  if (taskIds.length === 0) {
    return [];
  }
  const rows = await boardTasksQuery(db)
    .where('task.id', 'in', [...taskIds])
    .orderBy('task.sort_key')
    .orderBy('task.id')
    .execute();

  return rows.map((row) => ({
    task: toBoardTask(row),
    project_id: row.project_id,
    archived_at: row.archived_at?.toISOString() ?? null,
  }));
}

// A bulk column archive stamps one archived_at across the batch, so the key is
// what keeps those rows in board order rather than uuid order.
function archivedTasksQuery(db: Kysely<DB>, projectId: string) {
  return projectTasksQuery(db, projectId)
    .where('task.archived_at', 'is not', null)
    .orderBy('task.archived_at', 'desc')
    .orderBy('board_column.sort_key')
    .orderBy('task.sort_key')
    .orderBy('task.id');
}

export async function getArchivedTasks(db: Kysely<DB>, projectId: string): Promise<ArchivedTask[]> {
  const rows = await archivedTasksQuery(db, projectId).execute();

  return rows.map(toArchivedTask);
}

export async function getArchivedTasksByIds(
  db: Kysely<DB>,
  projectId: string,
  taskIds: readonly string[]
): Promise<ArchivedTask[]> {
  if (taskIds.length === 0) {
    return [];
  }
  const rows = await archivedTasksQuery(db, projectId)
    .where('task.id', 'in', [...taskIds])
    .execute();

  return rows.map(toArchivedTask);
}

export async function getBoardPayload(
  db: Kysely<DB>,
  projectId: string
): Promise<BoardPayload | null> {
  const project = await db
    .selectFrom('project')
    .select((eb) => [
      'id',
      'name',
      'description',
      'archived_at',
      'created_at',
      'created_by',
      'is_public',
      'color',
      jsonArrayFrom(
        eb
          .selectFrom('project_member')
          .select(['project_member.user_id', 'project_member.role'])
          .whereRef('project_member.project_id', '=', 'project.id')
          .orderBy('project_member.created_at')
          .orderBy('project_member.user_id')
      ).as('member_rows'),
    ])
    .where('id', '=', projectId)
    .executeTakeFirst();

  if (!project) {
    return null;
  }

  const columns = await db
    .selectFrom('board_column')
    .select(['id', 'name', 'position', 'sort_key', 'is_done'])
    .where('project_id', '=', projectId)
    .orderBy('sort_key')
    .orderBy('id')
    .execute();

  const tasks = await projectTasksQuery(db, projectId)
    .where('task.archived_at', 'is', null)
    .orderBy('board_column.sort_key')
    .orderBy('task.sort_key')
    .orderBy('task.id')
    .execute();

  const labels = await db
    .selectFrom('label')
    .select(['id', 'name', 'color'])
    .where('project_id', '=', projectId)
    .orderBy('name')
    .orderBy('id')
    .execute();

  const members = toMemberEntries(project.member_rows);

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      archived_at: project.archived_at?.toISOString() ?? null,
      created_at: project.created_at.toISOString(),
      created_by: project.created_by,
      member_ids: members.map((member) => member.user_id),
      members,
      is_public: project.is_public,
      color: normalizeProjectAccent(project.color),
    },
    columns,
    tasks: tasks.map(toBoardTask),
    labels,
  };
}

interface PublicCommentRow {
  id: string;
  task_id: string;
  user_id: string;
  body: unknown;
  created_at: Date;
  updated_at: Date;
}

async function fetchCommentsForTasks(
  db: Kysely<DB>,
  taskIds: readonly string[]
): Promise<PublicCommentRow[]> {
  if (taskIds.length === 0) {
    return [];
  }
  return db
    .selectFrom('task_comment')
    .select([
      'task_comment.id',
      'task_comment.task_id',
      'task_comment.user_id',
      'task_comment.body',
      'task_comment.created_at',
      'task_comment.updated_at',
    ])
    .where('task_comment.task_id', 'in', [...taskIds])
    .orderBy('task_comment.created_at')
    .orderBy('task_comment.id')
    .execute();
}

interface PublicChecklistItemRow {
  id: string;
  task_id: string;
  text: string;
  checked: boolean;
  position: number;
}

async function fetchChecklistItemsForTasks(
  db: Kysely<DB>,
  taskIds: readonly string[]
): Promise<PublicChecklistItemRow[]> {
  if (taskIds.length === 0) {
    return [];
  }
  return db
    .selectFrom('checklist_item')
    .select([
      'checklist_item.id',
      'checklist_item.task_id',
      'checklist_item.text',
      'checklist_item.checked',
      'checklist_item.position',
    ])
    .where('checklist_item.task_id', 'in', [...taskIds])
    .orderBy('checklist_item.sort_key')
    .orderBy('checklist_item.id')
    .execute();
}

// Never spread: listing every field by hand is what keeps a newly added board
// field private until someone deliberately publishes it here.
export function toPublicBoard(
  payload: BoardPayload,
  users: PublicBoardUser[],
  comments: PublicCommentRow[],
  checklistItems: PublicChecklistItemRow[]
): PublicBoard {
  return {
    project: {
      id: payload.project.id,
      name: payload.project.name,
      description: payload.project.description,
    },
    columns: payload.columns.map((column) => ({
      id: column.id,
      name: column.name,
      position: column.position,
      sort_key: column.sort_key,
      is_done: column.is_done,
    })),
    tasks: payload.tasks.map((task) => ({
      id: task.id,
      column_id: task.column_id,
      title: task.title,
      description: task.description,
      position: task.position,
      due_date: task.due_date,
      label_ids: task.label_ids,
      assignee_ids: task.assignee_ids,
      blocker_ids: task.blocker_ids,
      image_count: task.image_count,
      cover_image_url: task.cover_image_url,
      comment_count: task.comment_count,
      checklist_item_count: task.checklist_item_count,
      checklist_done_count: task.checklist_done_count,
    })),
    labels: payload.labels.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
    })),
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      avatar_url: user.avatar_url,
    })),
    comments: comments.map((comment) => ({
      id: comment.id,
      task_id: comment.task_id,
      user_id: comment.user_id,
      body: comment.body as TiptapDoc,
      created_at: comment.created_at.toISOString(),
      updated_at: comment.updated_at.toISOString(),
    })),
    checklist_items: checklistItems.map((item) => ({
      id: item.id,
      task_id: item.task_id,
      text: item.text,
      checked: item.checked,
      position: item.position,
    })),
  };
}

export async function getPublicBoard(
  db: Kysely<DB>,
  projectId: string
): Promise<PublicBoard | null> {
  // Nothing here is authenticated, so the flag is read on its own before the
  // board is assembled. Building first and rejecting after let a stranger spend
  // the whole payload query per request, and made a private project take
  // measurably longer to refuse than one that does not exist.
  const gate = await db
    .selectFrom('project')
    .select('is_public')
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (!gate) {
    return null;
  }
  assertPublicProject(gate);

  const payload = await getBoardPayload(db, projectId);
  if (!payload) {
    return null;
  }
  assertPublicProject(payload.project);

  // Scoping to the published tasks is what keeps an archived task's comments and
  // checklist out, since those tasks are not in the payload.
  const publishedTaskIds = payload.tasks.map((task) => task.id);
  const comments = await fetchCommentsForTasks(db, publishedTaskIds);
  const checklistItems = await fetchChecklistItemsForTasks(db, publishedTaskIds);

  // A member who is neither assigned nor quoted stays unnamed.
  const namedIds = new Set([
    ...payload.tasks.flatMap((task) => task.assignee_ids),
    ...comments.map((comment) => comment.user_id),
  ]);
  const users =
    namedIds.size === 0
      ? []
      : (await usersWithProjectAccess(db, projectId))
          .filter((user) => namedIds.has(user.id))
          .map(({ id, name, avatar_url }) => ({ id, name, avatar_url }));

  return toPublicBoard(payload, users, comments, checklistItems);
}
