import { type } from 'arktype';
import { uuid, stringWithLength, isoDateString } from './common';

export const personalAccessTokenSchema = type({
  id: 'string',
  name: 'string',
  created_at: 'string',
  expires_at: 'string | null',
  last_used_at: 'string | null',
});

export type PersonalAccessTokenResponse = typeof personalAccessTokenSchema.infer;

export const personalAccessTokensResponseSchema = type({
  personal_access_tokens: personalAccessTokenSchema.array(),
});

export const createPersonalAccessTokenSchema = type({
  id: uuid,
  name: stringWithLength(1, 100),
  'expires_at?': isoDateString.or('null'),
});

export const createdPersonalAccessTokenSchema = type({
  token: 'string',
  personal_access_token: personalAccessTokenSchema,
});
