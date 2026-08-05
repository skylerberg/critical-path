import { Hono, Context } from 'hono';
import { Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { WebhookEvent } from '../services/webhooks/events';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  email_verified: boolean;
};

type BaseVariables = {
  db: Kysely<DB>;
  postCommitHooks: Array<() => Promise<void>>;
  webhookEvents: WebhookEvent[];
  changedProjectIds: Set<string>;
  sortKeyScopes: Set<string>;
};

// The difference between these two is the whole point: `user` is present
// exactly where the global auth middleware ran. A helper reached from a public
// route takes the Public shape, where reading a user is a compile error rather
// than a TypeError at runtime.
export type Variables = BaseVariables & { user?: AuthenticatedUser };
export type AuthedVariables = BaseVariables & { user: AuthenticatedUser };

export type AppContext = Context<{ Variables: AuthedVariables }>;
export type PublicContext = Context<{ Variables: Variables }>;

export type AppHono = Hono<{ Variables: AuthedVariables }>;
export type PublicHono = Hono<{ Variables: Variables }>;
