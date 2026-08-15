import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { realtimeUrl, watchEvents, type Connect, type WatchHandlers } from '../../src/watch';
import { ApiError } from '../../src/api/errors';

interface FakeSocket {
  sent: string[];
  closed: boolean;
  open(): void;
  message(raw: string): void;
  close(code: number): void;
}

type LogEntry = ['send', string] | ['emit', string];

interface Harness {
  sockets: FakeSocket[];
  emitted: string[];
  notices: string[];
  log: LogEntry[];
  listProjectIds: ReturnType<typeof vi.fn>;
  revalidateSession: ReturnType<typeof vi.fn>;
  controller: AbortController;
  promise: Promise<void>;
  last(): FakeSocket;
}

interface StartOptions {
  projectId?: string | null;
  projectIds?: string[];
  listProjectIds?: () => Promise<string[]>;
  revalidateSession?: () => Promise<boolean>;
  signal?: AbortSignal;
}

function start(options: StartOptions = {}): Harness {
  const sockets: FakeSocket[] = [];
  const emitted: string[] = [];
  const notices: string[] = [];
  const log: LogEntry[] = [];
  const controller = new AbortController();
  const listProjectIds = vi.fn(options.listProjectIds ?? (() => Promise.resolve<string[]>([])));
  const revalidateSession = vi.fn(options.revalidateSession ?? (() => Promise.resolve(true)));

  const connect: Connect = (_url: string, handlers: WatchHandlers) => {
    const socket: FakeSocket = {
      sent: [],
      closed: false,
      open: () => handlers.onOpen(),
      message: (raw: string) => handlers.onMessage(raw),
      close: (code: number) => handlers.onClose(code),
    };
    sockets.push(socket);
    return {
      send: (data: string) => {
        socket.sent.push(data);
        log.push(['send', data]);
      },
      // Mirrors the real adapter, which detaches its handlers before closing and so
      // never produces an onClose for a socket the state machine closed itself.
      close: () => {
        socket.closed = true;
      },
    };
  };

  const promise = watchEvents({
    url: 'ws://localhost:3001/ws',
    token: 'tok',
    projectId: options.projectId ?? null,
    projectIds: options.projectIds ?? ['p1'],
    listProjectIds,
    revalidateSession,
    emit: (line) => {
      emitted.push(line);
      log.push(['emit', line]);
    },
    notify: (message) => notices.push(message),
    signal: options.signal ?? controller.signal,
    connect,
  });

  return {
    sockets,
    emitted,
    notices,
    log,
    listProjectIds,
    revalidateSession,
    controller,
    promise,
    last: () => sockets[sockets.length - 1],
  };
}

async function settleAndClose(h: Harness): Promise<void> {
  h.controller.abort();
  await h.promise;
}

const TASK_CREATED = '{"type":"task_created","project_id":"p1","data":{"id":"t1"}}';

describe('realtimeUrl', () => {
  it('maps http to ws and https to wss', () => {
    expect(realtimeUrl('http://localhost:3001')).toBe('ws://localhost:3001/ws');
    expect(realtimeUrl('https://criticalpath.skylerberg.com')).toBe(
      'wss://criticalpath.skylerberg.com/ws'
    );
  });
});

describe('watchEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('authenticates on open and emits nothing', async () => {
    const h = start();
    h.last().open();
    expect(h.last().sent).toEqual(['{"type":"auth","token":"tok"}']);
    expect(h.emitted).toEqual([]);
    await settleAndClose(h);
  });

  it('subscribes to every project id in order after auth_ok', async () => {
    const h = start({ projectIds: ['p1', 'p2', 'p3'] });
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    expect(h.last().sent.slice(1)).toEqual([
      '{"type":"subscribe","project_id":"p1"}',
      '{"type":"subscribe","project_id":"p2"}',
      '{"type":"subscribe","project_id":"p3"}',
    ]);
    expect(h.emitted).toEqual([]);
    await settleAndClose(h);
  });

  it('answers ping with pong and emits no control frames', async () => {
    const h = start();
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().message('{"type":"ping"}');
    h.last().message('{"type":"pong"}');
    expect(h.last().sent).toContain('{"type":"pong"}');
    expect(h.last().sent.filter((s) => s.includes('pong'))).toHaveLength(1);
    expect(h.emitted).toEqual([]);
    await settleAndClose(h);
  });

  it('emits the exact raw frame text it received', async () => {
    const h = start();
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().message(TASK_CREATED);
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toBe(TASK_CREATED);
    await settleAndClose(h);
  });

  it('emits unknown event types verbatim', async () => {
    const h = start();
    const frame = '{"type":"future_event","project_id":"p1","data":{"whatever":1},"extra":true}';
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().message(frame);
    expect(h.emitted).toEqual([frame]);
    await settleAndClose(h);
  });

  it('drops malformed frames with a notice and keeps streaming', async () => {
    const h = start();
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().message('not json at all');
    h.last().message('[1,2,3]');
    h.last().message('{"project_id":"p1"}');
    h.last().message(TASK_CREATED);
    expect(h.notices).toHaveLength(3);
    expect(h.emitted).toEqual([TASK_CREATED]);
    await settleAndClose(h);
  });

  it('drops events for other projects and null-project events when scoped', async () => {
    const h = start({ projectId: 'p1', projectIds: ['p1'] });
    const other = '{"type":"task_created","project_id":"p2","data":{"id":"t2"}}';
    const global = '{"type":"user_updated","project_id":null,"data":{"id":"u1"}}';
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().message(other);
    h.last().message(TASK_CREATED);
    h.last().message(global);
    expect(h.emitted).toEqual([TASK_CREATED]);
    await settleAndClose(h);
  });

  it('never subscribes to newly seen projects when scoped', async () => {
    const h = start({ projectId: 'p1', projectIds: ['p1'] });
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().message('{"type":"project_created","project_id":"p9","data":{"id":"p9"}}');
    expect(h.last().sent).toEqual([
      '{"type":"auth","token":"tok"}',
      '{"type":"subscribe","project_id":"p1"}',
    ]);
    expect(h.emitted).toEqual([]);
    await settleAndClose(h);
  });

  it('follows projects it learns about and drops ones that disappear', async () => {
    const h = start({
      projectIds: ['p1'],
      // Fail the reconnect re-list so the retained `tracked` set is what gets asserted.
      listProjectIds: () => Promise.reject(new Error('offline')),
    });
    const created = '{"type":"project_created","project_id":"p2","data":{"id":"p2"}}';
    const updatedKnown = '{"type":"project_updated","project_id":"p1","data":{"id":"p1"}}';
    const updatedNew = '{"type":"project_updated","project_id":"p3","data":{"id":"p3"}}';
    const deleted = '{"type":"project_deleted","project_id":"p2","data":{"id":"p2"}}';

    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().message(created);
    h.last().message(updatedKnown);
    h.last().message(updatedNew);
    h.last().message(deleted);

    expect(h.last().sent).toEqual([
      '{"type":"auth","token":"tok"}',
      '{"type":"subscribe","project_id":"p1"}',
      '{"type":"subscribe","project_id":"p2"}',
      '{"type":"subscribe","project_id":"p3"}',
      '{"type":"unsubscribe","project_id":"p2"}',
    ]);
    // The subscribe must precede the line so the window of missed events is smallest.
    const subscribedAt = h.log.findIndex(
      ([kind, text]) => kind === 'send' && text === '{"type":"subscribe","project_id":"p2"}'
    );
    const emittedAt = h.log.findIndex(([kind, text]) => kind === 'emit' && text === created);
    expect(subscribedAt).toBeGreaterThanOrEqual(0);
    expect(emittedAt).toBeGreaterThan(subscribedAt);

    // p2 was removed from the tracked set, so a reconnect does not resubscribe to it.
    h.last().close(1006);
    await vi.advanceTimersByTimeAsync(1000);
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.last().sent).toEqual([
      '{"type":"auth","token":"tok"}',
      '{"type":"subscribe","project_id":"p1"}',
      '{"type":"subscribe","project_id":"p3"}',
    ]);
    await settleAndClose(h);
  });

  it('reconnects with exponential backoff capped at 30 seconds', async () => {
    const h = start();
    h.last().close(1006);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(2);

    h.last().close(1006);
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(3);

    for (const delay of [4000, 8000, 16000, 30000, 30000]) {
      const before = h.sockets.length;
      h.last().close(1006);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.sockets).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.sockets).toHaveLength(before + 1);
    }
    await settleAndClose(h);
  });

  it('resets the backoff once a connection authenticates', async () => {
    const h = start();
    h.last().close(1006);
    await vi.advanceTimersByTimeAsync(1000);
    h.last().close(1006);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sockets).toHaveLength(3);

    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    await vi.advanceTimersByTimeAsync(0);

    h.last().close(1006);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(4);
    await settleAndClose(h);
  });

  it('re-lists projects only on reconnect and resubscribes to the fresh set', async () => {
    const h = start({
      projectIds: ['p1'],
      listProjectIds: () => Promise.resolve(['p1', 'p2']),
    });
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.listProjectIds).not.toHaveBeenCalled();

    h.last().close(1006);
    await vi.advanceTimersByTimeAsync(1000);
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    await vi.advanceTimersByTimeAsync(0);

    expect(h.listProjectIds).toHaveBeenCalledTimes(1);
    expect(h.last().sent).toEqual([
      '{"type":"auth","token":"tok"}',
      '{"type":"subscribe","project_id":"p1"}',
      '{"type":"subscribe","project_id":"p2"}',
    ]);
    expect(h.notices).toContain('Connection restored');
    await settleAndClose(h);
  });

  it('announces a gap that opened before the first connection ever authenticated', async () => {
    const h = start();
    h.last().close(1006);
    await vi.advanceTimersByTimeAsync(1000);
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    await vi.advanceTimersByTimeAsync(0);

    expect(h.notices).toContain('Connection restored');
    await settleAndClose(h);
  });

  it('announces no gap on a clean first connection', async () => {
    const h = start();
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    await vi.advanceTimersByTimeAsync(0);

    expect(h.notices).not.toContain('Connection restored');
    await settleAndClose(h);
  });

  it('keeps the previous subscriptions when the re-list fails', async () => {
    const h = start({
      projectIds: ['p1', 'p2'],
      listProjectIds: () => Promise.reject(new Error('network down')),
    });
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().close(1006);
    await vi.advanceTimersByTimeAsync(1000);
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    await vi.advanceTimersByTimeAsync(0);

    expect(h.last().sent).toEqual([
      '{"type":"auth","token":"tok"}',
      '{"type":"subscribe","project_id":"p1"}',
      '{"type":"subscribe","project_id":"p2"}',
    ]);
    expect(h.notices.some((n) => n.includes('network down'))).toBe(true);
    await settleAndClose(h);
  });

  it('exits with a 401 ApiError when a 4401 close is confirmed as revoked', async () => {
    const h = start({ revalidateSession: () => Promise.resolve(false) });
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().close(4401);

    const err = await h.promise.then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('stops rather than taking another of the account’s connections back', async () => {
    const h = start();
    h.last().open();
    h.last().message('{"type":"auth_ok"}');

    // Watched rather than awaited: a regression that reconnects instead of
    // stopping leaves this promise pending forever, and awaiting it would report
    // that as a 30s timeout — the one failure this repo tells you to re-run and
    // distrust. Settling within a tick is itself part of the contract.
    let outcome: unknown = 'still watching';
    void h.promise.then(
      () => {
        outcome = 'resolved';
      },
      (e: unknown) => {
        outcome = e;
      }
    );
    h.last().close(4429);
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome).toBeInstanceOf(ApiError);
    expect((outcome as ApiError).status).toBe(429);
    expect((outcome as ApiError).message).toMatch(/too many open realtime connections/);
    expect(h.revalidateSession).not.toHaveBeenCalled();

    // The whole point: no second socket, ever. Reconnecting here evicts another
    // of this account's clients, which reconnects and evicts this one back.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  // Control for the arm above: the same harness DOES come back on an ordinary
  // close, so "no second socket" cannot mean the harness simply stopped working.
  it('still reconnects after a close the server did not blame on the ceiling', async () => {
    const h = start();
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().close(1006);

    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    await settleAndClose(h);
  });

  it('reconnects when a 4401 close leaves the session still valid', async () => {
    const h = start({ revalidateSession: () => Promise.resolve(true) });
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().close(4401);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.notices.some((n) => n.includes('4401'))).toBe(true);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    await settleAndClose(h);
  });

  it('backs off across repeated 4401 closes instead of hot-looping', async () => {
    const h = start({ revalidateSession: () => Promise.resolve(true) });
    h.last().close(4401);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);

    h.last().close(4401);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(3);
    expect(h.revalidateSession).toHaveBeenCalledTimes(2);
    await settleAndClose(h);
  });

  it('treats a failed revalidation as a blip rather than hanging or rejecting', async () => {
    const h = start({ revalidateSession: () => Promise.reject(new Error('dns is down')) });
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.last().close(4401);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.notices.some((n) => n.includes('dns is down'))).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    await settleAndClose(h);
  });

  it('resolves without connecting when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const h = start({ signal: controller.signal });
    await h.promise;
    expect(h.sockets).toHaveLength(0);
  });

  it('closes the socket and schedules nothing when aborted', async () => {
    const h = start();
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    h.controller.abort();
    await h.promise;
    expect(h.sockets[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('resolves when aborted while waiting on the retry timer', async () => {
    const h = start();
    h.last().close(1006);
    h.controller.abort();
    await h.promise;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('resolves rather than rejecting when aborted mid-revalidation', async () => {
    let release: (valid: boolean) => void = () => {};
    const h = start({
      revalidateSession: () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    });
    h.last().open();
    h.last().close(4401);
    h.controller.abort();
    release(false);
    await expect(h.promise).resolves.toBeUndefined();
  });

  it('replaces a silent socket itself when no frame arrives for 90 seconds', async () => {
    const h = start();
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    const first = h.sockets[0];

    await vi.advanceTimersByTimeAsync(89_999);
    expect(first.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.closed).toBe(true);
    expect(h.notices.some((n) => n.includes('No frames'))).toBe(true);
    expect(h.sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    await settleAndClose(h);
  });

  it('re-arms the stale watchdog on every frame, control frames included', async () => {
    const h = start();
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    await vi.advanceTimersByTimeAsync(60_000);
    h.last().message('{"type":"ping"}');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets[0].closed).toBe(false);
    expect(h.sockets).toHaveLength(1);
    await settleAndClose(h);
  });

  it('ignores a late close and a late message from a socket the watchdog replaced', async () => {
    const h = start();
    h.last().open();
    h.last().message('{"type":"auth_ok"}');
    const orphan = h.sockets[0];

    await vi.advanceTimersByTimeAsync(90_000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);

    orphan.close(1006);
    orphan.message(TASK_CREATED);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(h.sockets).toHaveLength(2);
    expect(h.emitted).toEqual([]);
    await settleAndClose(h);
  });
});
