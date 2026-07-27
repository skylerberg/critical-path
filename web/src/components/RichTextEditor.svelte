<script lang="ts">
  import { untrack } from 'svelte';
  import type { Snippet } from 'svelte';
  import { Editor, mergeAttributes, type ChainedCommands, type JSONContent } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Image from '@tiptap/extension-image';
  import { Mention, type MentionNodeAttrs } from '@tiptap/extension-mention';
  import { Placeholder } from '@tiptap/extensions';
  import type { BoardTask } from '../lib/board-types';
  import { filterMentionCandidates, mentionLabel } from '../lib/mentions';
  import { toasts } from '../lib/toasts.svelte';
  import type { User } from '../lib/users.svelte';
  import Avatar from './ui/Avatar.svelte';

  type TiptapDoc = NonNullable<BoardTask['description']>;

  interface Props {
    content: TiptapDoc | null;
    onSave?: (doc: TiptapDoc | null) => void | Promise<boolean | void>;
    onChange?: (doc: TiptapDoc | null) => void;
    uploadImage?: (file: File) => Promise<string | null>;
    mentionUsers?: User[];
    placeholder?: string;
    readonly?: boolean;
    bare?: boolean;
  }

  let {
    content,
    onSave,
    onChange,
    uploadImage,
    mentionUsers = [],
    placeholder = 'Add a description…',
    readonly = false,
    bare = false,
  }: Props = $props();

  let element = $state<HTMLDivElement>();
  let fileInput = $state<HTMLInputElement>();
  let editor = $state<Editor | null>(null);
  let version = $state(0);
  let mention = $state<{
    items: User[];
    index: number;
    command: (attrs: MentionNodeAttrs) => void;
  } | null>(null);

  // Saves are debounced (800 ms) and flushed on blur and teardown.
  const SAVE_DEBOUNCE_MS = 800;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSaved = 'null';

  export function getEditor(): Editor | null {
    return editor;
  }

  // The caller is discarding the user's text for the server's, so a save already
  // scheduled for it has to be dropped rather than flushed.
  export function replaceContent(doc: TiptapDoc | null): void {
    const e = editor;
    if (!e || e.isDestroyed) return;
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    e.commands.setContent((doc ?? null) as JSONContent | null, { emitUpdate: false });
    lastSaved = JSON.stringify(currentDoc(e));
  }

  function currentDoc(e: Editor): TiptapDoc | null {
    return e.isEmpty ? null : (e.getJSON() as TiptapDoc);
  }

  function scheduleSave(): void {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  function flushSave(): void {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const e = editor;
    if (!e || e.isDestroyed || onSave === undefined) return;
    const save = onSave;
    const doc = currentDoc(e);
    const serialized = JSON.stringify(doc);
    if (serialized === lastSaved) return;
    const committed = serialized;
    lastSaved = serialized;
    // On failure, reset lastSaved to a value no doc serializes to so the next
    // flush retries — unless a newer save has already superseded this one.
    const markFailed = (): void => {
      if (lastSaved === committed) {
        lastSaved = '';
      }
    };
    void Promise.resolve(save(doc)).then((ok) => {
      if (ok === false) markFailed();
    }, markFailed);
  }

  function insertImageFiles(files: FileList | null | undefined): boolean {
    if (!uploadImage || !files) return false;
    const images = [...files].filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return false;
    for (const file of images) {
      void uploadImage(file).then((url) => {
        if (url !== null && editor && !editor.isDestroyed) {
          editor.chain().focus().setImage({ src: url }).run();
        }
      });
    }
    return true;
  }

  function commitMention(user: User): void {
    mention?.command({ id: user.id, label: user.name });
  }

  $effect(() => {
    const el = element;
    if (!el) return;
    const e = untrack(
      () =>
        new Editor({
          element: el,
          extensions: [
            StarterKit.configure({
              underline: false,
              heading: { levels: [1, 2, 3] },
              link: {
                openOnClick: false,
                isAllowedUri: (url, ctx) =>
                  ctx.defaultValidate(url) && /^(https?:|mailto:)/i.test(url),
              },
            }),
            Image,
            // Registered even where nothing can produce a mention: an editor
            // silently drops nodes its schema does not know, and the next save
            // would write that deletion back.
            Mention.configure({
              HTMLAttributes: { class: 'mention' },
              renderHTML: ({ options, node }) => [
                'span',
                mergeAttributes(options.HTMLAttributes),
                `@${mentionLabel(node.attrs)}`,
              ],
              renderText: ({ node }) => `@${mentionLabel(node.attrs)}`,
              suggestion: {
                // Read per keystroke, never at construction: the editor is built
                // once, inside untrack, so a value captured here would be frozen.
                items: ({ query }) => filterMentionCandidates(mentionUsers, query),
                render: () => ({
                  onStart: (props) => {
                    mention = { items: props.items, index: 0, command: props.command };
                  },
                  onUpdate: (props) => {
                    mention = { items: props.items, index: 0, command: props.command };
                  },
                  onKeyDown: ({ event }) => {
                    const open = mention;
                    if (open === null || open.items.length === 0) return false;
                    if (event.key === 'ArrowDown') {
                      mention = { ...open, index: Math.min(open.items.length - 1, open.index + 1) };
                      return true;
                    }
                    if (event.key === 'ArrowUp') {
                      mention = { ...open, index: Math.max(0, open.index - 1) };
                      return true;
                    }
                    if (event.key === 'Enter' || event.key === 'Tab') {
                      commitMention(open.items[open.index]);
                      return true;
                    }
                    return false;
                  },
                  onExit: () => {
                    mention = null;
                  },
                }),
              },
            }),
            Placeholder.configure({ placeholder }),
          ],
          content: (content ?? null) as JSONContent | null,
          editable: !readonly,
          editorProps: {
            attributes: { class: 'tiptap' },
            handlePaste: (_view, event) => insertImageFiles(event.clipboardData?.files),
            handleDrop: (_view, event, _slice, moved) =>
              !moved && insertImageFiles(event.dataTransfer?.files),
          },
          onTransaction: () => {
            version += 1;
          },
          onUpdate: ({ editor: updated }) => {
            scheduleSave();
            onChange?.(currentDoc(updated));
          },
          onBlur: flushSave,
        })
    );
    lastSaved = JSON.stringify(currentDoc(e));
    // Untracked like the construction above: a tracked read of onChange would tear
    // the editor down and rebuild it whenever the parent re-renders.
    untrack(() => onChange?.(currentDoc(e)));
    editor = e;
    return () => {
      flushSave();
      e.destroy();
      editor = null;
    };
  });

  const s = $derived.by(() => {
    void version;
    const e = editor;
    return {
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      strike: e?.isActive('strike') ?? false,
      code: e?.isActive('code') ?? false,
      h1: e?.isActive('heading', { level: 1 }) ?? false,
      h2: e?.isActive('heading', { level: 2 }) ?? false,
      h3: e?.isActive('heading', { level: 3 }) ?? false,
      bulletList: e?.isActive('bulletList') ?? false,
      orderedList: e?.isActive('orderedList') ?? false,
      blockquote: e?.isActive('blockquote') ?? false,
      codeBlock: e?.isActive('codeBlock') ?? false,
      link: e?.isActive('link') ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    };
  });

  function run(command: (chain: ChainedCommands) => ChainedCommands): void {
    const e = editor;
    if (!e) return;
    command(e.chain().focus()).run();
  }

  function normalizeHref(raw: string): string | null {
    if (raw === '') return null;
    if (/^(https?:\/\/|mailto:)/i.test(raw)) return raw;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
    return `https://${raw}`;
  }

  function toggleLink(): void {
    const e = editor;
    if (!e) return;
    if (e.isActive('link')) {
      e.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const input = window.prompt('Link URL (https://… or mailto:…)');
    if (input === null) return;
    const href = normalizeHref(input.trim());
    if (href === null) {
      toasts.error('Only http(s) and mailto links are allowed');
      return;
    }
    e.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }
</script>

{#snippet bulletListIcon()}
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
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <path d="M3 6h.01" />
    <path d="M3 12h.01" />
    <path d="M3 18h.01" />
  </svg>
{/snippet}

{#snippet orderedListIcon()}
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
    <path d="M10 6h11" />
    <path d="M10 12h11" />
    <path d="M10 18h11" />
    <path d="M4 6h1v4" />
    <path d="M4 10h2" />
    <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
  </svg>
{/snippet}

{#snippet tool(
  label: string | Snippet,
  name: string,
  active: boolean,
  action: () => void,
  disabled = false
)}
  <button
    type="button"
    aria-label={name}
    title={name}
    aria-pressed={active}
    {disabled}
    onmousedown={(event) => event.preventDefault()}
    onclick={action}
    class="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md px-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 {active
      ? 'bg-accent-soft text-accent-strong'
      : 'text-muted hover:bg-accent-soft hover:text-ink'}"
  >
    {#if typeof label === 'string'}
      {label}
    {:else}
      {@render label()}
    {/if}
  </button>
{/snippet}

<div
  class="rte relative {bare ? 'rte-bare' : 'rounded-md border border-edge bg-canvas'} {readonly
    ? ''
    : 'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30'}"
>
  {#if !readonly}
    <div
      class="flex flex-wrap items-center border-b border-edge px-1"
      role="toolbar"
      aria-label="Formatting"
    >
      {@render tool('B', 'Bold', s.bold, () => run((c) => c.toggleBold()))}
      {@render tool('I', 'Italic', s.italic, () => run((c) => c.toggleItalic()))}
      {@render tool('S', 'Strikethrough', s.strike, () => run((c) => c.toggleStrike()))}
      {@render tool('</>', 'Inline code', s.code, () => run((c) => c.toggleCode()))}
      {@render tool('H1', 'Heading 1', s.h1, () => run((c) => c.toggleHeading({ level: 1 })))}
      {@render tool('H2', 'Heading 2', s.h2, () => run((c) => c.toggleHeading({ level: 2 })))}
      {@render tool('H3', 'Heading 3', s.h3, () => run((c) => c.toggleHeading({ level: 3 })))}
      {@render tool(bulletListIcon, 'Bullet list', s.bulletList, () =>
        run((c) => c.toggleBulletList())
      )}
      {@render tool(orderedListIcon, 'Ordered list', s.orderedList, () =>
        run((c) => c.toggleOrderedList())
      )}
      {@render tool('❝', 'Blockquote', s.blockquote, () => run((c) => c.toggleBlockquote()))}
      {@render tool('{ }', 'Code block', s.codeBlock, () => run((c) => c.toggleCodeBlock()))}
      {@render tool('🔗', 'Link', s.link, toggleLink)}
      {#if uploadImage}
        {@render tool('🖼', 'Insert image', false, () => fileInput?.click())}
      {/if}
      {@render tool('↺', 'Undo', false, () => run((c) => c.undo()), !s.canUndo)}
      {@render tool('↻', 'Redo', false, () => run((c) => c.redo()), !s.canRedo)}
    </div>
  {/if}
  <div bind:this={element}></div>

  {#if mention !== null && mention.items.length > 0}
    {@const open = mention}
    <div
      role="listbox"
      aria-label="Mention a person"
      class="absolute top-full left-0 z-10 mt-1 flex max-h-56 w-64 flex-col overflow-y-auto rounded-md border border-edge bg-surface shadow-lg"
    >
      {#each open.items as user, i (user.id)}
        <button
          type="button"
          role="option"
          aria-selected={i === open.index}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => commitMention(user)}
          class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 px-3 text-left text-sm {i ===
          open.index
            ? 'bg-accent-soft'
            : 'hover:bg-accent-soft'}"
        >
          <Avatar name={user.name} src={user.avatar_url} size="sm" />
          <span class="min-w-0 flex-1 truncate font-medium">{user.name}</span>
          <span class="min-w-0 truncate text-xs text-muted">{user.email}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if !readonly}
  <input
    bind:this={fileInput}
    type="file"
    accept="image/png,image/jpeg,image/gif,image/webp"
    multiple
    class="hidden"
    onchange={(event) => {
      insertImageFiles(event.currentTarget.files);
      event.currentTarget.value = '';
    }}
  />
{/if}

<style>
  .rte :global(.tiptap) {
    outline: none;
    min-height: 7rem;
    padding: 0.75rem;
    font-size: 0.875rem;
    line-height: 1.6;
  }
  .rte-bare :global(.tiptap) {
    min-height: 0;
    padding: 0;
    font-size: 0.8125rem;
    line-height: 1.55;
  }
  .rte :global(.tiptap > * + *) {
    margin-top: 0.5rem;
  }
  .rte :global(.tiptap h1) {
    font-size: 1.5rem;
    font-weight: 700;
  }
  .rte :global(.tiptap h2) {
    font-size: 1.25rem;
    font-weight: 600;
  }
  .rte :global(.tiptap h3) {
    font-size: 1.125rem;
    font-weight: 600;
  }
  .rte :global(.tiptap ul) {
    list-style: disc;
    padding-left: 1.5rem;
  }
  .rte :global(.tiptap ol) {
    list-style: decimal;
    padding-left: 1.5rem;
  }
  .rte :global(.tiptap blockquote) {
    border-left: 3px solid var(--cp-edge);
    padding-left: 0.75rem;
    color: var(--cp-muted);
  }
  .rte :global(.tiptap code) {
    background: var(--cp-accent-soft);
    border-radius: 0.25rem;
    padding: 0.1rem 0.3rem;
    font-size: 0.8em;
  }
  .rte :global(.tiptap pre) {
    background: var(--cp-canvas);
    border: 1px solid var(--cp-edge);
    border-radius: 0.375rem;
    padding: 0.75rem;
    overflow-x: auto;
  }
  .rte :global(.tiptap pre code) {
    background: none;
    padding: 0;
  }
  .rte :global(.tiptap a) {
    color: var(--cp-accent);
    text-decoration: underline;
  }
  .rte :global(.tiptap img) {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
  }
  .rte :global(.tiptap img.ProseMirror-selectednode) {
    outline: 2px solid var(--cp-accent);
  }
  .rte :global(.tiptap .mention) {
    background: var(--cp-accent-soft);
    color: var(--cp-accent-strong);
    border-radius: 0.25rem;
    padding: 0.05rem 0.25rem;
    font-weight: 500;
    white-space: nowrap;
  }
  .rte :global(.tiptap hr) {
    border-top: 1px solid var(--cp-edge);
    margin: 1rem 0;
  }
  .rte :global(.tiptap p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    color: var(--cp-muted);
    float: left;
    height: 0;
    pointer-events: none;
  }
</style>
