import { getRedis, redisConfigured } from '../redis';
import type { RedisClient } from '../redis';
import { logger } from '../../utils/logger';
import { deliverLocal, parseBusEntry, setRemotePublisher } from './bus';
import { errorText } from '../../utils/errors';

const CHANNEL = 'realtime-bus';

let subscriber: RedisClient | null = null;

export async function initRedisBus(): Promise<void> {
  if (!redisConfigured()) {
    return;
  }
  const publisher = getRedis();
  subscriber = publisher.duplicate();
  subscriber.on('error', (err: Error) => {
    logger.warn({ msg: 'Redis bus subscriber error', error: err.message });
  });
  await subscriber.connect();
  await subscriber.subscribe(CHANNEL, (message) => {
    try {
      const entry = parseBusEntry(JSON.parse(message));
      if (entry === null) {
        logger.warn({ msg: 'Discarded malformed bus message' });
        return;
      }
      deliverLocal(entry);
    } catch (err) {
      logger.error({
        msg: 'Failed to deliver bus message',
        error: errorText(err),
      });
    }
  });
  setRemotePublisher(async (entry) => {
    await publisher.publish(CHANNEL, JSON.stringify(entry));
  });
  logger.info({ msg: 'Realtime bus using Redis' });
}

export function closeRedisBus(): void {
  setRemotePublisher(null);
  if (subscriber) {
    const closing = subscriber;
    subscriber = null;
    closing.destroy();
  }
}
