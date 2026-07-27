import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import TaskComments from './TaskComments.svelte';
import { board, type TaskComment } from '../lib/board.svelte';
import { session } from '../lib/session.svelte';
import { toasts } from '../lib/toasts.svelte';
import { users } from '../lib/users.svelte';
import type { BoardTask } from '../lib/board-types';

function task(commentCount: number): BoardTask {
  return {
    id: 't1',
    column_id: 'c1',
    title: 'Design cards',
    description: null,
    position: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    comment_count: commentCount,
  };
}

function comment(id: string, userId: string, text: string, edited = false): TaskComment {
  return {
    id,
    task_id: 't1',
    user_id: userId,
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    created_at: `2026-01-0${id.slice(-1)}T00:00:00.000Z`,
    updated_at: edited ? '2026-02-01T00:00:00.000Z' : `2026-01-0${id.slice(-1)}T00:00:00.000Z`,
  };
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function mockCommentApi(): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/comments') {
      const sent = (await request.clone().json()) as { id: string; task_id: string; body: unknown };
      return jsonResponse(201, {
        ...sent,
        user_id: 'u1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });
    }
    if (request.method === 'PATCH' && url.pathname.startsWith('/api/comments/')) {
      const sent = (await request.clone().json()) as { body: unknown };
      return jsonResponse(200, {
        id: url.pathname.split('/').pop(),
        task_id: 't1',
        user_id: 'u1',
        body: sent.body,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });
    }
    return jsonResponse(204);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  mockCommentApi();
  board.reset();
  users.reset();
  toasts.toasts = [];
  board.currentProjectId = 'p1';
  board.tasks = [task(2)];
  users.users = [
    { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', avatar_url: null },
    { id: 'u2', email: 'bob@example.com', name: 'Bob Barker', avatar_url: null },
  ];
  session.user = { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', avatar_url: null };
  board.taskComments = { t1: [comment('c1', 'u1', 'mine'), comment('c2', 'u2', 'theirs', true)] };
});

describe('TaskComments', () => {
  it('renders comments oldest first with author names and timestamps', () => {
    render(TaskComments, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Ada Lovelace');
    expect(items[0]).toHaveTextContent('mine');
    expect(items[1]).toHaveTextContent('Bob Barker');
    expect(items[1]).toHaveTextContent('theirs');
    expect(items[0]).toHaveTextContent(dateFormat.format(new Date('2026-01-01T00:00:00.000Z')));
  });

  it('marks only an edited comment as edited', () => {
    render(TaskComments, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items[0]).not.toHaveTextContent('(edited)');
    expect(items[1]).toHaveTextContent('(edited)');
  });

  it('offers Edit and Delete only on the caller’s own comments', () => {
    render(TaskComments, { taskId: 't1' });

    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    expect(screen.getAllByRole('listitem')[0]).toContainElement(
      screen.getByRole('button', { name: 'Edit' })
    );
  });

  it('shows a spinner while a task with comments has none cached, and a note when empty', () => {
    board.taskComments = {};
    const { unmount } = render(TaskComments, { taskId: 't1' });
    expect(screen.getByRole('status', { name: 'Loading comments' })).toBeInTheDocument();
    unmount();

    board.taskComments = { t1: [] };
    render(TaskComments, { taskId: 't1' });
    expect(screen.getByText('No comments yet.')).toBeInTheDocument();
  });

  it('enables Comment only once the composer has content, then posts and clears it', async () => {
    const { component } = render(TaskComments, { taskId: 't1' });
    await tick();

    const button = screen.getByRole('button', { name: 'Comment' });
    expect(button).toBeDisabled();

    component.getComposerEditor()!.commands.insertContent('a new thought');
    await tick();
    expect(button).not.toBeDisabled();

    await fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/comments');
    const body = (await request.json()) as { task_id: string; body: unknown };
    expect(body.task_id).toBe('t1');
    expect(JSON.stringify(body.body)).toContain('a new thought');

    await tick();
    expect(component.getComposerEditor()!.isEmpty).toBe(true);
    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
  });

  it('submits the composer on Ctrl/Cmd + Enter', async () => {
    const { component, container } = render(TaskComments, { taskId: 't1' });
    await tick();
    component.getComposerEditor()!.commands.insertContent('shortcut');
    await tick();

    const composer = container.querySelector('.rte:not(.rte-bare) .tiptap')!;
    await fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(requestAt(0).method).toBe('POST');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/comments');
  });

  it('starts a fresh composer when the overlay switches task', async () => {
    board.tasks = [task(2), { ...task(0), id: 't2' }];
    board.taskComments = { ...board.taskComments, t2: [] };
    const { component, rerender } = render(TaskComments, { taskId: 't1' });
    await tick();
    component.getComposerEditor()!.commands.insertContent('half-written');
    await tick();
    expect(screen.getByRole('button', { name: 'Comment' })).not.toBeDisabled();

    await rerender({ taskId: 't2' });
    await tick();

    expect(component.getComposerEditor()!.isEmpty).toBe(true);
    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
  });

  it('requires a second click to delete, then sends the DELETE', async () => {
    render(TaskComments, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(fetchMock).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const request = requestAt(0);
    expect(request.method).toBe('DELETE');
    expect(new URL(request.url).pathname).toBe('/api/comments/c1');
    expect(board.tasks[0]!.comment_count).toBe(1);
  });

  it('replaces the body through the inline editor', async () => {
    render(TaskComments, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const request = requestAt(0);
    expect(request.method).toBe('PATCH');
    expect(new URL(request.url).pathname).toBe('/api/comments/c1');
    expect(JSON.stringify(await request.json())).toContain('mine');
  });

  it('toasts and refetches the detail payload when the post fails', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'POST') {
        return jsonResponse(404, { error: 'Task not found' });
      }
      return jsonResponse(200, {
        ...task(0),
        project_id: 'p1',
        images: [],
        comments: [],
      });
    });

    const { component } = render(TaskComments, { taskId: 't1' });
    await tick();
    component.getComposerEditor()!.commands.insertContent('doomed');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(toasts.toasts.at(-1)?.message).toBe('Task not found'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) => new URL((call[0] as Request).url).pathname === '/api/tasks/t1'
        )
      ).toBe(true)
    );
    expect(board.taskComments.t1).toEqual([]);
  });
});
