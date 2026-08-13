<script lang="ts">
  import type { BoardContext } from '../lib/board.svelte';
  import type { DependencyDirection } from '../lib/dependency-types';
  import { truncateTitle } from '../lib/titles';
  import DependencyPicker from './DependencyPicker.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    taskId: string;
    ctx: BoardContext;
    direction: DependencyDirection;
    onclose: () => void;
  }

  let { taskId, ctx, direction, onclose }: Props = $props();

  const task = $derived(ctx.tasks.find((t) => t.id === taskId));
  const heading = $derived(direction === 'blocker' ? 'Blocked by' : 'Blocks');
  // Nothing else in the menu says which task the next Enter will link.
  const title = $derived(
    task === undefined ? heading : `${heading} — ${truncateTitle(task.title)}`
  );

  $effect(() => {
    // Linking to a task a realtime delete took out from under the open menu
    // either fails silently or strands a task the Create row just made.
    if (task === undefined) {
      onclose();
    }
  });
</script>

<Modal open {title} {onclose}>
  <DependencyPicker {taskId} {ctx} {direction} autofocus />
</Modal>
