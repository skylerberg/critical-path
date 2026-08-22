<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from './ui/Button.svelte';

  interface Props {
    summary: string;
    copyLabel: string;
    copyText: () => string;
    open: boolean;
    ontoggle: () => void;
    children: Snippet;
  }

  let { summary, copyLabel, copyText, open, ontoggle, children }: Props = $props();

  let status = $state<'idle' | 'copied' | 'failed'>('idle');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(copyText());
      status = 'copied';
    } catch {
      status = 'failed';
    }
  }
</script>

<!-- Open state comes from the caller instead of the element's own: a <details>
     keeps its children mounted while shut, and each of these bodies is an editor. -->
<details class="text-sm" {open}>
  <summary
    class="min-h-11 cursor-pointer content-center text-muted"
    onclick={(event) => {
      event.preventDefault();
      status = 'idle';
      ontoggle();
    }}
  >
    {summary}
  </summary>
  {#if open}
    <div class="flex flex-col items-start gap-2">
      <div
        class="max-h-64 w-full overflow-y-auto overscroll-contain rounded-md border border-edge bg-canvas p-2"
      >
        {@render children()}
      </div>
      <div class="flex items-center gap-2">
        <Button variant="secondary" onclick={copy}>{copyLabel}</Button>
        <!-- Not a toast: this lives inside a modal dialog, whose top layer covers
             the shell that renders them. -->
        <span role="status" class="text-xs text-muted">
          {#if status === 'copied'}
            Copied
          {:else if status === 'failed'}
            Could not copy to the clipboard
          {/if}
        </span>
      </div>
    </div>
  {/if}
</details>
