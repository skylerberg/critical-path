<script lang="ts">
  import { board, type BoardContext } from '../lib/board.svelte';
  import type { DependencyDirection } from '../lib/dependency-types';
  import { ListNav } from '../lib/list-nav.svelte';
  import { TASK_TITLE_MAX_LENGTH, truncateTitle } from '../lib/titles';
  import Input from './ui/Input.svelte';

  type Row = { kind: 'create'; title: string } | { kind: 'task'; id: string; title: string };

  interface Props {
    taskId: string;
    ctx?: BoardContext;
    direction: DependencyDirection;
    autofocus?: boolean;
  }

  let { taskId, ctx = board, direction, autofocus = false }: Props = $props();

  let query = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLUListElement>();

  const task = $derived(ctx.tasks.find((t) => t.id === taskId));

  const excludedIds = $derived.by(() => {
    if (direction === 'blocker') {
      return new Set<string>([taskId, ...(task?.blocker_ids ?? [])]);
    }
    const dependentIds = ctx.tasks.filter((t) => t.blocker_ids.includes(taskId)).map((t) => t.id);
    return new Set<string>([taskId, ...dependentIds]);
  });

  const candidates = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    return ctx.tasks
      .filter((t) => !excludedIds.has(t.id) && t.title.toLowerCase().includes(q))
      .slice(0, 8);
  });

  const trimmed = $derived(query.trim());
  const showCreate = $derived(
    trimmed !== '' && !ctx.tasks.some((t) => t.title.toLowerCase() === trimmed.toLowerCase())
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

  // A removed row falls back to the top rather than sliding down onto Create,
  // where Enter would create a task nobody asked for — which is safe only because
  // Create sits last here.
  const nav = new ListNav({
    keys: () => rows.map(rowKey),
    list: () => listEl,
    missing: 'first',
  });

  function activate(index: number): void {
    const row = rows[index];
    if (row === undefined) {
      return;
    }
    if (row.kind === 'create') {
      void ctx.createAndLinkTask(
        row.title,
        direction === 'blocker' ? { blockerOf: taskId } : { blockedBy: taskId }
      );
    } else if (direction === 'blocker') {
      void ctx.addBlocker(taskId, row.id);
    } else {
      void ctx.addBlocker(row.id, taskId);
    }
    reset();
  }

  // The rows unmount with the query, so focus has to be put back somewhere; the
  // search field is what makes adding several dependencies in a row possible.
  function reset(): void {
    query = '';
    nav.clear();
    inputEl?.focus();
  }

  function onkeydown(event: KeyboardEvent, rowIndex?: number): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // An arrow from a row moves from that row, as Enter activates it: the
      // pointer highlights whatever it rests over without moving focus, so
      // stepping from the highlight instead would skip the row in between — onto
      // Create, whose activation cannot be undone.
      const from = rowIndex === undefined ? undefined : rows[rowIndex];
      if (from !== undefined) {
        nav.highlight(rowKey(from));
      }
      if (nav.move(event.key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
      }
    } else if (event.key === 'Enter') {
      // A composing IME commits its candidate with Enter; that keystroke is not
      // a selection.
      if (event.isComposing) {
        return;
      }
      event.preventDefault();
      activate(rowIndex ?? nav.index);
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
    oninput={() => nav.clear()}
    aria-label={label}
    placeholder="{label}…"
    maxlength={TASK_TITLE_MAX_LENGTH}
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
        {#each rows as row, index (rowKey(row))}
          <li>
            <button
              type="button"
              data-index={index}
              onclick={() => activate(index)}
              onkeydown={(event) => onkeydown(event, index)}
              onfocus={() => nav.highlight(rowKey(row))}
              onpointermove={() => nav.highlight(rowKey(row))}
              class="flex min-h-11 w-full cursor-pointer items-center gap-2 border-l-2 px-3 text-left text-sm transition-colors focus-ring-inset {index ===
              nav.index
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-transparent hover:bg-accent-soft'} {row.kind === 'create'
                ? 'font-medium'
                : ''}"
            >
              <span class="text-accent" aria-hidden="true">+</span>
              <span class="min-w-0 flex-1 truncate"
                >{row.kind === 'create'
                  ? `Create "${truncateTitle(row.title)}"`
                  : truncateTitle(row.title)}</span
              >
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
