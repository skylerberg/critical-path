export interface BoardFilters {
  labelIds: string[];
  assigneeIds: string[];
  query: string;
}

export function noFilters(): BoardFilters {
  return { labelIds: [], assigneeIds: [], query: '' };
}

function ids(params: URLSearchParams, key: string): string[] {
  const seen = new Set<string>();
  for (const value of params.getAll(key)) {
    for (const id of value.split(',')) {
      if (id !== '') {
        seen.add(id);
      }
    }
  }
  return [...seen];
}

export function parseFilters(search: string): BoardFilters {
  const params = new URLSearchParams(search);
  return {
    labelIds: ids(params, 'labels'),
    assigneeIds: ids(params, 'assignees'),
    query: params.get('q')?.trim() ?? '',
  };
}

// One filter state has exactly one serialization, so callers compare filter states by
// comparing the strings this returns.
export function filtersToSearch(filters: BoardFilters): string {
  const parts: string[] = [];
  if (filters.labelIds.length > 0) {
    parts.push(`labels=${filters.labelIds.map(encodeURIComponent).join(',')}`);
  }
  if (filters.assigneeIds.length > 0) {
    parts.push(`assignees=${filters.assigneeIds.map(encodeURIComponent).join(',')}`);
  }
  const query = filters.query.trim();
  if (query !== '') {
    parts.push(`q=${encodeURIComponent(query)}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

const FILTER_KEYS = ['labels', 'assignees', 'q'];

// Filters own three query keys; every other one belongs to whoever put it in the URL and
// has to survive a filter rewrite. Filters lead, so one filter state still has exactly
// one serialization for a given rest.
export function mergeFilterSearch(search: string, filters: BoardFilters): string {
  const rest = new URLSearchParams(search);
  for (const key of FILTER_KEYS) {
    rest.delete(key);
  }
  const others = rest.toString();
  const mine = filtersToSearch(filters);
  if (others === '') {
    return mine;
  }
  return mine === '' ? `?${others}` : `${mine}&${others}`;
}
