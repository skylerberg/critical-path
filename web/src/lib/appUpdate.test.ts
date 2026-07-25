import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { AppUpdate } from './appUpdate';

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

function goHidden(): void {
  setVisibility('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
}

function goVisible(): void {
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
}

function registrationWith(update: () => Promise<void>): ServiceWorkerRegistration {
  return { update } as unknown as ServiceWorkerRegistration;
}

function start() {
  // Stands in for the registration shim, which reloads the document itself
  // unless the caller supplies onNeedReload.
  const reload = vi.fn();
  let options: RegisterSWOptions = {};
  const register = vi.fn((opts: RegisterSWOptions = {}) => {
    options = opts;
    return () => Promise.resolve();
  });
  const instance = new AppUpdate();
  instance.init({ register });
  instances.push(instance);
  return {
    reload,
    fireActivated: () => (options.onNeedReload ? options.onNeedReload() : reload()),
    options: () => options,
    registered: (registration: ServiceWorkerRegistration) =>
      options.onRegisteredSW?.('/sw.js', registration),
  };
}

const instances: AppUpdate[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.dispose();
  }
  Reflect.deleteProperty(document, 'visibilityState');
  vi.useRealTimers();
});

describe('never reloading the document', () => {
  it('supplies onNeedReload so the shim cannot reload the page', () => {
    const sw = start();
    sw.fireActivated();
    expect(sw.reload).not.toHaveBeenCalled();
  });

  it('registers the worker immediately', () => {
    const sw = start();
    expect(typeof sw.options().onNeedReload).toBe('function');
    expect(sw.options().immediate).toBe(true);
  });

  it('leaves the new worker to activate itself', () => {
    const sw = start();
    expect(sw.options().onNeedRefresh).toBeUndefined();
  });
});

describe('update checks', () => {
  it('checks for a new worker when the page becomes visible', () => {
    const sw = start();
    const update = vi.fn(() => Promise.resolve());
    sw.registered(registrationWith(update));
    goVisible();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not check when the page hides', () => {
    const sw = start();
    const update = vi.fn(() => Promise.resolve());
    sw.registered(registrationWith(update));
    goHidden();
    expect(update).not.toHaveBeenCalled();
  });

  it('throttles repeated checks', () => {
    vi.useFakeTimers();
    const sw = start();
    const update = vi.fn(() => Promise.resolve());
    sw.registered(registrationWith(update));
    goVisible();
    goHidden();
    goVisible();
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 1000);
    goHidden();
    goVisible();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('tolerates visibility changes before registration completes', () => {
    start();
    expect(() => goVisible()).not.toThrow();
  });

  it('swallows a failed check', async () => {
    const sw = start();
    const update = vi.fn(() => Promise.reject(new Error('offline')));
    sw.registered(registrationWith(update));
    goVisible();
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
