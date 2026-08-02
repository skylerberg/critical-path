<script lang="ts">
  import { noFilters, type BoardFilters } from '../lib/board-filters';
  import { router, type ProjectView } from '../lib/router.svelte';
  import { taskRoute } from '../lib/task-route.svelte';
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

  $effect(() => {
    if (located.status === 'pending' && taskId !== undefined) {
      taskRoute.ensure(taskId);
    }
  });
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
{:else}
  <NotFound path={router.path} />
{/if}
