<script lang="ts">
  interface Props {
    /** Tailwind sizing for the bar; the caller owns the shape. */
    class?: string;
  }

  let { class: className = 'h-4 w-32' }: Props = $props();
</script>

<!-- aria-hidden because a placeholder bar means nothing read aloud: the list's
     aria-busy and a single announcement on completion carry the state instead.
     The global prefers-reduced-motion rule already stills the pulse. -->
<span aria-hidden="true" class="block animate-pulse rounded bg-edge {className}"></span>
