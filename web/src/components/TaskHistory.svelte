<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { board } from '../lib/board.svelte';
  import { formatFullDate, formatTimestamp, isCalendarDate } from '../lib/dates';
  import { taskActivity, type TaskActivityEntry } from '../lib/taskActivity.svelte';
  import { docToMarkdown, isEmptyDoc } from '../lib/tiptap';
  import { truncateTitle } from '../lib/titles';
  import { displayName, users } from '../lib/users.svelte';
  import ActivityPreviousValue from './ActivityPreviousValue.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import Avatar from './ui/Avatar.svelte';
  import ColorDot from './ui/ColorDot.svelte';
  import Spinner from './ui/Spinner.svelte';

  interface Props {
    taskId: string;
  }

  let { taskId }: Props = $props();

  type PreviousDoc = NonNullable<NonNullable<TaskActivityEntry['old_value']>['doc']>;

  type PreviousValue =
    | { kind: 'doc'; doc: PreviousDoc; summary: string; copyLabel: string }
    | { kind: 'text'; text: string; summary: string; copyLabel: string };

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const entries = $derived(taskActivity.entries);
  const loading = $derived(taskActivity.loading && entries.length === 0);

  const expanded = new SvelteSet<string>();

  $effect(() => {
    void taskId;
    expanded.clear();
  });

  function labelColor(labelId: string | undefined): string | undefined {
    return board.labels.find((label) => label.id === labelId)?.color;
  }

  // Whatever the log recorded is rendered verbatim unless it is a calendar day:
  // formatFullDate throws on anything else.
  function dueText(value: TaskActivityEntry['new_value']): string {
    const text = value?.text;
    return isCalendarDate(text) ? formatFullDate(text) : (text ?? '');
  }

  function toggleExpanded(id: string): void {
    if (expanded.has(id)) {
      expanded.delete(id);
    } else {
      expanded.add(id);
    }
  }

  // A rename whose old title the line above already shows whole would disclose
  // nothing, so only one the display limit cut earns the affordance.
  function previousValue(entry: TaskActivityEntry): PreviousValue | null {
    const from = entry.old_value;
    if (entry.kind === 'description_changed') {
      const doc = from?.doc;
      return doc == null || isEmptyDoc(doc)
        ? null
        : {
            kind: 'doc',
            doc,
            summary: 'Show the previous description',
            copyLabel: 'Copy as Markdown',
          };
    }
    if (entry.kind === 'title_changed') {
      const text = from?.text ?? '';
      return truncateTitle(text) === text
        ? null
        : { kind: 'text', text, summary: 'Show the previous title in full', copyLabel: 'Copy' };
    }
    return null;
  }
</script>

{#if taskActivity.error}
  <p class="text-sm text-muted">The history of this task could not be loaded.</p>
{/if}

<!-- A failed refresh keeps whatever was already loaded on screen, so the notice
     above is its own block rather than a branch that would replace the log. -->
{#if loading}
  <Spinner size="sm" label="Loading activity" />
{:else if entries.length === 0 && !taskActivity.error}
  <p class="text-sm text-muted">No activity yet.</p>
{:else if entries.length > 0}
  <ul class="flex flex-col gap-4">
    {#each entries as entry (entry.id)}
      {@const actor = users.displayFor(entry.actor_user_id)}
      {@const actorName = displayName(actor)}
      {@const from = entry.old_value}
      {@const to = entry.new_value}
      {@const previous = previousValue(entry)}
      <li class="flex gap-2">
        <Avatar name={actorName} src={actor.avatar_url} size="sm" labelled />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <p class="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
            <span class="font-medium text-ink">{actorName}</span>
            <span>{formatTimestamp(entry.created_at)}</span>
          </p>
          <p class="flex flex-wrap items-center gap-x-1 text-sm text-muted">
            {#if entry.kind === 'created'}
              created this task
            {:else if entry.kind === 'title_changed'}
              renamed this from
              <span class="text-ink">“{truncateTitle(from?.text ?? '')}”</span>
              to <span class="text-ink">“{truncateTitle(to?.text ?? '')}”</span>
            {:else if entry.kind === 'description_changed'}
              edited the description
            {:else if entry.kind === 'column_changed'}
              moved this from <span class="text-ink">{from?.name ?? ''}</span> to
              <span class="text-ink">{to?.name ?? ''}</span>
            {:else if entry.kind === 'due_date_changed'}
              {#if to?.text === undefined}
                cleared the due date
              {:else if from?.text === undefined}
                set the due date to <span class="text-ink">{dueText(to)}</span>
              {:else}
                moved the due date from
                <span class="text-ink">{dueText(from)}</span>
                to <span class="text-ink">{dueText(to)}</span>
              {/if}
            {:else if entry.kind === 'label_added' || entry.kind === 'label_removed'}
              {@const label = entry.kind === 'label_added' ? to : from}
              {@const color = labelColor(label?.id)}
              {entry.kind === 'label_added' ? 'added the label' : 'removed the label'}
              {#if color !== undefined}
                <ColorDot {color} size="sm" />
              {/if}
              <span class="text-ink">{label?.name ?? ''}</span>
            {:else if entry.kind === 'assignee_added'}
              assigned <span class="text-ink">{to?.name ?? ''}</span>
            {:else if entry.kind === 'assignee_removed'}
              unassigned <span class="text-ink">{from?.name ?? ''}</span>
            {:else if entry.kind === 'blocker_added'}
              added <span class="text-ink">{to?.name ?? ''}</span> as a blocker
            {:else if entry.kind === 'blocker_removed'}
              removed <span class="text-ink">{from?.name ?? ''}</span> as a blocker
            {:else if entry.kind === 'archived'}
              archived this task
            {:else if entry.kind === 'restored'}
              restored this task
            {:else if entry.kind === 'checklist_item_added'}
              added <span class="text-ink">“{truncateTitle(to?.text ?? '')}”</span> to the checklist
            {:else if entry.kind === 'checklist_item_checked'}
              ticked <span class="text-ink">“{truncateTitle(to?.text ?? '')}”</span>
            {:else if entry.kind === 'checklist_item_unchecked'}
              unticked <span class="text-ink">“{truncateTitle(to?.text ?? '')}”</span>
            {:else if entry.kind === 'checklist_item_renamed'}
              renamed the checklist item
              <span class="text-ink">“{truncateTitle(from?.text ?? '')}”</span>
              to <span class="text-ink">“{truncateTitle(to?.text ?? '')}”</span>
            {:else if entry.kind === 'checklist_item_removed'}
              removed <span class="text-ink">“{truncateTitle(from?.text ?? '')}”</span> from the checklist
            {:else if entry.kind === 'checklist_item_promoted'}
              turned <span class="text-ink">“{truncateTitle(from?.text ?? '')}”</span> into the card
              <span class="text-ink">{truncateTitle(to?.name ?? '')}</span>
            {:else}
              <!-- Unreachable per the generated union, but a client left on the previous
                   bundle by a rolling deploy is handed kinds that union does not list. -->
              updated this task
            {/if}
          </p>
          {#if previous !== null}
            <ActivityPreviousValue
              summary={previous.summary}
              copyLabel={previous.copyLabel}
              copyText={() =>
                previous.kind === 'doc' ? docToMarkdown(previous.doc) : previous.text}
              open={expanded.has(entry.id)}
              ontoggle={() => toggleExpanded(entry.id)}
            >
              {#if previous.kind === 'doc'}
                <RichTextEditor content={previous.doc} readonly bare />
              {:else}
                <p class="break-words whitespace-pre-wrap">{previous.text}</p>
              {/if}
            </ActivityPreviousValue>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}

{#if task !== undefined}
  <p class="text-xs text-muted">
    Created {formatTimestamp(task.created_at)} · Updated {formatTimestamp(task.updated_at)}
  </p>
{/if}
