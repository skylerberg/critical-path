function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Strict where parseIntOrDefault is lenient, because these two decide which
// address the rate limiter believes. `TRUST_PROXY=1` reading as false, or a
// misspelled hop count quietly becoming 1, is a change to who shares a bucket
// with whom, and neither leaves a trace. `assertProxyConfig` makes that a boot
// failure rather than something noticed under load.
function parseStrictBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  const raw = value?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be "true" or "false", not ${JSON.stringify(value)}`);
}

function parseStrictHops(name: string, value: string | undefined, fallback: number): number {
  const raw = value?.trim();
  if (raw === undefined || raw === '') return fallback;
  // A whole number of entries counted from the right. Zero and below name no
  // entry at all, which would silently fall back to the socket address.
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`${name} must be a whole number of 1 or more, not ${JSON.stringify(value)}`);
  }
  return Number(raw);
}

const DEFAULT_SESSION_TTL_DAYS = 365;

// The session cookie carries the same lifetime, and browsers cap a cookie at
// 400 days (RFC 6265bis; Chrome and Firefox enforce it) and clamp without
// saying so. Past that the cookie and the row it mirrors keep different clocks,
// and the only symptom is an <img> on a board that 401s until some later read
// rebuilds the cookie — a fault that heals itself and that nobody would trace
// back to this variable. Refused at boot instead, where it costs one line.
const MAX_SESSION_TTL_DAYS = 400;

function parseStrictDays(name: string, value: string | undefined, fallback: number): number {
  const raw = value?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > MAX_SESSION_TTL_DAYS) {
    throw new Error(
      `${name} must be a whole number of days from 1 to ${MAX_SESSION_TTL_DAYS}, ` +
        `not ${JSON.stringify(value)}`
    );
  }
  return Number(raw);
}

// Reads both so a bad value fails at startup instead of on the first request
// that happens to be rate limited.
export function assertProxyConfig(): void {
  parseStrictBoolean('TRUST_PROXY', process.env.TRUST_PROXY, false);
  parseStrictHops('TRUST_PROXY_HOPS', process.env.TRUST_PROXY_HOPS, 1);
}

// Read at startup so a lifetime the cookie cannot carry fails the deploy rather
// than the first login of it.
export function assertSessionConfig(): void {
  parseStrictDays('SESSION_TTL_DAYS', process.env.SESSION_TTL_DAYS, DEFAULT_SESSION_TTL_DAYS);
}

// Every send runs inside a post-commit hook, where a throw is caught and logged
// and the request still answers 2xx. A deploy missing either of these therefore
// looks healthy while mailing nothing at all, so it has to fail at boot instead.
export function assertEmailConfig(): void {
  if ((process.env.EMAIL_DRIVER || 'console') !== 'ses') {
    return;
  }
  if (!process.env.SES_FROM_ADDRESS) {
    throw new Error('SES_FROM_ADDRESS is required when EMAIL_DRIVER=ses');
  }
  // The SDK reads a region from AWS_REGION or AWS_DEFAULT_REGION when SES_REGION
  // names none, and fails its first send with "Region is missing" when all three
  // are absent. Asserting the three together is what keeps a deployment that
  // supplies the region the AWS way working.
  if (!process.env.SES_REGION && !process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
    throw new Error(
      'SES_REGION (or AWS_REGION / AWS_DEFAULT_REGION) is required when EMAIL_DRIVER=ses'
    );
  }
}

type Environment = 'development' | 'test' | 'production';

function currentEnvironment(): Environment {
  const raw = process.env.ENVIRONMENT;
  return raw === 'production' ? 'production' : raw === 'test' ? 'test' : 'development';
}

export const env = {
  port: parseIntOrDefault(process.env.PORT, 3001),

  // Read per call like the getters below rather than frozen at import: a test
  // that sets ENVIRONMENT to reach a production-only branch used to assert
  // against the branch it was still on.
  get environment(): Environment {
    return currentEnvironment();
  },

  db: {
    hostname: process.env.DB_HOSTNAME || '127.0.0.1',
    port: parseIntOrDefault(process.env.DB_PORT, 5432),
    database: process.env.DB_DATABASE || 'critical_path',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    caCertPath: process.env.DB_CA_CERT_PATH,
    poolMax: parseIntOrDefault(process.env.DB_POOL_MAX, 10),
  },

  storageDriver: process.env.STORAGE_DRIVER || 'disk',
  storageDiskRoot: process.env.STORAGE_DISK_ROOT || './data/uploads',
  storageGcsBucket: process.env.STORAGE_GCS_BUCKET,

  redisUrl: process.env.REDIS_URL,

  logFormat: process.env.LOG_FORMAT,

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Getters so tests can toggle the underlying env vars at runtime.
  get trustProxy(): boolean {
    return parseStrictBoolean('TRUST_PROXY', process.env.TRUST_PROXY, false);
  },

  get trustProxyHops(): number {
    return parseStrictHops('TRUST_PROXY_HOPS', process.env.TRUST_PROXY_HOPS, 1);
  },

  get sessionTtlDays(): number {
    return parseStrictDays(
      'SESSION_TTL_DAYS',
      process.env.SESSION_TTL_DAYS,
      DEFAULT_SESSION_TTL_DAYS
    );
  },

  get attachmentMaxBytes(): number {
    return parseIntOrDefault(process.env.ATTACHMENT_MAX_BYTES, 50 * 1024 * 1024);
  },

  get projectStorageQuotaBytes(): number {
    return parseIntOrDefault(process.env.PROJECT_STORAGE_QUOTA_BYTES, 1024 * 1024 * 1024);
  },

  get passwordResetSecret(): string {
    const secret = process.env.PASSWORD_RESET_SECRET;
    if (secret) return secret;
    if (currentEnvironment() === 'production') {
      throw new Error('PASSWORD_RESET_SECRET is required in production');
    }
    return 'dev-only-password-reset-secret';
  },

  // Falls back to the reset secret so no new production secret is required;
  // rotating that one therefore also invalidates outstanding email links.
  get emailTokenSecret(): string {
    return process.env.EMAIL_TOKEN_SECRET || env.passwordResetSecret;
  },

  get appUrlBase(): string {
    return process.env.APP_URL_BASE || 'http://localhost:5173';
  },

  get emailDriver(): string {
    return process.env.EMAIL_DRIVER || 'console';
  },

  get feedbackEmailAddress(): string {
    return process.env.FEEDBACK_EMAIL_ADDRESS || 'criticalpath@skylerberg.com';
  },

  get sesRegion(): string | undefined {
    return process.env.SES_REGION;
  },

  get sesFromAddress(): string | undefined {
    return process.env.SES_FROM_ADDRESS;
  },
};
