import type { DB as GeneratedDB } from './types.generated';

export * from './types.generated';

declare const sortKeyBrand: unique symbol;

// Every `sort_key` column is unique within its scope, and a key a client
// computed ranks it against only the rows that client can see -- which is not
// the scope the index covers. Writing one straight through is what used to
// answer 500 on the rows it could not see. The brand is how that stops being a
// convention each write site has to remember: the request schemas produce a
// plain `string`, the column below accepts only this, and the sole way across
// the gap is `resolveSortKey` or `appendKeys` in `src/services/sortKey.ts`.
export type ResolvedSortKey = string & { readonly [sortKeyBrand]: 'sortKey' };

type BrandSortKey<T> = 'sort_key' extends keyof T
  ? Omit<T, 'sort_key'> & { sort_key: ResolvedSortKey }
  : T;

export type DB = { [Table in keyof GeneratedDB]: BrandSortKey<GeneratedDB[Table]> };
