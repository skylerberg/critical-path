// The `.svelte.` infix is load-bearing: `keys` has to be reactive state, or the
// deriveds under test never see it change and every assertion reads a cached value.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListNav, type MissingHighlight } from './list-nav.svelte';

let keys = $state<string[]>([]);

function nav(missing: MissingHighlight = 'first', list?: () => HTMLElement | null) {
  return new ListNav({ keys: () => keys, list: list ?? (() => null), missing });
}

beforeEach(() => {
  keys = ['a', 'b', 'c'];
});

describe('ListNav', () => {
  it('starts on the first row without a choice, and nowhere on an empty list', () => {
    const list = nav();
    expect(list.index).toBe(0);
    expect(list.activeKey).toBe('a');

    keys = [];
    expect(list.index).toBe(-1);
    expect(list.activeKey).toBeNull();
  });

  it('clamps at both ends', () => {
    const list = nav();

    list.move(-1);
    expect(list.activeKey).toBe('a');

    list.move(1);
    list.move(1);
    list.move(1);
    expect(list.activeKey).toBe('c');
  });

  it('refuses to move on an empty list, so the caret keeps the key', () => {
    keys = [];
    const list = nav();

    expect(list.move(1)).toBe(false);
    expect(list.index).toBe(-1);
  });

  // The bug the keyed highlight exists to prevent: an index would still read 1
  // and Enter would act on 'a'.
  it('keeps the highlight on its row when rows shift underneath', () => {
    const list = nav();
    list.move(1);
    expect(list.activeKey).toBe('b');

    keys = ['x', 'a', 'b', 'c'];

    expect(list.activeKey).toBe('b');
    expect(list.index).toBe(2);
  });

  it('falls back to the first row when the chosen row vanishes', () => {
    const list = nav('first');
    list.move(1);

    keys = ['a', 'c'];

    expect(list.index).toBe(0);
    expect(list.activeKey).toBe('a');
  });

  it('goes inert instead when the caller cannot afford a fallback', () => {
    const list = nav('inert');
    list.move(1);

    keys = ['a', 'c'];

    expect(list.index).toBe(-1);
    expect(list.activeKey).toBeNull();
  });

  it.each([1, -1] as const)('lands on the first row moving %i out of inert', (delta) => {
    const list = nav('inert');
    list.move(1);
    keys = ['a', 'c'];
    expect(list.index).toBe(-1);

    list.move(delta);

    expect(list.index).toBe(0);
  });

  it('returns to first-row semantics when cleared', () => {
    const list = nav('inert');
    list.move(1);
    list.highlight('c');
    expect(list.activeKey).toBe('c');

    list.clear();

    expect(list.activeKey).toBe('a');
  });
});

describe('ListNav reveal', () => {
  function withRows(): { container: HTMLElement; rows: HTMLElement[] } {
    const container = document.createElement('div');
    const rows = keys.map((key, index) => {
      const row = document.createElement('button');
      row.dataset.index = String(index);
      row.textContent = key;
      container.append(row);
      return row;
    });
    document.body.append(container);
    return { container, rows };
  }

  it('scrolls the newly highlighted row into view', () => {
    const { container, rows } = withRows();
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const list = nav('first', () => container);

    list.move(1);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(rows[1]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('drags focus along only when focus is already in the list', () => {
    const { container, rows } = withRows();
    const list = nav('first', () => container);

    list.move(1);
    expect(document.activeElement).not.toBe(rows[1]);

    rows[1]!.focus();
    list.move(1);

    expect(document.activeElement).toBe(rows[2]);
  });
});
