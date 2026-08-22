import { vi } from 'vitest';

// openapi-fetch captures globalThis.fetch and globalThis.Request when client.ts
// is evaluated, so this module must be imported before anything that imports the
// client. Node's Request rejects the relative URLs produced by baseUrl: '', hence
// the resolving subclass.
class RelativeRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(
      typeof input === 'string' && input.startsWith('/') ? `http://localhost${input}` : input,
      init
    );
  }
}

// Node 25's built-in webstorage stub (methodless without --localstorage-file)
// shadows jsdom's working implementation in the vitest environment.
class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, value);
  }
}

export const fetchMock = vi.fn<typeof fetch>();

vi.stubGlobal('Request', RelativeRequest);
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('localStorage', new MemoryStorage());
vi.stubGlobal('sessionStorage', new MemoryStorage());

export function jsonResponse(status: number, body?: unknown): Response {
  if (body === undefined) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function requestAt(callIndex: number): Request {
  const call = fetchMock.mock.calls[callIndex];
  if (!call) {
    throw new Error(`No fetch call at index ${String(callIndex)}`);
  }
  return call[0] as Request;
}
