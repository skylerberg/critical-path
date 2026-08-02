import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Unsubscribe from './Unsubscribe.svelte';

beforeEach(() => {
  fetchMock.mockReset();
  window.history.replaceState(null, '', '/unsubscribe');
});

describe('Unsubscribe', () => {
  it('unsubscribes on mount and names the kind it switched off', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { kind: 'task_assigned' }));
    render(Unsubscribe, { token: 'tok-123' });

    expect(
      await screen.findByText("You'll no longer get email when someone assigns you a task.")
    ).toBeInTheDocument();

    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/unsubscribe');
    expect(await request.clone().json()).toEqual({ token: 'tok-123' });
  });

  it('offers a second step that switches every kind off', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { kind: 'added_to_project' }));
    render(Unsubscribe, { token: 'tok-123' });

    const button = await screen.findByRole('button', { name: 'Turn off all email notifications' });
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await fireEvent.click(button);

    expect(
      await screen.findByText("You'll no longer get any notification email from us.")
    ).toBeInTheDocument();
    expect(new URL(requestAt(1).url).pathname).toBe('/api/auth/unsubscribe/all');
  });

  it('reports a rejected token without offering anything else', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: 'This unsubscribe link is not valid' }));
    render(Unsubscribe, { token: 'stale' });

    expect(await screen.findByText('This link is no longer valid.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Turn off all email notifications' })
    ).not.toBeInTheDocument();
  });

  it('never calls the API without a token', async () => {
    render(Unsubscribe, { token: undefined });

    expect(await screen.findByText('This link is no longer valid.')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('says nothing about the account behind the link', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { kind: 'task_assigned' }));
    const { container } = render(Unsubscribe, { token: 'tok-123' });

    await screen.findByText("You'll no longer get email when someone assigns you a task.");
    expect(container.textContent).not.toContain('@');
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  });
});
