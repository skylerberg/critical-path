import { Hono, Context } from 'hono';
import { Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { WebhookEvent } from '../services/webhooks/events';

export type Variables = {
  user?: {
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
    email_verified: boolean;
  };
  db: Kysely<DB>;
  postCommitHooks: Array<() => Promise<void>>;
  webhookEvents: WebhookEvent[];
  changedProjectIds: Set<string>;
};

export type AppContext = Context<{ Variables: Required<Variables> }>;

export type AppHono = Hono<{ Variables: Required<Variables> }>;
