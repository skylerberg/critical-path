import type { ActionReturn } from 'svelte/action';

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
 * An action rather than the DOM `autofocus` attribute, which trips Svelte's
 * a11y_autofocus rule and is inert in jsdom. `preventScroll` for the reason
 * above: the panel carrying this field has just opened on screen.
 */
export function focusOnMount(node: HTMLElement): void {
  node.focus({ preventScroll: true });
}

/** For a field opened to replace what it holds rather than append to it. */
export function focusAndSelect(node: HTMLInputElement | HTMLTextAreaElement): void {
  focusOnMount(node);
  node.select();
}

/**
 * A focusout whose relatedTarget is still inside the element is focus moving
 * between the element's own controls, not focus leaving it. A null relatedTarget
 * (window blur, a click on dead space) counts as leaving.
 *
 * Not an action — a predicate for an `onfocusout` handler — but it lives here so
 * that everything deciding what focus means has one home.
 */
export function focusRemainsInside(event: FocusEvent & { currentTarget: HTMLElement }): boolean {
  const next = event.relatedTarget;
  return next instanceof Node && event.currentTarget.contains(next);
}

/**
 * Whether an event began inside `root`, answered from the path the browser fixed
 * when it was dispatched rather than from where the target sits by the time this
 * runs. The two disagree exactly when a handler re-renders what was clicked: the
 * column kebab's "Sort by" row replaces the menu's rows with the sort options, so
 * a window-level guard is handed a node that belongs to no tree at all, and
 * `root.contains(target)` calls a click that never left the menu an outside
 * click — which is what dismissed the whole menu instead of expanding it.
 *
 * A real press is the only way to see that. A dispatched MouseEvent leaves the
 * re-render until after the event has finished propagating, so the guard is
 * handed the node still in place and every tier below a browser reports a menu
 * that stays open; `scripts/check-column-menu.mjs` is where the real press lives.
 *
 * Only answerable during dispatch — composedPath() is empty once propagation
 * ends, so a guard that defers this question to a microtask is told everything
 * started outside.
 */
export function startedInside(event: Event, root: Node | undefined): boolean {
  return root !== undefined && event.composedPath().includes(root);
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

interface MenuKeysParams {
  onclose: (opts?: { restoreFocus?: boolean }) => void;
  /**
   * Last look at a key none of the menu keys claimed — the rows a menu advertises
   * through `aria-keyshortcuts` have to work while they are on screen. Return true
   * when handled.
   */
  onunhandledkey?: (event: KeyboardEvent, rows: HTMLElement[]) => boolean;
}

/**
 * The keyboard half of `role="menu"`. The role is the part that costs something
 * to get wrong: it puts NVDA and JAWS into application mode, where arrow keys are
 * expected to drive the menu and Tab is not the navigation key — so a menu that
 * carries the role and leaves the browser's tabbing in place is worse off than
 * one that never claimed it.
 *
 * Focus moves to the first row on open and again whenever the rows are replaced
 * under it — a submenu swaps the whole list, and removing the focused row drops
 * focus to the body, where none of these keys reach.
 */
export function menuKeys(node: HTMLElement, params: MenuKeysParams): ActionReturn<MenuKeysParams> {
  let current = params;

  const rows = (): HTMLElement[] => [
    ...node.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'),
  ];

  function focusFirst(): void {
    rows()[0]?.focus({ preventScroll: true });
  }

  function moveFocus(to: number | 'first' | 'last'): void {
    const focusable = rows();
    if (focusable.length === 0) {
      return;
    }
    const from = focusable.indexOf(document.activeElement as HTMLElement);
    const index =
      to === 'first'
        ? 0
        : to === 'last'
          ? focusable.length - 1
          : (from + to + focusable.length) % focusable.length;
    focusable[index]?.focus();
  }

  function onkeydown(event: KeyboardEvent): void {
    // Tab is deliberately not swallowed: the menu closes, focus lands back on the
    // trigger, and the browser's own Tab carries on out of it from there rather
    // than the menu trapping it.
    if (event.key === 'Tab') {
      current.onclose({ restoreFocus: true });
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        moveFocus(1);
        break;
      case 'ArrowUp':
        moveFocus(-1);
        break;
      case 'Home':
        moveFocus('first');
        break;
      case 'End':
        moveFocus('last');
        break;
      case 'Escape':
        current.onclose({ restoreFocus: true });
        break;
      // Anchors have no Space activation of their own, and canceling the key is
      // what keeps a button from firing a second time on keyup.
      case ' ':
        rows()
          .find((row) => row === document.activeElement)
          ?.click();
        break;
      default:
        if (current.onunhandledkey?.(event, rows()) !== true) {
          return;
        }
    }
    event.preventDefault();
    event.stopPropagation();
  }

  const observer = new MutationObserver(() => {
    if (!node.contains(document.activeElement)) {
      focusFirst();
    }
  });
  observer.observe(node, { childList: true, subtree: true });
  focusFirst();
  node.addEventListener('keydown', onkeydown);

  return {
    update(next) {
      current = next;
    },
    destroy() {
      observer.disconnect();
      node.removeEventListener('keydown', onkeydown);
    },
  };
}
