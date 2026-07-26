import type { ActionReturn } from 'svelte/action';

interface FocusIfParams {
  active: boolean;
  onfocused?: () => void;
}

/**
 * Focus on mount only when the user opened this form; a restored draft must not
 * steal focus. Firing `onfocused` makes it one-shot, so a remount caused by
 * anything other than the user reopening the form stays quiet.
 */
export function focusIf(node: HTMLElement, { active, onfocused }: FocusIfParams): void {
  if (active) {
    node.focus();
    onfocused?.();
  }
}

/**
 * Pass a primitive key that changes only when the list's order changes; any
 * other re-render must leave the user's scroll position alone.
 */
export function scrollToTopOn(node: HTMLElement, key: string): ActionReturn<string> {
  let applied = key;
  return {
    update(next) {
      if (next !== applied) {
        applied = next;
        node.scrollTop = 0;
      }
    },
  };
}
