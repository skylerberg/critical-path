import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import TaskCard from './TaskCard.svelte';
import { board } from '../lib/board.svelte';
import type { BoardTask } from '../lib/board-types';
import { cardMenu } from '../lib/card-menu.svelte';
import { todayISO } from '../lib/dates';
import { router } from '../lib/router.svelte';
import { SHADOW_PLACEHOLDER_ITEM_ID } from 'svelte-dnd-action';
import { selection } from '../lib/selection.svelte';
import { session } from '../lib/session.svelte';
import { publicTaskHref, taskHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
import { TASK_TITLE_MAX_LENGTH, TITLE_DISPLAY_LIMIT, truncateTitle } from '../lib/titles';
import { users } from '../lib/users.svelte';

const PROJECT_ID = testUuid('p1');
const TASK_ID = testUuid('t1');

const task: BoardTask = {
  id: TASK_ID,
  column_id: 'c1',
  title: 'Design cards',
  description: null,
  sort_key: 'V0000010001',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  column_since: '2026-01-01T00:00:00Z',
  label_ids: ['l1'],
  assignee_ids: ['u1'],
  blocker_ids: ['t9', 't8'],
  open_cross_project_blocker_count: 0,
  cover_image_url: null,
  due_date: null,
  comment_count: 0,
  checklist_item_count: 0,
  checklist_done_count: 0,
  attachment_count: 3,
};

beforeEach(() => {
  board.reset();
  users.reset();
  cardMenu.reset();
  board.tasks = [task];
  users.users = [{ id: 'u1', name: 'Ada Lovelace', avatar_url: null }];
});

afterEach(() => {
  cardMenu.reset();
  vi.restoreAllMocks();
});

// Relative to the real today, so the colour bands stay meaningful as time passes.
function dueIn(days: number): BoardTask {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return { ...task, due_date: todayISO(date) };
}

function card(): HTMLElement {
  const element = screen.getByRole('link').parentElement;
  if (element === null) {
    throw new Error('The overlay link has no card container');
  }
  return element;
}

function pill(): HTMLElement {
  return screen.getByTitle(/^Due /);
}

describe('TaskCard', () => {
  it('renders title, label chips, assignee avatar, blocked and attachment badges, and the link', () => {
    render(TaskCard, {
      task,
      projectId: PROJECT_ID,
      labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
      blockedCount: 2,
    });

    expect(screen.getByText('Design cards')).toBeInTheDocument();
    expect(screen.getByText('art')).toBeInTheDocument();
    expect(screen.getByTitle('Ada Lovelace')).toHaveTextContent('AL');
    expect(screen.getByTitle('Blocked by 2 open tasks')).toHaveTextContent('2');
    expect(screen.getByTitle('3 attachments')).toHaveTextContent('3');
    expect(screen.getByRole('link')).toHaveAttribute('href', taskHref(TASK_ID, 'Design cards'));
  });

  it('omits badges and chips when there is nothing to show', () => {
    render(TaskCard, {
      task: {
        ...task,
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        open_cross_project_blocker_count: 0,
        attachment_count: 0,
      },
      projectId: PROJECT_ID,
    });

    expect(screen.getByText('Design cards')).toBeInTheDocument();
    expect(screen.queryByText('art')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Blocked by/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/comment/)).not.toBeInTheDocument();
  });

  it('shows the comment badge, pluralized, only when there are comments', () => {
    const { unmount } = render(TaskCard, {
      task: { ...task, comment_count: 3 },
      projectId: PROJECT_ID,
    });
    expect(screen.getByTitle('3 comments')).toHaveTextContent('3');
    unmount();

    render(TaskCard, { task: { ...task, comment_count: 1 }, projectId: PROJECT_ID });
    expect(screen.getByTitle('1 comment')).toHaveTextContent('1');
  });

  it('shows the badge row when the comment count is the only badge', () => {
    render(TaskCard, {
      task: {
        ...task,
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        open_cross_project_blocker_count: 0,
        attachment_count: 0,
        comment_count: 2,
      },
      projectId: PROJECT_ID,
    });

    expect(screen.getByTitle('2 comments')).toHaveTextContent('2');
  });

  it('renders the checklist progress and turns it green only once every item is done', () => {
    const { rerender } = render(TaskCard, {
      task: { ...task, checklist_item_count: 5, checklist_done_count: 2 },
      projectId: PROJECT_ID,
    });

    const partial = screen.getByTitle('2 of 5 checklist items done');
    expect(partial).toHaveTextContent('2/5');
    expect(partial.className).toContain('text-muted');

    void rerender({
      task: { ...task, checklist_item_count: 5, checklist_done_count: 5 },
      projectId: PROJECT_ID,
    });

    expect(screen.getByTitle('5 of 5 checklist items done').className).toContain('text-success');
  });

  it('renders no checklist badge for an empty checklist, nor for a payload that predates the counts', () => {
    const { rerender } = render(TaskCard, { task, projectId: PROJECT_ID });
    expect(screen.queryByTitle(/checklist/)).not.toBeInTheDocument();

    const legacy: Partial<BoardTask> = { ...task };
    delete legacy.checklist_item_count;
    delete legacy.checklist_done_count;
    void rerender({ task: legacy as BoardTask, projectId: PROJECT_ID });

    expect(screen.queryByTitle(/checklist/)).not.toBeInTheDocument();
    expect(screen.getByText('Design cards')).toBeInTheDocument();
  });

  it('shows the badge row when the checklist is the only badge', () => {
    render(TaskCard, {
      task: {
        ...task,
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        open_cross_project_blocker_count: 0,
        attachment_count: 0,
        checklist_item_count: 1,
        checklist_done_count: 0,
      },
      projectId: PROJECT_ID,
    });

    expect(screen.getByTitle('0 of 1 checklist item done')).toHaveTextContent('0/1');
  });

  it('shows the attachment badge, pluralized, only when there are attachments', () => {
    const { unmount } = render(TaskCard, {
      task: { ...task, attachment_count: 3 },
      projectId: PROJECT_ID,
    });
    expect(screen.getByTitle('3 attachments')).toHaveTextContent('3');
    unmount();

    render(TaskCard, { task: { ...task, attachment_count: 1 }, projectId: PROJECT_ID });
    expect(screen.getByTitle('1 attachment')).toHaveTextContent('1');
  });

  it('shows the badge row when the attachment count is the only badge', () => {
    render(TaskCard, {
      task: {
        ...task,
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        open_cross_project_blocker_count: 0,
        attachment_count: 2,
      },
      projectId: PROJECT_ID,
    });

    expect(screen.getByTitle('2 attachments')).toHaveTextContent('2');
  });

  it('renders no attachment badge for none, nor for a payload that predates the count', () => {
    const bare = { ...task, attachment_count: 0 };
    const { rerender } = render(TaskCard, { task: bare, projectId: PROJECT_ID });
    expect(screen.queryByTitle(/attachment/)).not.toBeInTheDocument();

    const legacy: Partial<BoardTask> = { ...bare };
    delete legacy.attachment_count;
    void rerender({ task: legacy as BoardTask, projectId: PROJECT_ID });

    expect(screen.queryByTitle(/attachment/)).not.toBeInTheDocument();
    expect(screen.getByText('Design cards')).toBeInTheDocument();
  });

  it('renders no comment badge when the payload predates comment_count', () => {
    const legacy: Partial<BoardTask> = { ...task };
    delete legacy.comment_count;
    render(TaskCard, { task: legacy as BoardTask, projectId: PROJECT_ID });

    expect(screen.queryByTitle(/comment/)).not.toBeInTheDocument();
    expect(screen.getByText('Design cards')).toBeInTheDocument();
  });

  describe('cover image', () => {
    it('renders the cover above the title, alongside the attachment badge', () => {
      render(TaskCard, {
        task: { ...task, cover_image_url: '/api/images/img1' },
        projectId: PROJECT_ID,
      });

      const cover = card().querySelector('img');
      expect(cover).toHaveAttribute('src', '/api/images/img1');
      expect(cover).toHaveAttribute('loading', 'lazy');
      expect(cover).toHaveAttribute('alt', '');
      const title = screen.getByText('Design cards');
      expect(cover?.compareDocumentPosition(title)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(screen.getByTitle('3 attachments')).toBeInTheDocument();
    });

    it('renders no image at all without a cover', () => {
      render(TaskCard, { task, projectId: PROJECT_ID });

      expect(card().querySelector('img')).toBeNull();
    });

    // Every other fixture sets the field, so only this can catch a `!== null` guard.
    it('renders no image when the payload predates cover_image_url', () => {
      const legacy: Partial<BoardTask> = { ...task };
      delete legacy.cover_image_url;
      render(TaskCard, { task: legacy as BoardTask, projectId: PROJECT_ID });

      expect(card().querySelector('img')).toBeNull();
      expect(screen.getByText('Design cards')).toBeInTheDocument();
    });

    it('shows the cover on a read-only board too', () => {
      render(TaskCard, {
        task: { ...task, cover_image_url: '/api/images/img1' },
        projectId: PROJECT_ID,
        readonly: true,
      });

      expect(card().querySelector('img')).toHaveAttribute('src', '/api/images/img1');
    });
  });

  it('carries the active filters into the task link so closing the card comes back filtered', () => {
    board.setFilters({ labelIds: ['l1'], assigneeIds: [], query: 'boss' });

    render(TaskCard, { task, projectId: PROJECT_ID });

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `${taskHref(TASK_ID, 'Design cards')}?labels=l1&q=boss`
    );
  });

  it('keeps the private path for a read-only member', () => {
    render(TaskCard, { task, projectId: PROJECT_ID, readonly: true });

    expect(screen.getByRole('link')).toHaveAttribute('href', taskHref(TASK_ID, 'Design cards'));
  });

  it('points at the public path on a public board, changing nothing else', () => {
    board.readonly = true;
    board.setFilters({ labelIds: ['l1'], assigneeIds: [], query: 'boss' });
    render(TaskCard, {
      task,
      projectId: PROJECT_ID,
      readonly: true,
      labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
      blockedCount: 2,
    });

    expect(screen.getByRole('link')).toHaveAttribute('href', publicTaskHref(PROJECT_ID, TASK_ID));
    expect(screen.getByText('Design cards')).toBeInTheDocument();
    expect(screen.getByText('art')).toBeInTheDocument();
    expect(screen.getByTitle('Ada Lovelace')).toHaveTextContent('AL');
    expect(screen.getByTitle('Blocked by 2 open tasks')).toHaveTextContent('2');
    expect(screen.getByTitle('3 attachments')).toHaveTextContent('3');
  });

  it('dims the card when filtered out', () => {
    render(TaskCard, { task, projectId: PROJECT_ID, dimmed: true });

    expect(card().className).toContain('opacity-30');
  });

  // The overlay link paints over its in-flow siblings, so without this the badge
  // and avatar tooltips stop reaching the pointer on every card, dated or not.
  it('raises the badge row above the overlay link', () => {
    render(TaskCard, { task, projectId: PROJECT_ID });

    const row = screen.getByTitle('3 attachments').parentElement;
    expect(row?.className).toContain('relative');
    expect(row?.className).toContain('z-10');
  });

  // jsdom has no hit-testing, so this class pair is the only thing that can catch
  // the raised row swallowing clicks across the card's full width.
  it('leaves the gaps between badges to the overlay link', () => {
    render(TaskCard, { task, projectId: PROJECT_ID, blockedCount: 2 });

    expect(screen.getByTitle('3 attachments').parentElement?.className).toContain(
      'pointer-events-none'
    );
    for (const badge of ['3 attachments', 'Blocked by 2 open tasks']) {
      expect(screen.getByTitle(badge).className).toContain('pointer-events-auto');
    }
    expect(screen.getByTitle('Ada Lovelace').parentElement?.className).toContain(
      'pointer-events-auto'
    );
  });

  describe('long-press link menu', () => {
    function contextMenu(target: Element, pointerType: string): boolean {
      const event = new PointerEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        pointerType,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }

    it('suppresses the native callout across the whole card, not just the link', () => {
      render(TaskCard, { task, projectId: PROJECT_ID });

      expect(card().className).toContain('touch-callout-none');
    });

    // A finger's menu comes from the press handler, so the platform event has to
    // die here without also being the thing that opens it.
    it('cancels a touch context menu, and answers a right-click with the card menu', () => {
      render(TaskCard, { task, projectId: PROJECT_ID });

      expect(contextMenu(screen.getByRole('link'), 'touch')).toBe(true);
      expect(contextMenu(screen.getByRole('link'), 'pen')).toBe(true);
      expect(cardMenu.taskId).toBeNull();

      expect(contextMenu(screen.getByRole('link'), 'mouse')).toBe(true);
      expect(cardMenu.taskId).toBe(TASK_ID);
    });

    // An assignee avatar is an <img>, which raises a callout of its own.
    it('cancels a touch context menu on the badges raised above the link', () => {
      render(TaskCard, { task, projectId: PROJECT_ID, blockedCount: 2 });

      expect(contextMenu(screen.getByTitle('Ada Lovelace'), 'touch')).toBe(true);
      expect(contextMenu(screen.getByTitle('Blocked by 2 open tasks'), 'touch')).toBe(true);
    });

    it('cancels a touch context menu on the listener-less clone dragged under the finger', () => {
      render(TaskCard, { task, projectId: PROJECT_ID });
      const clone = card().cloneNode(true) as HTMLElement;
      document.body.append(clone);
      onTestFinished(() => clone.remove());

      const anchor = clone.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(contextMenu(anchor!, 'touch')).toBe(true);
    });
  });

  describe('context menu', () => {
    function rightClick(target: Element, init: MouseEventInit = {}): boolean {
      const event = new PointerEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        button: 2,
        clientX: 120,
        clientY: 90,
        ...init,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }

    it('opens on right-click, at the pointer, in place of the browser menu', () => {
      render(TaskCard, { task, projectId: PROJECT_ID });

      expect(rightClick(screen.getByRole('link'))).toBe(true);
      expect(cardMenu.taskId).toBe(TASK_ID);
      expect(cardMenu.x).toBe(120);
      expect(cardMenu.y).toBe(90);
    });

    // Losing "open link in new tab" and "copy link" on every card is the cost of
    // owning the menu, so Shift is the way back to the browser's own.
    it('stands aside for a Shift+right-click', () => {
      render(TaskCard, { task, projectId: PROJECT_ID });

      expect(rightClick(screen.getByRole('link'), { shiftKey: true })).toBe(false);
      expect(cardMenu.taskId).toBeNull();
    });

    it('stays out of a drag', () => {
      board.dragging = true;
      render(TaskCard, { task, projectId: PROJECT_ID });

      expect(rightClick(screen.getByRole('link'))).toBe(false);
      expect(cardMenu.taskId).toBeNull();
    });

    // Tab focuses the drag wrapper, so that — not the card — is what Shift+F10 and
    // the context-menu key fire on.
    it('opens from the keyboard on the card wrapper that holds focus', () => {
      const { container } = render(TaskCard, { task, projectId: PROJECT_ID });

      expect(rightClick(container, { clientX: 0, clientY: 0 })).toBe(true);
      expect(cardMenu.taskId).toBe(TASK_ID);
    });

    // Pressed on the card's own padding, which is what a finger held beside the
    // open editor lands on: the title itself is gone by then.
    it('starts a long press only for a finger, and never mid-rename', async () => {
      const pressStart = vi.spyOn(cardMenu, 'pressStart');
      const { container } = render(TaskCard, { task, projectId: PROJECT_ID });

      await fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'touch' });
      expect(pressStart).toHaveBeenCalledTimes(1);

      cardMenu.rename(TASK_ID);
      await screen.findByLabelText('Task title');
      const body = container.querySelector('[role="presentation"]');
      expect(body?.isConnected).toBe(true);

      await fireEvent.pointerDown(body!, { pointerType: 'touch' });
      expect(pressStart).toHaveBeenCalledTimes(1);
    });

    // Cut, copy and paste are the browser's to offer, and taking them would also
    // blur the edit they belong to.
    it('leaves the browser its own menu inside the open title editor', async () => {
      render(TaskCard, { task, projectId: PROJECT_ID });
      cardMenu.rename(TASK_ID);
      const input = await screen.findByLabelText('Task title');

      expect(rightClick(input)).toBe(false);
      expect(cardMenu.taskId).toBeNull();
    });
  });

  describe('long titles', () => {
    const long = task.title + 'x'.repeat(TASK_TITLE_MAX_LENGTH - task.title.length);

    it('clips the face and the link name to the display limit', () => {
      render(TaskCard, { task: { ...task, title: long }, projectId: PROJECT_ID });

      const shown = truncateTitle(long);
      expect(screen.getByText(shown)).toBeInTheDocument();
      expect(screen.queryByText(long)).toBeNull();
      expect(screen.getByRole('link')).toHaveAccessibleName(shown);
      expect([...shown]).toHaveLength(TITLE_DISPLAY_LIMIT + 1);
    });

    it('hands the rename editor the whole stored title, not the clipped one', async () => {
      render(TaskCard, { task: { ...task, title: long }, projectId: PROJECT_ID });
      cardMenu.rename(TASK_ID);

      const input = await screen.findByLabelText('Task title');
      expect(input).toHaveValue(long);
      expect(input).toHaveAttribute('maxlength', String(TASK_TITLE_MAX_LENGTH));
    });
  });

  describe('inline rename', () => {
    it('swaps the title for an editor and takes the overlay link out of the way', async () => {
      render(TaskCard, { task, projectId: PROJECT_ID });
      expect(screen.getByRole('link')).toBeInTheDocument();

      cardMenu.rename(TASK_ID);
      await vi.waitFor(() => expect(screen.getByLabelText('Task title')).toHaveFocus());

      expect(screen.getByLabelText('Task title')).toHaveValue('Design cards');
      expect(screen.queryByRole('link')).toBeNull();
    });

    it('saves on Enter without opening the card', async () => {
      const updateTask = vi.spyOn(board, 'updateTask').mockResolvedValue({
        status: 'ok',
        updated_at: '2026-01-02T00:00:00Z',
      });
      render(TaskCard, { task, projectId: PROJECT_ID });
      cardMenu.rename(TASK_ID);
      const input = await screen.findByLabelText('Task title');

      await fireEvent.input(input, { target: { value: 'Redesign cards' } });
      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(updateTask).toHaveBeenCalledWith(TASK_ID, { title: 'Redesign cards' });
      expect(cardMenu.renamingTaskId).toBeNull();
    });

    it('saves on blur', async () => {
      const updateTask = vi.spyOn(board, 'updateTask').mockResolvedValue({
        status: 'ok',
        updated_at: '2026-01-02T00:00:00Z',
      });
      render(TaskCard, { task, projectId: PROJECT_ID });
      cardMenu.rename(TASK_ID);
      const input = await screen.findByLabelText('Task title');

      await fireEvent.input(input, { target: { value: 'Redesign cards' } });
      await fireEvent.blur(input);

      expect(updateTask).toHaveBeenCalledWith(TASK_ID, { title: 'Redesign cards' });
    });

    // Unmounting the editor drops focus to the body, which strands a keyboard user
    // at the top of the document with a long column to tab back down.
    it('hands focus back to the card when a key ends the rename', async () => {
      vi.spyOn(board, 'updateTask').mockResolvedValue({
        status: 'ok',
        updated_at: '2026-01-02T00:00:00Z',
      });
      const wrapper = document.createElement('div');
      wrapper.tabIndex = 0;
      wrapper.dataset.taskId = TASK_ID;
      document.body.append(wrapper);
      onTestFinished(() => wrapper.remove());

      const first = render(TaskCard, { task, projectId: PROJECT_ID });
      cardMenu.rename(TASK_ID);
      await fireEvent.keyDown(await screen.findByLabelText('Task title'), { key: 'Enter' });
      expect(document.activeElement).toBe(wrapper);
      first.unmount();

      render(TaskCard, { task, projectId: PROJECT_ID });
      cardMenu.rename(TASK_ID);
      await fireEvent.keyDown(await screen.findByLabelText('Task title'), { key: 'Escape' });
      expect(document.activeElement).toBe(wrapper);
    });

    it('discards the edit on Escape', async () => {
      const updateTask = vi.spyOn(board, 'updateTask');
      render(TaskCard, { task, projectId: PROJECT_ID });
      cardMenu.rename(TASK_ID);
      const input = await screen.findByLabelText('Task title');

      await fireEvent.input(input, { target: { value: 'Redesign cards' } });
      await fireEvent.keyDown(input, { key: 'Escape' });

      expect(updateTask).not.toHaveBeenCalled();
      expect(cardMenu.renamingTaskId).toBeNull();
      expect(screen.getByText('Design cards')).toBeInTheDocument();
    });

    it('writes nothing for an unchanged or emptied title', async () => {
      const updateTask = vi.spyOn(board, 'updateTask');
      const { unmount } = render(TaskCard, { task, projectId: PROJECT_ID });
      cardMenu.rename(TASK_ID);
      await fireEvent.blur(await screen.findByLabelText('Task title'));
      unmount();

      render(TaskCard, { task, projectId: PROJECT_ID });
      cardMenu.rename(TASK_ID);
      const input = await screen.findByLabelText('Task title');
      await fireEvent.input(input, { target: { value: '   ' } });
      await fireEvent.blur(input);

      expect(updateTask).not.toHaveBeenCalled();
    });
  });

  describe('due date pill', () => {
    it('renders nothing at all when the task has no date', () => {
      render(TaskCard, { task, projectId: PROJECT_ID });

      expect(screen.queryByTitle(/^Due /)).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders nothing when the payload predates due_date', () => {
      const legacy: Partial<BoardTask> = { ...task };
      delete legacy.due_date;
      render(TaskCard, { task: legacy as BoardTask, projectId: PROJECT_ID });

      expect(screen.queryByTitle(/^Due /)).not.toBeInTheDocument();
      expect(screen.getByText('Design cards')).toBeInTheDocument();
    });

    it('adds no badge row to an otherwise bare undated card', () => {
      render(TaskCard, {
        task: {
          ...task,
          label_ids: [],
          assignee_ids: [],
          blocker_ids: [],
          open_cross_project_blocker_count: 0,
          attachment_count: 0,
        },
        projectId: PROJECT_ID,
      });

      expect(document.querySelector('.z-10')).toBeNull();
    });

    it('colours a past date as overdue', () => {
      render(TaskCard, { task: dueIn(-2), projectId: PROJECT_ID });

      expect(pill().className).toContain('text-danger');
    });

    it('colours today and tomorrow as due soon, with relative wording', () => {
      const { unmount } = render(TaskCard, { task: dueIn(0), projectId: PROJECT_ID });
      expect(pill()).toHaveTextContent('Today');
      expect(pill().className).toContain('text-warning');
      unmount();

      render(TaskCard, { task: dueIn(1), projectId: PROJECT_ID });
      expect(pill()).toHaveTextContent('Tomorrow');
      expect(pill().className).toContain('text-warning');
    });

    it('leaves a distant date neutral', () => {
      render(TaskCard, { task: dueIn(30), projectId: PROJECT_ID });

      expect(pill().className).toContain('text-muted');
      expect(pill().className).not.toContain('text-warning');
      expect(pill().className).not.toContain('text-danger');
    });

    it('marks the task done on click, without navigating', () => {
      board.columns = [
        { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
        { id: 'c2', name: 'Done', sort_key: 'V0000020001', is_done: true },
      ];
      const markTaskDone = vi.spyOn(board, 'markTaskDone').mockReturnValue(true);
      const navigate = vi.spyOn(router, 'navigate');
      render(TaskCard, { task: dueIn(-2), projectId: PROJECT_ID });

      void fireEvent.click(screen.getByRole('button'));

      expect(markTaskDone).toHaveBeenCalledWith(TASK_ID);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('is inert once the task is done, and reads as complete', () => {
      board.columns = [{ id: 'c2', name: 'Done', sort_key: 'V0000020001', is_done: true }];
      render(TaskCard, { task: dueIn(-2), projectId: PROJECT_ID, done: true });

      expect(pill().className).toContain('text-success');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('is inert with no done column to move the task into', () => {
      board.columns = [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }];
      render(TaskCard, { task: dueIn(-2), projectId: PROJECT_ID });

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('is inert on a read-only board', () => {
      board.columns = [{ id: 'c2', name: 'Done', sort_key: 'V0000020001', is_done: true }];
      render(TaskCard, { task: dueIn(-2), projectId: PROJECT_ID, readonly: true });

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(pill().className).toContain('text-danger');
    });
  });

  // A lifted card is replaced in the list by a placeholder holding its content under
  // an id that names no task. Encoding that id for the overlay link throws, and the
  // throw kills the render mid-drag: cards stop making room, the dragged one is
  // never repainted, and the drop never reaches the store.
  describe('drag placeholder', () => {
    const placeholder: BoardTask = {
      ...task,
      id: SHADOW_PLACEHOLDER_ITEM_ID,
      checklist_item_count: 5,
      checklist_done_count: 2,
    };

    it('draws the placeholder at full size instead of throwing on its id', () => {
      expect(() => render(TaskCard, { task: placeholder, projectId: PROJECT_ID })).not.toThrow();

      expect(screen.getByText('Design cards')).toBeInTheDocument();
      expect(screen.getByTitle('3 attachments')).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    // The placeholder is a full clone of the lifted card, so it keeps that card's
    // counts and the gap reads as the card in flight — as it already does for the
    // image and comment badges. The badge derives no URL and indexes no lookup, so
    // the sentinel id never reaches anything that could throw on it.
    it('keeps the lifted card’s checklist progress in the gap it leaves', () => {
      render(TaskCard, { task: placeholder, projectId: PROJECT_ID });

      expect(screen.getByTitle('2 of 5 checklist items done')).toHaveTextContent('2/5');
    });

    it('draws it on a read-only board too, where the link is built differently', () => {
      board.readonly = true;

      expect(() => render(TaskCard, { task: placeholder, projectId: PROJECT_ID })).not.toThrow();

      expect(screen.getByText('Design cards')).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });
});

describe('TaskCard changed since you last looked', () => {
  it('names the change and swaps the surface, touching no other style channel', () => {
    const plainRender = render(TaskCard, { props: { task, projectId: PROJECT_ID } });
    const plain = card().className;
    expect(plain).toContain('bg-canvas');
    expect(screen.queryByText('Changed since you last looked')).toBeNull();
    plainRender.unmount();

    render(TaskCard, { props: { task, projectId: PROJECT_ID, changed: true } });

    expect(screen.getByText('Changed since you last looked')).toBeInTheDocument();
    // Hover owns the border and selection owns the ring, so the highlight has to
    // differ from a plain card by the background token and nothing else.
    expect(card().className.replace('bg-accent-soft', 'bg-canvas')).toBe(plain);
  });
});

describe('TaskCard selection', () => {
  const ME = 'u-me';
  const SECOND_ID = testUuid('t2');
  const second: BoardTask = {
    ...task,
    id: SECOND_ID,
    title: 'Second card',
    sort_key: 'V0000020001',
  };

  function makeEditable(createdBy: string | null = ME): void {
    session.user = {
      id: ME,
      name: 'Ada',
      email: 'ada@example.com',
      avatar_url: null,
      email_verified: false,
    };
    board.project = {
      id: PROJECT_ID,
      name: 'Game',
      description: '',
      archived_at: null,
      created_by: createdBy,
      member_ids: [],
      members: [],
      is_public: false,
      color: null,
      created_at: '2026-01-01T00:00:00Z',
    };
    board.columns = [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }];
    board.tasks = [task, second];
  }

  function tokens(element: HTMLElement): Set<string> {
    return new Set(element.className.split(/\s+/).filter(Boolean));
  }

  beforeEach(() => {
    selection.clear();
    makeEditable();
  });

  afterEach(() => {
    selection.clear();
    session.user = null;
  });

  it('marks a picked card with an inset outline, a check and nothing else', () => {
    const plainRender = render(TaskCard, { props: { task, projectId: PROJECT_ID } });
    const plain = tokens(card());
    expect(screen.queryByText('Selected')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    plainRender.unmount();

    selection.toggle(TASK_ID);
    // The cursor moves elsewhere, so the delta below is the set's channel alone.
    selection.set(SECOND_ID);
    render(TaskCard, { props: { task, projectId: PROJECT_ID } });

    const picked = tokens(card());
    expect([...picked].filter((c) => !plain.has(c))).toEqual([
      'outline-2',
      '-outline-offset-2',
      'outline-accent-strong',
    ]);
    expect([...plain].filter((c) => !picked.has(c))).toEqual([]);
    expect(screen.getByText('Selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });

  it('shows the cursor ring and the picked outline at once, leaving dimming alone', () => {
    selection.toggle(TASK_ID);
    render(TaskCard, { props: { task, projectId: PROJECT_ID, dimmed: true, changed: true } });

    const classes = tokens(card());
    expect(classes).toContain('ring-2');
    expect(classes).toContain('border-accent');
    expect(classes).toContain('outline-accent-strong');
    expect(classes).toContain('opacity-30');
    expect(classes).toContain('bg-accent-soft');
  });

  it('draws an unchecked box on the cards a selection does not hold', () => {
    selection.toggle(TASK_ID);
    render(TaskCard, { props: { task: second, projectId: PROJECT_ID } });

    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('Selected')).toBeNull();
  });

  it('toggles from the checkbox without navigating', async () => {
    selection.toggle(SECOND_ID);
    const navigate = vi.spyOn(router, 'navigate');
    render(TaskCard, { props: { task, projectId: PROJECT_ID } });

    await fireEvent.click(screen.getByRole('checkbox'));

    expect(selection.selectedIds).toEqual([TASK_ID, SECOND_ID]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('toggles once when the checkbox itself is cmd-clicked', async () => {
    selection.toggle(SECOND_ID);
    render(TaskCard, { props: { task, projectId: PROJECT_ID } });

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    screen.getByRole('checkbox').dispatchEvent(event);

    expect(selection.selectedIds).toEqual([TASK_ID, SECOND_ID]);
  });

  it('toggles on cmd-click and claims the gesture back from the browser', async () => {
    render(TaskCard, { props: { task, projectId: PROJECT_ID } });

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    card().dispatchEvent(event);

    expect(selection.selectedIds).toEqual([TASK_ID]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('extends on shift-click', async () => {
    selection.toggle(TASK_ID);
    render(TaskCard, { props: { task: second, projectId: PROJECT_ID } });

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true });
    card().dispatchEvent(event);

    expect(selection.selectedIds).toEqual([TASK_ID, SECOND_ID]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a plain click to the overlay link', () => {
    render(TaskCard, { props: { task, projectId: PROJECT_ID } });

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    card().dispatchEvent(event);

    expect(selection.selectedIds).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not toggle on the click that trails the card menu', () => {
    cardMenu.open(TASK_ID, 0, 0);
    render(TaskCard, { props: { task, projectId: PROJECT_ID } });

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    card().dispatchEvent(event);

    expect(selection.selectedIds).toEqual([]);
  });

  it('moves the cursor on hover and never the set', async () => {
    selection.toggle(SECOND_ID);
    render(TaskCard, { props: { task, projectId: PROJECT_ID } });

    await fireEvent.pointerEnter(card());

    expect(selection.cursorTaskId).toBe(TASK_ID);
    expect(selection.selectedIds).toEqual([SECOND_ID]);
  });

  // A set built before a demotion outlives it, so the guards have to hold with a
  // non-empty selection on a board the user can no longer write to.
  it('draws no checkbox and refuses to toggle for a viewer', () => {
    selection.toggle(TASK_ID);
    makeEditable('u-owner');
    render(TaskCard, { props: { task: second, projectId: PROJECT_ID } });

    expect(screen.queryByRole('checkbox')).toBeNull();

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    card().dispatchEvent(event);

    expect(selection.selectedIds).toEqual([TASK_ID]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('draws no checkbox on a readonly card', () => {
    selection.toggle(TASK_ID);
    render(TaskCard, { props: { task, projectId: PROJECT_ID, readonly: true } });

    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
