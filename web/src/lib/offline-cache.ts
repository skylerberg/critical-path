import type { BoardColumn, BoardLabel, BoardProject, BoardTask } from './board-types';
import { clearForUser, readSnapshot, writeSnapshot } from './offline-db';
import type { Project } from './projects.svelte';
import type { User } from './users.svelte';

/**
 * The last state this device saw, kept so a load with no network shows the board
 * instead of an error.
 *
 * Deliberately here rather than in the service worker's HTTP cache. Auth is a
 * bearer header while Workbox keys entries by URL, so a cached board response
 * would be handed to whoever loads that URL next on the device — the same
 * problem `clearMediaCaches` exists to undo for images, on far more sensitive
 * data. Keying every entry by account instead makes the purge exact, lets the
 * app show *when* it last synced, and leaves the deliberate `NetworkOnly` rule
 * for /api/ in vite.config.ts alone.
 *
 * It also stores what is on screen rather than what the server last said, so a
 * reload while offline comes back with the user's own unsent edits in place
 * instead of a snapshot that silently predates them.
 */
export interface BoardSnapshot {
  project: BoardProject;
  columns: BoardColumn[];
  tasks: BoardTask[];
  labels: BoardLabel[];
}

export interface Cached<T> {
  payload: T;
  savedAt: string;
}

function boardKey(userId: string, projectId: string): string {
  return `${userId}:board:${projectId}`;
}

function shellKey(userId: string, kind: 'projects' | 'users'): string {
  return `${userId}:${kind}`;
}

async function read<T>(
  key: string,
  valid: (payload: unknown) => boolean
): Promise<Cached<T> | null> {
  const record = await readSnapshot(key);
  if (record === null || !valid(record.payload)) {
    return null;
  }
  return { payload: record.payload as T, savedAt: record.savedAt };
}

// Every field the board store dereferences without checking, `project` included:
// its first act on a cached board is to compare `payload.project.id` against the
// project being opened, so a record that satisfies this but has no project is a
// crash rather than a cache miss.
const isBoard = (payload: unknown): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  typeof (payload as BoardSnapshot).project === 'object' &&
  (payload as BoardSnapshot).project !== null &&
  Array.isArray((payload as BoardSnapshot).tasks) &&
  Array.isArray((payload as BoardSnapshot).columns);

export async function saveBoardSnapshot(
  userId: string,
  projectId: string,
  snapshot: BoardSnapshot
): Promise<void> {
  await writeSnapshot(boardKey(userId, projectId), userId, snapshot, new Date().toISOString());
}

export async function readBoardSnapshot(
  userId: string,
  projectId: string
): Promise<Cached<BoardSnapshot> | null> {
  return read<BoardSnapshot>(boardKey(userId, projectId), isBoard);
}

/**
 * The shell around the board. Without these an offline launch renders a working
 * board inside an empty sidebar with unresolved avatars, which reads as a broken
 * app rather than a degraded one.
 */
export async function saveProjectsSnapshot(userId: string, projects: Project[]): Promise<void> {
  await writeSnapshot(shellKey(userId, 'projects'), userId, projects, new Date().toISOString());
}

export async function readProjectsSnapshot(userId: string): Promise<Project[] | null> {
  return (await read<Project[]>(shellKey(userId, 'projects'), Array.isArray))?.payload ?? null;
}

export async function saveUsersSnapshot(userId: string, users: User[]): Promise<void> {
  await writeSnapshot(shellKey(userId, 'users'), userId, users, new Date().toISOString());
}

export async function readUsersSnapshot(userId: string): Promise<User[] | null> {
  return (await read<User[]>(shellKey(userId, 'users'), Array.isArray))?.payload ?? null;
}

// Signing out has to leave nothing behind, for the same reason the image caches
// are dropped: the next person to use this device is not necessarily this one.
export async function clearOfflineCache(userId: string): Promise<void> {
  await clearForUser(userId);
}
