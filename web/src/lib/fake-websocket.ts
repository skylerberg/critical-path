/**
 * The WebSocket every test gets, installed from `vitest-setup.ts`.
 *
 * jsdom's own really connects, and `realtime.svelte.ts` answers a failed
 * connection by reconnecting on a backoff — so a test that merely renders a
 * signed-in app leaves timers reopening a socket after the test that started it
 * has finished. That does not fail; it hangs, and the run has no way to say
 * which test did it. Installing this for everyone means a test can only reach a
 * real socket by asking for one.
 *
 * The far-end half — `open`, `receive`, `serverClose` — is what the realtime
 * tests drive. Three copies of this class used to sit in three test files, each
 * a slightly different subset, and a fourth test that needed one had no reason
 * to know they existed.
 */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  // `data` is unknown rather than string so `receiveRaw` can deliver the frames
  // a real socket can and `JSON.stringify` cannot.
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url = '') {
    this.url = url;
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

  // Delivers the frame verbatim, which is the only way to reach the guards
  // #onMessage opens with: a binary frame, one that is not JSON at all, one whose
  // type is not a string.
  receiveRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  serverClose(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  messages(): { type: string; [key: string]: unknown }[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }

  static last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (socket === undefined) {
      throw new Error('no socket created');
    }
    return socket;
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }
}
