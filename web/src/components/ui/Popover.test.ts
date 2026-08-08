import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Popover from './Popover.svelte';

const children = createRawSnippet(() => ({
  render: () => '<div><input id="inner" aria-label="Filter" /><button>Row</button></div>',
}));

function open(onclose = vi.fn()): {
  onclose: ReturnType<typeof vi.fn>;
  trigger: HTMLButtonElement;
  panel: HTMLElement;
} {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  render(Popover, { props: { trigger, label: 'Labels', onclose, children } });
  return { onclose, trigger, panel: screen.getByRole('group', { name: 'Labels' }) };
}

describe('Popover', () => {
  it('renders a labeled panel holding its body', () => {
    const { panel } = open();
    expect(panel).toContainElement(screen.getByLabelText('Filter'));
  });

  it('closes on Escape and asks for the trigger to be refocused', async () => {
    const { onclose, panel } = open();
    await fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledWith({ restoreFocus: true });
  });

  // The task overlay is an unmarked <dialog>: an Escape that reached it would
  // close the whole card instead of just the picker.
  it('keeps Escape away from the surrounding dialog', async () => {
    const outer = vi.fn();
    document.body.addEventListener('keydown', outer);
    const { panel } = open();
    await fireEvent.keyDown(panel, { key: 'Escape' });
    document.body.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
  });

  it('leaves Escape alone when the body already claimed it', async () => {
    const { onclose } = open();
    const inner = screen.getByLabelText('Filter');
    inner.addEventListener('keydown', (event) => event.preventDefault());
    await fireEvent.keyDown(inner, { key: 'Escape' });
    expect(onclose).not.toHaveBeenCalled();
  });

  it('closes on a pointerdown outside itself', async () => {
    const { onclose } = open();
    await fireEvent.pointerDown(document.body);
    expect(onclose).toHaveBeenCalled();
  });

  it('stays open on a pointerdown inside itself', async () => {
    const { onclose } = open();
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Row' }));
    expect(onclose).not.toHaveBeenCalled();
  });

  // The trigger owns the toggle; closing here first would let its own click
  // immediately re-open the panel.
  it('stays open on a pointerdown on its trigger', async () => {
    const { onclose, trigger } = open();
    await fireEvent.pointerDown(trigger);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('closes when focus leaves for something outside', async () => {
    const { onclose, panel } = open();
    const outside = document.createElement('button');
    document.body.append(outside);
    await fireEvent.focusOut(panel, { relatedTarget: outside });
    expect(onclose).toHaveBeenCalled();
  });

  it('stays open while focus moves between its own controls', async () => {
    const { onclose, panel } = open();
    await fireEvent.focusOut(panel, { relatedTarget: screen.getByRole('button', { name: 'Row' }) });
    expect(onclose).not.toHaveBeenCalled();
  });

  it('stays open when nothing takes focus', async () => {
    const { onclose, panel } = open();
    await fireEvent.focusOut(panel, { relatedTarget: null });
    expect(onclose).not.toHaveBeenCalled();
  });

  it('takes focus itself when the body focuses nothing', () => {
    const { panel } = open();
    expect(panel).toHaveFocus();
  });

  // The filter bar's panel opens because its search box took focus; taking it
  // away would stop the typing that opened the panel in the first place.
  it('leaves focus on the trigger when autofocus is off', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    render(Popover, {
      props: { trigger, label: 'Labels', autofocus: false, onclose: vi.fn(), children },
    });

    expect(trigger).toHaveFocus();
  });
});
