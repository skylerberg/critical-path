<script lang="ts">
  import { board } from '../lib/board.svelte';
  import ColorDot from './ui/ColorDot.svelte';

  interface Props {
    taskId: string;
    autofocus?: boolean;
  }

  let { taskId, autofocus = false }: Props = $props();

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

  let query = $state('');
  let highlighted = $state(0);

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const selectedIds = $derived(new Set(task?.label_ids ?? []));
  const trimmed = $derived(query.trim());
  const filtered = $derived(
    board.labels.filter((label) => label.name.toLowerCase().includes(trimmed.toLowerCase()))
  );
  const showCreate = $derived(
    trimmed !== '' &&
      !board.labels.some((label) => label.name.toLowerCase() === trimmed.toLowerCase())
  );
  const rowCount = $derived(filtered.length + (showCreate ? 1 : 0));

  function toggle(labelId: string): void {
    const current = task?.label_ids ?? [];
    const next = current.includes(labelId)
      ? current.filter((id) => id !== labelId)
      : [...current, labelId];
    void board.setTaskLabels(taskId, next);
  }

  async function createAndApply(): Promise<void> {
    const name = trimmed;
    if (name === '') {
      return;
    }
    const existing = new Set(board.labels.map((label) => label.id));
    const color = PALETTE[board.labels.length % PALETTE.length]!;
    query = '';
    highlighted = 0;
    const create = board.createLabel(name, color);
    const created = board.labels.find((label) => !existing.has(label.id));
    // Applying the label PUTs its id; wait for the create's POST to commit first,
    // or the PUT can arrive before the label row exists and be rejected with a 422.
    try {
      await create;
    } catch {
      return;
    }
    if (created === undefined) {
      return;
    }
    await board.setTaskLabels(taskId, [...(task?.label_ids ?? []), created.id]);
  }

  function activate(index: number): void {
    if (showCreate && index === 0) {
      void createAndApply();
      return;
    }
    const label = filtered[index - (showCreate ? 1 : 0)];
    if (label !== undefined) {
      toggle(label.id);
    }
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = Math.min(rowCount - 1, highlighted + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(0, highlighted - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(highlighted);
    }
  }

  const maybeFocus = (node: HTMLInputElement): void => {
    if (autofocus) {
      node.focus();
    }
  };
</script>

<div class="flex flex-col gap-2">
  <input
    bind:value={query}
    use:maybeFocus
    {onkeydown}
    oninput={() => (highlighted = 0)}
    aria-label="Filter labels"
    placeholder="Filter or create a label"
    class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
  />
  <div class="flex flex-col gap-1" role="group" aria-label="Labels">
    {#if showCreate}
      <button
        type="button"
        onclick={createAndApply}
        onpointermove={() => (highlighted = 0)}
        class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {highlighted ===
        0
          ? 'bg-accent-soft text-ink'
          : 'text-muted hover:bg-accent-soft hover:text-ink'}"
      >
        Create "{trimmed}"
      </button>
    {/if}
    {#each filtered as label, i (label.id)}
      {@const index = i + (showCreate ? 1 : 0)}
      <button
        type="button"
        aria-pressed={selectedIds.has(label.id)}
        onclick={() => toggle(label.id)}
        onpointermove={() => (highlighted = index)}
        class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {highlighted ===
        index
          ? 'bg-accent-soft'
          : 'hover:bg-accent-soft'} {selectedIds.has(label.id) ? 'text-accent-strong' : 'text-ink'}"
      >
        <ColorDot color={label.color} size="sm" />
        <span class="min-w-0 flex-1 truncate">{label.name}</span>
        {#if selectedIds.has(label.id)}
          <span aria-hidden="true">✓</span>
        {/if}
      </button>
    {/each}
    {#if rowCount === 0}
      <p class="px-3 py-2 text-sm text-muted">No labels yet. Type to create one.</p>
    {/if}
  </div>
</div>
