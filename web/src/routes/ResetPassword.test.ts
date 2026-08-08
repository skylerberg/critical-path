import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ResetPassword from './ResetPassword.svelte';
import { authForm } from '../lib/authForm.svelte';

async function fillPasswords(value: string): Promise<void> {
  await fireEvent.input(screen.getByLabelText('New password'), { target: { value } });
  await fireEvent.input(screen.getByLabelText('Confirm new password'), { target: { value } });
}

beforeEach(() => {
  fetchMock.mockReset();
  authForm.clear();
  window.history.replaceState(null, '', '/reset-password');
});

describe('ResetPassword', () => {
  it('submits the token and new password, then redirects to login', async () => {
    fetchMock.mockResolvedValue(jsonResponse(204));
    render(ResetPassword, { token: 'tok-123' });

    await fillPasswords('newpass12');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
    });
    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/reset-password');
    expect(await request.clone().json()).toEqual({ token: 'tok-123', new_password: 'newpass12' });
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

  it('requires the passwords to match', async () => {
    render(ResetPassword, { token: 'tok-123' });

    await fireEvent.input(screen.getByLabelText('New password'), {
      target: { value: 'newpass12' },
    });
    await fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'mismatch12' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The password carried this far is the one that just stopped working, so the
  // login form it redirects to must not offer it back. The address still stands.
  it('drops the carried-over password but keeps the address', async () => {
    authForm.email = 'ada@example.com';
    authForm.password = 'the-old-one';
    fetchMock.mockResolvedValue(jsonResponse(204));
    render(ResetPassword, { token: 'tok-123' });

    await fillPasswords('newpass12');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
    });
    expect(authForm.password).toBe('');
    expect(authForm.email).toBe('ada@example.com');
  });
});
