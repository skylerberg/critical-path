import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import NotificationSettings from './NotificationSettings.svelte';
import { session } from '../lib/session.svelte';

const ASSIGNED = 'When someone assigns me a task';
const ADDED = 'When someone adds me to a board';
const WITHHELD_LINE = 'These emails are on hold until your address is verified.';

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

  it('shows no toggle at all when the save and the resync both fail', async () => {
    fetchMock.mockResolvedValueOnce(settingsResponse(true, true));
    render(NotificationSettings);

    const toggle = await screen.findByLabelText(ASSIGNED);
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'save failed' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'reload failed' }));
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.queryByLabelText(ASSIGNED)).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText('save failed')).toBeInTheDocument();
  });

  it('stops saying mail is on hold once the address is verified', async () => {
    fetchMock.mockResolvedValue(settingsResponse(true, true));
    render(NotificationSettings);

    await screen.findByLabelText(ASSIGNED);
    expect(screen.queryByText(WITHHELD_LINE)).not.toBeInTheDocument();
  });

  it('says mail is withheld while unverified, without offering its own remedy', async () => {
    signIn(false);
    fetchMock.mockResolvedValue(settingsResponse(true, true));
    render(NotificationSettings);

    expect(await screen.findByText(WITHHELD_LINE)).toBeInTheDocument();
    expect(await screen.findByLabelText(ASSIGNED)).toBeEnabled();
    expect(screen.queryByRole('button', { name: /verif/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new URL(requestAt(0).url).pathname).toBe('/api/auth/me/notification-settings');
  });
});
