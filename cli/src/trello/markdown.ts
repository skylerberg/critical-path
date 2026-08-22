import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { markdownToTiptap, type TiptapDoc } from '../markdown/toTiptap';

const LINK_HREF_PATTERN = /^(https?:|mailto:)/;
const IMAGE_SRC = /^\/api\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only the three fields the neutraliser reads. The mdast types describe a far
// larger tree than a source-offset walk needs.
interface Positioned {
  type: string;
  position?: { start: { offset?: number } };
  url?: string;
  children?: Positioned[];
}

function parse(markdown: string): Positioned {
  return fromMarkdown(markdown, {
    extensions: [gfmStrikethrough()],
    mdastExtensions: [gfmStrikethroughFromMarkdown()],
  }) as unknown as Positioned;
}

// Where inserting a backslash turns a construct the converter refuses into the
// literal characters the author typed. Escaping the delimiter is what keeps the
// text itself intact: a Python traceback holding "[rule.endpoint](**req.view_args)"
// is not a link, and the faithful import is those characters, not a dropped card.
function escapePoint(node: Positioned): number | null {
  const start = node.position?.start.offset;
  if (start === undefined) return null;
  switch (node.type) {
    case 'html':
    case 'yaml':
      return start;
    case 'link':
      return typeof node.url === 'string' && !LINK_HREF_PATTERN.test(node.url) ? start : null;
    case 'image':
      // The "!" is decoration; escaping the bracket is what stops the link.
      return typeof node.url === 'string' && !IMAGE_SRC.test(node.url) ? start + 1 : null;
    case 'definition':
    case 'linkReference':
    case 'imageReference':
    case 'footnoteDefinition':
    case 'footnoteReference':
    case 'table':
      return start;
    default:
      return null;
  }
}

function collectEscapes(node: Positioned, found: number[]): void {
  const point = escapePoint(node);
  if (point !== null) found.push(point);
  for (const child of node.children ?? []) collectEscapes(child, found);
}

// Repeat because escaping changes how the rest of the line parses: neutralising
// the first of two adjacent HTML spans can be what reveals the second.
function neutralizeUnsupported(markdown: string): string {
  let current = markdown;
  for (let pass = 0; pass < 8; pass += 1) {
    const found: number[] = [];
    collectEscapes(parse(current), found);
    if (found.length === 0) return current;
    for (const offset of [...new Set(found)].sort((a, b) => b - a)) {
      current = `${current.slice(0, offset)}\\${current.slice(offset)}`;
    }
  }
  throw new Error('Markdown still holds unsupported constructs after 8 neutralisation passes');
}

export function rewriteImageSources(markdown: string, sources: Map<string, string>): string {
  let current = markdown;
  for (const [trelloUrl, imageSrc] of sources) {
    current = current.split(trelloUrl).join(imageSrc);
  }
  return current;
}

const MARKDOWN_SPECIAL = /[\\`*_{}[\]()#+\-.!<>|~]/g;

export function escapeInline(text: string): string {
  return text.replace(MARKDOWN_SPECIAL, (match) => `\\${match}`);
}

export function toDocument(markdown: string): TiptapDoc {
  return markdownToTiptap(neutralizeUnsupported(markdown));
}

// Two documents rather than two halves of one string: a card body that ends
// inside an unterminated code fence would otherwise swallow whatever is appended
// to it, and several of these descriptions are pasted stack traces.
export function concatDocuments(...docs: TiptapDoc[]): TiptapDoc {
  const content = docs.flatMap((doc) => doc.content ?? []);
  return content.length > 0 ? { type: 'doc', content } : { type: 'doc' };
}
