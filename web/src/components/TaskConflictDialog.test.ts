import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import TaskConflictDialog from './TaskConflictDialog.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';
import type { TaskVersion } from '../lib/conflictDrafts.svelte';
import { taskActivity, type TaskActivityEntry } from '../lib/taskActivity.svelte';
import { testUuid } from '../lib/test-ids';
import { users } from '../lib/users.svelte';

const PROJECT_ID = testUuid('p1');
const T1 = testUuid('t1');
const THEIR_UPDATED_AT = '2026-05-05T00:00:00.000Z';

function paragraph(text: string): NonNullable<BoardTask['description']> {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

const BASE: TaskVersion = { title: 'Design cards', description: paragraph('Loaded text') };

function storedTask(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: T1,
    column_id: 'c1',
    title: 'Their title',
    description: paragraph('Stored text'),
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: THEIR_UPDATED_AT,
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
    ...overrides,
  };
}

function activity(overrides: Partial<TaskActivityEntry> = {}): TaskActivityEntry {
  return {
    id: 'ac1',
    kind: 'description_changed',
    actor_user_id: 'u2',
    old_value: null,
    new_value: null,
    created_at: THEIR_UPDATED_AT,
    ...overrides,
  };
}

type Resolve = (resolution: TaskVersion, expectedUpdatedAt: string) => Promise<'ok' | 'conflict'>;

// The dialog loads the log itself, so seeding the store directly would only be
// wiped by that fetch.
let logged: TaskActivityEntry[] = [];

function mount(
  mine: TaskVersion,
  onresolve: Resolve,
  base: TaskVersion = BASE
): ReturnType<typeof render> {
  return render(TaskConflictDialog, {
    taskId: T1,
    mine,
    base,
    onresolve,
    onclose: () => {},
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  fetchMock.mockReset();
  logged = [activity()];
  fetchMock.mockImplementation(async () => jsonResponse(200, { activity: logged }));
  board.reset();
  taskActivity.reset();
  users.reset();
  board.currentProjectId = PROJECT_ID;
  board.tasks = [storedTask()];
  users.users = [{ id: 'u2', name: 'Grace Hopper', avatar_url: null }];
});

describe('TaskConflictDialog', () => {
  it('shows both versions side by side with who stored theirs', async () => {
    mount({ title: 'Design cards', description: paragraph('My text') }, async () => 'ok');

    expect(await screen.findByText(/Grace Hopper edited this task/)).toBeInTheDocument();
    expect(screen.getByText('Your description')).toBeInTheDocument();
    expect(screen.getByText('Their description')).toBeInTheDocument();
    expect(screen.getByText('Stored text')).toBeInTheDocument();
    expect(screen.getByText('My text')).toBeInTheDocument();
  });

  it('names nobody when no logged change carries the stored version’s timestamp', async () => {
    logged = [activity({ created_at: '2026-04-04T00:00:00.000Z' })];
    mount({ title: 'Design cards', description: paragraph('My text') }, async () => 'ok');

    expect(await screen.findByText(/This task was last edited/)).toBeInTheDocument();
    expect(screen.queryByText(/Grace Hopper/)).toBeNull();
  });

  it('leaves out the field only one side changed', async () => {
    // The title is theirs alone; nobody has to choose about it.
    mount({ title: 'Design cards', description: paragraph('My text') }, async () => 'ok');

    expect(screen.queryByText('Your title')).toBeNull();
    expect(screen.getByText('Your description')).toBeInTheDocument();
  });

  it('carries the untouched field through when keeping mine', async () => {
    const onresolve = vi.fn<Resolve>(async () => 'ok');
    mount({ title: 'My title', description: BASE.description }, onresolve);

    await fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

    expect(onresolve).toHaveBeenCalledWith(
      { title: 'My title', description: storedTask().description },
      THEIR_UPDATED_AT
    );
  });

  it('resolves both fields at once when both are stored versions', async () => {
    const onresolve = vi.fn<Resolve>(async () => 'ok');
    mount({ title: 'My title', description: paragraph('My text') }, onresolve);

    await fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

    expect(onresolve).toHaveBeenCalledWith(
      { title: 'My title', description: paragraph('My text') },
      THEIR_UPDATED_AT
    );
  });

  it('needs a second click before it will discard the user’s version', async () => {
    const onresolve = vi.fn<Resolve>(async () => 'ok');
    mount({ title: 'My title', description: paragraph('My text') }, onresolve);

    await fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }));
    expect(onresolve).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Discard my version' }));

    expect(onresolve).toHaveBeenCalledWith(
      { title: 'Their title', description: storedTask().description },
      THEIR_UPDATED_AT
    );
  });

  it('offers one button and no choice when the two edits do not overlap', async () => {
    // They renamed, the user only rewrote the description.
    mount({ title: BASE.title, description: paragraph('My text') }, async () => 'ok', {
      title: BASE.title,
      description: storedTask().description,
    });

    expect(await screen.findByText(/do not overlap/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep theirs' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep both changes' })).toBeInTheDocument();
  });

  it('merges from the user’s own text and can append theirs to it', async () => {
    const onresolve = vi.fn<Resolve>(async () => 'ok');
    const { component } = mount(
      { title: 'Design cards', description: paragraph('My text') },
      onresolve
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Merge manually…' }));
    await waitFor(() => expect(component.getMergeEditor()).not.toBeNull());
    expect(component.getMergeEditor()?.getText()).toBe('My text');

    await fireEvent.click(screen.getByRole('button', { name: 'Append their version' }));
    expect(component.getMergeEditor()?.getText()).toContain('My text');
    expect(component.getMergeEditor()?.getText()).toContain('Stored text');

    await fireEvent.click(screen.getByRole('button', { name: 'Save merged version' }));

    const merged = onresolve.mock.calls[0]![0];
    expect(JSON.stringify(merged.description)).toContain('My text');
    expect(JSON.stringify(merged.description)).toContain('Stored text');
  });

  it('re-presents the newer stored version instead of retrying the same write', async () => {
    const onresolve = vi.fn<Resolve>(async () => 'conflict');
    mount({ title: 'My title', description: paragraph('My text') }, onresolve);

    board.tasks = [
      storedTask({
        title: 'Newer title',
        description: paragraph('Newest text'),
        updated_at: '2026-06-06T00:00:00.000Z',
      }),
    ];
    await fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

    expect(await screen.findByText(/changed again while you were reviewing/)).toBeInTheDocument();
    expect(onresolve).toHaveBeenCalledTimes(1);
    // The user's own text survived the round trip, and the newer title is what
    // the next choice is now against.
    expect(await screen.findByText('My text')).toBeInTheDocument();
    expect(screen.getByText('Newest text')).toBeInTheDocument();
    expect(screen.getByText('Newer title')).toBeInTheDocument();
    expect(screen.getByText('My title')).toBeInTheDocument();
  });
});
