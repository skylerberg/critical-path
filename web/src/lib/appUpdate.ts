import { registerSW } from 'virtual:pwa-register';
import { APP_NAME } from './constants';
import { toasts } from './toasts.svelte';

const CHECK_THROTTLE_MS = 60 * 1000;

export interface AppUpdateDeps {
  register?: typeof registerSW;
  /**
   * Called when a new service worker has taken over. The default shows a
   * persistent toast the user can act on; overriding it keeps AppUpdate
   * decoupled from the toast store in tests.
   */
  notifyUpdate?: () => void;
}

/**
 * When the service worker picks up a new build it activates immediately
 * (`skipWaiting`/`clientsClaim`), but the already-loaded document keeps running
 * the old shell — only a reload swaps it in. Rather than reload automatically
 * (which would discard unsaved input) we surface a persistent toast so the user
 * reloads on their own terms. That turns a two-refresh update into one.
 */
export class AppUpdate {
  #registration: ServiceWorkerRegistration | undefined;
  #lastCheck = 0;

  init({ register = registerSW, notifyUpdate = notifyOfUpdate }: AppUpdateDeps = {}): void {
    register({
      immediate: true,
      onNeedReload: () => notifyUpdate(),
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

function notifyOfUpdate(): void {
  toasts.action(`A new version of ${APP_NAME} is available.`, {
    label: 'Reload',
    run: () => window.location.reload(),
  });
}

export const appUpdate = new AppUpdate();
