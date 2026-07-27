<script lang="ts">
  import { dragHandle } from 'svelte-dnd-action';
  import { board } from '../lib/board.svelte';
  import type { BoardColumn } from '../lib/board-types';
  import ColumnArchiveTasksDialog from './ColumnArchiveTasksDialog.svelte';
  import ColumnDeleteDialog from './ColumnDeleteDialog.svelte';
  import ColumnMoveTasksDialog from './ColumnMoveTasksDialog.svelte';
  import Badge from './ui/Badge.svelte';

  interface Props {
    column: BoardColumn;
    count: number;
    matchCount: number | null;
    readonly?: boolean;
  }

  let { column, count, matchCount, readonly = false }: Props = $props();

  let renaming = $state(false);
  let draft = $state('');
  let deleteOpen = $state(false);
  let menuOpen = $state(false);
  let moveOpen = $state(false);
  let archiveOpen = $state(false);

  const badgeText = $derived(matchCount === null ? String(count) : `${matchCount} of ${count}`);
  const badgeLabel = $derived(matchCount === null ? ' tasks' : ' tasks match this filter');

  const menuItemClass =
    'flex min-h-11 w-full cursor-pointer items-center px-4 text-left text-sm hover:bg-accent-soft';

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

<svelte:window
  onclick={() => (menuOpen = false)}
  onkeydown={(event) => {
    if (event.key === 'Escape') menuOpen = false;
  }}
/>

<header class="flex items-center gap-1 p-2 pb-1">
  {#if !readonly}
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
  {/if}
  {#if readonly}
    <span class="flex min-h-11 min-w-0 flex-1 items-center">
      <span class="truncate text-sm font-semibold">{column.name}</span>
    </span>
    <Badge>{badgeText}<span class="sr-only">{badgeLabel}</span></Badge>
  {:else if renaming}
    <input
      bind:value={draft}
      use:focusAndSelect
      aria-label="Column name"
      autocapitalize="sentences"
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
    <Badge>{badgeText}<span class="sr-only">{badgeLabel}</span></Badge>
  {/if}
  {#if !readonly}
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
    <div class="relative shrink-0">
      <button
        type="button"
        aria-label="Column options"
        aria-expanded={menuOpen}
        onclick={(event) => {
          event.stopPropagation();
          menuOpen = !menuOpen;
        }}
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
          class="absolute top-full right-0 z-30 w-56 rounded-md border border-edge bg-surface py-1 shadow-lg"
        >
          {#if count > 0 && board.columns.length > 1}
            <button
              type="button"
              role="menuitem"
              class={menuItemClass}
              onclick={() => {
                menuOpen = false;
                moveOpen = true;
              }}
            >
              Move all cards to…
            </button>
          {/if}
          {#if count > 0}
            <button
              type="button"
              role="menuitem"
              class={menuItemClass}
              onclick={() => {
                menuOpen = false;
                archiveOpen = true;
              }}
            >
              Archive all cards
            </button>
          {/if}
          {#if count === 0}
            <p class="px-4 py-2 text-sm text-muted">This column has no cards.</p>
          {/if}
        </div>
      {/if}
    </div>
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
  {/if}
</header>

{#if moveOpen}
  <ColumnMoveTasksDialog {column} open onclose={() => (moveOpen = false)} />
{/if}

{#if archiveOpen}
  <ColumnArchiveTasksDialog {column} open onclose={() => (archiveOpen = false)} />
{/if}

{#if deleteOpen}
  <ColumnDeleteDialog {column} open onclose={() => (deleteOpen = false)} />
{/if}
