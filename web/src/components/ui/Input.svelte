<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { focusIf } from '../../lib/actions';

  interface Props extends HTMLInputAttributes {
    label?: string;
    error?: string;
    value?: string;
    element?: HTMLInputElement | null;
  }

  let {
    label,
    error,
    value = $bindable(''),
    element = $bindable(null),
    class: className = '',
    id,
    autofocus = false,
    ...rest
  }: Props = $props();

  const uid = $props.id();
  const inputId = $derived(id ?? `input-${uid}`);
  const errorId = `input-${uid}-error`;
</script>

<div class="flex flex-col gap-1">
  {#if label}
    <label for={inputId} class="text-sm font-medium">{label}</label>
  {/if}
  <input
    id={inputId}
    bind:this={element}
    bind:value
    use:focusIf={{ active: autofocus === true }}
    aria-invalid={error ? true : undefined}
    aria-describedby={error ? errorId : undefined}
    class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-3 text-sm focus:border-accent aria-invalid:border-danger {className}"
    {...rest}
  />
  {#if error}
    <!-- Tied to the field by aria-describedby, so the message is read with it
         rather than only being visible next to it. -->
    <p id={errorId} class="text-sm text-danger">{error}</p>
  {/if}
</div>
