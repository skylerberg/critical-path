<script lang="ts">
  import { router } from './lib/router.svelte';
  import { isAuthOptionalRoute, isPublicRoute, session } from './lib/session.svelte';
  import { users } from './lib/users.svelte';
  import { board } from './lib/board.svelte';
  import { drafts } from './lib/drafts.svelte';
  import { myTasks } from './lib/myTasks.svelte';
  import { projects } from './lib/projects.svelte';
  import { realtime } from './lib/realtime.svelte';
  import { search } from './lib/search.svelte';
  import { shortcuts } from './lib/shortcuts.svelte';
  import { toasts } from './lib/toasts.svelte';
  import { webhooks } from './lib/webhooks.svelte';
  import Login from './routes/Login.svelte';
  import Signup from './routes/Signup.svelte';
  import Account from './routes/Account.svelte';
  import ForgotPassword from './routes/ForgotPassword.svelte';
  import ResetPassword from './routes/ResetPassword.svelte';
  import Unsubscribe from './routes/Unsubscribe.svelte';
  import VerifyEmail from './routes/VerifyEmail.svelte';
  import Projects from './routes/Projects.svelte';
  import MyTasks from './routes/MyTasks.svelte';
  import Search from './routes/Search.svelte';
  import Project from './routes/Project.svelte';
  import PublicBoard from './routes/PublicBoard.svelte';
  import NotFound from './routes/NotFound.svelte';
  import Nav from './components/Nav.svelte';
  import ShortcutHelp from './components/ShortcutHelp.svelte';
  import Toasts from './components/Toasts.svelte';
  import Spinner from './components/ui/Spinner.svelte';

  const route = $derived(router.current);
  const showNav = $derived(!isPublicRoute(route.name) && !isAuthOptionalRoute(route.name));

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
      myTasks.reset();
      projects.reset();
      search.reset();
      webhooks.reset();
      drafts.clearAll();
      realtime.disconnect();
      shortcuts.reset();
    }
    if (session.status !== 'authed') {
      return undefined;
    }
    const cancelUsers = users.loadWithRetry(() => toasts.error('Failed to load users'));
    void projects.load();
    realtime.connect();
    return cancelUsers;
  });

  // A session can end without this tab navigating — another tab logging out or
  // deleting the account — which otherwise leaves a signed-in screen rendered.
  $effect(() => {
    if (session.status !== 'anon') {
      return;
    }
    const redirected = session.guardRoute(router.current, router.path);
    if (typeof redirected === 'string') {
      router.redirect(redirected);
    }
  });

  // The shell owns the keymap so the chords and ? reach every signed-in screen, not
  // only the project routes; the shortcut layer gates the project-scoped keys itself.
  $effect(() => {
    if (session.status !== 'authed') {
      return undefined;
    }
    window.addEventListener('keydown', shortcuts.handleKeydown);
    return () => window.removeEventListener('keydown', shortcuts.handleKeydown);
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
  <div class={showNav ? 'pb-[var(--cp-bottom-nav-h)] lg:pb-0 lg:pl-56' : ''}>
    {#if route.name === 'login'}
      <Login />
    {:else if route.name === 'signup'}
      <Signup />
    {:else if route.name === 'forgot-password'}
      <ForgotPassword />
    {:else if route.name === 'reset-password'}
      <ResetPassword token={route.params.token} />
    {:else if route.name === 'unsubscribe'}
      <Unsubscribe token={route.params.token} />
    {:else if route.name === 'verify-email'}
      <VerifyEmail token={route.params.token} />
    {:else if route.name === 'account'}
      <Account />
    {:else if route.name === 'projects'}
      <Projects />
    {:else if route.name === 'my-tasks'}
      <MyTasks />
    {:else if route.name === 'search'}
      <Search q={route.params.q} />
    {:else if route.name === 'project'}
      <Project
        projectId={route.params.id}
        view={route.params.view}
        taskId={route.params.taskId}
        filters={route.params.filters}
        from={route.params.from}
      />
    {:else if route.name === 'public-board'}
      <PublicBoard projectId={route.params.id} taskId={route.params.taskId} />
    {:else}
      <NotFound path={route.path} />
    {/if}
  </div>
  <!-- Goes wherever the keymap listens: an open help state with nothing rendering it
       swallows every key but Escape. -->
  {#if shortcuts.helpOpen}
    <ShortcutHelp onclose={() => (shortcuts.helpOpen = false)} />
  {/if}
{/if}

<Toasts />
