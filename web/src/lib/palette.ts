import { CARD_ACTION_KEYS, type CardActionId } from './card-actions';
import { searchPath, type SearchResult } from './search-query';
import { projectHref, taskHref } from './short-links';
import { truncateTitle } from './titles';
import { isApplePlatform } from './userAgent';

export type PaletteActionId = Extract<
  CardActionId,
  | 'labels'
  | 'assignees'
  | 'blockers'
  | 'blocking'
  | 'move'
  | 'done'
  | 'duplicate'
  | 'archive'
  | 'copyLink'
>;

interface RowBase {
  key: string;
  label: string;
  detail?: string;
  keys: string[];
  // Pressed in sequence rather than together; the chips are separated accordingly.
  chord: boolean;
}

export type PaletteRow =
  | (RowBase & { kind: 'action'; action: PaletteActionId })
  | (RowBase & { kind: 'go'; href: string })
  | (RowBase & { kind: 'task'; href: string; taskId: string; projectId: string })
  | (RowBase & { kind: 'column'; prefill: string })
  | (RowBase & { kind: 'label'; prefill: string });

export interface PaletteGroup {
  key: 'actions' | 'go' | 'projects' | 'tasks' | 'columns' | 'labels';
  heading: string;
  rows: PaletteRow[];
}

export interface PaletteContext {
  query: string;
  card: { title: string; completable: boolean } | null;
  current: { projectId: string; projectName: string; filterSearch: string } | null;
  projects: readonly { id: string; name: string }[];
  columns: readonly { id: string; name: string }[];
  labels: readonly { id: string; name: string }[];
  tasks: readonly SearchResult[];
}

const ID_PREFIX_RE = /^[0-9a-f][0-9a-f-]{3,}$/;

// The CLI's resolution order, ranking where that resolver refuses: a one-shot
// command may reject an ambiguous ref, but a live list has to show the candidates.
// The name tier is split so a prefix beats a match buried mid-word.
export function matchTier(query: string, name: string, id?: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return 0;
  }
  const lowerName = name.toLowerCase();
  const lowerId = id?.toLowerCase();
  if (lowerId === q) {
    return 0;
  }
  if (lowerName === q) {
    return 1;
  }
  if (lowerId !== undefined && ID_PREFIX_RE.test(q) && lowerId.startsWith(q)) {
    return 2;
  }
  if (lowerName.startsWith(q)) {
    return 3;
  }
  return lowerName.includes(q) ? 4 : null;
}

const LABELS_LABEL = 'Labels…';
const MOVE_LABEL = 'Move to…';

// Labels and order are the right-click menu's, so the two teach the same names.
const ACTIONS: { action: PaletteActionId; label: string }[] = [
  { action: 'labels', label: LABELS_LABEL },
  { action: 'assignees', label: 'Assignees…' },
  { action: 'blockers', label: 'Blocked by…' },
  { action: 'blocking', label: 'Blocks…' },
  { action: 'move', label: MOVE_LABEL },
  { action: 'done', label: 'Mark done' },
  { action: 'duplicate', label: 'Duplicate' },
  { action: 'archive', label: 'Archive' },
  { action: 'copyLink', label: 'Copy link' },
];

function actionRows(context: PaletteContext): PaletteRow[] {
  const card = context.card;
  if (card === null) {
    return [];
  }
  return ACTIONS.filter(
    ({ action, label }) =>
      (action !== 'done' || card.completable) && matchTier(context.query, label) !== null
  ).map(({ action, label }) => ({
    kind: 'action',
    key: `action:${action}`,
    label,
    keys: CARD_ACTION_KEYS[action],
    chord: false,
    action,
  }));
}

function goRows(context: PaletteContext): PaletteRow[] {
  const current = context.current;
  const rows: PaletteRow[] = [];
  if (current !== null) {
    rows.push(
      {
        kind: 'go',
        key: 'go:board',
        label: 'Board',
        keys: ['g', 'b'],
        chord: true,
        href: projectHref(current.projectId, current.projectName) + current.filterSearch,
      },
      {
        kind: 'go',
        key: 'go:graph',
        label: 'Graph',
        keys: ['g', 'g'],
        chord: true,
        href: projectHref(current.projectId, current.projectName, 'graph') + current.filterSearch,
      }
    );
  }
  rows.push(
    {
      kind: 'go',
      key: 'go:my-tasks',
      label: 'My tasks',
      keys: ['g', 'm'],
      chord: true,
      href: '/my-tasks',
    },
    {
      kind: 'go',
      key: 'go:projects',
      label: 'All projects',
      keys: ['g', 'p'],
      chord: true,
      href: '/',
    }
  );
  const query = context.query.trim();
  return [
    ...rows.filter((row) => matchTier(context.query, row.label) !== null),
    // Never filtered out: it is where a query that matches nothing else goes, and
    // where the / binding is taught rather than retired.
    {
      kind: 'go',
      key: 'go:search',
      label: query === '' ? 'Search all projects' : `Search all projects for “${query}”`,
      keys: ['/'],
      chord: false,
      href: searchPath(query),
    },
  ];
}

// Ids are internal here — nobody types a column or label id — so only the name
// is offered to the matcher.
function rankedByName<T extends { name: string }>(items: readonly T[], query: string): T[] {
  return items
    .flatMap((item) => {
      const tier = matchTier(query, item.name);
      return tier === null ? [] : [{ item, tier }];
    })
    .sort((a, b) => a.tier - b.tier)
    .map(({ item }) => item);
}

// Neither kind acts: the row only seeds the quick menu that owns the change, so
// both need the editable card the action rows need. Held back until something is
// typed, because the menu each stands for is already a row of its own above.
function columnRows(context: PaletteContext): PaletteRow[] {
  if (context.card === null || context.query.trim() === '') {
    return [];
  }
  return rankedByName(context.columns, context.query).map((column) => ({
    kind: 'column' as const,
    key: `column:${column.id}`,
    label: column.name,
    detail: MOVE_LABEL,
    keys: [],
    chord: false,
    prefill: column.name,
  }));
}

function labelRows(context: PaletteContext): PaletteRow[] {
  if (context.card === null || context.query.trim() === '') {
    return [];
  }
  return rankedByName(context.labels, context.query).map((label) => ({
    kind: 'label' as const,
    key: `label:${label.id}`,
    label: label.name,
    detail: LABELS_LABEL,
    keys: [],
    chord: false,
    prefill: label.name,
  }));
}

function projectRows(context: PaletteContext): PaletteRow[] {
  return context.projects
    .flatMap((project) => {
      const tier = matchTier(context.query, project.name, project.id);
      return tier === null ? [] : [{ project, tier }];
    })
    .sort((a, b) => a.tier - b.tier)
    .map(({ project }) => ({
      kind: 'go' as const,
      key: `project:${project.id}`,
      label: project.name,
      keys: [],
      chord: false,
      href: projectHref(project.id, project.name),
    }));
}

// Server order is kept: it is a global relevance ranking a local sort could only degrade.
function taskRows(context: PaletteContext): PaletteRow[] {
  if (context.query.trim() === '') {
    return [];
  }
  return context.tasks.map((result) => ({
    kind: 'task' as const,
    key: `task:${result.task_id}`,
    label: truncateTitle(result.title),
    detail: `${result.project_name} · ${result.column_name}`,
    keys: [],
    chord: false,
    href: taskHref(result.task_id, result.title),
    taskId: result.task_id,
    projectId: result.project_id,
  }));
}

export function paletteGroups(context: PaletteContext): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  const actions = actionRows(context);
  if (actions.length > 0 && context.card !== null) {
    groups.push({
      key: 'actions',
      heading: `Actions — ${truncateTitle(context.card.title)}`,
      rows: actions,
    });
  }
  groups.push({ key: 'go', heading: 'Go to', rows: goRows(context) });
  const projects = projectRows(context);
  if (projects.length > 0) {
    groups.push({ key: 'projects', heading: 'Projects', rows: projects });
  }
  const tasks = taskRows(context);
  if (tasks.length > 0) {
    groups.push({ key: 'tasks', heading: 'Tasks', rows: tasks });
  }
  // Below the cards and the projects: a name that is both a card and a column is
  // far more often the card the user meant.
  const columns = columnRows(context);
  if (columns.length > 0) {
    groups.push({ key: 'columns', heading: 'Columns', rows: columns });
  }
  const boardLabels = labelRows(context);
  if (boardLabels.length > 0) {
    groups.push({ key: 'labels', heading: 'Labels', rows: boardLabels });
  }
  return groups;
}

export function flattenRows(groups: readonly PaletteGroup[]): PaletteRow[] {
  return groups.flatMap((group) => group.rows);
}

export function paletteChordHint(): string {
  return isApplePlatform(navigator.userAgent) ? '⌘ K' : 'Ctrl K';
}
