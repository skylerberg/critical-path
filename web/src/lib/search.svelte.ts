import { api, ApiError, assertOk } from '../api/client';
import {
  groupByProject,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchResult,
} from './search-query';

export type SearchStatus = 'idle' | 'loading' | 'loaded' | 'error';

export class SearchStore {
  query = $state('');
  results = $state<SearchResult[]>([]);
  truncated = $state(false);
  status = $state<SearchStatus>('idle');
  error = $state<string | null>(null);

  groups = $derived(groupByProject(this.results));

  // As-you-type fires overlapping requests; a slow early one must not land last.
  #token = 0;

  async run(query: string): Promise<void> {
    const trimmed = query.trim();
    const token = ++this.#token;
    this.query = trimmed;

    if (trimmed.length < SEARCH_MIN_QUERY_LENGTH || trimmed.length > SEARCH_MAX_QUERY_LENGTH) {
      this.results = [];
      this.truncated = false;
      this.error = null;
      this.status = 'idle';
      return;
    }

    // Results are deliberately left in place: the debounce re-arms on every
    // keystroke, so clearing here would blank the list between words.
    this.status = 'loading';
    try {
      const data = assertOk(await api.GET('/api/search', { params: { query: { q: trimmed } } }));
      if (token !== this.#token) {
        return;
      }
      this.results = data.results;
      this.truncated = data.truncated;
      this.error = null;
      this.status = 'loaded';
    } catch (error) {
      if (token !== this.#token) {
        return;
      }
      // Broad: an offline search rejects out of fetch as a TypeError, not an
      // ApiError, and an ApiError-only catch would pin the page on the spinner.
      this.error = error instanceof ApiError ? error.message : 'Search failed';
      // Unlike the loading path, the rows cannot stay: they answer an older
      // query and would be read as this one's results next to the failure.
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

export const search = new SearchStore();
