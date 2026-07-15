<script lang="ts">
  import { router } from './lib/router.svelte';
  import { session } from './lib/session.svelte';
  import { users } from './lib/users.svelte';
  import { toasts } from './lib/toasts.svelte';
  import Login from './routes/Login.svelte';
  import Signup from './routes/Signup.svelte';
  import Projects from './routes/Projects.svelte';
  import Board from './routes/Board.svelte';
  import Graph from './routes/Graph.svelte';
  import NotFound from './routes/NotFound.svelte';
  import Nav from './components/Nav.svelte';
  import Toasts from './components/Toasts.svelte';
  import Spinner from './components/ui/Spinner.svelte';

  const route = $derived(router.current);
  const showNav = $derived(route.name !== 'login' && route.name !== 'signup');

  router.beforeNavigate = session.guardRoute;

  // beforeNavigate does not run on the first page load; guard it once the session is known.
  void session.init().then(() => {
    const redirected = session.guardRoute(router.current, router.path);
    if (typeof redirected === 'string') {
      router.redirect(redirected);
    }
  });

  $effect(() => {
    if (session.status === 'authed') {
      users.load().catch(() => toasts.error('Failed to load users'));
    } else if (session.status === 'anon') {
      users.reset();
    }
  });
</script>

{#if session.status === 'unknown'}
  <div class="flex min-h-dvh items-center justify-center">
    <Spinner size="lg" />
  </div>
{:else}
  {#if showNav}
    <Nav />
  {/if}
  <div class={showNav ? 'pb-16 lg:pb-0 lg:pl-56' : ''}>
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
  </div>
{/if}

<Toasts />
