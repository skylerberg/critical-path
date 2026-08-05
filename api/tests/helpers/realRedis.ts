import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

type RealRedis = ReturnType<typeof createClient>;

// Deliberately not REDIS_URL: a stray export of that one would put the whole
// suite on a shared counter, and in a mis-set shell it would be production's.
export const redisTestUrl = process.env.REDIS_TEST_URL;

// Every key a test causes carries this, so cleanup can find them without ever
// flushing a database that may hold something else.
export function realRedisPrefix(): string {
  return `test-${randomUUID()}:`;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

// The database index keeps the keys to themselves, but a pub/sub channel is one
// name on every server and this publishes fabricated events on it.
function assertLoopback(url: string): void {
  const host = new URL(url).hostname;
  if (!LOOPBACK.has(host)) {
    throw new Error(`Refusing a REDIS_TEST_URL that is not loopback: ${host}`);
  }
}

export async function openRealRedis(): Promise<RealRedis> {
  if (!redisTestUrl) {
    throw new Error('REDIS_TEST_URL is not set');
  }
  assertLoopback(redisTestUrl);
  const client = createClient({
    url: redisTestUrl,
    disableOfflineQueue: true,
    // The one place this parts company with the client the app builds:
    // reconnecting forever is how production degrades instead of failing, but
    // here it turns an absent Redis into a hang until the hook times out.
    socket: { connectTimeout: 2000, reconnectStrategy: false },
  });
  // An 'error' with no listener is thrown rather than reported.
  client.on('error', (err: Error) => {
    process.stderr.write(`real Redis test client: ${err.message}\n`);
  });
  await client.connect();
  return client;
}

// Closing matters as much as cleaning: the worker process outlives teardown
// for as long as the socket is open.
export async function closeRealRedis(client: RealRedis, prefix: string): Promise<void> {
  try {
    for await (const keys of client.scanIterator({ MATCH: `*${prefix}*`, COUNT: 500 })) {
      if (keys.length > 0) {
        await client.unlink(keys);
      }
    }
  } finally {
    await client.close();
  }
}
