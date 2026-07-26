import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../config';

export const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  value: unknown;
}

export function completionCachePath(configDir: string): string {
  return join(configDir, 'completion-cache.json');
}

function isLive(entry: unknown, now: number): entry is CacheEntry {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }
  const at = (entry as { at?: unknown }).at;
  return typeof at === 'number' && now - at <= CACHE_TTL_MS;
}

async function readAll(configDir: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(completionCachePath(configDir), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function readCached<T>(configDir: string, key: string): Promise<T | null> {
  const entry = (await readAll(configDir))[key];
  return isLive(entry, Date.now()) ? (entry.value as T) : null;
}

export async function writeCached<T>(configDir: string, key: string, value: T): Promise<void> {
  const now = Date.now();
  const kept = Object.entries(await readAll(configDir)).filter(([, entry]) => isLive(entry, now));
  const next: Record<string, CacheEntry> = Object.fromEntries(kept as [string, CacheEntry][]);
  next[key] = { at: now, value };
  await writeJsonAtomic(completionCachePath(configDir), next);
}
