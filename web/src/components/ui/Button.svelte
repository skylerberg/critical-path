<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    children?: Snippet;
  }

  let { variant = 'primary', children, class: className = '', ...rest }: Props = $props();

  const variants = {
    primary: 'bg-accent text-on-accent hover:bg-accent-strong',
    secondary: 'border border-edge bg-surface hover:bg-accent-soft',
    ghost: 'hover:bg-accent-soft',
    danger: 'bg-danger text-white hover:opacity-90',
  };
</script>

<button
  type="button"
  class="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 {variants[
    variant
  ]} {className}"
  {...rest}
>
  {@render children?.()}
</button>
