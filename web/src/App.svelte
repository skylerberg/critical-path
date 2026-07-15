<script lang="ts">
  import { router } from './lib/router.svelte';
  import { session } from './lib/session.svelte';
  import { users } from './lib/users.svelte';
  import { board } from './lib/board.svelte';
  import { projects } from './lib/projects.svelte';
  import { toasts } from './lib/toasts.svelte';
  import Login from './routes/Login.svelte';
  import Signup from './routes/Signup.svelte';
  import Projects from './routes/Projects.svelte';
  import Project from './routes/Project.svelte';
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
    if (session.status === 'anon') {
      // Per-account caches must not survive into the next session in this tab.
      users.reset();
      board.reset();
      projects.reset();
    }
    if (session.status !== 'authed') {
      return undefined;
    }
    return users.loadWithRetry(() => toasts.error('Failed to load users'));
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
    {:else if route.name === 'project'}
      <Project projectId={route.params.id} view={route.params.view} taskId={route.params.taskId} />
    {:else}
      <NotFound path={route.path} />
    {/if}
  </div>
{/if}

<Toasts />
