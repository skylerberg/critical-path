<script lang="ts">
  import { board } from '../lib/board.svelte';
  import Input from './ui/Input.svelte';

  type Direction = 'blocker' | 'blocked';

  interface Props {
    taskId: string;
    direction: Direction;
  }

  let { taskId, direction }: Props = $props();

  let query = $state('');

  const task = $derived(board.tasks.find((t) => t.id === taskId));

  const excludedIds = $derived.by(() => {
    if (direction === 'blocker') {
      return new Set<string>([taskId, ...(task?.blocker_ids ?? [])]);
    }
    const dependentIds = board.tasks.filter((t) => t.blocker_ids.includes(taskId)).map((t) => t.id);
    return new Set<string>([taskId, ...dependentIds]);
  });

  const candidates = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    return board.tasks
      .filter((t) => !excludedIds.has(t.id) && t.title.toLowerCase().includes(q))
      .slice(0, 8);
  });

  const label = $derived(
    direction === 'blocker' ? 'Search tasks to add as blockers' : 'Search tasks this one blocks'
  );

  function add(otherId: string): void {
    if (direction === 'blocker') {
      void board.addBlocker(taskId, otherId);
    } else {
      void board.addBlocker(otherId, taskId);
    }
    query = '';
  }
</script>

<div class="flex flex-col gap-2">
  <Input bind:value={query} aria-label={label} placeholder="{label}…" />
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
