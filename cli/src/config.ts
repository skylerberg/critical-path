import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliError, EXIT } from './api/errors';

export interface CliConfig {
  api_url?: string;
  default_project?: string;
  web_url?: string;
}

export const CONFIG_KEYS = {
  'api-url': 'api_url',
  'default-project': 'default_project',
  'web-url': 'web_url',
} as const;

export type ConfigKey = keyof typeof CONFIG_KEYS;

export const DEFAULT_API_URL = 'https://criticalpath.skylerberg.com';
export const DEFAULT_WEB_URL = 'https://criticalpath.skylerberg.com';

// A path is appended to this, so a value that cannot precede one has to fail here
// rather than silently produce an unusable link — or one carrying credentials.
export function normalizeWebUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliError(`Invalid web URL "${value}"; use an absolute http(s) URL`, EXIT.usage);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliError(`Invalid web URL "${value}"; use an absolute http(s) URL`, EXIT.usage);
  }
  if (
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new CliError(
      `Invalid web URL "${value}"; a link base carries no query, fragment or credentials`,
      EXIT.usage
    );
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

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

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Unique per process so two concurrent writers cannot clobber each other's temp file.
  const tmp = `${path}.${String(process.pid)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

export async function saveConfig(configDir: string, config: CliConfig): Promise<void> {
  await writeJsonAtomic(configPath(configDir), config);
}
