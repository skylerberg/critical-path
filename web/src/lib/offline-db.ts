import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { QueuedOp } from './outbox-ops';

const DB_NAME = 'critical-path-offline';
const DB_VERSION = 1;

/**
 * Bumped by hand whenever the shape of a cached payload changes. The service
 * worker updates the app without the running page's cooperation, so a build can
 * and does meet snapshots written by the previous one; a mismatch is discarded
 * rather than rendered. Queued mutations are not versioned this way — they are
 * the user's unsent work and are migrated or replayed, never dropped for being
 * old.
 */
export const SNAPSHOT_VERSION = 1;

export interface SnapshotRecord {
  key: string;
  userId: string;
  version: number;
  savedAt: string;
  payload: unknown;
}

interface OfflineSchema extends DBSchema {
  snapshots: {
    key: string;
    value: SnapshotRecord;
    indexes: { 'by-user': string };
  };
  outbox: {
    key: string;
    value: QueuedOp;
    indexes: { 'by-user': string };
  };
}

// Everything here is best-effort. IndexedDB is unavailable in some private
// browsing modes and can be disabled outright, and none of that is a reason for
// the app to stop working online — it only means this device cannot remember
// anything between loads. A single failed open is latched so a broken
// environment costs one rejected promise rather than one per call.
let dbPromise: Promise<IDBPDatabase<OfflineSchema> | null> | null = null;

function connect(): Promise<IDBPDatabase<OfflineSchema> | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  dbPromise ??= openDB<OfflineSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const snapshots = db.createObjectStore('snapshots', { keyPath: 'key' });
      snapshots.createIndex('by-user', 'userId');
      const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('by-user', 'userId');
    },
    // A tab holding the old version open would block the upgrade forever.
    // Closing ours lets the newer one through; this tab reopens on next use.
    blocked() {
      void close();
    },
    blocking() {
      void close();
    },
  }).catch(() => null);
  return dbPromise;
}

async function close(): Promise<void> {
  const db = await dbPromise;
  db?.close();
  dbPromise = null;
}

/**
 * IndexedDB can stop answering rather than fail — an upgrade blocked by another
 * tab, a browser in a bad state — and a promise that never settles is worse than
 * one that rejects, because every caller waits on it forever. Persistence is a
 * convenience here; nothing the user does should ever be held up by it.
 */
const DB_TIMEOUT_MS = 5000;

async function withDb<T>(
  run: (db: IDBPDatabase<OfflineSchema>) => Promise<T>,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      const db = await connect();
      return db === null ? fallback : await run(db);
    })();
    const guard = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), DB_TIMEOUT_MS);
    });
    return await Promise.race([work, guard]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * IndexedDB stores by structured clone, which throws on a Svelte `$state`
 * proxy — and everything worth persisting here is reactive store state. Since
 * `withDb` swallows failures so a broken storage layer cannot take the app down
 * with it, an un-cloneable value would not throw either: it would just silently
 * never be written, and only turn up as an offline load with nothing to show.
 *
 * A JSON round-trip is the guarantee that cannot be forgotten at a call site.
 * Everything stored is API payload data that arrived as JSON, so nothing
 * survives the trip that did not survive the wire.
 */
function toStorable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function readSnapshot(key: string): Promise<SnapshotRecord | null> {
  const record = await withDb(async (db) => db.get('snapshots', key), undefined);
  // A payload written by a previous build is not worth guessing at.
  return record === undefined || record.version !== SNAPSHOT_VERSION ? null : record;
}

export async function writeSnapshot(
  key: string,
  userId: string,
  payload: unknown,
  savedAt: string
): Promise<void> {
  await withDb(
    async (db) =>
      db.put('snapshots', {
        key,
        userId,
        version: SNAPSHOT_VERSION,
        savedAt,
        payload: toStorable(payload),
      }),
    undefined
  );
}

export async function readQueue(userId: string): Promise<QueuedOp[]> {
  const ops = await withDb(async (db) => db.getAllFromIndex('outbox', 'by-user', userId), []);
  // Replay order is the order the user worked in, and the store is keyed by op
  // id rather than sequence, so the sort is what makes FIFO true.
  return ops.sort((a, b) => a.seq - b.seq);
}

export async function writeOp(op: QueuedOp): Promise<void> {
  await withDb(async (db) => db.put('outbox', toStorable(op)), undefined);
}

export async function deleteOps(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await withDb(async (db) => {
    const tx = db.transaction('outbox', 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  }, undefined);
}

/**
 * Signing out has to leave nothing behind: the board of whoever was here is as
 * private as the images `clearMediaCaches` drops, and their unsent work must not
 * surface under the next account. Everything is keyed by user id so this is one
 * pass per store rather than a guess at what belonged to whom.
 */
export async function clearForUser(userId: string): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(['snapshots', 'outbox'], 'readwrite');
    const [snapshotKeys, outboxKeys] = await Promise.all([
      tx.objectStore('snapshots').index('by-user').getAllKeys(userId),
      tx.objectStore('outbox').index('by-user').getAllKeys(userId),
    ]);
    await Promise.all([
      ...snapshotKeys.map((key) => tx.objectStore('snapshots').delete(key)),
      ...outboxKeys.map((key) => tx.objectStore('outbox').delete(key)),
      tx.done,
    ]);
  }, undefined);
}

// Test seam: the module-level connection would otherwise leak between cases.
export async function resetConnectionForTests(): Promise<void> {
  await close();
}
