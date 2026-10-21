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
  import { board } from '../lib/board.svelte';
  import type { BoardLabel } from '../lib/board-types';
  import { DROP_TARGET_STYLE, flipDuration } from '../lib/dnd';
  import { motion } from '../lib/motion.svelte';
  import {
    neighborsAtIndex,
    placeBetweenNeighbors,
    type Keyed,
    type Neighbors,
    type Placement,
  } from '../lib/ranks';
  import { isDragPlaceholder } from '../lib/short-links';
  import Button from './ui/Button.svelte';
  import ColorDot from './ui/ColorDot.svelte';
  import Input from './ui/Input.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    open?: boolean;
    onclose: () => void;
  }

  let { open = false, onclose }: Props = $props();

  const PALETTE = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#14b8a6',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#78716c',
    '#64748b',
  ];
  const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

  let formOpen = $state(false);
  let editingId = $state<string | null>(null);
  let name = $state('');
  let color = $state(PALETTE[0]!);
  let formError = $state('');

  // The drawn list, not the board's: it stops resyncing for the whole of a
  // drag and holds a placeholder whose fields are the library's, not ours.
  let localLabels = $state<BoardLabel[]>([]);
  let dragging = $state(false);
  let dragOrigin: number | null = null;

  $effect(() => {
    if (!dragging) {
      localLabels = [...board.labels];
    }
  });

  function startCreate(): void {
    editingId = null;
    name = '';
    color = PALETTE[board.labels.length % PALETTE.length]!;
    formError = '';
    formOpen = true;
  }

  function startEdit(label: BoardLabel): void {
    editingId = label.id;
    name = label.name;
    color = label.color;
    formError = '';
    formOpen = true;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      formError = 'Name is required';
      return;
    }
    if (!HEX_PATTERN.test(color)) {
      formError = 'Color must be a hex value like #4f46e5';
      return;
    }
    formError = '';
    try {
      if (editingId === null) {
        await board.createLabel(trimmed, color.toLowerCase());
      } else {
        await board.updateLabel(editingId, { name: trimmed, color: color.toLowerCase() });
      }
      formOpen = false;
    } catch {
      formError = `A label named "${trimmed}" already exists in this project`;
    }
  }

  // The board's placementAfterDrop keys its search off every row holding a
  // rank, which a label only just created — its echo still in flight — does
  // not. The modal's list is the whole scope in rank order, so the slot alone
  // names the neighbors; the key comes from the rows that have one.
  function labelDrop(
    items: readonly BoardLabel[],
    movedId: string
  ): { placement: Placement; intent: Neighbors } | null {
    const index = items.findIndex((item) => item.id === movedId);
    if (index === -1) {
      return null;
    }
    const others = items.filter((item) => item.id !== movedId);
    const intent = neighborsAtIndex(others, index);
    const keyed = others.filter((item): item is Keyed & BoardLabel => item.sort_key !== null);
    return { placement: placeBetweenNeighbors(keyed, intent).placement, intent };
  }

  // A keyboard drag fires finalize on every arrow press and ends only with the
  // DRAG_STOPPED consider, so the flag must survive these finalizes.
  function handleConsider(event: CustomEvent<DndEvent<BoardLabel>>): void {
    if (event.detail.info.trigger === TRIGGERS.DRAG_STARTED) {
      dragOrigin = localLabels.findIndex((label) => label.id === event.detail.info.id);
    }
    dragging = event.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
    localLabels = event.detail.items;
  }

  function handleFinalize(event: CustomEvent<DndEvent<BoardLabel>>): void {
    const items = event.detail.items.filter((label) => label.id !== SHADOW_PLACEHOLDER_ITEM_ID);
    localLabels = items;
    // Keyboard drags finalize on EVERY arrow press; the flag clearing lives in
    // handleConsider's DRAG_STOPPED arm for that reason.
    dragging = event.detail.info.source === SOURCES.KEYBOARD;
    if (event.detail.info.trigger !== TRIGGERS.DROPPED_INTO_ZONE) {
      return;
    }
    const origin = dragOrigin;
    dragOrigin = null;
    // A label put back where it started is not a move: sending one anyway
    // would renumber it and broadcast a realtime update for nothing.
    if (origin === items.findIndex((label) => label.id === event.detail.info.id)) {
      return;
    }
    const drop = labelDrop(items, event.detail.info.id);
    if (drop === null) {
      return;
    }
    void board.moveLabel(event.detail.info.id, drop.placement, drop.intent);
  }
</script>

<Modal {open} title="Labels" {onclose}>
  {#if localLabels.length === 0}
    <p class="text-sm text-muted">No labels yet. Create one to categorize tasks.</p>
  {:else}
    <ul
      aria-label="Labels"
      use:dragHandleZone={{
        items: localLabels,
        type: 'label-manager',
        flipDurationMs: flipDuration(),
        dropAnimationDisabled: motion.reduced,
        dropTargetStyle: DROP_TARGET_STYLE,
        dropFromOthersDisabled: true,
        zoneItemTabIndex: 0,
      }}
      onconsider={handleConsider}
      onfinalize={handleFinalize}
      class="flex flex-col"
    >
      {#each localLabels as label (label.id)}
        <!-- The drag placeholder is a full clone of the lifted row with only its
             id swapped for a sentinel, so it draws as an ordinary row. Every
             control on it is disabled or absent: each would address an id no
             label has. -->
        {@const inert = isDragPlaceholder(label.id)}
        <li animate:flip={{ duration: flipDuration() }} class="flex min-h-11 items-center gap-2">
          {#if !inert}
            <span
              use:dragHandle
              aria-label="Reorder {label.name}"
              class="flex min-h-11 w-6 shrink-0 cursor-grab items-center justify-center text-muted"
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
          <ColorDot color={label.color} />
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{label.name}</span>
          <button
            type="button"
            disabled={inert}
            onclick={() => startEdit(label)}
            class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-ink"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={inert}
            onclick={() => void board.deleteLabel(label.id)}
            class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-danger"
          >
            Delete
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if formOpen}
    <form
      onsubmit={submit}
      class="mt-4 flex flex-col gap-3 border-t border-edge pt-4"
      aria-label={editingId === null ? 'New label' : 'Edit label'}
    >
      <Input label="Name" bind:value={name} placeholder="Label name" autocapitalize="sentences" />
      <div class="flex flex-wrap gap-2" role="group" aria-label="Color palette">
        {#each PALETTE as swatch (swatch)}
          <button
            type="button"
            aria-label="Use color {swatch}"
            aria-pressed={color.toLowerCase() === swatch}
            onclick={() => (color = swatch)}
            style="background-color: {swatch}"
            class="size-11 cursor-pointer rounded-md {color.toLowerCase() === swatch
              ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface'
              : ''}"
          ></button>
        {/each}
      </div>
      <Input label="Custom color" bind:value={color} placeholder="#4f46e5" />
      {#if formError !== ''}
        <p role="alert" class="text-sm text-danger">{formError}</p>
      {/if}
      <div class="flex justify-end gap-2">
        <Button variant="secondary" onclick={() => (formOpen = false)}>Cancel</Button>
        <Button type="submit">{editingId === null ? 'Create label' : 'Save'}</Button>
      </div>
    </form>
  {:else}
    <div class="mt-4">
      <Button variant="secondary" onclick={startCreate}>New label</Button>
    </div>
  {/if}
</Modal>
