import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import QuickAddTask from './QuickAddTask.svelte';
import { board } from '../lib/board.svelte';
import { draftKey, drafts } from '../lib/drafts.svelte';
import { motion } from '../lib/motion.svelte';
import { toasts } from '../lib/toasts.svelte';

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
  drafts.clearAll();
  motion.reduced = false;
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
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
    expect(drafts.get(draftKey.quickAddTask('c1'))).toBe('');

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

  it('jumps the created card into view when motion is reduced', async () => {
    motion.reduced = true;
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(QuickAddTask, { columnId: 'c1' });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    const input = screen.getByLabelText('Task title');
    await fireEvent.input(input, { target: { value: 'Jump me' } });

    const submitted = fireEvent.submit(input.closest('form')!);
    const created = board.tasks.find((t) => t.title === 'Jump me');
    expect(created).toBeDefined();
    const card = document.createElement('div');
    card.setAttribute('data-task-id', created!.id);
    document.body.appendChild(card);
    await submitted;

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });
    expect(scrollSpy.mock.contexts[0]).toBe(card);
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
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
    expect(drafts.get(draftKey.quickAddTask('c1'))).toBeNull();
  });
});

describe('QuickAddTask multi-line paste', () => {
  async function openComposer(): Promise<HTMLElement> {
    render(QuickAddTask, { columnId: 'c1' });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    return screen.getByLabelText('Task title');
  }

  function pasteEvent(input: HTMLElement, text: string): Event {
    return createEvent.paste(input, { clipboardData: { getData: () => text } });
  }

  it('creates one task per line', async () => {
    const input = await openComposer();

    const event = pasteEvent(input, 'Alpha\r\nBeta\n\n  Gamma  ');
    await fireEvent(input, event);

    expect(event.defaultPrevented).toBe(true);
    expect(board.tasksInColumn('c1').map((t) => t.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(board.tasksInColumn('c1').map((t) => t.position)).toEqual([1000, 2000, 3000]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/tasks/batch');
    expect(await request.json()).toMatchObject({
      project_id: 'p1',
      column_id: 'c1',
      tasks: [
        { title: 'Alpha', position: 1000 },
        { title: 'Beta', position: 2000 },
        { title: 'Gamma', position: 3000 },
      ],
    });

    expect(screen.getByLabelText('Task title')).toBeInTheDocument();
    expect(input).toHaveFocus();
    await waitFor(() => {
      expect(toasts.toasts.map((t) => t.message)).toEqual(['Added 3 tasks']);
    });
    expect(toasts.toasts[0]!.variant).toBe('success');
  });

  it('shows no success toast when the batch fails', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'GET') {
        return jsonResponse(200, payload);
      }
      return jsonResponse(422, { error: 'nope' });
    });
    const input = await openComposer();

    await fireEvent(input, pasteEvent(input, 'Alpha\nBeta'));

    await waitFor(() => {
      expect(toasts.toasts.map((t) => t.message)).toContain('nope');
    });
    expect(board.tasks).toHaveLength(0);
    expect(toasts.toasts.some((t) => /^Added /.test(t.message))).toBe(false);
  });

  it('leaves a single-line paste to the browser', async () => {
    const input = await openComposer();

    for (const text of ['Only one', 'Only one\n']) {
      const event = pasteEvent(input, text);
      await fireEvent(input, event);

      expect(event.defaultPrevented).toBe(false);
    }
    expect(board.tasks).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the typed draft', async () => {
    const input = await openComposer();
    await fireEvent.input(input, { target: { value: 'Half typed' } });

    await fireEvent(input, pasteEvent(input, 'Alpha\nBeta'));

    expect(drafts.get(draftKey.quickAddTask('c1'))).toBe('Half typed');
    expect(input).toHaveValue('Half typed');
  });

  it('scrolls the last created card into view', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    const input = await openComposer();

    // The paste handler yields at tick() before its DOM query, so the card stub
    // for the last created id can be attached synchronously after dispatch.
    const pasted = fireEvent(input, pasteEvent(input, 'Alpha\nBeta\nGamma'));
    const last = board.tasksInColumn('c1').at(-1);
    expect(last?.title).toBe('Gamma');
    const card = document.createElement('div');
    card.setAttribute('data-task-id', last!.id);
    document.body.appendChild(card);
    await pasted;

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });
    expect(scrollSpy.mock.contexts[0]).toBe(card);
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    card.remove();
    scrollSpy.mockRestore();
  });
});

describe('QuickAddTask drafts', () => {
  async function typeTitle(columnId: string, value: string): Promise<void> {
    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value } });
    expect(drafts.get(draftKey.quickAddTask(columnId))).toBe(value);
  }

  it('restores an unsent title on remount without stealing focus', async () => {
    const first = render(QuickAddTask, { columnId: 'c1' });
    await typeTitle('c1', 'Half typed');
    first.unmount();

    render(QuickAddTask, { columnId: 'c1' });

    const restored = screen.getByLabelText('Task title');
    expect(restored).toHaveValue('Half typed');
    expect(restored).not.toHaveFocus();
  });

  it('stays open when the text is emptied', async () => {
    render(QuickAddTask, { columnId: 'c1' });
    await typeTitle('c1', 'Half typed');

    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value: '' } });

    expect(screen.getByLabelText('Task title')).toBeInTheDocument();
  });

  it('stays closed on remount after Escape discarded the draft', async () => {
    const first = render(QuickAddTask, { columnId: 'c1' });
    await typeTitle('c1', 'Discard me');
    await fireEvent.keyDown(screen.getByLabelText('Task title'), { key: 'Escape' });
    first.unmount();

    render(QuickAddTask, { columnId: 'c1' });

    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add task' })).toBeInTheDocument();
  });

  it('does not leak a draft into another column', async () => {
    const first = render(QuickAddTask, { columnId: 'c1' });
    await typeTitle('c1', 'Column one only');
    first.unmount();

    render(QuickAddTask, { columnId: 'c2' });

    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add task' })).toBeInTheDocument();
  });
});
