<script lang="ts">
  import { apiMessage } from '../lib/apiMessages';
  import { board } from '../lib/board.svelte';
  import { downloadProjectExport } from '../lib/export';
  import { projects } from '../lib/projects.svelte';
  import { link, type ProjectView } from '../lib/router.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import ArchivedTasksModal from './ArchivedTasksModal.svelte';
  import FilterBar from './FilterBar.svelte';
  import LabelManager from './LabelManager.svelte';
  import ProjectMembersModal from './ProjectMembersModal.svelte';
  import WebhooksModal from './WebhooksModal.svelte';
  import Badge from './ui/Badge.svelte';
  import Spinner from './ui/Spinner.svelte';

  interface Props {
    projectId: string;
    view: ProjectView;
  }

  let { projectId, view }: Props = $props();

  let labelsOpen = $state(false);
  let shareOpen = $state(false);
  let archiveOpen = $state(false);
  let webhooksOpen = $state(false);
  let exporting = $state(false);

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

  // Publishing and the project_updated event land in the projects list; the board
  // payload's copy only refreshes on a board fetch, so it is the fallback.
  const isPublic = $derived(
    projects.projects.find((p) => p.id === projectId)?.is_public ??
      board.project?.is_public ??
      false
  );
</script>

<header class="shrink-0 border-b border-edge bg-surface px-3 py-2 lg:px-4">
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <h1 class="min-w-0 truncate text-lg font-semibold">
      {board.project?.name ?? ''}
    </h1>
    {#if isPublic}
      <Badge variant="accent">Public</Badge>
    {/if}
    <nav use:link aria-label="Project views" class="flex gap-1">
      <a
        href={`/projects/${projectId}${board.filterSearch}`}
        aria-current={boardActive ? 'page' : undefined}
        class="flex min-h-11 items-center rounded-md px-3 text-sm font-medium {boardActive
          ? 'bg-accent-soft text-accent'
          : 'text-muted hover:bg-accent-soft hover:text-ink'}"
      >
        Board
      </a>
      <a
        href={`/projects/${projectId}/graph${board.filterSearch}`}
        aria-current={graphActive ? 'page' : undefined}
        class="flex min-h-11 items-center rounded-md px-3 text-sm font-medium {graphActive
          ? 'bg-accent-soft text-accent'
          : 'text-muted hover:bg-accent-soft hover:text-ink'}"
      >
        Graph
      </a>
    </nav>
    <button
      type="button"
      onclick={() => (labelsOpen = true)}
      class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-muted hover:bg-accent-soft hover:text-ink"
    >
      <svg
        class="size-4"
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
      onclick={() => (shareOpen = true)}
      class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-muted hover:bg-accent-soft hover:text-ink"
    >
      <svg
        class="size-4"
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
      onclick={() => (archiveOpen = true)}
      class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-muted hover:bg-accent-soft hover:text-ink"
    >
      <svg
        class="size-4"
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
    <button
      type="button"
      onclick={() => (webhooksOpen = true)}
      class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-muted hover:bg-accent-soft hover:text-ink"
    >
      <svg
        class="size-4"
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
    <button
      type="button"
      onclick={exportProject}
      disabled={exporting}
      aria-label="Export"
      aria-busy={exporting}
      class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-muted hover:bg-accent-soft hover:text-ink disabled:pointer-events-none disabled:opacity-50"
    >
      {#if exporting}
        <Spinner size="sm" label="Exporting" />
      {:else}
        <svg
          class="size-4"
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
    <FilterBar />
  </div>
</header>

{#if labelsOpen}
  <LabelManager open onclose={() => (labelsOpen = false)} />
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
