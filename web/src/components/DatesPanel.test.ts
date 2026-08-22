import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import DatesPanel from './DatesPanel.svelte';
import { board } from '../lib/board.svelte';
import { taskSeries, type TaskSeries } from '../lib/taskSeries.svelte';
import { toasts } from '../lib/toasts.svelte';
import type { BoardTask } from '../lib/board-types';

const task: BoardTask = {
  id: 't1',
  column_id: 'c1',
  title: 'Design cards',
  description: null,
  sort_key: 'V0000010001',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  column_since: '2026-01-01T00:00:00Z',
  label_ids: [],
  assignee_ids: [],
  blocker_ids: [],
  open_cross_project_blocker_count: 0,
  cover_image_url: null,
  due_date: null,
  comment_count: 0,
  checklist_item_count: 0,
  checklist_done_count: 0,
  attachment_count: 0,
};

const series: TaskSeries = {
  id: 's1',
  project_id: 'p1',
  column_id: 'c1',
  title: 'Design cards',
  description: null,
  due_date: null,
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  preset: 'weekly',
  summary: 'Every week on Monday',
  start_date: '2026-08-03',
  timezone: 'UTC',
  status: 'active',
  next_occurrence_date: '2026-08-10',
  last_occurrence_date: '2026-08-03',
  missed_occurrence_count: 0,
  last_missed_date: null,
  open_occurrence_count: 1,
  last_error: null,
  ended_at: null,
  created_by: 'u1',
  created_at: '2026-08-03T00:00:00Z',
  updated_at: '2026-08-03T00:00:00Z',
  label_ids: [],
  assignee_ids: [],
  checklist_items: [],
};

// No route for the project's series list: the panel is not supposed to ask for
// one, and an unrouted request would 404 into a toast rather than pass quietly.
function route(handler: (pathname: string, request: Request) => Response | undefined): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const { pathname } = new URL(request.url);
    return handler(pathname, request) ?? jsonResponse(200, { ...task, due_date: null });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  route(() => undefined);
  board.reset();
  board.currentProjectId = 'p1';
  board.tasks = [{ ...task }];
  taskSeries.reset();
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function patchBody(index = 0): Promise<unknown> {
  const request = requestAt(index);
  expect(request.method).toBe('PATCH');
  expect(new URL(request.url).pathname).toBe('/api/tasks/t1');
  return request.clone().json();
}

// The card alone: no series list is seeded, because the panel is not allowed to
// need one.
function repeating(overrides: Partial<TaskSeries> = {}): void {
  const row = { ...series, ...overrides };
  board.setTaskSeriesRef('t1', {
    id: row.id,
    summary: row.summary,
    preset: row.preset,
    start_date: row.start_date,
  });
}

function repeatsSelect(): HTMLSelectElement {
  return screen.getByLabelText('Repeats');
}

describe('DatesPanel due date', () => {
  it('opens on the field, focused, ready to be typed into', () => {
    render(DatesPanel, { taskId: 't1' });

    const input = screen.getByLabelText('Due date');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('patches the date it is given', async () => {
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-08-03' } });

    expect(await patchBody()).toEqual({ due_date: '2026-08-03' });
    await waitFor(() => {
      expect(board.tasks[0]!.due_date).toBe('2026-08-03');
    });
  });

  it('shows an existing date pre-filled', () => {
    board.tasks = [{ ...task, due_date: '2026-08-03' }];
    render(DatesPanel, { taskId: 't1' });

    expect(screen.getByLabelText('Due date')).toHaveValue('2026-08-03');
  });

  it('clears the date and tells the caller the section is empty', async () => {
    board.tasks = [{ ...task, due_date: '2026-08-03' }];
    const oncleared = vi.fn();
    render(DatesPanel, { taskId: 't1', oncleared });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await patchBody()).toEqual({ due_date: null });
    expect(oncleared).toHaveBeenCalledOnce();
  });

  it('offers nothing to clear when there is no date yet', () => {
    render(DatesPanel, { taskId: 't1' });

    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('leaves the date alone while the field is empty mid-edit', async () => {
    board.tasks = [{ ...task, due_date: '2026-08-03' }];
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Due date')).toBeInTheDocument();
    expect(board.tasks[0]!.due_date).toBe('2026-08-03');
  });
});

describe('DatesPanel recurrence', () => {
  it('offers the curated recurrences to a card that does not repeat', () => {
    render(DatesPanel, { taskId: 't1' });

    expect(repeatsSelect()).toHaveValue('none');
    expect(
      [...repeatsSelect().options].map((option) => option.value).filter((value) => value !== 'none')
    ).toEqual(['daily', 'weekdays', 'weekly', 'monthly_date', 'monthly_weekday', 'yearly']);
    expect(screen.queryByLabelText('Starts on')).toBeNull();
  });

  it('makes the card repeat and names the recurrence on it', async () => {
    route((pathname) =>
      pathname === '/api/tasks/t1/series'
        ? jsonResponse(201, { ...series, dropped_image_count: 0 })
        : undefined
    );
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'weekly' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));

    await waitFor(() => {
      expect(board.taskSeriesRefs['t1']).toEqual({
        id: 's1',
        summary: 'Every week on Monday',
        preset: 'weekly',
        start_date: '2026-08-03',
      });
    });
    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/tasks/t1/series');
    expect(await request.clone().json()).toMatchObject({ preset: 'weekly' });
  });

  // The field the panel puts up has to reach the create it is labelling: sending
  // the POST on the select's change fixes the start at today, and the only state
  // the field is ever editable in is one where the series already exists.
  it('starts the series on the date typed into Starts on', async () => {
    route((pathname) =>
      pathname === '/api/tasks/t1/series'
        ? jsonResponse(201, { ...series, start_date: '2026-09-14' })
        : undefined
    );
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'weekly' } });
    await fireEvent.input(screen.getByLabelText('Starts on'), {
      target: { value: '2026-09-14' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));

    await waitFor(() => {
      expect(board.taskSeriesRefs['t1']?.start_date).toBe('2026-09-14');
    });
    expect(await requestAt(0).clone().json()).toMatchObject({
      preset: 'weekly',
      start_date: '2026-09-14',
    });
  });

  it('asks for a start date before the card repeats', async () => {
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'weekly' } });

    expect(screen.getByLabelText('Starts on')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(board.taskSeriesRefs['t1']).toBeUndefined();
  });

  it('names the presets against the start date being chosen', async () => {
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'weekly' } });
    await fireEvent.input(screen.getByLabelText('Starts on'), {
      target: { value: '2026-09-14' },
    });

    const weekly = [...repeatsSelect().options].find((option) => option.value === 'weekly');
    expect(weekly?.textContent).toBe('Every week on Monday');

    // A date input reports '' for every keystroke of a half-typed value, and an
    // empty one is 30 November 1899 to Date.UTC.
    await fireEvent.input(screen.getByLabelText('Starts on'), { target: { value: '' } });
    expect(weekly?.textContent).toBe('Every week');
    expect(screen.getByRole('button', { name: 'Start repeating' })).toBeDisabled();
  });

  it('drops the pending recurrence when the start is cancelled', async () => {
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'weekly' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(repeatsSelect()).toHaveValue('none');
    });
    expect(screen.queryByLabelText('Starts on')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preselects the recurrence a repeating card already has', async () => {
    repeating();
    render(DatesPanel, { taskId: 't1' });

    await waitFor(() => {
      expect(repeatsSelect()).toHaveValue('weekly');
    });
    expect(screen.queryByLabelText('Starts on')).toBeNull();
  });

  it('changes the rule of a card that already repeats', async () => {
    repeating();
    route((pathname) =>
      pathname === '/api/task-series/s1'
        ? jsonResponse(200, { ...series, preset: 'daily', summary: 'Every day' })
        : undefined
    );
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'daily' } });

    await waitFor(() => {
      expect(board.taskSeriesRefs['t1']?.summary).toBe('Every day');
    });
    const request = fetchMock.mock.calls
      .map((call) => call[0] as Request)
      .find((candidate) => candidate.method === 'PATCH');
    expect(request).toBeDefined();
    expect(await request!.clone().json()).toEqual({ preset: 'daily' });
  });

  it('confirms before it stops a card repeating', async () => {
    repeating();
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'none' } });

    expect(fetchMock.mock.calls.every((call) => (call[0] as Request).method !== 'DELETE')).toBe(
      true
    );
    expect(screen.getByText(/Stop this card repeating\?/)).toBeInTheDocument();

    route((pathname) => (pathname === '/api/task-series/s1' ? jsonResponse(204) : undefined));
    await fireEvent.click(screen.getByRole('button', { name: 'Stop repeating' }));

    await waitFor(() => {
      expect(board.taskSeriesRefs['t1']).toBeNull();
    });
  });

  it('leaves the series alone when the stop is cancelled', async () => {
    repeating();
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'none' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/Stop this card repeating\?/)).toBeNull();
    await waitFor(() => {
      expect(repeatsSelect()).toHaveValue('weekly');
    });
    expect(board.taskSeriesRefs['t1']).toEqual({
      id: 's1',
      summary: 'Every week on Monday',
      preset: 'weekly',
      start_date: '2026-08-03',
    });
  });

  it('names a rule set outside the app without offering to re-pick it', async () => {
    repeating({ preset: null, summary: 'Every other Tuesday' });
    render(DatesPanel, { taskId: 't1' });

    await waitFor(() => {
      expect(repeatsSelect()).toHaveValue('custom');
    });
    const custom = [...repeatsSelect().options].find((option) => option.value === 'custom');
    expect(custom?.textContent).toBe('Every other Tuesday');
    expect(custom?.disabled).toBe(true);
  });

  // The whole point of carrying the rule on the card: there is no window in
  // which the panel knows the card repeats but not what it repeats on, so it
  // renders right away and asks the server for nothing.
  it('renders the rule without reading the project’s series list', async () => {
    repeating();
    render(DatesPanel, { taskId: 't1' });

    expect(repeatsSelect()).toHaveValue('weekly');
    expect(repeatsSelect()).not.toBeDisabled();
    // A request an effect starts does not reach fetch until the next microtask,
    // so a synchronous assertion here could only ever observe zero calls.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Stop this card repeating\?/)).toBeNull();
  });
});

describe('DatesPanel recurrence failures', () => {
  it('says why the series could not be created and keeps the choice for a retry', async () => {
    route((pathname) =>
      pathname === '/api/tasks/t1/series'
        ? jsonResponse(422, { error: 'rrule must be parseable' })
        : undefined
    );
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'weekly' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('rrule must be parseable');
    expect(board.taskSeriesRefs['t1']).toBeUndefined();
    // The card still does not repeat, and the same preset can be sent again
    // without reselecting it — which a select fires no change event for.
    expect(repeatsSelect()).toHaveValue('weekly');
    expect(screen.getByRole('button', { name: 'Start repeating' })).toBeEnabled();
  });

  it('falls back to the rule the card still has when the change is refused', async () => {
    repeating();
    route((pathname) =>
      pathname === '/api/task-series/s1'
        ? jsonResponse(403, { error: 'Read-only access to this project' })
        : undefined
    );
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'daily' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Read-only access to this project');
    await waitFor(() => {
      expect(repeatsSelect()).toHaveValue('weekly');
    });
    expect(board.taskSeriesRefs['t1']?.preset).toBe('weekly');
  });

  // remove() reports a refused delete by returning false rather than throwing,
  // so a card cleared regardless would name no recurrence on a card that has one.
  it('keeps the recurrence on the card when the delete is refused', async () => {
    repeating();
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'none' } });

    route((pathname) =>
      pathname === '/api/task-series/s1' ? jsonResponse(500, { error: 'Boom' }) : undefined
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Stop repeating' }));

    await waitFor(() => {
      expect(toasts.toasts.map((toast) => toast.message)).toEqual(['Boom']);
    });
    expect(board.taskSeriesRefs['t1']).toEqual({
      id: 's1',
      summary: 'Every week on Monday',
      preset: 'weekly',
      start_date: '2026-08-03',
    });
  });
});
