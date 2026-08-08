<script lang="ts">
  import { connectivity } from '../lib/connectivity.svelte';
  import { outbox } from '../lib/outbox.svelte';
  import { realtime } from '../lib/realtime.svelte';
  import { isSignedIn, session } from '../lib/session.svelte';
  import { syncMessage, syncState } from '../lib/sync-state';
  import UnsyncedChangesPanel from './UnsyncedChangesPanel.svelte';

  let panelOpen = $state(false);

  const current = $derived(
    !isSignedIn(session.status)
      ? 'clean'
      : syncState({
          reachable: connectivity.reachable,
          pendingCount: outbox.count,
          draining: outbox.draining,
          socketInterrupted: realtime.interrupted,
          unresolvedIssues: outbox.issues.length,
        })
  );

  const message = $derived(syncMessage(current, outbox.count, outbox.issues.length));

  // Only worth opening when there is something inside to read.
  const hasDetail = $derived(outbox.count > 0 || outbox.issues.length > 0);

  const dotColor = $derived(
    current === 'needs-attention'
      ? 'bg-danger'
      : current === 'syncing'
        ? 'bg-accent'
        : 'bg-amber-500'
  );
</script>

{#if current !== 'clean'}
  {#if hasDetail}
    <!-- aria-live rather than role="status" here: the announcement belongs to
         the region, and a button cannot carry a status role. The branch below
         has no interactive element, so it takes the role directly. -->
    <div
      aria-live="polite"
      data-testid="sync-status"
      data-state={current}
      class="fixed bottom-[calc(var(--cp-bottom-nav-h)+0.5rem)] left-1/2 z-30 -translate-x-1/2 lg:bottom-4"
    >
      <button
        type="button"
        class="flex min-h-11 items-center gap-2 rounded-full border border-edge bg-surface px-4 text-xs font-medium text-muted shadow-sm hover:bg-accent-soft"
        onclick={() => (panelOpen = true)}
      >
        <span class="size-2 shrink-0 animate-pulse rounded-full {dotColor}" aria-hidden="true"
        ></span>
        {message}
        <span class="text-accent">Details</span>
      </button>
    </div>
  {:else}
    <div
      role="status"
      data-testid="sync-status"
      data-state={current}
      class="fixed bottom-[calc(var(--cp-bottom-nav-h)+0.5rem)] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1 text-xs font-medium text-muted shadow-sm lg:bottom-4"
    >
      <span class="size-2 shrink-0 animate-pulse rounded-full {dotColor}" aria-hidden="true"></span>
      {message}
    </div>
  {/if}
{/if}

<!-- Mounted only while open: an always-present <dialog> would be the first one
     in the document and would shadow every other dialog a caller looks up. -->
{#if panelOpen}
  <UnsyncedChangesPanel open onclose={() => (panelOpen = false)} />
{/if}
