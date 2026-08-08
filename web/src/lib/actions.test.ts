import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusIf, revealInList, suppressTouchContextMenu } from './actions';

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

// The board scroller is a scrollable ancestor of every card, so a reveal that
// delegates to it pans the board sideways. This one moves the list and nothing else.
describe('revealInList', () => {
  function list(cardTop: number): { list: HTMLElement; card: HTMLElement } {
    const listEl = document.createElement('div');
    const card = document.createElement('div');
    listEl.append(card);
    document.body.append(listEl);
    vi.spyOn(listEl, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 288, 400));
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, cardTop, 288, 60));
    return { list: listEl, card };
  }

  it('scrolls the list the least needed to show the card', () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const { list: listEl, card } = list(380);
    listEl.scrollTop = 120;

    revealInList(listEl, card, true);

    expect(scrollTo.mock.contexts[0]).toBe(listEl);
    expect(scrollTo).toHaveBeenCalledWith({ top: 160, behavior: 'smooth' });
  });

  it('jumps rather than glides when motion is reduced', () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const { list: listEl, card } = list(380);

    revealInList(listEl, card, false);

    expect(scrollTo).toHaveBeenCalledWith({ top: 40, behavior: 'auto' });
  });

  it('scrolls nothing when the card already fits', () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const { list: listEl, card } = list(100);

    revealInList(listEl, card, true);

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
