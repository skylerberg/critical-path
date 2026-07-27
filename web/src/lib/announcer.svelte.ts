import { tick } from 'svelte';

class Announcer {
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
