import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Login from './Login.svelte';
import { session } from '../lib/session.svelte';

const user = { id: 'a3bb189e-8bf9-3888-9912-ace4e6543002', email: 'ada@example.com', name: 'Ada' };

async function fillCredentials(email: string, password: string): Promise<void> {
  await fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } });
  await fireEvent.input(screen.getByLabelText('Password'), { target: { value: password } });
}

beforeEach(async () => {
  fetchMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/login');
  await session.init();
  fetchMock.mockClear();
});

describe('Login', () => {
  it('renders the app name, form fields, and signup link', () => {
    render(Login);

    expect(screen.getByRole('heading', { name: 'Critical Path' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  });

  it('shows required errors and skips the request when fields are empty', async () => {
    render(Login);

    await fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the invalid-credentials message on 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Invalid credentials' }));
    render(Login);

    await fillCredentials('ada@example.com', 'wrong-password');
    await fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(session.status).toBe('anon');
  });

  it('logs in and navigates to the remembered path', async () => {
    sessionStorage.setItem('cp.intendedPath', '/projects/p9');
    fetchMock.mockResolvedValue(jsonResponse(200, { token: 'tok-new', user }));
    render(Login);

    await fillCredentials('ada@example.com', 'password123');
    await fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/projects/p9');
    });
    expect(session.status).toBe('authed');
    expect(localStorage.getItem('cp.token')).toBe('tok-new');
  });
});
