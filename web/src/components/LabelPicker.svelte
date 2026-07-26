<script lang="ts">
  import { board } from '../lib/board.svelte';
  import type { BoardLabel } from '../lib/board-types';
  import LabelSearchMenu from './LabelSearchMenu.svelte';
  import ColorDot from './ui/ColorDot.svelte';

  interface Props {
    taskId: string;
    readonly?: boolean;
  }

  let { taskId, readonly = false }: Props = $props();

  const pickerId = $props.id();

  let expanded = $state(false);
  let toggleEl = $state<HTMLButtonElement>();

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const labelById = $derived(new Map(board.labels.map((label) => [label.id, label])));
  const applied = $derived((task?.label_ids ?? []).flatMap((id) => labelById.get(id) ?? []));

  // The parent reuses this instance across tasks, so collapse on every switch.
  $effect(() => {
    void taskId;
    expanded = false;
  });

  function remove(labelId: string, event: MouseEvent): void {
    // The clicked chip unmounts, so hand focus to its neighbour (or the toggle)
    // rather than letting it fall back to the dialog body.
    const chip = event.currentTarget as HTMLElement;
    const next = chip.nextElementSibling ?? chip.previousElementSibling;
    if (next instanceof HTMLElement) {
      next.focus();
    } else {
      toggleEl?.focus();
    }
    void board.setTaskLabels(
      taskId,
      (task?.label_ids ?? []).filter((id) => id !== labelId)
    );
  }
</script>

{#snippet chip(label: BoardLabel, removable: boolean)}
  <span
    class="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-muted {removable
      ? 'group-hover:border-danger group-hover:text-danger'
      : ''}"
  >
    <ColorDot color={label.color} size="sm" />
    <span class="max-w-40 truncate">{label.name}</span>
    {#if removable}
      <span aria-hidden="true">✕</span>
    {/if}
  </span>
{/snippet}

<div class="flex flex-col gap-2">
  <div class="flex flex-wrap items-center gap-1">
    {#each applied as label (label.id)}
      {#if readonly}
        <span class="inline-flex min-h-11 items-center justify-center">
          {@render chip(label, false)}
        </span>
      {:else}
        <button
          type="button"
          aria-label="Remove label {label.name}"
          onclick={(event) => remove(label.id, event)}
          class="group inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center"
        >
          {@render chip(label, true)}
        </button>
      {/if}
    {/each}
    {#if !readonly}
      <button
        type="button"
        bind:this={toggleEl}
        aria-expanded={expanded}
        aria-controls={expanded ? pickerId : undefined}
        onclick={() => (expanded = !expanded)}
        class="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center text-xs font-medium text-muted hover:text-ink"
      >
        <span class="rounded-full border border-dashed border-edge px-2.5 py-1">
          {expanded ? 'Done' : '+ Add label'}
        </span>
      </button>
    {/if}
  </div>
  {#if expanded && !readonly}
    <div id={pickerId}>
      <LabelSearchMenu
        {taskId}
        autofocus
        onclose={() => {
          expanded = false;
          toggleEl?.focus();
        }}
      />
    </div>
  {/if}
</div>
