<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { CARD_ACTION_KEYS, type CardActionId } from '../lib/card-actions';
  import { cardMenu } from '../lib/card-menu.svelte';
  import { boardPath, link } from '../lib/router.svelte';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import { truncateTitle } from '../lib/titles';
  import { toasts } from '../lib/toasts.svelte';

  interface Props {
    projectId: string;
    canEdit: boolean;
  }

  let { projectId, canEdit }: Props = $props();

  interface Item {
    id: CardActionId;
    label: string;
    run?: () => void;
    href?: string;
    newTab?: boolean;
  }

  const EDGE_MARGIN_PX = 8;

  let menuEl = $state<HTMLDivElement>();
  let placed = $state({ x: cardMenu.x, y: cardMenu.y });

  const task = $derived(board.tasks.find((t) => t.id === cardMenu.taskId));
  const href = $derived(
    task === undefined
      ? ''
      : `${boardPath(projectId, board.readonly)}/tasks/${task.id}${board.filterSearch}`
  );
  const completable = $derived(
    task !== undefined && board.doneColumnIds.size > 0 && !board.doneColumnIds.has(task.column_id)
  );

  const editItems = $derived.by<Item[]>(() => {
    if (task === undefined || !canEdit) {
      return [];
    }
    const id = task.id;
    const items: Item[] = [
      { id: 'rename', label: 'Edit title', run: () => cardMenu.rename(id) },
      { id: 'labels', label: 'Labels…', run: () => (shortcuts.labelMenu = id) },
      { id: 'assignees', label: 'Assignees…', run: () => (shortcuts.assigneeMenu = id) },
      {
        id: 'blockers',
        label: 'Blocked by…',
        run: () => (shortcuts.dependencyMenu = { taskId: id, direction: 'blocker' }),
      },
      {
        id: 'blocking',
        label: 'Blocks…',
        run: () => (shortcuts.dependencyMenu = { taskId: id, direction: 'blocked' }),
      },
      { id: 'move', label: 'Move to…', run: () => (shortcuts.moveMenu = id) },
    ];
    if (completable) {
      items.push({ id: 'done', label: 'Mark done', run: () => void board.markTaskDone(id) });
    }
    items.push(
      { id: 'duplicate', label: 'Duplicate', run: () => void board.duplicateTask(id) },
      { id: 'archive', label: 'Archive', run: () => void board.archiveTask(id) }
    );
    return items;
  });

  const linkItems = $derived<Item[]>([
    { id: 'open', label: 'Open', href },
    { id: 'openNewTab', label: 'Open in new tab', href, newTab: true },
    { id: 'copyLink', label: 'Copy link', run: () => void copyLink() },
  ]);

  function keyShortcuts(item: Item): string | undefined {
    const keys = CARD_ACTION_KEYS[item.id];
    return keys.length === 0 ? undefined : keys.join(' ');
  }

  function menuItems(): HTMLElement[] {
    return [...(menuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  }

  // Measured rather than guessed: the anchor is wherever the pointer was, so a
  // card low in a column would otherwise open the menu off the bottom of the screen.
  $effect(() => {
    const rect = menuEl?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    const maxX = window.innerWidth - rect.width - EDGE_MARGIN_PX;
    const maxY = window.innerHeight - rect.height - EDGE_MARGIN_PX;
    placed = {
      x: Math.max(EDGE_MARGIN_PX, Math.min(cardMenu.x, maxX)),
      y: Math.max(EDGE_MARGIN_PX, Math.min(cardMenu.y, maxY)),
    };
  });

  $effect(() => {
    if (task === undefined) {
      cardMenu.close();
    }
  });

  $effect(() => {
    menuItems()[0]?.focus({ preventScroll: true });
  });

  function moveFocus(to: number | 'first' | 'last'): void {
    const focusable = menuItems();
    if (focusable.length === 0) {
      return;
    }
    const from = focusable.indexOf(document.activeElement as HTMLElement);
    const index =
      to === 'first'
        ? 0
        : to === 'last'
          ? focusable.length - 1
          : (from + to + focusable.length) % focusable.length;
    focusable[index]?.focus();
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(new URL(href, window.location.origin).href);
      toasts.success('Link copied');
    } catch {
      toasts.error('Could not copy the link');
    }
  }

  // Run before close: closing empties the menu's view of the card, and an action
  // that reads it would find nothing there.
  function activate(item: Item, event: MouseEvent): void {
    item.run?.();
    // Only a plain click on the card's own link takes the card away with it. A
    // modifier-click loads it in a tab the user is not looking at, so like every
    // other row it leaves them here, and focus belongs back on the card.
    const leaves =
      item.href !== undefined &&
      item.newTab !== true &&
      !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
    cardMenu.close({ restoreFocus: !leaves });
  }

  // Enter is left out: it activates whichever row has focus, which is the menu's
  // own contract and would otherwise be stolen by the row that advertises it.
  function rowForKey(event: KeyboardEvent): number {
    if (event.key === 'Enter' || event.metaKey || event.ctrlKey || event.altKey) {
      return -1;
    }
    const pressed = event.shiftKey ? `Shift+${event.key.toUpperCase()}` : event.key;
    return [...editItems, ...linkItems].findIndex((item) =>
      CARD_ACTION_KEYS[item.id].includes(pressed)
    );
  }

  function onkeydown(event: KeyboardEvent): void {
    // Tab is deliberately not swallowed: the menu closes and focus carries on out
    // of it rather than being trapped.
    if (event.key === 'Tab') {
      cardMenu.close({ restoreFocus: true });
      return;
    }
    const rows = menuItems();
    switch (event.key) {
      case 'ArrowDown':
        moveFocus(1);
        break;
      case 'ArrowUp':
        moveFocus(-1);
        break;
      case 'Home':
        moveFocus('first');
        break;
      case 'End':
        moveFocus('last');
        break;
      case 'Escape':
        cardMenu.close({ restoreFocus: true });
        break;
      // Anchors have no Space activation of their own, and cancelling the key is
      // what keeps a button from firing a second time on keyup. Clicking rather
      // than calling the action: a link row does its work through its anchor.
      case ' ':
        rows.find((row) => row === document.activeElement)?.click();
        break;
      default: {
        // The keys every row advertises have to work while the row is on screen,
        // or the promise aria-keyshortcuts makes is one the menu does not keep.
        const index = rowForKey(event);
        if (index === -1) {
          return;
        }
        rows[index]?.click();
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }

  // pointerdown rather than click: a drag begun elsewhere on the board must not
  // leave the menu floating over it, and a right-click on another card presses
  // before it asks for its own menu, so this never races that menu shut. A wheel
  // scrolls the board out from under a menu that is anchored to the viewport.
  function closeOnOutside(event: Event): void {
    const target = event.target;
    if (target instanceof Node && menuEl?.contains(target) === true) {
      return;
    }
    cardMenu.close();
  }

  const itemClass =
    'flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 text-left text-sm hover:bg-accent-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';
</script>

<svelte:window onpointerdown={closeOnOutside} onwheel={closeOnOutside} />

{#snippet row(item: Item)}
  {@const keys = CARD_ACTION_KEYS[item.id]}
  <span class="flex-1 truncate">{item.label}</span>
  {#if keys.length > 0}
    <!-- Hidden from the accessible name, which carries the keys as aria-keyshortcuts
         instead: spelling "Enter or o" into every row's label reads as gibberish. -->
    <span aria-hidden="true" class="flex shrink-0 items-center gap-1">
      {#each keys as key, i (i)}
        {#if i > 0}
          <span class="text-xs text-muted">or</span>
        {/if}
        <kbd
          class="inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-edge bg-canvas px-1.5 text-xs font-medium text-muted"
        >
          {key}
        </kbd>
      {/each}
    </span>
  {/if}
{/snippet}

{#if task !== undefined}
  <div
    bind:this={menuEl}
    role="menu"
    tabindex="-1"
    aria-label="Actions for {truncateTitle(task.title)}"
    {onkeydown}
    style="left: {placed.x}px; top: {placed.y}px"
    class="fixed z-40 max-h-[80vh] w-64 overflow-y-auto rounded-md border border-edge bg-surface py-1 shadow-lg"
  >
    {#each editItems as item (item.id)}
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        aria-keyshortcuts={keyShortcuts(item)}
        class={itemClass}
        onclick={(event) => activate(item, event)}
      >
        {@render row(item)}
      </button>
    {/each}
    {#if editItems.length > 0}
      <div role="separator" class="my-1 border-t border-edge"></div>
    {/if}
    {#each linkItems as item (item.id)}
      {#if item.href === undefined}
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          aria-keyshortcuts={keyShortcuts(item)}
          class={itemClass}
          onclick={(event) => activate(item, event)}
        >
          {@render row(item)}
        </button>
      {:else}
        <!-- A real anchor, so the card's URL keeps working the ways the browser's own
             menu offered it: middle-click, modifier-click, and drag to the tab bar. -->
        <a
          use:link
          role="menuitem"
          tabindex="-1"
          aria-keyshortcuts={keyShortcuts(item)}
          href={item.href}
          target={item.newTab === true ? '_blank' : undefined}
          rel={item.newTab === true ? 'noopener' : undefined}
          class={itemClass}
          onclick={(event) => activate(item, event)}
          onauxclick={(event) => {
            // The middle button opens the tab natively and dispatches no click, so
            // nothing else here would take the menu off the board it is floating over.
            if (event.button === 1) {
              cardMenu.close({ restoreFocus: true });
            }
          }}
        >
          {@render row(item)}
        </a>
      {/if}
    {/each}
  </div>
{/if}
