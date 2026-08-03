import type { components } from '../api/api.generated';

export type SearchResult = components['schemas']['SearchResult'];

export interface SearchGroup {
  projectId: string;
  projectName: string;
  results: SearchResult[];
}

// Mirror the server's bounds; outside them the request is a guaranteed 400.
export const SEARCH_MIN_QUERY_LENGTH = 1;
export const SEARCH_MAX_QUERY_LENGTH = 200;

// Shared, so two as-you-type surfaces cannot drift to different request rates.
export const SEARCH_DEBOUNCE_MS = 250;

export function parseSearchQuery(search: string): string {
  return new URLSearchParams(search).get('q')?.trim() ?? '';
}

export function searchPath(query: string): string {
  const trimmed = query.trim();
  return trimmed === '' ? '/search' : `/search?q=${encodeURIComponent(trimmed)}`;
}

// Groups follow first appearance, so they inherit the server's global ranking:
// the project holding the best hit leads.
export function groupByProject(results: readonly SearchResult[]): SearchGroup[] {
  const groups: SearchGroup[] = [];
  const indexByProject: Record<string, number | undefined> = {};
  for (const result of results) {
    const index = indexByProject[result.project_id];
    if (index === undefined) {
      indexByProject[result.project_id] = groups.length;
      groups.push({
        projectId: result.project_id,
        projectName: result.project_name,
        results: [result],
      });
    } else {
      groups[index]!.results.push(result);
    }
  }
  return groups;
}
