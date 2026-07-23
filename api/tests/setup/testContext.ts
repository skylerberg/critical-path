import { app } from '../../src/index';
import { db } from '../../src/db/index';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  password: string;
  token: string;
}

export class TestContext {
  private users: TestUser[] = [];

  async createUser(prefix: string): Promise<TestUser> {
    const id = crypto.randomUUID();
    const email = `${prefix}-${crypto.randomUUID()}@test.example.com`;
    const password = 'test-password-123';
    const name = `${prefix} user`;

    const res = await this.request().post('/api/auth/signup', { id, email, password, name });
    if (res.status !== 201) {
      throw new Error(`Test signup failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { token: string };

    const user: TestUser = { id, email, name, password, token: body.token };
    this.users.push(user);
    return user;
  }

  async cleanup(): Promise<void> {
    const ids = this.users.map((u) => u.id);
    if (ids.length > 0) {
      await db.deleteFrom('app_user').where('id', 'in', ids).execute();
    }
    this.users = [];
  }

  request(token?: string): TestApiClient {
    return new TestApiClient(token);
  }
}

export class TestApiClient {
  constructor(private token?: string) {}

  private async makeRequest(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return app.request(path, {
      method,
      headers,
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

  delete(path: string): Promise<Response> {
    return this.makeRequest('DELETE', path);
  }

  async postMultipart(path: string, formData: FormData): Promise<Response> {
    const headers: Record<string, string> = {};

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return app.request(path, {
      method: 'POST',
      headers,
      body: formData,
    });
  }
}
