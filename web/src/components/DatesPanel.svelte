<script lang="ts">
  import { ApiError } from '../api/client';
  import { board } from '../lib/board.svelte';
  import { isCalendarDate, todayISO } from '../lib/dates';
  import { newId } from '../lib/ids';
  import { RECURRENCE_PRESETS, presetLabel, type RecurrencePreset } from '../lib/recurrence';
  import { taskSeries } from '../lib/taskSeries.svelte';
  import Button from './ui/Button.svelte';

  interface Props {
    taskId: string;
    // Clearing the date empties the section this was opened from, so the caller
    // decides where the popover and focus go next.
    oncleared?: () => void;
  }

  let { taskId, oncleared }: Props = $props();

  const uid = $props.id();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const due = $derived(isCalendarDate(task?.due_date) ? task.due_date : null);

  const seriesRef = $derived(board.taskSeriesRefs[taskId] ?? null);
  // The card detail carries the id and the wording; the rule itself lives in the
  // series store, which is the only thing that knows which preset to preselect.
  const series = $derived(
    seriesRef === null ? null : (taskSeries.list.find((row) => row.id === seriesRef.id) ?? null)
  );
  const ruleLoaded = $derived(seriesRef === null || series !== null);

  let startDate = $state(todayISO());
  // null follows the store; a string is what this panel is mid-way through
  // choosing, and outlives neither a save nor a cancel.
  let choice = $state<string | null>(null);
  let busy = $state(false);
  let error = $state('');

  // Keyed on the ref, not the loaded rule: the ref is what decides whether the
  // card repeats at all, and reading 'none' off a rule still in flight would
  // both say "Doesn't repeat" about a card that does and spring the stop
  // confirmation on someone who never asked for it.
  const current = $derived(choice ?? (seriesRef === null ? 'none' : (series?.preset ?? 'custom')));
  const stopping = $derived(current === 'none' && seriesRef !== null);
  const anchor = $derived(series?.start_date ?? startDate);

  $effect(() => {
    const projectId = board.currentProjectId;
    if (seriesRef !== null && projectId !== null) {
      void taskSeries.load(projectId);
    }
  });

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

  async function run(action: () => Promise<void>): Promise<void> {
    busy = true;
    error = '';
    try {
      await action();
      choice = null;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not save that. Try again.';
    } finally {
      busy = false;
    }
  }

  function choose(value: string): void {
    choice = value;
    error = '';
    if (value === 'none' || value === 'custom' || !ruleLoaded) {
      return;
    }
    const preset = value as RecurrencePreset;
    void run(async () => {
      if (series === null) {
        const row = await taskSeries.createFromTask(taskId, {
          id: newId(),
          preset,
          start_date: startDate,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        board.setTaskSeriesRef(taskId, { id: row.id, summary: row.summary });
      } else {
        const row = await taskSeries.patch(series.id, { preset });
        board.setTaskSeriesRef(taskId, { id: row.id, summary: row.summary });
      }
    });
  }

  function stop(): void {
    const id = seriesRef?.id;
    if (id === undefined) return;
    void run(async () => {
      // remove() reports its own failure and resyncs the list rather than
      // throwing, so the list it leaves behind is what says whether the series
      // is actually gone. Clearing the card unconditionally would name no
      // recurrence on a card that still has one.
      await taskSeries.remove(id);
      if (!taskSeries.list.some((row) => row.id === id)) {
        board.setTaskSeriesRef(taskId, null);
      }
    });
  }
</script>

<div class="flex flex-col gap-3">
  <div class="flex flex-col gap-1">
    <span class="text-sm font-medium">Due date</span>
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
  </div>

  <div class="flex flex-col gap-1 border-t border-edge pt-3">
    <label for="{uid}-repeats" class="text-sm font-medium">Repeats</label>
    <select
      id="{uid}-repeats"
      value={current}
      disabled={busy || !ruleLoaded}
      onchange={(event) => choose(event.currentTarget.value)}
      class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm disabled:opacity-60"
    >
      <option value="none">Doesn't repeat</option>
      {#if current === 'custom'}
        <!-- A rule from outside the curated set. Offered as the current value so
             the menu can say what it is, and disabled so it cannot be re-picked. -->
        <option value="custom" disabled>{seriesRef?.summary ?? 'Custom'}</option>
      {/if}
      {#each RECURRENCE_PRESETS as option (option)}
        <option value={option}>{presetLabel(option, anchor)}</option>
      {/each}
    </select>

    {#if seriesRef === null && current !== 'none'}
      <label for="{uid}-start" class="mt-2 text-sm font-medium">Starts on</label>
      <input
        id="{uid}-start"
        type="date"
        bind:value={startDate}
        class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm outline-none focus:border-accent"
      />
    {/if}
  </div>

  {#if stopping}
    <div class="flex flex-col gap-2 rounded-md border border-edge p-3">
      <p class="text-sm">Stop this card repeating? Cards already created stay as they are.</p>
      <div class="flex flex-wrap gap-2">
        <Button variant="danger" disabled={busy} onclick={stop}>Stop repeating</Button>
        <Button variant="secondary" disabled={busy} onclick={() => (choice = null)}>Cancel</Button>
      </div>
    </div>
  {:else if seriesRef !== null}
    <p class="text-sm text-muted">
      A new card appears when its turn comes round. Cards already created stay as they are, and
      editing this one does not change what repeats.
    </p>
  {/if}

  {#if error !== ''}
    <p role="alert" class="text-sm text-danger">{error}</p>
  {/if}
</div>
