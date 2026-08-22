<script lang="ts">
  import { focusOnMount } from '../lib/actions';
  import { apiMessage } from '../lib/apiMessages';
  import { board } from '../lib/board.svelte';
  import { isCalendarDate, todayISO } from '../lib/dates';
  import { newId } from '../lib/ids';
  import { RECURRENCE_PRESETS, presetLabel, type RecurrencePreset } from '../lib/recurrence';
  import { taskSeries, type TaskSeries } from '../lib/taskSeries.svelte';
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

  // The card's own detail carries the whole rule, so this panel never reads the
  // project's series list — which is why there is no loading state below, and no
  // window in which the card cannot say what it repeats on.
  const series = $derived(board.taskSeriesRefs[taskId] ?? null);

  let startDate = $state(todayISO());
  // null follows the card; a string is what this panel is mid-way through
  // choosing, and outlives neither a save nor a cancel.
  let choice = $state<string | null>(null);
  let busy = $state(false);
  let error = $state('');

  // 'custom' is a rule set outside the curated set — named, never re-picked.
  const current = $derived(choice ?? (series === null ? 'none' : (series.preset ?? 'custom')));
  const stopping = $derived(current === 'none' && series !== null);
  // A preset picked for a card that does not repeat yet. Nothing is sent while
  // this holds: the start date below is part of the create, and issuing the POST
  // on the select's change would fix it at today before the field is even shown.
  const starting = $derived(series === null && current !== 'none');
  const anchor = $derived(series?.start_date ?? startDate);

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

  async function run(action: () => Promise<void>): Promise<boolean> {
    busy = true;
    error = '';
    try {
      await action();
      choice = null;
      return true;
    } catch (err) {
      error = apiMessage(err, 'Could not save that. Try again.');
      return false;
    } finally {
      busy = false;
    }
  }

  function name(row: TaskSeries): void {
    board.setTaskSeriesRef(taskId, {
      id: row.id,
      summary: row.summary,
      preset: row.preset,
      start_date: row.start_date,
    });
  }

  async function choose(value: string): Promise<void> {
    choice = value;
    error = '';
    // A card that does not repeat yet waits for the start date; one that already
    // repeats has a start date already and is only changing the rule.
    if (series === null || value === 'none' || value === 'custom') {
      return;
    }
    const preset = value as RecurrencePreset;
    const saved = await run(async () => {
      name(await taskSeries.patch(series.id, { preset }));
    });
    if (!saved) {
      // Back to the rule the card still has: leaving the failed preset selected
      // makes it unpickable, since re-selecting the shown value fires no change.
      choice = null;
    }
  }

  function start(): void {
    const preset = RECURRENCE_PRESETS.find((option) => option === choice);
    if (preset === undefined || !isCalendarDate(startDate)) {
      return;
    }
    void run(async () => {
      name(
        await taskSeries.createFromTask(taskId, {
          id: newId(),
          preset,
          start_date: startDate,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      );
    });
  }

  function stop(): void {
    const id = series?.id;
    if (id === undefined) return;
    void run(async () => {
      // remove() reports its failure with a toast rather than throwing, so its
      // answer is what says whether the series is gone. Clearing the card
      // regardless would name no recurrence on a card that still has one.
      if (await taskSeries.remove(id)) {
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
        class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm focus-ring focus:border-accent"
      />
      {#if due !== null}
        <button
          type="button"
          onclick={remove}
          class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-danger focus-ring-flush"
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
      disabled={busy}
      onchange={(event) => void choose(event.currentTarget.value)}
      class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm disabled:opacity-60"
    >
      <option value="none">Doesn't repeat</option>
      {#if current === 'custom'}
        <!-- A rule from outside the curated set. Offered as the current value so
             the menu can say what it is, and disabled so it cannot be re-picked. -->
        <option value="custom" disabled>{series?.summary ?? 'Custom'}</option>
      {/if}
      {#each RECURRENCE_PRESETS as option (option)}
        <option value={option}>{presetLabel(option, anchor)}</option>
      {/each}
    </select>

    {#if starting}
      <label for="{uid}-start" class="mt-2 text-sm font-medium">Starts on</label>
      <input
        id="{uid}-start"
        type="date"
        bind:value={startDate}
        class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm focus-ring focus:border-accent"
      />
      <div class="mt-2 flex flex-wrap gap-2">
        <Button disabled={busy || !isCalendarDate(startDate)} onclick={start}
          >Start repeating</Button
        >
        <Button variant="secondary" disabled={busy} onclick={() => (choice = null)}>Cancel</Button>
      </div>
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
  {:else if series !== null}
    <p class="text-sm text-muted">
      A new card appears when its turn comes round. Cards already created stay as they are, and
      editing this one does not change what repeats.
    </p>
  {/if}

  {#if error !== ''}
    <p role="alert" class="text-sm text-danger">{error}</p>
  {/if}
</div>
