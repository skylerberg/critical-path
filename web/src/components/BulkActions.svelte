<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { selection } from '../lib/selection.svelte';
  import type { BulkMenu } from '../lib/shortcuts.svelte';
  import BulkAssigneeMenu from './BulkAssigneeMenu.svelte';
  import BulkConfirmDialog from './BulkConfirmDialog.svelte';
  import BulkLabelMenu from './BulkLabelMenu.svelte';
  import BulkMoveMenu from './BulkMoveMenu.svelte';

  interface Props {
    kind: BulkMenu;
    onclose: () => void;
  }

  let { kind, onclose }: Props = $props();

  // A teammate can delete or archive the last selected card out from under an
  // open menu, leaving it acting on nothing — or demote the user mid-menu, which
  // takes the SelectionBar away and leaves every action here a 403.
  $effect(() => {
    if (selection.count === 0 || !board.canEdit) {
      onclose();
    }
  });
</script>

{#if kind === 'labels'}
  <BulkLabelMenu {onclose} />
{:else if kind === 'assignees'}
  <BulkAssigneeMenu {onclose} />
{:else if kind === 'move'}
  <BulkMoveMenu {onclose} />
{:else}
  <BulkConfirmDialog {onclose} />
{/if}
