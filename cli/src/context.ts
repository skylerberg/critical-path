import { createApi, type Api } from './api/client';
import { createCredentialStore, type CredentialStore } from './credentials/store';
import { loadConfig, resolveConfigDir, DEFAULT_API_URL, type CliConfig } from './config';
import { Output, type Writer } from './output';

export interface CliDeps {
  env: Record<string, string | undefined>;
  platform: string;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout: Writer;
  stderr: Writer;
  fetch?: (request: Request) => Promise<Response>;
  credentials?: CredentialStore;
}

export interface GlobalFlags {
  json: boolean;
  apiUrl?: string;
  noInput: boolean;
  color: boolean;
}

export interface RuntimeContext {
  deps: CliDeps;
  api: Api;
  baseUrl: string;
  credentials: CredentialStore;
  config: CliConfig;
  configDir: string;
  token: string | null;
  tokenFromEnv: boolean;
  out: Output;
  noInput: boolean;
}

export async function createContext(deps: CliDeps, flags: GlobalFlags): Promise<RuntimeContext> {
  const configDir = resolveConfigDir(deps.env);
  const config = await loadConfig(configDir);
  const baseUrl = (
    flags.apiUrl ??
    deps.env.CRITICAL_PATH_API_URL ??
    config.api_url ??
    DEFAULT_API_URL
  ).replace(/\/+$/, '');
  const credentials = deps.credentials ?? createCredentialStore(deps.platform, configDir);
  const envToken = deps.env.CRITICAL_PATH_TOKEN;
  const token = envToken ?? (await credentials.get(baseUrl));
  const api = createApi({ baseUrl, getToken: () => token, fetch: deps.fetch });
  const color = flags.color && !deps.env.NO_COLOR && deps.stdout.isTTY === true;
  const out = new Output({ stdout: deps.stdout, stderr: deps.stderr, json: flags.json, color });
  return {
    deps,
    api,
    baseUrl,
    credentials,
    config,
    configDir,
    token,
    tokenFromEnv: envToken != null,
    out,
    noInput: flags.noInput,
  };
}
