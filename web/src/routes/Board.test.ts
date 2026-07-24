import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Board from './Board.svelte';
import { board } from '../lib/board.svelte';
import { selection } from '../lib/selection.svelte';
import type { BoardTask } from '../lib/board-types';

function task(id: string, columnId: string, position: number, title: string): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, { users: [] }));
  board.reset();
  selection.clear();
  board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
  board.tasks = [
    task('t1', 'c1', 1000, 'plain one'),
    task('t2', 'c1', 2000, 'match a'),
    task('t3', 'c1', 3000, 'plain two'),
    task('t4', 'c1', 4000, 'match b'),
  ];
});

function column(): HTMLElement {
  const section = document.querySelector('section[aria-label="Todo"]');
  if (!(section instanceof HTMLElement)) {
    throw new Error('Todo column not rendered');
  }
  return section;
}

function cardTitles(): string[] {
  return [...column().querySelectorAll('a p')].map((p) => p.textContent ?? '');
}

function alertText(): string {
  return document.getElementById('dnd-action-aria-alert')?.textContent ?? '';
}

function patchRequests(): Request[] {
  return fetchMock.mock.calls
    .map((call) => call[0] as Request)
    .filter((request) => request.method === 'PATCH');
}

describe('Board display order', () => {
  it('renders tasks in pure position order without filters', async () => {
    render(Board, { props: { projectId: 'p1' } });

    await screen.findByText('match a');
    expect(cardTitles()).toEqual(['plain one', 'match a', 'plain two', 'match b']);
  });

  it('renders matching tasks above dimmed ones while a filter is active', async () => {
    board.setFilterQuery('match');
    render(Board, { props: { projectId: 'p1' } });

    await screen.findByText('match a');
    expect(cardTitles()).toEqual(['match a', 'match b', 'plain one', 'plain two']);
    const dimmed = [...column().querySelectorAll('a')]
      .filter((a) => a.className.includes('opacity-30'))
      .map((a) => a.querySelector('p')?.textContent);
    expect(dimmed).toEqual(['plain one', 'plain two']);
  });
});

describe('Board keyboard reordering', () => {
  it('reorders task cards with Enter and arrows, committing each move', async () => {
    render(Board, { props: { projectId: 'p1' } });
    const item = await screen.findByRole('listitem', { name: 'plain one' });
    expect(item).toHaveAttribute('tabindex', '0');
    item.focus();

    const pickup = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await fireEvent(item, pickup);
    expect(pickup.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(board.dragging).toBe(true));

    await fireEvent.keyDown(item, { key: 'ArrowDown' });
    await vi.waitFor(() =>
      expect(cardTitles()).toEqual(['match a', 'plain one', 'plain two', 'match b'])
    );
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));
    const patch = patchRequests()[0]!;
    expect(new URL(patch.url).pathname).toBe('/api/tasks/t1');
    expect(await patch.clone().json()).toEqual({ column_id: 'c1', position: 2500 });

    await fireEvent.keyDown(item, { key: 'Enter' });
    await vi.waitFor(() => expect(board.dragging).toBe(false));
    expect(alertText()).toContain('Stopped dragging item plain one');
  });

  it('leaves Enter on a task card link to the browser', async () => {
    render(Board, { props: { projectId: 'p1' } });
    const anchor = await screen.findByRole('link', { name: 'plain one' });
    anchor.focus();

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await fireEvent(anchor, enter);

    expect(enter.defaultPrevented).toBe(false);
    expect(board.dragging).toBe(false);
    expect(alertText()).not.toContain('Started dragging');
    expect(cardTitles()).toEqual(['plain one', 'match a', 'plain two', 'match b']);
  });

  it('reorders columns by keyboard via the drag handle', async () => {
    board.columns = [
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'c2', name: 'Doing', position: 2000, is_done: false },
    ];
    render(Board, { props: { projectId: 'p1' } });

    const handles = await screen.findAllByRole('button', { name: 'Reorder column' });
    const handle = handles[0]!;
    expect(handle).toHaveAttribute('tabindex', '0');
    handle.focus();

    await fireEvent.keyDown(handle, { key: 'Enter' });
    await vi.waitFor(() => expect(board.dragging).toBe(true));
    expect(alertText()).toContain('Started dragging item Todo');

    const section = column();
    await fireEvent.keyDown(section, { key: 'ArrowRight' });
    await vi.waitFor(() =>
      expect(
        [...document.querySelectorAll('section[aria-label]')].map((s) =>
          s.getAttribute('aria-label')
        )
      ).toEqual(['Doing', 'Todo'])
    );
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));
    const patch = patchRequests()[0]!;
    expect(new URL(patch.url).pathname).toBe('/api/columns/c1');
    expect(await patch.clone().json()).toEqual({ position: 3000 });

    await fireEvent.keyDown(section, { key: 'Enter' });
    await vi.waitFor(() => expect(board.dragging).toBe(false));
  });
});
