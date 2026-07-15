import { newId } from './ids';

export type ToastVariant = 'error' | 'success';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

const DEFAULT_DURATION_MS = 5000;

class ToastStore {
  toasts = $state<Toast[]>([]);
  #timers = new Map<string, ReturnType<typeof setTimeout>>();

  show(message: string, variant: ToastVariant, durationMs = DEFAULT_DURATION_MS): string {
    const id = newId();
    this.toasts = [...this.toasts, { id, message, variant }];
    this.#timers.set(
      id,
      setTimeout(() => this.dismiss(id), durationMs)
    );
    return id;
  }

  success(message: string, durationMs?: number): string {
    return this.show(message, 'success', durationMs);
  }

  error(message: string, durationMs?: number): string {
    return this.show(message, 'error', durationMs);
  }

  dismiss(id: string): void {
    const timer = this.#timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const toasts = new ToastStore();
