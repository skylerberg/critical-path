// A focusout whose relatedTarget is still inside the element is focus moving
// between the element's own controls, not focus leaving it. A null relatedTarget
// (window blur, a click on dead space) counts as leaving.
export function focusRemainsInside(event: FocusEvent & { currentTarget: HTMLElement }): boolean {
  const next = event.relatedTarget;
  return next instanceof Node && event.currentTarget.contains(next);
}
