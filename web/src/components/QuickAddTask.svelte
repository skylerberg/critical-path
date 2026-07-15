<script lang="ts">
  import { board } from '../lib/board.svelte';
  import Button from './ui/Button.svelte';

  interface Props {
    columnId: string;
  }

  let { columnId }: Props = $props();

  let open = $state(false);
  let title = $state('');
  let input = $state<HTMLInputElement>();

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') {
      return;
    }
    void board.createTask(columnId, trimmed);
    title = '';
    input?.focus();
  }

  function close(): void {
    open = false;
    title = '';
  }

  const focusOnMount = (node: HTMLInputElement): void => {
    node.focus();
  };
</script>

<div class="p-2 pt-0">
  {#if open}
    <form onsubmit={submit} class="flex flex-col gap-2">
      <input
        bind:this={input}
        bind:value={title}
        use:focusOnMount
        aria-label="Task title"
        placeholder="Task title"
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
      onclick={() => (open = true)}
      class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-muted hover:bg-accent-soft hover:text-ink"
    >
      + Add task
    </button>
  {/if}
</div>
