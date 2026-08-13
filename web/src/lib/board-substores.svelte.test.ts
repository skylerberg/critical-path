// The `.svelte.` infix is load-bearing here more than anywhere: what is under
// test IS a `$derived` subscription, and without the infix the runes never
// compile, the deriveds never invalidate, and every assertion below passes while
// proving nothing.
import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { awayBoard, board } from './board.svelte';
import type { BoardTask } from './board-types';
import { realtimeEvent } from './realtime-test-events';

const NOW = '2026-01-01T00:00:00Z';

function task(id: string): BoardTask {
  return {
    id,
    column_id: 'c1',
    title: id,
    sort_key: 'V0',
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  } as BoardTask;
}

function comment(id: string, text: string) {
  return {
    id,
    task_id: 't1',
    user_id: 'u1',
    body: {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
    created_at: NOW,
    updated_at: NOW,
  };
}

/**
 * Stands in for a component. The three caches live on sub-stores now and are
 * reached through accessor pairs on the board, so what has to hold is that a
 * `$derived` reading the accessor still invalidates when the sub-store's own
 * `$state` is written — including on the paths that never go through the setter.
 */
class Watcher {
  comments = $derived(board.taskComments.t1 ?? null);
  checklist = $derived(board.taskChecklists.t1 ?? null);
  attachments = $derived(board.taskAttachments.t1 ?? null);
}

beforeEach(() => {
  board.reset();
  awayBoard.reset();
  board.currentProjectId = 'p1';
  board.readonly = false;
  board.tasks = [task('t1')];
});

describe('reading a sub-store cache through the board', () => {
  it('sees a write made through the accessor', () => {
    const watcher = new Watcher();
    expect(watcher.comments).toBeNull();

    board.taskComments = { t1: [comment('cm1', 'hello')] };

    expect(watcher.comments?.map((c) => c.id)).toEqual(['cm1']);
  });

  // The path that a bare getter would still pass and a broken subscription would
  // not: applyRealtime writes the sub-store's `$state` directly, never touching
  // the board's setter.
  it('sees a write the sub-store makes internally, bypassing the setter', () => {
    board.taskComments = { t1: [] };
    const watcher = new Watcher();
    // Read first, or the derived's one and only evaluation happens after the
    // write and a cache that never invalidates passes anyway.
    expect(watcher.comments).toEqual([]);

    board.applyRealtime(
      realtimeEvent('comment_created', { ...comment('cm1', 'hello'), comment_count: 1 }, 'p1')
    );

    expect(watcher.comments?.map((c) => c.id)).toEqual(['cm1']);
    expect(board.tasks[0]!.comment_count).toBe(1);
  });

  it('sees an internal checklist write', () => {
    board.taskChecklists = { t1: [] };
    const watcher = new Watcher();
    expect(watcher.checklist).toEqual([]);

    board.applyRealtime(
      realtimeEvent(
        'checklist_item_created',
        {
          id: 'ci1',
          task_id: 't1',
          text: 'buy milk',
          checked: false,
          sort_key: 'V0',
          created_at: NOW,
          updated_at: NOW,
          checklist_item_count: 1,
          checklist_done_count: 0,
        },
        'p1'
      )
    );

    expect(watcher.checklist?.map((i) => i.id)).toEqual(['ci1']);
    expect(board.tasks[0]!.checklist_item_count).toBe(1);
  });

  it('sees an internal attachment write', () => {
    board.taskAttachments = {
      t1: [{ id: 'a1', task_id: 't1', kind: 'link' }] as never,
    };
    const watcher = new Watcher();
    expect(watcher.attachments).toHaveLength(1);

    board.applyRealtime(
      realtimeEvent('attachment_deleted', { id: 'a1', task_id: 't1', attachment_count: 0 }, 'p1')
    );

    expect(watcher.attachments).toEqual([]);
  });

  it('keeps reacting across repeated writes rather than latching on the first', () => {
    board.taskComments = { t1: [] };
    const watcher = new Watcher();

    board.taskComments = { t1: [comment('cm1', 'one')] };
    expect(watcher.comments).toHaveLength(1);

    board.taskComments = { t1: [comment('cm1', 'one'), comment('cm2', 'two')] };
    expect(watcher.comments).toHaveLength(2);

    board.taskComments = {};
    expect(watcher.comments).toBeNull();
  });
});

// awayBoard is a second live instance, so its sub-stores are constructed per
// board. Module-level ones would give the two of them a single set of comments,
// and the card opened from another project would show this board's.
describe('the away board', () => {
  it('holds its own caches', () => {
    board.taskComments = { t1: [comment('cm1', 'mine')] };
    awayBoard.taskComments = { t1: [comment('cm2', 'theirs')] };

    expect(board.taskComments.t1?.map((c) => c.id)).toEqual(['cm1']);
    expect(awayBoard.taskComments.t1?.map((c) => c.id)).toEqual(['cm2']);
  });

  it('is untouched when the near board clears', () => {
    awayBoard.taskChecklists = { t1: [] };
    board.taskChecklists = { t1: [] };

    board.reset();

    expect(board.taskChecklists).toEqual({});
    expect(awayBoard.taskChecklists).toEqual({ t1: [] });
  });
});
