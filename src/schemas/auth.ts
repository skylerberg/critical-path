import { type } from 'arktype';
import { uuid, email, namedRefSchema, stringWithLength } from './common';
import { meSchema } from './users';

// Deliberately no trimming: passwords are stored as typed.
export const password = type('string').pipe((s, ctx) => {
  if (s.length < 8) {
    return ctx.error('at least 8 characters');
  }
  if (s.length > 200) {
    return ctx.error('at most 200 characters');
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
  user: meSchema,
});

export type AuthResponse = typeof authResponseSchema.infer;

export const patchMeSchema = type({
  'name?': stringWithLength(1, 200),
  'email?': email,
});

export const changePasswordSchema = type({
  current_password: 'string',
  new_password: password,
});

// Plain string, not `password`: a re-entry field must answer 401 for a wrong
// password, never 422 because the stored one predates the length rules.
export const deleteAccountSchema = type({
  password: 'string',
});

export const deleteAccountConflictSchema = type({
  error: 'string',
  blocking_projects: namedRefSchema.array(),
});

export const forgotPasswordSchema = type({
  email,
});

export const resetPasswordSchema = type({
  token: 'string',
  new_password: password,
});

// Shared by every route that redeems a link we mailed. One export rather than
// one per route because identically shaped schemas collide in the OpenAPI name
// registry.
export const emailTokenRequestSchema = type({
  token: 'string',
});
