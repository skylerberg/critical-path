<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { board, type TaskUpdateOutcome } from '../lib/board.svelte';
  import type { BoardTask } from '../lib/board-types';
  import { conflictDrafts, type TaskVersion } from '../lib/conflictDrafts.svelte';
  import { formatFullDate, isCalendarDate } from '../lib/dates';
  import { currentProjectMentionCandidates } from '../lib/mentions';
  import { router } from '../lib/router.svelte';
  import { crossProjectTotal } from '../lib/cross-project-counts';
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
  const seriesSummary = $derived(board.taskSeriesRefs[taskId]?.summary ?? null);
  const mentionUsers = $derived(currentProjectMentionCandidates());
  // A viewer is read-only but still has an identity, so they keep the comment
  // stream, the history and the timestamps; a public reader has none of that and
  // is served a payload whose identity and timestamp fields are placeholders.
  const anonymous = $derived(board.readonly);

  const cross = $derived(crossProjectDeps.get(taskId)?.deps ?? null);
  // The same idiom as TaskAttachments: the card already knows how many rows are
  // coming, so the Dependencies section is reserved before the fetch answers.
  const crossTotal = $derived(
    crossProjectTotal({
      deps: cross,
      anonymous,
      openBlockerCount: task?.open_cross_project_blocker_count ?? 0,
    })
  );

  let dialog = $state<HTMLDialogElement>();
  let titleInput = $state<HTMLInputElement>();
  let editorRef = $state<ReturnType<typeof RichTextEditor>>();
  let quickActions = $state<ReturnType<typeof TaskQuickActions>>();
  let checklistRef = $state<ReturnType<typeof TaskChecklist>>();
  let attachmentsRef = $state<ReturnType<typeof TaskAttachments>>();

  // Everything the overlay holds about the card currently in it. Svelte never
  // remounts this component between cards — only the taskId prop changes — so the
  // switch has to rebuild all of it by hand. freshCard() is the only constructor,
  // which is what stops a field being added without also being reset: the leak it
  // would otherwise cause is silent, and one of these is a save precondition.
  interface CardState {
    // Sent, not dropped, when the card goes away: on a phone the back gesture is the
    // dismissal, and removing a focused input is not a blur, so nothing else would
    // save it. The card it belongs to is pinned by handing this whole object to
    // commitTitle — that, rather than discarding it, is what stops an abandoned edit
    // landing on another card, or over a rename the user never saw.
    titleDraft: string | null;
    removing: boolean;
    duplicating: boolean;
    closed: boolean;
    // The version the editor was populated from and the pair it carries, advanced
    // only by this overlay's own successful writes: adopting a teammate's incoming
    // version would let the next save silently overwrite it, and task.* is
    // overwritten optimistically the moment a save starts, so it cannot tell an
    // unchanged field from an unsaved one.
    baseUpdatedAt: string | null;
    baseTitle: string | null;
    baseDescription: TiptapDoc | null;
    descriptionSaveState: SaveState;
    // A checklist or an attachment list with nothing in it has nothing to show, so
    // the quick bar asks for one and the section stays until the card is closed.
    // Neither ever hides something the card actually holds.
    checklistRevealed: boolean;
    attachmentsRevealed: boolean;
    historyOpen: boolean;
    reviewOpen: boolean;
    announcedCrossFor: string | null;
  }

  function freshCard(): CardState {
    return {
      titleDraft: null,
      removing: false,
      duplicating: false,
      closed: false,
      baseUpdatedAt: null,
      baseTitle: null,
      baseDescription: null,
      descriptionSaveState: 'idle',
      checklistRevealed: false,
      attachmentsRevealed: false,
      historyOpen: false,
      reviewOpen: false,
      announcedCrossFor: null,
    };
  }

  let card = $state<CardState>(freshCard());

  const showChecklist = $derived(card.checklistRevealed || (task?.checklist_item_count ?? 0) > 0);
  const showAttachments = $derived(card.attachmentsRevealed || (task?.attachment_count ?? 0) > 0);
  const hasDependencies = $derived(
    (task?.blocker_ids.length ?? 0) > 0 ||
      board.tasks.some((t) => t.blocker_ids.includes(taskId)) ||
      crossTotal > 0
  );

  async function reveal(section: 'checklist' | 'attachments'): Promise<void> {
    if (section === 'checklist') {
      card.checklistRevealed = true;
      await tick();
      checklistRef?.focusAddItem();
      return;
    }
    card.attachmentsRevealed = true;
    await tick();
  }

  async function attach(how: 'file' | 'link'): Promise<void> {
    card.attachmentsRevealed = true;
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

  // byId, not displayFor — see the note on byId.
  const storedAuthorId = $derived(task === undefined ? null : contentAuthorAt(task.updated_at));
  const storedAuthor = $derived(storedAuthorId === null ? undefined : users.byId(storedAuthorId));

  // Reading the props straight into the effect below would make it depend on the
  // route object they come from, which is replaced whenever the URL is rewritten —
  // including the slug refresh a teammate's rename triggers. Deriving first stops at
  // a value only a real change of card can move, so an incoming rename no longer
  // resets the baseline and hands the next save a precondition it never loaded.
  const overlayKey = $derived(`${taskId}:${anonymous ? 'public' : 'private'}`);

  // The teardown flushes the card this same run built, which is what makes the
  // pairing safe: Svelte runs an effect's teardown immediately before that effect's
  // own body, so the outgoing card is always sent before the incoming one replaces
  // it, and no other effect can be reordered into the gap. It is also the only
  // thing that runs on the dismissals that never reach close() — Back, a sidebar
  // link, the auth redirect, a background read that fails and swaps this subtree
  // out — none of which blur the field on the way past.
  $effect(() => {
    void overlayKey;
    return untrack(() => {
      const id = taskId;
      card = freshCard();
      // Read back off `card`, never the object handed to it: `$state` stores a
      // deep proxy, every write goes through that proxy, and the raw object it
      // wrapped keeps the values it was constructed with. Capturing the
      // constructor's return would hand the teardown a card whose titleDraft is
      // forever null.
      const opened = card;
      if (!anonymous) {
        board.clearChanged(id);
        // ensure, unlike the cross-project rows below: everything this reads —
        // the comments, the checklist, the attachments — is on this board's own
        // channel, so an unbroken subscription since the last read has already
        // delivered whatever the read would find.
        void board.ensureTaskDetail(id);
        // refresh, not ensure: a remote task changes on its own project's
        // channel, which this client does not subscribe to, so reopening the
        // panel is the moment to revalidate. Cached rows stay painted while it
        // runs, so the skeleton only ever shows on a cold open.
        crossProjectDeps.refresh(id);
      }
      return () => commitTitle(opened, id);
    });
  });

  // Deferred, unlike the detail fetch: History opens collapsed and only the
  // conflict banner's byline reads the log otherwise, so an unopened one would
  // spend a request per card.
  $effect(() => {
    if ((card.historyOpen || conflicted) && !anonymous) {
      void taskActivity.load(taskId);
    }
  });

  // Rows swapping in for skeletons is a silent change otherwise. Announced once
  // per open and from here rather than from either list, so the two sections
  // cannot race for the announcer's single message.
  $effect(() => {
    const id = taskId;
    const ready = cross !== null;
    const total = crossTotal;
    untrack(() => {
      if (!ready || card.announcedCrossFor === id) return;
      card.announcedCrossFor = id;
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
      if (card.baseUpdatedAt === null && loaded !== undefined) {
        const pending = conflictDrafts.get(taskId);
        card.baseUpdatedAt = loaded.updated_at;
        card.baseTitle = pending?.base.title ?? loaded.title;
        card.baseDescription = pending?.base.description ?? loaded.description;
        if (pending !== null) {
          card.titleDraft = pending.mine.title;
        }
      }
    });
  });

  // Cleared on unmount so a reopened overlay never flashes another card's history
  // and no background mutation keeps refetching for a closed dialog. card.closed is
  // set here too because most dismissals never reach close(): Back, a sidebar link
  // and the auth redirect all just unmount the dialog.
  $effect(() => () => {
    card.closed = true;
    taskActivity.reset();
  });

  /**
   * The title and the description share one queue: overlapping writes would carry
   * the same baseline and the second would conflict against the first.
   *
   * Plain, and deliberately NOT a field on the `$state` card, which is where it
   * used to live: a write to reactive state during teardown does not survive, so
   * the queue head reverted mid-unmount and stopped serialising the two flushes
   * that race there. CLAUDE.md's Svelte conventions have the rule and what it
   * cost; `scripts/check-task-detail.mjs` is the guard.
   *
   * One queue per component rather than per card is also what the callers want:
   * commitTitle is handed the OUTGOING card while the next one is already mounted,
   * and those two writes have to serialise against each other too.
   */
  let pendingWrite: Promise<unknown> = Promise.resolve();

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
      dialog.focus();
    }
  });

  // replaceState so Back skips the closed overlay instead of re-opening it. The
  // title is sent here rather than left to the blur the ✕ tap fires, so the two
  // fields of one card behave alike: the description already flushes on teardown.
  function close(): void {
    commitTitle(card, taskId);
    card.closed = true;
    router.redirect(closePath);
  }

  // Both fields are captured, not just the one whose save was rejected: updated_at
  // is a single token for the pair, so a teammate's description edit is what stops
  // a rename, and the resolver has to be able to see both sides of both fields.
  // The editor is asked for its live document rather than the one the failed save
  // carried, which the debounce leaves a keystroke or two behind.
  // The baseline the editor was populated from, handed to every guarded save so a
  // patch that has to wait for the network still knows what it was written
  // against. Without it a queued edit that comes back 409 could report the
  // conflict but not offer the choice, which is the half of the promise that
  // matters.
  function currentBase(): TaskVersion {
    return { title: card.baseTitle ?? '', description: card.baseDescription };
  }

  function enterConflict(): void {
    const trimmed = card.titleDraft?.trim() ?? '';
    conflictDrafts.set(taskId, {
      mine: {
        // Empty reverts to the stored title, the same rule commitTitle applies:
        // an empty title is not an edit the server would take.
        title: trimmed === '' ? (card.baseTitle ?? '') : trimmed,
        description: editorRef?.getContent() ?? null,
      },
      base: { title: card.baseTitle ?? '', description: card.baseDescription },
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
  //
  // Which card is being written is fixed at the call, not in the queue: `card` is
  // replaced and `taskId` can move before the queue drains, so a write that named
  // them then would land on whichever card is mounted by that point. Passing the
  // CardState object rather than copying its fields is deliberate — identity is
  // pinned, while the baseline stays the live one for that card, which a save queued
  // ahead of this one is still allowed to advance.
  //
  // Both parameters are required rather than defaulted to the mounted card, so that
  // `onblur={commitTitle}` cannot typecheck: an all-optional signature reads as an
  // event handler, and the FocusEvent would arrive silently as the card to write.
  function commitTitle(state: CardState, id: string): void {
    const typed = state.titleDraft;
    if (typed === null) return;
    // Live over mirrored: a mobile keyboard finishing a word by composition can
    // leave the oninput mirror a word behind. Only for the mounted card — the field
    // is not re-created between cards, so on a switch it already holds the new
    // title, and reading it would write that onto the card being left.
    const live = id === taskId && titleInput?.isConnected === true ? titleInput.value : typed;
    const trimmed = live.trim();
    if (trimmed === '') {
      state.titleDraft = null;
      return;
    }
    void queueWrite(async () => {
      // Re-checked here, against the captured card rather than whichever one is
      // mounted now: the queue can hold this past a conflict, an archive, a delete
      // or a switch. An archived or deleted card would 404 the write, or resurrect
      // itself on the next refetch — the same reason saveDescription bails.
      if (conflictDrafts.get(id) !== null || state.removing) return;
      if (!board.tasks.some((t) => t.id === id)) return;
      // The baseline is read here and not captured above: a save already queued
      // ahead of this one advances it, and this write has to carry the version that
      // one produced. Reading it off the captured object is what keeps that true for
      // the card being left as well as the one on screen.
      if (trimmed !== state.baseTitle) {
        const outcome = await board.updateTask(
          id,
          { title: trimmed },
          state.baseUpdatedAt ?? undefined,
          {
            title: state.baseTitle ?? '',
            description: state.baseDescription,
          }
        );
        if (outcome.status === 'conflict') {
          if (id === taskId) enterConflict();
          return;
        }
        if (outcome.status === 'error') return;
        // Queued: the baseline stays where it is, because the precondition the
        // waiting patch carries names that same version. Advancing it here would
        // promise a save the server has not seen.
        if (outcome.status === 'ok') {
          state.baseUpdatedAt = outcome.updated_at;
          state.baseTitle = trimmed;
        }
      }
      if (state.titleDraft === typed) {
        state.titleDraft = null;
      }
    });
  }

  function saveDescription(doc: TiptapDoc | null): Promise<boolean> {
    // The editor flushes pending saves on teardown; skip that doomed PATCH once the
    // card is on its way off the board so it cannot 404 (or resurrect it on refetch).
    if (card.removing) return Promise.resolve(true);
    const id = taskId;
    return queueWrite(async () => {
      // Re-checked here because the queue can hold this past a delete, a conflict or
      // an in-place task change.
      if (conflicted || card.removing || id !== taskId) return true;
      const outcome = await board.updateTask(
        id,
        { description: doc },
        card.baseUpdatedAt ?? undefined,
        currentBase()
      );
      if (outcome.status === 'ok') {
        card.baseUpdatedAt = outcome.updated_at;
        card.baseDescription = doc;
        return true;
      }
      // Held for the network. Settled as far as the editor is concerned — the
      // text is safe and the sync indicator owns saying it is not sent yet — but
      // the baseline stays put so the queued precondition remains true.
      if (outcome.status === 'queued') {
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
    card.baseUpdatedAt = updatedAt;
    card.baseTitle = resolved.title;
    card.baseDescription = resolved.description;
    card.titleDraft = null;
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
    card.duplicating = true;
    const source = taskId;
    try {
      const id = await queueWrite(() => board.duplicateTask(source));
      // card.closed alone would miss every dismissal that does not run close() —
      // Back, the auth redirect — and taskId can also change under a mounted overlay.
      if (id !== null && !card.closed && source === taskId) {
        router.navigate(taskPath(id));
      }
    } finally {
      card.duplicating = false;
    }
  }

  // No confirm step: archiving is reversible, and it is the only way off the
  // board — deleting a card is reached from the archive, behind its own confirm.
  async function handleArchive(): Promise<void> {
    card.removing = true;
    await board.archiveTask(taskId);
    close();
  }
</script>

<dialog
  bind:this={dialog}
  tabindex="-1"
  aria-label={task === undefined ? 'Task not found' : truncateTitle(task.title)}
  class="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-surface p-0 text-ink backdrop:bg-black/50 lg:m-auto lg:h-fit lg:max-h-[90dvh] lg:w-full lg:max-w-2xl lg:rounded-lg lg:border lg:border-edge lg:shadow-xl"
  oncancel={(event) => {
    event.preventDefault();
    // Escape discards the title edit, matching the inline column rename.
    card.titleDraft = null;
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
            bind:this={titleInput}
            value={card.titleDraft ?? task.title}
            maxlength={TASK_TITLE_MAX_LENGTH}
            aria-label="Task title"
            autocapitalize="sentences"
            oninput={(event) => (card.titleDraft = event.currentTarget.value)}
            onblur={() => commitTitle(card, taskId)}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            class="min-h-11 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-lg font-semibold focus-ring hover:border-edge focus:border-accent focus:bg-canvas"
          />
        {/if}
        <Button variant="ghost" aria-label="Close" onclick={close}>✕</Button>
      </div>

      <!-- The quick bar's own button carries the column for anyone who can move
           the card; a reader has no bar, and still needs to know where it sits.
           The recurrence is not here: it belongs to the Dates section, beside
           the due date it shares its controls with. -->
      {#if readonly}
        <div class="flex flex-wrap items-center gap-2">
          <p
            class="w-fit max-w-full rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-muted"
          >
            {columnName}
          </p>
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
          <Button variant="secondary" onclick={() => (card.reviewOpen = true)}
            >Review changes…</Button
          >
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
            {#if card.descriptionSaveState !== 'idle'}
              <span role="status" aria-live="polite" class="text-xs text-muted">
                {card.descriptionSaveState === 'saving'
                  ? 'Saving…'
                  : card.descriptionSaveState === 'saved'
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
                bind:saveState={card.descriptionSaveState}
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

      {#if isCalendarDate(task.due_date) || seriesSummary !== null}
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Dates</h3>
          <dl class="flex flex-col gap-1 text-sm">
            {#if isCalendarDate(task.due_date)}
              <div class="flex flex-wrap gap-x-2">
                <dt class="text-muted">Due date</dt>
                <dd>{formatFullDate(task.due_date)}</dd>
              </div>
            {/if}
            {#if seriesSummary !== null}
              <div class="flex flex-wrap gap-x-2">
                <dt class="text-muted">Repeats</dt>
                <dd>{seriesSummary}</dd>
              </div>
            {/if}
          </dl>
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
        <section class="flex flex-col gap-2 border-t border-edge pt-4">
          <h3 class="text-sm font-semibold text-muted">Comments ({task.comment_count})</h3>
          <div class="flex flex-col gap-4">
            <TaskComments {taskId} {anonymous} />
          </div>
        </section>
      {/if}

      {#if !anonymous}
        <details class="border-t border-edge pt-4" open={card.historyOpen}>
          <summary
            onclick={(event) => {
              event.preventDefault();
              card.historyOpen = !card.historyOpen;
            }}
            class="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-muted"
          >
            History
          </summary>
          {#if card.historyOpen}
            <div class="flex flex-col gap-4 pt-2">
              <TaskHistory {taskId} />
            </div>
          {/if}
        </details>
      {/if}

      {#if !anonymous && !readonly}
        <div class="flex gap-2 border-t border-edge pt-4">
          <Button
            variant="secondary"
            disabled={card.duplicating}
            onclick={() => void handleDuplicate()}
          >
            Duplicate
          </Button>
          <Button variant="secondary" onclick={() => void handleArchive()}>Archive</Button>
        </div>
      {/if}

      <!-- Last, so the card's own editor stays the first one in the document: the
           resolver renders read-only copies of the same component. -->
      {#if draft !== null && card.reviewOpen}
        <TaskConflictDialog
          {taskId}
          mine={draft.mine}
          base={draft.base}
          onresolve={applyResolution}
          onclose={() => (card.reviewOpen = false)}
        />
      {/if}
    {/if}
    <!-- The shell's copy is inert behind this dialog, so the overlay needs its own.
         Only the local channel: remote board changes go unspoken while any dialog is
         open, so a second region for them would never hold anything. -->
    <Announcer message={announcer.message} />
  </div>
</dialog>
