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

const directPointers = new Set<number>();
let contextMenuGuardInstalled = false;

function isDirectInput(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

function trackPointerDown(event: PointerEvent): void {
  if (isDirectInput(event.pointerType)) {
    directPointers.add(event.pointerId);
  } else {
    directPointers.clear();
  }
}

function forgetPointer(event: PointerEvent): void {
  directPointers.delete(event.pointerId);
}

function onContextMenu(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest(`[${TOUCH_CONTEXT_MENU_MARKER}]`)) {
    return;
  }
  // Engines that still dispatch contextmenu as a plain MouseEvent carry no
  // pointerType, so fall back to whether a finger or stylus is currently down.
  const direct =
    event instanceof PointerEvent ? isDirectInput(event.pointerType) : directPointers.size > 0;
  if (direct) {
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
  document.addEventListener('pointerdown', trackPointerDown, { capture: true });
  document.addEventListener('pointerup', forgetPointer, { capture: true });
  document.addEventListener('pointercancel', forgetPointer, { capture: true });
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
