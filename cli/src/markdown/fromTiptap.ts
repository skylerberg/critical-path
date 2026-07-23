import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmStrikethroughToMarkdown } from 'mdast-util-gfm-strikethrough';
import type { BlockContent, Heading, Image, List, ListItem, PhrasingContent, Root } from 'mdast';

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childrenOf(node: Rec): Rec[] {
  return Array.isArray(node.content) ? node.content.filter(isRec) : [];
}

function attrsOf(node: Rec): Rec {
  return isRec(node.attrs) ? node.attrs : {};
}

function marksOf(node: Rec): Rec[] {
  return Array.isArray(node.marks) ? node.marks.filter(isRec) : [];
}

function textContent(node: Rec): string {
  if (typeof node.text === 'string') {
    return node.text;
  }
  if (node.type === 'hardBreak') {
    return '\n';
  }
  return childrenOf(node).map(textContent).join('');
}

function markKey(mark: Rec): string {
  const attrs = isRec(mark.attrs) ? mark.attrs : {};
  const sorted = Object.keys(attrs)
    .sort()
    .map((key) => [key, attrs[key]]);
  return `${String(mark.type)}:${JSON.stringify(sorted)}`;
}

interface InlineItem {
  node: Rec;
  marks: Rec[];
}

// Inline code cannot nest other formatting in Markdown, so the code mark is
// forced innermost before runs are grouped.
function inlineItem(node: Rec): InlineItem {
  const marks = node.type === 'text' ? marksOf(node) : [];
  return {
    node,
    marks: [...marks.filter((m) => m.type !== 'code'), ...marks.filter((m) => m.type === 'code')],
  };
}

function imageFrom(node: Rec): Image {
  const attrs = attrsOf(node);
  return {
    type: 'image',
    url: typeof attrs.src === 'string' ? attrs.src : '',
    alt: typeof attrs.alt === 'string' ? attrs.alt : null,
    title: typeof attrs.title === 'string' ? attrs.title : null,
  };
}

function wrapMark(mark: Rec, children: PhrasingContent[]): PhrasingContent[] {
  switch (mark.type) {
    case 'bold':
      return [{ type: 'strong', children }];
    case 'italic':
      return [{ type: 'emphasis', children }];
    case 'strike':
      return [{ type: 'delete', children }];
    case 'link': {
      const attrs = isRec(mark.attrs) ? mark.attrs : {};
      return [
        {
          type: 'link',
          url: typeof attrs.href === 'string' ? attrs.href : '',
          title: typeof attrs.title === 'string' ? attrs.title : null,
          children,
        },
      ];
    }
    default:
      return children;
  }
}

// Consecutive nodes sharing a leading mark are grouped under one wrapper so
// runs like bold("a ") + bold-italic("b") serialize as **a *b*** rather than
// as adjacent emphasis runs, which would not reparse to the same document.
function phrasingFromItems(items: InlineItem[], depth: number): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    const node = item.node;
    if (node.type === 'hardBreak') {
      out.push({ type: 'break' });
      i++;
      continue;
    }
    if (node.type === 'image') {
      out.push(imageFrom(node));
      i++;
      continue;
    }
    if (node.type !== 'text') {
      const value = textContent(node);
      if (value !== '') {
        out.push({ type: 'text', value });
      }
      i++;
      continue;
    }
    if (item.marks.length <= depth) {
      out.push({ type: 'text', value: typeof node.text === 'string' ? node.text : '' });
      i++;
      continue;
    }
    const mark = item.marks[depth];
    const key = markKey(mark);
    let j = i + 1;
    while (
      j < items.length &&
      items[j].node.type === 'text' &&
      items[j].marks.length > depth &&
      markKey(items[j].marks[depth]) === key
    ) {
      j++;
    }
    const run = items.slice(i, j);
    if (mark.type === 'code') {
      out.push({
        type: 'inlineCode',
        value: run.map((r) => (typeof r.node.text === 'string' ? r.node.text : '')).join(''),
      });
    } else {
      out.push(...wrapMark(mark, phrasingFromItems(run, depth + 1)));
    }
    i = j;
  }
  return out;
}

function phrasingFrom(nodes: Rec[]): PhrasingContent[] {
  return phrasingFromItems(nodes.map(inlineItem), 0);
}

function headingDepth(level: unknown): Heading['depth'] {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.round(level) : 1;
  return Math.min(6, Math.max(1, n)) as Heading['depth'];
}

function listFrom(node: Rec, ordered: boolean): List {
  const items = childrenOf(node).map(
    (child): ListItem => ({
      type: 'listItem',
      spread: false,
      children: child.type === 'listItem' ? blocksFrom(childrenOf(child)) : blocksFrom([child]),
    })
  );
  const list: List = { type: 'list', ordered, spread: false, children: items };
  if (ordered) {
    const start = attrsOf(node).start;
    list.start = typeof start === 'number' && Number.isFinite(start) ? Math.round(start) : 1;
  }
  return list;
}

function codeFrom(node: Rec): BlockContent {
  const language = attrsOf(node).language;
  return {
    type: 'code',
    lang: typeof language === 'string' && language !== '' ? language : null,
    value: childrenOf(node).map(textContent).join(''),
  };
}

function blocksFrom(nodes: Rec[]): BlockContent[] {
  const blocks: BlockContent[] = [];
  let inlineRun: Rec[] = [];
  const flush = () => {
    if (inlineRun.length > 0) {
      blocks.push({ type: 'paragraph', children: phrasingFrom(inlineRun) });
      inlineRun = [];
    }
  };
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'hardBreak':
      case 'image':
        inlineRun.push(node);
        break;
      case 'paragraph':
        flush();
        blocks.push({ type: 'paragraph', children: phrasingFrom(childrenOf(node)) });
        break;
      case 'heading':
        flush();
        blocks.push({
          type: 'heading',
          depth: headingDepth(attrsOf(node).level),
          children: phrasingFrom(childrenOf(node)),
        });
        break;
      case 'bulletList':
        flush();
        blocks.push(listFrom(node, false));
        break;
      case 'orderedList':
        flush();
        blocks.push(listFrom(node, true));
        break;
      case 'blockquote':
        flush();
        blocks.push({ type: 'blockquote', children: blocksFrom(childrenOf(node)) });
        break;
      case 'codeBlock':
        flush();
        blocks.push(codeFrom(node));
        break;
      case 'horizontalRule':
        flush();
        blocks.push({ type: 'thematicBreak' });
        break;
      default:
        flush();
        blocks.push(...blocksFrom(childrenOf(node)));
    }
  }
  flush();
  return blocks;
}

export function tiptapToMarkdown(doc: unknown): string {
  const content = isRec(doc) && Array.isArray(doc.content) ? doc.content.filter(isRec) : [];
  const root: Root = { type: 'root', children: blocksFrom(content) };
  return toMarkdown(root, {
    bullet: '-',
    rule: '-',
    extensions: [gfmStrikethroughToMarkdown()],
  }).trimEnd();
}
