import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import Project from './Project.svelte';
import { board } from '../lib/board.svelte';
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

function payload(projectId: string, tasks: BoardTask[]): BoardPayload {
  return {
    project: {
      id: projectId,
      name: 'Rulebook',
      description: '',
      is_template: false,
      archived_at: null,
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

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
});

describe('Graph', () => {
  it('renders a linked node per task, header tabs, and the critical path legend', async () => {
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
    expect(screen.getByText('Critical path')).toBeInTheDocument();
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(2);
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
});
