import { newId } from './ids';

export type ToastVariant = 'error' | 'success' | 'info';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

const DEFAULT_DURATION_MS = 5000;

class ToastStore {
  toasts = $state<Toast[]>([]);
  #timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Show a toast. A `durationMs` of 0 (or less) keeps it on screen until it is
   * dismissed, used by action toasts that ask the user to make a choice.
   */
  show(message: string, variant: ToastVariant, durationMs = DEFAULT_DURATION_MS): string {
    const id = newId();
    this.toasts = [...this.toasts, { id, message, variant }];
    if (durationMs > 0) {
      this.#timers.set(
        id,
        setTimeout(() => this.dismiss(id), durationMs)
      );
    }
    return id;
  }

  success(message: string, durationMs?: number): string {
    return this.show(message, 'success', durationMs);
  }

  error(message: string, durationMs?: number): string {
    return this.show(message, 'error', durationMs);
  }

  info(message: string, durationMs?: number): string {
    return this.show(message, 'info', durationMs);
  }

  /**
   * A toast with an action button. Action toasts are persistent: they represent
   * something the user should decide on (e.g. reload to install an update), so
   * timing them out would silently hide the choice.
   */
  action(message: string, action: ToastAction, variant: ToastVariant = 'info'): string {
    const id = newId();
    this.toasts = [...this.toasts, { id, message, variant, action }];
    return id;
  }

  dismiss(id: string): void {
    const timer = this.#timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  /** Run an action toast's action and dismiss it. No-op for toasts without one. */
  runAction(id: string): void {
    const toast = this.toasts.find((t) => t.id === id);
    if (!toast?.action) return;
    this.dismiss(id);
    toast.action.run();
  }
}

export const toasts = new ToastStore();
