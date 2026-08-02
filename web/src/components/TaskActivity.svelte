<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { SvelteSet } from 'svelte/reactivity';
  import { board, type CommentBody, type TaskComment } from '../lib/board.svelte';
  import { formatFullDate, isCalendarDate } from '../lib/dates';
  import { currentProjectMentionCandidates } from '../lib/mentions';
  import { session } from '../lib/session.svelte';
  import { taskActivity, type TaskActivityEntry } from '../lib/taskActivity.svelte';
  import { docToMarkdown, isEmptyDoc } from '../lib/tiptap';
  import { truncateTitle } from '../lib/titles';
  import { users, type User } from '../lib/users.svelte';
  import ActivityPreviousValue from './ActivityPreviousValue.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Button from './ui/Button.svelte';
  import ColorDot from './ui/ColorDot.svelte';
  import Spinner from './ui/Spinner.svelte';

  interface Props {
    taskId: string;
    // Not the same as read-only: a viewer may still write, edit and delete their
    // own comments, and an anonymous reader has no identity to attribute one to.
    anonymous?: boolean;
  }

  let { taskId, anonymous = false }: Props = $props();

  type StreamItem =
    | { id: string; at: string; comment: TaskComment; entry?: undefined }
    | { id: string; at: string; entry: TaskActivityEntry; comment?: undefined };

  type PreviousDoc = NonNullable<NonNullable<TaskActivityEntry['old_value']>['doc']>;

  type PreviousValue =
    | { kind: 'doc'; doc: PreviousDoc; summary: string; copyLabel: string }
    | { kind: 'text'; text: string; summary: string; copyLabel: string };

  const comments = $derived(board.taskComments[taskId]);
  const mentionUsers = $derived(currentProjectMentionCandidates());
  const commentCount = $derived(board.tasks.find((t) => t.id === taskId)?.comment_count ?? 0);

  const history: TaskActivityEntry[] = $derived(anonymous ? [] : taskActivity.entries);

  const items: StreamItem[] = $derived(
    [
      ...(comments ?? []).map((comment) => ({
        id: `comment-${comment.id}`,
        at: comment.created_at,
        comment,
      })),
      ...history.map((entry) => ({
        id: `activity-${entry.id}`,
        at: entry.created_at,
        entry,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at))
  );

  const loading = $derived(
    (comments === undefined && commentCount > 0) ||
      (!anonymous && taskActivity.loading && taskActivity.entries.length === 0)
  );

  let composer = $state<ReturnType<typeof RichTextEditor>>();
  let composerDoc = $state<CommentBody | null>(null);
  let editing = $state<ReturnType<typeof RichTextEditor>>();
  let editingId = $state<string | null>(null);
  let editDoc = $state<CommentBody | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  const expanded = new SvelteSet<string>();

  // Test seams: there is no way to type into a ProseMirror contenteditable under jsdom.
  export function getComposerEditor(): Editor | null {
    return composer?.getEditor() ?? null;
  }

  export function getEditingEditor(): Editor | null {
    return editing?.getEditor() ?? null;
  }

  $effect(() => {
    void taskId;
    editingId = null;
    editDoc = null;
    composerDoc = null;
    confirmingDeleteId = null;
    expanded.clear();
  });

  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  function submit(): void {
    const doc = composerDoc;
    if (doc === null) return;
    composer?.getEditor()?.commands.clearContent(true);
    void board.createComment(taskId, doc);
  }

  function startEdit(comment: TaskComment): void {
    editingId = comment.id;
    editDoc = null;
    confirmingDeleteId = null;
  }

  function cancelEdit(): void {
    editingId = null;
    editDoc = null;
  }

  // The editor stays mounted until the server has the new body: closing it first
  // would hand the user's rewrite to the failure path's resync.
  async function saveEdit(commentId: string): Promise<void> {
    const doc = editDoc;
    if (doc === null) return;
    const saved = await board.updateComment(taskId, commentId, doc);
    if (saved && editingId === commentId) {
      cancelEdit();
    }
  }

  function requestDelete(commentId: string): void {
    if (confirmingDeleteId !== commentId) {
      confirmingDeleteId = commentId;
      return;
    }
    confirmingDeleteId = null;
    void board.deleteComment(taskId, commentId);
  }

  function labelColor(labelId: string | undefined): string | undefined {
    return board.labels.find((label) => label.id === labelId)?.color;
  }

  // Whatever the log recorded is rendered verbatim unless it is a calendar day:
  // formatFullDate throws on anything else.
  function dueText(value: TaskActivityEntry['new_value']): string {
    const text = value?.text;
    return isCalendarDate(text) ? formatFullDate(text) : (text ?? '');
  }

  // The log outlives project membership, so it names people this client cannot
  // look up, and a nameless placeholder renders as a blank byline.
  function nameOf(user: User): string {
    return user.name === '' ? 'Unknown user' : user.name;
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

{#if taskActivity.error && !anonymous}
  <p class="text-sm text-muted">The history of this task could not be loaded.</p>
{/if}

{#if loading && items.length === 0}
  <Spinner size="sm" label={anonymous ? 'Loading comments' : 'Loading activity'} />
{:else if items.length === 0 && (anonymous || !taskActivity.error)}
  <p class="text-sm text-muted">{anonymous ? 'No comments yet.' : 'No activity yet.'}</p>
{:else if items.length > 0}
  <ul class="flex flex-col gap-4">
    {#each items as item (item.id)}
      {#if item.comment !== undefined}
        {@const comment = item.comment}
        {@const author = users.displayFor(comment.user_id)}
        {@const authorName = nameOf(author)}
        {@const written = dateFormat.format(new Date(comment.created_at))}
        <li class="flex gap-2">
          <Avatar name={authorName} src={author.avatar_url} size="sm" />
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <p class="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
              <span class="font-medium text-ink">{authorName}</span>
              <span>{written}</span>
              {#if comment.updated_at !== comment.created_at}
                <span>(edited)</span>
              {/if}
            </p>
            {#if editingId === comment.id}
              <RichTextEditor
                bind:this={editing}
                content={comment.body}
                onChange={(doc) => (editDoc = doc)}
                placeholder="Write a comment…"
                {mentionUsers}
              />
              <div class="flex gap-2">
                <Button disabled={editDoc === null} onclick={() => void saveEdit(comment.id)}>
                  Save
                </Button>
                <Button variant="secondary" onclick={cancelEdit}>Cancel</Button>
              </div>
            {:else}
              <!-- Keyed on the body: the editor reads `content` only at construction,
                   so an incoming edit needs a fresh instance to render. -->
              {#key comment.body}
                <RichTextEditor content={comment.body} readonly bare />
              {/key}
              {#if !anonymous && comment.user_id === session.user?.id}
                <div class="flex gap-2">
                  <Button
                    variant="ghost"
                    aria-label="Edit comment from {written}"
                    onclick={() => startEdit(comment)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={confirmingDeleteId === comment.id
                      ? `Confirm delete of comment from ${written}`
                      : `Delete comment from ${written}`}
                    onclick={() => requestDelete(comment.id)}
                  >
                    {confirmingDeleteId === comment.id ? 'Confirm delete' : 'Delete'}
                  </Button>
                </div>
              {/if}
            {/if}
          </div>
        </li>
      {:else if item.entry !== undefined}
        {@const entry = item.entry}
        {@const actor = users.displayFor(entry.actor_user_id)}
        {@const actorName = nameOf(actor)}
        {@const from = entry.old_value}
        {@const to = entry.new_value}
        {@const previous = previousValue(entry)}
        <li class="flex gap-2">
          <Avatar name={actorName} src={actor.avatar_url} size="sm" />
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <p class="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
              <span class="font-medium text-ink">{actorName}</span>
              <span>{dateFormat.format(new Date(entry.created_at))}</span>
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
      {/if}
    {/each}
  </ul>
{/if}

{#if !anonymous}
  <!-- Keyed so switching tasks in the open overlay starts a fresh composer instead of
       carrying half-written text onto someone else's card. -->
  {#key taskId}
    <div
      class="flex flex-col gap-2"
      onkeydowncapture={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <RichTextEditor
        bind:this={composer}
        content={null}
        onChange={(doc) => (composerDoc = doc)}
        placeholder="Write a comment…"
        {mentionUsers}
      />
      <div class="flex">
        <Button disabled={composerDoc === null} onclick={submit}>Comment</Button>
      </div>
    </div>
  {/key}
{/if}
