import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { board } from './board.svelte';
import type { BoardTask } from './board-types';
import { cardContext } from './card-context.svelte';
import { cardCursor } from './card-cursor.svelte';
import { cardTarget, editableCardTarget } from './card-target';
import { myTasks, type MyTask } from './myTasks.svelte';
import { projects, type Project } from './projects.svelte';
import { router } from './router.svelte';
import { selection } from './selection.svelte';
import { session } from './session.svelte';
import { projectHref, publicBoardHref, taskHref } from './short-links';
import { taskRoute } from './task-route.svelte';
import { testUuid } from './test-ids';

const me = {
  id: 'u-me',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
  email_verified: false,
};
const PROJECT_ID = testUuid('p1');
const TASK_1 = testUuid('t1');
const TASK_2 = testUuid('t2');
const BOARD_PATH = projectHref(PROJECT_ID, 'Game');
const GRAPH_PATH = projectHref(PROJECT_ID, 'Game', 'graph');
const TASK_PATH = taskHref(TASK_1, 'A');
const GRAPH_TASK_PATH = taskHref(TASK_1, 'A', 'graph');

function task(id: string, columnId: string, position: number, title = id): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    sort_key: `V0${String(Math.round(position)).padStart(8, '0')}1`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    attachment_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
  };
}

const AWAY_PROJECT = testUuid('p2');
const AWAY_TASK = testUuid('t3');

function awayProject(patch: Partial<Project>): Project {
  return {
    id: AWAY_PROJECT,
    name: 'Away',
    description: '',
    archived_at: null,
    created_by: me.id,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00Z',
    open_task_count: 0,
    done_task_count: 0,
    sort_key: null,
    last_seen_at: null,
    has_unseen_changes: false,
    ...patch,
  };
}

function awayTask(): MyTask {
  return {
    id: AWAY_TASK,
    project_id: AWAY_PROJECT,
    project_name: 'Away',
    column_name: 'To Do',
    title: 'Ship the demo',
    bucket: 'ready',
    assignee_ids: [me.id],
    waiting_user_ids: [],
    blocking: [],
    blocked_by: [],
    hidden_blocked_by_count: 0,
    hidden_blocking_count: 0,
  };
}

beforeEach(() => {
  board.reset();
  cardContext.reset();
  cardCursor.reset();
  myTasks.reset();
  projects.reset();
  taskRoute.reset();
  selection.clear();
  board.currentProjectId = PROJECT_ID;
  board.project = {
    id: PROJECT_ID,
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: me.id,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00Z',
  };
  board.columns = [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }];
  board.tasks = [task(TASK_1, 'c1', 1000, 'A'), task(TASK_2, 'c1', 2000, 'B')];
  router.navigate(BOARD_PATH, { replace: true });
  session.user = me;
});

describe('cardTarget', () => {
  it('prefers the overlay task over the board selection', () => {
    selection.set(TASK_2);
    router.navigate(TASK_PATH, { replace: true });

    expect(cardTarget()).toBe(TASK_1);
  });

  it('falls back to the board selection with no overlay', () => {
    selection.set(TASK_2);

    expect(cardTarget()).toBe(TASK_2);
  });

  it('is null on the board view with nothing selected', () => {
    expect(cardTarget()).toBeNull();
  });

  it('ignores the selection on the graph, which has no card list', () => {
    selection.set(TASK_2);
    router.navigate(GRAPH_PATH, { replace: true });

    expect(cardTarget()).toBeNull();
  });

  it('still answers the overlay task on the graph', () => {
    router.navigate(GRAPH_TASK_PATH, { replace: true });

    expect(cardTarget()).toBe(TASK_1);
  });

  it.each([
    ['/', '/'],
    ['public board', publicBoardHref(PROJECT_ID)],
  ])('is null on a screen with no card in context (%s)', (_name, path) => {
    selection.set(TASK_2);
    cardCursor.set(TASK_2);
    router.navigate(path, { replace: true });

    expect(cardTarget()).toBeNull();
  });

  // The board's own cursor never reaches these: it is a grid position, and these
  // screens are flat lists whose rows come from every project at once.
  it.each([
    ['/my-tasks', '/my-tasks'],
    ['/search?q=a', '/search?q=a'],
  ])('answers the list cursor on %s', (_name, path) => {
    selection.set(TASK_1);
    router.navigate(path, { replace: true });

    expect(cardTarget()).toBeNull();

    cardCursor.set(TASK_2);

    expect(cardTarget()).toBe(TASK_2);
  });
});

describe('editableCardTarget', () => {
  it('answers the same target on a board the user can edit', () => {
    selection.set(TASK_2);

    expect(editableCardTarget()).toBe(TASK_2);
  });

  it('is null for a viewer while cardTarget still answers', () => {
    board.project = {
      ...board.project!,
      created_by: 'u-owner',
      member_ids: [me.id],
      members: [{ user_id: me.id, role: 'viewer' }],
    };
    selection.set(TASK_2);

    expect(board.canEdit).toBe(false);
    expect(cardTarget()).toBe(TASK_2);
    expect(editableCardTarget()).toBeNull();
  });

  it('answers a list-screen target the caller can write in its own project', () => {
    projects.projects = [awayProject({ created_by: me.id })];
    myTasks.tasks = [awayTask()];
    router.navigate('/my-tasks', { replace: true });
    cardCursor.set(AWAY_TASK);

    expect(editableCardTarget()).toBe(AWAY_TASK);
  });

  it('is null for a list-screen target in a project the caller may only read', () => {
    projects.projects = [
      awayProject({
        created_by: 'u-owner',
        member_ids: [me.id],
        members: [{ user_id: me.id, role: 'viewer' as const }],
      }),
    ];
    myTasks.tasks = [awayTask()];
    router.navigate('/my-tasks', { replace: true });
    cardCursor.set(AWAY_TASK);

    expect(cardTarget()).toBe(AWAY_TASK);
    expect(editableCardTarget()).toBeNull();
  });
});
