import { tick } from 'svelte';

// Exported so a second channel can own its own region. Two independent messages
// rather than one: the blank-then-write below spans a flush, so a remote change
// landing inside that gap would replace the user's own feedback before Svelte
// ever put it in the DOM.
export class Announcer {
  message = $state('');

  // Blank, then write a flush later: an identical repeat is only re-read if the
  // region changes, and the delay keeps the text out of the flush that closes a
  // modal, whose top layer makes any region outside it inert and unspoken.
  async announce(message: string): Promise<void> {
    this.message = '';
    await tick();
    this.message = message;
  }

  clear(): void {
    this.message = '';
  }
}

export const announcer = new Announcer();
