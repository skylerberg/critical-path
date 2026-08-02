import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import MyTasks from './MyTasks.svelte';
import { myTasks, type MyTask, type MyTaskPersonGroup } from '../lib/myTasks.svelte';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import { TASK_TITLE_MAX_LENGTH, truncateTitle } from '../lib/titles';
import { users } from '../lib/users.svelte';

const me = {
  id: 'u-me',
  email: 'me@example.com',
  name: 'Me',
  avatar_url: null,
  email_verified: false,
};
const ada = { id: 'u-ada', email: 'ada@example.com', name: 'Ada Lovelace', avatar_url: null };

function task(id: string, bucket: MyTask['bucket'], overrides: Partial<MyTask> = {}): MyTask {
  return {
    id,
    project_id: 'p-1',
    project_name: 'Colori',
    column_name: 'In Progress',
    title: `Task ${id}`,
    assignee_ids: [me.id],
    bucket,
    waiting_user_ids: [],
    blocking: [],
    blocked_by: [],
    ...overrides,
  };
}

function mockResponse(overrides: {
  tasks?: MyTask[];
  waiting_on_you?: MyTaskPersonGroup[];
  you_are_waiting_on?: MyTaskPersonGroup[];
}): void {
  fetchMock.mockImplementation(async () =>
    jsonResponse(200, {
      tasks: overrides.tasks ?? [],
      waiting_on_you: overrides.waiting_on_you ?? [],
      you_are_waiting_on: overrides.you_are_waiting_on ?? [],
    })
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  myTasks.reset();
  users.reset();
  session.user = me;
  session.status = 'authed';
  router.beforeNavigate = undefined;
  router.navigate('/my-tasks', { replace: true });
});

describe('MyTasks', () => {
  it('renders only the buckets that have tasks', async () => {
    mockResponse({ tasks: [task('t-1', 'blocking'), task('t-2', 'ready')] });

    render(MyTasks);

    expect(await screen.findByRole('heading', { name: 'Blocking others' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ready' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Blocked' })).toBeNull();
  });

  it('links a row into the project overlay with the return path and names its board', async () => {
    mockResponse({ tasks: [task('t-1', 'ready', { title: 'Ship the export API' })] });

    render(MyTasks);

    const anchor = await screen.findByRole('link', { name: 'Ship the export API' });
    expect(anchor).toHaveAttribute('href', '/projects/p-1/tasks/t-1?from=my-tasks');
    expect(screen.getByText('Colori')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    // Nobody else is on this task, so the row has no hidden name to hang a tooltip on.
    expect(anchor).not.toHaveAttribute('title');
  });

  it('clips a long row title', async () => {
    const long = 'M'.repeat(TASK_TITLE_MAX_LENGTH);
    mockResponse({ tasks: [task('t-1', 'ready', { title: long })] });

    render(MyTasks);

    expect(await screen.findByRole('link', { name: truncateTitle(long) })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: long })).toBeNull();
  });

  it('keeps the waiting chip on a blocked task and hides the caller from the avatars', async () => {
    users.users = [me, ada];
    mockResponse({
      tasks: [
        task('t-1', 'blocked', {
          assignee_ids: [me.id, ada.id],
          waiting_user_ids: [ada.id],
          blocking: [{ id: 't-9', project_id: 'p-1', title: 'Importer', assignee_ids: [ada.id] }],
          blocked_by: [{ id: 't-8', project_id: 'p-1', title: 'Format', assignee_ids: [] }],
        }),
      ],
    });

    render(MyTasks);

    expect(await screen.findByText('1 waiting')).toBeInTheDocument();
    expect(screen.getByText('Blocked by 1')).toBeInTheDocument();
    // One avatar as the waiting person, one as the co-assignee; never the caller.
    expect(screen.getAllByTitle('Ada Lovelace')).toHaveLength(2);
    expect(screen.queryByTitle('Me')).toBeNull();
    // Those avatars sit under the stretched link, so their own titles are unhoverable:
    // the names have to reach the pointer through the anchor's composed title.
    expect(screen.getByRole('link', { name: 'Task t-1' })).toHaveAttribute(
      'title',
      'Task t-1\nWaiting on this: Ada Lovelace\nAlso assigned: Ada Lovelace'
    );
  });

  it('names a person the caller can no longer see rather than showing a blank', async () => {
    mockResponse({
      tasks: [task('t-1', 'ready', { waiting_user_ids: ['u-gone'] })],
      you_are_waiting_on: [
        {
          user_id: 'u-gone',
          tasks: [{ id: 't-8', project_id: 'p-1', title: 'Decide the format', assignee_ids: [] }],
        },
      ],
    });

    render(MyTasks);

    expect(await screen.findByText('Unknown user')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Task t-1' })).toHaveAttribute(
      'title',
      'Task t-1\nWaiting on this: Unknown user'
    );
  });

  it('names the people in both companion sections and lists Unassigned last', async () => {
    users.users = [me, ada];
    mockResponse({
      tasks: [task('t-1', 'ready')],
      waiting_on_you: [
        {
          user_id: ada.id,
          tasks: [
            { id: 't-9', project_id: 'p-1', title: 'Wire up the importer', assignee_ids: [] },
          ],
        },
      ],
      you_are_waiting_on: [
        {
          user_id: ada.id,
          tasks: [{ id: 't-7', project_id: 'p-1', title: 'Pick a palette', assignee_ids: [] }],
        },
        {
          user_id: null,
          tasks: [{ id: 't-8', project_id: 'p-1', title: 'Decide the format', assignee_ids: [] }],
        },
      ],
    });

    render(MyTasks);

    expect(await screen.findByRole('heading', { name: 'Waiting on you' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'You are waiting on' })).toBeInTheDocument();
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(2);

    const waitingOn = screen.getByRole('heading', { name: 'You are waiting on' }).parentElement!;
    const names = [...waitingOn.querySelectorAll('.font-medium')].map((el) => el.textContent);
    expect(names).toEqual(['Ada Lovelace', 'Unassigned']);

    expect(screen.getByRole('link', { name: 'Decide the format' })).toHaveAttribute(
      'href',
      '/projects/p-1/tasks/t-8?from=my-tasks'
    );
  });

  it('shows the empty state and no bucket headings when nothing is assigned', async () => {
    mockResponse({});

    render(MyTasks);

    expect(await screen.findByText('Nothing is assigned to you right now.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ready' })).toBeNull();
  });

  it('flags a failed refetch over the rows it could not replace', async () => {
    mockResponse({ tasks: [task('t-1', 'ready', { title: 'Write the docs' })] });

    render(MyTasks);
    await screen.findByText('Write the docs');

    fetchMock.mockImplementation(async () => jsonResponse(503, { error: 'Server exploded' }));
    await myTasks.load();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Server exploded');
    expect(screen.getByText('Write the docs')).toBeInTheDocument();

    mockResponse({ tasks: [task('t-1', 'ready', { title: 'Write the docs' })] });
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('offers a working retry after a failed load', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Server exploded' }));

    render(MyTasks);

    expect(await screen.findByText('Server exploded')).toBeInTheDocument();

    mockResponse({ tasks: [task('t-1', 'ready', { title: 'Write the docs' })] });
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('Write the docs')).toBeInTheDocument());
    expect(screen.queryByText('Server exploded')).toBeNull();
  });
});
