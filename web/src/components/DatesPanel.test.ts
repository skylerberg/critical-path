import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import DatesPanel from './DatesPanel.svelte';
import { board } from '../lib/board.svelte';
import { taskSeries, type TaskSeries } from '../lib/taskSeries.svelte';
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

// The panel's own reads are the task PATCH and the series calls; anything else a
// mounted store reaches for resolves to something harmless rather than 404ing
// into an error toast the assertions would then have to ignore.
function route(handler: (pathname: string, request: Request) => Response | undefined): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const { pathname } = new URL(request.url);
    return (
      handler(pathname, request) ??
      (pathname === '/api/task-series'
        ? jsonResponse(200, { series: [series] })
        : jsonResponse(200, { ...task, due_date: null }))
    );
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  route(() => undefined);
  board.reset();
  board.currentProjectId = 'p1';
  board.tasks = [{ ...task }];
  taskSeries.reset();
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

function repeating(overrides: Partial<TaskSeries> = {}): void {
  const row = { ...series, ...overrides };
  board.setTaskSeriesRef('t1', { id: row.id, summary: row.summary });
  taskSeries.currentProjectId = 'p1';
  taskSeries.list = [row];
  taskSeries.loaded = true;
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

    await waitFor(() => {
      expect(board.taskSeriesRefs['t1']).toEqual({ id: 's1', summary: 'Every week on Monday' });
    });
    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/tasks/t1/series');
    expect(await request.clone().json()).toMatchObject({ preset: 'weekly' });
  });

  it('asks for a start date before the card repeats', async () => {
    render(DatesPanel, { taskId: 't1' });

    await fireEvent.change(repeatsSelect(), { target: { value: 'weekly' } });

    expect(screen.getByLabelText('Starts on')).toBeInTheDocument();
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
    expect(board.taskSeriesRefs['t1']).toEqual({ id: 's1', summary: 'Every week on Monday' });
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

  it('says nothing about repeating until the rule it holds has loaded', () => {
    board.setTaskSeriesRef('t1', { id: 's1', summary: 'Every week on Monday' });
    render(DatesPanel, { taskId: 't1' });

    expect(repeatsSelect()).toHaveValue('custom');
    expect(repeatsSelect()).toBeDisabled();
    expect(screen.queryByText(/Stop this card repeating\?/)).toBeNull();
  });
});
