import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildInfo, resetBuildInfoCache } from '../../src/config/buildInfo';

beforeEach(() => {
  resetBuildInfoCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetBuildInfoCache();
});

describe('buildInfo', () => {
  // What the deploy substitutes into the manifest. There is no .git in the
  // image, so this is the only source that exists in production.
  it('prefers the environment the deploy sets', () => {
    vi.stubEnv('BUILD_BRANCH', 'main');
    vi.stubEnv('BUILD_COMMIT', '0123456789abcdef0123456789abcdef01234567');
    expect(buildInfo()).toEqual({ branch: 'main', commit: '0123456' });
  });

  it('shortens the commit to seven characters', () => {
    vi.stubEnv('BUILD_COMMIT', 'abcdef1234567890');
    expect(buildInfo().commit).toHaveLength(7);
  });

  it('treats an empty variable as absent rather than as an empty branch', () => {
    vi.stubEnv('BUILD_BRANCH', '   ');
    vi.stubEnv('BUILD_COMMIT', '');
    const info = buildInfo();
    expect(info.branch).not.toBe('');
    expect(info.commit).not.toBe('');
  });

  // The development case, and the one that matters locally: two worktrees on
  // two ports are indistinguishable until one of them says which branch it is.
  it('reads the checkout when the deploy set nothing', () => {
    vi.stubEnv('BUILD_BRANCH', undefined);
    vi.stubEnv('BUILD_COMMIT', undefined);
    const info = buildInfo();
    expect(info.branch).toBeTruthy();
    expect(info.commit).toMatch(/^[0-9a-f]{7}$/);
  });

  // Shelling out per request would put a subprocess spawn on the readiness
  // probe's path, which k8s hits every ten seconds per replica.
  it('reads once and caches', () => {
    vi.stubEnv('BUILD_BRANCH', undefined);
    const first = buildInfo();
    vi.stubEnv('BUILD_BRANCH', 'something-else');
    expect(buildInfo()).toBe(first);
  });
});
