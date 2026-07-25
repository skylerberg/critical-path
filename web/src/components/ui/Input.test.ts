import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Input from './Input.svelte';

describe('ui/Input', () => {
  it('labels the input and forwards arbitrary attributes', () => {
    render(Input, { label: 'Email', placeholder: 'you@example.com', type: 'email' });

    const input = screen.getByLabelText<HTMLInputElement>('Email');
    expect(input.type).toBe('email');
    expect(input).toHaveAttribute('placeholder', 'you@example.com');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the input invalid and shows the message when error is set', () => {
    render(Input, { label: 'Name', error: 'Required' });

    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});
