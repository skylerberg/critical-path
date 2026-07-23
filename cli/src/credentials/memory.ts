import type { CredentialStore } from './store';

export class MemoryStore implements CredentialStore {
  #map = new Map<string, string>();

  async get(baseUrl: string): Promise<string | null> {
    return this.#map.get(baseUrl) ?? null;
  }

  async set(baseUrl: string, token: string): Promise<void> {
    this.#map.set(baseUrl, token);
  }

  async delete(baseUrl: string): Promise<void> {
    this.#map.delete(baseUrl);
  }
}
