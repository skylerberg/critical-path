import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import TaskSeriesEditor from './TaskSeriesEditor.svelte';
import { board } from '../lib/board.svelte';
import { session } from '../lib/session.svelte';
import { taskSeries, type TaskSeries } from '../lib/taskSeries.svelte';

function series(overrides: Partial<TaskSeries> = {}): TaskSeries {
  return {
    id: 's-1',
    project_id: 'p-1',
    column_id: 'c-1',
    title: 'Weekly review',
    description: null,
    due_date: null,
    rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    preset: null,
    summary: 'every 2 weeks on Monday',
    start_date: '2026-02-02',
    timezone: 'Europe/Berlin',
    status: 'active',
    next_occurrence_date: '2026-02-09',
    last_occurrence_date: null,
    missed_occurrence_count: 0,
    last_missed_date: null,
    open_occurrence_count: 0,
    last_error: null,
    ended_at: null,
    created_by: 'u-1',
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
    label_ids: [],
    assignee_ids: [],
    checklist_items: [],
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  taskSeries.reset();
  session.user = {
    id: 'u-1',
    email: 'e@example.com',
    name: 'Ed',
    avatar_url: null,
    email_verified: true,
  };
  board.project = {
    id: 'p-1',
    name: 'Project',
    description: '',
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: 'u-1',
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
  };
  board.columns = [
    { id: 'c-1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
    { id: 'c-2', name: 'Doing', sort_key: 'V0000020001', is_done: false },
  ];
  board.labels = [];
  // The users store fetches the project roster on mount.
  fetchMock.mockResolvedValue(jsonResponse(200, { users: [] }));
});

describe('TaskSeriesEditor', () => {
  it('relabels the recurrence options as the start date moves', async () => {
    render(TaskSeriesEditor, {
      projectId: 'p-1',
      onsaved: () => {},
      oncancel: () => {},
    });

    const startDate = screen.getByLabelText('Starts on');
    await fireEvent.input(startDate, { target: { value: '2026-02-02' } });
    expect(await screen.findByRole('option', { name: 'Every week on Monday' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Monthly on the 2nd' })).toBeInTheDocument();

    await fireEvent.input(startDate, { target: { value: '2026-02-03' } });
    expect(
      await screen.findByRole('option', { name: 'Every week on Tuesday' })
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Monthly on the 3rd' })).toBeInTheDocument();
  });

  it('posts what the form holds and reports the series it gets back', async () => {
    const onsaved = vi.fn();
    render(TaskSeriesEditor, { projectId: 'p-1', onsaved, oncancel: () => {} });

    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: '  Invoice  ' } });
    await fireEvent.input(screen.getByLabelText('Starts on'), { target: { value: '2026-03-31' } });
    await fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'monthly_date' } });
    await fireEvent.change(screen.getByLabelText('Destination column'), {
      target: { value: 'c-2' },
    });
    await fireEvent.input(screen.getByLabelText('Due date (optional)'), {
      target: { value: '2026-04-15' },
    });
    await fireEvent.input(screen.getByLabelText('Add an item'), { target: { value: 'Check VAT' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { ...series({ preset: 'monthly_date' }), dropped_image_count: 0 })
    );
    await fireEvent.submit(screen.getByRole('form', { name: 'Recurring card' }));

    await waitFor(() => {
      expect(onsaved).toHaveBeenCalled();
    });
    const posted = JSON.parse(
      String(await requestAt(fetchMock.mock.calls.length - 1).text())
    ) as Record<string, unknown>;
    expect(posted).toMatchObject({
      project_id: 'p-1',
      column_id: 'c-2',
      title: 'Invoice',
      start_date: '2026-03-31',
      preset: 'monthly_date',
      due_date: '2026-04-15',
      checklist_items: [{ text: 'Check VAT' }],
    });
    expect(typeof posted.timezone).toBe('string');
  });

  it('surfaces a rejection inline instead of closing', async () => {
    const onsaved = vi.fn();
    render(TaskSeriesEditor, { projectId: 'p-1', onsaved, oncancel: () => {} });

    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Invoice' } });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { error: 'Project already has the maximum of 50 recurring series' })
    );
    await fireEvent.submit(screen.getByRole('form', { name: 'Recurring card' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Project already has the maximum of 50 recurring series'
    );
    expect(onsaved).not.toHaveBeenCalled();
  });

  it('refuses to submit without a title', async () => {
    render(TaskSeriesEditor, { projectId: 'p-1', onsaved: () => {}, oncancel: () => {} });

    await fireEvent.submit(screen.getByRole('form', { name: 'Recurring card' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the card a title');
  });

  it('shows a rule set outside the app as a selected, disabled Custom option', async () => {
    render(TaskSeriesEditor, {
      projectId: 'p-1',
      series: series(),
      onsaved: () => {},
      oncancel: () => {},
    });

    const custom = await screen.findByRole('option', { name: 'Custom' });
    expect(custom).toBeDisabled();
    const select = screen.getByLabelText('Repeats') as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent?.trim()).toBe('Custom');
    expect(screen.getByText('every 2 weeks on Monday')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This rule was set outside the app. Choosing a recurrence above replaces it.'
      )
    ).toBeInTheDocument();
  });

  it('leaves a custom rule alone when only the template changes', async () => {
    const onsaved = vi.fn();
    render(TaskSeriesEditor, {
      projectId: 'p-1',
      series: series(),
      onsaved,
      oncancel: () => {},
    });

    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, series({ title: 'Renamed' })));
    await fireEvent.submit(screen.getByRole('form', { name: 'Recurring card' }));

    await waitFor(() => {
      expect(onsaved).toHaveBeenCalled();
    });
    const sent = JSON.parse(
      String(await requestAt(fetchMock.mock.calls.length - 1).text())
    ) as Record<string, unknown>;
    expect(sent.title).toBe('Renamed');
    expect(sent).not.toHaveProperty('preset');
  });

  it('names the timezone occurrences arrive in and offers no lead time', async () => {
    render(TaskSeriesEditor, {
      projectId: 'p-1',
      series: series(),
      onsaved: () => {},
      oncancel: () => {},
    });

    expect(
      await screen.findByText(
        'Each card appears on the day its turn comes round, at midnight in Europe/Berlin.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Card appears')).not.toBeInTheDocument();
  });

  it('carries the template due date through an edit and can clear it', async () => {
    const onsaved = vi.fn();
    render(TaskSeriesEditor, {
      projectId: 'p-1',
      series: series({ due_date: '2026-05-01' }),
      onsaved,
      oncancel: () => {},
    });

    const due = screen.getByLabelText('Due date (optional)') as HTMLInputElement;
    expect(due.value).toBe('2026-05-01');

    await fireEvent.input(due, { target: { value: '' } });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, series({ due_date: null })));
    await fireEvent.submit(screen.getByRole('form', { name: 'Recurring card' }));

    await waitFor(() => {
      expect(onsaved).toHaveBeenCalled();
    });
    const sent = JSON.parse(
      String(await requestAt(fetchMock.mock.calls.length - 1).text())
    ) as Record<string, unknown>;
    expect(sent.due_date).toBeNull();
  });
});
