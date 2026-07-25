import { registerSW } from 'virtual:pwa-register';

const CHECK_THROTTLE_MS = 60 * 1000;

export interface AppUpdateDeps {
  register?: typeof registerSW;
}

/**
 * The empty `onNeedReload` is load-bearing: supplying it is what stops the
 * registration shim from reloading the page itself, which would discard
 * whatever the user had typed but not submitted.
 */
export class AppUpdate {
  #registration: ServiceWorkerRegistration | undefined;
  #lastCheck = 0;

  init({ register = registerSW }: AppUpdateDeps = {}): void {
    register({
      immediate: true,
      onNeedReload: () => {},
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
    if (document.visibilityState === 'visible') this.#checkForUpdate();
  };

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
