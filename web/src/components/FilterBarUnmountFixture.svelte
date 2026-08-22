<script lang="ts">
  // Test-only. The bar goes away with the project header around it, never on its
  // own: unmounting the component directly flushes its pending effects first,
  // and the race this stands in for is the one where they never run at all.
  import { board } from '../lib/board.svelte';
  import FilterBar from './FilterBar.svelte';
</script>

{#if board.currentProjectId !== null}
  <FilterBar />
{/if}
