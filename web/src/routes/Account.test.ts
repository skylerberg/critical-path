import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import Account from './Account.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { realtime } from '../lib/realtime.svelte';
import { session } from '../lib/session.svelte';
import { users } from '../lib/users.svelte';

vi.mock('../lib/realtime.svelte', () => ({
  realtime: { connect: vi.fn(), disconnect: vi.fn() },
}));

// jsdom has no CacheStorage, so the deletion path's cache eviction would
// otherwise be a no-op no test could see.
const cacheDelete = vi.fn<(name: string) => Promise<boolean>>().mockResolvedValue(true);
vi.stubGlobal('caches', { delete: cacheDelete });

const user = { id: 'u-1', email: 'ada@example.com', name: 'Ada', avatar_url: null };

async function loginAs(): Promise<void> {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok', user }));
  await session.login(user.email, 'password123');
  fetchMock.mockClear();
}

async function bodyOf(request: Request): Promise<unknown> {
  return request.clone().json();
}

function mockRoutes(status: number, body?: unknown): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    if (new URL(request.url).pathname === '/api/auth/tokens') {
      return jsonResponse(200, { personal_access_tokens: [] });
    }
    return jsonResponse(status, body);
  });
}

function requestTo(pathname: string): Request {
  const call = fetchMock.mock.calls.find(
    (entry) => new URL((entry[0] as Request).url).pathname === pathname
  );
  if (!call) {
    throw new Error(`No fetch call to ${pathname}`);
  }
  return call[0] as Request;
}

function pathsRequested(): string[] {
  return fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
}

function callOrderOf(pathname: string): number {
  const index = fetchMock.mock.calls.findIndex(
    (call) => new URL((call[0] as Request).url).pathname === pathname
  );
  if (index === -1) {
    throw new Error(`No fetch call to ${pathname}`);
  }
  return fetchMock.mock.invocationCallOrder[index];
}

function deleteDialog(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Delete account' });
}

function seedProject(overrides: Partial<Project>): void {
  projects.projects = [
    {
      id: 'p-1',
      name: 'Shared Ledger',
      description: '',
      archived_at: null,
      created_by: user.id,
      member_ids: [],
      members: (overrides.member_ids ?? []).map((user_id) => ({
        user_id,
        role: 'editor' as const,
      })),
      is_public: false,
      created_at: '2026-01-01T00:00:00.000Z',
      open_task_count: 0,
      done_task_count: 0,
      position: null,
      ...overrides,
    },
  ];
}

beforeEach(async () => {
  fetchMock.mockReset();
  vi.mocked(realtime.connect).mockClear();
  vi.mocked(realtime.disconnect).mockClear();
  cacheDelete.mockClear();
  users.reset();
  projects.reset();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/account');
  await session.init();
  await loginAs();
});

describe('Account', () => {
  it('updates the name and reflects it in the session', async () => {
    mockRoutes(200, { ...user, name: 'Ada L' });
    render(Account);

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Ada L' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByText('Name updated')).toBeInTheDocument();
    const request = requestTo('/api/auth/me');
    expect(request.method).toBe('PATCH');
    expect(await bodyOf(request)).toEqual({ name: 'Ada L' });
    expect(session.user?.name).toBe('Ada L');
  });

  it('shows a taken message on a 409 email conflict', async () => {
    mockRoutes(409, { error: 'duplicate' });
    render(Account);

    await fireEvent.input(screen.getByLabelText('Email'), {
      target: { value: 'taken@example.com' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save email' }));

    expect(await screen.findByText('That email is taken')).toBeInTheDocument();
    expect(session.user?.email).toBe('ada@example.com');
  });

  it('changes the password, adopts the new session, and stays logged in', async () => {
    mockRoutes(200, { token: 'tok-2', user });
    render(Account);

    await fireEvent.input(screen.getByLabelText('Current password'), {
      target: { value: 'oldpass12' },
    });
    await fireEvent.input(screen.getByLabelText('New password'), {
      target: { value: 'newpass12' },
    });
    await fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'newpass12' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    const request = requestTo('/api/auth/change-password');
    expect(await bodyOf(request)).toEqual({
      current_password: 'oldpass12',
      new_password: 'newpass12',
    });
    expect(window.location.pathname).toBe('/account');
    expect(session.status).toBe('authed');
    expect(session.token).toBe('tok-2');
    expect(localStorage.getItem('cp.token')).toBe('tok-2');
    expect(screen.getByLabelText<HTMLInputElement>('Current password').value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>('New password').value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>('Confirm new password').value).toBe('');
    expect(vi.mocked(realtime.disconnect)).toHaveBeenCalledOnce();
    expect(vi.mocked(realtime.connect)).toHaveBeenCalledOnce();
    expect(vi.mocked(realtime.disconnect).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(realtime.connect).mock.invocationCallOrder[0]
    );
  });

  it('shows an error when the current password is wrong', async () => {
    mockRoutes(401, { error: 'nope' });
    render(Account);

    await fireEvent.input(screen.getByLabelText('Current password'), {
      target: { value: 'wrongpass' },
    });
    await fireEvent.input(screen.getByLabelText('New password'), {
      target: { value: 'newpass12' },
    });
    await fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'newpass12' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Incorrect current password')).toBeInTheDocument();
    expect(session.status).toBe('authed');
  });

  it('validates the new password locally before calling the API', async () => {
    mockRoutes(500);
    render(Account);

    await fireEvent.input(screen.getByLabelText('Current password'), {
      target: { value: 'oldpass12' },
    });
    await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'short' } });
    await fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'short' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText('New password must be at least 8 characters')
    ).toBeInTheDocument();
    expect(pathsRequested()).toEqual(['/api/auth/tokens']);
  });

  it('uploads a profile image and updates the session and users store', async () => {
    mockRoutes(200, { ...user, avatar_url: '/api/avatars/key-1' });
    // The mocked fetch never drains the request body, and undici cannot read
    // jsdom's FormData anyway, so the sent file is asserted via this spy.
    const appendSpy = vi.spyOn(FormData.prototype, 'append');
    render(Account);

    expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove image' })).not.toBeInTheDocument();

    const file = new File(['png-bytes'], 'me.png', { type: 'image/png' });
    await fireEvent.change(screen.getByLabelText('Profile image file'), {
      target: { files: [file] },
    });

    try {
      expect(await screen.findByText('Profile image updated')).toBeInTheDocument();
      const request = requestTo('/api/auth/me/avatar');
      expect(request.method).toBe('POST');
      expect(request.headers.get('Content-Type')).toContain('multipart/form-data');
      expect(appendSpy).toHaveBeenCalledExactlyOnceWith('file', file);
      expect(session.user?.avatar_url).toBe('/api/avatars/key-1');
      expect(users.byId('u-1')?.avatar_url).toBe('/api/avatars/key-1');
      expect(screen.getByTitle('Ada')).toHaveAttribute('src', '/api/avatars/key-1');
      expect(screen.getByRole('button', { name: 'Replace image' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove image' })).toBeInTheDocument();
    } finally {
      appendSpy.mockRestore();
    }
  });

  it('removes the profile image', async () => {
    session.user = { ...user, avatar_url: '/api/avatars/key-1' };
    mockRoutes(200, { ...user, avatar_url: null });
    render(Account);

    await fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));

    expect(await screen.findByText('Profile image removed')).toBeInTheDocument();
    const request = requestTo('/api/auth/me/avatar');
    expect(request.method).toBe('DELETE');
    expect(session.user?.avatar_url).toBeNull();
    expect(users.byId('u-1')?.avatar_url).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove image' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument();
  });

  it('shows a friendly error when the image is too large and keeps the avatar state', async () => {
    mockRoutes(413, { error: 'payload too large' });
    render(Account);

    const file = new File(['big'], 'big.png', { type: 'image/png' });
    await fireEvent.change(screen.getByLabelText('Profile image file'), {
      target: { files: [file] },
    });

    expect(await screen.findByText('That image is too large (max 10 MB)')).toBeInTheDocument();
    expect(session.user?.avatar_url).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument();
  });

  it('shows the feedback entry point', () => {
    mockRoutes(500);
    render(Account);

    expect(screen.getByRole('heading', { name: 'Feedback' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeInTheDocument();
  });

  it('shows the personal access token section and loads the list', async () => {
    mockRoutes(500);
    render(Account);

    expect(screen.getByRole('heading', { name: 'Personal access tokens' })).toBeInTheDocument();
    expect(await screen.findByText('You have no personal access tokens yet.')).toBeInTheDocument();
    expect(pathsRequested()).toContain('/api/auth/tokens');
  });

  it('opens the delete dialog without issuing a request', async () => {
    mockRoutes(500);
    render(Account);
    expect(deleteDialog()).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(deleteDialog()).not.toBeNull();
    expect(pathsRequested()).toEqual(['/api/auth/tokens']);
  });

  it('deletes the account, clears the session, and lands on the login page', async () => {
    mockRoutes(204);
    render(Account);

    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw12345678' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    await vi.waitFor(() => expect(window.location.pathname).toBe('/login'));
    const request = requestTo('/api/auth/me');
    expect(request.method).toBe('DELETE');
    expect(await bodyOf(request)).toEqual({ password: 'pw12345678' });
    expect(session.status).toBe('anon');
    expect(session.token).toBeNull();
    expect(localStorage.getItem('cp.token')).toBeNull();
    expect(cacheDelete.mock.calls.flat()).toEqual(['api-images', 'api-avatars']);
    expect(vi.mocked(realtime.disconnect)).toHaveBeenCalledOnce();
    expect(vi.mocked(realtime.connect)).not.toHaveBeenCalled();
    expect(vi.mocked(realtime.disconnect).mock.invocationCallOrder[0]).toBeLessThan(
      callOrderOf('/api/auth/me')
    );
  });

  it('submits the delete from the password field', async () => {
    mockRoutes(204);
    render(Account);

    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw12345678' } });
    const form = screen.getByLabelText('Password').closest('form');
    if (form === null) {
      throw new Error('The password field is not in a form, so Enter cannot submit it');
    }
    await fireEvent.submit(form);

    await vi.waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(requestTo('/api/auth/me').method).toBe('DELETE');
  });

  it('keeps the dialog open while the delete is in flight', async () => {
    let settle: (response: Response) => void = () => {};
    fetchMock.mockImplementation(async (input) => {
      if (new URL((input as Request).url).pathname === '/api/auth/tokens') {
        return jsonResponse(200, { personal_access_tokens: [] });
      }
      return new Promise<Response>((resolve) => {
        settle = resolve;
      });
    });
    render(Account);

    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await fireEvent(
      screen.getByRole('dialog', { name: 'Delete account' }),
      new Event('cancel', { cancelable: true })
    );
    expect(deleteDialog()).not.toBeNull();

    settle(jsonResponse(401, { error: 'Password is incorrect' }));

    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
    expect(deleteDialog()).not.toBeNull();
  });

  it('reports a wrong password in the dialog and keeps the session', async () => {
    mockRoutes(401, { error: 'Password is incorrect' });
    render(Account);

    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
    expect(session.status).toBe('authed');
    expect(window.location.pathname).toBe('/account');
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(vi.mocked(realtime.connect)).toHaveBeenCalledOnce();
  });

  it('revalidates instead of blaming the password when the session is already dead', async () => {
    mockRoutes(401, { error: 'Invalid or expired token' });
    render(Account);

    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw12345678' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    await vi.waitFor(() => expect(session.status).toBe('anon'));
    expect(screen.queryByText('Incorrect password')).not.toBeInTheDocument();
    const revalidation = fetchMock.mock.calls
      .map((call) => call[0] as Request)
      .filter((request) => new URL(request.url).pathname === '/api/auth/me');
    expect(revalidation.map((request) => request.method)).toEqual(['DELETE', 'GET']);
  });

  it('names the blocking boards from the conflict body and refetches the projects', async () => {
    mockRoutes(409, {
      error: 'You still own projects that other people are members of.',
      blocking_projects: [{ id: 'p-9', name: 'Shared Ledger' }],
    });
    render(Account);

    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw12345678' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(
      await screen.findByText('You still own projects that other people are members of.')
    ).toBeInTheDocument();
    // The projects store is empty here, so this name can only come from the response.
    const dialog = screen.getByRole('dialog', { name: 'Delete account' });
    expect(within(dialog).getByText('Shared Ledger')).toBeInTheDocument();
    await vi.waitFor(() => expect(pathsRequested()).toContain('/api/projects'));
    expect(deleteDialog()).not.toBeNull();
    expect(session.status).toBe('authed');
    expect(cacheDelete).not.toHaveBeenCalled();
  });

  it('disables the delete button and names the boards that still have members', () => {
    seedProject({ member_ids: ['u-2'] });
    mockRoutes(500);
    render(Account);

    expect(screen.getByRole('link', { name: 'Shared Ledger' })).toHaveAttribute(
      'href',
      '/projects/p-1'
    );
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
    expect(deleteDialog()).toBeNull();
  });

  it('leaves the delete button enabled for a solo board', () => {
    seedProject({ member_ids: [] });
    mockRoutes(500);
    render(Account);

    expect(screen.getByRole('button', { name: 'Delete account' })).toBeEnabled();
    expect(screen.queryByText('Shared Ledger')).not.toBeInTheDocument();
  });

  it('flags a confirmation mismatch', async () => {
    mockRoutes(500);
    render(Account);

    await fireEvent.input(screen.getByLabelText('Current password'), {
      target: { value: 'oldpass12' },
    });
    await fireEvent.input(screen.getByLabelText('New password'), {
      target: { value: 'newpass12' },
    });
    await fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'different12' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(pathsRequested()).toEqual(['/api/auth/tokens']);
  });
});
