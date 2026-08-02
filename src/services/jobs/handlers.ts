import type { JsonValue } from '../../db/types';
import { MAX_HANDLER_TIMEOUT_MS, type PeriodicJob } from './queue';

export interface JobHandler {
  kind: string;
  timeoutMs: number;
  // Set to schedule the kind instead of enqueueing it: one row, reseeded on
  // every start, rescheduled after every run, never retired.
  intervalSeconds?: number;
  // Called again whenever a lease expires while it is still running, so it has
  // to be idempotent under concurrency and not merely under repetition. A
  // target row that has since been deleted is success: no foreign key covers
  // this table, so nothing else will ever discard the job.
  run: (payload: JsonValue) => Promise<void>;
}

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(handler: JobHandler): void {
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
  handlers.set(handler.kind, handler);
}

export function unregisterJobHandler(kind: string): void {
  handlers.delete(kind);
}

export function jobHandler(kind: string): JobHandler | undefined {
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
