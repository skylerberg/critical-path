/**
 * What one open card can honestly say about its own writes.
 *
 * `sync-state.ts` answers the same question for the whole account and is shown
 * once, at the bottom of the screen. This one is scoped to a single card,
 * because that is the question people are actually asking when they scroll to
 * the end of a card looking for a Save button: not "is the app caught up" but
 * "is *this* on the server yet". Work queued against some other card is the
 * global indicator's business and must not make this card report unsaved.
 *
 * The claim rule is the same one `syncMessage` holds itself to: "Saved" is never
 * said about something still sitting in the queue. There is a state between
 * saved and failed and it has its own name.
 */
export type CardSaveState =
  /** Everything typed here has been stored. */
  | 'saved'
  /** A write for this card is scheduled or on the wire. */
  | 'saving'
  /** Typed, and no request has carried it yet — parked locally, not failing. */
  | 'unsent'
  /** A change did not land and needs the user. */
  | 'error';

export interface CardSaveInputs {
  /** A conflict on this card, a rejected change, or a description save that failed. */
  failed: boolean;
  /** Unsent work for this card is in the offline queue. */
  queued: boolean;
  /** The queue is going out right now, so what is in it is moving. */
  draining: boolean;
  /** A save for this card's description is debounced or in flight. */
  saving: boolean;
  /** Text typed into the title that no request has carried yet. */
  dirty: boolean;
}

/**
 * Ordered so the most consequential thing true right now is the thing shown.
 *
 * The queue outranks the editor: a description save that reported success into a
 * queue is not the whole story, and `draining` is what separates work that is
 * moving from work parked behind a backoff. `dirty` sits last and means the
 * title only — it commits on blur rather than on a timer, so text still in the
 * field really has not been sent, and saying "Saving…" over it would name a
 * request that does not exist. Closing the card commits it, which is the whole
 * reason the indicator sits beside the Close button.
 */
export function cardSaveState(inputs: CardSaveInputs): CardSaveState {
  if (inputs.failed) {
    return 'error';
  }
  if (inputs.queued) {
    return inputs.draining ? 'saving' : 'unsent';
  }
  if (inputs.saving) {
    return 'saving';
  }
  return inputs.dirty ? 'unsent' : 'saved';
}

/**
 * "Not saved yet" and "Not saved — needs attention" are deliberately not the
 * same sentence: the first is waiting and will go on its own, the second is over
 * and wants a person. Reading one as the other is the whole cost of getting this
 * wrong, so they differ in words and not only in the colour of a dot.
 */
export function cardSaveMessage(state: CardSaveState): string {
  switch (state) {
    case 'saved':
      return 'Saved';
    case 'saving':
      return 'Saving…';
    case 'unsent':
      return 'Not saved yet';
    case 'error':
      return 'Not saved — needs attention';
  }
}
