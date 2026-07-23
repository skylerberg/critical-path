import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  deliverLocal,
  publish,
  resetBus,
  setRemotePublisher,
  subscribeBus,
} from '../../src/services/realtime/bus';
import type { BusEntry } from '../../src/services/realtime/bus';

const entry: BusEntry = { type: 'task_updated', project_id: 'p1', data: { id: 't1' } };

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
