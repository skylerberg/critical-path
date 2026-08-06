import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, rankKey } from '../../helpers/fixtures';
import { BoardPayloadBody, deleteProjects, insertTask } from '../projects/helpers';

interface MyTaskLinkBody {
  id: string;
  project_id: string;
  title: string;
  assignee_ids: string[];
}

interface MyTaskBody {
  id: string;
  project_id: string;
  project_name: string;
  column_name: string;
  title: string;
  assignee_ids: string[];
  bucket: 'blocking' | 'ready' | 'blocked';
  waiting_user_ids: string[];
  blocking: MyTaskLinkBody[];
  blocked_by: MyTaskLinkBody[];
}

interface MyTasksBody {
  tasks: MyTaskBody[];
  waiting_on_you: Array<{ user_id: string | null; tasks: MyTaskLinkBody[] }>;
  you_are_waiting_on: Array<{ user_id: string | null; tasks: MyTaskLinkBody[] }>;
}

describe('GET /api/my-tasks', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let bob: TestUser;

  beforeAll(async () => {
    bob = await ctx.createUser('my-tasks-bob');
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  // A fresh caller per test: the endpoint answers with everything assigned to
  // them everywhere, so a shared user would leak the previous test's fixtures in.
  async function newCaller(): Promise<TestUser> {
    return await ctx.createUser('my-tasks');
  }

  async function createProject(
    owner: TestUser,
    name: string
  ): Promise<{
    id: string;
    name: string;
    backlog: { id: string };
    todo: { id: string };
    done: { id: string };
  }> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(owner.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    const board = (await res.json()) as BoardPayloadBody;
    return {
      id,
      name,
      backlog: board.columns.find((column) => column.name === 'Backlog')!,
      todo: board.columns.find((column) => column.name === 'To Do')!,
      done: board.columns.find((column) => column.name === 'Done')!,
    };
  }

  async function addMember(projectId: string, userId: string): Promise<void> {
    await db
      .insertInto('project_member')
      .values({ project_id: projectId, user_id: userId })
      .execute();
  }

  async function assign(taskId: string, userId: string): Promise<void> {
    await db.insertInto('task_assignee').values({ task_id: taskId, user_id: userId }).execute();
  }

  async function blocks(blockerTaskId: string, blockedTaskId: string): Promise<void> {
    await db
      .insertInto('task_dependency')
      .values({ blocker_task_id: blockerTaskId, blocked_task_id: blockedTaskId })
      .execute();
  }

  async function archiveTask(taskId: string): Promise<void> {
    await db
      .updateTable('task')
      .set({ archived_at: new Date() })
      .where('id', '=', taskId)
      .execute();
  }

  async function fetchMine(user: TestUser): Promise<MyTasksBody> {
    const res = await ctx.request(user.token).get('/api/my-tasks');
    expect(res.status).toBe(200);
    return (await res.json()) as MyTasksBody;
  }

  it('requires authentication', async () => {
    const res = await ctx.request().get('/api/my-tasks');
    expect(res.status).toBe(401);
  });

  it('returns only tasks assigned to the caller', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Solo');
    const mine = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Mine',
    });
    const theirs = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Theirs',
    });
    await assign(mine, alice.id);
    await assign(theirs, bob.id);

    const body = await fetchMine(alice);
    expect(body.tasks.map((task) => task.id)).toEqual([mine]);
  });

  it('spans a project the caller owns and one they are a member of', async () => {
    const alice = await newCaller();
    const own = await createProject(alice, 'Aardvark');
    const shared = await createProject(bob, 'Bumblebee');
    await addMember(shared.id, alice.id);

    const ownTask = await insertTask({ projectId: own.id, columnId: own.todo.id, title: 'Own' });
    const sharedTask = await insertTask({
      projectId: shared.id,
      columnId: shared.todo.id,
      title: 'Shared',
    });
    await assign(ownTask, alice.id);
    await assign(sharedTask, alice.id);

    const body = await fetchMine(alice);
    expect(body.tasks.map((task) => task.id).sort()).toEqual([ownTask, sharedTask].sort());
    expect(body.tasks.find((task) => task.id === sharedTask)).toMatchObject({
      project_name: 'Bumblebee',
      column_name: 'To Do',
    });
  });

  it('hides an assignment in a project the caller cannot access', async () => {
    const alice = await newCaller();
    const hidden = await createProject(bob, 'Hidden');
    const taskId = await insertTask({
      projectId: hidden.id,
      columnId: hidden.todo.id,
      title: 'Not visible',
    });
    await assign(taskId, alice.id);

    const body = await fetchMine(alice);
    expect(body.tasks).toEqual([]);
  });

  it('excludes tasks in a done column', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Done column');
    const doneTask = await insertTask({
      projectId: project.id,
      columnId: project.done.id,
      title: 'Finished',
    });
    await assign(doneTask, alice.id);

    const body = await fetchMine(alice);
    expect(body.tasks).toEqual([]);
  });

  it('excludes archived tasks', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Archived card');
    const taskId = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Shelved',
    });
    await assign(taskId, alice.id);
    await archiveTask(taskId);

    const body = await fetchMine(alice);
    expect(body.tasks).toEqual([]);
  });

  it('excludes tasks in an archived project', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Archived project');
    const taskId = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Parked',
    });
    await assign(taskId, alice.id);
    await db
      .updateTable('project')
      .set({ archived_at: new Date() })
      .where('id', '=', project.id)
      .execute();

    const body = await fetchMine(alice);
    expect(body.tasks).toEqual([]);
  });

  it('buckets a task another person is waiting on as blocking', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Blocking');
    await addMember(project.id, bob.id);
    const mine = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Mine',
    });
    const theirs = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Theirs',
    });
    await assign(mine, alice.id);
    await assign(theirs, bob.id);
    await blocks(mine, theirs);

    const body = await fetchMine(alice);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].bucket).toBe('blocking');
    expect(body.tasks[0].waiting_user_ids).toEqual([bob.id]);
    expect(body.tasks[0].blocking).toEqual([
      { id: theirs, project_id: project.id, title: 'Theirs', assignee_ids: [bob.id] },
    ]);
  });

  it('ignores a dependent that is done or archived', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Settled dependents');
    await addMember(project.id, bob.id);
    const mine = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Mine',
    });
    const finished = await insertTask({
      projectId: project.id,
      columnId: project.done.id,
      title: 'Finished dependent',
    });
    const shelved = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Shelved dependent',
    });
    await assign(mine, alice.id);
    await assign(finished, bob.id);
    await assign(shelved, bob.id);
    await archiveTask(shelved);
    await blocks(mine, finished);
    await blocks(mine, shelved);

    const body = await fetchMine(alice);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].blocking).toEqual([]);
    expect(body.tasks[0].waiting_user_ids).toEqual([]);
    expect(body.tasks[0].bucket).toBe('ready');
  });

  it('buckets a task with an unfinished blocker as blocked and names the blocker assignee', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Blocked');
    await addMember(project.id, bob.id);
    const mine = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Mine',
    });
    const blocker = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Blocker',
    });
    await assign(mine, alice.id);
    await assign(blocker, bob.id);
    await blocks(blocker, mine);

    const body = await fetchMine(alice);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].bucket).toBe('blocked');
    expect(body.tasks[0].blocked_by).toEqual([
      { id: blocker, project_id: project.id, title: 'Blocker', assignee_ids: [bob.id] },
    ]);
  });

  it('ignores a blocker that is done or archived', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Settled blockers');
    const mine = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Mine',
    });
    const finished = await insertTask({
      projectId: project.id,
      columnId: project.done.id,
      title: 'Finished blocker',
    });
    const shelved = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Shelved blocker',
    });
    await assign(mine, alice.id);
    await archiveTask(shelved);
    await blocks(finished, mine);
    await blocks(shelved, mine);

    const body = await fetchMine(alice);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].blocked_by).toEqual([]);
    expect(body.tasks[0].bucket).toBe('ready');
  });

  it('orders blocking, then ready, then blocked across projects', async () => {
    const alice = await newCaller();
    const first = await createProject(alice, 'Zulu');
    const second = await createProject(alice, 'Alpha');
    await addMember(first.id, bob.id);

    const blocking = await insertTask({
      projectId: first.id,
      columnId: first.todo.id,
      title: 'Blocking',
    });
    const waiter = await insertTask({
      projectId: first.id,
      columnId: first.todo.id,
      title: 'Waiter',
    });
    await assign(waiter, bob.id);
    await blocks(blocking, waiter);

    const ready = await insertTask({
      projectId: second.id,
      columnId: second.todo.id,
      title: 'Ready',
    });
    const blocked = await insertTask({
      projectId: second.id,
      columnId: second.todo.id,
      title: 'Blocked',
    });
    const blocker = await insertTask({
      projectId: second.id,
      columnId: second.todo.id,
      title: 'Blocker',
    });
    await blocks(blocker, blocked);
    for (const taskId of [blocking, ready, blocked]) {
      await assign(taskId, alice.id);
    }

    const body = await fetchMine(alice);
    expect(body.tasks.map((task) => task.bucket)).toEqual(['blocking', 'ready', 'blocked']);
    expect(body.tasks.map((task) => task.id)).toEqual([blocking, ready, blocked]);
  });

  it('breaks ties by project name, then board column, then position within the column', async () => {
    const alice = await newCaller();
    const zulu = await createProject(alice, 'Zulu ordering');
    const alpha = await createProject(alice, 'Alpha ordering');

    const zuluTask = await insertTask({
      projectId: zulu.id,
      columnId: zulu.todo.id,
      title: 'Later project',
    });
    const alphaLater = await insertTask({
      projectId: alpha.id,
      columnId: alpha.todo.id,
      title: 'Lower in the column',
      sort_key: rankKey(2000),
    });
    const alphaEarlier = await insertTask({
      projectId: alpha.id,
      columnId: alpha.todo.id,
      title: 'Top of the column',
      sort_key: rankKey(1000),
    });
    // A high position in a leftward column still outranks the whole next column.
    const alphaBacklog = await insertTask({
      projectId: alpha.id,
      columnId: alpha.backlog.id,
      title: 'Leftmost column',
      sort_key: rankKey(9000),
    });
    for (const taskId of [zuluTask, alphaLater, alphaEarlier, alphaBacklog]) {
      await assign(taskId, alice.id);
    }

    const body = await fetchMine(alice);
    expect(body.tasks.map((task) => task.id)).toEqual([
      alphaBacklog,
      alphaEarlier,
      alphaLater,
      zuluTask,
    ]);
  });

  it('orders blockers and dependents by title', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Link ordering');
    await addMember(project.id, bob.id);
    const mine = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Mine',
    });
    const zuluBlocker = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Zulu blocker',
    });
    const alphaBlocker = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Alpha blocker',
    });
    const zuluDependent = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Zulu dependent',
    });
    const alphaDependent = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Alpha dependent',
    });
    await assign(mine, alice.id);
    await assign(zuluDependent, bob.id);
    await assign(alphaDependent, bob.id);
    await blocks(zuluBlocker, mine);
    await blocks(alphaBlocker, mine);
    await blocks(mine, zuluDependent);
    await blocks(mine, alphaDependent);

    const body = await fetchMine(alice);
    expect(body.tasks[0].blocked_by.map((link) => link.title)).toEqual([
      'Alpha blocker',
      'Zulu blocker',
    ]);
    expect(body.tasks[0].blocking.map((link) => link.title)).toEqual([
      'Alpha dependent',
      'Zulu dependent',
    ]);
    expect(body.waiting_on_you[0].tasks.map((link) => link.title)).toEqual([
      'Alpha dependent',
      'Zulu dependent',
    ]);
  });

  it('keeps the caller in assignee_ids of a co-assigned task', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Co-assigned');
    await addMember(project.id, bob.id);
    const taskId = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Shared work',
    });
    await assign(taskId, alice.id);
    await assign(taskId, bob.id);

    const body = await fetchMine(alice);
    expect(body.tasks[0].assignee_ids.sort()).toEqual([alice.id, bob.id].sort());
  });

  it('groups the people waiting on the caller and never emits an unassigned group', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'Waiting on you');
    await addMember(project.id, bob.id);
    const mine = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Mine',
    });
    const firstWaiter = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Waiter one',
    });
    const secondWaiter = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Waiter two',
    });
    const orphan = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Nobody owns this',
    });
    await assign(mine, alice.id);
    await assign(firstWaiter, bob.id);
    await assign(secondWaiter, bob.id);
    await blocks(mine, firstWaiter);
    await blocks(mine, secondWaiter);
    await blocks(mine, orphan);

    const body = await fetchMine(alice);
    expect(body.waiting_on_you).toHaveLength(1);
    expect(body.waiting_on_you[0].user_id).toBe(bob.id);
    expect(body.waiting_on_you[0].tasks.map((task) => task.id).sort()).toEqual(
      [firstWaiter, secondWaiter].sort()
    );
  });

  it('lists an unassigned blocker last under you_are_waiting_on', async () => {
    const alice = await newCaller();
    const project = await createProject(alice, 'You are waiting on');
    await addMember(project.id, bob.id);
    const mine = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Mine',
    });
    const namedBlocker = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Named blocker',
    });
    const orphanBlocker = await insertTask({
      projectId: project.id,
      columnId: project.todo.id,
      title: 'Orphan blocker',
    });
    await assign(mine, alice.id);
    await assign(namedBlocker, bob.id);
    await blocks(namedBlocker, mine);
    await blocks(orphanBlocker, mine);

    const body = await fetchMine(alice);
    expect(body.you_are_waiting_on.map((group) => group.user_id)).toEqual([bob.id, null]);
    expect(body.you_are_waiting_on[1].tasks.map((task) => task.id)).toEqual([orphanBlocker]);
  });
});
