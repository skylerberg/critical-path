import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { db } from '../../helpers/database';
import {
  lockProjectDependencies,
  wouldCreateDependencyCycle,
} from '../../../src/services/dependencies';
import { ProjectFixtures } from './taskFixtures';

describe('dependencies service cycle detection', () => {
  const fixtures = new ProjectFixtures();
  let projectId: string;
  let taskA: string;
  let taskB: string;
  let taskC: string;
  let taskD: string;

  beforeAll(async () => {
    projectId = await fixtures.createProject('dependencies service project');
    const columnId = await fixtures.createColumn(projectId);
    taskA = await fixtures.createTaskRow(projectId, columnId, 'A');
    taskB = await fixtures.createTaskRow(projectId, columnId, 'B');
    taskC = await fixtures.createTaskRow(projectId, columnId, 'C');
    taskD = await fixtures.createTaskRow(projectId, columnId, 'D');
    await fixtures.createDependencyRow(taskA, taskB);
    await fixtures.createDependencyRow(taskB, taskC);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it('detects transitive cycles through the seeded chain', async () => {
    await db.transaction().execute(async (trx) => {
      await lockProjectDependencies(trx, projectId);
      expect(await wouldCreateDependencyCycle(trx, taskA, taskC)).toBe(true);
      expect(await wouldCreateDependencyCycle(trx, taskB, taskC)).toBe(true);
      expect(await wouldCreateDependencyCycle(trx, taskA, taskB)).toBe(true);
    });
  });

  it('allows edges that do not close a cycle', async () => {
    await db.transaction().execute(async (trx) => {
      await lockProjectDependencies(trx, projectId);
      expect(await wouldCreateDependencyCycle(trx, taskC, taskA)).toBe(false);
      expect(await wouldCreateDependencyCycle(trx, taskD, taskC)).toBe(false);
      expect(await wouldCreateDependencyCycle(trx, taskC, taskD)).toBe(false);
    });
  });

  it('terminates on corrupt data that already contains a cycle', async () => {
    const corruptProject = await fixtures.createProject('corrupt cycle project');
    const columnId = await fixtures.createColumn(corruptProject);
    const taskX = await fixtures.createTaskRow(corruptProject, columnId, 'X');
    const taskY = await fixtures.createTaskRow(corruptProject, columnId, 'Y');
    const taskZ = await fixtures.createTaskRow(corruptProject, columnId, 'Z');
    await fixtures.createDependencyRow(taskX, taskY);
    await fixtures.createDependencyRow(taskY, taskX);

    await db.transaction().execute(async (trx) => {
      await lockProjectDependencies(trx, corruptProject);
      expect(await wouldCreateDependencyCycle(trx, taskZ, taskX)).toBe(false);
      expect(await wouldCreateDependencyCycle(trx, taskY, taskX)).toBe(true);
    });
  });
});
