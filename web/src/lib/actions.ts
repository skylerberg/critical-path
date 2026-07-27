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

const TOUCH_CONTEXT_MENU_MARKER = 'data-no-touch-context-menu';

let contextMenuGuardInstalled = false;

function onContextMenu(event: PointerEvent): void {
  if (event.pointerType !== 'touch') {
    return;
  }
  const target = event.target;
  if (target instanceof Element && target.closest(`[${TOUCH_CONTEXT_MENU_MARKER}]`)) {
    event.preventDefault();
  }
}

/**
 * Keeps the long press that starts a touch drag from raising the link menu that
 * cancels it. The listener must be document-level: the drag preview is a
 * listener-less clone reparented to the body, so by the time the press is long
 * enough the element under the finger is no longer this node — but the marker
 * attribute is copied onto the clone.
 */
export function suppressTouchContextMenu(node: HTMLElement): void {
  node.setAttribute(TOUCH_CONTEXT_MENU_MARKER, '');
  if (contextMenuGuardInstalled) {
    return;
  }
  contextMenuGuardInstalled = true;
  document.addEventListener('contextmenu', onContextMenu, { capture: true });
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
