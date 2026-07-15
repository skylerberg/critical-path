import { env } from '../../config/env';
import { DiskStorageProvider } from './disk';
import type { StorageProvider } from './types';

function createStorageProvider(): StorageProvider {
  switch (env.storageDriver) {
    case 'disk':
      return new DiskStorageProvider(env.storageDiskRoot);
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${env.storageDriver}`);
  }
}

export const storage: StorageProvider = createStorageProvider();
export type { StorageProvider } from './types';
