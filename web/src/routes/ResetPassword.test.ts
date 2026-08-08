import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ResetPassword from './ResetPassword.svelte';
import { authForm } from '../lib/authForm.svelte';
import { session } from '../lib/session.svelte';

const user = {
  id: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
  email: 'ada@example.com',
  name: 'Ada',
  avatar_url: null,
  email_verified: false,
};

async function fillPasswords(value: string): Promise<void> {
  await fireEvent.input(screen.getByLabelText('New password'), { target: { value } });
  await fireEvent.input(screen.getByLabelText('Confirm new password'), { target: { value } });
}

beforeEach(async () => {
  fetchMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  authForm.clear();
  window.history.replaceState(null, '', '/reset-password');
  await session.init();
  fetchMock.mockClear();
});

describe('ResetPassword', () => {
  it('submits the token and new password, then signs in on the session it gets back', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { token: 'tok-new', user }));
    render(ResetPassword, { token: 'tok-123' });

    await fillPasswords('newpass12');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });
    expect(session.status).toBe('authed');
    expect(localStorage.getItem('cp.token')).toBe('tok-new');
    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/reset-password');
    expect(await request.clone().json()).toEqual({ token: 'tok-123', new_password: 'newpass12' });
  });

  it('lands on the page the reset was interrupted from', async () => {
    sessionStorage.setItem('cp.intendedPath', '/projects/p9');
    fetchMock.mockResolvedValue(jsonResponse(200, { token: 'tok-new', user }));
    render(ResetPassword, { token: 'tok-123' });

    await fillPasswords('newpass12');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/projects/p9');
    });
  });

  it('shows the invalid-link message with a recovery link on a 422', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: 'expired' }));
    render(ResetPassword, { token: 'stale' });

    await fillPasswords('newpass12');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('This link is invalid or expired.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password'
    );
  });

  it('treats a missing token as an invalid link without calling the API', async () => {
    render(ResetPassword, { token: undefined });

    await fillPasswords('newpass12');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('This link is invalid or expired.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Under the field it is about. The mismatch used to render beneath "New
  // password", pointing at the one field that was not wrong.
  it('requires the passwords to match, and says so on the confirm field', async () => {
    render(ResetPassword, { token: 'tok-123' });

    await fireEvent.input(screen.getByLabelText('New password'), {
      target: { value: 'newpass12' },
    });
    await fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'mismatch12' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('New password')).not.toHaveAttribute('aria-invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('puts the length rule on the password field', async () => {
    render(ResetPassword, { token: 'tok-123' });

    await fillPasswords('short');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Confirm new password')).not.toHaveAttribute('aria-invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Both at once, so fixing the length does not then reveal the mismatch.
  it('reports a too-short password and a mismatch together', async () => {
    render(ResetPassword, { token: 'tok-123' });

    await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'short' } });
    await fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'different' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
  });

  it('reports a failed request away from both fields', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    render(ResetPassword, { token: 'tok-123' });

    await fillPasswords('newpass12');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Check your connection and try again.'
    );
    expect(screen.getByLabelText('New password')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Confirm new password')).not.toHaveAttribute('aria-invalid');
  });

  it('empties the credentials carried in from the signed-out screens', async () => {
    authForm.email = 'ada@example.com';
    authForm.password = 'the-old-one';
    fetchMock.mockResolvedValue(jsonResponse(200, { token: 'tok-new', user }));
    render(ResetPassword, { token: 'tok-123' });

    await fillPasswords('newpass12');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => {
      expect(session.status).toBe('authed');
    });
    expect(authForm.email).toBe('');
    expect(authForm.password).toBe('');
  });

  // A refused reset changes nothing, so it must leave the visitor signed out
  // rather than on a half-applied session.
  it('starts no session when the link is refused', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: 'expired' }));
    render(ResetPassword, { token: 'stale' });

    await fillPasswords('newpass12');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await screen.findByText('This link is invalid or expired.');
    expect(session.status).toBe('anon');
    expect(localStorage.getItem('cp.token')).toBeNull();
  });
});
