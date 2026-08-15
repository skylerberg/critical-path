import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CACHE_TTL_MS,
  completionCachePath,
  readCached,
  writeCached,
} from '../../src/completion/cache';
import { candidatesFor } from '../../src/completion/candidates';
import type { CompletionPlan } from '../../src/completion/plan';
import type { RuntimeContext } from '../../src/context';

const PROJECTS_PLAN: CompletionPlan = { kind: 'values', valueKind: 'project' };
const ALPHA = { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Alpha' };
const BETA = { id: 'bbbbbbbb-2222-4222-8222-222222222222', name: 'Beta' };
const TOKEN_A = 'session-token-aaa';
const TOKEN_B = 'session-token-bbb';

async function tempDir(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'cpath-cache-')), 'config');
}

function ctxFor(
  configDir: string,
  token: string,
  projects: { id: string; name: string }[],
  fetches: { count: number },
  baseUrl = 'http://localhost:3001'
): RuntimeContext {
  return {
    configDir,
    token,
    baseUrl,
    api: {
      GET: () => {
        fetches.count += 1;
        return Promise.resolve({
          data: { projects },
          response: new Response(null, { status: 200 }),
        });
      },
    },
  } as unknown as RuntimeContext;
}

async function stampEntry(dir: string, key: string, at: number): Promise<void> {
  const path = completionCachePath(dir);
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, { at: number }>;
  parsed[key].at = at;
  await writeFile(path, JSON.stringify(parsed));
}

describe('completion cache', () => {
  it('reads back a value written within the TTL', async () => {
    const dir = await tempDir();
    await writeCached(dir, 'tok|url|projects', [{ id: 'a', name: 'Alpha' }]);
    expect(await readCached(dir, 'tok|url|projects')).toEqual([{ id: 'a', name: 'Alpha' }]);
  });

  it('treats an entry older than the TTL as a miss', async () => {
    const dir = await tempDir();
    await writeCached(dir, 'k', 'value');
    await stampEntry(dir, 'k', Date.now() - CACHE_TTL_MS - 1);
    expect(await readCached(dir, 'k')).toBeNull();
  });

  it('treats a missing file as a miss', async () => {
    expect(await readCached(await tempDir(), 'k')).toBeNull();
  });

  it('treats a corrupt file as a miss instead of throwing', async () => {
    const dir = await tempDir();
    await writeCached(dir, 'k', 'value');
    await writeFile(completionCachePath(dir), 'not json');
    expect(await readCached(dir, 'k')).toBeNull();
  });

  it('treats a key nothing was written under as a miss', async () => {
    const dir = await tempDir();
    await writeCached(dir, 'tokenA|url|projects', ['secret']);
    expect(await readCached(dir, 'tokenB|url|projects')).toBeNull();
  });

  it('keeps live entries and prunes expired ones on write', async () => {
    const dir = await tempDir();
    await writeCached(dir, 'live', 'still here');
    await writeCached(dir, 'stale', 'gone');
    await stampEntry(dir, 'stale', Date.now() - CACHE_TTL_MS - 1);

    await writeCached(dir, 'fresh', 'new');

    expect(await readCached(dir, 'live')).toBe('still here');
    expect(await readCached(dir, 'fresh')).toBe('new');
    const parsed = JSON.parse(await readFile(completionCachePath(dir), 'utf8')) as object;
    expect(Object.keys(parsed).sort()).toEqual(['fresh', 'live']);
  });

  it('creates the config directory on first write', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'cpath-cache-')), 'never', 'created');
    await writeCached(dir, 'k', 1);
    expect(await readCached(dir, 'k')).toBe(1);
  });
});

describe('completion cache keys', () => {
  it('serves one account its own entry and re-fetches for another in the same config dir', async () => {
    const dir = await tempDir();
    const fetches = { count: 0 };

    expect(await candidatesFor(ctxFor(dir, TOKEN_A, [ALPHA], fetches), PROJECTS_PLAN)).toEqual([
      { value: 'Alpha', description: 'aaaaaaaa' },
    ]);
    expect(fetches.count).toBe(1);

    expect(await candidatesFor(ctxFor(dir, TOKEN_A, [BETA], fetches), PROJECTS_PLAN)).toEqual([
      { value: 'Alpha', description: 'aaaaaaaa' },
    ]);
    expect(fetches.count).toBe(1);

    expect(await candidatesFor(ctxFor(dir, TOKEN_B, [BETA], fetches), PROJECTS_PLAN)).toEqual([
      { value: 'Beta', description: 'bbbbbbbb' },
    ]);
    expect(fetches.count).toBe(2);
  });

  it('re-fetches for the same account against a different API', async () => {
    const dir = await tempDir();
    const fetches = { count: 0 };
    await candidatesFor(ctxFor(dir, TOKEN_A, [ALPHA], fetches), PROJECTS_PLAN);

    expect(
      await candidatesFor(
        ctxFor(dir, TOKEN_A, [BETA], fetches, 'https://staging.example.com'),
        PROJECTS_PLAN
      )
    ).toEqual([{ value: 'Beta', description: 'bbbbbbbb' }]);
    expect(fetches.count).toBe(2);
  });

  it('writes a token fingerprint, never the token itself', async () => {
    const dir = await tempDir();
    await candidatesFor(ctxFor(dir, TOKEN_A, [ALPHA], { count: 0 }), PROJECTS_PLAN);

    const raw = await readFile(completionCachePath(dir), 'utf8');
    expect(raw).not.toContain(TOKEN_A);
    expect(Object.keys(JSON.parse(raw) as object)).toEqual([
      expect.stringMatching(/^[0-9a-f]{12}\|http:\/\/localhost:3001\|projects$/),
    ]);
  });
});
