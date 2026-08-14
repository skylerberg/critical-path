<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { board } from '../lib/board.svelte';
  import { focusCard } from '../lib/card-menu.svelte';
  import { selection } from '../lib/selection.svelte';
  import { shortcuts, type BulkMenu } from '../lib/shortcuts.svelte';

  const count = $derived(selection.count);
  // A set that outlived a demotion is one whose every action 403s, and the cards
  // stop drawing as selected there too.
  const shown = $derived(count > 0 && board.canEdit);

  const buttonClass =
    'inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-accent-soft focus-ring-inset sm:px-3';

  async function clearSelection(): Promise<void> {
    const cursorId = selection.cursorTaskId;
    selection.clear();
    // The bar leaves with the set it describes, so focus has to be put somewhere
    // before the button holding it is gone.
    await tick();
    if (cursorId !== null) {
      focusCard(cursorId);
    }
  }

  // The shell's keymap skips an event that has been handled, so answering Escape
  // here is what lets the set clear without focus falling to <body> with the bar.
  function escapeClears(node: HTMLElement): { destroy: () => void } {
    const onkeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      void clearSelection();
    };
    node.addEventListener('keydown', onkeydown);
    return { destroy: () => node.removeEventListener('keydown', onkeydown) };
  }
</script>

{#snippet labelIcon()}
  <svg
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M3 11V5a2 2 0 0 1 2-2h6l10 10-8 8z" />
    <circle cx="7.5" cy="7.5" r="1.5" />
  </svg>
{/snippet}

{#snippet assignIcon()}
  <svg
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
{/snippet}

{#snippet moveIcon()}
  <svg
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <line x1="4" y1="12" x2="16" y2="12" />
    <polyline points="12 7 17 12 12 17" />
    <line x1="20" y1="4" x2="20" y2="20" />
  </svg>
{/snippet}

{#snippet archiveIcon()}
  <svg
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
{/snippet}

{#snippet clearIcon()}
  <svg
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
{/snippet}

{#snippet action(kind: BulkMenu, label: string, icon: Snippet)}
  <button type="button" onclick={() => (shortcuts.bulkMenu = kind)} class={buttonClass}>
    {@render icon()}
    <!-- Named on every size, drawn only where four labeled buttons and the count
         fit on one row. -->
    <span class="sr-only sm:not-sr-only">{label}</span>
  </button>
{/snippet}

{#if shown}
  <!-- In the shell's flex column rather than over it: the column ends exactly where
       the mobile bottom nav begins, so a bar docked inside it cannot reach the nav
       however the browser resolves the dynamic viewport. -->
  <div
    use:escapeClears
    role="group"
    aria-label="Selection actions"
    class="flex shrink-0 items-center gap-1 border-t border-edge bg-surface px-2 py-1 sm:gap-2 sm:px-3"
  >
    <p class="min-w-0 truncate text-sm font-medium">{count} selected</p>
    <div class="ml-auto flex items-center gap-1">
      {@render action('labels', 'Label', labelIcon)}
      {@render action('assignees', 'Assign', assignIcon)}
      {@render action('move', 'Move', moveIcon)}
      {@render action('archive', 'Archive', archiveIcon)}
      <button
        type="button"
        aria-label="Clear selection"
        onclick={() => void clearSelection()}
        class={buttonClass}
      >
        {@render clearIcon()}
      </button>
    </div>
  </div>
{/if}
