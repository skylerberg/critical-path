import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { publish, resetBus, subscribeBus } from '../../src/services/realtime/bus';
import type { BusEntry } from '../../src/services/realtime/bus';
import { closeRedisBus, initRedisBus } from '../../src/services/realtime/redisBus';
import { boardTaskPayload } from '../helpers/fixtures';
import { closeRealRedis, openRealRedis, realRedisPrefix, redisTestUrl } from '../helpers/realRedis';

const state = vi.hoisted(() => ({ enabled: false, client: null as unknown }));

vi.mock('../../src/services/redis', () => ({
  redisConfigured: () => state.enabled,
  getRedis: () => state.client,
}));

describe.skipIf(!redisTestUrl)('the realtime bus on a real Redis', () => {
  let client!: Awaited<ReturnType<typeof openRealRedis>>;
  const prefix = realRedisPrefix();
  // The channel is one name for everyone, so a second run against the same
  // server is heard here too; entries are matched on a per-run project.
  const project = `${prefix}project`;
  const entry: BusEntry = {
    type: 'task_updated',
    project_id: project,
    data: boardTaskPayload('t1', { title: 'through the wire' }),
    recipientUserIds: ['u1', 'u2'],
  };

  const collect = (received: BusEntry[]) => (e: BusEntry) => {
    if (e.project_id === project) received.push(e);
  };

  beforeAll(async () => {
    client = await openRealRedis();
    state.client = client;
    state.enabled = true;
  });

  afterAll(async () => {
    state.enabled = false;
    state.client = null;
    closeRedisBus();
    resetBus();
    if (client) await closeRealRedis(client, prefix);
  });

  afterEach(() => {
    closeRedisBus();
    resetBus();
  });

  // A subscriber on a second module instance shares nothing in this process
  // with the one that published, so arriving there is the round trip.
  it('carries a publish from one replica to a subscriber on another', async () => {
    await initRedisBus();

    vi.resetModules();
    const replicaBus = await import('../../src/services/realtime/bus');
    const replicaRedisBus = await import('../../src/services/realtime/redisBus');
    await replicaRedisBus.initRedisBus();

    const received: BusEntry[] = [];
    replicaBus.subscribeBus(collect(received));

    try {
      publish(entry);
      await vi.waitFor(() => {
        expect(received).toEqual([entry]);
      });
    } finally {
      replicaRedisBus.closeRedisBus();
      replicaBus.resetBus();
    }
  });

  it('reaches the publishing replica through the echo, not by a local hand-off', async () => {
    await initRedisBus();
    const received: BusEntry[] = [];
    subscribeBus(collect(received));

    publish(entry);
    expect(received).toEqual([]);

    await vi.waitFor(() => {
      expect(received).toEqual([entry]);
    });
  });
});
