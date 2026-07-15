import { type } from 'arktype';
import { uuid, email, stringWithLength } from './common';
import { userSchema } from './users';

// Deliberately no trimming: passwords are stored as typed.
export const password = type('string').pipe((s, ctx) => {
  if (s.length < 8) {
    return ctx.error('must be at least 8 characters');
  }
  if (s.length > 200) {
    return ctx.error('must be at most 200 characters');
  }
  return s;
});

export const signupRequestSchema = type({
  id: uuid,
  email,
  password,
  name: stringWithLength(1, 200),
});

export const loginRequestSchema = type({
  email,
  password,
});

export const authResponseSchema = type({
  token: 'string',
  user: userSchema,
});

export type AuthResponse = typeof authResponseSchema.infer;
