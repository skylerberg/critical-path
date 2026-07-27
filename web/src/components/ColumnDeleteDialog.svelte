<script lang="ts">
  import { untrack } from 'svelte';
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

  // The server relocates archived cards too, so a column that looks empty here
  // can still refuse to delete; one extra GET on a rare destructive action.
  $effect(() => {
    if (open) {
      untrack(() => void board.loadArchived());
    }
  });

  const liveCount = $derived(board.tasksInColumn(column.id).length);
  const archivedCount = $derived(
    board.archivedTasks.filter((task) => task.column_id === column.id).length
  );
  const archivedKnown = $derived(board.archivedLoaded && board.archivedError === null);
  const checking = $derived(!archivedKnown && board.archivedLoading);
  const targets = $derived(board.columns.filter((c) => c.id !== column.id));
  // Unknown archive state counts as "may hold cards": offering a move target is
  // harmless, telling the user the column is empty is not.
  const mayHoldCards = $derived(liveCount > 0 || !archivedKnown || archivedCount > 0);
  const blocked = $derived(checking || (mayHoldCards && targets.length === 0));

  let targetId = $state('');

  $effect(() => {
    if (open && targets.every((target) => target.id !== targetId)) {
      targetId = targets[0]?.id ?? '';
    }
  });

  const contents = $derived.by(() => {
    const parts: string[] = [];
    if (liveCount > 0) {
      parts.push(`${liveCount} task${liveCount === 1 ? '' : 's'}`);
    }
    if (archivedCount > 0) {
      parts.push(`${archivedCount} archived card${archivedCount === 1 ? '' : 's'}`);
    }
    return parts.join(' and ');
  });

  // Always supply a target when one exists: the archive count can go stale between
  // load and click, and the server ignores the target for a genuinely empty column.
  function confirm(): void {
    if (blocked) {
      return;
    }
    if (targets.length > 0) {
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

{#snippet moveTarget()}
  <select
    bind:value={targetId}
    aria-label="Move tasks to"
    class="min-h-11 w-full rounded-md border border-edge bg-surface px-3 text-sm outline-none focus:border-accent"
  >
    {#each targets as target (target.id)}
      <option value={target.id}>{target.name}</option>
    {/each}
  </select>
{/snippet}

<Modal {open} title="Delete column" {onclose}>
  {#if checking}
    <p class="text-sm text-muted">
      Checking <strong class="text-ink">{column.name}</strong> for archived cards…
    </p>
  {:else if !archivedKnown}
    {#if targets.length > 0}
      <p class="mb-3 text-sm text-muted">
        Could not check <strong class="text-ink">{column.name}</strong> for archived cards. Deleting it
        moves everything it holds, visible or archived, to:
      </p>
      {@render moveTarget()}
    {:else}
      <p class="text-sm text-muted">
        Could not check <strong class="text-ink">{column.name}</strong> for archived cards. Add another
        column first, so anything it holds has somewhere to go.
      </p>
    {/if}
  {:else if liveCount + archivedCount === 0}
    <p class="text-sm text-muted">
      Delete the empty column <strong class="text-ink">{column.name}</strong>? This cannot be
      undone.
    </p>
  {:else if blocked}
    <p class="text-sm text-muted">
      <strong class="text-ink">{column.name}</strong> contains {contents} and there is no other column
      to move them to. Add another column first.
    </p>
  {:else}
    <p class="mb-3 text-sm text-muted">
      Move {contents} in <strong class="text-ink">{column.name}</strong> to:
    </p>
    {@render moveTarget()}
  {/if}
  {#snippet footer()}
    <Button variant="secondary" onclick={onclose}>Cancel</Button>
    <Button variant="danger" onclick={confirm} disabled={blocked}>
      {mayHoldCards ? 'Move and delete' : 'Delete column'}
    </Button>
  {/snippet}
</Modal>
