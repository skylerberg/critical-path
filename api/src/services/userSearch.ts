import { sql, type Kysely, type SqlBool } from 'kysely';
import type { DB } from '../db/types';
import type { UserSearchResponse } from '../schemas/index';
import { avatarUrl } from './avatars';
import { prefixTsquery } from './tsquery';
import { sharesProjectFilter } from './userDirectory';

// The one place that answers about people the caller has no relationship with.
// Kept out of ./userDirectory, whose whole premise is that visibility derives
// from project access — a query that deliberately ignores project access filed
// under that premise is how the next filter added there loses it.

export const USER_SEARCH_LIMIT = 10;

export async function searchUsersByName(
  db: Kysely<DB>,
  callerId: string,
  query: string
): Promise<UserSearchResponse> {
  const rows = await db
    .selectFrom('app_user')
    .select(['app_user.id', 'app_user.name', 'app_user.avatar_storage_key'])
    .where(sql<SqlBool>`app_user.name_search_vector @@ ${prefixTsquery(query)}`)
    // Everyone the caller can already list is excluded, so this route returns
    // strangers only. Without it the limit is spent on people the client
    // already has, and a common name answers with nothing new while strangers
    // matched. The caller's own row needs saying separately: someone with no
    // projects shares one with nobody, themselves included.
    .where('app_user.id', '!=', callerId)
    .where((eb) => eb.not(sharesProjectFilter(callerId)(eb)))
    .orderBy('app_user.name')
    .orderBy('app_user.id')
    .limit(USER_SEARCH_LIMIT + 1)
    .execute();

  return {
    users: rows.slice(0, USER_SEARCH_LIMIT).map(({ avatar_storage_key, ...rest }) => ({
      ...rest,
      avatar_url: avatarUrl(avatar_storage_key),
    })),
    truncated: rows.length > USER_SEARCH_LIMIT,
  };
}
