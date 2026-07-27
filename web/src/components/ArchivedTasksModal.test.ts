import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ArchivedTasksModal from './ArchivedTasksModal.svelte';
import { board } from '../lib/board.svelte';
import type { ArchivedTask } from '../lib/board-types';

const ARCHIVED_AT = '2026-03-01T12:00:00Z';
const ARCHIVED_LABEL = `Archived ${new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(ARCHIVED_AT))}`;

function archived(id: string, title: string, columnId = 'c1'): ArchivedTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    archived_at: ARCHIVED_AT,
  };
}

function mockArchive(tasks: ArchivedTask[]): void {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL((input as Request).url);
    if (url.pathname === '/api/projects/p1/archived-tasks') {
      return jsonResponse(200, { tasks });
    }
    return jsonResponse(204);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  board.currentProjectId = 'p1';
  board.columns = [
    { id: 'c1', name: 'Todo', position: 1000, is_done: false },
    { id: 'c2', name: 'Done', position: 2000, is_done: true },
  ];
});

describe('ArchivedTasksModal', () => {
  it('fetches on mount and renders each row with its column and a restore control', async () => {
    mockArchive([archived('t1', 'Old idea'), archived('t2', 'Shipped thing', 'c2')]);

    render(ArchivedTasksModal, { open: true, onclose: () => {} });

    await waitFor(() => expect(screen.getByText('Old idea')).toBeInTheDocument());
    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects/p1/archived-tasks');
    expect(screen.getByText(`Todo · ${ARCHIVED_LABEL}`)).toBeInTheDocument();
    expect(screen.getByText(`Done · ${ARCHIVED_LABEL}`)).toBeInTheDocument();
    expect(screen.getByLabelText('Restore card Old idea')).toBeInTheDocument();
    expect(screen.getByLabelText('Restore card Shipped thing')).toBeInTheDocument();
  });

  it('renders the date alone when the column is gone', async () => {
    mockArchive([archived('t1', 'Orphan', 'missing')]);

    render(ArchivedTasksModal, { open: true, onclose: () => {} });

    await waitFor(() => expect(screen.getByText('Orphan')).toBeInTheDocument());
    expect(screen.getByText(ARCHIVED_LABEL)).toBeInTheDocument();
  });

  // A card that is off the board is not overdue, so it must not carry the pill's
  // urgency into the archive.
  it('says nothing about a due date the archived card still holds', async () => {
    mockArchive([{ ...archived('t1', 'Old idea'), due_date: '2020-01-04' }]);

    render(ArchivedTasksModal, { open: true, onclose: () => {} });

    await waitFor(() => expect(screen.getByText('Old idea')).toBeInTheDocument());
    expect(screen.queryByTitle(/^Due /)).toBeNull();
    expect(screen.queryByText(/2020/)).toBeNull();
  });

  it('filters rows by title and explains an empty result', async () => {
    mockArchive([archived('t1', 'Old idea'), archived('t2', 'Shipped thing')]);

    render(ArchivedTasksModal, { open: true, onclose: () => {} });
    await waitFor(() => expect(screen.getByText('Old idea')).toBeInTheDocument());

    const search = screen.getByLabelText('Search archived cards');
    await fireEvent.input(search, { target: { value: 'shipped' } });
    expect(screen.queryByText('Old idea')).toBeNull();
    expect(screen.getByText('Shipped thing')).toBeInTheDocument();

    await fireEvent.input(search, { target: { value: 'nothing here' } });
    expect(screen.getByText('No archived cards match your search.')).toBeInTheDocument();
  });

  it('restores a card and drops its row', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      const url = new URL(request.url);
      if (url.pathname === '/api/projects/p1/archived-tasks') {
        return jsonResponse(200, { tasks: [archived('t1', 'Old idea')] });
      }
      if (request.method === 'POST' && url.pathname === '/api/tasks/t1/restore') {
        const restored: Record<string, unknown> = { ...archived('t1', 'Old idea') };
        delete restored.archived_at;
        return jsonResponse(200, restored);
      }
      return jsonResponse(200, {
        project: board.project,
        columns: board.columns,
        tasks: [],
        labels: [],
      });
    });

    render(ArchivedTasksModal, { open: true, onclose: () => {} });
    await waitFor(() => expect(screen.getByText('Old idea')).toBeInTheDocument());

    await fireEvent.click(screen.getByLabelText('Restore card Old idea'));

    await waitFor(() => expect(screen.getByText('No archived cards.')).toBeInTheDocument());
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).toContain('/api/tasks/t1/restore');
  });

  it('offers Try again after a failed load and refetches', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Archive unavailable' }));

    render(ArchivedTasksModal, { open: true, onclose: () => {} });

    await waitFor(() => expect(screen.getByText('Archive unavailable')).toBeInTheDocument());

    mockArchive([archived('t1', 'Recovered')]);
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('Recovered')).toBeInTheDocument());
  });

  it('shows a loading state while a retry runs and re-renders a second failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Archive unavailable' }));

    render(ArchivedTasksModal, { open: true, onclose: () => {} });
    await waitFor(() => expect(screen.getByText('Archive unavailable')).toBeInTheDocument());

    let release!: (response: Response) => void;
    const inFlight = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => inFlight);
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Loading archived cards')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    release(jsonResponse(500, { error: 'Still unavailable' }));
    await waitFor(() => expect(screen.getByText('Still unavailable')).toBeInTheDocument());
  });

  it('waits for the first load rather than passing off an optimistically archived row', async () => {
    board.archivedTasks = [archived('t1', 'Fix login')];
    let release!: (response: Response) => void;
    const inFlight = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => inFlight);

    render(ArchivedTasksModal, { open: true, onclose: () => {} });

    await waitFor(() =>
      expect(screen.getByLabelText('Loading archived cards')).toBeInTheDocument()
    );
    expect(screen.queryByText('Fix login')).toBeNull();

    release(jsonResponse(200, { tasks: [archived('t1', 'Fix login'), archived('t2', 'Older')] }));
    await waitFor(() => expect(screen.getByText('Older')).toBeInTheDocument());
    expect(screen.getByText('Fix login')).toBeInTheDocument();
  });

  it('fetches only once it is open, so a permanent mount costs nothing', async () => {
    mockArchive([]);

    const { rerender } = render(ArchivedTasksModal, { open: false, onclose: () => {} });
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    await rerender({ open: true, onclose: () => {} });

    await waitFor(() => expect(screen.getByText('No archived cards.')).toBeInTheDocument());
  });
});
