<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    label?: string;
    error?: string;
    value?: string;
  }

  let { label, error, value = $bindable(''), class: className = '', id, ...rest }: Props = $props();

  const uid = $props.id();
  const inputId = $derived(id ?? `input-${uid}`);
</script>

<div class="flex flex-col gap-1">
  {#if label}
    <label for={inputId} class="text-sm font-medium">{label}</label>
  {/if}
  <input
    id={inputId}
    bind:value
    aria-invalid={error ? true : undefined}
    class="min-h-11 rounded-md border border-edge bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 aria-invalid:border-danger {className}"
    {...rest}
  />
  {#if error}
    <p class="text-sm text-danger">{error}</p>
  {/if}
</div>
