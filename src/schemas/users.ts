import { type } from 'arktype';
import { email, uuid } from './common';

export const usersQuerySchema = type({
  'project_id?': uuid,
  'email?': email,
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
