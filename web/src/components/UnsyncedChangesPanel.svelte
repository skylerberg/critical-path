<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { outbox } from '../lib/outbox.svelte';
  import { formatExactTime, formatRelativeTime } from '../lib/relativeTime';
  import { link } from '../lib/router.svelte';
  import { taskHref } from '../lib/short-links';
  import { isQueueStale } from '../lib/sync-state';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  const pending = $derived(outbox.pending);
  const issues = $derived(outbox.issues);
  const stale = $derived(isQueueStale(outbox.oldestQueuedAt));

  // Only a conflict has somewhere to go: the card holds the resolution UI, with
  // the user's version already waiting in it.
  function conflictHref(taskId: string): string | null {
    const task = board.tasks.find((candidate) => candidate.id === taskId);
    return task === undefined ? null : taskHref(task.id, task.title);
  }
</script>

<Modal {open} title="Unsynced changes" size="lg" {onclose}>
  <div class="space-y-6 text-sm" data-testid="unsynced-panel">
    {#if board.syncedAt !== null}
      <p class="text-muted">
        This board was last read from the server
        <time datetime={board.syncedAt} title={formatExactTime(board.syncedAt)}>
          {formatRelativeTime(board.syncedAt)}
        </time>.
      </p>
    {/if}

    {#if issues.length > 0}
      <section>
        <h3 class="mb-2 font-medium text-ink">Needs your attention</h3>
        <ul class="space-y-3">
          {#each issues as issue (issue.id)}
            <li class="rounded-md border border-edge bg-surface p-3" data-testid="outbox-issue">
              <p class="font-medium text-ink">{issue.label}</p>
              <p class="mt-1 text-muted">{issue.detail}</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                {#if issue.taskId !== undefined && conflictHref(issue.taskId) !== null}
                  <a
                    use:link
                    href={conflictHref(issue.taskId)}
                    class="inline-flex min-h-11 items-center rounded-md px-3 text-accent hover:bg-accent-soft"
                    onclick={onclose}
                  >
                    Open the card to merge
                  </a>
                {/if}
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center rounded-md px-3 text-muted hover:bg-accent-soft"
                  onclick={() => outbox.dismissIssue(issue.id)}
                >
                  Dismiss
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <h3 class="mb-2 font-medium text-ink">
        Waiting to send ({pending.length})
      </h3>
      {#if stale}
        <p class="mb-2 text-danger" data-testid="stale-queue-warning">
          The oldest of these has been waiting more than a day. It has not been sent, and it will
          not be until this device can reach the server.
        </p>
      {/if}
      {#if pending.length === 0}
        <p class="text-muted">Nothing is waiting. Everything you have changed has been sent.</p>
      {:else}
        <ul class="space-y-2">
          {#each pending as op (op.id)}
            <li
              class="flex items-baseline justify-between gap-3 rounded-md border border-edge bg-surface px-3 py-2"
              data-testid="pending-change"
            >
              <span class="text-ink">{op.label}</span>
              <time
                class="shrink-0 text-xs text-muted"
                datetime={op.queuedAt}
                title={formatExactTime(op.queuedAt)}
              >
                {formatRelativeTime(op.queuedAt)}
              </time>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  {#snippet footer()}
    {#if issues.length > 0}
      <Button variant="secondary" onclick={() => outbox.dismissAllIssues()}>Dismiss all</Button>
    {/if}
    <Button onclick={onclose}>Close</Button>
  {/snippet}
</Modal>
