import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import ShortcutHelp from './ShortcutHelp.svelte';

describe('ShortcutHelp', () => {
  it('documents m as the move command', () => {
    render(ShortcutHelp, { onclose: vi.fn() });

    const row = screen.getByText('Move the selected task to a column and position').closest('li')!;

    expect(within(row).getByText('m')).toBeVisible();
  });
});
