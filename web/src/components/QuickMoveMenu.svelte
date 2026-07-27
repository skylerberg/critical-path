<script lang="ts">
  import { announcer } from '../lib/announcer.svelte';
  import { board } from '../lib/board.svelte';
  import type { BoardColumn } from '../lib/board-types';
  import { positionForIndex } from '../lib/positions';
  import Button from './ui/Button.svelte';
  import Input from './ui/Input.svelte';
  import Modal from './ui/Modal.svelte';

  // The slot is held as an identity, never a row index, so a realtime insert
  // between the keypress and the commit cannot shift the card onto another slot.
  type Target = { kind: 'top' } | { kind: 'bottom' } | { kind: 'before'; anchorId: string };
  type Row =
    | { key: string; label: string; kind: 'column'; columnId: string; current: boolean }
    | { key: string; label: string; kind: 'place'; target: Target };

  interface Props {
    taskId: string;
    onclose: () => void;
  }

  let { taskId, onclose }: Props = $props();

  let columnId = $state<string | null>(null);
  let query = $state('');
  let highlightedKey = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLUListElement>();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const targetColumn = $derived(
    columnId === null ? undefined : board.columns.find((c) => c.id === columnId)
  );
  // Position order rather than display order: with a filter on, the display list
  // partitions matches to the front, and the anchors have to describe the order
  // the move actually produces.
  const others = $derived(
    targetColumn === undefined
      ? []
      : board.tasksInColumn(targetColumn.id).filter((t) => t.id !== taskId)
  );

  const searchLabel = $derived(targetColumn === undefined ? 'Search columns' : 'Search positions');
  // Opened by a keystroke over whatever view was on screen, so the title has to
  // name the task: nothing else in the menu says which card is being moved.
  const title = $derived.by(() => {
    if (task === undefined) {
      return 'Move';
    }
    return targetColumn === undefined
      ? `Move — ${task.title}`
      : `Move to ${targetColumn.name} — ${task.title}`;
  });

  const rows = $derived.by<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (label: string): boolean => label.toLowerCase().includes(q);
    if (targetColumn === undefined) {
      return board.columns
        .filter((column) => matches(column.name))
        .map((column) => ({
          key: `column:${column.id}`,
          label: column.name,
          kind: 'column' as const,
          columnId: column.id,
          current: column.id === task?.column_id,
        }));
    }
    // The leading card's "Before" row is dropped: Top is already that slot, and
    // two rows with one outcome reads as a bug.
    const places: Row[] = [
      { key: 'top', label: 'Top', kind: 'place', target: { kind: 'top' } },
      ...others.slice(1).map<Row>((t) => ({
        key: `before:${t.id}`,
        label: `Before "${t.title}"`,
        kind: 'place',
        target: { kind: 'before', anchorId: t.id },
      })),
      { key: 'bottom', label: 'Bottom', kind: 'place', target: { kind: 'bottom' } },
    ];
    return places.filter((row) => matches(row.label));
  });

  // Keyed for the same reason as Target: rows shifting under the finger must not
  // move the highlight.
  const activeIndex = $derived.by(() => {
    if (rows.length === 0) return -1;
    const index = rows.findIndex((row) => row.key === highlightedKey);
    return index === -1 ? 0 : index;
  });

  $effect(() => {
    // A realtime delete can take the task out from under an open menu.
    if (task === undefined) {
      onclose();
    }
  });

  $effect(() => {
    if (columnId !== null && targetColumn === undefined) {
      back();
    }
  });

  function placeIndex(target: Target, rest: readonly { id: string }[]): number {
    if (target.kind === 'top') return 0;
    if (target.kind === 'bottom') return rest.length;
    const index = rest.findIndex((t) => t.id === target.anchorId);
    // The anchor went away under us; the bottom is the only slot still meaningful.
    return index === -1 ? rest.length : index;
  }

  function commit(column: BoardColumn, target: Target): void {
    const moving = task;
    if (moving === undefined) {
      return;
    }
    const rest = board.tasksInColumn(column.id).filter((t) => t.id !== taskId);
    const index = placeIndex(target, rest);
    void board.moveTask(
      taskId,
      column.id,
      positionForIndex(
        rest.map((t) => t.position),
        index
      )
    );
    // Close before announcing: this modal keeps the shell's live region inert.
    onclose();
    void announcer.announce(
      `Moved "${moving.title}" to ${column.name}, position ${index + 1} of ${rest.length + 1}`
    );
  }

  function activate(row: Row | undefined): void {
    if (row === undefined) {
      return;
    }
    if (row.kind === 'place') {
      if (targetColumn !== undefined) {
        commit(targetColumn, row.target);
      }
      return;
    }
    const column = board.columns.find((c) => c.id === row.columnId);
    if (column === undefined) {
      return;
    }
    // One possible slot is not a choice; skip a step whose rows all do the same thing.
    if (board.tasksInColumn(column.id).every((t) => t.id === taskId)) {
      commit(column, { kind: 'bottom' });
      return;
    }
    columnId = column.id;
    query = '';
    highlightedKey = null;
    inputEl?.focus();
  }

  function back(): void {
    columnId = null;
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
    // activating the same slot; arrowing from the search field must not steal focus
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
      highlightedKey = rows[next]!.key;
      revealHighlighted();
    } else if (event.key === 'Enter') {
      // A composing IME commits its candidate with Enter; that keystroke is not
      // a selection.
      if (event.isComposing) {
        return;
      }
      event.preventDefault();
      activate(rows[rowIndex ?? activeIndex]);
    } else if (event.key === 'Escape' && (query.trim() !== '' || columnId !== null)) {
      // preventDefault suppresses the enclosing <dialog>'s close request so only the
      // query or the step unwinds; stopPropagation keeps it away from window shortcuts.
      event.preventDefault();
      event.stopPropagation();
      if (query.trim() !== '') {
        query = '';
        highlightedKey = null;
      } else {
        back();
      }
    }
  }
</script>

<Modal open {title} {onclose}>
  <div class="flex flex-col gap-2">
    {#if targetColumn !== undefined}
      <!-- Touch has no Escape, so the way back to the column list has to be tappable. -->
      <Button variant="ghost" class="self-start px-2" onclick={back}>← Columns</Button>
    {/if}
    <Input
      bind:value={query}
      bind:element={inputEl}
      autofocus
      {onkeydown}
      oninput={() => (highlightedKey = null)}
      aria-label={searchLabel}
      placeholder="{searchLabel}…"
    />
    {#if rows.length === 0}
      <p class="text-sm text-muted">
        {targetColumn === undefined ? 'No matching columns.' : 'No matching positions.'}
      </p>
    {:else}
      <ul
        bind:this={listEl}
        aria-label={targetColumn === undefined ? 'Destination columns' : 'Positions'}
        class="flex max-h-64 flex-col divide-y divide-edge overflow-y-auto overscroll-contain rounded-md border border-edge"
      >
        {#each rows as row, index (row.key)}
          <li class="shrink-0">
            <button
              type="button"
              data-index={index}
              onclick={() => activate(row)}
              onkeydown={(event) => onkeydown(event, index)}
              onfocus={() => (highlightedKey = row.key)}
              onpointermove={() => (highlightedKey = row.key)}
              class="flex min-h-11 w-full cursor-pointer items-center gap-2 border-l-2 px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent {index ===
              activeIndex
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-transparent hover:bg-accent-soft'}"
            >
              <span class="min-w-0 flex-1 truncate">{row.label}</span>
              {#if row.kind === 'column' && row.current}
                <span class="shrink-0 text-xs text-muted">current</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</Modal>
