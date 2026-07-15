import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TaskCard from './TaskCard.svelte';
import type { BoardTask } from '../lib/board-types';
import { users } from '../lib/users.svelte';

const task: BoardTask = {
  id: 't1',
  column_id: 'c1',
  title: 'Design cards',
  description: null,
  position: 1000,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  label_ids: ['l1'],
  assignee_ids: ['u1'],
  blocker_ids: ['t9', 't8'],
  image_count: 3,
};

beforeEach(() => {
  users.reset();
  users.users = [{ id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace' }];
});

describe('TaskCard', () => {
  it('renders title, label chips, assignee avatar, blocked and image badges, and the link', () => {
    render(TaskCard, {
      task,
      projectId: 'p1',
      labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
      blockedCount: 2,
    });

    expect(screen.getByText('Design cards')).toBeInTheDocument();
    expect(screen.getByText('art')).toBeInTheDocument();
    expect(screen.getByTitle('Ada Lovelace')).toHaveTextContent('AL');
    expect(screen.getByTitle('Blocked by 2 open tasks')).toHaveTextContent('2');
    expect(screen.getByTitle('3 images')).toHaveTextContent('3');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/projects/p1/tasks/t1');
  });

  it('omits badges and chips when there is nothing to show', () => {
    render(TaskCard, {
      task: { ...task, label_ids: [], assignee_ids: [], blocker_ids: [], image_count: 0 },
      projectId: 'p1',
    });

    expect(screen.getByText('Design cards')).toBeInTheDocument();
    expect(screen.queryByText('art')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Blocked by/)).not.toBeInTheDocument();
  });

  it('dims the card when filtered out', () => {
    render(TaskCard, { task, projectId: 'p1', dimmed: true });

    expect(screen.getByRole('link').className).toContain('opacity-30');
  });
});
