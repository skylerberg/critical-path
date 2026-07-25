<script lang="ts">
  import { projects } from '../lib/projects.svelte';
  import { router } from '../lib/router.svelte';
  import { session } from '../lib/session.svelte';
  import { users } from '../lib/users.svelte';
  import MemberPicker from './MemberPicker.svelte';
  import Avatar from './ui/Avatar.svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import Modal from './ui/Modal.svelte';

  interface Props {
    projectId: string;
    onclose: () => void;
  }

  let { projectId, onclose }: Props = $props();

  const project = $derived(projects.projects.find((p) => p.id === projectId));
  const canLeave = $derived(
    session.user !== null && (project?.member_ids.includes(session.user.id) ?? false)
  );

  // Membership changes publish no user event, so a collaborator added to a shared
  // board since app start is missing from the cached directory this modal reads.
  $effect(() => {
    void users.refresh().catch(() => {});
  });

  function displayName(userId: string): string {
    const name = users.displayFor(userId).name;
    return name === '' ? userId : name;
  }

  function removeMember(userId: string): void {
    if (project === undefined) return;
    void projects.setMembers(
      project.id,
      project.member_ids.filter((id) => id !== userId)
    );
  }

  function leave(): void {
    if (project === undefined) return;
    const id = project.id;
    void projects.leave(id);
    onclose();
    if (router.current.name === 'project' && router.current.params.id === id) {
      router.navigate('/');
    }
  }
</script>

{#snippet memberRow(userId: string, owner: boolean)}
  {@const name = displayName(userId)}
  <li class="flex min-h-11 items-center gap-2">
    <Avatar {name} src={users.displayFor(userId).avatar_url} size="sm" />
    <span class="min-w-0 flex-1 truncate text-sm">
      {name}{userId === session.user?.id ? ' (you)' : ''}
    </span>
    {#if owner}
      <Badge>Owner</Badge>
    {:else if userId !== session.user?.id}
      <button
        type="button"
        aria-label="Remove {name}"
        onclick={() => removeMember(userId)}
        class="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-danger"
      >
        ✕
      </button>
    {/if}
  </li>
{/snippet}

{#if project !== undefined}
  <Modal open title="Members of {project.name}" {onclose}>
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <ul class="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {#if project.created_by !== null}
            {@render memberRow(project.created_by, true)}
          {/if}
          {#each project.member_ids as memberId (memberId)}
            {@render memberRow(memberId, false)}
          {/each}
        </ul>
        <MemberPicker {projectId} />
      </div>

      {#if canLeave}
        <div class="flex flex-col gap-2 border-t border-edge pt-4">
          <p class="text-sm text-muted">
            Leaving removes your access to this board and unassigns your tasks.
          </p>
          <Button variant="danger" class="self-start" onclick={leave}>Leave board</Button>
        </div>
      {/if}
    </div>
  </Modal>
{/if}
