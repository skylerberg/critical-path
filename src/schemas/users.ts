import { type } from 'arktype';
import { uuid } from './common';

export const usersQuerySchema = type({
  'project_id?': uuid,
});

export const userSchema = type({
  id: 'string',
  email: 'string',
  name: 'string',
  avatar_url: 'string | null',
});

export type User = typeof userSchema.infer;

// Returned only to the caller about themselves. `email_verified` must never
// move onto userSchema: that shape describes *other* people and rides the
// user_updated realtime payload out to everyone who shares a project.
export const meSchema = userSchema.merge({
  email_verified: 'boolean',
});

export type Me = typeof meSchema.infer;

export const usersResponseSchema = type({
  users: userSchema.array(),
});

export type UsersResponse = typeof usersResponseSchema.infer;
