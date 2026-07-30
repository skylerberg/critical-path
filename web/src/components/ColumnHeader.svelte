<script lang="ts">
  import { dragHandle } from 'svelte-dnd-action';
  import { board } from '../lib/board.svelte';
  import type { BoardColumn } from '../lib/board-types';
  import { COLUMN_SORT_OPTIONS, columnSortLabel } from '../lib/column-sort';
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
  let menuEl = $state<HTMLDivElement>();
  let moveOpen = $state(false);
  let archiveOpen = $state(false);
  let sortSubmenuOpen = $state(false);

  const currentSort = $derived(board.sortForColumn(column.id));

  const badgeText = $derived(matchCount === null ? String(count) : `${matchCount} of ${count}`);
  const badgeLabel = $derived(matchCount === null ? ' tasks' : ' tasks match this filter');

  const menuItemClass =
    'flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 text-left text-sm hover:bg-accent-soft';

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

  // One header per column, so a click on another column's kebab has to reach this
  // instance to close its menu — hence no stopPropagation on the trigger, and the
  // containment check here to keep a click on our own menu from closing it.
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
    <div bind:this={menuEl} class="relative shrink-0">
      <button
        type="button"
        aria-label="Options for {column.name}"
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
          class="absolute top-full right-0 z-30 w-56 rounded-md border border-edge bg-surface py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            class={menuItemClass}
            onclick={() => {
              menuOpen = false;
              void board.duplicateColumn(column.id);
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
              <rect width="14" height="14" x="8" y="8" rx="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            Duplicate column
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={column.is_done}
            class={menuItemClass}
            title="Tasks in a done column count as completed"
            onclick={() => void board.toggleColumnDone(column.id)}
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
              <path d="m8.5 12.5 2.5 2.5 5-5.5" />
            </svg>
            <span class="flex-1">Mark as done column</span>
            {#if column.is_done}
              <svg
                class="size-4 text-success"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m5 12 5 5 9-10" />
              </svg>
            {/if}
          </button>
          <div class="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sortSubmenuOpen}
              class={menuItemClass}
              onmouseenter={() => (sortSubmenuOpen = true)}
              onclick={() => (sortSubmenuOpen = !sortSubmenuOpen)}
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
                <path d="m3 16 4 4 4-4" />
                <path d="M7 20V4" />
                <path d="m21 8-4-4-4 4" />
                <path d="M17 4v16" />
              </svg>
              <span class="flex-1">Sort by</span>
              {#if currentSort !== 'manual'}
                <span class="truncate text-xs text-muted">{columnSortLabel(currentSort)}</span>
              {/if}
              <svg
                class="size-4 shrink-0 text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            {#if sortSubmenuOpen}
              <div
                role="menu"
                aria-label="Sort {column.name} by"
                class="max-h-[80vh] absolute top-0 right-full mr-1 w-56 overflow-y-auto rounded-md border border-edge bg-surface py-1 shadow-lg"
              >
                {#each COLUMN_SORT_OPTIONS as option (option.value)}
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={currentSort === option.value}
                    class={menuItemClass}
                    onclick={() => {
                      board.setColumnSort(column.id, option.value);
                      menuOpen = false;
                    }}
                  >
                    <span class="flex-1 truncate">{option.label}</span>
                    {#if currentSort === option.value}
                      <svg
                        class="size-4 text-accent"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m5 12 5 5 9-10" />
                      </svg>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          {#if count > 0}
            <div role="separator" class="my-1 border-t border-edge"></div>
            {#if board.columns.length > 1}
              <button
                type="button"
                role="menuitem"
                class={menuItemClass}
                onclick={() => {
                  menuOpen = false;
                  moveOpen = true;
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
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
                Move all cards to…
              </button>
            {/if}
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
                <rect width="20" height="5" x="2" y="3" rx="1" />
                <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
                <path d="M10 12h4" />
              </svg>
              Archive all cards
            </button>
          {/if}
          <div role="separator" class="my-1 border-t border-edge"></div>
          <button
            type="button"
            role="menuitem"
            class="{menuItemClass} hover:text-danger"
            onclick={() => {
              menuOpen = false;
              deleteOpen = true;
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
              <path d="M3 6h18" />
              <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            Delete column
          </button>
        </div>
      {/if}
    </div>
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
