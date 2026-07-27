<script lang="ts">
  import { untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import { noFilters, type BoardFilters } from '../lib/board-filters';
  import type { ProjectView } from '../lib/router.svelte';
  import { selection } from '../lib/selection.svelte';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import { users } from '../lib/users.svelte';
  import ProjectHeader from '../components/ProjectHeader.svelte';
  import QuickAssigneeMenu from '../components/QuickAssigneeMenu.svelte';
  import QuickDependencyMenu from '../components/QuickDependencyMenu.svelte';
  import QuickLabelMenu from '../components/QuickLabelMenu.svelte';
  import ShortcutHelp from '../components/ShortcutHelp.svelte';
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

  // The shell owns the keymap so the quick menus and global keys reach both views and
  // the task overlay; the shortcut layer gates board-only nav keys by the route view.
  $effect(() => {
    window.addEventListener('keydown', shortcuts.handleKeydown);
    return () => window.removeEventListener('keydown', shortcuts.handleKeydown);
  });

  // A quick menu holds a task id, so it goes with the selection on every move — not
  // just a project switch: closing the overlay must not leave a menu open over a card
  // that is no longer there, owning the keymap.
  $effect(() => {
    void routeKey;
    untrack(() => {
      selection.clear();
      shortcuts.closeMenus();
    });
  });

  const ready = $derived(
    board.currentProjectId === projectId &&
      !board.loading &&
      board.error === null &&
      board.project !== null
  );
  const viewBasePath = $derived(
    view === 'graph' ? `/projects/${projectId}/graph` : `/projects/${projectId}`
  );
  const closePath = $derived(from === 'my-tasks' ? '/my-tasks' : viewBasePath + board.filterSearch);
</script>

{#if board.error !== null && board.currentProjectId === projectId}
  <div class="flex h-[calc(100dvh-4rem)] flex-col items-center justify-center gap-4 p-4 lg:h-dvh">
    <p class="text-muted">{board.error}</p>
    <Button variant="secondary" onclick={() => void board.refetch()}>Try again</Button>
  </div>
{:else if !ready}
  <div class="flex h-[calc(100dvh-4rem)] items-center justify-center lg:h-dvh">
    <Spinner size="lg" />
  </div>
{:else}
  <div class="flex h-[calc(100dvh-4rem)] flex-col lg:h-dvh">
    <ProjectHeader {projectId} {view} />
    {#if view === 'board'}
      <Board {projectId} />
    {:else}
      <Graph {projectId} />
    {/if}
  </div>
  {#if taskId !== undefined}
    <TaskDetail {taskId} {closePath} />
  {/if}
  {#if shortcuts.labelMenu !== null}
    <QuickLabelMenu taskId={shortcuts.labelMenu} onclose={() => (shortcuts.labelMenu = null)} />
  {/if}
  {#if shortcuts.assigneeMenu !== null}
    <QuickAssigneeMenu
      taskId={shortcuts.assigneeMenu}
      onclose={() => (shortcuts.assigneeMenu = null)}
    />
  {/if}
  {#if shortcuts.dependencyMenu !== null}
    <QuickDependencyMenu
      taskId={shortcuts.dependencyMenu.taskId}
      direction={shortcuts.dependencyMenu.direction}
      onclose={() => (shortcuts.dependencyMenu = null)}
    />
  {/if}
  {#if shortcuts.helpOpen}
    <ShortcutHelp onclose={() => (shortcuts.helpOpen = false)} />
  {/if}
{/if}
