import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Modal from './Modal.svelte';

const children = createRawSnippet(() => ({
  render: () => '<p data-testid="body">Delete this column?</p>',
}));

function open(): { onclose: ReturnType<typeof vi.fn>; dialog: HTMLDialogElement } {
  const onclose = vi.fn();
  render(Modal, { props: { open: true, title: 'Delete column', onclose, children } });
  return { onclose, dialog: screen.getByRole('dialog') as HTMLDialogElement };
}

describe('ui/Modal', () => {
  it('opens the dialog and renders its body', () => {
    const { dialog } = open();

    expect(dialog.open).toBe(true);
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });

  it('stays shut until it is asked to open', () => {
    render(Modal, { props: { open: false, title: 'Delete column', children } });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Escape reaches a native <dialog> as `cancel`, and every caller closes by
  // clearing the `open` prop it passed in.
  it('reports Escape to the caller rather than closing behind its back', async () => {
    const { onclose, dialog } = open();

    const cancel = new Event('cancel', { cancelable: true });
    await fireEvent(dialog, cancel);

    expect(onclose).toHaveBeenCalledTimes(1);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
  });

  it('closes on a click on the backdrop', async () => {
    const { onclose, dialog } = open();

    await fireEvent.click(dialog);

    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('stays open on a click on its own content', async () => {
    const { onclose } = open();

    await fireEvent.click(screen.getByTestId('body'));

    expect(onclose).not.toHaveBeenCalled();
  });

  it('names the dialog by its title', () => {
    open();

    expect(screen.getByRole('dialog', { name: 'Delete column' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delete column' })).toBeInTheDocument();
  });

  it('keeps the accessible name when the heading is hidden', () => {
    render(Modal, {
      props: { open: true, title: 'Labels', titleHidden: true, onclose: vi.fn(), children },
    });

    expect(screen.getByRole('dialog', { name: 'Labels' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Labels' })).toBeNull();
  });
});
