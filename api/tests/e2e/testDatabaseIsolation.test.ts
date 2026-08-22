import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../src/db/index';
import {
  assertResettableDatabaseName,
  baseDatabaseName,
  checkoutRoot,
  resolveTestDatabaseName,
} from '../setup/testDatabaseName';

describe('the database this suite runs against', () => {
  it('is the one derived for this checkout, not the shared base', async () => {
    const { rows } = await sql<{ name: string }>`select current_database() as name`.execute(db);

    expect(rows[0]!.name).toBe(resolveTestDatabaseName());
    expect(rows[0]!.name).not.toBe(baseDatabaseName());
  });

  it('carries a name a second checkout cannot derive', () => {
    const name = resolveTestDatabaseName();
    expect(name.startsWith(`${baseDatabaseName()}_`)).toBe(true);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(checkoutRoot.endsWith('/')).toBe(false);
  });

  it('refuses a name outside the resettable shape', () => {
    expect(() => assertResettableDatabaseName('critical_path')).toThrow(/Refusing/);
    expect(() => assertResettableDatabaseName('postgres')).toThrow(/Refusing/);
    expect(() => assertResettableDatabaseName('critical_path_test')).not.toThrow();
    expect(() => assertResettableDatabaseName('critical_path_test_worktree_abc123')).not.toThrow();
  });
});
