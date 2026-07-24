<script lang="ts">
  import Modal from './ui/Modal.svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  interface Binding {
    keys: string[];
    label: string;
    chord?: boolean;
  }

  const groups: { heading: string; bindings: Binding[] }[] = [
    {
      heading: 'Selection',
      bindings: [
        { keys: ['j', '↓'], label: 'Select task below' },
        { keys: ['k', '↑'], label: 'Select task above' },
        { keys: ['←'], label: 'Select task in previous column' },
        { keys: ['→'], label: 'Select task in next column' },
        { keys: ['f'], label: 'Filter tasks' },
        { keys: ['Esc'], label: 'Close menu, else clear selection' },
      ],
    },
    {
      heading: 'Task',
      bindings: [
        { keys: ['Enter', 'o'], label: 'Open selected task' },
        { keys: ['e'], label: 'Open selected task detail' },
        { keys: ['n'], label: 'New task in selected column' },
        { keys: ['l'], label: 'Label the selected task' },
        { keys: ['a'], label: 'Assign the selected task' },
        { keys: ['d'], label: 'Move selected task to done' },
      ],
    },
    {
      heading: 'Navigation',
      bindings: [
        { keys: ['g', 'b'], label: 'Go to board', chord: true },
        { keys: ['g', 'g'], label: 'Go to graph', chord: true },
        { keys: ['g', 'p'], label: 'Go to projects', chord: true },
        { keys: ['?'], label: 'Show this help' },
      ],
    },
  ];
</script>

<Modal open title="Keyboard shortcuts" {onclose}>
  <div class="flex flex-col gap-4">
    {#each groups as group (group.heading)}
      <section class="flex flex-col gap-1.5">
        <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">{group.heading}</h3>
        <ul class="flex flex-col gap-1">
          {#each group.bindings as binding (binding.label)}
            <li class="flex items-center justify-between gap-4">
              <span class="text-sm text-ink">{binding.label}</span>
              <span class="flex shrink-0 items-center gap-1">
                {#each binding.keys as key, i (i)}
                  {#if i > 0}
                    <span class="text-xs text-muted">{binding.chord ? 'then' : 'or'}</span>
                  {/if}
                  <kbd
                    class="inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-edge bg-canvas px-1.5 text-xs font-medium text-ink"
                  >
                    {key}
                  </kbd>
                {/each}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</Modal>
