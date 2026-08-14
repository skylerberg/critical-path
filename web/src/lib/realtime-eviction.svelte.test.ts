import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { board } from './board.svelte';
import { connectivity } from './connectivity.svelte';
import { realtime } from './realtime.svelte';
import { session } from './session.svelte';

// The account holds more sockets than it is allowed and this was the oldest, as
// against an ordinary drop, which every case below pairs itself with: "it did
// not reconnect" says nothing until the same harness is shown reconnecting.
const EVICTED = 4429;
const DROPPED = 1006;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.onclose?.({ code });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

vi.stubGlobal('WebSocket', FakeWebSocket);

function sockets(): number {
  return FakeWebSocket.instances.length;
}

function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) {
    throw new Error('no socket created');
  }
  return socket;
}

async function connectAndAuth(): Promise<FakeWebSocket> {
  board.currentProjectId = 'p1';
  realtime.connect();
  // Before the close, not after: the connectivity effect's first run calls
  // #reconnectNow, and flushed later it reconnects on the test's behalf and
  // leaves every assertion below measuring nothing.
  flushSync();
  const socket = latestSocket();
  socket.open();
  socket.receive({ type: 'auth_ok' });
  await Promise.resolve();
  return socket;
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

function lookAtTheTab(): void {
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(async () => {
  vi.useRealTimers();
  fetchMock.mockReset();
  FakeWebSocket.instances = [];
  realtime.disconnect();
  board.reset();
  connectivity.resetForTests();
  setVisibility('visible');
  localStorage.setItem('cp.token', 'test-token');
  fetchMock.mockResolvedValue(
    jsonResponse(200, {
      id: 'u1',
      name: 'Me',
      email: 'm@e.com',
      avatar_url: null,
      email_verified: false,
    })
  );
  await session.init();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(200, {}));
});

afterEach(() => {
  realtime.disconnect();
  setVisibility('visible');
  vi.useRealTimers();
});

describe('a socket evicted because the account holds too many', () => {
  it('does not take another of the account’s slots straight back', async () => {
    const socket = await connectAndAuth();
    vi.useFakeTimers();

    socket.serverClose(EVICTED);
    vi.advanceTimersByTime(29_000);

    expect(sockets()).toBe(1);
    expect(realtime.evicted).toBe(true);
  });

  // The control for the case above. The eviction path is only worth anything if
  // this harness reconnects at all, and it is the reset on the connection that
  // just ended that puts the ordinary wait back at one second.
  it('still reconnects a second later after an ordinary drop', async () => {
    const socket = await connectAndAuth();
    vi.useFakeTimers();

    socket.serverClose(DROPPED);
    vi.advanceTimersByTime(1000);

    expect(sockets()).toBe(2);
    expect(realtime.evicted).toBe(false);
  });

  it('tries again at the longest wait it has, once the slot may have freed', async () => {
    const socket = await connectAndAuth();
    vi.useFakeTimers();

    socket.serverClose(EVICTED);
    vi.advanceTimersByTime(30_000);

    expect(sockets()).toBe(2);
  });

  it('stops saying so once live updates are back', async () => {
    const socket = await connectAndAuth();
    vi.useFakeTimers();
    socket.serverClose(EVICTED);
    expect(realtime.evicted).toBe(true);

    vi.advanceTimersByTime(30_000);
    const next = latestSocket();
    next.open();
    next.receive({ type: 'auth_ok' });

    expect(realtime.evicted).toBe(false);
  });

  // Otherwise one eviction leaves the tab on the long wait, and the indicator
  // blaming the ceiling, for the rest of the session.
  it('stops blaming the ceiling once an ordinary close proves otherwise', async () => {
    const socket = await connectAndAuth();
    vi.useFakeTimers();
    socket.serverClose(EVICTED);
    vi.advanceTimersByTime(30_000);

    connectivity.noteUnreachable();
    latestSocket().serverClose(DROPPED);
    expect(realtime.evicted).toBe(false);

    // The flag is what held #reconnectNow shut, so the network returning being
    // news again is the observable half of clearing it.
    connectivity.noteReached();
    flushSync();
    expect(sockets()).toBe(3);
  });
});

describe('an evicted tab nobody is looking at', () => {
  it('waits to be looked at rather than on any timer', async () => {
    setVisibility('hidden');
    const socket = await connectAndAuth();
    vi.useFakeTimers();

    socket.serverClose(EVICTED);
    vi.advanceTimersByTime(300_000);

    expect(sockets()).toBe(1);
  });

  // The control: hidden is not by itself a reason this harness stops opening
  // sockets, so the case above is about the close code and not the visibility.
  it('reconnects on a timer as usual when the close was an ordinary one', async () => {
    setVisibility('hidden');
    const socket = await connectAndAuth();
    vi.useFakeTimers();

    socket.serverClose(DROPPED);
    vi.advanceTimersByTime(1000);

    expect(sockets()).toBe(2);
  });

  it('reconnects the moment someone returns to it', async () => {
    setVisibility('hidden');
    const socket = await connectAndAuth();
    socket.serverClose(EVICTED);
    expect(sockets()).toBe(1);

    lookAtTheTab();

    expect(sockets()).toBe(2);
  });

  it('drops the visibility listener on disconnect', async () => {
    setVisibility('hidden');
    const socket = await connectAndAuth();
    socket.serverClose(EVICTED);

    realtime.disconnect();
    lookAtTheTab();

    expect(sockets()).toBe(1);
    expect(realtime.evicted).toBe(false);
  });
});

describe('connectivity news reaching an evicted tab', () => {
  it('is not news: the server was answering all along', async () => {
    const socket = await connectAndAuth();
    connectivity.noteUnreachable();
    socket.serverClose(EVICTED);
    expect(sockets()).toBe(1);

    connectivity.noteReached();
    flushSync();

    expect(sockets()).toBe(1);
  });

  // The control for the case above, and the behaviour it must not cost: an
  // ordinary drop still shortcuts the whole wait the moment anything reaches
  // the server.
  it('shortcuts the wait after an ordinary drop', async () => {
    const socket = await connectAndAuth();
    connectivity.noteUnreachable();
    socket.serverClose(DROPPED);
    expect(sockets()).toBe(1);

    connectivity.noteReached();
    flushSync();

    expect(sockets()).toBe(2);
  });
});
