import { type } from 'arktype';
import { isValidUuid } from '../types/uuid';

export const TIPTAP_MAX_SERIALIZED_BYTES = 100 * 1024;

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
]);
const MARK_TYPES = new Set(['bold', 'italic', 'strike', 'code', 'link']);
const LINK_HREF_PATTERN = /^(https?:|mailto:)/;
const IMAGE_SRC_PREFIX = '/api/images/';
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

function isAllowedImageSrc(src: string): boolean {
  return src.startsWith(IMAGE_SRC_PREFIX) && isValidUuid(src.slice(IMAGE_SRC_PREFIX.length));
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

export function findTiptapDocProblem(doc: unknown): string | null {
  const serializedBytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
  if (serializedBytes > TIPTAP_MAX_SERIALIZED_BYTES) {
    return `serializes to ${serializedBytes} bytes; the maximum is ${TIPTAP_MAX_SERIALIZED_BYTES}`;
  }
  return nodeProblem(doc, 'doc', 0);
}

// arktype cannot express the recursive node tree in a form the OpenAPI generator
// handles, so the allow-lists and size cap are enforced by the pipe's tree walk.
// `actual: ''` keeps the (potentially 100 KB) document out of the error message.
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
