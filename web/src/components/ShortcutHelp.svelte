<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { CARD_ACTION_KEYS } from '../lib/card-actions';
  import { paletteChordHint } from '../lib/palette';
  import { router } from '../lib/router.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  interface Binding {
    keys: string[];
    label: string;
    chord?: boolean;
    edits?: boolean;
  }

  // The board store outlives the route, so the keymap is only trimmed while a
  // board the user cannot edit is the one on screen — either their own as a
  // viewer, or the public one as an anonymous reader.
  const readonly = $derived(
    (router.current.name === 'project' || router.current.name === 'public-board') && !board.canEdit
  );

  const allGroups: {
    heading: string;
    readonlyHeading?: string;
    bindings: Binding[];
    edits?: boolean;
  }[] = [
    {
      heading: 'Selection',
      bindings: [
        { keys: ['j', '↓'], label: 'Select task below' },
        { keys: ['k', '↑'], label: 'Select task above' },
        { keys: ['←'], label: 'Select task in previous column' },
        { keys: ['→'], label: 'Select task in next column' },
        { keys: ['Esc'], label: 'Close menu, else clear selection' },
      ],
    },
    {
      heading: 'Task',
      bindings: [
        { keys: CARD_ACTION_KEYS.open, label: 'Open selected task' },
        { keys: CARD_ACTION_KEYS.openDetail, label: 'Open selected task detail' },
        { keys: ['Shift+F10'], label: 'Open the menu for the focused card' },
        { keys: ['n'], label: 'New task in selected column', edits: true },
        { keys: CARD_ACTION_KEYS.labels, label: 'Label the selected task', edits: true },
        { keys: CARD_ACTION_KEYS.assignees, label: 'Assign the selected task', edits: true },
        {
          keys: CARD_ACTION_KEYS.blockers,
          label: 'Add a task that blocks the selection',
          edits: true,
        },
        {
          keys: CARD_ACTION_KEYS.blocking,
          label: 'Add a task the selection blocks',
          edits: true,
        },
        { keys: CARD_ACTION_KEYS.done, label: 'Move selected task to done', edits: true },
        { keys: CARD_ACTION_KEYS.duplicate, label: 'Duplicate the selected task', edits: true },
        {
          keys: CARD_ACTION_KEYS.move,
          label: 'Move the selected task to a column and position',
          edits: true,
        },
      ],
    },
    {
      heading: 'Reorder (Tab to a card, column handle, or sidebar project)',
      // Sidebar order is per-user, so it survives read-only access and the group
      // cannot be dropped wholesale the way the board-editing ones are.
      readonlyHeading: 'Reorder (Tab to a sidebar project)',
      bindings: [
        { keys: ['Enter', 'Space'], label: 'Pick up or drop the focused item' },
        { keys: ['↑', '↓', '←', '→'], label: 'Move the picked-up item' },
        { keys: ['Tab'], label: 'Carry a picked-up task to another column', edits: true },
        { keys: ['Esc'], label: 'Drop the picked-up item' },
      ],
    },
    {
      heading: 'Filters',
      bindings: [
        { keys: ['f'], label: 'Filter tasks' },
        { keys: ['q'], label: 'Toggle my tasks in the filter' },
        { keys: ['x'], label: 'Clear all filters' },
      ],
    },
    {
      heading: 'Navigation',
      bindings: [
        { keys: ['g', 'b'], label: 'Go to board', chord: true },
        { keys: ['g', 'g'], label: 'Go to graph', chord: true },
        { keys: ['g', 'p'], label: 'Go to projects', chord: true },
        { keys: ['g', 'm'], label: 'Go to my tasks', chord: true },
        { keys: [paletteChordHint()], label: 'Open the command palette' },
        { keys: ['/'], label: 'Search all projects' },
        { keys: ['?'], label: 'Show this help' },
      ],
    },
  ];

  const groups = $derived(
    allGroups.flatMap((group) => {
      if (!readonly) {
        return [group];
      }
      if (group.edits === true) {
        return [];
      }
      return [
        {
          ...group,
          heading: group.readonlyHeading ?? group.heading,
          bindings: group.bindings.filter((binding) => binding.edits !== true),
        },
      ];
    })
  );
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
