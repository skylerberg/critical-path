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
  // Opened by a keystroke over whatever view was on screen, so the title has to name
  // the task: nothing else in the menu says which one the next Enter will link.
  const title = $derived(
    task === undefined ? heading : `${heading} — ${truncateTitle(task.title)}`
  );

  $effect(() => {
    // A realtime delete can take the task out from under an open menu. Linking to it
    // then either fails silently or strands a task the Create row just made.
    if (task === undefined) {
      onclose();
    }
  });
</script>

<Modal open {title} {onclose}>
  <DependencyPicker {taskId} {ctx} {direction} autofocus />
</Modal>
