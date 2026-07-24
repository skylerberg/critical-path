import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Account from './Account.svelte';
import { realtime } from '../lib/realtime.svelte';
import { session } from '../lib/session.svelte';
import { users } from '../lib/users.svelte';

vi.mock('../lib/realtime.svelte', () => ({
  realtime: { connect: vi.fn(), disconnect: vi.fn() },
}));

const user = { id: 'u-1', email: 'ada@example.com', name: 'Ada', avatar_url: null };

async function loginAs(): Promise<void> {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok', user }));
  await session.login(user.email, 'password123');
  fetchMock.mockClear();
}

async function bodyOf(request: Request): Promise<unknown> {
  return request.clone().json();
}

beforeEach(async () => {
  fetchMock.mockReset();
  vi.mocked(realtime.connect).mockClear();
  vi.mocked(realtime.disconnect).mockClear();
  users.reset();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/account');
  await session.init();
  await loginAs();
});

describe('Account', () => {
  it('updates the name and reflects it in the session', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...user, name: 'Ada L' }));
    render(Account);

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Ada L' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByText('Name updated')).toBeInTheDocument();
    const request = requestAt(0);
    expect(request.method).toBe('PATCH');
    expect(new URL(request.url).pathname).toBe('/api/auth/me');
    expect(await bodyOf(request)).toEqual({ name: 'Ada L' });
    expect(session.user?.name).toBe('Ada L');
  });

  it('shows a taken message on a 409 email conflict', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'duplicate' }));
    render(Account);

    await fireEvent.input(screen.getByLabelText('Email'), {
      target: { value: 'taken@example.com' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save email' }));

    expect(await screen.findByText('That email is taken')).toBeInTheDocument();
    expect(session.user?.email).toBe('ada@example.com');
  });

  it('changes the password, adopts the new session, and stays logged in', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { token: 'tok-2', user }));
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
    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/change-password');
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
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'nope' }));
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads a profile image and updates the session and users store', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...user, avatar_url: '/api/avatars/key-1' }));
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
      const request = requestAt(0);
      expect(request.method).toBe('POST');
      expect(new URL(request.url).pathname).toBe('/api/auth/me/avatar');
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
    fetchMock.mockResolvedValue(jsonResponse(200, { ...user, avatar_url: null }));
    render(Account);

    await fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));

    expect(await screen.findByText('Profile image removed')).toBeInTheDocument();
    const request = requestAt(0);
    expect(request.method).toBe('DELETE');
    expect(new URL(request.url).pathname).toBe('/api/auth/me/avatar');
    expect(session.user?.avatar_url).toBeNull();
    expect(users.byId('u-1')?.avatar_url).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove image' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument();
  });

  it('shows a friendly error when the image is too large and keeps the avatar state', async () => {
    fetchMock.mockResolvedValue(jsonResponse(413, { error: 'payload too large' }));
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
    render(Account);

    expect(screen.getByRole('heading', { name: 'Feedback' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeInTheDocument();
  });

  it('flags a confirmation mismatch', async () => {
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
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
