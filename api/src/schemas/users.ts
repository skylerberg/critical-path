import { type } from 'arktype';

export const userSchema = type({
  id: 'string',
  email: 'string',
  name: 'string',
});

export type User = typeof userSchema.infer;

export const usersResponseSchema = type({
  users: userSchema.array(),
});

export type UsersResponse = typeof usersResponseSchema.infer;
