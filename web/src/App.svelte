<script lang="ts">
  import { router } from './lib/router.svelte';
  import { isAuthOptionalRoute, isPublicRoute, isSignedIn, session } from './lib/session.svelte';
  import { users } from './lib/users.svelte';
  import { announcer } from './lib/announcer.svelte';
  import { board } from './lib/board.svelte';
  import { boardAnnouncer } from './lib/board-announcer.svelte';
  import { cardContext } from './lib/card-context.svelte';
  import { connectivity } from './lib/connectivity.svelte';
  import { outbox } from './lib/outbox.svelte';
  import { conflictDrafts } from './lib/conflictDrafts.svelte';
  import { crossProjectDeps } from './lib/crossProjectDeps.svelte';
  import { drafts } from './lib/drafts.svelte';
  import { invitations } from './lib/invitations.svelte';
  import { myTasks } from './lib/myTasks.svelte';
  import { projects } from './lib/projects.svelte';
  import { realtime } from './lib/realtime.svelte';
  import { search } from './lib/search.svelte';
  import { shortcuts } from './lib/shortcuts.svelte';
  import { taskRoute } from './lib/task-route.svelte';
  import { taskSeries } from './lib/taskSeries.svelte';
  import { toasts } from './lib/toasts.svelte';
  import { webhooks } from './lib/webhooks.svelte';
  import Login from './routes/Login.svelte';
  import Signup from './routes/Signup.svelte';
  import Account from './routes/Account.svelte';
  import ForgotPassword from './routes/ForgotPassword.svelte';
  import ResetPassword from './routes/ResetPassword.svelte';
  import Unsubscribe from './routes/Unsubscribe.svelte';
  import Invite from './routes/Invite.svelte';
  import VerifyEmail from './routes/VerifyEmail.svelte';
  import Projects from './routes/Projects.svelte';
  import MyTasks from './routes/MyTasks.svelte';
  import Search from './routes/Search.svelte';
  import ProjectRoute from './routes/ProjectRoute.svelte';
  import PublicBoard from './routes/PublicBoard.svelte';
  import NotFound from './routes/NotFound.svelte';
  import Nav from './components/Nav.svelte';
  import QuickMenus from './components/QuickMenus.svelte';
  import ShortcutHelp from './components/ShortcutHelp.svelte';
  import Toasts from './components/Toasts.svelte';
  import Announcer from './components/ui/Announcer.svelte';
  import Spinner from './components/ui/Spinner.svelte';

  // Long enough that a burst of edits writes once, short enough that a reload
  // straight after a change still finds it.
  const SNAPSHOT_DEBOUNCE_MS = 800;

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
      boardAnnouncer.reset();
      cardContext.reset();
      crossProjectDeps.reset();
      invitations.reset();
      myTasks.reset();
      projects.reset();
      search.reset();
      taskRoute.reset();
      webhooks.reset();
      taskSeries.reset();
      drafts.clearAll();
      conflictDrafts.clearAll();
      realtime.disconnect();
      shortcuts.reset();
    }
    if (!isSignedIn(session.status)) {
      return undefined;
    }
    void outbox.hydrate();
    // Connects in both states: the socket is the app's main way of noticing the
    // network came back, and it backs off on its own until it does.
    realtime.connect();
    const cancelUsers = users.loadWithRetry(() => toasts.error('Failed to load users'));
    void projects.load();
    return cancelUsers;
  });

  // Reachability is deduced from whether requests get answers, so the listeners
  // that seed it have to be running before the first one is made.
  connectivity.start();

  // Once the queue lands, the board on screen is the user's optimistic state and
  // the server's is the truth; this is the one place that reconciles them. Wired
  // here rather than inside the outbox, which deliberately knows nothing about
  // the board — every board mutation already depends on it.
  outbox.onSettled = () => {
    void board.resync();
  };

  // Persisted on a debounce rather than per keystroke, and from the store rather
  // than from a response, so a reload while offline comes back holding unsent
  // edits instead of a snapshot that predates them.
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // Read so the effect re-runs when any of it changes.
    void board.project;
    void board.columns;
    void board.tasks;
    void board.labels;
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => void board.persistSnapshot(), SNAPSHOT_DEBOUNCE_MS);
    return () => clearTimeout(snapshotTimer);
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
    {:else if route.name === 'invite'}
      <Invite token={route.params.token} />
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
      <ProjectRoute
        projectId={route.params.projectId}
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
  <!-- Goes wherever the keymap listens: an open menu state with nothing rendering it
       swallows every key but Escape. -->
  {#if shortcuts.helpOpen}
    <ShortcutHelp onclose={() => (shortcuts.helpOpen = false)} />
  {/if}
  <QuickMenus />
  <!-- Outside every route branch: a region created in the same flush as its text is
       not announced, and it has to outlive the menu that wrote to it. Two of them,
       one per channel: written in the same flush, a teammate's change and the user's
       own feedback would overwrite each other before either reached the DOM. The
       local one comes first, because assistive tech queues polite regions in DOM
       order and your own action is the one you are waiting on. -->
  <Announcer message={announcer.message} />
  <Announcer message={boardAnnouncer.message} />
{/if}

<Toasts />
