import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import LabelSearchMenu from './LabelSearchMenu.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';

const task: BoardTask = {
  id: 't1',
  column_id: 'c1',
  title: 'Design cards',
  description: null,
  position: 1000,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  label_ids: [],
  assignee_ids: [],
  blocker_ids: [],
  image_count: 0,
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, {}));
  board.reset();
  board.currentProjectId = 'p1';
  board.labels = [
    { id: 'l1', name: 'art', color: '#ff0000' },
    { id: 'l2', name: 'rules', color: '#00ff00' },
  ];
  board.tasks = [{ ...task }];
});

describe('LabelSearchMenu', () => {
  it('filters labels by the query', async () => {
    render(LabelSearchMenu, { taskId: 't1' });
    await fireEvent.input(screen.getByLabelText('Filter labels'), { target: { value: 'rul' } });

    expect(screen.getByRole('button', { name: 'rules' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'art' })).not.toBeInTheDocument();
  });

  it('offers a Create row that creates and applies a new label optimistically', async () => {
    render(LabelSearchMenu, { taskId: 't1' });
    await fireEvent.input(screen.getByLabelText('Filter labels'), { target: { value: 'shaders' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Create "shaders"' }));

    const created = board.labels.find((label) => label.name === 'shaders');
    expect(created).toBeDefined();
    // Auto color cycles the 10-colour palette by existing-label count (2 => index 2).
    expect(created?.color).toBe('#eab308');
    expect(board.tasks.find((t) => t.id === 't1')?.label_ids).toContain(created!.id);
    expect(screen.getByRole('button', { name: 'shaders' })).toHaveAttribute('aria-pressed', 'true');

    const posted = fetchMock.mock.calls.some((call) => {
      const request = call[0] as Request;
      return request.method === 'POST' && new URL(request.url).pathname === '/api/labels';
    });
    expect(posted).toBe(true);
  });

  it('creates via Enter on the highlighted Create row', async () => {
    render(LabelSearchMenu, { taskId: 't1' });
    const input = screen.getByLabelText('Filter labels');
    await fireEvent.input(input, { target: { value: 'audio' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(board.labels.some((label) => label.name === 'audio')).toBe(true);
  });

  it('does not offer a Create row when the query matches an existing label', async () => {
    render(LabelSearchMenu, { taskId: 't1' });
    await fireEvent.input(screen.getByLabelText('Filter labels'), { target: { value: 'art' } });

    expect(screen.queryByRole('button', { name: 'Create "art"' })).not.toBeInTheDocument();
  });
});
