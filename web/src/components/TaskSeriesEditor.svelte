<script lang="ts">
  import { untrack } from 'svelte';
  import { apiMessage } from '../lib/apiMessages';
  import { board } from '../lib/board.svelte';
  import { todayISO } from '../lib/dates';
  import { newId } from '../lib/ids';
  import { RECURRENCE_PRESETS, presetLabel, type RecurrencePreset } from '../lib/recurrence';
  import { taskSeries, type TaskSeries } from '../lib/taskSeries.svelte';
  import { users } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Button from './ui/Button.svelte';
  import ColorDot from './ui/ColorDot.svelte';
  import Input from './ui/Input.svelte';
  import RichTextEditor from './RichTextEditor.svelte';

  interface Props {
    projectId: string;
    series?: TaskSeries;
    onsaved: () => void;
    oncancel: () => void;
  }

  let { projectId, series, onsaved, oncancel }: Props = $props();

  type Description = TaskSeries['description'];

  // One instance per series, mounted fresh, so the form owns its fields from
  // here on and a later store refresh must not overwrite what is being typed.
  const initial = untrack(() => series);

  let title = $state(initial?.title ?? '');
  let description = $state<Description>(initial?.description ?? null);
  let columnId = $state(initial?.column_id ?? board.columns[0]?.id ?? '');
  let startDate = $state(initial?.start_date ?? todayISO());
  // Not `?? 'weekly'`: a stored null is a real rule set outside the curated set,
  // and coalescing it would silently replace that rule on the next save.
  let preset = $state<RecurrencePreset | null>(
    initial === undefined ? 'weekly' : (initial.preset as RecurrencePreset | null)
  );
  let dueDate = $state(initial?.due_date ?? '');
  let labelIds = $state<string[]>(initial?.label_ids ?? []);
  let assigneeIds = $state<string[]>(initial?.assignee_ids ?? []);
  let checklistLines = $state<string[]>(initial?.checklist_items.map((item) => item.text) ?? []);
  let newLine = $state('');
  let saving = $state(false);
  let error = $state('');

  const timezone = initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const members = $derived(users.forProject(projectId));

  $effect(() => {
    void users.loadForProject(projectId);
  });

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
  }

  function addLine(): void {
    const trimmed = newLine.trim();
    if (trimmed === '') return;
    checklistLines = [...checklistLines, trimmed];
    newLine = '';
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (title.trim() === '') {
      error = 'Give the card a title';
      return;
    }
    if (columnId === '') {
      error = 'Choose a destination column';
      return;
    }
    saving = true;
    error = '';
    const shared = {
      column_id: columnId,
      title: title.trim(),
      description,
      due_date: dueDate === '' ? null : dueDate,
      start_date: startDate,
      label_ids: labelIds,
      assignee_ids: assigneeIds,
      checklist_items: checklistLines.map((text) => ({ text })),
      // Absent for a rule that arrived outside the curated set, so editing the
      // rest of the template keeps the rule it already has.
      ...(preset === null ? {} : { preset }),
    };
    try {
      if (series === undefined) {
        await taskSeries.create({ id: newId(), project_id: projectId, timezone, ...shared });
      } else {
        await taskSeries.patch(series.id, shared);
      }
      onsaved();
    } catch (err) {
      error = apiMessage(err, 'Could not save that. Try again.');
    } finally {
      saving = false;
    }
  }
</script>

<form class="flex flex-col gap-4" aria-label="Recurring card" novalidate onsubmit={save}>
  <Input label="Title" name="series-title" bind:value={title} />

  <div class="flex flex-col gap-1">
    <span class="text-sm font-medium">Description</span>
    <RichTextEditor
      content={description}
      onChange={(doc) => (description = doc)}
      placeholder="What does this card need?"
    />
  </div>

  <div class="flex flex-col gap-1">
    <label for="series-column" class="text-sm font-medium">Destination column</label>
    <select
      id="series-column"
      bind:value={columnId}
      class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm"
    >
      {#if columnId === ''}
        <option value="">Choose a destination column</option>
      {/if}
      {#each board.columns as column (column.id)}
        <option value={column.id}>{column.name}</option>
      {/each}
    </select>
  </div>

  <Input label="Starts on" name="series-start" type="date" bind:value={startDate} />

  <div class="flex flex-col gap-1">
    <label for="series-preset" class="text-sm font-medium">Repeats</label>
    <select
      id="series-preset"
      bind:value={preset}
      class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm"
    >
      {#if preset === null}
        <option value={null} disabled>Custom</option>
      {/if}
      {#each RECURRENCE_PRESETS as option (option)}
        <option value={option}>{presetLabel(option, startDate)}</option>
      {/each}
    </select>
    {#if preset === null}
      <p class="text-sm text-muted">{series?.summary ?? ''}</p>
      <p class="text-sm text-muted">
        This rule was set outside the app. Choosing a recurrence above replaces it.
      </p>
    {/if}
    <p class="text-sm text-muted">
      Each card appears on the day its turn comes round, at midnight in {timezone}.
    </p>
  </div>

  <div class="flex flex-col gap-1">
    <Input label="Due date (optional)" name="series-due" type="date" bind:value={dueDate} />
    <p class="text-sm text-muted">
      Every card this series creates carries this date. Leave it empty for cards with no due date.
    </p>
  </div>

  {#if board.labels.length > 0}
    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium">Labels</legend>
      <div class="flex flex-wrap gap-2">
        {#each board.labels as label (label.id)}
          <button
            type="button"
            aria-pressed={labelIds.includes(label.id)}
            onclick={() => (labelIds = toggle(labelIds, label.id))}
            class="inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium {labelIds.includes(
              label.id
            )
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-edge bg-surface text-muted'}"
          >
            <ColorDot color={label.color} size="sm" />
            <span class="max-w-40 truncate">{label.name}</span>
          </button>
        {/each}
      </div>
    </fieldset>
  {/if}

  {#if members.length > 0}
    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium">Assignees</legend>
      <div class="flex flex-wrap gap-2">
        {#each members as person (person.id)}
          <button
            type="button"
            aria-pressed={assigneeIds.includes(person.id)}
            onclick={() => (assigneeIds = toggle(assigneeIds, person.id))}
            class="inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-medium {assigneeIds.includes(
              person.id
            )
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-edge bg-surface text-muted'}"
          >
            <Avatar name={person.name} src={person.avatar_url} size="sm" />
            <span class="max-w-40 truncate">{person.name}</span>
          </button>
        {/each}
      </div>
    </fieldset>
  {/if}

  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium">Checklist</span>
    {#if checklistLines.length > 0}
      <ul class="flex flex-col gap-1">
        {#each checklistLines as line, index (index)}
          <li class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-sm">{line}</span>
            <button
              type="button"
              aria-label="Remove {line}"
              onclick={() => (checklistLines = checklistLines.filter((_, i) => i !== index))}
              class="min-h-11 min-w-11 cursor-pointer rounded-md text-sm text-muted hover:text-danger"
            >
              ✕
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="flex flex-wrap items-end gap-2">
      <div class="min-w-40 flex-1">
        <Input
          label="Add an item"
          name="series-checklist-item"
          bind:value={newLine}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addLine();
            }
          }}
        />
      </div>
      <Button variant="secondary" onclick={addLine}>Add</Button>
    </div>
  </div>

  {#if error !== ''}
    <p role="alert" class="text-sm text-danger">{error}</p>
  {/if}

  <div class="flex flex-wrap gap-2">
    <Button type="submit" disabled={saving}>
      {saving ? 'Saving…' : series === undefined ? 'Create recurring card' : 'Save changes'}
    </Button>
    <Button variant="secondary" onclick={oncancel}>Cancel</Button>
  </div>
</form>
