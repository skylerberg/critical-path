import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { env } from '../config/env';

export const SESSION_COOKIE_NAME = 'cp_session';

// Carries the same session token the client already holds as a bearer token,
// and exists for one reason: a browser never attaches an Authorization header
// to an <img> tag. Media routes cannot be authenticated any other way without
// rewriting every /api/images/<uuid> already embedded in a stored description.
//
// SameSite=Lax is the security property, not a default: it is not sent on
// cross-site subresource requests at all, so another origin cannot point an
// <img> at a board's pictures and learn from whether they load. Only ever set
// from a session token — a personal access token is a CLI credential and has no
// business becoming an ambient browser one.
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.environment === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: env.sessionTtlDays * 24 * 60 * 60,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
}

export function sessionCookieToken(c: Context): string | null {
  const value = getCookie(c, SESSION_COOKIE_NAME);
  return value === undefined || value === '' ? null : value;
}
