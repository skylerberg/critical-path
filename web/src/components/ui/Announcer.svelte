<script lang="ts">
  import { announcer } from '../../lib/announcer.svelte';
</script>

<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">{announcer.message}</div>
