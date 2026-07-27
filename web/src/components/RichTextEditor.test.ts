import '../api/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Editor } from '@tiptap/core';
import type { User } from '../lib/users.svelte';
import RichTextEditor from './RichTextEditor.svelte';

function insertedMentionAttrs(editor: Editor): Record<string, unknown> | undefined {
  const doc = editor.getJSON() as {
    content?: Array<{ content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }>;
  };
  return doc.content?.[0].content?.find((node) => node.type === 'mention')?.attrs;
}

const ada: User = { id: 'u-ada', name: 'Ada Lovelace', email: 'ada@example.com', avatar_url: null };
const alan: User = {
  id: 'u-alan',
  name: 'Alan Turing',
  email: 'alan@example.com',
  avatar_url: null,
};
const zed: User = { id: 'u-zed', name: 'Zed', email: 'zed@example.com', avatar_url: null };

const mentionDoc = {
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

  it('starts from the provided doc and renders the toolbar', async () => {
    const onSave = vi.fn();
    const { component, getByRole } = render(RichTextEditor, {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'existing' }] }],
      },
      onSave,
    });
    await tick();

    expect(component.getEditor()!.getText()).toBe('existing');
    expect(getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
    expect(getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
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

  it('offers nothing when there are no candidates or none match', async () => {
    const { component, queryByRole } = render(RichTextEditor, { content: null, mentionUsers: [] });
    await tick();

    component.getEditor()!.commands.insertContent('@a');
    await tick();
    expect(queryByRole('listbox')).toBeNull();

    component.getEditor()!.commands.insertContent('nobodyhere');
    await tick();
    expect(queryByRole('listbox')).toBeNull();
  });

  it('preserves a mention it was given, in JSON and through an HTML round trip', async () => {
    const { component, container } = render(RichTextEditor, {
      content: mentionDoc as never,
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
    const { getByRole } = render(RichTextEditor, { content: null, onSave });
    await tick();

    for (const name of ['Bullet list', 'Ordered list']) {
      const button = getByRole('button', { name });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button.querySelector('svg')).not.toBeNull();
    }
  });
});
