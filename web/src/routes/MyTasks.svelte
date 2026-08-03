<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { cardCursor } from '../lib/card-cursor.svelte';
  import { myTasks, type MyTaskPersonGroup } from '../lib/myTasks.svelte';
  import { link } from '../lib/router.svelte';
  import { taskHref } from '../lib/short-links';
  import { session } from '../lib/session.svelte';
  import { truncateTitle } from '../lib/titles';
  import { displayName, users } from '../lib/users.svelte';
  import MyTaskRow from '../components/MyTaskRow.svelte';
  import Avatar from '../components/ui/Avatar.svelte';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';

  // Unconditional, so returning to the screen resyncs a list nothing keeps live.
  onMount(() => {
    void myTasks.load();
  });

  const selfId = $derived(session.user?.id ?? null);
  const taskSections = $derived([
    { title: 'Blocking others', tasks: myTasks.blocking },
    { title: 'Ready', tasks: myTasks.ready },
    { title: 'Blocked', tasks: myTasks.blocked },
  ]);
  const groupSections = $derived([
    { title: 'Waiting on you', groups: myTasks.waitingOnYou },
    { title: 'You are waiting on', groups: myTasks.youAreWaitingOn },
  ]);

  // Screen order, so j and k walk the page the way it reads. A card can appear in
  // both a bucket and a person group, and the cursor needs one place to land.
  const rowIds = $derived([
    ...new Set([
      ...taskSections.flatMap((section) => section.tasks.map((task) => task.id)),
      ...groupSections.flatMap((section) =>
        section.groups.flatMap((group) => group.tasks.map((task) => task.id))
      ),
    ]),
  ]);

  $effect(() => {
    cardCursor.setRows(rowIds);
  });
  // Only the cursor, and only on the way out: a refreshed list keeps its cursor, and
  // the arriving screen owns the rows whichever order the two screens swap in.
  onDestroy(() => cardCursor.clear());
</script>

{#snippet personGroup(group: MyTaskPersonGroup)}
  <div class="flex flex-col gap-1 rounded-lg border border-edge bg-surface p-3">
    <div class="flex items-center gap-2">
      {#if group.user_id === null}
        <span class="text-sm font-medium">Unassigned</span>
      {:else}
        {@const user = users.displayFor(group.user_id)}
        <Avatar name={user.name} src={user.avatar_url} size="sm" />
        <span class="text-sm font-medium">{displayName(user)}</span>
      {/if}
      <span class="text-xs text-muted">
        {group.tasks.length} task{group.tasks.length === 1 ? '' : 's'}
      </span>
    </div>
    <ul class="flex flex-col">
      {#each group.tasks as task (task.id)}
        <li>
          <a
            href={taskHref(task.id, task.title) + '?from=my-tasks'}
            data-card-row={task.id}
            onfocus={() => cardCursor.set(task.id)}
            onpointerenter={() => cardCursor.set(task.id)}
            class="flex min-h-11 items-center rounded-md px-2 text-sm hover:bg-accent-soft hover:text-ink {cardCursor.taskId ===
            task.id
              ? 'bg-accent-soft text-ink ring-2 ring-accent'
              : 'text-muted'}"
          >
            {truncateTitle(task.title)}
          </a>
        </li>
      {/each}
    </ul>
  </div>
{/snippet}

<main use:link class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-4 lg:p-8">
  <h1 class="text-2xl font-semibold">My tasks</h1>

  <!-- Above the list rather than in place of it: nothing keeps this screen live, so a
       failed refetch leaves stale rows on screen that must not pass for current. -->
  {#if myTasks.error !== null}
    <div
      role="alert"
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger bg-surface p-3"
    >
      <p class="text-sm text-danger">{myTasks.error}</p>
      <Button variant="secondary" onclick={() => void myTasks.load()}>Try again</Button>
    </div>
  {/if}

  {#if !myTasks.loaded}
    {#if myTasks.error === null}
      <div class="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    {/if}
  {:else if myTasks.tasks.length === 0}
    <div
      class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-edge py-16 text-center"
    >
      <p class="text-muted">Nothing is assigned to you right now.</p>
    </div>
  {:else}
    {#each taskSections as section (section.title)}
      {#if section.tasks.length > 0}
        <section class="flex flex-col gap-2">
          <h2 class="text-base font-semibold">{section.title}</h2>
          {#each section.tasks as task (task.id)}
            <MyTaskRow {task} {selfId} />
          {/each}
        </section>
      {/if}
    {/each}

    {#each groupSections as section (section.title)}
      {#if section.groups.length > 0}
        <section class="flex flex-col gap-2">
          <h2 class="text-base font-semibold">{section.title}</h2>
          {#each section.groups as group (group.user_id ?? 'unassigned')}
            {@render personGroup(group)}
          {/each}
        </section>
      {/if}
    {/each}
  {/if}
</main>
