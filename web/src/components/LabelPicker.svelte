<script lang="ts">
  import LabelSearchMenu from './LabelSearchMenu.svelte';

  interface Props {
    taskId: string;
  }

  let { taskId }: Props = $props();
</script>

<LabelSearchMenu {taskId} />
