import { describe, it, expect, afterEach } from 'vitest';
import {
  inviteLink,
  passwordResetLink,
  projectLink,
  taskLink,
  unsubscribeLink,
  unsubscribeOneClickUrl,
  verifyEmailLink,
} from '../../src/services/webLinks';

const PROJECT_ID = '3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b';
const TASK_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

afterEach(() => {
  delete process.env.APP_URL_BASE;
  delete process.env.RESET_URL_BASE;
});

function withBase(base: string): void {
  process.env.APP_URL_BASE = base;
}

// Literal paths, not `${env.appUrlBase}/...` interpolated back. The password
// reset assertion used to compare the link against env.resetUrlBase, which held
// the path, so it passed whatever the path was — the one link nothing checked.
describe('web link paths', () => {
  it('builds every emailed link from one origin', () => {
    withBase('https://app.test');
    expect(projectLink(PROJECT_ID)).toBe(`https://app.test/projects/${PROJECT_ID}`);
    expect(taskLink(PROJECT_ID, TASK_ID)).toBe(
      `https://app.test/projects/${PROJECT_ID}/tasks/${TASK_ID}`
    );
    expect(inviteLink('abc')).toBe('https://app.test/invite?token=abc');
    expect(verifyEmailLink('abc')).toBe('https://app.test/verify-email?token=abc');
    expect(unsubscribeLink('abc')).toBe('https://app.test/unsubscribe?token=abc');
    expect(passwordResetLink('abc')).toBe('https://app.test/reset-password?token=abc');
  });

  it('escapes a token that would otherwise break the query', () => {
    withBase('https://app.test');
    expect(inviteLink('a+b/c=')).toBe('https://app.test/invite?token=a%2Bb%2Fc%3D');
    expect(passwordResetLink('a+b/c=')).toBe('https://app.test/reset-password?token=a%2Bb%2Fc%3D');
  });

  // Not a web route, so it is exempt from the router contract the others meet.
  it('points one-click unsubscribe at the API, not the app router', () => {
    withBase('https://app.test');
    expect(unsubscribeOneClickUrl('abc')).toBe(
      'https://app.test/api/auth/unsubscribe/one-click?token=abc'
    );
  });

  // Until no deployment sets RESET_URL_BASE this path can still be moved from a
  // manifest, where neither repo's tests can see it. Asserted so the override is
  // a deliberate thing someone reads about rather than a surprise.
  it('lets RESET_URL_BASE override the reset origin and path', () => {
    withBase('https://app.test');
    process.env.RESET_URL_BASE = 'https://legacy.test/password/new';
    expect(passwordResetLink('abc')).toBe('https://legacy.test/password/new?token=abc');
  });
});
