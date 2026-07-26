import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Board from './Board.svelte';
import { board } from '../lib/board.svelte';
import { draftKey, drafts } from '../lib/drafts.svelte';
import { selection } from '../lib/selection.svelte';
import type { BoardTask } from '../lib/board-types';

function task(id: string, columnId: string, position: number, title: string): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, { users: [] }));
  board.reset();
  selection.clear();
  drafts.clearAll();
  board.columns = [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }];
  board.tasks = [
    task('t1', 'c1', 1000, 'plain one'),
    task('t2', 'c1', 2000, 'match a'),
    task('t3', 'c1', 3000, 'plain two'),
    task('t4', 'c1', 4000, 'match b'),
  ];
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

function addColumnTile(): HTMLElement {
  const element = screen.getByRole('button', { name: '+ Add column' }).parentElement;
  if (!(element instanceof HTMLElement)) {
    throw new Error('Add column tile not rendered');
  }
  return element;
}

function cardTitles(): string[] {
  return [...column().querySelectorAll('a p')].map((p) => p.textContent ?? '');
}

function alertText(): string {
  return document.getElementById('dnd-action-aria-alert')?.textContent ?? '';
}

function patchRequests(): Request[] {
  return fetchMock.mock.calls
    .map((call) => call[0] as Request)
    .filter((request) => request.method === 'PATCH');
}

describe('Board display order', () => {
  it('renders tasks in pure position order without filters', async () => {
    render(Board, { props: { projectId: 'p1' } });

    await screen.findByText('match a');
    expect(cardTitles()).toEqual(['plain one', 'match a', 'plain two', 'match b']);
  });

  it('renders matching tasks above dimmed ones while a filter is active', async () => {
    board.setFilterQuery('match');
    render(Board, { props: { projectId: 'p1' } });

    await screen.findByText('match a');
    expect(cardTitles()).toEqual(['match a', 'match b', 'plain one', 'plain two']);
    const dimmed = [...column().querySelectorAll('a')]
      .filter((a) => a.className.includes('opacity-30'))
      .map((a) => a.querySelector('p')?.textContent);
    expect(dimmed).toEqual(['plain one', 'plain two']);
  });
});

describe('Board column header count', () => {
  it('shows the plain total when no filter is active', async () => {
    render(Board, { props: { projectId: 'p1' } });

    await screen.findByText('plain one');
    expect(within(header('Todo')).getByText('4')).toHaveTextContent('4 tasks');
    expect(within(header('Todo')).queryByText(/ of /)).toBeNull();
  });

  it('shows matches and total while a filter is active', async () => {
    board.setFilterQuery('match');
    render(Board, { props: { projectId: 'p1' } });

    await screen.findByText('match a');
    expect(within(header('Todo')).getByText('2 of 4')).toHaveTextContent(
      '2 of 4 tasks match this filter'
    );
  });

  it('updates the header when a filter is applied and cleared after render', async () => {
    render(Board, { props: { projectId: 'p1' } });
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
      task('t5', 'c2', 1000, 'match c'),
      task('t6', 'c2', 2000, 'plain three'),
    ];
    board.setFilterQuery('match');
    render(Board, { props: { projectId: 'p1' } });

    await screen.findByText('match a');
    expect(within(header('Todo')).getByText('2 of 4')).toBeInTheDocument();
    expect(within(header('Doing')).getByText('1 of 2')).toBeInTheDocument();
  });

  it('shows 0 of 0 for a column with no tasks while a filter is active', async () => {
    board.columns = [...board.columns, { id: 'c3', name: 'Empty', position: 3000, is_done: false }];
    board.setFilterQuery('match');
    render(Board, { props: { projectId: 'p1' } });

    await screen.findByText('match a');
    expect(within(header('Empty')).getByText('0 of 0')).toBeInTheDocument();
  });

  it('counts a label filter, not just the title query', async () => {
    board.tasks = board.tasks.map((t) => (t.id === 't2' ? { ...t, label_ids: ['l1'] } : t));
    board.filterLabelIds = ['l1'];
    render(Board, { props: { projectId: 'p1' } });

    await screen.findByText('match a');
    expect(within(header('Todo')).getByText('1 of 4')).toBeInTheDocument();
  });
});

describe('Board snapping', () => {
  it('centers snap targets below md, aligns them to the start from md, and drops snapping at lg', async () => {
    render(Board, { props: { projectId: 'p1' } });
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
    render(Board, { props: { projectId: 'p1' } });

    await fireEvent.click(screen.getByRole('button', { name: '+ Add column' }));

    expect(nameInput()).toHaveFocus();
  });

  it('restores an unsent column name on remount without stealing focus', async () => {
    const first = render(Board, { props: { projectId: 'p1' } });
    await typeName('Backlog');
    first.unmount();

    render(Board, { props: { projectId: 'p1' } });

    const restored = nameInput();
    expect(restored).toHaveValue('Backlog');
    expect(restored).not.toHaveFocus();
  });

  it('stays open when the text is emptied', async () => {
    render(Board, { props: { projectId: 'p1' } });
    await typeName('Backlog');

    await fireEvent.input(nameInput(), { target: { value: '' } });

    expect(nameInput()).toBeInTheDocument();
  });

  it('closes and clears the draft on submit', async () => {
    board.currentProjectId = 'p1';
    render(Board, { props: { projectId: 'p1' } });
    await typeName('Backlog');

    await fireEvent.submit(nameInput().closest('form')!);

    expect(board.columns.map((column) => column.name)).toEqual(['Todo', 'Backlog']);
    expect(screen.getByRole('button', { name: '+ Add column' })).toBeInTheDocument();
    expect(drafts.get(draftKey.addColumn('p1'))).toBeNull();
  });

  it('stays closed on remount after Escape discarded the draft', async () => {
    const first = render(Board, { props: { projectId: 'p1' } });
    await typeName('Discard me');
    await fireEvent.keyDown(nameInput(), { key: 'Escape' });
    first.unmount();

    render(Board, { props: { projectId: 'p1' } });

    expect(screen.getByRole('button', { name: '+ Add column' })).toBeInTheDocument();
    expect(drafts.get(draftKey.addColumn('p1'))).toBeNull();
  });

  it('does not leak a draft into another project', async () => {
    const first = render(Board, { props: { projectId: 'p1' } });
    await typeName('Project one only');
    first.unmount();

    render(Board, { props: { projectId: 'p2' } });

    expect(screen.getByRole('button', { name: '+ Add column' })).toBeInTheDocument();
  });
});

describe('Board keyboard reordering', () => {
  it('reorders task cards with Enter and arrows, committing each move', async () => {
    render(Board, { props: { projectId: 'p1' } });
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
    expect(new URL(patch.url).pathname).toBe('/api/tasks/t1');
    expect(await patch.clone().json()).toEqual({ column_id: 'c1', position: 2500 });

    await fireEvent.keyDown(item, { key: 'Enter' });
    await vi.waitFor(() => expect(board.dragging).toBe(false));
    expect(alertText()).toContain('Stopped dragging item plain one');
  });

  it('leaves Enter on a task card link to the browser', async () => {
    render(Board, { props: { projectId: 'p1' } });
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
    render(Board, { props: { projectId: 'p1' } });

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
