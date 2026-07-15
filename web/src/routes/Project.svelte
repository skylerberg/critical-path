<script lang="ts">
  import { untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import type { ProjectView } from '../lib/router.svelte';
  import { selection } from '../lib/selection.svelte';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import ProjectHeader from '../components/ProjectHeader.svelte';
  import QuickAssigneeMenu from '../components/QuickAssigneeMenu.svelte';
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
  }

  let { projectId, view, taskId }: Props = $props();

  $effect(() => {
    const id = projectId;
    untrack(() => void board.load(id));
  });

  // The shell owns the keymap so l/a/?/g and the quick menus reach both views and the
  // task overlay; the shortcut layer gates board-only nav keys by the route view.
  $effect(() => {
    window.addEventListener('keydown', shortcuts.handleKeydown);
    return () => window.removeEventListener('keydown', shortcuts.handleKeydown);
  });

  $effect(() => {
    if (projectId) {
      untrack(() => selection.clear());
    }
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
    <TaskDetail {taskId} closePath={viewBasePath} />
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
  {#if shortcuts.helpOpen}
    <ShortcutHelp onclose={() => (shortcuts.helpOpen = false)} />
  {/if}
{/if}
