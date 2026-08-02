import { afterEach, describe, expect, it } from 'vitest';
import { suppressTouchContextMenu } from './actions';

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
