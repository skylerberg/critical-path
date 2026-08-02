import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { invitations, isExpired, type Invitation } from './invitations.svelte';
import { toasts } from './toasts.svelte';

const DAY_MS = 86_400_000;

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 'inv-1',
    project_id: 'p-1',
    email: 'ghost@example.com',
    role: 'editor',
    invited_by: 'u-me',
    created_at: '2026-01-01T00:00:00.000Z',
    expires_at: new Date(Date.now() + 14 * DAY_MS).toISOString(),
    ...overrides,
  };
}

async function loadWith(rows: Invitation[], projectId = 'p-1'): Promise<void> {
  fetchMock.mockImplementation(async () => jsonResponse(200, { invitations: rows }));
  await invitations.load(projectId);
  fetchMock.mockReset();
}

beforeEach(() => {
  fetchMock.mockReset();
  invitations.reset();
  toasts.toasts = [];
});

describe('invitations store', () => {
  it('loads a project’s pending list', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { invitations: [invitation()] }));

    await invitations.load('p-1');

    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects/p-1/invitations');
    expect(invitations.list).toHaveLength(1);
    expect(invitations.loaded).toBe(true);
    expect(invitations.loadError).toBeNull();
  });

  it('reports a failure instead of throwing at the caller', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(403, { error: 'Forbidden' }));

    await invitations.load('p-1');

    expect(invitations.loadError).toBe('Forbidden');
    expect(invitations.loaded).toBe(false);
    expect(invitations.list).toEqual([]);
  });

  it('drops the previous project’s addresses before fetching the next', async () => {
    await loadWith([invitation()]);

    fetchMock.mockImplementation(async () => new Promise<Response>(() => {}));
    void invitations.load('p-2');

    expect(invitations.list).toEqual([]);
    expect(invitations.loaded).toBe(false);
  });

  it('clears everything on reset so no address survives a sign-out', async () => {
    await loadWith([invitation()]);

    invitations.reset();

    expect(invitations.list).toEqual([]);
    expect(invitations.loaded).toBe(false);
    expect(invitations.currentProjectId).toBeNull();
    expect(invitations.loadError).toBeNull();
  });

  it('ignores a response that lands after a reset', async () => {
    let settle: (value: Response) => void = () => {};
    const inflight = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    fetchMock.mockImplementation(async () => inflight);

    const pending = invitations.load('p-1');
    invitations.reset();
    settle(jsonResponse(200, { invitations: [invitation()] }));
    await pending;

    expect(invitations.list).toEqual([]);
    expect(invitations.loaded).toBe(false);
  });

  it('adopts a newly created invitation, replacing the row it re-invited', async () => {
    await loadWith([invitation()]);

    invitations.adopt(invitation({ role: 'viewer' }));
    expect(invitations.list).toHaveLength(1);
    expect(invitations.list[0]!.role).toBe('viewer');

    invitations.adopt(invitation({ id: 'inv-2', email: 'other@example.com' }));
    expect(invitations.list.map((row) => row.id)).toEqual(['inv-1', 'inv-2']);
  });

  it('ignores an adoption for a project it is not showing', async () => {
    await loadWith([invitation()]);

    invitations.adopt(invitation({ id: 'inv-2', project_id: 'p-other' }));

    expect(invitations.list.map((row) => row.id)).toEqual(['inv-1']);
  });

  it('moves the deadline before the resend is acknowledged', async () => {
    const expired = invitation({ expires_at: new Date(Date.now() - DAY_MS).toISOString() });
    await loadWith([expired]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    const pending = invitations.resend('inv-1');
    expect(isExpired(invitations.list[0]!)).toBe(false);

    await pending;

    expect(requestAt(0).method).toBe('POST');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects/p-1/invitations/inv-1/resend');
    expect(toasts.toasts.map((t) => t.message)).toEqual(['Invitation resent']);
  });

  it('toasts and refetches when a resend is refused, never restoring a snapshot', async () => {
    const expired = invitation({ expires_at: new Date(Date.now() - DAY_MS).toISOString() });
    await loadWith([expired]);
    fetchMock.mockImplementation(async (input) =>
      (input as Request).method === 'POST'
        ? jsonResponse(429, { error: 'Too many resends' })
        : jsonResponse(200, { invitations: [] })
    );

    await invitations.resend('inv-1');

    expect(toasts.toasts.map((t) => t.message)).toEqual(['Too many resends']);
    expect(invitations.list).toEqual([]);
    expect(requestAt(1).method).toBe('GET');
  });

  it('drops a revoked row immediately and DELETEs it', async () => {
    await loadWith([invitation(), invitation({ id: 'inv-2', email: 'other@example.com' })]);
    fetchMock.mockImplementation(async () => jsonResponse(204));

    const pending = invitations.revoke('inv-1');
    expect(invitations.list.map((row) => row.id)).toEqual(['inv-2']);

    await pending;

    expect(requestAt(0).method).toBe('DELETE');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects/p-1/invitations/inv-1');
    expect(toasts.toasts).toEqual([]);
  });

  it('toasts and refetches when a revoke is refused', async () => {
    await loadWith([invitation()]);
    fetchMock.mockImplementation(async (input) =>
      (input as Request).method === 'DELETE'
        ? jsonResponse(404, { error: 'Invitation not found' })
        : jsonResponse(200, { invitations: [invitation()] })
    );

    await invitations.revoke('inv-1');

    expect(toasts.toasts.map((t) => t.message)).toEqual(['Invitation not found']);
    expect(invitations.list.map((row) => row.id)).toEqual(['inv-1']);
  });

  it('reads the deadline rather than assuming a listed invitation is live', () => {
    expect(isExpired(invitation({ expires_at: new Date(Date.now() - 1).toISOString() }))).toBe(
      true
    );
    expect(isExpired(invitation())).toBe(false);
  });
});
