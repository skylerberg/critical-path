<script lang="ts">
  import { tick } from 'svelte';
  import { focusIf } from '../lib/actions';
  import { board } from '../lib/board.svelte';
  import { draftKey, drafts } from '../lib/drafts.svelte';
  import { motion } from '../lib/motion.svelte';
  import { toasts } from '../lib/toasts.svelte';
  import Button from './ui/Button.svelte';

  interface Props {
    columnId: string;
  }

  let { columnId }: Props = $props();

  const key = $derived(draftKey.quickAddTask(columnId));
  const title = $derived(drafts.get(key));
  const open = $derived(title !== null);
  let openedHere = $state(false);
  let input = $state<HTMLInputElement>();

  function start(): void {
    openedHere = true;
    drafts.set(key, '');
  }

  // The store pushes its optimistic rows synchronously, so the column's bottom
  // card is the newest one; awaiting the API would stall the scroll behind it.
  async function scrollToNewestCard(): Promise<void> {
    const created = board.tasksInColumn(columnId).at(-1);
    if (created === undefined) {
      return;
    }
    await tick();
    document
      .querySelector(`[data-task-id="${created.id}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: motion.reduced ? 'auto' : 'smooth' });
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const trimmed = (title ?? '').trim();
    if (trimmed === '') {
      return;
    }
    void board.createTask(columnId, trimmed);
    // Only the text is cleared: this composer stays open for rapid entry.
    drafts.set(key, '');
    input?.focus();
    await scrollToNewestCard();
  }

  function paste(event: ClipboardEvent): void {
    const lines = (event.clipboardData?.getData('text/plain') ?? '')
      .split(/\r\n|\r|\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (lines.length < 2) {
      return;
    }
    event.preventDefault();
    void addMany(lines);
  }

  async function addMany(lines: string[]): Promise<void> {
    const before = board.tasksInColumn(columnId).length;
    const pending = board.createTasks(columnId, lines);
    // A refused batch inserts nothing, and scrolling then would jump to an
    // unrelated card that merely sits at the bottom.
    if (board.tasksInColumn(columnId).length > before) {
      await scrollToNewestCard();
    }
    // Waits, so a batch that fails is never announced as a success.
    if ((await pending) !== null) {
      toasts.success(`Added ${lines.length} tasks`);
    }
  }

  function close(): void {
    openedHere = false;
    drafts.clear(key);
  }
</script>

<div class="p-2 pt-0">
  {#if open}
    <form onsubmit={submit} class="flex flex-col gap-2">
      <input
        bind:this={input}
        value={title ?? ''}
        oninput={(event) => drafts.set(key, event.currentTarget.value)}
        onpaste={paste}
        use:focusIf={{ active: openedHere, onfocused: () => (openedHere = false) }}
        aria-label="Task title"
        placeholder="Task title"
        autocapitalize="sentences"
        onkeydown={(event) => {
          if (event.key === 'Escape') {
            close();
          }
        }}
        class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent"
      />
      <div class="flex gap-2">
        <Button type="submit" class="flex-1">Add task</Button>
        <Button variant="ghost" onclick={close}>Cancel</Button>
      </div>
    </form>
  {:else}
    <button
      type="button"
      onclick={start}
      class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-muted hover:bg-accent-soft hover:text-ink"
    >
      + Add task
    </button>
  {/if}
</div>
