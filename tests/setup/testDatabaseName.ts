import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_DATABASE_NAME_LENGTH = 63;
const CHECKOUT_HASH_LENGTH = 8;
const DEFAULT_BASE_DATABASE = 'game_dev_test';

// Nothing outside this shape is ever created, truncated or dropped, so a
// mis-set DB_DATABASE cannot reach `game_dev` and the owner's real projects.
const RESETTABLE_DATABASE = /^[a-z][a-z0-9_]*_test(_[a-z0-9_]+)?$/;

export const CHECKOUT_COMMENT_PREFIX = 'critical-path-api test checkout: ';

// The checkout this file belongs to, not the working directory: a suite
// started from a subdirectory still names the database after its own checkout.
export const checkoutRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function assertResettableDatabaseName(name: string): string {
  if (!RESETTABLE_DATABASE.test(name)) {
    throw new Error(
      `Refusing to create, reset or drop "${name}": a test database name has to end in _test ` +
        'or carry a _test_ segment.'
    );
  }
  return name;
}

export function baseDatabaseName(): string {
  return assertResettableDatabaseName(
    process.env.TEST_DB_BASE || process.env.DB_DATABASE || DEFAULT_BASE_DATABASE
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Derived rather than configured: two checkouts cannot end up sharing a
// database by both inheriting the same .env.test, which is what let one
// agent's suite truncate another's mid-run.
export function resolveTestDatabaseName(): string {
  const override = process.env.TEST_DB_NAME;
  if (override) {
    return assertResettableDatabaseName(override);
  }

  const base = baseDatabaseName();
  const hash = createHash('sha256')
    .update(checkoutRoot)
    .digest('hex')
    .slice(0, CHECKOUT_HASH_LENGTH);
  const room = MAX_DATABASE_NAME_LENGTH - base.length - hash.length - 2;
  const label = slugify(basename(checkoutRoot)).slice(0, Math.max(room, 0));

  return assertResettableDatabaseName(label ? `${base}_${label}_${hash}` : `${base}_${hash}`);
}
