import { app } from '../../src/index';
import { db } from '../../src/db/index';
import { SIGNUP_IP_MAX_ATTEMPTS } from '../../src/middleware/rateLimit';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  password: string;
  token: string;
}

export class TestContext {
  private users: TestUser[] = [];

  async createUser(prefix: string, userAgent?: string): Promise<TestUser> {
    const id = crypto.randomUUID();
    const email = `${prefix}-${crypto.randomUUID()}@test.example.com`;
    const password = 'test-password-123';
    const name = `${prefix} user`;

    const res = await this.request(undefined, userAgent).post('/api/auth/signup', {
      id,
      email,
      password,
      name,
    });
    if (res.status !== 201) {
      throw new Error(
        `Test signup failed: ${res.status} ${await res.text()}` +
          (res.status === 429
            ? `. Every test request presents the same source IP, so account creation across ` +
              `the whole file shares one budget of ${SIGNUP_IP_MAX_ATTEMPTS}; a file that ` +
              `needs more accounts than that has to call resetRateLimiter() between tests.`
            : '')
      );
    }
    const body = (await res.json()) as { token: string };

    const user: TestUser = { id, email, name, password, token: body.token };
    this.users.push(user);
    return user;
  }

  async cleanup(): Promise<void> {
    const ids = this.users.map((u) => u.id);
    if (ids.length > 0) {
      // project.created_by is ON DELETE RESTRICT, so owned projects must go first.
      await db.deleteFrom('project').where('created_by', 'in', ids).execute();
      await db.deleteFrom('app_user').where('id', 'in', ids).execute();
    }
    this.users = [];
  }

  request(token?: string, userAgent?: string, forwardedFor?: string): TestApiClient {
    return new TestApiClient(token, userAgent, forwardedFor);
  }
}

export class TestApiClient {
  constructor(
    private token?: string,
    private userAgent?: string,
    private forwardedFor?: string
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.userAgent !== undefined) {
      headers['User-Agent'] = this.userAgent;
    }
    if (this.forwardedFor !== undefined) {
      headers['X-Forwarded-For'] = this.forwardedFor;
    }

    return headers;
  }

  private async makeRequest(method: string, path: string, body?: unknown): Promise<Response> {
    return app.request(path, {
      method,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  get(path: string): Promise<Response> {
    return this.makeRequest('GET', path);
  }

  post(path: string, body?: unknown): Promise<Response> {
    return this.makeRequest('POST', path, body);
  }

  put(path: string, body: unknown): Promise<Response> {
    return this.makeRequest('PUT', path, body);
  }

  patch(path: string, body: unknown): Promise<Response> {
    return this.makeRequest('PATCH', path, body);
  }

  delete(path: string, body?: unknown): Promise<Response> {
    return this.makeRequest('DELETE', path, body);
  }

  // For JSON that JSON.stringify cannot produce, e.g. 1e999 (Infinity).
  async sendRawJson(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    rawBody: string
  ): Promise<Response> {
    return app.request(path, {
      method,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: rawBody,
    });
  }

  async postMultipart(path: string, formData: FormData): Promise<Response> {
    return app.request(path, {
      method: 'POST',
      headers: this.headers(),
      body: formData,
    });
  }
}
