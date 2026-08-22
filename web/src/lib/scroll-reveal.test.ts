import { afterEach, describe, it, expect, vi } from 'vitest';
import { revealInList, verticalRevealDelta } from './scroll-reveal';

afterEach(() => {
  document.body.innerHTML = '';
  // vi.spyOn hands back the existing spy when a method is already mocked, so
  // without this a later test inherits an earlier one's call count.
  vi.restoreAllMocks();
});

describe('verticalRevealDelta', () => {
  const view = { top: 0, bottom: 400 };

  it('is 0 for a target already inside the view', () => {
    expect(verticalRevealDelta(view, { top: 100, bottom: 160 })).toBe(0);
  });

  it('scrolls down the least needed to show a target below the fold', () => {
    expect(verticalRevealDelta(view, { top: 380, bottom: 440 })).toBe(40);
  });

  it('scrolls up the least needed to show a target above the fold', () => {
    expect(verticalRevealDelta(view, { top: -30, bottom: 30 })).toBe(-30);
  });

  it('aligns a target taller than the view to its top', () => {
    expect(verticalRevealDelta(view, { top: 50, bottom: 900 })).toBe(50);
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
