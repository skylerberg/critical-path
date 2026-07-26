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

async function tempDir(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'cpath-cache-')), 'config');
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

  it('does not serve an entry stored under another identity', async () => {
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
