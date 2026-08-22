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

  const task = $derived(ctx.tasks.find((t) => t.id === taskId));

  $effect(() => {
    // Every row here PUTs the card's labels, and a card a realtime delete has
    // taken away answers that with an error toast and a full refetch.
    if (task === undefined) {
      onclose();
    }
  });
</script>

<Modal open title="Labels" {onclose}>
  <LabelSearchMenu {taskId} {ctx} {prefill} autofocus />
</Modal>
