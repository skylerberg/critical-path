import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toasts } from './toasts.svelte';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
  vi.useRealTimers();
});

describe('toasts', () => {
  it('queues success and error toasts with variants', () => {
    toasts.success('saved');
    toasts.error('boom');
    expect(toasts.toasts).toHaveLength(2);
    expect(toasts.toasts[0]).toMatchObject({ message: 'saved', variant: 'success' });
    expect(toasts.toasts[1]).toMatchObject({ message: 'boom', variant: 'error' });
  });

  it('auto-dismisses after the duration', () => {
    toasts.success('bye', 1000);
    expect(toasts.toasts).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(toasts.toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.toasts).toHaveLength(0);
  });

  it('dismisses manually by id and cancels the timer', () => {
    const id = toasts.error('boom');
    toasts.dismiss(id);
    expect(toasts.toasts).toHaveLength(0);
    vi.runAllTimers();
    expect(toasts.toasts).toHaveLength(0);
  });

  it('only removes the dismissed toast', () => {
    const first = toasts.success('one');
    toasts.success('two');
    toasts.dismiss(first);
    expect(toasts.toasts.map((t) => t.message)).toEqual(['two']);
  });

  it('shows an info toast with the info variant', () => {
    toasts.info('note');
    expect(toasts.toasts[0]).toMatchObject({ message: 'note', variant: 'info' });
  });
});

describe('action toasts', () => {
  it('stays until the user acts (no auto-dismiss)', () => {
    toasts.action('update ready', { label: 'Reload', run: () => {} });
    vi.runAllTimers();
    expect(toasts.toasts).toHaveLength(1);
  });

  it('runs the action and dismisses the toast', () => {
    const run = vi.fn();
    const id = toasts.action('update ready', { label: 'Reload', run });
    toasts.runAction(id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts.toasts).toHaveLength(0);
  });

  it('dismisses without running the action', () => {
    const run = vi.fn();
    const id = toasts.action('update ready', { label: 'Reload', run });
    toasts.dismiss(id);
    expect(run).not.toHaveBeenCalled();
    expect(toasts.toasts).toHaveLength(0);
  });

  it('ignores runAction on a toast with no action', () => {
    const id = toasts.success('plain');
    expect(() => toasts.runAction(id)).not.toThrow();
    expect(toasts.toasts).toHaveLength(1);
  });
});
