import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ColumnDeleteDialog from './ColumnDeleteDialog.svelte';
import { board } from '../lib/board.svelte';
import type { ArchivedTask, BoardColumn, BoardTask } from '../lib/board-types';

const TODO: BoardColumn = {
  id: 'c1',
  name: 'Todo',
  sort_key: 'V0000010001',
  is_done: false,
};
const DONE: BoardColumn = {
  id: 'c2',
  name: 'Done',
  sort_key: 'V0000020001',
  is_done: true,
};

function task(id: string, columnId: string): BoardTask {
  return {
    id,
    column_id: columnId,
    title: id,
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
}

function archived(id: string, columnId: string): ArchivedTask {
  return { ...task(id, columnId), archived_at: '2026-03-01T12:00:00Z' };
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
  board.columns = [TODO, DONE];
  vi.restoreAllMocks();
});

describe('ColumnDeleteDialog', () => {
  it('loads the archive when it opens', async () => {
    mockArchive([]);

    render(ColumnDeleteDialog, { column: TODO, open: true, onclose: () => {} });

    await waitFor(() => {
      const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
      expect(paths).toContain('/api/projects/p1/archived-tasks');
    });
  });

  it('counts an archived card in a column that looks empty and moves it', async () => {
    mockArchive([archived('t9', 'c1')]);
    const deleteColumn = vi.spyOn(board, 'deleteColumn').mockResolvedValue();

    render(ColumnDeleteDialog, { column: TODO, open: true, onclose: () => {} });

    await waitFor(() => expect(screen.getByLabelText('Move tasks to')).toBeInTheDocument());
    expect(screen.getByText(/1 archived card/)).toBeInTheDocument();
    expect(screen.queryByText(/empty column/)).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Move and delete' }));
    expect(deleteColumn).toHaveBeenCalledWith('c1', 'c2');
  });

  it('blocks deleting the last column when it still holds an archived card', async () => {
    board.columns = [TODO];
    mockArchive([archived('t9', 'c1')]);
    const deleteColumn = vi.spyOn(board, 'deleteColumn').mockResolvedValue();

    render(ColumnDeleteDialog, { column: TODO, open: true, onclose: () => {} });

    await waitFor(() =>
      expect(screen.getByText(/there is no other column to move them to/)).toBeInTheDocument()
    );
    const confirm = screen.getByRole('button', { name: 'Move and delete' });
    expect(confirm).toBeDisabled();

    await fireEvent.click(confirm);
    expect(deleteColumn).not.toHaveBeenCalled();
  });

  it('still supplies a target for a genuinely empty column when another exists', async () => {
    mockArchive([]);
    const deleteColumn = vi.spyOn(board, 'deleteColumn').mockResolvedValue();

    render(ColumnDeleteDialog, { column: TODO, open: true, onclose: () => {} });

    await waitFor(() => expect(screen.getByText(/empty column/)).toBeInTheDocument());
    await fireEvent.click(screen.getByRole('button', { name: 'Delete column' }));
    expect(deleteColumn).toHaveBeenCalledWith('c1', 'c2');
  });

  it('omits the target for a genuinely empty last column', async () => {
    board.columns = [TODO];
    mockArchive([]);
    const deleteColumn = vi.spyOn(board, 'deleteColumn').mockResolvedValue();

    render(ColumnDeleteDialog, { column: TODO, open: true, onclose: () => {} });

    await waitFor(() => expect(screen.getByText(/empty column/)).toBeInTheDocument());
    await fireEvent.click(screen.getByRole('button', { name: 'Delete column' }));
    expect(deleteColumn).toHaveBeenCalledWith('c1');
  });

  it('names both live and archived cards when the column holds each', async () => {
    board.tasks = [task('t1', 'c1'), task('t2', 'c1')];
    mockArchive([archived('t9', 'c1')]);

    render(ColumnDeleteDialog, { column: TODO, open: true, onclose: () => {} });

    await waitFor(() =>
      expect(screen.getByText(/2 tasks and 1 archived card/)).toBeInTheDocument()
    );
  });

  it('re-checks on every open instead of confirming against counts from an earlier one', async () => {
    board.archivedLoaded = true;
    const deleteColumn = vi.spyOn(board, 'deleteColumn').mockResolvedValue();
    let release!: (response: Response) => void;
    const inFlight = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => inFlight);

    render(ColumnDeleteDialog, { column: TODO, open: true, onclose: () => {} });

    await waitFor(() => expect(screen.getByText(/Checking/)).toBeInTheDocument());
    expect(screen.queryByText(/empty column/)).toBeNull();
    const confirm = screen.getByRole('button', { name: 'Delete column' });
    expect(confirm).toBeDisabled();
    await fireEvent.click(confirm);
    expect(deleteColumn).not.toHaveBeenCalled();

    release(jsonResponse(200, { tasks: [archived('t9', 'c1')] }));
    await waitFor(() => expect(screen.getByText(/1 archived card/)).toBeInTheDocument());
  });

  it('says the archive could not be checked but still allows the move', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'nope' }));
    const deleteColumn = vi.spyOn(board, 'deleteColumn').mockResolvedValue();

    render(ColumnDeleteDialog, { column: TODO, open: true, onclose: () => {} });

    await waitFor(() => expect(screen.getByText(/Could not check/)).toBeInTheDocument());
    const confirm = screen.getByRole('button', { name: 'Move and delete' });
    expect(confirm).not.toBeDisabled();

    await fireEvent.click(confirm);
    expect(deleteColumn).toHaveBeenCalledWith('c1', 'c2');
  });
});
