import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SHADOW_PLACEHOLDER_ITEM_ID, SOURCES, TRIGGERS, type Options } from 'svelte-dnd-action';
import Board from './Board.svelte';
import { board } from '../lib/board.svelte';
import { cardMenu } from '../lib/card-menu.svelte';
import { draftKey, drafts } from '../lib/drafts.svelte';
import { motion } from '../lib/motion.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { publicTaskHref, taskHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
import type { BoardTask } from '../lib/board-types';

const PROJECT_ID = testUuid('p1');
const OTHER_PROJECT_ID = testUuid('p2');
const T1 = testUuid('t1');
const T2 = testUuid('t2');
const T3 = testUuid('t3');
const T4 = testUuid('t4');
const T5 = testUuid('t5');
const T6 = testUuid('t6');

const { zoneOptions } = vi.hoisted(() => ({ zoneOptions: [] as Options[] }));

// Wraps rather than replaces: the keyboard-drag cases below drive the real action.
vi.mock('svelte-dnd-action', async (importOriginal) => {
  const actual = await importOriginal<typeof import('svelte-dnd-action')>();
  const record = (fn: typeof actual.dndzone) => (node: HTMLElement, options: Options) => {
    zoneOptions.push(options);
    const zone = fn(node, options);
    return {
      update: (next: Options) => {
        zoneOptions.push(next);
        zone.update?.(next);
      },
      destroy: () => zone.destroy?.(),
    };
  };
  return {
    ...actual,
    dndzone: record(actual.dndzone),
    dragHandleZone: record(actual.dragHandleZone),
  };
});

function configsOfType(type: string): Options[] {
  return zoneOptions.filter((options) => options.type === type);
}

function task(id: string, columnId: string, position: number, title: string): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    column_since: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, { users: [] }));
  zoneOptions.length = 0;
  motion.reduced = false;
  board.reset();
  selection.clear();
  cardMenu.reset();
  session.user = null;
  drafts.clearAll();
  board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
  board.tasks = [
    task(T1, 'c1', 1000, 'plain one'),
    task(T2, 'c1', 2000, 'match a'),
    task(T3, 'c1', 3000, 'plain two'),
    task(T4, 'c1', 4000, 'match b'),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function column(): HTMLElement {
  const section = document.querySelector('section[aria-label="Todo"]');
  if (!(section instanceof HTMLElement)) {
    throw new Error('Todo column not rendered');
  }
  return section;
}

function header(columnName: string): HTMLElement {
  const element = document.querySelector(`section[aria-label="${columnName}"] header`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${columnName} header not rendered`);
  }
  return element;
}

function scroller(): HTMLElement {
  const element = document.querySelector('[aria-label="Columns"]')?.parentElement?.parentElement;
  if (!(element instanceof HTMLElement)) {
    throw new Error('Board scroller not rendered');
  }
  return element;
}

function taskList(name = 'Todo tasks'): HTMLElement {
  const element = document.querySelector(`[aria-label="${name}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${name} list not rendered`);
  }
  return element;
}

function addColumnTile(): HTMLElement {
  const element = screen.getByRole('button', { name: '+ Add column' }).parentElement;
  if (!(element instanceof HTMLElement)) {
    throw new Error('Add column tile not rendered');
  }
  return element;
}

function cardTitles(): string[] {
  return [...column().querySelectorAll('[data-task-id] p')].map((p) => p.textContent ?? '');
}

function renderedTaskIds(): string[] {
  return [...column().querySelectorAll<HTMLElement>('[data-task-id]')].map(
    (card) => card.dataset.taskId ?? ''
  );
}

function alertText(): string {
  return document.getElementById('dnd-action-aria-alert')?.textContent ?? '';
}

function patchRequests(): Request[] {
  return fetchMock.mock.calls
    .map((call) => call[0] as Request)
    .filter((request) => request.method === 'PATCH');
}

// The library swaps the lifted card for a placeholder carrying its content under a
// non-task id, and that placeholder is what every consider hands back. Sending the
// untouched cards instead would exercise a list the drag never actually produces.
function shadowed(id: string): unknown[] {
  return board
    .tasksInColumn('c1')
    .map((item) =>
      item.id === id
        ? { ...item, isDndShadowItem: true, id: SHADOW_PLACEHOLDER_ITEM_ID }
        : (item as unknown)
    );
}

function pickUp(id: string, list = 'Todo tasks'): void {
  void fireEvent(
    taskList(list),
    new CustomEvent('consider', {
      detail: {
        items: shadowed(id),
        info: { trigger: TRIGGERS.DRAG_STARTED, id, source: SOURCES.POINTER },
      },
    })
  );
}

function drop(id: string, items: BoardTask[], list = 'Todo tasks'): void {
  void fireEvent(
    taskList(list),
    new CustomEvent('finalize', {
      detail: {
        items,
        info: { trigger: TRIGGERS.DROPPED_INTO_ZONE, id, source: SOURCES.POINTER },
      },
    })
  );
}

async function frames(count = 3): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

describe('Board display order', () => {
  it('renders tasks in pure position order without filters', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });

    await screen.findByText('match a');
    expect(cardTitles()).toEqual(['plain one', 'match a', 'plain two', 'match b']);
  });

  it('renders matching tasks above dimmed ones while a filter is active', async () => {
    board.setFilterQuery('match');
    render(Board, { props: { projectId: PROJECT_ID } });

    await screen.findByText('match a');
    expect(cardTitles()).toEqual(['match a', 'match b', 'plain one', 'plain two']);
    const dimmed = [...column().querySelectorAll<HTMLElement>('[data-task-id] > div')]
      .filter((card) => card.className.includes('opacity-30'))
      .map((card) => card.querySelector('p')?.textContent);
    expect(dimmed).toEqual(['plain one', 'plain two']);
  });
});

describe('Board column header count', () => {
  it('shows the plain total when no filter is active', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });

    await screen.findByText('plain one');
    expect(within(header('Todo')).getByText('4')).toHaveTextContent('4 tasks');
    expect(within(header('Todo')).queryByText(/ of /)).toBeNull();
  });

  it('shows matches and total while a filter is active', async () => {
    board.setFilterQuery('match');
    render(Board, { props: { projectId: PROJECT_ID } });

    await screen.findByText('match a');
    expect(within(header('Todo')).getByText('2 of 4')).toHaveTextContent(
      '2 of 4 tasks match this filter'
    );
  });

  it('updates the header when a filter is applied and cleared after render', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    board.setFilterQuery('match');
    await waitFor(() => expect(within(header('Todo')).getByText('2 of 4')).toBeInTheDocument());

    board.clearFilters();
    await waitFor(() => expect(within(header('Todo')).getByText('4')).toBeInTheDocument());
  });

  it('counts each column separately', async () => {
    board.columns = [
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'c2', name: 'Doing', position: 2000, is_done: false },
    ];
    board.tasks = [
      ...board.tasks,
      task(T5, 'c2', 1000, 'match c'),
      task(T6, 'c2', 2000, 'plain three'),
    ];
    board.setFilterQuery('match');
    render(Board, { props: { projectId: PROJECT_ID } });

    await screen.findByText('match a');
    expect(within(header('Todo')).getByText('2 of 4')).toBeInTheDocument();
    expect(within(header('Doing')).getByText('1 of 2')).toBeInTheDocument();
  });

  it('shows 0 of 0 for a column with no tasks while a filter is active', async () => {
    board.columns = [...board.columns, { id: 'c3', name: 'Empty', position: 3000, is_done: false }];
    board.setFilterQuery('match');
    render(Board, { props: { projectId: PROJECT_ID } });

    await screen.findByText('match a');
    expect(within(header('Empty')).getByText('0 of 0')).toBeInTheDocument();
  });

  it('counts a label filter, not just the title query', async () => {
    board.tasks = board.tasks.map((t) => (t.id === T2 ? { ...t, label_ids: ['l1'] } : t));
    board.filterLabelIds = ['l1'];
    render(Board, { props: { projectId: PROJECT_ID } });

    await screen.findByText('match a');
    expect(within(header('Todo')).getByText('1 of 4')).toBeInTheDocument();
  });
});

describe('Board readonly', () => {
  it('drops every editing affordance', async () => {
    render(Board, { props: { projectId: PROJECT_ID, readonly: true } });

    await screen.findByText('plain one');
    expect(screen.queryByRole('button', { name: '+ Add column' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a task' })).toBeNull();
    expect(document.querySelector('[data-quick-add]')).toBeNull();
    expect(within(header('Todo')).queryByTitle('Rename column')).toBeNull();
    expect(within(header('Todo')).queryByRole('button', { name: 'Options for Todo' })).toBeNull();
    expect(within(header('Todo')).queryByLabelText('Reorder column')).toBeNull();
    expect(within(header('Todo')).getByText('4')).toHaveTextContent('4 tasks');
    expect(within(header('Todo')).queryByRole('button')).toBeNull();
  });

  it('keeps the private card path for a read-only member', async () => {
    render(Board, { props: { projectId: PROJECT_ID, readonly: true } });
    await screen.findByText('plain one');

    expect(column().querySelector('a')).toHaveAttribute('href', taskHref(T1, 'plain one'));
  });

  it('links cards at the public path on a public board', async () => {
    board.readonly = true;
    render(Board, { props: { projectId: PROJECT_ID, readonly: true } });
    await screen.findByText('plain one');

    expect(column().querySelector('a')).toHaveAttribute('href', publicTaskHref(PROJECT_ID, T1));
  });

  it('disables dragging in both dnd zones', async () => {
    render(Board, { props: { projectId: PROJECT_ID, readonly: true } });
    await screen.findByText('plain one');

    for (const type of ['column', 'task']) {
      const options = configsOfType(type).at(-1);
      expect(options?.dragDisabled).toBe(true);
      expect(options?.dropFromOthersDisabled).toBe(true);
    }
    expect(configsOfType('task').at(-1)?.zoneItemTabIndex).toBe(-1);
  });

  it('keeps every affordance and the private path when not readonly', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });

    await screen.findByText('plain one');
    expect(screen.getByRole('button', { name: '+ Add column' })).toBeInTheDocument();
    expect(within(header('Todo')).getByTitle('Rename column')).toBeInTheDocument();
    expect(
      within(header('Todo')).getByRole('button', { name: 'Options for Todo' })
    ).toBeInTheDocument();
    expect(column().querySelector('a')).toHaveAttribute('href', taskHref(T1, 'plain one'));
    expect(configsOfType('task').at(-1)?.dragDisabled).toBe(false);
    expect(configsOfType('task').at(-1)?.zoneItemTabIndex).toBe(0);
  });
});

describe('Board snapping', () => {
  it('centers snap targets below md, aligns them to the start from md, and drops snapping at lg', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    expect(scroller()).toHaveClass(
      'snap-x',
      'snap-mandatory',
      'overscroll-x-contain',
      'lg:snap-none'
    );
    for (const target of [column(), addColumnTile()]) {
      expect(target).toHaveClass('snap-center', 'md:snap-start', 'snap-always');
    }
  });

  // Guards the mobile bottom-bar / column-gap fix. The board scroller must be a
  // definite-height flex column that clips vertical overflow (so the bottom nav is
  // never pushed off-screen), size the padded row with flex (flex-1 + min-h-0)
  // rather than a percentage height (h-full), and be position:relative so it is
  // the containing block for absolutely-positioned descendants (column-header
  // sr-only badges, menus). Without `relative`, those abspos elements' containing
  // block is the viewport, the scroller's overflow can't clip them, and they
  // overflow the document — which on mobile expands the layout viewport and
  // pushes the fixed bottom nav off-screen / wider than the screen.
  it('contains the board vertically without relying on percentage height', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    expect(scroller()).toHaveClass('relative', 'flex', 'flex-col', 'overflow-y-hidden', 'min-h-0');
    const row = scroller().firstElementChild;
    expect(row).toHaveClass('flex-1', 'min-h-0');
    expect(row).not.toHaveClass('h-full');
  });
});

describe('Board add-column drafts', () => {
  // ColumnHeader's rename input shares the aria-label, so the composer's input is
  // read through its own form.
  function nameInput(): HTMLInputElement {
    const form = screen.getByRole('button', { name: 'Add column' }).closest('form');
    if (form === null) {
      throw new Error('Add column form not rendered');
    }
    return within(form).getByLabelText('Column name');
  }

  async function typeName(value: string): Promise<void> {
    await fireEvent.click(screen.getByRole('button', { name: '+ Add column' }));
    await fireEvent.input(nameInput(), { target: { value } });
  }

  it('focuses the input when the user opens the composer', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });

    await fireEvent.click(screen.getByRole('button', { name: '+ Add column' }));

    expect(nameInput()).toHaveFocus();
  });

  it('restores an unsent column name on remount without stealing focus', async () => {
    const first = render(Board, { props: { projectId: PROJECT_ID } });
    await typeName('Backlog');
    first.unmount();

    render(Board, { props: { projectId: PROJECT_ID } });

    const restored = nameInput();
    expect(restored).toHaveValue('Backlog');
    expect(restored).not.toHaveFocus();
  });

  it('stays open when the text is emptied', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await typeName('Backlog');

    await fireEvent.input(nameInput(), { target: { value: '' } });

    expect(nameInput()).toBeInTheDocument();
  });

  it('closes and clears the draft on submit', async () => {
    board.currentProjectId = PROJECT_ID;
    render(Board, { props: { projectId: PROJECT_ID } });
    await typeName('Backlog');

    await fireEvent.submit(nameInput().closest('form')!);

    expect(board.columns.map((column) => column.name)).toEqual(['Todo', 'Backlog']);
    expect(screen.getByRole('button', { name: '+ Add column' })).toBeInTheDocument();
    expect(drafts.get(draftKey.addColumn(PROJECT_ID))).toBeNull();
  });

  it('stays closed on remount after Escape discarded the draft', async () => {
    const first = render(Board, { props: { projectId: PROJECT_ID } });
    await typeName('Discard me');
    await fireEvent.keyDown(nameInput(), { key: 'Escape' });
    first.unmount();

    render(Board, { props: { projectId: PROJECT_ID } });

    expect(screen.getByRole('button', { name: '+ Add column' })).toBeInTheDocument();
    expect(drafts.get(draftKey.addColumn(PROJECT_ID))).toBeNull();
  });

  it('does not leak a draft into another project', async () => {
    const first = render(Board, { props: { projectId: PROJECT_ID } });
    await typeName('Project one only');
    first.unmount();

    render(Board, { props: { projectId: OTHER_PROJECT_ID } });

    expect(screen.getByRole('button', { name: '+ Add column' })).toBeInTheDocument();
  });
});

describe('Board keyboard reordering', () => {
  it('reorders task cards with Enter and arrows, committing each move', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    const item = await screen.findByRole('listitem', { name: 'plain one' });
    expect(item).toHaveAttribute('tabindex', '0');
    item.focus();

    const pickup = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await fireEvent(item, pickup);
    expect(pickup.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(board.dragging).toBe(true));

    await fireEvent.keyDown(item, { key: 'ArrowDown' });
    await vi.waitFor(() =>
      expect(cardTitles()).toEqual(['match a', 'plain one', 'plain two', 'match b'])
    );
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));
    const patch = patchRequests()[0]!;
    expect(new URL(patch.url).pathname).toBe(`/api/tasks/${T1}`);
    expect(await patch.clone().json()).toEqual({ column_id: 'c1', position: 2500 });

    await fireEvent.keyDown(item, { key: 'Enter' });
    await vi.waitFor(() => expect(board.dragging).toBe(false));
    expect(alertText()).toContain('Stopped dragging item plain one');
  });

  it('leaves Enter on a task card link to the browser', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    const anchor = await screen.findByRole('link', { name: 'plain one' });
    anchor.focus();

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await fireEvent(anchor, enter);

    expect(enter.defaultPrevented).toBe(false);
    expect(board.dragging).toBe(false);
    expect(alertText()).not.toContain('Started dragging');
    expect(cardTitles()).toEqual(['plain one', 'match a', 'plain two', 'match b']);
  });

  it('reorders columns by keyboard via the drag handle', async () => {
    board.columns = [
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'c2', name: 'Doing', position: 2000, is_done: false },
    ];
    render(Board, { props: { projectId: PROJECT_ID } });

    const handles = await screen.findAllByRole('button', { name: 'Reorder column' });
    const handle = handles[0]!;
    expect(handle).toHaveAttribute('tabindex', '0');
    handle.focus();

    await fireEvent.keyDown(handle, { key: 'Enter' });
    await vi.waitFor(() => expect(board.dragging).toBe(true));
    expect(alertText()).toContain('Started dragging item Todo');

    const section = column();
    await fireEvent.keyDown(section, { key: 'ArrowRight' });
    await vi.waitFor(() =>
      expect(
        [...document.querySelectorAll('section[aria-label]')].map((s) =>
          s.getAttribute('aria-label')
        )
      ).toEqual(['Doing', 'Todo'])
    );
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));
    const patch = patchRequests()[0]!;
    expect(new URL(patch.url).pathname).toBe('/api/columns/c1');
    expect(await patch.clone().json()).toEqual({ position: 3000 });

    await fireEvent.keyDown(section, { key: 'Enter' });
    await vi.waitFor(() => expect(board.dragging).toBe(false));
  });
});

describe('Board reduced motion', () => {
  function expectEveryZone(flipDurationMs: number, dropAnimationDisabled: boolean): void {
    for (const type of ['column', 'task']) {
      const configs = configsOfType(type);
      expect(configs.length).toBeGreaterThan(0);
      for (const config of configs) {
        expect(config.flipDurationMs).toBe(flipDurationMs);
        expect(config.dropAnimationDisabled).toBe(dropAnimationDisabled);
      }
    }
  }

  it('animates both dnd zones by default', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    expectEveryZone(150, false);
  });

  it('disables flip and drop animation in both dnd zones when motion is reduced', async () => {
    motion.reduced = true;
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    expectEveryZone(0, true);
  });

  it('reconfigures the zones when the preference flips mid-session', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    zoneOptions.length = 0;

    motion.reduced = true;

    await vi.waitFor(() => {
      expect(configsOfType('column').length).toBeGreaterThan(0);
      expect(configsOfType('task').length).toBeGreaterThan(0);
    });
    expectEveryZone(0, true);
  });

  it('still commits keyboard reorders when motion is reduced', async () => {
    motion.reduced = true;
    render(Board, { props: { projectId: PROJECT_ID } });
    const item = await screen.findByRole('listitem', { name: 'plain one' });
    item.focus();

    await fireEvent.keyDown(item, { key: 'Enter' });
    await vi.waitFor(() => expect(board.dragging).toBe(true));

    await fireEvent.keyDown(item, { key: 'ArrowDown' });
    await vi.waitFor(() =>
      expect(cardTitles()).toEqual(['match a', 'plain one', 'plain two', 'match b'])
    );
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));
    const patch = patchRequests()[0]!;
    expect(new URL(patch.url).pathname).toBe(`/api/tasks/${T1}`);
    expect(await patch.clone().json()).toEqual({ column_id: 'c1', position: 2500 });
    expectEveryZone(0, true);
  });
});

describe('Board filter scrolling', () => {
  it('resets each column scroll when a text filter is applied', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    taskList().scrollTop = 240;

    board.setFilterQuery('match');

    await waitFor(() => {
      expect(cardTitles()).toEqual(['match a', 'match b', 'plain one', 'plain two']);
      expect(taskList().scrollTop).toBe(0);
    });
  });

  it('resets the scroll when a label chip is toggled', async () => {
    board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
    board.tasks = board.tasks.map((t) => (t.id === T4 ? { ...t, label_ids: ['l1'] } : t));
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    taskList().scrollTop = 240;

    board.toggleLabelFilter('l1');

    await waitFor(() => {
      expect(cardTitles()).toEqual(['match b', 'plain one', 'match a', 'plain two']);
      expect(taskList().scrollTop).toBe(0);
    });
  });

  it('resets the scroll when an assignee chip is toggled', async () => {
    board.tasks = board.tasks.map((t) => (t.id === T2 ? { ...t, assignee_ids: ['u1'] } : t));
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    taskList().scrollTop = 240;

    board.toggleAssigneeFilter('u1');

    await waitFor(() => {
      expect(cardTitles()).toEqual(['match a', 'plain one', 'plain two', 'match b']);
      expect(taskList().scrollTop).toBe(0);
    });
  });

  it('resets the scroll when filters are cleared', async () => {
    board.setFilterQuery('match');
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    taskList().scrollTop = 240;

    board.clearFilters();

    await waitFor(() => {
      expect(cardTitles()).toEqual(['plain one', 'match a', 'plain two', 'match b']);
      expect(taskList().scrollTop).toBe(0);
    });
  });

  it('resets every column, not just the one that matched', async () => {
    board.columns = [
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'c2', name: 'Doing', position: 2000, is_done: false },
    ];
    board.tasks = [
      ...board.tasks,
      task(T5, 'c2', 1000, 'plain three'),
      task(T6, 'c2', 2000, 'match c'),
    ];
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('match c');
    taskList('Todo tasks').scrollTop = 240;
    taskList('Doing tasks').scrollTop = 240;

    board.setFilterQuery('match');

    await waitFor(() => {
      expect(taskList('Todo tasks').scrollTop).toBe(0);
      expect(taskList('Doing tasks').scrollTop).toBe(0);
    });
  });

  it('keeps the scroll position when a new task repartitions a filtered column', async () => {
    board.setFilterQuery('match');
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    taskList().scrollTop = 240;

    board.tasks = [...board.tasks, task(T5, 'c1', 5000, 'match c')];

    await waitFor(() =>
      expect(cardTitles()).toEqual(['match a', 'match b', 'match c', 'plain one', 'plain two'])
    );
    expect(taskList().scrollTop).toBe(240);
  });

  it('keeps the scroll position when a task is added with no filter active', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    taskList().scrollTop = 240;

    board.tasks = [...board.tasks, task(T5, 'c1', 5000, 'plain three')];

    await waitFor(() => expect(cardTitles()).toContain('plain three'));
    expect(taskList().scrollTop).toBe(240);
  });

  it('ignores a filter edit that cannot change the order', async () => {
    board.setFilterQuery('match');
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    taskList().scrollTop = 240;

    board.setFilterQuery('match ');
    await tick();

    expect(cardTitles()).toEqual(['match a', 'match b', 'plain one', 'plain two']);
    expect(taskList().scrollTop).toBe(240);
  });

  it('ignores a filter edit that only changes the query case', async () => {
    board.setFilterQuery('match');
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    taskList().scrollTop = 240;

    board.setFilterQuery('MATCH');
    await tick();

    expect(cardTitles()).toEqual(['match a', 'match b', 'plain one', 'plain two']);
    expect(taskList().scrollTop).toBe(240);
  });
});

// Picking a card up is the moment the placeholder enters the list. If drawing it
// throws, the drag is dead from its first frame: the column never reorders under
// the finger, the card is painted nowhere, and no drop ever reaches the store.
describe('Board drag placeholder', () => {
  // Asserts the swap actually reached the DOM, not merely that the column still
  // looks right: a render that dies leaves the pre-drag markup standing, which
  // would satisfy any check on the titles alone.
  it('swaps the held card for the placeholder in the rendered column', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    pickUp(T1);
    await tick();

    expect(renderedTaskIds()).toEqual([SHADOW_PLACEHOLDER_ITEM_ID, T2, T3, T4]);
    expect(cardTitles()).toEqual(['plain one', 'match a', 'plain two', 'match b']);
  });

  it('still commits the move made during that drag', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const [first, ...rest] = board.tasksInColumn('c1');

    pickUp(T1);
    drop(T1, [...rest, first!]);
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));

    expect(new URL(patchRequests()[0]!.url).pathname).toBe(`/api/tasks/${T1}`);
  });
});

describe('Board pointer drops', () => {
  function twoColumns(): void {
    board.columns = [
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'c2', name: 'Doing', position: 2000, is_done: false },
    ];
  }

  // Long-pressing a card for its menu unwinds the drag the press already armed
  // through exactly this path, and a card put back where it was is not a move.
  it('writes nothing when a card is dropped where it was picked up', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    pickUp(T1);
    drop(T1, board.tasksInColumn('c1'));
    await tick();

    expect(patchRequests()).toHaveLength(0);
  });

  it('still writes a drop that reorders the column', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const [first, ...rest] = board.tasksInColumn('c1');

    pickUp(T1);
    drop(T1, [...rest, first!]);
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));

    expect(new URL(patchRequests()[0]!.url).pathname).toBe(`/api/tasks/${T1}`);
  });

  // Same slot number, different column: only the column half of the guard can
  // tell this apart from a card put straight back down.
  it('still writes a drop that lands the card at the same index elsewhere', async () => {
    twoColumns();
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    pickUp(T1);
    drop(T1, [board.tasksInColumn('c1')[0]!], 'Doing tasks');
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));

    const patch = patchRequests()[0]!;
    expect(new URL(patch.url).pathname).toBe(`/api/tasks/${T1}`);
    expect(await patch.clone().json()).toMatchObject({ column_id: 'c2' });
  });

  // The menu the unwinding drop belongs to is pinned to the finger's viewport
  // coordinates, so centering the column would slide the board out from under it —
  // and hold the scroller unswipeable while it did.
  it('leaves the board where it is when a card is dropped where it was picked up', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const resting = scroller().className;

    pickUp(T1);
    drop(T1, board.tasksInColumn('c1'));
    await tick();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(scroller().className).toBe(resting);
  });

  it('centers the destination column after a drop that moved something', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const [first, ...rest] = board.tasksInColumn('c1');

    pickUp(T1);
    drop(T1, [...rest, first!]);
    await tick();

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scroller().className).toContain('overflow-x-hidden');

    await fireEvent(scroller(), new Event('scrollend'));
    expect(scroller().className).toContain('snap-mandatory');
  });
});

describe('Board column drops', () => {
  function columnZone(): HTMLElement {
    const element = document.querySelector('[aria-label="Columns"]');
    if (!(element instanceof HTMLElement)) {
      throw new Error('Column zone not rendered');
    }
    return element;
  }

  function dragColumn(id: string, type: 'consider' | 'finalize', items: unknown[]): void {
    void fireEvent(
      columnZone(),
      new CustomEvent(type, {
        detail: {
          items,
          info: {
            trigger: type === 'consider' ? TRIGGERS.DRAG_STARTED : TRIGGERS.DROPPED_INTO_ZONE,
            id,
            source: SOURCES.POINTER,
          },
        },
      })
    );
  }

  beforeEach(() => {
    board.columns = [
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'c2', name: 'Doing', position: 2000, is_done: false },
    ];
  });

  // A wasted column write renumbers it for nothing and broadcasts the change to
  // everyone else looking at the project.
  it('writes nothing when a column is dropped where it was picked up', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const columns = [...board.columns];

    dragColumn('c1', 'consider', columns);
    dragColumn('c1', 'finalize', columns);
    await tick();

    expect(patchRequests()).toHaveLength(0);
  });

  it('still writes a drop that reorders the columns', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const [first, second] = board.columns;

    dragColumn('c1', 'consider', [first, second]);
    dragColumn('c1', 'finalize', [second, first]);
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));

    expect(new URL(patchRequests()[0]!.url).pathname).toBe('/api/columns/c1');
  });
});

describe('Board drag edge scrolling', () => {
  function nearTheLeftEdge(): ReturnType<typeof vi.fn> {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 600)
    );
    const scrollBy = vi.fn();
    scroller().scrollBy = scrollBy;
    return scrollBy;
  }

  function holdFinger(): void {
    cardMenu.pressStart(
      new PointerEvent('pointerdown', {
        pointerType: 'touch',
        isPrimary: true,
        clientX: 5,
        clientY: 5,
      }),
      T1
    );
    onTestFinished(() => cardMenu.cancelPress());
  }

  it('scrolls the board while a card is dragged against its edge', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const scrollBy = nearTheLeftEdge();

    pickUp(T1);
    await tick();
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5 }));
    await frames();

    expect(scrollBy).toHaveBeenCalled();
  });

  // The drag is armed well before the press becomes a menu, so without this the
  // board drifts under a finger that is only asking for one.
  it('holds the board still while a long press waits to open the card menu', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const scrollBy = nearTheLeftEdge();

    holdFinger();
    pickUp(T1);
    await tick();
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5 }));
    await frames();

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('holds the board still while the menu that press opened is on screen', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const scrollBy = nearTheLeftEdge();

    cardMenu.open(T1, 5, 5);
    pickUp(T1);
    await tick();
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5 }));
    await frames();

    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('Board card menu', () => {
  function signInAsTheCreator(): void {
    board.project = {
      id: PROJECT_ID,
      name: 'Game',
      description: '',
      archived_at: null,
      created_by: 'u-me',
      member_ids: [],
      members: [],
      is_public: false,
      color: null,
      created_at: '2026-07-15T00:00:00Z',
    };
    session.user = {
      id: 'u-me',
      name: 'Ada',
      email: 'ada@example.com',
      avatar_url: null,
      email_verified: false,
    };
  }

  function rightClickCard(title: string): void {
    const card = [...column().querySelectorAll<HTMLElement>('[data-task-id]')].find(
      (el) => el.textContent?.includes(title) === true
    );
    card?.dispatchEvent(
      new PointerEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        button: 2,
        clientX: 30,
        clientY: 40,
      })
    );
  }

  it('opens the editing menu for the card that was right-clicked', async () => {
    signInAsTheCreator();
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain two');

    rightClickCard('plain two');
    await tick();

    expect(screen.getByRole('menu')).toHaveAccessibleName('Actions for plain two');
    expect(screen.getByRole('menuitem', { name: 'Edit title' })).toBeInTheDocument();
  });

  // The editor is signed in and may write this project: the read-only route, not
  // the permission, is the only thing that takes the writing rows away.
  it('gives a viewer the menu without any of the writing rows', async () => {
    signInAsTheCreator();
    expect(board.canEdit).toBe(true);
    render(Board, { props: { projectId: PROJECT_ID, readonly: true } });
    await screen.findByText('plain one');

    rightClickCard('plain one');
    await tick();

    expect(
      screen.getAllByRole('menuitem').map((item) => item.querySelector('span')?.textContent)
    ).toEqual(['Open', 'Open in new tab', 'Copy link']);
  });
});
