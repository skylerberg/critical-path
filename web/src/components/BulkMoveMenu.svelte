<script lang="ts">
  import { focusOnMount } from '../lib/actions';
  import { announcer } from '../lib/announcer.svelte';
  import { board } from '../lib/board.svelte';
  import type { BoardColumn } from '../lib/board-types';
  import { ListNav } from '../lib/list-nav.svelte';
  import { selection } from '../lib/selection.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let query = $state('');
  let listEl = $state<HTMLDivElement>();
  // onclose only asks the shell to drop the menu; this component stays mounted
  // until that flush, so without the latch a second activation posts again.
  let committed = false;

  const ids = $derived(selection.selectedIds);
  // No per-card position step: a slot is meaningless for a set, and the server
  // appends the whole selection in the order it is sent.
  const filtered = $derived(
    board.columns.filter((column) => column.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  // Inert rather than first: a teammate deleting the highlighted column would
  // otherwise slide Enter onto its neighbour, moving the whole selection into a
  // column nobody chose.
  const nav = new ListNav({
    keys: () => filtered.map((column) => column.id),
    list: () => listEl,
    missing: 'inert',
  });

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
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (nav.move(event.key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const column = filtered.find((c) => c.id === nav.activeKey);
      if (column !== undefined) {
        commit(column);
      }
    }
  }
</script>

<Modal open title="Move {ids.length} card{ids.length === 1 ? '' : 's'} to…" {onclose}>
  <div class="flex flex-col gap-2">
    <input
      bind:value={query}
      use:focusOnMount
      {onkeydown}
      oninput={() => nav.clear()}
      aria-label="Search columns"
      placeholder="Search columns…"
      class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm focus-ring focus:border-accent"
    />
    <div
      bind:this={listEl}
      class="flex max-h-64 flex-col gap-1 overflow-y-auto"
      role="group"
      aria-label="Destination columns"
    >
      {#each filtered as column, i (column.id)}
        <button
          type="button"
          data-index={i}
          onclick={() => commit(column)}
          onpointermove={() => nav.highlight(column.id)}
          class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {nav.index ===
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
