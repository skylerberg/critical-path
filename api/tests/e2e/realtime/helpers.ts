import WebSocket from 'ws';

export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export interface Envelope {
  type: string;
  project_id: string | null;
  data: Record<string, unknown>;
}

export class RtClient {
  readonly events: Envelope[] = [];
  closeInfo: { code: number; reason: string } | null = null;

  private constructor(private ws: WebSocket) {}

  static connect(port: number, token: string): Promise<RtClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const client = new RtClient(ws);
      ws.on('error', reject);
      ws.on('close', (code, reason) => {
        client.closeInfo = { code, reason: String(reason) };
      });
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', (raw) => {
        const message = JSON.parse(String(raw)) as Envelope;
        if (message.type === 'auth_ok') {
          resolve(client);
          return;
        }
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        client.events.push(message);
      });
    });
  }

  subscribe(projectId: string): void {
    this.ws.send(JSON.stringify({ type: 'subscribe', project_id: projectId }));
  }

  async waitForEvent(predicate: (event: Envelope) => boolean, timeoutMs = 4000): Promise<Envelope> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = this.events.find(predicate);
      if (match) return match;
      if (Date.now() > deadline) {
        const seen = this.events.map((event) => event.type).join(', ') || 'none';
        throw new Error(`No matching event before timeout; saw: ${seen}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  eventsOfType(type: string): Envelope[] {
    return this.events.filter((event) => event.type === type);
  }

  close(): void {
    this.ws.close();
  }
}

// Delivery runs in unawaited post-commit hooks, so silence can only be
// asserted after giving in-flight deliveries time to land.
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}
