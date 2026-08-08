import { sql, type RawBuilder } from 'kysely';

// Builds an as-you-type tsquery: every word the caller typed becomes a prefix
// term, and the terms are ANDed, so word order does not matter but a partial
// last word still matches.
//
// `stemWith` is for an index that stores stemmed lexemes beside raw ones.
// Stemming the *query* is what makes prefix matching stop working mid-word
// (typed 'authenti' stems past the indexed 'authent'), so each term keeps a raw
// alternative beside its stemmed one rather than being replaced by it.
//
// The input is bound as a parameter and tokenized by Postgres, then each
// resulting lexeme is re-escaped with quote_literal, so nothing the caller
// typed reaches the tsquery parser unquoted. A query with no lexemes at all
// (`&&&`) aggregates to NULL, which `@@` rejects without raising.
export function prefixTsquery(
  query: string,
  options: { stemWith?: 'english' } = {}
): RawBuilder<unknown> {
  const alternatives =
    options.stemWith === undefined
      ? sql`''`
      : sql`coalesce(
          (
            select ' | ' || string_agg(quote_literal(s.lexeme) || ':*', ' | ')
            from unnest(to_tsvector(${sql.lit(options.stemWith)}, u.lexeme)) s
          ),
          ''
        )`;

  return sql`(
    select string_agg(
      '(' || quote_literal(u.lexeme) || ':*' || ${alternatives} || ')',
      ' & '
    )
    from unnest(to_tsvector('simple', ${query})) u
  )::tsquery`;
}
