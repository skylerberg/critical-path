<script lang="ts">
  import { noFilters, type BoardFilters } from '../lib/board-filters';
  import { router, type ProjectView } from '../lib/router.svelte';
  import { taskRoute } from '../lib/task-route.svelte';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import NotFound from './NotFound.svelte';
  import Project from './Project.svelte';

  interface Props {
    projectId: string | null;
    view: ProjectView;
    taskId?: string;
    filters?: BoardFilters;
    from?: 'my-tasks';
  }

  let { projectId, view, taskId, filters = noFilters(), from }: Props = $props();

  const located = $derived(taskRoute.locate({ projectId, taskId }));

  // One attempt per arrival. `located` derives from several stores, so any of them
  // churning while the error is on screen would otherwise re-fire the lookup.
  let attempted: string | undefined;

  $effect(() => {
    if (taskId === undefined) {
      return;
    }
    if (located.status === 'pending' || (located.status === 'error' && attempted !== taskId)) {
      attempted = taskId;
      taskRoute.ensure(taskId);
    }
  });

  function retry(): void {
    if (taskId !== undefined) {
      taskRoute.ensure(taskId);
    }
  }
</script>

<!-- Rendering the board here rather than navigating to a project URL is what keeps
     the short link in the address bar. Every in-app move resolves on the same tick,
     so this stays in the same branch and the board is never torn down. -->
{#if located.status === 'ready'}
  <Project projectId={located.projectId} {view} {taskId} {filters} {from} />
{:else if located.status === 'pending'}
  <div class="flex h-[var(--cp-board-h)] items-center justify-center lg:h-dvh">
    <Spinner size="lg" />
  </div>
{:else if located.status === 'error'}
  <div
    class="flex h-[var(--cp-board-h)] flex-col items-center justify-center gap-4 p-4 text-center lg:h-dvh"
  >
    <p class="text-muted">Could not open that card.</p>
    <Button variant="secondary" onclick={retry}>Try again</Button>
  </div>
{:else}
  <NotFound path={router.path} />
{/if}
