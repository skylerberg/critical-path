<script lang="ts">
  import { untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import type { BoardTask } from '../lib/board-types';
  import { append } from '../lib/positions';
  import { router } from '../lib/router.svelte';
  import { taskActivity } from '../lib/taskActivity.svelte';
  import AssigneePicker from './AssigneePicker.svelte';
  import DependencyPicker from './DependencyPicker.svelte';
  import LabelPicker from './LabelPicker.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import TaskActivity from './TaskActivity.svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import Spinner from './ui/Spinner.svelte';

  type TiptapDoc = NonNullable<BoardTask['description']>;

  interface Props {
    taskId: string;
    closePath: string;
    readonly?: boolean;
  }

  let { taskId, closePath, readonly = false }: Props = $props();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const images = $derived(board.taskImages[taskId]);
  const taskById = $derived(new Map(board.tasks.map((t) => [t.id, t])));
  const doneColumnIds = $derived(board.doneColumnIds);
  const blockers = $derived((task?.blocker_ids ?? []).flatMap((id) => taskById.get(id) ?? []));
  const openBlockerCount = $derived(
    blockers.filter((blocker) => !doneColumnIds.has(blocker.column_id)).length
  );
  const dependents = $derived(board.tasks.filter((t) => t.blocker_ids.includes(taskId)));
  const columnName = $derived(board.columns.find((c) => c.id === task?.column_id)?.name ?? '');

  let dialog = $state<HTMLDialogElement>();
  let uploadInput = $state<HTMLInputElement>();
  let confirmingDelete = $state(false);
  let removing = $state(false);

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

  $effect(() => {
    const id = taskId;
    const authed = !readonly;
    untrack(() => {
      titleDraft = null;
      confirmingDelete = false;
      removing = false;
      baseUpdatedAt = null;
      baseTitle = null;
      conflicted = false;
      pendingWrite = Promise.resolve();
      if (authed) {
        void board.loadTaskDetail(id);
        void taskActivity.load(id);
      }
    });
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
  // and no background mutation keeps refetching for a closed dialog.
  $effect(() => () => taskActivity.reset());

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

  async function uploadImage(file: File): Promise<string | null> {
    const image = await board.uploadTaskImage(taskId, file);
    return image?.url ?? null;
  }

  function changeColumn(event: Event & { currentTarget: EventTarget & HTMLSelectElement }): void {
    const columnId = event.currentTarget.value;
    if (task === undefined || columnId === task.column_id) return;
    void board.moveTask(
      taskId,
      columnId,
      append(board.tasksInColumn(columnId).map((t) => t.position))
    );
  }

  async function handleDelete(): Promise<void> {
    if (!confirmingDelete) {
      confirmingDelete = true;
      return;
    }
    // Await the DELETE before closing: navigating away first aborts the in-flight
    // request, and the failure path's refetch then races the server commit and
    // resurrects the task.
    removing = true;
    await board.deleteTask(taskId);
    close();
  }

  // No confirm step: archiving is reversible, unlike delete.
  async function handleArchive(): Promise<void> {
    removing = true;
    await board.archiveTask(taskId);
    close();
  }

  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
</script>

<dialog
  bind:this={dialog}
  aria-label={task?.title ?? 'Task not found'}
  class="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-surface p-0 text-ink backdrop:bg-black/50 lg:m-auto lg:h-auto lg:max-h-[90dvh] lg:w-full lg:max-w-2xl lg:rounded-lg lg:border lg:border-edge lg:shadow-xl"
  oncancel={(event) => {
    event.preventDefault();
    // Escape discards the title edit, matching the inline column rename.
    titleDraft = null;
    close();
  }}
  onclick={(event) => {
    if (event.target === dialog) close();
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

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold text-muted">Column</h3>
        {#if readonly}
          <p class="text-sm">{columnName}</p>
        {:else}
          <select
            aria-label="Column"
            value={task.column_id}
            onchange={changeColumn}
            class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm outline-none focus:border-accent"
          >
            {#each board.columns as column (column.id)}
              <option value={column.id}>{column.name}</option>
            {/each}
          </select>
        {/if}
      </section>

      {#if !readonly || task.description !== null}
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Description</h3>
          {#key taskId}
            {#if readonly}
              <RichTextEditor content={task.description} readonly />
            {:else}
              <RichTextEditor
                bind:this={editorRef}
                content={task.description}
                onSave={saveDescription}
                {uploadImage}
              />
            {/if}
          {/key}
        </section>
      {/if}

      {#if !readonly || task.label_ids.length > 0}
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Labels</h3>
          <LabelPicker {taskId} {readonly} />
        </section>
      {/if}

      {#if !readonly || task.assignee_ids.length > 0}
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Assignees</h3>
          <AssigneePicker {taskId} {readonly} />
        </section>
      {/if}

      {#if !readonly || blockers.length > 0}
        <section class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-semibold text-muted">Blocked by</h3>
            {#if openBlockerCount > 0}
              <Badge variant="danger">
                {openBlockerCount} open task{openBlockerCount === 1 ? '' : 's'}
              </Badge>
            {/if}
          </div>
          {#if blockers.length > 0}
            <ul class="flex flex-col">
              {#each blockers as blocker (blocker.id)}
                <li class="flex min-h-11 items-center gap-2">
                  <span
                    class="min-w-0 flex-1 truncate text-sm {doneColumnIds.has(blocker.column_id)
                      ? 'text-muted line-through'
                      : ''}"
                  >
                    {blocker.title}
                  </span>
                  {#if !readonly}
                    <button
                      type="button"
                      aria-label="Remove blocking task {blocker.title}"
                      onclick={() => void board.removeBlocker(taskId, blocker.id)}
                      class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      Remove
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if !readonly}
            <DependencyPicker {taskId} direction="blocker" />
          {/if}
        </section>
      {/if}

      {#if !readonly || dependents.length > 0}
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Blocks</h3>
          {#if dependents.length > 0}
            <ul class="flex flex-col">
              {#each dependents as dependent (dependent.id)}
                <li class="flex min-h-11 items-center gap-2">
                  <span
                    class="min-w-0 flex-1 truncate text-sm {doneColumnIds.has(dependent.column_id)
                      ? 'text-muted line-through'
                      : ''}"
                  >
                    {dependent.title}
                  </span>
                  {#if !readonly}
                    <button
                      type="button"
                      aria-label="Remove blocked task {dependent.title}"
                      onclick={() => void board.removeBlocker(dependent.id, taskId)}
                      class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      Remove
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if !readonly}
            <DependencyPicker {taskId} direction="blocked" />
          {/if}
        </section>
      {/if}

      {#if !readonly}
        <section class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-muted">Images</h3>
            <Button variant="secondary" onclick={() => uploadInput?.click()}>Upload image</Button>
          </div>
          {#if images === undefined}
            {#if task.image_count > 0}
              <Spinner size="sm" label="Loading images" />
            {/if}
          {:else if images.length === 0}
            <p class="text-sm text-muted">No images attached.</p>
          {:else}
            <ul class="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {#each images as image (image.id)}
                <li class="relative">
                  <img
                    src={image.url}
                    alt={image.filename}
                    loading="lazy"
                    class="aspect-square w-full rounded-md border border-edge object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Delete image {image.filename}"
                    onclick={() => void board.deleteTaskImage(taskId, image.id)}
                    class="absolute top-1 right-1 flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-sm text-white hover:bg-danger"
                  >
                    ✕
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          <input
            bind:this={uploadInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            class="hidden"
            onchange={(event) => {
              for (const file of event.currentTarget.files ?? []) {
                void board.uploadTaskImage(taskId, file);
              }
              event.currentTarget.value = '';
            }}
          />
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted">Activity</h3>
          <TaskActivity {taskId} />
        </section>

        <div
          class="flex flex-col gap-3 border-t border-edge pt-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p class="text-xs text-muted">
            Created {dateFormat.format(new Date(task.created_at))} · Updated {dateFormat.format(
              new Date(task.updated_at)
            )}
          </p>
          <div class="flex gap-2">
            <Button variant="secondary" onclick={() => void handleArchive()}>Archive</Button>
            <Button variant="danger" onclick={() => void handleDelete()}>
              {confirmingDelete ? 'Confirm delete' : 'Delete task'}
            </Button>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</dialog>
