<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import type { BoardTask } from '../lib/board-types';
  import { formatFullDate, isCalendarDate } from '../lib/dates';
  import { currentProjectMentionCandidates } from '../lib/mentions';
  import { router } from '../lib/router.svelte';
  import { taskActivity } from '../lib/taskActivity.svelte';
  import { TASK_TITLE_MAX_LENGTH, truncateTitle } from '../lib/titles';
  import RichTextEditor, { type SaveState } from './RichTextEditor.svelte';
  import TaskAssignees from './TaskAssignees.svelte';
  import TaskAttachments from './TaskAttachments.svelte';
  import TaskChecklist from './TaskChecklist.svelte';
  import TaskComments, { type CommentDraft } from './TaskComments.svelte';
  import TaskDependencies from './TaskDependencies.svelte';
  import TaskHistory from './TaskHistory.svelte';
  import TaskLabels from './TaskLabels.svelte';
  import TaskQuickActions from './TaskQuickActions.svelte';
  import Announcer from './ui/Announcer.svelte';
  import Button from './ui/Button.svelte';

  type TiptapDoc = NonNullable<BoardTask['description']>;

  interface Props {
    taskId: string;
    closePath: string;
    // Built by the route, which is the only place that knows the view, the active
    // filters and the return marker the overlay's URL has to carry.
    taskPath: (id: string) => string;
    readonly?: boolean;
  }

  let { taskId, closePath, taskPath, readonly = false }: Props = $props();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const columnName = $derived(board.columns.find((c) => c.id === task?.column_id)?.name ?? '');
  const seriesSummary = $derived(board.taskSeriesSummaries[taskId] ?? null);
  const mentionUsers = $derived(currentProjectMentionCandidates());
  // A viewer is read-only but still has an identity, so they keep the comment
  // stream, the history and the timestamps; a public reader has none of that and
  // is served a payload whose identity and timestamp fields are placeholders.
  const anonymous = $derived(board.readonly);

  let dialog = $state<HTMLDialogElement>();
  let removing = $state(false);
  let duplicating = $state(false);
  let closed = $state(false);

  // Deliberately local, unlike the compose drafts: this shadows a server-owned
  // value, so surviving an unmount would mean committing an abandoned edit later
  // — possibly over a rename the user never saw.
  let titleDraft = $state<string | null>(null);

  // The version the editor was populated from, advanced only by this overlay's own
  // successful writes — adopting a teammate's incoming version would let the next
  // save silently overwrite it.
  let baseUpdatedAt = $state<string | null>(null);
  // The title that version carries. task.title is overwritten optimistically the
  // moment a save starts, so it cannot tell an unchanged title from an unsaved one.
  let baseTitle = $state<string | null>(null);
  let conflicted = $state(false);
  let editorRef = $state<ReturnType<typeof RichTextEditor>>();
  let pendingWrite: Promise<unknown> = Promise.resolve();

  let descriptionSaveState = $state<SaveState>('idle');
  // A checklist or an attachment list with nothing in it has nothing to show, so
  // the quick bar asks for one and the section stays until the card is closed.
  // Neither ever hides something the card actually holds.
  let checklistRevealed = $state(false);
  let attachmentsRevealed = $state(false);
  let commentsOpen = $state(false);
  let historyOpen = $state(false);
  // Owned here rather than in TaskComments, which collapsing unmounts. Local like
  // the title draft and unlike the compose drafts: it belongs to this card, and
  // an unsent comment should not resurface on the next one.
  let commentDraft = $state<CommentDraft | null>(null);
  let quickActions = $state<ReturnType<typeof TaskQuickActions>>();
  let checklistRef = $state<ReturnType<typeof TaskChecklist>>();
  let attachmentsRef = $state<ReturnType<typeof TaskAttachments>>();

  const showChecklist = $derived(checklistRevealed || (task?.checklist_item_count ?? 0) > 0);
  const showAttachments = $derived(attachmentsRevealed || (task?.attachment_count ?? 0) > 0);

  async function reveal(section: 'checklist' | 'attachments'): Promise<void> {
    if (section === 'checklist') {
      checklistRevealed = true;
      await tick();
      checklistRef?.focusAddItem();
      return;
    }
    attachmentsRevealed = true;
    await tick();
  }

  async function attach(how: 'file' | 'link'): Promise<void> {
    attachmentsRevealed = true;
    await tick();
    if (how === 'file') {
      attachmentsRef?.pickFile();
    } else {
      attachmentsRef?.openLinkForm();
    }
  }

  $effect(() => {
    const id = taskId;
    const authed = !anonymous;
    untrack(() => {
      titleDraft = null;
      removing = false;
      duplicating = false;
      closed = false;
      baseUpdatedAt = null;
      baseTitle = null;
      conflicted = false;
      pendingWrite = Promise.resolve();
      descriptionSaveState = 'idle';
      checklistRevealed = false;
      attachmentsRevealed = false;
      commentsOpen = false;
      historyOpen = false;
      commentDraft = null;
      if (authed) {
        board.clearChanged(id);
        void board.loadTaskDetail(id);
      }
    });
  });

  // Deferred, unlike the detail fetch: History opens collapsed and nothing else
  // reads the log, so an unopened one would spend a request per card.
  $effect(() => {
    if (historyOpen && !anonymous) {
      void taskActivity.load(taskId);
    }
  });

  // Must stay below the reset effect: effects run in declaration order, so capturing
  // first would only be undone by the reset.
  $effect(() => {
    const loaded = task;
    untrack(() => {
      if (baseUpdatedAt === null && loaded !== undefined) {
        baseUpdatedAt = loaded.updated_at;
        baseTitle = loaded.title;
      }
    });
  });

  // Cleared on unmount so a reopened overlay never flashes another card's history
  // and no background mutation keeps refetching for a closed dialog. `closed` is
  // set here too because most dismissals never reach close(): Back, a sidebar link
  // and the auth redirect all just unmount the dialog.
  $effect(() => () => {
    closed = true;
    taskActivity.reset();
  });

  // The title and the description share one queue: overlapping writes would carry
  // the same baseline and the second would conflict against the first.
  function queueWrite<T>(run: () => Promise<T>): Promise<T> {
    const next = pendingWrite.then(run);
    pendingWrite = next.catch(() => undefined);
    return next;
  }

  $effect(() => {
    if (dialog && !dialog.open) {
      // jsdom has no showModal; fall back to the open attribute there.
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.open = true;
      }
    }
  });

  // replaceState so Back skips the closed overlay instead of re-opening it.
  function close(): void {
    closed = true;
    router.redirect(closePath);
  }

  // Clears the draft only once the server has the new title: a conflict refetches the
  // old one, and dropping the draft first would take the user's typing with it. The
  // unchanged-title check belongs inside the queue too, since a save already queued
  // ahead of this one still moves what the server holds.
  function commitTitle(): void {
    const draft = titleDraft;
    if (draft === null || task === undefined) return;
    const trimmed = draft.trim();
    if (trimmed === '') {
      titleDraft = null;
      return;
    }
    const id = taskId;
    void queueWrite(async () => {
      if (conflicted || id !== taskId) return;
      if (trimmed !== baseTitle) {
        const outcome = await board.updateTask(id, { title: trimmed }, baseUpdatedAt ?? undefined);
        if (outcome.status === 'conflict') {
          conflicted = true;
          return;
        }
        if (outcome.status === 'error') return;
        baseUpdatedAt = outcome.updated_at;
        baseTitle = trimmed;
      }
      if (titleDraft === draft) {
        titleDraft = null;
      }
    });
  }

  function saveDescription(doc: TiptapDoc | null): Promise<boolean> {
    // The editor flushes pending saves on teardown; skip that doomed PATCH once the
    // card is on its way off the board so it cannot 404 (or resurrect it on refetch).
    if (removing) return Promise.resolve(true);
    const id = taskId;
    return queueWrite(async () => {
      // Re-checked here because the queue can hold this past a delete, a conflict or
      // an in-place task change.
      if (conflicted || removing || id !== taskId) return true;
      const outcome = await board.updateTask(id, { description: doc }, baseUpdatedAt ?? undefined);
      if (outcome.status === 'ok') {
        baseUpdatedAt = outcome.updated_at;
        return true;
      }
      // Reporting a conflict as a failed save would make the editor retry it on the
      // next keystroke, against a baseline that can only fail again.
      if (outcome.status === 'conflict') {
        conflicted = true;
        return true;
      }
      return false;
    });
  }

  function reloadFromServer(): void {
    if (task === undefined) return;
    titleDraft = null;
    baseUpdatedAt = task.updated_at;
    baseTitle = task.title;
    conflicted = false;
    editorRef?.replaceContent(task.description);
  }

  // Pasting into the editor goes through the one upload path too; what comes
  // back is an image only if the bytes were one, and its url is what the
  // document embeds.
  async function uploadImage(file: File): Promise<string | null> {
    const uploaded = await board.uploadTaskAttachment(taskId, file);
    return uploaded?.image_url ?? null;
  }

  // Queued behind the title and description writes, so the server copies the text the
  // user just typed rather than whatever an in-flight PATCH is about to replace.
  // navigate, not redirect, so Back returns to the original card.
  async function handleDuplicate(): Promise<void> {
    duplicating = true;
    const source = taskId;
    try {
      const id = await queueWrite(() => board.duplicateTask(source));
      // `closed` alone would miss every dismissal that does not run close() — Back,
      // the auth redirect — and taskId can also change under a mounted overlay.
      if (id !== null && !closed && source === taskId) {
        router.navigate(taskPath(id));
      }
    } finally {
      duplicating = false;
    }
  }

  // No confirm step: archiving is reversible, and it is the only way off the
  // board — deleting a card is reached from the archive, behind its own confirm.
  async function handleArchive(): Promise<void> {
    removing = true;
    await board.archiveTask(taskId);
    close();
  }
</script>

<dialog
  bind:this={dialog}
  aria-label={task === undefined ? 'Task not found' : truncateTitle(task.title)}
  class="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-surface p-0 text-ink backdrop:bg-black/50 lg:m-auto lg:h-fit lg:max-h-[90dvh] lg:w-full lg:max-w-2xl lg:rounded-lg lg:border lg:border-edge lg:shadow-xl"
  oncancel={(event) => {
    event.preventDefault();
    // Escape discards the title edit, matching the inline column rename.
    titleDraft = null;
    close();
  }}
  onclick={(event) => {
    // A click that lands on the backdrop while a quick-action panel is up is
    // dismissing the panel, not the card.
    if (event.target === dialog && quickActions?.isOpen() !== true) close();
  }}
>
  <div class="flex flex-col gap-6 p-4 lg:p-6">
    {#if task === undefined}
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">Task not found</h2>
        <Button variant="ghost" aria-label="Close" onclick={close}>✕</Button>
      </div>
      <p class="text-sm text-muted">This task may have been deleted.</p>
    {:else}
      <div class="flex items-start gap-2">
        {#if readonly}
          <h2 class="min-h-11 min-w-0 flex-1 px-2 text-lg font-semibold break-words">
            {task.title}
          </h2>
        {:else}
          <input
            value={titleDraft ?? task.title}
            maxlength={TASK_TITLE_MAX_LENGTH}
            aria-label="Task title"
            autocapitalize="sentences"
            oninput={(event) => (titleDraft = event.currentTarget.value)}
            onblur={commitTitle}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            class="min-h-11 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-lg font-semibold outline-none hover:border-edge focus:border-accent focus:bg-canvas"
          />
        {/if}
        <Button variant="ghost" aria-label="Close" onclick={close}>✕</Button>
      </div>

      {#if readonly || seriesSummary !== null}
        <div class="flex flex-wrap items-center gap-2">
          <!-- The quick bar's own button carries the column for anyone who can move
               the card; a reader has no bar, and still needs to know where it sits. -->
          {#if readonly}
            <p
              class="w-fit max-w-full rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-muted"
            >
              {columnName}
            </p>
          {/if}
          {#if seriesSummary !== null}
            <p
              class="w-fit max-w-full rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-muted"
            >
              Repeats: {seriesSummary}
            </p>
          {/if}
        </div>
      {/if}

      {#if conflicted}
        <div
          role="alert"
          class="flex flex-col gap-2 rounded-md border border-danger bg-danger/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            This task changed somewhere else while you had it open. Your text is still here — reload
            to replace it with the latest version.
          </span>
          <Button variant="secondary" onclick={reloadFromServer}>Reload</Button>
        </div>
      {/if}

      {#if !readonly}
        <TaskQuickActions
          bind:this={quickActions}
          {taskId}
          onreveal={(section) => void reveal(section)}
          onattach={(how) => void attach(how)}
        />
      {/if}

      {#if !readonly || task.description !== null}
        <section class="flex flex-col gap-2">
          <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-sm font-semibold text-muted">Description</h3>
            {#if descriptionSaveState !== 'idle'}
              <span role="status" aria-live="polite" class="text-xs text-muted">
                {descriptionSaveState === 'saving'
                  ? 'Saving…'
                  : descriptionSaveState === 'saved'
                    ? 'Saved'
                    : 'Not saved — retrying'}
              </span>
            {/if}
          </div>
          {#key taskId}
            {#if readonly}
              <RichTextEditor content={task.description} readonly />
            {:else}
              <RichTextEditor
                bind:this={editorRef}
                bind:saveState={descriptionSaveState}
                content={task.description}
                onSave={saveDescription}
                {uploadImage}
                {mentionUsers}
              />
            {/if}
          {/key}
        </section>
      {/if}

      {#if showChecklist}
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Checklist</h3>
          <TaskChecklist bind:this={checklistRef} {taskId} {readonly} {taskPath} />
        </section>
      {/if}

      {#if task.label_ids.length > 0}
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Labels</h3>
          <TaskLabels {taskId} {readonly} onemptied={() => quickActions?.focusButton('labels')} />
        </section>
      {/if}

      {#if task.assignee_ids.length > 0}
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Assignees</h3>
          <TaskAssignees
            {taskId}
            {readonly}
            onemptied={() => quickActions?.focusButton('assign')}
          />
        </section>
      {/if}

      {#if isCalendarDate(task.due_date)}
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Due date</h3>
          <p class="text-sm">{formatFullDate(task.due_date)}</p>
        </section>
      {/if}

      <TaskDependencies {taskId} {readonly} />

      {#if !anonymous && showAttachments}
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Attachments</h3>
          <TaskAttachments bind:this={attachmentsRef} {taskId} {readonly} />
        </section>
      {/if}

      {#if !anonymous || task.comment_count > 0}
        <!-- Driven from state rather than the browser default, so the body stays
             unmounted while collapsed and no editor is built for a card nobody
             opened the comments on. -->
        <details class="border-t border-edge pt-4" open={commentsOpen}>
          <summary
            onclick={(event) => {
              event.preventDefault();
              commentsOpen = !commentsOpen;
            }}
            class="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-muted"
          >
            Comments ({task.comment_count})
          </summary>
          {#if commentsOpen}
            <div class="flex flex-col gap-4 pt-2">
              <TaskComments {taskId} {anonymous} bind:draft={commentDraft} />
            </div>
          {/if}
        </details>
      {/if}

      {#if !anonymous}
        <details class="border-t border-edge pt-4" open={historyOpen}>
          <summary
            onclick={(event) => {
              event.preventDefault();
              historyOpen = !historyOpen;
            }}
            class="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-muted"
          >
            History
          </summary>
          {#if historyOpen}
            <div class="flex flex-col gap-4 pt-2">
              <TaskHistory {taskId} />
            </div>
          {/if}
        </details>
      {/if}

      {#if !anonymous && !readonly}
        <div class="flex gap-2 border-t border-edge pt-4">
          <Button variant="secondary" disabled={duplicating} onclick={() => void handleDuplicate()}>
            Duplicate
          </Button>
          <Button variant="secondary" onclick={() => void handleArchive()}>Archive</Button>
        </div>
      {/if}
    {/if}
    <!-- The shell's copy is inert behind this dialog, so the overlay needs its own. -->
    <Announcer />
  </div>
</dialog>
