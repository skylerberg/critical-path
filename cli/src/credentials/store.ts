import { KeychainStore } from './keychain';
import { FileStore } from './fileStore';

export interface CredentialStore {
  get(baseUrl: string): Promise<string | null>;
  set(baseUrl: string, token: string): Promise<void>;
  delete(baseUrl: string): Promise<void>;
}

export function createCredentialStore(platform: string, configDir: string): CredentialStore {
  return platform === 'darwin' ? new KeychainStore() : new FileStore(configDir);
}
