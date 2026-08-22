<script lang="ts">
  import type { BoardContext } from '../lib/board.svelte';
  import AssigneeSearchMenu from './AssigneeSearchMenu.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    taskId: string;
    ctx: BoardContext;
    onclose: () => void;
  }

  let { taskId, ctx, onclose }: Props = $props();
</script>

<Modal open title="Assignees" {onclose}>
  <AssigneeSearchMenu {taskId} {ctx} autofocus />
</Modal>
