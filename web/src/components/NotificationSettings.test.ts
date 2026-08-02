import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import NotificationSettings from './NotificationSettings.svelte';
import { session } from '../lib/session.svelte';

const ASSIGNED = 'When someone assigns me a task';
const ADDED = 'When someone adds me to a board';
const UNVERIFIED_LINE = /hasn't been verified yet/;

function signIn(emailVerified: boolean): void {
  session.user = {
    id: 'u-me',
    email: 'ada@example.com',
    name: 'Ada',
    avatar_url: null,
    email_verified: emailVerified,
  };
}

function settingsResponse(task_assigned: boolean, added_to_project: boolean): Response {
  return jsonResponse(200, { task_assigned, added_to_project });
}

beforeEach(() => {
  fetchMock.mockReset();
  signIn(true);
});

describe('NotificationSettings', () => {
  it('loads the current preferences', async () => {
    fetchMock.mockResolvedValue(settingsResponse(true, false));
    render(NotificationSettings);

    await waitFor(() => {
      expect(screen.getByLabelText(ASSIGNED)).toBeChecked();
    });
    expect(screen.getByLabelText(ADDED)).not.toBeChecked();
    expect(new URL(requestAt(0).url).pathname).toBe('/api/auth/me/notification-settings');
  });

  it('sends the whole settings object when one toggle changes', async () => {
    fetchMock.mockResolvedValueOnce(settingsResponse(true, true));
    render(NotificationSettings);

    const toggle = await screen.findByLabelText(ASSIGNED);
    fetchMock.mockResolvedValueOnce(settingsResponse(false, true));
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const request = requestAt(1);
    expect(request.method).toBe('PUT');
    expect(await request.clone().json()).toEqual({
      task_assigned: false,
      added_to_project: true,
    });
    expect(await screen.findByText('Preferences saved')).toBeInTheDocument();
  });

  it('reloads the stored preferences when a save fails', async () => {
    fetchMock.mockResolvedValueOnce(settingsResponse(true, true));
    render(NotificationSettings);

    const toggle = await screen.findByLabelText(ASSIGNED);
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'nope' }));
    fetchMock.mockResolvedValueOnce(settingsResponse(true, true));
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByLabelText(ASSIGNED)).toBeChecked();
    });
  });

  it('explains why mail is not being sent, only while the address is unverified', async () => {
    fetchMock.mockResolvedValue(settingsResponse(true, true));
    render(NotificationSettings);

    await screen.findByLabelText(ASSIGNED);
    expect(screen.queryByText(UNVERIFIED_LINE)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Resend verification email' })
    ).not.toBeInTheDocument();
  });

  it('offers a resend when the address is unverified, and leaves the toggles usable', async () => {
    signIn(false);
    fetchMock.mockResolvedValue(settingsResponse(true, true));
    render(NotificationSettings);

    expect(await screen.findByText(UNVERIFIED_LINE)).toHaveTextContent('ada@example.com');
    expect(await screen.findByLabelText(ASSIGNED)).toBeEnabled();

    const resend = screen.getByRole('button', { name: 'Resend verification email' });
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await fireEvent.click(resend);

    expect(await screen.findByText('Verification email sent')).toBeInTheDocument();
    expect(new URL(requestAt(1).url).pathname).toBe('/api/auth/verify-email/resend');
  });

  it('reports a throttled resend in plain language', async () => {
    signIn(false);
    fetchMock.mockResolvedValueOnce(settingsResponse(true, true));
    render(NotificationSettings);

    const resend = await screen.findByRole('button', { name: 'Resend verification email' });
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'Too many verification emails' }));
    await fireEvent.click(resend);

    expect(
      await screen.findByText('Too many requests — try again in a little while.')
    ).toBeInTheDocument();
  });
});
