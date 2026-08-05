import { describe, it, expect } from 'vitest';
import { AdvisoryLock } from '../../src/services/advisoryLock';

describe('advisory lock salts', () => {
  // Two locks sharing a salt collide wherever they are keyed by the same id,
  // and the symptom is one waiting on the other rather than anything failing.
  it('gives every lock its own', () => {
    const salts = Object.values(AdvisoryLock);
    expect(new Set(salts).size).toBe(salts.length);
  });

  // Pods on either side of a rolling deploy have to hash a lock to the same
  // key, so a renumbering is only ever safe as a value nothing else used.
  it('keeps the values already deployed', () => {
    expect(AdvisoryLock).toEqual({
      projectDependencies: 0,
      projectStorageQuota: 1,
      columnTail: 2,
    });
  });
});
