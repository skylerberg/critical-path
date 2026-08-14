import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import QuickAddTask from './QuickAddTask.svelte';
import { board } from '../lib/board.svelte';
import { draftKey, drafts } from '../lib/drafts.svelte';
import { TASK_TITLE_MAX_LENGTH } from '../lib/titles';
import { motion } from '../lib/motion.svelte';
import { toasts } from '../lib/toasts.svelte';

const SERVER_TIME = '2026-01-15T00:00:00Z';

const payload = {
  project: {
    id: 'p1',
    name: 'Game',
    description: '',
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
  },
  columns: [{ id: 'c1', name: 'Todo', position: 1000, sort_key: 'V0000010001', is_done: false }],
  tasks: [],
  labels: [],
};

async function batchResponse(request: Request): Promise<Response> {
  const body = (await request.clone().json()) as {
    column_id: string;
    tasks: { id: string; title: string; position: number }[];
  };
  return jsonResponse(201, {
    tasks: body.tasks.map((item) => ({
      ...item,
      column_id: body.column_id,
      description: null,
      due_date: null,
      created_at: SERVER_TIME,
      updated_at: SERVER_TIME,
      label_ids: [],
      assignee_ids: [],
      blocker_ids: [],
      open_cross_project_blocker_count: 0,
      image_count: 0,
      comment_count: 0,
    })),
  });
}

// The reveal scrolls the column's own list, so the stub has to be that list with
// the card inside it, and rects — jsdom lays nothing out. The card is parked
// below the fold by default so a reveal has something to do.
function stubColumnList(taskId: string, cardTop = 380): HTMLElement {
  const list = document.createElement('div');
  list.setAttribute('data-task-list', 'c1');
  const card = document.createElement('div');
  card.setAttribute('data-task-id', taskId);
  list.appendChild(card);
  document.body.appendChild(list);
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 288, 400));
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, cardTop, 288, 60));
  return list;
}

afterEach(() => {
  document.querySelectorAll('[data-task-list]').forEach((el) => el.remove());
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
    if (new URL(request.url).pathname === '/api/tasks/batch') {
      return batchResponse(request);
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
    expect(input).toHaveAttribute('maxlength', String(TASK_TITLE_MAX_LENGTH));
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

  // scrollIntoView is the assertion that matters as much as the scroll itself: it
  // walks every scrollable ancestor, and one of a card's ancestors is the board's
  // horizontal snap scroller — which it pans, and which then resolves that pan
  // onto some other column. Adding a card may move nothing but its own list.
  it('scrolls the created card into view without stealing focus', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(QuickAddTask, { columnId: 'c1' });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    const input = screen.getByLabelText('Task title');
    await fireEvent.input(input, { target: { value: 'Scroll me' } });

    // The submit handler yields at tick() before its DOM query, so the card stub
    // for the just-generated id can be attached synchronously after dispatch.
    const submitted = fireEvent.submit(input.closest('form')!);
    const created = board.tasks.find((t) => t.title === 'Scroll me');
    expect(created).toBeDefined();
    const list = stubColumnList(created!.id);
    await submitted;

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });
    expect(scrollTo.mock.contexts[0]).toBe(list);
    expect(scrollTo).toHaveBeenCalledWith({ top: 40, behavior: 'smooth' });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
  });

  it('jumps the created card into view when motion is reduced', async () => {
    motion.reduced = true;
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    render(QuickAddTask, { columnId: 'c1' });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    const input = screen.getByLabelText('Task title');
    await fireEvent.input(input, { target: { value: 'Jump me' } });

    const submitted = fireEvent.submit(input.closest('form')!);
    const created = board.tasks.find((t) => t.title === 'Jump me');
    expect(created).toBeDefined();
    const list = stubColumnList(created!.id);
    await submitted;

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });
    expect(scrollTo.mock.contexts[0]).toBe(list);
    expect(scrollTo).toHaveBeenCalledWith({ top: 40, behavior: 'auto' });
    expect(input).toHaveFocus();
  });

  it('leaves the list alone when the created card already fits', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    render(QuickAddTask, { columnId: 'c1' });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    const input = screen.getByLabelText('Task title');
    await fireEvent.input(input, { target: { value: 'Already here' } });

    const submitted = fireEvent.submit(input.closest('form')!);
    const created = board.tasks.find((t) => t.title === 'Already here');
    stubColumnList(created!.id, 100);
    await submitted;

    expect(scrollTo).not.toHaveBeenCalled();
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
        { title: 'Alpha', sort_key: expect.any(String) },
        { title: 'Beta', sort_key: expect.any(String) },
        { title: 'Gamma', sort_key: expect.any(String) },
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

    // jsdom runs no paste default action, so the preserved draft only means
    // something alongside the preventDefault that preserves it in a browser.
    const event = pasteEvent(input, 'Alpha\nBeta');
    await fireEvent(input, event);

    expect(event.defaultPrevented).toBe(true);
    expect(drafts.get(draftKey.quickAddTask('c1'))).toBe('Half typed');
    expect(input).toHaveValue('Half typed');
  });

  it('does not scroll when the paste is over the batch limit', async () => {
    const input = await openComposer();
    await fireEvent(input, pasteEvent(input, 'Alpha\nBeta'));
    await waitFor(() => {
      expect(toasts.toasts.map((t) => t.message)).toContain('Added 2 tasks');
    });
    stubColumnList(board.tasksInColumn('c1').at(-1)!.id);
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');

    const lines = Array.from({ length: 101 }, (_, i) => `T${i}`).join('\n');
    await fireEvent(input, pasteEvent(input, lines));

    await waitFor(() => {
      expect(toasts.toasts.some((t) => t.message.includes('at most 100'))).toBe(true);
    });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(board.tasksInColumn('c1')).toHaveLength(2);
  });

  it('scrolls the last created card into view', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const input = await openComposer();

    // The paste handler yields at tick() before its DOM query, so the card stub
    // for the last created id can be attached synchronously after dispatch.
    const pasted = fireEvent(input, pasteEvent(input, 'Alpha\nBeta\nGamma'));
    const last = board.tasksInColumn('c1').at(-1);
    expect(last?.title).toBe('Gamma');
    const list = stubColumnList(last!.id);
    await pasted;

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });
    expect(scrollTo.mock.contexts[0]).toBe(list);
    expect(scrollTo).toHaveBeenCalledWith({ top: 40, behavior: 'smooth' });
    expect(scrollIntoView).not.toHaveBeenCalled();
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

  // Hover-only was what it had. jsdom resolves no :focus-visible rule, and axe
  // audits the resting page, so the class list is as close as either gets.
  it('gives the trigger the shared focus indicator', () => {
    render(QuickAddTask, { columnId: 'c1' });

    expect(screen.getByRole('button', { name: '+ Add task' }).classList).toContain('focus-ring');
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
