<script lang="ts">
  import { untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import { formatDue, formatFullDate, isCalendarDate, todayISO } from '../lib/dates';
  import { taskSeries, type TaskSeries } from '../lib/taskSeries.svelte';
  import { displayName, users } from '../lib/users.svelte';
  import TaskSeriesEditor from './TaskSeriesEditor.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import ColorDot from './ui/ColorDot.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    projectId: string;
    onclose: () => void;
  }

  let { projectId, onclose }: Props = $props();

  let editingId = $state<string | null>(null);
  let creating = $state(false);
  let confirmingDeleteId = $state<string | null>(null);

  // The store is a singleton that still holds the previous project's series
  // until this project's load lands, so nothing paints until it has.
  const scoped = $derived(taskSeries.currentProjectId === projectId);
  const rows = $derived(scoped && taskSeries.loaded ? taskSeries.list : null);
  const loadError = $derived(scoped ? taskSeries.loadError : null);
  // Held by id, not by value, so a teammate deleting the series under an open
  // form is something this can say rather than something Save discovers.
  const editing = $derived(
    editingId === null ? null : (rows?.find((row) => row.id === editingId) ?? null)
  );
  // Only a list we actually hold can testify that the row is gone; without one
  // the panel is loading, not bereaved.
  const editingVanished = $derived(editingId !== null && rows !== null && editing === null);
  const columnNames = $derived(new Map(board.columns.map((column) => [column.id, column.name])));
  const labelById = $derived(new Map(board.labels.map((label) => [label.id, label])));

  $effect(() => {
    const id = projectId;
    untrack(() => void taskSeries.load(id));
  });

  function nextCard(series: TaskSeries): string {
    // A paused series keeps the date it was going to fire on, which would read
    // as a promise the pause has already broken.
    if (series.status !== 'active' || !isCalendarDate(series.next_occurrence_date)) return '—';
    const today = todayISO();
    return `${formatDue(series.next_occurrence_date, today)} (${formatFullDate(series.next_occurrence_date)})`;
  }

  // A series belongs to the project and survives the account that set it up.
  function setUpBy(series: TaskSeries): string {
    if (series.created_by === null) return 'Set up by a deleted account';
    return `Set up by ${displayName(users.displayFor(series.created_by))}`;
  }

  function requestDelete(series: TaskSeries): void {
    if (confirmingDeleteId !== series.id) {
      confirmingDeleteId = series.id;
      return;
    }
    confirmingDeleteId = null;
    void taskSeries.remove(series.id);
  }

  function closeEditor(): void {
    editingId = null;
    creating = false;
  }
</script>

<Modal open title="Recurring cards" {onclose}>
  <div class="flex flex-col gap-5">
    {#if editingVanished}
      <div class="flex flex-col items-start gap-3">
        <p role="alert" class="text-sm text-danger">
          This recurring card was deleted while you were editing it.
        </p>
        <Button variant="secondary" onclick={closeEditor}>Back to the list</Button>
      </div>
    {:else if creating || editing !== null}
      <TaskSeriesEditor
        {projectId}
        series={editing ?? undefined}
        onsaved={closeEditor}
        oncancel={closeEditor}
      />
    {:else}
      <p class="text-sm text-muted">
        A recurring card is created when its turn comes round, not before. Cards already created
        stay as they are.
      </p>

      {#if rows === null}
        {#if loadError !== null}
          <div class="flex flex-col items-start gap-3">
            <p role="alert" class="text-sm text-danger">{loadError}</p>
            <Button variant="secondary" onclick={() => void taskSeries.load(projectId)}>
              Try again
            </Button>
          </div>
        {:else}
          <p class="text-sm text-muted">Loading recurring cards…</p>
        {/if}
      {:else if rows.length === 0}
        <p class="text-sm text-muted">No recurring cards yet.</p>
      {:else}
        <ul class="flex max-h-[50vh] flex-col divide-y divide-edge overflow-y-auto">
          {#each rows as series (series.id)}
            <li class="flex flex-col gap-2 py-3">
              <div class="flex flex-wrap items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-medium">{series.title}</span>
                {#if series.status === 'paused'}
                  <Badge>Paused</Badge>
                {:else if series.status === 'ended'}
                  <Badge>Finished</Badge>
                {/if}
              </div>

              <p class="text-sm text-muted">{series.summary}</p>
              <p class="text-sm text-muted">Next card: {nextCard(series)}</p>
              <p class="text-sm text-muted">{setUpBy(series)}</p>
              <p class="text-sm text-muted">
                {#if series.column_id === null}
                  Choose a destination column
                {:else}
                  Lands in {columnNames.get(series.column_id) ?? 'a deleted column'}
                {/if}
              </p>

              {#if series.label_ids.length > 0 || series.assignee_ids.length > 0}
                <div class="flex flex-wrap items-center gap-2">
                  {#each series.label_ids as labelId (labelId)}
                    {@const label = labelById.get(labelId)}
                    {#if label !== undefined}
                      <span
                        class="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-muted"
                      >
                        <ColorDot color={label.color} size="sm" />
                        <span class="max-w-40 truncate">{label.name}</span>
                      </span>
                    {/if}
                  {/each}
                  {#each series.assignee_ids as userId (userId)}
                    {@const person = users.displayFor(userId)}
                    <Avatar name={person.name} src={person.avatar_url} size="sm" />
                  {/each}
                </div>
              {/if}

              {#if series.missed_occurrence_count > 0}
                <div class="flex flex-wrap items-center gap-2">
                  <p role="status" class="text-sm text-warning">
                    {series.missed_occurrence_count} occurrence{series.missed_occurrence_count === 1
                      ? ' was'
                      : 's were'} missed while the scheduler was behind.
                  </p>
                  {#if board.canEdit}
                    <Button
                      variant="secondary"
                      aria-label="Dismiss missed occurrences for {series.title}"
                      onclick={() => void taskSeries.clearMissed(series.id)}
                    >
                      Dismiss
                    </Button>
                  {/if}
                </div>
              {/if}

              {#if series.open_occurrence_count > 1}
                <p class="text-sm text-muted">
                  {series.open_occurrence_count} cards from this series are still open.
                </p>
              {/if}

              {#if series.last_error !== null}
                <p class="text-sm text-muted">{series.last_error}</p>
              {/if}

              {#if board.canEdit}
                <div class="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    aria-label="{series.status === 'paused' ? 'Resume' : 'Pause'} {series.title}"
                    onclick={() => void taskSeries.setPaused(series.id, series.status !== 'paused')}
                  >
                    {series.status === 'paused' ? 'Resume' : 'Pause'}
                  </Button>
                  <Button
                    variant="secondary"
                    aria-label="Edit {series.title}"
                    onclick={() => (editingId = series.id)}
                  >
                    Edit…
                  </Button>
                  <Button
                    variant="danger"
                    aria-label="{confirmingDeleteId === series.id
                      ? 'Confirm delete of'
                      : 'Delete'} {series.title}"
                    onclick={() => requestDelete(series)}
                  >
                    {confirmingDeleteId === series.id
                      ? 'Confirm — cards already created stay'
                      : 'Delete'}
                  </Button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if board.canEdit && rows !== null}
        <div class="flex flex-wrap gap-2 border-t border-edge pt-4">
          <Button onclick={() => (creating = true)}>New recurring card</Button>
        </div>
      {/if}
    {/if}
  </div>
</Modal>
