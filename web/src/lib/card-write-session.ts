import type { components } from '../api/api.generated';
import type { TaskVersion } from './conflictDrafts.svelte';

type TiptapDoc = components['schemas']['TiptapDoc'];

/**
 * Everything a guarded write to one card needs to know, held apart from the card
 * the overlay currently has mounted.
 *
 * The overlay is never remounted between cards — only its `taskId` prop changes —
 * so a flush that reads the precondition off live state at the moment it runs
 * reads the card the user has moved ON to. That is not hypothetical: it sent one
 * card's description to another, and swallowed a rejection for a card that was no
 * longer on screen. A session is looked up once, synchronously, and handed to the
 * write as its first argument, so identity and baseline are fixed before the
 * first `await` rather than re-read after it.
 *
 * Plain, and deliberately not reactive: the last write of a card's life happens
 * in a teardown, and a write to `$state` there does not survive. Nothing here is
 * rendered, so nothing is lost by keeping it out.
 */
export interface CardWriteSession {
  readonly id: string;
  /**
   * The version the fields were populated from, advanced only by this overlay's
   * own successful writes. Adopting an incoming version would let the next save
   * overwrite a teammate's edit the user never saw, and the board row is
   * overwritten optimistically the moment a save starts, so it cannot tell an
   * unchanged field from an unsaved one.
   */
  baseUpdatedAt: string | null;
  baseTitle: string | null;
  baseDescription: TiptapDoc | null;
  /** The card is on its way off the board, so a queued write would 404 it — or
   * resurrect it on the next refetch. */
  removing: boolean;
}

/** The pair `board.updateTask` wants for the conflict resolver: what a rejected
 * patch was written against, as of now rather than as of the call. */
export function baseOf(session: CardWriteSession): TaskVersion {
  return { title: session.baseTitle ?? '', description: session.baseDescription };
}

/**
 * Keyed by task id, so leaving a card and coming back to it within one overlay
 * life resumes the baseline the user was shown rather than re-reading whatever
 * the board holds by then.
 */
export class CardWriteSessions {
  #byTaskId = new Map<string, CardWriteSession>();

  for(id: string): CardWriteSession {
    const existing = this.#byTaskId.get(id);
    if (existing !== undefined) return existing;
    const created: CardWriteSession = {
      id,
      baseUpdatedAt: null,
      baseTitle: null,
      baseDescription: null,
      removing: false,
    };
    this.#byTaskId.set(id, created);
    return created;
  }
}
