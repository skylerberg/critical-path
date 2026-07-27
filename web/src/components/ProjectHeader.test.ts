import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ProjectHeader from './ProjectHeader.svelte';
import { board } from '../lib/board.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { toasts } from '../lib/toasts.svelte';
import { users } from '../lib/users.svelte';
import type { BoardTask } from '../lib/board-types';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: 'u1',
    member_ids: [],
    is_public: false,
    created_at: '2026-01-01T00:00:00Z',
    open_task_count: 0,
    done_task_count: 0,
    position: null,
    ...overrides,
  };
}

function task(
  id: string,
  title: string,
  labelIds: string[] = [],
  assigneeIds: string[] = []
): BoardTask {
  return {
    id,
    column_id: 'c1',
    title,
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    label_ids: labelIds,
    assignee_ids: assigneeIds,
    blocker_ids: [],
    image_count: 0,
    comment_count: 0,
  };
}

function header(container: HTMLElement): HTMLElement {
  const el = container.querySelector('header');
  if (el === null) {
    throw new Error('header not rendered');
  }
  return el;
}

function inventory(el: HTMLElement): (string | undefined)[] {
  return [...el.querySelectorAll('a, button, input')].map(
    (node) =>
      node.getAttribute('aria-label') ?? node.getAttribute('title') ?? node.textContent?.trim()
  );
}

function current(el: HTMLElement): (string | undefined)[] {
  return [...el.querySelectorAll('[aria-current="page"]')].map((node) => node.textContent?.trim());
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:fake-url', revokeObjectURL: () => {} })
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
  board.reset();
  projects.reset();
  users.reset();
  board.currentProjectId = 'p1';
  board.project = {
    id: 'p1',
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: [],
    is_public: false,
    created_at: '2026-01-01T00:00:00Z',
  };
  board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
  board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
  board.tasks = [task('t1', 'Design cards', ['l1'], ['u1'])];
  users.users = [{ id: 'u1', email: 'ada@example.com', name: 'Ada', avatar_url: null }];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProjectHeader', () => {
  it('renders label chips, assignee chips, and the title search inline on the board view', () => {
    render(ProjectHeader, { projectId: 'p1', view: 'board' });

    expect(screen.getByLabelText('Filter tasks by title')).toBeInTheDocument();
    expect(screen.getByText('art')).toBeInTheDocument();
    expect(screen.getByTitle('Filter by Ada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Graph' })).toBeInTheDocument();
  });

  it('flags a published board as soon as this tab publishes it, and clears it on unpublish', async () => {
    projects.projects = [project()];
    render(ProjectHeader, { projectId: 'p1', view: 'board' });
    expect(screen.queryByText('Public')).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(200, project({ is_public: true })));
    await projects.setPublic('p1', true);
    await waitFor(() => expect(screen.getByText('Public')).toBeInTheDocument());

    fetchMock.mockResolvedValueOnce(jsonResponse(200, project()));
    await projects.setPublic('p1', false);
    await waitFor(() => expect(screen.queryByText('Public')).toBeNull());
  });

  it('flags a board another member published, from the realtime event', async () => {
    projects.projects = [project()];
    render(ProjectHeader, { projectId: 'p1', view: 'board' });
    expect(screen.queryByText('Public')).toBeNull();

    projects.applyRealtime({
      type: 'project_updated',
      project_id: 'p1',
      data: { id: 'p1', is_public: true },
    });
    await waitFor(() => expect(screen.getByText('Public')).toBeInTheDocument());
  });

  it('falls back to the board payload while the projects list is still loading', async () => {
    board.project = { ...board.project!, is_public: true };
    render(ProjectHeader, { projectId: 'p1', view: 'board' });

    expect(screen.getByText('Public')).toBeInTheDocument();

    projects.projects = [project()];
    await waitFor(() => expect(screen.queryByText('Public')).toBeNull());
  });

  it('renders the same filter cluster on the graph view', () => {
    render(ProjectHeader, { projectId: 'p1', view: 'graph' });

    expect(screen.getByLabelText('Filter tasks by title')).toBeInTheDocument();
    expect(screen.getByText('art')).toBeInTheDocument();
    expect(screen.getByTitle('Filter by Ada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Graph' })).toBeInTheDocument();
  });

  it('exposes an identical control inventory and title layout in both views', () => {
    const boardHeader = header(render(ProjectHeader, { projectId: 'p1', view: 'board' }).container);
    const graphHeader = header(render(ProjectHeader, { projectId: 'p1', view: 'graph' }).container);

    expect(inventory(graphHeader)).toEqual(inventory(boardHeader));
    expect(graphHeader.querySelector('h1')?.className).toBe(
      boardHeader.querySelector('h1')?.className
    );
    expect(current(boardHeader)).toEqual(['Board']);
    expect(current(graphHeader)).toEqual(['Graph']);
  });

  it('opens the members modal from the Share button', async () => {
    projects.projects = [project()];

    render(ProjectHeader, { projectId: 'p1', view: 'board' });

    await fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByLabelText('Add people')).toBeInTheDocument();
  });

  it('offers Export in both views', () => {
    render(ProjectHeader, { projectId: 'p1', view: 'board' });
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();

    render(ProjectHeader, { projectId: 'p1', view: 'graph' });
    expect(screen.getAllByRole('button', { name: 'Export' })).toHaveLength(2);
  });

  it('downloads the project and shows a busy state until the archive arrives', async () => {
    let settle: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        settle = resolve;
      })
    );

    render(ProjectHeader, { projectId: 'p1', view: 'board' });
    const button = screen.getByRole('button', { name: 'Export' });
    await fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByRole('status', { name: 'Exporting' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][0] as Request).url).toMatch(/\/api\/projects\/p1\/export$/);

    settle(
      new Response(new Blob([new Uint8Array([0x50, 0x4b])]), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="game-2026-07-26.zip"',
        },
      })
    );

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.queryByRole('status', { name: 'Exporting' })).toBeNull();
    expect(toasts.toasts).toEqual([]);
  });

  it('reports a failed export and re-enables the button', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Internal Server Error' }));

    render(ProjectHeader, { projectId: 'p1', view: 'board' });
    const button = screen.getByRole('button', { name: 'Export' });
    await fireEvent.click(button);

    await waitFor(() => expect(toasts.toasts).toHaveLength(1));
    expect(toasts.toasts[0]).toMatchObject({
      variant: 'error',
      message: 'Could not export this project. Check your connection and try again.',
    });
    expect(button).not.toBeDisabled();
  });

  it('carries the active filters on both view tabs so switching views keeps them', () => {
    board.setFilterQuery('boss');
    board.toggleLabelFilter('l1');

    render(ProjectHeader, { projectId: 'p1', view: 'board' });

    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute(
      'href',
      '/projects/p1?labels=l1&q=boss'
    );
    expect(screen.getByRole('link', { name: 'Graph' })).toHaveAttribute(
      'href',
      '/projects/p1/graph?labels=l1&q=boss'
    );
  });

  it('updates the shared filterQuery as the user types, which dims non-matching tasks', async () => {
    render(ProjectHeader, { projectId: 'p1', view: 'board' });

    const input = screen.getByLabelText<HTMLInputElement>('Filter tasks by title');
    await fireEvent.input(input, { target: { value: 'design' } });

    expect(board.filterQuery).toBe('design');
    expect(board.hasActiveFilters).toBe(true);
    expect(board.taskMatchesFilters(board.tasks[0]!)).toBe(true);
    expect(board.taskMatchesFilters({ ...board.tasks[0]!, id: 't2', title: 'Print cards' })).toBe(
      false
    );
  });
});
