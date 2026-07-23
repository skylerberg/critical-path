import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { CredentialStore } from './store';

export class FileStore implements CredentialStore {
  #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  #path(): string {
    return join(this.#dir, 'credentials.json');
  }

  async #read(): Promise<Record<string, string>> {
    let raw: string;
    try {
      raw = await readFile(this.#path(), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw err;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }

  async #write(map: Record<string, string>): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    const path = this.#path();
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
  }

  async get(baseUrl: string): Promise<string | null> {
    const map = await this.#read();
    return map[baseUrl] ?? null;
  }

  async set(baseUrl: string, token: string): Promise<void> {
    const map = await this.#read();
    map[baseUrl] = token;
    await this.#write(map);
  }

  async delete(baseUrl: string): Promise<void> {
    const map = await this.#read();
    if (baseUrl in map) {
      delete map[baseUrl];
      await this.#write(map);
    }
  }
}
