import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TaskCard from './TaskCard.svelte';
import { board } from '../lib/board.svelte';
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
  comment_count: 0,
};

beforeEach(() => {
  board.reset();
  users.reset();
  users.users = [{ id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', avatar_url: null }];
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
    expect(screen.queryByTitle(/comment/)).not.toBeInTheDocument();
  });

  it('shows the comment badge, pluralized, only when there are comments', () => {
    const { unmount } = render(TaskCard, {
      task: { ...task, comment_count: 3 },
      projectId: 'p1',
    });
    expect(screen.getByTitle('3 comments')).toHaveTextContent('3');
    unmount();

    render(TaskCard, { task: { ...task, comment_count: 1 }, projectId: 'p1' });
    expect(screen.getByTitle('1 comment')).toHaveTextContent('1');
  });

  it('shows the badge row when the comment count is the only badge', () => {
    render(TaskCard, {
      task: {
        ...task,
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        image_count: 0,
        comment_count: 2,
      },
      projectId: 'p1',
    });

    expect(screen.getByTitle('2 comments')).toHaveTextContent('2');
  });

  it('renders no comment badge when the payload predates comment_count', () => {
    const legacy: Partial<BoardTask> = { ...task };
    delete legacy.comment_count;
    render(TaskCard, { task: legacy as BoardTask, projectId: 'p1' });

    expect(screen.queryByTitle(/comment/)).not.toBeInTheDocument();
    expect(screen.getByText('Design cards')).toBeInTheDocument();
  });

  it('carries the active filters into the task link so closing the card comes back filtered', () => {
    board.setFilters({ labelIds: ['l1'], assigneeIds: [], query: 'boss' });

    render(TaskCard, { task, projectId: 'p1' });

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/projects/p1/tasks/t1?labels=l1&q=boss'
    );
  });

  it('points at the public path when readonly, changing nothing else', () => {
    render(TaskCard, {
      task,
      projectId: 'p1',
      readonly: true,
      labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
      blockedCount: 2,
    });

    expect(screen.getByRole('link')).toHaveAttribute('href', '/public/projects/p1/tasks/t1');
    expect(screen.getByText('Design cards')).toBeInTheDocument();
    expect(screen.getByText('art')).toBeInTheDocument();
    expect(screen.getByTitle('Ada Lovelace')).toHaveTextContent('AL');
    expect(screen.getByTitle('Blocked by 2 open tasks')).toHaveTextContent('2');
    expect(screen.getByTitle('3 images')).toHaveTextContent('3');
  });

  it('dims the card when filtered out', () => {
    render(TaskCard, { task, projectId: 'p1', dimmed: true });

    expect(screen.getByRole('link').className).toContain('opacity-30');
  });
});
