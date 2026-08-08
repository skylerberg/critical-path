<script lang="ts">
  import { onDestroy } from 'svelte';
  import { accentVar, type ProjectAccent } from '../lib/accents';
  import { apiMessage } from '../lib/apiMessages';
  import { board } from '../lib/board.svelte';
  import { downloadProjectExport } from '../lib/export';
  import { projects } from '../lib/projects.svelte';
  import { link, type ProjectView } from '../lib/router.svelte';
  import { projectHref } from '../lib/short-links';
  import { themeColor } from '../lib/theme-color';
  import { toasts } from '../lib/toasts.svelte';
  import ArchivedTasksModal from './ArchivedTasksModal.svelte';
  import FilterBar from './FilterBar.svelte';
  import LabelManager from './LabelManager.svelte';
  import ProjectColorDialog from './ProjectColorDialog.svelte';
  import ProjectMembersModal from './ProjectMembersModal.svelte';
  import TaskSeriesModal from './TaskSeriesModal.svelte';
  import WebhooksModal from './WebhooksModal.svelte';
  import Badge from './ui/Badge.svelte';
  import Spinner from './ui/Spinner.svelte';

  interface Props {
    projectId: string;
    view: ProjectView;
  }

  let { projectId, view }: Props = $props();

  let labelsOpen = $state(false);
  let colorOpen = $state(false);
  let shareOpen = $state(false);
  let archiveOpen = $state(false);
  let webhooksOpen = $state(false);
  let seriesOpen = $state(false);
  let exporting = $state(false);
  let menuOpen = $state(false);
  let menuEl = $state<HTMLDivElement>();

  async function exportProject(): Promise<void> {
    if (exporting) return;
    exporting = true;
    try {
      if ((await downloadProjectExport(projectId)) === 'json') {
        toasts.success('This project is too large to package with its images — saved as JSON.');
      }
    } catch (error) {
      toasts.error(apiMessage(error));
    } finally {
      exporting = false;
    }
  }

  const boardActive = $derived(view === 'board');
  const graphActive = $derived(view === 'graph');

  const listed = $derived(projects.projects.find((p) => p.id === projectId));

  // Publishing and the project_updated event land in the projects list; the board
  // payload's copy only refreshes on a board fetch, so it is the fallback.
  const isPublic = $derived(listed?.is_public ?? board.project?.is_public ?? false);

  // Not `??` off the list entry: null is a color the user can choose, and
  // coalescing it would fall through to a stale board payload and never clear.
  const accent: ProjectAccent | null = $derived(
    listed !== undefined ? listed.color : (board.project?.color ?? null)
  );
  const accentBar = $derived(accentVar(accent));

  $effect(() => {
    themeColor.set(accent);
  });

  // Not the effect's own teardown, which also runs before every re-run: moving
  // between two colors would repaint the default in between.
  onDestroy(() => themeColor.reset());

  const menuItemClass =
    'flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 text-left text-sm hover:bg-accent-soft';

  // One header per project, so a click elsewhere has to reach this instance to
  // close its menu — hence the containment check that keeps a click on our own
  // menu from closing it. Mirrors the column kebab menu.
  function closeMenuOnOutsideClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Node && menuEl?.contains(target) === true) {
      return;
    }
    menuOpen = false;
  }
</script>

<svelte:window
  onclick={closeMenuOnOutsideClick}
  onkeydown={(event) => {
    if (event.key === 'Escape') menuOpen = false;
  }}
/>

<!-- An inset shadow rather than a border: the bar must not change the header's
     height, which the board viewport is sized against. -->
<header
  class="shrink-0 border-b border-edge bg-surface px-3 py-2 lg:px-4"
  style={accentBar === null ? undefined : `box-shadow: inset 0 3px 0 ${accentBar}`}
>
  <!-- relative: the filter bar's dropdown measures and clamps itself against
       this row, so it can be wider than the search box that opened it. -->
  <div class="relative flex flex-wrap items-center gap-x-3 gap-y-1">
    <h1 class="min-w-0 truncate text-lg font-semibold">
      {board.project?.name ?? ''}
    </h1>
    {#if isPublic}
      <Badge variant="accent">Public</Badge>
    {/if}
    {#if !board.canEdit}
      <Badge>View only</Badge>
    {/if}
    <nav use:link aria-label="Project views" class="flex gap-1">
      <a
        href={projectHref(projectId, board.project?.name ?? '', 'board') + board.filterSearch}
        aria-current={boardActive ? 'page' : undefined}
        class="flex min-h-11 items-center rounded-md px-3 text-sm font-medium {boardActive
          ? 'bg-accent-soft text-accent'
          : 'text-muted hover:bg-accent-soft hover:text-ink'}"
      >
        Board
      </a>
      <a
        href={projectHref(projectId, board.project?.name ?? '', 'graph') + board.filterSearch}
        aria-current={graphActive ? 'page' : undefined}
        class="flex min-h-11 items-center rounded-md px-3 text-sm font-medium {graphActive
          ? 'bg-accent-soft text-accent'
          : 'text-muted hover:bg-accent-soft hover:text-ink'}"
      >
        Graph
      </a>
    </nav>
    <!-- Labels and Webhooks are management-only surfaces, so a viewer loses the
         whole modal rather than a read-only version of it; they are omitted from
         the menu entirely for a viewer. -->
    <div bind:this={menuEl} class="relative shrink-0">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}
        class="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-ink"
      >
        <svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {#if menuOpen}
        <div
          role="menu"
          class="absolute top-full left-0 z-30 w-56 rounded-md border border-edge bg-surface py-1 shadow-lg"
        >
          {#if board.canEdit}
            <button
              type="button"
              role="menuitem"
              class={menuItemClass}
              onclick={() => {
                menuOpen = false;
                labelsOpen = true;
              }}
            >
              <svg
                class="size-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2H2v10l9.3 9.3a1.5 1.5 0 0 0 2.1 0l7.9-7.9a1.5 1.5 0 0 0 0-2.1z" />
                <circle cx="7.5" cy="7.5" r="1" />
              </svg>
              Labels
            </button>
            <button
              type="button"
              role="menuitem"
              class={menuItemClass}
              onclick={() => {
                menuOpen = false;
                colorOpen = true;
              }}
            >
              <svg
                class="size-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
              </svg>
              Board color
            </button>
          {/if}
          <button
            type="button"
            role="menuitem"
            class={menuItemClass}
            onclick={() => {
              menuOpen = false;
              shareOpen = true;
            }}
          >
            <svg
              class="size-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            Share
          </button>
          <button
            type="button"
            role="menuitem"
            class={menuItemClass}
            onclick={() => {
              menuOpen = false;
              seriesOpen = true;
            }}
          >
            <svg
              class="size-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-3.2-6.9" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
            Recurring cards
          </button>
          <button
            type="button"
            role="menuitem"
            class={menuItemClass}
            onclick={() => {
              menuOpen = false;
              archiveOpen = true;
            }}
          >
            <svg
              class="size-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="3" width="20" height="5" rx="1" />
              <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
              <line x1="10" y1="13" x2="14" y2="13" />
            </svg>
            Archived cards
          </button>
          {#if board.canEdit}
            <button
              type="button"
              role="menuitem"
              class={menuItemClass}
              onclick={() => {
                menuOpen = false;
                webhooksOpen = true;
              }}
            >
              <svg
                class="size-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M9 6.5a3 3 0 1 1 4.2 2.75L16 15" />
                <path d="M18.5 12a3 3 0 1 1-1.6 5.5H11" />
                <path d="M8.5 21a3 3 0 1 1-2.6-4.5L9 11" />
              </svg>
              Webhooks
            </button>
          {/if}
          <!-- Export is the one async action here: keep the menu open so the inline
               spinner and disabled state stay observable (and a second tap can't
               fire a duplicate download) until the archive arrives. -->
          <button
            type="button"
            role="menuitem"
            class="{menuItemClass} disabled:pointer-events-none disabled:opacity-50"
            onclick={exportProject}
            disabled={exporting}
            aria-label="Export"
            aria-busy={exporting}
          >
            {#if exporting}
              <Spinner size="sm" label="Exporting" />
            {:else}
              <svg
                class="size-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            {/if}
            Export
          </button>
        </div>
      {/if}
    </div>
    <FilterBar />
  </div>
</header>

{#if labelsOpen}
  <LabelManager open onclose={() => (labelsOpen = false)} />
{/if}

{#if colorOpen}
  <ProjectColorDialog {projectId} current={accent} onclose={() => (colorOpen = false)} />
{/if}

{#if shareOpen}
  <ProjectMembersModal {projectId} onclose={() => (shareOpen = false)} />
{/if}

{#if archiveOpen}
  <ArchivedTasksModal open onclose={() => (archiveOpen = false)} />
{/if}

{#if webhooksOpen}
  <WebhooksModal {projectId} onclose={() => (webhooksOpen = false)} />
{/if}

{#if seriesOpen}
  <TaskSeriesModal {projectId} onclose={() => (seriesOpen = false)} />
{/if}
