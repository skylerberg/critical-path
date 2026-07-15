import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TaskDetail from './TaskDetail.svelte';
import { board } from '../lib/board.svelte';
import { users } from '../lib/users.svelte';
import type { BoardTask } from '../lib/board-types';

function task(
  id: string,
  columnId: string,
  title: string,
  overrides?: Partial<BoardTask>
): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    ...overrides,
  };
}

const image = {
  id: 'img1',
  url: '/api/images/img1',
  filename: 'mock.png',
  content_type: 'image/png',
  size_bytes: 123,
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  board.taskImages = {};
  users.reset();
  board.currentProjectId = 'p1';
  board.project = {
    id: 'p1',
    name: 'Game',
    description: '',
    is_template: false,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
  };
  board.columns = [
    { id: 'c1', name: 'Todo', position: 1000, is_done: false },
    { id: 'c2', name: 'Done', position: 2000, is_done: true },
  ];
  board.tasks = [
    task('t1', 'c1', 'Design cards', {
      label_ids: ['l1'],
      assignee_ids: ['u1'],
      blocker_ids: ['t2', 't3'],
      image_count: 1,
    }),
    task('t2', 'c1', 'Cut prototype'),
    task('t3', 'c2', 'Buy sleeves'),
  ];
  board.labels = [
    { id: 'l1', name: 'art', color: '#ff0000' },
    { id: 'l2', name: 'rules', color: '#00ff00' },
  ];
  users.users = [{ id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace' }];
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/tasks/t1') {
      return jsonResponse(200, {
        ...board.tasks[0],
        project_id: 'p1',
        images: [image],
      });
    }
    return jsonResponse(204);
  });
});

describe('TaskDetail', () => {
  it('renders title, labels, assignees, blockers, timestamps, and fetched images', async () => {
    render(TaskDetail, { projectId: 'p1', taskId: 't1' });

    expect(screen.getByLabelText('Task title')).toHaveValue('Design cards');

    expect(screen.getByRole('button', { name: 'art' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'rules' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Ada Lovelace/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    expect(screen.getByText('Cut prototype')).toBeInTheDocument();
    expect(screen.getByText('Buy sleeves')).toBeInTheDocument();
    expect(screen.getByText('Blocked by 1 open task')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove blocker Cut prototype' })
    ).toBeInTheDocument();

    expect(await screen.findByAltText('mock.png')).toHaveAttribute('src', '/api/images/img1');
    expect(screen.getByRole('button', { name: 'Delete image mock.png' })).toBeInTheDocument();

    expect(screen.getByText(/Created .+ · Updated .+/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete task' })).toBeInTheDocument();
  });

  it('shows a fallback when the task is not in the store', () => {
    render(TaskDetail, { projectId: 'p1', taskId: 'missing' });

    expect(screen.getByText('Task not found')).toBeInTheDocument();
  });
});
