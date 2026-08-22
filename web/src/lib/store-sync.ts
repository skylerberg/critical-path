import { apiMessage } from './apiMessages';
import { toasts } from './toasts.svelte';

/** Structural, so a store satisfies it by having the two members already. */
interface ProjectScopedStore {
  currentProjectId: string | null;
  load(projectId: string): Promise<void>;
}

/**
 * Mutations here are optimistic and never snapshot-rolled-back, so a rejection
 * always ends the same way: name what failed, then re-read the project's list as
 * the truth. Awaiting the reload is what lets a caller rethrow afterwards and
 * still show a form the resynced state.
 */
export async function mutationFailed(
  store: ProjectScopedStore,
  error: unknown,
  fallback: string
): Promise<void> {
  toasts.error(apiMessage(error, fallback));
  if (store.currentProjectId !== null) {
    await store.load(store.currentProjectId);
  }
}
