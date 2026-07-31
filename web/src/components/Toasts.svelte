<script lang="ts">
  import { toasts } from '../lib/toasts.svelte';

  const icons = { error: '✕', success: '✓', info: 'ⓘ' };
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
        class="font-bold {toast.variant === 'error'
          ? 'text-danger'
          : toast.variant === 'success'
            ? 'text-success'
            : 'text-accent'}"
      >
        {icons[toast.variant]}
      </span>
      <span class="min-w-0 flex-1 break-words">{toast.message}</span>
      {#if toast.action}
        <button
          type="button"
          class="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong"
          onclick={() => toasts.runAction(toast.id)}
        >
          {toast.action.label}
        </button>
      {/if}
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
