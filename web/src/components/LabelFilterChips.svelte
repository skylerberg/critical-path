<script lang="ts">
  import { board } from '../lib/board.svelte';
  import ColorDot from './ui/ColorDot.svelte';

  const labelCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const task of board.tasks) {
      for (const id of task.label_ids) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  });
</script>

{#each board.labels as label (label.id)}
  {@const selected = board.filterLabelIds.includes(label.id)}
  <button
    type="button"
    aria-pressed={selected}
    onclick={() => board.toggleLabelFilter(label.id)}
    class="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium {selected
      ? 'text-accent'
      : 'text-muted hover:text-ink'}"
  >
    <span
      class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 {selected
        ? 'border-accent bg-accent-soft'
        : 'border-edge bg-surface'}"
    >
      <ColorDot color={label.color} size="sm" />
      {label.name}
      <span class="opacity-70">{labelCounts[label.id] ?? 0}</span>
    </span>
  </button>
{/each}
