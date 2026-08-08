import { env } from '../config/env';

// Every path this server sends people to in the web app, in one place. They
// were template literals in four services, which is how /projects/:id survived
// the web app going alias-only: each end tested its own half and nothing
// compared them. `tests/unit/webLinks.test.ts` pins these strings, and the web
// app's `src/lib/router.test.ts` asserts the same list still routes — two
// tests that fail separately rather than one gap that fails silently.
//
// Aliases are deliberately absent. Encoding one needs the alphabet, which is
// already duplicated between the web app and the CLI; a third copy here is how
// three copies drift, so the server links by id and the board rewrites the
// address to /p/<alias>/<slug> once it loads.
const WEB_PATHS = {
  project: '/projects/:projectId',
  task: '/projects/:projectId/tasks/:taskId',
  invite: '/invite',
  verifyEmail: '/verify-email',
  unsubscribe: '/unsubscribe',
  passwordReset: '/reset-password',
} as const;

function withToken(path: string, token: string): string {
  return `${env.appUrlBase}${path}?token=${encodeURIComponent(token)}`;
}

export function projectLink(projectId: string): string {
  return `${env.appUrlBase}/projects/${projectId}`;
}

export function taskLink(projectId: string, taskId: string): string {
  return `${env.appUrlBase}/projects/${projectId}/tasks/${taskId}`;
}

export function inviteLink(token: string): string {
  return withToken(WEB_PATHS.invite, token);
}

export function verifyEmailLink(token: string): string {
  return withToken(WEB_PATHS.verifyEmail, token);
}

export function unsubscribeLink(token: string): string {
  return withToken(WEB_PATHS.unsubscribe, token);
}

export function passwordResetLink(token: string): string {
  return withToken(WEB_PATHS.passwordReset, token);
}

// Not a web route: the one-click target is an API endpoint, served from the
// same origin as the app in every environment.
export function unsubscribeOneClickUrl(token: string): string {
  return `${env.appUrlBase}/api/auth/unsubscribe/one-click?token=${token}`;
}
