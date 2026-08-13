import { MAX_TASKS_PER_PROJECT } from '../src/config/constants';

// The board cap is a product invariant, not a benchmark parameter: the biggest
// board the API will ever serve holds exactly this many cards, so the heavy tier
// cannot make the worst case worse by seeding more. Anything that grows without
// bound — projects per user, comments per task, dependency edges — is what the
// tiers actually scale.
export const BOARD_TASK_CAP = MAX_TASKS_PER_PROJECT;

export interface Scale {
  name: string;
  /** Accounts in the instance. */
  users: number;
  /** Projects in the instance, spread across the users. */
  projects: number;
  /** Cards in an ordinary project. */
  tasksPerProject: number;
  /** Projects the hub user belongs to, which is what GET /api/projects returns. */
  hubProjects: number;
  /** Cards assigned to the loaded user, which is what GET /api/my-tasks reads. */
  loadedUserTasks: number;
  /** Members on the crowded project. */
  crowdedMembers: number;
  /** Comments on the single hottest task. */
  hotTaskComments: number;
  /** Checklist rows on the single hottest task. */
  hotTaskChecklistItems: number;
  /** Blockers pointing at the hottest task, and blocked by it. */
  hotTaskEdges: number;
  /** Length of the deliberately deep dependency chain. */
  chainLength: number;
  /** Dependency edges scattered across the instance, including cross-project. */
  scatteredEdges: number;
  /** Comments scattered across the instance. */
  scatteredComments: number;
  /** Activity rows scattered across the instance. */
  scatteredActivity: number;
}

const SCALES: Record<string, Scale> = {
  fast: {
    name: 'fast',
    users: 200,
    projects: 300,
    tasksPerProject: 60,
    hubProjects: 150,
    loadedUserTasks: 1_500,
    crowdedMembers: 150,
    hotTaskComments: 1_000,
    hotTaskChecklistItems: 200,
    hotTaskEdges: 300,
    chainLength: 500,
    scatteredEdges: 20_000,
    scatteredComments: 30_000,
    scatteredActivity: 40_000,
  },
  heavy: {
    name: 'heavy',
    users: 2_000,
    projects: 3_000,
    tasksPerProject: 120,
    hubProjects: 800,
    loadedUserTasks: 10_000,
    crowdedMembers: 500,
    hotTaskComments: 5_000,
    hotTaskChecklistItems: 500,
    hotTaskEdges: 1_000,
    chainLength: 2_000,
    scatteredEdges: 200_000,
    scatteredComments: 300_000,
    scatteredActivity: 400_000,
  },
};

export function resolveScale(name: string | undefined): Scale {
  const scale = SCALES[name ?? 'fast'];
  if (!scale) {
    throw new Error(
      `Unknown scale ${JSON.stringify(name)}. Known: ${Object.keys(SCALES).join(', ')}`
    );
  }
  return scale;
}

// Roughly what the seeder will write, for the "this will take a while" notice.
export function estimatedTaskCount(scale: Scale): number {
  return scale.projects * scale.tasksPerProject + BOARD_TASK_CAP * 2 + scale.chainLength;
}
