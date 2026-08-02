import { beforeEach, describe, expect, it } from 'vitest';
import { docToMarkdown, isEmptyDoc } from './tiptap';
import { users } from './users.svelte';

type Doc = Parameters<typeof docToMarkdown>[0];

function doc(...content: unknown[]): Doc {
  return { type: 'doc', content } as Doc;
}

function paragraph(...content: unknown[]): unknown {
  return { type: 'paragraph', content };
}

function text(value: string, ...marks: unknown[]): unknown {
  return marks.length === 0 ? { type: 'text', text: value } : { type: 'text', text: value, marks };
}

function item(...content: unknown[]): unknown {
  return { type: 'listItem', content };
}

beforeEach(() => {
  users.reset();
});

describe('docToMarkdown', () => {
  it('separates blocks with a blank line', () => {
    expect(docToMarkdown(doc(paragraph(text('first')), paragraph(text('second'))))).toBe(
      'first\n\nsecond'
    );
  });

  it('is empty for a document that is missing or has nothing in it', () => {
    expect(docToMarkdown(null)).toBe('');
    expect(docToMarkdown(undefined)).toBe('');
    expect(docToMarkdown(doc())).toBe('');
  });

  it('writes every block the editor can produce', () => {
    const markdown = docToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
        {
          type: 'bulletList',
          content: [item(paragraph(text('one'))), item(paragraph(text('two')))],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [item(paragraph(text('third'))), item(paragraph(text('fourth')))],
        },
        { type: 'blockquote', content: [paragraph(text('one')), paragraph(text('two'))] },
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [text('const a = *1*;\nconst b = 2;')],
        },
        { type: 'horizontalRule' },
        paragraph(text('line one'), { type: 'hardBreak' }, text('line two'))
      )
    );

    expect(markdown).toBe(
      [
        '## Title',
        '',
        '- one',
        '- two',
        '',
        '3. third',
        '4. fourth',
        '',
        '> one',
        '>',
        '> two',
        '',
        '```ts',
        'const a = *1*;',
        'const b = 2;',
        '```',
        '',
        '***',
        '',
        'line one\\',
        'line two',
      ].join('\n')
    );
  });

  it('indents what hangs under a list item by the width of its marker', () => {
    const markdown = docToMarkdown(
      doc({
        type: 'orderedList',
        attrs: { start: 9 },
        content: [
          item(paragraph(text('nine')), {
            type: 'bulletList',
            content: [item(paragraph(text('deep')))],
          }),
          item(paragraph(text('ten')), paragraph(text('and more'))),
        ],
      })
    );

    expect(markdown).toBe('9. nine\n   - deep\n10. ten\n\n    and more');
  });

  it('nests one block container inside another', () => {
    expect(
      docToMarkdown(
        doc({
          type: 'blockquote',
          content: [{ type: 'bulletList', content: [item(paragraph(text('inside')))] }],
        })
      )
    ).toBe('> - inside');
  });

  it('groups a run of adjacent text sharing a mark, and nests the rest', () => {
    expect(
      docToMarkdown(
        doc(
          paragraph(
            text('a ', { type: 'bold' }),
            text('b', { type: 'bold' }, { type: 'italic' }),
            text(' plain '),
            text('struck', { type: 'strike' }),
            text(' code', { type: 'code' })
          )
        )
      )
    ).toBe('**a *b*** plain ~~struck~~` code`');
  });

  it('puts the code mark innermost, whatever order it was stored in', () => {
    expect(docToMarkdown(doc(paragraph(text('x', { type: 'code' }, { type: 'bold' }))))).toBe(
      '**`x`**'
    );
  });

  it('lengthens the fence of inline code that holds a backtick, and pads it', () => {
    expect(docToMarkdown(doc(paragraph(text('a ` b', { type: 'code' }))))).toBe('``a ` b``');
    expect(docToMarkdown(doc(paragraph(text('`x`', { type: 'code' }))))).toBe('`` `x` ``');
    expect(docToMarkdown(doc(paragraph(text(' y ', { type: 'code' }))))).toBe('`  y  `');
  });

  it('lengthens a code block fence that its own content would close', () => {
    expect(docToMarkdown(doc({ type: 'codeBlock', content: [text('a\n```\nb')] }))).toBe(
      '````\na\n```\nb\n````'
    );
  });

  it('escapes what would otherwise read as markup', () => {
    expect(
      docToMarkdown(
        doc(
          paragraph(text('# not a heading')),
          paragraph(text('- not a list')),
          paragraph(text('1. not ordered')),
          paragraph(text('> not a quote')),
          paragraph(text('=== not an underline')),
          paragraph(text('a * b _ c ~ d [e] f ` g \\ h'))
        )
      )
    ).toBe(
      [
        '\\# not a heading',
        '',
        '\\- not a list',
        '',
        '1\\. not ordered',
        '',
        '\\> not a quote',
        '',
        '\\=== not an underline',
        '',
        'a \\* b \\_ c \\~ d \\[e\\] f \\` g \\\\ h',
      ].join('\n')
    );
  });

  it('escapes what would otherwise read as HTML or as an entity', () => {
    expect(
      docToMarkdown(
        doc(
          paragraph(text('a <b>bold</b> tag')),
          paragraph(text('mail me at <a@b.com>')),
          paragraph(text('AT&amp;T &copy; 5 & 6'))
        )
      )
    ).toBe(
      [
        'a \\<b>bold\\</b> tag',
        '',
        'mail me at \\<a@b.com>',
        '',
        'AT\\&amp;T \\&copy; 5 \\& 6',
      ].join('\n')
    );
  });

  // Four of them open an indented code block, and no backslash can escape a space.
  it('replaces a leading space or tab, wherever the line sits', () => {
    expect(
      docToMarkdown(
        doc(
          paragraph(text('    indented?')),
          paragraph(text('\ttabbed?')),
          { type: 'bulletList', content: [item(paragraph(text('    in an item')))] },
          { type: 'blockquote', content: [paragraph(text('    in a quote'))] }
        )
      )
    ).toBe(
      [
        '&#x20;   indented?',
        '',
        '&#x9;tabbed?',
        '',
        '- &#x20;   in an item',
        '',
        '> &#x20;   in a quote',
      ].join('\n')
    );
  });

  it('keeps a rule under a list item from underlining it', () => {
    expect(
      docToMarkdown(
        doc({
          type: 'bulletList',
          content: [item(paragraph(text('one')), { type: 'horizontalRule' })],
        })
      )
    ).toBe('- one\n  ***');
  });

  it('flattens a break inside a heading and keeps a trailing hash', () => {
    expect(
      docToMarkdown(
        doc({
          type: 'heading',
          attrs: { level: 2 },
          content: [text('a'), { type: 'hardBreak' }, text('# b')],
        })
      )
    ).toBe('## a # b');
    expect(
      docToMarkdown(doc({ type: 'heading', attrs: { level: 3 }, content: [text('done #')] }))
    ).toBe('### done \\#');
    expect(docToMarkdown(doc({ type: 'heading', attrs: { level: 1 } }, paragraph(text('a'))))).toBe(
      '#\n\na'
    );
  });

  it('drops the blank block a trailing empty paragraph would leave', () => {
    expect(docToMarkdown(doc(paragraph(text('a')), paragraph()))).toBe('a');
  });

  it('keeps two adjacent links pointing where each of them pointed', () => {
    expect(
      docToMarkdown(
        doc(
          paragraph(
            text('one', { type: 'link', attrs: { href: 'https://a.example' } }),
            text('two', { type: 'link', attrs: { href: 'https://b.example' } })
          )
        )
      )
    ).toBe('[one](https://a.example)[two](https://b.example)');
  });

  it('escapes a line the previous line broke onto, and none inside code', () => {
    expect(docToMarkdown(doc(paragraph(text('one'), { type: 'hardBreak' }, text('# two'))))).toBe(
      'one\\\n\\# two'
    );
    expect(docToMarkdown(doc(paragraph(text('a * b', { type: 'code' }))))).toBe('`a * b`');
    expect(docToMarkdown(doc({ type: 'codeBlock', content: [text('- a * b')] }))).toBe(
      '```\n- a * b\n```'
    );
  });

  it('holds a link target that spaces or brackets would break out of', () => {
    expect(
      docToMarkdown(
        doc(
          paragraph(text('see ', { type: 'link', attrs: { href: 'https://example.com/a(b)' } })),
          paragraph(text('go', { type: 'link', attrs: { href: 'https://example.com/a b' } }))
        )
      )
    ).toBe('[see ](https://example.com/a\\(b\\))\n\n[go](<https://example.com/a b>)');
  });

  // The editor's image node is block-level, so a screenshot sits beside the
  // paragraphs rather than inside one.
  it('keeps an image src relative and escapes its alt text', () => {
    expect(
      docToMarkdown(doc({ type: 'image', attrs: { src: '/api/images/abc', alt: 'a [b] c' } }))
    ).toBe('![a \\[b\\] c](/api/images/abc)');
    expect(
      docToMarkdown(
        doc(
          paragraph(text('before')),
          { type: 'image', attrs: { src: '/api/images/a' } },
          paragraph(text('after'))
        )
      )
    ).toBe('before\n\n![](/api/images/a)\n\nafter');
  });

  it('writes a mention as the name it renders under', () => {
    users.users = [{ id: 'u1', name: 'Ada Byron', avatar_url: null }];

    expect(
      docToMarkdown(
        doc(
          paragraph(text('ask '), { type: 'mention', attrs: { id: 'u1', label: 'Ada Lovelace' } }),
          paragraph({ type: 'mention', attrs: { id: 'u9', label: 'A*B' } })
        )
      )
    ).toBe('ask @Ada Byron\n\n@A\\*B');
  });

  it('carries the content of a node type it does not know', () => {
    expect(
      docToMarkdown(doc({ type: 'callout', content: [paragraph(text('still worth reading'))] }))
    ).toBe('still worth reading');
  });
});

describe('isEmptyDoc', () => {
  it('is empty for nothing, for no blocks and for blank text', () => {
    expect(isEmptyDoc(null)).toBe(true);
    expect(isEmptyDoc(undefined)).toBe(true);
    expect(isEmptyDoc(doc())).toBe(true);
    expect(isEmptyDoc(doc(paragraph()))).toBe(true);
    expect(isEmptyDoc(doc(paragraph(text('   '))))).toBe(true);
  });

  it('counts content that carries no text of its own', () => {
    expect(isEmptyDoc(doc({ type: 'image', attrs: { src: '/api/images/a' } }))).toBe(false);
    expect(isEmptyDoc(doc({ type: 'horizontalRule' }))).toBe(false);
    expect(isEmptyDoc(doc(paragraph({ type: 'mention', attrs: { id: 'u1', label: 'Ada' } })))).toBe(
      false
    );
  });

  it('finds text however deeply it is nested', () => {
    expect(
      isEmptyDoc(doc({ type: 'bulletList', content: [item(paragraph(text('buried')))] }))
    ).toBe(false);
  });
});
