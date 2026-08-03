import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { board } from './board.svelte';
import type { BoardTask } from './board-types';
import { cardTarget, editableCardTarget } from './card-target';
import { router } from './router.svelte';
import { selection } from './selection.svelte';
import { session } from './session.svelte';
import { projectHref, publicBoardHref, taskHref } from './short-links';
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
    position,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
  };
}

beforeEach(() => {
  board.reset();
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
  board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
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
    ['/my-tasks', '/my-tasks'],
    ['/search?q=a', '/search'],
    ['public board', publicBoardHref(PROJECT_ID)],
  ])('is null off the project routes (%s)', (_name, path) => {
    selection.set(TASK_2);
    router.navigate(path, { replace: true });

    expect(cardTarget()).toBeNull();
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
});
