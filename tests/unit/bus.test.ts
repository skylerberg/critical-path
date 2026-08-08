import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  deliverLocal,
  parseBusEntry,
  publish,
  resetBus,
  setRemotePublisher,
  subscribeBus,
} from '../../src/services/realtime/bus';
import type { BusEntry } from '../../src/services/realtime/bus';

const entry: BusEntry = {
  type: 'task_deleted',
  project_id: 'p1',
  data: { id: 't1', actor_user_id: 'u1' },
};

describe('realtime bus remote publishing', () => {
  beforeEach(() => {
    resetBus();
  });

  it('delivers locally when no remote publisher is set', () => {
    const received: BusEntry[] = [];
    subscribeBus((e) => received.push(e));
    publish(entry);
    expect(received).toEqual([entry]);
  });

  it('routes through the remote publisher without direct local delivery', () => {
    const received: BusEntry[] = [];
    subscribeBus((e) => received.push(e));
    const remote = vi.fn().mockResolvedValue(undefined);
    setRemotePublisher(remote);

    publish(entry);

    expect(remote).toHaveBeenCalledWith(entry);
    expect(received).toEqual([]);
  });

  it('remote subscription echo reaches local subscribers via deliverLocal', () => {
    const received: BusEntry[] = [];
    subscribeBus((e) => received.push(e));
    setRemotePublisher(async (e) => deliverLocal(e));

    publish(entry);

    return vi.waitFor(() => expect(received).toEqual([entry]));
  });

  it('falls back to local delivery when the remote publisher rejects', async () => {
    const received: BusEntry[] = [];
    subscribeBus((e) => received.push(e));
    setRemotePublisher(() => Promise.reject(new Error('redis down')));

    publish(entry);

    await vi.waitFor(() => expect(received).toEqual([entry]));
  });

  it('resetBus clears the remote publisher', () => {
    const remote = vi.fn().mockResolvedValue(undefined);
    setRemotePublisher(remote);
    resetBus();

    const received: BusEntry[] = [];
    subscribeBus((e) => received.push(e));
    publish(entry);

    expect(remote).not.toHaveBeenCalled();
    expect(received).toEqual([entry]);
  });
});

// Redis is the one path where an envelope is not built by a publish site, so it
// is the one path where the typed union could be a lie. Anything that would
// reach handleBusEntry or deliver() as a fabricated event is refused here.
describe('parseBusEntry', () => {
  it('accepts a well-formed project and account envelope', () => {
    expect(parseBusEntry(entry)).toEqual(entry);
    const account = { type: 'user_updated', project_id: null, data: { id: 'u1' } };
    expect(parseBusEntry(account)).toEqual(account);
  });

  it('refuses a type outside the catalog', () => {
    expect(parseBusEntry({ type: 'task_exfiltrated', project_id: 'p1', data: {} })).toBeNull();
  });

  it('refuses a project id that disagrees with the event scope', () => {
    expect(
      parseBusEntry({ type: 'task_deleted', project_id: null, data: { id: 't1' } })
    ).toBeNull();
    expect(
      parseBusEntry({ type: 'user_updated', project_id: 'p1', data: { id: 'u1' } })
    ).toBeNull();
  });

  it('refuses anything that is not an envelope carrying an object payload', () => {
    expect(parseBusEntry(null)).toBeNull();
    expect(parseBusEntry('task_deleted')).toBeNull();
    expect(parseBusEntry({ type: 'task_deleted', project_id: 'p1' })).toBeNull();
    expect(parseBusEntry({ type: 'task_deleted', project_id: 'p1', data: 'nope' })).toBeNull();
  });
});
