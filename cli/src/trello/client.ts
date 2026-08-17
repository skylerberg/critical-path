const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly method: string,
    readonly path: string
  ) {
    super(`${method} ${path} -> ${String(status)}: ${body.slice(0, 400)}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class CriticalPathClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private async send(
    method: string,
    path: string,
    init: { json?: unknown; body?: Buffer; contentType?: string } = {}
  ): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    let body: string | Uint8Array | undefined;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    } else if (init.body !== undefined) {
      headers['Content-Type'] = init.contentType ?? 'application/octet-stream';
      body = new Uint8Array(init.body);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, { method, headers, body });
        if (response.ok) {
          if (response.status === 204) return null;
          const text = await response.text();
          return text === '' ? null : JSON.parse(text);
        }
        const text = await response.text();
        if (!RETRY_STATUSES.has(response.status)) {
          throw new ApiError(response.status, text, method, path);
        }
        lastError = new ApiError(response.status, text, method, path);
      } catch (error) {
        if (error instanceof ApiError && !RETRY_STATUSES.has(error.status)) throw error;
        lastError = error;
      }
      if (attempt < MAX_ATTEMPTS) await sleep(2 ** attempt * 250);
    }
    throw lastError;
  }

  get(path: string): Promise<unknown> {
    return this.send('GET', path);
  }

  post(path: string, json: unknown): Promise<unknown> {
    return this.send('POST', path, { json });
  }

  put(path: string, json: unknown): Promise<unknown> {
    return this.send('PUT', path, { json });
  }

  delete(path: string): Promise<unknown> {
    return this.send('DELETE', path);
  }

  upload(path: string, body: Buffer, contentType: string): Promise<unknown> {
    return this.send('POST', path, { body, contentType });
  }

  // Every create carries a client-chosen id, so a 409 means this exact row was
  // written by an earlier run of this import. Skipping it is what makes a
  // two-thousand-request job resumable after a failure anywhere in the middle.
  async createIdempotent(path: string, json: unknown): Promise<'created' | 'existed'> {
    try {
      await this.post(path, json);
      return 'created';
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) return 'existed';
      throw error;
    }
  }
}

export async function inParallel<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  let next = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]!, index);
      done += 1;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(runners);
}
