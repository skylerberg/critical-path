<script lang="ts">
  import { flip } from 'svelte/animate';
  import {
    dndzone,
    SHADOW_PLACEHOLDER_ITEM_ID,
    SOURCES,
    TRIGGERS,
    type DndEvent,
  } from 'svelte-dnd-action';
  import { accentVar } from '../lib/accents';
  import { suppressTouchContextMenu } from '../lib/actions';
  import { APP_NAME } from '../lib/constants';
  import { DROP_TARGET_STYLE, flipDuration } from '../lib/dnd';
  import { motion } from '../lib/motion.svelte';
  import { paletteChordHint } from '../lib/palette';
  import { projects, type Project } from '../lib/projects.svelte';
  import { link, router } from '../lib/router.svelte';
  import { isDragPlaceholder, projectHref } from '../lib/short-links';
  import { currentProjectId } from '../lib/task-route.svelte';
  import { session } from '../lib/session.svelte';
  import { viewport } from '../lib/viewport.svelte';
  import FeedbackDialog from './FeedbackDialog.svelte';
  import SyncStatus from './SyncStatus.svelte';
  import Avatar from './ui/Avatar.svelte';
  import ColorDot from './ui/ColorDot.svelte';

  const projectsActive = $derived(router.current.name === 'projects');
  const myTasksActive = $derived(router.current.name === 'my-tasks');
  const searchActive = $derived(router.current.name === 'search');
  const activeProjectId = $derived(currentProjectId());

  let feedbackOpen = $state(false);
  let localProjects = $state<Project[]>([]);
  let projectDragging = $state(false);

  $effect(() => {
    if (!projectDragging) {
      localProjects = [...projects.active];
    }
  });

  // Keyboard drags end with a consider event (trigger DRAG_STOPPED), not a
  // finalize, so the dragging flag must reset here too.
  function handleProjectConsider(event: CustomEvent<DndEvent<Project>>): void {
    projectDragging = event.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
    localProjects = event.detail.items;
  }

  function handleProjectFinalize(event: CustomEvent<DndEvent<Project>>): void {
    const items = event.detail.items.filter((p) => p.id !== SHADOW_PLACEHOLDER_ITEM_ID);
    localProjects = items;
    projectDragging = event.detail.info.source === SOURCES.KEYBOARD;
    if (event.detail.info.trigger === TRIGGERS.DROPPED_INTO_ZONE) {
      void projects.reorder(
        event.detail.info.id,
        items.map((p) => p.id)
      );
    }
  }

  function logout(): void {
    void session.logout();
  }
</script>

<SyncStatus />

{#snippet projectsIcon()}
  <svg
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
{/snippet}

{#snippet myTasksIcon()}
  <svg
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 6 5 8 9 4" />
    <polyline points="3 15 5 17 9 13" />
    <line x1="13" y1="6" x2="21" y2="6" />
    <line x1="13" y1="15" x2="21" y2="15" />
  </svg>
{/snippet}

{#snippet searchIcon()}
  <svg
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
{/snippet}

{#snippet feedbackIcon()}
  <svg
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
{/snippet}

{#snippet logoutIcon()}
  <svg
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
{/snippet}

{#snippet projectLink(project: Project)}
  {@const active = activeProjectId === project.id}
  <!-- Still drawn, only unlinked, so the gap it leaves keeps the row's size. -->
  {@const href = isDragPlaceholder(project.id) ? undefined : projectHref(project.id, project.name)}
  {@const dot = accentVar(project.color)}
  <!-- The drag placeholder is a clone of the held row with only its id replaced,
       so it carries a real flag on a row that names no project. -->
  {@const unseen = project.has_unseen_changes && !active && !isDragPlaceholder(project.id)}
  <a
    use:suppressTouchContextMenu
    {href}
    draggable="false"
    aria-current={active ? 'page' : undefined}
    class="flex min-h-11 touch-callout-none items-center gap-2 overflow-hidden rounded-md px-3 text-sm {active
      ? 'bg-accent-soft font-medium text-accent'
      : 'text-muted hover:bg-accent-soft hover:text-ink'}"
  >
    {#if dot !== null}
      <ColorDot color={dot} size="sm" />
    {/if}
    <span class="min-w-0 flex-1 truncate">{project.name}</span>
    {#if unseen}
      <span class="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
      <span class="sr-only">Unseen changes</span>
    {/if}
  </a>
{/snippet}

<nav
  aria-label="Primary"
  use:link
  class="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-edge bg-surface lg:flex"
>
  <a href="/" class="px-4 py-5 text-lg font-semibold">{APP_NAME}</a>
  <a
    href="/my-tasks"
    aria-current={myTasksActive ? 'page' : undefined}
    class="mx-2 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium {myTasksActive
      ? 'bg-accent-soft text-accent'
      : 'text-muted hover:bg-accent-soft hover:text-ink'}"
  >
    {@render myTasksIcon()}
    My tasks
  </a>
  <a
    href="/"
    aria-current={projectsActive ? 'page' : undefined}
    class="mx-2 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium {projectsActive
      ? 'bg-accent-soft text-accent'
      : 'text-muted hover:bg-accent-soft hover:text-ink'}"
  >
    {@render projectsIcon()}
    Projects
  </a>
  <a
    href="/search"
    aria-current={searchActive ? 'page' : undefined}
    class="mx-2 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium {searchActive
      ? 'bg-accent-soft text-accent'
      : 'text-muted hover:bg-accent-soft hover:text-ink'}"
  >
    {@render searchIcon()}
    Search
    <!-- Hidden from the link's name: the chord opens the palette, not this page, so
         it is a hint rather than something aria-keyshortcuts could truthfully claim. -->
    <kbd
      aria-hidden="true"
      class="ml-auto inline-flex min-h-6 items-center justify-center rounded border border-edge bg-canvas px-1.5 text-xs font-medium text-muted"
    >
      {paletteChordHint()}
    </kbd>
  </a>

  <div
    class="mt-2 flex-1 overflow-y-auto px-2 pb-2"
    aria-label="Projects"
    use:dndzone={{
      items: localProjects,
      type: 'sidebar-project',
      flipDurationMs: flipDuration(),
      dropAnimationDisabled: motion.reduced,
      dropTargetStyle: DROP_TARGET_STYLE,
      delayTouchStart: true,
      zoneItemTabIndex: 0,
    }}
    onconsider={handleProjectConsider}
    onfinalize={handleProjectFinalize}
  >
    {#each localProjects as project (project.id)}
      <div
        animate:flip={{ duration: flipDuration() }}
        aria-label={project.name}
        class="rounded-md focus-ring-flush"
      >
        {@render projectLink(project)}
      </div>
    {/each}
  </div>

  <div class="flex flex-col gap-1 border-t border-edge p-2">
    {#if session.user}
      <a
        href="/account"
        aria-current={router.current.name === 'account' ? 'page' : undefined}
        class="flex min-h-11 items-center gap-2 rounded-md px-3 hover:bg-accent-soft"
      >
        <Avatar name={session.user.name} src={session.user.avatar_url} size="sm" labelled />
        <span class="min-w-0 truncate text-sm font-medium">{session.user.name}</span>
      </a>
    {/if}
    <button
      type="button"
      onclick={() => (feedbackOpen = true)}
      class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium text-muted hover:bg-accent-soft hover:text-ink"
    >
      {@render feedbackIcon()}
      Send feedback
    </button>
    <button
      type="button"
      onclick={logout}
      class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium text-muted hover:bg-accent-soft hover:text-ink"
    >
      {@render logoutIcon()}
      Log out
    </button>
  </div>
</nav>

<!-- Positioned against the layout viewport, which a software keyboard does not
     shrink — so with one up this bar is behind it rather than above it, and
     drawing it only reserves space nothing can reach. src/lib/viewport.svelte.ts
     owns the rest of that arrangement. -->
{#if !viewport.keyboardOpen}
  <nav
    aria-label="Primary"
    use:link
    class="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-edge bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
  >
    <a
      href="/my-tasks"
      aria-current={myTasksActive ? 'page' : undefined}
      class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium {myTasksActive
        ? 'text-accent'
        : 'text-muted'}"
    >
      {@render myTasksIcon()}
      My tasks
    </a>
    <a
      href="/"
      aria-current={projectsActive ? 'page' : undefined}
      class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium {projectsActive
        ? 'text-accent'
        : 'text-muted'}"
    >
      {@render projectsIcon()}
      Projects
    </a>
    <a
      href="/search"
      aria-current={searchActive ? 'page' : undefined}
      class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium {searchActive
        ? 'text-accent'
        : 'text-muted'}"
    >
      {@render searchIcon()}
      Search
    </a>
    {#if session.user}
      <a
        href="/account"
        aria-current={router.current.name === 'account' ? 'page' : undefined}
        class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs {router
          .current.name === 'account'
          ? 'text-accent'
          : 'text-muted'}"
      >
        <Avatar name={session.user.name} src={session.user.avatar_url} size="sm" labelled />
        <span class="max-w-24 truncate">{session.user.name}</span>
      </a>
    {/if}
    <button
      type="button"
      onclick={logout}
      class="flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted"
    >
      {@render logoutIcon()}
      Log out
    </button>
  </nav>
{/if}

<FeedbackDialog open={feedbackOpen} onclose={() => (feedbackOpen = false)} />
