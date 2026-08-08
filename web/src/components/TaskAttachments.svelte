<script lang="ts">
  import { announcer } from '../lib/announcer.svelte';
  import { board, type TaskAttachment } from '../lib/board.svelte';
  import Button from './ui/Button.svelte';
  import Spinner from './ui/Spinner.svelte';
  import OfflineNotice from './OfflineNotice.svelte';

  interface Props {
    taskId: string;
    readonly?: boolean;
  }

  let { taskId, readonly = false }: Props = $props();

  const TITLE_MAX_LENGTH = 300;
  const URL_MAX_LENGTH = 2048;
  const URL_HINT = 'Enter a link starting with http:// or https://';

  const loaded = $derived(board.taskAttachments[taskId]);
  const task = $derived(board.tasks.find((candidate) => candidate.id === taskId));
  // One list from the server, split here only for layout: pictures read better as
  // a grid of thumbnails, documents and links as rows.
  const images = $derived((loaded ?? []).filter((entry) => entry.kind === 'image'));
  const attachments = $derived(loaded?.filter((entry) => entry.kind !== 'image'));
  const stillLoading = $derived(loaded === undefined && (task?.attachment_count ?? 0) > 0);

  let fileInput = $state<HTMLInputElement>();
  let addingLink = $state(false);
  let linkDraft = $state('');
  let linkError = $state(false);
  let editingId = $state<string | null>(null);
  let editDraft = $state('');
  let confirmingDeleteId = $state<string | null>(null);
  let dropActive = $state(false);
  let pending = $state<{ key: string; name: string }[]>([]);

  const nothingAttached = $derived(
    images.length === 0 && (attachments?.length ?? 0) === 0 && pending.length === 0
  );

  $effect(() => {
    void taskId;
    addingLink = false;
    linkDraft = '';
    linkError = false;
    editingId = null;
    confirmingDeleteId = null;
    dropActive = false;
    pending = [];
  });

  const focusAndSelect = (node: HTMLInputElement): void => {
    node.focus();
    node.select();
  };

  function formatBytes(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(1)} ${units[unit]}`;
  }

  function typeLabel(attachment: TaskAttachment): string {
    const extension = (attachment.filename ?? '').split('.').pop() ?? '';
    if (/^[A-Za-z0-9]{1,8}$/.test(extension) && extension !== attachment.filename) {
      return extension.toUpperCase();
    }
    const subtype = (attachment.content_type ?? '').split('/')[1] ?? '';
    return subtype === '' ? 'File' : subtype.toUpperCase();
  }

  function fileMeta(attachment: TaskAttachment): string {
    return [formatBytes(attachment.size_bytes), typeLabel(attachment)].filter(Boolean).join(' · ');
  }

  // Defence in depth: the server only ever stores http(s), but a stored value is
  // still the one thing on this row that could become an executable href.
  function safeHref(url: string | null): string | null {
    if (url === null) return null;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }

  function hostname(url: string | null): string {
    if (url === null) return '';
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  function displayLabel(attachment: TaskAttachment): string {
    if (attachment.title !== null && attachment.title !== '') {
      return attachment.title;
    }
    return attachment.kind === 'file'
      ? (attachment.filename ?? 'Attachment')
      : hostname(attachment.url);
  }

  async function uploadFiles(files: Iterable<File>): Promise<void> {
    for (const file of files) {
      const key = `${String(Date.now())}-${file.name}-${String(Math.random())}`;
      pending = [...pending, { key, name: file.name }];
      void announcer.announce(`Uploading ${file.name}`);
      // The server reads the leading bytes and decides whether this is an image;
      // nothing here has to know the rule.
      void board.uploadTaskAttachment(taskId, file).finally(() => {
        pending = pending.filter((entry) => entry.key !== key);
      });
    }
    await Promise.resolve();
  }

  function submitLink(event: SubmitEvent): void {
    event.preventDefault();
    const raw = linkDraft.trim();
    if (safeHref(raw) === null) {
      linkError = true;
      return;
    }
    linkError = false;
    void board.addLinkAttachment(taskId, raw);
    linkDraft = '';
    addingLink = false;
  }

  // The section lives inside a native <dialog>, so an unstopped Escape would
  // close the whole card rather than this one sub-form.
  function handleLinkKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    addingLink = false;
    linkDraft = '';
    linkError = false;
  }

  function startEdit(attachment: TaskAttachment): void {
    editingId = attachment.id;
    editDraft = attachment.title ?? '';
    confirmingDeleteId = null;
  }

  // Enter commits and unmounts the input, so the blur that follows finds the edit
  // already closed and this returns without writing it twice.
  function commitEdit(attachment: TaskAttachment): void {
    if (editingId !== attachment.id) {
      return;
    }
    editingId = null;
    const title = editDraft.trim();
    const next = title === '' ? null : title;
    if (next !== attachment.title) {
      void board.patchAttachment(taskId, attachment.id, { title: next });
    }
  }

  function requestDelete(id: string): void {
    if (confirmingDeleteId !== id) {
      confirmingDeleteId = id;
      return;
    }
    confirmingDeleteId = null;
    void board.deleteAttachment(taskId, id);
  }

  function carriesDroppable(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return types !== undefined && (types.includes('Files') || types.includes('text/uri-list'));
  }

  function handleDragOver(event: DragEvent): void {
    if (readonly || !carriesDroppable(event)) return;
    event.preventDefault();
    dropActive = true;
  }

  function handleDrop(event: DragEvent): void {
    if (readonly) return;
    event.preventDefault();
    dropActive = false;
    const files = event.dataTransfer?.files;
    if (files !== undefined && files.length > 0) {
      void uploadFiles(files);
      return;
    }
    const text =
      event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain');
    const first = (text ?? '').split('\n')[0].trim();
    if (safeHref(first) !== null) {
      void board.addLinkAttachment(taskId, first);
    }
  }

  const actionClass =
    'flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent';
</script>

<OfflineNotice />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex flex-col gap-2 rounded-md border-2 border-dashed p-1 {dropActive
    ? 'border-accent bg-accent-soft'
    : 'border-transparent'}"
  ondragenter={handleDragOver}
  ondragover={handleDragOver}
  ondragleave={() => {
    dropActive = false;
  }}
  ondrop={handleDrop}
>
  {#if !readonly}
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onclick={() => fileInput?.click()}>Attach file</Button>
      <Button
        variant="secondary"
        onclick={() => {
          addingLink = true;
          linkError = false;
        }}
      >
        Add link
      </Button>
    </div>
  {/if}

  {#if addingLink && !readonly}
    <form onsubmit={submitLink} class="flex flex-wrap items-center gap-2">
      <input
        bind:value={linkDraft}
        use:focusAndSelect
        type="url"
        inputmode="url"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        maxlength={URL_MAX_LENGTH}
        aria-label="Link address"
        aria-invalid={linkError}
        placeholder="https://example.com/doc"
        onkeydown={handleLinkKeydown}
        class="min-h-11 min-w-0 flex-1 rounded-md border bg-canvas px-3 text-sm outline-none {linkError
          ? 'border-danger'
          : 'border-edge focus:border-accent'}"
      />
      <Button type="submit" variant="secondary">Add</Button>
    </form>
    {#if linkError}
      <p role="alert" class="text-xs text-danger">{URL_HINT}</p>
    {/if}
  {/if}

  {#if pending.length > 0}
    <ul class="flex flex-col">
      {#each pending as entry (entry.key)}
        <li aria-busy="true" class="flex min-h-11 items-center gap-2 text-sm text-muted">
          <Spinner size="sm" label="Uploading {entry.name}" />
          <span class="min-w-0 truncate">{entry.name}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if stillLoading}
    <Spinner size="sm" label="Loading attachments" />
  {:else if images.length > 0}
    <ul class="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {#each images as image (image.id)}
        {@const isCover = image.is_cover}
        <li class="relative flex flex-col gap-1">
          <img
            src={image.image_url ?? ''}
            alt={image.filename}
            loading="lazy"
            class="aspect-square w-full rounded-md border border-edge object-cover"
          />
          {#if !readonly}
            <button
              type="button"
              aria-label="Use image {image.filename} as cover"
              aria-pressed={isCover}
              onclick={() => void board.setTaskCover(taskId, isCover ? null : image)}
              class="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1 rounded-md border text-xs focus-visible:outline-2 focus-visible:outline-accent {isCover
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-edge text-muted hover:bg-accent-soft'}"
            >
              {isCover ? '★' : '☆'} Cover
            </button>
            <button
              type="button"
              aria-label="Delete image {image.filename}"
              onclick={() => void board.deleteAttachment(taskId, image.id)}
              class="absolute top-1 right-1 flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-sm text-white hover:bg-danger"
            >
              ✕
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if attachments !== undefined}
    {#if nothingAttached && !stillLoading}
      <p class="text-sm text-muted">
        {readonly ? 'No attachments.' : 'Nothing attached yet. Drop a file here, or add a link.'}
      </p>
    {:else if attachments.length > 0}
      <ul class="flex flex-col {images.length > 0 ? 'border-t border-edge pt-2' : ''}">
        {#each attachments as attachment (attachment.id)}
          {@const label = displayLabel(attachment)}
          {@const href = attachment.kind === 'link' ? safeHref(attachment.url) : null}
          <li
            class="group flex flex-wrap items-center gap-2 rounded-md py-1 focus-within:outline-2 focus-within:outline-accent"
          >
            {#if attachment.kind === 'link'}
              {#if attachment.favicon_url !== null}
                <img
                  src={attachment.favicon_url}
                  alt=""
                  width="16"
                  height="16"
                  loading="lazy"
                  decoding="async"
                  class="size-4 shrink-0 rounded-sm"
                />
              {:else}
                <svg
                  class="size-4 shrink-0 text-muted"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18" />
                  <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
                </svg>
              {/if}
            {:else}
              <svg
                class="size-4 shrink-0 text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5" />
              </svg>
            {/if}

            {#if editingId === attachment.id}
              <input
                bind:value={editDraft}
                use:focusAndSelect
                aria-label="Rename {label}"
                maxlength={TITLE_MAX_LENGTH}
                onblur={() => commitEdit(attachment)}
                onkeydown={(event) => {
                  if (event.key === 'Enter') {
                    commitEdit(attachment);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    editingId = null;
                  }
                }}
                class="min-h-11 w-full min-w-0 flex-1 rounded-md border border-accent bg-canvas px-2 text-sm outline-none"
              />
            {:else}
              <div class="flex min-w-0 flex-1 flex-col">
                {#if href !== null}
                  <a
                    {href}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    referrerpolicy="no-referrer"
                    class="min-w-0 truncate text-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {label}
                  </a>
                {:else}
                  <span class="min-w-0 truncate text-sm text-ink">{label}</span>
                {/if}
                {#if attachment.kind === 'link'}
                  <span class="min-w-0 truncate text-xs text-muted">{hostname(attachment.url)}</span
                  >
                  {#if attachment.description !== null}
                    <span class="min-w-0 truncate text-xs text-muted">{attachment.description}</span
                    >
                  {/if}
                  {#if attachment.unfurl_state === 'pending'}
                    <span aria-live="polite" class="flex items-center gap-1 text-xs text-muted">
                      <Spinner size="sm" label="Fetching preview" />
                      Fetching preview…
                    </span>
                  {:else if attachment.unfurl_state === 'failed'}
                    <span class="text-xs text-muted">No preview available</span>
                  {/if}
                {:else}
                  <span class="min-w-0 truncate text-xs text-muted">{fileMeta(attachment)}</span>
                {/if}
              </div>

              {#if attachment.kind === 'link' && attachment.preview_url !== null}
                <img
                  src={attachment.preview_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="h-16 w-24 shrink-0 rounded-md border border-edge object-cover"
                />
              {/if}

              {#if attachment.kind === 'file'}
                <button
                  type="button"
                  aria-label="Download {label}"
                  onclick={() => void board.downloadAttachment(attachment)}
                  class="{actionClass} opacity-100 hover:bg-accent-soft hover:text-ink"
                >
                  <svg
                    class="size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 3v12" />
                    <path d="m7 11 5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                </button>
              {/if}

              {#if !readonly}
                <button
                  type="button"
                  aria-label="Rename {label}"
                  onclick={() => startEdit(attachment)}
                  class="{actionClass} hover:bg-accent-soft hover:text-ink {attachment.unfurl_state ===
                  'failed'
                    ? 'opacity-100'
                    : ''}"
                >
                  <svg
                    class="size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label={confirmingDeleteId === attachment.id
                    ? `Confirm delete of ${label}`
                    : `Delete ${label}`}
                  onclick={() => requestDelete(attachment.id)}
                  class="{actionClass} hover:bg-accent-soft hover:text-danger {confirmingDeleteId ===
                  attachment.id
                    ? 'text-danger opacity-100'
                    : ''}"
                >
                  {#if confirmingDeleteId === attachment.id}
                    <span class="text-xs font-medium">Sure?</span>
                  {:else}
                    <svg
                      class="size-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 6h18" />
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </svg>
                  {/if}
                </button>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if !readonly}
    <input
      bind:this={fileInput}
      type="file"
      multiple
      class="hidden"
      onchange={(event) => {
        void uploadFiles(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
      }}
    />
  {/if}
</div>
