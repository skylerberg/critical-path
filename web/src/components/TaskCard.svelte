<script lang="ts">
  import { untrack } from 'svelte';
  import { isDirectPointerEvent, isTextEntry, suppressTouchContextMenu } from '../lib/actions';
  import { board } from '../lib/board.svelte';
  import type { BoardLabel, BoardTask } from '../lib/board-types';
  import { cardMenu, focusCard } from '../lib/card-menu.svelte';
  import { link } from '../lib/router.svelte';
  import { publicTaskHref, taskHref } from '../lib/short-links';
  import { selection } from '../lib/selection.svelte';
  import { isCalendarDate } from '../lib/dates';
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
  }

  let {
    task,
    projectId,
    labels = [],
    blockedCount = 0,
    done = false,
    dimmed = false,
    readonly = false,
  }: Props = $props();

  const assignees = $derived(task.assignee_ids.map((id) => users.displayFor(id)));
  const dated = $derived(isCalendarDate(task.due_date));
  // Coalesced despite the type: a board served by an API pod that predates comments
  // omits the field entirely.
  const commentCount = $derived(task.comment_count ?? 0);
  const selected = $derived(selection.selectedTaskId === task.id);
  const renaming = $derived(cardMenu.renamingTaskId === task.id);
  const shownTitle = $derived(truncateTitle(task.title));

  let cardEl = $state<HTMLDivElement>();
  let draft = $state('');

  $effect(() => {
    if (renaming) {
      untrack(() => (draft = task.title));
    }
  });

  const focusAndSelect = (node: HTMLTextAreaElement): void => {
    node.focus();
    node.select();
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
  class="relative isolate block min-h-11 touch-callout-none rounded-md border bg-canvas p-3 transition-opacity hover:border-accent {selected
    ? 'border-accent ring-2 ring-accent'
    : 'border-edge'} {dimmed ? 'opacity-30' : ''}"
>
  {#if !renaming}
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
  {#if dated || blockedCount > 0 || task.image_count > 0 || commentCount > 0 || assignees.length > 0}
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
      {#if task.image_count > 0}
        <span
          class="pointer-events-auto inline-flex items-center gap-1 text-xs text-muted"
          title="{task.image_count} image{task.image_count === 1 ? '' : 's'}"
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
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.5-3.5L6 23" />
          </svg>
          {task.image_count}
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
