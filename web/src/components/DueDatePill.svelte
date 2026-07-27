<script lang="ts">
  import { board } from '../lib/board.svelte';
  import type { BoardTask } from '../lib/board-types';
  import { dueStatus, formatDue, formatFullDate, isCalendarDate, todayISO } from '../lib/dates';

  interface Props {
    task: BoardTask;
    done?: boolean;
    readonly?: boolean;
  }

  let { task, done = false, readonly = false }: Props = $props();

  const due = $derived(isCalendarDate(task.due_date) ? task.due_date : null);
  const today = $derived(todayISO());
  const label = $derived(due === null ? '' : formatDue(due, today));
  const status = $derived(due === null ? 'neutral' : dueStatus(due, done, today));
  const canComplete = $derived(!done && !readonly && board.doneColumnIds.size > 0);

  // Neutral carries the same box as the tinted states but no background, so it
  // reads as one more badge in the row and a colour change never moves anything.
  const tone = {
    neutral: 'text-muted',
    soon: 'bg-warning/15 text-warning',
    overdue: 'bg-danger/15 text-danger',
    done: 'bg-success/15 text-success',
  };

  const chip = $derived(
    `inline-flex items-center gap-1 -mx-1.5 rounded-full px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${tone[status]}`
  );
</script>

{#snippet face()}
  <svg
    class="size-3.5 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    {#if status === 'done'}
      <path d="m8 12 3 3 5-6" />
    {:else}
      <path d="M12 7v5l3 2" />
    {/if}
  </svg>
  {label}
{/snippet}

{#if due !== null}
  {#if canComplete}
    <!-- The tap target is grown with a pseudo-element instead of an in-flow 44px
         box, which would pad every dated card with blank space. It stops 8px up
         and 12px down: the row's top margin and the card's bottom padding, so it
         never covers the title above it or the card below. -->
    <button
      type="button"
      title="Due {formatFullDate(due)}"
      aria-label={`Mark “${task.title}” done (due ${label})`}
      onclick={() => board.markTaskDone(task.id)}
      class="{chip} relative cursor-pointer after:absolute after:-inset-x-2 after:-top-2 after:-bottom-3 after:content-['']"
    >
      {@render face()}
    </button>
  {:else}
    <span title="Due {formatFullDate(due)}" class={chip}>
      {@render face()}
    </span>
  {/if}
{/if}
