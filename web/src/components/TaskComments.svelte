<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { board, type CommentBody, type TaskComment } from '../lib/board.svelte';
  import { formatTimestamp } from '../lib/dates';
  import { docDraftKey, drafts } from '../lib/drafts.svelte';
  import { focusRemainsInside } from '../lib/actions';
  import { currentProjectMentionCandidates } from '../lib/mentions';
  import { session } from '../lib/session.svelte';
  import { displayName, users } from '../lib/users.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Button from './ui/Button.svelte';
  import Spinner from './ui/Spinner.svelte';

  interface Props {
    taskId: string;
    // Not the same as read-only: a viewer may still write, edit and delete their
    // own comments, and an anonymous reader has no identity to attribute one to.
    anonymous?: boolean;
  }

  let { taskId, anonymous = false }: Props = $props();

  const mentionUsers = $derived(currentProjectMentionCandidates());
  const commentCount = $derived(board.tasks.find((t) => t.id === taskId)?.comment_count ?? 0);
  const comments = $derived(board.taskComments[taskId]);
  const items = $derived(
    [...(comments ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))
  );
  const loading = $derived(comments === undefined && commentCount > 0);

  let composer = $state<ReturnType<typeof RichTextEditor>>();
  let composerFocused = $state(false);
  let editing = $state<ReturnType<typeof RichTextEditor>>();
  let editingId = $state<string | null>(null);
  let editDoc = $state<CommentBody | null>(null);
  let confirmingDeleteId = $state<string | null>(null);

  // The store outlives the closed overlay and is keyed by task, so a draft can
  // neither be lost by looking something up nor resurface on another card.
  const draftKeyForTask = $derived(docDraftKey.taskComment(taskId));
  const draftDoc = $derived(drafts.getDoc(draftKeyForTask));

  // Focused-but-empty still shows the button, disabled: that is where posting
  // happens once there is something to post. A draft keeps it up after a click
  // elsewhere, so half-written text never loses its way to send.
  const composerActive = $derived(composerFocused || draftDoc !== null);

  // Test seams; see RichTextEditor's getEditor.
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
    composerFocused = false;
    confirmingDeleteId = null;
  });

  function submit(): void {
    const doc = draftDoc;
    if (doc === null) return;
    // clearContent reports null through onChange, which drops the stored draft.
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
</script>

{#if loading && items.length === 0}
  <Spinner size="sm" label="Loading comments" />
{:else if items.length === 0}
  <p class="text-sm text-muted">No comments yet.</p>
{:else}
  <ul class="flex flex-col gap-4">
    {#each items as comment (comment.id)}
      {@const author = users.displayFor(comment.user_id)}
      {@const authorName = displayName(author)}
      {@const written = formatTimestamp(comment.created_at)}
      <li class="flex gap-2">
        <Avatar name={authorName} src={author.avatar_url} size="sm" labelled />
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
              compact
              {mentionUsers}
            />
            <!-- Unconditional, unlike the composer's: a mode the user opened on
                 purpose has to keep offering the way out of it. -->
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
      onfocusin={() => (composerFocused = true)}
      onfocusout={(event) => (composerFocused = focusRemainsInside(event))}
    >
      <RichTextEditor
        bind:this={composer}
        content={draftDoc}
        onChange={(doc) =>
          doc === null ? drafts.clearDoc(draftKeyForTask) : drafts.setDoc(draftKeyForTask, doc)}
        placeholder="Write a comment…"
        compact
        {mentionUsers}
      />
      {#if composerActive}
        <div class="flex">
          <Button disabled={draftDoc === null} onclick={submit}>Comment</Button>
        </div>
      {/if}
    </div>
  {/key}
{/if}
