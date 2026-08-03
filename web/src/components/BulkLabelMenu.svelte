<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { selection } from '../lib/selection.svelte';
  import ColorDot from './ui/ColorDot.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let query = $state('');
  let highlighted = $state(0);

  // Read live rather than snapshotted on open, so a card a teammate deletes
  // leaves the target set without a line of code here.
  const ids = $derived(selection.selectedIds);
  const tasks = $derived.by(() => {
    const wanted = new Set(ids);
    return board.tasks.filter((task) => wanted.has(task.id));
  });
  const filtered = $derived(
    board.labels.filter((label) => label.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  function held(labelId: string): 'all' | 'some' | 'none' {
    const count = tasks.filter((task) => task.label_ids.includes(labelId)).length;
    if (count === 0) {
      return 'none';
    }
    return count === tasks.length ? 'all' : 'some';
  }

  function toggle(labelId: string): void {
    void board.bulkSetLabel([...ids], labelId, held(labelId) !== 'all');
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = Math.min(filtered.length - 1, highlighted + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(0, highlighted - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const label = filtered[highlighted];
      if (label !== undefined) {
        toggle(label.id);
      }
    }
  }

  const focusOnMount = (node: HTMLInputElement): void => {
    node.focus();
  };
</script>

<Modal open title="Labels on {ids.length} card{ids.length === 1 ? '' : 's'}" {onclose}>
  <div class="flex flex-col gap-2">
    <input
      bind:value={query}
      use:focusOnMount
      {onkeydown}
      oninput={() => (highlighted = 0)}
      aria-label="Filter labels"
      placeholder="Filter labels"
      class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
    />
    <div class="flex max-h-64 flex-col gap-1 overflow-y-auto" role="group" aria-label="Labels">
      {#each filtered as label, i (label.id)}
        {@const state = held(label.id)}
        <button
          type="button"
          aria-pressed={state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'}
          onclick={() => toggle(label.id)}
          onpointermove={() => (highlighted = i)}
          class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {highlighted ===
          i
            ? 'bg-accent-soft'
            : 'hover:bg-accent-soft'} {state === 'none' ? 'text-ink' : 'text-accent-strong'}"
        >
          <ColorDot color={label.color} size="sm" />
          <span class="min-w-0 flex-1 truncate">{label.name}</span>
          {#if state === 'all'}
            <span aria-hidden="true">✓</span>
          {:else if state === 'some'}
            <span aria-hidden="true">–</span>
          {/if}
        </button>
      {/each}
      {#if filtered.length === 0}
        <p class="px-3 py-2 text-sm text-muted">No matching labels.</p>
      {/if}
    </div>
  </div>
</Modal>
