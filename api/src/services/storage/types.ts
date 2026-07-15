export interface StorageProvider {
  // contentType is unused by the disk driver but part of the contract so an
  // object-storage driver can set it without changing call sites.
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  copy(sourceKey: string, destKey: string): Promise<void>;
  delete(key: string): Promise<void>;
}
