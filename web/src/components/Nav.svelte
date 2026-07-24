<script lang="ts">
  import { flip } from 'svelte/animate';
  import { dndzone, SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import { APP_NAME } from '../lib/constants';
  import { projects, type Project } from '../lib/projects.svelte';
  import { realtime } from '../lib/realtime.svelte';
  import { link, router } from '../lib/router.svelte';
  import { session } from '../lib/session.svelte';
  import FeedbackDialog from './FeedbackDialog.svelte';
  import Avatar from './ui/Avatar.svelte';

  const FLIP_MS = 150;
  const dropTargetStyle = { outline: '2px solid var(--cp-accent)', outlineOffset: '-2px' };

  const projectsActive = $derived(router.current.name === 'projects');
  const currentProjectId = $derived(
    router.current.name === 'project' ? router.current.params.id : null
  );

  const offline = $derived(session.status === 'authed' && realtime.status !== 'online');

  let feedbackOpen = $state(false);
  let localProjects = $state<Project[]>([]);
  let projectDragging = $state(false);

  $effect(() => {
    if (!projectDragging) {
      localProjects = [...projects.active];
    }
  });

  function handleProjectConsider(event: CustomEvent<DndEvent<Project>>): void {
    projectDragging = true;
    localProjects = event.detail.items;
  }

  function handleProjectFinalize(event: CustomEvent<DndEvent<Project>>): void {
    const items = event.detail.items.filter((p) => p.id !== SHADOW_PLACEHOLDER_ITEM_ID);
    localProjects = items;
    projectDragging = false;
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

{#if offline}
  <div
    role="status"
    class="fixed top-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1 text-xs font-medium text-muted shadow-sm"
  >
    <span class="size-2 animate-pulse rounded-full bg-amber-500" aria-hidden="true"></span>
    Offline — reconnecting
  </div>
{/if}

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

{#snippet projectLink(id: string, name: string)}
  <a
    href="/projects/{id}"
    draggable="false"
    aria-current={currentProjectId === id ? 'page' : undefined}
    class="flex min-h-11 items-center truncate rounded-md px-3 text-sm {currentProjectId === id
      ? 'bg-accent-soft font-medium text-accent'
      : 'text-muted hover:bg-accent-soft hover:text-ink'}"
  >
    {name}
  </a>
{/snippet}

<nav
  aria-label="Primary"
  use:link
  class="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-edge bg-surface lg:flex"
>
  <a href="/" class="px-4 py-5 text-lg font-semibold">{APP_NAME}</a>
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

  <div
    class="mt-2 flex-1 overflow-y-auto px-2 pb-2"
    use:dndzone={{
      items: localProjects,
      type: 'sidebar-project',
      flipDurationMs: FLIP_MS,
      dropTargetStyle,
      delayTouchStart: true,
      zoneItemTabIndex: -1,
    }}
    onconsider={handleProjectConsider}
    onfinalize={handleProjectFinalize}
  >
    {#each localProjects as project (project.id)}
      <div animate:flip={{ duration: FLIP_MS }}>
        {@render projectLink(project.id, project.name)}
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
        <Avatar name={session.user.name} src={session.user.avatar_url} size="sm" />
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

<nav
  aria-label="Primary"
  use:link
  class="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-edge bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
>
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
  {#if session.user}
    <a
      href="/account"
      aria-current={router.current.name === 'account' ? 'page' : undefined}
      class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs {router
        .current.name === 'account'
        ? 'text-accent'
        : 'text-muted'}"
    >
      <Avatar name={session.user.name} src={session.user.avatar_url} size="sm" />
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

<FeedbackDialog open={feedbackOpen} onclose={() => (feedbackOpen = false)} />
