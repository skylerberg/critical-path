import { APP_NAME } from './constants';
import type { Route } from './router.svelte';

interface Context {
  projectName?: string | null;
  taskTitle?: string | null;
}

/** The screen's own name, without the app suffix. Empty for the bare app shell. */
export function screenName(route: Route, context: Context = {}): string {
  switch (route.name) {
    case 'projects':
      return 'Projects';
    case 'my-tasks':
      return 'My tasks';
    case 'search':
      return route.params.q === '' ? 'Search' : `Search: ${route.params.q}`;
    case 'login':
      return 'Sign in';
    case 'signup':
      return 'Sign up';
    case 'account':
      return 'Account';
    case 'forgot-password':
      return 'Reset your password';
    case 'reset-password':
      return 'Choose a new password';
    case 'unsubscribe':
      return 'Unsubscribe';
    case 'invite':
      return 'Project invitation';
    case 'verify-email':
      return 'Verify your email';
    case 'not-found':
      return 'Page not found';
    // A task URL is a route, not a page: the overlay opens over whichever board is
    // behind it. The task leads because it is what changed, and the project stays
    // so the title still says where you are.
    case 'project':
    case 'public-board': {
      const project = context.projectName ?? '';
      const task = context.taskTitle ?? '';
      if (task !== '' && project !== '') return `${task} — ${project}`;
      if (task !== '') return task;
      if (project !== '')
        return route.name === 'project' && isGraph(route) ? `${project} graph` : project;
      return '';
    }
  }
}

function isGraph(route: Extract<Route, { name: 'project' }>): boolean {
  return route.params.view === 'graph';
}

/** What `document.title` should be for this route. */
export function titleFor(route: Route, context: Context = {}): string {
  const screen = screenName(route, context);
  return screen === '' ? APP_NAME : `${screen} · ${APP_NAME}`;
}
