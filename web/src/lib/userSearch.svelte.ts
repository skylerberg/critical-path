import { api, assertOk } from '../api/client';
import { apiMessage } from './apiMessages';
import type { User } from './users.svelte';

export type UserSearchStatus = 'idle' | 'loading' | 'loaded' | 'error';

// Mirror the server's bounds; outside them the request is a guaranteed 400.
export const USER_SEARCH_MIN_QUERY_LENGTH = 2;
export const USER_SEARCH_MAX_QUERY_LENGTH = 100;

// Deliberately shaped like `search.svelte.ts` — same token/debounce/status
// contract, and the reasoning for it lives there. Only what differs is spelled
// out below, so a change to the shared behavior has to be made in both.
//
// One per picker rather than a shared singleton: two open member pickers are
// answering different questions, and the rows grant board access.
export class UserSearchStore {
  query = $state('');
  results = $state<User[]>([]);
  truncated = $state(false);
  status = $state<UserSearchStatus>('idle');
  error = $state<string | null>(null);

  // As-you-type fires overlapping requests; a slow early one must not land last.
  #token = 0;

  async run(query: string): Promise<void> {
    const trimmed = query.trim();
    const token = ++this.#token;
    this.query = trimmed;

    if (
      trimmed.length < USER_SEARCH_MIN_QUERY_LENGTH ||
      trimmed.length > USER_SEARCH_MAX_QUERY_LENGTH
    ) {
      this.results = [];
      this.truncated = false;
      this.error = null;
      this.status = 'idle';
      return;
    }

    this.status = 'loading';
    try {
      const data = assertOk(
        await api.GET('/api/users/search', { params: { query: { q: trimmed } } })
      );
      if (token !== this.#token) {
        return;
      }
      this.results = data.users;
      this.truncated = data.truncated;
      this.error = null;
      this.status = 'loaded';
    } catch (error) {
      if (token !== this.#token) {
        return;
      }
      // Broad: an offline search rejects out of fetch as a TypeError, not an
      // ApiError, and an ApiError-only catch would pin the picker on the spinner.
      this.error = apiMessage(error, 'Search failed');
      // Cleared here where the loading path leaves them, and for a sharper reason
      // than the task search has: they answer an older query, and adding one of
      // them grants board access to whoever it now names.
      this.results = [];
      this.truncated = false;
      this.status = 'error';
    }
  }

  reset(): void {
    this.#token++;
    this.query = '';
    this.results = [];
    this.truncated = false;
    this.error = null;
    this.status = 'idle';
  }
}
