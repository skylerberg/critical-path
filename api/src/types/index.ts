import { Hono, Context } from 'hono';
import { Kysely } from 'kysely';
import type { DB } from '../db/types';

export type Variables = {
  user?: {
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
  };
  db: Kysely<DB>;
  postCommitHooks: Array<() => Promise<void>>;
};

export type AppContext = Context<{ Variables: Required<Variables> }>;

export type AppHono = Hono<{ Variables: Required<Variables> }>;
