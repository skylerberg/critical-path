<script lang="ts">
  import { api, ApiError, assertOk } from '../api/client';
  import { newId } from '../lib/ids';
  import { router } from '../lib/router.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    open?: boolean;
    onclose: () => void;
  }

  let { open = false, onclose }: Props = $props();

  const MAX_LENGTH = 10000;

  let message = $state('');
  let sending = $state(false);

  async function send(): Promise<void> {
    const trimmed = message.trim();
    if (trimmed === '' || sending) return;
    sending = true;
    try {
      assertOk(
        await api.POST('/api/feedback', {
          body: { id: newId(), message: trimmed, page_path: router.path.slice(0, 500) },
        })
      );
      toasts.success('Feedback sent — thank you!');
      message = '';
      onclose();
    } catch (error) {
      toasts.error(
        error instanceof ApiError
          ? error.message
          : 'Could not reach the server. Check your connection and try again.'
      );
    } finally {
      sending = false;
    }
  }
</script>

<Modal {open} title="Send feedback" {onclose}>
  <p class="mb-3 text-sm text-muted">
    Spotted a bug, or is something confusing or missing? Your message goes straight to the
    developer.
  </p>
  <textarea
    bind:value={message}
    aria-label="Feedback message"
    rows="5"
    maxlength={MAX_LENGTH}
    class="min-h-32 w-full resize-y rounded-md border border-edge bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
  ></textarea>
  {#if message.length >= MAX_LENGTH - 1000}
    <p class="mt-1 text-right text-xs text-muted">{message.length} / {MAX_LENGTH}</p>
  {/if}
  {#snippet footer()}
    <Button variant="secondary" onclick={onclose}>Cancel</Button>
    <Button onclick={send} disabled={message.trim() === '' || sending}>
      {sending ? 'Sending…' : 'Send'}
    </Button>
  {/snippet}
</Modal>
