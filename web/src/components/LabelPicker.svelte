<script lang="ts">
  import { board } from '../lib/board.svelte';
  import ColorDot from './ui/ColorDot.svelte';

  interface Props {
    taskId: string;
  }

  let { taskId }: Props = $props();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const selected = $derived(new Set(task?.label_ids ?? []));

  function toggle(labelId: string): void {
    const current = task?.label_ids ?? [];
    const next = current.includes(labelId)
      ? current.filter((id) => id !== labelId)
      : [...current, labelId];
    void board.setTaskLabels(taskId, next);
  }
</script>

{#if board.labels.length === 0}
  <p class="text-sm text-muted">No labels in this project yet.</p>
{:else}
  <div class="flex flex-wrap gap-2" role="group" aria-label="Labels">
    {#each board.labels as label (label.id)}
      <button
        type="button"
        aria-pressed={selected.has(label.id)}
        onclick={() => toggle(label.id)}
        class="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors {selected.has(
          label.id
        )
          ? 'border-accent bg-accent-soft text-accent-strong'
          : 'border-edge text-muted hover:border-accent hover:text-ink'}"
      >
        <ColorDot color={label.color} size="sm" />
        {label.name}
      </button>
    {/each}
  </div>
{/if}
