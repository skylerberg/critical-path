import { type } from 'arktype';
import { isValidUuid } from '../utils/uuid';

// The document model, and the owner of every judgment about what a node means:
// the node types below, what an image node may point at, and what a mention
// reads as. Validation is only the first reader — export, copy and the series
// template all walk the same tree, and a second opinion about a node type in one
// of them is how a document comes to be empty in one place and not in another.

export const TIPTAP_MAX_SERIALIZED_BYTES = 100 * 1024;
// Matches the bound on app_user.name, which is what a mention label snapshots.
export const MENTION_LABEL_MAX_LENGTH = 200;

const NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'image',
  'mention',
]);
const MARK_TYPES = new Set(['bold', 'italic', 'strike', 'code', 'link']);
const LINK_HREF_PATTERN = /^(https?:|mailto:)/;
export const IMAGE_SRC_PREFIX = '/api/images/';
const NODE_KEYS = new Set(['type', 'attrs', 'marks', 'content', 'text']);
const MARK_KEYS = new Set(['type', 'attrs']);
// Tiptap documents are shallow in practice; the cap keeps the recursive walk
// safe from stack exhaustion on adversarial deeply-nested input.
const MAX_DEPTH = 100;

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
}

export interface TiptapDoc {
  type: 'doc';
  content?: TiptapNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function imageSrc(imageId: string): string {
  return `${IMAGE_SRC_PREFIX}${imageId}`;
}

// The one place an image node's src is taken apart. Anything reading the id back
// out by hand is a second, quieter definition of what an image node may point
// at, and the two go out of step the first time this one is tightened.
export function imageIdFromSrc(src: string): string | null {
  if (!src.startsWith(IMAGE_SRC_PREFIX)) return null;
  const imageId = src.slice(IMAGE_SRC_PREFIX.length);
  return isValidUuid(imageId) ? imageId.toLowerCase() : null;
}

// A mention is an atom with no text child, and it reads as its label. Emptiness
// and plain-text rendering have to agree about that or a comment reading only
// "@Bob" is rejected as empty by one and exported as its label by the other —
// Tiptap's own emptiness check counts it, so both say it is content.
export function mentionText(node: TiptapNode): string | null {
  if (node.type !== 'mention') return null;
  const label = node.attrs?.label;
  return `@${typeof label === 'string' ? label : ''}`;
}

function mapNodes(
  nodes: TiptapNode[],
  visit: (node: TiptapNode) => TiptapNode | null
): TiptapNode[] {
  const kept: TiptapNode[] = [];
  for (const node of nodes) {
    const mapped = visit(node);
    if (mapped === null) continue;
    kept.push(
      mapped.content === undefined
        ? mapped
        : { ...mapped, content: mapNodes(mapped.content, visit) }
    );
  }
  return kept;
}

// Rebuilds a document with every node passed through `visit`, dropping the ones
// it answers null for. The root is not offered: a document is not a node any
// caller may delete, and both callers — rewriting image ids into a copy, and
// stripping images out of a series template — only ever act on what is inside
// it.
export function mapTiptapDoc(
  doc: TiptapDoc,
  visit: (node: TiptapNode) => TiptapNode | null
): TiptapDoc {
  if (doc.content === undefined) return { ...doc };
  return { ...doc, content: mapNodes(doc.content, visit) };
}

function isAllowedImageSrc(src: string): boolean {
  return imageIdFromSrc(src) !== null;
}

function markProblem(mark: unknown, path: string): string | null {
  if (!isRecord(mark)) {
    return `${path} must be an object`;
  }
  for (const key of Object.keys(mark)) {
    if (!MARK_KEYS.has(key)) {
      return `${path} has unknown key "${key}"`;
    }
  }
  const markType = mark.type;
  if (typeof markType !== 'string' || !MARK_TYPES.has(markType)) {
    return `${path} has unknown mark type ${JSON.stringify(markType)}`;
  }
  if ('attrs' in mark && !isRecord(mark.attrs)) {
    return `${path}.attrs must be an object`;
  }
  if (markType === 'link') {
    const href = isRecord(mark.attrs) ? mark.attrs.href : undefined;
    if (typeof href !== 'string' || !LINK_HREF_PATTERN.test(href)) {
      return `${path} link href must start with http:, https:, or mailto:`;
    }
  }
  return null;
}

function nodeProblem(node: unknown, path: string, depth: number): string | null {
  if (depth > MAX_DEPTH) {
    return `${path} exceeds the maximum nesting depth of ${MAX_DEPTH}`;
  }
  if (!isRecord(node)) {
    return `${path} must be an object`;
  }
  for (const key of Object.keys(node)) {
    if (!NODE_KEYS.has(key)) {
      return `${path} has unknown key "${key}"`;
    }
  }
  const nodeType = node.type;
  if (typeof nodeType !== 'string' || !NODE_TYPES.has(nodeType)) {
    return `${path} has unknown node type ${JSON.stringify(nodeType)}`;
  }
  if (nodeType === 'doc' && depth > 0) {
    return `${path} must not contain a nested doc node`;
  }
  if ('attrs' in node && !isRecord(node.attrs)) {
    return `${path}.attrs must be an object`;
  }
  if (nodeType === 'text') {
    if (typeof node.text !== 'string') {
      return `${path}.text must be a string`;
    }
    if ('content' in node) {
      return `${path} text nodes must not have content`;
    }
  } else if ('text' in node) {
    return `${path} only text nodes may have a text property`;
  }
  if (nodeType === 'image') {
    const src = isRecord(node.attrs) ? node.attrs.src : undefined;
    if (typeof src !== 'string' || !isAllowedImageSrc(src)) {
      return `${path} image src must be an ${IMAGE_SRC_PREFIX}<uuid> URL`;
    }
  }
  if (nodeType === 'mention') {
    const attrs = isRecord(node.attrs) ? node.attrs : undefined;
    if (typeof attrs?.id !== 'string' || !isValidUuid(attrs.id)) {
      return `${path} mention attrs.id must be a user id`;
    }
    const label = attrs.label;
    if (typeof label !== 'string' || label === '' || label.length > MENTION_LABEL_MAX_LENGTH) {
      return `${path} mention attrs.label must be 1 to ${MENTION_LABEL_MAX_LENGTH} characters`;
    }
  }
  if ('marks' in node) {
    if (!Array.isArray(node.marks)) {
      return `${path}.marks must be an array`;
    }
    for (const [index, mark] of node.marks.entries()) {
      const problem = markProblem(mark, `${path}.marks[${index}]`);
      if (problem) {
        return problem;
      }
    }
  }
  if ('content' in node) {
    if (!Array.isArray(node.content)) {
      return `${path}.content must be an array`;
    }
    for (const [index, child] of node.content.entries()) {
      const problem = nodeProblem(child, `${path}.content[${index}]`, depth + 1);
      if (problem) {
        return problem;
      }
    }
  }
  return null;
}

function hasVisibleContent(nodes: TiptapNode[] | undefined): boolean {
  for (const node of nodes ?? []) {
    if (node.type === 'image' || node.type === 'horizontalRule' || mentionText(node) !== null) {
      return true;
    }
    if (node.type === 'text' && (node.text ?? '').trim() !== '') {
      return true;
    }
    if (hasVisibleContent(node.content)) {
      return true;
    }
  }
  return false;
}

export function isEmptyTiptapDoc(doc: TiptapDoc): boolean {
  return !hasVisibleContent(doc.content);
}

export function findTiptapDocProblem(doc: unknown): string | null {
  const serializedBytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
  if (serializedBytes > TIPTAP_MAX_SERIALIZED_BYTES) {
    return `serializes to ${serializedBytes} bytes; the maximum is ${TIPTAP_MAX_SERIALIZED_BYTES}`;
  }
  return nodeProblem(doc, 'doc', 0);
}

// arktype cannot express the recursive node tree in a form the OpenAPI generator
// handles, so the allow-lists and size cap are enforced by the pipe's tree walk.
// `actual: ''` keeps the document itself out of the error message.
export const tiptapDocSchema = type({
  type: "'doc'",
  'content?': 'unknown[]',
}).pipe((doc, ctx) => {
  const problem = findTiptapDocProblem(doc);
  if (problem) {
    return ctx.error({ expected: `a valid Tiptap document (${problem})`, actual: '' });
  }
  return doc as TiptapDoc;
});

export const nullableTiptapDocSchema = tiptapDocSchema.or('null');
