import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import Project from './Project.svelte';
import { board } from '../lib/board.svelte';
import { draftKey, drafts } from '../lib/drafts.svelte';
import { NODE_HEIGHT, NODE_WIDTH, computeGraph, panToNode, type ViewBox } from '../lib/graph';
import { session } from '../lib/session.svelte';
import { projectHref, taskHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
import { TASK_TITLE_MAX_LENGTH, truncateTitle } from '../lib/titles';
import { toasts } from '../lib/toasts.svelte';
import type { BoardPayload, BoardTask } from '../lib/board-types';

const me = {
  id: 'u-me',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
  email_verified: false,
};

const A = testUuid('a');
const B = testUuid('b');
const C = testUuid('c');
const X = testUuid('x');
const Y = testUuid('y');

function task(key: string, columnId: string, blockerKeys: string[] = []): BoardTask {
  return {
    id: testUuid(key),
    column_id: columnId,
    title: `Task ${key}`,
    description: null,
    position: 1000,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    column_since: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: blockerKeys.map(testUuid),
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
  };
}

// Extra `users` lets one mock answer both the board fetch and the project-scoped
// users fetch the project shell fires on load.
function payload(projectId: string, tasks: BoardTask[]): BoardPayload & { users: [] } {
  return {
    users: [],
    project: {
      id: projectId,
      name: 'Rulebook',
      description: '',
      archived_at: null,
      created_by: me.id,
      member_ids: [],
      members: [],
      is_public: false,
      color: null,
      created_at: '2026-07-15T00:00:00Z',
    },
    columns: [
      { id: 'todo', name: 'To Do', position: 1000, is_done: false },
      { id: 'done', name: 'Done', position: 2000, is_done: true },
    ],
    tasks,
    labels: [],
    changed_task_ids: [],
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

function nodeBox(
  container: HTMLElement,
  id: string
): { left: number; right: number; bottom: number; centerY: number } {
  const transform = container.querySelector(`[data-node-id="${id}"]`)?.getAttribute('transform');
  const m = (transform ?? '').match(/^translate\(([-\d.]+) ([-\d.]+)\)$/);
  if (m === null) throw new Error(`unexpected node transform: ${String(transform)}`);
  const left = Number(m[1]);
  const top = Number(m[2]);
  return {
    left,
    right: left + NODE_WIDTH,
    bottom: top + NODE_HEIGHT,
    centerY: top + NODE_HEIGHT / 2,
  };
}

type Point = [number, number];

function parseClosingPath(d: string): { start: Point; c1: Point; c2: Point; end: Point } {
  const n = /^M ([-\d.]+) ([-\d.]+) C ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)$/
    .exec(d)
    ?.slice(1)
    .map(Number);
  if (n === undefined) throw new Error(`unexpected closing path: ${d}`);
  return { start: [n[0]!, n[1]!], c1: [n[2]!, n[3]!], c2: [n[4]!, n[5]!], end: [n[6]!, n[7]!] };
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  drafts.clearAll();
  session.user = me;
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
});

describe('Graph', () => {
  it('renders a linked node per task and header tabs', async () => {
    const projectId = testUuid('p-graph-chain');
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
      projectHref(projectId, 'Rulebook')
    );
    expect(screen.getByRole('link', { name: 'Graph' })).toHaveAttribute(
      'href',
      projectHref(projectId, 'Rulebook', 'graph')
    );
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(2);
  });

  it('no longer renders the critical-path legend or accent-highlighted nodes', async () => {
    const projectId = testUuid('p-graph-no-critical');
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
    const projectId = testUuid('p-graph-anchors');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    const anchor = container.querySelector(`[data-node-id="${A}"] a`);
    expect(anchor).not.toBeNull();
    expect(anchor).toHaveAttribute('href', taskHref(A, 'Task a', 'graph'));
    expect(screen.getByRole('link', { name: 'Open task Task a' })).toBe(anchor);
  });

  it('clips a long title in the node label and in every handle name', async () => {
    const projectId = testUuid('p-graph-long-title');
    const long = 'G'.repeat(TASK_TITLE_MAX_LENGTH);
    const tasks = [{ ...task('a', 'todo'), title: long }];
    fetchMock.mockImplementation(async () => jsonResponse(200, payload(projectId, tasks)));

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    const shown = truncateTitle(long);
    expect(container.querySelector(`[data-node-id="${A}"] a span`)).toHaveTextContent(shown);
    expect(screen.getByRole('link', { name: `Open task ${shown}` })).not.toBeNull();
    expect(
      screen.getByRole('button', { name: `Drag to add a task that ${shown} blocks` })
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: `Drag to add a task that blocks ${shown}` })
    ).not.toBeNull();
  });

  it('keeps a long press on a node from raising the link menu mid-pan', async () => {
    const projectId = testUuid('p-graph-longpress');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    const anchor = screen.getByRole('link', { name: 'Open task Task a' });
    expect(anchor.className).toContain('touch-callout-none');

    const touch = new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
    });
    anchor.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);

    const mouse = new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
    });
    anchor.dispatchEvent(mouse);
    expect(mouse.defaultPrevented).toBe(false);
  });

  it('renders the shared filter bar on the graph view with no duplicate label chips', async () => {
    const projectId = testUuid('p-graph-filters');
    const withLabel = { ...task('a', 'todo'), label_ids: ['l1'] };
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        ...payload(projectId, [withLabel]),
        labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
      })
    );

    render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByLabelText('Filter tasks by title')).toBeInTheDocument();
    expect(screen.getAllByText('art')).toHaveLength(1);
  });

  it('shows the no-dependencies hint and no legend when tasks have no blockers', async () => {
    const projectId = testUuid('p-graph-no-deps');
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
    const projectId = testUuid('p-graph-cycle');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo', ['b']), task('b', 'todo', ['a'])]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByText('Dependency cycle detected')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Dependency graph"]')).toBeNull();
  });

  it('shows the empty state when the project has no tasks', async () => {
    const projectId = testUuid('p-graph-empty');
    fetchMock.mockImplementation(async () => jsonResponse(200, payload(projectId, [])));

    render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByText('No tasks to graph')).toBeInTheDocument();
  });

  it('offers Clear filters when a title filter dims nodes even though the project has no labels', async () => {
    const projectId = testUuid('p-graph-clear-no-labels');
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

    // setFilterQuery propagates asynchronously, so the header has to be awaited.
    const clear = await screen.findAllByRole('button', { name: 'Clear filters' });
    expect(clear).toHaveLength(1);
    await fireEvent.click(clear[0]!);
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
    const projectId = testUuid('p-graph-connect');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );
    const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const handle = container.querySelector(`[data-connect-handle="${A}"]`);
    const targetNode = container.querySelector(`[data-node-id="${B}"]`);
    expect(handle).not.toBeNull();
    expect(targetNode).not.toBeNull();
    stubElementFromPoint(targetNode);

    await fireEvent.pointerDown(handle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 60 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 60 });

    expect(spy).toHaveBeenCalledWith(B, A);
  });

  it('ignores a connect drop back onto the source node', async () => {
    const projectId = testUuid('p-graph-self');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );
    const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const handle = container.querySelector(`[data-connect-handle="${A}"]`);
    const sourceNode = container.querySelector(`[data-node-id="${A}"]`);
    stubElementFromPoint(sourceNode);

    await fireEvent.pointerDown(handle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });

    expect(spy).not.toHaveBeenCalled();
  });

  // a -> b -> c, then dragging c's front handle onto a asks for c to block a,
  // which closes the loop a -> b -> c -> a.
  async function rejectCycleFormingDrop(projectKey: string) {
    const projectId = testUuid(projectKey);
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        200,
        payload(projectId, [task('a', 'todo'), task('b', 'todo', ['a']), task('c', 'todo', ['b'])])
      )
    );

    const rendered = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(rendered.container.querySelectorAll('[data-node-id]')).toHaveLength(3);
    });
    const handle = rendered.container.querySelector(`[data-connect-handle="${C}"]`);
    stubElementFromPoint(rendered.container.querySelector(`[data-node-id="${A}"]`));

    await fireEvent.pointerDown(handle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });

    return rendered;
  }

  it('guards a cycle-forming drop: names the loop, toasts once, keeps the graph drawn', async () => {
    const { container } = await rejectCycleFormingDrop('p-graph-cycle-guard');

    expect(container.querySelector('svg[aria-label="Dependency graph"]')).not.toBeNull();
    expect(screen.queryByText('Dependency cycle detected')).not.toBeInTheDocument();
    expect(toasts.toasts.map((t) => t.message)).toEqual([
      'Adding this blocker would create a dependency cycle: Task a → Task b → Task c → Task a',
    ]);
    expect(board.tasks.find((t) => t.id === A)?.blocker_ids).toEqual([]);
  });

  it('outlines the loop nodes, its existing edges, and the edge that would close it', async () => {
    const { container } = await rejectCycleFormingDrop('p-graph-cycle-highlight');

    expect(
      [...container.querySelectorAll('[data-cycle]')].map((n) => n.getAttribute('data-node-id'))
    ).toEqual([A, B, C]);
    expect(container.querySelectorAll('[data-cycle-edge]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-cycle-closing-edge]')).toHaveLength(1);
    for (const path of container.querySelectorAll('[data-cycle-edge]')) {
      expect(path.getAttribute('class')).toContain('stroke-danger');
    }
  });

  it('routes the closing edge into the target and clear of the loop row', async () => {
    const { container } = await rejectCycleFormingDrop('p-graph-cycle-closing-shape');

    const closing = container.querySelector('[data-cycle-closing-edge]');
    expect(closing).not.toBeNull();
    const path = parseClosingPath(closing!.getAttribute('d') ?? '');
    const a = nodeBox(container, A);
    const c = nodeBox(container, C);

    expect(path.start).toEqual([c.left, c.centerY]);
    expect(path.end).toEqual([a.right, a.centerY]);
    // The last control point sits beyond the endpoint, so the arrowhead arrives
    // travelling into the node instead of out of its far side.
    expect(path.c2[0]).toBeGreaterThan(path.end[0]);
    // Midpoint of the cubic: the drawn curve, not just its controls, must clear the row.
    const apex =
      0.125 * path.start[1] + 0.375 * path.c1[1] + 0.375 * path.c2[1] + 0.125 * path.end[1];
    const row = Math.max(a.bottom, nodeBox(container, B).bottom, c.bottom);
    expect(apex).toBeGreaterThan(row);
  });

  it('never offers to break the loop it just named', async () => {
    await rejectCycleFormingDrop('p-graph-cycle-no-fix');

    expect(screen.queryByRole('button', { name: 'Remove dependency' })).toBeNull();
  });

  it('keeps a filtered-out loop node fully visible', async () => {
    const { container } = await rejectCycleFormingDrop('p-graph-cycle-filtered');

    board.setFilterQuery('Task b');
    flushSync();

    const nodes = [...container.querySelectorAll('[data-cycle]')];
    expect(nodes).toHaveLength(3);
    for (const node of nodes) {
      expect(node.getAttribute('class')).not.toContain('opacity-25');
    }
  });

  it('clears the loop highlight once it expires', async () => {
    vi.useFakeTimers();
    const { container } = await rejectCycleFormingDrop('p-graph-cycle-expiry');

    expect(container.querySelectorAll('[data-cycle]')).toHaveLength(3);

    vi.advanceTimersByTime(5000);
    flushSync();

    expect(container.querySelectorAll('[data-cycle]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-cycle-edge]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-cycle-closing-edge]')).toHaveLength(0);
  });

  it('selects an edge and removes the dependency via the delete chip', async () => {
    const projectId = testUuid('p-graph-delete');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo', ['a'])]))
    );
    const spy = vi.spyOn(board, 'removeBlocker').mockResolvedValue(undefined);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    const edge = await waitFor(() => {
      const found = container.querySelector(`[data-edge-id="${A}->${B}"]`);
      expect(found).not.toBeNull();
      return found!;
    });

    await fireEvent.click(edge);
    const chip = await screen.findByRole('button', { name: 'Remove dependency' });
    await fireEvent.click(chip);

    expect(spy).toHaveBeenCalledWith(B, A);
  });

  it('drags the back handle to add the reverse dependency', async () => {
    const projectId = testUuid('p-graph-back-handle');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );
    const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const backHandle = container.querySelector(
      `[data-connect-dir="back"][data-connect-handle="${A}"]`
    );
    const targetNode = container.querySelector(`[data-node-id="${B}"]`);
    expect(backHandle).not.toBeNull();
    stubElementFromPoint(targetNode);

    await fireEvent.pointerDown(backHandle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 60 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 60 });

    expect(spy).toHaveBeenCalledWith(A, B);
  });

  it('keeps the front handle direction (source blocks target)', async () => {
    const projectId = testUuid('p-graph-front-handle');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );
    const spy = vi.spyOn(board, 'addBlocker').mockResolvedValue(true);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const frontHandle = container.querySelector(
      `[data-connect-dir="front"][data-connect-handle="${A}"]`
    );
    const targetNode = container.querySelector(`[data-node-id="${B}"]`);
    stubElementFromPoint(targetNode);

    await fireEvent.pointerDown(frontHandle!, { pointerId: 1, button: 0 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 60 });

    expect(spy).toHaveBeenCalledWith(B, A);
  });

  it('highlights the source and target after a connect, then clears', async () => {
    const projectId = testUuid('p-graph-highlight');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );
    vi.spyOn(board, 'addBlocker').mockResolvedValue(true);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const handle = container.querySelector(`[data-connect-handle="${A}"]`);
    const targetNode = container.querySelector(`[data-node-id="${B}"]`);
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
    const projectId = testUuid('p-graph-new-task');
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
    expect(input).toHaveAttribute('autocapitalize', 'sentences');
    await fireEvent.input(input, { target: { value: 'Ship it' } });
    await fireEvent.submit(input.closest('form')!);

    expect(spy).toHaveBeenCalledWith('Ship it');
    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
      expect(container.querySelectorAll('[data-highlight]').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('pans the viewBox to reveal a task created outside the current view', async () => {
    const projectId = testUuid('p-graph-pan');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    const svg = container.querySelector('svg[aria-label="Dependency graph"]')!;
    const parseViewBox = (): ViewBox => {
      const [x, y, w, h] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
      return { x: x!, y: y!, w: w!, h: h! };
    };
    const before = parseViewBox();

    await fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const input = screen.getByRole('textbox', { name: 'New task title' });
    await fireEvent.input(input, { target: { value: 'Ship it' } });
    await fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const createdId = board.tasks.find((t) => t.title === 'Ship it')!.id;
    const result = computeGraph(board.tasks, board.columns);
    if (result.kind !== 'ok') throw new Error('expected a drawable graph');
    const node = result.layout.nodes.find((n) => n.id === createdId)!;
    const expected = panToNode(before, node);
    expect(expected).not.toBeNull();
    await waitFor(() => {
      const after = parseViewBox();
      expect(after.x).toBeCloseTo(expected!.x);
      expect(after.y).toBeCloseTo(expected!.y);
      expect(after.w).toBe(before.w);
      expect(after.h).toBe(before.h);
    });
  });

  it('keeps the viewBox still when the created node is already visible', async () => {
    const projectId = testUuid('p-graph-no-pan');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo')]))
    );
    vi.spyOn(board, 'createAndLinkTask').mockResolvedValue(A);

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    const svg = container.querySelector('svg[aria-label="Dependency graph"]')!;
    const before = svg.getAttribute('viewBox');

    await fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const input = screen.getByRole('textbox', { name: 'New task title' });
    await fireEvent.input(input, { target: { value: 'Already visible' } });
    await fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(container.querySelectorAll('[data-highlight]')).toHaveLength(1);
    });
    expect(svg.getAttribute('viewBox')).toBe(before);
  });

  it('highlights nodes matching a selected label and dims the rest', async () => {
    const projectId = testUuid('p-graph-label-filter');
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
      const a = container.querySelector(`[data-node-id="${A}"]`)!;
      const b = container.querySelector(`[data-node-id="${B}"]`)!;
      expect(a.getAttribute('class') ?? '').not.toContain('opacity-25');
      expect(a.querySelector('rect')!.getAttribute('class') ?? '').toContain('stroke-accent');
      expect(b.getAttribute('class') ?? '').toContain('opacity-25');
    });
  });

  it('dims nodes whose title does not match the shared title filter', async () => {
    const projectId = testUuid('p-graph-title-filter');
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
        container.querySelector(`[data-node-id="${A}"]`)!.getAttribute('class') ?? ''
      ).not.toContain('opacity-25');
      expect(
        container.querySelector(`[data-node-id="${B}"]`)!.getAttribute('class') ?? ''
      ).toContain('opacity-25');
    });
  });

  it('carries the active filter into every node link', async () => {
    const projectId = testUuid('p-graph-filtered-links');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    board.setFilterQuery('Task a');

    await waitFor(() => {
      expect(container.querySelector('a[aria-label="Open task Task a"]')).toHaveAttribute(
        'href',
        `${taskHref(A, 'Task a', 'graph')}?q=Task%20a`
      );
    });
  });

  it('keeps a freshly created highlighted node at full opacity even when it fails the active filter', async () => {
    const projectId = testUuid('p-graph-pulse-exempt');
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
    const projectId = testUuid('p-graph-back-preview');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const backHandle = container.querySelector(
      `[data-connect-dir="back"][data-connect-handle="${A}"]`
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
    const projectId = testUuid('p-graph-front-preview');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    const frontHandle = container.querySelector(
      `[data-connect-dir="front"][data-connect-handle="${A}"]`
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

describe('Graph new-task drafts', () => {
  const projectId = testUuid('p-graph-draft');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockGraph(): void {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo')]))
    );
  }

  function titleInput(): HTMLInputElement {
    return screen.getByRole('textbox', { name: 'New task title' });
  }

  async function openAndType(value: string): Promise<void> {
    await fireEvent.click(await screen.findByRole('button', { name: 'New task' }));
    await fireEvent.input(titleInput(), { target: { value } });
  }

  it('focuses the input when the user opens the composer', async () => {
    mockGraph();
    render(Project, { props: { projectId, view: 'graph' } });

    await fireEvent.click(await screen.findByRole('button', { name: 'New task' }));

    expect(titleInput()).toHaveFocus();
  });

  it('restores an unsent title on remount without stealing focus', async () => {
    mockGraph();
    const first = render(Project, { props: { projectId, view: 'graph' } });
    await openAndType('Half typed');
    first.unmount();

    render(Project, { props: { projectId, view: 'graph' } });

    const restored = await screen.findByRole('textbox', { name: 'New task title' });
    expect(restored).toHaveValue('Half typed');
    expect(restored).not.toHaveFocus();
  });

  it('stays open when the text is emptied', async () => {
    mockGraph();
    render(Project, { props: { projectId, view: 'graph' } });
    await openAndType('Half typed');

    await fireEvent.input(titleInput(), { target: { value: '' } });

    expect(titleInput()).toBeInTheDocument();
  });

  it('closes and clears the draft on submit', async () => {
    mockGraph();
    vi.spyOn(board, 'createAndLinkTask').mockResolvedValue(A);
    render(Project, { props: { projectId, view: 'graph' } });
    await openAndType('Ship it');

    await fireEvent.submit(titleInput().closest('form')!);

    expect(screen.queryByRole('textbox', { name: 'New task title' })).not.toBeInTheDocument();
    expect(drafts.get(draftKey.graphAddTask(projectId))).toBeNull();
  });

  it('stays closed on remount after Cancel discarded the draft', async () => {
    mockGraph();
    const first = render(Project, { props: { projectId, view: 'graph' } });
    await openAndType('Discard me');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel new task' }));
    first.unmount();

    render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByRole('button', { name: 'New task' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'New task title' })).not.toBeInTheDocument();
  });

  it('does not leak a draft into another project', async () => {
    mockGraph();
    const first = render(Project, { props: { projectId, view: 'graph' } });
    await openAndType('Project one only');
    first.unmount();

    const other = testUuid('p-graph-draft-other');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(other, [task('a', 'todo')]))
    );
    render(Project, { props: { projectId: other, view: 'graph' } });

    expect(await screen.findByRole('button', { name: 'New task' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'New task title' })).not.toBeInTheDocument();
  });
});

describe('Graph done-task visibility', () => {
  it('hides done tasks and the edges into them by default', async () => {
    const projectId = testUuid('p-graph-done-default');
    const tasks = [task('a', 'done'), task('b', 'todo', ['a']), task('c', 'todo', ['b'])];
    fetchMock.mockImplementation(async () => jsonResponse(200, payload(projectId, tasks)));

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    expect(container.querySelector(`[data-node-id="${A}"]`)).toBeNull();
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(1);
  });

  it('shows them again when the toggle is pressed, and hides them when pressed back', async () => {
    const projectId = testUuid('p-graph-done-toggle');
    const tasks = [task('a', 'done'), task('b', 'todo', ['a'])];
    fetchMock.mockImplementation(async () => jsonResponse(200, payload(projectId, tasks)));

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    const toggle = await screen.findByRole('button', { name: 'Show done (1)' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await fireEvent.click(toggle);
    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(1);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.click(toggle);
    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
  });

  it('offers no toggle when the project has nothing done', async () => {
    const projectId = testUuid('p-graph-done-none');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: /Show done/ })).not.toBeInTheDocument();
  });

  it('explains the empty graph when every task is done rather than telling you to add tasks', async () => {
    const projectId = testUuid('p-graph-done-all');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'done'), task('b', 'done', ['a'])]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByText('Everything here is done')).toBeInTheDocument();
    expect(screen.queryByText('No tasks to graph')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Show done (2)' }));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
  });

  it('keeps the toggle on across a trip to the board and resets it on another project', async () => {
    const projectId = testUuid('p-graph-done-persist');
    const otherId = testUuid('p-graph-done-other');
    fetchMock.mockImplementation(async (input) => {
      const { pathname } = new URL((input as Request).url);
      return pathname.includes(otherId)
        ? jsonResponse(200, payload(otherId, [task('x', 'done'), task('y', 'todo')]))
        : jsonResponse(200, payload(projectId, [task('a', 'done'), task('b', 'todo')]));
    });

    const view = render(Project, { props: { projectId, view: 'graph' } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Show done (1)' }));
    await waitFor(() => {
      expect(view.container.querySelectorAll(`[data-node-id="${A}"]`)).toHaveLength(1);
    });

    await view.rerender({ projectId, view: 'board' });
    await view.rerender({ projectId, view: 'graph' });
    expect(await screen.findByRole('button', { name: 'Show done (1)' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await view.rerender({ projectId: otherId, view: 'graph' });
    await waitFor(() => {
      expect(view.container.querySelector(`[data-node-id="${Y}"]`)).not.toBeNull();
    });
    expect(view.container.querySelector(`[data-node-id="${X}"]`)).toBeNull();
    expect(screen.getByRole('button', { name: 'Show done (1)' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('hides a done task that a live task blocks, not just done blockers', async () => {
    const projectId = testUuid('p-graph-done-downstream');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'done', ['a'])]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
    expect(container.querySelector(`[data-node-id="${A}"]`)).not.toBeNull();
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(0);
  });

  it('keeps the toggle reachable when showing done tasks reveals a cycle', async () => {
    const projectId = testUuid('p-graph-done-cycle');
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        200,
        payload(projectId, [task('a', 'done', ['b']), task('b', 'done', ['a']), task('c', 'todo')])
      )
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    const toggle = await screen.findByRole('button', { name: 'Show done (2)' });
    await fireEvent.click(toggle);
    expect(await screen.findByText('Dependency cycle detected')).toBeInTheDocument();

    // The only way out of the cycle state the click created.
    await fireEvent.click(screen.getByRole('button', { name: 'Show done (2)' }));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(1);
    });
  });

  it('creates graph tasks in the first column that is not done', async () => {
    const projectId = testUuid('p-graph-done-create');
    const payloadWithDoneFirst = {
      ...payload(projectId, [task('a', 'todo')]),
      columns: [
        { id: 'done', name: 'Done', position: 1000, is_done: true },
        { id: 'todo', name: 'To Do', position: 2000, is_done: false },
      ],
    };
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method !== 'GET') {
        return jsonResponse(201, {});
      }
      return jsonResponse(200, payloadWithDoneFirst);
    });

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await fireEvent.click(await screen.findByRole('button', { name: 'New task' }));
    const input = await screen.findByRole('textbox', { name: 'New task title' });
    await fireEvent.input(input, { target: { value: 'Playtest' } });
    await fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    expect(board.tasks.find((t) => t.title === 'Playtest')?.column_id).toBe('todo');
  });
});

describe('Graph for a viewer', () => {
  function viewerPayload(projectId: string, tasks: BoardTask[]): BoardPayload & { users: [] } {
    const base = payload(projectId, tasks);
    return {
      ...base,
      project: {
        ...base.project,
        created_by: 'u-owner',
        member_ids: [me.id],
        members: [{ user_id: me.id, role: 'viewer' }],
      },
    };
  }

  it('drops the new-task control, the connect handles and the drag hint', async () => {
    const projectId = testUuid('p-graph-viewer');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, viewerPayload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    });
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull();
    expect(container.querySelectorAll('[data-connect-handle]')).toHaveLength(0);
    expect(screen.getByText('No dependencies yet.')).toBeInTheDocument();
    expect(screen.queryByText(/drag a node's handle/)).toBeNull();
  });

  it('offers no way to delete a selected edge', async () => {
    const projectId = testUuid('p-graph-viewer-edge');
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, viewerPayload(projectId, [task('a', 'todo'), task('b', 'todo', ['a'])]))
    );

    const { container } = render(Project, { props: { projectId, view: 'graph' } });

    const edge = await waitFor(() => {
      const found = container.querySelector('[data-edge-id]');
      expect(found).not.toBeNull();
      return found!;
    });
    await fireEvent.click(edge);

    expect(screen.queryByRole('button', { name: 'Remove dependency' })).toBeNull();
  });

  it('says the graph is empty without pointing at a board it cannot add to', async () => {
    const projectId = testUuid('p-graph-viewer-empty');
    fetchMock.mockImplementation(async () => jsonResponse(200, viewerPayload(projectId, [])));

    render(Project, { props: { projectId, view: 'graph' } });

    expect(await screen.findByText('No tasks to graph')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'board' })).toBeNull();
  });
});
