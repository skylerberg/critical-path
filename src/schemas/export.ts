import { type } from 'arktype';
import { boardColumnSchema, boardLabelSchema, boardTaskSchema } from './board';
import { namedRefSchema } from './common';
import { projectSchema } from './projects';

// Nested pieces stay module-private: the OpenAPI schema-name registry reads the
// barrel and throws when two exports produce identical JSON Schema.
const exportImageSchema = type({
  id: 'string',
  path: 'string',
  filename: 'string',
  content_type: 'string',
  size_bytes: 'number',
  created_at: 'string',
});

const exportChecklistItemSchema = type({
  id: 'string',
  text: 'string',
  checked: 'boolean',
  position: 'number',
});

// path is null for a link: only file bytes ride in the archive.
const exportAttachmentSchema = type({
  id: 'string',
  kind: "'file' | 'link'",
  path: 'string | null',
  title: 'string | null',
  description: 'string | null',
  filename: 'string | null',
  content_type: 'string | null',
  size_bytes: 'number | null',
  url: 'string | null',
  unfurl_state: "'pending' | 'ok' | 'failed' | null",
  created_at: 'string',
});

const exportTaskSchema = boardTaskSchema.omit('image_count').merge({
  archived_at: 'string | null',
  images: exportImageSchema.array(),
  checklist_items: exportChecklistItemSchema.array(),
  attachments: exportAttachmentSchema.array(),
});

export const projectExportQuerySchema = type({
  'format?': "'zip' | 'json'",
});

export const projectExportSchema = type({
  format: "'critical-path-project-export'",
  version: 'number',
  exported_at: 'string',
  project: projectSchema,
  users: namedRefSchema.array(),
  columns: boardColumnSchema.array(),
  labels: boardLabelSchema.array(),
  tasks: exportTaskSchema.array(),
});

export type ProjectExport = typeof projectExportSchema.infer;
