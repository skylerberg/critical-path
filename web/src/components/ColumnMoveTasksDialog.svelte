<script lang="ts">
  import { board } from '../lib/board.svelte';
  import type { BoardColumn } from '../lib/board-types';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    column: BoardColumn;
    open?: boolean;
    onclose: () => void;
  }

  let { column, open = false, onclose }: Props = $props();

  // Filters are ignored on purpose: a bulk action driven by a transient filter
  // would move a different set than the count the user was shown.
  const count = $derived(board.tasksInColumn(column.id).length);
  const targets = $derived(board.columns.filter((c) => c.id !== column.id));

  let targetId = $state('');

  $effect(() => {
    if (open && targets.every((target) => target.id !== targetId)) {
      targetId = targets[0]?.id ?? '';
    }
  });

  function confirm(): void {
    if (targetId === '') {
      return;
    }
    void board.moveTasksToColumn(column.id, targetId);
    onclose();
  }
</script>

<Modal {open} title="Move all cards" {onclose}>
  <p class="mb-3 text-sm text-muted">
    Move the {count} card{count === 1 ? '' : 's'} in
    <strong class="text-ink">{column.name}</strong> to:
  </p>
  <select
    bind:value={targetId}
    aria-label="Move cards to"
    class="min-h-11 w-full rounded-md border border-edge bg-surface px-3 text-sm outline-none focus:border-accent"
  >
    {#each targets as target (target.id)}
      <option value={target.id}>{target.name}</option>
    {/each}
  </select>
  {#snippet footer()}
    <Button variant="secondary" onclick={onclose}>Cancel</Button>
    <Button onclick={confirm} disabled={targetId === ''}>Move cards</Button>
  {/snippet}
</Modal>
