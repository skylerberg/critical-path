<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { announcer } from '../lib/announcer.svelte';
  import { board, type BoardContext } from '../lib/board.svelte';
  import { editableCardTarget } from '../lib/card-target';
  import { ListNav } from '../lib/list-nav.svelte';
  import {
    flattenRows,
    paletteGroups,
    type PaletteActionId,
    type PaletteRow,
  } from '../lib/palette';
  import { projects } from '../lib/projects.svelte';
  import { router, splitPath } from '../lib/router.svelte';
  import { SEARCH_DEBOUNCE_MS, SEARCH_MAX_QUERY_LENGTH } from '../lib/search-query';
  import { SearchStore } from '../lib/search.svelte';
  import { projectHref, taskHref } from '../lib/short-links';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import { currentProjectId, taskRoute } from '../lib/task-route.svelte';
  import { truncateTitle } from '../lib/titles';
  import { toasts } from '../lib/toasts.svelte';
  import Button from './ui/Button.svelte';
  import Input from './ui/Input.svelte';
  import Modal from './ui/Modal.svelte';
  import Spinner from './ui/Spinner.svelte';

  interface Props {
    ctx: BoardContext;
    onclose: () => void;
  }

  let { ctx, onclose }: Props = $props();

  // Its own store, never the shared one: opened over the search page it would
  // otherwise rewrite it behind the backdrop, and that page never self-heals.
  const paletteSearch = new SearchStore();

  let typed = $state('');
  let listEl = $state<HTMLElement>();
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchPending = $state(false);
  let committed = false;

  const listId = $props.id();
  const openedPathname = splitPath(router.path).pathname;

  const targetId = $derived(editableCardTarget());
  // A target absent from the payload — one whose project is still loading, an
  // archived card opened cold — is one the quick menus would close themselves over.
  const card = $derived(targetId === null ? undefined : ctx.tasks.find((t) => t.id === targetId));
  const completable = $derived(
    card !== undefined && ctx.doneColumnIds.size > 0 && !ctx.doneColumnIds.has(card.column_id)
  );

  const current = $derived.by(() => {
    const projectId = currentProjectId();
    return projectId === null
      ? null
      : {
          projectId,
          projectName: board.project?.name ?? '',
          filterSearch: board.filterSearch,
        };
  });

  const showSelectionHint = $derived.by(() => {
    const route = router.current;
    if (targetId !== null) {
      return false;
    }
    if (route.name === 'my-tasks' || route.name === 'search') {
      return true;
    }
    return (
      board.canEdit &&
      route.name === 'project' &&
      route.params.view === 'board' &&
      route.params.taskId === undefined
    );
  });

  const groups = $derived(
    paletteGroups({
      query: typed,
      card: card === undefined ? null : { title: card.title, completable },
      current,
      projects: projects.active,
      columns: ctx.columns,
      labels: ctx.labels,
      tasks: paletteSearch.results,
    })
  );
  const rows = $derived(flattenRows(groups));
  const indexByKey = $derived(new Map(rows.map((row, index) => [row.key, index])));

  // Stricter than the quick menus': a row the user did choose and that has since
  // vanished leaves Enter inert rather than silently re-pointing it at row 0,
  // which here could be any command at all.
  const nav = new ListNav({
    keys: () => rows.map((row) => row.key),
    list: () => listEl,
    missing: 'inert',
  });

  const query = $derived(typed.trim());
  // The search row is always there, so it cannot count towards a match total.
  const matchCount = $derived(rows.length - 1);
  // The debounce counts as searching, or a query the server has not been asked
  // about yet reads as one it answered with nothing.
  const searching = $derived(searchPending || paletteSearch.status === 'loading');
  const statusText = $derived.by(() => {
    if (query === '') {
      return 'Type to search tasks in every project.';
    }
    if (searching) {
      return 'Searching…';
    }
    if (matchCount === 0) {
      return `No matches for “${query}”.`;
    }
    return `${matchCount} ${matchCount === 1 ? 'result' : 'results'}`;
  });

  function optionId(index: number): string {
    return `${listId}-option-${index}`;
  }

  function scheduleSearch(): void {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
    }
    searchPending = true;
    searchTimer = setTimeout(() => {
      searchTimer = null;
      searchPending = false;
      void paletteSearch.run(typed);
    }, SEARCH_DEBOUNCE_MS);
  }

  onDestroy(() => {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
    }
    paletteSearch.reset();
  });

  // Back, a guard redirect, or another tab's logout can move the route out from
  // under an open palette. The query string is not such a move: the board rewrites
  // it whenever it normalizes its filters, and that screen is still the one behind.
  $effect(() => {
    if (splitPath(router.path).pathname !== openedPathname) {
      onclose();
    }
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (nav.move(event.key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
      }
    } else if (event.key === 'Enter') {
      // A composing IME commits its candidate with Enter, and a held Enter repeats.
      if (event.isComposing || event.repeat || nav.index === -1) {
        return;
      }
      event.preventDefault();
      activate(rows[nav.index]);
    } else if (event.key === 'Escape') {
      // preventDefault suppresses the enclosing dialog's close request so cancel
      // cannot fire a second time; stopPropagation keeps it off the window keymap.
      event.preventDefault();
      event.stopPropagation();
      onclose();
    }
  }

  function activate(row: PaletteRow | undefined): void {
    // onclose() only asks the shell to drop this component; it stays mounted until
    // that flush, so without the latch a second activation fires the action twice.
    if (row === undefined || committed) {
      return;
    }
    committed = true;
    if (row.kind === 'task') {
      taskRoute.seed(row.taskId, row.projectId);
      onclose();
      router.navigate(row.href);
      return;
    }
    if (row.kind === 'go') {
      onclose();
      router.navigate(row.href);
      return;
    }
    if (row.kind === 'column' || row.kind === 'label') {
      void runAction(row.kind === 'column' ? 'move' : 'labels', row.prefill);
      return;
    }
    void runAction(row.action);
  }

  function overlayClosePath(taskId: string): string | null {
    const route = router.current;
    if (route.name !== 'project' || route.params.taskId !== taskId) {
      return null;
    }
    if (route.params.from === 'my-tasks') {
      return '/my-tasks';
    }
    const project = board.project;
    return project === null
      ? null
      : projectHref(project.id, project.name, route.params.view) + board.filterSearch;
  }

  async function copyLink(taskId: string, taskTitle: string): Promise<void> {
    try {
      // No filter query: a copied link goes to someone else, who should not
      // inherit the sharer's narrowing of the board.
      const href = new URL(taskHref(taskId, taskTitle), window.location.origin).href;
      await navigator.clipboard.writeText(href);
      toasts.success('Link copied');
    } catch {
      toasts.error('Could not copy the link');
    }
  }

  async function runAction(action: PaletteActionId, prefill = ''): Promise<void> {
    const id = targetId;
    const target = card;
    if (id === null || target === undefined) {
      onclose();
      return;
    }
    const title = truncateTitle(target.title);
    // Closed before announcing throughout: this modal keeps the shell's live
    // region inert while it is up.
    if (action === 'done') {
      onclose();
      if (ctx.markTaskDone(id)) {
        void announcer.announce(`Marked "${title}" done`);
      }
      return;
    }
    if (action === 'duplicate') {
      onclose();
      void ctx.duplicateTask(id);
      void announcer.announce(`Duplicated "${title}"`);
      return;
    }
    if (action === 'copyLink') {
      onclose();
      void copyLink(id, target.title);
      return;
    }
    if (action === 'archive') {
      onclose();
      // Archiving the card the overlay is showing has to take the overlay with it,
      // or it is left on its "not found" panel. Captured and awaited first: the
      // redirect refetches the board, and a refetch racing the archive brings the
      // card back.
      const closePath = overlayClosePath(id);
      await ctx.archiveTask(id);
      if (closePath !== null) {
        router.redirect(closePath);
      }
      void announcer.announce(`Archived "${title}"`);
      return;
    }
    // Closed and flushed before the handoff: two modal dialogs must not be open at
    // once, or this one's focus restore fights the quick menu's autofocus.
    onclose();
    await tick();
    shortcuts.menuPrefill = prefill;
    if (action === 'labels') {
      shortcuts.labelMenu = id;
    } else if (action === 'assignees') {
      shortcuts.assigneeMenu = id;
    } else if (action === 'blockers') {
      shortcuts.dependencyMenu = { taskId: id, direction: 'blocker' };
    } else if (action === 'blocking') {
      shortcuts.dependencyMenu = { taskId: id, direction: 'blocked' };
    } else {
      shortcuts.moveMenu = id;
    }
  }

  const kbdClass =
    'inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-edge bg-canvas px-1.5 text-xs font-medium text-muted';
</script>

<Modal open title="Command palette" titleHidden {onclose}>
  <div class="flex flex-col gap-3">
    <Input
      bind:value={typed}
      autofocus
      type="text"
      role="combobox"
      aria-label="Command palette"
      aria-autocomplete="list"
      aria-expanded={rows.length > 0}
      aria-controls={listId}
      aria-activedescendant={nav.index === -1 ? undefined : optionId(nav.index)}
      maxlength={SEARCH_MAX_QUERY_LENGTH}
      placeholder="Type a command or search every project…"
      oninput={() => {
        nav.clear();
        scheduleSearch();
      }}
      {onkeydown}
    />

    {#if showSelectionHint}
      <p class="flex flex-wrap items-center gap-1 text-sm text-muted">
        <span>Select a card with</span>
        <kbd class={kbdClass}>j</kbd>
        <span>or</span>
        <kbd class={kbdClass}>k</kbd>
        <span>to act on it.</span>
      </p>
    {/if}

    <div
      bind:this={listEl}
      id={listId}
      role="listbox"
      aria-label="Commands"
      class="flex max-h-[55dvh] flex-col overflow-y-auto overscroll-contain rounded-md border border-edge"
    >
      {#each groups as group (group.key)}
        <div role="group" aria-label={group.heading} class="flex flex-col">
          <!-- Not a heading, and hidden: a listbox admits only groups and options,
               and the group's own label already carries this text. -->
          <div
            aria-hidden="true"
            class="truncate px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase"
          >
            {group.heading}
          </div>
          {#each group.rows as row (row.key)}
            {@const index = indexByKey.get(row.key) ?? -1}
            <button
              type="button"
              role="option"
              id={optionId(index)}
              data-index={index}
              tabindex={-1}
              aria-selected={index === nav.index}
              aria-keyshortcuts={row.keys.length > 0 && !row.chord ? row.keys.join(' ') : undefined}
              onmousedown={(event) => event.preventDefault()}
              onpointermove={() => nav.highlight(row.key)}
              onclick={() => activate(row)}
              class="flex min-h-11 w-full shrink-0 cursor-pointer items-center gap-3 border-l-2 px-3 text-left text-sm {index ===
              nav.index
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-transparent hover:bg-accent-soft'}"
            >
              <span class="min-w-0 flex-1 truncate">{row.label}</span>
              {#if row.detail !== undefined}
                <span class="hidden max-w-[45%] min-w-0 truncate text-xs text-muted sm:inline">
                  {row.detail}
                </span>
              {/if}
              {#if row.chord}
                <!-- aria-keyshortcuts reads a space-separated list as alternatives,
                     so a sequence has to reach the name as text instead. -->
                <span class="sr-only">{row.keys.join(' then ')}</span>
              {/if}
              {#if row.keys.length > 0}
                <!-- Hidden: the keys reach assistive tech as aria-keyshortcuts or,
                     for a sequence, as the text above. -->
                <span aria-hidden="true" class="flex shrink-0 items-center gap-1">
                  {#each row.keys as key, i (i)}
                    {#if i > 0}
                      <span class="text-xs text-muted">{row.chord ? 'then' : 'or'}</span>
                    {/if}
                    <kbd class={kbdClass}>{key}</kbd>
                  {/each}
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {/each}
    </div>

    {#if paletteSearch.status === 'error'}
      <div
        role="alert"
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger p-3"
      >
        <p class="text-sm text-danger">{paletteSearch.error}</p>
        <Button variant="secondary" onclick={() => void paletteSearch.run(typed)}>Try again</Button>
      </div>
    {/if}

    <p role="status" class="flex items-center gap-2 text-sm text-muted">
      <span>{statusText}</span>
      {#if searching}
        <span aria-hidden="true"><Spinner size="sm" /></span>
      {/if}
    </p>

    {#if paletteSearch.truncated}
      <p class="text-sm text-muted">
        Showing the first {paletteSearch.results.length} matches. Add another word to narrow it down.
      </p>
    {/if}
  </div>
</Modal>
