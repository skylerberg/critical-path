<script lang="ts">
  import { board } from '../lib/board.svelte';
  import type { DependencyDirection } from '../lib/dependency-types';
  import Input from './ui/Input.svelte';

  type Row = { kind: 'create'; title: string } | { kind: 'task'; id: string; title: string };

  interface Props {
    taskId: string;
    direction: DependencyDirection;
    autofocus?: boolean;
  }

  let { taskId, direction, autofocus = false }: Props = $props();

  let query = $state('');
  let highlightedKey = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLUListElement>();

  const task = $derived(board.tasks.find((t) => t.id === taskId));

  const excludedIds = $derived.by(() => {
    if (direction === 'blocker') {
      return new Set<string>([taskId, ...(task?.blocker_ids ?? [])]);
    }
    const dependentIds = board.tasks.filter((t) => t.blocker_ids.includes(taskId)).map((t) => t.id);
    return new Set<string>([taskId, ...dependentIds]);
  });

  const candidates = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    return board.tasks
      .filter((t) => !excludedIds.has(t.id) && t.title.toLowerCase().includes(q))
      .slice(0, 8);
  });

  const trimmed = $derived(query.trim());
  const showCreate = $derived(
    trimmed !== '' && !board.tasks.some((t) => t.title.toLowerCase() === trimmed.toLowerCase())
  );

  const label = $derived(
    direction === 'blocker' ? 'Search tasks that block this one' : 'Search tasks this one blocks'
  );

  // Create sits last, unlike the label picker's: a stray Enter mid-typing should
  // pick an existing task, because an accidentally created task lands on the board
  // for every collaborator and there is no undo.
  function rowKey(row: Row): string {
    return row.kind === 'create' ? 'create' : `task:${row.id}`;
  }

  const rows = $derived<Row[]>([
    ...candidates.map((t) => ({ kind: 'task', id: t.id, title: t.title }) as const),
    ...(showCreate ? [{ kind: 'create', title: trimmed } as const] : []),
  ]);

  // The highlight tracks a row's identity, not its index: when a realtime update
  // removes the highlighted task it falls back to the top rather than sliding
  // down onto Create, where Enter would create a task nobody asked for.
  const activeIndex = $derived.by(() => {
    if (rows.length === 0) return -1;
    const index = rows.findIndex((row) => rowKey(row) === highlightedKey);
    return index === -1 ? 0 : index;
  });

  function activate(index: number): void {
    const row = rows[index];
    if (row === undefined) {
      return;
    }
    if (row.kind === 'create') {
      void board.createAndLinkTask(
        row.title,
        direction === 'blocker' ? { blockerOf: taskId } : { blockedBy: taskId }
      );
    } else if (direction === 'blocker') {
      void board.addBlocker(taskId, row.id);
    } else {
      void board.addBlocker(row.id, taskId);
    }
    reset();
  }

  // The rows unmount with the query, so focus has to be put back somewhere; the
  // search field is what makes adding several dependencies in a row possible.
  function reset(): void {
    query = '';
    highlightedKey = null;
    inputEl?.focus();
  }

  // Safe to read the DOM before Svelte re-renders: arrow keys move the highlight
  // but never change the row set.
  function revealHighlighted(): void {
    const target = listEl?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (target == null) {
      return;
    }
    target.scrollIntoView({ block: 'nearest' });
    // Dragging focus along with the highlight keeps Enter and the row's own click
    // activating the same task; arrowing from the search field must not steal focus
    // away from it.
    if (listEl?.contains(document.activeElement) === true) {
      target.focus();
    }
  }

  function onkeydown(event: KeyboardEvent, rowIndex?: number): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (rows.length === 0) {
        return;
      }
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.min(rows.length - 1, Math.max(0, activeIndex + delta));
      highlightedKey = rowKey(rows[next]!);
      revealHighlighted();
    } else if (event.key === 'Enter') {
      // A composing IME commits its candidate with Enter; that keystroke is not
      // a selection.
      if (event.isComposing) {
        return;
      }
      event.preventDefault();
      activate(rowIndex ?? activeIndex);
    } else if (event.key === 'Escape' && trimmed !== '') {
      // preventDefault suppresses the enclosing <dialog>'s close request so only the
      // suggestions collapse; stopPropagation keeps it away from window shortcuts.
      event.preventDefault();
      event.stopPropagation();
      reset();
    }
  }
</script>

<div class="flex flex-col gap-2">
  <Input
    bind:value={query}
    bind:element={inputEl}
    {autofocus}
    {onkeydown}
    oninput={() => (highlightedKey = null)}
    aria-label={label}
    placeholder="{label}…"
    autocapitalize="sentences"
  />
  {#if trimmed !== ''}
    {#if rows.length === 0}
      <p class="text-sm text-muted">No matching tasks.</p>
    {:else}
      <ul
        bind:this={listEl}
        aria-label={direction === 'blocker'
          ? 'Blocking task suggestions'
          : 'Blocked task suggestions'}
        class="flex flex-col divide-y divide-edge overflow-hidden rounded-md border border-edge"
      >
        {#each rows as row, index (row.kind === 'task' ? row.id : 'create')}
          <li>
            <button
              type="button"
              data-index={index}
              onclick={() => activate(index)}
              onkeydown={(event) => onkeydown(event, index)}
              onfocus={() => (highlightedKey = rowKey(row))}
              onpointermove={() => (highlightedKey = rowKey(row))}
              class="flex min-h-11 w-full cursor-pointer items-center gap-2 border-l-2 px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent {index ===
              activeIndex
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-transparent hover:bg-accent-soft'} {row.kind === 'create'
                ? 'font-medium'
                : ''}"
            >
              <span class="text-accent" aria-hidden="true">+</span>
              <span class="min-w-0 flex-1 truncate"
                >{row.kind === 'create' ? `Create "${row.title}"` : row.title}</span
              >
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
