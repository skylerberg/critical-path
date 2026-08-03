import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { board } from './board.svelte';
import type { BoardTask } from './board-types';
import { CARD_ACTION_KEYS } from './card-actions';
import {
  flattenRows,
  matchTier,
  paletteChordHint,
  paletteGroups,
  type PaletteContext,
  type PaletteGroup,
} from './palette';
import { router } from './router.svelte';
import { searchPath, type SearchResult } from './search-query';
import { selection } from './selection.svelte';
import { session } from './session.svelte';
import { projectHref, taskHref } from './short-links';
import { shortcuts } from './shortcuts.svelte';
import { testUuid } from './test-ids';

const PROJECT_ID = testUuid('p1');
const OTHER_PROJECT_ID = testUuid('p2');
const TASK_ID = testUuid('t1');

function context(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    query: '',
    card: null,
    current: null,
    projects: [],
    columns: [],
    labels: [],
    tasks: [],
    ...overrides,
  };
}

function group(groups: PaletteGroup[], key: PaletteGroup['key']): PaletteGroup | undefined {
  return groups.find((g) => g.key === key);
}

function labels(groups: PaletteGroup[], key: PaletteGroup['key']): string[] {
  return group(groups, key)?.rows.map((row) => row.label) ?? [];
}

function searchResult(taskKey: string, title: string, projectName = 'Colori'): SearchResult {
  return {
    task_id: testUuid(taskKey),
    title,
    project_id: PROJECT_ID,
    project_name: projectName,
    column_name: 'In Progress',
  };
}

describe('matchTier', () => {
  it('ranks everything equally on an empty query', () => {
    expect(matchTier('', 'Anything', PROJECT_ID)).toBe(0);
    expect(matchTier('   ', 'Anything')).toBe(0);
  });

  it('puts an exact id first, case-insensitively', () => {
    expect(matchTier(PROJECT_ID.toUpperCase(), 'Colori', PROJECT_ID)).toBe(0);
  });

  it('puts an exact name second', () => {
    expect(matchTier('colori', 'Colori', PROJECT_ID)).toBe(1);
  });

  it('accepts an id prefix only from a ref that could be one', () => {
    expect(matchTier(PROJECT_ID.slice(0, 8), 'Colori', PROJECT_ID)).toBe(2);
    // Same leading characters, but 'zzzz' can never be the head of a uuid.
    expect(matchTier('zzzz', 'Colori', `zzzz${PROJECT_ID.slice(4)}`)).toBeNull();
  });

  it('puts a name prefix ahead of a name substring', () => {
    expect(matchTier('col', 'Colori', PROJECT_ID)).toBe(3);
    expect(matchTier('lor', 'Colori', PROJECT_ID)).toBe(4);
  });

  it('is a miss when nothing matches', () => {
    expect(matchTier('zzz', 'Colori', PROJECT_ID)).toBeNull();
  });

  it('matches on the name alone when there is no id to try', () => {
    expect(matchTier('mark', 'Mark done')).toBe(3);
    expect(matchTier('done', 'Mark done')).toBe(4);
  });
});

describe('paletteGroups — actions', () => {
  const card = { title: 'Design cards', completable: true };

  it('is absent with no card in context', () => {
    expect(group(paletteGroups(context()), 'actions')).toBeUndefined();
  });

  it('leads the list, in the right-click menu order, and names the card', () => {
    const groups = paletteGroups(context({ card }));

    expect(groups[0]?.key).toBe('actions');
    expect(groups[0]?.heading).toBe('Actions — Design cards');
    expect(labels(groups, 'actions')).toEqual([
      'Labels…',
      'Assignees…',
      'Blocked by…',
      'Blocks…',
      'Move to…',
      'Mark done',
      'Duplicate',
      'Archive',
      'Copy link',
    ]);
  });

  it('drops Mark done for a card that cannot be completed', () => {
    const groups = paletteGroups(context({ card: { ...card, completable: false } }));

    expect(labels(groups, 'actions')).not.toContain('Mark done');
    expect(labels(groups, 'actions')).toContain('Duplicate');
  });

  it('advertises exactly the keys the keymap table holds, and none for Archive', () => {
    const rows = group(paletteGroups(context({ card })), 'actions')!.rows;

    for (const row of rows) {
      expect(row.kind).toBe('action');
      if (row.kind !== 'action') {
        continue;
      }
      expect(row.keys).toEqual(CARD_ACTION_KEYS[row.action]);
    }
    expect(rows.find((row) => row.label === 'Archive')?.keys).toEqual([]);
    expect(rows.find((row) => row.label === 'Copy link')?.keys).toEqual([]);
  });

  it('filters rather than reorders as the query narrows', () => {
    const groups = paletteGroups(context({ card, query: 'bloc' }));

    expect(labels(groups, 'actions')).toEqual(['Blocked by…', 'Blocks…']);
  });

  it('drops the whole group when nothing matches', () => {
    expect(group(paletteGroups(context({ card, query: 'zzz' })), 'actions')).toBeUndefined();
  });
});

describe('paletteGroups — go to', () => {
  const current = {
    projectId: PROJECT_ID,
    projectName: 'Colori',
    filterSearch: '?q=boss',
  };

  it('offers only the cross-project screens with no project in context', () => {
    expect(labels(paletteGroups(context()), 'go')).toEqual([
      'My tasks',
      'All projects',
      'Search all projects',
    ]);
  });

  it('adds the board and the graph, carrying the live filters, when one is current', () => {
    const rows = group(paletteGroups(context({ current })), 'go')!.rows;
    const href = (label: string): string | undefined => {
      const row = rows.find((r) => r.label === label);
      return row?.kind === 'go' ? row.href : undefined;
    };

    expect(rows.map((row) => row.label)).toEqual([
      'Board',
      'Graph',
      'My tasks',
      'All projects',
      'Search all projects',
    ]);
    expect(href('Board')).toBe(projectHref(PROJECT_ID, 'Colori') + '?q=boss');
    expect(href('Graph')).toBe(projectHref(PROJECT_ID, 'Colori', 'graph') + '?q=boss');
    expect(href('My tasks')).toBe('/my-tasks');
    expect(href('All projects')).toBe('/');
  });

  it('prints the chord each row is reached by today', () => {
    const rows = group(paletteGroups(context({ current })), 'go')!.rows;
    const keys = Object.fromEntries(rows.map((row) => [row.label, row.keys]));

    expect(keys).toMatchObject({
      Board: ['g', 'b'],
      Graph: ['g', 'g'],
      'My tasks': ['g', 'm'],
      'All projects': ['g', 'p'],
      'Search all projects': ['/'],
    });
    expect(rows.find((row) => row.label === 'Board')?.chord).toBe(true);
    expect(rows.find((row) => row.label === 'Search all projects')?.chord).toBe(false);
  });

  it('keeps the search row last and unfiltered, carrying the query', () => {
    const rows = group(paletteGroups(context({ current, query: 'zzzz' })), 'go')!.rows;

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.label).toBe('Search all projects for “zzzz”');
    expect(row.kind === 'go' && row.href).toBe(searchPath('zzzz'));
  });
});

describe('paletteGroups — projects', () => {
  const projects = [
    { id: testUuid('a'), name: 'Zeta' },
    { id: testUuid('b'), name: 'Colori' },
    { id: testUuid('c'), name: 'Watercolour' },
  ];

  it('is absent with no projects to show', () => {
    expect(group(paletteGroups(context()), 'projects')).toBeUndefined();
  });

  it('keeps the sidebar order on an empty query', () => {
    expect(labels(paletteGroups(context({ projects })), 'projects')).toEqual([
      'Zeta',
      'Colori',
      'Watercolour',
    ]);
  });

  it('ranks by tier and stays stable inside one', () => {
    const ranked = [
      { id: testUuid('d'), name: 'Recolour' },
      { id: testUuid('e'), name: 'Colouring' },
      { id: testUuid('f'), name: 'Colour' },
    ];

    expect(
      labels(paletteGroups(context({ projects: ranked, query: 'colour' })), 'projects')
    ).toEqual(['Colour', 'Colouring', 'Recolour']);
  });

  it('finds a project by an id prefix', () => {
    const groups = paletteGroups(context({ projects, query: projects[1]!.id.slice(0, 8) }));

    expect(labels(groups, 'projects')).toEqual(['Colori']);
  });

  it('links each row at its board', () => {
    const row = group(paletteGroups(context({ projects, query: 'Colori' })), 'projects')!.rows[0]!;

    expect(row.kind === 'go' && row.href).toBe(projectHref(projects[1]!.id, 'Colori'));
    expect(row.keys).toEqual([]);
  });
});

describe('paletteGroups — tasks', () => {
  const tasks = [
    searchResult('t-1', 'Ship the export API'),
    searchResult('t-2', 'Export docs', 'Atlas'),
  ];

  it('is absent until something is typed, even with results in hand', () => {
    expect(group(paletteGroups(context({ tasks })), 'tasks')).toBeUndefined();
  });

  it('keeps the order the server returned and names the project and column', () => {
    const rows = group(paletteGroups(context({ tasks, query: 'export' })), 'tasks')!.rows;

    expect(rows.map((row) => row.label)).toEqual(['Ship the export API', 'Export docs']);
    expect(rows.map((row) => row.detail)).toEqual(['Colori · In Progress', 'Atlas · In Progress']);
    expect(rows[0]!.kind === 'task' && rows[0]!.href).toBe(
      taskHref(testUuid('t-1'), 'Ship the export API')
    );
  });

  it('carries the project each task belongs to', () => {
    const row = group(paletteGroups(context({ tasks, query: 'export' })), 'tasks')!.rows[0]!;

    expect(row.kind).toBe('task');
    if (row.kind === 'task') {
      expect(row.taskId).toBe(testUuid('t-1'));
      expect(row.projectId).toBe(PROJECT_ID);
    }
  });
});

describe('paletteGroups — columns and labels', () => {
  const card = { title: 'Design cards', completable: true };
  const columns = [
    { id: 'c1', name: 'Todo' },
    { id: 'c2', name: 'Doing' },
    { id: 'c3', name: 'Done' },
  ];
  const boardLabels = [
    { id: 'l1', name: 'art' },
    { id: 'l2', name: 'rules' },
  ];

  it('offers neither without an editable card to act on', () => {
    const groups = paletteGroups(context({ columns, labels: boardLabels, query: 'do' }));

    expect(group(groups, 'columns')).toBeUndefined();
    expect(group(groups, 'labels')).toBeUndefined();
  });

  it('waits for a query rather than repeating the menus a row above already opens', () => {
    const groups = paletteGroups(context({ card, columns, labels: boardLabels }));

    expect(group(groups, 'columns')).toBeUndefined();
    expect(group(groups, 'labels')).toBeUndefined();
  });

  it('matches column names, ranking a prefix ahead of a buried match', () => {
    const groups = paletteGroups(context({ card, columns, query: 'do' }));

    expect(labels(groups, 'columns')).toEqual(['Doing', 'Done', 'Todo']);
  });

  it('matches label names', () => {
    const groups = paletteGroups(context({ card, labels: boardLabels, query: 'rul' }));

    expect(labels(groups, 'labels')).toEqual(['rules']);
  });

  it('carries the name to seed the menu with, and names that menu', () => {
    const column = group(paletteGroups(context({ card, columns, query: 'done' })), 'columns')!
      .rows[0]!;
    const label = group(
      paletteGroups(context({ card, labels: boardLabels, query: 'art' })),
      'labels'
    )!.rows[0]!;
    const actionLabels = labels(paletteGroups(context({ card })), 'actions');

    expect(column.kind === 'column' && column.prefill).toBe('Done');
    expect(label.kind === 'label' && label.prefill).toBe('art');
    // Asserted against the action rows too: the detail promises where Enter lands,
    // so it has to stay the menu's own wording rather than a second name for it.
    expect(column.detail).toBe('Move to…');
    expect(label.detail).toBe('Labels…');
    expect(actionLabels).toContain(column.detail);
    expect(actionLabels).toContain(label.detail);
  });

  it('ranks below the card and project results', () => {
    const groups = paletteGroups(
      context({
        card,
        columns,
        labels: [...boardLabels, { id: 'l3', name: 'docs' }],
        projects: [{ id: testUuid('p9'), name: 'Doodles' }],
        tasks: [searchResult('t-1', 'Do the thing')],
        query: 'do',
      })
    );

    expect(groups.map((g) => g.key)).toEqual([
      'actions',
      'go',
      'projects',
      'tasks',
      'columns',
      'labels',
    ]);
  });
});

describe('flattenRows', () => {
  it('numbers every row once, in group order', () => {
    const groups = paletteGroups(
      context({
        card: { title: 'Design cards', completable: true },
        current: { projectId: PROJECT_ID, projectName: 'Colori', filterSearch: '' },
        projects: [{ id: OTHER_PROJECT_ID, name: 'Atlas' }],
        tasks: [searchResult('t-1', 'Ship it')],
        query: '',
      })
    );
    const rows = flattenRows(groups);

    expect(rows).toHaveLength(groups.reduce((total, g) => total + g.rows.length, 0));
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(rows.map((row) => row.key)).toEqual(groups.flatMap((g) => g.rows.map((r) => r.key)));
  });
});

describe('paletteChordHint', () => {
  afterEach(() => {
    delete (navigator as { userAgent?: string }).userAgent;
  });

  it('names the modifier the platform actually answers to', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      configurable: true,
    });
    expect(paletteChordHint()).toBe('⌘ K');

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      configurable: true,
    });
    expect(paletteChordHint()).toBe('Ctrl K');
  });
});

// Every hint the palette prints is pressed through the real keymap, so a row that
// advertises a key the keymap does not bind fails here.
describe('advertised keys really are bound', () => {
  const me = {
    id: 'u-me',
    name: 'Ada',
    email: 'ada@example.com',
    avatar_url: null,
    email_verified: false,
  };

  function task(id: string, columnId: string, position: number, title: string): BoardTask {
    return {
      id,
      column_id: columnId,
      title,
      description: null,
      position,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      column_since: '2026-01-01T00:00:00Z',
      label_ids: [],
      assignee_ids: [],
      blocker_ids: [],
      attachment_count: 0,
      image_count: 0,
      cover_image_url: null,
      due_date: null,
      comment_count: 0,
      checklist_item_count: 0,
      checklist_done_count: 0,
    };
  }

  function press(hint: string): void {
    const shiftKey = hint.startsWith('Shift+');
    shortcuts.handleKeydown(
      new KeyboardEvent('keydown', {
        key: shiftKey ? hint.slice('Shift+'.length) : hint,
        shiftKey,
        cancelable: true,
      })
    );
  }

  beforeEach(() => {
    board.reset();
    selection.clear();
    shortcuts.reset();
    board.currentProjectId = PROJECT_ID;
    board.project = {
      id: PROJECT_ID,
      name: 'Colori',
      description: '',
      archived_at: null,
      created_by: me.id,
      member_ids: [],
      members: [],
      is_public: false,
      color: null,
      created_at: '2026-01-01T00:00:00Z',
    };
    board.columns = [
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'done', name: 'Done', position: 2000, is_done: true },
    ];
    board.tasks = [task(TASK_ID, 'c1', 1000, 'Design cards')];
    router.navigate(projectHref(PROJECT_ID, 'Colori'), { replace: true });
    session.user = me;
    selection.set(TASK_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const effects: Record<string, () => void> = {
    'Labels…': () => expect(shortcuts.labelMenu).toBe(TASK_ID),
    'Assignees…': () => expect(shortcuts.assigneeMenu).toBe(TASK_ID),
    'Blocked by…': () =>
      expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_ID, direction: 'blocker' }),
    'Blocks…': () =>
      expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_ID, direction: 'blocked' }),
    'Move to…': () => expect(shortcuts.moveMenu).toBe(TASK_ID),
  };

  const actionRows = paletteGroups(
    context({ card: { title: 'Design cards', completable: true } })
  )[0]!.rows;

  for (const row of actionRows.filter((r) => r.keys.length > 0 && effects[r.label] !== undefined)) {
    it(`${row.label} really is bound to ${row.keys.join(' ')}`, () => {
      for (const hint of row.keys) {
        shortcuts.reset();
        press(hint);
        effects[row.label]!();
      }
    });
  }

  it('Mark done really is bound to d', () => {
    const markTaskDone = vi.spyOn(board, 'markTaskDone').mockReturnValue(true);

    for (const hint of actionRows.find((row) => row.label === 'Mark done')!.keys) {
      press(hint);
    }

    expect(markTaskDone).toHaveBeenCalledWith(TASK_ID);
  });

  it('Duplicate really is bound to Shift+D', () => {
    const duplicateTask = vi.spyOn(board, 'duplicateTask').mockResolvedValue(testUuid('t2'));

    for (const hint of actionRows.find((row) => row.label === 'Duplicate')!.keys) {
      press(hint);
    }

    expect(duplicateTask).toHaveBeenCalledWith(TASK_ID);
  });

  it('leaves Archive without a key, which is why the palette is its keyboard path', () => {
    expect(actionRows.find((row) => row.label === 'Archive')!.keys).toEqual([]);
  });

  // Nothing else in the suite presses these, so the palette is where a broken
  // navigation hint would first show up.
  it('reaches every screen by the chord its row prints', () => {
    const rows = group(
      paletteGroups(
        context({
          current: { projectId: PROJECT_ID, projectName: 'Colori', filterSearch: '' },
        })
      ),
      'go'
    )!.rows;

    for (const row of rows) {
      expect(row.kind).toBe('go');
      if (row.kind !== 'go') {
        continue;
      }
      shortcuts.reset();
      router.navigate(projectHref(PROJECT_ID, 'Colori'), { replace: true });
      for (const hint of row.keys) {
        press(hint);
      }
      expect(router.path).toBe(row.href);
    }
  });
});
