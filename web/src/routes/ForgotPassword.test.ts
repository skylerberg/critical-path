import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ForgotPassword from './ForgotPassword.svelte';

async function submitEmail(email: string): Promise<void> {
  await fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('ForgotPassword', () => {
  it('confirms the reset link was sent and posts the email on submit', async () => {
    fetchMock.mockResolvedValue(jsonResponse(204));
    render(ForgotPassword);

    await submitEmail('ada@example.com');

    expect(
      await screen.findByText("We've sent a reset link to ada@example.com.")
    ).toBeInTheDocument();
    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/forgot-password');
    expect(await request.clone().json()).toEqual({ email: 'ada@example.com' });
  });

  it('says no account exists and offers signup on a 404', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: 'No account exists for that email address' })
    );
    render(ForgotPassword);

    await submitEmail('ghost@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No account exists for that email address. Check it for a typo, or try the address you signed up with.'
    );
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  });

  it('reports throttling distinctly from an unknown address on a 429', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, { error: 'Too many password reset requests, please try again later' })
    );
    render(ForgotPassword);

    await submitEmail('ada@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please try again later.'
    );
    expect(screen.queryByText(/No account exists/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
  });

  it('shows a generic message when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    render(ForgotPassword);

    await submitEmail('ada@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Check your connection and try again.'
    );
    expect(screen.queryByText(/No account exists/)).not.toBeInTheDocument();
  });

  it('requires an email before submitting', async () => {
    render(ForgotPassword);

    await fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
