import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import DependencyList from './DependencyList.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';
import type { CrossProjectDependency } from '../lib/crossProjectDeps.svelte';
import { testUuid } from '../lib/test-ids';

function task(id: string, title: string, blockerIds: string[] = []): BoardTask {
  return {
    id,
    column_id: 'c1',
    title,
    description: null,
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: blockerIds,
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

function remoteEdge(id: string, title: string): CrossProjectDependency {
  return {
    task_id: id,
    title,
    project_id: 'p2',
    project_name: 'Other',
    is_done: false,
  };
}

const props = {
  taskId: 't1',
  direction: 'blocker' as const,
  remote: [] as CrossProjectDependency[],
  hiddenCount: 0,
  skeletonCount: 0,
  loading: false,
  doneColumnIds: new Set<string>(),
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, {}));
  board.reset();
  board.currentProjectId = 'p1';
  board.columns = [{ id: 'c1', name: 'Doing', sort_key: 'V0000010001', is_done: false }];
  board.tasks = [
    task('t1', 'Design cards', ['t2', 't3']),
    task('t2', 'Cut cards'),
    task('t3', 'Print rules'),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DependencyList', () => {
  it('detaches a blocker from this task', async () => {
    const spy = vi.spyOn(board, 'removeBlocker');
    render(DependencyList, { ...props, local: [board.tasks[1]!, board.tasks[2]!] });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove blocking task Cut cards' }));

    expect(spy).toHaveBeenCalledWith('t1', 't2');
  });

  it('detaches this task from a dependent in the other direction', async () => {
    const spy = vi.spyOn(board, 'removeBlocker');
    render(DependencyList, {
      ...props,
      direction: 'blocked',
      local: [board.tasks[1]!],
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove blocked task Cut cards' }));

    expect(spy).toHaveBeenCalledWith('t2', 't1');
  });

  // The optimistic update unmounts the row under the button that was pressed, so
  // focus would otherwise land on the task dialog's body — several tab stops from
  // the list the user is working in.
  it('hands focus to the next row when a row is removed', async () => {
    vi.spyOn(board, 'removeBlocker');
    const { rerender } = render(DependencyList, {
      ...props,
      local: [board.tasks[1]!, board.tasks[2]!],
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove blocking task Cut cards' }));
    const survivor = screen.getByRole('button', { name: 'Remove blocking task Print rules' });
    expect(survivor).toHaveFocus();

    // The removed row unmounting must not take the focus with it.
    await rerender({ ...props, local: [board.tasks[2]!] });
    expect(screen.getByRole('button', { name: 'Remove blocking task Print rules' })).toHaveFocus();
  });

  it('falls back to the row above when the last row is removed', async () => {
    vi.spyOn(board, 'removeBlocker');
    render(DependencyList, { ...props, local: [board.tasks[1]!, board.tasks[2]!] });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove blocking task Print rules' }));

    expect(screen.getByRole('button', { name: 'Remove blocking task Cut cards' })).toHaveFocus();
  });

  // A cross-project row carries a link and no Remove button; it is still the next
  // thing in the list, and skipping it would jump focus out of the section.
  it('hands focus to a remote row when it is the only neighbour', async () => {
    vi.spyOn(board, 'removeBlocker');
    render(DependencyList, {
      ...props,
      local: [board.tasks[1]!],
      remote: [remoteEdge(testUuid('t9'), 'Ship the demo')],
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove blocking task Cut cards' }));

    expect(screen.getByRole('link', { name: 'Ship the demo' })).toHaveFocus();
  });
});
