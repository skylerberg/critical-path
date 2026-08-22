import type { CriticalPathClient } from './client';
import type { TrelloBoard } from './export';
import type { ImportPlan } from './plan';

interface LiveTask {
  id: string;
  title: string;
  column_id: string;
  sort_key: string;
  description: unknown;
  label_ids: string[];
  assignee_ids: string[];
  checklist_item_count: number;
  checklist_done_count: number;
  comment_count: number;
  attachment_count: number;
  cover_image_url: string | null;
}

interface LiveBoard {
  columns: { id: string; name: string; is_done: boolean; sort_key: string }[];
  labels: { id: string; name: string; color: string }[];
  tasks: LiveTask[];
}

class Checks {
  private failures = 0;
  private passes = 0;

  equal(label: string, actual: unknown, expected: unknown): void {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    if (same) {
      this.passes += 1;
      process.stderr.write(`  ok    ${label}: ${JSON.stringify(actual)}\n`);
      return;
    }
    this.failures += 1;
    process.stderr.write(
      `  FAIL  ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`
    );
  }

  skipped(label: string, why: string): void {
    process.stderr.write(`  skip  ${label}: ${why}\n`);
  }

  finish(): void {
    process.stderr.write(
      `\n${String(this.passes)} checks passed, ${String(this.failures)} failed\n`
    );
    if (this.failures > 0) {
      throw new Error(`${String(this.failures)} verification checks failed`);
    }
  }
}

export interface VerifyScope {
  // Phases the run was told to leave alone. Reporting these as failures would
  // make a deliberate partial run look broken.
  attachments: boolean;
  allComments: boolean;
}

export async function verifyImport(
  client: CriticalPathClient,
  projectId: string,
  board: TrelloBoard,
  plan: ImportPlan,
  scope: VerifyScope
): Promise<void> {
  process.stderr.write('Verifying the live board against the Trello export\n');
  const live = (await client.get(`/api/projects/${projectId}`)) as LiveBoard;
  const archived = (
    (await client.get(`/api/projects/${projectId}/archived-tasks`)) as { tasks: LiveTask[] }
  ).tasks;
  const all = [...live.tasks, ...archived];
  const byId = new Map(all.map((task) => [task.id, task]));
  const checks = new Checks();

  checks.equal('total tasks', all.length, plan.tasks.length);
  checks.equal('archived tasks', archived.length, plan.tasks.filter((t) => t.archived).length);
  checks.equal(
    'columns',
    live.columns.map((column) => column.name),
    plan.columns.map((column) => column.name)
  );
  checks.equal(
    'done columns',
    live.columns.filter((column) => column.is_done).map((column) => column.name),
    plan.columns.filter((column) => column.isDone).map((column) => column.name)
  );
  checks.equal('labels', live.labels.length, plan.labels.length);
  checks.equal(
    'label names',
    [...live.labels.map((label) => label.name)].sort(),
    [...plan.labels.map((label) => label.name)].sort()
  );

  for (const column of plan.columns) {
    const planned = plan.tasks.filter((task) => task.columnId === column.id);
    const actual = all.filter((task) => task.column_id === column.id);
    checks.equal(`column "${column.name}" task count`, actual.length, planned.length);
    // Order is the point of the whole sort-key dance: read the column back by
    // key and it must be Trello's order, archived cards in their places.
    const order = [...actual]
      .sort((a, b) => (a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : 0))
      .map((task) => task.id);
    checks.equal(
      `column "${column.name}" order`,
      order.length === planned.length && order.every((id, index) => id === planned[index]?.id),
      true
    );
  }

  const missing = plan.tasks.filter((task) => !byId.has(task.id)).map((task) => task.cardNumber);
  checks.equal('cards missing from the board', missing.slice(0, 10), []);

  let labelMismatch = 0;
  let assigneeMismatch = 0;
  let emptyDescription = 0;
  for (const task of plan.tasks) {
    const actual = byId.get(task.id);
    if (actual === undefined) continue;
    const sortIds = (ids: string[]): string[] => [...ids].sort();
    if (JSON.stringify(sortIds(actual.label_ids)) !== JSON.stringify(sortIds(task.labelIds))) {
      labelMismatch += 1;
    }
    if (
      JSON.stringify(sortIds(actual.assignee_ids)) !== JSON.stringify(sortIds(task.assigneeIds))
    ) {
      assigneeMismatch += 1;
    }
    if (actual.description === null) emptyDescription += 1;
  }
  checks.equal('tasks with wrong labels', labelMismatch, 0);
  checks.equal('tasks with wrong assignees', assigneeMismatch, 0);
  // Every card carries at least the imported-from footer.
  checks.equal('tasks with no description', emptyDescription, 0);

  const sum = (pick: (task: LiveTask) => number): number =>
    all.reduce((total, task) => total + pick(task), 0);
  checks.equal(
    'checklist items',
    sum((task) => task.checklist_item_count),
    plan.checklistItems.length
  );
  checks.equal(
    'checked checklist items',
    sum((task) => task.checklist_done_count),
    plan.checklistItems.filter((item) => item.checked).length
  );
  checks.equal(
    'comments',
    sum((task) => task.comment_count),
    plan.comments.length
  );
  checks.equal(
    'cards carrying comments',
    all.filter((task) => task.comment_count > 0).length,
    new Set(plan.comments.map((comment) => comment.taskId)).size
  );
  if (scope.attachments) {
    checks.equal(
      'attachments',
      sum((task) => task.attachment_count),
      plan.attachments.length
    );
    checks.equal(
      'covers',
      all.filter((task) => task.cover_image_url !== null).length,
      plan.attachments.filter((attachment) => attachment.isCover).length
    );
  } else {
    checks.skipped('attachments and covers', 'this run was told not to import them');
  }

  // What the export itself claims, independent of anything this importer built:
  // the only check that can tell a complete comment import from a truncated one.
  const claimed = board.cards.reduce((total, card) => total + card.badges.comments, 0);
  if (scope.allComments) {
    checks.equal(
      'comments vs the count Trello records on the cards',
      sum((t) => t.comment_count),
      claimed
    );
  } else {
    checks.skipped(
      'comments vs the count Trello records on the cards',
      `${String(sum((t) => t.comment_count))} imported, ${String(claimed)} exist; run without --comments-from-export to fetch the rest`
    );
  }

  checks.finish();
}
