import type { ActionReturn } from 'svelte/action';
import { verticalRevealDelta } from './board-scroll';

interface FocusIfParams {
  active: boolean;
  onfocused?: () => void;
}

/**
 * Focus on mount only when the user opened this form; a restored draft must not
 * steal focus. Firing `onfocused` makes it one-shot, so a remount caused by
 * anything other than the user reopening the form stays quiet.
 *
 * `preventScroll`, because every call site here is already on screen — the form
 * replaces the visible button that opened it — while focus()'s reveal would
 * scroll every ancestor, including the board's horizontal snap scroller.
 */
export function focusIf(node: HTMLElement, { active, onfocused }: FocusIfParams): void {
  if (active) {
    node.focus({ preventScroll: true });
    onfocused?.();
  }
}

/**
 * Scroll `list` — and nothing else — the least needed to show `target`.
 * `scrollTo` rather than `scrollBy`: jsdom implements no `scrollBy` at all.
 */
export function revealInList(list: HTMLElement, target: HTMLElement, smooth: boolean): void {
  const delta = verticalRevealDelta(list.getBoundingClientRect(), target.getBoundingClientRect());
  if (delta === 0) {
    return;
  }
  list.scrollTo({ top: list.scrollTop + delta, behavior: smooth ? 'smooth' : 'auto' });
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

/**
 * Engines that still dispatch contextmenu as a plain MouseEvent carry no
 * pointerType, so fall back to whether a finger or stylus is currently down.
 */
export function isDirectPointerEvent(event: MouseEvent): boolean {
  return event instanceof PointerEvent ? isDirectInput(event.pointerType) : directPointers.size > 0;
}

export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function onContextMenu(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest(`[${TOUCH_CONTEXT_MENU_MARKER}]`)) {
    return;
  }
  // Text being edited inside a marked node keeps the platform's own selection and
  // paste menu — that press is not a gesture the app has a better answer for.
  if (isTextEntry(target)) {
    return;
  }
  if (isDirectPointerEvent(event)) {
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
