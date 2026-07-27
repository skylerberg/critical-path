<script lang="ts">
  import { untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import { boardPath } from '../lib/router.svelte';
  import { users } from '../lib/users.svelte';
  import TaskDetail from '../components/TaskDetail.svelte';
  import Badge from '../components/ui/Badge.svelte';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import Board from './Board.svelte';

  interface Props {
    projectId: string;
    taskId?: string;
  }

  let { projectId, taskId }: Props = $props();

  // currentProjectId is read tracked on purpose: a stale session flipping to
  // 'anon' makes the shell reset the store, and this reloads instead of blanking.
  $effect(() => {
    const id = projectId;
    if (board.currentProjectId !== id || !board.readonly) {
      untrack(() => void board.load(id, undefined, { readonly: true }));
    }
  });

  // The public payload fills the project-scoped user cache with assignees only,
  // so drop it on the way out or the authenticated pickers inherit that list.
  $effect(() => {
    return () => users.invalidateAll();
  });

  // Only reaches crawlers that execute JS; header-level noindex is an edge concern.
  $effect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  });

  const ready = $derived(
    board.currentProjectId === projectId &&
      board.readonly &&
      !board.loading &&
      board.error === null &&
      board.project !== null
  );
</script>

{#if board.error !== null && board.currentProjectId === projectId}
  <div class="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
    <p class="text-muted">{board.error}</p>
    {#if board.errorStatus === 404}
      <p class="text-sm text-muted">The link may have been turned off by the board's owner.</p>
    {:else}
      <Button variant="secondary" onclick={() => void board.refetch()}>Try again</Button>
    {/if}
  </div>
{:else if !ready}
  <div class="flex min-h-dvh items-center justify-center">
    <Spinner size="lg" />
  </div>
{:else}
  <div class="flex h-dvh flex-col">
    <header class="shrink-0 border-b border-edge bg-surface px-3 py-2 lg:px-4">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 class="min-w-0 truncate text-lg font-semibold">{board.project?.name ?? ''}</h1>
        <Badge>Read-only</Badge>
      </div>
      <p class="text-xs text-muted">Shared board — read only, no account needed.</p>
    </header>
    <Board {projectId} readonly />
  </div>
  {#if taskId !== undefined}
    <TaskDetail
      {taskId}
      closePath={boardPath(projectId, true)}
      taskPath={(id) => `${boardPath(projectId, true)}/tasks/${id}`}
      readonly
    />
  {/if}
{/if}
