import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusIf, focusRemainsInside, suppressTouchContextMenu } from './actions';

function anchor(guarded = true): HTMLAnchorElement {
  const element = document.createElement('a');
  element.href = '/projects/p1/tasks/t1';
  document.body.append(element);
  if (guarded) {
    suppressTouchContextMenu(element);
  }
  return element;
}

function contextMenu(target: Element, pointerType: string): boolean {
  const event = new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  document.body.innerHTML = '';
  // vi.spyOn hands back the existing spy when a method is already mocked, so
  // without this a later test inherits an earlier one's call count.
  vi.restoreAllMocks();
});

describe('suppressTouchContextMenu', () => {
  it('cancels the long-press menu on a touch', () => {
    expect(contextMenu(anchor(), 'touch')).toBe(true);
  });

  it('cancels the long-press menu on a stylus', () => {
    expect(contextMenu(anchor(), 'pen')).toBe(true);
  });

  it('leaves a mouse right-click alone so open-in-new-tab and copy-link still work', () => {
    expect(contextMenu(anchor(), 'mouse')).toBe(false);
  });

  it('leaves the keyboard context-menu key alone', () => {
    expect(contextMenu(anchor(), '')).toBe(false);
  });

  it('cancels nothing outside a guarded element', () => {
    const guarded = anchor();
    const plain = anchor(false);

    expect(contextMenu(plain, 'touch')).toBe(false);
    expect(contextMenu(guarded, 'touch')).toBe(true);
  });

  it('cancels the menu on descendants of a guarded element', () => {
    const guarded = anchor();
    const label = document.createElement('span');
    guarded.append(label);

    expect(contextMenu(label, 'touch')).toBe(true);
  });

  // A long press inside text being edited is asking for Select and Paste, which
  // nothing here has a better answer for.
  it('leaves text entry inside a guarded element to the platform', () => {
    const guarded = anchor();

    for (const tag of ['input', 'textarea'] as const) {
      const field = document.createElement(tag);
      guarded.append(field);
      expect(contextMenu(field, 'touch')).toBe(false);
    }

    const editable = document.createElement('div');
    // jsdom leaves isContentEditable hardcoded to false.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    guarded.append(editable);
    expect(contextMenu(editable, 'touch')).toBe(false);
  });

  // The drag preview under the finger is a listener-less clone of the card.
  it('cancels the menu on a detached clone of a guarded element', () => {
    const clone = anchor().cloneNode(true);
    document.body.append(clone);

    expect(contextMenu(clone as Element, 'touch')).toBe(true);
  });

  describe('on an engine that dispatches contextmenu as a plain MouseEvent', () => {
    function pointer(target: Element, type: string, pointerType: string, pointerId: number): void {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, pointerId }));
    }

    function mouseContextMenu(target: Element): boolean {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }

    it('cancels the menu while a finger is down and stops once it lifts', () => {
      const element = anchor();

      pointer(element, 'pointerdown', 'touch', 1);
      expect(mouseContextMenu(element)).toBe(true);

      pointer(element, 'pointerup', 'touch', 1);
      expect(mouseContextMenu(element)).toBe(false);
    });

    it('leaves a right-click alone, because its pointerdown lands first', () => {
      const element = anchor();

      pointer(element, 'pointerdown', 'mouse', 2);

      expect(mouseContextMenu(element)).toBe(false);
    });
  });
});

// focus() reveals a node by scrolling every scrollable ancestor on both axes, and
// one ancestor of every form this action opens is the board's horizontal snap
// scroller — which it pans, and which then resolves that pan onto another column.
// Each call site opens in place from a button the user can already see, so there
// is nothing the suppressed scroll was revealing.
describe('focusIf', () => {
  function input(): HTMLInputElement {
    const element = document.createElement('input');
    document.body.append(element);
    return element;
  }

  it('focuses without scrolling when the user opened the form', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const element = input();
    let focused = 0;

    focusIf(element, { active: true, onfocused: () => (focused += 1) });

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(element).toHaveFocus();
    expect(focused).toBe(1);
  });

  it('leaves focus alone for a restored draft', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    let focused = 0;

    focusIf(input(), { active: false, onfocused: () => (focused += 1) });

    expect(focus).not.toHaveBeenCalled();
    expect(focused).toBe(0);
  });
});

function focusOut(container: HTMLElement, relatedTarget: EventTarget | null): boolean {
  let answer: boolean | null = null;
  container.addEventListener('focusout', (event) => {
    answer = focusRemainsInside(event as FocusEvent & { currentTarget: HTMLElement });
  });
  container.dispatchEvent(new FocusEvent('focusout', { relatedTarget }));
  return answer as unknown as boolean;
}

describe('focusRemainsInside', () => {
  it('is true when focus moves to another control inside the element', () => {
    const container = document.createElement('div');
    const inner = document.createElement('button');
    container.append(inner);
    expect(focusOut(container, inner)).toBe(true);
  });

  it('is false when focus moves to something outside the element', () => {
    const container = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(container, outside);
    expect(focusOut(container, outside)).toBe(false);
  });

  it('is false when nothing takes focus', () => {
    expect(focusOut(document.createElement('div'), null)).toBe(false);
  });
});
