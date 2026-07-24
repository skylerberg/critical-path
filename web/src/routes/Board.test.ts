import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
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
