<script lang="ts">
  import { tick } from 'svelte';
  import { focusIf } from '../lib/actions';
  import { revealInList } from '../lib/scroll-reveal';
  import { board } from '../lib/board.svelte';
  import { draftKey, drafts } from '../lib/drafts.svelte';
  import { motion } from '../lib/motion.svelte';
  import { TASK_TITLE_MAX_LENGTH } from '../lib/titles';
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
  //
  // Scoped to this column's own list rather than scrollIntoView, whose `inline`
  // defaults to 'nearest' and which walks every scrollable ancestor: a card the
  // board has clipped horizontally makes it pan the board too, and a
  // mandatory-snap board then resolves that pan onto some other column.
  async function scrollToNewestCard(): Promise<void> {
    const created = board.tasksInColumn(columnId).at(-1);
    if (created === undefined) {
      return;
    }
    await tick();
    const list = document.querySelector<HTMLElement>(`[data-task-list="${CSS.escape(columnId)}"]`);
    const card = list?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(created.id)}"]`);
    if (list != null && card != null) {
      revealInList(list, card, !motion.reduced);
    }
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
    input?.focus({ preventScroll: true });
    await scrollToNewestCard();
  }

  // Capped as the field's maxlength caps typing: the batch is all-or-nothing, so
  // a single over-long line would 422 every card pasted with it. The bound counts
  // UTF-16 units on both sides of the wire, so the cut is made in those and then
  // backed off a trailing lone surrogate — half a character, which the request
  // body would encode as a replacement one.
  function cap(line: string): string {
    if (line.length <= TASK_TITLE_MAX_LENGTH) {
      return line;
    }
    const cut = line.slice(0, TASK_TITLE_MAX_LENGTH);
    const last = cut.charCodeAt(cut.length - 1);
    const whole = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
    return whole.trimEnd();
  }

  function paste(event: ClipboardEvent): void {
    const raw = (event.clipboardData?.getData('text/plain') ?? '')
      .split(/\r\n|\r|\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (raw.length < 2) {
      return;
    }
    event.preventDefault();
    const lines = raw.map(cap);
    void addMany(lines, lines.filter((line, index) => line !== raw[index]).length);
  }

  async function addMany(lines: string[], shortened: number): Promise<void> {
    const before = board.tasksInColumn(columnId).length;
    const pending = board.createTasks(columnId, lines);
    // A refused batch inserts nothing, and scrolling then would jump to an
    // unrelated card that merely sits at the bottom.
    if (board.tasksInColumn(columnId).length > before) {
      await scrollToNewestCard();
    }
    // Waits, so a batch that fails is never announced as a success.
    if ((await pending) !== null) {
      // Truncation is the same correction maxlength makes to typing, but typing
      // shows it happening and a paste does not; a card silently ending
      // mid-sentence is the one thing the user cannot find out any other way.
      toasts.success(
        shortened === 0
          ? `Added ${lines.length} tasks`
          : `Added ${lines.length} tasks (${shortened} shortened to fit)`
      );
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
        maxlength={TASK_TITLE_MAX_LENGTH}
        aria-label="Task title"
        placeholder="Task title"
        autocapitalize="sentences"
        onkeydown={(event) => {
          if (event.key === 'Escape') {
            close();
          }
        }}
        class="min-h-11 rounded-md border border-edge bg-canvas px-3 text-sm focus-ring focus:border-accent"
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
      class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-muted hover:bg-accent-soft hover:text-ink focus-ring"
    >
      + Add task
    </button>
  {/if}
</div>
