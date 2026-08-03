import { createWriteStream, promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';
import path from 'path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isValidUuid } from '../../types/uuid';
import type { StorageProvider, StoredObject } from './types';

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

  async putStream(key: string, data: Readable, _contentType: string): Promise<void> {
    const filePath = this.resolveKey(key);
    await fs.mkdir(this.root, { recursive: true });
    await pipeline(data, createWriteStream(filePath));
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

  // Measures the open descriptor rather than the path, so the size cannot
  // describe a different file than the one that streams.
  async getStream(key: string): Promise<StoredObject | null> {
    let handle: FileHandle;
    try {
      handle = await fs.open(this.resolveKey(key), 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }

    try {
      const { size } = await handle.stat();
      return { stream: handle.createReadStream(), size };
    } catch (err) {
      await handle.close();
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
