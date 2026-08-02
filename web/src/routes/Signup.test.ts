import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Signup from './Signup.svelte';
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
});
