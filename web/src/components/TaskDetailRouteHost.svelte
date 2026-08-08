<script lang="ts">
  import TaskDetail from './TaskDetail.svelte';

  // Exists for TaskDetail.test.ts. The overlay is always rendered from a route
  // object that is replaced whenever the URL is rewritten — which a teammate's
  // rename does, because the path carries the title slug. Passing taskId straight
  // from props cannot reproduce that: the value never changes, so nothing in the
  // child is invalidated. Reading it off a replaceable object here does.
  interface Props {
    route: { taskId: string };
    closePath: string;
    taskPath: (id: string) => string;
  }

  let { route, closePath, taskPath }: Props = $props();
</script>

<TaskDetail taskId={route.taskId} {closePath} {taskPath} />
