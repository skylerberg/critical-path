import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import TaskComments from './TaskComments.svelte';
import { board, type TaskComment } from '../lib/board.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { session } from '../lib/session.svelte';
import { taskActivity } from '../lib/taskActivity.svelte';
import { toasts } from '../lib/toasts.svelte';
import { users } from '../lib/users.svelte';
import type { BoardTask } from '../lib/board-types';

function task(commentCount: number): BoardTask {
  return {
    id: 't1',
    column_id: 'c1',
    title: 'Design cards',
    description: null,
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    cover_image_url: null,
    due_date: null,
    comment_count: commentCount,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

function projectListItem(memberIds: string[]): Project {
  return {
    id: 'p1',
    name: 'Cards',
    description: '',
    created_by: 'u1',
    member_ids: memberIds,
    members: memberIds.map((user_id) => ({ user_id, role: 'editor' as const })),
    is_public: false,
    color: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    open_task_count: 0,
    done_task_count: 0,
    sort_key: null,
    last_seen_at: null,
    has_unseen_changes: false,
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

// The controls appear on focus, and focusin bubbles from the contenteditable to
// the wrapper that holds both the editor and the Comment button.
function composerBody(container: HTMLElement): HTMLElement {
  return container.querySelector('.rte:not(.rte-bare) .tiptap') as HTMLElement;
}

const ownComment = comment('c1', 'u1', 'mine');
const theirComment = comment('c2', 'u2', 'theirs', true);
const own = `comment from ${dateFormat.format(new Date(ownComment.created_at))}`;

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
  Reflect.deleteProperty(navigator, 'clipboard');
  fetchMock.mockReset();
  mockCommentApi();
  board.reset();
  projects.reset();
  users.reset();
  taskActivity.reset();
  toasts.toasts = [];
  board.currentProjectId = 'p1';
  board.tasks = [task(2)];
  users.users = [
    { id: 'u1', name: 'Ada Lovelace', avatar_url: null },
    { id: 'u2', name: 'Bob Barker', avatar_url: null },
  ];
  session.user = {
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    avatar_url: null,
    email_verified: false,
  };
  board.taskComments = { t1: [ownComment, theirComment] };
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

  it('offers Edit and Delete only on the caller’s own comments, each naming its comment', () => {
    render(TaskComments, { taskId: 't1' });

    expect(screen.getAllByRole('button', { name: /^Edit comment from/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Delete comment from/ })).toHaveLength(1);
    expect(screen.getAllByRole('listitem')[0]).toContainElement(
      screen.getByRole('button', { name: `Edit ${own}` })
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
    const { component, container } = render(TaskComments, { taskId: 't1' });
    await tick();

    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
    await fireEvent.focusIn(composerBody(container));

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

  it('keeps the Comment button up after a blur while a draft remains', async () => {
    const { component, container } = render(TaskComments, { taskId: 't1' });
    await tick();
    await fireEvent.focusIn(composerBody(container));
    component.getComposerEditor()!.commands.insertContent('half-written');
    await tick();

    await fireEvent.focusOut(composerBody(container));
    expect(screen.getByRole('button', { name: 'Comment' })).not.toBeDisabled();
  });

  it('puts the Comment button away once the composer is blurred and empty', async () => {
    const { container } = render(TaskComments, { taskId: 't1' });
    await tick();
    await fireEvent.focusIn(composerBody(container));
    expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument();

    await fireEvent.focusOut(composerBody(container));
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
  });

  it('keeps the Comment button while focus moves from the editor onto it', async () => {
    const { container } = render(TaskComments, { taskId: 't1' });
    await tick();
    await fireEvent.focusIn(composerBody(container));
    const button = screen.getByRole('button', { name: 'Comment' });

    await fireEvent.focusOut(composerBody(container), { relatedTarget: button });
    expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument();
  });

  // The composer may hide; an edit the user opened on purpose may not, or a
  // select-all-delete would leave them in it with no way out.
  it('keeps Save and Cancel on a pre-filled edit editor that was never focused', async () => {
    render(TaskComments, { taskId: 't1' });
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: `Edit ${own}` }));
    await tick();

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders the composer, and an open edit editor, one row tall', async () => {
    const { container } = render(TaskComments, { taskId: 't1' });
    await tick();
    expect(container.querySelectorAll('.rte-compact')).toHaveLength(1);

    await fireEvent.click(screen.getByRole('button', { name: `Edit ${own}` }));
    await tick();
    expect(container.querySelectorAll('.rte-compact')).toHaveLength(2);
  });

  it('offers only project people in the composer and posts the mention it inserts', async () => {
    projects.projects = [projectListItem(['u2'])];
    users.setForProject('p1', [
      ...users.users,
      { id: 'u3', name: 'Stale Assignee', avatar_url: null },
    ]);
    const { component } = render(TaskComments, { taskId: 't1' });
    await tick();

    component.getComposerEditor()!.commands.insertContent('@');
    await screen.findByRole('listbox', { name: 'Mention a person' });
    await waitFor(() =>
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        expect.stringContaining('Ada Lovelace'),
        expect.stringContaining('Bob Barker'),
      ])
    );

    await fireEvent.click(screen.getAllByRole('option')[1]);
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = (await requestAt(0).json()) as { body: unknown };
    expect(JSON.stringify(body.body)).toContain('"type":"mention"');
    expect(JSON.stringify(body.body)).toContain('"id":"u2"');
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
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
  });

  it('requires a second click to delete, then sends the DELETE', async () => {
    render(TaskComments, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: `Delete ${own}` }));
    expect(fetchMock).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: `Confirm delete of ${own}` }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const request = requestAt(0);
    expect(request.method).toBe('DELETE');
    expect(new URL(request.url).pathname).toBe('/api/comments/c1');
    expect(board.tasks[0]!.comment_count).toBe(1);
  });

  it('sends the text typed into the inline editor, then closes it', async () => {
    const { component } = render(TaskComments, { taskId: 't1' });

    await fireEvent.click(screen.getByRole('button', { name: `Edit ${own}` }));
    await tick();

    component.getEditingEditor()!.commands.insertContent('rewritten ');
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const request = requestAt(0);
    expect(request.method).toBe('PATCH');
    expect(new URL(request.url).pathname).toBe('/api/comments/c1');
    const sent = JSON.stringify(await request.json());
    expect(sent).toContain('rewritten');
    expect(sent).toContain('mine');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
  });

  it('keeps the inline editor and its text when the save is rejected', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'PATCH') {
        return jsonResponse(404, { error: 'Comment not found' });
      }
      if (new URL(request.url).pathname === '/api/tasks/t1') {
        return jsonResponse(200, {
          ...task(2),
          project_id: 'p1',
          images: [],
          comments: [ownComment, theirComment],
        });
      }
      return jsonResponse(204);
    });

    const { component } = render(TaskComments, { taskId: 't1' });
    await fireEvent.click(screen.getByRole('button', { name: `Edit ${own}` }));
    await tick();
    component.getEditingEditor()!.commands.insertContent('rewritten ');
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toasts.toasts.at(-1)?.message).toBe('Comment not found'));

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(component.getEditingEditor()!.getText()).toContain('rewritten');
  });

  it('re-renders a body a teammate edited over the socket', async () => {
    render(TaskComments, { taskId: 't1' });
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('theirs');

    board.applyRealtime({
      type: 'comment_updated',
      project_id: 'p1',
      data: { ...theirComment, body: comment('c2', 'u2', 'reworded').body },
    });

    await waitFor(() => expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('reworded'));
    expect(screen.getAllByRole('listitem')[1]).not.toHaveTextContent('theirs');
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
