<script lang="ts">
  interface Props {
    color: string;
    size?: 'sm' | 'md';
  }

  let { color, size = 'md' }: Props = $props();

  const sizes = { sm: 'size-2', md: 'size-3' };
</script>

<span
  aria-hidden="true"
  class="inline-block shrink-0 rounded-full {sizes[size]}"
  style="background-color: {color}"
></span>
