import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ProjectHeader from './ProjectHeader.svelte';
import { board } from '../lib/board.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { session } from '../lib/session.svelte';
import { projectHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
import { toasts } from '../lib/toasts.svelte';
import { users } from '../lib/users.svelte';
import { webhooks } from '../lib/webhooks.svelte';
import type { BoardTask } from '../lib/board-types';

const me = { id: 'u1', email: 'ada@example.com', name: 'Ada', avatar_url: null };
const PROJECT_ID = testUuid('p1');

function project(overrides: Partial<Project> = {}): Project {
  const memberIds = overrides.member_ids ?? [];
  return {
    id: PROJECT_ID,
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: me.id,
    member_ids: memberIds,
    members: memberIds.map((user_id) => ({ user_id, role: 'editor' as const })),
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
    column_since: '2026-01-01T00:00:00Z',
    label_ids: labelIds,
    assignee_ids: assigneeIds,
    blocker_ids: [],
    image_count: 0,
    cover_image_url: null,
    due_date: null,
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
  webhooks.reset();
  session.user = me;
  board.currentProjectId = PROJECT_ID;
  board.project = {
    id: PROJECT_ID,
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: me.id,
    member_ids: [],
    members: [],
    is_public: false,
    created_at: '2026-01-01T00:00:00Z',
  };
  board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
  board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
  board.tasks = [task('t1', 'Design cards', ['l1'], ['u1'])];
  users.users = [me];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProjectHeader', () => {
  it('renders label chips, assignee chips, and the title search inline on the board view', () => {
    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });

    expect(screen.getByLabelText('Filter tasks by title')).toBeInTheDocument();
    expect(screen.getByText('art')).toBeInTheDocument();
    expect(screen.getByTitle('Filter by Ada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Graph' })).toBeInTheDocument();
  });

  it('flags a published board as soon as this tab publishes it, and clears it on unpublish', async () => {
    projects.projects = [project()];
    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });
    expect(screen.queryByText('Public')).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(200, project({ is_public: true })));
    await projects.setPublic(PROJECT_ID, true);
    await waitFor(() => expect(screen.getByText('Public')).toBeInTheDocument());

    fetchMock.mockResolvedValueOnce(jsonResponse(200, project()));
    await projects.setPublic(PROJECT_ID, false);
    await waitFor(() => expect(screen.queryByText('Public')).toBeNull());
  });

  it('flags a board another member published, from the realtime event', async () => {
    projects.projects = [project()];
    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });
    expect(screen.queryByText('Public')).toBeNull();

    projects.applyRealtime({
      type: 'project_updated',
      project_id: PROJECT_ID,
      data: { id: PROJECT_ID, is_public: true },
    });
    await waitFor(() => expect(screen.getByText('Public')).toBeInTheDocument());
  });

  it('falls back to the board payload while the projects list is still loading', async () => {
    board.project = { ...board.project!, is_public: true };
    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });

    expect(screen.getByText('Public')).toBeInTheDocument();

    projects.projects = [project()];
    await waitFor(() => expect(screen.queryByText('Public')).toBeNull());
  });

  it('renders the same filter cluster on the graph view', () => {
    render(ProjectHeader, { projectId: PROJECT_ID, view: 'graph' });

    expect(screen.getByLabelText('Filter tasks by title')).toBeInTheDocument();
    expect(screen.getByText('art')).toBeInTheDocument();
    expect(screen.getByTitle('Filter by Ada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Graph' })).toBeInTheDocument();
  });

  it('exposes an identical control inventory and title layout in both views', () => {
    const boardHeader = header(
      render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' }).container
    );
    const graphHeader = header(
      render(ProjectHeader, { projectId: PROJECT_ID, view: 'graph' }).container
    );

    expect(inventory(graphHeader)).toEqual(inventory(boardHeader));
    expect(graphHeader.querySelector('h1')?.className).toBe(
      boardHeader.querySelector('h1')?.className
    );
    expect(current(boardHeader)).toEqual(['Board']);
    expect(current(graphHeader)).toEqual(['Graph']);
  });

  it('opens the members modal from the Share button', async () => {
    projects.projects = [project()];

    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });

    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Share' }));

    expect(screen.getByText('Ada (you)')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByLabelText('Add people')).toBeInTheDocument();
  });

  it('opens the webhooks modal from the Webhooks button', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        webhooks: [
          {
            id: 'w-1',
            project_id: PROJECT_ID,
            url: 'https://example.com/hook',
            secret: 'sec-abc',
            disabled_at: null,
            consecutive_failures: 0,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });

    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Webhooks' }));

    expect(screen.getByLabelText('Endpoint URL')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('https://example.com/hook')).toBeInTheDocument());
    expect((fetchMock.mock.calls[0][0] as Request).url).toContain(
      `/api/webhooks?project_id=${PROJECT_ID}`
    );
  });

  it('opens the archive from the Archived cards button', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { tasks: [] }));

    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });

    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archived cards' }));

    expect(screen.getByLabelText('Search archived cards')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No archived cards.')).toBeInTheDocument());
  });

  it('offers Export in both views', async () => {
    const { unmount } = render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Export' })).toBeInTheDocument();
    unmount();

    render(ProjectHeader, { projectId: PROJECT_ID, view: 'graph' });
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Export' })).toBeInTheDocument();
  });

  it('downloads the project and shows a busy state until the archive arrives', async () => {
    let settle: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        settle = resolve;
      })
    );

    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const button = screen.getByRole('menuitem', { name: 'Export' });
    await fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByRole('status', { name: 'Exporting' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Export' })).toBe(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL((fetchMock.mock.calls[0][0] as Request).url).pathname).toBe(
      `/api/projects/${PROJECT_ID}/export`
    );

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

  it('saves the manifest and says so when the project is too big to package', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(413, { error: 'Too large; use format=json' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { format: 'critical-path-project-export' }));

    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const button = screen.getByRole('menuitem', { name: 'Export' });
    await fireEvent.click(button);

    await waitFor(() => expect(toasts.toasts).toHaveLength(1));
    expect(toasts.toasts[0]).toMatchObject({
      variant: 'success',
      message: 'This project is too large to package with its images — saved as JSON.',
    });
    expect(button).not.toBeDisabled();
  });

  it('reports what the server said about a failed export and re-enables the button', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'Something broke' }));

    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const button = screen.getByRole('menuitem', { name: 'Export' });
    await fireEvent.click(button);

    await waitFor(() => expect(toasts.toasts).toHaveLength(1));
    expect(toasts.toasts[0]).toMatchObject({ variant: 'error', message: 'Something broke' });
    expect(button).not.toBeDisabled();
  });

  it('reports a deleted project without blaming the connection', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'Project not found' }));

    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));

    await waitFor(() => expect(toasts.toasts).toHaveLength(1));
    expect(toasts.toasts[0]).toMatchObject({ variant: 'error', message: 'Project not found' });
  });

  it('blames the connection only when the request never reached the server', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));

    await waitFor(() => expect(toasts.toasts).toHaveLength(1));
    expect(toasts.toasts[0]).toMatchObject({
      variant: 'error',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  });

  it('carries the active filters on both view tabs so switching views keeps them', () => {
    board.setFilterQuery('boss');
    board.toggleLabelFilter('l1');

    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });

    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute(
      'href',
      `${projectHref(PROJECT_ID, 'Game')}?labels=l1&q=boss`
    );
    expect(screen.getByRole('link', { name: 'Graph' })).toHaveAttribute(
      'href',
      `${projectHref(PROJECT_ID, 'Game', 'graph')}?labels=l1&q=boss`
    );
  });

  it('updates the shared filterQuery as the user types, which dims non-matching tasks', async () => {
    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });

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

describe('ProjectHeader for a viewer', () => {
  beforeEach(() => {
    board.project = {
      ...board.project!,
      created_by: 'u-owner',
      member_ids: [me.id],
      members: [{ user_id: me.id, role: 'viewer' }],
    };
  });

  it('badges the board and drops the management surfaces', async () => {
    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });

    expect(screen.getByText('View only')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: /Labels/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Webhooks/ })).toBeNull();
  });

  it('keeps the read-only surfaces', async () => {
    render(ProjectHeader, { projectId: PROJECT_ID, view: 'board' });

    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: /Share/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Archived cards/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Export' })).toBeInTheDocument();
  });
});
