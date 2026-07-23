import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliError, EXIT } from './api/errors';

export interface CliConfig {
  api_url?: string;
  default_project?: string;
}

export const CONFIG_KEYS = {
  'api-url': 'api_url',
  'default-project': 'default_project',
} as const;

export type ConfigKey = keyof typeof CONFIG_KEYS;

export const DEFAULT_API_URL = 'http://localhost:3001';

export function resolveConfigDir(env: Record<string, string | undefined>): string {
  if (env.CRITICAL_PATH_CONFIG_DIR) {
    return env.CRITICAL_PATH_CONFIG_DIR;
  }
  const base = env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'critical-path');
}

export function configPath(configDir: string): string {
  return join(configDir, 'config.json');
}

export async function loadConfig(configDir: string): Promise<CliConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath(configDir), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(`Invalid JSON in ${configPath(configDir)}; fix or delete it`, EXIT.failure);
  }
  return typeof parsed === 'object' && parsed !== null ? (parsed as CliConfig) : {};
}

export async function saveConfig(configDir: string, config: CliConfig): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const path = configPath(configDir);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}
