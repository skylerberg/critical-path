function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

const rawEnvironment = process.env.ENVIRONMENT;
const environment: 'development' | 'test' | 'production' =
  rawEnvironment === 'production'
    ? 'production'
    : rawEnvironment === 'test'
      ? 'test'
      : 'development';

export const env = {
  port: parseIntOrDefault(process.env.PORT, 3001),
  environment,

  db: {
    hostname: process.env.DB_HOSTNAME || '127.0.0.1',
    port: parseIntOrDefault(process.env.DB_PORT, 5432),
    database: process.env.DB_DATABASE || 'game_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    caCertPath: process.env.DB_CA_CERT_PATH,
  },

  storageDriver: process.env.STORAGE_DRIVER || 'disk',
  storageDiskRoot: process.env.STORAGE_DISK_ROOT || './data/uploads',

  logFormat: process.env.LOG_FORMAT,

  sessionTtlDays: parseIntOrDefault(process.env.SESSION_TTL_DAYS, 30),

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Getter so tests can toggle process.env.SIGNUP_ENABLED at runtime.
  get signupEnabled(): boolean {
    const raw = process.env.SIGNUP_ENABLED?.trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return environment !== 'production';
  },
};
