<script lang="ts">
  import { connectivity } from '../lib/connectivity.svelte';

  // Shown on the surfaces the outbox deliberately does not queue. Stated rather
  // than enforced by disabling every control: reachability is deduced from
  // whether requests get answers, so a brief outage can read as offline, and a
  // wrong guess that greys out the page is worse than one that warns about it.
</script>

{#if !connectivity.reachable}
  <p
    role="status"
    class="mb-4 rounded-md border border-edge bg-surface px-3 py-2 text-sm text-muted"
    data-testid="offline-notice"
  >
    You are offline. Changes on this page are not queued and cannot be saved until this device can
    reach the server again.
  </p>
{/if}
