<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    title?: string;
    onclose?: () => void;
    children?: Snippet;
    footer?: Snippet;
  }

  let { open = false, title, onclose, children, footer }: Props = $props();

  let dialog = $state<HTMLDialogElement>();

  // Native <dialog> showModal gives focus trapping, Escape (via cancel), and focus restore.
  // jsdom implements neither showModal nor close, so fall back to the open attribute there.
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.open = true;
      }
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.open = false;
      }
    }
  });
</script>

<dialog
  bind:this={dialog}
  aria-label={title}
  class="m-auto w-full max-w-lg bg-transparent p-4 backdrop:bg-black/50"
  oncancel={(event) => {
    event.preventDefault();
    onclose?.();
  }}
  onclick={(event) => {
    if (event.target === dialog) onclose?.();
  }}
>
  <div class="rounded-lg border border-edge bg-surface p-6 text-ink shadow-xl">
    {#if title}
      <h2 class="mb-4 text-lg font-semibold">{title}</h2>
    {/if}
    {@render children?.()}
    {#if footer}
      <div class="mt-6 flex justify-end gap-2">
        {@render footer()}
      </div>
    {/if}
  </div>
</dialog>
