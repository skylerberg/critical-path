<script lang="ts">
  import { board } from '../lib/board.svelte';
  import Input from './ui/Input.svelte';

  interface Props {
    taskId: string;
  }

  let { taskId }: Props = $props();

  let query = $state('');

  const task = $derived(board.tasks.find((t) => t.id === taskId));
  const candidates = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    const excluded = new Set([taskId, ...(task?.blocker_ids ?? [])]);
    return board.tasks
      .filter((t) => !excluded.has(t.id) && t.title.toLowerCase().includes(q))
      .slice(0, 8);
  });

  function add(blockerId: string): void {
    void board.addBlocker(taskId, blockerId);
    query = '';
  }
</script>

<div class="flex flex-col gap-2">
  <Input
    bind:value={query}
    aria-label="Search tasks to add as blockers"
    placeholder="Search tasks to add as blockers…"
  />
  {#if query.trim() !== ''}
    {#if candidates.length === 0}
      <p class="text-sm text-muted">No matching tasks.</p>
    {:else}
      <ul class="flex flex-col overflow-hidden rounded-md border border-edge">
        {#each candidates as candidate (candidate.id)}
          <li>
            <button
              type="button"
              onclick={() => add(candidate.id)}
              class="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm hover:bg-accent-soft"
            >
              <span class="text-accent" aria-hidden="true">+</span>
              <span class="min-w-0 flex-1 truncate">{candidate.title}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
