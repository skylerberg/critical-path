import { SvelteMap } from 'svelte/reactivity';

/**
 * A composer is open exactly while it has an entry: starting one stores `''`,
 * closing one deletes it. So emptying the text never collapses the form under
 * the user, and a composer the user closed can never be re-opened by a leftover
 * draft.
 */
export const draftKey = {
  quickAddTask: (columnId: string): string => `quickAddTask:${columnId}`,
  addColumn: (projectId: string): string => `addColumn:${projectId}`,
  graphAddTask: (projectId: string): string => `graphAddTask:${projectId}`,
};

class DraftStore {
  #texts = new SvelteMap<string, string>();

  get(key: string): string | null {
    return this.#texts.get(key) ?? null;
  }

  set(key: string, text: string): void {
    this.#texts.set(key, text);
  }

  clear(key: string): void {
    this.#texts.delete(key);
  }

  clearAll(): void {
    this.#texts.clear();
  }
}

export const drafts = new DraftStore();
