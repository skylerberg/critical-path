/**
 * Whether this client is being told about a project's changes right now, and has
 * been without a break since some earlier moment.
 *
 * The socket carries every change the board payload describes — tasks, columns,
 * labels, and the comments, checklist items and attachments an open card reads —
 * so a read that only revalidates what is already on screen is one the socket has
 * already answered. Being subscribed *now* is not enough to skip such a read: a
 * socket that dropped and came back is subscribed again, having missed whatever
 * was published while it was away. So this is a token rather than a flag. It
 * changes whenever a gap could have opened — a close, a fresh handshake, a
 * subscription moving to another project — and what a reader read stays current
 * for exactly as long as the same token keeps coming back.
 *
 * Readers capture before the read and compare after it, never the other way
 * round: a subscription that began while a read was in flight covers neither the
 * events published before it nor the response the server built before those.
 *
 * Coverage begins when the subscribe frame is sent, not when the server says it
 * registered it, because nothing says that — this client has always applied
 * events on the assumption that a sent subscription is a live one. So a write
 * committed after the API built a response and before the socket server took the
 * subscription is in neither, and stays missing until the next gap heals it.
 * Both windows are milliseconds and they have to overlap in that order; waiting
 * for a frame back before trusting the subscription would trade that for a board
 * that revalidates on every card, which is the cost this exists to remove.
 *
 * A module of its own so both sides can have it without a cycle: the realtime
 * client already imports the stores it heals, and those stores are the readers.
 */
class RealtimeCoverage {
  #token = $state(0);
  #projectId = $state<string | null>(null);

  /** Null unless this client is receiving `projectId`'s events at this moment. */
  tokenFor(projectId: string | null): number | null {
    return projectId !== null && projectId === this.#projectId ? this.#token : null;
  }

  /** Whether `token` names an unbroken run of coverage reaching to now. */
  holds(projectId: string | null, token: number | null): boolean {
    return token !== null && this.tokenFor(projectId) === token;
  }

  // The two below belong to the realtime client alone. Every gap this has to know
  // about is something that happens to the socket, and the socket has one owner.
  begin(projectId: string): void {
    this.#token += 1;
    this.#projectId = projectId;
  }

  end(): void {
    // Nothing to invalidate: with no project covered, every token already fails.
    if (this.#projectId === null) {
      return;
    }
    this.#token += 1;
    this.#projectId = null;
  }
}

export const realtimeCoverage = new RealtimeCoverage();
