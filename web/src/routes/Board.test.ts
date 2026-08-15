import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SHADOW_PLACEHOLDER_ITEM_ID, SOURCES, TRIGGERS, type Options } from 'svelte-dnd-action';
import Board from './Board.svelte';
import { board } from '../lib/board.svelte';
import { SWIPE_COMMIT_PX, SWIPE_SETTLE_MS } from '../lib/board-swipe';
import { cardMenu } from '../lib/card-menu.svelte';
import { draftKey, drafts } from '../lib/drafts.svelte';
import { motion } from '../lib/motion.svelte';
import { outbox } from '../lib/outbox.svelte';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { shortcuts } from '../lib/shortcuts.svelte';
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
    sort_key: `V0${String(Math.round(position)).padStart(8, '0')}1`,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    column_since: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
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
  board.columns = [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }];
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
  const section = document.querySelector('[data-column-id][aria-label="Todo"]');
  if (!(section instanceof HTMLElement)) {
    throw new Error('Todo column not rendered');
  }
  return section;
}

function header(columnName: string): HTMLElement {
  const element = document.querySelector(`[data-column-id][aria-label="${columnName}"] header`);
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

// Every scrollLeft the board is put through, in order. The board drives its own
// slide onto a column frame by frame rather than handing it to
// `scrollTo({ behavior: 'smooth' })`, so "where did it commit to go?" is the LAST
// of these and "did it move at all?" is whether there are any — questions a spy on
// `scrollTo` used to answer and no longer can.
function trackScroll(): number[] {
  const element = scroller();
  const writes: number[] = [];
  let current = element.scrollLeft;
  Object.defineProperty(element, 'scrollLeft', {
    configurable: true,
    get: () => current,
    set: (next: number) => {
      current = next;
      writes.push(next);
    },
  });
  return writes;
}

// Wait out the slide. Real frames rather than fake timers: this file drives Svelte
// with real microtasks throughout, and a fake clock under it reorders them.
async function slideEnds(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SWIPE_SETTLE_MS + 80));
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

function columnNames(): string[] {
  return [...document.querySelectorAll('[data-column-id][aria-label]')].map(
    (section) => section.getAttribute('aria-label') ?? ''
  );
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
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Doing', sort_key: 'V0000020001', is_done: false },
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
    board.columns = [
      ...board.columns,
      { id: 'c3', name: 'Empty', sort_key: 'V0000030001', is_done: false },
    ];
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
  const THREE_COLUMNS = [
    { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
    { id: 'c2', name: 'Doing', sort_key: 'V0000020001', is_done: false },
    { id: 'c3', name: 'Done', sort_key: 'V0000030001', is_done: true },
  ];

  function section(name: string): HTMLElement {
    const element = document.querySelector(`[data-column-id][aria-label="${name}"]`);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`${name} column not rendered`);
    }
    return element;
  }

  // On a phone the two ends align to the board's edges and everything between
  // centers, so being flush against an edge means you are at that end of the board
  // and nothing else does. Centering the ends instead is what cost half a viewport
  // of blank canvas in front of the first column and behind the last. From md up
  // they all start-align, where the columns are capped at 288px and several fit.
  //
  // `snap-end` on the last target is not decoration: with `snap-center` and only a
  // gutter behind it, its snap position falls off the end of the scroll range, and
  // a mandatory-snap container is then free to resolve to some other column.
  it('aligns the end targets to the edges on phones and start-aligns from md up', async () => {
    board.columns = THREE_COLUMNS;
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    expect(scroller()).toHaveClass(
      'snap-x',
      'snap-mandatory',
      'overscroll-x-contain',
      'lg:snap-none',
      'scroll-p-3',
      'lg:scroll-p-4'
    );
    expect(section('Todo')).toHaveClass('snap-start');
    expect(section('Doing')).toHaveClass('snap-center');
    // The tile, not the last column, is the board's last snap target.
    expect(section('Done')).toHaveClass('snap-center');
    expect(addColumnTile()).toHaveClass('snap-end');
    // `snap-always` (scroll-snap-stop: always) is the primary cap on a fling, and
    // the JS fallback below it only fires for an engine that ignores it. The tile
    // is asserted too: it is a snap target the columns' own bookkeeping cannot
    // see, hence data-snap-target rather than a query for sections.
    for (const target of [section('Todo'), section('Doing'), section('Done'), addColumnTile()]) {
      expect(target).toHaveClass('snap-always', 'md:snap-start');
      expect(target).toHaveAttribute('data-snap-target');
    }
  });

  // No tile on a board nobody can edit, so the last column is the last snap target
  // and has to end the board itself. Reading the alignment off the tile alone would
  // leave a public board's final column unable to reach its snap position at all.
  it('ends a readonly board on its last column, which has no tile behind it', async () => {
    board.columns = THREE_COLUMNS;
    render(Board, { props: { projectId: PROJECT_ID, readonly: true } });
    await screen.findByText('plain one');

    expect(screen.queryByRole('button', { name: '+ Add column' })).not.toBeInTheDocument();
    expect(section('Todo')).toHaveClass('snap-start');
    expect(section('Doing')).toHaveClass('snap-center');
    expect(section('Done')).toHaveClass('snap-end');
  });

  // Both arms of columnSnapAlign match, and start has to win: a board this size
  // does not scroll, so ending it would ask for a scroll position that is not there.
  it('starts a lone readonly column rather than ending it', async () => {
    render(Board, { props: { projectId: PROJECT_ID, readonly: true } });
    await screen.findByText('plain one');

    expect(section('Todo')).toHaveClass('snap-start');
    expect(section('Todo')).not.toHaveClass('snap-end');
  });

  // The track must size to its content, not stretch to the scroller: a stretched
  // track ends at the scroller's right edge, so its padding-right lands there
  // rather than after the last column, and the last column butts against the screen
  // while the leading one keeps its gutter.
  it('sizes the track to its content and gives it a plain gutter', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    const track = scroller().firstElementChild;
    expect(track).toHaveClass('w-max', 'px-3', 'lg:px-4');
    // The half-the-leftover-width padding that used to let the ends center. It is
    // the blank canvas this behavior removed, so its absence is the assertion.
    expect(track?.className).not.toContain('calc(50%');
    expect(column()).toHaveClass('w-[var(--cp-board-col-w)]');
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

  // Without the trim guard the board POSTs a column named '' and closes the
  // composer over it, so the only way back is to rename the blank column.
  it('refuses a whitespace-only name and keeps the composer open', async () => {
    board.currentProjectId = PROJECT_ID;
    render(Board, { props: { projectId: PROJECT_ID } });
    await typeName('   ');

    await fireEvent.submit(nameInput().closest('form')!);

    expect(board.columns.map((column) => column.name)).toEqual(['Todo']);
    expect(nameInput()).toHaveValue('   ');
    expect(fetchMock.mock.calls.map((call) => (call[0] as Request).method)).not.toContain('POST');
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
    expect(await patch.clone().json()).toEqual({
      column_id: 'c1',
      sort_key: expect.any(String),
    });
    // The library finalizes on EVERY arrow, so the flag has to be re-raised there:
    // dropped mid-drag it lets shortcuts and realtime board edits in underneath a
    // gesture that is still running.
    expect(board.dragging).toBe(true);

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
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Doing', sort_key: 'V0000020001', is_done: false },
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
    await vi.waitFor(() => expect(columnNames()).toEqual(['Doing', 'Todo']));
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));
    const patch = patchRequests()[0]!;
    expect(new URL(patch.url).pathname).toBe('/api/columns/c1');
    expect(await patch.clone().json()).toEqual({ sort_key: expect.any(String) });
    // Re-raised per arrow, as on the card path above.
    expect(board.dragging).toBe(true);

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
    expect(await patch.clone().json()).toEqual({
      column_id: 'c1',
      sort_key: expect.any(String),
    });
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
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Doing', sort_key: 'V0000020001', is_done: false },
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

  // The rendered list is frozen for the length of the drag. Re-syncing it from the
  // store mid-gesture rewrites the very array svelte-dnd-action is mutating and
  // tears the DOM out from under it — and a card arriving over the wire is exactly
  // what does that at an arbitrary moment.
  it('ignores a card that arrives over the wire mid-drag, then shows it on the drop', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    pickUp(T1);
    await tick();
    board.tasks = [...board.tasks, task(T5, 'c1', 5000, 'arrived')];
    await tick();

    expect(renderedTaskIds()).toEqual([SHADOW_PLACEHOLDER_ITEM_ID, T2, T3, T4]);
    expect(screen.queryByText('arrived')).toBeNull();

    drop(
      T1,
      board.tasksInColumn('c1').filter((t) => t.id !== T5)
    );
    await vi.waitFor(() => expect(screen.getByText('arrived')).toBeInTheDocument());
  });
});

// The card's key is computed against the board on screen and is meaningless
// against any other, so a move that has to wait travels as the cards it landed
// between. The drop used to hand `moveTask` three arguments and let its default
// stand in, which spelled every queued drag "append to the end of the column" —
// and, being indistinguishable from a deliberate append, replayed with nothing
// to say the card had missed.
describe('Board drop intent', () => {
  it('queues the cards the dropped card landed between', async () => {
    const submit = vi.spyOn(outbox, 'submit');
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const [first, second, third, fourth] = board.tasksInColumn('c1');

    pickUp(T1);
    drop(T1, [second!, first!, third!, fourth!]);

    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    // Picked by semantics, not by position: the spy is armed before render, so a
    // submit added at mount would take call 0 and this would go on passing while
    // measuring a different op.
    const moved = submit.mock.calls.find(([op]) => op.semantics === 'move');
    expect(moved?.[0].move).toEqual({ kind: 'task', columnId: 'c1', afterId: T2, beforeId: T3 });
  });
});

// jsdom lays nothing out, so this can only assert the option is asked for; that it
// changes where a card lands is scripts/check-board-layout-real.mjs's job.
describe('Board drop targeting', () => {
  it('lets the pointer, not the card it lifted, pick the column for a card', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    const configs = configsOfType('task');
    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      expect(config.useCursorForDetection).toBe(true);
    }
  });

  // A column is dragged by a grip in its header, so the pointer sits near its
  // corner rather than in it, and reordering by pointer would take a full column
  // of travel instead of half. The column's own center is the right proxy for
  // where a whole column has been moved to.
  it('leaves column reordering deciding by the dragged column', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    const configs = configsOfType('column');
    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      expect(config.useCursorForDetection).toBeUndefined();
    }
  });
});

describe('Board pointer drops', () => {
  function twoColumns(): void {
    board.columns = [
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Doing', sort_key: 'V0000020001', is_done: false },
    ];
  }

  // A keyboard drag is scrolled by svelte-dnd-action itself, which focuses the
  // moved element after every arrow press. Dropping snap for one buys nothing and
  // costs the re-arm: mandatory snap comes back wherever that focus left the
  // scroll, and jumps to the nearest column.
  it('keeps the board snapping through a keyboard drag', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const resting = scroller().className;

    void fireEvent(
      taskList('Todo tasks'),
      new CustomEvent('consider', {
        detail: {
          items: board.tasksInColumn('c1'),
          info: { trigger: TRIGGERS.DRAG_STARTED, id: T1, source: SOURCES.KEYBOARD },
        },
      })
    );
    await tick();

    expect(scroller().className).toBe(resting);
    expect(scroller().className).toContain('snap-mandatory');
  });

  it('drops snap for a pointer drag', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');

    pickUp(T1);
    await tick();

    expect(scroller().className).toContain('overflow-x-hidden');
  });

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
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const resting = scroller().className;
    const writes = trackScroll();

    pickUp(T1);
    drop(T1, board.tasksInColumn('c1'));
    await tick();
    await slideEnds();

    expect(writes).toEqual([]);
    expect(scroller().className).toBe(resting);
  });

  // jsdom lays nothing out, so every rect is 0x0 at 0,0 and the destination always
  // reads as "already on screen". These stub the two elements the decision compares
  // — and must stay per-element: an Element.prototype stub gives the board and the
  // column the same rect, which reads as a perfect fit and guts the assertion.
  function placeColumn(boardRect: DOMRect, columnRect: DOMRect): void {
    vi.spyOn(scroller(), 'getBoundingClientRect').mockReturnValue(boardRect);
    vi.spyOn(column(), 'getBoundingClientRect').mockReturnValue(columnRect);
  }

  it('follows the card to a destination column the user cannot see whole', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    placeColumn(new DOMRect(0, 0, 390, 600), new DOMRect(420, 0, 288, 600));
    const writes = trackScroll();
    const [first, ...rest] = board.tasksInColumn('c1');

    pickUp(T1);
    drop(T1, [...rest, first!]);
    await tick();

    expect(scroller().className).toContain('overflow-x-hidden');

    // Snap comes back only once the slide has landed, and it lands on the column's
    // snap position exactly — its left edge (420) against the board's, jsdom
    // reporting no scroll padding to inset it by.
    await slideEnds();
    expect(writes.at(-1)).toBe(420);
    expect(scroller().className).toContain('snap-mandatory');
  });

  // Where the columns center (phone widths), the slide has to land the column's
  // center on the board's, not its left edge on the board's. Getting this wrong
  // parks the board a half-column past the snap position, and mandatory snap then
  // rounds it to whichever column is nearer — which can be the next one over.
  it('centers the destination column where the columns snap to center', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    placeColumn(new DOMRect(0, 0, 390, 600), new DOMRect(420, 0, 288, 600));
    // jsdom applies no stylesheet, so the alignment the phone breakpoint sets has
    // to be reported by hand: this is the seam the component reads to choose.
    const destination = column();
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
      el === destination
        ? ({ scrollSnapAlign: 'center' } as unknown as CSSStyleDeclaration)
        : computed(el, pseudo)
    );
    const writes = trackScroll();
    const [first, ...rest] = board.tasksInColumn('c1');

    pickUp(T1);
    drop(T1, [...rest, first!]);
    await tick();
    await slideEnds();

    // The column's center (564) onto the board's (195) — not its left edge (420)
    // onto the board's, which is where start alignment would have put it.
    expect(writes.at(-1)).toBe(369);
  });

  // The whole point on desktop: a board wide enough to show the destination must
  // not move when a card lands in it, and neither must a reorder within the column
  // the user is already looking at.
  it('leaves the board alone when the destination column is already on screen', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    placeColumn(new DOMRect(0, 0, 1000, 600), new DOMRect(16, 0, 288, 600));
    const writes = trackScroll();
    const [first, ...rest] = board.tasksInColumn('c1');

    pickUp(T1);
    drop(T1, [...rest, first!]);
    await tick();
    await slideEnds();

    expect(writes).toEqual([]);
    // Snap is never dropped, so the board stays swipeable throughout.
    expect(scroller().className).toContain('snap-mandatory');
    // The move still commits: we skipped the scroll, not the write.
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));
  });
});

describe('Board column drops', () => {
  beforeEach(() => {
    board.columns = [
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Doing', sort_key: 'V0000020001', is_done: false },
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

  // Same freeze as the card list, and the same hazard: the column zone is the
  // array the library is reordering under the pointer.
  it('ignores a column that arrives over the wire mid-drag, then shows it on the drop', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const [first, second] = board.columns;

    dragColumn('c1', 'consider', [first, second]);
    await tick();
    board.columns = [
      ...board.columns,
      { id: 'c3', name: 'Done', sort_key: 'V0000030001', is_done: true },
    ];
    await tick();

    expect(columnNames()).toEqual(['Todo', 'Doing']);

    dragColumn('c1', 'finalize', [first, second]);
    await vi.waitFor(() => expect(columnNames()).toEqual(['Todo', 'Doing', 'Done']));
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

  it('leaves the board alone when the reordered column is already on screen', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    vi.spyOn(scroller(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
    vi.spyOn(column(), 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 0, 288, 600));
    const writes = trackScroll();
    const [first, second] = board.columns;

    dragColumn('c1', 'consider', [first, second]);
    dragColumn('c1', 'finalize', [second, first]);
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));
    await tick();
    await slideEnds();

    expect(writes).toEqual([]);
    // Snap never dropped, which is what tells a slide that was correctly skipped
    // apart from one that never armed at all.
    expect(scroller().className).toContain('snap-mandatory');
  });
});

// The board owns the horizontal gesture on touch: `touch-action: pan-y` means the
// browser never pans it sideways, so nothing but the drag below moves it and the
// landing is `origin ± 1` by construction. Correcting a native scroll afterwards
// could not deliver this — `scroll-snap-stop: always` governs only the inertial
// phase, so a long drag crosses two columns with it honored, and a correction is
// by definition visible as the overshoot it undoes.
describe('Board swipe gestures', () => {
  // `centered` is the snap-target index under the board's midpoint; the rects are
  // the only geometry there is, since jsdom lays nothing out.
  let centered = 0;

  function stubGeometry(): void {
    vi.spyOn(scroller(), 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, 300, 600)
    );
    for (const [index, target] of [
      ...document.querySelectorAll<HTMLElement>('[data-snap-target]'),
    ].entries()) {
      vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect((index - centered) * 300 + 6, 0, 288, 600)
      );
    }
  }

  // jsdom has no Touch constructor, so the handlers' one input — touches[0]'s
  // coordinates — is supplied directly.
  function touch(type: string, x: number, y: number): Event {
    // Cancelable, as a real one is: the board cancels the moves it claims, and a
    // non-cancelable stand-in would make `preventDefault` a silent no-op here.
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', {
      value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }],
    });
    return event;
  }

  // A second finger landing on a swipe already in progress.
  function pinch(x: number, y: number): Event {
    const event = new Event('touchstart', { bubbles: true });
    Object.defineProperty(event, 'touches', {
      value: [
        { clientX: x, clientY: y },
        { clientX: x + 80, clientY: y },
      ],
    });
    return event;
  }

  // Where the drag left the board, and where the slide after it landed. Two
  // readings and not one: the slide's destination is computed from the rects at
  // the moment it starts, so its absolute value carries the drag's travel in it —
  // only the difference says which column the board chose.
  interface Landing {
    dragged: number;
    landed: number;
  }

  async function swipe(dx: number, dy = 0): Promise<Landing> {
    await fireEvent(scroller(), touch('touchstart', 200, 300));
    // Two moves: the first locks the axis, the second carries the travel, which is
    // how a real gesture arrives and what the axis lock is written against.
    await fireEvent(scroller(), touch('touchmove', 200 + Math.sign(dx) * 10, 300 + dy));
    await fireEvent(scroller(), touch('touchmove', 200 + dx, 300 + dy));
    await fireEvent(scroller(), touch('touchend', 0, 0));
    // The slide runs in animation frames, so nothing has moved yet.
    const dragged = scroller().scrollLeft;
    await slideEnds();
    return { dragged, landed: scroller().scrollLeft };
  }

  // How many columns the board committed to move. The rects above put snap target
  // i at x = (i - centered) * 300 + 6, and jsdom reports no scroll-snap-align,
  // which the slide reads as start-aligned against the mocked 12px scroll padding.
  // Asserting the step rather than a pixel value is the point: the cap is a number
  // of columns.
  function columnsMoved({ dragged, landed }: Landing): number {
    return (landed - dragged - 6 + 12) / 300;
  }

  // jsdom applies no stylesheet, so it computes `scroll-snap-type: none` for
  // everything — which is exactly what the takeover treats as "desktop, leave it
  // alone". Every case has to say which of the two it is modelling.
  //
  // The inline value winning over the class one is not decoration: it is the
  // relationship the whole guard turns on. A stub that reported the breakpoint's
  // value unconditionally would hide the board's own suspension from the very
  // reading that used to mistake it for a desktop board, and every case below
  // would pass on the code that had the bug.
  function computedSnapType(value: string): string {
    return scroller().style.scrollSnapType || value;
  }

  function setSnapType(value: string): void {
    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) =>
      element === scroller()
        ? ({
            scrollSnapType: computedSnapType(value),
            scrollPaddingLeft: '12px',
          } as CSSStyleDeclaration)
        : real.call(window, element, pseudo)
    );
  }

  beforeEach(() => {
    centered = 0;
    board.columns = [
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Doing', sort_key: 'V0000020001', is_done: false },
      { id: 'c3', name: 'Review', sort_key: 'V0000030001', is_done: false },
      { id: 'c4', name: 'Done', sort_key: 'V0000040001', is_done: true },
    ];
  });

  async function mount(snapType = 'x mandatory'): Promise<number[]> {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    stubGeometry();
    setSnapType(snapType);
    return trackScroll();
  }

  it('advances one column for a swipe past the commit threshold', async () => {
    await mount();

    expect(columnsMoved(await swipe(-SWIPE_COMMIT_PX - 20))).toBe(1);
  });

  // The reported bug: a drag long enough to carry the board two columns still
  // lands on the next one. Nothing about drag length can widen the step.
  it('advances only one column for a drag that spans two', async () => {
    const writes = await mount();

    const landing = await swipe(-700);

    expect(columnsMoved(landing)).toBe(1);
    // And the slide onto it never passes it. A correction is visible as the
    // overshoot it undoes, which is the whole reason the landing is chosen here
    // rather than left to the browser to resolve afterwards.
    const slide = writes.slice(writes.indexOf(landing.dragged) + 1);
    expect(slide.length).toBeGreaterThan(1);
    expect(
      slide.filter((position) => position < landing.dragged || position > landing.landed)
    ).toEqual([]);
  });

  it('goes back one column for a swipe the other way', async () => {
    await mount();
    centered = 2;

    expect(columnsMoved(await swipe(700))).toBe(-1);
  });

  it('returns to the column it started on for a drag too short to commit', async () => {
    await mount();

    expect(columnsMoved(await swipe(-20))).toBe(0);
  });

  // The column card lists scroll vertically inside the board, and pan-y leaves
  // that to the browser — so a vertical gesture must never be claimed here.
  it('leaves a vertical gesture to the card list', async () => {
    const writes = await mount();

    await swipe(-4, 120);

    expect(writes).toEqual([]);
    expect(scroller().style.scrollSnapType).toBe('');
  });

  it('does not take over where the board does not snap', async () => {
    const writes = await mount('none');

    await swipe(-700);

    expect(writes).toEqual([]);
  });

  // pointerdown precedes touchstart, so a swipe that starts on a card arms the
  // long-press first. Refusing the gesture for that would refuse nearly every
  // swipe there is, since cards cover most of the board.
  it('takes over a swipe that starts on a card with a press pending', async () => {
    await mount();
    cardMenu.pressStart(
      new PointerEvent('pointerdown', { pointerType: 'touch', isPrimary: true }),
      T1
    );
    expect(cardMenu.pressPending).toBe(true);

    expect(columnsMoved(await swipe(-700))).toBe(1);
  });

  // A card drag owns the same finger; taking the gesture over would fight it.
  it('does not take over while a card is being dragged', async () => {
    const writes = await mount();
    pickUp(T1);
    await tick();

    await swipe(-700);

    expect(writes).toEqual([]);
  });

  // The arrangement stubGeometry above does not model: the phone board's targets
  // do not all align the same way. A 640px board — a phone in landscape, still
  // below md, so the takeover is live — fits two 288px columns beside a 12px
  // gutter, the first one flush against it and the rest centered.
  //
  //   target 0  start   12..300    parks at scrollLeft 0
  //   target 1  center  312..600   parks at 456 - 320 = 136
  //   target 2  center  612..900   parks at 436
  //   target 3  center  912..1200  parks at 736
  //   target 4  end    1212..1500  parks at 1500 - 640 + 12 = 872
  //
  // Note the uneven first step: 136, then 300 thereafter.
  function stubMixedAlignment(resting = 0): void {
    const BOARD = 640;
    const GUTTER = 12;
    const COLUMN = 288;
    const PITCH = COLUMN + GUTTER;
    const targets = [...document.querySelectorAll<HTMLElement>('[data-snap-target]')];
    scroller().scrollLeft = resting;
    vi.spyOn(scroller(), 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, BOARD, 600)
    );
    targets.forEach((target, index) => {
      vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(GUTTER + PITCH * index - resting, 0, COLUMN, 600)
      );
    });
    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (element === scroller()) {
        return {
          scrollSnapType: computedSnapType('x mandatory'),
          scrollPaddingLeft: `${GUTTER}px`,
          scrollPaddingRight: `${GUTTER}px`,
        } as CSSStyleDeclaration;
      }
      const index = targets.indexOf(element as HTMLElement);
      if (index === -1) {
        return real.call(window, element, pseudo);
      }
      const align = index === 0 ? 'start' : index === targets.length - 1 ? 'end' : 'center';
      return { scrollSnapAlign: `none ${align}` } as CSSStyleDeclaration;
    });
  }

  // How far the board committed to move. The rects are stubbed for one resting
  // position while the drag has already written a different scrollLeft, so the
  // delta is the only reading that means anything — as in columnsMoved above.
  function committedDelta({ dragged, landed }: Landing): number {
    return landed - dragged;
  }

  async function mountMixed(resting = 0): Promise<number[]> {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    stubMixedAlignment(resting);
    return trackScroll();
  }

  // The regression the mixed alignment introduces. Asking which target is nearest
  // the middle of the screen answers "the resting one" only while every target
  // centers: here the board rests on target 0 with target 1 nearer the middle
  // (136px away against 164px), so an origin taken that way counts from target 1
  // and the swipe lands on target 2 — a whole column skipped.
  it('counts a swipe from the target the board is parked on, not the middle one', async () => {
    await mountMixed();

    expect(committedDelta(await swipe(-SWIPE_COMMIT_PX - 20))).toBe(136);
  });

  it('does not move a board already parked on its start-aligned first column', async () => {
    await mountMixed();

    expect(committedDelta(await swipe(SWIPE_COMMIT_PX + 20))).toBe(0);
  });

  // The far end, through the component: the last target ends the board rather than
  // centering, so the final step is to 872 and not to a position past the scroll
  // range that the browser would have to resolve somewhere else.
  it('lands the last target flush against the right edge', async () => {
    await mountMixed(736);

    expect(committedDelta(await swipe(-SWIPE_COMMIT_PX - 20))).toBe(872 - 736);
  });

  // --- Chaining, which is where the two remaining reported bugs lived ---

  // The gesture, up to the point where the board has committed to a column and is
  // sliding onto it. Stopping here is the state every case below is about.
  async function swipeIntoSlide(dx = -SWIPE_COMMIT_PX - 20): Promise<void> {
    await fireEvent(scroller(), touch('touchstart', 200, 300));
    await fireEvent(scroller(), touch('touchmove', 190, 300));
    await fireEvent(scroller(), touch('touchmove', 200 + dx, 300));
    await fireEvent(scroller(), touch('touchend', 0, 0));
    // A couple of frames in, nowhere near the SWIPE_SETTLE_MS it needs.
    await new Promise((resolve) => setTimeout(resolve, 32));
  }

  // Snap is suspended through an inline style while the board slides itself onto a
  // column, and `getComputedStyle` cannot tell that apart from the `lg:snap-none`
  // that means "desktop, don't take over". Reading the style alone therefore
  // refused every swipe that arrived before the previous one had finished — and
  // refused it with snap off, so whatever else moved the board moved it with
  // nothing to snap it back. Measured in Chrome: two of eight swipes at an
  // ordinary cadence did nothing at all.
  it('takes over a swipe that arrives before the last one has settled', async () => {
    await mount();

    await swipeIntoSlide();

    // Two swipes, two columns: `columnsMoved` counts from the target the board
    // started on, so this is the total and not the second step alone.
    expect(columnsMoved(await swipe(-SWIPE_COMMIT_PX - 20))).toBe(2);
  });

  // ...and a gesture that interrupts the slide without going anywhere hands it
  // back. The board must not be left part-way onto a column with mandatory snap
  // re-armed under it — that is the state the browser resolves onto whichever
  // column it likes.
  it('resumes the interrupted slide when the gesture comes to nothing', async () => {
    await mount();

    await swipeIntoSlide();
    // A tap: down and up, no movement, no axis lock. The touchdown is what stops
    // the slide, so the board's position is only stable to read after it.
    await fireEvent(scroller(), touch('touchstart', 200, 300));
    const midSlide = scroller().scrollLeft;
    await fireEvent(scroller(), touch('touchend', 0, 0));
    await slideEnds();

    // Target 1's snap position, computed the way the component does from the rects
    // stubbed above: one pitch along, less the 6px the gutter and scroll padding
    // disagree by.
    expect(scroller().scrollLeft).toBe(midSlide + 300 - 6);
    expect(scroller().style.scrollSnapType).toBe('');
  });

  // `touch-action: pan-y` asks the browser not to pan the board sideways, but a
  // browser that does it anyway carries the board past the column the gesture
  // chose — and `origin ± 1` is only a cap on what THIS code does. Cancelling the
  // moves it has claimed is what makes it a cap on the board.
  //
  // Only the claimed ones: a vertical gesture belongs to the card list, and
  // cancelling its moves would stop that list scrolling at all.
  it('cancels the moves it has claimed, and only those', async () => {
    await mount();
    const claimed: boolean[] = [];
    const record = (event: Event) => claimed.push(event.defaultPrevented);
    // After the component's own listener, so this reads the verdict it reached.
    const element = scroller();
    element.addEventListener('touchmove', record);
    onTestFinished(() => element.removeEventListener('touchmove', record));

    await swipe(-SWIPE_COMMIT_PX - 20);
    const horizontal = [...claimed];
    claimed.length = 0;
    await swipe(-4, 120);

    expect(horizontal).toEqual([true, true]);
    expect(claimed).toEqual([false, false]);
  });

  // A second finger is a pinch, not a swipe — but refusing it used to null the
  // gesture without releasing snap, and the board then read as "desktop" forever
  // after and refused every swipe that followed.
  it('releases snap when a second finger refuses the gesture mid-swipe', async () => {
    await mount();

    await fireEvent(scroller(), touch('touchstart', 200, 300));
    await fireEvent(scroller(), touch('touchmove', 190, 300));
    await fireEvent(scroller(), touch('touchmove', 120, 300));
    await fireEvent(scroller(), pinch(120, 300));
    await slideEnds();

    expect(scroller().style.scrollSnapType).toBe('');
    // And the board is still swipeable, which is the symptom that mattered.
    expect(columnsMoved(await swipe(-SWIPE_COMMIT_PX - 20))).toBe(1);
  });

  // Mandatory snap may only come back once the board is stationary and exactly on
  // the position. Re-armed while it is still moving, the browser resolves the
  // in-flight scroll onto the NEXT snap position and the swipe lands a column too
  // far — measured in Chrome as a swipe wanting the last real column arriving on
  // the "+ Add column" tile instead.
  it('re-arms snap only after the board has landed on the column', async () => {
    await mount();

    await swipeIntoSlide();

    expect(scroller().style.scrollSnapType).toBe('none');

    await slideEnds();

    expect(scroller().style.scrollSnapType).toBe('');
  });

  // The slide is scheduled from touchend, so a board unmounted in between leaves
  // it holding a scroller nobody is looking at any more. In a browser that is a
  // stray style write; under a runner tearing jsdom down around it, `window` is
  // already gone and it is an unhandled ReferenceError that fails a run in which
  // every test passed. It failed CI exactly that way.
  it('drops the pending slide when the board goes away before it finishes', async () => {
    const { unmount } = render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    stubGeometry();
    setSnapType('x mandatory');
    const el = scroller();
    const writes = trackScroll();

    await fireEvent(el, touch('touchstart', 200, 300));
    await fireEvent(el, touch('touchmove', 190, 300));
    await fireEvent(el, touch('touchmove', 200 - SWIPE_COMMIT_PX - 20, 300));
    await fireEvent(el, touch('touchend', 0, 0));
    unmount();
    const settled = writes.length;

    // Set AFTER unmount, so only a slide still holding the node can clear it.
    el.style.scrollSnapType = 'x mandatory';
    await slideEnds();
    expect(el.style.scrollSnapType).toBe('x mandatory');
    // No frame survived either — the style is only half of what a live slide writes.
    expect(writes.length).toBe(settled);
  });
});

// The shortcut can name a column nowhere near the viewport, so something must
// reveal it — but not focus(), which scrolls to wherever the input happens to sit
// and leaves a mandatory-snap board between two snap points, free to resolve onto
// a neighbor. The reveal goes through the same snap-aware slide a pointer drop uses.
describe('Board quick-add shortcut', () => {
  afterEach(() => {
    shortcuts.quickAddColumn = null;
  });

  async function target(columnRect: DOMRect): Promise<number[]> {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    vi.spyOn(scroller(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 600));
    vi.spyOn(column(), 'getBoundingClientRect').mockReturnValue(columnRect);
    return trackScroll();
  }

  it('slides a column the user cannot see whole into view, without focus scrolling', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const writes = await target(new DOMRect(420, 0, 288, 600));

    shortcuts.quickAddColumn = 'c1';
    await tick();
    await tick();
    await slideEnds();

    expect(writes.at(-1)).toBe(420);
    await screen.findByLabelText('Task title');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(focus).not.toHaveBeenCalledWith();
  });

  it('leaves the board alone for a column already on screen', async () => {
    const writes = await target(new DOMRect(16, 0, 288, 600));

    shortcuts.quickAddColumn = 'c1';
    await tick();
    await tick();
    await slideEnds();

    expect(writes).toEqual([]);
  });

  // A composer already open is the board's own branch: the case above ends at
  // QuickAddTask's mount-time focus, which fires whoever opened the form. The spy
  // goes on after that focus has happened, so only a second one can satisfy it.
  it('focuses a composer that is already open, without scrolling to it', async () => {
    const writes = await target(new DOMRect(16, 0, 288, 600));
    await fireEvent.click(within(column()).getByRole('button', { name: '+ Add task' }));
    const input = await screen.findByLabelText('Task title');
    const focus = vi.spyOn(input, 'focus');

    shortcuts.quickAddColumn = 'c1';
    await tick();
    await tick();
    await slideEnds();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(focus).not.toHaveBeenCalledWith();
    expect(writes).toEqual([]);
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

// A drag that edge-scrolled leaves the board wherever the pointer stopped, which
// is almost never a snap position. Re-arming mandatory snap there is what lets the
// browser resolve the board onto a neighbouring column, so the end of such a drag
// has to land on a position first — including when the drag committed no move.
describe('Board drag scroll settling', () => {
  function edgeScrolled(): number[] {
    vi.spyOn(scroller(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 600));
    vi.spyOn(column(), 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 0, 288, 600));
    scroller().scrollBy = vi.fn();
    return trackScroll();
  }

  // The board only edge-scrolls for a pointer drag already in progress, so this
  // is always the second half of one — a card's or a column's.
  async function pushAgainstTheEdge(): Promise<void> {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5 }));
    await frames();
  }

  async function dragAgainstTheEdge(): Promise<void> {
    pickUp(T1);
    await tick();
    await pushAgainstTheEdge();
  }

  it('slides onto the column even when the card is dropped where it was picked up', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const writes = edgeScrolled();

    await dragAgainstTheEdge();
    drop(T1, board.tasksInColumn('c1'));
    await tick();
    await slideEnds();

    // The column fits the board whole, so only the scroll the drag itself did can
    // ask for this slide — onto the column's snap position, 16px in.
    expect(writes.at(-1)).toBe(16);
    expect(scroller().className).toContain('snap-mandatory');
    // The drop is still not a move: we landed the board, not renumbered the card.
    expect(patchRequests()).toHaveLength(0);
  });

  // The column handler has its own copy of the same arm, and a column drag reaches
  // the edge scroller by the same route a card drag does.
  it('slides onto the column even when a column is dropped where it was picked up', async () => {
    board.columns = [
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Doing', sort_key: 'V0000020001', is_done: false },
    ];
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const writes = edgeScrolled();
    const columns = [...board.columns];

    dragColumn('c1', 'consider', columns);
    await tick();
    await pushAgainstTheEdge();
    dragColumn('c1', 'finalize', columns);
    await tick();
    await slideEnds();

    expect(writes.at(-1)).toBe(16);
    expect(scroller().className).toContain('snap-mandatory');
    // Still not a move: a wasted column write would also fan out to everyone else
    // looking at the project.
    expect(patchRequests()).toHaveLength(0);
  });

  it('forgets the scroll when the drag ends over no zone at all', async () => {
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('plain one');
    const writes = edgeScrolled();

    await dragAgainstTheEdge();
    void fireEvent(
      taskList(),
      new CustomEvent('finalize', {
        detail: {
          items: board.tasksInColumn('c1'),
          info: {
            trigger: TRIGGERS.DROPPED_OUTSIDE_OF_ANY,
            id: T1,
            source: SOURCES.POINTER,
          },
        },
      })
    );
    await tick();
    await slideEnds();
    const settled = writes.length;

    // A reveal of a column that fits the board whole must move nothing. It does
    // once a stale "this drag scrolled" flag survives the drag that set it.
    shortcuts.quickAddColumn = 'c1';
    await tick();
    await tick();
    await slideEnds();

    expect(writes.length).toBe(settled);
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

describe('Board blocked-by badge', () => {
  it('adds remote blockers to the count of open local ones', async () => {
    board.tasks = [
      task(T1, 'c1', 1000, 'blocker one'),
      {
        ...task(T2, 'c1', 2000, 'blocked'),
        blocker_ids: [T1],
        open_cross_project_blocker_count: 2,
      },
    ];
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('blocked');

    expect(screen.getByTitle('Blocked by 3 open tasks')).toHaveTextContent('3');
  });

  it('shows a card blocked only from another board as blocked', async () => {
    board.tasks = [{ ...task(T1, 'c1', 1000, 'blocked'), open_cross_project_blocker_count: 1 }];
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('blocked');

    expect(screen.getByTitle('Blocked by 1 open task')).toHaveTextContent('1');
  });

  it('ignores a done local blocker but still counts the remote ones', async () => {
    board.columns = [
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Done', sort_key: 'V0000020001', is_done: true },
    ];
    board.tasks = [
      task(T1, 'c2', 1000, 'finished'),
      {
        ...task(T2, 'c1', 2000, 'blocked'),
        blocker_ids: [T1],
        open_cross_project_blocker_count: 1,
      },
    ];
    render(Board, { props: { projectId: PROJECT_ID } });
    await screen.findByText('blocked');

    expect(screen.getByTitle('Blocked by 1 open task')).toHaveTextContent('1');
  });
});
