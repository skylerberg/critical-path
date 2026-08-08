<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { isCalendarDate } from '../lib/dates';

  interface Props {
    taskId: string;
    // Clearing the date empties the section this was opened from, so the caller
    // decides where the popover and focus go next.
    oncleared?: () => void;
  }

  let { taskId, oncleared }: Props = $props();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const due = $derived(isCalendarDate(task?.due_date) ? task.due_date : null);

  // A date input reports '' for any incomplete value, so clearing one segment to
  // retype it looks exactly like a deliberate clear. Ignoring it keeps the field
  // mounted and focused mid-edit; Remove is the only thing that clears the date.
  function set(value: string): void {
    if (value === '') {
      return;
    }
    void board.updateTask(taskId, { due_date: value });
  }

  function remove(): void {
    void board.updateTask(taskId, { due_date: null });
    oncleared?.();
  }

  const focusOnMount = (node: HTMLInputElement): void => {
    node.focus();
  };
</script>

<div class="flex flex-wrap items-center gap-2">
  <input
    type="date"
    aria-label="Due date"
    value={due ?? ''}
    use:focusOnMount
    onchange={(event) => set(event.currentTarget.value)}
    class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm outline-none focus:border-accent"
  />
  {#if due !== null}
    <button
      type="button"
      onclick={remove}
      class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
    >
      Remove
    </button>
  {/if}
</div>
