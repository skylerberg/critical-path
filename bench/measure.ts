import pg from 'pg';

export interface QueryRecord {
  text: string;
  values: unknown[];
  ms: number;
}

let sink: QueryRecord[] | null = null;
let patched = false;

function queryText(argument: unknown): string {
  if (typeof argument === 'string') return argument;
  const text = (argument as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text : '<unknown>';
}

// Kept alongside the text so a slow statement can be re-run under EXPLAIN with
// the arguments it actually had. Explaining a parameterized query with guessed
// values reports a plan the request never used.
function queryValues(args: unknown[]): unknown[] {
  const embedded = (args[0] as { values?: unknown } | null)?.values;
  if (Array.isArray(embedded)) return embedded;
  return Array.isArray(args[1]) ? args[1] : [];
}

// Counting at the pg client rather than through Kysely's `log` option: the app
// builds its Kysely instance at module scope, so by the time a benchmark can
// reach it the only seam left is the driver underneath. This is what separates
// "the endpoint got slower because the data grew" from "the endpoint started
// issuing a query per row".
export function instrumentQueries(): void {
  if (patched) return;
  patched = true;

  const prototype = pg.Client.prototype as unknown as {
    query: (...args: unknown[]) => unknown;
  };
  const original = prototype.query;

  prototype.query = function instrumentedQuery(this: unknown, ...args: unknown[]): unknown {
    const active = sink;
    if (!active) {
      return original.apply(this, args);
    }
    const started = performance.now();
    const record = (): void => {
      active.push({
        text: queryText(args[0]),
        values: queryValues(args),
        ms: performance.now() - started,
      });
    };

    const result = original.apply(this, args);
    // The callback form hands back a Query object rather than a promise, and
    // pg's own internals use it; timing only the promise form keeps this from
    // changing what any caller receives.
    if (result !== null && typeof (result as PromiseLike<unknown>)?.then === 'function') {
      return (result as Promise<unknown>).then(
        (value) => {
          record();
          return value;
        },
        (error: unknown) => {
          record();
          throw error;
        }
      );
    }
    record();
    return result;
  };
}

export async function recordQueries<T>(work: () => Promise<T>): Promise<[T, QueryRecord[]]> {
  const previous = sink;
  const collected: QueryRecord[] = [];
  sink = collected;
  try {
    return [await work(), collected];
  } finally {
    sink = previous;
  }
}

export interface Stats {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export function summarize(samples: number[]): Stats {
  if (samples.length === 0) {
    return { count: 0, min: 0, p50: 0, p95: 0, max: 0, mean: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  // Nearest-rank, so a p95 is always a sample that actually happened rather
  // than an interpolation between two that did not.
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
  return {
    count: sorted.length,
    min: sorted[0]!,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
  };
}

export function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  if (value >= 10) return `${value.toFixed(0)}ms`;
  return `${value.toFixed(1)}ms`;
}

export function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)}KB`;
  return `${String(value)}B`;
}
