import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_ACTION_KEYS, keyEventInit, type CardActionId } from './card-actions';
import { board } from './board.svelte';
import type { BoardTask } from './board-types';
import { cardMenu } from './card-menu.svelte';
import { router } from './router.svelte';
import { selection } from './selection.svelte';
import { session } from './session.svelte';
import { shortcuts } from './shortcuts.svelte';
import { projectHref, taskHref } from './short-links';
import { testUuid } from './test-ids';

const me = {
  id: 'u-me',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
  email_verified: false,
};
const PROJECT_ID = testUuid('p1');
const TASK_ID = testUuid('t1');
const TASK_TITLE = 'Design cards';
const BOARD_PATH = projectHref(PROJECT_ID, 'Game');
const TASK_PATH = taskHref(TASK_ID, TASK_TITLE);

function task(id: string, columnId: string, position: number, title: string): BoardTask {
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
  shortcuts.reset();
  cardMenu.reset();
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
  board.columns = [
    { id: 'c1', name: 'Todo', position: 1000, is_done: false },
    { id: 'done', name: 'Done', position: 2000, is_done: true },
  ];
  board.tasks = [task(TASK_ID, 'c1', 1000, TASK_TITLE)];
  router.navigate(BOARD_PATH, { replace: true });
  session.user = me;
  selection.set(TASK_ID);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function press(hint: string): void {
  shortcuts.handleKeydown(
    new KeyboardEvent('keydown', { cancelable: true, ...keyEventInit(hint) })
  );
}

// Every hint is pressed through the real keymap, so a rebinding that leaves the
// table behind fails here rather than teaching people a key that does nothing.
const effects: Record<CardActionId, (hint: string) => void> = {
  open: (hint) => {
    press(hint);
    expect(router.path).toBe(TASK_PATH);
  },
  openDetail: (hint) => {
    press(hint);
    expect(router.path).toBe(TASK_PATH);
  },
  labels: (hint) => {
    press(hint);
    expect(shortcuts.labelMenu).toBe(TASK_ID);
  },
  assignees: (hint) => {
    press(hint);
    expect(shortcuts.assigneeMenu).toBe(TASK_ID);
  },
  blockers: (hint) => {
    press(hint);
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_ID, direction: 'blocker' });
  },
  blocking: (hint) => {
    press(hint);
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_ID, direction: 'blocked' });
  },
  move: (hint) => {
    press(hint);
    expect(shortcuts.moveMenu).toBe(TASK_ID);
  },
  done: (hint) => {
    const markTaskDone = vi.spyOn(board, 'markTaskDone').mockReturnValue(true);
    press(hint);
    expect(markTaskDone).toHaveBeenCalledWith(TASK_ID);
  },
  duplicate: (hint) => {
    const duplicateTask = vi.spyOn(board, 'duplicateTask').mockResolvedValue(testUuid('t2'));
    press(hint);
    expect(duplicateTask).toHaveBeenCalledWith(TASK_ID);
  },
  select: (hint) => {
    press(hint);
    expect(selection.selectedIds).toEqual([TASK_ID]);
  },
  rename: () => expect.unreachable('rename has no key'),
  archive: () => expect.unreachable('archive has no key'),
  openNewTab: () => expect.unreachable('open in a new tab has no key'),
  copyLink: () => expect.unreachable('copy link has no key'),
};

describe('card action hints', () => {
  for (const [id, keys] of Object.entries(CARD_ACTION_KEYS)) {
    for (const hint of keys) {
      it(`${id} really is bound to ${hint}`, () => {
        effects[id as CardActionId](hint);
      });
    }
  }

  it('covers every action the menu can show', () => {
    expect(Object.keys(effects).sort()).toEqual(Object.keys(CARD_ACTION_KEYS).sort());
  });
});
