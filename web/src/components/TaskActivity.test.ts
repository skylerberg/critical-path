import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import TaskActivity from './TaskActivity.svelte';
import { board, type TaskComment } from '../lib/board.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { session } from '../lib/session.svelte';
import { taskActivity, type TaskActivityEntry } from '../lib/taskActivity.svelte';
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
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: commentCount,
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
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    open_task_count: 0,
    done_task_count: 0,
    position: null,
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

function entry(
  id: string,
  kind: TaskActivityEntry['kind'],
  values: {
    old_value?: TaskActivityEntry['old_value'];
    new_value?: TaskActivityEntry['new_value'];
    created_at?: string;
    actor_user_id?: string;
  } = {}
): TaskActivityEntry {
  return {
    id,
    kind,
    actor_user_id: values.actor_user_id ?? 'u2',
    old_value: values.old_value ?? null,
    new_value: values.new_value ?? null,
    created_at: values.created_at ?? '2026-01-01T12:00:00.000Z',
  };
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

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

describe('TaskActivity comments', () => {
  it('renders comments oldest first with author names and timestamps', () => {
    render(TaskActivity, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Ada Lovelace');
    expect(items[0]).toHaveTextContent('mine');
    expect(items[1]).toHaveTextContent('Bob Barker');
    expect(items[1]).toHaveTextContent('theirs');
    expect(items[0]).toHaveTextContent(dateFormat.format(new Date('2026-01-01T00:00:00.000Z')));
  });

  it('marks only an edited comment as edited', () => {
    render(TaskActivity, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items[0]).not.toHaveTextContent('(edited)');
    expect(items[1]).toHaveTextContent('(edited)');
  });

  it('offers Edit and Delete only on the caller’s own comments, each naming its comment', () => {
    render(TaskActivity, { taskId: 't1' });

    expect(screen.getAllByRole('button', { name: /^Edit comment from/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Delete comment from/ })).toHaveLength(1);
    expect(screen.getAllByRole('listitem')[0]).toContainElement(
      screen.getByRole('button', { name: `Edit ${own}` })
    );
  });

  it('shows a spinner while a task with comments has none cached, and a note when empty', () => {
    board.taskComments = {};
    const { unmount } = render(TaskActivity, { taskId: 't1' });
    expect(screen.getByRole('status', { name: 'Loading activity' })).toBeInTheDocument();
    unmount();

    board.taskComments = { t1: [] };
    render(TaskActivity, { taskId: 't1' });
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
  });

  it('enables Comment only once the composer has content, then posts and clears it', async () => {
    const { component } = render(TaskActivity, { taskId: 't1' });
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

  it('offers only project people in the composer and posts the mention it inserts', async () => {
    projects.projects = [projectListItem(['u2'])];
    users.setForProject('p1', [
      ...users.users,
      { id: 'u3', name: 'Stale Assignee', avatar_url: null },
    ]);
    const { component } = render(TaskActivity, { taskId: 't1' });
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
    const { component, container } = render(TaskActivity, { taskId: 't1' });
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
    const { component, rerender } = render(TaskActivity, { taskId: 't1' });
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
    render(TaskActivity, { taskId: 't1' });

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
    const { component } = render(TaskActivity, { taskId: 't1' });

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

    const { component } = render(TaskActivity, { taskId: 't1' });
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
    render(TaskActivity, { taskId: 't1' });
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

    const { component } = render(TaskActivity, { taskId: 't1' });
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

describe('TaskActivity history', () => {
  beforeEach(() => {
    board.taskComments = { t1: [] };
  });

  it('renders a sentence and an actor for every kind', () => {
    taskActivity.entries = [
      entry('a1', 'created', { new_value: { text: 'Design cards' } }),
      entry('a2', 'title_changed', {
        old_value: { text: 'Old name' },
        new_value: { text: 'New name' },
      }),
      entry('a3', 'column_changed', {
        old_value: { id: 'c1', name: 'Backlog' },
        new_value: { id: 'c2', name: 'In Progress' },
      }),
      entry('a4', 'assignee_added', { new_value: { id: 'u1', name: 'Ada Lovelace' } }),
      entry('a5', 'assignee_removed', { old_value: { id: 'u1', name: 'Ada Lovelace' } }),
      entry('a6', 'blocker_added', { new_value: { id: 't9', name: 'Ship the API' } }),
      entry('a7', 'blocker_removed', { old_value: { id: 't9', name: 'Ship the API' } }),
      entry('a8', 'archived'),
      entry('a9', 'restored'),
    ];

    render(TaskActivity, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(9);
    expect(items[0]).toHaveTextContent('Bob Barker');
    expect(items[0]).toHaveTextContent('created this task');
    expect(items[1]).toHaveTextContent('renamed this from “Old name” to “New name”');
    expect(items[2]).toHaveTextContent('moved this from Backlog to In Progress');
    expect(items[3]).toHaveTextContent('assigned Ada Lovelace');
    expect(items[4]).toHaveTextContent('unassigned Ada Lovelace');
    expect(items[5]).toHaveTextContent('added Ship the API as a blocker');
    expect(items[6]).toHaveTextContent('removed Ship the API as a blocker');
    expect(items[7]).toHaveTextContent('archived this task');
    expect(items[8]).toHaveTextContent('restored this task');
    expect(items[0]).toHaveTextContent(dateFormat.format(new Date('2026-01-01T12:00:00.000Z')));
  });

  it('interleaves entries with comments in time order', () => {
    board.taskComments = { t1: [ownComment, theirComment] };
    taskActivity.entries = [
      entry('a1', 'created', {
        new_value: { text: 'Design cards' },
        created_at: '2025-12-31T00:00:00.000Z',
      }),
      entry('a2', 'archived', { created_at: '2026-01-01T12:00:00.000Z' }),
    ];

    render(TaskActivity, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('created this task');
    expect(items[1]).toHaveTextContent('mine');
    expect(items[2]).toHaveTextContent('archived this task');
    expect(items[3]).toHaveTextContent('theirs');
  });

  it('reads a due date as words, in every direction it can change', () => {
    taskActivity.entries = [
      entry('a1', 'due_date_changed', { new_value: { text: '2026-08-03' } }),
      entry('a2', 'due_date_changed', {
        old_value: { text: '2026-08-03' },
        new_value: { text: '2027-01-04' },
      }),
      entry('a3', 'due_date_changed', { old_value: { text: '2027-01-04' } }),
    ];

    render(TaskActivity, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/Bob Barker .* set the due date to .*2026/);
    expect(items[1]).toHaveTextContent(/moved the due date from .*2026.* to .*2027/);
    expect(items[2]).toHaveTextContent('cleared the due date');
  });

  // Formatting these instead would render Jan 26, 1903 and throw out of the render.
  it('renders a due date the log did not record as a calendar day', () => {
    taskActivity.entries = [
      entry('a1', 'due_date_changed', { new_value: { text: '03.08.2026' } }),
      entry('a2', 'due_date_changed', {
        old_value: { text: '2026-08-03' },
        new_value: { text: 'tomorrow' },
      }),
    ];

    render(TaskActivity, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('set the due date to 03.08.2026');
    expect(items[1]).toHaveTextContent(/moved the due date from .*2026.* to tomorrow/);
  });

  it('names a column the board no longer has', () => {
    board.columns = [];
    taskActivity.entries = [
      entry('a1', 'column_changed', {
        old_value: { id: 'gone', name: 'Deleted column' },
        new_value: { id: 'c9', name: 'Somewhere else' },
      }),
    ];

    render(TaskActivity, { taskId: 't1' });

    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
      'moved this from Deleted column to Somewhere else'
    );
  });

  it('shows a label’s color only while the label still exists', () => {
    board.labels = [{ id: 'l1', name: 'bug', color: '#ff0000' }];
    taskActivity.entries = [
      entry('a1', 'label_added', { new_value: { id: 'l1', name: 'bug' } }),
      entry('a2', 'label_removed', { old_value: { id: 'l2', name: 'gone' } }),
    ];

    render(TaskActivity, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('added the label bug');
    expect(items[1]).toHaveTextContent('removed the label gone');
    const dots = items[0]!.querySelectorAll<HTMLElement>('[aria-hidden="true"]');
    expect(dots).toHaveLength(1);
    expect(dots[0]!.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(items[1]!.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it('discloses the previous description only when there was one', async () => {
    taskActivity.entries = [
      entry('a1', 'description_changed', {
        old_value: {
          doc: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'what it said' }] }],
          },
        },
        new_value: { doc: null },
      }),
      entry('a2', 'description_changed', {
        old_value: { doc: null },
        new_value: { doc: { type: 'doc' } },
      }),
    ];

    render(TaskActivity, { taskId: 't1' });

    const disclosures = screen.getAllByText('Show the previous description');
    expect(disclosures).toHaveLength(1);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('edited the description');
    await fireEvent.click(disclosures[0]!);
    expect(screen.getByText('what it said')).toBeInTheDocument();
  });

  it('reports a failed log load inline rather than as a toast, without calling it empty', () => {
    taskActivity.error = true;

    render(TaskActivity, { taskId: 't1' });

    expect(screen.getByText('The history of this task could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No activity yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(toasts.toasts).toEqual([]);
  });

  it('keeps a loaded log on screen behind a failed refresh', () => {
    taskActivity.error = true;
    taskActivity.entries = [entry('a1', 'archived')];

    render(TaskActivity, { taskId: 't1' });

    expect(screen.getByText('The history of this task could not be loaded.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('archived this task');
  });

  it('names an actor the users store cannot resolve', () => {
    taskActivity.entries = [entry('a1', 'archived', { actor_user_id: 'departed' })];

    render(TaskActivity, { taskId: 't1' });

    const item = screen.getAllByRole('listitem')[0];
    expect(item).toHaveTextContent('Unknown user');
    expect(item).toHaveTextContent('archived this task');
  });
});
