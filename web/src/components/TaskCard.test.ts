import '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import TaskCard from './TaskCard.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';
import { todayISO } from '../lib/dates';
import { router } from '../lib/router.svelte';
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
  due_date: null,
  comment_count: 0,
};

beforeEach(() => {
  board.reset();
  users.reset();
  users.users = [{ id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', avatar_url: null }];
});

// Relative to the real today, so the colour bands stay meaningful as time passes.
function dueIn(days: number): BoardTask {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return { ...task, due_date: todayISO(date) };
}

function card(): HTMLElement {
  const element = screen.getByRole('link').parentElement;
  if (element === null) {
    throw new Error('The overlay link has no card container');
  }
  return element;
}

function pill(): HTMLElement {
  return screen.getByTitle(/^Due /);
}

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

    expect(card().className).toContain('opacity-30');
  });

  // The overlay link paints over its in-flow siblings, so without this the badge
  // and avatar tooltips stop reaching the pointer on every card, dated or not.
  it('raises the badge row above the overlay link', () => {
    render(TaskCard, { task, projectId: 'p1' });

    const row = screen.getByTitle('3 images').parentElement;
    expect(row?.className).toContain('relative');
    expect(row?.className).toContain('z-10');
  });

  // jsdom has no hit-testing, so this class pair is the only thing that can catch
  // the raised row swallowing clicks across the card's full width.
  it('leaves the gaps between badges to the overlay link', () => {
    render(TaskCard, { task, projectId: 'p1', blockedCount: 2 });

    expect(screen.getByTitle('3 images').parentElement?.className).toContain('pointer-events-none');
    for (const badge of ['3 images', 'Blocked by 2 open tasks']) {
      expect(screen.getByTitle(badge).className).toContain('pointer-events-auto');
    }
    expect(screen.getByTitle('Ada Lovelace').parentElement?.className).toContain(
      'pointer-events-auto'
    );
  });

  describe('due date pill', () => {
    it('renders nothing at all when the task has no date', () => {
      render(TaskCard, { task, projectId: 'p1' });

      expect(screen.queryByTitle(/^Due /)).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders nothing when the payload predates due_date', () => {
      const legacy: Partial<BoardTask> = { ...task };
      delete legacy.due_date;
      render(TaskCard, { task: legacy as BoardTask, projectId: 'p1' });

      expect(screen.queryByTitle(/^Due /)).not.toBeInTheDocument();
      expect(screen.getByText('Design cards')).toBeInTheDocument();
    });

    it('adds no badge row to an otherwise bare undated card', () => {
      render(TaskCard, {
        task: { ...task, label_ids: [], assignee_ids: [], blocker_ids: [], image_count: 0 },
        projectId: 'p1',
      });

      expect(document.querySelector('.z-10')).toBeNull();
    });

    it('colours a past date as overdue', () => {
      render(TaskCard, { task: dueIn(-2), projectId: 'p1' });

      expect(pill().className).toContain('text-danger');
    });

    it('colours today and tomorrow as due soon, with relative wording', () => {
      const { unmount } = render(TaskCard, { task: dueIn(0), projectId: 'p1' });
      expect(pill()).toHaveTextContent('Today');
      expect(pill().className).toContain('text-warning');
      unmount();

      render(TaskCard, { task: dueIn(1), projectId: 'p1' });
      expect(pill()).toHaveTextContent('Tomorrow');
      expect(pill().className).toContain('text-warning');
    });

    it('leaves a distant date neutral', () => {
      render(TaskCard, { task: dueIn(30), projectId: 'p1' });

      expect(pill().className).toContain('text-muted');
      expect(pill().className).not.toContain('text-warning');
      expect(pill().className).not.toContain('text-danger');
    });

    it('marks the task done on click, without navigating', () => {
      board.columns = [
        { id: 'c1', name: 'Todo', position: 1000, is_done: false },
        { id: 'c2', name: 'Done', position: 2000, is_done: true },
      ];
      const markTaskDone = vi.spyOn(board, 'markTaskDone').mockReturnValue(true);
      const navigate = vi.spyOn(router, 'navigate');
      render(TaskCard, { task: dueIn(-2), projectId: 'p1' });

      void fireEvent.click(screen.getByRole('button'));

      expect(markTaskDone).toHaveBeenCalledWith('t1');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('is inert once the task is done, and reads as complete', () => {
      board.columns = [{ id: 'c2', name: 'Done', position: 2000, is_done: true }];
      render(TaskCard, { task: dueIn(-2), projectId: 'p1', done: true });

      expect(pill().className).toContain('text-success');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('is inert with no done column to move the task into', () => {
      board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
      render(TaskCard, { task: dueIn(-2), projectId: 'p1' });

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('is inert on a read-only board', () => {
      board.columns = [{ id: 'c2', name: 'Done', position: 2000, is_done: true }];
      render(TaskCard, { task: dueIn(-2), projectId: 'p1', readonly: true });

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(pill().className).toContain('text-danger');
    });
  });
});
