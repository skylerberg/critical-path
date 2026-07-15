import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import Graph from './Graph.svelte';
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
});

describe('Graph', () => {
  it('renders a rect node per task, header links, and the critical path legend', async () => {
    const projectId = 'p-graph-chain';
    const tasks = [task('a', 'todo'), task('b', 'todo', ['a']), task('c', 'todo', ['b'])];
    fetchMock.mockImplementation(async () => jsonResponse(200, payload(projectId, tasks)));

    const { container } = render(Graph, { props: { projectId } });

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

  it('shows the no-dependencies hint and no legend when tasks have no blockers', async () => {
    const projectId = 'p-graph-no-deps';
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, payload(projectId, [task('a', 'todo'), task('b', 'todo')]))
    );

    const { container } = render(Graph, { props: { projectId } });

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

    const { container } = render(Graph, { props: { projectId } });

    expect(await screen.findByText('Dependency cycle detected')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Dependency graph"]')).toBeNull();
  });

  it('shows the empty state when the project has no tasks', async () => {
    const projectId = 'p-graph-empty';
    fetchMock.mockImplementation(async () => jsonResponse(200, payload(projectId, [])));

    render(Graph, { props: { projectId } });

    expect(await screen.findByText('No tasks to graph')).toBeInTheDocument();
  });

  it('fetches exactly once when the load keeps failing with changing messages', async () => {
    const projectId = 'p-graph-error';
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      return jsonResponse(503, { error: `down ${calls}` });
    });

    render(Graph, { props: { projectId } });

    expect(await screen.findByText('down 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
