<script lang="ts">
  import type { MyTask } from '../lib/myTasks.svelte';
  import { truncateTitle } from '../lib/titles';
  import { displayName, users, type User } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Badge from './ui/Badge.svelte';

  interface Props {
    task: MyTask;
    selfId: string | null;
  }

  let { task, selfId }: Props = $props();

  const coAssignees = $derived(
    task.assignee_ids.filter((id) => id !== selfId).map((id) => users.displayFor(id))
  );
  const waiting = $derived(task.waiting_user_ids.map((id) => users.displayFor(id)));

  function names(list: User[]): string {
    return list.map(displayName).join(', ');
  }

  const peopleLines = $derived(
    [
      waiting.length === 0 ? null : `Waiting on this: ${names(waiting)}`,
      coAssignees.length === 0 ? null : `Also assigned: ${names(coAssignees)}`,
    ].filter((line) => line !== null)
  );

  // The ::after covers the whole row, so the anchor is the only element a pointer can
  // hit: names the row shows only as avatars ride on this title or stay unreachable.
  const shownTitle = $derived(truncateTitle(task.title));
  const anchorTitle = $derived(
    peopleLines.length === 0 ? undefined : [shownTitle, ...peopleLines].join('\n')
  );
</script>

<article
  class="relative flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-edge bg-surface p-3 transition-colors hover:border-accent has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-accent"
>
  <p class="min-w-0 flex-1 basis-full text-sm font-medium break-words sm:basis-auto">
    <a
      href="/projects/{task.project_id}/tasks/{task.id}?from=my-tasks"
      title={anchorTitle}
      class="after:absolute after:inset-0 focus-visible:outline-none">{shownTitle}</a
    >
  </p>
  <span class="truncate text-xs text-muted">{task.project_name}</span>
  <Badge variant="neutral">{task.column_name}</Badge>
  {#if task.blocked_by.length > 0}
    <Badge variant="danger">
      Blocked by {task.blocked_by.length}
    </Badge>
  {/if}
  {#if waiting.length > 0}
    <span class="inline-flex items-center gap-1">
      <Badge variant="accent">{waiting.length} waiting</Badge>
      <span class="flex -space-x-1.5">
        {#each waiting as user (user.id)}
          <Avatar name={user.name} src={user.avatar_url} size="sm" />
        {/each}
      </span>
    </span>
  {/if}
  {#if coAssignees.length > 0}
    <span class="flex -space-x-1.5">
      {#each coAssignees as user (user.id)}
        <Avatar name={user.name} src={user.avatar_url} size="sm" />
      {/each}
    </span>
  {/if}
</article>
