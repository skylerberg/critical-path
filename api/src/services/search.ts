import { sql, type Kysely, type SqlBool } from 'kysely';
import type { DB } from '../db/types';
import type { SearchResponse } from '../schemas/index';
import { accessibleProjectsFilter } from './authorization';

export const SEARCH_RESULT_LIMIT = 50;

// Stemming the query is what makes prefix matching stop working mid-word (typed
// 'authenti' stems past the indexed 'authent'), so every token keeps a raw
// alternative beside its stemmed one. A query with no lexemes at all (`&&&`)
// aggregates to NULL, which `@@` rejects without raising.
function tsquery(query: string) {
  return sql`(
    select string_agg(
      '(' || quote_literal(u.lexeme) || ':*' ||
      coalesce(
        (
          select ' | ' || string_agg(quote_literal(s.lexeme) || ':*', ' | ')
          from unnest(to_tsvector('english', u.lexeme)) s
        ),
        ''
      ) || ')',
      ' & '
    )
    from unnest(to_tsvector('simple', ${query})) u
  )::tsquery`;
}

export async function searchTasks(
  db: Kysely<DB>,
  userId: string,
  query: string
): Promise<SearchResponse> {
  const matcher = tsquery(query);

  const rows = await db
    .selectFrom('task')
    .innerJoin('project', 'project.id', 'task.project_id')
    .innerJoin('board_column', 'board_column.id', 'task.column_id')
    .select([
      'task.id as task_id',
      'task.title as title',
      'project.id as project_id',
      'project.name as project_name',
      'board_column.name as column_name',
    ])
    .select(sql<number>`ts_rank(task.search_vector, ${matcher})`.as('search_rank'))
    .where('task.archived_at', 'is', null)
    .where('project.archived_at', 'is', null)
    .where(accessibleProjectsFilter(userId))
    .where(sql<SqlBool>`task.search_vector @@ ${matcher}`)
    .orderBy(sql`search_rank`, 'desc')
    .orderBy('task.updated_at', 'desc')
    .orderBy('task.id')
    .limit(SEARCH_RESULT_LIMIT + 1)
    .execute();

  return {
    results: rows.slice(0, SEARCH_RESULT_LIMIT).map((row) => ({
      task_id: row.task_id,
      title: row.title,
      project_id: row.project_id,
      project_name: row.project_name,
      column_name: row.column_name,
    })),
    truncated: rows.length > SEARCH_RESULT_LIMIT,
  };
}
