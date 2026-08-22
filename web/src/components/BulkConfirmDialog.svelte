<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { selection } from '../lib/selection.svelte';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  const ids = $derived(selection.selectedIds);
  const chosen = $derived(new Set(ids));
  // Tasks, not edges, so a card blocked by two of these counts once.
  const dependentCount = $derived(
    board.tasks.filter(
      (task) => !chosen.has(task.id) && task.blocker_ids.some((id) => chosen.has(id))
    ).length
  );

  function confirm(): void {
    void board.bulkArchiveTasks([...ids]);
    selection.clear();
    onclose();
  }
</script>

<Modal open title="Archive cards" {onclose}>
  <p class="text-sm text-muted">
    Archive the {ids.length} selected card{ids.length === 1 ? '' : 's'}? Archived cards leave the
    board but stay in the archive and can be restored.
  </p>
  {#if dependentCount > 0}
    <p class="mt-3 text-sm text-muted">
      {dependentCount} card{dependentCount === 1 ? '' : 's'} elsewhere on the board will lose a dependency.
    </p>
  {/if}
  {#snippet footer()}
    <Button variant="secondary" onclick={onclose}>Cancel</Button>
    <Button variant="primary" onclick={confirm}>Archive cards</Button>
  {/snippet}
</Modal>
