<script lang="ts">
  import { onMount } from 'svelte';
  import { projects, type Project } from '../lib/projects.svelte';
  import { link, router } from '../lib/router.svelte';
  import ProjectMembersModal from '../components/ProjectMembersModal.svelte';
  import Badge from '../components/ui/Badge.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import Modal from '../components/ui/Modal.svelte';
  import Spinner from '../components/ui/Spinner.svelte';

  onMount(() => {
    if (!projects.loaded) {
      void projects.load();
    }
  });

  let createOpen = $state(false);
  let copySource = $state<Project | null>(null);
  let createName = $state('');
  let createError = $state('');
  let creating = $state(false);

  let renameTarget = $state<Project | null>(null);
  let renameName = $state('');
  let renameError = $state('');

  let deleteTarget = $state<Project | null>(null);
  let openMenuId = $state<string | null>(null);
  let archivedOpen = $state(false);
  let membersProjectId = $state<string | null>(null);

  const menuItemClass =
    'flex min-h-11 w-full cursor-pointer items-center px-4 text-left text-sm hover:bg-accent-soft';
  const gridClass = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3';

  function openCreate(source: Project | null): void {
    copySource = source;
    createName = source === null ? '' : `${source.name} copy`;
    createError = '';
    createOpen = true;
  }

  function closeCreate(): void {
    if (!creating) createOpen = false;
  }

  async function submitCreate(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = createName.trim();
    if (name === '') {
      createError = 'Name is required';
      return;
    }
    createError = '';
    creating = true;
    const id =
      copySource === null ? await projects.create(name) : await projects.copy(copySource.id, name);
    creating = false;
    createOpen = false;
    if (id !== null) {
      router.navigate(`/projects/${id}`);
    }
  }

  function openRename(project: Project): void {
    renameTarget = project;
    renameName = project.name;
    renameError = '';
  }

  function submitRename(event: SubmitEvent): void {
    event.preventDefault();
    if (renameTarget === null) return;
    const name = renameName.trim();
    if (name === '') {
      renameError = 'Name is required';
      return;
    }
    void projects.rename(renameTarget.id, name);
    renameTarget = null;
  }

  function confirmDelete(): void {
    if (deleteTarget === null) return;
    void projects.remove(deleteTarget.id);
    deleteTarget = null;
  }

  function toggleMenu(event: MouseEvent, id: string): void {
    event.stopPropagation();
    openMenuId = openMenuId === id ? null : id;
  }

  function toggleArchive(project: Project): void {
    void (project.archived_at === null
      ? projects.archive(project.id)
      : projects.unarchive(project.id));
  }

  function openMembers(project: Project): void {
    membersProjectId = project.id;
    openMenuId = null;
  }
</script>

<svelte:window
  onclick={() => (openMenuId = null)}
  onkeydown={(event) => {
    if (event.key === 'Escape') openMenuId = null;
  }}
/>

{#snippet cardMenu(project: Project)}
  <div class="relative z-10 -mt-2 -mr-2 shrink-0">
    <button
      type="button"
      aria-label="Options for {project.name}"
      aria-expanded={openMenuId === project.id}
      onclick={(event) => toggleMenu(event, project.id)}
      class="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-ink"
    >
      <svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </button>
    {#if openMenuId === project.id}
      <div
        role="menu"
        class="absolute top-full right-0 z-20 w-56 rounded-md border border-edge bg-surface py-1 shadow-lg"
      >
        <button
          type="button"
          role="menuitem"
          class={menuItemClass}
          onclick={() => openRename(project)}
        >
          Rename
        </button>
        <button
          type="button"
          role="menuitem"
          class={menuItemClass}
          onclick={() => openCreate(project)}
        >
          Copy
        </button>
        <button
          type="button"
          role="menuitem"
          class={menuItemClass}
          onclick={() => openMembers(project)}
        >
          Members
        </button>
        <button
          type="button"
          role="menuitem"
          class={menuItemClass}
          onclick={() => toggleArchive(project)}
        >
          {project.archived_at === null ? 'Archive' : 'Unarchive'}
        </button>
        <button
          type="button"
          role="menuitem"
          class="{menuItemClass} text-danger"
          onclick={() => (deleteTarget = project)}
        >
          Delete
        </button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet projectCard(project: Project, dimmed = false)}
  <article
    class="relative flex flex-col gap-2 rounded-lg border border-edge bg-surface p-4 transition-colors hover:border-accent {dimmed
      ? 'opacity-60'
      : ''} {openMenuId === project.id ? 'z-30' : ''}"
  >
    <div class="flex items-start justify-between gap-1">
      <h3 class="min-w-0 pt-1 text-base font-semibold">
        <a href="/projects/{project.id}" class="break-words after:absolute after:inset-0">
          {project.name}
        </a>
      </h3>
      {@render cardMenu(project)}
    </div>
    {#if project.description !== ''}
      <p class="line-clamp-2 text-sm text-muted">{project.description}</p>
    {/if}
    <div class="mt-auto flex items-center gap-2 pt-1">
      <Badge variant="accent">{project.open_task_count} open</Badge>
      <Badge variant="success">{project.done_task_count} done</Badge>
    </div>
  </article>
{/snippet}

<main use:link class="mx-auto flex w-full max-w-6xl flex-col gap-10 p-4 lg:p-8">
  <header class="flex items-center justify-between gap-4">
    <h1 class="text-2xl font-semibold">Projects</h1>
    <Button onclick={() => openCreate(null)}>New project</Button>
  </header>

  {#if !projects.loaded}
    {#if projects.loadError !== null}
      <div class="flex flex-col items-center gap-3 py-16 text-center">
        <p class="text-muted">{projects.loadError}</p>
        <Button variant="secondary" onclick={() => void projects.load()}>Retry</Button>
      </div>
    {:else}
      <div class="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    {/if}
  {:else if projects.active.length === 0}
    <div
      class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-edge py-16 text-center"
    >
      <p class="text-muted">No projects yet.</p>
      <Button onclick={() => openCreate(null)}>Create your first project</Button>
    </div>
  {:else}
    <div class={gridClass}>
      {#each projects.active as project (project.id)}
        {@render projectCard(project)}
      {/each}
    </div>
  {/if}

  {#if projects.loaded}
    {#if projects.archived.length > 0}
      <section class="flex flex-col gap-4">
        <button
          type="button"
          aria-expanded={archivedOpen}
          onclick={() => (archivedOpen = !archivedOpen)}
          class="flex min-h-11 cursor-pointer items-center gap-2 self-start text-lg font-semibold text-muted hover:text-ink"
        >
          <svg
            class="size-4 transition-transform {archivedOpen ? 'rotate-90' : ''}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
          Archived ({projects.archived.length})
        </button>
        {#if archivedOpen}
          <div class={gridClass}>
            {#each projects.archived as project (project.id)}
              {@render projectCard(project, true)}
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</main>

{#if createOpen}
  <Modal open title={copySource === null ? 'New project' : 'Copy project'} onclose={closeCreate}>
    <form id="create-project-form" onsubmit={submitCreate} class="flex flex-col gap-3">
      {#if copySource !== null}
        <p class="text-sm text-muted">
          Copies columns, tasks, labels, dependencies, and images from “{copySource.name}”.
        </p>
      {/if}
      <Input label="Name" bind:value={createName} error={createError} autocapitalize="sentences" />
    </form>
    {#snippet footer()}
      <Button variant="secondary" onclick={closeCreate} disabled={creating}>Cancel</Button>
      <Button type="submit" form="create-project-form" disabled={creating}>
        {#if copySource === null}
          {creating ? 'Creating…' : 'Create project'}
        {:else}
          {creating ? 'Copying…' : 'Copy project'}
        {/if}
      </Button>
    {/snippet}
  </Modal>
{/if}

{#if membersProjectId !== null}
  <ProjectMembersModal projectId={membersProjectId} onclose={() => (membersProjectId = null)} />
{/if}

{#if renameTarget !== null}
  <Modal open title="Rename project" onclose={() => (renameTarget = null)}>
    <form id="rename-project-form" onsubmit={submitRename}>
      <Input label="Name" bind:value={renameName} error={renameError} autocapitalize="sentences" />
    </form>
    {#snippet footer()}
      <Button variant="secondary" onclick={() => (renameTarget = null)}>Cancel</Button>
      <Button type="submit" form="rename-project-form">Save</Button>
    {/snippet}
  </Modal>
{/if}

{#if deleteTarget !== null}
  <Modal open title="Delete project" onclose={() => (deleteTarget = null)}>
    <p class="text-sm">
      Delete <strong>{deleteTarget.name}</strong>? This permanently removes the project and all of
      its columns, tasks, and images.
    </p>
    {#snippet footer()}
      <Button variant="secondary" onclick={() => (deleteTarget = null)}>Cancel</Button>
      <Button variant="danger" onclick={confirmDelete}>Delete project</Button>
    {/snippet}
  </Modal>
{/if}
