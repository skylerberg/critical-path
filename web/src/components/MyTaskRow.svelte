<script lang="ts">
  import { cardCursor } from '../lib/card-cursor.svelte';
  import type { MyTask } from '../lib/myTasks.svelte';
  import { taskHref } from '../lib/short-links';
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

  // Blockers the caller cannot read are counted rather than named, and they are
  // what put the row in the blocked bucket: without them a row held up entirely
  // by invisible work carries no badge and reads as ready.
  // Coalesced: a pod predating cross-project counts omits hidden_blocked_by_count.
  const blockedCount = $derived(task.blocked_by.length + (task.hidden_blocked_by_count ?? 0));

  const cursor = $derived(cardCursor.taskId === task.id);
</script>

<article
  onpointerenter={() => cardCursor.set(task.id)}
  class="relative flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-surface p-3 transition-colors hover:border-accent has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-accent {cursor
    ? 'border-accent ring-2 ring-accent'
    : 'border-edge'}"
>
  <p class="min-w-0 flex-1 basis-full text-sm font-medium break-words sm:basis-auto">
    <a
      href={taskHref(task.id, task.title) + '?from=my-tasks'}
      title={anchorTitle}
      data-card-row={task.id}
      onfocus={() => cardCursor.set(task.id)}
      class="after:absolute after:inset-0 focus-visible:outline-none">{shownTitle}</a
    >
  </p>
  <span class="truncate text-xs text-muted">{task.project_name}</span>
  <Badge variant="neutral">{task.column_name}</Badge>
  {#if blockedCount > 0}
    <Badge variant="danger">
      Blocked by {blockedCount}
    </Badge>
  {/if}
  {#if waiting.length > 0}
    <span class="inline-flex items-center gap-1">
      <Badge variant="accent">{waiting.length} waiting</Badge>
      <span class="flex -space-x-1.5">
        {#each waiting as user (user.id)}
          <Avatar name={displayName(user)} src={user.avatar_url} size="sm" />
        {/each}
      </span>
    </span>
  {/if}
  {#if coAssignees.length > 0}
    <span class="flex -space-x-1.5">
      {#each coAssignees as user (user.id)}
        <Avatar name={displayName(user)} src={user.avatar_url} size="sm" />
      {/each}
    </span>
  {/if}
</article>
