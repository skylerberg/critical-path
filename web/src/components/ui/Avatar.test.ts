import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Avatar from './Avatar.svelte';

describe('Avatar', () => {
  it('renders the image when a src is given', () => {
    render(Avatar, { name: 'Ada Lovelace', src: '/api/avatars/key-1' });

    const img = screen.getByTitle('Ada Lovelace');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', '/api/avatars/key-1');
    expect(screen.queryByText('AL')).not.toBeInTheDocument();
  });

  it('renders initials when there is no src', () => {
    render(Avatar, { name: 'Ada Lovelace', src: null });

    expect(screen.getByTitle('Ada Lovelace')).toHaveTextContent('AL');
    expect(document.querySelector('img')).toBeNull();
  });

  it('falls back to initials when the image fails to load', async () => {
    render(Avatar, { name: 'Ada Lovelace', src: '/api/avatars/gone' });

    await fireEvent.error(screen.getByTitle('Ada Lovelace'));

    expect(screen.getByTitle('Ada Lovelace')).toHaveTextContent('AL');
    expect(document.querySelector('img')).toBeNull();
  });
});
