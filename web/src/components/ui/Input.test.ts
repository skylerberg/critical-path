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

  // Visible next to the field is not read with the field: without the
  // describedby link the message is announced only if the reader wanders onto it.
  it('reads the message as the field’s description', () => {
    render(Input, { label: 'Name', error: 'Required' });

    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Required');
  });

  it('leaves the field undescribed while there is no error', () => {
    render(Input, { label: 'Name' });

    expect(screen.getByLabelText('Name')).not.toHaveAccessibleDescription();
  });

  it('takes focus on mount when autofocus is set', () => {
    render(Input, { label: 'Email', autofocus: true });

    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('leaves focus alone otherwise', () => {
    render(Input, { label: 'Email' });

    expect(document.activeElement).toBe(document.body);
  });
});
