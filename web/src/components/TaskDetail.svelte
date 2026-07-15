<script lang="ts">
  import { untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import type { BoardTask } from '../lib/board-types';
  import { router } from '../lib/router.svelte';
  import AssigneePicker from './AssigneePicker.svelte';
  import BlockerPicker from './BlockerPicker.svelte';
  import LabelPicker from './LabelPicker.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import Spinner from './ui/Spinner.svelte';

  type TiptapDoc = NonNullable<BoardTask['description']>;

  interface Props {
    projectId: string;
    taskId: string;
  }

  let { projectId, taskId }: Props = $props();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const images = $derived(board.taskImages[taskId]);
  const taskById = $derived(new Map(board.tasks.map((t) => [t.id, t])));
  const doneColumnIds = $derived(
    new Set(board.columns.filter((column) => column.is_done).map((column) => column.id))
  );
  const blockers = $derived((task?.blocker_ids ?? []).flatMap((id) => taskById.get(id) ?? []));
  const openBlockerCount = $derived(
    blockers.filter((blocker) => !doneColumnIds.has(blocker.column_id)).length
  );

  let dialog = $state<HTMLDialogElement>();
  let uploadInput = $state<HTMLInputElement>();
  let titleDraft = $state<string | null>(null);
  let confirmingDelete = $state(false);

  $effect(() => {
    const id = taskId;
    untrack(() => {
      titleDraft = null;
      confirmingDelete = false;
      void board.loadTaskImages(id);
    });
  });

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

  function close(): void {
    router.navigate(`/projects/${projectId}`);
  }

  function commitTitle(): void {
    if (titleDraft === null || task === undefined) return;
    const trimmed = titleDraft.trim();
    titleDraft = null;
    if (trimmed !== '' && trimmed !== task.title) {
      void board.updateTask(taskId, { title: trimmed });
    }
  }

  function saveDescription(doc: TiptapDoc | null): Promise<boolean> {
    return board.updateTask(taskId, { description: doc });
  }

  async function uploadImage(file: File): Promise<string | null> {
    const image = await board.uploadTaskImage(taskId, file);
    return image?.url ?? null;
  }

  function handleDelete(): void {
    if (!confirmingDelete) {
      confirmingDelete = true;
      return;
    }
    void board.deleteTask(taskId);
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
        <input
          value={titleDraft ?? task.title}
          aria-label="Task title"
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
        <Button variant="ghost" aria-label="Close" onclick={close}>✕</Button>
      </div>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold text-muted">Description</h3>
        {#key taskId}
          <RichTextEditor content={task.description} onSave={saveDescription} {uploadImage} />
        {/key}
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold text-muted">Labels</h3>
        <LabelPicker {taskId} />
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold text-muted">Assignees</h3>
        <AssigneePicker {taskId} />
      </section>

      <section class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold text-muted">Blockers</h3>
          {#if openBlockerCount > 0}
            <Badge variant="danger">
              Blocked by {openBlockerCount} open task{openBlockerCount === 1 ? '' : 's'}
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
                <button
                  type="button"
                  aria-label="Remove blocker {blocker.title}"
                  onclick={() => void board.removeBlocker(taskId, blocker.id)}
                  class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-danger"
                >
                  Remove
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        <BlockerPicker {taskId} />
      </section>

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

      <div
        class="flex flex-col gap-3 border-t border-edge pt-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <p class="text-xs text-muted">
          Created {dateFormat.format(new Date(task.created_at))} · Updated {dateFormat.format(
            new Date(task.updated_at)
          )}
        </p>
        <Button variant="danger" onclick={handleDelete}>
          {confirmingDelete ? 'Confirm delete' : 'Delete task'}
        </Button>
      </div>
    {/if}
  </div>
</dialog>
