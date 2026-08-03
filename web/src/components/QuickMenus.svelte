<script lang="ts">
  import { untrack } from 'svelte';
  import { board } from '../lib/board.svelte';
  import { cardContext } from '../lib/card-context.svelte';
  import { editableCardTarget } from '../lib/card-target';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import BulkActions from './BulkActions.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import QuickAssigneeMenu from './QuickAssigneeMenu.svelte';
  import QuickDependencyMenu from './QuickDependencyMenu.svelte';
  import QuickLabelMenu from './QuickLabelMenu.svelte';
  import QuickMoveMenu from './QuickMoveMenu.svelte';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';
  import Spinner from './ui/Spinner.svelte';

  const menuTaskId = $derived(
    shortcuts.labelMenu ??
      shortcuts.assigneeMenu ??
      shortcuts.dependencyMenu?.taskId ??
      shortcuts.moveMenu ??
      null
  );
  // The palette's action rows read the same context, and it can be open with no
  // card in context at all.
  const targetId = $derived(menuTaskId ?? (shortcuts.paletteOpen ? editableCardTarget() : null));

  // Tracked so a target whose project is still being looked up comes back here on
  // the flush that answers it; ensure() writes the state these reads track.
  const targetProjectId = $derived(targetId === null ? null : cardContext.projectIdFor(targetId));
  $effect(() => {
    const id = targetId;
    void targetProjectId;
    untrack(() => cardContext.ensure(id));
  });

  const ctx = $derived(targetId === null ? board : cardContext.storeFor(targetId));
  const status = $derived(targetId === null ? 'ready' : cardContext.statusFor(targetId));
</script>

{#if shortcuts.paletteOpen}
  <CommandPalette {ctx} onclose={() => (shortcuts.paletteOpen = false)} />
{/if}

{#if menuTaskId !== null && status !== 'ready'}
  <!-- Rendered rather than skipped: a menu state with nothing on screen leaves the
       keymap swallowing every key but Escape. -->
  <Modal
    open
    title={status === 'error' ? 'That card is out of reach' : 'Loading…'}
    onclose={() => shortcuts.closeMenus()}
  >
    {#if status === 'error'}
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">
          Its board could not be loaded, so there is nothing to act on.
        </p>
        <div class="flex gap-2">
          <Button variant="secondary" onclick={() => cardContext.retry(menuTaskId)}>
            Try again
          </Button>
          <Button variant="ghost" onclick={() => shortcuts.closeMenus()}>Close</Button>
        </div>
      </div>
    {:else}
      <div class="flex justify-center py-6">
        <Spinner size="lg" />
      </div>
    {/if}
  </Modal>
{:else}
  {#if shortcuts.labelMenu !== null}
    <!-- The seed is dropped here as well as in closeMenus(): a menu dismissed on its
         own never reaches that, and it must not carry into the next menu opened. -->
    <QuickLabelMenu
      taskId={shortcuts.labelMenu}
      {ctx}
      prefill={shortcuts.menuPrefill}
      onclose={() => {
        shortcuts.labelMenu = null;
        shortcuts.menuPrefill = '';
      }}
    />
  {/if}
  {#if shortcuts.assigneeMenu !== null}
    <QuickAssigneeMenu
      taskId={shortcuts.assigneeMenu}
      {ctx}
      onclose={() => (shortcuts.assigneeMenu = null)}
    />
  {/if}
  {#if shortcuts.dependencyMenu !== null}
    <QuickDependencyMenu
      taskId={shortcuts.dependencyMenu.taskId}
      {ctx}
      direction={shortcuts.dependencyMenu.direction}
      onclose={() => (shortcuts.dependencyMenu = null)}
    />
  {/if}
  {#if shortcuts.moveMenu !== null}
    <QuickMoveMenu
      taskId={shortcuts.moveMenu}
      {ctx}
      prefill={shortcuts.menuPrefill}
      onclose={() => {
        shortcuts.moveMenu = null;
        shortcuts.menuPrefill = '';
      }}
    />
  {/if}
{/if}

{#if shortcuts.bulkMenu !== null}
  <BulkActions kind={shortcuts.bulkMenu} onclose={() => (shortcuts.bulkMenu = null)} />
{/if}
