<script lang="ts">
  import { untrack } from 'svelte';
  import { isDirectPointerEvent, isTextEntry, suppressTouchContextMenu } from '../lib/actions';
  import { revealInList } from '../lib/scroll-reveal';
  import { board } from '../lib/board.svelte';
  import type { BoardLabel, BoardTask } from '../lib/board-types';
  import { cardMenu, focusCard } from '../lib/card-menu.svelte';
  import { link } from '../lib/router.svelte';
  import { isDragPlaceholder, publicTaskHref, taskHref } from '../lib/short-links';
  import { selection } from '../lib/selection.svelte';
  import { isCalendarDate } from '../lib/dates';
  import { motion } from '../lib/motion.svelte';
  import { outbox } from '../lib/outbox.svelte';
  import { TASK_TITLE_MAX_LENGTH, truncateTitle } from '../lib/titles';
  import { users } from '../lib/users.svelte';
  import DueDatePill from './DueDatePill.svelte';
  import Avatar from './ui/Avatar.svelte';
  import ColorDot from './ui/ColorDot.svelte';

  interface Props {
    task: BoardTask;
    projectId: string;
    labels?: BoardLabel[];
    blockedCount?: number;
    done?: boolean;
    dimmed?: boolean;
    readonly?: boolean;
    changed?: boolean;
  }

  let {
    task,
    projectId,
    labels = [],
    blockedCount = 0,
    done = false,
    dimmed = false,
    readonly = false,
    changed = false,
  }: Props = $props();

  const assignees = $derived(task.assignee_ids.map((id) => users.displayFor(id)));
  const dated = $derived(isCalendarDate(task.due_date));
  // Coalesced despite the type: a board served by an API pod that predates comments
  // omits the field entirely.
  const commentCount = $derived(task.comment_count ?? 0);
  const checklistTotal = $derived(task.checklist_item_count ?? 0);
  const checklistDone = $derived(task.checklist_done_count ?? 0);
  const cursor = $derived(selection.cursorTaskId === task.id);
  const picked = $derived(selection.has(task.id));
  // Only while a set exists, so the default board is pixel-identical.
  const selecting = $derived(selection.count > 0 && !readonly && board.canEdit);
  const attachmentCount = $derived(task.attachment_count ?? 0);
  const unsent = $derived(outbox.isPending(task.id));
  const renaming = $derived(cardMenu.renamingTaskId === task.id);
  const shownTitle = $derived(truncateTitle(task.title));
  // Still drawn, only unlinked, so the gap it leaves keeps the card's size.
  const placeholder = $derived(isDragPlaceholder(task.id));

  let cardEl = $state<HTMLDivElement>();
  let draft = $state('');

  $effect(() => {
    if (renaming) {
      untrack(() => (draft = task.title));
    }
  });

  // focus() would reveal the textarea by scrolling every ancestor, one of which is
  // the board's horizontal snap scroller. The only reveal a rename wants is
  // vertical, inside this card's own list — and it is wanted: the two-row textarea
  // is taller than the title it replaces, so a card at the bottom fold grows past it.
  const focusAndSelect = (node: HTMLTextAreaElement): void => {
    node.focus({ preventScroll: true });
    node.select();
    const list = node.closest<HTMLElement>('[data-task-list]');
    const card = node.closest<HTMLElement>('[data-task-id]');
    if (list !== null && card !== null) {
      revealInList(list, card, !motion.reduced);
    }
  };

  function commitRename(): void {
    if (!renaming) {
      return;
    }
    const title = draft.trim();
    cardMenu.endRename();
    if (title !== '' && title !== task.title) {
      void board.updateTask(task.id, { title });
    }
  }

  // A card can go away under an open rename — a filter narrowing, a column
  // rebuilding, a teammate's move — and removing the focused textarea is not a
  // blur, so nothing else would send what was typed. Escape has already cleared
  // the rename, so the guard above still discards it.
  $effect(() => () => commitRename());

  // The whole card is covered by its overlay link, so there is no part of it that
  // could keep the browser's menu while the rest gets this one. Suppressing it
  // everywhere and carrying Open in new tab and Copy link inside the menu is the
  // trade; holding Shift asks for the browser's menu instead.
  function openMenu(event: MouseEvent): void {
    if (event.shiftKey || board.dragging || isTextEntry(event.target)) {
      return;
    }
    // A finger's long press is answered by the press handler, which unwinds the
    // drag the same press already armed; the platform's own event is too late.
    if (isDirectPointerEvent(event)) {
      return;
    }
    event.preventDefault();
    const rect = cardEl?.getBoundingClientRect();
    // Shift+F10 and the context-menu key report no coordinates, so the card is the
    // anchor there rather than the top-left corner of the window.
    const keyboard = event.clientX === 0 && event.clientY === 0;
    cardMenu.open(
      task.id,
      keyboard ? (rect?.left ?? 0) + 16 : event.clientX,
      keyboard ? (rect?.bottom ?? 0) : event.clientY
    );
  }

  /**
   * The card's drag wrapper is what Tab focuses, so it — not the card — is where
   * the browser fires the keyboard's own request for a context menu.
   */
  function menuTrigger(node: HTMLElement): { destroy: () => void } {
    const host = node.parentElement ?? node;
    host.addEventListener('contextmenu', openMenu);
    return {
      destroy: () => host.removeEventListener('contextmenu', openMenu),
    };
  }
</script>

<!-- The card is a container with a stretched overlay link rather than one big
     anchor, so the due pill can be a real button: a button inside a link is
     invalid and unreachable by keyboard. -->
<div
  bind:this={cardEl}
  role="presentation"
  use:suppressTouchContextMenu
  use:menuTrigger
  onpointerenter={() => {
    if (!board.dragging) {
      selection.set(task.id);
    }
  }}
  onpointerdown={(event) => {
    if (!renaming && !isTextEntry(event.target)) {
      cardMenu.pressStart(event, task.id);
    }
  }}
  onclick={(event) => {
    if (readonly || !board.canEdit || renaming || placeholder) {
      return;
    }
    // macOS opens the menu on ctrl-click and a long press trails a click, so the
    // menu's own gesture must not also toggle.
    if (cardMenu.taskId !== null) {
      return;
    }
    // The overlay link ignores modifier clicks and hands them to the browser,
    // which runs the default action after the whole dispatch — so canceling it
    // here is what reclaims the gesture.
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      selection.toggle(task.id);
    } else if (event.shiftKey) {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      selection.extendTo(task.id);
    }
  }}
  class="relative isolate block min-h-11 touch-callout-none rounded-md border p-3 transition-opacity hover:border-accent {changed
    ? 'bg-accent-soft'
    : 'bg-canvas'} {cursor ? 'border-accent ring-2 ring-accent' : 'border-edge'} {picked
    ? 'outline-2 -outline-offset-2 outline-accent-strong'
    : ''} {dimmed ? 'opacity-30' : ''}"
>
  {#if changed}
    <span class="sr-only">Changed since you last looked</span>
  {/if}
  {#if picked}
    <span class="sr-only">Selected</span>
  {/if}
  {#if selecting && !renaming && !placeholder}
    <button
      type="button"
      role="checkbox"
      aria-checked={picked}
      aria-label="Select {shownTitle}"
      onclick={(event) => {
        event.preventDefault();
        // The container's own modifier handling would otherwise run second and
        // undo this: a cmd-click would toggle twice, a shift-click would put the
        // card straight back.
        event.stopPropagation();
        selection.toggle(task.id);
      }}
      class="absolute top-0 right-0 z-10 flex min-h-11 min-w-11 cursor-pointer items-center justify-center"
    >
      <span
        class="flex size-5 items-center justify-center rounded-full border-2 {picked
          ? 'border-accent-strong bg-accent-strong text-canvas'
          : 'border-muted bg-canvas'}"
      >
        {#if picked}
          <svg
            class="size-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12.5 5 5 9-11" />
          </svg>
        {/if}
      </span>
    </button>
  {/if}
  {#if !renaming && !placeholder}
    <a
      use:link
      href={board.readonly
        ? publicTaskHref(projectId, task.id)
        : taskHref(task.id, task.title) + board.filterSearch}
      draggable="false"
      aria-label={shownTitle}
      class="absolute inset-0 rounded-md"
    ></a>
  {/if}
  <!-- Truthy, not `!== null`: an API pod that predates covers omits the key, and
       `src={undefined}` would render an empty box on every card. -->
  {#if task.cover_image_url}
    <img
      src={task.cover_image_url}
      alt=""
      draggable="false"
      loading="lazy"
      decoding="async"
      class="mb-2 aspect-video w-full rounded object-cover"
    />
  {/if}
  {#if labels.length > 0}
    <div class="mb-1.5 flex flex-wrap gap-1">
      {#each labels as label (label.id)}
        <span
          class="inline-flex items-center gap-1 rounded-full border border-edge px-1.5 py-0.5 text-[10px] font-medium text-muted"
        >
          <ColorDot color={label.color} size="sm" />
          {label.name}
        </span>
      {/each}
    </div>
  {/if}
  {#if renaming}
    <textarea
      bind:value={draft}
      use:focusAndSelect
      rows="2"
      maxlength={TASK_TITLE_MAX_LENGTH}
      aria-label="Task title"
      autocapitalize="sentences"
      onblur={commitRename}
      onkeydown={(event) => {
        // Unmounting the focused textarea drops focus to the body, so the two keys
        // that end the edit hand it back. A blur has already sent focus somewhere
        // the user chose, so it is left alone.
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
          focusCard(task.id);
        } else if (event.key === 'Escape') {
          cardMenu.endRename();
          focusCard(task.id);
        }
      }}
      class="relative z-10 block w-full resize-none rounded-md border border-accent bg-canvas p-1 text-sm font-medium outline-none"
    ></textarea>
  {:else}
    <p class="text-sm font-medium break-words">{shownTitle}</p>
  {/if}
  {#if unsent}
    <!-- At the point of the work, not only in the banner: the global indicator
         says how many changes are waiting, and this says which cards they are on. -->
    <p
      class="relative z-10 mt-1 flex items-center gap-1 text-xs text-muted"
      data-testid="card-unsent"
    >
      <span class="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true"></span>
      Not sent yet
    </p>
  {/if}
  {#if dated || blockedCount > 0 || commentCount > 0 || attachmentCount > 0 || checklistTotal > 0 || assignees.length > 0}
    <!-- Raised above the overlay link so the badges keep their hover tooltips and
         the pill stays clickable; with no offsets it moves nothing. The row itself
         stays transparent to the pointer and each child opts back in, so the blank
         space between badges still belongs to the link. -->
    <div class="pointer-events-none relative z-10 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <DueDatePill {task} {done} {readonly} />
      {#if blockedCount > 0}
        <span
          class="pointer-events-auto inline-flex items-center gap-1 text-xs font-medium text-danger"
          title="Blocked by {blockedCount} open task{blockedCount === 1 ? '' : 's'}"
        >
          <svg
            class="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
          </svg>
          {blockedCount}
        </span>
      {/if}
      {#if commentCount > 0}
        <span
          class="pointer-events-auto inline-flex items-center gap-1 text-xs text-muted"
          title="{commentCount} comment{commentCount === 1 ? '' : 's'}"
        >
          <svg
            class="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"
            />
          </svg>
          {commentCount}
        </span>
      {/if}
      {#if attachmentCount > 0}
        <span
          class="pointer-events-auto inline-flex items-center gap-1 text-xs text-muted"
          title="{attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}"
        >
          <svg
            class="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
            />
          </svg>
          {attachmentCount}
        </span>
      {/if}
      {#if checklistTotal > 0}
        <span
          class="pointer-events-auto inline-flex items-center gap-1 text-xs {checklistDone ===
          checklistTotal
            ? 'text-success'
            : 'text-muted'}"
          title="{checklistDone} of {checklistTotal} checklist item{checklistTotal === 1
            ? ''
            : 's'} done"
        >
          <svg
            class="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="m7.5 12 3 3 6-6" />
          </svg>
          {checklistDone}/{checklistTotal}
        </span>
      {/if}
      {#if assignees.length > 0}
        <span class="pointer-events-auto ml-auto flex -space-x-1.5">
          {#each assignees as assignee (assignee.id)}
            <Avatar name={assignee.name} src={assignee.avatar_url} size="sm" />
          {/each}
        </span>
      {/if}
    </div>
  {/if}
</div>
