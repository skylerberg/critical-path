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

  // axe cannot reach this one: `title` counts as an accessible name of last
  // resort, so a title-only avatar passes every automated rule while a generic
  // <span> carrying it is named nothing at all.
  describe('accessible name', () => {
    it('names a standalone avatar, so an assignee is not a silent picture', () => {
      render(Avatar, { name: 'Ada Lovelace', src: null });

      expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toBeInTheDocument();
    });

    it('names a standalone image avatar through alt rather than title', () => {
      render(Avatar, { name: 'Ada Lovelace', src: '/api/avatars/key-1' });

      expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveAttribute(
        'alt',
        'Ada Lovelace'
      );
    });

    // Where the name is already written beside it, repeating it reads it twice.
    it('stays silent when the caller says the name is already shown', () => {
      render(Avatar, { name: 'Ada Lovelace', src: null, labelled: true });

      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByTitle('Ada Lovelace')).toHaveTextContent('AL');
    });

    it('leaves a labelled image decorative', () => {
      render(Avatar, { name: 'Ada Lovelace', src: '/api/avatars/key-1', labelled: true });

      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByTitle('Ada Lovelace')).toHaveAttribute('alt', '');
    });
  });
});
