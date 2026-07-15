<script lang="ts">
  import { board } from '../lib/board.svelte';
  import type { BoardLabel } from '../lib/board-types';
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
</script>

<Modal {open} title="Labels" {onclose}>
  {#if board.labels.length === 0}
    <p class="text-sm text-muted">No labels yet. Create one to categorize tasks.</p>
  {:else}
    <ul class="flex flex-col">
      {#each board.labels as label (label.id)}
        <li class="flex min-h-11 items-center gap-2">
          <ColorDot color={label.color} />
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{label.name}</span>
          <button
            type="button"
            onclick={() => startEdit(label)}
            class="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm text-muted hover:bg-accent-soft hover:text-ink"
          >
            Edit
          </button>
          <button
            type="button"
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
      <Input label="Name" bind:value={name} placeholder="Label name" />
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
