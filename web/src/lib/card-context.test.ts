import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { awayBoard, board } from './board.svelte';
import { cardContext } from './card-context.svelte';
import { myTasks } from './myTasks.svelte';
import { projects } from './projects.svelte';
import { router } from './router.svelte';
import { session } from './session.svelte';
import { projectHref, publicBoardHref } from './short-links';
import { taskRoute } from './task-route.svelte';
import { testUuid } from './test-ids';

const me = {
  id: 'u-me',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
  email_verified: false,
};

const OPEN_PROJECT = testUuid('p-open');
const AWAY_PROJECT = testUuid('p-away');
const AWAY_TASK = testUuid('t-away');
const UNKNOWN_TASK = testUuid('t-unknown');

function projectRow(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Away',
    description: '',
    archived_at: null,
    created_by: me.id,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: '2026-07-15T00:00:00Z',
    open_task_count: 0,
    done_task_count: 0,
    sort_key: null,
    last_seen_at: null,
    has_unseen_changes: false,
    ...patch,
  };
}

function boardPayload(projectId: string) {
  return {
    project: projectRow(projectId),
    columns: [{ id: `${projectId}-todo`, name: 'To Do', position: 1000, is_done: false }],
    tasks: [],
    labels: [],
    changed_task_ids: [],
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, boardPayload(AWAY_PROJECT)));
  board.reset();
  cardContext.reset();
  myTasks.reset();
  projects.reset();
  taskRoute.reset();
  session.user = me;
  projects.projects = [projectRow(OPEN_PROJECT), projectRow(AWAY_PROJECT)];
  myTasks.tasks = [
    {
      id: AWAY_TASK,
      project_id: AWAY_PROJECT,
      project_name: 'Away',
      column_name: 'To Do',
      title: 'Ship the demo',
      bucket: 'ready',
      assignee_ids: [me.id],
      waiting_user_ids: [],
      blocking: [],
      blocked_by: [],
    },
  ];
  router.navigate('/my-tasks', { replace: true });
});

describe('cardContext', () => {
  it('serves a project route from the open board even for a card its payload lacks', () => {
    board.currentProjectId = OPEN_PROJECT;
    board.project = projectRow(OPEN_PROJECT) as never;
    router.navigate(projectHref(OPEN_PROJECT, 'Rulebook'), { replace: true });

    expect(cardContext.storeFor(UNKNOWN_TASK)).toBe(board);
    expect(cardContext.statusFor(UNKNOWN_TASK)).toBe('ready');
    expect(cardContext.canWrite(UNKNOWN_TASK)).toBe(true);
  });

  it('serves a list screen from the open board when that is where the card lives', () => {
    board.currentProjectId = AWAY_PROJECT;
    board.project = projectRow(AWAY_PROJECT) as never;

    expect(cardContext.storeFor(AWAY_TASK)).toBe(board);
    expect(cardContext.statusFor(AWAY_TASK)).toBe('ready');
  });

  it('loads the away board for a card the open one does not hold', async () => {
    expect(cardContext.storeFor(AWAY_TASK)).toBe(awayBoard);
    expect(cardContext.statusFor(AWAY_TASK)).toBe('loading');

    cardContext.ensure(AWAY_TASK);

    await vi.waitFor(() => {
      expect(cardContext.statusFor(AWAY_TASK)).toBe('ready');
    });
    expect(awayBoard.currentProjectId).toBe(AWAY_PROJECT);
    expect(board.currentProjectId).toBeNull();
  });

  it('fetches once for a target it is asked about repeatedly', async () => {
    cardContext.ensure(AWAY_TASK);
    await vi.waitFor(() => {
      expect(cardContext.statusFor(AWAY_TASK)).toBe('ready');
    });
    const before = fetchMock.mock.calls.length;

    cardContext.ensure(AWAY_TASK);
    cardContext.ensure(AWAY_TASK);

    expect(fetchMock.mock.calls).toHaveLength(before);
  });

  it('reports the failure rather than a spinner that never ends', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));

    cardContext.ensure(AWAY_TASK);

    await vi.waitFor(() => {
      expect(cardContext.statusFor(AWAY_TASK)).toBe('error');
    });
  });

  it('looks a stranger task up rather than guessing at a project for it', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      if (url.pathname === `/api/tasks/${UNKNOWN_TASK}`) {
        return jsonResponse(200, { id: UNKNOWN_TASK, project_id: AWAY_PROJECT });
      }
      return jsonResponse(200, boardPayload(AWAY_PROJECT));
    });

    expect(cardContext.statusFor(UNKNOWN_TASK)).toBe('loading');
    cardContext.ensure(UNKNOWN_TASK);

    await vi.waitFor(() => {
      expect(cardContext.projectIdFor(UNKNOWN_TASK)).toBe(AWAY_PROJECT);
    });
  });

  it('answers error for a task nobody can name a project for', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(404, { error: 'Task not found' }));

    cardContext.ensure(UNKNOWN_TASK);

    await vi.waitFor(() => {
      expect(cardContext.statusFor(UNKNOWN_TASK)).toBe('error');
    });
  });

  it('refuses to write a project the caller may only read', () => {
    projects.projects = [
      projectRow(AWAY_PROJECT, {
        created_by: 'u-owner',
        member_ids: [me.id],
        members: [{ user_id: me.id, role: 'viewer' }],
      }),
    ];

    expect(cardContext.canWrite(AWAY_TASK)).toBe(false);
  });

  // Fail closed: a project the list has never seen is one nothing proves access to.
  it('refuses to write a project the list does not know', () => {
    projects.projects = [];

    expect(cardContext.canWrite(AWAY_TASK)).toBe(false);
  });

  it('never treats the anonymous public board as a board to act on', () => {
    board.currentProjectId = AWAY_PROJECT;
    board.project = projectRow(AWAY_PROJECT) as never;
    board.readonly = true;
    router.navigate(publicBoardHref(AWAY_PROJECT), { replace: true });

    expect(cardContext.storeFor(AWAY_TASK)).toBe(awayBoard);
  });
});
