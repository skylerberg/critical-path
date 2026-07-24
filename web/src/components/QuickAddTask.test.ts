import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import QuickAddTask from './QuickAddTask.svelte';
import { board } from '../lib/board.svelte';

const payload = {
  project: {
    id: 'p1',
    name: 'Game',
    description: '',
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
  },
  columns: [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }],
  tasks: [],
  labels: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  fetchMock.mockReset();
  board.reset();
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    if (request.method === 'GET') {
      return jsonResponse(200, payload);
    }
    return jsonResponse(201, {});
  });
  await board.load('p1');
  fetchMock.mockClear();
});

describe('QuickAddTask', () => {
  it('opens the composer and focuses the title input', async () => {
    render(QuickAddTask, { columnId: 'c1' });

    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));

    const input = screen.getByLabelText('Task title');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('autocapitalize', 'sentences');
  });

  it('submits on Enter, inserts optimistically, clears, and stays open', async () => {
    render(QuickAddTask, { columnId: 'c1' });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    const input = screen.getByLabelText('Task title');

    await fireEvent.input(input, { target: { value: 'Sketch icons' } });
    await fireEvent.submit(input.closest('form')!);

    const created = board.tasks.find((t) => t.title === 'Sketch icons');
    expect(created).toBeDefined();
    expect(created?.column_id).toBe('c1');
    expect(created?.position).toBe(1000);
    expect(input).toHaveValue('');
    expect(screen.getByLabelText('Task title')).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/tasks');
    expect(await request.json()).toMatchObject({ title: 'Sketch icons', column_id: 'c1' });
  });

  it('scrolls the created card into view without stealing focus', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(QuickAddTask, { columnId: 'c1' });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    const input = screen.getByLabelText('Task title');
    await fireEvent.input(input, { target: { value: 'Scroll me' } });

    // The submit handler yields at tick() before its DOM query, so the card stub
    // for the just-generated id can be attached synchronously after dispatch.
    const submitted = fireEvent.submit(input.closest('form')!);
    const created = board.tasks.find((t) => t.title === 'Scroll me');
    expect(created).toBeDefined();
    const card = document.createElement('div');
    card.setAttribute('data-task-id', created!.id);
    document.body.appendChild(card);
    await submitted;

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });
    expect(scrollSpy.mock.contexts[0]).toBe(card);
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(input).toHaveFocus();
    card.remove();
    scrollSpy.mockRestore();
  });

  it('ignores empty submissions', async () => {
    render(QuickAddTask, { columnId: 'c1' });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    const input = screen.getByLabelText('Task title');

    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.submit(input.closest('form')!);

    expect(board.tasks).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    render(QuickAddTask, { columnId: 'c1' });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));

    await fireEvent.keyDown(screen.getByLabelText('Task title'), { key: 'Escape' });

    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add task' })).toBeInTheDocument();
  });
});
