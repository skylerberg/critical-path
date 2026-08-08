import { afterEach, describe, expect, it } from 'vitest';
import {
  LEASE_SECONDS,
  MAX_HANDLER_TIMEOUT_MS,
  ROUNDS_PER_TICK,
  TICK_BUDGET_MS,
  assertJobPayload,
  periodicJobs,
  registerJobHandler,
  registeredJobKinds,
  unregisterJobHandler,
} from '../../src/services/jobs/index';

const noop = () => Promise.resolve();

// Synthetic kinds, deliberately outside the payload catalogue: what these cases
// check is the registry's own guards, which are kind-agnostic.
const register = registerJobHandler as unknown as (handler: {
  kind: string;
  timeoutMs: number;
  intervalSeconds?: number;
  run: () => Promise<void>;
}) => void;

afterEach(() => {
  for (const kind of registeredJobKinds()) unregisterJobHandler(kind);
});

describe('lease budget', () => {
  it('finishes a full batch of the slowest permitted handlers inside the budget and the lease', () => {
    expect(ROUNDS_PER_TICK * MAX_HANDLER_TIMEOUT_MS).toBeLessThan(TICK_BUDGET_MS);
    expect(TICK_BUDGET_MS).toBeLessThan(LEASE_SECONDS * 1000);
  });
});

describe('registerJobHandler', () => {
  it('refuses a timeout the lease cannot absorb, and admits one at the limit', () => {
    expect(() =>
      register({ kind: 'unit_slow', timeoutMs: MAX_HANDLER_TIMEOUT_MS + 1, run: noop })
    ).toThrow(/timeoutMs/);
    expect(() => register({ kind: 'unit_zero', timeoutMs: 0, run: noop })).toThrow(/timeoutMs/);
    expect(registeredJobKinds()).toEqual([]);

    register({ kind: 'unit_limit', timeoutMs: MAX_HANDLER_TIMEOUT_MS, run: noop });
    expect(registeredJobKinds()).toEqual(['unit_limit']);
  });

  it('refuses a second handler for a kind', () => {
    register({ kind: 'unit_dup', timeoutMs: 100, run: noop });
    expect(() => register({ kind: 'unit_dup', timeoutMs: 100, run: noop })).toThrow(
      /already registered/
    );
  });

  it('refuses a non-positive interval', () => {
    expect(() =>
      register({ kind: 'unit_interval', timeoutMs: 100, intervalSeconds: 0, run: noop })
    ).toThrow(/intervalSeconds/);
  });
});

describe('periodicJobs', () => {
  it('lists only the kinds that carry an interval', () => {
    register({ kind: 'unit_once', timeoutMs: 100, run: noop });
    register({ kind: 'unit_sweep', timeoutMs: 100, intervalSeconds: 60, run: noop });
    expect(periodicJobs()).toEqual([{ kind: 'unit_sweep', intervalSeconds: 60 }]);
  });
});

describe('assertJobPayload', () => {
  it('accepts a payload of ids', () => {
    expect(() =>
      assertJobPayload({
        series_id: '6f1c9d0e-0000-4000-8000-000000000000',
        recipient_user_ids: ['a', 'b'],
        occurrence_count: 3,
        paused: false,
        cursor: null,
      })
    ).not.toThrow();
  });

  it('rejects an address however deeply it is buried', () => {
    expect(() => assertJobPayload({ to: 'someone@example.com' })).toThrow(/email address/);
    expect(() => assertJobPayload({ batch: [{ to: 'a.b+c@sub.example.co.uk' }] })).toThrow(
      /email address/
    );
    expect(() => assertJobPayload(['someone@example.com'])).toThrow(/email address/);
  });

  it('rejects a field named for contact details whatever it holds', () => {
    expect(() => assertJobPayload({ email: null })).toThrow(/contact field/);
    expect(() => assertJobPayload({ recipient: { 'e-mail': 'redacted' } })).toThrow(
      /contact field/
    );
  });

  it('names the path so the offending field is findable', () => {
    expect(() => assertJobPayload({ batch: [{ to: 'someone@example.com' }] })).toThrow(
      'payload.batch[0].to'
    );
  });
});
