import { type, type Type } from 'arktype';
import type { JsonValue } from '../../db/types';
import { JOB_PAYLOAD_SCHEMAS, type JobKind, type JobPayloads } from './payloads';
import { MAX_HANDLER_TIMEOUT_MS, type PeriodicJob } from './queue';

export interface JobHandler<K extends JobKind = JobKind> {
  kind: K;
  timeoutMs: number;
  // Set to schedule the kind instead of enqueueing it: one row, reseeded on
  // every start, rescheduled after every run, never retired.
  intervalSeconds?: number;
  // Called again whenever a lease expires while it is still running, so it has
  // to be idempotent under concurrency and not merely under repetition. A
  // target row that has since been deleted is success: no foreign key covers
  // this table, so nothing else will ever discard the job.
  run: (payload: JobPayloads[K]) => Promise<void>;
}

// What the registry holds. Parsing the payload against the kind's row is what
// erases the per-kind type the registration carried, so the runner can dispatch
// a claimed row without knowing which kind it is.
export interface RegisteredJobHandler {
  kind: string;
  timeoutMs: number;
  intervalSeconds?: number;
  run: (payload: JsonValue) => Promise<void>;
}

const handlers = new Map<string, RegisteredJobHandler>();

// Runs at dispatch, inside the runner's per-job try, so a row whose payload does
// not match its kind fails that job and backs off like any other handler throw.
// The missing-row branch is unreachable from typed code — both the register and
// the enqueue side are generic over the table's keys — and exists for the tests
// that drive this kind-agnostic machinery with kinds that deliberately have none.
function parsePayload(kind: string, schema: Type | undefined, payload: JsonValue): JsonValue {
  if (schema === undefined) return payload;
  const parsed = schema(payload);
  if (parsed instanceof type.errors) {
    throw new Error(`Job payload does not match kind ${kind}: ${parsed.summary}`);
  }
  return parsed as JsonValue;
}

export function registerJobHandler<K extends JobKind>(handler: JobHandler<K>): void {
  if (handlers.has(handler.kind)) {
    throw new Error(`Job handler already registered: ${handler.kind}`);
  }
  if (handler.timeoutMs <= 0 || handler.timeoutMs > MAX_HANDLER_TIMEOUT_MS) {
    throw new Error(
      `Job handler ${handler.kind} needs 0 < timeoutMs <= ${String(MAX_HANDLER_TIMEOUT_MS)}`
    );
  }
  if (handler.intervalSeconds !== undefined && handler.intervalSeconds <= 0) {
    throw new Error(`Job handler ${handler.kind} needs a positive intervalSeconds`);
  }
  const schema: Type | undefined = JOB_PAYLOAD_SCHEMAS[handler.kind];
  handlers.set(handler.kind, {
    kind: handler.kind,
    timeoutMs: handler.timeoutMs,
    intervalSeconds: handler.intervalSeconds,
    run: async (payload) => {
      await handler.run(parsePayload(handler.kind, schema, payload) as JobPayloads[K]);
    },
  });
}

export function unregisterJobHandler(kind: string): void {
  handlers.delete(kind);
}

export function jobHandler(kind: string): RegisteredJobHandler | undefined {
  return handlers.get(kind);
}

export function registeredJobKinds(): string[] {
  return [...handlers.keys()];
}

export function periodicJobs(): PeriodicJob[] {
  return [...handlers.values()].flatMap((handler) =>
    handler.intervalSeconds === undefined
      ? []
      : [{ kind: handler.kind, intervalSeconds: handler.intervalSeconds }]
  );
}
