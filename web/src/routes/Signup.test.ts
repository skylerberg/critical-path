import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Login from './Login.svelte';
import Signup from './Signup.svelte';
import { authForm } from '../lib/authForm.svelte';
import { session } from '../lib/session.svelte';
import { toasts } from '../lib/toasts.svelte';

const user = {
  id: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
  email: 'ada@example.com',
  name: 'Ada',
  avatar_url: null,
  email_verified: false,
};

async function fillForm(): Promise<void> {
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
  await fireEvent.input(screen.getByLabelText('Email'), {
    target: { value: 'ada@example.com' },
  });
  await fireEvent.input(screen.getByLabelText('Password'), {
    target: { value: 'password123' },
  });
}

beforeEach(async () => {
  fetchMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  authForm.clear();
  for (const toast of toasts.toasts) {
    toasts.dismiss(toast.id);
  }
  window.history.replaceState(null, '', '/signup');
  await session.init();
  fetchMock.mockClear();
});

describe('Signup', () => {
  it('shows required errors and skips the request when fields are empty', async () => {
    render(Signup);

    await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The other half of validatePassword. Sending a short password instead gets
  // the server's raw 'Validation failed: password: …' against the form as a
  // whole, rather than the rule under the field it belongs to.
  it('refuses a password under eight characters without asking the server', async () => {
    render(Signup);

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
    await fireEvent.input(screen.getByLabelText('Email'), {
      target: { value: 'ada@example.com' },
    });
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'short' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unreachable server rather than failing silently', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    render(Signup);

    await fillForm();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Check your connection and try again.'
    );
    expect(session.status).toBe('anon');
    expect(toasts.toasts).toEqual([]);
  });

  it('names the wait when the attempts are throttled', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'Too many requests' }));
    render(Signup);

    await fillForm();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait a minute and try again.'
    );
    expect(session.status).toBe('anon');
  });

  it('reports a taken address without starting a session', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'duplicate' }));
    render(Signup);

    await fillForm();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists'
    );
    expect(session.status).toBe('anon');
  });

  // Signup answers 201 whether or not the verification mail went out, so silence
  // here is what makes a withheld or undelivered link invisible.
  it('says a verification link is coming, and where to get another', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { token: 'tok-new', user }));
    render(Signup);

    await fillForm();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });
    expect(toasts.toasts.map((toast) => toast.message)).toEqual([
      'Check your inbox to verify your email address. You can send a fresh link from your account.',
    ]);
  });

  it('says nothing about an inbox when the signup failed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Sign-ups are disabled' }));
    render(Signup);

    await fillForm();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    await screen.findByRole('alert');
    expect(toasts.toasts).toEqual([]);
  });

  it('starts from what was typed on the login screen', async () => {
    const login = render(Login);
    await fireEvent.input(screen.getByLabelText('Email'), {
      target: { value: 'ada@example.com' },
    });
    await fireEvent.input(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    login.unmount();

    render(Signup);

    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('password123');
  });

  it('leaves nothing behind for the next person once the account exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { token: 'tok-new', user }));
    render(Signup);

    await fillForm();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(session.status).toBe('authed');
    });
    expect(authForm.name).toBe('');
    expect(authForm.email).toBe('');
    expect(authForm.password).toBe('');
  });
});
