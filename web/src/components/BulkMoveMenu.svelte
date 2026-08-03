<script lang="ts">
  import { announcer } from '../lib/announcer.svelte';
  import { board } from '../lib/board.svelte';
  import type { BoardColumn } from '../lib/board-types';
  import { selection } from '../lib/selection.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let query = $state('');
  let highlighted = $state(0);
  // onclose only asks the shell to drop the menu; this component stays mounted
  // until that flush, so without the latch a second activation posts again.
  let committed = false;

  const ids = $derived(selection.selectedIds);
  // No per-card position step: a slot is meaningless for a set, and the server
  // appends the whole selection in the order it is sent.
  const filtered = $derived(
    board.columns.filter((column) => column.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  function commit(column: BoardColumn): void {
    if (committed) {
      return;
    }
    committed = true;
    const moving = [...ids];
    void board.bulkMoveTasks(moving, column.id);
    // Close before announcing: this modal keeps the shell's live region inert.
    onclose();
    void announcer.announce(
      `Moved ${String(moving.length)} card${moving.length === 1 ? '' : 's'} to ${column.name}`
    );
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = Math.min(filtered.length - 1, highlighted + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(0, highlighted - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const column = filtered[highlighted];
      if (column !== undefined) {
        commit(column);
      }
    }
  }

  const focusOnMount = (node: HTMLInputElement): void => {
    node.focus();
  };
</script>

<Modal open title="Move {ids.length} card{ids.length === 1 ? '' : 's'} to…" {onclose}>
  <div class="flex flex-col gap-2">
    <input
      bind:value={query}
      use:focusOnMount
      {onkeydown}
      oninput={() => (highlighted = 0)}
      aria-label="Search columns"
      placeholder="Search columns…"
      class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
    />
    <div
      class="flex max-h-64 flex-col gap-1 overflow-y-auto"
      role="group"
      aria-label="Destination columns"
    >
      {#each filtered as column, i (column.id)}
        <button
          type="button"
          onclick={() => commit(column)}
          onpointermove={() => (highlighted = i)}
          class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {highlighted ===
          i
            ? 'bg-accent-soft'
            : 'hover:bg-accent-soft'}"
        >
          <span class="min-w-0 flex-1 truncate">{column.name}</span>
        </button>
      {/each}
      {#if filtered.length === 0}
        <p class="px-3 py-2 text-sm text-muted">No matching columns.</p>
      {/if}
    </div>
  </div>
</Modal>
