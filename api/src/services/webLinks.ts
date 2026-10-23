import { env } from '../config/env';

// Every path this server sends people to in the web app, in one place. The
// alternative — a template literal at each call site — is how /projects/:id
// survived the web app going alias-only: each end tested its own half and
// nothing compared them. `tests/unit/webLinks.test.ts` pins these strings and
// `web/src/lib/router.test.ts` asserts the same list still routes, so the two
// halves fail separately rather than one gap failing silently.
//
// Aliases are deliberately absent. Building one needs the alias alphabet, which
// the web app and the CLI already each carry, and a third copy here is one more
// place to drift: the server links by id, and the board rewrites the address to
// /p/<alias>/<slug> once it loads.
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

// An API endpoint rather than a web route, so it is not in WEB_PATHS above: it is
// served from the same origin as the app in every environment.
export function unsubscribeOneClickUrl(token: string): string {
  return `${env.appUrlBase}/api/auth/unsubscribe/one-click?token=${token}`;
}
