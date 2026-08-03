import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import type { RealtimeEvent } from './realtime-types';
import { toasts } from './toasts.svelte';

export type Invitation = components['schemas']['ProjectInvitation'];

// Mirrors the server's deadline so a resend stops reading as expired without a
// second round trip; the next load reconciles the exact value.
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function isExpired(invitation: Invitation, now: number = Date.now()): boolean {
  return Date.parse(invitation.expires_at) <= now;
}

class InvitationsStore {
  currentProjectId = $state<string | null>(null);
  list = $state<Invitation[]>([]);
  loaded = $state(false);
  loadError = $state<string | null>(null);

  // Bumped by writes and by reset as well as by reads, so a response built before
  // either cannot land on top of what the store already knows.
  #token = 0;

  async load(projectId: string): Promise<void> {
    if (projectId !== this.currentProjectId) {
      this.#clear();
      this.currentProjectId = projectId;
    }
    const token = ++this.#token;
    this.loadError = null;
    try {
      const data = assertOk(
        await api.GET('/api/projects/{id}/invitations', { params: { path: { id: projectId } } })
      );
      if (token !== this.#token) return;
      this.list = data.invitations;
      this.loaded = true;
    } catch (error) {
      if (token !== this.#token) return;
      this.loadError = error instanceof ApiError ? error.message : 'Failed to load invitations';
    }
  }

  reset(): void {
    this.#clear();
    this.currentProjectId = null;
  }

  // The event says only which board's list moved — the addresses are never on
  // the wire — so refetching the editor-gated list is the whole of applying it.
  applyRealtime(event: RealtimeEvent): void {
    const projectId = this.currentProjectId;
    if (projectId === null || event.project_id !== projectId) {
      return;
    }
    void this.load(projectId);
  }

  // Nothing arrives while the socket is down, so the gap it left is re-read.
  resync(): void {
    if (this.currentProjectId !== null) {
      void this.load(this.currentProjectId);
    }
  }

  // Re-inviting an address returns the row it already had, so this replaces as
  // often as it appends.
  adopt(invitation: Invitation): void {
    if (!this.loaded || invitation.project_id !== this.currentProjectId) {
      return;
    }
    this.list = this.list.some((row) => row.id === invitation.id)
      ? this.list.map((row) => (row.id === invitation.id ? invitation : row))
      : [...this.list, invitation];
  }

  async resend(invitationId: string): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    this.#token += 1;
    this.#update(invitationId, (row) => ({
      ...row,
      expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
    }));
    try {
      assertOk(
        await api.POST('/api/projects/{id}/invitations/{invitationId}/resend', {
          params: { path: { id: projectId, invitationId } },
        })
      );
      toasts.success('Invitation resent');
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to resend the invitation');
    }
  }

  async revoke(invitationId: string): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    this.#token += 1;
    this.list = this.list.filter((row) => row.id !== invitationId);
    try {
      assertOk(
        await api.DELETE('/api/projects/{id}/invitations/{invitationId}', {
          params: { path: { id: projectId, invitationId } },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error, 'Failed to revoke the invitation');
    }
  }

  #update(invitationId: string, patch: (invitation: Invitation) => Invitation): void {
    this.list = this.list.map((row) => (row.id === invitationId ? patch(row) : row));
  }

  async #mutationFailed(error: unknown, fallback: string): Promise<void> {
    toasts.error(error instanceof ApiError ? error.message : fallback);
    if (this.currentProjectId !== null) {
      await this.load(this.currentProjectId);
    }
  }

  #clear(): void {
    this.#token += 1;
    this.list = [];
    this.loaded = false;
    this.loadError = null;
  }
}

export const invitations = new InvitationsStore();
