import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusIf, focusRemainsInside, menuKeys, suppressTouchContextMenu } from './actions';

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

function menu(rowCount = 3): {
  node: HTMLElement;
  rows: HTMLButtonElement[];
  closed: { restoreFocus?: boolean }[];
  destroy: () => void;
} {
  const node = document.createElement('div');
  node.setAttribute('role', 'menu');
  node.tabIndex = -1;
  const rows = Array.from({ length: rowCount }, (_, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.setAttribute('role', 'menuitem');
    row.tabIndex = -1;
    row.textContent = `Row ${String(i)}`;
    node.append(row);
    return row;
  });
  document.body.append(node);
  const closed: { restoreFocus?: boolean }[] = [];
  const handle = menuKeys(node, { onclose: (opts) => closed.push(opts ?? {}) });
  return { node, rows, closed, destroy: () => handle.destroy?.() };
}

function press(node: HTMLElement, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('menuKeys', () => {
  it('focuses the first row on open, so the arrow keys have somewhere to start', () => {
    const { rows, destroy } = menu();

    expect(document.activeElement).toBe(rows[0]);
    destroy();
  });

  it('wraps around the rows in both directions', () => {
    const { node, rows, destroy } = menu();

    press(node, 'ArrowDown');
    expect(document.activeElement).toBe(rows[1]);
    press(node, 'ArrowUp');
    press(node, 'ArrowUp');
    expect(document.activeElement).toBe(rows[2]);
    destroy();
  });

  it('jumps to the ends with Home and End', () => {
    const { node, rows, destroy } = menu();

    press(node, 'End');
    expect(document.activeElement).toBe(rows[2]);
    press(node, 'Home');
    expect(document.activeElement).toBe(rows[0]);
    destroy();
  });

  it('cancels the keys it claims so the board behind it never sees them', () => {
    const { node, destroy } = menu();

    expect(press(node, 'ArrowDown')).toBe(true);
    expect(press(node, 'Escape')).toBe(true);
    destroy();
  });

  it('restores focus on Escape and leaves Tab uncancelled', () => {
    const { node, closed, destroy } = menu();

    press(node, 'Escape');
    expect(closed).toEqual([{ restoreFocus: true }]);
    expect(press(node, 'Tab')).toBe(false);
    expect(closed[1]).toEqual({ restoreFocus: true });
    destroy();
  });

  // A submenu replaces the whole list, and removing the focused row drops focus to
  // the body — where none of these keys reach.
  it('takes focus back when the rows are swapped underneath it', async () => {
    const { node, destroy } = menu();
    node.replaceChildren();
    const replacement = document.createElement('button');
    replacement.setAttribute('role', 'menuitem');
    replacement.textContent = 'Sort by';
    node.append(replacement);

    await vi.waitFor(() => expect(document.activeElement).toBe(replacement));
    destroy();
  });

  it('leaves an unclaimed key alone unless the menu asks for it', () => {
    const node = document.createElement('div');
    const row = document.createElement('button');
    row.setAttribute('role', 'menuitem');
    node.append(row);
    document.body.append(node);
    const seen: string[] = [];
    const handle = menuKeys(node, {
      onclose: () => undefined,
      onunhandledkey: (event) => {
        seen.push(event.key);
        return event.key === 'a';
      },
    });

    expect(press(node, 'a')).toBe(true);
    expect(press(node, 'z')).toBe(false);
    expect(seen).toEqual(['a', 'z']);
    handle.destroy?.();
  });
});
