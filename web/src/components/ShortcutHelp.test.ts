import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import ShortcutHelp from './ShortcutHelp.svelte';
import { board } from '../lib/board.svelte';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import { projectHref, publicBoardHref } from '../lib/short-links';
import { shortcuts } from '../lib/shortcuts.svelte';
import { testUuid } from '../lib/test-ids';

const me = {
  id: 'u-me',
  email: 'me@example.com',
  name: 'Me',
  avatar_url: null,
  email_verified: false,
};
const PROJECT_ID = testUuid('p1');
const BOARD_PATH = projectHref(PROJECT_ID, 'Game');
const GRAPH_PATH = projectHref(PROJECT_ID, 'Game', 'graph');

const EDITING_ROWS = [
  'New task in selected column',
  'Label the selection',
  'Assign the selection',
  'Move selected task to done',
  'Duplicate the selected task',
  'Move the selection to a column',
  'Extend the selection',
  'Add or remove the card from the selection',
];

beforeEach(() => {
  router.navigate('/', { replace: true });
  // Without this the keymap would be trimmed because nobody is signed in, which
  // says nothing about whether it is trimmed for a viewer.
  session.user = me;
});

afterEach(() => {
  board.reset();
  session.user = null;
  shortcuts.reset();
});

function viewerProject() {
  return {
    id: PROJECT_ID,
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: 'u-owner',
    member_ids: [me.id],
    members: [{ user_id: me.id, role: 'viewer' as const }],
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

function editorProject() {
  return { ...viewerProject(), created_by: me.id, members: [] };
}

function chips(label: string): string[] {
  const row = screen.getByText(label).closest('li')!;
  return [...row.querySelectorAll('kbd')].map((key) => (key.textContent ?? '').trim());
}

function press(keys: string[]): void {
  for (const key of keys) {
    shortcuts.handleKeydown(new KeyboardEvent('keydown', { key, cancelable: true }));
  }
}

describe('ShortcutHelp', () => {
  it('documents m as the move command', () => {
    render(ShortcutHelp, { onclose: vi.fn() });

    const row = screen.getByText('Move the selection to a column').closest('li')!;

    expect(within(row).getByText('m')).toBeVisible();
  });

  it('documents the palette chord, and keeps it for a viewer, whose half of it works', () => {
    render(ShortcutHelp, { onclose: vi.fn() });
    const row = screen.getByText('Open the command palette').closest('li')!;
    expect(within(row).getByText('Ctrl K')).toBeVisible();

    cleanup();
    board.project = viewerProject();
    router.navigate(BOARD_PATH, { replace: true });

    render(ShortcutHelp, { onclose: vi.fn() });

    expect(screen.getByText('Open the command palette')).toBeInTheDocument();
  });

  it('keeps the full keymap away from a board, even after leaving a read-only one', () => {
    board.project = viewerProject();

    render(ShortcutHelp, { onclose: vi.fn() });

    expect(screen.getByText('New task in selected column')).toBeInTheDocument();
    expect(screen.getByText(/^Reorder/)).toBeInTheDocument();
  });

  it('keeps sidebar reordering for a viewer, who can still order their own list', () => {
    board.project = viewerProject();
    router.navigate(BOARD_PATH, { replace: true });

    render(ShortcutHelp, { onclose: vi.fn() });

    expect(screen.getByText('Reorder (Tab to a sidebar project)')).toBeInTheDocument();
    expect(screen.getByText('Pick up or drop the focused item')).toBeInTheDocument();
    expect(screen.queryByText('Carry a picked-up task to another column')).toBeNull();
  });

  it('drops the editing rows on a read-only board', () => {
    board.project = editorProject();
    router.navigate(BOARD_PATH, { replace: true });
    render(ShortcutHelp, { onclose: vi.fn() });

    // Anchors the misses below: a queryByText miss cannot tell a dropped row from
    // a renamed one, so each label has to be seen on screen under the same name
    // first.
    for (const label of EDITING_ROWS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    cleanup();
    board.project = viewerProject();
    render(ShortcutHelp, { onclose: vi.fn() });

    for (const label of EDITING_ROWS) {
      expect(screen.queryByText(label)).toBeNull();
    }

    expect(screen.getByText('Open selected task')).toBeInTheDocument();
    expect(screen.getByText('Filter tasks')).toBeInTheDocument();
    expect(screen.getByText('Go to board')).toBeInTheDocument();
  });

  // The anonymous visitor on a shared link is exactly who reads this panel — ? is
  // live for them — and public-board is the only route name that trims it there.
  it('drops the editing rows for a visitor on a shared link', () => {
    session.user = null;
    board.project = { ...viewerProject(), member_ids: [], members: [], is_public: true };
    router.navigate(publicBoardHref(PROJECT_ID), { replace: true });

    render(ShortcutHelp, { onclose: vi.fn() });

    for (const label of EDITING_ROWS) {
      expect(screen.queryByText(label)).toBeNull();
    }

    expect(screen.getByText('Go to board')).toBeInTheDocument();
    expect(screen.getByText('Filter tasks')).toBeInTheDocument();
    expect(screen.getByText('Open the command palette')).toBeInTheDocument();
  });

  // The card rows come from CARD_ACTION_KEYS, and card-actions.test.ts presses
  // those through the real keymap. The rest are literals this panel alone
  // declares, so they are pressed here or nowhere.
  it('documents keys that still do what their row says', () => {
    board.project = editorProject();
    board.currentProjectId = PROJECT_ID;
    router.navigate(BOARD_PATH, { replace: true });
    render(ShortcutHelp, { onclose: vi.fn() });

    const filter = chips('Filter tasks');
    const mine = chips('Toggle my tasks in the filter');
    const clear = chips('Clear all filters');
    const help = chips('Show this help');
    const searchAll = chips('Search all projects');
    const chords = {
      board: chips('Go to board'),
      graph: chips('Go to graph'),
      projects: chips('Go to projects'),
      myTasks: chips('Go to my tasks'),
    };
    // The panel is a modal, and a modal owns the keymap while it is up.
    cleanup();
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    press(filter);
    expect(shortcuts.filterFocusRequested).toBe(true);

    press(mine);
    expect(board.filterAssigneeIds).toEqual([me.id]);

    press(clear);
    expect(board.hasActiveFilters).toBe(false);

    press(help);
    expect(shortcuts.helpOpen).toBe(true);
    shortcuts.reset();

    press(searchAll);
    expect(navigate).toHaveBeenLastCalledWith('/search');
    press(chords.board);
    expect(navigate).toHaveBeenLastCalledWith(BOARD_PATH);
    press(chords.graph);
    expect(navigate).toHaveBeenLastCalledWith(GRAPH_PATH);
    press(chords.projects);
    expect(navigate).toHaveBeenLastCalledWith('/');
    press(chords.myTasks);
    expect(navigate).toHaveBeenLastCalledWith('/my-tasks');
  });
});
