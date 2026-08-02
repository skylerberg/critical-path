import type { components } from '../api/api.generated';
import { mentionLabel } from './mentions';

type TiptapDoc = components['schemas']['TiptapDoc'];
type Node = Record<string, unknown>;

interface Block {
  text: string;
  paragraph: boolean;
}

interface InlineItem {
  node: Node;
  marks: Node[];
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childrenOf(node: Node): Node[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : [];
}

function attrsOf(node: Node): Node {
  return isNode(node.attrs) ? node.attrs : {};
}

function marksOf(node: Node): Node[] {
  return Array.isArray(node.marks) ? node.marks.filter(isNode) : [];
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// A mention is an atom carrying no text of its own, and a rule or an image is
// content the reader can see, so none of them may count as an empty document.
function hasVisibleContent(nodes: Node[]): boolean {
  return nodes.some((node) => {
    if (node.type === 'image' || node.type === 'horizontalRule' || node.type === 'mention') {
      return true;
    }
    if (typeof node.text === 'string') {
      return node.text.trim() !== '';
    }
    return hasVisibleContent(childrenOf(node));
  });
}

export function isEmptyDoc(doc: TiptapDoc | null | undefined): boolean {
  return doc == null || !hasVisibleContent(childrenOf(doc as Node));
}

function escapeInline(text: string): string {
  return text.replace(/[\\`*_~[\]<&]/g, (character) => `\\${character}`);
}

// Markdown has no backslash escape for whitespace, so a leading one — which would
// otherwise open an indented code block — leaves as a character reference instead.
function escapeLineStarts(text: string): string {
  return text
    .replace(/^([ \t]*)([#>+\-=])/gm, '$1\\$2')
    .replace(/^([ \t]*\d+)([.)])/gm, '$1\\$2')
    .replace(/^[ \t]/gm, (character) => (character === '\t' ? '&#x9;' : '&#x20;'));
}

// Markdown cannot nest anything inside inline code, so the code mark is forced
// innermost before adjacent runs are grouped.
function inlineItem(node: Node): InlineItem {
  const marks = node.type === 'text' ? marksOf(node) : [];
  return {
    node,
    marks: [
      ...marks.filter((mark) => mark.type !== 'code'),
      ...marks.filter((mark) => mark.type === 'code'),
    ],
  };
}

function markKey(mark: Node): string {
  const attrs = attrsOf(mark);
  const entries = Object.keys(attrs)
    .sort()
    .map((key) => [key, attrs[key]]);
  return `${stringOf(mark.type)}:${JSON.stringify(entries)}`;
}

function rawText(node: Node): string {
  if (typeof node.text === 'string') {
    return node.text;
  }
  return childrenOf(node).map(rawText).join('');
}

function codeSpan(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
  const padded =
    value.startsWith('`') ||
    value.endsWith('`') ||
    (value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '');
  const pad = padded ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}

function target(url: string): string {
  if (url === '' || /[\s<>]/.test(url)) {
    return `<${url.replace(/[<>]/g, '')}>`;
  }
  return url.replace(/[()]/g, (character) => `\\${character}`);
}

function image(node: Node): string {
  const attrs = attrsOf(node);
  // The src stays relative: only a relative capability URL can be saved back.
  return `![${escapeInline(stringOf(attrs.alt))}](${target(stringOf(attrs.src))})`;
}

function wrapMark(mark: Node, inner: string): string {
  switch (mark.type) {
    case 'bold':
      return `**${inner}**`;
    case 'italic':
      return `*${inner}*`;
    case 'strike':
      return `~~${inner}~~`;
    case 'link':
      return `[${inner}](${target(stringOf(attrsOf(mark).href))})`;
    default:
      return inner;
  }
}

function inlineFrom(items: InlineItem[], depth: number, lineBreak: string): string {
  let out = '';
  let i = 0;
  while (i < items.length) {
    const { node, marks } = items[i]!;
    if (node.type === 'hardBreak') {
      out += lineBreak;
      i += 1;
      continue;
    }
    if (node.type === 'image') {
      out += image(node);
      i += 1;
      continue;
    }
    if (node.type === 'mention') {
      out += escapeInline(`@${mentionLabel(attrsOf(node))}`);
      i += 1;
      continue;
    }
    if (node.type !== 'text') {
      out += inlineFrom(childrenOf(node).map(inlineItem), depth, lineBreak);
      i += 1;
      continue;
    }
    if (marks.length <= depth) {
      out += escapeInline(stringOf(node.text));
      i += 1;
      continue;
    }
    const mark = marks[depth]!;
    const key = markKey(mark);
    let end = i + 1;
    while (end < items.length) {
      const next = items[end]!;
      if (next.node.type !== 'text' || next.marks.length <= depth) break;
      if (markKey(next.marks[depth]!) !== key) break;
      end += 1;
    }
    const run = items.slice(i, end);
    out +=
      mark.type === 'code'
        ? codeSpan(run.map((item) => stringOf(item.node.text)).join(''))
        : wrapMark(mark, inlineFrom(run, depth + 1, lineBreak));
    i = end;
  }
  return out;
}

function inlineOf(nodes: Node[], lineBreak = '\\\n'): string {
  return inlineFrom(nodes.map(inlineItem), 0, lineBreak);
}

function prefixLines(text: string, first: string, rest: string): string {
  return text
    .split('\n')
    .map((line, index) => `${index === 0 ? first : rest}${line}`.trimEnd())
    .join('\n');
}

// A blank line between two paragraphs of the same item, and none anywhere else:
// any other blank line makes the whole list loose.
function joinItemBlocks(blocks: Block[]): string {
  return blocks.reduce(
    (text, block, index) =>
      index === 0
        ? block.text
        : `${text}${block.paragraph && blocks[index - 1]!.paragraph ? '\n\n' : '\n'}${block.text}`,
    ''
  );
}

function listFrom(node: Node, ordered: boolean): string {
  const start = attrsOf(node).start;
  let counter = typeof start === 'number' && Number.isFinite(start) ? Math.round(start) : 1;
  return childrenOf(node)
    .map((child) => {
      const marker = ordered ? `${counter++}.` : '-';
      const blocks = child.type === 'listItem' ? blocksOf(childrenOf(child)) : blocksOf([child]);
      return prefixLines(joinItemBlocks(blocks), `${marker} `, ' '.repeat(marker.length + 1));
    })
    .join('\n');
}

function codeBlockFrom(node: Node): string {
  const value = childrenOf(node).map(rawText).join('');
  const runs = value.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, Math.max(0, ...runs.map((run) => run.length)) + 1));
  const language = stringOf(attrsOf(node).language);
  return `${fence}${language}\n${value}\n${fence}`;
}

// A heading is a single line, so a break inside it can only become a space; a
// trailing hash would otherwise be eaten as the heading's closing sequence.
function headingFrom(node: Node): string {
  const level = attrsOf(node).level;
  const depth = typeof level === 'number' && Number.isFinite(level) ? Math.round(level) : 1;
  const hashes = '#'.repeat(Math.min(6, Math.max(1, depth)));
  const text = inlineOf(childrenOf(node), ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/#$/, '\\#')
    .trim();
  return text === '' ? hashes : `${hashes} ${text}`;
}

function blocksOf(nodes: Node[]): Block[] {
  const blocks: Block[] = [];
  let inline: Node[] = [];
  const flush = (): void => {
    if (inline.length > 0) {
      blocks.push({ text: escapeLineStarts(inlineOf(inline)), paragraph: true });
      inline = [];
    }
  };
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'hardBreak':
      case 'image':
      case 'mention':
        inline.push(node);
        continue;
      case 'paragraph':
        flush();
        blocks.push({ text: escapeLineStarts(inlineOf(childrenOf(node))), paragraph: true });
        continue;
      case 'heading':
        flush();
        blocks.push({ text: headingFrom(node), paragraph: false });
        continue;
      case 'bulletList':
      case 'orderedList':
        flush();
        blocks.push({ text: listFrom(node, node.type === 'orderedList'), paragraph: false });
        continue;
      case 'blockquote':
        flush();
        blocks.push({
          text: prefixLines(joinBlocks(blocksOf(childrenOf(node))), '> ', '> '),
          paragraph: false,
        });
        continue;
      case 'codeBlock':
        flush();
        blocks.push({ text: codeBlockFrom(node), paragraph: false });
        continue;
      case 'horizontalRule':
        flush();
        // Not dashes: directly under a list item's paragraph those would be read
        // as that paragraph's setext underline, losing both.
        blocks.push({ text: '***', paragraph: false });
        continue;
      default:
        // A stored snapshot can hold a node type this build never knew.
        flush();
        blocks.push(...blocksOf(childrenOf(node)));
    }
  }
  flush();
  return blocks;
}

function joinBlocks(blocks: Block[]): string {
  return blocks.map((block) => block.text).join('\n\n');
}

export function docToMarkdown(doc: TiptapDoc | null | undefined): string {
  if (doc == null) {
    return '';
  }
  return joinBlocks(blocksOf(childrenOf(doc as Node))).trimEnd();
}
