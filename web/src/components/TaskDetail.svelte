<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { board, type TaskUpdateOutcome } from '../lib/board.svelte';
  import type { BoardTask } from '../lib/board-types';
  import { conflictDrafts, type TaskVersion } from '../lib/conflictDrafts.svelte';
  import { formatFullDate, isCalendarDate } from '../lib/dates';
  import { docDraftKey, drafts } from '../lib/drafts.svelte';
  import { currentProjectMentionCandidates } from '../lib/mentions';
  import { router } from '../lib/router.svelte';
  import { crossProjectDeps } from '../lib/crossProjectDeps.svelte';
  import { contentAuthorAt, taskActivity } from '../lib/taskActivity.svelte';
  import { sameDoc } from '../lib/tiptap';
  import { TASK_TITLE_MAX_LENGTH, truncateTitle } from '../lib/titles';
  import { users } from '../lib/users.svelte';
  import RichTextEditor, { type SaveState } from './RichTextEditor.svelte';
  import TaskAssignees from './TaskAssignees.svelte';
  import TaskAttachments from './TaskAttachments.svelte';
  import TaskChecklist from './TaskChecklist.svelte';
  import TaskComments from './TaskComments.svelte';
  import TaskConflictDialog from './TaskConflictDialog.svelte';
  import TaskDependencies from './TaskDependencies.svelte';
  import TaskHistory from './TaskHistory.svelte';
  import TaskLabels from './TaskLabels.svelte';
  import TaskQuickActions from './TaskQuickActions.svelte';
  import Announcer from './ui/Announcer.svelte';
  import { announcer } from '../lib/announcer.svelte';
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

  const cross = $derived(crossProjectDeps.get(taskId)?.deps ?? null);
  // The same idiom as TaskAttachments: the card already knows how many rows are
  // coming, so the list can reserve them before the fetch answers. The count is
  // of open blocked-by edges only, so a task whose cross-project edges are all
  // done, or all outgoing, reserves nothing and simply fills in — which is why
  // the fetch itself is never gated on it.
  const crossPending = $derived(cross === null && !anonymous);
  const crossSkeletons = $derived(crossPending ? (task?.open_cross_project_blocker_count ?? 0) : 0);
  const crossBlockedByCount = $derived(
    cross === null ? crossSkeletons : cross.blocked_by.length + cross.hidden_blocked_by_count
  );
  const crossBlockingCount = $derived(
    cross === null ? 0 : cross.blocking.length + cross.hidden_blocking_count
  );
  const crossTotal = $derived(crossBlockedByCount + crossBlockingCount);

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
  // The title and description that version carries. task.* is overwritten
  // optimistically the moment a save starts, so it cannot tell an unchanged field
  // from an unsaved one — and the resolver needs that to know which side edited what.
  let baseTitle = $state<string | null>(null);
  let baseDescription = $state<TiptapDoc | null>(null);
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
  let quickActions = $state<ReturnType<typeof TaskQuickActions>>();
  let checklistRef = $state<ReturnType<typeof TaskChecklist>>();
  let attachmentsRef = $state<ReturnType<typeof TaskAttachments>>();

  const showChecklist = $derived(checklistRevealed || (task?.checklist_item_count ?? 0) > 0);
  const showAttachments = $derived(attachmentsRevealed || (task?.attachment_count ?? 0) > 0);
  const hasDependencies = $derived(
    (task?.blocker_ids.length ?? 0) > 0 ||
      board.tasks.some((t) => t.blocker_ids.includes(taskId)) ||
      crossTotal > 0
  );

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

  // The rejected edit is the conflict: one store owns both the banner and the text
  // it promises is safe, so they cannot disagree, and neither dies with the overlay.
  const draft = $derived(conflictDrafts.get(taskId));
  const conflicted = $derived(draft !== null);
  let reviewOpen = $state(false);

  // byId, not displayFor: a teammate the log names but this account cannot see
  // is better left unnamed than announced as "Unknown user".
  const storedAuthorId = $derived(task === undefined ? null : contentAuthorAt(task.updated_at));
  const storedAuthor = $derived(storedAuthorId === null ? undefined : users.byId(storedAuthorId));

  // Reading the props straight into the effect below would make it depend on the
  // route object they come from, which is replaced whenever the URL is rewritten —
  // including the slug refresh a teammate's rename triggers. Deriving first stops at
  // a value only a real change of card can move, so an incoming rename no longer
  // resets the baseline and hands the next save a precondition it never loaded.
  const overlayKey = $derived(`${taskId}:${anonymous ? 'public' : 'private'}`);

  $effect(() => {
    void overlayKey;
    untrack(() => {
      const id = taskId;
      const authed = !anonymous;
      titleDraft = null;
      removing = false;
      duplicating = false;
      closed = false;
      baseUpdatedAt = null;
      baseTitle = null;
      baseDescription = null;
      reviewOpen = false;
      pendingWrite = Promise.resolve();
      descriptionSaveState = 'idle';
      checklistRevealed = false;
      attachmentsRevealed = false;
      // An unsent comment is the one thing that opens a disclosure by itself:
      // restoring the draft behind a collapsed header would hide the very text
      // the user came back to finish.
      commentsOpen = drafts.getDoc(docDraftKey.taskComment(id)) !== null;
      historyOpen = false;
      if (authed) {
        board.clearChanged(id);
        void board.loadTaskDetail(id);
        // refresh, not ensure: a remote task changes on its own project's
        // channel, which this client does not subscribe to, so reopening the
        // panel is the moment to revalidate. Cached rows stay painted while it
        // runs, so the skeleton only ever shows on a cold open.
        crossProjectDeps.refresh(id);
        announcedCrossFor = null;
      }
    });
  });

  // Deferred, unlike the detail fetch: History opens collapsed and only the
  // conflict banner's byline reads the log otherwise, so an unopened one would
  // spend a request per card.
  $effect(() => {
    if ((historyOpen || conflicted) && !anonymous) {
      void taskActivity.load(taskId);
    }
  });

  // Rows swapping in for skeletons is a silent change otherwise. Announced once
  // per open and from here rather than from either list, so the two sections
  // cannot race for the announcer's single message.
  let announcedCrossFor = $state<string | null>(null);
  $effect(() => {
    const id = taskId;
    const ready = cross !== null;
    const total = crossTotal;
    untrack(() => {
      if (!ready || announcedCrossFor === id) return;
      announcedCrossFor = id;
      if (total === 0) return;
      void announcer.announce(
        `${total} ${total === 1 ? 'dependency' : 'dependencies'} in other projects loaded`
      );
    });
  });

  // Must stay below the reset effect: effects run in declaration order, so capturing
  // first would only be undone by the reset. A card reopened while a conflict is
  // still unresolved takes its baseline and its text from the draft instead, so the
  // overlay comes back holding what the user typed rather than what beat it.
  $effect(() => {
    const loaded = task;
    untrack(() => {
      if (baseUpdatedAt === null && loaded !== undefined) {
        const pending = conflictDrafts.get(taskId);
        baseUpdatedAt = loaded.updated_at;
        baseTitle = pending?.base.title ?? loaded.title;
        baseDescription = pending?.base.description ?? loaded.description;
        if (pending !== null) {
          titleDraft = pending.mine.title;
        }
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

  // Both fields are captured, not just the one whose save was rejected: updated_at
  // is a single token for the pair, so a teammate's description edit is what stops
  // a rename, and the resolver has to be able to see both sides of both fields.
  // The editor is asked for its live document rather than the one the failed save
  // carried, which the debounce leaves a keystroke or two behind.
  function enterConflict(): void {
    const trimmed = titleDraft?.trim() ?? '';
    conflictDrafts.set(taskId, {
      mine: {
        // Empty reverts to the stored title, the same rule commitTitle applies:
        // an empty title is not an edit the server would take.
        title: trimmed === '' ? (baseTitle ?? '') : trimmed,
        description: editorRef?.getContent() ?? null,
      },
      base: { title: baseTitle ?? '', description: baseDescription },
    });
    // The banner names whoever stored the version that won, and the refresh the
    // failed patch queued is rate-limited; this one is not, so the name is there
    // by the time the user reads the sentence rather than a second later.
    void taskActivity.load(taskId);
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
          enterConflict();
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
        baseDescription = doc;
        return true;
      }
      // Reporting a conflict as a failed save would make the editor retry it on the
      // next keystroke, against a baseline that can only fail again.
      if (outcome.status === 'conflict') {
        enterConflict();
        return true;
      }
      return false;
    });
  }

  // The resolved version becomes the new baseline, so the next ordinary save
  // carries a precondition the server will accept.
  function adopt(id: string, resolved: TaskVersion, updatedAt: string): void {
    conflictDrafts.clear(id);
    if (id !== taskId) return;
    baseUpdatedAt = updatedAt;
    baseTitle = resolved.title;
    baseDescription = resolved.description;
    titleDraft = null;
    editorRef?.replaceContent(resolved.description);
  }

  // Submitted against the version the resolver actually showed, not whatever the
  // board holds by now: writing over a version the user never saw is the silent
  // loss the precondition exists to prevent. A second conflict is not the loop the
  // guard used to produce — that one came from a baseline that could never
  // advance, while this one only happens when there is something new to show.
  function applyResolution(
    resolved: TaskVersion,
    expectedUpdatedAt: string
  ): Promise<TaskUpdateOutcome['status']> {
    const id = taskId;
    return queueWrite(async () => {
      const stored = board.tasks.find((t) => t.id === id);
      if (stored === undefined) return 'error';
      // Keeping the stored version wholesale has nothing to write, and skipping
      // the PATCH also skips an updated_at bump that would conflict every other
      // open editor over no change at all.
      if (
        stored.updated_at === expectedUpdatedAt &&
        resolved.title === stored.title &&
        sameDoc(resolved.description, stored.description)
      ) {
        adopt(id, resolved, stored.updated_at);
        return 'ok';
      }
      const outcome = await board.updateTask(
        id,
        { title: resolved.title, description: resolved.description },
        expectedUpdatedAt
      );
      if (outcome.status === 'ok') {
        adopt(id, resolved, outcome.updated_at);
      }
      return outcome.status;
    });
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

      {#if draft !== null}
        <div
          role="alert"
          class="flex flex-col gap-2 rounded-md border border-danger bg-danger/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            {#if storedAuthor !== undefined && storedAuthor.name !== ''}
              {storedAuthor.name} changed this task while you had it open.
            {:else}
              This task changed somewhere else while you had it open.
            {/if}
            Your text is still here — nothing is saved until you choose what to keep.
          </span>
          <Button variant="secondary" onclick={() => (reviewOpen = true)}>Review changes…</Button>
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
              <!-- Seeded from the draft when one is pending, so a card reopened
                   mid-conflict shows the user their own text rather than the
                   version that beat it. Read once at construction, which the
                   surrounding key already scopes to one task. -->
              <RichTextEditor
                bind:this={editorRef}
                bind:saveState={descriptionSaveState}
                content={draft === null ? task.description : draft.mine.description}
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

      {#if hasDependencies}
        <TaskDependencies {taskId} {readonly} />
      {/if}

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
              <TaskComments {taskId} {anonymous} />
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

      <!-- Last, so the card's own editor stays the first one in the document: the
           resolver renders read-only copies of the same component. -->
      {#if draft !== null && reviewOpen}
        <TaskConflictDialog
          {taskId}
          mine={draft.mine}
          base={draft.base}
          onresolve={applyResolution}
          onclose={() => (reviewOpen = false)}
        />
      {/if}
    {/if}
    <!-- The shell's copy is inert behind this dialog, so the overlay needs its own.
         Only the local channel: remote board changes go unspoken while any dialog is
         open, so a second region for them would never hold anything. -->
    <Announcer message={announcer.message} />
  </div>
</dialog>
