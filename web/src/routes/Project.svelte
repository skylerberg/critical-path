<script lang="ts">
  import { untrack } from 'svelte';
  import { announcer } from '../lib/announcer.svelte';
  import { board } from '../lib/board.svelte';
  import { mergeFilterSearch, noFilters, type BoardFilters } from '../lib/board-filters';
  import { router, splitPath, type ProjectView } from '../lib/router.svelte';
  import { projectHref, taskHref } from '../lib/short-links';
  import { selection } from '../lib/selection.svelte';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import { users } from '../lib/users.svelte';
  import ProjectHeader from '../components/ProjectHeader.svelte';
  import TaskDetail from '../components/TaskDetail.svelte';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import Board from './Board.svelte';
  import Graph from './Graph.svelte';

  interface Props {
    projectId: string;
    view: ProjectView;
    taskId?: string;
    filters?: BoardFilters;
    from?: 'my-tasks';
  }

  let { projectId, view, taskId, filters = noFilters(), from }: Props = $props();

  // Reading a prop directly makes an effect depend on the whole route object, which is
  // replaced on every query-string rewrite. These stop at a value a filter cannot
  // change, so filtering re-runs nothing while a real move within the project still does.
  const currentProjectId = $derived(projectId);
  const routeKey = $derived(`${projectId}/${view}/${taskId ?? ''}`);

  // Keyed on the project alone, not routeKey: opening a card overlay re-runs the
  // load below, and re-arming there would swap the highlights the user came to
  // see for the empty set the stamp has since made true.
  $effect(() => {
    void currentProjectId;
    untrack(() => board.armSeen());
  });

  $effect(() => {
    void routeKey;
    untrack(() => {
      void board.load(projectId, filters);
    });
  });

  // The query string is authoritative, so Back/Forward and any in-app link carrying a
  // different one re-narrow the board without refetching it.
  $effect(() => {
    const next = filters;
    untrack(() => board.setFilters(next));
  });

  // The header's assignee filter lives in both views, so the project-scoped user
  // list is the shell's to fetch, not the board's. Tracked, so invalidating the
  // cache after a membership change refetches it.
  $effect(() => {
    void users.loadForProject(currentProjectId);
  });

  // A quick menu holds a task id, so it goes with the selection on every move — not
  // just a project switch: closing the overlay must not leave a menu open over a card
  // that is no longer there.
  $effect(() => {
    void routeKey;
    untrack(() => {
      selection.clear();
      shortcuts.closeMenus();
      announcer.clear();
    });
  });

  const ready = $derived(
    board.currentProjectId === projectId &&
      !board.loading &&
      board.error === null &&
      board.project !== null
  );
  const readonly = $derived(!board.canEdit);
  const viewBasePath = $derived(projectHref(projectId, board.project?.name ?? '', view));
  const closePath = $derived(from === 'my-tasks' ? '/my-tasks' : viewBasePath + board.filterSearch);
  // What an overlay URL in this view carries: the live filters, plus the return marker
  // when the card was reached from My Tasks.
  const overlaySearch = $derived(
    mergeFilterSearch(from === 'my-tasks' ? '?from=my-tasks' : '', board.filters)
  );

  // Re-slugs from the live title, so the address bar follows a rename — the user's
  // own or a teammate's over realtime — and corrects a stale or absent slug on
  // arrival. Guarded on `ready` rather than the id alone: a project switch assigns
  // the new id before the payload lands, leaving a window with no project to name.
  // Only the pathname is touched; the filter writer owns the search.
  $effect(() => {
    if (!ready) {
      return;
    }
    const task = taskId === undefined ? undefined : board.tasks.find((t) => t.id === taskId);
    // An archived card opened cold is absent from the board payload, so there is no
    // title to slug and the URL is left as it arrived.
    const canonical =
      taskId === undefined
        ? projectHref(board.project!.id, board.project!.name, view)
        : task === undefined
          ? null
          : taskHref(task.id, task.title, view);
    const { pathname, search } = splitPath(router.path);
    if (canonical !== null && pathname !== canonical) {
      router.redirect(canonical + search);
    }
  });
</script>

{#if board.error !== null && board.currentProjectId === projectId}
  <div class="flex h-[var(--cp-board-h)] flex-col items-center justify-center gap-4 p-4 lg:h-dvh">
    <p class="text-muted">{board.error}</p>
    <Button variant="secondary" onclick={() => void board.refetch()}>Try again</Button>
  </div>
{:else if !ready}
  <div class="flex h-[var(--cp-board-h)] items-center justify-center lg:h-dvh">
    <Spinner size="lg" />
  </div>
{:else}
  <div class="flex h-[var(--cp-board-h)] flex-col lg:h-dvh">
    <ProjectHeader {projectId} {view} />
    {#if view === 'board'}
      <Board {projectId} {readonly} />
    {:else}
      <Graph {projectId} {readonly} />
    {/if}
  </div>
  {#if taskId !== undefined}
    <TaskDetail
      {taskId}
      {closePath}
      {readonly}
      taskPath={(id) =>
        taskHref(id, board.tasks.find((t) => t.id === id)?.title ?? '', view) + overlaySearch}
    />
  {/if}
{/if}
