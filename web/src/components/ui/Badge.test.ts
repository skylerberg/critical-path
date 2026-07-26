import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Badge from './Badge.svelte';

const children = createRawSnippet(() => ({
  render: () => '<span>2 of 4</span>',
}));

describe('Badge', () => {
  it('never shrinks or wraps, so callers can put it in a flex row unguarded', () => {
    render(Badge, { props: { children } });

    expect(screen.getByText('2 of 4').parentElement).toHaveClass('shrink-0', 'whitespace-nowrap');
  });
});
