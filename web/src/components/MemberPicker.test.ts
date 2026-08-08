import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import MemberPicker from './MemberPicker.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { session } from '../lib/session.svelte';
import { users, type User } from '../lib/users.svelte';

const DEBOUNCE_MS = 250;

const me = {
  id: 'u-me',
  email: 'me@example.com',
  name: 'Me',
  avatar_url: null,
  email_verified: false,
};
const ada = { id: 'u-ada', name: 'Ada Lovelace', avatar_url: null };
const bob = { id: 'u-bob', name: 'Bob Ross', avatar_url: null };
const cleo = { id: 'u-cleo', name: 'Cleo Zhang', avatar_url: null };
const alexOne = { id: '3f2a1b4c-1111-4aaa-8bbb-000000000001', name: 'Alex Kim', avatar_url: null };
const alexTwo = { id: '9c8d7e6f-2222-4ccc-8ddd-000000000002', name: 'Alex Kim', avatar_url: null };

function project(overrides: Partial<Project> = {}): Project {
  const memberIds = overrides.member_ids ?? [];
  return {
    id: 'p-1',
    name: 'Team Game',
    description: '',
    archived_at: null,
    created_by: me.id,
    member_ids: memberIds,
    members: memberIds.map((user_id) => ({ user_id, role: 'editor' as const })),
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    sort_key: null,
    last_seen_at: null,
    has_unseen_changes: false,
    ...overrides,
  };
}

function field(): HTMLElement {
  return screen.getByLabelText('Add people');
}

function searchResponse(found: User[], truncated = false): Response {
  return jsonResponse(200, { users: found, truncated });
}

// Typing alone arms the debounce; the request only goes out once it elapses, so
// a test that wants the server's rows has to say so.
async function type(value: string): Promise<void> {
  await fireEvent.input(field(), { target: { value } });
}

async function typeAndSearch(value: string): Promise<void> {
  await type(value);
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => searchResponse([]));
  projects.reset();
  users.reset();
  session.user = me;
  users.users = [ada, bob, cleo, me];
  projects.projects = [project()];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MemberPicker', () => {
  it('suggests people you share boards with before anything is typed', () => {
    render(MemberPicker, { projectId: 'p-1' });

    expect(screen.getByRole('button', { name: 'Add Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Bob Ross' })).toBeInTheDocument();
    expect(field()).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('identifies each suggestion by name and avatar, never by address', () => {
    users.users = [{ ...ada, avatar_url: '/api/avatars/k' }, bob, cleo];
    const view = render(MemberPicker, { projectId: 'p-1' });

    expect(screen.getByRole('button', { name: 'Add Ada Lovelace' })).toBeInTheDocument();
    expect(view.container.querySelector('img[src="/api/avatars/k"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain('@');
  });

  it('tells same-named people apart by id and adds the one that was clicked', async () => {
    users.users = [alexOne, alexTwo, bob, me];
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(MemberPicker, { projectId: 'p-1' });

    expect(screen.getByRole('button', { name: 'Add Alex Kim 3f2a1b4c' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Alex Kim 9c8d7e6f' })).toBeInTheDocument();
    expect(screen.getByText('3f2a1b4c')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Bob Ross' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Add Alex Kim 9c8d7e6f' }));

    expect(projects.projects[0]!.member_ids).toEqual([alexTwo.id]);
  });

  it('excludes the owner, existing members, and yourself', () => {
    projects.projects = [project({ created_by: ada.id, member_ids: [me.id, bob.id] })];

    render(MemberPicker, { projectId: 'p-1' });

    expect(screen.getByRole('button', { name: 'Add Cleo Zhang' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Ada Lovelace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Bob Ross' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Me' })).toBeNull();
  });

  it('filters by name case-insensitively and never by address', async () => {
    render(MemberPicker, { projectId: 'p-1' });

    await fireEvent.input(field(), { target: { value: 'lovel' } });

    expect(screen.getByRole('button', { name: 'Add Ada Lovelace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Bob Ross' })).toBeNull();

    await fireEvent.input(field(), { target: { value: 'ROSS' } });

    expect(screen.getByRole('button', { name: 'Add Bob Ross' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Ada Lovelace' })).toBeNull();

    await fireEvent.input(field(), { target: { value: 'bob@example.com' } });

    expect(screen.queryByRole('button', { name: 'Add Bob Ross' })).toBeNull();
  });

  it('adds a clicked suggestion by id and clears the query', async () => {
    projects.projects = [project({ member_ids: [cleo.id] })];
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(MemberPicker, { projectId: 'p-1' });
    await fireEvent.input(field(), { target: { value: 'bob' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add Bob Ross' }));

    expect(projects.projects[0]!.member_ids).toEqual([cleo.id, bob.id]);
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Add Bob Ross' })).toBeNull();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const put = fetchMock.mock.calls.find((c) => (c[0] as Request).method === 'PUT')![0] as Request;
    expect(new URL(put.url).pathname).toBe('/api/projects/p-1/members');
    expect(await put.clone().json()).toEqual({ user_ids: [cleo.id, bob.id] });
  });

  it('adds the second suggestion with ArrowDown then Enter', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(MemberPicker, { projectId: 'p-1' });
    await fireEvent.keyDown(field(), { key: 'ArrowDown' });
    await fireEvent.keyDown(field(), { key: 'Enter' });

    expect(projects.projects[0]!.member_ids).toEqual([bob.id]);
  });

  it('moves focus with the highlight when arrowing from a suggestion row', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(MemberPicker, { projectId: 'p-1' });
    const row = screen.getByRole('button', { name: 'Add Ada Lovelace' });
    row.focus();

    await fireEvent.keyDown(row, { key: 'ArrowDown' });

    const next = screen.getByRole('button', { name: 'Add Bob Ross' });
    expect(next).toHaveFocus();

    await fireEvent.keyDown(next, { key: 'Enter' });

    expect(projects.projects[0]!.member_ids).toEqual([bob.id]);
  });

  it('sends the highlight back to the top when the query changes', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(MemberPicker, { projectId: 'p-1' });
    await fireEvent.keyDown(field(), { key: 'ArrowDown' });
    await fireEvent.keyDown(field(), { key: 'ArrowDown' });
    await fireEvent.input(field(), { target: { value: 'o' } });
    await fireEvent.keyDown(field(), { key: 'Enter' });

    expect(projects.projects[0]!.member_ids).toEqual([ada.id]);
  });

  it('does nothing on Enter when there is no row to activate', async () => {
    projects.projects = [project({ member_ids: [ada.id, bob.id, cleo.id] })];

    render(MemberPicker, { projectId: 'p-1' });
    await fireEvent.keyDown(field(), { key: 'Enter' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('grants access once when Enter is held down', async () => {
    render(MemberPicker, { projectId: 'p-1' });

    await fireEvent.keyDown(field(), { key: 'Enter' });
    await fireEvent.keyDown(field(), { key: 'Enter', repeat: true });
    await fireEvent.keyDown(field(), { key: 'Enter', repeat: true });

    const puts = fetchMock.mock.calls.filter((call) => (call[0] as Request).method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(projects.projects[0]!.member_ids).toEqual([ada.id]);
  });

  it('keeps an added person listed as done so the next row cannot shift under a click', async () => {
    render(MemberPicker, { projectId: 'p-1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Add Ada Lovelace' }));

    const row = await screen.findByRole('button', { name: 'Ada Lovelace added' });
    expect(row).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Bob Ross' })).toBeInTheDocument();
  });

  it('offers an invite row for any full email address', async () => {
    render(MemberPicker, { projectId: 'p-1' });

    await fireEvent.input(field(), { target: { value: 'ghost' } });
    expect(screen.queryByRole('button', { name: /^Invite/ })).toBeNull();

    await fireEvent.input(field(), { target: { value: 'ghost@' } });
    expect(screen.queryByRole('button', { name: /^Invite/ })).toBeNull();

    await fireEvent.input(field(), { target: { value: 'Ghost@example.com' } });
    expect(screen.getByRole('button', { name: 'Invite "ghost@example.com"' })).toBeInTheDocument();

    await fireEvent.input(field(), { target: { value: 'ada@example.com' } });
    expect(screen.getByRole('button', { name: 'Invite "ada@example.com"' })).toBeInTheDocument();
  });

  it('confirms an invitation was mailed when the address has no account', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        status: 'invited',
        role: 'editor',
        user: null,
        invitation: {
          id: 'inv-1',
          project_id: 'p-1',
          email: 'ghost@example.com',
          role: 'editor',
          invited_by: me.id,
          created_at: '2026-01-01T00:00:00.000Z',
          expires_at: '2026-01-15T00:00:00.000Z',
        },
      })
    );

    render(MemberPicker, { projectId: 'p-1' });
    await fireEvent.input(field(), { target: { value: 'ghost@example.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Invite "ghost@example.com"' }));

    expect(await screen.findByText('Invitation sent to ghost@example.com')).toBeInTheDocument();
    expect(projects.projects[0]!.member_ids).toEqual([]);
    expect(field()).toHaveValue('');
    const post = fetchMock.mock.calls.find(
      (c) => (c[0] as Request).method === 'POST'
    )![0] as Request;
    expect(new URL(post.url).pathname).toBe('/api/projects/p-1/members/by-email');
    expect(await post.clone().json()).toEqual({ email: 'ghost@example.com' });
  });

  it('surfaces a refusal inline and keeps what was typed', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(422, { error: 'This project has too many pending invitations' })
    );

    render(MemberPicker, { projectId: 'p-1' });
    await fireEvent.input(field(), { target: { value: 'ghost@example.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Invite "ghost@example.com"' }));

    expect(
      await screen.findByText('This project has too many pending invitations')
    ).toBeInTheDocument();
    expect(field()).toHaveValue('ghost@example.com');
  });

  it('names the account when the address turned out to have one', async () => {
    const pat = { id: 'u-pat', name: 'Pat', avatar_url: null };
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { status: 'member', role: 'editor', user: pat, invitation: null })
    );

    render(MemberPicker, { projectId: 'p-1' });
    await fireEvent.input(field(), { target: { value: 'pat@example.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Invite "pat@example.com"' }));

    await waitFor(() => expect(projects.projects[0]!.member_ids).toEqual([pat.id]));
    expect(screen.getByText('Pat is on this board.')).toBeInTheDocument();
    expect(screen.queryByText(/^Invitation sent to/)).toBeNull();
    expect(screen.queryByText(/They join the board once/)).toBeNull();
  });

  it('names the person when the typed address is already on the board', async () => {
    projects.projects = [project({ member_ids: [ada.id] })];
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { status: 'member', role: 'editor', user: ada, invitation: null })
    );

    render(MemberPicker, { projectId: 'p-1' });
    await fireEvent.input(field(), { target: { value: 'ada@example.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Invite "ada@example.com"' }));

    expect(await screen.findByText('Ada Lovelace is on this board.')).toBeInTheDocument();
    expect(projects.projects[0]!.member_ids).toEqual([ada.id]);
  });

  it('renders a distinct empty state for each reason the list is empty', async () => {
    projects.projects = [project({ member_ids: [ada.id, bob.id, cleo.id] })];
    const exhausted = render(MemberPicker, { projectId: 'p-1' });

    expect(screen.getByText(/Type a name to find someone/)).toBeVisible();

    // Below the server's minimum, so nothing has been asked yet and the empty
    // list must not claim there is nobody.
    await typeAndSearch('n');
    expect(screen.getByText(/Keep typing to search everyone/)).toBeVisible();

    await typeAndSearch('nobody');
    expect(screen.getByText(/No one matches “nobody”/)).toBeVisible();

    exhausted.unmount();
    users.users = [me];
    projects.projects = [project()];
    render(MemberPicker, { projectId: 'p-1' });

    expect(screen.getByText(/You haven't shared a board with anyone yet/)).toBeVisible();
  });
});

describe('MemberPicker global search', () => {
  const stranger = { id: 'u-sky', name: 'Skyler Berg', avatar_url: null };

  it('debounces a run of keystrokes into one request', async () => {
    render(MemberPicker, { projectId: 'p-1' });

    await type('sk');
    await type('sky');
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(new URL(request.url).pathname).toBe('/api/users/search');
    expect(new URL(request.url).searchParams.get('q')).toBe('sky');
  });

  // The server refuses a single character, so asking is a guaranteed 400.
  it('asks nothing for a query below the server minimum', async () => {
    render(MemberPicker, { projectId: 'p-1' });

    await typeAndSearch('s');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists strangers under their own heading, apart from people you work with', async () => {
    fetchMock.mockImplementation(async () => searchResponse([stranger]));
    render(MemberPicker, { projectId: 'p-1' });

    await typeAndSearch('lovel');

    expect(screen.getByText('People you work with')).toBeVisible();
    expect(screen.getByText('Everyone else')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Skyler Berg' })).toBeInTheDocument();
  });

  it('adds a stranger and records their name in the directory', async () => {
    fetchMock.mockImplementation(async (input) =>
      (input as Request).method === 'PUT' ? jsonResponse(204) : searchResponse([stranger])
    );
    render(MemberPicker, { projectId: 'p-1' });

    await typeAndSearch('sky');
    await fireEvent.click(screen.getByRole('button', { name: 'Add Skyler Berg' }));

    expect(projects.projects[0]!.member_ids).toEqual([stranger.id]);
    // Without this the member list renders them as a raw UUID.
    expect(users.byId(stranger.id)?.name).toBe('Skyler Berg');
  });

  it('keeps an added stranger listed where they were, rather than moving groups', async () => {
    fetchMock.mockImplementation(async (input) =>
      (input as Request).method === 'PUT' ? jsonResponse(204) : searchResponse([stranger])
    );
    render(MemberPicker, { projectId: 'p-1' });

    await typeAndSearch('sky');
    await fireEvent.click(screen.getByRole('button', { name: 'Add Skyler Berg' }));
    await tick();

    const done = screen.getByRole('button', { name: 'Skyler Berg added' });
    expect(done).toBeDisabled();
    // Adding them puts them in the directory, which would otherwise promote the
    // row out from under the pointer into the group above.
    const strangerHeading = screen.getByText('Everyone else');
    expect(strangerHeading.compareDocumentPosition(done)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('marks same-named people apart even when one is a stranger', async () => {
    users.users = [alexOne, me];
    fetchMock.mockImplementation(async () =>
      searchResponse([{ id: alexTwo.id, name: 'Alex Kim', avatar_url: null }])
    );
    render(MemberPicker, { projectId: 'p-1' });

    await typeAndSearch('alex');

    expect(screen.getByRole('button', { name: 'Add Alex Kim 3f2a1b4c' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Alex Kim 9c8d7e6f' })).toBeInTheDocument();
  });

  it('drops a stale response that lands after a newer one', async () => {
    let releaseSlow: (() => void) | null = null;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    fetchMock.mockImplementationOnce(async () => {
      await slow;
      return searchResponse([{ id: 'u-stale', name: 'Stale Person', avatar_url: null }]);
    });
    fetchMock.mockImplementation(async () => searchResponse([stranger]));

    render(MemberPicker, { projectId: 'p-1' });

    await typeAndSearch('sk');
    await typeAndSearch('skyler');

    releaseSlow!();
    await vi.advanceTimersByTimeAsync(0);
    await tick();

    expect(screen.getByRole('button', { name: 'Add Skyler Berg' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Stale Person' })).toBeNull();
  });

  it('keeps the people you work with when the search itself fails', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));
    render(MemberPicker, { projectId: 'p-1' });

    await typeAndSearch('lovel');

    expect(screen.getByRole('button', { name: 'Add Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText(/Could not search everyone/)).toBeVisible();
  });

  it('says it is searching from the keystroke, not from the request', async () => {
    render(MemberPicker, { projectId: 'p-1' });

    await type('sky');

    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
  });

  it('walks from the local group into the stranger group with ArrowDown', async () => {
    users.users = [ada, me];
    fetchMock.mockImplementation(async (input) =>
      (input as Request).method === 'PUT' ? jsonResponse(204) : searchResponse([stranger])
    );
    render(MemberPicker, { projectId: 'p-1' });

    // Matches Ada locally and is long enough for the server to be asked, so the
    // list spans both groups.
    await typeAndSearch('lo');
    expect(screen.getByRole('button', { name: 'Add Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Skyler Berg' })).toBeInTheDocument();

    await fireEvent.keyDown(field(), { key: 'ArrowDown' });
    await fireEvent.keyDown(field(), { key: 'Enter' });

    expect(projects.projects[0]!.member_ids).toEqual([stranger.id]);
  });

  // A response landing while the user is arrowing must not re-aim Enter: the
  // row it lands on grants that person access to the board.
  it('adds the highlighted person even when results arrive before Enter', async () => {
    users.users = [ada, me];
    fetchMock.mockImplementation(async (input) =>
      (input as Request).method === 'PUT' ? jsonResponse(204) : searchResponse([])
    );
    render(MemberPicker, { projectId: 'p-1' });

    await typeAndSearch('lovel');
    await fireEvent.keyDown(field(), { key: 'ArrowDown' });

    // Ada is now highlighted. A late response inserts a stranger above nobody,
    // but the rows either side of her shift.
    fetchMock.mockImplementation(async (input) =>
      (input as Request).method === 'PUT'
        ? jsonResponse(204)
        : searchResponse([{ id: 'u-late', name: 'Aaa Late', avatar_url: null }])
    );
    await typeAndSearch('lovel');

    await fireEvent.keyDown(field(), { key: 'Enter' });

    expect(projects.projects[0]!.member_ids).toEqual([ada.id]);
  });

  it('sends no request once it is unmounted mid-flight', async () => {
    const view = render(MemberPicker, { projectId: 'p-1' });

    await type('sky');
    view.unmount();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
