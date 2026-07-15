<script lang="ts">
  interface Props {
    projectId: string;
  }

  let { projectId }: Props = $props();

  // TODO: replace with the real dependency graph view (graph agent).
</script>

<main class="p-4">
  <h1 class="text-xl font-semibold">Graph placeholder</h1>
  <p class="mt-2 text-muted">Project: {projectId}</p>
</main>
