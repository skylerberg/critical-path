<script lang="ts">
  import type { Editor, JSONContent } from '@tiptap/core';
  import { board, type TaskUpdateOutcome } from '../lib/board.svelte';
  import type { BoardTask } from '../lib/board-types';
  import type { TaskVersion } from '../lib/conflictDrafts.svelte';
  import { currentProjectMentionCandidates } from '../lib/mentions';
  import { contentAuthorAt, taskActivity } from '../lib/taskActivity.svelte';
  import { docToMarkdown, isEmptyDoc, sameDoc } from '../lib/tiptap';
  import { TASK_TITLE_MAX_LENGTH } from '../lib/titles';
  import { users } from '../lib/users.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';

  type TiptapDoc = NonNullable<BoardTask['description']>;

  interface Props {
    taskId: string;
    mine: TaskVersion;
    base: TaskVersion;
    onresolve: (
      resolution: TaskVersion,
      expectedUpdatedAt: string
    ) => Promise<TaskUpdateOutcome['status']>;
    onclose: () => void;
  }

  let { taskId, mine: initialMine, base: initialBase, onresolve, onclose }: Props = $props();

  interface StoredVersion extends TaskVersion {
    updated_at: string;
  }

  function storedNow(): StoredVersion {
    const task = board.tasks.find((t) => t.id === taskId);
    return {
      title: task?.title ?? '',
      description: task?.description ?? null,
      updated_at: task?.updated_at ?? '',
    };
  }

  // Snapshots rather than live reads: a teammate's realtime update must not swap
  // out the versions the user is deciding between, and the store's copy is about
  // to be resolved away. They advance together, and only when a resolve is turned
  // down for a version this dialog has not shown yet.
  // svelte-ignore state_referenced_locally
  let mine = $state<TaskVersion>(initialMine);
  // svelte-ignore state_referenced_locally
  let base = $state<TaskVersion>(initialBase);
  let theirs = $state<StoredVersion>(storedNow());
  let superseded = $state(false);
  // The read-only panels are editors, which read their document once at
  // construction; re-presenting has to build new ones or they would keep showing
  // the versions that were just superseded.
  let revision = $state(0);

  let mode = $state<'compare' | 'merge'>('compare');
  let confirmingTheirs = $state(false);
  let saving = $state(false);
  // svelte-ignore state_referenced_locally
  let mergeTitle = $state(initialMine.title);
  let mergeEditor = $state<ReturnType<typeof RichTextEditor>>();
  let copyStatus = $state<'idle' | 'copied' | 'failed'>('idle');

  const mentionUsers = $derived(currentProjectMentionCandidates());

  // Unthrottled, unlike invalidate: the log was marked stale by the patch that
  // just conflicted, and naming who won is the point of this dialog.
  $effect(() => {
    void taskActivity.load(taskId);
  });

  // Test seam: there is no way to type into a ProseMirror contenteditable under jsdom.
  export function getMergeEditor(): Editor | null {
    return mergeEditor?.getEditor() ?? null;
  }

  const titleConflict = $derived(
    mine.title !== base.title && theirs.title !== base.title && mine.title !== theirs.title
  );
  const descriptionConflict = $derived(
    !sameDoc(mine.description, base.description) &&
      !sameDoc(theirs.description, base.description) &&
      !sameDoc(mine.description, theirs.description)
  );
  const overlapping = $derived(titleConflict || descriptionConflict);

  // A field only offers a choice when both sides moved it somewhere different.
  // Otherwise there is one answer: whichever side changed it, or either of them
  // when they agree.
  function resolveField<T>(
    ours: T,
    from: T,
    stored: T,
    prefer: 'mine' | 'theirs',
    eq: (a: T, b: T) => boolean
  ): T {
    if (eq(ours, from)) return stored;
    if (eq(stored, from)) return ours;
    if (eq(ours, stored)) return ours;
    return prefer === 'mine' ? ours : stored;
  }

  function sameTitle(a: string, b: string): boolean {
    return a === b;
  }

  function resolution(prefer: 'mine' | 'theirs'): TaskVersion {
    return {
      title: resolveField(mine.title, base.title, theirs.title, prefer, sameTitle),
      description: resolveField(
        mine.description,
        base.description,
        theirs.description,
        prefer,
        sameDoc
      ),
    };
  }

  function mergedVersion(): TaskVersion {
    const fallback = resolution('mine');
    return {
      title: titleConflict ? mergeTitle.trim() : fallback.title,
      description: descriptionConflict ? (mergeEditor?.getContent() ?? null) : fallback.description,
    };
  }

  const mergeTitleEmpty = $derived(titleConflict && mergeTitle.trim() === '');

  // byId, not displayFor: a teammate the log names but this account cannot see
  // is better left unnamed than announced as "Unknown user".
  const authorId = $derived(contentAuthorAt(theirs.updated_at));
  const found = $derived(authorId === null ? undefined : users.byId(authorId));
  const author = $derived(found !== undefined && found.name !== '' ? found : null);

  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const storedAt = $derived(
    theirs.updated_at === '' ? '' : dateFormat.format(new Date(theirs.updated_at))
  );

  function mineAsMarkdown(): string {
    const body = docToMarkdown(mine.description);
    return titleConflict ? `${mine.title}\n\n${body}` : body;
  }

  async function copyMine(): Promise<void> {
    try {
      await navigator.clipboard.writeText(mineAsMarkdown());
      copyStatus = 'copied';
    } catch {
      copyStatus = 'failed';
    }
  }

  function startMerge(): void {
    mergeTitle = mine.title;
    confirmingTheirs = false;
    mode = 'merge';
  }

  // Their blocks, not their document: a doc node nested inside a doc is not a
  // shape the schema accepts, and what the user wants is the text appended to
  // theirs own, ready to be edited down.
  function appendTheirs(): void {
    const editor = mergeEditor?.getEditor();
    const stored = theirs.description;
    if (!editor || editor.isDestroyed || stored == null || isEmptyDoc(stored)) return;
    const blocks = (stored.content ?? []) as JSONContent[];
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, blocks).run();
  }

  async function submit(next: TaskVersion): Promise<void> {
    if (saving) return;
    saving = true;
    try {
      const outcome = await onresolve(next, theirs.updated_at);
      if (outcome === 'ok') {
        onclose();
        return;
      }
      if (outcome === 'conflict') {
        // The card moved again while this was open. Carry the work the user just
        // approved forward as their version and re-present it against the newer
        // stored one: every round trip here shows something they have not seen,
        // which is what separates it from the stale-baseline loop this dialog
        // exists to end.
        base = { title: theirs.title, description: theirs.description };
        mine = next;
        theirs = storedNow();
        mergeTitle = next.title;
        mergeEditor?.replaceContent(next.description);
        confirmingTheirs = false;
        superseded = true;
        revision += 1;
      }
    } finally {
      saving = false;
    }
  }
</script>

{#snippet titlePanel(label: string, text: string)}
  <div class="flex min-w-0 flex-col gap-1">
    <h4 class="text-xs font-semibold tracking-wide text-muted uppercase">{label}</h4>
    <div class="w-full rounded-md border border-edge bg-canvas p-2">
      <p class="text-sm break-words">{text}</p>
    </div>
  </div>
{/snippet}

{#snippet descriptionPanel(label: string, doc: TiptapDoc | null)}
  <div class="flex min-w-0 flex-col gap-1">
    <h4 class="text-xs font-semibold tracking-wide text-muted uppercase">{label}</h4>
    <div
      class="max-h-64 w-full overflow-y-auto overscroll-contain rounded-md border border-edge bg-canvas p-2"
    >
      {#if isEmptyDoc(doc)}
        <p class="text-sm text-muted italic">No description</p>
      {:else}
        <RichTextEditor content={doc} readonly bare />
      {/if}
    </div>
  </div>
{/snippet}

<Modal open size="lg" title="Review conflicting changes" {onclose}>
  <div class="flex flex-col gap-5">
    <div class="flex items-center gap-2 text-sm text-muted">
      {#if author !== null}
        <Avatar name={author.name} src={author.avatar_url} size="sm" />
        <span>{author.name} edited this task · {storedAt}</span>
      {:else}
        <span>This task was last edited {storedAt}</span>
      {/if}
    </div>

    {#if superseded}
      <p role="status" class="rounded-md border border-warning bg-warning/10 p-3 text-sm">
        It changed again while you were reviewing. Your version below is the one you just chose —
        compare it against the newer stored version.
      </p>
    {:else if !overlapping}
      <p class="text-sm">
        Your changes and theirs do not overlap, so both can be kept. Nothing is written until you
        choose.
      </p>
    {:else}
      <p class="text-sm">
        Your text was not saved and is still here. Nothing is written until you choose.
      </p>
    {/if}

    {#if mode === 'compare'}
      {#if titleConflict}
        <section class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {@render titlePanel('Your title', mine.title)}
          {@render titlePanel('Their title', theirs.title)}
        </section>
      {/if}
      {#if descriptionConflict}
        {#key revision}
          <section class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {@render descriptionPanel('Your description', mine.description)}
            {@render descriptionPanel('Their description', theirs.description)}
          </section>
        {/key}
      {/if}

      {#if overlapping}
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onclick={() => void copyMine()}>
            Copy my version as Markdown
          </Button>
          <!-- Not a toast: this dialog's top layer covers the shell that renders them. -->
          <span role="status" class="text-xs text-muted">
            {#if copyStatus === 'copied'}
              Copied
            {:else if copyStatus === 'failed'}
              Could not copy to the clipboard
            {/if}
          </span>
        </div>
      {/if}
    {:else}
      {#if titleConflict}
        <section class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="flex min-w-0 flex-col gap-1">
            <label
              for="merged-title"
              class="text-xs font-semibold tracking-wide text-muted uppercase"
            >
              Merged title
            </label>
            <input
              id="merged-title"
              bind:value={mergeTitle}
              maxlength={TASK_TITLE_MAX_LENGTH}
              class="min-h-11 w-full rounded-md border border-edge bg-canvas px-2 text-sm outline-none focus:border-accent"
            />
          </div>
          {@render titlePanel('Their title', theirs.title)}
        </section>
      {/if}
      {#if descriptionConflict}
        <section class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="flex min-w-0 flex-col gap-1">
            <h4 class="text-xs font-semibold tracking-wide text-muted uppercase">
              Merged description
            </h4>
            <RichTextEditor bind:this={mergeEditor} content={mine.description} {mentionUsers} />
          </div>
          <div class="flex min-w-0 flex-col gap-2">
            {#key revision}
              {@render descriptionPanel('Their description', theirs.description)}
            {/key}
            <Button variant="secondary" onclick={appendTheirs}>Append their version</Button>
          </div>
        </section>
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    {#if !overlapping}
      <Button variant="primary" disabled={saving} onclick={() => void submit(resolution('mine'))}>
        Keep both changes
      </Button>
    {:else if mode === 'compare'}
      <Button variant="secondary" onclick={startMerge}>Merge manually…</Button>
      {#if confirmingTheirs}
        <!-- Two steps because this is the one choice that drops the user's text,
             and a mis-click is exactly what must not be able to. -->
        <Button
          variant="danger"
          disabled={saving}
          onclick={() => void submit(resolution('theirs'))}
        >
          Discard my version
        </Button>
      {:else}
        <Button variant="secondary" disabled={saving} onclick={() => (confirmingTheirs = true)}>
          Keep theirs
        </Button>
      {/if}
      <Button variant="primary" disabled={saving} onclick={() => void submit(resolution('mine'))}>
        Keep mine
      </Button>
    {:else}
      <Button variant="secondary" onclick={() => (mode = 'compare')}>Back</Button>
      <Button
        variant="primary"
        disabled={saving || mergeTitleEmpty}
        onclick={() => void submit(mergedVersion())}
      >
        Save merged version
      </Button>
    {/if}
  {/snippet}
</Modal>
