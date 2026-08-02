import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Sessions from './Sessions.svelte';
import { realtime } from '../lib/realtime.svelte';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import { toasts } from '../lib/toasts.svelte';

vi.mock('../lib/realtime.svelte', () => ({
  realtime: { connect: vi.fn(), disconnect: vi.fn() },
}));

interface SessionMetadata {
  id: string;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  is_current: boolean;
}

const THIS_DEVICE = '2026-03-01T09:30:00.000Z';
const OTHER_DEVICE = '2026-02-01T18:05:00.000Z';
const EXPIRES = '2026-04-01T09:30:00.000Z';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';
const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0';

function entry(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    id: 's-1',
    user_agent: CHROME_MAC,
    created_at: THIS_DEVICE,
    expires_at: EXPIRES,
    is_current: true,
    ...overrides,
  };
}

function listResponse(sessions: SessionMetadata[]): Response {
  return jsonResponse(200, { sessions });
}

const momentFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function moment(value: string): string {
  return momentFormat.format(new Date(value));
}

function day(value: string): string {
  return dayFormat.format(new Date(value));
}

function detailLine(createdAt: string, expiresAt: string = EXPIRES): string {
  return `Signed in ${moment(createdAt)} · expires ${day(expiresAt)}`;
}

function subject(position: number, total: number, device: string, createdAt: string): string {
  return `session ${String(position)} of ${String(total)}, ${device}, signed in ${moment(createdAt)}`;
}

function revokeName(position: number, total: number, device: string, createdAt: string): string {
  return `Revoke ${subject(position, total, device, createdAt)}`;
}

function confirmName(position: number, total: number, device: string, createdAt: string): string {
  return `Confirm revoke of ${subject(position, total, device, createdAt)}`;
}

const user = {
  id: 'u-1',
  email: 'ada@example.com',
  name: 'Ada',
  avatar_url: null,
  email_verified: false,
};

beforeEach(() => {
  fetchMock.mockReset();
  toasts.toasts = [];
  session.adopt('tok', user);
  vi.mocked(realtime.connect).mockClear();
  vi.mocked(realtime.disconnect).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Sessions', () => {
  it('loads the list on mount and names the device, the moment and the expiry', async () => {
    fetchMock.mockResolvedValue(
      listResponse([
        entry(),
        entry({
          id: 's-2',
          created_at: OTHER_DEVICE,
          is_current: false,
          user_agent: FIREFOX_WINDOWS,
        }),
      ])
    );
    render(Sessions);

    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('Firefox on Windows')).toBeInTheDocument();
    expect(screen.getByText(detailLine(OTHER_DEVICE))).toBeInTheDocument();
    // detailLine carries no seconds, so an exact match is what holds the panel
    // to the moment it promises.
    expect(screen.getByText(detailLine(THIS_DEVICE))).toBeInTheDocument();
    const request = requestAt(0);
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/api/auth/sessions');
  });

  it('calls a session with no recorded user agent an unknown device', async () => {
    fetchMock.mockResolvedValue(listResponse([entry({ user_agent: null })]));
    render(Sessions);

    expect(await screen.findByText('Unknown device')).toBeInTheDocument();
  });

  it('marks the current device and only that one', async () => {
    fetchMock.mockResolvedValue(
      listResponse([
        entry(),
        entry({
          id: 's-2',
          created_at: OTHER_DEVICE,
          is_current: false,
          user_agent: FIREFOX_WINDOWS,
        }),
      ])
    );
    render(Sessions);

    expect(await screen.findAllByText('This device')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sign out of this device' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: revokeName(2, 2, 'Firefox on Windows', OTHER_DEVICE) })
    ).toBeInTheDocument();
  });

  it('names two matching rows apart so either can be reached', async () => {
    fetchMock.mockResolvedValue(
      listResponse([
        entry({ id: 's-2', is_current: false }),
        entry({ id: 's-3', is_current: false }),
      ])
    );
    render(Sessions);

    expect(
      await screen.findByRole('button', { name: revokeName(1, 2, 'Chrome on macOS', THIS_DEVICE) })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: revokeName(2, 2, 'Chrome on macOS', THIS_DEVICE) })
    ).toBeInTheDocument();
  });

  it('renders the empty state', async () => {
    fetchMock.mockResolvedValue(listResponse([]));
    render(Sessions);

    expect(await screen.findByText('You have no active sessions.')).toBeInTheDocument();
  });

  it('reports a failed load instead of claiming there are none, and retries', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));
    fetchMock.mockResolvedValueOnce(listResponse([entry()]));
    render(Sessions);

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.queryByText('You have no active sessions.')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a refetch that fails after the list has already loaded', async () => {
    let listCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'GET') {
        listCalls += 1;
        return listCalls === 1
          ? listResponse([entry({ id: 's-2', is_current: false, user_agent: FIREFOX_WINDOWS })])
          : jsonResponse(500, { error: 'the list is unavailable' });
      }
      return jsonResponse(500, { error: 'boom' });
    });
    render(Sessions);
    await screen.findByText('Firefox on Windows');

    await fireEvent.click(
      screen.getByRole('button', { name: revokeName(1, 1, 'Firefox on Windows', THIS_DEVICE) })
    );
    await fireEvent.click(
      screen.getByRole('button', {
        name: confirmName(1, 1, 'Firefox on Windows', THIS_DEVICE),
      })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('the list is unavailable');
    expect(screen.queryByText('You have no active sessions.')).not.toBeInTheDocument();
  });

  it('waits for the refetch before it will say there are none', async () => {
    let listCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'GET') {
        listCalls += 1;
        if (listCalls === 1) {
          return listResponse([
            entry({ id: 's-2', is_current: false, user_agent: FIREFOX_WINDOWS }),
          ]);
        }
        return new Promise<Response>(() => {});
      }
      return jsonResponse(500, { error: 'boom' });
    });
    render(Sessions);
    await screen.findByText('Firefox on Windows');

    await fireEvent.click(
      screen.getByRole('button', { name: revokeName(1, 1, 'Firefox on Windows', THIS_DEVICE) })
    );
    await fireEvent.click(
      screen.getByRole('button', {
        name: confirmName(1, 1, 'Firefox on Windows', THIS_DEVICE),
      })
    );

    expect(await screen.findByText('Loading sessions…')).toBeInTheDocument();
    expect(screen.queryByText('You have no active sessions.')).not.toBeInTheDocument();
  });

  it('revokes another session optimistically, only after the confirm click', async () => {
    let releaseDelete: (value: Response) => void = () => {};
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'GET') {
        return listResponse([
          entry({
            id: 's-2',
            created_at: OTHER_DEVICE,
            is_current: false,
            user_agent: FIREFOX_WINDOWS,
          }),
        ]);
      }
      return new Promise<Response>((resolve) => {
        releaseDelete = resolve;
      });
    });
    render(Sessions);
    await screen.findByText('Firefox on Windows');

    await fireEvent.click(
      screen.getByRole('button', { name: revokeName(1, 1, 'Firefox on Windows', OTHER_DEVICE) })
    );

    expect(screen.getByText('Firefox on Windows')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fireEvent.click(
      screen.getByRole('button', {
        name: confirmName(1, 1, 'Firefox on Windows', OTHER_DEVICE),
      })
    );

    expect(screen.queryByText('Firefox on Windows')).not.toBeInTheDocument();
    expect(requestAt(1).method).toBe('DELETE');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/auth/sessions/s-2');
    expect(session.token).toBe('tok');
    // Another device's session: this one's socket has no reason to go down.
    expect(realtime.disconnect).not.toHaveBeenCalled();

    releaseDelete(jsonResponse(204));
  });

  it('restores the row and toasts when the revoke fails', async () => {
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'GET') {
        return listResponse([
          entry({
            id: 's-2',
            created_at: OTHER_DEVICE,
            is_current: false,
            user_agent: FIREFOX_WINDOWS,
          }),
        ]);
      }
      return jsonResponse(500, { error: 'boom' });
    });
    render(Sessions);
    await screen.findByText('Firefox on Windows');

    await fireEvent.click(
      screen.getByRole('button', { name: revokeName(1, 1, 'Firefox on Windows', OTHER_DEVICE) })
    );
    await fireEvent.click(
      screen.getByRole('button', {
        name: confirmName(1, 1, 'Firefox on Windows', OTHER_DEVICE),
      })
    );

    expect(await screen.findByText('Firefox on Windows')).toBeInTheDocument();
    expect(toasts.toasts.map((toast) => toast.message)).toContain('Could not revoke that session');
    expect(
      fetchMock.mock.calls.filter((call) => (call[0] as Request).method === 'GET')
    ).toHaveLength(2);
    expect(realtime.connect).not.toHaveBeenCalled();
  });

  it('does not bring back a session revoked while a refetch was already in flight', async () => {
    let releaseList: (value: Response) => void = () => {};
    let listCalls = 0;
    const both = [
      entry({ id: 's-2', is_current: false }),
      entry({
        id: 's-3',
        created_at: OTHER_DEVICE,
        is_current: false,
        user_agent: FIREFOX_WINDOWS,
      }),
    ];
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (request.method === 'GET') {
        listCalls += 1;
        if (listCalls === 1) {
          return listResponse(both);
        }
        return new Promise<Response>((resolve) => {
          releaseList = resolve;
        });
      }
      return new URL(request.url).pathname.endsWith('s-2')
        ? jsonResponse(500, { error: 'boom' })
        : jsonResponse(204);
    });
    render(Sessions);
    await screen.findByText('Chrome on macOS');

    await fireEvent.click(
      screen.getByRole('button', { name: revokeName(1, 2, 'Chrome on macOS', THIS_DEVICE) })
    );
    await fireEvent.click(
      screen.getByRole('button', {
        name: confirmName(1, 2, 'Chrome on macOS', THIS_DEVICE),
      })
    );
    await waitFor(() => {
      expect(listCalls).toBe(2);
    });

    await fireEvent.click(
      screen.getByRole('button', { name: revokeName(1, 1, 'Firefox on Windows', OTHER_DEVICE) })
    );
    await fireEvent.click(
      screen.getByRole('button', {
        name: confirmName(1, 1, 'Firefox on Windows', OTHER_DEVICE),
      })
    );
    releaseList(listResponse(both));

    expect(await screen.findByText('You have no active sessions.')).toBeInTheDocument();
    expect(screen.queryByText('Firefox on Windows')).not.toBeInTheDocument();
  });

  it('signs this device out when the current session is revoked', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'GET') {
        return listResponse([entry()]);
      }
      return jsonResponse(204);
    });
    render(Sessions);
    await screen.findByText('Chrome on macOS');

    await fireEvent.click(screen.getByRole('button', { name: 'Sign out of this device' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm sign out of this device' }));

    await waitFor(() => {
      expect(session.token).toBeNull();
    });
    expect(session.status).toBe('anon');
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(realtime.disconnect).toHaveBeenCalled();
    expect(realtime.connect).not.toHaveBeenCalled();
  });

  it('keeps this device signed in when revoking the current session fails', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    fetchMock.mockImplementation(async (input) => {
      if ((input as Request).method === 'GET') {
        return listResponse([entry()]);
      }
      return jsonResponse(500, { error: 'boom' });
    });
    render(Sessions);
    await screen.findByText('Chrome on macOS');

    await fireEvent.click(screen.getByRole('button', { name: 'Sign out of this device' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm sign out of this device' }));

    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(session.token).toBe('tok');
    expect(navigate).not.toHaveBeenCalled();
    expect(realtime.connect).toHaveBeenCalled();
  });
});
