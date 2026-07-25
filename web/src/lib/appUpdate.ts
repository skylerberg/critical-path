import { registerSW } from 'virtual:pwa-register';

const CHECK_THROTTLE_MS = 60 * 1000;

export interface AppUpdateDeps {
  register?: typeof registerSW;
}

/**
 * Passing `onNeedReload` suppresses the registration shim's own
 * `window.location.reload()`, so nothing ever reloads the document. A waiting
 * worker is activated only while the tab is hidden — the running page keeps the
 * build it booted with, and the new build appears on the next document load.
 */
export class AppUpdate {
  #applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
  #registration: ServiceWorkerRegistration | undefined;
  #waiting = false;
  #lastCheck = 0;

  init({ register = registerSW }: AppUpdateDeps = {}): void {
    this.#applyUpdate = register({
      immediate: true,
      onNeedRefresh: () => {
        this.#waiting = true;
        this.#applyWhenHidden();
      },
      onNeedReload: () => {
        this.#waiting = false;
      },
      onRegisteredSW: (_swScriptUrl, registration) => {
        this.#registration = registration;
      },
    });
    document.addEventListener('visibilitychange', this.#onVisibilityChange);
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.#onVisibilityChange);
  }

  #onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.#applyWhenHidden();
    else this.#checkForUpdate();
  };

  #applyWhenHidden(): void {
    if (document.visibilityState !== 'hidden') return;
    // The registration is the source of truth: workbox stops reporting
    // updatefound after the first minute, so later deploys park in `waiting`
    // without ever raising onNeedRefresh.
    if (!this.#waiting && !this.#registration?.waiting) return;
    this.#waiting = false;
    void this.#applyUpdate?.();
  }

  #checkForUpdate(): void {
    const registration = this.#registration;
    if (!registration) return;
    const now = Date.now();
    if (now - this.#lastCheck < CHECK_THROTTLE_MS) return;
    this.#lastCheck = now;
    void registration.update().catch(() => undefined);
  }
}

export const appUpdate = new AppUpdate();
