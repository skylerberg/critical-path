<script lang="ts">
  interface Props {
    name: string;
    size?: 'sm' | 'md';
  }

  let { name, size = 'md' }: Props = $props();

  const COLORS = [
    '#e11d48',
    '#d97706',
    '#059669',
    '#0284c7',
    '#7c3aed',
    '#db2777',
    '#4f46e5',
    '#0d9488',
  ];

  const initials = $derived(
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );

  const color = $derived.by(() => {
    let hash = 0;
    for (const char of name) {
      hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
    }
    return COLORS[hash % COLORS.length];
  });

  const sizes = { sm: 'size-6 text-[10px]', md: 'size-8 text-xs' };
</script>

<span
  class="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none {sizes[
    size
  ]}"
  style="background-color: {color}"
  title={name}
>
  {initials}
</span>
