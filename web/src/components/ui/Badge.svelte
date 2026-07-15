<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'neutral' | 'accent' | 'success' | 'danger';
    children?: Snippet;
  }

  let { variant = 'neutral', children }: Props = $props();

  const variants = {
    neutral: 'border border-edge bg-surface text-muted',
    accent: 'bg-accent-soft text-accent-strong',
    success: 'bg-success/15 text-success',
    danger: 'bg-danger/15 text-danger',
  };
</script>

<span
  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium {variants[
    variant
  ]}"
>
  {@render children?.()}
</span>
