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

export const usersResponseSchema = type({
  users: userSchema.array(),
});

export type UsersResponse = typeof usersResponseSchema.infer;
