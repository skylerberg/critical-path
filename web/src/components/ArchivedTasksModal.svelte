<script lang="ts">
  import { untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';
  import Spinner from './ui/Spinner.svelte';

  interface Props {
    open?: boolean;
    onclose: () => void;
  }

  let { open = false, onclose }: Props = $props();

  let query = $state('');

  $effect(() => {
    const projectId = board.currentProjectId;
    untrack(() => {
      if (projectId !== null) {
        void board.loadArchived();
      }
    });
  });

  const columnNames = $derived(new Map(board.columns.map((column) => [column.id, column.name])));

  const matches = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return needle === ''
      ? board.archivedTasks
      : board.archivedTasks.filter((task) => task.title.toLowerCase().includes(needle));
  });

  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
</script>

<Modal {open} title="Archived cards" {onclose}>
  <input
    type="search"
    bind:value={query}
    aria-label="Search archived cards"
    placeholder="Search archived cards"
    class="mb-3 min-h-11 w-full rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
  />

  {#if board.archivedError !== null}
    <div class="flex flex-col gap-3">
      <p role="alert" class="text-sm text-danger">{board.archivedError}</p>
      <div>
        <Button variant="secondary" onclick={() => void board.loadArchived()}>Try again</Button>
      </div>
    </div>
  {:else if board.archivedLoading && board.archivedTasks.length === 0}
    <Spinner size="sm" label="Loading archived cards" />
  {:else if board.archivedTasks.length === 0}
    <p class="text-sm text-muted">No archived cards.</p>
  {:else if matches.length === 0}
    <p class="text-sm text-muted">No archived cards match your search.</p>
  {:else}
    <ul class="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
      {#each matches as task (task.id)}
        {@const columnName = columnNames.get(task.column_id)}
        {@const when = `Archived ${dateFormat.format(new Date(task.archived_at))}`}
        <li class="flex min-h-11 items-center gap-2">
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm font-medium">{task.title}</span>
            <span class="truncate text-xs text-muted"
              >{columnName === undefined ? when : `${columnName} · ${when}`}</span
            >
          </span>
          <button
            type="button"
            aria-label="Restore card {task.title}"
            onclick={() => void board.restoreTask(task.id)}
            class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-ink"
          >
            Restore
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Modal>
