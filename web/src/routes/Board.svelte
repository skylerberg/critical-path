<script lang="ts">
  interface Props {
    projectId: string;
    taskId?: string;
  }

  let { projectId, taskId }: Props = $props();

  // TODO: replace with the real kanban board + task detail overlay (board store agent).
</script>

<main class="p-4">
  <h1 class="text-xl font-semibold">Board placeholder</h1>
  <p class="mt-2 text-muted">Project: {projectId}</p>
  {#if taskId}
    <p class="text-muted">Task: {taskId}</p>
  {/if}
</main>
