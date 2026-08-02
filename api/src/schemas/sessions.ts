import { type } from 'arktype';

export const sessionSchema = type({
  id: 'string',
  user_agent: 'string | null',
  created_at: 'string',
  expires_at: 'string',
  is_current: 'boolean',
});

export type SessionResponse = typeof sessionSchema.infer;

export const sessionsResponseSchema = type({
  sessions: sessionSchema.array(),
});
