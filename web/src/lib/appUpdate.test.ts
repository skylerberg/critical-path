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
  const applyUpdate = vi.fn(() => Promise.resolve());
  // Stands in for the registration shim, which reloads the document itself
  // unless the caller supplies onNeedReload.
  const reload = vi.fn();
  let options: RegisterSWOptions = {};
  const register = vi.fn((opts: RegisterSWOptions = {}) => {
    options = opts;
    return applyUpdate;
  });
  const instance = new AppUpdate();
  instance.init({ register });
  instances.push(instance);
  return {
    applyUpdate,
    reload,
    fireControlling: () => (options.onNeedReload ? options.onNeedReload() : reload()),
    options: () => options,
    needRefresh: () => options.onNeedRefresh?.(),
    needReload: () => options.onNeedReload?.(),
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

describe('applying a waiting update', () => {
  it('does not apply while the page is visible', () => {
    const sw = start();
    sw.needRefresh();
    goVisible();
    expect(sw.applyUpdate).not.toHaveBeenCalled();
  });

  it('applies once the page becomes hidden', () => {
    const sw = start();
    sw.needRefresh();
    goHidden();
    expect(sw.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('applies immediately when the update arrives while already hidden', () => {
    const sw = start();
    setVisibility('hidden');
    sw.needRefresh();
    expect(sw.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the page hides with no waiting update', () => {
    const sw = start();
    goHidden();
    expect(sw.applyUpdate).not.toHaveBeenCalled();
  });

  it('applies a waiting update at most once', () => {
    const sw = start();
    sw.needRefresh();
    goHidden();
    goVisible();
    goHidden();
    expect(sw.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('stops tracking an update another tab already activated', () => {
    const sw = start();
    sw.needRefresh();
    sw.needReload();
    goHidden();
    expect(sw.applyUpdate).not.toHaveBeenCalled();
  });

  it('registers the onNeedReload handler that suppresses the built-in reload', () => {
    const sw = start();
    expect(typeof sw.options().onNeedReload).toBe('function');
    expect(sw.options().immediate).toBe(true);
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

describe('never reloading the document', () => {
  it('supplies onNeedReload so the shim cannot reload the page', () => {
    const sw = start();
    sw.fireControlling();
    expect(sw.reload).not.toHaveBeenCalled();
  });
});

describe('later deploys in the same session', () => {
  it('applies a worker parked in waiting even without another onNeedRefresh', () => {
    const sw = start();
    sw.registered({
      update: () => Promise.resolve(),
      waiting: {} as ServiceWorker,
    } as unknown as ServiceWorkerRegistration);

    goHidden();

    expect(sw.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('stays put when nothing is waiting', () => {
    const sw = start();
    sw.registered(registrationWith(() => Promise.resolve()));
    goHidden();
    expect(sw.applyUpdate).not.toHaveBeenCalled();
  });
});
