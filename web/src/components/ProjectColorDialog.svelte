<script lang="ts">
  import { ACCENTS, ACCENT_KEYS, type ProjectAccent } from '../lib/accents';
  import { projects } from '../lib/projects.svelte';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    projectId: string;
    current: ProjectAccent | null;
    onclose: () => void;
  }

  let { projectId, current, onclose }: Props = $props();

  function choose(color: ProjectAccent | null): void {
    if (color !== current) {
      void projects.setColor(projectId, color);
    }
    onclose();
  }

  const swatchClass =
    'size-11 cursor-pointer rounded-md ring-offset-2 ring-offset-surface focus-ring-flush';
</script>

<Modal open title="Board color" {onclose}>
  <p class="text-sm text-muted">
    Marks this board wherever it is listed, for everyone who can see it.
  </p>
  <div class="mt-4 flex flex-wrap gap-2" role="group" aria-label="Board color">
    {#each ACCENT_KEYS as key (key)}
      <button
        type="button"
        aria-label={ACCENTS[key].label}
        aria-pressed={current === key}
        onclick={() => choose(key)}
        style="background-color: var({ACCENTS[key].cssVar})"
        class="{swatchClass} {current === key ? 'ring-2 ring-accent' : ''}"
      ></button>
    {/each}
    <button
      type="button"
      aria-label="None"
      aria-pressed={current === null}
      onclick={() => choose(null)}
      class="{swatchClass} flex items-center justify-center border border-edge text-xs text-muted {current ===
      null
        ? 'ring-2 ring-accent'
        : ''}"
    >
      None
    </button>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={onclose}>Done</Button>
  {/snippet}
</Modal>
