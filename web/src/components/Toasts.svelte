<script lang="ts">
  import { toasts } from '../lib/toasts.svelte';

  const icons = { error: '✕', success: '✓' };
</script>

<div
  aria-live="polite"
  class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
>
  {#each toasts.toasts as toast (toast.id)}
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      class="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border border-edge bg-surface px-4 py-3 text-sm shadow-lg"
    >
      <span
        aria-hidden="true"
        class="font-bold {toast.variant === 'error' ? 'text-danger' : 'text-success'}"
      >
        {icons[toast.variant]}
      </span>
      <span class="flex-1">{toast.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        class="-m-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center text-muted hover:text-ink"
        onclick={() => toasts.dismiss(toast.id)}
      >
        ✕
      </button>
    </div>
  {/each}
</div>
