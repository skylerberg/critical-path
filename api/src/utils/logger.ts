// In production every entry is written as a single line of JSON so log
// collectors can parse each event as one searchable entry — passing a plain
// object to `console.*` instead pretty-prints it across many lines.

export interface LogFields {
  msg: string;
  [key: string]: unknown;
}

type ConsoleMethod = 'log' | 'warn' | 'error';
type Severity = 'INFO' | 'WARNING' | 'ERROR';

const logFormat: 'json' | 'pretty' = (() => {
  const explicit = process.env.LOG_FORMAT?.trim().toLowerCase();
  if (explicit === 'json' || explicit === 'pretty') return explicit;
  return process.env.ENVIRONMENT === 'production' ? 'json' : 'pretty';
})();

function safeStringify(entry: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(entry, (_key, value: unknown) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
  } catch {
    return JSON.stringify({ severity: 'ERROR', message: 'Failed to serialize log entry' });
  }
}

function write(method: ConsoleMethod, severity: Severity, fields: LogFields): void {
  const { msg, ...rest } = fields;
  if (logFormat === 'json') {
    console[method](safeStringify({ severity, message: msg, ...rest }));
  } else if (Object.keys(rest).length > 0) {
    console[method](msg, rest);
  } else {
    console[method](msg);
  }
}

export const logger = {
  info: (fields: LogFields) => write('log', 'INFO', fields),
  warn: (fields: LogFields) => write('warn', 'WARNING', fields),
  error: (fields: LogFields) => write('error', 'ERROR', fields),
};
