import { describe, it, expect } from 'vitest';
import { type } from 'arktype';
import {
  tiptapDocSchema,
  nullableTiptapDocSchema,
  findTiptapDocProblem,
  isEmptyTiptapDoc,
  MENTION_LABEL_MAX_LENGTH,
  TIPTAP_MAX_SERIALIZED_BYTES,
  type TiptapDoc,
} from '../../../src/schemas/tiptap';

const imageId = '550e8400-e29b-41d4-a716-446655440000';
const userId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const mentionAttrs = { id: userId, label: 'Alice' };

function doc(content: unknown[]): { type: 'doc'; content: unknown[] } {
  return { type: 'doc', content };
}

function text(value: string, marks?: unknown[]): Record<string, unknown> {
  return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
}

function paragraph(...content: unknown[]): Record<string, unknown> {
  return { type: 'paragraph', content };
}

function expectRejected(input: unknown, messagePart: string): void {
  const result = tiptapDocSchema(input);
  expect(result).toBeInstanceOf(type.errors);
  expect(String(result)).toContain(messagePart);
}

describe('tiptapDocSchema', () => {
  it('accepts a document using every allowed node and mark type', () => {
    const input = doc([
      { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
      paragraph(
        text('bold', [{ type: 'bold' }]),
        text('italic', [{ type: 'italic' }]),
        text('strike', [{ type: 'strike' }]),
        text('code', [{ type: 'code' }]),
        text('site', [{ type: 'link', attrs: { href: 'https://example.com/a' } }]),
        text('plain http', [{ type: 'link', attrs: { href: 'http://example.com' } }]),
        text('mail', [{ type: 'link', attrs: { href: 'mailto:a@example.com' } }]),
        { type: 'hardBreak' }
      ),
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [paragraph(text('item'))] }],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [{ type: 'listItem', content: [paragraph(text('first'))] }],
      },
      { type: 'blockquote', content: [paragraph(text('quoted'))] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const x = 1;')] },
      { type: 'horizontalRule' },
      { type: 'image', attrs: { src: `/api/images/${imageId}`, alt: 'a diagram' } },
    ]);

    const result = tiptapDocSchema(input);
    expect(result).not.toBeInstanceOf(type.errors);
    expect(result).toEqual(input);
  });

  it('accepts an empty document', () => {
    expect(tiptapDocSchema({ type: 'doc' })).toEqual({ type: 'doc' });
    expect(tiptapDocSchema(doc([]))).toEqual(doc([]));
  });

  it('rejects a javascript: link href', () => {
    expectRejected(
      doc([paragraph(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))]),
      'link href'
    );
  });

  it('rejects a link mark without an href', () => {
    expectRejected(doc([paragraph(text('x', [{ type: 'link' }]))]), 'link href');
  });

  it('rejects an off-origin image src', () => {
    expectRejected(
      doc([{ type: 'image', attrs: { src: 'https://evil.example/x.png' } }]),
      'image src'
    );
  });

  it('rejects an image src that is not an /api/images/<uuid> path', () => {
    for (const src of [
      '/api/images/not-a-uuid',
      `/api/images/${imageId}/extra`,
      `//evil.example/api/images/${imageId}`,
      '/api/images/',
    ]) {
      expectRejected(doc([{ type: 'image', attrs: { src } }]), 'image src');
    }
  });

  it('rejects an image without a src', () => {
    expectRejected(doc([{ type: 'image' }]), 'image src');
  });

  it('accepts a mention, including the extra attr the editor always writes', () => {
    const input = doc([
      paragraph(
        text('cc '),
        { type: 'mention', attrs: { id: userId, label: 'Alice' } },
        { type: 'mention', attrs: { id: userId, label: 'Alice', mentionSuggestionChar: '@' } }
      ),
    ]);
    expect(tiptapDocSchema(input)).toEqual(input);
  });

  it('accepts a mention nested in a list item and in a blockquote', () => {
    const nested = doc([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph({ type: 'mention', attrs: mentionAttrs })] },
        ],
      },
      { type: 'blockquote', content: [paragraph({ type: 'mention', attrs: mentionAttrs })] },
    ]);
    expect(tiptapDocSchema(nested)).toEqual(nested);
  });

  it('rejects a mention without a user id', () => {
    expectRejected(doc([paragraph({ type: 'mention' })]), 'mention attrs.id');
    expectRejected(doc([paragraph({ type: 'mention', attrs: { label: 'Alice' } })]), 'attrs.id');
    expectRejected(
      doc([paragraph({ type: 'mention', attrs: { id: 'alice', label: 'Alice' } })]),
      'attrs.id'
    );
  });

  it('rejects a mention whose label is missing, empty, or too long', () => {
    for (const label of [undefined, '', 42, 'a'.repeat(MENTION_LABEL_MAX_LENGTH + 1)]) {
      expectRejected(doc([paragraph({ type: 'mention', attrs: { id: userId, label } })]), 'label');
    }
    const longest = { id: userId, label: 'a'.repeat(MENTION_LABEL_MAX_LENGTH) };
    expect(tiptapDocSchema(doc([paragraph({ type: 'mention', attrs: longest })]))).toEqual(
      doc([paragraph({ type: 'mention', attrs: longest })])
    );
  });

  it('rejects a mention carrying text', () => {
    expectRejected(
      doc([paragraph({ type: 'mention', attrs: mentionAttrs, text: '@Alice' })]),
      'only text nodes'
    );
  });

  it('rejects unknown node types', () => {
    expectRejected(doc([{ type: 'iframe' }]), 'unknown node type "iframe"');
  });

  it('rejects unknown mark types', () => {
    expectRejected(doc([paragraph(text('x', [{ type: 'underline' }]))]), 'unknown mark type');
  });

  it('rejects unknown keys on nodes', () => {
    expectRejected(doc([{ type: 'paragraph', onClick: 'alert(1)' }]), 'unknown key "onClick"');
  });

  it('rejects a nested doc node', () => {
    expectRejected(doc([doc([])]), 'nested doc');
  });

  it('rejects a non-doc root', () => {
    expect(tiptapDocSchema({ type: 'paragraph' })).toBeInstanceOf(type.errors);
  });

  it('rejects a text property on non-text nodes', () => {
    expectRejected(doc([{ type: 'paragraph', text: 'x' }]), 'only text nodes');
  });

  it('rejects a text node without a text string', () => {
    expectRejected(doc([paragraph({ type: 'text' })]), 'text must be a string');
  });

  it('rejects a document over the serialized size cap', () => {
    const oversized = doc([paragraph(text('a'.repeat(TIPTAP_MAX_SERIALIZED_BYTES)))]);
    expectRejected(oversized, 'maximum is');
    expect(String(tiptapDocSchema(oversized)).length).toBeLessThan(1000);
  });

  it('rejects nesting deeper than the depth cap', () => {
    let node: Record<string, unknown> = paragraph(text('deep'));
    for (let i = 0; i < 105; i++) {
      node = { type: 'blockquote', content: [node] };
    }
    expectRejected(doc([node]), 'nesting depth');
  });

  it('rejects null and non-object input', () => {
    expect(tiptapDocSchema(null)).toBeInstanceOf(type.errors);
    expect(tiptapDocSchema('doc')).toBeInstanceOf(type.errors);
    expect(tiptapDocSchema([])).toBeInstanceOf(type.errors);
  });
});

describe('nullableTiptapDocSchema', () => {
  it('accepts null', () => {
    expect(nullableTiptapDocSchema(null)).toBeNull();
  });

  it('accepts a valid document', () => {
    const input = doc([paragraph(text('hello'))]);
    expect(nullableTiptapDocSchema(input)).toEqual(input);
  });

  it('still rejects invalid documents', () => {
    expect(nullableTiptapDocSchema(doc([{ type: 'iframe' }]))).toBeInstanceOf(type.errors);
  });
});

describe('findTiptapDocProblem', () => {
  it('returns null for a valid document', () => {
    expect(findTiptapDocProblem(doc([paragraph(text('ok'))]))).toBeNull();
  });

  it('names the path of the offending node', () => {
    const problem = findTiptapDocProblem(
      doc([paragraph(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))])
    );
    expect(problem).toContain('doc.content[0].content[0].marks[0]');
  });
});

describe('isEmptyTiptapDoc', () => {
  const asDoc = (input: unknown): TiptapDoc => input as TiptapDoc;

  it('treats a document with no content as empty', () => {
    expect(isEmptyTiptapDoc(asDoc({ type: 'doc' }))).toBe(true);
  });

  it('treats a lone empty paragraph as empty', () => {
    expect(isEmptyTiptapDoc(asDoc(doc([{ type: 'paragraph' }])))).toBe(true);
  });

  it('treats whitespace-only text as empty', () => {
    expect(isEmptyTiptapDoc(asDoc(doc([paragraph(text('   \n\t'))])))).toBe(true);
  });

  it('treats text as non-empty', () => {
    expect(isEmptyTiptapDoc(asDoc(doc([paragraph(text('hi'))])))).toBe(false);
  });

  it('treats a nested image as non-empty', () => {
    const nested = doc([
      {
        type: 'blockquote',
        content: [{ type: 'image', attrs: { src: `/api/images/${imageId}` } }],
      },
    ]);
    expect(isEmptyTiptapDoc(asDoc(nested))).toBe(false);
  });

  it('treats a horizontal rule as non-empty', () => {
    expect(isEmptyTiptapDoc(asDoc(doc([{ type: 'horizontalRule' }])))).toBe(false);
  });

  it('treats a mention as non-empty, alone or beside whitespace', () => {
    const mention = { type: 'mention', attrs: mentionAttrs };
    expect(isEmptyTiptapDoc(asDoc(doc([paragraph(mention)])))).toBe(false);
    expect(isEmptyTiptapDoc(asDoc(doc([paragraph(mention, text(' '))])))).toBe(false);
  });
});
