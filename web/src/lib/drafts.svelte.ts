import { SvelteMap } from 'svelte/reactivity';
import type { components } from '../api/api.generated';

type TiptapDoc = components['schemas']['TiptapDoc'];

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

/**
 * Rich-text drafts, kept in their own map rather than serialized into the one
 * above. A comment body is a document, and unlike the text drafts its presence
 * says nothing about whether a composer is open — the card's comment box is
 * always there once the section is expanded. What an entry does mean is that the
 * card has something unsent, which is why reopening it expands the section.
 */
export const docDraftKey = {
  taskComment: (taskId: string): string => `taskComment:${taskId}`,
};

class DraftStore {
  #texts = new SvelteMap<string, string>();
  #docs = new SvelteMap<string, TiptapDoc>();

  get(key: string): string | null {
    return this.#texts.get(key) ?? null;
  }

  set(key: string, text: string): void {
    this.#texts.set(key, text);
  }

  clear(key: string): void {
    this.#texts.delete(key);
  }

  getDoc(key: string): TiptapDoc | null {
    return this.#docs.get(key) ?? null;
  }

  setDoc(key: string, doc: TiptapDoc): void {
    this.#docs.set(key, doc);
  }

  clearDoc(key: string): void {
    this.#docs.delete(key);
  }

  clearAll(): void {
    this.#texts.clear();
    this.#docs.clear();
  }
}

export const drafts = new DraftStore();
