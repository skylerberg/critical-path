<script lang="ts">
  interface Props {
    size?: 'sm' | 'md' | 'lg';
    label?: string;
  }

  let { size = 'md', label = 'Loading' }: Props = $props();

  const sizes = { sm: 'size-4', md: 'size-6', lg: 'size-10' };
</script>

<span role="status" aria-label={label} class="inline-flex">
  <svg class="animate-spin text-accent {sizes[size]}" viewBox="0 0 24 24" fill="none">
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
    ></circle>
    <path class="opacity-90" fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2z"
    ></path>
  </svg>
</span>
