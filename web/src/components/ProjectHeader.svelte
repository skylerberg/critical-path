<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { link, type ProjectView } from '../lib/router.svelte';
  import FilterBar from './FilterBar.svelte';
  import LabelManager from './LabelManager.svelte';

  interface Props {
    projectId: string;
    view: ProjectView;
  }

  let { projectId, view }: Props = $props();

  let labelsOpen = $state(false);

  const boardActive = $derived(view === 'board');
  const graphActive = $derived(view === 'graph');
</script>

<header class="shrink-0 border-b border-edge bg-surface px-3 py-2 lg:px-4">
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <h1 class="min-w-0 flex-1 truncate text-lg font-semibold">{board.project?.name ?? ''}</h1>
    <nav use:link aria-label="Project views" class="flex gap-1">
      <a
        href={`/projects/${projectId}`}
        aria-current={boardActive ? 'page' : undefined}
        class="flex min-h-11 items-center rounded-md px-3 text-sm font-medium {boardActive
          ? 'bg-accent-soft text-accent'
          : 'text-muted hover:bg-accent-soft hover:text-ink'}"
      >
        Board
      </a>
      <a
        href={`/projects/${projectId}/graph`}
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
  </div>
  {#if view !== 'graph'}
    <FilterBar />
  {/if}
</header>

{#if labelsOpen}
  <LabelManager open onclose={() => (labelsOpen = false)} />
{/if}
