<script lang="ts">
  import { board } from '../lib/board.svelte';
  import type { DependencyDirection } from '../lib/dependency-types';
  import DependencyPicker from './DependencyPicker.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    taskId: string;
    direction: DependencyDirection;
    onclose: () => void;
  }

  let { taskId, direction, onclose }: Props = $props();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const heading = $derived(direction === 'blocker' ? 'Blocked by' : 'Blocks');
  // Opened by a keystroke over whatever view was on screen, so the title has to name
  // the task: nothing else in the menu says which one the next Enter will link.
  const title = $derived(task === undefined ? heading : `${heading} — ${task.title}`);

  $effect(() => {
    // A realtime delete can take the task out from under an open menu. Linking to it
    // then either fails silently or strands a task the Create row just made.
    if (task === undefined) {
      onclose();
    }
  });
</script>

<Modal open {title} {onclose}>
  <DependencyPicker {taskId} {direction} autofocus />
</Modal>
