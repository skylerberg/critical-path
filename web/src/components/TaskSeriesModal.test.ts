import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import TaskSeriesModal from './TaskSeriesModal.svelte';
import { board } from '../lib/board.svelte';
import { session } from '../lib/session.svelte';
import { taskSeries, type TaskSeries } from '../lib/taskSeries.svelte';
import { users } from '../lib/users.svelte';

function series(overrides: Partial<TaskSeries> = {}): TaskSeries {
  return {
    id: 's-1',
    project_id: 'p-1',
    column_id: 'c-1',
    title: 'Weekly review',
    description: null,
    due_date: null,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    preset: 'weekly',
    summary: 'Every Monday',
    start_date: '2026-02-02',
    timezone: 'Europe/Berlin',
    status: 'active',
    next_occurrence_date: '2099-02-09',
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

function asEditor(): void {
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
    { id: 'c-1', name: 'Todo', position: 1000, sort_key: 'V0000010001', is_done: false },
    { id: 'c-2', name: 'Done', position: 2000, sort_key: 'V0000020001', is_done: true },
  ];
  board.labels = [{ id: 'l-1', name: 'ops', color: '#ff0000' }];
}

function asViewer(): void {
  asEditor();
  session.user = {
    id: 'u-2',
    email: 'v@example.com',
    name: 'Vi',
    avatar_url: null,
    email_verified: true,
  };
}

function renderWith(rows: TaskSeries[]) {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { series: rows }));
  return render(TaskSeriesModal, { projectId: 'p-1', onclose: () => {} });
}

beforeEach(() => {
  fetchMock.mockReset();
  taskSeries.reset();
  asEditor();
});

describe('TaskSeriesModal', () => {
  it('shows a loading state until the list lands', async () => {
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
    render(TaskSeriesModal, { projectId: 'p-1', onclose: () => {} });

    expect(await screen.findByText('Loading recurring cards…')).toBeInTheDocument();
  });

  it('offers a retry when the list fails to load', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'Service unavailable' }));
    render(TaskSeriesModal, { projectId: 'p-1', onclose: () => {} });

    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { series: [series()] }));
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Weekly review')).toBeInTheDocument();
  });

  it('says so when a project has no series, and offers to add one', async () => {
    renderWith([]);

    expect(await screen.findByText('No recurring cards yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New recurring card' })).toBeInTheDocument();
  });

  it('renders the rule, the next card and where it lands', async () => {
    renderWith([series()]);

    expect(await screen.findByText('Weekly review')).toBeInTheDocument();
    expect(screen.getByText('Every Monday')).toBeInTheDocument();
    expect(screen.getByText(/Next card: Feb 9, 2099/)).toBeInTheDocument();
    expect(screen.getByText('Lands in Todo')).toBeInTheDocument();
  });

  it('names who set a series up, including when that account is gone', async () => {
    users.upsert({ id: 'u-1', name: 'Ed', avatar_url: null });
    renderWith([
      series(),
      series({ id: 's-2', title: 'Yearly audit', created_by: null }),
      series({ id: 's-3', title: 'Quarterly review', created_by: 'u-9' }),
    ]);

    expect(await screen.findByText('Set up by Ed')).toBeInTheDocument();
    expect(screen.getByText('Set up by a deleted account')).toBeInTheDocument();
    expect(screen.getByText('Set up by Unknown user')).toBeInTheDocument();
  });

  it('asks for a destination when the column is gone', async () => {
    renderWith([series({ column_id: null })]);

    expect(await screen.findByText('Choose a destination column')).toBeInTheDocument();
  });

  it('marks a paused series and a finished one', async () => {
    renderWith([
      series({ status: 'paused' }),
      series({ id: 's-2', title: 'Yearly audit', status: 'ended', next_occurrence_date: null }),
    ]);

    expect(await screen.findByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('Finished')).toBeInTheDocument();
    // Neither promises a next card, including the paused one, which still holds
    // the date it was going to fire on.
    expect(screen.getAllByText('Next card: —')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Resume Weekly review' })).toBeInTheDocument();
  });

  it('reports missed occurrences and dismisses them', async () => {
    renderWith([series({ missed_occurrence_count: 3, last_missed_date: '2026-02-05' })]);

    expect(await screen.findByRole('status')).toHaveTextContent(
      '3 occurrences were missed while the scheduler was behind.'
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(200, series()));
    await fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss missed occurrences for Weekly review' })
    );
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('says when more than one card from the series is still open', async () => {
    renderWith([series({ open_occurrence_count: 2 })]);

    expect(await screen.findByText('2 cards from this series are still open.')).toBeInTheDocument();
  });

  it('shows the last error under the row', async () => {
    renderWith([series({ last_error: 'rrule must be parseable' })]);

    expect(await screen.findByText('rrule must be parseable')).toBeInTheDocument();
  });

  it('gives a viewer the list and no actions', async () => {
    asViewer();
    renderWith([series()]);

    expect(await screen.findByText('Weekly review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pause/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New recurring card' })).not.toBeInTheDocument();
  });

  it('spells out what delete does before doing it', async () => {
    renderWith([series()]);

    const first = await screen.findByRole('button', { name: 'Delete Weekly review' });
    await fireEvent.click(first);

    const confirm = screen.getByRole('button', { name: 'Confirm delete of Weekly review' });
    expect(confirm).toHaveTextContent('Confirm — cards already created stay');

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await fireEvent.click(confirm);
    await waitFor(() => {
      expect(screen.queryByText('Weekly review')).not.toBeInTheDocument();
    });
  });

  it('paints nothing from the previous project while the next one loads', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { series: [series()] }));
    await taskSeries.load('p-0');
    expect(taskSeries.list).toHaveLength(1);

    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
    render(TaskSeriesModal, { projectId: 'p-1', onclose: () => {} });

    expect(await screen.findByText('Loading recurring cards…')).toBeInTheDocument();
    expect(screen.queryByText('Weekly review')).not.toBeInTheDocument();
  });
});

describe('TaskSeriesModal live updates', () => {
  function realtime(type: string, data: unknown) {
    taskSeries.applyRealtime({ type, project_id: 'p-1', data });
  }

  it('adds, changes and removes a row while the panel is open', async () => {
    renderWith([series()]);
    expect(await screen.findByText('Weekly review')).toBeInTheDocument();

    realtime('series_created', series({ id: 's-2', title: 'Monthly invoices' }));
    expect(await screen.findByText('Monthly invoices')).toBeInTheDocument();

    realtime('series_updated', series({ status: 'paused' }));
    expect(await screen.findByText('Paused')).toBeInTheDocument();

    realtime('series_deleted', { id: 's-1' });
    await waitFor(() => {
      expect(screen.queryByText('Weekly review')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Monthly invoices')).toBeInTheDocument();
  });

  it('shows an advanced schedule and a fresh missed count from the sweep', async () => {
    renderWith([series()]);
    expect(await screen.findByText('Weekly review')).toBeInTheDocument();

    realtime(
      'series_updated',
      series({ next_occurrence_date: '2099-02-16', missed_occurrence_count: 2 })
    );

    expect(await screen.findByText(/2 occurrences were missed/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Dismiss missed occurrences for Weekly review' })
    ).toBeInTheDocument();
  });

  it('says so when the series being edited is deleted by someone else', async () => {
    renderWith([series()]);
    await fireEvent.click(await screen.findByRole('button', { name: 'Edit Weekly review' }));
    expect(await screen.findByRole('form', { name: 'Recurring card' })).toBeInTheDocument();

    realtime('series_deleted', { id: 's-1' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This recurring card was deleted while you were editing it.'
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(await screen.findByText('No recurring cards yet.')).toBeInTheDocument();
  });

  it('does not call an editing row deleted merely because the list went away', async () => {
    renderWith([series()]);
    await fireEvent.click(await screen.findByRole('button', { name: 'Edit Weekly review' }));
    expect(await screen.findByRole('form', { name: 'Recurring card' })).toBeInTheDocument();

    taskSeries.reset();

    expect(await screen.findByText('Loading recurring cards…')).toBeInTheDocument();
    expect(screen.queryByText(/was deleted while you were editing it/)).not.toBeInTheDocument();
  });

  it('leaves the open form alone when the series it edits is changed elsewhere', async () => {
    renderWith([series()]);
    await fireEvent.click(await screen.findByRole('button', { name: 'Edit Weekly review' }));
    const title = await screen.findByLabelText('Title');
    await fireEvent.input(title, { target: { value: 'My own wording' } });

    realtime('series_updated', series({ title: 'Their wording' }));

    await waitFor(() => {
      expect(title).toHaveValue('My own wording');
    });
  });
});
