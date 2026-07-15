<script lang="ts">
  import { dragHandle } from 'svelte-dnd-action';
  import { board } from '../lib/board.svelte';
  import type { BoardColumn } from '../lib/board-types';
  import ColumnDeleteDialog from './ColumnDeleteDialog.svelte';
  import Badge from './ui/Badge.svelte';

  interface Props {
    column: BoardColumn;
    count: number;
  }

  let { column, count }: Props = $props();

  let renaming = $state(false);
  let draft = $state('');
  let deleteOpen = $state(false);

  function startRename(): void {
    draft = column.name;
    renaming = true;
  }

  function commitRename(): void {
    if (!renaming) {
      return;
    }
    renaming = false;
    const name = draft.trim();
    if (name !== '' && name !== column.name) {
      void board.renameColumn(column.id, name);
    }
  }

  const focusAndSelect = (node: HTMLInputElement): void => {
    node.focus();
    node.select();
  };
</script>

<header class="flex items-center gap-1 p-2 pb-1">
  <span
    use:dragHandle
    aria-label="Reorder column"
    class="flex min-h-11 w-6 shrink-0 items-center justify-center text-muted"
  >
    <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  </span>
  {#if renaming}
    <input
      bind:value={draft}
      use:focusAndSelect
      aria-label="Column name"
      onblur={commitRename}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          commitRename();
        } else if (event.key === 'Escape') {
          renaming = false;
        }
      }}
      class="min-h-11 w-full min-w-0 flex-1 rounded-md border border-accent bg-canvas px-2 text-sm font-semibold outline-none"
    />
  {:else}
    <button
      type="button"
      onclick={startRename}
      title="Rename column"
      class="min-h-11 min-w-0 flex-1 cursor-text truncate text-left text-sm font-semibold"
    >
      {column.name}
    </button>
    <Badge>{count}</Badge>
  {/if}
  <button
    type="button"
    onclick={() => void board.toggleColumnDone(column.id)}
    aria-pressed={column.is_done}
    title={column.is_done ? 'Tasks in this column count as done' : 'Mark this as a done column'}
    class="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-accent-soft {column.is_done
      ? 'text-success'
      : 'text-muted opacity-40 hover:opacity-100'}"
  >
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
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 5-5.5" />
    </svg>
  </button>
  <button
    type="button"
    onclick={() => (deleteOpen = true)}
    aria-label="Delete column"
    class="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-danger"
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
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  </button>
</header>

{#if deleteOpen}
  <ColumnDeleteDialog {column} open onclose={() => (deleteOpen = false)} />
{/if}
