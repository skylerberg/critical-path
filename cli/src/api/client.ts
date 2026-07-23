import createClient from 'openapi-fetch';
import type { Client, Middleware } from 'openapi-fetch';
import type { paths } from './api.generated';

export type Api = Client<paths>;

export interface ApiOptions {
  baseUrl: string;
  getToken: () => string | null;
  fetch?: (request: Request) => Promise<Response>;
}

export function createApi(options: ApiOptions): Api {
  const client = createClient<paths>({ baseUrl: options.baseUrl, fetch: options.fetch });
  const bearerAuth: Middleware = {
    onRequest({ request }) {
      const token = options.getToken();
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
    },
  };
  client.use(bearerAuth);
  return client;
}
