import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearForUser,
  deleteOps,
  readQueue,
  readSnapshot,
  resetConnectionForTests,
  SNAPSHOT_VERSION,
  writeOp,
  writeSnapshot,
  type SnapshotRecord,
} from './offline-db';
import type { QueuedOp } from './outbox-ops';
import { testUuid } from './test-ids';

const ADA = testUuid('ada');
const GRACE = testUuid('grace');
const SAVED_AT = '2026-01-01T00:00:00.000Z';

function op(seq: number, overrides: Partial<QueuedOp> = {}): QueuedOp {
  return {
    id: testUuid(`op${String(seq)}`),
    seq,
    userId: ADA,
    projectId: testUuid('p1'),
    entityId: testUuid('t1'),
    semantics: 'plain',
    label: `Change ${String(seq)}`,
    request: { method: 'PATCH', path: '/api/tasks/{id}', pathParams: { id: testUuid('t1') } },
    queuedAt: SAVED_AT,
    attempts: 0,
    ...overrides,
  };
}

// The stores are created by the module's own upgrade, so a raw handle can only be
// opened after something has written through it at least once.
async function putRaw(record: SnapshotRecord): Promise<void> {
  await resetConnectionForTests();
  const db = await openDB('critical-path-offline', 1);
  await db.put('snapshots', record);
  db.close();
}

beforeEach(async () => {
  await resetConnectionForTests();
  await clearForUser(ADA);
  await clearForUser(GRACE);
});

describe('snapshots', () => {
  it('comes back as it went in', async () => {
    await writeSnapshot('board:p1', ADA, { tasks: ['Fix login'] }, SAVED_AT);

    expect(await readSnapshot('board:p1')).toEqual({
      key: 'board:p1',
      userId: ADA,
      version: SNAPSHOT_VERSION,
      savedAt: SAVED_AT,
      payload: { tasks: ['Fix login'] },
    });
  });

  it('is nothing at all for a key that was never written', async () => {
    expect(await readSnapshot('board:never')).toBeNull();
  });

  it('discards a record left by a different snapshot version', async () => {
    await writeSnapshot('board:p1', ADA, { tasks: [] }, SAVED_AT);
    await putRaw({
      key: 'board:p1',
      userId: ADA,
      version: SNAPSHOT_VERSION + 1,
      savedAt: SAVED_AT,
      payload: { tasks: [] },
    });

    expect(await readSnapshot('board:p1')).toBeNull();
  });

  it('overwrites the record already under that key', async () => {
    await writeSnapshot('board:p1', ADA, { tasks: ['first'] }, SAVED_AT);
    await writeSnapshot('board:p1', ADA, { tasks: ['second'] }, '2026-01-02T00:00:00.000Z');

    const record = await readSnapshot('board:p1');
    expect(record?.payload).toEqual({ tasks: ['second'] });
    expect(record?.savedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  // Everything stored is API payload data that arrived as JSON, and the round-trip
  // is what keeps a `$state` proxy — which structured clone throws on — storable.
  it('stores the payload as JSON, not as the object it was handed', async () => {
    await writeSnapshot(
      'board:p1',
      ADA,
      { kept: 1, dropped: undefined, when: new Date('2026-03-04T05:06:07.000Z') },
      SAVED_AT
    );

    expect((await readSnapshot('board:p1'))?.payload).toEqual({
      kept: 1,
      when: '2026-03-04T05:06:07.000Z',
    });
  });

  it('survives a reactive proxy, which structured clone would reject', async () => {
    const reactive = new Proxy(
      { tasks: ['Fix login'] },
      { get: (target, key) => Reflect.get(target, key) as unknown }
    );

    await writeSnapshot('board:p1', ADA, reactive, SAVED_AT);

    expect((await readSnapshot('board:p1'))?.payload).toEqual({ tasks: ['Fix login'] });
  });
});

describe('the outbox queue', () => {
  it('is empty for a user who has queued nothing', async () => {
    expect(await readQueue(ADA)).toEqual([]);
  });

  it('comes back in sequence order however it went in', async () => {
    await writeOp(op(3));
    await writeOp(op(1));
    await writeOp(op(2));

    expect((await readQueue(ADA)).map((o) => o.seq)).toEqual([1, 2, 3]);
  });

  it('holds one user’s work apart from another’s', async () => {
    await writeOp(op(1));
    await writeOp(op(2, { id: testUuid('grace-op'), userId: GRACE }));

    expect((await readQueue(ADA)).map((o) => o.seq)).toEqual([1]);
    expect((await readQueue(GRACE)).map((o) => o.seq)).toEqual([2]);
  });

  it('replaces an op rewritten under the same id', async () => {
    await writeOp(op(1, { attempts: 0 }));
    await writeOp(op(1, { attempts: 3 }));

    const queue = await readQueue(ADA);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.attempts).toBe(3);
  });

  it('deletes only the ops it was named', async () => {
    await writeOp(op(1));
    await writeOp(op(2));
    await writeOp(op(3));

    await deleteOps([testUuid('op2')]);

    expect((await readQueue(ADA)).map((o) => o.seq)).toEqual([1, 3]);
  });

  it('does nothing, and does not throw, for an empty delete', async () => {
    await writeOp(op(1));

    await expect(deleteOps([])).resolves.toBeUndefined();
    expect(await readQueue(ADA)).toHaveLength(1);
  });

  it('ignores an id that is not in the queue', async () => {
    await writeOp(op(1));

    await deleteOps([testUuid('never')]);

    expect(await readQueue(ADA)).toHaveLength(1);
  });
});

// Signing out has to leave nothing behind: the board of whoever was here is as
// private as the images clearMediaCaches drops, and their unsent work must not
// surface under the next account.
describe('clearForUser', () => {
  it('drops that user’s snapshots and queued work together', async () => {
    await writeSnapshot('board:p1', ADA, { tasks: [] }, SAVED_AT);
    await writeOp(op(1));

    await clearForUser(ADA);

    expect(await readSnapshot('board:p1')).toBeNull();
    expect(await readQueue(ADA)).toEqual([]);
  });

  it('leaves everyone else’s alone', async () => {
    await writeSnapshot('board:ada', ADA, { tasks: [] }, SAVED_AT);
    await writeSnapshot('board:grace', GRACE, { tasks: [] }, SAVED_AT);
    await writeOp(op(1));
    await writeOp(op(2, { id: testUuid('grace-op'), userId: GRACE }));

    await clearForUser(ADA);

    expect(await readSnapshot('board:grace')).not.toBeNull();
    expect(await readQueue(GRACE)).toHaveLength(1);
  });

  it('is fine for a user with nothing stored', async () => {
    await expect(clearForUser(testUuid('nobody'))).resolves.toBeUndefined();
  });
});
