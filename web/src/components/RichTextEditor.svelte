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

  export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

  interface Props {
    content: TiptapDoc | null;
    onSave?: (doc: TiptapDoc | null) => void | Promise<boolean | void>;
    onChange?: (doc: TiptapDoc | null) => void;
    uploadImage?: (file: File) => Promise<string | null>;
    mentionUsers?: User[];
    placeholder?: string;
    readonly?: boolean;
    bare?: boolean;
    // One row tall rather than seven, for editors that sit in a list.
    compact?: boolean;
    // Only ever leaves 'idle' when onSave is set, so an editor the parent drives
    // through onChange reports nothing.
    saveState?: SaveState;
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
    compact = false,
    saveState = $bindable('idle'),
  }: Props = $props();

  let element = $state<HTMLDivElement>();
  let fileInput = $state<HTMLInputElement>();
  let menuEl = $state<HTMLDivElement>();
  let editor = $state<Editor | null>(null);
  let version = $state(0);
  let mention = $state<{
    items: User[];
    index: number;
    command: (attrs: MentionNodeAttrs) => void;
  } | null>(null);
  const menuId = $props.id();

  // Saves are debounced (800 ms) and flushed on blur and teardown.
  const SAVE_DEBOUNCE_MS = 800;
  const SAVED_VISIBLE_MS = 2000;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSaved = 'null';

  // The toolbar is hidden until the editor is first focused and then stays: it is
  // rebuilt per card, so a card opens quiet and stops rearranging once in use.
  let everFocused = $state(false);
  const showToolbar = $derived(!readonly && everFocused);

  function setSaveState(next: SaveState): void {
    if (savedTimer !== null) {
      clearTimeout(savedTimer);
      savedTimer = null;
    }
    saveState = next;
    if (next === 'saved') {
      savedTimer = setTimeout(() => {
        savedTimer = null;
        saveState = 'idle';
      }, SAVED_VISIBLE_MS);
    }
  }

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
    setSaveState('idle');
  }

  function currentDoc(e: Editor): TiptapDoc | null {
    return e.isEmpty ? null : (e.getJSON() as TiptapDoc);
  }

  function scheduleSave(): void {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    if (onSave !== undefined) setSaveState('saving');
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
    // Typing back to the stored text writes nothing, so there is no save left to
    // report; anything already settled keeps its word.
    if (serialized === lastSaved) {
      if (saveState === 'saving') setSaveState('idle');
      return;
    }
    const committed = serialized;
    lastSaved = serialized;
    // On failure, reset lastSaved to a value no doc serializes to so the next
    // flush retries — unless a newer save has already superseded this one.
    const markFailed = (): void => {
      if (lastSaved === committed) {
        lastSaved = '';
        setSaveState('error');
      }
    };
    void Promise.resolve(save(doc)).then((ok) => {
      if (ok === false) {
        markFailed();
      } else if (lastSaved === committed) {
        setSaveState('saved');
      }
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

  function mentionOptionId(user: User): string {
    return `${menuId}-${user.id}`;
  }

  function highlightMention(index: number): void {
    if (mention !== null && mention.index !== index) {
      mention = { ...mention, index };
    }
  }

  // Safe to read the DOM before Svelte re-renders: arrow keys move the highlight
  // but never change the row set. Only about five of the eight rows fit the box.
  function revealMentionRow(index: number): void {
    menuEl?.querySelectorAll('button')[index]?.scrollIntoView({ block: 'nearest' });
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
            // Registered even where nothing can produce a mention: a schema that
            // does not know this node fails to parse the whole document and loads
            // an empty one, which the next save would write back.
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
                      const index = Math.min(open.items.length - 1, open.index + 1);
                      mention = { ...open, index };
                      revealMentionRow(index);
                      return true;
                    }
                    if (event.key === 'ArrowUp') {
                      const index = Math.max(0, open.index - 1);
                      mention = { ...open, index };
                      revealMentionRow(index);
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
          // The suggestion plugin only closes on a transaction and a blur is not
          // one, so the menu would otherwise outlive the editor's focus and hang
          // over whatever is rendered below it.
          onBlur: () => {
            mention = null;
            flushSave();
          },
        })
    );
    lastSaved = JSON.stringify(currentDoc(e));
    // Untracked like the construction above: a tracked read of onChange would tear
    // the editor down and rebuild it whenever the parent re-renders.
    untrack(() => onChange?.(currentDoc(e)));
    editor = e;
    return () => {
      flushSave();
      if (savedTimer !== null) clearTimeout(savedTimer);
      e.destroy();
      editor = null;
    };
  });

  // Focus stays in the contenteditable, so the highlighted row is announced only
  // if the editor points at it. ProseMirror leaves attributes it did not set alone.
  $effect(() => {
    const dom = editor?.view.dom;
    if (dom === undefined) return;
    const active = mention === null ? undefined : mention.items[mention.index];
    if (active === undefined) {
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-activedescendant');
      return;
    }
    dom.setAttribute('aria-controls', menuId);
    dom.setAttribute('aria-activedescendant', mentionOptionId(active));
  });

  const s = $derived.by(() => {
    void version;
    const e = editor;
    return {
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      strike: e?.isActive('strike') ?? false,
      code: e?.isActive('code') ?? false,
      // Any level, not just the one the button writes: a document can still hold
      // an h1 or h3 from the markdown importer or a paste, and a toggle that read
      // as unpressed while the caret sat in a heading would lie about both what
      // is there and what the next click does.
      heading: e?.isActive('heading') ?? false,
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
  class="rte relative {bare ? 'rte-bare' : 'rounded-md border border-edge bg-canvas'} {compact
    ? 'rte-compact'
    : ''} {readonly
    ? ''
    : 'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30'}"
  onfocusin={() => (everFocused = true)}
>
  {#if showToolbar}
    <div
      class="flex flex-wrap items-center border-b border-edge px-1"
      role="toolbar"
      aria-label="Formatting"
    >
      {@render tool('B', 'Bold', s.bold, () => run((c) => c.toggleBold()))}
      {@render tool('I', 'Italic', s.italic, () => run((c) => c.toggleItalic()))}
      {@render tool('S', 'Strikethrough', s.strike, () => run((c) => c.toggleStrike()))}
      {@render tool('</>', 'Inline code', s.code, () => run((c) => c.toggleCode()))}
      {@render tool('H', 'Heading', s.heading, () =>
        run((c) => (s.heading ? c.setParagraph() : c.toggleHeading({ level: 2 })))
      )}
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
      bind:this={menuEl}
      id={menuId}
      role="listbox"
      aria-label="Mention a person"
      class="absolute top-full left-0 z-10 mt-1 flex max-h-56 w-64 flex-col overflow-y-auto overscroll-contain rounded-md border border-edge bg-surface shadow-lg"
    >
      {#each open.items as user, i (user.id)}
        <button
          type="button"
          role="option"
          id={mentionOptionId(user)}
          aria-selected={i === open.index}
          onmousedown={(event) => event.preventDefault()}
          onpointermove={() => highlightMention(i)}
          onclick={() => commitMention(user)}
          class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 px-3 text-left text-sm {i ===
          open.index
            ? 'bg-accent-soft'
            : 'hover:bg-accent-soft'}"
        >
          <Avatar name={user.name} src={user.avatar_url} size="sm" />
          <span class="min-w-0 flex-1 truncate font-medium">{user.name}</span>
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
  /* One row of text plus its padding, which is also the 44px tap target. Capped
     because this sits inside a scrolling dialog, where growing without limit
     would push the button below it off screen. */
  .rte-compact :global(.tiptap) {
    min-height: 2.75rem;
    max-height: 12rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.625rem 0.75rem;
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
  /* Same ratios as above, but relative to the smaller bare body: absolute sizes
     put a 24px h1 next to 13px text in a comment. Equal specificity to the rules
     above, so these have to stay below them. */
  .rte-bare :global(.tiptap h1) {
    font-size: 1.5em;
  }
  .rte-bare :global(.tiptap h2) {
    font-size: 1.25em;
  }
  .rte-bare :global(.tiptap h3) {
    font-size: 1.125em;
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
