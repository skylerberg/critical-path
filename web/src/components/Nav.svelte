<script lang="ts">
  import { APP_NAME } from '../lib/constants';
  import { groupProjectsByWorkspace } from '../lib/projectGroups';
  import { projects } from '../lib/projects.svelte';
  import { realtime } from '../lib/realtime.svelte';
  import { link, router } from '../lib/router.svelte';
  import { session } from '../lib/session.svelte';
  import { workspaces } from '../lib/workspaces.svelte';
  import Avatar from './ui/Avatar.svelte';

  const projectsActive = $derived(router.current.name === 'projects');
  const currentProjectId = $derived(
    router.current.name === 'project' ? router.current.params.id : null
  );

  const groups = $derived(groupProjectsByWorkspace(projects.active, workspaces.workspaces));
  const offline = $derived(session.status === 'authed' && realtime.status !== 'online');

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

  <div class="mt-2 flex-1 overflow-y-auto px-2 pb-2">
    {#if groups.personal.length > 0}
      <p class="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
        Personal
      </p>
      {#each groups.personal as project (project.id)}
        {@render projectLink(project.id, project.name)}
      {/each}
    {/if}
    {#each groups.workspaces as group (group.workspace.id)}
      {#if group.projects.length > 0}
        <p class="truncate px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
          {group.workspace.name}
        </p>
        {#each group.projects as project (project.id)}
          {@render projectLink(project.id, project.name)}
        {/each}
      {/if}
    {/each}
  </div>

  <div class="flex flex-col gap-1 border-t border-edge p-2">
    {#if session.user}
      <a
        href="/account"
        aria-current={router.current.name === 'account' ? 'page' : undefined}
        class="flex min-h-11 items-center gap-2 rounded-md px-3 hover:bg-accent-soft"
      >
        <Avatar name={session.user.name} size="sm" />
        <span class="min-w-0 truncate text-sm font-medium">{session.user.name}</span>
      </a>
    {/if}
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
      <Avatar name={session.user.name} size="sm" />
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
