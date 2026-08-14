import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import TaskHistory from './TaskHistory.svelte';
import { board, type TaskComment } from '../lib/board.svelte';
import { projects } from '../lib/projects.svelte';
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
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: commentCount,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
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

const previousDoc = {
  type: 'doc' as const,
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'what it said' }] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a point' }] }],
        },
      ],
    },
  ],
};

// Spreading navigator to stub it would drop the prototype getters the editor
// reads, so only the one property moves.
function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const ownComment = comment('c1', 'u1', 'mine');
const theirComment = comment('c2', 'u2', 'theirs', true);

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
describe('TaskHistory', () => {
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

    render(TaskHistory, { taskId: 't1' });

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

  it('renders all six checklist kinds without falling through to the unknown-kind arm', () => {
    taskActivity.entries = [
      entry('a1', 'checklist_item_added', { new_value: { text: 'write it' } }),
      entry('a2', 'checklist_item_checked', { new_value: { text: 'write it' } }),
      entry('a3', 'checklist_item_unchecked', { new_value: { text: 'write it' } }),
      entry('a4', 'checklist_item_renamed', {
        old_value: { text: 'write it' },
        new_value: { text: 'write the test' },
      }),
      entry('a5', 'checklist_item_removed', { old_value: { text: 'write the test' } }),
      entry('a6', 'checklist_item_promoted', {
        old_value: { text: 'too big' },
        new_value: { id: 't9', name: 'Too big' },
      }),
    ];

    render(TaskHistory, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('added “write it” to the checklist');
    expect(items[1]).toHaveTextContent('ticked “write it”');
    expect(items[2]).toHaveTextContent('unticked “write it”');
    expect(items[3]).toHaveTextContent('renamed the checklist item “write it” to “write the test”');
    expect(items[4]).toHaveTextContent('removed “write the test” from the checklist');
    expect(items[5]).toHaveTextContent('turned “too big” into the card Too big');
    for (const item of items) {
      expect(item).not.toHaveTextContent('updated this task');
    }
  });

  it('renders a kind it does not know as a plain update, not a blank line', () => {
    const futureKind: string = 'kind_from_a_later_release';
    taskActivity.entries = [
      entry('a1', futureKind as TaskActivityEntry['kind']),
      entry('a2', 'archived', { created_at: '2026-01-01T13:00:00.000Z' }),
    ];

    render(TaskHistory, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Bob Barker');
    expect(items[0]).toHaveTextContent('updated this task');
    expect(items[0]).toHaveTextContent(dateFormat.format(new Date('2026-01-01T12:00:00.000Z')));
    expect(items[1]).toHaveTextContent('archived this task');
    expect(items[1]).not.toHaveTextContent('updated this task');
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

    render(TaskHistory, { taskId: 't1' });

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

    render(TaskHistory, { taskId: 't1' });

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

    render(TaskHistory, { taskId: 't1' });

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

    render(TaskHistory, { taskId: 't1' });

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('added the label bug');
    expect(items[1]).toHaveTextContent('removed the label gone');
    const dots = items[0]!.querySelectorAll<HTMLElement>('[aria-hidden="true"]');
    expect(dots).toHaveLength(1);
    expect(dots[0]!.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(items[1]!.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it('discloses the previous description only when there was one, and renders it formatted', async () => {
    taskActivity.entries = [
      entry('a1', 'description_changed', { old_value: { doc: previousDoc } }),
      entry('a2', 'description_changed', {
        old_value: { doc: null },
        new_value: { doc: { type: 'doc' } },
      }),
      entry('a3', 'description_changed', {
        old_value: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      }),
    ];

    const { container } = render(TaskHistory, { taskId: 't1' });

    const disclosures = screen.getAllByText('Show the previous description');
    expect(disclosures).toHaveLength(1);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('edited the description');

    await fireEvent.click(disclosures[0]!);

    await waitFor(() =>
      expect(container.querySelector('.rte-bare h2')).toHaveTextContent('what it said')
    );
    expect(container.querySelector('.rte-bare li')).toHaveTextContent('a point');
  });

  // The flattener this replaced read an image as no text at all, so a description
  // that was one screenshot had nothing to show. The editor's image node is
  // block-level, so that description is a bare image beside the paragraphs.
  it('discloses a previous description that carries no text of its own', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    taskActivity.entries = [
      entry('a1', 'description_changed', {
        old_value: {
          doc: { type: 'doc', content: [{ type: 'image', attrs: { src: '/api/images/a' } }] },
        },
      }),
    ];

    const { container } = render(TaskHistory, { taskId: 't1' });
    await fireEvent.click(screen.getByText('Show the previous description'));

    await waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute('src', '/api/images/a')
    );
    await fireEvent.click(await screen.findByRole('button', { name: 'Copy as Markdown' }));
    expect(writeText).toHaveBeenCalledWith('![](/api/images/a)');
  });

  // Every entry's body would otherwise be a live ProseMirror instance from the
  // moment the card opens, because a shut <details> still renders its children.
  it('mounts the editor for a previous description only once it is expanded', async () => {
    taskActivity.entries = [
      entry('a1', 'description_changed', { old_value: { doc: previousDoc } }),
    ];

    const { container } = render(TaskHistory, { taskId: 't1' });
    await tick();
    expect(container.querySelectorAll('.rte')).toHaveLength(0);

    await fireEvent.click(screen.getByText('Show the previous description'));
    await waitFor(() => expect(container.querySelectorAll('.rte-bare')).toHaveLength(1));

    await fireEvent.click(screen.getByText('Show the previous description'));
    await waitFor(() => expect(container.querySelectorAll('.rte-bare')).toHaveLength(0));
  });

  it('turns the disclosure from state rather than from the browser default', async () => {
    taskActivity.entries = [
      entry('a1', 'description_changed', { old_value: { doc: previousDoc } }),
    ];

    const { container } = render(TaskHistory, { taskId: 't1' });
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByText('Show the previous description').dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    await waitFor(() => expect(details.open).toBe(true));
  });

  it('copies the previous description as markdown and confirms it without a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    taskActivity.entries = [
      entry('a1', 'description_changed', { old_value: { doc: previousDoc } }),
    ];

    render(TaskHistory, { taskId: 't1' });
    await fireEvent.click(screen.getByText('Show the previous description'));
    await fireEvent.click(await screen.findByRole('button', { name: 'Copy as Markdown' }));

    expect(writeText).toHaveBeenCalledWith('## what it said\n\n- a point');
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
    expect(toasts.toasts).toEqual([]);
  });

  // A toast raised from inside the task overlay renders under its backdrop.
  it('reports a refused clipboard inline', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    taskActivity.entries = [
      entry('a1', 'description_changed', { old_value: { doc: previousDoc } }),
    ];

    render(TaskHistory, { taskId: 't1' });
    await fireEvent.click(screen.getByText('Show the previous description'));
    await fireEvent.click(await screen.findByRole('button', { name: 'Copy as Markdown' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Could not copy to the clipboard')
    );
    expect(toasts.toasts).toEqual([]);
  });

  it('discloses a previous title only when the line above cut it, and copies it whole', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const long = `${'the road goes ever on '.repeat(30)}end`;
    taskActivity.entries = [
      entry('a1', 'title_changed', { old_value: { text: long }, new_value: { text: 'Short' } }),
      entry('a2', 'title_changed', { old_value: { text: 'Also short' }, new_value: { text: 'S' } }),
    ];

    render(TaskHistory, { taskId: 't1' });

    const disclosures = screen.getAllByText('Show the previous title in full');
    expect(disclosures).toHaveLength(1);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('…');

    await fireEvent.click(disclosures[0]!);
    expect(await screen.findByText(long)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(long);
  });

  it('forgets a copy once the disclosure has been closed again', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    taskActivity.entries = [
      entry('a1', 'description_changed', { old_value: { doc: previousDoc } }),
    ];

    render(TaskHistory, { taskId: 't1' });
    await fireEvent.click(screen.getByText('Show the previous description'));
    await fireEvent.click(await screen.findByRole('button', { name: 'Copy as Markdown' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');

    await fireEvent.click(screen.getByText('Show the previous description'));
    await fireEvent.click(screen.getByText('Show the previous description'));

    expect((await screen.findByRole('status')).textContent?.trim()).toBe('');
  });

  // The overlay around this list is itself the scroll container, so an unbounded
  // body would push the rest of the history off screen.
  it('bounds the expanded body and keeps its scrolling to itself', async () => {
    taskActivity.entries = [
      entry('a1', 'description_changed', { old_value: { doc: previousDoc } }),
    ];

    const { container } = render(TaskHistory, { taskId: 't1' });
    await fireEvent.click(screen.getByText('Show the previous description'));

    await waitFor(() => expect(container.querySelector('.rte-bare')).not.toBeNull());
    const box = container.querySelector('.rte-bare')!.parentElement!;
    expect(box.classList).toContain('overflow-y-auto');
    expect(box.classList).toContain('overscroll-contain');
    // The exact bound, not any `max-h-*`: `max-h-none` and `max-h-fit` are the
    // two ways to remove it and both carry the prefix.
    expect(box.classList).toContain('max-h-64');
  });

  it('offers no expansion for a change the line already shows whole', () => {
    taskActivity.entries = [
      entry('a1', 'column_changed', {
        old_value: { id: 'c1', name: 'Backlog' },
        new_value: { id: 'c2', name: 'Doing' },
      }),
      entry('a2', 'label_removed', { old_value: { id: 'l1', name: 'bug' } }),
      entry('a3', 'assignee_removed', { old_value: { id: 'u1', name: 'Ada Lovelace' } }),
      entry('a4', 'blocker_removed', { old_value: { id: 't9', name: 'Ship the API' } }),
      entry('a5', 'due_date_changed', { old_value: { text: '2026-08-03' } }),
    ];

    const { container } = render(TaskHistory, { taskId: 't1' });

    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
      'moved this from Backlog to Doing'
    );
    expect(container.querySelectorAll('details')).toHaveLength(0);
  });

  // The state every brand-new card is in, and the only one where the log has
  // nothing to draw and nothing to apologise for.
  it('says a card with no history has none, and draws no list', () => {
    taskActivity.entries = [];
    taskActivity.error = false;
    taskActivity.loading = false;

    render(TaskHistory, { taskId: 't1' });

    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reports a failed log load inline rather than as a toast, without calling it empty', () => {
    taskActivity.error = true;

    render(TaskHistory, { taskId: 't1' });

    expect(screen.getByText('The history of this task could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No activity yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(toasts.toasts).toEqual([]);
  });

  it('keeps a loaded log on screen behind a failed refresh', () => {
    taskActivity.error = true;
    taskActivity.entries = [entry('a1', 'archived')];

    render(TaskHistory, { taskId: 't1' });

    expect(screen.getByText('The history of this task could not be loaded.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('archived this task');
  });

  it('names an actor the users store cannot resolve', () => {
    taskActivity.entries = [entry('a1', 'archived', { actor_user_id: 'departed' })];

    render(TaskHistory, { taskId: 't1' });

    const item = screen.getAllByRole('listitem')[0];
    expect(item).toHaveTextContent('Unknown user');
    expect(item).toHaveTextContent('archived this task');
  });
});
