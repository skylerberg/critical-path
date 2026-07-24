import '../api/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import RichTextEditor from './RichTextEditor.svelte';

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
