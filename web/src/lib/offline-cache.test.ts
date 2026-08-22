import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardColumn, BoardLabel, BoardProject, BoardTask } from './board-types';
import {
  clearOfflineCache,
  readBoardSnapshot,
  readProjectsSnapshot,
  readUsersSnapshot,
  saveBoardSnapshot,
  saveProjectsSnapshot,
  saveUsersSnapshot,
  type BoardSnapshot,
} from './offline-cache';
import { resetConnectionForTests, writeSnapshot } from './offline-db';
import { testUuid } from './test-ids';

const ADA = testUuid('ada');
const GRACE = testUuid('grace');
const PROJECT_ID = testUuid('p1');
const SAVED_AT = '2026-01-01T00:00:00.000Z';

function snapshot(title: string): BoardSnapshot {
  return {
    project: { id: PROJECT_ID, name: 'Game' } as BoardProject,
    columns: [{ id: testUuid('c1'), name: 'Todo', sort_key: 'V0', is_done: false } as BoardColumn],
    tasks: [{ id: testUuid('t1'), title, column_id: testUuid('c1'), sort_key: 'V0' } as BoardTask],
    labels: [] as BoardLabel[],
  };
}

beforeEach(async () => {
  await resetConnectionForTests();
  await clearOfflineCache(ADA);
  await clearOfflineCache(GRACE);
});

describe('board snapshots', () => {
  it('comes back as it went in, with when it was taken', async () => {
    await saveBoardSnapshot(ADA, PROJECT_ID, snapshot('Fix login'));

    const cached = await readBoardSnapshot(ADA, PROJECT_ID);

    expect(cached?.payload.tasks[0]?.title).toBe('Fix login');
    expect(Date.parse(cached?.savedAt ?? '')).not.toBeNaN();
  });

  it('is nothing at all for a project that was never cached', async () => {
    expect(await readBoardSnapshot(ADA, testUuid('never'))).toBeNull();
  });

  // The reason this lives in the app rather than the service worker's HTTP
  // cache, which keys by URL and would hand one account's board to the next.
  it('is not readable as another account', async () => {
    await saveBoardSnapshot(ADA, PROJECT_ID, snapshot('Ada’s board'));

    expect(await readBoardSnapshot(GRACE, PROJECT_ID)).toBeNull();
  });

  it('is gone once that account signs out, and only that account’s', async () => {
    await saveBoardSnapshot(ADA, PROJECT_ID, snapshot('Ada’s board'));
    await saveBoardSnapshot(GRACE, PROJECT_ID, snapshot('Grace’s board'));

    await clearOfflineCache(ADA);

    expect(await readBoardSnapshot(ADA, PROJECT_ID)).toBeNull();
    expect((await readBoardSnapshot(GRACE, PROJECT_ID))?.payload.tasks[0]?.title).toBe(
      'Grace’s board'
    );
  });
});

/**
 * Refusing a record is the whole reason the read is not a plain `get`: what comes
 * back is bytes an older build wrote, and the board store assigns them into
 * itself field by field without checking any of them. A validator that accepts
 * everything is indistinguishable from no validator at all until it crashes the
 * board it was meant to restore, so each case below stores a shape that is
 * *nearly* right.
 */
describe('a stored payload that is not what it claims to be', () => {
  // Each fixture carries every field but the one it is named for, so the clause
  // under test is the only one that can reject it — a fixture missing two fields
  // passes whichever clause runs first and says nothing about the other.
  it('refuses a board whose tasks are not a list', async () => {
    await writeSnapshot(
      `${ADA}:board:${PROJECT_ID}`,
      ADA,
      { project: { id: PROJECT_ID }, tasks: 'nope', columns: [], labels: [] },
      SAVED_AT
    );

    expect(await readBoardSnapshot(ADA, PROJECT_ID)).toBeNull();
  });

  it('refuses a board with no columns', async () => {
    await writeSnapshot(
      `${ADA}:board:${PROJECT_ID}`,
      ADA,
      { project: { id: PROJECT_ID }, tasks: [], labels: [] },
      SAVED_AT
    );

    expect(await readBoardSnapshot(ADA, PROJECT_ID)).toBeNull();
  });

  // The first thing the board store does with a cached payload is read
  // `payload.project.id`, which is a TypeError rather than a cache miss.
  it('refuses a board that names no project', async () => {
    await writeSnapshot(
      `${ADA}:board:${PROJECT_ID}`,
      ADA,
      { tasks: [], columns: [], labels: [] },
      SAVED_AT
    );

    expect(await readBoardSnapshot(ADA, PROJECT_ID)).toBeNull();
  });

  it('refuses a project list stored as anything but a list', async () => {
    await writeSnapshot(`${ADA}:projects`, ADA, { [PROJECT_ID]: { name: 'Game' } }, SAVED_AT);

    expect(await readProjectsSnapshot(ADA)).toBeNull();
  });
});

describe('the shell around the board', () => {
  it('keeps the project list so an offline launch is not an empty sidebar', async () => {
    await saveProjectsSnapshot(ADA, [{ id: PROJECT_ID, name: 'Game' } as never]);

    expect(await readProjectsSnapshot(ADA)).toHaveLength(1);
    expect(await readProjectsSnapshot(GRACE)).toBeNull();
  });

  // The other half of the same sidebar: without it an offline launch renders
  // every avatar and assignee as an unresolved id.
  it('keeps the member list, under its own key and its own account', async () => {
    await saveUsersSnapshot(ADA, [{ id: testUuid('u1'), name: 'Ada' } as never]);
    await saveProjectsSnapshot(ADA, [{ id: PROJECT_ID, name: 'Game' } as never]);

    expect(await readUsersSnapshot(ADA)).toEqual([{ id: testUuid('u1'), name: 'Ada' }]);
    expect(await readUsersSnapshot(GRACE)).toBeNull();
  });
});
