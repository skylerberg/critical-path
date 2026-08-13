<script lang="ts">
  import { untrack } from 'svelte';
  import { focusIf } from '../lib/actions';
  import { board, type BoardContext } from '../lib/board.svelte';
  import { ListNav } from '../lib/list-nav.svelte';
  import { toggleMembership } from '../lib/multi-select';
  import ColorDot from './ui/ColorDot.svelte';

  interface Props {
    taskId: string;
    ctx?: BoardContext;
    autofocus?: boolean;
    prefill?: string;
    onclose?: () => void;
  }

  let { taskId, ctx = board, autofocus = false, prefill = '', onclose }: Props = $props();

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

  // Create has no id of its own, and it sits first here, so it needs a key that no
  // label can collide with.
  const CREATE_KEY = 'create';

  let query = $state(untrack(() => prefill));
  let listEl = $state<HTMLDivElement>();

  const task = $derived(ctx.tasks.find((t) => t.id === taskId));
  const selectedIds = $derived(new Set(task?.label_ids ?? []));
  const trimmed = $derived(query.trim());
  const filtered = $derived(
    ctx.labels.filter((label) => label.name.toLowerCase().includes(trimmed.toLowerCase()))
  );
  const showCreate = $derived(
    trimmed !== '' &&
      !ctx.labels.some((label) => label.name.toLowerCase() === trimmed.toLowerCase())
  );
  // Inert rather than first, and that choice is load-bearing: Create is row 0
  // here, so a highlighted label deleted under the menu would otherwise send
  // Enter to "create a label nobody asked for".
  const nav = new ListNav({
    keys: () => [...(showCreate ? [CREATE_KEY] : []), ...filtered.map((label) => label.id)],
    list: () => listEl,
    missing: 'inert',
  });

  function toggle(labelId: string): void {
    void ctx.setTaskLabels(taskId, toggleMembership(task?.label_ids ?? [], labelId));
  }

  async function createAndApply(): Promise<void> {
    const name = trimmed;
    if (name === '') {
      return;
    }
    const existing = new Set(ctx.labels.map((label) => label.id));
    const color = PALETTE[ctx.labels.length % PALETTE.length]!;
    query = '';
    nav.clear();
    if (listEl !== undefined) {
      listEl.scrollTop = 0;
    }
    const create = ctx.createLabel(name, color);
    const created = ctx.labels.find((label) => !existing.has(label.id));
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
    await ctx.setTaskLabels(taskId, [...(task?.label_ids ?? []), created.id]);
  }

  function activate(key: string | null): void {
    if (key === null) {
      return;
    }
    if (key === CREATE_KEY) {
      void createAndApply();
      return;
    }
    toggle(key);
  }

  function onkeydown(event: KeyboardEvent, rowKey?: string): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (nav.move(event.key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(rowKey ?? nav.activeKey);
    } else if (event.key === 'Escape' && onclose !== undefined) {
      // preventDefault suppresses the enclosing <dialog>'s close request so only
      // the picker collapses; stopPropagation keeps it away from window shortcuts.
      event.preventDefault();
      event.stopPropagation();
      onclose();
    }
  }

  function oninput(): void {
    nav.clear();
    if (listEl !== undefined) {
      listEl.scrollTop = 0;
    }
  }
</script>

<div class="flex flex-col gap-2">
  <input
    bind:value={query}
    use:focusIf={{ active: autofocus }}
    {onkeydown}
    {oninput}
    aria-label="Filter labels"
    placeholder="Filter or create a label"
    autocapitalize="sentences"
    class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm focus-ring focus:border-accent"
  />
  <div
    bind:this={listEl}
    class="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain"
    role="group"
    aria-label="Labels"
  >
    {#if showCreate}
      <button
        type="button"
        data-index={0}
        onclick={createAndApply}
        onkeydown={(event) => onkeydown(event, CREATE_KEY)}
        onfocus={() => nav.highlight(CREATE_KEY)}
        onpointermove={() => nav.highlight(CREATE_KEY)}
        class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {nav.index ===
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
        data-index={index}
        aria-pressed={selectedIds.has(label.id)}
        onclick={() => toggle(label.id)}
        onkeydown={(event) => onkeydown(event, label.id)}
        onfocus={() => nav.highlight(label.id)}
        onpointermove={() => nav.highlight(label.id)}
        class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm font-medium {nav.index ===
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
    {#if !showCreate && filtered.length === 0}
      <p class="px-3 py-2 text-sm text-muted">No labels yet. Type to create one.</p>
    {/if}
  </div>
</div>
