<script lang="ts">
  import LabelSearchMenu from './LabelSearchMenu.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    taskId: string;
    onclose: () => void;
  }

  let { taskId, onclose }: Props = $props();
</script>

<Modal open title="Labels" {onclose}>
  <LabelSearchMenu {taskId} autofocus />
</Modal>
