import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import Project from './Project.svelte';
import { board } from '../lib/board.svelte';
import { toasts } from '../lib/toasts.svelte';
import type { BoardPayload, BoardTask } from '../lib/board-types';

function task(id: string, columnId: string, blockerIds: string[] = []): BoardTask {
  return {
    id,
    column_id: columnId,
    title: `Task ${id}`,
    description: null,
    position: 1000,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: blockerIds,
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
      is_template: false,
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

function previewPath(container: HTMLElement): string {
  const path = container.querySelector('path[marker-end="url(#cp-graph-arrow-active)"]');
  expect(path).not.toBeNull();
  return path!.getAttribute('d') ?? '';
}

function parsePreview(d: string): { start: [number, number]; end: [number, number] } {
  const m = d.match(/^M\s+([-\d.]+)\s+([-\d.]+)\s+L\s+([-\d.]+)\s+([-\d.]+)$/);
  if (m === null) throw new Error(`unexpected preview path: ${d}`);
  return { start: [Number(m[1]), Number(m[2])], end: [Number(m[3]), Number(m[4])] };
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
});

describe('Graph', () => {
  it('renders a linked node per task and header tabs', async () => {
    const projectId = 'p-graph-chain';
    const tasks = [task('a', 'todo'), task('b', 'todo', ['a']), task('c', 'todo', ['b'])];
    fetchMock.mockImplementation(async () => jsonResponse(200, payload(projectId, tasks)));

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(3);
    });
    for (const node of container.querySelectorAll('[data-node-id]')) {
      expect(node.querySelector('rect')).not.toBeNull();
    }
    expect(screen.getByRole('heading', { name: 'Rulebook' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute(
      'href',
      `/projects/${projectId}`
    );
    expect(screen.getByRole('link', { name: 'Graph' })).toHaveAttribute(
      'href',
      `/projects/${projectId}/graph`
    );
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(2);
  });

  it('no longer renders the critical-path legend or accent-highlighted nodes', async () => {
    const projectId = 'p-graph-no-critical';
    const tasks = [task('a', 'todo'), task('b', 'todo', ['a']), task('c', 'todo', ['b'])];
    fetchMock.mockImplementation(async () => jsonResponse(200, payload(projectId, tasks)));

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(3);
    });
    expect(screen.queryByText('Critical path')).not.toBeInTheDocument();
    expect(container.querySelector('#cp-graph-arrow-critical')).toBeNull();
    for (const rect of container.querySelectorAll('[data-node-id] rect')) {
      expect(rect.getAttribute('class') ?? '').not.toContain('stroke-accent');
    }
  });

  it('renders each node as an anchor to the graph-preserving task path', async () => {
    const projectId = 'p-graph-anchors';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    const anchor = container.querySelector('[data-node-id="a"] a');
    expect(anchor).not.toBeNull();
    expect(anchor).toHaveAttribute('href', `/projects/${projectId}/graph/tasks/a`);
    expect(screen.getByRole('link', { name: 'Open task Task a' })).toBe(anchor);
  });

  it('hides the filter bar on the graph view', async () => {
    const projectId = 'p-graph-filters';
    const withLabel = { ...task('a', 'todo'), label_ids: ['l1'] };
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        ...payload(projectId, [withLabel]),
        labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
      })
    );

    render(Project, { props: { projectId, view: 'graph' } });

    await screen.findByRole('heading', { name: 'Rulebook' });
    expect(screen.queryByRole('group', { name: 'Filters' })).not.toBeInTheDocument();
  });

  it('shows the no-dependencies hint and no legend when tasks have no blockers', async () => {
    const projectId = 'p-graph-no-deps';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    expect(screen.getByText(/No dependencies yet/)).toBeInTheDocument();
    expect(screen.queryByText('Critical path')).not.toBeInTheDocument();
  });

  it('shows the cycle fallback instead of the graph on cyclic data', async () => {
    const projectId = 'p-graph-cycle';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo', ['b']), task('b', 'todo', ['a'])]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByText('Dependency cycle detected')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Dependency graph"]')).toBeNull();
  });

  it('shows the empty state when the project has no tasks', async () => {
    const projectId = 'p-graph-empty';
    fetchMock.mockImplementation(async () => jsonResponse(200, payload(projectId, [])));

    render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByText('No tasks to graph')).toBeInTheDocument();
  });

  it('offers Clear filters when a title filter dims nodes even though the project has no labels', async () => {
    const projectId = 'p-graph-clear-no-labels';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    expect(board.labels).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

    board.setFilterQuery('Task a');

    await fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(board.hasActiveFilters).toBe(false);
  });
});

describe('Graph dependency editing', () => {
  // jsdom implements no layout, so elementFromPoint is absent; stand in the node
  // the pointer is over so the point-based target detection has something to hit.
  function stubElementFromPoint(el: Element | null): void {
    document.elementFromPoint = (() => el) as typeof document.elementFromPoint;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  // Touch/pen capture the pointer on the handle, so pointerover never fires on the
  // node under the finger; the target must come from the point under the pointer.
  it('resolves the drop target from the point under the pointer and adds the dependency', async () => {
    const projectId = 'p-graph-connect';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );
    const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const handle = container.querySelector('[data-connect-handle="a"]');
    const targetNode = container.querySelector('[data-node-id="b"]');
    expect(handle).not.toBeNull();
    expect(targetNode).not.toBeNull();
    stubElementFromPoint(targetNode);

    await fireEvent.pointerDown(handle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 60 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 60 });

    expect(spy).toHaveBeenCalledWith('b', 'a');
  });

  it('ignores a connect drop back onto the source node', async () => {
    const projectId = 'p-graph-self';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );
    const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const handle = container.querySelector('[data-connect-handle="a"]');
    const sourceNode = container.querySelector('[data-node-id="a"]');
    stubElementFromPoint(sourceNode);

    await fireEvent.pointerDown(handle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });

    expect(spy).not.toHaveBeenCalled();
  });

  it('guards a cycle-forming drop: toasts once and keeps the graph drawn', async () => {
    const projectId = 'p-graph-cycle-guard';
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        200,
        payload(projectId, [task('a', 'todo'), task('b', 'todo', ['a']), task('c', 'todo', ['b'])])
      )
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(3);
    });
    const handle = container.querySelector('[data-connect-handle="c"]');
    const targetNode = container.querySelector('[data-node-id="a"]');
    stubElementFromPoint(targetNode);

    await fireEvent.pointerDown(handle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });

    expect(container.querySelector('svg[aria-label="Dependency graph"]')).not.toBeNull();
    expect(screen.queryByText('Dependency cycle detected')).not.toBeInTheDocument();
    expect(toasts.toasts.map((t) => t.message)).toEqual([
      'Adding this blocker would create a dependency cycle',
    ]);
    expect(board.tasks.find((t) => t.id === 'a')?.blocker_ids).toEqual([]);
  });

  it('selects an edge and removes the dependency via the delete chip', async () => {
    const projectId = 'p-graph-delete';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo', ['a'])]))
    );
    const spy = vi.spyOn(board, 'removeBlocker').mockResolvedValue(undefined);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    const edge = await waitFor(() => {
      const found = container.querySelector('[data-edge-id="a->b"]');
      expect(found).not.toBeNull();
      return found!;
    });

    await fireEvent.click(edge);
    const chip = await screen.findByRole('button', { name: 'Remove dependency' });
    await fireEvent.click(chip);

    expect(spy).toHaveBeenCalledWith('b', 'a');
  });

  it('drags the back handle to add the reverse dependency', async () => {
    const projectId = 'p-graph-back-handle';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );
    const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const backHandle = container.querySelector(
      '[data-connect-dir="back"][data-connect-handle="a"]'
    );
    const targetNode = container.querySelector('[data-node-id="b"]');
    expect(backHandle).not.toBeNull();
    stubElementFromPoint(targetNode);

    await fireEvent.pointerDown(backHandle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 60 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 60 });

    expect(spy).toHaveBeenCalledWith('a', 'b');
  });

  it('keeps the front handle direction (source blocks target)', async () => {
    const projectId = 'p-graph-front-handle';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );
    const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const frontHandle = container.querySelector(
      '[data-connect-dir="front"][data-connect-handle="a"]'
    );
    const targetNode = container.querySelector('[data-node-id="b"]');
    stubElementFromPoint(targetNode);

    await fireEvent.pointerDown(frontHandle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 60 });

    expect(spy).toHaveBeenCalledWith('b', 'a');
  });

  it('highlights the source and target after a connect, then clears', async () => {
    const projectId = 'p-graph-highlight';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );
    vi.spyOn(board, 'addBlocker').mockResolvedValue(true);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const handle = container.querySelector('[data-connect-handle="a"]');
    const targetNode = container.querySelector('[data-node-id="b"]');
    stubElementFromPoint(targetNode);

    vi.useFakeTimers();
    await fireEvent.pointerDown(handle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 60 });
    flushSync();
    expect(container.querySelectorAll('[data-highlight]')).toHaveLength(2);

    vi.advanceTimersByTime(1800);
    flushSync();
    expect(container.querySelectorAll('[data-highlight]')).toHaveLength(0);
  });

  it('creates a task from the new-task control and highlights it', async () => {
    const projectId = 'p-graph-new-task';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo')]))
    );
    const spy = vi.spyOn(board, 'createAndLinkTask');

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    await fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const input = screen.getByRole('textbox', { name: 'New task title' });
    await fireEvent.input(input, { target: { value: 'Ship it' } });
    await fireEvent.submit(input.closest('form')!);

    expect(spy).toHaveBeenCalledWith('Ship it');
    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
      expect(container.querySelectorAll('[data-highlight]').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('highlights nodes matching a selected label and dims the rest', async () => {
    const projectId = 'p-graph-label-filter';
    const withLabel = { ...task('a', 'todo'), label_ids: ['l1'] };
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        ...payload(projectId, [withLabel, task('b', 'todo')]),
        labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
      })
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    await fireEvent.click(screen.getByRole('button', { name: /art/ }));

    await waitFor(() => {
      const a = container.querySelector('[data-node-id="a"]')!;
      const b = container.querySelector('[data-node-id="b"]')!;
      expect(a.getAttribute('class') ?? '').not.toContain('opacity-25');
      expect(a.querySelector('rect')!.getAttribute('class') ?? '').toContain('stroke-accent');
      expect(b.getAttribute('class') ?? '').toContain('opacity-25');
    });
  });

  it('dims nodes whose title does not match the shared title filter', async () => {
    const projectId = 'p-graph-title-filter';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    board.setFilterQuery('Task a');

    await waitFor(() => {
      expect(
        container.querySelector('[data-node-id="a"]')!.getAttribute('class') ?? ''
      ).not.toContain('opacity-25');
      expect(container.querySelector('[data-node-id="b"]')!.getAttribute('class') ?? '').toContain(
        'opacity-25'
      );
    });
  });

  it('keeps a freshly created highlighted node at full opacity even when it fails the active filter', async () => {
    const projectId = 'p-graph-pulse-exempt';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    board.setFilterQuery('zzz');

    await fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const input = screen.getByRole('textbox', { name: 'New task title' });
    await fireEvent.input(input, { target: { value: 'Ship it' } });
    await fireEvent.submit(input.closest('form')!);

    let highlighted: Element | null = null;
    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
      highlighted = container.querySelector('[data-highlight]');
      expect(highlighted).not.toBeNull();
    });
    const cls = highlighted!.getAttribute('class') ?? '';
    expect(cls).toContain('opacity-100');
    expect(cls).not.toContain('opacity-25');
  });

  it('points the back-handle preview arrow at the source origin while the tail tracks the pointer', async () => {
    const projectId = 'p-graph-back-preview';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const backHandle = container.querySelector(
      '[data-connect-dir="back"][data-connect-handle="a"]'
    );
    stubElementFromPoint(null);

    await fireEvent.pointerDown(backHandle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 60 });
    const first = parsePreview(previewPath(container));
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 320, clientY: 140 });
    const second = parsePreview(previewPath(container));

    expect(second.end).toEqual(first.end);
    expect(second.start).not.toEqual(first.start);
  });

  it('points the front-handle preview arrow at the drop target while the tail stays at the source', async () => {
    const projectId = 'p-graph-front-preview';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const frontHandle = container.querySelector(
      '[data-connect-dir="front"][data-connect-handle="a"]'
    );
    stubElementFromPoint(null);

    await fireEvent.pointerDown(frontHandle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 60 });
    const first = parsePreview(previewPath(container));
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 320, clientY: 140 });
    const second = parsePreview(previewPath(container));

    expect(second.start).toEqual(first.start);
    expect(second.end).not.toEqual(first.end);
  });
});
