import '../api/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Editor } from '@tiptap/core';
import type { components } from '../api/api.generated';
import type { User } from '../lib/users.svelte';
import RichTextEditor from './RichTextEditor.svelte';

// The suggestion plugin resolves its items through an async path, so a listbox
// that is about to open is still absent one tick after the keystroke.
async function settleSuggestion(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
}

// The toolbar appears on first focus, and focusin bubbles from the contenteditable
// to the wrapper that listens for it.
async function focusEditor(container: HTMLElement): Promise<void> {
  await fireEvent.focusIn(container.querySelector('.tiptap')!);
}

function insertedMentionAttrs(editor: Editor): Record<string, unknown> | undefined {
  const doc = editor.getJSON() as {
    content?: Array<{ content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }>;
  };
  return doc.content?.[0].content?.find((node) => node.type === 'mention')?.attrs;
}

const ada: User = { id: 'u-ada', name: 'Ada Lovelace', avatar_url: null };
const alan: User = { id: 'u-alan', name: 'Alan Turing', avatar_url: null };
const zed: User = { id: 'u-zed', name: 'Zed', avatar_url: null };

const manyUsers: User[] = Array.from({ length: 8 }, (_, i) => ({
  id: `u-${i}`,
  name: `Person ${i}`,
  avatar_url: null,
}));

const mentionDoc: components['schemas']['TiptapDoc'] = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'ask ' },
        { type: 'mention', attrs: { id: ada.id, label: 'Ada Lovelace' } },
      ],
    },
  ],
};

describe('RichTextEditor', () => {
  it('mounts a Tiptap editor and toggles bold via editor commands', async () => {
    const onSave = vi.fn();
    const { component, container } = render(RichTextEditor, { content: null, onSave });
    await tick();

    const editor = component.getEditor();
    expect(editor).not.toBeNull();
    expect(container.querySelector('.tiptap')).not.toBeNull();

    editor!.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    });
    editor!.chain().selectAll().toggleBold().run();

    expect(editor!.isActive('bold')).toBe(true);
    const marks = editor!.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks.some((mark) => mark.type === 'bold')).toBe(true);
  });

  it('retries a failed save on the next flush', async () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn().mockResolvedValue(false);
      const { component, unmount } = render(RichTextEditor, { content: null, onSave });
      await tick();

      component.getEditor()!.commands.insertContent('hello');
      await vi.advanceTimersByTimeAsync(800);
      expect(onSave).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      unmount();
      expect(onSave).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-save on teardown after a successful save', async () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn().mockResolvedValue(true);
      const { component, unmount } = render(RichTextEditor, { content: null, onSave });
      await tick();

      component.getEditor()!.commands.insertContent('hello');
      await vi.advanceTimersByTimeAsync(800);
      expect(onSave).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      unmount();
      expect(onSave).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaceContent swaps the document without scheduling or firing a save', async () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn().mockResolvedValue(true);
      const { component, unmount } = render(RichTextEditor, { content: null, onSave });
      await tick();

      component.getEditor()!.commands.insertContent('mine');
      component.replaceContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'theirs' }] }],
      });

      expect(component.getEditor()!.getText()).toBe('theirs');
      await vi.advanceTimersByTimeAsync(800);
      expect(onSave).not.toHaveBeenCalled();

      unmount();
      expect(onSave).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts from the provided doc and renders the toolbar once focused', async () => {
    const onSave = vi.fn();
    const { component, container, getByRole } = render(RichTextEditor, {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'existing' }] }],
      },
      onSave,
    });
    await tick();
    await focusEditor(container);

    expect(component.getEditor()!.getText()).toBe('existing');
    expect(getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
    expect(getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
  });

  it('keeps the toolbar hidden until the editor is focused, then leaves it up', async () => {
    const { container, queryByRole, getByRole } = render(RichTextEditor, {
      content: null,
      onSave: vi.fn(),
    });
    await tick();
    expect(queryByRole('toolbar', { name: 'Formatting' })).toBeNull();

    await focusEditor(container);
    expect(getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();

    // Deliberately sticky: the description autosaves, so there is nothing to
    // strand, and a toolbar that came and went on every click would thrash.
    await fireEvent.focusOut(container.querySelector('.tiptap')!);
    expect(getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
  });

  it('never shows a toolbar on a read-only body, focused or not', async () => {
    const { container, queryByRole } = render(RichTextEditor, { content: null, readonly: true });
    await tick();
    await focusEditor(container);
    expect(queryByRole('toolbar', { name: 'Formatting' })).toBeNull();
  });

  it('reports emptiness through onChange on mount and on every edit', async () => {
    const onChange = vi.fn();
    const { component } = render(RichTextEditor, { content: null, onChange });
    await tick();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(null);

    component.getEditor()!.commands.insertContent('hello');
    await tick();
    expect(onChange.mock.lastCall![0]).toMatchObject({ type: 'doc' });

    component.getEditor()!.commands.clearContent(true);
    await tick();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('renders a bare read-only body with no toolbar', async () => {
    const { container, queryByRole } = render(RichTextEditor, {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a comment' }] }],
      },
      readonly: true,
      bare: true,
    });
    await tick();

    const tiptap = container.querySelector('.tiptap');
    expect(tiptap).toHaveTextContent('a comment');
    expect(tiptap).toHaveAttribute('contenteditable', 'false');
    expect(queryByRole('toolbar')).toBeNull();
    expect(container.querySelector('.rte-bare')).not.toBeNull();
  });

  it('offers only the matching candidates when @ is typed', async () => {
    const { component, findByRole, getAllByRole } = render(RichTextEditor, {
      content: null,
      mentionUsers: [ada, alan, zed],
    });
    await tick();

    component.getEditor()!.commands.insertContent('@ala');
    await findByRole('listbox', { name: 'Mention a person' });

    await waitFor(() =>
      expect(getAllByRole('option').map((option) => option.textContent?.trim())).toEqual([
        expect.stringContaining('Alan Turing'),
      ])
    );
  });

  it('inserts the highlighted mention on Enter after ArrowDown', async () => {
    const { component, findByRole } = render(RichTextEditor, {
      content: null,
      mentionUsers: [ada, alan],
    });
    await tick();

    const editor = component.getEditor()!;
    editor.commands.insertContent('@a');
    await findByRole('listbox');
    await waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(2));

    const dom = editor.view.dom;
    await fireEvent.keyDown(dom, { key: 'ArrowDown' });
    await fireEvent.keyDown(dom, { key: 'Enter' });

    expect(insertedMentionAttrs(editor)).toMatchObject({ id: alan.id, label: alan.name });
  });

  it('inserts the mention that was clicked', async () => {
    const { component, findByRole, getAllByRole } = render(RichTextEditor, {
      content: null,
      mentionUsers: [ada, alan],
    });
    await tick();

    const editor = component.getEditor()!;
    editor.commands.insertContent('@a');
    await findByRole('listbox');
    await waitFor(() => expect(getAllByRole('option')).toHaveLength(2));

    await fireEvent.click(getAllByRole('option')[0]);

    expect(insertedMentionAttrs(editor)).toMatchObject({ id: ada.id, label: ada.name });
  });

  it('closes the menu on Escape without inserting', async () => {
    const { component, findByRole, queryByRole } = render(RichTextEditor, {
      content: null,
      mentionUsers: [ada, alan],
    });
    await tick();

    const editor = component.getEditor()!;
    editor.commands.insertContent('@a');
    await findByRole('listbox');

    await fireEvent.keyDown(editor.view.dom, { key: 'Escape' });

    await waitFor(() => expect(queryByRole('listbox')).toBeNull());
    expect(JSON.stringify(editor.getJSON())).not.toContain('mention');
  });

  it('offers nothing until the project’s people arrive, then offers them', async () => {
    const { component, rerender, findByRole, getAllByRole, queryByRole } = render(RichTextEditor, {
      content: null,
      mentionUsers: [],
    });
    await tick();

    const editor = component.getEditor()!;
    editor.commands.insertContent('@a');
    await settleSuggestion();
    expect(queryByRole('listbox')).toBeNull();

    await rerender({ content: null, mentionUsers: [ada, alan] });
    editor.commands.insertContent('l');
    await findByRole('listbox');
    await waitFor(() =>
      expect(getAllByRole('option').map((option) => option.textContent?.trim())).toEqual([
        expect.stringContaining('Alan Turing'),
      ])
    );
  });

  it('offers nothing when the query matches nobody', async () => {
    const { component, findByRole, getAllByRole, queryByRole } = render(RichTextEditor, {
      content: null,
      mentionUsers: [ada, alan],
    });
    await tick();

    const editor = component.getEditor()!;
    editor.commands.insertContent('@zzzz');
    await settleSuggestion();
    expect(queryByRole('listbox')).toBeNull();

    editor.commands.insertContent(' @a');
    await findByRole('listbox');
    await waitFor(() => expect(getAllByRole('option')).toHaveLength(2));
  });

  it('closes the menu when the editor loses focus', async () => {
    const { component, findByRole, queryByRole } = render(RichTextEditor, {
      content: null,
      mentionUsers: [ada, alan],
    });
    await tick();

    const editor = component.getEditor()!;
    editor.commands.insertContent('@a');
    await findByRole('listbox');

    await fireEvent.blur(editor.view.dom);

    await waitFor(() => expect(queryByRole('listbox')).toBeNull());
  });

  it('scrolls the highlighted row into view when it is past the visible rows', async () => {
    const scrolled: Element[] = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element
    ) {
      scrolled.push(this);
    });
    try {
      const { component, findByRole, getAllByRole } = render(RichTextEditor, {
        content: null,
        mentionUsers: manyUsers,
      });
      await tick();

      const editor = component.getEditor()!;
      editor.commands.insertContent('@Person');
      await findByRole('listbox');
      await waitFor(() => expect(getAllByRole('option')).toHaveLength(manyUsers.length));

      for (let i = 0; i < 6; i += 1) {
        await fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
      }

      const options = getAllByRole('option');
      expect(options[6]).toHaveAttribute('aria-selected', 'true');
      expect(scrolled).toContain(options[6]);
    } finally {
      spy.mockRestore();
    }
  });

  it('points the editor at the highlighted option for assistive tech', async () => {
    const { component, findByRole, getAllByRole } = render(RichTextEditor, {
      content: null,
      mentionUsers: [ada, alan],
    });
    await tick();

    const editor = component.getEditor()!;
    editor.commands.insertContent('@a');
    const menu = await findByRole('listbox');
    await waitFor(() => expect(getAllByRole('option')).toHaveLength(2));

    const [first, second] = getAllByRole('option');
    expect(editor.view.dom).toHaveAttribute('aria-controls', menu.id);
    expect(editor.view.dom).toHaveAttribute('aria-activedescendant', first.id);

    await fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(editor.view.dom).toHaveAttribute('aria-activedescendant', second.id)
    );

    await fireEvent.keyDown(editor.view.dom, { key: 'Escape' });
    await waitFor(() => expect(editor.view.dom).not.toHaveAttribute('aria-activedescendant'));
  });

  it('preserves a mention it was given, in JSON and through an HTML round trip', async () => {
    const { component, container } = render(RichTextEditor, {
      content: mentionDoc,
      readonly: true,
    });
    await tick();

    const editor = component.getEditor()!;
    expect(editor.getJSON().content?.[0].content?.[1]).toMatchObject({
      type: 'mention',
      attrs: { id: ada.id, label: 'Ada Lovelace' },
    });
    expect(container.querySelector('.tiptap')).toHaveTextContent('ask @Ada Lovelace');

    const html = editor.getHTML();
    expect(html).toContain('data-type="mention"');
    expect(html).toContain(`data-id="${ada.id}"`);

    editor.commands.setContent(html);
    expect(JSON.stringify(editor.getJSON())).toContain(`"id":"${ada.id}"`);
  });

  it('renders svg icons for the list buttons', async () => {
    const onSave = vi.fn();
    const { container, getByRole } = render(RichTextEditor, { content: null, onSave });
    await tick();
    await focusEditor(container);

    for (const name of ['Bullet list', 'Ordered list']) {
      const button = getByRole('button', { name });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button.querySelector('svg')).not.toBeNull();
    }
  });

  it('offers one heading button, which toggles a level 2 heading', async () => {
    const { component, container, getByRole, queryByRole } = render(RichTextEditor, {
      content: null,
      onSave: vi.fn(),
    });
    await tick();
    await focusEditor(container);

    for (const name of ['Heading 1', 'Heading 2', 'Heading 3']) {
      expect(queryByRole('button', { name })).toBeNull();
    }

    const editor = component.getEditor()!;
    editor.commands.insertContent('a title');
    await tick();

    const heading = getByRole('button', { name: 'Heading' });
    expect(heading).toHaveAttribute('aria-pressed', 'false');

    await fireEvent.click(heading);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
    });
    await waitFor(() => {
      expect(getByRole('button', { name: 'Heading' })).toHaveAttribute('aria-pressed', 'true');
    });

    await fireEvent.click(getByRole('button', { name: 'Heading' }));
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'paragraph' });
  });

  // The toolbar stopped offering h1 and h3, but documents still hold them: the
  // markdown importer writes them and a paste can carry them in.
  it('reads a legacy heading as pressed and clears it in one click', async () => {
    const { component, container, getByRole } = render(RichTextEditor, {
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'legacy' }] },
        ],
      },
      onSave: vi.fn(),
    });
    await tick();
    await focusEditor(container);

    expect(getByRole('button', { name: 'Heading' })).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.click(getByRole('button', { name: 'Heading' }));
    expect(component.getEditor()!.getJSON().content?.[0]).toMatchObject({ type: 'paragraph' });
  });

  // Fails the moment someone narrows StarterKit's heading levels to [2]: the
  // parse would flatten both to paragraphs and the render would coerce to h2,
  // while the markdown serializer still emits # and ###.
  it('still parses the heading levels the toolbar no longer offers', async () => {
    const { component, container } = render(RichTextEditor, { content: null, onSave: vi.fn() });
    await tick();

    const editor = component.getEditor()!;
    editor.commands.setContent('<h1>one</h1><h3>three</h3>');
    await tick();

    const doc = editor.getJSON();
    expect(doc.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(doc.content?.[1]).toMatchObject({ type: 'heading', attrs: { level: 3 } });
    expect(container.querySelector('h1')).toHaveTextContent('one');
    expect(container.querySelector('h3')).toHaveTextContent('three');
  });

  it('renders a compact body', async () => {
    const { container } = render(RichTextEditor, { content: null, compact: true });
    await tick();
    expect(container.querySelector('.rte-compact')).not.toBeNull();
  });
});
