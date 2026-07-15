import { promises as fs } from 'fs';
import path from 'path';
import { isValidUuid } from '../../types/uuid';
import type { StorageProvider } from './types';

export class DiskStorageProvider implements StorageProvider {
  constructor(private root: string) {}

  // Keys are server-generated UUIDs; the regex check is path-traversal
  // defense in depth.
  private resolveKey(key: string): string {
    if (!isValidUuid(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const filePath = this.resolveKey(key);
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolveKey(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    const destPath = this.resolveKey(destKey);
    await fs.mkdir(this.root, { recursive: true });
    await fs.copyFile(this.resolveKey(sourceKey), destPath);
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveKey(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }
}
