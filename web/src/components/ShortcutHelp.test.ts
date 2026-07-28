import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import ShortcutHelp from './ShortcutHelp.svelte';
import { board } from '../lib/board.svelte';
import { router } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';

const me = { id: 'u-me', email: 'me@example.com', name: 'Me', avatar_url: null };

beforeEach(() => {
  router.navigate('/', { replace: true });
  // Without this the keymap would be trimmed because nobody is signed in, which
  // says nothing about whether it is trimmed for a viewer.
  session.user = me;
});

afterEach(() => {
  board.reset();
  session.user = null;
});

function viewerProject() {
  return {
    id: 'p1',
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: 'u-owner',
    member_ids: [me.id],
    members: [{ user_id: me.id, role: 'viewer' as const }],
    is_public: false,
    created_at: '2026-01-01T00:00:00Z',
  };
}

describe('ShortcutHelp', () => {
  it('documents m as the move command', () => {
    render(ShortcutHelp, { onclose: vi.fn() });

    const row = screen.getByText('Move the selected task to a column and position').closest('li')!;

    expect(within(row).getByText('m')).toBeVisible();
  });

  it('keeps the full keymap away from a board, even after leaving a read-only one', () => {
    board.project = viewerProject();

    render(ShortcutHelp, { onclose: vi.fn() });

    expect(screen.getByText('New task in selected column')).toBeInTheDocument();
    expect(screen.getByText(/^Reorder/)).toBeInTheDocument();
  });

  it('keeps sidebar reordering for a viewer, who can still order their own list', () => {
    board.project = viewerProject();
    router.navigate('/projects/p1', { replace: true });

    render(ShortcutHelp, { onclose: vi.fn() });

    expect(screen.getByText('Reorder (Tab to a sidebar project)')).toBeInTheDocument();
    expect(screen.getByText('Pick up or drop the focused item')).toBeInTheDocument();
    expect(screen.queryByText('Carry a picked-up task to another column')).toBeNull();
  });

  it('drops the editing rows on a read-only board', () => {
    board.project = viewerProject();
    router.navigate('/projects/p1', { replace: true });

    render(ShortcutHelp, { onclose: vi.fn() });

    for (const label of [
      'New task in selected column',
      'Label the selected task',
      'Assign the selected task',
      'Move selected task to done',
      'Duplicate the selected task',
      'Move the selected task to a column and position',
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }

    expect(screen.getByText('Open selected task')).toBeInTheDocument();
    expect(screen.getByText('Filter tasks')).toBeInTheDocument();
    expect(screen.getByText('Go to board')).toBeInTheDocument();
  });
});
