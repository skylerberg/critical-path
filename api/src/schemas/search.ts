import { type } from 'arktype';
import { stringWithLength } from './common';

// One character prefix-matches most of the board, so the floor is two.
export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 200;

export const searchQuerySchema = type({
  q: stringWithLength(SEARCH_QUERY_MIN_LENGTH, SEARCH_QUERY_MAX_LENGTH),
});

export const searchResultSchema = type({
  task_id: 'string',
  title: 'string',
  project_id: 'string',
  project_name: 'string',
  column_name: 'string',
});

export type SearchResult = typeof searchResultSchema.infer;

export const searchResponseSchema = type({
  results: searchResultSchema.array(),
  truncated: 'boolean',
});

export type SearchResponse = typeof searchResponseSchema.infer;
