import { env } from '../../config/env';
import { DiskStorageProvider } from './disk';
import { GcsStorageProvider } from './gcs';
import type { StorageProvider } from './types';

function createStorageProvider(): StorageProvider {
  switch (env.storageDriver) {
    case 'disk':
      return new DiskStorageProvider(env.storageDiskRoot);
    case 'gcs':
      if (!env.storageGcsBucket) {
        throw new Error('STORAGE_GCS_BUCKET is required when STORAGE_DRIVER=gcs');
      }
      return new GcsStorageProvider(env.storageGcsBucket);
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${env.storageDriver}`);
  }
}

export const storage: StorageProvider = createStorageProvider();
export type { StorageProvider } from './types';
