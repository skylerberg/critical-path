import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardColumn, BoardLabel, BoardProject, BoardTask } from './board-types';
import {
  clearOfflineCache,
  readBoardSnapshot,
  readProjectsSnapshot,
  saveBoardSnapshot,
  saveProjectsSnapshot,
  type BoardSnapshot,
} from './offline-cache';
import { resetConnectionForTests } from './offline-db';
import { testUuid } from './test-ids';

const ADA = testUuid('ada');
const GRACE = testUuid('grace');
const PROJECT_ID = testUuid('p1');

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

describe('the shell around the board', () => {
  it('keeps the project list so an offline launch is not an empty sidebar', async () => {
    await saveProjectsSnapshot(ADA, [{ id: PROJECT_ID, name: 'Game' } as never]);

    expect(await readProjectsSnapshot(ADA)).toHaveLength(1);
    expect(await readProjectsSnapshot(GRACE)).toBeNull();
  });
});
