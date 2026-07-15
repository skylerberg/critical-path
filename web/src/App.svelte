<script lang="ts">
  import { router } from './lib/router.svelte';
  import Login from './routes/Login.svelte';
  import Signup from './routes/Signup.svelte';
  import Projects from './routes/Projects.svelte';
  import Board from './routes/Board.svelte';
  import Graph from './routes/Graph.svelte';
  import NotFound from './routes/NotFound.svelte';
  import Toasts from './components/Toasts.svelte';

  const route = $derived(router.current);
</script>

{#if route.name === 'login'}
  <Login />
{:else if route.name === 'signup'}
  <Signup />
{:else if route.name === 'projects'}
  <Projects />
{:else if route.name === 'board'}
  <Board projectId={route.params.id} />
{:else if route.name === 'graph'}
  <Graph projectId={route.params.id} />
{:else if route.name === 'task'}
  <Board projectId={route.params.id} taskId={route.params.taskId} />
{:else}
  <NotFound path={route.path} />
{/if}

<Toasts />
