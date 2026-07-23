import { createClient } from 'redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;

export function redisConfigured(): boolean {
  return Boolean(env.redisUrl);
}

// disableOfflineQueue makes commands reject immediately while disconnected,
// so callers fall back (local bus delivery, per-process rate limits) instead
// of hanging; the client keeps reconnecting in the background.
export function getRedis(): RedisClient {
  if (!env.redisUrl) {
    throw new Error('REDIS_URL is not configured');
  }
  if (!client) {
    client = createClient({
      url: env.redisUrl,
      disableOfflineQueue: true,
      socket: { connectTimeout: 2000 },
    });
    client.on('error', (err: Error) => {
      logger.warn({ msg: 'Redis client error', error: err.message });
    });
    client.connect().catch((err: unknown) => {
      logger.warn({
        msg: 'Redis connect failed',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return client;
}

export function closeRedis(): void {
  if (client) {
    const closing = client;
    client = null;
    closing.destroy();
  }
}
