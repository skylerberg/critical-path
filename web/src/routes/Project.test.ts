import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Project from './Project.svelte';
import { board } from '../lib/board.svelte';
import { router } from '../lib/router.svelte';
import { selection } from '../lib/selection.svelte';
import { shortcuts } from '../lib/shortcuts.svelte';
import type { BoardPayload, BoardTask } from '../lib/board-types';
import type { ProjectView } from '../lib/router.svelte';

// The shortcut layer reads the live route, so the shell keymap tests must drive the
// router to the same view/overlay the component is rendered with.
function pressKey(key: string, id: string, view: ProjectView, taskId?: string): void {
  router.current = { name: 'project', params: { id, view, taskId } };
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
}

function task(id: string, columnId: string, title: string): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position: 1000,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
  };
}

// Extra `users` lets one mock answer both the board fetch and the project-scoped
// users fetch the rendered view fires on load.
function payload(projectId: string, tasks: BoardTask[]): BoardPayload & { users: [] } {
  return {
    users: [],
    project: {
      id: projectId,
      name: 'Rulebook',
      description: '',
      archived_at: null,
      created_by: null,
      workspace_id: null,
      created_at: '2026-07-15T00:00:00Z',
    },
    columns: [
      { id: 'todo', name: 'To Do', position: 1000, is_done: false },
      { id: 'done', name: 'Done', position: 2000, is_done: true },
    ],
    tasks,
    labels: [],
  };
}

function mockProjectApi(projectId: string, tasks: BoardTask[]): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    const taskMatch = /^\/api\/tasks\/(.+)$/.exec(url.pathname);
    if (request.method === 'GET' && taskMatch) {
      const found = tasks.find((t) => t.id === taskMatch[1]);
      return jsonResponse(200, { ...found, project_id: projectId, images: [] });
    }
    return jsonResponse(200, payload(projectId, tasks));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  selection.clear();
  shortcuts.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Project', () => {
  it('renders the header and the board view by default', async () => {
    const projectId = 'p-shell-board';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board' } });

    expect(await screen.findByRole('heading', { name: 'Rulebook' })).toBeInTheDocument();
    expect(screen.getByText('Design cards')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add column' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Dependency graph')).not.toBeInTheDocument();
  });

  it('renders the graph view with the shared header', async () => {
    const projectId = 'p-shell-graph';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByRole('heading', { name: 'Rulebook' })).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Dependency graph"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add column' })).not.toBeInTheDocument();
  });

  it('shows the error shell with retry and fetches exactly once on failure', async () => {
    const projectId = 'p-shell-error';
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      return jsonResponse(503, { error: `down ${calls}` });
    });

    render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByText('down 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens the task overlay above the graph without leaving the graph view', async () => {
    const projectId = 'p-shell-graph-task';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    const { container } = render(Project, {
      props: { projectId, view: 'graph', taskId: 't1' },
    });

    expect(await screen.findByLabelText('Task title')).toHaveValue('Design cards');
    expect(container.querySelector('svg[aria-label="Dependency graph"]')).not.toBeNull();
    expect(container.querySelector('dialog')).not.toBeNull();
  });

  it('closes the overlay back to the graph base with replaceState', async () => {
    const projectId = 'p-shell-graph-close';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'graph', taskId: 't1' } });

    await screen.findByLabelText('Task title');
    const pushState = vi.spyOn(window.history, 'pushState');
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(window.location.pathname).toBe(`/projects/${projectId}/graph`);
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it('closes the overlay back to the board base from the board view', async () => {
    const projectId = 'p-shell-board-close';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board', taskId: 't1' } });

    await screen.findByLabelText('Task title');
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(window.location.pathname).toBe(`/projects/${projectId}`);
  });

  it('scrolls the card created by quick-add into view', async () => {
    const projectId = 'p-board-scroll';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    render(Project, { props: { projectId, view: 'board' } });
    await screen.findByText('Design cards');

    const column = screen.getByRole('listitem', { name: 'To Do' });
    await fireEvent.click(within(column).getByRole('button', { name: '+ Add task' }));
    const input = within(column).getByLabelText('Task title');
    await fireEvent.input(input, { target: { value: 'Scroll target' } });
    await fireEvent.submit(input.closest('form')!);

    const created = board.tasks.find((t) => t.title === 'Scroll target');
    expect(created).toBeDefined();
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });
    const receiver = scrollSpy.mock.contexts[0] as Element;
    expect(receiver.getAttribute('data-task-id')).toBe(created!.id);
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(input).toHaveFocus();
  });

  it('runs the keymap from the shell on the board view', async () => {
    const projectId = 'p-shell-board-keys';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'board' } });

    await screen.findByRole('heading', { name: 'Rulebook' });
    pressKey('?', projectId, 'board');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Keyboard shortcuts' })
    ).toBeInTheDocument();
  });

  it('opens the label menu for the open task from the graph overlay', async () => {
    const projectId = 'p-shell-graph-keys';
    mockProjectApi(projectId, [task('t1', 'todo', 'Design cards')]);

    render(Project, { props: { projectId, view: 'graph', taskId: 't1' } });

    await screen.findByLabelText('Task title');
    pressKey('l', projectId, 'graph', 't1');
    // The open task detail shares the same filter input, so assert the menu's own dialog.
    expect(await screen.findByRole('heading', { level: 2, name: 'Labels' })).toBeInTheDocument();
    expect(shortcuts.labelMenu).toBe('t1');
  });
});
