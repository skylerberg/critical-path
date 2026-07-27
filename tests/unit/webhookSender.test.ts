import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  MAX_ERROR_BODY_BYTES,
  SEND_TIMEOUT_MS,
  sendDelivery,
  type DeliveryRow,
  type TargetPolicy,
} from '../../src/services/webhooks/index';

const permissive: TargetPolicy = { allowPrivate: true, requireHttps: false };

describe('sendDelivery against a receiver that will not finish', () => {
  let server: http.Server;
  let port: number;
  let open: http.ServerResponse[] = [];
  let handler: (res: http.ServerResponse) => void = (res) => res.end('ok');

  const delivery = {
    id: '00000000-0000-4000-8000-000000000001',
    event_type: 'task_created',
    payload: { hello: 'world' },
  } as unknown as DeliveryRow;

  function send(): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
    return sendDelivery({
      url: `http://127.0.0.1:${String(port)}/hook`,
      secret: 'shhh',
      webhookId: '00000000-0000-4000-8000-0000000000ff',
      delivery,
      policy: permissive,
    });
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          open.push(res);
          handler(res);
        });
      });
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(() => {
    for (const res of open) res.destroy();
    open = [];
    handler = (res) => res.end('ok');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it(
    'gives up on a trickling receiver that never lets the socket go idle',
    async () => {
      handler = (res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        const beat = setInterval(() => res.write('.'), SEND_TIMEOUT_MS / 20);
        res.on('close', () => clearInterval(beat));
      };

      const started = Date.now();
      const result = await send();

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Timed out/);
      expect(Date.now() - started).toBeLessThan(SEND_TIMEOUT_MS * 2);
    },
    SEND_TIMEOUT_MS * 3
  );

  it('settles as soon as an oversized error body hits the cap', async () => {
    handler = (res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.write('x'.repeat(MAX_ERROR_BODY_BYTES * 2));
    };

    const started = Date.now();
    const result = await send();

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error?.length).toBeLessThanOrEqual(MAX_ERROR_BODY_BYTES + 64);
    expect(Date.now() - started).toBeLessThan(SEND_TIMEOUT_MS);
  });
});
