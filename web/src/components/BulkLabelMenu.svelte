<script lang="ts">
  import { focusOnMount } from '../lib/actions';
  import { board } from '../lib/board.svelte';
  import { ListNav } from '../lib/list-nav.svelte';
  import { heldBy, type Held } from '../lib/multi-select';
  import { selection } from '../lib/selection.svelte';
  import ColorDot from './ui/ColorDot.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let query = $state('');
  let listEl = $state<HTMLDivElement>();

  const ids = $derived(selection.selectedIds);
  const tasks = $derived.by(() => {
    const wanted = new Set(ids);
    return board.tasks.filter((task) => wanted.has(task.id));
  });
  const filtered = $derived(
    board.labels.filter((label) => label.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  // Inert rather than first: a teammate deleting the highlighted label would
  // otherwise slide Enter onto whichever label is now on top, and this toggles it
  // across every selected card.
  const nav = new ListNav({
    keys: () => filtered.map((label) => label.id),
    list: () => listEl,
    missing: 'inert',
  });

  function held(labelId: string): Held {
    return heldBy(tasks, (task) => task.label_ids.includes(labelId));
  }

  function toggle(labelId: string): void {
    void board.bulkSetLabel([...ids], labelId, held(labelId) !== 'all');
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (nav.move(event.key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (nav.activeKey !== null) {
        toggle(nav.activeKey);
      }
    }
  }
</script>

<Modal open title="Labels on {ids.length} card{ids.length === 1 ? '' : 's'}" {onclose}>
  <div class="flex flex-col gap-2">
    <input
      bind:value={query}
      use:focusOnMount
      {onkeydown}
      oninput={() => nav.clear()}
      aria-label="Filter labels"
      placeholder="Filter labels"
      class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
    />
    <div
      bind:this={listEl}
      class="flex max-h-64 flex-col gap-1 overflow-y-auto"
      role="group"
      aria-label="Labels"
    >
      {#each filtered as label, i (label.id)}
        {@const state = held(label.id)}
        <button
          type="button"
          data-index={i}
          aria-pressed={state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'}
          onclick={() => toggle(label.id)}
          onpointermove={() => nav.highlight(label.id)}
          class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {nav.index ===
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
