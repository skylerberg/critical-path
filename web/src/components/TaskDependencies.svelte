<script lang="ts">
  import { board } from '../lib/board.svelte';
  import { crossProjectDeps } from '../lib/crossProjectDeps.svelte';
  import Badge from './ui/Badge.svelte';
  import DependencyList from './DependencyList.svelte';

  interface Props {
    taskId: string;
    readonly?: boolean;
  }

  let { taskId, readonly = false }: Props = $props();

  const taskById = $derived(new Map(board.tasks.map((t) => [t.id, t])));
  const doneColumnIds = $derived(board.doneColumnIds);
  const task = $derived(taskById.get(taskId));
  const blockers = $derived((task?.blocker_ids ?? []).flatMap((id) => taskById.get(id) ?? []));
  const dependents = $derived(board.tasks.filter((t) => t.blocker_ids.includes(taskId)));

  const entry = $derived(crossProjectDeps.get(taskId));
  const cross = $derived(entry?.deps ?? null);
  const anonymous = $derived(board.readonly);
  // The same idiom as TaskAttachments: the card already knows how many rows are
  // coming, so the list can reserve them before the fetch answers.
  const crossPending = $derived(cross === null && !anonymous);
  const crossSkeletons = $derived(crossPending ? (task?.open_cross_project_blocker_count ?? 0) : 0);

  const openBlockerCount = $derived(
    blockers.filter((blocker) => !doneColumnIds.has(blocker.column_id)).length +
      (task?.open_cross_project_blocker_count ?? 0)
  );
  const showBlockedBy = $derived(
    blockers.length > 0 ||
      crossSkeletons > 0 ||
      (cross !== null && cross.blocked_by.length + cross.hidden_blocked_by_count > 0)
  );
  const showBlocks = $derived(
    dependents.length > 0 ||
      (cross !== null && cross.blocking.length + cross.hidden_blocking_count > 0)
  );
</script>

{#if showBlockedBy}
  <section class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <h3 class="text-sm font-semibold text-muted">Blocked by</h3>
      {#if openBlockerCount > 0}
        <Badge variant="danger">
          {openBlockerCount} open task{openBlockerCount === 1 ? '' : 's'}
        </Badge>
      {/if}
    </div>
    <DependencyList
      {taskId}
      direction="blocker"
      local={blockers}
      remote={cross?.blocked_by ?? []}
      hiddenCount={cross?.hidden_blocked_by_count ?? 0}
      skeletonCount={crossSkeletons}
      loading={crossPending}
      {doneColumnIds}
      {readonly}
    />
    {#if entry?.error === true}
      <p class="text-sm text-muted">
        Dependencies in other projects could not be loaded.
        <button
          type="button"
          onclick={() => crossProjectDeps.refresh(taskId)}
          class="cursor-pointer underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Try again
        </button>
      </p>
    {/if}
  </section>
{/if}

{#if showBlocks}
  <section class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold text-muted">Blocks</h3>
    <DependencyList
      {taskId}
      direction="blocked"
      local={dependents}
      remote={cross?.blocking ?? []}
      hiddenCount={cross?.hidden_blocking_count ?? 0}
      skeletonCount={0}
      loading={crossPending}
      {doneColumnIds}
      {readonly}
    />
  </section>
{/if}
