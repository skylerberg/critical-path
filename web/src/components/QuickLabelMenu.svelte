<script lang="ts">
  import type { BoardContext } from '../lib/board.svelte';
  import LabelSearchMenu from './LabelSearchMenu.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    taskId: string;
    ctx: BoardContext;
    prefill?: string;
    onclose: () => void;
  }

  let { taskId, ctx, prefill = '', onclose }: Props = $props();
</script>

<Modal open title="Labels" {onclose}>
  <LabelSearchMenu {taskId} {ctx} {prefill} autofocus />
</Modal>
