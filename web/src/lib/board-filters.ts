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
