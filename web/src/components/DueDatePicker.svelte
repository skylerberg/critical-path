<script lang="ts">
  import { tick } from 'svelte';
  import { board } from '../lib/board.svelte';
  import { formatFullDate, isCalendarDate } from '../lib/dates';

  interface Props {
    taskId: string;
    readonly?: boolean;
  }

  let { taskId, readonly = false }: Props = $props();

  let expanded = $state(false);
  let toggleEl = $state<HTMLButtonElement>();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const due = $derived(isCalendarDate(task?.due_date) ? task.due_date : null);

  // The parent reuses this instance across tasks, so collapse on every switch.
  $effect(() => {
    void taskId;
    expanded = false;
  });

  function set(value: string): void {
    void board.updateTask(taskId, { due_date: value === '' ? null : value });
  }

  // Collapsing is not cosmetic: leaving it expanded would keep a bare date input
  // in the form for the rest of the session and drop focus to the dialog body.
  async function remove(): Promise<void> {
    void board.updateTask(taskId, { due_date: null });
    expanded = false;
    await tick();
    toggleEl?.focus();
  }
</script>

{#if readonly}
  <p class="text-sm">{due === null ? 'No due date' : formatFullDate(due)}</p>
{:else if due === null && !expanded}
  <div>
    <button
      type="button"
      bind:this={toggleEl}
      onclick={() => (expanded = true)}
      class="inline-flex min-h-11 min-w-11 cursor-pointer items-center text-xs font-medium text-muted hover:text-ink"
    >
      <span class="rounded-full border border-dashed border-edge px-2.5 py-1">+ Add due date</span>
    </button>
  </div>
{:else}
  <div class="flex flex-wrap items-center gap-2">
    <input
      type="date"
      aria-label="Due date"
      value={due ?? ''}
      onchange={(event) => set(event.currentTarget.value)}
      class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm outline-none focus:border-accent"
    />
    {#if due !== null}
      <button
        type="button"
        onclick={() => void remove()}
        class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
      >
        Remove
      </button>
    {/if}
  </div>
{/if}
