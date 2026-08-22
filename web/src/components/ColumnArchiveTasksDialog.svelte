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
  // would archive a different set than the count the user was shown.
  const archiving = $derived(board.tasksInColumn(column.id));
  const archivingIds = $derived(new Set(archiving.map((task) => task.id)));
  const dependentCount = $derived(
    board.tasks.filter(
      (task) => !archivingIds.has(task.id) && task.blocker_ids.some((id) => archivingIds.has(id))
    ).length
  );

  function confirm(): void {
    void board.archiveTasksInColumn(column.id);
    onclose();
  }
</script>

<Modal {open} title="Archive all cards" {onclose}>
  <p class="text-sm text-muted">
    Archive the {archiving.length} card{archiving.length === 1 ? '' : 's'} in
    <strong class="text-ink">{column.name}</strong>? Archived cards leave the board but stay in the
    archive and can be restored.
  </p>
  {#if dependentCount > 0}
    <p class="mt-3 text-sm text-muted">
      {dependentCount} card{dependentCount === 1 ? '' : 's'} elsewhere on the board will lose a dependency.
    </p>
  {/if}
  {#snippet footer()}
    <Button variant="secondary" onclick={onclose}>Cancel</Button>
    <Button onclick={confirm}>Archive cards</Button>
  {/snippet}
</Modal>
