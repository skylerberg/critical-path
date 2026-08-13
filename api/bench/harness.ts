import type { Kysely } from 'kysely';
import type { DB } from '../src/db/types';
import type { Scale } from './config';
import type { BenchIds } from './seed';
import { recordQueries, summarize, type QueryRecord, type Stats } from './measure';

// Hono's `request` is declared as sync-or-async; every caller here awaits it.
export interface BenchApp {
  request(path: string, init?: RequestInit): Response | Promise<Response>;
}

export class BenchClient {
  constructor(
    private app: BenchApp,
    private token?: string
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token !== undefined) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    return this.app.request(path, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  get(path: string): Promise<Response> {
    return this.send('GET', path);
  }
  post(path: string, body?: unknown): Promise<Response> {
    return this.send('POST', path, body);
  }
  put(path: string, body?: unknown): Promise<Response> {
    return this.send('PUT', path, body);
  }
  patch(path: string, body?: unknown): Promise<Response> {
    return this.send('PATCH', path, body);
  }
  delete(path: string): Promise<Response> {
    return this.send('DELETE', path);
  }
}

export interface BenchContext {
  ids: BenchIds;
  scale: Scale;
  db: Kysely<DB>;
  as(token?: string): BenchClient;
}

export interface ScenarioOutcome {
  status: number;
  bytes: number;
  /** Anything worth printing beside the timing — a row count, a truncation flag. */
  note?: string;
}

export interface Scenario {
  name: string;
  group: string;
  /** What the scenario is probing. Printed with the findings, not the table. */
  probe: string;
  iterations?: number;
  warmup?: number;
  /** Iterations mutate state, so the runner keeps them few and tears them down. */
  mutating?: boolean;
  setup?(ctx: BenchContext): Promise<void>;
  run(ctx: BenchContext, iteration: number): Promise<ScenarioOutcome>;
  teardown?(ctx: BenchContext): Promise<void>;
}

export interface ScenarioResult {
  name: string;
  group: string;
  probe: string;
  stats: Stats;
  status: number;
  bytes: number;
  queries: number;
  dbMs: number;
  slowest: QueryRecord | null;
  note?: string;
  error?: string;
}

const DEFAULT_ITERATIONS = 12;
const DEFAULT_MUTATING_ITERATIONS = 15;
const DEFAULT_WARMUP = 3;

export async function runScenario(
  scenario: Scenario,
  ctx: BenchContext,
  resetRateLimiter: () => void
): Promise<ScenarioResult> {
  const iterations =
    scenario.iterations ??
    (scenario.mutating === true ? DEFAULT_MUTATING_ITERATIONS : DEFAULT_ITERATIONS);
  const warmup = scenario.warmup ?? (scenario.mutating === true ? 1 : DEFAULT_WARMUP);

  const base: Omit<ScenarioResult, 'stats' | 'status' | 'bytes' | 'queries' | 'dbMs' | 'slowest'> =
    {
      name: scenario.name,
      group: scenario.group,
      probe: scenario.probe,
    };

  let iteration = 0;
  try {
    resetRateLimiter();
    await scenario.setup?.(ctx);

    // Warm the plan cache and the buffer pool. The first read of a cold 250k-row
    // table measures the disk, which is not what any of this is about.
    for (let i = 0; i < warmup; i++) {
      resetRateLimiter();
      await scenario.run(ctx, iteration++);
    }

    // One instrumented pass, separate from the timed ones: the pg wrapper adds
    // a promise hop per query, which is noise a 300-query request would show.
    resetRateLimiter();
    const [outcome, queries] = await recordQueries(() => scenario.run(ctx, iteration++));

    const samples: number[] = [];
    let last = outcome;
    for (let i = 0; i < iterations; i++) {
      resetRateLimiter();
      const started = performance.now();
      last = await scenario.run(ctx, iteration++);
      samples.push(performance.now() - started);
    }

    const slowest = queries.reduce<QueryRecord | null>(
      (worst, record) => (worst === null || record.ms > worst.ms ? record : worst),
      null
    );

    return {
      ...base,
      stats: summarize(samples),
      status: last.status,
      bytes: last.bytes,
      queries: queries.length,
      dbMs: queries.reduce((total, record) => total + record.ms, 0),
      slowest,
      note: last.note,
    };
  } catch (error) {
    return {
      ...base,
      stats: summarize([]),
      status: 0,
      bytes: 0,
      queries: 0,
      dbMs: 0,
      slowest: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      await scenario.teardown?.(ctx);
    } catch (error) {
      console.error(`  teardown for "${scenario.name}" failed:`, error);
    }
  }
}

/** Reads the body so the timing covers serialization, which is not free at 5,000 cards. */
export async function consume(response: Response): Promise<ScenarioOutcome> {
  const text = await response.text();
  return { status: response.status, bytes: text.length };
}

export async function consumeWithCount(
  response: Response,
  count: (body: unknown) => string
): Promise<ScenarioOutcome> {
  const text = await response.text();
  let note: string | undefined;
  try {
    note = count(JSON.parse(text));
  } catch {
    note = undefined;
  }
  return { status: response.status, bytes: text.length, note };
}
