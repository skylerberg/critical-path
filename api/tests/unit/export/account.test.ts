import { describe, it, expect } from 'vitest';
import { accountExportFilename } from '../../../src/services/export/account';

describe('accountExportFilename', () => {
  it('dates the file and carries no account text', () => {
    expect(accountExportFilename(new Date('2026-08-02T23:59:59.000Z'))).toBe(
      'critical-path-account-2026-08-02.json'
    );
  });

  it('is a valid Content-Disposition filename whatever the moment', () => {
    for (const iso of ['2026-01-01T00:00:00.000Z', '2027-12-31T12:34:56.789Z']) {
      expect(accountExportFilename(new Date(iso))).toMatch(
        /^critical-path-account-\d{4}-\d{2}-\d{2}\.json$/
      );
    }
  });
});
