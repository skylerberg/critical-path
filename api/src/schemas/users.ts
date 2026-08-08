import { type } from 'arktype';
import { email, stringWithLength, uuid } from './common';

export const usersQuerySchema = type({
  'project_id?': uuid,
  'email?': email,
});

export const USER_SEARCH_QUERY_MIN_LENGTH = 2;
export const USER_SEARCH_QUERY_MAX_LENGTH = 100;

// The description is not decoration. stringWithLength carries its bounds in a
// morph, and the OpenAPI schema-name registry drops morphs, so without a
// distinguishing keyword this emits JSON Schema identical to searchQuerySchema
// and the registry refuses to name two schemas the same shape.
export const userSearchQuerySchema = type({
  q: stringWithLength(USER_SEARCH_QUERY_MIN_LENGTH, USER_SEARCH_QUERY_MAX_LENGTH).configure({
    description: 'A name, or the first characters of one, matched a word at a time',
  }),
});

export const userSchema = type({
  id: 'string',
  name: 'string',
  avatar_url: 'string | null',
});

export type User = typeof userSchema.infer;

// Returned only to the caller about themselves. Nothing here may move onto
// userSchema: that shape describes *other* people and rides the user_updated
// realtime payload out to everyone who shares a project.
export const meSchema = userSchema.merge({
  email: 'string',
  email_verified: 'boolean',
});

export type Me = typeof meSchema.infer;

export const usersResponseSchema = type({
  users: userSchema.array(),
});

export type UsersResponse = typeof usersResponseSchema.infer;

export const userSearchResponseSchema = type({
  users: userSchema.array(),
  truncated: 'boolean',
});

export type UserSearchResponse = typeof userSearchResponseSchema.infer;
