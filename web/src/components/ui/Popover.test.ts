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

/**
 * jsdom measures nothing, so the three inputs to the clamp are stubbed and the
 * trigger arrives on a rerender — the effect reads it as a prop, so that is what
 * makes it run against measurements that exist.
 */
async function positioned(metrics: {
  triggerLeft: number;
  room: number;
  panelWidth: number;
}): Promise<HTMLElement> {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  Object.defineProperty(trigger, 'offsetLeft', { configurable: true, value: metrics.triggerLeft });

  const wrapper = document.createElement('div');
  Object.defineProperty(wrapper, 'clientWidth', { configurable: true, value: metrics.room });

  const { rerender } = render(Popover, {
    props: { trigger: undefined, label: 'Labels', onclose: vi.fn(), children },
  });
  const panel = screen.getByRole('group', { name: 'Labels' });
  Object.defineProperty(panel, 'offsetParent', { configurable: true, get: () => wrapper });
  Object.defineProperty(panel, 'offsetWidth', { configurable: true, value: metrics.panelWidth });

  await rerender({ trigger });
  return panel;
}

// The panel is clipped rather than scrolled back into view: it lives inside the
// task overlay's scrollport, so a left the trigger's own offset would give it is
// a panel the user cannot reach.
describe('Popover placement', () => {
  it('lines the panel up with its trigger when the row has room', async () => {
    const panel = await positioned({ triggerLeft: 40, room: 400, panelWidth: 200 });

    expect(panel.style.left).toBe('40px');
  });

  it('pulls a panel opened near the right edge back inside the row', async () => {
    const panel = await positioned({ triggerLeft: 350, room: 400, panelWidth: 200 });

    expect(panel.style.left).toBe('200px');
  });

  it('keeps a panel wider than the row at the left edge rather than off it', async () => {
    const panel = await positioned({ triggerLeft: 40, room: 200, panelWidth: 320 });

    expect(panel.style.left).toBe('0px');
  });
});

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
