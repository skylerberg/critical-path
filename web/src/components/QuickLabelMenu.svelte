<script lang="ts">
  import LabelSearchMenu from './LabelSearchMenu.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    taskId: string;
    prefill?: string;
    onclose: () => void;
  }

  let { taskId, prefill = '', onclose }: Props = $props();
</script>

<Modal open title="Labels" {onclose}>
  <LabelSearchMenu {taskId} {prefill} autofocus />
</Modal>
