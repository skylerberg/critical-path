import { describe, expect, it } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown, type TiptapDoc } from '../../src/markdown';
import { CliError, EXIT } from '../../src/api/errors';
import { findTiptapDocProblem } from '../../../api/src/schemas/tiptap';

const IMAGE_UUID = '123e4567-e89b-12d3-a456-426614174000';
const IMAGE_SRC = `/api/images/${IMAGE_UUID}`;
const MENTION_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const comprehensive = [
  '# Title',
  '',
  '## Section *two*',
  '',
  'Some **bold**, *italic*, ~~struck~~, `code`, and ***both*** text with a',
  '[link](https://example.com/page) and [mail](mailto:hi@example.com).',
  '',
  '- alpha',
  '- beta',
  '  - nested *item*',
  '- gamma',
  '',
  '3. third',
  '4. fourth',
  '',
  '> A quote with **bold**',
  '',
  '```ts',
  'const x: number = 1;',
  '```',
  '',
  '---',
  '',
  'line one\\',
  'line two',
  '',
  `![diagram](${IMAGE_SRC})`,
].join('\n');

interface Node {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: Node[];
}

function content(doc: TiptapDoc): Node[] {
  return (doc.content ?? []) as Node[];
}

function collect(nodes: Node[], type: string): Node[] {
  return nodes.flatMap((node) => [
    ...(node.type === type ? [node] : []),
    ...collect(node.content ?? [], type),
  ]);
}

describe('markdownToTiptap', () => {
  it('converts a comprehensive document to a valid Tiptap doc', () => {
    const doc = markdownToTiptap(comprehensive);
    expect(findTiptapDocProblem(doc)).toBeNull();

    const blocks = content(doc);
    expect(blocks[0]).toEqual({
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Title' }],
    });
    expect(blocks[1].type).toBe('heading');
    expect(blocks[1].attrs).toEqual({ level: 2 });

    const marked = blocks[2].content ?? [];
    const markSets = marked
      .filter((node) => node.marks)
      .map((node) => (node.marks ?? []).map((mark) => mark.type));
    expect(markSets).toContainEqual(['bold']);
    expect(markSets).toContainEqual(['italic']);
    expect(markSets).toContainEqual(['strike']);
    expect(markSets).toContainEqual(['code']);
    expect(markSets).toContainEqual(['italic', 'bold']);
    const links = marked.filter((node) => node.marks?.some((mark) => mark.type === 'link'));
    expect(links.map((node) => node.marks?.[0].attrs)).toEqual([
      { href: 'https://example.com/page' },
      { href: 'mailto:hi@example.com' },
    ]);

    const bullets = collect(blocks, 'bulletList');
    expect(bullets).toHaveLength(2);
    expect(bullets[0].content).toHaveLength(3);
    const ordered = collect(blocks, 'orderedList');
    expect(ordered).toHaveLength(1);
    expect(ordered[0].attrs).toEqual({ start: 3 });

    expect(collect(blocks, 'blockquote')).toHaveLength(1);
    expect(collect(blocks, 'codeBlock')).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const x: number = 1;' }],
      },
    ]);
    expect(collect(blocks, 'horizontalRule')).toHaveLength(1);
    expect(collect(blocks, 'hardBreak')).toHaveLength(1);
    expect(collect(blocks, 'image')).toEqual([
      { type: 'image', attrs: { src: IMAGE_SRC, alt: 'diagram', title: null } },
    ]);
  });

  it('round-trips stably: md -> doc -> md -> doc', () => {
    const doc = markdownToTiptap(comprehensive);
    expect(findTiptapDocProblem(doc)).toBeNull();
    const md2 = tiptapToMarkdown(doc);
    const doc2 = markdownToTiptap(md2);
    expect(findTiptapDocProblem(doc2)).toBeNull();
    expect(doc2).toEqual(doc);
  });

  it('normalizes an absolute image URL to its /api/images pathname', () => {
    const doc = markdownToTiptap(`![x](https://app.example.com${IMAGE_SRC})`);
    expect(findTiptapDocProblem(doc)).toBeNull();
    expect(content(doc)).toEqual([
      { type: 'image', attrs: { src: IMAGE_SRC, alt: 'x', title: null } },
    ]);
  });

  it('fails closed on GFM tables', () => {
    const table = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    expect(() => markdownToTiptap(table)).toThrowError(CliError);
    expect(() => markdownToTiptap(table)).toThrowError(/tables/);
    expect(() => markdownToTiptap(table)).toThrowError(/--description-json/);
  });

  it('fails closed on raw HTML', () => {
    expect(() => markdownToTiptap('<div>hi</div>')).toThrowError(CliError);
    expect(() => markdownToTiptap('<div>hi</div>')).toThrowError(/raw HTML/);
  });

  it('fails closed on raw HTML inside a paragraph rather than dropping the tag', () => {
    expect(() => markdownToTiptap('Ship it <br> now')).toThrowError(CliError);
    expect(() => markdownToTiptap('Ship it <br> now')).toThrowError(/raw HTML/);
    expect(() => markdownToTiptap('a <b>c</b>')).toThrowError(/raw HTML/);
  });

  it('fails closed on reference-style links, images and their definitions', () => {
    const link = ['see [the doc][ref]', '', '[ref]: https://example.com'].join('\n');
    expect(() => markdownToTiptap(link)).toThrowError(CliError);
    expect(() => markdownToTiptap(link)).toThrowError(/reference-style links/);

    const image = ['![x][ref]', '', `[ref]: ${IMAGE_SRC}`].join('\n');
    expect(() => markdownToTiptap(image)).toThrowError(CliError);
    expect(() => markdownToTiptap(image)).toThrowError(/reference-style images/);

    expect(() => markdownToTiptap('[ref]: https://example.com')).toThrowError(
      /link reference definitions/
    );
  });

  it('rejects an image inside a link', () => {
    const md = `[![x](${IMAGE_SRC})](https://example.com/page)`;
    expect(() => markdownToTiptap(md)).toThrowError(CliError);
    expect(() => markdownToTiptap(md)).toThrowError(/Images inside links/);
  });

  it('rejects an image inside a heading', () => {
    const md = `# Title ![x](${IMAGE_SRC})`;
    expect(() => markdownToTiptap(md)).toThrowError(CliError);
    expect(() => markdownToTiptap(md)).toThrowError(/Images inside headings/);
  });

  it('rejects image srcs that are not uploaded images', () => {
    const md = '![x](https://example.com/pic.png)';
    expect(() => markdownToTiptap(md)).toThrowError(CliError);
    expect(() => markdownToTiptap(md)).toThrowError(/cpath image upload/);
  });

  it('rejects link hrefs with disallowed protocols', () => {
    const md = '[files](ftp://example.com/files)';
    expect(() => markdownToTiptap(md)).toThrowError(CliError);
    expect(() => markdownToTiptap(md)).toThrowError(/http:, https:, or mailto:/);
  });

  it('reports CliError with the invalid exit code', () => {
    try {
      markdownToTiptap('<div>hi</div>');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(EXIT.invalid);
    }
  });

  it('rejects documents over the serialized size limit', () => {
    const big = 'word '.repeat(30000);
    expect(() => markdownToTiptap(big)).toThrowError(CliError);
    expect(() => markdownToTiptap(big)).toThrowError(/102400/);
  });

  it('rejects markdown nested beyond the depth limit', () => {
    const deep = '> '.repeat(120) + 'x';
    expect(() => markdownToTiptap(deep)).toThrowError(CliError);
    expect(() => markdownToTiptap(deep)).toThrowError(/deep/);
  });

  it('converts empty and whitespace-only markdown to an empty valid doc', () => {
    for (const input of ['', '   \n \n']) {
      const doc = markdownToTiptap(input);
      expect(doc).toEqual({ type: 'doc', content: [] });
      expect(findTiptapDocProblem(doc)).toBeNull();
    }
  });
});

describe('tiptapToMarkdown', () => {
  it('serializes an empty doc to an empty string', () => {
    expect(tiptapToMarkdown({ type: 'doc', content: [] })).toBe('');
    expect(tiptapToMarkdown({ type: 'doc' })).toBe('');
  });

  it('tolerates unknown extra attrs and odd heading levels', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 99, textAlign: 'left' },
          content: [{ type: 'text', text: 'Hi' }],
        },
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            {
              type: 'text',
              text: 'go',
              marks: [{ type: 'link', attrs: { href: 'https://x.dev', rel: 'noopener' } }],
            },
            { type: 'hardBreak', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    };
    expect(findTiptapDocProblem(doc)).toBeNull();
    const md = tiptapToMarkdown(doc);
    expect(md).toContain('###### Hi');
    expect(md).toContain('[go](https://x.dev)');
  });

  it('renders a mention as @label, in a paragraph and in a list item', () => {
    const mention = { type: 'mention', attrs: { id: MENTION_UUID, label: 'Alice' } };
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'cc ' }, mention, { type: 'text', text: ' please' }],
        },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [mention] }] }],
        },
      ],
    };
    expect(findTiptapDocProblem(doc)).toBeNull();
    const md = tiptapToMarkdown(doc);
    expect(md).toContain('cc @Alice please');
    expect(md).toContain('- @Alice');
  });

  it('renders a mention the server accepts outside a paragraph', () => {
    const mention = { type: 'mention', attrs: { id: MENTION_UUID, label: 'Alice' } };
    const doc = {
      type: 'doc',
      content: [
        mention,
        { type: 'bulletList', content: [{ type: 'listItem', content: [mention] }] },
        { type: 'blockquote', content: [mention] },
        { type: 'codeBlock', content: [mention] },
      ],
    };
    expect(findTiptapDocProblem(doc)).toBeNull();
    const md = tiptapToMarkdown(doc);
    expect(md).toContain('@Alice');
    expect(md).toContain('- @Alice');
    expect(md).toContain('> @Alice');
    expect(md).toContain('```\n@Alice\n```');
  });

  it('renders a mention with no usable label as a bare @', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: MENTION_UUID } }] }],
    };
    expect(tiptapToMarkdown(doc)).toBe('@');
  });

  it('loses the mention on a markdown round trip', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: MENTION_UUID, label: 'Alice' } }],
        },
      ],
    };
    const reparsed = markdownToTiptap(tiptapToMarkdown(doc));
    expect(collect(content(reparsed), 'mention')).toEqual([]);
    expect(collect(content(reparsed), 'text').map((node) => node.text)).toEqual(['@Alice']);
  });

  it('does not throw on loosely structured docs that pass the validator', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'text', text: 'bare text' },
        { type: 'image', attrs: { src: IMAGE_SRC, alt: '', title: null } },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
      ],
    };
    expect(findTiptapDocProblem(doc)).toBeNull();
    expect(() => tiptapToMarkdown(doc)).not.toThrow();
  });
});
