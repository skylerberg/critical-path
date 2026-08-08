import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import PersonalAccessTokens from './PersonalAccessTokens.svelte';
import { toasts } from '../lib/toasts.svelte';

interface TokenMetadata {
  id: string;
  name: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

function token(overrides: Partial<TokenMetadata> = {}): TokenMetadata {
  return {
    id: 't-1',
    name: 'CI runner',
    created_at: '2026-01-01T00:00:00.000Z',
    expires_at: null,
    last_used_at: null,
    ...overrides,
  };
}

function listResponse(tokens: TokenMetadata[]): Response {
  return jsonResponse(200, { personal_access_tokens: tokens });
}

async function bodyOf(request: Request): Promise<unknown> {
  return request.clone().json();
}

function mockCreate(secret: string): void {
  fetchMock.mockImplementation(async (input) => {
    if ((input as Request).method === 'GET') {
      return listResponse([]);
    }
    return jsonResponse(201, {
      token: secret,
      personal_access_token: token({ id: 't-new', name: 'CI' }),
    });
  });
}

async function createToken(): Promise<void> {
  await screen.findByText('You have no personal access tokens yet.');
  await fireEvent.input(screen.getByLabelText('Token name'), { target: { value: 'CI' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
  await screen.findByLabelText('New personal access token');
}

beforeEach(() => {
  fetchMock.mockReset();
  toasts.toasts = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PersonalAccessTokens', () => {
  it('loads the list on mount and renders each token', async () => {
    fetchMock.mockResolvedValue(
      listResponse([token(), token({ id: 't-2', name: 'Laptop agent' })])
    );
    render(PersonalAccessTokens);

    expect(await screen.findByText('CI runner')).toBeInTheDocument();
    expect(screen.getByText('Laptop agent')).toBeInTheDocument();
    const request = requestAt(0);
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/api/auth/tokens');
  });

  it('renders the empty state', async () => {
    fetchMock.mockResolvedValue(listResponse([]));
    render(PersonalAccessTokens);

    expect(await screen.findByText('You have no personal access tokens yet.')).toBeInTheDocument();
  });

  it('reports a failed load instead of claiming there are no tokens, and retries', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));
    fetchMock.mockResolvedValueOnce(listResponse([token()]));
    render(PersonalAccessTokens);

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.queryByText('You have no personal access tokens yet.')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('CI runner')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('marks an already-expired token', async () => {
    fetchMock.mockResolvedValue(listResponse([token({ expires_at: '2020-01-01T00:00:00.000Z' })]));
    render(PersonalAccessTokens);

    expect(await screen.findByText('Expired')).toBeInTheDocument();
  });

  it('says a token has never been used until the server reports a use', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    fetchMock.mockResolvedValue(
      listResponse([
        token(),
        token({
          id: 't-2',
          name: 'Laptop agent',
          last_used_at: '2026-03-01T09:00:00.000Z',
        }),
      ])
    );
    render(PersonalAccessTokens);

    await vi.waitFor(() => expect(screen.getByText('Laptop agent')).toBeInTheDocument());
    expect(screen.getByText('CI runner').closest('li')).toHaveTextContent('never used');

    const used = screen.getByText('3 hours ago');
    expect(used.tagName).toBe('TIME');
    expect(used).toHaveAttribute('datetime', '2026-03-01T09:00:00.000Z');
    expect(used.getAttribute('title')).toContain('2026');
    expect(screen.getByText('Laptop agent').closest('li')).toHaveTextContent(
      'last used 3 hours ago'
    );
  });

  it('creates a never-expiring token and shows the secret exactly once', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'GET') {
        return listResponse([]);
      }
      return jsonResponse(201, {
        token: 'cpat_supersecret',
        personal_access_token: token({ id: 't-new', name: 'CI' }),
      });
    });
    render(PersonalAccessTokens);
    await screen.findByText('You have no personal access tokens yet.');

    await fireEvent.input(screen.getByLabelText('Token name'), { target: { value: 'CI' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    expect(await screen.findByDisplayValue('cpat_supersecret')).toBeInTheDocument();
    expect(await bodyOf(requestAt(1))).toEqual({
      id: expect.any(String),
      name: 'CI',
      expires_at: null,
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue('cpat_supersecret')).not.toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('cpat_supersecret');
    expect(screen.getByText('CI')).toBeInTheDocument();
  });

  it('copies the secret to the clipboard', async () => {
    mockCreate('cpat_supersecret');
    render(PersonalAccessTokens);
    await createToken();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith('cpat_supersecret');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('does not claim to have copied when the clipboard is unavailable', async () => {
    mockCreate('cpat_supersecret');
    render(PersonalAccessTokens);
    await createToken();
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(toasts.toasts.map((entry) => entry.message)).toContain(
        'Could not copy to the clipboard'
      );
    });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('cpat_supersecret')).toBeInTheDocument();
  });

  it('rejects a blank name without calling the API', async () => {
    fetchMock.mockResolvedValue(listResponse([]));
    render(PersonalAccessTokens);
    await screen.findByText('You have no personal access tokens yet.');

    await fireEvent.input(screen.getByLabelText('Token name'), { target: { value: '   ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Give the token a name');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends an expiry exactly 90 days out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'GET') {
        return listResponse([]);
      }
      return jsonResponse(201, {
        token: 'cpat_x',
        personal_access_token: token({ id: 't-new', name: 'CI' }),
      });
    });
    render(PersonalAccessTokens);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await fireEvent.input(screen.getByLabelText('Token name'), { target: { value: 'CI' } });
    await fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '90' } });
    const clickedAt = Date.now();
    await fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = (await bodyOf(requestAt(1))) as { expires_at: string };
    expect(new Date(body.expires_at).getTime()).toBe(clickedAt + 90 * 24 * 60 * 60 * 1000);
  });

  it('reports a create failure without touching the list or showing a secret', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'GET') {
        return listResponse([token()]);
      }
      return jsonResponse(500, { error: 'boom' });
    });
    render(PersonalAccessTokens);
    await screen.findByText('CI runner');

    await fireEvent.input(screen.getByLabelText('Token name'), { target: { value: 'Second' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
    expect(screen.getByText('CI runner')).toBeInTheDocument();
    expect(screen.queryByLabelText('New personal access token')).not.toBeInTheDocument();
  });

  it('surfaces the server message when the token cap is hit', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'GET') {
        return listResponse([]);
      }
      return jsonResponse(422, {
        error: 'You already have 100 personal access tokens; revoke one before creating another',
      });
    });
    render(PersonalAccessTokens);
    await screen.findByText('You have no personal access tokens yet.');

    await fireEvent.input(screen.getByLabelText('Token name'), { target: { value: 'Overflow' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already have 100 personal access tokens; revoke one before creating another'
    );
  });

  it('revokes optimistically, before the DELETE resolves', async () => {
    let releaseDelete: (value: Response) => void = () => {};
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'GET') {
        return listResponse([token()]);
      }
      return new Promise<Response>((resolve) => {
        releaseDelete = resolve;
      });
    });
    render(PersonalAccessTokens);
    await screen.findByText('CI runner');

    await fireEvent.click(screen.getByRole('button', { name: 'Revoke CI runner' }));

    expect(screen.getByText('CI runner')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke of CI runner' }));

    expect(screen.queryByText('CI runner')).not.toBeInTheDocument();
    expect(requestAt(1).method).toBe('DELETE');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/auth/tokens/t-1');

    releaseDelete(jsonResponse(204));
  });

  it('restores the row and toasts when the revoke fails', async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'GET') {
        return listResponse([token()]);
      }
      return jsonResponse(500, { error: 'boom' });
    });
    render(PersonalAccessTokens);
    await screen.findByText('CI runner');

    await fireEvent.click(screen.getByRole('button', { name: 'Revoke CI runner' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke of CI runner' }));

    expect(await screen.findByText('CI runner')).toBeInTheDocument();
    expect(toasts.toasts.map((entry) => entry.message)).toContain('Could not revoke that token');
    expect(
      fetchMock.mock.calls.filter((call) => (call[0] as Request).method === 'GET')
    ).toHaveLength(2);
  });
});
