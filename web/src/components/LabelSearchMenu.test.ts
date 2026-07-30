import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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
  column_since: '2026-01-01T00:00:00Z',
  label_ids: [],
  assignee_ids: [],
  blocker_ids: [],
  image_count: 0,
  cover_image_url: null,
  due_date: null,
  comment_count: 0,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LabelSearchMenu', () => {
  it('filters labels by the query', async () => {
    render(LabelSearchMenu, { taskId: 't1' });
    expect(screen.getByLabelText('Filter labels')).toHaveAttribute('autocapitalize', 'sentences');
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
    await waitFor(() => {
      expect(board.tasks.find((t) => t.id === 't1')?.label_ids).toContain(created!.id);
    });
    expect(screen.getByRole('button', { name: 'shaders' })).toHaveAttribute('aria-pressed', 'true');

    const posted = fetchMock.mock.calls.some((call) => {
      const request = call[0] as Request;
      return request.method === 'POST' && new URL(request.url).pathname === '/api/labels';
    });
    expect(posted).toBe(true);
  });

  it('waits for the label to be created before applying it to the task', async () => {
    let releaseCreate: () => void = () => {};
    const createSpy = vi.spyOn(board, 'createLabel').mockImplementation((name, color) => {
      board.labels = [...board.labels, { id: 'l-new', name, color }];
      return new Promise<void>((resolve) => {
        releaseCreate = resolve;
      });
    });
    const setSpy = vi.spyOn(board, 'setTaskLabels').mockResolvedValue(undefined);

    render(LabelSearchMenu, { taskId: 't1' });
    const input = screen.getByLabelText('Filter labels');
    await fireEvent.input(input, { target: { value: 'shaders' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(createSpy).toHaveBeenCalledWith('shaders', expect.any(String));
    // The PUT that applies the label must not fire until the POST resolves.
    await Promise.resolve();
    expect(setSpy).not.toHaveBeenCalled();

    releaseCreate();
    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith('t1', ['l-new']);
    });
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

  it('leaves Escape alone without an onclose so the quick menu modal still closes', async () => {
    render(LabelSearchMenu, { taskId: 't1' });

    const notPrevented = await fireEvent.keyDown(screen.getByLabelText('Filter labels'), {
      key: 'Escape',
    });

    expect(notPrevented).toBe(true);
    expect(screen.getByLabelText('Filter labels')).toBeInTheDocument();
  });

  it('calls onclose on Escape from the filter input', async () => {
    const onclose = vi.fn();
    render(LabelSearchMenu, { taskId: 't1', onclose });

    await fireEvent.keyDown(screen.getByLabelText('Filter labels'), { key: 'Escape' });

    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('calls onclose on Escape from a focused label row', async () => {
    const onclose = vi.fn();
    render(LabelSearchMenu, { taskId: 't1', onclose });
    const row = screen.getByRole('button', { name: 'art' });
    row.focus();

    const notPrevented = await fireEvent.keyDown(row, { key: 'Escape' });

    expect(notPrevented).toBe(false);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('moves focus with the highlight when arrowing from a label row', async () => {
    render(LabelSearchMenu, { taskId: 't1' });
    const row = screen.getByRole('button', { name: 'art' });
    row.focus();

    await fireEvent.keyDown(row, { key: 'ArrowDown' });

    const next = screen.getByRole('button', { name: 'rules' });
    expect(next).toHaveFocus();

    await fireEvent.keyDown(next, { key: 'Enter' });

    await waitFor(() => {
      expect(board.tasks.find((t) => t.id === 't1')?.label_ids).toEqual(['l2']);
    });
  });

  it('activates the focused row on Enter even when the pointer highlights another', async () => {
    render(LabelSearchMenu, { taskId: 't1' });
    const art = screen.getByRole('button', { name: 'art' });
    art.focus();
    await fireEvent.pointerMove(screen.getByRole('button', { name: 'rules' }));

    await fireEvent.keyDown(art, { key: 'Enter' });

    await waitFor(() => {
      expect(board.tasks.find((t) => t.id === 't1')?.label_ids).toEqual(['l1']);
    });
  });

  it('scrolls the newly highlighted row into view on ArrowDown', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(LabelSearchMenu, { taskId: 't1' });

    await fireEvent.keyDown(screen.getByLabelText('Filter labels'), { key: 'ArrowDown' });

    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollSpy.mock.contexts[0]).toBe(screen.getByRole('button', { name: 'rules' }));
  });
});
