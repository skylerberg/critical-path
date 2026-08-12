<script lang="ts">
  import { flip } from 'svelte/animate';
  import {
    dragHandle,
    dragHandleZone,
    SHADOW_PLACEHOLDER_ITEM_ID,
    SOURCES,
    TRIGGERS,
    type DndEvent,
  } from 'svelte-dnd-action';
  import { board, placementAfterDrop } from '../lib/board.svelte';
  import type { ChecklistItem } from '../lib/board-types';
  import { motion } from '../lib/motion.svelte';
  import { router } from '../lib/router.svelte';
  import { isDragPlaceholder } from '../lib/short-links';
  import { TASK_TITLE_MAX_LENGTH } from '../lib/titles';
  import Button from './ui/Button.svelte';

  interface Props {
    taskId: string;
    // Built by the route, which is the only place that knows the view, the active
    // filters and the return marker a card URL has to carry.
    taskPath: (id: string) => string;
    readonly?: boolean;
  }

  let { taskId, taskPath, readonly = false }: Props = $props();

  const FLIP_MS = 150;
  const dropTargetStyle = { outline: '2px solid var(--cp-accent)', outlineOffset: '-2px' };

  const flipMs = $derived(motion.reduced ? 0 : FLIP_MS);
  const task = $derived(board.tasks.find((t) => t.id === taskId));
  // The card's counts, never the drawn list: that list stops resyncing for the whole
  // of a drag and holds a placeholder whose fields are the library's, not ours.
  const total = $derived(task?.checklist_item_count ?? 0);
  const done = $derived(task?.checklist_done_count ?? 0);

  let localItems = $state<ChecklistItem[]>([]);
  let dragging = $state(false);
  let dragOrigin: number | null = null;
  let draft = $state('');
  let addInput = $state<HTMLInputElement>();
  let editingId = $state<string | null>(null);
  let editDraft = $state('');
  let confirmingDeleteId = $state<string | null>(null);
  let promotingId = $state<string | null>(null);
  let mounted = true;

  // Declared above the reset below, and it matters: Svelte runs each effect's
  // teardown immediately before that same effect's body, so this one still sees the
  // open edit and sends it to the card it was typed on rather than the one arriving.
  // On a plain unmount it is the only thing that runs at all — removing a focused
  // input is not a blur, so nothing else would save it.
  $effect(() => {
    const id = taskId;
    return () => {
      if (editingId !== null) {
        commitEdit(editingId, id);
      }
    };
  });

  $effect(() => {
    void taskId;
    dragging = false;
    dragOrigin = null;
    draft = '';
    editingId = null;
    confirmingDeleteId = null;
    promotingId = null;
  });

  $effect(() => {
    if (!dragging) {
      localItems = [...(board.taskChecklists[taskId] ?? [])];
    }
  });

  // The teardown is load-bearing: most dismissals (Back, a sidebar link, the auth
  // redirect) unmount this with no close handler ever running, and nothing else
  // lowers the flag until the next project load. A keyboard drag abandoned by Escape
  // would otherwise latch it on and buffer every realtime board event for the rest
  // of the session, with nothing to say so and no way back.
  $effect(() => {
    board.detailDragging = dragging;
    return () => {
      board.detailDragging = false;
    };
  });

  $effect(() => () => {
    mounted = false;
  });

  // Keyboard drags end with a consider event (trigger DRAG_STOPPED), not a
  // finalize, so the dragging flag must reset here too.
  function handleConsider(event: CustomEvent<DndEvent<ChecklistItem>>): void {
    if (event.detail.info.trigger === TRIGGERS.DRAG_STARTED) {
      dragOrigin = localItems.findIndex((item) => item.id === event.detail.info.id);
    }
    dragging = event.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
    localItems = event.detail.items;
  }

  function handleFinalize(event: CustomEvent<DndEvent<ChecklistItem>>): void {
    const items = event.detail.items.filter((item) => item.id !== SHADOW_PLACEHOLDER_ITEM_ID);
    localItems = items;
    // Keyboard drags finalize on EVERY arrow press; the drag only ends with the
    // DRAG_STOPPED consider, so the flag must survive keyboard finalizes.
    dragging = event.detail.info.source === SOURCES.KEYBOARD;
    if (event.detail.info.trigger !== TRIGGERS.DROPPED_INTO_ZONE) {
      return;
    }
    const origin = dragOrigin;
    dragOrigin = null;
    // An item put back where it was is not a move: writing one would renumber it
    // and fan a realtime update out to everyone else for nothing.
    if (origin === items.findIndex((item) => item.id === event.detail.info.id)) {
      return;
    }
    void board.moveChecklistItem(
      taskId,
      event.detail.info.id,
      placementAfterDrop(items, event.detail.info.id)
    );
  }

  const focusAndSelect = (node: HTMLInputElement): void => {
    node.focus();
    node.select();
  };

  // The quick bar reveals an empty checklist; the field it should land in is here.
  export function focusAddItem(): void {
    addInput?.focus();
    addInput?.scrollIntoView({ block: 'nearest' });
  }

  function submitDraft(event: SubmitEvent): void {
    event.preventDefault();
    const text = draft.trim();
    if (text === '') {
      return;
    }
    void board.addChecklistItem(taskId, text);
    draft = '';
    addInput?.focus();
  }

  function startEdit(item: ChecklistItem): void {
    editingId = item.id;
    editDraft = item.text;
    confirmingDeleteId = null;
  }

  // Enter commits and unmounts the input, so the blur that follows finds the edit
  // already closed and this returns without writing it twice. `id` is a parameter
  // for the teardown flush alone, which runs once taskId has already moved on.
  function commitEdit(itemId: string, id: string = taskId): void {
    if (editingId !== itemId) {
      return;
    }
    editingId = null;
    const text = editDraft.trim();
    const current = localItems.find((item) => item.id === itemId)?.text;
    if (text !== '' && text !== current) {
      void board.renameChecklistItem(id, itemId, text);
    }
  }

  function requestDelete(itemId: string): void {
    if (confirmingDeleteId !== itemId) {
      confirmingDeleteId = itemId;
      return;
    }
    confirmingDeleteId = null;
    void board.deleteChecklistItem(taskId, itemId);
  }

  async function promote(itemId: string): Promise<void> {
    promotingId = itemId;
    const source = taskId;
    try {
      const id = await board.promoteChecklistItem(source, itemId);
      if (id !== null && mounted && source === taskId) {
        router.navigate(taskPath(id));
      }
    } finally {
      promotingId = null;
    }
  }

  const actionClass =
    'flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent';
</script>

<div class="flex flex-col gap-2">
  {#if total > 0}
    <div class="flex items-center gap-2">
      <div
        role="progressbar"
        aria-label="Checklist progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext="{done} of {total} done"
        class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-edge"
      >
        <div
          class="h-full rounded-full {done === total ? 'bg-success' : 'bg-accent'}"
          style="width: {(done / total) * 100}%"
        ></div>
      </div>
      <span class="shrink-0 text-xs {done === total ? 'text-success' : 'text-muted'}">
        {done}/{total}
      </span>
    </div>
  {/if}

  {#if localItems.length > 0}
    <div
      aria-label="Checklist items"
      use:dragHandleZone={{
        items: localItems,
        type: 'checklist',
        flipDurationMs: flipMs,
        dropAnimationDisabled: motion.reduced,
        dropTargetStyle,
        dropFromOthersDisabled: true,
        dragDisabled: readonly,
        zoneItemTabIndex: readonly ? -1 : 0,
      }}
      onconsider={handleConsider}
      onfinalize={handleFinalize}
      class="flex flex-col"
    >
      {#each localItems as item (item.id)}
        <!-- The drag placeholder is a full clone of the lifted row with only its id
             swapped for a sentinel, so it draws as an ordinary row. Every control on
             it is disabled or absent: each would address an id no row has. -->
        {@const inert = readonly || isDragPlaceholder(item.id)}
        <div
          animate:flip={{ duration: flipMs }}
          aria-label={item.text}
          class="group flex items-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-accent"
        >
          {#if !inert}
            <span
              use:dragHandle
              aria-label="Reorder {item.text}"
              class="flex min-h-11 w-6 shrink-0 items-center justify-center text-muted"
            >
              <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="9" cy="6" r="1.5" />
                <circle cx="15" cy="6" r="1.5" />
                <circle cx="9" cy="12" r="1.5" />
                <circle cx="15" cy="12" r="1.5" />
                <circle cx="9" cy="18" r="1.5" />
                <circle cx="15" cy="18" r="1.5" />
              </svg>
            </span>
          {/if}
          <span class="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
            <input
              type="checkbox"
              class="size-4 accent-accent disabled:cursor-default"
              checked={item.checked}
              disabled={inert}
              aria-label={item.text}
              onchange={(event) =>
                void board.setChecklistItemChecked(taskId, item.id, event.currentTarget.checked)}
            />
          </span>
          {#if editingId === item.id}
            <input
              bind:value={editDraft}
              use:focusAndSelect
              aria-label="Rename {item.text}"
              maxlength={TASK_TITLE_MAX_LENGTH}
              autocapitalize="sentences"
              onblur={() => commitEdit(item.id)}
              onkeydown={(event) => {
                if (event.key === 'Enter') {
                  commitEdit(item.id);
                } else if (event.key === 'Escape') {
                  editingId = null;
                }
              }}
              class="min-h-11 w-full min-w-0 flex-1 rounded-md border border-accent bg-canvas px-2 text-sm outline-none"
            />
          {:else if inert}
            <span
              class="flex min-h-11 min-w-0 flex-1 items-center py-2 text-sm break-words {item.checked
                ? 'text-muted line-through'
                : ''}"
            >
              {item.text}
            </span>
          {:else}
            <button
              type="button"
              onclick={() => startEdit(item)}
              class="min-h-11 min-w-0 flex-1 cursor-text rounded-md px-1 py-2 text-left text-sm break-words focus-visible:outline-2 focus-visible:outline-accent {item.checked
                ? 'text-muted line-through'
                : ''}"
            >
              {item.text}
            </button>
          {/if}
          {#if !inert}
            <button
              type="button"
              aria-label="Convert {item.text} to a card"
              title="Convert to card"
              disabled={promotingId === item.id}
              onclick={() => void promote(item.id)}
              class="{actionClass} hover:bg-accent-soft hover:text-ink disabled:cursor-default disabled:opacity-50"
            >
              <svg
                class="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M12 8v8" />
                <path d="M8 12h8" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={confirmingDeleteId === item.id
                ? `Confirm delete of ${item.text}`
                : `Delete ${item.text}`}
              onclick={() => requestDelete(item.id)}
              class="{actionClass} hover:bg-accent-soft hover:text-danger {confirmingDeleteId ===
              item.id
                ? 'text-danger opacity-100'
                : ''}"
            >
              {#if confirmingDeleteId === item.id}
                <span class="text-xs font-medium">Sure?</span>
              {:else}
                <svg
                  class="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              {/if}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if !readonly}
    <form onsubmit={submitDraft} class="flex items-center gap-2">
      <input
        bind:this={addInput}
        bind:value={draft}
        maxlength={TASK_TITLE_MAX_LENGTH}
        aria-label="Checklist item"
        placeholder="Add an item"
        autocapitalize="sentences"
        class="min-h-11 min-w-0 flex-1 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
      />
      <Button type="submit" variant="secondary">Add</Button>
    </form>
  {/if}
</div>
