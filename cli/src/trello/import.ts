import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { spreadBetween } from '../positions';
import { ApiError, CriticalPathClient, inParallel } from './client';
import { actionCardId, loadBoard, type TrelloBoard } from './export';
import { buildPlan, type ImportPlan, type PlannedTask, type SourceComment } from './plan';
import { downloadAttachment, fetchComments, readCredentials } from './trelloApi';
import { verifyImport } from './verify';

interface Cli {
  file: string;
  project: string;
  apiUrl: string;
  token?: string;
  assignee: string[];
  doneList: string[];
  addMember: string[];
  concurrency: string;
  cacheDir: string;
  preflight?: boolean;
  verifyOnly?: boolean;
  commentsFromExport?: boolean;
  skipAttachments?: boolean;
}

const program = new Command()
  .name('import-trello')
  .description('Import a Trello board export into a Critical Path project')
  .requiredOption('-f, --file <path>', 'Trello board JSON export')
  .requiredOption('-p, --project <uuid>', 'target Critical Path project id')
  .option('--api-url <url>', 'Critical Path API base URL', 'https://criticalpath.skylerberg.com')
  .option('--token <token>', 'Critical Path token (default: $CRITICAL_PATH_TOKEN)')
  .option(
    '--assignee <map>',
    'Trello username=Critical Path user uuid (repeatable)',
    (value: string, previous: string[]) => [...previous, value],
    []
  )
  .option(
    '--done-list <name>',
    'Trello list whose column is a done column (repeatable)',
    (value: string, previous: string[]) => [...previous, value],
    []
  )
  .option(
    '--add-member <uuid>',
    'user to add to the project as an editor once the import lands (repeatable)',
    (value: string, previous: string[]) => [...previous, value],
    []
  )
  .option('-c, --concurrency <n>', 'concurrent requests', '6')
  .option(
    '--cache-dir <path>',
    'where fetched Trello data is cached',
    join(homedir(), '.cache', 'trello-import')
  )
  .option(
    '--comments-from-export',
    'use only the comments in the export file rather than fetching from Trello (the export holds the most recent 1000 actions of every kind, so on an old board this is a small fraction)'
  )
  .option('--skip-attachments', 'do not download or upload attachments')
  .option('--preflight', 'convert and report, write nothing')
  .option('--verify-only', 'skip the import and only check the live board against the export');

const options = program.parse().opts<Cli>();

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

function progress(label: string): (done: number, total: number) => void {
  let last = 0;
  return (done, total) => {
    if (done !== total && done - last < 25) return;
    last = done;
    process.stderr.write(
      `\r  ${label}: ${String(done)}/${String(total)}${done === total ? '\n' : ''}`
    );
  };
}

async function cached<T>(path: string, produce: () => Promise<T>): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    const value = await produce();
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(value));
    return value;
  }
}

// The export's own action log, which Trello caps at the most recent 1000 entries
// of every kind. On a board of any age that is a small fraction of the comments;
// it is the fallback, not the source.
function commentsFromExport(board: TrelloBoard): SourceComment[] {
  const comments: SourceComment[] = [];
  for (const action of board.actions) {
    const cardId = actionCardId(action.data);
    if (action.type !== 'commentCard' || cardId === null || action.data.text === undefined)
      continue;
    comments.push({
      id: action.id,
      cardId,
      author: action.memberCreator?.fullName ?? action.memberCreator?.username ?? 'a Trello user',
      date: action.date,
      text: action.data.text,
    });
  }
  return comments;
}

async function loadComments(board: TrelloBoard, cacheDir: string): Promise<SourceComment[]> {
  if (options.commentsFromExport === true) return commentsFromExport(board);
  const path = join(cacheDir, `${board.id}-comments.json`);
  return cached(path, async () => {
    const credentials = readCredentials();
    log('Fetching comments from the Trello API (the export caps its action log at 1000)...');
    const comments = await fetchComments(board.id, credentials, (count) => {
      process.stderr.write(`\r  comments fetched: ${String(count)}`);
    });
    process.stderr.write('\n');
    return comments;
  });
}

async function loadAttachmentBytes(
  plan: ImportPlan,
  cacheDir: string
): Promise<Map<string, Buffer>> {
  const bytes = new Map<string, Buffer>();
  if (plan.attachments.length === 0 || options.skipAttachments === true) return bytes;
  const credentials = readCredentials();
  await mkdir(join(cacheDir, 'attachments'), { recursive: true });
  log(`Downloading ${String(plan.attachments.length)} attachments from Trello...`);
  for (const attachment of plan.attachments) {
    const path = join(cacheDir, 'attachments', attachment.id);
    try {
      bytes.set(attachment.id, await readFile(path));
    } catch {
      const buffer = await downloadAttachment(attachment.url, credentials);
      await writeFile(path, buffer);
      bytes.set(attachment.id, buffer);
    }
  }
  return bytes;
}

function reportPlan(board: TrelloBoard, plan: ImportPlan, bytes: Map<string, Buffer> | null): void {
  const expectedComments = board.cards.reduce((total, card) => total + card.badges.comments, 0);
  log('');
  log(`Board "${board.name}" -> project ${options.project}`);
  log('');
  log(`  columns          ${String(plan.columns.length)}`);
  for (const column of plan.columns) {
    const tasks = plan.tasks.filter((task) => task.columnId === column.id);
    const archived = tasks.filter((task) => task.archived).length;
    log(
      `    ${column.name.padEnd(24)} ${String(tasks.length).padStart(5)} ` +
        `(${String(tasks.length - archived)} open, ${String(archived)} archived)` +
        `${column.isDone ? '  [done]' : ''}`
    );
  }
  log(`  labels           ${String(plan.labels.length)}`);
  log(
    `  tasks            ${String(plan.tasks.length)}  (${String(plan.tasks.filter((t) => t.archived).length)} archived)`
  );
  log(`  labelled tasks   ${String(plan.tasks.filter((t) => t.labelIds.length > 0).length)}`);
  log(`  assigned tasks   ${String(plan.tasks.filter((t) => t.assigneeIds.length > 0).length)}`);
  log(
    `  checklist items  ${String(plan.checklistItems.length)}  (${String(plan.checklistItems.filter((i) => i.checked).length)} checked)`
  );
  log(
    `  attachments      ${String(plan.attachments.length)}  (${String(plan.attachments.filter((a) => a.isCover).length)} covers)${bytes === null ? '' : `, ${String([...bytes.values()].reduce((n, b) => n + b.length, 0))} bytes downloaded`}`
  );
  log(
    `  comments         ${String(plan.comments.length)} of ${String(expectedComments)} the cards claim`
  );
  if (plan.unmappedMembers.size > 0) {
    log('  assignees with no Critical Path account (recorded in each card footer):');
    for (const [name, count] of plan.unmappedMembers) log(`    ${name}: ${String(count)} cards`);
  }
  log('');
  if (plan.comments.length < expectedComments) {
    log(
      `  WARNING: ${String(expectedComments - plan.comments.length)} comments are missing. ` +
        'The export alone holds only the most recent 1000 actions.'
    );
  }
}

function validate(plan: ImportPlan): void {
  const problems: string[] = [];
  for (const task of plan.tasks) {
    const title = task.title.trim();
    if (title.length === 0) problems.push(`card #${String(task.cardNumber)} has an empty title`);
    if (title.length > 2000)
      problems.push(`card #${String(task.cardNumber)} title exceeds 2000 chars`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(title))
      problems.push(`card #${String(task.cardNumber)} title holds a control character`);
    if (JSON.stringify(task.description).length > 100 * 1024)
      problems.push(`card #${String(task.cardNumber)} description exceeds 100 KB`);
  }
  for (const item of plan.checklistItems) {
    if (item.text.trim().length === 0 || item.text.trim().length > 2000)
      problems.push(`checklist item ${item.id} text is empty or over 2000 chars`);
  }
  for (const label of plan.labels) {
    if (label.name.length > 100) problems.push(`label "${label.name}" exceeds 100 chars`);
  }
  if (problems.length > 0) {
    for (const problem of problems) log(`  INVALID: ${problem}`);
    throw new Error(`${String(problems.length)} planned rows would be rejected by the API`);
  }
}

async function createLabels(client: CriticalPathClient, plan: ImportPlan): Promise<void> {
  log(`Labels (${String(plan.labels.length)})`);
  const report = progress('labels');
  await inParallel(
    plan.labels,
    Number(options.concurrency),
    async (label) => {
      await client.createIdempotent('/api/labels', {
        id: label.id,
        project_id: options.project,
        name: label.name,
        color: label.color,
      });
    },
    report
  );
}

async function createColumns(client: CriticalPathClient, plan: ImportPlan): Promise<void> {
  log(`Columns (${String(plan.columns.length)})`);
  const keys = spreadBetween(null, null, plan.columns.length);
  // Sequential: a column's rank is its position on the board.
  for (const [index, column] of plan.columns.entries()) {
    await client.createIdempotent('/api/columns', {
      id: column.id,
      project_id: options.project,
      name: column.name,
      sort_key: keys[index],
      is_done: column.isDone,
    });
  }
}

interface BoardPayload {
  columns: { id: string; name: string }[];
  tasks: { id: string; column_id: string }[];
}

// The project was seeded with default columns when it was created. They are only
// safe to remove once the real ones exist and while they still hold nothing.
async function removeDefaultColumns(client: CriticalPathClient, plan: ImportPlan): Promise<void> {
  const board = (await client.get(`/api/projects/${options.project}`)) as BoardPayload;
  const planned = new Set(plan.columns.map((column) => column.id));
  const occupied = new Set(board.tasks.map((task) => task.column_id));
  const stale = board.columns.filter((column) => !planned.has(column.id));
  for (const column of stale) {
    if (occupied.has(column.id)) {
      log(`  keeping "${column.name}": it holds tasks this import did not create`);
      continue;
    }
    log(`  removing seeded column "${column.name}"`);
    await client.delete(`/api/columns/${column.id}`);
  }
}

async function createTasks(client: CriticalPathClient, plan: ImportPlan): Promise<void> {
  log(`Tasks (${String(plan.tasks.length)})`);
  // Explicit keys rather than append-on-arrival: the server honours a requested
  // key that is free, so the whole run can go out concurrently and still land in
  // Trello's order.
  const withKeys: (PlannedTask & { sortKey: string })[] = [];
  for (const column of plan.columns) {
    const tasks = plan.tasks.filter((task) => task.columnId === column.id);
    const keys = spreadBetween(null, null, tasks.length);
    tasks.forEach((task, index) => withKeys.push({ ...task, sortKey: keys[index]! }));
  }
  await inParallel(
    withKeys,
    Number(options.concurrency),
    async (task) => {
      await client.createIdempotent('/api/tasks', {
        id: task.id,
        project_id: options.project,
        column_id: task.columnId,
        title: task.title.trim(),
        description: task.description,
        sort_key: task.sortKey,
        label_ids: task.labelIds,
        assignee_ids: task.assigneeIds,
      });
    },
    progress('tasks')
  );
}

async function createChecklistItems(client: CriticalPathClient, plan: ImportPlan): Promise<void> {
  log(`Checklist items (${String(plan.checklistItems.length)})`);
  const byTask = new Map<string, ImportPlan['checklistItems']>();
  for (const item of plan.checklistItems) {
    const bucket = byTask.get(item.taskId);
    if (bucket === undefined) byTask.set(item.taskId, [item]);
    else bucket.push(item);
  }
  await inParallel(
    [...byTask.values()],
    Number(options.concurrency),
    async (items) => {
      const keys = spreadBetween(null, null, items.length);
      for (const [index, item] of items.entries()) {
        await client.createIdempotent('/api/checklist-items', {
          id: item.id,
          task_id: item.taskId,
          text: item.text.trim(),
          sort_key: keys[index],
          checked: item.checked,
        });
      }
    },
    progress('cards with checklists')
  );
}

async function uploadAttachments(
  client: CriticalPathClient,
  plan: ImportPlan,
  bytes: Map<string, Buffer>
): Promise<void> {
  if (options.skipAttachments === true) {
    log('Attachments: skipped');
    return;
  }
  log(`Attachments (${String(plan.attachments.length)})`);
  for (const attachment of plan.attachments) {
    const body = bytes.get(attachment.id);
    if (body === undefined) throw new Error(`No bytes downloaded for attachment ${attachment.id}`);
    const query = new URLSearchParams({
      task_id: attachment.taskId,
      id: attachment.id,
      filename: attachment.filename,
    });
    try {
      await client.upload(
        `/api/attachments/files?${query.toString()}`,
        body,
        'application/octet-stream'
      );
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
    }
  }
  const covers = plan.attachments.filter((attachment) => attachment.isCover);
  log(`Covers (${String(covers.length)})`);
  for (const cover of covers) {
    await client.put(`/api/tasks/${cover.taskId}/cover`, { image_id: cover.id });
  }
}

async function createComments(client: CriticalPathClient, plan: ImportPlan): Promise<void> {
  log(`Comments (${String(plan.comments.length)})`);
  const byTask = new Map<string, ImportPlan['comments']>();
  for (const comment of plan.comments) {
    const bucket = byTask.get(comment.taskId);
    if (bucket === undefined) byTask.set(comment.taskId, [comment]);
    else bucket.push(comment);
  }
  // Sequential within a card: comments carry no sort key and read in creation
  // order, so concurrent inserts would shuffle a conversation.
  await inParallel(
    [...byTask.values()],
    Number(options.concurrency),
    async (comments) => {
      for (const comment of comments) {
        await client.createIdempotent('/api/comments', {
          id: comment.id,
          task_id: comment.taskId,
          body: comment.body,
        });
      }
    },
    progress('cards with comments')
  );
}

async function archiveTasks(client: CriticalPathClient, plan: ImportPlan): Promise<void> {
  const ids = plan.tasks.filter((task) => task.archived).map((task) => task.id);
  log(`Archiving (${String(ids.length)})`);
  for (let index = 0; index < ids.length; index += 100) {
    await client.post('/api/tasks/bulk-archive', {
      project_id: options.project,
      task_ids: ids.slice(index, index + 100),
    });
  }
}

// Before the cards, not after: POST /api/tasks rejects an assignee who is not
// already a member, so there is no ordering that both assigns co-workers and
// keeps their assignment notifications quiet. The digest batches them into one
// mail per recipient (900 s / 500 tasks), which is the cost of assigning at all.
async function addMembers(client: CriticalPathClient): Promise<void> {
  if (options.addMember.length === 0) return;
  log(`Adding ${String(options.addMember.length)} project member(s)`);
  await client.put(`/api/projects/${options.project}/members`, {
    user_ids: options.addMember,
    roles: options.addMember.map((userId) => ({ user_id: userId, role: 'editor' })),
  });
}

const token = options.token ?? process.env['CRITICAL_PATH_TOKEN'];
if (token === undefined || token === '') {
  throw new Error('Pass --token or set CRITICAL_PATH_TOKEN');
}

const client = new CriticalPathClient(options.apiUrl, token);
const board = await loadBoard(options.file);

const assigneeMap = new Map<string, string>();
for (const entry of options.assignee) {
  const [username, userId] = entry.split('=');
  if (username === undefined || userId === undefined) {
    throw new Error(`--assignee expects <trello-username>=<uuid>, got "${entry}"`);
  }
  const member = board.members.find((candidate) => candidate.username === username);
  if (member === undefined) throw new Error(`No Trello member named "${username}" on this board`);
  assigneeMap.set(member.id, userId);
}

const comments = await loadComments(board, options.cacheDir);
const plan = buildPlan(board, {
  assigneeMap,
  doneListNames: new Set(options.doneList),
  comments,
});
validate(plan);

const verifyScope = {
  attachments: options.skipAttachments !== true,
  allComments: options.commentsFromExport !== true,
};

if (options.verifyOnly === true) {
  await verifyImport(client, options.project, board, plan, verifyScope);
} else if (options.preflight === true) {
  reportPlan(board, plan, null);
  log('Preflight only: nothing was written.');
} else {
  const bytes = await loadAttachmentBytes(plan, options.cacheDir);
  reportPlan(board, plan, bytes);
  await createLabels(client, plan);
  await createColumns(client, plan);
  await removeDefaultColumns(client, plan);
  await addMembers(client);
  await createTasks(client, plan);
  await createChecklistItems(client, plan);
  await uploadAttachments(client, plan, bytes);
  await createComments(client, plan);
  await archiveTasks(client, plan);
  log('');
  await verifyImport(client, options.project, board, plan, verifyScope);
}
