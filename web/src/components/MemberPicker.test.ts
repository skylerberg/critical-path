import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import MemberPicker from './MemberPicker.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { session } from '../lib/session.svelte';
import { users } from '../lib/users.svelte';

const me = { id: 'u-me', email: 'me@example.com', name: 'Me', avatar_url: null };
const ada = { id: 'u-ada', email: 'ada@example.com', name: 'Ada Lovelace', avatar_url: null };
const bob = { id: 'u-bob', email: 'bob@example.com', name: 'Bob Ross', avatar_url: null };
const cleo = { id: 'u-cleo', email: 'cleo@example.com', name: 'Cleo Zhang', avatar_url: null };

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
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    position: null,
    ...overrides,
  };
}

function field(): HTMLElement {
  return screen.getByLabelText('Add people');
}

beforeEach(() => {
  fetchMock.mockReset();
  projects.reset();
  users.reset();
  session.user = me;
  users.users = [ada, bob, cleo, me];
  projects.projects = [project()];
});

describe('MemberPicker', () => {
  it('suggests people you share boards with before anything is typed', () => {
    render(MemberPicker, { projectId: 'p-1' });

    expect(screen.getByRole('button', { name: 'Add Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Bob Ross' })).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(field()).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('excludes the owner, existing members, and yourself', () => {
    projects.projects = [project({ created_by: ada.id, member_ids: [me.id, bob.id] })];

    render(MemberPicker, { projectId: 'p-1' });

    expect(screen.getByRole('button', { name: 'Add Cleo Zhang' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Ada Lovelace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Bob Ross' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Me' })).toBeNull();
  });

  it('filters by name and by email, case-insensitively', async () => {
    render(MemberPicker, { projectId: 'p-1' });

    await fireEvent.input(field(), { target: { value: 'lovel' } });

    expect(screen.getByRole('button', { name: 'Add Ada Lovelace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Bob Ross' })).toBeNull();

    await fireEvent.input(field(), { target: { value: 'BOB@' } });

    expect(screen.getByRole('button', { name: 'Add Bob Ross' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Ada Lovelace' })).toBeNull();
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
    await fireEvent.input(field(), { target: { value: 'example.com' } });
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

  it('offers an invite row only for a full email that matches nobody', async () => {
    render(MemberPicker, { projectId: 'p-1' });

    await fireEvent.input(field(), { target: { value: 'ghost' } });
    expect(screen.queryByRole('button', { name: /^Invite/ })).toBeNull();

    await fireEvent.input(field(), { target: { value: 'ghost@' } });
    expect(screen.queryByRole('button', { name: /^Invite/ })).toBeNull();

    await fireEvent.input(field(), { target: { value: 'ada@example.com' } });
    expect(screen.queryByRole('button', { name: /^Invite/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Ada Lovelace' })).toBeInTheDocument();

    await fireEvent.input(field(), { target: { value: 'Ghost@example.com' } });
    expect(screen.getByRole('button', { name: 'Invite "ghost@example.com"' })).toBeInTheDocument();
  });

  it('invites an unknown email and surfaces a 404 inline', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(404, { error: 'not found' }));

    render(MemberPicker, { projectId: 'p-1' });
    await fireEvent.input(field(), { target: { value: 'ghost@example.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Invite "ghost@example.com"' }));

    expect(await screen.findByText('No user with that email')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      (c) => (c[0] as Request).method === 'POST'
    )![0] as Request;
    expect(new URL(post.url).pathname).toBe('/api/projects/p-1/members/by-email');
    expect(await post.clone().json()).toEqual({ email: 'ghost@example.com' });
  });

  it('says so instead of inviting when the typed email is already on the board', async () => {
    projects.projects = [project({ member_ids: [ada.id] })];

    render(MemberPicker, { projectId: 'p-1' });
    await fireEvent.input(field(), { target: { value: 'ada@example.com' } });

    expect(screen.getByText('Ada Lovelace is already on this board.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Invite/ })).toBeNull();
  });

  it('renders a distinct empty state for each reason the list is empty', async () => {
    projects.projects = [project({ member_ids: [ada.id, bob.id, cleo.id] })];
    const exhausted = render(MemberPicker, { projectId: 'p-1' });

    expect(screen.getByText(/Everyone you've shared a board with is already here/)).toBeVisible();

    await fireEvent.input(field(), { target: { value: 'nobody' } });
    expect(screen.getByText(/No matching people/)).toBeVisible();

    exhausted.unmount();
    users.users = [me];
    projects.projects = [project()];
    render(MemberPicker, { projectId: 'p-1' });

    expect(screen.getByText(/You haven't shared a board with anyone yet/)).toBeVisible();
  });
});
