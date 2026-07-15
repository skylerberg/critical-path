<script lang="ts">
  import { untrack } from 'svelte';
  import { Editor, type ChainedCommands, type JSONContent } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Image from '@tiptap/extension-image';
  import { Placeholder } from '@tiptap/extensions';
  import type { BoardTask } from '../lib/board-types';
  import { toasts } from '../lib/toasts.svelte';

  type TiptapDoc = NonNullable<BoardTask['description']>;

  interface Props {
    content: TiptapDoc | null;
    onSave: (doc: TiptapDoc | null) => void;
    uploadImage?: (file: File) => Promise<string | null>;
    placeholder?: string;
  }

  let { content, onSave, uploadImage, placeholder = 'Add a description…' }: Props = $props();

  let element = $state<HTMLDivElement>();
  let fileInput = $state<HTMLInputElement>();
  let editor = $state<Editor | null>(null);
  let version = $state(0);

  // Saves are debounced (800 ms) and flushed on blur and teardown.
  const SAVE_DEBOUNCE_MS = 800;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSaved = 'null';

  export function getEditor(): Editor | null {
    return editor;
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
    if (!e || e.isDestroyed) return;
    const doc = currentDoc(e);
    const serialized = JSON.stringify(doc);
    if (serialized === lastSaved) return;
    lastSaved = serialized;
    onSave(doc);
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
            Placeholder.configure({ placeholder }),
          ],
          content: (content ?? null) as JSONContent | null,
          editorProps: {
            attributes: { class: 'tiptap' },
            handlePaste: (_view, event) => insertImageFiles(event.clipboardData?.files),
            handleDrop: (_view, event, _slice, moved) =>
              !moved && insertImageFiles(event.dataTransfer?.files),
          },
          onTransaction: () => {
            version += 1;
          },
          onUpdate: scheduleSave,
          onBlur: flushSave,
        })
    );
    lastSaved = JSON.stringify(currentDoc(e));
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

{#snippet tool(label: string, name: string, active: boolean, action: () => void, disabled = false)}
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
    {label}
  </button>
{/snippet}

<div
  class="rte rounded-md border border-edge bg-canvas focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30"
>
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
    {@render tool('••', 'Bullet list', s.bulletList, () => run((c) => c.toggleBulletList()))}
    {@render tool('1.', 'Ordered list', s.orderedList, () => run((c) => c.toggleOrderedList()))}
    {@render tool('❝', 'Blockquote', s.blockquote, () => run((c) => c.toggleBlockquote()))}
    {@render tool('{ }', 'Code block', s.codeBlock, () => run((c) => c.toggleCodeBlock()))}
    {@render tool('🔗', 'Link', s.link, toggleLink)}
    {#if uploadImage}
      {@render tool('🖼', 'Insert image', false, () => fileInput?.click())}
    {/if}
    {@render tool('↺', 'Undo', false, () => run((c) => c.undo()), !s.canUndo)}
    {@render tool('↻', 'Redo', false, () => run((c) => c.redo()), !s.canRedo)}
  </div>
  <div bind:this={element}></div>
</div>

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

<style>
  .rte :global(.tiptap) {
    outline: none;
    min-height: 7rem;
    padding: 0.75rem;
    font-size: 0.875rem;
    line-height: 1.6;
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
