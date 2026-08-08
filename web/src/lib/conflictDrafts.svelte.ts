import { SvelteMap } from 'svelte/reactivity';
import type { components } from '../api/api.generated';

type TiptapDoc = components['schemas']['TiptapDoc'];

export interface TaskVersion {
  title: string;
  description: TiptapDoc | null;
}

/**
 * A task is in conflict exactly while it has an entry here, so the banner and
 * the text it promises is safe are one thing rather than two that can disagree.
 * The entry outlives the overlay: dismissing the card by any of the ways that
 * never reach close() — Back, the backdrop, a sidebar link — must not be what
 * discards an edit the server rejected.
 *
 * `base` is the version the editor was populated from. Keeping it lets the
 * resolver tell a field the user actually edited from one only the teammate
 * touched, which is the difference between offering a real choice and demanding
 * one about text nobody changed.
 */
export interface ConflictDraft {
  mine: TaskVersion;
  base: TaskVersion;
}

// The version a patch would produce: the baseline with the patch laid over it.
// A description of `null` is a cleared description and must survive the merge,
// so the check is against `undefined` rather than falsiness.
export function mergeVersion(base: TaskVersion, patch: Partial<TaskVersion>): TaskVersion {
  return {
    title: patch.title ?? base.title,
    description: patch.description !== undefined ? patch.description : base.description,
  };
}

class ConflictDraftStore {
  #drafts = new SvelteMap<string, ConflictDraft>();

  get(taskId: string): ConflictDraft | null {
    return this.#drafts.get(taskId) ?? null;
  }

  set(taskId: string, draft: ConflictDraft): void {
    this.#drafts.set(taskId, draft);
  }

  clear(taskId: string): void {
    this.#drafts.delete(taskId);
  }

  clearAll(): void {
    this.#drafts.clear();
  }
}

export const conflictDrafts = new ConflictDraftStore();
