import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import type { Image, Paragraph, PhrasingContent, RootContent } from 'mdast';
import { CliError, EXIT } from '../api/errors';

export interface TiptapDoc {
  type: 'doc';
  content?: unknown[];
}

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TiptapNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
}

const MAX_SERIALIZED_BYTES = 100 * 1024;
const MAX_DEPTH = 100;
const LINK_HREF_PATTERN = /^(https?:|mailto:)/;
const IMAGE_SRC_PREFIX = '/api/images/';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE_DELIMITER_ROW = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

const CONSTRUCT_NAMES: Record<string, string> = {
  html: 'raw HTML',
  table: 'tables',
  tableRow: 'tables',
  tableCell: 'tables',
  definition: 'link reference definitions',
  linkReference: 'reference-style links',
  imageReference: 'reference-style images',
  footnoteDefinition: 'footnotes',
  footnoteReference: 'footnotes',
  yaml: 'frontmatter',
  math: 'math',
  inlineMath: 'math',
};

function invalid(message: string): CliError {
  return new CliError(message, EXIT.invalid);
}

function unsupported(type: string): CliError {
  const name = CONSTRUCT_NAMES[type] ?? `"${type}" syntax`;
  return invalid(
    `Unsupported Markdown: ${name}. Use --description-json to supply Tiptap JSON directly.`
  );
}

function ensureDepth(depth: number): void {
  if (depth > MAX_DEPTH) {
    throw invalid(`The description nests more than ${MAX_DEPTH} levels deep.`);
  }
}

function isAllowedImageSrc(src: string): boolean {
  return src.startsWith(IMAGE_SRC_PREFIX) && UUID_PATTERN.test(src.slice(IMAGE_SRC_PREFIX.length));
}

function normalizeImageSrc(src: string): string {
  if (isAllowedImageSrc(src)) {
    return src;
  }
  const parsed = URL.parse(src);
  if (parsed && isAllowedImageSrc(parsed.pathname)) {
    return parsed.pathname;
  }
  throw invalid(
    `Image src "${src}" must be an uploaded image (${IMAGE_SRC_PREFIX}<uuid>); ` +
      'upload it first with `cpath image upload` and use the returned URL.'
  );
}

function sameMark(a: TiptapMark, b: TiptapMark): boolean {
  return a.type === b.type && JSON.stringify(a.attrs ?? null) === JSON.stringify(b.attrs ?? null);
}

function withMark(marks: TiptapMark[], mark: TiptapMark): TiptapMark[] {
  return marks.some((existing) => sameMark(existing, mark)) ? marks : [...marks, mark];
}

function textNode(text: string, marks: TiptapMark[]): TiptapNode {
  return marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text };
}

interface InlineSink {
  node(node: TiptapNode): void;
  image(node: TiptapNode): void;
}

function walkInline(children: PhrasingContent[], marks: TiptapMark[], sink: InlineSink): void {
  for (const child of children) {
    switch (child.type) {
      case 'text':
        sink.node(textNode(child.value, marks));
        break;
      case 'inlineCode':
        sink.node(textNode(child.value, withMark(marks, { type: 'code' })));
        break;
      case 'strong':
        walkInline(child.children, withMark(marks, { type: 'bold' }), sink);
        break;
      case 'emphasis':
        walkInline(child.children, withMark(marks, { type: 'italic' }), sink);
        break;
      case 'delete':
        walkInline(child.children, withMark(marks, { type: 'strike' }), sink);
        break;
      case 'link':
        if (!LINK_HREF_PATTERN.test(child.url)) {
          throw invalid(
            `Link href "${child.url}" is not allowed; links must use http:, https:, or mailto:.`
          );
        }
        walkInline(
          child.children,
          withMark(marks, { type: 'link', attrs: { href: child.url } }),
          sink
        );
        break;
      case 'break':
        sink.node({ type: 'hardBreak' });
        break;
      case 'image':
        if (marks.some((mark) => mark.type === 'link')) {
          throw invalid('Images inside links are not supported; put the image on its own line.');
        }
        sink.image(imageNode(child));
        break;
      default:
        throw unsupported(child.type);
    }
  }
}

function imageNode(image: Image): TiptapNode {
  return {
    type: 'image',
    attrs: {
      src: normalizeImageSrc(image.url),
      alt: image.alt ?? '',
      title: image.title ?? null,
    },
  };
}

// The web editor's image node is block-level, so images split their paragraph
// and are hoisted to sibling blocks.
function paragraphBlocks(paragraph: Paragraph, depth: number): TiptapNode[] {
  ensureDepth(depth + 1);
  const blocks: TiptapNode[] = [];
  let inline: TiptapNode[] = [];
  const flush = () => {
    if (inline.length > 0) {
      blocks.push({ type: 'paragraph', content: inline });
      inline = [];
    }
  };
  walkInline(paragraph.children, [], {
    node: (node) => inline.push(node),
    image: (node) => {
      flush();
      blocks.push(node);
    },
  });
  flush();
  return blocks;
}

function headingContent(children: PhrasingContent[], depth: number): TiptapNode[] {
  ensureDepth(depth + 1);
  const content: TiptapNode[] = [];
  walkInline(children, [], {
    node: (node) => content.push(node),
    image: () => {
      throw invalid('Images inside headings are not supported; put the image on its own line.');
    },
  });
  return content;
}

// GFM tables are not parsed (the extension is off), so pipe tables would
// otherwise silently degrade to literal text instead of failing closed.
function rejectTableSyntax(paragraph: Paragraph, source: string): void {
  const start = paragraph.position?.start.offset;
  const end = paragraph.position?.end.offset;
  if (start === undefined || end === undefined) {
    return;
  }
  const lines = source
    .slice(start, end)
    .split('\n')
    .map((line) => line.replace(/^[\s>]+/, '').trimEnd());
  for (let i = 1; i < lines.length; i++) {
    if (
      lines[i - 1].includes('|') &&
      lines[i].includes('|') &&
      TABLE_DELIMITER_ROW.test(lines[i])
    ) {
      throw unsupported('table');
    }
  }
}

function convertBlocks(nodes: RootContent[], depth: number, source: string): TiptapNode[] {
  if (nodes.length === 0) {
    return [];
  }
  ensureDepth(depth);
  const blocks: TiptapNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
        rejectTableSyntax(node, source);
        blocks.push(...paragraphBlocks(node, depth));
        break;
      case 'heading':
        blocks.push({
          type: 'heading',
          attrs: { level: node.depth },
          content: headingContent(node.children, depth),
        });
        break;
      case 'blockquote':
        blocks.push({
          type: 'blockquote',
          content: convertBlocks(node.children, depth + 1, source),
        });
        break;
      case 'list': {
        const items = node.children.map((item): TiptapNode => {
          const content = convertBlocks(item.children, depth + 2, source);
          return {
            type: 'listItem',
            content: content.length > 0 ? content : [{ type: 'paragraph' }],
          };
        });
        blocks.push(
          node.ordered
            ? { type: 'orderedList', attrs: { start: node.start ?? 1 }, content: items }
            : { type: 'bulletList', content: items }
        );
        break;
      }
      case 'code': {
        ensureDepth(depth + 1);
        const block: TiptapNode = { type: 'codeBlock' };
        if (node.lang) {
          block.attrs = { language: node.lang };
        }
        if (node.value !== '') {
          block.content = [{ type: 'text', text: node.value }];
        }
        blocks.push(block);
        break;
      }
      case 'thematicBreak':
        blocks.push({ type: 'horizontalRule' });
        break;
      default:
        throw unsupported(node.type);
    }
  }
  return blocks;
}

export function markdownToTiptap(markdown: string): TiptapDoc {
  const tree = fromMarkdown(markdown, {
    extensions: [gfmStrikethrough()],
    mdastExtensions: [gfmStrikethroughFromMarkdown()],
  });
  const doc: TiptapDoc = { type: 'doc', content: convertBlocks(tree.children, 1, markdown) };
  const bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
  if (bytes > MAX_SERIALIZED_BYTES) {
    throw invalid(
      `The description serializes to ${bytes} bytes of Tiptap JSON; ` +
        `the maximum is ${MAX_SERIALIZED_BYTES} bytes. Shorten the description.`
    );
  }
  return doc;
}
