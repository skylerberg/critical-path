<script lang="ts">
  import { untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import { truncateTitle } from '../lib/titles';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';
  import Spinner from './ui/Spinner.svelte';

  interface Props {
    open?: boolean;
    onclose: () => void;
  }

  let { open = false, onclose }: Props = $props();

  let query = $state('');
  // One card at a time: a second Delete press elsewhere disarms the first, so an
  // armed button can never be somewhere the user has stopped looking.
  let confirmingId = $state<string | null>(null);

  $effect(() => {
    const projectId = board.currentProjectId;
    const isOpen = open;
    untrack(() => {
      confirmingId = null;
      if (isOpen && projectId !== null) {
        void board.loadArchived();
      }
    });
  });

  function requestDelete(taskId: string): void {
    if (confirmingId !== taskId) {
      confirmingId = taskId;
      return;
    }
    confirmingId = null;
    void board.deleteTask(taskId);
  }

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

  <!-- Load state, not emptiness: an optimistic archive fills archivedTasks before
       any load has run, and that one row is not the archive. -->
  {#if !board.archivedLoaded && board.archivedError === null}
    <Spinner size="sm" label="Loading archived cards" />
  {:else if board.archivedError !== null}
    <div class="flex flex-col gap-3">
      <p role="alert" class="text-sm text-danger">{board.archivedError}</p>
      <div>
        <Button variant="secondary" onclick={() => void board.loadArchived()}>Try again</Button>
      </div>
    </div>
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
            <span class="truncate text-sm font-medium">{truncateTitle(task.title)}</span>
            <span class="truncate text-xs text-muted"
              >{columnName === undefined ? when : `${columnName} · ${when}`}</span
            >
          </span>
          {#if board.canEdit}
            <button
              type="button"
              aria-label="Restore card {truncateTitle(task.title)}"
              onclick={() => void board.restoreTask(task.id)}
              class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-ink"
            >
              Restore
            </button>
            <button
              type="button"
              aria-label={confirmingId === task.id
                ? `Confirm delete of card ${truncateTitle(task.title)}`
                : `Delete card ${truncateTitle(task.title)}`}
              onclick={() => requestDelete(task.id)}
              class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm hover:bg-accent-soft {confirmingId ===
              task.id
                ? 'font-medium text-danger'
                : 'text-muted hover:text-danger'}"
            >
              {confirmingId === task.id ? 'Confirm delete' : 'Delete'}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Modal>
