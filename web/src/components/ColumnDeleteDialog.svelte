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

  const taskCount = $derived(board.tasksInColumn(column.id).length);
  const targets = $derived(board.columns.filter((c) => c.id !== column.id));
  let targetId = $state('');

  $effect(() => {
    if (open && targets.every((target) => target.id !== targetId)) {
      targetId = targets[0]?.id ?? '';
    }
  });

  const blocked = $derived(taskCount > 0 && targets.length === 0);

  function confirm(): void {
    if (taskCount > 0) {
      if (targetId === '') {
        return;
      }
      void board.deleteColumn(column.id, targetId);
    } else {
      void board.deleteColumn(column.id);
    }
    onclose();
  }
</script>

<Modal {open} title="Delete column" {onclose}>
  {#if taskCount === 0}
    <p class="text-sm text-muted">
      Delete the empty column <strong class="text-ink">{column.name}</strong>? This cannot be
      undone.
    </p>
  {:else if blocked}
    <p class="text-sm text-muted">
      <strong class="text-ink">{column.name}</strong> contains {taskCount}
      task{taskCount === 1 ? '' : 's'} and there is no other column to move them to. Add another column
      first.
    </p>
  {:else}
    <p class="mb-3 text-sm text-muted">
      Move the {taskCount} task{taskCount === 1 ? '' : 's'} in
      <strong class="text-ink">{column.name}</strong> to:
    </p>
    <select
      bind:value={targetId}
      aria-label="Move tasks to"
      class="min-h-11 w-full rounded-md border border-edge bg-surface px-3 text-sm outline-none focus:border-accent"
    >
      {#each targets as target (target.id)}
        <option value={target.id}>{target.name}</option>
      {/each}
    </select>
  {/if}
  {#snippet footer()}
    <Button variant="secondary" onclick={onclose}>Cancel</Button>
    <Button variant="danger" onclick={confirm} disabled={blocked}>
      {taskCount > 0 ? 'Move tasks and delete' : 'Delete column'}
    </Button>
  {/snippet}
</Modal>
