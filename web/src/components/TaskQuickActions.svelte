<script lang="ts">
  import type { Snippet } from 'svelte';
  import { board } from '../lib/board.svelte';
  import { append } from '../lib/ranks';
  import AssigneeSearchMenu from './AssigneeSearchMenu.svelte';
  import DependencyPicker from './DependencyPicker.svelte';
  import DatesPanel from './DatesPanel.svelte';
  import LabelSearchMenu from './LabelSearchMenu.svelte';
  import Button from './ui/Button.svelte';
  import Popover from './ui/Popover.svelte';

  export type QuickAction =
    | 'checklist'
    | 'dates'
    | 'assign'
    | 'labels'
    | 'column'
    | 'attach'
    | 'depends';

  interface Props {
    taskId: string;
    // Checklist and the attachment list are sections the parent owns; the bar only
    // says when to show them and where focus should land.
    onreveal: (section: 'checklist' | 'attachments') => void;
    onattach: (how: 'file' | 'link') => void;
  }

  let { taskId, onreveal, onattach }: Props = $props();

  const panelId = $props.id();

  let open = $state<QuickAction | null>(null);
  let buttons: Partial<Record<QuickAction, HTMLButtonElement | null>> = $state({});

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const columnName = $derived(
    board.columns.find((c) => c.id === task?.column_id)?.name ?? 'Column'
  );

  // Switching card under an open panel would leave it editing the card the user
  // just left.
  $effect(() => {
    void taskId;
    open = null;
  });

  export function focusButton(action: QuickAction): void {
    buttons[action]?.focus();
  }

  export function isOpen(): boolean {
    return open !== null;
  }

  export function close(opts?: { restoreFocus?: boolean }): void {
    const was = open;
    open = null;
    if (opts?.restoreFocus === true && was !== null) {
      focusButton(was);
    }
  }

  function toggle(action: QuickAction): void {
    open = open === action ? null : action;
  }

  function moveTo(columnId: string): void {
    if (task !== undefined && columnId !== task.column_id) {
      void board.moveTask(taskId, columnId, append(board.tasksInColumn(columnId)), {
        kind: 'append',
      });
    }
    close({ restoreFocus: true });
  }

  function reveal(section: 'checklist' | 'attachments'): void {
    open = null;
    onreveal(section);
  }

  function attach(how: 'file' | 'link'): void {
    open = null;
    onattach(how);
  }
</script>

{#snippet checklistIcon()}
  <svg
    class="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="m3 17 2 2 4-4" />
    <path d="m3 7 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </svg>
{/snippet}

{#snippet datesIcon()}
  <svg
    class="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4" />
    <path d="M8 2v4" />
    <path d="M3 10h18" />
  </svg>
{/snippet}

{#snippet assignIcon()}
  <svg
    class="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M19 8v6" />
    <path d="M22 11h-6" />
  </svg>
{/snippet}

{#snippet labelsIcon()}
  <svg
    class="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.8 8.8a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8z"
    />
    <circle cx="7.5" cy="7.5" r="1.5" />
  </svg>
{/snippet}

{#snippet columnIcon()}
  <svg
    class="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </svg>
{/snippet}

{#snippet attachIcon()}
  <svg
    class="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      d="M21.4 11.1 12.3 20.2a5 5 0 0 1-7.1-7.1l9.2-9.2a3.3 3.3 0 0 1 4.7 4.7l-9.2 9.2a1.7 1.7 0 0 1-2.4-2.4l8.5-8.5"
    />
  </svg>
{/snippet}

{#snippet dependsIcon()}
  <svg
    class="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
    <path d="M8 12h8" />
  </svg>
{/snippet}

{#snippet action(id: QuickAction, label: string, icon: Snippet, activate: () => void)}
  <button
    type="button"
    bind:this={buttons[id]}
    aria-expanded={open === id}
    aria-controls={open === id ? panelId : undefined}
    onclick={activate}
    class="inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-ring-flush {open ===
    id
      ? 'bg-accent-soft text-accent-strong'
      : 'text-muted hover:bg-accent-soft hover:text-ink'}"
  >
    {@render icon()}
    <span class="max-w-32 truncate">{label}</span>
  </button>
{/snippet}

<div class="relative flex flex-wrap gap-1">
  {@render action('checklist', 'Checklist', checklistIcon, () => reveal('checklist'))}
  {@render action('dates', 'Dates', datesIcon, () => toggle('dates'))}
  {@render action('assign', 'Assign', assignIcon, () => toggle('assign'))}
  {@render action('labels', 'Labels', labelsIcon, () => toggle('labels'))}
  {@render action('column', columnName, columnIcon, () => toggle('column'))}
  {@render action('attach', 'Attach', attachIcon, () => toggle('attach'))}
  {@render action('depends', 'Dependencies', dependsIcon, () => toggle('depends'))}

  {#if open !== null}
    {@const trigger = buttons[open] ?? undefined}
    {#if open === 'dates'}
      <Popover {trigger} id={panelId} label="Dates" onclose={close}>
        <DatesPanel {taskId} oncleared={() => close({ restoreFocus: true })} />
      </Popover>
    {:else if open === 'assign'}
      <Popover {trigger} id={panelId} label="Assign" onclose={close}>
        <AssigneeSearchMenu {taskId} autofocus onclose={() => close({ restoreFocus: true })} />
      </Popover>
    {:else if open === 'labels'}
      <Popover {trigger} id={panelId} label="Add labels" onclose={close}>
        <LabelSearchMenu {taskId} autofocus onclose={() => close({ restoreFocus: true })} />
      </Popover>
    {:else if open === 'column'}
      <Popover {trigger} id={panelId} label="Move to column" onclose={close}>
        <ul class="flex flex-col gap-1" aria-label="Columns">
          {#each board.columns as column (column.id)}
            <li>
              <button
                type="button"
                aria-current={column.id === task?.column_id ? 'true' : undefined}
                onclick={() => moveTo(column.id)}
                class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-accent-soft focus-ring-inset {column.id ===
                task?.column_id
                  ? 'font-medium text-accent-strong'
                  : ''}"
              >
                <span class="min-w-0 flex-1 truncate">{column.name}</span>
                {#if column.id === task?.column_id}
                  <span class="shrink-0 text-xs text-muted">current</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </Popover>
    {:else if open === 'attach'}
      <Popover {trigger} id={panelId} label="Attach" onclose={close}>
        <div class="flex flex-col gap-2">
          <Button variant="secondary" onclick={() => attach('file')}>Attach file</Button>
          <Button variant="secondary" onclick={() => attach('link')}>Add link</Button>
        </div>
      </Popover>
    {:else if open === 'depends'}
      <Popover {trigger} id={panelId} label="Dependencies" onclose={close}>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <p class="text-xs font-medium text-muted">Blocked by</p>
            <DependencyPicker {taskId} direction="blocker" autofocus />
          </div>
          <div class="flex flex-col gap-1">
            <p class="text-xs font-medium text-muted">Blocks</p>
            <DependencyPicker {taskId} direction="blocked" />
          </div>
        </div>
      </Popover>
    {/if}
  {/if}
</div>
