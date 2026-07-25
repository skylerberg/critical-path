interface FocusIfParams {
  active: boolean;
  onfocused?: () => void;
}

/**
 * Focus on mount only when the user opened this form; a restored draft must not
 * steal focus. Firing `onfocused` makes it one-shot, so a remount caused by
 * anything other than the user reopening the form stays quiet.
 */
export function focusIf(node: HTMLElement, { active, onfocused }: FocusIfParams): void {
  if (active) {
    node.focus();
    onfocused?.();
  }
}
