<script lang="ts">
  import { link } from '../lib/router.svelte';

  interface Props {
    path: string;
  }

  let { path }: Props = $props();
</script>

<main class="flex min-h-dvh flex-col items-center justify-center gap-4 p-4">
  <h1 class="text-2xl font-semibold">Page not found</h1>
  <p class="text-muted">No route matches <code class="font-mono">{path}</code></p>
  <a use:link href="/" class="text-accent underline">Back to projects</a>
</main>
