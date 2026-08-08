import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import {
  SHADOW_PLACEHOLDER_ITEM_ID,
  SOURCES,
  TRIGGERS,
  type DndEvent,
  type Options,
} from 'svelte-dnd-action';
import TaskChecklist from './TaskChecklist.svelte';
import { board } from '../lib/board.svelte';
import { motion } from '../lib/motion.svelte';
import { router } from '../lib/router.svelte';
import { testUuid } from '../lib/test-ids';
import { TASK_TITLE_MAX_LENGTH } from '../lib/titles';
import type { BoardTask, ChecklistItem } from '../lib/board-types';

const PROJECT_ID = testUuid('p1');
const T1 = testUuid('t1');
const T2 = testUuid('t2');
const NEW_CARD = testUuid('new');

const { zoneOptions } = vi.hoisted(() => ({ zoneOptions: [] as Options[] }));

// Wraps rather than replaces: the rows still need the real action's list roles and
// tab indices.
vi.mock('svelte-dnd-action', async (importOriginal) => {
  const actual = await importOriginal<typeof import('svelte-dnd-action')>();
  return {
    ...actual,
    dragHandleZone: (node: HTMLElement, options: Options) => {
      zoneOptions.push(options);
      const zone = actual.dragHandleZone(node, options);
      return {
        update: (next: Options) => {
          zoneOptions.push(next);
          zone.update?.(next);
        },
        destroy: () => zone.destroy?.(),
      };
    },
  };
});

function checklistConfigs(): Options[] {
  return zoneOptions.filter((options) => options.type === 'checklist');
}

function task(id: string, overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    column_id: 'c1',
    title: id,
    description: null,
    sort_key: 'V0000010001',
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
    ...overrides,
  };
}

function item(id: string, text: string, position: number, checked = false): ChecklistItem {
  return {
    id: testUuid(id),
    task_id: T1,
    text,
    checked,
    sort_key: `V0${String(Math.round(position)).padStart(8, '0')}1`,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
  };
}

const A = item('i-a', 'Buy sleeves', 1000);
const B = item('i-b', 'Cut prototype', 2000);
const C = item('i-c', 'Sort tokens', 3000, true);

// What a drag hands back in place of the row it lifted: the whole row, cloned,
// with only its id swapped — so it draws as a perfectly ordinary one.
function shadowOf(source: ChecklistItem): ChecklistItem {
  return { ...source, id: SHADOW_PLACEHOLDER_ITEM_ID, isDndShadowItem: true } as ChecklistItem;
}

const SHADOW = shadowOf(B);

function renderChecklist(
  props: { taskId?: string; readonly?: boolean } = {}
): ReturnType<typeof render> {
  return render(TaskChecklist, {
    taskId: T1,
    taskPath: (id: string) => `/task/${id}`,
    ...props,
  });
}

function zone(): HTMLElement {
  const element = document.querySelector('[aria-label="Checklist items"]');
  if (!(element instanceof HTMLElement)) {
    throw new Error('checklist zone not rendered');
  }
  return element;
}

function progress(): HTMLElement {
  return screen.getByRole('progressbar', { name: 'Checklist progress' });
}

function rowNames(): string[] {
  return screen.getAllByRole('listitem').map((row) => row.getAttribute('aria-label') ?? '');
}

async function consider(
  items: ChecklistItem[],
  info: DndEvent<ChecklistItem>['info']
): Promise<void> {
  await fireEvent(zone(), new CustomEvent('consider', { detail: { items, info } }));
}

async function finalize(
  items: ChecklistItem[],
  info: DndEvent<ChecklistItem>['info']
): Promise<void> {
  await fireEvent(zone(), new CustomEvent('finalize', { detail: { items, info } }));
}

function pickUp(id: string, items: ChecklistItem[]): Promise<void> {
  return consider(items, { trigger: TRIGGERS.DRAG_STARTED, id, source: SOURCES.POINTER });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(204));
  zoneOptions.length = 0;
  motion.reduced = false;
  board.reset();
  board.currentProjectId = PROJECT_ID;
  board.columns = [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }];
  board.tasks = [
    task(T1, { checklist_item_count: 3, checklist_done_count: 1 }),
    task(T2, { sort_key: 'V0000020001' }),
  ];
  board.taskChecklists = { [T1]: [A, B, C], [T2]: [] };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskChecklist progress', () => {
  it('counts the card, not the list it happens to be drawing', () => {
    renderChecklist();

    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(progress()).toHaveAttribute('aria-valuemax', '3');
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  // A drag rewrites the drawn list with a placeholder in it. Deriving the total from
  // that list makes the tally jump the moment anyone picks a row up.
  it('holds steady while a drag puts a placeholder in the list', async () => {
    renderChecklist();

    await pickUp(B.id, [A, SHADOW, B, C]);

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4));
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(progress()).toHaveAttribute('aria-valuemax', '3');
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('shows no progress for a card with no checklist', () => {
    board.tasks = [task(T1)];
    board.taskChecklists = { [T1]: [] };
    renderChecklist();

    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('draws no list at all before the detail fetch has landed', () => {
    board.taskChecklists = {};
    renderChecklist();

    expect(document.querySelector('[aria-label="Checklist items"]')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});

describe('TaskChecklist reordering', () => {
  it('drops the placeholder before pricing the move, so the position stays finite', async () => {
    const move = vi.spyOn(board, 'moveChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    await pickUp(C.id, [A, B, SHADOW]);
    // C landed between A and B, and the placeholder is still sitting beside it.
    await finalize([A, SHADOW, C, B], {
      trigger: TRIGGERS.DROPPED_INTO_ZONE,
      id: C.id,
      source: SOURCES.POINTER,
    });

    expect(move).toHaveBeenCalledTimes(1);
    const placed = move.mock.calls[0]![2];
    expect(placed.sort_key > A.sort_key!).toBe(true);
    expect(placed.sort_key < B.sort_key!).toBe(true);
    expect(move).toHaveBeenCalledWith(T1, C.id, placed);
  });

  it('writes nothing when a row is dropped back where it was picked up', async () => {
    const move = vi.spyOn(board, 'moveChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    await pickUp(B.id, [A, SHADOW, C]);
    await finalize([A, B, C], {
      trigger: TRIGGERS.DROPPED_INTO_ZONE,
      id: B.id,
      source: SOURCES.POINTER,
    });

    expect(move).not.toHaveBeenCalled();
  });

  it('leaves the placeholder row inert while it stands in for the lifted one', async () => {
    renderChecklist();

    await pickUp(B.id, [A, shadowOf(B), C]);

    await waitFor(() =>
      expect(rowNames()).toEqual(['Buy sleeves', 'Cut prototype', 'Sort tokens'])
    );
    expect(screen.getByRole('checkbox', { name: 'Cut prototype' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reorder Cut prototype' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Convert Cut prototype to a card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Cut prototype' })).toBeNull();
  });

  it('ignores a finalize that is not a drop into this zone', async () => {
    const move = vi.spyOn(board, 'moveChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    await pickUp(B.id, [A, SHADOW, C]);
    await finalize([A, C], {
      trigger: TRIGGERS.DROPPED_INTO_ANOTHER,
      id: B.id,
      source: SOURCES.POINTER,
    });

    expect(move).not.toHaveBeenCalled();
  });
});

describe('TaskChecklist drag flag', () => {
  it('stays up across a keyboard finalize and comes down on the stop', async () => {
    vi.spyOn(board, 'moveChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    await pickUp(B.id, [A, B, C]);
    await waitFor(() => expect(board.detailDragging).toBe(true));

    // A keyboard drag finalizes on every arrow press; only the DRAG_STOPPED consider
    // ends it, so the flag has to survive this one.
    await finalize([B, A, C], {
      trigger: TRIGGERS.DROPPED_INTO_ZONE,
      id: B.id,
      source: SOURCES.KEYBOARD,
    });
    // Waiting on the render the finalize drove reads the flag after the flush its
    // effect runs in, not before it.
    await waitFor(() =>
      expect(rowNames()).toEqual(['Cut prototype', 'Buy sleeves', 'Sort tokens'])
    );
    expect(board.detailDragging).toBe(true);

    await consider([B, A, C], {
      trigger: TRIGGERS.DRAG_STOPPED,
      id: B.id,
      source: SOURCES.KEYBOARD,
    });

    await waitFor(() => expect(board.detailDragging).toBe(false));
  });

  it('comes down after a pointer finalize', async () => {
    vi.spyOn(board, 'moveChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    await pickUp(B.id, [A, SHADOW, C]);
    await waitFor(() => expect(board.detailDragging).toBe(true));

    await finalize([B, A, C], {
      trigger: TRIGGERS.DROPPED_INTO_ZONE,
      id: B.id,
      source: SOURCES.POINTER,
    });

    await waitFor(() => expect(board.detailDragging).toBe(false));
  });

  // A flag left up buffers every realtime board event for the rest of the session.
  it('clears the flag when the overlay unmounts mid-drag', async () => {
    const view = renderChecklist();

    await pickUp(B.id, [A, SHADOW, C]);
    await waitFor(() => expect(board.detailDragging).toBe(true));

    view.unmount();

    await waitFor(() => expect(board.detailDragging).toBe(false));
  });

  it('clears the flag when the overlay swaps to another card mid-drag', async () => {
    const view = renderChecklist();

    await pickUp(B.id, [A, SHADOW, C]);
    await waitFor(() => expect(board.detailDragging).toBe(true));

    await view.rerender({ taskId: T2, taskPath: (id: string) => `/task/${id}` });

    await waitFor(() => expect(board.detailDragging).toBe(false));
  });
});

describe('TaskChecklist rows', () => {
  it('keeps both row actions in the accessibility tree at rest', () => {
    renderChecklist();

    expect(
      screen.getByRole('button', { name: 'Convert Cut prototype to a card' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Cut prototype' })).toBeInTheDocument();
  });

  it('ticks an item through the store', async () => {
    const setChecked = vi.spyOn(board, 'setChecklistItemChecked').mockResolvedValue(undefined);
    renderChecklist();

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Cut prototype' }));

    expect(setChecked).toHaveBeenCalledWith(T1, B.id, true);
  });

  it('unticks an item that was done', async () => {
    const setChecked = vi.spyOn(board, 'setChecklistItemChecked').mockResolvedValue(undefined);
    renderChecklist();

    expect(screen.getByRole('checkbox', { name: 'Sort tokens' })).toBeChecked();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Sort tokens' }));

    expect(setChecked).toHaveBeenCalledWith(T1, C.id, false);
  });

  it('strikes through the text of a ticked row', () => {
    renderChecklist();

    expect(screen.getByRole('button', { name: 'Sort tokens' })).toHaveClass('line-through');
    expect(screen.getByRole('button', { name: 'Cut prototype' })).not.toHaveClass('line-through');
  });

  it('renames an item from the inline editor on Enter', async () => {
    const rename = vi.spyOn(board, 'renameChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    await fireEvent.click(screen.getByRole('button', { name: 'Cut prototype' }));
    const input = screen.getByRole('textbox', { name: 'Rename Cut prototype' });
    await fireEvent.input(input, { target: { value: 'Cut the prototype' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(rename).toHaveBeenCalledWith(T1, B.id, 'Cut the prototype');
  });

  it('renames an item when the inline editor is blurred', async () => {
    const rename = vi.spyOn(board, 'renameChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    await fireEvent.click(screen.getByRole('button', { name: 'Cut prototype' }));
    const input = screen.getByRole('textbox', { name: 'Rename Cut prototype' });
    await fireEvent.input(input, { target: { value: 'Cut two prototypes' } });
    await fireEvent.blur(input);

    expect(rename).toHaveBeenCalledWith(T1, B.id, 'Cut two prototypes');
  });

  it('writes nothing for an unchanged or emptied rename', async () => {
    const rename = vi.spyOn(board, 'renameChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    await fireEvent.click(screen.getByRole('button', { name: 'Cut prototype' }));
    await fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename Cut prototype' }), {
      key: 'Enter',
    });
    expect(rename).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Cut prototype' }));
    const reopened = screen.getByRole('textbox', { name: 'Rename Cut prototype' });
    await fireEvent.input(reopened, { target: { value: '   ' } });
    await fireEvent.keyDown(reopened, { key: 'Enter' });

    expect(rename).not.toHaveBeenCalled();
  });

  it('discards the rename on Escape', async () => {
    const rename = vi.spyOn(board, 'renameChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    await fireEvent.click(screen.getByRole('button', { name: 'Cut prototype' }));
    const input = screen.getByRole('textbox', { name: 'Rename Cut prototype' });
    await fireEvent.input(input, { target: { value: 'Scrapped' } });
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cut prototype' })).toBeInTheDocument();
  });

  it('deletes an item only on the second press, renaming the control in between', async () => {
    const remove = vi.spyOn(board, 'deleteChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete Cut prototype' }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Delete Cut prototype' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Confirm delete of Cut prototype' }));

    expect(remove).toHaveBeenCalledWith(T1, B.id);
  });

  it('opens the card a converted item became', async () => {
    const promote = vi.spyOn(board, 'promoteChecklistItem').mockResolvedValue(NEW_CARD);
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    renderChecklist();

    await fireEvent.click(screen.getByRole('button', { name: 'Convert Cut prototype to a card' }));

    expect(promote).toHaveBeenCalledWith(T1, B.id);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/task/${NEW_CARD}`));
  });

  it('disables the convert control while the card is being made', async () => {
    let finish!: (id: string | null) => void;
    vi.spyOn(board, 'promoteChecklistItem').mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        })
    );
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    renderChecklist();

    const convert = screen.getByRole('button', { name: 'Convert Cut prototype to a card' });
    await fireEvent.click(convert);

    await waitFor(() => expect(convert).toBeDisabled());

    finish(NEW_CARD);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/task/${NEW_CARD}`));
    expect(convert).not.toBeDisabled();
  });

  it('does not open the new card when the overlay went away in flight', async () => {
    let finish!: (id: string | null) => void;
    vi.spyOn(board, 'promoteChecklistItem').mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        })
    );
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    const view = renderChecklist();

    await fireEvent.click(screen.getByRole('button', { name: 'Convert Cut prototype to a card' }));
    view.unmount();

    finish(NEW_CARD);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('TaskChecklist add row', () => {
  it('adds the trimmed text and keeps the field focused for the next one', async () => {
    const add = vi.spyOn(board, 'addChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    const input = screen.getByRole('textbox', { name: 'Checklist item' });
    await fireEvent.input(input, { target: { value: '  Sleeve the deck  ' } });
    await fireEvent.submit(input.closest('form')!);

    expect(add).toHaveBeenCalledWith(T1, 'Sleeve the deck');
    await waitFor(() => expect(input).toHaveValue(''));
    expect(input).toHaveFocus();
  });

  it('ignores an empty submit', async () => {
    const add = vi.spyOn(board, 'addChecklistItem').mockResolvedValue(undefined);
    renderChecklist();

    const input = screen.getByRole('textbox', { name: 'Checklist item' });
    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.submit(input.closest('form')!);

    expect(add).not.toHaveBeenCalled();
  });

  // The API keeps the two maxima equal because promoting an item writes its text
  // into a title, so the cap here is the title's, not a second copy of the number.
  it('caps the text at the length the API accepts', () => {
    renderChecklist();

    expect(screen.getByRole('textbox', { name: 'Checklist item' })).toHaveAttribute(
      'maxlength',
      String(TASK_TITLE_MAX_LENGTH)
    );
    expect(TASK_TITLE_MAX_LENGTH).toBe(2000);
  });

  it('does not carry a draft onto another card', async () => {
    const view = renderChecklist();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Checklist item' }), {
      target: { value: 'Only for t1' },
    });

    await view.rerender({ taskId: T2, taskPath: (id: string) => `/task/${id}` });

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Checklist item' })).toHaveValue('')
    );
  });
});

describe('TaskChecklist for a viewer', () => {
  it('shows the whole list and the progress with nothing to write with', () => {
    renderChecklist({ readonly: true });

    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText('Cut prototype')).toBeInTheDocument();
    expect(screen.getByText('Sort tokens')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Cut prototype' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Sort tokens' })).toBeChecked();

    expect(screen.queryByRole('button', { name: /^Reorder/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cut prototype' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Convert/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('gives an editor every control the viewer is denied', () => {
    renderChecklist();

    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByRole('button', { name: 'Reorder Cut prototype' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Cut prototype' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cut prototype' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Convert Cut prototype to a card' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Checklist item' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('locks the zone and takes its rows out of the tab order', () => {
    renderChecklist({ readonly: true });

    const options = checklistConfigs().at(-1);
    expect(options?.dragDisabled).toBe(true);
    expect(options?.zoneItemTabIndex).toBe(-1);
  });

  it('leaves the zone draggable and focusable for an editor', () => {
    renderChecklist();

    const options = checklistConfigs().at(-1);
    expect(options?.dragDisabled).toBe(false);
    expect(options?.zoneItemTabIndex).toBe(0);
    expect(options?.dropFromOthersDisabled).toBe(true);
  });
});
