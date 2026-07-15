import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ForgotPassword from './ForgotPassword.svelte';

beforeEach(() => {
  fetchMock.mockReset();
});

describe('ForgotPassword', () => {
  it('shows the neutral message and posts the email on submit', async () => {
    fetchMock.mockResolvedValue(jsonResponse(204));
    render(ForgotPassword);

    await fireEvent.input(screen.getByLabelText('Email'), {
      target: { value: 'ada@example.com' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(
      await screen.findByText("If that address exists, we've sent a reset link.")
    ).toBeInTheDocument();
    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/forgot-password');
    expect(await request.clone().json()).toEqual({ email: 'ada@example.com' });
  });

  it('still shows the neutral message even when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    render(ForgotPassword);

    await fireEvent.input(screen.getByLabelText('Email'), {
      target: { value: 'ghost@example.com' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(
      await screen.findByText("If that address exists, we've sent a reset link.")
    ).toBeInTheDocument();
  });

  it('requires an email before submitting', async () => {
    render(ForgotPassword);

    await fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
