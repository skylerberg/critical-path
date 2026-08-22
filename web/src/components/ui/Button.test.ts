import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Button from './Button.svelte';

const children = createRawSnippet(() => ({
  render: () => '<span>Click me</span>',
}));

describe('Button', () => {
  it('renders its children', () => {
    render(Button, { props: { children } });
    expect(screen.getByRole('button')).toHaveTextContent('Click me');
  });

  it('calls onclick when clicked', async () => {
    const onclick = vi.fn();
    render(Button, { props: { children, onclick } });
    screen.getByRole('button').click();
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onclick = vi.fn();
    render(Button, { props: { children, onclick, disabled: true } });
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    button.click();
    expect(onclick).not.toHaveBeenCalled();
  });
});
