<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { board, type CommentBody, type TaskComment } from '../lib/board.svelte';
  import { session } from '../lib/session.svelte';
  import { users } from '../lib/users.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Button from './ui/Button.svelte';
  import Spinner from './ui/Spinner.svelte';

  interface Props {
    taskId: string;
  }

  let { taskId }: Props = $props();

  const comments = $derived(board.taskComments[taskId]);
  const commentCount = $derived(board.tasks.find((t) => t.id === taskId)?.comment_count ?? 0);

  let composer = $state<ReturnType<typeof RichTextEditor>>();
  let composerDoc = $state<CommentBody | null>(null);
  let editing = $state<ReturnType<typeof RichTextEditor>>();
  let editingId = $state<string | null>(null);
  let editDoc = $state<CommentBody | null>(null);
  let confirmingDeleteId = $state<string | null>(null);

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
</script>

{#if comments === undefined}
  {#if commentCount > 0}
    <Spinner size="sm" label="Loading comments" />
  {/if}
{:else if comments.length === 0}
  <p class="text-sm text-muted">No comments yet.</p>
{:else}
  <ul class="flex flex-col gap-4">
    {#each comments as comment (comment.id)}
      {@const author = users.displayFor(comment.user_id)}
      {@const written = dateFormat.format(new Date(comment.created_at))}
      <li class="flex gap-2">
        <Avatar name={author.name} src={author.avatar_url} size="sm" />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <p class="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
            <span class="font-medium text-ink">{author.name}</span>
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
            {#if comment.user_id === session.user?.id}
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
    />
    <div class="flex">
      <Button disabled={composerDoc === null} onclick={submit}>Comment</Button>
    </div>
  </div>
{/key}
