import type { ProjectExport, TiptapDoc, TiptapNode } from '../../schemas/index';

// Excel assumes the platform's legacy code page without it and mangles every
// non-ASCII title.
const UTF8_BOM = '\ufeff';

const BLOCK_NODES = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem']);

const TASKS_CSV_HEADER = [
  'id',
  'title',
  'column',
  'is_done',
  'position',
  'labels',
  'assignees',
  'blocked_by',
  'image_count',
  'created_at',
  'updated_at',
  'description',
];

function quoteField(field: string): string {
  if (/["\r\n,]/.test(field) || field !== field.trim()) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => `${row.map(quoteField).join(',')}\r\n`).join('');
}

export function tiptapToPlainText(doc: TiptapDoc | null): string {
  if (doc === null) return '';

  let text = '';
  const walk = (node: TiptapNode): void => {
    if (node.type === 'text') {
      text += node.text ?? '';
      return;
    }
    if (node.type === 'hardBreak') {
      text += '\n';
      return;
    }
    if (node.type === 'image' || node.type === 'horizontalRule') {
      return;
    }
    for (const child of node.content ?? []) {
      walk(child);
    }
    if (BLOCK_NODES.has(node.type) && text.length > 0 && !text.endsWith('\n')) {
      text += '\n';
    }
  };
  walk(doc);

  return text.replace(/\n+$/, '');
}

type NameIndex = Map<string, { order: number; name: string }>;

function nameIndex(named: Array<{ id: string; name: string }>): NameIndex {
  return new Map(named.map(({ id, name }, order) => [id, { order, name }]));
}

// The id lists are ordered by id, which is meaningless to a reader and unstable
// across a re-import, so names come out in the order of the collection that
// names them: labels and users by name, blockers by board position.
function resolveNames(ids: string[], index: NameIndex): string {
  const found: Array<{ order: number; name: string }> = [];
  for (const id of ids) {
    const entry = index.get(id);
    if (entry !== undefined) {
      found.push(entry);
    }
  }
  return found
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.name)
    .join('; ');
}

export function tasksCsv(exportPayload: ProjectExport): string {
  const columns = new Map(exportPayload.columns.map((column) => [column.id, column]));
  const labelNames = nameIndex(exportPayload.labels);
  const userEmails = nameIndex(exportPayload.users.map(({ id, email }) => ({ id, name: email })));
  const taskTitles = nameIndex(exportPayload.tasks.map(({ id, title }) => ({ id, name: title })));

  const rows = [TASKS_CSV_HEADER];
  for (const task of exportPayload.tasks) {
    const column = columns.get(task.column_id);
    rows.push([
      task.id,
      task.title,
      column?.name ?? '',
      column === undefined ? '' : String(column.is_done),
      String(task.position),
      resolveNames(task.label_ids, labelNames),
      resolveNames(task.assignee_ids, userEmails),
      resolveNames(task.blocker_ids, taskTitles),
      String(task.images.length),
      task.created_at,
      task.updated_at,
      tiptapToPlainText(task.description),
    ]);
  }

  return UTF8_BOM + toCsv(rows);
}
