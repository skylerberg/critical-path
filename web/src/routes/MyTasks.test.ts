import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import MyTasks from './MyTasks.svelte';
import { cardCursor } from '../lib/card-cursor.svelte';
import { myTasks, type MyTask, type MyTaskPersonGroup } from '../lib/myTasks.svelte';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import { taskHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
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

const PROJECT_ID = testUuid('p-1');

function task(key: string, bucket: MyTask['bucket'], overrides: Partial<MyTask> = {}): MyTask {
  return {
    id: testUuid(key),
    project_id: PROJECT_ID,
    project_name: 'Colori',
    column_name: 'In Progress',
    title: `Task ${key}`,
    assignee_ids: [me.id],
    bucket,
    waiting_user_ids: [],
    blocking: [],
    blocked_by: [],
    hidden_blocked_by_count: 0,
    hidden_blocking_count: 0,
    ...overrides,
  };
}

function link(key: string, title: string): MyTaskPersonGroup['tasks'][number] {
  return { id: testUuid(key), project_id: PROJECT_ID, title, assignee_ids: [] };
}

function mockResponse(overrides: {
  tasks?: MyTask[];
  waiting_on_you?: MyTaskPersonGroup[];
  you_are_waiting_on?: MyTaskPersonGroup[];
  next_offset?: number | null;
}): void {
  fetchMock.mockImplementation(async () =>
    jsonResponse(200, {
      tasks: overrides.tasks ?? [],
      waiting_on_you: overrides.waiting_on_you ?? [],
      you_are_waiting_on: overrides.you_are_waiting_on ?? [],
      next_offset: overrides.next_offset ?? null,
    })
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  cardCursor.reset();
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
    expect(anchor).toHaveAttribute(
      'href',
      `${taskHref(testUuid('t-1'), 'Ship the export API')}?from=my-tasks`
    );
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
          blocking: [
            {
              id: testUuid('t-9'),
              project_id: PROJECT_ID,
              title: 'Importer',
              assignee_ids: [ada.id],
            },
          ],
          blocked_by: [
            { id: testUuid('t-8'), project_id: PROJECT_ID, title: 'Format', assignee_ids: [] },
          ],
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

  // The server files a row as blocked on the blockers it can name plus the ones
  // it cannot, so a row can be blocked with an empty blocked_by. Counting only
  // the named ones leaves it looking exactly like a ready card.
  it('counts the blockers it cannot name into the badge', async () => {
    mockResponse({
      tasks: [
        task('t-1', 'blocked', { blocked_by: [], hidden_blocked_by_count: 2 }),
        task('t-2', 'blocked', {
          blocked_by: [
            { id: testUuid('t-8'), project_id: PROJECT_ID, title: 'Format', assignee_ids: [] },
          ],
          hidden_blocked_by_count: 3,
        }),
      ],
    });

    render(MyTasks);

    expect(await screen.findByText('Blocked by 2')).toBeInTheDocument();
    expect(screen.getByText('Blocked by 4')).toBeInTheDocument();
  });

  it('names a person the caller can no longer see rather than showing a blank', async () => {
    mockResponse({
      tasks: [task('t-1', 'ready', { waiting_user_ids: ['u-gone'] })],
      you_are_waiting_on: [
        {
          user_id: 'u-gone',
          tasks: [
            {
              id: testUuid('t-8'),
              project_id: PROJECT_ID,
              title: 'Decide the format',
              assignee_ids: [],
            },
          ],
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
            {
              id: testUuid('t-9'),
              project_id: PROJECT_ID,
              title: 'Wire up the importer',
              assignee_ids: [],
            },
          ],
        },
      ],
      you_are_waiting_on: [
        {
          user_id: ada.id,
          tasks: [
            {
              id: testUuid('t-7'),
              project_id: PROJECT_ID,
              title: 'Pick a palette',
              assignee_ids: [],
            },
          ],
        },
        {
          user_id: null,
          tasks: [
            {
              id: testUuid('t-8'),
              project_id: PROJECT_ID,
              title: 'Decide the format',
              assignee_ids: [],
            },
          ],
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
      `${taskHref(testUuid('t-8'), 'Decide the format')}?from=my-tasks`
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

describe('MyTasks card cursor', () => {
  // t-1 is on screen twice: it is the caller's own card and it is also what Ada
  // is waiting on. The cursor walks ids, and `indexOf` on a repeated one sends
  // the third press back to the first copy — leaving the last row unreachable.
  it('publishes its rows in screen order so j and k walk the page', async () => {
    mockResponse({
      tasks: [task('t-1', 'blocking'), task('t-2', 'ready')],
      waiting_on_you: [
        { user_id: ada.id, tasks: [link('t-1', 'Their copy'), link('t-3', 'Their card')] },
      ],
    });

    render(MyTasks);
    await screen.findByText('Task t-1');

    cardCursor.move('down');
    expect(cardCursor.taskId).toBe(testUuid('t-1'));
    cardCursor.move('down');
    expect(cardCursor.taskId).toBe(testUuid('t-2'));
    cardCursor.move('down');
    expect(cardCursor.taskId).toBe(testUuid('t-3'));
  });

  it('rings the row the cursor is on', async () => {
    mockResponse({ tasks: [task('t-1', 'ready', { title: 'Ship the export API' })] });

    render(MyTasks);
    const anchor = await screen.findByRole('link', { name: 'Ship the export API' });
    const row = anchor.closest('article')!;
    expect(row.className).not.toContain('ring-2');

    cardCursor.set(testUuid('t-1'));

    await waitFor(() => {
      expect(row.className).toContain('ring-2');
    });
  });

  it('moves the cursor onto the row under the pointer', async () => {
    mockResponse({ tasks: [task('t-1', 'ready', { title: 'Ship the export API' })] });

    render(MyTasks);
    const anchor = await screen.findByRole('link', { name: 'Ship the export API' });

    await fireEvent.pointerEnter(anchor.closest('article')!);

    expect(cardCursor.taskId).toBe(testUuid('t-1'));
  });

  it('drops the cursor when the screen goes away', async () => {
    mockResponse({ tasks: [task('t-1', 'ready')] });

    const view = render(MyTasks);
    await screen.findByText('Task t-1');
    cardCursor.set(testUuid('t-1'));

    view.unmount();

    expect(cardCursor.taskId).toBeNull();
  });

  describe('paging', () => {
    // The point of the page size: almost nobody should ever see this control.
    it('says nothing about paging for a caller inside one page', async () => {
      mockResponse({ tasks: [task('t-1', 'ready')] });

      render(MyTasks);
      await screen.findByText('Task t-1');

      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
      expect(screen.queryByText(/Showing/)).toBeNull();
    });

    it('offers the rest to a caller past the page, and appends on click', async () => {
      mockResponse({ tasks: [task('t-1', 'ready')], next_offset: 1000 });

      render(MyTasks);
      await screen.findByText('Task t-1');
      expect(screen.getByText('Showing 1 of your tasks.')).toBeTruthy();

      mockResponse({ tasks: [task('t-2', 'ready')], next_offset: null });
      await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

      await screen.findByText('Task t-2');
      // The button goes once the last page is in, rather than being left as a
      // dead control; the line stays so the live region can announce the total.
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
      });
      expect(screen.getByText('All 2 of your tasks are shown.')).toBeTruthy();
    });

    // The line is sticky so the live region survives the final page, which makes
    // clearing it on the next load the only thing that stops it being read out
    // to somebody comfortably inside one page on a later visit.
    it('says nothing about paging again once a later load fits in one page', async () => {
      mockResponse({ tasks: [task('t-1', 'ready')], next_offset: 1000 });

      render(MyTasks);
      await screen.findByText('Task t-1');

      mockResponse({ tasks: [task('t-2', 'ready')], next_offset: null });
      await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      await screen.findByText('All 2 of your tasks are shown.');

      mockResponse({ tasks: [task('t-1', 'ready')], next_offset: null });
      await myTasks.load();

      await waitFor(() => {
        expect(screen.queryByText(/of your tasks/)).toBeNull();
      });
    });

    // The count is what a screen reader hears change, so it has to be live and
    // it has to be the running total rather than the size of the last page.
    it('announces the new total after loading more', async () => {
      mockResponse({ tasks: [task('t-1', 'ready')], next_offset: 1000 });

      render(MyTasks);
      const count = await screen.findByText('Showing 1 of your tasks.');
      expect(count.getAttribute('aria-live')).toBe('polite');

      mockResponse({ tasks: [task('t-2', 'ready')], next_offset: 2000 });
      await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

      await screen.findByText('Showing 2 of your tasks.');
    });
  });
});
