import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import {
  SHADOW_PLACEHOLDER_ITEM_ID,
  SOURCES,
  TRIGGERS,
  type DndEvent,
  type Options,
} from 'svelte-dnd-action';
import Nav from './Nav.svelte';
import { motion } from '../lib/motion.svelte';
import { projects, type Project } from '../lib/projects.svelte';
import { realtime } from '../lib/realtime.svelte';
import { session } from '../lib/session.svelte';
import { router } from '../lib/router.svelte';
import { projectHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';

const { zoneOptions } = vi.hoisted(() => ({ zoneOptions: [] as Options[] }));

// Wraps rather than replaces: the keyboard-drag cases below drive the real action.
vi.mock('svelte-dnd-action', async (importOriginal) => {
  const actual = await importOriginal<typeof import('svelte-dnd-action')>();
  return {
    ...actual,
    dndzone: (node: HTMLElement, options: Options) => {
      zoneOptions.push(options);
      const zone = actual.dndzone(node, options);
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

function sidebarZoneConfigs(): Options[] {
  return zoneOptions.filter((options) => options.type === 'sidebar-project');
}

const me = {
  id: 'u-me',
  email: 'me@example.com',
  name: 'Me',
  avatar_url: null,
  email_verified: false,
};

const SOLO_ID = testUuid('p-solo');
const TEAM_ID = testUuid('p-team');
const A_ID = testUuid('p-a');
const B_ID = testUuid('p-b');
const C_ID = testUuid('p-c');

function project(overrides: Partial<Project> = {}): Project {
  const memberIds = overrides.member_ids ?? [];
  return {
    id: testUuid('p-1'),
    name: 'Alpha',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: memberIds,
    members: memberIds.map((user_id) => ({ user_id, role: 'editor' as const })),
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    position: null,
    last_seen_at: null,
    has_unseen_changes: false,
    ...overrides,
  };
}

function sidebarProjectNames(): string[] {
  return [...document.querySelectorAll('a[href^="/p/"]')].map(
    (anchor) => anchor.textContent?.trim() ?? ''
  );
}

// Every drawn row, linked or not, unlike the href-keyed list above.
function sidebarRowNames(): string[] {
  const zone = document.querySelector('[aria-label="Projects"]');
  return [...(zone?.children ?? [])].map((row) => row.getAttribute('aria-label') ?? '');
}

function alertText(): string {
  return document.getElementById('dnd-action-aria-alert')?.textContent ?? '';
}

beforeEach(() => {
  fetchMock.mockReset();
  zoneOptions.length = 0;
  motion.reduced = false;
  projects.reset();
  session.user = me;
  session.status = 'authed';
  realtime.disconnect();
  router.beforeNavigate = undefined;
  router.navigate('/', { replace: true });
});

describe('Nav sidebar', () => {
  it('lists active projects in one flat list with an active state', () => {
    projects.projects = [
      project({ id: SOLO_ID, name: 'Solo Game' }),
      project({
        id: TEAM_ID,
        name: 'Team Game',
        member_ids: [me.id],
        created_at: '2026-01-02T00:00:00.000Z',
      }),
      project({
        id: testUuid('p-arch'),
        name: 'Archived',
        archived_at: '2026-02-01T00:00:00.000Z',
      }),
    ];
    router.navigate(projectHref(TEAM_ID, 'Team Game'));

    render(Nav);

    expect(screen.queryByText('Personal')).toBeNull();

    const solo = screen.getByRole('link', { name: 'Solo Game' });
    expect(solo).toHaveAttribute('href', projectHref(SOLO_ID, 'Solo Game'));
    const team = screen.getByRole('link', { name: 'Team Game' });
    expect(team).toHaveAttribute('href', projectHref(TEAM_ID, 'Team Game'));
    expect(team).toHaveAttribute('aria-current', 'page');

    expect(screen.queryByRole('link', { name: 'Archived' })).toBeNull();
  });

  it('dots a coloured board and leaves an uncoloured one bare', () => {
    projects.projects = [
      project({ id: SOLO_ID, name: 'Solo Game', color: 'rose' }),
      project({ id: TEAM_ID, name: 'Team Game', created_at: '2026-01-02T00:00:00.000Z' }),
    ];

    render(Nav);

    const solo = screen.getByRole('link', { name: 'Solo Game' });
    const dot = solo.querySelector('span[aria-hidden="true"]');
    expect(dot).toHaveStyle({ backgroundColor: 'var(--cp-project-rose)' });
    expect(dot).toHaveClass('shrink-0');
    expect(
      screen.getByRole('link', { name: 'Team Game' }).querySelector('span[aria-hidden="true"]')
    ).toBeNull();
  });

  // Worst case for the placeholder: an item carrying nothing but an id, which is
  // what an indexed palette lookup dies on — and the death lands mid-drag.
  it('survives a drag placeholder that carries no colour at all', async () => {
    projects.projects = [
      project({ id: A_ID, name: 'A', position: 1000, color: 'sky' }),
      project({ id: B_ID, name: 'B', position: 2000 }),
    ];

    render(Nav);
    const linkA = await screen.findByRole('link', { name: 'A' });
    const zone = linkA.parentElement!.parentElement!;
    const detail = {
      items: [{ id: SHADOW_PLACEHOLDER_ITEM_ID } as Project, projects.active[1]!],
      info: { trigger: TRIGGERS.DRAG_STARTED, id: A_ID, source: SOURCES.POINTER },
    };
    await fireEvent(zone, new CustomEvent('consider', { detail }));

    expect(sidebarRowNames()).toEqual(['', 'B']);
    expect(sidebarProjectNames()).toEqual(['B']);
  });

  it('renders sidebar projects in position order with nulls last', async () => {
    projects.projects = [
      project({ id: testUuid('p-legacy'), name: 'Legacy', created_at: '2026-01-01T00:00:00.000Z' }),
      project({ id: testUuid('p-2'), name: 'Second', position: 2000 }),
      project({ id: testUuid('p-1'), name: 'First', position: 1000 }),
    ];

    render(Nav);

    await screen.findByRole('link', { name: 'First' });
    expect(sidebarProjectNames()).toEqual(['First', 'Second', 'Legacy']);
  });

  it('commits a drop by PUTting the computed midpoint position', async () => {
    projects.projects = [
      project({ id: A_ID, name: 'A', position: 1000 }),
      project({ id: B_ID, name: 'B', position: 2000 }),
      project({ id: C_ID, name: 'C', position: 3000 }),
    ];
    fetchMock.mockImplementation(async () => jsonResponse(204));

    render(Nav);
    const linkA = await screen.findByRole('link', { name: 'A' });
    const zone = linkA.parentElement!.parentElement!;
    const [a, b, c] = projects.active;
    const detail: DndEvent<Project> = {
      items: [a!, c!, b!],
      info: { trigger: TRIGGERS.DROPPED_INTO_ZONE, id: C_ID, source: SOURCES.POINTER },
    };
    await fireEvent(zone, new CustomEvent('finalize', { detail }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestAt(0).method).toBe('PUT');
    expect(new URL(requestAt(0).url).pathname).toBe(`/api/projects/${C_ID}/position`);
    expect(await requestAt(0).clone().json()).toEqual({ position: 1500 });
    await vi.waitFor(() => expect(sidebarProjectNames()).toEqual(['A', 'C', 'B']));
  });

  // A lifted row is replaced in the list by a placeholder holding its content under
  // an id that names no project. Encoding that id for the row's link throws, and the
  // throw kills the render mid-drag: rows stop making way, the held one is painted
  // nowhere, and the drop never reaches the store.
  it('swaps the held project for the placeholder in the rendered sidebar', async () => {
    projects.projects = [
      project({ id: A_ID, name: 'A', position: 1000 }),
      project({ id: B_ID, name: 'B', position: 2000 }),
      project({ id: C_ID, name: 'C', position: 3000 }),
    ];

    render(Nav);
    const linkA = await screen.findByRole('link', { name: 'A' });
    const zone = linkA.parentElement!.parentElement!;
    const [a, b, c] = projects.active;
    const detail = {
      items: [{ ...a!, isDndShadowItem: true, id: SHADOW_PLACEHOLDER_ITEM_ID }, b!, c!],
      info: { trigger: TRIGGERS.DRAG_STARTED, id: A_ID, source: SOURCES.POINTER },
    };
    await fireEvent(zone, new CustomEvent('consider', { detail }));

    // The held row keeps its place and its name, and is the one now carrying no
    // link — a render that died would leave all three linked, as before the drag.
    expect(sidebarRowNames()).toEqual(['A', 'B', 'C']);
    expect(sidebarProjectNames()).toEqual(['B', 'C']);
  });

  describe('keyboard reordering', () => {
    beforeEach(() => {
      projects.projects = [
        project({ id: A_ID, name: 'A', position: 1000 }),
        project({ id: B_ID, name: 'B', position: 2000 }),
        project({ id: C_ID, name: 'C', position: 3000 }),
      ];
      fetchMock.mockImplementation(async () => jsonResponse(204));
    });

    it('exposes projects as focusable list items without touching the links', async () => {
      render(Nav);

      const item = await screen.findByRole('listitem', { name: 'A' });
      expect(item).toHaveAttribute('tabindex', '0');
      const zone = document.querySelector('[aria-label="Projects"]');
      expect(zone).toHaveAttribute('role', 'list');
      expect(zone).toHaveAttribute('aria-describedby', 'dnd-zone-active');
      expect(document.getElementById('dnd-zone-active')).not.toBeNull();
      const anchor = screen.getByRole('link', { name: 'A' });
      expect(anchor).toHaveAttribute('href', projectHref(A_ID, 'A'));
      expect(anchor).not.toHaveAttribute('tabindex');
    });

    it('leaves Enter on a project link to the browser', async () => {
      render(Nav);
      const anchor = await screen.findByRole('link', { name: 'A' });
      anchor.focus();

      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      await fireEvent(anchor, enter);

      expect(enter.defaultPrevented).toBe(false);
      expect(alertText()).not.toContain('Started dragging');
      expect(sidebarProjectNames()).toEqual(['A', 'B', 'C']);
    });

    it('picks up with Enter, commits every arrow move, and drops with Enter', async () => {
      render(Nav);
      const item = await screen.findByRole('listitem', { name: 'A' });
      item.focus();

      const pickup = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      await fireEvent(item, pickup);
      expect(pickup.defaultPrevented).toBe(true);
      expect(alertText()).toContain('Started dragging item A');

      await fireEvent.keyDown(item, { key: 'ArrowDown' });
      expect(alertText()).toContain('Moved item A to position 2');
      await vi.waitFor(() => expect(sidebarProjectNames()).toEqual(['B', 'A', 'C']));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(requestAt(0).method).toBe('PUT');
      expect(new URL(requestAt(0).url).pathname).toBe(`/api/projects/${A_ID}/position`);
      expect(await requestAt(0).clone().json()).toEqual({ position: 2500 });

      await fireEvent.keyDown(item, { key: 'ArrowDown' });
      await vi.waitFor(() => expect(sidebarProjectNames()).toEqual(['B', 'C', 'A']));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(await requestAt(1).clone().json()).toEqual({ position: 4000 });

      await fireEvent.keyDown(item, { key: 'Enter' });
      expect(alertText()).toContain('Stopped dragging item A');
      await fireEvent.keyDown(item, { key: 'ArrowDown' });
      expect(sidebarProjectNames()).toEqual(['B', 'C', 'A']);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // A stuck projectDragging flag would freeze the store->DOM mirror here.
      projects.projects = [
        project({ id: testUuid('p-z'), name: 'Z', position: 500 }),
        ...projects.projects,
      ];
      await vi.waitFor(() => expect(sidebarProjectNames()).toEqual(['Z', 'B', 'C', 'A']));
    });

    it('drops in place on Escape', async () => {
      render(Nav);
      const item = await screen.findByRole('listitem', { name: 'A' });
      item.focus();

      await fireEvent.keyDown(item, { key: 'Enter' });
      await fireEvent.keyDown(item, { key: 'ArrowDown' });
      await vi.waitFor(() => expect(sidebarProjectNames()).toEqual(['B', 'A', 'C']));

      await fireEvent.keyDown(window, { key: 'Escape' });
      expect(alertText()).toContain('Stopped dragging item A');
      await fireEvent.keyDown(item, { key: 'ArrowDown' });
      expect(sidebarProjectNames()).toEqual(['B', 'A', 'C']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('links to my tasks and marks it current on that route', async () => {
    render(Nav);

    const before = screen.getAllByRole('link', { name: 'My tasks' });
    expect(before.length).toBeGreaterThan(0);
    for (const anchor of before) {
      expect(anchor).toHaveAttribute('href', '/my-tasks');
      expect(anchor).not.toHaveAttribute('aria-current');
    }

    router.navigate('/my-tasks');

    await waitFor(() => {
      for (const anchor of screen.getAllByRole('link', { name: 'My tasks' })) {
        expect(anchor).toHaveAttribute('aria-current', 'page');
      }
    });
  });

  it('links to search from both bars and marks it current on that route', async () => {
    render(Nav);

    const before = screen.getAllByRole('link', { name: 'Search' });
    expect(before).toHaveLength(2);
    for (const anchor of before) {
      expect(anchor).toHaveAttribute('href', '/search');
      expect(anchor).not.toHaveAttribute('aria-current');
    }

    router.navigate('/search');

    await waitFor(() => {
      for (const anchor of screen.getAllByRole('link', { name: 'Search' })) {
        expect(anchor).toHaveAttribute('aria-current', 'page');
      }
    });
  });

  it('keeps the long-press that starts a project drag from raising the link menu', () => {
    projects.projects = [project({ id: A_ID, name: 'A', position: 1000 })];

    render(Nav);

    const anchor = screen.getByRole('link', { name: 'A' });
    expect(anchor.className).toContain('touch-callout-none');

    const touch = new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
    });
    anchor.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);

    const mouse = new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
    });
    anchor.dispatchEvent(mouse);
    expect(mouse.defaultPrevented).toBe(false);
  });

  it('links the user section to the account page', () => {
    render(Nav);

    const accountLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/account');
    expect(accountLinks.length).toBeGreaterThan(0);
  });

  it('opens the feedback dialog from the sidebar footer', async () => {
    render(Nav);

    await fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(document.querySelector('dialog')?.open).toBe(true);
    expect(screen.getByLabelText('Feedback message')).toBeInTheDocument();
  });
});

describe('Nav reduced motion', () => {
  beforeEach(() => {
    projects.projects = [
      project({ id: A_ID, name: 'A', position: 1000 }),
      project({ id: B_ID, name: 'B', position: 2000 }),
      project({ id: C_ID, name: 'C', position: 3000 }),
    ];
    fetchMock.mockImplementation(async () => jsonResponse(204));
  });

  function expectEveryZone(flipDurationMs: number, dropAnimationDisabled: boolean): void {
    const configs = sidebarZoneConfigs();
    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      expect(config.flipDurationMs).toBe(flipDurationMs);
      expect(config.dropAnimationDisabled).toBe(dropAnimationDisabled);
    }
  }

  it('animates the sidebar zone by default', async () => {
    render(Nav);
    await screen.findByRole('link', { name: 'A' });

    expectEveryZone(150, false);
  });

  it('disables flip and drop animation when motion is reduced', async () => {
    motion.reduced = true;
    render(Nav);
    await screen.findByRole('link', { name: 'A' });

    expectEveryZone(0, true);
  });

  it('still commits keyboard reorders when motion is reduced', async () => {
    motion.reduced = true;
    render(Nav);
    const item = await screen.findByRole('listitem', { name: 'A' });
    item.focus();

    await fireEvent.keyDown(item, { key: 'Enter' });
    await fireEvent.keyDown(item, { key: 'ArrowDown' });

    await vi.waitFor(() => expect(sidebarProjectNames()).toEqual(['B', 'A', 'C']));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestAt(0).method).toBe('PUT');
    expect(new URL(requestAt(0).url).pathname).toBe(`/api/projects/${A_ID}/position`);
    expect(await requestAt(0).clone().json()).toEqual({ position: 2500 });
    expectEveryZone(0, true);
  });
});

describe('offline badge', () => {
  it('stays hidden while realtime is not online but has latched no interruption', () => {
    expect(realtime.status).toBe('offline');
    expect(realtime.interrupted).toBe(false);

    render(Nav);

    expect(screen.queryByText(/reconnecting/i)).toBeNull();
  });

  it('appears once the client reports a sustained interruption', async () => {
    render(Nav);
    realtime.interrupted = true;

    const badge = await vi.waitFor(() => screen.getByText(/reconnecting/i));
    expect(badge).toHaveAttribute('role', 'status');
  });

  it('stays hidden when the session is not authed', () => {
    session.status = 'anon';
    realtime.interrupted = true;

    render(Nav);
    expect(screen.queryByText(/reconnecting/i)).toBeNull();
  });
});

describe('Nav unseen changes dot', () => {
  it('marks a project with unseen changes and leaves the open one alone', () => {
    projects.projects = [
      project({ id: A_ID, name: 'A', position: 1000, has_unseen_changes: true }),
      project({ id: B_ID, name: 'B', position: 2000, has_unseen_changes: true }),
      project({ id: C_ID, name: 'C', position: 3000 }),
    ];
    router.navigate(projectHref(B_ID, 'B'));

    render(Nav);

    expect(screen.getByRole('link', { name: 'A Unseen changes' })).toHaveAttribute(
      'href',
      projectHref(A_ID, 'A')
    );
    expect(screen.getByRole('link', { name: 'B' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'C' })).toBeInTheDocument();
    expect(screen.getAllByText('Unseen changes')).toHaveLength(1);
  });

  // The placeholder is a clone of the held row carrying its real flag under an id
  // that names no project, so an unguarded read dots a row that is not a project.
  it('keeps the dot off the drag placeholder', async () => {
    projects.projects = [
      project({ id: A_ID, name: 'A', position: 1000, has_unseen_changes: true }),
      project({ id: B_ID, name: 'B', position: 2000 }),
    ];

    render(Nav);
    const linkA = await screen.findByRole('link', { name: 'A Unseen changes' });
    const zone = linkA.parentElement!.parentElement!;
    const [a, b] = projects.active;
    await fireEvent(
      zone,
      new CustomEvent('consider', {
        detail: {
          items: [{ ...a!, isDndShadowItem: true, id: SHADOW_PLACEHOLDER_ITEM_ID }, b!],
          info: { trigger: TRIGGERS.DRAG_STARTED, id: A_ID, source: SOURCES.POINTER },
        },
      })
    );

    expect(sidebarRowNames()).toEqual(['A', 'B']);
    expect(screen.queryAllByText('Unseen changes')).toEqual([]);
  });
});
