import { type } from 'arktype';
import { boardColumnSchema, boardLabelSchema, boardTaskSchema } from './board';
import { projectSchema } from './projects';

// Nested pieces stay module-private: the OpenAPI schema-name registry reads the
// barrel and throws when two exports produce identical JSON Schema.
const exportUserSchema = type({
  id: 'string',
  email: 'string',
  name: 'string',
});

const exportImageSchema = type({
  id: 'string',
  path: 'string',
  filename: 'string',
  content_type: 'string',
  size_bytes: 'number',
  created_at: 'string',
});

const exportTaskSchema = boardTaskSchema
  .omit('image_count')
  .merge({ images: exportImageSchema.array() });

export const projectExportQuerySchema = type({
  'format?': "'zip' | 'json'",
});

export const projectExportSchema = type({
  format: "'critical-path-project-export'",
  version: 'number',
  exported_at: 'string',
  project: projectSchema,
  users: exportUserSchema.array(),
  columns: boardColumnSchema.array(),
  labels: boardLabelSchema.array(),
  tasks: exportTaskSchema.array(),
});

export type ProjectExport = typeof projectExportSchema.infer;
