import { describe, expect, it } from 'vitest';
import { focusRemainsInside } from './focus';

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
