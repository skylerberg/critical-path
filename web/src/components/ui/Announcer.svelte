<script lang="ts">
  interface Props {
    message: string;
  }

  let { message }: Props = $props();
</script>

<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">{message}</div>
